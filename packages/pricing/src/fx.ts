import { currency, minorUnits } from './currency';
import { D, money, roundingFor, type Money, type RoundingMode } from './money';

/**
 * A frozen exchange-rate observation. The source and timestamp are stored with every quote that
 * uses it; the FX source itself is a business input (G06) and is never defaulted here.
 */
export interface FxRateSnapshot {
  id: string;
  base: string;
  quote: string;
  /** Units of `quote` per 1 unit of `base`, as an exact decimal string. */
  rate: string;
  source: string;
  observedAt: string;
}

export class FxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FxError';
  }
}

export function convert(m: Money, snapshot: FxRateSnapshot, rounding: RoundingMode): Money {
  const base = currency(snapshot.base);
  const quote = currency(snapshot.quote);
  if (m.currency !== base) throw new FxError(`Snapshot ${snapshot.id} converts ${base}, got ${m.currency}`);
  if (!/^\d+(\.\d+)?$/.test(snapshot.rate) || new D(snapshot.rate).lte(0)) throw new FxError(`Invalid rate in ${snapshot.id}`);
  const major = new D(m.minor.toString()).div(new D(10).pow(minorUnits(base)));
  const quoteMinor = major.times(snapshot.rate).times(new D(10).pow(minorUnits(quote)));
  return money(quote, BigInt(quoteMinor.toDecimalPlaces(0, roundingFor(rounding)).toFixed(0)));
}
