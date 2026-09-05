/**
 * lib/plan/adjudication/promotion.ts · THE ADJUDICATED CEILING ON A PROMOTED
 * ADAPTATION.
 *
 * ── WHY IT LIVES HERE AND NOT UNDER lib/adaptation ──────────────────────────
 *
 * Because the path that would promote is `lib/plan/adaptive-ramp.ts` through
 * `lib/plan/adaptation-authority.ts`, both already in lib/plan, and because
 * `lib/adaptation/_zero_mutation_scan.test.ts` guard 3 is a ratchet on who may
 * import that layer. Putting a plan-adjudication file inside it would have
 * meant GROWING that ratchet so lib/plan could import lib/adaptation, which is
 * the wrong direction for a file that is entirely about one plan week.
 *
 * ── WHAT IS ACTUALLY TRUE ABOUT PROMOTION TODAY, STATED FIRST ───────────────
 *
 * NOTHING IN THIS APP PROMOTES AN ADAPTATION. Verified 2026-09-04, and it is
 * two independent facts rather than one:
 *
 *   · `lib/adaptation/load-adaptation-engine.ts` — the canonical engine's
 *     database shell — is SHADOW-ONLY. `_promotion_contract.test.ts` asserts it
 *     performs no INSERT/UPDATE/DELETE and that its ONLY importer anywhere is
 *     `lib/adaptation/shadow-compare.ts`. That gate stands and this file does
 *     not touch it.
 *   · `lib/plan/adaptation-authority.ts` — THE ONE SEAM — declares
 *     `AUTOMATIC_ADAPTATION_AUTHORITY: false = false`, typed as the literal so
 *     opening it is a visible edit that `_seal_single_seam.test.ts` notices.
 *     `tryAdaptiveBump`, the only upward lever in the engine (Rule 21's volume
 *     axis), returns `null` on its first line because of it.
 *
 * SO THIS FILE ENABLES NOTHING. It is the check that runs at the place a
 * promotion WOULD land, wired now so that opening the seam does not also
 * require someone to remember this. Rule 20's shape exactly: the rule and the
 * check land in the same change, or the rule is a hypothesis.
 *
 * ── WHY THE BUMP IS THE RIGHT PLACE ─────────────────────────────────────────
 *
 * `tryAdaptiveBump` raises weekly volume and the long run. Those are the two
 * quantities the adjudication layer sizes against the runner's own demonstrated
 * maxima, so a bump is the one automatic path that can push a week past a
 * verdict the layer already returned at authoring. Every other action the seam
 * handles reduces load (downgrade, shave, reschedule) or records something, and
 * a reduction cannot breach a ceiling.
 *
 * ── WHERE IN THE FUNCTION, AND WHY NOT EARLIER ──────────────────────────────
 *
 * AFTER `automaticPlanMutationIsAuthorised()`, never before it.
 * `_seal_single_seam.test.ts` GUARD 3 asserts the seam check is the first thing
 * inside `tryAdaptiveBump` — "a guard placed after the detection leaves a live
 * path to applyAdaptations one edit away" — and putting an adjudication read in
 * front of it would both break that gate and make a sealed engine do database
 * work to answer a question the seam had already closed.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · A promotion that does not go through `tryAdaptiveBump`. There is no such
 *     path today and `_seal_single_seam.test.ts` GUARD 3 is what keeps it that
 *     way, but this file cannot see one if it appears.
 *   · Pace. A promoted `recompute_paces` changes what the runner is asked to
 *     run at, not how far, and the adjudication layer sizes distances.
 *   · Whether the bump is a GOOD idea. It answers one question: would the week
 *     the runner ends up with still be supported by what he has done.
 *   · The two readings the app has no reader for. `maxCompletedMpMi` and
 *     `maxStressorsInAWeek` are null here for the same reason and with the same
 *     argued entries as at authoring.
 */
import { pool } from '@/lib/db/pool';
import { logReadFailure } from '@/lib/db/read';
import {
  adjudicatePlanBlock, REFUSAL_NO_HISTORY,
  type DemonstratedHistoryInput,
} from './from-plan';
import type { PlannedWeek } from './adjudicate';

/** Refused, permitted, or unreadable. Three facts, never one (Rule 11). */
export type PromotionVerdict =
  | { readonly ok: true; readonly why: string }
  | { readonly ok: false; readonly because: readonly string[] };

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE PURE HALF  ·  falsifiable with no database
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Would the week the bump PRODUCES still be supported by the runner's own
 * history?
 *
 * The week handed in is the POST-bump week, not the authored one. Adjudicating
 * the week as authored would answer a question that was already answered at
 * authoring and would pass every bump by construction, which is the "wired,
 * tested and inert" failure this codebase keeps producing.
 *
 * A missing history REFUSES the promotion rather than permitting it, and that
 * asymmetry is deliberate and is the one place in this layer where Rule 21's
 * "the bar to go up may not be higher than the bar to come down" is knowingly
 * not applied. The justification: this is not the bar for a bump, it is the bar
 * for an UNATTENDED bump applied while nobody is watching. The runner asking
 * for more volume goes through `/api/plan/replan` and is not gated here at all.
 * Rule 21's concern is that the engine cannot push; nothing in this file stops
 * the engine pushing on evidence, it stops it pushing on an absence.
 */
export function adjudicatePromotion(args: {
  readonly weekAfterPromotion: PlannedWeek;
  readonly history: DemonstratedHistoryInput | null;
  readonly todayISO: string;
}): PromotionVerdict {
  const a = adjudicatePlanBlock({
    weeks: [args.weekAfterPromotion],
    history: args.history,
    todayISO: args.todayISO,
  });
  if (a.mayPromote) {
    return {
      ok: true,
      why: `${a.traces.length} decision(s) adjudicated against his own history; none blocked.`,
    };
  }
  return { ok: false, because: a.blockedBecause };
}

/** Did the promotion fail because we could not see the runner at all? */
export function refusedForAbsentHistory(v: PromotionVerdict): boolean {
  return v.ok === false && v.because.some((b) => b.startsWith(REFUSAL_NO_HISTORY));
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE DATABASE SHELL
 * ═══════════════════════════════════════════════════════════════════════ */

/** One bump the ramp proposes: a row id and the distance it would become. */
export interface ProposedBump {
  readonly workoutId: string;
  readonly newDistanceMi: number;
}

interface PlanRow {
  id: string;
  type: string;
  distance_mi: string;
  sub_label: string | null;
  is_quality: boolean | null;
  is_long: boolean | null;
  date_iso: string;
  phase: string | null;
  is_race_week: boolean | null;
}

/**
 * Build the post-bump week and adjudicate it.
 *
 * ── RULE 14 · WHAT POPULATION THIS QUERY READS ──────────────────────────────
 *
 * The ACTIVE plan only (`archived_iso IS NULL`, newest authored), joined
 * through `plan_weeks`/`plan_phases` so the week's phase and race-week flag
 * come from the rows themselves. Joining `plan_workouts` on `user_uuid` alone
 * reads every archived version of the block, which is the ACTIVEPLAN-1 defect
 * that made `recentQualityPerWeek` return 36.
 *
 * ── RULE 11 · A FAILED READ IS NOT AN EMPTY WEEK ────────────────────────────
 *
 * Every read refuses on failure. A dropped connection here would otherwise
 * produce a zero-mile week, which adjudicates clean and would wave the bump
 * through on the strength of not having looked.
 */
export async function adjudicateProposedBump(args: {
  readonly userUuid: string;
  readonly todayISO: string;
  readonly bumps: readonly ProposedBump[];
  /** Injected so this function is testable and so the reader stays where it
   *  is owned. `null` means the caller could not read it. */
  readonly history: DemonstratedHistoryInput | null;
}): Promise<PromotionVerdict> {
  const rows = await rowsOrNull(args.userUuid, args.todayISO);
  if (rows === null) {
    return {
      ok: false,
      because: ['recoverability · could not read the active plan, so the week this bump '
        + 'would produce could not be adjudicated. A read that failed and a week with no '
        + 'load in it are opposite facts (Rule 11).'],
    };
  }
  if (rows.length === 0) {
    return {
      ok: false,
      because: ['recoverability · the active plan has no rows in the next seven days, so '
        + 'there is nothing for a volume bump to land on.'],
    };
  }

  const bumpBy = new Map(args.bumps.map((b) => [b.workoutId, b.newDistanceMi]));
  const after = rows.map((r) => ({
    type: r.type,
    distanceMi: bumpBy.get(r.id) ?? Number(r.distance_mi),
    isQuality: r.is_quality === true,
    isLong: r.is_long === true,
    subLabel: r.sub_label,
  }));

  const week: PlannedWeek = {
    weekStartISO: rows[0].date_iso,
    weeklyMi: Math.round(after.reduce((a, d) => a + (Number.isFinite(d.distanceMi) ? d.distanceMi : 0), 0) * 10) / 10,
    longestMi: Math.round(after
      .filter((d) => d.isLong && d.type !== 'race')
      .reduce((a, d) => Math.max(a, d.distanceMi), 0) * 10) / 10,
    stressors: after
      .filter((d) => d.type === 'race' || d.type === 'threshold' || d.type === 'tempo'
        || d.type === 'intervals' || (d.isLong && (d.isQuality || d.distanceMi >= 16)))
      .map((d) => `${d.distanceMi} mi ${d.type}`),
    // The ramp bumps easy days and the long run only, never a marathon-pace
    // dose, so a bump cannot move this. Zero here is a fact about the lever,
    // not a fact this function failed to read.
    mpMi: 0,
    isTaper: rows.some((r) => r.phase === 'TAPER'),
    isRaceWeek: rows.some((r) => r.is_race_week === true || r.type === 'race'),
  };

  return adjudicatePromotion({
    weekAfterPromotion: week,
    history: args.history,
    todayISO: args.todayISO,
  });
}

/**
 * `null` = the read FAILED. `[]` = the active plan genuinely has no rows in the
 * next seven days. The caller must not collapse them (Rule 11), and the two
 * refusal messages above say which happened.
 */
async function rowsOrNull(userUuid: string, todayISO: string): Promise<PlanRow[] | null> {
  const res = await pool.query<PlanRow>(
    `SELECT pw.id, pw.type, pw.distance_mi::text AS distance_mi, pw.sub_label,
            pw.is_quality, pw.is_long, pw.date_iso::text AS date_iso,
            pp.label AS phase, pwk.is_race_week
       FROM plan_workouts pw
       JOIN plan_weeks pwk ON pwk.id = pw.week_id
       JOIN plan_phases pp ON pp.id = pwk.phase_id
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1::uuid
        AND tp.archived_iso IS NULL
        AND pw.date_iso::date BETWEEN $2::date AND $2::date + 6
      ORDER BY pw.date_iso::date ASC`,
    [userUuid, todayISO],
  ).then((r) => r.rows).catch((e: unknown) => {
    logReadFailure('plan/adjudication/promotion · active plan next 7 days', e);
    return null;
  });
  return res;
}
