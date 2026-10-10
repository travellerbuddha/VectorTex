import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { DomainError, ROLE_PRESETS, isPermission, type Permission, type StaffActor, type StaffRole } from '@texholiday/contracts';
import type { CoreDb } from './client';
import { auditLogs, permissions, staffPermissionGrants } from './schema';

const forbidden = (message: string) => new DomainError('FORBIDDEN', message, { httpStatus: 403 });
const BOOTSTRAP_ACTOR = 'system:bootstrap';
const STAFF_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;

export interface PermissionGrantRow {
  id: string;
  staffId: string;
  permission: Permission;
  grantedBy: string;
  grantedAt: string;
  note: string | null;
  revokedBy: string | null;
  revokedAt: string | null;
  revokeNote: string | null;
}

/** Reads a staff member's active permissions; used by every repository that authorizes staff actions. */
export async function activePermissions(db: CoreDb, staffId: string): Promise<Set<Permission>> {
  const rows = await db
    .select({ permission: staffPermissionGrants.permission })
    .from(staffPermissionGrants)
    .where(and(eq(staffPermissionGrants.staffId, staffId), isNull(staffPermissionGrants.revokedAt)));
  return new Set(rows.map((r) => r.permission).filter(isPermission));
}

/**
 * Backend of the admin permissions screen (/yonetim → İzinler, ADR-0007). Holders of `permissions.manage` grant and
 * revoke permissions (one by one or via a role preset); everything is audited and the database enforces the same
 * rules (core.staff_permission_grants_guard), so a bypassed application cannot widen anyone's authority.
 */
export class PermissionRepository {
  constructor(private readonly db: CoreDb) {}

  /** The catalog with Turkish/English descriptions for the screen. */
  async catalog(): Promise<Array<{ code: Permission; tr: string; en: string }>> {
    const rows = await this.db.select().from(permissions).orderBy(asc(permissions.code));
    return rows.filter((r) => isPermission(r.code)).map((r) => ({ code: r.code as Permission, tr: r.descriptionTr, en: r.descriptionEn }));
  }

  async permissionsOf(staffId: string): Promise<Set<Permission>> {
    return activePermissions(this.db, staffId);
  }

  /** Grant history (active and revoked), optionally for one person. */
  async grants(filter: { staffId?: string; activeOnly?: boolean } = {}): Promise<PermissionGrantRow[]> {
    const conditions = [
      ...(filter.staffId ? [eq(staffPermissionGrants.staffId, filter.staffId)] : []),
      ...(filter.activeOnly ? [isNull(staffPermissionGrants.revokedAt)] : []),
    ];
    const rows = await this.db
      .select()
      .from(staffPermissionGrants)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(staffPermissionGrants.staffId), asc(staffPermissionGrants.grantedAt));
    return rows.map((r) => ({ ...r, permission: r.permission as Permission }));
  }

  private async assertManager(tx: CoreDb, actor: StaffActor): Promise<void> {
    if (!(await activePermissions(tx, actor.id)).has('permissions.manage')) throw forbidden('Only a permissions manager can change permissions');
  }

  private async audit(tx: CoreDb, staffId: string, action: string, actor: string, detail: Record<string, unknown>) {
    await tx.insert(auditLogs).values({ entityType: 'staff_permissions', entityId: staffId, action, actor, detail });
  }

  private validate(staffId: string, permission: string): asserts permission is Permission {
    if (!STAFF_ID.test(staffId)) throw new DomainError('VALIDATION_FAILED', 'Invalid staff id', { httpStatus: 422 });
    if (!isPermission(permission)) throw new DomainError('VALIDATION_FAILED', `Unknown permission ${permission}`, { httpStatus: 422 });
  }

  /** Grants permissions in one transaction; already active ones are left as they are. */
  private async grantAll(staffId: string, list: readonly Permission[], actor: StaffActor, note: string | null): Promise<Permission[]> {
    for (const p of list) this.validate(staffId, p);
    return this.db.transaction(async (tx) => {
      await this.assertManager(tx as unknown as CoreDb, actor);
      const granted: Permission[] = [];
      for (const permission of list) {
        const rows = await tx.insert(staffPermissionGrants).values({ staffId, permission, grantedBy: actor.id, note }).onConflictDoNothing().returning({ id: staffPermissionGrants.id });
        if (rows.length === 0) continue;
        granted.push(permission);
        await this.audit(tx as unknown as CoreDb, staffId, 'permission.granted', actor.id, { permission, note });
      }
      return granted;
    });
  }

  /** Grants one permission. Granting an already active permission changes nothing. */
  async grant(staffId: string, permission: Permission, actor: StaffActor, note: string | null = null): Promise<{ granted: boolean }> {
    return { granted: (await this.grantAll(staffId, [permission], actor, note)).length > 0 };
  }

  /** Assigns a role preset (§16 roles) by granting each of its permissions, atomically. */
  async grantRole(staffId: string, role: StaffRole, actor: StaffActor, note: string | null = null): Promise<{ granted: Permission[] }> {
    const preset = ROLE_PRESETS[role];
    if (!preset) throw new DomainError('VALIDATION_FAILED', `Unknown role ${role}`, { httpStatus: 422 });
    return { granted: await this.grantAll(staffId, preset, actor, note ?? `role:${role}`) };
  }

  /** Revokes an active permission (takes effect immediately). The last permissions manager cannot be revoked. */
  async revoke(staffId: string, permission: Permission, actor: StaffActor, note: string | null = null): Promise<{ revoked: boolean }> {
    this.validate(staffId, permission);
    return this.db.transaction(async (tx) => {
      await this.assertManager(tx as unknown as CoreDb, actor);
      if (permission === 'permissions.manage') {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('core.permissions.manage'))`);
        const others = await tx
          .select({ id: staffPermissionGrants.id })
          .from(staffPermissionGrants)
          .where(and(eq(staffPermissionGrants.permission, 'permissions.manage'), isNull(staffPermissionGrants.revokedAt), ne(staffPermissionGrants.staffId, staffId)))
          .limit(1);
        if (others.length === 0) throw new DomainError('VALIDATION_FAILED', 'The last permissions manager cannot be revoked', { httpStatus: 409 });
      }
      const rows = await tx
        .update(staffPermissionGrants)
        .set({ revokedBy: actor.id, revokedAt: sql`now()` as unknown as string, revokeNote: note })
        .where(and(eq(staffPermissionGrants.staffId, staffId), eq(staffPermissionGrants.permission, permission), isNull(staffPermissionGrants.revokedAt)))
        .returning({ id: staffPermissionGrants.id });
      if (rows.length > 0) await this.audit(tx as unknown as CoreDb, staffId, 'permission.revoked', actor.id, { permission, note });
      return { revoked: rows.length > 0 };
    });
  }

  /**
   * First-time setup only: makes `staffId` the first permissions manager while nobody holds that permission
   * (run by the operator with `pnpm --filter @texholiday/db permissions:bootstrap -- <staffId>`).
   */
  async bootstrapManager(staffId: string): Promise<void> {
    this.validate(staffId, 'permissions.manage');
    await this.db.transaction(async (tx) => {
      try {
        await tx.insert(staffPermissionGrants).values({ staffId, permission: 'permissions.manage', grantedBy: BOOTSTRAP_ACTOR, note: 'bootstrap' });
      } catch (err) {
        const cause = (err as { cause?: { code?: string } }).cause;
        if (cause?.code === '42501') throw forbidden('A permissions manager already exists; ask them to grant permissions');
        throw err;
      }
      await this.audit(tx as unknown as CoreDb, staffId, 'permission.bootstrap', BOOTSTRAP_ACTOR, { permission: 'permissions.manage' });
    });
  }
}
