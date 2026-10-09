/**
 * iyzico contract facts used by the adapter, each with its provenance.
 *
 * SDK  = official client iyzipay@2.0.70 (sources.lock.json: ref-npm-iyzipay, sha512 integrity pinned).
 * DOCS = docs.iyzico.com pages pinned by SHA-256 in sources.lock.json (iyzico-*). Facts marked
 *        NOT_IN_DOCS are absent from the pinned pages and must be confirmed in sandbox (G05).
 * The registry refuses this adapter in production until every source in REQUIRED_SOURCES is PINNED.
 */

export const IYZICO_GATEWAY_ID = 'iyzico';

export const REQUIRED_SOURCES = [
  'iyzico-cf-preauth',
  'iyzico-capture',
  'iyzico-cf-retrieve',
  'iyzico-response-signature',
  'iyzico-cancel-refund',
  'iyzico-webhook',
] as const;

/** Endpoint paths (provenance: SDK resources/*.js). */
export const PATHS = {
  checkoutFormInitializePreAuth: '/payment/iyzipos/checkoutform/initialize/preauth/ecom',
  checkoutFormInitializeAuth: '/payment/iyzipos/checkoutform/initialize/auth/ecom',
  checkoutFormRetrieve: '/payment/iyzipos/checkoutform/auth/ecom/detail',
  paymentDetail: '/payment/detail',
  postAuth: '/payment/postauth',
  cancel: '/payment/cancel',
  refund: '/payment/refund',
} as const;

/**
 * Response-signature field order per endpoint (DOCS iyzico-response-signature; matches the SDK samples).
 * Joined with ':' and HMAC-SHA256(secretKey) hex. Price fields are compared with trailing zeros removed
 * ("10.50" -> "10.5", "10.0" -> "10"). Cancel responses carry no signature (DOCS iyzico-cancel-refund).
 */
export const RESPONSE_SIGNATURE_FIELDS: Readonly<Partial<Record<keyof typeof PATHS, readonly string[]>>> = {
  checkoutFormInitializePreAuth: ['conversationId', 'token'],
  checkoutFormInitializeAuth: ['conversationId', 'token'],
  checkoutFormRetrieve: ['paymentStatus', 'paymentId', 'currency', 'basketId', 'conversationId', 'paidPrice', 'price', 'token'],
  paymentDetail: ['paymentId', 'currency', 'basketId', 'conversationId', 'paidPrice', 'price'],
  postAuth: ['paymentId', 'currency', 'basketId', 'conversationId', 'paidPrice', 'price'],
  refund: ['paymentId', 'price', 'currency', 'conversationId'],
};

/** Fields normalised for trailing zeros before signing (DOCS iyzico-response-signature "Trailing Zero"). */
export const PRICE_FIELDS: ReadonlySet<string> = new Set(['price', 'paidPrice']);

/**
 * CF pre-auth currency enum (DOCS iyzico-cf-preauth: TRY, USD, EUR, GBP, NOK, CHF) intersected with our
 * display set. Note: the post-auth response currency enum lists only TRY/USD/EUR, so GBP capture stays
 * UNVERIFIED until a sandbox capture proves it.
 */
export const ADAPTER_CURRENCIES = ['TRY', 'EUR', 'USD', 'GBP'] as const;

/**
 * Pre-authorizations must be closed within 25 days under BKM rules and the period may vary by bank
 * (DOCS iyzico-capture). The approved risk policy's safety margin must cover the bank variance.
 */
export const PRE_AUTH_VALIDITY_SECONDS = 25 * 86_400;

/**
 * fraudStatus: 1 approved, 0 under review, -1 rejected (DOCS iyzico-cf-retrieve: "1: Onaylandı / 0: İncelemede /
 * -1: Reddedildi"; only 1 may be fulfilled). Any other value is treated as REVIEW (T16).
 */
export const FRAUD_STATUS = { APPROVED: 1, REVIEW: 0, REJECTED: -1 } as const;

/**
 * phase values: NOT_IN_DOCS (the pinned pages only say "Ödeme Fazı"). 'AUTH' is visible in the SDK mock;
 * 'PRE_AUTH'/'POST_AUTH' must be confirmed in sandbox (G05). A missing or unknown phase is AMBIGUOUS.
 */
export const PHASE = { PRE_AUTH: 'PRE_AUTH', POST_AUTH: 'POST_AUTH', AUTH: 'AUTH' } as const;

/**
 * Webhook signature V3 (DOCS iyzico-webhook): header X-IYZ-SIGNATURE-V3, HMAC-SHA256(secretKey, key) as hex,
 * key = plain concatenation. HPP format (CheckoutForm / Pay with iyzico) is the one our hosted form produces:
 *   secretKey + iyziEventType + iyziPaymentId + token + paymentConversationId + status
 * The direct-API format is not used by this adapter (its doc sample is ambiguous about paymentId vs
 * iyziPaymentId), so such notifications are refused. Webhooks must also be activated on the merchant account.
 */
export const WEBHOOK_V3 = {
  header: 'x-iyz-signature-v3',
  hppFieldOrder: ['iyziEventType', 'iyziPaymentId', 'token', 'paymentConversationId', 'status'] as const,
} as const;

/**
 * Status values listed for notifications (DOCS iyzico-webhook). Non-terminal customer-side steps map to
 * PENDING/REQUIRES_ACTION; only a server retrieve may report AUTHORIZED/CAPTURED.
 */
export const PENDING_STATUSES: ReadonlySet<string> = new Set(['BKM_POS_SELECTED', 'INIT_APM', 'INIT_CONTACTLESS', 'INIT_BANK_TRANSFER', 'INIT_CREDIT', 'PENDING_CREDIT']);
export const THREEDS_STATUSES: ReadonlySet<string> = new Set(['INIT_THREEDS', 'CALLBACK_THREEDS']);

/** Refund reasons (provenance: SDK Iyzipay.REFUND_REASON). */
export const REFUND_REASON = { BUYER_REQUEST: 'buyer_request', FRAUD: 'fraud', OTHER: 'other', DOUBLE_PAYMENT: 'double_payment' } as const;
