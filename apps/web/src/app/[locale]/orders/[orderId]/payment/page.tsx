import { isDomainError } from '@texholiday/contracts';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { MockPayment } from '../../../../../components/MockPayment';
import { NuiteePayment } from '../../../../../components/NuiteePayment';
import { QuoteSummary } from '../../../../../components/QuoteSummary';
import { dict, type Locale } from '../../../../../i18n/dictionaries';
import { formatInstant } from '../../../../../i18n/format';
import { booking } from '../../../../../server/booking';
import { orderToken, originOf } from '../../../../../server/http';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

export default async function Payment({ params }: { params: Promise<{ locale: string; orderId: string }> }) {
  const { locale: l, orderId } = await params;
  const locale = l as Locale;
  const t = dict(locale);
  const { app } = await booking();
  const token = await orderToken(orderId);
  let session;
  let order;
  try {
    session = await app.paymentSession(orderId, token);
    order = await app.order(orderId, token);
  } catch (err) {
    if (isDomainError(err) && err.code === 'NOT_FOUND') notFound();
    throw err;
  }
  if (session.state === 'CLOSED') redirect(`/${locale}/orders/${orderId}`);
  // The provider sends the customer back here; the URL carries no secret (the access token is a cookie).
  const returnUrl = `${originOf(await headers())}/${locale}/orders/${orderId}/return`;
  return (
    <div className="page payment">
      <h1>{t.payment.title}</h1>
      <div className="two-col">
        <QuoteSummary quote={order.quote} locale={locale} />
        <div className="card">
          {session.state === 'NOT_READY' && (
            <p role="status">
              {t.payment.preparing} <a href={`/${locale}/orders/${orderId}/payment`}>{t.payment.reload}</a>
            </p>
          )}
          {session.state === 'READY' && (
            <>
              {session.payBy && <p className="muted">{t.payment.payBy(formatInstant(session.payBy, locale))}</p>}
              <p>{t.payment.secure}</p>
              {session.publicKey === 'mock' ? (
                <MockPayment locale={locale} orderId={orderId} returnUrl={returnUrl} />
              ) : (
                <NuiteePayment locale={locale} publicKey={session.publicKey} secretKey={session.secretKey} returnUrl={returnUrl} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
