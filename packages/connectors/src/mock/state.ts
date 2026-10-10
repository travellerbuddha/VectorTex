import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where the MOCK connectors keep what a provider would keep (prebooks, payments, bookings). By default each process has
 * its own memory. The local demo runs the site and the worker as separate processes, like production does with the
 * real provider: there they must see the same MOCK "provider", or the worker cannot finish a booking the customer paid
 * for on the site. `fileMockState` gives them a shared folder (MOCK_STATE_DIR); never used outside the MOCK environment.
 */
export interface MockCollection<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  has(key: string): boolean;
  entries(): Array<[string, V]>;
}

export interface MockState {
  collection<V>(name: string): MockCollection<V>;
}

export function memoryMockState(): MockState {
  const all = new Map<string, Map<string, unknown>>();
  return {
    collection<V>(name: string): MockCollection<V> {
      const m = (all.get(name) ?? all.set(name, new Map()).get(name)!) as Map<string, V>;
      return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v), has: (k) => m.has(k), entries: () => [...m.entries()] };
    },
  };
}

// Money amounts are bigint: kept exact in the files.
const replacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? { $bigint: v.toString() } : v);
const reviver = (_k: string, v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && typeof (v as { $bigint?: unknown }).$bigint === 'string' ? BigInt((v as { $bigint: string }).$bigint) : v;

/** One JSON file per record (written whole, then renamed into place), read fresh on every access. */
export function fileMockState(dir: string): MockState {
  return {
    collection<V>(name: string): MockCollection<V> {
      const folder = join(dir, name);
      mkdirSync(folder, { recursive: true });
      // Keys are provider-style ids; base64url keeps every file name valid on Windows too.
      const file = (key: string) => join(folder, `${Buffer.from(key).toString('base64url')}.json`);
      const read = (path: string): V | undefined => {
        try {
          return JSON.parse(readFileSync(path, 'utf8'), reviver) as V;
        } catch {
          return undefined;
        }
      };
      return {
        get: (key) => read(file(key)),
        has: (key) => existsSync(file(key)),
        set: (key, value) => {
          const target = file(key);
          const tmp = `${target}.${process.pid}.tmp`;
          writeFileSync(tmp, JSON.stringify(value, replacer));
          renameSync(tmp, target);
        },
        entries: () =>
          readdirSync(folder)
            .filter((f) => f.endsWith('.json'))
            .flatMap((f) => {
              const v = read(join(folder, f));
              return v === undefined ? [] : [[Buffer.from(f.slice(0, -5), 'base64url').toString(), v] as [string, V]];
            }),
      };
    },
  };
}
