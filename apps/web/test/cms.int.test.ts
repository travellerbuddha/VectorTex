import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, testDatabaseUrl } from '../../../packages/db/test/support/db';

/**
 * T30 (P06): CMS access through the Local API with `overrideAccess: false`, and the schema boundary to bookings and
 * money (ADR-0003). Users here are what the staff strategy attaches (permissions from /yonetim grants).
 */
let payload: Payload;
const user = (staffPermissions: string[]) => ({ id: 9_000 + staffPermissions.length, staffId: `t-${staffPermissions.join('+')}`, email: 'x@e.test', displayName: 'T', collection: 'cms-users', staffPermissions }) as never;
const editor = user(['content.edit']);
const publisher = user(['content.edit', 'content.publish']);
const outsider = user([]);
const page = (slug: string) => ({ title: 'Sayfa', slug, layout: [{ blockType: 'hero', heading: 'Merhaba' }] }) as never;

beforeAll(async () => {
  const core = await freshDatabase();
  await core.close();
  const admin = new pg.Client({ connectionString: testDatabaseUrl() });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS cms CASCADE');
  await admin.end();
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.PAYLOAD_SECRET = randomBytes(24).toString('hex');
  process.env.APP_ENV = 'test';
  const { getPayload } = await import('payload');
  const config = (await import('../src/payload.config')).default;
  payload = await getPayload({ config });
  await payload.db.migrate();
});
afterAll(async () => {
  await payload?.db?.destroy?.();
});

describe('CMS access (T30, overrideAccess: false)', () => {
  it('editors save drafts but cannot publish or delete; publishers can; visitors see published documents only', async () => {
    const draft = await payload.create({ collection: 'pages', data: page('t30-draft'), draft: true, overrideAccess: false, user: editor, locale: 'tr' });
    await expect(payload.update({ collection: 'pages', id: draft.id, data: { _status: 'published' } as never, overrideAccess: false, user: editor, locale: 'tr' })).rejects.toMatchObject({ status: 403 });
    await expect(payload.delete({ collection: 'pages', id: draft.id, overrideAccess: false, user: editor })).rejects.toMatchObject({ status: 403 });

    const visitorBefore = await payload.find({ collection: 'pages', where: { slug: { equals: 't30-draft' } }, overrideAccess: false, locale: 'tr' });
    expect(visitorBefore.docs).toHaveLength(0);
    await payload.update({ collection: 'pages', id: draft.id, data: { _status: 'published' } as never, overrideAccess: false, user: publisher, locale: 'tr' });
    const visitorAfter = await payload.find({ collection: 'pages', where: { slug: { equals: 't30-draft' } }, overrideAccess: false, locale: 'tr' });
    expect(visitorAfter.docs.map((d) => d.id)).toEqual([draft.id]);
    await payload.delete({ collection: 'pages', id: draft.id, overrideAccess: false, user: publisher });
  });

  it('staff without content permissions can neither create nor see drafts; CMS users cannot be created or edited in the CMS', async () => {
    await expect(payload.create({ collection: 'pages', data: page('t30-outsider'), draft: true, overrideAccess: false, user: outsider, locale: 'tr' })).rejects.toMatchObject({ status: 403 });
    await payload.create({ collection: 'pages', data: page('t30-hidden'), draft: true, overrideAccess: false, user: editor, locale: 'tr' });
    expect((await payload.find({ collection: 'pages', where: { slug: { equals: 't30-hidden' } }, overrideAccess: false, user: outsider, locale: 'tr' })).docs).toHaveLength(0);
    expect((await payload.find({ collection: 'pages', where: { slug: { equals: 't30-hidden' } }, draft: true, overrideAccess: false, user: editor, locale: 'tr' })).docs).toHaveLength(1);
    await expect(payload.create({ collection: 'cms-users', data: { staffId: 'x', email: 'x', displayName: 'x' } as never, overrideAccess: false, user: publisher })).rejects.toMatchObject({ status: 403 });
  });

  it('menus change the live site: editing them needs both content permissions; only safe links are accepted', async () => {
    const items = [{ label: 'Antalya', href: '/tr/destinations/antalya' }];
    await expect(payload.updateGlobal({ slug: 'navigation', data: { items } as never, overrideAccess: false, user: editor, locale: 'tr' })).rejects.toMatchObject({ status: 403 });
    await payload.updateGlobal({ slug: 'navigation', data: { items } as never, overrideAccess: false, user: publisher, locale: 'tr' });
    await expect(payload.updateGlobal({ slug: 'navigation', data: { items: [{ label: 'x', href: 'javascript:alert(1)' }] } as never, overrideAccess: false, user: publisher, locale: 'tr' })).rejects.toThrow();
    const nav = await payload.findGlobal({ slug: 'navigation', overrideAccess: false, locale: 'tr' });
    expect((nav as { items: Array<{ href: string }> }).items.map((i) => i.href)).toEqual(['/tr/destinations/antalya']);
  });

  it('page addresses: lowercase words only, never a path of the booking engine or the panel', async () => {
    await expect(payload.create({ collection: 'pages', data: page('Bad Slug'), draft: true, overrideAccess: false, user: editor, locale: 'tr' })).rejects.toThrow();
    await expect(payload.create({ collection: 'pages', data: page('checkout'), draft: true, overrideAccess: false, user: editor, locale: 'tr' })).rejects.toThrow();
    await expect(payload.create({ collection: 'pages', data: page('yonetim'), draft: true, overrideAccess: false, user: editor, locale: 'tr' })).rejects.toThrow();
  });

  it('campaigns are text: they have no price, rate or amount field', () => {
    const fields = payload.collections.campaigns.config.flattenedFields.map((f) => f.name);
    expect(fields.filter((n) => /price|amount|discount|rate|margin|total/i.test(n))).toEqual([]);
  });
});

describe('schema boundary (ADR-0003)', () => {
  it('every CMS table lives in the cms schema; a database role limited to cms cannot change bookings or money', async () => {
    const admin = new pg.Client({ connectionString: testDatabaseUrl() });
    await admin.connect();
    try {
      const leaked = await admin.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'core' AND (table_name LIKE 'payload%' OR table_name LIKE '%pages%' OR table_name LIKE 'cms%')`);
      expect(leaked.rows).toEqual([]);
      const role = `cms_only_${randomBytes(4).toString('hex')}`;
      const password = randomBytes(16).toString('hex');
      await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
      await admin.query(`GRANT USAGE ON SCHEMA cms TO ${role}; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA cms TO ${role}; GRANT USAGE ON ALL SEQUENCES IN SCHEMA cms TO ${role}`);
      const url = new URL(testDatabaseUrl());
      url.username = role;
      url.password = password;
      const cmsRole = new pg.Client({ connectionString: url.toString() });
      await cmsRole.connect();
      try {
        await expect(cmsRole.query('UPDATE core.orders SET status = status')).rejects.toThrow(/permission denied/);
        await expect(cmsRole.query('SELECT count(*) FROM core.payment_attempts')).rejects.toThrow(/permission denied/);
        expect((await cmsRole.query('SELECT count(*)::int AS n FROM cms.pages')).rows[0].n).toBeGreaterThanOrEqual(0);
      } finally {
        await cmsRole.end();
        await admin.query(`REVOKE ALL ON ALL TABLES IN SCHEMA cms FROM ${role}; REVOKE ALL ON ALL SEQUENCES IN SCHEMA cms FROM ${role}; REVOKE USAGE ON SCHEMA cms FROM ${role}; DROP ROLE ${role}`);
      }
    } finally {
      await admin.end();
    }
  });
});
