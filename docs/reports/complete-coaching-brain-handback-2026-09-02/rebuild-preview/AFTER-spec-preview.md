# Spec preview · proofs 8 and 9

Built with `buildWorkoutSpec` — the same function `persistPlan` calls — using the anchors
this compose resolved: T 430s (7:10/mi) · LTHR 168 · maxHR 183 · goal pace 412s.

> **The `Pace` column on a `race` row is not a prediction of the rebuild.**
> This script calls `buildWorkoutSpec` with seven of its twelve arguments.
> `persistPlan` also passes `iPaceSec`, `easyAnchorTSec`, `effortCued`,
> `prescribedRacePaceSec` (RACEPACE-1) and the canonical anchors object.
> Without `prescribedRacePaceSec` the race branch falls back to the stated
> goal pace, which is why every race below reads alike. Race pacing is owned
> by `race-row-refresh`, which runs inside authoring. HR caps, warm-up,
> cool-down and the pass/abort rules read none of the five and are valid.

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | Abort / pass rules |
|---|---|---|---|---|---|---|---|---|
| 2026-09-02 | easy | EASY · 6×20s strides | 6.5 | — | — | — | 151 | — |
| 2026-09-03 | intervals | 10×60s hills @ 5K-10K effort · 2 min jog down | 6.0 | — | 1.5 | 1 | — | pass: Pass: avgHr ≤ 164 on the work · bail: HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-09-04 | easy | EASY | 7.0 | — | — | — | 151 | — |
| 2026-09-05 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-09-06 | long | LONG | 15.0 | 8:23 | — | — | 151 | — |
| 2026-09-07 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-09-08 | tempo | 1.5mi continuous tempo | 5.2 | 7:10 | 1.9 | 1.9 | — | pass: Pass: avgHr ≤ 164 on the work · bail: HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-09-09 | easy | EASY · 6×20s strides | 5.5 | — | — | — | 151 | — |
| 2026-09-10 | easy | EASY | 5.5 | — | — | — | 151 | — |
| 2026-09-11 | shakeout | SHAKEOUT · 4×20s strides | 2.0 | — | — | — | 151 | — |
| 2026-09-12 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-09-13 | race | RACE | 6.2 | _(harness artifact — see note)_ | — | — | — | abort: Mile 2 check: avgHr over 179 · switch to the B plan · abort: Mile 2 check: pace slower than 7:13/mi · switch to the B plan |
| 2026-09-14 | easy | EASY · 6×20s strides | 6.0 | — | — | — | 151 | — |
| 2026-09-15 | easy | EASY | 5.0 | — | — | — | 151 | — |
| 2026-09-16 | easy | EASY · 6×20s strides | 6.0 | — | — | — | 151 | — |
| 2026-09-17 | easy | EASY | 5.0 | — | — | — | 151 | — |
| 2026-09-18 | threshold | 2×1.5 mi @ T · 3 min jog | 9.5 | 7:10 | 3 | 3 | — | pass: Pass: avgHr ≤ 164 on the work · bail: HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-09-19 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-09-20 | long | LONG | 16.5 | 8:23 | — | — | 151 | — |
| 2026-09-21 | easy | EASY · 6×20s strides | 6.0 | — | — | — | 151 | — |
| 2026-09-22 | tempo | 5mi continuous mile cutdowns | 9.5 | 7:10 | 2.3 | 2.3 | — | pass: Pass: avgHr ≤ 164 on the work · bail: HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-09-23 | easy | MEDIUM-LONG | 9.5 | — | — | — | 151 | — |
| 2026-09-24 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-09-25 | easy | EASY · 6×20s strides | 7.0 | — | — | — | 151 | — |
| 2026-09-26 | race | RACE | 6.2 | _(harness artifact — see note)_ | — | — | — | abort: Mile 2 check: avgHr over 179 · switch to the B plan · abort: Mile 2 check: pace slower than 7:13/mi · switch to the B plan |
| 2026-09-27 | long | LONG | 18.0 | 8:23 | — | — | 151 | — |
| 2026-09-28 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-09-29 | threshold | 6×1km @ ST pace · 60s jog | 9.0 | 7:25 | 2.4 | 2.4 | — | pass: Pass: avgHr ≤ 164 on the work · bail: HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-09-30 | easy | EASY · 6×20s strides | 5.0 | — | — | — | 151 | — |
| 2026-10-01 | intervals | 6×800m @ I pace · 2 min jog | 8.0 | 6:52 | 2 | 1.9 | — | pass: Pass: avgHr ≤ 164 on the work · bail: HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-02 | easy | EASY · 6×20s strides | 5.0 | — | — | — | 151 | — |
| 2026-10-03 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-10-04 | long | LONG | 14.0 | 8:23 | — | — | 151 | — |
| 2026-10-05 | easy | EASY · 6×20s strides | 6.5 | — | — | — | 151 | — |
| 2026-10-06 | tempo | 4mi continuous mile cutdowns | 8.0 | 7:10 | 2 | 2 | — | pass: Pass: avgHr ≤ 164 on the work · bail: HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-07 | easy | MEDIUM-LONG · 2mi @ T | 11.5 | — | — | — | 151 | — |
| 2026-10-08 | intervals | 1km @ MP · 60s jog + 1km @ HM · 60s jog + 1km @ T · 60s jog + 1km @ 10K · 60s jog + 1km @ 5K | 6.5 | 7:07 | 1.5 | 1.4 | — | pass: Pass: avgHr ≤ 164 on the work · bail: HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-09 | easy | EASY · 6×20s strides | 7.5 | — | — | — | 151 | — |
| 2026-10-10 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-10-11 | long | LONG | 18.0 | 8:23 | — | — | 151 | — |
| 2026-10-12 | easy | EASY · 6×20s strides | 6.5 | — | — | — | 151 | — |
| 2026-10-13 | easy | EASY · 6×20s strides | 7.5 | — | — | — | 151 | — |
| 2026-10-14 | easy | MEDIUM-LONG | 12.0 | — | — | — | 151 | — |
| 2026-10-15 | intervals | 2×90s @ 5K · 90s jog + 4×60s @ 5K · 60s jog + 4×30s · 30s jog + 4×15s @ mile · 15s jog | 5.0 | 6:47 | 1.5 | 1 | — | pass: Pass: avgHr ≤ 164 on the work · bail: HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-16 | easy | EASY | 8.0 | — | — | — | 151 | — |
| 2026-10-17 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-10-18 | long | LONG · 5mi @ M + 2mi @ T | 19.5 | 8:23 | — | — | 151 | bail: HR over 173 mid-finish · cut the finish in half, jog home |
| 2026-10-19 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-10-20 | tempo | 4.5mi continuous tempo | 8.5 | 7:10 | 2 | 2 | — | pass: Pass: avgHr ≤ 164 on the work · bail: HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-21 | easy | EASY · 8×20s strides | 6.5 | — | — | — | 151 | — |
| 2026-10-22 | intervals | 8×3 min @ I pace · 90s jog | 8.0 | 6:52 | 1.7 | 1.6 | — | pass: Pass: avgHr ≤ 164 on the work · bail: HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-23 | easy | EASY · 8×20s strides | 6.0 | — | — | — | 151 | — |
| 2026-10-24 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-10-25 | long | LONG | 16.0 | 8:23 | — | — | 151 | — |
| 2026-10-26 | easy | EASY · 8×20s strides | 6.0 | — | — | — | 151 | — |
| 2026-10-27 | tempo | 5.5mi continuous wave tempo | 9.5 | 7:10 | 2 | 2 | — | pass: Pass: avgHr ≤ 164 on the work · bail: HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-28 | easy | EASY · 8×20s strides | 7.5 | — | — | — | 151 | — |
| 2026-10-29 | intervals | 8×3 min @ I pace · 90s jog | 8.0 | 6:52 | 1.7 | 1.6 | — | pass: Pass: avgHr ≤ 164 on the work · bail: HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-30 | easy | EASY | 7.0 | — | — | — | 151 | — |
| 2026-10-31 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-11-01 | long | LONG | 20.5 | 8:23 | — | — | 151 | — |
| 2026-11-02 | easy | EASY · 8×20s strides | 6.0 | — | — | — | 151 | — |
| 2026-11-03 | threshold | 3×1mi @ T pace · 60s jog | 8.5 | 7:10 | 2.6 | 2.6 | — | pass: Pass: avgHr ≤ 164 on the work · bail: HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-11-04 | easy | MEDIUM-LONG | 9.5 | — | — | — | 151 | — |
| 2026-11-05 | easy | EASY · 8×20s strides | 6.5 | — | — | — | 151 | — |
| 2026-11-06 | shakeout | SHAKEOUT · 4×20s strides | 2.0 | — | — | — | 151 | — |
| 2026-11-07 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-11-08 | race | RACE | 13.1 | _(harness artifact — see note)_ | — | — | — | abort: Mile 5 check: avgHr over 171 · switch to the B plan · abort: Mile 5 check: pace slower than 7:13/mi · switch to the B plan |
| 2026-11-09 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-11-10 | easy | EASY | 5.0 | — | — | — | 151 | — |
| 2026-11-11 | easy | EASY · 8×20s strides | 6.5 | — | — | — | 151 | — |
| 2026-11-12 | easy | EASY | 5.0 | — | — | — | 151 | — |
| 2026-11-13 | easy | EASY · 8×20s strides | 6.0 | — | — | — | 151 | — |
| 2026-11-14 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-11-15 | long | LONG | 17.0 | 8:23 | — | — | 151 | — |
| 2026-11-16 | easy | EASY · 6×20s strides | 3.0 | — | — | — | 151 | — |
| 2026-11-17 | tempo | 2.5 mi WU · 11 mi @ MP · 1.5 mi CD | 15.0 | 7:28 | 2.5 | 1.5 | — | pass: Pass: avgHr ≤ 164 on the work · bail: HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-11-18 | easy | EASY · 6×20s strides | 3.0 | — | — | — | 151 | — |
| 2026-11-19 | easy | EASY | 3.0 | — | — | — | 151 | — |
| 2026-11-20 | easy | EASY | 3.0 | — | — | — | 151 | — |
| 2026-11-21 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-11-22 | long | LONG | 19.0 | 8:23 | — | — | 151 | — |
| 2026-11-23 | easy | EASY · 6×20s strides | 2.5 | — | — | — | 151 | — |
| 2026-11-24 | tempo | 2 mi WU · 7 mi @ MP · 1 mi CD | 10.0 | 7:28 | 2 | 1 | — | pass: Pass: avgHr ≤ 164 on the work · bail: HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-11-25 | easy | EASY · 6×20s strides | 2.5 | — | — | — | 151 | — |
| 2026-11-26 | easy | EASY | 2.5 | — | — | — | 151 | — |
| 2026-11-27 | easy | EASY | 2.5 | — | — | — | 151 | — |
| 2026-11-28 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-11-29 | long | LONG | 13.5 | 8:23 | — | — | 151 | — |
| 2026-11-30 | easy | EASY · 40 MIN | 4.0 | — | — | — | 151 | — |
| 2026-12-01 | race_week_tuneup | 5×400m @ 5K pace · 2min jog | 5.0 | 6:52 | 1.4 | 1 | — | pass: Pass: avgHr ≤ 164 on the work · bail: HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-12-02 | easy | EASY · 40 MIN | 4.0 | — | — | — | 151 | — |
| 2026-12-03 | easy | EASY · 30 MIN | 3.0 | — | — | — | 151 | — |
| 2026-12-04 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-12-05 | shakeout | SHAKEOUT · 4×20s strides | 2.0 | — | — | — | 151 | — |
| 2026-12-06 | race | RACE | 26.2 | _(harness artifact — see note)_ | — | — | — | abort: Mile 10 check: avgHr over 163 · switch to the B plan · abort: Mile 10 check: pace slower than 7:13/mi · switch to the B plan |

## Coverage

- future rows previewed: **96**
- carrying an HR cap: **57**
- carrying warm-up/cool-down: **17**
- carrying pass/abort rules: **22**
