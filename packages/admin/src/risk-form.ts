import type { FundingMethod, RiskPolicyDocument } from '@texholiday/contracts';
import { currency, DISPLAY_CURRENCIES, fromMajor, money, toMajor } from '@texholiday/pricing';
import { parseAmount } from './pricing-form';

/**
 * The risk policy editor of /yonetim (G06): converts between the stored risk policy document and the form a finance
 * user fills in. Nothing is defaulted: an empty exposure row means "no limit entered for this currency", and the
 * funding order lists only what the user picked.
 */

/** Supplier funding methods a risk policy may rank (provider-managed payment needs no funding by us). */
export const FUNDING_METHODS: readonly Exclude<FundingMethod, 'PROVIDER_MANAGED'>[] = ['ACCOUNT_CARD', 'CREDIT_LINE'];

/** Longest safety margin the schema accepts (30 days), in hours. */
export const MAX_SAFETY_MARGIN_HOURS = 720;

export interface RiskForm {
  /** Currency -> amount in major units as shown in the form ('' = none entered). */
  exposures: Record<string, string>;
  /** Safety margin in hours ("24", "1,5"). */
  marginHours: string;
  allowUnknownAsync: boolean;
  /** Funding methods in preference order. */
  funding: string[];
}

export interface RiskFormIssue {
  field: string;
  code: 'EXPOSURE' | 'MARGIN' | 'FUNDING_EMPTY' | 'FUNDING_DUPLICATE' | 'FUNDING_UNKNOWN';
}

/** Currencies the editor shows: the display currencies plus any other currency already present in the document. */
export function exposureCurrencies(doc: RiskPolicyDocument | null): string[] {
  const extra = Object.keys(doc?.maxUncapturedSupplierExposure ?? {}).filter((c) => !(DISPLAY_CURRENCIES as readonly string[]).includes(c));
  return [...DISPLAY_CURRENCIES, ...extra.sort()];
}

/** Seconds -> hours text with at most two decimals ("24", "1,5"). Exact for every value the form can store. */
export function secondsToHours(seconds: number, decimalSeparator: ',' | '.' = ','): string {
  const hundredths = Math.round(seconds / 36);
  const whole = Math.trunc(hundredths / 100);
  const frac = String(hundredths % 100).padStart(2, '0').replace(/0+$/, '');
  return frac ? `${whole}${decimalSeparator}${frac}` : String(whole);
}

/** "24", "1,5", "0.25" -> seconds (0..720 h, two decimals at most; integer arithmetic). */
export function hoursToSeconds(text: string): number | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const hundredths = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return hundredths <= MAX_SAFETY_MARGIN_HOURS * 100 ? hundredths * 36 : null;
}

export function riskFormFromDocument(doc: RiskPolicyDocument | null, decimalSeparator: ',' | '.' = ','): RiskForm {
  const exposures: Record<string, string> = {};
  for (const c of exposureCurrencies(doc)) {
    const minor = doc?.maxUncapturedSupplierExposure[c];
    exposures[c] = minor === undefined ? '' : toMajor(money(c, minor)).replace('.', decimalSeparator);
  }
  return {
    exposures,
    marginHours: doc ? secondsToHours(doc.authorizationSafetyMarginSeconds, decimalSeparator) : '',
    allowUnknownAsync: doc?.allowUnknownAsyncConfirmationBound ?? false,
    funding: [...(doc?.fundingPreference ?? [])],
  };
}

/**
 * Builds a risk policy document from the submitted form. Field names: `exp.<CUR>`, `margin.hours`, `async.allowUnknown`,
 * `fund.1` … `fund.<n>` (n = number of funding methods). The result still goes through the policy schema on save.
 */
export function riskDocumentFromForm(
  get: (name: string) => string | null,
  base: RiskPolicyDocument | null,
  decimalSeparator: ',' | '.' = ',',
): { document: RiskPolicyDocument; issues: RiskFormIssue[] } {
  const issues: RiskFormIssue[] = [];

  const exposure: Record<string, string> = {};
  for (const c of exposureCurrencies(base)) {
    const text = (get(`exp.${c}`) ?? '').trim();
    if (text === '') continue;
    try {
      const plain = parseAmount(text, decimalSeparator);
      if (plain === null) throw new Error('format');
      const m = fromMajor(plain, currency(c));
      if (m.minor < 0n) throw new Error('negative');
      exposure[m.currency] = m.minor.toString();
    } catch {
      issues.push({ field: `exp.${c}`, code: 'EXPOSURE' });
    }
  }

  const seconds = hoursToSeconds(get('margin.hours') ?? '');
  if (seconds === null) issues.push({ field: 'margin.hours', code: 'MARGIN' });

  const funding: FundingMethod[] = [];
  for (let i = 1; i <= FUNDING_METHODS.length; i++) {
    const v = (get(`fund.${i}`) ?? '').trim();
    if (v === '') continue;
    if (!(FUNDING_METHODS as readonly string[]).includes(v)) {
      issues.push({ field: `fund.${i}`, code: 'FUNDING_UNKNOWN' });
      continue;
    }
    if (funding.includes(v as FundingMethod)) {
      issues.push({ field: `fund.${i}`, code: 'FUNDING_DUPLICATE' });
      continue;
    }
    funding.push(v as FundingMethod);
  }
  if (funding.length === 0 && !issues.some((i) => i.field.startsWith('fund.'))) issues.push({ field: 'fund', code: 'FUNDING_EMPTY' });

  return {
    document: {
      maxUncapturedSupplierExposure: exposure,
      authorizationSafetyMarginSeconds: seconds ?? 0,
      allowUnknownAsyncConfirmationBound: get('async.allowUnknown') === '1',
      fundingPreference: funding as RiskPolicyDocument['fundingPreference'],
    },
    issues,
  };
}
