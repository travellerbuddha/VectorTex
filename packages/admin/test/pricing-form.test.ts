import { describe, expect, it } from 'vitest';
import { pricingPolicyDocumentSchema, type PricingPolicyDocument } from '@texholiday/pricing';
import { basisPointsToPercent, documentFromForm, parseAmount, percentToBasisPoints, rowsFromDocument } from '../src/index';

const base: PricingPolicyDocument = {
  rounding: 'HALF_EVEN',
  rules: [
    { productType: 'HOTEL', paymentMode: 'PROVIDER_MANAGED', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 1250 },
    { productType: 'TRANSFER', paymentMode: 'OWN_GATEWAY', application: 'LOCAL', kind: 'FIXED', amount: { currency: 'EUR', minor: '500' } },
  ],
  serviceFees: [{ code: 'SERVICE', label: { tr: 'Hizmet bedeli', en: 'Service fee' }, scope: 'PACKAGE', kind: 'PERCENT_OF_SELL', basisPoints: 200 }],
  fx: null,
  allowBelowSspInOpaquePackage: false,
  allowBelowSspProviderManaged: false,
};

const formOf = (fields: Record<string, string>) => (name: string) => fields[name] ?? null;

describe('pricing policy editor (G06)', () => {
  it('percent text <-> basis points is exact (no floating point)', () => {
    expect(percentToBasisPoints('10')).toBe(1000);
    expect(percentToBasisPoints('10,5')).toBe(1050);
    expect(percentToBasisPoints('12.25')).toBe(1225);
    expect(percentToBasisPoints('0,07')).toBe(7);
    expect(percentToBasisPoints('100')).toBe(10_000);
    for (const bad of ['', '-1', '100,01', '1,234', 'abc', '1e2', '10%']) expect(percentToBasisPoints(bad)).toBeNull();
    expect(basisPointsToPercent(1050)).toBe('10,5');
    expect(basisPointsToPercent(1225, '.')).toBe('12.25');
    expect(basisPointsToPercent(1000)).toBe('10');
    expect(basisPointsToPercent(7)).toBe('0,07');
  });

  it('rows show the stored rules; empty slots stay empty (no default margin)', () => {
    const rows = rowsFromDocument(base);
    expect(rows['m.HOTEL.PROVIDER_MANAGED']).toMatchObject({ on: true, application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', percent: '12,5' });
    expect(rows['m.TRANSFER.OWN_GATEWAY']).toMatchObject({ on: true, kind: 'FIXED', amount: '5,00', currency: 'EUR' });
    expect(rowsFromDocument(base, '.')['m.TRANSFER.OWN_GATEWAY']).toMatchObject({ amount: '5.00' });
    expect(rows['m.FLIGHT.PROVIDER_MANAGED']).toMatchObject({ on: false, percent: '' });
    expect(Object.values(rowsFromDocument(null)).every((r) => !r.on)).toBe(true);
  });

  it('the form builds a valid document and keeps what it does not edit (service fees)', () => {
    const { document, issues } = documentFromForm(
      formOf({
        rounding: 'HALF_UP',
        'm.HOTEL.PROVIDER_MANAGED.on': '1',
        'm.HOTEL.PROVIDER_MANAGED.pct': '15',
        'm.HOTEL.OWN_GATEWAY.on': '1',
        'm.HOTEL.OWN_GATEWAY.app': 'LOCAL',
        'm.HOTEL.OWN_GATEWAY.kind': 'FIXED',
        'm.HOTEL.OWN_GATEWAY.amount': '12,50',
        'm.HOTEL.OWN_GATEWAY.currency': 'try',
        'ssp.providerManaged': '1',
        'fx.on': '1',
        'fx.source': 'TCMB',
        'fx.maxAgeMinutes': '60',
        'fx.rounding': 'HALF_EVEN',
      }),
      base,
    );
    expect(issues).toEqual([]);
    expect(document.rules).toEqual([
      { productType: 'HOTEL', paymentMode: 'PROVIDER_MANAGED', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 1500 },
      { productType: 'HOTEL', paymentMode: 'OWN_GATEWAY', application: 'LOCAL', kind: 'FIXED', amount: { currency: 'TRY', minor: '1250' } },
    ]);
    expect(document).toMatchObject({ rounding: 'HALF_UP', allowBelowSspProviderManaged: true, allowBelowSspInOpaquePackage: false, fx: { source: 'TCMB', maxRateAgeSeconds: 3600, rounding: 'HALF_EVEN' } });
    expect(document.serviceFees).toEqual(base.serviceFees);
    expect(pricingPolicyDocumentSchema.safeParse(document).success).toBe(true);
  });

  it('invalid input is reported per field, never turned into a guessed value', () => {
    const { issues } = documentFromForm(
      formOf({
        'm.HOTEL.PROVIDER_MANAGED.on': '1',
        'm.HOTEL.PROVIDER_MANAGED.pct': '150',
        'm.HOTEL.PROVIDER_MANAGED.app': 'LOCAL', // provider-managed sales cannot take a local margin
        'm.FLIGHT.OWN_GATEWAY.on': '1',
        'm.FLIGHT.OWN_GATEWAY.app': 'PROVIDER_API',
        'm.FLIGHT.OWN_GATEWAY.kind': 'FIXED',
        'm.EXPERIENCE.OWN_GATEWAY.on': '1',
        'm.EXPERIENCE.OWN_GATEWAY.app': 'LOCAL',
        'm.EXPERIENCE.OWN_GATEWAY.pct': 'ten',
        'm.TRANSFER.OWN_GATEWAY.on': '1',
        'm.TRANSFER.OWN_GATEWAY.app': 'LOCAL',
        'm.TRANSFER.OWN_GATEWAY.kind': 'FIXED',
        'm.TRANSFER.OWN_GATEWAY.amount': '5,001',
        'm.TRANSFER.OWN_GATEWAY.currency': 'EUR',
        'fx.on': '1',
        'fx.source': '',
        'fx.maxAgeMinutes': '0',
      }),
      null,
    );
    expect(issues).toEqual([
      { field: 'm.HOTEL.PROVIDER_MANAGED', code: 'APPLICATION' },
      { field: 'm.FLIGHT.OWN_GATEWAY', code: 'FIXED_NOT_LOCAL' },
      { field: 'm.EXPERIENCE.OWN_GATEWAY', code: 'PERCENT' },
      { field: 'm.TRANSFER.OWN_GATEWAY', code: 'AMOUNT' },
      { field: 'fx.source', code: 'FX_SOURCE' },
      { field: 'fx.maxAgeMinutes', code: 'FX_AGE' },
    ]);
  });

  it('amounts are read in the panel language without guessing thousands vs decimals', () => {
    expect(parseAmount('1.500', ',')).toBe('1500');
    expect(parseAmount('1.500,25', ',')).toBe('1500.25');
    expect(parseAmount('12,50', ',')).toBe('12.50');
    expect(parseAmount(' 2 500 ', ',')).toBe('2500');
    expect(parseAmount('1,500.25', '.')).toBe('1500.25');
    expect(parseAmount('12.50', '.')).toBe('12.50');
    // Ambiguous or malformed: rejected, never read as another amount.
    for (const [text, sep] of [['12.50', ','], ['1.50', ','], ['12,50', '.'], ['1.5000', ','], ['-5', ','], ['1e3', ','], ['', ','], ['1,2,3', ',']] as const) {
      expect(parseAmount(text, sep)).toBeNull();
    }
    const { issues } = documentFromForm(
      formOf({ 'm.TRANSFER.OWN_GATEWAY.on': '1', 'm.TRANSFER.OWN_GATEWAY.app': 'LOCAL', 'm.TRANSFER.OWN_GATEWAY.kind': 'FIXED', 'm.TRANSFER.OWN_GATEWAY.amount': '12.50', 'm.TRANSFER.OWN_GATEWAY.currency': 'EUR' }),
      null,
      ',',
    );
    expect(issues).toEqual([{ field: 'm.TRANSFER.OWN_GATEWAY', code: 'AMOUNT' }]);
    const en = documentFromForm(
      formOf({ 'm.TRANSFER.OWN_GATEWAY.on': '1', 'm.TRANSFER.OWN_GATEWAY.app': 'LOCAL', 'm.TRANSFER.OWN_GATEWAY.kind': 'FIXED', 'm.TRANSFER.OWN_GATEWAY.amount': '1,500.25', 'm.TRANSFER.OWN_GATEWAY.currency': 'EUR' }),
      null,
      '.',
    );
    expect(en.document.rules).toEqual([{ productType: 'TRANSFER', paymentMode: 'OWN_GATEWAY', application: 'LOCAL', kind: 'FIXED', amount: { currency: 'EUR', minor: '150025' } }]);
  });

  it('flight seat/bag/penalty markups (ADR-0013): typed like the fare markup, empty = not set, only on the flight provider markup', () => {
    const { document, issues } = documentFromForm(
      formOf({
        'm.FLIGHT.PROVIDER_MANAGED.on': '1',
        'm.FLIGHT.PROVIDER_MANAGED.pct': '8',
        'm.FLIGHT.PROVIDER_MANAGED.seats': '15',
        'm.FLIGHT.PROVIDER_MANAGED.bags': '',
        'm.FLIGHT.PROVIDER_MANAGED.penalties': '0',
      }),
      base,
    );
    expect(issues).toEqual([]);
    const flight = document.rules.find((r) => r.productType === 'FLIGHT');
    expect(flight).toEqual({
      productType: 'FLIGHT',
      paymentMode: 'PROVIDER_MANAGED',
      application: 'PROVIDER_API',
      kind: 'PERCENT_OF_NET',
      basisPoints: 800,
      ancillaries: { seatsBasisPoints: 1500, bagsBasisPoints: null, penaltiesBasisPoints: 0 },
    });
    expect(pricingPolicyDocumentSchema.safeParse(document).success).toBe(true);
    expect(rowsFromDocument(document)['m.FLIGHT.PROVIDER_MANAGED']).toMatchObject({ percent: '8', seats: '15', bags: '', penalties: '0' });
    // All empty: no ancillaries object at all (the rule stays as before).
    const plain = documentFromForm(formOf({ 'm.FLIGHT.PROVIDER_MANAGED.on': '1', 'm.FLIGHT.PROVIDER_MANAGED.pct': '8' }), base).document.rules.find((r) => r.productType === 'FLIGHT');
    expect(plain).not.toHaveProperty('ancillaries');
    // A bad value is reported on its field; nothing is guessed.
    const bad = documentFromForm(formOf({ 'm.FLIGHT.PROVIDER_MANAGED.on': '1', 'm.FLIGHT.PROVIDER_MANAGED.pct': '8', 'm.FLIGHT.PROVIDER_MANAGED.bags': '12,345' }), base);
    expect(bad.issues).toEqual([{ field: 'm.FLIGHT.PROVIDER_MANAGED.bags', code: 'PERCENT' }]);
    // The schema refuses ancillaries anywhere but the flight provider markup.
    const hotelWithSeats = { ...base, rules: [{ ...base.rules[0]!, ancillaries: { seatsBasisPoints: 100, bagsBasisPoints: null, penaltiesBasisPoints: null } }] };
    expect(pricingPolicyDocumentSchema.safeParse(hotelWithSeats).success).toBe(false);
  });
});

