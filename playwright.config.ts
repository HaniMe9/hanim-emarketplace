import { defineConfig, devices } from '@playwright/test';

/**
 * The suite boots its own servers on dedicated ports so it never collides with
 * `npm run dev` running on 5173/4000, and so every run starts from a fresh
 * seed (the database is in-memory). Servers are always freshly started —
 * `reuseExistingServer` is off, deliberately. The API is single-worker: the
 * in-memory DB is shared mutable state that must not overlap between workers.
 */
const WEB_PORT = 5273;
const API_PORT = 4100;
const WEB = `http://localhost:${WEB_PORT}`;
const API = `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: [
    {
      command: `npx tsx server/index.ts`,
      url: `${API}/api/health`,
      // The suite runs on its own port, so the API's default dev allowlist
      // (5173) has to be extended or every credentialed request is a CORS
      // failure. `HM_DEV_OTP=fixed` is what lets the payment tests assert that
      // a real code captures an order — production has no such escape hatch.
      // `NODE_ENV=test` is what puts persistence in `memory` mode, so every run
      // starts from the seed instead of inheriting whatever the last run, a
      // manual `npm run dev`, or an earlier debugging session left behind. The
      // suite asserts on seeded fixtures — a buyer's basket line, an order in
      // `pending_payment` — which only hold on a database nobody has mutated.
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        HM_ALLOW_ROLE_SWITCH: 'on',
        HM_ALLOWED_ORIGINS: WEB,
        HM_DEV_OTP: 'fixed',
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${WEB_PORT}`,
      url: WEB,
      env: { API_PROXY_TARGET: API },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});