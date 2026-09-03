# Composed plan snapshot · AFTER (anchored)

mode race-prep · today 2026-09-02 · trailingAvgWeeklyMi 32.5775

## Week summary

| # | Start | Mi | Long | Long purpose | Quality | Rest | Flags |
|---|---|---|---|---|---|---|---|
| 0 | 2026-08-24 | 46.0 | 14.5 | LONG | 2 | 1 | — |
| 1 | 2026-08-31 | 50.0 | 15.0 | LONG | 2 | 1 | — |
| 2 | 2026-09-07 | 24.4 | 6.2 | RACE | 2 | 2 | cutback |
| 3 | 2026-09-14 | 48.0 | 16.5 | LONG | 1 | 1 | — |
| 4 | 2026-09-21 | 56.2 | 17.0 | LONG | 2 | 1 | — |
| 5 | 2026-09-28 | 42.0 | 13.0 | LONG | 1 | 2 | cutback |
| 6 | 2026-10-05 | 59.5 | 18.5 | LONG | 2 | 1 | — |
| 7 | 2026-10-12 | 60.0 | 19.0 | LONG · 4mi @ M + 2mi @ T | 1 | 1 | — |
| 8 | 2026-10-19 | 45.0 | 14.0 | LONG | 2 | 1 | cutback |
| 9 | 2026-10-26 | 59.5 | 20.5 | LONG · 11mi @ MP | 1 | 1 | — |
| 10 | 2026-11-02 | 44.6 | 13.1 | RACE | 2 | 1 | cutback |
| 11 | 2026-11-09 | 40.5 | 16.0 | LONG | 0 | 1 | cutback |
| 12 | 2026-11-16 | 49.0 | 18.0 | LONG | 1 | 1 | — |
| 13 | 2026-11-23 | 36.0 | 13.0 | LONG | 1 | 1 | — |
| 14 | 2026-11-30 | 44.2 | 26.2 | RACE | 2 | 1 | cutback RACE WEEK |

## validateComposedPlan

`validateComposedPlan` returned with **no violations**.

Advisory dosing findings (1):
- `[{"weekStartISO":"2026-11-16","phase":"TAPER","context":"taper","pace":"M","scope":"single-workout","doseMi":11,"weeklyMi":49,"capMi":9.8,"overByMi":1.2,"sharePct":22.45,"basis":"percentage","enforced":false,"message":"Session doses 11 mi at M on 49 mi/wk (22.45%) · doctrine caps it at 9.8 mi (20% of weekly mi)"}]`

## Refusals, fallbacks and uncertainty

- `placement_compromises` = `[{"code":"ACCEPT_AS_HARD_WORKOUT","raceSlug":"dodgers","raceName":"Dodgers","raceDateISO":"2026-09-26","dateISO":"2026-09-27","detail":"17mi long run stands 1 day(s) after Dodgers (6.21mi, C effort) · 23.21mi across the pair","citation":"Research/00b-recovery-protocols.md §\"Hard/Easy Alternation\" (stress block followed by extended recovery) · Research/00b-recovery-protocols.md §\"Recovery by Effort (A vs. B vs. C Race)\" (C race · treat like a hard workout) · Research/22-plan-templates.md §\"Multi-Race Year Planning\" · \"5K-10K Track / Road Series\"","designedWeekend":{"raceSlug":"dodgers","raceName":"Dodgers","raceDateISO":"2026-09-26","raceMi":6.21,"longDateISO":"2026-09-27","longMi":17,"combinedMi":23.21,"gapDays":1,"authoredPurpose":"The race is the quality session and the long run the next morning is the point of it. Racing controlled, then running long on tired legs, is marathon-specific work you cannot get from either day alone.","rationale":"The race is the quality session and the long run the next morning is the point of it. Racing controlled, then running long on tired legs, is marathon-specific work you cannot get from either day alone. You have run 29.4mi across two days before, your longest run is 18mi, and you hold 46.4mi a week. 3 easy days follow.","evidence":{"demonstratedPairMi":29.4,"demonstratedPairFromISO":"2026-04-25","demonstratedLongMi":18,"sustainedWeeklyMi":46.4,"declaredLevel":"advanced","declaredDaysPerWeek":6},"recoveryDaysAfter":3,"prescribedRacePaceSec":435,"citation":"Research/00b-recovery-protocols.md §\"Hard/Easy Alternation\" (stress block followed by extended recovery) · Research/00b-recovery-protocols.md §\"Recovery by Effort (A vs. B vs. C Race)\" (C race · treat like a hard workout) · Research/22-plan-templates.md §\"Multi-Race Year Planning\" · \"5K-10K Track / Road Series\""}}]`
- `ramp_base` = `{"baseMi":44,"meanMi":34.2,"sustainedMi":46.4,"peakMi":52.3,"interruptionWeeks":0.83,"allowedInterruptionWeeks":4,"lifted":false,"heldMi":44,"returning":true,"heldByCurrent":true}`
- `pace_blend` = `{"season_anchor_vdot":47.8,"season_anchor_source":"measured_vdot","season_anchor_provisional":false,"goal_vdot":53.5,"build_weeks":12,"measured_progress_fraction":null}`
- `horizon_raise` = `null`
- `is_mid_block` = `true`
- `recent_avg_mpw` = `34.2`
- `weeklyAvg4w` = `34.2`
- `tier_peak_weekly_band` = `[45,55]`
- `tier_peak_long_band` = `[20,22]`
- not recorded by this run: `travel_shaped`, `goal_vdot_sanity`, `block_anchor`

Full authored_state keys: `block_strategy`, `capacity_tier`, `citations`, `course`, `cutback_every_n`, `derived_from`, `easy_day_median_mi`, `easy_pace_s_per_mi`, `embedded_races`, `goal_pace_s_per_mi`, `goal_tier`, `horizon_raise`, `is_mid_block`, `load_tier_reduced_by_goal`, `long_run_ceiling`, `lthr_bpm`, `pace_blend`, `phase_answers`, `placement_compromises`, `prescribed_race_pace`, `quality_days_planned`, `race_distance_mi`, `ramp_base`, `recent_avg_mpw`, `t_pace_s_per_mi`, `thesis_at_authoring`, `tier_band_anchor`, `tier_peak_long_band`, `tier_peak_weekly_band`, `total_weeks`, `weeklyAvg4w`

## Every week in full

### Week 0 · 2026-08-24 · 46.0 mi 

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | Abort rules |
|---|---|---|---|---|---|---|---|---|
| 2026-08-24 | easy | EASY · 6×20s strides | 5.0 | — | — | — | — | — |
| 2026-08-25 | tempo | 4.5mi continuous wave tempo | 8.5 | — | — | — | — | — |
| 2026-08-26 | easy | EASY · 6×20s strides | 5.0 | — | — | — | — | — |
| 2026-08-27 | intervals | 8×3 min hills @ T-10K effort | 8.0 | — | — | — | — | — |
| 2026-08-28 | easy | EASY | 5.0 | — | — | — | — | — |
| 2026-08-29 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-08-30 | long | LONG | 14.5 | — | — | — | — | — |

### Week 1 · 2026-08-31 · 50.0 mi 

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | Abort rules |
|---|---|---|---|---|---|---|---|---|
| 2026-08-31 | easy | EASY · 6×20s strides | 6.0 | — | — | — | — | — |
| 2026-09-01 | threshold | 5×1mi @ T pace · 60s jog | 9.5 | — | — | — | — | — |
| 2026-09-02 | easy | EASY · 6×20s strides | 6.5 | — | — | — | — | — |
| 2026-09-03 | intervals | 10×60s hills @ 5K-10K effort · 2 min jog down | 6.0 | — | — | — | — | — |
| 2026-09-04 | easy | EASY | 7.0 | — | — | — | — | — |
| 2026-09-05 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-09-06 | long | LONG | 15.0 | — | — | — | — | — |

### Week 2 · 2026-09-07 · 24.4 mi · cutback

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | Abort rules |
|---|---|---|---|---|---|---|---|---|
| 2026-09-07 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-09-08 | tempo | 1.5mi continuous tempo | 5.2 | — | — | — | — | — |
| 2026-09-09 | easy | EASY · 6×20s strides | 5.5 | — | — | — | — | — |
| 2026-09-10 | easy | EASY | 5.5 | — | — | — | — | — |
| 2026-09-11 | shakeout | SHAKEOUT · 4×20s strides | 2.0 | — | — | — | — | — |
| 2026-09-12 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-09-13 | race | RACE | 6.2 | — | — | — | — | — |

### Week 3 · 2026-09-14 · 48.0 mi 

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | Abort rules |
|---|---|---|---|---|---|---|---|---|
| 2026-09-14 | easy | EASY · 6×20s strides | 6.0 | — | — | — | — | — |
| 2026-09-15 | easy | EASY | 5.0 | — | — | — | — | — |
| 2026-09-16 | easy | EASY · 6×20s strides | 6.0 | — | — | — | — | — |
| 2026-09-17 | easy | EASY | 5.0 | — | — | — | — | — |
| 2026-09-18 | threshold | 2×1.5 mi @ T · 3 min jog | 9.5 | — | — | — | — | — |
| 2026-09-19 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-09-20 | long | LONG | 16.5 | — | — | — | — | — |

### Week 4 · 2026-09-21 · 56.2 mi 

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | Abort rules |
|---|---|---|---|---|---|---|---|---|
| 2026-09-21 | easy | EASY · 6×20s strides | 6.0 | — | — | — | — | — |
| 2026-09-22 | tempo | 5mi continuous mile cutdowns | 9.5 | — | — | — | — | — |
| 2026-09-23 | easy | MEDIUM-LONG · 2mi @ T | 10.5 | — | — | — | — | — |
| 2026-09-24 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-09-25 | easy | EASY · 6×20s strides | 7.0 | — | — | — | — | — |
| 2026-09-26 | race | RACE | 6.2 | — | — | — | — | — |
| 2026-09-27 | long | LONG | 17.0 | — | — | — | — | — |

### Week 5 · 2026-09-28 · 42.0 mi · cutback

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | Abort rules |
|---|---|---|---|---|---|---|---|---|
| 2026-09-28 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-09-29 | easy | EASY | 9.0 | — | — | — | — | — |
| 2026-09-30 | easy | EASY · 6×20s strides | 6.0 | — | — | — | — | — |
| 2026-10-01 | intervals | 6×800m @ I pace · 2 min jog | 8.0 | — | — | — | — | — |
| 2026-10-02 | easy | EASY · 6×20s strides | 6.0 | — | — | — | — | — |
| 2026-10-03 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-10-04 | long | LONG | 13.0 | — | — | — | — | — |

### Week 6 · 2026-10-05 · 59.5 mi 

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | Abort rules |
|---|---|---|---|---|---|---|---|---|
| 2026-10-05 | easy | EASY · 6×20s strides | 6.5 | — | — | — | — | — |
| 2026-10-06 | tempo | 4.5mi continuous mile cutdowns | 8.5 | — | — | — | — | — |
| 2026-10-07 | easy | MEDIUM-LONG · 2mi @ T | 12.0 | — | — | — | — | — |
| 2026-10-08 | intervals | 1km @ MP · 60s jog + 1km @ HM · 60s jog + 1km @ T · 60s jog + 1km @ 10K · 60s jog + 1km @ 5K | 6.5 | — | — | — | — | — |
| 2026-10-09 | easy | EASY · 6×20s strides | 7.5 | — | — | — | — | — |
| 2026-10-10 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-10-11 | long | LONG | 18.5 | — | — | — | — | — |

### Week 7 · 2026-10-12 · 60.0 mi 

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | Abort rules |
|---|---|---|---|---|---|---|---|---|
| 2026-10-12 | easy | EASY · 6×20s strides | 8.0 | — | — | — | — | — |
| 2026-10-13 | easy | EASY · 6×20s strides | 8.0 | — | — | — | — | — |
| 2026-10-14 | easy | MEDIUM-LONG | 12.0 | — | — | — | — | — |
| 2026-10-15 | intervals | 2×90s @ 5K · 90s jog + 4×60s @ 5K · 60s jog + 4×30s · 30s jog + 4×15s @ mile · 15s jog | 5.0 | — | — | — | — | — |
| 2026-10-16 | easy | EASY | 8.0 | — | — | — | — | — |
| 2026-10-17 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-10-18 | long | LONG · 4mi @ M + 2mi @ T | 19.0 | — | — | — | — | — |

### Week 8 · 2026-10-19 · 45.0 mi · cutback

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | Abort rules |
|---|---|---|---|---|---|---|---|---|
| 2026-10-19 | easy | EASY · 8×20s strides | 5.0 | — | — | — | — | — |
| 2026-10-20 | tempo | 4.5mi continuous tempo | 8.5 | — | — | — | — | — |
| 2026-10-21 | easy | EASY · 8×20s strides | 5.0 | — | — | — | — | — |
| 2026-10-22 | intervals | 8×3 min @ I pace · 90s jog | 8.0 | — | — | — | — | — |
| 2026-10-23 | easy | EASY | 4.5 | — | — | — | — | — |
| 2026-10-24 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-10-25 | long | LONG | 14.0 | — | — | — | — | — |

### Week 9 · 2026-10-26 · 59.5 mi 

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | Abort rules |
|---|---|---|---|---|---|---|---|---|
| 2026-10-26 | easy | EASY · 8×20s strides | 6.0 | — | — | — | — | — |
| 2026-10-27 | threshold | 1km @ MP+5 · 60s jog + 1km @ MP · 60s jog + 1km @ HM · 60s jog + 1km @ T · 60s jog + 1km @ 10K · 60s jog + 1km @ 5K | 8.0 | — | — | — | — | — |
| 2026-10-28 | easy | MEDIUM-LONG | 11.5 | — | — | — | — | — |
| 2026-10-29 | easy | EASY · 8×20s strides | 6.5 | — | — | — | — | — |
| 2026-10-30 | easy | EASY | 7.0 | — | — | — | — | — |
| 2026-10-31 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-11-01 | long | LONG · 11mi @ MP | 20.5 | — | — | — | — | — |

### Week 10 · 2026-11-02 · 44.6 mi · cutback

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | Abort rules |
|---|---|---|---|---|---|---|---|---|
| 2026-11-02 | easy | EASY · 8×20s strides | 7.0 | — | — | — | — | — |
| 2026-11-03 | tempo | 2.5mi continuous wave tempo | 6.5 | — | — | — | — | — |
| 2026-11-04 | easy | EASY · 8×20s strides | 9.0 | — | — | — | — | — |
| 2026-11-05 | easy | EASY | 7.0 | — | — | — | — | — |
| 2026-11-06 | shakeout | SHAKEOUT · 4×20s strides | 2.0 | — | — | — | — | — |
| 2026-11-07 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-11-08 | race | RACE | 13.1 | — | — | — | — | — |

### Week 11 · 2026-11-09 · 40.5 mi · cutback

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | Abort rules |
|---|---|---|---|---|---|---|---|---|
| 2026-11-09 | easy | EASY · 8×20s strides | 5.0 | — | — | — | — | — |
| 2026-11-10 | easy | EASY | 5.0 | — | — | — | — | — |
| 2026-11-11 | easy | EASY · 8×20s strides | 5.0 | — | — | — | — | — |
| 2026-11-12 | easy | EASY | 5.0 | — | — | — | — | — |
| 2026-11-13 | easy | EASY | 4.5 | — | — | — | — | — |
| 2026-11-14 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-11-15 | long | LONG | 16.0 | — | — | — | — | — |

### Week 12 · 2026-11-16 · 49.0 mi 

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | Abort rules |
|---|---|---|---|---|---|---|---|---|
| 2026-11-16 | easy | EASY · 6×20s strides | 4.0 | — | — | — | — | — |
| 2026-11-17 | tempo | 2.5 mi WU · 11 mi @ MP · 1.5 mi CD | 15.0 | — | — | — | — | — |
| 2026-11-18 | easy | EASY · 6×20s strides | 4.0 | — | — | — | — | — |
| 2026-11-19 | easy | EASY | 4.0 | — | — | — | — | — |
| 2026-11-20 | easy | EASY | 4.0 | — | — | — | — | — |
| 2026-11-21 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-11-22 | long | LONG | 18.0 | — | — | — | — | — |

### Week 13 · 2026-11-23 · 36.0 mi 

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | Abort rules |
|---|---|---|---|---|---|---|---|---|
| 2026-11-23 | easy | EASY · 6×20s strides | 3.5 | — | — | — | — | — |
| 2026-11-24 | tempo | 2 mi WU · 7 mi @ MP · 1 mi CD | 10.0 | — | — | — | — | — |
| 2026-11-25 | easy | EASY · 6×20s strides | 3.5 | — | — | — | — | — |
| 2026-11-26 | easy | EASY | 3.0 | — | — | — | — | — |
| 2026-11-27 | easy | EASY | 3.0 | — | — | — | — | — |
| 2026-11-28 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-11-29 | long | LONG | 13.0 | — | — | — | — | — |

### Week 14 · 2026-11-30 · 44.2 mi · cutback RACE WEEK

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | Abort rules |
|---|---|---|---|---|---|---|---|---|
| 2026-11-30 | easy | EASY · 40 MIN | 4.0 | — | — | — | — | — |
| 2026-12-01 | race_week_tuneup | 5×400m @ 5K pace · 2min jog | 5.0 | — | — | — | — | — |
| 2026-12-02 | easy | EASY · 40 MIN | 4.0 | — | — | — | — | — |
| 2026-12-03 | easy | EASY · 30 MIN | 3.0 | — | — | — | — | — |
| 2026-12-04 | rest | REST | 0.0 | — | — | — | — | — |
| 2026-12-05 | shakeout | SHAKEOUT · 4×20s strides | 2.0 | — | — | — | — | — |
| 2026-12-06 | race | RACE | 26.2 | — | — | — | — | — |

