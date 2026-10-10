import { NextResponse } from 'next/server';
import { cms, cmsEnabled } from '../../../server/cms';

/**
 * The old-site address map for the proxy (P17). Public data (every visitor can observe the redirects); read through the
 * Local API with visitor rights. The proxy keeps its own short-lived copy, so this is not cached here.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!cmsEnabled()) return NextResponse.json({ redirects: [] }, { headers: { 'Cache-Control': 'no-store' } });
  const payload = await cms();
  const redirects: Array<{ from: unknown; to: unknown; status: unknown }> = [];
  for (let page = 1; ; page += 1) {
    const res = await payload.find({ collection: 'redirects', depth: 0, limit: 1000, page, overrideAccess: false, select: { from: true, to: true, status: true } });
    redirects.push(...res.docs.map((d) => ({ from: d.from, to: d.to, status: d.status })));
    if (!res.hasNextPage) break;
  }
  return NextResponse.json({ redirects }, { headers: { 'Cache-Control': 'no-store' } });
}
