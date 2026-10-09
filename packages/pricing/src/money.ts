import Decimal from 'decimal.js';
import { currency as toCurrency, minorUnits, type CurrencyCode } from './currency';

/** Isolated Decimal constructor: high precision, never touched by other modules' global config. */
export const D = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_EVEN, toExpNeg: -30, toExpPos: 40 });
export type DecimalValue = InstanceType<typeof D>;

export type RoundingMode = 'HALF_EVEN' | 'HALF_UP' | 'HALF_DOWN' | 'UP' | 'DOWN' | 'CEIL' | 'FLOOR';

const ROUNDING: Record<RoundingMode, Decimal.Rounding> = {
  HALF_EVEN: Decimal.ROUND_HALF_EVEN,
  HALF_UP: Decimal.ROUND_HALF_UP,
  HALF_DOWN: Decimal.ROUND_HALF_DOWN,
  UP: Decimal.ROUND_UP,
  DOWN: Decimal.ROUND_DOWN,
  CEIL: Decimal.ROUND_CEIL,
  FLOOR: Decimal.ROUND_FLOOR,
};

/** Money is an ISO currency + integer amount in minor units. Never a JS number. */
export interface Money {
  readonly currency: CurrencyCode;
  readonly minor: bigint;
}

/** Wire/DB representation: minor units as an integer string. */
export interface MoneyJson {
  currency: string;
  minor: string;
}

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`Currency mismatch: ${a} vs ${b}`);
    this.name = 'CurrencyMismatchError';
  }
}

export class PrecisionLossError extends Error {
  constructor(value: string, code: string) {
    super(`Amount ${value} has more precision than ${code} allows and no rounding mode was given`);
    this.name = 'PrecisionLossError';
  }
}

export class InvalidAmountError extends Error {
  constructor(value: unknown) {
    super(`Invalid monetary amount: ${String(value)}`);
    this.name = 'InvalidAmountError';
  }
}

export function money(code: string | CurrencyCode, minor: bigint | string): Money {
  const cur = toCurrency(code);
  if (typeof minor === 'string') {
    if (!/^-?\d+$/.test(minor)) throw new InvalidAmountError(minor);
    return Object.freeze({ currency: cur, minor: BigInt(minor) });
  }
  return Object.freeze({ currency: cur, minor });
}

export const zero = (code: string | CurrencyCode): Money => money(code, 0n);

/**
 * Parses a decimal major-unit string (as suppliers send it, e.g. "123.45").
 * JS numbers are refused on purpose: they may already have lost precision.
 * Extra precision is an error unless an explicit, approved rounding mode is supplied.
 */
export function fromMajor(value: string, code: string | CurrencyCode, rounding?: RoundingMode): Money {
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value.trim())) throw new InvalidAmountError(value);
  const cur = toCurrency(code);
  const exp = minorUnits(cur);
  const scaled = new D(value.trim()).times(new D(10).pow(exp));
  if (!scaled.isInteger()) {
    if (!rounding) throw new PrecisionLossError(value, cur);
    return money(cur, BigInt(scaled.toDecimalPlaces(0, ROUNDING[rounding]).toFixed(0)));
  }
  return money(cur, BigInt(scaled.toFixed(0)));
}

/** Exact major-unit string with the currency's exponent, e.g. 12345n EUR -> "123.45". */
export function toMajor(m: Money): string {
  const exp = minorUnits(m.currency);
  return new D(m.minor.toString()).div(new D(10).pow(exp)).toFixed(exp);
}

export function toDecimal(m: Money): DecimalValue {
  return new D(m.minor.toString()).div(new D(10).pow(minorUnits(m.currency)));
}

function assertSame(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export const add = (a: Money, b: Money): Money => (assertSame(a, b), money(a.currency, a.minor + b.minor));
export const subtract = (a: Money, b: Money): Money => (assertSame(a, b), money(a.currency, a.minor - b.minor));
export const negate = (a: Money): Money => money(a.currency, -a.minor);
export const isZero = (a: Money): boolean => a.minor === 0n;
export const isNegative = (a: Money): boolean => a.minor < 0n;
export const equals = (a: Money, b: Money): boolean => a.currency === b.currency && a.minor === b.minor;

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSame(a, b);
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}

export const max = (a: Money, b: Money): Money => (compare(a, b) >= 0 ? a : b);
export const min = (a: Money, b: Money): Money => (compare(a, b) <= 0 ? a : b);

export function sum(items: readonly Money[], code: string | CurrencyCode): Money {
  return items.reduce((acc, m) => add(acc, m), zero(code));
}

/** Multiplies by an exact decimal factor (string) and rounds once with an explicit mode. */
export function multiply(m: Money, factor: string, rounding: RoundingMode): Money {
  if (!/^-?\d+(\.\d+)?$/.test(factor)) throw new InvalidAmountError(factor);
  const result = new D(m.minor.toString()).times(new D(factor)).toDecimalPlaces(0, ROUNDING[rounding]);
  return money(m.currency, BigInt(result.toFixed(0)));
}

/** Percentage expressed in basis points (1 bp = 0.01%). Integer only; no float percentages. */
export function percentOf(m: Money, basisPoints: bigint, rounding: RoundingMode): Money {
  const result = new D(m.minor.toString()).times(basisPoints.toString()).div(10_000).toDecimalPlaces(0, ROUNDING[rounding]);
  return money(m.currency, BigInt(result.toFixed(0)));
}

export const toJson = (m: Money): MoneyJson => ({ currency: m.currency, minor: m.minor.toString() });
export const fromJson = (j: MoneyJson): Money => money(j.currency, j.minor);

export function roundingFor(mode: RoundingMode): Decimal.Rounding {
  return ROUNDING[mode];
}
