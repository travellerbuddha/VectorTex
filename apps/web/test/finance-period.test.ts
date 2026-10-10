import { describe, expect, it } from 'vitest';
import { istanbulToday, presetPeriods } from '../src/server/finance-period';

/** Finance report presets in Istanbul calendar days (P15b). */
describe('finance report periods', () => {
  it('today is the Istanbul date', () => {
    expect(istanbulToday(new Date('2026-10-10T21:30:00Z'))).toBe('2026-10-11'); // 00:30 in Istanbul
    expect(istanbulToday(new Date('2026-10-10T20:59:00Z'))).toBe('2026-10-10');
  });

  it('this month, last month (also across a year and February), last 30 days', () => {
    expect(presetPeriods('2026-10-10')).toEqual({
      thisMonth: { from: '2026-10-01', to: '2026-10-10' },
      lastMonth: { from: '2026-09-01', to: '2026-09-30' },
      last30: { from: '2026-09-11', to: '2026-10-10' },
    });
    expect(presetPeriods('2027-01-05').lastMonth).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(presetPeriods('2028-03-01').lastMonth).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});
