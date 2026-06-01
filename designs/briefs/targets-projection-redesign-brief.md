# Brief · Targets / Projection panel redesign

**Audience.** Design agent · full mockup file expected.
**Surface.** `web-v2/components/faff-app/views/TargetsView.tsx` — the panel between the goal hero and the personal-records strip.
**Why this brief exists.** The current "Projection Trend" sparkline reads as a flat empty rectangle for most users. Real runner data is too steady, too sparse, and too redundant with the hero above it to earn the space. Decide what *should* live there instead, then design it.

---

## 1. What's wrong with the current panel

Screenshot reference: 8 snapshots at 1:34:54 across 61 calendar days, goal 1:30:00, race 77 days out. The chart is a row of 8 dim dots, a dashed amber GOAL line below, the words "1:34:54" and "steady". That is the entire payload.

The hero immediately above already shows:
- **PRIMARY GOAL · SUB-1:30:00**
- **77 days out · 5 min behind**
- A live gauge with the projected time (1:34:54) and a needle on a red→green arc.

So the chart restates "1:34:54 projected · still 5 min behind · hasn't moved." That's a duplicated headline plus a visualization of nothing.

### Why the data is flat
- `predictRaceTime(vdot, distanceMi)` is deterministic. VDOT only moves when a new race lands (`vdot_auto_recalc` coach_intent) or a quality run beats the prior best estimator. Between those events, projection is byte-identical day after day.
- The runner can train consistently for a month and the chart will show one horizontal line — there is no "trend" to draw.
- After a race lands, the line jumps once and then re-flattens. The chart's only honest job is to mark that jump.

### Why the data is sparse
- One snapshot per (user, date, distance) at most. Real fire cadence is daily but the cron has been live ~8 days for David.
- Snapshots only exist for race distances the runner has a primary goal at, plus the canonical HM + M. So the series is bounded.

### Conclusion
A line chart of `projection_sec` over time is the wrong primitive. Most rendered states are degenerate. **Design something that earns the real estate for the 95% of runners whose projection won't move this week.**

---

## 2. What data the design agent can actually use

Everything below is shippable today — backend already returns it.

### 2.1 Projection snapshots (the existing data)
- Table: `projection_snapshots`
- Schema:
  ```
  user_uuid uuid · snapshot_date date · distance_mi numeric
  vdot numeric(4,1) · projection_sec integer
  race_slug text · source text ('cron-daily' | 'race-retro' | 'manual')
  ```
- Cron: `POST /api/cron/snapshot-projections` daily at ~00:30 local.
- Read: `loadProjectionSeries(userUuid, distanceMi, daysBack=90)` returns oldest→newest.
- Live shape on `/me` Targets: `seed.projectionTrend: Array<{date, projectionSec, vdot}>`.
- **Honest cadence**: most days the value is identical to the previous day. Jumps are events.

### 2.2 Personal records (already on the page)
- `seed.prs: Array<{k: "5K"|"10K"|"HALF"|"MARATHON", v: string, date: string}>` — these power the four tiles below the chart.
- Each PR carries a date stamp. The most recent one is the dominant input to the current VDOT.

### 2.3 VDOT history (one number per snapshot)
- Same `projection_snapshots.vdot` series — for David's current state, hovering ~48.5.
- Daniels' table: VDOT change of +1 ≈ ~30s/mi at half-marathon pace ≈ ~7 min at marathon, ~1 min at half-marathon.
- Available on the existing series; just not surfaced.

### 2.4 The "why behind the gap" inputs (already in seed)
- `seed.form.acwr` — Acute:Chronic Workload Ratio (Gabbett). Bands: detraining <0.8 · building .8–1.0 · sweet spot 1.0–1.3 · elevated 1.3–1.5 · spike >1.5.
- `seed.form.{fitness, fatigue, delta}` — derived from weekly mileage averages + glance-state.
- `seed.readiness.{score, label, drivers}` — drivers array is named contributors (Sleep, HRV, RHR, Load, RPE) with `{name, why, pct, dir, pts}`.
- `seed.goalRace.{onTrack: boolean, delta: "5 min behind" | "on pace"}` — boolean+copy already computed.

### 2.5 Race-header status (a different signal)
- `lib/coach/race-header.ts:composeStatus()` returns `'on_track' | 'watch' | 'off'`, blending readiness + ACWR + (projSec / goalSec).
- Documented thresholds: proj > goal × 1.08 → off · > 1.03 → watch.
- Currently rendered on race detail; could move/echo here.

### 2.6 Race-retro recalcs (the moments worth highlighting)
- After a logged race, the PATCH route runs `vdotFromRace` and `calibrateLthr`, writes `coach_intents` rows (`reason='vdot_auto_recalc'`, `'lthr_auto_calibrated'`) carrying the new value, and now returns the before/after delta on the API response (StateChangeToast wire).
- `GET /api/coach/intents?reason_prefix=vdot_auto_recalc` returns the full history.
- These are the events that ACTUALLY change projection. Worth annotating on whatever timeline replaces the current chart.

### 2.7 Weeks remaining + plan phase
- `seed.season.{nowIdx, raceIdx, phases}` carries current phase (BASE / BUILD / PEAK / TAPER / RACE).
- `seed.goalRace.daysAway` — 77 for the reference screenshot.
- Phase-aware copy could replace generic "5 min behind" — e.g., "BUILD phase, week 6 of 14 · projection moves on tempo days."

### 2.8 Daniels VDOT table — what to do about it
- `predictRaceTime(vdot, distanceMi)` exists, gives the projection at any distance.
- A small "WHAT YOUR VDOT SAYS · 5K 19:47 · 10K 41:12 · HM 1:31:30 · M 3:09:15" strip is sitting in the toolkit (`VDOTPredictionTable`) and could anchor the redesign — that's a *current state* readout that doesn't need a trend to be useful.

### 2.9 Doctrine + research surfaces (cite-able)
- `lib/training/vdot.ts:bestRecentVdot` — header explains the derivation rule.
- Research/01 `pace-zones-vdot.md` — VDOT philosophy.
- Research/04 `workout-vocabulary.md` — which workout types move VDOT.
- `learn_articles` slug=`doctrine-vdot` exists; `CitationChip` deep-links into it.

---

## 3. Constraints + non-negotiables

- **Dark-first, effort-mesh aware.** Existing surface sits over the `--mesh-targets` palette (race red). Anything new must hold contrast on a luminous warm mesh.
- **No fake data.** Cardinal Rule #1. If a value isn't computable, render an honest empty state — never invent.
- **No em dashes**, no emoji, middot separator (·) for inline pause.
- **Hero stays.** The SUB-1:30:00 hero + gauge above is locked. Don't propose touching it.
- **Hero already says the headline.** Whatever replaces the trend panel must add NEW information.
- **Sparse data must look honest.** "8 snapshots over 61 days" must read as that, not as "8 days of dense tracking."
- **Steady state must look intentional.** If projection hasn't moved, that should be visible as a real fact ("VDOT 48.5 since Big Sur · next test point: Half on Aug 15"), not a sad flat line.
- **Toolkit components available.** `ProjectionSparkline`, `VDOTPredictionTable`, `StatTile`, `ProvenanceLine`, `StateChangeToast`, `CitationChip`, `HeatBandChip`, `LoadBandChip`, `CoachActivityTimeline` are all built and shippable.

---

## 4. Plausible directions (pick one, or invent better)

These are starting points. The design agent should not feel boxed in.

### Direction A · "What's changed since last race"
A timeline of VDOT-shifting events (race retros, PR runs, breakthrough sessions) with the delta each one moved the projection. Solves the steady-state problem: between events, the timeline is empty, which is the truth. Each event is a `StateChangeToast`-style row.

### Direction B · "Components of the gap"
A small horizontal bar showing the 5-min gap broken down: fitness (VDOT 48.5 = ~2:30 of the gap), course (Americas Finest City elev profile = ~30s), conditions (Aug 15 SD forecast ~hot = ~1:30), execution (depends on pacing discipline = ~30s). Each tile clickable for the doctrine. Builds trust + teaches.

### Direction C · "What the VDOT says today"
Full `VDOTPredictionTable` (5K / 10K / HM / M) with the goal-distance row highlighted and a small "next likely move" annotation ("a sub-1:33 HM lifts this to 1:31:48"). Replaces a useless trend chart with an actionable cross-distance readout.

### Direction D · "Hit list — what would move the projection"
A coach-voice card listing the 2-3 cheapest fitness moves available (e.g., "T-pace work · 4 sessions to consolidate VDOT 49", "long run progressions · already on track", "a tune-up race · Big Sur 10K Jun 22 would re-anchor"). Cites Research/04. Connects to schedule.

### Direction E · combination of B + D
Gap breakdown + actionable next moves. Likely the right answer for the marathoner persona but a lot of surface area — designer should size it honestly.

---

## 5. Acceptance criteria for the mockup

A successful mockup file shows ALL of these states, not just the populated happy path:

1. **Steady state** — projection unchanged for 30+ days. (David's current real state.)
2. **Post-race retro** — projection just jumped, source='race-retro'. Show how the event reads.
3. **Cold start** — runner is 14 days into a plan, no race results yet, VDOT estimated off long runs only. `projectionSec` may be null.
4. **Race week** — `daysAway ≤ 7`. Surface shifts to "trust the work" mode; trend stops mattering.
5. **Off track** — `proj > goal × 1.08`. The composeStatus path returns 'off'. Visual treatment must flag without being alarmist.
6. **Multi-race year** — runner has an A-race and a B-race. Does the panel show one or both?
7. **Goal changed mid-cycle** — runner switched from 1:30 to 1:28. The old snapshots are still in the series but the goal line moved.

For each state, the mockup should show what the panel looks like AND what the runner can DO from there (taps, drill-ins, paths to the relevant Today / Plan / Race surface).

---

## 6. Adjacent screens worth designing in the same file (optional)

- **Race Detail "projection" tab** — the same data scoped to one race. Currently `/races/[slug]` has a gauge but no trend.
- **Race-header status pill** — drop-in `RaceStatusDot` is built; how should it be sized + colored on Targets specifically?
- **VDOT explainer sheet** — if the redesign cites VDOT prominently, the `CitationChip` deep-link wants a corresponding `LearnArticleSheet` mockup.

---

## 7. Deliverable

Mockup file under `designs/from Design agent/targets-redesign/` with:
- One hero file showing the final design at full fidelity in dark mode over the race-red mesh.
- One states file showing all 7 acceptance-criteria states stacked.
- Optional: a short markdown rationale on the directional choice (A/B/C/D/E or other) + what data and toolkit components were reused vs new.

When the mockup is ready, the web agent will recreate it in `TargetsView.tsx` against the data contracts in §2.

---

## 8. Files the designer should read first

- `web-v2/components/faff-app/views/TargetsView.tsx` — current implementation (delete-ready).
- `web-v2/lib/training/projection-snapshots.ts` — read API + write cron.
- `web-v2/lib/coach/race-header.ts` — status composition rule + projection trend interface.
- `web-v2/lib/training/vdot.ts` — `bestRecentVdot`, `predictRaceTime`, formatting helpers.
- `web-v2/components/faff-app/toolkit/HealthProfile.tsx` — `VDOTPredictionTable`, `PhysiologyStatRow`.
- `web-v2/components/faff-app/toolkit/atoms.tsx` — chips, status dots, sparkline atom.
- `designs/from Design agent/design_handoff_faff_toolkit/COMPONENTS.md` — the toolkit family spec.

Brief authored 2026-05-31 · web agent · in response to David's "this is pointless" call on the flat trend chart.
