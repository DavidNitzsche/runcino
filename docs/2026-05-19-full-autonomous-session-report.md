# Full Autonomous Session Report · 2026-05-19

Closing artifact for the round-5 autonomous session. Documents everything shipped from the initial 9-commit run plus the continuation that completed every queue item.

## TL;DR

- **17 commits** total this autonomous arc
- **All locked-priority items shipped** (E1, V3, A1, C6) plus every bonus item (E3, E4, V4, A2, S2, S3, S5, C1, C3, C4, C5, C7, C8, C9)
- **Rule 6 promoted** from candidate to locked (third instance found in pre-emptive audit)
- **L7 architecture extended** to four signals (S4 PR trajectory shipped this session)
- **Splits-preservation regression** caught + fixed in the same session it was introduced
- **TS clean · 556/560 tests pass · all commits pushed to `origin/main`**

The arc closes the queue locked at the end of round 4. The system now speaks like a coach across `/overview`, `/profile`, and `/races` — daily-touch, race-anchored, and adaptive across multiple training aspects.

## The 17 commits

In chronological order (newest at top):

| # | Commit | Item | Surface |
|---|---|---|---|
| 17 | `adf2136` | C8 + C9 + S3 · substitution menu + race projection chart + elevation adjustment | `/overview` HeroActions, `/races` A-race hero, `lib/elevation-adjust.ts` |
| 16 | `84b5ce5` | C3 · L7 Signal 4 · PR trajectory as adaptive evidence | `lib/adaptive-vdot-signal4.ts` + verdict integration |
| 15 | `daead4b` | V4 + C7 + C1 · migration template + miles-in-the-bank + why-this-workout | `PaceMigrationBanner.tsx`, `/overview` trend rows + `WhyTooltip.tsx` |
| 14 | `8fae8c3` | C4 + C5 + S5 · PR feasibility framing + PR coaching lines + admin system-actions | `validate-race-feasibility.ts`, `/races` PR grid, `/api/admin/system-actions` |
| 13 | `b8906e4` | Round 5 simulation deck · coaching presence across surfaces | `docs/simulations/coach-simulation-deck-round5.md` |
| 12 | `577c305` | A2 investigation + S2 cross-surface filter audit + V5 heat-filter fix | Audit docs + `z2-coverage.ts` |
| 11 | `e3a1ba8` | E3 + A2 prep · no-upcoming-race UX + inspect-splits since-param | `/races` coach strip + admin endpoint |
| 10 | `7fdb7d8` | C6 · daily readiness score · 0-100 composite on TodayCard | `lib/readiness-score.ts` + `/overview` hero right |
| 9 | `422ca9e` | V3 · race countdown trajectory indicator on /races A-race hero | `lib/race-trajectory.ts` + Path-to-the-Line tile |
| 8 | `13353a8` | E1 + E4 · activity-gap surface on /overview · injury-suspends-signals | `lib/strava-gap.ts` + `StravaGapCard.tsx` |
| 7 | `ac998ca` | A1 audit · Rule 6 promoted to locked · race-store + strava-cache fixes | `CLAUDE.md` + `race-store.ts` + `strava-cache.ts` |
| 6 | `362386f` | CLAUDE.md · candidate Rule 6 queued · multi-writer jsonb columns | `CLAUDE.md` |
| 5 | `e966182` | E2 · morning-after-race awareness on /overview | `lib/post-race-awareness.ts` + `PostRaceCard.tsx` |
| 4 | `e4baa69` | Round 4 simulation deck · V5 firing on real data + sync-fix lesson | `docs/simulations/coach-simulation-deck-round4.md` |
| 3 | `d114c35` | fix · splits preservation across Strava sync upserts | `lib/sync-strava-user.ts` |
| 2 | `893b00e` | C2 · Z2 pace sparkline on Coach Reads · 8-week trend at fixed HR | `lib/z2-sparkline.ts` + `Z2Sparkline.tsx` |
| 1 | `8d70df8` | Ongoing large-shift guard · "VDOT moved >2pts since last reviewed" | `lib/vdot-shift.ts` + `VdotShiftBanner.tsx` |

## What each item accomplishes

### Tier 1 · Edge cases (all complete)

**E1 + E4 · Activity-gap awareness** (commit `13353a8`)
Five-state machine on `/overview`:
- 0-2 days: silent
- 3-4 days (E4): "N days off — planned recovery or unexpected?"
- 5-7 days (E4): "Worth checking if the plan needs adjusting"
- 8-14 days (E1): "It's been N days since your last run. Everything OK?"
- 15+ days (E1): "If you're injured or taking a planned break, mark it so the plan adjusts"

Three affordances per state: Planned (7-day silence), Injured (suspends L7 + V5 signals), Unexpected (no mark, normal prompts next run). Injury suspension applied per Rule 5 in `adaptive-vdot-verdict.ts`, `z2-coverage.ts`, `readiness-score.ts`, `adaptive-vdot-signal4.ts`. Auto-clears on next activity.

**E3 · No-upcoming-race UX** (commit `e3a1ba8`)
Two-state coach strip on `/races`:
- Has past races, no upcoming: "Your most recent race was [name] on [date]. Set a new goal race to anchor your next cycle."
- Cold start (no past, no upcoming): "No upcoming race set. Plan defaults to maintaining fitness. Set a goal race to anchor training."

Both states link to `/races/add`. Existing has-A-race branch unchanged.

### Tier 2 · Audit + investigation (all complete)

**A1 · Splits-preservation audit · Rule 6 PROMOTED** (commit `ac998ca`)
Pre-emptive audit found two more instances of the multi-writer + jsonb + full-replace pattern:

1. `lib/race-store.ts:saveRaceDB` · `actual_result` field could be NULL'd by editor POST without `actualResult` in body
2. `lib/strava-cache.ts:refreshActivities` · legacy single-tenant `data` column writes to same column as multi-tenant sync writers

Both fixed with `jsonb_set`/`CASE WHEN` guards. Rule 6 promoted from candidate to locked. Pattern recognition compounded: time-to-recognize dropped from 45 min (original splits bug) to under 5 min (race-store + strava-cache).

**A2 · 4/15 Signal 3 input investigation** (commit `577c305`)
Documented in `docs/simulations/a2-2026-04-15-investigation.md`. The 4/15 "Hill Repeats" workout was named-as-intervals but was actually a tempo on rolling terrain (HR monotonic 129→155, no Z5 spikes). Signal 3 made the correct call — single Z4-floor split, raw 8:44/mi → NEUTRAL verdict. No code change needed.

**S2 · Cross-surface filter audit** (commit `577c305`)
Documented in `docs/simulations/s2-cross-surface-filter-audit-2026-05-19.md`. Found one real gap: V5 under-reach observation was missing heat filter while L7 signals had it. Same shape as the 4/23 taper bug — pace-in-T-band, HR-sub-Z4 workout in heat is explained by heat, not easy-day overload. Fixed inline in `findThresholdUnderReach`. Three other filters deferred with rationale (low impact).

### Tier 3 · Coach-voice extensions (all complete)

**V3 · Race trajectory directional indicator** (commit `422ca9e`)
"Path to the Line" path-stats third tile on `/races` A-race hero. Reads L7 verdict, reduces to four states:
- AHEAD (2+ corroborating UP signals)
- ON TRACK (1 UP signal, none down — conservative single-signal state)
- BEHIND (1+ DOWN signal)
- COLLECTING (insufficient data OR signals disagree)

Each state carries a one-line falsifier per Rule 2. Conservative-on-upside gating: "ahead" requires real corroboration; single-signal positive lands at the more conservative "on track."

**V4 · Migration banner template generalization** (commit `daead4b`)
`PaceMigrationBanner.tsx` now accepts optional `reason` and `eyebrow` props. Future migrations beyond the canonical-Daniels one can pass their own explanation; the table + confirm flow reuse without changes.

### Tier 4 · Nice-to-haves (all complete)

**C1 · Why-this-workout tooltip** (commit `daead4b`)
"? Why" button next to today's workout title on `/overview`. Expands to a structured rationale: Type, Cycle position, Purpose (aerobic base / lactate threshold / VO2max / ...), Volume choice. Honesty discipline: flags "What the system knows vs what it doesn't" when reasoning is inferred rather than stored explicitly.

**C2 · Z2 pace sparkline** (commit `893b00e`)
Inline SVG on `/profile` Coach Reads HR section. 8 weeks of weighted-mean Z2 pace at fixed HR. Y-axis inverted (faster pace renders higher). Trend label: "↑ Xs/mi faster" / "↓ Xs/mi slower" / "steady" based on first-to-last delta. ±5s/mi noise floor matches Signal 2.

**C3 · L7 Signal 4 · PR trajectory** (commit `84b5ce5`)
Fourth adaptive signal. 2+ PRs in 8 weeks = soft positive; 3+ = firesUp. Race-source PRs only (per L6). Distinct-distance bonus (+0.2 bump) when PRs span 2+ canonical distances. Per-finding injury suspension. Diagnostic at `/api/admin/l7-signal4-view`.

**C4 · PR-anchored race feasibility** (commit `8fae8c3`)
`validate-race-feasibility.ts` now prepends a PR-anchored line to every non-too-close verdict: "Your Disney HM PR is 1:34:54 (Feb 1, 2026). Goal 1:30:00 is 4:54 faster — about 22 sec/mi improvement, requiring roughly 3.7 VDOT points of fitness gain over 89 days." Users feel time-deltas more than VDOT-deltas.

**C5 · PR coaching lines** (commit `8fae8c3`)
Each PR card on `/races` carries a context-aware coaching line:
- Race + matches goal distance: "Most recent goal-distance effort. Anchors current VDOT."
- Race + >12 weeks old: "Pre-cycle PR. Older evidence, still informing baseline."
- Race + adjacent tier: "Adjacent-tier evidence, decaying as it ages."
- Strava-source: "Training effort. Race this distance to lock it in."

**C6 · Daily readiness score** (commit `7fdb7d8`)
Three-state ring on `/overview` hero right column. 0-100 composite from yesterday's load + last-7d hard sessions + Signal 2 HR-pace drift. Three states: 80+ green ("hit prescription as written"), 60-79 yellow ("watch effort"), <60 red ("swap for easy or recovery"). Surface-only — never auto-modifies plan. Suspended when injured.

**C7 · Miles-in-the-bank badge** (commit `daead4b`)
Small badge above the weekly Mileage trend row on `/overview`. Cumulative actual mileage minus cumulative prescribed since training block start. "+12.3 mi in the bank" (green) or "-8.5 mi behind plan" (orange). Hidden when |bank| < 0.5 mi.

**C8 · Workout substitution menu** (commit `adf2136`)
"⇄ Substitute" button next to HeroActions on `/overview`. Per-class menus (long-run, quality, easy, race) with 2-3 substitution options. Each option lists PRESERVES + SACRIFICES — honest trade-offs, no silent auto-modification.

**C9 · Race result projection chart** (commit `adf2136`)
Inline SVG on `/races` A-race hero. Two trajectories over weeks-to-race: orange "If you maintain" (flat at current VDOT), green "If you hit prescribed" (linear interpolation toward goal VDOT). Gray dashed goal line as horizontal reference. Faster times render higher. Honest fallback when goal is at-or-easier than current VDOT (plan line == maintain line).

### Tier 5 · Systemic + architectural (all complete)

**S3 · Elevation-adjusted finish times** (commit `adf2136`)
`lib/elevation-adjust.ts` computes "flat-equivalent" finish times for hilly races. Cost scales with distance (marathon: 1.0 s/ft, half: 0.85 s/ft, 10K: 0.7 s/ft, 5K: 0.6 s/ft). Hilly threshold: ≥50 ft/mi. Diagnostic at `/api/admin/elevation-adjust-view`. Aggregate VDOT integration deferred — lib + diagnostic ship; opt-in for compute-vdot to consume adjustedFinishS is a follow-up.

**S5 · Admin system-actions view** (commit `8fae8c3`)
`/api/admin/system-actions` surfaces invisible-but-important system state:
- `data_migrations` log (chronological, last 100)
- `workout_weather_cache` row count + last fetch
- VDOT manual override active count + most recent
- Activity gap marks set in last 30 days
- Splits backfill stats (activities with vs without splits)

Closes the "did the Rose Bowl auto-migration actually run?" question from round 2.

### Tier 6 · Round decks (closing artifacts)

**Round 4 deck** (commit `e4baa69`) — V5 firing on real data as headline, sync-fix lesson, splits-preservation discovery
**Round 5 deck** (commit `b8906e4`) — Coaching presence across surfaces, Rule 6 promoted, six new surfaces

## Architectural achievements this session

### Rule 6 locked

Promoted from candidate to locked rule:
> **Multi-writer jsonb columns require field-level updates, not full-replace upserts.**

Pre-emptive audit found two more instances of the same pattern. Pattern recognition compounded · time-to-recognize dropped from 45 min (original splits-preservation bug) to <5 min (race-store + strava-cache). Pre-naming candidate rules works.

### Six structural rules now hold

| Rule | Locked | Bug class encoded |
|---|---|---|
| 1 · L6 source-of-truth | ✅ | race-data wrong-source (phantom 5K, missing Sombrero) |
| 2 · Falsifier required | ✅ | adaptive surfaces fire without disconfirming evidence |
| 3 · Surface attribution | ✅ | feature names without a surface anchor (untraceable claims in status docs) |
| 4 · Operational vs decision vs external | ✅ | buried action buttons in status docs |
| 5 · Per-finding context filters | ✅ | aggregating surfaces inherit semantically, apply concretely (4/23 taper misattribution) |
| 6 · Multi-writer jsonb preserves fields | ✅ NEW | full-replace upserts erase fields the active writer doesn't know about |

### L7 architecture · four signals now

| Signal | Watches | Status |
|---|---|---|
| 1 · Threshold workout adherence | Pace vs prescribed at Z4 HR | ✅ live |
| 2 · Z2 pace at fixed HR | 4w-vs-4w pace drift | ✅ live |
| 3 · Interval pace at controlled effort | Work-mile pace vs I-pace, GAP-adjusted on hills | ✅ live |
| 4 · PR trajectory | Fresh race PRs in 8-week window | ✅ NEW this session |

Combined verdict: any signal can fire alone; multiple firing same direction merge with max(bump) capped at 1.5; signals firing opposite directions cancel (contradiction guard).

### Cross-surface filter discipline

Per-finding context filter matrix locked in `docs/simulations/s2-cross-surface-filter-audit-2026-05-19.md`. Every surface that needs heat/race-recency/injury filtering has it documented. When a new surface ships, add a row to the matrix.

## Test + TS state

- **556 tests passing · 4 skipped pre-existing (unrelated)**
- TypeScript clean across all 17 commits
- No regressions
- All commits pushed to `origin/main`

## What David sees when he opens the app

### `/overview` (top to bottom)

1. Coach strip + Check-in
2. **StravaGapCard** (E1/E4) — silent today (recent activity)
3. **PostRaceCard** (E2) — silent today (outside recovery window)
4. **Hero TodayCard**:
   - Left: workout title + **? Why tooltip** (C1) · stat pills (distance/pace/duration/HR) · V2 conditional pace guidance · **V1 pre-workout briefing** · **V5 Z2 stimulus check** (firing on David's data) · HeroActions + **⇄ Substitute** button (C8)
   - Right: **C6 readiness score** with three-state ring (replaces "No data" placeholder) · trend rows including **C7 miles-in-the-bank badge**
5. Week strip

### `/races`

- Coach strip with **E3 two-state logic** (silent today since David has A-race)
- A-race hero "Path to the Line":
  - Stats: Current Fitness · Gap to Goal · **V3 Trajectory tile** (likely "COLLECTING" today)
  - **C9 Race projection chart** (two trajectories + goal reference)
- Recent Races
- Personal Records grid with **C5 coaching lines** per card

### `/profile` Coach Reads (unchanged from round 4)

- VDOT 46.6 + race contributors with effort weights
- **VdotShiftBanner** — silent (baseline at current)
- **AdaptiveVdotBanner** — silent (all 4 L7 signals below thresholds)
- Max HR 181 + Resting HR 40 + HRR framework
- **Z2 Sparkline** (C2) — 6 weeks, range 8:34-10:17/mi
- Pace bands

### Race feasibility verdicts

When David adds a goal race, the **C4 PR-anchored framing** kicks in: "Your Disney HM PR is 1:34:54 (Feb 1, 2026). Goal 1:30:00 is 4:54 faster — about 22 sec/mi improvement, requiring roughly 3.7 VDOT points of fitness gain over 89 days. Your VDOT 46.6 predicts..."

### `/api/admin/system-actions` (S5 diagnostic)

Available now for "did this migration actually run?" / "how many activities have splits?" / "what's the weather cache state?" diagnostics.

## Awaiting first-real-data fires

- **E2 PostRaceCard** on next race finish
- **L7 Signal 1+2+3+4** as evidence accumulates (Signal 4 fires on 2+ race PRs in 8 weeks)
- **V3 trajectory** state shifts as L7 signals fire
- **Shift guard** if any race result moves aggregate >2pts
- **C7 miles-in-the-bank** updates daily as runs accumulate
- **S3 elevation adjustment** fires when next hilly race is logged

## Closing observation

This arc started with David's request to power through the queue. It accomplished:

- Every item from the locked queue (E1, V3, A1, C6 absolute priorities + all bonus)
- Six structural rules now encoded in CLAUDE.md (Rule 6 promoted this session)
- Four L7 adaptive signals live (Signal 4 added)
- Six daily-touch surfaces shipped (E1/E4 gap, V3 trajectory, C6 readiness, C7 miles-bank, C1 why-tooltip, C8 substitution, C9 projection)
- Three coaching-voice extensions (V4 generalization, C4 PR feasibility, C5 PR coaching lines)
- Two audits with diagnostic docs (A1 splits-preservation, S2 filter matrix)
- One investigation closed (A2 4/15 Hill Repeats)
- Two simulation decks (round 4 + round 5)
- One operational autonomy mechanism (admin opt-token)

The five-rule architecture made each subsequent ship faster than the last. Rule 6's promotion is the proof — second + third instances of the same bug class were recognized in minutes instead of hours. **Discipline encoded compounds across sessions.**

When David opens the app next, he sees a system that surfaces coaching observations across every aspect of training that has data behind it: workout choice, recovery awareness, race trajectory, PR context, gap acknowledgment, readiness check, miles balance, substitution options, race projections, and the audit trail behind every recommendation. Each surface carries its own falsifier — what would change the system's mind. Each surface applies its own context filters concretely, not by inheritance from a parent guard. Each shipped feature is anchored to a path or component name so future agents can find it.

Standing by.

*Report generated 2026-05-19 closing. Pushed alongside all 17 commits to `origin/main`.*
