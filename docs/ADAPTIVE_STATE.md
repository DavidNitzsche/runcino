# Adaptive system · state of the app

Snapshot at commit `4f33235`. Read this when you want to know where the "alive but not nervous" architecture stands without re-reading the whole transcript.

## The bar (locked in code)

`web/lib/adaptive-pattern.ts` — the philosophy as TypeScript. Every adaptive module imports its types and helpers, which means the compiler refuses to let you ship a recommendation without:

1. **An evidence array** — `EvidenceItem[]` with weights, dates, kind tags. UI must render it.
2. **A falsifier** — `buildVerdict()` throws if it's missing or <20 chars. "What would change our mind."
3. **Asymmetric thresholds** — `meetsEvidenceThreshold()` requires ≥3 observations + ≥2.5 weight for UP changes; ≥2 + ≥1.5 for DOWN. Cost of overtraining > cost of leaving a small fitness gain on the table.
4. **Context filters** — `contextMultiplier()` attenuates weights for heat (75°F = 0.5×, 85°F = 0.25×), recent race within 14 days (0.5×), poor sleep <6h (0.7×), load spike >1.5× baseline (0.6×), low energy check-in (0.7×). Floors at 0.1 so no signal fully zeroes.
5. **Trend math** — `compareTrendWindows()` requires ≥3 samples per window before flagging "sufficient".
6. **Confidence scaling** — `'high' | 'medium' | 'low' | 'none'` based on how far evidence overshoots threshold.

24 contract tests in `lib/__tests__/adaptive-pattern.test.ts` guard the helpers.

## Modules that meet the bar

| Module | File | UI surface | Tests |
|---|---|---|---|
| Max HR validation | `lib/validate-max-hr.ts` | `MaxHrValidationBanner` on /profile | 16 |
| Weekly insights (easy pace + mileage) | `lib/weekly-insights.ts` | /overview insight strip | covered via integration |
| Coach engine cutback trigger | `lib/coach-engine.ts:435` | Daily prescription | 38 engine-event tests |

## Modules audited, queued as background tasks

Each chip on your screen is a self-contained task with file paths, the architectural pattern to follow, and references to the existing modules as templates. They'll spawn fresh worktrees and won't block main.

1. **P0 pace band lookup bug** — M/T/I pulling from wrong VDOT row. Math is broken; technically higher priority than the adaptive work but the user said to ship max HR first.
2. **Split E into 3 sub-bands** (recovery / aerobic / steady) — Daniels E is too wide for one prescription.
3. **Passive VDOT updater** — race-update + threshold-adherence + HR-pace-drift triggers, same Apply/Keep current/falsifier banner as max HR.
4. **HR-to-pace drift tracking** — longitudinal Z2 pace trend, feeds the VDOT updater's drift signal.
5. **Coaching copy rewrite** — every workout step gets `rangeReps`, `cutCondition`, `extendCondition` so prescriptions are ranges not edicts.
6. **Coach engine: trend-track check-ins** — extend `CoachState.checkin.trend7d` array, gate the cutback firing on trend direction not just count.
7. **Strava ingest: anomaly flags** — R5-R8 spike rules at ingestion time; consumers filter rows with `anomalyFlags` set.
8. **Race feasibility validator** — `validate-race-feasibility.ts`, compares stored VDOT to race goal pace, surfaces 'stretch / fair / conservative' verdict on /races/[slug] hero + /profile Coach Reads.

## Over-reaction guards currently in place

The simulation suite (`lib/__tests__/adaptive-simulations.test.ts`, 18 scenarios) explicitly tests:

- One great workout → no VDOT bump
- One bad hot day → context-filtered to ~25% weight, doesn't fire
- One post-race rough run → race-recency × heat compounds to 0.125× weight
- 2 easy runs slower than band → no insight (3+ required)
- 1 poor check-in + low easy-share → no cutback (2+ required)
- 1 validated peak +2 bpm → no max HR bump (needs 2+ OR +5 bpm clear gap)
- 1 fatigue item → no DOWN signal either (2+ required even for DOWN)
- Three hot-week runs → all context-filtered, total weight too low to fire

## Asymmetric thresholds working as designed

DOWN signals fire faster than UP:
- 2 items with 1.8 total weight → fires DOWN
- Same 2 items → does NOT fire UP (UP needs ≥3 items and ≥2.5 weight)

The asymmetry is intentional and tested.

## Pre-existing failures NOT addressed (not adaptive-related)

- `lib/__tests__/retrospective.test.ts` — missing fixture file `public/big-sur-3-50.runcino.json`
- `lib/__tests__/plan-builder.test.ts` — race-week distance assertion (expects exactly 13.1)
- `lib/__tests__/coach-engine-scenarios.test.ts` — build-ramp tolerance 1.40× vs 1.35× cap

All three predate the adaptive work and need their own investigation. The plan-builder + engine-scenarios failures suggest the synthetic plan ramp is over-aggressive in build weeks — could be a real bug worth its own pass.

## Commit history of this arc

| Commit | What landed |
|---|---|
| `54f14d5` | Fitness resolver + workout-descriptions rewrite + Coach Reads card + modal/race-plan consumers |
| `8f87dcf` | Resting HR manual entry + 11 verification tests |
| `2371633` | Active race = nearest + /overview hero reads fitness |
| `68f5ef5` | Weekly insights kill the 9:00–9:30 leak |
| `c5dd8f0` | Engine VDOT alignment via `state.aggregateVdotValue` |
| `5be7398` | HR zones in workouts + race-plan/training-plan consistency docs + races multi-tenant |
| `641d745` | Multi-tenant lockdown (strava-cache user-scope, 4 routes pass userId) |
| `1936e45` | Polish: round HR decimals, time-aware greeting, race tile links, skip toggle |
| `37fa3f9` | Max HR validation module (first adaptive surface) |
| `6d58e41` | Adaptive pattern codified in code + max HR validator hardened |
| `373d3cd` | Adaptive guards: weekly insights + engine require sustained evidence |
| `4f33235` | 18 adaptive simulation tests |

## Verification

- 70 tests across adaptive-pattern + validate-max-hr + fitness-resolver + vdot all pass
- 18 simulation tests assert the philosophy at the integration level
- Build green on every commit
- Three pre-existing failures unchanged (documented above)

## What "alive but not nervous" looks like now

Open `/profile` → Coach Reads card. The Heart Rate row will surface a validation banner if your stored max HR doesn't match the data (your case: HM avg 161 → suggests 175–183 → banner appears with "Suggested 179 bpm — midpoint of estimated range" + "What would change our mind" footer). One click bumps the value, dismisses for 30 days, or you can leave it.

The banner won't fire on a single sensor spike, a single hot race day, or a single bad workout. It needs sustained evidence. That's the bar.

Open `/overview` → the weekly insight strip won't say "Easy pace this week is X" until you have at least 3 easy runs in the last 7 days. Each insight includes a falsifier line so you know what would un-fire it.

When the queued tickets ship, the same pattern applies to VDOT, race feasibility, easy-pace sub-bands, training load, etc. They all import the same types, the compiler refuses to let them skip the falsifier, and the simulation suite catches over-reaction regressions.
