import {
  notAvailable,
  opaque,
  type CallEvidence,
  type ConnectorDescriptor,
  type ExternalOutcome,
  type FlightAirport,
  type FlightBookingState,
  type FlightCancellationQuote,
  type FlightCancelResult,
  type FlightConnector,
  type FlightContact,
  type FlightFunding,
  type FlightOffer,
  type FlightPassenger,
  type FlightPassengerType,
  type FlightPrebook,
  type FlightPrebookState,
  type FlightSearchCriteria,
  type FlightService,
  type FlightServiceSelection,
  type FlightSegment,
  type FlightVerification,
  type OpaqueRef,
} from '@texholiday/contracts';
import { add, money, percentOf, type Money } from '@texholiday/pricing';

/**
 * MOCK flight connector for local development, UI work and automated tests (ADR-0005). Every id and carrier starts
 * with MOCK, the environment is 'mock', and the registry/config refuse it in production. Fares are invented test data;
 * airport codes are real IATA codes so forms validate as in production.
 *
 * Modelled on the Nuitee flights contract and sandbox (ADR-0011): the book is idempotent per prebook (a repeat returns
 * the same booking), the booking is confirmed with an airline PNR first and ticketed later (here: on the first read
 * after booking), and a cancellation may wait for the airline (`cancelPending`). Unlike the sandbox, a book without a
 * completed payment is refused, as the flight guide says production does; the refusal code is a MOCK label (the real
 * code is unknown, provider question 11).
 */
export class MockFlightConnector implements FlightConnector {
  private seq = 0;
  /** Ids stay unique across restarts (like real provider ids), so stored orders never collide. */
  private readonly run = Math.random().toString(36).slice(2, 8).toUpperCase();
  private readonly offers = new Map<string, FlightOffer>();
  /** The markup each offer was searched with (a re-priced fare keeps it). */
  private readonly markupBp = new Map<string, bigint>();
  private readonly prebooks = new Map<
    string,
    { offerRef: string; transactionId: string | null; price: Money; passengers: readonly FlightPassenger[]; services: FlightService[]; attached: FlightServiceSelection[] }
  >();
  /** Seat and bag markups each offer was searched with (applied to its services). */
  private readonly serviceBp = new Map<string, { seats: bigint; bags: bigint }>();
  private readonly paid = new Set<string>();
  /** By prebook (the provider's idempotency key for booking). */
  private readonly bookings = new Map<string, FlightBookingState>();
  /** Test hooks. */
  nextVerifyPriceChange = false;
  nextPrebookPriceChange = false;
  nextBook: ExternalOutcome<FlightBookingState> | null = null;
  /** Issue the ticket in the book answer instead of on the first read. */
  ticketOnBook = false;
  /** The next cancellation is accepted but waits for the airline (HTTP 202), final on the next read. */
  cancelPending = false;
  /** The next attach is applied at the provider but its answer is lost (UNKNOWN). */
  nextAttachLost = false;
  /** The next attach charges this much more than the services' prices (a provider price change). */
  nextAttachSurcharge: bigint = 0n;
  /** The next attach is refused (nothing attached, the payment intent unchanged). */
  nextAttachRefused = false;

  constructor(private readonly clock: () => Date = () => new Date()) {}

  descriptor(): ConnectorDescriptor {
    return {
      connectorId: 'nuitee-flight',
      providerId: 'nuitee',
      productType: 'FLIGHT',
      environment: 'mock',
      isMock: true,
      requiredSources: [],
      operations: {
        searchAirports: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        searchRates: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        verify: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        prebook: { effect: 'CREATES_PROVIDER_RESERVATION', lostResponse: 'NONE' },
        book: { effect: 'CREATES_PROVIDER_RESERVATION', lostResponse: 'DOCUMENTED_IDEMPOTENCY_KEY' },
        getBooking: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        cancellationQuote: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        cancel: { effect: 'CANCELS_PROVIDER_RESERVATION', lostResponse: 'DOCUMENTED_IDEMPOTENCY_KEY' },
      },
      holdSemantics: 'PREBOOK_VALIDATION',
      reversibilityRank: 90,
      maxAsyncConfirmationSeconds: null,
      requiresIssuance: true,
    };
  }

  private evidence(operation: string): CallEvidence {
    return { operation: `mock.flight.${operation}`, environment: 'mock', at: this.clock().toISOString(), httpStatus: 200, upstreamRequestId: null, durationMs: 1 };
  }

  private static readonly AIRPORTS: readonly FlightAirport[] = [
    { iata: 'IST', name: 'MOCK Istanbul Airport', city: 'Istanbul', country: 'Türkiye' },
    { iata: 'SAW', name: 'MOCK Sabiha Gökçen Airport', city: 'Istanbul', country: 'Türkiye' },
    { iata: 'AYT', name: 'MOCK Antalya Airport', city: 'Antalya', country: 'Türkiye' },
    { iata: 'ESB', name: 'MOCK Esenboğa Airport', city: 'Ankara', country: 'Türkiye' },
    { iata: 'ADB', name: 'MOCK Adnan Menderes Airport', city: 'Izmir', country: 'Türkiye' },
    { iata: 'DLM', name: 'MOCK Dalaman Airport', city: 'Dalaman', country: 'Türkiye' },
    { iata: 'LHR', name: 'MOCK Heathrow Airport', city: 'London', country: 'United Kingdom' },
    { iata: 'FRA', name: 'MOCK Frankfurt Airport', city: 'Frankfurt', country: 'Germany' },
  ];

  /** Marks the simulated payment of a transaction as completed (mock payment page / tests). */
  markPaid(transactionId: string): void {
    this.paid.add(transactionId);
  }

  /** The passengers sent with a prebook (tests check what reached the provider). */
  prebookPassengers(prebookRef: string): readonly FlightPassenger[] | null {
    return this.prebooks.get(prebookRef)?.passengers ?? null;
  }

  async searchAirports(input: { text: string }): Promise<ExternalOutcome<readonly FlightAirport[]>> {
    const q = input.text.trim().toLocaleLowerCase('tr');
    if (q.length < 2 || q.length > 100) return notAvailable('AIRPORT_QUERY', 'Type 2-100 characters');
    const hits = MockFlightConnector.AIRPORTS.filter((a) => [a.iata, a.name, a.city ?? ''].some((v) => v.toLocaleLowerCase('tr').includes(q)));
    return { kind: 'SUCCEEDED', value: hits, evidence: this.evidence('airports') };
  }

  async searchRates(criteria: FlightSearchCriteria): Promise<ExternalOutcome<readonly FlightOffer[]>> {
    if (criteria.legs.length === 0 || criteria.legs.length > 2 || criteria.legs.some((l) => !/^[A-Z]{3}$/.test(l.origin) || !/^[A-Z]{3}$/.test(l.destination) || l.origin === l.destination)) {
      return notAvailable('FLIGHT_LEGS', 'Each leg needs IATA origin/destination codes');
    }
    if (criteria.adults < 1 || criteria.infantAges.length > criteria.adults) return notAvailable('PASSENGERS', 'At least one adult, one infant per adult');
    const bp = BigInt(criteria.margin?.basisPoints ?? 0);
    const cur = criteria.currency;
    const counts: Array<[FlightPassengerType, number, bigint]> = [
      ['ADULT', criteria.adults, 8000n],
      ['CHILD', criteria.childAges.length, 6000n],
      ['INFANT', criteria.infantAges.length, 1000n],
    ];
    const legs = criteria.legs;
    const mk = (carrier: string, fareFamily: string, factorPct: bigint, refundable: boolean, viaEsb: boolean, checkedKg: number | null) => {
      let supplierTotal = money(cur, 0n);
      const perPassenger: Partial<Record<FlightPassengerType, Money>> = {};
      for (const [type, n, unit] of counts) {
        if (n === 0) continue;
        const one = money(cur, (unit * factorPct * BigInt(legs.length)) / 100n);
        perPassenger[type] = add(one, percentOf(one, bp, 'HALF_EVEN'));
        supplierTotal = add(supplierTotal, money(cur, one.minor * BigInt(n)));
      }
      const markup = percentOf(supplierTotal, bp, 'HALF_EVEN');
      const base = money(cur, (supplierTotal.minor * 70n) / 100n);
      const taxes = money(cur, supplierTotal.minor - base.minor);
      this.seq += 1;
      const segments: FlightSegment[] = [];
      legs.forEach((l, i) => {
        const direction = i === 0 ? 'OUTBOUND' : 'INBOUND';
        const hops: Array<[string, string, string, string]> = viaEsb && l.origin !== 'ESB' && l.destination !== 'ESB'
          ? [[l.origin, 'ESB', '07:10', '08:25'], ['ESB', l.destination, '10:05', '11:20']]
          : [[l.origin, l.destination, i === 0 ? '08:30' : '18:15', i === 0 ? '09:45' : '19:30']];
        hops.forEach(([from, to, dep, arr], j) => {
          segments.push({
            segmentKey: `MOCK-SEG-${this.seq}-${i}-${j}`,
            direction,
            origin: { code: from, name: MockFlightConnector.AIRPORTS.find((a) => a.iata === from)?.name ?? null },
            destination: { code: to, name: MockFlightConnector.AIRPORTS.find((a) => a.iata === to)?.name ?? null },
            departureLocal: `${l.date}T${dep}:00`,
            arrivalLocal: `${l.date}T${arr}:00`,
            marketingCarrier: { code: carrier, name: `MOCK ${carrier} Airlines` },
            operatingCarrier: { code: carrier, name: `MOCK ${carrier} Airlines` },
            flightNumber: String(100 + this.seq * 10 + i * 2 + j),
            durationMinutes: 75,
            stopCount: 0,
            cabin: criteria.cabinClass === 'BUSINESS' ? 'Business' : 'Economy',
            fareFamily,
          });
        });
      });
      const offerRef = opaque(`MOCK-FOFFER-${this.run}-${this.seq}`);
      const offer: FlightOffer = {
        offerRef,
        journeyKey: `MOCK-JOURNEY-${this.run}-${this.seq}`,
        price: add(supplierTotal, markup),
        supplier: { base, taxes, fees: money(cur, 0n) },
        appliedMarkup: markup,
        perPassenger,
        segments,
        terms: {
          refundable,
          changeable: refundable,
          hasRefundFee: refundable,
          hasChangeFee: refundable,
          summary: refundable ? [{ level: 'warning', message: 'MOCK refundable with a fee' }] : [{ level: 'danger', message: 'MOCK non-refundable' }],
        },
        includedBaggage: [
          { bagType: 'cabin', pieces: 1, weightKg: 8, passengerType: 'ADT' },
          ...(checkedKg ? [{ bagType: 'checked', pieces: 1, weightKg: checkedKg, passengerType: 'ADT' }] : []),
        ],
        fareFamily,
        seatsRemaining: 9,
        expiresAt: new Date(this.clock().getTime() + 30 * 60_000).toISOString(),
      };
      this.offers.set(offerRef, offer);
      this.markupBp.set(offerRef, bp);
      this.serviceBp.set(offerRef, { seats: BigInt(criteria.margin?.seatsBasisPoints ?? 0), bags: BigInt(criteria.margin?.bagsBasisPoints ?? 0) });
      return offer;
    };
    const out = [mk('MK', 'MOCK Flex', 150n, true, false, 20), mk('MK', 'MOCK Light', 100n, false, false, null), mk('MJ', 'MOCK Saver', 80n, false, true, 15)];
    return { kind: 'SUCCEEDED', value: out, evidence: this.evidence('search') };
  }

  async verify(input: { offerRef: OpaqueRef }): Promise<ExternalOutcome<FlightVerification>> {
    const found = this.offers.get(input.offerRef);
    if (!found) return { kind: 'REJECTED', code: 'NUITEE_FLIGHT_OFFER_EXPIRED', message: 'MOCK offer not found', evidence: this.evidence('verify') };
    const changed = this.nextVerifyPriceChange;
    this.nextVerifyPriceChange = false;
    let offer = found;
    if (changed) {
      // The airline fare moved by 1.00; the searched markup applies to the new fare.
      const base = add(found.supplier.base, money(found.price.currency, 100n));
      const supplierTotal = add(add(base, found.supplier.taxes), found.supplier.fees);
      const markup = percentOf(supplierTotal, this.markupBp.get(input.offerRef) ?? 0n, 'HALF_EVEN');
      offer = { ...found, supplier: { ...found.supplier, base }, appliedMarkup: markup, price: add(supplierTotal, markup) };
    }
    if (changed) this.offers.set(input.offerRef, offer);
    return { kind: 'SUCCEEDED', value: { offer, changes: { price: changed, fare: false, cabin: false, messages: changed ? ['MOCK price changed'] : [] } }, evidence: this.evidence('verify') };
  }

  async prebook(input: { offerRef: OpaqueRef; usePaymentSdk: boolean; contact: FlightContact; passengers: readonly FlightPassenger[] }): Promise<ExternalOutcome<FlightPrebook>> {
    const found = this.offers.get(input.offerRef);
    if (!found) return { kind: 'REJECTED', code: 'NUITEE_FLIGHT_OFFER_EXPIRED', message: 'MOCK offer not found', evidence: this.evidence('prebook') };
    if (!input.passengers.some((p) => p.type === 'ADULT') || !input.contact.email.includes('@')) return notAvailable('PASSENGERS', 'At least one adult and a contact e-mail');
    this.seq += 1;
    const prebookRef = opaque(`MOCK-FPRE-${this.run}-${this.seq}`);
    const transactionId = input.usePaymentSdk ? `MOCK-FTX-${this.run}-${this.seq}` : null;
    const priceChanged = this.nextPrebookPriceChange;
    this.nextPrebookPriceChange = false;
    const price = priceChanged ? add(found.price, money(found.price.currency, 100n)) : found.price;
    this.prebooks.set(prebookRef, { offerRef: input.offerRef, transactionId, price, passengers: input.passengers, services: this.catalog(found, input.offerRef), attached: [] });
    return {
      kind: 'SUCCEEDED',
      value: {
        prebookRef,
        amountToCharge: price,
        providerManagedTransaction: transactionId
          ? { __brand: 'ProviderManagedTransactionRef', providerId: 'nuitee', productType: 'FLIGHT', prebookRef, transactionId: opaque(transactionId), environment: 'mock' }
          : null,
        paymentClientSecret: transactionId ? `MOCK_secret_${transactionId}` : null,
        paymentTypes: ['TRANSACTION_ID'],
        servicesAttachable: true,
      },
      evidence: this.evidence('prebook'),
    };
  }

  /** A small seat map (rows 1-4, A-D; row 1 extra legroom; two seats taken) and one checked-bag option per segment. */
  private catalog(offer: FlightOffer, offerRef: string): FlightService[] {
    const bp = this.serviceBp.get(offerRef) ?? { seats: 0n, bags: 0n };
    const cur = offer.price.currency;
    const priced = (base: bigint, markup: bigint) => {
      const net = money(cur, base);
      return add(net, percentOf(net, markup, 'HALF_EVEN'));
    };
    const out: FlightService[] = [];
    for (const seg of offer.segments) {
      for (let row = 1; row <= 4; row += 1) {
        for (const column of ['A', 'B', 'C', 'D']) {
          const number = `${row}${column}`;
          out.push({
            serviceRef: opaque(`MOCK-SVC-${this.run}-${seg.segmentKey}-${number}`),
            category: 'SEAT',
            name: `MOCK Seat ${number}`,
            passengerType: 'ALL',
            segmentKey: seg.segmentKey,
            price: priced(row === 1 ? 1500n : 800n, bp.seats),
            seat: { number, row, column, position: column === 'A' || column === 'D' ? 'window' : 'aisle', type: row === 1 ? 'extra_legroom' : 'standard', available: !(row === 2 && (column === 'B' || column === 'C')) },
            baggage: null,
          });
        }
      }
      out.push({
        serviceRef: opaque(`MOCK-SVC-${this.run}-${seg.segmentKey}-BAG20`),
        category: 'BAGGAGE',
        name: 'MOCK Checked bag 20kg',
        passengerType: 'ALL',
        segmentKey: seg.segmentKey,
        price: priced(2500n, bp.bags),
        seat: null,
        baggage: { bagType: 'checked', pieces: 1, weightKg: 20 },
      });
    }
    return out;
  }

  private prebookState(prebookRef: string): FlightPrebookState | null {
    const pre = this.prebooks.get(prebookRef);
    if (!pre) return null;
    return {
      prebookRef: opaque(prebookRef),
      amountToCharge: pre.price,
      providerManagedTransaction: pre.transactionId
        ? { __brand: 'ProviderManagedTransactionRef', providerId: 'nuitee', productType: 'FLIGHT', prebookRef: opaque(prebookRef), transactionId: opaque(pre.transactionId), environment: 'mock' }
        : null,
      paymentClientSecret: pre.transactionId ? `MOCK_secret_${pre.transactionId}` : null,
      servicesExpiresAt: new Date(this.clock().getTime() + 30 * 60_000).toISOString(),
      services: pre.services,
      attached: [...pre.attached],
    };
  }

  async readPrebook(prebookRef: OpaqueRef): Promise<ExternalOutcome<FlightPrebookState>> {
    const state = this.prebookState(prebookRef);
    return state ? { kind: 'SUCCEEDED', value: state, evidence: this.evidence('readPrebook') } : { kind: 'REJECTED', code: 'NUITEE_44004', message: 'MOCK prebook not found', evidence: this.evidence('readPrebook') };
  }

  /** Attaches services: a new payment intent for the new amount (the old one is superseded), seats taken. */
  async attachServices(input: { prebookRef: OpaqueRef; selections: readonly FlightServiceSelection[] }): Promise<ExternalOutcome<FlightPrebookState>> {
    const pre = this.prebooks.get(input.prebookRef);
    if (!pre) return { kind: 'REJECTED', code: 'NUITEE_44004', message: 'MOCK prebook not found', evidence: this.evidence('attach') };
    if (this.bookings.has(input.prebookRef)) return { kind: 'UNKNOWN', reason: 'AMBIGUOUS', evidence: this.evidence('attach:confirmed') };
    if (this.nextAttachRefused) {
      this.nextAttachRefused = false;
      return { kind: 'REJECTED', code: 'NUITEE_44001', message: 'MOCK ancillary refused', evidence: this.evidence('attach') };
    }
    let added = money(pre.price.currency, this.nextAttachSurcharge);
    this.nextAttachSurcharge = 0n;
    for (const sel of input.selections) {
      const sv = pre.services.find((x) => x.serviceRef === sel.serviceRef);
      if (!sv || sel.passengerIndex >= pre.passengers.length || (sv.seat && !sv.seat.available)) {
        return { kind: 'REJECTED', code: 'NUITEE_44001', message: 'MOCK ancillary not found', evidence: this.evidence('attach') };
      }
      added = add(added, money(sv.price.currency, sv.price.minor * BigInt(sel.quantity)));
    }
    for (const sel of input.selections) {
      const sv = pre.services.find((x) => x.serviceRef === sel.serviceRef)!;
      if (sv.seat) sv.seat = { ...sv.seat, available: false };
      pre.attached.push({ ...sel });
    }
    this.seq += 1;
    pre.price = add(pre.price, added);
    if (pre.transactionId) pre.transactionId = `MOCK-FTX-${this.run}-${this.seq}`;
    if (this.nextAttachLost) {
      this.nextAttachLost = false;
      return { kind: 'UNKNOWN', reason: 'AMBIGUOUS', evidence: this.evidence('attach:lost') };
    }
    return { kind: 'SUCCEEDED', value: this.prebookState(input.prebookRef)!, evidence: this.evidence('attach') };
  }

  private state(prebookRef: string, clientReference: string, price: Money, ticketed: boolean): FlightBookingState {
    this.seq += 1;
    const pnr = `MOCK${String(this.seq).padStart(2, '0')}`;
    return {
      status: ticketed ? 'ISSUED' : 'CONFIRMED',
      providerBookingRef: opaque(`MOCK-FBK-${this.run}-${this.seq}`),
      clientReference,
      pnr,
      ticketNumbers: ticketed ? [`MOCK-TKT-${this.run}-${this.seq}`] : [],
      ticketingStatus: ticketed ? 'ISSUED' : 'PENDING',
      voucherReady: ticketed,
      holdExpiresAt: null,
      supplierCost: price,
      providerCommission: null,
      bookingReference: `MOCK-FH-${this.run}-${this.seq}`,
      airlineLocators: [{ airline: 'MK', pnr }],
      ticketedAt: ticketed ? this.clock().toISOString() : null,
      ticketLimitAt: null,
      cancelRequestedAt: null,
      paymentStatus: 'completed',
    };
  }

  async book(input: { prebookRef: OpaqueRef; clientReference: string; funding: FlightFunding }): Promise<ExternalOutcome<FlightBookingState>> {
    if (this.nextBook) {
      const forced = this.nextBook;
      this.nextBook = null;
      return forced;
    }
    const pre = this.prebooks.get(input.prebookRef);
    if (!pre) return { kind: 'REJECTED', code: 'NUITEE_FLIGHT_OFFER_EXPIRED', message: 'MOCK prebook not found', evidence: this.evidence('book') };
    // Idempotent per prebook: a repeat returns the existing booking.
    const existing = this.bookings.get(input.prebookRef);
    if (existing) return { kind: 'SUCCEEDED', value: existing, evidence: this.evidence('book:repeat') };
    if (input.funding.kind !== 'PROVIDER_MANAGED' || input.funding.transaction.transactionId !== pre.transactionId) {
      return { kind: 'REJECTED', code: 'MOCK_FLIGHT_TRANSACTION_MISMATCH', message: 'MOCK transaction does not belong to the prebook', evidence: this.evidence('book') };
    }
    if (!this.paid.has(pre.transactionId!)) return { kind: 'REJECTED', code: 'MOCK_FLIGHT_PAYMENT_NOT_CONFIRMED', message: 'MOCK payment not confirmed', evidence: this.evidence('book') };
    const state = this.state(input.prebookRef, input.clientReference, pre.price, this.ticketOnBook);
    this.bookings.set(input.prebookRef, state);
    return { kind: 'SUCCEEDED', value: state, evidence: this.evidence('book') };
  }

  private entry(providerBookingRef: OpaqueRef): [string, FlightBookingState] | null {
    return [...this.bookings.entries()].find(([, b]) => b.providerBookingRef === providerBookingRef) ?? null;
  }

  async getBooking(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<FlightBookingState>> {
    const e = this.entry(providerBookingRef);
    if (!e) return { kind: 'REJECTED', code: 'NUITEE_FLIGHT_BOOKING_NOT_FOUND', message: 'MOCK not found', evidence: this.evidence('get') };
    let b = e[1];
    if (b.status === 'CONFIRMED' && !b.ticketedAt) {
      // Ticketed on the first read after booking (the sandbox took minutes).
      b = { ...b, status: 'ISSUED', ticketingStatus: 'ISSUED', voucherReady: true, ticketedAt: this.clock().toISOString(), ticketNumbers: [`MOCK-TKT-${this.run}-${b.pnr}`] };
    } else if (b.status === 'CANCEL_PENDING') {
      b = { ...b, status: 'CANCELLED', ticketingStatus: 'NOT_APPLICABLE', voucherReady: false };
    }
    this.bookings.set(e[0], b);
    return { kind: 'SUCCEEDED', value: b, evidence: this.evidence('get') };
  }

  async cancellationQuote(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<FlightCancellationQuote>> {
    const e = this.entry(providerBookingRef);
    if (!e) return { kind: 'REJECTED', code: 'NUITEE_FLIGHT_BOOKING_NOT_FOUND', message: 'MOCK not found', evidence: this.evidence('quote') };
    const paid = e[1].supplierCost!;
    return {
      kind: 'SUCCEEDED',
      value: { confidence: 'estimated', refundable: true, voidable: false, refund: paid, penalty: money(paid.currency, 0n), destination: 'original_payment', vouchers: 0, expiresAt: null },
      evidence: this.evidence('quote'),
    };
  }

  async cancel(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<FlightCancelResult>> {
    const e = this.entry(providerBookingRef);
    if (!e) return { kind: 'REJECTED', code: 'NUITEE_FLIGHT_BOOKING_NOT_FOUND', message: 'MOCK not found', evidence: this.evidence('cancel') };
    const paid = e[1].supplierCost!;
    const pending = this.cancelPending;
    this.cancelPending = false;
    const next: FlightBookingState = pending
      ? { ...e[1], status: 'CANCEL_PENDING', cancelRequestedAt: this.clock().toISOString() }
      : { ...e[1], status: 'CANCELLED', ticketingStatus: 'NOT_APPLICABLE', voucherReady: false };
    this.bookings.set(e[0], next);
    return {
      kind: 'SUCCEEDED',
      value: { ...next, penalty: money(paid.currency, 0n), refundAmount: pending ? null : paid, destination: 'original_payment', vouchers: 0 },
      evidence: this.evidence('cancel'),
    };
  }
}
