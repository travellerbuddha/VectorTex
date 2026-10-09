/**
 * Staff permissions (ADR-0007). A permission is the unit of authority; staff members receive permissions from the
 * permissions screen of the admin (/yonetim → İzinler) and every grant/revoke is audited. Roles from the spec (§16)
 * are presets: assigning a role grants its permissions one by one, so the grant list stays the single source of truth.
 * The same catalog is seeded into core.permissions by migration; adding a permission needs a migration.
 */
export const PERMISSIONS = {
  'permissions.manage': {
    tr: 'Kullanıcılara izin verme ve izin geri alma',
    en: 'Grant and revoke staff permissions',
  },
  'pricing_policy.edit': {
    tr: 'Fiyat politikası (marj, servis bedeli, kur) taslağı oluşturma ve düzenleme',
    en: 'Create and edit pricing policy drafts (margins, service fees, FX)',
  },
  'pricing_policy.approve': {
    tr: 'Başka bir kullanıcının hazırladığı fiyat politikasını onaylama veya devreden çıkarma',
    en: 'Approve or retire pricing policies prepared by someone else',
  },
  'pricing_policy.approve_own': {
    tr: 'Kendi hazırladığı fiyat politikasını tek başına onaylama (iki kişili onay aranmaz)',
    en: 'Approve own pricing policy changes alone (no second approver)',
  },
  'risk_policy.edit': {
    tr: 'Risk politikası (tedarikçi riski, provizyon güvenlik payı, finansman sırası) taslağı oluşturma ve düzenleme',
    en: 'Create and edit risk policy drafts (supplier exposure, authorization safety margin, funding order)',
  },
  'risk_policy.approve': {
    tr: 'Başka bir kullanıcının hazırladığı risk politikasını onaylama veya devreden çıkarma',
    en: 'Approve or retire risk policies prepared by someone else',
  },
  'risk_policy.approve_own': {
    tr: 'Kendi hazırladığı risk politikasını tek başına onaylama (iki kişili onay aranmaz)',
    en: 'Approve own risk policy changes alone (no second approver)',
  },
  'staff.manage': {
    tr: 'Personel hesabı açma (davet), kapatma, şifre ve MFA sıfırlama',
    en: 'Invite and disable staff accounts, reset their password and MFA',
  },
  'orders.view': {
    tr: 'Siparişleri, misafir bilgilerini ve operasyon görevlerini görüntüleme',
    en: 'View orders, guest details and operation tasks',
  },
  'orders.view_financials': {
    tr: 'Siparişlerde tedarikçi maliyeti, komisyon ve marjı görüntüleme',
    en: 'View supplier cost, commission and margin on orders',
  },
  'tasks.manage': {
    tr: 'Operasyon görevlerini üstlenme ve gerekçeyle kapatma',
    en: 'Take operation tasks and close them with a resolution',
  },
  'orders.cancel': {
    tr: 'Onaylı rezervasyonu sağlayıcıda gerekçeyle iptal etme',
    en: 'Cancel a confirmed booking at the provider, with a reason',
  },
  'orders.record_refund': {
    tr: 'Sağlayıcının müşteriye yaptığı iadeyi doğruladıktan sonra siparişe kaydetme',
    en: 'Record a refund the provider made to the customer, after verifying it',
  },
  'content.edit': {
    tr: 'Site içeriği (sayfa, destinasyon, yazı, SSS, kampanya, menü, görsel) taslağı oluşturma ve düzenleme',
    en: 'Create and edit site content drafts (pages, destinations, posts, FAQs, campaigns, menus, images)',
  },
  'content.publish': {
    tr: 'Site içeriğini yayınlama, yayından kaldırma ve silme',
    en: 'Publish, unpublish and delete site content',
  },
} as const satisfies Record<string, { tr: string; en: string }>;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_CODES = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

/** Staff roles (§16). Customers are a separate identity type and never hold staff permissions. */
export const STAFF_ROLES = ['OWNER_ADMIN', 'CONTENT_EDITOR', 'OPERATIONS', 'FINANCE', 'FINANCE_APPROVER', 'VIEWER'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * Role presets: the permissions a role assignment grants. Self-approval (`*.approve_own`) is never part of a preset;
 * it is granted to a person explicitly.
 */
export const ROLE_PRESETS: Readonly<Record<StaffRole, readonly Permission[]>> = {
  OWNER_ADMIN: [
    'permissions.manage',
    'staff.manage',
    'pricing_policy.edit',
    'risk_policy.edit',
    'orders.view',
    'orders.view_financials',
    'tasks.manage',
    'orders.cancel',
    'orders.record_refund',
    'content.edit',
    'content.publish',
  ],
  FINANCE: ['pricing_policy.edit', 'risk_policy.edit', 'orders.view', 'orders.view_financials', 'orders.record_refund'],
  FINANCE_APPROVER: ['pricing_policy.approve', 'risk_policy.approve', 'orders.view', 'orders.view_financials'],
  CONTENT_EDITOR: ['content.edit', 'content.publish'],
  OPERATIONS: ['orders.view', 'tasks.manage', 'orders.cancel'],
  VIEWER: ['orders.view'],
};

/**
 * An authenticated staff member (identity from the /yonetim sign-in with MFA, ADR-0010). Authority is never taken from the caller:
 * repositories read the person's active grants from core.staff_permission_grants.
 */
export interface StaffActor {
  kind: 'STAFF';
  id: string;
}
