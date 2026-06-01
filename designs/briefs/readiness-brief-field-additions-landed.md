# Brief reply · readiness brief field additions · LANDED

**From:** backend / coach-engine
**To:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Shipped · all 5 fields live on main (`463d4a4c`)
**Brief:** `designs/briefs/readiness-brief-field-additions.md`

---

## What landed

All five fields on `ReadinessBriefSeed`. Renderer-side type extended
in the same commit · typecheck passes (0 errors).

### 1 · `subjectiveCheckin` + POST endpoint · LIVE

**Type:**
```ts
subjectiveCheckin: {
  answeredAt: string | null;  // ISO timestamp of last answer
  rating: number | null;       // 0-10 scale
  answered: boolean;           // true when today's row exists
}
```

**Endpoint:**
```
POST /api/readiness/subjective
  body: { rating: 0..10, notes?: string }
  → 200 { ok: true, rating, objectiveScore, willTriggerOverride }

GET /api/readiness/subjective
  → 200 { ok: true, answered, rating, answeredAt }
```

`willTriggerOverride` returns true when the rating, normalized to a
0-100 scale (`rating × 10`), differs from today's objective composite
by ≥ 15 pts. The override block now actually fires on the next brief
refresh (was hardcoded to null before this commit).

**Storage:** new table `subjective_checkins` (migration 135) ·
`UNIQUE (user_uuid, date)` so re-answering within the day overwrites
via UPSERT.

**Doctrine:** Saw et al. 2016 systematic review · subjective wellness
is the strongest single recovery signal · overrides objective composite
when |delta| ≥ 15 pts.

### 2 · `coldStart` envelope · LIVE

**Type:**
```ts
coldStart: {
  nightsLogged: number;
  nightsNeeded: number;      // 7
  note: string;              // authored coach voice
  healthConnected: boolean;
} | null;
```

Only populated when `band === 'no-data'`. Counts distinct sleep
nights synced in the last 14 days from `health_samples`
(`sample_type = 'sleep_hours'`). Threshold is 7 nights to surface
the first real score.

**Important change:** `loadReadinessBrief` no longer short-circuits to
null for empty breakdowns · returns a full envelope with
`band: 'no-data'`, `score: 0`, `label: 'BUILDING'`, and `coldStart`
populated. This is what the drawer needs to render its
"Building your baseline" state.

Three note variants based on progress:
- 0 nights → "No nights logged yet. Connect Apple Health to sync the
  last few nights · or wear your watch tonight and the brief fills in
  by morning."
- N < 7 → "N of 7 nights logged. R more nights until your first real
  score."
- N ≥ 7 → "Enough data · your first real score lands tomorrow morning."

### 3 · `streaks[].short` · LIVE

All four streak emit sites now author both `short` (5-10 words) and
`meaning` (full coach voice). Examples:

| pillar | short | meaning |
|---|---|---|
| sleep | "Sleep below target 4 nights running." | "Sleep below the 7.5h target 4 nights running. Cumulative debt compounds · Research/00b says single short nights don't matter, sustained dips do." |
| hrv (Plews) | "HRV below baseline 3 days running." | "HRV rolling-7 below SWC 3 days in a row. Per Plews, this is the early-functional-overreach flag · reduce intensity 24-72h and re-check." |
| hrv (fallback) | "HRV below 60-day average 5 days running." | "HRV below your 60-day average 5 days in a row..." |
| rhr | "RHR up 3 days running." | "Resting HR ≥3 bpm above your 60-day baseline 3 days in a row..." |

### 4 · `trendNote` · LIVE

**Type:**
```ts
trendNote: string | null;  // null when scoreTrend < 4 days
```

Composes against `scoreTrend` + active streaks + biggest mover so
the note names the actual cause · not template prose.

Structure:
- **Lead** · direction-aware (down/up/holding) with prior 13d avg
- **Cause** · grafts in the leading streak OR biggest mover when it's
  meaningful (≥4 pts)
- **Resolve** · prescription tailored to the cause (sleep streak →
  "One full night resets the trend"; HRV streak → "24-72h easier
  work"; no streak → "Watch tomorrow · single-day noise resolves
  quickly")

Examples it will produce:
- "Down from a 68 average · 4-day HRV dip is dragging the composite.
  24-72h easier work, then re-check."
- "Holding near your 70 average · SLEEP is the mover (+5 pts). Within
  normal day-to-day range."
- "Up from a 62 average. Trend is healthy · proceed as planned."

### 5 · `composition` · LIVE

**Type:**
```ts
composition: {
  baseline: number;   // mean of past 14d excluding today
  net: number;        // signed · today minus baseline
  today: number;      // duplicates score
} | null;
```

Null only when scoreTrend has 0 prior days (true cold start).
Otherwise always populated · the drawer's BASELINE / NET / TODAY row
always renders honestly.

---

## What changed (composer side)

- `lib/coach/readiness-brief.ts` · added 4 helpers (`loadSubjectiveCheckin`,
  `computeSubjectiveOverride`, `loadColdStart`, `buildTrendNote`,
  `buildComposition`) + extended ReadinessStreak interface +
  ReadinessBrief interface + populated all 5 in the return block
- `lib/coach/readiness-brief.ts` · `loadReadinessBrief` no longer
  returns null for empty breakdowns · returns a cold-start envelope
- `app/api/readiness/subjective/route.ts` · new POST/GET endpoint
- `db/migrations/135_subjective_checkins.sql` · new table, applied
- `components/faff-app/types.ts` · `ReadinessBriefSeed` extended with
  the 4 new fields + `streaks[].short`

---

## Frontend cleanup checklist

You can now delete the client-side derivations and trust the seed:

- [ ] Remove `derived client-side` block computing `priorAvg` /
      `delta` / trend prose · use `seed.readinessBrief.trendNote`
- [ ] Remove client-side BASELINE / NET / TODAY math · use
      `seed.readinessBrief.composition`
- [ ] Render `streaks[].short` by default · expand `meaning` on tap
- [ ] Render Section 8 "How do you feel?" when
      `subjectiveCheckin.answered === false`
- [ ] Wire POST `/api/readiness/subjective` to button row · show
      "your read overrides the numbers" toast when response has
      `willTriggerOverride: true`
- [ ] Render `coldStart` empty state when `band === 'no-data'` ·
      drives "Building your baseline · N of 7 nights" + progress

---

## Doctrine

- **Saw et al. 2016** · subjective wellness > objective markers when
  they disagree (the 15-pt threshold is calibrated to "meaningful"
  per the systematic review's effect sizes)
- **Research/15 §Subjective Measures** · locked in the morning brief
  composer's doctrine block

---

## Files touched

```
M  web-v2/components/faff-app/types.ts
M  web-v2/lib/coach/readiness-brief.ts          (+200 lines · 4 helpers)
A  web-v2/app/api/readiness/subjective/route.ts (new endpoint)
A  web-v2/db/migrations/135_subjective_checkins.sql
```

Commit: `463d4a4c` on `main`.
