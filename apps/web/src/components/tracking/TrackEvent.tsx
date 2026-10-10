'use client';

import { useEffect } from 'react';

/**
 * Pushes one GA4 e-commerce event to the dataLayer when the page shows (ADR-0018). No personal data: hotel ids, names,
 * prices and dates only. `once` keeps an event (e.g. a purchase) from being sent twice from this browser.
 */
export interface AnalyticsItem {
  item_id: string;
  item_name: string;
  item_category: string;
  item_variant?: string;
  item_list_id?: string;
  index?: number;
  price?: number;
  quantity?: number;
}

/** GA4 e-commerce events the site pushes (the GTM container in docs/olcum listens for the same names). */
export const ECOMMERCE_EVENTS = ['view_item_list', 'select_item', 'view_item', 'begin_checkout', 'add_payment_info', 'purchase', 'refund'] as const;
/** Other events the site pushes. */
export const OTHER_EVENTS = ['search'] as const;
const ECOMMERCE = new Set<string>(ECOMMERCE_EVENTS);

/** True when the visitor allowed analytics or marketing (stored choice). */
function consented(): boolean {
  const m = document.cookie.match(/(?:^|; )th_consent=([^;]+)/);
  if (!m) return false;
  try {
    const c = JSON.parse(decodeURIComponent(m[1]!)) as { a?: unknown; m?: unknown };
    return c.a === true || c.m === true;
  } catch {
    return false;
  }
}

export function pushEvent(event: string, params: Record<string, unknown>, once?: string) {
  if (typeof window === 'undefined') return;
  const store = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  // The "sent once" marker is browser storage for measurement: kept only with consent (cookie policy).
  const remember = Boolean(once) && consented();
  if (once && remember && store?.getItem(`th_evt_${once}`)) return;
  const w = window as unknown as { dataLayer?: unknown[] };
  w.dataLayer = w.dataLayer ?? [];
  if (ECOMMERCE.has(event)) {
    // GA4 recommendation: clear the previous e-commerce object first.
    w.dataLayer.push({ ecommerce: null });
    w.dataLayer.push({ event, ecommerce: params });
  } else {
    w.dataLayer.push({ event, ...params });
  }
  if (once && remember) store?.setItem(`th_evt_${once}`, '1');
}

export function TrackEvent({ event, params, once }: { event: string; params: Record<string, unknown>; once?: string }) {
  useEffect(() => {
    pushEvent(event, params, once);
    // One push per page view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
