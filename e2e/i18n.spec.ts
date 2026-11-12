import { test, expect } from './fixtures';
import type { Page } from './fixtures';

/** The switcher labels itself in the active language, so match either. */
const langGroup = (page: Page) => page.getByRole('group', { name: /^(Language|ቋንቋ)$/ });

/** Language is per-browser, so each test starts from a known state. */
async function startInEnglish(page: Page) {
  await page.goto('/');
  const group = langGroup(page);
  await expect(group).toBeVisible();
  if ((await group.getByRole('button', { name: 'ENG' }).getAttribute('aria-pressed')) !== 'true') {
    await group.getByRole('button', { name: 'ENG' }).click();
  }
}

test.describe('i18n', () => {
  test.beforeEach(async ({ signOut }) => {
    await signOut();
  });

  test('AM means Amharic and ENG means English', async ({ page }) => {
    await startInEnglish(page);
    const group = langGroup(page);

    // Both codes are offered, and each names its language in its own script.
    await expect(group.getByRole('button', { name: 'AM' })).toHaveAttribute('title', 'አማርኛ');
    await expect(group.getByRole('button', { name: 'ENG' })).toHaveAttribute('title', 'English');

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(group.getByRole('button', { name: 'ENG' })).toHaveAttribute('aria-pressed', 'true');

    // Switch to Amharic: same control, Amharic copy, AM marked active.
    await group.getByRole('button', { name: 'AM' }).click();
    await expect(page.getByRole('heading', { name: 'ግባ' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'am');
    await expect(group.getByRole('button', { name: 'AM' })).toHaveAttribute('aria-pressed', 'true');

    // A missing Amharic entry falls back to the English key, never to a blank label.
    await expect(page.getByText(/Demo accounts|የናሙና መለያዎች/)).toBeVisible();
    await expect(page.getByRole('button', { name: /abebe@example\.et/ })).toBeVisible();

    await group.getByRole('button', { name: 'ENG' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('language choice survives a reload', async ({ page }) => {
    await startInEnglish(page);
    await langGroup(page).getByRole('button', { name: 'AM' }).click();
    await expect(page.getByRole('heading', { name: 'ግባ' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'ግባ' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'am');
    await expect(page.getByRole('group', { name: 'ቋንቋ' })).toBeVisible();
  });

  test('navigation and shell copy translate too', async ({ page, signInAs }) => {
    await signInAs('buyer');
    await startInEnglish(page);

    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('link', { name: 'Browse' })).toBeVisible();

    await langGroup(page).getByRole('button', { name: 'AM' }).click();
    await expect(nav.getByRole('link', { name: 'ያስለቀሱ' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'ትዕዛዞች' })).toBeVisible();

    // The user menu is collapsed until clicked; its labels translate too.
    await page.getByRole('button', { name: /Abebe Kebede/ }).click();
    await expect(page.getByRole('button', { name: 'ውጣ' })).toBeVisible();
    await expect(page.getByText('ገዢ', { exact: true }).first()).toBeVisible();
  });
});