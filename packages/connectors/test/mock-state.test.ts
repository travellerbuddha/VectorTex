import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { opaque } from '@texholiday/contracts';
import { fileMockState, MockHotelConnector, mockConnectors } from '../src/index';

/**
 * The local demo runs the site and the worker as two processes. With a shared MOCK state folder they see one MOCK
 * provider, as they see one real provider in production: a booking paid on the site can be finished by the worker,
 * and a booking made by one is read and cancelled by the other. Two connector instances stand for the two processes.
 */
const dirs: string[] = [];
const folder = () => {
  const d = mkdtempSync(join(tmpdir(), 'th-mock-state-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const criteria = {
  placeId: 'MOCK-PLACE-ANTALYA',
  checkin: '2027-06-10',
  checkout: '2027-06-13',
  occupancies: [{ occupancyNumber: 1, adults: 2, childAges: [] }],
  guestNationality: 'TR',
  currency: 'EUR',
  margin: { basisPoints: 1000 },
};

async function paidPrebook(site: MockHotelConnector) {
  const search = await site.searchRates(criteria);
  if (search.kind !== 'SUCCEEDED') throw new Error('search failed');
  const offer = search.value.find((o) => o.cancellation.refundable)!;
  const pre = await site.prebook({ offerRef: offer.offerRef, usePaymentSdk: true, clientReference: 'pre-1' });
  if (pre.kind !== 'SUCCEEDED' || !pre.value.providerManagedTransaction) throw new Error('prebook failed');
  site.markPaid(pre.value.providerManagedTransaction.transactionId);
  return { pre: pre.value, offer };
}

describe('MOCK provider state shared by the demo processes', () => {
  it('a booking paid on the site is booked by the worker, then read and cancelled by the site', async () => {
    const dir = folder();
    const site = mockConnectors(dir).hotels;
    const worker = mockConnectors(dir).hotels;
    const { pre } = await paidPrebook(site);
    const booked = await worker.book({
      prebookRef: pre.prebookRef,
      clientReference: 'order-1-a1',
      holder: { firstName: 'Demo', lastName: 'Misafir', email: 'demo@example.test', phone: '+905321112233' },
      guests: [{ occupancyNumber: 1, leadGuest: { firstName: 'Demo', lastName: 'Misafir', email: 'demo@example.test' } }],
      funding: { kind: 'PROVIDER_MANAGED', transaction: pre.providerManagedTransaction! },
    });
    expect(booked.kind).toBe('SUCCEEDED');
    if (booked.kind !== 'SUCCEEDED') return;
    // Money stays exact through the files (bigint minor units).
    expect(booked.value.supplierCost).toEqual(pre.offer.price);
    expect(typeof booked.value.supplierCost!.minor).toBe('bigint');
    // The same client reference again is a duplicate in every process; the payment is used once.
    const again = await site.book({
      prebookRef: pre.prebookRef,
      clientReference: 'order-1-a2',
      holder: { firstName: 'Demo', lastName: 'Misafir', email: 'demo@example.test', phone: '+905321112233' },
      guests: [{ occupancyNumber: 1, leadGuest: { firstName: 'Demo', lastName: 'Misafir', email: 'demo@example.test' } }],
      funding: { kind: 'PROVIDER_MANAGED', transaction: pre.providerManagedTransaction! },
    });
    expect(again).toMatchObject({ kind: 'REJECTED', code: 'NUITEE_PAYMENT_NOT_COMPLETED' });
    expect(await site.lookupByClientReference('order-1-a1')).toMatchObject({ kind: 'SUCCEEDED', value: { status: 'CONFIRMED' } });
    expect((await site.cancel(opaque(booked.value.providerBookingRef!))).kind).toBe('SUCCEEDED');
    expect(await worker.getBooking(opaque(booked.value.providerBookingRef!))).toMatchObject({ kind: 'SUCCEEDED', value: { status: 'CANCELLED' } });
  });

  it('without a shared folder each process keeps its own provider (unit tests and e2e)', async () => {
    const site = mockConnectors(null).hotels;
    const worker = mockConnectors().hotels;
    const { pre } = await paidPrebook(site);
    const booked = await worker.book({
      prebookRef: pre.prebookRef,
      clientReference: 'order-2-a1',
      holder: { firstName: 'Demo', lastName: 'Misafir', email: 'demo@example.test', phone: '+905321112233' },
      guests: [{ occupancyNumber: 1, leadGuest: { firstName: 'Demo', lastName: 'Misafir', email: 'demo@example.test' } }],
      funding: { kind: 'PROVIDER_MANAGED', transaction: pre.providerManagedTransaction! },
    });
    expect(booked).toMatchObject({ kind: 'REJECTED', code: 'NUITEE_4002' });
  });

  it('flights: paid on the site, booked by the worker (idempotent per prebook), ticketed on the next read', async () => {
    const dir = folder();
    const site = mockConnectors(dir).flights;
    const worker = mockConnectors(dir).flights;
    const date = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    const search = await site.searchRates({ legs: [{ origin: 'IST', destination: 'AYT', date }], adults: 1, childAges: [], infantAges: [], cabinClass: null, pointOfSale: null, currency: 'EUR', margin: null });
    if (search.kind !== 'SUCCEEDED') throw new Error('search failed');
    const pre = await site.prebook({
      offerRef: search.value[0]!.offerRef,
      usePaymentSdk: true,
      contact: { email: 'demo@example.test', firstName: 'Demo', lastName: 'Yolcu', phoneCountryCode: '90', phoneNumber: '5321112233' },
      passengers: [{ type: 'ADULT', firstName: 'Demo', lastName: 'Yolcu', middleName: null, birthDate: '1990-01-01', gender: 'F', nationality: 'TR', document: null }],
    });
    if (pre.kind !== 'SUCCEEDED' || !pre.value.providerManagedTransaction) throw new Error('prebook failed');
    site.markPaid(pre.value.providerManagedTransaction.transactionId);
    const funding = { kind: 'PROVIDER_MANAGED' as const, transaction: pre.value.providerManagedTransaction };
    const booked = await worker.book({ prebookRef: pre.value.prebookRef, clientReference: 'flight-1', funding });
    expect(booked.kind).toBe('SUCCEEDED');
    if (booked.kind !== 'SUCCEEDED') return;
    expect(await site.book({ prebookRef: pre.value.prebookRef, clientReference: 'flight-1b', funding })).toMatchObject({ kind: 'SUCCEEDED', value: { providerBookingRef: booked.value.providerBookingRef } });
    expect(await site.getBooking(booked.value.providerBookingRef!)).toMatchObject({ kind: 'SUCCEEDED', value: { status: 'ISSUED' } });
  });

  it('record keys of any shape become valid file names', () => {
    const c = fileMockState(folder()).collection<{ n: bigint }>('x');
    c.set('a/b:c*?"<>|', { n: 12345678901234567890n });
    expect(c.get('a/b:c*?"<>|')).toEqual({ n: 12345678901234567890n });
    expect(c.entries()).toEqual([['a/b:c*?"<>|', { n: 12345678901234567890n }]]);
    expect(c.has('missing')).toBe(false);
  });
});
