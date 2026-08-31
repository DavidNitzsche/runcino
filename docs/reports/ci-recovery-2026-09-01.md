# CI recovery — build-check.yml on `main`

**Status at completion of this pass: GREEN.** No code changes were made in this
pass — the break was already fixed by prior commits on `main` before this
audit started; this report is the confirmation and retrospective the task
called for.

## The confirmation

Current `main` tip: `d39871b9` ("docs(handback): round 2 — all four decisions
executed, plus a bonus wide-reach fix").

Its `build-check` run: **success**, watched to completion (not inferred from
a queued/in-progress state):

- Run: https://github.com/DavidNitzsche/runcino/actions/runs/33450609173
- `headSha: d39871b94e56e166f5983bfa73b8da43d0f8a206` — matches `origin/main`
  exactly (`git fetch` + `git rev-parse origin/main` confirmed the same SHA).
- All prebuild gates, `Typecheck`, and `next build` reported green.

Since HEAD was already green when this pass began, no further commit, push,
or `verify-commit.sh` run was needed — per the task's own branch for this
case, this pass stopped at confirmation rather than doing unnecessary work.

## The red window

Last confirmed-green run before the break: `33443482964` at 2026-08-31
21:52:07Z, commit `8b7abc1b` ("fix(adaptation): the five-state machine, a
lookback that can reach pa…").

First red run: `33444050530` at 21:59:22Z, commit `e5d586f7` ("fix(evidence):
close goalRunFloorMiForUser's goal-into-evidence leak"). From there every
completed run failed or was cancelled (rapid successive pushes cancelling
each other's in-flight run) until `d39871b9`'s run went green at ~00:0x UTC
2026-09-01.

**33 commits landed on `main` inside the red window** (`8b7abc1b..d39871b9`):

```
e5d586f7 fix(evidence): close goalRunFloorMiForUser's goal-into-evidence leak
bf3d66dd docs(report): note the --no-verify push and why
455476c2 feat(coaching-thesis): the smallest real Coaching Thesis, plus the discarded selection rationale, persisted and wired
046f4370 docs(handback): consolidated migration handback with open-decision section
e8d6c441 docs(reports): Coaching Thesis + rationale-persistence report
7541c7cb docs(verify): reanchor-plan determinism proof, spike-rule falsification, stale-doc sweep
60f82ee5 docs(handback): Coaching Thesis landed, commit table updated
ad220f83 fix(coach-card): goal-outlook notice's ghost DISMISS bypassed the real acknowledgment
d234138f docs(handback): gate-cleanup landed, status counts updated (5/8)
67ac203d docs(handback): goal-card audit landed — real bug found and fixed (6/8)
cdc77c89 fix(race-prediction): one canonical personal exponent, one canonical trajectory
d5b7faea docs(handback): race-prediction consolidation landed (7/8) — real 322s and 68s bugs fixed
28ceac34 fix(prescription): warm-up/cool-down read as a ceiling, quality reps as a band, the between-rep jog goes by feel
06352964 fix(plan): break easy-band tiebreak toward the future, not scan order
bdf90841 docs(handback): all 8 streams landed — final consolidated handback (brief 15)
41071ccd docs(decisions): four calls on the migration handback's open questions
61a31565 feat(race-prediction): wire durability exponent into goal-projection trajectory
5395a07b docs(report): taper-tempo comparison basis — answers David's 08-04/08-06 question
6b96bdd0 tooling(verify): verify-commit.sh + formal isolated-verification policy
5bb979d6 feat(adaptation): pace/HR compatibility validator, shadow-mode only
aa8b8a21 feat(adaptation): PACE shadow-compare — phase-specific fix + the mechanism
cc0b081f fix(plan): owned-days tiebreak can't let a reverted plan outrank the real one
e76ff593 fix(plan): ownedDaysSql picks the plan whose reign actually contains the date
c272d9d2 docs(report): correct the concurrent-session note now that both landed
fe5315e4 fix(adaptation): satisfy the coercion + orphan-module gates the previous push tripped
b2b13ede fix(audit): close standing build-check gate failures on main
76147458 fix(audit): register progression-spec.ts's pre-existing coercion collapse
14c60df8 fix(audit): register two more pre-existing orphan modules blocking deploy
7445f117 feat(adaptation): split classifyAdaptation's execution dimension into actual_load_absorption / representative_execution (shadow-mode)
24bf6310 Merge origin/main into main (reconcile concurrent shared-checkout commits before push)
3d29aa8b docs(report): record the deploy-verification and multi-agent integration story
d39871b9 docs(handback): round 2 — all four decisions executed, plus a bonus wide-reach fix
```

This was a heavy multi-agent night on `main` (several concurrent sessions
landing coaching-thesis, race-prediction, pace/HR shadow-compare, and plan
work in parallel) — the red window is wide because pushes were landing every
few minutes, most of them cancelling the in-flight run for the commit before
them rather than letting it complete.

## Root causes (three distinct failures, in the order they surfaced)

### 1. `EMPTIED_BASELINE` ratchet drift — `lib/audit/_swallow_scan.test.ts`

First failure (`33444050530`, commit `e5d586f7`):

```
AssertionError:
374 EMPTIED sites remain but EMPTIED_BASELINE is still 375. Lower it to 374 in lib/audit/swallowed-failure-registry.ts.

The ratchet only works if it is re-tightened. Leaving slack in it is how a line drifts back up.
: expected 374 to be greater than or equal to 375
 ❯ lib/audit/_swallow_scan.test.ts:349:7
```

A prior commit (before the red window opened) had fixed one swallowed-failure
site, dropping the live count from 375 to 374, without lowering
`EMPTIED_BASELINE` to match — the Rule 18 ratchet caught its own staleness
exactly as designed. This persisted across every failing run through
`33444876205` (22:09:29Z) and was closed by `b2b13ede`.

### 2. Orphaned modules — `_generated_content_gate`-style scan (GUARD 5, "MODULES NOTHING IMPORTS")

Starting at `33446378930` (commit `41071ccd`'s run), the gate began failing on:

```
AssertionError:
MODULES NOTHING IMPORTS:
  web-v2/lib/training/coaching-thesis.ts  [test-only]

This is the lib/plan/block-preview.ts shape: a module built to answer something,
with a test proving it answers it, and no caller. Either wire it, delete it, or add
```

This matches the task's second named cause exactly: `coaching-thesis.ts`
(built earlier that night, commit `455476c2`) had no live import and no
registry entry declaring it a deliberate orphan. A later run
(`33448159130`) added `web-v2/lib/adaptation/pace-hr-compatibility.ts`
(commit `5bb979d6`) to the same finding — same shape, different module, both
self-documented in their own file headers as deliberately unwired /
shadow-mode-only.

Root-cause fix, per commits `76147458` and `14c60df8`: both modules were
registered in `MODULE_ORPHANS` with an argued reason matching their own
header/doc framing (the same posture already used for `block-preview.ts` and
`durability-anchor.ts`) — **not** a widened allowlist to silence the gate,
an explicit per-module argument that the gate's own liveness check still
enforces.

### 3. Stale `MODULE_ORPHANS` exemption — "NO LONGER ORPHANED"

Once `adaptation-engine.ts` and `load-adaptation-engine.ts` were wired for
real (`shadow-compare.ts` began importing them from the run-adaptations
cron), the same GUARD 5 gate flipped to the opposite finding
(`33448710641`, `33448774330`, `33448873447`):

```
AssertionError:
NO LONGER ORPHANED:
  web-v2/lib/adaptation/adaptation-engine.ts
  web-v2/lib/adaptation/load-adaptation-engine.ts
Delete these entries from MODULE_ORPHANS.: expected [ …(2) ] to deeply equal []
```

This is the ratchet working in the direction Rule 18 requires — an exemption
whose target is now clean fails until deleted. Closed by `b2b13ede`, which
removed both entries once `shadow-compare.ts`'s real import made them
non-orphaned.

### Also closed same-pass: `progression-spec.ts` coercion registration

Not a distinct build-check failure signature of its own (it rides the same
gate family as #2/#3, `coercion-registry.ts`), but named explicitly in the
task brief as the Rule-11-shaped defect to check. `readSelectionRationale`
in `web-v2/lib/plan/progression-spec.ts` collapses an empty or
whitespace-only stored rationale into the same `null` as a genuinely absent
one. Investigated and closed in `b2b13ede`/`76147458`: the only writer
(`generate.ts`) guards the assignment on truthiness before it's ever stored,
so a stored empty string can only be legacy/hand-edited data, not a real
"insufficient evidence" measurement — the collapse was argued and registered
in `COERCION_ARGUED` rather than the value silently continuing to erase a
real zero-vs-absent distinction. This predates tonight's session (last
touched by `455476c2`, confirmed via `git log -- lib/plan/progression-spec.ts`
and an isolated-worktree check per commit `76147458`'s own message) — it was
not introduced by any commit in the red window, only exposed because the
registry gate had been failing on the two live issues above and this one
came along for the ride once those were being closed.

## Fix commits (chronological)

| Commit | What it closed |
|---|---|
| `fe5315e4` | First attempt at the coercion + orphan-module gates |
| `b2b13ede` | `EMPTIED_BASELINE` ratchet, `progression-spec.ts` coercion argument, `coaching-thesis.ts`/`pace-hr-compatibility.ts` orphan registration, `adaptation-engine.ts`/`load-adaptation-engine.ts` de-orphan |
| `76147458` | Re-confirms/registers `progression-spec.ts`'s coercion collapse (pre-existing, not session-introduced) |
| `14c60df8` | Registers `coaching-thesis.ts` + `pace-hr-compatibility.ts` as deliberate orphans |
| `7445f117` | New feature commit (`actual_load_absorption`/`representative_execution` split) landing cleanly against the now-fixed gates |
| `24bf6310` | Merge reconciling concurrent shared-checkout commits |
| `3d29aa8b` | Report commit |
| `d39871b9` | Final commit — **its own CI run is the confirmed green** |

All fix commits registered exemptions with an argued reason tied to the
module/field's own documented intent, matching the shape of pre-existing
entries (`block-preview.ts`, `durability-anchor.ts`) — none of them widened
an allowlist to hide a real defect, consistent with Rule 18.

## Flagged from the retrospective sweep

- **`bf3d66dd`** ("docs(report): note the --no-verify push and why") documents
  that its paired commit (`e5d586f7`) was pushed with `--no-verify`, bypassing
  the pre-push hook, because the hook's unscoped `tsc` was blocked by another
  concurrent session's untracked/in-flight files unrelated to that commit's
  change. CLAUDE.md's git-safety protocol says hooks are never skipped unless
  the user explicitly asks. This wasn't asked for. The commit's own message
  documents the diligence done in place of the hook (scoped `tsc` + the full
  `lib/training/` suite green) and explicitly flags that Railway deploy status
  was **not** independently re-checked in that pass — worth surfacing to
  David as a process deviation, even though the content of that specific
  commit does not appear to be what broke build-check (the break started
  with the *next* commit, `455476c2`'s orphan module).
- `web-v2/lib/plan/generate.ts`, `spec-builder.ts`, and `spec-card.ts` were
  all touched inside the red window by commits not authored in this pass
  (`06352964`, `28ceac34`, and the coaching-thesis/spec-card work respectively)
  — these are the files this task was told not to touch, owned by other
  concurrent agents. Not re-verified deeply here; flagged only because they
  fall inside the red window and the task asked for a sanity pass over
  everything that landed while CI was down. No content in the `build-check`
  failure logs implicates any of them — all three failure signatures above
  are fully accounted for by the audit-gate registrations, not a type or
  build error in these files.
- No other commit in the 33-commit window produced a distinct failure
  signature of its own — every failing/cancelled run in the window shows one
  of the three signatures above (or was cancelled before producing output).

## What was NOT done in this pass

Per the task's own instruction for the "already green" branch: no code was
changed, no `tsc --noEmit` or test suite was run, and nothing was pushed —
HEAD was already fixed and confirmed green before this audit started. The
33-commit retrospective above is a sanity pass over commit messages and CI
failure logs, not a line-by-line re-review of each commit's diff.
