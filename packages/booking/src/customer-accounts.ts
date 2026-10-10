import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { DomainError, type Mailer, type ProviderEnvironment } from '@texholiday/contracts';
import type { CustomerAccountRepository, CustomerOrderRow } from '@texholiday/db';
import { orderAccessToken } from './access';

/**
 * Customer accounts without passwords (ADR-0017): the customer types the e-mail address they booked with, receives a
 * one-time 6-digit code and sees their bookings ("Rezervasyonlarım"). Membership is never required to book (§15).
 *
 * - A code is sent only to an address that has bookings; the answer is the same either way (no address discovery).
 * - Codes: 10 minutes, one use, 5 wrong tries; at most 3 codes per address per 15 minutes. Only an HMAC is stored.
 * - Sessions: a random token in an httpOnly cookie, stored as SHA-256, 30 days.
 * - A signed-in customer opens their own orders with the same order pages as after checkout.
 */
export const CODE_TTL_MINUTES = 10;
export const CODE_MAX_ATTEMPTS = 5;
export const CODES_PER_WINDOW = 3;
export const CODE_WINDOW_MINUTES = 15;
export const SESSION_DAYS = 30;

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function normalizeCustomerEmail(raw: unknown): string | null {
  const email = String(raw ?? '').trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

export interface CustomerAccountDeps {
  repo: CustomerAccountRepository;
  environment: ProviderEnvironment;
  /** HMAC key of order access tokens; reused with its own prefix for sign-in codes. */
  secret: string;
  /** null = no e-mail delivery configured: sign-in is unavailable (never shown on screen). */
  mailer: Mailer | null;
  brand: string;
  clock?: () => Date;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export class CustomerAccounts {
  private readonly clock: () => Date;

  constructor(private readonly deps: CustomerAccountDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  private codeHash(id: string, code: string): string {
    return createHmac('sha256', this.deps.secret).update(`customer-login:${id}:${code}`).digest('base64url');
  }

  get available(): boolean {
    return this.deps.mailer !== null;
  }

  /**
   * Sends a sign-in code when the address has bookings. Returns nothing a caller could use to tell the cases apart;
   * throws only for an invalid address, too many requests or no mail delivery at all.
   */
  async requestCode(rawEmail: unknown, locale: 'tr' | 'en'): Promise<void> {
    const email = normalizeCustomerEmail(rawEmail);
    if (!email) throw new DomainError('VALIDATION_FAILED', 'Enter a valid e-mail address', { httpStatus: 422, action: 'FIX_FIELDS' });
    if (!this.deps.mailer) throw new DomainError('CAPABILITY_NOT_AVAILABLE', 'Sign-in by e-mail is not available', { httpStatus: 503 });
    const now = this.clock();
    if ((await this.deps.repo.codesSince(this.deps.environment, email, new Date(now.getTime() - CODE_WINDOW_MINUTES * 60_000))) >= CODES_PER_WINDOW) {
      throw new DomainError('RATE_LIMITED', 'Too many codes requested; try again later', { httpStatus: 429, retryable: true, action: 'RETRY' });
    }
    if (!(await this.deps.repo.hasOrders(this.deps.environment, email))) return;
    const id = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.deps.repo.insertCode({ id, environment: this.deps.environment, email, codeHash: this.codeHash(id, code), expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000) }, now);
    await this.deps.mailer.send(signInMail(email, code, locale, this.deps.brand));
  }

  /** Checks a code; on success returns the session token for the cookie. */
  async verify(rawEmail: unknown, rawCode: unknown): Promise<{ token: string; expiresAt: Date }> {
    const email = normalizeCustomerEmail(rawEmail);
    const code = String(rawCode ?? '').replace(/\s/g, '');
    const wrong = () => new DomainError('VALIDATION_FAILED', 'The code is wrong or expired', { httpStatus: 422, action: 'FIX_FIELDS' });
    if (!email || !/^\d{6}$/.test(code)) throw wrong();
    const now = this.clock();
    const row = await this.deps.repo.latestCode(this.deps.environment, email, now);
    if (!row || row.attempts >= CODE_MAX_ATTEMPTS) throw wrong();
    const given = Buffer.from(this.codeHash(row.id, code));
    const expected = Buffer.from(row.codeHash);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      await this.deps.repo.failAttempt(row.id);
      throw wrong();
    }
    if (!(await this.deps.repo.consume(row.id, now))) throw wrong();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
    await this.deps.repo.createSession({ tokenHash: sha256(token), environment: this.deps.environment, email, expiresAt }, now);
    return { token, expiresAt };
  }

  async session(token: string | null | undefined): Promise<{ email: string } | null> {
    if (!token || token.length > 200) return null;
    const s = await this.deps.repo.session(sha256(token), this.deps.environment, this.clock());
    return s ? { email: s.email } : null;
  }

  async signOut(token: string | null | undefined): Promise<void> {
    if (token && token.length <= 200) await this.deps.repo.deleteSession(sha256(token));
  }

  async orders(token: string | null | undefined): Promise<{ email: string; orders: CustomerOrderRow[] } | null> {
    const s = await this.session(token);
    return s ? { email: s.email, orders: await this.deps.repo.orders(this.deps.environment, s.email) } : null;
  }

  /** The order access token for a signed-in customer's own order; null otherwise. */
  async orderToken(sessionToken: string | null | undefined, orderId: string): Promise<string | null> {
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
    const s = await this.session(sessionToken);
    if (!s || !(await this.deps.repo.ownsOrder(this.deps.environment, s.email, orderId))) return null;
    return orderAccessToken(this.deps.secret, orderId);
  }
}

/** The sign-in code e-mail, in the customer's language; plain wording and what to do if it was not expected. */
export function signInMail(to: string, code: string, locale: 'tr' | 'en', brand: string) {
  const tr = locale === 'tr';
  const subject = tr ? `${brand} giriş kodunuz` : `Your ${brand} sign-in code`;
  const lines = tr
    ? [`Rezervasyonlarınızı görmek için giriş kodunuz:`, code, `Kod ${CODE_TTL_MINUTES} dakika geçerlidir ve bir kez kullanılabilir.`, `Bu kodu siz istemediyseniz bu e-postayı yok sayabilirsiniz; hesabınıza kimse giriş yapamaz.`]
    : [`Your code to see your bookings:`, code, `The code is valid for ${CODE_TTL_MINUTES} minutes and can be used once.`, `If you did not ask for it, ignore this e-mail; nobody can sign in without the code.`];
  const text = lines.join('\n\n');
  const html = `<p>${lines[0]}</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>${lines[2]}</p><p style="color:#555">${lines[3]}</p>`;
  return { to, subject, text, html };
}
