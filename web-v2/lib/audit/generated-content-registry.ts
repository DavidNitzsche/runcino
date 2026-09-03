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
    id: 'travel_windows.note',
    verdict: 'surfaced',
    holds: 'The runner\'s own label for a trip. "Thanksgiving". Runner-authored (the one prose column here the engine never writes), optional.',
    surface: { file: 'native-v2/Faff/Faff/ViewsV5/TravelV5.swift', token: 'note' },
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
    verdict: 'exempt',
    holds: 'Active streaks at snapshot time: [{"pillar":"sleep","direction":"below","days":14,"startDate":"2026-08-16"}]. Written nightly by lib/coach/readiness-snapshot.ts.',
    reason: 'UNREAD SINCE 2026-09-02, and the writer is what should be reconsidered, not the missing surface — the same posture as its sibling `pillars` above. It had exactly one reader: `lib/plan/adaptive-ramp.ts` gate 1, which graded a runner GREEN or not and so decided whether his plan was allowed to grow. The owner ruled that he decides how ready he is, that gate is deleted, and what replaced it (`acwrHeadroom`) reads the acute:chronic ratio off `runs` — training, not a readiness snapshot. Nothing else selects the column: `lib/coach/health-actions.ts` takes a `streaks` argument but is handed an in-memory array built from `history`, never this column, and every other reader of this table selects `score` and `band`. So the verdict is `exempt` rather than `internal`, and it says the column is unread rather than pretending a surface is owed one. The two honest repairs are the same two the `pillars` entry names: give it a reader that is legitimately allowed to exist under the ruling, or drop the column. Both are the owner\'s call.',
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
  // (workout_library.* entries removed 2026-08-28: the table is retired —
  //  migration 158 — and its rows live in code at
  //  lib/plan/workout-library-static.ts, so this DB-content registry no
  //  longer speaks for them. The same strings still surface on /workouts
  //  and the iPhone v5 Block library.)
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
  'web-v2/lib/adaptation/canonical/evaluate.ts':
    'THE CANONICAL ADAPTATION ENGINE\'S ONE ENTRY POINT, and the reason every other module in this directory is on this list. Built to docs/ADAPTATION_ENGINE_CONTRACT.md (locked 2026-09-03). IT HAS NO IMPORTER BECAUSE HAVING ONE IS THE THING THAT MUST NOT EXIST YET. docs/PLAN_SIMPLIFICATION_DOCTRINE.md defers adaptation outright: "upward and downward automatic adaptation stay disabled", "exactly one future adaptation boundary, disabled by default". The brief that produced this engine required it to be STRUCTURALLY incapable of mutating a plan rather than merely configured not to, so the absence of a caller is the deliverable and not an oversight. _cannot_mutate.test.ts guard 4 asserts that nothing under lib/ or app/ imports this directory, nested paths included, and fails the moment a caller appears. That guard exists because the pre-existing _zero_mutation_scan.test.ts guard 3 ratchets on a single path segment and therefore cannot see a nested import at all. The engine is exercised end to end by six test files including a 13-point historical replay with a no-lookahead tripwire, so this is not untested code: it is finished, gated, and waiting on an owner decision. WIRING IT IS THAT DECISION, per the contract\'s own promotion posture (a proposal is owner-visible and "does not promote automatically during the initial authority phase"), not a cleanup. THIS ENTRY EXPIRES when the owner grants the engine authority, at which point guard 4 and this list must be revised together.',
  'web-v2/lib/adaptation/canonical/input.ts':
    'Part of the canonical Adaptation Engine. See the entry for \'web-v2/lib/adaptation/canonical/evaluate.ts\' for why this whole directory is deliberately unwired, and gated that way. This module is the typed input surface, and its emptiness is load-bearing: the forbidden inputs (readiness, sleep, HRV, resting HR, TSB, self-declared experience) are excluded by the type having nowhere to put them, which _forbidden_inputs.test.ts asserts against the source.',
  'web-v2/lib/adaptation/canonical/decision-record.ts':
    'Part of the canonical Adaptation Engine. See the entry for \'web-v2/lib/adaptation/canonical/evaluate.ts\' for why this whole directory is deliberately unwired, and gated that way. The typed, versioned record every evaluation emits, including on a refusal. It is the answer to Rule 21\'s "a log that records that something happened but not what is not a log".',
  'web-v2/lib/adaptation/canonical/contract-constants.ts':
    'Part of the canonical Adaptation Engine. See the entry for \'web-v2/lib/adaptation/canonical/evaluate.ts\' for why this whole directory is deliberately unwired, and gated that way. Every bound the contract states with a tilde, resolved to a number exactly once with the sentence it came from, so no call site can form a second opinion about the same bound.',
  'web-v2/lib/adaptation/canonical/stimulus.ts':
    'Part of the canonical Adaptation Engine. See the entry for \'web-v2/lib/adaptation/canonical/evaluate.ts\' for why this whole directory is deliberately unwired, and gated that way. The five-outcome stimulus grader with the seven conditions and the one-noisy-channel rule. The simple pace-OR-HR rule it replaces was explicitly rejected by PROGRESSIVE_BASELINE_DOCTRINE.md Q12.',
  'web-v2/lib/adaptation/canonical/deterioration.ts':
    'Part of the canonical Adaptation Engine. See the entry for \'web-v2/lib/adaptation/canonical/evaluate.ts\' for why this whole directory is deliberately unwired, and gated that way. Q13\'s late-session deterioration detector, counted in sessions rather than segments.',
  'web-v2/lib/adaptation/canonical/admissibility.ts':
    'Part of the canonical Adaptation Engine. See the entry for \'web-v2/lib/adaptation/canonical/evaluate.ts\' for why this whole directory is deliberately unwired, and gated that way. Q27-Q29 lever-specific admissibility: an activity excluded from pricing pace still counts toward volume, and the record says so rather than silently dropping it.',
  'web-v2/lib/adaptation/canonical/plan-load.ts':
    'Part of the canonical Adaptation Engine. See the entry for \'web-v2/lib/adaptation/canonical/evaluate.ts\' for why this whole directory is deliberately unwired, and gated that way. The common projected plan-load representation the contract requires for evaluating the combined effect of proposals. Deliberately not a training-load model, and only ever read as a difference.',
  'web-v2/lib/adaptation/canonical/arbitration.ts':
    'Part of the canonical Adaptation Engine. See the entry for \'web-v2/lib/adaptation/canonical/evaluate.ts\' for why this whole directory is deliberately unwired, and gated that way. Plan-level arbitration: independent evidence, dependency-aware mutation, and suppressed proposals recorded with their reason.',
  'web-v2/lib/adaptation/canonical/levers/shared.ts':
    'Part of the canonical Adaptation Engine. See the entry for \'web-v2/lib/adaptation/canonical/evaluate.ts\' for why this whole directory is deliberately unwired, and gated that way. The verdict type every lever returns. No lever signature takes a GoalRequirement, which is how goal-poisoning is excluded structurally rather than by convention.',
  'web-v2/lib/adaptation/canonical/levers/threshold-pace.ts':
    'Part of the canonical Adaptation Engine. See the entry for \'web-v2/lib/adaptation/canonical/evaluate.ts\' for why this whole directory is deliberately unwired, and gated that way. The threshold-anchor evidence contract.',
  'web-v2/lib/adaptation/canonical/levers/weekly-volume.ts':
    'Part of the canonical Adaptation Engine. See the entry for \'web-v2/lib/adaptation/canonical/evaluate.ts\' for why this whole directory is deliberately unwired, and gated that way. The weekly-volume evidence contract.',
  'web-v2/lib/adaptation/canonical/levers/long-run.ts':
    'Part of the canonical Adaptation Engine. See the entry for \'web-v2/lib/adaptation/canonical/evaluate.ts\' for why this whole directory is deliberately unwired, and gated that way. The long-run-distance evidence contract.',
  'web-v2/lib/adaptation/canonical/_fixtures.ts':
    'A FIXTURE SET for the canonical Adaptation Engine, which is a fine reason by this gate\'s own text. It builds real CanonicalAdaptationInput values from the documented figures for the one real runner (a 7:10 threshold anchor, 47-50 mile weeks, a 16-mile long run, a December marathon) so all six test files drive the REAL engine from one corpus rather than six copies that would drift apart. Runtime code must never import it.',
  'web-v2/lib/adaptation/canonical/_falsify_gates.script.ts':
    'Same shape and same exemption as the three .script.ts siblings under lib/adaptation above: not a .test.ts that the default vitest include glob picks up, and deliberately so, because it MUTATES SOURCE FILES on purpose. It is Rule 18 executed. It plants a violation into each guarded file, runs that guard, asserts the guard FAILED, restores the file in a finally, and then verifies the restoration byte for byte. Nine guards are falsified this way, including the pre-existing _zero_mutation_scan.test.ts, which proves that scanner reaches this subdirectory. Run it by copying it to a .test.ts name; it is kept as a script so that a normal npm test run never rewrites files underneath itself.',
  'web-v2/lib/plan/injury-builder.ts':
    'DELIBERATE DEAD CODE, SEALED 2026-09-02, PENDING A PRODUCT DECISION THE OWNER HAS ALREADY SIGNALLED. `docs/PLAN_SIMPLIFICATION_DOCTRINE.md` puts `injury` and `automatic return-to-training ladders` on the removal list, and this module is the sharpest case on it: it ARCHIVES the runner\'s active marathon block and writes a walk-run plan in its place, and it used to fire off a `runner_injuries` row he typed in himself. It has no production importer because all three of its reachability conditions were removed — `detectInjuryActive` (the writer) is deleted from adapt.ts, the `injury_adjust` limb of app/api/coach/proposal/[id]/accept/route.ts (the acceptor) is deleted, and `buildInjuryPlan` itself now returns a refusal as its first statement, before any database read. `_injury_mode_sealed.test.ts` asserts all three and was falsified against each. WHY IT IS NOT SIMPLY DELETED: four LIVE doctrine claims read constants and helpers in this file and its `injury-protocols.ts` sibling against Research/05 at run time — INJURY.walk-run-ladder-is-encoded-verbatim, INJURY.walk-run-is-priced-at-the-runners-own-easy-pace, INJURY.walk-run-cadence-is-derived-from-the-ladder, INJURY.bsi-return-is-the-doc-band-and-clinician-gated. Deleting the code retires those claims, which is a decision rather than a cleanup, and the owner\'s own framing of the feature was "its noise. its a feature we can add in later." So the ladder survives as doctrine-bound DATA with its authority removed, which is the "observational only" posture the ruling asks for. There is deliberately NO feature flag: an earlier seal used an exported `INJURY_RETURN_MODE: false` and `_seal_single_seam.test.ts` rejected it, correctly — the owner asked for exactly one default-off adaptation boundary, and `NOT_A_SEAM` was not honestly available because building an injury plan IS a plan mutation. Reviving the mode means deleting a hardcoded return and writing a RUNNER-INITIATED entry point, not reviving a detector. THIS ENTRY EXPIRES when either that entry point lands or the owner rules the ladder out for good and the four claims are retired with it; `_injury_mode_sealed.test.ts` guard 5 fails if the claims disappear while this file is still here, so the two cannot drift apart.',
  'web-v2/lib/doctrine/runner-facing-violations.ts':
    'A GATE\'s registry, in the same posture as lib/audit/coercion-registry.ts and lib/audit/swallowed-failure-registry.ts: it is data for a check, and its only importer is _doctrine_gate.test.ts by design. It holds the doctrine exemptions that describe themselves as RUNNER-FACING — numbers a runner reads off his phone that disagree with the research the app cites for them — each acknowledged with an owner and what the runner actually sees. Runtime code must never import it: it records who owes a product decision, not a value anything should render. Added 2026-09-01 with the fix to check-doctrine.sh, which had run the doctrine suite with --silent and suppressed the "12 recorded violations" report on every build for as long as it existed.',
  'web-v2/lib/race/_race_outlook_fixture.ts':
    'A fixture set: builds a complete `RaceOutlookReads` from a handful of numbers so the race-pace brain\'s pure composition (`composeRaceOutlook`) can be driven with no database. Imported only by tests — _race_outlook_contract.test.ts, _race_projection.test.ts, _effective_target.test.ts, _target_continuity.test.ts — which is the whole point: the contract gate must not need production reads to run. Runtime code must never import it.',
  'web-v2/lib/adaptation/_shadow_run_absorption_split.script.ts':
    'A one-off diagnostic tool, not runtime code and not a `.test.ts` the default vitest include glob would pick up (its own header explains why: it needs the real production DB, read-only, the way lib/adaptation-harness does but without the write-safety fence, since it never mutates). Invoked directly via `npx vitest run --config vitest.shadow-run.config.ts`, which is the only caller by design — it exists to produce docs/reports/absorption-reader-split-2026-09-01.md\'s per-case diffs and Rule 9 continuity walk, a task done once for that report, not a mechanism anything else should import. Kept rather than deleted so the report\'s numbers stay reproducible against a later account state, matching the posture of the adaptation-harness scripts above it.',
  'web-v2/lib/adaptation/_season_sweep_absorption_duration.script.ts':
    'Same shape and same exemption as its sibling immediately above (`_shadow_run_absorption_split.script.ts`), extended to a season-wide sample: its own header says outright "NOT a gate. NOT part of `npm test`" and it is read-only end to end (`readAdaptationSplitWithLog` calls only `loadAdaptationInput` / `loadRepresentativeExecutionInput` / `classifyAdaptation` / read-only extra fetches; persistence is an `fs.appendFile` to a git-tracked JSONL log, never a DB write). Invoked directly via `npx vitest run --config vitest.shadow-run.config.ts`, which is the only caller by design — it drives docs/reports/absorption-dual-log-2026-09-01.md\'s season-wide disagreement-rate measurement across every real race window plus a weekly-cadence sweep, per the account owner\'s ruling not to promote `representative_execution` yet. Kept rather than deleted so the sweep stays reproducible against a later account state.',
  'web-v2/lib/adaptation/_falsify_reason_honesty.script.ts':
    'Same shape and same exemption as its two siblings immediately above: a one-off falsifier, not a `.test.ts` the default vitest include glob picks up, read-only against production (`readAdaptationSplit` only). Its own header says outright "Not a gate, not part of `npm test`" and names its only caller — `npx vitest run --config vitest.shadow-run.config.ts` — directly. It captures `representative_execution`\'s summary text across the real 2026-08-16..2026-08-23 AFC episode for docs/reports/adaptation-reason-honesty-fix-2026-09-01.md\'s before/after comparison. Kept rather than deleted so that report\'s claim stays reproducible against a later account state.',
  'web-v2/lib/adaptation-harness/fence.ts':
    'A GATE, and the one that keeps the other four safe. It is the write-safety fence for the adaptation harness (CLAUDE.md Rule 21): a pure predicate over DATABASE_URL plus an assertion that throws unless the connection string is loopback AND names the harness\'s own local scratch database. Every other module in the directory calls assertHarnessDatabase() at module scope before importing the pool, and lib/adaptation-harness/falsify.harness.test.ts drives it against a production-shaped URL and asserts it refuses. Runtime code must never import it — a fence something in production consults is a fence something in production can be made to answer differently.',
  'web-v2/lib/adaptation-harness/substrate.ts':
    'TEST-ONLY BY CONSTRUCTION. The adaptation harness\'s substrate: it copies the owner\'s real production rows into a local scratch database and slides one of his real training blocks onto today, so the three worlds of CLAUDE.md\'s hero statement can be driven against a runner with an actual history (Rule 15 — the 11,598-archetype sweep has no history fields at all). It WRITES plan rows, which is exactly why it is fenced: assertHarnessDatabase() runs at module scope and throws before a pool exists unless DATABASE_URL names the harness database, and lib/adaptation-harness is excluded from vitest.config.ts so `npm test` cannot load it. Runtime code must never import it.',
  'web-v2/lib/adaptation-harness/drive.ts':
    'TEST-ONLY. Thin wrappers that call the SHIPPED adaptation path — the run-adaptations route\'s own POST handler, detectAdaptations, applyAdaptations, tryAdaptiveBump, recomputePacesForPlan, loadProgressionWeek — so the harness proves things about the engine rather than about a model of it (Rule 13\'s fixture trap, one level up). Nothing here reimplements engine logic; that is the point of the file. Fenced the same way as substrate.ts.',
  'web-v2/lib/adaptation-harness/observe.ts':
    'TEST-ONLY. The harness reads what the RUNNER sees, through the app\'s own loadAdaptationInfoByPlanIds, so its assertions are "the prescription changed from X to Y and the app said why" rather than "the function returned a verdict object". The one thing it duplicates is the banner sentence, because that lives in a React component a node test cannot import — and adaptationVerbTableMatchesComponent reads the component\'s source at run time to keep the copy honest, so the mirror is gated rather than asserted in prose.',
  'web-v2/lib/adaptation-harness/report.ts':
    'TEST-ONLY. The harness\'s ledger. Every check is recorded as DATA — id, whether it binds, verdict, and a sentence naming the mechanism — which is what makes Rule 18 possible here: a check written as a bare expect() cannot be exercised in the failing direction without breaking the run, and falsify.harness.test.ts drives each mechanism red on purpose. It also carries the ratchet: an OPEN check that starts passing FAILS the run, so behaviour that lands forces its marker to be promoted rather than forgotten.',
  'web-v2/lib/plan/sim-matrix.ts':
    'A fixture set, which is a fine reason by this gate\'s own text. The archetype corpus was extracted from _sweep_allusers.test.ts on 2026-08-28 so the dosing-caps gate (_dosing_sweep_gate.test.ts) drives the IDENTICAL matrix as the sweep without importing a test file. Two gates import it; no runtime code should.',
  'web-v2/lib/plan/history-shapes.ts':
    'A FIXTURE SET, which is a fine reason by this gate\'s own text — the sibling of sim-matrix.ts, and imported by it. It holds the eight training-history shapes (and the owner\'s real 112 logged days) that let the archetype corpus express a runner with a past, which is what CLAUDE.md Rule 15 was locked about: resolveRampBase, baseRebuilt, the easy-day floor and the quality-density ramp were unreachable by all 11,598 archetypes because Arc had no history fields. Runtime code must never import it: production reads a runner\'s real history from `runs`, it does not render one.',
  'web-v2/lib/plan/authoring-shadow-compare.ts':
    'TEST-ONLY BY DESIGN, and INVERTED on 2026-09-01. It was written while `generate.ts` still authored every plan through the legacy VDOT cascade, to compare that path against the canonical layer without changing what any real caller persists. AUTHORING-CANONICAL-1 switched authoring over, so the real path is now the canonical one and THIS FILE HOLDS THE LEGACY RECONSTRUCTION — `legacyPricingFor`, `legacyShapedAnchors` and `legacySpecForComposedDay`, which are the only remaining places in the tree that build a pace the way the pre-migration engine did. That is exactly why it must stay orphaned from the runtime: a production importer would reintroduce the second truth Constitution 8 forbids, one merge away. Reachable only from `_authoring_shadow_compare.audit.test.ts` (real accounts) and `_authoring_shadow_compare.test.ts` (pure, plus the archetype corpus). It is also the source of every number in docs/reports/canonical-authoring-migration-2026-09-01.md.',
  'web-v2/lib/plan/block-preview.ts':
    'INSTANCE 3, STILL OPEN. Built 2026-08-18 to answer the owner\'s own question — why the shape of the next block stays invisible until recovery ends. Its route has no caller either. It should be WIRED, not deleted: the question was asked and the answer is written and tested. Wiring it needs a screen decision, so it stays named here rather than quietly removed.',
  // ── EIGHT ENTRIES LEFT THIS LIST ON 2026-08-31 (PRESCRIPTION-WIRE-1) ─────
  //
  // `pace-corpus.ts`, `durability-anchor.ts`, `capacity-resolver.ts` and
  // `runner-state.ts` were each listed here as DELIBERATELY UNWIRED, every one
  // of them ending "Should be WIRED, not deleted, once that pass lands." That
  // pass landed: `lib/plan/recompute-paces.ts` and `lib/plan/reanchor-plan.ts`
  // now reach all four through `lib/training/load-prescription-anchors.ts`, so
  // they have real importers and the ratchet correctly refuses to keep excusing
  // them.
  //
  // Recorded rather than silently deleted, because a vanished entry is how an
  // allowlist stops meaning anything — and because this is the gate reporting a
  // GOOD outcome, which is worth being able to find later. It was the check that
  // told us the wiring had landed, before any human looked at a plan row.
  //
  // Four more went with them, one layer down and for the same reason:
  // `prescription-resolver.ts` (the flex path calls it through the same shell),
  // and `activity-evidence.ts` / `load-activity-evidence.ts` / `reexamination.ts`
  // (which `capacity-resolver.ts` has always consumed, and which were only
  // orphaned because IT was). The Evidence Engine is now genuinely on a live
  // read path — its per-activity classification feeds the threshold reader's
  // corroboration bar — which is the wiring its own entry said it was waiting
  // for.
  //
  // `adaptation-engine.ts` and `load-adaptation-engine.ts` LEFT THIS LIST too,
  // for the same reason as the Evidence Engine above: `shadow-compare.ts`
  // (docs/PRODUCT_DECISIONS.md 2026-09-01 §2/§3) now calls them for real, from
  // the run-adaptations cron route, to compare the engine's own proposal
  // against live behavior without mutating anything. That is a genuine
  // non-test importer, so the entries are stale rather than deliberate — the
  // Adaptation Engine's PROMOTION to the live mutation path is still a
  // separate, held decision, but "is anything besides a test reaching this
  // file" is a different question, and the answer to that one changed.
  'web-v2/lib/plan/core.ts':
    'Stranded by block-preview. The shared id()/addDays()/mondayOf() primitives were extracted so the three plan builders stay drift-free; the extraction landed and the other builders never switched over. Dies or lives with block-preview.',
  'web-v2/lib/coach/strength-recommender.ts':
    'Deliberately dormant. Strength was removed as a SURFACE on 2026-08-17 (owner ruling: handled outside the app) with the data kept. The doctrine test is what stops the engine rotting while it is unmounted. Do not "fix" this by mounting it.',
  'web-v2/lib/coach/strength-status.ts':
    'Same ruling as strength-recommender. The weekly confirmed/skipped verdict has no surface because strength has no surface.',
  'web-v2/lib/doctrine/registry.ts':
    'A GATE. Test-only is its correct state — it is consulted by check-doctrine.sh, not at runtime.',
  'web-v2/lib/plan/probe-instant.ts':
    'A FIXTURE, which is a fine reason by this gate\'s own text. It holds the single instant the CIM audit harnesses must fake — 04:00 UTC = 21:00 PT the previous evening, the plan-drift cron\'s own tick. Four probes had independently hardcoded NOON PT on the following day and were auditing a block that would never be authored (37.5 mi first week against the real 43.5). One constant so they cannot drift apart again. Runtime code must never import it: production reads the clock, it does not fake one.',
  'web-v2/lib/audit/active-plan-exemptions.ts':
    'A GATE, same shape as the doctrine and derived registries: the argued exceptions to ACTIVEPLAN-1, read only by lib/audit/_active_plan_scan.test.ts. Runtime code must never import it — the point is that a query either names its plan or is listed here, and nothing should be able to consult the list to decide behaviour. The list is a ratchet and the scanner fails when an entry goes stale, so it cannot rot in place.',
  'web-v2/lib/audit/normal-window-registry.ts':
    'A GATE, same shape as active-plan-exemptions.ts: the argued exceptions to RULE 8 (a taper or a recovery window is never the runner\'s normal), read only by lib/audit/_normal_window_scan.test.ts and check-normal-window.sh. Runtime code must never import it — the point is that a habit reader either excludes the prescribed window or is listed here, and nothing should be able to consult the list to decide behaviour. It carries three lists, all self-policing: the exemptions are a ratchet, the count-pinned hand-off fails in BOTH directions so a repair expires it, and every registered reader is asserted to still exist under its own name.',
  'web-v2/lib/runs/derived-registry.ts':
    'A GATE. Same shape as the doctrine registry: the list of places two stored values describe one thing, consulted by lib/runs/_coherence_gate.test.ts and check-derived-consistency.sh, never at runtime. The reconciler it documents (lib/runs/coherence.ts) IS wired, on every surface that prints a pace or a duration; this file holds the winner rules, the production counts and the controls that prove each guard fires.',
  'web-v2/lib/audit/sql-scan.ts':
    'A GATE. Same shape as the doctrine registry: consulted by _generated_content_gate.test.ts and check-generated-content.sh, never at runtime.',
  'web-v2/lib/audit/anchor-derivation-registry.ts':
    'A GATE, same shape as active-plan-exemptions.ts: the ANCHORSTAMP-1 inventory for CLAUDE.md Rule 10 — every site that writes a value derived from a physiological anchor (LTHR, HRmax, VDOT) into a persisted column, with the posture it takes and an argued reason. Read only by lib/audit/_anchor_derivation_scan.test.ts and scripts/check-anchor-derivation.sh. Runtime code must never import it: the whole point is that a derivation either reads its anchor live or is listed here, and nothing should be able to consult the list to decide what to write. The list is a ratchet in three directions — a fixed site, a rotted anchor string and a removed builder fork each fail until the entry is deleted — so it cannot rot in place.',
  'web-v2/lib/audit/anchor-derivation-scan.ts':
    'A GATE. Same shape as swallow-scan.ts: the argument-position parser behind ANCHORSTAMP-1, consulted by _anchor_derivation_scan.test.ts, never at runtime. Split out of the test file specifically so the positive and negative controls exercise THE SAME code path that guards the repo — Rule 18 point 1, since a control running a different function proves nothing about the guard. It finds a physiological anchor passed to a spec builder as a literal null, or omitted entirely, which is the shape that wiped every rebuilt quality session\'s HR target and both its contingency rules.',
  'web-v2/lib/audit/module-graph.ts':
    'A GATE. Same as sql-scan.ts.',
  'web-v2/lib/audit/client-graph.ts':
    'A GATE. Same shape as module-graph.ts, which it extends: consulted by lib/audit/_client_graph.test.ts and check-client-graph.sh, never at runtime. Written 2026-08-30 after `main` failed to deploy for a full day — `ProfileView.tsx` is a client component and imported a constant from a module that reached `lib/db/pool` three hops down through a dynamic import, so webpack pulled `pg` into the browser graph and `next build` died on fs/dns/net/tls while tsc and all twelve prebuild gates reported green. Test-only is its correct state, and strictly so: it derives the client boundary from the `\'use client\'` directives in source, and a runtime importer would be a second reader of a fact that must only ever be read from the source itself.',
  'web-v2/lib/audit/automatic-mutation-registry.ts':
    'A GATE. Same shape as the doctrine registry: the inventory of everything that changes a runner\'s data without the runner asking, consulted by lib/audit/_automatic_mutations.test.ts and check-automatic-mutations.sh, never at runtime. Written 2026-08-25 after the plan-drift cron replaced the owner\'s training block overnight with nothing on any surface saying so. Test-only is its correct state — the gate derives the plan-writer set from source and makes this list agree, so wiring it into the app would only give it a second, unchecked reader.',
  'web-v2/lib/audit/generated-content-registry.ts':
    'A GATE. This file.',
  'web-v2/lib/faff/surface-sweep-matrix.ts':
    'A GATE. Same shape as the doctrine registry: the runner states, data shapes, boundaries and rules that _surface_sweep.test.ts and check-surface-sweep.sh drive, never consulted at runtime. It is deliberately a separate module rather than inlined in the test so the cold half of check-surface-sweep.sh can count the axes and the rules with sed on a container that has no toolchain.',
  'web-v2/lib/plan/anchor-fit.ts':
    'A GATE. Same shape as the doctrine registry: the checks that ask whether a plan\'s ANCHOR fits the runner it was measured from, consulted by lib/plan/_anchor_fit.test.ts, never at runtime. It is a separate module rather than inlined in the test for one reason — the checks are pure predicates over an AnchorFacts record, so the same code that grades sixteen real runner shapes also grades planted-bad fact sets, and the gate can prove it still sees the defect it was written for (the owner\'s 29-mi anchor against a 47-mi runner). A gate whose predicates are only ever run on healthy input is a gate that cannot tell you it is broken.',
  'web-v2/lib/audit/swallow-scan.ts':
    'A GATE. Same shape as sql-scan.ts: consulted by _swallow_scan.test.ts and check-swallowed-failure.sh, never at runtime. It finds the places where a database failure becomes a plausible answer — the `.catch(() => empty)` that hid four broken date_iso comparisons for months.',
  'web-v2/lib/audit/swallowed-failure-registry.ts':
    'A GATE. The argued exemption list swallow-scan.ts is checked against, plus the empty-result ratchet. Test-only is its correct state.',
  'web-v2/lib/audit/coercion-scan.ts':
    'A GATE. swallow-scan.ts\'s mirror image, and deliberately built ON its parser rather than forking it: that one asks whether a FAILURE became a value, this one asks whether a VALUE became an absence. Consulted by _coercion_scan.test.ts and check-coercion.sh, never at runtime. It closes the half of Rule 11 the rule\'s own enforcement paragraph names as ungated — `recentQualityPerWeek > 0 ? x : undefined` turned a correct, measured zero into "no signal", which the caller answered with FULL quality density. It also covers the failures swallow-scan structurally cannot reach: a blind catch on a HELPER call rather than on `pool.query(`, which is why fixed bugs here keep returning one indirection later.',
  'web-v2/lib/audit/coercion-registry.ts':
    'A GATE. The argued exemption list coercion-scan.ts is checked against, plus a NAMED load-bearing ratchet, a peripheral count ratchet, and the HANDED_BACK findings in files their session did not own. Test-only is its correct state, same as swallowed-failure-registry.ts.',
  'web-v2/lib/db/_test-db.ts':
    'A FIXTURE, which is a fine reason by this gate\'s own text. One predicate — does this test process have a DATABASE_URL — imported by the two suites that read production rows (_open_block_authoring.test.ts, _wave1_smoke_dryrun.test.ts) so they skip rather than fail with ECONNREFUSED where there is no database. Test-only is its correct state: runtime code must never branch on whether a database exists. It is a module rather than a line duplicated in both suites so the two cannot drift into disagreeing about what "has a database" means, which is the same reason vitest.setup.ts is one file and not two.',
  'web-v2/lib/audit/timezone-date-scan.ts':
    'A GATE. Same shape as swallow-scan.ts: consulted by _timezone_date_scan.test.ts, never at runtime. It finds a `timestamp with time zone` column (ts, recorded_at, logged_at, cleared_at, created_at, fetched_at) cast bare to `::date` and compared against a runner\'s local calendar day — the shape that blanked the "On the belt" treadmill card on 2026-08-27 by silently mismatching a UTC-stamped coach_intents row against the runner\'s Pacific "today". Zero-tolerance, unlike the swallow-scan ratchet — the 2026-08-27 sweep fixed every known site the same day.',
  'web-v2/lib/audit/timezone-date-exemptions.ts':
    'A GATE. The argued exemption list timezone-date-scan.ts is checked against. Test-only is its correct state, and it is expected to stay empty — see the module doc for why this bug class gets no ratchet.',
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
