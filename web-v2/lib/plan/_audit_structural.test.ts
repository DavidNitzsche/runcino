/**
 * lib/plan/_audit_structural.test.ts · EXHAUSTIVE STRUCTURAL-INTEGRITY sweep.
 *
 * Audit dimension: STRUCTURAL INTEGRITY & SAFETY (onboarding→plan invariants
 * 1, 2, 13). Calls composePlan() across the FULL offline runner-input domain
 * and asserts, for every single combination:
 *
 *   (1)  composePlan either RETURNS a structurally-valid ComposePlanResult,
 *        or THROWS cleanly (a throw is the "fail-safe with an explicit reason"
 *        path — composePlan is pure and has no ok:false channel; the DB wrapper
 *        catches the throw and blocks the write). It must NEVER return a
 *        partial/garbage plan and NEVER throw a non-Error / undefined.
 *   (2)  EXACTLY 7 calendar days per week — dows {0..6} each present exactly
 *        once, no dup, no gap, no "1 then 8" (the week-strip bug). Exactly one
 *        primary workout per day (the slot model is one DayPlan per dow).
 *   (13) No NaN / null / undefined / negative / absurd distance anywhere, and a
 *        sane phase sequence (BASE? → QUALITY → RACE-SPECIFIC? → TAPER, race
 *        week last, every phase a known label).
 *
 * This is the offline substrate sweep: it constructs ComposePlanInput DIRECTLY,
 * sweeping level × recentWeeklyMi × trainingDaysPerWeek × raceDistanceMi ×
 * goalPaceSec (fast/median/slow) × plan-length × availableDows. The live API
 * mapping + persistence is covered by scripts/_audit_onboarding_plan_matrix.mjs.
 *
 * Strategy: one programmatic combinatorial loop (NOT it.each — the domain is
 * tens of thousands of cases). composePlan runs in a try/catch; a per-result
 * structural validator collects violations; the final assertions require ZERO
 * structural violations across all surviving plans. Clean throws are accounted
 * separately as safe-failures, never as crashes.
 */

import { describe, it, expect } from 'vitest';
import {
  composePlan,
  inlinePrescriptions,
  distanceCategoryOfPublic,
  type ComposePlanInput,
  type ComposePlanResult,
  type DOW,
} from './generate';
import { tPaceFromGoal } from './spec-builder';

// ── domain ────────────────────────────────────────────────────────────────

type LevelKey = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus' | null;

const LEVELS: LevelKey[] = ['beginner', 'intermediate', 'advanced', 'advanced_plus', null];
const WEEKLY_MI = [0, 5, 15, 25, 35, 45, 55];
const FREQ: (number | null)[] = [0, 1, 2, 3, 4, 5, 6, null];
const PLAN_WEEKS = [4, 5, 12, 16, 24, 52];

// Canonical race-distance miles, byte-matching app/api/race/route.ts's
// distanceMiFromLabel so the sweep exercises real onboarding distances.
const RACES: { label: string; mi: number }[] = [
  { label: '5K', mi: 3.10686 },
  { label: '10K', mi: 6.21371 },
  { label: 'HM', mi: 13.1094 },
  { label: 'M', mi: 26.2 },
  { label: '50K', mi: 31.07 },
  { label: '100K', mi: 62.14 },
];

// Goal-pace selector: a FAST, a MEDIAN, and a SLOW goal pace (sec/mi) for each
// distance. Fast trips 'elite', median ≈ 'intermediate', slow ≈ 'developing'
// (the over-volumed-for-goal case). NaN/0/null are also probed separately.
function goalPaces(mi: number): { tag: string; paceSec: number | null }[] {
  const cat = distanceCategoryOfPublic(mi);
  // per-distance [fast, median, slow] sec/mi, chosen to land in distinct tiers
  const triple: Record<string, [number, number, number]> = {
    '5k': [300, 450, 600], // 5:00 / 7:30 / 10:00 per mi
    '10k': [320, 470, 620],
    hm: [350, 500, 650],
    m: [350, 500, 660],
    ultra: [400, 560, 780],
  };
  const [fast, median, slow] = triple[cat];
  return [
    { tag: 'fast', paceSec: fast },
    { tag: 'median', paceSec: median },
    { tag: 'slow', paceSec: slow },
    { tag: 'noGoal', paceSec: null }, // time-trial / no goal-time path
  ];
}

// availableDows shapes — none(unset) + a couple of awkward subsets. Kept small
// (×3) so the cartesian product stays tractable; the awkward shapes (only
// weekends, only consecutive days) are the structurally-stressful ones.
const AVAIL: { tag: string; set: Set<number> | null }[] = [
  { tag: 'unset', set: null },
  { tag: 'weekendsOnly', set: new Set([0, 6]) }, // Sun+Sat only — long & rest collide
  { tag: 'consec3', set: new Set([1, 2, 3]) }, // Mon-Tue-Wed only
];

// ── ComposePlanInput builder ────────────────────────────────────────────────

const ISO_START = '2026-01-05'; // a Monday — deterministic layout

function raceDateForWeeks(weeks: number): string {
  // race day = start + weeks*7 - 1 (Sunday end), mirrors personaToComposeInput
  const d = new Date(ISO_START + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + weeks * 7 - 1);
  return d.toISOString().slice(0, 10);
}

function buildInput(o: {
  level: LevelKey;
  weeklyMi: number;
  freq: number | null;
  raceMi: number;
  goalPaceSec: number | null;
  weeks: number;
  avail: Set<number> | null;
  longRunDow?: DOW;
  restDow?: DOW;
  qualityDows?: DOW[];
}): ComposePlanInput {
  const cat = distanceCategoryOfPublic(o.raceMi);
  const goalSec = o.goalPaceSec != null ? Math.round(o.goalPaceSec * o.raceMi) : null;
  return {
    raceDistanceMi: o.raceMi,
    goalSec,
    goalPaceSec: o.goalPaceSec,
    raceDateISO: raceDateForWeeks(o.weeks),
    startMondayISO: ISO_START,
    level: o.level,
    recentWeeklyMi: o.weeklyMi,
    easyDayMedianMi: Math.max(3, Math.round(o.weeklyMi / 5)),
    recentLongMi: Math.round(o.weeklyMi * 0.25),
    isMidBlock: false,
    longRunDow: o.longRunDow ?? (0 as DOW), // Sun
    restDow: o.restDow ?? (6 as DOW), // Sat
    qualityDows: o.qualityDows ?? ([2, 4] as DOW[]), // Tue + Thu
    availableDows: o.avail,
    trainingDaysPerWeek: o.freq,
    crossModes: [],
    rxQuality: inlinePrescriptions(cat),
    rxRaceSpecific: inlinePrescriptions(cat),
    tPaceSec: o.goalPaceSec != null ? tPaceFromGoal(goalSec, o.raceMi) : null,
    lthr: null,
    maxHr: null,
  };
}

// ── structural validator ────────────────────────────────────────────────────

const KNOWN_PHASES = new Set(['BASE', 'QUALITY', 'RACE-SPECIFIC', 'TAPER']);
const KNOWN_DAY_TYPES = new Set([
  'easy', 'long', 'threshold', 'intervals', 'tempo', 'race', 'rest',
  'shakeout', 'race_week_tuneup',
]);
// Distance ceilings. The largest legit single workout is an ultra race day
// (100K = 62.14mi); anything beyond that is absurd. Weekly ceiling generous.
const ABSURD_DAY_MI = 70;
const ABSURD_WEEK_MI = 200;

interface Violation {
  inv: 1 | 2 | 13;
  msg: string;
}

function validateStructure(res: ComposePlanResult): Violation[] {
  const v: Violation[] = [];
  const push = (inv: 1 | 2 | 13, msg: string) => v.push({ inv, msg });

  // ── invariant 1 · shape is a real plan, not a partial/garbage ───────────
  if (res == null || typeof res !== 'object') {
    push(1, `result is not an object: ${String(res)}`);
    return v;
  }
  if (!Array.isArray(res.weeks)) {
    push(1, `weeks is not an array: ${typeof res.weeks}`);
    return v;
  }
  if (res.weeks.length < 1) {
    push(1, `plan has ${res.weeks.length} weeks (empty plan)`);
    return v;
  }
  if (!Number.isInteger(res.totalWeeks) || res.totalWeeks < 1) {
    push(1, `totalWeeks invalid: ${res.totalWeeks}`);
  }
  if (!res.blocks || !Array.isArray(res.blocks.phases) || res.blocks.phases.length < 1) {
    push(1, `blocks.phases missing/empty`);
  }
  if (!Array.isArray(res.vols) || res.vols.length < 1) {
    push(1, `vols missing/empty`);
  } else {
    res.vols.forEach((mi, i) => {
      if (!Number.isFinite(mi) || mi < 0) push(13, `vols[${i}] = ${mi} (NaN/neg)`);
    });
  }

  // ── per-week structure ──────────────────────────────────────────────────
  res.weeks.forEach((w, wi) => {
    // invariant 1 · week object integrity
    if (!w || !Array.isArray(w.days)) {
      push(1, `week ${wi}: days not an array`);
      return;
    }
    // invariant 2 · EXACTLY 7 days, dows {0..6} each once, one primary/day
    if (w.days.length !== 7) {
      push(2, `week ${wi} (${w.phase}): ${w.days.length} days (expected 7)`);
    }
    const dows = w.days.map((d) => d.dow);
    const dowSet = new Set(dows);
    if (dowSet.size !== w.days.length) {
      push(2, `week ${wi}: duplicate dow(s) — dows=[${dows.join(',')}]`);
    }
    for (let d = 0; d < 7; d++) {
      if (!dowSet.has(d as DOW)) push(2, `week ${wi}: missing dow ${d} (gap) — dows=[${dows.join(',')}]`);
    }
    for (const dd of dows) {
      if (!Number.isInteger(dd) || dd < 0 || dd > 6) push(2, `week ${wi}: out-of-range dow ${dd}`);
    }
    // contiguity: sorted dows must be exactly 0..6 (no "1 then 8")
    const sorted = [...dows].sort((a, b) => a - b);
    const contiguous = sorted.length === 7 && sorted.every((dd, i) => dd === i);
    if (!contiguous && w.days.length === 7) {
      push(2, `week ${wi}: non-contiguous dows [${sorted.join(',')}]`);
    }

    // invariant 13 · per-day distance + type sanity
    let raceDayCount = 0;
    let longDayCount = 0;
    for (const day of w.days) {
      if (day == null) {
        push(1, `week ${wi}: a null day slot survived`);
        continue;
      }
      const mi = day.distanceMi;
      if (mi == null || typeof mi !== 'number' || Number.isNaN(mi)) {
        push(13, `week ${wi} dow ${day.dow}: distanceMi NaN/null (${mi}, type=${day.type})`);
      } else {
        if (mi < 0) push(13, `week ${wi} dow ${day.dow}: negative distance ${mi}`);
        if (mi > ABSURD_DAY_MI) push(13, `week ${wi} dow ${day.dow}: absurd distance ${mi} (type=${day.type})`);
        // rest/shakeout sanity: a rest day must be 0; a running day type must be >0
        if (day.type === 'rest' && mi !== 0) push(13, `week ${wi} dow ${day.dow}: rest day with ${mi}mi`);
        if ((day.type === 'easy' || day.type === 'long' || day.type === 'tempo' ||
             day.type === 'threshold' || day.type === 'intervals' || day.type === 'race' ||
             day.type === 'race_week_tuneup' || day.type === 'shakeout') && mi <= 0) {
          push(13, `week ${wi} dow ${day.dow}: ${day.type} with non-positive ${mi}mi`);
        }
      }
      if (!KNOWN_DAY_TYPES.has(day.type)) push(13, `week ${wi} dow ${day.dow}: unknown type "${day.type}"`);
      if (typeof day.isLong !== 'boolean' || typeof day.isQuality !== 'boolean') {
        push(1, `week ${wi} dow ${day.dow}: isLong/isQuality not boolean`);
      }
      if (day.type === 'race') raceDayCount++;
      if (day.isLong && day.type === 'long') longDayCount++;
    }
    // invariant 13 · weekly total sane
    const weekMi = w.days.reduce((s, d) => s + (d && Number.isFinite(d.distanceMi) ? d.distanceMi : 0), 0);
    if (weekMi > ABSURD_WEEK_MI) push(13, `week ${wi}: absurd weekly total ${weekMi.toFixed(1)}mi`);
    // a non-race, non-taper week should carry exactly one long; race week zero
    if (w.isRaceWeek) {
      if (raceDayCount !== 1) push(13, `week ${wi}: race week has ${raceDayCount} race days (expected 1)`);
    } else if (w.phase !== 'TAPER') {
      if (longDayCount > 1) push(13, `week ${wi}: ${longDayCount} long days (expected ≤1)`);
    }
    // invariant 1 · phase label known
    if (!KNOWN_PHASES.has(w.phase)) push(1, `week ${wi}: unknown phase "${w.phase}"`);
  });

  // ── sane phase sequence (invariant 13 — "a sane phase sequence") ─────────
  // The chronological phase order must be a subsequence of
  // BASE → QUALITY → RACE-SPECIFIC → TAPER, never go backwards, and the
  // last week must be the race week.
  const order = ['BASE', 'QUALITY', 'RACE-SPECIFIC', 'TAPER'];
  const rank = (p: string) => order.indexOf(p);
  let prevRank = -1;
  for (const w of res.weeks) {
    const r = rank(w.phase);
    if (r < 0) continue; // unknown handled above
    if (r < prevRank) {
      push(13, `phase regression: ${w.phase} after a later phase (week ${w.startISO})`);
      break;
    }
    prevRank = Math.max(prevRank, r);
  }
  const last = res.weeks[res.weeks.length - 1];
  if (!last.isRaceWeek) push(13, `last week (${last.startISO}, ${last.phase}) is not the race week`);
  // exactly one race week, and it is the last
  const raceWeeks = res.weeks.filter((w) => w.isRaceWeek);
  if (raceWeeks.length !== 1) push(13, `plan has ${raceWeeks.length} race weeks (expected 1)`);

  return v;
}

// ── the sweep ───────────────────────────────────────────────────────────────

interface Failure {
  id: string;
  inputJson: string;
  invariant: string;
  detail: string;
}

interface SweepOut {
  combos: number;
  okPlans: number;
  safeThrows: number; // clean Error throws — fail-safe path, acceptable
  badThrows: number; // non-Error / undefined throws — crashes
  structuralFailures: Failure[];
  throwReasons: Record<string, number>;
  badThrowSamples: Failure[];
}

function runSweep(): SweepOut {
  const out: SweepOut = {
    combos: 0,
    okPlans: 0,
    safeThrows: 0,
    badThrows: 0,
    structuralFailures: [],
    throwReasons: {},
    badThrowSamples: [],
  };

  for (const level of LEVELS) {
    for (const weeklyMi of WEEKLY_MI) {
      for (const freq of FREQ) {
        for (const race of RACES) {
          for (const gp of goalPaces(race.mi)) {
            for (const weeks of PLAN_WEEKS) {
              for (const av of AVAIL) {
                out.combos++;
                const o = {
                  level,
                  weeklyMi,
                  freq,
                  raceMi: race.mi,
                  goalPaceSec: gp.paceSec,
                  weeks,
                  avail: av.set,
                };
                const id = `${level}/${weeklyMi}mi/freq${freq}/${race.label}/${gp.tag}/${weeks}w/${av.tag}`;
                const inputJson = JSON.stringify({ ...o, avail: av.set ? [...av.set] : null });
                let res: ComposePlanResult | null = null;
                try {
                  res = composePlan(buildInput(o));
                } catch (e) {
                  // invariant 1 · a throw is the fail-safe path IF it is a real
                  // Error with a message. A non-Error/undefined throw is a crash.
                  if (e instanceof Error && typeof e.message === 'string' && e.message.length > 0) {
                    out.safeThrows++;
                    const key = e.message.split('\n')[0].slice(0, 80);
                    out.throwReasons[key] = (out.throwReasons[key] ?? 0) + 1;
                  } else {
                    out.badThrows++;
                    if (out.badThrowSamples.length < 20) {
                      out.badThrowSamples.push({
                        id, inputJson,
                        invariant: 'INV1 crash',
                        detail: `non-Error throw: ${String(e)}`,
                      });
                    }
                  }
                  continue;
                }
                out.okPlans++;
                const vios = validateStructure(res);
                if (vios.length > 0 && out.structuralFailures.length < 200) {
                  for (const vio of vios) {
                    out.structuralFailures.push({
                      id, inputJson,
                      invariant: `INV${vio.inv}`,
                      detail: vio.msg,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return out;
}

// run ONCE, share across assertions
const SWEEP = runSweep();

// Dump a machine-readable digest so the exact breakdown is recoverable
// regardless of the vitest reporter's console flushing. Best-effort.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs');
  const norm = (s: string) => s.replace(/week \d+/g, 'week N').replace(/dow \d+/g, 'dow D');
  const byCat: Record<string, number> = {};
  for (const f of SWEEP.structuralFailures) {
    const k = `${f.invariant} · ${norm(f.detail)}`;
    byCat[k] = (byCat[k] ?? 0) + 1;
  }
  const distinctInputs = new Set(SWEEP.structuralFailures.map((f) => f.id)).size;
  fs.writeFileSync('/tmp/_audit_structural_digest.json', JSON.stringify({
    combos: SWEEP.combos,
    okPlans: SWEEP.okPlans,
    safeThrows: SWEEP.safeThrows,
    badThrows: SWEEP.badThrows,
    structuralFailureRows: SWEEP.structuralFailures.length,
    distinctFailingInputs: distinctInputs,
    failureCategories: byCat,
    throwReasons: SWEEP.throwReasons,
    firstFailures: SWEEP.structuralFailures.slice(0, 5),
    badThrowSamples: SWEEP.badThrowSamples,
  }, null, 2));
} catch { /* fs unavailable — non-fatal */ }

describe('Structural sweep · composePlan across full offline domain', () => {
  it('exercised a large combinatorial domain', () => {
    // 5 levels × 7 weeklyMi × 8 freq × 6 races × 4 goalPaces × 6 weeks × 3 avail
    expect(SWEEP.combos).toBe(5 * 7 * 8 * 6 * 4 * 6 * 3);
    expect(SWEEP.combos).toBeGreaterThan(40000);
    // eslint-disable-next-line no-console
    console.log(
      `[structural sweep] combos=${SWEEP.combos} okPlans=${SWEEP.okPlans} ` +
      `safeThrows=${SWEEP.safeThrows} badThrows=${SWEEP.badThrows} ` +
      `structuralFailures=${SWEEP.structuralFailures.length}`,
    );
    if (Object.keys(SWEEP.throwReasons).length > 0) {
      // eslint-disable-next-line no-console
      console.log('[structural sweep] throw reasons:', JSON.stringify(SWEEP.throwReasons, null, 2));
    }
  });

  it('INVARIANT 1 · never crashes (no non-Error / undefined throw)', () => {
    if (SWEEP.badThrows > 0) {
      // eslint-disable-next-line no-console
      console.error('[INV1 crashes]', JSON.stringify(SWEEP.badThrowSamples, null, 2));
    }
    expect(SWEEP.badThrows).toBe(0);
  });

  it('INVARIANT 1 · every result is a real multi-part plan (no partial/garbage)', () => {
    const inv1 = SWEEP.structuralFailures.filter((f) => f.invariant === 'INV1');
    if (inv1.length > 0) {
      // eslint-disable-next-line no-console
      console.error('[INV1 partial/garbage]', JSON.stringify(inv1.slice(0, 30), null, 2));
    }
    expect(inv1).toEqual([]);
  });

  it('INVARIANT 2 · exactly 7 contiguous days/week, one primary per day (no dup/gap/"1 then 8")', () => {
    const inv2 = SWEEP.structuralFailures.filter((f) => f.invariant === 'INV2');
    if (inv2.length > 0) {
      // eslint-disable-next-line no-console
      console.error('[INV2 day-strip]', JSON.stringify(inv2.slice(0, 30), null, 2));
    }
    expect(inv2).toEqual([]);
  });

  it('INVARIANT 13 · no NaN/null/negative/absurd distances + sane phase sequence', () => {
    const inv13 = SWEEP.structuralFailures.filter((f) => f.invariant === 'INV13');
    if (inv13.length > 0) {
      // eslint-disable-next-line no-console
      console.error('[INV13 distance/phase]', JSON.stringify(inv13.slice(0, 30), null, 2));
    }
    expect(inv13).toEqual([]);
  });

  it('a meaningful share of combos produced an actual plan (sweep is not all-throw)', () => {
    // Sanity: the sweep must genuinely exercise the generator, not just trip an
    // early guard on every case. Require the overwhelming majority to build.
    expect(SWEEP.okPlans).toBeGreaterThan(SWEEP.combos * 0.5);
  });
});

// ── targeted edge probes (beyond the grid) ──────────────────────────────────
// These hit specific structural-crash surfaces the grid samples coarsely:
// degenerate goal paces, race-before-start, every long_run_day, sub-3-week
// runway, and tiny distances.

describe('Structural edge probes · degenerate inputs fail safe, never crash', () => {
  const baseRace = { label: 'M', mi: 26.2 };

  it('NaN / 0 / negative goalPaceSec never crash and stay structurally valid', () => {
    for (const bad of [NaN, 0, -1, -999]) {
      const input = buildInput({
        level: 'intermediate', weeklyMi: 25, freq: 4,
        raceMi: baseRace.mi, goalPaceSec: bad, weeks: 16, avail: null,
      });
      let res: ComposePlanResult | null = null;
      let threw: unknown = null;
      try { res = composePlan(input); } catch (e) { threw = e; }
      if (threw != null) {
        expect(threw).toBeInstanceOf(Error);
      } else {
        expect(validateStructure(res!)).toEqual([]);
      }
    }
  });

  it('race date BEFORE start (negative runway) fails safe, never garbage', () => {
    const input: ComposePlanInput = {
      ...buildInput({ level: 'intermediate', weeklyMi: 25, freq: 4, raceMi: baseRace.mi, goalPaceSec: 500, weeks: 12, avail: null }),
      startMondayISO: '2026-06-01',
      raceDateISO: '2026-01-01', // race 5 months BEFORE start
    };
    let res: ComposePlanResult | null = null;
    let threw: unknown = null;
    try { res = composePlan(input); } catch (e) { threw = e; }
    if (threw != null) {
      expect(threw).toBeInstanceOf(Error);
    } else {
      // composePlan clamps totalWeeks to >=3, so it should still be structural.
      const vios = validateStructure(res!);
      // It's allowed to produce a (possibly odd) short plan, but it must be
      // STRUCTURALLY sound — that's invariant 1+2+13.
      expect(vios.filter((v) => v.inv === 1 || v.inv === 2)).toEqual([]);
      expect(vios.filter((v) => v.inv === 13 && /NaN|null|negative|absurd/.test(v.msg))).toEqual([]);
    }
  });

  it('every long_run_day (0..6) × every rest_day yields 7 clean contiguous days', () => {
    let combos = 0;
    const fails: string[] = [];
    for (let lrd = 0; lrd < 7; lrd++) {
      for (let rest = 0; rest < 7; rest++) {
        // quality on two days distinct from long/rest where possible
        const qd = ([1, 2, 3, 4, 5] as DOW[]).filter((d) => d !== lrd && d !== rest).slice(0, 2);
        combos++;
        const input = buildInput({
          level: 'advanced', weeklyMi: 45, freq: 6, raceMi: baseRace.mi,
          goalPaceSec: 420, weeks: 16, avail: null,
          longRunDow: lrd as DOW, restDow: rest as DOW, qualityDows: qd,
        });
        let res: ComposePlanResult | null = null;
        try { res = composePlan(input); } catch (e) {
          if (!(e instanceof Error)) fails.push(`lrd=${lrd} rest=${rest}: non-Error throw ${String(e)}`);
          continue;
        }
        const vios = validateStructure(res).filter((v) => v.inv === 2);
        if (vios.length > 0) fails.push(`lrd=${lrd} rest=${rest}: ${vios.map((v) => v.msg).join('; ')}`);
      }
    }
    expect(combos).toBe(49);
    if (fails.length > 0) {
      // eslint-disable-next-line no-console
      console.error('[edge long/rest day]', JSON.stringify(fails.slice(0, 20), null, 2));
    }
    expect(fails).toEqual([]);
  });

  it('PROTECTED · advanced/advanced_plus MARATHON plan is fully structural (invariant 12 guard)', () => {
    for (const level of ['advanced', 'advanced_plus'] as const) {
      const input = buildInput({
        level, weeklyMi: 55, freq: 6, raceMi: 26.2, goalPaceSec: 420, weeks: 18, avail: null,
      });
      const res = composePlan(input);
      expect(validateStructure(res)).toEqual([]);
      // it must have a real BASE→...→TAPER arc and a race week
      expect(res.weeks.length).toBeGreaterThan(10);
      expect(res.weeks.some((w) => w.phase === 'TAPER')).toBe(true);
      expect(res.weeks[res.weeks.length - 1].isRaceWeek).toBe(true);
    }
  });
});
