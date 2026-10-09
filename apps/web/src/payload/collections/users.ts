import type { CollectionConfig } from 'payload';
import { CMS_USERS, contentStaff } from '../access';
import { staffStrategy } from '../staff-strategy';

/**
 * CMS users mirror /yonetim staff (ADR-0010): no passwords here. The staff strategy signs people in from their panel
 * session; accounts are created and kept in sync automatically and cannot be edited in the CMS.
 */
export const CmsUsers: CollectionConfig = {
  slug: CMS_USERS,
  labels: { singular: { tr: 'İçerik kullanıcısı', en: 'Content user' }, plural: { tr: 'İçerik kullanıcıları', en: 'Content users' } },
  admin: {
    useAsTitle: 'displayName',
    defaultColumns: ['displayName', 'email'],
    description: { tr: 'Hesaplar ve izinler /yonetim → Personel ve izinler ekranından yönetilir.', en: 'Accounts and permissions are managed in /yonetim → Staff & permissions.' },
  },
  auth: { disableLocalStrategy: true, strategies: [staffStrategy] },
  access: { admin: ({ req }) => contentStaff({ req } as never) === true, read: contentStaff, create: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'staffId', type: 'text', required: true, unique: true, index: true, admin: { readOnly: true } },
    { name: 'email', type: 'text', required: true, admin: { readOnly: true } },
    { name: 'displayName', type: 'text', required: true, admin: { readOnly: true } },
  ],
};
