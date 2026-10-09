import { describe, expect, it } from 'vitest';
import {
  PricingPolicyError,
  applySspFloor,
  chargeNowTotal,
  computeSellPrice,
  distributePackageAdjustment,
  itemRefundAmount,
  money,
  computeServiceFees,
  assertFxSnapshotAcceptable,
  pricingPolicyDocumentSchema,
  providerMarginForSearch,
  sum,
  type PricingPolicyVersion,
} from '../src/index';

// Test-only policy. Real margins/fees are business inputs (G06) and are not shipped as defaults.
const policy: PricingPolicyVersion = {
  id: 'pp-test',
  version: 3,
  status: 'APPROVED',
  approvedBy: 'finance-approver-test',
  approvedAt: '2026-10-01T00:00:00Z',
  rounding: 'HALF_EVEN',
  allowBelowSspInOpaquePackage: false,
  serviceFees: [],
  fx: null,
  rules: [
    { productType: 'HOTEL', paymentMode: 'OWN_GATEWAY', application: 'LOCAL', kind: 'PERCENT_OF_NET', basisPoints: 1000 },
    { productType: 'HOTEL', paymentMode: 'PROVIDER_MANAGED', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 1000 },
    { productType: 'TRANSFER', paymentMode: 'OWN_GATEWAY', application: 'LOCAL', kind: 'FIXED', amount: { currency: 'EUR', minor: '500' } },
  ],
};

describe('T02 net, margin, SSP', () => {
  it('own gateway: net + one local margin', () => {
    const r = computeSellPrice({
      productType: 'HOTEL',
      paymentMode: 'OWN_GATEWAY',
      providerPrice: money('EUR', 20000n),
      providerAppliedMargin: money('EUR', 0n),
      providerSupportsApiMargin: true,
      policy,
    });
    expect(r.sell).toEqual(money('EUR', 22000n));
    expect(r.providerMarginRequest).toBeNull();
  });

  it('own gateway refuses a provider price that already contains margin (no double margin)', () => {
    expect(() =>
      computeSellPrice({
        productType: 'HOTEL',
        paymentMode: 'OWN_GATEWAY',
        providerPrice: money('EUR', 22000n),
        providerAppliedMargin: money('EUR', 2000n),
        providerSupportsApiMargin: true,
        policy,
      }),
    ).toThrow(expect.objectContaining({ code: 'DOUBLE_MARGIN' }));
  });

  it('provider-managed: margin is requested from the provider, nothing added locally', () => {
    const r = computeSellPrice({
      productType: 'HOTEL',
      paymentMode: 'PROVIDER_MANAGED',
      providerPrice: money('EUR', 22000n),
      providerAppliedMargin: money('EUR', 2000n),
      providerSupportsApiMargin: true,
      policy,
    });
    expect(r.sell).toEqual(money('EUR', 22000n));
    expect(r.localMargin.minor).toBe(0n);
    expect(r.providerMarginRequest).toEqual({ basisPoints: 1000 });
  });

  it('provider-managed refuses products without a documented API margin', () => {
    expect(() =>
      computeSellPrice({
        productType: 'HOTEL',
        paymentMode: 'PROVIDER_MANAGED',
        providerPrice: money('EUR', 1n),
        providerAppliedMargin: money('EUR', 0n),
        providerSupportsApiMargin: false,
        policy,
      }),
    ).toThrow(expect.objectContaining({ code: 'MARGIN_NOT_SUPPORTED' }));
  });

  it('refuses DRAFT policies and missing rules (route stays closed)', () => {
    expect(() =>
      computeSellPrice({
        productType: 'HOTEL',
        paymentMode: 'OWN_GATEWAY',
        providerPrice: money('EUR', 1n),
        providerAppliedMargin: money('EUR', 0n),
        providerSupportsApiMargin: false,
        policy: { ...policy, status: 'DRAFT' },
      }),
    ).toThrow(PricingPolicyError);
    expect(() =>
      computeSellPrice({
        productType: 'FLIGHT',
        paymentMode: 'OWN_GATEWAY',
        providerPrice: money('EUR', 1n),
        providerAppliedMargin: money('EUR', 0n),
        providerSupportsApiMargin: false,
        policy,
      }),
    ).toThrow(expect.objectContaining({ code: 'NO_RULE' }));
  });

  describe('ADR-0006: provider API margin on our own gateway (hotel)', () => {
    const apiPolicy: PricingPolicyVersion = {
      ...policy,
      rules: [
        { productType: 'HOTEL', paymentMode: 'OWN_GATEWAY', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 100 },
        { productType: 'HOTEL', paymentMode: 'PROVIDER_MANAGED', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 1250 },
        { productType: 'EXPERIENCE', paymentMode: 'OWN_GATEWAY', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 100 },
      ],
    };
    const hotel = (paymentMode: 'OWN_GATEWAY' | 'PROVIDER_MANAGED', price: bigint, commission: bigint, p = apiPolicy) =>
      computeSellPrice({ productType: 'HOTEL', paymentMode, providerPrice: money('EUR', price), providerAppliedMargin: money('EUR', commission), providerSupportsApiMargin: true, policy: p });

    it('sells at the provider price, adds nothing locally, pays the full price and expects the commission back', () => {
      // Sandbox observation 2026-10-09: margin 1 -> offer 1396.63 EUR with commission 13.82 EUR.
      const r = hotel('OWN_GATEWAY', 139663n, 1382n);
      expect(r.application).toBe('PROVIDER_API');
      expect(r.sell).toEqual(money('EUR', 139663n));
      expect(r.localMargin.minor).toBe(0n);
      expect(r.supplierCharge).toEqual(money('EUR', 139663n));
      expect(r.providerCommission).toEqual(money('EUR', 1382n));
      expect(r.net).toEqual(money('EUR', 138281n));
      expect(r.providerMarginRequest).toEqual({ basisPoints: 100 });
    });

    it('provider-managed: the provider collects, we pay nothing and expect the commission', () => {
      const r = hotel('PROVIDER_MANAGED', 155566n, 17285n);
      expect(r.supplierCharge.minor).toBe(0n);
      expect(r.providerCommission).toEqual(money('EUR', 17285n));
    });

    it('refuses a commission that is not the margin we asked for (account default, extra markup, stale policy)', () => {
      expect(() => hotel('OWN_GATEWAY', 22000n, 2000n)).toThrow(expect.objectContaining({ code: 'MARGIN_MISMATCH' }));
      expect(() => hotel('OWN_GATEWAY', 139663n, 0n)).toThrow(expect.objectContaining({ code: 'MARGIN_MISMATCH' }));
      expect(() => hotel('OWN_GATEWAY', 100n, 200n)).toThrow(expect.objectContaining({ code: 'MARGIN_MISMATCH' }));
      const net0: PricingPolicyVersion = { ...apiPolicy, rules: [{ productType: 'HOTEL', paymentMode: 'OWN_GATEWAY', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 0 }] };
      expect(() => hotel('OWN_GATEWAY', 10000n, 1n, net0)).toThrow(expect.objectContaining({ code: 'MARGIN_MISMATCH' }));
      expect(hotel('OWN_GATEWAY', 10000n, 0n, net0).providerCommission.minor).toBe(0n);
    });

    it('tolerates the provider rounding per room and night (two rooms, 7%: 2831.72 EUR with 185.22 EUR)', () => {
      const p7: PricingPolicyVersion = { ...apiPolicy, rules: [{ productType: 'HOTEL', paymentMode: 'OWN_GATEWAY', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 700 }] };
      expect(hotel('OWN_GATEWAY', 283172n, 18522n, p7).providerCommission).toEqual(money('EUR', 18522n));
      // A tiny margin that rounds to zero on a cheap room is still the requested margin.
      const p001: PricingPolicyVersion = { ...apiPolicy, rules: [{ productType: 'HOTEL', paymentMode: 'OWN_GATEWAY', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 1 }] };
      expect(hotel('OWN_GATEWAY', 3000n, 0n, p001).sell).toEqual(money('EUR', 3000n));
    });

    it('products without a documented provider margin field cannot use it, even if misconfigured', () => {
      expect(() =>
        computeSellPrice({ productType: 'EXPERIENCE', paymentMode: 'OWN_GATEWAY', providerPrice: money('EUR', 10100n), providerAppliedMargin: money('EUR', 100n), providerSupportsApiMargin: true, policy: apiPolicy }),
      ).toThrow(expect.objectContaining({ code: 'MARGIN_NOT_SUPPORTED' }));
      expect(() =>
        computeSellPrice({ productType: 'HOTEL', paymentMode: 'OWN_GATEWAY', providerPrice: money('EUR', 10100n), providerAppliedMargin: money('EUR', 100n), providerSupportsApiMargin: false, policy: apiPolicy }),
      ).toThrow(expect.objectContaining({ code: 'MARGIN_NOT_SUPPORTED' }));
    });

    it('tells the search which margin to send: the policy value for API margins, net (null) for LOCAL', () => {
      expect(providerMarginForSearch(apiPolicy, 'HOTEL', 'OWN_GATEWAY')).toEqual({ basisPoints: 100 });
      expect(providerMarginForSearch(apiPolicy, 'HOTEL', 'PROVIDER_MANAGED')).toEqual({ basisPoints: 1250 });
      expect(providerMarginForSearch(policy, 'HOTEL', 'OWN_GATEWAY')).toBeNull();
      expect(() => providerMarginForSearch({ ...apiPolicy, status: 'DRAFT' }, 'HOTEL', 'OWN_GATEWAY')).toThrow(expect.objectContaining({ code: 'POLICY_NOT_APPROVED' }));
      expect(() => providerMarginForSearch(apiPolicy, 'TRANSFER', 'OWN_GATEWAY')).toThrow(expect.objectContaining({ code: 'NO_RULE' }));
    });
  });

  it('public and member prices never go below SSP', () => {
    const ssp = money('EUR', 25000n);
    expect(applySspFloor(money('EUR', 22000n), ssp, 'PUBLIC', policy)).toEqual({ sell: ssp, raisedToSsp: true });
    expect(applySspFloor(money('EUR', 22000n), ssp, 'MEMBER', policy)).toEqual({ sell: ssp, raisedToSsp: true });
    expect(applySspFloor(money('EUR', 22000n), ssp, 'PACKAGE_OPAQUE', policy).raisedToSsp).toBe(true);
    expect(applySspFloor(money('EUR', 22000n), ssp, 'PACKAGE_OPAQUE', { ...policy, allowBelowSspInOpaquePackage: true }).raisedToSsp).toBe(false);
  });
});

describe('package adjustments and refunds', () => {
  it('pay-at-property amounts are not charged now', () => {
    const total = chargeNowTotal(
      [
        { payNow: money('EUR', 10000n), payAtProperty: [money('EUR', 1500n)] },
        { payNow: money('EUR', 5000n), payAtProperty: [] },
      ],
      'EUR',
    );
    expect(total).toEqual(money('EUR', 15000n));
  });

  it('package discount distribution keeps item totals == package total', () => {
    const items = [money('EUR', 33333n), money('EUR', 33333n), money('EUR', 33334n)];
    const { itemTotals } = distributePackageAdjustment(items, money('EUR', -999n));
    expect(sum(itemTotals, 'EUR')).toEqual(money('EUR', 99001n));
  });

  it('T27: refunds never exceed what remains and penalties are never charged extra', () => {
    const paid = money('EUR', 10000n);
    expect(itemRefundAmount({ itemPaid: paid, alreadyRefunded: money('EUR', 0n), penaltyCharged: money('EUR', 2500n) })).toEqual(money('EUR', 7500n));
    expect(itemRefundAmount({ itemPaid: paid, alreadyRefunded: money('EUR', 7500n), penaltyCharged: money('EUR', 2500n) })).toEqual(money('EUR', 0n));
    expect(itemRefundAmount({ itemPaid: paid, alreadyRefunded: money('EUR', 0n), penaltyCharged: money('EUR', 15000n) })).toEqual(money('EUR', 0n));
    expect(() => itemRefundAmount({ itemPaid: paid, alreadyRefunded: money('EUR', 10001n), penaltyCharged: money('EUR', 0n) })).toThrow();
  });
});

describe('G06 editable fees and FX policy', () => {
  const withFees: PricingPolicyVersion = {
    ...policy,
    serviceFees: [
      { code: 'SERVICE_FEE', label: { tr: 'Hizmet bedeli', en: 'Service fee' }, scope: 'PACKAGE', kind: 'FIXED', amounts: { EUR: '500' } },
      { code: 'HOTEL_FEE', label: { tr: 'Otel', en: 'Hotel' }, scope: 'HOTEL', kind: 'PERCENT_OF_SELL', basisPoints: 150 },
    ],
    fx: { source: 'approved-source', maxRateAgeSeconds: 3600, rounding: 'HALF_UP' },
  };

  it('applies the user-configured fees for the scope and currency', () => {
    expect(computeServiceFees({ scope: 'PACKAGE', sell: money('EUR', 100000n), policy: withFees }).map((f) => [f.code, f.amount.minor])).toEqual([['SERVICE_FEE', 500n]]);
    expect(computeServiceFees({ scope: 'HOTEL', sell: money('EUR', 20000n), policy: withFees }).map((f) => f.amount.minor)).toEqual([300n]);
    expect(computeServiceFees({ scope: 'TRANSFER', sell: money('EUR', 20000n), policy: withFees })).toEqual([]);
  });

  it('a fixed fee without an amount for the charge currency closes that currency (no silent FX)', () => {
    expect(() => computeServiceFees({ scope: 'PACKAGE', sell: money('TRY', 100n), policy: withFees })).toThrow(/no fixed amount for TRY/);
  });

  it('accepts only fresh rates from the approved FX source', () => {
    const now = new Date('2026-10-09T10:00:00Z');
    expect(() => assertFxSnapshotAcceptable({ id: 'fx1', source: 'approved-source', observedAt: '2026-10-09T09:30:00Z' }, withFees, now)).not.toThrow();
    expect(() => assertFxSnapshotAcceptable({ id: 'fx2', source: 'other', observedAt: '2026-10-09T09:30:00Z' }, withFees, now)).toThrow(/approved source/);
    expect(() => assertFxSnapshotAcceptable({ id: 'fx3', source: 'approved-source', observedAt: '2026-10-09T08:00:00Z' }, withFees, now)).toThrow(/too old/);
    expect(() => assertFxSnapshotAcceptable({ id: 'fx4', source: 'approved-source', observedAt: '2026-10-09T09:30:00Z' }, policy, now)).toThrow(/not enabled/);
  });

  it('the editable document schema rejects double margins and typos', () => {
    const ok = pricingPolicyDocumentSchema.safeParse({ rounding: 'HALF_EVEN', rules: [], serviceFees: [], fx: null, allowBelowSspInOpaquePackage: false });
    expect(ok.success).toBe(true);
    const bad = pricingPolicyDocumentSchema.safeParse({
      rounding: 'HALF_EVEN',
      rules: [{ productType: 'HOTEL', paymentMode: 'OWN_GATEWAY', application: 'LOCAL', kind: 'PERCENT_OF_NET', basisPoints: 100_000 }],
      serviceFees: [{ code: 'X', label: { tr: 'a', en: 'b' }, scope: 'HOTEL', kind: 'FIXED', amounts: { XXX: '1' } }],
      fx: null,
      allowBelowSspInOpaquePackage: false,
    });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues.map((i) => i.path.join('.'))).toEqual(expect.arrayContaining(['rules.0.basisPoints', 'serviceFees.0.amounts.XXX']));
  });

  it('ADR-0006: an own-gateway API margin is accepted only for products whose provider documents a margin field', () => {
    const doc = (productType: 'HOTEL' | 'FLIGHT' | 'EXPERIENCE' | 'TRANSFER') =>
      pricingPolicyDocumentSchema.safeParse({
        rounding: 'HALF_EVEN',
        rules: [{ productType, paymentMode: 'OWN_GATEWAY', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 1250 }],
        serviceFees: [],
        fx: null,
        allowBelowSspInOpaquePackage: false,
      });
    expect(doc('HOTEL').success).toBe(true);
    expect(doc('FLIGHT').success).toBe(true);
    for (const p of ['EXPERIENCE', 'TRANSFER'] as const) {
      const r = doc(p);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]!.message).toMatch(/must be LOCAL/);
    }
    // A fixed amount can never be a provider API margin.
    expect(
      pricingPolicyDocumentSchema.safeParse({
        rounding: 'HALF_EVEN',
        rules: [{ productType: 'HOTEL', paymentMode: 'OWN_GATEWAY', application: 'PROVIDER_API', kind: 'FIXED', amount: { currency: 'EUR', minor: '500' } }],
        serviceFees: [],
        fx: null,
        allowBelowSspInOpaquePackage: false,
      }).success,
    ).toBe(false);
  });
});
