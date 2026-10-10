import { NextResponse, type NextRequest } from 'next/server';
import { originOf } from './server/origin';
import { buildRedirectMap, legacySearchLocation, locationOf, lookupRedirect, type RedirectRule } from './server/redirects';
import { errorMessage, log } from './server/log';

/**
 * Old-site addresses (P17): a request matching a rule of the CMS redirect map gets a permanent redirect before any page
 * renders (one hop, also for old addresses ending in "/"). The map is fetched from /api/cms-redirects and kept for a minute; when it cannot be fetched the site keeps
 * working with the last copy (or none), and the next request tries again after a short pause.
 */
const TTL_MS = 60_000;
const RETRY_MS = 10_000;
let cache: { map: Map<string, RedirectRule>; until: number } = { map: new Map(), until: 0 };
let loading: Promise<void> | null = null;

async function refresh(origin: string): Promise<void> {
  try {
    const res = await fetch(new URL('/api/cms-redirects', origin), { cache: 'no-store', signal: AbortSignal.timeout(3_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { redirects?: Array<{ from: unknown; to: unknown; status: unknown }> };
    cache = { map: buildRedirectMap(body.redirects ?? []), until: Date.now() + TTL_MS };
  } catch (err) {
    cache = { map: cache.map, until: Date.now() + RETRY_MS };
    log.error('redirect map unavailable', { error: errorMessage(err) });
  }
}

/**
 * Proxy responses need an absolute Location (a relative one fails with "Invalid URL"). The origin is PUBLIC_BASE_URL or
 * the host the visitor used, never nextUrl's (behind a proxy it can name an internal host).
 */
const redirectTo = (request: NextRequest, status: number, path: string) => new NextResponse(null, { status, headers: { Location: `${originOf(request.headers)}${path}` } });

export async function proxy(request: NextRequest) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  const moved = legacySearchLocation(pathname, search);
  if (moved) return redirectTo(request, 308, moved);
  if (process.env.PAYLOAD_ENABLED !== 'false') {
    if (Date.now() >= cache.until) {
      loading ??= refresh(request.nextUrl.origin).finally(() => {
        loading = null;
      });
      await loading;
    }
    // Checked before the trailing slash is removed: an old "/address/" goes to its new page in one redirect.
    const rule = lookupRedirect(cache.map, pathname, search);
    if (rule) return redirectTo(request, rule.status, locationOf(rule.to));
  }
  // Next's own trailing-slash redirect is off (skipTrailingSlashRedirect) so the map sees the old form first; the
  // default behaviour is kept here: "/about/" -> 308 "/about".
  if (pathname.length > 1 && pathname.endsWith('/')) return redirectTo(request, 308, `${pathname.replace(/\/+$/, '')}${search}`);
  return NextResponse.next();
}

export const config = {
  // Not for the app's own machinery: assets, API (the map itself), the panel and the CMS admin.
  matcher: ['/((?!_next/|api/|yonetim|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)'],
};
