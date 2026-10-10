import { describe, expect, it } from 'vitest';
import {
  CurrencyMismatchError,
  InvalidAmountError,
  PrecisionLossError,
  UnknownCurrencyError,
  add,
  allocate,
  allocateProportionally,
  convert,
  fromMajor,
  money,
  multiply,
  percentOf,
  sum,
  toJson,
  toMajor,
  fromJson,
} from '../src/index';

describe('T01 Money / FX / rounding', () => {
  it('parses supplier decimal strings exactly (no float drift)', () => {
    const a = fromMajor('0.1', 'EUR');
    const b = fromMajor('0.2', 'EUR');
    expect(toMajor(add(a, b))).toBe('0.30');
    expect(fromMajor('1234567890123.45', 'TRY').minor).toBe(123456789012345n);
  });

  it('respects currency exponents', () => {
    expect(fromMajor('1500', 'JPY').minor).toBe(1500n);
    expect(toMajor(fromMajor('1.234', 'KWD'))).toBe('1.234');
    expect(() => fromMajor('1.5', 'JPY')).toThrow(PrecisionLossError);
  });

  it('refuses silent precision loss but rounds with an explicit mode', () => {
    expect(() => fromMajor('10.005', 'EUR')).toThrow(PrecisionLossError);
    expect(fromMajor('10.005', 'EUR', 'HALF_EVEN').minor).toBe(1000n);
    expect(fromMajor('10.015', 'EUR', 'HALF_EVEN').minor).toBe(1002n);
    expect(fromMajor('10.005', 'EUR', 'HALF_UP').minor).toBe(1001n);
  });

  it('rejects numbers, junk and unknown currencies', () => {
    expect(() => fromMajor(12.5 as unknown as string, 'EUR')).toThrow(InvalidAmountError);
    expect(() => fromMajor('1e3', 'EUR')).toThrow(InvalidAmountError);
    expect(() => money('XXX', 1n)).toThrow(UnknownCurrencyError);
    expect(() => money('EUR', '1.5')).toThrow(InvalidAmountError);
  });

  it('never mixes currencies', () => {
    expect(() => add(money('EUR', 1n), money('TRY', 1n))).toThrow(CurrencyMismatchError);
  });

  it('round-trips JSON as integer strings', () => {
    const m = money('GBP', 987654321987654321n);
    expect(toJson(m)).toEqual({ currency: 'GBP', minor: '987654321987654321' });
    expect(fromJson(toJson(m))).toEqual(m);
  });

  it('converts with a frozen FX snapshot and an explicit rounding mode', () => {
    const snap = { id: 'fx-1', base: 'EUR', quote: 'TRY', rate: '37.4512', source: 'approved-source', observedAt: '2026-10-09T08:00:00Z' };
    expect(convert(money('EUR', 10000n), snap, 'HALF_EVEN')).toEqual(money('TRY', 374512n));
    expect(convert(money('EUR', 1n), snap, 'HALF_EVEN')).toEqual(money('TRY', 37n));
    expect(() => convert(money('USD', 1n), snap, 'HALF_EVEN')).toThrow();
  });

  it('percentages use integer basis points', () => {
    expect(percentOf(money('EUR', 10001n), 1250n, 'HALF_EVEN')).toEqual(money('EUR', 1250n));
    expect(multiply(money('EUR', 999n), '0.5', 'HALF_UP')).toEqual(money('EUR', 500n));
  });
});

describe('T01 allocation: item totals equal the order total exactly', () => {
  it('splits 100.00 three ways deterministically', () => {
    const parts = allocate(money('EUR', 10000n), [1n, 1n, 1n]);
    expect(parts.map((p) => p.minor)).toEqual([3334n, 3333n, 3333n]);
  });

  it('allocates negative discounts without losing a kuruş', () => {
    const parts = allocateProportionally(money('TRY', -1001n), [money('TRY', 33333n), money('TRY', 33333n), money('TRY', 33334n)]);
    expect(sum(parts, 'TRY')).toEqual(money('TRY', -1001n));
    expect(parts.every((p) => p.minor <= 0n)).toBe(true);
  });

  it('property: for random inputs the sum is exact and every share is within 1 unit of ideal', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed);
    for (let run = 0; run < 500; run += 1) {
      const n = (rnd() % 6) + 1;
      const weights: bigint[] = Array.from({ length: n }, () => BigInt(rnd() % 100000));
      if (!weights.some((w) => w !== 0n)) weights[0] = 1n;
      const total = money('EUR', BigInt(rnd() % 10_000_000) - 5_000_000n);
      const parts = allocate(total, weights);
      expect(sum(parts, 'EUR')).toEqual(total);
      const wsum = weights.reduce((a, b) => a + b, 0n);
      parts.forEach((p, i) => {
        const ideal = (total.minor * (weights[i] as bigint)) / wsum;
        const diff = p.minor - ideal;
        expect(diff >= -1n && diff <= 1n).toBe(true);
      });
    }
  });

  it('is stable for identical input (same result twice)', () => {
    const w = [5n, 3n, 2n, 7n];
    expect(allocate(money('USD', 12345n), w)).toEqual(allocate(money('USD', 12345n), w));
  });
});
