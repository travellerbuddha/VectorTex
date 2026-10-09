import { notFound } from 'next/navigation';
import { PERMISSION_CODES, PERMISSIONS, STAFF_ROLES } from '@texholiday/contracts';
import { ActionForm } from '../../../../../components/admin/ActionForm';
import { adminDict, adminLocale } from '../../../../../i18n/admin';
import { admin, can, requireStaff } from '../../../../../server/admin';
import { formatAdminInstant } from '../../../../../server/admin-forms';
import { disableAction, enableAction, grantAction, grantRoleAction, passwordLinkAction, resetMfaAction, revokeAction, unlockAction } from '../actions';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function StaffDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  if (!can(me, 'staff.manage', 'permissions.manage')) return <p className="notice">{t.noAccess}</p>;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { auth, permissions } = admin();
  const accounts = await auth.accounts();
  const person = accounts.find((a) => a.id === id);
  if (!person) notFound();
  const names = new Map(accounts.map((a) => [a.id, a.displayName]));
  const who = (actor: string | null) => (actor ? (names.get(actor) ?? (actor.startsWith('system:') ? t.common.system : actor)) : '—');
  const history = await permissions.grants({ staffId: id });
  const active = history.filter((g) => !g.revokedAt);
  const activeCodes = new Set(active.map((g) => g.permission));
  const describe = (code: (typeof PERMISSION_CODES)[number]) => PERMISSIONS[code][locale];
  const hidden = <input type="hidden" name="staffId" value={id} />;
  const manageStaff = can(me, 'staff.manage');
  const managePerms = can(me, 'permissions.manage');

  return (
    <div>
      <p>
        <a href="/yonetim/personel">← {t.staff.title}</a>
      </p>
      <h1>
        {person.displayName} {person.id === me.id && <span className="muted">{t.staff.you}</span>}
      </h1>
      <div className="grid2">
        <section className="card">
          <h2>{t.staff.account}</h2>
          <dl className="facts">
            <dt>{t.staff.email}</dt>
            <dd>{person.email}</dd>
            <dt>{t.staff.status}</dt>
            <dd>
              {t.staff.statuses[person.status]} {person.locked && <span className="tag bad">{t.staff.locked}</span>}
            </dd>
            <dt>{t.staff.mfa}</dt>
            <dd>{person.mfaEnrolled ? t.staff.mfaOn : t.staff.mfaOff}</dd>
            <dt>{t.staff.lastLogin}</dt>
            <dd>{person.lastLoginAt ? formatAdminInstant(person.lastLoginAt, locale) : t.common.never}</dd>
          </dl>
        </section>
        {manageStaff && (
          <section className="card">
            <h2>{t.staff.accountActions}</h2>
            {person.status === 'DISABLED' ? (
              <ActionForm action={enableAction} submit={t.staff.enable} variant="secondary" copyText={t.common.copy}>
                {hidden}
              </ActionForm>
            ) : (
              <div className="stack">
                <ActionForm action={passwordLinkAction} submit={person.status === 'INVITED' ? t.staff.inviteAgain : t.staff.passwordLink} variant="secondary" copyText={t.common.copy}>
                  {hidden}
                  {person.status === 'ACTIVE' && <small>{t.staff.passwordLinkHint}</small>}
                </ActionForm>
                {person.mfaEnrolled && (
                  <ActionForm action={resetMfaAction} submit={t.staff.resetMfa} variant="secondary" confirmText={t.staff.resetMfaConfirm}>
                    {hidden}
                    <small>{t.staff.resetMfaHint}</small>
                  </ActionForm>
                )}
                {person.locked && (
                  <ActionForm action={unlockAction} submit={t.staff.unlock} variant="secondary">
                    {hidden}
                  </ActionForm>
                )}
                {person.id !== me.id && (
                  <ActionForm action={disableAction} submit={t.staff.disable} variant="danger" confirmText={t.staff.disableConfirm}>
                    {hidden}
                    <div className="field">
                      <label htmlFor="reason">{t.common.reason}</label>
                      <input id="reason" name="reason" required minLength={3} maxLength={200} />
                    </div>
                  </ActionForm>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      <section className="card">
        <h2>{t.perms.active}</h2>
        {active.length === 0 ? (
          <p className="muted">{t.perms.none}</p>
        ) : (
          <ul className="perm-list">
            {active.map((g) => (
              <li key={g.id}>
                <div>
                  <strong>{describe(g.permission)}</strong> <code className="muted">{g.permission}</code>
                  <br />
                  <small>
                    {t.perms.grantedBy}: {who(g.grantedBy)} · {formatAdminInstant(g.grantedAt, locale)}
                  </small>
                </div>
                {managePerms && (
                  <ActionForm action={revokeAction} submit={t.perms.revoke} variant="danger" confirmText={t.perms.revokeConfirm} className="inline-form">
                    {hidden}
                    <input type="hidden" name="permission" value={g.permission} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {managePerms && (
        <div className="grid2">
          <section className="card">
            <h2>{t.perms.grantTitle}</h2>
            <ActionForm action={grantAction} submit={t.perms.grant}>
              {hidden}
              <div className="field">
                <label htmlFor="permission">{t.perms.permission}</label>
                <select id="permission" name="permission" required>
                  {PERMISSION_CODES.filter((c) => !activeCodes.has(c)).map((c) => (
                    <option key={c} value={c}>
                      {describe(c)}
                    </option>
                  ))}
                </select>
                <small>{t.perms.selfApprovalWarning}</small>
              </div>
              <div className="field">
                <label htmlFor="grant-note">{t.common.note}</label>
                <input id="grant-note" name="note" maxLength={200} />
              </div>
            </ActionForm>
          </section>
          <section className="card">
            <h2>{t.perms.roleTitle}</h2>
            <p className="muted">{t.perms.roleHint}</p>
            <ActionForm action={grantRoleAction} submit={t.perms.applyRole}>
              {hidden}
              <div className="field">
                <label htmlFor="role">{t.perms.role}</label>
                <select id="role" name="role" required>
                  {STAFF_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t.perms.roles[r]}
                    </option>
                  ))}
                </select>
              </div>
            </ActionForm>
          </section>
        </div>
      )}

      <section className="card">
        <h2>{t.perms.history}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.perms.permission}</th>
                <th>{t.perms.grantedBy}</th>
                <th>{t.perms.grantedAt}</th>
                <th>{t.perms.revokedBy}</th>
                <th>{t.perms.revokedAt}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((g) => (
                <tr key={g.id}>
                  <td>
                    {describe(g.permission)}
                    {g.note && <small className="muted"> — {g.note}</small>}
                  </td>
                  <td>{who(g.grantedBy)}</td>
                  <td>{formatAdminInstant(g.grantedAt, locale)}</td>
                  <td>{who(g.revokedBy)}</td>
                  <td>
                    {formatAdminInstant(g.revokedAt, locale)}
                    {g.revokeNote && <small className="muted"> — {g.revokeNote}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
