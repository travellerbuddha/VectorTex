import { expect, test, type Page } from '@playwright/test';
import { add } from '@texholiday/pricing';
import { opaque, type FlightBookingState, type FlightConnector, type FlightOffer, type FlightPassenger, type FlightPrebook, type FlightPrebookState, type FlightService, type OpaqueRef } from '@texholiday/contracts';
import { evidence, payWithTestCard, sandboxFlightConnector } from './support';

/**
 * Nuitee flights, provider-managed payment, connector level. Records the provider behaviour a flight checkout would
 * rely on: search → verify → prebook (amount to charge = verified price) → payment component with Stripe's test card →
 * book with TRANSACTION_ID → repeat is idempotent (same booking) → status until confirmed → cancellation quote → cancel.
 * A second test records that the sandbox does not refuse a booking sent before payment (the guide says production
 * does). Every booking made here is cancelled. Passenger and contact data are fictional test values.
 */
const ORIGIN = 'https://payment-harness.texholiday.test';
// TEST-ONLY markup mirroring the e2e pricing policy (10%); real markups come from approved policies (G06).
const MARGIN_BP = 1000;
const route = { origin: process.env.SANDBOX_FLIGHT_ORIGIN ?? 'IST', destination: process.env.SANDBOX_FLIGHT_DESTINATION ?? 'AYT' };
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const passenger: FlightPassenger = {
  type: 'ADULT',
  firstName: 'Sandbox',
  lastName: 'Tester',
  middleName: null,
  birthDate: '1990-01-15',
  gender: 'M',
  nationality: 'TR',
  document: { type: 'passport', number: 'U00000003', issuingCountry: 'TR', expiresOn: day(1500) },
};
// The provider refused a placeholder number with HTTP 500 (53099): a well-formed, fictional mobile number is used.
const contact = { email: 'sandbox-flight@example.invalid', firstName: 'Sandbox', lastName: 'Tester', phoneCountryCode: '90', phoneNumber: '5321234567' };

/** Search + verify + prebook on the cheapest offers; prices move, so a refused step tries the next offer. */
async function prebookCheapest(c: FlightConnector, label: string, daysAhead: number, margin: { basisPoints: number; seatsBasisPoints?: number; bagsBasisPoints?: number } = { basisPoints: MARGIN_BP }): Promise<{ offer: FlightOffer; pre: FlightPrebook }> {
  const search = await c.searchRates({ legs: [{ ...route, date: day(daysAhead) }], adults: 1, childAges: [], infantAges: [], cabinClass: null, pointOfSale: 'TR', currency: 'EUR', margin });
  evidence(`${label}.search`, { kind: search.kind, offers: search.kind === 'SUCCEEDED' ? search.value.length : null });
  expect(search.kind).toBe('SUCCEEDED');
  if (search.kind !== 'SUCCEEDED') throw new Error('search');
  const candidates = [...search.value].sort((a, b) => Number(a.price.minor - b.price.minor)).slice(0, 5);
  expect(candidates.length).toBeGreaterThan(0);
  for (const candidate of candidates) {
    const verified = await c.verify({ offerRef: candidate.offerRef });
    evidence(`${label}.verify`, verified.kind === 'SUCCEEDED' ? { kind: verified.kind, price: verified.value.offer.price, changes: verified.value.changes, refundable: verified.value.offer.terms.refundable } : verified);
    if (verified.kind !== 'SUCCEEDED') continue;
    const pre = await c.prebook({ offerRef: candidate.offerRef, usePaymentSdk: true, contact, passengers: [passenger] });
    evidence(
      `${label}.prebook`,
      pre.kind === 'SUCCEEDED'
        ? { kind: pre.kind, prebookRef: pre.value.prebookRef, amountToCharge: pre.value.amountToCharge, paymentTypes: pre.value.paymentTypes, servicesAttachable: pre.value.servicesAttachable }
        : pre,
    );
    if (pre.kind === 'SUCCEEDED') return { offer: verified.value.offer, pre: pre.value };
  }
  throw new Error('no offer could be prebooked');
}

async function pay(page: Page, secret: string): Promise<URL> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script src="https://payment-wrapper.liteapi.travel/dist/liteAPIPayment.js?v=a1"></script></head><body><div id="target"></div><script>
new LiteAPIPayment({ publicKey: 'sandbox', appearance: { theme: 'flat' }, options: { business: { name: 'TexHoliday' } }, targetElement: '#target', secretKey: ${JSON.stringify(secret)}, returnUrl: ${JSON.stringify(`${ORIGIN}/return`)} }).handlePayment();
</script></body></html>`;
  await page.route(`${ORIGIN}/**`, (r) =>
    r.fulfill({ contentType: 'text/html', body: r.request().url().startsWith(`${ORIGIN}/return`) ? '<!doctype html><title>returned</title><h1>returned</h1>' : html }),
  );
  await page.goto(`${ORIGIN}/pay`);
  await payWithTestCard(page);
  await page.waitForURL(`${ORIGIN}/return**`, { timeout: 90_000 });
  return new URL(page.url());
}

const stateEvidence = (s: FlightBookingState) => ({
  ref: s.providerBookingRef,
  status: s.status,
  ticketing: s.ticketingStatus,
  hasBookingReference: s.bookingReference !== null,
  airlinePnrs: s.airlineLocators.length,
  paymentStatus: s.paymentStatus,
  supplierCost: s.supplierCost,
  ticketLimitAt: s.ticketLimitAt,
});

/** Reads the booking until it leaves PENDING_CONFIRMATION (or the time is up); returns every distinct state seen. */
async function untilSettled(c: FlightConnector, ref: OpaqueRef, label: string, seconds: number): Promise<FlightBookingState | null> {
  const until = Date.now() + seconds * 1000;
  let last: FlightBookingState | null = null;
  let lastLine = '';
  while (Date.now() < until) {
    const got = await c.getBooking(ref);
    const line = JSON.stringify(got.kind === 'SUCCEEDED' ? stateEvidence(got.value) : { kind: got.kind }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    if (line !== lastLine) evidence(`${label}.status`, { at: new Date().toISOString(), ...JSON.parse(line), ms: got.kind !== 'CAPABILITY_NOT_AVAILABLE' ? got.evidence.durationMs : null });
    lastLine = line;
    if (got.kind === 'SUCCEEDED') {
      last = got.value;
      if (got.value.status !== 'PENDING_CONFIRMATION') return last;
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  return last;
}

async function cancelAndRecord(c: FlightConnector, ref: OpaqueRef, label: string) {
  const quote = await c.cancellationQuote(ref);
  evidence(`${label}.cancel_quote`, quote.kind === 'SUCCEEDED' ? { kind: quote.kind, ...quote.value } : { kind: quote.kind, code: quote.kind === 'REJECTED' ? quote.code : null, http: quote.kind !== 'CAPABILITY_NOT_AVAILABLE' ? quote.evidence.httpStatus : null });
  const cancel = await c.cancel(ref);
  evidence(
    `${label}.cancel`,
    cancel.kind === 'SUCCEEDED' ? { kind: cancel.kind, status: cancel.value.status, penalty: cancel.value.penalty, refund: cancel.value.refundAmount, destination: cancel.value.destination } : { kind: cancel.kind, http: cancel.kind !== 'CAPABILITY_NOT_AVAILABLE' ? cancel.evidence.httpStatus : null },
  );
  const after = await c.getBooking(ref);
  evidence(`${label}.after_cancel`, after.kind === 'SUCCEEDED' ? stateEvidence(after.value) : { kind: after.kind });
  return { cancel, after };
}

type CancelRecord = Awaited<ReturnType<typeof cancelAndRecord>>;

/**
 * The booking must end cancelled or awaiting the airline's cancellation: from the cancel answer itself, or, when that
 * answer was ambiguous (UNKNOWN, e.g. 409), from reading the booking, which is the documented resolution.
 */
const expectCancelAccepted = (r: CancelRecord | null) => {
  const ended = (s: string) => s === 'CANCELLED' || s === 'CANCEL_PENDING';
  if (r?.cancel.kind === 'SUCCEEDED') expect(ended(r.cancel.value.status)).toBe(true);
  else {
    expect(r?.cancel.kind).toBe('UNKNOWN');
    expect(r?.after.kind === 'SUCCEEDED' && ended(r.after.value.status), JSON.stringify(r?.after.kind)).toBe(true);
  }
};

test('flight: payment component, TRANSACTION_ID booking, idempotent repeat, confirmation and cancel (sandbox)', async ({ page }) => {
  test.setTimeout(600_000);
  const c = sandboxFlightConnector();
  const { offer, pre } = await prebookCheapest(c, 'flight.paid', 45);
  // The component charges the prebook amount; the flow compares it with the price the customer accepted.
  expect(pre.amountToCharge).toEqual(offer.price);
  expect(pre.providerManagedTransaction).not.toBeNull();

  const returned = await pay(page, pre.paymentClientSecret!);
  // The return URL carries Stripe's parameters, the client secret among them: never logged, only the names.
  evidence('flight.paid.payment_return', { redirectStatus: returned.searchParams.get('redirect_status'), params: [...returned.searchParams.keys()] });
  expect(returned.searchParams.get('redirect_status')).toBe('succeeded');

  const funding = { kind: 'PROVIDER_MANAGED' as const, transaction: pre.providerManagedTransaction! };
  const booked = await c.book({ prebookRef: pre.prebookRef, clientReference: `th-sbx-fl-${Date.now()}`, funding });
  evidence('flight.paid.book', booked.kind === 'SUCCEEDED' ? stateEvidence(booked.value) : booked);
  expect(booked.kind).toBe('SUCCEEDED');
  if (booked.kind !== 'SUCCEEDED') return;
  const ref = booked.value.providerBookingRef!;
  // Cleanup runs in finally; its assertion comes after, so a failure above is never hidden by it.
  let cancel: CancelRecord | null = null;
  try {
    expect(['PENDING_CONFIRMATION', 'CONFIRMED', 'ISSUED']).toContain(booked.value.status);
    expect(booked.value.supplierCost).toEqual(pre.amountToCharge);

    // A lost answer is resolved by repeating with the same prebook: the same booking comes back, never a second one.
    const repeat = await c.book({ prebookRef: pre.prebookRef, clientReference: booked.value.clientReference, funding });
    evidence('flight.paid.book_repeat', repeat.kind === 'SUCCEEDED' ? stateEvidence(repeat.value) : repeat);
    expect(repeat).toMatchObject({ kind: 'SUCCEEDED', value: { providerBookingRef: ref } });

    // Sandbox confirmation time varies (1-3 minutes on 2026-10-09, sometimes not within 4): an unconfirmed booking is
    // recorded, not failed; a status outside the contract fails.
    const settled = await untilSettled(c, opaque(ref), 'flight.paid', 240);
    expect(['PENDING_CONFIRMATION', 'CONFIRMED', 'ISSUED', 'CANCEL_PENDING', 'CANCELLED']).toContain(settled?.status);
    if (settled?.status === 'PENDING_CONFIRMATION') test.info().annotations.push({ type: 'sandbox', description: 'not confirmed within 240 s' });
  } finally {
    cancel = await cancelAndRecord(c, opaque(ref), 'flight.paid');
  }
  expectCancelAccepted(cancel);
});

test('flight: the sandbox does not refuse a booking sent before payment (documented gap, cancelled)', async () => {
  test.setTimeout(480_000);
  const c = sandboxFlightConnector();
  const { pre } = await prebookCheapest(c, 'flight.unpaid', 46);
  const early = await c.book({ prebookRef: pre.prebookRef, clientReference: `th-sbx-flu-${Date.now()}`, funding: { kind: 'PROVIDER_MANAGED', transaction: pre.providerManagedTransaction! } });
  evidence('flight.unpaid.book_before_payment', early.kind === 'SUCCEEDED' ? stateEvidence(early.value) : early);
  if (early.kind !== 'SUCCEEDED') return;
  const ref = opaque(early.value.providerBookingRef!);
  let cancel: CancelRecord | null = null;
  try {
    await untilSettled(c, ref, 'flight.unpaid', 240);
  } finally {
    cancel = await cancelAndRecord(c, ref, 'flight.unpaid');
  }
  expectCancelAccepted(cancel);
});

const catalogEvidence = (p: FlightPrebookState) => ({
  amount: p.amountToCharge,
  transactionId: p.providerManagedTransaction?.transactionId ?? null,
  servicesExpiresAt: p.servicesExpiresAt,
  seats: p.services.filter((x) => x.category === 'SEAT').length,
  seatsAvailable: p.services.filter((x) => x.seat?.available).length,
  bags: p.services.filter((x) => x.category === 'BAGGAGE').map((x) => ({ name: x.name, price: x.price, passengerType: x.passengerType, segment: x.segmentKey, bag: x.baggage })),
  seatSample: p.services.filter((x) => x.seat?.available).slice(0, 3).map((x) => ({ seat: x.seat, price: x.price, passengerType: x.passengerType, segment: x.segmentKey })),
  attached: p.attached.length,
});

test('flight: a seat and a bag attached before payment: new amount and payment intent, paid, booked at the new amount, cancelled (sandbox)', async ({ page }) => {
  test.setTimeout(600_000);
  const c = sandboxFlightConnector();
  // TEST-ONLY seat and bag markups (10%); real ones come from approved policies (G06).
  const { pre } = await prebookCheapest(c, 'flight.services', 47, { basisPoints: MARGIN_BP, seatsBasisPoints: 1000, bagsBasisPoints: 1000 });
  const before = await c.readPrebook(pre.prebookRef);
  evidence('flight.services.catalog', before.kind === 'SUCCEEDED' ? catalogEvidence(before.value) : before);
  expect(before.kind).toBe('SUCCEEDED');
  if (before.kind !== 'SUCCEEDED') return;
  // The prebook as held: the amount and intent we got at prebook, nothing attached yet.
  expect(before.value.amountToCharge).toEqual(pre.amountToCharge);
  expect(before.value.providerManagedTransaction?.transactionId).toBe(pre.providerManagedTransaction!.transactionId);
  const cheapest = (xs: FlightService[]) => [...xs].sort((a, b) => Number(a.price.minor - b.price.minor))[0];
  const forAdult = (x: FlightService) => x.passengerType === 'ALL' || x.passengerType === 'ADULT';
  const bag = cheapest(before.value.services.filter((x) => x.category === 'BAGGAGE' && forAdult(x)));
  const seat = cheapest(before.value.services.filter((x) => x.category === 'SEAT' && x.seat?.available && forAdult(x)));
  const chosen = [bag, seat].filter((x): x is FlightService => x !== undefined);
  test.skip(chosen.length === 0, 'no attachable services on this offer');
  const attached = await c.attachServices({ prebookRef: pre.prebookRef, selections: chosen.map((x) => ({ serviceRef: x.serviceRef, passengerIndex: 0, quantity: 1 })) });
  const expected = chosen.reduce((acc, x) => add(acc, x.price), pre.amountToCharge);
  evidence(
    'flight.services.attach',
    attached.kind === 'SUCCEEDED'
      ? { ...catalogEvidence(attached.value), chosen: chosen.map((x) => ({ category: x.category, price: x.price })), expected, newIntent: attached.value.providerManagedTransaction?.transactionId !== pre.providerManagedTransaction!.transactionId, newSecret: attached.value.paymentClientSecret !== pre.paymentClientSecret }
      : attached,
  );
  expect(attached.kind).toBe('SUCCEEDED');
  if (attached.kind !== 'SUCCEEDED') return;
  // "Creates a new payment intent": the old one must not be used any more.
  expect(attached.value.providerManagedTransaction?.transactionId).not.toBe(pre.providerManagedTransaction!.transactionId);
  // Sandbox 2026-10-10: the POST answer did not list the attached services; reading the prebook does.
  const after = await c.readPrebook(pre.prebookRef);
  evidence('flight.services.read_after', after.kind === 'SUCCEEDED' ? catalogEvidence(after.value) : after);
  expect(after).toMatchObject({ kind: 'SUCCEEDED', value: { amountToCharge: attached.value.amountToCharge, providerManagedTransaction: { transactionId: attached.value.providerManagedTransaction!.transactionId } } });
  if (after.kind === 'SUCCEEDED') expect(after.value.attached.map((x) => x.serviceRef).sort()).toEqual(chosen.map((x) => x.serviceRef).sort());

  const returned = await pay(page, attached.value.paymentClientSecret!);
  evidence('flight.services.payment_return', { redirectStatus: returned.searchParams.get('redirect_status') });
  expect(returned.searchParams.get('redirect_status')).toBe('succeeded');
  const booked = await c.book({ prebookRef: pre.prebookRef, clientReference: `th-sbx-fls-${Date.now()}`, funding: { kind: 'PROVIDER_MANAGED', transaction: attached.value.providerManagedTransaction! } });
  evidence('flight.services.book', booked.kind === 'SUCCEEDED' ? stateEvidence(booked.value) : booked);
  expect(booked.kind).toBe('SUCCEEDED');
  if (booked.kind !== 'SUCCEEDED') return;
  let cancel: CancelRecord | null = null;
  try {
    // The amount charged with the services; the arithmetic (fare + listed prices) is recorded, not assumed.
    evidence('flight.services.amounts', { fare: pre.amountToCharge, expected, attached: attached.value.amountToCharge, booked: booked.value.supplierCost, exact: attached.value.amountToCharge.minor === expected.minor });
    expect(booked.value.supplierCost).toEqual(attached.value.amountToCharge);
    expect(expected.currency).toBe(attached.value.amountToCharge.currency);
  } finally {
    cancel = await cancelAndRecord(c, opaque(booked.value.providerBookingRef!), 'flight.services');
  }
  expectCancelAccepted(cancel);
});

