/**
 * Layout audit. Screenshots can't be eyeballed in CI, so assert what a
 * screenshot would reveal: horizontal overflow at mobile widths, chart SVG
 * that never got a real box, text clipped out of its container, and dark mode
 * actually applying (with the Amharic locale engaged).
 */
import { test, expect, type Page, type AccountKey } from './fixtures';

const ROUTES: Partial<Record<AccountKey, string[]>> = {
  buyer: ['/', '/product/p_001', '/cart', '/checkout', '/orders'],
  seller: ['/seller', '/seller/orders', '/seller/finance', '/seller/buybox'],
  businessBuyer: ['/b2b', '/b2b/rfqs', '/b2b/orders', '/b2b/invoices'],
  agent: ['/agent', '/agent/routes', '/agent/cash'],
  admin: ['/admin', '/admin/directory', '/admin/finance', '/admin/reconciliation', '/admin/risk', '/admin/ai', '/admin/settings'],
};

const WIDTHS = [375, 768, 1440];

interface LayoutMetrics {
  scrollW: number;
  clientW: number;
  overflowing: string[];
  charts: { w: number; h: number; paths: number }[];
  clipped: string[];
  mainH: number;
}

async function layoutMetrics(page: Page): Promise<LayoutMetrics> {
  return page.evaluate(() => {
    const de = document.documentElement;
    const hasScrollingAncestor = (el: Element): boolean => {
      let c: Element | null = el.parentElement;
      for (let i = 0; i < 6 && c; i++, c = c.parentElement) {
        const cs = getComputedStyle(c);
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowX === 'hidden') return true;
      }
      return false;
    };
    const overflowing = Array.from(document.querySelectorAll('body *'))
      .filter((el) => {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) return false;
        if (getComputedStyle(el).position === 'fixed') return false;
        if (hasScrollingAncestor(el)) return false;
        return b.right > de.clientWidth + 2 || b.left < -2;
      })
      .slice(0, 6)
      .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ').slice(0, 3).join('.')}`);
    const charts = Array.from(document.querySelectorAll('.recharts-wrapper')).map((s) => {
      const b = s.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height), paths: s.querySelectorAll('path, rect').length };
    });
    // Ellipsis / line-clamp truncation is deliberate; skip it here.
    const clipped = Array.from(document.querySelectorAll('main *'))
      .filter((el) => el.children.length === 0 && el.textContent?.trim())
      .filter((el) => {
        const cs = getComputedStyle(el);
        if (cs.textOverflow === 'ellipsis') return false;
        if ((cs as unknown as { webkitLineClamp?: string }).webkitLineClamp) return false;
        const b = el.getBoundingClientRect();
        return b.height > 0 && el.scrollHeight > el.clientHeight + 4 && cs.overflow === 'hidden';
      })
      .slice(0, 5)
      .map((el) => el.textContent.trim().slice(0, 40));
    const main = document.querySelector('main');
    return {
      scrollW: de.scrollWidth,
      clientW: de.clientWidth,
      overflowing,
      charts,
      clipped,
      mainH: Math.round(main?.getBoundingClientRect().height ?? 0),
    };
  });
}

function problems(metrics: LayoutMetrics): string[] {
  const out: string[] = [];
  if (metrics.scrollW > metrics.clientW + 2) out.push(`h-overflow ${metrics.scrollW}px > ${metrics.clientW}px`);
  if (metrics.overflowing.length) out.push(`stuck-out: ${metrics.overflowing.join(', ')}`);
  const badCharts = metrics.charts.filter((c) => c.w < 40 || c.h < 40 || c.paths === 0);
  if (badCharts.length) out.push(`empty-chart: ${JSON.stringify(badCharts)}`);
  if (metrics.clipped.length) out.push(`clipped-text: ${metrics.clipped.join(' / ')}`);
  if (metrics.mainH < 100) out.push(`main collapsed (${metrics.mainH}px)`);
  return out;
}

for (const [role, routes] of Object.entries(ROUTES)) {
  test.describe(`${role} layout`, () => {
    test.beforeEach(async ({ page, signOut, signInAs }) => {
      await signOut();
      await signInAs(role as AccountKey);
    });

    for (const route of routes) {
      for (const width of WIDTHS) {
        test(`${width}px ${route}`, async ({ page }) => {
          test.setTimeout(30_000);
          await page.setViewportSize({ width, height: 900 });
          const res = await page.goto(route, { waitUntil: 'networkidle' });
          expect(res?.status()).toBeLessThan(400);
          await page.waitForTimeout(600);
          const m = await layoutMetrics(page);
          const issues = problems(m);
          expect(issues, `layout issues on ${route} @ ${width}px`).toEqual([]);
        });
      }
    }

    test('dark mode + Amharic locale apply', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(routes[0], { waitUntil: 'networkidle' });
      const before = await page.evaluate(() => ({
        dark: document.documentElement.classList.contains('dark'),
        bg: getComputedStyle(document.body).backgroundColor,
        lang: document.documentElement.lang,
      }));
      await page.evaluate(() => {
        localStorage.setItem('hm.theme', 'dark');
        localStorage.setItem('hm.lang', 'am');
      });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => ({
        dark: document.documentElement.classList.contains('dark'),
        bg: getComputedStyle(document.body).backgroundColor,
        lang: document.documentElement.lang,
      }));
      expect({ ...before, ...after }, 'dark mode / Amharic should engage and change the background').toMatchObject({
        dark: true,
        lang: 'am',
      });
      expect(after.bg).not.toBe(before.bg);
    });
  });
}