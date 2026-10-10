import type { HotelResultView } from '@texholiday/booking';

/**
 * Results page filters (GET parameters, so they work without JavaScript and can be shared as a link). They only narrow
 * and reorder the stored search results; nothing is fetched from the provider again and no price is changed.
 *   free=1          offers with free cancellation until a time still in the future
 *   boards=AI&boards=BB  board types (any of them)
 *   stars=4         official category at least this many stars
 *   sort=price|rating  default: the provider's order
 */
export interface ResultFilters {
  free: boolean;
  boards: string[];
  stars: number | null;
  sort: 'recommended' | 'price' | 'rating';
}

const BOARD = /^[A-Z]{2,4}$/;

export function readFilters(sp: Record<string, string | string[] | undefined>): ResultFilters {
  const all = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  const stars = Number(all(sp.stars)[0]);
  const sort = all(sp.sort)[0];
  return {
    free: all(sp.free)[0] === '1',
    boards: [...new Set(all(sp.boards).filter((b) => BOARD.test(b)))].sort(),
    stars: Number.isInteger(stars) && stars >= 2 && stars <= 5 ? stars : null,
    sort: sort === 'price' || sort === 'rating' ? sort : 'recommended',
  };
}

export const activeFilters = (f: ResultFilters) => (f.free ? 1 : 0) + f.boards.length + (f.stars ? 1 : 0);

const minor = (m: { minor: string }) => BigInt(m.minor);

/** Offers that pass the filters; hotels left without an offer are dropped, `from` is the lowest offer still shown. */
export function applyFilters(hotels: readonly HotelResultView[], f: ResultFilters, now: Date): HotelResultView[] {
  const freeNow = (until: string | null) => until !== null && new Date(until).getTime() > now.getTime();
  const kept = hotels.flatMap((h) => {
    if (f.stars && (h.stars ?? 0) < f.stars) return [];
    const offers = h.offers.filter((o) => (!f.free || (o.cancellation.refundable && freeNow(o.cancellation.freeUntil))) && (f.boards.length === 0 || (o.boardType !== null && f.boards.includes(o.boardType))));
    if (offers.length === 0) return [];
    const from = offers.reduce((low, o) => (minor(o.total) < minor(low) ? o.total : low), offers[0]!.total);
    return [{ ...h, offers, from }];
  });
  if (f.sort === 'price') return kept.map((h, i) => ({ h, i })).sort((a, b) => (minor(a.h.from) < minor(b.h.from) ? -1 : minor(a.h.from) > minor(b.h.from) ? 1 : a.i - b.i)).map((x) => x.h);
  if (f.sort === 'rating') return kept.map((h, i) => ({ h, i })).sort((a, b) => (b.h.rating ?? -1) - (a.h.rating ?? -1) || a.i - b.i).map((x) => x.h);
  return kept;
}

/** Board types on offer and how many hotels have each (filter labels). */
export function boardCounts(hotels: readonly HotelResultView[]): Array<{ board: string; hotels: number }> {
  const counts = new Map<string, number>();
  for (const h of hotels) for (const b of new Set(h.offers.map((o) => o.boardType).filter((x): x is string => x !== null))) counts.set(b, (counts.get(b) ?? 0) + 1);
  const order = ['RO', 'BB', 'BI', 'HB', 'FB', 'AI'];
  return [...counts.entries()].sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99) || a[0].localeCompare(b[0])).map(([board, n]) => ({ board, hotels: n }));
}
