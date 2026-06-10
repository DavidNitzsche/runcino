# RACE-READINESS PRODUCT — SIX FEATURE DESIGNS (Tier 3)

**Status: AWAITING FEEDBACK before any code.** These close the Part-5 gaps from the state audit. Each design: interaction flow, data changes, effort, citations. Ordered by race-impact for Aug 16. Effort scale: S < half day · M ≈ 1 day · L ≈ 2-3 days.

The execution plan itself (3.1) shipped server-side in Phase 1 (`lib/race/execution-plan.ts` + `GET /api/race/[slug]/execution-plan`); its UI mounts are folded into 3.2/3.3 below where they belong.

---

## 3.2 Workout-level contingency — pass/fail criteria + bail-out rules

**The gap:** the watch enforces the full prescription or David freelances. The Jul 26 monster (19 mi, 10 @ HM) has no B-version; race day has no structured abort.

**Interaction flow**
1. Every quality + long workout carries up to three machine-checkable rules, composed at plan/spec build time:
   - `pass`: "avg work-phase HR ≤ 158 and pace within ±10s" → post-run badge CONFIRMED, feeds 3.3.
   - `bail`: "if HR > 165 sustained 3 min during finish segment → cut finish to 6 mi, easy home." Watch shows a single line under the phase target; on breach, haptic + one-screen choice: `CONTINUE / TAKE THE BAIL`. Choice is recorded, not enforced.
   - `abort` (race day only): the execution plan's B-goal trigger (mile-5 checkpoint) rendered as a watch card at mile 5: `ON PLAN ✓` or `SWITCH TO B · 7:24s`.
2. Post-run, the recap reasons from the recorded choice: took-the-bail ≠ failed-the-workout. Adapter input, not a scolding.

**Data changes:** extend `workout_spec` jsonb with optional `rules: [{kind: 'pass'|'bail'|'abort', metric: 'hr'|'pace', op, value, scope, action, label}]`. No new tables. Wire contract: additive optional field on WatchPhase (`ruleLabel`) + one new completion field (`ruleOutcomes`) — same pattern as `isFinishSegment` (wire-compatible, old builds ignore).
**Surfaces:** spec-builder (compose rules), build-workout (thread), watch `ActiveWorkoutView`/`Faces.swift` (render line + breach sheet), recap (reason about outcomes).
**Effort:** L (watch UI is the long pole; server S).
**Citations:** Research/08 §18.2 (execution-error costs), §6.1 (HR ceilings per distance); Research/04 (workout intents); audit Part 5 #4.
**Race-relevance:** HIGH — this is the race-day B-goal trigger made operational. Minimum viable cut for Aug 16: race-day abort card only (M).

## 3.3 WATCHING state actionability — the named test

**The gap:** WATCHING says "the next quality run will tell us more" without saying what "more" is. The engine already knows: `nextTestPoints` lists the workout; the drift detectors define the thresholds.

**Interaction flow**
1. Targets page, WATCHING state: the next test point gains a criteria line — "Thu Jun 11 · 3.5 mi @ T 7:17 · **passes at ≤ 7:20 avg work pace and avgHr ≤ 158**" — derived from the same numbers `detectTempoPaceDrift` will judge it by (T + 10s tolerance; 0.975 × LTHR).
2. After the run: the test point renders PASSED / MISSED with the actuals, and the status transition copy points at it ("Thursday cleared the soft signal").
3. iPhone: same line on the workout sheet's THE PLAN block (field already exists in the payload).

**Data changes:** none stored — `nextTestPoints` gains `passCriteria: {paceMaxSPerMi, hrMaxBpm} | null`, computed in `goal-projection.ts` from VDOT-implied T and LTHR. The tune-up workout (OP-2) ships with its criteria in `notes` already; this generalizes it.
**Effort:** S/M (one lib function + two render sites).
**Citations:** Research/01 §recalibrate (the field-test doctrine — this IS a field test, named); audit Part 5 #6.
**Race-relevance:** HIGH, and nearly free. Recommend first.

## 3.4 Sleep coaching + taper sleep protocol

**The gap:** 6.4h nightly average through a 45-mile LOADED week produced a −9 pillar weight and no escalation. Sleep is the current limiter and nothing fights for it.

**Interaction flow**
1. **Trend escalation (engine):** new detector over `health_samples.sleep_hours`: N consecutive nights < 7.0h (N=10 default) OR 7-night avg < 6.5h for 2 weeks → a STANDING sleep flag (not a daily nag): Health hero driver pins it first, Today briefing gets one standing line ("Night 12 under 7 hours. The plan assumes recovery you're not banking."), readiness WHY strip badges the streak length.
2. **Forward link:** quality-day briefings reference it concretely: "Tomorrow's 4 @ T lands on a 6.3h week. Expect the HR trigger to fire early; the honest move is tonight, not tomorrow."
3. **Taper protocol (race week):** race-week surface adds a sleep-banking card — target 8 to 8.5h from T-7, the "two nights out is the night that counts" rule, pre-set bedtime nudge via the existing notification queue (category opt-in).
4. Escalation clears silently after 5 nights ≥ 7h.

**Data changes:** none new — sleep_hours history exists; flag is computed, optionally cached in `readiness_snapshots.streaks` (jsonb, already there).
**Effort:** M.
**Citations:** Research/00b §sleep (recovery hierarchy: sleep is #1); Research/08 §sleep-banking race week; audit Part 5 #1 + Part 6 risk statement.
**Race-relevance:** HIGHEST of the six by expected minutes saved on Aug 16. Recommend shipping before the Jul 13 peak block.

## 3.5 Bad-week re-planning — illness, travel, life

**The gap:** adaptation downgrades days; nothing re-sequences the block. A lost week leaves the plan prescribing as if it happened.

**Interaction flow**
1. Entry points: "I'm sick" (exists, sick_episodes) and new "Life happened — replan from here" on the Train page (web first).
2. The replan wizard asks exactly two things: *what's lost* (date range) and *why* (sick / travel / life — sick routes through Research/05 return-to-run gates).
3. Engine response = a **plan proposal** (existing plan_proposals machinery): re-flows the remaining weeks under the same generator constraints — re-derives the volume curve from post-gap reality (recentWeeklyMileageMi will reflect the hole), keeps the race + taper shape, drops lost key workouts rather than cramming, re-blends paces from the current anchor. Sealed days untouched.
4. Diff view (existing plans/[planId]/diff page) shows old vs new week by week; accept/decline. Nothing automatic.

**Data changes:** none structural — generate.ts gains a `replanFrom(dateISO, reason)` entry that archives + regenerates mid-block (the auto-rebuild path already proves the archive→regenerate mechanics); plan_proposals stores it pending.
**Effort:** L (the generator path exists; the wizard + sick-gate laddering is the work).
**Citations:** Research/05 (return protocols, symptom gates); Research/22 §compressed timelines; audit Part 5 #3.
**Race-relevance:** MEDIUM-HIGH as insurance. If only the sick-path ships before August, that's the right cut (M).

## 3.6 Environment-aware scheduling

**The gap:** heat is judged after runs and forecast for race day, never used to place workouts. July tempos in LA at 8 AM are a choice the app watches happen.

**Interaction flow**
1. Nightly (existing forecast plumbing): for the next 3 days' quality + long days, fetch the workout-window forecast (the `fetchDayForecast` workoutWindow param — already built for the iPhone CONDITIONS chip).
2. When the planned window prices ≥ 4% slowdown (unified heat model) AND a same-day earlier window or ±1-day swap prices ≤ 2%: emit ONE suggestion chip on Today/Train: "Thu tempo: 78°F by 8 AM. 6 AM start is 64°F. Move it?" Actions: `EARLIER START` (notes-level, no row move) / `SWAP WITH FRI` (existing move/swap machinery) / dismiss.
3. Hard-easy spacing guard (Research/04) vetoes swaps that stack quality days. Never fires race week (taper structure is sacred).

**Data changes:** none — composes existing forecast + plan move. One new coach_intent reason (`env_schedule_suggest`) for dedup/audit.
**Effort:** M.
**Citations:** Research/06 (the cost being avoided); Research/04 §hard-easy spacing; audit Part 5 #7.
**Race-relevance:** MEDIUM — it protects the quality of the peak-block sessions that decide the race. Worth shipping by early July.

## 3.7 Strength scheduling

**The gap:** 17 strength_skip intents in 28 days, zero sessions, zero strength rows in the plan — for a runner about to peak at 64.5 mi.

**Interaction flow**
1. Generator: 2 × 20-min strength rows per week (the schema's `strength` type exists, spec null) placed on easy days ≥ 48h from the long run, never the day before quality (Research/07 §concurrent placement). Taper: 1×/wk through T-10, none inside T-10.
2. Today: strength chip on those days (existing strength status chip becomes prescriptive); completion via the existing HK strength-session ingest or one-tap log.
3. The recommender (`strength-recommender.ts` — built, unmounted) supplies the session content (2 exercises × 3 sets, runner-specific); start with its default block.
4. Skips stay shame-free: two skips in a week → one quiet line, never a banner.
5. **Active plan:** rows for the remaining 9 weeks go in via a gated INSERT batch (shown like OP-2) or ride the next rebuild — David's call.

**Data changes:** none structural (plan_workouts.type='strength' supported; strength_sessions table exists).
**Effort:** M.
**Citations:** Research/07 §2×/week maintenance dose + §concurrent-training placement; audit Part 5 #5.
**Race-relevance:** MEDIUM — injury insurance for exactly the Jul 13–27 weeks the audit named as the risk concentration.

---

## Recommended sequencing (if all six get a yes)

| Order | Feature | Effort | Ship by |
|---|---|---|---|
| 1 | 3.3 WATCHING test criteria | S/M | this week (rides the tune-up + detectors just fixed) |
| 2 | 3.4 Sleep coaching | M | before Jul 13 peak block |
| 3 | 3.2 race-day abort card (minimum cut) | M | before Aug 9 race week |
| 4 | 3.6 env-aware scheduling | M | early July |
| 5 | 3.7 strength rows | M | with the next plan rebuild |
| 6 | 3.5 bad-week replan (sick path first) | M→L | July, insurance |

Full 3.2 (every-workout rules on watch) and full 3.5 (travel/life wizard) are honest post-AFC roadmap unless you say otherwise.
