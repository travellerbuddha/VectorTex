'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Check, ChevronDown, Globe } from 'lucide-react';
import { onCurrencyChange, saveCurrency, savedCurrency } from '../currency-pref';

/**
 * Header control: one button ("TR · EUR") that opens a panel to pick the site language and the sale currency together.
 * Currency names come from the server (Node's Intl), so both sides render the same text.
 */
export function LocaleCurrency({
  locale,
  label,
  languageLabel,
  currencyLabel,
  languages,
  currencies,
}: {
  locale: string;
  label: string;
  languageLabel: string;
  currencyLabel: string;
  languages: ReadonlyArray<{ code: string; name: string; href: string }>;
  currencies: ReadonlyArray<{ code: string; name: string }>;
}) {
  const codes = currencies.map((c) => c.code);
  const fallback = codes[0] ?? 'EUR';
  const currency = useSyncExternalStore(
    onCurrencyChange,
    () => savedCurrency(codes) ?? fallback,
    () => fallback,
  );
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const current = languages.find((l) => l.code === locale);

  return (
    <div className="locale-currency" ref={root}>
      <button
        ref={button}
        type="button"
        className="lang"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${label}: ${current?.name ?? locale}, ${currency}`}
        onClick={() => setOpen(!open)}
      >
        <Globe />
        <span>
          {locale.toUpperCase()} · {currency}
        </span>
        <ChevronDown className="lang-chevron" />
      </button>
      <div
        id={panelId}
        className="lang-panel"
        role="dialog"
        aria-label={label}
        hidden={!open}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
      >
        <p className="lang-group-label" id={`${panelId}-lang`}>
          {languageLabel}
        </p>
        <ul className="lang-options" aria-labelledby={`${panelId}-lang`}>
          {languages.map((l) => (
            <li key={l.code}>
              <a href={l.href} hrefLang={l.code} lang={l.code} aria-current={l.code === locale ? 'true' : undefined}>
                {l.name}
                {l.code === locale && <Check />}
              </a>
            </li>
          ))}
        </ul>
        {currencies.length > 0 && (
        <fieldset className="lang-currencies">
          <legend className="lang-group-label">{currencyLabel}</legend>
          {currencies.map((c) => (
            // A pointer pick closes the panel; arrow keys only move the choice (Escape closes).
            <label key={c.code} className="lang-option" onPointerUp={close}>
              <input
                type="radio"
                name={`${panelId}-currency`}
                value={c.code}
                checked={c.code === currency}
                onChange={() => saveCurrency(c.code)}
              />
              <strong>{c.code}</strong>
              <span>{c.name}</span>
              {c.code === currency && <Check />}
            </label>
          ))}
        </fieldset>
        )}
      </div>
    </div>
  );
}
