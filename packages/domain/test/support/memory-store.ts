import { VersionConflictError } from '@texholiday/contracts';
import type { CommissionChange, OrderAggregate, OrderStore, PendingEvent } from '../../src/index';

/**
 * TEST DOUBLE (in-memory). Mirrors the PostgreSQL repository contract: optimistic version check,
 * events persisted atomically with the state, pending arrays cleared after save.
 */
export class InMemoryOrderStore implements OrderStore {
  private readonly rows = new Map<string, OrderAggregate>();
  readonly outbox: Array<PendingEvent & { orderId: string; version: number }> = [];
  readonly auditLog: Array<{ orderId: string; action: string; detail: Record<string, unknown> }> = [];
  readonly commissions: Array<CommissionChange & { orderId: string }> = [];
  saves = 0;
  /** Hook to simulate a concurrent writer between load and save. */
  beforeSave: ((agg: OrderAggregate) => void) | null = null;

  put(agg: OrderAggregate): void {
    this.rows.set(agg.id, structuredClone({ ...agg, pendingEvents: [], pendingAudit: [], pendingCommissions: [] }));
  }

  async load(orderId: string): Promise<OrderAggregate> {
    const row = this.rows.get(orderId);
    if (!row) throw new Error(`no order ${orderId}`);
    return structuredClone(row);
  }

  async save(agg: OrderAggregate): Promise<number> {
    this.beforeSave?.(agg);
    const current = this.rows.get(agg.id);
    if (!current || current.version !== agg.version) throw new VersionConflictError('order', agg.id);
    const nextVersion = agg.version + 1;
    for (const e of agg.pendingEvents) this.outbox.push({ ...e, orderId: agg.id, version: nextVersion });
    for (const a of agg.pendingAudit) this.auditLog.push({ orderId: agg.id, action: a.action, detail: a.detail });
    for (const c of agg.pendingCommissions) this.commissions.push({ ...c, orderId: agg.id });
    this.rows.set(agg.id, structuredClone({ ...agg, version: nextVersion, pendingEvents: [], pendingAudit: [], pendingCommissions: [] }));
    agg.version = nextVersion;
    agg.pendingEvents = [];
    agg.pendingAudit = [];
    agg.pendingCommissions = [];
    this.saves += 1;
    return nextVersion;
  }

  peek(orderId: string): OrderAggregate {
    return structuredClone(this.rows.get(orderId) as OrderAggregate);
  }
}
