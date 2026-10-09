import { describe, expect, it } from 'vitest';
import { riskPolicyDocumentSchema, type RiskPolicyDocument } from '@texholiday/contracts';
import { exposureCurrencies, hoursToSeconds, riskDocumentFromForm, riskFormFromDocument, secondsToHours } from '../src/index';

const base: RiskPolicyDocument = {
  maxUncapturedSupplierExposure: { EUR: '5000000', JPY: '900000' },
  authorizationSafetyMarginSeconds: 5400,
  allowUnknownAsyncConfirmationBound: false,
  fundingPreference: ['CREDIT_LINE', 'ACCOUNT_CARD'],
};

const formOf = (fields: Record<string, string>) => (name: string) => fields[name] ?? null;

describe('risk policy editor (G06)', () => {
  it('hours <-> seconds is exact and bounded by the schema (30 days)', () => {
    expect(hoursToSeconds('24')).toBe(86_400);
    expect(hoursToSeconds('1,5')).toBe(5400);
    expect(hoursToSeconds('0.25')).toBe(900);
    expect(hoursToSeconds('0')).toBe(0);
    expect(hoursToSeconds('720')).toBe(2_592_000);
    for (const bad of ['', '-1', '720,01', '1,234', 'abc', '1e2', '24h']) expect(hoursToSeconds(bad)).toBeNull();
    expect(secondsToHours(5400)).toBe('1,5');
    expect(secondsToHours(5400, '.')).toBe('1.5');
    expect(secondsToHours(86_400)).toBe('24');
  });

  it('the form shows stored values; currencies without a limit stay empty, other stored currencies are kept', () => {
    expect(exposureCurrencies(base)).toEqual(['TRY', 'EUR', 'USD', 'GBP', 'JPY']);
    const form = riskFormFromDocument(base);
    expect(form.exposures).toEqual({ TRY: '', EUR: '50000,00', USD: '', GBP: '', JPY: '900000' });
    expect(form).toMatchObject({ marginHours: '1,5', allowUnknownAsync: false, funding: ['CREDIT_LINE', 'ACCOUNT_CARD'] });
    expect(riskFormFromDocument(null)).toMatchObject({ marginHours: '', allowUnknownAsync: false, funding: [] });
  });

  it('the form builds a valid document in the panel language', () => {
    const { document, issues } = riskDocumentFromForm(
      formOf({ 'exp.EUR': '75.000', 'exp.TRY': '2.500.000,50', 'exp.JPY': '', 'margin.hours': '48', 'async.allowUnknown': '1', 'fund.1': 'ACCOUNT_CARD' }),
      base,
      ',',
    );
    expect(issues).toEqual([]);
    expect(document).toEqual({
      maxUncapturedSupplierExposure: { TRY: '250000050', EUR: '7500000' },
      authorizationSafetyMarginSeconds: 172_800,
      allowUnknownAsyncConfirmationBound: true,
      fundingPreference: ['ACCOUNT_CARD'],
    });
    expect(riskPolicyDocumentSchema.safeParse(document).success).toBe(true);
  });

  it('invalid input is reported per field, never turned into a guessed value', () => {
    expect(
      riskDocumentFromForm(formOf({ 'exp.EUR': '12.50', 'exp.USD': '-5', 'margin.hours': '', 'fund.1': 'CASH', 'fund.2': '' }), null, ',').issues,
    ).toEqual([
      { field: 'exp.EUR', code: 'EXPOSURE' },
      { field: 'exp.USD', code: 'EXPOSURE' },
      { field: 'margin.hours', code: 'MARGIN' },
      { field: 'fund.1', code: 'FUNDING_UNKNOWN' },
    ]);
    expect(riskDocumentFromForm(formOf({ 'margin.hours': '1', 'fund.1': 'CREDIT_LINE', 'fund.2': 'CREDIT_LINE' }), null).issues).toEqual([
      { field: 'fund.2', code: 'FUNDING_DUPLICATE' },
    ]);
    expect(riskDocumentFromForm(formOf({ 'margin.hours': '1' }), null).issues).toEqual([{ field: 'fund', code: 'FUNDING_EMPTY' }]);
  });
});
