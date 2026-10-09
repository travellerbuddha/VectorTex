import { AuthShell } from '../../../../components/admin/AuthShell';
import { adminDict, adminLocale } from '../../../../i18n/admin';
import { admin } from '../../../../server/admin';
import { completeSetupAction } from '../../actions';

export const dynamic = 'force-dynamic';

/** One-time link (invite or password reset). The token is in the path only; it is used once and stored hashed. */
export default async function Setup({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ durum?: string }> }) {
  const locale = await adminLocale();
  const t = adminDict(locale);
  const { token } = await params;
  const { durum } = await searchParams;
  const { auth, settings } = admin();
  const info = await auth.setupInfo(token);
  if (!info) {
    return (
      <AuthShell locale={locale} title={t.setup.title} error={t.setup.invalid}>
        <p>
          <a href="/yonetim/giris">{t.signIn.title}</a>
        </p>
      </AuthShell>
    );
  }
  const error = durum === 'eslesme' ? t.setup.mismatch : durum === 'zayif' ? t.setup.weak(settings.minPasswordLength) : durum === 'gecersiz' ? t.setup.invalid : null;
  return (
    <AuthShell locale={locale} title={info.purpose === 'INVITE' ? t.setup.title : t.setup.resetTitle} error={error}>
      <p>
        {t.setup.hello(info.displayName)} <span className="muted">{info.email}</span>
      </p>
      <form action={completeSetupAction} className="stack">
        <input type="hidden" name="token" value={token} />
        <input type="email" name="email" value={info.email} autoComplete="username" readOnly hidden />
        <div className="field">
          <label htmlFor="password">{t.setup.password}</label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={settings.minPasswordLength} maxLength={128} required aria-describedby="pw-hint" />
          <small id="pw-hint">{t.setup.passwordHint(settings.minPasswordLength)}</small>
        </div>
        <div className="field">
          <label htmlFor="confirm">{t.setup.confirm}</label>
          <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={settings.minPasswordLength} maxLength={128} required />
        </div>
        <button type="submit" className="primary">
          {t.setup.submit}
        </button>
      </form>
    </AuthShell>
  );
}
