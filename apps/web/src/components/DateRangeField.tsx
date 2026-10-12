'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { dict, type Locale } from '../i18n/dictionaries';

const DAY = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (isoDate: string, n: number) => iso(parse(isoDate) + n * DAY);
const monthStart = (isoDate: string) => `${isoDate.slice(0, 7)}-01`;
const addMonths = (first: string, n: number) => {
  const d = new Date(parse(first));
  d.setUTCMonth(d.getUTCMonth() + n);
  return iso(d.getTime());
};
/** Monday = 0 … Sunday = 6. */
const weekday = (isoDate: string) => (new Date(parse(isoDate)).getUTCDay() + 6) % 7;
const nightsBetween = (a: string, b: string) => Math.round((parse(b) - parse(a)) / DAY);

/**
 * Check-in and check-out (or departure and return) as two search-bar segments that open one shared calendar panel:
 * two months on wide forms, one on narrow ones (container query), the stay drawn as a band between its two ends.
 * Text comes from the dictionary, not Intl, so the server and the browser render the same labels.
 * `single` is the one-way flight case: one date, no end.
 */
export function DateRangeField({
  locale,
  today,
  start,
  end,
  onChange,
  labels,
  minNights = 1,
  single = false,
}: {
  locale: Locale;
  today: string;
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  labels: { start: string; end: string };
  /** 1 for hotel stays (check-out after check-in), 0 for flights (return may be the same day). */
  minNights?: number;
  single?: boolean;
}) {
  const t = dict(locale).search;
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const endButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'start' | 'end'>('start');
  const [view, setView] = useState(monthStart(start));
  const [focusDate, setFocusDate] = useState(start);
  const [moveFocus, setMoveFocus] = useState(false);

  // Closes on a click outside the two segments and the panel.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  // Keyboard focus follows the active day after a move (roving tabindex).
  useEffect(() => {
    if (!open || !moveFocus) return;
    root.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDate}"]`)?.focus();
    setMoveFocus(false);
  }, [open, moveFocus, focusDate]);

  const show = (which: 'start' | 'end') => {
    const target = which === 'end' && !single ? end : start;
    setPhase(which);
    setView(monthStart(target));
    setFocusDate(target);
    setOpen(true);
    setMoveFocus(true);
  };
  const close = (to: 'start' | 'end' = phase) => {
    setOpen(false);
    (to === 'end' && !single ? endButton : startButton).current?.focus();
  };

  const pick = (d: string) => {
    if (single) {
      onChange(d, end);
      close('start');
      return;
    }
    if (phase === 'start' || nightsBetween(start, d) < minNights) {
      // A new stay begins here; the end moves along when it would no longer be after the start.
      onChange(d, nightsBetween(d, end) >= Math.max(minNights, 1) ? end : addDays(d, Math.max(minNights, 1)));
      setPhase('end');
      setFocusDate(d);
      return;
    }
    onChange(start, d);
    close('end');
  };

  const move = (to: string) => {
    const next = to < today ? today : to;
    setFocusDate(next);
    const first = monthStart(next);
    // Narrow forms show one month (the second table is hidden by a container query).
    const two = (root.current?.querySelectorAll<HTMLElement>('.cal-month')[1]?.offsetParent ?? null) !== null;
    const last = two ? addMonths(view, 1) : view;
    if (first < view) setView(first);
    else if (first > last) setView(two ? addMonths(first, -1) : first);
    setMoveFocus(true);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const steps: Record<string, () => string> = {
      ArrowLeft: () => addDays(focusDate, -1),
      ArrowRight: () => addDays(focusDate, 1),
      ArrowUp: () => addDays(focusDate, -7),
      ArrowDown: () => addDays(focusDate, 7),
      Home: () => addDays(focusDate, -weekday(focusDate)),
      End: () => addDays(focusDate, 6 - weekday(focusDate)),
      PageUp: () => addMonths(focusDate, -1),
      PageDown: () => addMonths(focusDate, 1),
    };
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (steps[e.key] && (e.target as HTMLElement).dataset.date) {
      e.preventDefault();
      move(steps[e.key]!());
    }
  };

  const short = (d: string) => `${Number(d.slice(8))} ${t.months[Number(d.slice(5, 7)) - 1]} ${t.weekdays[weekday(d)]}`;
  const long = (d: string) => `${Number(d.slice(8))} ${t.monthsLong[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)} ${t.weekdaysLong[weekday(d)]}`;
  const nights = nightsBetween(start, end);

  const month = (first: string) => {
    const lead = weekday(first);
    const days: Array<string | null> = Array.from({ length: lead }, () => null);
    for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) days.push(d);
    while (days.length % 7) days.push(null);
    const weeks = Array.from({ length: days.length / 7 }, (_, w) => days.slice(w * 7, w * 7 + 7));
    const title = `${t.monthsLong[Number(first.slice(5, 7)) - 1]} ${first.slice(0, 4)}`;
    return (
      <table className="cal-month" key={first}>
        <caption>{title}</caption>
        <thead>
          <tr>
            {t.weekdays.map((w, i) => (
              <th key={w} scope="col" abbr={t.weekdaysLong[i]}>
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, w) => (
            <tr key={w}>
              {week.map((d, i) => {
                if (!d) return <td key={i} />;
                const disabled = d < today;
                const isStart = d === start;
                const isEnd = !single && d === end;
                const inRange = !single && d > start && d < end;
                return (
                  <td key={d} className={`${inRange ? 'in-range' : ''}${isStart && !single ? ' range-start' : ''}${isEnd ? ' range-end' : ''}`.trim() || undefined}>
                    <button
                      type="button"
                      className="cal-day"
                      data-date={d}
                      tabIndex={d === focusDate ? 0 : -1}
                      disabled={disabled}
                      aria-label={long(d)}
                      aria-pressed={isStart || isEnd}
                      aria-current={d === today ? 'date' : undefined}
                      onClick={() => pick(d)}
                    >
                      {Number(d.slice(8))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const toggle = (which: 'start' | 'end', ref: React.RefObject<HTMLButtonElement | null>, label: string, value: string) => (
    <div className={`seg seg-date ${which === 'start' ? 'seg-in' : 'seg-out'}`}>
      <button
        ref={ref}
        type="button"
        className="seg-toggle"
        aria-haspopup="dialog"
        aria-expanded={open && (single || phase === which)}
        aria-controls={panelId}
        onClick={() => (open && (single || phase === which) ? setOpen(false) : show(which))}
      >
        <span className="seg-label">
          <CalendarDays />
          {label}
        </span>
        <span className="seg-value">{value}</span>
      </button>
    </div>
  );

  return (
    <div className="date-range" ref={root} onKeyDown={onKey}>
      {toggle('start', startButton, labels.start, short(start))}
      {!single && toggle('end', endButton, labels.end, short(end))}
      <div id={panelId} className="cal-panel" role="dialog" aria-label={t.calendar} hidden={!open}>
        <p className="cal-hint" aria-live="polite">
          {single ? labels.start : phase === 'start' ? t.pickCheckin : t.pickCheckout}
        </p>
        <div className="cal-nav">
          <button type="button" className="cal-step" aria-label={t.prevMonth} disabled={view <= monthStart(today)} onClick={() => setView(addMonths(view, -1))}>
            <ChevronLeft />
          </button>
          <button type="button" className="cal-step" aria-label={t.nextMonth} onClick={() => setView(addMonths(view, 1))}>
            <ChevronRight />
          </button>
        </div>
        <div className="cal-months">
          {month(view)}
          {month(addMonths(view, 1))}
        </div>
        <div className="cal-foot">
          <span className="cal-summary">{single ? short(start) : `${short(start)} – ${short(end)} · ${dict(locale).results.nights(nights)}`}</span>
          <button type="button" className="secondary small" onClick={() => close()}>
            {t.done}
          </button>
        </div>
      </div>
    </div>
  );
}
