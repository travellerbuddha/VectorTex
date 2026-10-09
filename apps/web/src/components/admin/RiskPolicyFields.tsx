import { FUNDING_METHODS, type RiskForm } from '@texholiday/admin';
import { adminDict, type AdminLocale } from '../../i18n/admin';

/** Fields of the risk policy editor; parsed by `riskDocumentFromForm` on the server. */
export function RiskPolicyFields({ form, locale }: { form: RiskForm; locale: AdminLocale }) {
  const t = adminDict(locale);
  return (
    <>
      <section className="card">
        <h2>{t.risk.exposure}</h2>
        <p className="muted">{t.risk.exposureHint}</p>
        <div className="row3">
          {Object.entries(form.exposures).map(([c, v]) => (
            <div className="field" key={c}>
              <label htmlFor={`exp-${c}`}>{c}</label>
              <input id={`exp-${c}`} name={`exp.${c}`} inputMode="decimal" defaultValue={v} autoComplete="off" />
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <h2>{t.risk.margin}</h2>
        <div className="field">
          <label htmlFor="margin-hours">{t.risk.margin}</label>
          <input id="margin-hours" name="margin.hours" inputMode="decimal" defaultValue={form.marginHours} required aria-describedby="margin-hint" />
          <small id="margin-hint" className="muted">
            {t.risk.marginHint}
          </small>
        </div>
      </section>
      <section className="card">
        <h2>{t.risk.funding}</h2>
        <p className="muted">{t.risk.fundingHint}</p>
        <div className="row3">
          {FUNDING_METHODS.map((_, i) => (
            <div className="field" key={i}>
              <label htmlFor={`fund-${i + 1}`}>{t.risk.choice(i + 1)}</label>
              <select id={`fund-${i + 1}`} name={`fund.${i + 1}`} defaultValue={form.funding[i] ?? ''}>
                <option value="">{t.risk.noChoice}</option>
                {FUNDING_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t.risk.fundingMethods[m]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <label className="check">
          <input type="checkbox" name="async.allowUnknown" value="1" defaultChecked={form.allowUnknownAsync} /> {t.risk.asyncUnknown}
        </label>
        <small className="muted">{t.risk.asyncHint}</small>
      </section>
    </>
  );
}
