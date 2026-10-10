import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { signIn } from './admin-support';

/**
 * Scheduled publishing (ADR-0020): a publisher plans a draft page in the CMS; when the job is due it is published as
 * that person. A plan of someone without content.publish is refused when it is made. Due time is simulated by moving
 * the job's wait_until on the test database (the web process runs due jobs every minute; the test asks it at once).
 */
async function call(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
      return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
    },
    { method, path, body },
  );
}

const richText = (text: string) => ({
  root: { type: 'root', format: '', indent: 0, version: 1, direction: 'ltr', children: [{ type: 'paragraph', format: '', indent: 0, version: 1, direction: 'ltr', textFormat: 0, children: [{ type: 'text', text, format: 0, style: '', mode: 'normal', detail: 0, version: 1 }] }] },
});

async function plan(page: Page, pageId: string) {
  await page.goto(`/yonetim/icerik/collections/pages/${pageId}`);
  const publish = page.getByRole('button', { name: /^(Publish changes|Publish|Değişiklikleri yayınla|Yayınla)$/ });
  await expect(publish).toBeVisible();
  // The arrow beside the publish button opens its menu.
  await publish.locator('xpath=following::button[1]').click();
  await page.getByRole('button', { name: /Schedule Publish|Yayını Planla/ }).click();
}

test('scheduled publishing: a publisher plans a page, it goes live when due; editors are not offered it and a plan without content.publish does nothing', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'shared content');
  test.setTimeout(180_000);
  const slug = `planli-${Date.now().toString(36)}`;
  await signIn(page, 'admin');
  await page.goto('/yonetim');
  const created = await call(page, 'POST', '/api/cms/pages?locale=tr', { title: 'Planlı kampanya sayfası', slug, layout: [{ blockType: 'richText', content: richText('Yakında') }], _status: 'draft' });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  const pageId = String((created.json.doc as { id: unknown }).id);

  const visitor = await (await browser.newContext()).newPage();
  expect((await visitor.goto(`/tr/${slug}`))!.status()).toBe(404);

  // The publisher plans it for tomorrow 10:00.
  await plan(page, pageId);
  const drawer = page.getByRole('dialog');
  await drawer.getByRole('radio', { name: 'Publish', exact: true }).check({ force: true });
  const tomorrow = new Date(Date.now() + 86_400_000);
  const dd = String(tomorrow.getDate()).padStart(2, '0');
  const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
  await drawer.getByRole('textbox').first().fill(`${dd}.${mm}.${tomorrow.getFullYear()} 10:00`);
  await drawer.getByRole('textbox').first().press('Enter');
  await drawer.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Scheduled successfully|Başarıyla planlandı/)).toBeVisible();

  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  try {
    const jobs = async () =>
      (await db.query<{ id: number; wait_until: Date; has_error: boolean; completed_at: Date | null; input: Record<string, unknown> }>(
        `SELECT id, wait_until, has_error, completed_at, input FROM cms.payload_jobs WHERE task_slug = 'schedulePublish' AND input->'doc'->>'value' = $1 ORDER BY id`,
        [pageId],
      )).rows;
    const [job] = await jobs();
    expect(job!.input).toMatchObject({ type: 'publish', doc: { relationTo: 'pages' }, user: { relationTo: 'cms-users' } });
    expect(job!.wait_until.getTime()).toBeGreaterThan(Date.now());
    // Not due yet: running the queue changes nothing.
    expect((await call(page, 'GET', '/api/cms/payload-jobs/run?queue=default')).status).toBe(200);
    expect((await visitor.goto(`/tr/${slug}`))!.status()).toBe(404);

    // Due now (simulated): the run publishes it as the person who planned it.
    await db.query(`UPDATE cms.payload_jobs SET wait_until = now() - interval '1 minute' WHERE id = $1`, [job!.id]);
    expect((await call(page, 'GET', '/api/cms/payload-jobs/run?queue=default')).status).toBe(200);
    await expect.poll(async () => (await visitor.goto(`/tr/${slug}`))!.status(), { timeout: 70_000 }).toBe(200);
    await expect(visitor.getByRole('heading', { level: 1, name: 'Planlı kampanya sayfası' })).toBeVisible();
    // Done: the job is gone or completed, without an error.
    expect((await jobs()).filter((j) => j.has_error || !j.completed_at)).toEqual([]);

    // An editor (content.edit only) cannot plan: the plan is refused when it is made.
    const editorCtx = await browser.newContext();
    const editor = await editorCtx.newPage();
    await signIn(editor, 'editor');
    const draft = await call(editor, 'POST', '/api/cms/pages?locale=tr', { title: 'Editör taslağı', slug: `${slug}-editor`, layout: [{ blockType: 'richText', content: richText('Taslak') }], _status: 'draft' });
    expect(draft.status, JSON.stringify(draft.json)).toBe(201);
    const draftId = String((draft.json.doc as { id: unknown }).id);
    await editor.goto(`/yonetim/icerik/collections/pages/${draftId}`);
    await expect(editor.getByRole('button', { name: /Save Draft|Taslağı kaydet/ })).toBeVisible();
    // Neither "Publish" nor "Schedule publish" is offered to an editor.
    await expect(editor.getByRole('button', { name: /^(Publish changes|Publish|Değişiklikleri yayınla|Yayınla)$/ })).toHaveCount(0);
    await expect(editor.getByRole('button', { name: /Schedule Publish|Yayını Planla/ })).toHaveCount(0);
    const editorJobs = await db.query(`SELECT 1 FROM cms.payload_jobs WHERE task_slug = 'schedulePublish' AND input->'doc'->>'value' = $1`, [draftId]);
    expect(editorJobs.rows).toHaveLength(0);
    // The run endpoint is for publishers only.
    expect([401, 403]).toContain((await call(editor, 'GET', '/api/cms/payload-jobs/run?queue=default')).status);

    // A plan whose person no longer holds content.publish when it runs does nothing (written straight to the queue
    // table here, as an old plan of someone whose permission was revoked since).
    const editorUser = await db.query<{ id: number }>(`SELECT id FROM cms.cms_users WHERE email = 'editor@e2e.test'`);
    await db.query(
      `INSERT INTO cms.payload_jobs (input, task_slug, queue, wait_until) VALUES ($1, 'schedulePublish', 'default', now() - interval '1 minute')`,
      [JSON.stringify({ type: 'publish', doc: { relationTo: 'pages', value: draftId }, user: { relationTo: 'cms-users', value: editorUser.rows[0]!.id } })],
    );
    expect((await call(page, 'GET', '/api/cms/payload-jobs/run?queue=default')).status).toBe(200);
    await expect
      .poll(async () => (await db.query<{ has_error: boolean; total_tried: string }>(`SELECT has_error, total_tried FROM cms.payload_jobs WHERE input->'doc'->>'value' = $1`, [draftId])).rows[0]?.total_tried ?? '0', { timeout: 30_000 })
      .not.toBe('0');
    expect((await visitor.goto(`/tr/${slug}-editor`))!.status()).toBe(404);
    await editorCtx.close();
  } finally {
    await db.end();
  }
});
