# Rebuild preview · AFTER, and the eleven proofs

Composed **read-only** on 2026-09-02 through `composeForUser` with exactly the arguments
`fireAutoRebuild` passes (`{ userId, raceSlug }`), then walked through `persistsComposedDay` and
`persistedDayShape` so every row below is a row that would actually be written.
**Nothing was written. No endpoint was called. `DATABASE_URL` was the read-only role.**

live plan `pln_9a57561debb776e5` · mode `race-prep` · race `cim` · goal date 2026-12-06 · authored Sun Aug 30 2026 20:40:26 GMT-0700 (Pacific Daylight Time)
before: 103 rows across 15 weeks · 2026-08-24 → 2026-12-06
after:  103 rows across 15 weeks · 2026-08-24 → 2026-12-06
composed mode: `race-prep`

## §1 · The eleven proofs

| # | Proof | Verdict | Evidence |
|---|---|---|---|
| | 1 · block stays 15 weeks, 2026-08-24 → 2026-12-06 | **PASS** | 15 weeks · 2026-08-24 → 2026-12-06 |
| | 2 · completed workouts and their historical prescriptions unchanged | **PASS** | all 7 past-dated rows byte-identical |
| | 3 · no completed history regenerated, moved, or reinterpreted | **PASS** | 0 new past-dated rows; 2 composed past days dropped by BACKDATE-1 |
| | 4 · stated 3:00 CIM goal untouched | **PASS** | `races.plan.goal.finish_time_s` = 10800, no authoring path writes `races`, and `race_execution.stated_goal_sec` is identical before and after |
| | 10 · race-day execution distinct from the aspirational goal | **PASS** | CIM: stated 10800 s, executed 11610 s, source `stated_goal_clamped_to_range_edge`; every clamped row keeps the goal and says so; no row changes its source |
| | 5 · weekly-volume trajectory preserved unless justified | **SEE §4** | 13 of 15 weeks move; each named and explained in §4 and §7 |
| | 6 · peak week and longest run intentionally placed | **SEE §5 + §11** | peak week before 61.0 @ wk6 (2026-10-05) · after 58.5 @ wk7 (2026-10-12) | peak long before 21.5 @ wk9 · after 20.5 @ wk9 |
| | 7 · quality, long runs, races, recovery and rest sensibly spaced | **PASS** | no quality on consecutive days and none on a long-run day, in any of the 15 weeks |
| | 8 · corrected workout structures appear in FUTURE sessions | **PASS** | 36 future sessions change structure; 0 past sessions change (must be 0) |
| | 9 · corrected HR targets and race abort rules appear | **SEE §6** | 19 future sessions change HR cap / HR target / abort rules |
| | 11 · plan invariants and the cross-surface contract suite | **SEE §8** | validateComposedPlan run directly: PASS · no violations |

## §2 · Sealed history · the seven past rows, before against after

| Date | Sealed | Before | After | Identical |
|---|---|---|---|---|
| 2026-08-24 | yes | easy 4.0mi pace=— hr_cap=— | easy 4.0mi pace=— hr_cap=— | yes |
| 2026-08-26 | yes | easy 7.0mi pace=— hr_cap=145 | easy 7.0mi pace=— hr_cap=145 | yes |
| 2026-08-27 | yes | easy 7.0mi pace=— hr_cap=145 | easy 7.0mi pace=— hr_cap=145 | yes |
| 2026-08-28 | yes | easy 7.0mi pace=— hr_cap=145 | easy 7.0mi pace=— hr_cap=145 | yes |
| 2026-08-30 | yes | long 13.0mi pace=8:55 hr_cap=145 | long 13.0mi pace=8:55 hr_cap=145 | yes |
| 2026-08-31 | yes | easy 4.5mi pace=— hr_cap=151 | easy 4.5mi pace=— hr_cap=151 | yes |
| 2026-09-01 | yes | threshold 8.5mi pace=7:10 hr_cap=— | threshold 8.5mi pace=7:10 hr_cap=— | yes |

Same-recipe hash over those seven rows · **before** `a75c8a4abcd025d7bad4a8252ac202921523e901d3680d827632f4c1d2846af2` · **after** `a75c8a4abcd025d7bad4a8252ac202921523e901d3680d827632f4c1d2846af2`
· **identical**

This is not the sealed checksum from `SEALED-history-checksum.txt`; its recipe is not committed.
The obligation is met the stronger way instead: the table above compares every field of every past
row, and the production rows themselves are untouched because nothing was written.

## §3 · Week boundaries

| # | Before start | After start | Aligned | Phase before | Phase after |
|---|---|---|---|---|---|
| 0 | 2026-08-24 | 2026-08-24 | yes | phs_91058ab8011460b5 | QUALITY |
| 1 | 2026-08-31 | 2026-08-31 | yes | phs_91058ab8011460b5 | QUALITY |
| 2 | 2026-09-07 | 2026-09-07 | yes | phs_91058ab8011460b5 | QUALITY |
| 3 | 2026-09-14 | 2026-09-14 | yes | phs_91058ab8011460b5 | QUALITY |
| 4 | 2026-09-21 | 2026-09-21 | yes | phs_91058ab8011460b5 | QUALITY |
| 5 | 2026-09-28 | 2026-09-28 | yes | phs_91058ab8011460b5 | QUALITY |
| 6 | 2026-10-05 | 2026-10-05 | yes | phs_91058ab8011460b5 | QUALITY |
| 7 | 2026-10-12 | 2026-10-12 | yes | phs_91058ab8011460b5 | QUALITY |
| 8 | 2026-10-19 | 2026-10-19 | yes | phs_922bfb702760cc83 | RACE-SPECIFIC |
| 9 | 2026-10-26 | 2026-10-26 | yes | phs_922bfb702760cc83 | RACE-SPECIFIC |
| 10 | 2026-11-02 | 2026-11-02 | yes | phs_922bfb702760cc83 | RACE-SPECIFIC |
| 11 | 2026-11-09 | 2026-11-09 | yes | phs_922bfb702760cc83 | RACE-SPECIFIC |
| 12 | 2026-11-16 | 2026-11-16 | yes | phs_ffdd99239ef3c034 | TAPER |
| 13 | 2026-11-23 | 2026-11-23 | yes | phs_ffdd99239ef3c034 | TAPER |
| 14 | 2026-11-30 | 2026-11-30 | yes | phs_ffdd99239ef3c034 | TAPER |

## §4 · All fifteen weeks · before against after

| # | Start | Mi before | Mi after | Δ | Long before | Long after | Long purpose after | Q before | Q after | Rest before | Rest after | Races |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 2026-08-24 | 38.0 | 38.0 | +0.0 | 13.0 | 13.0 | LONG | 0 | 0 | 0 | 0 | — |
| 1 | 2026-08-31 | 45.0 | 46.0 | +1.0 | 15.0 | 15.0 | LONG | 2 | 2 | 1 | 1 | — |
| 2 | 2026-09-07 | 28.9 | 24.4 | -4.5 | — | — | — | 2 | 2 | 1 | 2 | 2026-09-13 RACE |
| 3 | 2026-09-14 | 34.0 | 47.8 | +13.8 | 12.0 | 16.5 | LONG | 1 | 1 | 2 | 1 | — |
| 4 | 2026-09-21 | 48.7 | 56.2 | +7.5 | 15.5 | 18.0 | LONG | 2 | 2 | 1 | 1 | 2026-09-26 RACE |
| 5 | 2026-09-28 | 56.0 | 41.0 | -15.0 | 19.0 | 14.0 | LONG | 2 | 2 | 1 | 2 | — |
| 6 | 2026-10-05 | 61.0 | 58.0 | -3.0 | 20.0 | 18.0 | LONG | 2 | 2 | 1 | 1 | — |
| 7 | 2026-10-12 | 45.5 | 58.5 | +13.0 | 15.0 | 19.5 | LONG · 5mi @ M + 2mi @ T | 2 | 1 | 1 | 1 | — |
| 8 | 2026-10-19 | 60.0 | 45.0 | -15.0 | 19.5 | 16.0 | LONG | 1 | 2 | 1 | 2 | — |
| 9 | 2026-10-26 | 61.0 | 58.5 | -2.5 | 21.5 | 20.5 | LONG | 2 | 2 | 1 | 1 | — |
| 10 | 2026-11-02 | 45.6 | 45.5 | -0.1 | — | — | — | 2 | 2 | 1 | 1 | 2026-11-08 RACE |
| 11 | 2026-11-09 | 44.0 | 39.5 | -4.5 | 16.0 | 17.0 | LONG | 1 | 0 | 1 | 2 | — |
| 12 | 2026-11-16 | 48.0 | 46.0 | -2.0 | 19.0 | 19.0 | LONG | 1 | 1 | 1 | 1 | — |
| 13 | 2026-11-23 | 36.0 | 33.5 | -2.5 | 14.0 | 13.5 | LONG | 1 | 1 | 1 | 1 | — |
| 14 | 2026-11-30 | 43.7 | 43.7 | +0.0 | — | — | — | 2 | 2 | 1 | 1 | 2026-12-06 RACE |

## §5 · Peak placement

Before · peak week **61.0 mi** in week 6 (2026-10-05); weeks carrying the maximum: 6, 9; `is_peak` flagged on week 6.
Before · peak long **21.5 mi** in week 9.
After  · peak week **58.5 mi** in week 7 (2026-10-12); weeks carrying the maximum: 7, 9.
After  · peak long **20.5 mi** in week 9.

## §6 · Future sessions · every material change

added: 0 · removed: 0 · structure changed: 36 · HR or abort changed: 19

| Date | Before | After |
|---|---|---|
| 2026-09-03 | intervals 6.5 · 10×60s hills @ 5K-10K effort · 2 min jog down · pace — · WU 1.5 CD 1 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked | intervals 6.0 · 10×60s hills @ 5K-10K effort · 2 min jog down · pace — · WU 1.5 CD 1 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-09-04 | easy 5.5 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 7.0 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-09-07 | easy 4.5 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | rest 0.0 · REST · pace — · WU — CD — · hr_cap — · hr_tgt — · abort — |
| 2026-09-08 | tempo 6.2 · 2.1 mi WU · 2 mi @ T · 2.1 mi CD · pace 7:10 · WU 2.1 CD 2.1 · hr_cap — · hr_tgt 155 · abort HR over 173 and climbing · finish easy, the stimulus is banked | tempo 5.2 · 1.9 mi WU · 1.4 mi @ T · 1.9 mi CD · pace 7:10 · WU 1.9 CD 1.9 · hr_cap — · hr_tgt 164 · abort HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-09-09 | easy 5.0 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 5.5 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-09-10 | easy 5.0 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 5.5 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-09-20 | long 12.0 · LONG · pace 8:40 · WU — CD — · hr_cap 151 · hr_tgt — · abort — | long 16.5 · LONG · pace 8:40 · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-09-14 | rest 0.0 · REST · pace — · WU — CD — · hr_cap — · hr_tgt — · abort — | easy 6.0 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-09-16 | easy 5.0 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 6.0 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-09-17 | intervals 7.0 · 7×3 min hills @ T-10K effort · pace — · WU 1.5 CD 1 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked | easy 5.0 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-09-18 | easy 5.0 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | threshold 9.3 · 2×1.50 mi @ T pace · 3 min jog · pace 7:10 · WU 3 CD 3 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-09-27 | long 15.5 · LONG · pace 8:40 · WU — CD — · hr_cap 151 · hr_tgt — · abort — | long 18.0 · LONG · pace 8:40 · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-09-21 | easy 4.5 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 6.0 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-09-22 | tempo 9.0 · 2.5 mi WU · 4 mi @ T · 2.5 mi CD · pace 7:10 · WU 2.5 CD 2.5 · hr_cap — · hr_tgt 155 · abort HR over 173 and climbing · finish easy, the stimulus is banked | tempo 9.5 · 2.3 mi WU · 4.9 mi @ T · 2.3 mi CD · pace 7:10 · WU 2.3 CD 2.3 · hr_cap — · hr_tgt 164 · abort HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-09-23 | easy 6.5 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 9.5 · MEDIUM-LONG · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-09-25 | easy 7.0 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 7.0 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-10-04 | long 19.0 · LONG · pace 8:40 · WU — CD — · hr_cap 151 · hr_tgt — · abort — | long 14.0 · LONG · pace 8:40 · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-09-28 | easy 4.5 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | rest 0.0 · REST · pace — · WU — CD — · hr_cap — · hr_tgt — · abort — |
| 2026-09-29 | threshold 10.5 · 9×1km @ ST pace · 60s jog · pace 7:25 · WU 2 CD 2 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked | threshold 9.0 · 6×1km @ ST pace · 60s jog · pace 7:25 · WU 2.4 CD 2.3 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-09-30 | easy 6.5 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 5.0 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-10-01 | intervals 8.5 · 8×800 m @ I · 2 min jog · pace 6:41 · WU 1.5 CD 1.5 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked | intervals 8.0 · 6×800 m @ I · 2 min jog · pace 6:41 · WU 2 CD 1.9 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-02 | easy 7.0 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 5.0 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-10-11 | long 20.0 · LONG · 3.5mi @ M + 1mi @ E + 2mi @ M · pace 8:40 · WU — CD — · hr_cap 151 · hr_tgt — · abort HR over 173 mid-finish · cut the finish in half, jog home | long 18.0 · LONG · pace 8:40 · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-10-05 | easy 4.5 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 6.5 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-10-06 | tempo 9.0 · 2 mi WU · 5 mi @ T · 2 mi CD · pace 7:10 · WU 2 CD 2 · hr_cap — · hr_tgt 155 · abort HR over 173 and climbing · finish easy, the stimulus is banked | tempo 8.0 · 2 mi WU · 4 mi @ T · 2 mi CD · pace 7:10 · WU 2 CD 2 · hr_cap — · hr_tgt 164 · abort HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-07 | easy 12.0 · MEDIUM-LONG · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 11.5 · MEDIUM-LONG · 2mi @ T · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-10-08 | intervals 8.0 · 7×1 km @ I · 1 min jog · pace 6:41 · WU 1.5 CD 1.5 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked | intervals 6.5 · 1km @ MP · 60s jog + 1km @ HM · 60s jog + 1km @ T · 60s jog + 1km @ 10K · 60s jog + 1km @ 5K · pace 7:10 · WU 1.5 CD 1.4 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-09 | easy 7.5 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 7.5 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-10-18 | long 15.0 · LONG · pace 8:40 · WU — CD — · hr_cap 151 · hr_tgt — · abort — | long 19.5 · LONG · 5mi @ M + 2mi @ T · pace 8:40 · WU — CD — · hr_cap 151 · hr_tgt — · abort HR over 173 mid-finish · cut the finish in half, jog home |
| 2026-10-12 | easy 4.5 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 6.5 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-10-13 | threshold 9.0 · 7×1km @ ST pace · 60s jog · pace 7:25 · WU 2 CD 2 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked | easy 7.5 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-10-14 | easy 5.0 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 12.0 · MEDIUM-LONG · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-10-15 | intervals 6.5 · 2×90s @ 5K · 90s jog + 4×60s @ 5K · 60s jog + 4×30s · 30s jog + 4×15s @ mile · 15s jog · pace 6:37 · WU 2 CD 1.9 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked | intervals 5.0 · 2×90s @ 5K · 90s jog + 4×60s @ 5K · 60s jog + 4×30s · 30s jog + 4×15s @ mile · 15s jog · pace 6:37 · WU 1.2 CD 1.2 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-16 | easy 5.5 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 8.0 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-10-25 | long 19.5 · LONG · 11mi @ M · pace 8:40 · WU — CD — · hr_cap 151 · hr_tgt — · abort HR over 173 mid-finish · cut the finish in half, jog home | long 16.0 · LONG · pace 8:40 · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-10-19 | easy 5.0 · EASY · 8×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | rest 0.0 · REST · pace — · WU — CD — · hr_cap — · hr_tgt — · abort — |
| 2026-10-20 | threshold 8.5 · 4×1 mi @ T pace · 1 min jog · pace 7:10 · WU 2.1 CD 2.1 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked | tempo 8.5 · 2 mi WU · 4.5 mi @ T · 2 mi CD · pace 7:10 · WU 2 CD 2 · hr_cap — · hr_tgt 164 · abort HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-21 | easy 12.0 · MEDIUM-LONG · 8×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 6.5 · EASY · 8×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-10-22 | easy 7.5 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | intervals 8.0 · 8×3 min @ I pace · 90s jog · pace 6:41 · WU 1.6 CD 1.6 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-23 | easy 7.5 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 6.0 · EASY · 8×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-11-01 | long 21.5 · LONG · pace 8:40 · WU — CD — · hr_cap 151 · hr_tgt — · abort — | long 20.5 · LONG · pace 8:40 · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-10-26 | easy 4.5 · EASY · 8×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 6.0 · EASY · 8×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-10-27 | tempo 10.0 · 2 mi WU · 6 mi @ T · 2 mi CD · pace 7:10 · WU 2 CD 2 · hr_cap — · hr_tgt 155 · abort HR over 173 and climbing · finish easy, the stimulus is banked | tempo 9.5 · 2 mi WU · 5.5 mi @ T · 2 mi CD · pace 7:10 · WU 2 CD 2 · hr_cap — · hr_tgt 164 · abort HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-28 | easy 9.0 · MEDIUM-LONG · 8×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 7.5 · EASY · 8×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-10-29 | intervals 8.5 · 6×5 min @ I pace · 60s jog · pace 6:41 · WU 1.7 CD 1.8 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked | intervals 8.0 · 8×3 min @ I pace · 90s jog · pace 6:41 · WU 1.6 CD 1.6 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-30 | easy 7.5 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 7.0 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-11-02 | easy 5.0 · EASY · 8×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 6.0 · EASY · 8×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-11-03 | threshold 8.0 · 4×1km · MP → 5K · 60s jog · pace 6:41 · WU 2.6 CD 2.6 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked | threshold 8.4 · 3×1 mi @ T pace · 1 min jog · pace 7:10 · WU 2.6 CD 2.6 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-11-04 | easy 10.0 · MEDIUM-LONG · 8×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 9.5 · MEDIUM-LONG · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-11-05 | easy 7.5 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 6.5 · EASY · 8×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-11-15 | long 16.0 · LONG · 4mi @ M · pace 8:40 · WU — CD — · hr_cap 151 · hr_tgt — · abort HR over 173 mid-finish · cut the finish in half, jog home | long 17.0 · LONG · pace 8:40 · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-11-09 | easy 4.5 · EASY · 8×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | rest 0.0 · REST · pace — · WU — CD — · hr_cap — · hr_tgt — · abort — |
| 2026-11-11 | easy 5.0 · EASY · 8×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 6.5 · EASY · 8×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-11-13 | threshold 8.5 · 2×1.50 mi @ T pace · 3 min jog · pace 7:10 · WU 2.6 CD 2.6 · hr_cap — · hr_tgt — · abort HR over 173 and climbing · finish easy, the stimulus is banked | easy 6.0 · EASY · 8×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-11-16 | easy 3.5 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 3.0 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-11-18 | easy 3.5 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 3.0 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-11-19 | easy 3.5 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 3.0 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-11-20 | easy 3.5 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 3.0 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-11-29 | long 14.0 · LONG · pace 8:40 · WU — CD — · hr_cap 151 · hr_tgt — · abort — | long 13.5 · LONG · pace 8:40 · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-11-23 | easy 3.0 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 2.5 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-11-25 | easy 3.0 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 2.5 · EASY · 6×20s strides · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-11-26 | easy 3.0 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 2.5 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |
| 2026-11-27 | easy 3.0 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — | easy 2.5 · EASY · pace — · WU — CD — · hr_cap 151 · hr_tgt — · abort — |

## §7 · Every week in full · AFTER

### Week 0 · 2026-08-24 · QUALITY · 38.0 mi

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | HR target | Abort rules |
|---|---|---|---|---|---|---|---|---|---|
| 2026-08-30 ✓sealed | long | LONG | 13.0 | 8:55 | — | — | 145 | — | — |
| 2026-08-24 ✓sealed | easy | EASY | 4.0 | — | — | — | — | — | — |
| 2026-08-26 ✓sealed | easy | EASY | 7.0 | — | — | — | 145 | — | — |
| 2026-08-27 ✓sealed | easy | EASY | 7.0 | — | — | — | 145 | — | — |
| 2026-08-28 ✓sealed | easy | EASY | 7.0 | — | — | — | 145 | — | — |

_dropped by BACKDATE-1 (composed onto a past day the runner did not run): 2026-08-25 tempo 8.5mi, 2026-08-29 rest 0mi_

### Week 1 · 2026-08-31 · QUALITY · 46.0 mi

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | HR target | Abort rules |
|---|---|---|---|---|---|---|---|---|---|
| 2026-09-06 | long | LONG | 15.0 | 8:40 | — | — | 151 | — | — |
| 2026-08-31 ✓sealed | easy | EASY · 6×20s strides | 4.5 | — | — | — | 151 | — | — |
| 2026-09-01 ✓sealed | threshold | 4×1 mi @ T pace · 1 min jog | 8.5 | 7:10 | 2.1 | 2.1 | — | — | HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-09-02 ✓sealed | easy | EASY · 6×20s strides | 5.0 | — | — | — | 151 | — | — |
| 2026-09-03 | intervals | 10×60s hills @ 5K-10K effort · 2 min jog down | 6.0 | — | 1.5 | 1 | — | — | HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-09-04 | easy | EASY | 7.0 | — | — | — | 151 | — | — |
| 2026-09-05 | rest | REST | 0.0 | — | — | — | — | — | — |

### Week 2 · 2026-09-07 · QUALITY · 24.4 mi

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | HR target | Abort rules |
|---|---|---|---|---|---|---|---|---|---|
| 2026-09-13 | race | RACE | 6.2 | 6:56 | — | — | — | — | — |
| 2026-09-07 | rest | REST | 0.0 | — | — | — | — | — | — |
| 2026-09-08 | tempo | 1.9 mi WU · 1.4 mi @ T · 1.9 mi CD | 5.2 | 7:10 | 1.9 | 1.9 | — | 164 | HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-09-09 | easy | EASY · 6×20s strides | 5.5 | — | — | — | 151 | — | — |
| 2026-09-10 | easy | EASY | 5.5 | — | — | — | 151 | — | — |
| 2026-09-11 | shakeout | SHAKEOUT · 4×20s strides | 2.0 | — | — | — | 151 | — | — |
| 2026-09-12 | rest | REST | 0.0 | — | — | — | — | — | — |

### Week 3 · 2026-09-14 · QUALITY · 47.8 mi

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | HR target | Abort rules |
|---|---|---|---|---|---|---|---|---|---|
| 2026-09-20 | long | LONG | 16.5 | 8:40 | — | — | 151 | — | — |
| 2026-09-14 | easy | EASY · 6×20s strides | 6.0 | — | — | — | 151 | — | — |
| 2026-09-15 | easy | EASY | 5.0 | — | — | — | 151 | — | — |
| 2026-09-16 | easy | EASY · 6×20s strides | 6.0 | — | — | — | 151 | — | — |
| 2026-09-17 | easy | EASY | 5.0 | — | — | — | 151 | — | — |
| 2026-09-18 | threshold | 2×1.50 mi @ T pace · 3 min jog | 9.3 | 7:10 | 3 | 3 | — | — | HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-09-19 | rest | REST | 0.0 | — | — | — | — | — | — |

### Week 4 · 2026-09-21 · QUALITY · 56.2 mi

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | HR target | Abort rules |
|---|---|---|---|---|---|---|---|---|---|
| 2026-09-27 | long | LONG | 18.0 | 8:40 | — | — | 151 | — | — |
| 2026-09-21 | easy | EASY · 6×20s strides | 6.0 | — | — | — | 151 | — | — |
| 2026-09-22 | tempo | 2.3 mi WU · 4.9 mi @ T · 2.3 mi CD | 9.5 | 7:10 | 2.3 | 2.3 | — | 164 | HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-09-23 | easy | MEDIUM-LONG | 9.5 | — | — | — | 151 | — | — |
| 2026-09-24 | rest | REST | 0.0 | — | — | — | — | — | — |
| 2026-09-25 | easy | EASY · 6×20s strides | 7.0 | — | — | — | 151 | — | — |
| 2026-09-26 | race | RACE | 6.2 | 7:15 | — | — | — | — | — |

### Week 5 · 2026-09-28 · QUALITY · 41.0 mi

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | HR target | Abort rules |
|---|---|---|---|---|---|---|---|---|---|
| 2026-10-04 | long | LONG | 14.0 | 8:40 | — | — | 151 | — | — |
| 2026-09-28 | rest | REST | 0.0 | — | — | — | — | — | — |
| 2026-09-29 | threshold | 6×1km @ ST pace · 60s jog | 9.0 | 7:25 | 2.4 | 2.3 | — | — | HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-09-30 | easy | EASY · 6×20s strides | 5.0 | — | — | — | 151 | — | — |
| 2026-10-01 | intervals | 6×800 m @ I · 2 min jog | 8.0 | 6:41 | 2 | 1.9 | — | — | HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-02 | easy | EASY · 6×20s strides | 5.0 | — | — | — | 151 | — | — |
| 2026-10-03 | rest | REST | 0.0 | — | — | — | — | — | — |

### Week 6 · 2026-10-05 · QUALITY · 58.0 mi

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | HR target | Abort rules |
|---|---|---|---|---|---|---|---|---|---|
| 2026-10-11 | long | LONG | 18.0 | 8:40 | — | — | 151 | — | — |
| 2026-10-05 | easy | EASY · 6×20s strides | 6.5 | — | — | — | 151 | — | — |
| 2026-10-06 | tempo | 2 mi WU · 4 mi @ T · 2 mi CD | 8.0 | 7:10 | 2 | 2 | — | 164 | HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-07 | easy | MEDIUM-LONG · 2mi @ T | 11.5 | — | — | — | 151 | — | — |
| 2026-10-08 | intervals | 1km @ MP · 60s jog + 1km @ HM · 60s jog + 1km @ T · 60s jog + 1km @ 10K · 60s jog + 1km @ 5K | 6.5 | 7:10 | 1.5 | 1.4 | — | — | HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-09 | easy | EASY · 6×20s strides | 7.5 | — | — | — | 151 | — | — |
| 2026-10-10 | rest | REST | 0.0 | — | — | — | — | — | — |

### Week 7 · 2026-10-12 · QUALITY · 58.5 mi

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | HR target | Abort rules |
|---|---|---|---|---|---|---|---|---|---|
| 2026-10-18 | long | LONG · 5mi @ M + 2mi @ T | 19.5 | 8:40 | — | — | 151 | — | HR over 173 mid-finish · cut the finish in half, jog home |
| 2026-10-12 | easy | EASY · 6×20s strides | 6.5 | — | — | — | 151 | — | — |
| 2026-10-13 | easy | EASY · 6×20s strides | 7.5 | — | — | — | 151 | — | — |
| 2026-10-14 | easy | MEDIUM-LONG | 12.0 | — | — | — | 151 | — | — |
| 2026-10-15 | intervals | 2×90s @ 5K · 90s jog + 4×60s @ 5K · 60s jog + 4×30s · 30s jog + 4×15s @ mile · 15s jog | 5.0 | 6:37 | 1.2 | 1.2 | — | — | HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-16 | easy | EASY | 8.0 | — | — | — | 151 | — | — |
| 2026-10-17 | rest | REST | 0.0 | — | — | — | — | — | — |

### Week 8 · 2026-10-19 · RACE-SPECIFIC · 45.0 mi

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | HR target | Abort rules |
|---|---|---|---|---|---|---|---|---|---|
| 2026-10-25 | long | LONG | 16.0 | 8:40 | — | — | 151 | — | — |
| 2026-10-19 | rest | REST | 0.0 | — | — | — | — | — | — |
| 2026-10-20 | tempo | 2 mi WU · 4.5 mi @ T · 2 mi CD | 8.5 | 7:10 | 2 | 2 | — | 164 | HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-21 | easy | EASY · 8×20s strides | 6.5 | — | — | — | 151 | — | — |
| 2026-10-22 | intervals | 8×3 min @ I pace · 90s jog | 8.0 | 6:41 | 1.6 | 1.6 | — | — | HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-23 | easy | EASY · 8×20s strides | 6.0 | — | — | — | 151 | — | — |
| 2026-10-24 | rest | REST | 0.0 | — | — | — | — | — | — |

### Week 9 · 2026-10-26 · RACE-SPECIFIC · 58.5 mi

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | HR target | Abort rules |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-01 | long | LONG | 20.5 | 8:40 | — | — | 151 | — | — |
| 2026-10-26 | easy | EASY · 8×20s strides | 6.0 | — | — | — | 151 | — | — |
| 2026-10-27 | tempo | 2 mi WU · 5.5 mi @ T · 2 mi CD | 9.5 | 7:10 | 2 | 2 | — | 164 | HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-28 | easy | EASY · 8×20s strides | 7.5 | — | — | — | 151 | — | — |
| 2026-10-29 | intervals | 8×3 min @ I pace · 90s jog | 8.0 | 6:41 | 1.6 | 1.6 | — | — | HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-10-30 | easy | EASY | 7.0 | — | — | — | 151 | — | — |
| 2026-10-31 | rest | REST | 0.0 | — | — | — | — | — | — |

### Week 10 · 2026-11-02 · RACE-SPECIFIC · 45.5 mi

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | HR target | Abort rules |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-08 | race | RACE | 13.1 | 7:02 | — | — | — | — | — |
| 2026-11-02 | easy | EASY · 8×20s strides | 6.0 | — | — | — | 151 | — | — |
| 2026-11-03 | threshold | 3×1 mi @ T pace · 1 min jog | 8.4 | 7:10 | 2.6 | 2.6 | — | — | HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-11-04 | easy | MEDIUM-LONG | 9.5 | — | — | — | 151 | — | — |
| 2026-11-05 | easy | EASY · 8×20s strides | 6.5 | — | — | — | 151 | — | — |
| 2026-11-06 | shakeout | SHAKEOUT · 4×20s strides | 2.0 | — | — | — | 151 | — | — |
| 2026-11-07 | rest | REST | 0.0 | — | — | — | — | — | — |

### Week 11 · 2026-11-09 · RACE-SPECIFIC · 39.5 mi

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | HR target | Abort rules |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-15 | long | LONG | 17.0 | 8:40 | — | — | 151 | — | — |
| 2026-11-09 | rest | REST | 0.0 | — | — | — | — | — | — |
| 2026-11-10 | easy | EASY | 5.0 | — | — | — | 151 | — | — |
| 2026-11-11 | easy | EASY · 8×20s strides | 6.5 | — | — | — | 151 | — | — |
| 2026-11-12 | easy | EASY | 5.0 | — | — | — | 151 | — | — |
| 2026-11-13 | easy | EASY · 8×20s strides | 6.0 | — | — | — | 151 | — | — |
| 2026-11-14 | rest | REST | 0.0 | — | — | — | — | — | — |

### Week 12 · 2026-11-16 · TAPER · 46.0 mi

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | HR target | Abort rules |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-22 | long | LONG | 19.0 | 8:40 | — | — | 151 | — | — |
| 2026-11-16 | easy | EASY · 6×20s strides | 3.0 | — | — | — | 151 | — | — |
| 2026-11-17 | tempo | 2.5 mi WU · 11 mi @ MP · 1.5 mi CD | 15.0 | 7:52 | 2.5 | 1.5 | — | — | HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-11-18 | easy | EASY · 6×20s strides | 3.0 | — | — | — | 151 | — | — |
| 2026-11-19 | easy | EASY | 3.0 | — | — | — | 151 | — | — |
| 2026-11-20 | easy | EASY | 3.0 | — | — | — | 151 | — | — |
| 2026-11-21 | rest | REST | 0.0 | — | — | — | — | — | — |

### Week 13 · 2026-11-23 · TAPER · 33.5 mi

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | HR target | Abort rules |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-29 | long | LONG | 13.5 | 8:40 | — | — | 151 | — | — |
| 2026-11-23 | easy | EASY · 6×20s strides | 2.5 | — | — | — | 151 | — | — |
| 2026-11-24 | tempo | 2 mi WU · 7 mi @ MP · 1 mi CD | 10.0 | 7:52 | 2 | 1 | — | — | HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-11-25 | easy | EASY · 6×20s strides | 2.5 | — | — | — | 151 | — | — |
| 2026-11-26 | easy | EASY | 2.5 | — | — | — | 151 | — | — |
| 2026-11-27 | easy | EASY | 2.5 | — | — | — | 151 | — | — |
| 2026-11-28 | rest | REST | 0.0 | — | — | — | — | — | — |

### Week 14 · 2026-11-30 · TAPER · 43.7 mi · RACE WEEK

| Date | Type | Session | Mi | Pace | WU | CD | HR cap | HR target | Abort rules |
|---|---|---|---|---|---|---|---|---|---|
| 2026-12-06 | race | RACE | 26.2 | 7:23 | — | — | — | — | — |
| 2026-11-30 | easy | EASY · 40 MIN | 4.0 | — | — | — | 151 | — | — |
| 2026-12-01 | race_week_tuneup | 5×400m @ 5K pace · 2min jog | 4.5 | 7:23 | 1.4 | 1 | — | — | HR over 173 and climbing · finish easy, the stimulus is banked |
| 2026-12-02 | easy | EASY · 40 MIN | 4.0 | — | — | — | 151 | — | — |
| 2026-12-03 | easy | EASY · 30 MIN | 3.0 | — | — | — | 151 | — | — |
| 2026-12-04 | rest | REST | 0.0 | — | — | — | — | — | — |
| 2026-12-05 | shakeout | SHAKEOUT · 4×20s strides | 2.0 | — | — | — | 151 | — | — |

## §8 · `validateComposedPlan`, run directly against the composed block

```
PASS · no violations
```

Advisory dosing findings: **2**

```
{"weekStartISO":"2026-11-16","phase":"TAPER","context":"taper","pace":"M","scope":"single-workout","doseMi":11,"weeklyMi":46,"capMi":9.2,"overByMi":1.8,"sharePct":23.91,"basis":"percentage","enforced":false,"message":"Session doses 11 mi at M on 46 mi/wk (23.91%) · doctrine caps it at 9.2 mi (20% of weekly mi)"}
{"weekStartISO":"2026-11-23","phase":"TAPER","context":"taper","pace":"M","scope":"single-workout","doseMi":7,"weeklyMi":33.5,"capMi":6.7,"overByMi":0.3,"sharePct":20.9,"basis":"percentage","enforced":false,"message":"Session doses 7 mi at M on 33.5 mi/wk (20.9%) · doctrine caps it at 6.7 mi (20% of weekly mi)"}
```

Advisory combined-stress findings: **0**

## §9 · Every refusal, fallback and stated uncertainty in this generation

**Block anchor**

```
{
 "preserved": true,
 "anchorISO": "2026-08-24",
 "planId": "pln_9a57561debb776e5"
}
```

**Race seed** (`resolveAuthoringRaceSeed`, the owner of the prescribed race target)

```
{
 "ok": true,
 "paceSecPerMi": 443,
 "targetSec": 11610,
 "source": "stated_goal_clamped_to_range_edge"
}
```

**Pace anchors and their confidence** — every price this block was composed at, with how well it is known

```
{
 "thresholdSecPerMi": 430,
 "intervalSecPerMi": 401,
 "repetitionSecPerMi": 365,
 "easyCeilingSecPerMi": 502,
 "shakeoutCeilingSecPerMi": 532,
 "marathonSecPerMi": 472,
 "marathonRangeSecPerMi": [
  460,
  488
 ],
 "basis": {
  "threshold": {
   "sourceMode": "direct",
   "confidence": 0.8351097284105147,
   "vdot": 47.8
  },
  "highIntensity": {
   "sourceMode": "vdot_fallback",
   "confidence": 0.49266459261577195
  },
  "easyCeiling": {
   "sourceMode": "direct",
   "confidence": 0.6328247776315198
  },
  "marathon": {
   "sourceMode": "direct",
   "confidence": 0.8351097284105147,
   "enduranceExponent": 1.082514135966284,
   "personallyEvidenced": true,
   "source": "exponent",
   "demonstratedPaceSecPerMi": null,
   "restsOnOneLongRace": true
  }
 }
}
```

**`authored_state.derived_from`**

```
{
 "recentWeeklyMi": 34.2,
 "recentLongMi": 18,
 "spikeAnchorLongMi": 13.5,
 "recentQualityPerWeek": 1.5,
 "recentQualityDistanceMi": 7.5,
 "bestRecentVdot": 47.7,
 "easyDayMedianMi": 6.5,
 "tsbAtStart": -11
}
```

**`authored_state.ramp_base`**

```
{
 "baseMi": 44,
 "meanMi": 34.2,
 "sustainedMi": 46.4,
 "peakMi": 52.3,
 "interruptionWeeks": 0.83,
 "allowedInterruptionWeeks": 4,
 "lifted": false,
 "heldMi": 44,
 "returning": true,
 "heldByCurrent": true
}
```

**`authored_state.goal_realism`**

```
{
 "flag": false,
 "assessable": true,
 "basis": "measured_vdot",
 "estimatedCurrentVdot": 47.8
}
```

**`authored_state.prescribed_race_pace`**

```
{
 "authority": "provenance_only",
 "anchor_vdot": 47.8,
 "pace_s_per_mi": 412,
 "target_sec": 10800,
 "source": "goal",
 "goal_sec": 10800,
 "goal_pace_s_per_mi": 412,
 "ceiling_sec": 11288,
 "ceiling_vdot": 50.8,
 "optimism_fraction": 0.04323175053153792,
 "basis_modelled": false
}
```

**`authored_state.pace_blend`**

```
{
 "season_anchor_vdot": 47.8,
 "season_anchor_source": "measured_vdot",
 "season_anchor_provisional": false,
 "goal_vdot": 53.5,
 "build_weeks": 12,
 "measured_progress_fraction": null
}
```

**`authored_state.goal_tier`**

```
"advanced"
```

**`authored_state.capacity_tier`**

```
"advanced"
```

**`authored_state.load_tier_reduced_by_goal`**

```
false
```

**`authored_state.tier_peak_weekly_band`**

```
[
 65,
 90
]
```

**`authored_state.tier_peak_long_band`**

```
[
 22,
 24
]
```

**`authored_state.is_mid_block`**

```
true
```

**`authored_state.horizon_raise`**

```
null
```

**`authored_state.embedded_races`**

```
[
 {
  "slug": "santa-monica-10k-2026-09-13",
  "name": "Santa Monica 10k",
  "date": "2026-09-13",
  "distanceMi": 6.2,
  "priority": "B",
  "weekIdx": 2,
  "plannedRole": null
 },
 {
  "slug": "dodgers",
  "name": "Dodgers",
  "date": "2026-09-26",
  "distanceMi": 6.21,
  "priority": "C",
  "weekIdx": 4,
  "plannedRole": null
 },
 {
  "slug": "run-malibu",
  "name": "Run Malibu",
  "date": "2026-11-08",
  "distanceMi": 13.1,
  "priority": "B",
  "weekIdx": 10,
  "plannedRole": null
 }
]
```

**Everything the generator logged while composing** — refusals, seal skips, fallbacks, caps
(verbatim, in order; this is the only place most of them surface)

```
(the generator logged nothing)
```

## §11 · Why the weekly trajectory moved · the justification proof 5 asks for

Every reader the composer sizes a block from has moved **upward** since 2026-08-30, and the
block still comes out lower at its peak. That is not the readers, and it is not the anchor —
it is one threshold.

| Reader | Live plan, authored 2026-08-30 | Composed today | Direction |
|---|---|---|---|
| recentWeeklyMi (28-day mean) | 31.6 | 34.2 | up |
| recentLongMi | 18 | 18 | same |
| spikeAnchorLongMi | 13.5 | 13.5 | same |
| easyDayMedianMi | 6 | 6.5 | up |
| recentQualityPerWeek | 1.5 | 1.5 | same |
| bestRecentVdot | 44.1 | 47.7 | up |
| tsbAtStart | -6 | -11 | down |
| ramp_base.baseMi | 34.7 | 44 | up |
| ramp_base.sustainedMi | 45 | 46.4 | up |
| tier peak weekly band | [65,90] | [65,90] | same |
| tier peak long band | [22,24] | [22,24] | same |

**The mechanism, attributed by measurement rather than by argument.** Two changes to the
engine landed in the three days between this block being authored and today. Reversing them
one at a time, read-only, recovers the live curve — including putting the peak week back on
the live plan's own peak week:

| Engine configuration | Peak week | Peak week lands | Peak long |
|---|---|---|---|
| The stored plan, authored 2026-08-30 | 61.0 | 2026-10-05 | 21.5 |
| **C** · cadence forced to 4 **and** SPIKEROLL-1 off — the engine as it stood at authoring | 60.0 | 2026-10-05 | 22.0 |
| **B** · cadence forced to 4, SPIKEROLL-1 on | 59.0 | 2026-10-26 | 21.0 |
| **A** · the engine as it stands today (what this preview composed) | 58.5 | 2026-10-12 | 20.5 |

Reproduce with `web-v2/.tmpq/cadence2.sh`-style mutations: `cutbackCadence` → `return 4`,
and `enforceSpikeRule();` → `void enforceSpikeRule;`, both in `lib/plan/generate.ts`,
restored with `git checkout --` after each run.

**1 · SPIKEROLL-1 · −1.0 mi peak week, −1.0 mi peak long (C → B).** `ecb5972c` landed
Research/00a's 30-day single-session spike rule — ">110% of the longest run in the prior 30
days = ~64% overuse injury risk" — enforced at final post-taper plan values. It was written
before this block was authored, deliberately held back one cycle, and landed after it. Its own
commit message reports the measurement against THIS block: 2026-10-04 closes from a 123%
breach at 19.0 mi to exactly 110% at 17.0 mi, with the taper weeks following. This is a
doctrine-cited injury guard doing exactly what it was landed to do, and the reduction is the
point of it.

**2 · The cutback cadence · −0.5 mi peak week, −0.5 mi peak long, and the peak slides from
2026-10-05 to 2026-10-12 (B → A).** `cutbackCadence(tsbAtStart)` is `tsbAtStart < -10 ? 3 : 4`
— how many weeks the block climbs before it deloads. His training form read **-6** when this
block was authored and reads **-11** today, so the cadence goes 4 → **3** and the block gains a
fourth cutback. Live cutbacks land on weeks 2, 7, 10; composed they land on 2, 5, 8, 11 — the
positions `(i + 1) % 3 === 0` produces across a 12-week build. This is what moves **13 of the
15 weeks**; the peak cost is small but the re-phasing is not.

**That cadence step is a Rule 9 cliff, and he is one point from it.** TSB is a continuous
daily quantity (CTL − ATL, `computeTrainingForm`). At −10 the block climbs four weeks between
deloads; at −11, three. Nothing interpolates. A single easy day either side changes the block
in kind, and the signature CLAUDE.md names is present: the runner carrying slightly more
fatigue gets a categorically different plan. It is NOT introduced by the anchor — the same
cadence is chosen with or without it, because both read today's training form. It is
REPORTED, not fixed: changing it moves the volume curve for every runner and sits outside the
boundary this pass was given.

**3 · The residual, 60.0 against the live 61.0 (−1.0 mi, 1.6%) and 22.0 against 21.5
(+0.5 mi, higher).** With both changes reversed the composition still is not byte-identical to
the stored plan, and it should not be: every reader has moved. The ramp base is 44.0 against
34.7, threshold VDOT 47.7 against 44.1. Sixty-eight further commits also touched `lib/plan` in
those three days. The residual is under two percent, it is not systematically downward, and
nothing in it is a re-phasing.


## §10 · Goal and race transactions

- `dodgers` · `races.plan.goal.finish_time_s` = **2700** s
- `run-malibu` · `races.plan.goal.finish_time_s` = **5400** s
- `cim` · `races.plan.goal.finish_time_s` = **10800** s
- `santa-monica-10k-2026-09-13` · `races.plan.goal.finish_time_s` = **—** s
- **2026-09-13** `santa-monica-10k-2026-09-13` · applied
  - before · stated_goal_sec **null** · target_sec **2580** · source `expected_race_day` · feasibility `no_goal`
    - reason: "No stated goal · race to where this build is expected to land you."
  - after  · stated_goal_sec **null** · target_sec **2580** · source `expected_race_day` · feasibility `no_goal`
    - reason: "No stated goal · race to where this build is expected to land you."
- **2026-09-26** `dodgers` · applied
  - before · stated_goal_sec **2700** · target_sec **2700** · source `stated_goal_within_range` · feasibility `comfortable`
    - reason: "Your goal is at or slower than the expected result · race to your goal."
  - after  · stated_goal_sec **2700** · target_sec **2700** · source `stated_goal_within_range` · feasibility `comfortable`
    - reason: "Your goal is at or slower than the expected result · race to your goal."
- **2026-11-08** `run-malibu` · applied
  - before · stated_goal_sec **5400** · target_sec **5530** · source `stated_goal_clamped_to_range_edge` · feasibility `aggressive`
    - reason: "Your goal (1:30:00) is faster than the likely range's fast edge (1:32:05) · race to the edge; the goal stays yours."
  - after  · stated_goal_sec **5400** · target_sec **5530** · source `stated_goal_clamped_to_range_edge` · feasibility `aggressive`
    - reason: "Your goal (1:30:00) is faster than the likely range's fast edge (1:32:06) · race to the edge; the goal stays yours."
- **2026-12-06** `cim` · applied
  - before · stated_goal_sec **10800** · target_sec **11610** · source `stated_goal_clamped_to_range_edge` · feasibility `unlikely_currently`
    - reason: "Your goal (3:00:00) is faster than the likely range's fast edge (3:13:27) · race to the edge; the goal stays yours."
  - after  · stated_goal_sec **10800** · target_sec **11610** · source `stated_goal_clamped_to_range_edge` · feasibility `unlikely_currently`
    - reason: "Your goal (3:00:00) is faster than the likely range's fast edge (3:13:28) · race to the edge; the goal stays yours."
- **2026-12-01** `cim` · applied
  - before · stated_goal_sec **10800** · target_sec **11610** · source `stated_goal_clamped_to_range_edge` · feasibility `unlikely_currently`
    - reason: "Your goal (3:00:00) is faster than the likely range's fast edge (3:13:27) · race to the edge; the goal stays yours."
  - after  · stated_goal_sec **10800** · target_sec **11610** · source `stated_goal_clamped_to_range_edge` · feasibility `unlikely_currently`
    - reason: "Your goal (3:00:00) is faster than the likely range's fast edge (3:13:28) · race to the edge; the goal stays yours."

The rebuild path writes no `races` row. `refreshRaceRowsForPlan` — the last writer on a race
row — issues exactly two UPDATE statements, against the plan-day table and the plan table, and
`persistPlan` writes neither the race table nor any goal field. The stated goal is read by the
composer and never written by it.

**`refreshRaceRowsForPlan`, replayed read-only over the composed race rows**

```
[
 {
  "dateISO": "2026-09-13",
  "slug": "santa-monica-10k-2026-09-13",
  "action": "applied",
  "reason": null,
  "outlook": {
   "statedGoalSec": null,
   "targetSec": 2580,
   "source": "expected_race_day",
   "feasibility": "no_goal",
   "reason": "No stated goal · race to where this build is expected to land you.",
   "likelyRangeSec": [
    2527,
    2631
   ],
   "paceSecPerMi": 416
  }
 },
 {
  "dateISO": "2026-09-26",
  "slug": "dodgers",
  "action": "applied",
  "reason": null,
  "outlook": {
   "statedGoalSec": 2700,
   "targetSec": 2700,
   "source": "stated_goal_within_range",
   "feasibility": "comfortable",
   "reason": "Your goal is at or slower than the expected result · race to your goal.",
   "likelyRangeSec": [
    2524,
    2630
   ],
   "paceSecPerMi": 435
  }
 },
 {
  "dateISO": "2026-11-08",
  "slug": "run-malibu",
  "action": "applied",
  "reason": null,
  "outlook": {
   "statedGoalSec": 5400,
   "targetSec": 5530,
   "source": "stated_goal_clamped_to_range_edge",
   "feasibility": "aggressive",
   "reason": "Your goal (1:30:00) is faster than the likely range's fast edge (1:32:06) · race to the edge; the goal stays yours.",
   "likelyRangeSec": [
    5526,
    5839
   ],
   "paceSecPerMi": 422
  }
 },
 {
  "dateISO": "2026-12-06",
  "slug": "cim",
  "action": "applied",
  "reason": null,
  "outlook": {
   "statedGoalSec": 10800,
   "targetSec": 11610,
   "source": "stated_goal_clamped_to_range_edge",
   "feasibility": "unlikely_currently",
   "reason": "Your goal (3:00:00) is faster than the likely range's fast edge (3:13:28) · race to the edge; the goal stays yours.",
   "likelyRangeSec": [
    11608,
    12411
   ],
   "paceSecPerMi": 443
  }
 },
 {
  "dateISO": "2026-12-01",
  "slug": "cim",
  "action": "applied",
  "reason": null,
  "outlook": {
   "statedGoalSec": 10800,
   "targetSec": 11610,
   "source": "stated_goal_clamped_to_range_edge",
   "feasibility": "unlikely_currently",
   "reason": "Your goal (3:00:00) is faster than the likely range's fast edge (3:13:28) · race to the edge; the goal stays yours.",
   "likelyRangeSec": [
    11608,
    12411
   ],
   "paceSecPerMi": 443
  }
 }
]
```

