import { isDomainError } from '@texholiday/contracts';
import { notFound, redirect } from 'next/navigation';
import { FlightExtrasForm } from '../../../../../components/FlightExtrasForm';
import { OrderQuoteSummary } from '../../../../../components/QuoteSummary';
import { BookingSteps } from '../../../../../components/ui/HotelBits';
import { dict, type Locale } from '../../../../../i18n/dictionaries';
import { formatInstant } from '../../../../../i18n/format';
import { booking } from '../../../../../server/booking';
import { orderToken } from '../../../../../server/http';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

/** Seats and bags before payment (ADR-0013). Nothing to offer -> straight to the payment page. */
export default async function Extras({ params }: { params: Promise<{ locale: string; orderId: string }> }) {
  const { locale: l, orderId } = await params;
  const locale = l as Locale;
  const t = dict(locale);
  const { app } = await booking();
  const token = await orderToken(orderId);
  let offer;
  let order;
  try {
    order = await app.order(orderId, token);
    offer = app.flights ? await app.flights.services.offer(orderId, token) : null;
  } catch (err) {
    if (isDomainError(err) && err.code === 'NOT_FOUND') notFound();
    throw err;
  }
  if (!offer?.open) redirect(`/${locale}/orders/${orderId}/payment`);
  return (
    <div className="page extras">
      <BookingSteps current="details" locale={locale} product="FLIGHT" />
      <h1>{t.flight.extrasTitle}</h1>
      <div className="two-col">
        <OrderQuoteSummary quote={order.quote} locale={locale} />
        <div>
          <p className="muted">{t.flight.extrasIntro}</p>
          {offer.until && <p className="muted">{t.flight.extrasUntil(formatInstant(offer.until, locale))}</p>}
          <FlightExtrasForm locale={locale} offer={offer} />
        </div>
      </div>
    </div>
  );
}
