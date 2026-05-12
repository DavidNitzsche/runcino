# Health Page — Research-Grounded Architecture Audit

**Date:** 2026-05-11
**Scope:** `/web/app/health/page.tsx` (current implementation), `designs/health-2026-05-09.html` (locked mockup), audited against the canonical `Research/` library.
**Method:** Read-only doctrine review. Every claim below cites a specific Research doc + section anchor. Where the research does not address something, it is flagged as an Open Question.

---

## 1. The verdict

The current page is **directionally right but mis-ordered, mis-sized, and missing critical signals.** Specifically:

- **The hierarchy inverts the research.** Daily Check-in (subjective wellness) currently sits as a thin banner above the data; per `Research/15-wearable-data.md §When Wearable Data Agrees vs. Disagrees with Subjective State`, citing Saw et al. 2016: *"subjective self-reported wellness measures are more sensitive and consistent indicators of acute and chronic training load than objective markers including hormones, biochemistry, and HRV. When the two disagree, subjective wins."* The subjective check-in should anchor the page, not garnish it.
- **HRV is buried.** It is the single most cited recovery/readiness signal across `15 §HRV`, `03 §10 HRV`, and `00b §Warning Signs of Incomplete Recovery`. Today it lives as one of four small tiles on Row 2 next to Body Temp. Research treats HRV as a primary signal; the page treats it as peer to body temperature.
- **Body Temp is overweighted.** A whole tile is dedicated to it on Row 2. In `15 §Spotting Illness Early`, skin-temperature deviation is **one of five** illness-incubation markers (with RHR, HRV, respiratory rate, sleep efficiency) — useful as a *component* of an illness-early-warning composite, not as a standalone hero metric.
- **HR Zone Distribution is on the wrong page.** `00a §Training Intensity Distribution (TID)` treats intensity distribution as a *training-design* question, not a health/readiness question. It belongs on Training.
- **Body Systems framework is correct and load-bearing.** The 5-system breakdown matches `00b §Reverse Periodization for Marathon Recovery` almost exactly (the research lists six tissues — glycogen, muscle, connective, bone, CNS/hormonal, immune — the page collapses bone into connective which is a reasonable UX simplification; see `web/coach/doctrine/recovery_protocols.ts:349-354`). Keep it; it is the page's strongest research-grounded feature.
- **Several "missing" signals are flagged by research as material gaps.** Subjective soreness, respiratory rate placement, body-mass drop, and (for some users) ferritin/menstrual cycle. Details in §4.

---

## 2. Priority-ranked metrics for a runner's daily health readout

Order is by research-weighted predictive value for "am I ready to train hard today?". Each line cites the doc + section that justifies the ranking.

| Rank | Metric | Why it ranks here | Citation |
|---|---|---|---|
| **1** | **Subjective wellness (mood, fatigue, soreness, sleep quality, stress — Hooper-style 1–10)** | The only signal the research explicitly says **wins ties** against any objective marker. Saw 2016 systematic review found subjective measures more sensitive and consistent than HRV, hormones, or biochemistry. | `15 §When Wearable Data Agrees vs. Disagrees with Subjective State`; `00b §Qualitative Signals` |
| **2** | **HRV (LnRMSSD, 7-day rolling) + CV** | Field-standard daily recovery/autonomic signal. Trend (not single value) is what's actionable. CV rising flags destabilization *before* the rolling mean drops. | `15 §Heart Rate Variability — Plews approach`; `03 §10 HRV — Interpreting Daily vs. Trend`; `00b §Quantitative Signals` |
| **3** | **Sleep (total time, efficiency)** | `00b §Recovery Modalities — Ranked by Evidence` rates sleep as Tier-A Strong: *"largest effect on recovery and performance of any modality."* Sleep duration <7 h carries measurable performance decrement. | `00b §Sleep — The Highest-ROI Recovery Tool`; `00a §Recovery Modalities Ranked by Evidence` (sleep = highest) |
| **4** | **RHR (nocturnal, 7-day rolling vs. 14-day baseline)** | Independent recovery/illness signal. *Caveat from `15 §Limits of RHR`: "Some athletes show no RHR elevation during overtraining."* So it's a co-confirmer, not a single source of truth. | `15 §Resting Heart Rate — Decision rules`; `03 §9 Resting HR Baseline & Recovery Indicators` |
| **5** | **Body-systems / tissue recovery state (post-race or post-key-session)** | Tissue-repair timelines are deterministic; the body-systems card maps day-since-stressor to predicted state and is grounded in `00b`'s tissue-recovery table. | `00b §Reverse Periodization` (tissue timelines); `00b §Three Categories of Recovery` |
| **6** | **Training Stress balance (TSB = CTL − ATL) and ACWR** | Load-derived freshness. `15 §Fitness/Fatigue/Form` gives operating bands (build = −10 to −30, race day = +15 to +25). Useful but a model output, not a measurement. | `15 §Fitness/Fatigue/Form (CTL/ATL/TSB)`; `00a §Training Load and Injury Risk`; `15 §ACWR` |
| **7** | **Submaximal HR drift (HR at fixed easy pace)** | `15 §Spotting Overtraining Early` calls this out as one of the **earliest reliable** physiologic markers: "HR for a given easy pace creeps up 3–8 bpm." Few apps surface it; research says they should. | `15 §Spotting Overtraining Early`; `00b §Submaximal HR` warning sign |
| **8** | **Illness-early-warning composite** (RHR↑ + HRV↓ + respiratory rate↑ + skin temp↑ + sleep efficiency↓) | The illness signature is *the conjunction*, not any single component. When 3+ markers align, illness probability within 72 h rises substantially. | `15 §Spotting Illness Early` |
| **9** | **Body-mass change (>2% drop in 1 week without intent)** | `00b §Quantitative Signals` flags this as a recovery-debt / underfueling marker. Not commonly surfaced in wearable apps; research includes it. | `00b §Warning Signs of Incomplete Recovery` |
| **10** | **Wearable VO₂max trend** | Useful as a **trend** signal — "Garmin VO2max moving 51 → 53 → 55 over 8 weeks is a real fitness signal even if the absolute is biased." Single readings are noisy (4–12% MAPE). It's a fitness-direction indicator, not a daily readiness one. | `15 §VO2max Estimates from Wearables` |
| **11** | **Respiratory rate (nocturnal)** | A useful *component* of the illness-early signature; weak in isolation. | `15 §Spotting Illness Early` |
| **12** | **Skin / body temperature deviation** | Same as respiratory rate: only meaningful as part of the illness composite. Standalone, it's noise. | `15 §Spotting Illness Early`; Whoop/Oura skin temp in `§Recovery Scores` |

### Signals research mentions but does NOT prioritize for daily readiness

- **HR zone distribution** — design metric for training plans (`00a §TID`), not a daily-readiness signal. Belongs on Training.
- **Running dynamics (GCT, VO, VR)** — `15 §Running Dynamics: Useful vs. Marketing` says VR is composite-useful but on long efforts; GCT balance matters for economy. These are fitness/form signals, not health.
- **Running power / CP** — training-prescription signal (`15 §Running Power`), not daily health.

---

## 3. Recommended Health page architecture

### Lead principle (from `Research/15 §Decision Matrix`)

> "Track both. Use a daily 1–10 readiness question (or full Hooper) and pair with the wearable score. When they diverge, log it."

The page should let subjective and objective state visually **face each other**, with the body-systems card explaining *why* recovery is where it is, and a composite that explicitly shows the rule of disagreement.

### Row 0 — Greet band (4 KPI tiles)

Keep the current 4-tile shape, but change the tiles to reflect priority:

1. **Readiness** (composite score) — unchanged
2. **HRV · 7D rolling** — unchanged
3. **Sleep · 7D avg** — unchanged
4. **Today's check-in state** (NEW, replacing "SYSTEMS HEALED") — surfaces whether the user has logged today's subjective state and how it compares to the wearable verdict. "SYSTEMS HEALED" moves into the Body Systems card where it lives natively.

Rationale: the greet band should preview the page's *answer* (am I ready?) plus the two signals that drive it most + whether the user has actually told the app how they feel.

### Row 1 — The readiness pair (full width, two cards)

| Card | Span | Contents |
|---|---|---|
| **Daily Check-in / Subjective State** | 5 | 5-emoji mood picker + 3-axis sliders (energy, soreness, stress); 7-day mini-trend; the line that today says *"How are you feeling today?"* but expanded to surface *which subjective signals are trending*. |
| **Readiness Composite + Agreement Verdict** | 7 | Current composite ring + 5-signal breakdown (already in place); plus a new explicit line: *"Subjective: GOOD · Wearable: AMBER · Coach defers to subjective"* per `15 §Decision Matrix`. |

**Why row 1, not row 0:** Saw 2016 and `15 §When Wearable Data Agrees vs. Disagrees` make subjective state the tiebreaker. Putting it visually adjacent to the composite (not buried at the top as decorative emoji) makes the divergence rule visible.

### Row 2 — Body Systems + HRV trend (the two highest-information panels)

| Card | Span | Contents |
|---|---|---|
| **Body Systems / Tissue Recovery** | 7 | 5- or 6-row system tile with healed-by dates and "QUALITY RETURNS" footer. Already strong. Add a citation footer: *"Per Research 00b §Reverse Periodization."* |
| **HRV · Detail panel** | 5 | Current 7-day rolling, CV (coefficient of variation — currently missing), baseline, 30-day sparkline, Plews-style "stable/destabilizing/dropping" verdict. `15 §HRV` lists CV as a *first-line* signal — the page should expose it. |

### Row 3 — Recovery foundations (sleep + RHR + load-driven freshness)

| Card | Span | Contents |
|---|---|---|
| **Sleep** (current SleepCard) | 4 | Current + last 7 nights + efficiency. Add: 7-night moving avg vs. the `00b §Sleep` ≥8 h target line. |
| **RHR** (current RhrCard) | 4 | Current vs. 14-day baseline; 30-day sparkline. Already correct. |
| **Form · CTL/ATL/TSB** (current TrainingStressCard, relabeled) | 4 | Fitness / Fatigue / Form chip. `15 §Fitness/Fatigue/Form` operating bands as colored band overlays. |

### Row 4 — Illness-early composite (NEW) + VO₂max trend + Body-mass

| Card | Span | Contents |
|---|---|---|
| **Illness Early-Warning Composite** (NEW) | 4 | Stacked indicator of the 5 illness signals from `15 §Spotting Illness Early`: nocturnal RHR↑, HRV↓, skin temp↑, respiratory rate↑, sleep efficiency↓. Counts how many are firing; green if 0–1, amber if 2, red if 3+. Folds Body Temp and Respiratory Rate into their proper home (component, not hero). |
| **VO₂max · 6-month trend** | 4 | Same as current — trend matters, not absolute. Per `15 §VO2max Estimates from Wearables`. |
| **Body Composition / Mass** (NEW or optional) | 4 | Body mass + 7-day moving avg + flag when delta > 2% per `00b §Warning Signs of Incomplete Recovery`. If we don't have HealthKit body-mass yet, leave a stub with a "not available" state. |

### Row 5 — Submax HR + (sex-specific, if applicable)

Optional. Show only when data is available:

| Card | Span | Contents |
|---|---|---|
| **Submax HR drift** | 6 | HR at fixed easy pace, trended over 8 weeks. Per `15 §Spotting Overtraining Early`. Surfaces the *earliest reliable* overtraining marker. |
| **Cycle phase / Iron status** (female users) | 6 | Phase tracker + last ferritin reading. Per `13 §1 Menstrual Cycle` and `13 §8 Iron Deficiency in Female Runners`. Optional; user-toggled. |

---

## 4. Specific gaps in the current page

### Things research says should be there but aren't

| Gap | Citation | Severity |
|---|---|---|
| **Subjective wellness is decorative, not central.** Mood emoji exist but the page is built around objective tiles. Saw 2016 says subjective beats objective. | `15 §When Wearable Data Agrees vs. Disagrees`; `00b §Qualitative Signals` (8 distinct qualitative warning signs) | High |
| **HRV CV (coefficient of variation) not shown.** Research treats CV as a first-line destabilization signal — it rises before the rolling mean drops. | `15 §HRV — Plews approach §5`; `03 §10 HRV CV table` | High |
| **No agreement/disagreement verdict between subjective and wearable.** | `15 §Decision Matrix` | High |
| **No submaximal HR drift card.** Research calls this *the earliest reliable* overtraining marker. | `15 §Spotting Overtraining Early §4`; `00b §Submaximal HR` | Medium |
| **No illness-early composite.** Body Temp and Respiratory Rate are surfaced as *isolated* tiles when their sole research-supported use is as components of the 3+-marker illness signature. | `15 §Spotting Illness Early` | Medium |
| **No body-mass trend.** | `00b §Warning Signs — body weight >2% drop` | Medium |
| **Body Systems = 5; research lists 6 tissues (bone separate from connective).** The doctrine code itself lists 6 (`web/coach/doctrine/recovery_protocols.ts:349-354`). UI collapse is defensible but worth flagging. | `00b §Reverse Periodization` tissue table | Low |
| **No subjective-soreness slider.** Mood is 5-emoji; soreness, energy, stress, sleep-quality are separate axes in the Hooper Index. | `00b §Qualitative Signals`; `15 §Decision Matrix` "full Hooper" | Medium |

### Things on the page that research doesn't justify (or under-justifies)

| Element | Issue | Citation |
|---|---|---|
| **Body Temp as a standalone Row 2 tile** | Only meaningful as part of illness-early composite. As a standalone metric it carries no specific action threshold in the research. | `15 §Spotting Illness Early` (component only) |
| **Respiratory Rate as a standalone Row 3 tile** | Same — only meaningful in the illness composite. | `15 §Spotting Illness Early` (component only) |
| **HR Zone distribution on Health page** | This is a training-design metric. `00a §TID` treats it as the architecture of the training week, not a recovery/readiness signal. | `00a §Training Intensity Distribution`; absent from `15` or `00b` health signals |
| **VO₂max-percentile-vs-age-band callout** | Research supports VO₂max trend; population percentile is a fitness-classification UX cue, not a coaching signal — `15 §VO2max` says *"Use the trend, not the absolute number."* | `15 §VO2max Estimates from Wearables — Practical guidance` |
| **Training Stress Card sharing real estate with HR Zones at Row 3** | TSS-derived CTL/ATL/TSB is health-adjacent (drives recovery prescription); HR zone share isn't. Don't pair them. | `15 §Fitness/Fatigue/Form` is appropriate for Health; HR zones aren't. |

---

## 5. Open questions — things research doesn't answer

1. **What is the *weighted formula* for a composite readiness score?** `15 §Recovery Scores` describes Whoop/Oura/Garmin composites as "weighted blends of the same underlying physiology (HRV, RHR, sleep), packaged differently. They do not measure recovery directly — they measure correlates." The research **describes** the inputs but does not prescribe specific weights. Our 5-signal-weighted composite is an opinionated synthesis; weights are not citable.
2. **How to combine subjective and objective into a single number?** The research says subjective wins ties, but doesn't give a numerical merge rule. The page may want a "subjective override" rather than a weighted blend.
3. **What threshold of body-temp deviation matters in non-illness contexts?** The illness signature uses +0.3 to +1.0°C, but the research doesn't define a non-illness "meaningful" threshold for a standalone Body Temp card (which supports the conclusion: don't show it standalone).
4. **Hydration as a daily signal.** `Research/19 §Hydration` covers sweat rate, sodium loss, EAH prevention — all *during-session* science. There's no research-cited daily-readiness hydration signal beyond "body mass >2% drop in 1 week" from `00b`. Open question: is a daily hydration tile defensible?
5. **Stress / HRV-mediated life load.** Whoop and Garmin surface "all-day stress" as HRV-derived; `15` is silent on whether this is a research-supported signal beyond the wearable vendors' own framing. We should not invent it.
6. **Air quality / heat acclimation state.** `Research/06` covers acute environmental adjustments; daily "where are you in your heat-acclimation curve" is not a research-defined readout, though it could be derived.
7. **5 vs 6 body-systems.** Doctrine code (`recovery_protocols.ts:349-354`) lists 6; current UI shows 5 (bone folded into connective). Both are defensible — research doesn't prescribe display granularity.

---

## 6. Answering each specific audit question

**Q1. Single most predictive marker of "ready to train hard today"?**
Subjective wellness (mood/fatigue/soreness/sleep quality/stress), per `15 §When Wearable Data Agrees vs. Disagrees`. *No single objective marker outperforms it.* HRV is the strongest *objective* marker.

**Q2. Weights / thresholds for a readiness composite?**
The research does **not** prescribe weights. It does prescribe individual decision rules: HRV (`15 §HRV Interpretation Matrix`), RHR (`15 §RHR Decision Rules`), sleep (`00b §Sleep duration table`). Our composite weights are opinionated.

**Q3. Trend vs current value?**
**Trend wins, for every continuous signal.** Direct quotes: HRV — *"A single HRV value is noise. Use 7-day rolling average vs. individual normal range"* (`03 §HRV Practical Rule`). RHR — *"Average over 14 days; recompute every 4–8 weeks"* (`03 §RHR Establishing Baseline`). VO₂max — *"Use the trend, not the absolute number"* (`15 §VO2max Practical guidance`). The page should de-emphasize today's number relative to the trend overlay.

**Q4. Body-systems framework — does research support a 5-system breakdown with healed-by dates?**
Yes, with one caveat. `Research/00b §Reverse Periodization` lists **six** tissue-recovery windows: glycogen (24–72 h), muscle (5–10 days), connective (2–4 weeks), bone (3–6 weeks), CNS/hormonal (2–4 weeks), immune (1–3 weeks). Our doctrine code mirrors all six (`web/coach/doctrine/recovery_protocols.ts:349-354`). The UI collapses bone into connective for a 5-row display, which is defensible UX but worth surfacing as a citation. The "healed-by date" derivation from `daysSincePeakStress` and tissue-window is a direct research mapping.

**Q5. HR zone distribution on Health page?**
**No — it belongs on Training.** `00a §TID` frames it as a training-design question (polarized vs. pyramidal vs. threshold-dominant). It's not in `15` or `00b` as a recovery/readiness signal.

**Q6. What's missing?**
- Subjective soreness / Hooper-axis sliders (mentioned in research, missing in UI)
- HRV CV (mentioned as a primary signal, missing)
- Subjective-vs-wearable agreement verdict
- Submaximal HR drift (the "earliest reliable" overtraining signal)
- Illness-early composite (instead of standalone temp + respiratory rate)
- Body-mass trend
- (Female users) menstrual cycle phase + ferritin — `Research/13 §1` and `§8`
- (Optional) energy availability proxy from `13 §6 RED-S` — but the research warns EA calculation from wearable data alone is unreliable

Not in research (don't add):
- Mood "score" with no axes (current implementation oversimplifies)
- Thyroid surfacing on Health page (mentioned in `13 §6.6 Red-Flag Signs` as clinician-referral, not a daily metric)
- Hydration tile (research doesn't justify a daily one)

**Q7. What's overweighted?**
- Body Temp as standalone hero — should be a component of illness-composite
- Respiratory Rate as standalone hero — same
- HR Zone Distribution — wrong page entirely
- VO₂max population-percentile callout — research says trend, not percentile, is the signal

**Q8. Hierarchy — check-in at top or bottom?**
**Daily Check-in should be at the TOP of the *body* (Row 1) — not buried as a thin banner, not pushed to the bottom.** It is the page's primary signal per Saw 2016. Composite readiness should be its *peer*, not its predecessor, because the two are mutually informative and the rule is *"when they disagree, subjective wins."* Putting the check-in at the bottom would hide it behind data the research explicitly subordinates to it.

---

## 7. Recommended row-by-row spec (final)

### Recommended Row 1 — Subjective state + composite readiness (paired)

- **DailyCheckinCard (span 5)** — expanded from emoji-only to: mood emoji **plus** energy / soreness / stress 1–10 sliders, recent 7-day subjective trend, today's stamp. Cites Hooper Index pattern from `15 §Decision Matrix`.
- **ReadinessCompositeCard (span 7)** — existing ring + 5-signal breakdown. **New:** "agreement chip" showing whether subjective and wearable agree, and which the coach is deferring to. Per `15 §Decision Matrix`.

Why first: Saw 2016 says subjective is the most sensitive single signal; composite readiness is what the user came to read; pairing them visually enforces the divergence rule.

### Recommended Row 2 — Body Systems + HRV detail

- **BodySystemsCard (span 7)** — current, with citation footer `00b §Reverse Periodization`. Consider exposing bone as a 6th row.
- **HrvDetailCard (span 5)** — current value + 7-day rolling + **CV (new — required by `15 §HRV Plews approach`)** + Plews verdict ("stable" / "destabilizing" / "dropping > SWC").

Why second: these are the two single-card panels that carry the most coaching information. Body Systems explains *why* recovery is where it is; HRV explains the *trajectory*.

### Recommended Row 3 — Recovery foundations

- **SleepCard (span 4)** — current, plus a goal-line overlay at 8 h per `00b §Sleep`.
- **RhrCard (span 4)** — current. Already research-aligned.
- **FormFreshnessCard (span 4)** — relabel TrainingStressCard to "FORM · CTL/ATL/TSB," add operating-band shading from `15 §Fitness/Fatigue/Form Operating bands`.

### Recommended Row 4 — Illness composite + fitness trend (+ body mass if available)

- **IllnessEarlyCompositeCard (NEW, span 4)** — combines RHR↑ + HRV↓ + skin temp↑ + respiratory rate↑ + sleep efficiency↓, lights amber at 2/5, red at 3/5. Per `15 §Spotting Illness Early`.
- **Vo2MaxTrendCard (span 4)** — keep, but de-emphasize the percentile label per `15 §VO2max — Use the trend, not the absolute number`.
- **BodyMassCard (NEW, span 4)** — flag if 7-day delta > 2% per `00b §Quantitative Signals`. If HealthKit body-mass not yet wired, render the card in a "data pending" state rather than omit.

### Recommended Row 5 (optional, conditional) — Earliest overtraining marker + sex-specific

- **SubmaxHrDriftCard (NEW, span 6)** — HR at fixed easy pace, 8-week trend. Per `15 §Spotting Overtraining Early §4`.
- **CycleAndIronCard (NEW, span 6, female users only)** — cycle phase + last ferritin. Per `13 §1` and `13 §8`. Optional toggle.

---

## 8. Drop from the page

| Element | Move to | Why |
|---|---|---|
| **HR Zone Distribution card** | `/training` (where TID belongs) | `00a §TID` frames it as a training-design metric, not health. |
| **Body Temp as standalone tile** | Fold into Illness Early Composite | `15 §Spotting Illness Early` uses it only as a component. |
| **Respiratory Rate as standalone tile** | Fold into Illness Early Composite | Same reasoning. |
| **VO₂max percentile callout** | Replace with stronger trend emphasis | `15 §VO2max — Practical guidance: "Use the trend, not the absolute number."` |

## 9. Add to the page

| Element | Where | Cite |
|---|---|---|
| **Subjective-axis sliders (energy/soreness/stress)** | Row 1 DailyCheckinCard | `15 §Decision Matrix` (Hooper); `00b §Qualitative Signals` |
| **Subjective vs. wearable agreement chip** | Row 1 ReadinessCompositeCard | `15 §Decision Matrix` |
| **HRV CV (coefficient of variation)** | Row 2 HrvDetailCard | `15 §HRV Plews approach §5`; `03 §10 HRV CV table` |
| **Illness Early Composite** | Row 4 (NEW) | `15 §Spotting Illness Early` |
| **Body Mass trend** | Row 4 (NEW) | `00b §Quantitative Signals` |
| **Submax HR drift** | Row 5 (NEW, optional) | `15 §Spotting Overtraining Early §4` |
| **Cycle + ferritin (female users)** | Row 5 (NEW, optional) | `13 §1 Menstrual Cycle`; `13 §8 Iron Deficiency` |

## 10. Where to surface what's NOT on Health

| Removed from Health | Belongs on |
|---|---|
| HR Zone Distribution (14-day rollup) | `/training` — sits adjacent to TID rules and weekly intensity-distribution targets. |
| Wearable VO₂max population-percentile callout | Keep on Health but de-emphasize. Population context is more at home on a "Fitness" or "Performance Profile" view if one exists. |
| Workout-specific running dynamics (GCT, VO, VR) | `/training` (run-by-run analysis) — per `15 §Running Dynamics`. |
| Running power / CP | `/training` — per `15 §Running Power`. |

---

## 11. Citations index

All citations resolve under `/Volumes/WP/06 Claude Code/Runcino/Research/`:

- **`15-wearable-data.md`** — §Resting Heart Rate · §Heart Rate Variability (Plews) · §Sleep Stage Data · §Training Load Metrics · §Recovery Scores · §VO2max Estimates · §Fitness/Fatigue/Form (CTL/ATL/TSB) · §When Wearable Data Agrees vs. Disagrees with Subjective State · §Spotting Illness Early · §Spotting Overtraining Early
- **`00b-recovery-protocols.md`** — §Three Categories of Recovery · §Sleep — The Highest-ROI Recovery Tool · §Recovery Modalities Ranked by Evidence · §Reverse Periodization for Marathon Recovery (tissue-repair table) · §Warning Signs of Incomplete Recovery (Quantitative / Qualitative)
- **`00a-distance-running-training.md`** — §Training Intensity Distribution (TID) · §Recovery Modalities Ranked by Evidence · §Training Load and Injury Risk
- **`03-heart-rate-zones.md`** — §9 Resting HR Baseline & Recovery Indicators · §10 HRV
- **`13-sex-specific-training.md`** — §1 Menstrual Cycle · §6 RED-S · §8 Iron Deficiency in Female Runners

Doctrine code:
- **`web/coach/doctrine/recovery_protocols.ts:349-354`** — six-tissue recovery windows (the basis for the body-systems card).
- **`web/coach/doctrine/wearables.ts:84-122`** — illness-early and overtraining-early signal arrays.
