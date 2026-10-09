import { draftMode } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

/** Leaves the draft preview. */
export async function GET(req: NextRequest) {
  (await draftMode()).disable();
  // Back to the page the person came from, as a relative path on the same host (never another site).
  let path = '/';
  try {
    const back = new URL(req.headers.get('referer') ?? '');
    if (back.host === req.headers.get('host')) path = `${back.pathname}${back.search}`;
  } catch {
    // no or invalid referer: home
  }
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}
