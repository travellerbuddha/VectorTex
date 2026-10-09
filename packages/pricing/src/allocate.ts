import { money, type Money } from './money';

export class AllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllocationError';
  }
}

/**
 * Splits `total` across `weights` with the largest-remainder method.
 * - Result sums to `total` exactly (no lost or created minor unit).
 * - Deterministic: remainder units go to the largest fractional parts; ties go to the lower index.
 * - Works for negative totals (discounts) by allocating the absolute value and negating.
 */
export function allocate(total: Money, weights: readonly bigint[]): Money[] {
  if (weights.length === 0) throw new AllocationError('No allocation targets');
  if (weights.some((w) => w < 0n)) throw new AllocationError('Weights must be non-negative');
  const weightSum = weights.reduce((a, b) => a + b, 0n);
  if (weightSum === 0n) throw new AllocationError('Weights sum to zero');

  const negative = total.minor < 0n;
  const amount = negative ? -total.minor : total.minor;

  const base = weights.map((w) => (amount * w) / weightSum);
  const remainders = weights.map((w, index) => ({ index, rem: (amount * w) % weightSum }));
  let leftover = amount - base.reduce((a, b) => a + b, 0n);

  remainders.sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
  for (const { index } of remainders) {
    if (leftover === 0n) break;
    base[index] = (base[index] as bigint) + 1n;
    leftover -= 1n;
  }

  return base.map((v) => money(total.currency, negative ? -v : v));
}

/** Allocates proportionally to existing amounts (e.g. a package discount over item sell prices). */
export function allocateProportionally(total: Money, basis: readonly Money[]): Money[] {
  for (const b of basis) {
    if (b.currency !== total.currency) throw new AllocationError(`Basis currency ${b.currency} != ${total.currency}`);
    if (b.minor < 0n) throw new AllocationError('Basis amounts must be non-negative');
  }
  return allocate(total, basis.map((b) => b.minor));
}
