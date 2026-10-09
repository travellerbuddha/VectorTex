import { z } from 'zod';
import { currency } from './currency';
import { API_MARGIN_PRODUCT_TYPES } from './policy';

const roundingMode = z.enum(['HALF_EVEN', 'HALF_UP', 'HALF_DOWN', 'UP', 'DOWN', 'CEIL', 'FLOOR']);
const productType = z.enum(['HOTEL', 'FLIGHT', 'EXPERIENCE', 'TRANSFER']);
const paymentMode = z.enum(['OWN_GATEWAY', 'PROVIDER_MANAGED']);
const currencyCode = z.string().refine((c) => {
  try {
    currency(c);
    return true;
  } catch {
    return false;
  }
}, 'unknown ISO 4217 currency');
const minorAmount = z.string().regex(/^\d+$/, 'non-negative integer in minor units');
/** Percentages are basis points (1% = 100). Upper bound guards against typos like 1500% margins. */
const basisPoints = z.number().int().min(0).max(10_000);
const label = z.object({ tr: z.string().trim().min(1).max(80), en: z.string().trim().min(1).max(80) });

const marginRule = z.discriminatedUnion('kind', [
  z.object({ productType, paymentMode, application: z.enum(['LOCAL', 'PROVIDER_API']), kind: z.literal('PERCENT_OF_NET'), basisPoints }),
  z.object({ productType, paymentMode, application: z.literal('LOCAL'), kind: z.literal('FIXED'), amount: z.object({ currency: currencyCode, minor: minorAmount }) }),
]);

const feeRule = z.discriminatedUnion('kind', [
  z.object({ code: z.string().regex(/^[A-Z0-9_]{2,32}$/), label, scope: z.union([productType, z.literal('PACKAGE')]), kind: z.literal('PERCENT_OF_SELL'), basisPoints }),
  z.object({ code: z.string().regex(/^[A-Z0-9_]{2,32}$/), label, scope: z.union([productType, z.literal('PACKAGE')]), kind: z.literal('FIXED'), amounts: z.record(currencyCode, minorAmount) }),
]);

/**
 * Editable part of a pricing policy (what a Finance user changes in /yonetim). Business values are entered
 * by users; this schema only rejects inconsistent or dangerous input.
 */
export const pricingPolicyDocumentSchema = z
  .object({
    rounding: roundingMode,
    rules: z.array(marginRule).max(64),
    serviceFees: z.array(feeRule).max(32),
    fx: z.object({ source: z.string().trim().min(1).max(120), maxRateAgeSeconds: z.number().int().min(60).max(7 * 86_400), rounding: roundingMode }).nullable(),
    allowBelowSspInOpaquePackage: z.boolean(),
  })
  .superRefine((doc, ctx) => {
    const seen = new Set<string>();
    doc.rules.forEach((r, i) => {
      const key = `${r.productType}/${r.paymentMode}`;
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['rules', i], message: `duplicate rule for ${key}` });
      seen.add(key);
      if (r.paymentMode === 'OWN_GATEWAY' && r.application === 'PROVIDER_API' && !API_MARGIN_PRODUCT_TYPES.includes(r.productType)) {
        ctx.addIssue({ code: 'custom', path: ['rules', i], message: `${r.productType} has no documented provider margin field; its own-gateway margin must be LOCAL` });
      }
      if (r.paymentMode === 'PROVIDER_MANAGED' && (r.application !== 'PROVIDER_API' || r.kind !== 'PERCENT_OF_NET')) {
        ctx.addIssue({ code: 'custom', path: ['rules', i], message: 'provider-managed margin must use the provider API percentage' });
      }
    });
    const codes = new Set<string>();
    doc.serviceFees.forEach((f, i) => {
      if (codes.has(`${f.code}/${f.scope}`)) ctx.addIssue({ code: 'custom', path: ['serviceFees', i], message: `duplicate fee ${f.code} for ${f.scope}` });
      codes.add(`${f.code}/${f.scope}`);
    });
  });

export type PricingPolicyDocument = z.infer<typeof pricingPolicyDocumentSchema>;
