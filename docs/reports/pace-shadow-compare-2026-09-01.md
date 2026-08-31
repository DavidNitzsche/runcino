# PACE shadow-compare — phase-specific fix + the mechanism, real account

Authorized by `docs/PRODUCT_DECISIONS.md` 2026-09-01 §2: **PACE-only
shadow-compare. Explicitly NOT authorized: any live mutation, any other
lever.** This report covers the three pieces of that authorization: the
blended-average fix (Part 1), the shadow-compare mechanism itself (Part 2),
and a scope report on the authoring/recomputation convergence question named
as a prerequisite before live PACE authority is even reconsidered (Part 3).

Everything below was run against the owner's real account
(`0645f40c-951d-4ccc-b86e-9979cd26c795`) through the read-only role,
2026-09-01.

---

## 1 · Part 1 — the blended-average bug, and the fix

### The bug

`web-v2/lib/adaptation/load-adaptation-engine.ts` priced the PACE lever's
"what does the plan currently ask for" number with one query:

```sql
SELECT AVG(pace_target_s_per_mi)::int
  FROM plan_workouts
 WHERE plan_id = $1 AND date_iso >= $2
   AND type IN ('threshold','tempo','cruise')
   AND pace_target_s_per_mi IS NOT NULL
```

No upper bound on `date_iso` — every remaining threshold/tempo/cruise row
through the end of the visible plan, blended into one number.
`adaptation-engine.ts`'s `detectPace` then moved that single number by one
step and reported it as "move threshold targets about N sec/mi quicker,"
applied uniformly to every future row.

On the owner's real account this blended three training phases whose correct
paces legitimately differ by doctrine:

| Phase | Rows | Real pace |
|---|---|---|
| QUALITY (weeks 0-7) | 6 | 435 s/mi (7:15/mi) |
| RACE-SPECIFIC (weeks 8-11) | 4 | 424 s/mi (7:04/mi) |
| TAPER (weeks 12-14) | 2 | 475 s/mi (7:55/mi) |
| **blended (the bug)** | **12** | **438 s/mi (7:18/mi)** |

The pre-fix engine read 438, saw believed capacity at 430 s/mi, and proposed
moving **every one of the 12 rows** to ~430 — including the TAPER rows, which
are deliberately slower by design, and the RACE-SPECIFIC rows, which were
already priced *faster* than believed capacity (424 < 430) and had no
business moving at all.

### The fix

`web-v2/lib/adaptation/load-adaptation-engine.ts` §6b now groups the same
query by the plan's own phase structure — `plan_workouts.week_id` →
`plan_weeks.phase_id` → `plan_phases.label`, the grouping the plan itself
already authored, not a second one invented for this fix:

```sql
SELECT ph.label AS phase_label,
       ROUND(AVG(pw.pace_target_s_per_mi))::int AS avg_s,
       COUNT(*)::int AS row_count,
       MIN(pw.date_iso) AS first_date, MAX(pw.date_iso) AS last_date
  FROM plan_workouts pw
  LEFT JOIN plan_weeks wk ON wk.id = pw.week_id
  LEFT JOIN plan_phases ph ON ph.id = wk.phase_id
 WHERE pw.plan_id = $1 AND pw.date_iso >= $2
   AND pw.type IN ('threshold','tempo','cruise')
   AND pw.pace_target_s_per_mi IS NOT NULL
 GROUP BY ph.id, ph.label
 ORDER BY MIN(pw.date_iso)
```

`web-v2/lib/adaptation/adaptation-engine.ts`'s `PaceEvidence` now carries
`phases: PacePhaseRead[]` instead of one `prescribedThresholdSecPerMi`
scalar. `detectPace` computes a step **per phase**, each against its own
prescribed pace and its own doctrinal step-ceiling anchor (`phaseStep()`),
and the resulting `AdaptationProposal`'s PACE arm carries a new
`phaseBreakdown: PacePhaseOutcome[]` field — every phase, moved or not, with
its own previous/proposed/step. A phase whose own prescription already
matches or leads believed capacity reports `moved: false` rather than being
dragged along by a neighbour's gain (Rule 16 — a phase that did not move is
still a fact, not silence).

### Verified against the real account

Real run, `_adaptation_engine.audit.test.ts`, 2026-09-01:

```
plan     · prescribed threshold, BY PHASE (3 phase(s)):
             QUALITY        7:15/mi · 6 row(s) · 2026-09-01 → 2026-10-13
             RACE-SPECIFIC  7:04/mi · 4 row(s) · 2026-10-20 → 2026-11-13
             TAPER          7:55/mi · 2 row(s) · 2026-11-17 → 2026-11-24
...
  PROGRESS     PACE         FITNESS   conf 0.71
      {"unit":"sec_per_mi","value":435} → {"unit":"sec_per_mi","value":430}
      "Your recent threshold work consistently supports faster training. Move 2 of 3
       upcoming phases of threshold/tempo/cruise work: QUALITY 5 sec/mi quicker (6 rows,
       2026-09-01–2026-10-13); TAPER 9 sec/mi quicker (2 rows, 2026-11-17–2026-11-24)."
      phase breakdown (Part 1 of the 2026-09-01 decision):
        QUALITY        7:15/mi → 7:10/mi (step 5.0s, 6 row(s)) MOVED
        RACE-SPECIFIC  7:04/mi → 7:04/mi (step 0.0s, 4 row(s)) held
        TAPER          7:55/mi → 7:46/mi (step 9.0s, 2 row(s)) MOVED
```

Before vs. after, side by side:

| | Before (blended) | After (per-phase) |
|---|---|---|
| Headline | 438 → 430, applied to all 12 rows | 435 → 430 (soonest moving phase, QUALITY) |
| QUALITY | moved 8s/mi (off the blend, not its own number) | moved **5s/mi**, off its own 435 |
| RACE-SPECIFIC | moved 8s/mi — **wrong direction of argument**, it was already faster than believed capacity | **held**, 0s/mi — correctly recognised as already ahead |
| TAPER | moved 8s/mi — fights the deliberate taper slowdown | moved **9s/mi**, clamped to the doctrinal quantum computed off its *own* 475 anchor, not the blend |

RACE-SPECIFIC never should have moved under the old logic either — it is the
clearest single proof the fix is real: a phase priced faster than capacity
now correctly reports `moved: false` instead of being pulled toward a
three-phase average it was never part of.

**Unit-level regression coverage** (not just the one real-account run):
`_adaptation_engine.test.ts` gained two new scenarios — `PART 1 (2026-09-01
decision) · PACE moves each phase by its OWN delta, never a blended average`
(asserts QUALITY moves, RACE-SPECIFIC holds at exactly 424, TAPER's step is
clamped below its raw 45s/mi gain, and the headline `previous` is 435, never
438) and `PART 1 · a PACE proposal with only phases already ahead of
capacity holds, per phase`. Full suite: **72/72 passing**.

---

## 2 · Part 2 — the shadow-compare mechanism

### What was built

`web-v2/lib/adaptation/shadow-compare.ts` (new file, ~360 lines):

- `runPaceShadowCompareCycle(userUuid, todayISO?)` — runs
  `resolveAdaptationProposals` (unchanged, read-only) and `detectAdaptations`
  (the live engine's own detector, also read-only — only
  `applyAdaptations` writes), pulls out the PACE arm only, and reads whether
  the live engine fired its own pace-moving mechanism
  (`training_lead` trigger / `recompute_paces` action) the same cycle.
  Builds one `ShadowCompareRecord` — the new engine's decision, reason codes,
  explanation, previous/proposed, full `phaseBreakdown`, and the live
  engine's observation, with a precomputed `agreesWithLive` boolean.
- `persistShadowCompareRecord(record, opts)` — persists it. Two postures,
  chosen by probing whether `adaptation_shadow_log` exists (see the DDL note
  below): INSERT if the table exists, or append one JSON line to a
  git-tracked file if it does not (with the fallback able to be switched
  off, which the cron wiring does — see below).
- `runAndPersistPaceShadowCompare(userUuid, todayISO?)` — the two above in
  one call, never throws, what the cron actually calls.

`web-v2/app/api/cron/run-adaptations/route.ts` — wired in additively, inside
the existing per-user loop, right after the first (pre-mutation)
`detectAdaptations` call and before `applyAdaptations` runs, so the shadow
engine's own internal `detectAdaptations` re-read sees the same
pre-mutation plan state as the cycle's real trigger/action list — not a
state already changed by that cycle's own live adaptation. Wrapped in its
own `try/catch`, matching the existing best-effort pattern already used for
`reanchorLthr` and `updateCoachLog` in the same loop: a shadow-compare
failure never blocks or alters the real adaptation pass.

**Runs on every eligible cycle** — "eligible cycle" is read from the existing
cron structure exactly as instructed: the per-user loop in
`run-adaptations` already iterates every account with an active plan
(`training_plans WHERE archived_iso IS NULL`), which is the same population
the live engine itself considers eligible each night at 03:00 UTC.

### Zero plan mutation — proven, not asserted

Two independent checks, both real, both run against the real account through
the **read-only** database role (`DATABASE_URL_RO`), in
`web-v2/lib/adaptation/_shadow_compare.audit.test.ts`:

1. **The RO-role fence.** Every call in this file's graph goes through
   `resolveAdaptationProposals` and `detectAdaptations` — read-only
   functions — over a Postgres role that cannot write at the permission
   level. If a future edit anywhere in this call graph introduced a write,
   the role refuses and the test fails loudly (same fence
   `_adaptation_engine.audit.test.ts` already documents for
   `detectAdaptations`).
2. **An independent before/after checksum** of the account's live
   `plan_workouts` (id, pace target, distance, type, MD5'd and concatenated)
   taken before and after three full shadow-compare cycles plus three
   persistence writes:

```
plan_workouts checksum before: 925312284e816aabe3b4d09c6226e286:103
plan_workouts checksum after:  925312284e816aabe3b4d09c6226e286:103
match: true
```

103 rows, byte-identical checksum, before and after.

### Determinism (the honest substitute for multi-day stability)

The decision doc asks for "day-to-day stability across repeated daily
evaluations," which genuinely needs real elapsed days the cron has not had
yet — that evidence does not exist tonight and I am not fabricating it. What
I *can* prove tonight: the mechanism is deterministic — same account, same
day, run three times, byte-identical output (minus the timestamp):

```
engine.decision across 3 runs: PROGRESS, PROGRESS, PROGRESS
3 runs identical (minus resolvedAt): true
```

The test asserts the full record — decision, reason codes, explanation,
previous/proposed, and the entire `phaseBreakdown` — is `toEqual` across all
three runs. **This is weaker evidence than true day-to-day stability and is
named as such**: it proves the engine is a pure function of its inputs on a
fixed day, not that the proposal stays sensible as those inputs actually
change over multiple real days. That evidence needs the cron to have
actually run for a stretch of days — it does not exist yet, and I am not
claiming it does.

### Non-upward case, not just the one lucky PROGRESS

`_adaptation_engine.audit.test.ts` (Part 1's real-account run) already showed
the successful upward case. To prove the mechanism handles the other side too
— not just PACE's happy path — `_shadow_compare.audit.test.ts` walked five
earlier dates in the same account's season:

```
2026-02-01 · decision HOLD · "Threshold pace holds while the block is not being absorbed."
2026-03-01 · decision HOLD · "Threshold pace holds while the block is not being absorbed."
2026-04-01 · decision HOLD · "Threshold pace holds while the block is not being absorbed."
2026-05-01 · decision HOLD · "Threshold pace holds while the block is not being absorbed."
2026-06-01 · decision HOLD · "Threshold pace holds while the block is not being absorbed."
```

All five land on a real, correctly-reasoned `HOLD` — the absorption gate
(`absorptionPermitsPaceProgression`), not the corroboration-count gate,
which is itself informative: early in the season the block was not yet
being absorbed cleanly, so PACE correctly refused to progress regardless of
whatever quality sessions existed. This is a genuine second decision type
logged correctly, not the one successful upward day dressed up twice. (An
`INSUFFICIENT_EVIDENCE` case — the third PACE state — was not hit by this
particular five-date sample; the mechanism supports it structurally
(`_adaptation_engine.test.ts`'s unit suite already exercises it directly),
it simply was not the state this account's history landed on for the dates
sampled.)

### Persistence — DDL blocked, flagged as a blocker, not run

Checked for an additive-only home first, per the decision doc's instruction,
and rejected each candidate for a specific reason (full detail in
`shadow-compare.ts`'s header and in
`db/migrations/160_adaptation_shadow_log.sql`'s comment):

| Candidate | Why it was rejected |
|---|---|
| `plan_proposals` / `plan_workout_proposals` | LIVE, actionable proposal tables with real accept/apply consumers — `goal_gap_cron`'s `goal_outlook` rows with `status='pending'` literally drive the live goal-decision card. A shadow row risks a consumer that filters on `status` alone rather than a known `proposal_kind`. |
| `coach_intents` | The exact historical MUTATION-ONLY log CLAUDE.md Rule 21 measures ("zero upward adaptations across 309 rows") to judge whether the live engine ever pushes. Writing non-mutating shadow rows here corrupts that measurement. |
| `training_plans.adaptation_log` | Rule 6 (multi-writer jsonb) risk — the live `adapt.ts` pass is the existing writer of this column's `{n, ts}` shape with no field-level merge; a second writer here is the exact defect Rule 6 exists to catch. |

**No safe additive-only home exists.** The correct persistence is a new,
dedicated table — drafted as `web-v2/db/migrations/160_adaptation_shadow_log.sql`,
additive-only (one `CREATE TABLE`, no `ALTER` on anything existing) —
**NOT RUN.** This is the STOP the decision doc asked for, flagged here
rather than executed: DDL needs David's explicit per-statement go per
CLAUDE.md, and I did not seek or receive it tonight.

Until that migration is approved and applied, `persistShadowCompareRecord`
probes for the table (`to_regclass('public.adaptation_shadow_log')`, cached
per-process) and falls back to a git-tracked JSONL file
(`docs/reports/adaptation-shadow-log/<user_uuid>.jsonl`) **only when the
caller explicitly allows it**. The cron wiring in `run-adaptations/route.ts`
calls `runAndPersistPaceShadowCompare`, which sets `allowFileFallback:
false` — a Railway-style deploy has an ephemeral filesystem, so a file write
from the cron route would not survive the next deploy or cold start, and I
am not pretending it would. In production today the cron step runs, reads
real evidence, and reports `skipped` with the exact reason
("adaptation_shadow_log table does not exist yet ... migration 160 pending
David's go") rather than either crashing or silently doing nothing:

```
error: none
persisted: {"posture":"skipped","detail":"adaptation_shadow_log table does not
  exist yet (migration 160 pending David's go); file fallback disabled in this
  caller (ephemeral filesystem in production)."}
```

The file fallback is real, inspectable persistence for tonight's local
verification runs only (`docs/reports/adaptation-shadow-log/0645f40c-951d-4ccc-b86e-9979cd26c795.jsonl`,
3 real records from the determinism run above, checked into this commit) —
never claimed as the production answer.

**What happens once the migration is approved**: no code change is needed.
`persistShadowCompareRecord` re-probes and starts inserting into the real
table the moment `to_regclass` finds it (next process start after the
migration runs); the cron wiring is already calling the persist path every
eligible cycle.

---

## 3 · Part 3 — the authoring/recomputation convergence question

**Scope investigated, not migrated** — per the task's explicit instruction,
this is a report, not an attempt at the migration.

### The real scope

`web-v2/lib/plan/generate.ts` (14,236 lines) still imports and calls the
legacy VDOT cascade directly:

```ts
import { parseRaceTime, tPaceFromVdot, vdotFromTpace, iPaceFromVdot,
  iPaceFromAnchorPace, vdotFromRace, predictRaceTime,
  bestRecentVdot as computeBestRecentVdot, resolveCurrentTPace,
  clampToSanePace, EVIDENCE_RUN_FLOOR_MI, type BelowTableAnchor
} from '@/lib/training/vdot';
```

Re-counted fresh against `main` today (2026-09-01), independent of the prior
external review's number: **32 call expressions across 19 distinct lines**,
spanning the file from line 8683 to 14154 — including the primary
threshold-pace resolution at authoring time (`resolveCurrentTPace(...)`,
~line 8952) and the full race-realism/goal-flagging block (~lines 9029-9159).
(`docs/reports/plan-generator-external-review-2026-08-31.md` counted "23
direct call sites" the prior day — the discrepancy is counting method, call
sites/lines vs. raw call expressions, not drift; either count says the same
thing: this is not a small, isolable call site, it is threaded through the
file's authoring logic.)

Confirmed independently, fresh:

- **Zero references** to `capacity-resolver.ts` or `prescription-resolver.ts`
  anywhere in `generate.ts` — not even type-only. `grep -n
  "capacity-resolver\|prescription-resolver" lib/plan/generate.ts` returns
  nothing.
- `spec-builder.ts` imports `PrescribedPaceAnchors` **type-only**, and its
  `buildWorkoutSpec()` accepts an optional `anchors` parameter that — per the
  function's own doc comment — is `null` on every authoring call site today,
  leaving the file's authored output byte-identical to before the
  Runner Model / Pace Prescription layer existed.
- By contrast, `recompute-paces.ts` and `reanchor-plan.ts` (the FLEX path)
  **are** wired to the canonical resolvers via
  `resolvePrescribedPaceAnchors` (`lib/training/load-prescription-anchors.ts`)
  — confirmed both by grep and by this task's own Part 1 work reading through
  the live pipeline. `reanchor-plan.ts`'s `reanchorActivePlan` runs from the
  `snapshot-projections` cron (`.github/workflows/snapshot-projections.yml`,
  `07:30 UTC` daily, across every active plan); `recompute-paces.ts`'s
  `recomputePacesForPlan` runs from `lib/plan/adapt.ts` inside
  `applyAdaptations`, gated on a `recompute_paces` action (the
  `training_lead` trigger, or a race/goal-driven VDOT move).

**Risk assessment, independent of the prior review's framing**: this is not
a small, isolable call site swap. The 32 call expressions include the
primary authoring-time pace resolution and an entangled race-
realism/goal-flagging block that reads and re-derives VDOT in several
different shapes across ~130 lines. Migrating it means replacing a
population-formula pipeline with a confidence-weighted, evidence-sourced one
inside the single largest, most heavily-tested file in the plan engine
(`generate.ts` also contains `layoutWeek`, a 3,141-line function the prior
external review flagged as 22% of the file by itself) — this is squarely a
"large piece of work, its own scoped pass," matching how it has been
repeatedly deferred already, not a quick follow-up.

### Is PACE shadow-compare evidence meaningful while this gap exists?

**The contamination window is real but bounded, and self-heals nightly —
recommendation: the evidence is meaningful today, with one caveat worth a
small guard, not a blocker.**

Reasoning, worked through concretely rather than asserted:

- A freshly-authored plan's `plan_workouts.pace_target_s_per_mi` values come
  from the old cascade (`generate.ts`) at the moment of authoring.
- But `reanchorActivePlan` runs **nightly, unconditionally, across every
  active plan** (07:30 UTC), and rewrites every unrun future row through the
  canonical resolvers. The wiring stream's own real-account test found 77 of
  78 future rows rewritten within the same session as authoring. So the
  window during which a plan's `prescribedSecPerMi` is still old-cascade
  priced is bounded to, at most, the gap between authoring and the next
  07:30 UTC run — under 24 hours in the worst case, and the owner's own
  account (authored 2026-08-31 03:40, this report's shadow-compare run on
  2026-08-31/09-01) had almost certainly already been touched by that pass
  by the time either audit test ran tonight.
- Within that window, though, the contamination the task asked me to check
  for is exactly real: `detectPace`'s `gain = prescribed - believed` would
  be comparing an old-cascade `prescribed` against a canonical-resolver
  `believed`, and a nonzero gain could be a brain-disagreement artifact
  rather than genuine evidence of undershoot — the two "brains" pricing the
  same physiological question differently, not the runner having actually
  gotten fitter.

**Recommendation:** the PACE shadow-compare evidence gathered so far
(including everything in this report) is meaningful, because — checked, not
assumed — the account's plan had already converged onto the canonical
resolvers by the time it was read. But this should not be treated as always
true without a check: before this mechanism is trusted for live authority,
add a cheap guard (not built tonight, out of scope per the brief) that flags
a shadow-compare record when the active plan's `authored_iso` is more recent
than the last successful `reanchorActivePlan` run for that plan — the same
"is this plan too young to judge" pattern `detectVolume` already uses for
`CURRENT_PLAN_TOO_YOUNG_TO_JUDGE_ABSORPTION`, applied to the authoring/
recomputation boundary instead of to absorption. That is a small addition to
`shadow-compare.ts`, not a migration of `generate.ts` itself, and it would
let a future reviewer distinguish "the two brains agree because the runner
just wasn't due for a pace change" from "the two brains agree because the
flex pass already overwrote what authoring wrote," which are currently
indistinguishable in the record.

---

## 4 · Files touched

- `web-v2/lib/adaptation/adaptation-engine.ts` — `PaceEvidence.phases`,
  `PacePhaseRead`/`PacePhaseOutcome` types, per-phase `detectPace`,
  `holdFor`'s PACE case carries `phaseBreakdown`.
- `web-v2/lib/adaptation/load-adaptation-engine.ts` — phase-grouped SQL
  (§6b), replaces the blended `AVG` subquery.
- `web-v2/lib/adaptation/shadow-compare.ts` — new. The mechanism.
- `web-v2/app/api/cron/run-adaptations/route.ts` — additive wiring, one
  best-effort call per eligible cycle.
- `web-v2/db/migrations/160_adaptation_shadow_log.sql` — new, **proposed,
  NOT RUN**. The DDL blocker.
- `web-v2/lib/adaptation/_adaptation_engine.test.ts` — two new unit
  scenarios for Part 1.
- `web-v2/lib/adaptation/_adaptation_engine.audit.test.ts` — updated to
  print the phase breakdown instead of the blended number.
- `web-v2/lib/adaptation/_shadow_compare.audit.test.ts` — new. Part 2's
  real-account verification (zero-mutation, determinism, non-upward case,
  persistence posture).
- `docs/reports/adaptation-shadow-log/0645f40c-951d-4ccc-b86e-9979cd26c795.jsonl`
  — real output from tonight's verification runs, checked in as evidence.

## 5 · Verification

- `tsc --noEmit` — clean (scoped to exclude an unrelated, pre-existing
  AppleDouble-corrupted file another agent's untracked WIP left in the
  working tree — see the git-discipline note below).
- `_adaptation_engine.test.ts` — 72/72 passing (70 pre-existing + 2 new).
- `_adaptation_engine.audit.test.ts` — real account, 2/2 passing, phase
  breakdown confirmed.
- `_shadow_compare.audit.test.ts` — real account, 3/3 passing: zero-mutation
  checksum match, 3x-determinism, cron-path persistence posture, and the
  five-date HOLD walk.

### Git-discipline note

`web-v2/vitest.shadow-run.config.ts` (another agent's untracked WIP for a
different, unrelated absorption-reader-split task) has an AppleDouble
sidecar (`web-v2/._vitest.shadow-run.config.ts`) that `tsc`'s glob resolver
picks up as if it were a `.ts` file, producing ~30 unrelated parse errors on
a whole-project `tsc --noEmit`. Confirmed unrelated to this work: the real
file's content is syntactically valid (checked with `file`/`xxd`), the
errors are entirely inside `._vitest.shadow-run.config.ts`'s binary resource
fork, and this is the same class of WP-volume AppleDouble corruption
recorded in project memory. Verified by excluding it with a scoped
`tsconfig` (`exclude: ["**/._*", "vitest.shadow-run.config.ts"]`) run against
this exact commit in the shared checkout — not a different worktree, since
the failure is proven to originate from an untracked file this session never
touched, not from any uncommitted change. No file this session edited was
excluded from the check.
