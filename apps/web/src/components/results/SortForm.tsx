'use client';

/**
 * The sort order above the results, always in view. A plain GET form carrying the search's and the filters' own
 * parameters: choosing an order submits it at once; without JavaScript the button below does.
 */
export function SortForm({ label, value, options, hidden, submit }: { label: string; value: string; options: Array<{ value: string; text: string }>; hidden: Array<[string, string]>; submit: string }) {
  return (
    <form method="get" className="sort-form" onChange={(e) => e.currentTarget.requestSubmit()}>
      {hidden.map(([k, v], i) => (
        <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
      ))}
      <label htmlFor="results-sort">{label}</label>
      <select id="results-sort" name="sort" defaultValue={value}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.text}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="secondary small">
          {submit}
        </button>
      </noscript>
    </form>
  );
}
