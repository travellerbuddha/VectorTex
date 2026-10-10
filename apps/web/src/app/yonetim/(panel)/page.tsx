import { canSeeReport, visibleNav } from '../../../components/admin/AdminNav';
import { adminDict, adminLocale } from '../../../i18n/admin';
import { admin, can, requireStaff } from '../../../server/admin';
import { actorOf } from '../../../server/admin-forms';
import { booking } from '../../../server/booking';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  const sections = visibleNav(staff).filter((n) => n.key !== 'home');
  const recovery = await admin().auth.recoveryStatus(staff.id);
  // List price alert (ADR-0014): only with a threshold in the settings; the home page never fails on it.
  const priceAlert = canSeeReport(staff, 'listPrices') ? await (await booking()).app.hotelListPriceChecks.alert(24).catch(() => null) : null;
  const ops = can(staff, 'orders.view')
    ? await Promise.all([admin().orders.tasks(actorOf(staff), 'OPEN'), admin().orders.list(actorOf(staff), { attention: true, limit: 200 })])
    : null;
  return (
    <div>
      <h1>{t.home.title(staff.displayName)}</h1>
      {recovery.remaining <= 2 && (
        <p className="notice" data-testid="recovery-warning">
          <a href="/yonetim/hesap">{recovery.remaining === 0 ? t.home.noRecovery : t.home.lowRecovery(recovery.remaining)}</a>
        </p>
      )}
      {priceAlert?.configured && priceAlert.higher + priceAlert.missing > 0 && (
        <p className="notice" data-testid="price-alert">
          <a href="/yonetim/raporlar/liste-fiyatlari?gun=7">
            {t.home.priceAlert(
              priceAlert.higher,
              priceAlert.missing,
              new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { style: 'percent', maximumFractionDigits: 1 }).format(priceAlert.thresholdBasisPoints! / 10_000),
            )}
          </a>
        </p>
      )}
      {ops && (
        <ul className="tiles stats" data-testid="ops-stats">
          <li>
            <a href="/yonetim/gorevler">
              <strong>{ops[0].length}</strong> {t.tasks.title}
            </a>
          </li>
          <li>
            <a href="/yonetim/siparisler?dikkat=1">
              <strong>{ops[1].length}</strong> {t.orders.attention}
            </a>
          </li>
        </ul>
      )}
      {staff.permissions.size === 0 ? (
        <p className="notice">{t.home.noPermissions}</p>
      ) : (
        sections.length > 0 && (
          <section className="card">
            <h2>{t.home.sections}</h2>
            <ul className="tiles">
              {sections.map((n) => (
                <li key={n.key}>
                  <a href={n.href}>{t.nav[n.key]}</a>
                </li>
              ))}
            </ul>
          </section>
        )
      )}
    </div>
  );
}
