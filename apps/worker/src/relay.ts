import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import type { ClaimedEvent, OutboxRepository } from '@texholiday/db';

export const CORE_QUEUE = 'core-events';

export interface EventHandlerContext {
  eventId: string;
  attempts: number;
}

/** Handlers must be idempotent: an event can be delivered again after Redis loss or a crash. */
export type EventHandler = (payload: Record<string, unknown>, ctx: EventHandlerContext) => Promise<void>;

export interface RelayOptions {
  batchSize: number;
  /** How long a dispatched event may stay unacknowledged before it is redriven from the DB. */
  dispatchLeaseSeconds: number;
  maxAttempts: number;
  retryDelaySeconds: (attempt: number) => number;
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Moves due outbox events from PostgreSQL into BullMQ. The database stays the system of record:
 * if Redis is flushed, expired leases are redriven and the events are queued again (T28).
 */
export class OutboxRelay {
  private readonly queue: Queue;

  constructor(
    private readonly outbox: OutboxRepository,
    connection: ConnectionOptions,
    private readonly opts: RelayOptions,
    private readonly log: Logger,
  ) {
    this.queue = new Queue(CORE_QUEUE, { connection });
  }

  /** One relay pass; returns the number of events handed to the queue. */
  async tick(): Promise<number> {
    const redriven = await this.outbox.redriveExpired();
    if (redriven > 0) this.log.warn('outbox events redriven after lease expiry', { redriven });
    const events = await this.outbox.claimDue(this.opts.batchSize, this.opts.dispatchLeaseSeconds);
    for (const ev of events) await this.dispatch(ev);
    return events.length;
  }

  private async dispatch(ev: ClaimedEvent): Promise<void> {
    try {
      // jobId = outbox id: BullMQ ignores a duplicate add while the same job still exists.
      await this.queue.add(ev.type, { eventId: ev.id, payload: ev.payload, attempts: ev.attempts }, { jobId: ev.id, removeOnComplete: true, removeOnFail: true, attempts: 1 });
    } catch (err) {
      this.log.error('queue add failed; event returns to PENDING', { eventId: ev.id, error: String(err) });
      await this.outbox.fail(ev.id, `queue add failed: ${String(err)}`, this.opts.retryDelaySeconds(ev.attempts), this.opts.maxAttempts);
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

/** Consumes queued events, runs the registered handler and acknowledges in the outbox. */
export function startConsumer(
  outbox: OutboxRepository,
  connection: ConnectionOptions,
  handlers: Readonly<Record<string, EventHandler>>,
  opts: RelayOptions & { concurrency: number },
  log: Logger,
): Worker {
  return new Worker(
    CORE_QUEUE,
    async (job: Job<{ eventId: string; payload: Record<string, unknown>; attempts: number }>) => {
      const { eventId, payload, attempts } = job.data;
      const handler = handlers[job.name];
      try {
        if (handler) await handler(payload, { eventId, attempts });
        else log.info('no subscriber for event type; acknowledged', { type: job.name, eventId });
        await outbox.complete(eventId);
      } catch (err) {
        const result = await outbox.fail(eventId, String(err), opts.retryDelaySeconds(attempts), opts.maxAttempts);
        (result === 'DEAD' ? log.error : log.warn)('event handler failed', { type: job.name, eventId, result, error: String(err) });
      }
    },
    { connection, concurrency: opts.concurrency },
  );
}
