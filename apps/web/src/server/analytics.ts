import type { FlightQuoteView, HotelResultView, ListedHotel, QuoteView } from '@texholiday/booking';
import type { AnalyticsItem } from '../components/tracking/TrackEvent';
import { analyticsValue } from '../i18n/format';

/**
 * GA4 e-commerce payloads (ADR-0018), built on the server from what the page shows. No personal data: product ids,
 * names, dates and prices only. Values are numbers for analytics (never used for money).
 */
export function quoteEcommerce(q: QuoteView | FlightQuoteView): { currency: string; value: number; items: AnalyticsItem[] } {
  const value = analyticsValue(q.total);
  if (q.product === 'HOTEL') {
    return {
      currency: q.total.currency,
      value,
      items: [{ item_id: q.hotel.hotelId, item_name: q.hotel.name, item_category: 'Hotel', ...(q.room.boardName ? { item_variant: q.room.boardName } : {}), price: value, quantity: 1 }],
    };
  }
  return { currency: q.total.currency, value, items: [{ item_id: `flight:${q.title}`, item_name: q.title, item_category: 'Flight', price: value, quantity: 1 }] };
}

export function listEcommerce(listId: string, listName: string, hotels: readonly ListedHotel[]) {
  const priced = hotels.filter((h) => h.price);
  return {
    item_list_id: listId,
    item_list_name: listName,
    ...(priced[0]?.price ? { currency: priced[0].price.amount.currency } : {}),
    items: hotels.map((h, i) => ({ item_id: h.hotelId, item_name: h.name, item_category: 'Hotel', item_list_id: listId, index: i, ...(h.price ? { price: analyticsValue(h.price.amount) } : {}) })),
  };
}

export function searchEcommerce(hotels: readonly HotelResultView[]) {
  return {
    item_list_id: 'search_results',
    item_list_name: 'Search results',
    ...(hotels[0] ? { currency: hotels[0].from.currency } : {}),
    items: hotels.slice(0, 50).map((h, i) => ({ item_id: h.hotelId, item_name: h.name, item_category: 'Hotel', item_list_id: 'search_results', index: i, price: analyticsValue(h.from) })),
  };
}
