import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ECOMMERCE_EVENTS, OTHER_EVENTS } from '../src/components/tracking/TrackEvent';
import { CONSENT_BOOTSTRAP } from '../src/server/tracking';

/**
 * The ready GTM container (docs/olcum/gtm-texholiday.json, ADR-0018) must match what the site pushes: the same event
 * names, the consent events and fields, resolvable references, placeholder ids only, and no tag that fires without
 * consent.
 */
type Param = { type: string; key?: string; value?: string; list?: Array<{ map?: Param[] } & Param> };
type Container = {
  exportFormatVersion: number;
  containerVersion: {
    tag: Array<{ name: string; type: string; parameter: Param[]; firingTriggerId: string[] }>;
    trigger: Array<{ triggerId: string; name: string; customEventFilter: Array<{ type: string; parameter: Param[] }>; filter?: Array<{ type: string; parameter: Param[] }> }>;
    variable: Array<{ name: string; type: string; parameter: Param[] }>;
    builtInVariable: Array<{ name: string }>;
  };
};
const root = join(__dirname, '..', '..', '..');
const raw = readFileSync(join(root, 'docs', 'olcum', 'gtm-texholiday.json'), 'utf8');
const gtm = JSON.parse(raw) as Container;
const cv = gtm.containerVersion;
const consentManager = readFileSync(join(__dirname, '..', 'src', 'components', 'tracking', 'ConsentManager.tsx'), 'utf8');
const arg = (ps: Param[], key: string) => ps.find((p) => p.key === key)?.value;
const eventPattern = (name: string) => {
  const t = cv.trigger.find((x) => x.name === name)!;
  return { kind: t.customEventFilter[0]!.type, value: arg(t.customEventFilter[0]!.parameter, 'arg1')!, filters: (t.filter ?? []).map((f) => [arg(f.parameter, 'arg0'), arg(f.parameter, 'arg1')]) };
};

describe('GTM container (docs/olcum)', () => {
  it('is an import file whose tags point to its own triggers and whose references resolve', () => {
    expect(gtm.exportFormatVersion).toBe(2);
    const ids = new Set(cv.trigger.map((t) => t.triggerId));
    for (const t of cv.tag) for (const id of t.firingTriggerId) expect(ids.has(id), `${t.name} → ${id}`).toBe(true);
    const names = new Set([...cv.variable.map((v) => v.name), ...cv.builtInVariable.map((v) => v.name), '_event']);
    for (const ref of raw.matchAll(/\{\{([^}]+)\}\}/g)) expect(names.has(ref[1]!), ref[1]).toBe(true);
  });

  it('nothing fires without consent: every trigger needs analytics or marketing consent', () => {
    const builtIn = ['2147479553', '2147479573', '2147479572']; // All Pages, Initialization, Consent Initialization
    for (const t of cv.tag) for (const id of t.firingTriggerId) expect(builtIn).not.toContain(id);
    for (const t of cv.trigger) {
      expect(t.filter?.some((f) => ['{{DLV - consent_analytics}}', '{{DLV - consent_marketing}}'].includes(arg(f.parameter, 'arg0')!) && arg(f.parameter, 'arg1') === 'true'), t.name).toBe(true);
    }
    // Marketing tags (Google Ads, Meta) never ride on analytics consent alone.
    const marketing = new Set(cv.trigger.filter((t) => t.filter!.some((f) => arg(f.parameter, 'arg0') === '{{DLV - consent_marketing}}')).map((t) => t.triggerId));
    for (const t of cv.tag.filter((x) => /^(AW|Meta) /.test(x.name))) for (const id of t.firingTriggerId) expect(marketing.has(id), t.name).toBe(true);
  });

  it('listens for the events and consent fields the site pushes', () => {
    const ecom = eventPattern('TexHoliday - GA4 ecommerce events');
    expect(ecom.kind).toBe('MATCH_REGEX');
    expect(ecom.value.replace(/^\^\(|\)\$$/g, '').split('|').sort()).toEqual([...ECOMMERCE_EVENTS].sort());
    expect(eventPattern('TexHoliday - search').value).toBe(OTHER_EVENTS[0]);
    for (const name of ['Consent - Analytics granted', 'Consent - Marketing granted']) expect(eventPattern(name).value).toBe('^(consent_state|consent_update)$');
    // Stored choice (inline bootstrap) and a new choice (banner) are announced with the same fields.
    for (const source of [CONSENT_BOOTSTRAP, consentManager]) {
      expect(source).toMatch(/consent_analytics/);
      expect(source).toMatch(/consent_marketing/);
    }
    expect(CONSENT_BOOTSTRAP).toMatch(/event:'consent_state'/);
    expect(consentManager).toMatch(/event: 'consent_update'/);
  });

  it('ships placeholders, never real ids', () => {
    for (const v of cv.variable.filter((x) => x.name.startsWith('CONFIG - '))) expect(arg(v.parameter, 'value'), v.name).toMatch(/^(G-)?X+$/);
    expect(raw).not.toMatch(/GTM-[A-Z0-9]{4,}|G-(?!X+")[A-Z0-9]{6,}|AW-\d{6,}/);
  });
});
