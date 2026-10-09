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

/** Response signature: hex(HMAC-SHA256(secretKey, values.join(':'))), values stringified like the SDK. */
export function responseSignature(values: readonly unknown[], secretKey: string): string {
  return createHmac('sha256', secretKey).update(values.map((v) => String(v)).join(':')).digest('hex');
}

export function verifyResponseSignature(body: Record<string, unknown>, fields: readonly string[], secretKey: string): boolean {
  const provided = body.signature;
  if (typeof provided !== 'string' || !/^[0-9a-f]{64}$/i.test(provided)) return false;
  if (fields.some((f) => body[f] === undefined || body[f] === null)) return false;
  const expected = responseSignature(
    fields.map((f) => body[f]),
    secretKey,
  );
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided.toLowerCase(), 'hex'));
}
