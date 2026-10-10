import { describe, expect, it } from 'vitest';
import { opaque, type ExternalOutcome, type ProviderBookingState } from '@texholiday/contracts';
import { money, type Money } from '@texholiday/pricing';
import {
  ProviderManagedOrchestrator,
  decideProviderManaged,
  type OrderAggregate,
  type OrderItemState,
  type ProviderManagedBookingPort,
  type ProviderManagedPrebook,
  type ProviderPaymentState,
} from '../src/index';
import { ok, providerState, rejected, unknown } from './support/fakes';
import { FLIGHT, HOTEL, NOW, makeOrder } from './support/fixtures';
import { InMemoryOrderStore } from './support/memory-store';

/** TEST DOUBLE for the provider-managed booking port (MOCK). */
class FakePmPort implements ProviderManagedBookingPort {
  readonly calls: Array<{ op: string; clientReference?: string; transactionId?: string }> = [];
  prebookScript: Array<ExternalOutcome<ProviderManagedPrebook>> = [];
  bookScript: Array<ExternalOutcome<ProviderBookingState>> = [];
  lookupScript: Array<ExternalOutcome<ProviderBookingState | null>> = [];
  refreshScript: Array<ExternalOutcome<ProviderBookingState>> = [];
  cancelScript: Array<ExternalOutcome<ProviderBookingState & { penalty: Money | null; providerRefund: Money | null }>> = [];
  /** Called inside cancel(), e.g. to check what was persisted before the call. */
  onCancel: (() => void) | null = null;
  attachScript: Array<ExternalOutcome<ProviderPaymentState>> = [];
  readPaymentScript: Array<ExternalOutcome<ProviderPaymentState>> = [];
  async attachServices(_a: OrderAggregate, _i: OrderItemState, selections: readonly unknown[]) {
    this.calls.push({ op: 'attach', clientReference: String(selections.length) });
    return this.attachScript.shift() ?? ok({ transactionId: opaque('MOCK-TX-2'), clientSecret: 'MOCK_pi_secret_2', amountToCharge: money('EUR', 41500n) });
  }
  async readPayment() {
    this.calls.push({ op: 'readPayment' });
    return this.readPaymentScript.shift() ?? ok({ transactionId: opaque('MOCK-TX-1'), clientSecret: 'MOCK_pi_secret_1', amountToCharge: money('EUR', 40000n) });
  }
  trigger: 'ANY_TRIGGER' | 'CUSTOMER_RETURN' = 'ANY_TRIGGER';
  scope: 'PER_REFERENCE' | 'PER_PREBOOK' = 'PER_REFERENCE';
  bookTrigger() {
    return this.trigger;
  }
  lookupScope() {
    return this.scope;
  }
  async prebookForPayment() {
    this.calls.push({ op: 'prebook' });
    return this.prebookScript.shift() ?? ok({ prebookRef: opaque('MOCK-PRE-1'), transactionId: opaque('MOCK-TX-1'), clientSecret: 'MOCK_pi_secret_1', differences: [] });
  }
  async book(_a: OrderAggregate, _i: OrderItemState, clientReference: string, tx: { transactionId: string }) {
    this.calls.push({ op: 'book', clientReference, transactionId: tx.transactionId });
    return this.bookScript.shift() ?? ok(providerState('CONFIRMED', { providerCommission: money('EUR', 4500n) }));
  }
  async lookup(_a: OrderAggregate, _i: OrderItemState, clientReference: string) {
    this.calls.push({ op: 'lookup', clientReference });
    return this.lookupScript.shift() ?? ok(null);
  }
  async refresh(_a: OrderAggregate, _i: OrderItemState, ref: string) {
    this.calls.push({ op: 'refresh', clientReference: ref });
    return this.refreshScript.shift() ?? ok(providerState('CONFIRMED', { providerBookingRef: opaque(ref) }));
  }
  async cancel(_a: OrderAggregate, _i: OrderItemState, ref: string) {
    this.calls.push({ op: 'cancel', clientReference: ref });
    this.onCancel?.();
    return this.cancelScript.shift() ?? ok({ ...providerState('CANCELLED', { providerBookingRef: opaque(ref) }), penalty: money('EUR', 0n), providerRefund: money('EUR', 50000n) });
  }
  count(op: string) {
    return this.calls.filter((c) => c.op === op).length;
  }
}

const PAY_BY = new Date(NOW.getTime() + 30 * 60_000).toISOString();

function pmOrder(product: 'HOTEL' | 'FLIGHT' = 'HOTEL'): OrderAggregate {
  const o = makeOrder({ items: [product === 'HOTEL' ? { ...HOTEL, commission: 4500n } : FLIGHT], payment: 'NEW' });
  o.route = { mode: 'PROVIDER_MANAGED', providerId: 'nuitee', productType: product, currency: 'EUR', policyVersion: 'pp@1' };
  o.items[0]!.funding = { method: 'PROVIDER_MANAGED', capabilityId: `nuitee.${product.toLowerCase()}.provider_managed` };
  Object.assign(o.payment!, { gatewayId: 'nuitee', sessionRef: null, gatewayPaymentId: null, fraud: 'NOT_PROVIDED', authorizationExpiresAt: null, payBy: PAY_BY });
  return o;
}

function harness(clock: { now: Date } = { now: NOW }, product: 'HOTEL' | 'FLIGHT' = 'HOTEL') {
  const store = new InMemoryOrderStore();
  store.put(pmOrder(product));
  const port = new FakePmPort();
  if (product === 'FLIGHT') {
    port.trigger = 'CUSTOMER_RETURN';
    port.scope = 'PER_PREBOOK';
  }
  const make = (workerId: string) =>
    new ProviderManagedOrchestrator({
      store,
      port,
      clock: () => clock.now,
      workerId,
      policy: { intentLeaseSeconds: 300, finalizeRetrySeconds: (n) => Math.min(30 * 2 ** (n - 1), 600), maxAutomaticLookups: 3 },
    });
  return { store, port, clock, pm: make('w1'), make };
}

const state = (h: ReturnType<typeof harness>) => h.store.peek('ord-1');

describe('provider-managed checkout (Nuitee payment SDK, spec §5.1)', () => {
  it('start: prebook with the payment SDK stores the transaction and the client secret; nothing is charged by us', async () => {
    const h = harness();
    expect((await h.pm.start('ord-1')).type).toBe('PREBOOK');
    const s = state(h);
    expect(s.items[0]!.booking.status).toBe('PREPARED');
    expect(s.payment).toMatchObject({ status: 'PENDING', providerTransaction: { prebookRef: 'MOCK-PRE-1', transactionId: 'MOCK-TX-1' }, providerClientSecret: 'MOCK_pi_secret_1' });
    expect(h.store.outbox.map((e) => e.type)).toEqual(['order.payment_session_ready', 'order.provider_managed.finalize']);
    // The secret is never written to the audit trail.
    expect(JSON.stringify(h.store.auditLog)).not.toContain('MOCK_pi_secret_1');
    // Idempotent: a second start does not create another provider session.
    await h.pm.start('ord-1');
    expect(h.port.count('prebook')).toBe(1);
  });

  it('a return before the payment is completed books nothing; the next try uses a NEW client reference', async () => {
    // Nuitee sandbox 2026-10-09: "payment not completed" uses up the reference (a repeat answers 4005, lookup finds
    // nothing), so reusing it would never book the paid order.
    const h = harness();
    await h.pm.start('ord-1');
    h.port.bookScript.push(rejected('NUITEE_PAYMENT_NOT_COMPLETED'));
    await h.pm.finalize('ord-1', 1);
    let s = state(h);
    expect(s.payment!.status).toBe('PENDING');
    expect(s.items[0]!.booking).toMatchObject({ status: 'PREPARED', clientReference: null });
    expect(h.store.outbox.filter((e) => e.type === 'order.provider_managed.finalize').at(-1)!.payload).toMatchObject({ attempt: 2 });
    await h.pm.finalize('ord-1', 2);
    s = state(h);
    const refs = h.port.calls.filter((c) => c.op === 'book').map((c) => c.clientReference);
    expect(refs).toEqual(['pb-item-hotel-1', 'pb-item-hotel-2']);
    expect(h.port.calls.filter((c) => c.op === 'book').every((c) => c.transactionId === 'MOCK-TX-1')).toBe(true);
    expect(s.status).toBe('CONFIRMED');
  });

  it('with the provider semantics (used-up references, single-use transaction) the paid order books exactly once', async () => {
    const h = harness();
    const used = new Set<string>();
    const bookings = new Map<string, ProviderBookingState>();
    let paid = false;
    let consumed = false;
    h.port.book = async (_a, _i, clientReference, tx) => {
      h.port.calls.push({ op: 'book', clientReference, transactionId: tx.transactionId });
      if (used.has(clientReference)) return unknown(); // 4005
      used.add(clientReference);
      if (!paid || consumed) return rejected('NUITEE_PAYMENT_NOT_COMPLETED');
      consumed = true;
      const b = providerState('CONFIRMED');
      bookings.set(clientReference, b);
      return ok(b);
    };
    h.port.lookup = async (_a, _i, clientReference) => {
      h.port.calls.push({ op: 'lookup', clientReference });
      return ok(bookings.get(clientReference) ?? null);
    };
    await h.pm.start('ord-1');
    await h.pm.finalize('ord-1', 1); // worker: customer still typing
    await h.pm.finalize('ord-1', 2); // browser return before the provider saw the payment
    paid = true;
    await h.pm.finalize('ord-1', 3);
    await h.pm.finalize('ord-1', 4); // late duplicate trigger
    expect(state(h).status).toBe('CONFIRMED');
    expect(bookings.size).toBe(1);
    expect(h.port.count('book')).toBe(3);
  });

  it('a confirmed booking confirms the order: provider collected (CAPTURED), secret cleared, commission expected', async () => {
    const h = harness();
    await h.pm.start('ord-1');
    await h.pm.finalize('ord-1');
    const s = state(h);
    expect(s.status).toBe('CONFIRMED');
    expect(s.items[0]!.booking.status).toBe('CONFIRMED');
    expect(s.payment).toMatchObject({ status: 'CAPTURED', providerClientSecret: null });
    expect(h.store.commissions).toEqual([{ orderId: 'ord-1', itemId: 'item-hotel', kind: 'EXPECTED', amount: money('EUR', 4500n), source: 'BOOKING' }]);
    expect(h.store.outbox.filter((e) => e.type === 'order.confirmed')).toHaveLength(1);
    // Later triggers change nothing (no second booking).
    await h.pm.finalize('ord-1');
    expect(h.port.count('book')).toBe(1);
  });

  it('T19: a lost book response is resolved by lookup, never by booking again', async () => {
    const h = harness();
    await h.pm.start('ord-1');
    h.port.bookScript.push(unknown());
    await h.pm.finalize('ord-1');
    expect(state(h).items[0]!.booking.status).toBe('UNKNOWN');
    expect(decideProviderManaged(state(h), NOW, 'FINALIZE').type).toBe('LOOKUP');
    h.port.lookupScript.push(ok(providerState('CONFIRMED')));
    await h.pm.finalize('ord-1');
    const s = state(h);
    expect(s.status).toBe('CONFIRMED');
    expect(s.payment!.status).toBe('CAPTURED');
    expect(h.port.count('book')).toBe(1);
  });

  it('T19: a lookup that finds nothing returns to the prepared offer with a NEW client reference', async () => {
    const h = harness();
    await h.pm.start('ord-1');
    h.port.bookScript.push(unknown());
    await h.pm.finalize('ord-1');
    h.port.lookupScript.push(ok(null));
    await h.pm.finalize('ord-1');
    expect(state(h).items[0]!.booking.status).toBe('PREPARED');
    await h.pm.finalize('ord-1');
    const refs = h.port.calls.filter((c) => c.op === 'book').map((c) => c.clientReference);
    expect(refs).toHaveLength(2);
    expect(refs[0]).not.toBe(refs[1]);
    expect(state(h).status).toBe('CONFIRMED');
  });

  it('inconclusive lookups keep going and ask a human after the budget (no re-book)', async () => {
    const h = harness();
    await h.pm.start('ord-1');
    h.port.bookScript.push(unknown());
    await h.pm.finalize('ord-1');
    for (let i = 0; i < 3; i += 1) {
      h.port.lookupScript.push(unknown());
      await h.pm.finalize('ord-1');
    }
    expect(state(h).tasks.map((t) => t.reason)).toContain('BOOKING_UNKNOWN');
    expect(h.port.count('book')).toBe(1);
  });

  it('a definitive refusal cancels the order and asks a human to check a possible provider payment hold', async () => {
    const h = harness();
    await h.pm.start('ord-1');
    h.port.bookScript.push(rejected('NUITEE_4012'));
    await h.pm.finalize('ord-1');
    const s = state(h);
    expect(s.status).toBe('CANCELLED');
    expect(s.items[0]!.booking).toMatchObject({ status: 'FAILED', failureCode: 'NUITEE_4012' });
    expect(s.payment).toMatchObject({ status: 'DECLINED', providerClientSecret: null });
    expect(s.tasks.map((t) => t.reason)).toEqual(['PROVIDER_PAYMENT_HOLD']);
  });

  it('closing the browser loses nothing: the scheduled finalize books once the customer has paid', async () => {
    const h = harness();
    await h.pm.start('ord-1');
    h.port.bookScript.push(rejected('NUITEE_PAYMENT_NOT_COMPLETED'));
    await h.pm.finalize('ord-1', 1); // worker, customer still on the payment form
    h.clock.now = new Date(NOW.getTime() + 60_000);
    await h.pm.finalize('ord-1', 2); // worker, customer paid and closed the tab
    expect(state(h).status).toBe('CONFIRMED');
  });

  it('an unpaid checkout is abandoned at the deadline; if a book call was ever sent, a lookup comes first', async () => {
    const never = harness();
    await never.pm.start('ord-1');
    never.clock.now = new Date(PAY_BY);
    expect((await never.pm.finalize('ord-1')).type).toBe('EXPIRE');
    expect(state(never)).toMatchObject({ status: 'CANCELLED', compensationReason: 'CHECKOUT_EXPIRED' });
    expect(state(never).tasks).toEqual([]);
    expect(never.port.count('lookup')).toBe(0);

    const tried = harness();
    await tried.pm.start('ord-1');
    tried.port.bookScript.push(rejected('NUITEE_PAYMENT_NOT_COMPLETED'));
    await tried.pm.finalize('ord-1');
    tried.clock.now = new Date(PAY_BY);
    tried.port.lookupScript.push(ok(providerState('CONFIRMED')));
    await tried.pm.finalize('ord-1');
    expect(state(tried).status).toBe('CONFIRMED'); // paid at the last second: the booking wins
    expect(tried.port.count('lookup')).toBe(1);
  });

  it('before abandoning, every reference ever sent is looked up: a booking whose answer was lost still wins', async () => {
    const h = harness();
    await h.pm.start('ord-1');
    // Try 1: response lost; the lookup right after finds nothing yet (provider still writing) -> new reference.
    h.port.bookScript.push(unknown());
    await h.pm.finalize('ord-1', 1);
    h.port.lookupScript.push(ok(null));
    await h.pm.finalize('ord-1');
    // Try 2: the transaction is already used by try 1, so the provider answers "payment not completed".
    h.port.bookScript.push(rejected('NUITEE_PAYMENT_NOT_COMPLETED'));
    await h.pm.finalize('ord-1', 2);
    h.clock.now = new Date(PAY_BY);
    h.port.lookupScript.push(ok(null), ok(providerState('CONFIRMED')));
    expect((await h.pm.finalize('ord-1')).type).toBe('EXPIRE');
    expect(h.port.calls.filter((c) => c.op === 'lookup').map((c) => c.clientReference)).toEqual(['pb-item-hotel-1', 'pb-item-hotel-2', 'pb-item-hotel-1']);
    expect(state(h).status).toBe('CONFIRMED');
    expect(state(h).tasks).toEqual([]);
  });

  it('an inconclusive lookup at the deadline does not abandon the checkout', async () => {
    const h = harness();
    await h.pm.start('ord-1');
    h.port.bookScript.push(rejected('NUITEE_PAYMENT_NOT_COMPLETED'));
    await h.pm.finalize('ord-1', 1);
    h.clock.now = new Date(PAY_BY);
    h.port.lookupScript.push(unknown());
    await h.pm.finalize('ord-1');
    expect(state(h).status).not.toBe('CANCELLED');
    expect(h.store.outbox.at(-1)!.type).toBe('order.provider_managed.lookup');
  });

  it('the retry schedule never goes past the deadline', async () => {
    const h = harness();
    await h.pm.start('ord-1');
    for (let a = 1; a <= 6; a += 1) {
      h.port.bookScript.push(rejected('NUITEE_PAYMENT_NOT_COMPLETED'));
      await h.pm.finalize('ord-1', a);
    }
    for (const e of h.store.outbox.filter((x) => x.type === 'order.provider_managed.finalize')) {
      expect(new Date(e.availableAt!).getTime()).toBeLessThanOrEqual(new Date(PAY_BY).getTime());
    }
  });

  it('K15/T04: a changed price at prebook stops before any payment session', async () => {
    const h = harness();
    h.port.prebookScript.push(ok({ prebookRef: opaque('MOCK-PRE-2'), transactionId: opaque('MOCK-TX-2'), clientSecret: 'MOCK_pi_secret_2', differences: ['CHARGE_AMOUNT'] }));
    await h.pm.start('ord-1');
    const s = state(h);
    expect(s).toMatchObject({ status: 'CANCELLED', compensationReason: 'QUOTE_CHANGED:CHARGE_AMOUNT' });
    expect(s.payment).toMatchObject({ status: 'DECLINED', providerClientSecret: null, providerTransaction: null });
    expect(h.store.outbox.map((e) => e.type)).toContain('order.quote_changed');
  });

  it('T17: two concurrent finalizations send the book call once', async () => {
    const h = harness();
    await h.pm.start('ord-1');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.port.book = async (_a, _i, clientReference, tx) => {
      h.port.calls.push({ op: 'book', clientReference, transactionId: tx.transactionId });
      await gate;
      return ok(providerState('CONFIRMED'));
    };
    const first = h.pm.finalize('ord-1');
    await new Promise((r) => setTimeout(r, 5));
    const second = await h.make('w2').finalize('ord-1');
    expect(second.type).toBe('NONE');
    release();
    await first;
    expect(h.port.count('book')).toBe(1);
    expect(state(h).status).toBe('CONFIRMED');
  });

  it('a crashed worker leaves a book intent that expires into UNKNOWN, then lookup', async () => {
    const h = harness();
    await h.pm.start('ord-1');
    const agg = await h.store.load('ord-1');
    agg.items[0]!.booking.intent = { op: 'BOOK', startedAt: NOW.toISOString(), leaseUntil: NOW.toISOString(), workerId: 'dead' };
    agg.items[0]!.booking.clientReference = 'pb-item-hotel-1';
    await h.store.save(agg);
    h.clock.now = new Date(NOW.getTime() + 1000);
    expect((await h.pm.finalize('ord-1')).type).toBe('INTENT_EXPIRED');
    expect(state(h).items[0]!.booking.status).toBe('UNKNOWN');
    h.port.lookupScript.push(ok(providerState('CONFIRMED')));
    await h.pm.finalize('ord-1');
    expect(state(h).status).toBe('CONFIRMED');
    expect(h.port.count('book')).toBe(0);
  });

  it('a prebook failure ends the checkout without a payment session', async () => {
    const h = harness();
    h.port.prebookScript.push(rejected('NUITEE_2001'));
    await h.pm.start('ord-1');
    expect(state(h)).toMatchObject({ status: 'CANCELLED' });
    expect(state(h).payment!.status).toBe('DECLINED');
    expect(state(h).tasks).toEqual([]);
  });
});

describe('staff commands on provider-managed orders (/yonetim)', () => {
  const STAFF = 'staff:ops-1';
  async function confirmed() {
    const h = harness();
    h.port.bookScript.push(ok(providerState('CONFIRMED', { providerBookingRef: opaque('MOCK-PB-1') })));
    await h.pm.start('ord-1');
    await h.pm.finalize('ord-1');
    expect(state(h).status).toBe('CONFIRMED');
    return h;
  }
  const cancelled = (penalty: bigint, refund: bigint | null) =>
    ok({ ...providerState('CANCELLED', { providerBookingRef: opaque('MOCK-PB-1') }), penalty: money('EUR', penalty), providerRefund: refund === null ? null : money('EUR', refund) });

  it('cancel: intent stored before the call; the provider refund is recorded and a person confirms the customer refund', async () => {
    const h = await confirmed();
    h.port.onCancel = () => expect(h.store.peek('ord-1').items[0]!.booking).toMatchObject({ status: 'CANCEL_PENDING', cancellation: 'REQUESTED', intent: { op: 'CANCEL' } });
    h.port.cancelScript.push(cancelled(2500n, 47500n));
    const r = await h.pm.cancel('ord-1', STAFF, 'Misafir talebi');
    expect(r).toEqual({ outcome: 'CANCELLED', penalty: money('EUR', 2500n), providerRefund: money('EUR', 47500n) });
    const s = state(h);
    expect(s).toMatchObject({ status: 'CANCELLED', compensationReason: 'CANCELLED_BY_STAFF' });
    expect(s.items[0]!.booking).toMatchObject({ status: 'CANCELLED', cancellation: 'COMPLETED', intent: null, voucherReady: false });
    expect(s.payment!.status).toBe('REFUND_PENDING'); // never REFUNDED on the provider's word alone
    expect(s.tasks.map((t) => t.reason)).toEqual(['REFUND_UNKNOWN']);
    expect(s.tasks[0]!.detail).toContain('25.00 EUR');
    expect(h.store.commissions.at(-1)).toMatchObject({ kind: 'VOIDED' });
    expect(h.store.auditLog.find((a) => a.action === 'provider_managed.cancel_requested')!.detail).toMatchObject({ reason: 'Misafir talebi' });
    expect(h.port.calls.filter((c) => c.op === 'cancel').map((c) => c.clientReference)).toEqual(['MOCK-PB-1']);
  });

  it('cancel with full charges (no refund): payment stays collected, no refund task', async () => {
    const h = await confirmed();
    h.port.cancelScript.push(cancelled(50000n, 0n));
    await h.pm.cancel('ord-1', STAFF, 'İade edilemez oda');
    const s = state(h);
    expect(s.status).toBe('CANCELLED');
    expect(s.payment!.status).toBe('CAPTURED');
    expect(s.tasks).toEqual([]);
  });

  it('a refused cancel leaves the booking as it was; a new request can be made later', async () => {
    const h = await confirmed();
    h.port.cancelScript.push(rejected('NUITEE_BOOKING_NOT_FOUND'));
    expect(await h.pm.cancel('ord-1', STAFF, 'deneme')).toEqual({ outcome: 'REJECTED', code: 'NUITEE_BOOKING_NOT_FOUND' });
    expect(state(h)).toMatchObject({ status: 'CONFIRMED' });
    expect(state(h).items[0]!.booking).toMatchObject({ status: 'CONFIRMED', cancellation: 'REJECTED', intent: null });
    h.port.cancelScript.push(cancelled(0n, 50000n));
    expect((await h.pm.cancel('ord-1', STAFF, 'ikinci deneme')).outcome).toBe('CANCELLED');
  });

  it('a lost cancel answer is resolved by reading the booking, never by cancelling again', async () => {
    const h = await confirmed();
    h.port.cancelScript.push(unknown());
    expect(await h.pm.cancel('ord-1', STAFF, 'misafir')).toEqual({ outcome: 'UNKNOWN' });
    let s = state(h);
    expect(s.status).toBe('CONFIRMED');
    expect(s.items[0]!.booking).toMatchObject({ status: 'UNKNOWN', unknownOperation: 'CANCEL', cancellation: 'UNKNOWN' });
    expect(s.tasks.map((t) => t.reason)).toEqual(['CANCELLATION_UNKNOWN']);
    expect(h.store.outbox.at(-1)!.type).toBe('order.provider_managed.lookup');
    expect(decideProviderManaged(s, NOW, 'FINALIZE').type).toBe('CANCEL_LOOKUP');

    h.port.refreshScript.push(unknown()); // still unreadable: look again later
    await h.pm.finalize('ord-1');
    expect(state(h).items[0]!.booking.status).toBe('UNKNOWN');
    h.port.refreshScript.push(ok(providerState('CANCELLED', { providerBookingRef: opaque('MOCK-PB-1') })));
    await h.pm.finalize('ord-1');
    s = state(h);
    expect(s.status).toBe('CANCELLED');
    expect(s.items[0]!.booking).toMatchObject({ status: 'CANCELLED', cancellation: 'COMPLETED' });
    // Amounts were lost with the answer: the refund task says so; the payment is left for the person to settle.
    expect(s.payment!.status).toBe('CAPTURED');
    expect(s.tasks.map((t) => t.reason)).toContain('REFUND_UNKNOWN');
    expect(h.port.count('cancel')).toBe(1);
  });

  it('a lost cancel that did not take effect returns to the confirmed booking (not re-sent)', async () => {
    const h = await confirmed();
    h.port.cancelScript.push(unknown());
    await h.pm.cancel('ord-1', STAFF, 'misafir');
    h.port.refreshScript.push(ok(providerState('CONFIRMED', { providerBookingRef: opaque('MOCK-PB-1') })));
    await h.pm.finalize('ord-1');
    const s = state(h);
    expect(s.status).toBe('CONFIRMED');
    expect(s.items[0]!.booking).toMatchObject({ status: 'CONFIRMED', cancellation: 'REJECTED', unknownOperation: null });
    expect(h.port.count('cancel')).toBe(1);
  });

  it('a crashed cancel call expires into a cancel lookup', async () => {
    const h = await confirmed();
    const agg = await h.store.load('ord-1');
    agg.items[0]!.booking.status = 'CANCEL_PENDING';
    agg.items[0]!.booking.cancellation = 'REQUESTED';
    agg.items[0]!.booking.intent = { op: 'CANCEL', startedAt: NOW.toISOString(), leaseUntil: NOW.toISOString(), workerId: 'dead' };
    await h.store.save(agg);
    h.clock.now = new Date(NOW.getTime() + 1000);
    expect((await h.pm.finalize('ord-1')).type).toBe('INTENT_EXPIRED');
    expect(state(h).items[0]!.booking).toMatchObject({ status: 'UNKNOWN', unknownOperation: 'CANCEL' });
    expect(state(h).tasks.map((t) => t.reason)).toContain('CANCELLATION_UNKNOWN');
    expect((await h.pm.finalize('ord-1')).type).toBe('CANCEL_LOOKUP');
  });

  it('only a confirmed booking can be cancelled; nothing is sent otherwise', async () => {
    const h = harness();
    await h.pm.start('ord-1');
    await expect(h.pm.cancel('ord-1', STAFF, 'erken')).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
    expect(h.port.count('cancel')).toBe(0);
  });

  it('check status: a booking cancelled outside TexHoliday is picked up; an unreadable provider changes nothing', async () => {
    const h = await confirmed();
    h.port.refreshScript.push(unknown());
    expect(await h.pm.checkStatus('ord-1', STAFF)).toMatchObject({ providerAnswered: false, changed: false, orderStatus: 'CONFIRMED' });
    expect(await h.pm.checkStatus('ord-1', STAFF)).toMatchObject({ providerAnswered: true, changed: false, bookingStatus: 'CONFIRMED' });
    h.port.refreshScript.push(ok(providerState('CANCELLED', { providerBookingRef: opaque('MOCK-PB-1') })));
    expect(await h.pm.checkStatus('ord-1', STAFF)).toMatchObject({ providerAnswered: true, changed: true, orderStatus: 'CANCELLED', bookingStatus: 'CANCELLED' });
    const s = state(h);
    expect(s.compensationReason).toBe('CANCELLED_AT_PROVIDER');
    expect(s.tasks.map((t) => t.reason)).toEqual(['REFUND_UNKNOWN']);
    expect(h.store.auditLog.filter((a) => a.action === 'order.status_checked')).toHaveLength(3);
    expect(h.port.count('cancel')).toBe(0);
  });

  it('check status on an open checkout tries to finalize (the customer may have paid); it never opens a payment session', async () => {
    const h = harness();
    expect(await h.pm.checkStatus('ord-1', STAFF)).toMatchObject({ changed: false });
    expect(h.port.count('prebook')).toBe(0);
    await h.pm.start('ord-1');
    expect(await h.pm.checkStatus('ord-1', STAFF)).toMatchObject({ providerAnswered: true, changed: true, orderStatus: 'CONFIRMED' });
    expect(h.port.count('book')).toBe(1);
  });

  it('recorded provider refunds add up to the amount paid, never more; only on cancelled paid orders', async () => {
    const h = await confirmed();
    await expect(h.pm.recordProviderRefund('ord-1', STAFF, money('EUR', 100n), 'Nuitee panel')).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
    h.port.cancelScript.push(cancelled(2500n, 47500n));
    await h.pm.cancel('ord-1', STAFF, 'misafir');
    await expect(h.pm.recordProviderRefund('ord-1', STAFF, money('USD', 100n), 'Nuitee panel')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(h.pm.recordProviderRefund('ord-1', STAFF, money('EUR', 100n), 'x')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await h.pm.recordProviderRefund('ord-1', STAFF, money('EUR', 40000n), 'Nuitee panel, iade 1')).toEqual({ paymentStatus: 'PARTIALLY_REFUNDED', refundedTotal: money('EUR', 40000n) });
    // The same refund submitted again (double click, second tab) is refused.
    await expect(h.pm.recordProviderRefund('ord-1', STAFF, money('EUR', 40000n), 'Nuitee panel, iade 1')).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: 'This refund is already recorded' });
    await expect(h.pm.recordProviderRefund('ord-1', STAFF, money('EUR', 10001n), 'Banka dekontu')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await h.pm.recordProviderRefund('ord-1', STAFF, money('EUR', 10000n), 'Banka dekontu')).toEqual({ paymentStatus: 'REFUNDED', refundedTotal: money('EUR', 50000n) });
    const s = state(h);
    expect(s.payment!.providerRefunds.map((r) => [r.amount.minor, r.reference, r.recordedBy])).toEqual([
      [40000n, 'Nuitee panel, iade 1', STAFF],
      [10000n, 'Banka dekontu', STAFF],
    ]);
    expect(h.store.auditLog.filter((a) => a.action === 'provider_managed.refund_recorded')).toHaveLength(2);
  });
});

/** A flight booked through the provider's payment component (ADR-0011, ADR-0012). */
describe('provider-managed flights: book on the customer return, PNR is not a ticket', () => {
  const pnr = (extra: Partial<ProviderBookingState> = {}) =>
    providerState('CONFIRMED', { providerBookingRef: opaque('MOCK-FB-1'), pnr: 'MOCKPN', ticketingStatus: 'PENDING', voucherReady: false, ...extra });
  const ticketed = () => providerState('ISSUED', { providerBookingRef: opaque('MOCK-FB-1'), pnr: 'MOCKPN', ticketingStatus: 'ISSUED', ticketNumbers: ['MOCK-TKT-1'], voucherReady: true });
  const flight = (clock: { now: Date } = { now: NOW }) => harness(clock, 'FLIGHT');
  const booked = async () => {
    const h = flight();
    h.port.bookScript.push(ok(pnr()));
    await h.pm.start('ord-1');
    await h.pm.customerReturned('ord-1');
    return h;
  };

  it('scheduled steps never book a flight: only the customer return does; the one scheduled step closes the checkout at the deadline', async () => {
    const h = flight();
    await h.pm.start('ord-1');
    const scheduled = h.store.outbox.filter((e) => e.type === 'order.provider_managed.finalize');
    expect(scheduled.map((e) => e.availableAt)).toEqual([PAY_BY]);
    expect((await h.pm.finalize('ord-1', 1)).type).toBe('NONE');
    expect(h.port.count('book')).toBe(0);
    expect(decideProviderManaged(state(h), NOW, 'FINALIZE', true)).toEqual({ type: 'NONE', reason: 'waiting for the customer payment' });
    expect(decideProviderManaged(state(h), NOW, 'RETURN', true)).toEqual({ type: 'FINALIZE' });
    // A staff "check status" is not a return either.
    await h.pm.checkStatus('ord-1', 'staff:ops-1');
    expect(h.port.count('book')).toBe(0);
    h.port.bookScript.push(ok(ticketed()));
    await h.pm.customerReturned('ord-1');
    expect(h.port.count('book')).toBe(1);
    expect(state(h).status).toBe('CONFIRMED');
  });

  it('T08: a PNR collects the payment but keeps the order processing; the issued ticket confirms it once', async () => {
    const h = await booked();
    let s = state(h);
    expect(s.status).toBe('PROCESSING');
    expect(s.payment!.status).toBe('CAPTURED');
    expect(s.payment!.providerClientSecret).toBeNull();
    expect(s.items[0]!.booking).toMatchObject({ status: 'CONFIRMED', ticketing: 'PENDING', pnr: 'MOCKPN', providerBookingRef: 'MOCK-FB-1' });
    expect(h.store.outbox.some((e) => e.type === 'order.confirmed')).toBe(false);
    expect(h.store.outbox.at(-1)!.type).toBe('order.provider_managed.lookup');
    expect(h.store.auditLog.some((a) => a.action === 'provider_managed.awaiting_ticket')).toBe(true);

    expect(decideProviderManaged(s, NOW, 'FINALIZE', true).type).toBe('ISSUANCE_CHECK');
    h.port.refreshScript.push(ok(pnr()));
    await h.pm.finalize('ord-1');
    expect(state(h).status).toBe('PROCESSING');
    h.port.refreshScript.push(ok(ticketed()));
    await h.pm.finalize('ord-1');
    s = state(h);
    expect(s.status).toBe('CONFIRMED');
    expect(s.items[0]!.booking).toMatchObject({ status: 'ISSUED', ticketing: 'ISSUED', ticketNumbers: ['MOCK-TKT-1'], voucherReady: true });
    expect(h.store.outbox.filter((e) => e.type === 'order.confirmed')).toHaveLength(1);
    expect(h.port.calls.filter((c) => c.op === 'refresh').map((c) => c.clientReference)).toEqual(['MOCK-FB-1', 'MOCK-FB-1']);
    // Settled: nothing else is read or sent.
    expect((await h.pm.finalize('ord-1')).type).toBe('NONE');
    expect(h.port.count('book')).toBe(1);
  });

  it('a ticket booked straight away confirms the order at once', async () => {
    const h = flight();
    h.port.bookScript.push(ok(ticketed()));
    await h.pm.start('ord-1');
    await h.pm.customerReturned('ord-1');
    expect(state(h).status).toBe('CONFIRMED');
    expect(state(h).items[0]!.booking).toMatchObject({ status: 'ISSUED', ticketing: 'ISSUED' });
  });

  it('a ticket still missing after the automatic checks asks a person (TICKETING_DELAYED); reading continues', async () => {
    const h = await booked();
    for (let i = 0; i < 3; i += 1) {
      h.port.refreshScript.push(i === 1 ? unknown() : ok(pnr()));
      await h.pm.finalize('ord-1');
    }
    const s = state(h);
    expect(s.status).toBe('PROCESSING');
    expect(s.tasks.map((t) => t.reason)).toEqual(['TICKETING_DELAYED']);
    expect(h.store.outbox.at(-1)!.type).toBe('order.provider_managed.lookup');
    expect(h.port.count('book')).toBe(1);
  });

  it('cancelled by the airline before the ticket: the order is cancelled and a person confirms the provider refund', async () => {
    const h = await booked();
    h.port.refreshScript.push(ok(providerState('CANCELLED', { providerBookingRef: opaque('MOCK-FB-1') })));
    await h.pm.finalize('ord-1');
    const s = state(h);
    expect(s.status).toBe('CANCELLED');
    expect(s.items[0]!.booking.status).toBe('CANCELLED');
    expect(s.tasks.map((t) => t.reason)).toEqual(['REFUND_UNKNOWN']);
    expect(h.store.outbox.find((e) => e.type === 'order.cancelled')!.payload).toMatchObject({ reason: 'CANCELLED_AT_PROVIDER', refundExpected: true });
  });

  it('T19: a lost flight book answer is read once per prebook (the provider returns the booking of the prebook)', async () => {
    const h = flight();
    h.port.bookScript.push(unknown());
    await h.pm.start('ord-1');
    await h.pm.customerReturned('ord-1');
    expect(state(h).items[0]!.booking.status).toBe('UNKNOWN');
    h.port.lookupScript.push(ok(pnr()));
    await h.pm.finalize('ord-1');
    expect(h.port.count('lookup')).toBe(1);
    expect(state(h).items[0]!.booking).toMatchObject({ status: 'CONFIRMED', ticketing: 'PENDING' });
    expect(state(h).status).toBe('PROCESSING');
  });

  it('before abandoning, one lookup covers every reference ever sent (PER_PREBOOK)', async () => {
    const clock = { now: NOW };
    const h = flight(clock);
    await h.pm.start('ord-1');
    h.port.bookScript.push(rejected('NUITEE_PAYMENT_NOT_COMPLETED'), rejected('NUITEE_PAYMENT_NOT_COMPLETED'));
    await h.pm.customerReturned('ord-1');
    await h.pm.customerReturned('ord-1');
    expect(state(h).items[0]!.booking.clientReferenceSeq).toBe(2);
    clock.now = new Date(new Date(PAY_BY).getTime() + 1000);
    await h.pm.finalize('ord-1');
    expect(h.port.count('lookup')).toBe(1);
    expect(state(h).status).toBe('CANCELLED');
  });

  it('an unpaid flight checkout is closed at the deadline; a customer who paid and never came back is told about the hold', async () => {
    const clock = { now: NOW };
    const h = flight(clock);
    await h.pm.start('ord-1');
    expect(await h.pm.issuePaymentSecret('ord-1')).toBe('MOCK_pi_secret_1');
    clock.now = new Date(PAY_BY);
    expect((await h.pm.finalize('ord-1')).type).toBe('EXPIRE');
    const s = state(h);
    expect(s.status).toBe('CANCELLED');
    expect(h.port.count('book')).toBe(0);
    expect(s.tasks.map((t) => t.reason)).toEqual(['PROVIDER_PAYMENT_HOLD']);
    expect(h.store.outbox.find((e) => e.type === 'order.provider_managed.failed')!.payload).toMatchObject({ code: 'CHECKOUT_EXPIRED', mayHoldPayment: true });
  });

  it('staff cancel of a paid flight waiting for its ticket: the airline confirmation is awaited, then read until final', async () => {
    const h = await booked();
    h.port.cancelScript.push(ok({ ...providerState('CANCEL_PENDING', { providerBookingRef: opaque('MOCK-FB-1') }), penalty: money('EUR', 0n), providerRefund: null }));
    const r = await h.pm.cancel('ord-1', 'staff:ops-1', 'Yolcu telefonla istedi');
    expect(r).toEqual({ outcome: 'PENDING', penalty: money('EUR', 0n) });
    let s = state(h);
    expect(s.items[0]!.booking).toMatchObject({ status: 'CANCEL_PENDING', cancellation: 'PROVIDER_PENDING', intent: null });
    expect(decideProviderManaged(s, NOW, 'FINALIZE', true).type).toBe('CANCEL_LOOKUP');
    h.port.refreshScript.push(ok(providerState('CANCEL_PENDING', { providerBookingRef: opaque('MOCK-FB-1') })));
    await h.pm.finalize('ord-1');
    expect(state(h).items[0]!.booking.status).toBe('CANCEL_PENDING');
    h.port.refreshScript.push(ok(providerState('CANCELLED', { providerBookingRef: opaque('MOCK-FB-1') })));
    await h.pm.finalize('ord-1');
    s = state(h);
    expect(s.status).toBe('CANCELLED');
    expect(s.items[0]!.booking).toMatchObject({ status: 'CANCELLED', cancellation: 'COMPLETED' });
    expect(h.store.outbox.find((e) => e.type === 'order.cancelled')!.payload).toMatchObject({ reason: 'CANCELLED_BY_STAFF' });
    expect(h.port.count('cancel')).toBe(1);
  });

  it('a cancel that did not take effect sends a waiting flight back to waiting for its ticket', async () => {
    const h = await booked();
    h.port.cancelScript.push(unknown());
    expect((await h.pm.cancel('ord-1', 'staff:ops-1', 'Yolcu istedi')).outcome).toBe('UNKNOWN');
    h.port.refreshScript.push(ok(pnr()));
    await h.pm.finalize('ord-1');
    const s = state(h);
    expect(s.status).toBe('PROCESSING');
    expect(s.items[0]!.booking).toMatchObject({ status: 'CONFIRMED', cancellation: 'REJECTED', ticketing: 'PENDING' });
    expect(decideProviderManaged(s, NOW, 'FINALIZE', true).type).toBe('ISSUANCE_CHECK');
    h.port.refreshScript.push(ok(ticketed()));
    await h.pm.finalize('ord-1');
    expect(state(h).status).toBe('CONFIRMED');
    expect(h.port.count('cancel')).toBe(1);
  });
});

/** Seats and bags attached before the payment form (ADR-0013). */
describe('provider-managed flights: services before the payment form', () => {
  const flight = () => harness({ now: NOW }, 'FLIGHT');
  const request = (minor = 41500n) => ({ quoteVersionId: 'qv-item-flight-2', expectedCharge: money('EUR', minor), supplierCost: money('EUR', minor), selections: [{ serviceRef: opaque('MOCK-SVC-1'), passengerIndex: 0, quantity: 1 }] });
  const started = async () => {
    const h = flight();
    await h.pm.start('ord-1');
    return h;
  };

  it('replaces the payment intent and the charge with the accepted quote; the book uses the new transaction', async () => {
    const h = await started();
    expect(await h.pm.attachServices('ord-1', request(), 'customer')).toEqual({ outcome: 'ATTACHED', amount: money('EUR', 41500n) });
    const s = state(h);
    expect(s.payment).toMatchObject({ providerTransaction: { prebookRef: 'MOCK-PRE-1', transactionId: 'MOCK-TX-2' }, providerClientSecret: 'MOCK_pi_secret_2', amount: money('EUR', 41500n), providerSecretIssuedAt: null });
    expect(s.chargeTotal).toEqual(money('EUR', 41500n));
    expect(s.items[0]).toMatchObject({ quoteVersionId: 'qv-item-flight-2', chargeAllocation: money('EUR', 41500n), supplierCost: money('EUR', 41500n) });
    expect(s.items[0]!.booking.intent).toBeNull();
    expect(h.store.auditLog.map((a) => a.action)).toEqual(expect.arrayContaining(['provider_managed.services_requested', 'provider_managed.services_attached']));
    expect(JSON.stringify(h.store.auditLog)).not.toContain('MOCK_pi_secret_2');
    expect(await h.pm.issuePaymentSecret('ord-1')).toBe('MOCK_pi_secret_2');
    h.port.bookScript.push(ok(providerState('ISSUED', { providerBookingRef: opaque('MOCK-FB-1'), ticketingStatus: 'ISSUED' })));
    await h.pm.customerReturned('ord-1');
    expect(h.port.calls.filter((c) => c.op === 'book').map((c) => c.transactionId)).toEqual(['MOCK-TX-2']);
  });

  it('once the payment form was shown, services are refused and nothing is sent', async () => {
    const h = await started();
    await h.pm.issuePaymentSecret('ord-1');
    expect(state(h).payment!.providerSecretIssuedAt).toBe(NOW.toISOString());
    await expect(h.pm.attachServices('ord-1', request(), 'customer')).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
    expect(h.port.count('attach')).toBe(0);
  });

  it('a refusal changes nothing; the customer may pay as before', async () => {
    const h = await started();
    h.port.attachScript.push(rejected('NUITEE_44001'));
    expect(await h.pm.attachServices('ord-1', request(), 'customer')).toEqual({ outcome: 'REJECTED', code: 'NUITEE_44001' });
    expect(state(h).payment).toMatchObject({ providerTransaction: { transactionId: 'MOCK-TX-1' }, amount: money('EUR', 40000n), status: 'PENDING' });
    expect(await h.pm.issuePaymentSecret('ord-1')).toBe('MOCK_pi_secret_1');
  });

  it('a lost answer is resolved by reading the prebook, never by attaching again', async () => {
    let h = await started();
    h.port.attachScript.push(unknown());
    h.port.readPaymentScript.push(ok({ transactionId: opaque('MOCK-TX-2'), clientSecret: 'MOCK_pi_secret_2', amountToCharge: money('EUR', 41500n) }));
    expect(await h.pm.attachServices('ord-1', request(), 'customer')).toMatchObject({ outcome: 'ATTACHED' });
    expect(h.port.count('attach')).toBe(1);

    h = await started();
    h.port.attachScript.push(unknown());
    expect(await h.pm.attachServices('ord-1', request(), 'customer')).toEqual({ outcome: 'REJECTED', code: 'NOT_ATTACHED' });
    expect(state(h).status).toBe('PROCESSING');

    h = await started();
    h.port.attachScript.push(unknown());
    h.port.readPaymentScript.push(unknown());
    expect(await h.pm.attachServices('ord-1', request(), 'customer')).toEqual({ outcome: 'FAILED' });
    const s = state(h);
    expect(s.status).toBe('CANCELLED');
    expect(s.items[0]!.booking.failureCode).toBe('SERVICES_UNCONFIRMED');
    // No payment form was ever shown: no payment hold to report.
    expect(s.tasks).toEqual([]);
    expect(h.store.outbox.find((e) => e.type === 'order.provider_managed.failed')!.payload).toMatchObject({ mayHoldPayment: false });

    // After a lost answer a refused read proves nothing: the old intent may already be stale.
    h = await started();
    h.port.attachScript.push(unknown());
    h.port.readPaymentScript.push(rejected('NUITEE_FLIGHT_PREBOOK_NOT_FOUND'));
    expect(await h.pm.attachServices('ord-1', request(), 'customer')).toEqual({ outcome: 'FAILED' });
    expect(state(h).items[0]!.booking.failureCode).toBe('SERVICES_UNCONFIRMED');
    expect(await h.pm.issuePaymentSecret('ord-1')).toBeNull();
  });

  it('the same payment intent at another amount is not trusted: the checkout ends before any payment', async () => {
    const h = await started();
    h.port.attachScript.push(ok({ transactionId: opaque('MOCK-TX-1'), clientSecret: 'MOCK_pi_secret_1', amountToCharge: money('EUR', 41500n) }));
    expect(await h.pm.attachServices('ord-1', request(), 'customer')).toEqual({ outcome: 'FAILED' });
    expect(state(h)).toMatchObject({ status: 'CANCELLED' });
    expect(state(h).items[0]!.booking.failureCode).toBe('SERVICES_UNCONFIRMED');
    expect(await h.pm.issuePaymentSecret('ord-1')).toBeNull();
  });

  it('K15: attached at another amount than accepted ends the checkout before any payment', async () => {
    const h = await started();
    h.port.attachScript.push(ok({ transactionId: opaque('MOCK-TX-2'), clientSecret: 'MOCK_pi_secret_2', amountToCharge: money('EUR', 41600n) }));
    expect(await h.pm.attachServices('ord-1', request(), 'customer')).toEqual({ outcome: 'PRICE_CHANGED' });
    const s = state(h);
    expect(s.status).toBe('CANCELLED');
    expect(s.payment).toMatchObject({ status: 'DECLINED', providerClientSecret: null, amount: money('EUR', 40000n) });
    expect(s.items[0]!.booking.failureCode).toBe('QUOTE_CHANGED:CHARGE_AMOUNT');
    expect(await h.pm.issuePaymentSecret('ord-1')).toBeNull();
  });

  it('a crashed attach call expires into an ended checkout; no secret is handed out while it is in flight', async () => {
    const clock = { now: NOW };
    const h = harness(clock, 'FLIGHT');
    await h.pm.start('ord-1');
    h.port.attachServices = async () => {
      // While the call is in flight the payment form is not handed out.
      expect(await h.pm.issuePaymentSecret('ord-1')).toBeNull();
      throw new Error('worker crashed');
    };
    await expect(h.pm.attachServices('ord-1', request(), 'customer')).rejects.toThrow('worker crashed');
    expect(state(h).items[0]!.booking.intent).toMatchObject({ op: 'SERVICES' });
    clock.now = new Date(NOW.getTime() + 301_000);
    expect((await h.pm.finalize('ord-1')).type).toBe('INTENT_EXPIRED');
    expect(state(h)).toMatchObject({ status: 'CANCELLED' });
    expect(state(h).items[0]!.booking.failureCode).toBe('SERVICES_UNCONFIRMED');
  });

  it('an abandoned flight checkout whose payment form was never shown involves no money', async () => {
    const clock = { now: NOW };
    const h = harness(clock, 'FLIGHT');
    await h.pm.start('ord-1');
    clock.now = new Date(PAY_BY);
    await h.pm.finalize('ord-1');
    expect(state(h).tasks).toEqual([]);
    expect(h.store.outbox.find((e) => e.type === 'order.provider_managed.failed')!.payload).toMatchObject({ code: 'CHECKOUT_EXPIRED', mayHoldPayment: false });
  });
});

