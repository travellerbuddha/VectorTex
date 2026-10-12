'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { installReveals } from './reveal';

/**
 * Page-level motion: marks the page as scrolled once the 8px sentinel at the top of the document leaves the viewport
 * (the header then shows its hairline; nothing moves), turns transitions on after the first painted frame and
 * installs the one-time reveals of the current page. An observer instead of a scroll listener: no work on scroll
 * frames.
 */
export function SiteMotion() {
  const path = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    const sentinel = document.querySelector('.scroll-sentinel');
    if (!sentinel || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(([entry]) => root.toggleAttribute('data-scrolled', !entry!.isIntersecting));
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Transitions switch on only once the page has painted with its styles (motion.css): a style that arrives late
  // then lands at once, it never animates from the browser's defaults during the load.
  useEffect(() => {
    const frame = requestAnimationFrame(() => document.documentElement.setAttribute('data-motion', ''));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => installReveals(document), [path]);

  return null;
}
