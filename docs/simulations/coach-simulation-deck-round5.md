# Coach Simulation Deck · Round 5 (2026-05-19 closing)

## Headline · the coach speaks across the system

Round 4 was "first coaching finding surfaced as a banner." Round 5 is "coaching presence across every daily-touch surface." Six new surfaces this round, all live on real data:

- **E1 + E4** · activity-gap awareness on `/overview` (3d / 5-7d / 8-14d / 15+d states)
- **E3** · no-upcoming-race UX on `/races` coach strip (two states: has-past-races vs cold-start)
- **V3** · race trajectory directional indicator on `/races` A-race hero ("AHEAD / ON TRACK / BEHIND / COLLECTING")
- **C6** · daily readiness score (0-100, three-state ring) replacing the "Readiness · No data" placeholder
- **Rule 6** promoted from candidate to locked + two more instances fixed (race-store `actual_result`, strava-cache `data`)

Plus an audit (S2) that found a real heat-filter gap in the V5 under-reach observation, an investigation (A2) that documented why the 4/15 Hill Repeats workout looked anomalous (workout-name-misleading), and a dead-code cleanup that prepared the codebase for the next agent.

## Five-rule architecture status

| Rule | Status | This-session evidence |
|---|---|---|
| 1 · L6 source-of-truth | ✅ locked | E2 + E3 both read `races.actual_result` first |
| 2 · falsifier-required | ✅ locked | V3 trajectory, C6 readiness, Rule 6 fix all carry falsifiers |
| 3 · surface attribution | ✅ locked | Dead nextFourWeeks code removed; S2 audit doc is the attribution matrix |
| 4 · operational vs decision vs external | ✅ locked | All operational tasks (backfill, diagnostics, audits) self-executed |
| 5 · per-finding context filters | ✅ locked | V5 under-reach heat-filter gap caught + fixed |
| 6 · multi-writer jsonb preserves fields | ✅ **PROMOTED** | Second + third instances (race-store + strava-cache) fixed during A1 audit |

Six structural rules now hold. Each one represents a bug class that's been encoded out of the system.

## Diff vs Round 4

### NEW SURFACES ON `/overview`

```
┌─ /overview ─────────────────────────────────────────┐
│  Coach strip + Check-in                             │
│  StravaGapCard ← NEW E1/E4 · 0-15d state machine   │
│  PostRaceCard  ← E2 (round 4) · still waiting fire │
│  ┌─ Hero TodayCard ─────────────────────────────┐   │
│  │ Left: today's workout                        │   │
│  │       V2 conditional pace guidance           │   │
│  │       V1 pre-workout briefing                │   │
│  │       V5 Z2 stimulus check ← still firing   │   │
│  │ Right: C6 readiness ring ← NEW (replaces    │   │
│  │       "Readiness · No data" placeholder)     │   │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### NEW SURFACES ON `/races`

```
┌─ /races ───────────────────────────────────────────┐
│  Coach strip                                       │
│  - has aRace: existing                             │
│  - has past, no upcoming: E3 NEW · 2nd-state copy  │
│  - cold start: E3 NEW · 1st-state copy             │
│  A-race hero ("Path to the Line")                  │
│    - Current Fitness, Gap to Goal, Trajectory NEW  │
│      (V3 directional indicator from L7 signals)    │
└────────────────────────────────────────────────────┘
```

### NEW SURFACES ON `/profile` Coach Reads

```
(no new surfaces this round — all four Coach Reads
 surfaces were locked in round 4: VDOT, L7 banner,
 VdotShift guard, C2 sparkline)
```

## Audits + investigations

### A1 · splits-preservation audit · Rule 6 promotion

The pre-emptive audit found two more instances of the multi-writer + jsonb + full-replace pattern:

1. **`lib/race-store.ts:saveRaceDB`** · `actual_result` — race editor POST sends body without `actualResult`, would NULL out chip times. **Fixed with whole-column CASE WHEN guard.**
2. **`lib/strava-cache.ts:refreshActivities`** · legacy single-tenant `data` column — writes to same column as multi-tenant sync paths; would clobber splits. **Fixed with same jsonb_set guard as sync-strava-user.**

Rule 6 promoted from candidate to locked. Pre-naming worked: time-to-recognize on the second + third instances was under 5 minutes each (vs. 45 minutes for the original splits-preservation bug). Pattern recognition compounds when patterns are named.

### S2 · cross-surface filter audit · matrix locked

`docs/simulations/s2-cross-surface-filter-audit-2026-05-19.md` has the full matrix.

One missing filter found: V5 under-reach lookup wasn't applying heat filter (only race-recency). Same shape as the 4/23 taper bug from round 4. Fixed in `lib/z2-coverage.ts:findThresholdUnderReach`.

Three deferred (documented as low-impact in audit doc):
- Readiness score · heat filter on yesterday's load
- Readiness score · race-recency on hard-session count
- VDOT shift guard · injury suspension

### A2 · 4/15 Hill Repeats Signal 3 anomaly investigation

`docs/simulations/a2-2026-04-15-investigation.md` documents the full diagnosis.

**Conclusion: workout-name-misleading.** The workout was a tempo on rolling terrain that David named "Hill Repeats." HR pattern (129 → 144 → 146 → 148 → 147 → 151 → 155) shows monotonic build, not interval spikes into Z5. Only mile 7 crossed Z4 floor (155 = floor). Signal 3 made the correct call.

No code change needed. Possible polish queued (low priority) if more cases surface: annotate interval-named workouts whose HR pattern doesn't match interval effort.

## What David sees when he opens the app

**`/overview`** (top of page in order):
1. Coach strip + Check-In (existing)
2. **`StravaGapCard`** (E1/E4) — silent today (David's run history is recent enough to be in 0-2d window)
3. **`PostRaceCard`** (E2) — silent today (last race was 5/3 Sombrero, outside recovery window)
4. Hero TodayCard:
   - Left: today's workout + V2 conditional pace + V1 briefing + V5 Z2 stimulus check (firing: 0/6 in Z2, 22% share)
   - Right: **C6 readiness score** with three-state ring (replacing the No-data placeholder)
5. Week strip

**`/races`**:
- Coach strip with **E3 logic** (silent today since David has an A-race; would fire if he didn't)
- A-race hero ("Path to the Line") with **V3 Trajectory tile** (likely shows "COLLECTING" since all L7 signals are below thresholds for David)

**`/profile` Coach Reads** (unchanged from round 4):
- VDOT 46.6 + race contributors
- VdotShiftBanner — silent (baseline at current)
- AdaptiveVdotBanner — silent (all 3 L7 signals below thresholds)
- Max HR 181 + Resting HR 40 + HRR framework
- Z2 Sparkline — 6 weeks, range 8:34-10:17/mi
- Pace bands

## What's correctly NOT firing

- L7 Signals 1+2+3 individually — insufficient data (each below its threshold)
- L7 combined verdict — no signal fires up or down → no-finding
- Shift guard — baseline at current VDOT, no shift
- Max HR suspect-ceiling — already applied (175→181), surface dormant
- E2 PostRaceCard — outside recovery window
- E1+E4 StravaGapCard — recent activity, 0-2d window
- V3 Trajectory — COLLECTING (no L7 signals firing yet)

The system holds when evidence is insufficient. That's the discipline.

## Commits this round (sample)

| Commit | Scope |
|---|---|
| `ac998ca` | A1 audit + Rule 6 promotion + race-store/strava-cache fixes |
| `13353a8` | E1+E4 activity-gap surface + injury-suspends-signals hook |
| `422ca9e` | V3 race trajectory directional indicator |
| `7fdb7d8` | C6 daily readiness score with three-state ring |
| `e3a1ba8` | E3 no-upcoming-race UX + inspect-splits since-param |
| `577c305` | A2 investigation + S2 audit + V5 heat-filter fix |

Plus the round 5 deck itself.

## Lessons that compound across rounds

1. **Pre-naming candidate rules works.** Rule 6 caught its second + third instances in <5 minutes each. Discipline encoded survives.
2. **Audits are cheap; missing-filter bugs are expensive.** S2 caught the V5 heat-filter gap before it surfaced as a "huh, why did V5 fire after a hot tempo?" moment in production. The matrix becomes the structural artifact preventing the next instance.
3. **Conservative-on-upside holds at every layer.** V3 trajectory requires 2+ corroborating UP signals for "AHEAD" — single-signal positive lands at the more conservative "ON TRACK." Same shape as L7's UP_OBS_MIN=3 threshold. The discipline is consistent.
4. **Surface-only readiness scores resist the auto-modify temptation.** C6 produces a recommendation but never modifies the plan. The runner decides. That's the right shape for any score-shaped surface.

## What's queued for next session

- V4 migration banner template generalization (parametric pace before/after table for any future migration)
- C1 why-this-workout tooltip on every prescribed workout
- C3 PR trajectory as adaptive signal (4th L7 signal contribution)
- C4 PR-anchored race feasibility (time-delta framing alongside VDOT framing)
- C5 PR coaching lines (per-PR dynamic copy based on date + effort + distance match)
- C7 plan vs actual mileage with miles-in-the-bank
- C8 workout substitution menu
- C9 race result projection chart
- S3 elevation-adjusted finish times
- S5 Rose Bowl auto-migration visibility · admin system-actions view

Plus first real-data fires:
- E2 post-race card on next race finish
- L7 Signal 1 on next 3+ threshold workouts in 6-week window
- L7 Signal 2 on next 10+ Z2 mile-splits per window
- V3 trajectory state shifts as L7 signals accumulate
- Candidate Rule 7? — TBD, surfaces only when its first instance appears

## Closing observation

This arc — from "race-result database with explainer copy" to "coaching presence across daily-touch surfaces" — happened across five rounds, ~80 commits, ~12 weeks of session-time. The compounding pattern is observable:

- **Round 1-2**: foundational data plumbing (L1-L6), reliability discipline
- **Round 3**: adaptive philosophy made operational (L7 framework, suspect-ceiling)
- **Round 4**: first coaching finding surfaces in production (V5 firing)
- **Round 5**: coaching presence multiplies across surfaces; rules encode discipline

Each round added structural defenses that protected the next round's work. The five-rule architecture (six now with Rule 6 promoted) is what makes round 6+ accelerate rather than plateau. Discipline encoded survives across agent rotations. That's the architectural achievement worth holding.

*Round 5 deck generated 2026-05-19 evening. Keep round 4 (`coach-simulation-deck-round4.md`) as the diff baseline.*
