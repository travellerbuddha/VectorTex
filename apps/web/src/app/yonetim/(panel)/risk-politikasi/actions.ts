'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { riskDocumentFromForm, type RiskFormIssue } from '@texholiday/admin';
import { riskPolicyDocumentSchema, type RiskPolicyDocument } from '@texholiday/contracts';
import { adminDict, adminLocale, type AdminLocale } from '../../../../i18n/admin';
import { admin, requireStaff, riskPolicyId as POLICY_ID } from '../../../../server/admin';
import { actorOf, errorText, type FormState } from '../../../../server/admin-forms';

/** Risk policy commands (G06, ADR-0007). Who may edit/approve is enforced by the repository and the DB. */

const BASE = '/yonetim/risk-politikasi';

async function documentOf(version: number): Promise<RiskPolicyDocument | null> {
  const row = (await admin().policies.versions('RISK', POLICY_ID())).find((v) => v.version === version);
  return row ? riskPolicyDocumentSchema.parse(row.document) : null;
}

function parse(form: FormData, base: RiskPolicyDocument | null, locale: AdminLocale): { document: RiskPolicyDocument; error: string | null } {
  const t = adminDict(locale);
  const { document, issues } = riskDocumentFromForm((n) => (form.has(n) ? String(form.get(n)) : null), base, locale === 'tr' ? ',' : '.');
  const label = (i: RiskFormIssue) => (i.field.startsWith('exp.') ? `${i.field.slice(4)}: ` : '');
  return { document, error: issues.length > 0 ? issues.map((i) => `${label(i)}${t.risk.issues[i.code]}`).join(' ') : null };
}

const noteOf = (form: FormData) => String(form.get('note') ?? '').trim() || null;

/** Creates a draft from the "new draft" form (prefilled with the version in force; nothing is defaulted). */
export async function createDraftAction(_: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const locale = await adminLocale();
  let version: number;
  try {
    const active = (await admin().policies.versions('RISK', POLICY_ID())).find((v) => v.status === 'APPROVED');
    const { document, error } = parse(form, active ? riskPolicyDocumentSchema.parse(active.document) : null, locale);
    if (error) return { error };
    version = (await admin().policies.createDraft('RISK', POLICY_ID(), document, actorOf(staff), noteOf(form))).version;
  } catch (err) {
    return { error: errorText(err, locale) };
  }
  revalidatePath(BASE);
  redirect(`${BASE}/${version}`);
}

export async function saveDraftAction(_: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  const version = Number(form.get('version'));
  try {
    const base = await documentOf(version);
    if (!base) return { error: t.errors.notFound };
    const { document, error } = parse(form, base, locale);
    if (error) return { error };
    await admin().policies.updateDraft('RISK', POLICY_ID(), version, document, actorOf(staff), noteOf(form));
  } catch (err) {
    return { error: errorText(err, locale) };
  }
  revalidatePath(`${BASE}/${version}`);
  revalidatePath(BASE);
  return { ok: t.pricing.saved };
}

export async function approveAction(_: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const version = Number(form.get('version'));
  let mode: string;
  try {
    mode = (await admin().policies.approve('RISK', POLICY_ID(), version, actorOf(staff), noteOf(form))).approvalMode;
  } catch (err) {
    return { error: errorText(err, locale) };
  }
  revalidatePath(BASE);
  redirect(`${BASE}?durum=onaylandi&surum=${version}&mod=${mode}`);
}

export async function retireAction(_: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const locale = await adminLocale();
  try {
    await admin().policies.retire('RISK', POLICY_ID(), Number(form.get('version')), actorOf(staff), noteOf(form));
  } catch (err) {
    return { error: errorText(err, locale) };
  }
  revalidatePath(BASE);
  redirect(`${BASE}?durum=kaldirildi`);
}
