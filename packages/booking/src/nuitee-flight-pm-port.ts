import { notAvailable, type ExternalOutcome, type FlightConnector, type FlightPassenger, type OpaqueRef, type ProviderBookingState, type ProviderManagedTransactionRef } from '@texholiday/contracts';
import type { CheckoutRepository, QuoteRepository } from '@texholiday/db';
import type { OrderAggregate, OrderItemState, ProviderManagedBookingPort, ProviderManagedPrebook, ProviderPaymentState, QuoteDifference, ServiceSelection } from '@texholiday/domain';
import { equals, type Money } from '@texholiday/pricing';

/**
 * Passenger details of a checkout between the customer's submit and the provider prebook, in this process's memory
 * only (ADR-0012). Birth dates, nationality and travel documents are needed by the provider once, at prebook; no
 * retention period has been decided for them (identity policy, G06), so they are never written to the database or a
 * log. Taken once; anything not taken expires.
 */
export class TransientPassengerDetails {
  private readonly entries = new Map<string, { passengers: readonly FlightPassenger[]; until: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  put(orderId: string, passengers: readonly FlightPassenger[]): void {
    this.sweep();
    this.entries.set(orderId, { passengers, until: this.clock().getTime() + this.ttlMs });
  }

  /** The details of an order, removed on reading; null when expired, taken or held by another process. */
  take(orderId: string): readonly FlightPassenger[] | null {
    this.sweep();
    const e = this.entries.get(orderId);
    this.entries.delete(orderId);
    return e ? e.passengers : null;
  }

  private sweep(): void {
    const now = this.clock().getTime();
    for (const [k, v] of this.entries) if (v.until <= now) this.entries.delete(k);
  }
}

/**
 * Binds the provider-managed orchestrator to the Nuitee flight connector (ADR-0011, ADR-0012). Prices and offer ids
 * come from the stored, accepted quote; the contact from the order; passenger documents from the transient holder.
 * - Booked only on the customer's return from the payment component (the sandbox accepted a book before payment).
 * - A lost book answer is found by repeating the book with the same prebook: the provider returns the booking of the
 *   prebook (documented idempotency), and a refusal means none exists. Once the booking id is known it is read by id.
 */
export class NuiteeFlightProviderManagedPort implements ProviderManagedBookingPort {
  constructor(
    private readonly flights: FlightConnector,
    private readonly quotes: QuoteRepository,
    private readonly checkout: CheckoutRepository,
    private readonly details: TransientPassengerDetails,
  ) {}

  bookTrigger(): 'CUSTOMER_RETURN' {
    return 'CUSTOMER_RETURN';
  }

  lookupScope(): 'PER_PREBOOK' {
    return 'PER_PREBOOK';
  }

  async prebookForPayment(agg: OrderAggregate, it: OrderItemState): Promise<ExternalOutcome<ProviderManagedPrebook>> {
    const quote = await this.quotes.get(it.quoteVersionId);
    if (!quote || quote.environment !== agg.environment || quote.productType !== 'FLIGHT') return notAvailable('QUOTE', 'Accepted flight quote not found for this environment');
    const guests = await this.checkout.guests(it.id);
    const passengers = this.details.take(agg.id);
    if (!guests || !guests.holder.phoneCountryCode) return notAvailable('CONTACT', 'Booking contact missing for the order item');
    // Never stored: after a restart (or on another process) the customer enters them again.
    if (!passengers) return notAvailable('PASSENGER_DETAILS', 'Passenger details are no longer held; the customer must enter them again');
    const h = guests.holder;
    const out = await this.flights.prebook({
      offerRef: quote.offerRef,
      usePaymentSdk: true,
      contact: { email: h.email, firstName: h.firstName, lastName: h.lastName, phoneCountryCode: h.phoneCountryCode!, phoneNumber: h.phone.replace(/^\+/, '').slice(h.phoneCountryCode!.length) },
      passengers,
    });
    if (out.kind !== 'SUCCEEDED') return out;
    const v = out.value;
    if (!v.providerManagedTransaction || !v.paymentClientSecret) return { kind: 'UNKNOWN', reason: 'MALFORMED_RESPONSE', evidence: out.evidence };
    const differences: QuoteDifference[] = [];
    // The payment component charges the prebook price: it must be exactly the accepted amount (K15).
    if (v.amountToCharge.currency !== quote.chargeNow.currency) differences.push('CHARGE_CURRENCY');
    else if (!equals(v.amountToCharge, quote.chargeNow)) differences.push('CHARGE_AMOUNT');
    return {
      kind: 'SUCCEEDED',
      value: { prebookRef: v.prebookRef, transactionId: v.providerManagedTransaction.transactionId, clientSecret: v.paymentClientSecret, differences },
      evidence: out.evidence,
    };
  }

  private transaction(agg: OrderAggregate, tx: { prebookRef: OpaqueRef; transactionId: OpaqueRef }): ProviderManagedTransactionRef {
    return { __brand: 'ProviderManagedTransactionRef', providerId: 'nuitee', productType: 'FLIGHT', prebookRef: tx.prebookRef, transactionId: tx.transactionId, environment: agg.environment };
  }

  /** Attaches seats/bags to the stored prebook; the answer is the replacing payment intent (ADR-0013). */
  async attachServices(agg: OrderAggregate, it: OrderItemState, selections: readonly ServiceSelection[]): Promise<ExternalOutcome<ProviderPaymentState>> {
    const prebookRef = agg.payment?.providerTransaction?.prebookRef ?? it.booking.prebookRef;
    if (!prebookRef) return notAvailable('PREBOOK', 'No prebook for the order item');
    return this.paymentState(await this.flights.attachServices({ prebookRef, selections }));
  }

  /** The prebook's payment intent in force now (`GET /flights/prebooks/{id}`). */
  async readPayment(agg: OrderAggregate, it: OrderItemState): Promise<ExternalOutcome<ProviderPaymentState>> {
    const prebookRef = agg.payment?.providerTransaction?.prebookRef ?? it.booking.prebookRef;
    if (!prebookRef) return notAvailable('PREBOOK', 'No prebook for the order item');
    return this.paymentState(await this.flights.readPrebook(prebookRef));
  }

  private paymentState(out: Awaited<ReturnType<FlightConnector['readPrebook']>>): ExternalOutcome<ProviderPaymentState> {
    if (out.kind !== 'SUCCEEDED') return out;
    const v = out.value;
    if (!v.providerManagedTransaction || !v.paymentClientSecret) return { kind: 'UNKNOWN', reason: 'MALFORMED_RESPONSE', evidence: out.evidence };
    return { kind: 'SUCCEEDED', value: { transactionId: v.providerManagedTransaction.transactionId, clientSecret: v.paymentClientSecret, amountToCharge: v.amountToCharge }, evidence: out.evidence };
  }

  async book(agg: OrderAggregate, _it: OrderItemState, clientReference: string, tx: { prebookRef: OpaqueRef; transactionId: OpaqueRef }): Promise<ExternalOutcome<ProviderBookingState>> {
    return this.flights.book({ prebookRef: tx.prebookRef, clientReference, funding: { kind: 'PROVIDER_MANAGED', transaction: this.transaction(agg, tx) } });
  }

  async lookup(agg: OrderAggregate, it: OrderItemState, clientReference: string): Promise<ExternalOutcome<ProviderBookingState | null>> {
    if (it.booking.providerBookingRef) return this.flights.getBooking(it.booking.providerBookingRef);
    const tx = agg.payment?.providerTransaction;
    if (!tx) return { kind: 'SUCCEEDED', value: null, evidence: { operation: 'nuitee.flight.lookup', environment: agg.environment, at: new Date().toISOString(), httpStatus: null, upstreamRequestId: null, durationMs: 0 } };
    const out = await this.book(agg, it, clientReference, tx);
    // A refusal of the repeated book means the prebook holds no booking (a booking would have been returned).
    if (out.kind === 'REJECTED') return { kind: 'SUCCEEDED', value: null, evidence: out.evidence };
    return out;
  }

  async refresh(_agg: OrderAggregate, _it: OrderItemState, providerBookingRef: OpaqueRef): Promise<ExternalOutcome<ProviderBookingState>> {
    return this.flights.getBooking(providerBookingRef);
  }

  async cancel(_agg: OrderAggregate, _it: OrderItemState, providerBookingRef: OpaqueRef): Promise<ExternalOutcome<ProviderBookingState & { penalty: Money | null; providerRefund: Money | null }>> {
    const out = await this.flights.cancel(providerBookingRef);
    if (out.kind !== 'SUCCEEDED') return out;
    const { refundAmount, ...rest } = out.value;
    return { kind: 'SUCCEEDED', value: { ...rest, providerRefund: refundAmount }, evidence: out.evidence };
  }
}

/** Routes each provider-managed order to the port of its product (one item per order). */
export class ProductProviderManagedPort implements ProviderManagedBookingPort {
  constructor(private readonly ports: Partial<Record<OrderItemState['productType'], ProviderManagedBookingPort>>) {}

  private of(it: OrderItemState): ProviderManagedBookingPort {
    const p = this.ports[it.productType];
    if (!p) throw new Error(`No provider-managed port for ${it.productType}`);
    return p;
  }

  bookTrigger(it: OrderItemState) {
    return this.of(it).bookTrigger(it);
  }
  lookupScope(it: OrderItemState) {
    return this.of(it).lookupScope(it);
  }
  attachServices(agg: OrderAggregate, it: OrderItemState, selections: readonly ServiceSelection[]): Promise<ExternalOutcome<ProviderPaymentState>> {
    const p = this.of(it);
    return p.attachServices ? p.attachServices(agg, it, selections) : Promise.resolve(notAvailable('SERVICES', `No services for ${it.productType}`));
  }
  readPayment(agg: OrderAggregate, it: OrderItemState): Promise<ExternalOutcome<ProviderPaymentState>> {
    const p = this.of(it);
    return p.readPayment ? p.readPayment(agg, it) : Promise.resolve(notAvailable('SERVICES', `No services for ${it.productType}`));
  }
  prebookForPayment(agg: OrderAggregate, it: OrderItemState) {
    return this.of(it).prebookForPayment(agg, it);
  }
  book(agg: OrderAggregate, it: OrderItemState, clientReference: string, tx: { prebookRef: OpaqueRef; transactionId: OpaqueRef }) {
    return this.of(it).book(agg, it, clientReference, tx);
  }
  lookup(agg: OrderAggregate, it: OrderItemState, clientReference: string) {
    return this.of(it).lookup(agg, it, clientReference);
  }
  refresh(agg: OrderAggregate, it: OrderItemState, providerBookingRef: OpaqueRef) {
    return this.of(it).refresh(agg, it, providerBookingRef);
  }
  cancel(agg: OrderAggregate, it: OrderItemState, providerBookingRef: OpaqueRef) {
    return this.of(it).cancel(agg, it, providerBookingRef);
  }
}
