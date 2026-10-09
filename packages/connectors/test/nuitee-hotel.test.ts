import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { opaque, type HttpRequest, type HttpResult, type HttpTransport, type ProviderManagedTransactionRef } from '@texholiday/contracts';
import { money } from '@texholiday/pricing';
import { NuiteeHotelConnector } from '../src/index';

// Fixtures are the official examples embedded in the pinned OpenAPI documents (contracts/sources, SHA-256 locked).
const sources = join(__dirname, '..', '..', '..', 'contracts', 'sources');
const search = JSON.parse(readFileSync(join(sources, 'nuitee-openapi-search.json'), 'utf8'));
const booking = JSON.parse(readFileSync(join(sources, 'nuitee-openapi-booking.json'), 'utf8'));

type Examples = Record<string, { value: unknown }>;
const examples = (doc: Record<string, any>, path: string, method: string, code: string): Examples => {
  const content = doc.paths[path][method].responses[code].content['application/json'];
  return content.examples ?? { example: { value: content.example } };
};
const first = (ex: Examples) => Object.values(ex)[0]!.value;

/** TEST DOUBLE: scripted transport returning raw JSON text exactly as the spec example. */
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
const res = (status: number, body: unknown): HttpResult => ({ kind: 'RESPONSE', response: { status, headers: {}, body: JSON.stringify(body) }, durationMs: 10 });

function connector(responses: HttpResult[], environment: 'sandbox' | 'production' = 'sandbox') {
  const t = new Scripted(responses);
  const c = new NuiteeHotelConnector(
    { apiKey: 'test-key-not-real-000000', environment, searchBaseUrl: 'https://api.liteapi.travel/v3.0', bookBaseUrl: 'https://book.liteapi.travel/v3.0', searchTimeoutSeconds: 6, bookTimeoutSeconds: 120 },
    t,
    () => new Date('2026-10-09T10:00:00Z'),
  );
  return { c, t };
}

const criteria = {
  hotelIds: ['lp1897'],
  checkin: '2026-12-05',
  checkout: '2026-12-10',
  occupancies: [{ occupancyNumber: 1, adults: 2, childAges: [] }],
  guestNationality: 'TR',
  currency: 'USD',
  margin: null,
};

describe('Nuitee hotel search (pinned search OpenAPI example)', () => {
  it('maps the official rates example into an exact, fully-priced offer', async () => {
    const { c, t } = connector([res(200, first(examples(search, '/hotels/rates', 'post', '200')))]);
    const out = await c.searchRates(criteria);
    expect(out.kind).toBe('SUCCEEDED');
    if (out.kind !== 'SUCCEEDED') return;
    const offer = out.value[0]!;
    expect(offer.hotelId).toBe('lp1897');
    expect(offer.price).toEqual(money('USD', 16366n));
    expect(offer.suggestedSellingPrice).toEqual(money('USD', 19152n));
    expect(offer.providerAppliedMargin).toEqual(money('USD', 628n));
    // "Facility Fee" is included:false -> paid at the property, never charged now.
    expect(offer.payAtProperty).toEqual([money('USD', 4361n)]);
    expect(offer.cancellation).toEqual({ timezone: 'UTC', refundable: true, steps: [{ from: '2026-07-30T02:00:00.000Z', penalty: money('USD', 16366n) }], providerText: null });
    expect(offer.occupancyNumbers).toEqual([1]);
    const req = t.requests[0]!;
    expect(req.url).toBe('https://api.liteapi.travel/v3.0/hotels/rates');
    expect(req.headers['x-api-key']).toBe('test-key-not-real-000000');
    expect(JSON.parse(req.body!)).toMatchObject({ occupancies: [{ adults: 2, children: [] }], guestNationality: 'TR', currency: 'USD', margin: 0, timeout: 6 });
  });

  it('sends the policy margin (own gateway or provider-managed, ADR-0006) as a percentage and caps batch size', async () => {
    const { c, t } = connector([res(200, { data: [] })]);
    await c.searchRates({ ...criteria, margin: { basisPoints: 1050 } });
    expect(JSON.parse(t.requests[0]!.body!).margin).toBe(10.5);
    const big = await connector([]).c.searchRates({ ...criteria, hotelIds: Array.from({ length: 201 }, (_, i) => `h${i}`) });
    expect(big.kind).toBe('CAPABILITY_NOT_AVAILABLE');
  });

  it('no availability (204/2001) is an empty result, not an error', async () => {
    const { c } = connector([{ kind: 'RESPONSE', response: { status: 204, headers: {}, body: '' }, durationMs: 1 }]);
    expect(await c.searchRates(criteria)).toMatchObject({ kind: 'SUCCEEDED', value: [] });
  });
});

describe('Nuitee hotel prebook (pinned booking OpenAPI example)', () => {
  it('returns the prebook with exact price, change flags and the SDK transaction only when requested', async () => {
    const ex = first(examples(booking, '/rates/prebook', 'post', '200'));
    const { c, t } = connector([res(200, ex), res(200, ex)]);
    const own = await c.prebook({ offerRef: opaque('offer-1'), usePaymentSdk: false, clientReference: 'pb-1' });
    expect(own.kind).toBe('SUCCEEDED');
    if (own.kind !== 'SUCCEEDED') return;
    expect(own.value.prebookRef).toBe('zzWkJcdgk');
    expect(own.value.offer.price).toEqual(money('USD', 21366n));
    expect(own.value.changeFlags).toEqual({ price: false, cancellation: false, board: false });
    expect(own.value.providerManagedTransaction).toBeNull();
    expect(JSON.parse(t.requests[0]!.body!)).toEqual({ offerId: 'offer-1', usePaymentSdk: false });
    const sdk = await c.prebook({ offerRef: opaque('offer-1'), usePaymentSdk: true, clientReference: 'pb-2' });
    expect(sdk.kind === 'SUCCEEDED' && sdk.value.providerManagedTransaction?.transactionId).toBe('tr_ct_NjePtG_-HHUDCeQ_LrTOS');
    // The payment SDK secret comes only with usePaymentSdk:true (user-payment guide).
    expect(own.value.paymentClientSecret).toBeNull();
    expect(sdk.kind === 'SUCCEEDED' && sdk.value.paymentClientSecret).toBe((ex as { data: { secretKey: string } }).data.secretKey);
  });

  it('a payment-SDK prebook without a secretKey cannot be paid: never treated as ready', async () => {
    const ex = first(examples(booking, '/rates/prebook', 'post', '200')) as { data: Record<string, unknown> };
    const { secretKey: _drop, ...data } = ex.data;
    const { c } = connector([res(200, { ...ex, data })]);
    expect((await c.prebook({ offerRef: opaque('offer-1'), usePaymentSdk: true, clientReference: 'pb-3' })).kind).toBe('UNKNOWN');
  });

  it('documented prebook errors and silence stop the item (rate not validated)', async () => {
    const errs = Object.values(examples(booking, '/rates/prebook', 'post', '400')).concat(Object.values(examples(booking, '/rates/prebook', 'post', '408')));
    for (const e of errs) {
      const { c } = connector([res(400, e.value)]);
      expect((await c.prebook({ offerRef: opaque('o'), usePaymentSdk: false, clientReference: 'pb' })).kind).toBe('REJECTED');
    }
    const { c } = connector([{ kind: 'NO_RESPONSE', reason: 'TIMEOUT', detail: 't', durationMs: 135_000 }]);
    expect(await c.prebook({ offerRef: opaque('o'), usePaymentSdk: false, clientReference: 'pb' })).toMatchObject({ kind: 'REJECTED', code: 'NUITEE_PREBOOK_UNCONFIRMED' });
    // Observed in sandbox (not in the pinned spec): HTTP 409 + code 2001 when a net-rate offer is prebooked.
    const sbx = connector([res(409, { error: { code: 2001, message: 'provider price exceeds locked selling price, please search again' } })]);
    expect(await sbx.c.prebook({ offerRef: opaque('o'), usePaymentSdk: false, clientReference: 'pb' })).toMatchObject({ kind: 'REJECTED', code: 'NUITEE_2001' });
  });
});

describe('Nuitee hotel book: every documented error is classified (T19/T22)', () => {
  const holder = { firstName: 'Ada', lastName: 'Yilmaz', email: 'ada@example.test', phone: '+905551112233' };
  const guests = [{ occupancyNumber: 1, leadGuest: { firstName: 'Ada', lastName: 'Yilmaz', email: 'ada@example.test' } }];
  const book = (c: NuiteeHotelConnector, funding: Parameters<NuiteeHotelConnector['book']>[0]['funding'] = { kind: 'ACCOUNT_CARD' }) =>
    c.book({ prebookRef: opaque('PRE123'), clientReference: 'pb-item-1-1', holder, guests, funding });

  it('a confirmed booking maps to CONFIRMED with the supplier cost', async () => {
    const ex = first(examples(booking, '/rates/book', 'post', '200')) as { data: Record<string, unknown> };
    const { c, t } = connector([res(200, { data: { ...ex.data, clientReference: 'pb-item-1-1' } })]);
    const out = await book(c);
    expect(out).toMatchObject({ kind: 'SUCCEEDED', value: { status: 'CONFIRMED', providerBookingRef: 'ABC123', voucherReady: true } });
    expect(out.kind === 'SUCCEEDED' && out.value.supplierCost).toEqual(money('USD', 10000n));
    // ADR-0006: the commission included in the price is reported for the receivable (example: price 100, commission 10).
    expect(out.kind === 'SUCCEEDED' && out.value.providerCommission).toEqual(money('USD', 1000n));
    const body = JSON.parse(t.requests[0]!.body!);
    expect(body).toEqual({ prebookId: 'PRE123', clientReference: 'pb-item-1-1', holder, guests: [{ occupancyNumber: 1, firstName: 'Ada', lastName: 'Yilmaz', email: 'ada@example.test' }], payment: { method: 'ACC_CREDIT_CARD' } });
    expect(t.requests[0]!.url).toBe('https://book.liteapi.travel/v3.0/rates/book?timeout=120');
  });

  it('validation errors are REJECTED; incomplete/failed/duplicate/unknown errors are UNKNOWN (lookup, never re-book)', async () => {
    const all = Object.entries(examples(booking, '/rates/book', 'post', '400')).concat(Object.entries(examples(booking, '/rates/book', 'post', '410')));
    const verdicts: Record<string, string> = {};
    for (const [name, e] of all) {
      const { c } = connector([res(400, e.value)]);
      verdicts[name] = (await book(c)).kind;
    }
    expect(verdicts['duplicate booking attempt with existing client reference']).toBe('UNKNOWN');
    // 2014 "payment not completed": the customer has not paid in the SDK yet -> retry later with the same reference.
    expect(verdicts['payment not completed']).toBe('REJECTED');
    expect(verdicts['payment retrieval failed']).toBe('UNKNOWN'); // other 2014 answers stay open
    expect(verdicts['booking incomplete, booking data was not updated']).toBe('UNKNOWN');
    expect(verdicts['booking failed, provider booking response is invalid']).toBe('UNKNOWN'); // 2013
    expect(verdicts['booking initial save failed, please try again']).toBe('UNKNOWN'); // 5000
    expect(verdicts['Invalid prebookId, rate not found']).toBe('REJECTED'); // 4002
    expect(verdicts['missing or not supported payment method']).toBe('REJECTED'); // 4000
    expect(verdicts['booking not confirmed']).toBe('REJECTED'); // 410 / 4012
    expect(Object.values(verdicts).every((v) => v === 'REJECTED' || v === 'UNKNOWN')).toBe(true);
  });

  it('"payment not completed" has its own code so only provider-managed checkouts wait for the customer', async () => {
    const e = examples(booking, '/rates/book', 'post', '400')['payment not completed']!;
    const { c } = connector([res(400, e.value)]);
    expect(await book(c)).toMatchObject({ kind: 'REJECTED', code: 'NUITEE_PAYMENT_NOT_COMPLETED' });
  });

  it('a timeout is UNKNOWN, never FAILED (hotel-integration guide)', async () => {
    const { c } = connector([{ kind: 'NO_RESPONSE', reason: 'TIMEOUT', detail: 't', durationMs: 135_000 }]);
    expect((await book(c)).kind).toBe('UNKNOWN');
  });

  it('CREDIT is refused outside production without any call (CREDIT bookings are always real)', async () => {
    const { c, t } = connector([]);
    expect((await book(c, { kind: 'CREDIT_LINE' })).kind).toBe('CAPABILITY_NOT_AVAILABLE');
    expect(t.requests).toHaveLength(0);
  });

  it('a provider-managed transaction must belong to the same prebook and environment (no foreign ids)', async () => {
    const tx = (over: Partial<ProviderManagedTransactionRef> = {}): ProviderManagedTransactionRef => ({
      __brand: 'ProviderManagedTransactionRef',
      providerId: 'nuitee',
      productType: 'HOTEL',
      prebookRef: opaque('PRE123'),
      transactionId: opaque('tr_1'),
      environment: 'sandbox',
      ...over,
    });
    const { c, t } = connector([res(200, { data: { bookingId: 'B1', clientReference: 'pb-item-1-1', status: 'CONFIRMED', price: 1, currency: 'USD' } })]);
    expect((await book(c, { kind: 'PROVIDER_MANAGED', transaction: tx({ prebookRef: opaque('OTHER') }) })).kind).toBe('CAPABILITY_NOT_AVAILABLE');
    expect((await book(c, { kind: 'PROVIDER_MANAGED', transaction: tx({ productType: 'EXPERIENCE' }) })).kind).toBe('CAPABILITY_NOT_AVAILABLE');
    await book(c, { kind: 'PROVIDER_MANAGED', transaction: tx() });
    expect(JSON.parse(t.requests[0]!.body!).payment).toEqual({ method: 'TRANSACTION_ID', transactionId: 'tr_1' });
  });
});

describe('Nuitee hotel lookup / get / cancel (pinned examples)', () => {
  it('lookup by client reference uses exact matches and refuses records from the other environment', async () => {
    const ex = first(examples(booking, '/bookings', 'get', '200')) as { data: Array<Record<string, unknown>> };
    const ref = ex.data[0]!.clientReference as string;
    const { c, t } = connector([res(200, ex), res(200, ex)]);
    const found = await c.lookupByClientReference(ref);
    expect(found).toMatchObject({ kind: 'SUCCEEDED', value: { status: 'CANCELLED', providerBookingRef: '9EjIcpy7K' } });
    expect(t.requests[0]!.url).toBe(`https://book.liteapi.travel/v3.0/bookings?clientReference=${ref}&timeout=10`);
    expect((await c.lookupByClientReference('other-ref')).kind === 'SUCCEEDED').toBe(true);
    // The example record is sandbox=1: a production connector must not accept it.
    const prod = connector([res(200, ex)], 'production');
    expect(await prod.c.lookupByClientReference(ref)).toMatchObject({ kind: 'SUCCEEDED', value: null });
  });

  it('cancel maps CANCELLED and CANCELLED_WITH_CHARGES with the penalty (our loss, not the customer)', async () => {
    const ex = examples(booking, '/bookings/{bookingId}', 'put', '200');
    const { c } = connector([res(200, ex['non-refundable']!.value), res(200, ex.refundable!.value)]);
    const a = await c.cancel(opaque('hSq2gVDrf'));
    expect(a.kind === 'SUCCEEDED' && [a.value.status, a.value.penalty, a.value.refundToUs]).toEqual(['CANCELLED', money('USD', 15000n), money('USD', 0n)]);
    const b = await c.cancel(opaque('hSq2gVDrf'));
    expect(b.kind === 'SUCCEEDED' && b.value.penalty).toEqual(money('USD', 2500n));
  });

  it('ambiguous cancel answers are UNKNOWN; not found is REJECTED', async () => {
    const put = (code: string) => first(examples(booking, '/bookings/{bookingId}', 'put', code));
    expect((await connector([res(304, put('304'))]).c.cancel(opaque('x'))).kind).toBe('UNKNOWN');
    expect((await connector([{ kind: 'RESPONSE', response: { status: 204, headers: {}, body: '' }, durationMs: 1 }]).c.cancel(opaque('x'))).kind).toBe('REJECTED');
  });
});

describe('T03/T05 multi-room offer composition', () => {
  it('sums per-room penalties over time, marks NRFN rooms non-refundable and keeps occupancy numbers', async () => {
    const rate = (n: number, tag: string, steps: Array<[string, number]>, commission: number) => ({
      rateId: `r${n}`,
      occupancyNumber: n,
      commission: [{ amount: commission, currency: 'EUR' }],
      retailRate: { total: [{ amount: 100, currency: 'EUR' }], taxesAndFees: [{ included: false, description: 'City tax', amount: 2.5, currency: 'EUR' }] },
      cancellationPolicies: { cancelPolicyInfos: steps.map(([t, a]) => ({ cancelTime: t, amount: a, currency: 'EUR', type: 'amount', timezone: 'GMT' })), refundableTag: tag },
    });
    const body = {
      data: [
        {
          hotelId: 'h1',
          roomTypes: [
            {
              offerId: 'multi',
              offerRetailRate: { amount: 200.1, currency: 'EUR' },
              rates: [rate(1, 'RFN', [['2026-11-01 00:00:00', 50], ['2026-11-05 00:00:00', 100]], 0), rate(2, 'RFN', [['2026-11-03 12:00:00', 100.1]], 0)],
            },
          ],
        },
      ],
    };
    const { c } = connector([res(200, body)]);
    const out = await c.searchRates({ ...criteria, currency: 'EUR', occupancies: [{ occupancyNumber: 1, adults: 2, childAges: [] }, { occupancyNumber: 2, adults: 1, childAges: [7] }] });
    const offer = out.kind === 'SUCCEEDED' ? out.value[0]! : null;
    expect(offer?.occupancyNumbers).toEqual([1, 2]);
    expect(offer?.payAtProperty).toEqual([money('EUR', 250n), money('EUR', 250n)]);
    expect(offer?.cancellation.steps.map((s) => [s.from, s.penalty.minor])).toEqual([
      ['2026-11-01T00:00:00.000Z', 5000n],
      ['2026-11-03T12:00:00.000Z', 15010n],
      ['2026-11-05T00:00:00.000Z', 20010n],
    ]);
    const nrfn = structuredClone(body);
    nrfn.data[0]!.roomTypes[0]!.rates[1]!.cancellationPolicies.refundableTag = 'NRFN';
    const out2 = await connector([res(200, nrfn)]).c.searchRates(criteria);
    expect(out2.kind === 'SUCCEEDED' && out2.value[0]!.cancellation.refundable).toBe(false);
  });

  it('drops an offer it cannot price exactly instead of guessing (currency mismatch inside the offer)', async () => {
    const body = { data: [{ hotelId: 'h1', roomTypes: [{ offerId: 'x', offerRetailRate: { amount: 10, currency: 'EUR' }, rates: [{ occupancyNumber: 1, commission: [{ amount: 1, currency: 'USD' }], cancellationPolicies: { cancelPolicyInfos: [], refundableTag: 'RFN' } }] }] }] };
    const out = await connector([res(200, body)]).c.searchRates(criteria);
    expect(out).toMatchObject({ kind: 'SUCCEEDED', value: [] });
  });
});
