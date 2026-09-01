# Pace canary infrastructure — built, verified, and switched off

Response to the external-review spec answering `docs/reports/
adaptation-authority-policy-brief-2026-09-01.md`'s Option B ("a staged/canary
approach... PACE lever only... the account owner's own account only... a hard
kill switch, and explicit promotion criteria decided in advance"). Every piece
of the spec is built. **Nothing it can do is turned on.**

Built in an isolated worktree on branch `pace-canary-infrastructure-20260901`
(off current `origin/main` — see "Merge-safety call" at the end for why it is
staying there rather than being merged unilaterally).

---

## The absolute constraint, restated and checked

**With the flag at its committed default, calling the real trigger path
(`runPaceCanaryCycle`, reached from `app/api/cron/run-adaptations/route.ts`)
against a real account with real, otherwise-qualifying evidence produces
zero database writes.** Proven by a real test against a real, harness-copied
account — see "Verification" below, test 1. Not asserted; run, and it passed.

---

## 1 · Feature flag, disabled globally by default

`web-v2/lib/adaptation/pace-canary-config.ts`. This repo has no
`feature_flags` table or config service — grepped before writing this file —
so the flag follows the existing convention exactly: a `process.env.X ===
'1'` check, read fresh inside the function body (never cached, never hoisted
to a module constant), the same pattern `lib/ops/alerts.ts`'s
`OPS_ALERTS_DISABLED` and `lib/auth/rate-limit.ts`'s `ALLOW_OPEN_SIGNUP`
already use.

```ts
const enabled = process.env.PACE_CANARY_ENABLED === '1';
```

`PACE_CANARY_ENABLED` is **unset** in every committed file. The check
requires the literal string `'1'` — any other value, including truthy-looking
ones, evaluates to `false`.

## 2 · Explicit user allowlist, empty by default, added by no code in this change

Same file:

```ts
const allowlist = parseAllowlist(process.env.PACE_CANARY_ALLOWLIST);
const allowlisted = allowlist.has(userUuid.trim().toLowerCase());
```

`PACE_CANARY_ALLOWLIST` is **unset** in every committed file — `parseAllowlist(undefined)` returns an empty `Set`, so `allowlisted` is `false` for
every user, including the owner. `PACE_CANARY_OWNER_UUID_REFERENCE` (the
literal `0645f40c-951d-4ccc-b86e-9979cd26c795`) exists in the file **only**
as a named constant for tests and for whoever performs the separate,
deliberate act of allowlisting him later — it is never read by
`resolvePaceCanaryGate` itself and never written into the allowlist by this
change. Confirmed by reading the function: it takes `userUuid` as a
parameter and never references the reference constant.

Both gates are independent — `resolvePaceCanaryGate` requires `enabled &&
allowlisted`, and `_pace_canary.test.ts` proves the flag alone (with no
allowlist) and the allowlist alone (with the flag off) each leave
`paceCanaryMayRunFor` at `false`.

## 3 · PACE lever only, structurally

`PACE_CANARY_WORKOUT_TYPES = Object.freeze(['threshold', 'tempo', 'cruise'])`
— the only `plan_workouts.type` values `targetRowsForPhase` will ever query,
and the only column the write path ever sets is `pace_target_s_per_mi`. There
is no code path in `pace-canary.ts` that reads a DURATION/VOLUME/DENSITY
proposal from `ShadowCompareRecord` — the decision function
(`decidePaceCanaryEligibility`) only ever inspects `record.engine` (the PACE
arm `runPaceShadowCompareCycle` already isolated) and never touches
`AdaptationProposalSet`'s other levers at all.

## 4 · Rate limit — one applied change per 7 days, enforced server-side

`PACE_CANARY_RATE_LIMIT_DAYS = 7`. Enforced in `decidePaceCanaryEligibility`
against `readLastAppliedAt`, which queries real persisted state:

```sql
SELECT MAX(requested_at) FROM pace_canary_applications
 WHERE user_uuid = $1::uuid AND status = 'applied'
```

Not a policy comment — a server-side check against a real row, proven by
harness test 3 (seeded a real `applied` row 2 days before "today", got
`RATE_LIMITED`; 8 days after, did not).

A read failure here is a **distinct, refusing state**
(`RATE_LIMIT_UNREADABLE`), not coerced into "no prior application" — a
transient DB error can never waive the limit.

## 5 · Phase-specific rows only, never a blended average

The eligibility decision reads `record.engine.phaseBreakdown.filter(p =>
p.moved)` — `PacePhaseOutcome[]`, the exact per-phase structure Part 1 of the
2026-09-01 decision built (`adaptation-engine.ts`'s `phaseStep`, one
`previous`/`proposed`/`step` per phase, never one number blended across
QUALITY/RACE-SPECIFIC/TAPER). `targetRowsForPhase` resolves the concrete
`plan_workouts` rows for each moving phase by its own `firstDateISO`/
`lastDateISO`/`phaseLabel`, and each row is shifted by **that phase's own
step**, not a global average.

## 6 · Never touches completed/sealed workouts

`targetRowsForPhase`'s query and `rollbackPaceCanaryApplication`'s
re-check both carry the **same** `NOT EXISTS (SELECT 1 FROM runs r WHERE
... AND NOT (r.data ? 'mergedIntoId'))` predicate `adapt.ts`'s
`filterUnsealedWorkouts` and `recompute-paces.ts`'s inline check already
use — copied verbatim (Rule 15), not reinvented. The rollback path
**re-checks the seal predicate at rollback time**, not just at application
time, so a day that was unsealed when the canary applied but has since been
run is skipped on rollback too — proven by the harness rollback test's
sealed-day exclusion.

## 7 · Reject, don't silently pass — every hard-refusal path, with a stored reason

`decidePaceCanaryEligibility` (pure, `lib/adaptation/pace-canary.ts`) checks,
in order: table missing → rate-limit unreadable → rate-limited →
**HR-incompatible** (`finalDecision === 'REFUSED_HR_INCOMPATIBLE'`, i.e.
`MATERIAL_INCOMPATIBILITY` from `pace-hr-compatibility.ts`, reused verbatim)
→ **insufficient-evidence / not-PROGRESS** (`engine.decision !== 'PROGRESS'`
— covers HOLD, INSUFFICIENT_EVIDENCE, NO_PACE_PROPOSAL, REDUCE, RESTRUCTURE)
→ **contaminated** (`convergence.state` not one of `AUTHORED_CANONICALLY` /
`REANCHORED_CANONICALLY` — the authoring/reanchor convergence guard, reused
verbatim) → **contradictory** (`record.contradictions.length > 0` —
`shadow-compare.ts`'s own `deriveContradictions` output, reused verbatim) →
no moving phases → exceeds the operational canary limit. Every branch
returns a distinct `refusalCode` and a human-readable `refusalDetail`, and
`runPaceCanaryCycle` persists a `status: 'refused'` row carrying both,
whenever the audit table exists to receive it.

All 12 refusal/eligible paths are unit-tested directly against constructed
`ShadowCompareRecord` fixtures in `_pace_canary.test.ts` — no database, every
branch exercised (see Verification, below).

**The operational canary limit is labelled as exactly that, in code, not as
doctrine.** `PACE_CANARY_MAX_STEP_SEC_PER_MI = 5`, with an explicit comment
citing CLAUDE.md Rule 7: this constant asserts no physiology, carries no
doctrine registry entry, and must never be cited as though it did — it is an
engineering rollout cap on top of the PACE engine's own doctrine-cited step
ceiling, which continues to bound the proposal before this canary ever sees
it.

## 8 · Complete before/after row snapshots — additive-only persistence

**Needed new DDL. Drafted, NOT applied — a blocker requiring explicit go,
exactly like the migration-160 agent's own posture.**

`web-v2/db/migrations/161_pace_canary_applications.sql` — `pace_canary_
applications`, reviewed against the same seven criteria migration 160's
header used (see that file's header for the full review). It has **not**
been run against production; only against the local, disposable
`faff_adapt_harness` scratch database, specifically to satisfy the "test the
write path against a disposable/rollback-safe mechanism" instruction rather
than flipping the flag on for real. I did not have production database
credentials in this session (`web-v2/.env.local` does not exist in this
worktree) to independently re-confirm the table's absence in production
tonight — the honest claim is that this file was newly authored in this
session (confirmed by `git status` showing it untracked before this work)
and was never executed against anything but the local harness DB.

This is also a **real, independent safety property**, not just a procedural
one, and it is documented as such in both the migration's own header and in
`pace-canary.ts`'s file header: `paceCanaryApplicationsTableExists()` probes
`to_regclass('public.pace_canary_applications')`, and
`decidePaceCanaryEligibility` refuses with `PERSISTENCE_TABLE_MISSING`
**before checking anything else** when the table is absent. So on
production today, even a mis-set env var and a populated allowlist still
cannot produce a write — there is nowhere to record the audit trail item 8
requires, and the code refuses on that basis alone.

Every application row (applied or refused) carries the full
`ShadowCompareRecord` verbatim (`shadow_compare_record` jsonb) plus
`rows_before`/`rows_after` — `{id, dateIso, type, phaseLabel,
paceTargetSPerMi}` for every touched row.

## 9 · Atomic application

`applyEligiblePaceCanary` and `rollbackPaceCanaryApplication` both route
every write through `mutatePlan` (`lib/plan/mutate.ts`), `touches:
'derivations'` — the **same** plan-mutation boundary `recompute-paces.ts`
uses, for the same declared reason (only `pace_target_s_per_mi` is written,
a field no doctrine invariant reads). Atomicity is **inherited** from that
boundary's own `BEGIN` / `apply(tx)` / `COMMIT`-or-`ROLLBACK` wrapper — this
file adds no transaction logic of its own.

Proven, not assumed: harness test 2 drives the real `mutatePlan` with the
identical write shape pace-canary.ts uses (sequential `plan_workouts`
`UPDATE`s, then a `coach_intents` `INSERT`), injects a thrown error after
two real `UPDATE`s already executed inside the transaction, and confirms
(a) the error propagates rather than being swallowed, and (b) all three rows
— including the two that were "written" before the throw — are byte-
identical to their pre-transaction values afterward.

## 10 · Automatic post-write verification

After `mutatePlan` commits, `applyEligiblePaceCanary` re-reads the touched
rows on a **fresh, post-commit connection** (not the transaction's own
client, which is already released) and compares the live values against
what was intended. `postWriteVerified` is stored on the application row; a
mismatch is `console.error`'d loudly (never silently swallowed) but does not
attempt to undo the write itself — surfaced for an operator, per Rule 11
("a missing input must never silently disable a safety mechanism"; here, a
verification failure must never silently disable the operator's ability to
notice it).

## 11 · One-command rollback

`rollbackPaceCanaryApplication(applicationId, reason)` — reads the
application's captured `rows_before`, re-checks the seal predicate at
rollback time (item 6), writes every unsealed row back through `mutatePlan`,
records a `plan_adapt_pace_canary_rolled_back` `coach_intents` row, and
marks the application `status = 'rolled_back'`. Idempotent: rolling back an
already-rolled-back application refuses rather than double-writing (proven
in harness test 5).

## 12 · Immediate kill switch, verified flippable without a code deployment

**Three independent kill mechanisms**, layered:

1. `PACE_CANARY_KILL === '1'` — an always-wins override, checked first, no
   DB, no allowlist parsing. The fastest path to "stop this right now."
2. `PACE_CANARY_ENABLED` itself, unset by default.
3. The `pace_canary_applications` table's absence — structurally impossible
   to write without it (item 8's cross-reference).

All three are `process.env` reads or a DB-existence probe, evaluated at
**call time**, never a build-time constant. On Railway, updating an env var
and restarting the service is an infrastructure action, distinct from the
`git push` / `next build` pipeline Rule 19 is about. `_pace_canary.test.ts`
verifies the mechanical claim: it mutates `process.env` mid-process and
observes `paceCanaryMayRunFor` flip with **no re-import** — the gate reads
live state, not something baked in at module load.

## 13 · Nightly reanchor compatibility — traced through the real code, not asserted

`reanchorActivePlan` (`lib/plan/reanchor-plan.ts`) already has a
defer-to-the-adapter mechanism for exactly this class of problem: the 07:30
self-heal defers to the 03:00 adapter's same-morning pace move via
`adapterMovedAnchorWithin` / `selfHealShouldDefer`
(`lib/training/pace-anchor.ts`), reading a `plan_adapt_recompute_paces`
`coach_intents` row written inside the adapter's own transaction.

**Extended, not duplicated:** `adapterMovedAnchorWithin`'s `WHERE` clause
widened from `reason = 'plan_adapt_recompute_paces'` to `reason IN
('plan_adapt_recompute_paces', 'plan_adapt_pace_canary_applied')`. The
canary writes a `plan_adapt_pace_canary_applied` `coach_intents` row inside
the **same transaction** as its `pace_target_s_per_mi` rewrite, using this
exact string — so the existing mechanism recognizes it automatically, with
no second "did the canary move it" check that could disagree with the
first (Rule 16).

Consequence, traced: for `ADAPTER_ANCHOR_DEFER_HOURS` (24h) after a canary
application, the self-heal defers to it exactly as it already defers to the
adapter — **preserved**, per the spec's first option. After that window, if
evidence still warrants a reanchor, it fires and **visibly supersedes** —
"visibly" because that reanchor writes its own `authored_state` stamp and
its own `coach_intents` row, so an audit sees both events in order, never
just a silently-overwritten final number.

Proven against the real functions in harness tests 4a/4b: before any canary
row, `adapterMovedAnchorWithin` returns `false`; immediately after one, it
returns `true` and `selfHealShouldDefer` agrees the self-heal should stand
down (while a provisional→measured upgrade still never defers, unaffected);
30 hours after (past the 24h window), the row no longer counts and the
self-heal is free to run.

**Regression found and fixed while wiring this:** `lib/training/
_pace_anchor.test.ts`'s existing mock router matched the query text via
`sql.includes("reason = 'plan_adapt_recompute_paces'")` — an exact-operator
substring that no longer appears once the clause became `reason IN (...)`.
Fixed the fixture to match on the quoted literal alone (works for both
shapes); re-ran — 16/16 pass.

---

## What this deliberately does not cover — flagged, not hidden

`workout_spec`'s internally embedded pace/HR fields are **not** rebuilt by
this pathway — only the top-level `pace_target_s_per_mi` column is written
(the exact field `PacePhaseOutcome.stepSecPerMi` is computed against).
Rebuilding `workout_spec` correctly needs the full canonical anchor set
`recomputePacesForPlan` resolves and would reprice the row off the block's
canonical anchor rather than the phase-specific delta this canary applies —
reintroducing the blended-average imprecision Part 1 of the 2026-09-01
decision rejected. The handoff is deliberate: the canary writes the narrow
delta; the next `recomputePacesForPlan` / `reanchorActivePlan` cycle
reconciles `workout_spec` around it, governed by item 13's defer-or-
supersede contract. Documented in `pace-canary.ts`'s own header per Rule 20
rather than left as a silent gap.

---

## Verification, required — full suite results

All run in this session, against real code (no mocks of the modules under
test), some against a real disposable database. Results below are from the
actual runs, not summarized from memory.

| # | Claim | Where | Result |
|---|---|---|---|
| 1 | Flag off (default) ⇒ zero DB writes for a real account with real, otherwise-qualifying evidence | `lib/adaptation-harness/pace-canary.harness.test.ts` (3 tests: default-unset, flag-on/not-allowlisted, kill-switch-on) | **PASS** — `plan_workouts` checksum byte-identical before/after; `pace_canary_applications` and `coach_intents(plan_adapt_pace_canary_applied)` row counts unchanged (literally nothing persisted, not even a refusal row) |
| 2 | Atomic-application transaction rolls back fully on a simulated mid-write failure | same file — drives the real `mutatePlan` with the canary's identical write shape, injects a throw after 2 of 3 real `UPDATE`s | **PASS** — error propagated (not swallowed), all 3 rows byte-identical to pre-transaction values |
| 3 | Rate limit blocks a second application within 7 days | same file — seeds a real `applied` row 2 days prior, then 8 days prior | **PASS** — 2 days: `RATE_LIMITED`; 8 days: not rate-limited |
| 4 | Contaminated / insufficient / HR-incompatible / contradictory proposals are refused, not applied | `lib/adaptation/_pace_canary.test.ts` — 12 refusal-path tests + 2 eligible-boundary tests against constructed `ShadowCompareRecord` fixtures | **PASS** — every refusal path (`PERSISTENCE_TABLE_MISSING`, `RATE_LIMIT_UNREADABLE`, `RATE_LIMITED`, `HR_INCOMPATIBLE`, `NOT_PROGRESS_DECISION`, `CONTAMINATED_EVIDENCE` ×2 states, `CONTRADICTIONS_PRESENT`, `NO_MOVING_PHASES`, `EXCEEDS_OPERATIONAL_CANARY_LIMIT`) returns the correct distinct code; `INSUFFICIENT_HR_EVIDENCE` correctly does NOT refuse (per the validator's own contract) |
| 5 | Nightly reanchor doesn't silently clobber a canary-applied row | same harness file, 2 tests | **PASS** — `adapterMovedAnchorWithin` recognizes the canary's `coach_intents` reason within the 24h defer window and stops recognizing it after |

**Full suite counts, this session:**

- `tsc --noEmit`: **clean, exit 0**, twice more after subsequent fixes (three total clean runs across the session)
- `lib/adaptation/_pace_canary.test.ts`: **20/20 pass**
- `lib/adaptation-harness/pace-canary.harness.test.ts`: **9/9 pass** (against the local `faff_adapt_harness` scratch DB only)
- `lib/training/_pace_anchor.test.ts`: **16/16 pass** (1 pre-existing fixture regression found and fixed)
- `lib/audit/_automatic_mutations.test.ts`: **20/20 pass** (2 real gate failures found and fixed — see below)
- 10 more audit/doctrine source-scanning gates (`_active_plan_scan`, `_anchor_derivation_scan`, `_client_graph`, `_coercion_scan`, `_normal_window_scan`, `_swallow_scan`, `_swallowed_failure_fixes`, `_timezone_date_scan`, `_doctrine_gate`, `_doctrine_lint`, `_generated_content_gate`): **920/920 pass** (1 real ratchet violation found and fixed — see below)
- `lib/adaptation/` (whole directory): **184/184 pass, 6 skipped** (skips are pre-existing, need production `DATABASE_URL_RO`)
- `lib/training/` + `lib/plan/` (whole directories): **2789/2789 pass, 28 skipped**

**Three real, pre-existing-gate findings, all fixed in this session, not worked around:**

1. `lib/audit/_automatic_mutations.test.ts`'s GUARD 4/5 — the repo's
   "every plan-writer file declares its own trigger" gate correctly flagged
   `pace-canary.ts` as an unregistered plan writer (this is the exact gate
   that caught `snapshot-projections` as a silent third writer, per its own
   header). Fixed by adding it to `PLAN_WRITER_FILE_OWNERS` (mapped to the
   existing `cron/run-adaptations` id, same as `adapt.ts`/`progression-
   pass.ts`) and extending that id's `AUTOMATIC_MUTATIONS` entry's `note`
   with the full three-gates-inert account (`lib/audit/automatic-mutation-
   registry.ts`).
2. `lib/audit/_swallow_scan.test.ts`'s `EMPTIED_BASELINE` ratchet — my
   original `rollbackPaceCanaryApplication` used a `.catch(() => ({ rows:
   [] }))` shape (copied from an existing pattern elsewhere in this codebase)
   that this gate specifically exists to ratchet against (374 → 375). Fixed
   by routing that read through `lib/db/read.ts`'s `rowOrNull`, which is
   also a real correctness improvement per Rule 11: "no such application"
   and "the read itself failed" are now two distinguishable, separately-
   handled states rather than one collapsed `!appRow` branch.
3. `lib/training/_pace_anchor.test.ts`'s mock router — see item 13 above.

---

## Explicit, unambiguous statement of default state

Quoting the actual committed code, not describing it:

**`web-v2/lib/adaptation/pace-canary-config.ts`:**

```ts
const killed = process.env.PACE_CANARY_KILL === '1';
...
const enabled = process.env.PACE_CANARY_ENABLED === '1';
const allowlist = parseAllowlist(process.env.PACE_CANARY_ALLOWLIST);
```

`PACE_CANARY_ENABLED`, `PACE_CANARY_ALLOWLIST`, and `PACE_CANARY_KILL` do
not appear as assignments anywhere in this diff, any `.env` file in it, or
any committed config. `process.env.PACE_CANARY_ENABLED` is therefore
`undefined` in every committed state, `=== '1'` evaluates to `false`, and
`enabled` is `false`. `parseAllowlist(undefined)` returns `new Set()`, so
`allowlisted` is `false` for every `userUuid`, including
`0645f40c-951d-4ccc-b86e-9979cd26c795`.

**`web-v2/db/migrations/161_pace_canary_applications.sql`** has not been
applied to production — see item 8 above for exactly what was and was not
verified about that in this session.

**Net: three independent, all-closed gates.** Flag unset. Allowlist empty.
Audit table absent. Any one of them alone is sufficient to keep this
pathway from ever writing; all three are closed simultaneously today.

---

## Merge-safety call

**Left on its own reviewable branch — `pace-canary-infrastructure-20260901`
— not merged into `main`.**

Given the sensitivity CLAUDE.md itself calls out (a real, if disabled,
live-mutation pathway) and the precedent the canonical-authoring-migration
agent set earlier tonight for exactly this class of judgment call, the same
reasoning applies here: the code is inert by construction and the full
verification suite is green, but this is not the kind of change that should
land on `main` by an agent's own unilateral judgment when it can wait for a
human's review of the same seven-criteria-style reasoning migration 160 and
this file both went through. The `pace_canary_applications` migration in
particular carries the same DDL-authorization boundary CLAUDE.md draws a
hard line around.

PR-ready. Branch is based on current `origin/main` at the time this session
started (`f633bad2`), rebuilt fresh in an isolated worktree specifically
because this session's own worktree checkout was found to be roughly 3,760
commits behind `main` when this task began (see CLAUDE.md's own cautionary
example about exactly this failure mode) — a new branch off current `main`
was created rather than risking a transplant from that stale base.
