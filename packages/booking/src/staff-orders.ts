import { DomainError, type FlightConnector, type Permission, type ProviderEnvironment, type StaffActor } from '@texholiday/contracts';
import { activePermissions, QuoteRepository, type CoreDb, type DrizzleOrderStore } from '@texholiday/db';
import { freeCancellation, penaltyAt, type ProviderManagedOrchestrator, type StaffCancelResult, type StatusCheckResult } from '@texholiday/domain';
import type { Money } from '@texholiday/pricing';

/**
 * What cancelling now is expected to cost the customer (spec §16): from the booking's cancellation policy (hotels), or
 * from the provider's cancellation quote (flights publish no penalty schedule, ADR-0011). Without a quote the whole
 * amount paid is assumed.
 */
export interface CancellationPreview {
  expectedPenalty: Money;
  basis: 'FREE' | 'POLICY_STEP' | 'NON_REFUNDABLE' | 'PROVIDER_QUOTE' | 'PROVIDER_QUOTE_UNAVAILABLE';
  /** Last instant without a penalty, when the policy has one. */
  freeUntil: string | null;
  /** Flights: the provider's quote (its confidence, the potential maximum refund and where it goes). */
  providerQuote: { confidence: string; refund: Money | null; destination: string } | null;
}

/**
 * Staff commands on orders (/yonetim → Siparişler). Authority comes from the person's active grants, read here on
 * every call (never from the caller or the UI). Only orders of this deployment's provider environment are touched,
 * and every command is audited on the order with the staff id.
 */
export class StaffOrderCommands {
  private readonly quotes: QuoteRepository;

  constructor(
    private readonly db: CoreDb,
    private readonly store: DrizzleOrderStore,
    private readonly orchestrator: ProviderManagedOrchestrator,
    private readonly environment: ProviderEnvironment,
    private readonly clock: () => Date = () => new Date(),
    private readonly flights: FlightConnector | null = null,
  ) {
    this.quotes = new QuoteRepository(db);
  }

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

  /**
   * The expected cancellation fee if cancelled now, from the accepted offer's policy (`orders.cancel`). Nuitee sets the
   * final amount; a non-refundable booking is expected to cost the full amount paid.
   */
  async cancellationPreview(actor: StaffActor, orderId: string): Promise<CancellationPreview> {
    await this.authorize(actor, orderId, 'orders.cancel');
    return this.preview(orderId);
  }

  private async preview(orderId: string): Promise<CancellationPreview> {
    const agg = await this.store.load(orderId);
    const it = agg.items[0]!;
    const quote = await this.quotes.get(it.quoteVersionId);
    if (!quote) throw new DomainError('NOT_FOUND', 'Order not found', { httpStatus: 404 });
    const policy = quote.cancellation;
    const paid = agg.payment!.amount;
    if (it.productType === 'FLIGHT') {
      // The provider's quote is the only source of the cost (sandbox 2026-10-09 always answered 500/59099).
      const ref = it.booking.providerBookingRef;
      const q = ref && this.flights ? await this.flights.cancellationQuote(ref) : null;
      if (q?.kind === 'SUCCEEDED' && q.value.penalty && q.value.penalty.currency === paid.currency) {
        return { expectedPenalty: q.value.penalty, basis: 'PROVIDER_QUOTE', freeUntil: null, providerQuote: { confidence: q.value.confidence, refund: q.value.refund, destination: q.value.destination } };
      }
      return { expectedPenalty: paid, basis: 'PROVIDER_QUOTE_UNAVAILABLE', freeUntil: null, providerQuote: null };
    }
    const free = freeCancellation(policy);
    if (free.kind === 'NON_REFUNDABLE') return { expectedPenalty: paid, basis: 'NON_REFUNDABLE', freeUntil: null, providerQuote: null };
    const penalty = penaltyAt(policy, this.clock(), paid.currency);
    return {
      expectedPenalty: penalty,
      basis: penalty.minor > 0n ? 'POLICY_STEP' : 'FREE',
      freeUntil: free.kind === 'FREE_UNTIL' ? free.lastFreeInstant.toISOString() : null,
      providerQuote: null,
    };
  }

  /**
   * Cancels a confirmed booking at the provider (`orders.cancel`), with a written reason. When a fee is expected, the
   * staff member must confirm that the customer accepted it (spec §16: current cost and a justified approval).
   */
  async cancel(actor: StaffActor, orderId: string, reason: string, opts: { customerAcceptedFee: boolean }): Promise<StaffCancelResult> {
    const text = reason.trim();
    if (text.length < 5 || text.length > 500) throw new DomainError('VALIDATION_FAILED', 'Give a reason (5-500 characters)', { httpStatus: 422 });
    const by = await this.authorize(actor, orderId, 'orders.cancel');
    const preview = await this.preview(orderId);
    if (preview.expectedPenalty.minor > 0n && !opts.customerAcceptedFee) {
      throw new DomainError('VALIDATION_FAILED', 'Confirm that the customer accepted the cancellation fee', { httpStatus: 422 });
    }
    return this.orchestrator.cancel(orderId, by, text, { expectedPenalty: preview.expectedPenalty, customerAcceptedFee: opts.customerAcceptedFee });
  }

  /** Records a refund the provider made to the customer, after it was verified (`orders.record_refund`). */
  async recordProviderRefund(actor: StaffActor, orderId: string, amount: Money, reference: string) {
    return this.orchestrator.recordProviderRefund(orderId, await this.authorize(actor, orderId, 'orders.record_refund'), amount, reference);
  }
}
