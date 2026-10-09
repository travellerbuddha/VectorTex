import pg from 'pg';
import { money } from '@texholiday/pricing';
import { opaque } from '@texholiday/contracts';
import { CheckoutRepository, QuoteRepository, createCoreDatabase, migrateCore, schema, type CoreDatabase, type SubmitItem } from '../../src/index';

/** Drizzle wraps driver errors; the PostgreSQL message (e.g. from a trigger) is on `cause`. */
export async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const e = err as { message?: string; cause?: { message?: string } };
    return `${e.cause?.message ?? ''} ${e.message ?? ''}`;
  }
  throw new Error('expected the database to refuse the statement');
}

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Integration tests need TEST_DATABASE_URL (a disposable PostgreSQL database; its core schema is dropped).');
  return url;
}

/** Drops and re-creates the core schema in the disposable test database. */
export async function freshDatabase(): Promise<CoreDatabase> {
  const url = testDatabaseUrl();
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS core CASCADE');
  await admin.end();
  await migrateCore(url);
  return createCoreDatabase(url, { max: 8 });
}

export interface SeedItem {
  productType: SubmitItem['productType'];
  providerId: string;
  charge: bigint;
  rank: number;
  needsPrebook?: boolean;
  requiresIssuance?: boolean;
  /** Commission included in the supplier cost (PROVIDER_API margin); default 0. */
  commission?: bigint;
}

export const SEED_PACKAGE: SeedItem[] = [
  { productType: 'HOTEL', providerId: 'nuitee', charge: 50000n, rank: 10, needsPrebook: true },
  { productType: 'TRANSFER', providerId: 'welcome_pickups', charge: 10000n, rank: 20 },
  { productType: 'FLIGHT', providerId: 'nuitee', charge: 40000n, rank: 30, needsPrebook: true, requiresIssuance: true },
];

/** Seeds a customer, accepted quote versions and a submitted own-gateway order (mock environment). */
export async function seedOrder(core: CoreDatabase, items: SeedItem[] = SEED_PACKAGE, environment: 'mock' | 'sandbox' | 'production' = 'mock') {
  const [customer] = await core.db.insert(schema.customers).values({ kind: 'GUEST', email: 'guest@example.test', locale: 'tr' }).returning({ id: schema.customers.id });
  const quotesRepo = new QuoteRepository(core.db);
  const submitItems: SubmitItem[] = [];
  for (const it of items) {
    const quoteId = await quotesRepo.createQuote(it.productType, it.providerId);
    const qv = await quotesRepo.addVersion(quoteId, {
      version: 1,
      environment,
      productType: it.productType,
      providerId: it.providerId,
      offerRef: opaque(`MOCK-OFFER-${it.productType}`),
      option: { label: it.productType },
      travelers: [{ travelerId: 't1', type: 'ADULT', age: null }],
      supplierCost: money('EUR', (it.charge * 9n) / 10n),
      providerCommission: money('EUR', it.commission ?? 0n),
      sell: money('EUR', it.charge),
      chargeNow: money('EUR', it.charge),
      fx: null,
      fees: [],
      payAtProperty: [],
      cancellation: { timezone: 'Europe/Istanbul', refundable: true, steps: [], providerText: null },
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      pricingPolicy: { id: 'pp-test', version: 1 },
    });
    await quotesRepo.accept(qv, 'terms-test-v1');
    submitItems.push({
      quoteVersionId: qv,
      productType: it.productType,
      providerId: it.providerId,
      connectorId: `mock-${it.productType.toLowerCase()}`,
      chargeAllocation: money('EUR', it.charge),
      supplierCost: money('EUR', (it.charge * 9n) / 10n),
      funding: { method: 'ACCOUNT_CARD', capabilityId: `cap-${it.productType}` },
      connector: {
        holdSemantics: it.needsPrebook ? 'PREBOOK_VALIDATION' : 'NONE',
        reversibilityRank: it.rank,
        requiresIssuance: it.requiresIssuance ?? false,
        needsPrebook: it.needsPrebook ?? false,
      },
    });
  }
  const total = items.reduce((a, i) => a + i.charge, 0n);
  const checkout = new CheckoutRepository(core.db);
  const ids = await checkout.submitOrder({
    customerId: customer!.id,
    environment,
    route: { mode: 'OWN_GATEWAY', gatewayId: 'mock-gateway', currency: 'EUR', settlementPlanId: 'plan-test', policyVersion: 'pp-test@1' },
    chargeTotal: money('EUR', total),
    items: submitItems,
    checkoutExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    payment: { gatewayId: 'mock-gateway', mode: 'OWN_GATEWAY', idempotencyKey: `idem-${Math.random().toString(36).slice(2)}` },
  });
  return { ...ids, customerId: customer!.id, total };
}
