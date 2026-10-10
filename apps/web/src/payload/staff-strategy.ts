import { adminSettingsFromEnv, StaffAuthService } from '@texholiday/admin';
import type { AuthStrategy, Payload } from 'payload';
import { parseCookies } from 'payload/shared';
import { coreDatabase } from '../server/core';
import { CMS_USERS, type CmsUser } from './access';

/** Same cookie as /yonetim (server/admin.ts); httpOnly, SameSite=Strict. */
const STAFF_COOKIE = 'th_staff';

const holder = globalThis as typeof globalThis & { __cmsStaffAuth?: StaffAuthService };
const staffAuth = () => (holder.__cmsStaffAuth ??= new StaffAuthService(coreDatabase().db, adminSettingsFromEnv(process.env)));

/** The CMS user mirroring a staff member, created or refreshed on first use. */
export async function mirrorCmsUser(payload: Payload, staff: { id: string; email: string; displayName: string }): Promise<CmsUser> {
  const find = async () =>
    (await payload.find({ collection: CMS_USERS, where: { staffId: { equals: staff.id } }, limit: 1, depth: 0, overrideAccess: true, pagination: false })).docs[0] as
      | CmsUser
      | undefined;
  let doc = await find();
  if (!doc) {
    try {
      doc = (await payload.create({ collection: CMS_USERS, data: { staffId: staff.id, email: staff.email, displayName: staff.displayName }, overrideAccess: true })) as unknown as CmsUser;
    } catch (err) {
      // A parallel first request created it (unique staffId).
      doc = await find();
      if (!doc) throw err;
    }
  } else if (doc.email !== staff.email || doc.displayName !== staff.displayName) {
    doc = (await payload.update({ collection: CMS_USERS, id: doc.id, data: { email: staff.email, displayName: staff.displayName }, overrideAccess: true })) as unknown as CmsUser;
  }
  return doc;
}

/**
 * Signs people into the CMS from their /yonetim session (ADR-0010): only an ACTIVE session (password + MFA) of a
 * person holding `content.edit` or `content.publish`. Permissions are read fresh on every request, so a revoked
 * permission or a signed-out session ends CMS access at once. There is no CMS password.
 */
export const staffStrategy: AuthStrategy = {
  name: 'texholiday-staff',
  authenticate: async ({ headers, payload }) => {
    const token = parseCookies(headers).get(STAFF_COOKIE);
    if (!token) return { user: null };
    const session = await staffAuth().session(token);
    if (!session || session.stage !== 'ACTIVE') return { user: null };
    const staffPermissions = [...session.staff.permissions].filter((p) => p === 'content.edit' || p === 'content.publish');
    if (staffPermissions.length === 0) return { user: null };
    const doc = await mirrorCmsUser(payload, session.staff);
    return { user: { ...doc, collection: CMS_USERS, _strategy: 'texholiday-staff', staffPermissions } as never };
  },
};
