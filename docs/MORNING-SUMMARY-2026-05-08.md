# Morning Summary — 2026-05-08

What landed overnight while you were asleep. All on `main`,
all deployed via Railway (which now correctly tracks `main` after
we set it up earlier in the session).

## TL;DR

**16 commits + 1 audit + 1 fresh end-of-night audit + this summary.**
Three arcs:

1. **VDOT becomes a complete coaching layer** — tier classification,
   freshness, age + sex grading, automatic test prescription, and
   the runner profile to support it.

2. **Dashboard becomes a real coaching surface** — readiness banner
   with research-backed signals, daily voice brief with citations,
   30-day outlook strip, HR zones tile, phase-aware guidance for
   taper / post-race / rebuild, quality day count, long-run cap.

3. **Stat correctness pass** — audited every dashboard stat for
   accuracy. Fixed the easy-ratio classifier (was reading 100% on
   runners with hard miles), unified phase vocabulary with the engine,
   fixed quality day count to use the same name regex as the effort
   classifier.

Every new surface cites the doctrine that backs it (Research/00b,
Research/01, Research/03, Research/14, Research/19, Research/24).

## Commit log

| SHA | What | Why |
|-----|------|-----|
| `a35a305` | VDOT C1 — tier doctrine + freshness window + testing cadence | Research/01 extended; tier classification, 56-day freshness, field-test protocols, calendar triggers all moved to cited doctrine |
| `1207464` | VDOT C2 — UX states (badge, staleness, no-data) | Dashboard tile shows tier (NOVICE/INTERMEDIATE/ADVANCED/ELITE), freshness chip (FRESH/STALE SOON/STALE/EXPIRED), and a NoVdotPanel listing field-test options when no recent race exists |
| `cf95b30` | VDOT C3 — age + sex grading + runner profile | New Research/24 doc; doctrine/grading.ts; localStorage runner profile (birth year + sex) editable on /profile; age-graded VDOT renders on the dashboard tile when known |
| `fb42263` | Coach plans a 5K time trial when VDOT is stale | New `vdot_test_5k` workout type; pickRun() swaps the next quality day for a TT when shouldPromptVdotTest fires; guards on TAPER + POST_RACE |
| `2f69332` | Next-30-days dashboard tile | simulateNext30Days() + Next30DaysTile; color-coded strip with race flags, month dividers, today ring; bridges "today" and "the race calendar" |
| `eb2604e` | Daily training brief on dashboard + "why?" affordance | New coach.briefDailyTraining() method (LLM + deterministic); CoachDailyBrief replaces the old WHY one-liner; same why-toggle now also on the race brief revealing citations + rationale |
| `cf8fc42` | Readiness banner — surface verdict + cite recovery doctrine | ReadinessAssessment grew signals + recommendedAction fields keyed to INCOMPLETE_RECOVERY_DECISION_MATRIX; new ReadinessBanner on the dashboard with green/yellow/red + expandable signals panel |
| `3d8e61d` | Hydration tile from Research/19 | HydrationTile on race detail: 24h/2-4h/final-hour pre-race plan, distance×temp ml/hr table, EAH guardrails. Direct response to audit's #2 finding |
| **`831d469`** | **Easy ratio classifier — research-backed** | **The 100% bug. New cascade: name patterns → VDOT pace zones → HR threshold → long-run default → explicit unknown bucket. Phase-aware "On target" verdict. UI shows easy/hard/unknown 3-segment bar with low-confidence chip.** |
| `d393516` | Phase + quality count match the engine | TrainingPulseTile pulls phase from /api/coach/today (engine wins). Quality day count now also uses HARD_NAME_RE not just Strava workoutType=3 |
| `a233c36` | HR zones tile + HRmax/RHR profile fields | New HrZonesCard derived from HRMAX_ZONES_5 (Research/03). HRmax priority: measured > Tanaka estimate (208 - 0.7×age) > hidden. Profile editor adds HRmax + RHR inputs |
| `9300cca` | Quality day count + Daniels long-run cap on Training Pulse | "X / Y QUALITY THIS WEEK" line; "≤ X.X MI · DANIELS +10% RULE" next-week cap with phase ceiling |
| `60be8b5` | Phase-aware guidance card (taper / post-race / rebuild) | New PhaseGuidanceCard between CoachTodayCard and Next30DaysCard. Wires taper.ts (was unwired) + recovery_protocols.POST_RACE_STAGES (was unwired). Hidden in BASE/BUILD/PEAK |

(Plus earlier in the session: `269f8d9` brief owns description, `9f72bb9` brief reads training state, `0fd5408` weather + brief auto-load, `5b406b2` brief horizon, `eadb51e` VDOT dashboard tile, `afa4410` VDOT pipeline.)

## Bug fixes (correctness pass)

The user explicitly flagged the easy ratio bug. Tracking down why
that broke surfaced two more parallel issues. All three fixed:

### 1. Easy ratio always reading 100% (`831d469`)

**Root cause:** the classifier was firing "hard" only on a narrow
regex match (15 patterns) OR HR ≥ 152 BPM. A runner doing tempo
work with a generic "Morning run" name and HR 145 (well-trained
runners hit threshold under 152) got classified as easy. Activities
without HR data defaulted to easy. Result: 100% easy on most
real-world Strava feeds.

**Fix:** research-anchored cascade with explicit unknown bucket.

```
1. NAME PATTERN — runner's intent (highest confidence)
   HARD_NAME_RE expanded from ~15 to ~30 patterns:
     tempo / threshold / intervals / repeats / fartlek /
     progression / VO2 / cutdown / ladder / track / hills /
     surges / pickups / cruise / sub-threshold / MP block /
     marathon pace / wave tempo / alternations / 400s / 800s /
     1k / 1200s / 1600s / strides / pyramid
   New EASY_NAME_RE for explicit easy-tagged runs:
     recovery / shakeout / base / MAF / Z2 / aerobic /
     conversational / chill / jog
2. VDOT PACE ZONES — when current VDOT exists, M-pace-or-faster =
   hard, E-zone or slower = easy. Daniels' 80/20 rule.
3. HR THRESHOLD — fallback when no name + no VDOT.
4. LONG RUN DEFAULT — runs ≥12 mi without quality signal → easy.
5. UNKNOWN — explicit when no signal applies. Don't lie that it
   was easy.
```

UI now shows the easy/hard/**unknown** breakdown as a 3-segment bar
with a `LOW CONF` chip when classification confidence drops below 70%.
"On target" verdict is **phase-aware** — pulls from coach-principles
(TAPER 78% / PEAK 75% / BUILD 70% / BASE 80% / POST_RACE 90% / REBUILD 85%)
instead of a static 75% threshold.

17 tests cover the cases. Doctrine source: Research/01 (VDOT pace zones)
+ intensity.ts polarized 80/20.

### 2. Two parallel phase vocabularies (`d393516`)

The dashboard's TrainingPulse computed its own phase ('TAPER' / 'PEAK'
/ 'RACE MONTH' / 'POST-RACE' / 'BUILDING' / 'BASE BLOCK') from local
heuristics. The engine returns a different vocabulary ('BASE' / 'BUILD'
/ 'PEAK' / 'TAPER' / 'BASE_MAINTENANCE' / 'POST_RACE' / 'REBUILD').
They could disagree — dashboard could say BUILDING while the engine
called it BASE_MAINTENANCE.

**Fix:** TrainingPulseTile now fetches /api/coach/today and uses the
engine's phase (mapped to the dashboard's display vocabulary). The
local heuristic stays as a backup for the moment before the API
resolves on first paint.

### 3. Quality day count missing untagged workouts (`d393516`)

trainingPulse() was counting `Strava workout_type === 3` only. Most
runners never set the type explicitly. A "Tempo run" with default
type counted as zero quality.

**Fix:** also matches `HARD_NAME_RE` so name-tagged runs count
without needing the Strava metadata.

## What you'll see

### Dashboard (`/`)

```
┌───────────────────────────────────────────────────────────┐
│ Greeting / next race / recent run / weekly mi / YTD       │
├───────────────────────────────────────────────────────────┤
│ This week strip · Today's plan                            │
├───────────────────────────────────────────────────────────┤
│ Coach says (today's mode)                                 │
│ ┃ READINESS BANNER — green/yellow/red, expandable signals │
│ ┃ Today's run + strength prescription                     │
│ ┃ COACH SAYS · voice paragraph + ▸ WHY? affordance        │
│ ┃ Week shape strip                                        │
├───────────────────────────────────────────────────────────┤
│ PHASE GUIDANCE CARD — only fires in TAPER/POST_RACE/REBUILD│
│   - Taper: window / volume rule / intensity rule / errors  │
│   - Post-race: stage banner + progress bar + day count    │
│   - Rebuild: returning-from-layoff playbook               │
├───────────────────────────────────────────────────────────┤
│ NEXT 30 DAYS — color-coded strip, race flags, month rules │
├───────────────────────────────────────────────────────────┤
│ VDOT FITNESS                                              │
│   VDOT 47.1 · INTERMEDIATE · FRESH chip                   │
│   AFC Half · 14 days ago · 13.26mi 1:36:31 7:17/mi        │
│   Age-graded VDOT 60.6 · age 55: +13.5 for age-grading    │
│   E / M / T / I / R pace zones with full labels           │
├───────────────────────────────────────────────────────────┤
│ HR ZONES — 5-zone (ACSM) computed from HRmax              │
│   Z1 RECOVERY · Z2 EASY · Z3 AEROBIC · Z4 THRESHOLD · Z5 VO│
│   BPM ranges + %HRmax + purpose + talk test               │
├───────────────────────────────────────────────────────────┤
│ Recovery widget                                           │
├───────────────────────────────────────────────────────────┤
│ TRAINING PULSE                                            │
│   Phase + 8wk bars + N/Y QUALITY THIS WEEK                │
│   Weekly avg + delta vs prior 4w                          │
│   Long run avg + peak last 28d + NEXT-WEEK CAP (Daniels)  │
│   Easy ratio % + 3-bucket bar + phase target              │
├───────────────────────────────────────────────────────────┤
│ Year-of-running heatmap · Fun stats                       │
└───────────────────────────────────────────────────────────┘
```

### Race detail (`/races/[slug]`)

- Hero PosterCard with adaptive Coach brief + ▸ WHY? affordance
- PhaseCards
- Race-day weather (auto-loaded, ≤7d NOAA / >7d Open-Meteo last year)
- Mile splits + Fueling tile + **NEW Hydration tile** (Research/19)
- Course detail (charts, splits, elevation)

### Profile (`/profile`)

- **NEW RUNNER PROFILE section** above training schedule:
  - Birth year (drives age + age-graded VDOT)
  - Sex (drives sex-cohort framing)
  - HRmax BPM (drives HR zones; falls back to Tanaka estimate)
  - RHR BPM (for future Karvonen / HRR zones)
- All localStorage-backed, optional, auto-save on change

## Audit findings

The fresh end-of-night audit is at `docs/AUDIT-2026-05-08-final.md`.
It supersedes the early-session audit and reflects everything shipped
during the night.

**Key remaining gaps** (audit recommendations queue):

1. **`recovery_protocols.ts` — partial wiring done (4/22 constants used).**
   Still unconsumed: MARATHON_BIOMARKER_TIMELINE, REVERSE_TAPER_PROTOCOL,
   MARATHON_RECOVERY_4WK_REVERSE_TAPER, MULTI_RACE_CADENCE,
   CARBON_PLATE_RECOVERY_EFFECTS, plus the qualitative-signals matrix
   when HealthKit lands.
2. **HR zones — partial (5-zone wired, 7-zone + Karvonen + LTHR test
   protocols still unconsumed).** Karvonen needs RHR (now in profile
   but not yet in HrZonesCard).
3. **`hydration.ts` — partial (FLUID_DURING_RACE + PRE_RACE_HYDRATION
   wired).** SWEAT_RATE_PROTOCOL (sweat-test workflow), EAH_RISK_FACTORS,
   SWEAT_SODIUM_CLASSIFICATIONS still unconsumed.
4. **6 fully-unwired research docs:** mobility, mental, sex (but
   sex-cohort grading IS now wired), age, travel, cross_training,
   form-biomechanics, form-corrections, footwear (the audit will
   tell you what's most useful to wire first).
5. **`/workout/[date]` page** is still entirely static placeholder —
   click-through from the dashboard's TODAY tile.
6. **`/health` page** has 4 hardcoded HealthKit placeholder cards.
7. **Coach methods still throwing stubs:** paceStrategy, taperDepth,
   fuelingFor, retrospect, adjustForReality.
8. **CoachState still doesn't have age, sex, HRmax, RHR** server-side.
   Profile is localStorage-only — fine for grading the dashboard but
   the engine + brief LLM prompts can't see them yet.

## Test status

- Typecheck clean across the entire `web/` tree
- 113+ tests pass: VDOT (21), grading (9), effort balance (17), plus
  the existing suites
- One unrelated suite skipped (missing fixture from a prior session)

## Railway

- Source branch: `main` (we set this up)
- Latest deploy successful
- No crash emails since the source switch

## Suggested next reads (in this order)

1. **`docs/AUDIT-2026-05-08-final.md`** — full picture of what's
   surfaced + what's not. Section 5 (STAT ACCURACY AUDIT) is the
   one to scan if you want a verdict per stat.
2. **Walk the dashboard** — set birth year / sex / HRmax on `/profile`
   first to light up age-graded VDOT and HR zones.
3. **Open AFC race detail** — Hydration tile is at the bottom; Brief
   has ▸ WHY? toggle now.

## Open questions

- Server-side profile (Postgres user table) vs continued localStorage?
  The grading layer wants age + sex; the engine wants HRmax. Until
  we have auth, localStorage is fine. Worth scoping the migration?
- WMA age-grading tables (vendor the full lookup vs continue with
  the Daniels-extrapolated decline approximation)?
- HealthKit integration as the next big M2 unlock — would close
  several audit gaps (RHR, HRV, sleep readiness signals).
- The static `/workout/[date]` page is the one big remaining
  static-placeholder surface. Worth replacing with a real day view
  (the engine already produces every day's prescription via
  simulateNext30Days).
