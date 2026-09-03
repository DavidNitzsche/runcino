# Handback · round 5 — WORKOUT-EXECUTION-ID-1

3 September 2026 · written while you're out running tonight's hill session, so you can
fire off next steps without re-explaining context. Deployed commit `3d8157d7`, confirmed
`success` on Railway (not just pushed).

## What was broken

The Today hero showed your friend's unrelated 4.48mi easy run as `INTERVALS · done`, with
rep-grading prose ("Reps done"), over the 6mi hill session you hadn't run yet.

**Root cause, found precisely, not guessed:**

1. My first same-day fix (`TWO-RUNS-ONE-DAY-1`) ordered runs by `plannedWorkoutType IS NOT
   NULL` — a field populated on **1 of your 276 rows**, total. The completion endpoint has
   only ever written that value into a *different* key (`workoutType` /
   `workoutTypeSource`). The fix was almost a total no-op the moment I shipped it.
2. Once I switched to the field that's actually populated, a second live defect appeared:
   the friend's run **already carried `workoutType: 'intervals'`**, stamped by the passive
   HealthKit-sync path's own date+distance heuristic — nothing to do with whether it was
   your workout. Trusting that field alone would have let the same bug back in.
3. Underneath both: "a run exists on this date" was being read as evidence of completion,
   full stop. It never was.

## The fix — one canonical resolver

`lib/execution/day-resolver.ts`, now the single place Today, Watch Today, and Run Detail
all ask "did this prescription get satisfied":

- **EXACT** — a new `planWorkoutId` field, the literal `plan_workouts.id`, now stamped at
  write time by `/api/watch/workouts/complete` for anything tracked live through the app
  (watch, phone GPS, treadmill).
- **LEGACY TYPE** — same type, but *only* when the run came through the app's own live
  tracker — never a passive sync — and only when the day carries exactly one prescription
  of that type. Two same-type sessions in one day, or a same-type passive sync, correctly
  refuse rather than guess.
- Everything else is **supplemental**: real training, counts toward mileage and load, never
  touches completion, sealing, or grading.

Verified directly against production data just now: your hill prescription reads
`matchedRun: null` (correctly unmatched), the friend's run reads `supplemental`. 12 new
tests cover your named matrix. Falsified per Rule 18 — loosening the source gate reproduces
the exact regression. Caught and fixed 3 of this repo's own gates (coercion-scan,
swallow-scan, derived-consistency) along the way.

Also cleaned up a stray `excludedReason` key I'd written on the friend's run earlier
tonight — it never actually took effect (the `mergedIntoId` write silently failed), so
nothing needed undoing, but the note now says so honestly instead of implying an exclusion
that never happened.

## Verified for tonight specifically

Full 21-phase treadmill structure loads: warm-up → 10×(60s hill @ 5% incline, 7.7mph / 2min
jog) → cool-down. Confirmed live, post-deploy.

## Open — named, not dropped

1. **Warm-up / recovery / cooldown carry no treadmill-specific incline** — only the 10 work
   reps do. Warm-up/cooldown still get a sensible speed (they have a real pace target);
   recovery phases fall back to the client's flat default. Real gap.
2. **Multi-run-day UI** — prescribed workout as hero, supplemental run as a visible
   secondary card underneath. API is ready to carry this; nothing on the native side
   renders it yet.
3. **`lib/execution/load.ts`** (the adaptation/evidence pipeline feeding VDOT belief and
   the Adaptation Engine) still selects "richest description of the day" rather than
   routing through this same resolver — same risk shape, not yet hardened. Should land
   before any adaptation promotion.
4. **TestFlight-255** — distributed per App Store Connect, not yet confirmed by a device
   recording.
5. **Audit-stamp before/after verification** (the `recomputePacesForPlan` run from earlier
   tonight) — not re-verified this round.

## Suggested order, your call

Items 1 and 3 are the two with real coaching-integrity weight left. 2 and 4 are UI/ops
polish. Say which to take first, or "keep going" and I'll take them in that order.
