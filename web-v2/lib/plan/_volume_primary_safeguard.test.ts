import { describe, expect, it } from 'vitest';
import {
  protectVolumePrimaryWeeks,
  type VolumePrimaryDay,
  type VolumePrimaryWeek,
} from './volume-primary-safeguard';

const day = (dow: number, type: string, distanceMi: number, isQuality = false, isLong = false): VolumePrimaryDay => ({
  dow, type, distanceMi, isQuality, isLong,
  subLabel: type.toUpperCase(), notes: `${type} prescription`,
});

const week = (startISO: string, weeklyMi: number, days: VolumePrimaryDay[]): VolumePrimaryWeek => ({
  startISO, weeklyMi, days, isCutback: false,
});

describe('volume-primary safeguard', () => {
  it('turns the extra threshold day into easy mileage on David\'s CIM-shaped volume + race-long week', () => {
    const weeks = [
      week('2026-09-14', 49.9, [day(5, 'threshold', 9.4, true), day(0, 'long', 17.5, false, true)]),
      week('2026-09-21', 59.21, [
        day(2, 'tempo', 10, true),
        day(6, 'race', 6.21, true),
        day(0, 'long', 17, false, true),
      ]),
    ];

    const decisions = protectVolumePrimaryWeeks({ weeks, demonstratedSustainedMi: 45.8 });

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      week_start_iso: '2026-09-21', quality_type_before: 'tempo',
      weekly_mi: 59.21, prior_high_mi: 49.9, sustained_mi: 45.8,
      reason: 'volume_is_primary_stressor',
    });
    expect(weeks[1].days[0]).toMatchObject({
      type: 'easy', distanceMi: 10, isQuality: false, subLabel: 'EASY',
      workShape: null, progressionDose: null, progressionLever: null,
    });
    expect(weeks[1].days[1].type).toBe('race');
    expect(weeks[1].days[2]).toMatchObject({ type: 'long', distanceMi: 17, isLong: true });
  });

  it('does not remove quality when volume is not independently progressing', () => {
    const weeks = [
      week('2026-09-14', 50, [day(0, 'long', 17, false, true)]),
      week('2026-09-21', 51, [
        day(2, 'threshold', 9, true), day(6, 'race', 6.2, true), day(0, 'long', 17, false, true),
      ]),
    ];
    expect(protectVolumePrimaryWeeks({ weeks, demonstratedSustainedMi: 45 })).toEqual([]);
    expect(weeks[1].days[0].type).toBe('threshold');
  });

  it('does not invent a volume judgement when sustained load is absent', () => {
    const weeks = [
      week('2026-09-14', 40, [day(0, 'long', 14, false, true)]),
      week('2026-09-21', 50, [
        day(2, 'threshold', 9, true), day(6, 'race', 6.2, true), day(0, 'long', 17, false, true),
      ]),
    ];
    expect(protectVolumePrimaryWeeks({ weeks, demonstratedSustainedMi: null })).toEqual([]);
    expect(weeks[1].days[0].type).toBe('threshold');
  });

  it('leaves a quality session intact when the race and long run are not back-to-back', () => {
    const weeks = [
      week('2026-09-14', 40, [day(0, 'long', 14, false, true)]),
      week('2026-09-21', 50, [
        day(2, 'threshold', 9, true), day(5, 'race', 6.2, true), day(0, 'long', 17, false, true),
      ]),
    ];
    expect(protectVolumePrimaryWeeks({ weeks, demonstratedSustainedMi: 35 })).toEqual([]);
    expect(weeks[1].days[0].type).toBe('threshold');
  });
});
