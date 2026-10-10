import { ADMIN_REPORTS } from '../../../../components/admin/AdminNav';
import { adminDict, adminLocale } from '../../../../i18n/admin';
import { requireStaff } from '../../../../server/admin';

export const dynamic = 'force-dynamic';

export default async function Reports() {
  const staff = await requireStaff();
  const t = adminDict(await adminLocale());
  const mine = ADMIN_REPORTS.filter((r) => r.any.some((p) => staff.permissions.has(p)));
  if (mine.length === 0) return <p className="notice">{t.noAccess}</p>;
  return (
    <div>
      <h1>{t.reports.title}</h1>
      <p className="muted">{t.reports.intro}</p>
      <ul className="tiles">
        {mine.map((r) => (
          <li key={r.key}>
            <a href={r.href}>{t.reports.items[r.key]!.title}</a>
            <p className="muted">{t.reports.items[r.key]!.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
