import { describe, expect, it } from 'vitest';
import {
  PricingPolicyError,
  applySspFloor,
  chargeNowTotal,
  computeSellPrice,
  distributePackageAdjustment,
  itemRefundAmount,
  money,
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
