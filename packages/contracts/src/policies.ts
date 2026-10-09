import { z } from 'zod';

const minorAmount = z.string().regex(/^\d+$/, 'non-negative integer in minor units');

/**
 * Editable risk policy (G06). Values are entered and approved by the business; the schema only rejects
 * inconsistent input. No default values are shipped.
 */
export const riskPolicyDocumentSchema = z.object({
  maxUncapturedSupplierExposure: z.record(z.string().regex(/^[A-Z]{3}$/), minorAmount),
  authorizationSafetyMarginSeconds: z.number().int().min(0).max(30 * 86_400),
  allowUnknownAsyncConfirmationBound: z.boolean(),
  fundingPreference: z
    .array(z.enum(['ACCOUNT_CARD', 'CREDIT_LINE']))
    .min(1)
    .refine((a) => new Set(a).size === a.length, 'duplicate funding method'),
});

export type RiskPolicyDocument = z.infer<typeof riskPolicyDocumentSchema>;
