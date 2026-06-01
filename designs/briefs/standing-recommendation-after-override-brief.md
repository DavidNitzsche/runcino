# Brief · standing coach recommendation surfaces after runner override

**For:** backend / plan-adapter + coach-engine agent
**From:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Ask · new field on PlannedDay (or per-day adaptation
envelope) that names the engine's current recommendation for a row

---

## TL;DR

When a runner overrides an adaptation (via Restore Original), the
amber "Adapted from ..." banner correctly clears. But if the
engine's underlying reasoning STILL holds today (RHR still elevated,
sleep still short, etc.), the runner deserves to KNOW that the
coach hasn't changed its mind · they're choosing to override the
recommendation, not erasing it.

Add a `standingRecommendation` field to each planned-day shape on
the seed. Populated when the engine, evaluating live signals today,
would currently recommend a different prescription than the active
plan_workouts row. Null when the engine agrees with the active row
(or has no opinion).

---

## The runner moment

David, 2026-06-02 (today): tapped Restore Original on his TUE
THRESHOLD workout earlier (the auto-adapter had downgraded it
because of an 8-day sleep streak + RHR averaging 57 bpm). Backend
restored the row · chip now shows THRESHOLD · adaptation banner is
gone.

But his sleep streak is still active. His RHR is still 9 bpm above
baseline. The signals that prompted the original downgrade
haven't materially changed in the few hours since he tapped
Restore.

The current frontend implies "coach has nothing to say about this
run." That's wrong. The coach STILL thinks easing this run is the
right call · the runner is choosing to override that judgment.
There's a difference, and the runner deserves to see it.

David: *"i restored this tuesday run to the original plan, but we
should still show that the coach recommends changing it (as long as
that stays a real recommendation)."*

The qualifier matters: ONLY when the recommendation is still real,
not a stale echo.

---

## Proposed shape

Add to `glance.weekDays[].standingRecommendation` (and to
`training.weeks[].days[].standingRecommendation` for FULL PLAN month
cells) so the frontend has it on every planned day shape:

```ts
standingRecommendation: {
  /** What the engine recommends as of NOW · re-evaluated against
   *  live readiness / load / streak signals. NOT a replay of the
   *  prior adaptation. */
  kind: 'ease_down' | 'shave' | 'reschedule' | 'maintain' | 'push_back';
  /** Single sentence in coach voice · names WHY the recommendation
   *  stands. No citations. */
  copy: string;
  /** Optional kind-specific payload · e.g. what the eased version
   *  would look like. Frontend uses to render the "accept this
   *  recommendation" action shape. Null when not applicable. */
  suggestion: {
    proposedType?: string;     // ease_down · 'easy' / 'recovery'
    proposedDistanceMi?: number; // shave · the new distance
    proposedDateIso?: string;   // reschedule · new date
  } | null;
  /** Confidence the engine has in the recommendation today. Drives
   *  visual weight (soft advisory vs prominent warning). */
  severity: 'advisory' | 'firm';
} | null
```

Null when:
- The engine agrees with the currently-active row.
- The runner already accepted the recommendation (no override needed).
- No active signals trigger any recommendation.

Populated when:
- The engine, given live signals as of the most recent readiness
  snapshot, would currently push back on the active row.
- Includes both "this was overridden and the engine still disagrees"
  AND "this was never adapted but new signals suggest it should be"
  cases.

---

## Re-evaluation rule

The recommendation **must** be a live re-evaluation, not a replay
of a coach_intents history row.

Re-fire criteria · the engine should produce a `standingRecommendation`
when:

1. The active workout would NOT pass `detectAdaptations()` if it
   ran today against today's signals (the same logic the auto-
   adapter uses, just non-mutating).
2. The runner does NOT already have an accepted plan_proposals row
   for this same kind on this workoutId.

Clear criteria · the engine should produce `standingRecommendation = null`
when:

1. The signals that prompted the prior recommendation have resolved
   (sleep streak broke, RHR returned to baseline, etc.).
2. The runner accepts the recommendation (a fresh adaptation fires).
3. The workout becomes past (completed, archived).

---

## Frontend rendering

When `standingRecommendation` is non-null, surface as a SECONDARY
advisory on the hero · visually distinct from the amber "was X"
banner. The "was X" banner is HISTORY (this changed and is back).
The standing recommendation is FORWARD COUNSEL (coach still thinks
you should consider X).

Sketch:

```
TUE · TEMPO · PLANNED
THRESHOLD
6.0 mi · 6:47 · ~41 min

▼ Coach still recommends easing this run.
   Resting HR averaging 57 bpm, 9 above 14-day baseline.
   [ Accept ease ]  [ Proceed with threshold ]
```

The "Accept ease" button POSTs through the existing proposal
acceptance flow (writes a new adaptation, mutates the row,
clears the standing recommendation). "Proceed with threshold" is
implicit · the runner just goes run.

Visual treatment: cooler color (blue-grey advisory) than the warm
amber that signals history. Not a warning · a respectful second
opinion.

---

## What's NOT in this brief

- Auto-re-downgrading after restore · the runner just overrode, the
  engine should not silently re-apply. The standing recommendation
  is the right surface; the runner can accept it explicitly.
- A "cooldown" on the adapter · the engine should keep evaluating
  every day. The `standingRecommendation` IS the surface that
  represents "engine still has an opinion, but you're driving."
- Multi-recommendation stacking · if the engine has multiple kinds
  of recommendations (shave + ease), the composer picks the highest-
  severity one and emits a single `standingRecommendation`.
- A separate "coach disagrees" history view · the
  `coach_intents` audit trail already captures this for diagnostics.

---

## Why this fits the closed-loop architecture

The brief from `designs/briefs/backend-state-2026-06-01-landed.md`
locked three rules:

1. Hard drift = no accept gate (race date / goal time auto-applies)
2. Soft drift = accept/dismiss card (volume / VDOT / staleness)
3. All triggers read shared signals

This adds a fourth case: **post-override · standing reminder**.
The runner already made a call. The engine respects it. But the
engine's underlying judgment doesn't disappear · it surfaces as a
respectful "still here if you want it."

Aligns with David's locked autonomy doctrine: the runner is the
human in the loop. The engine never overrides their override · it
just stays honest about its view.

---

## How to respond

1. Confirm the shape for `standingRecommendation` (or push back).
2. Confirm the re-evaluation cadence (per-request? once per
   nightly cron + cached?).
3. PR link when shipped · frontend will wire the secondary
   advisory + the [Accept] button to the existing adaptation
   acceptance flow within the day.

---

## Related

- `designs/briefs/restore-original-workout-endpoint-landed.md` · the
  restore endpoint · this brief adds the "what happens AFTER
  restore" layer.
- `designs/briefs/adaptation-visibility-backend-brief.md` · the
  current adaptation envelope · `standingRecommendation` is the
  forward-looking companion to it.
- `web-v2/components/faff-app/views/TodayView.tsx` · PlannedHeroV2
  · the `.adaptline` band is where the existing "was X" subline
  renders · the new advisory would mount as a sibling below.
