import { DomainError, type CancellationPolicySnapshot, type OpaqueRef, type ProductType, type TravelerRef } from '@texholiday/contracts';
import { equals, money, type FxRateSnapshot, type Money } from '@texholiday/pricing';

/**
 * Immutable price/condition snapshot shown to and accepted by the customer. Stored in core only;
 * content editors cannot change it (DB trigger forbids UPDATE).
 */
export interface QuoteVersionSnapshot {
  id: string;
  quoteId: string;
  version: number;
  productType: ProductType;
  providerId: string;
  offerRef: OpaqueRef;
  /** Room/fare/option/vehicle details as shown to the customer. */
  option: Readonly<Record<string, unknown>>;
  travelers: readonly TravelerRef[];
  supplierCost: Money;
  /**
   * Commission the provider includes in `supplierCost` at our requested margin and pays out after the stay
   * (PROVIDER_API, ADR-0006); zero for LOCAL margins. Same currency as `supplierCost`.
   */
  providerCommission: Money;
  sell: Money;
  /** Amount collected now, in the charge currency. Pay-at-property amounts are separate. */
  chargeNow: Money;
  fx: FxRateSnapshot | null;
  fees: ReadonlyArray<{ code: string; amount: Money; includedInChargeNow: boolean }>;
  payAtProperty: readonly Money[];
  cancellation: CancellationPolicySnapshot;
  expiresAt: string;
  createdAt: string;
  pricingPolicy: { id: string; version: number };
  acceptance: { acceptedAt: string; termsVersion: string } | null;
}

export class QuoteError extends DomainError {
  constructor(code: 'QUOTE_EXPIRED' | 'QUOTE_CHANGED' | 'VALIDATION_FAILED', message: string) {
    super(code, message, { httpStatus: code === 'VALIDATION_FAILED' ? 422 : 409, action: code === 'VALIDATION_FAILED' ? null : 'REVIEW_AND_ACCEPT' });
  }
}

/** T04: payment/booking may only proceed on an accepted, unexpired quote version. */
export function assertQuoteUsable(q: QuoteVersionSnapshot, now: Date): void {
  if (!q.acceptance) throw new QuoteError('VALIDATION_FAILED', `Quote ${q.quoteId} v${q.version} was not accepted`);
  if (new Date(q.expiresAt).getTime() <= now.getTime()) throw new QuoteError('QUOTE_EXPIRED', `Quote ${q.quoteId} v${q.version} expired`);
}

export type QuoteDifference = 'CHARGE_AMOUNT' | 'CHARGE_CURRENCY' | 'SUPPLIER_COST' | 'CANCELLATION' | 'PAY_AT_PROPERTY' | 'FEES' | 'OPTION' | 'TRAVELERS';

const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, value) => {
    if (typeof value === 'bigint') return value.toString();
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return value;
  });

/**
 * Compares a freshly revalidated offer with the accepted version. Any difference requires a new
 * QuoteVersion and explicit customer acceptance (K15); the old acceptance is never reused.
 */
export function compareQuotes(accepted: QuoteVersionSnapshot, fresh: QuoteVersionSnapshot): QuoteDifference[] {
  const diffs: QuoteDifference[] = [];
  if (accepted.chargeNow.currency !== fresh.chargeNow.currency) diffs.push('CHARGE_CURRENCY');
  else if (!equals(accepted.chargeNow, fresh.chargeNow)) diffs.push('CHARGE_AMOUNT');
  if (accepted.supplierCost.currency !== fresh.supplierCost.currency || !equals(accepted.supplierCost, fresh.supplierCost)) diffs.push('SUPPLIER_COST');
  if (canonical(accepted.cancellation) !== canonical(fresh.cancellation)) diffs.push('CANCELLATION');
  if (canonical(accepted.payAtProperty) !== canonical(fresh.payAtProperty)) diffs.push('PAY_AT_PROPERTY');
  if (canonical(accepted.fees) !== canonical(fresh.fees)) diffs.push('FEES');
  if (canonical(accepted.option) !== canonical(fresh.option)) diffs.push('OPTION');
  if (canonical(accepted.travelers) !== canonical(fresh.travelers)) diffs.push('TRAVELERS');
  return diffs;
}

/** A package expires with its earliest component (§13.3). */
export function packageExpiry(versions: readonly QuoteVersionSnapshot[]): Date {
  if (versions.length === 0) throw new QuoteError('VALIDATION_FAILED', 'Empty package');
  return new Date(Math.min(...versions.map((v) => new Date(v.expiresAt).getTime())));
}

/** Penalty due if cancelled at `at` (T05). Steps carry absolute instants with offsets. */
export function penaltyAt(policy: CancellationPolicySnapshot, at: Date, currency: string): Money {
  const applicable = [...policy.steps]
    .map((s) => ({ ...s, fromMs: new Date(s.from).getTime() }))
    .filter((s) => !Number.isNaN(s.fromMs) && s.fromMs <= at.getTime())
    .sort((a, b) => a.fromMs - b.fromMs);
  const last = applicable[applicable.length - 1];
  return last ? last.penalty : money(currency, 0n);
}

export type FreeCancellation = { kind: 'NON_REFUNDABLE' } | { kind: 'FREE_UNTIL'; lastFreeInstant: Date } | { kind: 'NO_PENALTY_STEPS' };

/** Customer-facing summary of the free-cancellation window. */
export function freeCancellation(policy: CancellationPolicySnapshot): FreeCancellation {
  if (!policy.refundable) return { kind: 'NON_REFUNDABLE' };
  const firstPaid = [...policy.steps]
    .filter((s) => s.penalty.minor > 0n)
    .map((s) => new Date(s.from).getTime())
    .sort((a, b) => a - b)[0];
  return firstPaid === undefined ? { kind: 'NO_PENALTY_STEPS' } : { kind: 'FREE_UNTIL', lastFreeInstant: new Date(firstPaid - 1) };
}
