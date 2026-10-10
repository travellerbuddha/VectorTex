/**
 * Wall-clock <-> instant conversion for provider deadlines expressed in a local IANA timezone,
 * using only Intl (no tz database copy in the repo).
 */

function offsetMinutesAt(timeZone: string, epochMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(epochMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60_000);
}

export class InvalidLocalTimeError extends Error {
  constructor(value: string) {
    super(`Invalid local date-time: ${value}`);
    this.name = 'InvalidLocalTimeError';
  }
}

/**
 * Converts "YYYY-MM-DDTHH:mm[:ss]" in `timeZone` to a UTC instant.
 *
 * Disambiguation:
 * - 'earlier' (default, conservative for customer-facing deadlines): in a DST overlap the first
 *   occurrence; in a DST gap the instant just before the skipped hour would have started.
 * - 'later': the second occurrence in an overlap; in a gap the instant after the shift.
 */
export function zonedLocalToInstant(local: string, timeZone: string, disambiguation: 'earlier' | 'later' = 'earlier'): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local);
  if (!m) throw new InvalidLocalTimeError(local);
  const [, y, mo, d, h, mi, s] = m;
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? '0'));
  // Validate the calendar date (e.g. reject 2026-02-30).
  const check = new Date(naive);
  if (check.getUTCMonth() !== Number(mo) - 1 || check.getUTCDate() !== Number(d)) throw new InvalidLocalTimeError(local);

  const offsets = new Set<number>();
  for (const probe of [naive - 86_400_000, naive - 3_600_000 * 3, naive, naive + 3_600_000 * 3, naive + 86_400_000]) {
    offsets.add(offsetMinutesAt(timeZone, probe));
  }
  const valid = [...offsets]
    .map((off) => naive - off * 60_000)
    .filter((instant) => offsetMinutesAt(timeZone, instant) * 60_000 === naive - instant)
    .sort((a, b) => a - b);

  if (valid.length > 0) {
    return new Date(disambiguation === 'earlier' ? (valid[0] as number) : (valid[valid.length - 1] as number));
  }
  // Gap: the wall-clock time does not exist. Candidate instants from both surrounding offsets.
  const candidates = [...offsets].map((off) => naive - off * 60_000).sort((a, b) => a - b);
  return new Date(disambiguation === 'earlier' ? (candidates[0] as number) : (candidates[candidates.length - 1] as number));
}

/** Formats an instant as local wall-clock time in `timeZone` (for display with the zone name). */
export function instantToZonedLocal(instant: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return dtf.format(instant).replace(' ', 'T');
}

/** False when the wall-clock time falls into a DST gap (it never happens in that zone). */
export function localTimeExists(local: string, timeZone: string): boolean {
  const instant = zonedLocalToInstant(local, timeZone, 'earlier');
  return instantToZonedLocal(instant, timeZone) === local.slice(0, 16);
}
