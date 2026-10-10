'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '../../i18n/dictionaries';

/**
 * Cookie consent and tag loading (ADR-0018). The choice is stored for 180 days in a first-party cookie (`th_consent`)
 * and sent to Google as a Consent Mode v2 update; GTM/GA4 load once a choice allows them (BASIC) or at once in the
 * denied state (ADVANCED). Accept and reject are equally prominent; preferences can be changed any time.
 */
export interface ConsentChoice {
  a: boolean;
  m: boolean;
}

const COOKIE = 'th_consent';
const MAX_AGE = 180 * 86_400;

function readChoice(): ConsentChoice | null {
  const m = document.cookie.match(/(?:^|; )th_consent=([^;]+)/);
  if (!m) return null;
  try {
    const c = JSON.parse(decodeURIComponent(m[1]!)) as { a?: unknown; m?: unknown };
    return { a: c.a === true || c.a === 1, m: c.m === true || c.m === 1 };
  } catch {
    return null;
  }
}

type Gtag = (...args: unknown[]) => void;
const w = () => window as unknown as { dataLayer: unknown[]; gtag?: Gtag; __thTagsLoaded?: boolean };

function applyChoice(c: ConsentChoice) {
  const g = (b: boolean) => (b ? 'granted' : 'denied');
  w().gtag?.('consent', 'update', { analytics_storage: g(c.a), ad_storage: g(c.m), ad_user_data: g(c.m), ad_personalization: g(c.m) });
  w().dataLayer.push({ event: 'consent_update', consent_analytics: c.a, consent_marketing: c.m });
}

function loadTags(gtm: string | null, ga4: string | null) {
  if (w().__thTagsLoaded) return;
  w().__thTagsLoaded = true;
  const add = (src: string) => {
    const s = document.createElement('script');
    s.async = true;
    s.src = src;
    document.head.appendChild(s);
  };
  if (gtm) {
    w().dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    add(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtm)}`);
  } else if (ga4) {
    add(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4)}`);
    w().gtag?.('js', new Date());
    w().gtag?.('config', ga4);
  }
}

const TEXT = {
  tr: {
    title: 'Çerez tercihleri',
    body: 'Sitemizin çalışması için gerekli çerezleri kullanırız. İzin verirseniz ziyaretleri ölçmek (analiz) ve reklamlarımızı ölçüp kişiselleştirmek (pazarlama) için de çerez kullanırız. Seçiminizi istediğiniz zaman değiştirebilirsiniz.',
    accept: 'Tümünü kabul et',
    reject: 'Reddet',
    settings: 'Tercihler',
    analytics: 'Analiz: ziyaretleri ölçme',
    marketing: 'Pazarlama: reklam ölçümü ve kişiselleştirme',
    necessary: 'Zorunlu çerezler her zaman açıktır.',
    save: 'Seçimi kaydet',
    policy: 'Çerez politikası',
    reopen: 'Çerez tercihleri',
  },
  en: {
    title: 'Cookie preferences',
    body: 'We use cookies the site needs to work. With your permission we also use cookies to measure visits (analytics) and to measure and personalise our ads (marketing). You can change your choice at any time.',
    accept: 'Accept all',
    reject: 'Reject',
    settings: 'Preferences',
    analytics: 'Analytics: measuring visits',
    marketing: 'Marketing: ad measurement and personalisation',
    necessary: 'Necessary cookies are always on.',
    save: 'Save choice',
    policy: 'Cookie policy',
    reopen: 'Cookie preferences',
  },
} as const;

export function ConsentManager({ locale, gtm, ga4, mode, bannerText, privacyUrl }: { locale: Locale; gtm: string | null; ga4: string | null; mode: 'BASIC' | 'ADVANCED'; bannerText: string | null; privacyUrl: string | null }) {
  const t = TEXT[locale];
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const [draft, setDraft] = useState<ConsentChoice>({ a: false, m: false });

  useEffect(() => {
    const stored = readChoice();
    if (stored) setDraft(stored);
    else setOpen(true);
    if (mode === 'ADVANCED' || (stored && (stored.a || stored.m))) loadTags(gtm, ga4);
    const reopen = () => {
      setDetails(true);
      setOpen(true);
    };
    window.addEventListener('th:consent:open', reopen);
    return () => window.removeEventListener('th:consent:open', reopen);
  }, [gtm, ga4, mode]);

  const save = useCallback(
    (c: ConsentChoice) => {
      const secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify({ a: c.a, m: c.m, v: 1, t: Date.now() }))}; Max-Age=${MAX_AGE}; Path=/; SameSite=Lax${secure}`;
      applyChoice(c);
      if (c.a || c.m) loadTags(gtm, ga4);
      setDraft(c);
      setOpen(false);
      setDetails(false);
    },
    [gtm, ga4],
  );

  if (!open) return null;
  return (
    <section className="consent" role="dialog" aria-modal="false" aria-labelledby="consent-title" data-testid="consent-banner">
      <h2 id="consent-title">{t.title}</h2>
      <p>
        {bannerText ?? t.body}{' '}
        {privacyUrl && (
          <a href={privacyUrl} target={privacyUrl.startsWith('https://') ? '_blank' : undefined} rel="noreferrer">
            {t.policy}
          </a>
        )}
      </p>
      {details && (
        <fieldset className="consent-options">
          <legend className="visually-hidden">{t.settings}</legend>
          <p className="small">{t.necessary}</p>
          <label>
            <input type="checkbox" checked={draft.a} onChange={(e) => setDraft({ ...draft, a: e.target.checked })} /> {t.analytics}
          </label>
          <label>
            <input type="checkbox" checked={draft.m} onChange={(e) => setDraft({ ...draft, m: e.target.checked })} /> {t.marketing}
          </label>
        </fieldset>
      )}
      <div className="consent-actions">
        <button type="button" className="consent-btn" onClick={() => save({ a: true, m: true })}>
          {t.accept}
        </button>
        <button type="button" className="consent-btn" onClick={() => save({ a: false, m: false })}>
          {t.reject}
        </button>
        {details ? (
          <button type="button" className="consent-btn secondary" onClick={() => save(draft)}>
            {t.save}
          </button>
        ) : (
          <button type="button" className="consent-btn secondary" onClick={() => setDetails(true)}>
            {t.settings}
          </button>
        )}
      </div>
    </section>
  );
}

/** Footer link that opens the banner again. */
export function ConsentReopen({ label }: { label: string }) {
  return (
    <button type="button" className="link consent-reopen" onClick={() => window.dispatchEvent(new Event('th:consent:open'))}>
      {label}
    </button>
  );
}
