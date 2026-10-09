import {
  opaque,
  type CallEvidence,
  type ExternalOutcome,
  type GatewayAdapterCapabilities,
  type GatewayPaymentSnapshot,
  type OwnedPaymentGateway,
  type ProviderBookingState,
} from '@texholiday/contracts';
import { money, type Money } from '@texholiday/pricing';
import type { ItemBookingPort, OrderAggregate, OrderItemState, PrebookResult } from '../../src/index';

// TEST DOUBLES: scripted, clearly labelled mocks. Never registered outside tests.

export const evidence = (operation: string): CallEvidence => ({
  operation,
  environment: 'mock',
  at: '2026-10-09T10:00:00.000Z',
  httpStatus: 200,
  upstreamRequestId: null,
  durationMs: 1,
});

export const ok = <T>(value: T, op = 'op'): ExternalOutcome<T> => ({ kind: 'SUCCEEDED', value, evidence: evidence(op) });
export const rejected = (code = 'REJECTED_BY_PROVIDER'): ExternalOutcome<never> => ({ kind: 'REJECTED', code, message: code, evidence: evidence('op') });
export const unknown = (): ExternalOutcome<never> => ({ kind: 'UNKNOWN', reason: 'TIMEOUT', evidence: evidence('op') });

type Script<T> = Array<ExternalOutcome<T> | ((...args: unknown[]) => Promise<ExternalOutcome<T>>)>;

async function next<T>(script: Script<T>, fallback: () => ExternalOutcome<T>, args: unknown[]): Promise<ExternalOutcome<T>> {
  const head = script.shift();
  if (head === undefined) return fallback();
  return typeof head === 'function' ? head(...args) : head;
}

export function providerState(status: ProviderBookingState['status'], extra: Partial<ProviderBookingState> = {}): ProviderBookingState {
  return {
    status,
    providerBookingRef: opaque(`MOCK-PB-${Math.random().toString(36).slice(2, 8)}`),
    clientReference: 'x',
    pnr: null,
    ticketNumbers: [],
    ticketingStatus: extra.ticketNumbers && extra.ticketNumbers.length > 0 ? 'ISSUED' : 'NOT_APPLICABLE',
    voucherReady: status === 'CONFIRMED',
    holdExpiresAt: null,
    supplierCost: null,
    ...extra,
  };
}

export class FakeBookingPort implements ItemBookingPort {
  readonly calls: Array<{ op: string; itemId: string; clientReference?: string }> = [];
  prebookScript: Script<PrebookResult> = [];
  bookScript: Script<ProviderBookingState> = [];
  lookupScript: Script<ProviderBookingState | null> = [];
  refreshScript: Script<ProviderBookingState> = [];
  cancelScript: Script<ProviderBookingState & { penalty: Money | null }> = [];
  constructor(private readonly issuesTickets = false) {}

  async prebook(_agg: OrderAggregate, it: OrderItemState, clientReference: string) {
    this.calls.push({ op: 'prebook', itemId: it.id, clientReference });
    return next(this.prebookScript, () => ok({ prebookRef: opaque(`MOCK-PRE-${it.id}`), expiresAt: null, inventoryHeld: false, differences: [] }), []);
  }
  async book(_agg: OrderAggregate, it: OrderItemState, clientReference: string) {
    this.calls.push({ op: 'book', itemId: it.id, clientReference });
    return next(
      this.bookScript,
      () => ok(providerState('CONFIRMED', this.issuesTickets ? { pnr: 'PNR123', ticketNumbers: ['2351234567890'] } : {})),
      [],
    );
  }
  async lookup(_agg: OrderAggregate, it: OrderItemState) {
    this.calls.push({ op: 'lookup', itemId: it.id });
    return next(this.lookupScript, () => ok(null), []);
  }
  async refresh(_agg: OrderAggregate, it: OrderItemState) {
    this.calls.push({ op: 'refresh', itemId: it.id });
    return next(this.refreshScript, () => ok(providerState('CONFIRMED')), []);
  }
  async cancel(_agg: OrderAggregate, it: OrderItemState) {
    this.calls.push({ op: 'cancel', itemId: it.id });
    return next(this.cancelScript, () => ok({ ...providerState('CANCELLED'), penalty: null }), []);
  }
  count(op: string, itemId?: string): number {
    return this.calls.filter((c) => c.op === op && (itemId === undefined || c.itemId === itemId)).length;
  }
}

export class FakeGateway implements OwnedPaymentGateway {
  readonly calls: string[] = [];
  retrieveScript: Script<GatewayPaymentSnapshot> = [];
  captureScript: Script<{ capturedAmount: Money }> = [];
  voidScript: Script<{ voided: true }> = [];

  constructor(private readonly amount: Money = money('EUR', 100000n)) {}

  capabilities(): GatewayAdapterCapabilities {
    return {
      gatewayId: 'mock-gateway',
      environment: 'mock',
      isMock: true,
      operations: new Set(['AUTHORIZE', 'CAPTURE', 'RETRIEVE', 'VOID', 'REFUND_FULL', 'REFUND_PARTIAL', 'VERIFIED_NOTIFICATION']),
      currencies: ['EUR', 'TRY'],
      idempotency: { createSession: 'NONE', capture: 'NONE', void: 'NONE', refund: 'NONE' },
      requiredBuyerFields: [],
    };
  }
  async createSession() {
    this.calls.push('createSession');
    return ok({ sessionRef: 'MOCK-SESSION', redirectUrl: 'https://mock.invalid/pay', embedContent: null, expiresAt: null });
  }
  async retrieve() {
    this.calls.push('retrieve');
    return next(this.retrieveScript, () => ok(snapshot('AUTHORIZED', this.amount)), []);
  }
  async capture() {
    this.calls.push('capture');
    return next(this.captureScript, () => ok({ capturedAmount: this.amount }), []);
  }
  async void() {
    this.calls.push('void');
    return next(this.voidScript, () => ok({ voided: true as const }), []);
  }
  async refund() {
    this.calls.push('refund');
    return ok({ refunded: [] });
  }
  verifyNotification() {
    return { verified: false as const, reason: 'mock' };
  }
  count(op: string): number {
    return this.calls.filter((c) => c === op).length;
  }
}

export function snapshot(status: GatewayPaymentSnapshot['status'], amount: Money, extra: Partial<GatewayPaymentSnapshot> = {}): GatewayPaymentSnapshot {
  return {
    ref: { __brand: 'GatewayPaymentRef', gatewayId: 'mock-gateway', gatewayPaymentId: 'MOCK-PAY-1', environment: 'mock' },
    status,
    fraud: 'APPROVED',
    amount,
    paymentAttemptId: 'pa-1',
    orderId: 'ord-1',
    sessionRef: 'MOCK-SESSION',
    itemTransactions: [],
    signatureVerified: true,
    ...extra,
  };
}
