# D1 — Recovery Score Methodology

A composite recovery / readiness score is the most-used surface element in any modern athlete app. It is also the most commonly mis-built — overweighted toward sleep, underweighted toward training context, opaque about *why*, and prone to the "score doesn't match how I feel" trust failure that sinks the rest of the product.

This document compares how the leading platforms compute their scores, evaluates each input against the running-specific evidence, and proposes a concrete algorithm for this app. It assumes the reader has skimmed `research/15-wearable-data.md` (RHR, HRV, sleep, training-load metrics, sensor accuracy) and `research/00b-recovery-protocols.md` (the three timescales of recovery).

---

## 1. Comparative Table — Leading Platforms

| Platform | Inputs | Disclosed weights / logic | Output | Baseline window | Update cadence |
|---|---|---|---|---|---|
| **Whoop Recovery** | HRV (RMSSD), RHR, sleep performance, sleep need, respiratory rate, skin temp, SpO₂; 3–7-day strain history | Roughly 60% morning HRV vs. baseline; sleep ~20%; remainder split across RHR, respiratory rate, skin temp, recent strain (proprietary) | 0–100% with traffic-light bands: red 1–33, yellow 34–66, green 67–100 | ~30-day rolling for HRV/RHR baseline; sleep need is a daily target derived from prior nights | Once per morning, on wake detection; updated with naps |
| **Oura Readiness** | Sleep score, sleep balance (14-day), HRV balance (14-day vs. 60-day), RHR, body temp deviation, recovery index (HR drop in early sleep), activity balance (14-day), previous-day activity | Seven contributors visible to user; weights not fully disclosed; "balance" contributors use 14-day weighted (last 2–5 days slightly heavier) vs. 60-day | 0–100, plus contributor cards labeled Optimal / Pay attention / Needs attention | 60-day long-term, 14-day medium-term | Once per morning; updates after naps |
| **Garmin Body Battery** | All-day HRV (RMSSD-derived stress), activity drain (heart-rate cost), sleep quality+duration | Firstbeat black-box energy-reserve model; charges during low-stress/sleep, drains during stress/activity | 5–100 (continuously updating) | Personalized stress baseline | Continuous (all-day) |
| **Garmin Training Readiness** | HRV Status (7-day vs. 3-week baseline), sleep score, sleep history (3 days), recovery time remaining, acute load (7-day), stress history | Firstbeat composite; recovery-time multiplier dominates immediately post-hard session; HRV trend dominates day-to-day | 0–100 with bands: Poor 0–24, Low 25–49, Moderate 50–74, High 75–89, Prime 90–100 | 3-week HRV baseline; 4-week training load | Morning + after workouts |
| **Polar Nightly Recharge** | ANS charge (RMSSD + breathing rate during first ~4h sleep) + Sleep charge (Sleep Plus Stages) | Two equally weighted components; each compared to user's prior 28-day average | -3 to +3 scale per component, plus 5-band combined word ("Compromised"/"OK"/"Good"/etc.) | 28 days | Once per morning |
| **Morpheus Recovery** | Morning HRV (chest strap or arm band), sleep, training load, activity, subjective feel | Proprietary ML; outputs a recovery % AND re-zones today's HR training zones | 0–100% with three zones (blue recovery / green conditioning / red overload) drawn around current state | Rolling individual baseline | Once per morning |
| **Elite HRV / HRV4Training** | Morning HRV (RMSSD, app- or strap-based), optional subjective tags | Plews/Laursen baseline: mean ± 0.5×SD over 60 days; flags meaningful drops | Color-banded LnRMSSD reading + advice text | 60-day mean and SD | Daily (user-initiated reading) |
| **Apple Watch — Vitals** | HRV, RHR, respiratory rate, wrist temp, SpO₂ | Per-metric typical-range comparison; outlier triggers a notification when ≥2 metrics out-of-range | Per-metric "Typical / Outlier" — no composite score | 7+ nights to establish range; ongoing | Once per morning |
| **Apple Watch — Training Load** (watchOS 11+) | Workout-derived effort + HR | Internal rolling effort load; surfaces "well below / steady / above" relative to 28-day baseline | Word-band ("Well below" → "Well above"); no recovery score per se | 28-day | Per workout |
| **Athlytic** (third-party) | Apple Health HRV, RHR, sleep, respiratory rate, wrist temp, blood oxygen | Whoop-style composite over 60-day rolling baseline | 0–100% Recovery + Target Exertion range | 60-day | Morning + workouts |
| **Coros EvoLab Run / Recovery** | Training load (TL), HR, sleep, prior workouts | Recovery time hours (similar to Garmin) + a stamina-style fitness model | Recovery hours; no 0–100 readiness score | Rolling | Per workout + morning |

### Cross-platform observations

- All credible scores share the same physiological core: **HRV trend, RHR trend, sleep, recent training load**. The differentiation is in (a) which body-temp / respiratory / SpO₂ sub-signals are added, (b) how baselines are computed, and (c) presentation.
- The same night's data routinely produces scores 20+ points apart between Whoop, Oura, and Garmin. The score is not an absolute quantity; it's an internal, opinionated read on one platform's baseline.
- Two display patterns dominate: **0–100 number with traffic-light** (Whoop, Garmin Training Readiness, Athlytic) or **0–100 number with contributor cards** (Oura). Polar uses a word-band; Morpheus blends a number with re-zoned HR training zones.
- Garmin and Whoop both incorporate a *training-load history* signal — not just biometric state. This matters: identical HRV after a hard week and after an easy week mean different things.
- Apple's stance is pointedly different: per-metric "typical/outlier" with no composite, on the explicit thesis that consumer composites over-claim certainty.

---

## 2. Inputs Analysis — What the Science Says, How Platforms Use It

### 2.1 Heart Rate Variability (HRV)

**Science.** RMSSD (or LnRMSSD) is the field-standard time-domain HRV metric — vagally mediated, fastest to recover after training, and the metric Plews and Laursen built their endurance-monitoring framework on. Single-day HRV is noisy; the 7-day rolling average is the actionable unit. A change is meaningful only when it exceeds the smallest worthwhile change (SWC ≈ 0.5 × SD of the 60-day baseline). Absolute HRV varies 5–10× between individuals — only intra-individual trends matter. (`research/15-wearable-data.md`)

**Platform usage.** Whoop weights HRV ~60% of recovery; Oura uses both yesterday's HRV and 14-day HRV Balance; Garmin's HRV Status is its load-bearing readiness signal. Polar's ANS Charge is essentially HRV + breathing rate. HRV4Training and Elite HRV expose HRV almost rawly with Plews-style flags.

**Recommended weight for a runner.** **40–50% of the composite.** HRV is the highest-fidelity recovery signal we get from a wrist or ring. Below 40% under-uses the signal; above 50% breaks on noisy nights and when wrist PPG mis-detects an arrhythmia, alcohol night, or sleep-stage anomaly.

**Caveats to encode in code.**
- Use *7-day rolling LnRMSSD*, not yesterday's reading.
- Compare against a 60-day baseline mean and SD.
- If readings on <4 of the past 7 nights, fall back to the most recent valid 14-day window with a confidence flag.
- Wrist PPG nocturnal HRV correlates ~0.87 (Garmin) to ~0.97 (Oura) with chest-strap ECG. Apple Watch is workable for trends; do not treat single-night spikes as signal.

### 2.2 Resting Heart Rate (RHR)

**Science.** Use **nocturnal RHR** (lowest 30-min average in sleep), not morning supine spot. ±2 bpm of 14-day baseline is noise; ≥+5 bpm for two days or ≥+7 bpm sustained is incomplete recovery / pre-illness. A persistent downward drift over months is positive aerobic adaptation. ~30% of overtrained athletes show no RHR elevation, so RHR alone misses cases. (`research/15-wearable-data.md`)

**Platform usage.** All major scores use RHR. Whoop weights it modestly within its non-HRV ~40%. Oura makes it a dedicated contributor and uses lowest-RHR timing as a secondary signal (early-night low = recovered; pushed-late low = autonomic stress).

**Recommended weight.** **15–20% of composite.** A confirmer, not a primary driver. Useful precisely because it captures things HRV doesn't always (early illness, dehydration, alcohol).

### 2.3 Sleep

**Science.** Sleep is the highest-ROI recovery modality. <6h kills training; 7–9h is the athlete baseline; 9–10h is optimal during high load. Trust **total sleep time and sleep efficiency**; treat single-night stage breakdowns (deep/REM/light) as noise — wearables hit ~70–80% 4-stage agreement vs. polysomnography. (`research/00b-recovery-protocols.md`, `15-wearable-data.md`)

**Platform usage.** Whoop has its sleep-need model (auto-targets for tonight based on yesterday's strain + sleep debt); Oura splits sleep into a Sleep contributor (last 24h) and Sleep Balance contributor (14-day). Garmin's Sleep Score blends duration, stages, restlessness. Polar's Sleep Charge is half the score.

**Recommended weight.** **20–25% of composite**, expressed as **Sleep Quality Index** = duration vs. age-personalized need (8h baseline; nudge +1h during high-load weeks per sleep-extension research) × efficiency. Do **not** weight stage breakdowns; surface them at the contributor level only.

### 2.4 Training Load — Acute and Chronic

**Science.** Identical biometric state means different things in week 6 of a build vs. taper week. Training-load context (acute load, ACWR, recent hard sessions) prevents the score from greenlighting work after a giant week and from suppressing it during legitimate freshness in a taper. ACWR is a *directional sanity check*, not a stop-light. (`research/15-wearable-data.md`)

**Platform usage.** Whoop folds 3–7 day strain into the score so a weekend of races yields a low-recovery Monday even if HRV recovered. Garmin's Training Readiness explicitly multiplies in remaining "recovery time" hours and acute load. Oura uses 14-day Activity Balance.

**Recommended weight.** **15% of composite** as a *modifier*, not a parallel input. Specifically: a "load context" multiplier in the range [0.85, 1.10] applied after the biometric composite — penalize when ATL spike + ACWR > 1.5; bonus when ATL drops in a planned taper.

### 2.5 Subjective Wellness

**Science.** Saw and Main's 2016 systematic review found **subjective self-report measures outperform objective measures** in detecting acute and chronic training-load responses. The Hooper Index (4 items: fatigue, soreness, stress, sleep, 1–7 scale) and McLean's 5-item version (1–5 scale) are the validated standards. Hooper-RPE correlations are statistically significant in athlete cohorts. The catch: compliance falls off without low-friction capture.

**Platform usage.** Whoop has optional journal entries (caffeine, alcohol, sex, illness) that influence recovery commentary but not the score. Oura asks "How was your day?" with mood tags. Morpheus explicitly includes subjective feel. Garmin exposes a "How do you feel?" prompt but doesn't fold it into Training Readiness numerically.

**Recommended weight.** Optional **0–15% modifier** when the user supplies it; otherwise zero. A daily 3-tap check-in (energy, soreness, motivation, 1–5 each) is the right friction level for compliance. Critical: when subjective state strongly disagrees with the biometric score (>30 points in either direction), surface that explicitly rather than averaging away the disagreement.

### 2.6 Body Temperature Deviation

**Science.** Persistent body-temp elevation can flag illness onset 1–2 days before symptoms, menstrual-cycle phase, alcohol, or hot bedroom. Single-night deviation is noisy; a 3-day persistent +0.5°C deviation is a real signal.

**Platform usage.** Oura made wrist/finger temp deviation a contributor and is the most-validated. Whoop uses it as a sub-signal. Apple Watch (Series 8+) exposes wrist temp via Vitals. Garmin generally does not.

**Recommended weight.** **5% sub-signal**, only if available and ≥7 nights of baseline. Used primarily to *flag* (illness alert, cycle-phase tag for female users) rather than drive the number.

### 2.7 Respiratory Rate / SpO₂

**Science.** Sustained respiratory-rate elevation (>2 breaths/min above baseline) correlates with respiratory illness and altitude. SpO₂ noise on consumer wearables is high; trends only.

**Platform usage.** Whoop and Oura both include them as small composite contributors. Apple's Vitals app makes them per-metric outliers without composite weighting.

**Recommended weight.** Use as **alert flags only** — surface "respiratory rate trending high for 3 days" as an insight; do not numerically weight.

### 2.8 Age / Sex / Cycle

**Science.** HRV declines with age (~5% per decade after 30); women's HRV varies systematically across menstrual cycle (lower in luteal phase). Both are well-established in the literature. (`research/13-sex-specific-training.md`, `research/14-age-considerations.md`)

**Platform usage.** Oura applies cycle-phase context to Readiness; Whoop has Whoop Cycle. Garmin's Cycle Tracking is descriptive, not algorithmic.

**Recommended weight.** Implicitly handled by **per-user baselines** — the algorithm normalizes against the individual's own 60-day mean/SD. Do **not** apply explicit demographic offsets; baselines absorb age- and sex-related differences. Surface menstrual-cycle phase as a contextual tag for female users who opt in.

### Summary table — recommended input weights for a runner

| Input | Weight | Source-of-truth metric | Baseline | Confidence floor |
|---|---|---|---|---|
| HRV (LnRMSSD) | 40% | 7-day rolling vs. 60-day mean ± SD | 60d | ≥4 valid nights / 7 |
| RHR | 18% | 7-day rolling nocturnal vs. 60-day mean ± SD | 60d | ≥4 valid nights / 7 |
| Sleep Quality Index | 22% | (TST / sleep_need) × efficiency vs. 14d | 14d | ≥4 valid nights / 7 |
| Training-load context | 15% | ACWR + ATL trend (modifier 0.85–1.10) | 28d | ≥7d activity history |
| Body-temp deviation | 5% | 3-night rolling vs. 60d (flag only above ±0.5°C) | 60d | Optional input |
| Subjective wellness | 0–15% modifier | 4-item Hooper-style 1–5 scale | none | Optional, day-of |

---

## 3. Output Format — Number, Word, or Color?

### What the platforms do

| Format | Used by | Strength | Weakness |
|---|---|---|---|
| 0–100 number + color band | Whoop, Garmin TR, Athlytic, Oura | Memorable, comparable day-to-day, one-glance read | False precision (78 vs. 82 is meaningless) |
| Word-band only | Polar Nightly Recharge | Honest about precision | Hard to track trend; less compelling |
| Per-metric Typical/Outlier | Apple Vitals | Resists overclaim | Fragmented; no single read |
| Number + contributor cards | Oura | Best transparency | Higher cognitive load |
| Recovery hours | Garmin/Coros recovery time | Action-oriented | Coarse; not a recovery state read |

### UX-research signal

UserTesting and NN/g writeups on composite scores (QXscore literature, system-usability research) converge on a clear pattern: **composite scores drive recall and stakeholder communication, but breakdowns drive trust and action**. Single numbers risk interpretation bias — leaders read into them whatever they already believed; three corroborating signals start to look like evidence.

In fitness specifically, the dominant trust failure (Whoop community forums, Oura subreddit) is "the score doesn't match how I feel." Two structural causes: (1) the user has subjective context the score lacks (alcohol, work stress, just-finished period), and (2) the user can't see *why* the score is what it is. The fix in both cases is **transparent contributors**, not a more sophisticated number.

### Recommended format

> **Composite 0–100 score with a top-line word ("Recovered" / "Steady" / "Strained") and 3–4 contributor chips ("HRV +", "Sleep −", "Load +", "Soreness ↓") that the user can tap into.**

Rationale, in priority order:

1. **Single hero, multiple sub-stories.** Matches the brand's "hero number + small-caps label + supporting context" pattern from the existing Overview.
2. **Word-band carries the actionable read; number gives the trend.** Bands are: 0–32 Strained (red), 33–66 Steady (amber), 67–100 Recovered (green). Boundaries match Whoop convention so users translating from Whoop don't get confused.
3. **Contributor chips solve the trust problem.** Each chip shows the input's direction (+ / − / =) relative to baseline, with a tap revealing the raw value, the baseline, and a one-line read.
4. **No false precision.** The displayed number changes by ≥3 points to be meaningfully different. Internal score is float; UI rounds to integer and only re-renders when the rounded value changes.
5. **Color is signal, not decoration.** Per the brand: green = recovery, amber = caution, red = warning. Reserved exactly for the band — no rainbow-ification of contributor chips.

### Anti-patterns to avoid

- Displaying score to one decimal ("78.4").
- Using "readiness" and "recovery" interchangeably across the app.
- Showing the score before the baseline is established (see §5).
- Aggregating contributors into a single up/down arrow without showing direction per input.

---

## 4. Algorithm Transparency — How Much "Why" to Expose

The default position for this app is **maximum transparent transparency that doesn't overwhelm the surface**. Three layers:

| Layer | Surface | Content |
|---|---|---|
| **Glance** | Hero card | Score, word-band, color, top contributing factor as one line ("HRV elevated; legs fresh.") |
| **Tap** | Contributor breakdown | 4 chips (HRV / RHR / Sleep / Load); each shows direction + raw value + baseline range |
| **Drill-down** | Health → Recovery detail | Full 30-day chart per contributor, day's score history, narrative coach block |

The **Glance** layer must produce a sentence — the score's *reason*, not its number. This is the "WHY" voice block from the brand. Examples:

- "Score 82 — HRV elevated, sleep on target. Green light for the prescribed VO2 session."
- "Score 41 — HRV down 12%, sleep short. Yesterday's long run is still in the legs."
- "Score 58 — RHR up 4 bpm, no clear training cause. Watch for illness over the next 48h."

The narrative is **deterministic**: rule-based templates fed by the contributor deltas, not LLM-generated, so it never contradicts the number. (LLM coach commentary lives in the deeper coach block, not on the score itself.)

---

## 5. Baseline Establishment

### How long before showing a score

Three published baselines bracket the answer:

- **Apple Vitals**: 7 nights minimum.
- **Garmin HRV Status**: 3 weeks (21 days) minimum to display.
- **HRV4Training / Plews & Laursen**: 60 days for a stable mean ± SD.

Realistic answer: a useful score requires **14 days of HRV + RHR data**; a *trustworthy* score requires **30 days**.

### Recommended progressive-disclosure timeline

| Days of data | What the user sees |
|---|---|
| 0–6 | "Setting up your baseline." Show contributing inputs raw (last night HRV, sleep duration); no composite. Optionally show sex/age-typical range with a "this isn't yours yet" caveat. |
| 7–13 | Provisional score, displayed at half-opacity with a "Provisional — still learning your baseline" badge. Score range constrained to 33–66 (no green or red yet). |
| 14–29 | Full score, full color, "Establishing baseline" footer. Coach voice notes are conservative ("HRV 14-day average — not yet enough history to call this a trend"). |
| 30+ | Full score, full color, full coach interpretation. SWC-based flagging activates (HRV drops > SWC trigger insights). |
| 60+ | Long-term baselines (mean ± SD over 60 days) drive all comparisons. |

### Handling missing data

| Situation | Behavior |
|---|---|
| Skipped wear (≤2 nights) | Score continues using prior 7-day rolling average; UI shows "—" with last-valid timestamp; no flag |
| Skipped wear (3–6 nights) | Score grayed; "Wear your watch overnight to refresh recovery" prompt |
| Skipped wear (≥7 nights) | Score reset to "Re-establishing baseline"; revert to provisional state until 7-day rolling refilled |
| Travel / altitude / illness flagged | Score continues but coach voice block calls out the confound ("Altitude — expect HRV depression for 3–5 days") |
| Multiple sources disagree | Pick the highest-fidelity source per metric (chest strap > arm > Oura > Apple Watch > Garmin > Whoop wrist > Whoop bicep). User can override in Settings. |

### First 30 days — coach behavior

- No "you should rest" recommendations during days 0–13.
- No streak-based pressure (recovery streaks are anti-pattern; flagged in `APP_FEATURE_SPEC.md` as "ran-through-injury-for-the-streak" failure).
- The Today screen should show *what we have* (HRV last night, sleep last night) honestly rather than synthesize a fake number. Honesty beats overclaim during onboarding.

---

## 6. Recommended Algorithm — Concrete Proposal

### Inputs (canonical)

```text
HRV_today        := LnRMSSD from last night's nocturnal capture (highest-fidelity source)
HRV_baseline     := mean over prior 60 days of LnRMSSD
HRV_sd           := SD over prior 60 days of LnRMSSD
HRV_7d           := 7-day rolling mean of LnRMSSD ending today

RHR_today        := lowest 30-min nocturnal HR last night
RHR_baseline     := mean over prior 60 days of nocturnal RHR
RHR_sd           := SD over prior 60 days of nocturnal RHR
RHR_7d           := 7-day rolling mean

sleep_TST_today  := total sleep time last night (minutes)
sleep_efficiency := TST / time_in_bed
sleep_need       := personalized target (default 480 min; +60 during heavy weeks; user-override)

ATL_today        := 7-day exponentially weighted training load (TRIMP or rTSS, single source)
CTL_today        := 28-day EWMA training load
ACWR_today       := ATL_today / CTL_today

temp_dev_3d      := 3-day rolling wrist/finger temp deviation from 60-day baseline (optional)

subjective_4     := Hooper-style 4-item input today (energy, soreness, motivation, sleep_quality), 1–5 each (optional)
```

### Score formula

```text
# 1. Per-input z-scores against personal baseline (capped to ±2)
z_HRV     = clamp((HRV_7d - HRV_baseline) / HRV_sd,                  -2, +2)
z_RHR     = clamp((RHR_baseline - RHR_7d) / RHR_sd,                  -2, +2)   # inverted — lower RHR is better
z_sleep   = clamp(((sleep_TST_today / sleep_need) - 1) * 4 + (sleep_efficiency - 0.85) * 5, -2, +2)

# 2. Map z to 0–100 sub-score (z = 0 → 50; z = +2 → 90; z = -2 → 10)
score_HRV   = 50 + z_HRV   * 20
score_RHR   = 50 + z_RHR   * 20
score_sleep = 50 + z_sleep * 20

# 3. Weighted biometric composite
biometric = 0.40 * score_HRV + 0.18 * score_RHR + 0.22 * score_sleep
            (weights renormalized if any input missing today)

# 4. Training-load context modifier
if ACWR_today > 1.5 and ATL_today > CTL_today:
    load_mod = 0.88     # heavy spike — penalize
elif ACWR_today > 1.3:
    load_mod = 0.95
elif 0.8 <= ACWR_today <= 1.3 and ATL_today < CTL_today * 0.8:
    load_mod = 1.05     # legitimate freshness (taper)
else:
    load_mod = 1.00

# 5. Body-temp flag (multiplier, modest)
if temp_dev_3d available and abs(temp_dev_3d) > 0.5°C:
    temp_mod = 0.93
else:
    temp_mod = 1.00

# 6. Combine
score_pre_subjective = clamp(biometric * load_mod * temp_mod, 0, 100)

# 7. Subjective overlay (only if user logged today)
if subjective_4 present:
    subj_z = (mean(subjective_4) - 3) / 1   # 1=worst, 5=best, 3=neutral
    score = clamp(score_pre_subjective + subj_z * 8, 0, 100)
else:
    score = score_pre_subjective

# 8. Round for display
display_score = round(score)
band = "Strained" if score <= 32 else "Steady" if score <= 66 else "Recovered"
```

### Why these weights

- HRV's 40% reflects its consistently highest-fidelity signal among consumer wearables for autonomic recovery state. Below 40% under-uses the metric; above 50% lets a single anomalous PPG night swing the entire read.
- Sleep's 22% reflects its highest-evidence ROI for recovery (it's the *cause*) — but tonight's sleep is a single sample, so weighting it above HRV's *trend* would be inverting fidelity.
- RHR's 18% gives meaningful weight to the second-most-validated nocturnal signal without letting it dominate when HRV and RHR disagree.
- Training-load context as a multiplier (not a parallel input) means it can't *create* a score; it can only modulate one. This avoids the Garmin Training Readiness failure mode where a well-recovered athlete with a recent hard session gets a moderate score on biometric grounds alone.
- Subjective as a final overlay (when present) lets it pull the score, but never more than ±16 points (z ranges -2 to +2; ×8 = ±16). Strong disagreement (>30 points) between biometric and subjective triggers an explicit narrative call-out rather than averaging.

### Contributor chips (UI)

Each chip shows a direction, a delta, and a tap-target. Format: `LABEL │ ARROW │ DELTA`.

| Chip | Format | Example |
|---|---|---|
| HRV | `HRV ↑ +12%` (vs. 60-day baseline) | green when ≥+SWC, red when ≤−SWC |
| RHR | `RHR ↓ −3 bpm` | green when ≤−1 SD, red when ≥+1 SD |
| Sleep | `SLEEP 7h 42m / 8h target` | green at ≥100% target, amber 80–99%, red <80% |
| Load | `LOAD ACWR 1.1` | amber at 1.3–1.5, red at >1.5 |
| Subjective (if present) | `FEEL 4 / 5` | green ≥4, amber 3, red ≤2 |
| Temp (if flagged) | `TEMP +0.6°C 3D` | red — surfaced only when flagged |

The user sees up to 5 chips. The chips are ordered by influence on today's score (largest delta first), so the top chip explains the most of the day's number.

### Coach narrative templates (deterministic)

Tied directly to the dominant contributor:

```
if dominant_chip == "HRV ↑":  "HRV elevated. Body's primed."
if dominant_chip == "HRV ↓":  "HRV suppressed — recovery still in progress."
if dominant_chip == "RHR ↑":  "RHR up {N} bpm. Watch for illness or alcohol effect."
if dominant_chip == "SLEEP −": "Short sleep last night. One bad night, not a pattern."
if dominant_chip == "LOAD +":  "Heavy load week. Score is doing what it should."
```

---

## 7. Data Model Implications

### Entities

```text
HealthMetric
  id
  user_id
  metric_type        enum: HRV_RMSSD, RHR_NOCTURNAL, SLEEP_TST, SLEEP_EFFICIENCY,
                          WRIST_TEMP, RESP_RATE, SPO2, BODY_WEIGHT
  value              float
  unit               text
  source             enum: APPLE_HEALTH, OURA, WHOOP, GARMIN, COROS, POLAR, MANUAL, ...
  source_fidelity    int (0–100; pre-computed from source × metric)
  captured_at        timestamp (with UTC offset)
  measurement_window enum: NOCTURNAL, MORNING_SPOT, INSTANT
  confidence         enum: HIGH, MEDIUM, LOW (from source signal quality)
  raw_payload        jsonb (vendor-specific; for debugging and re-derivation)

ReadinessScore
  id
  user_id
  score_date         date
  display_score      int (0–100)
  raw_score          float (0–100)
  band               enum: STRAINED, STEADY, RECOVERED, PROVISIONAL, UNAVAILABLE
  contributors       jsonb {hrv: {z, weight, label, value, baseline}, rhr: ..., ...}
  load_modifier      float
  temp_modifier      float
  subjective_present bool
  algorithm_version  text (e.g., "1.0.3"; required for back-recompute)
  computed_at        timestamp
  baseline_state     enum: PRE_BASELINE (0–6d), PROVISIONAL (7–13d), ESTABLISHING (14–29d), STABLE (30+d)

SubjectiveLog
  id
  user_id
  log_date           date
  energy             int (1–5)
  soreness           int (1–5; reverse-scored)
  motivation         int (1–5)
  sleep_quality      int (1–5; user-perceived, distinct from device-measured)
  notes              text (optional)

Baseline
  id
  user_id
  metric_type        enum
  window_days        int (60 default, 14 for sleep)
  mean               float
  sd                 float
  sample_count       int
  computed_at        timestamp
  is_seasonal        bool (future: separate baselines per training phase)

InsightAlert
  id
  user_id
  alert_type         enum: HRV_DROP, RHR_ELEVATION, TEMP_DEVIATION, OVERREACH_RISK, ...
  severity           enum: INFO, WARNING, CRITICAL
  triggered_at       timestamp
  cleared_at         timestamp (nullable)
  context            jsonb
```

### Critical relationships

- `ReadinessScore` is **derived**, not source-of-truth — store the inputs (`HealthMetric`, `Baseline`, `SubjectiveLog`, training-load aggregate from `Activity`) and recompute. Never edit the score directly.
- One `ReadinessScore` per user per local date. Recomputable; persist for history charting.
- `algorithm_version` is mandatory. When the algorithm changes, mark old scores as v1.0.x and either backfill (preferred) or display "v1 score" badge to maintain trust.
- `source_fidelity` resolves multi-source conflicts deterministically (HRV: chest-strap > Oura ring > Apple Watch wrist > Garmin wrist > Whoop wrist).

### Computation cadence

- Trigger on the *first* of: morning HealthKit sync, scheduled 9am local recompute, user pull-to-refresh.
- Only compute once per (user, date) unless inputs change. Store the input-hash with the score; skip recompute if hash unchanged.

---

## 8. Open Questions

These genuinely cannot be resolved without user data and testing.

1. **Optimal subjective-input cadence and friction.** Is a daily 4-item check-in achievable with >60% compliance, or should it be opportunistic (prompt only on outlier days)? Test both arms with 4–8 weeks of compliance data.
2. **Cross-source HRV reconciliation when sources disagree by >15%.** Specifically Oura vs. Apple Watch on the same night. Pick higher-fidelity? Average? Show both? Likely depends on which the user trusts more — surface both and let them choose, but does that nudge them toward the more flattering one?
3. **Race-week and post-race score behavior.** During a planned taper, ATL drops legitimately and HRV often rises — score will spike toward 95+ and stay there. Is a "race-week mode" that compresses the score range or surfaces a different read (e.g., "Sharpening — 92, expected") preferable to a literal 95?
4. **The "score doesn't match how I feel" pathway.** When subjective and biometric diverge by >30 points, is the right UI a banner ("Your body says one thing, your gut says another"), a forcing function (one-tap "It's actually a green/red day for me" override that influences future learning), or just acceptance that they sometimes disagree?
5. **Per-phase baselines.** Should the 60-day baseline be a single rolling window, or two (training-block window + recovery-week window)? The single window is more conservative and starts paying off earlier but mutes intentional adaptation drift.
6. **Female cycle integration depth.** Pure tagging (cycle-phase chip), explicit phase-adjusted baseline shift, or LLM-mediated narrative ("luteal phase, expect HRV ~7% below your follicular norm")? Need user testing with female users specifically.
7. **Streak / gamification handling.** Recovery scores should not have streaks (anti-pattern). But should a "consistency of recovery" pattern be surfaced (e.g., "Your HRV has been within typical range 19 of the last 21 days — that's stable")? Engagement risk vs. injury-pressure risk.
8. **Algorithmic personalization over time.** Whoop and Oura adjust input weights per individual via ML. Worth doing? Probably — but not v1; collect ≥6 months of multi-user data first to avoid overfitting to small samples.

---

## Sources

**Whoop**
- [WHOOP Recovery: How It Works, Key Metrics, and Tips](https://www.whoop.com/us/en/thelocker/how-does-whoop-recovery-work-101/)
- [WHOOP 101 — Developer docs](https://developer.whoop.com/docs/whoop-101/)
- [What is the Recovery score, and how is it calculated? — WHOOP Community](https://www.community.whoop.com/t/what-is-the-recovery-score-and-how-is-it-calculated/107)
- [WHOOP Heart Rate Algorithm — Accuracy, Testing, Updates](https://www.whoop.com/us/en/thelocker/a-look-behind-the-data-how-whoop-measures-heart-rate/)

**Oura**
- [Readiness Score — Oura Help](https://support.ouraring.com/hc/en-us/articles/360025589793-Readiness-Score)
- [Readiness Contributors — Oura Help](https://support.ouraring.com/hc/en-us/articles/360057791533-Readiness-Contributors)
- [What affects your readiness? — Oura Help Center](https://help.ouraring.com/readiness/what-affects-your-readiness)

**Garmin**
- [Training Readiness — Garmin Wiki](https://wiki.garminrumors.com/Training_Readiness)
- [Garmin Body Battery Explained — the5krunner](https://the5krunner.com/garmin-features/sleep/body-battery/)
- [HRV Status — Garmin Wiki](https://wiki.garminrumors.com/HRV_Status)
- [Understanding the HRV Status on Your Garmin Smartwatch](https://www.garmin.com/en-US/blog/fitness/understanding-the-hrv-status-on-your-garmin-smartwatch/)
- [Garmin Recovery Time — the5krunner](https://the5krunner.com/garmin-features/training/recovery-time/)

**Polar**
- [Nightly Recharge recovery measurement — Polar USA](https://support.polar.com/us-en/nightly-recharge-recovery-measurement)
- [Recovery Pro or Nightly Recharge — Polar Global](https://support.polar.com/en/recovery-pro-or-nightly-recharge-which-is-the-right-one-for-me)

**Morpheus**
- [The Morpheus heart rate zones](https://trainwithmorpheus.com/the-morpheus-heart-rate-zones/)
- [Morpheus Recovery System Overview](https://agelessoptimization.com/2019/02/25/morpheus-recovery-system-overview-and-demo/)

**HRV4Training / Elite HRV / Plews**
- [HRV4Training Pro & Teams Guide](https://www.hrv4training.com/pro--teams-guide.html)
- [Plews & Laursen — Training adaptation and HRV in elite endurance athletes](https://pubmed.ncbi.nlm.nih.gov/23852425/)
- [HRV-Based Training for Improving VO2max — Systematic Review with Meta-Analysis (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7663087/)
- [HRV-Guided Training for Endurance Athletes — Methodological Systematic Review (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8507742/)
- [Olympic Training, Elite Endurance Athletes, HRV — Elite HRV](https://elitehrv.com/olympic-training-elite-endurance-plews-and-prof-updated)

**Apple Watch / iOS**
- [How the Apple Watch Vitals app works — Wareable](https://www.wareable.com/apple/how-vitals-app-finally-makes-apple-watch-a-wellness-powerhouse)
- [Athlytic: AI Fitness Coach](https://apps.apple.com/us/app/athlytic-ai-fitness-coach/id1543571755)
- [Training Today App](https://trainingtodayapp.com/)

**Subjective wellness**
- [Saw, Main, Gastin (2016) — Subjective measures trump objective measures (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4789708/)
- [McLean wellness questionnaire — ResearchGate figure](https://www.researchgate.net/figure/Subjective-wellness-questionnaire-first-published-by-McLean-et-al-2010-utilising-a_fig7_341452383)
- [Wellness Questionnaires for Athlete Monitoring — GPI](https://www.globalperformanceinsights.com/post/wellness-questionnaires-for-athlete-monitoring)
- [Single-Item Self-Report Measures of Team-Sport Athlete Wellbeing (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7534939/)

**UX / composite scoring**
- [Measurement practices in UX research — Frontiers](https://www.frontiersin.org/journals/computer-science/articles/10.3389/fcomp.2024.1368860/full)
- [QXscore — UserTesting](https://www.usertesting.com/blog/qxscore-for-measuring-user-experience)
- [Wearable Recovery Scores: How They Work and How to Use Them Wisely — WellnessPulse](https://wellnesspulse.com/healthtech/wearable-recovery-scores-explained/)

**Knowledge base (internal)**
- `research/03-heart-rate-zones.md`
- `research/15-wearable-data.md`
- `research/00b-recovery-protocols.md`
- `research/13-sex-specific-training.md`
- `research/14-age-considerations.md`
