import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { parseCapabilityMatrix, parseSourceLock, type StaffActor } from '@texholiday/contracts';
import { PermissionRepository, PolicyRepository, type CoreDatabase } from '@texholiday/db';
import { adminSettingsFromEnv, OrdersQuery, StaffAuthService } from '../src/index';
import { BookingApp, type BookingSettings } from '../../booking/src/index';
import { MockHotelConnector } from '../../connectors/src/index';
import { freshDatabase } from '../../db/test/support/db';

/** Operations read side and task handling against PostgreSQL, with orders made by the real booking flow (MOCK). */
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
let orders: OrdersQuery;
let owner: StaffActor;
const viewer: StaffActor = { kind: 'STAFF', id: 'viewer-1' };
const nobody: StaffActor = { kind: 'STAFF', id: 'nobody-1' };
let confirmedId = '';
let waitingId = '';
let bookingRef = '';

beforeAll(async () => {
  core = await freshDatabase();
  const auth = new StaffAuthService(core.db, adminSettingsFromEnv({ STAFF_MFA_KEY: Buffer.alloc(32, 5).toString('base64') }));
  owner = { kind: 'STAFF', id: (await auth.bootstrapOwner({ email: 'owner@example.test', displayName: 'Owner' })).staffId };
  const perms = new PermissionRepository(core.db);
  await perms.grantRole(viewer.id, 'VIEWER', owner);
  await perms.grantRole('fin-1', 'FINANCE', owner);
  await perms.grantRole('appr-1', 'FINANCE_APPROVER', owner);
  const policies = new PolicyRepository(core.db);
  const v = await policies.createDraft(
    'PRICING',
    'b2c',
    { rounding: 'HALF_EVEN', rules: [{ productType: 'HOTEL', paymentMode: 'PROVIDER_MANAGED', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 1000 }], serviceFees: [], fx: null, allowBelowSspInOpaquePackage: false },
    { kind: 'STAFF', id: 'fin-1' },
  );
  await policies.approve('PRICING', 'b2c', v.version, { kind: 'STAFF', id: 'appr-1' });

  const hotels = new MockHotelConnector();
  const app = new BookingApp({ db: core.db, hotels, matrix, sourceLock, settings, clock: () => new Date('2027-05-01T10:00:00Z') });
  const order = async (lastName: string, key: string) => {
    const r = await app.searchHotels({ target: { placeId: 'MOCK-PLACE-ANTALYA' }, checkin: '2027-06-10', checkout: '2027-06-13', rooms: [{ adults: 2, childAges: [] }], nationality: 'TR', currency: 'EUR', locale: 'tr' });
    const quote = await app.selectOffer(r.sessionId, r.hotels.find((h) => h.hotelId === 'MOCK-H2')!.offers[0]!.key);
    const out = await app.createCheckout({
      quoteVersionId: quote.quoteVersionId,
      acceptTerms: true,
      termsVersion: 'terms-1',
      holder: { firstName: 'Ayşe', lastName, email: `guest-${key}@example.test`, phone: '+905321112233' },
      roomGuests: [{ occupancyNumber: 1, firstName: 'Ayşe', lastName }],
      locale: 'tr',
      idempotencyKey: key,
    });
    const session = await app.paymentSession(out.orderId, out.accessToken);
    return { ...out, session };
  };
  const a = await order('Yılmaz', 'idem-orders-0001');
  if (a.session.state === 'READY') hotels.markPaid(a.session.secretKey.replace('MOCK_secret_', ''));
  const done = await app.finalize(a.orderId, a.accessToken);
  confirmedId = a.orderId;
  bookingRef = done.bookingReference!;
  const b = await order('Demir', 'idem-orders-0002');
  waitingId = b.orderId;
  await core.db.execute(sql`INSERT INTO core.operation_tasks (order_id, reason, detail) VALUES (${waitingId}, 'PROVIDER_PAYMENT_HOLD', 'test task')`);
  orders = new OrdersQuery(core.db, 'mock');
});
afterAll(async () => {
  await core?.close();
});

describe('operations screens: orders and tasks', () => {
  it('lists the environment’s orders with search and an attention filter; needs orders.view', async () => {
    const all = await orders.list(owner);
    expect(all.map((r) => r.id).sort()).toEqual([confirmedId, waitingId].sort());
    const confirmed = all.find((r) => r.id === confirmedId)!;
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', title: 'MOCK Kaleiçi Boutique', holderName: 'Ayşe Yılmaz', bookingStatus: 'CONFIRMED', providerBookingRef: bookingRef, paymentStatus: 'CAPTURED', openTasks: 0 });
    expect(confirmed.belowSuggestedPrice).toBe(false);
    expect((await orders.list(owner, { q: 'demir' })).map((r) => r.id)).toEqual([waitingId]);
    expect((await orders.list(owner, { q: bookingRef })).map((r) => r.id)).toEqual([confirmedId]);
    expect((await orders.list(owner, { q: confirmedId.slice(0, 8) })).map((r) => r.id)).toEqual([confirmedId]);
    expect((await orders.list(owner, { attention: true })).map((r) => r.id)).toEqual([waitingId]);
    expect((await orders.list(owner, { status: 'CONFIRMED' })).map((r) => r.id)).toEqual([confirmedId]);
    expect(await orders.list(owner, { q: "%' OR 1=1 --" })).toEqual([]);
    await expect(orders.list(nobody)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await new OrdersQuery(core.db, 'sandbox').list(owner)).toEqual([]);
  });

  it('detail: financials only with orders.view_financials; opening an order is recorded', async () => {
    const full = await orders.detail(owner, confirmedId);
    expect(full.canSeeFinancials).toBe(true);
    expect(full.items[0]).toMatchObject({ productType: 'HOTEL', fundingMethod: 'PROVIDER_MANAGED', booking: { status: 'CONFIRMED', providerBookingRef: bookingRef, voucherReady: true } });
    expect(full.items[0]!.guests?.holder).toMatchObject({ lastName: 'Yılmaz' });
    // 90.00 EUR net/night x 3 + 10 % commission = 297.00 EUR sold, 27.00 EUR commission.
    expect(full.items[0]!.financials).toEqual({ supplierCost: { currency: 'EUR', minor: '29700' }, sell: { currency: 'EUR', minor: '29700' }, providerCommission: { currency: 'EUR', minor: '2700' }, commissionStatus: 'EXPECTED' });
    expect(full.payment).toMatchObject({ mode: 'PROVIDER_MANAGED', status: 'CAPTURED', amount: { currency: 'EUR', minor: '29700' } });
    expect(JSON.stringify(full)).not.toMatch(/MOCK_secret|client_secret/);
    expect(full.timeline.map((e) => e.action)).toEqual(expect.arrayContaining(['provider_managed.payment_session_created']));

    const limited = await orders.detail(viewer, confirmedId);
    expect(limited.canSeeFinancials).toBe(false);
    expect(limited.items[0]!.financials).toBeNull();
    const views = await core.db.execute<{ actor: string }>(sql`SELECT actor FROM core.audit_logs WHERE entity_type = 'order_access' AND entity_id = ${confirmedId} ORDER BY id`);
    expect(views.rows.map((r) => r.actor)).toEqual([owner.id, viewer.id]);
    await expect(orders.detail(owner, '00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(new OrdersQuery(core.db, 'sandbox').detail(owner, confirmedId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('tasks: viewers see them; tasks.manage takes and resolves with a written resolution', async () => {
    const open = await orders.tasks(viewer, 'OPEN');
    expect(open).toHaveLength(1);
    const task = open[0]!;
    await expect(orders.takeTask(viewer, task.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await orders.takeTask(owner, task.id);
    await expect(orders.resolveTask(owner, task.id, 'ok')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await orders.resolveTask(owner, task.id, 'Müşteri arandı; provizyon Nuitee tarafından kaldırılacak.');
    await expect(orders.resolveTask(owner, task.id, 'again, already closed')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await orders.tasks(owner, 'OPEN')).toEqual([]);
    const [resolved] = await orders.tasks(owner, 'RESOLVED');
    expect(resolved).toMatchObject({ status: 'RESOLVED', assignee: owner.id, resolution: 'Müşteri arandı; provizyon Nuitee tarafından kaldırılacak.' });
    const detail = await orders.detail(owner, waitingId);
    expect(detail.timeline.map((e) => e.action)).toEqual(expect.arrayContaining(['task.assigned', 'task.resolved']));
  });
});
