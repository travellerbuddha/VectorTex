import { describe, expect, it } from 'vitest';
import { csvAmount, financeCsv, financePeriod, type FinanceCsvRow } from '../src/finance';

/** Finance CSV and period rules (P15b), without a database. */
const line = (over: Partial<FinanceCsvRow> = {}): FinanceCsvRow => ({
  orderId: '0b0e8f4e-0000-4000-8000-000000000001',
  createdAt: '2026-10-10T08:00:00.000Z',
  orderStatus: 'CONFIRMED',
  position: 0,
  productType: 'HOTEL',
  providerId: 'nuitee',
  fundingMethod: 'PROVIDER_MANAGED',
  bookingStatus: 'CONFIRMED',
  providerBookingRef: 'ABC123',
  charge: { currency: 'EUR', minor: '29700' },
  supplierPrice: { currency: 'EUR', minor: '29700' },
  commission: { currency: 'EUR', minor: '2700' },
  commissionStatus: 'EXPECTED',
  refunded: null,
  paymentStatus: 'CAPTURED',
  ...over,
});

describe('finance CSV', () => {
  it('amounts are exact decimals in each currency’s own minor units', () => {
    expect(csvAmount({ currency: 'EUR', minor: '29700' })).toBe('297.00');
    expect(csvAmount({ currency: 'JPY', minor: '29700' })).toBe('29700');
    expect(csvAmount({ currency: 'KWD', minor: '1' })).toBe('0.001');
    expect(csvAmount({ currency: 'TRY', minor: '123456789012345678' })).toBe('1234567890123456.78');
    expect(csvAmount(null)).toBe('');
  });

  it('quotes cells and keeps provider text from becoming a spreadsheet formula', () => {
    const csv = financeCsv([line({ providerBookingRef: '=HYPERLINK("x","y")' }), line({ providerBookingRef: '-12', refunded: { currency: 'EUR', minor: '-500' } })]);
    const rows = csv.trim().split('\r\n');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain(`,"'=HYPERLINK(""x"",""y"")",EUR,297.00,EUR,297.00,EUR,27.00,EXPECTED,,,CAPTURED`);
    // Numbers (also negative) stay numbers.
    expect(rows[2]).toContain(',-12,EUR,297.00,');
    expect(rows[2]).toContain(',EUR,-5.00,CAPTURED');
  });

  it('periods: real calendar dates, start not after end, at most 366 days', () => {
    expect(financePeriod('2028-02-29', '2028-02-29')).toEqual({ from: '2028-02-29', to: '2028-02-29' });
    expect(() => financePeriod('2027-02-29', '2027-03-01')).toThrow();
    expect(() => financePeriod('2027-1-01', '2027-01-02')).toThrow();
    expect(financePeriod('2026-01-01', '2027-01-01').to).toBe('2027-01-01'); // 366 days, both ends included
    expect(() => financePeriod('2026-01-01', '2027-01-02')).toThrow(/366/);
    expect(financePeriod('2028-01-01', '2028-12-31')).toEqual({ from: '2028-01-01', to: '2028-12-31' }); // leap year: 366 days
  });
});
