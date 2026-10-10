'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { dict, errorMessage, type Locale } from '../i18n/dictionaries';
import { api, ApiError, newIdempotencyKey } from './api';

interface Guest {
  firstName: string;
  lastName: string;
}

export function CheckoutForm({ locale, quoteVersionId, termsVersion, roomNumbers }: { locale: Locale; quoteVersionId: string; termsVersion: string; roomNumbers: number[] }) {
  const t = dict(locale);
  const router = useRouter();
  // One key per page view: a double click or a retried request cannot create a second order.
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);
  const [holder, setHolder] = useState({ firstName: '', lastName: '', email: '', phone: '+90' });
  const [guests, setGuests] = useState<Record<number, Guest>>({});
  const [same, setSame] = useState(true);
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const guestOf = (n: number, i: number): Guest => (same && i === 0 ? { firstName: holder.firstName, lastName: holder.lastName } : (guests[n] ?? { firstName: '', lastName: '' }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);
    try {
      const r = await api<{ orderId: string }>('/api/v1/checkout-sessions', {
        method: 'POST',
        body: {
          quoteVersionId,
          acceptTerms: accept,
          termsVersion,
          holder: { ...holder, phone: holder.phone.replace(/[\s()-]/g, '') },
          roomGuests: roomNumbers.map((n, i) => ({ occupancyNumber: n, ...guestOf(n, i) })),
          locale,
          idempotencyKey,
        },
      });
      router.push(`/${locale}/orders/${r.orderId}/payment`);
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
        setError(errorMessage(locale, err.code));
      } else setError(errorMessage(locale, undefined));
      setBusy(false);
    }
  }

  const input = (path: string, label: string, value: string, onChange: (v: string) => void, type = 'text', autoComplete?: string) => (
    <div className="field">
      <label htmlFor={path}>{label}</label>
      <input id={path} name={path} type={type} value={value} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} aria-invalid={fieldErrors[path] ? true : undefined} aria-describedby={fieldErrors[path] ? `${path}-err` : undefined} required />
      {fieldErrors[path] && (
        <small id={`${path}-err`} className="error">
          {fieldErrors[path]}
        </small>
      )}
    </div>
  );

  return (
    <form className="card" onSubmit={submit} noValidate>
      <fieldset>
        <legend>{t.checkout.holder}</legend>
        <div className="row">
          {input('holder.firstName', t.checkout.firstName, holder.firstName, (v) => setHolder({ ...holder, firstName: v }), 'text', 'given-name')}
          {input('holder.lastName', t.checkout.lastName, holder.lastName, (v) => setHolder({ ...holder, lastName: v }), 'text', 'family-name')}
        </div>
        <div className="row">
          {input('holder.email', t.checkout.email, holder.email, (v) => setHolder({ ...holder, email: v }), 'email', 'email')}
          {input('holder.phone', t.checkout.phone, holder.phone, (v) => setHolder({ ...holder, phone: v }), 'tel', 'tel')}
        </div>
      </fieldset>
      {roomNumbers.map((n, i) => (
        <fieldset key={n}>
          <legend>{t.checkout.roomGuest(n)}</legend>
          {i === 0 && (
            <label className="check">
              <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} /> {t.checkout.sameAsHolder}
            </label>
          )}
          {!(same && i === 0) && (
            <div className="row">
              {input(`roomGuests.${i}.firstName`, t.checkout.firstName, guestOf(n, i).firstName, (v) => setGuests({ ...guests, [n]: { ...guestOf(n, i), firstName: v } }))}
              {input(`roomGuests.${i}.lastName`, t.checkout.lastName, guestOf(n, i).lastName, (v) => setGuests({ ...guests, [n]: { ...guestOf(n, i), lastName: v } }))}
            </div>
          )}
        </fieldset>
      ))}
      <label className="check terms">
        <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} required /> {t.checkout.terms(termsVersion)}{' '}
        <a href={`/${locale}/terms`} target="_blank" rel="noopener">
          {t.checkout.termsLink}
        </a>
      </label>
      <p className="muted">{t.checkout.paymentBy}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="primary" disabled={busy || !accept}>
        {busy ? t.checkout.working : t.checkout.pay}
      </button>
    </form>
  );
}
