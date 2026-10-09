import { and, eq, isNull } from 'drizzle-orm';
import { DomainError, type FundingMethod, type HoldSemantics, type PaymentMode, type PaymentRoute, type ProductType, type ProviderEnvironment } from '@texholiday/contracts';
import type { QuoteVersionSnapshot } from '@texholiday/domain';
import { sum, toJson, type Money } from '@texholiday/pricing';
import type { CoreDb } from './client';
import { checkoutSessionQuotes, checkoutSessions, orderItems, orders, paymentAttempts, providerBookings, quoteVersions, quotes } from './schema';

const PG_UNIQUE_VIOLATION = '23505';

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

function pgConstraint(err: unknown): string | undefined {
  const e = err as { constraint?: string; cause?: { constraint?: string } };
  return e?.constraint ?? e?.cause?.constraint;
}

export class PaymentUnresolvedError extends DomainError {
  constructor() {
    super('PAYMENT_UNRESOLVED', 'A previous payment for this checkout is not resolved yet', { httpStatus: 409, retryable: true, action: 'WAIT_FOR_PAYMENT_RESULT' });
  }
}

export interface NewQuoteVersion extends Omit<QuoteVersionSnapshot, 'id' | 'quoteId' | 'createdAt' | 'acceptance'> {
  environment: ProviderEnvironment;
}

export class QuoteRepository {
  constructor(private readonly db: CoreDb) {}

  async createQuote(productType: ProductType, providerId: string): Promise<string> {
    const [row] = await this.db.insert(quotes).values({ productType, providerId }).returning({ id: quotes.id });
    return row!.id;
  }

  async addVersion(quoteId: string, v: NewQuoteVersion): Promise<string> {
    if (v.providerCommission.currency !== v.supplierCost.currency) {
      throw new DomainError('VALIDATION_FAILED', 'Provider commission must be in the supplier cost currency', { httpStatus: 422 });
    }
    const [row] = await this.db
      .insert(quoteVersions)
      .values({
        quoteId,
        version: v.version,
        environment: v.environment,
        offerRef: v.offerRef,
        option: v.option,
        travelers: v.travelers,
        supplierCostMinor: v.supplierCost.minor,
        supplierCostCurrency: v.supplierCost.currency,
        providerCommissionMinor: v.providerCommission.minor,
        sellMinor: v.sell.minor,
        sellCurrency: v.sell.currency,
        chargeNowMinor: v.chargeNow.minor,
        chargeCurrency: v.chargeNow.currency,
        fx: v.fx,
        fees: v.fees.map((f) => ({ code: f.code, amount: toJson(f.amount), includedInChargeNow: f.includedInChargeNow })),
        payAtProperty: v.payAtProperty.map(toJson),
        cancellation: { ...v.cancellation, steps: v.cancellation.steps.map((s) => ({ from: s.from, penalty: toJson(s.penalty) })) },
        expiresAt: v.expiresAt,
        pricingPolicyId: v.pricingPolicy.id,
        pricingPolicyVersion: v.pricingPolicy.version,
      })
      .returning({ id: quoteVersions.id });
    return row!.id;
  }

  /** Records the customer's explicit acceptance once; the DB trigger refuses any later change. */
  async accept(quoteVersionId: string, termsVersion: string): Promise<void> {
    const rows = await this.db
      .update(quoteVersions)
      .set({ acceptedAt: new Date().toISOString(), termsVersion })
      .where(and(eq(quoteVersions.id, quoteVersionId), isNull(quoteVersions.acceptedAt)))
      .returning({ id: quoteVersions.id });
    if (rows.length === 0) throw new DomainError('QUOTE_CHANGED', 'Quote version already accepted or missing', { httpStatus: 409 });
  }
}

export interface SubmitItem {
  quoteVersionId: string;
  productType: ProductType;
  providerId: string;
  connectorId: string;
  chargeAllocation: Money;
  supplierCost: Money;
  funding: { method: FundingMethod; capabilityId: string };
  connector: { holdSemantics: HoldSemantics; reversibilityRank: number; requiresIssuance: boolean; needsPrebook: boolean };
}

export interface SubmitOrderInput {
  customerId: string;
  environment: ProviderEnvironment;
  route: PaymentRoute;
  chargeTotal: Money;
  items: readonly SubmitItem[];
  checkoutExpiresAt: string;
  /** payBy: PROVIDER_MANAGED only, the instant after which an unpaid checkout is abandoned. */
  payment: { gatewayId: string; mode: PaymentMode; idempotencyKey: string; payBy?: string | null };
}

export class CheckoutRepository {
  constructor(private readonly db: CoreDb) {}

  /**
   * Creates checkout, order (PROCESSING), items, provider booking rows (NEW) and the first payment
   * attempt (NEW) atomically. Allocation balance is enforced by a deferred DB constraint.
   */
  async submitOrder(input: SubmitOrderInput): Promise<{ checkoutSessionId: string; orderId: string; paymentAttemptId: string }> {
    const allocated = sum(
      input.items.map((i) => i.chargeAllocation),
      input.chargeTotal.currency,
    );
    if (allocated.minor !== input.chargeTotal.minor) throw new DomainError('VALIDATION_FAILED', 'Item allocations do not equal the charge total', { httpStatus: 422 });

    return this.db.transaction(async (tx) => {
      const [checkout] = await tx
        .insert(checkoutSessions)
        .values({
          customerId: input.customerId,
          environment: input.environment,
          status: 'SUBMITTED',
          route: input.route,
          chargeTotalMinor: input.chargeTotal.minor,
          chargeCurrency: input.chargeTotal.currency,
          expiresAt: input.checkoutExpiresAt,
        })
        .returning({ id: checkoutSessions.id });
      const checkoutSessionId = checkout!.id;
      await tx.insert(checkoutSessionQuotes).values(input.items.map((i, position) => ({ checkoutSessionId, quoteVersionId: i.quoteVersionId, position })));

      const [order] = await tx
        .insert(orders)
        .values({
          checkoutSessionId,
          customerId: input.customerId,
          environment: input.environment,
          status: 'PROCESSING',
          route: input.route,
          chargeTotalMinor: input.chargeTotal.minor,
          chargeCurrency: input.chargeTotal.currency,
        })
        .returning({ id: orders.id });
      const orderId = order!.id;

      for (const [position, it] of input.items.entries()) {
        const [row] = await tx
          .insert(orderItems)
          .values({
            orderId,
            position,
            productType: it.productType,
            providerId: it.providerId,
            connectorId: it.connectorId,
            quoteVersionId: it.quoteVersionId,
            chargeAllocationMinor: it.chargeAllocation.minor,
            chargeCurrency: it.chargeAllocation.currency,
            supplierCostMinor: it.supplierCost.minor,
            supplierCostCurrency: it.supplierCost.currency,
            fundingMethod: it.funding.method,
            fundingCapabilityId: it.funding.capabilityId,
            connectorMeta: it.connector,
          })
          .returning({ id: orderItems.id });
        await tx.insert(providerBookings).values({
          orderItemId: row!.id,
          environment: input.environment,
          status: 'NEW',
          ticketing: it.connector.requiresIssuance ? 'PENDING' : 'NOT_REQUIRED',
        });
      }

      const paymentAttemptId = await this.insertAttempt(tx as unknown as CoreDb, {
        orderId,
        checkoutSessionId,
        environment: input.environment,
        amount: input.chargeTotal,
        ...input.payment,
      });
      return { checkoutSessionId, orderId, paymentAttemptId };
    });
  }

  /** A new attempt (e.g. after a decline or a gateway change) is refused while another one is live (T21). */
  async startPaymentAttempt(input: { orderId: string; checkoutSessionId: string; environment: ProviderEnvironment; amount: Money; gatewayId: string; mode: PaymentMode; idempotencyKey: string; payBy?: string | null }): Promise<string> {
    return this.insertAttempt(this.db, input);
  }

  private async insertAttempt(
    db: CoreDb,
    input: { orderId: string; checkoutSessionId: string; environment: ProviderEnvironment; amount: Money; gatewayId: string; mode: PaymentMode; idempotencyKey: string; payBy?: string | null },
  ): Promise<string> {
    try {
      const [row] = await db
        .insert(paymentAttempts)
        .values({
          orderId: input.orderId,
          checkoutSessionId: input.checkoutSessionId,
          mode: input.mode,
          gatewayId: input.gatewayId,
          environment: input.environment,
          status: 'NEW',
          amountMinor: input.amount.minor,
          currency: input.amount.currency,
          localIdempotencyKey: input.idempotencyKey,
          payBy: input.mode === 'PROVIDER_MANAGED' ? (input.payBy ?? null) : null,
        })
        .returning({ id: paymentAttempts.id });
      return row!.id;
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION && pgConstraint(err) === 'payment_attempts_one_live_per_checkout_uq') throw new PaymentUnresolvedError();
      throw err;
    }
  }
}
