# 03 — Heart Rate Zones and Methodology

A reference for selecting and applying heart rate (HR) zone systems in distance running. Generic only.

## Definitions

| Term | Definition |
|---|---|
| HR | Heart rate, beats per minute (bpm). |
| HRmax | Maximum heart rate, the highest HR achievable in a graded all-out effort. |
| HRrest / RHR | Resting heart rate, measured supine immediately on waking. |
| HRR | Heart Rate Reserve = HRmax − HRrest. |
| LTHR | Lactate Threshold Heart Rate; HR at the maximal lactate steady state, ~1-hour time-trial pace HR. |
| MLSS | Maximal Lactate Steady State; highest workload sustainable without continuous lactate accumulation. |
| AeT | Aerobic Threshold; ~first lactate inflection (~2 mmol/L), bottom of moderate zone. |
| AnT / LT2 | Anaerobic Threshold / second lactate threshold (~4 mmol/L for many subjects, ~MLSS). |
| MAF | Maximum Aerobic Function (Maffetone), aerobic-only HR cap. |
| HRV | Heart Rate Variability, beat-to-beat variation reflecting autonomic state. |
| RMSSD | Root Mean Square of Successive Differences between R-R intervals (ms). |
| LnRMSSD | Natural log of RMSSD; ~0.5 × ln(RMSSD²) ≈ ln(RMSSD). |
| RPE | Rating of Perceived Exertion. |
| VDOT | Daniels' fitness index; pseudo-VO2max from race performance. |
| Pa:HR | Pace-to-HR ratio; aerobic decoupling metric. |

---

## 1. Why Heart Rate as a Training Metric

HR is a non-invasive proxy for cardiovascular work and autonomic state, linking external workload (pace) to internal cost.

### Strengths

- Cheap, continuous, real-time.
- Reflects internal cost across heat, terrain, fatigue.
- Required for HR-based zone systems (Karvonen, MAF, Friel, Daniels HR).

### Limitations and Confounders

| Confounder | Effect at fixed effort | Magnitude |
|---|---|---|
| Cardiac drift (>30 min steady) | Rises | +5–15% over 60 min |
| Heat (≥25°C) | Rises | +5–20 bpm |
| Dehydration (>2% bw) | Rises | +5–10 bpm |
| Sleep deprivation | Rises | +3–10 bpm |
| Caffeine (≥200 mg) | Rises | +3–7 bpm |
| Stress / illness | Rises | +5–15 bpm |
| Beta-blockers | Suppresses | −20 to −40 bpm; zones invalid |
| Cold (<5°C) | Lower at low intensity | −3–5 bpm easy |
| Altitude (>1500 m) | Submax rises, max may fall | +5–10 bpm submax |
| Fasted vs. fueled | Fasted ~3–5 bpm higher | small |
| Onset lag | 30–90 s to plateau | unreliable for short reps |

### Implication

HR is a response, not a measure of effort. Coaching by HR alone fails on hot days, short intervals, fatigued sessions, and steep terrain.

---

## 2. Estimating HRmax — Formulas

### Population formulas

```
Fox (220 − age):           HRmax = 220 − age
Tanaka (2001):             HRmax = 208 − 0.7 × age
Gellish (2007, longitudinal): HRmax = 207 − 0.7 × age
Nes / HUNT (2013):         HRmax = 211 − 0.64 × age
Inbar (1994, treadmill):   HRmax = 205.8 − 0.685 × age
Astrand (1952):            HRmax = 216.6 − 0.84 × age
```

### Accuracy and Standard Error

| Formula | Year / N | SEE (bpm) | Notes |
|---|---|---|---|
| Fox (220−age) | 1971, n≈35 | ~10–15 | Casual rule; biased high under 30, low over 40. |
| Tanaka | 2001, meta n=18,712 + lab n=514 | ±10 | r=−0.90; better than Fox over age 40. |
| Gellish | 2007, n=908 long. | ~7 | Comparable to Tanaka. |
| Nes (HUNT) | 2013, n=3,320 | ±10.8 | No interaction with sex/fitness/BMI. |
| Inbar | 1994 | ~6.4 | Treadmill-derived. |
| Astrand | 1952 | ~10 | Older cycle-ergometer sample. |

### Practical Rule

- Age-based formulas: 95% CI ≈ ±20 bpm individually; ~68% within ±10–12 bpm.
- Under 40: **Tanaka or Gellish** beat 220−age.
- Older/broader: **Nes/HUNT** is the largest current dataset.
- Field- or lab-measured HRmax is always preferred when available.

### Choosing a Formula

| Profile | Formula |
|---|---|
| General adult, no test data | Tanaka or Nes |
| Marathon runner (men) | Tanaka |
| Marathon runner (women) | Tanaka over-predicts ~5 bpm; subtract 5 |
| Athlete >50 | Nes (largest older sample) |
| Children/adolescents (<16) | None reliable |
| Highly trained / elite | Field test required |

---

## 3. Field-Testing HRmax

Field test beats any formula. **Contraindicated** for cardiac patients, untrained adults >40 without medical clearance, or anyone with hypertension.

**Protocol A — McMillan flat-then-hill.** 10–15 min warm-up + strides. 4 × 1 min hard on flat (2 min jog rest). Then 3–4 × hill (4–7% grade, 40–60 s) all-out, jog-down recovery, until consecutive peaks match. Peak observed = HRmax.

**Protocol B — 2400 m / 1.5 mi all-out.** 15 min warm-up + strides. Run 2400 m building each lap; sprint last 200 m. Peak HR within 5–6 s of finish.

**Protocol C — Treadmill ramp.** 10 min warm-up. 1% grade, start 8 km/h. Increase 1 km/h every 60 s; sprint final 30 s at max grade tolerable. Peak = HRmax.

### Common Errors

- Reading average HR instead of peak.
- Stopping at "felt hard" rather than volitional exhaustion.
- Wrist optical sensor — discard, use chest strap.
- Test in heat, illness, or sleep debt — undershoots; retest.

Reproducibility on retest 1–2 weeks later: ±3 bpm. Sudden spikes are usually motion artifact.

---

## 4. % HRmax Zones (5- and 7-Zone Systems)

### 5-Zone (ACSM / generic / commercial wearables)

| Zone | % HRmax | Purpose | Talk test |
|---|---|---|---|
| 1 Recovery | 50–60% | Active recovery, walking | Full conversation |
| 2 Easy / Aerobic | 60–70% | Aerobic base, fat oxidation | Full sentences |
| 3 Aerobic / Tempo | 70–80% | Aerobic capacity | Short phrases |
| 4 Threshold | 80–90% | LT, race pace | Few words |
| 5 VO2max / Anaerobic | 90–100% | Top-end aerobic, anaerobic | Single words / none |

### 7-Zone (British Cycling-style, adapted for running)

| Zone | % HRmax | Description | Typical duration |
|---|---|---|---|
| 1 Active recovery | <60% | Shake-out | ≤30 min |
| 2 Endurance | 60–70% | Long, easy aerobic | 60 min – 4 h |
| 3 Tempo | 70–80% | Marathon pace, steady | 30–90 min |
| 4 Sub-threshold (LT1) | 80–87% | Comfortably hard | 20–60 min |
| 5 Threshold (LT2) | 87–92% | Cruise intervals | 8 × 5 min |
| 6 VO2max | 92–98% | 3–5 min reps | 5 × 3 min |
| 7 Anaerobic / neuro | 98–100%+ | <90 s | 8–12 × 30 s |

### Caveat

%HRmax zones ignore RHR and individual fitness. Two athletes with the same HRmax but very different RHR get the same zone bpm but vastly different relative intensity. Karvonen and LTHR systems address this.

---

## 5. Heart Rate Reserve / Karvonen Method

### Formula

```
HRR = HRmax − HRrest
Target HR = HRrest + (HRR × intensity%)
```

### Karvonen 5-Zone Table

Example HRmax=190, HRrest=50, HRR=140:

| Zone | %HRR | bpm |
|---|---|---|
| 1 Recovery | 50–60% | 120–134 |
| 2 Endurance | 60–70% | 134–148 |
| 3 Aerobic | 70–80% | 148–162 |
| 4 Threshold | 80–90% | 162–176 |
| 5 VO2max | 90–100% | 176–190 |

### Karvonen vs. %HRmax

For a given % target, %HRR yields a higher absolute HR than %HRmax because RHR is the floor, not zero. Example HRmax=190, RHR=50:

| % | %HRmax bpm | %HRR bpm | Δ |
|---|---|---|---|
| 60 | 114 | 134 | +20 |
| 70 | 133 | 148 | +15 |
| 80 | 152 | 162 | +10 |
| 90 | 171 | 176 | +5 |
| 100 | 190 | 190 | 0 |

The two converge at HRmax. At low intensities, %HRR is ~10–20 bpm higher.

### When to Use

Karvonen requires accurate RHR **and** HRmax — substituting an estimated HRmax compounds error. Better than %HRmax for athletes with extreme RHR (very trained or very deconditioned). Standard in cardiac rehab and ACSM prescription.

---

## 6. Lactate Threshold HR (LTHR) — Friel System

### Why LTHR-Based Zones

LTHR is more individual than HRmax. Two athletes with same HRmax can have LTHRs 20+ bpm apart. Anchoring to LTHR maps zones to physiological transitions (LT1, LT2, MLSS).

### Determining LTHR — 30-Minute Time Trial (Friel)

1. Solo, flat (track or road), no draft, no pacers.
2. 15 min warm-up + strides.
3. 30 min hard TT — controlled start, strong finish; ~10K race effort.
4. Press lap at 10 min.
5. **LTHR = average HR during final 20 min.**
6. Re-test every 6–12 weeks.

The 30-min TT was the only field method (of four tested) whose HR estimate did not significantly differ from blood-lactate-determined LTHR.

### Friel 7-Zone Running HR Table

| Zone | % LTHR | Description |
|---|---|---|
| 1 Recovery | < 85% | Recovery, easy active days |
| 2 Aerobic / Endurance | 85–89% | Long-run aerobic base |
| 3 Tempo | 90–94% | Sub-LT steady |
| 4 SubThreshold | 95–99% | Just below LT |
| 5a Threshold | 100–102% | At LT — cruise intervals |
| 5b Aerobic capacity | 103–106% | VO2max work, 3–5 min |
| 5c Anaerobic capacity | > 106% | Short reps, neuromuscular |

### Friel Pace Zones (Companion)

Anchored to functional threshold pace (FTP, ~30-min TT pace).

| Zone | % FTP pace |
|---|---|
| 1 | slower than 129% |
| 2 | 114–129% |
| 3 | 106–113% |
| 4 | 99–105% |
| 5a | 97–100% |
| 5b | 90–96% |
| 5c | faster than 90% |

Pace zones use **inverse** % — slower pace = higher % of threshold pace.

### Strengths / Weaknesses

- More individual than %HRmax; no RHR required.
- LTHR shifts upward with fitness — re-test gives a feedback signal.
- Requires ~30 min all-out; not for beginners or when fatigued.
- Chest strap mandatory on TT (optical lags/clips).

---

## 7. MAF Method (Maffetone)

The MAF Method targets aerobic-only training to develop fat oxidation and aerobic enzyme density without acidic stress.

### Formula

```
Base MAF HR = 180 − age
```

### Adjustments (Maffetone categories)

| Cat | Description | Adj |
|---|---|---|
| (a) | Sick / on medication / >2 colds-flus/year / chronic injury | −10 |
| (b) | Injured, regressing, frequent colds, allergies, asthma | −5 |
| (c) | Healthy, training consistently up to 2 years, progressing | 0 |
| (d) | ≥2 yrs consistent, no problems, competitive progress | +5 |

### Special Cases

- Age >65, cat (d): may add up to 10 (not automatic).
- Age ≤16: formula invalid; use 165 bpm cap.
- Beta-blockers: formula invalid.

### Application

- All aerobic training capped at or below MAF HR during the base phase (2–4 months minimum).
- Tracked via **MAF Test**: standardized run (e.g., 5 km on track) at MAF HR, repeated monthly. Improving pace at fixed MAF HR = improving aerobic efficiency. Plateau or regression signals overtraining, illness, or stress.

### Strengths / Weaknesses

- Simple, conservative, low injury risk; built-in progress test.
- Often very low for younger trained athletes (age 30 → 150 bpm cap); critiqued as under-estimating AeT in highly trained.
- Not a complete training system; lacks high-intensity prescription.

---

## 8. Daniels' HR Zones

Daniels prescribes by pace (anchored to VDOT) but provides %HRmax/%HRR ranges per intensity.

| Daniels intensity | %HRmax | %HRR / VO2max | Purpose | Typical duration |
|---|---|---|---|---|
| E (Easy) | 65–78% | 60–75% VO2max | Aerobic base, recovery | 30 min – 2.5 h |
| M (Marathon) | 80–85% | 75–84% VO2max | Marathon-specific endurance | up to 110 min |
| T (Threshold) | 86–92% | 83–88% VO2max | LT / "comfortably hard" | reps 5–20 min, total 20–60 min |
| I (Interval / VO2max) | 95–100% | 95–100% VO2max | VO2max | 3–5 min reps, total ≤8% weekly mileage |
| R (Repetition) | n/a (HR lags) | speed/economy | Neuromuscular, economy | 30 s–2 min reps, full recovery |

### Notes

Daniels uses HR as a confirmation tool, not the primary prescription — pace at VDOT-derived target is the anchor. **R** workouts: HR unreliable (short, no steady state); coach by pace + RPE. **E** runs: stay in the lower band; cap ~75% HRmax for true easy pace.

---

## 9. Resting HR Baseline & Recovery Indicators

### Establishing Baseline RHR

Measure on waking, supine, before standing or coffee. Chest strap or oximeter preferred; wrist optical at rest is adequate. Average over **14 days** of normal training; recompute every 4–8 weeks.

### Typical RHR Bands

| Status | RHR (adult) |
|---|---|
| Elite endurance | 30–45 |
| Trained recreational | 45–55 |
| Generally fit | 55–65 |
| Average sedentary | 65–80 |
| Elevated / unfit / stressed | >80 |

(RHR runs 5–10 bpm higher in women than men on average.)

### Recovery Decision Rules

| RHR vs. baseline (morning) | Action |
|---|---|
| Within ±3 bpm | Train as planned |
| +4–6 bpm | Reduce intensity; replace quality with aerobic |
| +7+ bpm | Easy day or rest |
| +5+ bpm sustained ≥3 days | Suspect overtraining, illness, dehydration |
| +10+ bpm | Rest; investigate (illness, sleep loss) |
| Upward drift over 2–3 weeks | Reduce load (over-reaching) |
| Suppressed RHR + suppressed HRV | Possible parasympathetic overtraining (rare) |

Day-to-day RHR has natural ±3–4 bpm noise. Confounders: dehydration, alcohol, undereating. HRV is more sensitive than RHR alone.

---

## 10. HRV — Heart Rate Variability

### Concept

HRV = beat-to-beat variation in time. Higher HRV → greater parasympathetic (vagal) tone, a marker of recovery and readiness.

### Metrics

| Metric | Definition | Use |
|---|---|---|
| RMSSD | Root mean square of successive R-R differences (ms). | Primary daily metric, vagally-mediated. |
| LnRMSSD | ln(RMSSD), or some apps multiply by 20 for a 0–100 score. | Linearizes scale; reduces skew; used for trend tracking. |
| SDNN | Standard deviation of NN intervals (ms). | Influenced by both branches; less specific to recovery. |
| pNN50 | % of beat pairs >50 ms apart. | Older parasympathetic index. |
| HF Power | High-frequency spectral power. | Pure parasympathetic; requires longer recording. |

For daily training decisions, **RMSSD or LnRMSSD** is standard.

### Daily Protocol

Within ~5 min of waking, supine, calm breathing. 1 min stabilization + 1 min recording. Same time, posture, conditions daily.

### Interpreting Daily vs. Trend

| Pattern | Interpretation |
|---|---|
| Daily within "normal range" (±0.5–1 SD of 7-day rolling mean) | Train as planned |
| Daily drop >1 SD below 7-day mean | Reduce intensity for that day |
| Daily drop ~20% below baseline | Poor recovery; replace with easy or rest |
| 7-day rolling mean rising over weeks | Positive adaptation |
| 7-day rolling mean stable + acute drops normalize | Functional training stress |
| 7-day rolling mean declining over 2+ weeks + elevated RHR | Non-functional overreaching, reduce load |
| Elevated CV of HRV (RMSSDcv) >10–14% | Increased acute perturbation; if persistent, overload |
| Suppressed HRV with suppressed RHR | Parasympathetic overtraining (rare, advanced) |

### CV (Coefficient of Variation)

```
CV = SD(RMSSD) / mean(RMSSD) × 100%
```

| Population | RMSSDcv |
|---|---|
| Elite endurance | 5–8% |
| Recreational | 8–12% |
| Intensified block | 8–14% |
| Non-functional overreaching | >14% |

### Practical Rule

A single HRV value is noise. Use 7-day rolling average vs. individual normal range (rolling mean ± SD or ±20%). Act on trend, not single readings.

---

## 11. HR vs. Pace — When They Align, When They Diverge

### Alignment Conditions

HR and pace track each other on flat consistent courses, mild weather (~10–15°C, low humidity, no wind), with athletes rested/hydrated/fueled, in steady-state efforts >10 min, without heavy training residue.

### Divergence Patterns

| Condition | Pace | HR | True effort |
|---|---|---|---|
| Headwind | Slows | Same | HR |
| Tailwind | Fastens | Same | HR |
| Uphill | Slows | Rises | HR |
| Downhill | Fastens | Same/lower | Mixed |
| Hot day | Slows | Rises | HR |
| Dehydrated long run | Slows | Rises | HR |
| Fatigue residue | Same/slower | Higher | HR |
| Detrained/sick | Slower | Higher | HR (stop) |
| Short interval (<2 min) | On target | Lags | Pace+RPE |
| Sprint (<30 s) | On target | Far below | Pace+RPE |
| Beta-blockers | Same | Suppressed | Pace+RPE |
| Altitude (acclim.) | Slows | Submax up, max down | HR |

### Coaching Implication

Easy/long aerobic: prioritize HR (it captures fatigue and conditions). Threshold/tempo: use both; if disagreement, trust the lower-intensity signal. VO2max intervals (3–5 min): pace primary, confirm HR reaches band. Reps/sprints: pace and RPE only.

---

## 12. Cardiac Drift and Aerobic Decoupling (Pa:HR)

### What it is

In sustained efforts, HR rises while pace stays constant — **cardiac drift**. Driven by rising core temperature, plasma volume loss (sweat), glycogen depletion, and cumulative cardiovascular fatigue.

### Quantifying — Pa:HR Decoupling

Compare first vs. second half of a steady aerobic run (60–90 min).

```
EF = speed / HR    (use speed, not min/km)
Pa:HR Decoupling = ((EF_1st_half / EF_2nd_half) − 1) × 100%
```

### Interpretation

| Decoupling % | Meaning |
|---|---|
| <5% | Strong aerobic endurance; sustainable |
| 5–8% | Acceptable; approaching aerobic limit |
| 8–10% | Endurance gap; build base before progressing |
| >10% | Above aerobic threshold or insufficient endurance |

### Use

- Track monthly: fixed 60-min run at presumed AeT pace; decoupling should fall.
- Goal: <5% decoupling at progressively faster pace.
- Heat adds 2–5% artifactually — control conditions.
- A well-paced marathon shows <5% Pa:HR decoupling at 30 km. High early decoupling = inadequate base or too-aggressive start.

---

## 13. Why HR is Unreliable for Short Intervals

### HR Kinetics

HR rises with a half-time of ~30 s on intensity step-up, plateauing at 90–180 s. Recovery half-time ~30 s, slower in fatigue or heat.

### Implications by Rep Duration

| Rep length | HR utility | Anchor |
|---|---|---|
| <30 s (sprints, R) | Useless — HR lags | Pace, RPE |
| 30–90 s | Late-rep HR meaningful | Pace primary |
| 90 s–3 min | Reaches band only late | Pace primary |
| 3–5 min (classic VO2) | Reaches band mid-rep | Pace + HR |
| 5–15 min (T) | Steady state achievable | HR + pace |
| ≥15 min | HR reliable | HR primary |

### Recovery Periods

HR is a **poor index of true recovery**: peer-reviewed work (Sangan 2015) found recovery HR rising across rep blocks even when subjective recovery was met, concluding fixed-HR cutoffs are unreliable. Use fixed time-recovery (1:1 work-rest, fixed-duration jog).

---

## 14. Decision Logic — Coach by HR vs. Pace vs. RPE

### Decision Table

| Workout type | Primary | Secondary | Notes |
|---|---|---|---|
| Recovery jog | HR | RPE | Cap HR; ignore pace |
| Easy aerobic | HR | RPE | HR cap (MAF or Z2) |
| Long run (steady) | HR | RPE | Expect mild drift |
| Long run with fast finish | Pace | HR | Target pace last 25% |
| Marathon-pace run | Pace | HR | M-pace anchored to goal |
| Tempo (continuous) | HR or Pace | RPE | Both valid >15 min |
| Threshold reps (5–15 min) | Pace | HR | Pace primary, HR confirms |
| VO2max reps (3–5 min) | Pace | RPE | HR lags, reaches band by rep 2–3 |
| VO2max short (<3 min) | Pace | RPE | Ignore HR target |
| Reps / R-pace (<2 min) | Pace | RPE | Ignore HR |
| Strides / sprints | Effort | Pace | No HR target |
| Hill repeats | RPE | HR | Pace meaningless |
| Race (5K–HM) | Pace + RPE | HR | HR informs pacing |
| Race (marathon+) | Pace early, HR later | RPE | HR cap first 20 km |
| Trail / mountain | HR | RPE | Pace unusable |
| Hot weather any session | HR + RPE | — | Pace targets invalid |
| Sick / illness recovery | HR + RPE | — | Pace meaningless |
| Beta-blocker user | RPE | Pace | HR invalid |

### Master Rule

Pace = objective external (what got done). HR = physiological internal (what it cost). RPE = integrated perceived. Coach by the metric reflecting the adaptive stimulus: internal (HR/RPE) for aerobic/recovery work, external (pace) for VO2max and speed.

---

## 15. Wrist Optical vs. Chest Strap Accuracy

### Technologies

- **Chest strap (electrode):** ECG-equivalent. Polar H10, Garmin HRM-Pro, Wahoo TICKR.
- **Wrist optical (PPG):** photoplethysmography. Apple Watch, Garmin Forerunner, Fitbit.
- **Arm/forearm optical:** tighter fit than wrist, less motion artifact (Polar OH1, Verity Sense, Whoop).

### Accuracy Summary

| Device class | Steady running | Intervals | Sprints |
|---|---|---|---|
| Chest strap | ±1–2 bpm (lab gold) | ±1–2 bpm | ±1–2 bpm |
| Wrist optical | ±3–10 bpm | ±5–15 bpm, lag 5–15 s | Frequently 20–40 bpm off |
| Arm optical | ±2–5 bpm | ±3–8 bpm | ±5–15 bpm |

### Key Validation Findings

- Polar H7 chest strap: rc ≈ 0.98 vs. ECG.
- Wrist devices (Apple Watch, Fitbit, Garmin Vivosmart, TomTom Spark): rc ≈ 0.89–0.96.
- Optical accuracy degrades as intensity rises and during rapid intensity changes.
- Skin pigmentation, wrist hair, tattoos, cold, sweat, and loose strap all worsen optical readings.

### Common Wrist Optical Failure Modes

- **Cadence lock:** sensor reports cadence (steps/min) instead of HR, often "stuck" at 150–180.
- **Slow rise:** HR shows 130 when chest strap shows 165 in first minute of a hard rep.
- **Drop-out:** HR briefly reads zero or implausibly low.

### Recommendations

| Use case | Sensor |
|---|---|
| LTHR field test | Chest strap mandatory |
| HRmax field test | Chest strap mandatory |
| HRV daily | Chest strap or oximeter |
| Easy steady runs | Wrist optical adequate |
| Race / marathon | Chest strap preferred |
| Intervals / threshold | Chest strap strongly preferred |
| RHR (waking, still) | Wrist optical adequate |

---

## 16. Lab Testing and Alternatives

### Gold-Standard Tests

| Test | Measures | Cost (USD) |
|---|---|---|
| Gas exchange (VO2max + VT) | True VO2max, VT1, VT2, RER | $150–400 |
| Blood lactate step test | LT1 (~2 mmol), LT2 (~4 mmol), curve | $100–250 |
| MLSS (multi-day) | True maximal lactate steady state | $400+ |
| ECG stress test | HRmax + cardiac safety | $200–600 |

### Portable Lactate Analyzers

| Device | Time | Sample | Notes |
|---|---|---|---|
| Lactate Pro 2 | 15 s | 0.3 µL | Auto-cal, common for athletes |
| Lactate Scout | 10 s | 0.5 µL | Field-friendly |
| Lactate Plus | 13 s | 0.7 µL | Common in coaching |
| EDGE meter | 45 s | small | Lab-accuracy in field tests |

### Step Test Protocol (Treadmill)

1. 15-min warm-up; resting lactate sample (~1.0 mmol/L).
2. Stages of **3–5 minutes** at increasing speed; blood sample within 30 s of stage end.
3. Speed increments: ~0.5–1.0 km/h per stage.
4. Continue until lactate > 4 mmol/L or volitional fatigue.
5. Plot lactate vs. speed; LT1 = first sustained rise, LT2 = ~4 mmol/L or D-max inflection.
6. Read HR at each threshold → physiologically calibrated LTHR.

### Field Alternatives

| Method | Output | Cost |
|---|---|---|
| 30-min TT (Friel) | LTHR | Race-like |
| 5K race | HRmax + LTHR (~95% LTHR ≈ 5K HR) | Race |
| 1.5-mi / 2400 m | HRmax | High |
| McMillan hill | HRmax | Moderate-high |
| Talk test | Approximate AeT HR | Easy |
| MAF Test (monthly) | Aerobic efficiency trend | Easy |
| 60-min drift run | AeT validation via Pa:HR | Moderate |

### Talk-Test Validation of AeT

Increase pace by 10 s/km every 5 min from easy. Stop when full sentences become uncomfortable. HR at the transition ≈ LT1/AeT.

---

## 17. Picking a System — Decision Table

| Data quality / context | Recommended primary system |
|---|---|
| No HRmax, no RHR, no test | %HRmax via Tanaka/Nes; treat as approximate |
| Reliable RHR + field-tested HRmax | Karvonen %HRR |
| Reliable LTHR (30-min TT) | Friel 7-zone or Daniels HR |
| Lab lactate test | Individualized lactate-based; map to HR |
| Lab gas exchange | VT1/VT2 anchored zones |
| Healthy beginner, base building | MAF (180 − age + adjustments) |
| Returning from injury / illness | MAF with −5 or −10 |
| Trail / mountain / variable terrain | HR primary (Karvonen or LTHR), pace secondary |
| Track / road racing focus | Daniels (pace primary, HR confirm) |
| Beta-blocker / cardiac med user | RPE primary; HR zones invalid |

### Conversion Between Systems

Approximate equivalences for a "Z2 easy" run:

```
%HRmax 65–75%  ≈  %HRR 60–72%  ≈  %LTHR 75–88%  ≈  Daniels E
```

For "Threshold":

```
%HRmax 86–92%  ≈  %HRR 83–90%  ≈  %LTHR 95–102%  ≈  Daniels T
```

Exact crosswalks differ by athlete (RHR, LTHR/HRmax ratio). If two systems disagree, the more individualized one (LTHR > Karvonen > %HRmax) wins.

---

## 18. Coaching Heuristics

- Morning RHR +7 bpm above baseline → easy day.
- HRV trending down 5+ days + RHR trending up → unload week.
- Cardiac drift >5% in a Z2 run that previously showed <5% → heat, fatigue, or detraining.
- HR not reaching VO2max band by rep 3 of 5 × 3 min → pace too slow.
- Easy-pace HR dropping at fixed pace over weeks → aerobic adaptation working.
- Easy-pace HR rising at fixed pace over weeks → under-recovery or stress.

---

## Sources

### Peer-reviewed primary literature

- Tanaka H, Monahan KD, Seals DR. Age-predicted maximal heart rate revisited. *J Am Coll Cardiol.* 2001;37(1):153–156. https://pubmed.ncbi.nlm.nih.gov/11153730/
- Gellish RL, et al. Longitudinal modeling of the relationship between age and maximal heart rate. *Med Sci Sports Exerc.* 2007;39(5):822–829. https://pubmed.ncbi.nlm.nih.gov/17468581/
- Nes BM, et al. Age-predicted maximal heart rate in healthy subjects: The HUNT Fitness Study. *Scand J Med Sci Sports.* 2013. https://onlinelibrary.wiley.com/doi/10.1111/j.1600-0838.2012.01445.x
- Shookster D, et al. Accuracy of Commonly Used Age-Predicted Maximal Heart Rate Equations. *Int J Exerc Sci.* 2020. https://pmc.ncbi.nlm.nih.gov/articles/PMC7523886/
- Sangan HF, et al. Heart Rate Unreliability during Interval Training Recovery in Middle Distance Runners. *J Sports Sci Med.* 2015. https://pmc.ncbi.nlm.nih.gov/articles/PMC4424478/
- Bosquet L, et al. Increased Morning Heart Rate in Runners: A Valid Sign of Overtraining? *Int J Sports Physiol Perform.* 2016. https://pubmed.ncbi.nlm.nih.gov/27442738/
- Plews DJ, et al. Heart Rate Variability and Training Intensity Distribution in Elite Rowers. *Int J Sports Physiol Perform.* (related work). https://www.scienceforsport.com/heart-rate-variability-hrv/
- Cipryan L. Heart rate variability is related to training load variables in interval running exercises. *J Strength Cond Res.* 2011. https://pubmed.ncbi.nlm.nih.gov/21678140/
- Wang R, et al. Monitoring Training Adaptation and Recovery Status in Athletes Using HRV via Mobile Devices: A Narrative Review. *Sensors.* 2026. https://www.mdpi.com/1424-8220/26/1/3
- Shaffer F, Ginsberg JP. An Overview of Heart Rate Variability Metrics and Norms. *Front Public Health.* 2017. https://pmc.ncbi.nlm.nih.gov/articles/PMC5624990/
- Mühlen JM, et al. Validity of heart rate measurements in wrist-based monitors across skin tones during exercise. *PLOS One.* 2025. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0318724
- Pasadyn SR, et al. Wrist-worn optical and chest strap heart rate comparison. *BMC Sports Sci Med Rehabil.* 2018. https://link.springer.com/article/10.1186/s13102-018-0098-0
- Crouter SE, et al. Accuracy of commercially available heart rate monitors in athletes: a prospective study. 2019. https://pmc.ncbi.nlm.nih.gov/articles/PMC6732081/
- Tanisawa K, et al. Maximum Aerobic Function: Clinical Relevance, Physiological Underpinnings, and Practical Application. 2020. https://pmc.ncbi.nlm.nih.gov/articles/PMC7142223/
- Crotty NM, et al. HRV Applications in Strength and Conditioning. 2024. https://pmc.ncbi.nlm.nih.gov/articles/PMC11204851/
- Tanaka K, et al. Age-Predicted Maximal Heart Rate in Recreational Marathon Runners. *Front Physiol.* 2018. https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2018.00226/full

### Authoritative coaching and reference

- Daniels J. *Daniels' Running Formula.* 4th ed. Human Kinetics, 2021. (E/M/T/I/R intensities and HR ranges.) https://medium.com/runners-life/the-training-intensities-of-jack-daniels-c63821c79205
- Friel J. *The Triathlete's Training Bible.* (LTHR-based 7-zone system.) https://joefrieltraining.com/a-quick-guide-to-setting-zones/
- Friel J. Determining your LTHR. https://joefrieltraining.com/determining-your-lthr/
- Friel J. A Quick Guide to Setting Zones. *TrainingPeaks.* https://www.trainingpeaks.com/learn/articles/joe-friel-s-quick-guide-to-setting-zones/
- Maffetone P. The MAF 180 Formula. https://philmaffetone.com/180-formula/
- Maffetone P. Adjustments to the MAF 180 Formula. https://philmaffetone.com/dr-phil-maffetone-adjustments-to-the-180-formula/
- Karvonen J, Vuorimaa T. Heart rate and exercise intensity during sports activities. Practical application. *Sports Med.* (Karvonen formula derivation.)
- TrainingPeaks. Aerobic Decoupling (Pa:HR / Pw:HR) and Efficiency Factor (EF). https://help.trainingpeaks.com/hc/en-us/articles/204071724-Aerobic-Decoupling-Pw-Hr-and-Pa-HR-and-Efficiency-Factor-EF
- Uphill Athlete. Understanding the Heart Rate Drift Test. https://uphillathlete.com/aerobic-training/heart-rate-drift/
- Uphill Athlete. Blood Lactate Test Protocol. https://uphillathlete.com/aerobic-training/blood-lactate-test-protocol-tips-and-tricks/
- McMillan G. Max Heart Rate Calculator: 4 Formulas + Field Test. https://www.mcmillanrunning.com/max-heart-rate-calculator/
- HRV4Training. QuickStart Guide. https://www.hrv4training.com/quickstart-guide.html
- EliteHRV. Improving HRV Data Interpretation: Coefficient of Variation. https://elitehrv.com/improving-hrv-data-interpretation-coefficient-variation
- American College of Cardiology. Wrist-worn HR monitors less accurate than chest strap. 2017. https://www.acc.org/about-acc/press-releases/2017/03/08/14/02/wrist-worn-heart-rate-monitors-less-accurate-than-standard-chest-strap
- Friel J. Field protocol notes; 30-min TT validation discussion. https://relentlessforwardcommotion.com/running-lactate-threshold-test/
- 80/20 Endurance. Intensity Guidelines. https://www.8020endurance.com/intensity-guidelines-for-80-20-running/
