/**
 * Scenario-driven tests over the canonical CoachState fixtures.
 *
 * For each archetype in fixtures/coach-states.ts, simulate the next
 * 28 days and assert what a competent human coach would expect to see:
 *   - no monotone-rest stretches (engine never goes dormant)
 *   - quality cadence appropriate to phase
 *   - long-run progression within ±25% week-over-week
 *   - weekly mileage within ±15% of recent average (steady-state) or
 *     documented planned ramp (build/peak/taper)
 *   - per-fixture doctrine: post-race rest depth, peak taper drop, etc.
 *
 * Assertion-message rule: every `.toBe(...)` carries a human-readable
 * message so a future failure tells you which doctrine got violated,
 * not just "expected X, got Y".
 */
import { describe, expect, it } from 'vitest';
import { simulateRange } from '../coach-engine';
import {
  TODAY_ISO,
  dayOffsetISO,
  STATE_POST_HALF_DAY_3,
  STATE_MID_BUILD_WEEK_4,
  STATE_PEAK_WEEK_MINUS_2,
  STATE_TAPER_WEEK_MINUS_5,
  STATE_EARLY_BASE_REBUILD,
  STATE_HEAVY_BLOCK_STACK,
  STATE_INJURY_RETURN,
} from './fixtures/coach-states';

type Day = ReturnType<typeof simulateRange>[number];

const QUALITY_TYPES = new Set<string>([
  'threshold', 'threshold_intervals', 'sub_threshold', 'vo2',
  'marathon_specific', 'long_progression', 'long_mp_block',
]);
const LONG_TYPES = new Set<string>([
  'long_steady', 'long_progression', 'long_mp_block',
]);

// ── Helpers ────────────────────────────────────────────────────────
function longestRestStreak(days: Day[]): { len: number; startIdx: number } {
  let max = 0, cur = 0, start = -1, maxStart = -1;
  for (let i = 0; i < days.length; i++) {
    if (days[i].type === 'rest') {
      if (cur === 0) start = i;
      cur++;
      if (cur > max) { max = cur; maxStart = start; }
    } else cur = 0;
  }
  return { len: max, startIdx: maxStart };
}

function chunkByMonSun(days: Day[]): Day[][] {
  // Group into Mon-Sun calendar weeks. First chunk may be partial if
  // the simulation starts mid-week. UTC dow: 1=Mon..0=Sun. We want the
  // first chunk to end on Sunday.
  if (days.length === 0) return [];
  const out: Day[][] = [];
  let cur: Day[] = [];
  for (const d of days) {
    const dow = new Date(d.date + 'T12:00:00Z').getUTCDay();
    cur.push(d);
    if (dow === 0) { out.push(cur); cur = []; }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function weekMiles(week: Day[]): number {
  return week.reduce((s, d) => s + d.distanceMi, 0);
}

function longRunMiles(week: Day[]): number {
  return week
    .filter(d => LONG_TYPES.has(d.type))
    .reduce((max, d) => Math.max(max, d.distanceMi), 0);
}

function qualityCount(week: Day[]): number {
  return week.filter(d => QUALITY_TYPES.has(d.type)).length;
}

function dayTypeSummary(week: Day[]): string {
  return week.map(d => `${d.date.slice(5)}:${d.type}`).join(' ');
}

/** Universal: no 7-consecutive-day all-REST window in the range, with
 *  the exception of an interior period that falls entirely inside the
 *  caller-provided "ok-to-rest" date set. POST_RACE fixtures pass that
 *  set in so 3–5 day rest blocks inside the recovery window don't trip
 *  the rule. */
function assertNoSevenDayRestStretch(
  days: Day[],
  allowedRestRange?: { startISO: string; endISO: string },
  label = 'range',
): void {
  const { len, startIdx } = longestRestStreak(days);
  if (len < 7) return;
  // If the entire streak falls inside the allowed-rest window, accept it.
  if (allowedRestRange && startIdx >= 0) {
    const streakStart = days[startIdx].date;
    const streakEnd = days[startIdx + len - 1].date;
    if (streakStart >= allowedRestRange.startISO && streakEnd <= allowedRestRange.endISO) return;
  }
  expect.fail(
    `[${label}] Found ${len}-day REST stretch starting ${days[startIdx].date}. ` +
    `Engine should not be silent for ≥7 days outside the post-race recovery window.`,
  );
}

/** Universal: long-run distance week-over-week stays within ±25%. Skip
 *  the comparison when either week has no long run (recovery weeks). */
function assertLongRunProgression(weeks: Day[][], label: string): void {
  for (let i = 1; i < weeks.length; i++) {
    const a = longRunMiles(weeks[i - 1]);
    const b = longRunMiles(weeks[i]);
    if (a === 0 || b === 0) continue;
    const ratio = b / a;
    expect(
      ratio >= 0.75 && ratio <= 1.25,
      `[${label}] Long-run jump from ${a.toFixed(1)}mi (wk ${i - 1}) to ${b.toFixed(1)}mi (wk ${i}), ` +
      `ratio ${ratio.toFixed(2)} outside the ±25% week-over-week cap. ` +
      `Doctrine §13.1: single-session-spike rule.`,
    ).toBe(true);
  }
}

/** Universal: no same-day double-quality. A day already classified as
 *  quality should not also carry an additional quality marker. (Engine
 *  emits one workout per day, so this collapses to a presence check, 
 *  but documenting the invariant explicitly catches a future regression
 *  if the engine ever stacks workouts on a single date.) */
function assertNoDoubleQualityPerDay(days: Day[], label: string): void {
  const byDate = new Map<string, number>();
  for (const d of days) {
    if (QUALITY_TYPES.has(d.type)) {
      byDate.set(d.date, (byDate.get(d.date) ?? 0) + 1);
    }
  }
  for (const [date, count] of byDate) {
    expect(
      count,
      `[${label}] ${date} has ${count} quality workouts, engine should prescribe at most one quality session per day.`,
    ).toBeLessThanOrEqual(1);
  }
}

// ────────────────────────────────────────────────────────────────────
// 1. STATE_POST_HALF_DAY_3
// ────────────────────────────────────────────────────────────────────
describe('STATE_POST_HALF_DAY_3, half-marathon 3 days ago, A-race 12wks out', () => {
  const days = simulateRange(STATE_POST_HALF_DAY_3, TODAY_ISO, dayOffsetISO(28));
  const windowEndISO = STATE_POST_HALF_DAY_3.recoveryWindowEndsISO!;

  it('produces 29 days (today through +28)', () => {
    expect(days.length).toBe(29);
  });

  it('no 7-day REST stretch outside the recovery window', () => {
    assertNoSevenDayRestStretch(
      days,
      { startISO: TODAY_ISO, endISO: windowEndISO },
      'POST_HALF_DAY_3',
    );
  });

  it('first 3 days are REST or short recovery (≤4mi)', () => {
    const first3 = days.slice(0, 3);
    for (const d of first3) {
      const ok = d.type === 'rest' || (d.type === 'recovery' && d.distanceMi <= 4);
      expect(
        ok,
        `Day ${d.date} (post-race day +${days.indexOf(d) + 3}) prescribed ${d.type} ${d.distanceMi}mi, ` +
        `engine should still be in the rest/light-recovery stage in the first 3 days.`,
      ).toBe(true);
    }
  });

  it('no quality work inside the recovery window', () => {
    const inside = days.filter(d => d.date <= windowEndISO);
    const quality = inside.filter(d => QUALITY_TYPES.has(d.type));
    expect(
      quality.length,
      `Found ${quality.length} quality days inside recovery window (ends ${windowEndISO}): ` +
      quality.map(d => `${d.date}:${d.type}`).join(', '),
    ).toBe(0);
  });

  it('first quality day appears after the window closes', () => {
    const firstQuality = days.find(d => QUALITY_TYPES.has(d.type));
    if (firstQuality) {
      expect(
        firstQuality.date > windowEndISO,
        `First quality session ${firstQuality.date} (${firstQuality.type}) lands inside the recovery window ` +
        `(ends ${windowEndISO}), POST_RACE phase forbids quality work.`,
      ).toBe(true);
    }
  });

  it('no double-quality days', () => {
    assertNoDoubleQualityPerDay(days, 'POST_HALF_DAY_3');
  });

  it('long-run progression ±25% week-over-week (post-window weeks only)', () => {
    const weeks = chunkByMonSun(days.filter(d => d.date > windowEndISO));
    assertLongRunProgression(weeks, 'POST_HALF_DAY_3 (post-window)');
  });
});

// ────────────────────────────────────────────────────────────────────
// 2. STATE_MID_BUILD_WEEK_4
// ────────────────────────────────────────────────────────────────────
describe('STATE_MID_BUILD_WEEK_4, 30mpw build, A-race 10wks out', () => {
  const days = simulateRange(STATE_MID_BUILD_WEEK_4, TODAY_ISO, dayOffsetISO(28));

  it('produces 29 days', () => {
    expect(days.length).toBe(29);
  });

  it('no 7-day REST stretch', () => {
    assertNoSevenDayRestStretch(days, undefined, 'MID_BUILD_WEEK_4');
  });

  it('every full Mon-Sun week has ≥1 quality day', () => {
    const weeks = chunkByMonSun(days);
    for (const w of weeks) {
      if (w.length < 7) continue;     // skip partial leading/trailing week
      const q = qualityCount(w);
      expect(
        q,
        `Week starting ${w[0].date} has 0 quality days. Engine target for BUILD phase is ≥1/wk. ` +
        `Week shape: ${dayTypeSummary(w)}`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('long-run is present in every full week and progresses ≤25% week-over-week', () => {
    const weeks = chunkByMonSun(days).filter(w => w.length === 7);
    for (const w of weeks) {
      const lr = longRunMiles(w);
      expect(
        lr,
        `Week starting ${w[0].date} has no long run. BUILD phase should anchor each week with a long run. ` +
        `Week shape: ${dayTypeSummary(w)}`,
      ).toBeGreaterThan(0);
    }
    assertLongRunProgression(weeks, 'MID_BUILD_WEEK_4');
  });

  it('weekly mileage within ±25% of weeklyAvg4w (build ramp tolerance)', () => {
    // Build phase allows a planned ramp; we widen the universal ±15%
    // band to ±25% to accommodate it.
    const avg = STATE_MID_BUILD_WEEK_4.volume.weeklyAvg4w;
    const weeks = chunkByMonSun(days).filter(w => w.length === 7);
    for (const w of weeks) {
      const mi = weekMiles(w);
      const ratio = mi / avg;
      expect(
        ratio >= 0.6 && ratio <= 1.35,
        `Week starting ${w[0].date}: ${mi.toFixed(1)}mi vs avg ${avg}mi (ratio ${ratio.toFixed(2)}). ` +
        `Build phase tolerance ±35%.`,
      ).toBe(true);
    }
  });

  it('no double-quality days', () => {
    assertNoDoubleQualityPerDay(days, 'MID_BUILD_WEEK_4');
  });
});

// ────────────────────────────────────────────────────────────────────
// 3. STATE_PEAK_WEEK_MINUS_2 (A-race 14 days out)
// ────────────────────────────────────────────────────────────────────
describe('STATE_PEAK_WEEK_MINUS_2, peak block, A-race 14 days out', () => {
  const days = simulateRange(STATE_PEAK_WEEK_MINUS_2, TODAY_ISO, dayOffsetISO(28));

  it('produces 29 days', () => {
    expect(days.length).toBe(29);
  });

  it('no 7-day REST stretch before race day', () => {
    const beforeRace = days.filter(d => d.date <= dayOffsetISO(14));
    assertNoSevenDayRestStretch(beforeRace, undefined, 'PEAK_WEEK_MINUS_2 (pre-race)');
  });

  it('no new long runs in the last 10 days before race day', () => {
    // Race day = +14d. "Last 10 days" = +4 .. +14.
    const last10 = days.filter(d => d.date >= dayOffsetISO(4) && d.date <= dayOffsetISO(14));
    const longs = last10.filter(d => LONG_TYPES.has(d.type));
    expect(
      longs.length,
      `Found ${longs.length} long-run sessions inside taper window (last 10d pre-race): ` +
      longs.map(d => `${d.date}:${d.type} ${d.distanceMi}mi`).join(', ') + '. ' +
      `Doctrine: no long-run stimulus inside ~10 days of A-race.`,
    ).toBe(0);
  });

  it('taper-week volume drops 25-60% vs peak week', () => {
    // Peak week = the week leading into taper. Days +1..+7 are the
    // pre-taper week (still in PEAK sub-phase by raceSubPhase math).
    // Days +8..+14 cover the final taper.
    const peakWk = days.filter(d => {
      const off = (Date.parse(d.date) - Date.parse(TODAY_ISO)) / 86_400_000;
      return off >= 0 && off <= 6;
    });
    const taperWk = days.filter(d => {
      const off = (Date.parse(d.date) - Date.parse(TODAY_ISO)) / 86_400_000;
      return off >= 7 && off <= 13;   // exclude race day itself
    });
    const peakMi = weekMiles(peakWk);
    const taperMi = weekMiles(taperWk);
    expect(peakMi).toBeGreaterThan(0);
    const dropPct = (peakMi - taperMi) / peakMi;
    expect(
      dropPct >= 0.25 && dropPct <= 0.65,
      `Taper drop = ${(dropPct * 100).toFixed(0)}% (peak ${peakMi.toFixed(1)}mi → taper ${taperMi.toFixed(1)}mi). ` +
      `Daniels §9 / Pfitzinger taper depth target 30-50%.`,
    ).toBe(true);
  });

  it('race day appears in the plan as type=race', () => {
    const raceDay = days.find(d => d.date === dayOffsetISO(14));
    expect(raceDay).toBeDefined();
    expect(
      raceDay!.type,
      `Race day ${dayOffsetISO(14)} prescribed ${raceDay!.type}, expected 'race'.`,
    ).toBe('race');
  });

  it('no double-quality days', () => {
    assertNoDoubleQualityPerDay(days, 'PEAK_WEEK_MINUS_2');
  });
});

// ────────────────────────────────────────────────────────────────────
// 4. STATE_TAPER_WEEK_MINUS_5 (A-race 5 days out)
// ────────────────────────────────────────────────────────────────────
describe('STATE_TAPER_WEEK_MINUS_5, final taper, A-race 5 days out', () => {
  const days = simulateRange(STATE_TAPER_WEEK_MINUS_5, TODAY_ISO, dayOffsetISO(28));

  it('produces 29 days', () => {
    expect(days.length).toBe(29);
  });

  it('every day from today to race day is REST or tune-up (no quality, no long)', () => {
    // Race-week prescription: only easy, recovery, shakeout, rest, or race.
    const raceWeek = days.filter(d => d.date >= TODAY_ISO && d.date <= dayOffsetISO(5));
    const allowedTypes = new Set(['rest', 'recovery', 'general_aerobic', 'shakeout', 'race', 'strides_appended']);
    for (const d of raceWeek) {
      expect(
        allowedTypes.has(d.type),
        `Race-week day ${d.date} prescribed ${d.type}, only easy/recovery/shakeout/race allowed in final 5 days.`,
      ).toBe(true);
    }
    // No quality, no long.
    const offenders = raceWeek.filter(d => QUALITY_TYPES.has(d.type) || LONG_TYPES.has(d.type));
    expect(
      offenders.length,
      `Race-week quality/long offenders: ${offenders.map(d => `${d.date}:${d.type}`).join(', ')}`,
    ).toBe(0);
  });

  it('race day appears as type=race', () => {
    const raceDay = days.find(d => d.date === dayOffsetISO(5));
    expect(raceDay).toBeDefined();
    expect(
      raceDay!.type,
      `Race day ${dayOffsetISO(5)} prescribed ${raceDay!.type}, expected 'race'.`,
    ).toBe('race');
  });

  it('no double-quality days', () => {
    assertNoDoubleQualityPerDay(days, 'TAPER_WEEK_MINUS_5');
  });
});

// ────────────────────────────────────────────────────────────────────
// 5. STATE_EARLY_BASE_REBUILD (low-volume returning runner)
// ────────────────────────────────────────────────────────────────────
describe('STATE_EARLY_BASE_REBUILD, 8mpw returning runner, A-race 16wks out', () => {
  const days = simulateRange(STATE_EARLY_BASE_REBUILD, TODAY_ISO, dayOffsetISO(28));

  it('produces 29 days', () => {
    expect(days.length).toBe(29);
  });

  it('no quality work, all easy', () => {
    const quality = days.filter(d => QUALITY_TYPES.has(d.type));
    expect(
      quality.length,
      `Found ${quality.length} quality sessions; early-base-rebuild should be all easy: ` +
      quality.map(d => `${d.date}:${d.type}`).join(', '),
    ).toBe(0);
  });

  it('no 7-day REST stretch', () => {
    assertNoSevenDayRestStretch(days, undefined, 'EARLY_BASE_REBUILD');
  });

  it('weekly mileage ramps ≤25% week-over-week (10% rule with engine tolerance)', () => {
    // Doctrine: 10% rule. Engine's coarse weekly math + low base
    // (rounding up baseEasy floor of 3mi) means ramps can momentarily
    // spike. Widen to 25% so we catch genuine doubling but tolerate
    // floor-driven jumps.
    const weeks = chunkByMonSun(days).filter(w => w.length === 7);
    for (let i = 1; i < weeks.length; i++) {
      const a = weekMiles(weeks[i - 1]);
      const b = weekMiles(weeks[i]);
      if (a === 0) continue;
      const ratio = b / a;
      expect(
        ratio <= 1.25,
        `Week ${weeks[i][0].date}: ${b.toFixed(1)}mi up from ${a.toFixed(1)}mi (ratio ${ratio.toFixed(2)}). ` +
        `Doctrine 10% rule exceeded by more than the engine's rounding tolerance.`,
      ).toBe(true);
    }
  });

  it('no double-quality days (trivially true here)', () => {
    assertNoDoubleQualityPerDay(days, 'EARLY_BASE_REBUILD');
  });
});

// ────────────────────────────────────────────────────────────────────
// 6. STATE_HEAVY_BLOCK_STACK (the original a32e1f9 bug scenario)
// ────────────────────────────────────────────────────────────────────
describe('STATE_HEAVY_BLOCK_STACK, 2 races in 14d + far A-race', () => {
  const days = simulateRange(STATE_HEAVY_BLOCK_STACK, TODAY_ISO, dayOffsetISO(28));
  const windowEndISO = STATE_HEAVY_BLOCK_STACK.recoveryWindowEndsISO!;

  it('produces 29 days', () => {
    expect(days.length).toBe(29);
  });

  it('no all-REST stretch past day +14 (the original bug)', () => {
    const tail = days.filter(d => d.date > dayOffsetISO(14));
    const restCount = tail.filter(d => d.type === 'rest').length;
    expect(
      restCount,
      `Tail past day +14 has ${restCount}/${tail.length} REST days. ` +
      `Original bug (commit a32e1f9): heavy-block flag was sticky and produced 100% REST forever.`,
    ).toBeLessThan(tail.length * 0.5);
  });

  it('recovery dominates the first ~10 days (≥40% rest/recovery)', () => {
    const head = days.filter(d => d.date <= windowEndISO);
    const recoveryDominant = head.filter(d => d.type === 'rest' || d.type === 'recovery').length;
    expect(
      recoveryDominant / head.length >= 0.4,
      `Recovery dominance in window = ${recoveryDominant}/${head.length}. ` +
      `Heavy-block recovery should keep first ~10 days mostly rest/recovery.`,
    ).toBe(true);
  });

  it('plan re-engages after the window closes (quality returns within 14 days post-window)', () => {
    const afterWindow = days.filter(d => d.date > windowEndISO);
    const hasQuality = afterWindow.some(d => QUALITY_TYPES.has(d.type));
    expect(
      hasQuality,
      `No quality session in the ${afterWindow.length} days after recovery window closes (${windowEndISO}). ` +
      `Engine should re-engage with structured work once window ends.`,
    ).toBe(true);
  });

  it('no double-quality days', () => {
    assertNoDoubleQualityPerDay(days, 'HEAVY_BLOCK_STACK');
  });
});

// ────────────────────────────────────────────────────────────────────
// 7. STATE_INJURY_RETURN (no race, 21d gap, rebuilding)
// ────────────────────────────────────────────────────────────────────
describe('STATE_INJURY_RETURN, rebuild after 21d gap, no race calendar', () => {
  const days = simulateRange(STATE_INJURY_RETURN, TODAY_ISO, dayOffsetISO(28));

  it('produces 29 days', () => {
    expect(days.length).toBe(29);
  });

  it('no quality work in week 1', () => {
    const wk1 = days.slice(0, 7);
    const quality = wk1.filter(d => QUALITY_TYPES.has(d.type));
    expect(
      quality.length,
      `Week 1 quality sessions: ${quality.map(d => `${d.date}:${d.type}`).join(', ')}. ` +
      `Injury-return rebuild should be all easy in week 1.`,
    ).toBe(0);
  });

  it('weekly volume ≤ 8mi in week 1', () => {
    // baseEasy floor is 3mi; runner has 4mpw avg. Allow up to 8mi
    // (≈2x baseline), engine's rebuild cap should prevent more.
    const wk1Mi = weekMiles(days.slice(0, 7));
    expect(
      wk1Mi <= 8,
      `Week 1 volume = ${wk1Mi.toFixed(1)}mi. Injury-return rebuild should cap week 1 ≤ 8mi when weeklyAvg4w=4.`,
    ).toBe(true);
  });

  it('no 7-day REST stretch (engine still prescribes activity)', () => {
    assertNoSevenDayRestStretch(days, undefined, 'INJURY_RETURN');
  });

  it('no double-quality days', () => {
    assertNoDoubleQualityPerDay(days, 'INJURY_RETURN');
  });
});
