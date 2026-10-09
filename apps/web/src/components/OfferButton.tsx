'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { dict, errorMessage, type Locale } from '../i18n/dictionaries';
import { api, ApiError } from './api';

/** Turns an offer key into a server-side quote; the client never sends a provider offer id or a price. */
export function OfferButton({ locale, sessionId, offerKey, label }: { locale: Locale; sessionId: string; offerKey: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="offer-action">
      <button
        type="button"
        className="primary"
        aria-label={label}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const q = await api<{ quoteVersionId: string }>('/api/v1/quotes', { method: 'POST', body: { sessionId, offerKey } });
            router.push(`/${locale}/checkout/${q.quoteVersionId}`);
          } catch (err) {
            setError(errorMessage(locale, err instanceof ApiError ? err.code : undefined));
            setBusy(false);
          }
        }}
      >
        {dict(locale).results.choose}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
