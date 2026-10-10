import { money } from '@texholiday/pricing';
import type { OrchestrationPolicy, OrderAggregate, OrderItemState, PaymentStatus } from '../../src/index';

export const NOW = new Date('2026-10-09T10:00:00.000Z');

export const policy: OrchestrationPolicy = {
  authorizationSafetyMarginSeconds: 3600,
  maxAutomaticLookups: 3,
  intentLeaseSeconds: 300,
  reconcileDelaySeconds: (attempt) => Math.min(60 * 2 ** attempt, 900),
};

export interface ItemSpec {
  id: string;
  productType: OrderItemState['productType'];
  rank: number;
  needsPrebook?: boolean;
  requiresIssuance?: boolean;
  holdSemantics?: OrderItemState['connector']['holdSemantics'];
  charge: bigint;
  /** Commission the accepted quote expects from the provider (PROVIDER_API margin); default 0. */
  commission?: bigint;
}

export const HOTEL: ItemSpec = { id: 'item-hotel', productType: 'HOTEL', rank: 10, needsPrebook: true, charge: 50000n };
export const TRANSFER: ItemSpec = { id: 'item-transfer', productType: 'TRANSFER', rank: 20, charge: 10000n };
export const FLIGHT: ItemSpec = { id: 'item-flight', productType: 'FLIGHT', rank: 30, needsPrebook: true, requiresIssuance: true, charge: 40000n };

export function makeOrder(opts: { items?: ItemSpec[]; payment?: PaymentStatus; status?: OrderAggregate['status']; authorizationExpiresAt?: string | null } = {}): OrderAggregate {
  const items = opts.items ?? [HOTEL, TRANSFER, FLIGHT];
  const total = items.reduce((a, i) => a + i.charge, 0n);
  return {
    id: 'ord-1',
    version: 1,
    environment: 'mock',
    status: opts.status ?? 'PROCESSING',
    route: { mode: 'OWN_GATEWAY', gatewayId: 'mock-gateway', currency: 'EUR', settlementPlanId: 'plan-1', policyVersion: 'pp@1' },
    chargeTotal: money('EUR', total),
    compensationReason: null,
    items: items.map((s) => ({
      id: s.id,
      productType: s.productType,
      providerId: s.productType === 'TRANSFER' ? 'welcome_pickups' : 'nuitee',
      connectorId: `mock-${s.productType.toLowerCase()}`,
      quoteVersionId: `qv-${s.id}`,
      chargeAllocation: money('EUR', s.charge),
      supplierCost: money('EUR', (s.charge * 9n) / 10n),
      expectedProviderCommission: money('EUR', s.commission ?? 0n),
      funding: { method: 'ACCOUNT_CARD', capabilityId: `cap-${s.id}` },
      connector: {
        holdSemantics: s.holdSemantics ?? (s.needsPrebook ? 'PREBOOK_VALIDATION' : 'NONE'),
        reversibilityRank: s.rank,
        requiresIssuance: s.requiresIssuance ?? false,
        needsPrebook: s.needsPrebook ?? false,
      },
      booking: {
        id: `pb-${s.id}`,
        status: 'NEW',
        clientReference: null,
        clientReferenceSeq: 0,
        providerBookingRef: null,
        prebookRef: null,
        prebookExpiresAt: null,
        pnr: null,
        ticketNumbers: [],
        ticketing: s.requiresIssuance ? 'PENDING' : 'NOT_REQUIRED',
        voucherReady: false,
        cancellation: null,
        preCancelStatus: null,
        intent: null,
        unknownOperation: null,
        lookupAttempts: 0,
        failureCode: null,
        providerCommission: null,
      },
    })),
    payment: {
      id: 'pa-1',
      createdAt: '2026-10-09T09:50:00.000Z',
      gatewayId: 'mock-gateway',
      status: opts.payment ?? 'AUTHORIZED',
      amount: money('EUR', total),
      sessionRef: 'MOCK-SESSION',
      gatewayPaymentId: 'MOCK-PAY-1',
      fraud: 'APPROVED',
      authorizationExpiresAt: opts.authorizationExpiresAt === undefined ? '2026-10-15T10:00:00.000Z' : opts.authorizationExpiresAt,
      mismatch: false,
      captureRejected: false,
      intent: null,
      unknownOperation: null,
      itemTransactions: [],
      providerTransaction: null,
      providerClientSecret: null,
      providerRefunds: [],
      payBy: null,
    },
    tasks: [],
    supplierLosses: [],
    pendingEvents: [],
    pendingAudit: [],
    pendingCommissions: [],
  };
}
