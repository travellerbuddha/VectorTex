import { allocateProportionally } from './allocate';
import { add, compare, fromJson, max, money, percentOf, subtract, sum, zero, type Money, type MoneyJson, type RoundingMode } from './money';

export type ProductType = 'HOTEL' | 'FLIGHT' | 'EXPERIENCE' | 'TRANSFER';
export type PaymentMode = 'OWN_GATEWAY' | 'PROVIDER_MANAGED';

/**
 * Where the margin is applied (ADR-0006).
 * LOCAL: we buy at net (provider margin 0) and add our own margin.
 * PROVIDER_API: the provider adds the margin we pass in its documented request field and reports it as
 * commission; we add nothing. The commission is paid out by the provider later, also when we collect the
 * customer payment ourselves and the provider charges our account card the full price.
 */
export type MarginApplication = 'LOCAL' | 'PROVIDER_API';

/**
 * Products whose provider contract documents a request margin field (hotel and flight rate searches).
 * Experiences and transfers document none, so their margin can only be LOCAL (spec §6: no invented markup field).
 */
export const API_MARGIN_PRODUCT_TYPES: readonly ProductType[] = ['HOTEL', 'FLIGHT'];

/**
 * Rounding slack between the margin we requested and the commission the provider reports, in basis points of
 * the net price (the provider rounds per room/night). Largest deviation seen in sandbox on 2026-10-09: 0.15 bp.
 * A bigger gap means another margin was applied (account default, extra markup, policy changed since search).
 */
const PROVIDER_MARGIN_TOLERANCE_BP = 5n;

export type MarginRule =
  | { productType: ProductType; paymentMode: PaymentMode; application: MarginApplication; kind: 'PERCENT_OF_NET'; basisPoints: number }
  | { productType: ProductType; paymentMode: PaymentMode; application: 'LOCAL'; kind: 'FIXED'; amount: MoneyJson };

/**
 * A versioned, business-approved pricing policy. Margin, fees, rounding and FX source are business
 * inputs (G06): there is no built-in default policy and DRAFT policies cannot price a sale.
 */
export interface PricingPolicyVersion {
  id: string;
  version: number;
  status: 'DRAFT' | 'APPROVED' | 'RETIRED';
  approvedBy: string | null;
  approvedAt: string | null;
  rounding: RoundingMode;
  rules: readonly MarginRule[];
  /** Service fees collected by TexHoliday on top of the sell price (own gateway only). */
  serviceFees: readonly ServiceFeeRule[];
  /** Exchange-rate policy for converting supplier currency to the charge currency; null = no conversion allowed. */
  fx: FxPolicy | null;
  /** Whether opaque packages may undercut a supplier's suggested selling price. Defaults to false. */
  allowBelowSspInOpaquePackage: boolean;
  /**
   * ADR-0009: whether public provider-managed offers below the suggested selling price are shown (true) or hidden
   * (false/absent). Own-gateway prices are still raised to the SSP (`applySspFloor`).
   */
  allowBelowSspProviderManaged?: boolean;
}

/** A fee line shown to the customer. Fees exist only where we collect the money (OWN_GATEWAY). */
export type ServiceFeeRule =
  | { code: string; label: { tr: string; en: string }; scope: ProductType | 'PACKAGE'; kind: 'PERCENT_OF_SELL'; basisPoints: number }
  | { code: string; label: { tr: string; en: string }; scope: ProductType | 'PACKAGE'; kind: 'FIXED'; amounts: Readonly<Record<string, string>> };

export interface FxPolicy {
  /** Name of the approved rate source; snapshots from any other source are refused. */
  source: string;
  /** Oldest acceptable rate observation at quote time. */
  maxRateAgeSeconds: number;
  rounding: RoundingMode;
}

export class PricingPolicyError extends Error {
  readonly code: 'POLICY_NOT_APPROVED' | 'NO_RULE' | 'AMBIGUOUS_RULE' | 'DOUBLE_MARGIN' | 'MARGIN_NOT_SUPPORTED' | 'MARGIN_MISMATCH' | 'INVALID_RULE';
  constructor(code: PricingPolicyError['code'], message: string) {
    super(message);
    this.name = 'PricingPolicyError';
    this.code = code;
  }
}

export interface SellPriceInput {
  productType: ProductType;
  paymentMode: PaymentMode;
  /** Price the provider returned. For LOCAL it must be a net (margin 0) price; for PROVIDER_API it includes the commission. */
  providerPrice: Money;
  /** Margin already applied by the provider to `providerPrice`, if any (minor units). */
  providerAppliedMargin: Money;
  /** Whether this product's API documents a margin field (from the capability registry). */
  providerSupportsApiMargin: boolean;
  policy: PricingPolicyVersion;
}

export interface SellPrice {
  net: Money;
  localMargin: Money;
  /** Margin value we ask the provider to apply (PROVIDER_API only); never added locally. */
  providerMarginRequest: { basisPoints: number } | null;
  /** Commission the provider added at our request and pays out to us later (PROVIDER_API); zero for LOCAL. */
  providerCommission: Money;
  /**
   * What the provider charges our funding method (account card / credit line). With PROVIDER_API on our own
   * gateway this is the full price including the commission; zero when the provider collects from the customer.
   */
  supplierCharge: Money;
  sell: Money;
  application: MarginApplication;
  policyId: string;
  policyVersion: number;
}

export function assertApproved(policy: PricingPolicyVersion): void {
  if (policy.status !== 'APPROVED' || !policy.approvedBy || !policy.approvedAt) {
    throw new PricingPolicyError('POLICY_NOT_APPROVED', `Pricing policy ${policy.id} v${policy.version} is not approved`);
  }
}

function findRule(policy: PricingPolicyVersion, productType: ProductType, paymentMode: PaymentMode): MarginRule {
  const rules = policy.rules.filter((r) => r.productType === productType && r.paymentMode === paymentMode);
  if (rules.length === 0) throw new PricingPolicyError('NO_RULE', `No approved margin rule for ${productType}/${paymentMode}`);
  if (rules.length > 1) throw new PricingPolicyError('AMBIGUOUS_RULE', `Multiple margin rules for ${productType}/${paymentMode}`);
  return rules[0] as MarginRule;
}

/** Margin to send with a provider search/rate request for this route; null = the route prices locally (send 0). */
export function providerMarginForSearch(policy: PricingPolicyVersion, productType: ProductType, paymentMode: PaymentMode): { basisPoints: number } | null {
  assertApproved(policy);
  const rule = findRule(policy, productType, paymentMode);
  return rule.application === 'PROVIDER_API' && rule.kind === 'PERCENT_OF_NET' ? { basisPoints: rule.basisPoints } : null;
}

/** The commission the provider reports must be the margin we asked for (within rounding), never another one. */
function assertProviderMarginMatches(price: Money, applied: Money, basisPoints: number): void {
  if (applied.currency !== price.currency || applied.minor < 0n || applied.minor > price.minor) {
    throw new PricingPolicyError('MARGIN_MISMATCH', 'Provider commission is not a part of the provider price');
  }
  const net = price.minor - applied.minor;
  const bp = BigInt(basisPoints);
  if (bp === 0n) {
    if (applied.minor !== 0n) throw new PricingPolicyError('MARGIN_MISMATCH', 'Requested a net rate but the provider added a commission');
    return;
  }
  const deviation = applied.minor * 10_000n - net * bp;
  const allowed = net * PROVIDER_MARGIN_TOLERANCE_BP > 10_000n ? net * PROVIDER_MARGIN_TOLERANCE_BP : 10_000n;
  if (deviation > allowed || -deviation > allowed) {
    throw new PricingPolicyError('MARGIN_MISMATCH', `Provider commission does not match the requested ${basisPoints} bp margin`);
  }
}

/**
 * Computes the customer sell price with exactly one margin layer (T02).
 * - LOCAL (own gateway only): net provider price + one local margin.
 * - PROVIDER_API: the provider applied our margin (reported as commission); nothing is added locally.
 *   On our own gateway the provider charges our funding the full price and pays the commission out later
 *   (ADR-0006); in the provider-managed flow the provider collects from the customer.
 */
export function computeSellPrice(input: SellPriceInput): SellPrice {
  const { policy, providerPrice, providerAppliedMargin } = input;
  assertApproved(policy);
  const rule = findRule(policy, input.productType, input.paymentMode);
  if (rule.kind === 'PERCENT_OF_NET' && (!Number.isInteger(rule.basisPoints) || rule.basisPoints < 0)) {
    throw new PricingPolicyError('INVALID_RULE', 'basisPoints must be a non-negative integer');
  }
  const zeroMoney = zero(providerPrice.currency);

  if (rule.application === 'LOCAL') {
    if (input.paymentMode !== 'OWN_GATEWAY') throw new PricingPolicyError('INVALID_RULE', 'PROVIDER_MANAGED pricing must use the provider API margin');
    if (providerAppliedMargin.minor !== 0n) {
      throw new PricingPolicyError('DOUBLE_MARGIN', 'A LOCAL margin requires a net provider price (provider margin must be 0)');
    }
    const localMargin =
      rule.kind === 'FIXED' ? fromJson(rule.amount) : percentOf(providerPrice, BigInt(rule.basisPoints), policy.rounding);
    return {
      net: providerPrice,
      localMargin,
      providerMarginRequest: null,
      providerCommission: zeroMoney,
      supplierCharge: providerPrice,
      sell: add(providerPrice, localMargin),
      application: 'LOCAL',
      policyId: policy.id,
      policyVersion: policy.version,
    };
  }

  if (rule.kind !== 'PERCENT_OF_NET') throw new PricingPolicyError('INVALID_RULE', 'A provider API margin is a percentage of net');
  if (!input.providerSupportsApiMargin || !API_MARGIN_PRODUCT_TYPES.includes(input.productType)) {
    throw new PricingPolicyError('MARGIN_NOT_SUPPORTED', `${input.productType} provider API margin is not documented/enabled`);
  }
  assertProviderMarginMatches(providerPrice, providerAppliedMargin, rule.basisPoints);
  return {
    net: subtract(providerPrice, providerAppliedMargin),
    localMargin: zeroMoney,
    providerMarginRequest: { basisPoints: rule.basisPoints },
    providerCommission: providerAppliedMargin,
    supplierCharge: input.paymentMode === 'OWN_GATEWAY' ? providerPrice : zeroMoney,
    sell: providerPrice,
    application: 'PROVIDER_API',
    policyId: policy.id,
    policyVersion: policy.version,
  };
}

export type PriceExposure = 'PUBLIC' | 'MEMBER' | 'PACKAGE_OPAQUE';

/**
 * Applies a supplier's suggested selling price (SSP) floor. Logged-in members are not exempt;
 * opaque packages are exempt only if the approved policy explicitly allows it.
 */
export function applySspFloor(
  sell: Money,
  ssp: Money | null,
  exposure: PriceExposure,
  policy: PricingPolicyVersion,
): { sell: Money; raisedToSsp: boolean } {
  if (!ssp) return { sell, raisedToSsp: false };
  if (exposure === 'PACKAGE_OPAQUE' && policy.allowBelowSspInOpaquePackage) return { sell, raisedToSsp: false };
  const floored = max(sell, ssp);
  return { sell: floored, raisedToSsp: compare(floored, sell) !== 0 };
}

export interface ChargeBreakdown {
  /** Collected now through the selected payment route. */
  payNow: Money;
  /** Paid by the guest at the property/supplier; never added to payNow. Can be another currency. */
  payAtProperty: readonly Money[];
}

export function chargeNowTotal(items: readonly ChargeBreakdown[], chargeCurrency: string): Money {
  return sum(
    items.map((i) => i.payNow),
    chargeCurrency,
  );
}

/**
 * Distributes a package-level adjustment (discount negative, fee positive) across item sell prices,
 * returning per-item adjusted amounts that sum exactly to the package total.
 */
export function distributePackageAdjustment(itemSell: readonly Money[], adjustment: Money): { allocated: Money[]; itemTotals: Money[] } {
  const allocated = allocateProportionally(adjustment, itemSell);
  const itemTotals = itemSell.map((s, i) => add(s, allocated[i] as Money));
  if (itemTotals.some((t) => t.minor < 0n)) throw new PricingPolicyError('INVALID_RULE', 'Adjustment makes an item negative');
  return { allocated, itemTotals };
}

export class RefundComputationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefundComputationError';
  }
}

/**
 * Customer refund for one item: what the customer paid for it (recorded allocation, including its
 * share of discounts/fees) minus the actual supplier penalty, minus anything already refunded.
 * Never negative; never more than what remains (no double refund, T27).
 */
export function itemRefundAmount(args: { itemPaid: Money; alreadyRefunded: Money; penaltyCharged: Money }): Money {
  const { itemPaid, alreadyRefunded, penaltyCharged } = args;
  const remaining = subtract(itemPaid, alreadyRefunded);
  if (remaining.minor < 0n) throw new RefundComputationError('Recorded refunds exceed the amount paid for the item');
  const due = subtract(remaining, penaltyCharged);
  return due.minor <= 0n ? money(itemPaid.currency, 0n) : due;
}

/**
 * Service fees for one product (or a whole package) on the own-gateway route. A FIXED fee without an amount
 * for the charge currency cannot price that currency (route stays closed rather than guessing a conversion).
 */
export function computeServiceFees(args: { scope: ProductType | 'PACKAGE'; sell: Money; policy: PricingPolicyVersion }): Array<{ code: string; label: { tr: string; en: string }; amount: Money }> {
  assertApproved(args.policy);
  return args.policy.serviceFees
    .filter((f) => f.scope === args.scope)
    .map((f) => {
      if (f.kind === 'PERCENT_OF_SELL') return { code: f.code, label: f.label, amount: percentOf(args.sell, BigInt(f.basisPoints), args.policy.rounding) };
      const minorAmount = f.amounts[args.sell.currency];
      if (minorAmount === undefined) {
        throw new PricingPolicyError('NO_RULE', `Fee ${f.code} has no fixed amount for ${args.sell.currency}`);
      }
      return { code: f.code, label: f.label, amount: money(args.sell.currency, minorAmount) };
    });
}

/** An FX snapshot may be used only if it comes from the approved source and is fresh enough. */
export function assertFxSnapshotAcceptable(snapshot: { source: string; observedAt: string; id: string }, policy: PricingPolicyVersion, now: Date): FxPolicy {
  assertApproved(policy);
  if (!policy.fx) throw new PricingPolicyError('NO_RULE', 'Currency conversion is not enabled by the approved pricing policy');
  if (snapshot.source !== policy.fx.source) throw new PricingPolicyError('INVALID_RULE', `FX snapshot ${snapshot.id} is not from the approved source`);
  const age = (now.getTime() - new Date(snapshot.observedAt).getTime()) / 1000;
  if (!(age >= 0) || age > policy.fx.maxRateAgeSeconds) throw new PricingPolicyError('INVALID_RULE', `FX snapshot ${snapshot.id} is too old`);
  return policy.fx;
}
