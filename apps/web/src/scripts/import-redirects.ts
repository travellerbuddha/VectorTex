import { readFileSync } from 'node:fs';
import { getPayload } from 'payload';
import config from '../payload.config';
import { planRedirectImport } from '../server/redirects';

/**
 * Imports the old-site URL map (P17) from a CSV file: `pnpm cms:redirects:import <file.csv> [--apply]`.
 * Without --apply it only checks and prints the plan. With --apply it saves the rules in one transaction, and only if the
 * whole file passes the same checks as the CMS. Run by operations with database access (like staff:bootstrap); the note
 * of each rule records the import.
 */
const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error('Usage: pnpm cms:redirects:import <file.csv> [--apply]');
  process.exit(2);
}
const payload = await getPayload({ config });
const existing: Array<{ from: string; to: string }> = [];
for (let page = 1; ; page += 1) {
  const res = await payload.find({ collection: 'redirects', depth: 0, limit: 1000, page, overrideAccess: true });
  existing.push(...res.docs.map((d) => ({ from: String(d.from), to: String(d.to) })));
  if (!res.hasNextPage) break;
}
const plan = planRedirectImport(readFileSync(file, 'utf8'), existing);
for (const p of plan.problems) console.log(`satır ${p.line}: ${p.message}`);
console.log(`${plan.rules.length} kural geçerli, ${plan.problems.length} sorun.`);
if (plan.problems.length > 0 || flag !== '--apply') process.exit(plan.problems.length > 0 ? 1 : 0);
const stamp = new Date().toISOString().slice(0, 10);
const transactionID = await payload.db.beginTransaction();
try {
  for (const r of plan.rules) {
    await payload.create({
      collection: 'redirects',
      data: { from: r.from, to: r.to, status: String(r.status) as '301' | '308', note: r.note ?? `CSV içe aktarma ${stamp}` },
      overrideAccess: true,
      req: { transactionID: transactionID ?? undefined } as never,
    });
  }
  if (transactionID) await payload.db.commitTransaction(transactionID);
  console.log(`${plan.rules.length} kural kaydedildi.`);
  process.exit(0);
} catch (err) {
  if (transactionID) await payload.db.rollbackTransaction(transactionID);
  console.error(`Hiçbir kural kaydedilmedi: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
