import type { Money } from '@texholiday/pricing';
import type { OpaqueRef, ProductType, ProviderEnvironment, ProviderManagedTransactionRef } from '../common';
import type { ExternalOutcome } from '../outcome';

/**
 * Provider-managed customer payment (e.g. Nuitee payment SDK). The provider collects the money;
 * we can neither capture nor refund it, so those operations do not exist on this interface.
 */
export interface ProviderManagedPaymentFlow {
  readonly providerId: string;
  readonly productType: ProductType;
  readonly environment: ProviderEnvironment;
  /**
   * Short-lived client parameters for the provider's payment component, derived from the prebook the
   * server created. Never contains our main API key.
   */
  clientParameters(transaction: ProviderManagedTransactionRef): Promise<ExternalOutcome<{ secretKey: string; publicConfig: Record<string, string> }>>;
  /**
   * Server-side check of the payment linked to the stored prebook/transaction. Browser return is only a
   * trigger; ids from the URL are never trusted.
   */
  verifyPayment(transaction: ProviderManagedTransactionRef): Promise<ExternalOutcome<{ status: 'PAID' | 'PENDING' | 'FAILED'; amount: Money | null }>>;
}

export function isSameProviderTransaction(a: ProviderManagedTransactionRef, b: { prebookRef: OpaqueRef; transactionId: OpaqueRef }): boolean {
  return a.prebookRef === b.prebookRef && a.transactionId === b.transactionId;
}
