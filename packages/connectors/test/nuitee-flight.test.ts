import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { opaque, type FlightPassenger, type FlightSearchCriteria, type HttpRequest, type HttpResult, type HttpTransport, type ProviderManagedTransactionRef } from '@texholiday/contracts';
import { money } from '@texholiday/pricing';
import { NuiteeFlightConnector } from '../src/index';

// Fixtures are the official examples embedded in the pinned flights OpenAPI (contracts/sources, SHA-256 locked), plus
// response shapes observed in the Nuitee sandbox on 2026-10-09 where the examples are silent (marked SANDBOX SHAPE).
const sources = join(__dirname, '..', '..', '..', 'contracts', 'sources');
const flights = JSON.parse(readFileSync(join(sources, 'nuitee-openapi-flights.json'), 'utf8'));
const example = (path: string, method: string, code: string, name?: string): any => {
  const content = flights.paths[path][method].responses[code].content['application/json'];
  return name ? content.examples[name].value : content.example;
};

/** TEST DOUBLE: scripted transport returning raw JSON text. */
class Scripted implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly responses: HttpResult[]) {}
  async send(req: HttpRequest): Promise<HttpResult> {
    this.requests.push(req);
    const r = this.responses.shift();
    if (!r) throw new Error('no scripted response');
    return r;
  }
}
const res = (status: number, body: unknown): HttpResult => ({ kind: 'RESPONSE', response: { status, headers: {}, body: typeof body === 'string' ? body : JSON.stringify(body) }, durationMs: 10 });
const timeout: HttpResult = { kind: 'NO_RESPONSE', reason: 'TIMEOUT', detail: 'timeout', durationMs: 60_000 };
const err = (status: number, code: number, description: string) => res(status, { error: { code, description, message: description } });

function connector(responses: HttpResult[], environment: 'sandbox' | 'production' = 'sandbox') {
  const t = new Scripted(responses);
  const c = new NuiteeFlightConnector(
    { apiKey: 'test-key-not-real-000000', environment, baseUrl: 'https://api.liteapi.travel/v3.0', searchTimeoutSeconds: 30, bookTimeoutSeconds: 120 },
    t,
    () => new Date('2026-10-09T10:00:00Z'),
  );
  return { c, t };
}

const criteria: FlightSearchCriteria = {
  legs: [{ origin: 'JFK', destination: 'CDG', date: '2026-07-01' }],
  adults: 1,
  childAges: [],
  infantAges: [],
  cabinClass: null,
  pointOfSale: 'TR',
  currency: 'USD',
  margin: null,
};

// TEST-ONLY passenger and contact (fictional data, never a real person).
const passenger: FlightPassenger = {
  type: 'ADULT',
  firstName: 'Test',
  lastName: 'Passenger',
  middleName: null,
  birthDate: '1990-01-15',
  gender: 'F',
  nationality: 'TR',
  document: { type: 'passport', number: 'X0000001', issuingCountry: 'TR', expiresOn: '2031-01-01' },
};
const contact = { email: 'contact@example.test', firstName: 'Test', lastName: 'Passenger', phoneCountryCode: '90', phoneNumber: '5321234567' };

const tx = (prebookRef = '019d0674-834d-7db7-9c8b-93fe8e46e7b8', environment: 'sandbox' | 'production' = 'sandbox'): ProviderManagedTransactionRef => ({
  __brand: 'ProviderManagedTransactionRef',
  providerId: 'nuitee',
  productType: 'FLIGHT',
  prebookRef: opaque(prebookRef),
  transactionId: opaque('tr_test_not_real'),
  environment,
});

/** SANDBOX SHAPE (2026-10-09, trimmed): POST /flights/bookings 201 right after the payment component returned. */
const sandboxBooking = (over: Record<string, unknown> = {}) => ({
  data: [
    {
      booking: {
        bookingId: '01a12301-ba14-7850-b5a2-8228264cce3d',
        bookingRef: 'FH-26A-TESTREF1',
        status: 'PENDING_CONFIRMATION',
        paymentStatus: 'succeeded',
        providerEnvironment: 'sandbox',
        payment: { amount: 22.1, currency: 'EUR' },
        pricing: { subtotal: 22.76, totalAmount: 22.76, currency: 'EUR' },
        order: { reference: { orderId: 'TESTA0000' }, status: 'created', price: { currency: 'USD', total: 23.3 }, ticketLimitTime: '2026-10-10T00:01:19.000Z' },
        ticketLimitTime: '2026-10-10T00:01:19.000Z',
        customTags: { TH_REF: 'th-fl-0001' },
        ...over,
      },
    },
  ],
});

describe('Nuitee flight search (pinned flights OpenAPI example)', () => {
  it('maps the official rates example into an exact offer with supplier breakdown, segments and rules', async () => {
    const { c, t } = connector([res(200, example('/flights/rates', 'post', '200'))]);
    const out = await c.searchRates(criteria);
    expect(out.kind).toBe('SUCCEEDED');
    if (out.kind !== 'SUCCEEDED') return;
    expect(out.value).toHaveLength(1);
    const o = out.value[0]!;
    expect(o.price).toEqual(money('USD', 75387n));
    expect(o.supplier).toEqual({ base: money('USD', 40363n), taxes: money('USD', 35024n), fees: money('USD', 0n) });
    // Only the passenger types searched for; the example's zero child/infant prices are not offers.
    expect(o.perPassenger).toEqual({ ADULT: money('USD', 75387n) });
    expect(o.segments).toEqual([
      expect.objectContaining({ segmentKey: 'd0a8a7dd', direction: 'OUTBOUND', origin: expect.objectContaining({ code: 'JFK' }), destination: expect.objectContaining({ code: 'CDG' }), flightNumber: '2017', stopCount: 0, cabin: 'Economy' }),
    ]);
    expect(o.terms).toMatchObject({ refundable: false, changeable: true, hasChangeFee: true, hasRefundFee: false });
    expect(o.terms.summary).toContainEqual({ level: 'danger', message: 'Non-refundable' });
    expect(o.includedBaggage).toEqual([{ bagType: 'cabin', pieces: 1, weightKg: 8, passengerType: 'ADT' }]);
    expect(o.expiresAt).toBe('2026-03-19T12:52:59.494Z');
    const req = t.requests[0]!;
    expect(req.url).toBe('https://api.liteapi.travel/v3.0/flights/rates');
    expect(req.headers['x-api-key']).toBe('test-key-not-real-000000');
    // No policy margin = an explicit 0, so no account-level markup applies silently.
    expect(JSON.parse(req.body!)).toEqual({ legs: [{ origin: 'JFK', destination: 'CDG', date: '2026-07-01' }], adults: 1, currency: 'USD', country: 'TR', margin: { rateSearch: 0 } });
  });

  it('sends the approved markup as a percentage and children/infants with their ages', async () => {
    const { c, t } = connector([res(200, { data: [{ journeys: [] }] })]);
    const out = await c.searchRates({ ...criteria, adults: 2, childAges: [7], infantAges: [1], cabinClass: 'BUSINESS', margin: { basisPoints: 1050 } });
    expect(out).toMatchObject({ kind: 'SUCCEEDED', value: [] });
    expect(JSON.parse(t.requests[0]!.body!)).toMatchObject({ adults: 2, children: 1, childrenAges: [7], infants: 1, infantAges: [1], cabinClass: 'BUSINESS', margin: { rateSearch: 10.5 } });
  });

  it('refuses invalid searches without a call (more infants than adults, bad codes)', async () => {
    const { c, t } = connector([]);
    expect((await c.searchRates({ ...criteria, infantAges: [0, 1] })).kind).toBe('CAPABILITY_NOT_AVAILABLE');
    expect((await c.searchRates({ ...criteria, legs: [{ origin: 'jfk', destination: 'CDG', date: '2026-07-01' }] })).kind).toBe('CAPABILITY_NOT_AVAILABLE');
    expect((await c.searchRates({ ...criteria, legs: [] })).kind).toBe('CAPABILITY_NOT_AVAILABLE');
    expect(t.requests).toHaveLength(0);
  });

  it('drops offers it cannot price exactly or priced in another currency; provider refusals keep their code', async () => {
    const body = example('/flights/rates', 'post', '200');
    const eur = structuredClone(body);
    eur.data[0].journeys[0].offers[0].pricing.display.currency = 'EUR';
    expect(await connector([res(200, eur)]).c.searchRates(criteria)).toMatchObject({ kind: 'SUCCEEDED', value: [] });
    const noTotal = structuredClone(body);
    delete noTotal.data[0].journeys[0].offers[0].pricing.display.total;
    expect(await connector([res(200, noTotal)]).c.searchRates(criteria)).toMatchObject({ kind: 'SUCCEEDED', value: [] });
    expect(await connector([err(400, 41012, 'number of infants cannot exceed number of adults')]).c.searchRates(criteria)).toMatchObject({ kind: 'REJECTED', code: 'NUITEE_41012' });
    expect((await connector([err(503, 51004, 'temporarily unavailable')]).c.searchRates(criteria)).kind).toBe('UNKNOWN');
  });
});

describe('Nuitee flight verify (pinned example)', () => {
  it('keeps the offer id we sent (not in the body) and reports no changes', async () => {
    const { c, t } = connector([res(200, example('/flights/verify', 'post', '200'))]);
    const out = await c.verify({ offerRef: opaque('offer-1') });
    expect(out.kind).toBe('SUCCEEDED');
    if (out.kind !== 'SUCCEEDED') return;
    expect(out.value.offer.offerRef).toBe('offer-1');
    expect(out.value.offer.price).toEqual(money('USD', 142342n));
    expect(out.value.changes).toEqual({ price: false, fare: false, cabin: false, messages: [] });
    expect(JSON.parse(t.requests[0]!.body!)).toEqual({ offerId: 'offer-1' });
  });

  it('flags price/fare changes for a new acceptance; an expired offer means search again', async () => {
    const body = example('/flights/verify', 'post', '200');
    body.data[0].changes = { priceChanged: true, fareChanged: false, cabinChanged: false, messages: ['Price increased'] };
    expect(await connector([res(200, body)]).c.verify({ offerRef: opaque('o') })).toMatchObject({ kind: 'SUCCEEDED', value: { changes: { price: true, messages: ['Price increased'] } } });
    expect(await connector([err(404, 42017, 'The offer has expired')]).c.verify({ offerRef: opaque('o') })).toMatchObject({ kind: 'REJECTED', code: 'NUITEE_FLIGHT_OFFER_EXPIRED' });
  });
});

describe('Nuitee flight prebook (pinned example)', () => {
  it('returns the amount to charge, the payment-component secret and the transaction of this prebook', async () => {
    const { c, t } = connector([res(200, example('/flights/prebooks', 'post', '200'))]);
    const out = await c.prebook({ offerRef: opaque('offer-1'), usePaymentSdk: true, contact, passengers: [passenger] });
    expect(out.kind).toBe('SUCCEEDED');
    if (out.kind !== 'SUCCEEDED') return;
    expect(out.value.prebookRef).toBe('019d0674-834d-7db7-9c8b-93fe8e46e7b8');
    expect(out.value.amountToCharge).toEqual(money('USD', 74027n));
    expect(out.value.providerManagedTransaction).toMatchObject({ providerId: 'nuitee', productType: 'FLIGHT', prebookRef: '019d0674-834d-7db7-9c8b-93fe8e46e7b8', environment: 'sandbox' });
    expect(out.value.paymentClientSecret).toMatch(/^pi_/);
    expect(out.value.paymentTypes).toEqual(['TRANSACTION_ID', 'CREDIT', 'ACC_CREDIT_CARD']);
    expect(out.value.servicesAttachable).toBe(true);
    expect(JSON.parse(t.requests[0]!.body!)).toEqual({
      offerId: 'offer-1',
      usePaymentSdk: true,
      contact,
      passengers: [{ firstName: 'Test', lastName: 'Passenger', birthday: '1990-01-15', gender: 'F', nationality: 'TR', passengerType: 0, documentType: 'passport', documentNumber: 'X0000001', documentIssueCountry: 'TR', documentExpiry: '2031-01-01' }],
    });
  });

  it('checks passenger and contact data before any call (a bad phone came back as HTTP 500 in sandbox)', async () => {
    const { c, t } = connector([]);
    const call = (over: Partial<Parameters<typeof c.prebook>[0]>) => c.prebook({ offerRef: opaque('o'), usePaymentSdk: true, contact, passengers: [passenger], ...over });
    expect((await call({ contact: { ...contact, phoneNumber: '000' } })).kind).toBe('CAPABILITY_NOT_AVAILABLE');
    expect((await call({ passengers: [{ ...passenger, type: 'CHILD' }] })).kind).toBe('CAPABILITY_NOT_AVAILABLE');
    expect((await call({ passengers: [{ ...passenger, birthDate: '15.01.1990' }] })).kind).toBe('CAPABILITY_NOT_AVAILABLE');
    expect((await call({ passengers: [{ ...passenger, document: { ...passenger.document!, issuingCountry: 'Turkey' } }] })).kind).toBe('CAPABILITY_NOT_AVAILABLE');
    expect(t.requests).toHaveLength(0);
  });

  it('a payment-component prebook without its secret cannot be paid; silence and 5xx stay UNKNOWN; expiry means search again', async () => {
    const noSecret = example('/flights/prebooks', 'post', '200');
    delete noSecret.data[0].secretKey;
    const args = { offerRef: opaque('o'), usePaymentSdk: true, contact, passengers: [passenger] };
    expect(await connector([res(200, noSecret)]).c.prebook(args)).toMatchObject({ kind: 'UNKNOWN', reason: 'MALFORMED_RESPONSE' });
    expect(await connector([timeout]).c.prebook(args)).toMatchObject({ kind: 'UNKNOWN', reason: 'TIMEOUT' });
    expect(await connector([err(500, 53099, 'Failed to create prebook')]).c.prebook(args)).toMatchObject({ kind: 'UNKNOWN', reason: 'UPSTREAM_5XX' });
    expect(await connector([err(404, 43017, 'The offer has expired')]).c.prebook(args)).toMatchObject({ kind: 'REJECTED', code: 'NUITEE_FLIGHT_OFFER_EXPIRED' });
  });
});

describe('Nuitee flight book: idempotent per prebook, ambiguous answers are UNKNOWN (T08/T19/T22)', () => {
  const prebookRef = opaque('019d0674-834d-7db7-9c8b-93fe8e46e7b8');
  const book = (c: NuiteeFlightConnector, over: Partial<Parameters<NuiteeFlightConnector['book']>[0]> = {}) =>
    c.book({ prebookRef, clientReference: 'th-fl-0001', funding: { kind: 'PROVIDER_MANAGED', transaction: tx() }, ...over });

  it('sends TRANSACTION_ID with our reference as a booking label; the replay example maps to CONFIRMED, not ticketed', async () => {
    const { c, t } = connector([res(200, example('/flights/bookings', 'post', '200'))]);
    const out = await book(c);
    expect(out).toMatchObject({ kind: 'SUCCEEDED', value: { status: 'CONFIRMED', ticketingStatus: 'PENDING', voucherReady: false, providerBookingRef: '1297abe4-57c5-4605-b8e7-5caad983c4a7', clientReference: 'th-fl-0001' } });
    // The documented path redirects (307) to the trailing-slash form; redirects are never followed.
    expect(t.requests[0]!.url).toBe('https://api.liteapi.travel/v3.0/flights/bookings/');
    expect(JSON.parse(t.requests[0]!.body!)).toEqual({ prebookId: prebookRef, payment: { method: 'TRANSACTION_ID', transactionId: 'tr_test_not_real' }, customTags: { TH_REF: 'th-fl-0001' } });
  });

  it('maps the sandbox answer: pending confirmation, booking reference, total charged, raw payment status', async () => {
    const out = await book(connector([res(201, sandboxBooking())]).c);
    expect(out).toMatchObject({
      kind: 'SUCCEEDED',
      value: { status: 'PENDING_CONFIRMATION', ticketingStatus: 'PENDING', bookingReference: 'FH-26A-TESTREF1', paymentStatus: 'succeeded', supplierCost: money('EUR', 2276n), providerCommission: null, ticketLimitAt: '2026-10-10T00:01:19.000Z', pnr: null },
    });
  });

  it('409 (concurrent, duplicate, already ticketed), 5xx and timeouts are UNKNOWN: resolved by repeating with the same prebook', async () => {
    for (const r of [err(409, 45035, 'A concurrent operation is already in progress'), err(409, 45087, 'already ticketed'), err(429, 4290, 'Too many requests'), err(502, 55004, 'payment failed'), err(500, 55099, 'Failed'), timeout]) {
      expect((await book(connector([r]).c)).kind).toBe('UNKNOWN');
    }
  });

  it('validation and expiry refusals are REJECTED (no booking exists)', async () => {
    expect(await book(connector([err(404, 45029, 'The offer has expired')]).c)).toMatchObject({ kind: 'REJECTED', code: 'NUITEE_FLIGHT_OFFER_EXPIRED' });
    expect(await book(connector([err(400, 45004, 'passenger data is invalid')]).c)).toMatchObject({ kind: 'REJECTED', code: 'NUITEE_45004' });
  });

  it('a record from the other environment or carrying another reference of ours is never accepted', async () => {
    expect((await book(connector([res(201, sandboxBooking({ providerEnvironment: 'production' }))]).c)).kind).toBe('UNKNOWN');
    expect((await book(connector([res(201, sandboxBooking({ customTags: { TH_REF: 'th-fl-other' } }))]).c)).kind).toBe('UNKNOWN');
    expect((await book(connector([res(201, sandboxBooking({ status: 'ON_HOLD' }))]).c)).kind).toBe('UNKNOWN');
  });

  it('refuses foreign transactions and CREDIT outside production without a call', async () => {
    const { c, t } = connector([]);
    expect((await book(c, { funding: { kind: 'PROVIDER_MANAGED', transaction: tx('another-prebook') } })).kind).toBe('CAPABILITY_NOT_AVAILABLE');
    expect((await book(c, { funding: { kind: 'PROVIDER_MANAGED', transaction: { ...tx(), productType: 'HOTEL' } } })).kind).toBe('CAPABILITY_NOT_AVAILABLE');
    expect((await book(c, { funding: { kind: 'PROVIDER_MANAGED', transaction: tx(undefined, 'production') } })).kind).toBe('CAPABILITY_NOT_AVAILABLE');
    expect((await book(c, { funding: { kind: 'CREDIT_LINE' } })).kind).toBe('CAPABILITY_NOT_AVAILABLE');
    expect((await book(c, { clientReference: 'x' })).kind).toBe('CAPABILITY_NOT_AVAILABLE');
    expect(t.requests).toHaveLength(0);
  });
});

describe('Nuitee flight booking status: PNR is not a ticket (T08)', () => {
  const get = (body: unknown) => connector([res(200, body)]).c.getBooking(opaque('01a12301-ba14-7850-b5a2-8228264cce3d'));

  it('CREATED is still pending; CONFIRMED with an airline PNR but no ticket data is not issued', async () => {
    expect(await get(sandboxBooking({ status: 'CREATED' }))).toMatchObject({ kind: 'SUCCEEDED', value: { status: 'PENDING_CONFIRMATION' } });
    const confirmed = await get(sandboxBooking({ status: 'CONFIRMED', paymentStatus: 'completed', airlineLocators: [{ airlineCode: 'VF', airlinePnr: 'S70241' }] }));
    expect(confirmed).toMatchObject({ kind: 'SUCCEEDED', value: { status: 'CONFIRMED', pnr: 'S70241', airlineLocators: [{ airline: 'VF', pnr: 'S70241' }], ticketingStatus: 'PENDING', voucherReady: false } });
  });

  it('ticket data or a ticketed order means ISSUED; a pending cancellation and the final cancellation are distinct', async () => {
    expect(await get(sandboxBooking({ status: 'CONFIRMED', ticketData: { confirmationId: 'C1', ticketedAt: '2026-10-09T23:40:00Z' } }))).toMatchObject({
      value: { status: 'ISSUED', ticketingStatus: 'ISSUED', voucherReady: true, ticketedAt: '2026-10-09T23:40:00Z' },
    });
    expect(await get(sandboxBooking({ status: 'CONFIRMED', order: { status: 'ticketed' } }))).toMatchObject({ value: { status: 'ISSUED' } });
    // SANDBOX SHAPE (2026-10-10): ticketData also carries tickets[] (not in the OpenAPI); passenger data in it is not kept.
    const ticketed = await get(
      sandboxBooking({
        status: 'CONFIRMED',
        airlineLocators: [{ airlineCode: 'VF', airlinePnr: 'S73039' }],
        ticketData: { confirmationId: 'C1', ticketedAt: '2026-10-10T00:03:52.785Z', tickets: [{ passengerIndex: 0, status: 'issued', ticketNumber: 'S73039', documentNumber: 'U00000003' }] },
      }),
    );
    expect(ticketed).toMatchObject({ value: { status: 'ISSUED', ticketNumbers: ['S73039'], pnr: 'S73039' } });
    expect(JSON.stringify(ticketed, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain('U00000003');
    expect(await get(sandboxBooking({ status: 'CONFIRMED', cancelIntentAt: '2026-10-09T23:50:00Z' }))).toMatchObject({ value: { status: 'CANCEL_PENDING', cancelRequestedAt: '2026-10-09T23:50:00Z' } });
    // SANDBOX SHAPE: a booking cancelled before confirmation stays CREATED with cancelIntentAt until the airline answers.
    expect(await get(sandboxBooking({ status: 'CREATED', cancelIntentAt: '2026-10-09T23:47:47Z' }))).toMatchObject({ value: { status: 'CANCEL_PENDING' } });
    expect(await get(sandboxBooking({ status: 'CANCELLED_WITH_CHARGES' }))).toMatchObject({ value: { status: 'CANCELLED', ticketingStatus: 'NOT_APPLICABLE' } });
    // Kept as evidence after the cancellation is final: the final status wins.
    expect(await get(sandboxBooking({ status: 'CANCELLED', cancelIntentAt: '2026-10-09T23:47:47Z' }))).toMatchObject({ value: { status: 'CANCELLED' } });
  });

  it('the official example (empty airline PNR) has no locator; not found is REJECTED; another booking id is UNKNOWN', async () => {
    const body = example('/flights/bookings/{bookingId}', 'get', '200');
    const out = await connector([res(200, body)]).c.getBooking(opaque('1297abe4-57c5-4605-b8e7-5caad983c4a7'));
    expect(out).toMatchObject({ kind: 'SUCCEEDED', value: { status: 'CONFIRMED', pnr: null, airlineLocators: [] } });
    expect(await connector([err(404, 47002, 'The booking was not found')]).c.getBooking(opaque('x'))).toMatchObject({ kind: 'REJECTED', code: 'NUITEE_FLIGHT_BOOKING_NOT_FOUND' });
    expect((await connector([res(200, body)]).c.getBooking(opaque('another-id'))).kind).toBe('UNKNOWN');
  });
});

describe('Nuitee flight cancellation quote and cancel (pinned examples)', () => {
  const id = opaque('1297abe4-57c5-4605-b8e7-5caad983c4a7');

  it('maps the quote without inventing aggregates; sandbox 500 (59099) is UNKNOWN; a running cancellation is REJECTED', async () => {
    const out = await connector([res(200, example('/flights/bookings/{bookingId}/cancellations', 'get', '200'))]).c.cancellationQuote(id);
    expect(out).toMatchObject({ kind: 'SUCCEEDED', value: { confidence: 'confirmed', refundable: false, voidable: false, refund: null, penalty: null, destination: 'voucher', vouchers: 1 } });
    expect((await connector([err(500, 59099, 'failed to retrieve cancellation quote')]).c.cancellationQuote(id)).kind).toBe('UNKNOWN');
    expect(await connector([err(409, 49007, 'A cancellation is already in progress')]).c.cancellationQuote(id)).toMatchObject({ kind: 'REJECTED', code: 'NUITEE_49007' });
  });

  it('200 is final (fee and refund exact), 202 is pending with estimates', async () => {
    const cancelled = await connector([res(200, example('/flights/bookings/{bookingId}/cancellations', 'post', '200', 'cancelled'))]).c.cancel(id);
    expect(cancelled).toMatchObject({ kind: 'SUCCEEDED', value: { status: 'CANCELLED', penalty: money('USD', 0n), refundAmount: money('USD', 23364n) } });
    const charged = await connector([res(200, example('/flights/bookings/{bookingId}/cancellations', 'post', '200', 'cancelledWithCharges'))]).c.cancel(id);
    expect(charged).toMatchObject({ value: { status: 'CANCELLED', penalty: money('USD', 440n), refundAmount: money('USD', 0n) } });
    const voucher = await connector([res(200, example('/flights/bookings/{bookingId}/cancellations', 'post', '200', 'cancelledWithVoucher'))]).c.cancel(opaque('019f1ec3-bc83-7674-9478-8570a35ed218'));
    expect(voucher).toMatchObject({ value: { status: 'CANCELLED', destination: 'voucher', vouchers: 1 } });
    const pending = await connector([res(202, example('/flights/bookings/{bookingId}/cancellations', 'post', '202', 'awaitingConfirmation'))]).c.cancel(opaque('019f89e1-a72a-78b9-a04e-bafc4c12cd5a'));
    expect(pending).toMatchObject({ kind: 'SUCCEEDED', value: { status: 'CANCEL_PENDING', penalty: money('USD', 440n) } });
    // SANDBOX SHAPE: 202 for a booking not confirmed yet carries its current status (CREATED), not CONFIRMED.
    const created = { data: { bookingId: id, status: 'CREATED', cancellation_fee: 0, refund_amount: 0, currency: 'EUR' } };
    expect(await connector([res(202, created)]).c.cancel(id)).toMatchObject({ kind: 'SUCCEEDED', value: { status: 'CANCEL_PENDING' } });
    expect((await connector([res(202, { data: { ...created.data, status: 'CANCELLED' } })]).c.cancel(id)).kind).toBe('UNKNOWN');
  });

  it('SANDBOX SHAPE: refund to "agency_deposit" is reported as is (who refunds the customer is a provider question)', async () => {
    const body = { data: { bookingId: id, status: 'CANCELLED', cancellation_fee: 0, refund_amount: 22.76, currency: 'EUR', refund_type: 'full', destination: 'agency_deposit' } };
    expect(await connector([res(200, body)]).c.cancel(id)).toMatchObject({ value: { status: 'CANCELLED', refundAmount: money('EUR', 2276n), destination: 'agency_deposit' } });
  });

  it('409 (already cancelled, concurrent, not yet final), odd statuses and silence are UNKNOWN; not found is REJECTED', async () => {
    for (const r of [err(409, 46004, 'Booking is already cancelled'), err(409, 46006, 'cancellation is not yet final'), err(502, 56002, 'connection failed'), timeout]) {
      expect((await connector([r]).c.cancel(id)).kind).toBe('UNKNOWN');
    }
    expect((await connector([res(200, { data: { bookingId: id, status: 'CONFIRMED', cancellation_fee: 0, refund_amount: 0, currency: 'USD' } })]).c.cancel(id)).kind).toBe('UNKNOWN');
    expect(await connector([err(404, 46002, 'The booking was not found')]).c.cancel(id)).toMatchObject({ kind: 'REJECTED', code: 'NUITEE_FLIGHT_BOOKING_NOT_FOUND' });
  });
});

describe('Nuitee flight descriptor', () => {
  it('declares issuance, idempotent book/cancel and only pinned sources', () => {
    const d = connector([]).c.descriptor();
    expect(d).toMatchObject({ connectorId: 'nuitee-flight', productType: 'FLIGHT', requiresIssuance: true, isMock: false });
    expect(d.operations.book).toEqual({ effect: 'CREATES_PROVIDER_RESERVATION', lostResponse: 'DOCUMENTED_IDEMPOTENCY_KEY' });
    const lock = JSON.parse(readFileSync(join(sources, '..', 'sources.lock.json'), 'utf8')) as { sources: Array<{ id: string; status: string }> };
    for (const s of d.requiredSources) expect(lock.sources.find((x) => x.id === s)?.status).toBe('PINNED');
  });
});
