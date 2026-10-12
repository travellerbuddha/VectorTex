'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, PlaneLanding, PlaneTakeoff, Search, Users } from 'lucide-react';
import { dict, errorMessage, type Locale } from '../i18n/dictionaries';
import { api, ApiError } from './api';
import { savedCurrency } from './currency-pref';
import { DateRangeField } from './DateRangeField';
import { Stepper } from './Stepper';

export interface Airport {
  iata: string;
  name: string;
  city: string | null;
  country: string | null;
}

const addDays = (isoDate: string, n: number) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const airportLabel = (a: Airport) => `${a.city ?? a.name} (${a.iata})`;

/** Airport combobox on the provider's airport search; the IATA code of a picked suggestion is what is searched. */
function AirportField({ label, hint, placeholder, value, onChange, icon, className }: { label: string; hint: string; placeholder: string; value: Airport | null; onChange: (a: Airport | null) => void; icon?: React.ReactNode; className: string }) {
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
    <div className={`field combo seg ${className}`}>
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
        placeholder={placeholder}
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
      <small id={ids.hint} className="visually-hidden">
        {hint}
      </small>
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

/**
 * The hotel bar's twin: trip type above one segmented strip (from | to | depart | return | passengers | Ara), passengers
 * and cabin in a panel. The currency is the header choice when flights sell it, else the first flight currency.
 * `today` comes from the server (hydration-safe). Prices and offer ids stay on the server; this sends criteria only.
 */
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
  const [paxOpen, setPaxOpen] = useState(false);
  const paxRef = useRef<HTMLDivElement>(null);
  const paxButton = useRef<HTMLButtonElement>(null);
  const ids = { panel: useId() };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The passengers panel closes on Escape, on a click outside it and on "Tamam"; focus goes back to its button.
  useEffect(() => {
    if (!paxOpen) return;
    const outside = (e: PointerEvent) => {
      if (!paxRef.current?.contains(e.target as Node)) setPaxOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [paxOpen]);
  const closePax = () => {
    setPaxOpen(false);
    paxButton.current?.focus();
  };
  const openPax = () => {
    setPaxOpen(true);
    requestAnimationFrame(() => paxRef.current?.querySelector<HTMLElement>('.guests-panel button:not([aria-disabled]), .guests-panel select')?.focus());
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!origin || !destination) {
      setError(f.pickAirport);
      return;
    }
    setBusy(true);
    try {
      const currency = savedCurrency(currencies) ?? (initial?.currency && currencies.includes(initial.currency) ? initial.currency : (currencies[0] ?? 'EUR'));
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

  const count = (label: string, _id: string, value: number, max: number, min: number, onChange: (n: number) => void) => (
    <Stepper label={label} value={value} min={min} max={max} words={t.search} onChange={onChange} />
  );

  const summary = f.paxSummary(adults, childAges.length, infantAges.length, cabin ? (f.cabins[cabin] ?? cabin) : null);

  return (
    <form className="card search search-card hotel-search flight-search" onSubmit={submit} noValidate aria-describedby={error ? 'flight-search-error' : undefined}>
      <div className="trip-toggle" role="radiogroup" aria-label={f.tripType}>
        <label className="trip-option">
          <input type="radio" name="trip" checked={roundTrip} onChange={() => setRoundTrip(true)} />
          {f.roundTrip}
        </label>
        <label className="trip-option">
          <input type="radio" name="trip" checked={!roundTrip} onChange={() => setRoundTrip(false)} />
          {f.oneWay}
        </label>
      </div>
      <div className={`search-bar${roundTrip ? '' : ' one-way'}`}>
        <AirportField className="seg-from" label={f.from} hint={f.airportHint} placeholder={f.originPlaceholder} value={origin} onChange={setOrigin} icon={<PlaneTakeoff />} />
        <AirportField className="seg-to" label={f.to} hint={f.airportHint} placeholder={f.destinationPlaceholder} value={destination} onChange={setDestination} icon={<PlaneLanding />} />
        <DateRangeField
          locale={locale}
          today={today}
          start={departDate}
          end={returnDate}
          minNights={0}
          single={!roundTrip}
          labels={{ start: f.depart, end: f.return }}
          onChange={(a, b) => {
            setDepartDate(a);
            setReturnDate(b < a ? a : b);
          }}
        />
        <div className="seg seg-guests" ref={paxRef}>
          <button ref={paxButton} type="button" className="guests-toggle" aria-expanded={paxOpen} aria-controls={ids.panel} onClick={() => (paxOpen ? setPaxOpen(false) : openPax())}>
            <span className="seg-label">
              <Users />
              {f.passengers}
            </span>
            <span className="seg-value" title={summary}>
              {summary}
            </span>
            <ChevronDown className="seg-chevron" />
          </button>
          <div
            id={ids.panel}
            className="guests-panel pax-panel"
            role="dialog"
            aria-label={f.passengers}
            hidden={!paxOpen}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                closePax();
              }
            }}
          >
            <div className="pax-counts">
              {count(f.adults, 'adults', adults, 9, 1, (n) => {
                setAdults(n);
                setInfantAges(infantAges.slice(0, n));
              })}
              {count(f.children, 'children', childAges.length, 8, 0, (n) => setChildAges(Array.from({ length: n }, (_, k) => childAges[k] ?? 6)))}
              {count(f.infants, 'infants', infantAges.length, Math.min(adults, 4), 0, (n) => setInfantAges(Array.from({ length: n }, (_, k) => infantAges[k] ?? 1)))}
            </div>
            {(childAges.length > 0 || infantAges.length > 0) && (
              <div className="guest-ages">
                {childAges.map((age, k) => (
                  <div className="field" key={`c${k}`}>
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
                  <div className="field" key={`i${k}`}>
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
            <div className="field pax-cabin">
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
            <div className="guests-foot">
              <span />
              <button type="button" className="secondary small" onClick={closePax}>
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
      {error && (
        <p id="flight-search-error" className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
