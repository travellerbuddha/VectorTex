import { draftMode } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { SITE_PATHS } from '../../../payload/collections/content';
import { currentSession } from '../../../server/admin';
import { cmsEnabled } from '../../../server/cms';

/**
 * Turns on the draft preview for content staff (P06) and opens the page. Only a signed-in /yonetim session with a
 * content permission gets it; the page itself still reads drafts as that person (overrideAccess: false).
 */
export async function GET(req: NextRequest) {
  if (!cmsEnabled()) return new NextResponse(null, { status: 404 });
  const s = await currentSession();
  if (!s || s.stage !== 'ACTIVE' || (!s.staff.permissions.has('content.edit') && !s.staff.permissions.has('content.publish'))) {
    return new NextResponse(null, { status: 403 });
  }
  const collection = req.nextUrl.searchParams.get('collection') ?? '';
  const slug = req.nextUrl.searchParams.get('slug') ?? '';
  const locale = req.nextUrl.searchParams.get('locale') === 'en' ? 'en' : 'tr';
  const toPath = SITE_PATHS[collection];
  if (!toPath || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return new NextResponse(null, { status: 400 });
  (await draftMode()).enable();
  // Relative Location: the browser stays on the host it used (behind a proxy nextUrl may name another host, and the
  // session and preview cookies belong to the original one).
  return new NextResponse(null, { status: 303, headers: { Location: toPath(locale, slug) } });
}
