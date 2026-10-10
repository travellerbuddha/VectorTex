/**
 * Public origin for absolute URLs (provider return URL, setup links, redirects in the proxy). PUBLIC_BASE_URL wins;
 * otherwise the host the visitor used. No Next.js server-only imports here: the proxy uses it too.
 */
export function originOf(headers: { get(name: string): string | null }): string {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/$/, '');
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost:3000';
  const proto = headers.get('x-forwarded-proto') ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}
