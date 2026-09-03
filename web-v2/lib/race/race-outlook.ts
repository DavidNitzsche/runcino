/**
 * lib/race/race-outlook.ts · THE race-pace brain. One resolver, one object,
 * every projection-shaped consumer reads it (Phase 3 of the P0 coaching-loop
 * order, 2026-09-01).
 *
 * ── THE FOUR QUANTITIES, KEPT APART BY NAME ─────────────────────────────────
 *
 *   statedGoal            what the runner wants. Echoed. Never defines capacity,
 *                         never changes here, never manufactures a pace.
 *   currentProjection     what the evidence says he could race NOW at this
 *                         distance: canonical threshold capacity carried to the
 *                         distance through his own durability exponent
 *                         (`computeCurrentEquivalence`), with a likely range.
 *   trainingPrescription  the race-specific pace to TRAIN at now — for a
 *                         marathon, `anchors.marathonSecPerMi` (threshold
 *                         through the runner's own exponent). It is allowed to
 *                         be slower than race day; the bridge says why.
 *   expectedRaceDay       where this build is expected to land him IF training
 *                         continues: current capacity plus the improvement the
 *                         remaining block can defensibly deliver
 *                         (`projectExpectedGain`, goal-free), converted through
 *                         the same equivalence. A range and a confidence.
 *   execution             what he should actually run on the day. EXECTARGET-1
 *                         (2026-09-03): the CURRENT PROJECTION, not the
 *                         forecast and never the goal. `PROGRESSIVE_BASELINE_
 *                         DOCTRINE.md` Q7 — "the projection-derived value, used
 *                         wherever one current execution number is required...
 *                         3:13:30 must not be labelled the current execution
 *                         target merely because it is the fast edge of a wide
 *                         range." Plus HR guidance resolved on its own evidence
 *                         (`race-hr-guidance.ts`).
 *   conditionalUpside     the forecast's fast edge, carried as an upside with
 *                         its criteria attached rather than as a prescription.
 *   blockSeam             whether the plan actually rehearses the pace this day
 *                         asks for. "Race day cannot ask for a pace the block
 *                         never made credible."
 *
 * The audit that ordered this found NINE distinct CIM numbers live at once,
 * three of them wearing "projects" or "tracking". The rule now: two surfaces
 * asking the same question read the same field of this object; a different
 * number must have a different NAME in this object.
 *
 * ── THE BRIDGE ─────────────────────────────────────────────────────────────
 *
 *   capacity → current projection → training pace → expected improvement →
 *   expected race day → execution target
 *
 * The last step now goes BACK to the current projection rather than forward
 * past the forecast, which is the point: the forecast is what the block is
 * designed to deliver and the execution target is what the evidence carries
 * today. A runner reading the bridge sees both, in that order, with the
 * conditional upside beside them.
 *
 * Every step carries a value, its evidence, a confidence, what would change
 * it, and why it differs from the step before. Adjacent steps are derived
 * from each other by construction, so there is no unexplained jump to gate —
 * the invariant test asserts the arithmetic, not a tolerance.
 *
 * ── WHAT THIS FILE MAY NOT DO ──────────────────────────────────────────────
 *
 * It does not compute fitness (it calls the Runner Model), it does not fit an
 * exponent (it calls Durability), it does not choose a workout, it does not
 * read the goal as evidence of improvement, and it does not clamp the stated
 * goal into anything — the goal is compared, never edited.
 */
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { CANONICAL_ROW_SQL, runDaySql, type RunData } from '@/lib/runs/run-shape';
import { fmtMi, roundTo } from '@/lib/format/run';
import { coherentPace } from '@/lib/runs/coherence';
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';
import { THRESHOLD_ANCHOR_MINUTES, type PrescribedPaceAnchors } from '@/lib/training/prescription-resolver';
import { resolveThresholdCapacity, type ThresholdCapacityEstimate } from '@/lib/training/capacity-resolver';
import { REPRESENTATIVE_STALENESS_HALF_LIFE_DAYS } from '@/lib/training/normal-window';
import { resolveRaceExponent, type RaceExponentRead } from '@/lib/training/durability-anchor';
import {
  computeCurrentEquivalence,
  computeConfidenceInterval,
  resolveExecutionSignal,
  type ConfidenceInterval,
  type CurrentEquivalence,
} from '@/lib/training/goal-projection';
import { projectExpectedGain, type ExpectedGain } from '@/lib/training/fitness-trajectory';
import { predictRaceTime, parseRaceTime } from '@/lib/training/vdot';
import { GOAL_OPTIMISM_TOLERANCE } from '@/lib/training/achievable-target';
import { loadEffectiveMaxHr } from '@/lib/training/max-hr';
import { raceOpeningPlan } from '@/lib/race/distance-doctrine';
import { distanceCategoryOrNull } from '@/lib/race/distance-category';
import { resolveRaceHrGuidance, type RaceHrGuidance, type RaceHrEvidenceRow } from '@/lib/race/race-hr-guidance';
// EXECTARGET-1 · the marathon pace contract names the quantities and owns the
// seam arithmetic; this file supplies the race-side numbers and reads the
// block's authored rehearsal pace. Neither recomputes the other's.
import { marathonSeam, CONDITIONAL_UPSIDE_CRITERIA, type MarathonSeam } from '@/lib/training/marathon-pace-contract';

export const RACE_OUTLOOK_MODEL_VERSION = '1.0.0';

/** The race-day pace band around the execution target, s/mi. The same ±5
 *  `spec-builder.ts`'s race branch has always written (`Research/08` §3:
 *  −5 controlled push, +5 allowance; the first-mile opening is structural). */
export const RACE_EXECUTION_BAND_S_PER_MI = 5;

/**
 * CEFFORT-2 (2026-09-03) · where a controlled C effort sits between the
 * runner's threshold and his marathon anchor.
 *
 * The owner's ruling on the Dodgers 10K: "Pace ~7:30-7:40/mi, or equivalent
 * controlled steady-to-marathon effort... the physiological intent must stay
 * below a true 10K race effort." On his anchors (T 7:10, M 7:52) 0.6 of that
 * span is 7:35, and `RACE_EXECUTION_BAND_S_PER_MI` around it is 7:30-7:40 —
 * his stated band exactly, resolved from his own two anchors rather than
 * pinned to one runner's clock times, so it moves with him.
 *
 * The number is a coaching call, not a research constant, and it is written
 * here as one. What IS doctrine is that the day sits on the marathon side of
 * steady: `Research/00b` §"Recovery by Effort" makes a C race a "hard workout
 * substitute" to be treated "like a hard workout", and this one falls the day
 * before a long run.
 */
export const CONTROLLED_EFFORT_SPAN_SHARE = 0.6;

/** How old the newest capacity evidence may be before the outlook says so.
 *  `REPRESENTATIVE_STALENESS_HALF_LIFE_DAYS` is the half-life the threshold
 *  corpus already discounts support by; one half-life is the point at which
 *  a belief is running on evidence worth half what it was. */
export const RACE_OUTLOOK_STALE_AFTER_DAYS = REPRESENTATIVE_STALENESS_HALF_LIFE_DAYS;

/** Rounding for a runner-facing race target: nearest 10 s over an hour,
 *  nearest 5 s under. A target of 3:14:37 is noise pretending to be precision. */
export function roundRaceTargetSec(sec: number): number {
  const step = sec >= 3600 ? 10 : 5;
  return Math.round(sec / step) * step;
}

export interface RaceForOutlook {
  slug: string;
  name: string;
  distanceMi: number;
  dateISO: string | null;
  priority: 'A' | 'B' | 'C' | null;
  statedGoalSec: number | null;
  isPast: boolean;
}

export type OutlookBasis = 'durability_blend' | 'daniels_equivalence' | 'unavailable';

export interface BridgeStep {
  step: 'current_capacity' | 'current_projection' | 'training_prescription' | 'expected_improvement' | 'expected_race_day' | 'execution_target';
  label: string;
  value: string;
  valueSec: number | null;
  paceSecPerMi: number | null;
  rangeSec: readonly [number, number] | null;
  confidence: number | null;
  evidence: string[];
  changeTrigger: string;
  differsFromPrevious: string | null;
}

export interface RaceOutlook {
  modelVersion: string;
  resolvedAt: string;
  todayISO: string;
  race: RaceForOutlook & { daysToRace: number | null; weeksToRace: number | null };
  statedGoal: { sec: number | null; paceSecPerMi: number | null };
  capacity: {
    thresholdSecPerMi: number;
    thresholdVdot: number | null;
    sourceMode: ThresholdCapacityEstimate['sourceMode'];
    confidence: number;
    evidenceIds: string[];
    newestEvidenceISO: string | null;
    durabilityExponent: number | null;
    durabilityRawExponent: number | null;
    durabilityConfidence: number | null;
    durabilityRaces: number;
    personallyEvidenced: boolean;
  };
  currentProjection: {
    expectedSec: number | null;
    likelyRangeSec: readonly [number, number] | null;
    confidence: number | null;
    confidenceInterval: ConfidenceInterval | null;
    basis: OutlookBasis;
    danielsSec: number | null;
    durabilitySec: number | null;
    durabilityWeight: number | null;
    specificityAdjustmentPct: number | null;
    primaryLimiter: 'endurance' | 'threshold' | 'speed_reserve' | 'unknown';
    reasons: string[];
  };
  trainingPrescription: {
    kind: 'marathon_specific' | 'race_specific';
    paceSecPerMi: number;
    /** 2026-09-02 · the honest band (fast → slow) from `anchors.marathonRangeSecPerMi`. */
    rangeSecPerMi: readonly [number, number] | null;
    /** 'rehearsal' when a demonstrated marathon-effort pace set the number. */
    evidence: 'exponent' | 'rehearsal' | 'equivalence';
    demonstratedPaceSecPerMi: number | null;
    restsOnOneLongRace: boolean;
    source: 'canonical_anchors';
    enduranceExponent: number | null;
    personallyEvidenced: boolean;
    thresholdSecPerMi: number;
    whyThisPace: string;
  };
  expectedImprovement: ExpectedGain & { confidence: number };
  expectedRaceDay: {
    expectedSec: number | null;
    likelyRangeSec: readonly [number, number] | null;
    confidence: number | null;
    projectedVdot: number | null;
    basis: 'trajectory' | 'current_projection' | 'unavailable';
    reasons: string[];
  };
  execution: {
    targetSec: number | null;
    paceSecPerMi: number | null;
    paceBandSecPerMi: readonly [number, number] | null;
    /**
     * EXECTARGET-1 (2026-09-03) · `stated_goal_within_range` and
     * `stated_goal_clamped_to_range_edge` are REMOVED, not defaulted off. Both
     * were the stated goal reaching the prescription, and `PROGRESSIVE_BASELINE
     * _DOCTRINE.md` Q7 rules that the active number is the projection-derived
     * one. `expected_race_day` goes with them: the block's forecast is a
     * forecast and lives in `expectedRaceDay`, and its fast edge lives in
     * `conditionalUpside` with its criteria attached.
     */
    source: 'current_evidence' | 'controlled_c_effort' | 'unavailable';
    /**
     * CEFFORT-1 (2026-09-02) · WHAT KIND OF DAY THIS IS, and the field the
     * rest of the object is priced from.
     *
     * `race.priority` was loaded by this resolver and read NOWHERE inside it,
     * so a C race was priced exactly like an A race and the only restraint on
     * the owner's Dodgers 10K was that he happened to have typed a soft goal.
     * Change the goal to 43:00 and the engine prescribed an all-out 10K the
     * day before an 18-mile long run. Restraint that depends on the runner
     * typing a convenient number is not restraint.
     *
     * `Research/00b` §"Recovery by Effort" is the row that separates them: an
     * A race is "Maximum, full taper, peak day"; a C race is "Strong effort,
     * no taper", a "hard workout substitute", to be treated "like a hard
     * workout". A hard workout is not run to an aspiration and is not run to
     * a peak-day projection, because it gets neither the taper nor the day.
     */
    effortCharacter: 'race' | 'controlled_c_effort';
    strategyLabel: string | null;
    reasonVsExpected: string;
    hr: RaceHrGuidance | null;
  };
  /**
   * EXECTARGET-1 (2026-09-03) · Q7's fourth layer · A FASTER OUTCOME THAT IS
   * NOT THE PRESCRIPTION.
   *
   * The fast edge of `expectedRaceDay.likelyRangeSec` — the number that used to
   * BE the execution target because a fast goal pulled it there — carried as
   * what it actually is: available if the block earns it, with the criteria
   * stated rather than implied.
   *
   * Nothing evaluates the criteria and promotes it. `PLAN_SIMPLIFICATION_
   * DOCTRINE.md` has adaptation disabled, and a conditional that quietly
   * promoted itself would be exactly the automatic mutation doctrine removed.
   * Null when there is no forecast, or when the forecast is not faster than
   * today's evidence — an "upside" that is not an upside is refused, not
   * renamed (Rule 11).
   */
  conditionalUpside: {
    targetSec: number;
    paceSecPerMi: number | null;
    criteria: readonly string[];
    confidence: number | null;
  } | null;
  /**
   * EXECTARGET-1 · THE SEAM · does the block make this target credible?
   *
   * The owner's standard, verbatim: "Race day cannot ask for a pace the block
   * never made credible." Resolved against the marathon-effort pace the plan
   * ACTUALLY authored, read from `training_plans.authored_state`, so a dose
   * the dosing caps or the intensity floor shaved away cannot be counted as a
   * rehearsal that happened.
   *
   * Null when there is no active plan to read, which is a different fact from a
   * plan that rehearses nothing (Rule 11) — `marathonSeam` says which.
   */
  blockSeam: MarathonSeam | null;
  goalFeasibility: {
    status: 'no_goal' | 'comfortable' | 'realistic' | 'aggressive' | 'unlikely_currently' | 'unavailable';
    gapSec: number | null;
    gapToRangeEdgeSec: number | null;
    reasons: string[];
  };
  /**
   * ROW-CONTRACT-1 (2026-09-02) · REMOVED, AND THE REMOVAL IS THE FIX.
   *
   * This produced an A/B/C ladder from `expectedRaceDay.likelyRangeSec`, and
   * `lib/race/coach-goal.ts` produced ANOTHER one from the same range plus the
   * course's hill cost. The phone's race detail draws coach-goal's under the
   * words COACH SET while `outlookRow("Run the day at", …)` on the same screen
   * draws `execution.targetSec` from here. On Santa Monica, 2026-09-02, they
   * were 40 seconds apart on the A time.
   *
   * Nothing read this one. Not a route, not a component, not a Swift view — it
   * reached the phone as `coach_set` in the payload and was decoded by no
   * model. Rule 16 says one quantity has one name; the Constitution says
   * prefer deletion before addition. `coach-goal.ts` is the owner.
   */
  coachSet?: never;
  /**
   * 2026-09-02 · HOW OLD IS THIS. Rule 23's discipline pointed at a belief
   * rather than a job: an outlook resolved from evidence nobody has added to
   * in a month is not wrong, but a runner reading a race target deserves to
   * know it is running on old evidence rather than on this week's work.
   * `stale` is reported, never acted on — nothing downstream refuses because
   * of it (a stale belief and no belief are different facts, Rule 11).
   */
  staleness: {
    newestEvidenceISO: string | null;
    evidenceAgeDays: number | null;
    stale: boolean;
    staleAfterDays: number;
  };
  bridge: BridgeStep[];
  changeTriggers: string[];
  flags: string[];
}

/** The exponent carry the rehearsal beat — the slow edge of the band. */
function carryPaceForWhy(anchors: PrescribedPaceAnchors): number {
  return anchors.marathonRangeSecPerMi?.[1] ?? anchors.marathonSecPerMi;
}

function fmtTime(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return 'not yet';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
function fmtPace(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return 'not yet';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/mi`;
}

/** Load one race row into the shape the outlook needs. Null when absent. */
export async function loadRaceForOutlook(userUuid: string, slug: string, todayISO: string): Promise<RaceForOutlook | null> {
  const row = (await pool.query<{ slug: string; meta: Record<string, unknown> | null; plan: Record<string, unknown> | null }>(
    `SELECT slug, meta, plan FROM races WHERE user_uuid = $1::uuid AND slug = $2 LIMIT 1`,
    [userUuid, slug],
  )).rows[0];
  if (!row) return null;
  const meta = row.meta ?? {};
  const distanceMi = Number(meta.distanceMi) || 0;
  const dateISO = typeof meta.date === 'string' ? meta.date.slice(0, 10) : null;
  const goalSec = parseRaceTime(typeof meta.goalDisplay === 'string' ? meta.goalDisplay : null)
    ?? (typeof (row.plan as { goal?: { finish_time_s?: number } } | null)?.goal?.finish_time_s === 'number'
      ? Number((row.plan as { goal?: { finish_time_s?: number } }).goal!.finish_time_s) : null);
  const pr = typeof meta.priority === 'string' ? meta.priority.toUpperCase() : null;
  return {
    slug: row.slug,
    name: typeof meta.name === 'string' ? meta.name : row.slug,
    distanceMi,
    dateISO,
    priority: pr === 'A' || pr === 'B' || pr === 'C' ? pr : null,
    statedGoalSec: goalSec,
    isPast: dateISO != null && dateISO < todayISO,
  };
}

/** The runner's own sustained efforts near race intensity — the evidence the
 *  HR band is validated against. Population named: this user, canonical rows.
 *  Pace is read through `lib/runs/coherence` so a row cannot answer the
 *  clock question two ways. */
async function loadRaceHrEvidence(userUuid: string, todayISO: string): Promise<RaceHrEvidenceRow[]> {
  const rows = (await pool.query<{ id: string; data: RunData }>(
    `SELECT r.id::text AS id, r.data
       FROM runs r
      WHERE r.user_uuid = $1::uuid
        AND ${CANONICAL_ROW_SQL}
        AND ${runDaySql('r')} >= ($2::date - INTERVAL '180 days')::text`,
    [userUuid, todayISO],
  )).rows;
  const out: RaceHrEvidenceRow[] = [];
  for (const r of rows) {
    const d = r.data ?? ({} as RunData);
    const distanceMi = Number(d.distanceMi);
    const avgHr = Number(d.avgHr);
    const pace = coherentPace(d);
    if (!(distanceMi >= 8) || !(avgHr > 0) || pace == null) continue;
    const dateISO = typeof d.date === 'string' ? d.date.slice(0, 10) : typeof d.startLocal === 'string' ? d.startLocal.slice(0, 10) : null;
    if (!dateISO) continue;
    const wt = typeof d.workoutType === 'string' ? d.workoutType : null;
    out.push({
      id: r.id,
      dateISO,
      distanceMi,
      paceSecPerMi: pace.secPerMi,
      avgHr,
      kind: wt === 'race' ? 'race' : wt === 'long' ? 'long' : 'other',
    });
  }
  return out;
}

/**
 * Everything the outlook reads, gathered in one place so the composition
 * below is PURE and the contract test can drive it without a database.
 * Each field names the canonical owner it came from.
 */
export interface RaceOutlookReads {
  /** Pace Prescription · the six canonical anchors, or the refusal. */
  anchorRead: Awaited<ReturnType<typeof resolvePrescribedPaceAnchors>>;
  /** Runner Model · threshold capacity with its evidence contract. */
  threshold: ThresholdCapacityEstimate;
  /** Durability · the personal endurance exponent read. */
  durabilityRead: RaceExponentRead;
  /** Race Prediction · equivalence at this distance for a VDOT. */
  equivalenceAt: (vdot: number | null) => Promise<CurrentEquivalence | null>;
  /** Adaptation evidence · how the block is being executed. */
  executionSignal: Awaited<ReturnType<typeof resolveExecutionSignal>> | null;
  lthrBpm: number | null;
  maxHrBpm: number | null;
  /** The runner's own sustained efforts near race intensity (HR evidence). */
  hrEfforts: RaceHrEvidenceRow[];
  /**
   * EXECTARGET-1 · the LAST marathon-effort pace the active plan actually
   * authored, from `authored_state.marathon_specific_ladder`. Null when there
   * is no active plan, or when the plan predates the ladder — which is a
   * different fact from a plan that rehearses nothing, and `marathonSeam`
   * reports it as one (Rule 11).
   *
   * Read here rather than computed, because `lib/plan/marathon-specific-ladder`
   * owns the sequence and this module may not answer that question a second
   * time (Rule 16).
   */
  plannedLastRehearsalPaceSecPerMi: number | null;
}

/**
 * The block's last authored marathon-effort pace, from the ACTIVE plan.
 *
 * Rule 14 · the population is named: this user, the one plan that is not
 * archived. `clearActivePlansFor` archives rather than deletes, so a join on
 * `user_uuid` alone reads every version this runner has ever had.
 */
async function loadPlannedLastRehearsalPace(userUuid: string): Promise<number | null> {
  const row = (await pool.query<{ authored_state: Record<string, unknown> | null }>(
    `SELECT authored_state FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userUuid],
  )).rows[0];
  const ladder = (row?.authored_state ?? {})['marathon_specific_ladder'] as
    { last_rehearsal_pace_s_per_mi?: unknown } | null | undefined;
  const v = ladder?.last_rehearsal_pace_s_per_mi;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

export async function loadRaceOutlookReads(
  userUuid: string,
  race: RaceForOutlook,
  today: string,
): Promise<RaceOutlookReads> {
  const [anchorRead, threshold, durabilityRead, maxHr, lthrBpm, hrEfforts, plannedLastRehearsalPaceSecPerMi] = await Promise.all([
    resolvePrescribedPaceAnchors(userUuid, today),
    resolveThresholdCapacity(userUuid, today),
    resolveRaceExponent(userUuid).catch((): RaceExponentRead => ({ ok: false, reason: 'no_races', races: 0 })),
    loadEffectiveMaxHr(userUuid, today).catch(() => ({ bpm: null as number | null })),
    loadLthr(userUuid),
    loadRaceHrEvidence(userUuid, today),
    loadPlannedLastRehearsalPace(userUuid),
  ]);
  const thresholdSecPerMi = anchorRead.ok ? anchorRead.anchors.thresholdSecPerMi : threshold.paceSecPerMi;
  const anchorDistanceMi = thresholdSecPerMi > 0 ? (THRESHOLD_ANCHOR_MINUTES * 60) / thresholdSecPerMi : null;
  const thresholdVdot = anchorRead.ok ? anchorRead.anchors.basis.threshold.vdot : threshold.vdot;
  // resolveExecutionSignal degrades each of its reads by name; a throw here
  // is a failure the caller must see, not a null that reads as "no signal".
  const executionSignal = await resolveExecutionSignal(userUuid, thresholdVdot);
  return {
    anchorRead,
    threshold,
    durabilityRead,
    equivalenceAt: async (vdot) => (race.distanceMi > 0 && vdot != null
      ? computeCurrentEquivalence({
          userUuid, raceDistanceMi: race.distanceMi, vdot, vdotAnchorDistanceMi: anchorDistanceMi, durabilityRead,
        })
      : null),
    executionSignal,
    lthrBpm,
    maxHrBpm: maxHr.bpm,
    hrEfforts,
    plannedLastRehearsalPaceSecPerMi,
  };
}

/**
 * THE resolver. Loads the reads, then composes. Every number a consumer
 * prints comes off the returned object by name.
 */
export async function resolveRaceOutlook(
  userUuid: string,
  race: RaceForOutlook,
  todayISO?: string,
): Promise<RaceOutlook> {
  const today = todayISO ?? await runnerToday(userUuid);
  const reads = await loadRaceOutlookReads(userUuid, race, today);
  return composeRaceOutlook(race, today, reads);
}

/** The pure composition. No I/O: everything it needs is in `reads`. */
export async function composeRaceOutlook(
  race: RaceForOutlook,
  today: string,
  reads: RaceOutlookReads,
): Promise<RaceOutlook> {
  const { anchorRead, threshold, durabilityRead } = reads;
  const resolvedAt = new Date().toISOString();
  const daysToRace = race.dateISO
    ? Math.round((Date.parse(race.dateISO + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86_400_000)
    : null;
  const weeksToRace = daysToRace != null ? Math.max(0, daysToRace) / 7 : null;
  const flags: string[] = [];
  if (!anchorRead.ok) flags.push(`PACE_ANCHORS_REFUSED:${anchorRead.reason}`);
  const anchors: PrescribedPaceAnchors | null = anchorRead.ok ? anchorRead.anchors : null;

  // ── 1 · capacity, from the Runner Model ─────────────────────────────────
  const thresholdSecPerMi = anchors?.thresholdSecPerMi ?? threshold.paceSecPerMi;
  const thresholdVdot = anchors?.basis.threshold.vdot ?? threshold.vdot;
  const newestEvidenceISO = threshold.evidence?.supporting.reduce<string | null>(
    (m, o) => (m == null || o.date > m ? o.date : m), null,
  ) ?? null;
  const capacity: RaceOutlook['capacity'] = {
    thresholdSecPerMi,
    thresholdVdot,
    sourceMode: threshold.sourceMode,
    confidence: threshold.confidence,
    evidenceIds: threshold.evidenceIds,
    newestEvidenceISO,
    durabilityExponent: durabilityRead.ok ? durabilityRead.value : null,
    durabilityRawExponent: durabilityRead.ok ? durabilityRead.rawFittedExponent ?? null : null,
    durabilityConfidence: durabilityRead.ok ? durabilityRead.confidence : null,
    durabilityRaces: durabilityRead.races,
    personallyEvidenced: anchors?.basis.marathon.personallyEvidenced ?? durabilityRead.ok,
  };

  // ── 2 · current projection at this distance (Race Prediction §J) ────────
  // The VDOT is the CANONICAL threshold capacity's — Race Prediction consumes
  // the Runner Model, not a second fitness read off a snapshot table.
  const anchorDistanceMi = thresholdSecPerMi > 0 ? (THRESHOLD_ANCHOR_MINUTES * 60) / thresholdSecPerMi : null;
  const eq = await reads.equivalenceAt(thresholdVdot);
  const ci = eq?.expectedSec != null
    ? computeConfidenceInterval({
        centerSec: eq.expectedSec, raceDistanceMi: race.distanceMi, status: 'on-track',
        vdotAnchorDateISO: newestEvidenceISO, vdotAnchorDistanceMi: anchorDistanceMi,
        marathonSpecificTraining: eq.marathonSpecificTraining,
      })
    : null;
  const primaryLimiter: RaceOutlook['currentProjection']['primaryLimiter'] = !durabilityRead.ok
    ? 'unknown'
    : (durabilityRead.rawFittedExponent ?? durabilityRead.value) > 1.08 ? 'endurance'
    : (durabilityRead.rawFittedExponent ?? durabilityRead.value) < 1.06 ? 'speed_reserve'
    : 'threshold';
  const currentBasis: OutlookBasis = eq?.expectedSec == null ? 'unavailable' : eq.durabilityBlend ? 'durability_blend' : 'daniels_equivalence';
  const currentProjection: RaceOutlook['currentProjection'] = {
    expectedSec: eq?.expectedSec ?? null,
    likelyRangeSec: ci ? [ci.lo, ci.hi] : null,
    confidence: eq?.expectedSec != null ? Math.min(threshold.confidence, durabilityRead.ok ? Math.max(durabilityRead.confidence, 0.3) : 0.5) : null,
    confidenceInterval: ci,
    basis: currentBasis,
    danielsSec: eq?.danielsSec ?? null,
    durabilitySec: eq?.durabilityProjectionSec ?? null,
    durabilityWeight: eq?.durabilityBlend?.weight ?? null,
    specificityAdjustmentPct: eq?.specificityAdjustment?.pct ?? null,
    primaryLimiter,
    reasons: [
      `threshold ${threshold.sourceMode} · confidence ${threshold.confidence.toFixed(2)}`,
      durabilityRead.ok
        ? `personal exponent ${durabilityRead.value.toFixed(3)} from ${durabilityRead.races} races · weight ${(eq?.durabilityBlend?.weight ?? 0).toFixed(2)}`
        : 'no personal exponent · Daniels equivalence only',
      ...(eq?.specificityAdjustment ? [`marathon specificity +${eq.specificityAdjustment.pct}% (no marathon block on file)`] : []),
    ],
  };

  // ── 3 · the race-specific TRAINING prescription (Pace Prescription §G) ──
  const cat = distanceCategoryOrNull(race.distanceMi);
  const marathonLike = cat === 'm' || cat === 'ultra';
  const trainingPace = marathonLike
    ? (anchors?.marathonSecPerMi ?? (eq?.expectedSec != null ? eq.expectedSec / race.distanceMi : thresholdSecPerMi))
    : (eq?.expectedSec != null ? eq.expectedSec / race.distanceMi : thresholdSecPerMi);
  const trainingPrescription: RaceOutlook['trainingPrescription'] = {
    kind: marathonLike ? 'marathon_specific' : 'race_specific',
    paceSecPerMi: Math.round(trainingPace),
    rangeSecPerMi: marathonLike && anchors ? anchors.marathonRangeSecPerMi ?? null : null,
    evidence: marathonLike && anchors ? anchors.basis.marathon.source ?? 'exponent' : 'equivalence',
    demonstratedPaceSecPerMi: marathonLike && anchors ? anchors.basis.marathon.demonstratedPaceSecPerMi ?? null : null,
    restsOnOneLongRace: marathonLike && anchors ? anchors.basis.marathon.restsOnOneLongRace ?? false : false,
    source: 'canonical_anchors',
    enduranceExponent: anchors?.basis.marathon.enduranceExponent ?? null,
    personallyEvidenced: anchors?.basis.marathon.personallyEvidenced ?? false,
    thresholdSecPerMi,
    whyThisPace: marathonLike
      ? (anchors?.basis.marathon.source === 'rehearsal'
          ? `Held at marathon effort in your rehearsals (${fmtPace(anchors.basis.marathon.demonstratedPaceSecPerMi ?? trainingPace)}), which beats the ${fmtPace(carryPaceForWhy(anchors))} your race history alone would give. A pace you have held is yours.`
          : `Threshold ${fmtPace(thresholdSecPerMi)} carried to ${fmtMi(race.distanceMi) ?? 'the race distance'} through your own endurance exponent${anchors ? ` (${anchors.basis.marathon.enduranceExponent.toFixed(3)})` : ''}${anchors?.basis.marathon.restsOnOneLongRace ? ', which rests on one marathon so far' : ''}. This is today's capacity, not race day's; the rehearsal teaches the effort, the block earns the pace.`)
      : `Today's projected race pace at ${fmtMi(race.distanceMi) ?? 'the race distance'} from current capacity.`,
  };

  // ── 4 · expected improvement (goal-free) ────────────────────────────────
  const signal = reads.executionSignal;
  const gain = projectExpectedGain({
    raceDistanceMi: race.distanceMi,
    weeksToRace: weeksToRace ?? 0,
    executionQuality: signal?.executionQuality ?? null,
    overPerformanceBonusVdot: signal?.overPerformanceBonusVdot ?? 0,
    responseFactor: null,
  });
  const gainEvidenceCount = signal?.recentTestPoints.length ?? 0;
  const expectedImprovement: RaceOutlook['expectedImprovement'] = {
    ...gain,
    confidence: Math.min(1, 0.35 + 0.15 * Math.min(3, gainEvidenceCount)) * (gain.basis === 'no_runway' ? 1 : 0.9),
  };

  // ── 5 · expected race day = equivalence at (current + gain) ─────────────
  const at = async (v: number | null): Promise<number | null> => {
    if (v == null || race.distanceMi <= 0) return null;
    const e = await reads.equivalenceAt(v);
    return e?.expectedSec ?? null;
  };
  const projectedVdot = thresholdVdot != null ? thresholdVdot + gain.gainVdot : null;
  const [expectedSec, fastSec, slowSec] = await Promise.all([
    at(projectedVdot),
    at(thresholdVdot != null ? thresholdVdot + gain.gainRangeVdot[1] : null),
    at(thresholdVdot != null ? thresholdVdot + gain.gainRangeVdot[0] : null),
  ]);
  const ciHalf = ci ? Math.round((ci.hi - ci.lo) / 2) : 0;
  const likelyRangeSec: readonly [number, number] | null =
    expectedSec != null && fastSec != null && slowSec != null
      ? [Math.min(fastSec, expectedSec) - ciHalf, Math.max(slowSec, expectedSec) + ciHalf]
      : null;
  const expectedRaceDay: RaceOutlook['expectedRaceDay'] = {
    expectedSec,
    likelyRangeSec,
    confidence: expectedSec != null && currentProjection.confidence != null
      ? roundTo(currentProjection.confidence * expectedImprovement.confidence, 2)
      : null,
    projectedVdot: projectedVdot != null ? roundTo(projectedVdot, 1) : null,
    basis: expectedSec == null ? 'unavailable' : gain.basis === 'no_runway' ? 'current_projection' : 'trajectory',
    reasons: [
      `${roundTo(gain.gainVdot, 2)} VDOT expected from ${gain.buildWeeks} build weeks at execution ${gain.executionQuality}`,
      ...gain.reasons,
    ],
  };

  // ── 6 · execution: the stated goal may pull the target no further than the
  //        likely range's fast edge. Never past it. ────────────────────────
  const goalSec = race.statedGoalSec;
  let targetSec: number | null = null;
  let source: RaceOutlook['execution']['source'] = 'unavailable';
  let reasonVsExpected = 'No projection could be resolved; nothing honest to run to.';

  /* ── CEFFORT-1 (2026-09-02) · A C RACE IS PRICED AS A CONTROLLED EFFORT ──
   *
   * `Research/00b` §"Recovery by Effort" · "C race / hard workout substitute |
   * Strong effort, no taper | treat like a hard workout", against the A row's
   * "Maximum, full taper, peak day". `Research/22` §"Multi-Race Year Planning"
   * puts the C race in a training week as the week's quality session.
   *
   * TWO THINGS FOLLOW, and only the second is new arithmetic.
   *
   * 1 · THE STATED GOAL MAY NOT PULL A C RACE FASTER. On an A or B race the
   *     goal pulls the target as far as the likely range's fast edge, which is
   *     right for a race the runner is peaking for. On a hard workout it is
   *     the defect: the number the runner typed becomes the intensity the
   *     engine prescribes. A goal that is SLOWER is still honoured — asking
   *     for less of a training race is a decision he is allowed to make.
   *
   * 2 · THE CEILING IS THE SLOWER OF TWO NUMBERS THE FILE ALREADY HAS:
   *       · `currentProjection.expectedSec` — what the evidence says he could
   *         race NOW. A race with no taper and no peak day may not be run to
   *         `expectedRaceDay`, which prices a taper and a block of improvement
   *         he has not banked yet.
   *       · the THRESHOLD carry — `capacity.thresholdSecPerMi` over the
   *         distance. `Research/04` §pace-zone table puts 10K race pace "Just
   *         above T" and calls T "~1-hour race pace", which is doctrine's own
   *         description of a strong controlled effort. For a race shorter than
   *         the threshold anchor this is the slower of the two and it binds;
   *         for a longer one the current projection is slower and IT binds.
   *
   *     `Math.max` in SECONDS is the slower of the two, is continuous and
   *     monotone in both inputs, and spends the band once (Rule 9 · "a band
   *     has ONE edge"). No new constant is introduced.
   *
   * WHAT THIS DELIBERATELY DOES NOT DO. It does not edit the stated goal
   * (`goalFeasibility` below still compares against the runner's own number,
   * untouched), and it does not change `currentProjection` or
   * `expectedRaceDay` — a C race still measures the runner's fitness honestly;
   * what changes is only what he is told to RUN on the day.
   */
  const isControlledCEffort = race.priority === 'C';
  if (isControlledCEffort) {
    // Branched, not a ternary collapsing "no distance" into "no carry"
    // (Rule 11, and `_coercion_scan` watches for exactly that shape). A
    // distance we do not have cannot carry a threshold pace; the current
    // projection stands alone there, and a null IT gives is a refusal that
    // leaves `targetSec` null rather than a zero anybody could spend.
    const currentSec = currentProjection.expectedSec;
    let ceilingSec: number | null;
    if (thresholdSecPerMi > 0 && race.distanceMi > 0) {
      /* ── CEFFORT-2 (2026-09-03) · THRESHOLD IS NOT "CONTROLLED" ────────────
       *
       * CEFFORT-1's ceiling was the THRESHOLD carry, and on the owner's Dodgers
       * 10K that priced the day at 45:00 · 7:15/mi against a 7:10/mi threshold.
       * The owner, ruling on it:
       *
       *   "That is effectively a sustained threshold effort, not an obviously
       *    restrained race, and is too hard to describe as controlled before a
       *    17-mile long run."
       *
       * Meanwhile the authored rationale for that same day says "Dodgers is
       * prescribed as a controlled effort, not a race". The sentence and the
       * number disagreed, and Rule 16 says a sentence asserting a fact about a
       * measurement is gated on that measurement — so the NUMBER moves.
       *
       * His prescription: "Pace ~7:30-7:40/mi, or equivalent controlled
       * steady-to-marathon effort... the physiological intent must stay below a
       * true 10K race effort."
       *
       * THE BAND, IN OWNED QUANTITIES RATHER THAN CLOCK TIMES. A controlled
       * effort sits between the runner's marathon anchor and his threshold —
       * the span doctrine calls steady — and it is taken at the marathon side
       * of that span's middle. On this runner (T 7:10, M 7:52) that is 7:31 to
       * 7:41, which is his stated band, resolved from his own anchors so it
       * moves with him instead of being pinned to one runner's clock.
       *
       * `Research/00b` §"Recovery by Effort" is the doctrine underneath: a C
       * race is "Strong effort, no taper", a "hard workout substitute", to be
       * treated "like a hard workout". A hard workout for a marathoner in this
       * phase is marathon-to-steady effort, not a threshold time trial, and it
       * is the day BEFORE a long run here.
       *
       * Falls back to the old threshold carry when there is no marathon anchor
       * — a refusal to invent a band rather than a silently narrower one.
       */
      const thresholdCarrySec = thresholdSecPerMi * race.distanceMi;
      const marathonAnchorSecPerMi = anchors?.marathonSecPerMi ?? null;
      const controlledSecPerMi = marathonAnchorSecPerMi != null && marathonAnchorSecPerMi > thresholdSecPerMi
        ? thresholdSecPerMi + (marathonAnchorSecPerMi - thresholdSecPerMi) * CONTROLLED_EFFORT_SPAN_SHARE
        : null;
      const controlledCarrySec = controlledSecPerMi != null ? controlledSecPerMi * race.distanceMi : null;
      // The slower of what he could race today and what a controlled effort
      // costs. `Math.max` in SECONDS, continuous and monotone in both inputs.
      const restraintSec = controlledCarrySec ?? thresholdCarrySec;
      ceilingSec = currentSec != null ? Math.max(restraintSec, currentSec) : restraintSec;
    } else {
      ceilingSec = currentSec;
    }
    if (ceilingSec != null) {
      // A slower stated goal is honoured; a faster one is echoed and not run to.
      targetSec = roundRaceTargetSec(goalSec != null ? Math.max(ceilingSec, goalSec) : ceilingSec);
      source = 'controlled_c_effort';
      reasonVsExpected = goalSec != null && goalSec < ceilingSec
        ? `C race. Run it as the week's hard session, not as a race. Your ${fmtTime(goalSec)} goal stays yours; ${fmtTime(targetSec)} is what this day is for.`
        : 'C race. Run it as the week\u2019s hard session, controlled, and take the day\u2019s work rather than the result.';
    }
  } else if (currentProjection.expectedSec != null) {
    /* ── EXECTARGET-1 (2026-09-03) · THE ACTIVE NUMBER IS THE CURRENT-EVIDENCE
     *    ONE, AND THE GOAL'S PULL IS REMOVED. ─────────────────────────────────
     *
     * `docs/PROGRESSIVE_BASELINE_DOCTRINE.md` Q7, locked 2026-09-03:
     *
     *   | Aspirational goal              3:00            never used as capacity
     *   | Active current-evidence target ~3:24 · 7:47/mi  the PROJECTION-derived
     *   |                                value, used wherever one current
     *   |                                execution number is required
     *   | Likely range                   the canonical current-evidence range
     *   | Conditional upside             ~3:13-3:15      with explicit criteria
     *
     *   "3:13:30 must not be labelled the current execution target merely
     *    because it is the fast edge of a wide range." And: "Do not average the
     *    projection and goal to manufacture a compromise target."
     *
     * WHAT WAS HERE, AND WHAT IT COST. `stated_goal_clamped_to_range_edge` took
     * the fast edge of `expectedRaceDay.likelyRangeSec` whenever the goal was
     * faster than it. On the owner's CIM, measured at the 2026-08-30 authoring
     * instant, that range's own confidence is 0.23 and the gain behind it
     * carries the reason `HISTORICAL_RESPONSE_UNKNOWN_POPULATION_RATE`. So a
     * 3:00 goal — being faster than everything — selected the most optimistic
     * point the model can produce, and he was told to race 7:22/mi while the
     * whole block rehearsed 7:52. Twenty-nine seconds a mile, over 26.2 miles,
     * with nothing in the plan at that pace.
     *
     * That is the goal reaching a prescription. `PLAN_SIMPLIFICATION_DOCTRINE`
     * invariant 10 forbids deriving current capacity from an aspirational goal,
     * and the standing rule is that the coach projects and never renegotiates a
     * stated goal — this was the same violation running the other way, arriving
     * through the race door instead of the training door.
     *
     * The pull is REMOVED rather than re-weighted (Constitution: prefer
     * deletion before addition). No confidence threshold was introduced, no
     * blend, no new constant — a threshold on `expectedRaceDay.confidence`
     * would have been a fresh Rule 9 boundary standing in for a question it
     * cannot ask. `stated_goal_clamped_to_range_edge` and
     * `stated_goal_within_range` are gone from the union.
     *
     * The forecast is NOT deleted with it: `expectedRaceDay` still says where
     * the block is designed to land him, and `conditionalUpside` below carries
     * its fast edge with the criteria that would make it active. Q7 asks for
     * four layers and this produces four.
     */
    const currentSec = currentProjection.expectedSec;
    targetSec = roundRaceTargetSec(currentSec);
    source = 'current_evidence';
    const range = currentProjection.likelyRangeSec;
    reasonVsExpected = goalSec == null
      ? `Race to what your evidence carries today${range ? ` (${fmtTime(range[0])}-${fmtTime(range[1])})` : ''}.`
      : goalSec >= currentSec
        ? `Your goal (${fmtTime(goalSec)}) is at or slower than what your evidence carries today · this is comfortably inside it.`
        : `Today's evidence says ${fmtTime(currentSec)}${range ? ` (${fmtTime(range[0])}-${fmtTime(range[1])})` : ''}. The block is built to move that forward; your ${fmtTime(goalSec)} goal stays yours and is not what this day is priced at yet.`;
  }
  const paceSecPerMi = targetSec != null && race.distanceMi > 0 ? Math.round(targetSec / race.distanceMi) : null;
  const opening = targetSec != null ? raceOpeningPlan({ goalSec: targetSec, distanceMi: race.distanceMi }) : null;
  // CEFFORT-1 · Rule 16 · the LABEL says which kind of day this is. "Goal
  // pace" over a hard workout is the same defect class as "kept it aerobic"
  // over a 159 bpm long run: a sentence asserting a fact about a measurement,
  // not gated on it.
  const strategyLabel = paceSecPerMi == null
    ? null
    : isControlledCEffort
      ? `Controlled effort · ${fmtPace(paceSecPerMi)} average`
      : `${opening ? 'Controlled start · ' : ''}${fmtPace(paceSecPerMi)} average`;
  const hr = paceSecPerMi != null
    ? resolveRaceHrGuidance({
        distanceMi: race.distanceMi,
        lthrBpm: reads.lthrBpm,
        maxHrBpm: reads.maxHrBpm,
        executionPaceSecPerMi: paceSecPerMi,
        efforts: reads.hrEfforts,
        // CEFFORT-1 · the HR band and the mid-race abort follow the same
        // effort the pace does, or the two instruments contradict each other
        // on one day (Rule 16).
        effortCharacter: isControlledCEffort ? 'controlled' : 'race',
      })
    : null;
  const execution: RaceOutlook['execution'] = {
    targetSec,
    paceSecPerMi,
    paceBandSecPerMi: paceSecPerMi != null ? [paceSecPerMi - RACE_EXECUTION_BAND_S_PER_MI, paceSecPerMi + RACE_EXECUTION_BAND_S_PER_MI] : null,
    source,
    effortCharacter: isControlledCEffort ? 'controlled_c_effort' : 'race',
    strategyLabel,
    reasonVsExpected,
    hr,
  };

  // ── 7 · feasibility (Goal Feasibility §L) — compare, never edit ─────────
  let feasibility: RaceOutlook['goalFeasibility'];
  if (goalSec == null) {
    feasibility = { status: 'no_goal', gapSec: null, gapToRangeEdgeSec: null, reasons: ['NO_STATED_GOAL'] };
  } else if (expectedSec == null || likelyRangeSec == null) {
    feasibility = { status: 'unavailable', gapSec: null, gapToRangeEdgeSec: null, reasons: ['NO_PROJECTION'] };
  } else {
    const gapSec = expectedSec - goalSec;
    const gapToEdge = likelyRangeSec[0] - goalSec;
    const withinTolerance = goalSec >= likelyRangeSec[0] * (1 - GOAL_OPTIMISM_TOLERANCE);
    const status: RaceOutlook['goalFeasibility']['status'] =
      goalSec >= expectedSec ? 'comfortable'
      : goalSec >= likelyRangeSec[0] ? 'realistic'
      : withinTolerance ? 'aggressive'
      : 'unlikely_currently';
    feasibility = {
      status, gapSec, gapToRangeEdgeSec: gapToEdge,
      reasons: [`expected ${fmtTime(expectedSec)} · range ${fmtTime(likelyRangeSec[0])}-${fmtTime(likelyRangeSec[1])} · goal ${fmtTime(goalSec)}`],
    };
  }

  // ── 9 · the bridge ──────────────────────────────────────────────────────
  const bridge: BridgeStep[] = [
    {
      step: 'current_capacity', label: 'Current threshold capacity',
      value: `${fmtPace(thresholdSecPerMi)} (VDOT ${thresholdVdot ?? 'unknown'})`, valueSec: null, paceSecPerMi: thresholdSecPerMi,
      rangeSec: null, confidence: threshold.confidence,
      evidence: threshold.evidenceIds.map((id) => `run ${id}`),
      changeTrigger: 'Three corroborating threshold sessions faster or slower than this, with heart rate in the band.',
      differsFromPrevious: null,
    },
    {
      step: 'current_projection', label: `What you could race today at ${fmtMi(race.distanceMi) ?? 'the race distance'}`,
      value: fmtTime(currentProjection.expectedSec), valueSec: currentProjection.expectedSec,
      paceSecPerMi: currentProjection.expectedSec != null && race.distanceMi > 0 ? Math.round(currentProjection.expectedSec / race.distanceMi) : null,
      rangeSec: currentProjection.likelyRangeSec, confidence: currentProjection.confidence,
      evidence: currentProjection.reasons,
      changeTrigger: 'A change in threshold capacity, or a new graded race that moves your endurance exponent.',
      differsFromPrevious: 'Threshold pace carried to the race distance through your own endurance exponent, not the population table.',
    },
    {
      step: 'training_prescription', label: marathonLike ? 'Marathon-pace training now' : 'Race-pace training now',
      value: fmtPace(trainingPrescription.paceSecPerMi), valueSec: null, paceSecPerMi: trainingPrescription.paceSecPerMi,
      rangeSec: null, confidence: anchors?.basis.marathon.confidence ?? null,
      evidence: [trainingPrescription.whyThisPace],
      changeTrigger: 'The threshold anchor or the endurance exponent moving; rehearsals at this pace that stay controlled will move the anchor.',
      differsFromPrevious: marathonLike
        ? 'Same capacity, priced as a training stimulus: it may sit slower than race day because it is today\'s pace, not the pace the block is expected to earn.'
        : null,
    },
    {
      step: 'expected_improvement', label: 'Improvement the remaining block can deliver',
      value: `+${roundTo(gain.gainVdot, 1)} VDOT (${roundTo(gain.gainRangeVdot[0], 1)}-${roundTo(gain.gainRangeVdot[1], 1)})`,
      valueSec: null, paceSecPerMi: null, rangeSec: null, confidence: expectedImprovement.confidence,
      evidence: [
        `${gain.buildWeeks} build weeks · execution ${gain.executionQuality} from ${gainEvidenceCount} recent test points`,
        ...gain.reasons,
      ],
      changeTrigger: 'Executing key sessions moves this up; missed or uncontrolled sessions move it down; time passing alone never moves it.',
      differsFromPrevious: 'Sized from the runway and how the plan is being executed, never from the goal.',
    },
    {
      step: 'expected_race_day', label: 'Expected on race day',
      value: fmtTime(expectedSec), valueSec: expectedSec,
      paceSecPerMi: expectedSec != null && race.distanceMi > 0 ? Math.round(expectedSec / race.distanceMi) : null,
      rangeSec: likelyRangeSec, confidence: expectedRaceDay.confidence,
      evidence: expectedRaceDay.reasons,
      changeTrigger: 'Every input above; the range narrows as execution evidence accumulates.',
      differsFromPrevious: 'Current projection plus the expected improvement, converted through the same equivalence.',
    },
    {
      step: 'execution_target', label: 'What to run on the day',
      value: `${fmtTime(targetSec)} · ${fmtPace(paceSecPerMi)}`, valueSec: targetSec, paceSecPerMi,
      rangeSec: null, confidence: expectedRaceDay.confidence,
      evidence: [reasonVsExpected, ...(hr ? [`HR ${hr.expectedRangeBpm[0]}-${hr.expectedRangeBpm[1]} expected${hr.informationalOnly ? ' (reference only)' : ''}`] : [])],
      changeTrigger: 'Your current projection moving — which is what the block is built to do.',
      // EXECTARGET-1 · the step now differs from the one before it by going
      // BACK to current evidence, and says so. The forecast above it is the
      // block's intent; this is what today's evidence carries.
      differsFromPrevious: source === 'controlled_c_effort'
        ? 'A C race is run as the week’s hard session, so it is priced as a controlled effort rather than as a race.'
        : source === 'current_evidence'
          ? 'Today’s evidence, not the forecast above it. The block is built to move that forward; race day is not priced on training that has not happened yet.'
          : null,
    },
  ];

  const evidenceAgeDays = newestEvidenceISO
    ? Math.max(0, Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(newestEvidenceISO + 'T12:00:00Z')) / 86_400_000))
    : null;
  const staleness = {
    newestEvidenceISO,
    evidenceAgeDays,
    stale: evidenceAgeDays != null && evidenceAgeDays > RACE_OUTLOOK_STALE_AFTER_DAYS,
    staleAfterDays: RACE_OUTLOOK_STALE_AFTER_DAYS,
  };

  const changeTriggers = [
    'Threshold capacity: three corroborated threshold sessions at a new pace with heart rate in the band.',
    'Durability: a graded race at a second distance, or repeated long runs with less late-run cardiac drift.',
    'Expected improvement: completing (or missing) the key sessions the block prescribes; it never moves because a week passed.',
    'Race-day outlook: any of the above, or the race date changing.',
    'Execution target: the outlook range moving, or a goal you change yourself. The app never changes your goal.',
  ];

  return {
    modelVersion: RACE_OUTLOOK_MODEL_VERSION,
    resolvedAt,
    todayISO: today,
    race: { ...race, daysToRace, weeksToRace: weeksToRace != null ? roundTo(weeksToRace, 1) : null },
    statedGoal: { sec: goalSec, paceSecPerMi: goalSec != null && race.distanceMi > 0 ? Math.round(goalSec / race.distanceMi) : null },
    capacity,
    currentProjection,
    trainingPrescription,
    expectedImprovement,
    expectedRaceDay,
    execution,
    /* EXECTARGET-1 · Q7's fourth layer. The fast edge of the block's own
     * forecast, carried as an upside rather than as the prescription. Refused
     * when it is not actually faster than what he is being told to run today,
     * because an "upside" that is not an upside is a second name for the same
     * number (Rule 16). */
    conditionalUpside: (() => {
      const edge = expectedRaceDay.likelyRangeSec?.[0] ?? null;
      if (edge == null || targetSec == null || edge >= targetSec) return null;
      return {
        targetSec: roundRaceTargetSec(edge),
        paceSecPerMi: race.distanceMi > 0 ? Math.round(edge / race.distanceMi) : null,
        criteria: CONDITIONAL_UPSIDE_CRITERIA,
        confidence: expectedRaceDay.confidence,
      };
    })(),
    /* EXECTARGET-1 · "Race day cannot ask for a pace the block never made
     * credible." Measured against what the plan AUTHORED, never what a ladder
     * intended. */
    blockSeam: marathonSeam({
      lastRehearsalSecPerMi: reads.plannedLastRehearsalPaceSecPerMi,
      executionSecPerMi: paceSecPerMi,
    }),
    goalFeasibility: feasibility,
    staleness,
    bridge,
    changeTriggers,
    flags,
  };
}

async function loadLthr(userUuid: string): Promise<number | null> {
  // No swallowed failure: a profile read that throws is a failure the
  // outlook's caller must see, not an absent LTHR (Rule 11).
  const row = (await pool.query<{ lthr: string | number | null }>(
    `SELECT lthr FROM profile WHERE user_uuid = $1::uuid LIMIT 1`, [userUuid],
  )).rows[0];
  if (row?.lthr == null) return null;
  const v = Number(row.lthr);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v;
}

/** Convenience: resolve by slug. Null when the race does not exist. */
export async function resolveRaceOutlookBySlug(userUuid: string, slug: string, todayISO?: string): Promise<RaceOutlook | null> {
  const today = todayISO ?? await runnerToday(userUuid);
  const race = await loadRaceForOutlook(userUuid, slug, today);
  if (!race || !(race.distanceMi > 0)) return null;
  return resolveRaceOutlook(userUuid, race, today);
}

/** The pace-side invariant every consumer may assert: adjacent bridge steps
 *  are derived from each other; a stated goal never pulls the execution
 *  target past the likely range's fast edge. */
export function raceOutlookInvariants(o: RaceOutlook): string[] {
  const out: string[] = [];
  const x = o.execution;
  const e = o.expectedRaceDay;
  if (x.targetSec != null && e.likelyRangeSec != null && x.targetSec < e.likelyRangeSec[0] - 10) {
    out.push('EXECUTION_TARGET_FASTER_THAN_LIKELY_RANGE');
  }
  if (x.targetSec != null && e.expectedSec != null && o.statedGoal.sec == null && Math.abs(x.targetSec - e.expectedSec) > 10) {
    out.push('NO_GOAL_TARGET_NOT_EXPECTED_RACE_DAY');
  }
  if (o.expectedRaceDay.expectedSec != null && o.currentProjection.expectedSec != null
      && o.expectedRaceDay.expectedSec > o.currentProjection.expectedSec + 5) {
    out.push('EXPECTED_RACE_DAY_SLOWER_THAN_CURRENT');
  }
  return out;
}

/** Utility for consumers that still speak VDOT-equivalence: the Daniels time
 *  at the race distance for a VDOT. Kept here so no consumer imports
 *  `predictRaceTime` for a projection-shaped number. */
export function equivalenceAtDistance(vdot: number | null, distanceMi: number): number | null {
  if (vdot == null || !(distanceMi > 0)) return null;
  return predictRaceTime(vdot, distanceMi) ?? null;
}

