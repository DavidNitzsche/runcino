# Brief · Targets page redesign · full pass

**Audience.** Design agent · full hero-scale mockup deck expected.
**Surface.** `web-v2/components/faff-app/views/TargetsView.tsx` (web) · iPhone TargetsView consumes same envelope.
**Why this brief exists.** A series of point-fixes have made the page more honest (recent + next test points, heat-adjusted verdict, status-aware headline, plan-trusts-itself doctrine), but the page was never designed end-to-end against the runner's actual question. This brief inventories every data point we can show, the doctrine that governs what we say, and the runner's mental model — then asks for a fresh design pass.

**Format expectation.** Hero-scale mockups, not wireframes. Real brand fonts (Bebas Neue for display, Oswald for headlines, Inter for body). Every state covered (see §6). Treat this as the runner-facing flagship of the projection engine.

---

## 1. The runner's question

The Targets page exists to answer one question that runs in the background of every workout:

> "Am I going to hit my goal?"

Everything else — PRs, other races, drift signals, test points — is in service of that question. The page should make the answer feel concrete + trustworthy + actionable.

Sub-questions the runner asks in sequence:

1. **What's my goal again?** Race, date, time, distance.
2. **Am I on track?** Status + projection + delta.
3. **Why?** What signals are firing, what's the recent evidence.
4. **What changes the answer?** Both directions — what would move me up, what would move me down.
5. **What's next?** Upcoming test points + the path between them.
6. **How far have I come?** Recent quality work, PRs, trajectory.

The current page answers 1 and 2 well after recent fixes. 3-6 are partially there but scattered.

---

## 2. The doctrine that governs what we say

These rules are not negotiable — the design must respect them.

### 2.1 Plan-trusts-itself (the core rule)
**If the runner has a goal, the plan should get them there until it's very clear it can't.**

- `projectionSec = goalSec` when status is `on-track` or `watching`.
- Only `off-track` switches the projection to the raw VDOT-derived prediction (`vdotProjectionSec`).
- We do NOT bail on the goal at the first soft signal.
- We DO show signals when they fire — but the headline number stays at the goal until cumulative evidence demands otherwise.

David's literal words 2026-06-04: *"if its a goal, the plan should get me there until its very clear I cannot."*

### 2.2 Three states, three voices
| Status | Headline | Color | Projection shown | Tone |
|---|---|---|---|---|
| `on-track` | "On track · 0 sec ahead" | green (#3EBD41) | goal | confident |
| `watching` | "Watching · 1:30 still in play" | amber (#FFCE8A) | goal (still) | honest about soft signals |
| `off-track` | "5 min behind" | warm orange/red (#FF8847) | raw VDOT projection | honest delta, no sugar |

### 2.3 No reactive coach layer
David 2026-06-03 (locked): no "coach advice to run 30 minutes" type reactive prescriptions on this surface. The Targets page **informs**, the plan **acts**. Drift signals appear; they don't issue commands.

### 2.4 Every claim cites its evidence
If we say "you're 5.4% slow," we must show *what we measured against* — which race, which distance, which run. No black-box "the model says." See §3.1 for the existing signal schema.

### 2.5 Heat-adjusted everywhere
Pace verdicts are duration-scaled Maughan/Vihma-aware. A tempo at 7:17/mi in 74°F sun gets the same ✓ ON badge here as on the Run Detail page — single source of truth.

### 2.6 Honest no-data
When projection can't compute (no recent race result, no VDOT seed), show the goal as the headline and explain *why* in one line. Don't render an empty gauge or a "—".

---

## 3. Every data point we have, today

This is the comprehensive inventory. Use any of it. The seed already populates everything below unless marked `(needs wiring)`.

### 3.1 Goal race · `seed.goalRace`
```ts
{
  slug: string;              // "americas-finest-city-half-2026"
  name: string;              // "Americas Finest City Half Marathon"
  location: string | null;   // "San Diego, CA"
  date: string;              // ISO YYYY-MM-DD
  daysAway: number;          // 73
  distanceMi: number;        // 13.1
  goal: string;              // "1:30:00"
  projected: string;         // "1:30:00" (= goal when watching/on-track)
  delta: string;             // "0 sec ahead" | "5 min behind" | "30 sec ahead"
  onTrack: boolean;          // derived from projection vs goal
  goalPct: number;           // 0-100, progress-bar fill

  // Plan-trusts-itself envelope (§2.1)
  goalStatus: 'on-track' | 'watching' | 'off-track';
  vdotProjectionSec: number | null;   // raw model output, always available
  projectionSummary: string;          // one-line human read

  driftSignals: Array<{
    key: 'recent_race_drift' | 'vdot_trend' | 'aerobic_decoupling' |
         'tempo_pace_drift' | 'plan_adapter' | 'missed_key_workout';
    weight: 'strong' | 'medium' | 'weak';
    detail: string;          // "Disney Half on Feb 1 implies 1:34:54 · 5.4% slower than the goal"
    evidence: Record<string, unknown>;  // structured underlying data
  }>;

  transitions: {
    toBetter: string | null;  // what flips status up a rung
    toWorse: string | null;   // what flips status down a rung
  };

  // Test points (recent + upcoming)
  recentTestPoints: Array<{
    dateISO: string;
    type: 'tempo' | 'threshold' | 'intervals' | 'long' | 'race';
    label: string;           // "8mi tempo · 1.5 mi WU · 5 mi @ T · 1.5 mi CD"
    distanceMi: number | null;
    actualPace: string | null;   // "7:17" (work-phase pace, not overall)
    verdict: 'on' | 'fast' | 'slow' | null;
  }>;
  nextTestPoints: Array<{
    dateISO: string;
    type: string;
    label: string;
    distanceMi: number | null;
  }>;

  // Course-specific chunks (already wired)
  courseImpact: {
    elevGainFt: number | null;
    netElevFt: number | null;
    paceImpactSPerMi: number | null;     // -20 to +20 typical
    impactCopy: string;                   // "Net downhill · ~10s/mi free"
    citation: 'research-12-course-impact';
  } | null;

  conditionsImpact: {
    expectedTempF: number | null;
    expectedHumidityPct: number | null;
    paceImpactSPerMi: number | null;     // duration-scaled Maughan
    impactCopy: string;                   // "Typical Aug 15 in San Diego · 68°F · negligible"
    citation: 'research-06-weather-adjustments';
  } | null;

  pacingDiscipline: {
    bufferS: number | null;       // your typical positive-split swing
    impactCopy: string;            // "You typically drift 12s/mi in the back half"
    citation: 'research-08-pacing-discipline';
  } | null;

  projectionLevers: Array<{
    lever: 'tempo_pace' | 'long_run_volume' | 'easy_volume' | 'weight' | 'sleep';
    impactSeconds: number;        // potential gain if lever moves
    feasible: boolean;
    copy: string;                  // "Add 1 more long-run mile each week · ~8s/mi at goal"
  }>;
}
```

### 3.2 Projection trend · `seed.projectionTrend`
```ts
Array<{
  date: string;
  projectionSec: number;
  vdot: number;
}>
```
- Daily snapshots, 90-day window.
- Most days byte-identical to previous (projection is deterministic from VDOT).
- Jumps happen on race results landing or material quality-run evidence.
- See `designs/briefs/targets-projection-redesign-brief.md` for why a line chart is the wrong primitive · the prior brief replaces it.

### 3.3 Personal records · `seed.prs`
```ts
Array<{
  k: '5K' | '10K' | 'HALF' | 'MARATHON';
  v: string;          // "1:35:12"
  date: string;       // "2024-11-03"
}>
```
- Currently rendered as a static grid below the gauge.
- Open question: are PRs the right framing for goal-tracking? See §7.4.

### 3.4 Other races · `seed.races`
```ts
Array<{
  slug: string;
  name: string;
  meta: string;       // "13.1 mi · San Diego"
  days: string;       // "73 d" | "PAST"
  tag: 'A RACE' | 'B RACE' | 'C RACE' | 'TUNE-UP';
}>
```
- A = primary goal · B = tune-up race within block · C = stretch goal beyond.
- The build to the A race is the project; B+C are landmarks on the way.

### 3.5 Fitness state · available via other surfaces, **needs wiring to Targets envelope**
The Health page reads these; Targets could too:
- **Current VDOT** + **6-week delta** (`lib/training/vdot-trend.ts`)
- **Training Form / TSB** (Banister · `lib/coach/training-form.ts`)
- **Aerobic decoupling trend** (`lib/training/aerobic-decoupling-trend.ts`)
- **Weekly mileage** current + 8-wk avg
- **Plan phase** (BASE / BUILD / PEAK / TAPER) + week in phase
- **Block-over-block comparison** (`lib/coach/block-comparison.ts`)

### 3.6 Race history · `lib/coach/race-history.ts`
```ts
Array<{
  date: string;
  name: string;
  distanceMi: number;
  finishS: number;
  vdotImplied: number;
  conditions: { tempF, dewpointF, wind, terrain } | null;
}>
```
- The "what races have I done that inform the projection" set.
- Currently surfaces in onboarding but not Targets.

### 3.7 Calibration state · `lib/coach/calibration.ts`
```ts
{
  hasCalibrated: boolean;
  calibratedEasyPaceSPerMi: number | null;
  bandSPerMi: number | null;
  qualified: boolean;
  sessionsCompleted: number;
}
```
- For runners early in the journey, calibration drives all paces. Targets could acknowledge cold-start.

---

## 4. Variables that move the gauge

These are the things that change the status. Design must make the runner understand what they are without listing 47 of them.

### 4.1 Recent race result (strongest signal)
- Detector: `detectRecentRaceDrift` · finds a race within 90 days at a comparable distance (±30% with VDOT normalization).
- Weight: `strong` when 5%+ slower than goal · `medium` when 3-5% · `weak` when <3%.
- Copy: "Disney Half on Feb 1 implies 1:34:54 at this race's distance · 5.4% slower than the goal."

### 4.2 VDOT trend
- Detector: `detectVdotTrendDrift` · slope of `bestRecentVdot` over the last 6 weeks.
- Weight: `strong` when dropping > 1 VDOT point · `medium` when flat for 6+ weeks during a build phase · `weak` otherwise.

### 4.3 Aerobic decoupling
- Detector: `detectAerobicDecouplingDrift` · pace-to-HR drift on the last 3 long runs.
- Weight: `medium` when last 3 long runs all decoupled > 8%.
- Cite: Research/15 (Friel decoupling doctrine).

### 4.4 Tempo / threshold pace drift
- Detector: `detectTempoPaceDrift` · plan tempo target vs actual over last 3-6 weeks.
- Weight: `medium` when 3+ weeks running 10s/mi+ slower than plan target · `weak` when 1-2 weeks.
- Heat-adjusted via `judgeWeather` · same band as Run Detail.

### 4.5 Plan adapter activity
- Detector: `detectPlanAdapterDrift` · how many days the auto-adapter downgraded quality in the last 14 days.
- Weight: `medium` when 2+ weeks of cumulative downgrades.

### 4.6 Missed key workouts
- Detector: `detectMissedKeyWorkoutDrift` · planned threshold/intervals not completed within ±1 day.
- Weight: `medium` when 2+ missed in 14 days · `weak` when 1.

### 4.7 Status ladder
- `strongCount >= 1` OR `mediumCount >= 2` → `off-track`
- `mediumCount >= 1` OR `weakCount >= 2` → `watching`
- otherwise → `on-track`

---

## 5. What the current page does + where it falls short

### Current layout (post-fixes 2026-06-04)
```
┌──────────────────────────────────────────────────────────────────┐
│ TARGETS · Goals & races                                          │
├──────────────────────────────────────────────────────────────────┤
│ PRIMARY GOAL                                                     │
│ 1:30                          ┌─────────────┐                    │
│ Americas Finest City · Aug 15 │   gauge     │                    │
│ 73 days out · watching ·      │   1:30:00   │                    │
│ 1:30 still in play (amber)    │ PLAN TARGET │                    │
├──────────────────────────────────────────────────────────────────┤
│ ON THE PATH                                                      │
│ Watching · soft signals firing.                                  │
│ Hold the plan · next quality run will tell us more.              │
│ [MEDIUM] Disney Half implies 1:34:54 · 5.4% slower               │
│ RECENT TEST POINTS                                               │
│   Wed Jun 2 · 7mi intervals · 7:14/mi · ✓ ON                     │
│   Thu Jun 4 · 8mi tempo · 7:17/mi · ✓ ON                         │
│ NEXT TEST POINTS                                                 │
│   Sun Jun 7 · 12mi long                                          │
│   Tue Jun 9 · 8mi tempo                                          │
│ WHAT MOVES THE GAUGE                                             │
│   ↑ on-track: new race within 5% of goal, or 3+ weeks of tempo…  │
│   ↓ off-track: another medium signal stacks on this one…         │
│ Diagnostic · current VDOT projects 1:34:54                       │
├──────────────────────────────────────────────────────────────────┤
│ PERSONAL RECORDS                                                 │
│ [5K] [10K] [HALF] [MARATHON]                                     │
├──────────────────────────────────────────────────────────────────┤
│ RACES                                                            │
│ [Americas Finest · A RACE · 73d]                                 │
│ [other races…]                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### What works
- The status ladder (on-track / watching / off-track) is honest.
- Recent + next test points give a coherent "what just happened / what's next" read.
- The plan-trusts-itself doctrine is intact — goal stays as headline, signals fire below.
- Heat-adjusted verdicts agree with Run Detail.

### What still feels off (in priority order)
1. **The gauge is decorative.** The needle is a hardcoded SVG that always points the same spot. It implies precision the engine doesn't have. Two options: make it real (needle position computed from projection vs goal arc), or replace with something more honest.
2. **The vertical stack reads as a list of cards instead of a story.** Status, signals, test points, transitions, diagnostic — each is its own block. There's no narrative through-line.
3. **PRs and Other Races feel disconnected from the projection story.** PRs are historical fitness markers; other races are landmarks toward the A race. Currently they're just grids at the bottom.
4. **No sense of the build's trajectory.** "73 days out" tells you the date but not the arc. Where are we in BASE/BUILD/PEAK/TAPER? What's the next milestone race?
5. **No block-over-block comparison.** We have the data — this block's mileage / quality / fitness vs last block's. Could anchor "is the work moving me forward."
6. **The "WHAT MOVES THE GAUGE" copy is dense.** Two paragraphs of conditions. Could be visualized as a slider or band the runner is moving between.
7. **VDOT is invisible.** The single most important fitness number isn't shown on the page that's most about fitness vs goal.
8. **The course chunks (`courseImpact`, `conditionsImpact`, `pacingDiscipline`, `projectionLevers`) aren't rendered on Targets** — they're queued in the GapPanel which only fires when `off-track`. Honest projection wants them visible always (or at least summarized).

---

## 6. States to design for

Don't design one screen and assume the others fall out. Each state needs its own hero.

### 6.1 ON TRACK · with recent positive evidence
- Status green.
- Recent test points all ✓ ON.
- No drift signals.
- Headline: "On track · 0 sec ahead." Tone: confident, not smug.
- The "WHAT MOVES THE GAUGE" should still hint at what could flip us to watching (the runner deserves to know what's being watched).

### 6.2 WATCHING · soft signals firing (David's current state)
- Status amber.
- 1 medium signal OR 2+ weak signals.
- Recent test points still mostly ✓ ON (the runner is executing, but external evidence — like a tune-up race that came in slow — flags concern).
- Headline: "Watching · 1:30 still in play." Tone: honest, doesn't panic.
- Signal panel + diagnostic (VDOT projection) both visible.
- Test points list shows the next opportunity to flip back to on-track.

### 6.3 OFF TRACK · cumulative evidence shifts the projection
- Status warm (red/orange).
- 1 strong signal OR 2+ medium signals.
- Projection switches to raw VDOT — the headline shows the math's actual read, not the goal.
- The `GapPanel` lights up: course impact, conditions impact, pacing discipline buffer, projection levers.
- Tone: still no scolding — "here's where you actually are, here's what could move it." Implies plan changes may follow but the runner sees the data first.

### 6.4 NO GOAL SET
- The runner has no primary race.
- The hero shows "Pick a primary race on /races."
- Below: PRs, recent test points still useful for self-knowledge.
- Doesn't render any projection / gauge / signal apparatus.

### 6.5 GOAL SET · NO PROJECTION YET (cold-start)
- The runner just set a goal but has no recent race + no fitness signal.
- Show the goal as the big number with "TARGET FINISH" sublabel.
- Bottom-row copy: "Log a recent race result or complete the calibration session to start projecting."
- Don't fake a gauge needle.

### 6.6 GOAL SET · RACE DAY HAS PASSED
- The race was yesterday or earlier; result is in.
- Transition state: show what happened, what it taught us about the next goal.
- Could prompt setting the next goal.

### 6.7 MULTIPLE GOALS / SEQUENTIAL RACES
- Runner has A race in 16 weeks, B race in 6 weeks (tune-up).
- Currently the page shows the A race in the hero and B's in the list.
- Open question: should the B race get more prominence as it approaches?

---

## 7. Open design questions

Don't answer these in this brief — these are for the design pass to decide.

### 7.1 The gauge
Three plausible paths:
- **Make it real.** Needle position = `vdotProjectionSec` relative to `goalSec` on a calibrated arc. Honest but volatile.
- **Replace with a band.** Show the projection as a confidence band (goal ± typical projection volatility for this runner). More honest about uncertainty than a single needle.
- **Drop it.** The headline + status copy already communicate the state. The gauge is decorative.

### 7.2 The projection trend
We have a per-day projection_snapshots table but the line is byte-identical most days. The prior brief (`targets-projection-redesign-brief.md`) commissioned a redesign that hasn't shipped. Design should either incorporate that thinking or reject it.

### 7.3 Block trajectory
Show where we are in the build:
- BASE → BUILD → PEAK → TAPER
- Week N of M in current phase
- Next milestone (B race, big long run, time trial)

Could be a horizontal timeline above the test points, or a phase chip near the goal hero, or a dedicated section.

### 7.4 PRs vs goal-tracking
The 5K/10K/HM/M PR grid is currently disconnected from the goal projection. Two ways to integrate:
- **Anchor** · "Your half PR is 1:35:12. Your goal is 1:30:00. The gap is 5 minutes."
- **Predictor** · per Daniels VDOT, PR at one distance implies times at all others — show the implied projection at each distance under each PR.
- **Or move PRs off this page** if they aren't actually serving the goal-tracking job.

### 7.5 Course + conditions + pacing impact
We have rich per-race data on:
- Elevation impact (course is net downhill / hilly)
- Conditions impact (typical race-day weather)
- Pacing discipline (your typical positive-split drift)
- Projection levers (gains available from specific changes)

Currently only the off-track state shows these (in `GapPanel`). Should they live on Targets always? As a "race profile" section?

### 7.6 What about other races (B/C/tune-ups)?
The build to the A race is the project. B races are tune-ups that inform the projection. C races are stretch goals beyond.

Could be a **race timeline** running across the page: today → tune-up → A race → stretch. Could be a **table** with each race's projection. Could stay a list. Open.

### 7.7 The "diagnostic" line
Currently the page ends with "Diagnostic · current VDOT projects 1:34:54 · shown for transparency, not as a prescription." Two questions:
- Is "diagnostic" the right framing or does it sound clinical?
- Should this be hidden by default with a "show the model's number" expand affordance, or stay always-visible (transparency over comfort)?

### 7.8 What does the runner come here to DO?
- **Once a week:** check status, see how recent quality landed, sanity-check the goal.
- **After a race:** see the projection update + the explanation.
- **Mid-block:** check the trajectory, see if a tune-up race is coming.
- **Rarely:** change the goal.

The redesign should weight space accordingly. The status answer needs to be instant; the goal-change flow can be a tap away.

---

## 8. Constraints + non-negotiables

- **Plan-trusts-itself.** Don't let the design accidentally pre-bail on the goal. When watching, the goal is still the headline.
- **No reactive coach prescriptions on this surface.** No "Coach says run X minutes" type voice. This page informs.
- **Honest no-data.** Pre-projection states must read as legible action prompts, not broken UI.
- **Three-state color logic, not two.** Watching must be visually distinct from on-track AND off-track. (Currently amber.)
- **Cite every claim.** Drift signals need their evidence visible. The runner shouldn't have to trust a black box.
- **Mockup hero scale + brand fonts.** Bebas Neue for display, Oswald for section heads, Inter for body. No wireframes wrapped in audit prose.
- **iPhone parity in mind.** Design for iPhone first; web is the wider canvas but the runner mostly checks on phone.

---

## 9. Deliverable

A mockup deck with at minimum:

1. **§6.1** ON TRACK hero (with recent ✓ ON test points)
2. **§6.2** WATCHING hero (David's current state · with signal panel)
3. **§6.3** OFF TRACK hero (with course + conditions + levers visible)
4. **§6.4** NO GOAL SET state
5. **§6.5** GOAL SET, NO PROJECTION state
6. **§6.6** POST-RACE transition state
7. Mobile (iPhone) version of each
8. Annotations explaining design choices that resolve the §7 open questions

Real-data screens preferred · use David's actual current data for §6.2 to make it concrete. See `lib/training/goal-projection.ts`, `components/faff-app/seed.ts` (search for `goalRace`), and `lib/training/vdot-trend.ts` for live shapes.

Cite: `lib/training/goal-projection.ts` (doctrine source), `lib/coach/weather-adjust.ts` (heat-adjust), `Research/01-pace-zones-vdot.md` (VDOT projection), `Research/06-weather-adjustments.md` (conditions impact), `Research/12-course-specific-training.md` (course impact).
