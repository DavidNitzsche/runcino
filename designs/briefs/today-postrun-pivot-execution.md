# Today screen · post-run pivot · iPhone EXECUTION brief

**Pairs with:** `designs/briefs/today-postrun-pivot.md` (design spec)
**Author:** backend
**For:** iPhone agent
**Status:** ready to build

This brief tells you HOW to build what the design brief specifies WHAT to build. Read the design brief first for the user-facing rationale + visual layout. This brief covers the engineering work split: backend module + endpoint changes, iOS state machine + view components, data contract, build order, verification.

---

## What's already shipped (no new work needed)

| Concern | Existing module | What it gives you |
|---|---|---|
| Banister CTL/ATL/TSB | `lib/coach/training-form.ts` | `computeTrainingForm(uuid)` → `{ctl, atl, tsb, trend7, label}` |
| Readiness pillars | `lib/coach/readiness-brief.ts` | `loadReadinessBrief(uuid, state)` → sleep, HRV, RHR, load with deltas + projections |
| Today's session synthesis | `lib/coach/run-recap.ts` + `lib/coach/run-win.ts` | win line + TSS estimate for a completed run |
| Cross-metric narrative | `lib/coach/synthesis.ts` | engine-authored copy weaving multiple signals |
| Goal-gap arc direction | `lib/plan/goal-gap.ts` | `computeGoalGap(uuid)` → `{status, trajectorySec, gapSec}` |
| Next quality workout | `lib/coach/training-state.ts` | `nextQuality: {date, type, label, mi}` on TrainingState |
| Weekly mileage progress | `lib/coach/training-state.ts` | `weekDone` + `weekPlanned` |
| Doctrine source | `Research/00b-recovery-protocols.md` | sleep extension table, HRV/RHR windows |

Backend already exposes ~80% of what the new view needs. The new module composes those into a recovery-side authored payload.

---

## Backend work · 3 tasks

### TASK B1 · `lib/coach/recovery-brief.ts` (new module · ~180 lines)

Mirror `readiness-brief.ts`. One async function takes `userUuid` + the current `CoachState`, returns:

```ts
export interface RecoveryBrief {
  mode: 'standard' | 'long_run';
  score: number;                              // 0-100
  band: 'recovered' | 'recovering' | 'dragging' | 'depleted';
  oneLine: string;                            // engine-authored, ≤ 90 chars
  bigCopy: string;                            // 2-line headline

  pillars: {
    sleepTarget: {
      hoursTarget: number;                    // 8.5
      hoursDelta: number;                     // +0.75 vs personal avg
      reason: string;
    };
    hrvRebound: {
      currentDrop: number;                    // ms drop vs 14d baseline
      projectedReturnISO: string;
      pct: number;                            // 0-100 recovery progress
    };
    rhrDelta: {
      currentBpm: number;
      baselineBpm: number;
      projectedMorningBpm: number;
      pct: number;
    };
    fueling: {
      windowState: 'open' | 'closing' | 'closed';
      minutesRemaining: number | null;
      pct: number;
    };
  };

  trainingInput: {
    tssDelta: number;
    formDelta: number;
    formBandLabel: 'OPTIMAL' | 'PRODUCTIVE' | 'OVERREACH' | 'FRESH';
    arcDirection: 'on_track' | 'flat' | 'slipping';
  };

  nextHard: {
    type: string;
    dateISO: string;
    label: string;                            // "THU TEMPO"
    hoursUntil: number;
    trajectoryChip: string;                   // 3-7 words
  };

  weekProgress: {
    bankedMi: number;
    targetMi: number;
    dots: number;                             // filled-dot count out of 7
    longRun: { dateISO: string; mi: number; daysUntil: number } | null;
    acwr: { value: number; band: 'OK' | 'WATCH' | 'RAMP_UP' };
  };
}
```

**Pattern:** wraps existing modules. Returns null on cold-start. Authored copy lives in pure functions at the bottom (`authorOneLine`, `authorBigCopy`, `authorTrajectoryChip`) so unit tests can assert wording.

**Long-run variant:** when triggered with `mode='long_run'`, sleep target bumps to 9.0-9.5h, fueling pillar switches to 24h carb-window framing, trajectory chip authoring uses "Monday's easy will determine Tuesday quality" pattern.

**Score weighting:** HRV 45% · RHR 25% · TSB 20% · sleep adequacy 10%.

### TASK B2 · `coach_state` flags (~6 lines)

Add to `CoachState` (`lib/coach/state-loader.ts`):

```ts
todayRunDone: boolean;     // any run today > 1mi OR plan_workouts done
todayRunLong: boolean;     // todayRunDone === true AND ≥80% of prescribed long
```

Computed at state-load time. No new DB columns.

```sql
-- todayRunDone
SELECT EXISTS (
  SELECT 1 FROM runs
   WHERE user_uuid = $1
     AND COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date = CURRENT_DATE
     AND (data->>'distanceMi')::numeric > 1
     AND NOT (data ? 'mergedIntoId')
)

-- todayRunLong
SELECT EXISTS (
  SELECT 1
    FROM plan_workouts pw
    JOIN training_plans tp ON tp.id = pw.plan_id
    JOIN runs r ON r.user_uuid = tp.user_uuid::uuid
               AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date = pw.date_iso::date
   WHERE tp.user_uuid = $1
     AND pw.date_iso::date = CURRENT_DATE
     AND pw.type = 'long'
     AND (r.data->>'distanceMi')::numeric >= pw.distance_mi * 0.80
)
```

### TASK B3 · `/api/coach/today` envelope (~10 lines)

Add recovery brief when `todayRunDone === true`:

```ts
return NextResponse.json({
  state,
  readiness: readinessBrief,
  recoveryBrief: state.todayRunDone
    ? await loadRecoveryBrief(userId, state, state.todayRunLong ? 'long_run' : 'standard')
    : null,
  todayRunDone: state.todayRunDone,
  todayRunLong: state.todayRunLong,
});
```

iPhone reads `todayRunDone` to know which mode. `recoveryBrief` is null when morning mode is active.

---

## iOS work · 6 components + 1 state machine

### TASK iOS1 · Mode state machine

`TodayView`:

```swift
enum TodayMode { case morning, postRun, longRunPost }

var mode: TodayMode {
    guard envelope.todayRunDone else { return .morning }
    return envelope.todayRunLong ? .longRunPost : .postRun
}
```

Week strip + bottom workout chip render in ALL modes (no change). Middle content swaps.

**Hard rule:** screen never pivots BACK from postRun to morning within the same day. Once `todayRunDone === true` it stays until midnight rolls.

### TASK iOS2 · Recovery card (section A)

Replaces readiness ring when `mode != .morning`. Same visual weight.

Renders:
- Ring with `recoveryBrief.score` (animated rising arc · see iOS7)
- Band label ("RECOVERED" / "RECOVERING" / "DRAGGING" / "DEPLETED")
- `recoveryBrief.bigCopy` as 2-line headline
- "View full read →" → sheet with breakdown

Color: cooler than morning. Teal `#3FB6B0` base, drifts to amber if score < 60.

### TASK iOS3 · Recovery pillars (section B)

Replaces morning Sleep/HRV/RHR/LOAD bars. Same pillar-bar component, different binding.

| Label | Fill | Subtext |
|---|---|---|
| SLEEP TARGET | `pillars.sleepTarget.hoursTarget / 10 × 100` | "8.5h tonight (+45min)" |
| HRV REBOUND | `pillars.hrvRebound.pct` | "back to base ≈ 7 AM" |
| RHR DELTA | `pillars.rhrDelta.pct` | "+4 bpm · projected 51 by morning" |
| FUELING | `pillars.fueling.pct` | "last carb window in 18 min" / "logged" / "missed" |

### TASK iOS4 · Training input tile (section C)

Single horizontal tile · one row of three values separated by middots:

```
+92 TSS  ·  Form −4 → OPTIMAL band  ·  ↗ ARC
```

Tap → existing block-over-block screen (Power moves #11 already on iOS).

### TASK iOS5 · Next hard + trajectory chip (section D · two tiles)

Replaces BEST WINDOW / TO RACE / NEXT HARD trio. Race countdown moves to header eyebrow.

| Tile | Content |
|---|---|
| NEXT HARD | "THU TEMPO" / "in 47h" |
| TRAJECTORY | "SLEEP TONIGHT MATTERS" (the chip copy) |

### TASK iOS6 · Week progress (section E · three tiles)

Replaces LAST NIGHT / THIS WEEK / VO2 MAX trio in postRun.

| Tile | Content |
|---|---|
| WEEK MI | "28 / 45" + 7-dot row (filled = `dots`) |
| LONG-RUN | "SUN · 12mi" + "in 5 days" |
| ACWR | "1.02" + badge ("OK" / "WATCH" / "RAMP-UP") |

### TASK iOS7 · Transition animations

When `todayRunDone` flips false → true on a refresh:
- 240ms duration
- Old content fades + slides up 8pt
- New content fades + slides up from 8pt below
- Recovery ring fills 0 → score over 600ms easeOut starting at transition midpoint

No blink-swap. Week strip + workout chip don't move.

### TASK iOS8 · Edge case matrix

| Scenario | Mode | Logic |
|---|---|---|
| AM run done at 6am | postRun | Backend flips `todayRunDone` on next refresh |
| Long-run done | longRunPost | Brief returned with `mode: 'long_run'` |
| Strength + run same day | postRun | Run drives · strength TSS in backend |
| Strength only | morning | `todayRunDone` stays false |
| Rest day + tomorrow hard | morning | Backend authors banking-copy readiness one-line |
| Two-a-day after AM | postRun | Stays postRun |
| Two-a-day after PM | postRun | Brief recomputes on next refresh |
| Missed workout | morning | `todayRunDone` stays false |
| Sick / injury | morning | Backend authors hold-frame one-line |

---

## Sample envelope

```json
{
  "state": { "...": "existing CoachState" },
  "readiness": { "...": "existing ReadinessBrief" },
  "todayRunDone": true,
  "todayRunLong": false,
  "recoveryBrief": {
    "mode": "standard",
    "score": 64,
    "band": "recovering",
    "oneLine": "Sleep tonight matters.",
    "bigCopy": "Sleep tonight matters. HRV down 18ms · should rebound to baseline by 7 AM.",
    "pillars": {
      "sleepTarget": { "hoursTarget": 8.5, "hoursDelta": 0.75, "reason": "Pfitz +30-60min after threshold work" },
      "hrvRebound": { "currentDrop": 18, "projectedReturnISO": "2026-06-03T07:00:00-07:00", "pct": 42 },
      "rhrDelta": { "currentBpm": 55, "baselineBpm": 51, "projectedMorningBpm": 51, "pct": 31 },
      "fueling": { "windowState": "closing", "minutesRemaining": 18, "pct": 60 }
    },
    "trainingInput": { "tssDelta": 92, "formDelta": -4, "formBandLabel": "OPTIMAL", "arcDirection": "on_track" },
    "nextHard": { "type": "tempo", "dateISO": "2026-06-04", "label": "THU TEMPO", "hoursUntil": 47, "trajectoryChip": "Sleep tonight matters" },
    "weekProgress": {
      "bankedMi": 28, "targetMi": 45, "dots": 4,
      "longRun": { "dateISO": "2026-06-07", "mi": 12, "daysUntil": 5 },
      "acwr": { "value": 1.02, "band": "OK" }
    }
  }
}
```

---

## Build order

1. **B1** ship `recovery-brief.ts` · unit tests on authored copy
2. **B2** add `todayRunDone` + `todayRunLong` to CoachState
3. **B3** thread recovery brief into `/api/coach/today` · response sample test
4. **iOS1** mode state machine
5. **iOS2-iOS6** render components in mode-conditional branches · feature-flagged
6. **iOS7** transition animation polish
7. **iOS8** verify all 9 edge case scenarios
8. Feature flag off → David review → flag on → ship

---

## Verification

### Backend
- Unit tests on `authorOneLine` / `authorBigCopy` / `authorTrajectoryChip` per band + dominant-pillar combo
- Integration: load brief for David with simulated `todayRunDone=true`, assert envelope shape
- Long-run variant: assert sleep target ≥ 9.0h
- Cold-start: returns null cleanly with no HRV history

### iOS
- Screenshot each mode (morning, postRun, longRunPost)
- Transition animation runs once per state flip, not every refresh
- Week strip + workout chip don't move across mode swaps
- Pull-to-refresh in postRun keeps brief up-to-date (PM run adds TSS)

### End-to-end · David's data
- 6/2 intervals 7.5mi · simulate done → postRun renders
- 6/7 long 12mi · simulate done → longRunPost with sleep target ≥ 9.0
- Rest day → morning persists

---

## Citations

- Pfitzinger Faster Road Racing §"Post-workout recovery monitoring"
- Daniels Running Formula 3rd ed Ch.3 §"Recovery between sessions"
- Hudson Run Faster Ch.6 §"Adaptation indicators"
- Research/00b-recovery-protocols.md §"In-Week Recovery" + §"Sleep — The Highest-ROI Recovery Tool"

---

## Open dependencies

None blocking. The fueling pillar's "logged" / "missed" states need a nutrition log source · V1 ships with `windowState` computed purely from elapsed-time-since-run (open <30min, closing 20-30, closed >30). Future task adds nutrition_log table for "logged" state.
