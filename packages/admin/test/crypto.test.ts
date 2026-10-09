import { describe, expect, it } from 'vitest';
import { adminSettingsFromEnv, base32Decode, base32Encode, hashPassword, hotp, open, otpauthUri, seal, totpStep, verifyPassword, verifyTotp } from '../src/index';

const rfcKey = Buffer.from('12345678901234567890', 'ascii');

describe('staff credential primitives (ADR-0010)', () => {
  it('HOTP matches RFC 4226 Appendix D', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expect(expected.map((_, i) => hotp(rfcKey, i))).toEqual(expected);
  });

  it('TOTP (SHA-1) matches RFC 6238 Appendix B', () => {
    const vectors: Array<[number, string]> = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [t, code] of vectors) expect(hotp(rfcKey, totpStep(new Date(t * 1000)), 8)).toBe(code);
  });

  it('base32 follows RFC 4648 (no padding) and round-trips', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Encode(Buffer.from('f'))).toBe('MY');
    expect(base32Decode('mzxw6ytboi').toString()).toBe('foobar');
    expect(() => base32Decode('MZ1')).toThrow();
  });

  it('a TOTP code is accepted within one step of drift, once', () => {
    const secret = base32Encode(rfcKey);
    const at = new Date(1_800_000_000_000);
    const step = totpStep(at);
    const code = hotp(rfcKey, step);
    expect(verifyTotp(secret, code, at, null)).toBe(step);
    expect(verifyTotp(secret, code, new Date(at.getTime() + 30_000), null)).toBe(step); // previous step still valid
    expect(verifyTotp(secret, code, new Date(at.getTime() + 61_000), null)).toBeNull(); // too old
    expect(verifyTotp(secret, code, at, step)).toBeNull(); // replay
    expect(verifyTotp(secret, '12a456', at, null)).toBeNull();
    expect(otpauthUri('TexHoliday', 'ayse@example.test', secret)).toBe(
      `otpauth://totp/TexHoliday:ayse%40example.test?secret=${secret}&issuer=TexHoliday&algorithm=SHA1&digits=6&period=30`,
    );
  });

  it('passwords are scrypt hashes with a random salt', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).toMatch(/^scrypt\$15\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('correct horse batterY', a)).toBe(false);
    expect(await verifyPassword('x', 'md5$abc')).toBe(false);
  });

  it('sealed secrets open only with the key and for their owner', () => {
    const key = Buffer.alloc(32, 7);
    const sealed = seal(key, 'JBSWY3DPEHPK3PXP', 'staff-mfa:a');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(open(key, sealed, 'staff-mfa:a')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => open(key, sealed, 'staff-mfa:b')).toThrow();
    expect(() => open(Buffer.alloc(32, 8), sealed, 'staff-mfa:a')).toThrow();
    const parts = sealed.split('.');
    parts[2] = Buffer.from('tampered').toString('base64url');
    expect(() => open(key, parts.join('.'), 'staff-mfa:a')).toThrow();
  });

  it('settings refuse a missing or short MFA key', () => {
    expect(() => adminSettingsFromEnv({})).toThrow(/STAFF_MFA_KEY/);
    expect(() => adminSettingsFromEnv({ STAFF_MFA_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/STAFF_MFA_KEY/);
    const s = adminSettingsFromEnv({ STAFF_MFA_KEY: Buffer.alloc(32, 1).toString('base64') });
    expect(s).toMatchObject({ sessionIdleMinutes: 30, sessionMaxHours: 12, lockoutAttempts: 5, minPasswordLength: 12 });
    expect(() => adminSettingsFromEnv({ STAFF_MFA_KEY: Buffer.alloc(32, 1).toString('base64'), STAFF_LOCKOUT_ATTEMPTS: '100' })).toThrow();
  });
});
