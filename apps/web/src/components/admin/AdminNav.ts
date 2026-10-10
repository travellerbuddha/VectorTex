import type { Permission } from '@texholiday/contracts';
import type { StaffIdentity } from '@texholiday/admin';

export type NavKey = 'home' | 'orders' | 'tasks' | 'pricing' | 'risk' | 'content' | 'reports' | 'staff' | 'permissions';

export type ReportKey = 'listPrices' | 'adsFeed';

/** Reports of /yonetim/raporlar: each one is shown only to people holding one of its permissions. */
export const ADMIN_REPORTS: ReadonlyArray<{ key: ReportKey; href: string; any: readonly Permission[] }> = [
  {
    key: 'listPrices',
    href: '/yonetim/raporlar/liste-fiyatlari',
    any: ['content.edit', 'content.publish', 'pricing_policy.edit', 'pricing_policy.approve', 'pricing_policy.approve_own', 'orders.view_financials'],
  },
  { key: 'adsFeed', href: '/yonetim/raporlar/reklam-sayfalari', any: ['content.edit', 'content.publish'] },
];

export const canSeeReport = (staff: StaffIdentity, key: ReportKey) => ADMIN_REPORTS.find((r) => r.key === key)!.any.some((p) => staff.permissions.has(p));

/** Menu of /yonetim: an entry is shown only to people holding one of its permissions (§16). */
export const ADMIN_NAV: ReadonlyArray<{ key: NavKey; href: string; any: readonly Permission[] }> = [
  { key: 'home', href: '/yonetim', any: [] },
  { key: 'orders', href: '/yonetim/siparisler', any: ['orders.view'] },
  { key: 'tasks', href: '/yonetim/gorevler', any: ['orders.view'] },
  { key: 'pricing', href: '/yonetim/fiyat-politikasi', any: ['pricing_policy.edit', 'pricing_policy.approve', 'pricing_policy.approve_own'] },
  { key: 'risk', href: '/yonetim/risk-politikasi', any: ['risk_policy.edit', 'risk_policy.approve', 'risk_policy.approve_own'] },
  { key: 'content', href: '/yonetim/icerik', any: ['content.edit', 'content.publish'] },
  { key: 'reports', href: '/yonetim/raporlar', any: [...new Set(ADMIN_REPORTS.flatMap((r) => r.any))] },
  { key: 'staff', href: '/yonetim/personel', any: ['staff.manage', 'permissions.manage'] },
];

export function visibleNav(staff: StaffIdentity) {
  return ADMIN_NAV.filter((n) => n.any.length === 0 || n.any.some((p) => staff.permissions.has(p)));
}
