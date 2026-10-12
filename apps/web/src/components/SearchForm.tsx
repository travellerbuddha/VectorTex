'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, MapPin, Plus, Search, Users } from 'lucide-react';
import { dict, errorMessage, type Locale } from '../i18n/dictionaries';
import { boardLabel } from '../i18n/format';
import { api, ApiError } from './api';
import { savedCurrency } from './currency-pref';
import { DateRangeField } from './DateRangeField';
import { Stepper } from './Stepper';

interface Place {
  placeId: string;
  name: string;
  address: string;
  /** A single hotel (hotel pages): searched by its provider code instead of a place. */
  hotelId?: string;
}
interface RoomInput {
  adults: number;
  childAges: number[];
}

const addDays = (isoDate: string, n: number) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * One segmented bar: where, check-in, check-out, guests (rooms in a panel), Ara. The currency comes from the header's
 * language and currency choice; the guests' nationality is not asked and defaults to the site language's market.
 * `today` comes from the server so both sides render the same dates.
 */
export function SearchForm({
  locale,
  currencies,
  today,
  initial,
}: {
  locale: Locale;
  currencies: string[];
  today: string;
  initial?: { place?: Place; checkin?: string; checkout?: string; rooms?: RoomInput[]; nationality?: string; currency?: string; boardType?: string | null };
}) {
  const t = dict(locale);
  const router = useRouter();
  const ids = { dest: useId(), list: useId(), hint: useId(), guests: useId(), panel: useId() };
  const [query, setQuery] = useState(initial?.place?.name ?? '');
  const [place, setPlace] = useState<Place | null>(initial?.place ?? null);
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [active, setActive] = useState(-1);
  const [checkin, setCheckin] = useState(initial?.checkin ?? addDays(today, 14));
  const [checkout, setCheckout] = useState(initial?.checkout ?? addDays(today, 17));
  const [rooms, setRooms] = useState<RoomInput[]>(initial?.rooms ?? [{ adults: 2, childAges: [] }]);
  // shortcut: TR→TR, EN→GB market default until the business sets the nationality rule (G06), then read it from config.
  const nationality = initial?.nationality ?? (locale === 'tr' ? 'TR' : 'GB');
  const [guestsOpen, setGuestsOpen] = useState(false);
  const guestsRef = useRef<HTMLDivElement>(null);
  const guestsButton = useRef<HTMLButtonElement>(null);
  // A list's board filter (e.g. all inclusive) travels with its "see prices" link so the list price can be found.
  const [boardType, setBoardType] = useState<string | null>(initial?.boardType ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (place && query === place.name) return;
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const r = await api<{ data: Place[] }>(`/api/v1/places?q=${encodeURIComponent(query.trim())}&lang=${locale}`);
        setSuggestions(r.data.slice(0, 8));
        setActive(-1);
      } catch {
        setSuggestions([]);
      }
    }, 250);
  }, [query, place, locale]);

  const choose = (p: Place) => {
    setPlace(p);
    setQuery(p.name);
    setSuggestions([]);
  };

  // The guests panel closes on Escape, on a click outside it and on "Tamam"; focus goes back to its button.
  useEffect(() => {
    if (!guestsOpen) return;
    const outside = (e: PointerEvent) => {
      if (!guestsRef.current?.contains(e.target as Node)) setGuestsOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [guestsOpen]);
  const closeGuests = () => {
    setGuestsOpen(false);
    guestsButton.current?.focus();
  };
  const openGuests = () => {
    setGuestsOpen(true);
    requestAnimationFrame(() => guestsRef.current?.querySelector<HTMLElement>('.guests-panel button:not([aria-disabled]), .guests-panel select')?.focus());
  };

  const updateRoom = (i: number, next: Partial<RoomInput>) => setRooms(rooms.map((r, j) => (i === j ? { ...r, ...next } : r)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!place) {
      setError(t.search.pickSuggestion);
      return;
    }
    setBusy(true);
    try {
      const target = place.hotelId ? { hotelIds: [place.hotelId] } : { placeId: place.placeId };
      const currency = savedCurrency(currencies) ?? (initial?.currency && currencies.includes(initial.currency) ? initial.currency : (currencies[0] ?? 'EUR'));
      const r = await api<{ sessionId: string }>('/api/v1/search/hotel', {
        method: 'POST',
        body: { target, checkin, checkout, rooms, nationality, currency, locale, ...(boardType ? { boardType } : {}) },
      });
      const q = new URLSearchParams(place.hotelId ? { hotel: place.hotelId, hotelName: place.name } : { place: place.placeId, placeName: place.name });
      if (boardType) q.set('board', boardType);
      router.push(`/${locale}/search/hotels/${r.sessionId}?${q.toString()}`);
    } catch (err) {
      setError(errorMessage(locale, err instanceof ApiError ? err.code : undefined));
      setBusy(false);
    }
  }

  if (currencies.length === 0) return <p className="notice">{t.search.noCurrency}</p>;

  const adults = rooms.reduce((n, r) => n + r.adults, 0);
  const children = rooms.reduce((n, r) => n + r.childAges.length, 0);
  const summary = t.search.guestsSummary(adults, children, rooms.length);

  return (
    <form className="card search search-card hotel-search" onSubmit={submit} noValidate aria-describedby={error ? 'search-error' : undefined}>
      <div className="search-bar">
        <div className="field combo seg seg-dest">
          <label htmlFor={ids.dest}>
            <MapPin />
            {t.search.destination}
          </label>
          <input
            id={ids.dest}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={suggestions.length > 0}
            aria-controls={ids.list}
            aria-describedby={ids.hint}
            aria-activedescendant={active >= 0 ? `${ids.list}-${active}` : undefined}
            autoComplete="off"
            placeholder={t.search.destinationPlaceholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPlace(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, suggestions.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter' && active >= 0 && suggestions[active]) {
                e.preventDefault();
                choose(suggestions[active]!);
              } else if (e.key === 'Escape') setSuggestions([]);
            }}
            required
          />
          <small id={ids.hint} className="visually-hidden">
            {t.search.destinationHint}
          </small>
          {suggestions.length > 0 && (
            <ul id={ids.list} role="listbox" className="suggestions">
              {suggestions.map((s, i) => (
                <li key={s.placeId} id={`${ids.list}-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(s)}>
                  <strong>{s.name}</strong>
                  <span>{s.address}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DateRangeField
          locale={locale}
          today={today}
          start={checkin}
          end={checkout}
          labels={{ start: t.search.checkin, end: t.search.checkout }}
          onChange={(a, b) => {
            setCheckin(a);
            setCheckout(b);
          }}
        />
        <div className="seg seg-guests" ref={guestsRef}>
          <button
            ref={guestsButton}
            type="button"
            className="guests-toggle"
            aria-expanded={guestsOpen}
            aria-controls={ids.panel}
            onClick={() => (guestsOpen ? setGuestsOpen(false) : openGuests())}
          >
            <span className="seg-label">
              <Users />
              {t.search.guests}
            </span>
            <span className="seg-value" title={summary}>
              {summary}
            </span>
            <ChevronDown className="seg-chevron" />
          </button>
          <div
            id={ids.panel}
            className="guests-panel"
            role="dialog"
            aria-label={t.search.guests}
            hidden={!guestsOpen}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                closeGuests();
              }
            }}
          >
            {rooms.map((room, i) => (
              <div className="guest-room" key={i}>
                <span className="guest-room-title">
                  {t.search.room} {i + 1}
                </span>
                <Stepper label={t.search.adults} value={room.adults} min={1} max={6} words={t.search} onChange={(n) => updateRoom(i, { adults: n })} />
                <Stepper
                  label={t.search.children}
                  value={room.childAges.length}
                  min={0}
                  max={4}
                  words={t.search}
                  onChange={(n) => updateRoom(i, { childAges: Array.from({ length: n }, (_, k) => room.childAges[k] ?? 8) })}
                />
                {room.childAges.length > 0 && (
                  <div className="guest-ages">
                    {room.childAges.map((age, k) => (
                      <div className="field" key={k}>
                        <label htmlFor={`age-${i}-${k}`}>
                          {t.search.childAge} {k + 1}
                        </label>
                        <select id={`age-${i}-${k}`} value={age} onChange={(e) => updateRoom(i, { childAges: room.childAges.map((a, m) => (m === k ? Number(e.target.value) : a)) })}>
                          {Array.from({ length: 18 }, (_, n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
                {rooms.length > 1 && (
                  <button type="button" className="link guest-remove" onClick={() => setRooms(rooms.filter((_, j) => j !== i))}>
                    {t.search.removeRoom}
                  </button>
                )}
              </div>
            ))}
            <div className="guests-foot">
              {rooms.length < 5 ? (
                <button type="button" className="secondary small" onClick={() => setRooms([...rooms, { adults: 2, childAges: [] }])}>
                  <Plus />
                  {t.search.addRoom}
                </button>
              ) : (
                <span />
              )}
              <button type="button" className="secondary small" onClick={closeGuests}>
                {t.search.done}
              </button>
            </div>
          </div>
        </div>
        <div className="seg-go">
          <button type="submit" className="primary search-submit" disabled={busy}>
            <Search />
            {busy ? t.search.searching : t.search.submit}
          </button>
        </div>
      </div>
      {initial?.boardType && (
        <label className="check">
          <input type="checkbox" checked={boardType !== null} onChange={(e) => setBoardType(e.target.checked ? (initial.boardType ?? null) : null)} /> {t.search.onlyBoard(boardLabel(initial.boardType, null, locale) ?? initial.boardType)}
        </label>
      )}
      {error && (
        <p id="search-error" className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
