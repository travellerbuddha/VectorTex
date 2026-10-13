'use client';

import { BedDouble, CarFront, Compass, Package, Plane } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { Fragment } from 'react';

const ICONS = { hotels: BedDouble, flights: Plane, tours: Compass, transfers: CarFront, packages: Package };
type Key = keyof typeof ICONS;

/** Hotel pages: home, results, booking and the hotel list pages (both languages). */
const HOTEL_DIRS = ['search', 'checkout', 'otel', 'oteller', 'hotel', 'hotels'];

/** Lets a label break after a slash where it has to ("Tur/Aktivite" in a narrow column). */
const breakable = (text: string): React.ReactNode =>
  text.split('/').map((part, i) =>
    i === 0 ? (
      part
    ) : (
      <Fragment key={i}>
        /<wbr />
        {part}
      </Fragment>
    ),
  );

/**
 * Product tabs of the site header. The current product is marked (client side: the layout does not know the path);
 * products not on sale yet are shown as "coming soon", not as links, in one group with one visible badge. On wide
 * screens everything sits in the header's single row; on phones the products fill one row of equal columns (icon over
 * the name) and the editors' pages a row of their own, so every entry is visible without sideways scrolling.
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
  const open = items.filter((i) => i.href);
  const later = items.filter((i) => !i.href);
  return (
    <nav className="products" aria-label={label} style={{ '--products': items.length, '--soon': later.length } as React.CSSProperties}>
      {open.map(({ key, text, href }) => {
        const Icon = ICONS[key];
        return (
          <a key={key} className="nav-product" href={href!} aria-current={current(key)}>
            <Icon />
            <span>{breakable(text)}</span>
          </a>
        );
      })}
      {later.length > 0 && (
        <span className="soon-group">
          {later.map(({ key, text }) => {
            const Icon = ICONS[key];
            return (
              <span key={key} className="nav-soon" aria-disabled="true">
                <Icon />
                <span>{breakable(text)}</span>
                <small className="soon">{soon}</small>
              </span>
            );
          })}
          <span className="soon-caption" aria-hidden="true">
            {soon}
          </span>
        </span>
      )}
      {extra.length > 0 && (
        <span className="nav-pages">
          {extra.map((n) => (
            <a key={`${n.href}-${n.text}`} className="nav-page" href={n.href} aria-current={path === n.href ? 'page' : undefined}>
              {n.text}
            </a>
          ))}
        </span>
      )}
    </nav>
  );
}
