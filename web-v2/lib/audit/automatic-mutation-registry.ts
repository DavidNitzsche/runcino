/**
 * lib/audit/automatic-mutation-registry.ts · everything that changes a
 * runner's data without the runner asking, and what it is allowed to do.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INCIDENT
 *
 * 2026-08-25, 09:29:32 UTC. The `plan-drift` cron fired a `long_drift` signal
 * against the owner's post-race recovery block, ran `generatePlan`, archived
 * the two-week block he was in the middle of and authored a one-week block in
 * its place. His week went from 23 miles to 38. Nothing on any surface said it
 * had happened. He found out because the week counter reset and he asked why.
 *
 * The new number was RIGHT. That was never the point. The point is that he had
 * no way to know it had happened, no way to see what changed, and no way to
 * undo it — and that when he asked which job did it, the plan's own
 * `archive_reason` said `regenerated`, which is what it said for every rebuild
 * this app has ever performed, because the parameter had a default and no
 * caller.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS FOR
 *
 * Not documentation. A gate. `_automatic_mutations.test.ts` reads it and
 * refuses to pass when the code and this list disagree. Specifically it will
 * not let a new automatic writer exist without declaring itself, and it will
 * not let a new PLAN writer appear at all without someone writing down that
 * they added one.
 *
 * That last rule is the one with a body behind it. `snapshot-projections` is
 * named like a reporting job and reads like one. It calls `reanchorActivePlan`,
 * which rewrites `plan_workouts.pace_target_s_per_mi` and `workout_spec` for
 * every future unsealed day, daily, for every active runner. It was the third
 * automatic writer of the runner's plan and nobody had it on the list — it did
 * not turn up in the audit brief for this incident, which named the other two.
 * A registry that only records what someone remembered to record would have
 * missed it exactly the same way. So the gate derives the plan-writer set from
 * the source and compares.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FIVE QUESTIONS
 *
 * Every entry answers the same five, because they are the five that were not
 * asked before:
 *
 *   changes      · which tables, and can it overwrite something the RUNNER
 *                  authored or something the ENGINE already committed to —
 *                  as against only filling nulls and appending rows.
 *   trigger      · what fires it, and whether one real-world cause can fire
 *                  it twice.
 *   idempotent   · run it twice on the same day. Does anything double.
 *   onPartialFailure · the writes in order. Die after the first and what is
 *                  left: incomplete (fine) or INCOHERENT (not fine). The
 *                  `sick_recovery` shape is the canonical bad one — the insert
 *                  ran before the clearing update, so a failure left the runner
 *                  marked sick with their plan paused.
 *   runnerSees   · does the change reach a surface, and can it be undone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FORMAT CONTRACT
 *
 * One single-line quoted `id:` and one single-line quoted `route:` per entry,
 * so `scripts/check-automatic-mutations.sh` can verify the shape with sed and
 * grep on a cold container with no TypeScript toolchain. Same posture as
 * check-doctrine.sh and check-swallowed-failure.sh.
 */

/** What a writer can do to state the runner or the engine already owns. */
export type MutationReach =
  /** Fills nulls, appends rows, or writes a table only it owns. Cannot destroy
   *  a prior value. The safe tier. */
  | 'append_or_fill'
  /** Overwrites a value the ENGINE previously committed to — a prescribed
   *  pace, a stored ceiling, a derived snapshot. Recoverable only if the prior
   *  value is stored somewhere. */
  | 'overwrites_engine_state'
  /** Replaces a whole training block: archives the active plan and authors
   *  another. The heaviest thing any automatic path does. */
  | 'replaces_plan'
  /** Destroys a row, or acts outside the app (a Strava upload, a push). Not
   *  reversible by running the inverse. */
  | 'destructive_or_external';

/** Whether the runner can find out, on any surface, that this happened. */
export type Visibility =
  /** A card, banner, notification, or an obvious change to something they
   *  look at, on the surface they actually use. */
  | 'surfaced'
  /** A row exists that explains it, but no surface renders it. Answerable
   *  after the fact by someone who knows where to look. Not by the runner. */
  | 'audit_row_only'
  /** No row, no surface. The only evidence is a log line, or nothing. */
  | 'invisible';

export interface AutomaticMutation {
  /** Stable id. `cron/<name>`, `webhook/<name>`, `ingest/<name>`,
   *  `readpath/<name>`. Never a line number — those rot. */
  id: string;
  /** Source path relative to web-v2/, or the workflow file for a pure
   *  scheduler. Checked to exist. */
  route: string;
  /** UTC cron expression, or the event that fires it. */
  trigger: string;
  reach: MutationReach;
  /** Tables it writes. Plain names, for grep-ability. */
  changes: readonly string[];
  /** Twice in one day: does anything double? `false` needs the `note` to say
   *  what doubles and why that is currently tolerable. */
  idempotent: boolean;
  /** Writes in order, and what a mid-sequence death leaves behind. */
  onPartialFailure: string;
  runnerSees: Visibility;
  /** Can the prior state be restored, and how. */
  reversible: string;
  note?: string;
}

/**
 * WHAT IS AND IS NOT IN HERE.
 *
 * In: every scheduled workflow, every cron route, the Strava webhook, the
 * HealthKit ingest paths, the watch completion path, and read handlers that
 * write. Out: anything a runner triggers by deliberately tapping a control —
 * that is not this bug class. `POST /api/plan/replan` is the runner asking;
 * `plan-drift` is not.
 */
export const AUTOMATIC_MUTATIONS: readonly AutomaticMutation[] = [
  // ── The plan writers ──────────────────────────────────────────────────────
  {
    id: 'cron/plan-drift',
    route: 'app/api/cron/plan-drift/route.ts',
    trigger: '0 9 * * * · plus workflow_dispatch',
    reach: 'replaces_plan',
    changes: ['training_plans', 'plan_workouts', 'plan_weeks', 'plan_phases', 'plan_proposals', 'races.actual_result', 'notifications_pending', 'coach_intents.superseded_at'],
    idempotent: true,
    onPartialFailure:
      'The rebuild itself is one transaction (mutatePlan): archive and insert commit together or not at all. '
      + 'The plan_proposals audit row is a SEPARATE write AFTER it, so a failure between them leaves the block '
      + 'replaced with no proposal explaining it. Since 2026-08-25 the archived plan carries the trigger in '
      + 'archive_reason, stamped inside the rebuild transaction, so that gap no longer loses the reason entirely. '
      + 'That gap is now also the ONLY way to lose an undo: the proposal row is what pairs old plan to new, and '
      + 'POST /api/plan/undo refuses (not_undoable) when no pairing exists rather than guessing at one.',
    runnerSees: 'surfaced',
    reversible:
      'YES, since 2026-08-25. POST /api/plan/undo archives the block this cron authored and un-archives the one '
      + 'it replaced, in one transaction; nothing is deleted either way. Reachable from the notice card on web '
      + 'and iPhone. It REFUSES rather than acting when the runner has already run a day the two blocks '
      + 'prescribe differently, when the plan has changed again since, or when the earlier block has run out '
      + 'of days. Before this the prior plan survived archived and no surface reached it.',
    note:
      'TWO TIERS since 2026-08-28. Soft drift and goal-gap PROPOSE ONLY (David 2026-08-26, after two drift '
      + 'detectors rebuilt the block on back-to-back mornings: no drift rebuild fires without a card to '
      + 'approve — fireAutoRebuild is not called on those paths at all). Lifecycle transitions AUTO-APPLY '
      + 'with undo: race_graduate, maintenance→race-prep, recovery_complete (David 2026-08-28 · doctrine- '
      + 'driven and non-optional, plus a next-morning coach note via notifications_pending) and plan_elapsed '
      + '(race still ahead → rebuild toward it; race date null/past or no race → goal target, else archive + '
      + 'open-block handoff). Exceptions that fall back to a pending card instead of applying: a runner who '
      + 'UNDID this exact block (generatePlan RebuildRefused undone_by_runner), and a COMPROMISED runner '
      + '(runnerIsCompromised: open injury/illness/override niggle/gap re-entry, or an elapsed injury-return '
      + 'plan) — never an auto-authored build over either. Where it applies, it applies first and writes the '
      + 'proposal row afterwards, so the proposal is a RECORD and not a GATE: of 40 engine-raised proposals '
      + 'this runner has answered zero, so a gate is an expiry. The bargain is apply-with-undo — the notice '
      + 'says what moved in miles (reasons.plan_delta), and the undo puts it back. A rebuild whose output is '
      + 'identical to the block it would replace no longer lands at all: generatePlan diffs both persisted '
      + 'blocks inside the transaction and rolls back, recording status no_change. 2026-08-28 · each nightly '
      + 'pass also sweeps coach_intents: any plan_adapt_* intent whose field points at an archived plan\'s '
      + 'workout is stamped superseded_at (+ acknowledged_at backfill) — mark, not delete — closing the '
      + 'dangling-intent shape supersedeProposalsForArchivedPlans closed for proposals. 2026-08-28 · '
      + 'RACEROLE-1: the pass also writes a pending race_role card when a B-priority hm/10k/5k tune-up '
      + 'inside the active build is 12-15 days out (once per race, dedupe on any prior race_role row for '
      + 'that slug, fail-closed; C races never fire). The card is the WHOLE automatic action — a proposal, '
      + 'never an auto-apply; the race row\'s meta.plannedRole and the week patch move only on the '
      + 'runner\'s accept (lib/race/race-role-apply.ts, runner-initiated, through mutatePlan).',
  },
  {
    id: 'cron/snapshot-projections',
    route: 'app/api/cron/snapshot-projections/route.ts',
    trigger: '30 7 * * * · collides on the minute with enrich-weather',
    reach: 'overwrites_engine_state',
    changes: ['projection_snapshots', 'users.max_hr', 'runner_calibration', 'plan_workouts', 'training_plans.authored_state', 'pace_zone_events'],
    idempotent: true,
    onPartialFailure:
      'Snapshots are independent upserts. The plan re-anchor runs through mutatePlan, so it rolls back whole. '
      + 'A failed re-anchor is now logged; before 2026-08-25 a bare catch made it indistinguishable from '
      + 'having had nothing to do.',
    runnerSees: 'audit_row_only',
    reversible: 'pace_zone_events records fromVdot to toVdot, so the prior anchor is recoverable. The prescribed paces are overwritten in place.',
    note:
      'THE THIRD PLAN WRITER, and the one whose name hides it. reanchorActivePlan rewrites pace_target_s_per_mi '
      + 'and workout_spec for every future unsealed day. Sealed days are skipped, so it cannot rewrite what the '
      + 'runner already ran. It was not on the incident brief. 2026-08-28 · it now DEFERS to the 03:00 adapter: '
      + 'when a plan_adapt_recompute_paces intent exists within 24h it stands down with a recorded '
      + 'reanchor_skipped no-op in the cron response, unless its own move is a provisional-to-measured anchor '
      + 'upgrade (which the adapter cannot perform, and which must still fire to end a calibration intro). '
      + 'Thresholds and the anchor cascade live in lib/training/pace-anchor.ts, shared with the adapter.',
  },
  {
    id: 'cron/run-adaptations',
    route: 'app/api/cron/run-adaptations/route.ts',
    trigger: '0 3 * * *',
    reach: 'overwrites_engine_state',
    changes: ['plan_workouts', 'training_plans', 'coach_intents', 'plan_workout_proposals', 'plan_proposals', 'coach_proposals', 'users.vdot_last_reviewed'],
    idempotent: true,
    onPartialFailure: 'mutatePlan transaction with differential doctrine validation and rollback.',
    runnerSees: 'surfaced',
    reversible: 'No undo. Sealed days are filtered out, so it cannot rewrite a day already run.',
    note:
      'Rewrites prescribed workouts in place rather than replacing the block. Some changes propose, some apply. '
      + '2026-08-28 · pace-anchor thresholds (race 1.5 / training-lead 1.0) live in lib/training/pace-anchor.ts, '
      + 'shared with the 07:30 self-heal, which now defers to this cron\'s recompute for 24h. The adaptive bump '
      + '(tryAdaptiveBump) is blocked for 48h after any applied pull-back intent (downgrade/shave/readiness red), '
      + 'not just same-tick. A day_actions skip is now a decision, not a debt: the skipped session is never '
      + 'rescheduled, a plan_adapt_skip_respected note intent records it, and it still reads as a non-running day '
      + 'to gap and volume detection.',
  },
  {
    id: 'cron/silent-rebuild',
    route: 'app/api/cron/silent-rebuild/route.ts',
    trigger: 'workflow_dispatch ONLY · no schedule, and nothing else in the repo calls it',
    reach: 'replaces_plan',
    changes: ['training_plans', 'plan_workouts', 'plan_weeks', 'plan_phases', 'plan_proposals', 'coach_intents.acknowledged_at'],
    idempotent: true,
    onPartialFailure:
      'The rebuild is transactional. The plan_proposals row is a separate write after it (fireAutoRebuild), so '
      + 'a failure between them leaves the block replaced with archive_reason silent_rebuild as the only record '
      + '— the same residual gap plan-drift carries. The coach_intents ack is a further best-effort write; a '
      + 'failure there leaves stale banners up for one cycle.',
    runnerSees: 'surfaced',
    reversible:
      'YES, since 2026-08-28. Routed through fireAutoRebuild (kind silent_rebuild), it writes the auto_applied '
      + 'plan_proposals row pairing the archived plan to its replacement, which is exactly what POST '
      + '/api/plan/undo keys off — before this it was the one plan writer the runner could not undo '
      + '(not_undoable). The 2026-08-25 no-op gate still applies (an identical rebuild rolls back as '
      + 'no_change), and the intents ack is skipped on no_change so live banners are not cleared.',
    note:
      'Lands code upgrades, not coach decisions. Since 2026-08-28 it is silent-ISH: the auto_applied row '
      + 'surfaces the standard notice card for 24h ("engine updated · undo puts the old block back") — the '
      + 'accepted price of making it undoable, per the post-incident visibility-plus-undo doctrine. '
      + 'fireAutoRebuild also brings the 60-second dedupe, so a double dispatch no longer rebuilds twice even '
      + 'within the same minute.',
  },

  // ── The physiological constants ───────────────────────────────────────────
  {
    id: 'cron/max-hr-ratchet',
    route: 'app/api/cron/max-hr-ratchet/route.ts',
    trigger: '30 8 * * *',
    reach: 'overwrites_engine_state',
    changes: ['users.max_hr'],
    idempotent: true,
    onPartialFailure:
      'One statement per runner, so there is no incoherent middle. The route loops over users and a '
      + 'failure on one does not stop the rest.',
    runnerSees: 'invisible',
    reversible:
      'No history row. The prior value is overwritten in place and the ratchet is monotone up, so the only way '
      + 'back is the runner typing users.max_hr_override.',
    note:
      'Every HR zone and every HR-derived pace descends from this number, it holds for 365 days, and one sample '
      + 'moves it with no corroboration. It cannot overwrite a runner-typed value: the UPDATE is gated on '
      + 'max_hr_override IS NULL. Until 2026-08-25 the health_samples branch had no plausibility band at all '
      + 'while the runs branch beside it did.',
  },

  // ── Merges and destructive passes ─────────────────────────────────────────
  {
    id: 'cron/dedupe-runs',
    route: 'app/api/cron/dedupe-runs/route.ts',
    trigger: '0 10 * * * · also called live from four ingest paths, with no advisory lock',
    reach: 'overwrites_engine_state',
    changes: ['runs.data.mergedIntoId', 'runs.absorbed_into_canonical_at', 'runs.data', 'runs.shoe_id', 'post_run_rpe', 'ops_alerts'],
    idempotent: true,
    onPartialFailure:
      'NOT TRANSACTIONAL. lib/runs/merge.ts runs the clears loop and the sets loop as independent awaits. '
      + 'The order is deliberate and prevents the 2026-06-07 circular bug, but dying between the two leaves a '
      + 'promoted pair where neither row carries mergedIntoId, so both read as canonical and the day '
      + 'double-counts until the next pass.',
    runnerSees: 'audit_row_only',
    reversible:
      'A merge is mostly reversible: the loser row is never deleted and mergedIntoId can be cleared. The '
      + 'absorber is NOT — on the higher-tier-wins branch the canonical prior value is replaced in data and '
      + 'only the new source lands in provenance.',
    note:
      'Merges the runner\'s runs. Identity fails closed. Two ways it can still merge genuinely distinct runs: a '
      + 'paused Strava activity\'s elapsed-time span can swallow a later run, and the untrusted-timestamp '
      + 'fallback ignores start time entirely, so the same treadmill loop run twice in a day merges.',
  },

  // ── Fill-only and derived ─────────────────────────────────────────────────
  {
    id: 'cron/strava-sync',
    route: 'app/api/cron/strava-sync/route.ts',
    trigger: '15 8 * * * · shares the minute with readiness-snapshot',
    reach: 'append_or_fill',
    changes: ['runs', 'post_run_rpe', 'connector_tokens', 'runs.shoe_id'],
    idempotent: true,
    onPartialFailure: 'Writes are independent and fill-only. findCanonicalRow throws rather than swallowing, so a DB error skips the activity instead of double-inserting.',
    runnerSees: 'surfaced',
    reversible: 'Re-syncable.',
    note: 'Shares a minute with readiness-snapshot but no write table, so the collision costs a readiness score computed off a half-synced day, not a lost write.',
  },
  {
    id: 'cron/readiness-snapshot',
    route: 'app/api/cron/readiness-snapshot/route.ts',
    trigger: '15 8 * * *',
    reach: 'append_or_fill',
    changes: ['readiness_snapshots', 'notifications_pending'],
    idempotent: true,
    onPartialFailure: 'Single upsert on (user_uuid, snapshot_date).',
    runnerSees: 'surfaced',
    reversible: 'Recomputed daily.',
    note: 'Structurally idempotent, not semantically: the score is recomputed from live state, so a re-run at a different hour writes a different number over the first.',
  },
  {
    id: 'cron/enrich-weather',
    route: 'app/api/cron/enrich-weather/route.ts',
    trigger: '30 7 * * * · collides on the minute with snapshot-projections',
    reach: 'append_or_fill',
    changes: ['runs.data.weather', 'runs.data.tempF', 'runs.weather_enriched_at', 'workout_weather_cache'],
    idempotent: true,
    onPartialFailure: 'Independent jsonb_set writes, each coherent alone. Rule 6 compliant, never a whole-column replace.',
    runnerSees: 'surfaced',
    reversible: 'Re-enrichable.',
    note: 'Overwrites data.tempF with a MODELLED value on rows lacking data.weather, including rows where the watch supplied a measured one, and stamps nothing in provenance. Sits outside the canonical tier ladder.',
  },
  {
    id: 'cron/promote-courses',
    route: 'app/api/cron/promote-courses/route.ts',
    trigger: '45 7 * * *',
    reach: 'append_or_fill',
    changes: [
      'races.course_geometry',
      'races.course_source',
      'course_library',
      'course_library.contributor_count',
      'races.promoted_to_library_iso',
    ],
    idempotent: false,
    onPartialFailure:
      'NOT TRANSACTIONAL, and the write order is wrong: every branch writes course_library BEFORE setting '
      + 'promoted_to_library_iso, and that flag is the only dedupe. Dying between them leaves contributor_count '
      + 'incremented and the race unflagged, so the next pass increments it again. The step-0 hydrate is the '
      + 'exception: its UPDATE fires only on a row whose course_geometry is empty, so a crash mid-pass leaves '
      + 'each row either untouched or fully written, and the next pass finishes the rest.',
    runnerSees: 'invisible',
    reversible:
      'A double-counted contributor_count is not self-correcting. A hydrated geometry is: '
      + 'UPDATE races SET course_geometry = NULL, course_source = NULL WHERE slug = ANY($1) AND user_uuid = $2. '
      + 'gpx_text is never touched, so the source file survives the reversal.',
    note:
      'Clean re-runs are idempotent. Crashed ones are not. 2026-08-25 · step 0 hydrates course_geometry from '
      + 'the gpx_text already on the row, capped at 10 rows a pass. It is the only writer in the app whose input '
      + 'is gpx_text, which is why nine of eleven races sat with a NULL column and six of them with a parseable '
      + 'GPX beside it. It refuses any track assessGeometryConfidence rejects, and a refusal is reported in the '
      + 'response rather than silently skipped.',
  },
  {
    id: 'cron/notifications',
    route: 'app/api/cron/notifications/route.ts',
    trigger: '*/30 and */15 in bands',
    reach: 'destructive_or_external',
    changes: ['notifications_pending', 'notifications_log', 'ops_alerts'],
    idempotent: false,
    onPartialFailure: 'markProcessed and retryLater swallow their errors, so a push can be sent with the row left unconsumed and the attempt counter not incremented.',
    runnerSees: 'surfaced',
    reversible: 'A sent push cannot be unsent.',
    note:
      'The catchment windows are hours wide against a */30 tick, so a single cause produces 8 to 16 calls and '
      + 'one SELECT stands between them and 16 rows. The index the code cites as preventing duplicates '
      + '(notifications_pending_dedup_idx) is a plain btree, not unique.',
  },
  {
    id: 'cron/strava-push-poll',
    route: 'app/api/cron/strava-push-poll/route.ts',
    trigger: '*/15 in two bands',
    reach: 'destructive_or_external',
    changes: ['strava_pushes', 'activities created in the runner\'s public Strava feed'],
    idempotent: false,
    onPartialFailure: 'The pending row is written before the network call.',
    runnerSees: 'surfaced',
    reversible: 'Only by deleting the activity on Strava, which then fires the webhook delete path.',
    note:
      'Auto-retries failed pushes, capped at 3 per run. The 24h sweep marks rows failed and step 3 selects '
      + 'exactly those, so the sweep feeds the retry in the same pass. The safety argument is Strava\'s own '
      + 'duplicate detection, which does not hold for a run the runner DELETED from Strava: it is no longer a '
      + 'duplicate there, so the cron re-uploads what they removed. No concurrency block in the workflow.',
  },
  {
    id: 'cron/keep-warm',
    route: 'app/api/cron/keep-warm/route.ts',
    trigger: '*/15 and hourly bands',
    reach: 'append_or_fill',
    changes: [],
    idempotent: true,
    onPartialFailure: 'No writes at all, so there is no partial state to leave behind.',
    runnerSees: 'invisible',
    reversible: 'Nothing to reverse.',
    note: 'Verified read-only: all six loaders it calls contain no UPDATE, INSERT, DELETE or ON CONFLICT.',
  },

  // ── Event-driven ──────────────────────────────────────────────────────────
  {
    id: 'webhook/strava',
    route: 'app/api/strava/webhook/route.ts',
    trigger: 'Strava activity create / update / delete, and athlete deauthorize. Strava retries, and create-then-update for one activity is normal.',
    reach: 'destructive_or_external',
    changes: ['runs', 'strava_webhook_events', 'connector_tokens', 'runs.data.mergedIntoId'],
    idempotent: true,
    onPartialFailure: 'The upsert is one statement with an owner backstop and a rowCount === 0 throw.',
    runnerSees: 'surfaced',
    reversible: 'A delete event hard-deletes the run row. Not reversible.',
    note:
      'No unique constraint on strava_webhook_events, so a duplicate delivery runs the processor twice. Every '
      + 'aspect is idempotent on the second run. The delete and deauthorize paths both fail CLOSED: they act '
      + 'only on a verified 404 or 410 and refuse on 2xx or on an unverifiable probe.',
  },
  {
    id: 'ingest/healthkit-workout',
    route: 'app/api/ingest/workout/route.ts',
    trigger: 'iPhone HealthKit push, with a durable retry queue',
    reach: 'append_or_fill',
    changes: ['runs', 'profile.timezone'],
    idempotent: true,
    onPartialFailure:
      'DELETE PRECEDES INSERT WITH NO TRANSACTION. The legacy-id DELETE runs before the upsert; if the upsert '
      + 'throws, the run is gone and no replacement exists. The retry queue re-runs it, which is the recovery.',
    runnerSees: 'surfaced',
    reversible: 'Re-syncable from HealthKit.',
    note: 'Rule 6 compliant: runs.data uses the || jsonb_strip_nulls merge form, never SET data = EXCLUDED.data. Runner-authored warmupAddedManually is explicitly re-applied on re-ingest.',
  },
  {
    id: 'ingest/healthkit-health',
    route: 'app/api/ingest/health/route.ts',
    trigger: 'iPhone HealthKit batch',
    reach: 'append_or_fill',
    changes: ['health_samples'],
    idempotent: true,
    onPartialFailure: 'Per-sample, no transaction. Each sample is coherent alone.',
    runnerSees: 'audit_row_only',
    reversible: 'Re-syncable.',
    note:
      'No delete-diff exists here, and WHERE source IS DISTINCT FROM manual protects every runner-typed value. '
      + 'SAMPLE_BOUNDS gained max_hr on 2026-08-25; it had none, and that stream feeds a 365-day monotone '
      + 'ratchet on users.max_hr.',
  },
  {
    id: 'ingest/healthkit-strength',
    route: 'app/api/strength/route.ts',
    trigger: 'iPhone HealthKit sweep · client-side delete-diff',
    reach: 'destructive_or_external',
    changes: ['strength_sessions'],
    idempotent: true,
    onPartialFailure: 'The DELETE is a hard delete, correctly scoped by owner.',
    runnerSees: 'invisible',
    reversible: 'Not reversible.',
    note:
      'THE FLOOR IS ON THE WRONG FAILURE. HealthKitImporter guards on freshUUIDs.isEmpty, which catches a '
      + 'TOTALLY empty read. But fetchStrengthWorkouts loops eight activity types and returns [] on a query '
      + 'ERROR, so a PARTIAL read passes the guard and every cached uuid from the failed types is deleted. Same '
      + 'shape as the 2026-06-11 data-loss incident, one layer below where the guard was placed. The server has '
      + 'no floor of its own. Client-side, so out of reach of the swallowed-failure scanner.',
  },
  {
    id: 'ingest/watch-completion',
    route: 'app/api/watch/workouts/complete/route.ts',
    trigger: 'watch, treadmill or phone finish, with a durable retry queue',
    reach: 'append_or_fill',
    changes: ['runs', 'coach_intents'],
    idempotent: true,
    onPartialFailure: 'Insert before delete on intents, deliberately. Retryable failures return 500 so the queue holds the payload.',
    runnerSees: 'surfaced',
    reversible: 'Re-postable.',
    note: 'Cannot overwrite a phone edit, because there is no run field the phone lets you edit into runs.data. PATCH /api/runs/[id] writes only shoe_id (a column) and RPE (a separate table).',
  },

  // ── Read handlers that write ──────────────────────────────────────────────
  {
    id: 'readpath/watch-today-heat',
    route: 'lib/watch/build-workout.ts',
    trigger: 'GET /api/watch/today · app cold launch, every scenePhase active, every watch reachability change, and any ?date= preview',
    reach: 'append_or_fill',
    changes: ['coach_intents'],
    idempotent: true,
    onPartialFailure: 'Fire and forget from a read handler. One statement, so nothing incoherent is left.',
    runnerSees: 'invisible',
    reversible: 'Only by deleting coach_intents rows.',
    note:
      'A GET that mints a coaching record. FIXED 2026-08-25, and the entry is kept because the shape is worth '
      + 'remembering. It was not idempotent: the dedupe matched exact equality of a value blob containing '
      + 'observedAgeMin, the age of the weather observation in minutes, which differs between any two calls. '
      + 'And it had no date guard while adjustPhasesForHeat reads CURRENT conditions with no date, so a ?date= '
      + 'preview of another day stamped that day with today\'s weather. Prod on 2026-08-25: 40 rows on the '
      + 'owner\'s account in one day across nine date keys, past and future. Now one row per decision, and only '
      + 'for the day the runner is living. RESIDUAL: loadHeatEasing still reads ORDER BY ts DESC LIMIT 1, so a '
      + 'later same-day build whose decision genuinely changed can still re-price a finished run. Closing that '
      + 'means keying the record to the build the watch CONSUMED, which is a completion-payload contract change.',
  },
  {
    id: 'readpath/run-detail-weather',
    route: 'lib/coach/run-state.ts',
    trigger: 'GET /api/runs/[id] and the run-detail page render',
    reach: 'destructive_or_external',
    changes: ['runs.data.weather', 'runs.data.tempF', 'runs.weather_enriched_at'],
    idempotent: true,
    onPartialFailure:
      'STRIP COMMITS BEFORE THE REFETCH, with no transaction. The UPDATE removes weather and tempF, then a '
      + 'network call to Open-Meteo tries to replace them. A null response stamps weather_enriched_at = NOW() '
      + 'and the old value is gone.',
    runnerSees: 'invisible',
    reversible: 'Not for a HealthKit-sourced reading on a run with no polyline: there is nothing to re-derive it from.',
    note:
      'Verified in prod 2026-08-25: 83 runs carry data.weather with NO version key, so storedVersion defaults '
      + 'to 0 against WEATHER_VERSION_CURRENT 2 and isStaleVersion is TRUE for all of them. This is firing '
      + 'today, not armed. Also the only write in the runs path scoped by id alone with no user_uuid.',
  },
  {
    id: 'readpath/calibration-refire',
    route: 'lib/runs/post-write-hooks.ts',
    trigger: 'every run write',
    reach: 'overwrites_engine_state',
    changes: ['calibration_sessions', 'coach_intents'],
    idempotent: true,
    onPartialFailure: 'The session write is transactional, and the UPDATE is now guarded so rowCount 0 rolls back and re-reads rather than stamping a second intent.',
    runnerSees: 'invisible',
    reversible: 'No surface reaches it.',
    note:
      'FIXED 2026-08-25, kept because the OPEN QUESTION under it is bigger than the bug was. The function\'s '
      + 'docstring claimed it returned the existing result when already completed; it selected WHERE '
      + 'completed_at IS NULL AND skipped_at IS NULL, found none, and inserted a fresh one on every run write. '
      + 'Prod on 2026-08-25: the owner had 31 completed sessions where there should be one. A skipped session '
      + 'was excluded from the lookup rather than treated as an answer, so a runner who tapped skip was '
      + 'silently recalibrated on their next run. Both closed. STILL OPEN, for David: voice-band.ts reads the '
      + 'most recent completed session and HARD-OVERRIDES the coaching voice band off it, and calibration is '
      + 'listed in MODULE_ORPHANS as unmounted end to end. An unmounted feature is steering the coach\'s voice '
      + 'off evidence the runner never volunteered. It fires on the Strava path only, because post-write-hooks '
      + 'passes the runs.id BIGINT and calibration.ts matches it against data->>\'id\'. Correcting that join '
      + 'turns it on for HealthKit, watch and manual too, which is a product decision, not a bug fix.',
  },
] as const;

/**
 * Scheduled workflows that mutate NOTHING a runner owns, each with the reason.
 *
 * An explicit list, not a silent skip. A gate that quietly ignores what it does
 * not recognise reports clean on a codebase it never looked at — which is
 * precisely how a daily job that rewrites prescribed paces sat outside the
 * inventory. Anything scheduled is either in AUTOMATIC_MUTATIONS or in here,
 * with a sentence, or the gate fails.
 */
export const SCHEDULED_NON_MUTATORS: readonly { workflow: string; reason: string }[] = [
  {
    workflow: 'emit-telemetry.yml',
    reason: 'Runs web-v2/scripts/_emit_telemetry.mjs against prod with read access and commits a report file to the repo. Verified 2026-08-25: the script contains no INSERT, UPDATE or DELETE. It writes to git, never to a runner.',
  },
  {
    workflow: 'deletion-plan-fixture.yml',
    reason: 'Runs the account-deletion plan as a FIXTURE, asserting the refusal floor still holds. It exercises the planning half only; the destructive half needs a live request. Writes nothing.',
  },
  {
    workflow: 'keep-warm.yml',
    reason: 'Registered as cron/keep-warm with an empty changes list, because a job that pings six loaders to hold a container warm is worth naming as verified read-only rather than omitting.',
  },
];

/**
 * The plan writers, derived from this registry rather than listed by hand.
 *
 * `_automatic_mutations.test.ts` compares this against the `generatePlan(` and
 * `reanchorActivePlan(` call sites it finds in the source. The two must agree.
 * That comparison is the whole reason this file is a gate and not a document:
 * a document would have kept saying "two plan writers" for as long as nobody
 * reread it.
 */
export function planWriters(): readonly AutomaticMutation[] {
  return AUTOMATIC_MUTATIONS.filter(
    (m) => m.reach === 'replaces_plan' || m.changes.includes('plan_workouts'),
  );
}

/**
 * Floors, so a gate that parses nothing cannot report clean.
 *
 * Observed 2026-08-25, held below actual so ordinary deletion does not trip
 * them. A scanner that silently stops matching is indistinguishable from a
 * codebase that got better — which is the same bug this whole file is about,
 * one level up.
 */
export const MUTATION_SCAN_FLOORS = {
  /** 13 route dirs under app/api/cron on 2026-08-25. */
  cronRoutes: 12,
  /** 14 workflow files carrying a `schedule:` on 2026-08-25. */
  scheduledWorkflows: 13,
  /** 4 entries reach the plan on 2026-08-25 (plan-drift, snapshot-projections, run-adaptations, silent-rebuild). */
  planWriters: 4,
  /** 21 entries on 2026-08-25. */
  entries: 20,
} as const;
