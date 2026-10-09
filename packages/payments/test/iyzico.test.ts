import { describe, expect, it } from 'vitest';
import { parseSourceLock, type CreateSessionInput, type HttpRequest, type HttpResult, type HttpTransport } from '@texholiday/contracts';
import { money } from '@texholiday/pricing';
import { GatewayRegistry, IYZICO_REQUIRED_SOURCES, IyzicoGateway, authorizationHeader, formatPrice, responseSignature } from '../src/index';

const SECRET = 'sandbox-secret-key-for-tests';

/** TEST DOUBLE: scripted HTTP transport; records requests. */
class ScriptedTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly responses: Array<HttpResult | ((req: HttpRequest) => HttpResult)>) {}
  async send(req: HttpRequest): Promise<HttpResult> {
    this.requests.push(req);
    const next = this.responses.shift();
    if (!next) throw new Error('no scripted response');
    return typeof next === 'function' ? next(req) : next;
  }
}

const json = (body: unknown, status = 200): HttpResult => ({ kind: 'RESPONSE', response: { status, headers: {}, body: typeof body === 'string' ? body : JSON.stringify(body) }, durationMs: 5 });
const signed = (body: Record<string, unknown>, fields: string[]) => ({ ...body, signature: responseSignature(fields.map((f) => body[f]), SECRET) });

function gateway(responses: ConstructorParameters<typeof ScriptedTransport>[0], policy: 'REFUSE' | 'SEND_FOREIGN_ID' = 'REFUSE') {
  const transport = new ScriptedTransport(responses);
  const gw = new IyzicoGateway(
    { apiKey: 'sandbox-api-key-for-tests', secretKey: SECRET, baseUrl: 'https://sandbox-api.iyzipay.com', environment: 'sandbox', timeoutMs: 30_000, foreignIdentityPolicy: policy, enabledInstallments: [1] },
    transport,
    () => new Date('2026-10-09T10:00:00Z'),
  );
  return { gw, transport };
}

const session = (over: Partial<CreateSessionInput> = {}): CreateSessionInput => ({
  paymentAttemptId: 'pa-1',
  orderId: 'ord-1',
  intent: 'AUTHORIZE_ONLY',
  amount: money('TRY', 120n),
  items: [
    { itemId: 'item-a', name: 'Otel', category: 'HOTEL', amount: money('TRY', 100n) },
    { itemId: 'item-b', name: 'Transfer', category: 'TRANSFER', amount: money('TRY', 20n) },
  ],
  buyer: {
    customerId: 'cus-1',
    firstName: 'Ada',
    lastName: 'Yilmaz',
    email: 'ada@example.test',
    phone: null,
    nationalId: '74300864791',
    foreignIdentityNumber: null,
    countryCode: 'TR',
    city: 'Antalya',
    address: 'Lara',
    ip: '85.34.78.112',
  },
  callbackUrl: 'https://texholiday.example/odeme/donus',
  locale: 'tr',
  ...over,
});

describe('iyzico signing (provenance: official client 2.0.70)', () => {
  it('response signature matches an independent HMAC (openssl) vector', () => {
    expect(responseSignature(['SUCCESS', '12345', 'TRY', 'ord-1', 'pa-1', 1.2, 1.2, 'tok-1'], SECRET)).toBe('9feeaf77f6e7cb134f59d29b51ab2434a232c62bdbfacc9ca53ad9e954e0417b');
  });

  it('IYZWSv2 header signs randomKey + path + body', () => {
    const header = authorizationHeader('key', 'secret', '/payment/postauth', '{"locale":"tr"}', '1700000000abcdef');
    const decoded = Buffer.from(header.replace('IYZWSv2 ', ''), 'base64').toString();
    expect(decoded).toBe('apiKey:key&randomKey:1700000000abcdef&signature:2c6d2081c2307535bb3c4ca2dc41b1ecf3825e17e81abc3c1f467e32348a1c51');
  });

  it('formats prices exactly like the client, without floats', () => {
    expect(formatPrice(money('TRY', 10000n))).toBe('100.0');
    expect(formatPrice(money('TRY', 120n))).toBe('1.2');
    expect(formatPrice(money('EUR', 123456789012345n))).toBe('1234567890123.45');
  });
});

describe('createSession (hosted CheckoutForm pre-authorization)', () => {
  it('sends a pre-auth request with basket items summing to the amount and verifies the response signature', async () => {
    const { gw, transport } = gateway([json(signed({ status: 'success', conversationId: 'pa-1', token: 'tok-1', paymentPageUrl: 'https://sandbox-cpp.iyzipay.com?token=tok-1', tokenExpireTime: 1800 }, ['conversationId', 'token']))]);
    const out = await gw.createSession(session());
    expect(out.kind).toBe('SUCCEEDED');
    const req = transport.requests[0]!;
    expect(req.url).toBe('https://sandbox-api.iyzipay.com/payment/iyzipos/checkoutform/initialize/preauth/ecom');
    const body = JSON.parse(req.body!);
    expect(body).toMatchObject({ conversationId: 'pa-1', basketId: 'ord-1', price: '1.2', paidPrice: '1.2', currency: 'TRY', enabledInstallments: [1] });
    expect(body.basketItems.map((b: { price: string }) => b.price)).toEqual(['1.0', '0.2']);
    expect(req.headers.authorization).toMatch(/^IYZWSv2 /);
    // PAN/CVV never appear in our request.
    expect(req.body).not.toMatch(/cardNumber|cvc/i);
  });

  it('a forged/mismatched signature makes the result UNKNOWN', async () => {
    const { gw } = gateway([json({ status: 'success', conversationId: 'pa-1', token: 'tok-1', signature: 'a'.repeat(64) })]);
    expect((await gw.createSession(session())).kind).toBe('UNKNOWN');
  });

  it('never fabricates a Turkish id for foreign customers (no call is made)', async () => {
    const { gw, transport } = gateway([]);
    const out = await gw.createSession(session({ buyer: { ...session().buyer, nationalId: null, foreignIdentityNumber: 'U1234567', countryCode: 'DE' } }));
    expect(out.kind).toBe('CAPABILITY_NOT_AVAILABLE');
    expect(transport.requests).toHaveLength(0);
  });

  it('sends a foreign id only when the verified merchant policy allows it', async () => {
    const { gw, transport } = gateway([json(signed({ status: 'success', conversationId: 'pa-1', token: 'tok-2' }, ['conversationId', 'token']))], 'SEND_FOREIGN_ID');
    await gw.createSession(session({ buyer: { ...session().buyer, nationalId: null, foreignIdentityNumber: 'U1234567', countryCode: 'DE' } }));
    expect(JSON.parse(transport.requests[0]!.body!).buyer.identityNumber).toBe('U1234567');
  });

  it('refuses currencies the adapter does not support before any call', async () => {
    const { gw, transport } = gateway([]);
    const out = await gw.createSession(session({ amount: money('JPY', 120n), items: [{ itemId: 'i', name: 'x', category: 'HOTEL', amount: money('JPY', 120n) }] }));
    expect(out.kind).toBe('CAPABILITY_NOT_AVAILABLE');
    expect(transport.requests).toHaveLength(0);
  });
});

const retrieveBody = (over: Record<string, unknown> = {}) =>
  signed(
    {
      status: 'success',
      paymentStatus: 'SUCCESS',
      phase: 'PRE_AUTH',
      paymentId: '12345',
      currency: 'TRY',
      basketId: 'ord-1',
      conversationId: 'pa-1',
      paidPrice: 1.2,
      price: 1.2,
      token: 'tok-1',
      fraudStatus: 1,
      itemTransactions: [
        { itemId: 'item-a', paymentTransactionId: '900', paidPrice: 1.0, price: 1.0 },
        { itemId: 'item-b', paymentTransactionId: '901', paidPrice: 0.2, price: 0.2 },
      ],
      ...over,
    },
    ['paymentStatus', 'paymentId', 'currency', 'basketId', 'conversationId', 'paidPrice', 'price', 'token'],
  );

describe('retrieve (T13/T14/T16: server-side proof only)', () => {
  it('maps a verified pre-authorization with exact amounts and item transactions', async () => {
    const { gw } = gateway([json(retrieveBody())]);
    const out = await gw.retrieve({ sessionRef: 'tok-1', paymentAttemptId: 'pa-1' });
    expect(out.kind).toBe('SUCCEEDED');
    if (out.kind !== 'SUCCEEDED') return;
    expect(out.value.status).toBe('AUTHORIZED');
    expect(out.value.amount).toEqual(money('TRY', 120n));
    expect(out.value.itemTransactions.map((t) => [t.itemId, t.gatewayItemTransactionId, t.amount.minor])).toEqual([
      ['item-a', '900', 100n],
      ['item-b', '901', 20n],
    ]);
    expect(out.value.orderId).toBe('ord-1');
    expect(out.value.paymentAttemptId).toBe('pa-1');
  });

  it('reads money from the raw JSON text (no float rounding) and refuses excess precision', async () => {
    // Correctly signed, but 1.234 TRY cannot be represented in kuruş: refuse instead of rounding.
    const { gw } = gateway([json(retrieveBody({ paidPrice: 1.234 }))]);
    const out = await gw.retrieve({ sessionRef: 'tok-1', paymentAttemptId: 'pa-1' });
    expect(out).toMatchObject({ kind: 'UNKNOWN', reason: 'MALFORMED_RESPONSE' });
    // Amounts beyond float precision in minor units survive exactly (read from the JSON source text).
    const { gw: gw2 } = gateway([json(retrieveBody({ paidPrice: 123456789012345.67, price: 123456789012345.67, itemTransactions: [] }))]);
    const big = await gw2.retrieve({ sessionRef: 'tok-1', paymentAttemptId: 'pa-1' });
    expect(big.kind === 'SUCCEEDED' && big.value.amount.minor).toBe(12345678901234567n);
    expect(String(Math.round(123456789012345.67 * 100))).not.toBe('12345678901234567'); // what a float path would produce
  });

  it('fraud review / unknown fraud codes are not APPROVED', async () => {
    const { gw } = gateway([json(retrieveBody({ fraudStatus: 0 })), json(retrieveBody({ fraudStatus: 7 }))]);
    const a = await gw.retrieve({ sessionRef: 'tok-1', paymentAttemptId: 'pa-1' });
    const b = await gw.retrieve({ sessionRef: 'tok-1', paymentAttemptId: 'pa-1' });
    expect(a.kind === 'SUCCEEDED' && a.value.fraud).toBe('REVIEW');
    expect(b.kind === 'SUCCEEDED' && b.value.fraud).toBe('REVIEW');
  });

  it('a missing phase is ambiguous, not a guessed status', async () => {
    const body = retrieveBody();
    delete (body as Record<string, unknown>).phase;
    const { gw } = gateway([json(body)]);
    expect((await gw.retrieve({ sessionRef: 'tok-1', paymentAttemptId: 'pa-1' })).kind).toBe('UNKNOWN');
  });

  it('failure body is a definitive decline; 5xx/timeout are UNKNOWN', async () => {
    const { gw } = gateway([
      json({ status: 'failure', errorCode: '10051', errorMessage: 'insufficient funds' }),
      json('upstream down', 503),
      { kind: 'NO_RESPONSE', reason: 'TIMEOUT', detail: 'timeout', durationMs: 30_000 },
      json('<html>not json</html>'),
    ]);
    expect((await gw.retrieve({ sessionRef: 'tok-1', paymentAttemptId: 'pa-1' })).kind).toBe('REJECTED');
    expect((await gw.retrieve({ sessionRef: 'tok-1', paymentAttemptId: 'pa-1' })).kind).toBe('UNKNOWN');
    expect((await gw.retrieve({ sessionRef: 'tok-1', paymentAttemptId: 'pa-1' })).kind).toBe('UNKNOWN');
    expect((await gw.retrieve({ sessionRef: 'tok-1', paymentAttemptId: 'pa-1' })).kind).toBe('UNKNOWN');
  });
});

describe('capture / void / refund', () => {
  const ref = { __brand: 'GatewayPaymentRef' as const, gatewayId: 'iyzico', gatewayPaymentId: '12345', environment: 'sandbox' as const };

  it('captures via post-auth with a verified response', async () => {
    const body = signed({ status: 'success', paymentId: '12345', currency: 'TRY', basketId: 'ord-1', conversationId: 'pa-1', paidPrice: 1.2, price: 1.2 }, [
      'paymentId',
      'currency',
      'basketId',
      'conversationId',
      'paidPrice',
      'price',
    ]);
    const { gw, transport } = gateway([json(body)]);
    const out = await gw.capture({ ref, amount: money('TRY', 120n), paymentAttemptId: 'pa-1', ip: '10.0.0.1' });
    expect(out.kind === 'SUCCEEDED' && out.value.capturedAmount).toEqual(money('TRY', 120n));
    expect(transport.requests[0]!.url).toMatch(/\/payment\/postauth$/);
  });

  it('T20: a lost capture response is UNKNOWN (caller must retrieve, never repeat)', async () => {
    const { gw } = gateway([{ kind: 'NO_RESPONSE', reason: 'NETWORK', detail: 'reset', durationMs: 10 }]);
    expect((await gw.capture({ ref, amount: money('TRY', 120n), paymentAttemptId: 'pa-1', ip: '10.0.0.1' })).kind).toBe('UNKNOWN');
  });

  it('void uses cancel; refund goes per item transaction (one line per call)', async () => {
    const { gw, transport } = gateway([json({ status: 'success', paymentId: '12345' }), json({ status: 'success', paymentTransactionId: '900', price: 0.5, currency: 'TRY' })]);
    expect((await gw.void({ ref, paymentAttemptId: 'pa-1', ip: '10.0.0.1', reason: 'OTHER' })).kind).toBe('SUCCEEDED');
    const refund = await gw.refund({ ref, refundId: 'rf-1', lines: [{ gatewayItemTransactionId: '900', amount: money('TRY', 50n) }], ip: '10.0.0.1' });
    expect(refund.kind).toBe('SUCCEEDED');
    expect(transport.requests.map((r) => new URL(r.url).pathname)).toEqual(['/payment/cancel', '/payment/refund']);
    expect(JSON.parse(transport.requests[1]!.body!)).toMatchObject({ paymentTransactionId: '900', price: '0.5', conversationId: 'rf-1' });
    const multi = await gw.refund({ ref, refundId: 'rf-2', lines: [{ gatewayItemTransactionId: '900', amount: money('TRY', 1n) }, { gatewayItemTransactionId: '901', amount: money('TRY', 1n) }], ip: '10.0.0.1' });
    expect(multi.kind).toBe('CAPABILITY_NOT_AVAILABLE');
  });

  it('webhooks are not trusted until the V3 contract is pinned (T15 fail-closed)', () => {
    const { gw } = gateway([]);
    expect(gw.verifyNotification().verified).toBe(false);
    expect(gw.capabilities().operations.has('VERIFIED_NOTIFICATION')).toBe(false);
  });
});

describe('GatewayRegistry', () => {
  const lock = parseSourceLock({ schemaVersion: 1, updatedAt: 'x', sources: IYZICO_REQUIRED_SOURCES.map((id) => ({ id, provider: 'iyzico', kind: 'guide', url: 'u', requiredFor: [], status: 'UNREACHABLE' })) });

  it('refuses iyzico in production while its documentation sources are not pinned', () => {
    const gw = new IyzicoGateway({ apiKey: 'k'.repeat(20), secretKey: 's'.repeat(20), baseUrl: 'https://api.iyzipay.com', environment: 'production', timeoutMs: 1000, foreignIdentityPolicy: 'REFUSE', enabledInstallments: [1] });
    expect(() => new GatewayRegistry('production', lock).register(gw, IYZICO_REQUIRED_SOURCES)).toThrow(/not pinned/);
  });

  it('refuses environment mismatches and unknown gateway ids', () => {
    const { gw } = gateway([]);
    expect(() => new GatewayRegistry('production', lock).register(gw, [])).toThrow(/sandbox adapter/);
    const reg = new GatewayRegistry('sandbox', lock).register(gw, IYZICO_REQUIRED_SOURCES);
    expect(reg.get('iyzico')).toBe(gw);
    expect(() => reg.get('client-supplied-gateway')).toThrow(/Unknown or unapproved/);
  });
});
