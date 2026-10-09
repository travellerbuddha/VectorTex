import { DomainError, type Permission, type ProviderEnvironment, type StaffActor } from '@texholiday/contracts';
import { activePermissions, type CoreDb, type DrizzleOrderStore } from '@texholiday/db';
import type { ProviderManagedOrchestrator, StaffCancelResult, StatusCheckResult } from '@texholiday/domain';
import type { Money } from '@texholiday/pricing';

/**
 * Staff commands on orders (/yonetim → Siparişler). Authority comes from the person's active grants, read here on
 * every call (never from the caller or the UI). Only orders of this deployment's provider environment are touched,
 * and every command is audited on the order with the staff id.
 */
export class StaffOrderCommands {
  constructor(
    private readonly db: CoreDb,
    private readonly store: DrizzleOrderStore,
    private readonly orchestrator: ProviderManagedOrchestrator,
    private readonly environment: ProviderEnvironment,
  ) {}

  private async authorize(actor: StaffActor, orderId: string, permission: Permission): Promise<string> {
    if (actor.kind !== 'STAFF') throw new DomainError('FORBIDDEN', 'Staff only', { httpStatus: 403 });
    if (!(await activePermissions(this.db, actor.id)).has(permission)) throw new DomainError('FORBIDDEN', `Missing permission ${permission}`, { httpStatus: 403 });
    const agg = await this.store.load(orderId);
    if (agg.environment !== this.environment) throw new DomainError('NOT_FOUND', 'Order not found', { httpStatus: 404 });
    if (agg.route.mode !== 'PROVIDER_MANAGED') {
      // Own-gateway orders (iyzico, ADR-0008) get their commands with that integration.
      throw new DomainError('CAPABILITY_NOT_AVAILABLE', 'Commands for this payment route are not available yet', { httpStatus: 422 });
    }
    return `staff:${actor.id}`;
  }

  /** Reads the provider now and applies its answer (operations: `tasks.manage`). */
  async checkStatus(actor: StaffActor, orderId: string): Promise<StatusCheckResult> {
    return this.orchestrator.checkStatus(orderId, await this.authorize(actor, orderId, 'tasks.manage'));
  }

  /** Cancels a confirmed booking at the provider (`orders.cancel`), with a written reason. */
  async cancel(actor: StaffActor, orderId: string, reason: string): Promise<StaffCancelResult> {
    const text = reason.trim();
    if (text.length < 5 || text.length > 500) throw new DomainError('VALIDATION_FAILED', 'Give a reason (5-500 characters)', { httpStatus: 422 });
    return this.orchestrator.cancel(orderId, await this.authorize(actor, orderId, 'orders.cancel'), text);
  }

  /** Records a refund the provider made to the customer, after it was verified (`orders.record_refund`). */
  async recordProviderRefund(actor: StaffActor, orderId: string, amount: Money, reference: string) {
    return this.orchestrator.recordProviderRefund(orderId, await this.authorize(actor, orderId, 'orders.record_refund'), amount, reference);
  }
}
