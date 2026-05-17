# 15 — Wearable Data Interpretation

A reference for translating signals from running wearables (Garmin, Apple Watch, Whoop, Oura, Polar, Coros, Stryd) into coaching decisions. Generic only — no personalized prescriptions.

## Glossary (terms used throughout)

| Term | Definition |
|---|---|
| RHR | Resting heart rate, beats per minute, measured at rest (typically morning or during sleep) |
| HRV | Heart rate variability — beat-to-beat variation in time between R-R intervals |
| RMSSD | Root mean square of successive R-R interval differences; the dominant time-domain HRV metric |
| LnRMSSD | Natural log of RMSSD; preferred for trend analysis because raw RMSSD is right-skewed |
| SWC | Smallest worthwhile change — threshold a metric must move to be considered a real signal vs. noise |
| TRIMP | Training Impulse — Banister's heart-rate-based dose metric |
| TSS | Training Stress Score — Coggan's intensity-squared × duration dose metric |
| CTL | Chronic Training Load — 42-day exponentially weighted average of daily TSS (proxy for fitness) |
| ATL | Acute Training Load — 7-day exponentially weighted average of daily TSS (proxy for fatigue) |
| TSB | Training Stress Balance = CTL − ATL (proxy for form/freshness) |
| ACWR | Acute:Chronic Workload Ratio = ATL / CTL |
| EPOC | Excess Post-exercise Oxygen Consumption — basis for Garmin/Firstbeat training load |
| GCT | Ground contact time — milliseconds the foot is on the ground per step |
| VO | Vertical oscillation — vertical bounce of the torso per step (cm) |
| VR | Vertical ratio = VO / stride length, expressed as a percent |
| CP | Critical Power — running power equivalent of FTP; ~max sustainable for ~30–60 min |
| PPG | Photoplethysmography — optical heart rate sensing |
| ECG | Electrocardiography — electrical heart rate sensing (chest strap) |
| MAPE | Mean absolute percentage error — common accuracy metric |
| CCC | Concordance correlation coefficient |

---

## Resting Heart Rate (RHR)

### What it measures

RHR is the lowest sustained heart rate at full rest. Two common capture methods:

| Method | Notes |
|---|---|
| Morning supine, post-wake, pre-stand | Classic protocol; subject to wake-time variability |
| Lowest 30-min nocturnal average | Most wearables (Whoop, Oura, Garmin, Apple Watch) use this — more stable |

Nocturnal RHR has lower day-to-day noise than spot morning measurements and is the recommended baseline.

### Establishing a baseline

- Minimum 14 days of data before drawing conclusions.
- Use a 7-day rolling average as the working baseline; recompute monthly.
- Track the standard deviation (SD) of the rolling average to define noise floor.

### Decision rules

| Reading | Interpretation | Action signal |
|---|---|---|
| Within ±2 bpm of 14-day baseline | Normal day-to-day noise | None |
| +3 to +5 bpm above baseline for 1 day | Acute load, alcohol, late meal, heat | Watch, do not act |
| ≥+5 bpm for 2+ consecutive days | Incomplete recovery or pre-illness | Reduce intensity; flag |
| ≥+7 bpm sustained or ≥+10 bpm spike | Strong illness/overtraining signal | Replace hard work with easy or off |
| Persistent downward drift over months | Aerobic adaptation | Positive — fitness improving |

### Confounders that elevate RHR independent of training stress

Alcohol within 12 hr (+5 to +10 bpm), late meals, hot bedroom (+3 to +5 bpm), dehydration, late caffeine, emotional/work stress, travel and altitude >1500 m (elevates nocturnal HR 3–5 days).

### Limits of RHR

- Some athletes show no RHR elevation during overtraining; review literature reports a substantial fraction of overtrained runners with normal or even depressed RHR.
- A single elevated morning RHR has ~50% noise contribution from wake protocol — prefer nocturnal data.

---

## Heart Rate Variability (HRV)

### Metric of choice

`RMSSD` (or its log transform `LnRMSSD`) is the field standard for short-term HRV monitoring. It indexes parasympathetic (vagal) tone, recovers fastest after training, and is what Whoop, Oura, Garmin, Polar, HRV4Training, and EliteHRV expose (often rebranded).

```
RMSSD = sqrt( mean( (RR_i+1 − RR_i)^2 ) )    # ms
LnRMSSD = ln(RMSSD)
```

Some apps display `LnRMSSD × 20` to expand the practical range to a 0–100 scale (Plews scale).

### Measurement protocol options

| Protocol | Setup | Pros | Cons |
|---|---|---|---|
| Nocturnal automatic (Whoop, Oura, Garmin) | None | Compliance ~100%; sleep state controlled | Sensitive to last 1–2 hr sleep stage; PPG bias |
| Morning supine spot (5 min) | Chest strap or ring upon waking, lying still | Cheap, reproducible | Requires daily discipline |
| Morning sit-up / orthostatic (Plews approach) | 1–2 min supine then 1–2 min seated/standing | Captures autonomic response to posture; higher sensitivity to maladaptation | Longer, more failure modes |
| Ultra-short (1 min) | Just 60 s at rest | Practical | Wider error margins |

Validated minimum: 60 s of stable beat-to-beat data. Plews/Laursen showed 3 valid readings per week is sufficient for trend assessment if paired with a 7-day rolling average.

### Plews approach (peer-reviewed)

1. Record morning HRV at least 3 days/week (preferably daily).
2. Compute the **7-day rolling average** of LnRMSSD.
3. Define **smallest worthwhile change (SWC)** as `0.5 × SD` of the 7-day rolling average over the prior 60 days.
4. Flag a meaningful drop when the rolling average decreases by ≥ SWC, or when LnRMSSD × 20 drops by ≥1.5 points (≈7.5% raw RMSSD drop).
5. Concurrently track the **coefficient of variation (CV)** of the 7-day rolling average — `CV = SD / mean × 100`. Rising CV indicates destabilization (early functional overreach).

### Interpretation matrix

| 7-day rolling LnRMSSD | CV of 7-day rolling | State signal |
|---|---|---|
| Stable or rising | Low (stable) | Coping well; green light to load |
| Stable | Rising | Early maladaptation; reduce one hard session |
| Falling, within SWC | Low | Normal noise; no action |
| Falling > SWC for ≥3 days | Any | Reduce intensity 24–72 hr |
| Falling > SWC, sustained ≥7 days | High | Likely non-functional overreach; deload |
| Rising during planned taper | Falling | Peak readiness — race-ready |
| Suppressed but flat at low level | Low | Possible chronic overtraining or illness |

### Common HRV interpretation errors

- Treating one day's reading as actionable.
- Comparing absolute HRV across people — HRV varies 5–10× between individuals; only intra-individual trends matter.
- Reading HRV as a fitness score; it is a recovery/autonomic-state signal, not a performance predictor.
- Failing to control posture, time of day, breathing, and recent meals between readings.

---

## Sleep Stage Data

### Accuracy reality check

Polysomnography (PSG) is the gold standard, and even between two trained PSG technicians scoring the same night, agreement is ~83%. Wearables operate against this ceiling.

| Device (most-validated config) | Sleep/wake accuracy | 4-stage accuracy |
|---|---|---|
| Oura Gen 3 (OSSA 2.0) | ~92% | ~80% (best consumer) |
| Apple Watch (current watchOS) | ~88% | ~75% |
| Whoop 4.0 | ~88% | ~70% |
| Fitbit (recent gen) | ~85% | ~70% |
| Garmin (Firstbeat) | Variable; wakes underdetected | ~65% |

Sensitivity (detecting sleep) is uniformly high (≥90%); specificity (detecting wake) is consistently weaker (60–75%) — devices over-call sleep when the user is lying still awake.

### What to use vs. ignore

| Metric | Trust level | Use case |
|---|---|---|
| Total sleep time (TST) | High | Trend tracking |
| Sleep efficiency (TST / time in bed) | High | Hygiene check |
| Time in bed | High | Behavioral compliance |
| Sleep onset latency | Medium | Trend only |
| Wake-after-sleep-onset (WASO) | Medium | Trend only |
| Light vs. deep vs. REM split (single night) | Low | Noise; ignore |
| Deep/REM trend over 14+ days | Medium | Direction only |
| "Sleep score" (composite) | Low–Medium | Use underlying inputs |

Coaching rule: trend total sleep time and efficiency. Treat individual stage breakdowns as informational, not actionable.

---

## Training Load Metrics

### Banister TRIMP

Heart-rate-based dose. Standard formula:

```
TRIMP = duration_minutes × HR_ratio × y
HR_ratio = (HR_avg − HR_rest) / (HR_max − HR_rest)
y = 0.64 × e^(1.92 × HR_ratio)   # men
y = 0.86 × e^(1.67 × HR_ratio)   # women
```

The exponential `y` weights time spent at high intensities so that 60 min easy ≠ 60 min threshold. TRIMP requires reasonable HR_max and HR_rest estimates and is heart-rate-bound (won't capture neuromuscular load). Coros uses TRIMP as its native training load metric.

### Coggan TSS (Training Stress Score)

Originally cycling, power-based:

```
TSS = (duration_seconds × NP × IF) / (FTP × 3600) × 100
IF  = NP / FTP
```

Where `NP` is normalized power (variability-adjusted), `FTP` is functional threshold power (~1-hour max). 1 hour at FTP = 100 TSS by definition. Equivalent for running uses normalized graded pace (NGP) and threshold pace (rTSS in TrainingPeaks). Stryd computes a power-based running TSS.

### Garmin Training Load (Firstbeat EPOC)

Firstbeat estimates EPOC from heart rate data during exercise. Each session yields an EPOC-derived load score; the rolling 7-day sum is plotted against a personalized "optimal range" band (heat-mapped: under-/optimal/high/over-reaching). The 4-week chronic load defines the band.

Training Load Focus splits the same 7-day load into low aerobic, high aerobic, and anaerobic buckets to flag intensity distribution gaps.

### Whoop Strain

0–21 logarithmic scale (Borg-derived). Combines cardiovascular load (HR-based time-in-zones) and muscular load (motion sensors + tags). Strain 0–10 is light, 10–14 moderate, 14–18 strenuous, 18–21 all-out. Daily Strain integrates entire day, not just workouts. Whoop measures HR via wrist PPG by default — accuracy improves materially when the band is worn on the bicep.

### Side-by-side

| Metric | Domain | Inputs | Strength | Weakness |
|---|---|---|---|---|
| TRIMP | All endurance | HR, HR zones | Simple, validated since 1991 | Misses neuromuscular load; needs accurate HR_max |
| TSS / rTSS | Cycling / running | Power or pace | Intensity-squared captures hard sessions well | Needs FTP/threshold pace; pace inaccurate on trails |
| Garmin Training Load | Garmin ecosystem | HR, EPOC model | Personalized band, intensity split | Black box; overweights short hard efforts |
| Whoop Strain | Whoop ecosystem | HR all-day | Captures life stress + workouts | Wrist PPG noisy at intensity |
| Stryd rTSS | Running with Stryd | Power | Terrain-independent | Requires Stryd footpod |

These metrics are not interchangeable. Mixing TSS from one source and Garmin Training Load from another in the same plan corrupts trends. Pick one and stick to it.

### Acute:Chronic Workload Ratio (ACWR)

```
ACWR = acute_load_7d / chronic_load_28d
# both can be rolling averages or exponentially weighted (EWMA preferred)
```

Gabbett's "sweet spot" zones (based on observational data in team sports):

| ACWR | Zone |
|---|---|
| < 0.8 | Detraining / undertrained |
| 0.8 – 1.3 | Sweet spot |
| 1.3 – 1.5 | Caution |
| > 1.5 | Danger zone (elevated injury risk in the original models) |

**Critique (Impellizzeri, Tenan, et al.):** the ACWR has been challenged on multiple grounds — the ratio is mathematically a rescaling of acute load (numerator dominates), denominators chosen arbitrarily perform similarly to "real" chronic load, no causal injury link has been established, results don't replicate cleanly across sports, and operational definitions vary widely. Recent work argues against using ACWR as a deterministic injury predictor.

**Practical stance for endurance running:** treat ACWR as a directional sanity check, not a stop-light. A ratio jumping from 0.9 to 1.6 in a week is a flag worth examining; a ratio of 1.4 in itself is not a verdict. Couple with HRV trend, RHR, sleep, and subjective state.

---

## Recovery Scores

### What each one actually measures

| Score | Inputs | Range | What it is |
|---|---|---|---|
| Whoop Recovery | Sleep performance, RHR, HRV (RMSSD), respiratory rate, skin temp, SpO2 | 0–100% | Composite vagal-tone + sleep readiness |
| Oura Readiness | HRV, RHR, body temp deviation, sleep balance, recovery index, activity balance, previous-day strain | 0–100 | Composite |
| Garmin Body Battery | All-day stress (HRV-derived), activity drain, sleep refill | 5–100 | Energy reserve estimate |
| Garmin Training Readiness | Sleep score, recovery time, HRV status, acute load, sleep history, stress history | 0–100 | Train-or-not score |

These are weighted blends of the same underlying physiology (HRV, RHR, sleep), packaged differently. They do not measure recovery directly — they measure correlates of autonomic and sleep state.

### Interpretation rules

| Score band | Read |
|---|---|
| Very high (top decile) | Likely under-loaded; capacity available |
| High | Green light for hard work |
| Moderate | Normal day; train as planned |
| Low | Reduce planned intensity by 1 zone or substitute easy |
| Very low (bottom decile) | Off day or recovery only — even if subjective state is OK |

The score is most useful when it changes — a 30-point drop overnight matters more than the absolute value. Avoid stacking decisions: if Whoop, Oura, and Garmin all say red, defer; if they disagree, weight subjective state higher.

---

## VO2max Estimates from Wearables

### Validation summary

| Source | MAPE vs. lab | Notes |
|---|---|---|
| Firstbeat (Garmin) — moderately trained | 4–7% | Strong agreement (ICC ~0.8) |
| Firstbeat (Garmin) — highly trained | 9–12% | Underestimates by ~5–7 ml/kg/min in elite runners |
| Apple Watch | ~7–10% | Improves with paired GPS+HR runs at varied intensities |
| Whoop | Not natively reported | — |
| Oura | Not natively reported | — |

Submaximal lab tests themselves run 10–15% error against true VO2max, so wearable estimates are competitive with submax tests but not max ramp tests.

### Practical guidance

- Use the **trend**, not the absolute number. A Garmin VO2max moving 51 → 53 → 55 over 8 weeks is a real fitness signal even if the absolute is biased.
- Estimates need outdoor runs with HR + GPS at moderate-hard intensity. Treadmill, walk-run, and very easy runs starve the algorithm.
- Optical HR errors propagate directly into VO2max errors; pair a chest strap for VO2max-relevant sessions.
- Heat, altitude, and dehydration depress wearable VO2max for days after.

---

## Running Power (Stryd, Garmin, Coros)

### Concept

Running power estimates the mechanical work rate (watts) by combining accelerometer-derived motion with biomechanical models. Unlike pace, it adjusts continuously for grade, wind (Stryd Wind), and surface, so a watt target maps to a constant effort across terrain.

### Calibration

- **Stryd**: factory-calibrated; no manual calibration needed. Stated accuracy ±3%. Critical Power (CP) is auto-estimated from logged efforts; manual CP test (e.g., 3 min + 9 min all-out, or a recent race) recommended every 6–8 weeks during build phases.
- **Garmin / Coros wrist power**: derived from wrist accelerometer and HR. No footpod required; less accurate, more volatile than Stryd, especially on trails.

### Critical Power

CP is the running analog of FTP — the asymptotic max sustainable power, roughly ~30–60 min effort. It anchors the zone system and rTSS calculation. Accurate CP requires either:

1. A recent hard race (10K to half marathon).
2. A formal CP test (typically 3-min and 9-min all-out separated by recovery).
3. Long auto-detection from training data (lower confidence).

### Practical zones (typical running power)

| Zone | % CP | Use |
|---|---|---|
| 1 | <80 | Recovery |
| 2 | 80–88 | Easy aerobic |
| 3 | 88–95 | Steady / marathon |
| 4 | 95–105 | Threshold |
| 5 | 105–115 | VO2max intervals |
| 6 | 115–130 | Anaerobic |
| 7 | >130 | Sprint |

Common applications:
- **Pacing on hilly courses** — hold target watts; pace varies but effort is constant.
- **Wind compensation** — holding watts in headwind preserves physiology over time-targeted pacing.
- **Workout normalization** — interval intensities are stable across days regardless of weather.

### Limits

- Power is a model output, not a direct mechanical measurement.
- Different vendors' powers are not interchangeable (Stryd ≠ Garmin watts).
- Trail / technical surfaces add noise; Stryd is most validated on roads.

---

## Running Dynamics: Useful vs. Marketing

### Cadence (steps per minute)

| Metric value | Interpretation |
|---|---|
| Useful | Yes — strong feedback metric |
| Range | 160–200 spm typical; elites 175–200 |
| Coaching rule | Cadence drift downward at constant pace = fatigue or fitness loss |

Increasing cadence ~5–10% reduces peak loading rates and ground reaction force — actionable for injury reduction.

### Ground Contact Time (GCT)

| Metric value | Interpretation |
|---|---|
| Useful | Partially |
| Typical range | 200–300 ms easy; 180–240 ms fast |
| GCT balance (L/R asymmetry) | Imbalances >2% correlate with worse running economy; >65% of running-economy variance has been attributed to GCT imbalance in some studies |

### Vertical Oscillation (VO)

| Metric value | Interpretation |
|---|---|
| Useful | Limited in isolation |
| Typical range | 6–12 cm |
| Read with | Stride length and cadence |

Lower VO at a given speed correlates with better running economy at the group level — but individual variation is large; do not chase a target VO.

### Vertical Ratio (VR = VO / stride length)

| Metric value | Interpretation |
|---|---|
| Useful | Yes — composite metric |
| Elite | 4–6% |
| Recreational efficient | 6–8% |
| Inefficient | >9% |

Most informative on long efforts: a rising VR late in a long run typically reflects shortening stride under fatigue, not increased bounce.

### Marketing-tier metrics

Vendor-proprietary "running effectiveness," "stride power ratio," composite form scores: directionally interesting, low validation, easily gamed by sensor placement. Do not coach on them.

---

## Pace and GPS Accuracy

### Error sources

| Condition | Single-band error | Dual-band (L1+L5) error |
|---|---|---|
| Open sky | 1–3 m | 1–2 m |
| Light tree cover | 3–8 m | 2–4 m |
| Dense forest | 10–30 m | 3–10 m |
| Urban canyon | 10–50 m | 2–8 m |
| Tunnels / under bridges | No fix; dead reckoning | No fix; dead reckoning |
| Indoor / treadmill | None; uses footpod or wrist | Same |

### Multi-band / dual-frequency benefits

L1+L5 receivers (Garmin Forerunner 955/965, Fenix 7/8 Pro, Apple Watch Ultra, Coros Apex 2 Pro/Vertix 2) compare paths at two frequencies to filter multipath reflections — the dominant urban error source. Battery cost is ~30–50% vs. single-band.

### Coaching implications

- **Instantaneous pace is noisy** even with good GPS. Use lap pace, average pace, or smoothed pace for decisions.
- **Treadmill GPS** is meaningless; rely on speed sensor, calibrated footpod, or treadmill display.
- **Trail running** in canyons or forest: power (Stryd) or HR is more reliable than pace.
- **Race PRs** measured by GPS distance can over- or under-report by 1–3% on technical courses; the official chip time over the certified course is canonical.

---

## Heart Rate Sensor Accuracy

### Sensor classes

| Class | Mechanism | Typical accuracy vs. ECG |
|---|---|---|
| Chest strap (e.g., Polar H10) | ECG | 99%+ across intensities |
| Arm/forearm optical (Polar Verity Sense, OH1, Wahoo TICKR FIT, Scosche Rhythm) | PPG on bicep/forearm | ~98% steady, ~95% intervals |
| Wrist optical (Apple, Garmin, Whoop on wrist, Coros) | PPG | ~95% steady, drops at intervals/intensity |

### Where wrist optical fails

- High-intensity intervals: 5–15 second lag detecting HR spikes and dips (cadence lock to step rate is common).
- Cold weather / poor perfusion: false low readings or signal loss.
- Tattoos, dark skin pigmentation: documented bias in some devices, though modern multi-LED arrays have narrowed gaps.
- Loose strap, hairy wrists, sweat slippage.
- Wrist movement (strength training, climbing): worst case for PPG.

### Coaching rule

| Session type | Required sensor |
|---|---|
| Easy aerobic, daily monitoring | Wrist OK |
| Threshold steady state | Wrist usually OK; arm or chest preferred |
| VO2 intervals, hill repeats, sprints | Chest strap or arm band; do not coach off wrist HR |
| Lab-equivalent measurement (LT, VO2max derivation) | Chest strap |

### HRV accuracy by sensor

- Chest strap (R-R capable): gold standard for RMSSD.
- Arm/finger PPG (Oura, HRV4Training camera): good agreement with ECG (CCC ~0.94+) when measured at rest.
- Wrist PPG nocturnal: workable for trends. Validation vs. ECG over nights — Oura ~0.97 CCC for RHR; Whoop ~0.94 for HRV; Garmin ~0.87; Polar ~0.82. Wrist PPG during exercise should not be used for HRV.

---

## Fitness/Fatigue/Form (CTL/ATL/TSB)

### The model

Banister 1975 fitness-fatigue model, simplified by Coggan. Two exponentially weighted averages of daily TSS:

```
CTL_today = CTL_yesterday + (TSS_today − CTL_yesterday) / 42
ATL_today = ATL_yesterday + (TSS_today − ATL_yesterday) / 7
TSB_today = CTL_yesterday − ATL_yesterday
```

| Quantity | Time constant | Reads as |
|---|---|---|
| CTL | 42 days | Fitness |
| ATL | 7 days | Fatigue |
| TSB | — | Form / freshness |

### Operating bands

| Phase | Target TSB |
|---|---|
| Hard build / overload week | −10 to −30 |
| Recovery week | −5 to +10 |
| Pre-race taper, week of | +5 to +15 |
| Race day (A-priority) | +15 to +25 |
| Sustained > +25 outside taper | Detraining risk |

### Common pitfalls

- TSS quality drives CTL quality. Garbage in = garbage out — corrupt TSS from missed HR caps, bad FTP/CP, or sensor outages distorts the chart.
- CTL is not VO2max. CTL captures load-handling capacity; an athlete can lose VO2max while CTL holds steady (excess junk volume).
- Long detraining and re-load: CTL responds slowly; for long-term gaps, hand-fade the curve rather than trusting the autoregressive output.
- Fixed time constants (7 / 42) approximate population norms; individual response varies by ±30%.

---

## Lactate Threshold Detection Algorithms

### Garmin (Firstbeat)

Detects the inflection in the HR-vs-pace curve where HR rises disproportionately to pace — the proxy for crossing lactate threshold. Requirements:
- Outdoor run with GPS and HR.
- Sustained effort above estimated threshold for ≥10 min.
- Pre-existing VO2max estimate.
- Historically required HRV data from chest strap; recent firmware uses optical HR for some watch models.

Reported accuracy: within ~5–10 bpm of lab-measured LTHR in trained runners; wider error in untrained populations and in athletes with unusual HR-pace relationships (β-blockers, atypical HR_max).

### Coros, Apple Watch

Use similar HR-pace decoupling logic with vendor-specific implementations. None are validated to the same depth as the Firstbeat method.

### When to trust auto-detected LT

| Situation | Trust |
|---|---|
| Recent high-intensity outdoor runs in stable conditions | High |
| Treadmill-only training | Low |
| Heat, altitude, illness during detection runs | Low |
| Athlete with abnormal HR_max or autonomic medications | Low |
| Trail/ultra athlete (variable terrain confounds pace-HR mapping) | Low |

When auto-detected LT shifts more than ~3 bpm over a week, it usually reflects sensor noise or detection instability, not physiology.

---

## When Wearable Data Agrees vs. Disagrees with Subjective State

### The validated fact

A systematic review (Saw et al., 2016) found that subjective self-reported wellness measures (mood, fatigue, soreness, sleep, stress — e.g., the Hooper Index, 5-point wellness scale) are more sensitive and consistent indicators of acute and chronic training load than objective markers including hormones, biochemistry, and HRV. **When the two disagree, subjective wins.**

### Decision matrix

| Wearable signal | Subjective state | Action |
|---|---|---|
| Green | Good | Train as planned |
| Green | Poor | Trust subjective — reduce or substitute easy |
| Red | Good | Watch — proceed with planned session at low end of intensity range; reassess at warm-up |
| Red | Poor | Off day or recovery only |
| Mixed across devices | Poor | Off day |
| Mixed across devices | Good | Train as planned |

### Why divergence happens

| Direction | Common cause |
|---|---|
| Wearable red, subjective green | Recent travel/altitude/heat, alcohol, late meal, finger/wrist sensor noise, autonomic shift without performance impact |
| Wearable green, subjective red | Cumulative fatigue not yet reaching autonomic markers; pre-illness incubation; emotional/work stress; muscular soreness without cardiovascular load |

### Coaching rule

Track both. Use a daily 1–10 readiness question (or full Hooper) and pair with the wearable score. When they diverge, log it — patterns emerge.

---

## Spotting Illness Early

Classic pre-illness signature, typically 1–3 days before symptoms:

| Marker | Direction | Magnitude |
|---|---|---|
| RHR (nocturnal) | Up | +5 to +15 bpm |
| HRV (LnRMSSD) | Down | > SWC (0.5 SD) |
| Skin temperature deviation | Up | +0.3 to +1.0 °C above baseline |
| Respiratory rate (nocturnal) | Up | +1 to +3 breaths/min |
| Sleep efficiency | Down | Often modest (5–10 percentage points) |
| Subjective: scratchy throat, headache, fatigue | Variable | Low specificity |

When 3+ markers align in the pre-illness pattern, probability of acute illness within 72 hours rises substantially. Coaching response: replace planned hard work with easy or rest. Hard training during incubation extends recovery and increases secondary infection risk.

---

## Spotting Overtraining Early

Distinguish three states:

| State | Recovery window | Markers |
|---|---|---|
| Functional overreaching (FOR) | 1–2 weeks | Short-term performance dip, then supercompensation; HRV briefly suppressed but rebounds |
| Non-functional overreaching (NFOR) | Weeks to months | Sustained performance drop, mood disturbance, RHR ±5–10 bpm above baseline, HRV CV rising, sleep disrupted |
| Overtraining syndrome (OTS) | Months to years | Persistent unexplained underperformance ≥3 weeks despite rest; mood disturbance; no other diagnosis |

### Earliest reliable signals

1. **Mood and motivation** (psychological symptoms typically lead physiological by days–weeks): irritability, loss of training drive, flat affect.
2. **HRV CV rising** while 7-day rolling LnRMSSD drifts down — destabilization before suppression.
3. **Sleep onset latency increasing** with sleep efficiency falling.
4. **Performance at standard sub-max efforts**: HR for a given easy pace creeps up 3–8 bpm.
5. **RHR drifting up over 7+ days**.
6. **Race or interval pace at given HR drops**.

### Confirmation

- Standard sub-max test (e.g., 10-min steady at fixed HR or pace) showing pace decline at constant HR or HR creep at constant pace.
- Persistent ratings of perceived exertion (RPE) elevated for known workouts.

### Coaching response

| Stage | Action |
|---|---|
| Early NFOR (markers + mood, no performance loss) | 7–10 day deload at 50–60% normal volume, no hard intensity |
| NFOR with performance loss | 2–4 week deload; reassess weekly |
| OTS suspected (≥3 weeks of unexplained drop) | Stop structured training; medical workup to rule out other diagnoses (anemia, thyroid, EBV, RED-S) |

---

## Spotting Peak Fitness

The opposite of the overtraining pattern, typically observed in the final 7–14 days of a successful taper:

| Marker | Direction at peak |
|---|---|
| 7-day rolling LnRMSSD | At or above baseline |
| HRV CV | Stable or falling |
| RHR | At or below baseline |
| Sleep | Stable; good efficiency |
| TSB | +5 to +25 |
| VO2max estimate | Trending up over prior 6–12 weeks |
| Sub-max HR-pace test | Pace at fixed HR is at season-best |
| Subjective "snap" / desire to race | High |

A taper with HRV rising and RHR slightly elevated (modest sympathetic activation) plus TSB +10 to +20 commonly precedes best performances. Excessively rested (TSB > +25 for >7 days, HRV high but flat with no race in sight) often presages a flat race day.

---

## Data Privacy

### Coverage status

| Framework | Scope |
|---|---|
| HIPAA | Covered entities and business associates only — Garmin, Whoop, Oura, Apple Health as consumer products are not HIPAA-covered |
| GDPR | EU residents; lawful basis, data subject rights, consent for sensitive health data |
| CCPA / CPRA | California; opt-out of sale |
| WA My Health My Data Act (2024) | Opt-in consent for sharing, separate authorization for sale; first U.S. state law for non-HIPAA health data |

### Practical risks

- Third-party data sharing is widespread: studies have found large fractions of health and fitness apps share data with third parties (often advertising and analytics platforms), frequently without clear user awareness.
- Aggregated metric data (heart rate, sleep, location, step counts) can re-identify individuals.
- Strava's heatmap and segments have historically exposed sensitive locations (military bases, residences); privacy zones exist but require user setup.

### Coaching guidance

When integrating wearable data: use OAuth scopes with minimum required data, store athlete identifiers separately from biometric streams, disclose retention and sharing in plain language, allow export and deletion on request, and default location data to private (explicit opt-in for geographic features).

---

## Multi-Device Sync and Source-of-Truth

### The duplicate problem

Typical bad path: Garmin pushes activity to Strava AND to Apple Health; Strava also pushes to Apple Health. Result: 2–3 copies of the same workout in Apple Health, inflating training load. Most platforms do **not** detect cross-source duplicates.

### Source-of-truth principles

1. **Pick one primary recorder per session class** (e.g., Garmin watch for runs, Stryd footpod for power-led runs, Apple Watch for daily activity).
2. **Pick one analytics platform** (TrainingPeaks, Garmin Connect, Intervals.icu, custom). All training-load math runs there.
3. **One-way sync only**: primary recorder → analytics platform. Disable secondary syncs that loop back.
4. **Aggregator pattern**: tools like RunGap or HealthFit consolidate recordings before pushing to Apple Health, deduplicating at the source.
5. **Manual edit policy**: if a recorder fails (HR dropout, GPS loss), edit the canonical file once at the primary platform; do not re-import.

### Common sync stacks

| Stack | Source of truth | Notes |
|---|---|---|
| Garmin → TrainingPeaks → Strava | Garmin Connect | Standard endurance setup |
| Whoop standalone | Whoop | Recovery-led; does not record GPS workouts |
| Apple Watch → HealthKit | HealthKit | Lacks rich training-load math; pair with TP via 3rd-party |
| Stryd → Stryd PowerCenter → TP | Stryd | Power-led; rTSS is canonical |
| Garmin + Whoop (dual) | Garmin for training, Whoop for recovery | Common; do **not** sum loads from both |

### Specific failure modes

Manual Strava entries overwriting watch auto-sync; time-zone offsets splitting one activity across two calendar days; re-uploads creating phantom duplicates 24–72 hr later; an HR strap connecting to two recorders simultaneously, producing two near-identical files.

### Practical rule

When in doubt: trust the device that recorded raw sensor data (HR, GPS, power) first-hand over any platform that imports a derived view.

---

## Sources

### Peer-reviewed

- Plews DJ, Laursen PB, Stanley J, Kilding AE, Buchheit M. *Training adaptation and heart rate variability in elite endurance athletes: opening the door to effective monitoring.* Sports Med 2013. https://pubmed.ncbi.nlm.nih.gov/23852425/
- Plews DJ, Laursen PB, Kilding AE, Buchheit M. *Heart rate variability in elite triathletes, is variation in variability the key to effective training? A case comparison.* Eur J Appl Physiol 2012. https://pubmed.ncbi.nlm.nih.gov/22367011/
- Plews DJ et al. *Monitoring training with heart rate-variability: how much compliance is needed for valid assessment?* Int J Sports Physiol Perform 2014. https://pubmed.ncbi.nlm.nih.gov/24334285/
- Plews DJ et al. *Heart Rate Variability Applications in Strength and Conditioning.* PMC 2024. https://pmc.ncbi.nlm.nih.gov/articles/PMC11204851/
- Banister EW. *Modeling elite athletic performance.* (1991) Cited via TrainingImpulse: https://www.trainingimpulse.com/banisters-trimp-0
- Hulin BT, Gabbett TJ, et al. *The acute:chronic workload ratio predicts injury: high chronic workload may decrease injury risk in elite rugby league players.* Br J Sports Med 2016. https://pubmed.ncbi.nlm.nih.gov/26511006/
- Impellizzeri FM, Tenan MS, et al. *Acute:Chronic Workload Ratio: Conceptual Issues and Fundamental Pitfalls.* Int J Sports Physiol Perform 2020. https://pubmed.ncbi.nlm.nih.gov/32502973/
- Impellizzeri FM, et al. *What Role Do Chronic Workloads Play in the Acute to Chronic Workload Ratio? Time to Dismiss ACWR and Its Underlying Theory.* Sports Med 2021. https://pubmed.ncbi.nlm.nih.gov/33332011/
- Wang A et al. *Acute to chronic workload ratio (ACWR) for predicting sports injury risk: a systematic review and meta-analysis.* PMC 2025. https://pmc.ncbi.nlm.nih.gov/articles/PMC12487117/
- Saw AE, Main LC, Gastin PB. *Monitoring the athlete training response: subjective self-reported measures trump commonly used objective measures: a systematic review.* Br J Sports Med 2016. https://pmc.ncbi.nlm.nih.gov/articles/PMC4789708/
- Bourdon PC et al. *Single-Item Self-Report Measures of Team-Sport Athlete Wellbeing and Their Relationship With Training Load: A Systematic Review.* PMC 2020. https://pmc.ncbi.nlm.nih.gov/articles/PMC7534939/
- Frank C et al. *Validation of nocturnal resting heart rate and heart rate variability in consumer wearables.* PMC 2025. https://pmc.ncbi.nlm.nih.gov/articles/PMC12367097/
- Chinoy ED et al. *Validity and reliability of the Oura Ring Generation 3 (Gen3) with Oura sleep staging algorithm 2.0 (OSSA 2.0) when compared to multi-night ambulatory polysomnography.* Sleep Med 2024. https://pubmed.ncbi.nlm.nih.gov/38382312/
- Khan SU et al. *The Oura Ring Versus Medical-Grade Sleep Studies: A Systematic Review and Meta-Analysis.* OTO Open 2025. https://aao-hnsfjournals.onlinelibrary.wiley.com/doi/full/10.1002/oto2.70181
- Stickford ASL et al. *Ground Contact Time Imbalances Strongly Related to Impaired Running Economy.* Int J Exerc Sci 2020. https://pubmed.ncbi.nlm.nih.gov/32509121/
- Heiderscheit BC et al. *Altering cadence or vertical oscillation during running: effects on running related injury factors.* PMC 2018. https://pmc.ncbi.nlm.nih.gov/articles/PMC6088121/
- Ramos-Campo DJ et al. Validation of the Stryd Power Meter in Measuring Running Parameters at Submaximal Speeds. PMC 2020. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7404478/
- Cerezuela-Espejo V et al. *Is Stryd critical power a meaningful parameter for runners?* PMC 2023. https://pmc.ncbi.nlm.nih.gov/articles/PMC10286607/
- *Validity of V̇O2max estimates from the Forerunner 245 smartwatch in highly vs. moderately trained endurance athletes.* Eur J Appl Physiol 2025. https://pubmed.ncbi.nlm.nih.gov/40770433/
- Buchheit M. *Monitoring training status with HR measures: do all roads lead to Rome?* (HRV review tradition) — context for HRV interpretation. https://pmc.ncbi.nlm.nih.gov/articles/PMC4840584/
- Carrard J et al. *Diagnosing Overtraining Syndrome: A Scoping Review.* Sports Health 2022. https://pubmed.ncbi.nlm.nih.gov/34496702/
- Kreher JB, Schwartz JB. *Overtraining Syndrome: A Practical Guide.* Sports Health 2012. https://pmc.ncbi.nlm.nih.gov/articles/PMC3435910/
- Bourdillon N et al. *Morning versus Nocturnal Heart Rate and Heart Rate Variability Responses to Intensified Training in Recreational Runners.* Sports Med Open 2024. https://pmc.ncbi.nlm.nih.gov/articles/PMC11541970/
- *Privacy in consumer wearable technologies: a living systematic analysis of data policies across leading manufacturers.* PMC 2025. https://pmc.ncbi.nlm.nih.gov/articles/PMC12167361/
- Apple Watch validity meta-analysis. *npj Digital Medicine* 2025. https://www.nature.com/articles/s41746-025-02238-1

### Manufacturer / authoritative documentation

- TrainingPeaks. *Training Stress Scores (TSS) Explained.* https://help.trainingpeaks.com/hc/en-us/articles/204071944-Training-Stress-Scores-TSS-Explained
- TrainingPeaks. *Normalized Power, Intensity Factor and Training Stress Score.* https://www.trainingpeaks.com/learn/articles/normalized-power-intensity-factor-training-stress/
- TrainingPeaks. *A Coach's Guide to ATL, CTL & TSB.* https://www.trainingpeaks.com/coach-blog/a-coachs-guide-to-atl-ctl-tsb/
- TrainingPeaks. *The Science of the TrainingPeaks Performance Manager.* https://www.trainingpeaks.com/learn/articles/the-science-of-the-performance-manager/
- Garmin. *Body Battery Energy Monitoring.* https://www.garmin.com/en-US/garmin-technology/health-science/body-battery/
- Garmin. *Lactate Threshold (Garmin Technology).* https://www.garmin.com/en-US/garmin-technology/running-science/physiological-measurements/lactate-threshold/
- Garmin. *Vertical Ratio (Garmin Technology).* https://www.garmin.com/en-US/garmin-technology/running-science/running-dynamics/vertical-ratio/
- Garmin Forerunner 965 Owner's Manual — Running Dynamics. https://www8.garmin.com/manuals/webhelp/GUID-0221611A-992D-495E-8DED-1DD448F7A066/EN-US/GUID-62A09512-518A-424A-8491-FE2B80CD2091.html
- Firstbeat Analytics — TRIMP / Training Load. https://www.firstbeat.com/en/blog/what-is-trimp/
- Whoop. *WHOOP Strain: How It Quantifies Your Workload.* https://www.whoop.com/us/en/thelocker/how-does-whoop-strain-work-101/
- Whoop. *WHOOP Recovery: How It Works, Key Metrics, and Tips.* https://www.whoop.com/us/en/thelocker/how-does-whoop-recovery-work-101/
- Stryd. *Critical Power Definition.* https://help.stryd.com/en/articles/6879345-critical-power-definition
- Stryd. *Estimated Critical Power.* https://help.stryd.com/en/articles/8258035-estimated-critical-power
- Polar. *Polar H10 Heart Rate Sensor.* https://www.polar.com/us-en/sensors/h10-heart-rate-sensor
- Polar. *Optical heart rate measurement with Polar Verity Sense / OH1.* https://support.polar.com/us-en/optical-heart-rate-measurement-with-polar-oh1
- COROS. *Training Load — COROS Help Center.* https://support.coros.com/hc/en-us/articles/16237531802772-Training-Load-Your-Metric-for-Success
- COROS. *Training with Running Power on COROS Watch.* https://support.coros.com/hc/en-us/articles/360048461372-Training-with-Running-Power-on-COROS-Watch
- COROS EvoLab — DC Rainmaker explainer. https://www.dcrainmaker.com/2021/05/revamped-training-explainer.html
- TrainingPeaks. *The Coach's Guide to HRV Monitoring.* https://www.trainingpeaks.com/coach-blog/the-coachs-guide-to-hrv-monitoring/
- Marco Altini. *Monitoring HRV: Why the Orthostatic Stressor is Best.* https://marcoaltini.substack.com/p/monitoring-hrv-why-the-orthostatic
- HRV4Training. *Coefficient of Variation (CV): what is it and how can you use it?* https://www.hrv4training.com/blog2/coefficient-of-variation-cv-what-is-it-and-how-can-you-use-it
- DC Rainmaker. *Polar H10 In-Depth Review.* https://www.dcrainmaker.com/2021/12/polar-monitor-review.html
- DC Rainmaker. *Polar Verity Sense In-Depth Review.* https://www.dcrainmaker.com/2021/02/verity-optical-sensor.html
- DC Rainmaker. *Strava / Apple Health sync (3rd-party data).* https://www.dcrainmaker.com/2022/03/strava-abruptly-health.html
- Paubox. *HIPAA compliance in wearable devices.* https://www.paubox.com/blog/hipaa-compliance-in-wearable-devices
