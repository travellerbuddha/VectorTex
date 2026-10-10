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

const ECOMMERCE = new Set(['view_item_list', 'select_item', 'view_item', 'begin_checkout', 'add_payment_info', 'purchase', 'refund']);

export function pushEvent(event: string, params: Record<string, unknown>, once?: string) {
  if (typeof window === 'undefined') return;
  const store = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  if (once && store?.getItem(`th_evt_${once}`)) return;
  const w = window as unknown as { dataLayer?: unknown[] };
  w.dataLayer = w.dataLayer ?? [];
  if (ECOMMERCE.has(event)) {
    // GA4 recommendation: clear the previous e-commerce object first.
    w.dataLayer.push({ ecommerce: null });
    w.dataLayer.push({ event, ecommerce: params });
  } else {
    w.dataLayer.push({ event, ...params });
  }
  if (once) store?.setItem(`th_evt_${once}`, '1');
}

export function TrackEvent({ event, params, once }: { event: string; params: Record<string, unknown>; once?: string }) {
  useEffect(() => {
    pushEvent(event, params, once);
    // One push per page view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
