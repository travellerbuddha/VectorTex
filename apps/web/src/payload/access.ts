import type { Access, CollectionBeforeChangeHook, PayloadRequest } from 'payload';
import { Forbidden } from 'payload';

/**
 * Who may do what in the CMS (P06). Authority comes from the person's /yonetim permissions (ADR-0007/0010), read by
 * the staff strategy on every request: `content.edit` drafts and edits, `content.publish` publishes and deletes.
 * Visitors (no user) read published documents only. Nothing here can touch bookings or money: the CMS lives in the
 * `cms` schema and holds no financial fields (ADR-0003, spec §16).
 */
export const CMS_USERS = 'cms-users';

export interface CmsUser {
  id: number | string;
  staffId: string;
  email: string;
  displayName: string;
  /** Not stored: the staff member's current permissions, attached by the strategy. */
  staffPermissions?: readonly string[];
}

const permissions = (req: PayloadRequest): ReadonlySet<string> => new Set((req.user as CmsUser | null | undefined)?.staffPermissions ?? []);
export const canEdit = (req: PayloadRequest) => permissions(req).has('content.edit');
export const canPublish = (req: PayloadRequest) => permissions(req).has('content.publish');
const isContentStaff = (req: PayloadRequest) => canEdit(req) || canPublish(req);

/** Published documents for everyone; drafts and versions only for content staff. */
export const publishedOrStaff: Access = ({ req }) => (isContentStaff(req) ? true : { _status: { equals: 'published' } });
/** Public assets (images): readable by everyone. */
export const anyone: Access = () => true;
export const editors: Access = ({ req }) => canEdit(req);
/**
 * Saving needs `content.edit`; saving as published also `content.publish`. The CMS asks this with `_status: 'published'`
 * to decide whether to offer "Publish" and "Schedule publish", so editors are not offered either (ADR-0020).
 */
export const editorsPublishers: Access = ({ req, data }) => canEdit(req) && ((data as { _status?: unknown } | undefined)?._status !== 'published' || canPublish(req));
export const publishers: Access = ({ req }) => canPublish(req);
export const contentStaff: Access = ({ req }) => isContentStaff(req);

/** Publishing needs `content.publish`; `content.edit` alone saves drafts. */
export const guardPublish: CollectionBeforeChangeHook = ({ data, req }) => {
  if (data?._status === 'published' && !canPublish(req)) throw new Forbidden(req.t);
  return data;
};
