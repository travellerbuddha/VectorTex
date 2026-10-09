#!/usr/bin/env node
// Pins external provider contracts (OpenAPI specs, guides) by date + SHA-256.
//
// Usage:
//   node scripts/pin-contracts.mjs            fetch every source, store the body, update the lock
//   node scripts/pin-contracts.mjs --check    verify stored bodies still match the lock (CI, offline)
//
// A source that cannot be fetched keeps status UNREACHABLE; nothing is invented in its place.
// Connector code reads contracts/sources.lock.json at startup: a production connector whose
// required source is not PINNED refuses to enable (see packages/contracts/src/source-lock.ts).

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = join(root, 'contracts', 'sources.lock.json');
const storeDir = join(root, 'contracts', 'sources');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function loadLock() {
  return JSON.parse(await readFile(lockPath, 'utf8'));
}

async function check() {
  const lock = await loadLock();
  let failures = 0;
  for (const src of lock.sources) {
    if (src.status !== 'PINNED' || !src.storedAs) continue;
    const body = await readFile(join(root, src.storedAs));
    const actual = sha256(body);
    if (actual !== src.sha256) {
      console.error(`HASH MISMATCH ${src.id}: lock=${src.sha256} actual=${actual}`);
      failures += 1;
    }
  }
  const pinned = lock.sources.filter((s) => s.status === 'PINNED').length;
  console.log(`checked ${pinned} pinned sources, ${failures} mismatches`);
  process.exit(failures === 0 ? 0 : 1);
}

async function pin() {
  const lock = await loadLock();
  await mkdir(storeDir, { recursive: true });
  const now = new Date().toISOString();
  for (const src of lock.sources) {
    if (src.kind === 'npm-package') continue; // pinned through pnpm-lock / npm integrity
    try {
      const res = await fetch(src.url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      const digest = sha256(body);
      const storedAs = join('contracts', 'sources', `${src.id}${src.url.endsWith('.json') ? '.json' : '.txt'}`);
      if (src.status === 'PINNED' && src.sha256 && src.sha256 !== digest) {
        // A changed upstream contract is a review event, never a silent update.
        src.upstreamChangedAt = now;
        src.upstreamSha256 = digest;
        await writeFile(join(root, `${storedAs}.upstream`), body);
        console.warn(`UPSTREAM CHANGED ${src.id}: review ${storedAs}.upstream before re-pinning`);
        continue;
      }
      await writeFile(join(root, storedAs), body);
      Object.assign(src, { status: 'PINNED', sha256: digest, fetchedAt: now, storedAs, lastError: null });
      console.log(`PINNED ${src.id} ${digest}`);
    } catch (err) {
      if (src.status !== 'PINNED') {
        Object.assign(src, { status: 'UNREACHABLE', lastAttemptAt: now, lastError: String(err?.cause?.message ?? err.message) });
      }
      console.warn(`UNREACHABLE ${src.id}: ${String(err?.cause?.message ?? err.message)}`);
    }
  }
  lock.updatedAt = now;
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

if (process.argv.includes('--check')) await check();
else await pin();
