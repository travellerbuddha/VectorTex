'use client';

import { BedDouble, CarFront, Compass, Package, Plane } from 'lucide-react';
import { usePathname } from 'next/navigation';

const ICONS = { hotels: BedDouble, flights: Plane, tours: Compass, transfers: CarFront, packages: Package };
type Key = keyof typeof ICONS;

/** Hotel pages: home, results, booking and the hotel list pages (both languages). */
const HOTEL_DIRS = ['search', 'checkout', 'otel', 'oteller', 'hotel', 'hotels'];

/**
 * Product tabs of the site header. The current product is marked (client side: the layout does not know the path);
 * products not on sale yet are shown as "coming soon", not as links.
 */
export function ProductNav({
  label,
  locale,
  items,
  soon,
  extra,
}: {
  label: string;
  locale: string;
  items: Array<{ key: Key; text: string; href: string | null }>;
  soon: string;
  extra: Array<{ href: string; text: string }>;
}) {
  const path = usePathname() ?? '';
  const dir = path.split('/')[2] ?? '';
  const current = (key: Key): 'page' | 'true' | undefined => {
    if (key === 'hotels') return path === `/${locale}` ? 'page' : HOTEL_DIRS.includes(dir) ? 'true' : undefined;
    if (key === 'flights') return path === `/${locale}/flights` ? 'page' : dir === 'flights' ? 'true' : undefined;
    return undefined;
  };
  return (
    <nav className="products" aria-label={label}>
      {items.map(({ key, text, href }) => {
        const Icon = ICONS[key];
        return href ? (
          <a key={key} href={href} aria-current={current(key)}>
            <Icon />
            {text}
          </a>
        ) : (
          <span key={key} className="nav-soon" aria-disabled="true">
            <Icon />
            {text}
            <small className="soon">{soon}</small>
          </span>
        );
      })}
      {extra.map((n) => (
        <a key={`${n.href}-${n.text}`} href={n.href} aria-current={path === n.href ? 'page' : undefined}>
          {n.text}
        </a>
      ))}
    </nav>
  );
}
