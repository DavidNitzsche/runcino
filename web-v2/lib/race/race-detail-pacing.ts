/**
 * lib/race/race-detail-pacing.ts · pure pacing/fueling composition for the
 * web race-detail page (components/faff-app/raceDetail.ts).
 *
 * 2026-08-17 · truth-source fix. The race-detail page derived its goal-pace
 * strip stat, PACING PLAN blocks, 5K splits, and gel schedule from the RAW
 * stated goal while the watch payload (lib/watch/build-workout.ts) and the
 * execution plan (lib/race/execution-plan.ts) already paced off the
 * EFFECTIVE target (lib/race/effective-race-target.ts: goal when within 5%
 * of the projection, else the projection, goal demoted to stretch). A 3:00
 * goal at 3:22 fitness produced 6:52/mi split cards on web next to a watch
 * that would refuse to prescribe them. One resolver, every surface.
 *
 * Also fixes the B·SAFE readback: the page hardcoded B = goal + 7:00 and
 * never read back the runner-edited meta.goalSafeDisplay that PATCH
 * /api/race stores (only the watch read it). Stored value wins; the
 * fallback is effective + 3.3% (the same B-line the GapPanel race-week
 * card uses), not goal + 420s.
 *
 * Pure module — no DB, no cookies — so it is testable from
 * lib/race/_race_detail_pacing.test.ts. The caller resolves the effective
 * target (loadEffectiveRaceTarget) and hands it in.
 */

import { parseRaceTime, formatRaceTime } from '@/lib/training/vdot';
import { buildRacePacing, type CourseGeometryInput } from './pacing';
import { computeRaceFueling, type RaceFuelingInput } from './execution-plan';
import { raceOpeningPlan, openingAdjustmentOverSpan, caffeineStopIndexes } from './distance-doctrine';
import type { EffectiveRaceTarget } from './effective-race-target';

export interface PacingBlock {
  seg: string; sub: string; bar: number; barColor: string; pace: string; cum: string;
}

export interface RaceDetailPacingFields {
  /** The stated A goal display, unchanged (the hero editor shows this). */
  aGoal: string;
  /** What every pacing surface below actually paces off. */
  effectiveGoal: string;
  effectiveSource: 'goal' | 'projection';
  /** The stated goal, kept as the stretch when source === 'projection'. */
  stretchGoal: string | null;
  /** Pace of the effective target (min:sec per mile). */
  goalPace: string;
  /** B · SAFE. Stored meta.goalSafeDisplay wins; else effective + 3.3%. */
  bGoal: string;
  bGoalSource: 'stored' | 'derived';
  pacing: PacingBlock[];
  splits: Array<{ label: string; val: string }>;
  gels: Array<{ mi: string; left: number; caf?: boolean }>;
}

export function pace(totalSec: number, distMi: number): string {
  if (!totalSec || !distMi) return '·';
  const per = totalSec / distMi;
  return `${Math.floor(per / 60)}:${String(Math.round(per % 60)).padStart(2, '0')}`;
}

/**
 * 4-block pacing plan.
 *
 * 2026-08-17 doctrine-conformance audit · the block factors used to be
 * hardcoded (+1.2% opener, −0.8% closer) — a fourth independent opening
 * model, agreeing with none of the other three and with no distance in
 * Research/08 §3.1. Each block now samples THE shared opening model
 * (lib/race/distance-doctrine.ts) across its own span: the distance's
 * allowance over the opening miles, less the repayment after it. A
 * marathon opens ~+1.4% and a 5K ~+0.3%, because that is what the table
 * says.
 *
 * The net-downhill course keeps a small closing credit (Research/08 §18.1
 * :753 — a net-downhill course is run conservative early, which buys the
 * close). Everything is renormalized so the final cumulative lands on the
 * target exactly; the old factors summed to 100.14% and quietly overshot.
 */
export function buildPacing(targetSec: number, distMi: number, netElevFt: number): PacingBlock[] {
  if (!targetSec || !distMi) return [];
  const downhill = netElevFt < -100;
  const opening = raceOpeningPlan({ goalSec: targetSec, distanceMi: distMi });
  const flatPace = targetSec / distMi;
  /** Net-downhill closing credit, fraction of pace. */
  const DOWNHILL_CLOSE_CREDIT = 0.007;

  const spans = [
    { start: 0,             end: distMi * 0.25, color: '#3EBD41', sub: 'controlled · ease in' },
    { start: distMi * 0.25, end: distMi * 0.50, color: '#F3AD38', sub: 'settle into rhythm' },
    { start: distMi * 0.50, end: distMi * 0.80, color: '#D03F3F', sub: 'locked in · work the middle' },
    { start: distMi * 0.80, end: distMi,        color: '#FC4D64', sub: 'empty the tank' },
  ];
  const blocks = spans.map((b, i) => {
    const adj = openingAdjustmentOverSpan(opening, b.start, b.end) / flatPace;
    const credit = downhill && i >= 2 ? DOWNHILL_CLOSE_CREDIT : 0;
    return { ...b, factor: 1 + adj - credit };
  });

  // Renormalize so Σ(blockSec) is exactly the target.
  const rawTotal = blocks.reduce((s, b) => s + targetSec * ((b.end - b.start) / distMi) * b.factor, 0);
  const scale = rawTotal > 0 ? targetSec / rawTotal : 1;

  const out: PacingBlock[] = [];
  let cum = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const seg = b.end - b.start;
    const blockSec = targetSec * (seg / distMi) * b.factor * scale;
    cum += blockSec;
    out.push({
      seg: `Miles ${formatMileRange(b.start, b.end, i === 0)}`,
      sub: b.sub,
      bar: 60 + i * 10,
      barColor: b.color,
      pace: pace(blockSec, seg),
      cum: formatRaceTime(Math.round(i === blocks.length - 1 ? targetSec : cum)) ?? '·',
    });
  }
  return out;
}

function formatMileRange(a: number, b: number, first: boolean): string {
  const round = (v: number) => Number.isInteger(v) ? v.toString() : v.toFixed(1).replace(/\.0$/, '');
  const lo = first ? '1' : round(a);
  return `${lo}–${round(b)}`;
}

/** Course-aware target splits · delegates to lib/race/pacing.ts (grade-
 *  weighted over authored course phases when the library has them). */
export function buildSplits(
  targetSec: number,
  distMi: number,
  geometry?: CourseGeometryInput | null,
): Array<{ label: string; val: string }> {
  if (!targetSec || !distMi) return [];
  return buildRacePacing({ goalSec: targetSec, distanceMi: distMi, geometry: geometry ?? null })
    .splits.map(s => ({ label: s.label, val: s.display }));
}

/**
 * On-course fuel stops for the race-detail page.
 *
 * 2026-08-17 doctrine-conformance audit · this used to be its own gel
 * math — `hours × 1.7` with a floor of one, and caffeine on the last two
 * stops whatever the distance. A 20-minute 5K was therefore prescribed a
 * caffeinated gel, against Research/18 §11 (:369) "5K: 0 g/hr", and the
 * rate it implied (~70 g/hr) was the marathon row on every distance.
 *
 * It now delegates to computeRaceFueling — the one implementation, which
 * reads the distance's §11 row and the runner's own entered product — and
 * flags caffeine off the §11 caffeine plan (5K/10K none, half one
 * mid-race, marathon at miles 13 and 20).
 */
export function buildGels(
  targetSec: number,
  distMi: number,
  fuel?: RaceFuelingInput | null,
): Array<{ mi: string; left: number; caf?: boolean }> {
  if (!targetSec || !distMi) return [];
  const plan = computeRaceFueling({
    goalSec: targetSec,
    distanceMi: distMi,
    goalPaceSPerMi: targetSec / distMi,
    fuel: fuel ?? null,
    isDefault: fuel == null,
  });
  if (plan.scheduleMi.length === 0) return [];

  const caf = caffeineStopIndexes({
    distanceMi: distMi,
    stopsMi: plan.scheduleMi.map((s) => s.mi),
    stopsMin: plan.scheduleMi.map((s) => s.atMin),
  });

  return plan.scheduleMi.map((stop, i) => {
    const isCaf = caf.has(i);
    return {
      mi: `MI ${stop.mi.toFixed(1)}${isCaf ? ' · caf' : ''}`,
      left: Math.round((stop.mi / distMi) * 100),
      caf: isCaf,
    };
  });
}

/** B fallback fraction · matches the GapPanel race-week B-line. */
export const B_SAFE_FRACTION = 0.033;

/** 2026-08-17 · honesty: certification renders ONLY when meta actually
 *  carries one (no more hardcoded "USATF certified" on every A race).
 *  '·' = unknown; RaceView renders nothing for it. */
export function certificationFromMeta(meta: Record<string, unknown> | null | undefined): string {
  const c = (meta as { certification?: unknown } | null | undefined)?.certification;
  return typeof c === 'string' && c.trim() !== '' ? c : '·';
}

/** 2026-08-17 · honesty: registration is unknown (null) unless the runner
 *  actually recorded it — no default-true "Registered" chip. */
export function registeredFromMeta(meta: Record<string, unknown> | null | undefined): boolean | null {
  const r = (meta as { registered?: unknown } | null | undefined)?.registered;
  return typeof r === 'boolean' ? r : null;
}

/**
 * Compose every pacing-derived field on the race-detail seed off the ONE
 * effective target. `effective` is the resolver output for the stated goal
 * (null when the race has no goal — everything degrades to '·'/empty).
 */
export function composeRaceDetailPacing(opts: {
  goalDisplay: string | null;
  effective: EffectiveRaceTarget | null;
  goalSafeDisplay: string | null;
  distanceMi: number;
  netElevFt: number;
  geometry?: CourseGeometryInput | null;
  /** Resolved fuel product (per-race meta → runner default → none), the
   *  same shape the execution plan and the watch resolve. Omitted → the
   *  distance's documented default rate. */
  fuel?: RaceFuelingInput | null;
}): RaceDetailPacingFields {
  const aGoal = opts.goalDisplay || '·';
  const aGoalSec = parseRaceTime(aGoal) ?? 0;
  const effSec = opts.effective?.targetSec ?? aGoalSec;
  const source: 'goal' | 'projection' = opts.effective?.source ?? 'goal';
  const effectiveGoal = effSec > 0 ? (formatRaceTime(effSec) ?? aGoal) : '·';
  const stretchGoal = source === 'projection' && aGoal !== '·' ? aGoal : null;

  // B · SAFE readback. The runner-edited meta.goalSafeDisplay (written by
  // PATCH /api/race) wins; fallback derives from the EFFECTIVE target so a
  // demoted goal doesn't drag a fantasy B down with it.
  const storedBSec = parseRaceTime(opts.goalSafeDisplay);
  const derivedBSec = effSec > 0 ? effSec + Math.round(effSec * B_SAFE_FRACTION) : 0;
  const bSec = storedBSec != null && storedBSec > 0 ? storedBSec : derivedBSec;
  const bGoal = bSec > 0 ? (formatRaceTime(bSec) ?? '·') : '·';

  return {
    aGoal,
    effectiveGoal,
    effectiveSource: source,
    stretchGoal,
    goalPace: pace(effSec, opts.distanceMi),
    bGoal,
    bGoalSource: storedBSec != null && storedBSec > 0 ? 'stored' : 'derived',
    pacing: buildPacing(effSec, opts.distanceMi, opts.netElevFt),
    splits: buildSplits(effSec, opts.distanceMi, opts.geometry ?? null),
    gels: buildGels(effSec, opts.distanceMi, opts.fuel ?? null),
  };
}
