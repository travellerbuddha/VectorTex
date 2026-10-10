import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mailSettingsFromEnv, staffLinkMail } from '../src/index';

/** A minimal local SMTP server (TEST DOUBLE): accepts one message per session and keeps the raw DATA. */
function smtpServer(): Promise<{ server: Server; port: number; messages: string[] }> {
  const messages: string[] = [];
  const server = createServer((socket) => {
    let data = false;
    let buf = '';
    socket.write('220 localhost test\r\n');
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (data) {
        const end = buf.indexOf('\r\n.\r\n');
        if (end === -1) return;
        messages.push(buf.slice(0, end));
        buf = buf.slice(end + 5);
        data = false;
        socket.write('250 queued\r\n');
      }
      let nl: number;
      while (!data && (nl = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') socket.write('250-localhost\r\n250 8BITMIME\r\n');
        else if (cmd === 'DATA') {
          data = true;
          socket.write('354 go\r\n');
        } else if (cmd === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port, messages })));
}

const BASE = { APP_ENV: 'test', PUBLIC_BASE_URL: 'http://127.0.0.1:3100' };
let smtp: Awaited<ReturnType<typeof smtpServer>>;
beforeAll(async () => {
  smtp = await smtpServer();
});
afterAll(() => smtp.server.close());

describe('staff setup-link e-mail (ADR-0010)', () => {
  it('no mail settings: null (the panel hands the link over itself)', () => {
    expect(mailSettingsFromEnv({ APP_ENV: 'production' })).toBeNull();
  });

  it('refuses unsafe or incomplete setups', () => {
    const prod = { APP_ENV: 'production', PUBLIC_BASE_URL: 'https://www.texholiday.example', MAIL_FROM: 'TexHoliday <no-reply@texholiday.example>' };
    expect(() => mailSettingsFromEnv({ ...prod, MAIL_MOCK_DIR: '/tmp/x' })).toThrow(/MOCK mailer\) is refused/);
    expect(() => mailSettingsFromEnv({ ...prod, MAIL_SMTP_URL: 'smtps://mail.example:465' })).toThrow(/user and password/);
    expect(() => mailSettingsFromEnv({ ...prod, MAIL_SMTP_URL: 'http://u:p@mail.example' })).toThrow(/smtp:\/\/ or smtps:\/\//);
    expect(() => mailSettingsFromEnv({ ...prod, PUBLIC_BASE_URL: 'http://www.texholiday.example', MAIL_SMTP_URL: 'smtps://u:p@mail.example:465' })).toThrow(/https/);
    expect(() => mailSettingsFromEnv({ ...prod, PUBLIC_BASE_URL: 'https://x.example/tr', MAIL_SMTP_URL: 'smtps://u:p@mail.example:465' })).toThrow(/origin/);
    expect(() => mailSettingsFromEnv({ ...prod, MAIL_FROM: 'nobody', MAIL_SMTP_URL: 'smtps://u:p@mail.example:465' })).toThrow(/MAIL_FROM/);
    expect(() => mailSettingsFromEnv({ ...BASE, MAIL_SMTP_URL: 'smtp://127.0.0.1:25', MAIL_MOCK_DIR: '/tmp/x' })).toThrow(/not both/);
    expect(mailSettingsFromEnv({ ...prod, MAIL_SMTP_URL: 'smtps://u:p@mail.example:465' })).toMatchObject({ mailer: { kind: 'SMTP' }, publicBaseUrl: 'https://www.texholiday.example' });
  });

  it('the message: both languages, the link once per language, names escaped in HTML, expiry in Turkey time', () => {
    const m = staffLinkMail({ to: 'a@b.example', displayName: 'Ayşe <script>', url: 'https://x.example/yonetim/kurulum/TOKEN', expiresAt: '2026-10-12T09:00:00Z', purpose: 'INVITE' });
    expect(m.subject).toBe('TexHoliday Yönetim: hesabınızı kurun / Set up your account');
    expect(m.text.split('https://x.example/yonetim/kurulum/TOKEN')).toHaveLength(3);
    expect(m.text).toContain('12 Ekim 2026 12:00');
    expect(m.html).toContain('Ayşe &lt;script&gt;');
    expect(m.html).not.toContain('<script>');
  });

  it('sends over SMTP to a local server (plaintext only for local test servers)', async () => {
    const s = mailSettingsFromEnv({ ...BASE, MAIL_SMTP_URL: `smtp://127.0.0.1:${smtp.port}`, MAIL_FROM: 'TexHoliday <no-reply@texholiday.example>' })!;
    const r = await s.mailer.send(staffLinkMail({ to: 'staff@texholiday.example', displayName: 'Ali', url: `${s.publicBaseUrl}/yonetim/kurulum/T0K3N`, expiresAt: '2026-10-12T09:00:00Z', purpose: 'PASSWORD_RESET' }));
    expect(r).toEqual({ delivered: true });
    expect(smtp.messages).toHaveLength(1);
    expect(smtp.messages[0]).toContain('To: staff@texholiday.example');
    expect(smtp.messages[0]).toContain('/yonetim/kurulum/T0K3N');
  });

  it('a failed send reports not delivered without the message body', async () => {
    const s = mailSettingsFromEnv({ ...BASE, MAIL_SMTP_URL: 'smtp://127.0.0.1:1', MAIL_FROM: 'no-reply@texholiday.example' })!;
    const r = await s.mailer.send(staffLinkMail({ to: 'x@y.example', displayName: 'X', url: 'https://x.example/yonetim/kurulum/SECRET', expiresAt: '2026-10-12T09:00:00Z', purpose: 'INVITE' }));
    expect(r.delivered).toBe(false);
    expect(JSON.stringify(r)).not.toContain('SECRET');
  });

  it('MOCK mailer writes messages to a directory (development/test only)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'th-mail-'));
    const s = mailSettingsFromEnv({ ...BASE, MAIL_MOCK_DIR: dir })!;
    expect(s.mailer.kind).toBe('MOCK');
    await s.mailer.send({ to: 'a@b.example', subject: 's', text: 't', html: 'h' });
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, files[0]!), 'utf8'))).toMatchObject({ to: 'a@b.example' });
  });
});
