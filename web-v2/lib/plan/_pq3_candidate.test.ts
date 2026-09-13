import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  validateComposedPlan, type PlanValidationContext,
} from './validate';
import type { ComposedWeek, DayPlan, ComposePlanResult, BlockPlan } from './generate';

// ── Real data, loaded once ──────────────────────────────────────────────────
const RAW = JSON.parse(readFileSync('/tmp/pq3_full.json', 'utf8')) as {
  weeks: Array<{ id: string; week_idx: number; week_start_iso: string; phase_id: string; is_cutback: boolean; is_peak: boolean; is_race_week: boolean }>;
  phases: Array<{ id: string; label: string; start_week_idx: number; end_week_idx: number }>;
  workouts: Array<{ week_id: string; date_iso: string; dow: number; type: string; distance_mi: string | number; pace_target_s_per_mi: number | null; is_quality: boolean; is_long: boolean; sub_label: string | null; notes: string | null }>;
};

function num(x: string | number | null): number {
  if (x == null) return 0;
  return typeof x === 'number' ? x : parseFloat(x);
}

function phaseLabelFor(weekIdx: number): string {
  const p = RAW.phases.find((ph) => weekIdx >= ph.start_week_idx && weekIdx <= ph.end_week_idx);
  return p?.label ?? 'QUALITY';
}

function realDay(w: RAW['workouts'][number]): DayPlan {
  return {
    dow: w.dow as DayPlan['dow'],
    type: w.type as DayPlan['type'],
    distanceMi: num(w.distance_mi),
    isQuality: w.is_quality,
    isLong: w.is_long,
    subLabel: w.sub_label,
    notes: w.notes ?? '',
  };
}

/** The real, persisted 15-week block, as ComposedWeek[] — the CONTROL. */
function buildRealWeeks(): ComposedWeek[] {
  return RAW.weeks.map((w) => {
    const days = RAW.workouts.filter((wo) => wo.week_id === w.id).map(realDay);
    const weeklyMi = Math.round(days.reduce((s, d) => s + d.distanceMi, 0) * 10) / 10;
    return {
      startISO: w.week_start_iso,
      phase: phaseLabelFor(w.week_idx),
      weeklyMi,
      days,
      isRaceWeek: w.is_race_week,
      isCutback: w.is_cutback,
    } satisfies ComposedWeek;
  });
}

const MP_PACE = 472; // 7:52/mi — the canonical current marathon-training pace (see 07-phase2-correction-log.md), NOT the 6:52/mi goal pace.
const MP_RANGE: [number, number] = [460, 488];

function mpDay(over: Partial<DayPlan> & { distanceMi: number; dow: DayPlan['dow'] }): DayPlan {
  return { type: 'easy', isQuality: false, isLong: false, subLabel: null, notes: '', ...over };
}

/** Wk9 (index 9) as Alternative A builds it: PRESERVE the 21.5mi long run,
 *  embed 8mi @ MP inside it, and make the long run the week's ONLY quality
 *  stimulus — no standalone tempo, no VO2max intervals (Research/00a "add
 *  mileage OR intensity, not both"). Freed tempo/interval volume becomes
 *  easy aerobic mileage, holding the week near its authored 60mi peak. */
function wk9AltA(): DayPlan[] {
  return [
    mpDay({ dow: 1, distanceMi: 8.0, notes: '6×20s strides' }),           // Mon
    mpDay({ dow: 2, distanceMi: 9.0 }),                                    // Tue (was tempo day; now easy/aerobic)
    mpDay({ dow: 3, distanceMi: 7.0, notes: '6×20s strides' }),           // Wed
    mpDay({ dow: 4, distanceMi: 8.0 }),                                    // Thu (was intervals day; now easy/aerobic)
    mpDay({ dow: 5, distanceMi: 6.5 }),                                    // Fri
    mpDay({ dow: 6, distanceMi: 0, type: 'rest' }),                        // Sat (fixed rest day)
    mpDay({
      dow: 0, distanceMi: 21.5, type: 'long', isLong: true, isQuality: true,
      subLabel: 'LONG · 13.5mi @ E + 8mi @ M',
      notes: `Marathon-effort finish inside the long run at ${MP_PACE} s/mi (7:52/mi) — your current demonstrated marathon-training pace, not the 3:00 goal pace.`,
    }),
  ];
}

/** Wk9 as Alternative B builds it: REDUCE the long run to 17.5mi, embed 10mi
 *  @ MP, same "sole quality stimulus" principle. Total volume comes in lower
 *  (~56-57mi) than the authored 60mi peak — an explicit trade-off favoring
 *  MP-specific dose and a lower absolute long-run distance over hitting the
 *  authored volume target exactly. */
function wk9AltB(): DayPlan[] {
  return [
    mpDay({ dow: 1, distanceMi: 8.0, notes: '6×20s strides' }),
    mpDay({ dow: 2, distanceMi: 8.5 }),
    mpDay({ dow: 3, distanceMi: 7.0, notes: '6×20s strides' }),
    mpDay({ dow: 4, distanceMi: 7.5 }),
    mpDay({ dow: 5, distanceMi: 6.0 }),
    mpDay({ dow: 6, distanceMi: 0, type: 'rest' }),
    mpDay({
      dow: 0, distanceMi: 17.5, type: 'long', isLong: true, isQuality: true,
      subLabel: 'LONG · 4mi @ E + 10mi @ M + 3.5mi @ E',
      notes: `Marathon-effort finish inside the long run at ${MP_PACE} s/mi (7:52/mi) — your current demonstrated marathon-training pace, not the 3:00 goal pace.`,
    }),
  ];
}

/** Wk11 dress rehearsal, raised toward doctrine's 18-22mi / 4-8mi bands
 *  (Research/04 §4.6). Alt A takes the moderate reading (Wk9 already carried
 *  a real MP dose); Alt B takes the fuller reading the adversarial reviewer
 *  argued for. Both keep the week's zero-quality-elsewhere shape (post-Malibu
 *  recovery), which was already doctrine-correct and unchanged. */
function wk11Days(totalMi: number, mpMi: number): DayPlan[] {
  const easyMi = totalMi - mpMi;
  return [
    mpDay({ dow: 1, distanceMi: 4.5, notes: '8×20s strides' }),
    mpDay({ dow: 2, distanceMi: 5.0 }),
    mpDay({ dow: 3, distanceMi: 5.0, notes: '8×20s strides' }),
    mpDay({ dow: 4, distanceMi: 5.0 }),
    mpDay({ dow: 5, distanceMi: 5.0 }),
    mpDay({ dow: 6, distanceMi: 0, type: 'rest' }),
    mpDay({
      dow: 0, distanceMi: totalMi, type: 'long', isLong: true, isQuality: false,
      subLabel: `LONG · ${(easyMi / 2).toFixed(1)}mi @ E + ${mpMi}mi @ M + ${(easyMi / 2).toFixed(1)}mi @ E`,
      notes: `Dress rehearsal. Marathon-effort finish at ${MP_PACE} s/mi (7:52/mi).`,
    }),
  ];
}

function withReplacedWeeks(replacements: Record<number, DayPlan[]>): ComposedWeek[] {
  const real = buildRealWeeks();
  return real.map((w, i) => {
    if (!(i in replacements)) return w;
    const days = replacements[i];
    const weeklyMi = Math.round(days.reduce((s, d) => s + d.distanceMi, 0) * 10) / 10;
    return { ...w, days, weeklyMi };
  });
}

const BLOCKS: BlockPlan = {
  totalWeeks: 15,
  phases: RAW.phases.map((p) => ({
    label: p.label, weeks: p.end_week_idx - p.start_week_idx + 1, rationale: '', citation: '',
  })),
};

const EMBEDDED_RACES = [
  { date: '2026-09-13', distanceMi: 6.2, name: 'Santa Monica 10k', priority: 'B', plannedRole: null },
  { date: '2026-09-26', distanceMi: 6.21, name: 'Dodgers', priority: 'C', plannedRole: null },
  { date: '2026-11-08', distanceMi: 13.1, name: 'Run Malibu', priority: 'B', plannedRole: null },
];

// The real, David-approved "designed race weekend" decision, verbatim from
// authored_state.placement_compromises (Phase 2 uncertainty ledger) — without
// this, the validator correctly sees an unexplained hard-day pairing and
// refuses it (UNGRANTED_RACE_LONG_PAIR). This is a harness-completeness fix,
// not a candidate change: the real system already carries this grant.
const PLACEMENT_COMPROMISES = [
  {
    code: 'ACCEPT_AS_HARD_WORKOUT',
    dateISO: '2026-09-27',
    raceName: 'Dodgers',
    raceSlug: 'dodgers',
    raceDateISO: '2026-09-26',
    designedWeekend: {
      combinedMi: 23.21, longMi: 17, raceMi: 6.21, gapDays: 1,
      evidence: { pairVolume: { combinedMi: 27.85 }, recentHabitLongMi: 18, sustainedWeeklyMi: 45.5 },
    },
  },
];

function resultFor(weeks: ComposedWeek[]): ComposePlanResult {
  return {
    weeks,
    blocks: BLOCKS,
    totalWeeks: 15,
    vols: weeks.map((w) => w.weeklyMi),
    authoredState: { embedded_races: EMBEDDED_RACES, placement_compromises: PLACEMENT_COMPROMISES },
  } as unknown as ComposePlanResult;
}

const CTX: PlanValidationContext = {
  level: 'advanced',
  isSteppingStoneToMarathon: false,
  priorPlanPeakLongMi: null,
  todayISO: '2026-09-03',
  trainingDaysPerWeek: 6,
  trailingAvgWeeklyMi: 45.5,
  recentWeeklyMi: 45.5,
};

function tryValidate(label: string, weeks: ComposedWeek[]): { label: string; violations: string[] } {
  try {
    validateComposedPlan(resultFor(weeks), 26.22, 'race-prep', CTX);
    return { label, violations: [] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { label, violations: msg.split('\n').filter(Boolean) };
  }
}

describe('PQ3 · candidate validation against the real validateComposedPlan gate', () => {
  it('CONTROL: the real, unmodified persisted plan — sanity check the harness itself', () => {
    const r = tryValidate('control', buildRealWeeks());
    console.log('CONTROL RESULT:', JSON.stringify(r, null, 2));
    // Not asserted pass/fail here — reported, because if the harness's own
    // PlanValidationContext guess is wrong, the REAL plan could fail for a
    // reason that has nothing to do with either candidate. See report.
  });

  it('ALTERNATIVE A: preserve Wk9 long-run distance (21.5mi), MP-load it, drop stacked tempo/VO2', () => {
    const weeks = withReplacedWeeks({
      9: wk9AltA(),
      11: wk11Days(18, 6),
    });
    const r = tryValidate('alt-a', weeks);
    console.log('ALT A RESULT:', JSON.stringify(r, null, 2));
    console.log('ALT A WEEKLY MI:', JSON.stringify(weeks.map((w) => w.weeklyMi)));
  });

  it('ALTERNATIVE B: reduce Wk9 long run to 17.5mi, MP-load it, fuller Wk11 dose', () => {
    const weeks = withReplacedWeeks({
      9: wk9AltB(),
      11: wk11Days(18, 8),
    });
    const r = tryValidate('alt-b', weeks);
    console.log('ALT B RESULT:', JSON.stringify(r, null, 2));
    console.log('ALT B WEEKLY MI:', JSON.stringify(weeks.map((w) => w.weeklyMi)));
  });
});
