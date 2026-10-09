import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { DomainError, type Permission, type StaffActor } from '@texholiday/contracts';
import { activePermissions, PermissionRepository, schema, type CoreDb } from '@texholiday/db';
import { hashPassword, newTotpSecret, open, otpauthUri, randomToken, seal, sha256, verifyPassword, verifyTotp } from './crypto';
import type { AdminSettings } from './settings';

const { auditLogs, staffSessions, staffSetupTokens, staffUsers } = schema;

export type SessionStage = 'MFA_REQUIRED' | 'MFA_ENROLL' | 'ACTIVE';

export interface StaffIdentity {
  id: string;
  email: string;
  displayName: string;
  /** Empty until the session passed MFA: nothing is authorized before that. */
  permissions: ReadonlySet<Permission>;
}

export interface StaffSessionView {
  stage: SessionStage;
  staff: StaffIdentity;
}

export interface StaffAccountRow {
  id: string;
  email: string;
  displayName: string;
  status: 'INVITED' | 'ACTIVE' | 'DISABLED';
  mfaEnrolled: boolean;
  locked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** One message for every sign-in failure: never reveals whether the email, password, code or lock was the cause. */
const unauthenticated = () => new DomainError('UNAUTHENTICATED', 'Sign-in failed or expired', { httpStatus: 401, action: 'SIGN_IN' });
const forbidden = (message: string) => new DomainError('FORBIDDEN', message, { httpStatus: 403 });
const invalid = (message: string) => new DomainError('VALIDATION_FAILED', message, { httpStatus: 422, action: 'FIX_FIELDS' });
const notFound = () => new DomainError('NOT_FOUND', 'Not found', { httpStatus: 404 });

const ACTOR_SELF = (id: string) => `staff:${id}`;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,63}$/;
/** Owner of sealed secrets: binds a TOTP secret to one account. */
const owner = (staffId: string) => `staff-mfa:${staffId}`;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Staff sign-in for /yonetim (ADR-0010): password, then a TOTP code from an authenticator app. MFA is mandatory:
 * a session grants permissions only after the code. Accounts are created by invitation (one-time link) or, once,
 * by the bootstrap command. Every step is audited without secrets.
 */
export class StaffAuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly db: CoreDb,
    private readonly settings: AdminSettings,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  // ------------------------------------------------------------------ helpers

  private async audit(db: CoreDb, staffId: string, action: string, actor: string, detail: Record<string, unknown> = {}) {
    await db.insert(auditLogs).values({ entityType: 'staff', entityId: staffId, action, actor, detail });
  }

  /** Spends the same time as a real password check when there is no account to check against. */
  private async burnPasswordCheck(password: string): Promise<void> {
    this.dummyHash ??= hashPassword(randomToken());
    await verifyPassword(password, await this.dummyHash);
  }

  private async requirePermission(actor: StaffActor, permission: Permission): Promise<void> {
    if (!(await activePermissions(this.db, actor.id)).has(permission)) throw forbidden(`Missing permission ${permission}`);
  }

  private checkPassword(password: string, email: string): void {
    if (typeof password !== 'string' || password.length < this.settings.minPasswordLength || password.length > 128) {
      throw invalid(`Password must be ${this.settings.minPasswordLength}-128 characters`);
    }
    const local = email.split('@')[0] ?? '';
    if (local.length >= 4 && password.toLowerCase().includes(local)) throw invalid('Password must not contain your email name');
  }

  private async newSession(db: CoreDb, staffId: string, stage: SessionStage, userAgent: string | null): Promise<string> {
    const token = randomToken();
    const now = this.clock();
    await db.insert(staffSessions).values({
      staffId,
      tokenHash: sha256(token),
      stage,
      userAgent: userAgent?.slice(0, 200) ?? null,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.settings.sessionMaxHours * 3_600_000).toISOString(),
    });
    return token;
  }

  /** Counts a failed password or code; locks the account at the threshold. */
  private async recordFailure(staffId: string, reason: string): Promise<void> {
    const now = this.clock();
    const [row] = await this.db
      .update(staffUsers)
      .set({ failedAttempts: sql`${staffUsers.failedAttempts} + 1`, updatedAt: now.toISOString() })
      .where(eq(staffUsers.id, staffId))
      .returning({ failed: staffUsers.failedAttempts });
    await this.audit(this.db, staffId, 'staff.sign_in_failed', ACTOR_SELF(staffId), { reason });
    if (row && row.failed >= this.settings.lockoutAttempts) {
      const until = new Date(now.getTime() + this.settings.lockoutMinutes * 60_000).toISOString();
      await this.db.update(staffUsers).set({ lockedUntil: until, failedAttempts: 0 }).where(eq(staffUsers.id, staffId));
      await this.db
        .update(staffSessions)
        .set({ revokedAt: now.toISOString(), revokeReason: 'LOCKED' })
        .where(and(eq(staffSessions.staffId, staffId), isNull(staffSessions.revokedAt)));
      await this.audit(this.db, staffId, 'staff.locked', 'system:auth', { until });
    }
  }

  private async sessionRow(token: string) {
    const now = this.clock();
    const [row] = await this.db
      .select({ s: staffSessions, u: staffUsers })
      .from(staffSessions)
      .innerJoin(staffUsers, eq(staffUsers.id, staffSessions.staffId))
      .where(eq(staffSessions.tokenHash, sha256(token)));
    if (!row) return null;
    const { s, u } = row;
    const idleLimit = new Date(s.lastSeenAt).getTime() + this.settings.sessionIdleMinutes * 60_000;
    if (s.revokedAt || new Date(s.expiresAt).getTime() <= now.getTime() || idleLimit <= now.getTime()) return null;
    if (u.status !== 'ACTIVE' || (u.lockedUntil && new Date(u.lockedUntil).getTime() > now.getTime())) return null;
    return row;
  }

  /** Re-issues the session token when the session gains authority (no session fixation). */
  private async elevate(sessionId: string): Promise<string> {
    const token = randomToken();
    const now = this.clock().toISOString();
    await this.db.update(staffSessions).set({ tokenHash: sha256(token), stage: 'ACTIVE', pendingMfaSecret: null, mfaFailures: 0, lastSeenAt: now }).where(eq(staffSessions.id, sessionId));
    return token;
  }

  // ------------------------------------------------------------------ sign-in

  /** Password step. Returns a session that still needs MFA (or MFA enrollment). */
  async signIn(emailRaw: string, password: string, meta: { userAgent?: string | null } = {}): Promise<{ token: string; stage: SessionStage }> {
    const email = normalizeEmail(String(emailRaw ?? ''));
    const now = this.clock();
    const [u] = await this.db.select().from(staffUsers).where(eq(staffUsers.email, email));
    if (!u || u.status !== 'ACTIVE' || !u.passwordHash) {
      await this.burnPasswordCheck(String(password ?? ''));
      throw unauthenticated();
    }
    if (u.lockedUntil && new Date(u.lockedUntil).getTime() > now.getTime()) {
      await this.burnPasswordCheck(String(password ?? ''));
      await this.audit(this.db, u.id, 'staff.sign_in_refused_locked', ACTOR_SELF(u.id));
      throw unauthenticated();
    }
    if (!(await verifyPassword(String(password ?? ''), u.passwordHash))) {
      await this.recordFailure(u.id, 'PASSWORD');
      throw unauthenticated();
    }
    await this.db.update(staffUsers).set({ failedAttempts: 0, lockedUntil: null }).where(eq(staffUsers.id, u.id));
    const stage: SessionStage = u.mfaSecret ? 'MFA_REQUIRED' : 'MFA_ENROLL';
    const token = await this.newSession(this.db, u.id, stage, meta.userAgent ?? null);
    await this.audit(this.db, u.id, 'staff.password_accepted', ACTOR_SELF(u.id), { stage });
    return { token, stage };
  }

  /** Second step: a code from the enrolled authenticator. Returns the new session token. */
  async verifyMfa(token: string, code: string): Promise<{ token: string }> {
    const row = await this.sessionRow(token);
    if (!row || row.s.stage !== 'MFA_REQUIRED' || !row.u.mfaSecret) throw unauthenticated();
    const { s, u } = row;
    const secret = open(this.settings.mfaKey, u.mfaSecret!, owner(u.id));
    const step = verifyTotp(secret, String(code ?? '').trim(), this.clock(), u.mfaLastStep);
    if (step === null) {
      await this.db.update(staffSessions).set({ mfaFailures: sql`${staffSessions.mfaFailures} + 1` }).where(eq(staffSessions.id, s.id));
      await this.recordFailure(u.id, 'MFA');
      throw unauthenticated();
    }
    // Conditional update: two requests with the same code cannot both pass (replay protection).
    const claimed = await this.db
      .update(staffUsers)
      .set({ mfaLastStep: step, failedAttempts: 0, lastLoginAt: this.clock().toISOString() })
      .where(and(eq(staffUsers.id, u.id), sql`(${staffUsers.mfaLastStep} IS NULL OR ${staffUsers.mfaLastStep} < ${step})`))
      .returning({ id: staffUsers.id });
    if (claimed.length === 0) throw unauthenticated();
    const next = await this.elevate(s.id);
    await this.audit(this.db, u.id, 'staff.signed_in', ACTOR_SELF(u.id));
    return { token: next };
  }

  /** First sign-in without MFA: the secret to scan. The same secret is shown again until it is confirmed. */
  async beginEnrollment(token: string): Promise<{ secret: string; uri: string; email: string }> {
    const row = await this.sessionRow(token);
    if (!row || row.s.stage !== 'MFA_ENROLL') throw unauthenticated();
    const { s, u } = row;
    let secret: string;
    if (s.pendingMfaSecret) secret = open(this.settings.mfaKey, s.pendingMfaSecret, owner(u.id));
    else {
      secret = newTotpSecret();
      await this.db.update(staffSessions).set({ pendingMfaSecret: seal(this.settings.mfaKey, secret, owner(u.id)) }).where(eq(staffSessions.id, s.id));
    }
    return { secret, uri: otpauthUri(this.settings.mfaIssuer, u.email, secret), email: u.email };
  }

  /** Confirms enrollment with a first code; the session becomes active. */
  async completeEnrollment(token: string, code: string): Promise<{ token: string }> {
    const row = await this.sessionRow(token);
    if (!row || row.s.stage !== 'MFA_ENROLL' || !row.s.pendingMfaSecret) throw unauthenticated();
    const { s, u } = row;
    const secret = open(this.settings.mfaKey, s.pendingMfaSecret!, owner(u.id));
    const step = verifyTotp(secret, String(code ?? '').trim(), this.clock(), null);
    if (step === null) {
      await this.db.update(staffSessions).set({ mfaFailures: sql`${staffSessions.mfaFailures} + 1` }).where(eq(staffSessions.id, s.id));
      await this.recordFailure(u.id, 'MFA_ENROLL');
      throw unauthenticated();
    }
    const now = this.clock().toISOString();
    const enrolled = await this.db
      .update(staffUsers)
      .set({ mfaSecret: s.pendingMfaSecret, mfaEnrolledAt: now, mfaLastStep: step, failedAttempts: 0, lastLoginAt: now, updatedAt: now })
      .where(and(eq(staffUsers.id, u.id), isNull(staffUsers.mfaSecret)))
      .returning({ id: staffUsers.id });
    if (enrolled.length === 0) throw unauthenticated();
    const next = await this.elevate(s.id);
    await this.audit(this.db, u.id, 'staff.mfa_enrolled', ACTOR_SELF(u.id));
    await this.audit(this.db, u.id, 'staff.signed_in', ACTOR_SELF(u.id));
    return { token: next };
  }

  /** The signed-in staff member, or null. Permissions are read fresh on every request (revocation is immediate). */
  async session(token: string | null | undefined): Promise<StaffSessionView | null> {
    if (!token) return null;
    const row = await this.sessionRow(token);
    if (!row) return null;
    const { s, u } = row;
    const now = this.clock();
    if (now.getTime() - new Date(s.lastSeenAt).getTime() > 60_000) {
      await this.db.update(staffSessions).set({ lastSeenAt: now.toISOString() }).where(eq(staffSessions.id, s.id));
    }
    const permissions = s.stage === 'ACTIVE' ? await activePermissions(this.db, u.id) : new Set<Permission>();
    return { stage: s.stage, staff: { id: u.id, email: u.email, displayName: u.displayName, permissions } };
  }

  async signOut(token: string | null | undefined): Promise<void> {
    if (!token) return;
    const [s] = await this.db
      .update(staffSessions)
      .set({ revokedAt: this.clock().toISOString(), revokeReason: 'SIGNED_OUT' })
      .where(and(eq(staffSessions.tokenHash, sha256(token)), isNull(staffSessions.revokedAt)))
      .returning({ staffId: staffSessions.staffId });
    if (s) await this.audit(this.db, s.staffId, 'staff.signed_out', ACTOR_SELF(s.staffId));
  }

  // ------------------------------------------------------------------ setup links

  private async issueSetupLink(db: CoreDb, staffId: string, purpose: 'INVITE' | 'PASSWORD_RESET', createdBy: string): Promise<{ token: string; expiresAt: string }> {
    const token = randomToken();
    const now = this.clock();
    const expiresAt = new Date(now.getTime() + this.settings.setupLinkHours * 3_600_000).toISOString();
    // A new link replaces older unused ones.
    await db
      .update(staffSetupTokens)
      .set({ usedAt: now.toISOString() })
      .where(and(eq(staffSetupTokens.staffId, staffId), isNull(staffSetupTokens.usedAt)));
    await db.insert(staffSetupTokens).values({ staffId, tokenHash: sha256(token), purpose, expiresAt, createdBy, createdAt: now.toISOString() });
    return { token, expiresAt };
  }

  private async setupRow(token: string) {
    const now = this.clock();
    const [row] = await this.db
      .select({ t: staffSetupTokens, u: staffUsers })
      .from(staffSetupTokens)
      .innerJoin(staffUsers, eq(staffUsers.id, staffSetupTokens.staffId))
      .where(and(eq(staffSetupTokens.tokenHash, sha256(token)), isNull(staffSetupTokens.usedAt), gt(staffSetupTokens.expiresAt, now.toISOString())));
    if (!row || row.u.status === 'DISABLED') return null;
    return row;
  }

  /** What the setup page shows (who the link is for), or null when the link is unknown, used or expired. */
  async setupInfo(token: string): Promise<{ email: string; displayName: string; purpose: 'INVITE' | 'PASSWORD_RESET' } | null> {
    if (!token) return null;
    const row = await this.setupRow(token);
    return row ? { email: row.u.email, displayName: row.u.displayName, purpose: row.t.purpose } : null;
  }

  /** Sets the password from a one-time link and starts a session that continues with MFA. */
  async completeSetup(token: string, password: string, meta: { userAgent?: string | null } = {}): Promise<{ token: string; stage: SessionStage }> {
    const row = await this.setupRow(token);
    if (!row) throw notFound();
    const { t, u } = row;
    this.checkPassword(password, u.email);
    const hash = await hashPassword(password);
    const now = this.clock().toISOString();
    return this.db.transaction(async (tx) => {
      const used = await tx
        .update(staffSetupTokens)
        .set({ usedAt: now })
        .where(and(eq(staffSetupTokens.id, t.id), isNull(staffSetupTokens.usedAt)))
        .returning({ id: staffSetupTokens.id });
      if (used.length === 0) throw notFound();
      await tx.update(staffUsers).set({ passwordHash: hash, status: 'ACTIVE', failedAttempts: 0, lockedUntil: null, updatedAt: now }).where(eq(staffUsers.id, u.id));
      // A password reset ends every other session of the account.
      await tx.update(staffSessions).set({ revokedAt: now, revokeReason: 'PASSWORD_SET' }).where(and(eq(staffSessions.staffId, u.id), isNull(staffSessions.revokedAt)));
      const stage: SessionStage = u.mfaSecret ? 'MFA_REQUIRED' : 'MFA_ENROLL';
      const session = await this.newSession(tx as unknown as CoreDb, u.id, stage, meta.userAgent ?? null);
      await this.audit(tx as unknown as CoreDb, u.id, t.purpose === 'INVITE' ? 'staff.invite_accepted' : 'staff.password_reset', ACTOR_SELF(u.id));
      return { token: session, stage };
    });
  }

  // ------------------------------------------------------------------ account management (staff.manage)

  async list(actor: StaffActor): Promise<StaffAccountRow[]> {
    await this.requirePermission(actor, 'staff.manage');
    return this.accounts();
  }

  /** Accounts without secrets; also used by the permissions screen (permissions.manage). */
  async accounts(): Promise<StaffAccountRow[]> {
    const now = this.clock().getTime();
    const rows = await this.db.select().from(staffUsers).orderBy(asc(staffUsers.displayName));
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      status: u.status,
      mfaEnrolled: u.mfaSecret !== null,
      locked: !!u.lockedUntil && new Date(u.lockedUntil).getTime() > now,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    }));
  }

  async invite(actor: StaffActor, input: { email: string; displayName: string }): Promise<{ staffId: string; token: string; expiresAt: string }> {
    await this.requirePermission(actor, 'staff.manage');
    const email = normalizeEmail(String(input.email ?? ''));
    const displayName = String(input.displayName ?? '').trim();
    if (!EMAIL.test(email)) throw invalid('Enter a valid email address');
    if (displayName.length < 2 || displayName.length > 80) throw invalid('Enter a name (2-80 characters)');
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: staffUsers.id }).from(staffUsers).where(eq(staffUsers.email, email));
      if (existing) throw invalid('A staff account with this email already exists');
      const [u] = await tx.insert(staffUsers).values({ email, displayName, status: 'INVITED', createdBy: actor.id }).returning({ id: staffUsers.id });
      const link = await this.issueSetupLink(tx as unknown as CoreDb, u!.id, 'INVITE', actor.id);
      await this.audit(tx as unknown as CoreDb, u!.id, 'staff.invited', actor.id, { email });
      return { staffId: u!.id, ...link };
    });
  }

  /** A new one-time link: for an invited person (re-send) or a forgotten password. */
  async issuePasswordLink(actor: StaffActor, staffId: string): Promise<{ token: string; expiresAt: string; purpose: 'INVITE' | 'PASSWORD_RESET' }> {
    await this.requirePermission(actor, 'staff.manage');
    const [u] = await this.db.select().from(staffUsers).where(eq(staffUsers.id, staffId));
    if (!u || u.status === 'DISABLED') throw notFound();
    const purpose = u.status === 'INVITED' ? 'INVITE' : 'PASSWORD_RESET';
    const link = await this.issueSetupLink(this.db, u.id, purpose, actor.id);
    await this.audit(this.db, u.id, purpose === 'INVITE' ? 'staff.invite_reissued' : 'staff.password_link_issued', actor.id);
    return { ...link, purpose };
  }

  /** Lost phone: removes the authenticator; the person enrolls again at the next sign-in. */
  async resetMfa(actor: StaffActor, staffId: string): Promise<void> {
    await this.requirePermission(actor, 'staff.manage');
    const now = this.clock().toISOString();
    await this.db.transaction(async (tx) => {
      const rows = await tx.update(staffUsers).set({ mfaSecret: null, mfaEnrolledAt: null, mfaLastStep: null, updatedAt: now }).where(eq(staffUsers.id, staffId)).returning({ id: staffUsers.id });
      if (rows.length === 0) throw notFound();
      await tx.update(staffSessions).set({ revokedAt: now, revokeReason: 'MFA_RESET' }).where(and(eq(staffSessions.staffId, staffId), isNull(staffSessions.revokedAt)));
      await this.audit(tx as unknown as CoreDb, staffId, 'staff.mfa_reset', actor.id);
    });
  }

  async unlock(actor: StaffActor, staffId: string): Promise<void> {
    await this.requirePermission(actor, 'staff.manage');
    const rows = await this.db.update(staffUsers).set({ lockedUntil: null, failedAttempts: 0 }).where(eq(staffUsers.id, staffId)).returning({ id: staffUsers.id });
    if (rows.length === 0) throw notFound();
    await this.audit(this.db, staffId, 'staff.unlocked', actor.id);
  }

  /**
   * Disables an account and ends its sessions. Refused for oneself and for the last active holder of
   * `permissions.manage` (nobody could grant permissions any more).
   */
  async disable(actor: StaffActor, staffId: string, reason: string): Promise<void> {
    await this.requirePermission(actor, 'staff.manage');
    if (staffId === actor.id) throw invalid('You cannot disable your own account');
    const note = String(reason ?? '').trim();
    if (note.length < 3) throw invalid('Give a reason');
    const now = this.clock().toISOString();
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('staff-disable'))`);
      const [u] = await tx.select().from(staffUsers).where(eq(staffUsers.id, staffId));
      if (!u) throw notFound();
      if (u.status === 'DISABLED') return;
      const managers = await tx.execute<{ staff_id: string }>(sql`
        SELECT g.staff_id FROM core.staff_permission_grants g JOIN core.staff_users s ON s.id::text = g.staff_id
        WHERE g.permission = 'permissions.manage' AND g.revoked_at IS NULL AND s.status = 'ACTIVE'`);
      const others = managers.rows.filter((r) => r.staff_id !== staffId);
      if (managers.rows.some((r) => r.staff_id === staffId) && others.length === 0) {
        throw invalid('This is the last active person who can grant permissions; give that permission to someone else first');
      }
      await tx.update(staffUsers).set({ status: 'DISABLED', updatedAt: now }).where(eq(staffUsers.id, staffId));
      await tx.update(staffSessions).set({ revokedAt: now, revokeReason: 'DISABLED' }).where(and(eq(staffSessions.staffId, staffId), isNull(staffSessions.revokedAt)));
      await tx.update(staffSetupTokens).set({ usedAt: now }).where(and(eq(staffSetupTokens.staffId, staffId), isNull(staffSetupTokens.usedAt)));
      await this.audit(tx as unknown as CoreDb, staffId, 'staff.disabled', actor.id, { reason: note });
    });
  }

  /** Re-enables a disabled account; the person sets a new password through a fresh link. */
  async enable(actor: StaffActor, staffId: string): Promise<{ token: string; expiresAt: string }> {
    await this.requirePermission(actor, 'staff.manage');
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(staffUsers)
        .set({ status: 'INVITED', passwordHash: null, updatedAt: this.clock().toISOString() })
        .where(and(eq(staffUsers.id, staffId), eq(staffUsers.status, 'DISABLED')))
        .returning({ id: staffUsers.id });
      if (rows.length === 0) throw notFound();
      const link = await this.issueSetupLink(tx as unknown as CoreDb, staffId, 'INVITE', actor.id);
      await this.audit(tx as unknown as CoreDb, staffId, 'staff.enabled', actor.id);
      return link;
    });
  }

  // ------------------------------------------------------------------ first owner

  /**
   * First-time setup only: creates the first account with the Owner/Admin preset (permissions.manage included) and
   * returns its invite link. Refused once any staff account exists.
   */
  async bootstrapOwner(input: { email: string; displayName: string }): Promise<{ staffId: string; token: string; expiresAt: string }> {
    const email = normalizeEmail(String(input.email ?? ''));
    const displayName = String(input.displayName ?? '').trim();
    if (!EMAIL.test(email)) throw invalid('Enter a valid email address');
    if (displayName.length < 2 || displayName.length > 80) throw invalid('Enter a name (2-80 characters)');
    const created = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('staff-bootstrap'))`);
      const [any] = await tx.select({ id: staffUsers.id }).from(staffUsers).limit(1);
      if (any) throw forbidden('Staff accounts already exist; invite people from /yonetim');
      const [u] = await tx.insert(staffUsers).values({ email, displayName, status: 'INVITED', createdBy: 'system:bootstrap' }).returning({ id: staffUsers.id });
      const link = await this.issueSetupLink(tx as unknown as CoreDb, u!.id, 'INVITE', 'system:bootstrap');
      await this.audit(tx as unknown as CoreDb, u!.id, 'staff.bootstrapped', 'system:bootstrap', { email });
      return { staffId: u!.id, ...link };
    });
    const perms = new PermissionRepository(this.db);
    await perms.bootstrapManager(created.staffId);
    await perms.grantRole(created.staffId, 'OWNER_ADMIN', { kind: 'STAFF', id: created.staffId }, 'bootstrap');
    return created;
  }
}
