/**
 * Structured logs without personal data or secrets (§17, T31). Every log line goes through `redact`:
 *
 * - Fields whose name says what they hold (password, token, secret, e-mail, phone, guest/holder/passenger names, card,
 *   document, birth date, cookie, authorization…) are replaced by "[REDACTED]", at any depth.
 * - In free text (error messages, provider answers) e-mail addresses, phone numbers, card-like digit runs, IBANs,
 *   bearer/API keys and long token-like strings are masked; a database error's "params:" tail (query values, which
 *   can be customer data) is cut off.
 *
 * Masking is deliberately broad: a lost digit in a log is cheap, a leaked guest e-mail or key is not.
 */
export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export const REDACTED = '[REDACTED]';

/** Field names (case- and separator-insensitive) whose values are never logged. */
const SENSITIVE_KEY =
  /^(pass(word)?|pwd|secret|.*secret|.*token|token|api_?key|.*apikey|authorization|auth|cookie|set_?cookie|session|.*session_?id|e?mail|email_?address|to|phone|mobile|tel|telephone|first_?name|last_?name|full_?name|surname|given_?name|holder|guests?|room_?guests|passengers?|travell?ers?|document|documents|passport|passport_?number|id_?number|national_?id|tckn|tc_?kimlik|birth_?date|date_?of_?birth|dob|card|card_?number|pan|cvc|cvv|iban|account_?number|address_?line|street|ip|client_?ip|remote_?addr|otp|code_?hash|totp|mfa_?secret|recovery_?codes?)$/i;

const normalizeKey = (k: string) => k.replace(/[-\s.]/g, '_');

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(normalizeKey(key));
}

const TEXT_RULES: ReadonlyArray<[RegExp, string]> = [
  // Database errors carry the query values after "params:" (Drizzle): customer data, never logged.
  [/\bparams:[\s\S]*$/i, 'params: [REDACTED]'],
  // Authorization headers and key=value secrets.
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [REDACTED]'],
  [/\b(api[_-]?key|x-api-key|token|secret|password|passwd|pwd|authorization|cookie)\s*[:=]\s*("?)[^\s",;&]+\2/gi, '$1=[REDACTED]'],
  // Provider keys like sand_xxxx / prod_xxxx and JWT-like tokens.
  [/\b(sand|prod|live|test|sk|pk)_[A-Za-z0-9-]{12,}\b/g, '[KEY]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[TOKEN]'],
  // E-mail addresses.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]'],
  // IBANs (TR and others).
  [/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/g, '[IBAN]'],
  // Card-like digit runs (13-19 digits, optionally grouped).
  [/\b\d(?:[ -]?\d){12,18}\b/g, '[NUMBER]'],
  // Phone numbers: international or long local digit runs (also Turkish ID numbers: 11 digits).
  [/\+\d[\d\s().-]{7,}\d/g, '[PHONE]'],
  [/\b\d{10,12}\b/g, '[NUMBER]'],
  // Long opaque strings (session tokens, setup links, HMACs).
  [/\b[A-Za-z0-9_-]{40,}\b/g, '[TOKEN]'],
];

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Masks personal data and secrets in free text. Ids (UUIDs) stay readable: operations need them. */
export function redactText(text: string): string {
  const ids: string[] = [];
  let out = text.replace(UUID, (m) => `\u0000${ids.push(m) - 1}\u0000`);
  for (const [re, replacement] of TEXT_RULES) out = out.replace(re, replacement);
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => ids[Number(i)] ?? '');
  return out.length > 2000 ? `${out.slice(0, 2000)}…` : out;
}

/** A copy of `value` safe to log: sensitive fields replaced, text masked, cycles and depth bounded. */
export function redact(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: errorMessage(value) };
  if (depth >= 6) return '[…]';
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1, seen));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) && v !== null && v !== undefined ? REDACTED : redact(v, depth + 1, seen);
    }
    return out;
  }
  return String(value);
}

/** The message of an error (and its cause), masked. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause instanceof Error && err.cause.message && !err.message.includes(err.cause.message) ? ` (cause: ${err.cause.message})` : '';
    return redactText(`${err.message}${cause}`);
  }
  return redactText(String(err));
}

type Sink = Pick<Console, 'log' | 'warn' | 'error'>;

/** One JSON line per entry, everything redacted; `base` fields (e.g. the service) go on every line. */
export function jsonLogger(base: Record<string, unknown> = {}, sink: Sink = console): Logger {
  const line = (level: 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>) =>
    JSON.stringify({ level, time: new Date().toISOString(), ...base, msg: redactText(msg), ...(meta ? (redact(meta) as Record<string, unknown>) : {}) });
  return {
    info: (msg, meta) => sink.log(line('info', msg, meta)),
    warn: (msg, meta) => sink.warn(line('warn', msg, meta)),
    error: (msg, meta) => sink.error(line('error', msg, meta)),
  };
}
