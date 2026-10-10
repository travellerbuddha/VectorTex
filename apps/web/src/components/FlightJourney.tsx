import type { FlightJourneyView, FlightOfferView, FlightTermsView } from '@texholiday/booking';
import { dict, type Locale } from '../i18n/dictionaries';
import { formatDuration, formatLocalDate, formatLocalTime } from '../i18n/format';

/** One direction of a flight: times are airport-local as published, never converted. */
export function FlightJourney({ j, locale }: { j: FlightJourneyView; locale: Locale }) {
  const f = dict(locale).flight;
  const carriers = [...new Set(j.segments.map((s) => s.carrier.name ?? s.carrier.code))].join(', ');
  const minutes = j.segments.every((s) => s.durationMinutes !== null) ? j.segments.reduce((a, s) => a + (s.durationMinutes ?? 0), 0) : null;
  return (
    <div className="journey">
      <p className="journey-head">
        <span className="tag">{j.direction === 'OUTBOUND' ? f.outbound : f.inbound}</span> {formatLocalDate(j.departure.local, locale)}
      </p>
      <p className="journey-times">
        <strong>{formatLocalTime(j.departure.local)}</strong> {j.departure.code} → <strong>{formatLocalTime(j.arrival.local)}</strong> {j.arrival.code}
        {j.arrival.local.slice(0, 10) !== j.departure.local.slice(0, 10) && <sup> (+{formatLocalDate(j.arrival.local, locale)})</sup>}
      </p>
      <p className="muted">
        {carriers} · {j.connections === 0 ? f.direct : f.connections(j.connections)}
        {minutes !== null && j.connections === 0 ? ` · ${formatDuration(minutes, locale)}` : ''}
      </p>
      <details className="segments">
        <summary className="muted">{j.segments.map((s) => [s.carrier.code, s.flightNumber].filter(Boolean).join(' ')).join(' · ')}</summary>
        <ul>
          {j.segments.map((s, i) => (
            <li key={i}>
              {formatLocalTime(s.departureLocal)} {s.origin.code}
              {s.origin.name ? ` (${s.origin.name})` : ''} → {formatLocalTime(s.arrivalLocal)} {s.destination.code}
              {s.destination.name ? ` (${s.destination.name})` : ''} · {[s.carrier.code, s.flightNumber].filter(Boolean).join(' ')}
              {s.cabin ? ` · ${s.cabin}` : ''}
              {s.operatedBy ? ` · ${f.operatedBy(s.operatedBy)}` : ''}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function FlightTerms({ terms, locale }: { terms: FlightTermsView; locale: Locale }) {
  const f = dict(locale).flight;
  return (
    <p className="terms-tags">
      {terms.refundable ? <span className="tag ok">{terms.refundFee ? `${f.refundable} (${f.refundFee})` : f.refundable}</span> : <span className="tag warn">{f.nonRefundable}</span>}{' '}
      {terms.changeable ? <span className="tag">{terms.changeFee ? `${f.changeable} (${f.changeFee})` : f.changeable}</span> : <span className="tag">{f.notChangeable}</span>}
    </p>
  );
}

export function FlightBaggage({ baggage, locale }: { baggage: FlightOfferView['baggage']; locale: Locale }) {
  const f = dict(locale).flight;
  const checked = baggage.some((b) => b.bagType === 'checked' && b.pieces > 0);
  return (
    <p className="muted">
      {baggage
        .filter((b) => b.pieces > 0)
        .map((b) => `${f.baggage[b.bagType] ?? b.bagType}: ${f.pieces(b.pieces, b.weightKg)}`)
        .join(' · ')}
      {!checked && `${baggage.some((b) => b.pieces > 0) ? ' · ' : ''}${f.noChecked}`}
    </p>
  );
}
