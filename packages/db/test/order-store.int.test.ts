import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { VersionConflictError } from '@texholiday/contracts';
import { PackageOrchestrator, emit, setPaymentStatus, type OrderItemState } from '@texholiday/domain';
import { money } from '@texholiday/pricing';
import { DrizzleOrderStore, OutboxRepository, schema, type CoreDatabase } from '../src/index';
import { FakeBookingPort, FakeGateway, ok, providerState, rejected, unknown } from '../../domain/test/support/fakes';
import { policy } from '../../domain/test/support/fixtures';
import { dbError, freshDatabase, seedOrder } from './support/db';

let core: CoreDatabase;

beforeAll(async () => {
  core = await freshDatabase();
});
afterAll(async () => {
  await core?.close();
});

async function authorize(store: DrizzleOrderStore, orderId: string) {
  const agg = await store.load(orderId);
  agg.payment!.gatewayPaymentId = `MOCK-PAY-${orderId}`;
  agg.payment!.sessionRef = 'MOCK-SESSION';
  agg.payment!.authorizationExpiresAt = new Date(Date.now() + 6 * 86_400_000).toISOString();
  setPaymentStatus(agg, 'PENDING', 'UPSTREAM_RESULT', 'test', new Date());
  setPaymentStatus(agg, 'AUTHORIZED', 'RECONCILIATION', 'test', new Date());
  await store.save(agg);
}

function orchestrator(store: DrizzleOrderStore, gateway: FakeGateway, ports: Record<string, FakeBookingPort>) {
  return new PackageOrchestrator({
    store,
    gateway: () => gateway,
    bookings: (it: OrderItemState) => ports[it.productType] as FakeBookingPort,
    clock: () => new Date(),
    workerId: 'it-worker',
    serverIp: '10.0.0.1',
    policy,
  });
}

const ports = () => ({ HOTEL: new FakeBookingPort(), TRANSFER: new FakeBookingPort(), FLIGHT: new FakeBookingPort(true), EXPERIENCE: new FakeBookingPort() });

describe('DrizzleOrderStore', () => {
  it('round-trips the aggregate and bumps the version', async () => {
    const { orderId, total } = await seedOrder(core);
    const store = new DrizzleOrderStore(core.db);
    const agg = await store.load(orderId);
    expect(agg.version).toBe(1);
    expect(agg.chargeTotal).toEqual(money('EUR', total));
    expect(agg.items.map((i) => i.productType)).toEqual(['HOTEL', 'TRANSFER', 'FLIGHT']);
    expect(agg.items[2]!.booking.ticketing).toBe('PENDING');
    expect(agg.payment!.status).toBe('NEW');
    await store.save(agg);
    expect((await store.load(orderId)).version).toBe(2);
  });

  it('T17: concurrent writers -> exactly one wins; the loser writes no outbox rows', async () => {
    const { orderId } = await seedOrder(core);
    const store = new DrizzleOrderStore(core.db);
    const a = await store.load(orderId);
    const b = await store.load(orderId);
    emit(a, 'test.a', { n: 1 });
    emit(b, 'test.b', { n: 2 });
    await store.save(a);
    await expect(store.save(b)).rejects.toBeInstanceOf(VersionConflictError);
    const rows = await core.db.execute<{ type: string }>(sql`SELECT type FROM core.outbox_events WHERE aggregate_id = ${orderId}`);
    expect(rows.rows.map((r) => r.type)).toEqual(['test.a']);
  });

  it('refuses order updates that bypass optimistic versioning (DB trigger)', async () => {
    const { orderId } = await seedOrder(core);
    expect(await dbError(core.db.execute(sql`UPDATE core.orders SET status = 'CONFIRMED' WHERE id = ${orderId}`))).toMatch(/version must increase/);
  });
});

describe('orchestrator against PostgreSQL', () => {
  it('runs a package end-to-end: one capture, tasks/outbox/audit persisted', async () => {
    const { orderId } = await seedOrder(core);
    const store = new DrizzleOrderStore(core.db);
    await authorize(store, orderId);
    const gateway = new FakeGateway(money('EUR', 100000n));
    const p = ports();
    await orchestrator(store, gateway, p).drive(orderId);
    const agg = await store.load(orderId);
    expect(agg.status).toBe('CONFIRMED');
    expect(gateway.count('capture')).toBe(1);
    const events = await core.db.execute<{ type: string }>(sql`SELECT type FROM core.outbox_events WHERE aggregate_id = ${orderId} AND type = 'order.confirmed'`);
    expect(events.rows).toHaveLength(1);
    const audit = await core.db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM core.audit_logs WHERE entity_id = ${orderId}`);
    expect(Number(audit.rows[0]!.n)).toBeGreaterThan(5);
    // Client references are unique and persisted before the calls.
    const refs = await core.db.select({ ref: schema.providerBookings.clientReference }).from(schema.providerBookings);
    expect(new Set(refs.map((r) => r.ref).filter(Boolean)).size).toBe(refs.filter((r) => r.ref).length);
  });

  it('T24 + ledger: compensating cancellation penalty is booked as our expense, never a customer charge', async () => {
    const { orderId } = await seedOrder(core);
    const store = new DrizzleOrderStore(core.db);
    await authorize(store, orderId);
    const gateway = new FakeGateway(money('EUR', 100000n));
    const p = ports();
    p.TRANSFER.bookScript.push(rejected());
    p.HOTEL.cancelScript.push(ok({ ...providerState('CANCELLED'), penalty: money('EUR', 1500n) }));
    await orchestrator(store, gateway, p).drive(orderId, 100);
    const agg = await store.load(orderId);
    expect(agg.status).toBe('CANCELLED');
    expect(gateway.count('void')).toBe(1);
    expect(gateway.count('capture')).toBe(0);
    const ledger = await core.db.execute<{ account: string; direction: string; amount_minor: string }>(
      sql`SELECT account, direction, amount_minor::text FROM core.ledger_entries WHERE order_id = ${orderId} ORDER BY direction`,
    );
    expect(ledger.rows).toEqual([
      { account: 'liability:supplier_payable:nuitee', direction: 'CREDIT', amount_minor: '1500' },
      { account: 'expense:supplier_penalty', direction: 'DEBIT', amount_minor: '1500' },
    ]);
    expect(ledger.rows.some((r) => r.account.includes('customer'))).toBe(false);
    const tasks = await core.db.execute<{ reason: string }>(sql`SELECT reason FROM core.operation_tasks WHERE order_id = ${orderId}`);
    expect(tasks.rows.map((r) => r.reason)).toContain('SUPPLIER_LOSS_RECORDED');
  });

  it('T19 + T25: unknown create -> lookup only, task persisted once, no second book', async () => {
    const { orderId } = await seedOrder(core);
    const store = new DrizzleOrderStore(core.db);
    await authorize(store, orderId);
    const gateway = new FakeGateway(money('EUR', 100000n));
    const p = ports();
    p.HOTEL.bookScript.push(unknown());
    const o = orchestrator(store, gateway, p);
    await o.drive(orderId);
    await o.drive(orderId);
    await o.drive(orderId);
    expect(p.HOTEL.count('book')).toBe(1);
    expect(p.HOTEL.count('lookup')).toBe(2);
    const tasks = await core.db.execute<{ reason: string }>(sql`SELECT reason FROM core.operation_tasks WHERE order_id = ${orderId} AND status = 'OPEN'`);
    expect(tasks.rows.filter((r) => r.reason === 'BOOKING_UNKNOWN')).toHaveLength(1);
    // Delayed reconciliation events exist in the outbox (survive Redis loss).
    const delayed = await core.db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM core.outbox_events WHERE aggregate_id = ${orderId} AND type = 'order.advance' AND available_at > now()`);
    expect(Number(delayed.rows[0]!.n)).toBeGreaterThan(0);
    expect(gateway.count('void') + gateway.count('capture')).toBe(0);
  });

  it('T17 at DB level: two orchestrators racing send the provider call once', async () => {
    const { orderId } = await seedOrder(core, [{ productType: 'TRANSFER', providerId: 'welcome_pickups', charge: 10000n, rank: 20 }]);
    const store = new DrizzleOrderStore(core.db);
    await authorize(store, orderId);
    const gateway = new FakeGateway(money('EUR', 10000n));
    const p = ports();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    p.TRANSFER.bookScript.push(async () => {
      await gate;
      return ok(providerState('CONFIRMED'));
    });
    const r1 = orchestrator(store, gateway, p).step(orderId);
    const r2 = orchestrator(store, gateway, p).step(orderId);
    await new Promise((r) => setTimeout(r, 50));
    release();
    await Promise.all([r1, r2]);
    expect(p.TRANSFER.count('book')).toBe(1);
  });
});

describe('outbox relay primitives', () => {
  it('SKIP LOCKED: concurrent claimers get disjoint events; redrive recovers expired leases (T28)', async () => {
    const { orderId } = await seedOrder(core);
    const store = new DrizzleOrderStore(core.db);
    const agg = await store.load(orderId);
    for (let i = 0; i < 20; i += 1) emit(agg, 'relay.test', { i });
    await store.save(agg);
    const outbox = new OutboxRepository(core.db);
    await core.db.execute(sql`UPDATE core.outbox_events SET status = 'COMPLETED' WHERE type <> 'relay.test'`);
    const [a, b] = await Promise.all([outbox.claimDue(15, 0), outbox.claimDue(15, 0)]);
    const ids = [...a, ...b].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(20);
    // Leases of 0s are already expired: simulate Redis being flushed before handlers ran.
    await new Promise((r) => setTimeout(r, 20));
    expect(await outbox.redriveExpired()).toBe(20);
    expect((await outbox.counts()).PENDING).toBe(20);
  });

  it('failing handlers retry and finally park as DEAD (never silently dropped)', async () => {
    const outbox = new OutboxRepository(core.db);
    await core.db.execute(sql`UPDATE core.outbox_events SET status = 'COMPLETED'`);
    const { orderId } = await seedOrder(core);
    const store = new DrizzleOrderStore(core.db);
    const agg = await store.load(orderId);
    emit(agg, 'dead.test', {});
    await store.save(agg);
    let last: 'RETRY' | 'DEAD' = 'RETRY';
    for (let i = 0; i < 3; i += 1) {
      const [ev] = await outbox.claimDue(1, 60);
      last = await outbox.fail(ev!.id, 'boom', 0, 3);
    }
    expect(last).toBe('DEAD');
    expect((await outbox.counts()).DEAD).toBe(1);
  });
});
