import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { opaque, type ExternalOutcome, type ProviderBookingState } from '@texholiday/contracts';
import { ProviderManagedOrchestrator, type ProviderManagedBookingPort, type ProviderManagedPrebook } from '@texholiday/domain';
import { money } from '@texholiday/pricing';
import { DrizzleOrderStore, type CoreDatabase } from '../src/index';
import { ok, providerState, rejected } from '../../domain/test/support/fakes';
import { dbError, freshDatabase, seedOrder, type SeedItem } from './support/db';

/** ADR-0008: provider-managed (Nuitee payment SDK) checkout persisted in PostgreSQL. */
let core: CoreDatabase;
beforeAll(async () => {
  core = await freshDatabase();
});
afterAll(async () => {
  await core?.close();
});

const HOTEL: SeedItem[] = [{ productType: 'HOTEL', providerId: 'nuitee', charge: 50000n, rank: 10, needsPrebook: true, commission: 4500n }];

/** TEST DOUBLE (MOCK) provider-managed port. */
function port(transactionId: string, book: Array<ExternalOutcome<ProviderBookingState>>): ProviderManagedBookingPort & { books: string[] } {
  const books: string[] = [];
  return {
    books,
    async prebookForPayment(): Promise<ExternalOutcome<ProviderManagedPrebook>> {
      return ok({ prebookRef: opaque(`MOCK-PRE-${transactionId}`), transactionId: opaque(transactionId), clientSecret: `MOCK_secret_${transactionId}`, differences: [] });
    },
    async book(_a, _i, clientReference) {
      books.push(clientReference);
      return book.shift() ?? ok(providerState('CONFIRMED', { providerCommission: money('EUR', 4500n) }));
    },
    async lookup() {
      return ok(null);
    },
  };
}

const orchestrator = (store: DrizzleOrderStore, p: ProviderManagedBookingPort) =>
  new ProviderManagedOrchestrator({
    store,
    port: p,
    clock: () => new Date(),
    workerId: 'it-pm',
    policy: { intentLeaseSeconds: 300, finalizeRetrySeconds: () => 30, maxAutomaticLookups: 3 },
  });

describe('provider-managed checkout in PostgreSQL', () => {
  it('session -> unpaid return -> paid -> confirmed: transaction persisted, secret cleared, commission recorded', async () => {
    const { orderId } = await seedOrder(core, HOTEL, 'mock', { mode: 'PROVIDER_MANAGED' });
    const store = new DrizzleOrderStore(core.db);
    const p = port('MOCK-TX-A', [rejected('NUITEE_PAYMENT_NOT_COMPLETED')]);
    const pm = orchestrator(store, p);
    await pm.start(orderId);
    let agg = await store.load(orderId);
    expect(agg.payment).toMatchObject({ status: 'PENDING', providerTransaction: { transactionId: 'MOCK-TX-A' }, providerClientSecret: 'MOCK_secret_MOCK-TX-A' });
    expect(agg.payment!.payBy).not.toBeNull();
    await pm.finalize(orderId, 1);
    expect((await store.load(orderId)).payment!.status).toBe('PENDING');
    await pm.finalize(orderId, 2);
    agg = await store.load(orderId);
    expect(agg.status).toBe('CONFIRMED');
    expect(agg.payment).toMatchObject({ status: 'CAPTURED', providerClientSecret: null });
    // "Payment not completed" uses up the client reference at Nuitee (sandbox 2026-10-09): the retry sends a new one.
    expect(p.books).toHaveLength(2);
    expect(new Set(p.books).size).toBe(2);
    expect(agg.items[0]!.booking.clientReferenceSeq).toBe(2);
    const commission = await core.db.execute<{ status: string; payment_mode: string; amount_minor: string }>(
      sql`SELECT c.status, c.payment_mode, c.amount_minor::text FROM core.provider_commissions c JOIN core.order_items i ON i.id = c.order_item_id WHERE i.order_id = ${orderId}`,
    );
    expect(commission.rows).toEqual([{ status: 'EXPECTED', payment_mode: 'PROVIDER_MANAGED', amount_minor: '4500' }]);
    const events = await core.db.execute<{ type: string }>(sql`SELECT type FROM core.outbox_events WHERE aggregate_id = ${orderId} ORDER BY id`);
    expect(events.rows.map((r) => r.type)).toEqual(
      expect.arrayContaining(['order.payment_session_ready', 'order.provider_managed.finalize', 'order.confirmed']),
    );
    const audit = await core.db.execute<{ detail: unknown }>(sql`SELECT detail FROM core.audit_logs WHERE entity_id = ${orderId}`);
    expect(JSON.stringify(audit.rows)).not.toContain('MOCK_secret');
  });

  it('a provider transaction id belongs to one payment attempt per environment', async () => {
    const a = await seedOrder(core, HOTEL, 'mock', { mode: 'PROVIDER_MANAGED' });
    const b = await seedOrder(core, HOTEL, 'mock', { mode: 'PROVIDER_MANAGED' });
    const store = new DrizzleOrderStore(core.db);
    await orchestrator(store, port('MOCK-TX-DUP', [])).start(a.orderId);
    expect(await dbError(orchestrator(store, port('MOCK-TX-DUP', [])).start(b.orderId))).toMatch(/payment_attempts_provider_tx_uq/);
  });

  it('own-gateway attempts can never carry provider-managed fields', async () => {
    const { orderId } = await seedOrder(core);
    expect(await dbError(core.db.execute(sql`UPDATE core.payment_attempts SET provider_client_secret = 'x' WHERE order_id = ${orderId}`))).toMatch(/payment_attempts_provider_fields/);
    expect(await dbError(core.db.execute(sql`UPDATE core.payment_attempts SET provider_prebook_ref = 'p' WHERE order_id = ${orderId}`))).toMatch(/payment_attempts_provider_fields/);
  });

  it('an abandoned checkout is cancelled at the deadline with no booking call', async () => {
    const { orderId } = await seedOrder(core, HOTEL, 'mock', { mode: 'PROVIDER_MANAGED', payBy: new Date(Date.now() + 50).toISOString() });
    const store = new DrizzleOrderStore(core.db);
    const p = port('MOCK-TX-EXP', []);
    await orchestrator(store, p).start(orderId);
    await new Promise((r) => setTimeout(r, 80));
    await orchestrator(store, p).finalize(orderId);
    const agg = await store.load(orderId);
    expect(agg).toMatchObject({ status: 'CANCELLED', compensationReason: 'CHECKOUT_EXPIRED' });
    expect(agg.payment).toMatchObject({ status: 'DECLINED', providerClientSecret: null });
    expect(p.books).toEqual([]);
  });
});
