/**
 * ISO 4217 minor-unit exponents for currencies we may receive from suppliers or charge in.
 * An unknown code is an error: we never guess the exponent of a currency.
 */
const MINOR_UNITS: Readonly<Record<string, number>> = {
  TRY: 2, EUR: 2, USD: 2, GBP: 2, CHF: 2, SEK: 2, NOK: 2, DKK: 2, PLN: 2, CZK: 2, HUF: 2, RON: 2,
  AED: 2, SAR: 2, QAR: 2, EGP: 2, ILS: 2, MAD: 2, GEL: 2, AZN: 2, UAH: 2, RUB: 2, KZT: 2,
  KWD: 3, BHD: 3, OMR: 3, JOD: 3, TND: 3,
  JPY: 0, KRW: 0, VND: 0, ISK: 0, CLP: 0,
  CNY: 2, HKD: 2, SGD: 2, THB: 2, MYR: 2, IDR: 2, PHP: 2, INR: 2, LKR: 2, MVR: 2,
  CAD: 2, AUD: 2, NZD: 2, ZAR: 2, BRL: 2, MXN: 2, ARS: 2, COP: 2,
};

/** Currencies the UI may display (K07). Charging requires separate route + merchant verification. */
export const DISPLAY_CURRENCIES = ['TRY', 'EUR', 'USD', 'GBP'] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

export type CurrencyCode = string & { readonly __currency: unique symbol };

export class UnknownCurrencyError extends Error {
  constructor(code: string) {
    super(`Unknown or unsupported ISO 4217 currency: ${code}`);
    this.name = 'UnknownCurrencyError';
  }
}

export function currency(code: string): CurrencyCode {
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(upper) || MINOR_UNITS[upper] === undefined) throw new UnknownCurrencyError(code);
  return upper as CurrencyCode;
}

export function minorUnits(code: CurrencyCode): number {
  const units = MINOR_UNITS[code];
  if (units === undefined) throw new UnknownCurrencyError(code);
  return units;
}

export function isDisplayCurrency(code: string): code is DisplayCurrency {
  return (DISPLAY_CURRENCIES as readonly string[]).includes(code);
}
