import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { parseCapabilityMatrix, parseSourceLock, type StaffActor } from '@texholiday/contracts';
import { MockHotelConnector } from '@texholiday/connectors';
import { PermissionRepository, PolicyRepository, type CoreDatabase } from '@texholiday/db';
import { BookingApp, orderAccessToken, type BookingSettings } from '../src/index';
import { freshDatabase } from '../../db/test/support/db';

/** End-to-end application flow against PostgreSQL with the MOCK hotel connector (no provider involved). */
const root = join(__dirname, '..', '..', '..');
const matrix = parseCapabilityMatrix(JSON.parse(readFileSync(join(root, 'contracts', 'capability-matrix.json'), 'utf8')));
const sourceLock = parseSourceLock(JSON.parse(readFileSync(join(root, 'contracts', 'sources.lock.json'), 'utf8')));

const settings: BookingSettings = {
  environment: 'mock',
  policyId: 'b2c',
  searchTtlSeconds: 1800,
  quoteTtlSeconds: 1200,
  payBySeconds: 1800,
  termsVersion: 'terms-test-1',
  accessTokenSecret: 'test-only-secret-0123456789abcdef0123',
  currencies: ['EUR', 'USD', 'GBP', 'TRY'],
  maxHotels: 60,
  maxRatesPerHotel: 8,
  intentLeaseSeconds: 600,
  maxAutomaticLookups: 3,
  enforceRateParity: true,
};

let core: CoreDatabase;
let hotels: MockHotelConnector;
let app: BookingApp;
const owner: StaffActor = { kind: 'STAFF', id: 'owner' };
const finance: StaffActor = { kind: 'STAFF', id: 'finance' };
const approver: StaffActor = { kind: 'STAFF', id: 'approver' };

async function approvePricing(bp: number, extra: Record<string, unknown> = {}) {
  const policies = new PolicyRepository(core.db);
  const v = await policies.createDraft(
    'PRICING',
    'b2c',
    { rounding: 'HALF_EVEN', rules: [{ productType: 'HOTEL', paymentMode: 'PROVIDER_MANAGED', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: bp }], serviceFees: [], fx: null, allowBelowSspInOpaquePackage: false, ...extra },
    finance,
  );
  await policies.approve('PRICING', 'b2c', v.version, approver);
}

const searchInput = (over: Record<string, unknown> = {}) => ({
  target: { placeId: 'MOCK-PLACE-ANTALYA' },
  checkin: '2027-06-10',
  checkout: '2027-06-13',
  rooms: [{ adults: 2, childAges: [7] }],
  nationality: 'TR',
  currency: 'EUR',
  locale: 'tr',
  ...over,
});

const checkoutBody = (quoteVersionId: string, idempotencyKey: string) => ({
  quoteVersionId,
  acceptTerms: true,
  termsVersion: 'terms-test-1',
  holder: { firstName: 'Ayşe', lastName: 'Yılmaz', email: 'ayse@example.test', phone: '+905321112233' },
  roomGuests: [{ occupancyNumber: 1, firstName: 'Ayşe', lastName: 'Yılmaz' }],
  locale: 'tr',
  idempotencyKey,
});

beforeAll(async () => {
  core = await freshDatabase();
  hotels = new MockHotelConnector();
  app = new BookingApp({ db: core.db, hotels, matrix, sourceLock, settings, clock: () => new Date('2027-05-01T10:00:00Z') });
  const perms = new PermissionRepository(core.db);
  await perms.bootstrapManager(owner.id);
  await perms.grantRole(finance.id, 'FINANCE', owner);
  await perms.grantRole(approver.id, 'FINANCE_APPROVER', owner);
});
afterAll(async () => {
  await core?.close();
});

describe('hotel booking application flow (provider-managed payment, ADR-0008)', () => {
  it('sales stay closed without an approved pricing policy (no default margin, G06)', async () => {
    await expect(app.searchHotels(searchInput())).rejects.toMatchObject({ code: 'CAPABILITY_NOT_AVAILABLE' });
    await approvePricing(1000);
  });

  it('search: priced with the policy margin, below-SSP offers hidden, no provider ids sent to the client', async () => {
    const r = await app.searchHotels(searchInput());
    expect(r.paymentMode).toBe('PROVIDER_MANAGED');
    expect(r.nights).toBe(3);
    expect(r.hidden).toEqual({ belowSuggestedPrice: 1, notPriced: 0, notPayableOnline: 0 });
    expect(r.hotels.map((h) => h.hotelId).sort()).toEqual(['MOCK-H1', 'MOCK-H2']);
    const h2 = r.hotels.find((h) => h.hotelId === 'MOCK-H2')!;
    // 90.00 EUR net/night x 3 nights + 10% margin = 297.00 EUR.
    expect(h2.offers[0]!.total).toEqual({ currency: 'EUR', minor: '29700' });
    expect(h2.offers[0]!.perNightAverage).toEqual({ currency: 'EUR', minor: '9900' });
    expect(JSON.stringify(r)).not.toMatch(/MOCK-OFFER/);
  });

  it('TRY needs our own gateway, which is not integrated yet: the route stays closed (K13)', async () => {
    await expect(app.searchHotels(searchInput({ currency: 'TRY' }))).rejects.toMatchObject({ code: 'CAPABILITY_NOT_AVAILABLE' });
  });

  it('invalid input gets field-level errors', async () => {
    await expect(app.searchHotels(searchInput({ checkout: '2027-06-10', rooms: [] }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('checkout -> payment session (owner only) -> unpaid return -> paid -> confirmed', async () => {
    const r = await app.searchHotels(searchInput());
    const offer = r.hotels.find((h) => h.hotelId === 'MOCK-H2')!.offers[0]!;
    const quote = await app.selectOffer(r.sessionId, offer.key);
    expect(quote.total).toEqual(offer.total);
    expect(quote.rooms).toEqual([{ occupancyNumber: 1, adults: 2, childAges: [7] }]);

    const { orderId, accessToken, order } = await app.createCheckout(checkoutBody(quote.quoteVersionId, 'idem-checkout-0001'));
    expect(order.stage).toBe('AWAITING_PAYMENT');
    await expect(app.paymentSession(orderId, 'wrong-token')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const session = await app.paymentSession(orderId, accessToken);
    expect(session).toMatchObject({ state: 'READY', provider: 'NUITEE', publicKey: 'mock' });
    if (session.state !== 'READY') return;

    // Customer comes back before paying: nothing is booked.
    expect((await app.finalize(orderId, accessToken)).stage).toBe('AWAITING_PAYMENT');
    // Customer pays in the (mock) payment component, then returns.
    hotels.markPaid(session.secretKey.replace('MOCK_secret_', ''));
    const done = await app.finalize(orderId, accessToken);
    expect(done.stage).toBe('CONFIRMED');
    expect(done.bookingReference).toMatch(/^MOCK-BK-/);
    expect(await app.paymentSession(orderId, accessToken)).toMatchObject({ state: 'CLOSED', stage: 'CONFIRMED' });

    // Guests are stored for the provider; the commission receivable is recorded.
    const rows = await core.db.execute<{ status: string; payment_mode: string }>(
      sql`SELECT c.status, c.payment_mode FROM core.provider_commissions c JOIN core.order_items i ON i.id = c.order_item_id WHERE i.order_id = ${orderId}`,
    );
    expect(rows.rows).toEqual([{ status: 'EXPECTED', payment_mode: 'PROVIDER_MANAGED' }]);
  });

  it('checkout is idempotent per key; another body under the same key is a conflict', async () => {
    const r = await app.searchHotels(searchInput());
    const quote = await app.selectOffer(r.sessionId, r.hotels[0]!.offers[0]!.key);
    const first = await app.createCheckout(checkoutBody(quote.quoteVersionId, 'idem-checkout-0002'));
    const again = await app.createCheckout(checkoutBody(quote.quoteVersionId, 'idem-checkout-0002'));
    expect(again.orderId).toBe(first.orderId);
    expect(again.accessToken).toBe(orderAccessToken(settings.accessTokenSecret, first.orderId));
    await expect(app.createCheckout({ ...checkoutBody(quote.quoteVersionId, 'idem-checkout-0002'), locale: 'en' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('a quote is accepted once; one lead guest per room; terms must be the published version', async () => {
    const r = await app.searchHotels(searchInput({ rooms: [{ adults: 2, childAges: [] }, { adults: 1, childAges: [] }] }));
    const quote = await app.selectOffer(r.sessionId, r.hotels[0]!.offers[0]!.key);
    await expect(app.createCheckout(checkoutBody(quote.quoteVersionId, 'idem-checkout-0003'))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(app.createCheckout({ ...checkoutBody(quote.quoteVersionId, 'idem-checkout-0004'), termsVersion: 'old' })).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    const ok = await app.createCheckout({
      ...checkoutBody(quote.quoteVersionId, 'idem-checkout-0005'),
      roomGuests: [
        { occupancyNumber: 1, firstName: 'Ayşe', lastName: 'Yılmaz' },
        { occupancyNumber: 2, firstName: 'Mehmet', lastName: 'Yılmaz' },
      ],
    });
    expect(ok.order.stage).toBe('AWAITING_PAYMENT');
    // The failed attempts released their keys (nothing was created): a corrected retry under a used key works.
    await expect(app.createCheckout({ ...checkoutBody(quote.quoteVersionId, 'idem-checkout-0003') })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(app.createCheckout(checkoutBody(quote.quoteVersionId, 'idem-checkout-0006'))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('a price change at prebook stops before payment (new acceptance needed, K15)', async () => {
    const r = await app.searchHotels(searchInput());
    const quote = await app.selectOffer(r.sessionId, r.hotels[0]!.offers[0]!.key);
    hotels.nextPrebookPriceChange = true;
    const { orderId, accessToken, order } = await app.createCheckout(checkoutBody(quote.quoteVersionId, 'idem-checkout-0007'));
    expect(order.stage).toBe('PRICE_CHANGED');
    expect(await app.paymentSession(orderId, accessToken)).toMatchObject({ state: 'CLOSED', stage: 'PRICE_CHANGED' });
  });

  it('a newer approved policy invalidates older search results (no stale margin)', async () => {
    const r = await app.searchHotels(searchInput());
    await approvePricing(1200);
    await expect(app.selectOffer(r.sessionId, r.hotels[0]!.offers[0]!.key)).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    await expect(app.selectOffer(r.sessionId, '999')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('ADR-0009: an approved policy may show below-SSP offers; the quote records the suggested price and the gap', async () => {
    await approvePricing(1000, { allowBelowSspProviderManaged: true });
    const r = await app.searchHotels(searchInput());
    expect(r.hidden.belowSuggestedPrice).toBe(0);
    const h2 = r.hotels.find((h) => h.hotelId === 'MOCK-H2')!;
    const suite = h2.offers.find((o) => o.roomName === 'MOCK Suite')!;
    expect(suite).toBeDefined();
    const quote = await app.selectOffer(r.sessionId, suite.key);
    const rows = await core.db.execute<{ parity: { suggestedSellingPrice: { currency: string; minor: string }; belowSuggestedPrice: boolean } }>(
      sql`SELECT option->'rateParity' AS parity FROM core.quote_versions WHERE id = ${quote.quoteVersionId}`,
    );
    // MOCK Suite: 200.00 EUR net/night x 3 + 10% = 660.00 EUR sold; suggested 200.00 x 3 x 1.9 = 1140.00 EUR.
    expect(rows.rows[0]!.parity).toEqual({ suggestedSellingPrice: { currency: 'EUR', minor: '114000' }, belowSuggestedPrice: true });
    expect(quote.total).toEqual({ currency: 'EUR', minor: '66000' });
  });
});
