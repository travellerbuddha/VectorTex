import { describe, expect, it } from 'vitest';
import { MockFlightConnector } from '@texholiday/connectors';
import type { FlightPassenger } from '@texholiday/contracts';
import type { CheckoutRepository, QuoteRepository } from '@texholiday/db';
import type { OrderAggregate, OrderItemState } from '@texholiday/domain';
import { NuiteeFlightProviderManagedPort, TransientPassengerDetails, ageOn } from '../src/index';

// TEST-ONLY passenger (fictional).
const p: FlightPassenger = { type: 'ADULT', firstName: 'Test', lastName: 'Traveller', middleName: null, birthDate: '1990-01-01', gender: 'F', nationality: 'TR', document: { type: 'passport', number: 'TEST1', issuingCountry: 'TR', expiresOn: '2035-01-01' } };

describe('passenger documents are held in memory only until the prebook (ADR-0012)', () => {
  it('taken once; expired entries are gone', () => {
    const clock = { now: new Date('2027-05-01T10:00:00Z') };
    const d = new TransientPassengerDetails(60_000, () => clock.now);
    d.put('o1', [p]);
    expect(d.take('o1')).toEqual([p]);
    expect(d.take('o1')).toBeNull();
    d.put('o2', [p]);
    clock.now = new Date(clock.now.getTime() + 60_000);
    expect(d.take('o2')).toBeNull();
  });

  it('without the documents (restart, another process) the prebook is not sent and nothing is charged', async () => {
    const flights = new MockFlightConnector();
    const quotes = { get: async () => ({ environment: 'mock', productType: 'FLIGHT', offerRef: 'MOCK-FOFFER-X', chargeNow: { currency: 'EUR', minor: 100n } }) } as unknown as QuoteRepository;
    const checkout = { guests: async () => ({ holder: { firstName: 'Test', lastName: 'Traveller', email: 't@example.test', phone: '+905321112233', phoneCountryCode: '90' }, roomGuests: [] }) } as unknown as CheckoutRepository;
    const port = new NuiteeFlightProviderManagedPort(flights, quotes, checkout, new TransientPassengerDetails(60_000));
    const agg = { id: 'o1', environment: 'mock' } as OrderAggregate;
    const out = await port.prebookForPayment(agg, { id: 'i1', quoteVersionId: 'q1' } as OrderItemState);
    expect(out).toMatchObject({ kind: 'CAPABILITY_NOT_AVAILABLE', capability: 'PASSENGER_DETAILS' });
    expect(port.bookTrigger()).toBe('CUSTOMER_RETURN');
    expect(port.lookupScope()).toBe('PER_PREBOOK');
  });

  it('ages are whole years on the travel date', () => {
    expect(ageOn('2015-06-10', '2027-06-09')).toBe(11);
    expect(ageOn('2015-06-10', '2027-06-10')).toBe(12);
    expect(ageOn('2025-07-01', '2027-06-30')).toBe(1);
  });
});
