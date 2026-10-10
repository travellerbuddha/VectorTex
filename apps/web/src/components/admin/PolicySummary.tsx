import { ANCILLARY_FIELDS, basisPointsToPercent, MARGIN_SLOTS, slotKey } from '@texholiday/admin';
import { money, toMajor, type PricingPolicyDocument } from '@texholiday/pricing';
import { adminDict, type AdminLocale } from '../../i18n/admin';

/** Read-only view of a pricing policy document in business terms. */
export function PolicySummary({ doc, locale }: { doc: PricingPolicyDocument; locale: AdminLocale }) {
  const t = adminDict(locale);
  const shown = new Set(MARGIN_SLOTS.map(slotKey));
  const extra = doc.rules.filter((r) => !shown.has(slotKey(r)));
  const rules = [...MARGIN_SLOTS.map((s) => ({ slot: s, rule: doc.rules.find((r) => slotKey(r) === slotKey(s)) ?? null })), ...extra.map((r) => ({ slot: r, rule: r }))];
  const sep = locale === 'tr' ? ',' : '.';
  return (
    <div className="stack">
      <div className="table-wrap">
        <table data-testid="margin-table">
          <thead>
            <tr>
              <th>{t.pricing.product}</th>
              <th>{t.pricing.paymentMode}</th>
              <th>{t.pricing.application}</th>
              <th className="num">{t.pricing.value}</th>
            </tr>
          </thead>
          <tbody>
            {rules.map(({ slot, rule }) => (
              <tr key={slotKey(slot)}>
                <td>{t.pricing.products[slot.productType]}</td>
                <td>{t.pricing.paymentModes[slot.paymentMode]}</td>
                <td>{rule ? t.pricing.applications[rule.application] : '—'}</td>
                <td className="num">
                  {!rule ? (
                    <span className="muted">{t.pricing.none}</span>
                  ) : rule.kind === 'PERCENT_OF_NET' ? (
                    <>
                      {`%${basisPointsToPercent(rule.basisPoints, sep)}`}
                      {rule.ancillaries && (
                        <small className="muted" data-testid="ancillary-margins">
                          <br />
                          {ANCILLARY_FIELDS.map((f) => {
                            const bp = rule.ancillaries![`${f}BasisPoints` as const];
                            return `${t.pricing.ancillaryLabels[f]}: ${bp === null ? t.pricing.ancillaryNotSet : `%${basisPointsToPercent(bp, sep)}`}`;
                          }).join(' · ')}
                        </small>
                      )}
                    </>
                  ) : (
                    `${toMajor(money(rule.amount.currency, rule.amount.minor))} ${rule.amount.currency}`
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="facts">
        <dt>{t.pricing.rounding}</dt>
        <dd>{t.pricing.roundings[doc.rounding]}</dd>
        <dt>{t.pricing.ssp}</dt>
        <dd>
          {t.pricing.sspProviderManaged}: <strong>{doc.allowBelowSspProviderManaged ? t.common.yes : t.common.no}</strong>
          <br />
          {t.pricing.sspPackage}: <strong>{doc.allowBelowSspInOpaquePackage ? t.common.yes : t.common.no}</strong>
        </dd>
        <dt>{t.pricing.fx}</dt>
        <dd>{doc.fx ? `${doc.fx.source} · ${Math.round(doc.fx.maxRateAgeSeconds / 60)} min · ${t.pricing.roundings[doc.fx.rounding]}` : t.pricing.fxNone}</dd>
        <dt>{t.pricing.fees}</dt>
        <dd>{doc.serviceFees.length === 0 ? t.pricing.feesNone : doc.serviceFees.map((f) => `${f.label[locale]} (${f.scope})`).join(', ')}</dd>
      </dl>
    </div>
  );
}
