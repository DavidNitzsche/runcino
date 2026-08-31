/**
 * lib/plan/adaptive-ramp.ts · upward adaptation when signals are green.
 *
 * David's 2026-06-02 call: the existing adapter only goes DOWN (shave,
 * downgrade) on pull-back signals. When a runner is HANDLING work well
 * (readiness pillars green, paces hit clean, low decoupling on longs),
 * the plan should push UP toward the tier's peak band · not leave
 * fitness on the table.
 *
 * Architecture · companion to adapt.ts which handles pull-back:
 *
 *   detectGreenRampOpportunity(userId)
 *     ↓ returns a RampOpportunity OR null
 *   buildBumpAction(userId, opp, activePlan)
 *     ↓ returns an AdaptationAction['kind' = 'bump_distance']
 *   applyAdaptations() picks it up and mutates plan_workouts
 *
 * Gates · all must pass before a bump:
 *   · Readiness GREEN — at most one pillar dragging (CONVERGENCE.amberMinDomains)
 *   · The last 2 prescribed key sessions in 14 days both EARNED PROGRESSION
 *     (`lib/execution/load.ts` · `earnsProgressionCredit`)
 *   · Last long run clean (aerobic decoupling < 5% if measurable)
 *   · Plan's current peak weekly is below tier upper band × 0.95
 *   · No bump applied in last 7 days (cooldown · absorption time)
 *
 * 2026-08-30 · THE SECOND GATE IS NEW, AND THE ONE IT REPLACED IS WHY THIS
 * WHOLE MODULE HAD NEVER RUN. It read `runs.data->>'type'` for a session type
 * that field has never carried, so it matched nothing, `allGreen` was never
 * true, and `coach_intents.reason = 'plan_adapt_bump'` is 0 rows across every
 * account and the whole life of the table. Wired, cron-mounted, unit-tested,
 * and inert. See `detectRampSignals` gate 2 for the full account and for why
 * the fix reaches for the execution reader rather than a corrected field name.
 *
 * Bump rules:
 *   · weekly target +5% (cap at tier upper band)
 *   · long run +1mi (cap at tier peakLongMiBand[1])
 *
 * Cite: David 2026-06-02 conversation · "if the runner and the weeks
 * are solid, distance is up or even a bit over the ramp can be pretty
 * aggressive."
 * DOCTRINE-BOOK-15 (2026-08-17) · THE BUMP POLICY IS A PRODUCT CONVENTION.
 * This used to cite `Pfitzinger Faster Road Racing · adaptive load progression`,
 * which the gate could not open — and Faster Road Racing's plans are fixed
 * schedules, so there is no adaptive-progression protocol in it to cite. The
 * gates above (readiness green, last two qualities on pace, clean long,
 * 7-day cooldown) are ours, and so are MAX_LONG_BUMP_MI / MAX_WEEKLY_BUMP_MI.
 * +5 mi in a week is NOT inside Research/00a's per-week ramp band at low
 * volume — at 20 mpw it is +25% — which is exactly why the bump is bounded by
 * the tier band rather than by a percentage, and why it only fires when the
 * runner is demonstrably absorbing load. CONVENTION.adaptive-bump-ceiling
 * binds the property it actually owes: a bump can never carry a runner past
 * the upper band of their own tier.
 *
 * Cite: Research/00a-distance-running-training.md §Volume-Progression-Rules  // was §progressive-overload · heading: ### Volume progression rules
 * Cite: Research/00a-distance-running-training.md §"Practical load rules" — add
 *       stress one-at-a-time; the fatigue gate that the pull-back streak mirrors
 */

import { pool } from '@/lib/db/pool';
import { attempt, rowOrNull } from '@/lib/db/read';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { runDaySql, runDistanceMiSql, runNotMergedSql } from '@/lib/runs/run-shape';
import { CONVERGENCE } from '@/lib/coach/convergence';

export interface RampOpportunity {
  /** Why we're bumping · explainer for the intent log. */
  reason: string;
  /** Plan id this opportunity applies to. */
  planId: string;
  /** Plan's tier peak weekly upper bound · the bump can't exceed this. */
  tierWeeklyUpper: number;
  /** Plan's tier peak long upper bound. */
  tierLongUpper: number;
  /** Plan's current peak weekly across non-taper weeks. */
  currentPeakWeekly: number;
  /** Plan's current peak long. */
  currentPeakLong: number;
}

export interface RampSignals {
  readinessGreen: boolean;
  lastQualityOnPace: boolean;
  lastLongClean: boolean;
  belowTierUpper: boolean;
  noBumpRecent: boolean;
  /** Diagnostic detail · used for the intent's why-line and audit. */
  details: {
    pullbackStreakDays: number;
    lastQualityDeltaBpm: number | null;
    lastLongDecouplingPct: number | null;
    peakHeadroomMi: number;
    daysSinceLastBump: number;
  };
}

const COOLDOWN_DAYS = 7;
const LONG_DECOUPLING_PCT_CAP = 5;

/** A pillar must drag for at least this many days before it counts as a
 *  dragging DOMAIN. One bad night is not a trend — the sustain the old
 *  `pullbackStreakDays < 2` comparison was reaching for, stated per pillar. */
const MIN_SUSTAINED_STREAK_DAYS = 2;

/** How far back the quality and long-run signals look. Unchanged from the
 *  window the dead queries used, so this fix moves the SOURCE and not the bar. */
const QUALITY_LOOKBACK_DAYS = 14;

/** How many delivered key sessions the ramp wants before it will add load.
 *  Two, per the module header's original policy ("Last 2 quality workouts"). */
const MIN_QUALITY_SESSIONS = 2;

/** What counts as a long run here. The SAME number `lib/adaptation/load.ts`
 *  uses to pick the runs it derives decoupling from, so the two readers cannot
 *  disagree about which day was the long one. */
const LONG_RUN_MIN_MI = 8;

/** `YYYY-MM-DD`, n days before `iso`. */
function isoDaysBefore(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) - n * 86_400_000)
    .toISOString().slice(0, 10);
}

/**
 * The measured anchor as the daily snapshot cron computed it — the same read
 * `lib/adaptation/load.ts` makes, for the same reason: the execution reader
 * needs it to size the easy-pace leg of a blended verdict, and recomputing it
 * here would put a second opinion about fitness in the ramp path.
 *
 * A null anchor is a legitimate answer (no snapshot yet), and
 * `loadKeySessionExecutions` accepts it. A failed read propagates, because the
 * caller wraps this in `attempt` and a failure must not read as "no anchor".
 */
async function snapshotVdot(userUuid: string): Promise<number | null> {
  const r = await pool.query<{ vdot: string | null }>(
    `SELECT vdot::text FROM projection_snapshots
      WHERE user_uuid = $1 AND vdot IS NOT NULL
      ORDER BY snapshot_date DESC LIMIT 1`,
    [userUuid],
  );
  const v = r.rows[0]?.vdot;
  return v != null ? Number(v) : null;
}

/**
 * Read every gate signal for upward adaptation. Returns the full
 * signal set so the caller can decide whether to bump.
 */
export async function detectRampSignals(
  userId: string,
  activePlan: { id: string; authoredState: Record<string, unknown> },
): Promise<RampSignals> {
  // 2026-06-03 · runner TZ for "today" anchors.
  const today = await runnerToday(userId);
  // 1. Readiness · no pull-back streaks ≥ 2 days
  const readinessRow = await rowOrNull<{ streaks: unknown }>(
    'plan/adaptive-ramp · readiness pull-back streaks',
    pool.query<{ streaks: unknown }>(
      `SELECT streaks
       FROM readiness_snapshots
      WHERE user_uuid = $1 AND snapshot_date >= $2::date - 1
      ORDER BY snapshot_date DESC LIMIT 1`,
      [userId, today],
    ),
  );
  // A failed read is not "no pull-back streak". `.catch(() => undefined)` here
  // gave `streaks = []`, `pullbackStreakDays = 0`, `readinessGreen = true` — a
  // dropped connection read as a runner absorbing load well, and this gate is
  // one of five that authorise PRESCRIBING MORE MILEAGE. The one signal that
  // would stop a bump is exactly the one an unreadable table cannot show.
  const readinessReadFailed = readinessRow === null;
  const streaks = (readinessRow?.streaks as Array<{ direction?: string; days?: number; pillar?: string }> | undefined) ?? [];
  /** Pillars dragging long enough to be a trend rather than one bad night. */
  const sustained = streaks.filter(
    (s) => s.direction === 'below' && Number(s.days ?? 0) >= MIN_SUSTAINED_STREAK_DAYS,
  );
  const draggingPillars = new Set(sustained.map((s) => s.pillar ?? 'unknown')).size;
  // Kept for the diagnostic line and the bench · the longest single streak.
  const pullbackStreakDays = sustained.reduce((max, s) => Math.max(max, Number(s.days ?? 0)), 0);

  /* ── 2026-08-30 · ONE DRAGGING PILLAR IS GREEN EVERYWHERE ELSE ────────────
   *
   * This read the LONGEST streak of ANY SINGLE pillar and blocked at two days:
   * `pullbackStreakDays = max(days)`, `readinessGreen = pullbackStreakDays < 2`.
   * So one pillar below its own baseline vetoed every bump, for as long as it
   * stayed there.
   *
   * On the owner's live account that is not hypothetical. His sleep pillar has
   * run below baseline continuously since 2026-08-16 — 14 days and counting —
   * while `readiness_snapshots.band` reads `ready` on every one of those days
   * (scores 55-68). The upward path was permanently vetoed by a signal the
   * readiness system itself grades as fine.
   *
   * It also disagreed with the rest of the app about what "readiness is
   * dragging" means. `lib/coach/convergence.ts` is the definition: ≤1 domain
   * is GREEN and nothing happens, 2 is amber and the runner is merely TOLD,
   * and it takes 3 converging domains before a pull-back may touch the plan.
   * The bar to ADD load was therefore stricter than the bar to CUT it by three
   * whole domains — the fitter runner getting the weaker response, which is
   * the Rule 9 signature, and the "readiness must not be harsh" ruling
   * (2026-08-30: "some people just are lower ready scores and that's okay")
   * pointed at the one path where harshness costs the runner progress.
   *
   * The bar now reuses `CONVERGENCE.amberMinDomains` rather than a private
   * number, so it is the same notion of corroboration (Rule 16): a bump is
   * allowed exactly while readiness is GREEN — at most one dragging pillar.
   * That is still the conservative side of doctrine; it is not a relaxation of
   * any ceiling, only agreement with the ladder the app already publishes.
   *
   * A per-pillar streak must be sustained (>= 2 days) before it counts as a
   * dragging domain at all, which is the sustain the old `< 2` comparison was
   * reaching for. A failed read still closes the gate. */
  const readinessGreen = !readinessReadFailed && draggingPillars < CONVERGENCE.amberMinDomains;

  // 2. Last 2 quality sessions · did the runner actually deliver them?
  //
  // ── 2026-08-30 · THE GATE THAT MADE THE RAMP UNREACHABLE ─────────────────
  //
  // This read `runs.data->>'type' IN ('threshold','intervals','tempo')` and
  // three keys — `hr_on_pace_delta_bpm`, `pace_target_s_per_mi`,
  // `aerobicDecouplingPct` — that exist on ZERO rows of the table. `data.type`
  // holds Strava's ACTIVITY KIND ('Run') or the loose faff label ('easy'); it
  // has never once held a session type. So `recentQuality` came back empty on
  // every call, `recentQuality.length >= 2` was false, `allGreen` was false,
  // and the whole upward ramp never fired for any runner in the history of the
  // database — `coach_intents.reason = 'plan_adapt_bump'` is 0 rows.
  //
  // Measured against the owner's real training: over the last 121 days this
  // gate passed on 0 of them, and could not have passed on any of them
  // whatever he ran. That is not a bar, it is a wall. Meanwhile the same
  // window held up to five sessions the app HAD classified — under
  // `data.workoutType`, one field name away. `_vocabulary_split.test.ts` is
  // the gate that now keeps this file honest, and its allowlist entry for this
  // file is deleted rather than re-argued.
  //
  // ── WHY THE EXECUTION READER AND NOT A CORRECTED FIELD NAME ──────────────
  //
  // Swapping `type` for `workoutType` would have made the query return rows,
  // and would ALSO have shipped a lie. `lastQualityDeltaBpm` is null on every
  // row, so `delta == null || delta <= tolerance` is vacuously true and the
  // gate would have reduced to "he did two quality-ish runs" while still
  // calling itself `lastQualityOnPace`. A sentence asserting a fact about a
  // measurement has to be gated on that measurement (CLAUDE.md Rule 16), and
  // the benefit of the doubt here is handed to the ENGINE — the answer it
  // produces is permission to add mileage.
  //
  // `loadKeySessionExecutions` is the reader that already answers this, on
  // this runner's real data, and the adaptation verdict scores off it. It
  // resolves each prescribed session through `ownedDaysSql` (so archived plan
  // versions cannot inflate the count — Rule 14), reconstructs the actual work
  // from the watch's own phases, and `earnsProgression` is doctrine's own
  // predicate for "this session earned a step up". One quantity, one name.
  //
  // Sessions that came back `readable: false` are DROPPED rather than counted
  // either way: a session we could not judge is missing evidence, not a failed
  // one. A read that THREW is its own third state and closes the gate.
  const qualityWindowFromISO = isoDaysBefore(today, QUALITY_LOOKBACK_DAYS);
  const keySessions = await attempt(
    'plan/adaptive-ramp · key session executions',
    (async () => {
      const [{ loadKeySessionExecutions }, vdot] = await Promise.all([
        import('@/lib/execution/load'),
        snapshotVdot(userId),
      ]);
      return loadKeySessionExecutions(userId, qualityWindowFromISO, today, vdot);
    })(),
  );
  const readableSessions = keySessions.ok
    ? keySessions.value.filter((s) => s.readable && !s.replacedByRace)
    : null;
  // Newest first, so "the last two" means the last two.
  const lastTwo = readableSessions
    ? [...readableSessions].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 2)
    : [];
  const lastQualityOnPace = readableSessions != null
    && lastTwo.length >= MIN_QUALITY_SESSIONS
    && lastTwo.every((s) => s.earnsProgression);
  // Kept on the interface because `composeReason` and the bench read it. It
  // was always null in production — the key it came from does not exist — and
  // it is null here for the same honest reason rather than a new one.
  const lastQualityDeltaBpm: number | null = null;

  // 3. Last long · aerobic decoupling clean
  //
  // 2026-08-30 · same defect, same fix, smaller blast radius: this asked for
  // `data->>'type' = 'long'`, which never matches, so `rowOrNull` returned
  // `undefined` (no rows — NOT a failure) and the gate stood permanently open
  // on a long run it had never looked at. A long run is identified by DISTANCE
  // here, exactly as `lib/adaptation/load.ts` identifies it (`>= 8` mi), so
  // the two readers agree about what a long run is.
  //
  // `aerobicDecouplingPct` is still not a stored key, so a found long with no
  // decoupling on record still reads clean. That is the documented posture and
  // it is unchanged — what changes is that the query now finds the run, so the
  // diagnostic below stops reporting confidence about a row it never read.
  const recentLong = await rowOrNull<{ decoupling: number | null }>(
    'plan/adaptive-ramp · last long decoupling',
    pool.query<{ decoupling: number | null }>(
      `SELECT (r.data->>'aerobicDecouplingPct')::numeric AS decoupling
       FROM runs r
      WHERE r.user_uuid = $1
        AND ${runNotMergedSql('r')}
        AND ${runDistanceMiSql('r')} >= ${LONG_RUN_MIN_MI}
        AND ${runDaySql('r')} >= ($2::date - ${QUALITY_LOOKBACK_DAYS})::text
        AND ${runDaySql('r')} <= $2::text
      ORDER BY ${runDaySql('r')} DESC LIMIT 1`,
      [userId, today],
    ),
  );
  const longReadFailed = recentLong === null;
  const lastLongDecouplingPct = recentLong?.decoupling != null
    ? Number(recentLong.decoupling)
    : null;
  // A long run we looked for and did not find, or found without decoupling
  // recorded, still counts as clean · that is a fact about the data we have.
  // A read that FAILED is not that fact. The old comment argued "benefit of
  // doubt" for both cases at once, and the benefit was being handed to the
  // engine, not the runner: the answer it produced was permission to add
  // mileage. We do not get the doubt when we cannot see.
  const lastLongClean = !longReadFailed
    && (lastLongDecouplingPct == null
      || lastLongDecouplingPct < LONG_DECOUPLING_PCT_CAP);

  // 4. Plan's current peak weekly · is there headroom?
  const tierWeeklyUpper = readTierUpper(activePlan.authoredState, 'tier_peak_weekly_band');
  const tierLongUpper = readTierUpper(activePlan.authoredState, 'tier_peak_long_band');
  const peakRow = await rowOrNull<{ peak_weekly: number | null; peak_long: number | null }>(
    'plan/adaptive-ramp · plan peak weekly headroom',
    pool.query<{ peak_weekly: number | null; peak_long: number | null }>(
      `SELECT MAX(weekly)::numeric AS peak_weekly, MAX(long_mi)::numeric AS peak_long
       FROM (
         SELECT pwk.id AS week_id,
                SUM(pw.distance_mi) AS weekly,
                MAX(CASE WHEN pw.type='long' THEN pw.distance_mi END) AS long_mi
           FROM plan_workouts pw
           JOIN plan_weeks pwk ON pwk.id = pw.week_id
           JOIN plan_phases pp ON pp.id = pwk.phase_id
          WHERE pw.plan_id = $1 AND pp.label <> 'TAPER'
          GROUP BY pwk.id
       ) wk`,
      [activePlan.id],
    ),
  );
  // A failed read is not "the plan peaks at zero". `.catch(() => ({ peak_weekly:
  // null }))` minted 0, and 0 against the tier upper is FULL headroom · the one
  // reading that makes the ceiling gate wave everything through. The plan we
  // could not measure is the plan we must not add to.
  const peakReadFailed = peakRow === null;
  const currentPeakWeekly = Number(peakRow?.peak_weekly ?? 0);
  const peakHeadroomMi = tierWeeklyUpper - currentPeakWeekly;
  const belowTierUpper = !peakReadFailed
    && peakHeadroomMi > tierWeeklyUpper * 0.05;  // ≥ 5% headroom

  // 5. Cooldown · no bump applied in last 7 days
  //
  // 2026-08-24 · swallowed-failure sweep · `coach_intents.user_id` is `uuid`,
  // so `COALESCE(user_uuid::text, user_id)` gave Postgres two types it cannot
  // match and the read threw on every call. `.catch(() => undefined)` then fell
  // to `daysSinceLastBump = 999`, i.e. "no bump in nearly three years" — the
  // cooldown was OPEN for every runner on every evaluation, which is the one
  // answer that lets a ramp fire back-to-back.
  /* BUMP-COOLDOWN-1 (2026-08-30) · the reason string below is
   * 'plan_adapt_upgrade', which is what applyAdaptations actually writes for a
   * mark_upgrade action (adapt.ts). It read 'plan_adapt_bump' — a string
   * NOTHING in this codebase has ever written — so the row was never found,
   * daysSinceLastBump was the 999 sentinel on every evaluation, and the
   * seven-day cooldown has never once engaged. The harness got two bumps out of
   * a single evaluation. Rule 14: a query naming a population that does not
   * exist.
   *
   * It also confounded this module's own evidence. Zero 'plan_adapt_bump' rows
   * reads as "the ramp never fired" whether it fired nightly or never, so the
   * wrong string was both the cooldown's bug and the reason the bug was hard to
   * see from the data. */
  const lastBump = await rowOrNull<{ ts: Date | string }>(
    'plan/adaptive-ramp · lastBump cooldown',
    pool.query<{ ts: Date | string }>(
      `SELECT ts FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1::uuid
        -- BUMP-COOLDOWN-1 (2026-08-30) · see the note above detectRampSignals.
        AND reason = 'plan_adapt_upgrade'
      ORDER BY ts DESC LIMIT 1`,
      [userId],
    ),
  );
  // A failed read is not "no recent bump". The cooldown holds CLOSED when it
  // cannot see, because a ramp we cannot justify must not fire. `999` stays the
  // sentinel for a genuine no-bump-on-record; a failure is its own state.
  const bumpReadFailed = lastBump === null;
  const daysSinceLastBump = lastBump?.ts
    ? Math.floor((Date.now() - new Date(lastBump.ts).getTime()) / 86400000)
    : 999;
  const noBumpRecent = !bumpReadFailed && daysSinceLastBump >= COOLDOWN_DAYS;

  return {
    readinessGreen,
    lastQualityOnPace,
    lastLongClean,
    belowTierUpper,
    noBumpRecent,
    details: {
      pullbackStreakDays,
      lastQualityDeltaBpm,
      lastLongDecouplingPct,
      peakHeadroomMi: Number(peakHeadroomMi.toFixed(1)),
      daysSinceLastBump,
    },
  };
}

/**
 * Aggregate · all gates must pass. Returns an opportunity (with the
 * plan's tier band + current peaks) or null.
 */
export async function detectGreenRampOpportunity(
  userId: string,
): Promise<RampOpportunity | null> {
  const plan = await pool.query<{
    id: string;
    authored_state: Record<string, unknown>;
  }>(
    `SELECT id, authored_state FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  ).then((r) => r.rows[0]).catch(() => undefined);
  if (!plan) return null;

  const signals = await detectRampSignals(userId, {
    id: plan.id,
    authoredState: plan.authored_state,
  });

  const allGreen = signals.readinessGreen
    && signals.lastQualityOnPace
    && signals.lastLongClean
    && signals.belowTierUpper
    && signals.noBumpRecent;
  if (!allGreen) return null;

  const tierWeeklyUpper = readTierUpper(plan.authored_state, 'tier_peak_weekly_band');
  const tierLongUpper = readTierUpper(plan.authored_state, 'tier_peak_long_band');
  const peakRow = await pool.query<{ peak_weekly: number; peak_long: number }>(
    `SELECT MAX(weekly)::numeric AS peak_weekly, MAX(long_mi)::numeric AS peak_long
       FROM (
         SELECT pwk.id AS week_id,
                SUM(pw.distance_mi) AS weekly,
                MAX(CASE WHEN pw.type='long' THEN pw.distance_mi END) AS long_mi
           FROM plan_workouts pw
           JOIN plan_weeks pwk ON pwk.id = pw.week_id
           JOIN plan_phases pp ON pp.id = pwk.phase_id
          WHERE pw.plan_id = $1 AND pp.label <> 'TAPER'
          GROUP BY pwk.id
       ) wk`,
    [plan.id],
  ).then((r) => r.rows[0]).catch(() => ({ peak_weekly: 0, peak_long: 0 }));

  return {
    reason: composeReason(signals),
    planId: plan.id,
    tierWeeklyUpper,
    tierLongUpper,
    currentPeakWeekly: Number(peakRow.peak_weekly ?? 0),
    currentPeakLong: Number(peakRow.peak_long ?? 0),
  };
}

/**
 * Compute the per-row bumps for the next 7 days. Two caps:
 *   · Long run · +1mi (capped at tier.peakLongMiBand[1])
 *   · Weekly total · +5mi (distributed across easy days, capped per
 *     easy day at +1mi so we don't accidentally shift a 5mi easy to
 *     10mi · doctrine: distribute reward, don't pile on one day)
 *
 * Returns an AdaptationAction of kind 'mark_upgrade' that
 * applyAdaptations() consumes.
 */
export const MAX_LONG_BUMP_MI = 1.0;
export const MAX_WEEKLY_BUMP_MI = 5.0;
export const MAX_PER_EASY_BUMP_MI = 1.0;

export interface UpgradePlan {
  bumps: Array<{ workoutId: string; oldDistanceMi: number; newDistanceMi: number; type: string }>;
  longBumpMi: number;
  weeklyBumpMi: number;
  reason: string;
}

export async function planUpgrade(opp: RampOpportunity): Promise<UpgradePlan | null> {
  // 2026-06-03 · resolve runner TZ via plan_id → user_uuid lookup.
  // RampOpportunity doesn't carry userId, so we look it up. Off-by-1-day
  // matters here · upgrading "next 7 days" of plan workouts shouldn't
  // shift at UTC-midnight.
  const userRow = (await pool.query<{ user_uuid: string }>(
    `SELECT user_uuid::text FROM training_plans WHERE id = $1 LIMIT 1`,
    [opp.planId],
  ).catch(() => ({ rows: [] as Array<{ user_uuid: string }> }))).rows[0];
  const today = userRow?.user_uuid
    ? await runnerToday(userRow.user_uuid)
    // No owning user means the plan row is gone, so the query below
    // returns nothing and this value is never read against real data.
    // Server UTC is the only thing available and cannot mislead here.
    : new Date().toISOString().slice(0, 10);
  // Pull next 7 days of rows on the active plan.
  const rows = await pool.query<{
    id: string; type: string; distance_mi: number; date_iso: string;
  }>(
    `SELECT pw.id, pw.type, pw.distance_mi::numeric AS distance_mi, pw.date_iso::text AS date_iso
       FROM plan_workouts pw
       JOIN plan_weeks pwk ON pwk.id = pw.week_id
       JOIN plan_phases pp ON pp.id = pwk.phase_id
      WHERE pw.plan_id = $1
        AND pw.date_iso::date BETWEEN $2::date AND $2::date + 6
        AND pp.label <> 'TAPER'
      ORDER BY pw.date_iso::date ASC`,
    [opp.planId, today],
  ).then((r) => r.rows).catch(() => []);

  if (rows.length === 0) return null;

  const bumps: UpgradePlan['bumps'] = [];
  let longBumpApplied = 0;
  let weeklyBumpApplied = 0;

  // 1) Long bump · +1mi capped at tier upper.
  const longRow = rows.find((r) => r.type === 'long');
  if (longRow) {
    const old = Number(longRow.distance_mi);
    const proposed = old + MAX_LONG_BUMP_MI;
    const capped = Math.min(proposed, opp.tierLongUpper);
    if (capped > old) {
      bumps.push({ workoutId: longRow.id, oldDistanceMi: old, newDistanceMi: capped, type: 'long' });
      longBumpApplied = capped - old;
    }
  }

  // 2) Easy bumps · distribute up to (MAX_WEEKLY_BUMP_MI - longBumpApplied)
  //    across easy days. Per-easy cap = MAX_PER_EASY_BUMP_MI.
  const easyBudgetMi = MAX_WEEKLY_BUMP_MI - longBumpApplied;
  if (easyBudgetMi > 0) {
    const easyRows = rows.filter((r) => r.type === 'easy' || r.type === 'recovery');
    let remaining = easyBudgetMi;
    for (const r of easyRows) {
      if (remaining <= 0) break;
      const add = Math.min(MAX_PER_EASY_BUMP_MI, remaining);
      const old = Number(r.distance_mi);
      const newDist = Number((old + add).toFixed(1));
      bumps.push({ workoutId: r.id, oldDistanceMi: old, newDistanceMi: newDist, type: r.type });
      remaining -= add;
      weeklyBumpApplied += add;
    }
  }

  if (bumps.length === 0) return null;

  return {
    bumps,
    longBumpMi: longBumpApplied,
    weeklyBumpMi: longBumpApplied + weeklyBumpApplied,
    reason: opp.reason,
  };
}

/** Back-compat alias · the old name still works for the test bench. */
export const planBump = planUpgrade;

// ── helpers ────────────────────────────────────────────────────────────

/**
 * The upper edge of the plan's own tier band, off `training_plans
 * .authored_state`.
 *
 * EXPORTED 2026-08-31 so the Adaptation Engine's loader
 * (`lib/adaptation/load-adaptation-engine.ts`) reads the ceiling through this
 * function rather than re-typing the `authored_state` key lookup. Rule 16: two
 * readers of one band is two chances to disagree about where a runner's
 * ceiling is, and this one already knows the pre-tier-system case.
 */
export function readTierUpper(
  authoredState: Record<string, unknown>,
  key: 'tier_peak_weekly_band' | 'tier_peak_long_band',
): number {
  const band = authoredState[key];
  if (Array.isArray(band) && band.length === 2) {
    return Number(band[1]);
  }
  // Old plans (pre-tier-system) won't have these bands. Returning 0
  // means planBump's "newDist <= oldDist" check fires · no bump
  // applied. Safer than guessing a tier ceiling that might be wrong.
  return 0;
}

/**
 * Build the `mark_upgrade` AdaptationAction for the canonical applyAdaptations
 * path. Returns null when no opportunity exists or no rows to bump.
 * Caller's pattern · `actions.push(...)` next to the other adapter
 * triggers, then `applyAdaptations(userId, actions)`.
 */
export async function actionForAdaptiveRamp(
  userId: string,
): Promise<{
  kind: 'mark_upgrade';
  bumps: Array<{ workoutId: string; newDistanceMi: number }>;
  longBumpMi: number;
  weeklyBumpMi: number;
  why: string;
} | null> {
  const opp = await detectGreenRampOpportunity(userId);
  if (!opp) return null;
  const upgrade = await planUpgrade(opp);
  if (!upgrade) return null;
  return {
    kind: 'mark_upgrade',
    bumps: upgrade.bumps.map((b) => ({ workoutId: b.workoutId, newDistanceMi: b.newDistanceMi })),
    longBumpMi: upgrade.longBumpMi,
    weeklyBumpMi: upgrade.weeklyBumpMi,
    why: opp.reason,
  };
}

/**
 * 2026-08-28 · PULL-DOWN / PUSH-UP GUARD WINDOW.
 *
 * The same-tick check (`pullbackApplied`) only knew about pull-backs applied
 * in THIS cron pass — a red-readiness downgrade applied Monday did not stop a
 * volume bump Tuesday. Doctrine spaces hard stimulus from recovery in DAYS,
 * not ticks: Research/00b-recovery-protocols.md §"The Hard-Easy Principle" —
 * "hard day → 1–2 easy/recovery/rest days → next hard day" — and a bump the
 * morning after a pull-back is the engine adding load into the exact window
 * the pull-back opened for recovery. So: no upward bump within 48 hours of
 * any APPLIED pull-back action.
 *
 * The evidence is the adapter's own coach_intents records — the downgrade and
 * shave intents `applyAdaptations` writes in the same transaction as the
 * mutation, plus the red-convergence record-only note for a red morning that
 * found nothing to soften (still a red morning). No new state.
 */
export const PULLBACK_BUMP_LOOKBACK_HOURS = 48;

/** The intent reasons that count as an applied pull-back / red-readiness
 *  morning. `plan_adapt_downgrade` covers readiness-red, niggle, gap and
 *  missed-workout anti-stacking downgrades; `plan_adapt_shave` covers volume
 *  and comeback shaves.
 *
 *  DIRECTION-1 (2026-08-29) · `readiness_convergence_red_proposed` is the
 *  fourth, and it exists because pull-backs stopped applying unattended. The
 *  owner's rule is that load may rise unattended but may never fall
 *  unattended, so a convergent-red morning now PROPOSES its downgrade — which
 *  means the applied-downgrade row this guard used to key on is no longer
 *  written on exactly the mornings the guard matters most. The engine records
 *  the red verdict separately (a record-only note, no plan row touched) and
 *  this list reads it, so "we judged you red but you have not answered yet"
 *  still blocks a ramp. A guard that only notices pull-backs the runner
 *  accepted would wave load through on every unanswered one. */
export const PULLBACK_INTENT_REASONS = [
  'plan_adapt_downgrade',
  'plan_adapt_shave',
  'readiness_convergence_red_no_quality',
  'readiness_convergence_red_proposed',
] as const;

/**
 * Pure window predicate, exported for tests: does a pull-back at
 * `pullbackTsISO` block a bump decided at `nowMs`? An unparseable timestamp
 * blocks — a guard that cannot read its own evidence must not wave a load
 * increase through.
 */
export function pullbackBlocksBump(
  pullbackTsISO: string | null | undefined,
  nowMs: number,
  lookbackHours: number = PULLBACK_BUMP_LOOKBACK_HOURS,
): boolean {
  if (pullbackTsISO == null) return false;
  const t = new Date(pullbackTsISO).getTime();
  if (!Number.isFinite(t)) return true;
  return nowMs - t < lookbackHours * 3_600_000;
}

/**
 * Most recent applied pull-back intent inside a 7-day read window (wide
 * enough for any lookback this file will ever use). `null` ts = none on
 * record; `failed: true` = the read itself failed, which is its own state —
 * the caller fails CLOSED, same posture as every other gate in this file.
 */
async function recentPullbackTs(
  userId: string,
): Promise<{ failed: boolean; ts: string | null }> {
  const row = await rowOrNull<{ ts: string | null }>(
    'plan/adaptive-ramp · pull-back lookback',
    pool.query<{ ts: string | null }>(
      `SELECT MAX(ts)::text AS ts FROM coach_intents
        WHERE COALESCE(user_uuid, user_id) = $1::uuid
          AND reason = ANY($2::text[])
          AND ts >= NOW() - interval '7 days'`,
      [userId, [...PULLBACK_INTENT_REASONS]],
    ),
  );
  if (row === null) return { failed: true, ts: null };
  return { failed: false, ts: row?.ts ?? null };
}

/**
 * Cron-path orchestrator · run after detectAdaptations + applyAdaptations.
 * Skips bump when pull-back actions fired this tick OR within the last
 * 48 hours (see PULLBACK_BUMP_LOOKBACK_HOURS) · we don't push up while a
 * pull-down is still buying recovery. Calls applyAdaptations with the
 * mark_upgrade action so all mutations + intent logging go through
 * one canonical path.
 *
 * Returns the upgrade summary or null.
 */
export async function tryAdaptiveBump(
  userId: string,
  pullbackApplied: boolean,
): Promise<{ bumps: number; longBumpMi: number; weeklyBumpMi: number; why: string } | null> {
  if (pullbackApplied) return null;
  // 48h lookback · a pull-back applied on an EARLIER tick still blocks.
  // Fails closed: an unreadable intents table is not "no recent pull-back".
  const pullback = await recentPullbackTs(userId);
  if (pullback.failed || pullbackBlocksBump(pullback.ts, Date.now())) {
    if (!pullback.failed) {
      console.log(
        `[adaptive-ramp] bump blocked · pull-back within ${PULLBACK_BUMP_LOOKBACK_HOURS}h `
        + `(last at ${pullback.ts}) · user=${userId.slice(0, 8)}`,
      );
    }
    return null;
  }
  const action = await actionForAdaptiveRamp(userId);
  if (!action) return null;
  const { applyAdaptations } = await import('./adapt');
  /* ── BUMP-LANDED-1 (2026-08-30) · REPORT WHAT LANDED, NOT WHAT WAS ASKED FOR
   *
   * This discarded the return value. `applyAdaptations` runs inside
   * `mutatePlan`, which validates the resulting week and ROLLS THE WHOLE BATCH
   * BACK when it introduces a violation — returning 0 touched, deliberately, so
   * the cron survives to serve the next runner. The bump then reported its
   * summary anyway.
   *
   * Observed on the owner's real block the first time the ramp ever fired: the
   * batch was refused (taper too shallow, T-pace dosing 23.8% against a 10%
   * cap), the plan was byte-identical afterwards, zero `plan_adapt_upgrade`
   * intents were written — and the cron logged a bump, busted the briefing
   * cache, and told the runner nothing had gone wrong.
   *
   * A PUSH THAT REPORTS SUCCESS AND DID NOT HAPPEN IS WORSE THAN NO PUSH,
   * because it defeats every downstream check that looks for one: the cooldown
   * that reads the intent, the visibility surface that renders it, and any
   * harness asserting the plan moved. Rule 11 in the write direction — "it was
   * refused" and "it landed" became one value.
   *
   * `touched` counts rows the pass actually changed. Zero means nothing landed,
   * whether refused by the boundary or filtered as sealed, and either way there
   * is no bump to report. */
  const touched = await applyAdaptations(userId, [{
    kind: 'mark_upgrade',
    bumps: action.bumps,
    why: action.why,
  }]);
  if (touched <= 0) {
    console.warn(
      `[adaptive-ramp] bump did NOT land · user=${userId.slice(0, 8)} · `
      + `${action.bumps.length} row(s) proposed, 0 changed — the mutation boundary refused the `
      + 'batch or every target was sealed. Reporting no bump.',
    );
    return null;
  }
  return {
    bumps: touched,
    longBumpMi: action.longBumpMi,
    weeklyBumpMi: action.weeklyBumpMi,
    why: action.why,
  };
}

function composeReason(signals: RampSignals): string {
  const bits: string[] = [];
  if (signals.readinessGreen) bits.push('readiness green');
  if (signals.lastQualityOnPace) bits.push('quality on pace');
  if (signals.lastLongClean && signals.details.lastLongDecouplingPct != null) {
    bits.push(`long ${signals.details.lastLongDecouplingPct.toFixed(1)}% decoupling`);
  }
  if (signals.belowTierUpper) {
    bits.push(`${signals.details.peakHeadroomMi}mi headroom to tier upper`);
  }
  return `Adaptive bump · ${bits.join(' · ')}.`;
}
