/**
 * Minimal HTTP port for adapters. Adapters get a transport injected so tests can simulate
 * timeouts, resets and malformed bodies without network access.
 */
export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers: Readonly<Record<string, string>>;
  body?: string;
  timeoutMs: number;
}

export interface HttpResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: string;
}

/** NO_RESPONSE means the request may or may not have been processed upstream. */
export type HttpResult =
  | { kind: 'RESPONSE'; response: HttpResponse; durationMs: number }
  | { kind: 'NO_RESPONSE'; reason: 'TIMEOUT' | 'NETWORK'; detail: string; durationMs: number };

export interface HttpTransport {
  send(request: HttpRequest): Promise<HttpResult>;
}

export const fetchTransport: HttpTransport = {
  async send(request) {
    const started = Date.now();
    try {
      const res = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: AbortSignal.timeout(request.timeoutMs),
        redirect: 'error',
      });
      const body = await res.text();
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      return { kind: 'RESPONSE', response: { status: res.status, headers, body }, durationMs: Date.now() - started };
    } catch (err) {
      const name = (err as { name?: string }).name;
      const reason = name === 'TimeoutError' || name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
      return { kind: 'NO_RESPONSE', reason, detail: String((err as Error).message ?? err), durationMs: Date.now() - started };
    }
  },
};

/**
 * Parses JSON keeping the exact source text of every number (Node >= 22 reviver context), so money is
 * never read through a binary float. Returns null on malformed input.
 */
export function parseJsonPreservingNumbers(text: string): { value: unknown; numberSource: Map<object, Map<string, string>> } | null {
  const numberSource = new Map<object, Map<string, string>>();
  try {
    const value = JSON.parse(text, function (this: object, key: string, val: unknown, context?: { source?: string }) {
      if (typeof val === 'number' && context?.source !== undefined) {
        let byKey = numberSource.get(this);
        if (!byKey) {
          byKey = new Map();
          numberSource.set(this, byKey);
        }
        byKey.set(key, context.source);
      }
      return val;
    } as (this: unknown, key: string, value: unknown) => unknown);
    return { value, numberSource };
  } catch {
    return null;
  }
}

/** Exact decimal text of a numeric field (or a string field) of a parsed object. */
export function exactDecimal(parsed: { numberSource: Map<object, Map<string, string>> }, obj: object, key: string): string | null {
  const raw = (obj as Record<string, unknown>)[key];
  if (typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw)) return raw;
  if (typeof raw !== 'number') return null;
  const src = parsed.numberSource.get(obj)?.get(key);
  return src !== undefined && /^-?\d+(\.\d+)?$/.test(src) ? src : null;
}
