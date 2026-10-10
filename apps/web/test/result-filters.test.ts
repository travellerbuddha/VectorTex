import { describe, expect, it } from 'vitest';
import type { HotelResultView } from '@texholiday/booking';
import { activeFilters, applyFilters, boardCounts, readFilters } from '../src/server/result-filters';

const eur = (minor: string) => ({ currency: 'EUR', minor });
const offer = (key: string, total: string, boardType: string | null, freeUntil: string | null, refundable = true) => ({
  key,
  roomName: `Oda ${key}`,
  boardType,
  boardName: null,
  total: eur(total),
  perNightAverage: eur(total),
  payAtProperty: [],
  cancellation: { refundable, freeUntil, steps: [] },
});
const hotel = (id: string, stars: number | null, rating: number | null, offers: HotelResultView['offers']): HotelResultView => ({
  hotelId: id,
  name: id,
  photo: null,
  address: null,
  city: null,
  rating,
  stars,
  from: offers.reduce((a, o) => (BigInt(o.total.minor) < BigInt(a.minor) ? o.total : a), offers[0]!.total),
  offers,
});

const now = new Date('2026-10-10T12:00:00Z');
const future = '2026-10-20T00:00:00Z';
const past = '2026-10-01T00:00:00Z';
const hotels = [
  hotel('A', 4, 9.1, [offer('a1', '29700', 'BB', future), offer('a2', '19900', 'RO', null, false)]),
  hotel('B', 5, 8.7, [offer('b1', '46200', 'AI', null, false), offer('b2', '59400', 'AI', future)]),
  hotel('C', 3, null, [offer('c1', '15000', 'RO', past)]),
];

describe('results filters (GET parameters, stored results only)', () => {
  it('reads only known values; anything else is ignored', () => {
    expect(readFilters({ free: '1', boards: ['AI', 'BB', 'AI', 'x<y'], stars: '4', sort: 'price' })).toEqual({ free: true, boards: ['AI', 'BB'], stars: 4, sort: 'price' });
    expect(readFilters({ free: 'yes', boards: 'all', stars: '9', sort: 'cheapest' })).toEqual({ free: false, boards: [], stars: null, sort: 'recommended' });
    expect(activeFilters(readFilters({ free: '1', boards: ['AI', 'BB'], stars: '' }))).toBe(3);
  });

  it('free cancellation keeps only offers still free now; the lowest shown offer becomes the hotel price', () => {
    const r = applyFilters(hotels, readFilters({ free: '1' }), now);
    expect(r.map((h) => h.hotelId)).toEqual(['A', 'B']);
    expect(r[0]!.offers.map((o) => o.key)).toEqual(['a1']);
    expect(r[0]!.from).toEqual(eur('29700'));
    expect(r[1]!.from).toEqual(eur('59400'));
  });

  it('boards (any of) and minimum stars; hotels left without offers are dropped', () => {
    expect(applyFilters(hotels, readFilters({ boards: 'RO' }), now).map((h) => [h.hotelId, h.offers.length])).toEqual([
      ['A', 1],
      ['C', 1],
    ]);
    expect(applyFilters(hotels, readFilters({ stars: '4' }), now).map((h) => h.hotelId)).toEqual(['A', 'B']);
    expect(applyFilters(hotels, readFilters({ stars: '5', boards: 'BB' }), now)).toEqual([]);
  });

  it('sorts by exact price (minor units) or rating, keeping the provider order on ties; default keeps it as is', () => {
    expect(applyFilters(hotels, readFilters({ sort: 'price' }), now).map((h) => h.hotelId)).toEqual(['C', 'A', 'B']);
    expect(applyFilters(hotels, readFilters({ sort: 'rating' }), now).map((h) => h.hotelId)).toEqual(['A', 'B', 'C']);
    expect(applyFilters(hotels, readFilters({}), now)).toEqual(hotels);
  });

  it('board options with the number of hotels offering each, in the usual board order', () => {
    expect(boardCounts(hotels)).toEqual([
      { board: 'RO', hotels: 2 },
      { board: 'BB', hotels: 1 },
      { board: 'AI', hotels: 1 },
    ]);
  });
});
