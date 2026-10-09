import { notFound } from 'next/navigation';
import { riskFormFromDocument } from '@texholiday/admin';
import { riskPolicyDocumentSchema } from '@texholiday/contracts';
import { ActionForm } from '../../../../../components/admin/ActionForm';
import { RiskPolicyFields } from '../../../../../components/admin/RiskPolicyFields';
import { RiskPolicySummary } from '../../../../../components/admin/RiskPolicySummary';
import { adminDict, adminLocale } from '../../../../../i18n/admin';
import { admin, can, requireStaff, riskPolicyId } from '../../../../../server/admin';
import { formatAdminInstant } from '../../../../../server/admin-forms';
import { approveAction, saveDraftAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function RiskPolicyVersion({ params }: { params: Promise<{ version: string }> }) {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  if (!can(staff, 'risk_policy.edit', 'risk_policy.approve', 'risk_policy.approve_own')) return <p className="notice">{t.noAccess}</p>;
  const n = Number((await params).version);
  if (!Number.isInteger(n) || n < 1) notFound();
  const { auth, policies } = admin();
  const row = (await policies.versions('RISK', riskPolicyId())).find((v) => v.version === n);
  if (!row) notFound();
  const accounts = await auth.accounts();
  const who = (id: string | null) => (id ? (accounts.find((a) => a.id === id)?.displayName ?? id) : '—');
  const doc = riskPolicyDocumentSchema.parse(row.document);
  const editable = row.status === 'DRAFT' && can(staff, 'risk_policy.edit');
  const own = row.createdBy === staff.id || row.updatedBy === staff.id;
  const mayApprove = row.status === 'DRAFT' && (own ? can(staff, 'risk_policy.approve_own') : can(staff, 'risk_policy.approve'));

  return (
    <div>
      <p>
        <a href="/yonetim/risk-politikasi">← {t.risk.title}</a>
      </p>
      <h1>
        {t.risk.title} · {t.pricing.version(row.version)}{' '}
        <span className={`tag ${row.status === 'APPROVED' ? 'ok' : row.status === 'DRAFT' ? 'warn' : ''}`}>{t.pricing.statuses[row.status]}</span>
      </h1>
      <p className="muted">
        {t.pricing.createdBy}: {who(row.createdBy)} · {t.pricing.updatedBy}: {who(row.updatedBy)} · {formatAdminInstant(row.updatedAt, locale)}
      </p>

      {!editable ? (
        <section className="card">
          {row.status !== 'DRAFT' && <p className="muted">{t.pricing.readOnly}</p>}
          <RiskPolicySummary doc={doc} locale={locale} />
        </section>
      ) : (
        <ActionForm action={saveDraftAction} submit={t.pricing.save} className="stack">
          <input type="hidden" name="version" value={row.version} />
          <RiskPolicyFields form={riskFormFromDocument(doc, locale === 'tr' ? ',' : '.')} locale={locale} />
          <div className="field">
            <label htmlFor="note">{t.pricing.note}</label>
            <textarea id="note" name="note" maxLength={500} defaultValue={row.changeNote ?? ''} />
          </div>
        </ActionForm>
      )}

      {mayApprove && (
        <section className="card top-gap">
          <h2>{t.pricing.approve}</h2>
          <p className="muted">{own ? t.pricing.approveHintSelf : t.pricing.approveHintFourEyes}</p>
          <ActionForm action={approveAction} submit={t.pricing.approve} confirmText={t.risk.approveConfirm}>
            <input type="hidden" name="version" value={row.version} />
          </ActionForm>
        </section>
      )}
    </div>
  );
}
