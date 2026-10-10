import { parseJsonPreservingNumbers, type CallEvidence, type ExternalOutcome, type HttpResult } from '@texholiday/contracts';

export type ParsedHttp =
  | { ok: true; status: number; json: unknown; parsed: NonNullable<ReturnType<typeof parseJsonPreservingNumbers>>; evidence: CallEvidence }
  | { ok: false; outcome: ExternalOutcome<never> };

/**
 * Generic classification shared by supplier adapters:
 * - no response (timeout/reset) and 5xx -> UNKNOWN (the request may have been processed);
 * - unparseable body -> UNKNOWN;
 * - 4xx -> REJECTED with the provider's code (definitive refusal);
 * - 2xx -> parsed body (product adapters still check body-level errors, e.g. JSON:API `errors`).
 */
export function classifyHttp(
  result: HttpResult,
  operation: string,
  environment: CallEvidence['environment'],
  at: string,
  requestIdHeader?: string,
  opts: { passThrough4xx?: boolean } = {},
): ParsedHttp {
  if (result.kind === 'NO_RESPONSE') {
    return { ok: false, outcome: { kind: 'UNKNOWN', reason: result.reason, evidence: { operation, environment, at, httpStatus: null, upstreamRequestId: null, durationMs: result.durationMs } } };
  }
  const { status, body, headers } = result.response;
  const evidence: CallEvidence = {
    operation,
    environment,
    at,
    httpStatus: status,
    upstreamRequestId: requestIdHeader ? (headers[requestIdHeader.toLowerCase()] ?? null) : null,
    durationMs: result.durationMs,
  };
  if (status >= 500) return { ok: false, outcome: { kind: 'UNKNOWN', reason: 'UPSTREAM_5XX', evidence } };
  const parsed = body.length > 0 ? parseJsonPreservingNumbers(body) : { value: null, numberSource: new Map() };
  if (!parsed) return { ok: false, outcome: { kind: 'UNKNOWN', reason: 'MALFORMED_RESPONSE', evidence } };
  // Adapters that classify by the provider's own error code receive 4xx bodies instead of a generic REJECTED.
  if (status >= 400 && !opts.passThrough4xx) {
    return { ok: false, outcome: { kind: 'REJECTED', code: `HTTP_${status}`, message: 'Supplier refused the request', evidence } };
  }
  return { ok: true, status, json: parsed.value, parsed, evidence };
}
