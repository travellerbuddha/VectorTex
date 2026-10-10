import { exposureCurrencies, secondsToHours } from '@texholiday/admin';
import type { RiskPolicyDocument } from '@texholiday/contracts';
import { money, toMajor } from '@texholiday/pricing';
import { adminDict, type AdminLocale } from '../../i18n/admin';

/** Read-only view of a risk policy document in business terms. */
export function RiskPolicySummary({ doc, locale }: { doc: RiskPolicyDocument; locale: AdminLocale }) {
  const t = adminDict(locale);
  const sep = locale === 'tr' ? ',' : '.';
  // Exact string formatting (no floating point): "7500000" EUR -> "75.000,00" (TR) / "75,000.00" (EN).
  const amount = (c: string, minor: string) => {
    const [whole, frac] = toMajor(money(c, minor)).split('.');
    const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, locale === 'tr' ? '.' : ',');
    return frac ? `${grouped}${sep}${frac}` : grouped;
  };
  return (
    <dl className="facts" data-testid="risk-summary">
      <dt>{t.risk.exposure}</dt>
      <dd>
        <ul className="plain">
          {exposureCurrencies(doc).map((c) => {
            const minor = doc.maxUncapturedSupplierExposure[c];
            return (
              <li key={c}>
                {c}: {minor === undefined ? <span className="muted">{t.risk.notEntered}</span> : <strong>{amount(c, minor)}</strong>}
              </li>
            );
          })}
        </ul>
      </dd>
      <dt>{t.risk.margin}</dt>
      <dd>{secondsToHours(doc.authorizationSafetyMarginSeconds, sep)}</dd>
      <dt>{t.risk.asyncUnknown}</dt>
      <dd>{doc.allowUnknownAsyncConfirmationBound ? t.common.yes : t.common.no}</dd>
      <dt>{t.risk.funding}</dt>
      <dd>
        <ol className="plain-ol">
          {doc.fundingPreference.map((m) => (
            <li key={m}>{t.risk.fundingMethods[m]}</li>
          ))}
        </ol>
      </dd>
    </dl>
  );
}
