import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { CoreDatabase } from '@texholiday/db';
import { adminSettingsFromEnv, base32Decode, hotp, StaffAuthService, totpStep } from '../src/index';
import { dbError, freshDatabase } from '../../db/test/support/db';

/** Staff sign-in with MFA against PostgreSQL (ADR-0010). The clock is controlled so TOTP codes are deterministic. */
const settings = adminSettingsFromEnv({ STAFF_MFA_KEY: Buffer.alloc(32, 3).toString('base64') });
const clock = { now: new Date('2027-01-04T09:00:00Z') };
const tick = (ms: number) => (clock.now = new Date(clock.now.getTime() + ms));
const codeFor = (secret: string, at = clock.now) => hotp(base32Decode(secret), totpStep(at));

let core: CoreDatabase;
let auth: StaffAuthService;
const secrets = new Map<string, string>();
const OWNER_PASSWORD = 'long-passphrase-for-ayse-2027';

/** Invite link -> password -> authenticator enrollment -> active session; returns the active token. */
async function onboard(token: string, password: string, key: string): Promise<string> {
  const setup = await auth.completeSetup(token, password, { userAgent: 'vitest' });
  expect(setup.stage).toBe('MFA_ENROLL');
  const { secret } = await auth.beginEnrollment(setup.token);
  secrets.set(key, secret);
  return (await auth.completeEnrollment(setup.token, codeFor(secret))).token;
}

beforeAll(async () => {
  core = await freshDatabase();
  auth = new StaffAuthService(core.db, settings, () => clock.now);
});
afterAll(async () => {
  await core?.close();
});

describe('staff sign-in with MFA', () => {
  let ownerId = '';
  let ownerToken = '';

  it('bootstrap creates the first owner once; the invite link sets the password and the authenticator', async () => {
    const boot = await auth.bootstrapOwner({ email: '  Owner@Example.TEST ', displayName: 'Ayşe Owner' });
    ownerId = boot.staffId;
    await expect(auth.bootstrapOwner({ email: 'other@example.test', displayName: 'Other' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await auth.setupInfo(boot.token)).toEqual({ email: 'owner@example.test', displayName: 'Ayşe Owner', purpose: 'INVITE' });
    await expect(auth.completeSetup(boot.token, 'short')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(auth.completeSetup(boot.token, 'xx-owner-is-my-password')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const setup = await auth.completeSetup(boot.token, OWNER_PASSWORD);
    expect(setup.stage).toBe('MFA_ENROLL');
    expect(await auth.setupInfo(boot.token)).toBeNull(); // one-time link
    // Before MFA the session exists but authorizes nothing.
    const pending = await auth.session(setup.token);
    expect(pending?.stage).toBe('MFA_ENROLL');
    expect(pending?.staff.permissions.size).toBe(0);

    const first = await auth.beginEnrollment(setup.token);
    const again = await auth.beginEnrollment(setup.token);
    expect(again.secret).toBe(first.secret); // a refresh shows the same QR code
    expect(first.uri).toMatch(/^otpauth:\/\/totp\/TexHoliday:owner%40example\.test\?secret=/);
    await expect(auth.completeEnrollment(setup.token, '000000')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    ownerToken = (await auth.completeEnrollment(setup.token, codeFor(first.secret))).token;
    secrets.set('owner', first.secret);

    expect(await auth.session(setup.token)).toBeNull(); // the token is re-issued on elevation
    const active = await auth.session(ownerToken);
    expect(active?.stage).toBe('ACTIVE');
    expect([...active!.staff.permissions].sort()).toEqual(
      ['content.edit', 'content.publish', 'orders.cancel', 'orders.record_refund', 'orders.view', 'orders.view_financials', 'permissions.manage', 'pricing_policy.edit', 'risk_policy.edit', 'staff.manage', 'tasks.manage'].sort(),
    );
  });

  it('sign-in: generic failure for unknown email or wrong password; MFA code once only', async () => {
    tick(60_000);
    await expect(auth.signIn('nobody@example.test', OWNER_PASSWORD)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(auth.signIn('owner@example.test', 'wrong-password-123')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const a = await auth.signIn('OWNER@example.test', OWNER_PASSWORD);
    expect(a.stage).toBe('MFA_REQUIRED');
    expect((await auth.session(a.token))?.staff.permissions.size).toBe(0);
    const code = codeFor(secrets.get('owner')!);
    const signedIn = await auth.verifyMfa(a.token, code);
    expect((await auth.session(signedIn.token))?.stage).toBe('ACTIVE');
    // The same code cannot open a second session (replay).
    const b = await auth.signIn('owner@example.test', OWNER_PASSWORD);
    await expect(auth.verifyMfa(b.token, code)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    tick(30_000);
    await auth.verifyMfa(b.token, codeFor(secrets.get('owner')!));
  });

  it('sessions end after the idle limit and at sign-out', async () => {
    tick(60_000);
    const a = await auth.signIn('owner@example.test', OWNER_PASSWORD);
    const { token } = await auth.verifyMfa(a.token, codeFor(secrets.get('owner')!));
    tick(settings.sessionIdleMinutes * 60_000 + 1000);
    expect(await auth.session(token)).toBeNull();
    tick(30_000);
    const b = await auth.signIn('owner@example.test', OWNER_PASSWORD);
    const s = await auth.verifyMfa(b.token, codeFor(secrets.get('owner')!));
    await auth.signOut(s.token);
    expect(await auth.session(s.token)).toBeNull();
    // Keep the owner's main session alive for the next tests.
    tick(30_000);
    const c = await auth.signIn('owner@example.test', OWNER_PASSWORD);
    ownerToken = (await auth.verifyMfa(c.token, codeFor(secrets.get('owner')!))).token;
  });

  it('invitations need staff.manage; an operator onboards with password + authenticator', async () => {
    const owner = { kind: 'STAFF' as const, id: ownerId };
    const inv = await auth.invite(owner, { email: 'Ops@Example.test', displayName: 'Mehmet Ops' });
    await expect(auth.invite(owner, { email: 'ops@example.test', displayName: 'Dup' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(auth.invite(owner, { email: 'not-an-email', displayName: 'X Y' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const opsToken = await onboard(inv.token, 'operations-passphrase-1', 'ops');
    const ops = await auth.session(opsToken);
    expect(ops?.staff.permissions.size).toBe(0); // no permission until someone grants one
    await expect(auth.invite({ kind: 'STAFF', id: inv.staffId }, { email: 'x@example.test', displayName: 'Nope' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const list = await auth.list(owner);
    expect(list.map((r) => [r.email, r.status, r.mfaEnrolled])).toEqual([
      ['owner@example.test', 'ACTIVE', true],
      ['ops@example.test', 'ACTIVE', true],
    ]);
  });

  it('wrong passwords lock the account for a while (no hint that it is locked)', async () => {
    tick(60_000);
    for (let i = 0; i < settings.lockoutAttempts; i += 1) {
      await expect(auth.signIn('ops@example.test', `wrong-guess-${i}-xxxx`)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }
    await expect(auth.signIn('ops@example.test', 'operations-passphrase-1')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const owner = { kind: 'STAFF' as const, id: ownerId };
    expect((await auth.list(owner)).find((r) => r.email === 'ops@example.test')?.locked).toBe(true);
    tick(settings.lockoutMinutes * 60_000 + 1000);
    expect((await auth.signIn('ops@example.test', 'operations-passphrase-1')).stage).toBe('MFA_REQUIRED');
  });

  it('lost phone: MFA reset ends sessions and forces a new enrollment; password links replace old ones', async () => {
    const owner = { kind: 'STAFF' as const, id: ownerId };
    const opsId = (await auth.list(owner)).find((r) => r.email === 'ops@example.test')!.id;
    tick(60_000);
    const before = await auth.signIn('ops@example.test', 'operations-passphrase-1');
    await auth.resetMfa(owner, opsId);
    expect(await auth.session(before.token)).toBeNull();
    const after = await auth.signIn('ops@example.test', 'operations-passphrase-1');
    expect(after.stage).toBe('MFA_ENROLL');

    const first = await auth.issuePasswordLink(owner, opsId);
    const second = await auth.issuePasswordLink(owner, opsId);
    expect(first.purpose).toBe('PASSWORD_RESET');
    expect(await auth.setupInfo(first.token)).toBeNull(); // replaced
    const reset = await auth.completeSetup(second.token, 'a-brand-new-passphrase');
    expect(reset.stage).toBe('MFA_ENROLL');
    expect(await auth.session(after.token)).toBeNull(); // other sessions end with a password reset
  });

  it('disabling: never oneself, never the last person who can grant permissions; sessions end', async () => {
    const owner = { kind: 'STAFF' as const, id: ownerId };
    await expect(auth.disable(owner, ownerId, 'test')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const inv = await auth.invite(owner, { email: 'admin2@example.test', displayName: 'Second Admin' });
    const admin2Token = await onboard(inv.token, 'second-admin-passphrase', 'admin2');
    const { PermissionRepository } = await import('@texholiday/db');
    await new PermissionRepository(core.db).grant(inv.staffId, 'staff.manage', owner);
    const admin2 = { kind: 'STAFF' as const, id: inv.staffId };
    // admin2 may manage accounts but the owner is the only active permissions manager.
    await expect(auth.disable(admin2, ownerId, 'leaving')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(auth.disable(owner, inv.staffId, '')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await auth.disable(owner, inv.staffId, 'test account');
    expect(await auth.session(admin2Token)).toBeNull();
    await expect(auth.signIn('admin2@example.test', 'second-admin-passphrase')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const back = await auth.enable(owner, inv.staffId);
    expect((await auth.setupInfo(back.token))?.purpose).toBe('INVITE');
  });

  it('recovery codes: created with a current authenticator code, each works once, a new batch replaces the old', async () => {
    const owner = secrets.get('owner')!;
    tick(60_000);
    const pw = await auth.signIn('owner@example.test', OWNER_PASSWORD);
    const active = (await auth.verifyMfa(pw.token, codeFor(owner))).token;
    expect(await auth.recoveryStatus(ownerId)).toEqual({ remaining: 0, createdAt: null });
    // Step-up: a wrong code, and the code just used to sign in (replay), are both refused.
    await expect(auth.generateRecoveryCodes(active, '000000')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(auth.generateRecoveryCodes(active, codeFor(owner))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    tick(30_000);
    const codes = await auth.generateRecoveryCodes(active, codeFor(owner));
    expect(codes).toHaveLength(10);
    for (const c of codes) expect(c).toMatch(/^[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}$/);
    expect((await auth.recoveryStatus(ownerId)).remaining).toBe(10);

    // Lost phone: password, then a recovery code (typed loosely) instead of the authenticator.
    const s1 = await auth.signIn('owner@example.test', OWNER_PASSWORD);
    const r1 = await auth.verifyRecoveryCode(s1.token, ` ${codes[0]!.toUpperCase().replace('-', ' ')} `);
    expect(r1.remaining).toBe(9);
    expect((await auth.session(r1.token))?.stage).toBe('ACTIVE');
    const s2 = await auth.signIn('owner@example.test', OWNER_PASSWORD);
    await expect(auth.verifyRecoveryCode(s2.token, codes[0]!)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); // once only
    await expect(auth.verifyRecoveryCode(s2.token, 'not-a-code')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    // A new batch makes the old unused codes stop working.
    tick(30_000);
    const fresh = await auth.generateRecoveryCodes(r1.token, codeFor(owner));
    const s3 = await auth.signIn('owner@example.test', OWNER_PASSWORD);
    await expect(auth.verifyRecoveryCode(s3.token, codes[1]!)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await auth.verifyRecoveryCode(s3.token, fresh[0]!)).remaining).toBe(9);

    // Only keyed hashes are stored; an MFA reset removes the unused codes with the authenticator.
    const stored = await core.db.execute<{ code_hash: string }>(sql`SELECT code_hash FROM core.staff_recovery_codes WHERE staff_id = ${ownerId}`);
    const all = stored.rows.map((r) => r.code_hash).join(' ');
    for (const c of [...codes, ...fresh]) expect(all).not.toContain(c.replace('-', ''));
    for (const c of [...codes, ...fresh]) secrets.set(`recovery-${c}`, c);
    const ownerActor = { kind: 'STAFF' as const, id: ownerId };
    const inv = await auth.invite(ownerActor, { email: 'recovery@example.test', displayName: 'Recovery Test' });
    const rcToken = await onboard(inv.token, 'spare-codes-test-passphrase', 'rc');
    tick(30_000);
    await auth.generateRecoveryCodes(rcToken, codeFor(secrets.get('rc')!));
    expect((await auth.recoveryStatus(inv.staffId)).remaining).toBe(10);
    await auth.resetMfa(ownerActor, inv.staffId);
    expect((await auth.recoveryStatus(inv.staffId)).remaining).toBe(0);
  });

  it('the audit trail records every step without passwords, codes, tokens or secrets', async () => {
    const rows = await core.db.execute<{ action: string; detail: unknown }>(sql`SELECT action, detail FROM core.audit_logs WHERE entity_type = 'staff' ORDER BY id`);
    const actions = rows.rows.map((r) => r.action);
    for (const a of ['staff.bootstrapped', 'staff.invite_accepted', 'staff.mfa_enrolled', 'staff.signed_in', 'staff.sign_in_failed', 'staff.locked', 'staff.mfa_reset', 'staff.disabled', 'staff.signed_out', 'staff.recovery_codes_created']) {
      expect(actions).toContain(a);
    }
    const text = JSON.stringify(rows.rows);
    for (const secret of [OWNER_PASSWORD, 'operations-passphrase-1', ...secrets.values()]) expect(text).not.toContain(secret);
    const stored = await core.db.execute<{ password_hash: string; mfa_secret: string }>(sql`SELECT password_hash, mfa_secret FROM core.staff_users WHERE id = ${ownerId}`);
    expect(stored.rows[0]!.password_hash).not.toContain(OWNER_PASSWORD);
    expect(stored.rows[0]!.mfa_secret).not.toContain(secrets.get('owner')!);
  });

  it('the database keeps emails normalized and active accounts with a password', async () => {
    expect(await dbError(core.db.execute(sql`INSERT INTO core.staff_users (email, display_name, status, created_by) VALUES ('Upper@Example.test', 'X', 'INVITED', 't')`))).toMatch(/staff_users_email_normalized/);
    expect(await dbError(core.db.execute(sql`INSERT INTO core.staff_users (email, display_name, status, created_by) VALUES ('a@example.test', 'X', 'ACTIVE', 't')`))).toMatch(/staff_users_active_has_password/);
  });
});
