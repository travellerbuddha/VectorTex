import { isDomainError, type StaffActor } from '@texholiday/contracts';
import type { StaffIdentity } from '@texholiday/admin';
import { adminDict, type AdminLocale } from '../i18n/admin';

/** Result of a panel form action, rendered by <ActionForm>. A link is shown once (setup links). */
export type FormState = { ok?: string; error?: string; link?: { url: string; note: string } } | null;

export const actorOf = (staff: StaffIdentity): StaffActor => ({ kind: 'STAFF', id: staff.id });

/** Staff-facing text for an error: known validation messages are translated, everything else stays generic. */
export function errorText(err: unknown, locale: AdminLocale): string {
  const t = adminDict(locale);
  if (isDomainError(err)) {
    if (err.code === 'FORBIDDEN') return t.errors.forbidden;
    if (err.code === 'NOT_FOUND') return t.errors.notFound;
    if (err.code === 'VERSION_CONFLICT') return t.errors.conflict;
    if (err.code === 'VALIDATION_FAILED') {
      const issues = (err as { issues?: Array<{ path: string; message: string }> }).issues;
      if (Array.isArray(issues) && issues.length > 0) return issues.map((i) => `${i.path}: ${i.message}`).join(' · ');
      return t.errors.known[err.message] ?? err.message;
    }
  }
  console.error(JSON.stringify({ level: 'error', msg: 'admin action failed', error: err instanceof Error ? err.message : String(err) }));
  return t.errors.generic;
}

/** Dates in the panel: Turkey time, with the zone shown. */
export function formatAdminInstant(iso: string | null, locale: AdminLocale): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul' }).format(new Date(iso));
}
