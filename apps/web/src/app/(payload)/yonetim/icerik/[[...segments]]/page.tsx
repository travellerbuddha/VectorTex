import { notFound, redirect } from 'next/navigation';
import { generatePageMetadata, RootPage } from '@payloadcms/next/views';
import config from '../../../../../payload.config';
import { currentSession } from '../../../../../server/admin';
import { cmsEnabled } from '../../../../../server/cms';
import { importMap } from '../importMap.js';

type Args = { params: Promise<{ segments: string[] }>; searchParams: Promise<{ [key: string]: string | string[] }> };

export const generateMetadata = ({ params, searchParams }: Args) => generatePageMetadata({ config, params, searchParams });

/**
 * The CMS admin. Sign-in happens in /yonetim (password + MFA); Payload's own login/logout pages are never used
 * (there is no CMS password). Without content permissions the person stays in the panel.
 */
export default async function CmsAdmin({ params, searchParams }: Args) {
  if (!cmsEnabled()) notFound();
  const segments = (await params).segments ?? [];
  if (segments[0] === 'login' || segments[0] === 'create-first-user' || segments[0] === 'forgot' || segments[0] === 'reset') redirect('/yonetim/giris');
  if (segments[0] === 'logout' || segments[0] === 'logout-inactivity') redirect('/yonetim');
  const s = await currentSession();
  if (!s || s.stage !== 'ACTIVE') redirect('/yonetim/giris?durum=sure');
  if (!s.staff.permissions.has('content.edit') && !s.staff.permissions.has('content.publish')) redirect('/yonetim');
  return RootPage({ config, params, searchParams, importMap });
}
