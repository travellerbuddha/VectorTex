/**
 * Result of any call to a provider or gateway.
 *
 * - SUCCEEDED: the upstream confirmed the result.
 * - REJECTED: the upstream definitively refused; nothing was created/changed upstream.
 * - UNKNOWN: we cannot tell (timeout, connection reset, 5xx, unparseable body, bad signature).
 *   UNKNOWN is never treated as FAILED: resolution requires a lookup/retrieve, not a retry.
 * - CAPABILITY_NOT_AVAILABLE: the adapter/account cannot do this; no call was made.
 */
export type ExternalOutcome<T> =
  | { kind: 'SUCCEEDED'; value: T; evidence: CallEvidence }
  | { kind: 'REJECTED'; code: string; message: string; evidence: CallEvidence }
  | { kind: 'UNKNOWN'; reason: UnknownReason; evidence: CallEvidence }
  | { kind: 'CAPABILITY_NOT_AVAILABLE'; capability: string; reason: string };

export type UnknownReason = 'TIMEOUT' | 'NETWORK' | 'UPSTREAM_5XX' | 'MALFORMED_RESPONSE' | 'SIGNATURE_MISMATCH' | 'AMBIGUOUS';

/** PII-free trace of a call, safe to persist and show to operations. */
export interface CallEvidence {
  operation: string;
  environment: 'mock' | 'sandbox' | 'production';
  at: string;
  httpStatus: number | null;
  upstreamRequestId: string | null;
  durationMs: number | null;
}

export const isUnknown = <T>(o: ExternalOutcome<T>): o is Extract<ExternalOutcome<T>, { kind: 'UNKNOWN' }> => o.kind === 'UNKNOWN';

export function notAvailable(capability: string, reason: string): ExternalOutcome<never> {
  return { kind: 'CAPABILITY_NOT_AVAILABLE', capability, reason };
}
