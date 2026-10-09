import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { adminSettingsFromEnv, OrdersQuery, StaffAuthService, type AdminSettings, type StaffIdentity, type StaffSessionView } from '@texholiday/admin';
import { loadConfig } from '@texholiday/config';
import type { Permission } from '@texholiday/contracts';
import { PermissionRepository, PolicyRepository } from '@texholiday/db';
import { coreDatabase } from './core';

export interface Admin {
  auth: StaffAuthService;
  permissions: PermissionRepository;
  policies: PolicyRepository;
  orders: OrdersQuery;
  settings: AdminSettings;
}

const holder = globalThis as typeof globalThis & { __texholidayAdmin?: Admin; __texholidayAdminLimiter?: Map<string, number[]> };

/** Composition root of /yonetim (one per server process). Fails fast without STAFF_MFA_KEY. */
export function admin(): Admin {
  if (!holder.__texholidayAdmin) {
    const { db } = coreDatabase();
    const settings = adminSettingsFromEnv(process.env);
    const environment = loadConfig(process.env).providerEnvironment;
    holder.__texholidayAdmin = {
      auth: new StaffAuthService(db, settings),
      permissions: new PermissionRepository(db),
      policies: new PolicyRepository(db),
      // Operations screens show the orders of this deployment's provider environment only.
      orders: new OrdersQuery(db, environment),
      settings,
    };
  }
  return holder.__texholidayAdmin;
}

/** The business policy set this deployment sells with (same as the booking application). */
export const pricingPolicyId = () => process.env.POLICY_ID ?? 'b2c';
/** Booking reads the pricing and the risk policy under the same id (POLICY_ID). */
export const riskPolicyId = pricingPolicyId;

export const STAFF_COOKIE = 'th_staff';
export const ADMIN_LANG_COOKIE = 'th_admin_lang';

/** Session cookie: never readable by scripts, never sent cross-site, HTTPS-only in production. */
export async function setStaffCookie(token: string): Promise<void> {
  (await cookies()).set(STAFF_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: admin().settings.sessionMaxHours * 3600,
  });
}

export async function clearStaffCookie(): Promise<void> {
  (await cookies()).delete(STAFF_COOKIE);
}

export async function staffToken(): Promise<string | null> {
  return (await cookies()).get(STAFF_COOKIE)?.value ?? null;
}

export async function currentSession(): Promise<StaffSessionView | null> {
  return admin().auth.session(await staffToken());
}

/** Where an unfinished sign-in continues. */
export function continueSignIn(stage: StaffSessionView['stage'] | null): string {
  if (stage === 'MFA_REQUIRED') return '/yonetim/giris/kod';
  if (stage === 'MFA_ENROLL') return '/yonetim/giris/mfa-kurulum';
  return '/yonetim/giris';
}

/** The signed-in staff member (after MFA); otherwise sends the browser to the right sign-in step. */
export async function requireStaff(): Promise<StaffIdentity> {
  const s = await currentSession();
  if (!s || s.stage !== 'ACTIVE') redirect(continueSignIn(s?.stage ?? null));
  return s.staff;
}

export const can = (staff: StaffIdentity, ...any: Permission[]) => any.some((p) => staff.permissions.has(p));

/**
 * Per-client limit on sign-in steps (on top of the per-account lockout, ADR-0010): `max` attempts per window.
 * In-process only; a multi-instance deployment adds the same limit at the load balancer.
 */
export async function allowAttempt(bucket: string, max = admin().settings.ipAttemptsPerFiveMinutes, windowMs = 5 * 60_000): Promise<boolean> {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || h.get('x-real-ip') || 'local';
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  holder.__texholidayAdminLimiter ??= new Map();
  const list = (holder.__texholidayAdminLimiter.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    holder.__texholidayAdminLimiter.set(key, list);
    return false;
  }
  list.push(now);
  holder.__texholidayAdminLimiter.set(key, list);
  return true;
}

export async function userAgent(): Promise<string | null> {
  return (await headers()).get('user-agent');
}
