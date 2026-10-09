import { notFound } from 'next/navigation';
import { MARGIN_SLOTS, ROUNDING_MODES, rowsFromDocument, slotKey } from '@texholiday/admin';
import { DISPLAY_CURRENCIES, pricingPolicyDocumentSchema } from '@texholiday/pricing';
import { ActionForm } from '../../../../../components/admin/ActionForm';
import { PolicySummary } from '../../../../../components/admin/PolicySummary';
import { adminDict, adminLocale } from '../../../../../i18n/admin';
import { admin, can, pricingPolicyId, requireStaff } from '../../../../../server/admin';
import { formatAdminInstant } from '../../../../../server/admin-forms';
import { approveAction, saveDraftAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PolicyVersion({ params }: { params: Promise<{ version: string }> }) {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  if (!can(staff, 'pricing_policy.edit', 'pricing_policy.approve', 'pricing_policy.approve_own')) return <p className="notice">{t.noAccess}</p>;
  const n = Number((await params).version);
  if (!Number.isInteger(n) || n < 1) notFound();
  const { auth, policies } = admin();
  const row = (await policies.versions('PRICING', pricingPolicyId())).find((v) => v.version === n);
  if (!row) notFound();
  const accounts = await auth.accounts();
  const who = (id: string | null) => (id ? (accounts.find((a) => a.id === id)?.displayName ?? id) : '—');
  const doc = pricingPolicyDocumentSchema.parse(row.document);
  const editable = row.status === 'DRAFT' && can(staff, 'pricing_policy.edit');
  const own = row.createdBy === staff.id || row.updatedBy === staff.id;
  const mayApprove = row.status === 'DRAFT' && (own ? can(staff, 'pricing_policy.approve_own') : can(staff, 'pricing_policy.approve'));
  const sep = locale === 'tr' ? ',' : '.';
  const rows = rowsFromDocument(doc, sep);

  return (
    <div>
      <p>
        <a href="/yonetim/fiyat-politikasi">← {t.pricing.title}</a>
      </p>
      <h1>
        {t.pricing.version(row.version)} <span className={`tag ${row.status === 'APPROVED' ? 'ok' : row.status === 'DRAFT' ? 'warn' : ''}`}>{t.pricing.statuses[row.status]}</span>
      </h1>
      <p className="muted">
        {t.pricing.createdBy}: {who(row.createdBy)} · {t.pricing.updatedBy}: {who(row.updatedBy)} · {formatAdminInstant(row.updatedAt, locale)}
      </p>

      {!editable ? (
        <section className="card">
          {row.status !== 'DRAFT' && <p className="muted">{t.pricing.readOnly}</p>}
          <PolicySummary doc={doc} locale={locale} />
        </section>
      ) : (
        <ActionForm action={saveDraftAction} submit={t.pricing.save} className="stack">
          <input type="hidden" name="version" value={row.version} />
          <section className="card">
            <h2>{t.pricing.margins}</h2>
            <div className="slots">
              {MARGIN_SLOTS.map((slot) => {
                const k = slotKey(slot);
                const r = rows[k]!;
                const id = k.replace(/\./g, '-');
                return (
                  <fieldset key={k} className="slot" data-testid={`slot-${slot.productType}-${slot.paymentMode}`}>
                    <legend>
                      {t.pricing.products[slot.productType]} · {t.pricing.paymentModes[slot.paymentMode]}
                    </legend>
                    <label className="check">
                      <input type="checkbox" name={`${k}.on`} value="1" defaultChecked={r.on} /> {t.pricing.enabled}
                    </label>
                    <div className="row3">
                      {slot.applications.length > 1 ? (
                        <div className="field">
                          <label htmlFor={`${id}-app`}>{t.pricing.application}</label>
                          <select id={`${id}-app`} name={`${k}.app`} defaultValue={r.application}>
                            {slot.applications.map((a) => (
                              <option key={a} value={a}>
                                {t.pricing.applications[a]}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <input type="hidden" name={`${k}.app`} value={slot.applications[0]} />
                      )}
                      {slot.applications.includes('LOCAL') && (
                        <div className="field">
                          <label htmlFor={`${id}-kind`}>{t.pricing.kind}</label>
                          <select id={`${id}-kind`} name={`${k}.kind`} defaultValue={r.kind}>
                            <option value="PERCENT_OF_NET">{t.pricing.kinds.PERCENT_OF_NET}</option>
                            <option value="FIXED">{t.pricing.kinds.FIXED}</option>
                          </select>
                        </div>
                      )}
                      <div className="field">
                        <label htmlFor={`${id}-pct`}>{t.pricing.percent}</label>
                        <input id={`${id}-pct`} name={`${k}.pct`} inputMode="decimal" defaultValue={r.percent} placeholder={`${locale === 'tr' ? 'örn.' : 'e.g.'} 12${sep}5`} />
                      </div>
                      {slot.applications.includes('LOCAL') && (
                        <>
                          <div className="field">
                            <label htmlFor={`${id}-amount`}>{t.pricing.amount}</label>
                            <input id={`${id}-amount`} name={`${k}.amount`} inputMode="decimal" defaultValue={r.amount} />
                          </div>
                          <div className="field">
                            <label htmlFor={`${id}-cur`}>{t.pricing.currency}</label>
                            <select id={`${id}-cur`} name={`${k}.currency`} defaultValue={r.currency}>
                              {DISPLAY_CURRENCIES.map((c) => (
                                <option key={c}>{c}</option>
                              ))}
                            </select>
                          </div>
                        </>
                      )}
                    </div>
                  </fieldset>
                );
              })}
            </div>
          </section>
          <section className="card">
            <h2>{t.pricing.rounding}</h2>
            <div className="field">
              <label htmlFor="rounding">{t.pricing.rounding}</label>
              <select id="rounding" name="rounding" defaultValue={doc.rounding}>
                {ROUNDING_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t.pricing.roundings[m]}
                  </option>
                ))}
              </select>
            </div>
          </section>
          <section className="card">
            <h2>{t.pricing.ssp}</h2>
            <label className="check">
              <input type="checkbox" name="ssp.providerManaged" value="1" defaultChecked={doc.allowBelowSspProviderManaged} /> {t.pricing.sspProviderManaged}
            </label>
            <label className="check">
              <input type="checkbox" name="ssp.package" value="1" defaultChecked={doc.allowBelowSspInOpaquePackage} /> {t.pricing.sspPackage}
            </label>
          </section>
          <section className="card">
            <h2>{t.pricing.fx}</h2>
            <label className="check">
              <input type="checkbox" name="fx.on" value="1" defaultChecked={!!doc.fx} /> {t.pricing.fxOn}
            </label>
            <div className="row3">
              <div className="field">
                <label htmlFor="fx-source">{t.pricing.fxSource}</label>
                <input id="fx-source" name="fx.source" defaultValue={doc.fx?.source ?? ''} maxLength={120} />
              </div>
              <div className="field">
                <label htmlFor="fx-age">{t.pricing.fxMaxAge}</label>
                <input id="fx-age" name="fx.maxAgeMinutes" inputMode="numeric" defaultValue={doc.fx ? String(Math.round(doc.fx.maxRateAgeSeconds / 60)) : ''} />
              </div>
              <div className="field">
                <label htmlFor="fx-rounding">{t.pricing.fxRounding}</label>
                <select id="fx-rounding" name="fx.rounding" defaultValue={doc.fx?.rounding ?? 'HALF_EVEN'}>
                  {ROUNDING_MODES.map((m) => (
                    <option key={m} value={m}>
                      {t.pricing.roundings[m]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>
          <section className="card">
            <h2>{t.pricing.fees}</h2>
            <p>{doc.serviceFees.length === 0 ? t.pricing.feesNone : doc.serviceFees.map((f) => f.label[locale]).join(', ')}</p>
            <small className="muted">{t.pricing.feesNote}</small>
          </section>
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
          <ActionForm action={approveAction} submit={t.pricing.approve} confirmText={t.pricing.approveConfirm}>
            <input type="hidden" name="version" value={row.version} />
          </ActionForm>
        </section>
      )}
    </div>
  );
}
