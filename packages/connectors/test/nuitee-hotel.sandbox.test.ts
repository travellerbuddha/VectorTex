import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { opaque } from '@texholiday/contracts';
import { NuiteeHotelConnector } from '../src/index';

/**
 * SANDBOX evidence run (opt-in). Needs NUITEE_API_KEY with NUITEE_KEY_ENVIRONMENT=sandbox; never runs in CI.
 * Booking uses ACC_CREDIT_CARD, which on a sandbox key is a hidden test card (account-credit-card guide);
 * CREDIT is never used (it books for real). The booking step runs only with NUITEE_SANDBOX_BOOK=1.
 * Output lines prefixed EVIDENCE contain ids only (no personal data) for capability-matrix.json.
 */
const key = process.env.NUITEE_API_KEY;
/** Writes PII-free evidence lines to stdout and, if set, to SANDBOX_EVIDENCE_FILE (JSON lines). */
const evidence = (step: string, data: unknown) => {
  const line = JSON.stringify({ at: new Date().toISOString(), step, data }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  console.log(`EVIDENCE ${line}`);
  if (process.env.SANDBOX_EVIDENCE_FILE) appendFileSync(process.env.SANDBOX_EVIDENCE_FILE, `${line}\n`);
};
const sandbox = process.env.NUITEE_KEY_ENVIRONMENT === 'sandbox';

describe.skipIf(!key || !sandbox)('Nuitee hotel sandbox', () => {
  const c = new NuiteeHotelConnector({
    apiKey: key ?? '',
    environment: 'sandbox',
    searchBaseUrl: 'https://api.liteapi.travel/v3.0',
    bookBaseUrl: 'https://book.liteapi.travel/v3.0',
    searchTimeoutSeconds: 6,
    bookTimeoutSeconds: 120,
  });
  const checkin = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const checkout = new Date(Date.now() + 62 * 86_400_000).toISOString().slice(0, 10);

  it('search -> prebook (-> book with sandbox account card -> lookup -> cancel)', async () => {
    const search = await c.searchRates({
      hotelIds: (process.env.NUITEE_SANDBOX_HOTEL_IDS ?? 'lp1897').split(','),
      checkin,
      checkout,
      occupancies: [{ occupancyNumber: 1, adults: 2, childAges: [] }],
      guestNationality: 'TR',
      currency: 'EUR',
      // Evidence runs only: margin 0 (net) search results were refused at prebook in sandbox (409/2001),
      // so the booking chain can be exercised with a small API margin via NUITEE_SANDBOX_MARGIN_BP.
      margin: process.env.NUITEE_SANDBOX_MARGIN_BP ? { basisPoints: Number(process.env.NUITEE_SANDBOX_MARGIN_BP) } : null,
    });
    evidence('search', { kind: search.kind, offers: search.kind === 'SUCCEEDED' ? search.value.length : null, margin: process.env.NUITEE_SANDBOX_MARGIN_BP ?? '0' });
    expect(search.kind).toBe('SUCCEEDED');
    if (search.kind !== 'SUCCEEDED' || search.value.length === 0) return;
    // Prices move between search and prebook; a refused prebook means "search again", so try a few offers.
    const candidates = [...search.value].sort((a, b) => Number(a.price.minor - b.price.minor)).filter((o) => o.cancellation.refundable).slice(0, 6);
    let pre: Awaited<ReturnType<typeof c.prebook>> | null = null;
    let offer = candidates[0]!;
    for (const candidate of candidates) {
      offer = candidate;
      pre = await c.prebook({ offerRef: candidate.offerRef, usePaymentSdk: false, clientReference: `sbx-${Date.now()}` });
      evidence('prebook', pre.kind === 'SUCCEEDED' ? { kind: pre.kind, prebookRef: pre.value.prebookRef, flags: pre.value.changeFlags, price: pre.value.offer.price, searched: candidate.price } : pre);
      if (pre.kind === 'SUCCEEDED') break;
    }
    expect(pre?.kind).toBe('SUCCEEDED');
    if (!pre || pre.kind !== 'SUCCEEDED' || process.env.NUITEE_SANDBOX_BOOK !== '1') return;

    const clientReference = `th-sbx-${Date.now()}`;
    const booked = await c.book({
      prebookRef: pre.value.prebookRef,
      clientReference,
      holder: { firstName: 'Sandbox', lastName: 'Tester', email: 'sandbox-tester@example.invalid', phone: '+900000000000' },
      guests: offer.occupancyNumbers.map((n) => ({ occupancyNumber: n, leadGuest: { firstName: 'Sandbox', lastName: 'Tester', email: 'sandbox-tester@example.invalid' } })),
      funding: { kind: 'ACCOUNT_CARD' },
    });
    evidence('book', booked.kind === 'SUCCEEDED' ? { kind: booked.kind, ref: booked.value.providerBookingRef, status: booked.value.status, supplierCost: booked.value.supplierCost, funding: 'ACC_CREDIT_CARD' } : booked);
    const lookup = await c.lookupByClientReference(clientReference);
    evidence('lookupByClientReference', lookup.kind === 'SUCCEEDED' ? { kind: lookup.kind, status: lookup.value?.status ?? null, ref: lookup.value?.providerBookingRef ?? null } : lookup);
    if (booked.kind === 'SUCCEEDED' && booked.value.providerBookingRef) {
      const cancel = await c.cancel(opaque(booked.value.providerBookingRef));
      evidence('cancel', cancel.kind === 'SUCCEEDED' ? { kind: cancel.kind, status: cancel.value.status, penalty: cancel.value.penalty, refundToUs: cancel.value.refundToUs } : cancel);
    }
    expect(booked.kind).toBe('SUCCEEDED');
  }, 400_000);
});
