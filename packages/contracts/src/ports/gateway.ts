import type { Money } from '@texholiday/pricing';
import type { GatewayOperation } from '../capabilities';
import type { GatewayPaymentRef, ProviderEnvironment } from '../common';
import type { ExternalOutcome } from '../outcome';

/**
 * What a gateway adapter can technically do. Whether the merchant account may use it is a separate
 * question answered by the capability matrix; both must be true to open a route.
 */
export interface GatewayAdapterCapabilities {
  gatewayId: string;
  environment: ProviderEnvironment;
  /** True only for labelled mock adapters; refused by the registry in production. */
  isMock: boolean;
  operations: ReadonlySet<GatewayOperation>;
  /** Currencies the adapter can technically send. Merchant settlement currencies are verified separately. */
  currencies: readonly string[];
  /**
   * Upstream idempotency per mutating operation. 'NONE' means a lost response can only be resolved by
   * retrieve(); the caller must never blindly repeat the call.
   */
  idempotency: Readonly<Record<'createSession' | 'capture' | 'void' | 'refund', 'NONE' | 'DOCUMENTED_KEY'>>;
  /** Fields of buyer identity the adapter requires; used to block checkout before payment starts. */
  requiredBuyerFields: readonly (keyof BuyerIdentity)[];
}

export interface BuyerIdentity {
  customerId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  /** Turkish national id only when the customer actually provided one. Never fabricated. */
  nationalId: string | null;
  /** Passport/foreign id policy is a merchant-contract question (R0); stored only if provided. */
  foreignIdentityNumber: string | null;
  countryCode: string;
  city: string;
  address: string;
  ip: string;
}

export interface GatewayBasketItem {
  /** Our order item id; becomes the gateway basket item id so item transactions map back. */
  itemId: string;
  name: string;
  category: string;
  amount: Money;
}

export interface CreateSessionInput {
  /** Our PaymentAttempt id. Used as the gateway conversation/correlation id. */
  paymentAttemptId: string;
  orderId: string;
  intent: 'AUTHORIZE_ONLY' | 'SALE';
  amount: Money;
  items: readonly GatewayBasketItem[];
  buyer: BuyerIdentity;
  callbackUrl: string;
  locale: 'tr' | 'en';
}

export interface GatewaySession {
  /** Hosted form token / session id; the browser never receives card data handling from us. */
  sessionRef: string;
  /** Hosted page URL or embed script content provided by the gateway. */
  redirectUrl: string | null;
  embedContent: string | null;
  expiresAt: string | null;
}

export type GatewayPaymentStatus = 'PENDING' | 'REQUIRES_ACTION' | 'AUTHORIZED' | 'CAPTURED' | 'DECLINED' | 'VOIDED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type FraudVerdict = 'APPROVED' | 'REVIEW' | 'REJECTED' | 'NOT_PROVIDED';

/** Server-side, signature-verified snapshot of a gateway payment. */
export interface GatewayPaymentSnapshot {
  ref: GatewayPaymentRef;
  status: GatewayPaymentStatus;
  fraud: FraudVerdict;
  /** What the gateway says was authorized/charged. Compared with our attempt before use (T14). */
  amount: Money;
  /** Correlation ids echoed by the gateway; must match our attempt/order (T14). */
  paymentAttemptId: string | null;
  orderId: string | null;
  sessionRef: string | null;
  itemTransactions: ReadonlyArray<{ itemId: string; gatewayItemTransactionId: string; amount: Money }>;
  signatureVerified: boolean;
}

export interface CaptureInput {
  ref: GatewayPaymentRef;
  amount: Money;
  paymentAttemptId: string;
  ip: string;
}

export interface VoidInput {
  ref: GatewayPaymentRef;
  paymentAttemptId: string;
  ip: string;
  reason: 'BUYER_REQUEST' | 'FRAUD' | 'OTHER';
}

export interface RefundInput {
  ref: GatewayPaymentRef;
  /** Our refund transaction id; stored before the call. */
  refundId: string;
  /** Per-item refunds based on the original allocation. */
  lines: ReadonlyArray<{ gatewayItemTransactionId: string; amount: Money }>;
  ip: string;
}

export type NotificationVerification =
  | { verified: true; hint: { sessionRef: string | null; gatewayPaymentId: string | null; eventType: string; dedupeKey: string } }
  | { verified: false; reason: string };

/** Customer payment collected by TexHoliday. First adapter: iyzico. Business code never names a brand. */
export interface OwnedPaymentGateway {
  capabilities(): GatewayAdapterCapabilities;
  createSession(input: CreateSessionInput): Promise<ExternalOutcome<GatewaySession>>;
  /** Server-side query by hosted-form session token or by gateway payment id. */
  retrieve(query: { sessionRef?: string; ref?: GatewayPaymentRef; paymentAttemptId: string }): Promise<ExternalOutcome<GatewayPaymentSnapshot>>;
  capture(input: CaptureInput): Promise<ExternalOutcome<{ capturedAmount: Money }>>;
  void(input: VoidInput): Promise<ExternalOutcome<{ voided: true }>>;
  refund(input: RefundInput): Promise<ExternalOutcome<{ refunded: ReadonlyArray<{ gatewayItemTransactionId: string; amount: Money; gatewayRefundId: string | null }> }>>;
  /** Verifies a webhook. A verified notification is only a hint to call retrieve(); it never sets state. */
  verifyNotification(headers: Readonly<Record<string, string | undefined>>, rawBody: string): NotificationVerification;
}
