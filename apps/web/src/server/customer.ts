import { cookies } from 'next/headers';
import { mailSettingsFromEnv } from '@texholiday/admin';
import { CustomerAccounts } from '@texholiday/booking';
import { CustomerAccountRepository } from '@texholiday/db';
import { booking } from './booking';
import { coreDatabase } from './core';

/** Customer sign-in for "Rezervasyonlarım" (ADR-0017). One instance per server process. */
const holder = globalThis as typeof globalThis & { __texholidayCustomers?: Promise<CustomerAccounts> };

export function customerAccounts(): Promise<CustomerAccounts> {
  holder.__texholidayCustomers ??= (async () => {
    const { settings } = await booking();
    const mail = mailSettingsFromEnv(process.env);
    return new CustomerAccounts({
      repo: new CustomerAccountRepository(coreDatabase().db),
      environment: settings.environment,
      secret: settings.accessTokenSecret,
      mailer: mail?.mailer ?? null,
      brand: process.env.MAIL_BRAND?.trim() || 'TexHoliday',
    });
  })().catch((err) => {
    holder.__texholidayCustomers = undefined;
    throw err;
  });
  return holder.__texholidayCustomers;
}

export const CUSTOMER_COOKIE = 'th_customer';
/** The address a code was just sent to (so the next step needs no e-mail in the URL); 15 minutes. */
export const CUSTOMER_PENDING_COOKIE = 'th_customer_pending';

const secure = () => process.env.NODE_ENV === 'production';

export async function customerToken(): Promise<string | null> {
  return (await cookies()).get(CUSTOMER_COOKIE)?.value ?? null;
}

export async function setCustomerCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(CUSTOMER_COOKIE, token, { httpOnly: true, secure: secure(), sameSite: 'lax', path: '/', expires: expiresAt });
}

export async function clearCustomerCookie(): Promise<void> {
  (await cookies()).delete(CUSTOMER_COOKIE);
}

export async function pendingEmail(): Promise<string | null> {
  return (await cookies()).get(CUSTOMER_PENDING_COOKIE)?.value ?? null;
}

export async function setPendingEmail(email: string | null): Promise<void> {
  const jar = await cookies();
  if (email === null) jar.delete(CUSTOMER_PENDING_COOKIE);
  else jar.set(CUSTOMER_PENDING_COOKIE, email, { httpOnly: true, secure: secure(), sameSite: 'lax', path: '/', maxAge: 15 * 60 });
}

/** "ay***@ornek.com": shown on the code step so the customer can tell which inbox to check. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return email;
  return `${user.slice(0, Math.min(2, user.length))}***@${domain}`;
}
