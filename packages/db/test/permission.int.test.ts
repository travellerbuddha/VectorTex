import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PERMISSIONS, ROLE_PRESETS, type StaffActor } from '@texholiday/contracts';
import { PermissionRepository, type CoreDatabase } from '../src/index';
import { dbError, freshDatabase } from './support/db';

/** ADR-0007: permissions are assigned to people on the permissions screen; the database enforces the same rules. */
let core: CoreDatabase;
let repo: PermissionRepository;

const owner: StaffActor = { kind: 'STAFF', id: 'staff-owner-1' };
const admin2: StaffActor = { kind: 'STAFF', id: 'staff-admin-2' };
const finance: StaffActor = { kind: 'STAFF', id: 'staff-finance-1' };

beforeAll(async () => {
  core = await freshDatabase();
  repo = new PermissionRepository(core.db);
});
afterAll(async () => {
  await core?.close();
});

describe('staff permissions', () => {
  it('the database catalog equals the code catalog (Turkish and English descriptions for the screen)', async () => {
    const catalog = await repo.catalog();
    expect(catalog.map((c) => c.code).sort()).toEqual(Object.keys(PERMISSIONS).sort());
    for (const c of catalog) expect({ tr: c.tr, en: c.en }).toEqual(PERMISSIONS[c.code]);
  });

  it('bootstrap creates the first permissions manager exactly once', async () => {
    await expect(repo.grant(finance.id, 'pricing_policy.edit', owner)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await repo.bootstrapManager(owner.id);
    expect(await repo.permissionsOf(owner.id)).toEqual(new Set(['permissions.manage']));
    await expect(repo.bootstrapManager('staff-intruder')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await dbError(core.db.execute(sql`INSERT INTO core.staff_permission_grants (staff_id, permission, granted_by) VALUES ('x', 'permissions.manage', 'system:bootstrap')`))).toMatch(
      /bootstrap only/,
    );
  });

  it('a manager grants single permissions or role presets; non-managers cannot (application and database)', async () => {
    expect(await repo.grantRole(finance.id, 'FINANCE', owner)).toEqual({ granted: [...ROLE_PRESETS.FINANCE] });
    expect(await repo.grant(finance.id, 'pricing_policy.approve_own', owner, 'owner decision')).toEqual({ granted: true });
    expect(await repo.grant(finance.id, 'pricing_policy.approve_own', owner)).toEqual({ granted: false }); // already active
    expect(await repo.permissionsOf(finance.id)).toEqual(new Set([...ROLE_PRESETS.FINANCE, 'pricing_policy.approve_own']));
    await expect(repo.grant('staff-other', 'pricing_policy.edit', finance)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(
      await dbError(core.db.execute(sql`INSERT INTO core.staff_permission_grants (staff_id, permission, granted_by) VALUES ('staff-other', 'pricing_policy.edit', 'staff-finance-1')`)),
    ).toMatch(/may not grant/);
    // Unknown permissions do not exist in the catalog.
    await expect(repo.grant(finance.id, 'bookings.delete' as never, owner)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await dbError(core.db.execute(sql`INSERT INTO core.staff_permission_grants (staff_id, permission, granted_by) VALUES ('staff-x', 'bookings.delete', 'staff-owner-1')`))).toMatch(
      /foreign key/,
    );
  });

  it('revoke takes effect at once; grants are never deleted and keep their history', async () => {
    expect(await repo.revoke(finance.id, 'pricing_policy.approve_own', owner, 'season over')).toEqual({ revoked: true });
    expect(await repo.revoke(finance.id, 'pricing_policy.approve_own', owner)).toEqual({ revoked: false });
    expect((await repo.permissionsOf(finance.id)).has('pricing_policy.approve_own')).toBe(false);
    const history = await repo.grants({ staffId: finance.id });
    expect(history.find((g) => g.permission === 'pricing_policy.approve_own')).toMatchObject({ grantedBy: owner.id, revokedBy: owner.id, revokeNote: 'season over' });
    const [row] = history;
    expect(await dbError(core.db.execute(sql`DELETE FROM core.staff_permission_grants WHERE id = ${row!.id}`))).toMatch(/never deleted/);
    expect(await dbError(core.db.execute(sql`UPDATE core.staff_permission_grants SET permission = 'permissions.manage' WHERE id = ${row!.id}`))).toMatch(/immutable/);
    // Granting again after a revoke creates a new grant row (history stays).
    await repo.grant(finance.id, 'pricing_policy.approve_own', owner);
    expect((await repo.grants({ staffId: finance.id })).filter((g) => g.permission === 'pricing_policy.approve_own')).toHaveLength(2);
    const audit = await core.db.execute<{ action: string }>(sql`SELECT action FROM core.audit_logs WHERE entity_type = 'staff_permissions' AND entity_id = ${finance.id} ORDER BY id`);
    // One grant per preset permission, the explicit self-approval grant, its revoke and the re-grant.
    const grantsBefore = ROLE_PRESETS.FINANCE.length + 1;
    expect(audit.rows.map((r) => r.action)).toEqual([...Array(grantsBefore).fill('permission.granted'), 'permission.revoked', 'permission.granted']);
  });

  it('the last permissions manager cannot be revoked (no lock-out); with two managers one may leave', async () => {
    await expect(repo.revoke(owner.id, 'permissions.manage', owner)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const [grant] = await repo.grants({ staffId: owner.id, activeOnly: true });
    expect(
      await dbError(core.db.execute(sql`UPDATE core.staff_permission_grants SET revoked_by = 'staff-owner-1', revoked_at = now() WHERE id = ${grant!.id}`)),
    ).toMatch(/last permissions manager/);
    await repo.grant(admin2.id, 'permissions.manage', owner);
    expect(await repo.revoke(owner.id, 'permissions.manage', admin2, 'handover')).toEqual({ revoked: true });
    await expect(repo.grant(finance.id, 'risk_policy.approve', owner)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
