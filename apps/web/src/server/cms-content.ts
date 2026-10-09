import { draftMode } from 'next/headers';
import type { Payload } from 'payload';
import { CMS_USERS, type CmsUser } from '../payload/access';
import { mirrorCmsUser } from '../payload/staff-strategy';
import type { Locale } from '../i18n/dictionaries';
import { currentSession } from './admin';
import { cms, cmsEnabled } from './cms';

/**
 * Site-side reads of CMS content (P06). Always through the Local API with `overrideAccess: false`: visitors get
 * published documents only; a draft preview runs as the signed-in content staff member (T30).
 */
export type CmsDoc = Record<string, unknown> & { id: number | string };

/** The content user of the signed-in staff member when a preview is on; null for everyone else. */
async function previewUser(payload: Payload): Promise<CmsUser | null> {
  if (!(await draftMode()).isEnabled) return null;
  const s = await currentSession();
  if (!s || s.stage !== 'ACTIVE') return null;
  const staffPermissions = [...s.staff.permissions].filter((p) => p === 'content.edit' || p === 'content.publish');
  if (staffPermissions.length === 0) return null;
  return { ...(await mirrorCmsUser(payload, s.staff)), staffPermissions };
}

export interface Loaded {
  doc: CmsDoc;
  /** The document's address per language (for hreflang and the language switch). */
  slugs: Partial<Record<Locale, string>>;
  preview: boolean;
}

/** A page or destination by its address in `locale`; drafts only in an authorized preview. */
export async function loadBySlug(collection: 'pages' | 'destinations', slug: string, locale: Locale): Promise<Loaded | null> {
  if (!cmsEnabled() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  const payload = await cms();
  const user = await previewUser(payload);
  const draft = user !== null;
  const res = await payload.find({
    collection,
    where: { slug: { equals: slug } },
    locale,
    depth: 2,
    limit: 1,
    draft,
    overrideAccess: false,
    ...(user ? { user: { ...user, collection: CMS_USERS } as never } : {}),
  });
  const doc = res.docs[0] as CmsDoc | undefined;
  if (!doc) return null;
  const all = (await payload.findByID({ collection, id: doc.id, locale: 'all', depth: 0, draft, overrideAccess: false, ...(user ? { user: { ...user, collection: CMS_USERS } as never } : {}) })) as CmsDoc;
  const slugs = (all.slug ?? {}) as Partial<Record<Locale, string>>;
  return { doc, slugs, preview: draft };
}

export interface SiteChrome {
  nav: Array<{ label: string; href: string }>;
  footer: { columns: Array<{ heading: string | null; links: Array<{ label: string; href: string }> }>; legal: string | null } | null;
}

/** Menu and footer from the CMS (empty when the CMS is off or nothing was entered). */
export async function siteChrome(locale: Locale): Promise<SiteChrome> {
  if (!cmsEnabled()) return { nav: [], footer: null };
  try {
    const payload = await cms();
    const [nav, footer] = await Promise.all([
      payload.findGlobal({ slug: 'navigation', locale, depth: 0, overrideAccess: false }),
      payload.findGlobal({ slug: 'footer', locale, depth: 0, overrideAccess: false }),
    ]);
    const items = ((nav as { items?: Array<{ label?: string; href?: string }> }).items ?? []).filter((i) => i.label && i.href) as Array<{ label: string; href: string }>;
    const f = footer as { columns?: Array<{ heading?: string | null; links?: Array<{ label?: string; href?: string }> }>; legal?: string | null };
    const columns = (f.columns ?? []).map((c) => ({ heading: c.heading ?? null, links: (c.links ?? []).filter((l) => l.label && l.href) as Array<{ label: string; href: string }> }));
    return { nav: items, footer: columns.length > 0 || f.legal ? { columns, legal: f.legal ?? null } : null };
  } catch (err) {
    // The site keeps working without CMS chrome (e.g. CMS migrations not applied yet).
    console.error(JSON.stringify({ level: 'error', msg: 'cms chrome unavailable', error: err instanceof Error ? err.message : String(err) }));
    return { nav: [], footer: null };
  }
}
