import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { opaque } from '@texholiday/contracts';
import { PackageOrchestrator, setPaymentStatus, type OrderItemState } from '@texholiday/domain';
import { money } from '@texholiday/pricing';
import { DrizzleOrderStore, QuoteRepository, schema, type CoreDatabase } from '../src/index';
import { FakeBookingPort, FakeGateway, ok, providerState, rejected } from '../../domain/test/support/fakes';
import { policy } from '../../domain/test/support/fixtures';
import { dbError, freshDatabase, seedOrder, type SeedItem } from './support/db';

/** ADR-0006: provider commission receivables (own gateway with the provider API margin). */
let core: CoreDatabase;

beforeAll(async () => {
  core = await freshDatabase();
});
afterAll(async () => {
  await core?.close();
});

// Hotel sold at the provider price with a 1% API margin: supplier cost 450.00 includes commission 4.46 (TEST DATA).
const PACKAGE: SeedItem[] = [
  { productType: 'HOTEL', providerId: 'nuitee', charge: 50000n, rank: 10, needsPrebook: true, commission: 446n },
  { productType: 'TRANSFER', providerId: 'welcome_pickups', charge: 10000n, rank: 20 },
];

async function authorizedOrder(items: SeedItem[] = PACKAGE) {
  const { orderId } = await seedOrder(core, items);
  const store = new DrizzleOrderStore(core.db);
  const agg = await store.load(orderId);
  agg.payment!.gatewayPaymentId = `MOCK-PAY-${orderId}`;
  agg.payment!.sessionRef = 'MOCK-SESSION';
  agg.payment!.authorizationExpiresAt = new Date(Date.now() + 6 * 86_400_000).toISOString();
  setPaymentStatus(agg, 'PENDING', 'UPSTREAM_RESULT', 'test', new Date());
  setPaymentStatus(agg, 'AUTHORIZED', 'RECONCILIATION', 'test', new Date());
  await store.save(agg);
  return { orderId, store };
}

function run(store: DrizzleOrderStore, ports: Record<string, FakeBookingPort>) {
  return new PackageOrchestrator({
    store,
    gateway: () => new FakeGateway(money('EUR', 60000n)),
    bookings: (it: OrderItemState) => ports[it.productType] as FakeBookingPort,
    clock: () => new Date(),
    workerId: 'it-commission',
    serverIp: '10.0.0.1',
    policy,
  });
}

const commissions = (orderId: string) =>
  core.db.execute<{ id: string; status: string; source: string; amount_minor: string; currency: string; payment_mode: string; environment: string }>(
    sql`SELECT c.id, c.status, c.source, c.amount_minor::text, c.currency, c.payment_mode, c.environment
        FROM core.provider_commissions c JOIN core.order_items i ON i.id = c.order_item_id WHERE i.order_id = ${orderId}`,
  );

describe('provider commission receivable', () => {
  it('a confirmed booking records the reported commission once as EXPECTED; nothing is booked to the ledger yet', async () => {
    const { orderId, store } = await authorizedOrder();
    const ports = { HOTEL: new FakeBookingPort(), TRANSFER: new FakeBookingPort() };
    ports.HOTEL.bookScript.push(ok(providerState('CONFIRMED', { providerCommission: money('EUR', 446n) })));
    await run(store, ports).drive(orderId);

    const agg = await store.load(orderId);
    expect(agg.status).toBe('CONFIRMED');
    expect(agg.items[0]!.expectedProviderCommission).toEqual(money('EUR', 446n));
    expect(agg.items[0]!.booking.providerCommission).toEqual(money('EUR', 446n));
    expect(agg.items[1]!.expectedProviderCommission).toEqual(money('EUR', 0n));
    expect((await commissions(orderId)).rows).toEqual([
      expect.objectContaining({ status: 'EXPECTED', source: 'BOOKING', amount_minor: '446', currency: 'EUR', payment_mode: 'OWN_GATEWAY', environment: 'mock' }),
    ]);
    const ledger = await core.db.execute(sql`SELECT 1 FROM core.ledger_entries WHERE order_id = ${orderId} AND account LIKE '%commission%'`);
    expect(ledger.rows).toHaveLength(0);

    // A replayed confirmation is a no-op (unique per order item).
    agg.pendingCommissions.push({ itemId: agg.items[0]!.id, kind: 'EXPECTED', amount: money('EUR', 446n), source: 'BOOKING' });
    await store.save(agg);
    expect((await commissions(orderId)).rows).toHaveLength(1);
  });

  it('a compensating cancellation voids the expected commission', async () => {
    const { orderId, store } = await authorizedOrder();
    const ports = { HOTEL: new FakeBookingPort(), TRANSFER: new FakeBookingPort() };
    ports.TRANSFER.bookScript.push(rejected());
    await run(store, ports).drive(orderId, 100);
    expect((await store.load(orderId)).status).toBe('CANCELLED');
    expect((await commissions(orderId)).rows).toEqual([expect.objectContaining({ status: 'VOIDED', source: 'QUOTE', amount_minor: '446' })]);
  });

  it('status only moves forward; amount and identity are immutable; rows are never deleted', async () => {
    const { orderId, store } = await authorizedOrder();
    await run(store, { HOTEL: new FakeBookingPort(), TRANSFER: new FakeBookingPort() }).drive(orderId);
    const [row] = (await commissions(orderId)).rows;
    const id = row!.id;
    expect(await dbError(core.db.execute(sql`UPDATE core.provider_commissions SET amount_minor = 999 WHERE id = ${id}`))).toMatch(/immutable/);
    expect(await dbError(core.db.execute(sql`DELETE FROM core.provider_commissions WHERE id = ${id}`))).toMatch(/cannot be deleted/);
    expect(await dbError(core.db.execute(sql`UPDATE core.provider_commissions SET status = 'RECEIVED', payout_reference = 'P-1' WHERE id = ${id}`))).toMatch(/EXPECTED -> RECEIVED/);
    await core.db.execute(sql`UPDATE core.provider_commissions SET status = 'EARNED' WHERE id = ${id}`);
    expect(await dbError(core.db.execute(sql`UPDATE core.provider_commissions SET status = 'RECEIVED' WHERE id = ${id}`))).toMatch(/received_has_payout/);
    await core.db.execute(sql`UPDATE core.provider_commissions SET status = 'RECEIVED', payout_reference = 'PAYOUT-2026-W41' WHERE id = ${id}`);
    expect(await dbError(core.db.execute(sql`UPDATE core.provider_commissions SET payout_reference = 'OTHER' WHERE id = ${id}`))).toMatch(/only once/);
    expect(await dbError(core.db.execute(sql`UPDATE core.provider_commissions SET status = 'VOIDED' WHERE id = ${id}`))).toMatch(/RECEIVED -> VOIDED/);
  });

  it('refuses a receivable from another environment than its order (T15)', async () => {
    const { orderId } = await authorizedOrder();
    const [it] = await core.db.execute<{ id: string }>(sql`SELECT id FROM core.order_items WHERE order_id = ${orderId} ORDER BY position LIMIT 1`).then((r) => r.rows);
    expect(
      await dbError(
        core.db.insert(schema.providerCommissions).values({ orderItemId: it!.id, providerId: 'nuitee', environment: 'production', paymentMode: 'OWN_GATEWAY', status: 'EXPECTED', source: 'QUOTE', amountMinor: 1n, currency: 'EUR' }),
      ),
    ).toMatch(/does not match order environment/);
  });

  it('a quote commission must be part of the supplier cost, in its currency', async () => {
    const quotes = new QuoteRepository(core.db);
    const quoteId = await quotes.createQuote('HOTEL', 'nuitee');
    const base = {
      version: 1,
      environment: 'mock' as const,
      productType: 'HOTEL' as const,
      providerId: 'nuitee',
      offerRef: opaque('MOCK-OFFER'),
      option: {},
      travelers: [],
      supplierCost: money('EUR', 1000n),
      sell: money('EUR', 1000n),
      chargeNow: money('EUR', 1000n),
      fx: null,
      fees: [],
      payAtProperty: [],
      cancellation: { timezone: 'UTC', refundable: true, steps: [], providerText: null },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      pricingPolicy: { id: 'pp-test', version: 1 },
    };
    expect(await dbError(quotes.addVersion(quoteId, { ...base, providerCommission: money('EUR', 1001n) }))).toMatch(/commission_within_cost/);
    await expect(quotes.addVersion(quoteId, { ...base, providerCommission: money('USD', 10n) })).rejects.toThrow(/supplier cost currency/);
    await expect(quotes.addVersion(quoteId, { ...base, providerCommission: money('EUR', 10n) })).resolves.toBeTypeOf('string');
  });
});
