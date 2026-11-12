import { test, expect, ACCOUNTS, DEMO_PASSWORD, type AccountKey } from './fixtures';

/**
 * Authorization regression suite.
 *
 * Every case here is a cross-tenant attempt: a signed-in member of one role
 * trying to read or write a record belonging to a different org or account.
 * These are the tests that must exist before a database sits underneath the
 * handlers, because once these reads become `WHERE id = $1` the bug is a
 * persistent data leak rather than a bug in a demo's memory.
 *
 * The suite talks to the API directly through `page.request`, so it exercises
 * the real cookie, the real role gate and the real tenancy checks — the browser
 * UI is not involved because the guarantee being tested is server-side.
 */

const API = '/api';

/** Sign in and return an authenticated request context bound to the cookie. */
async function authed(page: import('@playwright/test').Page, who: AccountKey) {
  const res = await page.request.post(`${API}/session/login`, {
    data: { email: ACCOUNTS[who], password: DEMO_PASSWORD },
  });
  expect(res.ok(), `sign-in failed for ${ACCOUNTS[who]}: ${res.status()}`).toBeTruthy();
  return page.request;
}

/** Resolve an id for a live, in-stock offer by walking the public catalogue. */
async function liveOfferId(page: import('@playwright/test').Page): Promise<string> {
  const { items } = (await (await page.request.get(`${API}/search?pageSize=6`)).json()) as { items: { id: string }[] };
  for (const p of items) {
    const detail = (await (await page.request.get(`${API}/products/${p.id}`)).json()) as { offers: { id: string; stock: number; status: string }[] };
    const offer = detail.offers.find((o) => o.status === 'live' && o.stock > 0);
    if (offer) return offer.id;
  }
  throw new Error('no live in-stock offer in the seeded catalogue');
}

/** Resolve a product id for the favourites tests. */
async function anyProductId(page: import('@playwright/test').Page): Promise<string> {
  const { items } = (await (await page.request.get(`${API}/search?pageSize=1`)).json()) as { items: { id: string }[] };
  if (!items[0]) throw new Error('no products in the seeded catalogue');
  return items[0].id;
}

/**
 * Put one line in the signed-in buyer's basket and return its default address.
 *
 * Checkout empties the basket, so a test that checks out must not depend on the
 * seeded basket still being there: the suite runs against one process with one
 * shared in-memory store, so whichever checkout test runs first consumes it and
 * every later one gets `empty_cart`. Seeding explicitly also means each test
 * stands on its own rather than on the order the runner happens to pick.
 */
async function basketReady(page: import('@playwright/test').Page): Promise<{ addressId: string }> {
  const { items } = (await (await page.request.get(`${API}/addresses`)).json()) as { items: { id: string; isDefault?: boolean }[] };
  const address = items.find((a) => a.isDefault) ?? items[0];
  expect(address, 'seeded buyer must have an address').toBeTruthy();
  const offerId = await liveOfferId(page);
  const added = await page.request.post(`${API}/cart`, { data: { offerId, qty: 1 } });
  expect(added.ok(), `could not seed the basket: ${added.status()}`).toBeTruthy();
  return { addressId: address.id };
}

test.describe('cross-tenant access is refused', () => {
  test('a seller cannot read another seller\'s listing', async ({ page }) => {
    await authed(page, 'admin');
    // Find a listing that belongs to somebody other than Selam Tech.
    const dir = await (await page.request.get(`${API}/admin/directory/sellers`)).json();
    const other = (dir.items as { id: string; name: string }[]).find((o) => o.id !== 'org_selam')!;

    const asAdmin = await page.request.get(`${API}/seller/listings?sellerId=${other.id}`);
    expect(asAdmin.ok()).toBeTruthy();
    const victimOffer = (await asAdmin.json() as { items: { id: string }[] }).items[0];
    expect(victimOffer, `expected ${other.name} to have a listing`).toBeTruthy();

    await page.request.post(`${API}/session/logout`);
    await authed(page, 'seller'); // org_selam

    const res = await page.request.get(`${API}/seller/listings/${victimOffer.id}`);
    expect(res.status()).toBe(403);
  });

  test('a seller cannot rewrite a competitor\'s listing', async ({ page }) => {
    await authed(page, 'admin');
    const asAdmin = await page.request.get(`${API}/seller/listings?sellerId=org_habesha_home`);
    const victim = (await asAdmin.json() as { items: { id: string; price: number; status: string }[] }).items[0];
    expect(victim).toBeTruthy();

    await page.request.post(`${API}/session/logout`);
    await authed(page, 'seller');

    const res = await page.request.patch(`${API}/seller/listings/${victim.id}`, {
      data: { price: 100, status: 'live' },
    });
    expect(res.status()).toBe(403);

    // And the victim's record is untouched.
    await page.request.post(`${API}/session/logout`);
    await authed(page, 'admin');
    const after = await (await page.request.get(`${API}/seller/listings?sellerId=org_habesha_home`)).json();
    const same = (after.items as { id: string; price: number; status: string }[]).find((o) => o.id === victim.id)!;
    expect(same.price).toBe(victim.price);
    expect(same.status).toBe(victim.status);
  });

  test('a listing cannot be mass-assigned past its own fields', async ({ page }) => {
    await authed(page, 'seller');
    const mine = (await (await page.request.get(`${API}/seller/listings`)).json()) as { items: { id: string; status: string }[] };
    const target = mine.items.find((o) => o.status === 'live') ?? mine.items[0];
    expect(target).toBeTruthy();

    // `sellerId` reassignment and a self-approved `status` change must both be
    // refused: the first would hand a competitor's catalogue to the caller, the
    // second would bypass trust and safety review.
    const hijack = await page.request.patch(`${API}/seller/listings/${target.id}`, {
      data: { sellerId: 'org_habesha_home' },
    });
    expect(hijack.ok()).toBeTruthy();
    const afterHijack = (await (await page.request.get(`${API}/seller/listings`)).json()) as { items: { id: string; sellerId: string }[] };
    const still = afterHijack.items.find((o) => o.id === target.id);
    expect(still, 'the listing must still be in the seller\'s own list').toBeTruthy();

    const promo = await page.request.patch(`${API}/seller/listings/${target.id}`, {
      data: { status: 'live', price: 999 },
    });
    expect(promo.ok()).toBeTruthy();
    const stillLive = (await (await page.request.get(`${API}/seller/listings`)).json()) as { items: { id: string; price: number }[] };
    const unchanged = stillLive.items.find((o) => o.id === target.id)!;
    // Price is on the allowlist, so it does change; status is not, so it does not.
    expect(unchanged.price).toBe(999);
  });

  test('a seller cannot pause a competitor\'s listing', async ({ page }) => {
    await authed(page, 'admin');
    const asAdmin = await page.request.get(`${API}/seller/listings?sellerId=org_addis`);
    const victim = (await asAdmin.json() as { items: { id: string; status: string }[] }).items[0];
    expect(victim).toBeTruthy();

    await page.request.post(`${API}/session/logout`);
    await authed(page, 'seller');
    const res = await page.request.delete(`${API}/seller/listings/${victim.id}`);
    expect(res.status()).toBe(403);
  });

  test('a seller cannot adjust a competitor\'s stock', async ({ page }) => {
    await authed(page, 'admin');
    const asAdmin = await page.request.get(`${API}/seller/listings?sellerId=org_bulkmart`);
    const victim = (await asAdmin.json() as { items: { id: string; stock: number }[] }).items[0];
    expect(victim).toBeTruthy();

    await page.request.post(`${API}/session/logout`);
    await authed(page, 'seller');
    const res = await page.request.post(`${API}/seller/inventory/${victim.id}/adjust`, {
      data: { delta: 500, reason: 'not my order' },
    });
    expect(res.status()).toBe(403);

    await page.request.post(`${API}/session/logout`);
    await authed(page, 'admin');
    const after = await (await page.request.get(`${API}/seller/listings?sellerId=org_bulkmart`)).json();
    const same = (after.items as { id: string; stock: number }[]).find((o) => o.id === victim.id)!;
    expect(same.stock).toBe(victim.stock);
  });

  test('a seller cannot read another seller\'s settlement or ledger lines', async ({ page }) => {
    await authed(page, 'admin');
    const finance = await (await page.request.get(`${API}/admin/finance`)).json();
    const settlements = (finance.settlements ?? []) as { id: string; sellerId: string }[];
    const foreign = settlements.find((s) => s.sellerId !== 'org_selam');
    expect(foreign, 'expected a settlement owned by another seller').toBeTruthy();

    await page.request.post(`${API}/session/logout`);
    await authed(page, 'seller');
    const res = await page.request.get(`${API}/seller/payouts/${foreign!.id}`);
    expect(res.status()).toBe(403);
  });

  test('a seller cannot change their own trust tier or publish state', async ({ page }) => {
    await authed(page, 'seller');
    // Compare against what the seller already is, rather than an absolute value:
    // this seller is seeded as `enterprise`, so asserting "not enterprise" would
    // test the seed instead of the authorization rule. What matters is that an
    // escalation attempt moves nothing.
    const before = (await (await page.request.get(`${API}/seller/store`)).json()) as {
      org: { tier: string; published: boolean; trustScore: number; name: string };
    };
    const res = await page.request.patch(`${API}/seller/store`, {
      data: { tier: 'none', published: false, trustScore: 99, name: 'Selam Tech Trading' },
    });
    expect(res.ok()).toBeTruthy();
    const { org } = (await res.json()) as { org: { tier: string; published: boolean; trustScore: number; name: string } };
    expect(org.tier, 'tier is assigned by verification, not by the seller').toBe(before.org.tier);
    expect(org.trustScore, 'trust score is computed, never self-assigned').toBe(before.org.trustScore);
    expect(org.trustScore).toBeLessThan(99);
    expect(org.published, 'publish state is set by verification review').toBe(before.org.published);
    // The editable field alongside them still lands, so this is a field-level
    // allowlist rather than the request being rejected wholesale.
    expect(org.name).toBe('Selam Tech Trading');
  });

  test('a seller cannot run pricing analysis on a competitor\'s offer', async ({ page }) => {
    await authed(page, 'admin');
    const asAdmin = await page.request.get(`${API}/seller/listings?sellerId=org_glow`);
    const victim = (await asAdmin.json() as { items: { id: string }[] }).items[0];
    expect(victim).toBeTruthy();

    await page.request.post(`${API}/session/logout`);
    await authed(page, 'seller');
    const res = await page.request.post(`${API}/seller/ai/copilot`, {
      data: { task: 'pricing', input: 'price check', offerId: victim.id },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe('b2b desk is per-organisation', () => {
  // Seeded org split: org_lemlem owns rfq_1/3/5/6, org_habesha owns rfq_2/4.
  // `businessBuyer` is u_b2b2 → org_habesha, so the lemlem RFQs are the
  // cross-tenant attempts.
  const LEMLEM_RFQS = ['rfq_1', 'rfq_3', 'rfq_5', 'rfq_6'];

  test('a buyer only sees its own org\'s RFQs in the list', async ({ page }) => {
    await authed(page, 'businessBuyer');
    const { items } = (await (await page.request.get(`${API}/b2b/rfqs`)).json()) as { items: { id: string; buyerOrgId: string }[] };
    expect(items.length).toBeGreaterThan(0);
    for (const r of items) expect(r.buyerOrgId).toBe('org_habesha');
    expect(LEMLEM_RFQS.some((id) => items.some((r) => r.id === id))).toBeFalsy();
  });

  test('a buyer cannot read another org\'s RFQ by id', async ({ page }) => {
    await authed(page, 'businessBuyer');
    for (const id of LEMLEM_RFQS) {
      const res = await page.request.get(`${API}/b2b/rfqs/${id}`);
      expect([403, 404], `RFQ ${id} owned by org_lemlem was served to org_habesha`).toContain(res.status());
    }
    // Its own RFQs still open, so the refusal above is tenancy and not a
    // blanket 403 from a broken route.
    const own = await page.request.get(`${API}/b2b/rfqs/rfq_2`);
    expect(own.ok()).toBeTruthy();
  });

  test('a buyer cannot award another org\'s RFQ', async ({ page }) => {
    await authed(page, 'businessBuyer');
    // qt_2 and qt_4 quote on rfq_1, which belongs to org_lemlem. Awarding
    // either would issue a PO and draw down the wrong org's credit line.
    for (const id of ['qt_2', 'qt_4']) {
      const res = await page.request.post(`${API}/b2b/quotations/${id}/accept`);
      expect([403, 404], `quotation ${id} was awardable by the wrong org`).toContain(res.status());
    }
  });

  test('a buyer cannot mark another org\'s invoice paid', async ({ page }) => {
    await authed(page, 'businessBuyer'); // org_habesha
    // inv_1 and inv_2 are org_lemlem's. Settling one would move money out of
    // the platform against goods this org never ordered.
    for (const id of ['inv_1', 'inv_2']) {
      const res = await page.request.post(`${API}/b2b/invoices/${id}/pay`);
      expect(res.status(), `invoice ${id} owned by org_lemlem was payable by org_habesha`).toBe(403);
    }

    // The refusal must not have drawn down this org's own credit line.
    const before = (await (await page.request.get(`${API}/b2b/credit`)).json()) as { credit: { used: number; ordersSettled: number } };
    await page.request.post(`${API}/b2b/invoices/inv_2/pay`);
    const after = (await (await page.request.get(`${API}/b2b/credit`)).json()) as { credit: { used: number; ordersSettled: number } };
    expect(after.credit.used).toBe(before.credit.used);
    expect(after.credit.ordersSettled).toBe(before.credit.ordersSettled);
  });

  test('a buyer cannot read or receive another org\'s purchase order', async ({ page }) => {
    await authed(page, 'businessBuyer');
    const mine = (await (await page.request.get(`${API}/b2b/pos`)).json()) as { items: { id: string }[] };
    const myIds = new Set(mine.items.map((p) => p.id));
    expect(myIds.size).toBeGreaterThan(0);

    // po_1/po_2/po_4 are org_lemlem's; po_3 is ours. Receiving a foreign PO
    // confirms goods arrived and unlocks invoice payment — a real forgery.
    for (const id of ['po_1', 'po_2', 'po_4']) {
      const read = await page.request.get(`${API}/b2b/pos/${id}`);
      expect(read.status(), `purchase order ${id} was readable by another org`).toBe(403);

      const receive = await page.request.post(`${API}/b2b/pos/${id}/receive`, { data: { note: 'not mine' } });
      expect(receive.status(), `purchase order ${id} could be received by another org`).toBe(403);
    }

    // Our own PO still opens, so the refusals above are tenancy and not a
    // route that 403s for everyone.
    const own = await page.request.get(`${API}/b2b/pos/po_3`);
    expect(own.ok()).toBeTruthy();
  });

  test('a buyer cannot counter another org\'s quotation', async ({ page }) => {
    await authed(page, 'businessBuyer');
    // qt_1..qt_5 hang off org_lemlem's RFQs, so org_habesha's desk has no
    // standing to negotiate them. Countering hands the desk a new round of
    // prices it would then be able to award.
    for (const id of ['qt_1', 'qt_2', 'qt_3', 'qt_4', 'qt_5']) {
      const res = await page.request.post(`${API}/b2b/quotations/${id}/counter`, {
        data: { proposedTotal: 1000, message: 'not my deal' },
      });
      expect([403, 404], `quotation ${id} could be countered by the wrong org`).toContain(res.status());
    }
  });
});

test.describe('delivery is scoped to the assigned agent', () => {
  test('an agent cannot read another agent\'s route', async ({ page }) => {
    await authed(page, 'agent');
    const mine = (await (await page.request.get(`${API}/agent/routes`)).json()) as { items: { id: string; agentId: string }[] };
    expect(mine.items.length).toBeGreaterThan(0);
    const myIds = new Set(mine.items.map((r) => r.id));

    // The four zones alternate between u_agent1 and u_agent2, so the other
    // agent's rounds exist. Every route either opens or is refused — a 200 on
    // somebody else's round is the failure.
    const candidates = ['rt_1', 'rt_2', 'rt_3', 'rt_4', 'rt_prev'];
    let refusals = 0;
    for (const id of candidates) {
      const res = await page.request.get(`${API}/agent/routes/${id}`);
      if (res.status() === 404) continue;
      if (res.status() === 403) {
        refusals += 1;
        continue;
      }
      expect(myIds.has(id), `route ${id} was readable by an agent it is not assigned to`).toBeTruthy();
    }
    expect(refusals, 'expected at least one route belonging to the other agent').toBeGreaterThan(0);
  });

  test('an agent cannot read another agent\'s stop, including buyer contact details', async ({ page }) => {
    await authed(page, 'agent');
    const mine = (await (await page.request.get(`${API}/agent/routes`)).json()) as { items: { stops: { shipmentId: string }[] }[] };
    const myStops = new Set(mine.items.flatMap((r) => r.stops.map((s) => s.shipmentId)));
    expect(myStops.size).toBeGreaterThan(0);

    // Probe shipments that are not on our round. Any 200 means a leak: the
    // payload carries the buyer's name, phone number and street address.
    let refusals = 0;
    for (let i = 1; i <= 20; i += 1) {
      const id = `sh_${String(i).padStart(4, '0')}`;
      if (myStops.has(id)) continue;
      const res = await page.request.get(`${API}/agent/stops/${id}`);
      expect(res.status(), `stop ${id} from another round was served`).toBe(404);
      refusals += 1;
    }
    expect(refusals, 'expected stops outside this agent\'s round').toBeGreaterThan(0);
  });

  test('an agent cannot deliver or fail a stop on someone else\'s round', async ({ page }) => {
    await authed(page, 'agent');
    const mine = (await (await page.request.get(`${API}/agent/routes`)).json()) as { items: { stops: { shipmentId: string }[] }[] };
    const myStops = new Set(mine.items.flatMap((r) => r.stops.map((s) => s.shipmentId)));

    let refusals = 0;
    for (let i = 1; i <= 20; i += 1) {
      const id = `sh_${String(i).padStart(4, '0')}`;
      if (myStops.has(id)) continue;
      for (const verb of ['deliver', 'fail']) {
        const res = await page.request.post(`${API}/agent/stops/${id}/${verb}`, {
          data: verb === 'deliver' ? { podKind: 'photo' } : { reason: 'not my round' },
        });
        expect(res.status(), `${verb} succeeded on foreign stop ${id}`).toBe(404);
      }
      refusals += 1;
    }
    expect(refusals).toBeGreaterThan(0);
  });
});

test.describe('baskets and saved items are per-account', () => {
  test('two buyers do not share a basket', async ({ page }) => {
    await authed(page, 'buyer');
    const start = (await (await page.request.get(`${API}/cart`)).json()) as { lines: { offerId: string }[] };

    await page.request.post(`${API}/session/logout`);
    await authed(page, 'admin');
    const offerId = await liveOfferId(page);
    expect(offerId).toBeTruthy();

    await page.request.post(`${API}/session/logout`);
    await authed(page, 'businessBuyer');
    const empty = (await (await page.request.get(`${API}/cart`)).json()) as { lines: { offerId: string }[] };
    // The seeded basket belongs to the demo buyer; nobody else may see it.
    expect(empty.lines.map((l) => l.offerId)).not.toEqual(start.lines.map((l) => l.offerId));

    await page.request.post(`${API}/cart`, { data: { offerId, qty: 1 } });

    await page.request.post(`${API}/session/logout`);
    await authed(page, 'buyer');
    const after = (await (await page.request.get(`${API}/cart`)).json()) as { lines: { offerId: string }[] };
    expect(
      after.lines.some((l) => l.offerId === offerId),
      'an item added by another account appeared in this buyer\'s basket',
    ).toBeFalsy();
  });

  test('one buyer\'s basket edit does not rewrite another\'s', async ({ page }) => {
    await authed(page, 'buyer');
    const mine = (await (await page.request.get(`${API}/cart`)).json()) as { lines: { offerId: string; qty: number }[] };
    const target = mine.lines[0];
    expect(target, 'expected a seeded basket line').toBeTruthy();

    // Aim a PATCH at a line that is only in this basket. If the cart were
    // global, this would change the quantity on the shared row.
    await page.request.patch(`${API}/cart/${target.offerId}`, { data: { qty: 3 } });

    await page.request.post(`${API}/session/logout`);
    await authed(page, 'businessBuyer');
    const theirs = (await (await page.request.get(`${API}/cart`)).json()) as { lines: { offerId: string; qty: number }[] };
    const leaked = theirs.lines.find((l) => l.offerId === target.offerId);
    expect(leaked, 'another account\'s basket line appeared here').toBeFalsy();
  });

  test('favourites are not shared between accounts', async ({ page }) => {
    await authed(page, 'buyer');
    const mine = (await (await page.request.get(`${API}/favorites`)).json()) as { items: { id: string }[] };

    await page.request.post(`${API}/session/logout`);
    await authed(page, 'admin');
    const productId = await anyProductId(page);
    expect(productId).toBeTruthy();

    await page.request.post(`${API}/session/logout`);
    await authed(page, 'businessBuyer');
    await page.request.post(`${API}/favorites/${productId}`);

    await page.request.post(`${API}/session/logout`);
    await authed(page, 'buyer');
    const after = (await (await page.request.get(`${API}/favorites`)).json()) as { items: { id: string }[] };
    expect(after.items.map((i) => i.id)).toEqual(mine.items.map((i) => i.id));
  });
});

test.describe('payment confirmation requires a real code', () => {
  test('an arbitrary non-empty string does not capture a payment', async ({ page }) => {
    await authed(page, 'buyer');
    // Place an order with mobile money so it lands in pending_payment.
    const { addressId } = await basketReady(page);

    const placed = await page.request.post(`${API}/checkout`, {
      data: { addressId, paymentMethod: 'telebirr', idempotencyKey: `otp-${Date.now()}` },
    });
    expect(placed.status(), `checkout should place an order: ${JSON.stringify(placed)}`).toBe(201);
    const { order } = (await placed.json()) as { order: { code: string; status: string } };
    expect(order.status).toBe('pending_payment');

    // The first call issues a code and does not capture.
    const issued = await page.request.post(`${API}/checkout/payment`, { data: { orderCode: order.code, method: 'telebirr' } });
    expect(issued.ok()).toBeTruthy();
    const issuedBody = (await issued.json()) as { requiresOtp: boolean; order: { paymentState: string } };
    expect(issuedBody.requiresOtp).toBeTruthy();
    expect(issuedBody.order.paymentState).not.toBe('captured');

    // A guessed code must be refused and must leave the order uncaptured.
    const wrong = await page.request.post(`${API}/checkout/payment`, {
      data: { orderCode: order.code, method: 'telebirr', otp: '000000' },
    });
    expect(wrong.status()).toBe(422);
    const wrongBody = (await wrong.json()) as { order: { paymentState: string } };
    expect(wrongBody.order.paymentState).not.toBe('captured');
  });

  test('the issued code captures the payment exactly once', async ({ page }) => {
    await authed(page, 'buyer');
    const { addressId } = await basketReady(page);
    const placed = await page.request.post(`${API}/checkout`, {
      data: { addressId, paymentMethod: 'telebirr', idempotencyKey: `otp-ok-${Date.now()}` },
    });
    const { order } = (await placed.json()) as { order: { code: string } };

    const issued = await page.request.post(`${API}/checkout/payment`, { data: { orderCode: order.code, method: 'telebirr' } });
    const body = (await issued.json()) as { sandboxCode?: string };
    const code = body.sandboxCode;
    expect(code, 'HM_DEV_OTP=fixed should return a sandbox code').toBeTruthy();

    const first = await page.request.post(`${API}/checkout/payment`, {
      data: { orderCode: order.code, method: 'telebirr', otp: code },
    });
    expect(first.ok()).toBeTruthy();
    expect(((await first.json()) as { order: { paymentState: string } }).order.paymentState).toBe('captured');

    // Replaying the same code must not capture again.
    const replay = await page.request.post(`${API}/checkout/payment`, {
      data: { orderCode: order.code, method: 'telebirr', otp: code },
    });
    expect(replay.status()).toBeGreaterThanOrEqual(400);
  });

  test('a code issued for one order cannot capture another', async ({ page }) => {
    await authed(page, 'buyer');
    const { addressId } = await basketReady(page);

    // Two separate orders, so the basket has to be refilled between them: the
    // first checkout empties it.
    const first = await page.request.post(`${API}/checkout`, {
      data: { addressId, paymentMethod: 'telebirr', idempotencyKey: `otp-a-${Date.now()}` },
    });
    expect(first.status()).toBe(201);
    await basketReady(page);
    const second = await page.request.post(`${API}/checkout`, {
      data: { addressId, paymentMethod: 'telebirr', idempotencyKey: `otp-b-${Date.now()}` },
    });
    expect(second.status(), 'second checkout needs its own basket line').toBe(201);
    const a = (await first.json()) as { order: { code: string } };
    const b = (await second.json()) as { order: { code: string } };

    const issuedA = (await (
      await page.request.post(`${API}/checkout/payment`, { data: { orderCode: a.order.code, method: 'telebirr' } })
    ).json()) as { sandboxCode: string };

    const cross = await page.request.post(`${API}/checkout/payment`, {
      data: { orderCode: b.order.code, method: 'telebirr', otp: issuedA.sandboxCode },
    });
    expect(cross.status()).toBe(422);
  });
});

test.describe('role gates still hold', () => {
  test('a buyer cannot reach the seller, b2b, agent or admin surfaces', async ({ page }) => {
    await authed(page, 'buyer');
    for (const path of ['/api/seller/dashboard', '/api/b2b/dashboard', '/api/agent/today', '/api/admin/finance']) {
      const res = await page.request.get(path);
      expect(res.status(), `${path} was reachable by a buyer`).toBe(403);
    }
  });

  test('a seller cannot reach the admin surface', async ({ page }) => {
    await authed(page, 'seller');
    const res = await page.request.get('/api/admin/directory/sellers');
    expect(res.status()).toBe(403);
  });

  test('an anonymous caller cannot reach a protected surface', async ({ page }) => {
    for (const path of ['/api/seller/dashboard', '/api/admin/finance', '/api/cart', '/api/favorites']) {
      const res = await page.request.get(path);
      expect(res.status(), `${path} was reachable without a session`).toBe(401);
    }
  });
});

test.describe('hardening', () => {
  test('responses carry the baseline security headers', async ({ page }) => {
    const res = await page.request.get(`${API}/health`);
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['x-frame-options']).toBe('DENY');
    expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers()['referrer-policy']).toBeTruthy();
  });

  test('repeated failed sign-ins are rate limited', async ({ page }) => {
    let limited = false;
    for (let i = 0; i < 14; i += 1) {
      const res = await page.request.post(`${API}/session/login`, {
        data: { email: 'bruteforce@nowhere.et', password: `guess-${i}` },
      });
      if (res.status() === 429) {
        limited = true;
        break;
      }
    }
    expect(limited, 'online password guessing was never throttled').toBeTruthy();
  });

  test('a cross-origin state-changing request is refused', async ({ page }) => {
    await authed(page, 'buyer');
    const res = await page.request.post(`${API}/cart`, {
      headers: { origin: 'https://evil.example.com' },
      data: { offerId: 'of_0001', qty: 1 },
    });
    expect(res.status()).toBe(403);
  });

  test('addresses belong to the account that saved them', async ({ page }) => {
    await authed(page, 'buyer');
    const mine = (await (await page.request.get(`${API}/addresses`)).json()) as { items: { id: string }[] };
    const expected = mine.items.length;

    const created = await page.request.post(`${API}/addresses`, {
      data: { label: 'Test', recipient: 'Abebe Kebede', phone: '+251911000111', city: 'Addis Ababa' },
    });
    expect(created.status()).toBe(201);
    const after = (await (await page.request.get(`${API}/addresses`)).json()) as { items: { id: string }[] };
    expect(after.items.length).toBe(expected + 1);

    await page.request.post(`${API}/session/logout`);
    await authed(page, 'businessBuyer');
    const theirs = (await (await page.request.get(`${API}/addresses`)).json()) as { items: { id: string }[] };
    expect(theirs.items.some((a) => a.id === after.items[after.items.length - 1]!.id)).toBeFalsy();
  });

  test('an address cannot be mass-assigned to another account', async ({ page }) => {
    await authed(page, 'buyer');
    const res = await page.request.post(`${API}/addresses`, {
      data: {
        label: 'Hijack',
        recipient: 'Test',
        phone: '+251911000111',
        city: 'Addis Ababa',
        userId: 'u_buyer2',
        id: 'addr_forged',
      },
    });
    expect(res.status()).toBe(201);
    const { address } = (await res.json()) as { address: { id: string; userId?: string } };
    expect(address.id).not.toBe('addr_forged');
    expect(address.userId).toBe('u_buyer1');
  });

  test('a buyer cannot check out to another account\'s address', async ({ page }) => {
    await authed(page, 'businessBuyer');
    const res = await page.request.post(`${API}/checkout`, {
      data: { addressId: 'addr_1', paymentMethod: 'telebirr', idempotencyKey: `x-${Date.now()}` },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).error).toBe('address_not_yours');
  });
});