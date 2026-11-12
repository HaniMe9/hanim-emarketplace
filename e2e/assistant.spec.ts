import { test, expect } from './fixtures';
import type { Page } from './fixtures';

/**
 * The assistant has to do more than reply once: it has to keep the thread, stay
 * grounded in real catalog prices, and follow the UI language across turns.
 */

const panel = (page: Page) => page.getByRole('region', { name: /Ask the marketplace|ለመድረኩ ይጠይቁ/ });

async function ask(page: Page, text: string) {
  const box = panel(page).getByRole('textbox');
  await box.fill(text);
  await box.press('Enter');
}

const bubbles = (page: Page) => panel(page).locator('.rounded-lg');

test.describe('buyer assistant', () => {
  test.beforeEach(async ({ page, signInAs }) => {
    await signInAs('buyer');
    await page.goto('/');
    await expect(panel(page)).toBeVisible();
  });

  test('answers a question with grounded, clickable products', async ({ page }) => {
    await ask(page, 'headphones under ETB 20000');

    // The reply and the cards both arrive, and the reply names a price.
    await expect(bubbles(page)).toHaveCount(2);
    const answer = bubbles(page).nth(1);
    await expect(answer).toContainText(/ETB\s?[\d,]+/);

    // Every suggested product links to a real product page.
    const cards = answer.locator('a[href^="/product/"]');
    await expect(cards.first()).toBeVisible();
    await cards.first().click();
    await expect(page).toHaveURL(/\/product\//);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect((await page.locator('main').innerText()).length).toBeGreaterThan(200);
  });

  test('stays in context across turns', async ({ page }) => {
    await ask(page, 'headphones');
    await expect(bubbles(page)).toHaveCount(2);

    // "cheaper?" carries no subject of its own; it must resolve to the same
    // category rather than falling back to best-sellers.
    await ask(page, 'cheaper?');
    await expect(bubbles(page)).toHaveCount(4);
    const followUp = bubbles(page).nth(3);
    await expect(followUp).toContainText(/headphone|sርጣ|ክላ/i);

    const prices = await page
      .locator('.rounded-lg a[href^="/product/"] span.font-bold')
      .allInnerTexts();
    const amounts = prices.map((p) => Number(p.replace(/[^\d.]/g, '')));
    expect(amounts.length).toBeGreaterThan(0);
    // Sorted ascending because the follow-up asked for cheaper.
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
  });

  test('a budget filter actually constrains the results', async ({ page }) => {
    await ask(page, 'coffee');
    await expect(bubbles(page)).toHaveCount(2);
    const all = await page.locator('.rounded-lg a[href^="/product/"] span.font-bold').allInnerTexts();

    await panel(page).getByRole('button', { name: /Start a new conversation/ }).click();
    await ask(page, 'coffee under ETB 5000');
    await expect(bubbles(page)).toHaveCount(2);
    const cheap = await page.locator('.rounded-lg a[href^="/product/"] span.font-bold').allInnerTexts();

    const amount = (s: string) => Number(s.replace(/[^\d.]/g, ''));
    expect(cheap.length).toBeGreaterThan(0);
    for (const c of cheap) expect(amount(c)).toBeLessThanOrEqual(5000);
    // A tighter budget must not widen the result set.
    expect(cheap.length).toBeLessThanOrEqual(all.length);
  });

  test('never invents a price that is not in the catalog', async ({ page }) => {
    await ask(page, 'phone');
    await expect(bubbles(page)).toHaveCount(2);

    // Every ETB figure in the prose has to appear on one of the result cards;
    // review counts and ratings in the same sentence are not prices.
    const stated = await bubbles(page).nth(1).innerText();
    const quoted = [...stated.matchAll(/ETB\s*([\d][\d,]*(?:\.\d+)?)/g)].map((m) => m[1].replace(/,/g, ''));
    expect(quoted.length).toBeGreaterThan(0);
    const shown = (await page.locator('.rounded-lg a[href^="/product/"] span.font-bold').allInnerTexts()).map((s) =>
      s.replace(/[^\d.]/g, ''),
    );
    for (const q of quoted) {
      expect(shown.some((s) => s.startsWith(q)), `quoted ETB ${q} is not among the cards ${shown.join(', ')}`).toBe(true);
    }
  });

  test('says so instead of guessing when nothing matches', async ({ page }) => {
    await ask(page, 'zzzznotathing');
    await expect(bubbles(page)).toHaveCount(2);
    await expect(bubbles(page).nth(1)).toContainText(/could not find|አልገኘልኩም/i);
    await expect(page.locator('.rounded-lg a[href^="/product/"]')).toHaveCount(0);
  });

  test('keeps answering in Amharic after the user switches language', async ({ page }) => {
    await ask(page, 'headphones');
    await expect(bubbles(page)).toHaveCount(2);
    await expect(bubbles(page).nth(1)).not.toContainText(/[ሀ-፿]/);

    await page.getByRole('group', { name: /^(Language|ቋንቋ)$/ }).getByRole('button', { name: 'AM' }).click();
    await ask(page, 'ስማርት');

    const amReply = bubbles(page).nth(3);
    await expect(amReply).toContainText(/[ሀ-፿]/);
    await expect(amReply).toContainText(/ETB\s?[\d,]+/);
  });

  test('a failed turn stays in the transcript and does not wedge the panel', async ({ page }) => {
    await page.route('**/api/ai/assistant', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'down', message: 'boom' }) }),
    );
    await ask(page, 'headphones');
    await expect(bubbles(page)).toHaveCount(2);
    await expect(bubbles(page).nth(1)).toContainText('boom');

    await page.unroute('**/api/ai/assistant');
    await ask(page, 'coffee');
    await expect(bubbles(page)).toHaveCount(4);
    await expect(bubbles(page).nth(3)).toContainText(/ETB/);
  });
});