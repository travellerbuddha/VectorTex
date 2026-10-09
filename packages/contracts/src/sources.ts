import { z } from 'zod';

export const sourceLockSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string(),
  note: z.string().optional(),
  sources: z.array(
    z
      .object({
        id: z.string(),
        provider: z.string(),
        kind: z.enum(['index', 'openapi', 'guide', 'npm-package']),
        url: z.string(),
        requiredFor: z.array(z.string()),
        status: z.enum(['PINNED', 'UNREACHABLE', 'NOT_ATTEMPTED']),
        sha256: z.string().optional(),
        integrity: z.string().optional(),
        fetchedAt: z.string().optional(),
        storedAs: z.string().optional(),
      })
      .passthrough(),
  ),
});

export type SourceLock = z.infer<typeof sourceLockSchema>;

export function parseSourceLock(json: unknown): SourceLock {
  return sourceLockSchema.parse(json);
}

/** Returns the ids among `required` that are not PINNED (unknown ids count as unpinned). */
export function unpinnedSources(lock: SourceLock, required: readonly string[]): string[] {
  const byId = new Map(lock.sources.map((s) => [s.id, s]));
  return required.filter((id) => byId.get(id)?.status !== 'PINNED');
}
