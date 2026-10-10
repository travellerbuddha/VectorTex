import type { CancellationView, FlightQuoteView, QuoteView } from '@texholiday/booking';
import { BedDouble, CalendarCheck, CircleSlash, Info, Moon, Ticket, Users } from 'lucide-react';
import { dict, type Locale } from '../i18n/dictionaries';
import { boardLabel, formatDate, formatInstant, formatMoney } from '../i18n/format';
import { FlightQuoteSummary } from './FlightQuoteSummary';
import { HotelMedia } from './ui/HotelBits';

export function CancellationLine({ c, locale }: { c: CancellationView; locale: Locale }) {
  const t = dict(locale);
  if (!c.refundable)
    return (
      <span className="tag warn">
        <CircleSlash />
        {t.cancellation.nonRefundable}
      </span>
    );
  if (c.freeUntil)
    return (
      <span className="tag ok">
        <CalendarCheck />
        {t.cancellation.free(formatInstant(c.freeUntil, locale))}
      </span>
    );
  return (
    <span className="tag">
      <Info />
      {t.cancellation.noPenalty}
    </span>
  );
}

/** The accepted price and conditions, exactly as stored on the server (quote version). */
export function QuoteSummary({ quote, locale }: { quote: QuoteView; locale: Locale }) {
  const t = dict(locale);
  const board = boardLabel(quote.room.boardType, quote.room.boardName, locale);
  return (
    <section className="card summary" aria-labelledby="summary-title">
      <h2 id="summary-title">
        <Ticket />
        {t.checkout.summary}
      </h2>
      <div className="voucher-hotel">
        <HotelMedia hotelId={quote.hotel.hotelId} photo={quote.hotel.photo} />
        <div>
          <p className="hotel-name">{quote.hotel.name}</p>
          {quote.hotel.address && <p className="muted">{quote.hotel.address}</p>}
        </div>
      </div>
      <div className="voucher-body">
        <dl className="voucher-dates">
          <div>
            <dt>{t.search.checkin}</dt>
            <dd>{formatDate(quote.checkin, locale)}</dd>
          </div>
          <div>
            <dt>{t.search.checkout}</dt>
            <dd>{formatDate(quote.checkout, locale)}</dd>
          </div>
        </dl>
        <p className="voucher-line">
          <Moon />
          {t.results.nights(quote.nights)}
        </p>
        <p className="voucher-line">
          <BedDouble />
          <span>
            {quote.room.name}
            {board ? ` · ${board}` : ''}
          </span>
        </p>
        <p className="voucher-line">
          <Users />
          <span>{quote.rooms.map((r) => `${t.search.room} ${r.occupancyNumber}: ${r.adults} ${t.search.adults.toLowerCase()}${r.childAges.length ? `, ${r.childAges.length} ${t.search.children.toLowerCase()} (${r.childAges.join(', ')})` : ''}`).join(' · ')}</span>
        </p>
        <p>
          <CancellationLine c={quote.cancellation} locale={locale} />
        </p>
      </div>
      <p className="total">
        <span>{t.results.total}</span> <strong data-testid="quote-total">{formatMoney(quote.total, locale)}</strong>
      </p>
      {quote.payAtProperty.length > 0 && (
        <p className="muted">
          {t.results.payAtProperty}: {quote.payAtProperty.map((m) => formatMoney(m, locale)).join(' + ')}
        </p>
      )}
    </section>
  );
}

/** An order's accepted quote, whatever the product. */
export function OrderQuoteSummary({ quote, locale }: { quote: QuoteView | FlightQuoteView; locale: Locale }) {
  return quote.product === 'FLIGHT' ? <FlightQuoteSummary quote={quote} locale={locale} /> : <QuoteSummary quote={quote} locale={locale} />;
}
