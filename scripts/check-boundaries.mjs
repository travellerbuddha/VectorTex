#!/usr/bin/env node
// Enforces ADR-0001 dependency rules: the domain never imports providers, gateways, DB or HTTP;
// gateways and connectors never import each other; no provider SDK is a runtime dependency.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const RULES = {
  pricing: { allowWorkspace: [], forbidden: [/^pg$/, /^drizzle-orm/, /^bullmq/, /^ioredis/] },
  config: { allowWorkspace: [], forbidden: [] },
  contracts: { allowWorkspace: ['pricing'], forbidden: [/^pg$/, /^drizzle-orm/, /^bullmq/] },
  domain: {
    allowWorkspace: ['contracts', 'pricing'],
    forbidden: [/^pg$/, /^drizzle-orm/, /^bullmq/, /^ioredis/, /^node:http/, /^node:https/, /^undici/],
    forbiddenText: [/\bfetch\s*\(/, /iyzi/i, /liteapi/i],
  },
  db: { allowWorkspace: ['contracts', 'domain', 'pricing'], forbidden: [/^bullmq/] },
  payments: { allowWorkspace: ['contracts', 'pricing'], forbidden: [/^pg$/, /^drizzle-orm/] },
  connectors: { allowWorkspace: ['contracts', 'pricing'], forbidden: [/^pg$/, /^drizzle-orm/] },
  // Application services compose the layers; no queue client and no payment gateway shortcuts here.
  booking: { allowWorkspace: ['contracts', 'domain', 'pricing', 'db', 'connectors'], forbidden: [/^bullmq/, /^ioredis/] },
  // Staff panel services: no provider connectors, gateways or queues (commands go through the outbox, ADR-0004).
  admin: { allowWorkspace: ['contracts', 'db', 'pricing'], forbidden: [/^bullmq/, /^ioredis/] },
};
const GLOBAL_FORBIDDEN = [/^iyzipay$/, /^liteapi-node-sdk$/];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.name.endsWith('.ts')) yield p;
  }
}

const importRe = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const violations = [];

for (const [pkg, rule] of Object.entries(RULES)) {
  const srcDir = join(root, 'packages', pkg, 'src');
  for await (const file of walk(srcDir)) {
    const text = await readFile(file, 'utf8');
    const rel = relative(root, file);
    for (const m of text.matchAll(importRe)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith('@texholiday/')) {
        const target = spec.split('/')[1];
        if (!rule.allowWorkspace.includes(target)) violations.push(`${rel}: ${pkg} must not import ${spec}`);
      }
      for (const re of [...rule.forbidden, ...GLOBAL_FORBIDDEN]) if (re.test(spec)) violations.push(`${rel}: forbidden import ${spec}`);
    }
    for (const re of rule.forbiddenText ?? []) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (re.test(code)) violations.push(`${rel}: forbidden reference ${re} in ${pkg}`);
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log('boundaries OK');
