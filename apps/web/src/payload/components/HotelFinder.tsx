'use client';

import { useEffect, useRef, useState } from 'react';
import { useField } from '@payloadcms/ui';
import type { UIFieldClientComponent } from 'payload';

interface Match {
  hotelId: string;
  name: string;
  city: string | null;
  countryCode: string | null;
  address: string | null;
  stars: number | null;
}

/** Countries editors list most; any ISO-2 code can be typed. */
const COUNTRIES: ReadonlyArray<[string, string]> = [
  ['TR', 'Türkiye'],
  ['EG', 'Mısır'],
  ['IT', 'İtalya'],
  ['GR', 'Yunanistan'],
  ['CY', 'Kıbrıs'],
  ['AE', 'BAE'],
  ['ES', 'İspanya'],
  ['FR', 'Fransa'],
  ['TH', 'Tayland'],
  ['VN', 'Vietnam'],
  ['MV', 'Maldivler'],
];

type Target = 'include' | 'pinned' | 'exclude';
const ACTIONS: ReadonlyArray<[Target, string]> = [
  ['include', 'Ekle'],
  ['pinned', 'Başa sabitle'],
  ['exclude', 'Çıkar'],
];
const LIMITS: Record<Target, number> = { include: 200, pinned: 50, exclude: 500 };

/**
 * Hotel finder of a hotel list (ADR-0014): the editor types part of a hotel's name in one country (the provider needs
 * a country for a name search) and adds the hotel's code to "add", "pin" or "remove" with one click, instead of copying
 * codes from hotel page addresses. Each search is a provider call: it waits for a pause in typing.
 */
export const HotelFinder: UIFieldClientComponent = () => {
  const fields = {
    include: useField<string[]>({ path: 'include' }),
    pinned: useField<string[]>({ path: 'pinned' }),
    exclude: useField<string[]>({ path: 'exclude' }),
  };
  const [country, setCountry] = useState('TR');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    const cc = country.trim().toUpperCase();
    if (q.length < 2 || !/^[A-Z]{2}$/.test(cc)) {
      setMatches(null);
      return;
    }
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;
      setBusy(true);
      try {
        const res = await fetch(`/api/v1/staff/hotel-names?q=${encodeURIComponent(q)}&country=${cc}&lang=tr`, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
        if (mine !== seq.current) return;
        if (res.status === 429) throw new Error('Çok sık arama yapıldı; bir dakika sonra yeniden deneyin.');
        if (res.status === 403) throw new Error('Bu arama için içerik düzenleme yetkisi gerekir.');
        if (!res.ok) throw new Error('Oteller alınamadı; biraz sonra yeniden deneyin.');
        const body = (await res.json()) as { data: Match[] };
        setMatches(body.data);
        setError(null);
      } catch (e) {
        if (mine === seq.current) setError(e instanceof Error ? e.message : 'Oteller alınamadı.');
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 500);
  }, [query, country]);

  const where = (code: string): Target | null => (['pinned', 'include', 'exclude'] as const).find((t) => (fields[t].value ?? []).includes(code)) ?? null;

  const put = (target: Target, code: string) => {
    // A code lives in one place only: moving it to "remove" takes it out of "add" and "pin", and the other way round.
    for (const t of ['include', 'pinned', 'exclude'] as const) {
      const list = fields[t].value ?? [];
      if (t !== target && list.includes(code)) fields[t].setValue(list.filter((c) => c !== code));
    }
    const list = fields[target].value ?? [];
    if (list.includes(code)) return;
    if (list.length >= LIMITS[target]) {
      setError(`Bu alana en çok ${LIMITS[target]} kod girilebilir.`);
      return;
    }
    fields[target].setValue([...list, code]);
  };

  const label: Record<Target, string> = { include: 'eklendi', pinned: 'başa sabitlendi', exclude: 'çıkarıldı' };

  return (
    <div className="field-type" style={{ marginBottom: 24 }} data-testid="hotel-finder">
      <p style={{ fontWeight: 600, marginBottom: 4 }}>Otel adıyla bul</p>
      <p style={{ opacity: 0.75, marginTop: 0 }}>Ülkeyi seçin, otel adının bir kısmını yazın; çıkan otelin kodunu tek tıkla aşağıdaki alanlara ekleyin.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          aria-label="Ülke kodu"
          list="hotel-finder-countries"
          value={country}
          maxLength={2}
          onChange={(e) => setCountry(e.target.value.toUpperCase())}
          style={{ width: 80, padding: 8 }}
        />
        <datalist id="hotel-finder-countries">
          {COUNTRIES.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </datalist>
        <input
          type="text"
          aria-label="Otel adı"
          placeholder="Otel adı: ör. Swandor, Rixos"
          value={query}
          maxLength={80}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: 8 }}
        />
      </div>
      {busy && <p aria-live="polite">Aranıyor…</p>}
      {error && <p role="alert">{error}</p>}
      {matches && matches.length === 0 && !busy && <p>Bu ülkede bu adla otel bulunamadı.</p>}
      {matches && matches.length > 0 && (
        <table style={{ width: '100%', marginTop: 8, borderCollapse: 'collapse' }} aria-label="Bulunan oteller">
          <tbody>
            {matches.map((m) => {
              const at = where(m.hotelId);
              return (
                <tr key={m.hotelId} style={{ borderTop: '1px solid var(--theme-elevation-150)' }}>
                  <td style={{ padding: 6 }}>
                    <strong>{m.name}</strong>
                    {m.stars ? ` ${'★'.repeat(Math.round(m.stars))}` : ''}
                    <br />
                    <span style={{ opacity: 0.75 }}>{[m.address, m.city, m.countryCode?.toUpperCase()].filter(Boolean).join(', ')}</span>
                  </td>
                  <td style={{ padding: 6 }}>
                    <code>{m.hotelId}</code>
                  </td>
                  <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                    {at ? <span style={{ marginRight: 8 }}>✓ {label[at]}</span> : null}
                    {ACTIONS.filter(([t]) => t !== at).map(([t, text]) => (
                      <button key={t} type="button" className="btn btn--style-secondary btn--size-small" style={{ margin: '0 4px 0 0' }} onClick={() => put(t, m.hotelId)} aria-label={`${m.name}: ${text}`}>
                        {text}
                      </button>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};
