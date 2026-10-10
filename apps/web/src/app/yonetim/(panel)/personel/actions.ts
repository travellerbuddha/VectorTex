'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { staffLinkMail, type StaffLinkPurpose } from '@texholiday/admin';
import { isPermission, STAFF_ROLES, type StaffRole } from '@texholiday/contracts';
import { adminDict, adminLocale } from '../../../../i18n/admin';
import { admin, requireStaff } from '../../../../server/admin';
import { actorOf, errorText, formatAdminInstant, type FormState } from '../../../../server/admin-forms';
import { originOf } from '../../../../server/http';

/** Staff and permission commands of /yonetim. Authority is checked by the services and the database, not here. */

const field = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

async function run(work: (ctx: { actor: ReturnType<typeof actorOf>; t: ReturnType<typeof adminDict>; locale: 'tr' | 'en' }) => Promise<FormState>, paths: string[]): Promise<FormState> {
  const staff = await requireStaff();
  const locale = await adminLocale();
  try {
    const out = await work({ actor: actorOf(staff), t: adminDict(locale), locale });
    for (const p of paths) revalidatePath(p);
    return out;
  } catch (err) {
    return { error: errorText(err, locale) };
  }
}

async function setupLink(token: string, expiresAt: string, locale: 'tr' | 'en') {
  const t = adminDict(locale);
  return { url: `${originOf(await headers())}/yonetim/kurulum/${token}`, note: `${t.common.validUntil(formatAdminInstant(expiresAt, locale))} · ${t.common.linkWarning}` };
}

/**
 * Hands a one-time setup link to the person: by e-mail when mail is configured (link from PUBLIC_BASE_URL), otherwise
 * shown once to the staff member who created it. A failed e-mail falls back to showing the link.
 */
async function deliverLink(
  target: { email: string; displayName: string },
  out: { token: string; expiresAt: string },
  purpose: StaffLinkPurpose,
  ok: string,
  locale: 'tr' | 'en',
): Promise<FormState> {
  const t = adminDict(locale);
  const mail = admin().mail;
  if (!mail) return { ok, link: await setupLink(out.token, out.expiresAt, locale) };
  const url = `${mail.publicBaseUrl}/yonetim/kurulum/${out.token}`;
  const sent = await mail.mailer.send(staffLinkMail({ to: target.email, displayName: target.displayName, url, expiresAt: out.expiresAt, purpose }));
  if (sent.delivered) return { ok: `${ok} ${t.staff.mailSent(target.email)}` };
  return { ok: `${ok} ${t.staff.mailFailed}`, link: { url, note: `${t.common.validUntil(formatAdminInstant(out.expiresAt, locale))} · ${t.common.linkWarning}` } };
}

async function accountOf(id: string): Promise<{ email: string; displayName: string }> {
  const a = (await admin().auth.accounts()).find((x) => x.id === id);
  if (!a) throw new Error('account not found');
  return { email: a.email, displayName: a.displayName };
}

export async function inviteAction(_: FormState, form: FormData): Promise<FormState> {
  return run(async ({ actor, t, locale }) => {
    const displayName = field(form, 'displayName');
    const out = await admin().auth.invite(actor, { email: field(form, 'email'), displayName });
    return deliverLink(await accountOf(out.staffId), out, 'INVITE', t.staff.invited(displayName), locale);
  }, ['/yonetim/personel']);
}

export async function passwordLinkAction(_: FormState, form: FormData): Promise<FormState> {
  const id = field(form, 'staffId');
  return run(async ({ actor, t, locale }) => {
    const out = await admin().auth.issuePasswordLink(actor, id);
    return deliverLink(await accountOf(id), out, out.purpose, t.staff.linkReady, locale);
  }, [`/yonetim/personel/${id}`]);
}

export async function resetMfaAction(_: FormState, form: FormData): Promise<FormState> {
  const id = field(form, 'staffId');
  return run(async ({ actor, t }) => {
    await admin().auth.resetMfa(actor, id);
    return { ok: t.staff.mfaWasReset };
  }, [`/yonetim/personel/${id}`, '/yonetim/personel']);
}

export async function unlockAction(_: FormState, form: FormData): Promise<FormState> {
  const id = field(form, 'staffId');
  return run(async ({ actor, t }) => {
    await admin().auth.unlock(actor, id);
    return { ok: t.staff.unlocked };
  }, [`/yonetim/personel/${id}`, '/yonetim/personel']);
}

export async function disableAction(_: FormState, form: FormData): Promise<FormState> {
  const id = field(form, 'staffId');
  return run(async ({ actor, t }) => {
    await admin().auth.disable(actor, id, field(form, 'reason'));
    return { ok: t.staff.disabled };
  }, [`/yonetim/personel/${id}`, '/yonetim/personel']);
}

export async function enableAction(_: FormState, form: FormData): Promise<FormState> {
  const id = field(form, 'staffId');
  return run(async ({ actor, t, locale }) => {
    const out = await admin().auth.enable(actor, id);
    // A re-enabled account sets a new password and authenticator: the invite flow.
    return deliverLink(await accountOf(id), out, 'INVITE', t.staff.enabledHint, locale);
  }, [`/yonetim/personel/${id}`, '/yonetim/personel']);
}

export async function grantAction(_: FormState, form: FormData): Promise<FormState> {
  const id = field(form, 'staffId');
  const permission = field(form, 'permission');
  return run(async ({ actor, t }) => {
    if (!isPermission(permission)) return { error: t.errors.notFound };
    const out = await admin().permissions.grant(id, permission, actor, field(form, 'note') || null);
    return { ok: out.granted ? t.perms.granted : t.perms.alreadyActive };
  }, [`/yonetim/personel/${id}`]);
}

export async function grantRoleAction(_: FormState, form: FormData): Promise<FormState> {
  const id = field(form, 'staffId');
  const role = field(form, 'role');
  return run(async ({ actor, t }) => {
    if (!(STAFF_ROLES as readonly string[]).includes(role)) return { error: t.errors.notFound };
    const out = await admin().permissions.grantRole(id, role as StaffRole, actor, field(form, 'note') || null);
    return { ok: t.perms.roleApplied(out.granted.length) };
  }, [`/yonetim/personel/${id}`]);
}

export async function revokeAction(_: FormState, form: FormData): Promise<FormState> {
  const id = field(form, 'staffId');
  const permission = field(form, 'permission');
  return run(async ({ actor, t }) => {
    if (!isPermission(permission)) return { error: t.errors.notFound };
    await admin().permissions.revoke(id, permission, actor, field(form, 'note') || null);
    return { ok: t.perms.revoked };
  }, [`/yonetim/personel/${id}`]);
}
