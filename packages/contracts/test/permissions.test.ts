import { describe, expect, it } from 'vitest';
import { PERMISSION_CODES, PERMISSIONS, ROLE_PRESETS, STAFF_ROLES, isPermission } from '../src/index';

describe('ADR-0007 permission catalog', () => {
  it('every permission has a Turkish and an English description for the permissions screen', () => {
    for (const code of PERMISSION_CODES) {
      expect(code).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(PERMISSIONS[code].tr.length).toBeGreaterThan(10);
      expect(PERMISSIONS[code].en.length).toBeGreaterThan(10);
    }
    expect(isPermission('pricing_policy.approve_own')).toBe(true);
    expect(isPermission('toString')).toBe(false);
  });

  it('role presets cover every spec role, use known permissions and never include self-approval', () => {
    expect(Object.keys(ROLE_PRESETS).sort()).toEqual([...STAFF_ROLES].sort());
    for (const list of Object.values(ROLE_PRESETS)) {
      for (const p of list) {
        expect(isPermission(p)).toBe(true);
        expect(p.endsWith('.approve_own')).toBe(false);
      }
    }
    // Editing and approving stay in different presets, so the default is four-eyes.
    expect(ROLE_PRESETS.FINANCE.some((p) => p.endsWith('.approve'))).toBe(false);
    expect(ROLE_PRESETS.FINANCE_APPROVER.some((p) => p.endsWith('.edit'))).toBe(false);
  });
});
