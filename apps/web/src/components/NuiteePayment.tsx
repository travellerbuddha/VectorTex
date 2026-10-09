'use client';

import { useEffect, useRef, useState } from 'react';
import { dict, type Locale } from '../i18n/dictionaries';

declare global {
  interface Window {
    LiteAPIPayment?: new (config: Record<string, unknown>) => { handlePayment(): void };
  }
}

const SDK_URL = 'https://payment-wrapper.liteapi.travel/dist/liteAPIPayment.js?v=a1';

/**
 * Nuitee payment component (user-payment guide): publicKey 'live' | 'sandbox' must match the API key environment,
 * secretKey is the prebook's secret, returnUrl is where the provider sends the customer after paying.
 */
export function NuiteePayment({ locale, publicKey, secretKey, returnUrl }: { locale: Locale; publicKey: 'live' | 'sandbox'; secretKey: string; returnUrl: string }) {
  const t = dict(locale);
  const started = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const start = () => {
      if (!window.LiteAPIPayment) {
        setFailed(true);
        return;
      }
      new window.LiteAPIPayment({
        publicKey,
        appearance: { theme: 'flat' },
        options: { business: { name: 'TexHoliday' } },
        targetElement: '#nuitee-payment',
        secretKey,
        returnUrl,
      }).handlePayment();
    };
    if (window.LiteAPIPayment) return start();
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = start;
    script.onerror = () => setFailed(true);
    document.head.appendChild(script);
  }, [publicKey, secretKey, returnUrl]);

  return (
    <div>
      <div id="nuitee-payment" className="payment-target" aria-live="polite" />
      {failed && (
        <p className="error" role="alert">
          {t.payment.sdkFailed}
        </p>
      )}
    </div>
  );
}
