# faff.run — Project Memory

This project is a multi-surface running app for a competitive marathoner. Three surfaces share one source of truth: **web** (command center), **iPhone** (daily companion), **Apple Watch** (execution layer).

---

## Required reading at session start

Read these in order before doing any design or implementation work in this project. Do not skim. Load them into context fully.

### 1. Design source of truth

`Design/running-app-design-brief.md`

The complete design language: palette (locked), typography, spacing, component vocabulary, hierarchy rules, surface variants, tone of voice, anti-patterns. Includes an explicit "Source of truth" section at the top that supersedes any prior design work in this codebase.

### 2. Knowledge base research

Two directories holding training methodology, data model, and domain context. Read everything in them:

- `BuildResearch/`
- `Research/`

The coach runtime pulls from these. Decisions about what each beat of a page should hold should be informed by what's in here, not assumptions.

### 3. Product surface specs

- `APP_FEATURE_SPEC.md` — whole-app surface map. What each surface (web, iPhone, watch) is for and what pages exist.
- `C1-overview-and-today.md` — element inventory for Web Overview and iOS Today, including the conditional layouts that promote, demote, add, and remove elements based on training state.

---

## Operating posture

- **The design brief is authoritative.** If existing components, tokens, or layouts conflict with it, replace them. Do not harmonize. Do not split the difference.
- **Light-theme work in the codebase is abandoned.** The app is dark. The palette in the brief is locked.
- **Composition is state-driven, not template-driven.** Pick what each beat of a page holds based on the C1 inventory and the user's current training state (off-season, base, build, peak, taper, race week, race day, post-race, injury). A page rendered race week and a page rendered four months out should look meaningfully different, not the same page with new numbers.
- **Coach voice, not app voice.** Short, direct, no hype, no exclamation marks, no emoji, no em dashes. See the brief's tone section for canonical examples.
- **Audit before changing.** When starting work on a new surface or component, audit what's already there against the brief and surface every conflict before acting. Don't silently rewrite.

---

## Conventions

- New design files under `docs/design/`.
- Research outputs under `docs/research/`.
- Product decisions documented in `docs/PRODUCT_DECISIONS.md`.
- The brief itself is editable. If you find a real reason to change a token, a rule, or a principle, propose the change explicitly rather than working around it.

---

## Race-data source-of-truth (locked 2026-05-19)

**Before merging ANY component that displays race-related data, answer these four questions:**

1. **Does this display a race result?** (finish time, finish pace, PR, race comparison, aggregate VDOT, race-anchored prediction)
2. **If yes, does it read from `races.actual_result` first?** Curated chip times beat raw Strava elapsed.
3. **If it falls back to `strava_activities`, is that fallback labeled as provisional?** (e.g., "Training effort · race to lock in", "Strava elapsed", not "Personal Record"). Strava-source data must never display as authoritative race performance.
4. **Does it skip auto-detected Strava best-effort segments?** A 5K split inside a long run is not a 5K race; pulling `canonicalLabel` directly from `strava_activities` is how the phantom-5K bug landed in compute-vdot. If a race-result consumer reads `canonicalLabel`, it's likely wrong.

**The historical bugs that motivate this checklist** (all fixed by 2026-05-19):

| Bug | Component | Root cause |
|---|---|---|
| Phantom 5K · VDOT 33.6 in aggregate | `compute-vdot.ts` | LEFT JOIN to `strava_activities` allowed auto-detected splits to leak |
| Missing Sombrero Half | `compute-vdot.ts` | Dedup-by-canonical-distance dropped the slower of two HMs |
| Empty Personal Records card | `/races/page.tsx` | Read ONLY from `strava_activities.canonicalLabel`, never from `races.actual_result` |

**Reference docs:**
- `docs/simulations/race-data-source-audit-L6.md` — the 11-component audit confirming current clean state
- `web/app/api/admin/audit-races/route.ts` — diagnostic admin endpoint for ongoing data drift detection

**Non-race-result consumers** (these correctly use `strava_activities`):

- HR readings (`validate-max-hr.ts` reads `maxHr` and `avgHr` from training runs)
- Activity caching (`lib/strava-activities.ts`)
- The sync layer itself (`/api/strava/sync`)

The distinction is *what you're surfacing*: race performance → races table; training data → strava_activities. Use the right source for the right job, not "races good, Strava bad."

---

## Operational vs decision vs external (locked 2026-05-19)

The boundary that decides whether the agent acts, asks, or confirms before touching something. Three distinct buckets:

### 1. Operational tasks · self-execute

Run as part of the work. Surface results, not requests to trigger.

- Backfills, internal data populations (e.g., `/api/admin/backfill-splits`)
- Running diagnostics endpoints the agent built (`l7-signal-view`, `audit-races`, `race-hr-diagnostic`)
- Invoking endpoints the agent built itself, including read-only admin routes
- Test runs, typecheck, lint
- Sync checks, status probes
- Reading data that exists in the system to verify its own work

The pattern is: agent built it → agent knows it's safe → agent has rate-limited it → agent runs it. The result goes in the status surface, not a "go run this" instruction. Buttons buried in status docs get missed when shipping fast.

### 2. Decisions · explicitly flag as blockers

Pause. Ask. Resume after answer.

- Combined-rule shapes when multiple valid options exist (e.g., "either signal fires alone vs. softer combined threshold")
- Threshold values where the right answer isn't physiologically obvious
- Architectural splits where the trade-off is real (DI vs. direct DB, lazy vs. eager fetch)
- Scope expansions beyond the explicit queue
- Anything where two defensible answers exist and the wrong one creates structural debt

The pattern is: state the decision, state the options, state the default if no answer, pause. Resume the moment an answer lands.

### 3. Externally-consequential actions · require confirmation

These touch the outside world or cost real money/trust. Confirm before each one.

- Sending email
- Deleting files, rows, or external resources
- Spending money (API costs are usually fine; service-tier upgrades aren't)
- Touching public-facing surfaces (production deploys, public posts, live data the user-facing app reads in a way the user can't undo)
- Anything destructive that can't be reversed by running the inverse command

The pattern is: name the action, name what it touches, name what reverses it, confirm.

**Why this matters:** the bug class is "agent buries an action in a status doc → user misses it → expected outcome never happens → agent's report drifts from reality." Operating boundaries fix the bug class. Buttons in status docs get missed; decisions correctly flagged get answered; external actions correctly gated stay safe.

---

## What to do if a doc referenced above is missing

If any of the required-reading documents is missing or empty when you go to read it, stop and tell me which one is missing. Don't proceed by inference.
