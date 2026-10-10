'use client';

import { useEffect, useRef, useState } from 'react';
import { FieldLabel, useField } from '@payloadcms/ui';
import type { TextFieldClientComponent } from 'payload';

interface Suggestion {
  placeId: string;
  name: string;
  address: string;
}

/**
 * Place field of a hotel list (ADR-0014): the editor types a place, picks one of the site's own suggestions (with its
 * address, so "Rome, USA" and "Roma, Italy" are told apart) and the place id, name and address are filled in.
 */
export const PlacePicker: TextFieldClientComponent = ({ path, field }) => {
  const { value, setValue } = useField<string>({ path });
  const base = path.replace(/placeId$/, '');
  const name = useField<string>({ path: `${base}name` });
  const address = useField<string>({ path: `${base}address` });
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/places?q=${encodeURIComponent(query.trim())}&lang=tr`, { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { data: Suggestion[] };
        setSuggestions(body.data.slice(0, 8));
        setError(null);
      } catch {
        setError('Öneriler alınamadı; biraz sonra yeniden deneyin.');
      }
    }, 300);
  }, [query]);

  const choose = (s: Suggestion) => {
    setValue(s.placeId);
    name.setValue(s.name);
    address.setValue(s.address);
    setQuery('');
    setSuggestions([]);
  };

  return (
    <div className="field-type text" style={{ marginBottom: 16 }}>
      <FieldLabel label={field?.label ?? 'Yer'} path={path} required />
      {value ? (
        <p data-testid="place-picked">
          <strong>{name.value || value}</strong>
          {address.value ? ` — ${address.value}` : ''} <code style={{ opacity: 0.7 }}>{value}</code>
        </p>
      ) : (
        <p style={{ opacity: 0.7 }}>Henüz yer seçilmedi.</p>
      )}
      <input
        type="text"
        aria-label="Yer ara"
        placeholder="Yer ara: ör. Antalya, Belek, Roma"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: '100%', padding: 8 }}
      />
      {error && <p role="alert">{error}</p>}
      {suggestions.length > 0 && (
        <ul role="listbox" aria-label="Yer önerileri" style={{ listStyle: 'none', padding: 0, margin: '4px 0', border: '1px solid var(--theme-elevation-150)' }}>
          {suggestions.map((s) => (
            <li key={s.placeId}>
              <button type="button" role="option" aria-selected={false} onClick={() => choose(s)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: 8, background: 'none', border: 0, cursor: 'pointer' }}>
                <strong>{s.name}</strong> {s.address ? <span style={{ opacity: 0.75 }}>— {s.address}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
