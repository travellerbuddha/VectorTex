import { loadConfig } from '@texholiday/config';
import { OutboxRelay, startConsumer, type Logger } from './relay';
import { createRuntime } from './runtime';

const log: Logger = {
  info: (msg, meta) => console.log(JSON.stringify({ level: 'info', msg, ...meta })),
  warn: (msg, meta) => console.warn(JSON.stringify({ level: 'warn', msg, ...meta })),
  error: (msg, meta) => console.error(JSON.stringify({ level: 'error', msg, ...meta })),
};

async function main(): Promise<void> {
  const config = loadConfig(process.env); // fail-fast: invalid/placeholder secrets stop the process here
  const runtime = await createRuntime(config, process.env, log);
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
        log.error('relay tick failed', { error: String(err) });
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  };
  const running = loop();

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info('worker stopping', { signal });
    await running;
    await consumer.close();
    await relay.close();
    await runtime.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  log.error('worker failed to start', { error: String(err instanceof Error ? err.message : err) });
  process.exit(1);
});
