import type { Money } from '@texholiday/pricing';
import type { FundingMethod, ProductType } from '../common';

/** How each item's supplier cost is covered; recorded separately from the customer payment. */
export interface SupplierSettlementPlanLine {
  orderItemId: string;
  providerId: string;
  productType: ProductType;
  method: FundingMethod;
  supplierCost: Money;
}

export interface SupplierSettlementPlan {
  id: string;
  lines: readonly SupplierSettlementPlanLine[];
}

/**
 * Business-approved risk policy (G06). No defaults: without an approved policy no own-gateway package
 * route opens. Limits are per charge currency in minor units.
 */
export interface RiskPolicyVersion {
  id: string;
  version: number;
  status: 'DRAFT' | 'APPROVED' | 'RETIRED';
  approvedBy: string | null;
  approvedAt: string | null;
  /** Max total supplier exposure per order before the customer charge is captured. */
  maxUncapturedSupplierExposure: Readonly<Record<string, string>>;
  /** Safety margin before authorization expiry at which an order needs human action. */
  authorizationSafetyMarginSeconds: number;
  /** If true, items whose async confirmation bound is unknown may still be sold. Default policy: false. */
  allowUnknownAsyncConfirmationBound: boolean;
  /** Ordered supplier funding preference (finance decision); methods not listed are not used. */
  fundingPreference: readonly FundingMethod[];
}

/** Remaining funding headroom per method, read from finance (account card limit, credit line). */
export interface FundingHeadroom {
  method: FundingMethod;
  providerId: string;
  available: Money | null;
}
