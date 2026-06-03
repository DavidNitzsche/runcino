# Calibration session · doctrine + engine brief

**Status:** design brief · not ready to build · holding for David's go-ahead
**Pairs with:** `designs/briefs/onboarding-master.md` § Skip-all path / decision #3
**Author:** backend agent

The "let's pace your first easy run together" surface for runners with no race history, no Strava history, or fresh onboarding skip-all. Captures one honest baseline so the coach voice can move from `calibration` → `guided` after one run instead of guessing for two weeks.

This brief is the contract — code lands later when David clears it.

---

## When calibration fires

A calibration prompt surfaces on Today / on the watch when **all** of these are true:

- `coach_state.voiceBand === 'calibration'` (no race history + low VDOT confidence)
- No completed `calibration_sessions` row for this runner
- Today is a run day (`todayWorkout?.type` ≠ `'rest'`)

When all are false, no prompt. The runner can also tap a "Calibrate now" affordance from Settings at any time.

### Why this matters

Without calibration, a cold-start runner gets either:
1. A textbook-default easy pace (often 30-60s off their actual easy)
2. A VDOT-derived pace from a self-reported goal time (which is aspirational, not current)

Either way the first 2 weeks are coach-guessing-at-the-runner. Calibration collapses that to a single run.

---

## Surface contracts

### Today screen banner (web + iPhone)

```
┌──────────────────────────────────────────────────────────┐
│ ⚡ CALIBRATION RUN · TODAY                                │
│ Run 3 mi at honest easy effort. We'll learn your pace    │
│ from miles 2-3 and tune the plan from there.             │
│                                                          │
│ [ START CALIBRATION ]   No targets · just run            │
└──────────────────────────────────────────────────────────┘
```

Banner sits above the readiness card, dismissible only by completing the run (or tapping "Skip calibration" → suppresses for 7 days).

### Watch app prompt (iPhone TASK iOS3 from onboarding-master-execution)

When the runner starts their first workout AND voiceBand === calibration AND no calibration row:

```
TODAY · CALIBRATION RUN

Run 3 mi at easy effort.
No pace targets — we'll learn yours.

[ START ]    [ Just run ]
```

Both buttons start the workout. The difference is whether a `calibration_sessions` row gets stamped.

### Voice band transition

On run-complete write, if `calibration_sessions` for this runner has `completed_at IS NULL` AND today's run meets the calibration criteria (≥2mi, even pacing, no race effort):

- Mark `completed_at = NOW()`
- Compute `calibrated_easy_pace_s_per_mi` + confidence (see §Engine)
- Write a `coach_intent` row with `reason='calibration_completed'`
- Next morning brief transitions `voiceBand` from `calibration` → `guided`

If the runner taps "Just run" instead of "Start calibration," the calibration STILL completes on the run write — we just use the first-run pace + HR drift with a slightly wider confidence band (±20s vs ±15s).

---

## Engine

### Module · `lib/coach/calibration.ts`

```ts
export interface CalibrationResult {
  calibratedEasyPaceSPerMi: number;
  confidence: number;          // 0-1
  pillars: {
    miles2to3AvgPaceSPerMi: number;
    paceVarianceSPerMi: number;
    hrDriftBpmPerMi: number | null;
    runDistanceMi: number;
    qualified: boolean;        // false → wide band, fallback path
  };
}

export async function startCalibrationSession(
  userUuid: string,
): Promise<{ id: number }>;

export async function completeCalibrationSession(
  userUuid: string,
  runId: string,
): Promise<CalibrationResult>;

export async function calibrationStatus(
  userUuid: string,
): Promise<'pending' | 'in_progress' | 'completed' | 'skipped'>;
```

### Read paths

`completeCalibrationSession` queries:

1. **The matching run** · `runs.data` for `runId` · pulls `distanceMi`, `splits[]`, `avgHr`
2. **HR baseline** · already on CoachState from state-loader
3. **Pace variance** · `splits[].paceSPerMi` standard deviation across miles 2-3 (or 1-3 on a 3mi run)

### Computation

```ts
// Miles 2-3 avg pace · skips mile 1 (warmup variance is too high)
const targetMiles = distanceMi >= 3 ? [1, 2] : [0, 1];  // 0-indexed
const targetSplits = splits.slice(targetMiles[0], targetMiles[1] + 1);
const miles2to3AvgPaceSPerMi = Math.round(
  targetSplits.reduce((s, x) => s + x.paceSPerMi, 0) / targetSplits.length
);

// Pace variance · how steady was the effort?
const variance = stddev(targetSplits.map(s => s.paceSPerMi));

// HR drift · mile-3 HR vs mile-1 HR (cardiac drift sentinel)
const hrDrift = (splits[2]?.hr ?? splits[1]?.hr ?? null) - (splits[0]?.hr ?? null);
const hrDriftPerMi = hrDrift != null ? hrDrift / 2 : null;

// Confidence weighting
//   · qualified = distance ≥ 2mi AND variance ≤ 30s AND HR drift ≤ 5bpm/mi
//   · qualified → confidence 0.7, band ±15s
//   · unqualified but completed → confidence 0.45, band ±20s
//   · uncompleted (skipped, walked away) → no calibration row
const qualified = distanceMi >= 2 && variance <= 30 && (hrDriftPerMi ?? 0) <= 5;
const confidence = qualified ? 0.7 : 0.45;
```

### Wide-band fallback

When the runner didn't tap "Start calibration" — we still calibrate from the first qualifying run that lands within 14 days of `voiceBand === 'calibration'` going active. Same math, wider band:

```ts
if (!hadStartTap) {
  confidence -= 0.10;  // tighter floor
  band += 5;           // ±20s instead of ±15s
}
```

---

## Storage

### New table · `calibration_sessions`

```sql
CREATE TABLE calibration_sessions (
  id            SERIAL PRIMARY KEY,
  user_uuid     UUID NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  skipped_at    TIMESTAMPTZ,             -- runner explicitly dismissed
  run_id        TEXT,                     -- references runs.data->>'id'
  calibrated_easy_pace_s_per_mi  INT,
  confidence    DECIMAL(3,2),             -- 0-1
  pillars       JSONB,                    -- shape from CalibrationResult.pillars
  was_start_tapped BOOLEAN DEFAULT false  -- "Start calibration" vs "Just run"
);
CREATE INDEX idx_cal_sessions_user ON calibration_sessions (user_uuid);
CREATE UNIQUE INDEX idx_cal_sessions_active ON calibration_sessions (user_uuid)
  WHERE completed_at IS NULL AND skipped_at IS NULL;
-- One active session per runner (partial unique index)
```

The partial unique index prevents duplicate "in_progress" rows if the start tap races with the watch-app prompt.

### Coach intent on completion

```sql
INSERT INTO coach_intents (user_uuid, ts, reason, field, value, payload)
VALUES (
  $1, NOW(), 'calibration_completed',
  'easyPaceSPerMi', $2,
  jsonb_build_object(
    'confidence', $3,
    'sessionId', $4,
    'wasStartTapped', $5
  )
);
```

This intent triggers the voice band recompute → calibration → guided.

---

## API surface

```
POST /api/coach/calibration/start
  body: { runIdHint?: string }
  → 201 { sessionId: number }
  Idempotent · returning the existing session if one is in_progress.

POST /api/coach/calibration/complete
  body: { runId: string }
  → 200 { result: CalibrationResult } | 202 { reason: 'unqualified', fallback: 'wide_band' }
  Auto-fired from the run-write pipeline · also callable manually.

DELETE /api/coach/calibration?sessionId=X
  → 200 { ok: true }
  "Skip calibration" path · marks skipped_at, suppresses prompt for 7 days.

GET /api/coach/calibration/status
  → { status: 'pending' | 'in_progress' | 'completed' | 'skipped',
      band: { lowSPerMi, highSPerMi } | null,
      confidence: number | null,
      completedAt: string | null }
```

---

## Edge cases

| Scenario | Behavior |
|---|---|
| Runner is mid-calibration when they skip | Session row marked skipped_at · prompt suppressed 7 days |
| Runner runs a tempo or race instead of easy on the first try | `qualified=false` because pace variance + HR drift fail thresholds · session stays in_progress · next easy run qualifies |
| Runner does a treadmill run (no splits) | Falls back to whole-run avg pace · `confidence=0.40`, band ±25s |
| Apple Watch only (no Strava, no per-split data) | HK ingest now writes splits (per the 67 task in your history) · same path |
| Calibration sits incomplete > 21 days | Suppress the prompt entirely · runner's plan continues with calibration-mode voice · auto-completes on next qualifying run |
| Runner finishes calibration THEN connects Strava with months of history | Calibration result stays · Strava history becomes the broader baseline · voice band can step to guided if pre-existing data warrants |
| Second-time onboarder (e.g. comes back after a year off) | Forces fresh calibration · old session row archived |
| Runner does the calibration run faster than their goal-time pace | Voice intent fires: "you ran 8:15 easy · faster than the 8:30 goal pace, which is unusual · I'll re-anchor unless you tell me otherwise" |

---

## Voice band integration

`voice-band.ts` reads `calibration_sessions` as a SECOND signal alongside race history:

```ts
const calibration = await pool.query(
  `SELECT calibrated_easy_pace_s_per_mi, confidence
     FROM calibration_sessions
    WHERE user_uuid = $1 AND completed_at IS NOT NULL
    ORDER BY completed_at DESC LIMIT 1`,
  [userUuid]
).then(r => r.rows[0] ?? null);

// Calibration completed → can step calibration → guided immediately,
// even without race history.
if (band === 'calibration' && calibration?.confidence >= 0.45) {
  band = 'guided';
  reasons.push('calibration_completed');
}
```

---

## First-morning copy (calibration mode)

The first morning brief above the readiness card (per onboarding decision #5):

```
Day 1 · I don't know your easy pace yet.

Today's run is a calibration · pick a pace that feels honestly easy
and we'll learn from miles 2-3. After that I'll have your real
baseline and the rest of the plan tunes to you.
```

After the calibration run completes:

```
Calibration done · easy pace looks like 8:30 ± 15s.

Today's easy 4mi targets 8:30. I'll tighten the band after a few
more runs at this effort.
```

---

## What this brief is NOT

- Not a watch-app UX spec · iPhone agent owns watch surface
- Not a multi-source-calibration spec · we calibrate from ONE qualifying run, not a rolling average (that's drift, not calibration)
- Not a re-calibration scheduler · once calibrated, the runner's pace is anchored · drift detection handles ongoing changes
- Not a heart-rate-zone calibration · just easy pace · zones come from LTHR + max HR which have their own pipelines

---

## Build order (when David clears it)

1. Migration · `calibration_sessions` table + indexes
2. `lib/coach/calibration.ts` engine
3. `POST /api/coach/calibration/start` + `/complete` + `/status` + `DELETE`
4. Run-write pipeline hook · auto-fire `completeCalibrationSession` on watch/Strava write when an in_progress row exists
5. Wire CoachState.voiceBand to read calibration_sessions (voice-band module · shipping now per task #180)
6. Today screen banner (web) · gates on calibrationStatus
7. iPhone watch prompt · per onboarding-master-execution iOS3

Steps 1-5 are backend, can ship in one PR. Steps 6-7 are client-side.

---

## Open questions

1. **Calibration distance floor** · 2mi or 3mi for a qualifying run? Current draft says 2mi to be lenient on short-day runners.
2. **Multiple distances** · should we calibrate a separate easy band for longer runs (>8mi) vs short (≤5mi)? Current draft says one band only — long-run pace derives from easy + a fixed offset.
3. **Re-calibration trigger** · if the runner consistently runs 30s+ off the calibrated easy pace for 14 days, should we offer a re-calibration prompt? Or let drift detection handle it?
4. **Watch app: where exactly the prompt lives** · "Start workout" → list of workouts, calibration is a special entry? Or a banner above the list? iPhone agent's call.

---

## Citations

- Daniels Running Formula 3e · easy-pace doctrine
- Pfitzinger Faster Road Racing · § "Honest easy"
- McMillan · pace zone derivation
- `docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md` · Universal applicability
- `designs/briefs/onboarding-master.md` § Skip-all path · decision #3
- `designs/briefs/onboarding-master-execution.md` § TASK B7
