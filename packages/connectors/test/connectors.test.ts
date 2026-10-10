import { describe, expect, it } from 'vitest';
import type { HttpResult } from '@texholiday/contracts';
import {
  assertExplicitNationality,
  assertFirmQuote,
  assertGuestsMatchOccupancies,
  assertRequiredAnswers,
  occupanciesFromSearch,
  parseJsonApi,
  participantsForPrebook,
  validateTransferRequest,
  welcomeHeaders,
  welcomeReferences,
} from '../src/index';

const NOW = new Date('2026-10-09T10:00:00Z');
const http = (status: number, body: unknown): HttpResult => ({ kind: 'RESPONSE', response: { status, headers: {}, body: typeof body === 'string' ? body : JSON.stringify(body) }, durationMs: 3 });

describe('T03 multi-room / children / nationality (Nuitee hotel)', () => {
  const occ = occupanciesFromSearch([
    { adults: 2, childAges: [5, 9] },
    { adults: 1, childAges: [] },
  ]);
  const lead = (n: number, first = 'Ada') => ({ occupancyNumber: n, leadGuest: { firstName: first, lastName: 'Yilmaz', email: 'a@example.test' } });

  it('numbers occupancies from 1 in search order and keeps child ages', () => {
    expect(occ).toEqual([
      { occupancyNumber: 1, adults: 2, childAges: [5, 9] },
      { occupancyNumber: 2, adults: 1, childAges: [] },
    ]);
  });

  it('requires exactly one lead guest per searched room and an offer covering the same rooms', () => {
    expect(() => assertGuestsMatchOccupancies(occ, [lead(1), lead(2)], [1, 2])).not.toThrow();
    expect(() => assertGuestsMatchOccupancies(occ, [lead(1)], [1, 2])).toThrow(/Missing lead guest for room\(s\) 2/);
    expect(() => assertGuestsMatchOccupancies(occ, [lead(1), lead(1, 'Bo'), lead(2)], [1, 2])).toThrow(/Two lead guests/);
    expect(() => assertGuestsMatchOccupancies(occ, [lead(1), lead(3)], [1, 2])).toThrow(/unknown room 3/);
    expect(() => assertGuestsMatchOccupancies(occ, [lead(1), lead(2)], [1])).toThrow(/Offer covers rooms/);
  });

  it('rejects invalid rooms and implicit nationality', () => {
    expect(() => occupanciesFromSearch([{ adults: 0, childAges: [] }])).toThrow();
    expect(() => occupanciesFromSearch([{ adults: 1, childAges: [18] }])).toThrow(/child age/);
    expect(() => assertExplicitNationality(undefined)).toThrow(/explicitly/);
    expect(assertExplicitNationality('DE')).toBe('DE');
  });
});

describe('T06 Welcome JSON:API errors inside HTTP 200', () => {
  it('an errors document is a failure even with status 200', () => {
    const out = parseJsonApi(http(200, { errors: [{ status: '422', code: 'invalid_pickup', title: 'Invalid' }] }), 'welcome.quote', 'sandbox', NOW.toISOString());
    expect(out).toMatchObject({ kind: 'REJECTED', code: 'WELCOME_invalid_pickup' });
  });

  it('data without errors is success; empty/odd documents are UNKNOWN; 5xx is UNKNOWN', () => {
    expect(parseJsonApi(http(200, { data: { id: '1', type: 'bookings' } }), 'op', 'sandbox', NOW.toISOString()).kind).toBe('SUCCEEDED');
    expect(parseJsonApi(http(200, {}), 'op', 'sandbox', NOW.toISOString()).kind).toBe('UNKNOWN');
    expect(parseJsonApi(http(200, 'not json'), 'op', 'sandbox', NOW.toISOString()).kind).toBe('UNKNOWN');
    expect(parseJsonApi(http(502, ''), 'op', 'sandbox', NOW.toISOString()).kind).toBe('UNKNOWN');
    expect(parseJsonApi({ kind: 'NO_RESPONSE', reason: 'TIMEOUT', detail: 't', durationMs: 1 }, 'op', 'sandbox', NOW.toISOString()).kind).toBe('UNKNOWN');
  });

  it('uses a Bearer header and the JSON:API media type', () => {
    expect(welcomeHeaders('k-123')).toEqual({ authorization: 'Bearer k-123', accept: 'application/vnd.api+json', 'content-type': 'application/vnd.api+json' });
  });

  it('references are unique per attempt and stable for lookups', () => {
    expect(welcomeReferences('item-1', 1)).toEqual({ bookingReference: 'TH-item-1-1', passengerBookingReference: 'TH-item-1-1-P' });
    expect(welcomeReferences('item-1', 2).bookingReference).not.toBe(welcomeReferences('item-1', 1).bookingReference);
  });
});

describe('T11 transfer location / time validation', () => {
  const base = {
    pickup: { kind: 'AIRPORT' as const, iata: 'AYT', flightNumber: 'TK 2412' },
    dropoff: { kind: 'ADDRESS' as const, address: 'Lara, Antalya', lat: 36.85, lng: 30.85 },
    pickupLocal: { dateTime: '2026-11-01T14:30', timezone: 'Europe/Istanbul' },
    passengers: 3,
    luggage: 3,
    childSeats: 1,
  };

  it('accepts a valid airport pickup', () => {
    expect(() => validateTransferRequest(base, NOW)).not.toThrow();
  });

  it('rejects bad IATA, missing flight numbers, impossible DST times and seat overflow', () => {
    expect(() => validateTransferRequest({ ...base, pickup: { ...base.pickup, iata: 'ayt' } }, NOW)).toThrow(/IATA/);
    expect(() => validateTransferRequest({ ...base, pickup: { ...base.pickup, flightNumber: '' } }, NOW)).toThrow(/flight number/);
    expect(() => validateTransferRequest({ ...base, pickupLocal: { dateTime: '2026-03-29T02:30', timezone: 'Europe/Berlin' } }, NOW)).toThrow(/DST/);
    expect(() => validateTransferRequest({ ...base, childSeats: 4 }, NOW)).toThrow(/child seats/);
    expect(() => validateTransferRequest({ ...base, pickupLocal: { dateTime: '2026-11-01T14:30', timezone: 'Mars/Olympus' } }, NOW)).toThrow(/invalid/);
  });
});

describe('T12 estimated transfer price', () => {
  it('only firm, unexpired quotes may be charged', () => {
    expect(() => assertFirmQuote({ firm: false, expiresAt: '2026-10-09T11:00:00Z' }, NOW)).toThrow(/Estimated/);
    expect(() => assertFirmQuote({ firm: true, expiresAt: null }, NOW)).toThrow(/expiry/);
    expect(() => assertFirmQuote({ firm: true, expiresAt: '2026-10-09T09:59:59Z' }, NOW)).toThrow(/expired/);
    expect(() => assertFirmQuote({ firm: true, expiresAt: '2026-10-09T10:15:00Z' }, NOW)).not.toThrow();
  });
});

describe('T09 Experiences option / participants / required questions', () => {
  it('maps category counts to one participant per person, preserving provider category keys', () => {
    const p = participantsForPrebook({ 'ADULT-18+': 2, 'CHILD_4-12': 1 }, [
      { category: 'ADULT-18+', travelerId: 't1' },
      { category: 'ADULT-18+', travelerId: 't2' },
      { category: 'CHILD_4-12', travelerId: 't3' },
    ]);
    expect(p.map((x) => x.category)).toEqual(['ADULT-18+', 'ADULT-18+', 'CHILD_4-12']);
  });

  it('rejects count mismatches, unknown categories and duplicate travelers', () => {
    expect(() => participantsForPrebook({ ADULT: 2 }, [{ category: 'ADULT', travelerId: 't1' }])).toThrow(/missing/);
    expect(() => participantsForPrebook({ ADULT: 1 }, [{ category: 'adult', travelerId: 't1' }])).toThrow(/not part of the selected option/);
    expect(() => participantsForPrebook({ ADULT: 2 }, [{ category: 'ADULT', travelerId: 't1' }, { category: 'ADULT', travelerId: 't1' }])).toThrow(/twice/);
  });

  it('requires answers for every required booking and per-participant question', () => {
    const questions = [
      { id: 'pickup_hotel', label: 'Hotel', required: true, appliesTo: 'BOOKING' as const, schema: {} },
      { id: 'weight', label: 'Weight', required: true, appliesTo: 'PARTICIPANT' as const, schema: {} },
      { id: 'notes', label: 'Notes', required: false, appliesTo: 'BOOKING' as const, schema: {} },
    ];
    expect(() => assertRequiredAnswers(questions, { booking: { pickup_hotel: 'X' }, perParticipant: { t1: { weight: 70 } } }, ['t1', 't2'])).toThrow(/weight@t2/);
    expect(() => assertRequiredAnswers(questions, { booking: { pickup_hotel: ' ' }, perParticipant: { t1: { weight: 70 } } }, ['t1'])).toThrow(/pickup_hotel/);
    expect(() => assertRequiredAnswers(questions, { booking: { pickup_hotel: 'X' }, perParticipant: { t1: { weight: 70 } } }, ['t1'])).not.toThrow();
  });
});
