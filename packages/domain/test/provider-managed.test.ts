import { describe, expect, it } from 'vitest';
import { opaque, type ExternalOutcome, type ProviderBookingState } from '@texholiday/contracts';
import { money } from '@texholiday/pricing';
import {
  ProviderManagedOrchestrator,
  decideProviderManaged,
  type OrderAggregate,
  type OrderItemState,
  type ProviderManagedBookingPort,
  type ProviderManagedPrebook,
} from '../src/index';
import { ok, providerState, rejected, unknown } from './support/fakes';
import { HOTEL, NOW, makeOrder } from './support/fixtures';
import { InMemoryOrderStore } from './support/memory-store';

/** TEST DOUBLE for the provider-managed booking port (MOCK). */
class FakePmPort implements ProviderManagedBookingPort {
  readonly calls: Array<{ op: string; clientReference?: string; transactionId?: string }> = [];
  prebookScript: Array<ExternalOutcome<ProviderManagedPrebook>> = [];
  bookScript: Array<ExternalOutcome<ProviderBookingState>> = [];
  lookupScript: Array<ExternalOutcome<ProviderBookingState | null>> = [];
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
  count(op: string) {
    return this.calls.filter((c) => c.op === op).length;
  }
}

const PAY_BY = new Date(NOW.getTime() + 30 * 60_000).toISOString();

function pmOrder(): OrderAggregate {
  const o = makeOrder({ items: [{ ...HOTEL, commission: 4500n }], payment: 'NEW' });
  o.route = { mode: 'PROVIDER_MANAGED', providerId: 'nuitee', productType: 'HOTEL', currency: 'EUR', policyVersion: 'pp@1' };
  o.items[0]!.funding = { method: 'PROVIDER_MANAGED', capabilityId: 'nuitee.hotel.provider_managed' };
  Object.assign(o.payment!, { gatewayId: 'nuitee', sessionRef: null, gatewayPaymentId: null, fraud: 'NOT_PROVIDED', authorizationExpiresAt: null, payBy: PAY_BY });
  return o;
}

function harness(clock: { now: Date } = { now: NOW }) {
  const store = new InMemoryOrderStore();
  store.put(pmOrder());
  const port = new FakePmPort();
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
