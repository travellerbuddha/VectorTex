import { DomainError, type FlightConnector } from '@texholiday/contracts';
import type { QuoteRepository } from '@texholiday/db';
import { freeCancellation, penaltyAt, type OrderAggregate } from '@texholiday/domain';
import { toJson, type Money } from '@texholiday/pricing';
import type { CustomerCancellationView } from './views';

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

export async function previewCancellation(agg: OrderAggregate, deps: { quotes: QuoteRepository; flights: FlightConnector | null; now: Date }): Promise<CancellationPreview> {
  const it = agg.items[0]!;
  const quote = await deps.quotes.get(it.quoteVersionId);
  if (!quote) throw new DomainError('NOT_FOUND', 'Order not found', { httpStatus: 404 });
  const policy = quote.cancellation;
  const paid = agg.payment!.amount;
  if (it.productType === 'FLIGHT') {
    // The provider's quote is the only source of the cost (sandbox 2026-10-09 always answered 500/59099).
    const ref = it.booking.providerBookingRef;
    const q = ref && deps.flights ? await deps.flights.cancellationQuote(ref) : null;
    if (q?.kind === 'SUCCEEDED' && q.value.penalty && q.value.penalty.currency === paid.currency) {
      return { expectedPenalty: q.value.penalty, basis: 'PROVIDER_QUOTE', freeUntil: null, providerQuote: { confidence: q.value.confidence, refund: q.value.refund, destination: q.value.destination } };
    }
    return { expectedPenalty: paid, basis: 'PROVIDER_QUOTE_UNAVAILABLE', freeUntil: null, providerQuote: null };
  }
  const free = freeCancellation(policy);
  if (free.kind === 'NON_REFUNDABLE') return { expectedPenalty: paid, basis: 'NON_REFUNDABLE', freeUntil: null, providerQuote: null };
  const penalty = penaltyAt(policy, deps.now, paid.currency);
  return {
    expectedPenalty: penalty,
    basis: penalty.minor > 0n ? 'POLICY_STEP' : 'FREE',
    freeUntil: free.kind === 'FREE_UNTIL' ? free.lastFreeInstant.toISOString() : null,
    providerQuote: null,
  };
}

/**
 * Online cancellation by the customer (T27, ADR-0021), hotels only: flight changes go through the provider's servicing
 * team. Every hotel sets its own cancellation and refund terms and Nuitee passes them on with the rate; we hold no
 * hotel terms of our own. So the only rule is Nuitee's policy as booked: offered while cancelling now still refunds
 * something, at the fee that policy sets for this moment. Nuitee's answer to the cancel (fee, refund) is what is
 * recorded. A cancellation in flight or with a lost answer shows as in progress until the booking is read.
 */
export async function customerCancellation(agg: OrderAggregate, deps: { quotes: QuoteRepository; now: Date }): Promise<CustomerCancellationView | null> {
  const it = agg.items[0]!;
  if (it.productType !== 'HOTEL' || agg.status === 'CANCELLED') return null;
  const b = it.booking;
  if (b.status === 'CANCEL_PENDING' || (b.status === 'UNKNOWN' && b.unknownOperation === 'CANCEL')) return { state: 'IN_PROGRESS' };
  if (agg.status !== 'CONFIRMED' || b.status !== 'CONFIRMED' || !b.providerBookingRef || b.intent) return null;
  const preview = await previewCancellation(agg, { quotes: deps.quotes, flights: null, now: deps.now });
  const paid = agg.payment!.amount;
  if (preview.basis === 'NON_REFUNDABLE' || preview.expectedPenalty.currency !== paid.currency || preview.expectedPenalty.minor >= paid.minor) {
    return { state: 'NOT_AVAILABLE', reason: 'NO_REFUND' };
  }
  return { state: 'AVAILABLE', expectedFee: toJson(preview.expectedPenalty), paid: toJson(paid), freeUntil: preview.freeUntil };
}
