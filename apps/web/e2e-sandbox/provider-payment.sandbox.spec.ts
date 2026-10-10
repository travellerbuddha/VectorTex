import { expect, test } from '@playwright/test';
import { opaque } from '@texholiday/contracts';
import { evidence, payWithTestCard, sandboxHotelConnector } from './support';

/**
 * Nuitee provider-managed payment, connector level (ADR-0008), once per currency. Records the provider behaviour the
 * orchestrator relies on:
 * 1. book before paying → "payment not completed", and that reference is used up (repeat = 4005, lookup = none);
 * 2. after paying in the real component (test card), a NEW reference books: CONFIRMED at the prebook price;
 * 3. a repeat of that reference is a duplicate (UNKNOWN → lookup finds the booking);
 * 4. the transaction is single-use: another reference answers "payment not completed" (no second booking);
 * then the booking is cancelled. The component is served on a stand-in https origin (no local web server needed).
 */
const currencies = (process.env.SANDBOX_PAYMENT_CURRENCIES ?? 'EUR').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
const hotelIds = (process.env.NUITEE_SANDBOX_HOTEL_IDS ?? 'lp1897').split(',');
// TEST-ONLY margin mirroring the e2e policy (10%); real margins come from approved policies (G06).
const MARGIN_BP = 1000;
const ORIGIN = 'https://payment-harness.texholiday.test';
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

for (const currency of currencies) {
  test(`provider-managed payment and TRANSACTION_ID booking in ${currency} (sandbox)`, async ({ page }) => {
    const c = sandboxHotelConnector();
    const search = await c.searchRates({
      hotelIds,
      checkin: day(60),
      checkout: day(62),
      occupancies: [{ occupancyNumber: 1, adults: 2, childAges: [] }],
      guestNationality: 'TR',
      currency,
      margin: { basisPoints: MARGIN_BP },
    });
    evidence('pm.search', { currency, kind: search.kind, offers: search.kind === 'SUCCEEDED' ? search.value.length : null });
    expect(search.kind).toBe('SUCCEEDED');
    if (search.kind !== 'SUCCEEDED') return;
    // Refundable offers payable through the component, cheapest first; prices move, so a refused prebook tries the next.
    const candidates = search.value
      .filter((o) => o.cancellation.refundable && o.paymentTypes.includes('NUITEE_PAY'))
      .sort((a, b) => Number(a.price.minor - b.price.minor))
      .slice(0, 6);
    expect(candidates.length).toBeGreaterThan(0);

    const base = `th-sbx-pm-${currency.toLowerCase()}-${Date.now()}`;
    let pre: Awaited<ReturnType<typeof c.prebook>> | null = null;
    let offer = candidates[0]!;
    for (const candidate of candidates) {
      offer = candidate;
      pre = await c.prebook({ offerRef: candidate.offerRef, usePaymentSdk: true, clientReference: `${base}-pre` });
      if (pre.kind === 'SUCCEEDED') break;
    }
    expect(pre?.kind).toBe('SUCCEEDED');
    if (!pre || pre.kind !== 'SUCCEEDED') return;
    const { prebookRef, providerManagedTransaction: tx, paymentClientSecret, offer: quoted } = pre.value;
    expect(tx).not.toBeNull();
    expect(paymentClientSecret).not.toBeNull();
    expect(quoted.price.currency).toBe(currency);
    evidence('pm.prebook', { currency, prebookRef, transactionId: tx!.transactionId, price: quoted.price, commission: quoted.providerAppliedMargin, flags: pre.value.changeFlags });

    const holder = { firstName: 'Sandbox', lastName: 'Tester', email: 'sandbox-tester@example.invalid', phone: '+900000000000' };
    const book = (clientReference: string) =>
      c.book({
        prebookRef,
        clientReference,
        holder,
        guests: offer.occupancyNumbers.map((n) => ({ occupancyNumber: n, leadGuest: { firstName: 'Sandbox', lastName: 'Tester', email: 'sandbox-tester@example.invalid' } })),
        funding: { kind: 'PROVIDER_MANAGED', transaction: tx! },
      });

    // 1. Not paid yet: "payment not completed", and the reference is used up without a booking.
    const unpaid = await book(`${base}-1`);
    evidence('pm.book_before_payment', { currency, kind: unpaid.kind, code: unpaid.kind === 'REJECTED' ? unpaid.code : null });
    expect(unpaid).toMatchObject({ kind: 'REJECTED', code: 'NUITEE_PAYMENT_NOT_COMPLETED' });

    // 2. The customer pays in the real component (publicKey 'sandbox', Stripe test card).
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script src="https://payment-wrapper.liteapi.travel/dist/liteAPIPayment.js?v=a1"></script></head><body><div id="target"></div><script>
new LiteAPIPayment({ publicKey: 'sandbox', appearance: { theme: 'flat' }, options: { business: { name: 'TexHoliday' } }, targetElement: '#target', secretKey: ${JSON.stringify(paymentClientSecret)}, returnUrl: ${JSON.stringify(`${ORIGIN}/return`)} }).handlePayment();
</script></body></html>`;
    await page.route(`${ORIGIN}/**`, (route) =>
      route.fulfill({ contentType: 'text/html', body: route.request().url().startsWith(`${ORIGIN}/return`) ? '<!doctype html><title>returned</title><h1>returned</h1>' : html }),
    );
    await page.goto(`${ORIGIN}/pay`);
    await payWithTestCard(page);
    await page.waitForURL(`${ORIGIN}/return**`, { timeout: 90_000 });
    const returned = new URL(page.url());
    evidence('pm.payment_return', { currency, redirectStatus: returned.searchParams.get('redirect_status'), params: [...returned.searchParams.keys()] });
    expect(returned.searchParams.get('redirect_status')).toBe('succeeded');

    const reused = await book(`${base}-1`);
    const reusedLookup = await c.lookupByClientReference(`${base}-1`);
    evidence('pm.used_up_reference_after_payment', { currency, book: reused.kind, lookup: reusedLookup.kind === 'SUCCEEDED' ? reusedLookup.value : reusedLookup.kind });
    expect(reused.kind).toBe('UNKNOWN'); // 4005 duplicate
    expect(reusedLookup).toMatchObject({ kind: 'SUCCEEDED', value: null });

    // 3. A new reference books: confirmed, charged the quoted price, commission reported (ADR-0006).
    const booked = await book(`${base}-2`);
    evidence('pm.book', booked.kind === 'SUCCEEDED' ? { currency, kind: booked.kind, ref: booked.value.providerBookingRef, status: booked.value.status, supplierCost: booked.value.supplierCost, providerCommission: booked.value.providerCommission } : { currency, ...booked });
    expect(booked.kind).toBe('SUCCEEDED');
    if (booked.kind !== 'SUCCEEDED') return;
    const ref = booked.value.providerBookingRef!;
    try {
      expect(booked.value.status).toBe('CONFIRMED');
      expect(booked.value.supplierCost).toEqual(quoted.price);

      // 4. A repeat (e.g. after a lost response) is a duplicate, resolved by lookup; never a second booking.
      const repeat = await book(`${base}-2`);
      const lookup = await c.lookupByClientReference(`${base}-2`);
      evidence('pm.book_repeat', { currency, kind: repeat.kind, lookup: lookup.kind === 'SUCCEEDED' ? { ref: lookup.value?.providerBookingRef ?? null, status: lookup.value?.status ?? null } : lookup.kind });
      expect(repeat.kind).toBe('UNKNOWN');
      expect(lookup).toMatchObject({ kind: 'SUCCEEDED', value: { providerBookingRef: ref, status: 'CONFIRMED' } });

      // 5. The transaction is single-use: another reference cannot book again.
      const second = await book(`${base}-3`);
      evidence('pm.transaction_reuse', { currency, kind: second.kind, code: second.kind === 'REJECTED' ? second.code : null });
      expect(second).toMatchObject({ kind: 'REJECTED', code: 'NUITEE_PAYMENT_NOT_COMPLETED' });
    } finally {
      const cancel = await c.cancel(opaque(ref));
      evidence('pm.cancel', cancel.kind === 'SUCCEEDED' ? { currency, kind: cancel.kind, ref, status: cancel.value.status, penalty: cancel.value.penalty } : { currency, ref, ...cancel });
      expect(cancel).toMatchObject({ kind: 'SUCCEEDED', value: { status: 'CANCELLED' } });
    }
  });
}
