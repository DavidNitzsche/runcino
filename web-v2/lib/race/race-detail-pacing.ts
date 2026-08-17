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

/** 4-block negative-split pacing: first block 0.5%-1% slower (rolling in),
 *  middle blocks ~target pace, last block fastest if downhill, even otherwise. */
export function buildPacing(targetSec: number, distMi: number, netElevFt: number): PacingBlock[] {
  if (!targetSec || !distMi) return [];
  const downhill = netElevFt < -100;
  const blocks = [
    { start: 0,             end: distMi * 0.25, factor: 1.012, color: '#14C08C', sub: 'controlled · ease in' },
    { start: distMi * 0.25, end: distMi * 0.50, factor: 1.0,   color: '#F3AD38', sub: 'settle into rhythm' },
    { start: distMi * 0.50, end: distMi * 0.80, factor: downhill ? 0.998 : 1.0, color: '#D03F3F', sub: 'locked in · work the middle' },
    { start: distMi * 0.80, end: distMi,        factor: downhill ? 0.985 : 0.992, color: '#FC4D64', sub: 'empty the tank' },
  ];
  const out: PacingBlock[] = [];
  let cum = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const seg = b.end - b.start;
    const blockSec = targetSec * (seg / distMi) * b.factor;
    cum += blockSec;
    out.push({
      seg: `Miles ${formatMileRange(b.start, b.end, i === 0)}`,
      sub: b.sub,
      bar: 60 + i * 10,
      barColor: b.color,
      pace: pace(blockSec, seg),
      cum: formatRaceTime(Math.round(cum)) ?? '·',
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

/** Gels at ~70g/hr (40g per gel), one every ~35 min · off the effective
 *  target duration (a projection-paced race runs longer, needs more fuel). */
export function buildGels(targetSec: number, distMi: number): Array<{ mi: string; left: number; caf?: boolean }> {
  if (!targetSec || !distMi) return [];
  const hours = targetSec / 3600;
  const totalGels = Math.max(1, Math.round(hours * 1.7)); // ~every 35 min
  const out: Array<{ mi: string; left: number; caf?: boolean }> = [];
  for (let i = 1; i <= totalGels; i++) {
    const atMi = (i / (totalGels + 1)) * distMi;
    const isCaf = i === Math.max(1, totalGels - 1) || i === totalGels;
    out.push({
      mi: `MI ${atMi.toFixed(1)}${isCaf ? ' · caf' : ''}`,
      left: Math.round((atMi / distMi) * 100),
      caf: isCaf,
    });
  }
  return out;
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
    gels: buildGels(effSec, opts.distanceMi),
  };
}
