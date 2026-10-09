/**
 * Security settings of the staff panel (ADR-0010). These are technical controls, not business values: defaults follow
 * common guidance (NIST SP 800-63B: rate-limit failed attempts; sessions with idle and absolute limits) and can be
 * tightened per deployment.
 */
export interface AdminSettings {
  /** AES-256-GCM key sealing TOTP secrets (STAFF_MFA_KEY, base64, 32 bytes). Required everywhere. */
  mfaKey: Buffer;
  /** Name shown in authenticator apps. */
  mfaIssuer: string;
  sessionIdleMinutes: number;
  sessionMaxHours: number;
  /** Failed password/MFA attempts before the account locks, and for how long. */
  lockoutAttempts: number;
  lockoutMinutes: number;
  /** Validity of invite and password-reset links. */
  setupLinkHours: number;
  /** Shortest accepted password (no composition rules; NIST SP 800-63B). */
  minPasswordLength: number;
}

export function adminSettingsFromEnv(env: Record<string, string | undefined>): AdminSettings {
  const int = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
    return n;
  };
  const raw = env.STAFF_MFA_KEY ?? '';
  const key = Buffer.from(raw, 'base64');
  if (raw === '' || key.length !== 32 || key.toString('base64') !== raw) {
    throw new Error('STAFF_MFA_KEY must be 32 random bytes in base64 (e.g. `openssl rand -base64 32`)');
  }
  return {
    mfaKey: key,
    mfaIssuer: env.STAFF_MFA_ISSUER?.trim() || 'TexHoliday',
    sessionIdleMinutes: int('STAFF_SESSION_IDLE_MINUTES', 30, 5, 240),
    sessionMaxHours: int('STAFF_SESSION_MAX_HOURS', 12, 1, 24),
    lockoutAttempts: int('STAFF_LOCKOUT_ATTEMPTS', 5, 3, 20),
    lockoutMinutes: int('STAFF_LOCKOUT_MINUTES', 15, 1, 1440),
    setupLinkHours: int('STAFF_SETUP_LINK_HOURS', 72, 1, 168),
    minPasswordLength: int('STAFF_MIN_PASSWORD_LENGTH', 12, 12, 64),
  };
}
