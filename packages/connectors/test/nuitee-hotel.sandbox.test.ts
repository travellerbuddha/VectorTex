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
      margin: null,
    });
    console.log('EVIDENCE search', search.kind, search.kind === 'SUCCEEDED' ? search.value.length : search);
    expect(search.kind).toBe('SUCCEEDED');
    if (search.kind !== 'SUCCEEDED' || search.value.length === 0) return;
    const offer = [...search.value].sort((a, b) => Number(a.price.minor - b.price.minor)).find((o) => o.cancellation.refundable) ?? search.value[0]!;
    const pre = await c.prebook({ offerRef: offer.offerRef, usePaymentSdk: false, clientReference: `sbx-${Date.now()}` });
    console.log('EVIDENCE prebook', pre.kind, pre.kind === 'SUCCEEDED' ? { prebookRef: pre.value.prebookRef, flags: pre.value.changeFlags } : pre);
    expect(pre.kind).toBe('SUCCEEDED');
    if (pre.kind !== 'SUCCEEDED' || process.env.NUITEE_SANDBOX_BOOK !== '1') return;

    const clientReference = `th-sbx-${Date.now()}`;
    const booked = await c.book({
      prebookRef: pre.value.prebookRef,
      clientReference,
      holder: { firstName: 'Sandbox', lastName: 'Tester', email: 'sandbox-tester@example.invalid', phone: '+900000000000' },
      guests: offer.occupancyNumbers.map((n) => ({ occupancyNumber: n, leadGuest: { firstName: 'Sandbox', lastName: 'Tester', email: 'sandbox-tester@example.invalid' } })),
      funding: { kind: 'ACCOUNT_CARD' },
    });
    console.log('EVIDENCE book', booked.kind, booked.kind === 'SUCCEEDED' ? { ref: booked.value.providerBookingRef, status: booked.value.status } : booked);
    const lookup = await c.lookupByClientReference(clientReference);
    console.log('EVIDENCE lookup', lookup.kind, lookup.kind === 'SUCCEEDED' ? lookup.value?.status : lookup);
    if (booked.kind === 'SUCCEEDED' && booked.value.providerBookingRef) {
      const cancel = await c.cancel(opaque(booked.value.providerBookingRef));
      console.log('EVIDENCE cancel', cancel.kind, cancel.kind === 'SUCCEEDED' ? { penalty: cancel.value.penalty?.minor.toString() } : cancel);
    }
    expect(booked.kind).toBe('SUCCEEDED');
  }, 400_000);
});
