/**
 * injury-builder · INJURY-mode plan generator.
 *
 * When `runner_injuries.resolved_date IS NULL`, the regular race-prep
 * plan is the wrong scaffold. This generator produces either a
 * return-to-run progression or, when the injury is a bone stress injury,
 * a no-running holding pattern gated on clinical clearance.
 *
 * STRENGTH-3 (2026-08-17) · the off-days no longer prescribe cross-training.
 * OFFLOAD-1 (2026-08-17) · an off-running week now NAMES what doctrine puts in
 * the gap, without prescribing it. See OFFLOAD_SUBSTITUTE_LINE.
 *
 * Invocation: triggered by coach_proposals.proposal_type='injury_adjust'
 * accept (Q-08 path). Caller already authoritatively decided the
 * runner is moving from race-prep into INJURY mode.
 *
 * INJURY-1 (2026-08-17) · what changed and why.
 *
 * The plan shape used to be a three-line ladder keyed on a severity
 * enum — minor 2 weeks, moderate 3, major 4 — with one generic walk-run
 * progression for every diagnosis. `injury.site` was read at :176 and
 * echoed into the phase rationale at :248 but never reached the
 * prescription. Three consequences, in order of harm:
 *
 *   1. Research/05:463 · "All confirmed BSIs: no running until clinical
 *      clearance." A suspected navicular stress fracture — an avascular
 *      site the research puts at 6+ weeks non-weight-bearing (:447) and
 *      4-9 months total return (:487) — was handed a walk-run plan on a
 *      three-week clock. Now every BSI protocol emits ZERO running rows
 *      and the plan carries a clearance gate instead of an end date.
 *   2. :475 low-risk BSI is "8-16 weeks typical"; the longest plan this
 *      builder could write was four. Length now comes from the site's
 *      own doctrine band (lib/plan/injury-protocols.ts), and severity
 *      moves within that band rather than defining it.
 *   3. :17 · "every other day during early stages (alternate-day rule)".
 *      The old placement took the earliest candidates in the week so it
 *      would "front-load sessions", producing four consecutive impact
 *      days. Impact days are now alternate-day through stage 7.
 *
 * Also corrected: the session copy said "Pain >= 4/10 = stop", a number
 * the research does not use. :42-45 is 0-2 green, 3-5 hold the stage,
 * 6+ stop.
 *
 * After the INJURY plan ends, the runner re-enters the regular
 * race-prep flow via /api/plan/generate against their next A race. A
 * clearance-gated plan does not "end" on its last row; the runner comes
 * back when a clinician says so.
 *
 * Cite: Research/05-injury-return-protocols.md §1 (walk-run scaffold,
 *       pain monitoring, cross-training vs rest), §§2-19 (per-site
 *       graded return), §9.2 (BSI risk stratification).
 */
import { pool } from '@/lib/db/pool';
import { randomBytes } from 'crypto';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { loadSettings } from '@/lib/coach/settings';
import {
  resolveInjuryProtocol,
  stageForWeek,
  stageSessionLabel,
  stageSessionNotes,
  doctrineWeeksLabel,
  ALTERNATE_DAY_THROUGH_STAGE,
  type ResolvedInjuryProtocol,
} from './injury-protocols';

// 0=Sun..6=Sat · same convention as plan_workouts.dow and generate.ts.
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const dowOf = (k: string): number => {
  const i = DAY_KEYS.indexOf(k as (typeof DAY_KEYS)[number]);
  return i >= 0 ? i : 6; // default Saturday rest (matches DEFAULT_SETTINGS.rest_day)
};

/**
 * Ceiling on non-fully-rest days inside an injury week (impact sessions
 * plus the monitored off-days between them). Research/05:69 gives no
 * explicit cap, so this is the conservative reading of "recovery is the
 * work": at least two full rest days a week while a runner is hurt. A
 * stated weekly_frequency below this still wins.
 */
const MAX_ACTIVE_DAYS_PER_WEEK = 5;

/** Walk-jog pace used to price the RUNNING minutes of a walk-run session. */
const WALK_RUN_MIN_PER_MI = 11;

/**
 * OFFLOAD-1 (2026-08-17) · what an off-running week says about the gap.
 *
 * `Research/05` does not treat time off running as time off training. :407
 * puts a bone stress injury 2-6 weeks off running and writes "Cross-train:
 * pool running, cycling, elliptical" in the same cell; :63 and :65 say the
 * same for soft tissue and low-risk BSI; :69 states the reason — deep-water
 * running "preserves VO2max and running-specific neuromuscular patterns" for
 * 4-6 weeks in trained runners. Non-impact aerobic work is not an optional
 * extra in these protocols. It is the SUBSTITUTE the offload is built around.
 *
 * faff removed cross-training from the product, so those days became plain
 * off-days and a 2-6 week layoff read as weeks of nothing. That is the app
 * silently omitting the thing doctrine put there to protect the runner.
 *
 * Ruled (2026-08-17): the plan NAMES the substitute and does not prescribe it.
 * No sessions, no durations, no doses, no tracking, no new session type.
 * Cross-training stays out of the product as a feature. This is one sentence
 * of context on a day that is already an off-day, so the runner knows the gap
 * has a name and is not being told what to do in it — they are under clinical
 * direction, and the copy says so.
 *
 * The modalities are deliberately NOT listed. "Non-impact aerobic work" is the
 * category; a list of options reads as a menu, and a menu is a prescription.
 */
const OFFLOAD_SUBSTITUTE_LINE =
  'Time off running is to unload the injury, not to lose the aerobic base. '
  + 'The research fills that gap with non-impact aerobic work. '
  + 'faff does not plan it, and your clinician decides what you are cleared for.';

export interface InjuryBuildInput {
  userId: string;
  injuryId: number;
}

export interface InjuryBuildResult {
  ok: boolean;
  plan_id?: string;
  weeks_generated?: number;
  reason?: string;
  /** True when the plan writes no running rows and waits on a clinician. */
  clearance_required?: boolean;
  protocol_key?: string;
}

function id(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

/**
 * #11 · the most-recent training-week start on-or-before `iso`, where the week
 * starts on `weekStartDow` (0=Sun..6=Sat). Mirrors generate.ts and the
 * /api/plan/week convention (weekStartDow = (longRunDow + 1) % 7). For David
 * (long=Sun → start=Mon) this is the most-recent Monday — identical to the old
 * mondayOf, a no-op.
 */
function weekStartBoundaryOf(iso: string, weekStartDow: number): string {
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay(); // 0=Sun..6=Sat
  const shift = -(((dow - weekStartDow) % 7 + 7) % 7);
  return addDays(iso, shift);
}

/**
 * Pick `n` items from `items` as evenly spaced as the list allows, so
 * active and rest days interleave instead of clustering at the front of
 * the week. Order-preserving, never returns duplicates.
 */
function spread<T>(items: readonly T[], n: number): T[] {
  const want = Math.max(0, Math.min(n, items.length));
  if (want === 0) return [];
  if (want === items.length) return [...items];
  const idx = new Set<number>();
  for (let i = 0; i < want; i++) {
    let k = Math.round((i * items.length) / want);
    while (k < items.length && idx.has(k)) k++;
    if (k >= items.length) k = items.findIndex((_, j) => !idx.has(j));
    idx.add(k);
  }
  return [...idx].sort((a, b) => a - b).map((k) => items[k]);
}

export interface DayShape {
  dow: number; // 0=Sun..6=Sat
  type: string;
  subLabel: string;
  notes: string;
  distance_mi: number;
}

/**
 * 7-day shape for one week of INJURY mode.
 *
 * Placement rules, all doctrine-sourced:
 *   · restDow is the runner's chosen rest day (loadSettings).
 *   · impact (walk-run) days are ALTERNATE-DAY through stage 7 ·
 *     Research/05:17. The off-days between them are labelled for what the
 *     doctrine wants them for: "the off-day is for tissue adaptation and
 *     pain monitoring".
 *   · impact-day COUNT comes from the stage's own sessions/wk column
 *     (:21-30), further capped by the runner's stated weekly_frequency.
 *   · a protocol with runStartWeek null (every BSI) produces NO rows of
 *     any running type in ANY week · Research/05:463.
 *
 * Pure and DB-free so the doctrine test can call it directly.
 */
export function injuryWeekShape(
  weekIdx: number,
  resolved: ResolvedInjuryProtocol,
  restDow: number,
  maxSessions: number | null,
): DayShape[] {
  const stage = stageForWeek(resolved, weekIdx);
  const activeCap = Math.min(maxSessions ?? MAX_ACTIVE_DAYS_PER_WEEK, MAX_ACTIVE_DAYS_PER_WEEK);

  // Candidate days, read from the day after the runner's rest day so the
  // alternating pattern starts fresh each week.
  const order: number[] = [];
  for (let i = 1; i <= 6; i++) order.push((restDow + i) % 7);

  const impactCap = stage
    ? Math.max(0, Math.min(stage.sessionsPerWk, activeCap))
    : 0;

  // Alternate-day pick: every other slot in `order`, which are calendar
  // days two apart. Only once the ladder is past its early stages
  // (:17 "during early stages") do we relax to a maximally-spread pick,
  // which is what lets stage 8 reach its four continuous-easy sessions.
  const impact: number[] = [];
  if (stage && stage.stage > ALTERNATE_DAY_THROUGH_STAGE) {
    impact.push(...spread(order, impactCap));
  } else {
    for (let i = 0; i < order.length && impact.length < impactCap; i += 2) impact.push(order[i]);
  }
  const impactSet = new Set(impact);

  // STRENGTH-3 (2026-08-17) · the off-days used to carry a prescribed
  // cross-training session (pool run / bike / elliptical, constrained by
  // risk class · Research/05:60-69). faff no longer prescribes non-running
  // work of any kind, so those days are now plain off-days. What the
  // doctrine wanted from them survives — Research/05:17 says the off-day
  // between impact sessions "is for tissue adaptation and pain
  // monitoring", and that is what the day is labelled as. The alternate-
  // day rule itself is unchanged: impact days are still spaced, and the
  // active-day cap still holds at least two full rest days a week.
  //
  // OFFLOAD-1 (2026-08-17) · that gap is now closed, and the ruling that
  // closed it is recorded on OFFLOAD_SUBSTITUTE_LINE above. The gap was: :65
  // and :69 make non-impact aerobic work the doctrine-mandated SUBSTITUTE
  // during an off-running block, and a clearance-gated BSI plan offered
  // nothing in its place, so a 2-6 week layoff read as weeks of nothing.
  // Ruled: the plan NAMES the substitute without prescribing it. Still no
  // sessions, no durations, no doses, no tracking, no new session type — the
  // week's SHAPE below is byte-for-byte what it was. Only the copy on a
  // no-running week changed.
  //
  // A week with no impact session at all — every clearance-gated week, and
  // the pre-`runStartWeek` weeks of a normal protocol — has no "off-day
  // between sessions" to space, so the check-in goes on every day but the
  // runner's rest day. That is not filler: the low-risk BSI gate is "five
  // consecutive days fully pain-free in daily activity", which is a DAILY
  // observation, and it is the only thing the runner can actually do
  // toward reopening the plan.
  const remaining = order.filter((dow) => !impactSet.has(dow));
  const monitorSet = new Set(
    stage ? spread(remaining, Math.max(0, activeCap - impactSet.size)) : remaining,
  );

  const days: DayShape[] = [];
  for (let dow = 0; dow < 7; dow++) {
    if (impactSet.has(dow) && stage) {
      days.push({
        dow,
        type: 'easy',
        subLabel: stageSessionLabel(stage),
        notes: stageSessionNotes(stage, resolved.protocol.riskClass),
        // Price the RUNNING minutes only. The old builder divided the
        // whole session (walk included) by a 12 min/mi pace, so stage 1 —
        // five minutes of jogging — was booked as 2.1 miles of running
        // load into every volume and ACWR reader downstream.
        distance_mi: Math.round((stage.totalRunMin / WALK_RUN_MIN_PER_MI) * 10) / 10,
      });
    } else if (monitorSet.has(dow)) {
      // The doctrine's own reason for this day, stated plainly. Not a
      // prescription — a check-in.
      //
      // OFFLOAD-1 · three cases, not two. `stage == null` means the week
      // carries NO running at all: every clearance-gated week, and the weeks
      // before `runStartWeek` on a normal protocol. Those are the offload, and
      // they are the weeks that name the substitute. A week that DOES have
      // walk-run sessions has a genuine off-day BETWEEN them, and :17 already
      // states what that day is for — it needs no other job.
      //
      // Splitting on `stage` also fixes copy that was simply wrong before a
      // ladder opens: the old non-clearance line said "note how the site felt
      // after the last session" on weeks where there had been no session.
      days.push({
        dow,
        type: 'rest',
        subLabel: 'OFF-DAY',
        notes: stage == null
          ? (resolved.clearanceRequired
              ? `Off running. Check the site today: pain at rest, pain walking, pain on the stairs. That is the signal you are tracking while it heals. ${OFFLOAD_SUBSTITUTE_LINE}`
              : `Off running. The walk-run ladder has not opened yet. Watch how the site behaves in ordinary walking. ${OFFLOAD_SUBSTITUTE_LINE}`)
          : 'Off running. This day is for tissue adaptation and pain monitoring. Note how the site felt after the last session before you load it again.',
        distance_mi: 0,
      });
    } else if (dow === restDow) {
      days.push({ dow, type: 'rest', subLabel: 'REST', notes: 'Off. Mobility if symptoms warrant.', distance_mi: 0 });
    } else {
      days.push({
        dow,
        type: 'rest',
        subLabel: 'REST',
        notes: resolved.clearanceRequired
          ? 'Off. Nothing to prove here. The bone heals on its own clock.'
          : 'Off. Recovery is the work in a return-to-run block.',
        distance_mi: 0,
      });
    }
  }
  return days;
}

/**
 * Build an INJURY-mode plan for the runner. Archives any active plan
 * then writes a new training_plans row with mode='injury-return'.
 */
export async function buildInjuryPlan(input: InjuryBuildInput): Promise<InjuryBuildResult> {
  const { userId, injuryId } = input;

  // Load the injury row. `site`, `notes` and `return_protocol` all feed
  // protocol resolution: the runner-facing picker offers nine coarse
  // body parts, so the word that changes the prescription ("navicular",
  // "stress reaction") usually arrives in the notes.
  const injury = (await pool.query(
    `SELECT id, site, severity, notes, start_date::text AS start_date, return_protocol
       FROM runner_injuries
      WHERE id = $1 AND user_uuid = $2 AND resolved_date IS NULL`,
    [injuryId, userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!injury) return { ok: false, reason: 'injury row not found or already resolved' };

  const severity = (injury.severity ?? 'moderate') as 'minor' | 'moderate' | 'major';

  // INJURY-1 · the whole prescription now hangs off site + risk class.
  const resolved = resolveInjuryProtocol({
    site: injury.site,
    notes: injury.notes,
    returnProtocol: injury.return_protocol,
    severity,
  });
  const totalWeeks = resolved.planWeeks;

  // #11 (audit 2026-06-16) · honor the runner's layout prefs, same as the race
  // generator (generate.ts) and seed-from-onboarding.
  //   · rest_day      → which day is REST (loadSettings defaults Saturday).
  //   · long_run_day  → the training-week boundary (week ENDS on it, starts the
  //                     day after), matching /api/plan/week so the injury week
  //                     lands in the WeekStrip window like every other plan.
  //   · weekly_frequency (profile) → caps ACTIVE days so an injured 3-day
  //                     runner isn't handed five sessions. NULL preserves the
  //                     conservative default (MAX_ACTIVE_DAYS_PER_WEEK).
  const prefs = await loadSettings(userId).catch(() => null);
  const restDow = dowOf(prefs?.rest_day ?? 'sat');
  const longRunDow = dowOf(prefs?.long_run_day ?? 'sun');
  const weekStartDow = (longRunDow + 1) % 7;  // day after the long run, per /api/plan/week
  const freqRow = (await pool.query<{ f: number | null }>(
    `SELECT weekly_frequency AS f FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] as Array<{ f: number | null }> }))).rows[0];
  const maxSessions = freqRow?.f != null && Number(freqRow.f) >= 3 && Number(freqRow.f) <= 7
    ? Number(freqRow.f) : null;

  // Archive any active plan for this user first.
  await pool.query(
    `UPDATE training_plans SET archived_iso = NOW()
      WHERE user_uuid = $1 AND archived_iso IS NULL`,
    [userId],
  ).catch(() => {});

  // Create the new INJURY plan.
  const planId = id('pln');
  const today = await runnerToday(userId);
  // Anchor week 0 at the runner's training-week boundary (day after long-run
  // day), not a hardcoded Monday — same convention as /api/plan/week + #10.
  const startMonday = weekStartBoundaryOf(today, weekStartDow);
  const goalISO = addDays(startMonday, totalWeeks * 7 - 1); // end-of-plan date
  const bandLabel = doctrineWeeksLabel(resolved.protocol);

  await pool.query(
    `INSERT INTO training_plans (id, user_id, user_uuid, mode, race_id, goal_iso, authored_state)
     VALUES ($1, 'me', $2, 'maintenance', NULL, $3, $4)`,
    [
      planId, userId, goalISO,
      JSON.stringify({
        mode_label: 'injury-return',
        injury_id: injuryId,
        injury_site: injury.site,
        severity,
        protocol: injury.return_protocol ?? null,
        total_weeks: totalWeeks,
        // INJURY-1 · the doctrine context the surfaces need so they can
        // stop showing a return DATE for a clearance-gated injury.
        protocol_key: resolved.protocol.key,
        protocol_label: resolved.protocol.label,
        risk_class: resolved.protocol.riskClass,
        clearance_required: resolved.clearanceRequired,
        clearance_gate: resolved.protocol.clearanceGate,
        doctrine_total_weeks: bandLabel,
        run_start_week: resolved.runStartWeek,
        matched_on: resolved.matchedOn,
        generated_at: new Date().toISOString(),
        citations: [
          resolved.protocol.citation,
          'Research/05-injury-return-protocols.md §1 General Principles',
        ],
      }),
    ],
  );

  // Phase. A clearance-gated plan is not a return-to-run progression and
  // should not be labelled as one · Research/05:463, :479.
  const phaseLabel = resolved.clearanceRequired ? 'CLINICAL-CLEARANCE' : 'INJURY-RETURN';
  const rationale = resolved.clearanceRequired
    // OFFLOAD-1 · this used to end "it does not prescribe anything to do
    // instead", which was accurate and was also the defect. The plan still
    // prescribes nothing; it now says what the gap is for.
    ? `${resolved.protocol.label}. No running until a clinician clears it. ${resolved.protocol.clearanceGate ?? ''} Doctrine total return ${bandLabel}. This plan holds the gate and tracks the days. It does not prescribe the non-impact aerobic work the research puts in the gap, and it does not pretend the gap is not there.`.trim()
    : `${resolved.protocol.label}. Walk-run ladder from week ${(resolved.runStartWeek ?? 0) + 1}, one stage a week, alternate days. Doctrine total return ${bandLabel}. Pain 0-2 carry on, 3-5 hold, 6 or more stop.`;
  const phaseId = id('phs');
  await pool.query(
    `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
     VALUES ($1, $2, $3, 0, $4, $5, $6)`,
    [phaseId, planId, phaseLabel, totalWeeks - 1, rationale, resolved.protocol.citation],
  );

  // Generate weeks + workouts.
  for (let wi = 0; wi < totalWeeks; wi++) {
    const weekId = id('wk');
    const weekStart = addDays(startMonday, wi * 7);
    const stage = stageForWeek(resolved, wi);
    const weekRationale = resolved.clearanceRequired
      ? `${phaseLabel} · week ${wi + 1} of ${totalWeeks} · no running, awaiting clearance`
      : stage
        ? `${phaseLabel} · week ${wi + 1} of ${totalWeeks} · walk-run stage ${stage.stage} of 8`
        : `${phaseLabel} · week ${wi + 1} of ${totalWeeks} · off running, monitoring the site`;
    await pool.query(
      `INSERT INTO plan_weeks (id, plan_id, week_idx, week_start_iso, phase_id, is_race_week, rationale)
       VALUES ($1, $2, $3, $4, $5, FALSE, $6)`,
      [weekId, planId, wi, weekStart, phaseId, weekRationale],
    );

    const days = injuryWeekShape(wi, resolved, restDow, maxSessions);
    for (const d of days) {
      if (d.distance_mi === 0 && d.type !== 'rest') continue;
      const wkoId = id('wko');
      // #11 · date offset is relative to the week's actual start weekday
      // (weekStartDow), not a hardcoded Monday, so each day lands on its true
      // calendar date in the boundary-anchored week (same as generate.ts persist).
      const dateISO = addDays(weekStart, ((d.dow - weekStartDow + 7) % 7));
      await pool.query(
        `INSERT INTO plan_workouts (id, plan_id, week_id, date_iso, dow, type, distance_mi,
                                    is_quality, is_long, notes, sub_label,
                                    original_date_iso, original_type, original_distance_mi, user_uuid)
         VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, FALSE, $8, $9, $4, $6, $7, $10)`,
        [wkoId, planId, weekId, dateISO, d.dow, d.type, d.distance_mi, d.notes, d.subLabel, userId],
      );
    }
  }

  // Plan mutation → invalidate memoized lookup so /today sees the new
  // INJURY plan immediately.
  (await import('./lookup')).bustPlanLookupCache(userId);

  return {
    ok: true,
    plan_id: planId,
    weeks_generated: totalWeeks,
    clearance_required: resolved.clearanceRequired,
    protocol_key: resolved.protocol.key,
  };
}
