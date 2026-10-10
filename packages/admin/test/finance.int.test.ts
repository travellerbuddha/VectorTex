import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { parseCapabilityMatrix, parseSourceLock, type StaffActor } from '@texholiday/contracts';
import { PermissionRepository, PolicyRepository, type CoreDatabase } from '@texholiday/db';
import { money } from '@texholiday/pricing';
import { adminSettingsFromEnv, financeCsv, financePeriod, FinanceReports, StaffAuthService } from '../src/index';
import { BookingApp, type BookingSettings } from '../../booking/src/index';
import { MockHotelConnector } from '../../connectors/src/index';
import { freshDatabase } from '../../db/test/support/db';

/** Finance reports (P15b) over orders made by the real booking flow (MOCK): sums per currency, no personal data. */
const root = join(__dirname, '..', '..', '..');
const matrix = parseCapabilityMatrix(JSON.parse(readFileSync(join(root, 'contracts', 'capability-matrix.json'), 'utf8')));
const sourceLock = parseSourceLock(JSON.parse(readFileSync(join(root, 'contracts', 'sources.lock.json'), 'utf8')));
const settings: BookingSettings = {
  environment: 'mock',
  policyId: 'b2c',
  searchTtlSeconds: 1800,
  quoteTtlSeconds: 1200,
  payBySeconds: 1800,
  termsVersion: 'terms-1',
  accessTokenSecret: 'test-only-secret-0123456789abcdef0123',
  currencies: ['EUR'],
  maxHotels: 60,
  maxRatesPerHotel: 8,
  intentLeaseSeconds: 600,
  maxAutomaticLookups: 3,
  enforceRateParity: true,
};

let core: CoreDatabase;
let reports: FinanceReports;
let today = '';
const finance: StaffActor = { kind: 'STAFF', id: 'fin-1' };
const ops: StaffActor = { kind: 'STAFF', id: 'ops-1' };
const viewer: StaffActor = { kind: 'STAFF', id: 'viewer-1' };
const ids = { confirmed: '', cancelled: '', unpaid: '' };
const refs = { confirmed: '', cancelled: '' };

beforeAll(async () => {
  core = await freshDatabase();
  const auth = new StaffAuthService(core.db, adminSettingsFromEnv({ STAFF_MFA_KEY: Buffer.alloc(32, 5).toString('base64') }));
  const owner: StaffActor = { kind: 'STAFF', id: (await auth.bootstrapOwner({ email: 'owner@example.test', displayName: 'Owner' })).staffId };
  const perms = new PermissionRepository(core.db);
  await perms.grantRole(finance.id, 'FINANCE', owner);
  await perms.grantRole('appr-1', 'FINANCE_APPROVER', owner);
  await perms.grantRole(ops.id, 'OPERATIONS', owner);
  await perms.grantRole(viewer.id, 'VIEWER', owner);
  const policies = new PolicyRepository(core.db);
  const v = await policies.createDraft(
    'PRICING',
    'b2c',
    { rounding: 'HALF_EVEN', rules: [{ productType: 'HOTEL', paymentMode: 'PROVIDER_MANAGED', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 1000 }], serviceFees: [], fx: null, allowBelowSspInOpaquePackage: false },
    finance,
  );
  await policies.approve('PRICING', 'b2c', v.version, { kind: 'STAFF', id: 'appr-1' });

  const hotels = new MockHotelConnector();
  const app = new BookingApp({ db: core.db, hotels, matrix, sourceLock, settings, clock: () => new Date('2027-05-01T10:00:00Z') });
  const order = async (key: string, pay: boolean) => {
    const r = await app.searchHotels({ target: { placeId: 'MOCK-PLACE-ANTALYA' }, checkin: '2027-06-10', checkout: '2027-06-13', rooms: [{ adults: 2, childAges: [] }], nationality: 'TR', currency: 'EUR', locale: 'tr' });
    const quote = await app.selectOffer(r.sessionId, r.hotels.find((h) => h.hotelId === 'MOCK-H2')!.offers[0]!.key);
    const out = await app.createCheckout({
      quoteVersionId: quote.quoteVersionId,
      acceptTerms: true,
      termsVersion: 'terms-1',
      holder: { firstName: 'Ayşe', lastName: 'Yılmaz', email: `guest-${key}@example.test`, phone: '+905321112233' },
      roomGuests: [{ occupancyNumber: 1, firstName: 'Ayşe', lastName: 'Yılmaz' }],
      locale: 'tr',
      idempotencyKey: key,
    });
    const session = await app.paymentSession(out.orderId, out.accessToken);
    if (!pay) return { orderId: out.orderId, ref: '' };
    if (session.state === 'READY') hotels.markPaid(session.secretKey.replace('MOCK_secret_', ''));
    const done = await app.finalize(out.orderId, out.accessToken);
    return { orderId: out.orderId, ref: done.bookingReference! };
  };
  const a = await order('idem-fin-0001', true);
  ids.confirmed = a.orderId;
  refs.confirmed = a.ref;
  const b = await order('idem-fin-0002', true);
  ids.cancelled = b.orderId;
  refs.cancelled = b.ref;
  expect((await app.staff.cancel(ops, b.orderId, 'Misafir telefonla istedi', { customerAcceptedFee: true })).outcome).toBe('CANCELLED');
  await app.staff.recordProviderRefund(finance, b.orderId, money('EUR', 5000n), 'Nuitee panel');
  ids.unpaid = (await order('idem-fin-0003', false)).orderId;
  today = String((await core.db.execute<{ d: string }>(sql`SELECT ((now() AT TIME ZONE 'Europe/Istanbul')::date)::text AS d`)).rows[0]!.d);
  reports = new FinanceReports(core.db, 'mock');
});
afterAll(async () => {
  await core?.close();
});

const eur = (minor: string) => ({ currency: 'EUR', minor });

describe('finance reports (P15b)', () => {
  it('sums the period per currency: orders, booked sales, commissions, cancellations, refunds, payments', async () => {
    const r = await reports.report(finance, { from: today, to: today });
    expect(r.environment).toBe('mock');
    const orderStatuses = Object.fromEntries(r.orders.map((o) => [o.status, [o.count, o.amount.minor]]));
    expect(orderStatuses.CONFIRMED).toEqual([1, '29700']);
    expect(orderStatuses.CANCELLED).toEqual([1, '29700']);
    expect(r.orders.reduce((a, o) => a + o.count, 0)).toBe(3);
    // Only the booking that stands: 297.00 EUR charged, provider price 297.00 (it includes our 27.00 commission).
    expect(r.sales).toEqual([{ productType: 'HOTEL', count: 1, charge: eur('29700'), supplierPrice: eur('29700') }]);
    expect(r.commissions).toEqual(expect.arrayContaining([{ status: 'EXPECTED', currency: 'EUR', count: 1, amount: eur('2700') }]));
    expect(r.commissions.find((c) => c.status === 'VOIDED')).toMatchObject({ count: 1, amount: eur('2700') });
    expect(r.openCommissions).toEqual([{ status: 'EXPECTED', currency: 'EUR', count: 1, amount: eur('2700') }]);
    expect(r.cancellations).toEqual([{ currency: 'EUR', count: 1, amount: eur('29700') }]);
    expect(r.payments.reduce((a, p) => a + p.count, 0)).toBe(3);
    // Refunds count on the day they were recorded (the booking clock of this test: 1 May 2027), not the order's day.
    expect(r.refunds).toEqual([]);
    const may = await reports.report(finance, { from: '2027-05-01', to: '2027-05-01' });
    expect(may.refunds).toEqual([{ currency: 'EUR', count: 1, amount: eur('5000') }]);
    expect(may.orders).toEqual([]);
  });

  it('another period or environment has nothing; only orders.view_financials may read; periods are checked', async () => {
    const empty = await reports.report(finance, { from: '2020-01-01', to: '2020-01-31' });
    expect([empty.orders, empty.sales, empty.commissions, empty.cancellations, empty.refunds, empty.payments]).toEqual([[], [], [], [], [], []]);
    // Open receivables are "now", whatever the period.
    expect(empty.openCommissions).toHaveLength(1);
    expect((await new FinanceReports(core.db, 'sandbox').report(finance, { from: today, to: today })).orders).toEqual([]);
    await expect(reports.report(viewer, { from: today, to: today })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(reports.lines(ops, { from: today, to: today })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(() => financePeriod('2027-02-30', '2027-03-01')).toThrow(/calendar/);
    expect(() => financePeriod('2027-03-02', '2027-03-01')).toThrow(/after/);
    expect(() => financePeriod('2026-01-01', '2027-01-02')).toThrow(/366/);
    expect(() => financePeriod("2027-01-01' OR 1=1", '2027-01-02')).toThrow(/YYYY-MM-DD/);
    expect(financePeriod('2026-01-01', '2026-12-31')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('CSV: one line per order item, exact decimal amounts beside their currency, refunds once per order, no personal data', async () => {
    const lines = await reports.lines(finance, { from: today, to: today });
    expect(lines.map((l) => l.orderId)).toEqual([ids.confirmed, ids.cancelled, ids.unpaid]);
    expect(lines[0]).toMatchObject({ orderStatus: 'CONFIRMED', bookingStatus: 'CONFIRMED', providerBookingRef: refs.confirmed, charge: eur('29700'), commission: eur('2700'), commissionStatus: 'EXPECTED', refunded: null });
    expect(lines[1]).toMatchObject({ orderStatus: 'CANCELLED', bookingStatus: 'CANCELLED', refunded: eur('5000'), commissionStatus: 'VOIDED' });
    const csv = financeCsv(lines);
    const rows = csv.trim().split('\r\n');
    expect(rows[0]).toBe(
      'order_id,created_at_utc,order_status,item,product,provider,funding,booking_status,provider_booking_ref,currency,charge,supplier_currency,supplier_price,commission_currency,commission,commission_status,refunded_currency,refunded,payment_status',
    );
    expect(rows[1]).toContain(`,HOTEL,nuitee,PROVIDER_MANAGED,CONFIRMED,${refs.confirmed},EUR,297.00,EUR,297.00,EUR,27.00,EXPECTED,,,`);
    expect(rows[2]).toContain(',EUR,50.00,');
    expect(rows).toHaveLength(4);
    expect(csv).not.toMatch(/Yılmaz|Ayşe|example\.test|905321112233/);
  });
});
