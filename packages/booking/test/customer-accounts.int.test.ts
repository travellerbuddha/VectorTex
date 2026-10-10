import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { parseCapabilityMatrix, parseSourceLock, type MailMessage, type Mailer, type StaffActor } from '@texholiday/contracts';
import { MockHotelConnector } from '@texholiday/connectors';
import { CustomerAccountRepository, PermissionRepository, PolicyRepository, type CoreDatabase } from '@texholiday/db';
import { BookingApp, CODE_MAX_ATTEMPTS, CustomerAccounts, orderAccessToken, type BookingSettings } from '../src/index';
import { freshDatabase } from '../../db/test/support/db';

/** Customer sign-in with one-time e-mail codes and "Rezervasyonlarım" (ADR-0017), against PostgreSQL (MOCK). */
const root = join(__dirname, '..', '..', '..');
const matrix = parseCapabilityMatrix(JSON.parse(readFileSync(join(root, 'contracts', 'capability-matrix.json'), 'utf8')));
const sourceLock = parseSourceLock(JSON.parse(readFileSync(join(root, 'contracts', 'sources.lock.json'), 'utf8')));
const settings: BookingSettings = {
  environment: 'mock',
  policyId: 'b2c',
  searchTtlSeconds: 1800,
  quoteTtlSeconds: 1200,
  payBySeconds: 1800,
  termsVersion: 'terms-1',
  accessTokenSecret: 'test-only-secret-0123456789abcdef0123',
  currencies: ['EUR'],
  maxHotels: 60,
  maxRatesPerHotel: 8,
  intentLeaseSeconds: 600,
  maxAutomaticLookups: 3,
  enforceRateParity: true,
};

class RecordingMailer implements Mailer {
  readonly kind = 'MOCK' as const;
  readonly sent: MailMessage[] = [];
  async send(m: MailMessage) {
    this.sent.push(m);
    return { delivered: true as const };
  }
}

const clock = { now: new Date('2027-05-01T10:00:00Z') };
let core: CoreDatabase;
let app: BookingApp;
let hotels: MockHotelConnector;
let mailer: RecordingMailer;
let accounts: CustomerAccounts;
const orders: Record<string, string> = {};

async function book(email: string, key: string) {
  const r = await app.searchHotels({ target: { placeId: 'MOCK-PLACE-ANTALYA' }, checkin: '2027-06-10', checkout: '2027-06-12', rooms: [{ adults: 2, childAges: [] }], nationality: 'TR', currency: 'EUR', locale: 'tr' });
  const quote = await app.selectOffer(r.sessionId, r.hotels.find((h) => h.hotelId === 'MOCK-H2')!.offers[0]!.key);
  const out = await app.createCheckout({
    quoteVersionId: quote.quoteVersionId,
    acceptTerms: true,
    termsVersion: 'terms-1',
    holder: { firstName: 'Ayşe', lastName: 'Demir', email, phone: '+905321112233' },
    roomGuests: [{ occupancyNumber: 1, firstName: 'Ayşe', lastName: 'Demir' }],
    locale: 'tr',
    idempotencyKey: key,
  });
  const session = await app.paymentSession(out.orderId, out.accessToken);
  if (session.state === 'READY') hotels.markPaid(session.secretKey.replace('MOCK_secret_', ''));
  await app.finalize(out.orderId, out.accessToken);
  return out.orderId;
}

const lastCode = () => mailer.sent.at(-1)!.text.match(/\b(\d{6})\b/)![1]!;

beforeAll(async () => {
  core = await freshDatabase();
  hotels = new MockHotelConnector();
  app = new BookingApp({ db: core.db, hotels, matrix, sourceLock, settings, clock: () => clock.now });
  const owner: StaffActor = { kind: 'STAFF', id: 'owner' };
  const perms = new PermissionRepository(core.db);
  await perms.bootstrapManager(owner.id);
  await perms.grantRole('finance', 'FINANCE', owner);
  await perms.grantRole('approver', 'FINANCE_APPROVER', owner);
  const policies = new PolicyRepository(core.db);
  const v = await policies.createDraft(
    'PRICING',
    'b2c',
    { rounding: 'HALF_EVEN', rules: [{ productType: 'HOTEL', paymentMode: 'PROVIDER_MANAGED', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 1000 }], serviceFees: [], fx: null, allowBelowSspInOpaquePackage: false },
    { kind: 'STAFF', id: 'finance' },
  );
  await policies.approve('PRICING', 'b2c', v.version, { kind: 'STAFF', id: 'approver' });
  orders.ayse1 = await book('Ayse.Demir@Ornek.test', 'idem-account-0001');
  orders.ayse2 = await book('ayse.demir@ornek.test', 'idem-account-0002');
  orders.other = await book('john@example.test', 'idem-account-0003');
  mailer = new RecordingMailer();
  accounts = new CustomerAccounts({ repo: new CustomerAccountRepository(core.db), environment: 'mock', secret: settings.accessTokenSecret, mailer, brand: 'TexHoliday', clock: () => clock.now });
});
afterAll(async () => {
  await core?.close();
});

describe('customer accounts (ADR-0017)', () => {
  it('a code goes only to an address with bookings; the answer is the same either way', async () => {
    await expect(accounts.requestCode('nobody@example.test', 'tr')).resolves.toBeUndefined();
    expect(mailer.sent).toHaveLength(0);
    await expect(accounts.requestCode('not-an-address', 'tr')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await accounts.requestCode('  AYSE.DEMIR@ornek.test ', 'tr');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: 'ayse.demir@ornek.test', subject: 'TexHoliday giriş kodunuz' });
    expect(mailer.sent[0]!.text).toContain('10 dakika');
    // Only an HMAC of the code is stored.
    const stored = await core.db.execute<{ code_hash: string }>(sql`SELECT code_hash FROM core.customer_login_codes`);
    expect(JSON.stringify(stored.rows)).not.toContain(lastCode());
  });

  it('wrong codes count; after five the code is dead; the right code signs in once and shows only the address’s bookings', async () => {
    clock.now = new Date('2027-05-01T10:20:00Z');
    await accounts.requestCode('ayse.demir@ornek.test', 'en');
    expect(mailer.sent.at(-1)!.subject).toBe('Your TexHoliday sign-in code');
    const code = lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < CODE_MAX_ATTEMPTS; i += 1) await expect(accounts.verify('ayse.demir@ornek.test', wrong)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(accounts.verify('ayse.demir@ornek.test', code)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    clock.now = new Date('2027-05-01T10:40:00Z');
    await accounts.requestCode('ayse.demir@ornek.test', 'tr');
    const good = lastCode();
    const s = await accounts.verify('Ayse.Demir@ornek.test', ` ${good.slice(0, 3)} ${good.slice(3)}`);
    await expect(accounts.verify('ayse.demir@ornek.test', good)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' }); // used once
    const mine = await accounts.orders(s.token);
    expect(mine!.email).toBe('ayse.demir@ornek.test');
    expect(mine!.orders.map((o) => o.id).sort()).toEqual([orders.ayse1, orders.ayse2].sort());
    expect(mine!.orders[0]).toMatchObject({ status: 'CONFIRMED', title: 'MOCK Kaleiçi Boutique', checkin: '2027-06-10', checkout: '2027-06-12', total: { currency: 'EUR' } });

    // Order pages: own orders open with the usual order token; someone else's do not.
    expect(await accounts.orderToken(s.token, orders.ayse1!)).toBe(orderAccessToken(settings.accessTokenSecret, orders.ayse1!));
    expect(await accounts.orderToken(s.token, orders.other!)).toBeNull();
    expect(await accounts.orderToken('forged-token', orders.ayse1!)).toBeNull();
    expect((await app.order(orders.ayse1!, await accounts.orderToken(s.token, orders.ayse1!))).orderId).toBe(orders.ayse1);

    // Only a hash of the session token is stored; signing out ends it.
    const sessions = await core.db.execute<{ token_hash: string }>(sql`SELECT token_hash FROM core.customer_sessions`);
    expect(sessions.rows.map((r) => r.token_hash)).not.toContain(s.token);
    await accounts.signOut(s.token);
    expect(await accounts.orders(s.token)).toBeNull();
  });

  it('codes expire, at most three per address in fifteen minutes; sessions end after thirty days', async () => {
    clock.now = new Date('2027-05-02T09:00:00Z');
    await accounts.requestCode('john@example.test', 'tr');
    const code = lastCode();
    clock.now = new Date('2027-05-02T09:11:00Z');
    await expect(accounts.verify('john@example.test', code)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await accounts.requestCode('john@example.test', 'tr');
    await accounts.requestCode('john@example.test', 'tr');
    await expect(accounts.requestCode('john@example.test', 'tr')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    clock.now = new Date('2027-05-02T09:30:00Z');
    await accounts.requestCode('john@example.test', 'tr');
    const s = await accounts.verify('john@example.test', lastCode());
    expect((await accounts.orders(s.token))!.orders.map((o) => o.id)).toEqual([orders.other]);
    clock.now = new Date('2027-06-02T09:31:00Z');
    expect(await accounts.session(s.token)).toBeNull();
    await new CustomerAccountRepository(core.db).prune(clock.now);
    expect((await core.db.execute(sql`SELECT 1 FROM core.customer_sessions`)).rows).toHaveLength(0);
  });

  it('without e-mail delivery sign-in is unavailable (a code is never shown on screen)', async () => {
    const off = new CustomerAccounts({ repo: new CustomerAccountRepository(core.db), environment: 'mock', secret: settings.accessTokenSecret, mailer: null, brand: 'TexHoliday' });
    expect(off.available).toBe(false);
    await expect(off.requestCode('ayse.demir@ornek.test', 'tr')).rejects.toMatchObject({ code: 'CAPABILITY_NOT_AVAILABLE' });
  });
});
