import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Order access for guest checkout (no account needed, §15). The token is an HMAC of the order id, so it is never
 * stored and a lost checkout response can be replayed safely. It travels in an httpOnly cookie, not in URLs.
 */
export function orderAccessToken(secret: string, orderId: string): string {
  return createHmac('sha256', secret).update(`order:${orderId}`).digest('base64url');
}

export function canAccessOrder(secret: string, orderId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const expected = Buffer.from(orderAccessToken(secret, orderId));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
