import { ActionForm } from '../../../../components/admin/ActionForm';
import { adminDict, adminLocale } from '../../../../i18n/admin';
import { admin, can, requireStaff } from '../../../../server/admin';
import { formatAdminInstant } from '../../../../server/admin-forms';
import { inviteAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function StaffList() {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  if (!can(staff, 'staff.manage', 'permissions.manage')) return <p className="notice">{t.noAccess}</p>;
  const rows = await admin().auth.accounts();
  return (
    <div>
      <h1>{t.staff.title}</h1>
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.staff.name}</th>
                <th>{t.staff.email}</th>
                <th>{t.staff.status}</th>
                <th>{t.staff.mfa}</th>
                <th>{t.staff.lastLogin}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={`/yonetim/personel/${r.id}`}>{r.displayName}</a> {r.id === staff.id && <span className="muted">{t.staff.you}</span>}
                  </td>
                  <td>{r.email}</td>
                  <td>
                    <span className={`tag ${r.status === 'ACTIVE' ? 'ok' : r.status === 'DISABLED' ? 'bad' : 'warn'}`}>{t.staff.statuses[r.status]}</span>{' '}
                    {r.locked && <span className="tag bad">{t.staff.locked}</span>}
                  </td>
                  <td>{r.mfaEnrolled ? t.staff.mfaOn : t.staff.mfaOff}</td>
                  <td>{r.lastLoginAt ? formatAdminInstant(r.lastLoginAt, locale) : t.common.never}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {can(staff, 'staff.manage') && (
        <section className="card">
          <h2>{t.staff.inviteTitle}</h2>
          <p className="muted">{t.staff.inviteHint}</p>
          <ActionForm action={inviteAction} submit={t.staff.invite} copyText={t.common.copy}>
            <div className="field">
              <label htmlFor="displayName">{t.staff.name}</label>
              <input id="displayName" name="displayName" required minLength={2} maxLength={80} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="email">{t.staff.email}</label>
              <input id="email" name="email" type="email" required autoComplete="off" />
            </div>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
