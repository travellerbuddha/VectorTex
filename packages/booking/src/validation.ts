import { z } from 'zod';
import { DomainError, HOTEL_BOARD_TYPES } from '@texholiday/contracts';

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
    /** Only rates of this board type (an "all inclusive" list's price must be findable, ADR-0014). */
    boardType: z.enum(HOTEL_BOARD_TYPES).optional(),
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

const iata = z.string().regex(/^[A-Z]{3}$/, 'IATA airport code, e.g. IST');
const country = z.string().regex(/^[A-Z]{2}$/, 'ISO country code');

/** Flight search: one way or return; ages per IATA (children 2-11, infants under 2), at most 9 seated passengers. */
export const flightSearchInput = z
  .object({
    origin: iata,
    destination: iata,
    departDate: isoDate,
    returnDate: isoDate.nullable(),
    adults: z.number().int().min(1).max(9),
    childAges: z.array(z.number().int().min(2).max(11)).max(8),
    infantAges: z.array(z.number().int().min(0).max(1)).max(4),
    cabinClass: z.enum(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']).nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    locale: z.enum(['tr', 'en']),
  })
  .superRefine((v, ctx) => {
    if (v.origin === v.destination) ctx.addIssue({ code: 'custom', path: ['destination'], message: 'origin and destination must differ' });
    if (v.returnDate !== null && v.returnDate < v.departDate) ctx.addIssue({ code: 'custom', path: ['returnDate'], message: 'return must not be before departure' });
    if (v.adults + v.childAges.length > 9) ctx.addIssue({ code: 'custom', path: ['childAges'], message: 'at most 9 seated passengers' });
    // "number of infants cannot exceed number of adults" (provider 41012).
    if (v.infantAges.length > v.adults) ctx.addIssue({ code: 'custom', path: ['infantAges'], message: 'one infant per adult at most' });
  });
export type FlightSearchInput = z.infer<typeof flightSearchInput>;

const document = z.object({
  type: z.enum(['passport', 'id_card']),
  number: z.string().trim().regex(/^[A-Za-z0-9]{5,20}$/, '5-20 letters or digits'),
  issuingCountry: country,
  expiresOn: isoDate,
});

/**
 * Flight checkout. Names exactly as on the travel document; the document is asked on every flight (business decision,
 * ADR-0012) and is sent to the provider without being stored.
 */
export const flightCheckoutInput = z.object({
  quoteVersionId: z.uuid(),
  acceptTerms: z.literal(true),
  termsVersion: z.string().min(1).max(40),
  contact: z.object({
    firstName: name,
    lastName: name,
    email: z.email().max(200),
    phoneCountryCode: z.string().regex(/^[1-9]\d{0,3}$/, 'digits, e.g. 90'),
    phoneNumber: z.string().regex(/^\d{6,14}$/, 'digits only'),
  }),
  passengers: z
    .array(
      z.object({
        type: z.enum(['ADULT', 'CHILD', 'INFANT']),
        firstName: name,
        lastName: name,
        birthDate: isoDate,
        gender: z.enum(['M', 'F']),
        nationality: country,
        document,
      }),
    )
    .min(1)
    .max(13),
  locale: z.enum(['tr', 'en']),
  idempotencyKey: z.string().regex(/^[\w-]{8,100}$/),
});
export type FlightCheckoutInput = z.infer<typeof flightCheckoutInput>;

/** Seats/bags picked on the extras page, with the total the customer saw (ADR-0013). */
export const flightServicesInput = z.object({
  selections: z
    .array(z.object({ passengerIndex: z.number().int().min(0).max(12), key: z.string().regex(/^[0-9a-f]{20}$/) }))
    .min(1)
    .max(60),
  expectedTotal: z.object({ currency: z.string().regex(/^[A-Z]{3}$/), minor: z.string().regex(/^\d{1,15}$/) }),
});

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
