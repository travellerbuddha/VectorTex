import { cache } from 'react';
import type { Locale } from '../i18n/dictionaries';
import { cms, cmsEnabled } from './cms';
import { errorMessage, log } from './log';

/** Tracking settings of the site (ADR-0018), read once per request; null = nothing to load. */
export interface Tracking {
  gtm: string | null;
  ga4: string | null;
  mode: 'BASIC' | 'ADVANCED';
  verification: string | null;
  yandexVerification: string | null;
  metaDomainVerification: string | null;
  bannerText: string | null;
  privacyUrl: string | null;
}

const ok = (v: unknown, re: RegExp) => (typeof v === 'string' && re.test(v) ? v : null);

export const trackingSettings = cache(async (locale: Locale): Promise<Tracking | null> => {
  if (!cmsEnabled()) return null;
  try {
    const payload = await cms();
    const g = (await payload.findGlobal({ slug: 'tracking-settings', locale, depth: 0, overrideAccess: false })) as Record<string, unknown>;
    const t: Tracking = {
      gtm: ok(g.gtmContainerId, /^GTM-[A-Z0-9]{4,12}$/),
      // GA4 is loaded from GTM when GTM is set (one source of truth).
      ga4: g.gtmContainerId ? null : ok(g.ga4MeasurementId, /^G-[A-Z0-9]{4,15}$/),
      mode: g.consentMode === 'ADVANCED' ? 'ADVANCED' : 'BASIC',
      verification: ok(g.searchConsoleVerification, /^[A-Za-z0-9_-]{10,100}$/),
      yandexVerification: ok(g.yandexVerification, /^[A-Za-z0-9_-]{8,100}$/),
      metaDomainVerification: ok(g.metaDomainVerification, /^[A-Za-z0-9_-]{8,100}$/),
      bannerText: typeof g.bannerText === 'string' && g.bannerText.trim() ? g.bannerText.trim() : null,
      privacyUrl: ok(g.privacyUrl, /^\/[a-z0-9/_-]*$|^https:\/\/[^\s"'<>]+$/i),
    };
    return t;
  } catch (err) {
    // The site keeps working without tracking (e.g. CMS migrations not applied yet).
    log.error('tracking settings unavailable', { error: errorMessage(err) });
    return null;
  }
});

/**
 * Consent Mode v2 defaults, run before any tag: every Google purpose denied, then the visitor's stored choice applied
 * and announced as a `consent_state` event (the GTM container fires analytics and marketing tags on it; a new choice
 * is announced as `consent_update`). Ads data redaction stays on while ad storage is denied.
 */
export const CONSENT_BOOTSTRAP = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',functionality_storage:'granted',security_storage:'granted',wait_for_update:500});
gtag('set','ads_data_redaction',true);gtag('set','url_passthrough',true);
(function(){var m=document.cookie.match(/(?:^|; )th_consent=([^;]+)/);if(!m)return;try{var c=JSON.parse(decodeURIComponent(m[1]));var g=function(b){return b?'granted':'denied'};
gtag('consent','update',{analytics_storage:g(c.a),ad_storage:g(c.m),ad_user_data:g(c.m),ad_personalization:g(c.m)});
dataLayer.push({event:'consent_state',consent_analytics:!!c.a,consent_marketing:!!c.m});}catch(e){}})();`;
