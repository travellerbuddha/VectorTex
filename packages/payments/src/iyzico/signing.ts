import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { toMajor, type Money } from '@texholiday/pricing';

/**
 * IYZWSv2 Authorization header (provenance: SDK utils.generateHashV2):
 *   signature = hex(HMAC-SHA256(secretKey, randomKey + uriPath + requestBodyJson))
 *   header    = "IYZWSv2 " + base64("apiKey:<k>&randomKey:<r>&signature:<s>")
 * The exact body string that is signed is the one sent.
 */
export function authorizationHeader(apiKey: string, secretKey: string, uriPath: string, bodyJson: string, randomKey: string): string {
  const signature = createHmac('sha256', secretKey).update(randomKey + uriPath + bodyJson).digest('hex');
  const params = `apiKey:${apiKey}&randomKey:${randomKey}&signature:${signature}`;
  return `IYZWSv2 ${Buffer.from(params).toString('base64')}`;
}

export function randomKey(): string {
  return `${Date.now()}${randomBytes(8).toString('hex')}`;
}

/**
 * Price formatting as the official client sends it (utils.formatPrice): no trailing zeros, and at least
 * one decimal ("100" -> "100.0", "1.20" -> "1.2"). Done on the exact decimal string, never via float.
 */
export function formatPrice(m: Money): string {
  const major = toMajor(m);
  const [int, frac = ''] = major.split('.');
  const trimmed = frac.replace(/0+$/, '');
  return `${int}.${trimmed === '' ? '0' : trimmed}`;
}

/** Removes trailing zeros from a decimal string ("10.50" -> "10.5", "10.0" -> "10"), as iyzico signs prices. */
export function stripTrailingZeros(value: string): string {
  if (!/^-?\d+\.\d+$/.test(value)) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '');
}

/** Response signature: hex(HMAC-SHA256(secretKey, values.join(':'))). */
export function responseSignature(values: readonly string[], secretKey: string): string {
  return createHmac('sha256', secretKey).update(values.join(':')).digest('hex');
}

/**
 * Verifies a response signature. `exact(field)` returns the exact source text of numeric fields (never a
 * float rendering); price fields are compared without trailing zeros.
 */
export function verifyResponseSignature(
  body: Record<string, unknown>,
  fields: readonly string[],
  secretKey: string,
  exact: (field: string) => string | null,
  priceFields: ReadonlySet<string>,
): boolean {
  const provided = body.signature;
  if (typeof provided !== 'string' || !/^[0-9a-f]{64}$/i.test(provided)) return false;
  const values: string[] = [];
  for (const f of fields) {
    const raw = body[f];
    if (raw === undefined || raw === null) return false;
    let text = typeof raw === 'number' ? exact(f) : typeof raw === 'string' ? raw : null;
    if (text === null) return false;
    if (priceFields.has(f)) text = stripTrailingZeros(text);
    values.push(text);
  }
  const expected = responseSignature(values, secretKey);
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided.toLowerCase(), 'hex'));
}

/** Webhook V3 HPP signature: hex(HMAC-SHA256(secretKey, secretKey + v1 + v2 + ...)). */
export function webhookV3Signature(secretKey: string, values: readonly string[]): string {
  return createHmac('sha256', secretKey).update(secretKey + values.join('')).digest('hex');
}
