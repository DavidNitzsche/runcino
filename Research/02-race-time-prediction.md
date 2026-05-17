# 02 — Race Time Prediction and Equivalence

Generic reference doc on predicting race times across distances from a known performance. Covers the major formulas (Riegel, Cameron, Daniels VDOT), runner-type adjustments, predictor workouts, and sources of prediction error. Use in conjunction with doc 01 (physiology) and doc 03 (training-pace derivation).

## 1. Core Concept: Power-Law Time–Distance Relationship

When race times across distances are plotted on log-log axes (ln T vs ln D) for a single runner or population, the relationship is approximately linear. The slope of that line is the **fatigue exponent** (also called the fatigue factor or endurance index).

```
ln T = ln k + b · ln D
T = k · D^b
```

Where:
- `T` = race time
- `D` = race distance
- `b` = fatigue exponent (≈ 1.06 for most runners, 1500m–marathon)
- `k` = runner-specific constant

A pure-speed model would give `b = 1.00` (pace constant across distances). Empirically, `b > 1`: pace slows as distance grows because fuel, thermoregulation, mechanical wear, and central drive constraints accumulate.

## 2. Riegel Formula

### 2.1 Equation

```
T2 = T1 × (D2 / D1)^1.06
```

Where `T1` is a known race time at distance `D1`, and `T2` is the predicted time at target distance `D2`.

### 2.2 Origin and Derivation

Pete Riegel, an American mechanical engineer and competitive distance runner, published the formula in *Runner's World* in 1977 and formalized it in "Athletic Records and Human Endurance," *American Scientist* 69(3): 285–290 (1981). Riegel plotted world records across endurance sports (running, swimming, cycling, speed skating) on log-log axes and fit a single power law. The 1.06 exponent emerged as the cross-sport mean for events lasting roughly 3.5–230 minutes.

### 2.3 Reported Accuracy

| Distance gap | Typical error band | Notes |
|---|---|---|
| 5K → 10K | ±2–4% | Most reliable extrapolation |
| 10K → half | ±3–6% | Reliable when half is endurance-trained |
| Half → marathon | ±3–8% | Reliable with marathon-specific training |
| 5K → marathon | ±8–15% | Often optimistic; high variance |
| Marathon → 5K | ±5–10% | Often pessimistic; speed underdeveloped |

Population studies put traditional formula accuracy at roughly 80% of runners within ±5%, meaning 1 in 5 runners miss the prediction by a meaningful margin. Vickers & Vertosick (2016) showed Riegel "dramatically underestimates marathon time, giving times at least 10 minutes too fast for half of runners" when extrapolating from a half marathon.

### 2.4 Limitations

- Designed for events 3.5–230 minutes (≈ 1500m to marathon). Falls apart at sprints and ultras.
- Single exponent assumes universal endurance; ignores runner type (Section 7).
- Assumes equal training specificity at both distances — a fast 5K with no long runs predicts a fictional marathon.
- Does not adjust for sex, age, terrain, or weather.

## 3. Cameron Formula

Dave Cameron addressed Riegel's longer-distance bias by fitting world-class times from 400m to 50 miles with a non-linear regression rather than a single power law.

### 3.1 Equation

```
a(d) = 13.49681 − 0.000030363 · d + 835.7114 · d^(−0.7905)
T2 = (T1 / a(D1)) · a(D2)
```

Where `d` is distance in meters. `a(d)` is a distance-specific velocity factor that bends the curve at long distances.

### 3.2 Behavior vs. Riegel

| Predicted distance from a 40:00 10K | Riegel (1.06) | Cameron |
|---|---|---|
| Half marathon | 1:28:31 | 1:28:18 |
| Marathon | 3:04:35 | 3:05:50 |
| 50K | 3:51:00 | 3:54:30 |
| 50 miles | 6:25:00 | 6:39:00 |

Cameron and Riegel agree closely up to the half marathon. Beyond the marathon Cameron predicts longer (slower) times, matching empirical ultra data better. For the marathon proper, the two formulas usually differ by under 30 seconds.

### 3.3 Best Use

Cameron is preferable when the target is a marathon or longer and the input is shorter than a half. For 5K–half-marathon predictions either formula works.

## 4. Daniels VDOT-Based Predictions

VDOT ("V-dot-O2") is Jack Daniels' single-number performance index derived from a race result. It blends a model of oxygen cost and a model of fractional VO2max sustainable for a given duration.

### 4.1 The Two Equations (Daniels & Gilbert)

Oxygen cost of running at velocity `v` (m/min):

```
VO2(v) = -4.60 + 0.182258·v + 0.000104·v²   [mL/kg/min]
```

Fraction of VO2max sustainable for duration `t` (minutes):

```
%VO2max(t) = 0.8 + 0.1894393·e^(-0.012778·t) + 0.2989558·e^(-0.1932605·t)
```

Then:

```
VDOT = VO2(v) / %VO2max(t)
```

### 4.2 Producing Equivalent Times

Given a VDOT, solve the inverse problem at each target distance: find the velocity `v` such that `VO2(v) / %VO2max(t)` equals the runner's VDOT and `D = v·t`. Solving numerically yields the equivalent times in Section 5.

### 4.3 Reported Accuracy

For 5K–half-marathon predictions VDOT errors are typically 1–3% in well-trained runners. VDOT marathon predictions assume a runner can sustain ~84–86% VO2max for the duration — true only for runners with a marathon-specific aerobic block. New marathoners without that base should expect VDOT to predict 5–10% faster than they will run.

## 5. Race Equivalence Tables

### 5.1 Daniels VDOT Equivalence (selected fitness levels)

Times for well-trained runners with distance-appropriate training. Source: Daniels' Running Formula tables, cross-checked against vdoto2.com.

| VDOT | 1500m | 5K | 10K | 15K | 10mi | Half | Marathon |
|---|---|---|---|---|---|---|---|
| 30 | 8:30 | 30:40 | 1:03:46 | 1:38:14 | 1:47:24 | 2:21:04 | 4:49:17 |
| 35 | 7:21 | 26:22 | 54:44 | 1:24:18 | 1:32:09 | 2:01:19 | 4:09:06 |
| 40 | 6:24 | 23:00 | 47:44 | 1:13:32 | 1:20:24 | 1:45:55 | 3:37:31 |
| 45 | 5:40 | 20:18 | 42:04 | 1:04:49 | 1:10:53 | 1:33:24 | 3:11:35 |
| 50 | 5:04 | 18:05 | 37:27 | 57:42 | 1:03:05 | 1:23:07 | 2:50:22 |
| 55 | 4:34 | 16:20 | 33:50 | 52:09 | 56:59 | 1:14:58 | 2:33:42 |
| 60 | 4:09 | 14:50 | 30:42 | 47:18 | 51:42 | 1:07:58 | 2:19:18 |
| 65 | 3:48 | 13:36 | 28:08 | 43:21 | 47:24 | 1:02:18 | 2:07:32 |
| 70 | 3:30 | 12:32 | 25:56 | 39:59 | 43:42 | 57:25 | 1:57:35 |

### 5.2 Sample Riegel Equivalences (anchor: 5K)

Times computed with `T2 = T1 · (D2/D1)^1.06`.

| 5K (anchor) | 10K | 15K | 10mi | Half | Marathon |
|---|---|---|---|---|---|
| 30:00 | 1:02:32 | 1:35:48 | 1:43:30 | 2:17:33 | 4:46:29 |
| 25:00 | 52:06 | 1:19:50 | 1:26:15 | 1:54:37 | 3:58:44 |
| 22:00 | 45:51 | 1:10:14 | 1:15:54 | 1:40:50 | 3:30:05 |
| 20:00 | 41:41 | 1:03:53 | 1:08:59 | 1:31:42 | 3:11:00 |
| 18:00 | 37:31 | 57:30 | 1:02:06 | 1:22:32 | 2:51:54 |
| 16:00 | 33:21 | 51:07 | 55:13 | 1:13:23 | 2:32:48 |
| 14:00 | 29:11 | 44:44 | 48:19 | 1:04:13 | 2:13:42 |

### 5.3 Comparison: Riegel vs. McMillan vs. Daniels

For an 18:00 5K (commonly cited reference), the three calculators predict:

| Calculator | Marathon prediction |
|---|---|
| Riegel (1.06) | 2:56:05 |
| McMillan | 2:55:23 |
| Daniels VDOT | 2:52:45 |

Spread: ~3:20. Daniels tends to predict the fastest marathon from short-race input. McMillan applies a built-in adjustment based on the runner-type input. Empirical marathon outcomes from a 1:45 half (8:00/mi) average ~3:53 against a Riegel prediction of 3:39 — a 15-minute optimistic bias for runners without marathon-specific training.

## 6. The Exponent Debate

### 6.1 Reported Exponent Estimates

| Source | Population | Exponent | Notes |
|---|---|---|---|
| Riegel 1977 | World records, multiple sports | 1.06 | Original cross-sport mean |
| Riegel 1981 (running only) | Men's running WRs | 1.0773 | Track running, 1500m–marathon |
| George 2017 | Men's road WRs | 1.0497 | Modern records, 5K–marathon |
| George 2017 | Men's track WRs | 1.0777 | Stable vs. Riegel original |
| George 2017 | Women's road WRs | 1.0397 | ≈ 4% flatter than Riegel |
| George 2017 | Women's track WRs | 1.1228 | Track women still fade more |
| Vickers/Vertosick 2016 | 2,000+ recreational | ≈1.07 + mileage term | Adds weekly miles correction |
| Recreational averages | Mass-participation finishers | 1.07–1.12 | Higher than world-record curve |

### 6.2 When Each Applies

| Exponent | Use case |
|---|---|
| 1.04–1.05 | World-class endurance specialists; women on roads; strong marathon block |
| 1.06 | Default for trained runners, 1500m–half marathon |
| 1.07–1.08 | Recreational runners with average endurance training |
| 1.09–1.12 | Speed-biased runners; insufficient long-run base; marathon target |
| 1.13–1.15 | Ultra distances 50K–100K; switch to time-on-feet models beyond |
| > 1.15 | Multi-day events; aid-station and sleep stops dominate the model |

Practical rule: estimate the exponent empirically from two recent races at different distances, then use it for the third. Solving `T2/T1 = (D2/D1)^b` for `b`:

```
b = ln(T2/T1) / ln(D2/D1)
```

A runner with a 20:00 5K and 1:33:00 half (5K→half ratio implies `b = ln(5580/1200)/ln(21097.5/5000) = 1.072`) is slightly more endurance-leaning than a runner who ran 20:00 5K and 1:36:00 half (`b = 1.099`).

## 7. Runner-Type Adjustments (McMillan)

Greg McMillan classifies runners into three archetypes from the *shape* of their race-time curve, not its level.

### 7.1 The Three Types

| Type | Diagnostic ratio | Riegel-equivalent exponent |
|---|---|---|
| Speedster | 5K → marathon underperforms by 5–10% vs. Riegel | ~1.10–1.13 |
| Combo runner | Within ±2% of Riegel across distances | ~1.06–1.08 |
| Endurance monster | 5K → marathon overperforms vs. Riegel by 3–8% | ~1.03–1.06 |

### 7.2 Practical Markers

- **Speedster**: stronger at 1500m–10K than at half/marathon. Long runs and tempo work feel disproportionately hard. Marathon prediction from 5K is consistently optimistic.
- **Combo**: race-time curve closely follows Riegel/Daniels; predictions are reliable in both directions.
- **Endurance monster**: stronger at half/marathon than 5K. Short, fast workouts feel disproportionately hard. 5K predictions from a marathon are consistently pessimistic.

### 7.3 Adjustment Heuristic

When predicting from short → long for a Speedster, add 3–5% to Riegel time (or use exponent ~1.10). When predicting from long → short for an Endurance Monster, subtract 2–4% from Riegel time (or use exponent ~1.04). For Combo runners, default to 1.06.

## 8. Asymmetry: Why Marathon Predictions From Short Races Are Less Reliable Than the Reverse

Predicting marathon from a 5K extrapolates ~8.4× the input distance. Predicting 5K from a marathon interpolates within the input duration. The asymmetry has four mechanistic causes.

### 8.1 Energy System Mismatch

A 5K is run at ~95–100% VO2max with significant anaerobic contribution. A marathon is run at 75–85% VO2max, almost entirely aerobic. A great 5K does not require well-developed fat oxidation, glycogen capacity, or fatigue resistance to mechanical impact. A great marathon does not require high VO2max headroom or anaerobic capacity. Conversion in either direction is bounded by whichever capacity is *less* developed.

### 8.2 Specificity-Limited Predictions

A 5K can be raced near full potential after a few weeks of focused training. A marathon cannot — long-run volume, midweek medium-long runs, and weeks at race-pace effort take 12–18 weeks to develop. A 5K result reveals current top-end fitness; it does not reveal whether endurance has been built.

### 8.3 Failure-Mode Asymmetry

In a 5K, suboptimal fueling, pacing, or weather costs seconds. In a marathon, the same errors can cost 10+ minutes (the wall, cramping, dehydration). Prediction error grows non-linearly with distance because failure modes multiply.

### 8.4 The Reverse Direction Is Bounded

A marathoner predicted to run a fast 5K is bounded by their max VO2 and neuromuscular ceiling — both of which are easy to develop in 4–6 weeks of speed work. So a marathoner's 5K prediction is usually near their actual potential after a short focused block.

## 9. Age Grading and Age-Graded Predictions

### 9.1 Definition

Age-grading expresses a performance as a percentage of the world-class standard for the runner's age and sex. It allows comparison of performances across ages, sexes, and distances on a single 0–100% scale.

```
Age-Grade % = (Open WR Standard / Age Factor) / Actual Time × 100
            = Age-Adjusted Standard / Actual Time × 100   [for run/walk events]
```

`Age Factor` is a tabulated number (≤ 1.0) reflecting the expected slowdown from open class to the runner's age. World Masters Athletics (WMA) maintains these tables; the current set is the **WMA 2023 Age-Grading Tables**.

### 9.2 Performance Bands

| Age-grade | Class |
|---|---|
| ≥ 90% | World class |
| 80–89% | National class |
| 70–79% | Regional class |
| 60–69% | Local class |
| < 60% | Recreational |

### 9.3 Using Age-Grade for Cross-Distance Prediction

A consistent age-grade across distances within a single training cycle is itself a prediction tool: if the runner's recent 10K is 72% age-graded, a marathon at the same age-grade gives a target that already accounts for age and sex. This is more robust than VDOT for masters runners because the underlying tables are calibrated against age-specific records, not extrapolated from an open-class curve.

### 9.4 Age-Adjusted Equivalence

To produce an equivalent open performance from an age-grade input:

```
Equivalent Open Time = Actual Time × Age Factor
```

A 60-year-old male running a 21:00 5K with an age factor of 0.85 has an open-equivalent of 17:51, which can then be fed into VDOT/Riegel for younger-cohort comparison.

## 10. Sex-Specific Differences

### 10.1 World-Record Gap by Distance

| Distance | M WR | F WR | Gap |
|---|---|---|---|
| 100m | 9.58 | 10.49 | 9.5% |
| 5K (track) | 12:35 | 14:00 | 11.3% |
| 10K (track) | 26:11 | 28:54 | 10.3% |
| Half marathon | 57:31 | 1:02:52 | 9.3% |
| Marathon | 2:00:35 | 2:09:56 | 7.8% |
| 100K | 6:09 | 6:33 | 6.5% |
| 24-hour | 319 km | 270 km | 15% (small N) |

### 10.2 Patterns

- **Marathon and shorter**: 7–11% gap, tightening with increasing aerobic specialization.
- **Ultras with comparable participation**: 1–3% in some race classes; women approach or exceed men in 100+ mile and multi-day events.
- **Pacing**: women are markedly more even-paced in marathons; men slow more in the second half.
- **Updated fatigue exponents**: Women's road 1.04 (modern) vs. Riegel's 1.07 — women hold pace better with distance than the original formula assumes.

### 10.3 Implication for Prediction

Default Riegel/VDOT slightly under-predicts women's marathon performance from a 5K input and slightly over-predicts men's. A coach can apply a sex correction of ~−1% to women's predicted marathon time (faster) and ~+1% to men's (slower) when extrapolating from short to long, or simply use a lower exponent (1.04–1.05) for endurance-trained women.

## 11. Combining Multiple Race Times for a Better VDOT Estimate

### 11.1 Why Multiple Inputs Help

A single race result is a noisy signal. Weather, course, pacing, taper, and field all add ±1–3% noise. Two or three recent races at different distances reveal both the *level* (VDOT) and the *shape* (exponent / runner type).

### 11.2 Recommended Method

1. Compute VDOT independently for each race within the last 8 weeks.
2. If individual VDOTs lie within ±2 points: take the simple mean.
3. If they diverge by > 2 points: this is information — fit an exponent and classify runner type.
4. Discard any race run in heat > 18°C, on a hilly course, or in a depleted state without correction.

### 11.3 Weighted Average (Recency + Specificity)

```
VDOT_estimate = Σ (w_i · VDOT_i) / Σ w_i

w_i = recency_weight · specificity_weight · effort_weight
```

Sample weights:
- `recency`: 1.0 for races in last 3 weeks, 0.7 for 4–6 weeks, 0.4 for 7–12 weeks, 0.0 beyond
- `specificity`: 1.5 if same distance class as target (e.g., half for marathon target), 1.0 for adjacent, 0.6 for far
- `effort`: 1.0 for time-trial or A-race, 0.7 for tune-up, 0.4 for fitness checks

### 11.4 Two-Point Exponent Fit

With two races, the runner-specific exponent is:

```
b = ln(T2 / T1) / ln(D2 / D1)
```

Use that `b` to project to the target distance instead of the default 1.06. Best when both races are recent, on flat courses, in similar weather.

## 12. Predictor Workouts

Predictor workouts substitute for or supplement race results when none are recent. Each has a distinct accuracy profile.

### 12.1 Yasso 800s

**Protocol**: 10 × 800m at the time (in min:sec) you want to run the marathon (in hours:min). E.g., 3:00 800s = 3:00 marathon goal. Recovery: jog 800m or equal time.

**Accuracy**: anecdotal correlation reported by Bart Yasso; not validated in controlled studies. Works best for endurance-focused recreational marathoners (Combo and Endurance Monsters). Speedsters routinely hit Yasso targets in training but blow up in the marathon — the workout taxes VO2max and lactate buffering, not marathon-specific endurance.

**Error pattern**: optimistic for Speedsters, accurate for Combos, slightly pessimistic for Endurance Monsters.

### 12.2 Fast Finish Long Run

**Protocol**: long run of 14–18 miles (22–29 km) where the final 3–10 miles (5–16 km) progress from marathon pace to half-marathon pace. McMillan and Rosa attribute popularization to coaching elite Kenyan/Ethiopian marathoners.

**Accuracy**: when 3–5 of these are completed in the final 8–12 weeks, holding goal MP for the final 6–10 miles after 8–10 miles of easy pace is a strong predictor. Failing this workout is a clear signal that the goal is too aggressive.

**Error pattern**: low false positives (rarely passes a runner who can't deliver the marathon). Specific to marathon target only.

### 12.3 Long Distance Race / Tune-Up

**Protocol**: a half marathon 4–6 weeks before marathon goal, raced at race effort. Or a 10K–15K 6–8 weeks out for half-marathon target.

**Accuracy**: highest of the three. Plug into Riegel/VDOT/Cameron with adjustment for the larger distance gap. Used by Pfitzinger and Daniels as the default predictor.

**Error pattern**: ±2–4% on marathon target if specific endurance is in place.

### 12.4 Race-Effort Tempo

**Protocol**: 6–10 miles (10–16 km) at projected half-marathon pace, or 8–12 miles at projected marathon pace, in the final 3–5 weeks of a build.

**Accuracy**: confirms whether the projected pace feels controlled or maxed. Not a quantitative predictor, but a binary go/no-go signal: if the tempo feels redline, the goal is too aggressive.

### 12.5 Predictor-Workout Accuracy Matrix

| Workout | Speedster | Combo | Endurance Monster |
|---|---|---|---|
| Yasso 800s | Optimistic by 5–10 min | Accurate ±3 min | Pessimistic by 3–5 min |
| Fast Finish LR | Accurate | Accurate | Accurate (often beats prediction) |
| Tune-up race | Optimistic by 2–4% | Accurate ±2% | Slightly pessimistic |
| MP tempo | Useful | Useful | Useful |

## 13. Common Prediction Error Sources

### 13.1 Training Specificity

The single largest error source. Classic pattern: a runner peaks for a 5K, runs an excellent VO2max-driven race, then assumes the calculator's marathon time. With insufficient long runs (< 18 mi peak), insufficient mileage (< 50 mpw), and no marathon-pace work, the actual marathon time is 5–15% slower than predicted.

**Adjustment rule**: for marathon prediction from a sub-half-marathon input, add 5% if marathon-specific training is absent, 8% if both mileage and long run are below recommended minima.

### 13.2 Course Profile

| Net elevation gain | Slowdown (typical) |
|---|---|
| Flat (< 100 ft / 30m) | 0% |
| Rolling (100–500 ft / 30–150m) | 1–2% |
| Hilly (500–1500 ft / 150–460m) | 2–5% |
| Mountain (> 1500 ft / 460m) | 5–15% |

Rule of thumb: each 100 ft (30 m) of net elevation gain costs ~2–4 sec/mile in road races; downhills do not symmetrically refund the cost.

### 13.3 Weather

```
Adjusted Pace = Base Pace × (1 + heat_factor)

heat_factor (using Temp + Dew Point in °F):
  ≤ 100        → 0%
  101–120      → 0.5–1%
  121–130      → 1–2%
  131–140      → 2–3%
  141–150      → 3–5%
  151–160      → 5–8%
  161–170      → 8–12%
  > 170        → 12–20%
```

Equivalent rule: marathon performance declines ~1.5–3% per 10°F (5.5°C) above 55°F (13°C). Wind: a 10 mph headwind/tailwind asymmetrically slows by more than a tailwind speeds up — net slowdown on out-and-back courses.

### 13.4 Altitude

Above 1,500 m, subtract 3–5% from sea-level prediction unless the runner is altitude-acclimated (≥ 3 weeks resident). Above 2,500 m, 6–10%.

### 13.5 Runner Profile

- **Mass**: heavier runners decay faster across distance (mechanical fatigue, thermoregulation). Add 1–2% to marathon prediction for BMI > 25.
- **Age**: predictions calibrated to open-class ignore the age curve. Use age-grading instead.
- **Training age**: novice runners have less stable race-day execution; widen the confidence interval by ±2%.

### 13.6 Pacing Execution

Most prediction failures at the marathon are pacing failures. Even-pace or slight negative-split execution is implicit in every formula. Going out 5 sec/mi too fast in the first 10K of a marathon costs an estimated 30–60 sec/mi in the final 10K — a net loss that can wipe out 20+ minutes from the predicted time.

### 13.7 Confidence Intervals to Report with Predictions

| Prediction span | Suggested 80% CI |
|---|---|
| 5K → 10K, recent input | ±1.5% |
| 10K → half, recent input | ±2.5% |
| Half → marathon, marathon-trained | ±3% |
| 5K → marathon, marathon-trained | ±5% |
| 5K → marathon, no marathon block | ±10% (one-sided pessimistic) |
| Marathon → 5K, recent base | ±3% |
| Cross-prediction with > 6-month-old input | ±8% |

## 14. Practical Decision Rules

1. **Default formula**: use Riegel 1.06 for predictions within 1500m–half marathon among trained runners.
2. **Marathon target**: use Daniels VDOT or Cameron, but only if marathon-specific training is in place. Otherwise add a specificity penalty (Section 13.1).
3. **Two recent races available**: fit the runner's own exponent (Section 11.4) and use that for the third distance.
4. **Three recent races available**: classify as Speedster / Combo / Endurance Monster from the curve shape; apply runner-type adjustments.
5. **Masters runner**: convert to age-graded standard, predict, then convert back.
6. **Ultra target**: use Cameron or exponent ≥ 1.10; switch to time-on-feet models beyond 100K.
7. **Always report a confidence interval**, not a point estimate. Coaches who report point estimates for marathon goals from 5K times systematically over-predict.

## Sources

### Peer-reviewed
- Riegel PS. "Athletic Records and Human Endurance." *American Scientist* 69(3): 285–290 (1981). https://www.nku.edu/~longa/classes/mat375/days/docs/CrossCountry/riegel.pdf
- Vickers AJ, Vertosick EA. "An empirical study of race times in recreational endurance runners." *BMC Sports Sci Med Rehabil* (2016). https://www.researchgate.net/publication/306923196
- Hubble C, Zhao J. "Gender differences in marathon pacing and performance prediction." *Journal of Sports Analytics* (2016). https://journals.sagepub.com/doi/10.3233/JSA-150008
- Senefeld JW et al. "Sex differences in human running performance: smaller gaps at shorter distances?" *J Appl Physiol* (2022). https://journals.physiology.org/doi/full/10.1152/japplphysiol.00359.2022
- Besson T et al. "Sex Differences in Endurance Running." *Sports Medicine* (2022). https://amu.hal.science/hal-03991648/document
- Smyth B, Muniz-Pumares D. "Calculation of Critical Speed from Raw Training Data in Recreational Marathon Runners." *Med Sci Sports Exerc* (2020). https://pmc.ncbi.nlm.nih.gov/articles/PMC7664951/
- Jones AM, Vanhatalo A. "The 'Critical Power' Concept: Applications to Sports Performance with a Focus on Intermittent High-Intensity Exercise." *Sports Med* (2017).
- Thuany M et al. "Differences in Marathon Times and Pacing Between Men and Women." *Perceptual and Motor Skills* (2026). https://journals.sagepub.com/doi/10.1177/00315125251347413
- Knechtle B et al. "Sex differences in 24-hour ultra-marathon performance." *PLoS ONE* (2013). https://pmc.ncbi.nlm.nih.gov/articles/PMC3870311/

### Coaching authorities
- Daniels J. *Daniels' Running Formula*, 4th ed. (Human Kinetics).
- Daniels J, Gilbert J. *Oxygen Power: Performance Tables for Distance Runners* (1979).
- McMillan G. McMillan Running Calculator and runner-type classification. https://www.mcmillanrunning.com/
- Pfitzinger P, Douglas S. *Advanced Marathoning*, 3rd ed.
- Cameron D. Race time prediction formula. https://www.had2know.org/sports/race-performance-prediction-calculator-cameron.html
- World Masters Athletics. *2023 Age-Grading Tables*. https://world-masters-athletics.org/

### Reputable coaching publications and tools
- Runners Connect: "How Accurate Are Race Calculators? A Riegel Formula Guide." https://runnersconnect.net/race-calculators/
- George R. "New Fatigue Factors for Running." (2017). http://www.georgeron.com/2017/09/new-fatigue-factors-for-running-mens.html
- VDOT O2 Calculator. https://vdoto2.com/calculator
- Marathon Handbook: race-time predictor and Yasso analysis. https://marathonhandbook.com/
- Outside Online: "A Big Data Approach to Predicting Your Marathon Pace." https://www.outsideonline.com/health/training-performance/critical-speed-marathon-prediction-study/
- Running Writings: heat and humidity adjustment models. https://runningwritings.com/
