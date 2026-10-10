import { notAvailable, type ExternalOutcome, type HotelConnector, type OpaqueRef, type ProviderBookingState, type ProviderManagedTransactionRef } from '@texholiday/contracts';
import type { CheckoutRepository, QuoteRepository } from '@texholiday/db';
import type { OrderAggregate, OrderItemState, ProviderManagedBookingPort, ProviderManagedPrebook, QuoteDifference } from '@texholiday/domain';
import { equals, type Money } from '@texholiday/pricing';

/**
 * Binds the provider-managed orchestrator to the Nuitee hotel connector. Prices and offer ids always come from the
 * stored, accepted quote; guests from the order (never from the request that triggers a step).
 */
export class NuiteeHotelProviderManagedPort implements ProviderManagedBookingPort {
  constructor(
    private readonly hotels: HotelConnector,
    private readonly quotes: QuoteRepository,
    private readonly checkout: CheckoutRepository,
  ) {}

  /** Nuitee hotels refuse a book for an unpaid transaction with a known code, so scheduled retries may book. */
  bookTrigger(): 'ANY_TRIGGER' {
    return 'ANY_TRIGGER';
  }

  /** Looked up by our client reference (every reference ever sent, ADR-0008). */
  lookupScope(): 'PER_REFERENCE' {
    return 'PER_REFERENCE';
  }

  async prebookForPayment(agg: OrderAggregate, it: OrderItemState): Promise<ExternalOutcome<ProviderManagedPrebook>> {
    const quote = await this.quotes.get(it.quoteVersionId);
    if (!quote || quote.environment !== agg.environment) return notAvailable('QUOTE', 'Accepted quote not found for this environment');
    const out = await this.hotels.prebook({ offerRef: quote.offerRef, usePaymentSdk: true, clientReference: `${it.booking.id}-pre` });
    if (out.kind !== 'SUCCEEDED') return out;
    const v = out.value;
    if (!v.providerManagedTransaction || !v.paymentClientSecret) return { kind: 'UNKNOWN', reason: 'MALFORMED_RESPONSE', evidence: out.evidence };
    const differences: QuoteDifference[] = [];
    // The provider charges its prebook price: it must be exactly the accepted amount (K15).
    if (v.changeFlags.price || !equals(v.offer.price, quote.chargeNow)) differences.push('CHARGE_AMOUNT');
    if (v.changeFlags.cancellation) differences.push('CANCELLATION');
    if (v.changeFlags.board) differences.push('OPTION');
    return {
      kind: 'SUCCEEDED',
      value: { prebookRef: v.prebookRef, transactionId: v.providerManagedTransaction.transactionId, clientSecret: v.paymentClientSecret, differences },
      evidence: out.evidence,
    };
  }

  async book(agg: OrderAggregate, it: OrderItemState, clientReference: string, tx: { prebookRef: OpaqueRef; transactionId: OpaqueRef }): Promise<ExternalOutcome<ProviderBookingState>> {
    const guests = await this.checkout.guests(it.id);
    if (!guests) return notAvailable('GUESTS', 'Booking contact missing for the order item');
    const transaction: ProviderManagedTransactionRef = {
      __brand: 'ProviderManagedTransactionRef',
      providerId: 'nuitee',
      productType: 'HOTEL',
      prebookRef: tx.prebookRef,
      transactionId: tx.transactionId,
      environment: agg.environment,
    };
    return this.hotels.book({
      prebookRef: tx.prebookRef,
      clientReference,
      holder: guests.holder,
      guests: guests.roomGuests.map((g) => ({ occupancyNumber: g.occupancyNumber, leadGuest: { firstName: g.firstName, lastName: g.lastName, email: g.email } })),
      funding: { kind: 'PROVIDER_MANAGED', transaction },
    });
  }

  async lookup(_agg: OrderAggregate, _it: OrderItemState, clientReference: string): Promise<ExternalOutcome<ProviderBookingState | null>> {
    return this.hotels.lookupByClientReference(clientReference);
  }

  async refresh(_agg: OrderAggregate, _it: OrderItemState, providerBookingRef: OpaqueRef): Promise<ExternalOutcome<ProviderBookingState>> {
    return this.hotels.getBooking(providerBookingRef);
  }

  async cancel(_agg: OrderAggregate, _it: OrderItemState, providerBookingRef: OpaqueRef): Promise<ExternalOutcome<ProviderBookingState & { penalty: Money | null; providerRefund: Money | null }>> {
    const out = await this.hotels.cancel(providerBookingRef);
    if (out.kind !== 'SUCCEEDED') return out;
    const { refundAmount, ...rest } = out.value;
    return { kind: 'SUCCEEDED', value: { ...rest, providerRefund: refundAmount }, evidence: out.evidence };
  }
}
