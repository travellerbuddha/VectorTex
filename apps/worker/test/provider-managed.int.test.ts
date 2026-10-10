import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '@texholiday/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BookingApp } from '@texholiday/booking';
import { MockFlightConnector, MockHotelConnector } from '@texholiday/connectors';
import { opaque, parseCapabilityMatrix, parseSourceLock } from '@texholiday/contracts';
import { DrizzleOrderStore, PermissionRepository, PolicyRepository } from '@texholiday/db';
import { setBookingStatus, setPaymentStatus } from '@texholiday/domain';
import { createRuntime, type Runtime } from '../src/runtime';
import { freshDatabase, seedOrder } from '../../../packages/db/test/support/db';

/** The worker finalizes provider-managed checkouts when the customer closed the browser (ADR-0008, §5.1). */
const quiet = { info: () => {}, warn: () => {}, error: () => {} };
let runtime: Runtime;
const flights = new MockFlightConnector();

beforeAll(async () => {
  const db = await freshDatabase();
  await db.close();
  const url = process.env.TEST_DATABASE_URL!;
  const config = loadConfig({ APP_ENV: 'development', PROVIDER_ENV: 'mock', ALLOW_MOCK_ADAPTERS: 'true', PAYLOAD_ENABLED: 'false', DATABASE_URL: url, REDIS_URL: process.env.TEST_REDIS_URL });
  runtime = await createRuntime(config, { WORKER_ID: 'it-worker' }, quiet, new Map(), new MockHotelConnector(), flights);
});
afterAll(async () => {
  await runtime?.close();
});

describe('worker: provider-managed finalize jobs', () => {
  it('a scheduled finalize on an unknown order fails loudly (retried by the relay), never silently', async () => {
    await expect(runtime.handlers['order.provider_managed.finalize']!({ orderId: '00000000-0000-0000-0000-000000000000', attempt: 1 }, { eventId: 'e1', attempts: 1 })).rejects.toThrow();
  });

  it('abandons an unpaid checkout at its deadline without any booking call', async () => {
    const { orderId } = await seedOrder(runtime.core, [{ productType: 'HOTEL', providerId: 'nuitee', charge: 50000n, rank: 10, needsPrebook: true }], 'mock', { mode: 'PROVIDER_MANAGED' });
    const store = new DrizzleOrderStore(runtime.core.db);
    // State after a payment session was opened (prebook with the payment component), deadline already passed.
    const agg = await store.load(orderId);
    const now = new Date();
    setBookingStatus(agg, agg.items[0]!.id, 'PREPARED', 'UPSTREAM_RESULT', 'test', now);
    agg.items[0]!.booking.prebookRef = opaque('MOCK-PRE-W1');
    setPaymentStatus(agg, 'PENDING', 'UPSTREAM_RESULT', 'test', now);
    agg.payment!.providerTransaction = { prebookRef: opaque('MOCK-PRE-W1'), transactionId: opaque('MOCK-TX-W1') };
    agg.payment!.providerClientSecret = 'MOCK_secret_W1';
    agg.payment!.payBy = new Date(now.getTime() - 1000).toISOString();
    await store.save(agg);

    await runtime.handlers['order.provider_managed.finalize']!({ orderId, attempt: 3 }, { eventId: 'e2', attempts: 1 });
    const after = await store.load(orderId);
    expect(after).toMatchObject({ status: 'CANCELLED', compensationReason: 'CHECKOUT_EXPIRED' });
    expect(after.payment).toMatchObject({ status: 'DECLINED', providerClientSecret: null });
  });
});

describe('worker: provider-managed flights (ADR-0012)', () => {
  it('a scheduled finalize never books a flight; the lookup after the booking confirms the order once the ticket is issued', async () => {
    const root = join(__dirname, '..', '..', '..');
    const perms = new PermissionRepository(runtime.core.db);
    await perms.bootstrapManager('owner');
    await perms.grantRole('finance', 'FINANCE', { kind: 'STAFF', id: 'owner' });
    await perms.grantRole('approver', 'FINANCE_APPROVER', { kind: 'STAFF', id: 'owner' });
    const policies = new PolicyRepository(runtime.core.db);
    const v = await policies.createDraft(
      'PRICING',
      'b2c',
      { rounding: 'HALF_EVEN', rules: [{ productType: 'FLIGHT', paymentMode: 'PROVIDER_MANAGED', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 800 }], serviceFees: [], fx: null, allowBelowSspInOpaquePackage: false },
      { kind: 'STAFF', id: 'finance' },
    );
    await policies.approve('PRICING', 'b2c', v.version, { kind: 'STAFF', id: 'approver' });
    const app = new BookingApp({
      db: runtime.core.db,
      hotels: new MockHotelConnector(),
      flights,
      matrix: parseCapabilityMatrix(JSON.parse(readFileSync(join(root, 'contracts', 'capability-matrix.json'), 'utf8'))),
      sourceLock: parseSourceLock(JSON.parse(readFileSync(join(root, 'contracts', 'sources.lock.json'), 'utf8'))),
      settings: { environment: 'mock', policyId: 'b2c', searchTtlSeconds: 1800, quoteTtlSeconds: 1200, payBySeconds: 1800, termsVersion: 't1', accessTokenSecret: 'test-only-secret-0123456789abcdef0123', currencies: ['EUR'], maxHotels: 10, maxRatesPerHotel: 4, intentLeaseSeconds: 600, maxAutomaticLookups: 3, enforceRateParity: true },
    });
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const r = await app.flights!.search({ origin: 'ESB', destination: 'DLM', departDate: day(30), returnDate: null, adults: 1, childAges: [], infantAges: [], cabinClass: null, currency: 'EUR', locale: 'en' });
    const q = await app.flights!.selectOffer(r.sessionId, r.offers[0]!.key);
    // TEST-ONLY passenger (fictional).
    const { orderId, accessToken } = await app.flights!.createCheckout({
      quoteVersionId: q.quoteVersionId,
      acceptTerms: true,
      termsVersion: 't1',
      contact: { firstName: 'Test', lastName: 'Traveller', email: 'worker-flight@example.test', phoneCountryCode: '44', phoneNumber: '7700900123' },
      passengers: [{ type: 'ADULT', firstName: 'Test', lastName: 'Traveller', birthDate: '1990-01-01', gender: 'M', nationality: 'GB', document: { type: 'passport', number: 'TEST1234', issuingCountry: 'GB', expiresOn: '2035-01-01' } }],
      locale: 'en',
      idempotencyKey: 'worker-flight-01',
    });
    const session = await app.paymentSession(orderId, accessToken);
    if (session.state !== 'READY') throw new Error('no payment session');
    flights.markPaid(session.secretKey.replace('MOCK_secret_', ''));
    const store = new DrizzleOrderStore(runtime.core.db);

    // Paid, but the customer has not come back yet: the worker's scheduled step does not book.
    await runtime.handlers['order.provider_managed.finalize']!({ orderId, attempt: 1 }, { eventId: 'wf1', attempts: 1 });
    expect((await store.load(orderId)).items[0]!.booking.status).toBe('PREPARED');

    expect((await app.finalize(orderId, accessToken)).stage).toBe('ISSUING');
    await runtime.handlers['order.provider_managed.lookup']!({ orderId }, { eventId: 'wf2', attempts: 1 });
    const after = await store.load(orderId);
    expect(after.status).toBe('CONFIRMED');
    expect(after.items[0]!.booking).toMatchObject({ status: 'ISSUED', ticketing: 'ISSUED' });
  });
});

describe('worker: customer e-mails from order events (P16)', () => {
  it('a checkout abandoned after a book attempt (the customer may have paid) is mailed once through the configured mailer (MOCK dir)', async () => {
    const { mkdtempSync, readdirSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { sql } = await import('drizzle-orm');
    const dir = mkdtempSync(join(tmpdir(), 'th-worker-mail-'));
    const url = process.env.TEST_DATABASE_URL!;
    const config = loadConfig({ APP_ENV: 'development', PROVIDER_ENV: 'mock', ALLOW_MOCK_ADAPTERS: 'true', PAYLOAD_ENABLED: 'false', DATABASE_URL: url, REDIS_URL: process.env.TEST_REDIS_URL });
    const mailing = await createRuntime(config, { WORKER_ID: 'it-mail', APP_ENV: 'development', MAIL_MOCK_DIR: dir, PUBLIC_BASE_URL: 'http://127.0.0.1:3000' }, quiet, new Map(), new MockHotelConnector());
    try {
      const option = { hotelId: 'H1', hotelName: 'Test Otel', address: 'Kemer', photo: null, room: { name: 'Oda', boardType: null, boardName: null }, checkin: '2027-06-10', checkout: '2027-06-12', nights: 2, rooms: [] };
      const { orderId } = await seedOrder(mailing.core, [{ productType: 'HOTEL', providerId: 'nuitee', charge: 50000n, rank: 10, needsPrebook: true, option }], 'mock', { mode: 'PROVIDER_MANAGED' });
      const store = new DrizzleOrderStore(mailing.core.db);
      const agg = await store.load(orderId);
      const now = new Date();
      setBookingStatus(agg, agg.items[0]!.id, 'PREPARED', 'UPSTREAM_RESULT', 'test', now);
      agg.items[0]!.booking.prebookRef = opaque('MOCK-PRE-M1');
      // A book call was sent earlier ("payment not completed"), so the customer may have paid since: at the deadline
      // the lookup finds no booking and the order fails with a possible card hold.
      agg.items[0]!.booking.clientReferenceSeq = 1;
      setPaymentStatus(agg, 'PENDING', 'UPSTREAM_RESULT', 'test', now);
      agg.payment!.providerTransaction = { prebookRef: opaque('MOCK-PRE-M1'), transactionId: opaque('MOCK-TX-M1') };
      agg.payment!.providerClientSecret = 'MOCK_secret_M1';
      agg.payment!.payBy = new Date(now.getTime() - 1000).toISOString();
      await store.save(agg);
      await mailing.handlers['order.provider_managed.finalize']!({ orderId, attempt: 3 }, { eventId: 'e3', attempts: 1 });

      const ev = await mailing.core.db.execute<{ id: string; payload: Record<string, unknown> }>(sql`SELECT id, payload FROM core.outbox_events WHERE aggregate_id = ${orderId} AND type = 'order.provider_managed.failed'`);
      expect(ev.rows).toHaveLength(1);
      const { id, payload } = ev.rows[0]!;
      expect(payload).toMatchObject({ code: 'CHECKOUT_EXPIRED', mayHoldPayment: true });
      await mailing.handlers['order.provider_managed.failed']!(payload, { eventId: id, attempts: 1 });
      await mailing.handlers['order.provider_managed.failed']!(payload, { eventId: id, attempts: 2 });
      const files = readdirSync(dir);
      expect(files).toHaveLength(1);
      const mail = JSON.parse(readFileSync(join(dir, files[0]!), 'utf8')) as { to: string; subject: string; text: string };
      expect(mail).toMatchObject({ to: 'guest@example.test', subject: 'TexHoliday – Rezervasyonunuz tamamlanamadı: Test Otel' });
      expect(mail.text).toContain('1–2 iş günü');
      expect(mail.text).toContain(`http://127.0.0.1:3000/tr/orders/${orderId}`);
    } finally {
      await mailing.close();
    }
  });
});
