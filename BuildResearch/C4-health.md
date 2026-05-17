# C4 — Content Inventory: Health

Inventory of every reasonable element across the Health surface — Web (default Recovery Dashboard plus seven sub-surfaces) and the iOS Health tab. Inclusive, not curated. The product owner picks what ships. Health is the densest area of the app: it is where biometrics, behaviors (sleep, fueling, hydration, modalities), self-report, and lab results converge into a single read on the body. Done well, it pre-empts the "why am I tired?" question and de-risks the next training block. Done poorly, it becomes a graveyard of pretty charts that the user does not trust.

Brand assumed: dark theme, hero numbers, small-caps gray labels, semantic color (green=recovery, blue=active, purple=milestone, gold=race, red=warning), coach-voice blocks with WHY/FOCUS/BACK OFF IF labels, honest tone. Sensitive surfaces (body composition, cycle, eating-disorder-adjacent inputs) get extra care — see privacy considerations per section.

KB references use filenames in `/Research/` (e.g., `15-wearable-data.md`). Recovery score detail lives in `BuildResearch/D1-recovery-score-methodology.md`; this doc references that as `D1`.

---

## Web: Recovery Dashboard (default Health landing)

### Job-to-be-done

"How recovered am I, why, and what should I do about it today?" Answered in <5 seconds with the hero score and word-band; supported by a 30-second contributor read; backed by a 2-minute drill into trends. The dashboard must reconcile against subjective feel honestly — when biometrics and gut disagree, surface the disagreement rather than averaging.

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Composite recovery score (0–100, hero) | must | app-computed (D1) | `15-wearable-data.md`, D1 | Single anchor for the page; rounded integer; only re-renders on ≥3-pt change. |
| 2 | Word-band ("Strained" / "Steady" / "Recovered") | must | app-computed (D1) | D1 | Carries the actionable read the number alone cannot. |
| 3 | Color band (red 0–32 / amber 33–66 / green 67–100) | must | app-computed (D1) | D1 | Boundaries match Whoop convention so cross-platform users translate cleanly. |
| 4 | Score trend sparkline (last 14 days) | must | app-computed | D1 | Trend, not absolute, is the action signal. |
| 5 | Score trend chart (30 / 60 / 90 day toggle) | should | app-computed | D1 | Power-user history; aligns with seasonal patterns. |
| 6 | Top contributing factor — one-line WHY ("HRV elevated; sleep on target.") | must | coach-templated (deterministic) | D1 §4 | Solves the "score doesn't match how I feel" trust failure. Rule-based, not LLM, so it never contradicts the number. |
| 7 | Contributor chips strip (HRV / RHR / Sleep / Load / Subjective / Temp) | must | app-computed | D1 §6 | Up to 5 chips, ordered by influence on today's score. |
| 8 | HRV chip (delta vs. 60-day baseline, % or LnRMSSD-×20 points) | must | HealthKit / Oura / Whoop / Garmin | `15-wearable-data.md`, D1 | 7-day rolling LnRMSSD vs. 60-day baseline mean ± SD. Cap at ±2 SD. |
| 9 | RHR chip (delta vs. 14-day baseline in bpm) | must | HealthKit / wearable | `15-wearable-data.md` | ±2 bpm = noise; ≥+5 bpm 2 days = flag. |
| 10 | Sleep chip (TST vs. need; efficiency) | must | HealthKit / Oura / Whoop / Garmin | `00b-recovery-protocols.md`, `15-wearable-data.md` | Tonight is one sample; weight below HRV trend. |
| 11 | Training-load chip (ACWR + ATL band) | should | app-computed | `15-wearable-data.md` | Identical biometric state means different things in build vs. taper. |
| 12 | Subjective chip (Hooper-style 4-item mean, when present) | should | user-input | D1 §2.5, `00b-recovery-protocols.md` | Subjective beats objective in detecting overload (Saw 2016). |
| 13 | Body-temp chip (only when flagged ±0.5°C 3-day) | nice | Apple Vitals / Oura | D1 §2.6 | Illness or cycle phase hint; quiet by default. |
| 14 | Daily subjective check-in (energy / soreness / mood / motivation, 1–5 each) | must | user-input | D1, `00b-recovery-protocols.md` | One thumb / one click; idempotent on day key. |
| 15 | "How does this match how you feel?" override prompt | should | user-input | D1 §8 | When biometric and subjective disagree by >30 pts, surface explicitly. |
| 16 | HRV detail card (today / 7-day / 30-day; LnRMSSD; SWC band) | must | HealthKit / wearable | `15-wearable-data.md` | The load-bearing recovery signal; deserves a real surface. |
| 17 | RHR detail card (nocturnal lowest 30-min; 14/60-day baselines) | must | HealthKit / wearable | `15-wearable-data.md` | Confirmer of HRV; second-best autonomic signal. |
| 18 | Sleep last night card (duration, efficiency, debt) | must | HealthKit / Oura / Whoop | `00b-recovery-protocols.md`, `15-wearable-data.md` | Highest-evidence ROI recovery modality. |
| 19 | Sleep need vs. got (today + 7-day debt) | should | app-computed | `00b-recovery-protocols.md` | Whoop-style framing; clearer than raw hours. |
| 20 | Training load (CTL / ATL / TSB) chart | should | app-computed | `15-wearable-data.md` | PMC-style fitness/fatigue/form view; power users. |
| 21 | ACWR gauge with 0.8–1.3 sweet-spot band | should | app-computed | `15-wearable-data.md` | Directional sanity check, not a stop-light — surface as such. |
| 22 | Coach's read (3–5 sentence narrative on today's score) | must | coach-LLM | D1 §4 | The "WHY" voice block; references inputs explicitly. |
| 23 | "Back off if…" guardrails (1–3 lines, contextual) | should | coach-LLM | `00b-recovery-protocols.md` | Honest brand promise. |
| 24 | Recommended training intensity adjustment (today only) | should | app-computed + coach-LLM | `00b-recovery-protocols.md` | Translates score into coach action: "Hold off on intervals; swap for easy 45." |
| 25 | Risk alerts (overtraining flags, illness watch, ACWR spike, RHR drift, HRV slump) | must | app-computed | `00b-recovery-protocols.md`, `15-wearable-data.md`, D1 | Don't bury warnings in chart noise. |
| 26 | Active injury banner with stage + RTR step | must | user-input + coach | `05-injury-return-protocols.md` | Overrides almost everything else; top of page. |
| 27 | Cycle phase tile (female users, opt-in) | should | user-input / HealthKit | `13-sex-specific-training.md` | Phase tag, not phase prescription — McNulty 2020 evidence. |
| 28 | Days since last race / hard effort | should | app-computed | `00b-recovery-protocols.md` | Recovery context. |
| 29 | Time-since-last-rest-day chip | nice | app-computed | `00b-recovery-protocols.md` | Catches the "I haven't taken a day off in 14 days" pattern. |
| 30 | Source attribution per metric ("HRV from Oura · 4 min ago") | must | integrations | `15-wearable-data.md` | Trust the data. |
| 31 | Baseline-state badge (Pre-baseline / Provisional / Establishing / Stable) | must | app-computed | D1 §5 | Honest about what we know yet. |
| 32 | Confidence indicator per chip (HIGH / MEDIUM / LOW) | should | app-computed | D1 §7 | Driven by source fidelity + valid-night count. |
| 33 | Quick links to: Sleep Detail, Body Comp, Nutrition, Bloodwork, Modalities, Cycle | should | app-computed | — | Hub navigation. |
| 34 | "Mark sick" toggle | should | user-input | `00b-recovery-protocols.md` | Honest signal that suppresses ACWR alerts and adjusts plan. |
| 35 | "Mark traveled / altitude" tag | should | user-input | `12-travel-timezone.md` | Confound-aware; coach narrative adapts. |
| 36 | Weekly recovery-pattern summary ("HRV stable 19 of 21 days") | nice | app-computed | `15-wearable-data.md` | Stability framing instead of streak. |
| 37 | Notification preferences for recovery alerts | nice | user-input | — | Quiet hours; severity threshold. |
| 38 | Algorithm version tag (v1.0.x with a tap explainer) | should | app-computed | D1 §7 | Maintains trust across algorithm updates; required for backfill. |
| 39 | "Why this number?" tap-into modal | should | app-computed | D1 §4 | Layered transparency without overwhelming the surface. |
| 40 | Empty state for new users (first 0–13 days) | must | app-computed | D1 §5 | "Setting up your baseline" with raw inputs visible; no fake score. |

### Recovery Dashboard special section

**Composite score** is computed per `D1-recovery-score-methodology.md`. The runtime weights are HRV 40% / RHR 18% / Sleep 22% (biometric composite), modulated by a training-load multiplier in [0.85, 1.10] and an optional ±16-point subjective overlay. The displayed score is rounded; internal score is float; the score only re-renders on a ≥3-point change (to avoid false precision and noise-driven UI churn).

**Top contributing factors** are surfaced as chips ordered by absolute z-score (largest delta first). Each chip carries: label, direction arrow, delta value, baseline reference, and a tap-into expansion. Direction is encoded with semantic color (green = supportive of recovery, amber = caution, red = warning); chips never use rainbow color.

**HRV** is shown three ways: today's reading, 7-day rolling LnRMSSD, and 30-day chart with the 60-day baseline mean and ±SD ribbon. The smallest worthwhile change (SWC = 0.5 × SD) is rendered as a dashed line so users see the noise floor; movements inside it are explicitly *not* called signal. The Plews approach (`research/15-wearable-data.md` §HRV) is the canonical method. Coefficient of variation of the 7-day rolling mean is exposed in the drill-down — rising CV with stable mean is the early-overreach signature.

**RHR** is presented as nocturnal lowest 30-min (the wearable standard) with a 14-day rolling baseline and a 60-day reference. ±2 bpm is explicitly labeled as noise. ≥+5 bpm for 2+ consecutive days triggers an illness/incomplete-recovery flag with a coach line. ~30% of overtrained athletes do not show RHR elevation (`15-wearable-data.md`); this is called out so RHR is not overweighted in the user's mental model.

**Sleep last night** card shows total sleep time, time in bed, sleep efficiency, latency, sleep need (default 8h, +1h during heavy weeks per sleep-extension research, user-overridable), and a 7-day debt counter. Stage breakdown is shown only as supplementary — wearables hit ~70–80% 4-stage agreement vs. polysomnography (`15-wearable-data.md`), so single-night stages are explicitly informational, not actionable.

**Subjective inputs** use a Hooper-style 4-item card (energy, soreness, mood, motivation, 1–5 each) with optional freeform notes. The McLean 5-item alternative is available as a setting. When the user logs <60% of days, the system de-weights the subjective overlay automatically. Compliance is the open question (D1 §8.1) — the prompt is designed to be one thumb, two taps, and the card is auto-presented on first morning open.

**Training load** is rendered as both an ACWR gauge (acute/chronic ratio, sweet-spot 0.8–1.3, caution 1.3–1.5, danger >1.5) and a CTL/ATL/TSB chart for users who want PMC-style fitness/fatigue/form. ACWR is treated as a directional sanity check with hedging copy (`research/15-wearable-data.md` review notes are explicit that ACWR is not a stop-light) — the UI never says "your ACWR is too high, do not run today." It says "ACWR 1.6 — well above your typical band; consider keeping today easy."

**Coach's read** is the WHY voice block at the top of the dashboard. Three sentences max. Deterministic templates fire from the dominant chip (HRV ↓, RHR ↑, SLEEP −, LOAD +, FEEL 2/5) with optional LLM elaboration when the data is layered. Examples in D1 §4. The narrative is grounded in the inputs — no synthesized claims, no commentary the chips don't support.

### Privacy considerations

- **Body-comp link** is hidden by default; surfaced only when the user has logged any body-composition data themselves. Never auto-surfaced for new users.
- **Cycle tile** is opt-in, never auto-displayed, and never inferred from HRV alone (HRV signal is too noisy and cycle inference from a single biometric is invasive — `13-sex-specific-training.md` §1.3).
- **Subjective notes** are local-only by default; HealthKit write is opt-in.
- **Recovery score history** is exportable (CSV) and deletable (full purge of `ReadinessScore` rows for a date range).

---

## Web: Body Composition

### Job-to-be-done

"Track body changes over time without becoming the topic." For runners, body composition correlates weakly with performance at the individual level and strongly with eating-disorder risk in lean-sport culture (`13-sex-specific-training.md` §12). The page exists but is opt-in, calm, and de-emphasizes the scale number in favor of trends and training-phase context.

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Body weight (today, with 7-day rolling average) | should | HealthKit / smart scale / manual | `13-sex-specific-training.md` | Trend matters; single readings are noise (cycle, hydration, GI). |
| 2 | Body weight chart (30 / 60 / 90 / 365 day) | should | HealthKit / smart scale | — | Long-term view de-emphasizes single-day swings. |
| 3 | 7-day rolling weight (primary number) | should | app-computed | — | Smooths out daily noise; the only weight metric routinely surfaced. |
| 4 | Body-fat percent (if entered) | nice | smart scale / DEXA / manual | `13-sex-specific-training.md` | BIA scales are unreliable; flag this in tooltip. |
| 5 | Lean body mass (if entered) | nice | smart scale / DEXA | `13-sex-specific-training.md` | More relevant than BF% for training quality. |
| 6 | BMR / RMR estimate | nice | app-computed (Mifflin-St Jeor) | `13-sex-specific-training.md` | Coarse; for fueling-target context only. |
| 7 | Hydration % (smart scale, if available) | later | smart scale | `19-hydration-electrolytes.md` | Field accuracy poor; trend only. |
| 8 | Bone mass (smart scale, if available) | later | smart scale | `13-sex-specific-training.md` | Approximation; DEXA is the real source. |
| 9 | Visceral fat estimate | later | smart scale | — | Coarse; for the masters-athlete population. |
| 10 | Trend annotations against training phases (build / peak / taper / race / off-season) | should | app-computed | `00a-distance-running-training.md`, `22-plan-templates.md` | Body comp varies with training phase; show the phase, not just the number. |
| 11 | RHR-vs-weight scatter / overlay | nice | HealthKit + scale | `15-wearable-data.md` | Useful pattern: low body weight + low RHR + fatigue = LEA flag. |
| 12 | Body-weight vs. mileage overlay | nice | app-computed | `00a-distance-running-training.md` | Catches under-fueling drift during builds. |
| 13 | Loss-rate flag (>1% drop in 1 week, >5% unexplained) | must | app-computed | `13-sex-specific-training.md` §6.6 | RED-S red-flag criterion; surfaces a referral prompt. |
| 14 | Privacy mode toggle ("Hide weight; show trend only") | must | user-setting | `13-sex-specific-training.md` §12 | Eating-disorder mitigation; user controls visibility. |
| 15 | Hide-from-Overview toggle | must | user-setting | — | Body-comp data should never auto-leak to other surfaces. |
| 16 | Note field per entry | nice | user-input | — | "Cycle day 1, water weight" context. |
| 17 | LEAF-Q / LEA self-screen prompt (annual; female users) | should | user-input | `13-sex-specific-training.md` §6.5 | Validated screen; ≥8 = referral. |
| 18 | RED-S risk indicator (composite of weight loss, RHR, menstrual status, fatigue) | should | app-computed | `13-sex-specific-training.md` §6 | Quiet flag; never moralizing copy. |
| 19 | DEXA result entry (if user has one) | should | user-input | `13-sex-specific-training.md` §9 | The only reliable bone density / body fat source. |
| 20 | Z-score interpretation for athlete (Z ≤ −1.0 = low BMD) | should | app-computed | `13-sex-specific-training.md` §9.2 | Athlete-specific, not general-population norms. |
| 21 | Disordered-eating safety footer ("If body comp is becoming a focus, talk to a sports dietitian.") | should | static | `13-sex-specific-training.md` §13 | Explicit, calm, not preachy. |
| 22 | Data export (CSV) | nice | app-computed | — | User portability. |
| 23 | Delete-history action | must | user-input | — | Privacy. |

### Body Composition section

**Weight** is shown as a 7-day rolling average by default; today's spot reading is exposed only when the user taps to expand. Single-day swings are explicitly labeled as cycle / hydration / GI noise. The chart axis defaults to a tight range around the rolling mean — never zero — to avoid theatrical "weight crash" visuals.

**Body fat %, lean mass, hydration %, bone mass, visceral fat** are surfaced when the user has entered any value (smart scale or manual), with prominent tooltips that bioimpedance estimates are unreliable. DEXA values, when entered, get a "DEXA · validated" badge and are used preferentially.

**BMR** is a Mifflin-St Jeor estimate from height, weight, age, sex, with an activity multiplier. It exists to inform the Nutrition page's daily calorie target band, not to dictate it.

**Trend annotations** layer the user's training phase as a colored band behind the weight chart (gold = race week, green = recovery, blue = build, etc.). Users see why a 2lb drop coincides with peak week and a 3lb regain with taper.

**RHR-vs-weight correlation** is exposed in the drill-down for users who have ≥30 days of both. The pattern is informational; the page does not auto-conclude. A LEAF-Q link sits next to it.

### Privacy considerations

- Body-comp section is **opt-in at first sight**: the entry point on the Health hub is greyed until the user explicitly enables it.
- "Hide weight; show trend only" is one toggle that masks the absolute number across the entire app (Overview, recap, share cards). Trend direction (↑ / ↓ / steady) remains visible if the user wants it.
- No share / export to social by default. No leaderboards. No comparisons to other users.
- Adolescent-account guard rail: if the account is flagged as <18, body-comp is hidden by default with a parental-permission prompt. Per `13-sex-specific-training.md` §12.1, adolescents should not be subjected to body-composition manipulation.
- LEAF-Q score is private; the result is shown to the user with referral language but is not aggregated into any public-facing score.
- All body-comp data is included in the standard delete/export flows.

---

## Web: Sleep Detail

### Job-to-be-done

"How am I sleeping, and is it supporting (or sabotaging) my training?" Sleep is the single highest-ROI recovery modality (`00b-recovery-protocols.md`). The page should make trends actionable without faking precision the wearables can't deliver — single-night stage breakdowns are noise; total sleep time and efficiency are the trustworthy metrics.

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Sleep last night (duration, hero) | must | HealthKit / Oura / Whoop / Garmin | `00b-recovery-protocols.md` | Headline metric. |
| 2 | Sleep efficiency (TST / TIB %) | must | HealthKit / wearable | `15-wearable-data.md` | Trustworthy; flag <85%. |
| 3 | Sleep need (personalized; default 8h, +1h heavy weeks) | must | app-computed | `00b-recovery-protocols.md` | Frames duration honestly. |
| 4 | Sleep debt rolling (7-day cumulative) | should | app-computed | `00b-recovery-protocols.md` | Whoop-style; clearer than raw hours. |
| 5 | Bedtime / wake-time consistency chart | should | HealthKit / wearable | `00b-recovery-protocols.md` | Hygiene signal; midpoint stability matters. |
| 6 | Midpoint shift (today vs. 7-day median) | nice | app-computed | `00b-recovery-protocols.md` | Catches the pre-race social-jet-lag drift. |
| 7 | Sleep stages (REM / deep / light / awake) | should | wearable | `15-wearable-data.md` | Show on tap; explicitly low-trust for single nights. |
| 8 | Stage trend over 14+ days (direction only) | should | app-computed | `15-wearable-data.md` | The trustable layer of stage data. |
| 9 | Wake-after-sleep-onset (WASO) | nice | wearable | `15-wearable-data.md` | Trend only; specificity weak on consumer devices. |
| 10 | Sleep latency | nice | wearable | `15-wearable-data.md` | Trend only. |
| 11 | Sleep score (Oura / Whoop / Apple) | should | wearable | `15-wearable-data.md` | Composite from the source-of-truth device; surfaced with attribution. |
| 12 | Naps log (manual or auto-detected) | nice | HealthKit / user-input | `00b-recovery-protocols.md` | 20–90 min nap protocol; tap-to-log. |
| 13 | Correlation: sleep ↔ next-day HRV | should | app-computed | D1 | Visualize the cause→effect. |
| 14 | Correlation: sleep ↔ workout RPE | should | app-computed | `00b-recovery-protocols.md` | Bad night → harder run; users want to see this. |
| 15 | Correlation: sleep ↔ recovery score | should | app-computed | D1 | Quantifies sleep's contribution. |
| 16 | Sleep-extension banner (heavy-load / race week) | should | app-computed | `00b-recovery-protocols.md` | Stanford basketball / sleep-banking literature; +1h prompt. |
| 17 | Sleep-banking countdown (race week travel) | nice | app-computed | `00b-recovery-protocols.md`, `12-travel-timezone.md` | Pre-race short-sleep mitigation. |
| 18 | Caffeine cutoff reminder (8h before bed) | nice | app-computed | `00b-recovery-protocols.md` | Half-life ~5h; surface contextually. |
| 19 | Alcohol-impact note (auto-tag if user logs) | nice | user-input | `00b-recovery-protocols.md` | Alcohol fragments REM; user-acknowledged confound. |
| 20 | Bedroom-environment hygiene checklist (cool, dark, quiet, ~18°C) | nice | static | `00b-recovery-protocols.md` | Educational; one-time-read tile. |
| 21 | Travel / DST / timezone tag on affected nights | should | user-input + app-computed | `12-travel-timezone.md` | Confound annotation. |
| 22 | Source attribution per night | must | integrations | — | "From Oura · 7h 42m" beside source-conflict resolution. |
| 23 | Multi-source conflict resolution (highest-fidelity wins; user override) | should | app-computed | `15-wearable-data.md`, D1 §5 | Oura > Apple Watch > Garmin > Whoop wrist for sleep. |
| 24 | 30-day duration distribution histogram | nice | app-computed | — | Catches the "I think I sleep 8h but I average 6:45" reality. |
| 25 | 7-night ribbon chart (each night as a bar with stage segments) | should | wearable | — | Pattern at a glance. |
| 26 | "Mark sick / traveled" night-level tag | nice | user-input | `00b-recovery-protocols.md` | Confound annotation; affects coach narrative. |
| 27 | Coach's sleep read (3-line narrative weekly) | should | coach-LLM | `00b-recovery-protocols.md` | "Your average is 7:08 — 50 min below your need. That's the dominant drag on recovery this week." |

### Sleep Detail section

The page leads with **last night** (duration hero, efficiency, score from source), then **need vs. got** (personalized; default 8h, +1h during heavy weeks per sleep-extension research), then **7-day debt** as the rolling gap. The 7-night ribbon chart shows duration + stage segments in a small-multiples format so the user can spot the late-Friday-night pattern that's tanking Saturday's long run.

**Stages** are shown only as supplementary because consumer wearables hit ~70–80% 4-stage agreement vs. polysomnography (`research/15-wearable-data.md`). Single-night stage callouts are explicitly informational; trend over 14+ days is the only actionable layer. The page never says "you didn't get enough deep sleep last night" because that claim is below the device's noise floor.

**Bedtime / wake consistency** uses a small-multiples calendar grid with the user's bedtime and wake-time as bars. Midpoint shift > 60 min vs. 7-day median is flagged. This is the surface that catches social jet lag and pre-race anxiety drift.

**Debt** is computed as the sum of (need − actual) clamped at 0 from below over 7 days. Users see "+2h 14m debt this week" rather than the abstract score.

**Correlation overlays** are computed per-user across ≥30 days. The two reliably useful patterns are: (1) sleep ↔ next-day HRV (causal direction is correct; lag is one night), and (2) sleep ↔ workout RPE (when reported). Surface as scatter with a fitted line and an r-value labeled "your correlation, not population." Avoid implying causation the user's data can't establish.

**Sleep score** from Oura, Whoop, or Apple is surfaced with attribution rather than rebuilt. The composite the user already trusts shouldn't be replaced by a worse one. Multi-source conflict goes to the highest-fidelity source per metric (Oura > Apple Watch > Garmin > Whoop wrist for sleep stages, per `15-wearable-data.md`); user can override in Settings.

**Midpoint shifts** and **naps** appear in the same timeline. Naps are auto-detected from HealthKit when possible; manual one-tap log is the fallback. Naps are not added to total sleep need (they restore performance after partial restriction; they don't bank toward tonight's need).

---

## Web: Nutrition & Fueling

### Job-to-be-done

"Am I fueling for the work I'm doing today and tomorrow?" Not a full nutrition app — Cronometer, MFP, MacroFactor own that. This page tracks the running-relevant numbers (carb periodization, protein adequacy, race fueling adherence, gut training) and integrates daily totals from the user's primary nutrition tool when one is connected.

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Daily calories (today + 7-day average) | should | MyFitnessPal / Cronometer / manual | `18-fueling-products.md` | Context for fueling adequacy. |
| 2 | Macros (carbs / protein / fat) absolute + % | should | MFP / Cronometer | `18-fueling-products.md` | Carb periodization is the running-specific layer. |
| 3 | Protein vs. target (1.4–2.0 g/kg/day, training-phase scaled) | must | MFP / Cronometer / manual | `00b-recovery-protocols.md`, `13-sex-specific-training.md` | Single most impactful nutrition lever for runners. |
| 4 | Carb intake vs. training-load target (5–10 g/kg scaled) | must | MFP / Cronometer | `00b-recovery-protocols.md`, `18-fueling-products.md` | Phase-aware carb periodization. |
| 5 | Carb periodization timeline (training-day vs. easy-day vs. race-week) | should | app-computed | `18-fueling-products.md`, `08-pacing-and-race-week.md` | "Fuel for the work" framing. |
| 6 | Hydration target today (ml/kg + heat adjustment) | must | app-computed + weather-API | `19-hydration-electrolytes.md` | 30–55 ml/kg base, +5–10 ml/kg heat. |
| 7 | Hydration logged (ml today) | should | user-input / HealthKit | `19-hydration-electrolytes.md` | Quick-tap chips (250 / 500 / 750 ml). |
| 8 | Sodium target + actual | should | user-input / app-computed | `19-hydration-electrolytes.md` | Sweat sodium varies; default 1,000–1,500 mg/L sweat. |
| 9 | Caffeine intake (mg + last dose time) | nice | user-input | `00b-recovery-protocols.md`, `18-fueling-products.md` | Half-life ~5h; sleep-cutoff calculator. |
| 10 | Supplement stack (current daily) | should | user-input | `13-sex-specific-training.md`, `14-age-considerations.md` | Iron, vit D, B12, omega-3, creatine, etc. — runner-specific. |
| 11 | Supplement adherence (taken / skipped) | nice | user-input | — | Single tap per item. |
| 12 | Pre-workout fueling card (today's session) | must | app-computed | `18-fueling-products.md` | Long/quality runs need a stated pre-fuel plan. |
| 13 | During-workout fueling plan (g/hr CHO target) | must | app-computed | `18-fueling-products.md` | Distance + duration scaled (30–120 g/hr). |
| 14 | Post-workout window prompt (1.0–1.2 g/kg CHO + 20–30 g protein in 0–30 min) | should | app-computed | `00b-recovery-protocols.md` §Nutrition | Auto-prompts after long/quality session. |
| 15 | Long-run fueling-plan adherence (gels logged vs. planned) | must | user-input | `18-fueling-products.md` | Gut-training history; the 2.5h+ flag. |
| 16 | Race fueling plan (per race) | must | user-input + app-computed | `18-fueling-products.md`, `08-pacing-and-race-week.md` | Tested-in-training products only. |
| 17 | Race carb-load tracker (last 36–48h before race; 8–12 g/kg/day) | must | user-input | `18-fueling-products.md`, `08-pacing-and-race-week.md` | Race-week specific. |
| 18 | Race-day morning fuel plan (3–4h pre, 30–60g CHO) | should | user-input | `18-fueling-products.md`, `08-pacing-and-race-week.md` | Eliminates race-morning improvisation. |
| 19 | Gut-training session log (g CHO / hr tested in workouts) | should | user-input | `18-fueling-products.md` §Gut Training | Critical for >90 g/hr targets. |
| 20 | Fueling product inventory (gels / chews / drinks owned) | nice | user-input | `18-fueling-products.md` | Cross-page with Gear inventory. |
| 21 | Reorder reminder | nice | app-computed | — | Quiet nudge based on usage rate. |
| 22 | Heat-day hydration alert | should | app-computed + weather-API | `19-hydration-electrolytes.md`, `06-weather-adjustments.md` | Targets shift up materially in hot conditions. |
| 23 | EAH (hyponatremia) safety callout for slow runners in heat | should | static + contextual | `19-hydration-electrolytes.md` | Drink-to-thirst guidance when relevant. |
| 24 | Sweat-rate calculator (pre/post weight + fluid in − pee out) | should | user-input | `19-hydration-electrolytes.md` | Personalizes hydration plan. |
| 25 | Caffeine cut-off reminder (race week + sleep) | nice | app-computed | `08-pacing-and-race-week.md`, `00b-recovery-protocols.md` | Tactical. |
| 26 | Alcohol log + auto-confound tag on next-day metrics | nice | user-input | `00b-recovery-protocols.md` | Honest mirror; non-judgmental copy. |
| 27 | EA (energy availability) estimate (intake − exercise expenditure / FFM) | should | app-computed | `13-sex-specific-training.md` §6 | LEA risk if <30 kcal/kg FFM/day; quiet flag, not alarm. |
| 28 | Iron-rich foods nudge for known low-ferritin users | nice | static + bloodwork-aware | `13-sex-specific-training.md` §8 | Vit C pairing, alternate-day dosing context. |
| 29 | MFP / Cronometer / MacroFactor sync status | should | integrations | — | Source-of-truth indicator. |
| 30 | "Log meal manually" fallback | nice | user-input | — | One-tap protein / carbs / kcal estimate. |
| 31 | Weekly nutrition review (coach narrative) | nice | coach-LLM | `00b-recovery-protocols.md`, `18-fueling-products.md` | "You hit protein 5 of 7 days; carbs lagged on the long-run day." |
| 32 | Privacy: hide calorie totals toggle | should | user-setting | `13-sex-specific-training.md` §13 | DE/ED mitigation. |
| 33 | Race fueling products tested in training (chips) | should | app-computed | `18-fueling-products.md` | "Maurten 100 — 7 long runs." |

### Nutrition & Fueling section

The page de-emphasizes calories in favor of **carb-and-protein adequacy for the work**. Calorie totals are present but secondary; the heroes are protein vs. target (1.4–2.0 g/kg/day), carbs vs. training-load target (5–10 g/kg/day periodized), and fueling-plan adherence on long runs. This framing comes from `00b-recovery-protocols.md` and `13-sex-specific-training.md` §6 — body comp is downstream of fueling-for-work.

**Carb periodization** is shown as a 7-day strip with target g/kg per day color-banded against actual: highest on long-run / quality days, moderate on easy days, lower on rest days. The "fuel the work" coach line ("Yesterday's long run was 5g/kg under target") is the actionable read.

**Hydration** uses the `19-hydration-electrolytes.md` protocol: baseline 30–55 ml/kg/day by training volume, +5–10 ml/kg/day in heat, +0.5–1 L at altitude. Daily intake is a chip with one-tap +250/+500/+750 ml buttons. Sodium target rides alongside (1,000–1,500 mg/L sweat for normal sweat-sodium athletes; user can override with sweat-sodium test results).

**Caffeine** is logged in mg with timestamp; the page shows the half-life-aware "last dose at X — clear by Y" sleep cutoff. Race-week caffeine timing tips into the Race Day surface; here it's a quiet contextual tile.

**Supplement stack** is a list with daily tap-to-confirm. Common runner supplements (iron, vit D, B12, omega-3, magnesium, creatine) get default tile cards with reference doses. The stack ties to bloodwork: a low-ferritin user gets an iron-supplement card with the alternate-day-dosing protocol from `13-sex-specific-training.md` §8.3.

**Pre-workout fueling** auto-prompts on long-run / quality-session days: "3–4h before: 1–4 g/kg CHO. 0–60 min: 30–60 g CHO if tolerated." (`18-fueling-products.md`).

**Fueling-plan adherence on long runs** is the most-used section. Each long run has a planned g/hr target; the user logs gels / chews / drink as they consume them; the page reconciles actual vs. planned and flags when gut training is needed for the next jump (e.g., user is on 60 g/hr and the goal-race target is 90 g/hr).

**Race carb-load tracker** activates 36–48h before an A-race. Target is 8–12 g/kg/day for ≥36h pre-race (`18-fueling-products.md`). Day-by-day strip; one-tap log; race-morning fuel pre-set 3–4h before gun.

**Integration with MyFitnessPal / Cronometer / MacroFactor** is read-only by default (calories, macros, hydration). Manual log is the fallback; one-tap "I had a normal-protein dinner" estimator. The app does not try to be a food-logging app — it borrows the totals.

### Privacy considerations

- "Hide calorie totals" toggle masks daily kcal across the app. EA estimate, body weight, and any "deficit" framing also disappear when this is on. Per `13-sex-specific-training.md` §13, ED prevalence in endurance athletes is 20–45% female / 10–25% male.
- The page never displays a calorie deficit number. EA is shown as a category (low / adequate / high) when relevant for LEA flagging, never as a target to hit.
- LEAF-Q / SCOFF / BEDA-Q screens live in Body Comp; nutrition page links to them rather than embedding.
- Adolescent guard rail mirrors body-comp.

---

## Web: Injuries & Body Map

### Job-to-be-done

"What's hurting, where, how bad, and what's the protocol to come back?" The page lives at the intersection of pain logging (low-friction, low-stigma), active-injury management (with the canonical RTR protocol from `05-injury-return-protocols.md`), and history (so patterns become visible).

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Interactive body diagram (front view) | must | app-computed | `05-injury-return-protocols.md` | Tap-to-locate is the dominant pattern (Hevy, Strava-adjacent, sports-clinic apps). |
| 2 | Interactive body diagram (back view, swipe to flip) | must | app-computed | `05-injury-return-protocols.md` | Posterior-chain coverage. |
| 3 | Tap-to-log soreness/pain at point (0–10 NRS) | must | user-input | `05-injury-return-protocols.md` §1.2 | Silbernagel-style 0–10 scale; the field standard. |
| 4 | Pain type tag (sharp / dull / ache / stiffness / burning) | should | user-input | `05-injury-return-protocols.md` | Differentiates BSI from soft-tissue at a glance. |
| 5 | Bilateral / unilateral toggle | should | user-input | `05-injury-return-protocols.md` | Compensatory-pattern detection. |
| 6 | When-it-hurts tag (during / after / morning stiffness / always) | should | user-input | `05-injury-return-protocols.md` §1.2 | The 24-hour rule needs the timing. |
| 7 | Provoking activity (running / walking / weights / nothing) | nice | user-input | `05-injury-return-protocols.md` | Aggravator tracking. |
| 8 | Pain-trend chart per location (last 90 days) | should | app-computed | `05-injury-return-protocols.md` | Pattern recognition; the "this knee bothers me whenever I push >40 mpw" insight. |
| 9 | Active injury card (location, started, severity, status) | must | user-input | `05-injury-return-protocols.md` | Top of page when injured. |
| 10 | RTR protocol stage (1–8) for active injury | must | app-computed + user-input | `05-injury-return-protocols.md` §1.1 | The canonical walk-run progression. |
| 11 | RTR session prescription for today (run/walk min, repeats) | must | app-computed | `05-injury-return-protocols.md` §1.1 | Replaces today's workout when active injury is in RTR. |
| 12 | RTR pain-monitoring criteria (the three rules) | must | static | `05-injury-return-protocols.md` §1.2 | Visible during RTR; user logs pain post-session. |
| 13 | Stage-progression decision aid (advance / hold / drop) | must | app-computed + user-input | `05-injury-return-protocols.md` §1.2 | Based on pain rules; conservative defaults. |
| 14 | Cross-training prescription during RTR | should | app-computed | `05-injury-return-protocols.md` §1.3, `09-cross-training.md` | Pool, bike, elliptical with intensity-matched sessions. |
| 15 | Red-flag symptom checker (per-injury) | must | static + user-input | `05-injury-return-protocols.md` §1.6 | Refer-to-clinician criteria explicit, not buried. |
| 16 | Medical referral prompt with criteria | must | app-computed | `05-injury-return-protocols.md` §1.6 | "Symptoms ≥6 weeks: see a clinician." |
| 17 | Injury history timeline (lifetime) | must | user-input | `05-injury-return-protocols.md` | Pattern recognition across years. |
| 18 | Recurrence frequency by location | should | app-computed | `05-injury-return-protocols.md` | "This is the 3rd hamstring strain in 18 months." |
| 19 | Days since last injury chip | nice | app-computed | `00b-recovery-protocols.md` | Honest framing — durability. |
| 20 | Related notes per injury (rehab exercises, PT visits, scans) | should | user-input | — | Continuity; the place rehab notes go. |
| 21 | PT / clinician visit log | nice | user-input | — | Date, provider, notes. |
| 22 | Imaging log (X-ray / MRI / ultrasound results, notes only — no PHI) | nice | user-input | — | User's own copies; no upload. |
| 23 | Strength / mobility prescription tied to injury | should | app-computed | `05-injury-return-protocols.md`, `07-strength-programming.md`, `10-mobility-warmup.md` | "Hip strength for ITB; calf eccentrics for Achilles." |
| 24 | Footwear correlation (shoe rotation at injury onset) | nice | app-computed | `17-footwear.md` | Auto-attributes shoes ridden in the 30 days pre-onset. |
| 25 | Surface / volume / intensity correlations (training context at onset) | nice | app-computed | `00a-distance-running-training.md`, `15-wearable-data.md` | The 10% rule violations, ACWR spikes, surface changes. |
| 26 | Coach's read on the injury (3–5 sentence narrative) | should | coach-LLM | `05-injury-return-protocols.md` | Stage, next step, watch-for. |
| 27 | "Mark resolved" action | must | user-input | — | Clean closure; archived in history. |
| 28 | "Mark recurrence" action | must | user-input | `05-injury-return-protocols.md` | Same location reopens prior injury record. |
| 29 | Privacy: hide-from-Overview toggle for active injury | should | user-setting | — | Some users prefer not to surface to others on shared screens. |
| 30 | Daily soreness overlay (yesterday's log) on workout card | should | app-computed | `00b-recovery-protocols.md` | Influences today's prescription. |
| 31 | Pain-during-run prompt post-session | should | user-input | `05-injury-return-protocols.md` §1.2 | The 0–10 in-session rule. |

### Injuries & Body Map section

The body map is the **primary capture surface**. Front and back views, swipeable. Tap a region — quad, hamstring, knee anterior, knee lateral, IT band, Achilles, plantar fascia, calf, hip flexor, glute, lower back, etc. — and a sheet appears with the 0–10 NRS, pain-type tags, when-it-hurts tags, and a "log without making it an injury yet" affordance. Soreness is captured separately from injury status: most points are routine soreness that resolves in 48h; an injury is declared when soreness persists, intensifies, or matches the red-flag criteria.

**Pain trends** per location plot the 0–10 NRS over time with training-load and shoe-rotation overlays. This is where the "ITB acts up whenever I push past 50 mpw on the trail rotation" pattern becomes visible.

**Active injury status** is the page's hero when present. The card shows: location, severity (mild / moderate / severe), days since onset, current RTR stage (1–8 from `05-injury-return-protocols.md` §1.1), pain rule status (today's NRS, 24h, location), recommended next session, days at current stage, advance/hold/drop guidance.

**Return-to-run protocol stage** drives today's prescription: at stage 3, the workout is "5 × (3 min run / 2 min walk) on flat firm surface." The eight-stage table from KB doc 05 §1.1 is canonical. Progression rules are conservative — minimum 2 sessions per stage; drop a stage on rising pain or 48h non-resolution.

**Pain-monitoring criteria** (the three rules from `05-injury-return-protocols.md` §1.2) are persistently visible during RTR: 0–10 in-session, 24h-after, location-specific. Each post-session prompt asks the three questions.

**Cross-training prescription** during RTR draws from `09-cross-training.md` and matches the user's normal training profile (long aerobic 60–90 min, intervals 4–6 × 3–5 min hard, etc.). Pool running preserves VO2max for trained runners up to 4–6 weeks (`05-injury-return-protocols.md` §1.3).

**Red-flag prompts** are unmissable. Universal red flags: focal point-tender bone pain, night pain, rest pain, visible swelling/deformity, sudden audible "pop," strength deficit >50%, paraesthesia, symptoms ≥6 weeks, symptoms worsening (`05-injury-return-protocols.md` §1.6). Joint-specific red flags surface based on location. The page never replaces medical care; it routes to it.

**Injury history timeline** is a lifetime view with each injury as a band on a horizontal timeline, color-coded by severity. Pattern recognition: two right-Achilles incidents 18 months apart, both during peak weeks of marathon prep — that pattern is what the chart is for.

**Related notes** per injury hold the rehab-exercise lists, PT-visit summaries, imaging notes, and scan results (text only — no image upload). Continuity matters; rehab works only when the protocol is followed for weeks.

---

## Web: Biometric Trends

### Job-to-be-done

"Show me the long-term trajectories of the metrics that actually drive training decisions." HRV, RHR, VO2max estimate, cardiac drift, recovery time, training load. The Recovery Dashboard answers "today"; this page answers "over weeks and months."

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | HRV chart (LnRMSSD, 30 / 60 / 90-day toggle) | must | HealthKit / wearable | `15-wearable-data.md` | Trend is the action signal; absolute is meaningless across people. |
| 2 | HRV 60-day baseline ribbon (mean ± SD) | must | app-computed | `15-wearable-data.md`, D1 | The Plews/Laursen frame. |
| 3 | HRV smallest worthwhile change (SWC) marker | should | app-computed | `15-wearable-data.md` | Movements inside SWC are explicitly not signal. |
| 4 | HRV CV (coefficient of variation) of 7-day rolling | should | app-computed | `15-wearable-data.md` §HRV | Rising CV with stable mean = early overreach. |
| 5 | RHR chart (60 / 90 / 365-day) with baseline | must | HealthKit / wearable | `15-wearable-data.md` | Long-term aerobic adaptation signal; downward drift over months is positive. |
| 6 | RHR drift annotations (illness, alcohol, travel, altitude) | should | user-input + app-computed | `15-wearable-data.md` §RHR | Confounders make charts honest. |
| 7 | VO2max estimate (HealthKit / Garmin / Coros / app-computed) | should | wearable / app-computed | `01-pace-zones-vdot.md`, `02-race-time-prediction.md` | One-number fitness; brand-fit hero. |
| 8 | VO2max trend over 90 / 365 days | should | app-computed | `01-pace-zones-vdot.md` | Long-arc fitness trajectory. |
| 9 | VDOT current + history | should | app-computed | `01-pace-zones-vdot.md` | Pace-prescription anchor. |
| 10 | Cardiac drift over long runs (HR rise at constant pace) | should | app-computed | `00a-distance-running-training.md` | Aerobic-base diagnostic. |
| 11 | Decoupling % (Pa:Hr or HR:pace ratio at sub-LT) | nice | app-computed | `01-pace-zones-vdot.md` | <5% = aerobic durability good. |
| 12 | Recovery time post-key-workouts (hours to baseline HRV) | should | app-computed | `00b-recovery-protocols.md` §Post-Race | Per-user empirical recovery curve. |
| 13 | Training load trend (CTL / ATL / TSB chart, 90-day default) | must | app-computed | `15-wearable-data.md` | PMC view; power-user staple. |
| 14 | Weekly mileage trend (4 / 12 / 52 weeks) | should | HealthKit / Strava | `00a-distance-running-training.md` | Volume is the dominant training input. |
| 15 | Intensity distribution (E/M/T/I/R minutes weekly) | should | app-computed | `01-pace-zones-vdot.md`, `00a-distance-running-training.md` | Polarized vs. pyramidal pattern. |
| 16 | Training stress score weekly | nice | app-computed | `15-wearable-data.md` | TRIMP or rTSS, single source. |
| 17 | Lactate threshold heart rate trend | nice | app-computed | `03-heart-rate-zones.md` | Aerobic adaptation marker. |
| 18 | Aerobic decoupling per long run | nice | app-computed | `01-pace-zones-vdot.md` | Aerobic-base build progress. |
| 19 | Stride length / cadence trends | nice | wearable / app-computed | `16-form-biomechanics.md` | Form drift signal. |
| 20 | Ground contact time / vertical oscillation / VR trends | later | wearable | `15-wearable-data.md` §Form metrics, `16-form-biomechanics.md` | Form metrics; high-noise; trend only. |
| 21 | Critical Power / Stryd-derived trends | later | Stryd | `15-wearable-data.md` | Power-on-foot power users. |
| 22 | Source attribution per metric | must | integrations | `15-wearable-data.md`, D1 | Multi-source resolution transparency. |
| 23 | Multi-source disagreement banner | should | app-computed | D1 §5, `15-wearable-data.md` | When Oura HRV and Apple Watch HRV differ >15%. |
| 24 | "What changed?" annotation layer (training load spike, new shoe, illness, travel) | should | app-computed + user-input | — | Charts without context are noise. |
| 25 | Coach's biometric read (weekly narrative) | should | coach-LLM | `15-wearable-data.md` | "HRV trended down 8% across this build block — at the lower edge of normal." |
| 26 | Confidence badges per metric (HIGH / MEDIUM / LOW) | should | app-computed | `15-wearable-data.md`, D1 | Source × valid-night count. |
| 27 | Export per metric (CSV) | nice | app-computed | — | Users want their data. |

### Biometric Trends section

The page is built around three groups of charts: **autonomic** (HRV, RHR), **fitness** (VO2max, VDOT, lactate threshold HR, decoupling), **load** (CTL/ATL/TSB, weekly mileage, intensity distribution). The user toggles 30 / 60 / 90 / 365-day windows. Each chart carries the source badge and a confidence indicator.

**HRV** is the lead chart. LnRMSSD on the y-axis (raw RMSSD is right-skewed; log smooths it). The 60-day baseline is rendered as a ribbon (mean ± SD); the SWC is a dashed line. The 7-day rolling mean is the bold trace; daily values are hollow dots so the user sees both the noise and the trend. Coefficient of variation of the 7-day rolling mean is exposed in a sidebar — rising CV with stable mean is the early-overreach signature `research/15-wearable-data.md` flags.

**RHR** uses nocturnal lowest 30-min as the canonical metric. Chart shows daily values, 14-day rolling, and a 60-day reference line. Confound annotations (illness, alcohol, travel, altitude — auto-tagged when known, user-tagged otherwise) ride on the chart so the +6 bpm spike on March 14 is labeled "after evening drinks" instead of looking like overtraining.

**VO2max estimate** comes from HealthKit, Garmin, or Coros where available; the app derives one from recent race performances when not. VDOT (`01-pace-zones-vdot.md`) is the running-specific equivalent and gets equal billing. The trend over 90+ days is the durable fitness story.

**Cardiac drift** is computed per long run as the HR rise at constant pace across the second vs. first half. <5% drift over the long run is the aerobic-durability signal. Decoupling % (Pa:Hr) is the more rigorous version for power users.

**Recovery time post-key-workouts** is a per-user empirical curve: hours from session end to HRV returning to within SWC of baseline. After 6+ months of data, the user has their own recovery half-life for tempo, intervals, long runs. This is the data behind a coach line like "your VO2 sessions take 36h on average to clear; it's been 24h."

**Training load trend** is the PMC chart: CTL / ATL / TSB over 90 days. ACWR sits on top as a ratio gauge.

**Source attribution** is non-negotiable. Every metric shows where it came from. When two sources disagree by >15% (Oura vs. Apple Watch HRV is the canonical case, D1 §8), a banner appears with the multi-source rule (highest fidelity wins; user override available).

---

## Web: Lab Results & Bloodwork

### Job-to-be-done

"Track the labs that actually matter for endurance athletes, with athlete-specific reference ranges and retest cadence." InsideTracker, Lab Insights, and manual entry are the data sources. Athlete reference ranges differ from general-population ranges for ferritin, vitamin D, and a handful of others — surfacing those differences is half the value.

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Ferritin (with athlete-specific thresholds) | must | InsideTracker / lab / manual | `13-sex-specific-training.md` §8.2 | Up to 30–60% of female endurance athletes deficient at some point. |
| 2 | Hemoglobin / hematocrit | must | lab / manual | `13-sex-specific-training.md` | Anemia rule-out. |
| 3 | MCV (mean corpuscular volume) | should | lab / manual | `13-sex-specific-training.md` | Distinguishes iron-deficiency vs. B12/folate. |
| 4 | Transferrin saturation / sTfR | should | lab / manual | `13-sex-specific-training.md` §8.2 | Stage of iron deficiency. |
| 5 | CRP (C-reactive protein) | must | lab / manual | `13-sex-specific-training.md` §8.2, `14-age-considerations.md` | Acute-phase reactant; ferritin must be interpreted with CRP. |
| 6 | Vitamin D (25-OH) | must | lab / manual | `13-sex-specific-training.md` §9.3, `14-age-considerations.md` | Target 30–50 ng/mL; supplement guidance. |
| 7 | Vitamin B12 | should | lab / manual | `13-sex-specific-training.md`, `14-age-considerations.md` | Vegan/vegetarian runners; MCV-confirming. |
| 8 | Folate | should | lab / manual | `13-sex-specific-training.md` | Pairs with B12. |
| 9 | Total / free testosterone (male) | should | lab / manual | `13-sex-specific-training.md` §11.1 | EHMC screening; normal ~300–1000 ng/dL. |
| 10 | Estradiol / progesterone (female) | should | lab / manual | `13-sex-specific-training.md` §1.1, §6 | Amenorrhea workup; RED-S indicator. |
| 11 | LH / FSH | nice | lab / manual | `13-sex-specific-training.md` §6 | Pituitary axis; RED-S workup. |
| 12 | Thyroid (TSH, free T4, free T3) | should | lab / manual | `13-sex-specific-training.md` §6, `14-age-considerations.md` | Athlete fatigue + RHR rule-outs. |
| 13 | Lipid panel (TC, LDL, HDL, TG, ApoB) | should | lab / manual | `14-age-considerations.md` | Masters athletes especially. |
| 14 | Cortisol (morning serum or salivary) | nice | lab / manual | `13-sex-specific-training.md` §11.3, `00b-recovery-protocols.md` | Overtraining marker; T:C ratio. |
| 15 | Creatine kinase (CK) | nice | lab / manual | `00b-recovery-protocols.md` | Muscle-damage; race-recovery context. |
| 16 | Magnesium / RBC magnesium | nice | lab / manual | — | Cramping correlate (weak evidence; common test). |
| 17 | HbA1c / fasting glucose | nice | lab / manual | `14-age-considerations.md` | Metabolic-health context. |
| 18 | Glomerular filtration rate / creatinine | nice | lab / manual | `14-age-considerations.md` | Masters athletes; NSAID context. |
| 19 | DEXA (BMD Z-score; body composition) | should | lab / manual | `13-sex-specific-training.md` §9.2 | Athlete Z ≤ −1.0 = low BMD. |
| 20 | Trend per marker (chart over time) | must | app-computed | — | Single value is interesting; trend is actionable. |
| 21 | Athlete reference ranges (vs. general population) | must | static | `13-sex-specific-training.md`, `14-age-considerations.md` | Ferritin >35–50, vit D 30–50 ng/mL, etc. |
| 22 | Threshold flags (out-of-athlete-range) | must | app-computed | `13-sex-specific-training.md` | Quiet flag with one-line interpretation. |
| 23 | Retest reminder schedule (per marker) | must | app-computed | `13-sex-specific-training.md` §8.3 | Iron: 8–12 weeks post-treatment; vit D: 6 months; etc. |
| 24 | Lab-result entry (manual or photo OCR) | must | user-input | — | Most users still upload PDFs. |
| 25 | InsideTracker / Quest / LabCorp integration | should | integrations | — | Auto-import where supported. |
| 26 | Coach's read on results (3–5 sentence narrative per panel) | should | coach-LLM | `13-sex-specific-training.md` | "Ferritin 28 with normal CRP. Below the athlete threshold; recheck in 8 weeks." |
| 27 | Treatment / supplement protocol templates (informational, not prescriptive) | should | static | `13-sex-specific-training.md` §8.3 | Iron: 60–200 mg elemental, alternate days, vit C, no calcium within 1h. |
| 28 | Refer-to-clinician banner (always-on; never replaces care) | must | static | `13-sex-specific-training.md` | "These ranges are educational; care decisions belong with your clinician." |
| 29 | Lab-set bundle templates (Endurance Basic, Female Endurance, Masters Male, RED-S workup) | should | static | `13-sex-specific-training.md`, `14-age-considerations.md` | Ordering templates for the user to take to their physician. |
| 30 | Privacy: hide hormonal and ED-adjacent panels | should | user-setting | `13-sex-specific-training.md` §13 | Sensitive surfaces; opt-in visibility. |
| 31 | Export (CSV / PDF) | should | app-computed | — | User portability for clinician visits. |

### Lab Results & Bloodwork section

The page leads with **the runner-relevant five**: ferritin, vitamin D, hemoglobin, B12, and (sex-specific) testosterone or estradiol. Each is shown with its current value, athlete reference range, and a trend chart over time. Out-of-range values get a quiet flag; the page does not alarm.

**Athlete reference ranges** are the page's distinguishing value:

- **Ferritin**: >50 ng/mL replete; 30–50 iron-deficient non-anemic Stage I; 20–30 Stage II; <20 with symptoms or <12 anemia possible (`13-sex-specific-training.md` §8.2). Some sport scientists argue performance is impaired below ~35–40 ng/mL even without anemia (Pasricha 2014; Burden 2015 meta-analysis).
- **Vitamin D**: target 25-OH 30–50 ng/mL (75–125 nmol/L); supplement 1000–2000 IU/day if low (`13-sex-specific-training.md` §9.3).
- **CRP**: ferritin must be interpreted alongside CRP; ferritin is an acute-phase reactant.
- **Testosterone (male)**: ~300–1000 ng/dL healthy reference. EHMC (exercise-hypogonadal male condition) screening when low T + low LH + LEA pattern (`13-sex-specific-training.md` §11.1).
- **DEXA Z-score**: in weight-bearing athletes Z ≤ −1.0 is "low BMD for athlete" — athletes should be *above* general-population norms because of mechanical loading (`13-sex-specific-training.md` §9.2).

**Threshold flags** fire on values out of athlete range; each carries a one-line interpretation and a retest cadence. Iron treatment guidance — 60–200 mg elemental, alternate-day dosing, with vitamin C, avoiding coffee/tea/calcium/dairy within 1 hour, recheck at 8–12 weeks — is shown as informational text, not a prescription.

**Retest reminders** are scheduled per marker:
- Ferritin: 8–12 weeks after starting supplementation; otherwise annual.
- Vitamin D: 6 months after a low result; otherwise every 1–2 years.
- Hormonal panel: annual, or when symptoms warrant.
- Lipid panel: annual or per cardiologist guidance for masters.
- Thyroid: as clinically indicated.

**Lab-set bundle templates** (Endurance Basic, Female Endurance, Masters Male, RED-S workup) are downloadable lists the user takes to their physician — explicit, marker-by-marker, with athlete-relevant rationale.

**Coach's read** is conservative. It interprets the panel against athlete ranges, flags retest cadence, and routes care to a clinician when out-of-range or symptomatic. The coach never prescribes treatment.

### Privacy considerations

- All lab results are local + opt-in cloud sync. No third-party sharing by default.
- Hormonal and ED-adjacent panels (estradiol, progesterone, LH/FSH, cortisol) can be hidden from the page entirely via a toggle.
- Refer-to-clinician banner is always on. The page is educational, not diagnostic.
- Export to CSV / PDF is one-click for clinician visits.

---

## Web: Recovery Modalities Log

### Job-to-be-done

"Log what I'm doing for recovery and see whether it correlates with how I feel and perform." Sauna, cold plunge / contrast, massage, compression, IV / vitashots, mobility, yoga. Most modalities have weak-to-moderate evidence (`00b-recovery-protocols.md` §Recovery Modalities); the page is honest about what's likely placebo and what isn't, while still respecting the user's choices.

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Quick-log strip (one-tap modality) | must | user-input | `00b-recovery-protocols.md` | Friction kills logging compliance. |
| 2 | Sauna log (date, duration min, temperature °C) | should | user-input | `00b-recovery-protocols.md` §Recovery Modalities | 15–30 min, 3–4×/wk: ~2% endurance gain over 3 weeks. |
| 3 | Cold plunge / cold-water immersion log (date, duration, temperature) | should | user-input | `00b-recovery-protocols.md` | 10–15°C, 11–15 min reduces soreness; blunts strength adaptation if used after lifting. |
| 4 | Contrast water therapy log | nice | user-input | `00b-recovery-protocols.md` | Small benefit; not clearly superior. |
| 5 | Massage log (date, duration, type — manual / percussive) | should | user-input | `00b-recovery-protocols.md` | Most effective single modality for DOMS; effect peaks ~48h. |
| 6 | Compression boots log (date, duration, pressure setting) | nice | user-input | `00b-recovery-protocols.md` | Subjective improvement; small or null on objective biomarkers. |
| 7 | Compression garment wear log | nice | user-input | `00b-recovery-protocols.md` | Small-to-moderate effect on perceived soreness. |
| 8 | IV / vitashot log (date, contents, route) | nice | user-input | `00b-recovery-protocols.md` | No clear evidence of benefit; WADA prohibits >100mL/12h in-competition. |
| 9 | Foam rolling / self-myofascial log | nice | user-input | `00b-recovery-protocols.md` | Small effect size; ROM benefit. |
| 10 | Mobility session log (date, duration, focus area) | should | user-input | `10-mobility-warmup.md` | Routine; ties to warmup library. |
| 11 | Yoga log (date, duration, style) | should | user-input | `09-cross-training.md` | Stress + mobility cross-listed. |
| 12 | Stretching log | nice | user-input | `10-mobility-warmup.md` | Static / dynamic. |
| 13 | Frequency calendar (last 30 days) | should | app-computed | — | Adherence at a glance. |
| 14 | Modality count chip (sauna sessions / month, etc.) | nice | app-computed | — | "5 sauna sessions in the last 4 weeks." |
| 15 | Cumulative duration per modality | nice | app-computed | — | Heat-acclimation dose, etc. |
| 16 | Correlation: modality usage ↔ next-day recovery score | should | app-computed | D1, `00b-recovery-protocols.md` | The user's own data, not population claims. |
| 17 | Correlation: modality ↔ subjective feel | should | app-computed | `00b-recovery-protocols.md` | The honest "does this work for you?" view. |
| 18 | Evidence-tier badge per modality (A / B / C / D) | should | static | `00b-recovery-protocols.md` §Recovery Modalities | Calibrates expectations; not preachy. |
| 19 | Cold-after-strength caution flag | should | app-computed + static | `00b-recovery-protocols.md` | Cold plunge after strength blunts hypertrophy adaptation. |
| 20 | NSAIDs log (date, dose) | should | user-input | `00b-recovery-protocols.md` | Routine NSAID use as recovery aid is contraindicated; honest framing. |
| 21 | Sleep aid / melatonin log | nice | user-input | — | Travel context. |
| 22 | Sauna heat-acclimation streak | nice | app-computed | `00b-recovery-protocols.md` | Plasma volume adaptation over 3 weeks. |
| 23 | Pre-race modality plan (taper week protocol) | nice | app-computed | `00b-recovery-protocols.md` | Massage, sauna, no new modalities. |
| 24 | Coach's read on modality usage | nice | coach-LLM | `00b-recovery-protocols.md` | "Sauna 3×/wk for 4 weeks — heat-acclimation dose is dialed." |

### Recovery Modalities Log section

The log is **calendar + chips**. Quick-log chips at the top: Sauna · Cold · Massage · Compression · Mobility · Yoga · IV · Other. One tap captures today; long-press prompts duration and conditions. The 30-day calendar shows session dots colored by modality.

**Sauna** captures duration (min) and temperature (°C). The 15–30 min, 3–4×/wk protocol drives a heat-acclimation streak counter — `00b-recovery-protocols.md` cites ~2% endurance performance gain over 3 weeks plus plasma-volume expansion. The page treats sauna as a performance-adaptation tool primarily; recovery effect is modest.

**Cold plunge / contrast** captures duration and temperature. The page surfaces the cold-after-strength caution: cold immersion within 4–6 hours of resistance training blunts hypertrophy adaptation. Endurance-only context: 10–15°C for 11–15 min reduces soreness post-endurance.

**Massage** is the strongest single modality for DOMS (B-tier in KB doc 00b); peak effect ~48h post-effort. Captures duration and type (manual / percussive).

**Compression boots** captures duration and pressure setting. KB doc 00b is honest: subjective improvement; small or null on objective biomarkers. The page logs it without overclaiming.

**IV / vitashots** are logged with contents and route. Evidence is D-tier: no clear benefit over oral hydration; WADA prohibits IV >100 mL/12h in-competition regardless of contents (`00b-recovery-protocols.md`). Page surfaces these caveats next to the entry, calmly.

**Mobility / yoga** logs are routine; ties to the warmup library in Training (`10-mobility-warmup.md`).

**Correlation surfaces** are the page's value-add: modality usage on day N ↔ recovery score on day N+1; modality usage ↔ subjective soreness on day N+1. Per-user data, displayed as scatter with r-values labeled "your correlation." The page makes no population claims about whether sauna "works" — it shows whether sauna correlates with the user's own next-day metrics.

**Evidence-tier badges** (A / B / C / D from `00b-recovery-protocols.md`) sit next to each modality. Calibrates expectations honestly without telling users to stop doing things they enjoy.

---

## Sex-specific (cross-ref KB doc 13)

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Cycle tracking opt-in (off by default) | must | user-input | `13-sex-specific-training.md` §1.3 | Sensitive; explicit opt-in. |
| 2 | Period start date log | must | user-input / HealthKit | `13-sex-specific-training.md` §1.3 | Anchor for phase calculation. |
| 3 | Cycle length (auto-derived; user-overridable) | should | app-computed / user-input | `13-sex-specific-training.md` §1.1 | Normal range 21–35 days. |
| 4 | Current phase chip (early follicular / mid-late follicular / ovulatory / early luteal / late luteal) | should | app-computed | `13-sex-specific-training.md` §1.1 | Tag, not prescription. |
| 5 | BBT log (optional) | nice | user-input | `13-sex-specific-training.md` §1.3 | Confirms ovulation post-hoc. |
| 6 | LH strip log (optional) | nice | user-input | `13-sex-specific-training.md` §1.3 | Predicts ovulation 24–36h ahead. |
| 7 | Symptoms log (cramping, heavy bleeding, mood, fatigue, GI, headache) | must | user-input | `13-sex-specific-training.md` §1.5 | Symptom-driven > phase-driven. |
| 8 | RPE / energy ratings tagged by phase | should | user-input | `13-sex-specific-training.md` §1.4 | N=1 hypothesis testing. |
| 9 | Heat-tolerance flag in luteal phase | should | app-computed | `13-sex-specific-training.md` §1.2 | +0.3–0.5°C core temp; uncompensable heat hits harder. |
| 10 | Submaximal HR offset note (luteal +3–5 bpm) | nice | static | `13-sex-specific-training.md` §1.4 | Don't over-read elevated HR in luteal. |
| 11 | Hormonal contraception flag (COC / POP / IUD) | should | user-input | `13-sex-specific-training.md` §2 | Phase tracking is meaningless on COC. |
| 12 | Heavy menstrual bleeding flag (refer for ferritin + heme) | must | user-input | `13-sex-specific-training.md` §1.5 | HMB is a clinical signal. |
| 13 | Amenorrhea flag (>3 months) | must | user-input | `13-sex-specific-training.md` §6.6 | RED-S red flag. |
| 14 | LEAF-Q questionnaire (annual) | should | user-input | `13-sex-specific-training.md` §6.5 | Validated screen. |
| 15 | Pregnancy mode toggle | should | user-input | `13-sex-specific-training.md` | Different programming, beyond v1 scope likely. |
| 16 | Postpartum return-to-run protocol | later | user-input + static | `13-sex-specific-training.md` | Specialized; out-of-scope for v1 likely. |
| 17 | Perimenopause / menopause tag | later | user-input | `13-sex-specific-training.md`, `14-age-considerations.md` | Different physiology; downstream feature. |
| 18 | Privacy: hide cycle from Overview | must | user-setting | `13-sex-specific-training.md` | User controls visibility on shared screens. |
| 19 | Privacy: hide phase chip from coach narrative | should | user-setting | `13-sex-specific-training.md` | Some users want logging without coach references. |

The page is **honest about evidence**: McNulty 2020 (78-study synthesis) is explicit that exercise performance might be trivially reduced in early follicular vs. other phases (SMD 0.06–0.15 — below within-day noise), with low quality of evidence and high heterogeneity. The authors recommend *against* generic phase-based prescription. The decision rule from `13-sex-specific-training.md` §1.4 is the page's stance:

```
if symptoms reduce training quality on a given day:
    adjust THAT day (lower intensity, swap session, reduce volume)
else:
    train the planned program; do not preemptively de-load by phase
```

Phase-based periodization is presented as an N=1 hypothesis the user can test, not a coach prescription. Symptom-driven adjustments are first-class. Heavy menstrual bleeding (HMB) and amenorrhea > 3 months are red flags routed to the bloodwork / clinician path.

---

## iOS: Health (mobile-condensed)

### Job-to-be-done

"How's my body today?" — a 2-second glance answer plus capture surface for subjective check-in, pain, hydration, fueling logs. The mobile Health tab is condensed and capture-first; deep analysis lives on web.

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Recovery score hero (ring + word-band) | must | app-computed (D1) | D1 | Single glance answer. |
| 2 | Top contributing factor one-liner | must | coach-templated | D1 | The WHY. |
| 3 | Contributor chips strip (HRV / RHR / Sleep / Load / Subjective) | must | app-computed | D1 | Tap-to-expand. |
| 4 | Subjective check-in card (auto-prompt first morning open) | must | user-input | D1, `00b-recovery-protocols.md` | Compliance is the open question; auto-prompt drives it. |
| 5 | Sleep last night tile (duration + need) | must | HealthKit / wearable | `00b-recovery-protocols.md` | High-value glance. |
| 6 | HRV today vs. baseline sparkline | should | wearable | `15-wearable-data.md` | Trend signal. |
| 7 | RHR sparkline | should | wearable | `15-wearable-data.md` | Companion. |
| 8 | Hydration today (ml + quick-add chips) | should | user-input / HealthKit | `19-hydration-electrolytes.md` | One-tap +250 / +500. |
| 9 | Hydration target (heat-aware) | should | app-computed + weather | `19-hydration-electrolytes.md`, `06-weather-adjustments.md` | Heat-day shift visible. |
| 10 | Pain / soreness body-map quick capture | should | user-input | `05-injury-return-protocols.md` | Tap-to-locate sheet. |
| 11 | Active injury banner with stage | must | user-input + coach | `05-injury-return-protocols.md` | Top of tab when injured. |
| 12 | Cycle phase tile (opt-in) | should | user-input / HealthKit | `13-sex-specific-training.md` | Phase tag, never prescription. |
| 13 | Period start log (one-tap) | should | user-input | `13-sex-specific-training.md` | Capture friction critical here. |
| 14 | Symptom-quick-log chips (cramps / fatigue / GI / mood) | nice | user-input | `13-sex-specific-training.md` §1.5 | Symptom-driven adjustments. |
| 15 | Daily fuel-plan tile (long/quality session days) | should | app-computed | `18-fueling-products.md` | Pre-run trigger. |
| 16 | Post-run protein-window prompt | should | app-computed | `00b-recovery-protocols.md` | 0–30 min after long/quality. |
| 17 | Weight log entry (opt-in, sensitive UI) | nice | HealthKit / user-input | `13-sex-specific-training.md` | Privacy-aware. |
| 18 | Bloodwork callouts (recent flags only) | nice | user-input | `13-sex-specific-training.md` | "Ferritin 28 — recheck due in 3 weeks." |
| 19 | Recovery-modality quick-log strip (sauna / cold / massage / mobility) | nice | user-input | `00b-recovery-protocols.md` | One-thumb capture. |
| 20 | Risk alert banner (illness / overtraining / RHR drift) | must | app-computed | `00b-recovery-protocols.md`, D1 | Prominent. |
| 21 | "Mark sick" toggle | should | user-input | `00b-recovery-protocols.md` | Suppresses ACWR alerts. |
| 22 | Sleep-extension banner (heavy weeks / race week) | should | app-computed | `00b-recovery-protocols.md` | +1h target prompt. |
| 23 | Caffeine cutoff reminder (push, opt-in) | nice | app-computed | `00b-recovery-protocols.md` | Half-life-aware. |
| 24 | Sync status per source | should | integrations | — | Trust the data. |
| 25 | Pull-to-refresh sync | must | app-computed | — | Standard mobile pattern. |
| 26 | Deep-link to web for full charts | should | app-computed | — | "Open detail on web" affordance. |
| 27 | Push: morning check-in nudge (configurable) | should | app-computed | — | Drives subjective compliance. |
| 28 | Push: bedtime nudge (race week / heavy load) | nice | app-computed | `00b-recovery-protocols.md` | Sleep-banking context. |
| 29 | Widget: recovery score (small / medium) | should | app-computed | — | Lock-screen glance. |
| 30 | Widget: hydration progress (medium) | nice | app-computed | `19-hydration-electrolytes.md` | One-tap from home. |
| 31 | Live Activity: race-week sleep / hydration tracking | nice | app-computed | — | Glanceable during race week. |
| 32 | Siri shortcut: "Log subjective" / "Log hydration" | nice | app-computed | — | Hands-free capture. |
| 33 | Privacy: hide weight toggle | must | user-setting | `13-sex-specific-training.md` | Mirrors web. |
| 34 | Privacy: hide cycle from lock-screen widget | must | user-setting | `13-sex-specific-training.md` | Sensitive surface. |
| 35 | Notes one-tap capture per day | nice | user-input | — | "Slept poorly; long meeting." |

The mobile Health tab is **glanceable + capture-first**. The hero is the recovery ring with word-band; below it are the one-liner WHY and the contributor chips. Below those, the capture-first surfaces: subjective check-in (auto-prompt on first-morning open), pain quick-log (body map sheet), hydration chips, period log, modality strip. Drill-down into HRV / RHR / Sleep / Bloodwork / Modalities / Body Comp opens dedicated screens, but the deep analytics are deferred to web ("Open detail on web" affordance).

The mobile tab respects the same privacy rules as web: opt-in body comp, opt-in cycle, hidden-from-Overview toggles. Push cadence defaults to morning subjective nudge + bedtime nudge during heavy weeks; everything else opt-in.

---

## Quick competitor scan

- **Whoop**: Recovery 0–100% with traffic-light bands (red 1–33 / yellow 34–66 / green 67–100); HRV ~60% of recovery; 30-day rolling baseline; sleep need model; journal entries (caffeine, alcohol, illness) influence commentary but not score. Worth borrowing: traffic-light bands; sleep-need framing; journal as confounders. Avoid: hidden weights; aggressive recovery streaks pressure.
- **Oura**: Readiness 0–100 with seven contributor cards (Optimal / Pay attention / Needs attention); 14-day medium / 60-day long-term baselines; cycle integration; body-temp deviation; recovery index (HR drop in early sleep). Worth borrowing: contributor card pattern; baseline ribbon; honest "Pay attention" copy. Avoid: opaque weights; over-claim on stage detail.
- **Garmin Health Stats / Body Battery / Training Readiness**: Body Battery 5–100 continuous (Firstbeat black box); Training Readiness 0–100 with five-band traffic light; HRV Status (3-week baseline); sleep score; recovery time hours. Worth borrowing: training-readiness state label as a phase chip; race predictor by distance. Avoid: black-box scoring; over-multiplication of recovery time.
- **Apple Health / Vitals**: Per-metric Typical/Outlier framing; no composite score on the explicit thesis that consumer composites over-claim. Worth borrowing: honest per-metric framing during baseline establishment; "Typical / Outlier" as a fallback when a composite isn't trustworthy. Avoid: zero composite (the user's job-to-be-done needs one).
- **InsideTracker**: Lab-result interpretation with athlete-specific reference ranges; supplement and food recommendations; integration with consumer-paid lab kits. Worth borrowing: athlete-vs-population reference ranges; retest cadence reminders. Avoid: heavy supplement-marketing tilt; over-prescriptive food recommendations.
- **Levels**: Continuous glucose monitoring with food-correlation analytics. Worth borrowing: pattern-detection UX, "your data, your correlations." Avoid: CGM-for-everyone marketing; weak evidence base for non-diabetic athletes.
- **Athlytic**: Apple-Watch-native Whoop-style recovery + strain composite; sleep need vs. got; 60-day baseline. Worth borrowing: native Apple-Watch recovery without requiring a separate band; "sleep need vs. got" framing.

---

## Open questions

1. **Composite recovery score's UX during taper and race week.** ATL drops legitimately and HRV often rises — score will spike toward 95+ and stay there. Race-week mode that compresses score range or surfaces "Sharpening — 92, expected" preferable? See D1 §8.3.
2. **Subjective-input compliance.** Daily 4-item check-in achievable with >60% compliance, or opportunistic prompts only on outlier days? Test both arms.
3. **Multi-source reconciliation visibility.** When Oura HRV and Apple Watch HRV disagree by >15% on the same night, surface both, hide the lower-fidelity, or average? D1 §8.2 unresolved.
4. **Body Comp default visibility.** Off by default with explicit opt-in vs. on-but-hidden weight number with trends visible? Trade-off: friction vs. surfacing.
5. **Cycle-tile depth.** Pure tagging (chip), explicit phase-adjusted score baseline, or LLM narrative ("luteal phase, expect HRV ~7% below your follicular norm")? Need user testing with female users specifically.
6. **Bloodwork entry friction.** Photo-OCR of lab PDFs vs. manual entry vs. integration partnerships (InsideTracker, LabCorp). Hybrid likely; integration costs are real.
7. **Recovery-modality scoring.** Show "your data" correlations with caveats vs. avoid implying causation altogether? Per-user r-values are noisy at <60 days.
8. **Injury body-map taxonomy.** How granular? 30 regions, 60 regions, anatomical structures? Granularity vs. tap accuracy trade-off.
9. **Pain-trend visibility on Overview.** Should an active soreness pattern (NRS ≥4 for ≥3 days) surface on Overview as a banner, or only on Health page? Bias: surface the alert, not the data.
10. **Adolescent / under-18 account guardrails.** Body comp hidden, fueling page calorie-masked, BD prompts removed entirely? Need policy decision.
11. **Sleep-stage display fidelity.** Show wearable-reported stages with "low confidence" tooltip vs. omit entirely vs. trend-only. Trend-only honest, omit risks user confusion.
12. **Modality evidence tier visibility.** Tooltip vs. badge vs. one-line explainer. How prominent is honest about weak evidence without being preachy?
13. **Postpartum / pregnancy mode.** v1 scope vs. v2. The protocols differ enough that half-supporting them is worse than not.
14. **HealthKit write-back.** Subjective ratings, hydration, modality logs — write back to HealthKit so other apps see them, or local-only? Privacy choice.
15. **Coach narrative cadence.** Recovery dashboard is daily; biometric trends weekly; bloodwork per-result. What's right for body composition and modalities? Bias: weekly digest, not per-event.

---

## Data model implications

Backend entities/fields needed (delta on top of what's defined in `APP_FEATURE_SPEC.md` and `D1-recovery-score-methodology.md`):

**HealthMetric** (canonical per-metric daily/per-event point):
- id, user_id, metric_type (HRV_RMSSD, RHR_NOCTURNAL, SLEEP_TST, SLEEP_EFFICIENCY, SLEEP_LATENCY, WASO, WRIST_TEMP, RESP_RATE, SPO2, BODY_WEIGHT, BODY_FAT, LEAN_MASS, HYDRATION_PCT, BONE_MASS, VISCERAL_FAT, VO2MAX, HR_LACTATE_THRESHOLD)
- value, unit, source (APPLE_HEALTH, OURA, WHOOP, GARMIN, COROS, POLAR, STRYD, MFP, CRONOMETER, INSIDETRACKER, MANUAL)
- source_fidelity (0–100; pre-computed from source × metric)
- captured_at (UTC + offset), measurement_window (NOCTURNAL / MORNING_SPOT / INSTANT)
- confidence (HIGH / MEDIUM / LOW)
- raw_payload (jsonb; vendor-specific)

**ReadinessScore** (per D1 §7): id, user_id, score_date, display_score, raw_score, band, contributors (jsonb per-input z/weight/value/baseline), load_modifier, temp_modifier, subjective_present, algorithm_version, computed_at, baseline_state.

**Injury**: id, user_id, location (anatomical region + side + structure), severity (MILD / MODERATE / SEVERE), pain_type (SHARP / DULL / ACHE / STIFFNESS / BURNING), bilateral, when_it_hurts, started_at, last_updated, status (ACTIVE / MONITORING / RESOLVED / RECURRENCE_OF), rtr_stage (1–8), rtr_history (jsonb per-stage entries), red_flag_triggered, modified_plan_ref, related_notes (text), pt_visits (sub-table), imaging (sub-table; text-only).

**BodyMapPoint** (per soreness/pain log): id, user_id, body_region, side, x_y_on_diagram, nrs_0_10, pain_type, when_it_hurts, captured_at, related_injury_id (nullable; soreness ≠ injury until escalated).

**NutritionLog**: id, user_id, log_date, source (MFP / CRONOMETER / MACROFACTOR / MANUAL), kcal, carbs_g, protein_g, fat_g, hydration_ml, sodium_mg, caffeine_mg, last_caffeine_at, raw_payload.

**SupplementEntry**: id, user_id, supplement_type (IRON / VITD / B12 / OMEGA3 / MAGNESIUM / CREATINE / OTHER), dose_amount, dose_unit, taken_at.

**FuelingLog** (per-workout, ties to Activity): id, user_id, activity_id, planned_g_per_hr, actual_g_per_hr, products (sub-table), gut_training_flag, notes.

**RaceCarbLoadLog**: id, user_id, race_id, log_date, target_g_per_kg, actual_g_per_kg, days_pre_race.

**BloodworkResult**: id, user_id, panel_date, marker_type (FERRITIN / HEMOGLOBIN / HCT / MCV / TSAT / STFR / CRP / VIT_D / B12 / FOLATE / TESTOSTERONE_TOTAL / TESTOSTERONE_FREE / ESTRADIOL / PROGESTERONE / LH / FSH / TSH / FT4 / FT3 / TC / LDL / HDL / TG / APOB / CORTISOL / CK / MAGNESIUM / HBA1C / GLUCOSE / GFR / CREATININE / DEXA_BMD_ZSCORE), value, unit, athlete_range_low, athlete_range_high, lab_reference_low, lab_reference_high, flagged, retest_due_at, source (lab / clinician / manual), notes.

**RecoveryModalityLog**: id, user_id, log_date, modality (SAUNA / COLD_PLUNGE / CONTRAST / MASSAGE_MANUAL / MASSAGE_PERCUSSIVE / COMPRESSION_BOOTS / COMPRESSION_GARMENT / IV / FOAM_ROLL / MOBILITY / YOGA / STRETCH / NSAID / SLEEP_AID), duration_min, temperature_c (where relevant), pressure_setting (where relevant), contents (IV; text), notes.

**CycleLog** (opt-in): id, user_id, log_date, log_type (PERIOD_START / PERIOD_END / SYMPTOM / BBT / LH / HC_FLAG), phase_at_log, symptom_tags (array), bbt_value, lh_strip_result, hc_type, freeform_notes.

**SubjectiveLog**: id, user_id, log_date, energy (1–5), soreness (1–5; reverse-scored), mood (1–5), motivation (1–5), sleep_quality (1–5), sick_flag, traveled_flag, alcohol_flag, freeform_notes.

**Baseline** (per D1 §7): id, user_id, metric_type, window_days, mean, sd, sample_count, computed_at, is_seasonal.

**InsightAlert**: id, user_id, alert_type (HRV_DROP / RHR_ELEVATION / TEMP_DEVIATION / OVERREACH_RISK / ILLNESS_WATCH / LEA_RISK / FERRITIN_LOW / VIT_D_LOW / RTR_STAGE_HOLD / ACWR_SPIKE), severity (INFO / WARNING / CRITICAL), triggered_at, cleared_at, context (jsonb).

**Critical relationships**:

- HealthMetric, SubjectiveLog, Baseline, FuelingLog, and Activity-derived training-load aggregate → ReadinessScore (derived; recomputable).
- BodyMapPoint → Injury (escalation when persistent or red-flag).
- Injury → modified Plan (RTR overrides today's prescribed workout).
- BloodworkResult → InsightAlert (out-of-athlete-range flags) and SupplementEntry guidance.
- RecoveryModalityLog correlates against ReadinessScore (per-user; not population claims).
- CycleLog is privacy-tagged; never aggregated; never inferred from other signals without explicit opt-in.
- FuelingLog ties to Activity (planned vs. actual) and to RaceCarbLoadLog (race week).

**Computation cadence**: ReadinessScore recomputes once per (user, date) on first morning sync, plus on input change. Bloodwork retest reminders fire on schedule. Body map and pain trends recompute per write. Correlations on the modality and sleep pages are recomputed daily as background jobs.

**Privacy categories** (drives delete/export and visibility toggles): SENSITIVE_BIOMETRIC (HRV, RHR), SENSITIVE_BODY (weight, body comp), SENSITIVE_HORMONAL (cycle, hormonal labs), SENSITIVE_INJURY (active injury status), STANDARD (everything else). Each category respects an independent visibility toggle and an independent delete operation.

---
