import { expect, test, type Page } from '@playwright/test';
import { opaque, type FlightBookingState, type FlightConnector, type FlightOffer, type FlightPassenger, type FlightPrebook, type OpaqueRef } from '@texholiday/contracts';
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
async function prebookCheapest(c: FlightConnector, label: string, daysAhead: number): Promise<{ offer: FlightOffer; pre: FlightPrebook }> {
  const search = await c.searchRates({ legs: [{ ...route, date: day(daysAhead) }], adults: 1, childAges: [], infantAges: [], cabinClass: null, pointOfSale: 'TR', currency: 'EUR', margin: { basisPoints: MARGIN_BP } });
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
