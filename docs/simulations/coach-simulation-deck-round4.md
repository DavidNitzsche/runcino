# Coach Simulation Deck · Round 4 (2026-05-19 evening)

## Headline · the system became a coach

The V5 Z2 stimulus check fires on David's real data:

```
Z2 stimulus check
Last 7 days: 0/6 easy runs landed in Z2 band (HR ≤139).
Last 28 days: 18% of easy mileage in Z2 (11 of 60 mi).

Your easy runs are too hard.
Easy effort builds aerobic capacity without accumulating fatigue —
when easy runs drift into Z3 the aerobic-base adaptation weakens AND
you carry more fatigue into quality days.

Easy days are HR-governed, not pace-governed. Hold HR ≤139.
Walk uphills if needed. Let pace be whatever it needs to be —
likely 8:29-8:59/mi on flat terrain, slower on hills or in heat.

What would change our mind: 3+ consecutive weeks where ≥60% of easy
mileage lands in Z2.
```

This isn't a calculator output. It isn't a validation prompt. It's an observation about training execution that a coach would make after looking at a month of running. The system synthesized:

- Resting HR 40 + max HR 181 → HRR Karvonen framework → Z2 = 125-139
- 28 days of activity data with per-mile splits backfilled from Strava
- Per-split HR filtering → 11 Z2 miles out of 60.1 easy miles
- 7-day check + 28-day check + 3-run-minimum + 40% threshold
- Race-recency suppression for taper-distorted observations

Five layers of analysis converging into one coaching finding. **This is the moment the alive-but-not-nervous philosophy produces actual coaching value end-to-end.**

## Diff vs round 3

### NEW SURFACES

| Surface | Where | Status |
|---|---|---|
| **V5 Z2 stimulus check** | `/overview` (above hero buttons) | ✅ FIRING on real data — 22% Z2 share, 0/6 in Z2 |
| **Ongoing large-shift guard** | `/profile` Coach Reads (above L7 banner) | ✅ wired · awaiting >2pt shift; baseline = 46.6 set today |
| **C2 Z2 pace sparkline** | `/profile` Coach Reads (in HR section) | ✅ rendering · 6 weeks of data, range 8:34-10:17/mi |

### SIGNAL 3 GRADE-ADJUSTED PACE · VALIDATED

The 4/10 hill repeats workout — Round 3's open question — now traces cleanly through Signal 3's GAP refinement:

```
2026-04-10 · "Hill Repeats"
  raw work-pace:    7:47/mi
  GAP work-pace:    6:59/mi
  distortion:       48 s/mi
  swap rule:        >20 s/mi → swap to GAP
  comparison basis: gap
  comparison pace:  6:59/mi (Δ +18s vs prescribed I-pace 6:41)
  work HR:          137 (below Z4 floor 153)
  verdict:          NEUTRAL · within I-pace band (basis: gap)
```

Two layers of intelligence working together:
1. **Terrain correction** (GAP) — finds the workout was real interval pace, not slow
2. **HR floor check** — finds the workout WASN'T actually at Z4-Z5 effort

Either signal alone would have misled. GAP alone would have concluded "interval pace was honest." HR alone would have concluded "sub-threshold workout." Together: "paces look fine after grade correction, but the body wasn't actually working at I-pace effort." That's the right reading.

### RULE #5 (PER-FINDING CONTEXT FILTERS) · ENCODED IN CLAUDE.md

Added alongside the four existing rules:
1. L6 source-of-truth checklist
2. Falsifier required on every verdict
3. Surface attribution on status docs
4. Operational vs decision vs external
5. **Per-finding context filters** — aggregating surfaces inherit semantically, apply concretely

The V5 surface caught its own first-prod-run bug exactly because rule #5 was already in scope when the verification ran. Without the rule encoded, the under-reach observation would have mis-attributed 4/23 taper conservation to easy-day overload. With it, the bug surfaced as a one-line patch.

### NEW BUG CLASS · CAUGHT THIS SESSION

**"Full-replace upserts on jsonb columns are unsafe when one writer populates detail fields not present in another writer's payload."**

The pattern:
1. Detail-only field (`splits`) added to `NormalizedActivity` shape
2. Detail fetch + backfill populates the field
3. YTD list sync runs on every page load
4. List endpoint doesn't return `splits_standard`
5. `INSERT ... ON CONFLICT DO UPDATE SET data = EXCLUDED.data` full-replaces → splits wiped
6. Z2 surfaces silently return zero data

Caught on round 4 verification — second operational diagnostic run after the first one passed. The first run confirmed backfill worked; the second run after some time (during which background syncs ran) found the data gone.

**Fix** (commit `d114c35`): preserve `splits` during sync upserts via `jsonb_set` with a guard:

```sql
SET data = CASE
  WHEN strava_activities.data ? 'splits' AND NOT (EXCLUDED.data ? 'splits')
  THEN jsonb_set(EXCLUDED.data, '{splits}', strava_activities.data->'splits')
  ELSE EXCLUDED.data
END
```

Applied symmetrically to both `syncSingleActivity` (webhook) and `syncStravaForUser` (YTD list).

**Generalizable lesson worth holding (not yet rule #6, but worth flagging as a candidate):**
> Detail-only jsonb fields require per-key preservation when any other writer touches the same column. Naive full-replace works only when all writers populate the same set of fields.

This applies to any future detail-sourced field: HR streams, GPS waypoints, segment efforts, weather-at-workout (which we're about to add via the V1 briefing's coords lookup). Worth documenting before the next regression of the same shape.

### POSTSCRIPT (CARRIED FORWARD FROM ROUND 3)

The race-recency filter + HRR activation postscripts in `coach-simulation-deck-round3.md` are still the proof points for the alive-but-not-nervous philosophy working under real conditions. Round 4 doesn't supersede them — it adds a new proof point (V5 firing) and a new bug-class lesson (splits preservation).

## What David sees when he opens the app

### `/overview` (TodayCard)

- **V1 pre-workout briefing** · weather + shoe + last-similar (from earlier this overnight)
- **V5 Z2 stimulus check** · NEW · fires when Z2 share <40% across 3+ recent easy runs
- Today's workout + conditional pace guidance for easy/recovery/long days

### `/profile` Coach Reads

- **VDOT 46.6** · 4 race contributors + Big Sur hilly-excluded · contributor explainer
- **Ongoing large-shift guard** · NEW · silent today (baseline = current), will fire on >2pt shift
- **L7 adaptive VDOT banner** · silent today (Signal 1 insufficient data, Signal 2 below volume gate, Signal 3 insufficient data — system correctly waiting)
- **Max HR 181** · suspect-ceiling already applied · banner silent
- **Resting HR 40** · HRR framework active (Karvonen)
- **HR Zones** · Z2 125-139, Z4 153-167 · framework label "HRR (Karvonen)"
- **C2 Z2 pace sparkline** · NEW · 6 weeks of data, range 8:34-10:17/mi, last point highlighted
- **Pace Bands** · Daniels canonical for VDOT 46.6 · migration already acknowledged

### `/races/big-sur-marathon`
- HILLY · EXCLUDED FROM VDOT header (unchanged)

### `/races` Personal Records
- 4 race PRs with chip-time pills (unchanged)

## What's correctly NOT firing

- **L7 Signal 1** — 2 threshold candidates in 6 weeks, 1 race-recency-filtered. Need 3. ✅ correctly waiting.
- **L7 Signal 2** — 7 Z2 miles recent vs 10 required. ✅ correctly waiting (volume gate).
- **L7 Signal 3** — 2 interval candidates in 6 weeks. Need 3. ✅ correctly waiting.
- **L7 combined verdict** — no signal fires up or down. ✅ no-finding with race-week clear, all three signals below thresholds.
- **Shift guard** — baseline just set, current VDOT = baseline. ✅ within-threshold suppress.
- **Max HR suspect-ceiling** — already applied (175 → 181). Surface dormant.

The pattern: the system holds, names what it would take to fire, and lets the runner go run. That's the discipline.

## Commits this round

| Commit | Scope |
|---|---|
| `9a94a42` | Signal 2 wired into verdict + CLAUDE.md rule #4 |
| `049fc2f` | Admin operational token + opted-in endpoints |
| `56ca11d` | set-fitness-config endpoint |
| `e9f79f2` | L7 Signal 3 + verdict combines all three |
| `3a8bdff` | Signal 3 GAP comparison + 20s/mi swap threshold |
| `e31d66c` | V5 Z2 stimulus check on /overview |
| `99f9bd4` | V5 fix · under-reach skips race-recency |
| `b1f53b8` | CLAUDE.md rule #5 · per-finding context filters |
| `8d70df8` | Ongoing large-shift guard |
| `893b00e` | C2 Z2 pace sparkline |
| `9a3d261` | Cleanup · dead nextFourWeeks code |
| `d114c35` | Fix · splits preservation across sync upserts |

12 commits. Three new surfaces shipped + verified on real data. One regression caught and fixed in the same session it was introduced. One architectural rule encoded in CLAUDE.md. One bug-class lesson surfaced as a candidate for future rule #6.

## What's next

Per locked queue:

1. **E-tier edge cases** in priority order: E2 (morning-after-race) → E1 (stale Strava) → E4 (miss-3-days) → E3 (no-upcoming-race); defer E5 + E6.
2. **4/15 Signal 3 input investigation** — workout-detection issue, split-classification issue, or genuine? Low priority but real.
3. Future rule #6 candidate: detail-only jsonb fields require per-key preservation (worth promoting if a second instance of the same bug class lands).

## Closing observation

Round 3 was "framework wired end-to-end." Round 4 is "first coaching finding surfaced as a banner on the user's screen." The system has crossed from race-result database with adaptive guardrails into actual coaching presence.

The five-rule architecture (L6 + falsifier + surface-attribution + operational/decision/external + per-finding-context-filters) is doing real work. Three of those rules caught bugs in this session alone — surface attribution caught a status-doc reference to dead code, per-finding context filters caught the under-reach misattribution on first prod run, operational autonomy enabled the agent to run + verify ops without human keyboard time.

Compounding through encoded discipline. The next surface will inherit all five rules by default. That's what makes this collaboration accelerate instead of plateau.

*Round 4 deck generated 2026-05-19 evening. Keep round 3 (`coach-simulation-deck-round3.md`) as the diff baseline.*
