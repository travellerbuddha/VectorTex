import { z } from 'zod';
import { DomainError } from '@texholiday/contracts';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), 'invalid date');
const name = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[\p{L}][\p{L}\p{M} .'-]*$/u, 'letters only');

export const hotelSearchInput = z
  .object({
    target: z.union([
      z.object({ placeId: z.string().min(3).max(200) }),
      z.object({ countryCode: z.string().regex(/^[A-Z]{2}$/), cityName: z.string().trim().min(2).max(80) }),
      z.object({ hotelIds: z.array(z.string().regex(/^[\w-]{2,40}$/)).min(1).max(50) }),
    ]),
    checkin: isoDate,
    checkout: isoDate,
    rooms: z
      .array(z.object({ adults: z.number().int().min(1).max(6), childAges: z.array(z.number().int().min(0).max(17)).max(4) }))
      .min(1)
      .max(5),
    nationality: z.string().regex(/^[A-Z]{2}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    locale: z.enum(['tr', 'en']),
  })
  .superRefine((v, ctx) => {
    const nights = (Date.parse(`${v.checkout}T00:00:00Z`) - Date.parse(`${v.checkin}T00:00:00Z`)) / 86_400_000;
    if (!(nights >= 1 && nights <= 30)) ctx.addIssue({ code: 'custom', path: ['checkout'], message: 'stay must be 1-30 nights' });
  });
export type HotelSearchInput = z.infer<typeof hotelSearchInput>;

export const checkoutInput = z.object({
  quoteVersionId: z.uuid(),
  acceptTerms: z.literal(true),
  termsVersion: z.string().min(1).max(40),
  holder: z.object({
    firstName: name,
    lastName: name,
    email: z.email().max(200),
    phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'international format, e.g. +905321234567'),
  }),
  roomGuests: z.array(z.object({ occupancyNumber: z.number().int().min(1).max(5), firstName: name, lastName: name })).min(1).max(5),
  locale: z.enum(['tr', 'en']),
  idempotencyKey: z.string().regex(/^[\w-]{8,100}$/),
});
export type CheckoutInput = z.infer<typeof checkoutInput>;

/** Field-level validation error for forms (paths, never values). */
export class InputValidationError extends DomainError {
  readonly issues: ReadonlyArray<{ path: string; message: string }>;
  constructor(issues: ReadonlyArray<{ path: string; message: string }>) {
    super('VALIDATION_FAILED', 'Some fields are invalid', { httpStatus: 422, action: 'FIX_FIELDS' });
    this.issues = issues;
  }
}

export function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) throw new InputValidationError(r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}
