'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { documentFromForm } from '@texholiday/admin';
import { pricingPolicyDocumentSchema, type PricingPolicyDocument } from '@texholiday/pricing';
import { adminDict, adminLocale } from '../../../../i18n/admin';
import { admin, pricingPolicyId as POLICY_ID, requireStaff } from '../../../../server/admin';
import { actorOf, errorText, type FormState } from '../../../../server/admin-forms';

/** Pricing policy commands (G06, ADR-0007/0009). Who may edit/approve is enforced by the repository and the DB. */

const BASE = '/yonetim/fiyat-politikasi';

async function documentOf(version: number): Promise<PricingPolicyDocument | null> {
  const row = (await admin().policies.versions('PRICING', POLICY_ID())).find((v) => v.version === version);
  return row ? pricingPolicyDocumentSchema.parse(row.document) : null;
}

export async function createDraftAction(_: FormState): Promise<FormState> {
  const staff = await requireStaff();
  const locale = await adminLocale();
  let version: number;
  try {
    const { policies } = admin();
    const versions = await policies.versions('PRICING', POLICY_ID());
    const active = versions.find((v) => v.status === 'APPROVED');
    // A copy of the version in force; without one an empty policy (no margins: nothing sells until filled in).
    const base = active ? pricingPolicyDocumentSchema.parse(active.document) : { rounding: 'HALF_EVEN', rules: [], serviceFees: [], fx: null, allowBelowSspInOpaquePackage: false, allowBelowSspProviderManaged: false };
    version = (await policies.createDraft('PRICING', POLICY_ID(), base, actorOf(staff), null)).version;
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
    const { document, issues } = documentFromForm((n) => (form.has(n) ? String(form.get(n)) : null), base);
    if (issues.length > 0) {
      const label = (field: string) => {
        const [, product, mode] = field.split('.');
        return product && mode ? `${t.pricing.products[product]} · ${t.pricing.paymentModes[mode]}` : '';
      };
      return { error: issues.map((i) => [label(i.field), t.pricing.issues[i.code]].filter(Boolean).join(': ')).join(' ') };
    }
    const note = String(form.get('note') ?? '').trim() || null;
    await admin().policies.updateDraft('PRICING', POLICY_ID(), version, document, actorOf(staff), note);
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
    mode = (await admin().policies.approve('PRICING', POLICY_ID(), version, actorOf(staff), String(form.get('note') ?? '').trim() || null)).approvalMode;
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
    await admin().policies.retire('PRICING', POLICY_ID(), Number(form.get('version')), actorOf(staff), String(form.get('note') ?? '').trim() || null);
  } catch (err) {
    return { error: errorText(err, locale) };
  }
  revalidatePath(BASE);
  redirect(`${BASE}?durum=kaldirildi`);
}
