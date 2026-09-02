# P0 coaching loop · Phase 0 status (trustworthy baseline) · 2026-09-01

Interim note for external review. Phase 0 is running on branch `p0/gates`
(six commits on top of `main` at `7cac80f0`, not yet merged). Every commit
below was falsified before and after the fix — the gate was made to fail on
a planted violation, the fix landed, and the same plant was shown to fail
again — and the commit body records the plant and both results.

## What Phase 0 was asked to do

1. Repair the two evidence tests that pinned live production rows' data
   quality (they failed whenever the owner's account changed).
2. Close the gate holes the independent audit named: F-2 (the swallowed-
   failure ratchet was a budget), F-3 (coach-voice gate excluded `lib/plan`),
   F-8 (plan-writer registry was per file, not per statement), F-29
   (easy-discipline graded against an archived plan).
3. Add a full-suite CI job so a green push means the whole suite ran.
4. Stop a test from dirtying the repo it tests.

## Landed on `p0/gates` (in order)

| Commit | What it fixes | Falsified |
|---|---|---|
| `9c2c18d8` | Evidence test no longer asserts a live production row's data quality. The stale prod-row assertions are gone; the test now grades the reader's behaviour on fixtures and the audit variant stays read-only. | yes |
| `12086e29` | The adaptation shadow-compare test appended to a git-tracked JSONL log when run read-only. File fallback is now opt-in, so a test run cannot modify the repository. | yes |
| `e1ed5848` | F-2. `EMPTIED_BASELINE` was a scalar count, so a swallowed DB read could be added to the plan engine and paid for by tidying an unrelated `.catch`. The ratchet is now keyed on `file::symbol` identity, fails in both directions (new site, stale entry), and the shell gate's integer is cross-checked against the list length. | yes, A+B swap reproduced from the audit |
| `c634d479` | F-3. Coach-voice gate widened to `lib/plan`, `lib/watch`, `lib/execution`, `lib/prescription`, `lib/race`, `lib/today` (189 → 290 files). 85 findings: 65 runner-facing strings rewritten, 14 verbatim doctrine anchors exempted with `// ok:`, one JSDoc reflowed. | yes |
| `17834cbd` | F-8. `check-automatic-mutations.sh` now derives plan writers per statement (`file::enclosingFunction`, 17 sites), so a second writer inside an already-declared file can no longer inherit the first one's answers. Plant pinned as a fixture. | yes |
| `4c1c8c23` | F-29. The active-plan scanner skipped any `plan_workouts` query that never mentioned `training_plans`; that exact shape was the live bug. Gate widened to user-scoped `plan_workouts` reads. `easy-discipline.ts` now joins the active plan and takes the nearest upcoming easy row. Verified read-only across all seven production users: new band == active plan for 7/7; the old query read an archived plan for 2/7, one of them 40 s/mi off. | yes, both halves |

Files touched: 32 (+1,272 / −463), all under `web-v2/`.

## Still in flight on Phase 0

- Full-suite GitHub Actions job (item 3). The agent is running the affected
  suites now; the workflow file has not been pushed yet.
- Stale coercion-ratchet entry found while falsifying (`HANDED_BACK_KNOWN`
  carried one more entry than the scanner sees) — being closed the same way.
- Merge to `main`, in order, ahead of the Phase 1 evidence contract.

## What Phase 0 does not claim

- Nothing here changes a coaching number. Every commit is a gate, a test, or
  a population fix; the one behavioural change (easy-discipline's band) was
  proven to equal the active plan's band for every user.
- Green on these gates is not a deploy (Rule 19). The Railway deployment will
  be confirmed separately once `main` moves.
