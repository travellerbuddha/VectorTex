#!/usr/bin/env node
// Generates TypeScript types from PINNED provider OpenAPI documents only (contracts/sources/*.json).
// Unpinned specs are skipped and listed: connector request/response schemas are never hand-guessed.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(join(root, 'contracts', 'sources.lock.json'), 'utf8'));
const outDir = join(root, 'packages', 'connectors', 'src', 'generated');
mkdirSync(outDir, { recursive: true });

const skipped = [];
for (const src of lock.sources.filter((s) => s.kind === 'openapi')) {
  if (src.status !== 'PINNED' || !src.storedAs) {
    skipped.push(src.id);
    continue;
  }
  const out = join(outDir, `${src.id}.ts`);
  execFileSync(join(root, 'node_modules', '.bin', 'openapi-typescript'), [join(root, src.storedAs), '-o', out], { stdio: 'inherit' });
  console.log(`generated ${out} from ${src.id} sha256=${src.sha256}`);
}
if (skipped.length > 0) console.warn(`skipped (not pinned): ${skipped.join(', ')}`);
