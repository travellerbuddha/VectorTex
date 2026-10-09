import { describe, expect, it } from 'vitest';
import { IllegalTransitionError, opaque } from '@texholiday/contracts';
import { money } from '@texholiday/pricing';
import {
  assertQuoteUsable,
  bookingMachine,
  compareQuotes,
  freeCancellation,
  orderMachine,
  packageExpiry,
  paymentMachine,
  penaltyAt,
  zonedLocalToInstant,
  instantToZonedLocal,
  type QuoteVersionSnapshot,
} from '../src/index';

describe('state machines', () => {
  it('UNKNOWN can only be left through reconciliation', () => {
    expect(paymentMachine.canTransition('UNKNOWN', 'CAPTURED', 'UPSTREAM_RESULT')).toBe(false);
    expect(paymentMachine.canTransition('UNKNOWN', 'CAPTURED', 'COMMAND')).toBe(false);
    expect(paymentMachine.canTransition('UNKNOWN', 'CAPTURED', 'RECONCILIATION')).toBe(true);
    expect(bookingMachine.canTransition('UNKNOWN', 'FAILED', 'COMMAND')).toBe(false);
  });

  it('a timeout is never FAILED: there is no CAPTURE_PENDING -> FAILED edge and UNKNOWN exists', () => {
    expect(paymentMachine.canTransition('CAPTURE_PENDING', 'UNKNOWN', 'UPSTREAM_RESULT')).toBe(true);
    expect(paymentMachine.states).not.toContain('FAILED');
  });

  it('T18: no backwards transitions (late events cannot revert)', () => {
    expect(paymentMachine.canTransition('CAPTURED', 'AUTHORIZED', 'RECONCILIATION')).toBe(false);
    expect(bookingMachine.canTransition('CONFIRMED', 'PENDING_CONFIRMATION', 'RECONCILIATION')).toBe(false);
    expect(bookingMachine.canTransition('CANCELLED', 'CONFIRMED', 'RECONCILIATION')).toBe(false);
  });

  it('terminal states have no exits and illegal moves throw', () => {
    expect(() => orderMachine.assertTransition('CANCELLED', 'PROCESSING', 'COMMAND')).toThrow(IllegalTransitionError);
    expect(() => paymentMachine.assertTransition('REFUNDED', 'CAPTURED', 'RECONCILIATION')).toThrow(IllegalTransitionError);
  });

  it('BOOKED_UNPAID is not an order status', () => {
    expect(orderMachine.states).not.toContain('BOOKED_UNPAID' as never);
    expect(orderMachine.states).toContain('ACTION_REQUIRED');
  });
});

const baseQuote = (over: Partial<QuoteVersionSnapshot> = {}): QuoteVersionSnapshot => ({
  id: 'qv1',
  quoteId: 'q1',
  version: 1,
  productType: 'HOTEL',
  providerId: 'nuitee',
  offerRef: opaque('MOCK-OFFER'),
  option: { room: 'Double', board: 'BB' },
  travelers: [{ travelerId: 't1', type: 'ADULT', age: null }],
  supplierCost: money('EUR', 9000n),
  sell: money('EUR', 10000n),
  chargeNow: money('EUR', 10000n),
  fx: null,
  fees: [],
  payAtProperty: [money('EUR', 300n)],
  cancellation: { timezone: 'Europe/Istanbul', refundable: true, steps: [{ from: '2026-11-01T21:00:00.000Z', penalty: money('EUR', 10000n) }], providerText: null },
  expiresAt: '2026-10-09T10:15:00.000Z',
  createdAt: '2026-10-09T10:00:00.000Z',
  pricingPolicy: { id: 'pp', version: 1 },
  acceptance: { acceptedAt: '2026-10-09T10:01:00.000Z', termsVersion: 'terms-v1' },
  ...over,
});

describe('T04 quote change / expiry', () => {
  it('refuses unaccepted or expired quotes', () => {
    expect(() => assertQuoteUsable(baseQuote({ acceptance: null }), new Date('2026-10-09T10:02:00Z'))).toThrow(/not accepted/);
    expect(() => assertQuoteUsable(baseQuote(), new Date('2026-10-09T10:15:00Z'))).toThrow(expect.objectContaining({ code: 'QUOTE_EXPIRED' }));
    expect(() => assertQuoteUsable(baseQuote(), new Date('2026-10-09T10:14:59Z'))).not.toThrow();
  });

  it('detects price and condition changes that require re-acceptance', () => {
    expect(compareQuotes(baseQuote(), baseQuote({ id: 'qv2', version: 2 }))).toEqual([]);
    expect(compareQuotes(baseQuote(), baseQuote({ chargeNow: money('EUR', 10001n) }))).toEqual(['CHARGE_AMOUNT']);
    expect(compareQuotes(baseQuote(), baseQuote({ chargeNow: money('TRY', 10000n) }))).toContain('CHARGE_CURRENCY');
    const stricter = baseQuote({ cancellation: { ...baseQuote().cancellation, steps: [{ from: '2026-10-20T21:00:00.000Z', penalty: money('EUR', 10000n) }] } });
    expect(compareQuotes(baseQuote(), stricter)).toEqual(['CANCELLATION']);
  });

  it('a package expires with its earliest component', () => {
    const d = packageExpiry([baseQuote(), baseQuote({ expiresAt: '2026-10-09T10:05:00.000Z' })]);
    expect(d.toISOString()).toBe('2026-10-09T10:05:00.000Z');
  });
});

describe('T05 cancellation deadlines, time zones and DST', () => {
  it('converts provider-local deadlines in Istanbul (UTC+3, no DST)', () => {
    expect(zonedLocalToInstant('2026-11-01T00:00', 'Europe/Istanbul').toISOString()).toBe('2026-10-31T21:00:00.000Z');
  });

  it('handles a DST gap conservatively (earliest plausible instant)', () => {
    // 2026-03-29 02:30 does not exist in Berlin (02:00 -> 03:00).
    const earlier = zonedLocalToInstant('2026-03-29T02:30', 'Europe/Berlin', 'earlier');
    const later = zonedLocalToInstant('2026-03-29T02:30', 'Europe/Berlin', 'later');
    expect(earlier.getTime()).toBeLessThan(later.getTime());
    expect(earlier.toISOString()).toBe('2026-03-29T00:30:00.000Z');
  });

  it('handles a DST overlap (ambiguous hour)', () => {
    // 2026-10-25 02:30 happens twice in Berlin.
    expect(zonedLocalToInstant('2026-10-25T02:30', 'Europe/Berlin', 'earlier').toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(zonedLocalToInstant('2026-10-25T02:30', 'Europe/Berlin', 'later').toISOString()).toBe('2026-10-25T01:30:00.000Z');
  });

  it('rejects impossible dates', () => {
    expect(() => zonedLocalToInstant('2026-02-30T10:00', 'Europe/Istanbul')).toThrow();
  });

  it('applies the right penalty step around the deadline', () => {
    const policy = baseQuote().cancellation;
    expect(penaltyAt(policy, new Date('2026-11-01T20:59:59Z'), 'EUR')).toEqual(money('EUR', 0n));
    expect(penaltyAt(policy, new Date('2026-11-01T21:00:00Z'), 'EUR')).toEqual(money('EUR', 10000n));
    const fc = freeCancellation(policy);
    expect(fc.kind === 'FREE_UNTIL' && instantToZonedLocal(fc.lastFreeInstant, 'Europe/Istanbul')).toBe('2026-11-01T23:59');
    expect(freeCancellation({ ...policy, refundable: false })).toEqual({ kind: 'NON_REFUNDABLE' });
  });
});
