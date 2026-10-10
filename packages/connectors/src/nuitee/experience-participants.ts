import type { ExperienceQuestion } from '@texholiday/contracts';

export class ExperienceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExperienceInputError';
  }
}

/**
 * booking-options takes category -> count; prebook takes one participant entry per person (§10). This maps
 * the accepted counts to a participant list, keeping the provider's category keys byte-for-byte.
 */
export function participantsForPrebook(
  categoryCounts: Readonly<Record<string, number>>,
  assignments: ReadonlyArray<{ category: string; travelerId: string }>,
): Array<{ category: string; travelerId: string }> {
  const remaining = new Map(Object.entries(categoryCounts));
  for (const [category, count] of remaining) {
    if (!Number.isInteger(count) || count < 0) throw new ExperienceInputError(`Invalid count for category ${category}`);
  }
  const travelers = new Set<string>();
  for (const a of assignments) {
    if (!remaining.has(a.category)) throw new ExperienceInputError(`Category ${a.category} was not part of the selected option`);
    if (travelers.has(a.travelerId)) throw new ExperienceInputError(`Traveler ${a.travelerId} assigned twice`);
    travelers.add(a.travelerId);
    remaining.set(a.category, (remaining.get(a.category) ?? 0) - 1);
  }
  for (const [category, left] of remaining) {
    if (left !== 0) throw new ExperienceInputError(`Category ${category}: ${left > 0 ? `${left} participant(s) missing` : `${-left} too many`}`);
  }
  return assignments.map((a) => ({ category: a.category, travelerId: a.travelerId }));
}

/**
 * Required questions come from the provider's dynamic schema (T09). Every required booking question needs
 * an answer, and every required participant question needs one answer per participant.
 */
export function assertRequiredAnswers(
  questions: readonly ExperienceQuestion[],
  answers: { booking: Readonly<Record<string, unknown>>; perParticipant: Readonly<Record<string, Readonly<Record<string, unknown>>>> },
  participantIds: readonly string[],
): void {
  const empty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  const missing: string[] = [];
  for (const q of questions.filter((x) => x.required)) {
    if (q.appliesTo === 'BOOKING') {
      if (empty(answers.booking[q.id])) missing.push(q.id);
    } else {
      for (const p of participantIds) if (empty(answers.perParticipant[p]?.[q.id])) missing.push(`${q.id}@${p}`);
    }
  }
  if (missing.length > 0) throw new ExperienceInputError(`Missing required answers: ${missing.join(', ')}`);
}
