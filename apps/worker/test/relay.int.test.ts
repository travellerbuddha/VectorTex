import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { sql } from 'drizzle-orm';
import { DrizzleOrderStore, OutboxRepository, type CoreDatabase } from '@texholiday/db';
import { emit } from '@texholiday/domain';
import { freshDatabase, seedOrder } from '../../../packages/db/test/support/db';
import { OutboxRelay, startConsumer, type EventHandler, type Logger } from '../src/relay';

const redisUrl = process.env.TEST_REDIS_URL;
if (!redisUrl) throw new Error('Integration tests need TEST_REDIS_URL (a disposable Redis database; it is flushed with FLUSHDB).');

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const opts = { batchSize: 50, dispatchLeaseSeconds: 1, maxAttempts: 5, retryDelaySeconds: () => 0 };

let core: CoreDatabase;
let redis: Redis;

beforeAll(async () => {
  core = await freshDatabase();
  redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  await redis.flushdb();
});
afterAll(async () => {
  await redis?.quit();
  await core?.close();
});

const waitFor = async (cond: () => Promise<boolean>, timeoutMs = 10_000) => {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe('T28 restart / Redis loss', () => {
  it('events lost from Redis are redriven from the PostgreSQL outbox and processed once', async () => {
    const { orderId } = await seedOrder(core);
    await core.db.execute(sql`UPDATE core.outbox_events SET status = 'COMPLETED'`);
    const store = new DrizzleOrderStore(core.db);
    const agg = await store.load(orderId);
    for (let i = 0; i < 5; i += 1) emit(agg, 'test.redis_loss', { i });
    await store.save(agg);

    const outbox = new OutboxRepository(core.db);
    const connection = { url: redisUrl, maxRetriesPerRequest: null } as const;
    const relay = new OutboxRelay(outbox, connection, opts, silent);

    // 1) Dispatch to Redis, then lose Redis before any consumer runs.
    expect(await relay.tick()).toBe(5);
    await redis.flushdb();
    expect((await outbox.counts()).DISPATCHED).toBe(5);

    // 2) After the dispatch lease expires the relay redrives from the DB.
    await new Promise((r) => setTimeout(r, 1200));
    const seen: number[] = [];
    const handler: EventHandler = async (payload) => {
      seen.push(payload.i as number);
    };
    const worker = startConsumer(outbox, connection, { 'test.redis_loss': handler }, { ...opts, concurrency: 2 }, silent);
    expect(await relay.tick()).toBe(5);
    await waitFor(async () => {
      const c = await outbox.counts();
      return seen.length === 5 && (c.PENDING ?? 0) === 0 && (c.DISPATCHED ?? 0) === 0;
    });
    await worker.close();
    await relay.close();

    expect(seen.sort()).toEqual([0, 1, 2, 3, 4]);
    const counts = await outbox.counts();
    expect(counts.PENDING ?? 0).toBe(0);
    expect(counts.DISPATCHED ?? 0).toBe(0);
  });

  it('a failing handler is retried from the outbox and does not block other events', async () => {
    await core.db.execute(sql`UPDATE core.outbox_events SET status = 'COMPLETED'`);
    const { orderId } = await seedOrder(core);
    await core.db.execute(sql`UPDATE core.outbox_events SET status = 'COMPLETED'`);
    const store = new DrizzleOrderStore(core.db);
    const agg = await store.load(orderId);
    emit(agg, 'test.flaky', {});
    emit(agg, 'test.ok', {});
    await store.save(agg);

    const outbox = new OutboxRepository(core.db);
    const connection = { url: redisUrl, maxRetriesPerRequest: null } as const;
    const relay = new OutboxRelay(outbox, connection, { ...opts, dispatchLeaseSeconds: 30 }, silent);
    let flakyCalls = 0;
    const worker = startConsumer(
      outbox,
      connection,
      {
        'test.flaky': async () => {
          flakyCalls += 1;
          if (flakyCalls === 1) throw new Error('transient');
        },
        'test.ok': async () => {},
      },
      { ...opts, concurrency: 1 },
      silent,
    );
    await relay.tick();
    await waitFor(async () => flakyCalls >= 1 && ((await outbox.counts()).PENDING ?? 0) >= 1);
    await relay.tick();
    await waitFor(async () => ((await outbox.counts()).PENDING ?? 0) === 0 && ((await outbox.counts()).DISPATCHED ?? 0) === 0);
    await worker.close();
    await relay.close();
    expect(flakyCalls).toBe(2);
  });
});
