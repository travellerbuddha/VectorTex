/** Default and preset periods of the finance report, as Istanbul calendar dates (pure; `today` is YYYY-MM-DD). */
export function istanbulToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function presetPeriods(today: string): { thisMonth: { from: string; to: string }; lastMonth: { from: string; to: string }; last30: { from: string; to: string } } {
  const firstOfMonth = `${today.slice(0, 8)}01`;
  const lastOfPrev = shift(firstOfMonth, -1);
  return {
    thisMonth: { from: firstOfMonth, to: today },
    lastMonth: { from: `${lastOfPrev.slice(0, 8)}01`, to: lastOfPrev },
    last30: { from: shift(today, -29), to: today },
  };
}
