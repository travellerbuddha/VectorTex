import { riskFormFromDocument } from '@texholiday/admin';
import { riskPolicyDocumentSchema } from '@texholiday/contracts';
import { ActionForm } from '../../../../../components/admin/ActionForm';
import { RiskPolicyFields } from '../../../../../components/admin/RiskPolicyFields';
import { adminDict, adminLocale } from '../../../../../i18n/admin';
import { admin, can, requireStaff, riskPolicyId } from '../../../../../server/admin';
import { createDraftAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewRiskDraft() {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  if (!can(staff, 'risk_policy.edit')) return <p className="notice">{t.noAccess}</p>;
  const active = (await admin().policies.versions('RISK', riskPolicyId())).find((v) => v.status === 'APPROVED');
  const form = riskFormFromDocument(active ? riskPolicyDocumentSchema.parse(active.document) : null, locale === 'tr' ? ',' : '.');
  return (
    <div>
      <p>
        <a href="/yonetim/risk-politikasi">← {t.risk.title}</a>
      </p>
      <h1>{t.risk.newTitle}</h1>
      <p className="muted">{t.risk.newDraftHint}</p>
      <ActionForm action={createDraftAction} submit={t.risk.create} className="stack">
        <RiskPolicyFields form={form} locale={locale} />
        <div className="field">
          <label htmlFor="note">{t.pricing.note}</label>
          <textarea id="note" name="note" maxLength={500} />
        </div>
      </ActionForm>
    </div>
  );
}
