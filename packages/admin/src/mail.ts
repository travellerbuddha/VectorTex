import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTransport } from 'nodemailer';

/**
 * Outgoing e-mail for staff setup links (ADR-0010). Optional: without mail settings the panel shows the one-time link
 * to the person who created it, as before. Links in e-mails are built from PUBLIC_BASE_URL, never from the request.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** `delivered: false` covers refusals and lost answers alike: the caller falls back to handing the link over. */
export type MailResult = { delivered: true } | { delivered: false; reason: string };

export interface Mailer {
  readonly kind: 'SMTP' | 'MOCK';
  send(message: MailMessage): Promise<MailResult>;
}

/** SMTP (any provider: the business chooses the account). TLS is required except for a local test server. */
export class SmtpMailer implements Mailer {
  readonly kind = 'SMTP' as const;
  private readonly transport;
  constructor(
    url: string,
    private readonly from: string,
    opts: { requireTls: boolean },
  ) {
    this.transport = createTransport({ url, requireTLS: opts.requireTls, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 });
  }

  async send(m: MailMessage): Promise<MailResult> {
    try {
      const info = await this.transport.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
      if (info.rejected.length > 0) return { delivered: false, reason: 'recipient rejected' };
      return { delivered: true };
    } catch (err) {
      // Never the message body (it holds the one-time link) in errors or logs.
      return { delivered: false, reason: err instanceof Error ? err.name : 'send failed' };
    }
  }
}

/** MOCK: writes each message as JSON into a directory (tests only; refused in staging and production). */
export class MockDirMailer implements Mailer {
  readonly kind = 'MOCK' as const;
  private seq = 0;
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  async send(m: MailMessage): Promise<MailResult> {
    this.seq += 1;
    writeFileSync(join(this.dir, `${Date.now()}-${process.pid}-${this.seq}.json`), JSON.stringify(m));
    return { delivered: true };
  }
}

export interface MailSettings {
  mailer: Mailer;
  /** Origin used in links (https outside development/test). */
  publicBaseUrl: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * MAIL_SMTP_URL (smtp:// or smtps://, credentials in the URL) + MAIL_FROM + PUBLIC_BASE_URL, or MAIL_MOCK_DIR in
 * development/test. Returns null when no mail is configured. Throws on an incomplete or unsafe setup.
 */
export function mailSettingsFromEnv(env: Record<string, string | undefined>): MailSettings | null {
  const appEnv = env.APP_ENV ?? 'development';
  const relaxed = appEnv === 'development' || appEnv === 'test';
  const smtp = env.MAIL_SMTP_URL?.trim() ?? '';
  const mockDir = env.MAIL_MOCK_DIR?.trim() ?? '';
  if (smtp === '' && mockDir === '') return null;
  if (smtp !== '' && mockDir !== '') throw new Error('Set either MAIL_SMTP_URL or MAIL_MOCK_DIR, not both');

  const base = (env.PUBLIC_BASE_URL ?? '').trim().replace(/\/$/, '');
  let baseUrl: URL;
  try {
    baseUrl = new URL(base);
  } catch {
    throw new Error('PUBLIC_BASE_URL must be the site origin (e.g. https://www.texholiday.com) when e-mail is enabled');
  }
  if (!relaxed && baseUrl.protocol !== 'https:') throw new Error('PUBLIC_BASE_URL must use https outside development/test');
  if (baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) throw new Error('PUBLIC_BASE_URL must be an origin without a path');

  if (mockDir !== '') {
    if (!relaxed) throw new Error('MAIL_MOCK_DIR (MOCK mailer) is refused outside development/test');
    return { mailer: new MockDirMailer(mockDir), publicBaseUrl: baseUrl.origin };
  }

  let url: URL;
  try {
    url = new URL(smtp);
  } catch {
    throw new Error('MAIL_SMTP_URL must be smtp://user:password@host:port or smtps://…');
  }
  if (url.protocol !== 'smtp:' && url.protocol !== 'smtps:') throw new Error('MAIL_SMTP_URL must use smtp:// or smtps://');
  if (!relaxed && (url.username === '' || url.password === '')) throw new Error('MAIL_SMTP_URL needs the SMTP user and password outside development/test');
  const from = (env.MAIL_FROM ?? '').trim();
  if (!/^[^<>]*<[^@\s<>]+@[^@\s<>]+>$|^[^@\s<>]+@[^@\s<>]+$/.test(from)) throw new Error('MAIL_FROM must be an address, e.g. "TexHoliday <no-reply@texholiday.com>"');
  const localPlain = relaxed && LOCAL_HOSTS.has(url.hostname.replace(/^\[|\]$/g, ''));
  // smtps:// is TLS from the start; smtp:// must upgrade with STARTTLS unless it is a local test server.
  return { mailer: new SmtpMailer(smtp, from, { requireTls: url.protocol === 'smtp:' && !localPlain }), publicBaseUrl: baseUrl.origin };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export type StaffLinkPurpose = 'INVITE' | 'PASSWORD_RESET';

/**
 * The setup-link e-mail, in Turkish and English (staff language is not stored). Plain wording, the link once, its
 * expiry in Turkey time, and what to do if the mail was not expected.
 */
export function staffLinkMail(input: { to: string; displayName: string; url: string; expiresAt: string; purpose: StaffLinkPurpose; brand?: string }): MailMessage {
  const brand = input.brand ?? 'TexHoliday';
  const fmt = (locale: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul', timeZoneName: 'short' }).format(
      new Date(input.expiresAt),
    );
  const invite = input.purpose === 'INVITE';
  const tr = {
    subject: invite ? `${brand} Yönetim: hesabınızı kurun` : `${brand} Yönetim: yeni şifre belirleyin`,
    hello: `Merhaba ${input.displayName},`,
    body: invite
      ? `${brand} yönetim paneli hesabınız kullanıma hazır. Aşağıdaki bağlantıdan şifrenizi belirleyin ve telefonunuzdaki doğrulama uygulamasını kurun.`
      : 'Yönetim paneli hesabınız için yeni şifre belirleme bağlantısı oluşturuldu.',
    valid: `Bağlantı tek kullanımlıktır ve ${fmt('tr-TR')} tarihine kadar geçerlidir.`,
    unexpected: 'Bu e-postayı beklemiyorsanız bağlantıyı açmayın ve yöneticinize bildirin.',
  };
  const en = {
    subject: invite ? 'Set up your account' : 'Set a new password',
    hello: `Hello ${input.displayName},`,
    body: invite
      ? `Your ${brand} admin panel account is ready. Use the link below to set your password and the authenticator app on your phone.`
      : 'A link to set a new password for your admin panel account was created.',
    valid: `The link works once and is valid until ${fmt('en-GB')}.`,
    unexpected: 'If you did not expect this e-mail, do not open the link and tell your administrator.',
  };
  const text = [tr.hello, '', tr.body, '', input.url, '', tr.valid, tr.unexpected, '', '---', '', en.hello, '', en.body, '', input.url, '', en.valid, en.unexpected].join('\n');
  const section = (l: typeof tr) =>
    `<p>${escapeHtml(l.hello)}</p><p>${escapeHtml(l.body)}</p><p><a href="${escapeHtml(input.url)}">${escapeHtml(input.url)}</a></p><p>${escapeHtml(l.valid)}<br>${escapeHtml(l.unexpected)}</p>`;
  return {
    to: input.to,
    subject: `${tr.subject} / ${en.subject}`,
    text,
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">${section(tr)}<hr>${section(en)}</body></html>`,
  };
}
