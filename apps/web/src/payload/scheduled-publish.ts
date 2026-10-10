import type { CollectionAfterReadHook, JobsConfig } from 'payload';
import { canPublish, type CmsUser } from './access';

/**
 * Scheduled publishing (Payload "schedule publish", ADR-0020). A publish or unpublish planned in the CMS is a job in
 * `cms.payload_jobs`; the web process runs due jobs every minute. `content.publish` stays the only way to change what
 * is live:
 *
 * - when scheduling: the CMS offers "Schedule publish" only to people who may publish (see `editorsPublishers`);
 * - when the job runs: it runs as that person with their permissions at that moment, so a permission revoked (or an
 *   account disabled) in between stops it; the document then stays as it is.
 */
export const CONTENT_PERMISSIONS = ['content.edit', 'content.publish'] as const;

/** The content permissions of an active staff member right now, from core (never from the job's stored input). */
export async function currentContentPermissions(staffId: string): Promise<string[]> {
  const [{ activePermissions }, { coreDatabase }] = await Promise.all([import('@texholiday/db'), import('../server/core')]);
  const core = coreDatabase();
  const staff = await core.pool.query<{ status: string }>('SELECT status FROM core.staff_users WHERE id::text = $1', [staffId]);
  if (staff.rows[0]?.status !== 'ACTIVE') return [];
  return [...(await activePermissions(core.db, staffId))].filter((p) => (CONTENT_PERMISSIONS as readonly string[]).includes(p));
}

/**
 * A CMS user read without a signed-in person (the job runner loading the person who scheduled) carries that person's
 * current permissions; requests through the staff strategy keep the permissions of their own session.
 */
export const attachCurrentPermissions: CollectionAfterReadHook = async ({ context, doc, req }) => {
  if (req.user || context?.staffSignIn || !doc || typeof (doc as CmsUser).staffId !== 'string') return doc;
  return { ...doc, staffPermissions: await currentContentPermissions((doc as CmsUser).staffId) };
};

/**
 * Jobs: due scheduled publishes run every minute in the web process (not during `next build`; CMS_JOBS_AUTORUN=false
 * turns it off, e.g. on extra instances). The run endpoint (/api/cms/payload-jobs/run) is for publishers only.
 */
export const jobsConfig: JobsConfig = {
  autoRun: [{ cron: '* * * * *', queue: 'default', limit: 20 }],
  shouldAutoRun: () => process.env.CMS_JOBS_AUTORUN !== 'false',
  access: { run: ({ req }) => canPublish(req), queue: ({ req }) => canPublish(req), cancel: ({ req }) => canPublish(req) },
};
