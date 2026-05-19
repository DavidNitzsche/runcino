/**
 * Fitness resolver — SINGLE source of truth for a user's fitness
 * signals at request time. See lib/fitness-types.ts for the bundle
 * shape; this module is server-only because it hits Postgres.
 *
 * Every page, route, and API endpoint that needs paces or HR zones
 * tuned to the runner calls this one function. Workout-descriptions
 * use the resolved bundle to render concrete paces (a 1:30 HM goal
 * gets ~6:52/mi HM-pace workouts, not the legacy hardcoded 7:30-7:50).
 */

import { query } from './db';
import { resolveEffectiveMaxHr } from './compute-max-hr';
import { computeAggregateVdot } from './compute-vdot';
import { pacesFromVdot, vdotFromRace } from './vdot';
import { listRacesDB } from './race-store';
import type {
  ResolvedFitness,
  FitnessActiveRace,
  FitnessVdot,
  FitnessMaxHr,
  FitnessRestingHr,
  FitnessHrZones,
} from './fitness-types';

export type {
  ResolvedFitness,
  FitnessActiveRace,
  FitnessVdot,
  FitnessMaxHr,
  FitnessRestingHr,
  FitnessHrZones,
} from './fitness-types';
export { fmtPaceBand, paceStringFromFitness } from './fitness-types';
export { vdotFromRace };

const DEFAULT_VDOT_BY_LEVEL: Record<string, number> = {
  beginner: 35,
  intermediate: 45,
  advanced: 55,
  elite: 65,
};

function parseGoalHMS(s: string): number {
  const m = s?.trim()?.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(fromISO + 'T00:00:00Z');
  const b = Date.parse(toISO + 'T00:00:00Z');
  return Math.round((b - a) / 86_400_000);
}

async function getUserLevel(userId: string): Promise<string> {
  try {
    const rows = await query<{ level: string }>(
      `SELECT level FROM users WHERE id = $1 LIMIT 1`, [userId],
    );
    return rows[0]?.level ?? 'intermediate';
  } catch { return 'intermediate'; }
}

async function getRestingHr(userId: string): Promise<FitnessRestingHr> {
  try {
    const rows = await query<{ resting_hr: number | null }>(
      `SELECT resting_hr FROM users WHERE id = $1 LIMIT 1`, [userId],
    );
    const stored = rows[0]?.resting_hr ?? null;
    if (stored) return { value: stored, source: 'manual' };
    return { value: null, source: 'none' };
  } catch { return { value: null, source: 'none' }; }
}

/** Pick the user's "active" race — the one currently driving training.
 *  Rule: NEAREST upcoming race, regardless of priority. Training paces
 *  follow what's actually coming up next, not the season's biggest
 *  goal. A B-race in 6 weeks dictates near-term workout pacing; the
 *  A-race in 6 months can wait its turn.
 *
 *  Once the nearest race finishes (date < today), the picker rolls
 *  forward to whatever's next on the calendar.
 *
 *  When two races share a date, A-priority wins the tiebreak. */
async function getActiveRace(today: string, userId?: string): Promise<FitnessActiveRace | null> {
  let races;
  try { races = await listRacesDB(userId); } catch { return null; }
  const priorityRank = (p: 'A' | 'B' | 'C' | undefined): number =>
    p === 'A' ? 0 : p === 'B' ? 1 : 2;
  const candidates = races
    .filter((r) => r.meta.date >= today)
    .sort((a, b) => {
      const dateDiff = a.meta.date.localeCompare(b.meta.date);
      if (dateDiff !== 0) return dateDiff;
      return priorityRank(a.meta.priority) - priorityRank(b.meta.priority);
    });
  const r = candidates[0];
  if (!r) return null;
  const goalFinishS = r.plan?.goal?.finish_time_s ?? parseGoalHMS(r.meta.goalDisplay);
  const distanceMi = r.meta.distanceMi || 13.109;
  const goalPaceSPerMi = goalFinishS > 0 && distanceMi > 0
    ? Math.round(goalFinishS / distanceMi) : 0;
  return {
    slug: r.slug,
    name: r.meta.name,
    date: r.meta.date,
    daysAway: Math.max(0, daysBetween(today, r.meta.date)),
    distanceMi,
    goalDisplay: r.meta.goalDisplay,
    goalFinishS,
    goalPaceSPerMi,
    priority: (r.meta.priority as 'A' | 'B' | 'C') ?? 'C',
  };
}

function buildHrZones(maxHr: number | null): FitnessHrZones | null {
  if (!maxHr || maxHr <= 0) return null;
  const band = (lo: number, hi: number) => ({
    lowBpm: Math.round(maxHr * lo), highBpm: Math.round(maxHr * hi),
  });
  return {
    z1: { ...band(0.50, 0.60), label: 'Recovery'  },
    z2: { ...band(0.60, 0.70), label: 'Easy'      },
    z3: { ...band(0.70, 0.80), label: 'Steady'    },
    z4: { ...band(0.80, 0.90), label: 'Threshold' },
    z5: { ...band(0.90, 1.00), label: 'VO2max'    },
  };
}

async function resolveVdot(userId: string, level: string): Promise<FitnessVdot> {
  const agg = await computeAggregateVdot(userId);
  if (agg && agg.sources.length > 0) {
    const labels = agg.sources.slice(0, 3)
      .map((s) => `${s.canonicalLabel} ${Math.floor(s.finishS / 60)}m`)
      .join(', ');
    return {
      value: agg.value, source: 'aggregate',
      sourceLabel: `Top ${agg.sourceCount} efforts (${agg.windowLabel}): ${labels}`,
      contributors: agg.sources.map((s) => ({
        name: s.canonicalLabel,
        date: s.date,
        distanceMi: s.distanceMi,
        finishS: s.finishS,
        vdot: s.vdot,
        // Enrichment fields from cycle-aware compute-vdot (commit
        // 0052067): surface weight breakdown + provenance so Coach
        // Reads can explain WHY a contributor lands where it does.
        source: s.source,
        weight: s.weight,
        isGoalTier: s.isGoalTier,
        isInCycle: s.isInCycle,
        recency: s.weightBreakdown.recency,
        tierFactor: s.weightBreakdown.tier,
        lengthFactor: s.weightBreakdown.length,
      })),
      goalTier: agg.goalTier,
      cycleStartIso: agg.cycleStartIso,
    };
  }
  const defaultV = DEFAULT_VDOT_BY_LEVEL[level] ?? DEFAULT_VDOT_BY_LEVEL.intermediate;
  return {
    value: defaultV, source: 'level-default',
    sourceLabel: `Default for ${level} runners (no race history yet)`,
    contributors: [],
  };
}

/** Build the race-pace band for training workouts.
 *
 *  Relationship to race-plan phase paces in lib/pacing.ts:
 *    - The center of this band (goalPaceSPerMi) equals lib/pacing.ts's
 *      flatPace = goalFinishS / distanceMi. Identical math.
 *    - On a FLAT race, phase tile paces all equal that center.
 *    - On a HILLY race, pacing.ts modulates by GAF (Grade-Adjusted
 *      Factor) so climbing miles render slower and descents faster,
 *      but the TIME-WEIGHTED AVERAGE still equals goalFinishS. The
 *      race-plan UI shows phase-by-phase paces that can sit OUTSIDE
 *      this ±10s band on individual hills — that's by design, not a
 *      bug. Training workouts say "hold race-pace effort"; the race
 *      plan says "here's how that effort distributes across the
 *      course."
 *    - The ±10s tolerance here matches the default
 *      toleranceSPerMi=10 in the rebuild route, so training and
 *      race-plan tolerance UIs agree on what "on pace" means. */
function buildRacePaceBand(
  activeRace: FitnessActiveRace | null,
  paces: { T: { lowS: number; highS: number } },
): ResolvedFitness['racePaceBand'] {
  if (activeRace && activeRace.goalPaceSPerMi > 0) {
    return {
      lowS: activeRace.goalPaceSPerMi - 10,
      highS: activeRace.goalPaceSPerMi + 10,
      label: `${activeRace.name} goal pace`,
    };
  }
  return { lowS: paces.T.lowS, highS: paces.T.highS, label: 'Threshold (no active race)' };
}

export async function resolveFitness(userId: string, today: string): Promise<ResolvedFitness> {
  const [level, maxHrRaw, restingHr, activeRace] = await Promise.all([
    getUserLevel(userId),
    resolveEffectiveMaxHr(userId),
    getRestingHr(userId),
    getActiveRace(today, userId),
  ]);
  const vdot = await resolveVdot(userId, level);
  const paces = pacesFromVdot(vdot.value) ?? pacesFromVdot(45)!;
  const maxHr: FitnessMaxHr = {
    value: maxHrRaw.value, source: maxHrRaw.source,
    sourceLabel:
      maxHrRaw.source === 'manual' ? 'Manual override'
      : maxHrRaw.source === 'computed' && maxHrRaw.computed
        ? `Peak from ${maxHrRaw.computed.source.name} (${maxHrRaw.computed.source.date})`
        : undefined,
  };
  const hrZones = buildHrZones(maxHr.value);
  const racePaceBand = buildRacePaceBand(activeRace, paces);
  const easyPaceBand = { lowS: paces.E.lowS, highS: paces.E.highS };
  return {
    today, paces, vdot, maxHr, restingHr, hrZones,
    activeRace, racePaceBand, easyPaceBand,
  };
}
