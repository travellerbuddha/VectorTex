import type { CallEvidence, ExternalOutcome, HttpResult } from '@texholiday/contracts';
import { localTimeExists } from '@texholiday/contracts';
import { classifyHttp } from '../http-outcome';

export const JSON_API_MEDIA_TYPE = 'application/vnd.api+json';

/** Bearer header; the API key is never put in a URL or query string (§11). */
export function welcomeHeaders(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}`, accept: JSON_API_MEDIA_TYPE, 'content-type': JSON_API_MEDIA_TYPE };
}

export interface JsonApiDocument {
  data?: unknown;
  errors?: Array<{ status?: string; code?: string; title?: string; detail?: string }>;
  meta?: unknown;
  included?: unknown;
}

/**
 * JSON:API response handling (T06): a document carrying `errors` is a failure even with HTTP 200.
 * Only a document with `data` and no `errors` counts as success.
 */
export function parseJsonApi(result: HttpResult, operation: string, environment: CallEvidence['environment'], at: string): ExternalOutcome<JsonApiDocument> {
  const http = classifyHttp(result, operation, environment, at);
  if (!http.ok) return http.outcome;
  const doc = http.json as JsonApiDocument | null;
  if (!doc || typeof doc !== 'object') return { kind: 'UNKNOWN', reason: 'MALFORMED_RESPONSE', evidence: http.evidence };
  if (Array.isArray(doc.errors) && doc.errors.length > 0) {
    const first = doc.errors[0] ?? {};
    return { kind: 'REJECTED', code: `WELCOME_${first.code ?? first.status ?? 'ERROR'}`, message: 'Transfer supplier returned an error document', evidence: http.evidence };
  }
  if (doc.data === undefined) return { kind: 'UNKNOWN', reason: 'MALFORMED_RESPONSE', evidence: http.evidence };
  return { kind: 'SUCCEEDED', value: doc, evidence: http.evidence };
}

export class TransferValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferValidationError';
  }
}

/**
 * T11: airport pickups need a valid IATA code and flight number; the local pickup time must exist in the
 * pickup timezone (no DST-gap times) and be in the future.
 */
export function validateTransferRequest(
  req: {
    pickup: { kind: 'AIRPORT'; iata: string; flightNumber: string } | { kind: 'ADDRESS'; address: string; lat: number; lng: number };
    dropoff: { kind: 'AIRPORT'; iata: string } | { kind: 'ADDRESS'; address: string; lat: number; lng: number };
    pickupLocal: { dateTime: string; timezone: string };
    passengers: number;
    luggage: number;
    childSeats: number;
  },
  now: Date,
): void {
  const iata = /^[A-Z]{3}$/;
  if (req.pickup.kind === 'AIRPORT') {
    if (!iata.test(req.pickup.iata)) throw new TransferValidationError('Pickup IATA code must be 3 uppercase letters');
    if (!/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(req.pickup.flightNumber.replace(/\s+/g, ''))) throw new TransferValidationError('Airport pickup needs a valid flight number');
  } else if (!req.pickup.address.trim() || !Number.isFinite(req.pickup.lat) || !Number.isFinite(req.pickup.lng)) {
    throw new TransferValidationError('Pickup address and coordinates are required');
  }
  if (req.dropoff.kind === 'AIRPORT' && !iata.test(req.dropoff.iata)) throw new TransferValidationError('Drop-off IATA code must be 3 uppercase letters');
  if (!Number.isInteger(req.passengers) || req.passengers < 1) throw new TransferValidationError('At least one passenger is required');
  if (!Number.isInteger(req.luggage) || req.luggage < 0 || !Number.isInteger(req.childSeats) || req.childSeats < 0) {
    throw new TransferValidationError('Luggage and child seats must be non-negative integers');
  }
  if (req.childSeats > req.passengers) throw new TransferValidationError('More child seats than passengers');
  let exists: boolean;
  try {
    exists = localTimeExists(req.pickupLocal.dateTime, req.pickupLocal.timezone);
  } catch {
    throw new TransferValidationError('Pickup local time or timezone is invalid');
  }
  if (!exists) throw new TransferValidationError('Pickup time does not exist in this timezone (DST change)');
}

/** T12: estimates cannot be sold; only firm quotes with an expiry may reach checkout. */
export function assertFirmQuote(offer: { firm: boolean; expiresAt: string | null }, now: Date): void {
  if (!offer.firm) throw new TransferValidationError('Estimated transfer price cannot be charged; a firm quote is required');
  if (!offer.expiresAt || new Date(offer.expiresAt).getTime() <= now.getTime()) throw new TransferValidationError('Firm quote expired or has no expiry');
}

/** Stable, unique references persisted before the create call; lookups use them after a lost response. */
export function welcomeReferences(orderItemId: string, attempt: number): { bookingReference: string; passengerBookingReference: string } {
  if (!Number.isInteger(attempt) || attempt < 1) throw new TransferValidationError('attempt must be >= 1');
  return { bookingReference: `TH-${orderItemId}-${attempt}`, passengerBookingReference: `TH-${orderItemId}-${attempt}-P` };
}
