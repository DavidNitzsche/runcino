/**
 * POST /api/cron/run-adaptations  (P38)
 *
 * Daily adaptation pass — detects triggers (training gap, missed key
 * workout, volume overshoot, PR bank, goal change, field test, progression
 * gate, fitness regression, training lead) and routes them.
 * Idempotent.
 *
 * ── 2026-09-02 · THIS JOB NO LONGER CHANGES THE PLAN ─────────────────────
 *
 * It detects, it proposes, and it records. It does not apply. Every
 * plan-mutating action goes through `sealAutomaticActions`
 * (lib/plan/adaptation-authority.ts — THE ONE SEAM, default off) and comes
 * out either as a card the runner accepts or as a record-only
 * `coach_intents` note. `applyAdaptations` is still called, with a
 * note-only batch, because it is the canonical intent writer; with no
 * plan-mutating action in the batch it performs no plan write.
 *
 * The header below still describes the apply-now / propose-first split as
 * it was. It is kept because the reasoning is the history of how the lane
 * was narrowed — but read it as archaeology: the apply-now lane is closed.
 *
 * Auth: CRON_SECRET.
 *
 * Schedule: 03:00 UTC = 20:00 PT the previous evening, per
 * .github/workflows/run-adaptations.yml (`cron: '0 3 * * *'`). That file
 * is the only schedule that exists — this comment does not set it, and
 * for a while it disagreed with it.
 *
 * 2026-08-17 · this header used to claim 07:15 UTC "between briefing cron
 * at 07:05 and weather cron at 07:30". The cron was moved to 03:00 on
 * 2026-06-04 (David: "I dont want to wake up to change runs · that was
 * annoying") so proposals land on Today the evening BEFORE, and the
 * comment was never updated. Every ordering claim it made was false.
 *
 * The ordering INTENT still holds, and with more room than the stale
 * comment claimed. Adaptation must land before the morning briefing
 * reads the plan, so the coach sees the adapted state:
 *
 *   03:00 UTC  run-adaptations     (this route)
 *   07:05 UTC  refresh-briefings   (+4h05m — the constraint that matters)
 *   07:30 UTC  enrich-weather
 *   08:15 UTC  readiness-snapshot
 *
 * If this cron is ever rescheduled, check it against refresh-briefings
 * (`.github/workflows/refresh-briefings.yml`) — a briefing composed off
 * an un-adapted plan tells the runner to do a workout the engine has
 * already changed.
 *
 * Runs over all active users (training_plans with archived_iso IS NULL).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { detectAdaptations, applyAdaptations, reducesLoad, PROPOSE_FIRST_TRIGGERS } from '@/lib/plan/adapt';
import { sealAutomaticActions, ADAPTATION_SEAM_ID } from '@/lib/plan/adaptation-authority';
import { tryAdaptiveBump } from '@/lib/plan/adaptive-ramp';
// VOLUMESEAM-1 · the demonstrated-volume-evidence lane. Proposal only.
import { runVolumeEvidenceLane } from '@/lib/plan/volume-evidence-proposal';
import { runActionProposalLane } from '@/lib/plan/action-proposal-lane';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { raiseAlert } from '@/lib/ops/alerts';
import { recordCronSuccess } from '@/lib/ops/cron-ledger';
import { runAndPersistPaceShadowCompare } from '@/lib/adaptation/shadow-compare';
import { shadowExit, summarisePass, type ShadowExit } from '@/lib/adaptation/canonical-shadow/shadow-exit';
// ARBITRATIONWIRE-1 (2026-09-05) · type only, for the aggregate below. The
// function itself (`persistArbitratedProposals`) is never called from this
// route directly — it runs inside `runAndPersistCanonicalShadowEvaluation`,
// dynamically imported a few lines down, on the same real evidence that call
// already builds. This route only reports what it did.
import type { ArbitratedProposalOutcome } from '@/lib/adaptation/canonical-shadow/live-arbitration-proposals';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  if (auth.replace(/^Bearer\s+/i, '').trim() !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let userIds: string[] = [];
  try {
    userIds = (await pool.query(
      `SELECT DISTINCT user_uuid::text AS uid FROM training_plans
        WHERE archived_iso IS NULL AND user_uuid IS NOT NULL`,
    )).rows.map((r: any) => r.uid);
  } catch (e: any) {
    return NextResponse.json({ error: 'failed to list users', detail: e.message }, { status: 500 });
  }

  /* ── LEDGER-1 (2026-09-05) · ONE PASS OVER THE DURABLE REASSESSMENT SCHEDULE
   *
   * Every promise the engine made to look at something again — a deferred
   * progression, an earning gate, a post-race recovery check, an unanswered
   * proposal — lives in `reassessment_schedule` and is swept here.
   *
   * IT IS NOT A NEW CRON, AND THAT IS THE POINT (Rule 23). `lib/ops/cron-ledger.ts`
   * already registers this route, already due-gates it and already raises
   * `cron_stale` when it stops completing, and its own EXCLUDED_FROM_TICK list
   * gives the argument in one line: "another schedule is another thing that can
   * silently stop firing." A second cron for the sweep would be a second thing
   * to notice going quiet.
   *
   * It runs ONCE, across every runner, before the per-user loop, because
   * due-ness is a property of a date and not of a runner — putting it inside
   * the loop would re-read the same due set once per account.
   *
   * Lateness is harmless: the sweep compares dates, so the twelve-hours-late
   * run this repo's GitHub cron actually produces does exactly what the on-time
   * run would have done.
   *
   * Contained: a scheduler failure must never stop the adaptation pass, and its
   * refusal is REPORTED rather than swallowed — `refusal` non-null means
   * nothing was attempted, which an operator must be able to tell apart from a
   * sweep that found nothing to do (Rule 11). */
  const todayISO = new Date().toISOString().slice(0, 10);
  let reassessmentSweep: unknown = null;
  try {
    const { sweepReassessments } = await import('@/lib/ops/reassessment-scheduler');
    reassessmentSweep = await sweepReassessments(todayISO);
  } catch (e) {
    reassessmentSweep = {
      refusal: 'threw',
      detail: `the reassessment sweep threw and was contained: ${e instanceof Error ? e.message : String(e)}`,
    };
    console.error('[cron/run-adaptations] reassessment sweep threw ·', e);
  }

  /* SHADOWOBS-1 · one entry per athlete the loop reaches, summarised once
   * after the loop. Declared here rather than inside the loop so a pass that
   * reaches ZERO athletes still produces a verdict — `summarisePass([])` is
   * an `error`, because a loop that looked at nothing is indistinguishable
   * from a healthy quiet night in every previous version of this reporting,
   * and that is the exact liveness failure Rule 18 names. */
  const canonicalShadowExits: ShadowExit[] = [];
  /* ── DEFERRALCARRYALERT-1 (2026-09-06) · ONE ENTRY PER RUNNER PER PASS ────
   * `run-live-shadow-evaluation.ts`'s own header explains the gap this
   * closes: `canonicalShadow.deferrals` (the durable deferral queue's carry
   * outcome for this boundary) was computed, returned, and never read by
   * anything — a `carryTheQueue` failure was an honest sentence with no
   * reader, the exact shape `shadow-exit.ts` exists to prevent for the
   * SIBLING mechanism one line above this one. Same "accumulate and report
   * once" posture as `canonicalShadowExits`, kept as its own alert
   * (`deferral_queue_carry`) rather than folded into `canonical_shadow_exit`
   * — a different table, a different failure surface, one quantity one name. */
  const deferralCarryOutcomes: Array<{ uid: string; health: 'OK' | 'EXPECTED' | 'DEFECT'; detail: string }> = [];
  /* ── ORCHESTRATIONWIRE-1 (2026-09-06) · ONE ENTRY PER RUNNER PER PASS ──────
   * Same "accumulate and report once" shape as `canonicalShadowExits` right
   * above, and for the same Rule 23 reason: a refusal on every runner every
   * night must be visible to something other than a per-runner console.warn
   * nobody is tailing at 3am. */
  const beliefStoreOutcomes: Array<
    | { uid: string; ok: true; written: number }
    | { uid: string; ok: false; reason: 'absent' | 'probe_failed' | 'threw'; detail?: string }
  > = [];
  /* ── ARBITRATIONWIRE-1 (2026-09-05) · ONE ENTRY PER LEVER ARBITRATION HAD
   * an opinion about, across the whole pass. This is the observable half of
   * step 9 becoming WIRED: `resolveArbitrationPriority`'s answer no longer
   * only reaches `canonical_adaptation_shadow_log` — every winner it lets
   * through this cycle, every SUPPORTED lever it defers, and every push
   * Safety defeats outright is counted here too. See
   * `live-arbitration-proposals.ts` for what each kind means. */
  const arbitrationOutcomes: ArbitratedProposalOutcome[] = [];

  const results: Array<{
    user_id: string; triggers: number; applied: number; proposed: number;
    /** 2026-09-02 · plan-mutating actions the adaptation seam refused and
     *  recorded as observational notes instead. Reported per runner because
     *  "the engine judged something and was not allowed to act" is a fact the
     *  operator needs, and a silent zero would read the same as "the engine
     *  judged nothing" (Rule 11). */
    sealed_recorded?: number;
    /** 2026-08-24 · a session-moved push was enqueued for this runner because
     *  the day they wake into genuinely reads differently after the pass. */
    session_moved?: boolean;
    error?: string;
  }> = [];
  for (const uid of userIds) {
    let sessionMoved = false;
    try {
      // ── 2026-08-30 · THE RE-ANCHOR MOVED TO THE FRONT ────────────────────
      //
      // It used to sit near the BOTTOM of this loop, after `applyAdaptations`
      // and `tryAdaptiveBump`. That is an ordering assumption inside a single
      // job, and it is the same shape as the cross-job one this pass was
      // written to remove.
      //
      // `applyAdaptations` reaches `recompute-paces.ts`, which reads
      // `profile.lthr` RAW (`SELECT lthr FROM profile`, recompute-paces.ts:433)
      // and rewrites `workout_spec.hr_cap_bpm` and `lthr_bpm` on every future
      // unsealed day. So on the one night that matters — the night the anchor
      // actually moves — the recompute spent the OLD number and the re-anchor
      // landed afterwards, leaving the whole plan a full day behind the app's
      // own best estimate of the runner's threshold, with nothing saying so.
      // The owner's anchor moved 162 → 168 on 2026-08-30; under the old order
      // every cap this cron rewrote that night was 89% of 162.
      //
      // Nothing wanted it last. The only ordering constraint its own comment
      // stated was "BEFORE updateCoachLog so a move made this tick is available
      // for the log entry written in the same pass", and moving it to the front
      // preserves that with room to spare. Now every reader in this pass —
      // detector, adapter, ramp and log — sees the same anchor, and it is the
      // current one.
      //
      // Idempotent, cheap, and never throws: `action: 'none'` the moment the
      // anchor agrees with the evidence, a ±3 bpm noise floor so it cannot
      // churn on rounding, and its UPDATE guarded on the exact state it decided
      // against (lib/training/lthr-reanchor-store.ts).
      try {
        const { reanchorLthr } = await import('@/lib/training/lthr-reanchor-store');
        await reanchorLthr(uid);
      } catch { /* logged inside · non-fatal */ }

      const { triggers, actions } = await detectAdaptations(uid);

      // ── 2026-09-01 · PACE SHADOW-COMPARE (docs/PRODUCT_DECISIONS.md §2) ──
      //
      // Runs on every eligible cycle — this loop iterates every active plan,
      // which is exactly "eligible" for a runner-scoped daily pass. PACE-only,
      // read-only, never mutates: `runAndPersistPaceShadowCompare` calls
      // `resolveAdaptationProposals` and `detectAdaptations` (a detector, not
      // an applier) and persists the comparison — see
      // lib/adaptation/shadow-compare.ts's header for the zero-mutation
      // argument and the DDL-blocked persistence posture.
      //
      // Placed BEFORE `applyAdaptations` below on purpose: it re-derives
      // `detectAdaptations` internally (for standalone testability outside
      // this loop), and reading it before the live pass mutates anything
      // keeps both detections looking at the SAME pre-mutation plan state —
      // reading it after would compare the new engine's proposal against a
      // live signal computed off an already-adapted plan, which is not the
      // same cycle. Best-effort: never blocks the real adaptation pass.
      try {
        const shadow = await runAndPersistPaceShadowCompare(uid);
        if (shadow.error) {
          console.warn(`[shadow-compare] ${uid}: ${shadow.error}`);
        }
      } catch { /* logged inside · non-fatal, per the file's own contract */ }

      // ── CANONICAL ADAPTATION ENGINE · LIVE SHADOW EVALUATION ─────────────
      //
      // David: "Wire the canonical Adaptation Engine into live shadow
      // evaluation only... Keep live automatic mutation disabled." Reuses
      // THIS cron's existing daily cadence rather than a new schedule — Rule
      // 23: a second schedule is a second thing that can silently stop
      // firing, and there is no reason this evaluation needs to run on any
      // cadence other than the one the legacy and intermediate shadow passes
      // already use. Placed immediately after the pace shadow-compare call,
      // for the same reason that one sits before `applyAdaptations`: reading
      // it here means every shadow mechanism in this loop looks at the same
      // pre-mutation plan state.
      //
      // `runAndPersistCanonicalShadowEvaluation` is entirely read-only over
      // a SEPARATE, independently fenced connection
      // (`lib/adaptation/canonical-shadow/read-only-db.ts` —
      // `DATABASE_URL_RO` plus a statement allow-list) and its one write is
      // allow-listed to a single INSERT shape against
      // `canonical_adaptation_shadow_log`
      // (`lib/adaptation/canonical-shadow/shadow-log-writer.ts`). It does
      // not assume this cycle's LTHR re-anchor (above) or anything else has
      // already run — it reads the plan's CURRENTLY authored state itself
      // (Rule 23) — and it never throws: any failure is caught, logged, and
      // reported in its own result, exactly like the pace shadow-compare
      // call above it. Best-effort: never blocks the real adaptation pass.
      //
      // ── SHADOWOBS-1 (2026-09-05) · THE EXIT IS COLLECTED, NOT LOGGED ─────
      //
      // This block used to end at `console.warn`. Measured against production
      // on 2026-09-05: `canonical_adaptation_shadow_log` held THREE rows, all
      // written 2026-09-03 18:22 UTC by a hand-run of
      // `scripts/p0-proof/trigger-canonical-shadow-once.ts` on a laptop, while
      // `cron/run-adaptations` had twelve `cron_ok` rows and the PACE shadow
      // three lines above this one was writing fourteen rows a day. The cron
      // ran. This call ran. It returned `ran: false · DATABASE_URL_RO is not
      // configured` into a log buffer, four times a day, for two days, and
      // nothing could see it. Rule 23's third clause: a job that does not do
      // its work must be NOTICED.
      //
      // Every exit now carries a code and a health verdict (`shadow-exit.ts`).
      // They are accumulated across the whole pass and reported ONCE below,
      // after the loop, so a DEFECT raises an `ops_alerts` row and an honest
      // "this runner had nothing to say" does not. One alert per pass, not
      // one per runner — an alert nobody can skim is an alert nobody reads
      // (Rule 17).
      try {
        const { runAndPersistCanonicalShadowEvaluation } =
          await import('@/lib/adaptation/canonical-shadow/run-live-shadow-evaluation');
        const canonicalShadow = await runAndPersistCanonicalShadowEvaluation(uid);
        canonicalShadowExits.push(canonicalShadow.exit);
        // ARBITRATIONWIRE-1 · same call, the arbitration-facing half of its
        // result. Empty whenever nothing reached `decision === 'PROGRESS'`
        // this cycle, which is the common case and not a failure.
        arbitrationOutcomes.push(...canonicalShadow.arbitratedProposals);
        // DEFERRALCARRYALERT-1 · the durable deferral queue's own carry
        // outcome for this runner, accumulated the same way.
        deferralCarryOutcomes.push({
          uid, health: canonicalShadow.deferralsHealth, detail: canonicalShadow.deferrals,
        });
        if (canonicalShadow.exit.health === 'DEFECT') {
          console.warn(
            `[canonical-shadow] ${uid}: ${canonicalShadow.exit.code} · ${canonicalShadow.detail}`,
          );
        }
        if (canonicalShadow.deferralsHealth === 'DEFECT') {
          console.warn(`[canonical-shadow] ${uid}: deferral queue carry · ${canonicalShadow.deferrals}`);
        }
      } catch (e) {
        // Rule 11 · a throw from a function whose own contract says it never
        // throws is EVALUATION_ERROR, not "nothing happened". Recorded as an
        // exit so the pass verdict counts it, rather than vanishing into the
        // catch the way the RO-connection refusal did.
        const detail = `runAndPersistCanonicalShadowEvaluation threw: ${e instanceof Error ? e.message : String(e)}`;
        canonicalShadowExits.push(shadowExit('EVALUATION_ERROR', detail));
        // The throw happened somewhere inside the same call that would have
        // carried the deferral queue — whether the carry itself ran is
        // unknown, and Rule 11 forbids reading that as "nothing needed
        // doing". Recorded DEFECT, naming the same throw.
        deferralCarryOutcomes.push({ uid, health: 'DEFECT', detail });
        console.warn(`[canonical-shadow] ${uid} threw:`, e instanceof Error ? e.message : e);
      }

      // ── ORCHESTRATIONWIRE-1 (2026-09-06) · STEPS 1 & 5 · THE BELIEF STORE ──
      //
      // "Load canonical runner state" and "update beliefs" — `lib/brain/
      // orchestration/steps.ts` — reach production for the first time here.
      // Same placement logic as the two shadow mechanisms above: read/write
      // beliefs off the SAME pre-mutation plan state everything else in this
      // pass reads, and never block the real adaptation pass on it.
      //
      // Today this refuses on every single runner, every single pass: no
      // migration for `runner_beliefs` has been applied to production (see
      // `db/migrations/169_runner_beliefs.sql`, drafted and unapplied — DDL
      // needs David's per-statement go). That is not a reason to leave this
      // unwired — steps 12 and 16 are already declared WIRED in exactly this
      // state ("reachable and blocked on approval is a different state from
      // unwired"), and Rule 23 says a job proceeding as if a precondition
      // held would be the defect, not this refusal. `updateRunnerBeliefs`
      // throws `BeliefsTableUnavailable` rather than a raw SQL error
      // specifically so this catch can tell "waiting on approval" apart from
      // "something is actually broken" (Rule 11) without either one taking
      // the rest of this runner's pass down.
      try {
        const { updateRunnerBeliefs } = await import('@/lib/runner-state/store/orchestrator');
        const { pool: beliefPool } = await import('@/lib/db/pool');
        const todayISO = new Date().toISOString().slice(0, 10);
        const result = await updateRunnerBeliefs(beliefPool, uid, todayISO);
        beliefStoreOutcomes.push({ uid, ok: true, written: result.writtenBeliefIds.length });
      } catch (e) {
        const { BeliefsTableUnavailable } = await import('@/lib/runner-state/store/orchestrator');
        if (e instanceof BeliefsTableUnavailable) {
          beliefStoreOutcomes.push({ uid, ok: false, reason: e.reason });
        } else {
          beliefStoreOutcomes.push({
            uid, ok: false, reason: 'threw',
            detail: e instanceof Error ? e.message : String(e),
          });
          console.warn(`[belief-store] ${uid} threw:`, e instanceof Error ? e.message : e);
        }
      }

      // 2026-06-04 · split actions into APPLY-NOW vs PROPOSE-FIRST.
      // David's complaint: "I dont want to wake up to change runs ·
      // that was annoying." Readiness-pullback adaptations now write
      // a plan_workout_proposals row instead of mutating plan_workouts
      // directly. The runner sees a banner with [LET IT HAPPEN] /
      // [KEEP ORIGINAL] before the change lands.
      //
      // Apply-now — only what RAISES or preserves load:
      //   · sick_episode_active / injury_active · emit no plan actions at all
      //     (they write coach_proposals); listed so the reader is not
      //     surprised to see them absent from the propose-first set
      //   · pr_bank · runner ran a faster race, paces should update
      //   · goal_changed · runner edited their goal
      //   · progression_gate · raises a dose on an unrun session
      //
      // Propose-first (the runner gates it):
      //   · readiness_pullback, field_test_due, volume_overshoot,
      //     niggle_reported, missed_key_workout
      //     (PROPOSE_FIRST_TRIGGERS is the single authority · DIRECTION-1)
      //
      // ── DIRECTION-1 (2026-08-29) · THE FAST PATH IS GONE ──────────────────
      //
      // This used to compute `isProposeOnly` from the TRIGGER KINDS and, when
      // every trigger was propose-first, hand the whole action list to
      // `writeWorkoutProposals` without ever consulting
      // `partitionActionsForCron`. Two things were wrong with that, and the
      // second one silently defeated the first:
      //
      //   1. It decided routing from the trigger, never from the action. An
      //      action's own `forceApplyNow` was invisible on this path — the
      //      field's entire purpose, unreachable on exactly the nights
      //      readiness fired alone, which is the modal case.
      //   2. `writeWorkoutProposals` drops any action with no `workoutIds`
      //      (workout-proposals.ts) — so the record-only notes were not
      //      proposed AND not applied. They simply vanished, taking the
      //      `coach_intents` audit row with them, which is the row
      //      `tryAdaptiveBump` reads before raising load.
      //
      // One path now: partition per action, apply what may apply, propose the
      // rest. Under DIRECTION-1 `partitionActionsForCron` will not let a
      // load-reducing action through regardless of its flag, so routing every
      // night through here cannot resurrect the auto-pull-back this rule
      // exists to prevent — it only lets the notes reach the intents table.
      //
      // 2026-07-06 · P1-37 · actions do NOT correlate 1:1 with triggers
      // (missed_key_workout emits 2+N actions, sick/injury emit 0, pullback
      // emits 1-2) — the old triggers[i] index walk misrouted anti-stacking
      // downgrades into mislabeled readiness proposals that expired unseen
      // (live twice: Jul 1 + Jul 6 on David's plan). Partition on each
      // action's OWN sourceTrigger tag instead.
      //
      // ── 2026-09-02 · THE AUTOMATIC LANE IS SEALED ────────────────────────
      //
      // Everything above this line is the history of how the apply-now lane
      // was narrowed, one ruling at a time. It is now CLOSED, and by a single
      // switch rather than another rule about which trigger may do what.
      //
      // The owner: "too many independent levers can soften, reshape, re-phase,
      // refuse, or automatically mutate the plan." So no scheduled job changes
      // the live plan any more. `sealAutomaticActions`
      // (lib/plan/adaptation-authority.ts) is THE ONE SEAM, default off, and
      // it splits this pass three ways:
      //
      //   · apply    — RECORD-ONLY `note` actions. These write a coach_intents
      //                row and touch no plan row, so they are OBSERVATIONAL,
      //                which is the one thing the ruling explicitly allows to
      //                continue. `applyAdaptations` is still the writer
      //                because it is the canonical intent-logging path; with a
      //                note-only batch it performs no plan write at all.
      //   · propose  — the runner's card. Unchanged in kind from before; it
      //                now also carries the plan-mutating actions that used to
      //                apply unattended. Nothing lands until he taps accept.
      //   · recorded — actions the seam refused that CANNOT be proposed
      //                (no workoutIds for a card to point at: recompute_paces,
      //                mark_dirty, reshape, mark_upgrade). Converted to notes
      //                rather than dropped, under a DISTINCT intent reason
      //                (`plan_adapt_sealed`) so no downstream guard mistakes a
      //                refusal for work done — see that file's Rule 11 note
      //                about pace-anchor.ts's 24h deferral.
      //
      let applied = 0;
      let proposed = 0;
      let sealedRecorded = 0;
      {
        const { apply: applyNow, propose: proposeFirst, recorded } =
          sealAutomaticActions(actions);
        sealedRecorded = recorded.length;
        if (recorded.length > 0) {
          console.log(
            `[run-adaptations] ${ADAPTATION_SEAM_ID} refused ${recorded.length} `
            + `plan-mutating action(s) for ${uid.slice(0, 8)} · recorded as notes: `
            + recorded.map((a) => String(a.noteValue?.sealed_kind ?? '?')).join(', '),
          );
        }

        // 2026-08-24 · SESSION MOVED · the sender `renderSessionMoved` never
        // had. Photograph the day the runner wakes into, on BOTH sides of the
        // apply, and let the two labels decide. The owner's ruling is that it
        // fires "gated on the label genuinely differing, not on the adapter
        // merely having run", and a before/after diff is the only gate that
        // can honour that — `applyAdaptations` returns a row count, and
        // `AdaptationInfo.wasAdapted` compares against the plan AS AUTHORED
        // and so stays true long after the change stopped being news.
        //
        // Best-effort on both sides: a notification never fails an
        // adaptation pass, and a snapshot that could not be read simply
        // means no push (snapshotSession throws rather than reporting a
        // missing session, so a DB blip cannot masquerade as "it vanished").
        const moved = await import('@/lib/notifications/session-moved');
        const movedTarget = await moved.nextMorningTarget(uid).catch(() => null);
        const movedBefore = movedTarget
          ? await moved.snapshotSession(uid, movedTarget.dateIso).catch(() => undefined)
          : undefined;

        applied = await applyAdaptations(uid, applyNow, 'COACHING_ADAPTATION');

        if (movedTarget && movedBefore !== undefined) {
          try {
            const movedAfter = await moved.snapshotSession(uid, movedTarget.dateIso);
            const res = await moved.notifySessionMoved({
              userId: uid, target: movedTarget, before: movedBefore, after: movedAfter,
            });
            if (res.sent) sessionMoved = true;
          } catch { /* non-blocking · see above */ }
        }

        // The propose-first portion (if any) still gets proposed.
        if (proposeFirst.length > 0) {
          // 2026-09-02 · the propose lane is no longer exactly the
          // propose-first TRIGGERS: the seam pushes plan-mutating actions
          // into it from triggers that used to apply unattended (a
          // training_gap reschedule, for one). `writeWorkoutProposals` looks
          // up each action's own `sourceTrigger` for the card copy and falls
          // back to `triggers[0]`, so handing it only the propose-first
          // triggers would label a gap reschedule with an unrelated reason.
          // Pass every trigger that actually produced something in this lane,
          // plus the propose-first set so the fallback stays sane.
          const laneKinds = new Set(proposeFirst.map((a) => a.sourceTrigger));
          const proposeTriggers = triggers.filter(
            (t) => laneKinds.has(t.kind) || PROPOSE_FIRST_TRIGGERS.has(t.kind),
          );
          const { writeWorkoutProposals } = await import('@/lib/plan/workout-proposals');
          proposed = await writeWorkoutProposals(uid, proposeFirst, proposeTriggers);
        }
      }

      // 2026-06-03 · adaptive upward ramp · after pull-back triggers
      // are handled, check whether the runner is handling load well
      // enough to push the next long run +1mi (gated to tier upper).
      // Skip the bump when pull-back actions fired this tick · we
      // don't push up the same day we pulled down.
      //
      // DIRECTION-1 (2026-08-29) · the tick gate can no longer be `applied >
      // 0` alone. Pull-backs PROPOSE now, so on the very nights this guard is
      // for, nothing is applied and `applied` is 0 — the engine would decide
      // the runner needs easing and then raise his long run in the same pass.
      // The question the guard is actually asking is "did we judge a pull-back
      // warranted today", not "did one land", so it reads the decision:
      // any load-reducing action in the pass, whichever way it routed.
      const pullbackDecided = actions.some(reducesLoad);
      const bump = await tryAdaptiveBump(uid, applied > 0 || pullbackDecided).catch(() => null);
      if (bump) await bustBriefingCacheForEvent(uid, 'plan_swap');

      /* ── VOLUMESEAM-1 (2026-09-05) · THE VOLUME-EVIDENCE LANE GETS A LIVE
       * ENTRY POINT.
       *
       * `lib/adaptation/volume-evidence/` answers the one question nothing in
       * this app owned — if the runner runs MORE mileage than prescribed, does
       * future planned mileage increase — and until this line it answered it
       * for nobody. Nine modules, a doctrine registry entry, three gates, a
       * real-history replay, and not one production importer. This codebase's
       * signature failure, again: wired, tested and inert, on the UPWARD path,
       * where it is most damaging.
       *
       * It is a SEPARATE lane from `tryAdaptiveBump` above and not a
       * replacement for it, because the two read different evidence. The ramp
       * reads five signals and none of them is "he ran more than prescribed";
       * its ACWR clause actually runs the other way, since extra mileage
       * raises acute load and CLOSES the gate. This lane reads the surplus
       * itself, continuously.
       *
       * Same guard as the ramp, for the same reason: an offer of more work
       * must not go out on a night the engine judged a pull-back warranted.
       * `writeWorkoutProposals` dedupes against pending rows, so the two lanes
       * cannot stack two cards on one session.
       *
       * The seam stays shut. This writes a `plan_workout_proposals` row and
       * nothing else; the plan changes only if the runner accepts.
       *
       * Failure is contained inside `runVolumeEvidenceLane`, which names its
       * outcome in the log rather than returning a silent zero (Rule 11). */
      const volumeCards = (applied > 0 || pullbackDecided)
        ? 0
        : await runVolumeEvidenceLane(uid);
      if (volumeCards > 0) await bustBriefingCacheForEvent(uid, 'plan_swap');

      /* ── STEP16-1 (2026-09-06) · DID THE LAST DECISION WORK?
       *
       * The sixteenth orchestration step, and the one that did not exist. The
       * ledger records what was decided; nothing re-read a decision afterwards
       * to say whether it turned out to be right, so the engine could not tell
       * a change that helped from one that cost the runner a week.
       *
       * It measures and records. It tunes NOTHING — the owner's instruction is
       * explicit ("Do not automatically tune coefficients from this yet. Build
       * the measurement path"), and an engine that started moving its own
       * constants off a path nobody had audited would be a worse failure than
       * one that could not measure at all.
       *
       * While migrations 166 and 168 are unapplied this answers `table_absent`,
       * which is reported rather than counted as a clean sweep. */
      try {
        const [{ sweepDecisionOutcomes }, { observeAftermath }, { runnerToday: today16 }] =
          await Promise.all([
            import('@/lib/brain/ledger/outcome-sweep'),
            import('@/lib/brain/ledger/observe-aftermath'),
            import('@/lib/runtime/runner-tz'),
          ]);
        const swept = await sweepDecisionOutcomes(await today16(uid), observeAftermath);
        if (swept.state === 'ok' && swept.evaluated > 0) {
          console.log(
            `[run-adaptations] judged ${swept.evaluated} past decision(s) · `
            + `${JSON.stringify(swept.byVerdict)}`,
          );
        } else if (swept.state !== 'ok') {
          console.log(`[run-adaptations] outcome sweep ${swept.state} · ${swept.why}`);
        }
      } catch (e) {
        console.error('[run-adaptations] outcome sweep threw:', e);
      }
      /* ── ACTIONCOMPLETE-2 (2026-09-05) · THE TWO KINDS NO WRITER COULD CARRY
       *
       * HOLD and SAFETY_STOP existed as fully-formed members of the action
       * union with a generator, a validator, a renderer, a ledger arm and a
       * watch effect each — and no path in production could put either in front
       * of anyone. `PROPOSABLE_KINDS` is a set of `AdaptationAction['kind']`,
       * and neither is a member of that TYPE: `AdaptationAction` is the
       * per-workout MUTATION vocabulary, and a hold and a stop are not
       * mutations. So `scripts/v5-roundtrip-seed.ts` wrote them by hand, said
       * so in its own header, and that was the only way either had ever been
       * seen.
       *
       * `runActionProposalLane` is the live half. It re-detects nothing: the
       * safety verdict comes from `resolveSafety`, the app's one canonical
       * safety owner, and the hold comes from the SAME `actions` array this
       * pass already holds. The seam is untouched — both kinds are RECORD_ONLY
       * at the executor, so accepting one writes no plan row by design.
       *
       * NOT guarded on `pullbackDecided`, unlike the two lanes above, and the
       * asymmetry is the point: those offer MORE WORK and must not go out on a
       * night the engine judged easing warranted. A stop is the opposite of
       * more work, and a hold is the engine declining to change anything.
       * Suppressing a safety card because a shave was proposed the same evening
       * would be the guard firing in exactly the case it exists to protect. */
      const { runnerToday: actionLaneToday } = await import('@/lib/runtime/runner-tz');
      const actionLane = await runActionProposalLane(uid, await actionLaneToday(uid), actions)
        .catch((e: unknown) => {
          console.error('[run-adaptations] action-proposal lane threw:', e);
          return null;
        });
      if (actionLane === null) {
        /* Rule 11 · a lane that threw is not a lane that found nothing. Said
         * out loud so "no hold card tonight" can be told from "the lane
         * never ran". */
        console.error(`[run-adaptations] ${uid}: the action-proposal lane did not complete`);
      } else if (actionLane.withheld.length > 0) {
        console.log(
          `[run-adaptations] ${uid}: action lane raised ${actionLane.raised} · withheld `
          + actionLane.withheld.join(' | '),
        );
      }
      if ((actionLane?.raised ?? 0) > 0) await bustBriefingCacheForEvent(uid, 'plan_swap');

      /* ── LIVESEQ-1 (2026-09-05) · THE SEQUENCE GATE GETS A LIVE ENTRY POINT
       *
       * Every check above this line samples the plan at POINTS — is this day
       * legal, is this week legal. The adjudication layer was written because
       * an outside review found sequence-level problems that survive exactly
       * that: an engine can quote the right doctrine on every individual
       * session and still assemble an incoherent order. And then the layer had
       * no caller, which the orphan registry recorded honestly — making it the
       * largest instance of this codebase's signature failure, wired and
       * tested and inert.
       *
       * This runs it on the real block. It reads, and it can propose; it holds
       * no reference to any plan writer. One finding of the eleven
       * `checkPromotion` grades is spent here — the one-stressor-at-a-time
       * rule — and saying "the adjudicator is wired" would be false while
       * "one of its findings now reaches the runner" is true.
       *
       * Failure is logged and swallowed DELIBERATELY, and this is the one
       * place that is right: a sequence finding is advisory, the rest of the
       * pass has already done the load-bearing work for this runner, and a
       * throw here would cost the whole nightly tick for every runner behind
       * him in the loop. */
      try {
        const [
          { loadPlannedWeeks, findSequenceFindings },
          { runnerToday },
          { boundaryDatesForWeek },
        ] = await Promise.all([
          import('@/lib/plan/adjudication/live-sequence'),
          import('@/lib/runtime/runner-tz'),
          import('@/lib/plan/adjudication/rolling-boundary'),
        ]);
        const seq = await loadPlannedWeeks(uid);
        if (!seq.ok) {
          console.log(`[run-adaptations] sequence gate refused · ${uid.slice(0, 8)} · ${seq.why}`);
        } else {
          const findings = findSequenceFindings(seq.weeks, await runnerToday(uid));
          for (const f of findings) {
            // Reported, not yet raised as a card. The fix a finding implies is
            // a real coaching decision — take a quality session out of a week
            // eleven weeks ahead — and it is not made automatically while the
            // seam is closed. What changes today is that it is SEEN.
            console.log(
              `[run-adaptations] SEQUENCE FINDING · ${uid.slice(0, 8)} · week ${f.weekStartISO} `
              + `adds ${(f.volumeStep * 100).toFixed(1)}% volume AND goes `
              + `${f.stressorsBefore} to ${f.stressorsAfter} stressors · `
              + `Research/00a one-at-a-time · the session it would name is `
              + `${f.targetDateISO} ${f.targetType}`,
            );
          }
          if (findings.length === 0) {
            console.log(`[run-adaptations] sequence gate clean · ${uid.slice(0, 8)} · `
              + `${seq.weeks.length} week(s) read`);
          }

          /* ── LIVESEQ-2 (2026-09-05) · THE THREE ROLLING BOUNDARIES
           *
           * The owner's ruling on the single 09-21 gate: "Do not use one
           * impossible gate." A gate on one date has to decide what a week
           * will cost using evidence that does not exist yet — how the
           * mid-week session was absorbed, and what the weekend race actually
           * turned out to be — so it must either guess or refuse.
           *
           * Three boundaries each decide with the evidence available AT that
           * moment, and each can only change what is still ahead of it. They
           * are scheduled for the NEXT upcoming week, every night,
           * idempotently: the key is the week plus the boundary, so a nightly
           * re-request yields one row each rather than one per tick.
           *
           * While migration 167 is unapplied every one of these answers
           * `table_absent`, which is reported rather than swallowed. That is
           * the honest state and it is visible. */
          const today = await runnerToday(uid);
          const upcoming = seq.weeks.find((w) => w.weekStartISO > today);
          if (upcoming) {
            const dates = boundaryDatesForWeek(upcoming);
            if (dates) {
              const { boundariesForWeek } = await import('@/lib/plan/adjudication/rolling-boundary');
              const { scheduleReassessment } = await import('@/lib/ops/reassessment-scheduler');
              const reqs = boundariesForWeek({
                userUuid: uid,
                planId: seq.planId,
                planVersion: seq.planVersion,
                weekStartISO: upcoming.weekStartISO,
                ...dates,
                todayISO: today,
              });
              for (const r of reqs) {
                const res = await scheduleReassessment(r);
                if (res.state !== 'ok') {
                  console.log(
                    `[run-adaptations] boundary ${r.reasonCode} for ${upcoming.weekStartISO} `
                    + `not scheduled · ${res.state} · ${res.why}`,
                  );
                }
              }
            }
          }
        }
      } catch (e) {
        console.error('[run-adaptations] sequence gate threw:', e);
      }

      // ── ROLLINGBOUNDARY-EVAL-1 (2026-09-06) · THE MISSING EVALUATOR HALF ──
      //
      // LIVESEQ-2 above schedules the three rolling boundaries every night
      // and stops — nothing anywhere re-asked one once it fell due, so the
      // schedule's promise was never kept. This is that missing re-ask: it
      // reads THIS runner's own due items (Rule 14 — scoped to `uid`, never
      // a global sweep from inside a per-runner loop), gathers complete
      // demand from real reads, and resolves each one. It never mutates a
      // plan and never touches AUTOMATIC_ADAPTATION_AUTHORITY — see
      // `rolling-boundary-evaluator.ts`'s own header for the full argument.
      // Own try/catch, matching the belief-store/canonical-shadow/pace-
      // shadow blocks elsewhere in this loop: a throw here costs only this
      // runner's rolling-boundary pass.
      try {
        const [{ evaluateDueRollingBoundariesForUser }, { runnerToday: todayForUser }] = await Promise.all([
          import('@/lib/plan/adjudication/rolling-boundary-evaluator'),
          import('@/lib/runtime/runner-tz'),
        ]);
        const today = await todayForUser(uid);
        await evaluateDueRollingBoundariesForUser(uid, today);
      } catch (e) {
        console.error('[run-adaptations] rolling-boundary evaluator threw:', e);
      }

      // 2026-08-30 · the LTHR re-anchor USED TO BE HERE, and this is the
      // reason it is not any more.
      //
      // Why it runs at all (unchanged): the race paths call `reanchorLthr` too,
      // but only when a result is WRITTEN. An anchor can go stale between
      // result writes — a race imported through a path that did not run the
      // chain, a priority edited from C to A after the fact, or months of
      // history that predate the fix. Running it daily means the anchor is
      // never more than one night behind the evidence.
      //
      // Why it moved: at this position `applyAdaptations` had already run, and
      // it reaches `recompute-paces.ts`, which reads `profile.lthr` raw and
      // rewrites every future `hr_cap_bpm`. See the block at the top of this
      // loop. `updateCoachLog` below still gets a move made this tick, which
      // was the only ordering this position was ever chosen for.
      //
      // 2026-08-17 · coach's log daily check (lib/coach/coach-log.ts).
      // Week-close / phase-boundary entries fire only on the boundary
      // morning; the longest-run-ever check is one indexed query.
      // Idempotent + best-effort — never blocks the adaptation pass.
      try {
        const { updateCoachLog } = await import('@/lib/coach/coach-log');
        await updateCoachLog(uid);
      } catch { /* logged inside · non-fatal */ }
      if (applied > 0) await bustBriefingCacheForEvent(uid, 'plan_swap');
      //
      // ── NOOPSTAMP-1 (2026-09-05) · THE NO-OP STAMP IS GONE ───────────────
      //
      // What stood here:
      //
      //   // Stamp last_adapted_at even when 0 actions applied — this is the
      //   // only cron-fire proof we have. Without it we can't distinguish
      //   // "cron never fired" from "cron fired but found nothing to do".
      //   if (applied === 0) {
      //     await pool.query(
      //       `UPDATE training_plans SET last_adapted_at = NOW()
      //         WHERE user_uuid = $1 AND archived_iso IS NULL`, [uid]);
      //   }
      //
      // The reasoning was sound and its premise has since become false.
      // `lib/ops/cron-ledger.ts` landed 2026-08-30 and `recordCronSuccess`
      // runs at the bottom of this very route, so "did the cron fire" is
      // answered by `ops_alerts` `kind='cron_ok'` — measured on production
      // 2026-09-05, twelve rows for `cron/run-adaptations`, twice daily,
      // 09-01 through 09-05. It is no longer "the only cron-fire proof we
      // have"; it is a second answer to a question that has an owner, which
      // is a Rule 16 violation, and the second answer is the destructive one.
      //
      // Destructive because `last_adapted_at` is not a log. It is half of
      // `planVersion` (`${id}:${last_adapted_at}`, `lib/plan/plan-version.ts`)
      // and five consumers read that as "the prescription changed":
      // `/api/v5/today`, `week-loader`, `plan-snapshot` (the watch),
      // `lib/brain/proposal/staleness.ts` — which marks a pending proposal
      // STALE the moment it moves — and `canonical/deferral-queue.ts`, which
      // expires a deferred progression with `PLAN_VERSION_CHANGED`. So this
      // statement retired every outstanding question the coach had asked the
      // runner, twice a day, on nights when the engine had decided nothing.
      //
      // Nothing replaces it here. `applyAdaptations` stamps when it actually
      // touches a workout, and the mutation boundary stamps on every other
      // real write. A pass that changed nothing now leaves the version alone,
      // which is what every one of those five consumers already assumed.
      results.push({
        user_id: uid, triggers: triggers.length, applied, proposed,
        sealed_recorded: sealedRecorded, session_moved: sessionMoved,
      });
    } catch (e: any) {
      results.push({ user_id: uid, triggers: 0, applied: 0, proposed: 0, error: e?.message ?? String(e) });
      await raiseAlert({
        kind: 'regen_fail',
        severity: 'warn',
        message: `Adaptation failed for ${uid}: ${e?.message}`,
        source: 'cron/run-adaptations',
      }).catch(() => {});
    }
  }
  const totalApplied = results.reduce((a, r) => a + r.applied, 0);
  const totalProposed = results.reduce((a, r) => a + r.proposed, 0);
  const totalSealed = results.reduce((a, r) => a + (r.sealed_recorded ?? 0), 0);

  /* ── SHADOWOBS-1 · THE CANONICAL SHADOW PASS REPORTS ITSELF ──────────────
   *
   * One row per PASS, not per runner, on the surface CLAUDE.md Rule 23 already
   * names for this. `severity` is decided by `summarisePass`, not here, so the
   * rule "a DEFECT is louder than an honest nothing" has exactly one owner
   * (Rule 16).
   *
   * WHY IT IS RAISED EVEN WHEN EVERYTHING IS FINE: `cron_ok` already proves
   * the ROUTE completed, and proved it every day while this mechanism wrote
   * nothing at all — so route-completion is not evidence about the mechanism.
   * This row is that evidence, and it carries the per-code histogram INCLUDING
   * the zeroes, because an absent key and a zero read the same to a human
   * skimming JSON and are not the same fact.
   *
   * Never blocks the pass. An alerting failure must not cost the adaptation
   * run, and `raiseAlert` already swallows its own insert error internally. */
  const canonicalShadowPass = summarisePass(canonicalShadowExits);
  await raiseAlert({
    kind: 'canonical_shadow_exit',
    severity: canonicalShadowPass.severity,
    message: canonicalShadowPass.message,
    metadata: {
      athletes: canonicalShadowPass.athletes,
      users_in_loop: userIds.length,
      by_code: canonicalShadowPass.byCode,
      defects: canonicalShadowPass.defects,
      records_persisted: canonicalShadowPass.recordsPersisted,
      // The remedy, carried to the alert rather than left in a source file
      // nobody reads at 3am. First DEFECT only — Rule 17, the reader reads a
      // sentence once, and every DEFECT of the same code has the same remedy.
      remedy: canonicalShadowExits.find((e) => e.health === 'DEFECT')?.remedy ?? null,
    },
    source: 'cron/run-adaptations',
  }).catch(() => {});
  /* ── DEFERRALCARRYALERT-1 (2026-09-06) · THE DEFERRAL QUEUE'S OWN CARRY
   *    OUTCOME REPORTS ITSELF, THE SAME WAY THE SHADOW LOG DOES ABOVE ──────
   *
   * Reported at INFO while migration 167 is unapplied (`EXPECTED` on every
   * runner is the declared state, not a defect — every call answers
   * `table_absent` honestly until then, exactly like the shadow log and
   * belief-store passes above), and raised as a real DEFECT the moment any
   * runner's queue could not be read or a persist genuinely threw. Never
   * blocks the pass. */
  const deferralDefects = deferralCarryOutcomes.filter((o) => o.health === 'DEFECT');
  const deferralExpected = deferralCarryOutcomes.filter((o) => o.health === 'EXPECTED').length;
  const deferralOk = deferralCarryOutcomes.filter((o) => o.health === 'OK').length;
  await raiseAlert({
    kind: 'deferral_queue_carry',
    severity: deferralDefects.length > 0 ? 'error' : 'info',
    message: deferralDefects.length > 0
      ? `${deferralDefects.length}/${userIds.length} runners' deferral queue carry FAILED this pass`
      : deferralOk > 0
        ? `${deferralOk}/${userIds.length} runners' deferral queue carried clean`
        : `reassessment_schedule unavailable for all ${userIds.length} runners — migration 167 `
          + 'unapplied (declared, expected state)',
    metadata: {
      users_in_loop: userIds.length,
      ok: deferralOk,
      expected_absent: deferralExpected,
      defects: deferralDefects.length,
      // First DEFECT only — Rule 17, the reader reads a sentence once.
      first_defect_detail: deferralDefects[0]?.detail ?? null,
    },
    source: 'cron/run-adaptations',
  }).catch(() => {});
  /* ORCHESTRATIONWIRE-1 · reported at INFO while the migration is unapplied
   * (`absent` on every runner is the expected, declared state — not a
   * DEFECT), and raised as a real DEFECT the moment ANY runner sees `threw`,
   * which is the one outcome this mechanism's own contract says should never
   * happen. Never blocks the pass. */
  const beliefAbsent = beliefStoreOutcomes.filter((o) => !o.ok && o.reason === 'absent').length;
  const beliefWritten = beliefStoreOutcomes.filter((o) => o.ok).length;
  const beliefThrew = beliefStoreOutcomes.filter((o) => !o.ok && o.reason === 'threw');
  await raiseAlert({
    kind: 'belief_store_pass',
    severity: beliefThrew.length > 0 ? 'error' : 'info',
    message: beliefThrew.length > 0
      ? `${beliefThrew.length}/${userIds.length} runners threw updating beliefs (not the declared table_absent state)`
      : beliefWritten > 0
        ? `${beliefWritten}/${userIds.length} runners' beliefs updated`
        : `runner_beliefs unavailable for all ${userIds.length} runners — migration 169 unapplied (declared, expected state)`,
    metadata: {
      users_in_loop: userIds.length,
      written: beliefWritten,
      absent: beliefAbsent,
      threw: beliefThrew.length,
      threw_detail: beliefThrew.slice(0, 3).map((o) => ('detail' in o ? o.detail : undefined)),
    },
    source: 'cron/run-adaptations',
  }).catch(() => {});
  // 2026-08-30 · scheduler ledger (lib/ops/cron-ledger.ts). Stamped by the
  // ROUTE, not by whatever triggered it, so the GitHub workflow and the
  // in-process tick dedupe against each other instead of both firing this pass.
  await recordCronSuccess('run-adaptations', {
    users: userIds.length, applied: totalApplied, proposed: totalProposed,
    sealed_recorded: totalSealed,
    errors: results.filter((r) => r.error).length,
  });
  return NextResponse.json({
    ok: true,
    users: userIds.length,
    total_applied: totalApplied,
    total_proposed: totalProposed,
    total_sealed_recorded: totalSealed,
    adaptation_seam: { id: ADAPTATION_SEAM_ID, open: false },
    /* What one pass did to the durable reassessment schedule. Reported rather
     * than logged, because a sweep that REFUSED (the table is not applied on
     * this database, the read broke) and a sweep that found nothing due are the
     * same shape and opposite facts. */
    reassessment_sweep: reassessmentSweep,
    /* SHADOWOBS-1 · the same verdict in the response body, so an operator who
     * curls this route sees it without going to `ops_alerts`. */
    canonical_shadow: canonicalShadowPass,
    /* ── ARBITRATIONWIRE-1 · phase-aware arbitration's OUTPUT, this pass ────
     * Counted by kind rather than left as a raw array, so an operator sees
     * the shape without reading N rows: how many levers arbitration let
     * through and ledgered for real, how many SUPPORTED levers it deferred
     * onto the durable reassessment schedule instead of dropping, and how
     * many pushes Safety defeated outright with nothing scheduled to revisit
     * them. All three, plus the raw list, so a claim here is checkable. */
    arbitration: {
      winners: arbitrationOutcomes.filter((o) => o.kind === 'ARBITRATED_WINNER').length,
      deferred_supported_losers: arbitrationOutcomes.filter((o) => o.kind === 'DEFERRED_SUPPORTED_LOSER').length,
      safety_held_not_queued: arbitrationOutcomes.filter((o) => o.kind === 'SAFETY_HELD_NOT_QUEUED').length,
      not_applicable: arbitrationOutcomes.filter((o) => o.kind === 'NOT_APPLICABLE').length,
      outcomes: arbitrationOutcomes,
    },
    results,
    timestamp: new Date().toISOString(),
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/run-adaptations',
    auth: 'Authorization: Bearer <CRON_SECRET>',
    // Mirrors .github/workflows/run-adaptations.yml. Keep the two in step.
    schedule: '0 3 * * * UTC (20:00 PT, previous evening)',
  });
}
