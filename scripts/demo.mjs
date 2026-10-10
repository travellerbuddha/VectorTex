#!/usr/bin/env node
/**
 * LOCAL DEMO runner (docs/demo/LOKAL-DEMO.md). Windows, macOS and Linux; needs Docker Desktop, Node 22 and pnpm.
 *
 *   pnpm demo            services up, first-time setup (database, demo data), build when the code changed, start
 *   pnpm demo:kod        demo accounts, password and the current 6-digit sign-in codes
 *   pnpm demo:sifirla    wipe the demo database and set it up again
 *   pnpm demo:durdur     stop the demo services (data is kept)
 *
 * Everything stays on this computer: the site listens on 127.0.0.1 only, secrets are random per install and live in
 * .env.demo / .demo/ (both git-ignored). With a Nuitee SANDBOX key in .env.demo the demo uses real sandbox hotels and
 * the real payment component (test cards); without one it uses the MOCK provider.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = join(root, '.demo');
const envFile = join(root, '.env.demo');
const compose = ['compose', '-f', join(root, 'compose.demo.yaml')];
const isWin = process.platform === 'win32';
const SITE = 'http://localhost:3000';

const say = (msg) => console.log(`\x1b[36m[demo]\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\x1b[31m[demo] ${msg}\x1b[0m`);
  process.exit(1);
};

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: isWin, ...opts });
  if (r.status !== 0) fail(`Komut başarısız: ${cmd} ${args.join(' ')}`);
}

// ------------------------------------------------------------------ settings

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

function ensureEnvFile() {
  if (existsSync(envFile)) return;
  const readable = randomBytes(12).toString('base64').replace(/[+/=]/g, '').slice(0, 14);
  writeFileSync(
    envFile,
    [
      '# YEREL DEMO ayarları (pnpm demo). Bu dosya yalnız bu bilgisayar içindir; git’e girmez.',
      '# Gizli değerler kurulumda rastgele üretildi. Değiştirirseniz: pnpm demo:sifirla',
      `PAYLOAD_SECRET=${randomBytes(32).toString('hex')}`,
      `ORDER_ACCESS_SECRET=${randomBytes(32).toString('hex')}`,
      `STAFF_MFA_KEY=${randomBytes(32).toString('base64')}`,
      `DEMO_STAFF_PASSWORD=Demo-${readable}`,
      '',
      '# İsteğe bağlı: Nuitee SANDBOX anahtarı (Nuitee paneli → API keys → Sandbox). Boşsa demo MOCK otellerle çalışır.',
      '# Anahtarı girdikten sonra: pnpm demo:sifirla. Asla production anahtarı girmeyin.',
      'NUITEE_API_KEY=',
      '',
    ].join('\n'),
  );
  say('.env.demo oluşturuldu (rastgele gizli değerlerle).');
}

function demoEnv() {
  const file = parseEnv(readFileSync(envFile, 'utf8'));
  const key = (file.NUITEE_API_KEY ?? '').trim();
  const sandbox = key !== '';
  if (sandbox && /prod/i.test(file.NUITEE_KEY_ENVIRONMENT ?? '')) fail('Demo yalnız Nuitee SANDBOX anahtarıyla çalışır.');
  return {
    ...process.env,
    APP_ENV: 'development',
    PROVIDER_ENV: sandbox ? 'sandbox' : 'mock',
    ALLOW_MOCK_ADAPTERS: sandbox ? 'false' : 'true',
    ...(sandbox ? { ENABLED_PROVIDERS: 'nuitee', NUITEE_API_KEY: key, NUITEE_KEY_ENVIRONMENT: 'sandbox', SANDBOX_SKIP_RATE_PARITY: 'true' } : {}),
    PAYLOAD_ENABLED: 'true',
    PAYLOAD_SECRET: file.PAYLOAD_SECRET,
    CMS_MEDIA_DIR: join(stateDir, 'media'),
    DATABASE_URL: 'postgres://texholiday:texholiday_demo_local@127.0.0.1:55432/texholiday_demo',
    REDIS_URL: 'redis://127.0.0.1:56379/0',
    ORDER_ACCESS_SECRET: file.ORDER_ACCESS_SECRET,
    STAFF_MFA_KEY: file.STAFF_MFA_KEY,
    MAIL_SMTP_URL: 'smtp://127.0.0.1:1025',
    MAIL_FROM: 'TexHoliday Demo <demo@texholiday.test>',
    MAIL_BRAND: 'TexHoliday',
    PUBLIC_BASE_URL: SITE,
    TERMS_VERSION: 'demo-terms-1',
    POLICY_ID: 'b2c',
    SALE_CURRENCIES: 'EUR,USD,GBP,TRY',
    NEXT_TELEMETRY_DISABLED: '1',
    DEMO_STATE_DIR: stateDir,
    DEMO_STAFF_PASSWORD: file.DEMO_STAFF_PASSWORD,
    // MOCK only: the site, the worker and the seed share one MOCK "provider" (prebooks, payments, bookings), as they
    // share the real provider outside the demo.
    ...(sandbox ? {} : { MOCK_STATE_DIR: join(stateDir, 'mock-provider') }),
  };
}

// ------------------------------------------------------------------ steps

function checkTools() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 22) fail(`Node 22 gerekli (şu an ${process.versions.node}). https://nodejs.org → 22 LTS`);
  const docker = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore', shell: isWin });
  if (docker.status !== 0) fail('Docker bulunamadı ya da çalışmıyor. Docker Desktop’ı kurup açın: https://www.docker.com/products/docker-desktop/');
}

function servicesUp() {
  say('Veritabanı, Redis ve e-posta görüntüleyici başlatılıyor (Docker)...');
  run('docker', [...compose, 'up', '-d', '--wait']);
}

function gitHead() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', shell: isWin });
  const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8', shell: isWin });
  return r.status === 0 ? `${r.stdout.trim()}${dirty.stdout?.trim() ? '+local' : ''}` : null;
}

function setupOnce(env) {
  const marker = join(stateDir, 'kuruldu.json');
  if (existsSync(marker)) {
    const was = JSON.parse(readFileSync(marker, 'utf8'));
    if (was.provider !== env.PROVIDER_ENV) fail(`Demo ${was.provider} için kurulmuş; şimdi ${env.PROVIDER_ENV}. Geçmek için: pnpm demo:sifirla`);
    // After a code update: only the new migrations are applied, the demo data stays.
    say('Veritabanı güncel mi bakılıyor...');
    run('pnpm', ['db:migrate'], { env });
    run('pnpm', ['--filter', '@texholiday/web', 'cms:migrate'], { env });
    return;
  }
  mkdirSync(stateDir, { recursive: true });
  // No marker = setup never finished (first run, or one that stopped half-way): start from an empty demo database.
  wipeDatabase();
  say('İlk kurulum: veritabanı tabloları...');
  run('pnpm', ['db:migrate'], { env });
  run('pnpm', ['--filter', '@texholiday/web', 'cms:migrate'], { env });
  say(`Demo verileri yükleniyor (${env.PROVIDER_ENV === 'mock' ? 'MOCK oteller' : 'Nuitee sandbox'})...`);
  run('pnpm', ['--filter', '@texholiday/web', 'exec', 'tsx', 'src/scripts/demo-seed.ts'], { env });
  writeFileSync(marker, JSON.stringify({ provider: env.PROVIDER_ENV, at: new Date().toISOString() }));
}

function wipeDatabase() {
  run('docker', [...compose, 'exec', '-T', 'postgres', 'psql', '-q', '-U', 'texholiday', '-d', 'texholiday_demo', '-c', 'DROP SCHEMA IF EXISTS core CASCADE; DROP SCHEMA IF EXISTS cms CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE;']);
  run('docker', [...compose, 'exec', '-T', 'redis', 'redis-cli', 'FLUSHALL'], { stdio: 'ignore' });
  for (const f of ['kuruldu.json', 'hesaplar.json']) rmSync(join(stateDir, f), { force: true });
  rmSync(join(stateDir, 'media'), { recursive: true, force: true });
}

function buildIfNeeded(env) {
  const stamp = join(stateDir, 'derleme.txt');
  const head = gitHead();
  const built = existsSync(join(root, 'apps/web/.next/BUILD_ID'));
  const same = head !== null && !head.endsWith('+local') && existsSync(stamp) && readFileSync(stamp, 'utf8') === head;
  if (built && same) return;
  say('Site derleniyor (ilk seferde ve kod değiştiğinde; birkaç dakika sürer)...');
  run('pnpm', ['--filter', '@texholiday/web', 'build'], { env });
  if (head) writeFileSync(stamp, head);
}

function start(env) {
  const procs = [];
  const launch = (name, color, args) => {
    const p = spawn('pnpm', args, { cwd: root, env, shell: isWin });
    const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
    const pipe = (stream, out) => {
      let buf = '';
      stream.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? '';
        for (const l of lines) out.write(`${prefix}${l}\n`);
      });
    };
    pipe(p.stdout, process.stdout);
    pipe(p.stderr, process.stderr);
    p.on('exit', (code) => {
      if (!stopping) {
        console.error(`${prefix}durdu (kod ${code}). Demo kapatılıyor.`);
        stop();
      }
    });
    procs.push(p);
  };
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const p of procs) {
      if (isWin) spawnSync('taskkill', ['/pid', String(p.pid), '/t', '/f'], { stdio: 'ignore' });
      else p.kill('SIGINT');
    }
    setTimeout(() => process.exit(0), 1500);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  launch('site', '32', ['--filter', '@texholiday/web', 'exec', 'next', 'start', '--port', '3000', '--hostname', '127.0.0.1']);
  launch('worker', '35', ['worker']);
  setTimeout(() => banner(env), 4000);
}

function banner(env) {
  console.log(`
\x1b[1mTexHoliday yerel demo çalışıyor\x1b[0m  (${env.PROVIDER_ENV === 'mock' ? 'MOCK oteller' : 'Nuitee SANDBOX'})

  Site (TR)            ${SITE}/tr
  Otel listeleri       ${SITE}/tr/oteller
  Yönetim paneli       ${SITE}/yonetim
  E-postalar (Mailpit) http://localhost:8025

  Panel hesapları, parola ve giriş kodları:  pnpm demo:kod
  ${env.PROVIDER_ENV === 'mock' ? 'MOCK ödeme: ödeme sayfasındaki "MOCK: ödemeyi tamamla" düğmesi.' : 'Sandbox ödeme: test kartı 4242 4242 4242 4242, ileri bir tarih, CVC 123.'}
  Durdurmak için: Ctrl+C   (servisleri de kapatmak için ardından: pnpm demo:durdur)
`);
}

// ------------------------------------------------------------------ authenticator codes

function base32Decode(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}

function codes() {
  const file = join(stateDir, 'hesaplar.json');
  if (!existsSync(file)) fail('Demo henüz kurulmadı: pnpm demo');
  const s = JSON.parse(readFileSync(file, 'utf8'));
  const left = 30 - Math.floor((Date.now() / 1000) % 30);
  console.log(`\nPanel: ${SITE}/yonetim   Parola (tüm hesaplar): ${s.password}\n`);
  for (const a of s.accounts) console.log(`  ${a.email.padEnd(34)} ${a.role.padEnd(26)} kod: \x1b[1m${totp(a.secret)}\x1b[0m`);
  console.log(`\nKodlar ${left} sn daha geçerli; sonra komutu yeniden çalıştırın.`);
  console.log('Telefonla kullanmak isterseniz: Google/Microsoft Authenticator → anahtar ile ekle → aşağıdaki anahtar:');
  for (const a of s.accounts) console.log(`  ${a.email.padEnd(34)} ${a.secret}`);
  console.log('');
}

// ------------------------------------------------------------------ commands

const cmd = process.argv[2] ?? 'baslat';
if (cmd === 'kod') {
  codes();
} else if (cmd === 'durdur') {
  checkTools();
  run('docker', [...compose, 'stop']);
  say('Demo servisleri durduruldu (veriler saklı).');
} else if (cmd === 'sifirla') {
  checkTools();
  ensureEnvFile();
  servicesUp();
  say('Demo veritabanı siliniyor...');
  rmSync(join(stateDir, 'kuruldu.json'), { force: true });
  rmSync(join(stateDir, 'mock-provider'), { recursive: true, force: true });
  const env = demoEnv();
  setupOnce(env);
  say('Sıfırlandı. Başlatmak için: pnpm demo');
} else if (cmd === 'baslat') {
  checkTools();
  ensureEnvFile();
  servicesUp();
  const env = demoEnv();
  setupOnce(env);
  buildIfNeeded(env);
  start(env);
} else {
  fail(`Bilinmeyen komut: ${cmd} (baslat | kod | sifirla | durdur)`);
}
