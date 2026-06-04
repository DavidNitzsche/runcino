# Faff · Targets page redesign — handoff

Implementation reference for the **Targets** surface
(`web-v2/components/faff-app/views/TargetsView.tsx`; the iPhone TargetsView
consumes the same envelope).

This package is the **flagship `watching` state** at full fidelity. It is a
design reference (HTML/CSS), not production code — recreate it in the app's
React/TSX environment using the existing component and token system.

## Files
- `Faff Targets · WATCHING (web).html` — the design. Self-contained markup + inline `<style>`; the only external dependency is the stylesheet below.
- `colors_and_type.css` — the canonical Faff color + type tokens (already in the design system). Use the app's existing tokens; don't re-import this.

Open the HTML directly in a browser to inspect spacing, sizes, and copy.

---

## The one job of this page
Answer the runner's standing question: **"Am I going to hit my goal?"** —
concretely, honestly, and in the brand voice. Everything is in service of that.

The page reads top to bottom as a narrative, not a stack of cards:
**the answer → the path → the work → the record → the calendar.**

---

## Type & color (from `colors_and_type.css`)
- **Anton** — the `FAFF·RUN` wordmark only (skewed, gold middot).
- **Oswald** (`--font-display`) — all display headlines + every numeric (goal time, VDOT, paces, days, PR values).
- **Inter** (`--font-body`) — body, labels, eyebrows, buttons.
- **Background is neutral charcoal**, not the race-red view mesh. Semantic color is reserved for data only: green = on-track, amber (`--amber-bright` / `#F0C890`) = watching, coral/red (`#EC8E8E`) = off-track / current-fitness. Gold (`--amber-gold`) = A-race pill.
- No em dashes anywhere. Inline pauses use the middot (·). En dashes only for numeric ranges.

---

## Sections, top to bottom

### 1 · Goal hero + projection band  ("the answer")
- **Eyebrow** `PRIMARY GOAL`, then the **goal time** huge in Oswald (`goalRace.goal`), then `goalRace.name · location · {date}`.
- **Status row**: a status pill + a short posture phrase + days-out. Pill color and label come from `goalRace.goalStatus`:
  | status | pill label | pill color | posture phrase |
  |---|---|---|---|
  | `on-track` | ON TRACK | green | "0 sec ahead" (or `goalRace.delta`) |
  | `watching` | WATCHING | amber | "Holding the plan" |
  | `off-track` | (delta, e.g. "5 min behind") | coral | honest read |
  Do **not** repeat the goal time here (it's already the hero).
- **Projection band** — the centerpiece, replaces the old needle gauge. A horizontal number line, **slower → faster left-to-right, so the goal sits on the right**:
  - `Current fitness` marker (left): the raw VDOT projection `goalRace.vdotProjectionSec` (here 1:34:54), solid coral dot, label below.
  - `Plan target` marker (right): `goalRace.goal` (1:30:00), solid white dot, label above.
  - The segment between them is the **gap** (`goalRace.delta`), tinted amber while watching, with a pill: `"{delta} gap · {status}"`.
  - Caption restates it in words from `goalRace.projectionSummary`.
  - **Plan-trusts-itself (non-negotiable, brief §2.1):** the headline number stays at the **goal** while `on-track` or `watching`. Only `off-track` promotes the raw VDOT projection to the hero. On this band the raw read is always shown as honest context, never as the verdict.
  - Marker geometry in the mock is illustrative (current ≈ 22%, goal ≈ 78%). In production, position from the actual time delta on a sensible fixed scale; clamp so both markers stay on-track.

### 2 · On the path  (status narrative)
- Headline + subline from the status (`"Watching · soft signals firing." / "Hold the plan · the next quality run will tell us more."`).
- **Signal card** — one row per `goalRace.driftSignals[]`: a weight chip (`weak`/`medium`/`strong`) + `signal.detail`, with the evidence line beneath. **Every claim cites its evidence (brief §2.4)** — the detail string already names the race/distance/percentage.
- **Recent / Next test points** — two aligned columns from `goalRace.recentTestPoints[]` and `nextTestPoints[]`. Recent rows show date · label · work-phase pace · heat-adjusted verdict (`✓ On` / `Fast` / `Slow`). The two columns share a row grid so they line up.
- **What moves the status** — a 3-rung ladder (On track / Watching / Off track) with the current rung highlighted ("You are here"). Copy is derived from `goalRace.transitions.toBetter` / `toWorse` and the status ladder thresholds (brief §4.7). This **replaces** the old dense "what moves the gauge" prose.

### 3 · The work behind the number  (VDOT)
- Full-width card: current **VDOT** + 6-week delta, a one-line read, and three stats (held / implied half / VDOT the goal needs). Source: `lib/training/vdot-trend.ts` (needs wiring to the Targets envelope per brief §3.5).
- **Block trajectory was intentionally removed** — it lives on Train.

### 4 · Personal records, measured against the goal
- An anchor line stating the half PR vs the goal and the gap, then the PR grid (`seed.prs[]`). The PR at the goal's distance is highlighted with a `−{gap} to goal` chip. PRs are framed as the distance the build is closing, not a disconnected grid (brief §7.4).

### 5 · Races  (upcoming calendar)
- A simple list of **all upcoming races** from `seed.races[]`: name + date/location (left), tag pill (`A RACE` gold / `TUNE-UP` outlined) (right), countdown in days. Plus a `+ New goal` action. This replaced an earlier "road to the A" timeline.

---

## States still to design (not in this package)
The brief (§6) calls for: `on-track`, `off-track`, `no-goal`, `goal-set / no-projection (cold-start)`, and `post-race`, plus iPhone versions of each. Those are the next batch — build off this system.

## Known deviations from a literal spec
- **Wordmark** renders as a static rainbow SVG (solid-ish) rather than the animated CSS sweep — the production app already has the animated wordmark component; use it.
- **Sample data** is physiologically coherent for the demo runner (half PR 1:33:05, VDOT 48.5, Disney Half signal). Wire real `seed`/envelope values.
- Band marker positions are illustrative — compute from real projection vs goal.

## Data contract
See the brief (`uploads/targets-redesign-brief-2026-06-04.md`, §3) for the full
`seed.goalRace` envelope, `projectionTrend`, `prs`, and `races` shapes, and §2
for the doctrine (plan-trusts-itself, three-state color logic, honest no-data,
cite-every-claim) the implementation must preserve.
