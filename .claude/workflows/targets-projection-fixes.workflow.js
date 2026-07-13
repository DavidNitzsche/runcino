export const meta = {
  name: 'targets-projection-fixes',
  description: 'Implement the audited Targets projection fixes: execution reflects a real break, accrual stops crediting calendar time, "Stalled" is relabelled when runway-limited, and the native card stops contradicting itself. Doctrine-locked: NO fitness-decay/measurement model.',
  phases: [
    { title: 'Implement' },
    { title: 'Verify' },
  ],
}

// ─────────────────────────────────────────────────────────────────────────
// FROZEN SPEC — the shared contract every implementer codes against.
// Doctrine (LOCKED, do not violate): fitness response is ASSUMED, not
// measured; execution is the lever. So we do NOT add a fitness-decay model.
// We (a) make EXECUTION reflect a real break, (b) stop the TODAY line
// crediting calendar time, (c) relabel the runway-limited case so a
// 100%-execution runner is never told their body "stalled", (d) remove the
// card's self-contradictions. New payload key introduced this pass:
// `runwayLimited: boolean`. Tunable defaults (David-confirmable) are marked
// [TUNABLE] — implement the default, leave a clearly-commented single
// constant so the number can be changed in one place.
// ─────────────────────────────────────────────────────────────────────────

const CONTRACT = `
SHARED CONTRACT (all files must agree):
- New trajectory field + payload key: runwayLimited: boolean.
  true IFF projectFitnessTrajectory clamped the PLANNED (future) gain by the
  runway term (buildWeeks * BASE_BUILD_RATE * exec) rather than by execution
  or the plan ceiling — i.e. the goal is limited by time remaining, not by
  the runner. Route echoes traj.runwayLimited into the JSON as runwayLimited.
  Native decodes runwayLimited: Bool? into ProjectionSummary.
- executionQuality semantics unchanged in RANGE (0..1) but now MOVES for a
  break: a scheduled-but-unrun recent key session lowers it; extended
  inactivity decays it. execOk stays (>= 0.80) but a full week off must push
  strictly BELOW 0.80.
- Accrued TODAY (trajectoryAccruedSec) must never read FASTER than the anchor
  predictRaceTime(currentVdot) when executed work is absent; it credits
  executed work, not elapsed calendar time.
- Coach voice: no exclamation marks, no emoji, no em dashes. "." separators
  per app label grammar. Never assert toward a "-" placeholder.
`;

const FILES = [
  {
    key: 'goal-projection',
    label: 'A · goal-projection.ts',
    scope: `FILE: web-v2/lib/training/goal-projection.ts

S1 · executionQuality must reflect a break (execution is the lever).
- Today executionQualityFromTestPoints() averages ONLY completed-session
  verdicts, so a rest week (no new sessions) keeps q at its prior value.
- Add absence awareness:
  * Compute daysSinceLastRun (most recent honest run, runner-local).
  * Compute recentMissedKey = key workouts (long/tempo/threshold/intervals)
    whose date_iso is in the PAST within the last 14 runner-local days with
    NO matching completed run (deduped: NOT data ? 'mergedIntoId' AND
    absorbed_into_canonical_at IS NULL; date match COALESCE(data->>'date',
    LEFT(data->>'startLocal',10)) = date_iso).
  * Fold each recentMissedKey in as a low-score data point (treat a full skip
    as 0.0, recency-weighted alongside completed verdicts) so absence pulls q
    down instead of being invisible.
  * Add an inactivity decay: if daysSinceLastRun >= STALE_ONSET_DAYS [TUNABLE
    default 7], multiply q by a factor decaying linearly to STALE_FLOOR
    [TUNABLE default 0.5] at 14 days. Single named consts, commented.
- Net acceptance: a modeled 7-consecutive-day break yields executionQuality
  < 0.80.

S2 · detectMissedKeyWorkoutDrift (~line 1405).
- Replace server-UTC CURRENT_DATE window bounds with runner-local today
  (thread runnerToday(userUuid), as loadRecentTestPoints already does).
- Add absorbed_into_canonical_at IS NULL and the ::uuid cast on user_uuid to
  the completed-EXISTS subquery (match the sibling queries).
- Promote weight: a FULL missed week (>= 7 consecutive days containing >=1
  scheduled key session, none completed) => weight:'medium' [TUNABLE], so the
  status ladder can reach 'watching' on one bad week. Scattered sub-week
  misses stay 'weak'. Keep the existing 0.30-of-window signal as an
  additional stronger trigger.

S3 · Data-join integrity in loadRecentTestPoints (~882) and loadNextTestPoints (~510).
- Both: collapse to ONE canonical run per plan day before LIMIT (DISTINCT ON
  (pw.id) ... ORDER BY pw.id, <canonical pick>), so a double-ingest can't
  double-count into the recency-weighted execution average.
- Both: change the run/plan-day date match to
  COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10)) = pw.date_iso
  (currently only detectMissedKeyWorkoutDrift uses COALESCE).

DO NOT touch fitness-trajectory.ts, route.ts, or any Swift file — other
implementers own those. Keep executionQualityFromTestPoints' exported
signature stable for its caller; add new inputs via new params with
defaults or a new helper it composes.`,
  },
  {
    key: 'fitness-trajectory',
    label: 'B · fitness-trajectory.ts',
    scope: `FILE: web-v2/lib/training/fitness-trajectory.ts

S5 · trajectory math.
- Scale the runway cap by execution so a missed block reduces projected gain
  even when the runway is the binding constraint:
    runwayCapGain = buildWeeks * BASE_BUILD_RATE * executionQuality
  (currently exec only scales the goal-gap term, which is irrelevant when the
  runway cap binds — so a break produces zero projection penalty on short
  runways). [TUNABLE: this is the one model tweak; keep BASE_BUILD_RATE as-is,
  apply exec as the multiplier shown.]
- Compute reachable, aheadOfGoal, and the gain used by the route's buildRatio
  from UNROUNDED internals; round ONLY for display fields. A sub-0.05
  arithmetic swing must not flip reachable/verdict.
- Add to the FitnessTrajectory interface and the return value:
    runwayLimited: boolean
  = true IFF the planned (future) gain was clamped by runwayCapGain rather
  than by gainCap(=min(MAX_BLOCK_GAIN, planCeilingGain)) or by execution.
  (i.e. Math.min(gainCap, runwayCapGain) === runwayCapGain AND
   (goalVdot-currentVdot)*executionQuality >= runwayCapGain.)

DO NOT change projectFitnessTrajectory's parameter list (callers depend on
it). Only internal math + the additive return field. Do not touch other
files.`,
  },
  {
    key: 'route',
    label: 'C · route.ts',
    scope: `FILE: web-v2/app/api/targets/projection/route.ts

S4 · Accrual honesty (trajectoryAccruedSec block ~451-473).
- Replace the pure-calendar completedFraction with an execution-weighted
  fraction so TODAY credits work done, not weeks elapsed:
    accruedVdot = vdot + traj.projectedGainVdot
                        * min(calendarFraction, executedFraction)
  where executedFraction reflects completed vs scheduled-to-date key work
  (reuse traj.executionQuality as the weight if a cleaner per-plan executed
  ratio isn't readily available: completedFraction * traj.executionQuality).
- Hard clamp: trajectoryAccruedSec must never be faster than
  predictRaceTime(vdot, distanceMi) (the anchor). During a break TODAY must
  NOT speed up.

S6/S8 · Payload + reconciliation.
- Echo traj.runwayLimited into the JSON as runwayLimited (default false).
- summaryLine is already composed + returned (composeTargetsSummaryLine) —
  keep it. Ensure the status passed to it cannot say on_track when
  executionQuality < 0.80 (reconcile: if traj.executionQuality != null &&
  traj.executionQuality < 0.80 && rawStatus === 'on_track', demote to
  'watch'). Keep the existing reconcileStatusWithConfidence call.
- Do NOT relabel copy here (Swift owns the FITNESS word); just expose
  runwayLimited and keep summaryLine execution-honest.

DO NOT touch goal-projection.ts, fitness-trajectory.ts, or Swift. Code to the
runwayLimited key name exactly.`,
  },
  {
    key: 'native',
    label: 'D · native Swift card',
    scope: `FILES: native-v2/Faff/Faff/Models/ToolkitPayloads.swift
        native-v2/Faff/Faff/Components/Toolkit/K_TargetsProjection.swift

S7 · Adopt the server sentence + kill contradictions.
- ToolkitPayloads.swift ProjectionSummary: add
    let summaryLine: String?
    let runwayLimited: Bool?
  and their CodingKeys (snake/camel to match the JSON keys "summaryLine",
  "runwayLimited"). Use decodeIfPresent.
- K_TargetsProjection.swift:
  * Render summary.summaryLine when present (Text(summary.summaryLine ??
    fallback)); demote the hardcoded per-state summaryLine property to a
    dash-free OFFLINE fallback only (and remove the ".off" 'Missed key runs'
    causal claim — it must not assert a cause the payload doesn't support).
  * todayEyebrow: replace the literal "BUILD WK" with the actual phase label,
    e.g. "\\(youPhase.label.uppercased()) WK x/y" (=> "PEAK WK 1/3"). Cold
    fallback "TODAY" stays.
  * Extract ONE weekInPhase helper feeding todayEyebrow, phaseMeta, and
    youProgress (currently duplicated 3x); resolve current-week by ARRAY
    position of the isCurrent week to avoid mixing array-offset with week_idx.
  * Neutral nil fallbacks: when summary.executionQuality == nil or buildRatio
    inputs are nil, render "-"/neutral (NOT green/100%/Responding/ON PACE);
    ensure the dataless path routes to TargetsProjectionColdState.
  * youProgress: when weeks/phaseWeeks empty, place the YOU marker at phase
    start (0.0), not the fabricated 0.42.

S6 (client) · FITNESS relabel.
- When summary.runwayLimited == true AND execOk, the FITNESS read must NOT be
  "Stalled". Show a runway-framed value (e.g. "On runway" or "Time-limited",
  pick the cleaner coach-voice label) and keep the tick neutral, not the alert
  "!". Reserve Stalled/Lagging/Responding for execution/plan-limited cases.

DO NOT touch any web-v2 file. Match the JSON keys exactly. Preserve the
existing header-pill / Theme token usage and layout.`,
  },
  {
    key: 'tests',
    label: 'E · invariant tests',
    scope: `FILE: create web-v2/lib/training/_targets_projection_invariants.test.ts
(worktrees may lack node_modules — write standard vitest; correctness is
verified by reading, not necessarily running).

Cover (pure-function level where possible; stub inputs):
1. projectFitnessTrajectory: a short-runway goal-gap case sets
   runwayLimited === true; a long-runway clean-execution case sets it false.
2. runway cap scales with executionQuality: lower exec => lower
   projectedGainVdot even when runway binds.
3. reachable/verdict computed from unrounded internals: a case that would
   flip under 0.1 rounding does NOT flip.
4. executionQualityFromTestPoints (+ absence helper): a modeled 7-day break
   (recent missed key sessions + daysSinceLastRun>=7) yields q < 0.80; a
   clean week yields q >= 0.80.
5. Accrual clamp: accrued time never faster than the anchor when
   executedFraction is low.
Do NOT edit product files; only add the test file.`,
  },
];

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'applied', 'changesSummary', 'editCount', 'selfAudit'],
  properties: {
    file: { type: 'string' },
    applied: { type: 'boolean', description: 'true if edits were written to disk' },
    changesSummary: { type: 'string', description: 'what changed, per spec item (S1/S2/...)' },
    editCount: { type: 'number' },
    tunablesUsed: { type: 'array', items: { type: 'string' }, description: 'named consts + default values introduced' },
    selfAudit: { type: 'string', description: 'type/compile trace done by hand (no node_modules): why it compiles + honors the contract' },
    risks: { type: 'array', items: { type: 'string' } },
  },
};

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'verdict', 'issues', 'contractHonored'],
  properties: {
    file: { type: 'string' },
    verdict: { type: 'string', enum: ['pass', 'fixed', 'fail'] },
    contractHonored: { type: 'boolean', description: 'runwayLimited key + doctrine + no cross-file edits' },
    issues: { type: 'array', items: { type: 'string' } },
    fixesApplied: { type: 'array', items: { type: 'string' } },
    residualRisks: { type: 'array', items: { type: 'string' } },
  },
};

phase('Implement');
log(`Implementing ${FILES.length} file-scoped change sets against the frozen spec (doctrine-locked: no fitness-decay model).`);

const results = await pipeline(
  FILES,
  // Stage 1 — implement this file's slice, editing the real files. File sets
  // are disjoint across items so parallel edits never touch the same file.
  (f) => agent(
    `You are implementing part of an approved fix to the Faff Targets projection. Make the REAL code edits now (use Edit/Write). You are one of several implementers; touch ONLY the files named in your scope — the others are owned by peers and editing them will cause conflicts.

${CONTRACT}

YOUR SCOPE:
${f.scope}

Rules:
- Read the target file(s) fully before editing. Make minimal, surgical edits that match surrounding style.
- Worktrees may lack node_modules; you cannot run tsc. Verify by tracing types/signatures by hand and keeping changes local.
- Honor the doctrine: do NOT introduce any fitness-decay/measurement of physiological fitness. Execution and accrual honesty only.
- Use single named constants for every [TUNABLE] number with the given default, clearly commented so it can be changed in one place.
- Return the structured summary. Set applied=true only if you actually wrote the edits.`,
    { label: `impl:${f.key}`, phase: 'Implement', schema: IMPL_SCHEMA, effort: 'high' },
  ),
  // Stage 2 — adversarial verify + fix the SAME file (sequential after stage 1
  // for this item, so no concurrent write to one file).
  (impl, f) => agent(
    `You are adversarially verifying (and fixing if needed) an implementation in the Faff Targets projection. Read the current on-disk state of the file(s) in scope and the diff vs git HEAD.

${CONTRACT}

SCOPE THAT WAS IMPLEMENTED:
${f.scope}

IMPLEMENTER REPORTED:
${JSON.stringify(impl)}

Check hard:
- Does it actually satisfy every S-item in scope? Quote the new code.
- Contract: is the runwayLimited key name exact? Doctrine honored (no fitness-decay)? Did it edit ONLY its own files (git diff --name-only must list only in-scope files)?
- Correctness by hand-trace (no node_modules): types line up, no undefined symbols, SQL is valid, Swift decodes the new keys, coach-voice copy rules honored (no em dashes/exclamations/emoji, never asserts toward "-").
- Acceptance tests from the spec (e.g. 7-day break => executionQuality < 0.80; TODAY never faster than anchor; runwayLimited set correctly).
If you find defects, FIX them in place (Edit/Write) and set verdict='fixed'. If clean, verdict='pass'. Only verdict='fail' if you cannot fix it. Return the structured verdict.`,
    { label: `verify:${f.key}`, phase: 'Verify', schema: VERIFY_SCHEMA, effort: 'high' },
  ),
);

const clean = results.filter(Boolean);
const failed = clean.filter((r) => r?.verdict === 'fail');
log(`Done. ${clean.length}/${FILES.length} change sets processed. ${failed.length} unresolved.`);

return {
  summary: clean.map((r) => `${r.file}: ${r.verdict}${r.issues?.length ? ' — ' + r.issues.join('; ') : ''}`),
  unresolved: failed,
  note: 'Edits are on the working tree. Main loop must: run web tsc + the new invariant test + a native DerivedData build, review the full diff, then gate commit/push/deploy on David.',
};
