'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { dict, errorMessage, type Locale } from '../i18n/dictionaries';
import { api, ApiError, newIdempotencyKey } from './api';

type PassengerType = 'ADULT' | 'CHILD' | 'INFANT';
interface Passenger {
  type: PassengerType;
  firstName: string;
  lastName: string;
  birthDate: string;
  gender: '' | 'F' | 'M';
  nationality: string;
  document: { type: 'passport' | 'id_card'; number: string; issuingCountry: string; expiresOn: string };
}

/**
 * Contact and passengers as on their travel documents. The document is asked on every flight (ADR-0012); it goes to
 * the server once, which hands it to the provider and does not store it.
 */
export function FlightCheckoutForm({
  locale,
  quoteVersionId,
  termsVersion,
  passengers: party,
  countries,
}: {
  locale: Locale;
  quoteVersionId: string;
  termsVersion: string;
  passengers: { adults: number; children: number; infants: number };
  countries: ReadonlyArray<{ code: string; name: string }>;
}) {
  const t = dict(locale);
  const f = t.flight;
  const router = useRouter();
  // One key per page view: a double click or a retried request cannot create a second order.
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);
  const defaultCountry = locale === 'tr' ? 'TR' : 'GB';
  const blank = (type: PassengerType): Passenger => ({
    type,
    firstName: '',
    lastName: '',
    birthDate: '',
    gender: '',
    nationality: defaultCountry,
    document: { type: 'passport', number: '', issuingCountry: defaultCountry, expiresOn: '' },
  });
  const [contact, setContact] = useState({ firstName: '', lastName: '', email: '', phoneCountryCode: locale === 'tr' ? '90' : '44', phoneNumber: '' });
  const [pax, setPax] = useState<Passenger[]>([
    ...Array.from({ length: party.adults }, () => blank('ADULT')),
    ...Array.from({ length: party.children }, () => blank('CHILD')),
    ...Array.from({ length: party.infants }, () => blank('INFANT')),
  ]);
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const update = (i: number, next: Partial<Passenger>) => setPax(pax.map((p, j) => (i === j ? { ...p, ...next } : p)));
  const updateDoc = (i: number, next: Partial<Passenger['document']>) => setPax(pax.map((p, j) => (i === j ? { ...p, document: { ...p.document, ...next } } : p)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);
    try {
      const r = await api<{ orderId: string }>('/api/v1/flight-checkout-sessions', {
        method: 'POST',
        body: {
          quoteVersionId,
          acceptTerms: accept,
          termsVersion,
          contact: { ...contact, phoneCountryCode: contact.phoneCountryCode.replace(/\D/g, ''), phoneNumber: contact.phoneNumber.replace(/\D/g, '') },
          passengers: pax,
          locale,
          idempotencyKey,
        },
      });
      // Seats and bags first when the provider offers them (the page goes on to payment otherwise).
      router.push(`/${locale}/orders/${r.orderId}/extras`);
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
        setError(errorMessage(locale, err.code));
      } else setError(errorMessage(locale, undefined));
      setBusy(false);
    }
  }

  const errorOf = (path: string) =>
    fieldErrors[path] ? (
      <small id={`${path}-err`} className="error">
        {fieldErrors[path]}
      </small>
    ) : null;
  const a11y = (path: string) => ({ 'aria-invalid': fieldErrors[path] ? true : undefined, 'aria-describedby': fieldErrors[path] ? `${path}-err` : undefined });

  const input = (path: string, label: string, value: string, onChange: (v: string) => void, type = 'text', autoComplete?: string) => (
    <div className="field">
      <label htmlFor={path}>{label}</label>
      <input id={path} name={path} type={type} value={value} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} {...a11y(path)} required />
      {errorOf(path)}
    </div>
  );
  const select = (path: string, label: string, value: string, options: ReadonlyArray<{ value: string; label: string }>, onChange: (v: string) => void) => (
    <div className="field">
      <label htmlFor={path}>{label}</label>
      <select id={path} name={path} value={value} onChange={(e) => onChange(e.target.value)} {...a11y(path)} required>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {errorOf(path)}
    </div>
  );
  const countryOptions = countries.map((c) => ({ value: c.code, label: c.name }));

  return (
    <form className="card" onSubmit={submit} noValidate>
      <fieldset>
        <legend>{f.contact}</legend>
        <p className="muted">{f.contactHint}</p>
        <div className="row">
          {input('contact.firstName', t.checkout.firstName, contact.firstName, (v) => setContact({ ...contact, firstName: v }), 'text', 'given-name')}
          {input('contact.lastName', t.checkout.lastName, contact.lastName, (v) => setContact({ ...contact, lastName: v }), 'text', 'family-name')}
        </div>
        <div className="row">
          {input('contact.email', t.checkout.email, contact.email, (v) => setContact({ ...contact, email: v }), 'email', 'email')}
        </div>
        <div className="row">
          <div className="field small">
            <label htmlFor="contact.phoneCountryCode">{f.phoneCode}</label>
            <input id="contact.phoneCountryCode" inputMode="numeric" value={`+${contact.phoneCountryCode}`} onChange={(e) => setContact({ ...contact, phoneCountryCode: e.target.value.replace(/\D/g, '') })} autoComplete="tel-country-code" {...a11y('contact.phoneCountryCode')} required />
            {errorOf('contact.phoneCountryCode')}
          </div>
          {input('contact.phoneNumber', f.phoneNumber, contact.phoneNumber, (v) => setContact({ ...contact, phoneNumber: v }), 'tel', 'tel-national')}
        </div>
      </fieldset>
      {errorOf('passengers')}
      {pax.map((p, i) => (
        <fieldset key={i}>
          <legend>{f.passengerTitle(i + 1, f.types[p.type] ?? p.type)}</legend>
          <p className="muted">{f.nameHint}</p>
          <div className="row">
            {input(`passengers.${i}.firstName`, t.checkout.firstName, p.firstName, (v) => update(i, { firstName: v }))}
            {input(`passengers.${i}.lastName`, t.checkout.lastName, p.lastName, (v) => update(i, { lastName: v }))}
          </div>
          <div className="row">
            {input(`passengers.${i}.birthDate`, f.birthDate, p.birthDate, (v) => update(i, { birthDate: v }), 'date')}
            {select(`passengers.${i}.gender`, f.gender, p.gender, [{ value: '', label: '—' }, { value: 'F', label: f.genders.F! }, { value: 'M', label: f.genders.M! }], (v) => update(i, { gender: v as Passenger['gender'] }))}
            {select(`passengers.${i}.nationality`, f.nationality, p.nationality, countryOptions, (v) => update(i, { nationality: v }))}
          </div>
          <div className="row">
            {select(
              `passengers.${i}.document.type`,
              f.documentType,
              p.document.type,
              [
                { value: 'passport', label: f.documentTypes.passport! },
                { value: 'id_card', label: f.documentTypes.id_card! },
              ],
              (v) => updateDoc(i, { type: v as Passenger['document']['type'] }),
            )}
            {input(`passengers.${i}.document.number`, f.documentNumber, p.document.number, (v) => updateDoc(i, { number: v }))}
          </div>
          <div className="row">
            {select(`passengers.${i}.document.issuingCountry`, f.issuingCountry, p.document.issuingCountry, countryOptions, (v) => updateDoc(i, { issuingCountry: v }))}
            {input(`passengers.${i}.document.expiresOn`, f.expiresOn, p.document.expiresOn, (v) => updateDoc(i, { expiresOn: v }), 'date')}
          </div>
        </fieldset>
      ))}
      <p className="muted">{f.documentNote}</p>
      <label className="check terms">
        <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} required /> {f.terms(termsVersion)}{' '}
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
