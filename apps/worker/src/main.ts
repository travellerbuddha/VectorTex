import { loadConfig } from '@texholiday/config';
import { errorMessage, jsonLogger } from '@texholiday/contracts';
import { mockConnectors } from '@texholiday/connectors';
import { CustomerAccountRepository } from '@texholiday/db';
import { OutboxRelay, startConsumer, type Logger } from './relay';
import { createRuntime } from './runtime';

// One JSON line per entry; personal data and secrets masked (T31).
const log: Logger = jsonLogger({ service: 'worker' });

async function main(): Promise<void> {
  const config = loadConfig(process.env); // fail-fast: invalid/placeholder secrets stop the process here
  // MOCK environment (local development and demo; refused in production by loadConfig): the same MOCK connectors as
  // the web process, so the hotel list scan and checkout deadlines run without a provider. With MOCK_STATE_DIR (the
  // demo) both processes share the MOCK provider's prebooks, payments and bookings, so the worker can finish a booking
  // paid on the site; without it each process has its own memory.
  const mock = config.providerEnvironment === 'mock' ? mockConnectors(process.env.MOCK_STATE_DIR) : null;
  const runtime = await createRuntime(config, process.env, log, new Map(), mock?.hotels ?? null, mock?.flights ?? null);
  const connection = { url: config.redis.url, maxRetriesPerRequest: null };
  const relayOpts = { batchSize: 100, dispatchLeaseSeconds: 600, maxAttempts: 12, retryDelaySeconds: (attempt: number) => Math.min(5 * 2 ** attempt, 900) };
  const relay = new OutboxRelay(runtime.outbox, connection, relayOpts, log);
  const consumer = startConsumer(runtime.outbox, connection, runtime.handlers, { ...relayOpts, concurrency: 8 }, log);

  let stopping = false;
  const loop = async () => {
    while (!stopping) {
      try {
        const n = await relay.tick();
        if (n === 0) await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        log.error('relay tick failed', { error: errorMessage(err) });
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  };
  const running = loop();
  // Hotel list prices (ADR-0014): one unit of work at a time at the shared provider pace; idle polls are slow.
  const pause = async (ms: number) => {
    // In one-second steps so a shutdown does not wait for the whole pause.
    for (let left = ms; left > 0 && !stopping; left -= 1000) await new Promise((r) => setTimeout(r, Math.min(1000, left)));
  };
  const scanLoop = async () => {
    const scanner = runtime.hotelListScanner;
    if (!scanner) return;
    while (!stopping) {
      try {
        const step = await scanner.tick();
        if (step === 'IDLE') await pause(30_000);
      } catch (err) {
        log.error('hotel list scan failed', { error: errorMessage(err) });
        await pause(30_000);
      }
    }
  };
  const scanning = scanLoop();
  // Hourly: expired customer sessions and old sign-in codes (ADR-0017); commissions whose stay has ended (ADR-0019).
  const housekeepingLoop = async () => {
    const accounts = new CustomerAccountRepository(runtime.core.db);
    while (!stopping) {
      try {
        await accounts.prune(new Date());
      } catch (err) {
        log.error('housekeeping failed', { error: errorMessage(err) });
      }
      try {
        const run = await runtime.commissions.earnDue(200);
        if (run.due > 0) log.info('commission earning', { ...run });
      } catch (err) {
        log.error('commission earning failed', { error: errorMessage(err) });
      }
      await pause(3_600_000);
    }
  };
  const housekeeping = housekeepingLoop();

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info('worker stopping', { signal });
    await running;
    await scanning;
    await housekeeping;
    await consumer.close();
    await relay.close();
    await runtime.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  log.error('worker failed to start', { error: errorMessage(err) });
  process.exit(1);
});
