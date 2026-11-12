import type { AccountCode, JournalEntry, JournalLine, Minor } from '../../shared/types.ts';

/**
 * Money is integer minor units everywhere. No float ever touches an amount.
 * ETB santim: 1 ETB = 100 santim.
 */
export const ZERO: Minor = 0;

export function add(...xs: Minor[]): Minor {
  return xs.reduce<Minor>((a, b) => a + b, 0);
}

export function sum(xs: Minor[]): Minor {
  return xs.reduce<Minor>((a, b) => a + b, 0);
}

/** Half-even rounding at the minor-unit boundary. */
export function mul(amount: Minor, factor: number): Minor {
  const raw = amount * factor;
  const floor = Math.floor(raw);
  const diff = raw - floor;
  if (Math.abs(diff - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(raw);
}

/** Apply a rate (e.g. 0.15 for 15% VAT) with half-even rounding. */
export function rate(amount: Minor, r: number): Minor {
  return mul(amount, r);
}

export function pct(amount: Minor, p: number): Minor {
  return mul(amount, p / 100);
}

export function min(a: Minor, b: Minor) {
  return a < b ? a : b;
}
export function max(a: Minor, b: Minor) {
  return a > b ? a : b;
}
export function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function isBalanced(lines: JournalLine[]): boolean {
  return sum(lines.map((l) => l.debit)) === sum(lines.map((l) => l.credit));
}

export class UnbalancedEntryError extends Error {
  constructor(entry: Pick<JournalEntry, 'refLabel'>) {
    super(
      `Refusing to post unbalanced journal entry "${entry.refLabel}". ` +
        `Double-entry is a hard invariant: debits must equal credits.`,
    );
    this.name = 'UnbalancedEntryError';
  }
}

let journalSeq = 0;

/**
 * The ONLY way a journal entry enters the ledger.
 * There is no code path that writes a partial or unbalanced entry.
 */
export function postJournal(input: {
  journal: JournalEntry['journal'];
  refType: JournalEntry['refType'];
  refId: string;
  refLabel: string;
  at: string;
  lines: JournalLine[];
  description: string;
  postedBy?: JournalEntry['postedBy'];
  reversalOf?: string;
  attachments?: string[];
}): JournalEntry {
  if (input.lines.length < 2) throw new Error(`Entry ${input.refLabel} needs at least 2 lines`);
  if (!isBalanced(input.lines)) throw new UnbalancedEntryError(input);
  for (const l of input.lines) {
    if (l.debit < 0 || l.credit < 0) throw new Error(`Negative line in ${input.refLabel}`);
    if (l.debit > 0 && l.credit > 0) throw new Error(`Line both debits and credits in ${input.refLabel}`);
  }
  journalSeq += 1;
  return {
    id: `je_${String(journalSeq).padStart(6, '0')}`,
    journal: input.journal,
    refType: input.refType,
    refId: input.refId,
    refLabel: input.refLabel,
    at: input.at,
    lines: input.lines,
    total: sum(input.lines.map((l) => l.debit)),
    description: input.description,
    postedBy: input.postedBy ?? 'system',
    reversalOf: input.reversalOf,
    attachments: input.attachments ?? [],
  };
}

export function entry(acct: AccountCode, debit: Minor, credit: Minor, memo?: string, party?: { type: JournalLine['partyType']; id: string }): JournalLine {
  return { account: acct, debit, credit, memo, partyType: party?.type, partyId: party?.id };
}

/** Trial balance check across a whole ledger — must be zero. */
export function ledgerBalances(entries: JournalEntry[]): boolean {
  let d = 0;
  let c = 0;
  for (const e of entries) {
    d += sum(e.lines.map((l) => l.debit));
    c += sum(e.lines.map((l) => l.credit));
  }
  return d === c;
}
