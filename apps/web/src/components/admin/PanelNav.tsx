'use client';

import { usePathname } from 'next/navigation';
import { switchLanguageAction } from '../../app/yonetim/actions';

/** Menu links with the current page marked (client side: the layout does not know the path). */
export function PanelNav({ label, items }: { label: string; items: Array<{ key: string; href: string; text: string }> }) {
  const path = usePathname();
  return (
    <nav className="panel-nav" aria-label={label}>
      {items.map((n) => (
        <a key={n.key} href={n.href} aria-current={path === n.href || (n.href !== '/yonetim' && path.startsWith(`${n.href}/`)) ? 'page' : undefined}>
          {n.text}
        </a>
      ))}
    </nav>
  );
}

/** Switches the staff language and comes back to the same page. */
export function LanguageSwitch({ next, text }: { next: 'tr' | 'en'; text: string }) {
  const path = usePathname();
  return (
    <form action={switchLanguageAction}>
      <input type="hidden" name="lang" value={next} />
      <input type="hidden" name="back" value={path} />
      <button type="submit" className="link" lang={next}>
        {text}
      </button>
    </form>
  );
}
