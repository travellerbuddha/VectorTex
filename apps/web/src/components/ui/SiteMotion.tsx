'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { installReveals } from './reveal';

/**
 * Page-level motion: marks the header once the page has scrolled (hairline and shadow; the 8px condense itself is the
 * header's sticky offset, so nothing below it moves) and installs the one-time reveals of the current page.
 */
export function SiteMotion() {
  const path = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      frame = 0;
      root.toggleAttribute('data-scrolled', window.scrollY > 8);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => installReveals(document), [path]);

  return null;
}
