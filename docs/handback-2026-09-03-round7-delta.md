# Handback · round 7 — delta only

3 September 2026, late. Deployed commit `626a4414` on main, Railway confirmed
`success`. Round 6 stands as approved — this is only what changed since.

## 1 · Identity, completion, and evidence validity — kept as separate decisions

You're right that tonight's real run is the proof case, and I traced it
against your seven requirements directly rather than asserting compliance.

**What the data actually shows** (run `-240375143823562`, matched exactly to
`wko_7afeef3d8f439088`):

- 20 of 21 phases — all 10 hill reps, all 10 recovery jogs, the warm-up —
  show `completed: true`. Only the cooldown is honestly `completed: false`
  (cut short at 90s). **The persisted phase data was never dishonest about
  what happened** — EXACT identity didn't cause anything to be marked done
  that wasn't.
- The interpreter's own read: `state: PARTIAL_PRODUCTIVE`,
  `earnsProgression: false`, `evidence: {execution: partial, adaptation:
  unknown, fitness: low}`, `why: "Well short of the session, without the
  effort coming apart. Recorded as partial rather than as a miss."` — **not**
  `AS_PLANNED`, **not** progression-eligible, **not** claiming strong
  capacity evidence. All 10 rep verdicts read `not_graded` (correct — the
  session is authored by-effort, no pace target to fail against).
- Sealing was never contingent on match strength in this codebase — a day
  seals the moment ANY unmerged run exists for its date (`isDaySealed`),
  independent of exact/legacy/absent. That separation predates this session;
  nothing tonight coupled it to identity, and nothing needed to be fixed
  there.

**So requirements 1, 2, 3, and 7 hold today, verified, not assumed**: EXACT
identity did not seal this as fully executed, did not grant progression
credit, and the grading pipeline already reads a real shortfall as partial
low-evidence — never as a graded failure against pace/HR/incline/rep targets
that were never applicable to a by-effort session in the first place.
Mileage (4.71mi) and load flow through `canonicalMileageByDay` untouched,
exactly as designed — nothing about grading ever narrows what a run
contributes to volume.

**Where I found a real, unresolved gap — requirements 4, 5, 6:**

`lib/adaptation/adaptation-model.ts` DOES average `stimulusCompletion`
(0.336 for tonight's session) across a training week's key sessions as one
term in a broader "training" score — proportional, not a binary trigger, and
this session is correctly bucketed as neither `MISSED` nor `REPLACED`. I
verified the mechanism is averaged rather than binary; **I did not** trace
the full downstream threshold math to prove a single low-completion session
inside a short evaluation window could never nudge a block-level verdict.
Say so honestly rather than claim full proof of requirement 7 at that layer.

More concretely: **there is no field anywhere that distinguishes "the
runner chose to stop" from "the app caused the shortfall."** The forensic
trace found real, specific evidence of app-side disruption this run —
`unmeasuredSec: 296` (a genuine ~5-minute gap the console never witnessed)
and the build-259 incline-target bug (below) — but nothing in the persisted
data or the interpreter's vocabulary captures that as a *reason*, distinct
from a runner's own pacing choice. `PARTIAL_PRODUCTIVE` is the closest
existing state, and it is a reasonable, non-punitive one — but it cannot
currently say "telemetry-compromised, here's what survived" as its own
category, which is what requirement 6 asks for.

**What I did NOT do, on purpose**: build a new formal state or write
anything into the classification. Per your instruction on the read-only
trace, I traced and reported. Whether a dedicated `TELEMETRY_COMPROMISED`
state (or an explicit `evidence.reasonCode` on the existing states) is worth
building is a real design decision — the evidence above is what a build of
it would start from.

## 2 · The phase-target trace — read-only, complete

Traced authored targets → watch payload → completion payload → persisted
phases → post-run input, all against tonight's real run. Full findings sent
to the treadmill-owning session (see §4) rather than acted on directly, per
your instruction.

**Root cause, precisely**: the hill session is authored by-effort
(`rep_pace_s_per_mi: null`, Research/04 §8.1 — correct, not a bug). Two
separate, real defects compounded on top of that correct authoring:

1. **Build staleness** — this run recorded on build 259, 14 minutes before
   260 (my fix) uploaded. On 259, the belt's automatic per-phase incline
   target was hardcoded to 1% for every segment, hills included, though the
   server was already prescribing 5%. Matches the persisted data:
   `actualInclinePct: 3.59%` on hill 1 — neither the 1% default nor the 5%
   target cleanly, consistent with a manual mid-run correction.
2. **A payload gap, structural, not build-specific** — `/api/watch/workouts/complete`'s
   wire contract never carried a `targetSpeedMph`/`targetInclinePct` field,
   only `actual*`. So even on a fixed build, the number shown live on screen
   never made it back to the server, which is the real reason post-run says
   "no prescribed pace" for a session that visibly had one.

## 3 · generate.ts — the third passive-type leak, closed

`detectMidBlock` signal 2 counted a run's `workoutType` stamp toward "has
this runner been doing quality" with no source check — same authority the
resolver's LEGACY tier already refuses. Fixed: the workoutType arm now
requires a live-tracked source; the self-reported `data->>'type'` arm is
untouched (different provenance, a hand-logged tempo still counts). Nothing
here touches mileage or load — this function only ever returns a boolean for
plan composition.

**Falsified live, both directions, against the actual same-day rows**: the
friend's real run (`source: apple_watch`) matched the old predicate,
excluded by the new one. The real treadmill session that date (`source:
treadmill`, genuinely quality) matches both — the fix excludes exactly the
misattributed row. Reverting the guard fails the new regression test.

## 4 · Handoffs — sent, and already answered

Sent the PLANVERSION-1 backfill package (plan ID, deployed fix, exact
statement, why it predates the stamp, what to invalidate) and the phase-target
trace findings to all four active runcino-* sessions, since `ListAgents`
gave me no way to tell which owned which half.

**Responses landed within the hour:**

- **runcino-ba** confirmed treadmill-runtime ownership, independently found
  the same build-259 incline bug, **picked up the payload gap and shipped
  it** (`targetSpeedMph`/`targetInclinePct` now added to the completion
  payload), and found a SECOND, deeper bug on top: `Models/Watch.swift`'s
  `WatchWorkout` decode was silently dropping `hrRole`/`treadmillInclinePct`/
  `treadmillSpeedMph` to nil on every real network re-stamp — meaning even
  build 260's fix was reading from a value that structurally never arrived.
  Fixed. A full treadmill state-machine rewrite is in progress on top of
  both; will hand back separately once verified.
- **runcino-58** independently converged on the identical build-259 finding
  while reconciling its own branch — confirms the diagnosis rather than
  contradicting it. Not the cache owner.
- **runcino-10** correctly declined both halves — scoped to post-run
  truthfulness/simplification, not Today-cache or treadmill-runtime.
- **runcino-ad** has not yet responded.

**The PLANVERSION-1 backfill (`pln_7636bcc0a201bf2d`) is still unclaimed** —
three of four sessions explicitly declined ownership of Today's disk cache;
none has picked it up. Still held, not run by me, per your instruction.

## What's still open

- Who owns Today's disk cache / `AppCache.swift` — the backfill needs that
  owner to surface.
- The `TELEMETRY_COMPROMISED` classification question from §1 — a real
  design decision, not yet made.
- The full block-level Adaptation Engine threshold audit (§1) — not done
  this pass, named honestly as unverified rather than assumed safe.
- Treadmill runtime's state-machine rewrite — runcino-ba's, in progress, not
  mine.

Nothing here revisits round-6 work. Nothing here takes ownership of Today
navigation or treadmill runtime — both stayed with their sessions throughout.
