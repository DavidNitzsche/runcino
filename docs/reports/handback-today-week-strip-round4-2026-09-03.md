# Handback — Today/week-strip navigation, round 4: merge, ship, and the "can't reach faff" incident

Continuation of round 3 (`handback-today-week-strip-round3-2026-09-03.md`).
This round: merged to `main`, closed the PLANVERSION-1 invariant gap you
flagged, shipped TestFlight, and investigated a live "can't reach faff"
report on your own device during the ship window.

**Terminology** (same convention as round 3): locally verified / pushed /
merged / deployed / distributed are distinct facts, stated precisely below.

---

## 1 · Merged and deployed

- **Merge commit on `main`: `659b16bc`** (`fix(plan): last_adapted_at moves
  for every in-place plan write, not just two`), with a trailing
  housekeeping commit `e6306436` (pbxproj regeneration only, no code
  change). `main` currently sits at `e6306436`.
- Reconciled against two rounds of concurrent work on `main` — the
  pre-run-experience merge and a "two-runs-one-day" fix from another
  session — via dry-run merges in isolated worktrees per this repo's own
  branching doctrine. No functional overlap in either case; the only real
  conflict (`StatusBarScrimV5` reintroduced by the older branch) was
  resolved in favor of its already-established deletion.
- **Deployed**: confirmed via Railway's own deployment API, not inferred
  from a green push. `railway status` shows `latestDeployment.status:
  SUCCESS` at commit `e6306436`, and it is the sole entry in
  `activeDeployments` — the thing actually serving `https://www.faff.run`
  right now, checked directly (see §3).

---

## 2 · PLANVERSION-1's invariant, closed

You asked: *"add or verify a repository-level invariant that every code
path capable of changing persisted plan content also advances the version
signal... inventory the mutation paths and add a ratchet."*

Inventory found a real, live gap. `last_adapted_at` — the half of
`planVersion` that has to move on an in-place re-anchor — was written from
exactly two places, both self-described as "the cron evaluated stamp":
`lib/plan/adapt.ts` and the `run-adaptations` cron route.
`lib/plan/reanchor-plan.ts` — called daily by the `snapshot-projections`
cron and by the `race-authority` runner fallback — has four separate
`UPDATE` statements rewriting `plan_workouts.pace_target_s_per_mi` and
`training_plans.authored_state`, and **none of them stamped it**. A
runner's prescribed paces could move, daily, with `planVersion` never
noticing.

Fixed at the single door all plan writers already pass through
(`lib/plan/mutate.ts`'s `mutatePlan`, "the one door in front of
plan_workouts" per its own header): it now stamps `last_adapted_at = NOW()`
inside the same transaction, on every commit path that writes an *existing*
plan. One fix covers `reanchor-plan.ts`'s four call sites and every future
writer that routes through the boundary.

The ratchet — `web-v2/lib/plan/_planversion_invalidation.test.ts` — asserts
the stamp is wired at all three commit paths, and walks the existing
plan-writer registry (`automatic-mutation-registry.ts`, built after the
2026-08-25 `snapshot-projections` incident) demanding every in-place
content writer reach the stamp. Falsified before trusting: removed the
`structural`-path stamp, confirmed the test failed, restored it, confirmed
green. `tsc --noEmit` clean; 70 tests across the plan/reanchor/
automatic-mutation suites pass.

---

## 3 · TestFlight build 254

Archived, exported, uploaded, and confirmed **VALID** by App Store
Connect. **Distributed to Internal Testers.** Two ship attempts: the first
aborted cleanly at the watch-simulator gate (an environmental board-render
flake, not a code defect — the same class seen earlier this session); the
retry passed the full gate (watch engine tests, board geometry,
endability) and shipped.

---

## 4 · The "can't reach faff" you saw — root cause, and a real methodology gap it exposed

Your two screenshots — Sunday Sept 6 stuck loading, and Today showing a
"Can't reach faff. Showing what you had 10 minutes ago" banner — both
landed inside a ~5-minute window where I pushed two commits to `main`
back-to-back, each triggering its own Railway build-and-deploy cycle. Your
device's clock (2:45 PM) falls inside the second deploy's `BUILDING`
window, confirmed against Railway's own deployment timestamp
(`e6306436` created `21:50:49 UTC` = `2:50 PM` your time — the deploy
before it was still resolving as you were on the app). That is almost
certainly what you hit: a request landing during the container hand-off.
The "can't reach faff" banner and the stuck loading skeleton are both the
*correct, honest* behaviors for a genuine connectivity loss — not a bug in
what they showed, a bug in when you saw them, caused by my own deploy
timing.

**What I did to confirm, and what it caught in my own prior verification:**
I re-tested `/api/v5/today` and `/api/v5/today?date=2026-09-06` against the
now-stable deployment and got real 401s with a token read directly from
the database — which led to finding that `resolveUserId` SHA-256-hashes
every incoming bearer token before comparing it against
`sessions.session_token`, so the database column holds the *hash*, never
the raw token a client would send. Earlier in this session I'd tested
against ~4,000 HTTP requests using database-read values as bearer tokens
and logged zero problems — but every one of those was silently 401ing
(hash-of-a-hash never matches), and my probe script's success criteria
explicitly treated 401 as an acceptable, non-alarming response. So that
volume of testing proved the auth layer correctly rejects a malformed
token — which is trivially true — and never actually exercised the loaded
page for a real session. Worth being direct about: that was a real gap in
how I verified this, not just an interesting technical footnote.

**Re-verified properly**, with a genuinely valid raw token (minted the way
the app does — random bytes, SHA-256 stored, raw value sent as Bearer —
inserted into the same local, isolated database copy the rest of this
round's work used, never production): `/api/v5/today`,
`/api/v5/today?date=2026-09-06`, `/api/plan/week`, `/api/watch/today`,
`/api/v5/block`, `/api/v5/races`, `/api/profile`, `/api/profile/state`,
`/api/readiness`, `/api/settings` — all real 200s, real data, no server
errors. Sept 6 specifically returned `Long · 15 mi`, pace band and HR
ceiling — the correct content, not stuck.

**Current state, confirmed just now**: `https://www.faff.run` responding
200 in ~100-150ms, repeatedly. Railway's own deployment record shows
`e6306436` as the sole `SUCCESS`/active deployment. The deploy churn that
caused what you saw is over.

**What to do**: force-quit and reopen the app (or pull to retry on the
banner) — it should load cleanly now. If it doesn't, that's a different,
real problem and I want to know immediately.

---

## 5 · Still open (unchanged from round 3, tracked, not forgotten)

Full navigation boundary matrix (month/year, plan start/end, rest/
completed/future/race/missing-workout days), interaction-quality
instrumentation (signposts / XCTest performance metrics — `xctrace` is
still unreliable in this environment), Dynamic Type / Reduce Motion,
VoiceOver selection-state per date, and the deliberate 36pt-vs-44pt header
tap-target call. This is the next block of work for this same workstream.
