/**
 * iyzico contract facts used by the adapter, each with its provenance.
 *
 * SDK = official client iyzipay@2.0.70 (sources.lock.json: ref-npm-iyzipay, sha512 integrity pinned).
 * DOCS = docs.iyzico.com pages listed in sources.lock.json; UNREACHABLE from the build environment on
 * 2026-10-09, so facts marked DOCS_UNPINNED must be re-checked when those sources are pinned (G05).
 * The registry refuses this adapter in production until every source in REQUIRED_SOURCES is PINNED.
 */

export const IYZICO_GATEWAY_ID = 'iyzico';

export const REQUIRED_SOURCES = [
  'iyzico-cf-preauth',
  'iyzico-capture',
  'iyzico-cf-retrieve',
  'iyzico-response-signature',
  'iyzico-cancel-refund',
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
 * Response-signature field order per endpoint (provenance: SDK samples/IyzipaySamples.js and
 * PayWithIyzicoSamples.js). Joined with ':' and HMAC-SHA256(secretKey) hex (SDK utils.calculateHmacSHA256Signature).
 * Endpoints without an entry have no documented response signature in the SDK.
 */
export const RESPONSE_SIGNATURE_FIELDS: Readonly<Partial<Record<keyof typeof PATHS, readonly string[]>>> = {
  checkoutFormInitializePreAuth: ['conversationId', 'token'],
  checkoutFormInitializeAuth: ['conversationId', 'token'],
  checkoutFormRetrieve: ['paymentStatus', 'paymentId', 'currency', 'basketId', 'conversationId', 'paidPrice', 'price', 'token'],
  paymentDetail: ['paymentId', 'currency', 'basketId', 'conversationId', 'paidPrice', 'price'],
  postAuth: ['paymentId', 'currency', 'basketId', 'conversationId', 'paidPrice', 'price'],
};

/** Currencies the official client enumerates (SDK Iyzipay.CURRENCY) intersected with our display set. */
export const ADAPTER_CURRENCIES = ['TRY', 'EUR', 'USD', 'GBP'] as const;

/**
 * fraudStatus values. Provenance: DOCS_UNPINNED (1 approved is visible in the SDK test mock; 0 = review
 * and -1 = rejected come from iyzico documentation that could not be re-fetched). Any other value is
 * treated as REVIEW so nothing irreversible starts (T16).
 */
export const FRAUD_STATUS = { APPROVED: 1, REVIEW: 0, REJECTED: -1 } as const;

/**
 * phase + paymentStatus mapping. Provenance: 'AUTH' and 'SUCCESS' visible in the SDK test mock;
 * 'PRE_AUTH'/'POST_AUTH' are DOCS_UNPINNED. A missing or unknown phase is AMBIGUOUS (no guessing).
 */
export const PHASE = { PRE_AUTH: 'PRE_AUTH', POST_AUTH: 'POST_AUTH', AUTH: 'AUTH' } as const;

export const WEBHOOK_V3 = {
  header: 'x-iyz-signature-v3',
  /**
   * Field order for the V3 webhook signature is endpoint/flow specific and is NOT in the official client.
   * Until the 'iyzico-webhook' source is pinned the adapter does not verify webhooks (fail-closed) and
   * relies on server-side retrieve polling instead.
   */
  fieldOrder: null as readonly string[] | null,
} as const;

/** Refund reasons (provenance: SDK Iyzipay.REFUND_REASON). */
export const REFUND_REASON = { BUYER_REQUEST: 'buyer_request', FRAUD: 'fraud', OTHER: 'other', DOUBLE_PAYMENT: 'double_payment' } as const;
