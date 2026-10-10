'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FlightServicesOfferView } from '@texholiday/booking';
import { dict, errorMessage, type Locale } from '../i18n/dictionaries';
import { formatMoney } from '../i18n/format';
import { api, ApiError } from './api';

type Outcome = 'ATTACHED' | 'REJECTED' | 'PRICE_CHANGED' | 'FAILED';

/**
 * One seat and one extra bag per passenger and flight, from the provider's live offer. The total shown is what the
 * customer accepts; the server adds the extras only if the provider charges exactly that (ADR-0013).
 */
export function FlightExtrasForm({ locale, offer }: { locale: Locale; offer: FlightServicesOfferView }) {
  const t = dict(locale);
  const f = t.flight;
  const router = useRouter();
  // `${segment}|${passenger}|SEAT|BAG` -> offer key
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prices = new Map<string, bigint>();
  for (const s of offer.segments) for (const x of [...s.seats, ...s.bags]) prices.set(x.key, BigInt(x.price.minor));
  const keys = Object.values(picked).filter(Boolean);
  const total = keys.reduce((acc, k) => acc + (prices.get(k) ?? 0n), BigInt(offer.current.minor));
  const allowed = (forType: string, type: string) => forType === 'ALL' || forType === type;
  const takenBy = (key: string, slot: string) => Object.entries(picked).some(([s, k]) => k === key && s !== slot);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (keys.length === 0) {
      setError(f.extrasNone);
      return;
    }
    setBusy(true);
    try {
      const selections = Object.entries(picked)
        .filter(([, k]) => k)
        .map(([slot, key]) => ({ passengerIndex: Number(slot.split('|')[1]), key }));
      const r = await api<{ outcome: Outcome }>(`/api/v1/orders/${offer.orderId}/services`, { method: 'POST', body: { selections, expectedTotal: { currency: offer.currency, minor: total.toString() } } });
      if (r.outcome === 'ATTACHED') {
        router.push(`/${locale}/orders/${offer.orderId}/payment`);
        return;
      }
      if (r.outcome === 'REJECTED') {
        setError(f.extrasRejected);
        router.refresh();
      } else {
        setError(r.outcome === 'PRICE_CHANGED' ? f.extrasPriceChanged : f.extrasFailed);
        router.push(`/${locale}/orders/${offer.orderId}`);
        return;
      }
    } catch (err) {
      setError(errorMessage(locale, err instanceof ApiError ? err.code : undefined));
    }
    setBusy(false);
  }

  return (
    <form className="card" onSubmit={submit} noValidate>
      {offer.segments.map((seg, si) => (
        <fieldset key={si}>
          <legend>{seg.label}</legend>
          {offer.passengers.map((p) => {
            const seatSlot = `${si}|${p.index}|SEAT`;
            const bagSlot = `${si}|${p.index}|BAG`;
            const seats = p.type === 'INFANT' ? [] : seg.seats.filter((x) => allowed(x.forType, p.type));
            const bags = seg.bags.filter((x) => allowed(x.forType, p.type));
            if (seats.length === 0 && bags.length === 0) return null;
            return (
              <div className="row" key={p.index}>
                {seats.length > 0 && (
                  <div className="field">
                    <label htmlFor={`seat-${si}-${p.index}`}>
                      {f.extrasSeat} – {f.extrasFor(p.name)}
                    </label>
                    <select id={`seat-${si}-${p.index}`} value={picked[seatSlot] ?? ''} onChange={(e) => setPicked({ ...picked, [seatSlot]: e.target.value })}>
                      <option value="">{f.extrasNoSeat}</option>
                      {seats.map((x) => (
                        <option key={x.key} value={x.key} disabled={!x.available || takenBy(x.key, seatSlot)}>
                          {[x.number, x.type ? f.seatTypes[x.type] : null, formatMoney(x.price, locale), !x.available ? f.extrasTaken : null].filter(Boolean).join(' · ')}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {bags.length > 0 && (
                  <div className="field">
                    <label htmlFor={`bag-${si}-${p.index}`}>
                      {f.extrasBag} – {f.extrasFor(p.name)}
                    </label>
                    <select id={`bag-${si}-${p.index}`} value={picked[bagSlot] ?? ''} onChange={(e) => setPicked({ ...picked, [bagSlot]: e.target.value })}>
                      <option value="">{f.extrasNoBag}</option>
                      {bags.map((x) => (
                        <option key={x.key} value={x.key}>
                          {[x.name, formatMoney(x.price, locale)].join(' · ')}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>
      ))}
      <p className="total">
        <span>{f.extrasNewTotal}</span> <strong data-testid="extras-total">{formatMoney({ currency: offer.currency, minor: total.toString() }, locale)}</strong>
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy || keys.length === 0}>
          {busy ? f.extrasWorking : f.extrasAdd}
        </button>
        <a className="secondary" href={`/${locale}/orders/${offer.orderId}/payment`}>
          {f.extrasSkip}
        </a>
      </div>
    </form>
  );
}
