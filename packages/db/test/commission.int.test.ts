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
    // Paid before the stay is allowed (EXPECTED -> RECEIVED), but only with its payout.
    expect(await dbError(core.db.execute(sql`UPDATE core.provider_commissions SET status = 'RECEIVED', payout_reference = 'P-1' WHERE id = ${id}`))).toMatch(/received_has_payout/);
    expect(await dbError(core.db.execute(sql`UPDATE core.provider_commissions SET status = 'EARNED' WHERE id = ${id}`))).toMatch(/earned_has_date/);
    await core.db.execute(sql`UPDATE core.provider_commissions SET status = 'EARNED', earned_at = now() WHERE id = ${id}`);
    expect(await dbError(core.db.execute(sql`UPDATE core.provider_commissions SET earned_at = now() - interval '1 day' WHERE id = ${id}`))).toMatch(/earned date can be set only once/);
    expect(await dbError(core.db.execute(sql`UPDATE core.provider_commissions SET status = 'RECEIVED', payout_reference = 'PAYOUT-2026-W41' WHERE id = ${id}`))).toMatch(/received_has_payout/);

    // A payout settles commissions of its own provider, currency and reference, adding up to its recorded sum.
    type Exec = Pick<typeof core.db, 'execute'>;
    const payout = async (db: Exec, reference: string, providerId: string, commissionsMinor: bigint) =>
      (await db.execute<{ id: string }>(sql`INSERT INTO core.commission_payouts (environment, provider_id, reference, currency, amount_minor, commissions_minor, received_on, recorded_by)
        VALUES ('mock', ${providerId}, ${reference}, 'EUR', ${commissionsMinor}, ${commissionsMinor}, '2026-10-10', 'staff:test') RETURNING id`)).rows[0]!.id;
    const settle = (payoutId: string, reference: string) => sql`UPDATE core.provider_commissions SET status = 'RECEIVED', payout_id = ${payoutId}, payout_reference = ${reference} WHERE id = ${id}`;
    expect(await dbError(core.db.transaction(async (tx) => tx.execute(settle(await payout(tx, 'P-OTHER', 'other_provider', 446n), 'P-OTHER'))))).toMatch(/does not match the commission/);
    expect(await dbError(core.db.transaction(async (tx) => tx.execute(settle(await payout(tx, 'P-WRONG-REF', 'nuitee', 446n), 'P-DIFFERENT'))))).toMatch(/does not match the commission/);
    expect(await dbError(core.db.transaction(async (tx) => tx.execute(settle(await payout(tx, 'P-WRONG-SUM', 'nuitee', 999n), 'P-WRONG-SUM'))))).toMatch(/settles 446 and nets 0 but records 999 and 0/);
    expect(await dbError(core.db.execute(sql`INSERT INTO core.commission_payouts (environment, provider_id, reference, currency, amount_minor, commissions_minor, received_on, recorded_by)
        VALUES ('mock', 'nuitee', 'P-NO-NOTE', 'EUR', 400, 446, '2026-10-10', 'staff:test')`))).toMatch(/difference_explained/);
    // A payout that settles nothing is refused at commit.
    expect(await dbError(payout(core.db, 'P-EMPTY', 'nuitee', 446n))).toMatch(/settles 0 and nets 0 but records 446 and 0/);
    let payoutId = '';
    await core.db.transaction(async (tx) => {
      payoutId = await payout(tx, 'PAYOUT-2026-W41', 'nuitee', 446n);
      await tx.execute(settle(payoutId, 'PAYOUT-2026-W41'));
    });
    expect(await dbError(core.db.execute(sql`UPDATE core.provider_commissions SET payout_reference = 'OTHER' WHERE id = ${id}`))).toMatch(/only once/);
    // Paid and earned: a cancellation cannot void it any more.
    expect(await dbError(core.db.execute(sql`UPDATE core.provider_commissions SET status = 'VOIDED' WHERE id = ${id}`))).toMatch(/RECEIVED -> VOIDED/);
    expect(await dbError(core.db.execute(sql`UPDATE core.commission_payouts SET amount_minor = 1 WHERE id = ${payoutId}`))).toMatch(/append-only|append only/i);
    expect(await dbError(core.db.execute(sql`DELETE FROM core.commission_payouts WHERE id = ${payoutId}`))).toMatch(/append-only|append only/i);
  });

  it('paid before the stay: earned later, or cancelled and owed back until a payout nets it (ADR-0019)', async () => {
    type Exec = Pick<typeof core.db, 'execute'>;
    const paidOrder = async () => {
      const o = await authorizedOrder();
      await run(o.store, { HOTEL: new FakeBookingPort(), TRANSFER: new FakeBookingPort() }).drive(o.orderId);
      return (await commissions(o.orderId)).rows[0]!.id;
    };
    const payout = async (db: Exec, reference: string, providerId: string, settled: bigint, netted: bigint, amount = settled - netted) =>
      (await db.execute<{ id: string }>(sql`INSERT INTO core.commission_payouts (environment, provider_id, reference, currency, amount_minor, commissions_minor, clawbacks_minor, received_on, note, recorded_by)
        VALUES ('mock', ${providerId}, ${reference}, 'EUR', ${amount}, ${settled}, ${netted}, '2026-10-10', 'test payout', 'staff:test') RETURNING id`)).rows[0]!.id;
    const pay = (db: Exec, id: string, payoutId: string, reference: string) =>
      db.execute(sql`UPDATE core.provider_commissions SET status = 'RECEIVED', payout_id = ${payoutId}, payout_reference = ${reference} WHERE id = ${id}`);
    const net = (db: Exec, id: string, payoutId: string) => db.execute(sql`UPDATE core.provider_commissions SET clawback_payout_id = ${payoutId} WHERE id = ${id}`);

    // Paid when the provider collected the payment, before the stay.
    const id = await paidOrder();
    const ref = `PRE-${id.slice(0, 8)}`;
    await core.db.transaction(async (tx) => pay(tx, id, await payout(tx, ref, 'nuitee', 446n, 0n), ref));
    // Refunds come out of the same payout's commissions; a payout of nothing but refunds is refused.
    expect(await dbError(payout(core.db, `${ref}-X`, 'nuitee', 0n, 446n, 0n))).toMatch(/amounts_valid/);
    // Still live: it cannot be netted; a cancellation voids it (owed back).
    const other = await paidOrder();
    expect(await dbError(core.db.transaction(async (tx) => net(tx, id, await payout(tx, `${ref}-C1`, 'nuitee', 446n, 446n))))).toMatch(/clawback_valid/);
    await core.db.execute(sql`UPDATE core.provider_commissions SET status = 'VOIDED' WHERE id = ${id}`);
    // Netted by a payout of another provider: refused; sums must match what is linked.
    expect(await dbError(core.db.transaction(async (tx) => net(tx, id, await payout(tx, `${ref}-C2`, 'other_provider', 446n, 446n))))).toMatch(/does not match the commission it nets/);
    expect(await dbError(core.db.transaction(async (tx) => net(tx, id, await payout(tx, `${ref}-C3`, 'nuitee', 446n, 446n))))).toMatch(/settles 0 and nets 446 but records 446 and 446/);
    // The next payout pays another commission and deducts this one: nothing arrives, the sums match.
    await core.db.transaction(async (tx) => {
      const p = await payout(tx, `${ref}-C4`, 'nuitee', 446n, 446n);
      await pay(tx, other, p, `${ref}-C4`);
      await net(tx, id, p);
    });
    expect(await dbError(core.db.transaction(async (tx) => net(tx, id, await payout(tx, `${ref}-C5`, 'nuitee', 446n, 446n))))).toMatch(/clawback can be set only once/);

    // Paid before the stay, earned after it (status stays RECEIVED); then it cannot be voided.
    const id2 = await paidOrder();
    const ref2 = `PRE-${id2.slice(0, 8)}`;
    await core.db.transaction(async (tx) => pay(tx, id2, await payout(tx, ref2, 'nuitee', 446n, 0n), ref2));
    await core.db.execute(sql`UPDATE core.provider_commissions SET earned_at = now() WHERE id = ${id2}`);
    expect(await dbError(core.db.execute(sql`UPDATE core.provider_commissions SET status = 'VOIDED' WHERE id = ${id2}`))).toMatch(/RECEIVED -> VOIDED/);
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
