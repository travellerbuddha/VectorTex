import { isDomainError } from '@texholiday/contracts';
import { Clock } from 'lucide-react';
import { notFound } from 'next/navigation';
import { CheckoutForm } from '../../../../components/CheckoutForm';
import { QuoteSummary } from '../../../../components/QuoteSummary';
import { BookingSteps } from '../../../../components/ui/HotelBits';
import { dict, type Locale } from '../../../../i18n/dictionaries';
import { formatInstant } from '../../../../i18n/format';
import { TrackEvent } from '../../../../components/tracking/TrackEvent';
import { quoteEcommerce } from '../../../../server/analytics';
import { booking } from '../../../../server/booking';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

export default async function Checkout({ params }: { params: Promise<{ locale: string; quoteId: string }> }) {
  const { locale: l, quoteId } = await params;
  const locale = l as Locale;
  const t = dict(locale);
  const { app } = await booking();
  let quote;
  try {
    quote = await app.quote(quoteId);
  } catch (err) {
    if (isDomainError(err) && err.code === 'NOT_FOUND') notFound();
    throw err;
  }
  const expired = new Date(quote.expiresAt).getTime() <= Date.now();
  return (
    <div className="page checkout">
      {!expired && <TrackEvent event="begin_checkout" params={quoteEcommerce(quote)} />}
      <BookingSteps current="details" locale={locale} />
      <h1>{t.checkout.title}</h1>
      <div className="two-col">
        <QuoteSummary quote={quote} locale={locale} />
        <div>
          {expired ? (
            <p className="notice" role="status">
              {t.checkout.quoteExpired} <a href={`/${locale}`}>{t.results.searchAgain}</a>
            </p>
          ) : (
            <>
              <p className="hold-note">
                <Clock />
                {t.checkout.expiresAt(formatInstant(quote.expiresAt, locale))}
              </p>
              <CheckoutForm locale={locale} quoteVersionId={quote.quoteVersionId} termsVersion={quote.termsVersion} roomNumbers={quote.rooms.map((r) => r.occupancyNumber)} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
