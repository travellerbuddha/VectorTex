'use client';

import { useId } from 'react';
import { Minus, Plus } from 'lucide-react';

/**
 * A count with − and + buttons (guests, passengers). The buttons stay focusable at their limits (aria-disabled), so
 * keyboard focus is never lost when a limit is reached; the value is announced politely.
 */
export function Stepper({ label, value, min, max, onChange, words }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void; words: { increase: string; decrease: string } }) {
  const id = useId();
  const atMin = value <= min;
  const atMax = value >= max;
  return (
    <div className="stepper-row">
      <span id={id} className="stepper-label">
        {label}
      </span>
      <div className="stepper" role="group" aria-labelledby={id}>
        <button type="button" className="stepper-btn" aria-label={`${label}: ${words.decrease}`} aria-disabled={atMin || undefined} onClick={() => !atMin && onChange(value - 1)}>
          <Minus />
        </button>
        <output className="stepper-value" aria-live="polite">
          {value}
        </output>
        <button type="button" className="stepper-btn" aria-label={`${label}: ${words.increase}`} aria-disabled={atMax || undefined} onClick={() => !atMax && onChange(value + 1)}>
          <Plus />
        </button>
      </div>
    </div>
  );
}
