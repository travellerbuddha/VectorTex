import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Credential primitives for staff sign-in (ADR-0010). Only node:crypto; no hand-rolled ciphers.
 * - Passwords: scrypt (N=2^15, r=8, p=1, 32-byte key, 16-byte salt), stored as `scrypt$15$8$1$<salt>$<key>`.
 * - Tokens: 32 random bytes (base64url); only their SHA-256 is stored.
 * - TOTP (RFC 6238 over RFC 4226 HOTP): HMAC-SHA1, 30-second steps, 6 digits, base32 secrets (RFC 4648).
 * - Sealing: AES-256-GCM with a 12-byte random IV; the additional data binds a sealed value to its owner.
 */

const SCRYPT = { log2N: 15, r: 8, p: 1, keyLength: 32, saltLength: 16 } as const;

function scryptAsync(password: string, salt: Buffer, log2N: number, r: number, p: number, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keyLength, { N: 2 ** log2N, r, p, maxmem: 128 * 2 ** log2N * r * 2 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT.saltLength);
  const key = await scryptAsync(password, salt, SCRYPT.log2N, SCRYPT.r, SCRYPT.p, SCRYPT.keyLength);
  return ['scrypt', SCRYPT.log2N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [log2N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (![log2N, r, p].every((n) => Number.isInteger(n) && n > 0) || log2N > 20) return false;
  const salt = Buffer.from(parts[4]!, 'base64url');
  const expected = Buffer.from(parts[5]!, 'base64url');
  const key = await scryptAsync(password, salt, log2N, r, p, expected.length);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export const randomToken = (): string => randomBytes(32).toString('base64url');
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

// ------------------------------------------------------------------ recovery codes

/** Crockford base32 (no i, l, o, u): codes are read off paper and typed by hand. */
const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';
const RECOVERY_LENGTH = 10;

/** `count` one-time recovery codes of 10 Crockford characters (50 random bits each), shown as `xxxxx-xxxxx`. */
export function newRecoveryCodes(count = 10): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const bytes = randomBytes(RECOVERY_LENGTH);
    // 256 is a multiple of 32: taking the low 5 bits of each byte is uniform.
    const raw = [...bytes].map((b) => CROCKFORD[b & 31]).join('');
    codes.add(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return [...codes];
}

/** What the person typed -> the canonical code, or null. Case, spaces and dashes are ignored; i/l read as 1, o as 0. */
export function normalizeRecoveryCode(text: string): string | null {
  const t = String(text ?? '')
    .toLowerCase()
    .replace(/[\s-]/g, '')
    .replace(/[il]/g, '1')
    .replace(/o/g, '0');
  if (t.length !== RECOVERY_LENGTH || [...t].some((c) => !CROCKFORD.includes(c))) return null;
  return t;
}

/** Keyed hash of a recovery code, bound to one account: a database copy alone does not allow guessing codes. */
export function recoveryCodeHash(key: Buffer, staffId: string, normalized: string): string {
  return createHmac('sha256', key).update(`staff-recovery:${staffId}:${normalized}`).digest('hex');
}

// ------------------------------------------------------------------ base32 (RFC 4648, no padding)

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ------------------------------------------------------------------ TOTP

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

/** RFC 4226 HOTP with dynamic truncation. */
export function hotp(key: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const totpStep = (at: Date): number => Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);

/** A new 160-bit TOTP secret, base32 encoded (the length RFC 4226 recommends for SHA-1). */
export const newTotpSecret = (): string => base32Encode(randomBytes(20));

/**
 * Checks a code against the current step and one step either side (clock drift). Steps at or before `lastStep` are
 * refused, so a code works once. Returns the accepted step or null.
 */
export function verifyTotp(secret: string, code: string, at: Date, lastStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secret);
  const now = totpStep(at);
  let accepted: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(hotp(key, step));
    // Compare every candidate (no early exit on a match) so timing does not reveal which step matched.
    if (timingSafeEqual(expected, Buffer.from(code)) && accepted === null) accepted = step;
  }
  return accepted;
}

/** Key URI understood by authenticator apps (Google/Microsoft Authenticator...). */
export function otpauthUri(issuer: string, account: string, secret: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

// ------------------------------------------------------------------ sealing (AES-256-GCM)

export function seal(key: Buffer, plaintext: string, owner: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(owner));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), ct.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

/** Opens a sealed value; throws if it was altered or belongs to another owner. */
export function open(key: Buffer, sealed: string, owner: string): string {
  const [v, iv, ct, tag] = sealed.split('.');
  if (v !== 'v1' || !iv || !ct || !tag) throw new Error('unknown sealed format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(owner));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
