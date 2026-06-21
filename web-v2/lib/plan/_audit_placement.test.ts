/**
 * lib/plan/_audit_placement.test.ts · DAY PLACEMENT & AVAILABILITY sweep.
 *
 * Dimension: invariants 8 (available_days respected), 9 (frequency cap),
 * 2 (7 clean contiguous days). Adversarial exhaustive sweep over EVERY
 * available_days subset × trainingDaysPerWeek 0-6 × long_run_day 0-6 ×
 * representative distances/goals.
 *
 * IMPORTANT: the real reconciliation that maps raw runner input
 * (available_days + weekly_frequency + day prefs) into the ComposePlanInput
 * fields (availableDows / longRunDow / restDow / qualityDows /
 * trainingDaysPerWeek) lives in loadGeneratorInputs() in generate.ts
 * (lines ~2442-2494), NOT in composePlan(). composePlan only consumes the
 * already-reconciled fields. So a sweep that hand-builds ComposePlanInput
 * with arbitrary days would test a state the real app can never produce.
 *
 * To audit the ACTUAL onboarding→plan placement behavior, this harness
 * faithfully MIRRORS that reconciliation block (deriveLayout below is a
 * line-for-line port of generate.ts) and feeds its output to composePlan().
 * That tests the real pipeline: raw availability → derived layout →
 * composePlan placement. If deriveLayout drifts from production, that itself
 * is a finding (noted in coverage).
 */

import { describe, it, expect } from 'vitest';
import {
  composePlan,
  inlinePrescriptions,
  distanceCategoryOfPublic,
  type ComposePlanInput,
  type DOW,
} from './generate';
import { tPaceFromGoal } from './spec-builder';

// ───────────────────────────────────────────────────────────────────────
// Faithful port of generate.ts loadGeneratorInputs day-reconciliation.
// Keep these in lock-step with generate.ts lines ~2430-2494.
// ───────────────────────────────────────────────────────────────────────
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

interface RawPrefs {
  long_run_day: DOW;
  rest_day: DOW;
  quality_days: DOW[];
  available_days: DOW[] | null; // null = unset (legacy fill-all)
}

interface DerivedLayout {
  longRunDow: DOW;
  restDow: DOW;
  qualityDows: DOW[];
  availableDows: Set<number> | null;
  trainingDaysPerWeek: number | null;
}

/**
 * Mirror of generate.ts lines ~2430-2494. Given raw runner prefs +
 * weekly_frequency, derive the layout fields composePlan consumes.
 */
function deriveLayout(prefs: RawPrefs, weeklyFrequency: number | null): DerivedLayout {
  let longRunDow: DOW = prefs.long_run_day;
  let restDow: DOW = prefs.rest_day;
  let qualityDows: DOW[] = [...prefs.quality_days];

  let availableDows: Set<number> | null = null;
  const avail = prefs.available_days ?? [];
  if (avail.length >= 2) {
    const aset = new Set<number>(avail);
    availableDows = aset;
    longRunDow = (aset.has(longRunDow) ? longRunDow
      : aset.has(6) ? 6 : aset.has(0) ? 0 : Math.max(...avail)) as DOW;
    const unavail = [0, 1, 2, 3, 4, 5, 6].filter((d) => !aset.has(d));
    restDow = (!aset.has(restDow) ? restDow : (unavail[0] ?? restDow)) as DOW;
    qualityDows = avail.filter((d) => d !== longRunDow)
      .sort((a, b) => Math.abs(a - 3) - Math.abs(b - 3)) as DOW[];
  }

  // weekly_frequency → trainingDaysPerWeek (generate.ts ~2481-2485)
  const rawFreq = weeklyFrequency;
  const trainingDaysPerWeek = rawFreq == null ? null
    : rawFreq === 0 ? 3
    : (rawFreq >= 1 && rawFreq <= 7) ? rawFreq
    : null;

  if (trainingDaysPerWeek != null) {
    const qCount = trainingDaysPerWeek <= 1 ? 0 : trainingDaysPerWeek >= 5 ? 2 : 1;
    qualityDows = qualityDows.slice(0, qCount);
  }

  return { longRunDow, restDow, qualityDows, availableDows, trainingDaysPerWeek };
}

// ───────────────────────────────────────────────────────────────────────
// Build a full ComposePlanInput from a derived layout + scenario knobs.
// ───────────────────────────────────────────────────────────────────────
const START = '2026-01-05'; // a Monday

interface Scenario {
  raceDistanceMi: number;
  goalSec: number | null;
  recentWeeklyMi: number;
  recentLongMi: number;
  level: ComposePlanInput['level'];
  weeks: number; // runway in weeks → drives raceDateISO
}

function buildInput(layout: DerivedLayout, sc: Scenario): ComposePlanInput {
  const cat = distanceCategoryOfPublic(sc.raceDistanceMi);
  const raceDay = new Date(START + 'T12:00:00Z');
  // race day = start + weeks*7 - 1 (Sunday-ish), mirrors generator-bench
  raceDay.setUTCDate(raceDay.getUTCDate() + sc.weeks * 7 - 1);
  const raceDateISO = raceDay.toISOString().slice(0, 10);
  return {
    raceDistanceMi: sc.raceDistanceMi,
    goalSec: sc.goalSec,
    goalPaceSec: sc.goalSec ? Math.round(sc.goalSec / sc.raceDistanceMi) : null,
    raceDateISO,
    startMondayISO: START,
    level: sc.level,
    recentWeeklyMi: sc.recentWeeklyMi,
    easyDayMedianMi: Math.max(3, Math.round(sc.recentWeeklyMi / 5)),
    recentLongMi: sc.recentLongMi,
    isMidBlock: false,
    longRunDow: layout.longRunDow,
    restDow: layout.restDow,
    qualityDows: layout.qualityDows,
    availableDows: layout.availableDows,
    trainingDaysPerWeek: layout.trainingDaysPerWeek,
    crossModes: [],
    rxQuality: inlinePrescriptions(cat),
    rxRaceSpecific: inlinePrescriptions(cat),
    tPaceSec: tPaceFromGoal(sc.goalSec ?? 0, sc.raceDistanceMi),
    lthr: null,
    maxHr: null,
  };
}

// ───────────────────────────────────────────────────────────────────────
// Per-week invariant checks. Returns an array of violation strings.
// A run day = distanceMi > 0 and type is a running type (not strength/cross).
// race / shakeout / race_week_tuneup count as run days.
// ───────────────────────────────────────────────────────────────────────
const RUN_TYPES = new Set([
  'easy', 'long', 'threshold', 'intervals', 'tempo', 'race', 'shakeout', 'race_week_tuneup',
]);

interface Day {
  dow: DOW;
  type: string;
  distanceMi: number;
  isQuality: boolean;
  isLong: boolean;
  subLabel: string | null;
}

function checkWeek(
  week: { days: Day[]; isRaceWeek: boolean },
  wkLabel: string,
  layout: DerivedLayout,
  raceDow: DOW | null,
): string[] {
  const f: string[] = [];
  const days = week.days;

  // ── Invariant 2: exactly 7 distinct contiguous calendar days, one row each.
  if (days.length !== 7) f.push(`${wkLabel}: ${days.length} day-rows (not 7)`);
  const dows = new Set(days.map((d) => d.dow));
  if (dows.size !== 7) f.push(`${wkLabel}: ${dows.size} distinct DOWs (dup/gap)`);
  for (let d = 0; d < 7; d++) if (!dows.has(d as DOW)) f.push(`${wkLabel}: missing DOW ${d}`);

  const runDays = days.filter((d) => d.distanceMi > 0 && RUN_TYPES.has(d.type));

  // ── Invariant 8: every running day within availableDows EXCEPT the fixed
  //    race/deadline day. Only applies when availableDows is set.
  if (layout.availableDows) {
    for (const d of runDays) {
      const isDeadlineDay = week.isRaceWeek && raceDow != null && d.dow === raceDow;
      if (isDeadlineDay) continue; // race/deadline day exempt
      if (!layout.availableDows.has(d.dow)) {
        f.push(`${wkLabel}: run on UNAVAILABLE dow ${d.dow} (${d.type} ${d.distanceMi}mi · avail={${[...layout.availableDows].sort().join(',')}})`);
      }
    }
  }

  // ── Invariant 9: running-days-count <= stated frequency.
  //    Only applies when trainingDaysPerWeek is set.
  //    The fixed race/deadline day is a purposeful touch but STILL counts as a
  //    running day for the cap (race week has race+shakeout+tuneup; the cap
  //    logic in layoutWeek trims easies to hit the frequency including those).
  if (layout.trainingDaysPerWeek != null) {
    if (runDays.length > layout.trainingDaysPerWeek) {
      f.push(`${wkLabel}: ${runDays.length} run days > frequency ${layout.trainingDaysPerWeek} (${runDays.map((d) => `${d.dow}:${d.type}`).join(',')})`);
    }
  }

  // ── Long/quality collision: no two primary roles on the same dow, and
  //    long+quality must not coincide.
  const longDays = days.filter((d) => d.isLong && d.distanceMi > 0);
  const qualityDays = days.filter((d) => d.isQuality && d.type !== 'race' && d.distanceMi > 0);
  if (!week.isRaceWeek) {
    if (longDays.length > 1) f.push(`${wkLabel}: ${longDays.length} long runs`);
    for (const q of qualityDays) {
      if (q.isLong) f.push(`${wkLabel}: dow ${q.dow} is BOTH long and quality`);
    }
    // long must land on layout.longRunDow when set and available
    if (longDays.length === 1 && longDays[0].dow !== layout.longRunDow) {
      f.push(`${wkLabel}: long on dow ${longDays[0].dow} not chosen longRunDow ${layout.longRunDow}`);
    }
    // quality days must be a subset of availableDows when set
    if (layout.availableDows) {
      for (const q of qualityDays) {
        if (!layout.availableDows.has(q.dow)) {
          f.push(`${wkLabel}: quality on UNAVAILABLE dow ${q.dow}`);
        }
      }
    }
  }

  // ── No NaN / negative / absurd distances (cheap invariant-13 guard here too).
  for (const d of days) {
    if (!Number.isFinite(d.distanceMi)) f.push(`${wkLabel}: dow ${d.dow} distanceMi not finite (${d.distanceMi})`);
    if (d.distanceMi < 0) f.push(`${wkLabel}: dow ${d.dow} negative distance ${d.distanceMi}`);
    if (d.distanceMi > 60) f.push(`${wkLabel}: dow ${d.dow} absurd distance ${d.distanceMi}`);
  }

  return f;
}

function raceDowOf(input: ComposePlanInput): DOW {
  return new Date(input.raceDateISO + 'T12:00:00Z').getUTCDay() as DOW;
}

/** Run composePlan on a derived layout + scenario, check every week. */
function evalCase(layout: DerivedLayout, sc: Scenario): { fails: string[]; weeks: number } {
  try {
    const input = buildInput(layout, sc);
    const res = composePlan(input);
    const raceDow = raceDowOf(input);
    const fails: string[] = [];
    res.weeks.forEach((w, i) => {
      const wkLabel = `wk${i + 1}/${res.weeks.length}[${w.phase}${w.isRaceWeek ? '·RACE' : ''}]`;
      fails.push(...checkWeek(w as any, wkLabel, layout, w.isRaceWeek ? raceDow : null));
    });
    return { fails, weeks: res.weeks.length };
  } catch (e: any) {
    return { fails: [`THREW: ${e?.message ?? e}`], weeks: 0 };
  }
}

// ───────────────────────────────────────────────────────────────────────
// SWEEP SETS
// ───────────────────────────────────────────────────────────────────────

// All non-empty available_days subsets we care about:
//  · unset (null)
//  · all 21 PAIRS
//  · representative triples / quads
//  · only-weekends, only-consecutive, long-day-unavailable, all 7
function allPairs(): DOW[][] {
  const out: DOW[][] = [];
  for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) out.push([a as DOW, b as DOW]);
  return out;
}
const TRIPLES: DOW[][] = [
  [1, 3, 5], [2, 4, 6], [0, 2, 4], [1, 2, 3], [4, 5, 6], [0, 1, 2], [3, 5, 0], [0, 3, 6],
];
const QUADS: DOW[][] = [
  [1, 2, 4, 6], [0, 2, 4, 6], [1, 3, 5, 0], [2, 3, 4, 5], [0, 1, 5, 6], [1, 2, 3, 4],
];
const SPECIALS: { name: string; days: DOW[] | null }[] = [
  { name: 'unset', days: null },
  { name: 'only-weekends', days: [0, 6] },
  { name: 'only-consecutive-3', days: [1, 2, 3] },
  { name: 'only-consecutive-5', days: [1, 2, 3, 4, 5] },
  { name: 'all-7', days: [0, 1, 2, 3, 4, 5, 6] },
  { name: 'five-skip-wed', days: [0, 1, 2, 4, 6] },
  { name: 'six-skip-mon', days: [0, 2, 3, 4, 5, 6] },
];

const LONG_DAYS: DOW[] = [0, 1, 2, 3, 4, 5, 6];
const FREQS: (number | null)[] = [null, 0, 1, 2, 3, 4, 5, 6];

// Distance × goal × volume scenarios (kept small; the day-axis is the sweep).
const SCENARIOS: { name: string; sc: Scenario }[] = [
  { name: '5K·inter·25mi', sc: { raceDistanceMi: 3.10686, goalSec: 1500, recentWeeklyMi: 25, recentLongMi: 7, level: 'intermediate', weeks: 12 } },
  { name: 'HM·inter·35mi', sc: { raceDistanceMi: 13.1094, goalSec: 6300, recentWeeklyMi: 35, recentLongMi: 12, level: 'intermediate', weeks: 12 } },
  { name: 'M·adv·55mi', sc: { raceDistanceMi: 26.2188, goalSec: 12600, recentWeeklyMi: 55, recentLongMi: 18, level: 'advanced', weeks: 16 } },
  { name: '5K·beg·8mi', sc: { raceDistanceMi: 3.10686, goalSec: 2100, recentWeeklyMi: 8, recentLongMi: 3, level: 'beginner', weeks: 12 } },
];

// Default day prefs (David-like): long Sun, rest Sat, quality Tue/Thu.
function prefsWithAvail(longDay: DOW, avail: DOW[] | null): RawPrefs {
  return { long_run_day: longDay, rest_day: 6, quality_days: [2, 4], available_days: avail };
}

// ───────────────────────────────────────────────────────────────────────
// THE SWEEP
// ───────────────────────────────────────────────────────────────────────
describe('DAY PLACEMENT & AVAILABILITY · exhaustive sweep (inv 8, 9, 2)', () => {
  // Accumulate all violations across the whole sweep so the report is complete,
  // and assert ZERO at the end. Also count combos.
  const allViolations: { combo: string; fails: string[] }[] = [];
  let comboCount = 0;

  const availSets: { name: string; days: DOW[] | null }[] = [
    ...SPECIALS,
    ...allPairs().map((p) => ({ name: `pair-${p.join('')}`, days: p })),
    ...TRIPLES.map((t) => ({ name: `triple-${t.join('')}`, days: t })),
    ...QUADS.map((q) => ({ name: `quad-${q.join('')}`, days: q })),
  ];

  it('sweeps availableDows × freq × longDay × scenarios with zero placement violations', () => {
    for (const av of availSets) {
      for (const freq of FREQS) {
        for (const longDay of LONG_DAYS) {
          for (const { name: scn, sc } of SCENARIOS) {
            const prefs = prefsWithAvail(longDay, av.days);
            const layout = deriveLayout(prefs, freq);
            const { fails } = evalCase(layout, sc);
            comboCount++;
            if (fails.length > 0) {
              const combo = `avail=${av.name} freq=${freq} long=${longDay} sc=${scn} ` +
                `→derived{long=${layout.longRunDow},rest=${layout.restDow},q=[${layout.qualityDows.join(',')}],tdpw=${layout.trainingDaysPerWeek},avail=${layout.availableDows ? '{' + [...layout.availableDows].sort().join(',') + '}' : 'null'}}`;
              allViolations.push({ combo, fails });
            }
          }
        }
      }
    }

    // Emit a compact report to stdout for the harness reader.
    // eslint-disable-next-line no-console
    console.log(`\n[PLACEMENT SWEEP] combos=${comboCount} violatingCombos=${allViolations.length}`);
    if (allViolations.length > 0) {
      // Bucket by the leading failure signature so we see distinct bug classes.
      const byClass = new Map<string, number>();
      for (const v of allViolations) {
        for (const fl of v.fails) {
          const sig = fl.replace(/dow \d+/g, 'dow N').replace(/wk\d+\/\d+/g, 'wkN').replace(/\d+mi/g, 'Nmi').replace(/\{[\d,]+\}/g, '{..}').replace(/[\d,]+\)/g, '..)');
          byClass.set(sig, (byClass.get(sig) ?? 0) + 1);
        }
      }
      // eslint-disable-next-line no-console
      console.log('[PLACEMENT SWEEP] failure classes:');
      for (const [sig, n] of [...byClass.entries()].sort((a, b) => b[1] - a[1])) {
        // eslint-disable-next-line no-console
        console.log(`  ×${n}  ${sig}`);
      }
      // eslint-disable-next-line no-console
      console.log('\n[PLACEMENT SWEEP] first 25 violating combos:');
      for (const v of allViolations.slice(0, 25)) {
        // eslint-disable-next-line no-console
        console.log(`  • ${v.combo}\n       ${v.fails.slice(0, 4).join('\n       ')}`);
      }
    }

    expect({ combos: comboCount, violatingCombos: allViolations.length }).toEqual({
      combos: comboCount,
      violatingCombos: 0,
    });
  });

  // ─── LOCALIZATION GUARD (PASSES) ──────────────────────────────────────
  // Proves the defect is confined to the final/race week: NO build week (any
  // week that is not isRaceWeek) ever violates inv 8 / 9 / 2 across the whole
  // sweep. This is the load-bearing finding — the standard layoutWeek path is
  // correct; only the race-week branch (generate.ts layoutWeek lines ~837-897)
  // ignores availableDows and can't trim protected race-week touches.
  it('NO non-race (build) week ever violates inv 8/9/2 across the full sweep', () => {
    const buildWeekViolations: string[] = [];
    for (const av of availSets) {
      for (const freq of FREQS) {
        for (const longDay of LONG_DAYS) {
          for (const { name: scn, sc } of SCENARIOS) {
            const layout = deriveLayout(prefsWithAvail(longDay, av.days), freq);
            try {
              const input = buildInput(layout, sc);
              const res = composePlan(input);
              const raceDow = raceDowOf(input);
              res.weeks.forEach((w, i) => {
                if (w.isRaceWeek) return; // race-week handled separately
                const wkLabel = `${av.name}/freq${freq}/long${longDay}/${scn} wk${i + 1}[${w.phase}]`;
                buildWeekViolations.push(...checkWeek(w as any, wkLabel, layout, null));
                void raceDow;
              });
            } catch (e: any) {
              buildWeekViolations.push(`${av.name}/freq${freq}/long${longDay}/${scn}: THREW ${e?.message}`);
            }
          }
        }
      }
    }
    expect(buildWeekViolations).toEqual([]);
  });

  // ─── PLACE-A regression guard (was a live defect, fixed 2026-06-21) ────
  // An only-weekends runner must NOT get a Tuesday race_week_tuneup. The race-
  // week branch now reads availableDows and rests/relocates any touch that
  // lands off-availability (the race day is the sole exemption). tdpw=3 keeps
  // this pure availability (not entangled with the freq cap).
  it('PLACE-A · race week keeps every touch on an available day (only-weekends)', () => {
    const layout = deriveLayout(prefsWithAvail(0, [0, 6]), 3);
    const { fails } = evalCase(layout, SCENARIOS[1].sc); // HM, race Sunday
    const unavail = fails.filter((s) => s.includes('UNAVAILABLE'));
    expect(unavail).toEqual([]);
  });

  // ─── PLACE-B regression guard (was a live defect, fixed 2026-06-21) ────
  // A stated 1- or 2-day-per-week runner's race week must respect the cap. The
  // freq trim now drops easy → tune-up → shakeout (race always stays), so
  // freq 1 → race only, freq 2 → race + shakeout.
  it('PLACE-B · freq 1 and 2 race weeks respect the running-day cap', () => {
    for (const freq of [1, 2]) {
      const layout = deriveLayout(prefsWithAvail(0, null), freq);
      const { fails } = evalCase(layout, SCENARIOS[1].sc);
      const capBreaks = fails.filter((s) => s.includes('run days >'));
      expect(capBreaks).toEqual([]);
    }
  });

  // freq=0 maps to tdpw=3 (gentle couch-to-X floor) → exactly at the 3-touch
  // race-week minimum, so it does NOT overflow. Guards the boundary.
  it('freq=0 (→tdpw 3) does NOT overflow the race week (inv 9 boundary)', () => {
    const layout = deriveLayout(prefsWithAvail(0, null), 0);
    const { fails } = evalCase(layout, SCENARIOS[1].sc);
    expect(fails.filter((s) => s.includes('run days >'))).toEqual([]);
  });

  // ─── inv 2 holds everywhere, including race week, for every freq ───────
  it('every week is exactly 7 contiguous days for every freq (inv 2)', () => {
    const seen: string[] = [];
    for (const freq of FREQS) {
      const layout = deriveLayout(prefsWithAvail(0, [1, 3, 5]), freq);
      const { fails } = evalCase(layout, SCENARIOS[1].sc);
      seen.push(...fails.filter((s) => s.includes('day-rows') || s.includes('distinct DOWs') || s.includes('missing DOW')));
    }
    expect(seen).toEqual([]);
  });
});
