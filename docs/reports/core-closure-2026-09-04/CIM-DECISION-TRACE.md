# CIM decision trace · corrected full-year dataset

Plan `pln_7636bcc0a201bf2d`, CIM 2026-12-06. Re-run 2026-09-05 on the corrected
dataset, with the baseline defects found tonight fixed.

**Nothing has been written to the plan.**

## The evidence base

| Quantity | Value | Provenance |
|---|---|---|
| Longest 2026 training run | **21.51 mi** (2026-01-25) | ATHLETE EVIDENCE |
| Peak 2026 week | **48.5 mi** (w/c 2026-02-09) | ATHLETE EVIDENCE |
| Weeks at 44+ mi | 48.5, 47.5, 47.3, 45.8, 44.9, 44.7 | ATHLETE EVIDENCE |
| D+7 after a half | 21.51 / 17.21 / 11.01 | ATHLETE EVIDENCE |
| Best sustained effort ≥6 mi | 13.38 mi at 7:06/mi (Disney Half) | ATHLETE EVIDENCE |
| Best training effort ≥6 mi | 12.37 mi at 7:21/mi (2026-08-09) | ATHLETE EVIDENCE |
| Step bands (10% / 25%) | reading rule for "comparable" | **POLICY ASSUMPTION** |
| Ranking weights | ordinal, uncalibrated | **POLICY ASSUMPTION** |

`heuristicRankScore` **does not predict physiological adaptation.** It is a
policy-ranking mechanism until calibrated against outcomes.

**Prescribed CIM race pace is 7:46/mi**, a 3:23:30 marathon, not the 3:00:00
goal. The engine is pacing from evidence, which is correct.

---

## 1 · The 9/21 week · 55.2 mi · **the one real reach**

5 easy + 9.5 tempo (5.5 @ T) + 9.5 medium-long + 8 easy + **Dodgers 10K** + 17 long.

- **Athlete evidence:** 55.2 is +13.8% on his demonstrated 48.5. The largest
  week the block asks before it is 46.8, so the projection offers no
  intermediate step. This is a step off his February self.
- **Research allowance:** `Research/00a` §"The 10% rule reconsidered" declines
  to support a 10% weekly cap and reports weekly mileage change correlated
  *weakly* with injury. Nothing in doctrine forbids +13.8%.
- **Doctrine that DOES bite:** `Research/00a` §"Practical load rules" — "Either
  add mileage OR add intensity in a given week, not both." This week does both:
  +17.9% on the trailing max **and** 2 stressors to 3.
- **Unknown future evidence:** whether the 46.8 week of 9/14 completes clean.

| Option | Class | Score | What it means |
|---|---|---|---|
| **PUSH** · run 55.2 as authored | ALLOWED | 0.70 | the reach, unearned today |
| **HOLD** · cap at 48.5 and move the 10K to a C-effort | SUPPORTED | **0.81** | |
| **PULL_BACK** · drop the tempo, keep the race | SUPPORTED | 0.57 | |

**Verdict: HOLD today, PUSH on evidence.** Earning gate assessed **2026-09-20**:
requires the 46.8 mi week of 9/14 completed with no session graded MISSED. If
unmet, REDUCE to 48.5 rather than dropping anything.

**This is the only week in the block that blocks promotion.**

---

## 2 · The 10/5 week · 59.5 mi

5.5 easy + 8.5 tempo (4.5 @ T) + 12 medium-long + 6.5 intervals (ladder) + 8.5 easy + 18.5 long.

- **Athlete evidence:** +7.8% on the trailing max (55.2 at 9/21), +22.7% on
  today's demonstrated peak. Three stressors, matching 9/21's three — so it adds
  volume but **not** intensity.
- **One-at-a-time:** satisfied. Not flagged.

| Option | Class | Score |
|---|---|---|
| **PUSH** · 59.5 as authored | SUPPORTED (against projection) | **0.95** |
| HOLD · hold at 55 | SUPPORTED | 0.81 |
| PULL_BACK · 48.5 | SUPPORTED | 0.57 |

**Verdict: PUSH**, conditional on the 9/21 week landing. Reassess 2026-10-04.

---

## 3 · The 10/26 week · 60.0 mi · the peak and its full stack

4.5 easy + **10 mi tempo (6 @ T, 7:10)** + 7.5 easy + **8.5 intervals (9×3 min @ I, 6:41)** + 8 easy + rest + **21.5 long**.

- **Athlete evidence:** +0.7% on the trailing max (59.6). The long run is
  **21.5 against a demonstrated 21.51** — level, not a reach. The 6 mi at 7:10
  sits inside a half he raced at 7:06 for twice the distance.
- **Stacking:** three stressors. The triple-peak check does **not** fire: volume
  is flat on the trailing max and the long run is level with demonstrated.
- **Unknown:** his demonstrated maximum stressors in one week is **not
  measurable** — plan-linked execution identity only began stamping in
  September. Class UNKNOWN, ranking score deliberately **null**. The layer
  refuses to rank this rather than invent a number.

| Option | Class | Score |
|---|---|---|
| **PUSH** · as authored | SUPPORTED on volume and long run, UNKNOWN on stacking | 0.95 / null |
| HOLD · drop the Thursday intervals | SUPPORTED | 0.81 |
| PULL_BACK · 55 and two stressors | SUPPORTED | 0.57 |

**Verdict: PUSH on volume and the long run. The stacking question is gated, not
answered.** The block already contains an earlier three-stressor week at similar
volume — **10/5, 59.5 mi**. That week is the evidence this one needs. Assessed
2026-10-25: if 10/5 completes with no session graded MISSED, the stacking is
SUPPORTED; if not, the Thursday interval session drops and the week runs two.

---

## 4 · The 11/1 long run · 21.5 mi

**Correction: there is no fast finish.** The sub_label is `LONG`, flat at 8:40.
The fast-finish long runs in this block are 9/20, 10/18, 11/15 and 11/22.

- **Athlete evidence:** 21.5 against 21.51 demonstrated. **−0.05%.**
- **Research allowance:** `Research/00a`'s 110%-of-prior-30-days spike rule is
  the binding constraint and this clears it against his own history.
- **Placement:** 35 days out, inside the 4-to-5 week window `Research/00a` puts
  a peak long run in.

**Verdict: PUSH. Keep it. No gate needed.** This is the prescription my first
trace wrongly called a +19% reach.

---

## 5 · Malibu and the week after

**11/02 week (43.2 mi):** 4.5 easy + **10 mi tempo (6 @ T) on 11/03** + 7.6 + 6
+ 2 shakeout + **Malibu Half 11/08 at 7:20**.

- **Flag worth your eye:** a 6-mile threshold dose **five days before** a
  B-priority half. Not refused by doctrine, but it is the one placement in this
  block I would question, and it is not a volume question.

**11/09 week (40.5 mi):** six easy days, then **16 mi long with 4 mi @ M on
11/15** — exactly D+7 after Malibu.

- **Athlete evidence:** at D+7 after a half he has run **21.51, 17.21 and
  11.01**. 16 sits below his maximum and near his median at that offset. The
  ceiling claim is valid on 3 comparables.
- My earlier objection took the **minimum** of that set and called it a limit.
  **Withdrawn.**

| Option | Class | Score |
|---|---|---|
| **PUSH** · 16 mi with 4 @ M | SUPPORTED | **0.95** |
| HOLD · 16 easy, drop the M | SUPPORTED | 0.81 |
| PULL_BACK · 13 easy | SUPPORTED | 0.57 |

**Verdict: PUSH.**

---

## 6 · The 11/22 marathon-specific session · 16 mi with 5 mi @ M

The largest continuous marathon-pace dose in the entire block.

- **Athlete evidence:** `maxCompletedMpMi` is **null**. There is no plan-linked
  M-dose in his history, because execution identity only began stamping in
  September. Rule 11: that is an absence, not a zero.
- **What exists instead:** two completed marathons in 2026 (26.70, 26.81) at
  marathon effort. That answers "can he run 5 miles at marathon pace" and does
  **not** answer "can he absorb a 5-mile M block inside a 16-mile long run
  fourteen days out from his goal race". Two different questions.
- **Class: UNKNOWN. Ranking score null.**

**Verdict: gated, not decided.** The dose-responsive system in build carries the
default (5 mi @ M) with a higher earned option, the evidence required, a
reassessment date and a fallback. **The September plan should hold the dose
currently earned while preserving the ability to increase it in November.** The
full Malibu-sequence adjudication is in build and is not claimed here.

---

## 7 · The 11/29 primer · 10 mi long

10 mi long on 11/29, then 4 easy, then a 4.5 mi tune-up (5×400m @ 5K) on 12/01.

- **Athlete evidence:** trivially inside everything demonstrated.
- **Taper integrity:** this is the last long effort, 7 days out. Nothing pushes.

**Verdict: HOLD. Correct as authored.** No option here scores a PUSH, and that
is the right answer inside a taper rather than a failure to advance.

---

## 8 · Race week · 12/06

4 easy · 4.5 tune-up · 4 easy · 3 easy · rest · 2 shakeout · **CIM 26.22 mi at
7:46/mi**.

- **Taper integrity:** no PUSH anywhere. Confirmed.
- **The goal race is not graded as a training long run.** 26.22 against a 21.51
  demonstrated training long would read as a +21.8% reach, which is true and
  useless: the race is what the block exists to reach. Race-week long runs are
  exempt and the taper before them governs instead.

**Verdict: HOLD. Correct as authored.**

---

## Summary

| Sequence | Verdict | Gated? |
|---|---|---|
| 9/21 · 55.2 mi | **HOLD today, PUSH on evidence** | **yes, 2026-09-20** |
| 10/5 · 59.5 mi | PUSH | conditional on 9/21 |
| 10/26 · 60.0 mi | PUSH on volume and long run | stacking gated, 2026-10-25 |
| 11/1 · 21.5 long | PUSH · keep | no |
| Malibu + 11/15 | PUSH | no |
| 11/22 · 5 mi @ M | **UNKNOWN · gated** | in build |
| 11/29 primer | HOLD | no |
| Race week | HOLD | no |

**One week blocks promotion: 2026-09-21.** Everything downstream is supported
once the chain is judged against what the block builds rather than against
today.

## Defects found in the plan while tracing it

1. **`race_week_tuneup` on 2026-11-17**, in a week containing no race, 19 days
   before CIM. That type maps to effort class `RACE` in
   `lib/evidence/load-activity-evidence.ts:85`. Checked and NOT a Rule 8
   problem: `normal-window.ts` reads its race windows `FROM races`, not from
   plan rows. Whether RACE-class evidence from a 4-mile 5×400m session can reach
   race-derived fitness is **not established** and is queued as its own task.
2. **A 6-mile threshold dose five days before Malibu.** Flagged, not refused.
