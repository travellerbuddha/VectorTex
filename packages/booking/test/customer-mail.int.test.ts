import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { parseCapabilityMatrix, parseSourceLock, type MailMessage, type MailResult, type Mailer, type StaffActor } from '@texholiday/contracts';
import { MockHotelConnector } from '@texholiday/connectors';
import { DrizzleOrderStore, NotificationRepository, PermissionRepository, PolicyRepository, QuoteRepository, type CoreDatabase } from '@texholiday/db';
import { money } from '@texholiday/pricing';
import { BookingApp, CustomerNotifier, loadOrderView, type BookingSettings } from '../src/index';
import { freshDatabase } from '../../db/test/support/db';

/** Customer booking e-mails from order events (P16), against PostgreSQL with the MOCK hotel connector. */
const root = join(__dirname, '..', '..', '..');
const matrix = parseCapabilityMatrix(JSON.parse(readFileSync(join(root, 'contracts', 'capability-matrix.json'), 'utf8')));
const sourceLock = parseSourceLock(JSON.parse(readFileSync(join(root, 'contracts', 'sources.lock.json'), 'utf8')));
const settings: BookingSettings = {
  environment: 'mock',
  policyId: 'b2c',
  searchTtlSeconds: 1800,
  quoteTtlSeconds: 1200,
  payBySeconds: 1800,
  termsVersion: 'terms-test-1',
  accessTokenSecret: 'test-only-secret-0123456789abcdef0123',
  currencies: ['EUR'],
  maxHotels: 60,
  maxRatesPerHotel: 8,
  intentLeaseSeconds: 600,
  maxAutomaticLookups: 3,
  enforceRateParity: true,
};

/** TEST DOUBLE: records messages; can be told to refuse. */
class RecordingMailer implements Mailer {
  readonly kind = 'MOCK' as const;
  readonly sent: MailMessage[] = [];
  refuse = false;
  async send(m: MailMessage): Promise<MailResult> {
    if (this.refuse) return { delivered: false, reason: 'MOCK refusal' };
    this.sent.push(m);
    return { delivered: true };
  }
}

let core: CoreDatabase;
let hotels: MockHotelConnector;
let app: BookingApp;
const owner: StaffActor = { kind: 'STAFF', id: 'owner' };
const finance: StaffActor = { kind: 'STAFF', id: 'finance' };
const ops: StaffActor = { kind: 'STAFF', id: 'ops' };

const notifier = (mailer: Mailer | null) =>
  new CustomerNotifier({
    notifications: new NotificationRepository(core.db),
    orderView: (id) => loadOrderView(new DrizzleOrderStore(core.db), new QuoteRepository(core.db), id, ''),
    mailer,
    context: mailer ? { brand: 'TexHoliday', publicBaseUrl: 'https://www.example.test' } : null,
  });

async function events(orderId: string, type: string) {
  const r = await core.db.execute<{ id: string; payload: Record<string, unknown> }>(sql`SELECT id, payload FROM core.outbox_events WHERE aggregate_id = ${orderId} AND type = ${type} ORDER BY created_at`);
  return r.rows;
}
async function auditActions(orderId: string) {
  const r = await core.db.execute<{ action: string }>(sql`SELECT action FROM core.audit_logs WHERE entity_type = 'order' AND entity_id = ${orderId} AND action LIKE 'customer_mail.%' ORDER BY id`);
  return r.rows.map((x) => x.action);
}

/** A paid, confirmed booking (refundable or not), booked in `locale`. */
async function confirmedOrder(idem: string, locale: 'tr' | 'en', refundable: boolean) {
  const r = await app.searchHotels({ target: { placeId: 'MOCK-PLACE-ANTALYA' }, checkin: '2027-06-10', checkout: '2027-06-13', rooms: [{ adults: 2, childAges: [] }], nationality: 'TR', currency: 'EUR', locale });
  const offer = r.hotels.flatMap((h) => h.offers).find((o) => o.cancellation.refundable === refundable)!;
  const quote = await app.selectOffer(r.sessionId, offer.key);
  const { orderId, accessToken } = await app.createCheckout({
    quoteVersionId: quote.quoteVersionId,
    acceptTerms: true,
    termsVersion: 'terms-test-1',
    holder: { firstName: 'Ayşe', lastName: 'Yılmaz', email: `${idem}@example.test`, phone: '+905321112233' },
    roomGuests: [{ occupancyNumber: 1, firstName: 'Ayşe', lastName: 'Yılmaz' }],
    locale,
    idempotencyKey: idem,
  });
  const session = await app.paymentSession(orderId, accessToken);
  if (session.state !== 'READY') throw new Error('no payment session');
  hotels.markPaid(session.secretKey.replace('MOCK_secret_', ''));
  expect((await app.finalize(orderId, accessToken)).stage).toBe('CONFIRMED');
  return { orderId, quote };
}

beforeAll(async () => {
  core = await freshDatabase();
  hotels = new MockHotelConnector();
  app = new BookingApp({ db: core.db, hotels, matrix, sourceLock, settings, clock: () => new Date('2027-05-01T10:00:00Z') });
  const perms = new PermissionRepository(core.db);
  await perms.bootstrapManager(owner.id);
  await perms.grantRole(finance.id, 'FINANCE', owner);
  await perms.grantRole('approver', 'FINANCE_APPROVER', owner);
  await perms.grantRole(ops.id, 'OPERATIONS', owner);
  const policies = new PolicyRepository(core.db);
  const v = await policies.createDraft(
    'PRICING',
    'b2c',
    { rounding: 'HALF_EVEN', rules: [{ productType: 'HOTEL', paymentMode: 'PROVIDER_MANAGED', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 1000 }], serviceFees: [], fx: null, allowBelowSspInOpaquePackage: false },
    finance,
  );
  await policies.approve('PRICING', 'b2c', v.version, { kind: 'STAFF', id: 'approver' });
});
afterAll(async () => {
  await core?.close();
});

describe('customer booking e-mails from order events (P16)', () => {
  it('a confirmation is mailed once per event, in the booking language, to the booking address', async () => {
    const { orderId, quote } = await confirmedOrder('mail-confirm-01', 'tr', true);
    const [event] = await events(orderId, 'order.confirmed');
    expect(event).toBeDefined();
    const mailer = new RecordingMailer();
    expect(await notifier(mailer).handle('order.confirmed', event!.id, event!.payload)).toBe('SENT');
    // At-least-once delivery: the same event again sends nothing.
    expect(await notifier(mailer).handle('order.confirmed', event!.id, event!.payload)).toBe('ALREADY_DONE');
    expect(mailer.sent).toHaveLength(1);
    const m = mailer.sent[0]!;
    expect(m.to).toBe('mail-confirm-01@example.test');
    expect(m.subject).toContain(`Rezervasyonunuz onaylandı: ${quote.hotel.name}`);
    expect(m.text).toContain('Merhaba Ayşe,');
    expect(m.text).toMatch(/Rezervasyon numarası: MOCK-BK-/);
    expect(m.text).toContain(`https://www.example.test/tr/orders/${orderId}`);
    expect(await auditActions(orderId)).toEqual(['customer_mail.sent']);
    // Only the outcome is stored: no address, no message.
    const row = await core.db.execute<Record<string, unknown>>(sql`SELECT * FROM core.customer_notifications WHERE event_id = ${event!.id}`);
    expect(row.rows[0]).toMatchObject({ kind: 'BOOKING_CONFIRMED', status: 'SENT', attempts: 2 });
    expect(JSON.stringify(row.rows[0])).not.toContain('example.test');
  });

  it('a refused send fails the event (outbox retry) and is sent on the retry; without mail settings it is recorded as not sent', async () => {
    const { orderId } = await confirmedOrder('mail-retry-01', 'en', true);
    const [event] = await events(orderId, 'order.confirmed');
    const mailer = new RecordingMailer();
    mailer.refuse = true;
    await expect(notifier(mailer).handle('order.confirmed', event!.id, event!.payload)).rejects.toThrow(/not delivered/);
    mailer.refuse = false;
    expect(await notifier(mailer).handle('order.confirmed', event!.id, event!.payload)).toBe('SENT');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.subject).toContain('Your booking is confirmed');
    expect(await auditActions(orderId)).toEqual(['customer_mail.failed', 'customer_mail.sent']);

    const other = await confirmedOrder('mail-none-01', 'tr', true);
    const [e2] = await events(other.orderId, 'order.confirmed');
    expect(await notifier(null).handle('order.confirmed', e2!.id, e2!.payload)).toBe('NOT_CONFIGURED');
    expect(await notifier(new RecordingMailer()).handle('order.confirmed', e2!.id, e2!.payload)).toBe('ALREADY_DONE');
    expect(await auditActions(other.orderId)).toEqual(['customer_mail.not_configured']);
  });

  it('a staff cancellation and the recorded provider refund are mailed; a non-refundable cancellation promises no refund', async () => {
    const mailer = new RecordingMailer();
    const refundable = await confirmedOrder('mail-cancel-01', 'tr', true);
    expect((await app.staff.cancel(ops, refundable.orderId, 'Misafir e-postayla istedi', { customerAcceptedFee: true })).outcome).toBe('CANCELLED');
    const [cancelled] = await events(refundable.orderId, 'order.cancelled');
    expect(cancelled!.payload).toMatchObject({ refundExpected: true });
    await notifier(mailer).handle('order.cancelled', cancelled!.id, cancelled!.payload);
    expect(mailer.sent.at(-1)!.text).toContain('iadesi işleme alındığında size ayrıca e-posta');

    await app.staff.recordProviderRefund(finance, refundable.orderId, money('EUR', 5000n), 'Nuitee panel 2027-05-02');
    const [refund] = await events(refundable.orderId, 'order.refund_recorded');
    expect(refund!.payload).toMatchObject({ amount: { currency: 'EUR', minor: '5000' } });
    await notifier(mailer).handle('order.refund_recorded', refund!.id, refund!.payload);
    expect(mailer.sent.at(-1)!.text).toContain('€50,00 tutarındaki iadeniz');

    // The MOCK provider always reports a full refund. A provider refund of 0 makes the event say refundExpected:false;
    // the mail then promises no refund.
    const other = await confirmedOrder('mail-cancel-02', 'en', false);
    await app.staff.cancel(ops, other.orderId, 'Guest asked by phone', { customerAcceptedFee: true });
    const [nr] = await events(other.orderId, 'order.cancelled');
    await notifier(mailer).handle('order.cancelled', '00000000-0000-4000-8000-0000000000cc', { ...nr!.payload, refundExpected: false });
    expect(mailer.sent.at(-1)!.text).toContain('this cancellation is not refunded');
    expect(mailer.sent.at(-1)!.text).not.toContain('We will e-mail you again');
  });

  it('a failed checkout mails only when the customer may hold a card authorization', async () => {
    const mailer = new RecordingMailer();
    const n = notifier(mailer);
    expect(await n.handle('order.provider_managed.failed', '00000000-0000-4000-8000-0000000000aa', { orderId: '00000000-0000-4000-8000-0000000000bb', code: 'CHECKOUT_EXPIRED', mayHoldPayment: false })).toBe('NOT_APPLICABLE');
    expect(await n.handle('order.status_changed', '00000000-0000-4000-8000-0000000000ac', { orderId: 'x' })).toBe('NOT_APPLICABLE');
    expect(mailer.sent).toHaveLength(0);
  });
});
