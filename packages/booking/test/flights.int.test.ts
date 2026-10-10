import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { parseCapabilityMatrix, parseSourceLock, type StaffActor } from '@texholiday/contracts';
import { MockFlightConnector, MockHotelConnector } from '@texholiday/connectors';
import { DrizzleOrderStore, PermissionRepository, PolicyRepository, type CoreDatabase } from '@texholiday/db';
import { money } from '@texholiday/pricing';
import { BookingApp, orderAccessToken, type BookingSettings, type FlightSales } from '../src/index';
import { freshDatabase } from '../../db/test/support/db';

/** Customer flight sales (P11, ADR-0012) against PostgreSQL with the MOCK flight connector (no provider involved). */
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
  currencies: ['EUR', 'TRY'],
  maxHotels: 60,
  maxRatesPerHotel: 8,
  intentLeaseSeconds: 600,
  maxAutomaticLookups: 3,
  enforceRateParity: true,
};

const NOW = new Date('2027-05-01T10:00:00Z');
let core: CoreDatabase;
let flights: MockFlightConnector;
let app: BookingApp;
let sales: FlightSales;
const owner: StaffActor = { kind: 'STAFF', id: 'owner' };
const finance: StaffActor = { kind: 'STAFF', id: 'finance' };
const ops: StaffActor = { kind: 'STAFF', id: 'ops' };

async function approvePricing(rules: Array<Record<string, unknown>>) {
  const policies = new PolicyRepository(core.db);
  const v = await policies.createDraft('PRICING', 'b2c', { rounding: 'HALF_EVEN', rules, serviceFees: [], fx: null, allowBelowSspInOpaquePackage: false }, finance);
  await policies.approve('PRICING', 'b2c', v.version, { kind: 'STAFF', id: 'approver' });
}
const rule = (productType: 'HOTEL' | 'FLIGHT', bp: number) => ({ productType, paymentMode: 'PROVIDER_MANAGED', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: bp });

const search = (over: Record<string, unknown> = {}) => ({
  origin: 'IST',
  destination: 'AYT',
  departDate: '2027-06-10',
  returnDate: '2027-06-17',
  adults: 2,
  childAges: [7],
  infantAges: [],
  cabinClass: null,
  currency: 'EUR',
  locale: 'tr',
  ...over,
});

// TEST-ONLY passengers (fictional people and document numbers).
const adult = (firstName: string, birthDate: string, number: string) => ({
  type: 'ADULT',
  firstName,
  lastName: 'Yılmaz',
  birthDate,
  gender: 'F',
  nationality: 'TR',
  document: { type: 'passport', number, issuingCountry: 'TR', expiresOn: '2031-01-01' },
});
const passengers = () => [
  adult('Ayşe', '1988-03-04', 'TEST0000001'),
  { ...adult('Mehmet', '1986-11-20', 'TEST0000002'), gender: 'M' },
  { ...adult('Can', '2019-09-01', 'TEST0000003'), type: 'CHILD', gender: 'M', document: { type: 'id_card', number: 'TEST0000004', issuingCountry: 'TR', expiresOn: '2030-05-05' } },
];
const checkoutBody = (quoteVersionId: string, idempotencyKey: string, over: Record<string, unknown> = {}) => ({
  quoteVersionId,
  acceptTerms: true,
  termsVersion: 'terms-test-1',
  contact: { firstName: 'Ayşe', lastName: 'Yılmaz', email: `${idempotencyKey}@example.test`, phoneCountryCode: '90', phoneNumber: '5321112233' },
  passengers: passengers(),
  locale: 'tr',
  idempotencyKey,
  ...over,
});

async function quoteFor(over: Record<string, unknown> = {}) {
  const r = await sales.search(search(over));
  return sales.selectOffer(r.sessionId, r.offers[0]!.key);
}

beforeAll(async () => {
  core = await freshDatabase();
  flights = new MockFlightConnector(() => NOW);
  app = new BookingApp({ db: core.db, hotels: new MockHotelConnector(), flights, matrix, sourceLock, settings, clock: () => NOW });
  sales = app.flights!;
  const perms = new PermissionRepository(core.db);
  await perms.bootstrapManager(owner.id);
  await perms.grantRole(finance.id, 'FINANCE', owner);
  await perms.grantRole('approver', 'FINANCE_APPROVER', owner);
  await perms.grantRole(ops.id, 'OPERATIONS', owner);
});
afterAll(async () => {
  await core?.close();
});

describe('customer flight sales (provider-managed payment, ADR-0012)', () => {
  it('stay closed without an approved FLIGHT pricing rule (no default markup, G06)', async () => {
    await approvePricing([rule('HOTEL', 1000)]);
    expect(await app.availableFlightCurrencies()).toEqual([]);
    await expect(sales.search(search())).rejects.toMatchObject({ code: 'CAPABILITY_NOT_AVAILABLE' });
    await approvePricing([rule('HOTEL', 1000), rule('FLIGHT', 1000)]);
    // TRY needs our own gateway (K13), not integrated yet.
    expect(await app.availableFlightCurrencies()).toEqual(['EUR']);
  });

  it('search: the markup the provider applied is checked against the approved rule; cheapest first; no provider ids', async () => {
    const r = await sales.search(search());
    expect(r.offers.length).toBe(3);
    const totals = r.offers.map((o) => BigInt(o.total.minor));
    expect([...totals].sort((a, b) => (a < b ? -1 : 1))).toEqual(totals);
    // MOCK Saver: (2 x 64.00 + 48.00) per leg, 2 legs = 352.00; +10% = 387.20.
    expect(r.offers[0]!.total).toEqual({ currency: 'EUR', minor: '38720' });
    expect(r.offers[0]!.journeys.map((j) => [j.direction, j.departure.code, j.arrival.code, j.connections])).toEqual([
      ['OUTBOUND', 'IST', 'AYT', 1],
      ['INBOUND', 'AYT', 'IST', 1],
    ]);
    expect(JSON.stringify(r)).not.toMatch(/MOCK-FOFFER|MOCK-SEG/);
    expect(await sales.searchSession(r.sessionId)).toEqual(r);

    // A markup other than the approved one (e.g. an account default) is never sold.
    const original = flights.searchRates.bind(flights);
    flights.searchRates = (c) => original({ ...c, margin: { basisPoints: 500 } });
    try {
      const other = await sales.search(search());
      expect(other.offers).toEqual([]);
      expect(other.hidden).toEqual({ notPriced: 3 });
    } finally {
      flights.searchRates = original;
    }
  });

  it('invalid searches get field-level errors', async () => {
    await expect(sales.search(search({ destination: 'IST' }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED', issues: [{ path: 'destination' }] });
    await expect(sales.search(search({ infantAges: [0, 1, 1] }))).rejects.toMatchObject({ issues: [{ path: 'infantAges' }] });
    await expect(sales.search(search({ departDate: '2027-04-01', returnDate: null }))).rejects.toMatchObject({ issues: [{ path: 'departDate' }] });
  });

  it('select: the fare is re-checked with the provider; a moved price is shown with the old one before acceptance', async () => {
    const r = await sales.search(search());
    flights.nextVerifyPriceChange = true;
    const q = await sales.selectOffer(r.sessionId, r.offers[0]!.key);
    // Fare +1.00, the approved 10% applied to the new fare.
    expect(q.total).toEqual({ currency: 'EUR', minor: '38830' });
    expect(q.priceChangedFrom).toEqual({ currency: 'EUR', minor: '38720' });
    expect(q.title).toBe('MOCK Istanbul Airport (IST) → MOCK Antalya Airport (AYT)');
    expect(q.passengers).toEqual({ adults: 2, childAges: [7], infantAges: [] });
    expect(await sales.quote(q.quoteVersionId)).toEqual(q);
    // A flight quote is not a hotel quote.
    await expect(app.quote(q.quoteVersionId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('checkout: passengers must match the searched party, ages on the travel dates, documents valid for the trip', async () => {
    const q = await quoteFor();
    await expect(sales.createCheckout(checkoutBody(q.quoteVersionId, 'flight-bad-01', { passengers: passengers().slice(0, 2) }))).rejects.toMatchObject({ issues: [{ path: 'passengers' }] });
    const tooOld = passengers();
    tooOld[2]!.birthDate = '2010-01-01';
    await expect(sales.createCheckout(checkoutBody(q.quoteVersionId, 'flight-bad-02', { passengers: tooOld }))).rejects.toMatchObject({ issues: [{ path: 'passengers.2.birthDate' }] });
    const expiring = passengers();
    expiring[0]!.document.expiresOn = '2027-06-15';
    await expect(sales.createCheckout(checkoutBody(q.quoteVersionId, 'flight-bad-03', { passengers: expiring }))).rejects.toMatchObject({ issues: [{ path: 'passengers.0.document.expiresOn' }] });
    const noDoc = passengers().map(({ document: _d, ...p }) => p);
    await expect(sales.createCheckout(checkoutBody(q.quoteVersionId, 'flight-bad-04', { passengers: noDoc }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // Nothing was accepted or created: the same quote can still be used.
    const ok = await sales.createCheckout(checkoutBody(q.quoteVersionId, 'flight-ok-00'));
    expect(ok.order.stage).toBe('AWAITING_PAYMENT');
  });

  it('checkout -> prebook with the documents (never stored) -> pay -> return -> PNR (issuing) -> ticket -> confirmed', async () => {
    const q = await quoteFor();
    const { orderId, accessToken, order } = await sales.createCheckout(checkoutBody(q.quoteVersionId, 'flight-flow-01'));
    expect(accessToken).toBe(orderAccessToken(settings.accessTokenSecret, orderId));
    expect(order.stage).toBe('AWAITING_PAYMENT');
    expect(order.quote.product).toBe('FLIGHT');

    // The provider got the documents at prebook...
    const store = new DrizzleOrderStore(core.db);
    const agg = await store.load(orderId);
    const prebookRef = agg.items[0]!.booking.prebookRef!;
    expect(flights.prebookPassengers(prebookRef)!.map((p) => p.document?.number)).toEqual(['TEST0000001', 'TEST0000002', 'TEST0000004']);
    // ...we keep names and types only: no document, birth date or nationality anywhere in the database.
    const guests = await core.db.execute<Record<string, unknown>>(sql`SELECT g.* FROM core.order_item_guests g JOIN core.order_items i ON i.id = g.order_item_id WHERE i.order_id = ${orderId}`);
    expect(guests.rows[0]!.passengers).toEqual([
      { type: 'ADULT', firstName: 'Ayşe', lastName: 'Yılmaz' },
      { type: 'ADULT', firstName: 'Mehmet', lastName: 'Yılmaz' },
      { type: 'CHILD', firstName: 'Can', lastName: 'Yılmaz' },
    ]);
    expect(guests.rows[0]!.holder).toMatchObject({ email: 'flight-flow-01@example.test', phone: '+905321112233', phoneCountryCode: '90' });
    const everything = await core.db.execute<{ t: string }>(sql`
      SELECT string_agg(x::text, ' ') AS t FROM (
        SELECT row_to_json(g)::text AS x FROM core.order_item_guests g UNION ALL
        SELECT row_to_json(k)::text FROM core.idempotency_keys k UNION ALL
        SELECT row_to_json(a)::text FROM core.audit_logs a UNION ALL
        SELECT row_to_json(e)::text FROM core.outbox_events e UNION ALL
        SELECT row_to_json(qv)::text FROM core.quote_versions qv) s`);
    expect(everything.rows[0]!.t).not.toMatch(/TEST000000\d|1988-03-04|2019-09-01/);

    // The payment component: the browser gets the client secret only while the payment is open.
    const session = await app.paymentSession(orderId, accessToken);
    expect(session).toMatchObject({ state: 'READY', publicKey: 'mock' });
    if (session.state !== 'READY') return;
    flights.markPaid(session.secretKey.replace('MOCK_secret_', ''));

    // Return from the payment component: booked with an airline PNR, paid, not confirmed until ticketed (T08).
    let view = await app.finalize(orderId, accessToken);
    expect(view.stage).toBe('ISSUING');
    expect(view.bookingReference).toBeNull();
    let events = await core.db.execute<{ type: string }>(sql`SELECT type FROM core.outbox_events WHERE aggregate_id = ${orderId} ORDER BY created_at`);
    expect(events.rows.map((e) => e.type)).not.toContain('order.confirmed');

    // The next check (worker or the return page) reads the booking: ticket issued -> confirmed.
    view = await app.finalize(orderId, accessToken);
    expect(view.stage).toBe('CONFIRMED');
    expect(view.bookingReference).toMatch(/^MOCK\d+/);
    expect(view.ticketNumbers).toHaveLength(1);
    events = await core.db.execute<{ type: string }>(sql`SELECT type FROM core.outbox_events WHERE aggregate_id = ${orderId} ORDER BY created_at`);
    expect(events.rows.filter((e) => e.type === 'order.confirmed')).toHaveLength(1);
    const fresh = await store.load(orderId);
    expect(fresh.payment!.status).toBe('CAPTURED');
    expect(fresh.items[0]!.booking).toMatchObject({ status: 'ISSUED', ticketing: 'ISSUED' });
  });

  it('checkout is idempotent per key: the same body returns the same order without another prebook', async () => {
    const q = await quoteFor();
    const a = await sales.createCheckout(checkoutBody(q.quoteVersionId, 'flight-idem-01'));
    const b = await sales.createCheckout(checkoutBody(q.quoteVersionId, 'flight-idem-01'));
    expect(b.orderId).toBe(a.orderId);
    const prebooks = await core.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM core.audit_logs WHERE entity_id = ${a.orderId} AND action = 'provider_managed.payment_session_created'`);
    expect(prebooks.rows[0]!.n).toBe(1);
    await expect(sales.createCheckout(checkoutBody(q.quoteVersionId, 'flight-idem-01', { locale: 'en' }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('a return before the payment ends the checkout: no booking, the customer is told about a possible hold', async () => {
    const q = await quoteFor();
    const { orderId, accessToken } = await sales.createCheckout(checkoutBody(q.quoteVersionId, 'flight-unpaid-01'));
    const view = await app.finalize(orderId, accessToken);
    expect(view.stage).toBe('FAILED');
    expect(view.paymentHoldMayExist).toBe(true);
  });

  it('a changed price at prebook stops before any payment (new acceptance needed, K15)', async () => {
    const q = await quoteFor();
    flights.nextPrebookPriceChange = true;
    const { order } = await sales.createCheckout(checkoutBody(q.quoteVersionId, 'flight-price-01'));
    expect(order.stage).toBe('PRICE_CHANGED');
  });

  it('staff cancel: the expected cost comes from the provider quote (or the whole amount without one); the refund is confirmed by a person', async () => {
    const q = await quoteFor();
    const { orderId, accessToken } = await sales.createCheckout(checkoutBody(q.quoteVersionId, 'flight-cancel-01'));
    const session = await app.paymentSession(orderId, accessToken);
    if (session.state !== 'READY') throw new Error('no payment session');
    flights.markPaid(session.secretKey.replace('MOCK_secret_', ''));
    await app.finalize(orderId, accessToken);
    await app.finalize(orderId, accessToken);

    expect(await app.staff.cancellationPreview(ops, orderId)).toMatchObject({ basis: 'PROVIDER_QUOTE', expectedPenalty: money('EUR', 0n), providerQuote: { confidence: 'estimated', destination: 'original_payment' } });
    const original = flights.cancellationQuote.bind(flights);
    flights.cancellationQuote = async () => ({ kind: 'UNKNOWN', reason: 'AMBIGUOUS', evidence: { operation: 'mock', environment: 'mock', at: NOW.toISOString(), httpStatus: 500, upstreamRequestId: null, durationMs: 1 } });
    try {
      const preview = await app.staff.cancellationPreview(ops, orderId);
      expect(preview).toMatchObject({ basis: 'PROVIDER_QUOTE_UNAVAILABLE', providerQuote: null });
      expect(preview.expectedPenalty).toEqual(money('EUR', BigInt(q.total.minor)));
      await expect(app.staff.cancel(ops, orderId, 'Yolcu e-postayla istedi', { customerAcceptedFee: false })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      flights.cancellationQuote = original;
    }

    flights.cancelPending = true;
    const r = await app.staff.cancel(ops, orderId, 'Yolcu e-postayla istedi', { customerAcceptedFee: true });
    expect(r.outcome).toBe('PENDING');
    // The airline confirms on the next read.
    await app.staff.checkStatus(ops, orderId);
    const view = await app.order(orderId, accessToken);
    expect(view.stage).toBe('CANCELLED');
    const tasks = await core.db.execute<{ reason: string }>(sql`SELECT reason FROM core.operation_tasks WHERE order_id = ${orderId} AND status = 'OPEN'`);
    expect(tasks.rows.map((t) => t.reason)).toEqual(['REFUND_UNKNOWN']);
  });
});
