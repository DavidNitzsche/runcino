# Brief · KEY WORKOUTS TO RACE · training trajectory + adaptation dedup

**For:** backend / coach-engine + plan-adapter agent
**From:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Ask · two fields on `season.adaptations[]` / milestones data

---

## TL;DR

The KEY WORKOUTS panel in TrainView is showing two-step-removed
information:

1. The "→ Logged" line on DONE workouts is a placeholder · should be
   a **training-trajectory signal** authored in coach voice.
2. The "Adapted: eased to easy ..." line on a row that was
   subsequently restored via `POST /api/plan/restore` is **stale** ·
   the adaptation history needs to be deduplicated against the override
   intent.

Both are field-shape additions / filters on the existing
`season.adaptations[]` data the panel reads.

---

## 1 · Training trajectory line per workout

David: *"this is about training. did it help, why? on track or
consistent or didn't hit the paces, etc."*

The KEY WORKOUTS panel is the runner's **trajectory view**. Each row
answers ONE question: did this workout move my fitness toward the
race? The current "→ Logged" string is a placeholder · meaningless.

### Proposed field shape

Add to each milestone / done workout in the seed:

```ts
trainingInfluence: {
  kind:
    | 'on_track'    // delivered the intended stimulus, fits the phase
    | 'consistent'  // N-th in a row, the pattern is building
    | 'working'     // produced a real signal (VDOT bump, HR drop at pace)
    | 'slipping'    // pace fell off, stimulus not delivered
    | 'compromised' // adapted, skipped, or partial · training cost
    ;
  /** Single-sentence coach voice. Authored. Doctrine-aware. */
  copy: string;
} | null;
```

Field lives on whatever shape `season.adaptations[]` (or the
milestones equivalent) uses for each done row. Null when the workout
hasn't been done OR when the trajectory can't be confidently named yet
(brand-new runner, no plan reference, missing data).

### Example outputs per kind

| Kind | Copy example |
|---|---|
| on_track | "Cruise intervals hitting threshold pace. Race-pace work compounding." |
| consistent | "Third threshold workout in three weeks. Aerobic stimulus building." |
| working | "Pace held with HR 4 bpm lower than last cruise. Aerobic engine sharper." |
| slipping | "Threshold pace 9s slow this week. Two more weeks like this and the goal slips." |
| compromised | "Downgraded · 24-72h fatigue signal. Cumulative threshold work behind plan." |

The copy is the runner's read on whether the WORKOUT helped the
RACE. NOT a recap of execution mechanics ("pace was X, HR was Y") ·
that lives in the run-detail modal.

### Doctrine the composer reads

- Workout type → expected stimulus (cruise = threshold zone work,
  long = aerobic base, intervals = vo2 development)
- Done pace + HR vs planned pace + HR
- Trend across recent same-type workouts (consistency vs one-off)
- Plan phase (build vs taper · stimulus expectations differ)
- Distance of goal race · the trajectory is goal-anchored
- Active adaptations from coach_intents (compromised state)

### Out of scope for this field

- Per-workout execution details (split-by-split, instantaneous pace,
  cadence) · those belong in the run-detail modal.
- A doctrine citation footer (we're past that · no citations rule
  applies here too).

---

## 2 · Adaptation array dedup against overrides

David hit this: a workout was downgraded by the auto-adapter
(`plan_adapt_downgrade` row in coach_intents), then David used Restore
Original (which writes a `plan_adapt_overridden` row). The chip-level
state is back to THRESHOLD (correct · `plan_workouts.original_*` were
NULL'd). But the KEY WORKOUTS panel's "← Adapted: eased to easy ..."
line is still firing on that row because it reads
`season.adaptations[]` which sources from coach_intents history ·
the OLD downgrade row is still there.

### Fix

When emitting `season.adaptations[]`, suppress (or annotate) entries
where a **subsequent** `plan_adapt_overridden` exists for the same
`workoutId`. Two reasonable shapes:

**Option A · Suppress at source.** Don't include the older adaptation
in the array. Runner sees no "Adapted: ..." line for restored rows.

**Option B · Add `supersededByOverride: boolean` flag.** Frontend
filters or annotates. More data on the wire, more flexibility for
future surfaces (e.g. a runner's override history view).

Frontend preference: **Option B** — leaves the door open for an
"Overrides" view later without re-shipping the backend. But A is fine
too if you'd rather keep the array small.

### Implementation note

The same row could in principle bounce multiple times (adapter
downgrades → runner restores → adapter downgrades again on new
evidence → runner restores again). The dedup logic needs to be
"most-recent intent wins" per workoutId, not "any override clears
the history."

---

## How both connect

Both are reads on the closed-loop training signal. A workout that
was downgraded and then restored is `compromised` until the runner
actually executes the original · then it earns `on_track` or
`slipping`. The training-trajectory field can read the dedup'd
adaptation history to decide which state.

---

## David doctrine · always cleanest

David, 2026-06-01: *"always cleanest option for future proofing."*

No defensive frontend backstop on either of these. The field shape
lands at the source. Frontend renders it. If backend ships and the
copy needs editing, that's a backend re-ship, not a frontend
re-touch.

---

## How to respond

1. Confirm the field shape for `trainingInfluence` (or push back with
   a counter-proposal).
2. Pick Option A or B for the dedup.
3. PR links when shipped · frontend will swap "→ Logged" for
   `m.trainingInfluence.copy` and apply the dedup in same-week
   commits.

---

## Related

- `designs/briefs/restore-original-workout-endpoint-landed.md` · the
  restore endpoint that writes the `plan_adapt_overridden` intent.
- `designs/briefs/no-citations-lock-and-restore-uuid-cast-landed.md` ·
  the "no citations anywhere" lock applies to the new `copy` field.
- `web-v2/components/faff-app/views/TrainView.tsx` · KEY WORKOUTS
  panel · `milestones[].influence` is the placeholder shape we'd
  replace with `trainingInfluence`.
