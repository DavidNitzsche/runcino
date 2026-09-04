# Handback · round 8 — everything, consolidated

3 September 2026, late night. Deployed commit `6b2e9f82` on main, Railway
confirmed `success`. This document covers the whole arc from tonight's P0
through this final round — round 5 through 8 in one place, so nothing needs
cross-referencing five documents to reconstruct.

## The arc, in order

1. **WORKOUT-EXECUTION-ID-1** (round 5) — your friend's run rendered as your
   graded interval session on Today. Fixed: one canonical resolver
   (`lib/execution/day-resolver.ts`) decides EXACT vs LEGACY vs SUPPLEMENTAL
   for every surface that reads "what did the runner do today."
2. **EXECUTION-IDENTITY-1** (round 6) — the same resolver extended to the
   evidence path (`lib/execution/load.ts`, feeds the Adaptation Engine) and
   post-run analysis, closing the gap between "the runner sees it right" and
   "the engine believes the right thing." Full named test matrix. Treadmill
   structure and multi-run-day UI built.
3. **The round-7 delta** — a real incident (tonight's actual treadmill run)
   surfaced a further, more precise requirement: identity, completion, and
   evidence validity are three separate canonical decisions, and EXACT
   identity must never collapse into the other two. Traced read-only. Closed
   the third passive-type leak (`generate.ts`). Cross-session handoffs sent
   and answered.
4. **This round** — closed the one item left unverified (does averaged
   evidence let a single app-caused session force a downgrade — proven, with
   real production before/after data, that it cannot), your Friday/Sunday
   long-run swap, and three large merges with two other active sessions'
   work, all verified compiling and passing together.

## 1 · The core fix, and the proof that matters most

`lib/execution/day-resolver.ts` is now the one place every surface asks "did
this run satisfy this prescription." Three tiers: EXACT (`planWorkoutId`
match, stamped by the app's own live tracker at completion), LEGACY
(type-matched, but only from a live-tracked source — a passive sync's type
guess is never enough), SUPPLEMENTAL (everything else — real training, never
a completion).

**The best proof isn't a test — it's what actually happened.** While I was
mid-fix tonight, you ran the real hill session. It resolved `matched: exact`
via the new `planWorkoutId` stamp; the friend's earlier run stayed
`supplemental`. Not a simulation — the actual incident, live, correct.

Extended to the evidence path (`lib/execution/load.ts`): before the fix, a
threshold session graded off an unrelated easy run would have silently
poisoned VDOT belief, not just painted one screen wrong. Verified against
your real account: your 2026-09-01 threshold session reads `AS_PLANNED`
(correctly matched); this morning's hill session, before you ran it, read
`MISSED, actual: null` — even with the friend's run on the calendar that
date. A missing prescribed workout stays missing, exactly as required.

Also fixed the same shape on a fourth surface, `lib/postrun/detail-load.ts`
(reached directly by run id — the log, a supplemental run's own card): it
was grading whatever run was opened against "today's prescription"
regardless of whether that run executed it.

## 2 · The passive-sync heuristic — demoted everywhere found

Found live, twice: the friend's run carried `workoutType: 'intervals'` /
`workoutTypeSource: 'plan'`, stamped independently by the ingest path's own
date+distance heuristic — nothing to do with whether it was your workout.
Closed in three places, each falsified against the actual same-day rows:

- `day-resolver.ts`'s LEGACY tier — requires a live-tracked source now.
- `lib/postrun/detail-load.ts` — a run only inherits type/grading from a
  confirmed match, never a passive guess.
- `lib/plan/generate.ts`'s `detectMidBlock` signal 2 — the friend's real row
  matched the old predicate, excluded by the new one; your real treadmill
  session that date matched both.

## 3 · The full named matrix — 22 tests, plus a fourth pinning the adaptation
   boundary

Every scenario you named: exact linked execution, legacy app-tracked with
unambiguous type, passive sync on a prescribed day, supplemental before/after
the prescribed workout (array order proven irrelevant), a partial exact
execution beside a supplemental run, treadmill/phone/watch executions, a
delayed HealthKit duplicate resolving to ONE execution via canonical dedup, a
rescheduled workout matched on its new date, a race day with warm-up/cooldown
staying supplemental, a day with nothing prescribed, and batched multi-day
resolution without cross-contamination. Falsified per Rule 18 on the
highest-risk additions — each catches the exact regression it's named for
when deliberately broken.

## 4 · Identity, completion, and evidence validity are kept separate — traced
   against the real incident

You drew the line precisely: EXACT identity answers "which run was this,"
never "was it fully executed" or "does it count as capacity evidence."
Traced against tonight's actual run (4.71 of 6mi, cooldown cut short, an app
display bug — not a runner failure):

- 20 of 21 phases genuinely completed (all 10 hills, all 10 jogs, the
  warm-up); only the cooldown is honestly `completed: false`. The persisted
  data was never dishonest.
- The interpreter reads `PARTIAL_PRODUCTIVE`, `earnsProgression: false`,
  `evidence.fitness: low` — never `AS_PLANNED`, never progression-eligible,
  never claiming strong capacity evidence.
- Sealing was never contingent on match strength in this codebase to begin
  with — a day seals on any unmerged run existing for its date, independent
  of exact/legacy/absent.

**The one gap found and left honestly unresolved**: there's no field
distinguishing "the runner chose to stop" from "the app caused the
shortfall." `PARTIAL_PRODUCTIVE` is a reasonable, non-punitive read, but it
can't yet say "telemetry-compromised, here's what survived" as its own
category. A real design decision, not built this pass — the forensic
evidence (below) is what a build of it would start from.

**Root cause of the phase-target trace** — the run predates build 260 by 14
minutes; on build 259 the belt's per-phase incline target was hardcoded to
1% for every segment, including hills the server already prescribed 5% for.
Sent to the treadmill-owning session; independently confirmed and fixed
there, plus a second, deeper bug found on top (the phase re-stamp in
`Models/Watch.swift` was silently dropping `hrRole`/`treadmillInclinePct`/
`treadmillSpeedMph` to nil on every real decode — meaning even the 260 fix
was reading a value that never actually arrived). Both are now part of
`TREADMILL-STATE-MACHINE-1`, merged and verified in this round.

## 5 · The Adaptation Engine downgrade question — closed, with real evidence

The one item I'd flagged as genuinely unverified: could a single
telemetry-limited session, averaged into the 42-day evidence window, force a
downgrade on its own?

**Ran the real function against your account, both sides of the incident.**
`buildAdaptationComparisonRecord` at `2026-09-02` (before tonight's session)
vs `2026-09-04` (after): same 42-day window, same runner, one session added.
The execution score moved TOWARD zero (-0.679 → -0.559). Band stayed
`marginal`. Decision stayed `STAY`, in both directions. The session
displaced what the window would otherwise have counted as a plain miss, and
an honest partial effort scores better than an unexplained absence — exactly
the direction doctrine intends.

Pinned as a permanent, falsified regression test (`_adaptation_model.test.ts`):
a single telemetry-limited session inside a realistic, boundary-adjacent
window never caps the band below where a plain miss in the same slot would,
and the property survives independent of any one account's real data.

## 6 · Treadmill structure and multi-run-day UI

Warm-up, recovery, and cooldown now carry intentional, doctrine-cited
incline/speed (`TERRAIN.treadmill-air-resistance-grade`, 1%) instead of an
unexplained client default. Live HR suppressed specifically during 60-second
work reps, never during warm-up/recovery/cooldown where it's genuinely
readable.

Multi-run-day UI is built, not just API-ready: the prescribed workout stays
the Today hero on both before-run and after-run screens; supplemental runs
render as compact secondary rows underneath — visible, no verdict, no
workout-type label, never masquerading as completion.

## 7 · Cross-session coordination — sent, answered, converged

Sent the PLANVERSION-1 backfill package and the phase-target trace findings
to all four active sessions (no way to filter by ownership from my tools).
Responses:

- **The treadmill-runtime session** confirmed ownership, independently found
  the same build-259 bug, shipped the payload fix, found and fixed the
  deeper decode-drop bug, and has since landed a full canonical
  state-machine rewrite (`TREADMILL-STATE-MACHINE-1`) — merged into this
  branch, build succeeds, all my HR-suppression and target-priority logic
  correctly carried into the new architecture.
- **The pre-run-experience session** independently converged on the same
  build-259 finding, and has since landed "Run" as a real fourth tab, race
  content on Today, canonical distance resolution, and duplicate-session
  guarding across watch/phone — all merged, verified, deployed.
- **A third session** shipped `SHELLBYPASS-1`/`FETCHOWNER-1` (the shared
  shell now covers all seven day states) — merged, verified, deployed.
- **None of the four claimed ownership of Today's disk cache.** The
  PLANVERSION-1 backfill (`pln_7636bcc0a201bf2d`) is still unclaimed and
  still held, not run by me.

## 8 · Your schedule, changed at your direction

Original ask: move the 15-mile long run off Sunday. First idea (straight
Friday↔Sunday swap) would have put it the day immediately after tonight's
hills with zero recovery between — flagged that, you confirmed the travel
constraint (no long run Sat/Sun/Mon), and settled on:

```
Thu 9/3  intervals   6.0mi   (done — matched exactly)
Fri 9/4  long        15.0mi  (was Sunday's — swapped)
Sat 9/5  rest
Sun 9/6  easy        7.5mi   (was Friday's — swapped, "try for it while traveling")
Mon 9/7  rest        (this week only — taper into a 6.2mi race on Sun 9/13)
Tue 9/8  tempo       6.2mi
```

Executed as a field-level swap (type, distance, pace target, workout_spec,
notes) between the two existing rows — dates and ids unchanged. Verified
reading correctly through the live resolver. `last_adapted_at` bumped as
part of the write, so Today/week-strip/watch see it as a real content
change.

One separate finding along the way, not yet acted on: the race on 9/13 has
no matching row in the `races` table — it exists only as a `plan_workouts`
day. Flagged, your call on whether to add it properly.

## What's still open

- Who owns Today's disk cache — still unclaimed, backfill still held.
- The `TELEMETRY_COMPROMISED` classification design decision (§4).
- The 9/13 race's missing `races` table entry.
- Everything the treadmill-runtime and pre-run-experience sessions still
  have in flight, which is theirs, not reported here beyond "merged and
  verified compiling with my work."

Nothing here revisits closed round-6/7 work. Nothing here takes ownership of
Today navigation or treadmill runtime — both stayed with their sessions
throughout, including through three large merges tonight.
