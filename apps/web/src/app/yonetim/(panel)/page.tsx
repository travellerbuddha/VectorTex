import { visibleNav } from '../../../components/admin/AdminNav';
import { adminDict, adminLocale } from '../../../i18n/admin';
import { requireStaff } from '../../../server/admin';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const staff = await requireStaff();
  const t = adminDict(await adminLocale());
  const sections = visibleNav(staff).filter((n) => n.key !== 'home');
  return (
    <div>
      <h1>{t.home.title(staff.displayName)}</h1>
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
