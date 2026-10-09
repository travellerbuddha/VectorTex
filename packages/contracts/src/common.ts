import type { Money } from '@texholiday/pricing';

export type ProductType = 'HOTEL' | 'FLIGHT' | 'EXPERIENCE' | 'TRANSFER';
export const PRODUCT_TYPES: readonly ProductType[] = ['HOTEL', 'FLIGHT', 'EXPERIENCE', 'TRANSFER'];

export type PaymentMode = 'OWN_GATEWAY' | 'PROVIDER_MANAGED';
export type FundingMethod = 'ACCOUNT_CARD' | 'CREDIT_LINE' | 'PROVIDER_MANAGED';
export type ProviderEnvironment = 'mock' | 'sandbox' | 'production';

export type ProviderId = 'nuitee' | 'welcome_pickups' | (string & {});

export type PaymentRoute =
  | {
      mode: 'OWN_GATEWAY';
      gatewayId: string;
      currency: string;
      settlementPlanId: string;
      policyVersion: string;
    }
  | {
      mode: 'PROVIDER_MANAGED';
      providerId: string;
      productType: ProductType;
      currency: string;
      policyVersion: string;
    };

/** Opaque value that only the issuing provider understands. Never parsed, never edited. */
export type OpaqueRef = string & { readonly __opaque: unique symbol };
export const opaque = (value: string): OpaqueRef => value as OpaqueRef;

/**
 * Payment reference issued by a provider-managed payment flow (e.g. Nuitee prebook transactionId).
 * Constructed only by ProviderManagedPaymentFlow implementations from the provider's own response;
 * a gateway payment id can never be turned into one (forbidden workaround in the matrix).
 */
export interface ProviderManagedTransactionRef {
  readonly __brand: 'ProviderManagedTransactionRef';
  readonly providerId: string;
  readonly productType: ProductType;
  readonly prebookRef: OpaqueRef;
  readonly transactionId: OpaqueRef;
  readonly environment: ProviderEnvironment;
}

/** Reference to a payment in one of our own gateways. Distinct type from the provider-managed ref. */
export interface GatewayPaymentRef {
  readonly __brand: 'GatewayPaymentRef';
  readonly gatewayId: string;
  readonly gatewayPaymentId: string;
  readonly environment: ProviderEnvironment;
}

export interface TravelerRef {
  travelerId: string;
  type: 'ADULT' | 'CHILD' | 'INFANT';
  /** Age at travel date, required for children/infants. */
  age: number | null;
}

export interface CancellationPolicySnapshot {
  /** IANA timezone in which deadlines are expressed by the provider. */
  timezone: string;
  refundable: boolean;
  /** Penalty steps ordered by `from`; the latest step whose `from` has passed applies. */
  steps: ReadonlyArray<{ from: string; penalty: Money }>;
  /** Raw provider wording kept for audit, never shown verbatim to customers without review. */
  providerText: string | null;
}
