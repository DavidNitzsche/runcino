# A2 · 4/15 Hill Repeats Signal 3 input investigation

**Status:** complete · 2026-05-19 round 5
**Finding:** workout-name-misleading; Signal 3 made the correct call

## The data

Activity: **2026-04-15 "Hill Repeats" · 6.22 mi · 7 splits**

| Mile | Raw pace | GAP pace | Avg HR | Distortion |
|---|---|---|---|---|
| 1 | 8:03/mi | 7:42/mi | 129 | 21s |
| 2 | 8:19/mi | 8:18/mi | 144 | 1s |
| 3 | 8:46/mi | 8:14/mi | 146 | 32s |
| 4 | 8:46/mi | 8:06/mi | 148 | 40s |
| 5 | 9:28/mi | 7:56/mi | 147 | **92s** |
| 6 | 8:35/mi | 8:11/mi | 151 | 24s |
| 7 | 8:44/mi | 8:44/mi | 155 | 0s |

## Three hypotheses, evaluated

### (a) Workout-name-misleading · "Hill Repeats" was actually tempo / cooldown

**SUPPORTED.** HR pattern is wrong for interval work:

- Intervals produce **HR spikes into Z5** (>167 bpm for David's HRR Z5) followed by recovery dips between work intervals
- This workout shows **monotonic HR build**: 129 → 144 → 146 → 148 → 147 → 151 → 155
- Final mile HR = 155 (Z4 floor 153). The peak of the workout is at Z4 FLOOR.
- No mile crosses into Z5 territory
- Pacing is conversational + slowing — consistent with tempo/long-run on rolling terrain

### (b) Split-classification mishandling work vs recovery intervals

**RULED OUT.** Signal 3's `pickWorkSplits` filter picked only mile 7 because that's the only split where HR landed in Z4-Z5 (155 ≥ 153). The other splits have HR 129-151, all sub-Z4. The picker is doing exactly what it should — looking for high-effort splits and finding only one.

If this WERE intervals with proper Z5 spikes, the picker would catch multiple work splits.

### (c) Genuine data anomaly in Strava export

**PARTIALLY.** One quirk worth flagging: `elev_deltaFt = 0` for every split despite the workout being named "Hill Repeats" AND GAP showing real distortion (mile 5: 92s). Strava's `elevation_difference` field is null/zero here, but `average_grade_adjusted_speed` IS reporting hill corrections.

This isn't a bug in our ingestion — we read `elev_deltaFt` from `elevation_difference`, which Strava is returning as 0/null. Possibly because this activity used elevation correction that Strava doesn't surface per-split. The GAP pace IS picking up the grade since `average_grade_adjusted_speed` differs from raw `elapsed_time / distance`.

So: GAP works, elev_deltaFt is unused-but-zero. No action needed.

## Conclusion

**Signal 3 made the correct call.** The workout was a tempo run on rolling terrain that David named "Hill Repeats." HR pattern doesn't match interval effort. Single Z4-floor split at the end (likely a finishing surge or final hill) produces the "COUNTS · slower" verdict because raw 8:44/mi vs prescribed I-pace 6:41/mi is genuinely slow for VO2/I-pace work.

## No code change needed

Signal 3's gating works as designed:
- Required HR floor for Z4-Z5 work effort: ✅ filters out tempos masquerading as intervals
- GAP-vs-raw comparison: ✅ kicks in only when terrain distortion >20 s/mi
- Volume gate: ✅ only 2 candidates in 6 weeks, below the 3-obs minimum, no fire

## Possible polish (not urgent, queue if more cases surface)

When Signal 3 finds an interval-named workout whose HR pattern doesn't match interval effort (e.g., max HR < Z4 floor, or no Z5 splits), the diagnostic could surface a one-line note: **"workout named 'X' but HR pattern suggests tempo/long-run effort."** Currently the diagnostic shows the workout in observations with NEUTRAL verdict — the message just lives in the data without explicit annotation.

If David starts seeing more "I named this intervals but the system saw it as tempo" cases, that polish could turn into a real coaching nudge. For now, single instance, low priority.

## Lesson

The workout-classification taxonomy is mostly driven by:
1. `plannedWorkoutType` (from plan-match) — most reliable when present
2. Strava `workout_type` = 3 (generic "Workout" tag) — needs additional disambiguation
3. Activity name keywords — convenient but noisy (this case)

The HR pattern check is the load-bearing classifier — it determines what's REALLY interval effort vs. what's named like it. Future Signal 3 work should lean on HR pattern over name, which it already does. The 4/15 case validates that approach.
