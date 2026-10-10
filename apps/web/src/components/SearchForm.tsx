'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { dict, errorMessage, type Locale } from '../i18n/dictionaries';
import { boardLabel } from '../i18n/format';
import { api, ApiError } from './api';

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
 * `today` and `countries` come from the server: the browser's Intl data differs from Node's (country names and their
 * order), and anything rendered differently on the two sides breaks hydration.
 */
export function SearchForm({
  locale,
  currencies,
  countries,
  today,
  initial,
}: {
  locale: Locale;
  currencies: string[];
  countries: ReadonlyArray<{ code: string; name: string }>;
  today: string;
  initial?: { place?: Place; checkin?: string; checkout?: string; rooms?: RoomInput[]; nationality?: string; currency?: string; boardType?: string | null };
}) {
  const t = dict(locale);
  const router = useRouter();
  const ids = { dest: useId(), list: useId(), hint: useId(), nat: useId() };
  const [query, setQuery] = useState(initial?.place?.name ?? '');
  const [place, setPlace] = useState<Place | null>(initial?.place ?? null);
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [active, setActive] = useState(-1);
  const [checkin, setCheckin] = useState(initial?.checkin ?? addDays(today, 14));
  const [checkout, setCheckout] = useState(initial?.checkout ?? addDays(today, 17));
  const [rooms, setRooms] = useState<RoomInput[]>(initial?.rooms ?? [{ adults: 2, childAges: [] }]);
  const [nationality, setNationality] = useState(initial?.nationality ?? (locale === 'tr' ? 'TR' : 'GB'));
  const [currency, setCurrency] = useState(initial?.currency && currencies.includes(initial.currency) ? initial.currency : (currencies[0] ?? 'EUR'));
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

  return (
    <form className="card search" onSubmit={submit} noValidate aria-describedby={error ? 'search-error' : undefined}>
      <div className="field combo">
        <label htmlFor={ids.dest}>{t.search.destination}</label>
        <input
          id={ids.dest}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0}
          aria-controls={ids.list}
          aria-describedby={ids.hint}
          aria-activedescendant={active >= 0 ? `${ids.list}-${active}` : undefined}
          autoComplete="off"
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
        <small id={ids.hint}>{t.search.destinationHint}</small>
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

      <div className="row">
        <div className="field">
          <label htmlFor="checkin">{t.search.checkin}</label>
          <input id="checkin" type="date" value={checkin} min={today} onChange={(e) => setCheckin(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="checkout">{t.search.checkout}</label>
          <input id="checkout" type="date" value={checkout} min={checkin} onChange={(e) => setCheckout(e.target.value)} required />
        </div>
      </div>

      <fieldset className="rooms">
        <legend>{t.search.rooms}</legend>
        {rooms.map((room, i) => (
          <div className="room" key={i}>
            <span className="room-title">
              {t.search.room} {i + 1}
            </span>
            <div className="row">
              <div className="field">
                <label htmlFor={`adults-${i}`}>{t.search.adults}</label>
                <select id={`adults-${i}`} value={room.adults} onChange={(e) => updateRoom(i, { adults: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`children-${i}`}>{t.search.children}</label>
                <select
                  id={`children-${i}`}
                  value={room.childAges.length}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    updateRoom(i, { childAges: Array.from({ length: n }, (_, k) => room.childAges[k] ?? 8) });
                  }}
                >
                  {[0, 1, 2, 3, 4].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </div>
            </div>
            {room.childAges.length > 0 && (
              <div className="row wrap">
                {room.childAges.map((age, k) => (
                  <div className="field small" key={k}>
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
              <button type="button" className="link" onClick={() => setRooms(rooms.filter((_, j) => j !== i))}>
                {t.search.removeRoom}
              </button>
            )}
          </div>
        ))}
        {rooms.length < 5 && (
          <button type="button" className="secondary" onClick={() => setRooms([...rooms, { adults: 2, childAges: [] }])}>
            {t.search.addRoom}
          </button>
        )}
      </fieldset>

      <div className="row">
        <div className="field">
          <label htmlFor={ids.nat}>{t.search.nationality}</label>
          <select id={ids.nat} value={nationality} onChange={(e) => setNationality(e.target.value)} aria-describedby="nat-hint">
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <small id="nat-hint">{t.search.nationalityHint}</small>
        </div>
        <div className="field">
          <label htmlFor="currency">{t.search.currency}</label>
          <select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
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
      <button type="submit" className="primary" disabled={busy}>
        {busy ? t.search.searching : t.search.submit}
      </button>
    </form>
  );
}
