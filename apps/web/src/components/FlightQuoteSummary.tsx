import type { FlightQuoteView } from '@texholiday/booking';
import { dict, type Locale } from '../i18n/dictionaries';
import { formatMoney } from '../i18n/format';
import { FlightBaggage, FlightJourney, FlightTerms } from './FlightJourney';

/** The accepted flight fare and rules, exactly as stored on the server (quote version). */
export function FlightQuoteSummary({ quote, locale }: { quote: FlightQuoteView; locale: Locale }) {
  const t = dict(locale);
  const f = t.flight;
  const p = quote.passengers;
  return (
    <section className="card summary" aria-labelledby="summary-title">
      <h2 id="summary-title">{t.checkout.summary}</h2>
      <p className="hotel-name">{quote.title}</p>
      {quote.journeys.map((j) => (
        <FlightJourney key={j.direction} j={j} locale={locale} />
      ))}
      <p className="muted">
        {f.passengers}: {f.pax(p.adults, p.childAges.length, p.infantAges.length)}
        {quote.cabinClass ? ` · ${f.cabins[quote.cabinClass] ?? quote.cabinClass}` : ''}
        {quote.fareFamily ? ` · ${quote.fareFamily}` : ''}
      </p>
      <FlightTerms terms={quote.terms} locale={locale} />
      <FlightBaggage baggage={quote.baggage} locale={locale} />
      {quote.priceChangedFrom && (
        <p className="notice" role="status">
          {f.priceChanged(formatMoney(quote.priceChangedFrom, locale))}
        </p>
      )}
      <p className="total">
        <span>{f.total}</span> <strong data-testid="quote-total">{formatMoney(quote.total, locale)}</strong>
      </p>
    </section>
  );
}
