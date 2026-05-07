# Coach Build Plan

> **Goal:** make the structured research library at `/Volumes/WP/06 Claude Code/Runcino/Research/` the
> mastermind of the app. Every coaching judgment in Runcino — pacing,
> workout prescription, fueling, taper, retrospective, race-morning brief —
> routes through a single `Coach` entity that reads from doctrine extracted
> directly from those research docs. Doctrine constants cite their source
> doc + section; LLM judgment calls run with the relevant research as a
> cached system prompt so the coach speaks with one voice.

**Status:** Stage 0 in progress · 2026-05-06

---

## Sources of truth

The canonical research lives at `/Volumes/WP/06 Claude Code/Runcino/Research/` —
23 numbered docs (00a, 00b, 01–22) plus INDEX, GLOSSARY, SOURCES,
totaling ~18,500 lines.

**Foundational input layer** (01–04): pace zones / VDOT, race-time
prediction, HR zones, workout vocabulary.
**Practical coaching logic** (05–08): injury return, weather, strength,
pacing + race week.
**Specialized knowledge** (09–16): cross-training, mobility, course-specific,
travel, sex-specific, age, wearable data, biomechanics.
**Equipment & fueling** (17–19): footwear, fueling products, hydration.
**Auxiliary** (20–22): mental, form corrections, plan templates.
**Consolidated rewrites** (00a, 00b): AI-coach-consumption synthesis docs.

`docs/coaching-research.md` and `docs/amp-research.md` are **legacy
synthesis documents**. The doctrine layer was originally built from
them. As of 2026-05-06 they are superseded by `/Research/`. Existing
`cite('§X.Y', ...)` calls pointing at the legacy docs are progressively
migrated as each doctrine file is rebuilt against `/Research/`.

---

## Architecture

```
Layer 1 · DOCTRINE              web/coach/doctrine/*.ts
   Structured constants extracted from /Research/, each with a Citation
   pointing to the source markdown section. Pure data.

   Foundational (Stage 1):
     pace_zones.ts        · 01   VDOT, E/M/T/I/R, treadmill conv.
     race_prediction.ts   · 02   Riegel, Cameron, Daniels, runner-type
     hr_zones.ts          · 03   HRmax formulas, Karvonen, Friel LTHR
     workouts.ts          · 04   Full workout taxonomy

   Practical (Stage 2):
     injury_return.ts     · 05   Per-injury return-to-run protocols
     weather.ts           · 06   Maughan/Ely/Vihma, WBGT, AQI (replaces heat.ts)
     strength.ts          · 07 + amp-research
     race_week.ts         · 08   Pacing, taper, race-week protocol
     pacing.ts            · 08   Distance-specific pacing templates

   Specialized (Stage 3+6):
     cross_training.ts    · 09   Carryover matrix, modality HR offsets
     mobility.ts          · 10   Drills, warmup, cooldown
     course.ts            · 11   Hills, downhill, altitude races
     travel.ts            · 12   Phase-shift, jet-lag
     sex.ts               · 13   Menstrual cycle, RED-S, pregnancy
     age.ts               · 14   Per-decade adjustments (replaces masters.ts)
     wearables.ts         · 15   TRIMP, TSS, CTL/ATL/TSB, HRV
     form.ts              · 16   Gait, cadence, foot strike (replaces cadence.ts)
     form_corrections.ts  · 21   Per-error drilldowns

   Equipment + fueling (Stage 5):
     footwear.ts          · 17   Category matrix, super shoes (replaces shoes.ts)
     fueling.ts           · 18   Carb timing
     fueling_products.ts  · 18   Product DB (gels, drinks)
     hydration.ts         · 19   Sweat-rate, sodium, EAH

   Auxiliary (Stage 6):
     mental.ts            · 20   Self-talk, anxiety, DNF decisions
     plan_templates.ts    · 22   5K/10K/HM/M plan skeletons

   Cross-cutting:
     load.ts              · 00a §Load + 13 + 15  Single-session spike, ACWR
     recovery.ts          · 00b + 8     Sleep, modalities, hard/easy
     post_race.ts         · 00b §Post-Race + 5   Recovery progression
     intensity.ts         · 00a §TID + 22       Polarized/pyramidal
     volume.ts            · 00a §Volume + 22    Volume by experience
     taper.ts             · 8 + 22              Taper duration + depth

Layer 2 · COACH                 web/coach/coach.ts
   Single entry point. Every decision returns a CoachDecision with
   { answer, rationale, citations[] }. Internally chooses:
     - deterministic rule (reads doctrine)
     - or Claude call with relevant /Research/ docs as cached system prompt
       (judgment calls only — race-morning brief, retrospective insight,
        unusual situations)

   coach.prescribeWorkout(state)              ✅ Stage 3 of original plan
   coach.assessReadiness(state)               ✅ Stage 3 of original plan
   coach.taperDepth(daysOut, distance)        🟡 stubbed
   coach.paceStrategy(course, goal, weather)  🟡 stubbed
   coach.fuelingFor(course, weather, gut)     🟡 stubbed
   coach.briefRaceMorning(race, conditions)   ✅ Stage 2 of original plan
   coach.retrospect(plan, actual)             ❌ pending (orig stage 4)
   coach.adjustForReality(missed, sleep)      ❌ pending (orig stage 5)

Layer 3 · APPLICATION
   /api/build-plan ──► coach.paceStrategy + coach.fuelingFor
   /api/coach/today ─► coach.prescribeWorkout + coach.assessReadiness ✅
   /api/brief ───────► coach.briefRaceMorning ✅
   detail page hero ─► coach.assessReadiness today
   actuals saved ────► coach.retrospect → recalibrate
```

**Two brains.** The Coach decides per-call:

1. **Deterministic** — math, lookups, ACWR, GAF, taper percentages.
   Fast, free, repeatable. Most coaching decisions go here.
2. **LLM (Claude)** — judgment calls only. Race-morning brief,
   retrospective insight, "this is unusual, what would the doctrine
   say?" calls. Relevant `/Research/` docs cached as system prompt;
   user state in the user message; structured `CoachDecision`
   returned.

---

## Stages

| Stage | What lands | Behaviour change | Status |
|-------|------------|-----------|--------|
| **0 · Migration prerequisite** | `cite()` helper takes Research-doc identifiers. Build plan + memory updated. | None | ✅ done |
| **1 · Foundational layer** | `pace_zones.ts` (01), `race_prediction.ts` (02), `hr_zones.ts` (03), extended `workouts.ts` (04). Engine re-cites `PACE_OFFSETS_S_PER_MI` + magic HR threshold. | None — behaviour-equivalent | ✅ done |
| **2 · Practical coaching** | `weather.ts` (06, replaces `heat.ts`), `pacing.ts` + `race_week.ts` (08), `injury_return.ts` (05). Strength extension deferred. | Race-morning brief reads weather (when wired) | ✅ doctrine done; engine wire-up pending |
| **3 · Recovery / load / signals** | `recovery_protocols.ts` (00b — comprehensive). `wearables.ts` (15). `age.ts` (14). Existing `recovery.ts`, `post_race.ts`, `load.ts`, `masters.ts` kept for backward compat. | Daily readiness signal can read research-grounded thresholds | ✅ doctrine done; engine wire-up pending |
| **4 · Plan templates** | `plan_templates.ts` (22 — 15 plans: 5K/10K/HM/M × Beginner/Intermediate/Advanced + Base + Maintenance + C25K). Volume per-experience tables embedded. | First behaviour change — when engine consumes templates, produces real structured plans not ad-hoc weeks | ✅ doctrine done; engine consumer pending |
| **5 · Equipment / fueling / sex-specific** | `hydration.ts` (19). `sex.ts` (13). Footwear / fueling-products split deferred. | Race-day fueling + sex-specific calibration available | 🟡 partial (hydration + sex done) |
| **6 · Specialized** | `cross_training.ts` (09), `mobility.ts` (10), `course.ts` (11), `travel.ts` (12), `mental.ts` (20). Form / form-corrections deferred. | Cross-training credit, course prep, mental prep, travel | 🟡 mostly done |

Plus the deferred behavior layers from the original plan:

| Stage | What lands | Status |
|-------|------------|--------|
| **R · Retrospective loop** | Race finish → `coach.retrospect(plan, actual)` → personal `calibration.ts` | pending (post-Stage 4) |
| **A · Adaptive replanning** | `coach.adjustForReality` — load-spike alerts, missed-run replanning, sleep-debt-aware downgrades | pending (post-Stage 4) |

**Concurrent UI work** (independent of doctrine refactor):
- `/training` Next 30 days tile (replacing the 12-week chart). Engine forecast field already exists; UI work blocked only on user prioritisation, not on doctrine work.

Total estimate: ~3–4 weeks end-to-end at deliberate pace. Stages 1–3
unlock most of the user-visible coaching depth without changing app
behaviour. Stage 4 is the first behaviour change. Each stage ships
independently — no big-bang rewrite.

---

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-06 | `/Research/` is the canonical source. Synthesis docs (`docs/coaching-research.md`, `docs/amp-research.md`) marked legacy. Doctrine migrates progressively. | The full research library is ~18,500 lines across 23 docs vs the synthesis docs' few hundred lines. Limiting doctrine to the synthesis means the engine has narrower coverage than the research the user wrote. |
| 2026-05-06 | Engine must match the research literally. No invented multipliers, no comfort rules ("alternate run/rest"), no extrapolations dressed up with citations that don't actually support them. | Documented in `feedback_engine_match_research.md` memory entry after I twice edited `postRaceWorkout` based on intuition rather than research, then reverted both times. |
| 2026-05-06 | Phase order: standard 0 → 5, not visible-first | Foundation first prevents rework when stages 2+ depend on doctrine being a real thing |
| 2026-05-06 | Coach voice — **C (Hanson sustainable) with personality, casual register available**. Locked in `web/coach/voice.md`. | Picked after iterating on three voice samples + casual examples. Voice is real-friend-who's-a-coach: warm but firm, no jargon, can swear when it fits. |
| 2026-05-06 | Citations are **internal-only** — never rendered in user-facing rationale text. Surfaced only via "why?" tap in the UI. | The Coach should sound human, not academic. The `Citation[]` field on `CoachDecision` still tracks them for audit + the optional UI tooltip. |
| 2026-05-06 | Plain-language rule: jargon (`6×1mi`, `MP+20`, `LT2`, `Z3`) gets unpacked to plain English in every Coach utterance. Watch and plan JSON can still carry shorthand. | Voice should never assume runner-speak; "translate then prescribe" is a hard rule. |
| 2026-05-06 | Tactical-alternatives rule: when the Coach says no to something (heat, wind, time crunch, illness, no track), it gives a workaround that gets the work in another way. | "Always give them the smart yes" — protective coaching is half the job; the other half is creative problem-solving. |
| 2026-05-06 | LLM context scoping: cacheable contexts per call (`voice + research-running`, `voice + research-strength`, `voice + full`). Per-call scoping prevents burning tokens on irrelevant research. | Including amp-research in race-morning briefs would burn tokens and confuse the model. With `/Research/` becoming canonical, scoping logic needs to extend — not every brief needs all 23 docs. |
| 2026-05-06 | Personal calibration storage: Postgres column initially, iCloud sync later | Server-side keeps it portable across devices until iOS app exists |
| 2026-05-06 | Citation format: tooltip with relevant prose snippet | Users learn without leaving the screen |
| 2026-05-06 | Existing saved races: frozen by default, "Re-coach this race" button to opt in | Prevents silent drift when doctrine updates |

---

## Open questions (resolve before the stage that needs them)

- **Stage 0** Should the legacy `docs/coaching-research.md` and `docs/amp-research.md` be retained as a parallel index, or deleted once their content is fully covered by `/Research/`?
- **Stage 4** Calibration scope: just GAP polynomial? Or also taper depth, gut tolerance, easy-pace floor?
- **Stage 4** Re-coach trigger: automatic on actuals save, or user-initiated?
- **Stage A** Replanning aggressiveness: nudge vs. rewrite the week vs. rewrite the cycle?

---

## Resume notes

If a future session needs to pick this up cold: read this file top to bottom,
look at the **Status** field on each stage, and at any open commits in
`web/coach/`. The directory is empty until Stage 0 finishes; from Stage 1 on,
each stage adds clearly-named files. Memory entry
[`coach_build_plan.md`](/Users/david/.claude/projects/-Volumes-WP-06-Claude-Code-Runcino/memory/coach_build_plan.md)
points back here. Memory entry
[`feedback_engine_match_research.md`](/Users/david/.claude/projects/-Volumes-WP-06-Claude-Code-Runcino/memory/feedback_engine_match_research.md)
documents the rule against extrapolation.
