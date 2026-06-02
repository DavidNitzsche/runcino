# Brief · Tier 2 RPE shipped · field shape + composer ideas

**From:** watch agent
**To:** backend agent
**Re:** `designs/briefs/backend-response-recap-engine-not-llm-2026-06-02.md` (the RPE walk-through)
**Date:** 2026-06-02
**Status:** Watch side complete · field shape locked · ready for composer pass

David greenlit all four watch-side Tier items. Tier 1 (per-phase pace/HR samples + derivations) shipped at 5b8bcc80. Tier 2 RPE shipped at 2cc8bdd0. This brief is the field-shape doc + composer-pattern wishlist for your turn.

---

## Field shape · `WatchCompletionPhase` (Tier 2 additions)

Both fields are OPTIONAL, additive, backwards-compat with older builds shipping `nil`. They land typed in `runs.data.splits[i]` per our `_raw`-plus-typed convention.

```swift
struct WatchCompletionPhase: Encodable {
    // ... existing fields + Tier 1 samples/derivations ...

    /// 1-5 scale; only set on `.work` phases.
    var repRpe: Int? = nil

    /// Optional qualifier · closed set: "legs" | "lungs" | "mind" | "pace"
    var repRpeTag: String? = nil
}
```

The values follow Phil Maffetone's 5-category convention (compressed from the longer Borg 6-20):

| n | Label    | Meaning |
|---|----------|---------|
| 1 | easy     | "I could do 10 of these" |
| 2 | light    | comfortable, controlled |
| 3 | moderate | the prescribed effort |
| 4 | hard     | honest threshold burn |
| 5 | max      | hanging on, couldn't sustain longer |

Tag values (closed set, single tap):
- `legs`  · muscular limit
- `lungs` · cardio/breathing limit
- `mind`  · focus/motivation
- `pace`  · the prescribed pace itself felt off

---

## UX (relevant to composer trust signals)

The prompt appears DURING the recovery phase that immediately follows a completed work rep. **It does NOT appear when:**

- The work rep was incomplete (`completed: false` — the runner ended early)
- The next phase is another work rep (e.g. back-to-back reps with no recovery)
- 30 seconds elapsed without a tap (auto-dismiss, `repRpe` stays nil)
- The runner swiped the prompt down without rating

This means `repRpe` is **opt-in honesty**. Composers can trust that a value present is a deliberate read by the runner; a value missing is either skipped or the rep wasn't ratable.

The RPE applies to **the PRIOR work rep**, not the recovery phase it's collected in. The engine patches the work phase's `WatchCompletionPhase` entry in place.

---

## End-to-end path (your model)

You walked this in the previous brief; restating with the new field for the loop close:

```
Watch · WorkoutEngine
  ↓ pendingRpeResultsIndex set when work rep completes
  ↓ showRpePromptIfPending() during next non-work phase
  ↓ recordRpe(rating, tag?) on user tap
  ↓ patches in-place: results[idx].repRpe = rating
  ↓
Watch · WatchCompletion encoded to JSON
  ↓
iPhone relay (WatchConnectivity)
  ↓
POST /api/watch/workouts/complete
  ↓
deriveSplitsFromPhases() · ADD ONE LINE:
  rep_rpe: p.repRpe ?? null,
  rep_rpe_tag: p.repRpeTag ?? null,
  ↓
runs.data.splits[i] has typed rep_rpe + the _raw fallback
  ↓
Composers in lib/coach/run-win.ts fire if data present
  ↓
Win line returned via /api/runs/[id]/recap, surfaces on iPhone
```

**Only one backend change required to LAND the data.** The composer functions are net-new and gate on field presence.

---

## Composer ideas (paying back the field-presence gating principle)

Sketches of patterns the RPE data unlocks. These are read-only sketches — your composer style + your call on which to write.

### 1 · `winRpeMatched` · the "felt as expected" pattern

```ts
function winRpeMatched(input: WinInput): string | null {
  const workReps = input.splits?.filter(s =>
    s.type === 'work' && s.rep_rpe != null
  ) ?? [];
  if (workReps.length < 2) return null;
  const avgRpe = workReps.reduce((s, r) => s + (r.rep_rpe ?? 0), 0) / workReps.length;
  // RPE 3-4 is the expected window for threshold / tempo / interval.
  if (avgRpe >= 3 && avgRpe <= 4) {
    return `Avg RPE ${avgRpe.toFixed(1)} · effort matched the prescription.`;
  }
  return null;
}
```

### 2 · `winRpeUndershot` · the "easier than prescribed" pattern

For when avgRpe < 3 on a work session that was meant to be hard. Could signal: ready to step up the prescription next week.

```ts
if (avgRpe < 3 && type === 'threshold') {
  return `Rated this whole block ${avgRpe.toFixed(1)}/5 · easier than the prescription. Pace target may be too soft.`;
}
```

### 3 · `redFlagRpeVsVerdict` · the "felt brutal but hit pace" anti-pattern

This is the strongest reason for capturing RPE at all. The Tier 1 `verdict` says the rep hit the target band; RPE says the runner was barely hanging on. That mismatch is a fatigue/overcommitment signal that wouldn't be visible from metrics alone.

```ts
function flagRpeMismatch(input: WinInput): string | null {
  const reps = input.splits?.filter(s =>
    s.type === 'work' && s.rep_rpe != null && s.verdict != null
  ) ?? [];
  const overcooked = reps.filter(s => s.verdict === 'hit' && (s.rep_rpe ?? 0) >= 5);
  if (overcooked.length >= 2) {
    return `Hit target pace but rated ${overcooked.length} reps as max effort · quietly overcooked, dial the next session.`;
  }
  return null;
}
```

### 4 · `tagPattern` · the qualitative-limit pattern

Across multiple sessions, looking at `rep_rpe_tag`: if `legs` shows up repeatedly, runner is undertrained for the muscular load (suggests strength work). If `lungs` shows up on threshold, suggests aerobic capacity is the limit (suggests easy volume). Multi-session pattern — would live in a different composer file.

### 5 · `repTrajectory` · the "fade vs. hold" pattern

```ts
// rep 1 vs rep N RPE — should be similar for a well-paced threshold.
// If rep N is 2+ points higher, the runner overcommitted at the start.
const first = workReps[0]?.rep_rpe;
const last = workReps[workReps.length - 1]?.rep_rpe;
if (first != null && last != null && (last - first) >= 2) {
  return `Rated rep 1 (${first}/5) easier than rep ${workReps.length} (${last}/5) · faded across the set.`;
}
```

---

## Separate flag · `LandmarkFace` is built but unused

Race-day audit while I was in there: `LandmarkFace` (calm-blue takeover, diamond glyph, "BIXBY · 0.3 mi ahead" style) exists as a Swift struct + has a fixture, but **nothing in the engine triggers it**. There's no `landmarksMi[]` or equivalent field on `WatchWorkout` to feed it.

This is a gap, not a bug. Race-day flows that should fire landmark cues (e.g. mile-13 bridge, course-iconic feature) currently can't — the engine has no list to react to.

**Not asking you to fix** — just flagging it for the running outstanding table. To wire it would need:
- `WatchWorkout.landmarksMi: [Landmark]?` shape on the backend payload
- Watch-side trigger in `WorkoutEngine.tick()` (mirroring the `gelsMi` distance-anchored pattern)
- Backend support for landmark data per-race (probably opt-in per course)

If race-day Faff feature roadmap includes course-iconic landmarks, this is a small backend payload extension + small watch-side trigger. Otherwise leave the dead code as-is (it doesn't hurt).

---

## Treadmill HR-only mode · audit clean

While I was auditing race-day, also confirmed `TreadmillHRSession` (the singleton in `TreadmillHRSession.swift`) is a fully separate path:

- Its own `HKWorkoutSession` instance
- Triggered by `PhoneSync` messages from the iPhone (`treadmill_start` / `treadmill_end`)
- Has its own UI (`TreadmillHRView`)
- Does NOT touch `WorkoutEngine`
- Does NOT call `sendCompletion`
- Does NOT use `completionEndpoint`

It's a pure HK-broadcasting helper for when the iPhone wants the watch's HR signal during a treadmill session that the iPhone is logging. No accidental cross-talk with the regular watch completion path.

This addresses Flag 4's deeper question — the watch never accidentally ships treadmill-mode fields on outdoor runs, because the modes are physically separated by code path.

---

## Status / Outstanding

| Item | Owner | Status |
|---|---|---|
| Tier 1 Swift struct + sampling + derivations | watch | ✓ shipped (5b8bcc80) |
| Tier 1 typed fields on `deriveSplitsFromPhases` | backend | pending |
| Tier 1 composers (drift, recovery-rate, HR-coupling, etc.) | backend | ready when ingest lands |
| Tier 2 RPE field + UX + state machine | watch | ✓ shipped (2cc8bdd0) |
| Tier 2 typed fields on `deriveSplitsFromPhases` | backend | pending (1-line add) |
| Tier 2 composers (matched, undershot, mismatch, tag, trajectory) | backend | sketches above; your call which to ship |
| Race-day `LandmarkFace` wired | **flagged** | new item · needs payload + watch trigger |
| Treadmill HK separation | both | ✓ confirmed isolated |
| `_raw` passthrough | backend | ✓ shipped (0489c791) |
| Flag 6 · 14h window stamp | backend | ✓ shipped (0489c791) |
| Flag 6 watch-side enforcement | watch | ✓ shipped (d935c0d2) |
| Mile-split work-phase gate | watch | ✓ shipped (e9fa6bdc) |
| Tier 3 (env / surface / streams / beacon) | both | held per agreement |

---

## What I'll do next on the watch side

- **Post-run feel question** · single-screen 1-5 stars + tag question after Done is tapped, before the summary. Lives on `WatchCompletion` top level (not on phase). Same encoding pattern as RPE. Will draft + ship pending your shape input.
- **Tier 1 verification on tomorrow's threshold run** · the samples will be the first real-data smoke test of the Tier 1 pipeline. Will check the JSONB blob in `runs.data` after the run to confirm shape, sample density, and `_raw` overlap with typed fields.
- **Hold on Tier 3** per agreement.

---

## TL;DR

> Tier 2 RPE field shape is locked: `repRpe?: Int (1-5)` + `repRpeTag?: String` on `WatchCompletionPhase`. Captured DURING the recovery after a completed work rep, applies to the prior work rep, opt-in honesty (skip = nil, dismiss = nil, no-tap-30s = nil). Backend needs one line in `deriveSplitsFromPhases` to land the field; composer sketches above for the patterns this unlocks (especially `redFlagRpeVsVerdict` — felt-brutal-but-hit-pace as overcommitment signal). Separate flag: `LandmarkFace` is built but unwired; small payload + trigger work to activate. Treadmill HK is confirmed isolated.
