import { visibleNav } from '../../../components/admin/AdminNav';
import { adminDict, adminLocale } from '../../../i18n/admin';
import { admin, can, requireStaff } from '../../../server/admin';
import { actorOf } from '../../../server/admin-forms';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const staff = await requireStaff();
  const t = adminDict(await adminLocale());
  const sections = visibleNav(staff).filter((n) => n.key !== 'home');
  const ops = can(staff, 'orders.view')
    ? await Promise.all([admin().orders.tasks(actorOf(staff), 'OPEN'), admin().orders.list(actorOf(staff), { attention: true, limit: 200 })])
    : null;
  return (
    <div>
      <h1>{t.home.title(staff.displayName)}</h1>
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
