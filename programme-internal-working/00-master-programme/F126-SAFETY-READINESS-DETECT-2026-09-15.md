# F126 — Safety/readiness contradiction, detect-only

Status: implemented, uncommitted, in worktree branch `f126-safety-readiness-detect`
(created off `audit/brain-forensic-2026-09-10`, which is where `web-v2` actually lives —
see "Branch note" at the bottom). Not committed, pushed, or merged. A separate process
verifies and lands this.

## What this is

A passive, non-blocking detector for the exact contradiction F096 exists to eventually
arbitrate: Safety's own `mayEmitRunnableWorkout(safety)` predicate
(`web-v2/lib/safety/safety-verdict.ts:635`) says the runner should get no runnable
session today (STOP or UNKNOWN posture), but the response `GET /api/v5/today` is about
to send actually names one anyway. This step does **not** fix or arbitrate anything — it
only raises an `ops_alerts` row so there is real incidence data before anyone designs the
actual policy.

## Files changed

1. **`web-v2/lib/ops/alerts.ts`** — added one new `AlertKind` value,
   `'safety_readiness_mismatch'`, with a doc-comment block above it in the same style as
   `reassessment_overdue` / `canonical_shadow_exit` / `deferral_queue_carry`, citing F126.
   No other change to this file.

2. **`web-v2/lib/ops/safety-readiness-check.ts`** (new file) — exports
   `detectSafetyReadinessMismatch(safety, hasRunnableSession, session, source?)`. Pure
   glue: if `mayEmitRunnableWorkout(safety)` is true, or `hasRunnableSession` is false, it
   does nothing and returns `false`. Otherwise it calls `raiseAlert` with
   `kind: 'safety_readiness_mismatch'`, `severity: 'error'`, a message naming the
   contradiction, and `metadata` carrying the safety verdict's relevant fields
   (`known`, and — when known — `state`, `posture`, `reason`, `driver`; when unknown —
   `posture`, `floor`, `unreadable`) plus whatever `session` object the caller passed in.
   Returns `true` when it fired.

   This mirrors the existing pattern in `lib/ops/cron-ledger.ts`
   (`raiseStaleAlert` wrapping `raiseAlert`, unit-tested by mocking
   `@/lib/ops/alerts`) rather than living inline in the route, so it can be tested in
   isolation the same way that file already is. It is a new file, not an edit to
   `safety-verdict.ts` — `mayEmitRunnableWorkout` and everything else in that file is
   untouched, only imported.

3. **`web-v2/app/api/v5/today/route.ts`** — one import added
   (`detectSafetyReadinessMismatch` from `@/lib/ops/safety-readiness-check`), and one
   `await` call added immediately before the route's actual final
   `return NextResponse.json(composeV5Today(ctx));` (this was line 2391 after the import
   was added; originally line 2390 before it). No other line in this file was changed.

## The real field names (not the guessed ones from the brief)

- **The safety verdict in scope at that point of the function** is the `safety` const
  already defined at (original) line 516:
  `const safety: SafetyResolution = glance.safety ?? SAFETY_NOT_RESOLVED;` — reused
  as-is, not re-derived.

- **"Does the response actually contain a runnable session"** is **not** a simple
  null-check on `ctx.prescription`, because `prescription` (a `SpecCard`) is built for
  *every* `todayPlan`, including a scheduled **rest** day (`cardForUnprescribableType` /
  `cardFromSpec` both have a `'rest'` case) — a rest card is not a runnable session. The
  codebase already owns the correct predicate for exactly this question:
  `dayPrescribesARun(plannedType)`, exported from `web-v2/lib/faff/v5-today.ts:777` and
  already imported into `route.ts` (used at line 790 to build `todayPrescription`). It is
  defined as `dayStateWordFor(plannedType) !== 'rest'` and its own doc comment explains
  why a naive `todayPlan != null` check is wrong (glance hands back a rest day as a
  non-null `todayPlan` with `plannedType: 'rest'`).

  So the check added is:
  ```ts
  todayPlan != null && dayPrescribesARun(todayPlan.type)
  ```
  using the same `todayPlan` local (defined at original line 755) and the same
  `dayPrescribesARun` import the route already had.

- **Session-identifying metadata**, built from what is actually in scope at that point
  (there is no `plan_workout_id` selected anywhere in this route — the `specRow` query at
  line ~2002 only selects `workout_spec, sub_label, pace_target_s_per_mi`, no `id` — so
  the closest available identifiers are used instead):
  - `planId`: `activePlan?.id ?? null`
  - `dateISO`: `today`
  - `plannedType`: `todayPlan.type`
  - `subLabel`: `todayPlan.subLabel`
  - `prescriptionType`: the local `prescriptionType` (`strictType ?? 'easy'`)
  - `sessionHeadline`: `prescription?.headline ?? null` (from the `SpecCard`)

## Why this single call site is correct/sufficient

The route has 8 `return NextResponse.json(...)` statements. Walking them:

- 4 early returns (injury panel, illness panel, safety-UNKNOWN panel, and one more before
  the plan is loaded) all occur **before** `todayPlan` is even computed (original line
  755), and structurally can only fire when `safety.driver` is `'injury'`/`'illness'` or
  `!safety.known` — i.e. exactly the cases where `mayEmitRunnableWorkout` is false. None
  of those branches builds a `prescription`/session, so there is nothing to check there.
- The "already ran today" / post-run recap branch (original line ~1921) describes a run
  that **already happened**; it is not "about to serve" anything forward-looking, so it
  is out of scope for this contradiction as briefed.
- The **one** remaining return — the ordinary before-run day, at the true end of the
  function — is the only branch that can ever build and ship a real prescription. By
  construction, given the STOP/UNKNOWN branches above it, this point should never be
  reached with `mayEmitRunnableWorkout(safety)` false. That invariant is exactly what
  F126 is watching for a violation of (a latent bug letting execution fall through).

This matches the brief's "right before the route returns its final response" literally:
one check, at the one true final return.

## Non-blocking / no behavior change

- `detectSafetyReadinessMismatch` never touches `ctx` or the response body.
- It is `await`ed (matches the brief's allowance: "if the response is already built as a
  plain object before `NextResponse.json(...)`, you can await the alert call before
  returning without meaningfully affecting the response" — `ctx` is fully built by this
  point).
- `raiseAlert` already catches its own DB/webhook errors internally (verified by reading
  `web-v2/lib/ops/alerts.ts:80-114` — the `pool.query` call is in its own `try/catch`,
  and the webhook dispatch is in its own separate `try/catch`), so this `await` cannot
  throw and cannot fail the route.
- `mayEmitRunnableWorkout` and everything else in `safety-verdict.ts` is byte-for-byte
  unchanged.

## Verification

- `cd web-v2 && npx tsc --noEmit` — **clean, zero errors** (had to `npm install` first;
  this worktree checkout had no `node_modules`).
- `npx vitest run lib/ops/_safety_readiness_check.test.ts` (new test file) —
  **5/5 passed**.
- `npx vitest run lib/ops/ lib/safety/` (everything touched/adjacent) —
  **170 passed, 37 skipped** (skips are DB-fixture suites that need `DATABASE_URL`, not
  present in this sandbox — pre-existing, unrelated to this change).
- `npx vitest run lib/faff/` (home of `dayPrescribesARun` / `v5-today.ts`) —
  **484 passed, 3 skipped**.
- Full suite, `npx vitest run` —
  **11913 passed, 1 failed, 1 expected-fail, 205 skipped** (641 files, 12120 tests).
  The 1 failure is `lib/plan/_authoring_shadow_compare.audit.test.ts` — a pre-existing
  "audit liveness" gate that deliberately fails when `DATABASE_URL_RO` is not set (its own
  assertion message: "the authoring shadow compare cannot run without DATABASE_URL_RO,
  and skipping it silently would report green for a check that looked at nothing (Rule
  18)"). This is unrelated to `web-v2/lib/ops`, `web-v2/lib/safety`, or
  `web-v2/app/api/v5/today` and is a sandbox-environment gap (no RO database credential
  here), not something introduced by this change.

## Test file

`web-v2/lib/ops/_safety_readiness_check.test.ts` — follows the pattern in
`web-v2/lib/ops/_cron_stale_alert.test.ts` (mocks `@/lib/ops/alerts` via `vi.mock`,
asserts on the mocked calls rather than a real DB). Five cases:

1. STOP verdict + session shipped → fires, `kind: 'safety_readiness_mismatch'`,
   `severity: 'error'`, metadata includes `driver: 'injury'`.
2. UNKNOWN verdict + session shipped → fires, metadata includes
   `posture: 'WITHHOLD_PENDING_CHECK'`.
3. NORMAL verdict + session shipped (the ordinary day) → silent.
4. STOP verdict + no session shipped (the common, correct stop-day case) → silent.
5. UNKNOWN verdict + no session shipped → silent.

## Branch note (for whoever verifies/lands this)

The worktree this agent was dispatched into
(`.claude/worktrees/agent-afd8f687c1d16fb9e`) was checked out at a stale commit
(`f43fb7a7d`, 2026-05-20) that predates the `web` → `web-v2` rename entirely — it had no
`web-v2` directory at all. To do this task at all, a new local branch
(`f126-safety-readiness-detect`) was created off `audit/brain-forensic-2026-09-10` (the
branch named as "current" in this session's git-status context, and a descendant of
`main`'s tip) **inside this same worktree**, via `git switch -c`. No destructive git
operation was used (no reset --hard, no force-anything), and the original
`worktree-agent-afd8f687c1d16fb9e` branch pointer was left untouched. All work described
above is uncommitted on top of `f126-safety-readiness-detect`. Whoever picks this up
should confirm that branch's tip is still the intended base before committing.
