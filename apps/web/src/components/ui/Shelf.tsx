'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * A horizontal row of cards that scrolls on its own (swipe, trackpad, keyboard) and snaps to a card. The arrow
 * buttons page by one view and are shown only when the row overflows; they turn off at either end. Without
 * JavaScript the row still scrolls. The page never scrolls sideways: the row clips at the page edge.
 */
export function Shelf({ label, prev, next, children }: { label: string; prev: string; next: string; children: React.ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  useEffect(() => {
    const el = track.current;
    const items = el?.querySelectorAll(':scope > ul > li');
    if (!el || !items || items.length === 0 || typeof IntersectionObserver !== 'function') return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    // Each end counts as reached when its card is (almost) fully in the row's own viewport.
    const observer = new IntersectionObserver(
      (entries) =>
        setEdges((e) => {
          const next = { ...e };
          for (const entry of entries) {
            if (entry.target === first) next.start = entry.intersectionRatio > 0.9;
            if (entry.target === last) next.end = entry.intersectionRatio > 0.9;
          }
          return next;
        }),
      { root: el, threshold: [0, 0.9, 1] },
    );
    observer.observe(first);
    observer.observe(last);
    return () => observer.disconnect();
  }, []);

  const page = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: reduce ? 'auto' : 'smooth' });
  };

  const fits = edges.start && edges.end;
  return (
    <div className="shelf" data-fits={fits || undefined}>
      <div className="shelf-track" ref={track} role="region" aria-label={label} tabIndex={0}>
        {children}
      </div>
      <div className="shelf-nav">
        <button type="button" className="shelf-btn" aria-label={prev} disabled={edges.start} onClick={() => page(-1)}>
          <ChevronLeft />
        </button>
        <button type="button" className="shelf-btn" aria-label={next} disabled={edges.end} onClick={() => page(1)}>
          <ChevronRight />
        </button>
      </div>
    </div>
  );
}
