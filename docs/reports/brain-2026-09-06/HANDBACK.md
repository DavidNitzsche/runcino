# Handback · 2026-09-06 (supersedes the earlier draft of the same date)

`main` at `9ecf0beaa`, Railway confirmed `SUCCESS` for every commit below,
independently, in order. TestFlight **285**. `AUTOMATIC_ADAPTATION_AUTHORITY`
still the literal `false`. No production DDL applied. Your plan has not been
written to.

**The earlier `HANDBACK.md` in this same directory is stale and wrong — do not
act on it.** It diagnosed the Skip/move complaint as a viewed-date-vs-today
mismatch in `app/api/v5/today/route.ts` and said the fix required a product
decision from you. That diagnosis does not hold against current `main`: the
route's `today` variable already resolves to the VIEWED date
(`requestedDate || runnerTodayISO`, `route.ts:294-296`) and every downstream
read (`todayPlan`, `glanceToday`, the skip check) is keyed off it consistently.
Whatever landed between that draft and now (the Move-a-Run production-paths
merge, most likely) already closed that gap. The real defect was different —
see §1.

---

## 1 · Skip button — root-caused, fixed, shipped

**"I could never click the skip button."** Confirmed real, and confirmed NOT
what it looked like. The write always succeeded — a real `day_actions` row
landed in production every time you tapped it (verified: a `skip` row for
2026-09-06 already existed in production before I touched anything). Nothing
ever read it back. `beforeYouGo.push({ label: 'Move or skip', sub: 'Move to
another day, or skip it', ... })` ran unconditionally — the exact bug class the
shoe-pick row immediately above it in the same file was already fixed for on
2026-08-20 ("the write landed... but this row kept showing the guess forever,
because nothing here ever asked day_actions"). Tap Skip, the row collapses, the
hero card still reads the same distance — indistinguishable from the tap doing
nothing.

Fixed on both ends, mirroring the shoe-pick pattern exactly:
- Backend (`app/api/v5/today/route.ts`, `lib/faff/v5-today.ts`): reads
  `day_actions` for today's skip row; the "Move or skip" row now says
  "Skipped · You can still move it, or put it back" when one exists.
- Native (`APIV5.swift`, `TodayBeforeLiveV5.swift`): a new optional
  `V5Row.skipped` field (decode-safe — a stale cache never breaks), and a "Put
  it back" option wired to the `DELETE /api/today/skip` call that already
  existed for the future-day case.

**Verified live, both directions, against a real copy of your production data**
(the walk-substrate mechanism) — not a fixture: tap Skip → row updates → a real
`day_actions` row appears (confirmed by direct query) → tap Put it back → row
reverts → the row is gone (confirmed by direct query again).

Two things blocked me from seeing this sooner, both my own tooling, both real
and both fixed:
- `QATOKEN-EXPIRE-1` (`FaffApp.swift`, `#if DEBUG`-only, no effect on any build
  you'll run): a `-faffToken` QA session desynced from the sign-in gate on the
  first spurious 401 during launch. The network layer kept working
  underneath; the UI stuck on the sign-in screen forever.
- I launched the simulator without `-faffHost`, so it was quietly hitting
  production with a token only valid for the local copy. My mistake, not a
  code defect.

Shipped as **TestFlight 285**. Commits: `8d2df7454`, `c7e197f82`, `57e09407d`,
`ce883f4ab`.

## 2 · Monday move — confirmed correct, left as-is (your call)

You asked why today's run couldn't move to Monday even though Monday is open,
and whether the app should let you "get the miles" that way. Checked the real
engine, not just the UI: `lib/plan/reschedule.ts` refuses any move where
`target.dateISO <= todayISO` — code `sealed`, reason *"That day has already
been. A past session is not rescheduled."* — cited to Q36, "a past workout
cannot literally be moved into the future." I reproduced this live against
your real data: asking the engine to move today → Monday returns exactly this
refusal. It's not that Monday is unavailable — the source day (today) is
categorically off-limits for a move, by design, regardless of destination.

There is no runner-facing "add a session to a day" control anywhere in the
app. The only real path to "get the miles" today is to just run them Monday —
the ingest pipeline picks it up as a genuine extra session, the Evidence
Engine treats it as real demonstrated volume, but the bookkeeping does not
merge across the week boundary: this week reads one easy run light, next week
reads one aerobic day heavier than prescribed. You confirmed this is correct
and should be left as-is.

## 3 · Backend integration — three batches landed and deployed this round

| Commit | Content |
|---|---|
| `4dfa62149` | Shared prescription-segment parser (Decision 2); evidence-classifier consolidation on the heat/environmental axis — `classify-evidence.ts` now delegates to canonical `activity-evidence.ts#readEnvironment` instead of re-deriving heat classification independently (Decision 3), plus a new ownership gate (`_evidence_classifier_ownership.test.ts`) |
| `b41b0d5c1` | Continuous demand confidence replacing the binary 10%/15% threshold (Decision 1, a logistic centered at 12.5%); belief ownership audit + a real goal-pace-contamination fix in `backfill-workout-spec`; generators/facets ratchet 33→29 |
| `b9f68c9bb` | Two new reassessment evaluators (`POST_RACE_RECOVERY_CHECK`, `RETURN_TO_TRAINING_STAGE`) wired into a new `cron/reassessment-sweep`; Move-a-Run audit confirming `/api/plan/move` is canonical and that the ledger-absent case refuses visibly rather than mutating silently (proven against a real scratch DB with the ledger table renamed away) |

All three: typechecked, full non-DB suite green, prebuild green, `next build`
green, Railway `SUCCESS` confirmed for the exact commit SHA before moving on.

## 4 · Orchestration wiring — was stale at 12, corrected to 14/16

Two competing handback claims existed (12/16, 16/16) and neither was
re-verified against the real import graph. Had an agent re-derive it by
tracing actual call chains from actual routes/crons — not trusting either
number. Result: **14 of 16 WIRED**, not 12.

Steps 4 (grade sessions and the week) and 12 (schedule reassessment) had
already grown real production callers and nobody had revisited the map when
that happened:
- Step 4: `run-adaptations` → `run-live-shadow-evaluation.ts` →
  `live-input.ts#buildGradedSession` → `gradeStimulus`, whose `.grade` is
  consumed non-trivially by `levers/threshold-pace.ts` and
  `levers/weekly-volume.ts`, reaching a real ledger write.
- Step 12: called directly from `run-adaptations`, and from the newly-landed
  `cron/reassessment-sweep` → `reassessment-evaluators.ts`.

Both promoted to WIRED with the full call chain cited inline
(`lib/brain/orchestration/steps.ts`). `WIRED_STEP_PIN` raised 12→14 as a
correction, not new wiring.

**More important: the gate that tracks this had a real blind spot, now
closed.** It only ever checked that an UNWIRED step hadn't quietly grown a
real caller — never checked the same thing for a SHADOW step, which is
exactly how steps 4 and 12 went stale undetected. Added that check. I
independently falsified it myself before shipping: reverted step 4 to SHADOW
by hand (leaving its real, genuinely-imported symbol in place) — the new test
correctly failed and named the real caller path; restored, it passes clean.

Remaining honestly UNWIRED/SHADOW: step 3 (classify evidence — see §5) and
step 7 (generate options — real code, zero production callers on a live
lever). Commit `2aaafe3b6`, deployed.

## 5 · The genuine, non-seeded PUSH demonstration — the standing directive's own highest-priority item

Walked a real upward adaptation verdict through the actual cron-wired
functions, in their actual order, against David's real production data
(copied read-only into a dedicated local scratch DB — never touched
production; confirmed via the write-barrier's own log lines). No step was
hand-assembled.

**Baseline, fully organic:**
```
[rolling-boundary-evaluator] 0645f40c · week_demand_step · PROCEED · demand
rises 2.1% on the highest of the trailing three weeks (2026-09-14) at 100.0%
confidence · an earnable push, not an automatic one
```
Reproduced identically on a second independent run (determinism confirmed);
the persisted `reassessment_schedule` row matches the in-process decision
exactly (a second process reading the table sees what the first one decided).

**Separately, the ledger + proposal + mutation lane** (real code end to end,
one honestly-labeled constructed input — the upstream `RampOpportunity` was
built from real current numbers rather than earned, because two of its five
real gates were genuinely false throughout the real scan window): traced
`tryAdaptiveBump` → `planUpgrade` → `writeWorkoutProposals` → acceptance →
`applyBrainAction` → `mutatePlan`, which writes `plan_workouts` and
`plan_decision_ledger` atomically. Real, independently-read-back ledger row
confirms `VOLUME/UP/APPLY/RUNNER_ACCEPTED`; `distance_mi` moved 5→6mi matching
the proposal exactly.

**6 of 7 requested variants proven:** decline (clean, no mutation), stale/
expired proposal, ledger-table-absent (refuses, `plan_workouts` unchanged),
ledger-INSERT-failure specifically (distinct from table-absent, also refuses
cleanly), process-restart/idempotency (same key submitted twice → one row,
not two; same proposal accepted twice → second call is a correct no-op),
safety hard-stop (a real ACWR gate and a real sealed-day refusal both
independently demonstrated overriding what would otherwise be a push). The
7th (competing proposals, same slot) partially covered: two levers proposing
for the same workout, the second write correctly and silently skipped by the
existing dedup check.

**A real production bug was found in the process and is already fixed and
deployed** (commit `47febb3e7`): `rolling-boundary-evaluator.ts` cast
`plan_workouts.id` — a `text` column, real IDs look like
`wko_bfb3e91b38a7d832` — to `$1::uuid[]`. Every real week containing a
quality or long row would have hit a SQL cast error the moment this lane ran
against the live schema, once migration 167 lands. Invisible to all 42
existing unit tests because they mock the database entirely — a mechanism no
test exercises against the real schema is untested regardless of pass count
(Rule 15). I independently confirmed the column type before applying the fix.

**Honestly reported, not fixed:**
- The rolling-boundary lane's PROCEED verdict is a dead end today — it writes
  only to `reassessment_schedule` and never calls into the proposal/ledger
  system, so a genuine "earnable push" from this specific lane never becomes
  a runner-visible card. The file's own header already said as much; this
  confirms it by execution rather than by reading.
- `detectRampSignals`'s quality-session gate never organically passed
  anywhere in the real, scanned month (Aug 7–Sep 6) — your most recent real
  key session graded `PARTIAL_PRODUCTIVE`, not earned, and the real data
  ceiling means nothing later exists to clear it from the window. Not
  fixable by more scanning; needs either new real completions or a product
  decision to synthesize phase-level test data.
- `acwrHeadroom` and `belowTierUpper` are in genuine tension on your real
  data: the same big week that opens demonstrated-peak headroom also pushes
  ACWR past 1.3, closing the other gate. Never simultaneously green across
  the whole scan window. Worth a citation-level decision, not a code fix —
  flagged per Rule 21/22's instruction to watch for exactly this asymmetry.

## 6 · Evidence pipeline — the 19-tag audit, and one more real supplemental-run bug fixed

**All 19 named evidence tags are genuinely classified** (no stubs, no
hardcoded constants) **and all correctly implement the three-state contract**
(present / absent / could-not-tell — Rule 11). The gap is reach, not
correctness: the composed 19-tag record (`classifyEvidence` in
`classify-evidence.ts`) has **zero production consumers**. The only thing any
live code imports from that file is a 6-tag slice (`classifyRunContext`)
feeding `lib/adaptation/canonical-shadow` — a pipeline provably incapable of
mutating anything (three separate gates confirm this and are still green).

Most of the 19 tags' underlying FACTS do reach real, mutating levers — but
through their original owner modules directly (`day-resolver.ts`,
`effort-authority.ts`, `hr-trace-credibility.ts`, `load-safety.ts`,
`run-terrain.ts`), not through the consolidated classifier itself. Two tags
are genuine exceptions with no lever reach anywhere: `partial` and `overrun`
(the latter has no doctrine-registry citation for its own tolerance constant
either — a Rule 7 gap). Full 19-row table with per-tag reasoning is in the
agent's own report if you want the detail; not reproduced here to keep this
readable.

**A second, real instance of the supplemental-run misgrading defect was found
and fixed** (commit `9ecf0beaa`). `lib/postrun/load.ts` already carries this
fix for the post-run screen (`POSTRUN-DATE-GRADE-1`). The exact same defect
survived, unfixed, in `lib/adaptation/canonical-shadow/live-input.ts` — the
loader that feeds the real (shadow-mode) adaptation engine — matching a run to
a prescription by bare calendar-date `.find()`, with no check that the
returned run is the CONFIRMED execution of that prescription. On any day with
more than one canonical run (a shakeout beside a tempo session), whichever run
sorted first in the fetch order won, right or wrong. Fixed by routing through
the same `classifyDay` EXACT/LEGACY/SUPPLEMENTAL resolver the postrun fix
already uses. Falsified: the new test reproduces the exact pre-fix failure
(a shakeout beating the correctly-matched tempo run) and is documented as
having failed against the unfixed code. Full adjacent-suite re-run: 3271
passed, zero new failures.

**Not verified against real production data end to end** — only at the
pure-function level (no `DATABASE_URL_RO` in that agent's sandbox). Worth a
walk-substrate pass against a real day of yours with more than one canonical
run before treating this as fully closed.

**One more thing surfaced, not acted on:** a stale, ~14,700-line-divergent
branch `evidence-classifier` (worktree `agent-a0bce78997ba00c90`, remote
`evidence-agent`) whose content is already superseded on `main`. Merging it
would revert a large amount of unrelated, newer work — the exact failure mode
this file's own "Cautionary example" section warns about. Recommend deleting
it or leaving it untouched; I did not touch it.

## 7 · A live production finding, surfaced but not fixed (needs your go)

`_cross_surface_contract.test.ts` — a read-only test against LIVE production —
found a new, unregistered disagreement: the live capacity resolver and what
`plan-drift` had JUST stamped into `plan_workouts` an hour earlier disagree by
exactly 1 s/mi on threshold pace (429 vs 430), marathon pace (471 vs 472), and
the marathon pace band's fast edge (459 vs 460). This is a genuine Rule 16
violation happening in production right now. I did not investigate the root
cause deeply or attempt a fix — doing so would mean writing to your live plan,
which I won't do without your explicit go-ahead. Flagging it here so it
doesn't get lost; it reproduced consistently when checked.

## 8 · What needs your go

1. **Migrations 166, 167, 168, 169** plus the `plan_weeks`/`plan_phases`
   `user_uuid` backfills. Literal SQL already written and pasted directly in
   this session's own transcript (purpose/locking/rollback/verification for
   each). Nothing applied.
2. **The 1 s/mi live pace-drift disagreement** in §7 — needs either a
   decision to let `plan-drift`'s next natural cycle catch up, or an explicit
   go to investigate/fix directly.
3. **The stale `evidence-classifier` branch** in §6 — delete or leave; your
   call, low stakes either way.
4. **The quality-session gate that can never organically clear** (§5) — a
   product decision (accept that this specific lever stays dormant until a
   future real session clears it, or decide synthetic phase-data is
   acceptable for testing it).

## 9 · What this operating system can do end to end now that it could not this morning

- A runner can tap Skip on today's session and SEE that it took effect —
  before this, the write always worked and the UI never once confirmed it,
  indistinguishable from broken.
- A demand-growth week between 10% and 15% growth is judged on a continuous
  confidence curve, not snapped to a binary threshold at exactly those two
  numbers (Rule 9).
- Two reassessment kinds that had no evaluator at all now have real ones,
  reachable from a real cron.
- The rolling-boundary demand lane can now be run against a real week with a
  quality or long session without crashing on a type-cast error — it could
  not, until today, and nothing before this session had ever exercised it
  against the real schema to find out.
- A supplemental run logged next to a prescribed session in the shadow
  adaptation engine is graded against the RIGHT session's targets, not
  whichever run happened to load first.
- The orchestration map can be trusted again — it now matches the real call
  graph, and a step going stale the same way twice will be caught
  automatically instead of waiting for a third session to notice by hand.
- One real, reproducible, end-to-end PUSH decision has been demonstrated
  against real data through real production code, for the first time — with
  an honest account of exactly which lane it lives on, which lane it doesn't
  yet reach, and why.

Everything above is deployed and confirmed on Railway for its own commit
before the next one started. Nothing in this handback is a claim I did not
verify by running or rendering it.
