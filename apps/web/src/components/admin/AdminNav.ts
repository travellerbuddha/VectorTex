import type { Permission } from '@texholiday/contracts';
import type { StaffIdentity } from '@texholiday/admin';

export type NavKey = 'home' | 'orders' | 'tasks' | 'pricing' | 'staff' | 'permissions';

/** Menu of /yonetim: an entry is shown only to people holding one of its permissions (§16). */
export const ADMIN_NAV: ReadonlyArray<{ key: NavKey; href: string; any: readonly Permission[] }> = [{ key: 'home', href: '/yonetim', any: [] }];

export function visibleNav(staff: StaffIdentity) {
  return ADMIN_NAV.filter((n) => n.any.length === 0 || n.any.some((p) => staff.permissions.has(p)));
}
