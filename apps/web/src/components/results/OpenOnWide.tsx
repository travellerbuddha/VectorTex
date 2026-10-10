'use client';

import { useEffect, useRef } from 'react';

/**
 * A disclosure that starts open on wide screens (the filter column) and closed on phones. The server renders it closed;
 * the browser opens it after hydration, so both sides render the same markup.
 */
export function OpenOnWide({ className, summary, children, minWidth = 980 }: { className: string; summary: React.ReactNode; children: React.ReactNode; minWidth?: number }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current && window.matchMedia(`(min-width: ${minWidth}px)`).matches) ref.current.open = true;
  }, [minWidth]);
  return (
    <details ref={ref} className={className}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
