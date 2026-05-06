# Coach Build Plan

> **Goal:** make `docs/coaching-research.md` and `docs/amp-research.md` the
> mastermind of the app. Every coaching judgment in Runcino — pacing,
> workout prescription, fueling, taper, retrospective, race-morning brief —
> routes through a single `Coach` entity that reads from structured doctrine
> extracted from the research. Doctrine constants cite their source
> section; LLM judgment calls run with the full research as a cached
> system prompt so the coach speaks with one voice.

**Status:** Stage 0 in progress · 2026-05-06

---

## Architecture

```
Layer 1 · DOCTRINE              web/coach/doctrine/*.ts
   Structured constants extracted from research, each with a Citation
   pointing to the source markdown section. Pure data.

   intensity.ts  · §3   polarized / pyramidal / threshold percentages
   volume.ts     · §4   base targets, weekly mileage by experience
   workouts.ts   · §5   each workout type's purpose + pace formula
   strength.ts   · §6 + amp-research.md
   fueling.ts    · §7   carb targets, hot-day nudges, gut training
   recovery.ts   · §8   sleep targets, modalities that work
   shoes.ts      · §9   super-shoe rotation rules
   cadence.ts    · §10  form-work triggers
   heat.ts       · §11  acclimation windows
   masters.ts    · §12
   load.ts       · §13  ACWR bands, injury thresholds
   taper.ts      · §14  depth + duration by distance

Layer 2 · COACH                 web/coach/coach.ts
   Single entry point. Every decision returns a CoachDecision with
   { answer, rationale, citations[] }. Internally chooses:
     - deterministic rule (reads doctrine)
     - or Claude call with research doc as cached system prompt
       (judgment calls only — race-morning brief, retrospective insight,
        unusual situations)

   coach.prescribeWorkout(state)
   coach.assessReadiness(state)
   coach.taperDepth(daysOut, distance)
   coach.paceStrategy(course, goal, weather)
   coach.fuelingFor(course, weather, gut)
   coach.briefRaceMorning(race, conditions)
   coach.retrospect(plan, actual)         → calibration
   coach.adjustForReality(missed, sleep, hrv, acwr)

Layer 3 · APPLICATION
   /api/build-plan ──► coach.paceStrategy + coach.fuelingFor
   /api/coach/today ─► coach.prescribeWorkout + coach.assessReadiness
   /api/coach/brief ─► coach.briefRaceMorning
   detail page hero ─► coach.assessReadiness today
   actuals saved ────► coach.retrospect → recalibrate
```

**Two brains.** The Coach decides per-call:

1. **Deterministic** — math, lookups, ACWR, GAF, taper percentages. Fast,
   free, repeatable. Most coaching decisions go here.
2. **LLM (Claude)** — judgment calls only. Race-morning brief, retrospective
   insight, "this is unusual, what would the doctrine say?" calls. Full
   `coaching-research.md` + `amp-research.md` cached as system prompt;
   user state in the user message; structured `CoachDecision` returned.

---

## Stages

| Stage | What lands | Visible? | Status |
|-------|------------|----------|--------|
| **0 · Skeleton** | `web/coach/` dir, `Coach` interface stub, `CoachDecision` type, `Citation` type, `doctrine/` directory, ONE exemplar doctrine file (`intensity.ts`) showing the extraction pattern, plan persisted to repo, `voice.md` locked in | No (foundation) | ✅ done |
| **1 · Extraction** | All Tier-1 constants from research → 12 doctrine files. Existing `coach-principles.ts`, `pacing.ts`, `coach-workouts.ts` refactored to read from doctrine. **Zero behavior change**, but every magic number now cites research | No (foundation) | pending |
| **2 · LLM brain** | Cached system prompt with full research doc. First use case: race-morning brief (new endpoint + tile in race detail) | ✅ tile lands | pending |
| **3 · Coach today on web** | `/training` page consumes `coach.prescribeWorkout` + `assessReadiness`. Daily card with rationale + citation link | ✅ daily UI | pending |
| **4 · Retrospective loop** | Race finish → `coach.retrospect(plan, actual)` → writes to per-user `calibration.ts`. Next race plan reads from calibration. Personal Minetti starts to drift toward truth | ✅ visible after first race | pending |
| **5 · Adaptive replanning** | `coach.adjustForReality` — load-spike alerts, missed-run replanning, sleep-debt-aware downgrades. Hooks into `/api/coach/today` | ✅ alerts | pending |

Total estimate: ~8.5 days end-to-end. Stages 0–1 are foundation (no
visible change) but unlock everything after.

---

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-06 | Phase order: standard 0 → 5, not visible-first | Foundation first prevents rework when stages 2+ depend on doctrine being a real thing |
| 2026-05-06 | Coach voice — **C (Hanson sustainable) with personality, casual register available**. Locked in `web/coach/voice.md`. | Picked after iterating on three voice samples + casual examples. Voice is real-friend-who's-a-coach: warm but firm, no jargon, can swear when it fits. |
| 2026-05-06 | Citations are **internal-only** — never rendered in user-facing rationale text. Surfaced only via "why?" tap in the UI. | The Coach should sound human, not academic. The `Citation[]` field on `CoachDecision` still tracks them for audit + the optional UI tooltip. |
| 2026-05-06 | Plain-language rule: jargon (`6×1mi`, `MP+20`, `LT2`, `Z3`) gets unpacked to plain English in every Coach utterance. Watch and plan JSON can still carry shorthand. | Voice should never assume runner-speak; "translate then prescribe" is a hard rule. |
| 2026-05-06 | Tactical-alternatives rule: when the Coach says no to something (heat, wind, time crunch, illness, no track), it gives a workaround that gets the work in another way. | "Always give them the smart yes" — protective coaching is half the job; the other half is creative problem-solving. |
| 2026-05-06 | Personal calibration storage: Postgres column initially, iCloud sync later | Server-side keeps it portable across devices until iOS app exists |
| 2026-05-06 | Citation format: tooltip with relevant prose snippet | Users learn without leaving the screen |
| 2026-05-06 | Existing saved races: frozen by default, "Re-coach this race" button to opt in | Prevents silent drift when doctrine updates |

---

## Open questions (resolve before the stage that needs them)

- **Stage 2** Coach voice (A/B/C/D + paragraph if D)
- **Stage 4** Calibration scope: just GAP polynomial? Or also taper depth, gut tolerance, easy-pace floor?
- **Stage 4** Re-coach trigger: automatic on actuals save, or user-initiated?
- **Stage 5** Replanning aggressiveness: nudge vs. rewrite the week vs. rewrite the cycle?

---

## Resume notes

If a future session needs to pick this up cold: read this file top to bottom,
look at the **Status** field on each stage, and at any open commits in
`web/coach/`. The directory is empty until Stage 0 finishes; from Stage 1 on,
each stage adds clearly-named files. Memory entry
[`coach_build_plan.md`](/Users/david/.claude/projects/-Volumes-WP-06-Claude-Code-Runcino/memory/coach_build_plan.md)
points back here.
