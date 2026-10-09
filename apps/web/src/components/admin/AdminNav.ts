import type { Permission } from '@texholiday/contracts';
import type { StaffIdentity } from '@texholiday/admin';

export type NavKey = 'home' | 'orders' | 'tasks' | 'pricing' | 'staff' | 'permissions';

/** Menu of /yonetim: an entry is shown only to people holding one of its permissions (§16). */
export const ADMIN_NAV: ReadonlyArray<{ key: NavKey; href: string; any: readonly Permission[] }> = [
  { key: 'home', href: '/yonetim', any: [] },
  { key: 'pricing', href: '/yonetim/fiyat-politikasi', any: ['pricing_policy.edit', 'pricing_policy.approve', 'pricing_policy.approve_own'] },
  { key: 'staff', href: '/yonetim/personel', any: ['staff.manage', 'permissions.manage'] },
];

export function visibleNav(staff: StaffIdentity) {
  return ADMIN_NAV.filter((n) => n.any.length === 0 || n.any.some((p) => staff.permissions.has(p)));
}
