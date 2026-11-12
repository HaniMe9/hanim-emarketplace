/**
 * Admin Directory end-to-end: users, sellers, categories — create, edit,
 * suspend, reinstate, delete, and the referential-integrity guards.
 *
 * The delete-guard tests generate a 409 on purpose; those are declared up
 * front via `guard.allowApiFailure`, so the generic guard still fails any
 * *unexpected* error.
 */
import { test, expect, mainText, unique } from './fixtures';

const adminLogin = { email: 'selam@hanimarket.et', password: 'Demo#2026!' };

test.beforeEach(async ({ page, signOut }) => {
  // Start each test from a clean signed-out state, then sign in fresh.
  await signOut();
  await page.goto('/', { waitUntil: 'networkidle' });
  const res = await page.request.post('/api/session/login', { data: adminLogin });
  expect(res.ok()).toBeTruthy();
  await page.goto('/admin/directory', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
});

test('users tab renders seeded data with reference badges', async ({ page }) => {
  const body = await mainText(page);
  expect(body).toMatch(/Directory/);
  // Stat labels are uppercased by CSS, so innerText returns "ACCOUNTS".
  expect(body).toMatch(/accounts/i);
  expect(body).toMatch(/suspended/i);
  expect(body).toMatch(/Abebe Kebede/);
  // Reference badges that justify the hard-delete guard ("6 orders" etc).
  expect(body).toMatch(/\d+ orders/);
});

test('creates, edits, suspends, reinstates, then deletes a user', async ({ page }) => {
  const name = unique('Browser Probe');
  await page.getByRole('button', { name: /New user/i }).click();
  await page.getByLabel(/Full name/i).fill(name);
  await page.getByLabel(/Email/i).fill(`${name.replace(/\s+/g, '-').toLowerCase()}@example.et`);
  await page.getByLabel(/Phone/i).fill('+251911222222');
  await page.getByRole('button', { name: /^Create user/i }).click();
  await page.waitForTimeout(1200);
  expect(await mainText(page)).toMatch(new RegExp(`${name} created`));

  // Isolate the row so Edit / Suspend / Delete always hit our user, not the
  // first card the seeded list happens to show.
  await page.getByPlaceholder(/Search name, email or phone/i).fill(name);
  await page.waitForTimeout(900);
  const card = page.locator('.card', { hasText: name });

  await card.getByRole('button', { name: /^Edit$/ }).first().click();
  await page.getByLabel(/Full name/i).fill(`${name} Renamed`);
  await page.getByRole('button', { name: /Save changes/i }).click();
  await page.waitForTimeout(1200);
  const renamed = `${name} Renamed`;
  expect(await mainText(page)).toContain(renamed);

  page.once('dialog', (d) => d.accept('Fraud probe'));
  await page.locator('.card', { hasText: renamed }).getByRole('button', { name: /^Suspend$/ }).first().click();
  await page.waitForTimeout(1400);
  const afterSuspend = await mainText(page);
  expect(afterSuspend).toMatch(/suspended/i);
  expect(afterSuspend).toMatch(/Suspended/);

  page.once('dialog', (d) => d.accept('Probe cleared'));
  await page.locator('.card', { hasText: renamed }).getByRole('button', { name: /^Reinstate$/ }).first().click();
  await page.waitForTimeout(1400);
  expect(await mainText(page)).toMatch(/reinstated/i);

  const cardCountBefore = await page.locator('.card', { hasText: renamed }).count();
  await page.locator('.card', { hasText: renamed }).getByRole('button', { name: /^Delete$/ }).first().click();
  await page.waitForTimeout(1400);
  // Assert on the row, not the notice (the notice quotes the deleted name).
  expect(await page.locator('.card', { hasText: renamed }).count()).toBe(cardCountBefore - 1);
  expect(await mainText(page)).toMatch(/deleted/i);
});

test('refuses to hard-delete a user who owns orders / settlements', async ({ page, guard }) => {
  guard.allowApiFailure({ path: '/users/u_buyer1', status: 409, because: 'referenced buyer' });
  await page.getByPlaceholder(/Search name, email or phone/i).fill('Abebe');
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Delete$/ }).first().click();
  await page.waitForTimeout(1200);
  const body = await mainText(page);
  expect(body).toMatch(/Suspend the account instead/);
  expect(body).toMatch(/Suspending keeps every order/);
});

test('sellers tab renders with tiers and listing counts', async ({ page }) => {
  await page.getByRole('button', { name: /^Sellers$/ }).click();
  await page.waitForTimeout(1000);
  const body = await mainText(page);
  expect(body).toMatch(/Selam Tech/);
  expect(body).toMatch(/\benterprise\b|\bbusiness\b|\btrusted\b/);
  expect(body).toMatch(/\d+ listings/);
});

test('creates, renames, suspends, reinstates, then deletes a seller', async ({ page }) => {
  await page.getByRole('button', { name: /^Sellers$/ }).click();
  await page.waitForTimeout(1000);

  const orgName = unique('Browser Probe Org');
  await page.getByRole('button', { name: /New organisation/i }).click();
  await page.getByLabel(/^Name/).first().fill(orgName);
  await page.getByLabel(/^City/).first().fill('Adama');
  await page.getByRole('button', { name: /Create organisation/i }).click();
  await page.waitForTimeout(1300);
  expect(await mainText(page)).toContain(orgName);

  await page.getByPlaceholder(/Search seller or city/i).fill(orgName);
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Edit$/ }).first().click();
  await page.getByLabel(/^Name/).first().fill(`${orgName} Renamed`);
  await page.getByRole('button', { name: /Save changes/i }).click();
  await page.waitForTimeout(1300);
  expect(await mainText(page)).toContain(`${orgName} Renamed`);

  page.once('dialog', (d) => d.accept('Probe: pending documents'));
  await page.getByRole('button', { name: /^Suspend$/ }).first().click();
  await page.waitForTimeout(1400);
  expect(await mainText(page)).toMatch(/suspended/i);

  page.once('dialog', (d) => d.accept('Probe cleared'));
  await page.locator('.card', { hasText: `${orgName} Renamed` }).getByRole('button', { name: /^Reinstate$/ }).first().click();
  await page.waitForTimeout(1400);
  expect(await mainText(page)).toMatch(/reinstated/i);

  await page.locator('.card', { hasText: orgName }).getByRole('button', { name: /^Delete$/ }).first().click();
  await page.waitForTimeout(1400);
  // The success notice quotes the (renamed) name, so assert on the row count.
  const orgCards = await page.locator('.card', { hasText: orgName }).count();
  expect(orgCards).toBe(0);
  expect(await mainText(page)).toMatch(/deleted/i);
});

test('refuses to hard-delete a seller with orders in flight', async ({ page, guard }) => {
  guard.allowApiFailure({ path: '/sellers/org_selam', status: 409, because: 'referenced seller' });
  await page.getByRole('button', { name: /^Sellers$/ }).click();
  await page.waitForTimeout(1000);
  await page.getByPlaceholder(/Search seller or city/i).fill('Selam Tech');
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Delete$/ }).first().click();
  await page.waitForTimeout(1200);
  expect(await mainText(page)).toMatch(/Suspend/i);
});

test('categories tab renders roots and nested children', async ({ page }) => {
  await page.getByRole('button', { name: /^Categories$/ }).click();
  await page.waitForTimeout(1000);
  const body = await mainText(page);
  expect(body).toMatch(/Electronics/);
  expect(body).toMatch(/Mobile Phones/);
});

test('creates and deletes a category', async ({ page }) => {
  await page.getByRole('button', { name: /^Categories$/ }).click();
  await page.waitForTimeout(1000);

  const catName = unique('Browser Probe Cat');
  await page.getByRole('button', { name: /New category/i }).click();
  await page.waitForTimeout(300);
  // "Name" is the first labelled field (next is "Name (Amharic)").
  await page.getByLabel(/Name/).first().fill(catName);
  await page.getByRole('button', { name: /Create category/i }).click();
  await page.waitForTimeout(1300);
  expect(await mainText(page)).toContain(catName);

  const card = page.locator('.card', { hasText: catName }).first();
  await card.getByRole('button', { name: /^Delete$/ }).click();
  await page.waitForTimeout(1300);
  expect(await page.locator('.card', { hasText: catName }).count()).toBe(0);
});