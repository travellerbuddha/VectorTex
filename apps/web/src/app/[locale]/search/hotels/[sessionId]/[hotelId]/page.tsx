import { isDomainError } from '@texholiday/contracts';
import { ArrowDown, ArrowLeft, CalendarDays, ChevronDown, Coffee, Hotel, Users } from 'lucide-react';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { HotelDetails, HotelGallery, HotelTitle } from '../../../../../../components/hotels/HotelSections';
import { OfferButton } from '../../../../../../components/OfferButton';
import { CancellationLine } from '../../../../../../components/QuoteSummary';
import { SearchForm } from '../../../../../../components/SearchForm';
import { TrackEvent } from '../../../../../../components/tracking/TrackEvent';
import { hotelTransition, PriceLine } from '../../../../../../components/ui/HotelBits';
import { dict, type Locale } from '../../../../../../i18n/dictionaries';
import { analyticsValue, boardLabel, formatDate, formatMoney } from '../../../../../../i18n/format';
import { booking } from '../../../../../../server/booking';
import { activeFilters, applyFilters, filtersQuery, keptSearch, readFilters } from '../../../../../../server/result-filters';

export const dynamic = 'force-dynamic';

/**
 * A hotel's page inside a search: the hotel opened from the results (or found by a search for this one hotel), with
 * every room offer the search found, priced exactly as on the results page, and "Seç" on each. The hotel's text and
 * photos come from the stored copy or the provider (read only); the page never prices anything again.
 */
const read = cache(async (sessionId: string, hotelId: string, locale: Locale) => {
  const { app } = await booking();
  try {
    return await app.searchHotel(sessionId, hotelId, locale);
  } catch (err) {
    if (isDomainError(err) && err.code === 'NOT_FOUND') notFound();
    if (isDomainError(err) && err.code === 'QUOTE_EXPIRED') return null;
    throw err;
  }
});

type Params = Promise<{ locale: string; sessionId: string; hotelId: string }>;

export default async function SearchHotel({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale: l, sessionId, hotelId } = await params;
  const sp = await searchParams;
  const locale = l as Locale;
  const t = dict(locale);
  const { app } = await booking();
  const criteria = await app.searchCriteria(sessionId);
  if (!criteria) notFound();
  const [currencies, view] = await Promise.all([app.availableCurrencies(), read(sessionId, hotelId, locale)]);
  const kept = keptSearch(sp);
  const filters = readFilters(sp);
  const name = view?.hotel?.name ?? view?.content?.name ?? (kept.hotel === hotelId ? kept.hotelName : undefined) ?? hotelId;
  const lower = (text: string) => text.toLocaleLowerCase(locale === 'tr' ? 'tr' : 'en');

  // "Change" searches this hotel again: the new search opens this page with its own rooms.
  const form = (
    <SearchForm
      locale={locale}
      currencies={currencies}
      today={new Date().toISOString().slice(0, 10)}
      initial={{
        place: { placeId: `hotel:${hotelId}`, hotelId, name, address: '' },
        checkin: criteria.checkin,
        checkout: criteria.checkout,
        rooms: criteria.rooms,
        nationality: criteria.nationality,
        currency: criteria.currency,
        boardType: criteria.boardType ?? null,
      }}
    />
  );
  if (!view) {
    return (
      <div className="page">
        <p className="notice" role="status">
          {t.results.expired}
        </p>
        {form}
      </div>
    );
  }

  const h = view.hotel;
  const c = view.content;
  // The results' room filters (cancellation, board) carry over, so the cheapest room here is the card's price.
  const roomFilters = { ...filters, stars: null, sort: 'recommended' as const };
  const narrowed = h && activeFilters(roomFilters) > 0 ? (applyFilters([h], roomFilters, new Date())[0] ?? null) : null;
  const offers = narrowed?.offers ?? h?.offers ?? [];
  const from = narrowed?.from ?? h?.from ?? null;
  const base = `/${locale}/search/hotels/${sessionId}`;
  const resultsQuery = filtersQuery(kept, filters);
  const allRoomsQuery = filtersQuery(kept, { ...filters, free: false, boards: [] });
  const allRoomsHref = `${base}/${encodeURIComponent(hotelId)}${allRoomsQuery ? `?${allRoomsQuery}` : ''}`;
  const searchedThisHotel = 'hotelIds' in criteria.target && criteria.target.hotelIds.length === 1 && criteria.target.hotelIds[0] === hotelId;
  const adults = criteria.rooms.reduce((n, r) => n + r.adults, 0);
  const children = criteria.rooms.reduce((n, r) => n + r.childAges.length, 0);
  const dates = `${formatDate(criteria.checkin, locale)} → ${formatDate(criteria.checkout, locale)}`;
  const images = c?.images.length ? c.images : h?.photo ? [{ url: h.photo, caption: null }] : [];
  const viewItem = from
    ? { currency: from.currency, value: analyticsValue(from), items: [{ item_id: hotelId, item_name: name, item_category: 'Hotel', item_list_id: 'search_results', price: analyticsValue(from) }] }
    : null;

  return (
    <div className="page hotel-page search-hotel">
      {searchedThisHotel && kept.hotel === hotelId && <TrackEvent event="search" params={{ search_term: kept.hotelName ?? name }} />}
      {viewItem && <TrackEvent event="view_item" params={viewItem} />}
      {!searchedThisHotel && (
        <p className="back-row">
          <a className="text-link back-link" href={resultsQuery ? `${base}?${resultsQuery}` : base}>
            <ArrowLeft />
            {t.results.back}
          </a>
        </p>
      )}
      <details className="refine" open={offers.length === 0}>
        <summary>
          <span className="refine-fact refine-place">
            <Hotel />
            <strong>{name}</strong>
          </span>
          <span className="refine-fact">
            <CalendarDays />
            {dates} · {t.results.nights(view.nights)}
          </span>
          <span className="refine-fact">
            <Users />
            {t.results.guests(adults, children, criteria.rooms.length)}
          </span>
          <span className="refine-change">
            {t.results.change}
            <ChevronDown />
          </span>
        </summary>
        {form}
      </details>

      <HotelTitle name={name} stars={h?.stars ?? c?.stars ?? null} address={h?.address ?? c?.address ?? null} rating={h?.rating ?? c?.rating ?? null} reviews={c?.reviewCount ?? null} locale={locale}>
        {from && (
          <div className="stay-price">
            <PriceLine label={t.results.lowest} amount={formatMoney(from, locale)} terms={`${t.results.nights(view.nights)} · ${lower(t.results.total)}`} testId="search-price" />
            <a className="text-link" href="#rooms">
              {t.results.seeRooms}
              <ArrowDown />
            </a>
          </div>
        )}
      </HotelTitle>
      <HotelGallery images={images} name={name} seed={hotelId} transition={hotelTransition(hotelId)} />

      <section className="rooms" id="rooms" aria-labelledby="rooms-title">
        <div className="rooms-head">
          <h2 id="rooms-title">{t.results.rooms}</h2>
          <p className="muted">
            {dates} · {t.results.nights(view.nights)} · {t.results.guests(adults, children, criteria.rooms.length)}
          </p>
        </div>
        {narrowed && h && narrowed.offers.length < h.offers.length && (
          <p className="rooms-note">
            {t.results.filteredRooms(narrowed.offers.length)} <a href={allRoomsHref}>{t.results.allRooms}</a>
          </p>
        )}
        {offers.length === 0 ? (
          <p className="notice">{t.results.noRooms}</p>
        ) : (
          <ul className="offers room-list">
            {offers.map((o) => {
              const board = boardLabel(o.boardType, o.boardName, locale);
              return (
                <li key={o.key} className="offer">
                  <div className="offer-info">
                    <h3 className="room-name">{o.roomName ?? board ?? t.results.rooms}</h3>
                    <p className="offer-tags">
                      {board && (
                        <span className="tag tag-feature offer-board">
                          <Coffee />
                          {board}
                        </span>
                      )}
                      <CancellationLine c={o.cancellation} locale={locale} />
                    </p>
                    {o.payAtProperty.length > 0 && (
                      <p className="muted small">
                        {t.results.payAtProperty}: {o.payAtProperty.map((m) => formatMoney(m, locale)).join(' + ')}
                      </p>
                    )}
                  </div>
                  <div className="price">
                    <strong>{formatMoney(o.total, locale)}</strong>
                    <span className="muted">{t.results.total}</span>
                    <span className="muted">
                      {formatMoney(o.perNightAverage, locale)} {t.results.perNight}
                    </span>
                    <OfferButton locale={locale} sessionId={view.sessionId} offerKey={o.key} label={`${t.results.choose}: ${name} – ${o.roomName ?? ''}`} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {c && (
        <div className="hotel-about">
          <HotelDetails content={c} locale={locale} />
        </div>
      )}
      <p className="muted small">
        {t.lists.code}: <code>{hotelId}</code>
      </p>
    </div>
  );
}

export async function generateMetadata({ params }: { params: Params }) {
  const { locale, sessionId, hotelId } = await params;
  const view = await read(sessionId, hotelId, locale as Locale);
  return { title: view?.hotel?.name ?? view?.content?.name ?? undefined, robots: { index: false } };
}
