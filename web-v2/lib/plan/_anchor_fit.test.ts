/**
 * THE ANCHOR-FIT GATE (2026-08-25) · is this plan right FOR THIS RUNNER?
 *
 * Sibling of `_sweep_allusers.test.ts` (well-formed) and
 * `lib/doctrine/_doctrine_gate.test.ts` (agrees with the research). Neither of
 * those can see a block that is perfectly shaped, correctly cited, and sized
 * off the wrong number — because both grade the plan against its anchor and
 * neither grades the anchor against the runner.
 *
 * ── WHY IT WAS POSSIBLE FOR THE SWEEP TO MISS THIS ─────────────────────────
 *
 * `_sweep_allusers` composes through `buildSimPlan`, which mirrors ONBOARDING:
 * no logged runs at all. Two of the three volume anchors —
 * `recentPeakWeeklyMileage` (DOCTRINE-4) and `rampBaseForBuild` (RAMPBASE-1) —
 * are database readers, so the harness could not reach them. `recentPeakWeeklyMi`
 * was pinned to `recentWeeklyMi`: the pre-DOCTRINE-4 proxy, the exact wiring the
 * reverse-taper defect came from. Every one of those 7,680 archetypes was still
 * grading the engine that shipped the bug.
 *
 * ANCHORFIT-1 gave `SimInputs` an optional `dailyMiMostRecentFirst`, resolved
 * by the SAME pure functions production spends. This file feeds it runner
 * shapes and asks the questions in `lib/plan/anchor-fit.ts`.
 *
 * ── THE FIXTURES ARE REAL ──────────────────────────────────────────────────
 *
 * `david-post-A-half` is the owner's actual daily mileage, read from production
 * over `faff_readonly` on 2026-08-25 and transcribed here so the gate needs no
 * database. Its rolling peak is 52.3 mi/wk against a 28-day mean of 24.9 — a
 * 2.1× spread, which is what makes it the sharpest test of the rule. The other
 * shapes are synthesised, but their proportions come from the same read.
 *
 * ── IT REFUSES TO PASS ON NOTHING ──────────────────────────────────────────
 *
 * A floor on shapes exercised, a floor on plans graded, an assertion that every
 * check ran at least once, and positive controls that plant a known-bad anchor
 * — the owner's 29-against-47 among them — and prove the gate names it. A
 * scanner that opens no files and reports clean is the bug being hunted one
 * level up.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_anchor_fit.test.ts
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import {
  runChecks, EMITTABLE, dailyFromWeekly, sustainedOf, currentWeekMi,
  type AnchorFacts, type Finding,
} from './anchor-fit';
import {
  weeklyBlocksFromDaily, resolvePeakWeekly, allowedInterruptionWeeksFor,
  resolveRampBase, RAMP_BASE_RESUME_FRACTION, daysBetween,
} from './generate';
import {
  RECOVERY_WEEKLY_PCT_OF_BASE, GENERAL_RAMP_CEILING, postRaceRecoveryWeeks,
  type DistCategory,
} from './goal-tiers';
import type { SimInputs, SimDistance, SimRaceDistance } from './sim-constants';

// ─────────────────────────────────────────────────────────────────────────────
// The owner's real history · production, faff_readonly, 2026-08-25.
// dailyMi[i] = miles run i days before 2026-08-25. Rolling peak 52.3;
// calendar peaks 47.5 / 47.3 / 44.9; 28-day mean 24.9.
// ─────────────────────────────────────────────────────────────────────────────
const DAVID_DAILY = [
  0, 4, 11, 0, 9.1, 4.3, 0, 4, 0, 13.2, 0, 0, 0, 0, 6, 4, 12.4, 0, 6, 4.9, 6,
  4.8, 5.8, 0, 4.2, 0, 0, 0, 0, 0, 0, 18, 0, 5.1, 7.2, 7.5, 9.7, 0, 0, 7.9, 5.7,
  9, 8, 9.1, 12.6, 0, 5, 5.9, 6.2, 7.6, 6, 0, 0, 0, 0, 0, 0, 0, 0, 14, 0, 5.8,
  0, 8.1, 0, 13.2, 0, 6.5, 8.2, 6, 7.5, 6, 13.1, 0, 0, 6.9, 6, 8, 6, 12.6, 0, 6,
  7.8, 6.1, 7.4, 5.1, 12.4, 0, 7.7, 0, 5.9, 7.6, 6.2, 12.1, 0, 7.8, 7.2, 5.1,
  2.4, 6, 11, 0, 5, 11.2, 5.6, 4.7, 0, 0, 0, 7.4, 0, 6.7,
];

const TODAY = '2026-08-25';
const FAR_RACE = '2027-06-01';   // outside every build window → maintenance

interface Shape {
  id: string;
  /** What this shape is FOR. Printed with any finding. */
  why: string;
  daily: number[];
  lastRaceDaysAgo?: number;
  lastRaceDistance?: SimRaceDistance;
  lastRacePriority?: 'A' | 'B' | 'C';
  raceDateISO?: string;
  distance?: SimDistance;
  goalTimeSec?: number | null;
  experienceLevel?: string | null;
  vdot?: number | null;
  freq?: number;
  /** The recent dip is one the engine itself prescribed and we are still
   *  inside it. Set explicitly rather than inferred, so the fixture states
   *  its own premise. */
  dipIsMandated?: boolean;
}

/** A build block: 16 weeks climbing to a peak, then taper, then the race. */
const buildThenRace = (peak: number, weeksSince: number): number[] => {
  const pre = [
    peak * 0.55, peak * 0.62, peak * 0.70, peak * 0.66, peak * 0.78, peak * 0.84,
    peak * 0.76, peak * 0.90, peak * 0.96, peak * 0.85, peak, peak * 0.92,
  ].map((v) => Math.round(v * 10) / 10);
  const taper = [Math.round(peak * 0.75 * 10) / 10, Math.round(peak * 0.55 * 10) / 10];
  const raceWk = Math.round(peak * 0.42 * 10) / 10;
  const after = new Array(Math.max(0, weeksSince)).fill(0)
    .map((_, i) => Math.round(peak * (0.10 + i * 0.10) * 10) / 10);
  // most-recent-first
  return dailyFromWeekly([...after.reverse(), raceWk, ...taper, ...pre].slice(0, 16));
};

const SHAPES: Shape[] = [
  {
    id: 'david-post-A-half',
    why: 'The reported case. Real production history: rolling peak 52.3, 28-day mean 24.9, A-priority half nine days ago, marathon fifteen weeks out.',
    daily: DAVID_DAILY,
    lastRaceDaysAgo: 9, lastRaceDistance: 'half', lastRacePriority: 'A',
    raceDateISO: '2026-12-06', distance: 'marathon', goalTimeSec: 10800,
    experienceLevel: 'advanced', vdot: 44.1, freq: 5, dipIsMandated: true,
  },
  {
    id: 'post-marathon-A-day1',
    why: 'A 62 mi/wk marathoner authored the day after their goal marathon. The reverse taper has all four weeks left to run, so it is the longest ramp doctrine publishes.',
    daily: buildThenRace(62, 0),
    lastRaceDaysAgo: 1, lastRaceDistance: 'marathon', lastRacePriority: 'A',
    raceDateISO: FAR_RACE, experienceLevel: 'advanced', vdot: 52, freq: 6,
    dipIsMandated: true,
  },
  {
    id: 'post-marathon-A-midblock',
    why: 'The same runner re-authored ten days in · RECOVERY-2 emits only the weeks that remain, and the offset must reach the percentages.',
    daily: buildThenRace(62, 1),
    lastRaceDaysAgo: 10, lastRaceDistance: 'marathon', lastRacePriority: 'A',
    raceDateISO: FAR_RACE, experienceLevel: 'advanced', vdot: 52, freq: 6,
    dipIsMandated: true,
  },
  {
    id: 'post-half-A-day1',
    why: 'The half protocol · two weeks at 60% and 80% of peak, the shallowest reverse taper and therefore the one a ramp cap should least be able to bind.',
    daily: buildThenRace(47, 0),
    lastRaceDaysAgo: 1, lastRaceDistance: 'half', lastRacePriority: 'A',
    raceDateISO: FAR_RACE, experienceLevel: 'advanced', vdot: 47, freq: 5,
    dipIsMandated: true,
  },
  {
    id: 'david-post-CIM',
    why: 'THE BLOCK HE WILL ACTUALLY RUN. The same real production history, authored the day after a marathon instead of a half — which is what CIM produces. Four reverse-taper weeks against a 52.3 mi/wk peak, five stated running days.',
    daily: DAVID_DAILY,
    lastRaceDaysAgo: 1, lastRaceDistance: 'marathon', lastRacePriority: 'A',
    raceDateISO: FAR_RACE, experienceLevel: 'advanced', vdot: 44.1, freq: 5,
    dipIsMandated: true,
  },
  {
    id: 'post-marathon-lowvol-beginner',
    why: 'WKRAMP-REC-1 · the reverse taper where doctrine\'s percentages produce small numbers. An 18 mi/wk beginner running four days: 75% of peak is 13.5 mi, and a 20% recovery long is under three. The shape gate cannot see this and the ramp cap is not what causes it.',
    daily: buildThenRace(18, 0),
    lastRaceDaysAgo: 1, lastRaceDistance: 'marathon', lastRacePriority: 'A',
    raceDateISO: FAR_RACE, experienceLevel: 'beginner', vdot: 34, freq: 4,
    dipIsMandated: true,
  },
  {
    id: 'post-marathon-A-day1-freq5',
    why: 'WKRAMP-REC-1 · the same 62 mi/wk marathoner who states FIVE running days. The last reverse-taper week must reach its row without spending the runner\'s stated frequency, and both rest days must stay spaced.',
    daily: buildThenRace(62, 0),
    lastRaceDaysAgo: 1, lastRaceDistance: 'marathon', lastRacePriority: 'A',
    raceDateISO: FAR_RACE, experienceLevel: 'advanced', vdot: 52, freq: 5,
    dipIsMandated: true,
  },
  {
    id: 'post-10k-B',
    why: 'DOCTRINE-5 · a B race takes 60-70% of the A-race window. Effort scaling must not also scale the DEPTH.',
    daily: buildThenRace(38, 0),
    lastRaceDaysAgo: 2, lastRaceDistance: '10k', lastRacePriority: 'B',
    raceDateISO: FAR_RACE, experienceLevel: 'intermediate', vdot: 45, freq: 5,
    dipIsMandated: true,
  },
  {
    id: 'steady-35',
    why: 'Never came down from anything. Peak, sustained level and current week are the same number, so there is no last cycle to take a percentage of.',
    daily: dailyFromWeekly(new Array(16).fill(35)),
    raceDateISO: FAR_RACE, experienceLevel: 'intermediate', vdot: 46, freq: 5,
  },
  {
    id: 'steady-52-advanced',
    why: 'The same, at the owner\'s own volume · a high-mileage runner between seasons.',
    daily: dailyFromWeekly(new Array(16).fill(52), { runDays: 6 }),
    raceDateISO: FAR_RACE, experienceLevel: 'advanced', vdot: 50, freq: 6,
  },
  {
    id: 'deliberate-cutback',
    why: 'A 3-up-1-down cycle. The cutback weeks are engine-authored and must not read as a decline.',
    daily: dailyFromWeekly([40, 42, 41, 30, 40, 41, 39, 29, 38, 39, 38, 28, 36, 37, 36, 27]),
    raceDateISO: FAR_RACE, experienceLevel: 'intermediate', vdot: 46, freq: 5,
  },
  {
    id: 'travel-2wk',
    why: 'Two weeks away at 40% · exactly the SHORT_LAYOFF_WEEKS allowance, with no race to explain it.',
    daily: dailyFromWeekly([16, 17, 40, 41, 39, 42, 40, 38, 41, 39, 37, 40, 38, 36, 39, 37]),
    raceDateISO: '2026-12-06', distance: 'marathon', goalTimeSec: 12600,
    experienceLevel: 'intermediate', vdot: 46, freq: 5,
  },
  {
    id: 'illness-3wk',
    why: 'Three weeks at a third · one week PAST the short-layoff allowance, with nothing mandating it. The engine calls this a layoff, not a deload.',
    daily: dailyFromWeekly([12, 13, 14, 41, 39, 42, 40, 38, 41, 39, 37, 40, 38, 36, 39, 37]),
    raceDateISO: '2026-12-06', distance: 'marathon', goalTimeSec: 12600,
    experienceLevel: 'intermediate', vdot: 46, freq: 5,
  },
  {
    id: 'injury-6wk',
    why: 'Six weeks near zero off a 45 mi/wk block. Coming down IS correct here — what is tested is whether the block says so and whether it ever comes back.',
    daily: dailyFromWeekly([0, 3, 4, 5, 6, 8, 45, 44, 42, 45, 43, 40, 41, 38, 36, 34]),
    raceDateISO: FAR_RACE, experienceLevel: 'intermediate', vdot: 46, freq: 5,
  },
  {
    id: 'detrained-10wk',
    why: 'Ten weeks near zero. The 16-week peak window still contains a 48 mi/wk block that is no longer this runner.',
    daily: dailyFromWeekly([2, 0, 3, 0, 2, 4, 0, 3, 2, 0, 48, 46, 47, 44, 45, 42]),
    raceDateISO: FAR_RACE, experienceLevel: 'intermediate', vdot: 44, freq: 4,
  },
  {
    id: 'freak-week',
    why: 'A single 60 mi/wk week among 25s. resolveRampBase refuses to call that a base; recentPeakWeeklyMileage takes it as one.',
    daily: dailyFromWeekly([25, 24, 26, 25, 24, 25, 26, 24, 25, 26, 60, 25, 24, 25, 26, 24]),
    raceDateISO: FAR_RACE, experienceLevel: 'intermediate', vdot: 44, freq: 5,
  },
  {
    id: 'ramping-novice',
    why: 'Climbing 10 to 26 over sixteen weeks. Nothing depressed, and the anchor must not read the CLIMB as a peak to cut from.',
    daily: dailyFromWeekly([26, 25, 24, 22, 22, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10], { runDays: 4 }),
    raceDateISO: FAR_RACE, experienceLevel: 'beginner', vdot: 36, freq: 4,
  },
  {
    id: 'cold-start',
    why: 'No logged running at all. Both anchors are zero and the composers must fall through to the cold-start protocol, not to a zero-mile week.',
    daily: new Array(112).fill(0),
    raceDateISO: FAR_RACE, experienceLevel: null, vdot: null, freq: 3,
  },
  {
    id: 'comeback-build-no-vdot',
    why: 'A build authored three weeks after a half, with no race fresh enough to anchor a VDOT. RAMPBASE-1 lets the VOLUME read through the mandated dip; nothing lets the PACE.',
    daily: buildThenRace(44, 2),
    lastRaceDaysAgo: 20, lastRaceDistance: 'half', lastRacePriority: 'A',
    raceDateISO: '2026-12-06', distance: 'marathon', goalTimeSec: 12600,
    experienceLevel: 'intermediate', vdot: null, freq: 5, dipIsMandated: true,
  },
  {
    id: 'taper-now',
    why: 'Mid-taper with the race still ahead. The 28-day mean is depressed BY DESIGN and nothing has happened yet to explain it as recovery.',
    daily: dailyFromWeekly([22, 30, 44, 46, 45, 43, 46, 42, 44, 40, 42, 38, 40, 36, 38, 34]),
    raceDateISO: '2026-12-06', distance: 'marathon', goalTimeSec: 11700,
    experienceLevel: 'advanced', vdot: 49, freq: 6,
  },
];

const simOf = (s: Shape): SimInputs => ({
  goalMode: s.distance && s.goalTimeSec != null ? 'race' : 'race',
  distance: s.distance ?? 'marathon',
  startDateISO: TODAY,
  planWeeks: 0,
  goalTimeSec: s.goalTimeSec ?? null,
  raceDateISO: s.raceDateISO ?? FAR_RACE,
  lastRaceFinishedDaysAgo: s.lastRaceDaysAgo ?? null,
  lastRaceDistance: s.lastRaceDistance ?? null,
  lastRacePriority: s.lastRacePriority ?? null,
  experienceLevel: s.experienceLevel as SimInputs['experienceLevel'],
  weeklyFrequency: s.freq ?? 5,
  // Deliberately a MISLEADING self-report on every shape: the history is the
  // evidence, and a gate that let the bucket agree with it would not be able
  // to tell which one the engine read.
  weeklyMileageBucket: 25,
  longestRunBucket: '10+',
  raceHistory: [],
  longRunDay: 'sun',
  dailyMiMostRecentFirst: s.daily,
  bestRecentVdotOverride: s.vdot ?? null,
} as SimInputs);

const catOfLast = (d: SimRaceDistance | undefined): DistCategory | null =>
  d === '5k' ? '5k' : d === '10k' ? '10k' : d === 'half' ? 'hm'
    : d === 'marathon' ? 'm' : null;

/** Doctrine's own per-week fraction for the weeks this block actually emits. */
function recoveryPctFor(s: Shape, weekCount: number): number[] {
  const cat = catOfLast(s.lastRaceDistance);
  if (!cat) return [];
  const seq = RECOVERY_WEEKLY_PCT_OF_BASE[cat];
  const total = postRaceRecoveryWeeks(cat, s.lastRacePriority ?? null);
  const off = Math.max(0, total - weekCount);
  const out: number[] = [];
  for (let i = 0; i < weekCount; i++) out.push(seq[i + off] ?? seq[seq.length - 1]);
  return out;
}

function factsFor(s: Shape): AnchorFacts | { refused: string } {
  const r = buildSimPlan(simOf(s));
  if (!r.ok) return { refused: r.reason };
  const blocks = weeklyBlocksFromDaily(s.daily);
  const peak = resolvePeakWeekly(s.daily);
  let m28 = 0;
  for (let i = 0; i < 28; i++) m28 += s.daily[i] ?? 0;
  const mean = Math.round((m28 / 4) * 10) / 10;
  const lastISO = s.lastRaceDaysAgo
    ? new Date(Date.parse(TODAY + 'T12:00:00Z') - s.lastRaceDaysAgo * 86400000).toISOString().slice(0, 10)
    : null;
  const lastMi = s.lastRaceDistance
    ? ({ '5k': 3.10686, '10k': 6.21371, half: 13.1094, marathon: 26.2188 } as Record<string, number>)[s.lastRaceDistance]
    : null;
  const allowed = allowedInterruptionWeeksFor(TODAY, lastISO, lastMi ?? null, s.lastRacePriority ?? null);
  // The interruption, measured the way resolveRampBase measures it, so the
  // gate and the engine agree about what counts as "still inside a dip".
  const evidence = resolveRampBase({
    meanWeeklyMi: mean, weeklySeries: blocks, allowedInterruptionWeeks: allowed,
  });
  const st = r.composed.authoredState as Record<string, unknown>;
  const weeklyMi = r.composed.weeks.map((w) => w.weeklyMi);
  // The week's biggest run and its running-day count · what bounds a week
  // arithmetically, independent of any budget it was handed. Race days are
  // excluded: the event is not a training run.
  const trainingDays = (w: (typeof r.composed.weeks)[number]) =>
    w.days.filter((d) => d.type !== 'race' && d.distanceMi > 0);
  return {
    id: s.id,
    mode: r.mode as AnchorFacts['mode'],
    blocks,
    measuredPeakMi: peak,
    meanMi: mean,
    peakAnchorMi: r.mode === 'race-prep' ? null : (r.derived.recentPeakWeeklyMi ?? null),
    ramp: r.derived.rampBase,
    vdotAnchor: r.derived.bestRecentVdot,
    weeklyMi,
    longestRunMi: r.composed.weeks.map((w) => Math.max(0, ...trainingDays(w).map((d) => d.distanceMi))),
    runDays: r.composed.weeks.map((w) => trainingDays(w).length),
    doctrinePct: r.mode === 'recovery' ? recoveryPctFor(s, weeklyMi.length) : [],
    blockSays: r.composed.blocks.phases
      .map((p) => `${p.label} ${p.rationale}`).join(' · ').toLowerCase(),
    rampCeiling: GENERAL_RAMP_CEILING[(s.experienceLevel ?? 'intermediate') as keyof typeof GENERAL_RAMP_CEILING]
      ?? GENERAL_RAMP_CEILING.intermediate,
    statedPctApplied: typeof st['weekly_pct_applied'] === 'number' ? st['weekly_pct_applied'] as number : null,
    statedAnchorArm: typeof st['volume_anchor'] === 'string' ? st['volume_anchor'] as string : null,
    dipIsMandated: s.dipIsMandated === true,
    interruptionWeeks: evidence.interruptionWeeks,
    allowedInterruptionWeeks: allowed,
  };
}

/* ── DECISIONS · findings that need the owner, not a patch ──────────────────
 *
 * Every one of these moves a prescribed volume or pace for real runners, which
 * makes it his call rather than an agent's — he is fifteen weeks out from CIM.
 * They are RATCHETED, not exempted: the count may not grow, and when he rules
 * on one the entry has to come out or the gate says the exemption is stale.
 * Same posture as the doctrine registry's `exempt` maps.
 */
const DECISIONS_EXPECTED: Record<string, string> = {
  // RAMP_CAP_TRUNCATES_REVERSE_TAPER was RULED ON (2026-08-25) and closed by
  // WKRAMP-REC-1: a recovery block is graded against the pre-race peak it is
  // unwinding, not against its own deload weeks. Its entry is deleted here
  // because this map's staleness assertion requires it. The CHECK stays, with
  // a positive control, but be honest about what it is now: no runner shape in
  // this file can reach it any more, so it is a named regression lock rather
  // than a live finding. The lock that actually bites if the wiring is lost is
  // RECOVERY.reverse-taper-ceiling-is-the-pre-race-peak in the doctrine
  // registry, which traces the ceiling from the constant through the composer
  // to the pass and was falsified by unwiring it.
  'RECOVERY_ROW_UNREACHABLE_AT_THIS_VOLUME':
    'Underneath the ramp cap, at low volume, and it misses in BOTH directions from one cause. ' +
    'A recovery week of N runs can only express volumes between N x the 2-mile junk-run floor ' +
    'and N x its longest run. For an 18 mi/wk beginner on four days that grid is 8 to 12 miles, ' +
    'while doctrine asks for 6.3 in week 2 and 13.5 in week 4 — so the same runner is over- ' +
    'prescribed early and under-prescribed late. Closing it means moving RECOVERY_LONG_PCT at ' +
    'low day counts, the junk-run floor, or both. Different constants from the ceiling, and ' +
    'each moves real miles for real runners.',
  'MAINTENANCE_CUTS_BELOW_CURRENT_VOLUME':
    'composeMaintenancePlan grades anybody with logged history as "came down from a block" — ' +
    'MAINT-NOBLOCK-1\'s discriminator cannot tell a completed cycle from steady training — and ' +
    'then applies Research/22 §7\'s ~65-75%. Research/22 §6, the section DOCTRINE-MAINTFREQ-1 ' +
    'ruled governs this mode, says 80-100% "or whatever level the runner can sustain durably". ' +
    'Closing it RAISES maintenance volume for every steadily-training runner.',
  'AUDIT_RECORD_DISAGREES_WITH_PLAN':
    'authored_state publishes the fraction and the arm it intended alongside a target_weekly_mi ' +
    'that VOL-2 rewrites to the realized day-sum. An audit surface only; no runner-facing number ' +
    'moves, but the fix is the same one the ramp-cap decision turns on.',
  'PEAK_IS_AN_OUTLIER':
    'recentPeakWeeklyMileage is a raw MAX where resolveRampBase is rank-3. Aligning them LOWERS ' +
    'recovery and maintenance volume for anyone with one big week.',
  'PEAK_IS_STALE':
    'The peak reader has no interruption-length guard; RAMPBASE-1 gave that only to race-prep. ' +
    'Closing it LOWERS volume for interrupted maintenance and recovery runners.',
  'PACE_ANCHOR_STILL_DEPRESSED':
    'The volume base reads through a mandated interruption; the pace anchor still reads the ' +
    'interruption itself. Closing it MOVES PRESCRIBED PACES for every runner without a fresh race.',
};

describe('anchor fit · the plan is right for THIS runner', () => {
  const firm: Finding[] = [];
  const decisions: Finding[] = [];
  const seen = new Set<string>();
  const refused: string[] = [];
  let graded = 0;

  it('grades every runner shape', () => {
    for (const s of SHAPES) {
      const f = factsFor(s);
      if ('refused' in f) { refused.push(`${s.id}: ${f.refused}`); continue; }
      graded++;
      for (const finding of runChecks(f)) {
        seen.add(finding.check);
        (finding.severity === 'FIRM' ? firm : decisions).push({
          ...finding,
          message: `${finding.message}\n      shape: ${s.why}`,
        });
      }
    }

    // ── the floor · this gate refuses to pass on nothing ──────────────────
    expect(SHAPES.length, 'runner shapes in the table').toBeGreaterThanOrEqual(14);
    expect(graded, 'shapes that produced a plan to grade').toBeGreaterThanOrEqual(14);
    expect(refused, 'a shape the engine refused is a shape this gate did not test').toEqual([]);

    if (firm.length > 0) {
      throw new Error(
        `\n${firm.length} FIRM anchor-fit failure(s):\n\n` +
        firm.map((x) => `  · [${x.check}] ${x.message}`).join('\n\n') + '\n',
      );
    }
  });

  it('every DECISION is one the owner has not ruled on yet', () => {
    const kinds = [...new Set(decisions.map((d) => d.check))].sort();
    const undocumented = kinds.filter((k) => !(k in DECISIONS_EXPECTED));
    expect(
      undocumented,
      'a new anchor-fit DECISION appeared with no argument recorded · add it to ' +
      'DECISIONS_EXPECTED with the reason it is the owner\'s call, or fix it',
    ).toEqual([]);
    // Staleness, the same way the doctrine registry checks its exemptions: an
    // entry that no longer fires has been ruled on and must come out.
    const stale = Object.keys(DECISIONS_EXPECTED).filter((k) => !kinds.includes(k));
    expect(
      stale,
      'DECISIONS_EXPECTED carries an entry nothing fires any more · delete it',
    ).toEqual([]);
    // Printed, not hidden: the whole point is that these reach a human.
    if (decisions.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `\nANCHOR-FIT DECISIONS (${decisions.length}) — owner's call, not fixed here:\n\n` +
        decisions.map((x) => `  · [${x.check}] ${x.message}`).join('\n\n') + '\n',
      );
    }
  });

  it('the FIRM checks are silent on every shape, and that silence is asserted', () => {
    // These three are the regression lock. They are silent today because the
    // engine is correct today, and that is a claim this file makes out loud
    // rather than an absence it happens to have.
    for (const n of ['ANCHOR_CIRCULAR', 'ANCHOR_INFLATED', 'SILENT_DOWNGRADE', 'VOLUME_OUTSIDE_ANCHOR_BAND', 'RECOVERY_EXCEEDS_PRE_RACE_PEAK']) {
      expect(seen.has(n), `${n} fired · see the FIRM failures above`).toBe(false);
    }
    // And the DECISION checks DID reach real runner shapes — a decision nobody
    // can reproduce is not a decision, it is a note.
    for (const n of Object.keys(DECISIONS_EXPECTED)) {
      expect(
        seen.has(n),
        `${n} is listed as an open decision but fired on none of ${SHAPES.length} shapes`,
      ).toBe(true);
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * POSITIVE CONTROLS
 *
 * GUARD 0, borrowed from `check-swallowed-failure.sh`: a gate that inspects
 * nothing and reports clean is exactly the bug being hunted, one level up. Each
 * control plants a defect the checks are supposed to see and asserts they see
 * it — including the owner's own 29-against-47.
 * ────────────────────────────────────────────────────────────────────────── */
const CONTROL_BASE: AnchorFacts = {
  id: 'control', mode: 'recovery',
  blocks: [23, 28, 47.5, 4.2, 39.8, 47.3, 28, 43.2, 39.8, 40.1, 44.9, 39.7, 40.5, 37.6, 14, 20.2],
  measuredPeakMi: 47.5, meanMi: 29,
  peakAnchorMi: 47.5, ramp: null, vdotAnchor: 44,
  weeklyMi: [28.5, 38], doctrinePct: [0.60, 0.80],
  // Six runs a week with an 8-mile longest · the grid runs 12 to 48 mi, so both
  // rows sit comfortably inside it and the granularity attribution stays
  // silent. Controls that need it planted override these two fields.
  longestRunMi: [8, 11], runDays: [5, 6],
  blockSays: 'recovery post-race recovery · easy running only · no quality',
  rampCeiling: 1.15, statedPctApplied: null, statedAnchorArm: null,
  dipIsMandated: true, interruptionWeeks: 2, allowedInterruptionWeeks: 4,
};

const CONTROL_FIRED = new Set<string>();
/** Run the checks and remember which fired · every control feeds the coverage
 *  assertion at the bottom of the file. */
const fire = (f: AnchorFacts): string[] => {
  const found = runChecks(f);
  found.forEach((x) => CONTROL_FIRED.add(x.check));
  return found.map((x) => x.check);
};

describe('anchor fit · positive controls', () => {
  it('names the owner\'s 29-against-47', () => {
    // The reported defect exactly: a half-marathon recovery block sized off the
    // 28-day mean (29) instead of the real peak (47.5), so week two came out at
    // 0.80 × 29 ≈ 23 where 0.80 × 47.5 ≈ 38 was owed.
    const bad: AnchorFacts = {
      ...CONTROL_BASE, peakAnchorMi: 29, weeklyMi: [17, 23],
    };
    const found = runChecks(bad);
    const names = found.map((f) => f.check);
    found.forEach((x) => CONTROL_FIRED.add(x.check));
    expect(names, 'the reported defect must be named').toContain('ANCHOR_CIRCULAR');
    const msg = found.find((f) => f.check === 'ANCHOR_CIRCULAR')!.message;
    expect(msg).toContain('the anchor IS the depressed mean');
    // AND — this is the whole reason A1 has to exist — the band check stays
    // SILENT here. 17 and 23 are 0.60 and 0.80 of 29 to the mile: the block is
    // in perfect agreement with its own wrong anchor, which is exactly why the
    // doctrine gate and the shape gate both passed it.
    expect(
      names,
      'a block internally consistent with a wrong anchor must not be catchable by a band check',
    ).not.toContain('VOLUME_OUTSIDE_ANCHOR_BAND');
  });

  it('passes the same runner once the anchor is the real peak', () => {
    expect(fire(CONTROL_BASE)).not.toContain('ANCHOR_CIRCULAR');
  });

  it('names an anchor above anything the runner ever ran', () => {
    const bad = { ...CONTROL_BASE, peakAnchorMi: 70, weeklyMi: [42, 56], doctrinePct: [0.60, 0.80] };
    expect(fire(bad)).toContain('ANCHOR_INFLATED');
  });

  it('names a week that misses doctrine\'s own fraction of the anchor', () => {
    const bad = { ...CONTROL_BASE, weeklyMi: [28.5, 24] };
    expect(fire(bad)).toContain('VOLUME_OUTSIDE_ANCHOR_BAND');
  });

  it('attributes a shortfall to the ramp cap rather than reporting it blind', () => {
    // The marathon reverse taper, as the engine actually authors it on day 1:
    // a 62 mi/wk peak, doctrine's [15%, 35%, 55%, 75%], and the weeks that
    // come out. Each one lands on the previous peak × 1.15 rather than on the
    // row it was supposed to hit.
    // Each week lands exactly on the previous one x 1.15 while the week's SHAPE
    // could comfortably have held its row — five runs with a 9-mile longest
    // reach 37.8 mi against a 21.7 mi row. So the only thing explaining the
    // miss is the compounding cap, which is what this predicate is for.
    const bad: AnchorFacts = {
      ...CONTROL_BASE, measuredPeakMi: 62, peakAnchorMi: 62,
      doctrinePct: [0.15, 0.35, 0.55, 0.75], weeklyMi: [10, 11.5, 13.2, 15.2],
      longestRunMi: [8, 9, 10, 11], runDays: [5, 5, 5, 5],
      blocks: [26, 34, 47, 57, 59, 53, 50, 47, 46, 43, 41, 38, 36, 34, 32, 30],
    };
    const names = fire(bad);
    expect(names).toContain('RAMP_CAP_TRUNCATES_REVERSE_TAPER');
    expect(names).not.toContain('VOLUME_OUTSIDE_ANCHOR_BAND');
    expect(names).not.toContain('RECOVERY_ROW_UNREACHABLE_AT_THIS_VOLUME');
  });

  it('WKRAMP-REC-1 · the same block, sized against the pre-race peak, is in band', () => {
    // What the engine authors after the fix, on the same 62 mi/wk marathoner:
    // 10 · 24 · 35 · 44 against doctrine's 9.3 · 21.7 · 34.1 · 46.5. Every week
    // inside A3's band, and the ramp attribution silent — which is the claim
    // the fix makes, stated where it can fail.
    const fixed: AnchorFacts = {
      ...CONTROL_BASE, measuredPeakMi: 62, peakAnchorMi: 62,
      doctrinePct: [0.15, 0.35, 0.55, 0.75], weeklyMi: [10, 24, 35, 44],
      longestRunMi: [5, 6, 7, 9], runDays: [2, 4, 5, 6],
      blocks: [26, 34, 47, 57, 59, 53, 50, 47, 46, 43, 41, 38, 36, 34, 32, 30],
    };
    const names = runChecks(fixed).map((x) => x.check);
    expect(names).not.toContain('RAMP_CAP_TRUNCATES_REVERSE_TAPER');
    expect(names).not.toContain('VOLUME_OUTSIDE_ANCHOR_BAND');
    expect(names).not.toContain('RECOVERY_EXCEEDS_PRE_RACE_PEAK');
  });

  it('names a recovery block that climbs past the peak it is unwinding', () => {
    // The other side of WKRAMP-REC-1. Research/00b puts the full return to peak
    // at week 5-6, after the block — so a reverse taper that reaches 100% has
    // stopped being a reverse taper, whatever its ceiling says.
    const bad: AnchorFacts = {
      ...CONTROL_BASE, measuredPeakMi: 62, peakAnchorMi: 62,
      doctrinePct: [0.15, 0.35, 0.55, 0.75], weeklyMi: [10, 24, 35, 64],
      longestRunMi: [5, 6, 7, 12], runDays: [2, 4, 5, 6],
      blocks: [26, 34, 47, 57, 59, 53, 50, 47, 46, 43, 41, 38, 36, 34, 32, 30],
    };
    expect(fire(bad)).toContain('RECOVERY_EXCEEDS_PRE_RACE_PEAK');
  });

  it('attributes a low-volume miss to the week\'s own grid, in both directions', () => {
    // The 18 mi/wk beginner running four days. Doctrine asks for 6.3 mi in week
    // 2 and 13.5 in week 4; four runs between the 2-mile junk-run floor and a
    // 3-mile longest can only express 8 to 12. Over early, under late, one
    // cause — and no ramp cap anywhere near it.
    const bad: AnchorFacts = {
      ...CONTROL_BASE, measuredPeakMi: 18, peakAnchorMi: 18, meanMi: 10.2,
      blocks: [7.6, 13.5, 9.9, 9.9, 11.2, 12.6, 11.9, 14.1, 15, 13.3, 15.7, 14.4, 12.6, 11.5, 10.8, 9.9],
      doctrinePct: [0.15, 0.35, 0.55, 0.75], weeklyMi: [4, 8, 8, 9],
      longestRunMi: [2, 2, 2, 3], runDays: [2, 4, 4, 4],
    };
    const names = fire(bad);
    expect(names).toContain('RECOVERY_ROW_UNREACHABLE_AT_THIS_VOLUME');
    expect(names).not.toContain('VOLUME_OUTSIDE_ANCHOR_BAND');
    expect(names).not.toContain('RAMP_CAP_TRUNCATES_REVERSE_TAPER');
    const msg = runChecks(bad).find((f) => f.check === 'RECOVERY_ROW_UNREACHABLE_AT_THIS_VOLUME')!.message;
    // It must name the BRACKET, not just complain about the miss.
    expect(msg).toContain('8.0 mi');
    expect(msg).toContain('junk-run floor');
  });

  it('and names the UNDER direction of the same grid, on the engine\'s own easy-below-long rule', () => {
    // A3 returns on the first offending week, and above that is the OVER
    // direction. Weeks 1-2 in band here so week 4 is what gets graded: 75% of
    // 18 is 13.5, and four runs with a 3-mile long reach 3 x (1 + 0.8 x 3) =
    // 10.2. The bracket has to be the engine's rule and not a looser
    // stand-in — 4 x 3 = 12 would call this reachable, and the same looseness
    // would have hidden the owner's own post-CIM week 4.
    const bad: AnchorFacts = {
      ...CONTROL_BASE, measuredPeakMi: 18, peakAnchorMi: 18, meanMi: 10.2,
      blocks: [7.6, 13.5, 9.9, 9.9, 11.2, 12.6, 11.9, 14.1, 15, 13.3, 15.7, 14.4, 12.6, 11.5, 10.8, 9.9],
      doctrinePct: [0.15, 0.35, 0.55, 0.75], weeklyMi: [2.7, 6.3, 9.9, 9],
      longestRunMi: [2, 2, 3, 3], runDays: [2, 4, 4, 4],
    };
    const names = fire(bad);
    expect(names).toContain('RECOVERY_ROW_UNREACHABLE_AT_THIS_VOLUME');
    expect(names).not.toContain('VOLUME_OUTSIDE_ANCHOR_BAND');
    const msg = runChecks(bad).find((f) => f.check === 'RECOVERY_ROW_UNREACHABLE_AT_THIS_VOLUME')!.message;
    expect(msg).toContain('10.2 mi');
    expect(msg).toContain('3 at 0.8 of it');
  });

  it('names a silent downgrade, and forgives a stated one', () => {
    const silent: AnchorFacts = {
      ...CONTROL_BASE, mode: 'race-prep', peakAnchorMi: null, doctrinePct: [],
      weeklyMi: [12, 12, 12], blockSays: 'base · aerobic development',
    };
    expect(fire(silent)).toContain('SILENT_DOWNGRADE');
    const stated = { ...silent, blockSays: 'recovery · post-race recovery, easy running only' };
    expect(fire(stated)).not.toContain('SILENT_DOWNGRADE');
  });

  it('names a peak that is one freak week', () => {
    const bad: AnchorFacts = {
      ...CONTROL_BASE, mode: 'maintenance', doctrinePct: [],
      blocks: [25, 24, 26, 25, 24, 25, 26, 24, 25, 26, 60, 25, 24, 25, 26, 24],
      measuredPeakMi: 60, peakAnchorMi: 60, meanMi: 25, weeklyMi: [39, 39],
    };
    expect(fire(bad)).toContain('PEAK_IS_AN_OUTLIER');
  });

  it('names a peak the runner has been away from longer than anything explains', () => {
    const bad: AnchorFacts = {
      ...CONTROL_BASE, mode: 'maintenance', doctrinePct: [],
      blocks: [3, 2, 0, 3, 2, 4, 0, 3, 2, 0, 48, 46, 47, 44, 45, 42],
      measuredPeakMi: 48, peakAnchorMi: 48, meanMi: 2, weeklyMi: [31, 31],
      dipIsMandated: false, interruptionWeeks: 10, allowedInterruptionWeeks: 2,
    };
    expect(fire(bad)).toContain('PEAK_IS_STALE');
  });

  it('names a pace anchor left inside an interruption the volume base read through', () => {
    const bad: AnchorFacts = {
      ...CONTROL_BASE, mode: 'race-prep', peakAnchorMi: null, doctrinePct: [],
      vdotAnchor: null,
      ramp: { baseMi: 33.3, meanMi: 16, sustainedMi: 47.5, peakMi: 49, interruptionWeeks: 2, allowedInterruptionWeeks: 4, lifted: true },
      meanMi: 16, weeklyMi: [34, 36, 38],
    };
    expect(fire(bad)).toContain('PACE_ANCHOR_STILL_DEPRESSED');
  });

  it('the helpers the checks lean on answer what they claim to', () => {
    // sustainedOf is rank-3, not the max and not the median.
    expect(sustainedOf([60, 25, 26, 24, 25, 24])).toBe(25);
    expect(currentWeekMi([31, 28, 47])).toBe(31);
    // dailyFromWeekly must round-trip its own weekly totals, or every fixture
    // in this file is measuring something other than what it says.
    const wk = [40, 12, 33.5, 27];
    const d = dailyFromWeekly(wk);
    for (let i = 0; i < wk.length; i++) {
      const sum = d.slice(i * 7, i * 7 + 7).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - wk[i]), `week ${i} round-trip`).toBeLessThanOrEqual(0.2);
    }
    // and the rolling peak must see a week the calendar split in two.
    expect(resolvePeakWeekly([0, 0, 0, 10, 10, 10, 10, 10, 10, 10, 0, 0, 0, 0])).toBe(70);
    // The resume fraction the checks floor on is doctrine's, not a local guess.
    expect(RAMP_BASE_RESUME_FRACTION).toBe(0.70);
    expect(daysBetween('2026-08-16', '2026-08-25')).toBe(9);
  });

  it('names a maintenance block that cuts a runner who never came down', () => {
    const bad: AnchorFacts = {
      ...CONTROL_BASE, mode: 'maintenance', doctrinePct: [],
      blocks: new Array(16).fill(35), measuredPeakMi: 35, meanMi: 35, peakAnchorMi: 35,
      weeklyMi: [24, 24, 24], statedAnchorArm: 'last_cycle_peak', statedPctApplied: 0.75,
      blockSays: 'maintenance holding aerobic fitness · no race in build window.',
    };
    const names = fire(bad);
    expect(names).toContain('MAINTENANCE_CUTS_BELOW_CURRENT_VOLUME');
    // and it must be attributed, not filed as an unexplained silent cut
    expect(names).not.toContain('SILENT_DOWNGRADE');
  });

  it('names an audit record that disagrees with the plan beside it', () => {
    const bad: AnchorFacts = {
      ...CONTROL_BASE, mode: 'maintenance', doctrinePct: [],
      blocks: [0, 3, 4, 5, 6, 8, 45, 44, 42, 45, 43, 40, 41, 38, 36, 34],
      measuredPeakMi: 45, meanMi: 3, peakAnchorMi: 45,
      weeklyMi: [7, 7, 7], statedAnchorArm: 'last_cycle_peak', statedPctApplied: 0.75,
      blockSays: 'maintenance holding aerobic fitness · no race in build window.',
    };
    const names = fire(bad);
    expect(names).toContain('AUDIT_RECORD_DISAGREES_WITH_PLAN');
    const msg = runChecks(bad).find((f) => f.check === 'AUDIT_RECORD_DISAGREES_WITH_PLAN')!.message;
    expect(msg).toContain('33.8');   // 0.75 x 45, beside a block whose biggest week is 7
  });

  it('GUARD 0 · every check this file ships was PROVED able to fire', () => {
    // The failure mode being hunted, one level up: a check whose predicate is
    // broken can never fail, and a gate made of broken checks reports a clean
    // codebase. Each name here was fired by a control above on a fact set
    // built to trip it.
    const missing = EMITTABLE.filter((n) => !CONTROL_FIRED.has(n));
    expect(
      missing,
      'a check with no positive control · it could be permanently broken and this gate ' +
      'would still report clean',
    ).toEqual([]);
    expect(CONTROL_FIRED.size).toBeGreaterThanOrEqual(EMITTABLE.length);
  });
});
