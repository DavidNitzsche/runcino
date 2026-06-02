# Faff watch → backend: data collection strategy

For coordinating between the watch agent (UI/engine state) and the backend agent (schema, persistence, coach LLM consumption). Goal: turn the watch from a "shows the plan" surface into a structured-data-collection rig that gives Faff a real advantage vs Garmin / Apple Workouts / TrainingPeaks.

---

## The competitive thesis

**Garmin / Apple Workouts** capture data but don't *know* the plan — they show what happened, not whether it matched intent.

**TrainingPeaks / Strava + human coach** know the plan but the data round-trip is async: athlete runs → uploads → coach analyzes later → tells athlete to adjust the next time. Lossy, slow.

**Faff** owns plan + execute + data on the same surface. The watch knows the plan structure as it runs. Every recovery is a structured event, every rep has a target, every phase boundary is meaningful. We can capture data that's directly tied to the *intent* of the workout, not just the raw mechanics.

**The advantage**: a closed feedback loop (plan → execute → intent-vs-actual → adjust next session) that runs on the same wrist that prescribed the workout, with no manual logging step.

---

## What the watch already captures (per `WorkoutEngine.recordCurrentPhase`)

Each phase end currently records:

```swift
PhaseResult(
  index, type, label,
  durationSec,            // actual seconds spent
  distanceMi,             // actual miles covered
  avgPaceSPerMi,          // computed from total dist / total sec
  avgHr, maxHr,           // sampled per-tick, true averages
  avgCadence,             // sampled per-tick
  completed                // true if auto-advanced at the target, false if user skipped
)
```

The full set of per-phase results flows to `/api/watch/workouts/complete` at the end of the run, gated by `completionEndpoint`.

**This is good but it's all post-hoc aggregates.** The story between phase boundaries — drift, stability, recovery quality — is lost.

---

## What we should ALSO capture (proposal, prioritized)

### TIER 1: Within reach, biggest leverage

**1.1 Per-phase pace timeline (not just average)**
- Sample every 5 seconds: timestamp offset, instantaneous pace, distance covered
- Lets us detect: did you start the rep fast and fade? Did you sandbag rep 1 and crush rep 3? Was pace stable or sawtooth?
- Storage: ~80 samples per workout × 4 bytes each = trivial
- Coach signal: "rep 1 paced +0:08 fast, rep 3 paced +0:12 slow → set was too aggressive at the start, suggest -3s/mi target"

**1.2 Per-phase HR timeline (same cadence)**
- Sample every 5 seconds
- Recovery analysis: how fast did HR drop in the 2-minute recovery? Did it reach the target zone before the next rep started?
- Cardiac drift detection: rep 1 avg HR vs rep 3 avg HR at the same pace
- Coach signal: "HR recovered 22 bpm in 2:00 between rep 1-2, only 14 bpm between rep 2-3 → fatigue accumulating, drop the volume next week"

**1.3 Time-in-tolerance percentage per rep**
- Already computable from existing pace samples + `phase.tolerancePaceSPerMi`
- Per rep: "76% of this rep was within ±8 s of target"
- Coach signal: granular "did you hit the rep" verdict, not just avg

**1.4 Honest rep verdict**
- Already have `completed: Bool` (true if phase reached its target distance/duration before user ended it)
- Add: `verdict: "hit" | "drifted" | "missed"` derived from time-in-tolerance + avg pace delta
- Threshold: `hit` if 70%+ in tolerance, `drifted` if avg within tolerance but spotty, `missed` if avg outside

### TIER 2: New UX, real differentiator

**2.1 Post-rep RPE during recovery** (1 swipe / 1 Crown turn)
- During the recovery phase the runner is jogging — fine to look at watch briefly
- Show 4-button face (or Crown-rotation 1-5 scale): "Rep 1 — how was that?" 😬 😐 🙂 💪
- Auto-dismiss after 30s if no tap (no rep is logged, but workout continues)
- Tagged optional: legs / lungs / mind / pace was off (one tap on a chip)
- Coach signal: subjective fatigue per rep, decoupled from HR/pace (some runs the body says "fine" but the perception says "brutal" — that's a signal)

**2.2 Mid-rep struggle flag**
- The watch already knows when you're outside tolerance for >10 sec (the "drifting" face state)
- Capture: total seconds spent in `.drifting` and `.offTarget` per rep
- If `.offTarget` time > 50% of rep, flag the rep as `struggled` regardless of avg pace
- Coach signal: even if rep 3 avg was on target, if half of it was in the red zone, you bled through it

**2.3 Single post-run question**
- After Done is tapped, before the summary, one screen: "How'd that feel?" 1-5 stars
- Optional: 1 of 4 tags (good / heavy / off / hurt)
- Auto-skippable, but takes 2 seconds for those who use it
- Coach signal: anchor the run in subjective feel — the difference between "I PR'd and felt great" and "I PR'd and limped home"

### TIER 3: Bigger refactors, longer leverage

**3.1 Per-second telemetry as opt-in detailed mode**
- For race-day runs or coaching-emphasized sessions: capture pace + HR + cadence + position at 1Hz
- ~2000 samples per workout × 16 bytes = 32KB, still small
- Enables: detailed pacing analysis, course-position-vs-effort, pace consistency micro-graphs in the iPhone summary

**3.2 Environmental context**
- HealthKit provides outdoor temperature during the workout
- Add temp + humidity (if available) + time-of-day to the WatchCompletion
- Coach signal: heat-adjusted pace targets ("you ran 6:53 vs 6:47 target, but at 78°F humid — that's a hit, not a miss")

**3.3 Surface auto-detection**
- Accelerometer patterns differ on track / road / trail
- Watch can classify with reasonable confidence (maybe 70-80%)
- Send classification per phase
- Coach signal: track sessions != road sessions even at same target; comparing apples to apples requires the surface tag

**3.4 Mid-run beacon for live coach reaction**
- Currently the backend only sees the workout at completion
- For race day or rep sessions, could beam phase boundaries in real-time (every transition, plus every 5 min during long phases) over WatchConnectivity + iPhone push
- Backend can react: e.g., race-day mid-race adjustment if pacing is wildly off plan
- More invasive — separate decision

---

## What we need from the backend

These are the dependencies the watch agent has on the backend agent's schema + endpoints. Roughly in order of how much they unlock.

### Required (blocks tier 1 capture)

1. **Extend `WatchCompletion` payload schema** to include per-phase timeline arrays:
   ```ts
   phases: Array<{
     index, type, label,
     // existing aggregates...
     paceSamples: Array<{ tSec: number, paceSPerMi: number, distMi: number }>,
     hrSamples:   Array<{ tSec: number, bpm: number }>,
     timeInToleranceSec: number,
     timeOutOfToleranceSec: number,
     verdict: 'hit' | 'drifted' | 'missed' | 'incomplete',
   }>
   ```
2. **Where do per-phase results land in the DB?** Today they're embedded in the WatchCompletion JSON we POST. Is there a normalized `workout_phase_results` table I should be writing to, or do we expand the JSON column? *Backend's call — I just need to know where to deliver.*
3. **Migration plan**: if we add fields, do older watch builds (already in TestFlight) need to keep working? Backwards-compat versioning on the payload?

### Required for tier 2 (subjective in-run data)

4. **RPE schema**: per-rep subjective rating (1-5 + optional tag). Probably `rep_rpe` JSONB on the phase results, or a sibling table `workout_rep_subjective`. I'll send what you store.
5. **Post-run feel schema**: 1-5 stars + tag, per workout, separate from per-phase RPE.

### Coach-loop wiring

6. **Where does the coach LLM consume this data?** I want to know what the LLM is reading from when it produces next-session adjustments — so the per-phase data goes into the right place. Is it in `runs/{id}/analysis` payload, or built per-call?
7. **Is there a "verdict" or "adjustment" field the coach writes back per workout?** If yes, the next plan generation can read it and shift targets. Closes the loop.

### Optional / longer-term

8. **Real-time mid-run beacon endpoint** — `POST /api/watch/workouts/{id}/phase-transition` with `{ phaseIndex, atSec, phaseResult }` so the backend has interim state. Probably not for tomorrow. Worth deciding if/when.

---

## Implementation order I'd propose

If we agree on the strategy:

**Week 1 (this week, post-tomorrow's run):**
- Tier 1.1, 1.2, 1.3: extend `PhaseResult` Swift struct to carry pace + HR sample arrays + time-in-tolerance. Backend agrees on schema + storage path. Watch starts sending it.
- Iphone summary gets a per-rep bar chart (avg pace vs target, with the time-in-tolerance ribbon).

**Week 2:**
- Tier 1.4: verdict computation (watch-side, included in payload).
- Coach LLM starts reading the new fields and includes per-rep delta in its next-session adjustment.

**Week 3:**
- Tier 2.1: post-rep RPE prompt during recovery. New face built on the locked NumberFace law (or a takeover for the prompt). New `rep_rpe` field flows.
- Tier 2.3: post-run feel question.

**Week 4+:**
- Tier 2.2 struggle flag (cheap, derived from existing data).
- Environmental context (tier 3.2) — single HK query, no UX.
- Surface detection, mid-run beacon — bigger calls, defer.

---

## What I (the watch agent) will do regardless of backend timing

Even without schema changes, I can:

1. **Start collecting pace/HR samples in memory during the run** (no payload change, just held until we agree on shape). Per-tick sampling already exists for HR/cadence averages.
2. **Compute time-in-tolerance per phase** (watch-side derivation, no new data needed from anywhere).
3. **Add the post-rep RPE face** as a NumberFace-conforming layout, hidden behind a feature flag until schema lands.

These are cheap to prepare and easy to wire when the backend is ready.

---

## Questions for the backend agent

Drop these in your conversation and I'll work on the watch side while you sort the schema:

1. Are we adding fields to `WatchCompletion` JSON, or normalizing per-phase results into a relational table? Either is fine; I just need the shape.
2. What's the current path from `POST /api/watch/workouts/complete` → coach LLM input? Where in that pipeline do the new fields need to surface?
3. Backwards-compat policy for watch payloads — if I send a v2 schema, will older API versions still accept it (and a future API still accept v1)?
4. Is the iPhone Coach surface (`/today`) the right place to render the per-rep breakdown, or does it want a new screen?
5. RPE storage — separate table or JSONB blob on the phase result?
6. **Open ask from me to you**: are there other data points the coach already wishes it had from the watch, that I'm not thinking about? You see the coach prompts and outputs every day — what's the next signal the LLM is reaching for but doesn't have?

---

## TL;DR for sharing

> Watch knows the plan structurally as the user runs it. We should capture intent-vs-actual data per phase (pace timeline, HR timeline, time-in-tolerance, rep verdict) and beam it back with the completion. Optional Tier 2 adds subjective per-rep RPE during recovery and a post-run feel question. This closes the plan → execute → adjust loop on the same wrist, which is the actual moat vs Garmin / TrainingPeaks. Need backend to agree on schema + where the coach LLM reads from. Tier 1 can land in 1 week if schema is decided this week. Watch will start preparing the data layer regardless.
