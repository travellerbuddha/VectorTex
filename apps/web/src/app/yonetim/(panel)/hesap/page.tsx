import { ActionForm } from '../../../../components/admin/ActionForm';
import { adminDict, adminLocale } from '../../../../i18n/admin';
import { admin, requireStaff } from '../../../../server/admin';
import { formatAdminInstant } from '../../../../server/admin-forms';
import { createRecoveryCodesAction } from './actions';

export const dynamic = 'force-dynamic';

const BATCH = 10;

/** The signed-in person's own account: two-step verification and recovery codes. */
export default async function Account({ searchParams }: { searchParams: Promise<{ kurtarma?: string }> }) {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  const a = t.account;
  const status = await admin().auth.recoveryStatus(staff.id);
  const { kurtarma } = await searchParams;
  const usedRecovery = kurtarma !== undefined && /^\d+$/.test(kurtarma);
  return (
    <div>
      <h1>{a.title}</h1>
      {usedRecovery && (
        <p className="notice" role="status">
          {t.recovery.remaining(status.remaining)}
        </p>
      )}
      <section className="card">
        <dl className="facts">
          <dt>{a.email}</dt>
          <dd>{staff.email}</dd>
          <dt>{a.mfa}</dt>
          <dd>{a.mfaOn}</dd>
        </dl>
      </section>
      <section className="card">
        <h2>{a.codes}</h2>
        <p className="muted">{a.codesIntro}</p>
        <p data-testid="recovery-status">
          {status.remaining === 0 && status.createdAt === null ? a.none : a.remaining(status.remaining, BATCH)}
          {status.createdAt && <small className="muted"> · {a.createdAt(formatAdminInstant(status.createdAt, locale))}</small>}
        </p>
        <ActionForm
          action={createRecoveryCodesAction}
          submit={status.createdAt ? a.renew : a.create}
          confirmText={status.createdAt ? a.renewConfirm : undefined}
          copyText={a.copy}
          variant={status.createdAt ? 'secondary' : 'primary'}
        >
          <div className="field">
            <label htmlFor="totp">{a.totp}</label>
            <input id="totp" name="totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required className="code-input" />
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
