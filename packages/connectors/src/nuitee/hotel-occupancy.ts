import type { HotelOccupancy, HotelRoomGuest } from '@texholiday/contracts';

export class OccupancyMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OccupancyMappingError';
  }
}

export interface SearchedRoom {
  adults: number;
  childAges: readonly number[];
}

/**
 * Builds occupancies in the exact order the rooms were searched, numbered from 1 (§8). The same order is
 * kept for the offer, the prebook and the booking guests.
 */
export function occupanciesFromSearch(rooms: readonly SearchedRoom[]): HotelOccupancy[] {
  if (rooms.length === 0) throw new OccupancyMappingError('At least one room is required');
  return rooms.map((r, i) => {
    if (!Number.isInteger(r.adults) || r.adults < 1) throw new OccupancyMappingError(`Room ${i + 1}: at least one adult is required`);
    for (const age of r.childAges) {
      if (!Number.isInteger(age) || age < 0 || age > 17) throw new OccupancyMappingError(`Room ${i + 1}: invalid child age ${age}`);
    }
    return { occupancyNumber: i + 1, adults: r.adults, childAges: [...r.childAges] };
  });
}

/**
 * Validates the lead guest per room against the searched occupancies (T03):
 * - exactly one lead guest for every occupancyNumber, no extra or duplicate numbers;
 * - the offer must cover exactly the searched occupancy numbers.
 */
export function assertGuestsMatchOccupancies(occupancies: readonly HotelOccupancy[], guests: readonly HotelRoomGuest[], offerOccupancyNumbers: readonly number[]): void {
  const expected = occupancies.map((o) => o.occupancyNumber).sort((a, b) => a - b);
  const offer = [...offerOccupancyNumbers].sort((a, b) => a - b);
  if (expected.join(',') !== offer.join(',')) {
    throw new OccupancyMappingError(`Offer covers rooms [${offer.join(',')}] but the search had [${expected.join(',')}]`);
  }
  const seen = new Set<number>();
  for (const g of guests) {
    if (!expected.includes(g.occupancyNumber)) throw new OccupancyMappingError(`Guest for unknown room ${g.occupancyNumber}`);
    if (seen.has(g.occupancyNumber)) throw new OccupancyMappingError(`Two lead guests for room ${g.occupancyNumber}`);
    if (!g.leadGuest.firstName.trim() || !g.leadGuest.lastName.trim()) throw new OccupancyMappingError(`Room ${g.occupancyNumber}: lead guest name required`);
    seen.add(g.occupancyNumber);
  }
  const missing = expected.filter((n) => !seen.has(n));
  if (missing.length > 0) throw new OccupancyMappingError(`Missing lead guest for room(s) ${missing.join(',')}`);
}

/** Guest nationality is explicit customer input; it is never inferred from IP or card country (§8). */
export function assertExplicitNationality(nationality: string | null | undefined): string {
  if (!nationality || !/^[A-Z]{2}$/.test(nationality)) throw new OccupancyMappingError('Guest nationality (ISO 3166-1 alpha-2) must be provided explicitly');
  return nationality;
}
