import { test as base, expect, type Page } from '@playwright/test';

/**
 * Shared fixtures for the marketplace suite.
 *
 * The important part is `guard`. The old ad-hoc harness *printed* console errors
 * and failed requests at the end, which meant a real error could scroll past in
 * a long log. Here they are attached per test and asserted, so an unexpected 500
 * or a React crash fails the test that caused it.
 */

export const DEMO_PASSWORD = 'Demo#2026!';

export const ACCOUNTS = {
  admin: 'selam@hanimarket.et',
  finance: 'tewodros@hanimarket.et',
  seller: 'marta@selamtech.et',
  sellerHub: 'feven@hanimarket.et',
  buyer: 'abebe@example.et',
  businessBuyer: 'hiwot@habesha_retail.et',
  agent: 'kalkidan@courier.et',
} as const;

export type AccountKey = keyof typeof ACCOUNTS;

export type { Page };

/** An API response that is expected to fail, so the guard can ignore it. */
export interface ExpectedFailure {
  /** Substring or RegExp matched against the request path. */
  path: string | RegExp;
  /** HTTP status the request is expected to return. */
  status: number;
  /** Optional human note explaining why this is expected. */
  because?: string;
}

/**
 * Collects anything that should never happen during a test and turns it into a
 * failure. Expected failures are declared up front via `expectApiFailure`.
 */
export class Guard {
  readonly consoleErrors: string[] = [];
  readonly pageErrors: string[] = [];
  readonly apiFailures: string[] = [];
  private readonly allowed: ExpectedFailure[] = [];

  allowApiFailure(f: ExpectedFailure): void {
    this.allowed.push(f);
  }

  isAllowed(path: string, status: number): boolean {
    return this.allowed.some((f) => {
      const pathOk = typeof f.path === 'string' ? path.includes(f.path) : f.path.test(path);
      return pathOk && f.status === status;
    });
  }

  /**
   * A failed fetch shows up twice: as the HTTP response event (path-known) and
   * as a browser console error like "Failed to load resource: the server
   * responded with a status of 409 (Conflict)" (path-unknown). If a status has
   * been declared allowed, its duplicate console error is noise, not a bug.
   */
  isAllowedConsoleError(text: string): boolean {
    const m = /the server responded with a status of (\d+)/.exec(text);
    if (!m) return false;
    const status = Number(m[1]);
    return this.allowed.some((f) => f.status === status);
  }

  /** Throws if anything unanticipated was collected. Called automatically. */
  assertClean(page: Page): void {
    const problems: string[] = [];
    for (const e of this.consoleErrors) problems.push(`console error: ${e}`);
    for (const e of this.pageErrors) problems.push(`uncaught error: ${e}`);
    for (const e of this.apiFailures) problems.push(`API failure: ${e}`);
    expect(
      problems,
      `Unexpected errors on ${page.url()}. If one of these is intentional, declare it with expectApiFailure().`,
    ).toEqual([]);
  }
}

type Fixtures = {
  guard: Guard;
  /** Signs in as `who` by calling the API from inside the page, so the browser owns the session cookie. */
  signInAs: (who: AccountKey) => Promise<void>;
  /** Signs out, clearing the cookie. */
  signOut: () => Promise<void>;
};

export const test = base.extend<Fixtures>({
  guard: async ({ page }, use) => {
    const guard = new Guard();
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (guard.isAllowedConsoleError(m.text())) return;
      guard.consoleErrors.push(m.text().slice(0, 300));
    });
    page.on('pageerror', (e) => guard.pageErrors.push(String(e).slice(0, 300)));
    page.on('response', (r) => {
      const url = r.url();
      if (!url.includes('/api/') || r.status() < 400) return;
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      if (guard.isAllowed(path, r.status())) return;
      guard.apiFailures.push(`${r.status()} ${path}`);
    });

    // Assert cleanliness at the end, but let the test's own body run first so
    // its failure message is the primary one the developer reads.
    await use(guard);
    guard.assertClean(page);
  },

  signInAs: async ({ page }, use) => {
    await use(async (who: AccountKey) => {
      const email = ACCOUNTS[who];
      // Log in through fetch so the cookie is set inside the browser context.
      const res = await page.request.post('/api/session/login', {
        data: { email, password: DEMO_PASSWORD },
      });
      expect(res.ok(), `sign-in failed for ${email}: ${res.status()}`).toBeTruthy();
    });
  },

  signOut: async ({ page }, use) => {
    await use(async () => {
      await page.request.post('/api/session/logout');
    });
  },
});

export { expect };

/** Convenience: the visible text of the main region, which is what the tests assert on. */
export const mainText = (page: Page) => page.locator('main').innerText();

/** A unique token so a test's rows can be told apart from the seeded data. */
export const unique = (label: string) => `${label}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
