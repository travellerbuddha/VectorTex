/** Client-side API helper: JSON in/out, the public error body (§14) surfaced as ApiError. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly issues: ReadonlyArray<{ path: string; message: string }> = [],
    readonly status = 0,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw new ApiError(String(json?.code ?? 'INTERNAL'), String(json?.message ?? res.statusText), (json?.issues as ApiError['issues']) ?? [], res.status);
  return json as T;
}

export function newIdempotencyKey(): string {
  return `web-${crypto.randomUUID()}`;
}
