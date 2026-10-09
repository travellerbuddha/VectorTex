import { currency, fromMajor, money, toMajor, type MarginRule, type PaymentMode, type PricingPolicyDocument, type ProductType, type RoundingMode } from '@texholiday/pricing';

/**
 * The pricing policy editor of /yonetim (G06): converts between the stored policy document and the form a finance
 * user fills in. No value is invented: an empty row means "no margin rule", which closes that sale (no default).
 */

export interface MarginSlot {
  productType: ProductType;
  paymentMode: PaymentMode;
  /** Applications the contract allows for this slot (ADR-0006): provider-managed sales only take the provider margin. */
  applications: ReadonlyArray<'PROVIDER_API' | 'LOCAL'>;
}

/**
 * The editable slots. Provider-managed experiences/transfers are absent: no documented provider margin field and we
 * cannot add a local margin to a price the provider collects.
 */
export const MARGIN_SLOTS: readonly MarginSlot[] = [
  { productType: 'HOTEL', paymentMode: 'PROVIDER_MANAGED', applications: ['PROVIDER_API'] },
  { productType: 'HOTEL', paymentMode: 'OWN_GATEWAY', applications: ['PROVIDER_API', 'LOCAL'] },
  { productType: 'FLIGHT', paymentMode: 'PROVIDER_MANAGED', applications: ['PROVIDER_API'] },
  { productType: 'FLIGHT', paymentMode: 'OWN_GATEWAY', applications: ['PROVIDER_API', 'LOCAL'] },
  { productType: 'EXPERIENCE', paymentMode: 'OWN_GATEWAY', applications: ['LOCAL'] },
  { productType: 'TRANSFER', paymentMode: 'OWN_GATEWAY', applications: ['LOCAL'] },
];

export const ROUNDING_MODES: readonly RoundingMode[] = ['HALF_EVEN', 'HALF_UP', 'HALF_DOWN', 'UP', 'DOWN', 'CEIL', 'FLOOR'];

export const slotKey = (s: { productType: ProductType; paymentMode: PaymentMode }) => `m.${s.productType}.${s.paymentMode}`;

/** Form row of one slot (strings as typed by the user). */
export interface MarginRow {
  on: boolean;
  application: 'PROVIDER_API' | 'LOCAL';
  kind: 'PERCENT_OF_NET' | 'FIXED';
  percent: string;
  amount: string;
  currency: string;
}

/** "10", "10,5", "12.25" -> basis points (1% = 100). Two decimals at most, 0-100 %. Exact (no floating point). */
export function percentToBasisPoints(text: string): number | null {
  const t = text.trim().replace(',', '.');
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bp <= 10_000 ? bp : null;
}

/** Basis points -> "10" / "10,5" / "12,25" (Turkish decimal comma) or with a dot. */
export function basisPointsToPercent(bp: number, decimalSeparator: ',' | '.' = ','): string {
  const whole = Math.trunc(bp / 100);
  const frac = String(bp % 100).padStart(2, '0').replace(/0+$/, '');
  return frac ? `${whole}${decimalSeparator}${frac}` : String(whole);
}

export function rowsFromDocument(doc: PricingPolicyDocument | null): Record<string, MarginRow> {
  const rows: Record<string, MarginRow> = {};
  for (const slot of MARGIN_SLOTS) {
    const rule = doc?.rules.find((r) => r.productType === slot.productType && r.paymentMode === slot.paymentMode);
    rows[slotKey(slot)] = {
      on: !!rule,
      application: rule?.application ?? slot.applications[0]!,
      kind: rule?.kind ?? 'PERCENT_OF_NET',
      percent: rule?.kind === 'PERCENT_OF_NET' ? basisPointsToPercent(rule.basisPoints) : '',
      amount: rule?.kind === 'FIXED' ? toMajor(money(rule.amount.currency, rule.amount.minor)) : '',
      currency: rule?.kind === 'FIXED' ? rule.amount.currency : 'EUR',
    };
  }
  return rows;
}

export interface FormIssue {
  field: string;
  code: 'PERCENT' | 'AMOUNT' | 'CURRENCY' | 'APPLICATION' | 'FX_SOURCE' | 'FX_AGE' | 'ROUNDING' | 'FIXED_NOT_LOCAL';
}

/**
 * Builds a policy document from the submitted form. Rules of slots the editor does not show, service fees and
 * anything else are kept from `base` unchanged (nothing is dropped silently). The result still goes through the
 * policy schema on save.
 */
export function documentFromForm(get: (name: string) => string | null, base: PricingPolicyDocument | null): { document: PricingPolicyDocument; issues: FormIssue[] } {
  const issues: FormIssue[] = [];
  const editable = new Set(MARGIN_SLOTS.map(slotKey));
  const rules: MarginRule[] = (base?.rules ?? []).filter((r) => !editable.has(slotKey(r)));
  for (const slot of MARGIN_SLOTS) {
    const k = slotKey(slot);
    if (get(`${k}.on`) !== '1') continue;
    const application = (get(`${k}.app`) ?? slot.applications[0]) as 'PROVIDER_API' | 'LOCAL';
    if (!slot.applications.includes(application)) {
      issues.push({ field: k, code: 'APPLICATION' });
      continue;
    }
    const kind = get(`${k}.kind`) === 'FIXED' ? 'FIXED' : 'PERCENT_OF_NET';
    if (kind === 'FIXED') {
      if (application !== 'LOCAL') {
        issues.push({ field: k, code: 'FIXED_NOT_LOCAL' });
        continue;
      }
      let code: string;
      try {
        code = currency(get(`${k}.currency`) ?? '');
      } catch {
        issues.push({ field: k, code: 'CURRENCY' });
        continue;
      }
      try {
        const m = fromMajor((get(`${k}.amount`) ?? '').trim().replace(',', '.'), code);
        if (m.minor < 0n) throw new Error('negative');
        rules.push({ productType: slot.productType, paymentMode: slot.paymentMode, application: 'LOCAL', kind: 'FIXED', amount: { currency: m.currency, minor: m.minor.toString() } });
      } catch {
        issues.push({ field: k, code: 'AMOUNT' });
      }
      continue;
    }
    const bp = percentToBasisPoints(get(`${k}.pct`) ?? '');
    if (bp === null) {
      issues.push({ field: k, code: 'PERCENT' });
      continue;
    }
    rules.push({ productType: slot.productType, paymentMode: slot.paymentMode, application, kind: 'PERCENT_OF_NET', basisPoints: bp });
  }

  const rounding = (get('rounding') ?? 'HALF_EVEN') as RoundingMode;
  if (!ROUNDING_MODES.includes(rounding)) issues.push({ field: 'rounding', code: 'ROUNDING' });

  let fx: PricingPolicyDocument['fx'] = null;
  if (get('fx.on') === '1') {
    const source = (get('fx.source') ?? '').trim();
    const minutes = Number(get('fx.maxAgeMinutes') ?? '');
    const fxRounding = (get('fx.rounding') ?? 'HALF_EVEN') as RoundingMode;
    if (source.length < 1 || source.length > 120) issues.push({ field: 'fx.source', code: 'FX_SOURCE' });
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 7 * 24 * 60) issues.push({ field: 'fx.maxAgeMinutes', code: 'FX_AGE' });
    if (!ROUNDING_MODES.includes(fxRounding)) issues.push({ field: 'fx.rounding', code: 'ROUNDING' });
    fx = { source, maxRateAgeSeconds: minutes * 60, rounding: fxRounding };
  }

  return {
    document: {
      rounding,
      rules,
      serviceFees: base?.serviceFees ?? [],
      fx,
      allowBelowSspInOpaquePackage: get('ssp.package') === '1',
      allowBelowSspProviderManaged: get('ssp.providerManaged') === '1',
    },
    issues,
  };
}
