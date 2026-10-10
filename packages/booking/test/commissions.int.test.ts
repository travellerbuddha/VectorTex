import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { opaque, parseCapabilityMatrix, parseSourceLock, type StaffActor } from '@texholiday/contracts';
import { MockHotelConnector } from '@texholiday/connectors';
import { PermissionRepository, PolicyRepository, type CoreDatabase } from '@texholiday/db';
import { money } from '@texholiday/pricing';
import { BookingApp, COMMISSION_ACTOR, type BookingSettings } from '../src/index';
import { freshDatabase } from '../../db/test/support/db';

/** Commission lifecycle (ADR-0019) against PostgreSQL with the MOCK hotel connector: earn after the stay, payouts. */
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

const clock = { now: new Date('2027-05-01T10:00:00Z') };
const owner: StaffActor = { kind: 'STAFF', id: 'owner' };
const finance: StaffActor = { kind: 'STAFF', id: 'finance' };
const approver: StaffActor = { kind: 'STAFF', id: 'approver' };
const ops: StaffActor = { kind: 'STAFF', id: 'ops' };
let core: CoreDatabase;
let app: BookingApp;
let hotels: MockHotelConnector;

async function book(key: string, checkin: string, checkout: string) {
  const r = await app.searchHotels({ target: { placeId: 'MOCK-PLACE-ANTALYA' }, checkin, checkout, rooms: [{ adults: 2, childAges: [] }], nationality: 'TR', currency: 'EUR', locale: 'tr' });
  const quote = await app.selectOffer(r.sessionId, r.hotels.find((h) => h.hotelId === 'MOCK-H2')!.offers[0]!.key);
  const out = await app.createCheckout({
    quoteVersionId: quote.quoteVersionId,
    acceptTerms: true,
    termsVersion: 'terms-1',
    holder: { firstName: 'Ayşe', lastName: 'Demir', email: 'ayse@example.test', phone: '+905321112233' },
    roomGuests: [{ occupancyNumber: 1, firstName: 'Ayşe', lastName: 'Demir' }],
    locale: 'tr',
    idempotencyKey: key,
  });
  const session = await app.paymentSession(out.orderId, out.accessToken);
  if (session.state === 'READY') hotels.markPaid(session.secretKey.replace('MOCK_secret_', ''));
  const order = await app.finalize(out.orderId, out.accessToken);
  expect(order.stage).toBe('CONFIRMED');
  return out.orderId;
}

const commission = async (orderId: string) =>
  (
    await core.db.execute<{ id: string; status: string; amount: string; currency: string; earned_at: string | null; payout_reference: string | null }>(sql`
      SELECT pc.id, pc.status, pc.amount_minor::text AS amount, pc.currency, pc.earned_at, pc.payout_reference
      FROM core.provider_commissions pc JOIN core.order_items i ON i.id = pc.order_item_id WHERE i.order_id = ${orderId}`)
  ).rows[0]!;

/** Every journal balances per currency (debits = credits). */
async function unbalancedJournals() {
  const r = await core.db.execute(sql`
    SELECT journal_id, currency FROM core.ledger_entries
    GROUP BY 1, 2 HAVING sum(CASE direction WHEN 'DEBIT' THEN amount_minor ELSE -amount_minor END) <> 0`);
  return r.rows;
}

const balance = async (account: string) =>
  (await core.db.execute<{ b: string | null }>(sql`SELECT sum(CASE direction WHEN 'DEBIT' THEN amount_minor ELSE -amount_minor END)::text AS b FROM core.ledger_entries WHERE account = ${account}`)).rows[0]!.b ?? '0';

const orders: Record<string, string> = {};

beforeAll(async () => {
  core = await freshDatabase();
  hotels = new MockHotelConnector();
  app = new BookingApp({ db: core.db, hotels, matrix, sourceLock, settings, clock: () => clock.now });
  const perms = new PermissionRepository(core.db);
  await perms.bootstrapManager(owner.id);
  await perms.grantRole('finance', 'FINANCE', owner);
  await perms.grantRole('approver', 'FINANCE_APPROVER', owner);
  await perms.grantRole('ops', 'OPERATIONS', owner);
  const policies = new PolicyRepository(core.db);
  const v = await policies.createDraft(
    'PRICING',
    'b2c',
    { rounding: 'HALF_EVEN', rules: [{ productType: 'HOTEL', paymentMode: 'PROVIDER_MANAGED', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 1000 }], serviceFees: [], fx: null, allowBelowSspInOpaquePackage: false },
    finance,
  );
  await policies.approve('PRICING', 'b2c', v.version, approver);
  orders.a = await book('idem-commission-0001', '2027-06-10', '2027-06-12');
  orders.b = await book('idem-commission-0002', '2027-06-10', '2027-06-12');
  orders.c = await book('idem-commission-0003', '2027-06-10', '2027-06-12');
  orders.d = await book('idem-commission-0004', '2027-06-10', '2027-06-12');
  orders.later = await book('idem-commission-0005', '2027-07-01', '2027-07-05');
});
afterAll(async () => {
  await core?.close();
});

describe('earning after the stay (ADR-0019)', () => {
  it('nothing is earned before the guest checks out; nothing goes to the ledger at confirmation', async () => {
    expect((await commission(orders.a!)).status).toBe('EXPECTED');
    clock.now = new Date('2027-06-12T08:00:00Z'); // check-out day: not yet
    expect(await app.commissions.earnDue()).toEqual({ due: 0, earned: 0, skipped: 0 });
    expect((await core.db.execute(sql`SELECT 1 FROM core.ledger_entries WHERE kind LIKE 'COMMISSION%'`)).rows).toHaveLength(0);
  });

  it('the day after check-out the provider is read again; a confirmed booking earns, a cancelled one voids, no answer waits', async () => {
    // The hotel cancelled order c at the provider; the provider does not answer for order d this time.
    const refOf = async (orderId: string) =>
      (await core.db.execute<{ ref: string }>(sql`SELECT pb.provider_booking_ref AS ref FROM core.provider_bookings pb JOIN core.order_items i ON i.id = pb.order_item_id WHERE i.order_id = ${orderId}`)).rows[0]!.ref;
    await hotels.cancel(opaque(await refOf(orders.c!)));
    const refD = await refOf(orders.d!);
    const real = hotels.getBooking.bind(hotels);
    const spy = vi.spyOn(hotels, 'getBooking').mockImplementation(async (ref) => (String(ref) === refD ? Promise.reject(new Error('timeout')) : real(ref)));

    clock.now = new Date('2027-06-12T21:30:00Z'); // 00:30 on 13 June in Istanbul
    expect(await app.commissions.earnDue()).toEqual({ due: 4, earned: 2, skipped: 2 });
    spy.mockRestore();

    const a = await commission(orders.a!);
    expect(a).toMatchObject({ status: 'EARNED' });
    expect(new Date(a.earned_at!).toISOString()).toBe('2027-06-12T21:30:00.000Z');
    expect((await commission(orders.b!)).status).toBe('EARNED');
    expect((await commission(orders.c!)).status).toBe('VOIDED');
    expect(await refOf(orders.c!)).toBeTruthy();
    const cBooking = await core.db.execute(sql`SELECT pb.status FROM core.provider_bookings pb JOIN core.order_items i ON i.id = pb.order_item_id WHERE i.order_id = ${orders.c!}`);
    expect(cBooking.rows).toEqual([{ status: 'CANCELLED' }]);
    expect((await commission(orders.d!)).status).toBe('EXPECTED');
    expect((await commission(orders.later!)).status).toBe('EXPECTED');

    // Revenue and receivable are booked at earning, balanced; the order shows who earned it.
    const amount = BigInt(a.amount) + BigInt((await commission(orders.b!)).amount);
    expect(await balance('asset:commission_receivable:nuitee')).toBe(amount.toString());
    expect(await balance('revenue:provider_commission:nuitee')).toBe((-amount).toString());
    expect(await unbalancedJournals()).toEqual([]);
    const audit = await core.db.execute(sql`SELECT actor FROM core.audit_logs WHERE entity_id = ${orders.a!} AND action = 'commission.earned'`);
    expect(audit.rows).toEqual([{ actor: COMMISSION_ACTOR }]);

    // Next run: d answers now and earns; an earned commission is never earned twice.
    expect(await app.commissions.earnDue()).toEqual({ due: 1, earned: 1, skipped: 0 });
    expect(await app.commissions.earnDue()).toEqual({ due: 0, earned: 0, skipped: 0 });
  });

  it('a booking cancelled after earning voids the commission and reverses its entries', async () => {
    const before = await balance('asset:commission_receivable:nuitee');
    const d = await commission(orders.d!);
    const r = await app.staff.cancel(ops, orders.d!, 'Misafir konaklamadı, otel iptal etti', { customerAcceptedFee: true });
    expect(r.outcome).toBe('CANCELLED');
    expect((await commission(orders.d!)).status).toBe('VOIDED');
    expect(await balance('asset:commission_receivable:nuitee')).toBe((BigInt(before) - BigInt(d.amount)).toString());
    const reversals = await core.db.execute(sql`SELECT count(*)::int AS n FROM core.ledger_entries WHERE kind = 'COMMISSION_VOIDED' AND reverses_entry_id IS NOT NULL`);
    expect(reversals.rows).toEqual([{ n: 2 }]);
    expect(await unbalancedJournals()).toEqual([]);
  });
});

describe('payouts recorded by finance (ADR-0019)', () => {
  it('needs the payout permission; checks reference, date, amount and the selected commissions', async () => {
    const a = await commission(orders.a!);
    const req = { providerId: 'nuitee', reference: 'NUITEE-PAYOUT-2027-W24', amount: money('EUR', BigInt(a.amount)), receivedOn: '2027-06-14', commissionIds: [a.id] };
    clock.now = new Date('2027-06-14T10:00:00Z');
    await expect(app.commissions.recordPayout(approver, req)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(app.commissions.overview(ops)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(app.commissions.recordPayout(finance, { ...req, reference: ' ' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(app.commissions.recordPayout(finance, { ...req, receivedOn: '2027-06-15' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' }); // future
    await expect(app.commissions.recordPayout(finance, { ...req, receivedOn: '2027-02-30' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(app.commissions.recordPayout(finance, { ...req, amount: money('USD', 100n) })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(app.commissions.recordPayout(finance, { ...req, commissionIds: [] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // A cancelled booking's commission (never paid) cannot be settled.
    await expect(app.commissions.recordPayout(finance, { ...req, commissionIds: [(await commission(orders.c!)).id] })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    // A difference needs a note.
    await expect(app.commissions.recordPayout(finance, { ...req, amount: money('EUR', BigInt(a.amount) - 50n) })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await core.db.execute(sql`SELECT 1 FROM core.commission_payouts`)).rows).toHaveLength(0);
  });

  it('a payout settles its commissions once; a shortfall is booked with its note; a reference is used once', async () => {
    const a = await commission(orders.a!);
    const b = await commission(orders.b!);
    const sum = BigInt(a.amount) + BigInt(b.amount);
    const received = sum - 125n; // e.g. a bank fee withheld
    const r = await app.commissions.recordPayout(finance, {
      providerId: 'nuitee',
      reference: 'NUITEE-PAYOUT-2027-W24',
      amount: money('EUR', received),
      receivedOn: '2027-06-14',
      note: 'Banka masrafı kesildi (1,25 EUR)',
      commissionIds: [a.id, b.id, a.id],
    });
    expect(r.commissions).toEqual(money('EUR', sum));
    expect(r.difference).toEqual(money('EUR', -125n));
    expect(await commission(orders.a!)).toMatchObject({ status: 'RECEIVED', payout_reference: 'NUITEE-PAYOUT-2027-W24' });
    expect((await commission(orders.b!)).status).toBe('RECEIVED');

    // Receivable cleared; what arrived sits on the clearing account; the shortfall is an expense.
    expect(await balance('asset:commission_receivable:nuitee')).toBe('0');
    expect(await balance('asset:payout_clearing:nuitee')).toBe(received.toString());
    expect(await balance('expense:commission_shortfall:nuitee')).toBe('125');
    expect(await unbalancedJournals()).toEqual([]);

    // The same reference again, or settling a received commission again, is refused.
    const again = { providerId: 'nuitee', reference: 'NUITEE-PAYOUT-2027-W24', amount: money('EUR', 10n), receivedOn: '2027-06-14', commissionIds: [a.id] };
    await expect(app.commissions.recordPayout(finance, again)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    const later = await commission(orders.later!);
    clock.now = new Date('2027-07-06T10:00:00Z');
    expect(await app.commissions.earnDue()).toMatchObject({ earned: 1 });
    await expect(app.commissions.recordPayout(finance, { ...again, amount: money('EUR', BigInt(later.amount)), receivedOn: '2027-07-06', commissionIds: [later.id] })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringMatching(/already recorded/),
    });

    // Finance view: totals per status, the rows and the payout with its difference.
    const view = await app.commissions.overview(finance, { status: 'RECEIVED' });
    expect(view.rows.map((x) => x.orderId).sort()).toEqual([orders.a, orders.b].sort());
    expect(view.rows[0]).toMatchObject({ providerId: 'nuitee', productType: 'HOTEL', title: 'MOCK Kaleiçi Boutique', serviceStart: '2027-06-10', serviceEnd: '2027-06-12', payoutReference: 'NUITEE-PAYOUT-2027-W24' });
    expect(view.payouts).toEqual([
      expect.objectContaining({ reference: 'NUITEE-PAYOUT-2027-W24', count: 2, receivedOn: '2027-06-14', amount: { currency: 'EUR', minor: received.toString() }, difference: { currency: 'EUR', minor: '-125' }, recordedBy: 'staff:finance' }),
    ]);
    expect(view.totals).toEqual(expect.arrayContaining([expect.objectContaining({ bucket: 'RECEIVED', count: 2, amount: { currency: 'EUR', minor: sum.toString() } }), expect.objectContaining({ bucket: 'VOIDED', count: 2 }), expect.objectContaining({ bucket: 'EARNED', count: 1 })]));
  });
});

describe('paid when Nuitee collects the payment, before the stay (ADR-0019 rev. 2)', () => {
  it('an advance until the stay ends; a cancellation owes it back; a later payout nets it; earning moves the advance to revenue', async () => {
    clock.now = new Date('2027-07-10T10:00:00Z');
    const e = await book('idem-commission-0101', '2027-08-01', '2027-08-03');
    const f = await book('idem-commission-0102', '2027-08-01', '2027-08-03');
    const g = await book('idem-commission-0103', '2027-08-01', '2027-08-05');
    const ce = await commission(e);
    const cf = await commission(f);
    const cg = await commission(g);
    expect(BigInt(cg.amount)).toBeGreaterThan(BigInt(cf.amount));
    const before = { advance: BigInt(await balance('liability:commission_received_in_advance:nuitee')), revenue: BigInt(await balance('revenue:provider_commission:nuitee')) };

    // Nuitee pays the commissions of e and f right after collecting the payments: settled as an advance.
    clock.now = new Date('2027-07-12T10:00:00Z');
    const first = await app.commissions.recordPayout(finance, { providerId: 'nuitee', reference: 'NUITEE-2027-07-12', amount: money('EUR', BigInt(ce.amount) + BigInt(cf.amount)), receivedOn: '2027-07-12', commissionIds: [ce.id, cf.id] });
    expect(first.difference).toEqual(money('EUR', 0n));
    expect(await commission(e)).toMatchObject({ status: 'RECEIVED', earned_at: null });
    expect(BigInt(await balance('liability:commission_received_in_advance:nuitee')) - before.advance).toBe(-(BigInt(ce.amount) + BigInt(cf.amount)));
    expect(BigInt(await balance('revenue:provider_commission:nuitee'))).toBe(before.revenue); // not revenue yet
    expect((await app.commissions.overview(finance)).totals).toEqual(expect.arrayContaining([expect.objectContaining({ bucket: 'RECEIVED_ADVANCE', count: 2 })]));

    // f is cancelled before the stay: its commission is owed back.
    expect((await app.staff.cancel(ops, f, 'Misafir planını değiştirdi', { customerAcceptedFee: true })).outcome).toBe('CANCELLED');
    expect((await commission(f)).status).toBe('VOIDED');
    expect(await balance('liability:commission_refund_due:nuitee')).toBe((-BigInt(cf.amount)).toString());
    const due = await app.commissions.overview(finance, { view: 'REFUND_DUE' });
    expect(due.rows.map((r) => r.orderId)).toEqual([f]);
    expect(due.rows[0]).toMatchObject({ bucket: 'REFUND_DUE', payoutReference: 'NUITEE-2027-07-12', clawbackReference: null });

    // The next payout pays g's commission minus f's: recorded with f netted, no difference.
    clock.now = new Date('2027-07-19T10:00:00Z');
    await expect(app.commissions.recordPayout(finance, { providerId: 'nuitee', reference: 'NUITEE-2027-07-19', amount: money('EUR', BigInt(cg.amount) - BigInt(cf.amount)), receivedOn: '2027-07-19', commissionIds: [cg.id], clawbackIds: [ce.id] })).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    }); // e is not a cancelled commission
    const second = await app.commissions.recordPayout(finance, { providerId: 'nuitee', reference: 'NUITEE-2027-07-19', amount: money('EUR', BigInt(cg.amount) - BigInt(cf.amount)), receivedOn: '2027-07-19', commissionIds: [cg.id], clawbackIds: [cf.id] });
    expect(second).toMatchObject({ commissions: money('EUR', BigInt(cg.amount)), clawbacks: money('EUR', BigInt(cf.amount)), difference: money('EUR', 0n) });
    expect(await balance('liability:commission_refund_due:nuitee')).toBe('0');
    expect((await app.commissions.overview(finance, { view: 'REFUND_DUE' })).rows).toEqual([]);
    expect((await app.commissions.overview(finance, { view: 'VOIDED' })).rows.find((r) => r.orderId === f)).toMatchObject({ clawbackReference: 'NUITEE-2027-07-19' });
    expect((await app.commissions.overview(finance)).payouts.find((p) => p.reference === 'NUITEE-2027-07-19')).toMatchObject({ count: 1, clawbackCount: 1, difference: { currency: 'EUR', minor: '0' } });
    // Netted once only.
    await expect(app.commissions.recordPayout(finance, { providerId: 'nuitee', reference: 'NUITEE-2027-07-26', amount: money('EUR', 100n), receivedOn: '2027-07-19', note: 'deneme mahsubu', commissionIds: [], clawbackIds: [cf.id] })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });

    // After the stays: e and g are earned — the advance becomes revenue; they stay RECEIVED.
    clock.now = new Date('2027-08-06T09:00:00Z');
    expect(await app.commissions.earnDue()).toMatchObject({ earned: 2, skipped: 0 });
    expect(await commission(e)).toMatchObject({ status: 'RECEIVED' });
    expect((await commission(e)).earned_at).not.toBeNull();
    expect(BigInt(await balance('liability:commission_received_in_advance:nuitee'))).toBe(before.advance);
    expect(BigInt(await balance('revenue:provider_commission:nuitee')) - before.revenue).toBe(-(BigInt(ce.amount) + BigInt(cg.amount)));
    expect(await app.commissions.earnDue()).toMatchObject({ due: 0 });
    expect(await unbalancedJournals()).toEqual([]);
  });
});
