/**
 * lib/audit/generated-content-registry.ts — every column the engine AUTHORS,
 * and the surface that reads it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * On 2026-08-24 three pieces of authored content turned up unread in one
 * sitting, and the ruling was: "make sure that things that are generated are
 * not going unread again. thats very annoying."
 *
 *   1 · `plan_phases.rationale` — a cited reason per phase, on all 210 rows.
 *       Every SELECT against the table asked for `label`, `start_week_idx`,
 *       `end_week_idx`. Fixed 89bab20d; Today now leads with it.
 *   2 · `plan_workouts.notes` — a sentence per day, on all 4431 rows, while
 *       Today composed its own copy from a function keyed on the workout type.
 *       Fixed 19c11b44: `week-loader.ts` selects it and `lib/faff/why-voice.ts`
 *       writes it into the sentence Today renders.
 *   3 · `lib/plan/block-preview.ts` — a module, its tests and an API route,
 *       imported by nothing outside itself. Still dead; see BLOCK-PREVIEW below.
 *
 * The pattern is not laziness. The authoring side and the reading side are
 * built at different times, and nothing fails when they do not meet. A green
 * build, a passing suite and every other gate all agree that unread content is
 * fine. This registry plus `_generated_content_gate.test.ts` is what stops
 * agreeing, so the fourth instance is caught by CI and not by the owner looking
 * at his phone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNREAD CONTENT IS A BUG IN ONE OF TWO DIRECTIONS. Every entry says which:
 *
 *   `surfaced` — a runner can see it. Requires a real SELECT reader AND a named
 *                file that renders it. Both are checked.
 *   `internal` — read by the engine or an operator, never by a runner, and that
 *                is correct. Requires a real SELECT reader and a reason.
 *   `exempt`   — genuinely unread today. Requires an honest reason and, where
 *                the call belongs to the owner, the decision that is open.
 *                Checked for STALENESS: the day a reader appears, the gate
 *                makes you delete the exemption.
 *
 * Do NOT widen a verdict to make the gate pass. `internal` is not a parking
 * space for "a script reads it" — a diagnostic script is not a reader.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FORMAT CONTRACT — one single-line quoted `id:` and one `verdict:` per entry.
 * That is what lets `scripts/check-generated-content.sh` count the registry on
 * a cold container with no TypeScript toolchain, exactly as
 * `check-doctrine.sh` does with `id:` / `doc:` / `anchor:`.
 */

export type Verdict = 'surfaced' | 'internal' | 'exempt';

export interface GeneratedColumn {
  /** `table.column`, lowercase, as it appears in SQL. */
  id: string;
  verdict: Verdict;
  /** What the column actually holds, in one line, with a real value. */
  holds: string;
  /**
   * `surfaced` only · a repo-relative file that renders it, and a token that
   * must appear in that file. The token is the proof the value did not stop at
   * a variable nobody used.
   */
  surface?: { file: string; token: string };
  /** `internal` and `exempt` · why. Never optional for those. */
  reason?: string;
}

/**
 * The classification vocabulary. A column whose name matches this and which
 * some INSERT or UPDATE in the source writes MUST appear below. That is the
 * discovery half: a new prose column cannot be added silently.
 */
export const GENERATED_CONTENT_VOCAB =
  /^(rationale|citation|citations|citations_json|reason|reasons|notes?|verdict|summary|narrative|explanation|provenance|advice|guidance|evidence|pillars|streaks|adaptation_log|archive_reason|violations|prescription_text|return_protocol|body_md|message|original_type|original_sub_label|warmup_cooldown|eyebrow|detail)$/;

/**
 * Tables whose rows are pure infrastructure — a queue, a token store, a
 * webhook log. Their `payload`/`detail` columns are wire bodies, not authored
 * copy, and classifying them as generated content is noise.
 */
export const INFRASTRUCTURE_TABLES = new Set([
  'connector_tokens',
  'sessions',
  'device_tokens',
  'notifications_pending',
  'notifications_log',
  'strava_webhook_events',
  'strava_webhook_subscriptions',
  'strava_pushes',
  'data_migrations',
  'coach_reads_cache',
  'deleted_activity_ids',
  'coach_usage',
]);

export const GENERATED_CONTENT_REGISTRY: GeneratedColumn[] = [
  // ── the plan's own words ───────────────────────────────────────────────────
  {
    id: 'plan_phases.rationale',
    verdict: 'surfaced',
    holds: 'Why this block exists. "Post-race recovery · Americas Finest City. Easy running only · no quality."',
    surface: { file: 'web-v2/app/api/v5/today/route.ts', token: 'phaseRationale' },
  },
  {
    id: 'plan_phases.citation',
    verdict: 'internal',
    holds: 'The doctrine behind the phase. "Research/00a §recovery + Pfitzinger Advanced Marathoning".',
    reason: 'Provenance for the rationale, in the vocabulary of the research and not of a runner. Read by lib/plan/mutate.ts so a rebuild cannot lose it. If a runner-facing "where does this come from" surface is ever built, this becomes `surfaced` and the surface renders the doc name, not the file path.',
  },
  {
    id: 'plan_workouts.notes',
    verdict: 'surfaced',
    holds: 'Why THIS day. "Extra rest · still recovering." "Long run back · easy effort." NOT NULL, 4431 of 4431 rows.',
    surface: { file: 'web-v2/lib/plan/week-loader.ts', token: 'notes' },
  },
  {
    id: 'plan_workouts.original_type',
    verdict: 'surfaced',
    holds: 'What the day WAS before the coach moved it. Drives the "was Threshold" kicker.',
    surface: { file: 'web-v2/lib/coach/adaptation-info.ts', token: 'original_type' },
  },
  {
    id: 'plan_workouts.original_sub_label',
    verdict: 'surfaced',
    holds: 'The prior sub-label of an adapted day, e.g. "THRESHOLD".',
    surface: { file: 'web-v2/lib/coach/adaptation-info.ts', token: 'original_sub_label' },
  },
  {
    id: 'plan_weeks.rationale',
    verdict: 'exempt',
    holds: 'Nominally why this WEEK. The live writer emits "RECOVERY · week 1" — the phase label and the week index, both already on screen. 627 of 627 rows populated; the genuinely informative rows ("Cutback week, volume drops ~18% so the last block of work can land.") come from lib/plan/seed-from-onboarding.ts and from a writer that no longer exists.',
    reason: 'DECISION FOR THE OWNER, not a surface gap. Adding a screen for lib/plan/generate.ts:6444\'s `${phase} · week ${n}` would surface a restatement of two values already visible. The repair belongs on the WRITER: author a real week reason, or drop the column. Both change authored plan bytes, which _maint_invariants.test.ts holds stable, so neither is mine to take unilaterally.',
  },

  // ── the coach's own words ──────────────────────────────────────────────────
  {
    id: 'coach_intents.reason',
    verdict: 'surfaced',
    holds: 'Why the coach recorded an intent, e.g. "watch_completion", and the runner-facing reason on a decline.',
    surface: { file: 'web-v2/app/api/coach/intents/route.ts', token: 'reason' },
  },
  {
    id: 'coach_intents.value',
    verdict: 'surfaced',
    holds: 'The watch completion, phase by phase: per-rep target, actual, HR, the device verdict (hit/drifted/missed/incomplete) and its seconds in and out of the pace band.',
    surface: { file: 'web-v2/lib/coach/run-state.ts', token: 'time_in_tolerance_sec' },
  },
  {
    id: 'plan_proposals.reasons',
    verdict: 'surfaced',
    holds: 'The reasons a replan is being proposed. Rendered on the proposal card.',
    surface: { file: 'web-v2/lib/plan/proposals-state.ts', token: 'reasons' },
  },
  {
    id: 'plan_workout_proposals.reason',
    verdict: 'surfaced',
    holds: 'Why a single session is proposed for a change.',
    surface: { file: 'web-v2/lib/plan/workout-proposals.ts', token: 'reason' },
  },
  {
    id: 'plan_workout_proposals.evidence',
    verdict: 'surfaced',
    holds: 'The signals behind a per-workout proposal · rule two\'s convergence, not one cause.',
    surface: { file: 'web-v2/lib/plan/workout-proposals.ts', token: 'evidence' },
  },
  {
    id: 'personal_goals.rationale',
    verdict: 'surfaced',
    holds: 'Why a personal goal was set at the value it was — the runner\'s own sentence. "Coming back from a calf strain, so volume before pace."',
    // 2026-08-24 · re-pointed. This used to name app/api/goals/route.ts, which
    // only ACCEPTED the value — the route was the write side, and naming it as
    // the surface let a column that no screen rendered pass GUARD 3. The whole
    // table was write-only at the time. It is rendered now, in the goal row on
    // Targets, and this points at the file that draws it.
    surface: { file: 'web-v2/components/faff-app/views/TargetsView.tsx', token: 'rationale' },
  },

  // ── evidence the engine records about the runner ───────────────────────────
  {
    id: 'readiness_snapshots.pillars',
    verdict: 'exempt',
    holds: 'The per-pillar evidence behind a day\'s readiness band, with the observed value and its baseline: {"hrv": {"weight": -10, "observedV": "44ms", "observedSub": "baseline 55ms"}, "rhr": {"weight": 3, "observedV": "47 bpm", …}}. Written nightly on 85 of 85 rows.',
    reason: 'THE WRITER IS THE WASTE HERE, not a missing surface — do NOT wire this. It had exactly one reader, the morning brief\'s mover delta, and lib/coach/readiness-brief.ts:360 REMOVED it on 2026-06-03 with the reason in the code: the nightly cron writes at 09:00 UTC, before the day\'s HRV and RHR arrive, so every row stores the PREVIOUS day\'s readings. Computing against that stale baseline turned an 85→37ms HRV swing into a -7 mover instead of the real -35. The brief now recomputes yesterday\'s pillars live. Six readers remain on this table and all six select `score` and `band`. So the column is stale by construction, and surfacing it would reinstate a fixed bug. The two honest repairs are: move the cron to after the readings land and restore the reader, or drop the column. Both are the owner\'s call; leaving a writer running for a value nothing may trust is not.',
  },
  {
    id: 'readiness_snapshots.streaks',
    verdict: 'internal',
    holds: 'Active streaks at snapshot time, consumed as an engine input.',
    reason: 'Read by lib/plan/adaptive-ramp.ts to decide whether a ramp is earned. An engine input, not copy.',
  },
  {
    id: 'calibration_sessions.pillars',
    verdict: 'exempt',
    holds: 'Why a run did or did not qualify to re-anchor the runner\'s paces: {"runDistanceMi": 13.2, "qualifiedReasons": ["all thresholds passed"], "paceVarianceSPerMi": 0, "miles2to3AvgPaceSPerMi": 463}. 31 of 31 rows.',
    reason: 'UNREAD, and so is the whole feature around it. All four /api/coach/calibration routes have zero callers on any surface — see the ROUTE_CALLERS allowlist. Mounting the calibration flow is a product decision, and surfacing this verdict without it would be a screen with nothing to reach it from.',
  },
  {
    id: 'runner_calibration.citation',
    verdict: 'internal',
    holds: 'The doctrine behind a calibrated constant.',
    reason: 'Read by lib/coach/runner-calibration.ts as provenance on an engine constant. Research vocabulary, not runner copy.',
  },
  {
    id: 'runs.provenance',
    verdict: 'internal',
    holds: 'Where a run row came from and what merged into it.',
    reason: 'Read by lib/runs/canonical.ts and lib/strava/pullSync.ts to keep the canonical-run identity stable. Plumbing the runner should never have to think about.',
  },

  // ── plan lifecycle bookkeeping that reads as prose but is not ──────────────
  {
    id: 'training_plans.adaptation_log',
    verdict: 'exempt',
    holds: 'A ledger of adaptation events: [{"n": 1, "ts": "2026-07-01T07:15:06Z"}, …]. No prose — a count and a timestamp. 54 of 54 rows.',
    reason: 'UNREAD by anything but audit scripts. It looks like generated content and is not: it is a rate-limit ledger with no sentence in it. The open question is the opposite of a missing surface — lib/plan/adapt.ts writes it and nothing reads it back, so whatever limiter it was written for is not consulting it. Worth an owner decision: wire the limiter, or drop the column.',
  },
  {
    id: 'training_plans.archive_reason',
    verdict: 'exempt',
    holds: 'Why a plan was retired. Two values in production: "race_completed" (1) and "regenerated" (4).',
    reason: 'UNREAD outside audit scripts. An enum, not prose, and the runner has no plan-history surface to show it on. Low value either way; kept because it is cheap and it is the only record of why a plan ended.',
  },
  {
    id: 'plan_mutation_rejections.detail',
    verdict: 'internal',
    holds: 'What a rejected plan mutation tried to do.',
    reason: 'Operator diagnostic. Read by /api/admin/plan-mutation-rejections, which is invoked by hand.',
  },
  {
    id: 'plan_mutation_rejections.violations',
    verdict: 'internal',
    holds: 'Which invariants a rejected mutation would have broken.',
    reason: 'Operator diagnostic, read by the same admin route as `detail`. The runner is never shown a mutation that did not happen — rule three covers the refusal they DO see, and it is a sentence, not an invariant list.',
  },
  {
    id: 'ops_alerts.message',
    verdict: 'internal',
    holds: 'An operator alert body.',
    reason: 'Operator-facing by construction. Never shown to a runner.',
  },

  // ── the doctrine library ───────────────────────────────────────────────────
  {
    id: 'workout_library.prescription_text',
    verdict: 'surfaced',
    holds: 'The written prescription for a library workout.',
    surface: { file: 'web-v2/app/workouts/page.tsx', token: 'prescription_text' },
  },
  {
    id: 'workout_library.citation',
    verdict: 'surfaced',
    holds: 'The book or Research/ file behind a library workout.',
    surface: { file: 'web-v2/app/workouts/page.tsx', token: 'citation' },
  },
  {
    id: 'workout_library.notes',
    verdict: 'surfaced',
    holds: 'Execution notes for a library workout. "Conversational. Z2 HR cap."',
    surface: { file: 'web-v2/app/workouts/page.tsx', token: 'notes' },
  },
  {
    id: 'workout_library.warmup_cooldown',
    verdict: 'internal',
    holds: 'The warm-up / cool-down envelope, on 6 of 54 rows.',
    reason: 'Read by lib/plan/workout-library.ts when composing a session. It reaches the runner as part of the built workout, not as its own line.',
  },
  {
    id: 'learn_articles.body_md',
    verdict: 'surfaced',
    holds: 'A doctrine article body.',
    surface: { file: 'web-v2/app/learn/[slug]/page.tsx', token: 'body_md' },
  },
  {
    id: 'learn_articles.citations_json',
    verdict: 'surfaced',
    holds: 'The citations under a doctrine article.',
    surface: { file: 'web-v2/app/learn/[slug]/page.tsx', token: 'citations' },
  },
  {
    id: 'learn_articles.eyebrow',
    verdict: 'surfaced',
    holds: 'The kicker above an article title.',
    surface: { file: 'web-v2/app/learn/page.tsx', token: 'eyebrow' },
  },
  {
    id: 'course_library.notes',
    verdict: 'surfaced',
    holds: 'What the course does to a runner. Shown on the race detail.',
    surface: { file: 'web-v2/components/faff-app/raceDetail.ts', token: 'notes' },
  },

  // ── injury and illness ─────────────────────────────────────────────────────
  {
    id: 'runner_injuries.return_protocol',
    verdict: 'surfaced',
    holds: 'The walk-run ladder for a return from injury. Zero of 1 rows populated today.',
    surface: { file: 'web-v2/lib/coach/glance-state.ts', token: 'return_protocol' },
  },
  {
    id: 'runner_injuries.notes',
    verdict: 'surfaced',
    holds: 'What the runner said about the injury, carried back to them.',
    surface: { file: 'web-v2/lib/coach/glance-state.ts', token: 'notes' },
  },

  // ── the runner's own words · authored by a person, not the engine, but the
  //    same failure applies: written into a box and never shown again ─────────
  {
    id: 'check_ins.note',
    verdict: 'surfaced',
    holds: 'What the runner typed at check-in.',
    surface: { file: 'web-v2/lib/coach/state-loader.ts', token: 'note' },
  },
  {
    id: 'day_actions.note',
    verdict: 'surfaced',
    holds: 'Why a day was skipped or moved.',
    surface: { file: 'web-v2/app/api/v5/today/route.ts', token: 'note' },
  },
  {
    id: 'niggles.note',
    verdict: 'surfaced',
    holds: 'What the runner said about a niggle.',
    surface: { file: 'web-v2/app/api/niggle/route.ts', token: 'note' },
  },
  {
    id: 'sick_episodes.note',
    verdict: 'surfaced',
    holds: 'What the runner said about an illness.',
    surface: { file: 'web-v2/app/api/sick/route.ts', token: 'note' },
  },
  {
    id: 'post_run_rpe.notes',
    verdict: 'surfaced',
    holds: 'What the runner said after a run.',
    surface: { file: 'web-v2/app/api/runs/[id]/rpe/route.ts', token: 'notes' },
  },
  {
    id: 'strength_sessions.notes',
    verdict: 'surfaced',
    holds: 'What the runner logged for a strength session.',
    surface: { file: 'web-v2/app/api/strength/route.ts', token: 'notes' },
  },
  {
    id: 'cross_training_sessions.notes',
    verdict: 'surfaced',
    holds: 'What the runner logged for a cross-training session.',
    surface: { file: 'web-v2/app/api/cross-training/route.ts', token: 'notes' },
  },
  {
    id: 'subjective_checkins.notes',
    verdict: 'exempt',
    holds: 'What the runner typed on the subjective readiness check-in.',
    reason: 'UNREAD. The route that writes it, /api/readiness/subjective, has no caller on any surface either — see ROUTE_CALLERS. The runner cannot reach the box, so nothing is being lost today; the whole path is unmounted, and mounting or deleting it is one decision, not two.',
  },
  {
    id: 'shoes.notes',
    verdict: 'surfaced',
    holds: 'What the runner said about a pair of shoes.',
    surface: { file: 'web-v2/lib/coach/run-state.ts', token: 'notes' },
  },
];

/**
 * MODULES with no importer but their own test, and the reason each is allowed
 * to be there. An entry with no reason is itself a finding at review time.
 *
 * The rule the list encodes: a module that produces a RUNNER-FACING ANSWER and
 * has no caller is a bug. A gate, a fixture set or a deliberately dormant
 * feature is not.
 */
export const MODULE_ORPHANS: Record<string, string> = {
  'web-v2/lib/plan/block-preview.ts':
    'INSTANCE 3, STILL OPEN. Built 2026-08-18 to answer the owner\'s own question — why the shape of the next block stays invisible until recovery ends. Its route has no caller either. It should be WIRED, not deleted: the question was asked and the answer is written and tested. Wiring it needs a screen decision, so it stays named here rather than quietly removed.',
  'web-v2/lib/plan/core.ts':
    'Stranded by block-preview. The shared id()/addDays()/mondayOf() primitives were extracted so the three plan builders stay drift-free; the extraction landed and the other builders never switched over. Dies or lives with block-preview.',
  'web-v2/lib/coach/strength-recommender.ts':
    'Deliberately dormant. Strength was removed as a SURFACE on 2026-08-17 (owner ruling: handled outside the app) with the data kept. The doctrine test is what stops the engine rotting while it is unmounted. Do not "fix" this by mounting it.',
  'web-v2/lib/coach/strength-status.ts':
    'Same ruling as strength-recommender. The weekly confirmed/skipped verdict has no surface because strength has no surface.',
  'web-v2/lib/doctrine/registry.ts':
    'A GATE. Test-only is its correct state — it is consulted by check-doctrine.sh, not at runtime.',
  'web-v2/lib/runs/derived-registry.ts':
    'A GATE. Same shape as the doctrine registry: the list of places two stored values describe one thing, consulted by lib/runs/_coherence_gate.test.ts and check-derived-consistency.sh, never at runtime. The reconciler it documents (lib/runs/coherence.ts) IS wired, on every surface that prints a pace or a duration; this file holds the winner rules, the production counts and the controls that prove each guard fires.',
  'web-v2/lib/audit/sql-scan.ts':
    'A GATE. Same shape as the doctrine registry: consulted by _generated_content_gate.test.ts and check-generated-content.sh, never at runtime.',
  'web-v2/lib/audit/module-graph.ts':
    'A GATE. Same as sql-scan.ts.',
  'web-v2/lib/audit/generated-content-registry.ts':
    'A GATE. This file.',
  'web-v2/lib/faff/surface-sweep-matrix.ts':
    'A GATE. Same shape as the doctrine registry: the runner states, data shapes, boundaries and rules that _surface_sweep.test.ts and check-surface-sweep.sh drive, never consulted at runtime. It is deliberately a separate module rather than inlined in the test so the cold half of check-surface-sweep.sh can count the axes and the rules with sed on a container that has no toolchain.',
  'web-v2/lib/audit/swallow-scan.ts':
    'A GATE. Same shape as sql-scan.ts: consulted by _swallow_scan.test.ts and check-swallowed-failure.sh, never at runtime. It finds the places where a database failure becomes a plausible answer — the `.catch(() => empty)` that hid four broken date_iso comparisons for months.',
  'web-v2/lib/audit/swallowed-failure-registry.ts':
    'A GATE. The argued exemption list swallow-scan.ts is checked against, plus the empty-result ratchet. Test-only is its correct state.',
  'web-v2/lib/plan/synthetic-runners.ts':
    'Test fixtures for the plan-engine bench. Test-only is correct.',
  'web-v2/lib/conservation/laws.ts':
    'A GATE. The conservation laws — distance in equals distance out, a pace equals its own surface\'s time over its own distance, splits sum to the run. Consulted by _run_conservation.test.ts, never at runtime. Same shape as the doctrine registry.',
  'web-v2/lib/conservation/shapes.ts':
    'Test fixtures for the conservation harness. Fourteen run shapes derived from a read-only census of the live table on 2026-08-24, including the 2026-08-23 row verbatim. Test-only is correct.',
  'web-v2/lib/postrun-siege/shapes.ts':
    'Test fixtures for the post-run siege. Forty-odd hostile row shapes — zero splits, a hundred, reversed, duplicated mile numbers, a mile numbered 0, splits summing to twice and to a tenth of the run, moving time exceeding elapsed, a 3-second run, HR of 0 and of 250, zone shares summing to 0/99/140 — each carrying the ingest that produces it. Test-only is correct; it also carries the MIN_SHAPES floor so the catalogue cannot quietly shrink.',
  'web-v2/lib/postrun-siege/invariants.ts':
    'A GATE. What a post-run surface may say about a run: no debug token in prose, no distance larger than the row carries, the headline triple multiplies out, a zone distribution sums to exactly 100 or is refused, a climb marked measured came from an instrument. Deliberately a separate module from the test so _controls.test.ts can feed each check a PLANTED fabrication — a checker that cannot catch a planted lie cannot be trusted to catch a real one.',
  'web-v2/lib/conservation/surfaces.ts':
    'A GATE. Reads one run the way each screen reads it, through the real composers where a pure seam exists. Test-only is correct; wiring it would make the harness part of the thing it measures.',
  'web-v2/lib/faff/personas.ts':
    'Test fixtures for the glance adapter. The `?persona=` simulator bypass its header describes does not exist in the live route; the fixtures still earn their place in the adapter test.',
  'web-v2/lib/faff/state-tokens.ts':
    'A DayState-to-gradient map declared as the single source of truth, which nothing sources from. Plumbing, not an answer — no runner loses a sentence to it. Fold into the caller or delete on the next design pass.',
  'web-v2/lib/ops/sentry.ts':
    'Operator plumbing. reportError() is wired through lib/ops/alerts.ts in practice; this is the optional Sentry leg.',
  'web-v2/lib/races/packing.ts':
    'UNMOUNTED ANSWER. A race-week packing list with a per-item `why`. Not urgent — nothing is being lost while there is no race week in flight — but it is the same shape as block-preview and should be wired or deleted rather than left.',
  'web-v2/lib/strava/streams.ts':
    'UNMOUNTED CORRECTION. Reads measured elevation off a Strava altitude stream to fix wrong course_library figures. Elevation became measured-not-typed in 4e7986ac by another path; confirm this is superseded, then delete it.',
  'web-v2/components/profile/InlineGapEditor.tsx':
    'Written to replace ProfileGapInput, never swapped in. Both halves are orphaned, so the COACH NEEDS card is served by neither.',
  'web-v2/components/profile/ProfileGapInput.tsx':
    'The component InlineGapEditor was written to replace. One of the two should go.',
  'web-v2/lib/coach/recommendation.ts':
    'Model C. action · change · reason · consequence · confidence. STILL ORPHANED BY CHOICE, 2026-08-24, and the choice was made against live data rather than by reading the file. Its sibling (fitness-model) was surfaced on Today in the same pass; this one was held back because `recommendFromAdaptation` cannot currently keep rule two. Its STAY / MODIFY / PROTECT arms build `reason` from a SINGLE weakest dimension, and its PROGRESS arm re-renders `verdict.summary`, so its copy names one cause where the rule demands a convergence of three independent domains. On David\'s real adaptation verdict on 2026-08-24 `renderShort` also returned "Stay on the planned progression. Training is landing about as expected. Continuing on the planned progression." — the action and the tail of the reason are the same sentence, which breaks why-voice rule 5 verbatim, and the interpunct in its low-confidence tail breaks rule 1. Two honest repairs, both the owner\'s call: teach the composer to name the converging dimensions and de-duplicate action against reason, or delete it. Surfacing it as it stands would put a single-signal claim and a stutter on the most-read screen in the app.',
  'web-v2/lib/coach/strength-load.ts':
    'Support for strength-recommender. Deliberately dormant under the 2026-08-17 ruling, same as its parent.',
  'web-v2/lib/doctrine/resolve.ts':
    'Support for the doctrine registry. Gate machinery, correctly consulted only by check-doctrine.sh.',
  'web-v2/lib/doctrine/types.ts':
    'Support for the doctrine registry. Types for the gate above.',
  'web-v2/lib/training/form-tips.ts':
    'Form-metric definitions, bands and drills — "coach giving a one-thing-to-do". Its only importer is /api/tips, which the phone has a decode model for and never fetches. Wire the fetch or delete both ends.',
  'web-v2/components/redesign/graphics/DualPoint.tsx':
    'The /redesign tree. That direction was shipped and reverted on 2026-08-18 and is not the plan; its orphans are expected and are not this gate\'s business.',
};

/**
 * API ROUTES with no caller on any surface, and why each is allowed to be
 * there. `app/api/admin/**` is exempt structurally — those are invoked by hand
 * by an operator and always have been.
 */
export const ROUTE_CALLERS: Record<string, string> = {
  'web-v2/app/api/race/[slug]/block-preview/route.ts':
    'INSTANCE 3. The route half of block-preview.ts. See MODULE_ORPHANS.',
  'web-v2/app/api/coach/calibration/route.ts':
    'The calibration feature is unmounted end to end — four routes, no caller, and calibration_sessions.pillars unread. One decision covers all five.',
  'web-v2/app/api/coach/calibration/start/route.ts': 'See /api/coach/calibration.',
  'web-v2/app/api/coach/calibration/complete/route.ts': 'See /api/coach/calibration.',
  'web-v2/app/api/coach/calibration/status/route.ts': 'See /api/coach/calibration.',
  'web-v2/app/api/readiness/subjective/route.ts':
    'The write path for subjective_checkins.notes, also unread. The runner cannot reach the box.',
  'web-v2/app/api/coach/read/route.ts':
    'STILL UNCALLED, and now for a narrower reason than before. On 2026-08-24 the fitness half of this read was surfaced on iPhone Today under "Where you are" (lib/faff/fitness-read.ts), which retired the fitness-model orphan entry — but it composes from lib/fitness/fitness-model directly rather than fetching this route, because /api/v5/today already holds an open pool connection and a resolved runner date, and a server-side HTTP hop to itself would buy nothing but a second failure mode. So this route remains the aggregate view of four blocks, three of which are not surfaced anywhere: `adaptation` and `recommendation` are held back until recommendation.ts can keep rule two (see MODULE_ORPHANS), `limiter` came back single-signal at low confidence on live data, and `goal` duplicates the Targets surface. It is honest to keep as the one place the whole read can be inspected; it is not honest to call it "the surface" for any of them. Delete it, or wire the web command centre to it, once those three blocks are decided.',
  'web-v2/app/api/checkin/repair/route.ts':
    'Repair endpoint, invoked by hand after a bad check-in write.',
  'web-v2/app/api/cross-training/route.ts':
    'Cross-training was removed as a surface on 2026-08-17 alongside strength, data kept. The route is the data path that keeps working.',
  'web-v2/app/api/plan/generate/route.ts':
    'Server-to-server and operator entry into the generator. Called by onboarding and the crons through the library, not over HTTP.',
  'web-v2/app/api/plan/replan/route.ts':
    'Same shape as /api/plan/generate — the HTTP door onto lib/plan/replan-scenarios, used by hand and by the drift cron through the library.',
  'web-v2/app/api/tips/route.ts':
    'Half-built wire. native-v2/Faff/Faff/Models/Tips.swift exists as a decode model and API.swift never fetches it, so lib/training/form-tips.ts prose has no reader. Wire the fetch or delete both ends.',
};
