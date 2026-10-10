import type { Metadata } from 'next';
import { dict, type Locale } from '../../i18n/dictionaries';
import { formatDate, formatInstant, formatMoney } from '../../i18n/format';
import { customerSignOutAction, requestCodeAction, restartSignInAction, verifyCodeAction } from '../../server/account-actions';
import { customerAccounts, customerToken, maskEmail, pendingEmail } from '../../server/customer';

/** "Rezervasyonlarım" / "My bookings" (ADR-0017): sign in with a one-time e-mail code, then the address's bookings. */
export const accountMetadata = (locale: Locale): Metadata => ({ title: dict(locale).account.title, robots: { index: false, follow: false } });

export async function AccountPage({ locale, state }: { locale: Locale; state: string | null }) {
  const t = dict(locale).account;
  const accounts = await customerAccounts();
  const signedIn = await accounts.orders(await customerToken());
  if (signedIn) {
    return (
      <div className="page account">
        <h1>{t.title}</h1>
        <form action={customerSignOutAction} className="account-who">
          <input type="hidden" name="locale" value={locale} />
          <span>{t.signedInAs(signedIn.email)}</span>{' '}
          <button type="submit" className="secondary small">
            {t.signOut}
          </button>
        </form>
        {signedIn.orders.length === 0 ? (
          <p className="card">{t.none}</p>
        ) : (
          <ul className="account-orders" data-testid="account-orders">
            {signedIn.orders.map((o) => (
              <li key={o.id} className="card">
                <h2>{o.title ?? t.order}</h2>
                <p>
                  {o.checkin && o.checkout ? `${formatDate(o.checkin, locale)} → ${formatDate(o.checkout, locale)}` : o.checkin ? formatDate(o.checkin, locale) : ''}
                </p>
                <p>
                  <strong>{formatMoney(o.total, locale)}</strong> · {t.statuses[o.status] ?? o.status}
                  {o.providerBookingRef ? (
                    <>
                      {' '}
                      · {t.reference}: {o.providerBookingRef}
                    </>
                  ) : null}
                </p>
                <p className="muted small">
                  {t.created}: {formatInstant(o.createdAt, locale)}
                </p>
                <a className="button" href={`/${locale}/orders/${o.id}`}>
                  {t.open}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const pending = await pendingEmail();
  const message =
    state === 'eposta' ? t.invalidEmail : state === 'sinir' ? t.tooMany : state === 'kapali' ? t.unavailable : state === 'hatali' ? t.wrongCode : null;
  return (
    <div className="page account">
      <h1>{t.title}</h1>
      {message && (
        <p className="notice" role="alert">
          {message}
        </p>
      )}
      {pending && state !== 'kapali' ? (
        <>
          <p>{t.codeSent(maskEmail(pending))}</p>
          <form action={verifyCodeAction} className="card form">
            <input type="hidden" name="locale" value={locale} />
            <label htmlFor="code">{t.code}</label>
            <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required />
            <button type="submit" className="primary">
              {t.verify}
            </button>
          </form>
          <form action={restartSignInAction}>
            <input type="hidden" name="locale" value={locale} />
            <button type="submit" className="link">
              {t.otherEmail}
            </button>
          </form>
        </>
      ) : (
        <>
          <p>{t.intro}</p>
          {accounts.available ? (
            <form action={requestCodeAction} className="card form">
              <input type="hidden" name="locale" value={locale} />
              <label htmlFor="email">{t.email}</label>
              <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
              <button type="submit" className="primary">
                {t.sendCode}
              </button>
            </form>
          ) : (
            <p className="notice">{t.unavailable}</p>
          )}
        </>
      )}
    </div>
  );
}
