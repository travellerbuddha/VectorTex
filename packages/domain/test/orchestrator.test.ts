import { describe, expect, it } from 'vitest';
import { money } from '@texholiday/pricing';
import { decideNextAction, PackageOrchestrator, totalSupplierLoss, type OrderAggregate, type OrderItemState } from '../src/index';
import { FakeBookingPort, FakeGateway, ok, providerState, rejected, snapshot, unknown } from './support/fakes';
import { FLIGHT, HOTEL, makeOrder, NOW, policy, TRANSFER } from './support/fixtures';
import { InMemoryOrderStore } from './support/memory-store';

function harness(order: OrderAggregate, opts: { clock?: () => Date } = {}) {
  const store = new InMemoryOrderStore();
  store.put(order);
  const gateway = new FakeGateway(order.payment!.amount);
  const ports: Record<string, FakeBookingPort> = {
    HOTEL: new FakeBookingPort(),
    TRANSFER: new FakeBookingPort(),
    FLIGHT: new FakeBookingPort(true),
    EXPERIENCE: new FakeBookingPort(),
  };
  const make = (workerId: string) =>
    new PackageOrchestrator({
      store,
      gateway: () => gateway,
      bookings: (it: OrderItemState) => ports[it.productType] as FakeBookingPort,
      clock: opts.clock ?? (() => NOW),
      workerId,
      serverIp: '10.0.0.1',
      policy,
    });
  return { store, gateway, ports, orchestrator: make('w1'), make };
}

const status = (store: InMemoryOrderStore) => store.peek('ord-1');
const bookingStatus = (store: InMemoryOrderStore, id: string) => status(store).items.find((i) => i.id === id)!.booking.status;

describe('package orchestrator happy path', () => {
  it('books in reversibility order, ticketing last, then captures exactly once', async () => {
    const h = harness(makeOrder());
    await h.orchestrator.drive('ord-1');
    const s = status(h.store);
    expect(s.status).toBe('CONFIRMED');
    expect(s.payment!.status).toBe('CAPTURED');
    expect(h.gateway.count('capture')).toBe(1);
    expect(h.gateway.count('void')).toBe(0);
    const sequence = [...h.ports.HOTEL!.calls, ...h.ports.TRANSFER!.calls, ...h.ports.FLIGHT!.calls].map((c) => `${c.op}:${c.itemId}`);
    expect(sequence).toEqual(['prebook:item-hotel', 'book:item-hotel', 'book:item-transfer', 'prebook:item-flight', 'book:item-flight']);
    // Outbox: confirmation event emitted once.
    expect(h.store.outbox.filter((e) => e.type === 'order.confirmed')).toHaveLength(1);
  });

  it('T08: a PNR without issued tickets is not final; capture waits for ticketing', async () => {
    const h = harness(makeOrder({ items: [FLIGHT] }));
    h.ports.FLIGHT!.bookScript.push(ok(providerState('CONFIRMED', { pnr: 'ABC123', ticketNumbers: [] })));
    h.ports.FLIGHT!.refreshScript.push(ok(providerState('CONFIRMED', { pnr: 'ABC123', ticketNumbers: [] })));
    await h.orchestrator.drive('ord-1');
    expect(h.gateway.count('capture')).toBe(0);
    expect(status(h.store).items[0]!.booking.ticketing).toBe('PENDING');
    h.ports.FLIGHT!.refreshScript.push(ok(providerState('CONFIRMED', { pnr: 'ABC123', ticketNumbers: ['2351234567890'] })));
    await h.orchestrator.drive('ord-1');
    expect(status(h.store).status).toBe('CONFIRMED');
    expect(h.gateway.count('capture')).toBe(1);
  });

  it('T10: pending asynchronous confirmation is never treated as confirmed', async () => {
    const h = harness(makeOrder({ items: [{ id: 'item-exp', productType: 'EXPERIENCE', rank: 15, needsPrebook: true, charge: 1000n }] }));
    h.ports.EXPERIENCE!.bookScript.push(ok(providerState('PENDING_CONFIRMATION', { voucherReady: false })));
    h.ports.EXPERIENCE!.refreshScript.push(ok(providerState('PENDING_CONFIRMATION', { voucherReady: false })));
    await h.orchestrator.drive('ord-1');
    await h.orchestrator.drive('ord-1');
    expect(bookingStatus(h.store, 'item-exp')).toBe('PENDING_CONFIRMATION');
    expect(h.gateway.count('capture')).toBe(0);
    expect(status(h.store).status).toBe('PROCESSING');
  });
});

describe('T16 fraud review / T14 payment mismatch', () => {
  it('does not book while the gateway reports fraud review', async () => {
    const order = makeOrder({ payment: 'FRAUD_REVIEW' });
    const h = harness(order);
    await h.orchestrator.drive('ord-1');
    expect(h.ports.HOTEL!.calls).toHaveLength(0);
    expect(status(h.store).tasks.map((t) => t.reason)).toContain('FRAUD_REVIEW');
  });

  it('compensates (void, no booking) when the verified payment does not match the order', async () => {
    const order = makeOrder({ payment: 'UNKNOWN' });
    const h = harness(order);
    h.gateway.retrieveScript.push(ok(snapshot('AUTHORIZED', money('EUR', 1n))));
    await h.orchestrator.drive('ord-1');
    const s = status(h.store);
    expect(s.payment!.mismatch).toBe(true);
    expect(h.ports.HOTEL!.calls).toHaveLength(0);
    expect(h.gateway.count('void')).toBe(1);
    expect(s.status).toBe('CANCELLED');
  });

  it('nothing side-effecting happens before authorization', async () => {
    const h = harness(makeOrder({ payment: 'PENDING' }));
    const r = await h.orchestrator.drive('ord-1');
    expect(r.at(-1)!.action).toEqual({ type: 'WAIT', reason: 'AWAITING_CUSTOMER_PAYMENT' });
    expect(Object.values(h.ports).every((p) => p.calls.length === 0)).toBe(true);
  });
});

describe('T17 double click / two workers', () => {
  it('two workers stepping concurrently send the provider call once', async () => {
    const h = harness(makeOrder({ items: [TRANSFER] }));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.ports.TRANSFER!.bookScript.push(async () => {
      await gate;
      return ok(providerState('CONFIRMED'));
    });
    const w1 = h.make('w1');
    const w2 = h.make('w2');
    const p1 = w1.step('ord-1');
    const p2 = w2.step('ord-1');
    await new Promise((r) => setTimeout(r, 10));
    release();
    const results = await Promise.all([p1, p2]);
    expect(h.ports.TRANSFER!.count('book')).toBe(1);
    expect(results.filter((r) => r.progressed)).toHaveLength(1);
    expect(bookingStatus(h.store, 'item-transfer')).toBe('CONFIRMED');
  });
});

describe('T19 lost provider create response', () => {
  it('resolves by client-reference lookup and never books twice', async () => {
    const h = harness(makeOrder({ items: [HOTEL] }));
    h.ports.HOTEL!.bookScript.push(unknown());
    h.ports.HOTEL!.lookupScript.push(ok(providerState('CONFIRMED')));
    await h.orchestrator.drive('ord-1');
    expect(bookingStatus(h.store, 'item-hotel')).toBe('UNKNOWN');
    expect(status(h.store).tasks.map((t) => t.reason)).toContain('BOOKING_UNKNOWN');
    await h.orchestrator.drive('ord-1');
    expect(h.ports.HOTEL!.count('book')).toBe(1);
    expect(h.ports.HOTEL!.count('lookup')).toBe(1);
    expect(status(h.store).status).toBe('CONFIRMED');
    expect(h.gateway.count('capture')).toBe(1);
  });

  it('keeps looking up (no re-book, no refund, no void) and escalates after the lookup budget', async () => {
    const h = harness(makeOrder({ items: [HOTEL] }));
    h.ports.HOTEL!.bookScript.push(unknown());
    for (let i = 0; i < 6; i += 1) await h.orchestrator.drive('ord-1');
    const s = status(h.store);
    expect(h.ports.HOTEL!.count('book')).toBe(1);
    expect(h.ports.HOTEL!.count('lookup')).toBeGreaterThanOrEqual(policy.maxAutomaticLookups);
    expect(h.gateway.count('void')).toBe(0);
    expect(h.gateway.count('capture')).toBe(0);
    expect(s.status).toBe('ACTION_REQUIRED');
  });

  it('a crashed worker leaves an intent that expires into UNKNOWN, then lookup (no blind retry)', async () => {
    const order = makeOrder({ items: [TRANSFER] });
    order.items[0]!.booking.intent = { op: 'BOOK', startedAt: '2026-10-09T09:00:00.000Z', leaseUntil: '2026-10-09T09:05:00.000Z', workerId: 'dead' };
    order.items[0]!.booking.clientReference = 'pb-item-transfer-1';
    order.items[0]!.booking.clientReferenceSeq = 1;
    const h = harness(order);
    h.ports.TRANSFER!.lookupScript.push(ok(providerState('CONFIRMED')));
    await h.orchestrator.drive('ord-1');
    expect(h.ports.TRANSFER!.count('book')).toBe(0);
    expect(h.ports.TRANSFER!.count('lookup')).toBe(1);
    expect(status(h.store).status).toBe('CONFIRMED');
  });
});

describe('T20 lost capture response', () => {
  it('queries the gateway and never captures twice', async () => {
    const h = harness(makeOrder({ items: [TRANSFER] }));
    h.gateway.captureScript.push(unknown());
    h.gateway.retrieveScript.push(ok(snapshot('CAPTURED', status(h.store).payment!.amount)));
    await h.orchestrator.drive('ord-1');
    await h.orchestrator.drive('ord-1');
    expect(h.gateway.count('capture')).toBe(1);
    expect(status(h.store).status).toBe('CONFIRMED');
  });

  it('if retrieve still shows AUTHORIZED after an unknown capture, a human decides', async () => {
    const h = harness(makeOrder({ items: [TRANSFER] }));
    h.gateway.captureScript.push(unknown());
    h.gateway.retrieveScript.push(ok(snapshot('AUTHORIZED', status(h.store).payment!.amount)));
    await h.orchestrator.drive('ord-1');
    await h.orchestrator.drive('ord-1');
    await h.orchestrator.drive('ord-1');
    expect(h.gateway.count('capture')).toBe(1);
    expect(status(h.store).status).toBe('ACTION_REQUIRED');
  });
});

describe('T24 failure at each package step', () => {
  const cases: Array<{ name: string; arrange: (h: ReturnType<typeof harness>) => void; cancelled: string[] }> = [
    { name: 'hotel prebook rejected', arrange: (h) => h.ports.HOTEL!.prebookScript.push(rejected()), cancelled: [] },
    { name: 'hotel book rejected', arrange: (h) => h.ports.HOTEL!.bookScript.push(rejected()), cancelled: [] },
    { name: 'transfer book rejected', arrange: (h) => h.ports.TRANSFER!.bookScript.push(rejected()), cancelled: ['item-hotel'] },
    { name: 'flight prebook rejected', arrange: (h) => h.ports.FLIGHT!.prebookScript.push(rejected()), cancelled: ['item-hotel', 'item-transfer'] },
    { name: 'flight book rejected', arrange: (h) => h.ports.FLIGHT!.bookScript.push(rejected()), cancelled: ['item-hotel', 'item-transfer'] },
    {
      name: 'flight ticketing failed',
      arrange: (h) => {
        h.ports.FLIGHT!.bookScript.push(ok(providerState('CONFIRMED', { pnr: 'P1', ticketingStatus: 'PENDING' })));
        h.ports.FLIGHT!.refreshScript.push(ok(providerState('CONFIRMED', { pnr: 'P1', ticketingStatus: 'FAILED' })));
      },
      cancelled: ['item-hotel', 'item-transfer', 'item-flight'],
    },
  ];

  for (const c of cases) {
    it(`${c.name}: compensates created bookings, voids once, never captures`, async () => {
      const h = harness(makeOrder());
      c.arrange(h);
      await h.orchestrator.drive('ord-1', 100);
      const s = status(h.store);
      expect(s.status).toBe('CANCELLED');
      expect(h.gateway.count('capture')).toBe(0);
      expect(h.gateway.count('void')).toBe(1);
      for (const id of c.cancelled) {
        expect(bookingStatus(h.store, id)).toBe('CANCELLED');
      }
      const allPorts = Object.values(h.ports);
      expect(allPorts.reduce((n, p) => n + p.count('cancel'), 0)).toBe(c.cancelled.length);
      expect(s.items.every((i) => ['NEW', 'CANCELLED', 'FAILED'].includes(i.booking.status))).toBe(true);
    });
  }

  it('records the supplier penalty of a compensating cancellation as our loss (no customer charge)', async () => {
    const h = harness(makeOrder());
    h.ports.TRANSFER!.bookScript.push(rejected());
    h.ports.HOTEL!.cancelScript.push(ok({ ...providerState('CANCELLED'), penalty: money('EUR', 1200n) }));
    await h.orchestrator.drive('ord-1', 100);
    const s = status(h.store);
    expect(totalSupplierLoss(s, 'EUR')).toEqual(money('EUR', 1200n));
    expect(s.tasks.map((t) => t.reason)).toContain('SUPPLIER_LOSS_RECORDED');
    expect(h.gateway.count('capture')).toBe(0);
  });

  it('a rejected compensating cancellation stops for a human before voiding', async () => {
    const h = harness(makeOrder());
    h.ports.TRANSFER!.bookScript.push(rejected());
    h.ports.HOTEL!.cancelScript.push(rejected('NON_REFUNDABLE'));
    await h.orchestrator.drive('ord-1', 100);
    const s = status(h.store);
    expect(s.status).toBe('ACTION_REQUIRED');
    expect(s.tasks.map((t) => t.reason)).toContain('COMPENSATION_FAILED');
    expect(bookingStatus(h.store, 'item-hotel')).toBe('CONFIRMED');
    expect(h.gateway.count('void')).toBe(0);
  });

  it('a changed price at prebook needs new acceptance: compensate instead of booking', async () => {
    const h = harness(makeOrder());
    h.ports.HOTEL!.prebookScript.push(ok({ prebookRef: 'MOCK-PRE' as never, expiresAt: null, inventoryHeld: false, differences: ['CHARGE_AMOUNT'] }));
    await h.orchestrator.drive('ord-1', 100);
    const s = status(h.store);
    expect(h.ports.HOTEL!.count('book')).toBe(0);
    expect(s.status).toBe('CANCELLED');
    expect(s.compensationReason).toMatch(/^QUOTE_CHANGED/);
    expect(h.gateway.count('void')).toBe(1);
  });
});

describe('T25 uncertain component inside a package', () => {
  it('does not compensate, void or refund while a component is UNKNOWN', async () => {
    const h = harness(makeOrder());
    h.ports.TRANSFER!.bookScript.push(unknown());
    h.ports.TRANSFER!.lookupScript.push(ok(null), ok(providerState('FAILED')));
    await h.orchestrator.drive('ord-1');
    await h.orchestrator.drive('ord-1');
    expect(bookingStatus(h.store, 'item-transfer')).toBe('UNKNOWN');
    expect(h.ports.HOTEL!.count('cancel')).toBe(0);
    expect(h.gateway.count('void')).toBe(0);
    // Resolution arrives: FAILED -> now compensation is allowed.
    await h.orchestrator.drive('ord-1', 100);
    expect(bookingStatus(h.store, 'item-transfer')).toBe('FAILED');
    expect(bookingStatus(h.store, 'item-hotel')).toBe('CANCELLED');
    expect(h.gateway.count('void')).toBe(1);
    expect(status(h.store).status).toBe('CANCELLED');
  });
});

describe('T26 suppliers succeeded, capture failed', () => {
  it('goes to ACTION_REQUIRED with BOOKED_UNPAID; no second capture, no void', async () => {
    const h = harness(makeOrder());
    h.gateway.captureScript.push(rejected('CAPTURE_DECLINED'));
    await h.orchestrator.drive('ord-1', 100);
    await h.orchestrator.drive('ord-1', 100);
    const s = status(h.store);
    expect(s.status).toBe('ACTION_REQUIRED');
    expect(s.tasks.map((t) => t.reason)).toContain('BOOKED_UNPAID');
    expect(h.gateway.count('capture')).toBe(1);
    expect(h.gateway.count('void')).toBe(0);
    expect(s.items.every((i) => i.booking.status === 'CONFIRMED')).toBe(true);
  });
});

describe('deadlines', () => {
  it('stops for a human before the authorization expires; never auto-voids or captures', async () => {
    const order = makeOrder({ authorizationExpiresAt: '2026-10-09T10:30:00.000Z' });
    const h = harness(order);
    await h.orchestrator.drive('ord-1');
    const s = status(h.store);
    expect(s.status).toBe('ACTION_REQUIRED');
    expect(s.tasks.map((t) => t.reason)).toContain('AUTHORIZATION_EXPIRING');
    expect(h.gateway.count('void') + h.gateway.count('capture')).toBe(0);
  });

  it('an expired prebook is not booked on the old acceptance', async () => {
    const order = makeOrder({ items: [HOTEL] });
    order.items[0]!.booking.status = 'PREPARED';
    order.items[0]!.booking.prebookExpiresAt = '2026-10-09T09:59:00.000Z';
    const h = harness(order);
    await h.orchestrator.drive('ord-1', 100);
    expect(h.ports.HOTEL!.count('book')).toBe(0);
    expect(status(h.store).status).toBe('CANCELLED');
  });
});

describe('T18 out-of-order information never regresses state', () => {
  it('a stale AUTHORIZED snapshot does not undo CAPTURED', async () => {
    const order = makeOrder({ items: [TRANSFER], payment: 'CAPTURE_PENDING' });
    order.items[0]!.booking.status = 'CONFIRMED';
    const h = harness(order);
    h.gateway.retrieveScript.push(ok(snapshot('CAPTURED', order.payment!.amount)));
    await h.orchestrator.step('ord-1');
    expect(status(h.store).payment!.status).toBe('CAPTURED');
    // A late, older notification-triggered retrieve.
    const agg = h.store.peek('ord-1');
    agg.payment!.status = 'CAPTURED';
    h.gateway.retrieveScript.push(ok(snapshot('AUTHORIZED', order.payment!.amount)));
    const next = decideNextAction(h.store.peek('ord-1'), NOW, policy);
    expect(next.type).toBe('MARK_ORDER_CONFIRMED');
  });
});
