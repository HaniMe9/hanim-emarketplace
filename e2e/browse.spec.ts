/**
 * Route click-through: every role's routes must render real content without
 * crashing. One test per route so a broken panel is attributed to the exact
 * path that broke it. The `Guard` fixture fails any test that produced an
 * uncaught error or an unexpected failed API request.
 */
import { test, expect, mainText, type AccountKey } from './fixtures';

const ROUTES: Partial<Record<AccountKey, string[]>> = {
  buyer: ['/', '/search?q=coffee', '/product/p_001', '/sellers/org_selam', '/cart', '/checkout', '/orders', '/disputes', '/track/HM-48205', '/track'],
  seller: ['/seller', '/seller/orders', '/seller/listings', '/seller/finance', '/seller/ai', '/seller/buybox'],
  businessBuyer: ['/b2b', '/b2b/rfqs', '/b2b/orders', '/b2b/invoices'],
  agent: ['/agent', '/agent/routes', '/agent/cash'],
  admin: ['/admin', '/admin/directory', '/admin/moderation', '/admin/finance', '/admin/reconciliation', '/admin/risk', '/admin/ai', '/admin/settings'],
};

for (const [role, routes] of Object.entries(ROUTES)) {
  if (!routes) continue;
  test.describe(`${role} routes`, () => {
    test.beforeEach(async ({ page, signOut, signInAs }) => {
      await signOut();
      await signInAs(role as AccountKey);
    });

    for (const route of routes) {
      test(route, async ({ page }) => {
        const res = await page.goto(route, { waitUntil: 'networkidle' });
        expect(res?.status(), 'navigation should not 4xx/5xx').toBeLessThan(400);
        // React Router SPA: compare pathnames so an intentional query-string
        // cleanup (e.g. /search?q=coffee -> /search) is not treated as a fault.
        expect(new URL(page.url()).pathname).toBe(new URL(route, page.url()).pathname);
        await page.waitForTimeout(500);

        const probe = (await mainText(page)).replace(/\s+/g, ' ').trim();
        expect(probe.length, `"${route}" rendered no content`).toBeGreaterThan(40);
        expect(probe.toLowerCase()).not.toContain('unexpected application error');
      });
    }
  });
}