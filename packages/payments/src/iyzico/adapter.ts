import {
  exactDecimal,
  fetchTransport,
  notAvailable,
  parseJsonPreservingNumbers,
  type BuyerIdentity,
  type CallEvidence,
  type CaptureInput,
  type CreateSessionInput,
  type ExternalOutcome,
  type FraudVerdict,
  type GatewayAdapterCapabilities,
  type GatewayPaymentRef,
  type GatewayPaymentSnapshot,
  type GatewayPaymentStatus,
  type GatewaySession,
  type HttpTransport,
  type NotificationVerification,
  type OwnedPaymentGateway,
  type RefundInput,
  type VoidInput,
} from '@texholiday/contracts';
import { fromMajor, sum, type Money } from '@texholiday/pricing';
import { ADAPTER_CURRENCIES, FRAUD_STATUS, IYZICO_GATEWAY_ID, PATHS, PHASE, REFUND_REASON, RESPONSE_SIGNATURE_FIELDS, WEBHOOK_V3 } from './contract';
import { authorizationHeader, formatPrice, randomKey, verifyResponseSignature } from './signing';

export interface IyzicoAdapterConfig {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
  environment: 'sandbox' | 'production';
  timeoutMs: number;
  /**
   * Whether the merchant contract allows sending a foreign identity/passport number in place of the
   * Turkish national id. Unverified -> 'REFUSE' (checkout blocked before payment, never a fake TC no).
   */
  foreignIdentityPolicy: 'REFUSE' | 'SEND_FOREIGN_ID';
  /** Installment options offered in the hosted form. Business input; [1] keeps paidPrice == price. */
  enabledInstallments: readonly number[];
  clientVersion?: string;
}

type Parsed = NonNullable<ReturnType<typeof parseJsonPreservingNumbers>>;
type CallResult = { ok: true; body: Record<string, unknown>; parsed: Parsed; evidence: CallEvidence } | { ok: false; outcome: ExternalOutcome<never> };

const FRAUD: Record<number, FraudVerdict> = {
  [FRAUD_STATUS.APPROVED]: 'APPROVED',
  [FRAUD_STATUS.REVIEW]: 'REVIEW',
  [FRAUD_STATUS.REJECTED]: 'REJECTED',
};

/**
 * iyzico hosted CheckoutForm adapter (first OwnedPaymentGateway). Card data never touches our servers.
 * - Pre-authorization via CheckoutForm, capture via post-auth, void via cancel, refunds per item transaction.
 * - Every success body that has a documented response signature is verified; a mismatch is UNKNOWN.
 * - Webhooks are not verified until the V3 signature contract is pinned (fail-closed).
 */
export class IyzicoGateway implements OwnedPaymentGateway {
  constructor(
    private readonly cfg: IyzicoAdapterConfig,
    private readonly transport: HttpTransport = fetchTransport,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  capabilities(): GatewayAdapterCapabilities {
    return {
      gatewayId: IYZICO_GATEWAY_ID,
      environment: this.cfg.environment,
      isMock: false,
      operations: new Set(['AUTHORIZE', 'CAPTURE', 'RETRIEVE', 'VOID', 'REFUND_FULL', 'REFUND_PARTIAL', ...(WEBHOOK_V3.fieldOrder ? (['VERIFIED_NOTIFICATION'] as const) : [])]),
      currencies: ADAPTER_CURRENCIES,
      // conversationId is a correlation id, not a documented idempotency guarantee (§12).
      idempotency: { createSession: 'NONE', capture: 'NONE', void: 'NONE', refund: 'NONE' },
      requiredBuyerFields: ['firstName', 'lastName', 'email', 'city', 'countryCode', 'address', 'ip'],
    };
  }

  // ------------------------------------------------------------------ HTTP

  private async call(operation: keyof typeof PATHS, request: Record<string, unknown>): Promise<CallResult> {
    const path = PATHS[operation];
    const bodyJson = JSON.stringify(request);
    const rnd = randomKey();
    const at = this.clock().toISOString();
    const result = await this.transport.send({
      method: 'POST',
      url: `${this.cfg.baseUrl}${path}`,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: authorizationHeader(this.cfg.apiKey, this.cfg.secretKey, path, bodyJson, rnd),
        'x-iyzi-rnd': rnd,
        'x-iyzi-client-version': this.cfg.clientVersion ?? 'texholiday-iyzico-adapter-1',
      },
      body: bodyJson,
      timeoutMs: this.cfg.timeoutMs,
    });
    const evidence = (httpStatus: number | null, durationMs: number): CallEvidence => ({
      operation: `iyzico.${operation}`,
      environment: this.cfg.environment,
      at,
      httpStatus,
      upstreamRequestId: null,
      durationMs,
    });
    if (result.kind === 'NO_RESPONSE') {
      return { ok: false, outcome: { kind: 'UNKNOWN', reason: result.reason, evidence: evidence(null, result.durationMs) } };
    }
    const { status, body } = result.response;
    const ev = evidence(status, result.durationMs);
    if (status >= 500) return { ok: false, outcome: { kind: 'UNKNOWN', reason: 'UPSTREAM_5XX', evidence: ev } };
    const parsed = parseJsonPreservingNumbers(body);
    const json = parsed?.value as Record<string, unknown> | undefined;
    if (!parsed || !json || typeof json !== 'object') return { ok: false, outcome: { kind: 'UNKNOWN', reason: 'MALFORMED_RESPONSE', evidence: ev } };
    if (json.status === 'failure' || (status >= 400 && json.status !== 'success')) {
      return {
        ok: false,
        outcome: { kind: 'REJECTED', code: `IYZICO_${String(json.errorCode ?? status)}`, message: 'Payment provider refused the request', evidence: { ...ev, upstreamRequestId: null } },
      };
    }
    if (json.status !== 'success') return { ok: false, outcome: { kind: 'UNKNOWN', reason: 'MALFORMED_RESPONSE', evidence: ev } };
    const fields = RESPONSE_SIGNATURE_FIELDS[operation];
    if (fields && !verifyResponseSignature(json, fields, this.cfg.secretKey)) {
      return { ok: false, outcome: { kind: 'UNKNOWN', reason: 'SIGNATURE_MISMATCH', evidence: ev } };
    }
    return { ok: true, body: json, parsed, evidence: ev };
  }

  private money(parsed: Parsed, obj: object, key: string, currency: string): Money | null {
    const exact = exactDecimal(parsed, obj, key);
    if (exact === null) return null;
    try {
      return fromMajor(exact, currency);
    } catch {
      return null;
    }
  }

  private buyer(b: BuyerIdentity): Record<string, unknown> | null {
    const identityNumber = b.nationalId ?? (this.cfg.foreignIdentityPolicy === 'SEND_FOREIGN_ID' ? b.foreignIdentityNumber : null);
    if (!identityNumber) return null;
    return {
      id: b.customerId,
      name: b.firstName,
      surname: b.lastName,
      identityNumber,
      email: b.email,
      ...(b.phone ? { gsmNumber: b.phone } : {}),
      registrationAddress: b.address,
      city: b.city,
      country: b.countryCode,
      ip: b.ip,
    };
  }

  // ------------------------------------------------------------------ operations

  async createSession(input: CreateSessionInput): Promise<ExternalOutcome<GatewaySession>> {
    const cur = input.amount.currency;
    if (!(ADAPTER_CURRENCIES as readonly string[]).includes(cur)) return notAvailable('CURRENCY', `iyzico adapter cannot charge ${cur}`);
    if (input.items.length === 0) throw new Error('createSession requires basket items');
    const itemsTotal = sum(
      input.items.map((i) => i.amount),
      cur,
    );
    if (itemsTotal.minor !== input.amount.minor) throw new Error('Basket items must sum exactly to the payment amount');
    if (input.items.some((i) => i.amount.minor <= 0n)) return notAvailable('ZERO_PRICE_ITEM', 'iyzico basket items must have a positive price');
    const buyer = this.buyer(input.buyer);
    if (!buyer) return notAvailable('BUYER_IDENTITY', 'No national id and the foreign-identity policy is not verified for this merchant');

    const address = { contactName: `${input.buyer.firstName} ${input.buyer.lastName}`, city: input.buyer.city, country: input.buyer.countryCode, address: input.buyer.address };
    const op = input.intent === 'AUTHORIZE_ONLY' ? 'checkoutFormInitializePreAuth' : 'checkoutFormInitializeAuth';
    const r = await this.call(op, {
      locale: input.locale,
      conversationId: input.paymentAttemptId,
      price: formatPrice(input.amount),
      paidPrice: formatPrice(input.amount),
      currency: cur,
      basketId: input.orderId,
      paymentGroup: 'PRODUCT',
      callbackUrl: input.callbackUrl,
      enabledInstallments: [...this.cfg.enabledInstallments],
      buyer,
      billingAddress: address,
      basketItems: input.items.map((i) => ({ id: i.itemId, name: i.name, category1: i.category, itemType: 'VIRTUAL', price: formatPrice(i.amount) })),
    });
    if (!r.ok) return r.outcome;
    const token = r.body.token;
    if (typeof token !== 'string' || r.body.conversationId !== input.paymentAttemptId) {
      return { kind: 'UNKNOWN', reason: 'AMBIGUOUS', evidence: r.evidence };
    }
    const expireSeconds = typeof r.body.tokenExpireTime === 'number' ? r.body.tokenExpireTime : null;
    return {
      kind: 'SUCCEEDED',
      value: {
        sessionRef: token,
        redirectUrl: typeof r.body.paymentPageUrl === 'string' ? r.body.paymentPageUrl : null,
        embedContent: typeof r.body.checkoutFormContent === 'string' ? r.body.checkoutFormContent : null,
        expiresAt: expireSeconds !== null ? new Date(this.clock().getTime() + expireSeconds * 1000).toISOString() : null,
      },
      evidence: r.evidence,
    };
  }

  async retrieve(query: { sessionRef?: string; ref?: GatewayPaymentRef; paymentAttemptId: string }): Promise<ExternalOutcome<GatewayPaymentSnapshot>> {
    const r = query.sessionRef
      ? await this.call('checkoutFormRetrieve', { locale: 'tr', conversationId: query.paymentAttemptId, token: query.sessionRef })
      : query.ref
        ? await this.call('paymentDetail', { locale: 'tr', conversationId: query.paymentAttemptId, paymentId: query.ref.gatewayPaymentId })
        : null;
    if (!r) throw new Error('retrieve needs a session token or a gateway payment id');
    if (!r.ok) return r.outcome;
    const b = r.body;
    const currency = typeof b.currency === 'string' ? b.currency : null;
    const paymentId = typeof b.paymentId === 'string' ? b.paymentId : b.paymentId !== undefined ? String(b.paymentId) : null;
    if (!currency) return { kind: 'UNKNOWN', reason: 'MALFORMED_RESPONSE', evidence: r.evidence };

    const status = this.mapStatus(b);
    if (status === null) return { kind: 'UNKNOWN', reason: 'AMBIGUOUS', evidence: r.evidence };
    const amount = this.money(r.parsed, b, 'paidPrice', currency);
    if (status !== 'PENDING' && status !== 'REQUIRES_ACTION' && status !== 'DECLINED' && (!amount || !paymentId)) {
      return { kind: 'UNKNOWN', reason: 'MALFORMED_RESPONSE', evidence: r.evidence };
    }
    const items = Array.isArray(b.itemTransactions) ? (b.itemTransactions as Record<string, unknown>[]) : [];
    const itemTransactions: GatewayPaymentSnapshot['itemTransactions'][number][] = [];
    for (const it of items) {
      const itemAmount = this.money(r.parsed, it, 'paidPrice', currency);
      if (!itemAmount || typeof it.itemId !== 'string' || it.paymentTransactionId === undefined) {
        return { kind: 'UNKNOWN', reason: 'MALFORMED_RESPONSE', evidence: r.evidence };
      }
      itemTransactions.push({ itemId: it.itemId, gatewayItemTransactionId: String(it.paymentTransactionId), amount: itemAmount });
    }
    const fraud: FraudVerdict = typeof b.fraudStatus === 'number' ? (FRAUD[b.fraudStatus] ?? 'REVIEW') : 'NOT_PROVIDED';
    return {
      kind: 'SUCCEEDED',
      value: {
        ref: { __brand: 'GatewayPaymentRef', gatewayId: IYZICO_GATEWAY_ID, gatewayPaymentId: paymentId ?? '', environment: this.cfg.environment },
        status,
        fraud,
        amount: amount ?? fromMajor('0', currency),
        paymentAttemptId: typeof b.conversationId === 'string' ? b.conversationId : null,
        orderId: typeof b.basketId === 'string' ? b.basketId : null,
        sessionRef: typeof b.token === 'string' ? b.token : (query.sessionRef ?? null),
        itemTransactions,
        signatureVerified: true,
      },
      evidence: r.evidence,
    };
  }

  /** null = cannot be mapped without guessing (missing/unknown phase or status). */
  private mapStatus(b: Record<string, unknown>): GatewayPaymentStatus | null {
    const paymentStatus = b.paymentStatus;
    if (paymentStatus === 'FAILURE') return 'DECLINED';
    if (paymentStatus === 'INIT_THREEDS' || paymentStatus === 'CALLBACK_THREEDS') return 'REQUIRES_ACTION';
    if (paymentStatus !== undefined && paymentStatus !== 'SUCCESS') return null;
    switch (b.phase) {
      case PHASE.PRE_AUTH:
        return 'AUTHORIZED';
      case PHASE.AUTH:
      case PHASE.POST_AUTH:
        return 'CAPTURED';
      default:
        return null;
    }
  }

  async capture(input: CaptureInput): Promise<ExternalOutcome<{ capturedAmount: Money }>> {
    const r = await this.call('postAuth', {
      locale: 'tr',
      conversationId: input.paymentAttemptId,
      paymentId: input.ref.gatewayPaymentId,
      ip: input.ip,
      paidPrice: formatPrice(input.amount),
      currency: input.amount.currency,
    });
    if (!r.ok) return r.outcome;
    const captured = this.money(r.parsed, r.body, 'paidPrice', input.amount.currency);
    if (!captured || r.body.conversationId !== input.paymentAttemptId || String(r.body.paymentId) !== input.ref.gatewayPaymentId) {
      return { kind: 'UNKNOWN', reason: 'AMBIGUOUS', evidence: r.evidence };
    }
    return { kind: 'SUCCEEDED', value: { capturedAmount: captured }, evidence: r.evidence };
  }

  async void(input: VoidInput): Promise<ExternalOutcome<{ voided: true }>> {
    const reason = input.reason === 'BUYER_REQUEST' ? REFUND_REASON.BUYER_REQUEST : input.reason === 'FRAUD' ? REFUND_REASON.FRAUD : REFUND_REASON.OTHER;
    const r = await this.call('cancel', { locale: 'tr', conversationId: input.paymentAttemptId, paymentId: input.ref.gatewayPaymentId, ip: input.ip, reason });
    if (!r.ok) return r.outcome;
    if (String(r.body.paymentId) !== input.ref.gatewayPaymentId) return { kind: 'UNKNOWN', reason: 'AMBIGUOUS', evidence: r.evidence };
    return { kind: 'SUCCEEDED', value: { voided: true }, evidence: r.evidence };
  }

  /** One item transaction per call: each refund line is its own CustomerTransaction (no partial ambiguity). */
  async refund(input: RefundInput): Promise<ExternalOutcome<{ refunded: ReadonlyArray<{ gatewayItemTransactionId: string; amount: Money; gatewayRefundId: string | null }> }>> {
    if (input.lines.length !== 1) return notAvailable('MULTI_LINE_REFUND', 'iyzico refunds are issued per item transaction; send one line per call');
    const line = input.lines[0]!;
    const r = await this.call('refund', {
      locale: 'tr',
      conversationId: input.refundId,
      paymentTransactionId: line.gatewayItemTransactionId,
      price: formatPrice(line.amount),
      currency: line.amount.currency,
      ip: input.ip,
      reason: REFUND_REASON.BUYER_REQUEST,
    });
    if (!r.ok) return r.outcome;
    const refunded = this.money(r.parsed, r.body, 'price', line.amount.currency);
    if (!refunded || String(r.body.paymentTransactionId) !== line.gatewayItemTransactionId) return { kind: 'UNKNOWN', reason: 'AMBIGUOUS', evidence: r.evidence };
    return {
      kind: 'SUCCEEDED',
      value: { refunded: [{ gatewayItemTransactionId: line.gatewayItemTransactionId, amount: refunded, gatewayRefundId: typeof r.body.hostReference === 'string' ? r.body.hostReference : null }] },
      evidence: r.evidence,
    };
  }

  verifyNotification(): NotificationVerification {
    // Fail-closed until the V3 field order is pinned from the official documentation (G05).
    return { verified: false, reason: 'IYZICO_WEBHOOK_V3_CONTRACT_NOT_PINNED' };
  }
}
