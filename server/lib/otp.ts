import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
/** One outstanding code per purpose per subject, so a new request retires the old. */
const MAX_OPEN_PER_SUBJECT = 3;
const KEY_LENGTH = 32;

export interface OtpChallenge {
  id: string;
  subjectId: string;
  purpose: string;
  /** `saltHex:hashHex`. The code itself is never stored. */
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
}

/**
 * The whole point of this module: a code has to have been *issued* to be
 * accepted, and can only be spent once. Verifying "is this string non-empty" is
 * not an OTP check — it lets anyone confirm a payment they never paid for, which
 * is exactly what the payment endpoint used to accept.
 */
export class OtpStore {
  private readonly bySubject = new Map<string, OtpChallenge>();

  private readonly now: () => number;
  private readonly fixedCode: string | null;
  private readonly ttlMs: number;
  private readonly maxAttempts: number;

  constructor(now: () => number = Date.now, opts: { fixedCode?: string; ttlMs?: number; maxAttempts?: number } = {}) {
    this.now = now;
    this.fixedCode = opts.fixedCode ?? null;
    this.ttlMs = opts.ttlMs ?? OTP_TTL_MS;
    this.maxAttempts = opts.maxAttempts ?? 5;
  }

  private key(subjectId: string, purpose: string): string {
    return `${subjectId}::${purpose}`;
  }

  /**
   * Whether this store was built with a constant code.
   *
   * Routes use it to decide whether to return the code in the response so a
   * developer can complete a sandbox checkout. It is false for any store built
   * without an explicit fixed code, which is every production build.
   */
  get fixedCodeInUse(): boolean {
    return otpUsesFixedCode(this.fixedCode);
  }

  /**
   * Issue a code. The plaintext is returned to the caller and nowhere else; only
   * its per-code salt and hash are retained. Any earlier outstanding challenge
   * for the same purpose is retired, and a subject cannot hold an unbounded
   * number open.
   */
  issue(subjectId: string, purpose: string): { challenge: OtpChallenge; code: string } {
    this.prune();
    const salt = randomBytes(16);
    const code = this.fixedCode ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    const createdAt = this.now();
    const challenge: OtpChallenge = {
      id: `otp_${randomBytes(8).toString('hex')}`,
      subjectId,
      purpose,
      codeHash: `${salt.toString('hex')}:${scryptSync(code, salt, KEY_LENGTH).toString('hex')}`,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      attempts: 0,
    };

    const key = this.key(subjectId, purpose);
    const previous = this.bySubject.get(key);
    if (previous) this.bySubject.delete(key);
    this.bySubject.set(key, challenge);
    this.capOpenPerSubject(subjectId, key);
    return { challenge, code };
  }

  /** Keep one subject from accumulating challenges across many purposes. */
  private capOpenPerSubject(subjectId: string, keepKey: string): void {
    const open = [...this.bySubject.entries()]
      .filter(([, c]) => c.subjectId === subjectId)
      .sort((a, b) => a[1].createdAt - b[1].createdAt);
    while (open.length > MAX_OPEN_PER_SUBJECT) {
      const oldest = open.shift()!;
      if (oldest[0] !== keepKey) this.bySubject.delete(oldest[0]);
      else break;
    }
  }

  /**
   * Check a submitted code against the subject's live challenge. A correct code
   * is consumed immediately, so a replay of a captured code fails. The entry is
   * also destroyed once the attempt budget is gone — a correct code guessed on
   * the last allowed try cannot rescue a brute force.
   */
  verify(subjectId: string, purpose: string, submitted: string): OtpResult {
    const key = this.key(subjectId, purpose);
    const challenge = this.bySubject.get(key);
    if (!challenge) {
      return { ok: false, code: 'invalid', message: 'Request a new code to continue.' };
    }
    if (challenge.expiresAt <= this.now()) {
      this.bySubject.delete(key);
      return { ok: false, code: 'expired', message: 'That code has expired. Request a new one.' };
    }
    if (challenge.attempts >= this.maxAttempts) {
      this.bySubject.delete(key);
      return {
        ok: false,
        code: 'too_many_attempts',
        message: 'Too many incorrect attempts. Request a new code.',
      };
    }

    const [saltHex, hashHex] = challenge.codeHash.split(':');
    if (!saltHex || !hashHex) {
      this.bySubject.delete(key);
      return { ok: false, code: 'invalid', message: 'Request a new code to continue.' };
    }
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(submitted, Buffer.from(saltHex, 'hex'), expected.length);
    const ok = expected.length === actual.length && timingSafeEqual(expected, actual);

    if (!ok) {
      challenge.attempts += 1;
      const left = OTP_MAX_ATTEMPTS - challenge.attempts;
      if (left <= 0) this.bySubject.delete(key);
      return {
        ok: false,
        code: left <= 0 ? 'too_many_attempts' : 'invalid',
        message: left <= 0 ? 'Too many incorrect attempts. Request a new code.' : `That code is not right. ${left} attempt(s) left.`,
      };
    }

    this.bySubject.delete(key);
    return { ok: true, challenge };
  }

  /** True when a code is outstanding, so the endpoint can ask rather than capture. */
  hasPending(subjectId: string, purpose: string): boolean {
    this.prune();
    return this.bySubject.has(this.key(subjectId, purpose));
  }

  /** Drop anything expired. */
  prune(): void {
    const now = this.now();
    for (const [key, c] of this.bySubject) {
      if (c.expiresAt <= now) this.bySubject.delete(key);
    }
  }

  get size(): number {
    return this.bySubject.size;
  }
}

export type OtpFailure = 'invalid' | 'expired' | 'too_many_attempts';
export type OtpResult = { ok: true; challenge: OtpChallenge } | { ok: false; code: OtpFailure; message: string };

/**
 * Sandbox affordance. When the OTP store is built with a fixed code, checkout can
 * be walked without an SMS gateway. Issue, expiry, attempt limits and single use
 * all still apply, so the path under test is the real one.
 *
 * It must not be configured in production: any fixed code is a universal key that
 * captures any order. `loadConfig` refuses to start if it is set there, so this
 * only ever reflects a deliberate choice made by whoever built the store.
 */
export function otpUsesFixedCode(fixedCode: string | null | undefined): boolean {
  return typeof fixedCode === 'string' && fixedCode.length > 0;
}