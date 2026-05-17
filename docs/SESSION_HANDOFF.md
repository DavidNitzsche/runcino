# faff.run · Session Handoff Brief

Paste this into a new Claude Code session to bootstrap context. It's the minimum you need to land productive work without re-explaining the project.

---

## What this is

faff.run is a Next.js running-coach app. The soul of the product: **an AI running coach, not a planner or tracker.** Every number on screen must be one of three things:

1. **Computed by the coach** from the runner's real data, citing real doctrine.
2. **Pulled from real state** (Strava runs, races, daily check-ins).
3. **Honestly labeled "NO DATA YET"** — never a fake placeholder.

This is the trust contract. Violating it is the worst sin in this codebase.

## Where to work

- **Working directory:** `/Volumes/WP/06 Claude Code/Runcino` (NOT a sub-worktree).
- **Dev branch:** `claude/build-faff-app-OIRJr` — all development commits land here.
- **Production branch:** `main` — fast-forward from the dev branch after meaningful work. The user wants both kept in sync.

**Standard commit + push pattern:**

```bash
git push origin claude/build-faff-app-OIRJr
git push origin claude/build-faff-app-OIRJr:main
```

Both pushes after every meaningful commit. Railway deploys from `main`.

**Worktree warning:** the repo has sub-worktrees with adjective-noun-hex names (`objective-black-…`, `cranky-joliot-…`, etc.) for parallel sessions. They are throwaway. Never work in them; never push from them.

## Current architecture state (as of the previous session)

The "plan-as-artifact" rewrite is **live on main.** The full design is documented at [docs/PLAN_ARCHITECTURE.md](PLAN_ARCHITECTURE.md) — read that first.

In summary:

- **Five DB tables** (`training_plans`, `plan_phases`, `plan_weeks`, `plan_workouts`, `plan_mutations`) hold the plan as a real artifact.
- **`buildPlan(state, prefs, race?)`** in [web/coach/plan-builder.ts](../web/coach/plan-builder.ts) authors the plan once when goal is set.
- **`adaptPlan(plan, state, today)`** in [web/coach/plan-adapter.ts](../web/coach/plan-adapter.ts) mutates it via doctrine-grounded triggers.
- **Two modes:** `race-prep` when an A-race is within ~16 weeks (periodized arc), `maintenance` otherwise (steady aerobic baseline with one weekly quality). Auto-transitions when goal date passes.
- **`getCurrentPlan`** in [web/coach/plan-lifecycle.ts](../web/coach/plan-lifecycle.ts) is the single entry point — runs lifecycle check, calls adaptPlan, returns the active plan.
- **UI reads the plan:** /overview TodayCard, /training PlanCalendar, PLAN ADAPTED card all consume the plan tables. The legacy `pickRun` engine survives as fallback for runners without a profile.
- **Profile edit modal** lets the user set: name · age · sex · location · max HR · Level (Beginner/Intermediate/Advanced) · long-run day · quality days · rest day. Those last four drive plan authoring.

## Doctrine — the only source of truth for engine decisions

All coach behavior must cite a real `Research/` doc + literal section heading. The canonical research lives at [`/Volumes/WP/06 Claude Code/Runcino/Research/`](../Research/) — there are ~25 markdown files indexed in [Research/INDEX.md](../Research/INDEX.md).

The most-cited docs:

- `Research/00a-distance-running-training.md` — volume progression rules, workout categories, plan skeletons.
- `Research/00b-recovery-protocols.md` — Decision Matrix for qualitative signals, recovery-by-effort table, hard/easy alternation.
- `Research/01-pace-zones-vdot.md` — Daniels training paces (E/M/T/I/R), VDOT freshness window, Dosing rules — Daniels' caps.
- `Research/02-race-time-prediction.md` — Riegel formula.
- `Research/05-injury-return-protocols.md` — 10% rule, weeks-off ≈ weeks-to-rebuild, volume-before-intensity.
- `Research/08-pacing-and-race-week.md` — taper math, race-week templates by distance.
- `Research/22-plan-templates.md` — sample peak weeks per (distance × level), peak volume bands, peak long-run constants.

**Rule:** if doctrine doesn't define a threshold or a behavior, the engine doesn't do it. No engine-author hunches.

## How the user wants you to work

- **Plain English in the audit log + reports.** No commit hashes, no jargon, no file paths in user-facing prose. The audit log at [docs/audit-live.html](audit-live.html) is the running log — auto-refreshes in the user's Safari, written like someone is sitting with them explaining what changed.
- **Deploy agents for anything and everything as you find it.** The user runs many parallel background agents. Don't queue work serially; spawn agents in parallel when scopes are non-overlapping. Coordinate agent briefs to avoid file collisions.
- **Push to main directly.** Don't batch at session boundaries — every commit goes to both dev branch and main.
- **No fake fallbacks.** When data is missing, the surface says "NO DATA YET" honestly. Don't synthesize history, don't fabricate numbers, don't pretend HealthKit is wired.
- **Trust the doctrine. No artificial discipline ceilings.** When the user said "trust the doctrine" about adaptation discipline, they meant it: research thresholds are the only thing that triggers adaptation. One bad sleep doesn't move a workout; 3+ poor check-ins per Decision Matrix does.
- **A-race transitions are automatic.** When the goal date passes, the next plan auto-starts (toward the next A-race or into maintenance). No user prompt.

## Verification expectations

- Use preview tools (`preview_start`, `preview_snapshot`, `preview_screenshot`) to verify UI changes in the browser before committing. Don't ask the user to check manually.
- TSC must pass — `cd web && npx tsc --noEmit`. The user's Railway build runs `next build` which type-checks; broken TS means broken deploys.
- Vitest must pass — `cd web && npx vitest run`. Pre-existing baseline is ~265+ tests passing.
- **Railway-only TSC errors live in untracked files** (`app/api/plan/route.ts`, `app/api/research-stream/route.ts`) — Railway never sees them because they're not committed. Don't get spooked by them locally.

## Flagged follow-ups (next-session candidates)

- **Pace targets in `PlanWorkout` are null.** Wire `pacesFromVdot(state.vdot, zone)` into each authored workout so the calendar shows "5 mi @ T pace" (7:15/mi for VDOT 50).
- **`vdot-upgrade-dampening` trigger is enumerated but doesn't fire.** Needs a vdotSnapshot delta wire-through to compare current VDOT to prior cycle's.
- **Persist VDOT on state** (currently computed at read-time). Same for `maxHr`, prior-streak peak, illness flag, env-disruption flag. Enables narrative priorities 3 (streak break) and 5 (recent PR / VDOT updated) to fire.
- **Shared profile-name helper.** /overview/data.ts and /training/data.ts both stub `'Runner'`; should lift into a shared helper.
- **PlanAdaptedCard does an extra fetch per render.** Hoist mutation history into the API response payload.

## What's in flight right now

Nothing. All previous-session agents landed. Plan-as-artifact is shipping. The dashboard reflects real data driven by the persisted plan.

## Key files to know

| File | What it does |
|---|---|
| [docs/PLAN_ARCHITECTURE.md](PLAN_ARCHITECTURE.md) | Source of truth for the plan-as-artifact architecture |
| [web/coach/plan-builder.ts](../web/coach/plan-builder.ts) | `buildPlan` — authoring |
| [web/coach/plan-adapter.ts](../web/coach/plan-adapter.ts) | `adaptPlan` — doctrine-grounded mutations |
| [web/coach/plan-lifecycle.ts](../web/coach/plan-lifecycle.ts) | `getCurrentPlan` + lifecycle transitions |
| [web/lib/plan-store.ts](../web/lib/plan-store.ts) | DB read/write for plans + mutations |
| [web/lib/coach-state.ts](../web/lib/coach-state.ts) | `gatherCoachState` — builds CoachState from DB + Strava + check-ins |
| [web/lib/coach-engine.ts](../web/lib/coach-engine.ts) | Legacy `pickRun` engine (fallback path) + `simulateRange` |
| [web/coach/coach.ts](../web/coach/coach.ts) | The 16 Coach methods (`prescribeWorkout`, `pathToRace`, `nextPushes`, `retrospect`, `recentAdjustments`, etc.) |
| [web/coach/coach-narrative.ts](../web/coach/coach-narrative.ts) | One-sentence coach voice line — signal-driven only |
| [web/lib/db.ts](../web/lib/db.ts) | All DB table schemas |
| [docs/audit-live.html](audit-live.html) | The running log the user keeps open in Safari |

## First action of every session

```bash
cd "/Volumes/WP/06 Claude Code/Runcino"
git worktree list                                    # confirm you're NOT in a sub-worktree
git remote show origin | grep "HEAD branch"          # confirms origin/HEAD → claude/build-faff-app-OIRJr
git fetch origin && git log origin/main --oneline -5 # see what's on main
```

If `git worktree list` shows you in a sub-worktree (path ending in `.claude/worktrees/<name>`), STOP. Switch to the primary path. Anything you build in a sub-worktree is throwaway and will not reach the user.

---

That's the brief. Read [docs/PLAN_ARCHITECTURE.md](PLAN_ARCHITECTURE.md) next to understand what the coach actually does.
