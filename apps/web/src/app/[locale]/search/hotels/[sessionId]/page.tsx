import { isDomainError } from '@texholiday/contracts';
import { BedDouble, CalendarCheck, CalendarDays, ChevronDown, MapPin, SlidersHorizontal, Users, X } from 'lucide-react';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';
import { OpenOnWide } from '../../../../../components/results/OpenOnWide';
import { SearchForm } from '../../../../../components/SearchForm';
import { HotelCard, hotelTransition, PriceLine, type CardTag } from '../../../../../components/ui/HotelBits';
import { dict, type Locale } from '../../../../../i18n/dictionaries';
import { boardLabel, formatDate, formatMoney } from '../../../../../i18n/format';
import { booking } from '../../../../../server/booking';
import { activeFilters, applyFilters, boardCounts, filtersQuery, freeCancelNow, keptSearch, readFilters, type ResultFilters } from '../../../../../server/result-filters';
import { TrackEvent } from '../../../../../components/tracking/TrackEvent';
import { searchEcommerce } from '../../../../../server/analytics';

export const dynamic = 'force-dynamic';


export default async function Results({ params, searchParams }: { params: Promise<{ locale: string; sessionId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale: l, sessionId } = await params;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const locale = l as Locale;
  const t = dict(locale);
  const { app } = await booking();
  const criteria = await app.searchCriteria(sessionId);
  if (!criteria) notFound();
  const currencies = await app.availableCurrencies();
  const hotelTarget = 'hotelIds' in criteria.target ? criteria.target.hotelIds[0] : undefined;
  const place =
    hotelTarget && one('hotel') === hotelTarget
      ? { placeId: `hotel:${hotelTarget}`, hotelId: hotelTarget, name: one('hotelName') ?? hotelTarget, address: '' }
      : one('place') && one('placeName')
        ? { placeId: one('place')!, name: one('placeName')!, address: '' }
        : undefined;
  const form = (
    <SearchForm
      locale={locale}
      currencies={currencies}
     
      today={new Date().toISOString().slice(0, 10)}
      initial={{ place, checkin: criteria.checkin, checkout: criteria.checkout, rooms: criteria.rooms, nationality: criteria.nationality, currency: criteria.currency, boardType: criteria.boardType ?? null }}
    />
  );
  const adults = criteria.rooms.reduce((n, r) => n + r.adults, 0);
  const children = criteria.rooms.reduce((n, r) => n + r.childAges.length, 0);

  let view;
  try {
    view = await app.searchSession(sessionId);
  } catch (err) {
    if (isDomainError(err) && err.code === 'QUOTE_EXPIRED') {
      return (
        <div className="page">
          <p className="notice" role="status">
            {t.results.expired}
          </p>
          {form}
        </div>
      );
    }
    throw err;
  }

  const filters = readFilters(sp);
  const hotels = applyFilters(view.hotels, filters, new Date());
  const kept = keptSearch(sp);
  const base = `/${locale}/search/hotels/${sessionId}`;
  const href = (f: ResultFilters) => {
    const q = filtersQuery(kept, f);
    return q ? `${base}?${q}` : base;
  };
  const clearHref = href({ free: false, boards: [], stars: null, sort: 'recommended' });
  // A hotel opens its page in this search with the same filters, so its rooms and lowest price match the card.
  const shown = filtersQuery(kept, filters);
  const hotelHref = (id: string) => `${base}/${encodeURIComponent(id)}${shown ? `?${shown}` : ''}`;
  const now = new Date();
  const lower = (text: string) => text.toLocaleLowerCase(locale === 'tr' ? 'tr' : 'en');
  const active = activeFilters(filters);
  // Each active filter as a chip that removes only itself (the sort and the other filters stay).
  const chips = [
    ...(filters.free ? [{ key: 'free', text: t.results.freeCancel, href: href({ ...filters, free: false }) }] : []),
    ...filters.boards.map((b) => ({ key: `board-${b}`, text: boardLabel(b, null, locale) ?? b, href: href({ ...filters, boards: filters.boards.filter((x) => x !== b) }) })),
    ...(filters.stars ? [{ key: 'stars', text: filters.stars === 5 ? t.lists.stars(5) : t.results.minStars(filters.stars), href: href({ ...filters, stars: null }) }] : []),
  ];

  return (
    <div className="page results">
      <TrackEvent event="search" params={{ search_term: place?.name ?? 'hotel search' }} />
      <TrackEvent event="view_item_list" params={searchEcommerce(hotels)} />
      <details className="refine">
        <summary>
          {place && (
            <span className="refine-fact refine-place">
              <MapPin />
              <strong>{place.name}</strong>
            </span>
          )}
          <span className="refine-fact">
            <CalendarDays />
            {formatDate(criteria.checkin, locale)} → {formatDate(criteria.checkout, locale)} · {t.results.nights(view.nights)}
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

      {view.hotels.length === 0 ? (
        <>
          <div className="results-head">
            <h1>{t.results.title}</h1>
          </div>
          <p className="notice">{t.results.none}</p>
        </>
      ) : (
        <div className="results-layout">
          <OpenOnWide
            className="filters"
            summary={
              <>
                <SlidersHorizontal />
                {t.results.filters}
                {active > 0 && <span className="count">{active}</span>}
              </>
            }
          >
            <FilterForm locale={locale} filters={filters} kept={kept} boards={boardCounts(view.hotels)} clearHref={active > 0 || filters.sort !== 'recommended' ? clearHref : null} />
          </OpenOnWide>
          <div className="results-main">
            <div className="results-head">
              <h1>{t.results.title}</h1>
              <p className="results-count">{t.results.count(hotels.length)}</p>
              <nav className="sort" aria-label={t.results.sort}>
                <span className="sort-label" aria-hidden="true">
                  {t.results.sort}
                </span>
                {(['recommended', 'price', 'rating'] as const).map((v) => (
                  <a key={v} href={href({ ...filters, sort: v })} aria-current={filters.sort === v ? 'true' : undefined}>
                    {t.results.sortBy[v]}
                  </a>
                ))}
              </nav>
            </div>
            {chips.length > 0 && (
              <ul className="filter-chips" aria-label={t.results.activeFilters}>
                {chips.map((c) => (
                  <li key={c.key}>
                    <a href={c.href} aria-label={t.results.removeFilter(c.text)}>
                      {c.text}
                      <X />
                    </a>
                  </li>
                ))}
                <li>
                  <a className="text-link" href={clearHref}>
                    {t.results.clear}
                  </a>
                </li>
              </ul>
            )}
            {hotels.length === 0 && (
              <p className="notice" role="status">
                {t.results.noneFiltered} <a href={clearHref}>{t.results.clear}</a>
              </p>
            )}
            <ul className="hotels">
              {hotels.map((h, i) => {
                // The price shown is the lowest offer still shown; its board and what is payable at the hotel are its terms.
                const low = h.offers.find((o) => o.total.minor === h.from.minor) ?? h.offers[0]!;
                const board = boardLabel(low.boardType, low.boardName, locale);
                const terms = [
                  t.results.nights(view.nights),
                  board,
                  lower(t.results.total),
                  low.payAtProperty.length > 0 ? `${lower(t.results.payAtProperty)}: ${low.payAtProperty.map((m) => formatMoney(m, locale)).join(' + ')}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ');
                const tags: CardTag[] = [
                  { key: 'rooms', text: t.results.roomOptions(h.offers.length), kind: 'feature', icon: BedDouble },
                  ...(freeCancelNow(h, now) ? [{ key: 'free', text: t.results.freeCancelOption, kind: 'ok' as const, icon: CalendarCheck }] : []),
                ];
                return (
                  <li key={h.hotelId} style={i < 6 ? ({ '--i': i } as CSSProperties) : undefined}>
                    <HotelCard
                      heading="h2"
                      href={hotelHref(h.hotelId)}
                      hotel={{ hotelId: h.hotelId, name: h.name, stars: h.stars, place: h.city ?? h.address, image: h.photo, rating: h.rating, reviewCount: null }}
                      locale={locale}
                      tags={tags}
                      price={<PriceLine label={t.results.lowest} amount={formatMoney(h.from, locale)} terms={terms} testId="search-price" />}
                      action={t.results.seeRooms}
                      transition={hotelTransition(h.hotelId)}
                      eager={i === 0}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/** Plain GET form: works without JavaScript; the search's own parameters ride along as hidden fields. */
function FilterForm({ locale, filters, kept, boards, clearHref }: { locale: Locale; filters: ResultFilters; kept: Record<string, string>; boards: Array<{ board: string; hotels: number }>; clearHref: string | null }) {
  const t = dict(locale).results;
  return (
    <form method="get">
      {Object.entries(kept).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {/* The order is chosen above the results; applying filters keeps it. */}
      {filters.sort !== 'recommended' && <input type="hidden" name="sort" value={filters.sort} />}
      <fieldset>
        <legend>{t.cancelPolicy}</legend>
        <label className="check">
          <input type="checkbox" name="free" value="1" defaultChecked={filters.free} /> {t.freeCancel}
        </label>
      </fieldset>
      {boards.length > 0 && (
        <fieldset>
          <legend>{t.board}</legend>
          {boards.map((b) => (
            <label key={b.board} className="check">
              <input type="checkbox" name="boards" value={b.board} defaultChecked={filters.boards.includes(b.board)} /> {boardLabel(b.board, null, locale) ?? b.board}
              <span className="n">{b.hotels}</span>
            </label>
          ))}
        </fieldset>
      )}
      <fieldset>
        <legend>{t.stars}</legend>
        {[null, 3, 4, 5].map((n) => (
          <label key={n ?? 0} className="check">
            <input type="radio" name="stars" value={n ?? ''} defaultChecked={filters.stars === n} /> {n === 5 ? dict(locale).lists.stars(5) : n ? t.minStars(n) : t.anyStars}
          </label>
        ))}
      </fieldset>
      <div className="filter-actions">
        <button type="submit" className="primary">
          {t.apply}
        </button>
        {clearHref && <a href={clearHref}>{t.clear}</a>}
      </div>
    </form>
  );
}

export async function generateMetadata() {
  return { robots: { index: false } };
}
