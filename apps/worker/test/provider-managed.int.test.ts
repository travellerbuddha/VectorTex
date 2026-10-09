import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '@texholiday/config';
import { MockHotelConnector } from '@texholiday/connectors';
import { opaque } from '@texholiday/contracts';
import { DrizzleOrderStore } from '@texholiday/db';
import { setBookingStatus, setPaymentStatus } from '@texholiday/domain';
import { createRuntime, type Runtime } from '../src/runtime';
import { freshDatabase, seedOrder } from '../../../packages/db/test/support/db';

/** The worker finalizes provider-managed checkouts when the customer closed the browser (ADR-0008, §5.1). */
const quiet = { info: () => {}, warn: () => {}, error: () => {} };
let runtime: Runtime;

beforeAll(async () => {
  const db = await freshDatabase();
  await db.close();
  const url = process.env.TEST_DATABASE_URL!;
  const config = loadConfig({ APP_ENV: 'development', PROVIDER_ENV: 'mock', ALLOW_MOCK_ADAPTERS: 'true', PAYLOAD_ENABLED: 'false', DATABASE_URL: url, REDIS_URL: process.env.TEST_REDIS_URL });
  runtime = await createRuntime(config, { WORKER_ID: 'it-worker' }, quiet, new Map(), new MockHotelConnector());
});
afterAll(async () => {
  await runtime?.close();
});

describe('worker: provider-managed finalize jobs', () => {
  it('a scheduled finalize on an unknown order fails loudly (retried by the relay), never silently', async () => {
    await expect(runtime.handlers['order.provider_managed.finalize']!({ orderId: '00000000-0000-0000-0000-000000000000', attempt: 1 }, { eventId: 'e1', attempts: 1 })).rejects.toThrow();
  });

  it('abandons an unpaid checkout at its deadline without any booking call', async () => {
    const { orderId } = await seedOrder(runtime.core, [{ productType: 'HOTEL', providerId: 'nuitee', charge: 50000n, rank: 10, needsPrebook: true }], 'mock', { mode: 'PROVIDER_MANAGED' });
    const store = new DrizzleOrderStore(runtime.core.db);
    // State after a payment session was opened (prebook with the payment component), deadline already passed.
    const agg = await store.load(orderId);
    const now = new Date();
    setBookingStatus(agg, agg.items[0]!.id, 'PREPARED', 'UPSTREAM_RESULT', 'test', now);
    agg.items[0]!.booking.prebookRef = opaque('MOCK-PRE-W1');
    setPaymentStatus(agg, 'PENDING', 'UPSTREAM_RESULT', 'test', now);
    agg.payment!.providerTransaction = { prebookRef: opaque('MOCK-PRE-W1'), transactionId: opaque('MOCK-TX-W1') };
    agg.payment!.providerClientSecret = 'MOCK_secret_W1';
    agg.payment!.payBy = new Date(now.getTime() - 1000).toISOString();
    await store.save(agg);

    await runtime.handlers['order.provider_managed.finalize']!({ orderId, attempt: 3 }, { eventId: 'e2', attempts: 1 });
    const after = await store.load(orderId);
    expect(after).toMatchObject({ status: 'CANCELLED', compensationReason: 'CHECKOUT_EXPIRED' });
    expect(after.payment).toMatchObject({ status: 'DECLINED', providerClientSecret: null });
  });
});
