import { pricingPolicyDocumentSchema } from '@texholiday/pricing';
import { ActionForm } from '../../../../components/admin/ActionForm';
import { PolicySummary } from '../../../../components/admin/PolicySummary';
import { adminDict, adminLocale } from '../../../../i18n/admin';
import { admin, can, pricingPolicyId, requireStaff } from '../../../../server/admin';
import { formatAdminInstant } from '../../../../server/admin-forms';
import { createDraftAction, retireAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function PricingPolicy({ searchParams }: { searchParams: Promise<{ durum?: string; surum?: string; mod?: string }> }) {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  if (!can(staff, 'pricing_policy.edit', 'pricing_policy.approve', 'pricing_policy.approve_own')) return <p className="notice">{t.noAccess}</p>;
  const { auth, policies } = admin();
  const [versions, accounts] = await Promise.all([policies.versions('PRICING', pricingPolicyId()), auth.accounts()]);
  const names = new Map(accounts.map((a) => [a.id, a.displayName]));
  const who = (id: string | null) => (id ? (names.get(id) ?? id) : '—');
  const active = versions.find((v) => v.status === 'APPROVED');
  const drafts = versions.filter((v) => v.status === 'DRAFT');
  const sp = await searchParams;
  const notice =
    sp.durum === 'onaylandi' ? t.pricing.approved(Number(sp.surum), t.pricing.modes[sp.mod ?? ''] ?? '') : sp.durum === 'kaldirildi' ? t.pricing.retired : null;

  return (
    <div>
      <h1>{t.pricing.title}</h1>
      <p className="muted">{t.pricing.intro}</p>
      {notice && (
        <p className="ok-box" role="status">
          {notice}
        </p>
      )}
      <section className="card">
        <h2>{t.pricing.active}</h2>
        {!active ? (
          <p className="notice">{t.pricing.noActive}</p>
        ) : (
          <>
            <p data-testid="active-version">
              <strong>{t.pricing.version(active.version)}</strong> · {t.pricing.approvedBy}: {who(active.approvedBy)} · {formatAdminInstant(active.approvedAt, locale)} ·{' '}
              {t.pricing.modes[active.approvalMode ?? '']}
            </p>
            <PolicySummary doc={pricingPolicyDocumentSchema.parse(active.document)} locale={locale} />
            {can(staff, 'pricing_policy.approve') && (
              <ActionForm action={retireAction} submit={t.pricing.retire} variant="danger" confirmText={t.pricing.retireConfirm} className="stack top-gap">
                <input type="hidden" name="version" value={active.version} />
              </ActionForm>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>{t.pricing.drafts}</h2>
        {drafts.length === 0 ? (
          <p className="muted">{t.pricing.noDrafts}</p>
        ) : (
          <ul className="perm-list">
            {drafts.map((d) => (
              <li key={d.version}>
                <div>
                  <strong>{t.pricing.version(d.version)}</strong> · {t.pricing.updatedBy}: {who(d.updatedBy)} · {formatAdminInstant(d.updatedAt, locale)}
                  {d.changeNote && <small className="muted"> — {d.changeNote}</small>}
                </div>
                <a className="button secondary" href={`/yonetim/fiyat-politikasi/${d.version}`}>
                  {t.pricing.openDraft}
                </a>
              </li>
            ))}
          </ul>
        )}
        {can(staff, 'pricing_policy.edit') && (
          <ActionForm action={createDraftAction} submit={t.pricing.newDraft} variant="secondary" className="stack top-gap">
            <small className="muted">{t.pricing.newDraftHint}</small>
          </ActionForm>
        )}
      </section>

      <section className="card">
        <h2>{t.pricing.history}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>{t.staff.status}</th>
                <th>{t.pricing.createdBy}</th>
                <th>{t.pricing.approvedBy}</th>
                <th>{t.pricing.approvedAt}</th>
                <th>{t.pricing.note}</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.version}>
                  <td>
                    <a href={`/yonetim/fiyat-politikasi/${v.version}`}>{v.version}</a>
                  </td>
                  <td>
                    <span className={`tag ${v.status === 'APPROVED' ? 'ok' : v.status === 'DRAFT' ? 'warn' : ''}`}>{t.pricing.statuses[v.status]}</span>
                  </td>
                  <td>{who(v.createdBy)}</td>
                  <td>
                    {who(v.approvedBy)}
                    {v.approvalMode && <small className="muted"> ({t.pricing.modes[v.approvalMode]})</small>}
                  </td>
                  <td>{formatAdminInstant(v.approvedAt, locale)}</td>
                  <td>{v.changeNote ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
