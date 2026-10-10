'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, PlaneLanding, PlaneTakeoff, Search, Users } from 'lucide-react';
import { dict, errorMessage, type Locale } from '../i18n/dictionaries';
import { api, ApiError } from './api';

export interface Airport {
  iata: string;
  name: string;
  city: string | null;
  country: string | null;
}

const addDays = (isoDate: string, n: number) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const airportLabel = (a: Airport) => `${a.city ?? a.name} (${a.iata})`;

/** Airport combobox on the provider's airport search; the IATA code of a picked suggestion is what is searched. */
function AirportField({ label, hint, value, onChange, icon }: { label: string; hint: string; value: Airport | null; onChange: (a: Airport | null) => void; icon?: React.ReactNode }) {
  const ids = { input: useId(), list: useId(), hint: useId() };
  const [query, setQuery] = useState(value ? airportLabel(value) : '');
  const [suggestions, setSuggestions] = useState<Airport[]>([]);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value && query === airportLabel(value)) return;
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const r = await api<{ data: Airport[] }>(`/api/v1/airports?q=${encodeURIComponent(query.trim())}`);
        setSuggestions(r.data.slice(0, 8));
        setActive(-1);
      } catch {
        setSuggestions([]);
      }
    }, 250);
  }, [query, value]);

  const choose = (a: Airport) => {
    onChange(a);
    setQuery(airportLabel(a));
    setSuggestions([]);
  };

  return (
    <div className="field combo seg">
      <label htmlFor={ids.input}>
        {icon}
        {label}
      </label>
      <input
        id={ids.input}
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
          onChange(null);
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
      <small id={ids.hint}>{hint}</small>
      {suggestions.length > 0 && (
        <ul id={ids.list} role="listbox" className="suggestions">
          {suggestions.map((s, i) => (
            <li key={s.iata} id={`${ids.list}-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(s)}>
              <strong>
                {s.iata} · {s.city ?? s.name}
              </strong>
              <span>{[s.name, s.country].filter(Boolean).join(', ')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface FlightSearchInitial {
  origin?: Airport;
  destination?: Airport;
  departDate?: string;
  returnDate?: string | null;
  adults?: number;
  childAges?: number[];
  infantAges?: number[];
  cabinClass?: string | null;
  currency?: string;
}

/** `today` comes from the server (hydration-safe). Prices and offer ids stay on the server; this sends criteria only. */
export function FlightSearchForm({ locale, currencies, today, initial }: { locale: Locale; currencies: string[]; today: string; initial?: FlightSearchInitial }) {
  const t = dict(locale);
  const f = t.flight;
  const router = useRouter();
  const [origin, setOrigin] = useState<Airport | null>(initial?.origin ?? null);
  const [destination, setDestination] = useState<Airport | null>(initial?.destination ?? null);
  const [roundTrip, setRoundTrip] = useState(initial ? initial.returnDate !== null && initial.returnDate !== undefined : true);
  const [departDate, setDepartDate] = useState(initial?.departDate ?? addDays(today, 21));
  const [returnDate, setReturnDate] = useState(initial?.returnDate ?? addDays(today, 28));
  const [adults, setAdults] = useState(initial?.adults ?? 1);
  const [childAges, setChildAges] = useState<number[]>(initial?.childAges ?? []);
  const [infantAges, setInfantAges] = useState<number[]>(initial?.infantAges ?? []);
  const [cabin, setCabin] = useState(initial?.cabinClass ?? '');
  const [currency, setCurrency] = useState(initial?.currency && currencies.includes(initial.currency) ? initial.currency : (currencies[0] ?? 'EUR'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!origin || !destination) {
      setError(f.pickAirport);
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ sessionId: string }>('/api/v1/search/flight', {
        method: 'POST',
        body: { origin: origin.iata, destination: destination.iata, departDate, returnDate: roundTrip ? returnDate : null, adults, childAges, infantAges, cabinClass: cabin || null, currency, locale },
      });
      const q = new URLSearchParams({ o: JSON.stringify(origin), d: JSON.stringify(destination) });
      router.push(`/${locale}/flights/${r.sessionId}?${q.toString()}`);
    } catch (err) {
      setError(errorMessage(locale, err instanceof ApiError ? err.code : undefined));
      setBusy(false);
    }
  }

  if (currencies.length === 0) return <p className="notice">{f.noCurrency}</p>;

  const count = (label: string, id: string, value: number, max: number, min: number, onChange: (n: number) => void) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => (
          <option key={n}>{n}</option>
        ))}
      </select>
    </div>
  );

  return (
    <form className="card search search-card flight-search" onSubmit={submit} noValidate aria-describedby={error ? 'flight-search-error' : undefined}>
      <fieldset className="trip-type">
        <legend className="visually-hidden">{f.roundTrip}</legend>
        <label className="check">
          <input type="radio" name="trip" checked={roundTrip} onChange={() => setRoundTrip(true)} /> {f.roundTrip}
        </label>
        <label className="check">
          <input type="radio" name="trip" checked={!roundTrip} onChange={() => setRoundTrip(false)} /> {f.oneWay}
        </label>
      </fieldset>
      <div className="search-main flight-main">
        <AirportField label={f.from} hint={f.airportHint} value={origin} onChange={setOrigin} icon={<PlaneTakeoff />} />
        <AirportField label={f.to} hint={f.airportHint} value={destination} onChange={setDestination} icon={<PlaneLanding />} />
        <div className="seg-dates">
          <div className="field seg">
            <label htmlFor="depart">
              <CalendarDays />
              {f.depart}
            </label>
            <input id="depart" type="date" value={departDate} min={today} onChange={(e) => setDepartDate(e.target.value)} required />
          </div>
          {roundTrip && (
            <div className="field seg">
              <label htmlFor="return">
                <CalendarDays />
                {f.return}
              </label>
              <input id="return" type="date" value={returnDate} min={departDate} onChange={(e) => setReturnDate(e.target.value)} required />
            </div>
          )}
        </div>
      </div>
      <p className="pax-title">
        <Users />
        {f.passengers}
      </p>
      <div className="row row3">
        {count(f.adults, 'adults', adults, 9, 1, (n) => {
          setAdults(n);
          setInfantAges(infantAges.slice(0, n));
        })}
        {count(f.children, 'children', childAges.length, 8, 0, (n) => setChildAges(Array.from({ length: n }, (_, k) => childAges[k] ?? 6)))}
        {count(f.infants, 'infants', infantAges.length, Math.min(adults, 4), 0, (n) => setInfantAges(Array.from({ length: n }, (_, k) => infantAges[k] ?? 1)))}
      </div>
      {(childAges.length > 0 || infantAges.length > 0) && (
        <div className="row wrap">
          {childAges.map((age, k) => (
            <div className="field small" key={`c${k}`}>
              <label htmlFor={`child-age-${k}`}>
                {f.childAge} {k + 1}
              </label>
              <select id={`child-age-${k}`} value={age} onChange={(e) => setChildAges(childAges.map((a, m) => (m === k ? Number(e.target.value) : a)))}>
                {Array.from({ length: 10 }, (_, n) => n + 2).map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </div>
          ))}
          {infantAges.map((age, k) => (
            <div className="field small" key={`i${k}`}>
              <label htmlFor={`infant-age-${k}`}>
                {f.infantAge} {k + 1}
              </label>
              <select id={`infant-age-${k}`} value={age} onChange={(e) => setInfantAges(infantAges.map((a, m) => (m === k ? Number(e.target.value) : a)))}>
                {[0, 1].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
      <div className="search-foot">
        <div className="field">
          <label htmlFor="cabin">{f.cabin}</label>
          <select id="cabin" value={cabin} onChange={(e) => setCabin(e.target.value)}>
            <option value="">{f.cabins.any}</option>
            {['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'].map((c) => (
              <option key={c} value={c}>
                {f.cabins[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="flight-currency">{t.search.currency}</label>
          <select id="flight-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="primary search-submit" disabled={busy}>
          <Search />
          {busy ? t.search.searching : t.search.submit}
        </button>
        {error && (
          <p id="flight-search-error" className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
