/**
 * Structured data of the hotel list and hotel pages (ADR-0014), as pure functions.
 * - List page: `ItemList` at the top level, one `ListItem` per hotel whose `item` is a `Hotel` with its own page on this
 *   site (Google structured data carousels, beta; Türkiye: hotels). Hotels without an image are left out (image is
 *   required); with fewer than three hotels no list is marked up.
 * - Everything marked up is visible on the page. The provider's guest rating is never marked up (Google review
 *   guidelines: no ratings aggregated from other sites).
 */

export interface MarkupHotel {
  name: string;
  url: string;
  images: readonly string[];
  address: string | null;
  city: string | null;
  country: string | null;
  stars: number | null;
  facilities: readonly string[];
  /** The visible "from" price text, e.g. "€120" (used for priceRange when short enough). */
  fromPrice: string | null;
}

const MAX_PRICE_RANGE = 11;

/** Absolute https URL on `origin` for site paths; provider URLs are kept when https. */
export function absoluteUrl(origin: string, url: string): string | null {
  try {
    const u = new URL(url, origin);
    return u.protocol === 'https:' || u.origin === new URL(origin).origin ? u.toString() : null;
  } catch {
    return null;
  }
}

function postalAddress(h: Pick<MarkupHotel, 'address' | 'city' | 'country'>): Record<string, unknown> | undefined {
  if (!h.address && !h.city && !h.country) return undefined;
  const country = h.country ? (/^[a-z]{2}$/i.test(h.country) ? h.country.toUpperCase() : h.country) : undefined;
  return { '@type': 'PostalAddress', ...(h.address ? { streetAddress: h.address } : {}), ...(h.city ? { addressLocality: h.city } : {}), ...(country ? { addressCountry: country } : {}) };
}

function hotelNode(h: MarkupHotel, origin: string, maxImages: number): Record<string, unknown> | null {
  const images = h.images.map((i) => absoluteUrl(origin, i)).filter((i): i is string => i !== null).slice(0, maxImages);
  const url = absoluteUrl(origin, h.url);
  if (images.length === 0 || !url) return null;
  const priceRange = h.fromPrice && `${h.fromPrice}+`.length <= MAX_PRICE_RANGE ? `${h.fromPrice}+` : undefined;
  const address = postalAddress(h);
  return {
    '@type': 'Hotel',
    name: h.name,
    url,
    image: images,
    ...(address ? { address } : {}),
    ...(h.stars !== null && h.stars >= 1 && h.stars <= 5 ? { starRating: { '@type': 'Rating', ratingValue: h.stars } } : {}),
    ...(priceRange ? { priceRange } : {}),
    ...(h.facilities.length > 0 ? { amenityFeature: h.facilities.slice(0, 30).map((name) => ({ '@type': 'LocationFeatureSpecification', name, value: true })) } : {}),
  };
}

/** The list page's `ItemList`, or null when fewer than three hotels qualify. */
export function hotelItemList(input: { name: string; url: string; origin: string; hotels: readonly MarkupHotel[] }): Record<string, unknown> | null {
  const items = input.hotels.map((h) => hotelNode(h, input.origin, 5)).filter((n): n is Record<string, unknown> => n !== null);
  if (items.length < 3) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: input.name,
    url: absoluteUrl(input.origin, input.url),
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, item })),
  };
}

/** The hotel page's `Hotel` node with its description, location and check-in/out times. */
export function hotelPage(
  h: MarkupHotel & { description: string | null; location: { latitude: number; longitude: number } | null; checkinTime: string | null; checkoutTime: string | null },
  origin: string,
): Record<string, unknown> | null {
  const node = hotelNode(h, origin, 10);
  if (!node) return null;
  const time = (t: string | null) => (t && /^\d{2}:\d{2}$/.test(t) ? `${t}:00` : undefined);
  return {
    '@context': 'https://schema.org',
    ...node,
    ...(h.description ? { description: h.description.slice(0, 500) } : {}),
    ...(h.location ? { geo: { '@type': 'GeoCoordinates', latitude: h.location.latitude, longitude: h.location.longitude } } : {}),
    ...(time(h.checkinTime) ? { checkinTime: time(h.checkinTime) } : {}),
    ...(time(h.checkoutTime) ? { checkoutTime: time(h.checkoutTime) } : {}),
  };
}

export function breadcrumbList(origin: string, items: ReadonlyArray<{ name: string; path: string }>): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: absoluteUrl(origin, it.path) })),
  };
}

/** JSON for a <script type="application/ld+json">: "<" is escaped so provider text cannot close the script. */
export function jsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
