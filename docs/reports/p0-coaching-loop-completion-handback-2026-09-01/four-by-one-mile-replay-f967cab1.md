# 2026-09-01 · 4×1 mi @ T pace · 1 min jog — every consumer

Owner `0645f40c-951d-4ccc-b86e-9979cd26c795`, canonical `runs` row `-258355938987883`.

## 0 · What is stored (BEFORE — the watch build that recorded it)

| # | phase | dur | dist | target | actual | avgHr | inTol | outTol | stored verdict |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Warm-up | 1084s | 2.1 | 502 | 516 | 140 | 990 | 55 | **hit** |
| 1 | Interval · 1 mi | 424s | 1.01 | 430 | 422 | 158 | 120 | 295 | **drifted** |
| 2 | Jog 1 min | 61s | 0.12 | — | 515 | 158 | — | — | **—** |
| 3 | Interval · 1 mi | 431s | 1.01 | 430 | 429 | 161 | 240 | 180 | **drifted** |
| 4 | Jog 1 min | 64s | 0.08 | — | 785 | 156 | — | — | **—** |
| 5 | Interval · 1 mi | 423s | 1 | 430 | 422 | 164 | 145 | 270 | **drifted** |
| 6 | Jog 1 min | 64s | 0.06 | — | 1034 | 157 | — | — | **—** |
| 7 | Interval · 1 mi | 422s | 1.01 | 430 | 419 | 166 | 85 | 325 | **missed** |
| 8 | Cool-down | 1125s | 2.11 | 502 | 534 | 153 | 910 | 180 | **missed** |

Note: the row carries NO `tolerancePaceSPerMi` and NO `paceShape` — it
predates both fields — so every consumer below is exercising the
LEGACY-payload path, which is what every already-deployed watch sends.

## 1 · Activity Interpreter (`classifyStoredActivity`)

```json
{
  "modelVersion": "1.0.0",
  "activityId": "0645f40c-951d-4ccc-b86e-9979cd26c795-2026-09-01#0920",
  "date": "2026-09-01",
  "eligibility": {
    "admissible": true,
    "signals": {
      "distance": "high",
      "duration": "high",
      "pace": "moderate_high",
      "hr": "high",
      "power": "moderate",
      "dynamics": "moderate"
    },
    "signalReasons": [
      "PACE_STABILITY_CONFIRMED_BY_SPLITS",
      "POWER_STABILITY_UNVERIFIABLE_WITHOUT_SPLITS",
      "DYNAMICS_PRESENT_NOT_SURFACED"
    ],
    "continuity": {
      "grain": "per_split",
      "grade": "high",
      "weight": 0.9719717280038996,
      "unaccountedSec": 23,
      "unaccountedFraction": 0.005605654399220083,
      "interruptedSplitIndices": [],
      "reasons": [
        "SPLIT_TIMES_LEAVE_ACTIVITY_TIME_UNACCOUNTED",
        "NO_INTERRUPTION_SHAPED_SPLITS_AT_THIS_GRANULARITY"
      ]
    },
    "rejections": []
  },
  "environment": {
    "tempF": 69.3,
    "humidityPct": 70,
    "dewpointF": 59.09698499898506,
    "slowdownPct": 3.9247391666666664,
    "load": "moderate",
    "hrConfoundWeight": 0.26164927777777774,
    "hrCostPlausiblyElevated": true,
    "reasons": [
      "DEWPOINT_ESTIMATED_FROM_HUMIDITY",
      "CONDITIONS_MAKE_ELEVATED_HR_PLAUSIBLE"
    ]
  },
  "plannedIntent": "THRESHOLD",
  "observedExecution": "MIXED",
  "executionDivergedFromIntent": true,
  "executionQuality": "controlled",
  "structured": true,
  "segments": [
    {
      "index": 1,
      "splitIndices": [
        1,
        2
      ],
      "startSec": 0,
      "endSec": 1035,
      "spanSec": 1035,
      "distanceMi": 2,
      "meanPaceSecPerMi": 518,
      "meanHrBpm": 139.5,
      "meanPowerW": null,
      "hrZoneIdx": 1,
      "relativeIntensity": 1,
      "classification": "recovery",
      "confidence": 0.9683,
      "accumulatedMinutesBefore": 0,
      "underAccumulatedLoad": false,
      "reasons": [
        "NO_POWER_RECORDED_FOR_THIS_ACTIVITY"
      ]
    },
    {
      "index": 2,
      "splitIndices": [
        3,
        4,
        5,
        6
      ],
      "startSec": 1035,
      "endSec": 2809,
      "spanSec": 1774,
      "distanceMi": 4,
      "meanPaceSecPerMi": 444,
      "meanHrBpm": 160.5,
      "meanPowerW": null,
      "hrZoneIdx": 4,
      "relativeIntensity": 1.1669,
      "classification": "threshold_like",
      "confidence": 0.9445,
      "accumulatedMinutesBefo
```

## 2 · Run Detail (`mapWatchPhases` → `phase_breakdown`)

| # | type | target | actual | tol (AFTER) | shape (AFTER) | status BEFORE | status AFTER | label AFTER | watch verdict (stored) |
|---|---|---|---|---|---|---|---|---|---|
| 0 | warmup | 502 | 8:36 | 30 | ceiling | slow | **on** | Under the ceiling | hit |
| 1 | work | 430 | 7:02 | 8 | window | on | **on** | On target | drifted |
| 2 | recovery | — | 8:35 | — | none | — | **—** | — | — |
| 3 | work | 430 | 7:09 | 8 | window | on | **on** | On target | drifted |
| 4 | recovery | — | 13:05 | — | none | — | **—** | — | — |
| 5 | work | 430 | 7:02 | 8 | window | on | **on** | On target | drifted |
| 6 | recovery | — | 17:14 | — | none | — | **—** | — | — |
| 7 | work | 430 | 6:59 | 8 | window | fast | **fast** | Quicker than target | missed |
| 8 | cooldown | 502 | 8:54 | 30 | ceiling | slow | **on** | Under the ceiling | missed |

## 3 · The new wrist grader, replayed on the nine real phases

| # | type | target | actual | shape | AFTER | reads as | BEFORE (stored) |
|---|---|---|---|---|---|---|---|
| 0 | warmup | 502 | 516 | ceiling | **hit** | Under the ceiling | hit |
| 1 | work | 430 | 422 | window | **hit** | On target | drifted |
| 2 | recovery | — | 515 | none | **not_graded** | (nothing said) | — |
| 3 | work | 430 | 429 | window | **hit** | On target | drifted |
| 4 | recovery | — | 785 | none | **not_graded** | (nothing said) | — |
| 5 | work | 430 | 422 | window | **hit** | On target | drifted |
| 6 | recovery | — | 1034 | none | **not_graded** | (nothing said) | — |
| 7 | work | 430 | 419 | window | **fast** | Quicker than target | missed |
| 8 | cooldown | 502 | 534 | ceiling | **hit** | Under the ceiling | missed |

```json
{
  "verdict": "executed",
  "workVerdicts": [
    "hit",
    "hit",
    "hit",
    "fast"
  ],
  "hits": 3,
  "fasts": 1,
  "graded": 4,
  "lateCollapse": false,
  "recoveriesHonest": true
}
```

## 4 · Execution reconstruction + interpretation (`loadKeySessionExecutions`)

```json
{
  "dateISO": "2026-09-01",
  "type": "threshold",
  "planned": {
    "domain": "threshold",
    "workMinutes": 28.666666666666668,
    "workMi": 4,
    "meanWorkPaceSPerMi": 430,
    "recoveryIntent": "incomplete"
  },
  "plannedBasis": "expanded-spec",
  "actual": {
    "domain": "threshold",
    "workMinutes": 28.333333333333332,
    "workMi": 4.03,
    "meanWorkPaceSPerMi": 421.83622828784115,
    "recoveryIntent": "incomplete"
  },
  "actualBasis": "watch-phases",
  "readable": true,
  "read": {
    "state": "AS_PLANNED",
    "stimulusCompletion": 1,
    "evidence": {
      "execution": "full",
      "adaptation": "positive",
      "fitness": "moderate",
      "risk": "none"
    },
    "why": "Ran as prescribed."
  },
  "earnsProgression": true,
  "watchStatus": "completed",
  "toleranceShare": 0.35542168674698793,
  "workVerdicts": [
    "drifted",
    "drifted",
    "drifted",
    "missed"
  ],
  "establishedPaceSPerMi": 430,
  "replacedByRace": false
}
```

## 5 · Recap (`deriveRecap`)

Work-phase mean pace: **423 s/mi** against a 430 target.

**AFTER** (with the LTHR threaded, three arms):

> Tempo done.
> Tempo done · 4 mi @ 7:03 · avg HR 162 across the 4 reps.
> Ran 7s/mi under the target with the effort sitting just under the threshold seam · that pace cost less than the model expected. Worth a retest before it counts as a new number. consistent.

**BEFORE** is the same call with no `lthrBpm` — which is what the old
code did structurally, since it fed `plannedHrCap` into the band and
had only two arms. Shown for contrast:

> Tempo done.
> Tempo done · 4 mi @ 7:03 · avg HR 162 across the 4 reps.
> Ran 7s/mi under the target · no heart rate to say whether that was fitness or just a hot start. The test is stacking the next eight weeks, not winning today. consistent.

## 6 · Training influence (`composeTrainingInfluence`)

```json
{
  "kind": "on_track",
  "copy": "Threshold pace hit. Race-pace work compounding."
}
```

## 7 · Evidence / Targets test point (`judgeTestPointExecution`)

```json
{
  "actualS": 423,
  "verdict": "on",
  "basis": "work-phase-watch"
}
```

