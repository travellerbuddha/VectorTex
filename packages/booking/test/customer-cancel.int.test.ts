import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { parseCapabilityMatrix, parseSourceLock, type StaffActor } from '@texholiday/contracts';
import { MockHotelConnector } from '@texholiday/connectors';
import { PermissionRepository, PolicyRepository, type CoreDatabase } from '@texholiday/db';
import { BookingApp, type BookingSettings } from '../src/index';
import { freshDatabase } from '../../db/test/support/db';
import { money } from '@texholiday/pricing';

/**
 * Online cancellation by the customer (T27, ADR-0021) against PostgreSQL with the MOCK hotel connector: only the order's
 * owner, only while something is refunded and before the check-in day, the fee accepted exactly as expected now, the
 * same provider command as staff (intent first, lost answer read back), a refusal handed to the team.
 */
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
  currencies: ['EUR'],
  maxHotels: 60,
  maxRatesPerHotel: 8,
  intentLeaseSeconds: 600,
  maxAutomaticLookups: 3,
  enforceRateParity: true,
};

const CHECKIN = '2027-06-10';
let core: CoreDatabase;
let hotels: MockHotelConnector;
let app: BookingApp;
let now = new Date('2027-05-01T10:00:00Z');
let seq = 0;

async function book(room: RegExp): Promise<{ orderId: string; token: string; total: { currency: string; minor: string } }> {
  const r = await app.searchHotels({
    target: { placeId: 'MOCK-PLACE-ANTALYA' },
    checkin: CHECKIN,
    checkout: '2027-06-13',
    rooms: [{ adults: 2, childAges: [] }],
    nationality: 'TR',
    currency: 'EUR',
    locale: 'tr',
  });
  const offer = r.hotels.flatMap((h) => h.offers).find((o) => room.test(o.roomName ?? ''))!;
  const quote = await app.selectOffer(r.sessionId, offer.key);
  seq += 1;
  const { orderId, accessToken } = await app.createCheckout({
    quoteVersionId: quote.quoteVersionId,
    acceptTerms: true,
    termsVersion: 'terms-test-1',
    holder: { firstName: 'Ayşe', lastName: 'Yılmaz', email: 'ayse@example.test', phone: '+905321112233' },
    roomGuests: [{ occupancyNumber: 1, firstName: 'Ayşe', lastName: 'Yılmaz' }],
    locale: 'tr',
    idempotencyKey: `idem-customer-cancel-${seq}`,
  });
  const session = await app.paymentSession(orderId, accessToken);
  if (session.state !== 'READY') throw new Error('no payment session');
  hotels.markPaid(session.secretKey.replace('MOCK_secret_', ''));
  expect((await app.finalize(orderId, accessToken)).stage).toBe('CONFIRMED');
  return { orderId, token: accessToken, total: quote.total };
}

const at = (iso: string) => {
  now = new Date(iso);
};
const openTasks = async (orderId: string) =>
  (await core.db.execute<{ reason: string }>(sql`SELECT reason FROM core.operation_tasks WHERE order_id = ${orderId} AND status = 'OPEN' ORDER BY reason`)).rows.map((r) => r.reason);
const commissionStatus = async (orderId: string) =>
  (await core.db.execute<{ status: string }>(sql`SELECT pc.status FROM core.provider_commissions pc JOIN core.order_items i ON i.id = pc.order_item_id WHERE i.order_id = ${orderId}`)).rows[0]?.status;

beforeAll(async () => {
  core = await freshDatabase();
  hotels = new MockHotelConnector();
  app = new BookingApp({ db: core.db, hotels, matrix, sourceLock, settings, clock: () => now });
  const owner: StaffActor = { kind: 'STAFF', id: 'owner' };
  const finance: StaffActor = { kind: 'STAFF', id: 'finance' };
  const approver: StaffActor = { kind: 'STAFF', id: 'approver' };
  const perms = new PermissionRepository(core.db);
  await perms.bootstrapManager(owner.id);
  await perms.grantRole(finance.id, 'FINANCE', owner);
  await perms.grantRole(approver.id, 'FINANCE_APPROVER', owner);
  const policies = new PolicyRepository(core.db);
  const v = await policies.createDraft(
    'PRICING',
    'b2c',
    { rounding: 'HALF_EVEN', rules: [{ productType: 'HOTEL', paymentMode: 'PROVIDER_MANAGED', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 1000 }], serviceFees: [], fx: null, allowBelowSspInOpaquePackage: false },
    finance,
  );
  await policies.approve('PRICING', 'b2c', v.version, approver);
});
afterAll(async () => {
  await core?.close();
});

describe('customer cancels a hotel booking online (T27, ADR-0021)', () => {
  it('free cancellation: owner only, the fee must be the one expected, then cancelled once like a staff cancel', async () => {
    at('2027-05-01T10:00:00Z');
    const { orderId, token } = await book(/Superior Double/);
    // Someone without the order's access token sees nothing.
    await expect(app.customerCancellation(orderId, 'not-the-token')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(app.customerCancel(orderId, null, { acceptedFee: { currency: 'EUR', minor: '0' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const view = await app.customerCancellation(orderId, token);
    // MOCK refundable rate: free until 3 days before check-in.
    expect(view).toMatchObject({ state: 'AVAILABLE', expectedFee: { currency: 'EUR', minor: '0' }, freeUntil: expect.stringMatching(/^2027-06-0[67]T/) });

    await expect(app.customerCancel(orderId, token, {})).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(app.customerCancel(orderId, token, { acceptedFee: { currency: 'EUR', minor: '-1' } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // A fee other than the one expected now is refused: nothing is sent.
    const calls = hotels.calls.cancel ?? 0;
    await expect(app.customerCancel(orderId, token, { acceptedFee: { currency: 'EUR', minor: '100' } })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(hotels.calls.cancel ?? 0).toBe(calls);

    const r = await app.customerCancel(orderId, token, { acceptedFee: { currency: 'EUR', minor: '0' } });
    expect(r.outcome).toBe('CANCELLED');
    expect(r.order.stage).toBe('CANCELLED');
    expect(r.cancellation).toBeNull();
    expect(hotels.calls.cancel).toBe(calls + 1);
    // Audited as the customer's, the customer e-mail is queued, the commission is voided like any cancellation.
    const audit = await core.db.execute<{ actor: string; detail: Record<string, unknown> }>(
      sql`SELECT actor, detail FROM core.audit_logs WHERE entity_type = 'order' AND entity_id = ${orderId} AND action = 'provider_managed.cancel_requested'`,
    );
    expect(audit.rows[0]).toMatchObject({ actor: 'customer:site', detail: { requestedByCustomer: true, customerAcceptedFee: false, expectedPenalty: { currency: 'EUR', minor: '0' } } });
    const mail = await core.db.execute(sql`SELECT 1 FROM core.outbox_events WHERE aggregate_id = ${orderId} AND type = 'order.cancelled'`);
    expect(mail.rows).toHaveLength(1);
    expect(await commissionStatus(orderId)).toBe('VOIDED');
    // Not twice.
    await expect(app.customerCancel(orderId, token, { acceptedFee: { currency: 'EUR', minor: '0' } })).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
    expect(hotels.calls.cancel).toBe(calls + 1);
  });

  it('a fee inside the policy must be accepted as shown; a fee that changed while the page was open is shown again first', async () => {
    // This hotel's terms (as Nuitee passes them on): one night from 7 days before check-in, the whole stay from 3 days.
    hotels.refundableSteps = (checkin, price, nights) => [
      { from: new Date(checkin - 7 * 86_400_000).toISOString(), penalty: money(price.currency, price.minor / BigInt(nights)) },
      { from: new Date(checkin - 3 * 86_400_000).toISOString(), penalty: price },
    ];
    try {
      at('2027-05-01T10:00:00Z');
      const { orderId, token, total } = await book(/Superior Double/);
      // 8 days before check-in: still free.
      at('2027-06-02T10:00:00Z');
      const free = await app.customerCancellation(orderId, token);
      expect(free).toMatchObject({ state: 'AVAILABLE', expectedFee: { minor: '0' } });
      // 5 days before: one night (of three) is due. The page still shows "free": refused, nothing sent.
      at('2027-06-05T10:00:00Z');
      const calls = hotels.calls.cancel ?? 0;
      await expect(app.customerCancel(orderId, token, { acceptedFee: { currency: 'EUR', minor: '0' } })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
      expect(hotels.calls.cancel ?? 0).toBe(calls);
      const charged = await app.customerCancellation(orderId, token);
      if (charged?.state !== 'AVAILABLE') throw new Error(`expected AVAILABLE, got ${JSON.stringify(charged)}`);
      expect(BigInt(charged.expectedFee.minor)).toBeGreaterThan(0n);
      expect(BigInt(charged.expectedFee.minor)).toBeLessThan(BigInt(total.minor));
      expect(charged.paid).toEqual(total);

      const r = await app.customerCancel(orderId, token, { acceptedFee: charged.expectedFee });
      expect(r.outcome).toBe('CANCELLED');
      const audit = await core.db.execute<{ detail: Record<string, unknown> }>(
        sql`SELECT detail FROM core.audit_logs WHERE entity_type = 'order' AND entity_id = ${orderId} AND action = 'provider_managed.cancel_requested'`,
      );
      expect(audit.rows[0]!.detail).toMatchObject({ customerAcceptedFee: true, expectedPenalty: charged.expectedFee, requestedByCustomer: true });
    } finally {
      hotels.refundableSteps = null;
    }
  });

  it('not offered online when the hotel’s terms refund nothing now (non-refundable rate, or the whole stay due)', async () => {
    at('2027-05-01T10:00:00Z');
    const nonRefundable = await book(/Standard Room/);
    expect(await app.customerCancellation(nonRefundable.orderId, nonRefundable.token)).toEqual({ state: 'NOT_AVAILABLE', reason: 'NO_REFUND' });
    await expect(app.customerCancel(nonRefundable.orderId, nonRefundable.token, { acceptedFee: nonRefundable.total })).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });

    const refundable = await book(/Superior Double/);
    // Inside 3 days the whole stay is due under this hotel's terms: nothing to refund.
    at('2027-06-08T10:00:00Z');
    expect(await app.customerCancellation(refundable.orderId, refundable.token)).toEqual({ state: 'NOT_AVAILABLE', reason: 'NO_REFUND' });
    // Both stay confirmed.
    expect((await app.order(nonRefundable.orderId, nonRefundable.token)).stage).toBe('CONFIRMED');
    expect((await app.order(refundable.orderId, refundable.token)).stage).toBe('CONFIRMED');
  });

  it('only the hotel’s terms from Nuitee decide: free until the evening before arrival means free until then, no rule of ours on top', async () => {
    // e.g. an Antalya hotel: free cancellation until 18:00 local time (15:00 UTC) the day before arrival.
    hotels.refundableSteps = (checkin, price) => [{ from: new Date(checkin - 86_400_000 + 15 * 3_600_000).toISOString(), penalty: price }];
    try {
      at('2027-05-01T10:00:00Z');
      const late = await book(/Superior Double/);
      const other = await book(/Superior Double/);
      // 9 June 13:00 Antalya time: still inside the hotel's free period.
      at('2027-06-09T10:00:00Z');
      const view = await app.customerCancellation(late.orderId, late.token);
      expect(view).toEqual({ state: 'AVAILABLE', expectedFee: { currency: 'EUR', minor: '0' }, paid: late.total, freeUntil: expect.stringMatching(/^2027-06-09T1[45]:/) });
      expect((await app.customerCancel(late.orderId, late.token, { acceptedFee: { currency: 'EUR', minor: '0' } })).outcome).toBe('CANCELLED');
      // After 18:00 local the whole stay is due: no longer offered.
      at('2027-06-09T15:30:00Z');
      expect(await app.customerCancellation(other.orderId, other.token)).toEqual({ state: 'NOT_AVAILABLE', reason: 'NO_REFUND' });
    } finally {
      hotels.refundableSteps = null;
    }
  });

  it('refused by the provider: the booking stands and a task asks the team to contact the customer', async () => {
    at('2027-05-01T10:00:00Z');
    const { orderId, token } = await book(/Superior Double/);
    hotels.nextCancel = { kind: 'REJECTED', code: 'NUITEE_4011', message: 'MOCK refused', evidence: { operation: 'cancel', environment: 'mock', at: now.toISOString(), httpStatus: 400, upstreamRequestId: null, durationMs: null } };
    const r = await app.customerCancel(orderId, token, { acceptedFee: { currency: 'EUR', minor: '0' } });
    expect(r.outcome).toBe('REJECTED');
    expect(r.order.stage).toBe('CONFIRMED');
    expect(r.cancellation).toMatchObject({ state: 'AVAILABLE' });
    expect(await openTasks(orderId)).toEqual(['CUSTOMER_CANCEL_REJECTED']);
  });

  it('a lost answer shows as in progress, is never re-sent, and is resolved by reading the booking', async () => {
    at('2027-05-01T10:00:00Z');
    const { orderId, token } = await book(/Superior Double/);
    hotels.nextCancel = { kind: 'UNKNOWN', reason: 'TIMEOUT', evidence: { operation: 'cancel', environment: 'mock', at: now.toISOString(), httpStatus: null, upstreamRequestId: null, durationMs: null } };
    const calls = hotels.calls.cancel ?? 0;
    const r = await app.customerCancel(orderId, token, { acceptedFee: { currency: 'EUR', minor: '0' } });
    expect(r.outcome).toBe('UNKNOWN');
    expect(r.cancellation).toEqual({ state: 'IN_PROGRESS' });
    expect(await openTasks(orderId)).toContain('CANCELLATION_UNKNOWN');
    await expect(app.customerCancel(orderId, token, { acceptedFee: { currency: 'EUR', minor: '0' } })).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
    expect(hotels.calls.cancel).toBe(calls + 1);
    // The worker's next step reads the booking. The mock still holds it confirmed (the cancel did not take effect):
    // the booking is confirmed again and the customer may decide again; the cancel itself was never re-sent.
    at('2027-05-01T10:10:00Z');
    await app.orchestrator.finalize(orderId);
    expect(await app.customerCancellation(orderId, token)).toMatchObject({ state: 'AVAILABLE' });
    expect((await app.order(orderId, token)).stage).toBe('CONFIRMED');
    expect(hotels.calls.cancel).toBe(calls + 1);
  });
});
