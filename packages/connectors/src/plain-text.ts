/**
 * Provider text (hotel descriptions) as plain paragraphs: markup is removed, never rendered. Block tags become line
 * breaks, entities are decoded, runs of whitespace collapse; paragraphs are separated by one blank line.
 */
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k.startsWith('#x')) return safeChar(parseInt(k.slice(2), 16)) ?? m;
    if (k.startsWith('#')) return safeChar(parseInt(k.slice(1), 10)) ?? m;
    return ENTITIES[k] ?? m;
  });
}

function safeChar(code: number): string | null {
  // No control characters and no lone surrogates.
  if (!Number.isFinite(code) || code < 0x20 || (code >= 0x7f && code < 0xa0) || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) return null;
  return String.fromCodePoint(code);
}

export function plainText(input: string | null | undefined, maxLength: number): string | null {
  if (!input) return null;
  const withBreaks = input
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr|ul|ol)\s*>/gi, '\n\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<[^>]*>/g, ' ');
  const paragraphs = decode(withBreaks)
    .replace(/<[^>]*>/g, ' ')
    .split(/\n\s*\n+/)
    .map((p) =>
      p
        .split('\n')
        .map((l) => l.replace(/[\s ]+/g, ' ').trim())
        .filter(Boolean)
        .join('\n'),
    )
    .filter(Boolean);
  if (paragraphs.length === 0) return null;
  const text = paragraphs.join('\n\n');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}
