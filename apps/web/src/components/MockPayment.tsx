'use client';

import { useState } from 'react';
import { dict, errorMessage, type Locale } from '../i18n/dictionaries';
import { api, ApiError } from './api';

/** MOCK environment only: stands in for the provider payment component and then follows its return URL. */
export function MockPayment({ locale, orderId, returnUrl }: { locale: Locale; orderId: string; returnUrl: string }) {
  const t = dict(locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="card mock">
      <h2>{t.payment.mockTitle}</h2>
      <button
        type="button"
        className="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api(`/api/v1/dev/mock-payments/${orderId}`, { method: 'POST' });
            window.location.assign(returnUrl);
          } catch (err) {
            setError(errorMessage(locale, err instanceof ApiError ? err.code : undefined));
            setBusy(false);
          }
        }}
      >
        {t.payment.mockPay}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
