import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { IdempotencyConflictError } from '@texholiday/contracts';
import type { CoreDb } from './client';
import { idempotencyKeys, inboxEvents, outboxEvents } from './schema';

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Stable JSON for request hashing (key order independent). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : typeof v === 'bigint' ? v.toString() : v,
  );
}

export interface ClaimedEvent {
  id: string;
  aggregateId: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** Transactional outbox: the database is the system of record; the queue only distributes (ADR-0004). */
export class OutboxRepository {
  constructor(private readonly db: CoreDb) {}

  /** Leases due PENDING events with SKIP LOCKED, so concurrent relays never claim the same row. */
  async claimDue(limit: number, leaseSeconds: number): Promise<ClaimedEvent[]> {
    const result = await this.db.execute<{ id: string; aggregate_id: string; type: string; payload: Record<string, unknown>; attempts: number }>(sql`
      UPDATE core.outbox_events AS o
         SET status = 'DISPATCHED', attempts = o.attempts + 1, dispatched_at = now(),
             locked_until = now() + make_interval(secs => ${leaseSeconds})
       WHERE o.id IN (
         SELECT id FROM core.outbox_events
          WHERE status = 'PENDING' AND available_at <= now()
          ORDER BY available_at, created_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)
      RETURNING o.id, o.aggregate_id, o.type, o.payload, o.attempts`);
    return result.rows.map((r) => ({ id: r.id, aggregateId: r.aggregate_id, type: r.type, payload: r.payload, attempts: r.attempts }));
  }

  async complete(id: string): Promise<boolean> {
    const rows = await this.db
      .update(outboxEvents)
      .set({ status: 'COMPLETED', completedAt: sql`now()`, lockedUntil: null, lastError: null })
      .where(and(eq(outboxEvents.id, id), eq(outboxEvents.status, 'DISPATCHED')))
      .returning({ id: outboxEvents.id });
    return rows.length === 1;
  }

  /** Handler failed: retry later, or park as DEAD after maxAttempts (an operator alert, never silently dropped). */
  async fail(id: string, error: string, retryInSeconds: number, maxAttempts: number): Promise<'RETRY' | 'DEAD'> {
    const result = await this.db.execute<{ status: 'PENDING' | 'DEAD' }>(sql`
      UPDATE core.outbox_events
         SET status = CASE WHEN attempts >= ${maxAttempts} THEN 'DEAD'::core.outbox_status ELSE 'PENDING'::core.outbox_status END,
             available_at = now() + make_interval(secs => ${retryInSeconds}),
             locked_until = NULL,
             last_error = ${error.slice(0, 2000)}
       WHERE id = ${id} AND status = 'DISPATCHED'
      RETURNING status`);
    return result.rows[0]?.status === 'DEAD' ? 'DEAD' : 'RETRY';
  }

  /**
   * Recovery after Redis loss or a worker crash: dispatched events whose lease expired go back to PENDING.
   * Handlers are idempotent, so a redelivered event cannot create a second financial movement.
   */
  async redriveExpired(): Promise<number> {
    const result = await this.db.execute(sql`
      UPDATE core.outbox_events SET status = 'PENDING', locked_until = NULL
       WHERE status = 'DISPATCHED' AND locked_until < now()`);
    return result.rowCount ?? 0;
  }

  async counts(): Promise<Record<string, number>> {
    const result = await this.db.execute<{ status: string; n: string }>(sql`SELECT status, count(*)::text AS n FROM core.outbox_events GROUP BY status`);
    return Object.fromEntries(result.rows.map((r) => [r.status, Number(r.n)]));
  }
}

/** Inbox: provider/gateway notifications are recorded once; repeats are acknowledged and ignored (T18). */
export class InboxRepository {
  constructor(private readonly db: CoreDb) {}

  async record(input: { source: string; dedupeKey: string; environment: 'mock' | 'sandbox' | 'production'; rawBody: string }): Promise<{ duplicate: boolean; id: string | null }> {
    const rows = await this.db
      .insert(inboxEvents)
      .values({ source: input.source, dedupeKey: input.dedupeKey, environment: input.environment, payloadSha256: sha256(input.rawBody) })
      .onConflictDoNothing()
      .returning({ id: inboxEvents.id });
    return rows[0] ? { duplicate: false, id: rows[0].id } : { duplicate: true, id: null };
  }

  async markProcessed(id: string): Promise<void> {
    await this.db.update(inboxEvents).set({ processedAt: sql`now()` }).where(eq(inboxEvents.id, id));
  }
}

export type IdempotencyBegin =
  | { state: 'NEW' }
  | { state: 'IN_PROGRESS' }
  | { state: 'COMPLETED'; status: number; body: unknown };

/** API idempotency (§7 rule 3): same key + different body -> 409; same key + same body -> stored response. */
export class IdempotencyRepository {
  constructor(private readonly db: CoreDb) {}

  async begin(scope: string, key: string, request: unknown, ttlSeconds: number): Promise<IdempotencyBegin> {
    const requestSha256 = sha256(canonicalJson(request));
    const inserted = await this.db
      .insert(idempotencyKeys)
      .values({ scope, key, requestSha256, status: 'IN_PROGRESS', expiresAt: sql`now() + make_interval(secs => ${ttlSeconds})` as unknown as string })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });
    if (inserted.length === 1) return { state: 'NEW' };
    const [existing] = await this.db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
    if (!existing) return this.begin(scope, key, request, ttlSeconds);
    if (existing.requestSha256 !== requestSha256) throw new IdempotencyConflictError();
    if (existing.status === 'COMPLETED') return { state: 'COMPLETED', status: existing.responseStatus ?? 200, body: existing.responseBody };
    return { state: 'IN_PROGRESS' };
  }

  async complete(scope: string, key: string, status: number, body: unknown): Promise<void> {
    await this.db
      .update(idempotencyKeys)
      .set({ status: 'COMPLETED', responseStatus: status, responseBody: body as Record<string, unknown> })
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
  }
}
