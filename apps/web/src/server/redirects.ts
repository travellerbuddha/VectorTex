/**
 * Old-site address map (P17, spec §17: "zorunlu değişiklik uygun bire bir 301 ile yönetilir"). Editors keep the map in
 * the CMS; the proxy answers a matching request with a permanent redirect before any page renders. Pure functions here
 * so the same rules apply when saving (CMS) and when serving (proxy).
 */
export type RedirectStatus = 301 | 308;

export interface RedirectRule {
  from: string;
  to: string;
  status: RedirectStatus;
}

/** Paths of the running application that a redirect may never capture (they would break the site or the panel). */
const PROTECTED_PREFIXES = ['/_next', '/api', '/yonetim'];
const MAX_LENGTH = 500;
const MAX_HOPS = 5;

/**
 * Canonical form of a site path: starts with one "/", percent-decoded (old WordPress addresses carry encoded Turkish
 * letters), no trailing slash except the root, the query string kept as written. Returns null for anything that is not a
 * same-site path: absolute or protocol-relative URLs, backslashes, control characters, broken encoding.
 */
export function normalizeSitePath(input: string): string | null {
  const raw = input.trim();
  if (raw.length === 0 || raw.length > MAX_LENGTH || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  const q = raw.indexOf('?');
  const pathPart = q === -1 ? raw : raw.slice(0, q);
  const query = q === -1 ? '' : raw.slice(q);
  if (pathPart.includes('#') || query.includes('#')) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    return null;
  }
  if (/[\u0000-\u001f\u007f\s]/.test(decoded) || decoded.startsWith('//') || decoded.includes('\\')) return null;
  const collapsed = decoded.replace(/\/{2,}/g, '/');
  const path = collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
  return `${path}${query === '?' ? '' : query}`;
}

const isProtected = (path: string) => PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`));

/** Why a rule cannot be saved (Turkish, shown to editors), or null when it is valid. */
export function redirectProblem(rule: { from: unknown; to: unknown }): { field: 'from' | 'to'; message: string } | null {
  const from = typeof rule.from === 'string' ? normalizeSitePath(rule.from) : null;
  if (!from) return { field: 'from', message: 'Eski adres "/" ile başlayan bir site içi yol olmalı (ör. /antalya-otelleri/).' };
  if (from === '/') return { field: 'from', message: 'Ana sayfa yönlendirilemez.' };
  if (isProtected(from)) return { field: 'from', message: 'Bu adres sitenin çalışan bir bölümüne ait (/api, /yonetim); yönlendirilemez.' };
  const to = typeof rule.to === 'string' ? normalizeSitePath(rule.to) : null;
  if (!to) return { field: 'to', message: 'Yeni adres "/" ile başlayan bir site içi yol olmalı (ör. /tr/antalya). Başka sitelere yönlendirme yapılmaz.' };
  if (isProtected(to)) return { field: 'to', message: 'Yeni adres /api veya /yonetim altında olamaz.' };
  if (to === from) return { field: 'to', message: 'Yeni adres eski adresle aynı olamaz.' };
  return null;
}

/**
 * Chains are refused when saving: an address that already redirects cannot be a target, and a target of another rule
 * cannot start redirecting (point the old rule straight to the final address instead). Returns the message or null.
 */
export function chainProblem(rule: { from: string; to: string }, others: readonly { from: string; to: string }[]): { field: 'from' | 'to'; message: string } | null {
  if (others.some((o) => o.from === rule.to)) return { field: 'to', message: `${rule.to} adresi zaten başka bir yere yönleniyor; zincir olmaması için doğrudan son adresi girin.` };
  const pointing = others.find((o) => o.to === rule.from);
  if (pointing) return { field: 'from', message: `${pointing.from} kaydı bu adrese yönleniyor; önce o kaydı doğrudan ${rule.to} adresine çevirin.` };
  return null;
}

/** The serving map. Invalid rows are skipped; a chain left by a manual database change is followed at most 5 hops. */
export function buildRedirectMap(rules: readonly { from: unknown; to: unknown; status?: unknown }[]): Map<string, RedirectRule> {
  const map = new Map<string, RedirectRule>();
  for (const r of rules) {
    if (redirectProblem(r)) continue;
    const from = normalizeSitePath(r.from as string)!;
    map.set(from, { from, to: normalizeSitePath(r.to as string)!, status: Number(r.status) === 308 ? 308 : 301 });
  }
  return map;
}

/** The redirect for a request (exact path with its query first, then the path alone), or null. Loops yield null. */
export function lookupRedirect(map: ReadonlyMap<string, RedirectRule>, pathname: string, search: string): RedirectRule | null {
  if (map.size === 0) return null;
  const path = normalizeSitePath(pathname);
  if (!path || isProtected(path)) return null;
  const withQuery = search && search !== '?' ? normalizeSitePath(`${pathname}${search}`) : null;
  const first = (withQuery ? map.get(withQuery) : undefined) ?? map.get(path);
  if (!first) return null;
  let current = first;
  const seen = new Set([first.from]);
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const next = map.get(current.to);
    if (!next) return { ...first, to: current.to };
    if (seen.has(next.from)) return null;
    seen.add(next.from);
    current = next;
  }
  return null;
}

/** Location header value: the decoded path re-encoded for HTTP (Turkish letters, spaces). */
export function locationOf(to: string): string {
  const q = to.indexOf('?');
  const path = q === -1 ? to : to.slice(0, q);
  return `${encodeURI(path)}${q === -1 ? '' : to.slice(q)}`;
}

/** Minimal RFC 4180 CSV reader (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export interface ImportPlan {
  rules: Array<RedirectRule & { note: string | null }>;
  problems: Array<{ line: number; message: string }>;
}

/**
 * Checks a whole map before anything is saved (P17 URL map from the old-site inventory): header `from,to[,status][,note]`,
 * the same rules as the CMS, duplicates and chains within the file and against rules already saved. Nothing is imported
 * unless the plan has no problems.
 */
export function planRedirectImport(csv: string, existing: readonly { from: string; to: string }[]): ImportPlan {
  const rows = parseCsv(csv);
  const problems: ImportPlan['problems'] = [];
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  if (col('from') === -1 || col('to') === -1) return { rules: [], problems: [{ line: 1, message: 'İlk satır başlık olmalı: from,to[,status][,note]' }] };
  const rules: ImportPlan['rules'] = [];
  const seen = new Map<string, number>();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (name: string) => (col(name) === -1 ? '' : (r[col(name)] ?? '').trim());
    const problem = redirectProblem({ from: get('from'), to: get('to') });
    if (problem) return problems.push({ line, message: `${problem.field}: ${problem.message}` });
    const status = get('status') === '' ? '301' : get('status');
    if (status !== '301' && status !== '308') return problems.push({ line, message: 'status: 301 veya 308 olmalı' });
    const from = normalizeSitePath(get('from'))!;
    const to = normalizeSitePath(get('to'))!;
    if (seen.has(from)) return problems.push({ line, message: `from: ${from} dosyada ${seen.get(from)}. satırda da var` });
    if (existing.some((e) => e.from === from)) return problems.push({ line, message: `from: ${from} için zaten bir yönlendirme var` });
    seen.set(from, line);
    rules.push({ from, to, status: Number(status) as RedirectStatus, note: get('note') || null });
  });
  const all = [...existing, ...rules];
  rules.forEach((r) => {
    const chain = chainProblem(r, all.filter((o) => o.from !== r.from));
    if (chain) problems.push({ line: (seen.get(r.from) ?? 0), message: `${chain.field}: ${chain.message}` });
  });
  return { rules, problems: problems.sort((a, b) => a.line - b.line) };
}

/**
 * Search results moved from /{l}/hotels/{session} to /{l}/search/hotels/{session} (ADR-0014): /en/hotels/ now holds the
 * public hotel lists. Only a session id (a UUID) is moved, with its query string; anything else is a list address.
 */
export function legacySearchLocation(pathname: string, search: string): string | null {
  const m = /^\/(tr|en)\/hotels\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(pathname);
  return m ? `/${m[1]}/search/hotels/${m[2]}${search}` : null;
}
