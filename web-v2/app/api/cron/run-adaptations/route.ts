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
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { raiseAlert } from '@/lib/ops/alerts';
import { recordCronSuccess } from '@/lib/ops/cron-ledger';
import { runAndPersistPaceShadowCompare } from '@/lib/adaptation/shadow-compare';

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
      try {
        const { runAndPersistCanonicalShadowEvaluation } =
          await import('@/lib/adaptation/canonical-shadow/run-live-shadow-evaluation');
        const canonicalShadow = await runAndPersistCanonicalShadowEvaluation(uid);
        if (!canonicalShadow.ran) {
          console.warn(`[canonical-shadow] ${uid}: ${canonicalShadow.detail}`);
        }
      } catch (e) {
        console.warn(`[canonical-shadow] ${uid} threw:`, e instanceof Error ? e.message : e);
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

        applied = await applyAdaptations(uid, applyNow);

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
      // Stamp last_adapted_at even when 0 actions applied — this is the only
      // cron-fire proof we have. Without it we can't distinguish "cron never
      // fired" from "cron fired but found nothing to do". applyAdaptations
      // already stamps on the mutating path; this covers the no-op path.
      if (applied === 0) {
        await pool.query(
          `UPDATE training_plans SET last_adapted_at = NOW()
            WHERE user_uuid = $1 AND archived_iso IS NULL`,
          [uid],
        );
      }
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
