import { describe, expect, it } from 'vitest';
import { buildRedirectMap, chainProblem, locationOf, lookupRedirect, normalizeSitePath, parseCsv, planRedirectImport, redirectProblem } from '../src/server/redirects';
import { robotsRules, sitemapEntries } from '../src/server/seo';

describe('P17 old-site address map', () => {
  it('keeps one canonical form per path: decoded, single slashes, no trailing slash, query kept', () => {
    expect(normalizeSitePath('/antalya-otelleri/')).toBe('/antalya-otelleri');
    expect(normalizeSitePath('/kemer/%C3%A7ocuk-dostu-oteller/')).toBe('/kemer/çocuk-dostu-oteller');
    expect(normalizeSitePath('/a//b///')).toBe('/a/b');
    expect(normalizeSitePath('/?p=123')).toBe('/?p=123');
    expect(normalizeSitePath('/')).toBe('/');
  });

  it('refuses anything that is not a same-site path (no open redirect)', () => {
    for (const bad of ['https://evil.example/x', '//evil.example/x', '/\\evil.example', 'antalya', '', '/%2F%2Fevil.example', '/bad%zzencoding', '/a b', '/x#frag']) {
      expect(normalizeSitePath(bad)).toBeNull();
    }
    expect(redirectProblem({ from: '/eski', to: 'https://evil.example/' })).toMatchObject({ field: 'to' });
    expect(redirectProblem({ from: '/eski', to: '//evil.example' })).toMatchObject({ field: 'to' });
  });

  it('never captures the home page, the API or the panel, and never points to itself', () => {
    expect(redirectProblem({ from: '/', to: '/tr' })).toMatchObject({ field: 'from' });
    expect(redirectProblem({ from: '/api/v1/quotes', to: '/tr' })).toMatchObject({ field: 'from' });
    expect(redirectProblem({ from: '/yonetim/giris', to: '/tr' })).toMatchObject({ field: 'from' });
    expect(redirectProblem({ from: '/eski', to: '/yonetim' })).toMatchObject({ field: 'to' });
    expect(redirectProblem({ from: '/eski/', to: '/eski' })).toMatchObject({ field: 'to' });
    expect(redirectProblem({ from: '/antalya-otelleri/', to: '/tr/destinations/antalya' })).toBeNull();
  });

  it('refuses chains when saving: a target that already redirects, or a source that is another rule target', () => {
    const others = [{ from: '/a', to: '/tr/b' }];
    expect(chainProblem({ from: '/c', to: '/a' }, others)).toMatchObject({ field: 'to' });
    expect(chainProblem({ from: '/tr/b', to: '/tr/c' }, others)).toMatchObject({ field: 'from' });
    expect(chainProblem({ from: '/d', to: '/tr/b' }, others)).toBeNull();
  });

  it('serves exact matches (query first), follows a leftover chain and ignores loops and invalid rows', () => {
    const map = buildRedirectMap([
      { from: '/antalya-otelleri/', to: '/tr/destinations/antalya', status: '301' },
      { from: '/?p=123', to: '/tr/kampanya', status: '308' },
      { from: '/x', to: '/y', status: '301' },
      { from: '/y', to: '/tr/z', status: '301' },
      { from: '/loop-a', to: '/loop-b', status: '301' },
      { from: '/loop-b', to: '/loop-a', status: '301' },
      { from: 'https://evil.example', to: '/tr', status: '301' },
    ]);
    expect(map.size).toBe(6);
    expect(lookupRedirect(map, '/antalya-otelleri', '')).toEqual({ from: '/antalya-otelleri', to: '/tr/destinations/antalya', status: 301 });
    expect(lookupRedirect(map, '/antalya-otelleri/', '?utm_source=x')).toMatchObject({ to: '/tr/destinations/antalya' });
    expect(lookupRedirect(map, '/', '?p=123')).toEqual({ from: '/?p=123', to: '/tr/kampanya', status: 308 });
    expect(lookupRedirect(map, '/x', '')).toMatchObject({ to: '/tr/z' });
    expect(lookupRedirect(map, '/loop-a', '')).toBeNull();
    expect(lookupRedirect(map, '/tr/antalya', '')).toBeNull();
    expect(lookupRedirect(map, '/api/cms-redirects', '')).toBeNull();
  });

  it('encodes the Location header (Turkish letters) and keeps the query', () => {
    expect(locationOf('/tr/çocuk-dostu?a=1')).toBe('/tr/%C3%A7ocuk-dostu?a=1');
  });
});

describe('P17 URL map import (CSV)', () => {
  it('reads quoted CSV fields', () => {
    expect(parseCsv('from,to,note\r\n"/a,b/","/tr/x","say ""hi"""\n\n')).toEqual([
      ['from', 'to', 'note'],
      ['/a,b/', '/tr/x', 'say "hi"'],
    ]);
  });

  it('plans a clean file and reports every problem with its line before anything is saved', () => {
    const ok = planRedirectImport('from,to,status,note\n/antalya-otelleri/,/tr/destinations/antalya,,eski menü\n/?p=12,/tr/kampanya,308,\n', [{ from: '/eski', to: '/tr' }]);
    expect(ok.problems).toEqual([]);
    expect(ok.rules).toEqual([
      { from: '/antalya-otelleri', to: '/tr/destinations/antalya', status: 301, note: 'eski menü' },
      { from: '/?p=12', to: '/tr/kampanya', status: 308, note: null },
    ]);
    const bad = planRedirectImport(
      ['from,to,status', '/a,https://evil.example/,301', '/b,/tr/b,302', '/c/,/tr/c,', '/c,/tr/c2,', '/eski,/tr/x,', '/d,/c,', '/yonetim/x,/tr,'].join('\n'),
      [{ from: '/eski', to: '/tr' }],
    );
    // 2 off-site, 3 bad status, 4 and 7 both ends of a chain (/d -> /c -> /tr/c), 5 duplicate, 6 already saved, 8 panel.
    expect(bad.problems.map((p) => p.line)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(planRedirectImport('eski,yeni\n/a,/b', []).problems).toEqual([{ line: 1, message: expect.stringContaining('from,to') }]);
  });
});

describe('P17 sitemap and robots', () => {
  it('lists fixed pages and each published language version with hreflang alternates; noindex pages are left out', () => {
    const entries = sitemapEntries('https://www.example.test/', [
      { collection: 'destinations', slugs: { tr: 'antalya', en: 'antalya' }, noindex: false, updatedAt: '2026-10-09T10:00:00.000Z' },
      { collection: 'pages', slugs: { tr: 'hakkimizda', en: null }, noindex: false, updatedAt: null },
      { collection: 'pages', slugs: { tr: 'gizli', en: 'hidden' }, noindex: true, updatedAt: null },
    ]);
    const urls = entries.map((e) => e.url);
    expect(urls).toEqual([
      'https://www.example.test/tr',
      'https://www.example.test/en',
      'https://www.example.test/tr/terms',
      'https://www.example.test/en/terms',
      'https://www.example.test/tr/oteller',
      'https://www.example.test/en/hotels',
      'https://www.example.test/tr/destinations/antalya',
      'https://www.example.test/en/destinations/antalya',
      'https://www.example.test/tr/hakkimizda',
    ]);
    expect(entries[6]).toMatchObject({ lastModified: new Date('2026-10-09T10:00:00.000Z'), alternates: { languages: { tr: 'https://www.example.test/tr/destinations/antalya', en: 'https://www.example.test/en/destinations/antalya' } } });
    expect(entries[8]!.alternates).toEqual({ languages: { tr: 'https://www.example.test/tr/hakkimizda' } });
  });

  it('only production is indexed; booking, order and panel paths are never crawled', () => {
    expect(robotsRules('staging', 'https://staging.example.test')).toEqual({ rules: { userAgent: '*', disallow: '/' } });
    expect(robotsRules('production', undefined)).toEqual({ rules: { userAgent: '*', disallow: '/' } });
    const prod = robotsRules('production', 'https://www.example.test/');
    expect(prod.sitemap).toBe('https://www.example.test/sitemap.xml');
    expect(prod.rules).toMatchObject({ allow: '/', disallow: expect.arrayContaining(['/yonetim', '/api/', '/tr/checkout/', '/en/orders/', '/tr/search/', '/tr/hesabim', '/en/account']) });
    expect((prod.rules as { disallow: string[] }).disallow).not.toContain('/en/hotels/');
  });
});
