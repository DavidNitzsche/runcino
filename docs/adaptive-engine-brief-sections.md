# Adaptive-engine brief — the 20 sections

**Provenance:** copied 2026-08-28 from `adaptive-engine/README.md` lines 78–99 ("Architecture — brief section → module"), the sole surviving copy of the section list of David's 20-section adaptive-engine spec (see memory: the active build, §19 is the spine). Preserved here because `adaptive-engine/` is untracked; this file is the tracked backup. The module mapping is the README's own, as of the copy date.

## Architecture — brief section → module

| # | Brief section | Module(s) |
|---|---|---|
| 1 | Build a runner model first | `src/model/training-history.ts` — chronic vs. acute volume, consistency, streaks, `weeksAtCurrentVolume` (the thing that actually separates "25 mi/wk for six months" from "ran 25 last week") |
| 2 | Performance model (VO2max, threshold, economy, durability) | `src/physiology/vdot.ts` (Daniels-Gilbert VDOT curve), `src/model/performance.ts` (anchor extraction + weighted blend), `src/physiology/riegel.ts` (fatigue-slope durability) |
| 3 | Current load (external / internal / musculoskeletal) | `src/model/load.ts` — three channels, deliberately not collapsed into one ACWR number. Exposure-novelty (longest recent run vs. 4-week ceiling) is a first-class signal alongside acute:chronic ratio, per the brief's citation that raw ACWR misses this |
| 4 | Recovery / readiness | `src/model/readiness.ts` — composite Green/Yellow/Red from independent domains (autonomic, sleep, subjective, performance, load, health); Red requires ≥2 adverse domains or a hard override, never one metric |
| 5 | Goal definition + honesty | `src/goal/assess.ts` — feasibility ladder (comfortable → realistic → ambitious → aggressive → out-of-reach), safe/stretch targets, required trajectory |
| 6 | Training arc (states, not weeks) | `src/plan/arc.ts` — return/foundation/development/specific/peak/taper/race-week as readiness-gated segments; only taper/race-week are date-anchored |
| 7 | Intensity distribution | `src/plan/distribution.ts` — polarised/pyramidal/threshold-led chosen per athlete (volume, tier, phase, event), not a fixed 80/20 |
| 8–9 | Workout purpose + personalized prescription | `src/plan/purpose.ts` (the adaptation table), `src/plan/library.ts` (structure), `src/plan/prescribe.ts` (multi-control-system output: duration/pace/HR/RPE together) |
| 10 | Environment normalization | `src/environment/` — Minetti grade cost, heat/dewpoint index, altitude VO2 decrement, surface. Every run is normalized to an *equivalent pace* before the model sees it; prescriptions are de-normalized back into what today's conditions will actually feel like |
| 11–14 | Learn from every run, adapt both ways, detect response patterns | `src/adapt/evaluate.ts` (MEASURE: completion / effort ratio / pace delta), `src/adapt/adjust.ts` (ADAPT: corroborated-signal downshift, demonstrated-adaptation progressive overload), `src/model/response.ts` (trend detection with correlation gating, not just slope) |
| 15 | Runner memory (N=1) | `src/model/memory.ts` — lagged-correlation hypotheses (does threshold volume actually pay off *for this athlete*, is there a volume ceiling, what does a long run cost in recovery days, 2 vs. 3 hard sessions). Only `adopted` hypotheses (confidence + sample-size gated) are allowed to steer prescriptions |
| 16 | Confidence model | `src/core/confidence.ts` — evidence arithmetic: quality × recency-decay × source-independence. A single source, however repeated, cannot reach "high" |
| 17 | Graceful degradation | `src/model/runner-model.ts` `classifyDataTier()` + fallbacks throughout (`enrich.ts` infers distance from duration when GPS is absent, `performance.ts` falls back through race → threshold-workout → training-pace → population default). More data raises confidence and personalization; it never gates whether a plan is produced |
| 18 | Safety guardrails | `src/plan/guardrails.ts` — a layer that sits *above* the engine and can only ever subtract: single-session exposure ceiling, weekly volume ceiling, dose caps (T≤10%, VO2≤8%, race-pace≤20% of weekly volume), hard-session spacing, readiness/illness/pain response. Never diagnoses; always says what changed and why |
| 19 | The week is an output | `src/plan/arc.ts` (`TrainingArc`, the persistent object) + `src/plan/microcycle.ts` (`Microcycle`, one view of it) |
| 20 | The product loop | `src/engine.ts` `runTurn()` — OBSERVE → MODEL → PLAN → PRESCRIBE → MEASURE → LEARN → ADAPT, one function |
