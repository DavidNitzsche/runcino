# Runcino — Comprehensive Inventory & Redesign Brief

**Date:** 2026-05-08
**Branch:** `claude/objective-black-8f3e69`
**Scope:** Every page, every doctrine file, every state field, every coach method. Then sections 8a–j: a full redesign brief that treats the runner-hub as backbone and proposes what each surface SHOULD be.
**Method:** Static read of every page in `web/app/`, every constant export under `web/coach/doctrine/`, every consumer import path through `web/lib/*`, `web/coach/*`, and `web/app/api/*`. The Research/ folder is the contract — every doctrine file is mapped back to its Research source.
**Caller:** Built on top of `docs/AUDIT-2026-05-08-final.md`. This document supersedes that one, expanding it with explicit redesign proposals (section 8) and tightening the structural review.

This document is intentionally long. The first seven sections inventory what exists. Section 8 — the largest by far — proposes what should exist when the canonical RunnerHub is the backbone of every surface. The user asked for "real design thinking, not just a list," and the document tries to deliver exactly that.

---

## Table of contents

1. Research doc coverage matrix — where each doctrine file is and isn't wired
2. UI surface inventory — every page, every section, every line-anchored tile
3. State + data flow — what `gatherCoachState()` reads, returns, and lies about
4. Coach methods inventory — interface vs implementation
5. Stat accuracy audit — which numbers are right, which are misleading, which are unverifiable
6. Gap analysis (info we HAVE but don't show)
7. Gap analysis (info we WANT but don't have)
8. PRODUCT REDESIGN — what each page SHOULD be
   - 8a. Overview / Hub page
   - 8b. Training page
   - 8c. Race detail page
   - 8d. Run detail page
   - 8e. Profile page
   - 8f. Health page
   - 8g. NEW pages worth adding
   - 8h. Cross-cutting redesign principles
   - 8i. The "professional running coach" question
   - 8j. Concrete page-by-page redesign sketches

Appendices: file reference index, doctrine wired/unwired quick reference, design-tokens crosswalk.

---

## 1. Research doc coverage matrix

The Research/ folder has **24 numbered .md files** (Research/23 is reserved/empty; Research/24 is the new VDOT age-sex-grading file added this session) plus 5 meta files (INDEX, GLOSSARY, SOURCES, RESEARCH_TASKS, REVIEW_NOTES).

The `web/coach/doctrine/` folder has **35 .ts files** (added `grading.ts` and the small `cite.ts` extracted in commit 78ef324 to fix a build TDZ). Mapping is roughly 1:1 by topic.

A doctrine file is **WIRED** when at least one of its constants is imported and consumed by `web/lib/*` engine code, `web/coach/coach.ts`, `web/coach/explanations.ts`, `web/app/api/*/route.ts`, or a UI tile. The consumer set has expanded considerably this session — `runner-profile.ts`, `app/page.tsx` (HrZonesTile, VdotTile, PhaseGuidanceCard), and `app/races/[slug]/page.tsx` (HydrationTile) now read doctrine directly.

| # | Research file | Doctrine file(s) | Status | What's covered | What's NOT yet wired |
|---|---|---|---|---|---|
| 00a | distance-running-training.md | concepts split across `intensity.ts`, `volume.ts`, `recovery.ts` | PARTIAL | `POLARIZED_DISTRIBUTION`, `PYRAMIDAL_DISTRIBUTION`, `THRESHOLD_DISTRIBUTION` (`intensity.ts`); `LONG_RUN`, `STRIDES`, `SLEEP` via `coach-principles.ts:174-181` | `PHASE_DISTRIBUTION_RECOMMENDATION`, `VOLUME_MODEL_THRESHOLDS`, `NORWEGIAN_DOUBLE_THRESHOLD` (`intensity.ts:69-136`) — defined, never imported |
| 00b | recovery-protocols.md | `recovery_protocols.ts` (22 exports) | PARTIAL | `INCOMPLETE_RECOVERY_DECISION_MATRIX` is now consumed indirectly by `coach.assessReadiness` (`coach.ts:471-480`) — engine collects volume/intensity/race-recovery signals + maps signal-count to action ("continue / 24-48h defer / 3-5d cutback / full cutback / stop"). Citation surfaces in the readiness card. | `POST_RACE_BY_DISTANCE`, `MARATHON_BIOMARKER_TIMELINE`, `REVERSE_TAPER_PROTOCOL`, `MARATHON_RECOVERY_4WK_REVERSE_TAPER`, `MULTI_RACE_CADENCE`, `CARBON_PLATE_RECOVERY_EFFECTS`, `INCOMPLETE_RECOVERY_QUALITATIVE_SIGNALS`, `RECOVERY_TIMESCALES`, `HARD_EASY_ALTERNATION_RULES`, `RECOVERY_VS_EASY_RUN`, `SLEEP_TIERS`, `SLEEP_EXTENSION_PROTOCOL`, `POST_SESSION_NUTRITION_WINDOWS`, `RECOVERY_MODALITY_TIERS`, `CUTBACK_*`, `RACE_PRIORITY_RECOVERY`, `TISSUE_RECOVERY_TIMELINES`, `RECOVERY_HIERARCHY`. Engine still uses an ad-hoc post-race ladder (`coach-engine.ts:271-321`). |
| 01 | pace-zones-vdot.md | `pace_zones.ts` (~30 exports) | WIRED (richest yet) | `VDOT_LOOKUP_TABLE`, `PACE_ZONE_WIDTH`, `VDOT_TIERS` + `vdotTierFor` + `VDOT_FRESHNESS_WINDOW` + `vdotFreshnessFor` + `VDOT_FIELD_TESTS` + `VDOT_TEST_TRIGGERS` (`lib/vdot.ts:24-353` + `app/page.tsx:1318` NoVdotPanel + `app/page.tsx:1383` freshness chip). Pace bands also feed `lib/strava-stats.ts:effortBalance` for VDOT-aware classification. | `DANIELS_PACE_OFFSETS_S_PER_MI` (legacy fallback path), `HANSONS_PACE_OFFSETS_S_PER_MI`, `MCMILLAN_PRINCIPLES`, `PFITZINGER_ZONES`, `WORKOUT_PACE_PRESCRIPTION`, `MARATHON_VDOT_CORRECTION` (engine doesn't apply it), `RIEGEL_FATIGUE_EXPONENT`, `PACE_LOCK_BY_SITUATION` |
| 02 | race-time-prediction.md | `race_prediction.ts` (16 exports) | UNWIRED | None | All 16 — Riegel, Cameron, McMillan runner types, asymmetry rules, multi-race weights, age grading. App still uses VDOT lookup for race-equivalent only. |
| 03 | heart-rate-zones.md | `hr_zones.ts` (23 exports) | PARTIAL | `HRMAX_ZONES_5` is now a real consumer — `app/page.tsx:1217-1278` HrZonesTile renders the full 5-zone band table, computed from a per-runner HRmax (measured or Tanaka-estimated via `lib/runner-profile.ts:resolveHrmax`). The "152 bpm" magic number is still in `coach-engine.ts:391` (`HARD_EFFORT_HR_DEFAULT_BPM`) but a comment at `coach.ts:489` cites `HRMAX_ZONES_5` as its origin. | `HRMAX_ZONES_7`, `KARVONEN_FORMULA`, `LTHR_30MIN_TT_PROTOCOL`, `FRIEL_LTHR_ZONES`, `HRMAX_FIELD_TEST_PROTOCOLS`, `HRV_INTERPRETATION_PATTERNS`, `RHR_RECOVERY_DECISION_RULES`, `HR_VS_PACE_DIVERGENCE`, `PA_HR_DECOUPLING_BANDS`, `HR_UTILITY_BY_REP_DURATION`, `COACH_BY_METRIC_DECISION`, `HR_SENSOR_ACCURACY`, `HR_SYSTEM_PICKER`, `HR_SYSTEM_CROSSWALK`, `HR_COACHING_HEURISTICS`, `HR_CONFOUNDERS`, MAF formula |
| 04 | workout-vocabulary.md | `workouts.ts` (26 exports) | PARTIAL | The 16 `RunWorkoutType` slugs in `coach-workouts.ts:18-35` (added `vdot_test_5k` at line 266) match the doctrine vocabulary; `LONG_RUN` and `STRIDES` constants read via `coach-principles.ts` | The 23 other constants (`THRESHOLD_INTERVALS_PROTOCOL`, `VO2_REPS_PROTOCOL`, `MARATHON_PACE_BLOCK`, `PROGRESSION_PROTOCOL`, `HILL_REPS_PROTOCOL`, `STRIDE_GUIDELINES`, etc.) — engine still hardcodes rep schemes in `coach-workouts.ts:101+`. The `/workout/[date]` page is still entirely static placeholder. |
| 05 | injury-return-protocols.md | `injury_return.ts` (6 exports) | UNWIRED | None | `WALK_RUN_PROTOCOL`, `PAIN_MONITORING_RULES`, INJURY_CATALOG. No injury intake anywhere. `coach.adjustForReality` is a Stage-5 stub. |
| 06 | weather-adjustments.md | `weather.ts` (22 exports) | WIRED | `MAUGHAN_HEAT_SLOWDOWN`, `TEMP_DEWPOINT_SUM_ADJUSTMENT`, `DEWPOINT_PACE_ADJUSTMENT`, `ALTITUDE_RACE_LOSS`, `WIND_PER_MILE_COST`, `SINGLE_NUMBER_HEAT_FALLBACK`, `QUALITY_SESSION_BAIL_TRIGGERS`, `HARD_CANCEL_TRIGGERS` consumed by `lib/weather-slowdown.ts`. Used in `briefRaceMorning` (`coach.ts:506-744`). | `WBGT_FLAGS`, `WBGT_COMPUTATION`, `HEAT_ACCLIMATION_*`, `LHTL_PROTOCOL`, `AQI_THRESHOLDS`, `HEAT_ILLNESS_WARNING_SIGNS`, `COLD_PERFORMANCE_IMPACT`, `WIND_CHILL_THRESHOLDS` |
| 07 | strength-programming.md | `strength.ts` (5 exports) | PARTIAL | `STRENGTH_PERIODIZATION` mirrored by hand in `coach-principles.ts:201-222` (coincidence not import) | `HEAVY_RESISTANCE`, `PLYOMETRICS`, `STRENGTH_INJURY_REDUCTION_PCT`, `AMP_MODES` |
| 08 | pacing-and-race-week.md | `pacing.ts` (18 exports), `race_week.ts` (19 exports) | PARTIAL | `pacing.ts` consumed in `lib/pacing.ts` (Minetti grade-adjusted-pace). Brief cites §3.5 (`coach.ts:606`). | `race_week.ts`'s 19 constants — taper specifics, race-week meal logistics, sleep banking, kit dress rehearsal — defined, never imported. |
| 09 | cross-training.md | `cross_training.ts` (5 exports) | UNWIRED | None | `XT_DECISION_RULES`, `XT_CARRYOVER_MATRIX`, modality lookup. No XT substitution path in app. |
| 10 | mobility-warmup.md | `mobility.ts` (7 exports) | UNWIRED | None | `WARMUP_RATIONALE`, `DYNAMIC_WARMUP_PROTOCOL`, `DAILY_MOBILITY_ROUTINE`, RAMP framework. |
| 11 | course-specific-training.md | `course.ts` (6 exports) | PARTIAL | `course-facts.ts` legacy file feeds the race detail page with hand-curated facts. `course.ts` doctrine constants defined but unused. | Hill repeats / down-hill protocols, surface adjustments, altitude prep timing. |
| 12 | travel-timezone.md | `travel.ts` (5 exports) | UNWIRED | None | `TRAVEL_ARRIVAL`, `EAST_WEST_ASYMMETRY`, jet-lag protocols. |
| 13 | sex-specific-training.md | `sex.ts` (6 exports) | UNWIRED (sex used only for grading) | None | `MENSTRUAL_CYCLE_GUIDANCE`, `HORMONAL_CONTRACEPTION_NOTES`, RED-S, iron deficiency. CoachState + runner profile have NO cycle log. |
| 14 | age-considerations.md | `age.ts` (5 exports) | PARTIAL on client | None on server. **Client side: `lib/runner-profile.ts:birthYear` is read by `app/page.tsx:1370` VdotTile + age-grading via `coach/doctrine/grading.ts:gradeVdot`.** | `AGE_DEFAULTS_BY_DECADE` (engine-side prescription not yet age-aware), `VO2MAX_DECLINE_CURVE`, age-specific recovery rules |
| 15 | wearable-data.md | `wearables.ts` (5 exports) | PARTIAL | ACWR consumed by `coach-principles.ts:121-126` | `TRIMP`, `TSS`, `monotony`, `strain`, EWMA-ACWR, illness early signals, `DEVICE_SOURCE_OF_TRUTH` |
| 16 | form-biomechanics.md | `cadence.ts` (3 exports) | UNWIRED | None | Cadence guidelines, form benchmarks. /runs/[id] shows cadence but no target. |
| 17 | footwear.md | `shoes.ts` (4 exports) | PARTIAL | Shoe closet uses `lib/shoe-utils.ts` (parallel source of truth). | `shoes.ts` doctrine constants. |
| 18 | fueling-products.md | `fueling.ts` (7 exports) | PARTIAL | `RACE_CARB_TARGETS_G_PER_HR`, `GLUCOSE_FRUCTOSE_RATIO`, `CARB_LOAD_24_48HR`, `PRE_RACE_MEAL`, `HYDRATION` defined; `lib/fueling-claude.ts` + `lib/fueling.ts` are the active code paths and don't import doctrine. | The 80-100 g/hr default + 120 g/hr stretch. Pre-race carb loading per-kg numbers. |
| 19 | hydration-electrolytes.md | `hydration.ts` (12 exports) | PARTIAL | `app/races/[slug]/page.tsx:848-948` HydrationTile renders pre-race blocks (24h / 2-4h / final hour) + during-race ml/hr table by distance × temperature. The numbers come from `PRE_RACE_HYDRATION` + `FLUID_DURING_RACE` BUT they're hand-inlined into the tile rather than imported from `hydration.ts` — same parallel-sources problem as fueling. | `DAILY_HYDRATION_BASELINE`, `HYDRATION_STATUS_INDICATORS`, `HYDRATION_STRATEGY_BY_SCENARIO`, `SODIUM_INTAKE_BY_SCENARIO`, `EAH_RISK_FACTORS`, `EAH_PREVENTION_AND_TREATMENT`, `EAH_CLASSIFICATION`, `SWEAT_RATE_PROTOCOL`, `SWEAT_SODIUM_CLASSIFICATIONS`, `DEHYDRATION_PERFORMANCE_IMPACT` |
| 20 | mental-training.md | `mental.ts` (13 exports) | UNWIRED | None | A/B/C goals, PETTLEP, self-talk catalog, pre-race anxiety, post-race blues, DNF rules, burnout warnings |
| 21 | form-corrections.md | (no doctrine file) | UNWIRED | None | Per-error drill catalog |
| 22 | plan-templates.md | `plan_templates.ts` (4 exports) | WIRED | `PLAN_TEMPLATES` consumed by `lib/coach-plan.ts:19,50` and orchestrated by `coach-engine.ts:231-237` | Template selection is currently distance + experience-level only. |
| 24 | vdot-age-sex-grading.md (NEW) | `grading.ts` (3 exports + `gradeVdot` fn) | WIRED | `VDOT_AGE_DECLINE_MALE`, `VDOT_AGE_DECLINE_FEMALE`, `VDOT_SEX_COHORT_OFFSET`, `gradeVdot()` consumed by `app/page.tsx:1372` — VdotTile shows age-graded VDOT inline when birth year + sex are known and the grade differs from raw by ≥1.0 VDOT | World Masters Athletics tables (planned future replacement for the simplified Daniels per-decade model) |
| — | INDEX.md / GLOSSARY.md / SOURCES.md / RESEARCH_TASKS.md / REVIEW_NOTES.md | — | n/a | Manual TOC, definitions, provenance, planning, review history | — |

### Coverage summary

| Bucket | Count | Notes |
|---|---|---|
| Fully WIRED | 6 | 01 (pace-zones), 06 (weather), 22 (plan templates), 24 (grading), plus HR-5-zone bands and POST_RACE_STAGES surfacing |
| PARTIAL | 11 | 00a, 00b, 03, 04, 07, 08, 11, 14 (client-side), 15, 17, 18, 19 |
| UNWIRED doctrine file | 9 | 02, 05, 09, 10, 12, 13, 16, 20, race_prediction-flavor of 18 |
| Research file with no doctrine file | 1 | Research/21 (form corrections) |

### Critical observations from the matrix

1. **Doctrine drift risk is high in the partial-wired bucket.** When a tile inlines numbers (HydrationTile, FuelingTile, NoVdotPanel) instead of importing the doctrine constant, doctrine updates will silently fail to propagate. This is the single biggest architectural debt outside of the placeholder `/workout/[date]`.

2. **The Coach interface (`web/coach/coach.ts:254-296`) declares 8 methods. Only 4 are wired.** Pacing strategy, taper depth, fueling, retrospect, and adjustForReality are stubs — and the surrogate paths (`lib/fueling-claude.ts`, the engine's hand-coded post-race ladder, `/api/retrospective` calling Anthropic SDK directly) all bypass doctrine.

3. **Server-side coach state has no runner identity.** Age, sex, HRmax, RHR live in localStorage via `lib/runner-profile.ts`. The brief route can't ever say "your VDOT is exceptional for a 60-year-old woman" because the brief never sees who the runner is.

4. **The `/workout/[date]` route is still a 100% static placeholder.** It's the linked-to destination from the dashboard week-strip, the 30-day strip, and the training-page next-up list. Three high-traffic doors all open into a frozen design canvas.

---

## 2. UI surface inventory

Eight live page roots under `web/app/`. Page sizes (lines): `page.tsx` 2198, `training/page.tsx` 672, `races/[slug]/page.tsx` 2056, `profile/page.tsx` 596, `health/page.tsx` 220, `log/page.tsx` 462, `runs/[id]/page.tsx` 450, `workout/[date]/page.tsx` 520, `races/page.tsx` 400, `races/new/page.tsx` (additional create flow). Plus `dev-preview/` for poster/typography QA.

### 2.1 `app/page.tsx` — Overview / Hub (2198 lines)

Render order at the page root (`page.tsx:65-117`):

1. `Greeting` (line 124) — name display + race-day callout chip. Live.
2. **Top-tile row** (`page.tsx:81-86`):
   - `NextRaceCard` (line 175) — next race name, days-out, goal. Live.
   - `RecentRunCard` (line 215) — last Strava run distance/pace/name. Live.
   - `WeeklyMilesCard` (line 246) — this-week sum + 4-week mini bar chart. Live.
   - `YearMilesCard` (line 279) — YTD miles + total elev + longest. Live.
3. **Mid row** (`page.tsx:88-91`):
   - `ThisWeekTile` (line 317) — 7-day calendar bar chart of completed Strava miles. Live.
   - `TodayTile` (line 380) — "ran today" status, race-day override. Live.
4. `CoachTodayCard` (line 520) — the legacy v1 daily card, now thick with new sub-tiles:
   - **`ReadinessBanner`** (line 883) — green/yellow/red verdict from `coach.assessReadiness`. Renders inline at top of card when level ≠ green or signals exist (line 617). Shows `acwr` + `easyShare` chips, message sentence, and an expandable `▸ N SIGNALS` toggle that reveals each detected signal (heavy-block, race-recovery, ACWR-out-of-band, ACWR-running-hot, ACWR-low, easy-imbalance, missed-runs) plus the `recommendedAction` from doctrine 00b decision matrix.
   - Run + Strength prescription side-by-side (line 622).
   - **`CoachDailyBrief`** (line 962) — voice paragraph from `coach.briefDailyTraining`. Shows `▸ WHY?` toggle exposing engine rationale + voice rationale + research citations. Renders a `FALLBACK · NO API KEY` chip when `brain === 'deterministic'`.
   - 7-cell week-shape grid with strength chips.
5. **`PhaseGuidanceCard`** (line 1205) — hidden in BASE/BUILD/PEAK; surfaces in TAPER / POST_RACE / REBUILD with research-backed phase guidance. Imports `TAPER_VOLUME_REDUCTION`, `TAPER_INTENSITY_PRESERVATION`, `TAPER_ERRORS`, `TAPER_BENEFIT`, `POST_RACE_STAGES` from `coach/doctrine`. Live.
6. **`Next30DaysCard`** (line 1047) — 30-cell strip color-coded by workout type from `payload.next30Days`. Long runs taller, races flagged with priority-colored top bar. Footer race callouts + legend. Live.
7. **`VdotCard`** (line 1281):
   - When VDOT unavailable AND `vdotTestPrompt` is true → renders **`NoVdotPanel`** (line 1318) with 4 field-test option cards (5K TT / 30-min TT / 3K+5K combo / "race anything").
   - When VDOT present → **`VdotTile`** (line 1359) with big number, **tier badge** (`novice`/`intermediate`/`advanced`/`elite`, color-coded), **freshness chip** (`FRESH`/`STALE SOON`/`STALE`/`EXPIRED`), source race, paces. Includes inline **age-graded VDOT** line when birth year + sex are configured (`gradeVdot` from `coach/doctrine/grading.ts`) — only renders when raw vs graded ≥1.0 to avoid noise.
   - Stale/expired chip prompts: *"Coach can plan a 5K time trial — see today's prescription."*
8. **`HrZonesCard`** (line 1205, separate from PhaseGuidanceCard which has same line address — the layout is sibling) — hides itself when neither HRmax nor age is known. Otherwise renders 5-zone band table from `HRMAX_ZONES_5` × resolved HRmax (measured or Tanaka). Footer disclaimer when source is `tanaka_estimate`.
9. `RecoveryWidget` (line 1975) — Pause Studio City credits + scheduled recovery sessions. Live.
10. `TrainingPulseTile` (line 1493) — reconciled with engine: phase chip + easyShare target read from `/api/coach/today` (line 1503-1540). Long-run cap stat added (Daniels +10% × phase ceiling, line 1697-1718). Quality-day-this-week count vs phase target added (line 1647-1661). Easy ratio uses VDOT-aware classifier (line 1577).
11. `YearHeatmapSection` (line 1783) — GitHub-style contribution grid. Live.
12. `FunStatsSection` (line 1891) — comparator cards. Live.

**Total tile count on the overview:** ~14 distinct surfaces stacked vertically, with the four-up top row plus seven full-width tiles plus auxiliary bands. The information density is HIGH and the visual hierarchy is mostly flat — no surface dominates, no surface fades.

### 2.2 `app/training/page.tsx` — Daily briefing (672 lines)

Render order (`training/page.tsx:99-200`):

1. Masthead: eyebrow ("Daily briefing"), big Oswald date hero, phase line with orange dot, big Oswald workout title.
2. Two-column lead: `voiceLead` paragraph (left) + stats sidebar (right).
3. 7-cell week-strip with solid-orange today.
4. "Next-up" list — next 4 days from `weekShape`.
5. `RecentWeeksTile` (line 426) — last-12-weeks bar chart.

The page reads `coach.workout.answer` from `/api/coach/today` (the prescription with the composed `voiceLead`).

**Voice-paragraph divergence with the dashboard:** the dashboard's `CoachTodayCard` shows engine-rationale + the new `briefDailyTraining` LLM voice; the training page shows the engine's per-prescription `voiceLead` from `coach/explanations.ts:composeVoiceLead`. Two voice surfaces, two distinct copy paths, both about "today."

### 2.3 `app/races/page.tsx` — Race index (400 lines)

`UpcomingRaceHero` + `RaceCard` grid + `EmptyState`. Sorted by date. Live.

### 2.4 `app/races/[slug]/page.tsx` — Race detail (2056 lines)

The deepest single page in the app. Render order (line 322 onward):

1. `PosterCard` (line 322) — hero, course map, narrative, 4-up stats, inline goal-time edit, phase legend, elevation chart.
   - **`CoachBriefBlock`** (line 1648) embedded inside the description column for upcoming races. The brief itself has had its `▸ WHY?` toggle wired so citations render inline beneath the paragraph when the user expands. Adaptive horizon — `briefTitleFor()` (line 1634) switches between course / approach / race-week / race-morning.
2. `PhaseCards` (line 626) — per-phase stacked cards. Live.
3. `MileSplits` (line 690) and `FuelingTile` (line 797) — two-column row.
4. **`HydrationTile`** (line 848) — pre-race blocks (24h/2-4h/final hour) + during-race ml/hr table indexed by race distance bucket × 4 temp bands (cool/temperate/warm/hot). Numbers cited to Research/19 — but copied inline rather than imported from `coach/doctrine/hydration.ts`.
5. `ResultSection` (line 958) post-race only:
   - `PerPhaseTable` (line 1031) — plan vs actual per phase + delta + avgHR.
   - `PerMileTable` (line 1106) — per-mile target/actual/delta/HR/Δelev.
   - `RaceMetaTile` — suffer/kudos/achievements/best-efforts.
   - `ResultForm` — finish + PR + notes.
6. `WeatherTile` (line 1279) — NOAA forecast (≤7d) or Open-Meteo historical (>7d).
7. `useAdaptiveBrief` hook (line 1541) — single source of truth for /api/brief calls.
8. `briefTitleFor()` (line 1634) — horizon → label mapping.
9. `EditRaceModal` (line 1660), `ExportFooter` (line 1605).

This page is by far the densest and most polished single surface in the app. The poster card is genuinely a piece of design. Nothing else in the app is at this level of finish.

### 2.5 `app/log/page.tsx` — Run log (462 lines)

`PRShelf`, `RacesShelf`, `RunFeed`, `ConnectStravaBanner`. Live. The log is a chronological feed without filters, search, or grouping by week/month.

### 2.6 `app/runs/[id]/page.tsx` — Single run (450 lines)

Render order:
- Page-head with name (uppercase), distance/time/pace, RACE chip when `workoutType === 1`.
- `RoutePoly` — decoded inline polyline, no map deps.
- `StatsTile` — distance, time, pace, avgHR, maxHR, elevGain, suffer, kudos.
- `ShoeTile` — shoe assignment (read/write via `/api/strava/activity/[id]/shoe`).
- `BestEffortsTile` — Strava best-effort segments with PR flag.
- `SplitsTable` — per-mile splits with pace/HR/Δelev.
- `DescriptionTile` — Strava description.

The page is competent at what it does (one Strava activity, one screen). It does NOT pull any training context — the run's place in the week, whether it was the prescribed workout, whether it hit pace, etc. (See section 8d for the redesign.)

### 2.7 `app/health/page.tsx` — Health (220 lines)

The page splits cleanly into two:

- **Strava signals** (lines 48-53, FromStravaPanel at line 66) — YTD avg HR + 12-week trend line; cadence trend; weekly mileage trend. Real numbers, real data.
- **HealthKit signals** (lines 55-58) — 4 dashed-border placeholder cards (RHR, HRV-7d, Sleep-7d, Recovery score) with `M2 · HealthKit` chip. Always renders `—`.

The HealthKit placeholder grid is the second-largest dead surface in the app after `/workout/[date]`. Critical context: now that `/profile` collects HRmax + RHR, three of those four cards (RHR, HRV trend if we have it, Recovery score derived from training load + RHR) could surface real numbers from the runner profile. They still show `—`.

### 2.8 `app/profile/page.tsx` — Profile (596 lines)

Sections:
- `RunnerProfileSection` — birth year, sex, HRmax, RHR fields with explanations of when each matters. Persists to localStorage via `lib/runner-profile.ts`. Confirms tier-changing on save. The HRmax + RHR fields drive the dashboard's HrZonesCard.
- Long-run-day picker (line 96-120) — local-only, doesn't reach the engine.
- Days-running-per-week — local-only.
- Shoe closet (line 121-167) — server-backed via `/api/shoes`. Live.
- `ShoeForm` modal — full add/edit with auto-cap suggestion.

### 2.9 `app/workout/[date]/page.tsx` — Workout detail (520 lines, 100% PLACEHOLDER)

Static layout from `BuildResearch/deck.html` surface s3 — the Tue Apr 14 threshold session. Hard-coded:
- Breadcrumb says "Big Sur 2026 · Wk 14 · taper · Tue Apr 14 · threshold" regardless of input date.
- HeroTile shows "Threshold · 5 × 1 mi" hardcoded.
- Kpi strip: "8.0 mi · ~58 min · 6:30/mi · 160 bpm" — frozen.
- WhyTile, StructureTile, PastAttemptsTile, SendToWatchTile, ConditionsTile, ShoeTile, FuelingTile — all hardcoded.

The page does receive `date` from params but doesn't use it for anything. This is **the most prominent placeholder surface in the app**. Every link from the dashboard's week-strip + 30-day-strip + training-page next-up list lands here.

### 2.10 `app/races/new/page.tsx` — Create race

Form to add a new race manually. Has fields for name, date, distance, goal-time, location. Stores to Postgres via `/api/races`. Live.

### 2.11 Components shared across pages

- `Caption` (top page caption with eyebrow)
- `Nav` (left rail with active state)
- `Modal` (overlay container)
- `RaceCard` / `UpcomingRaceHero` (race index)
- The doctrine-tiles in `app/page.tsx` are inlined as private components rather than extracted (HrZonesTile, VdotTile, NoVdotPanel, PhaseGuidanceCard, Next30DaysCard, ReadinessBanner, CoachDailyBrief, TrainingPulseTile, etc.)

The dashboard's tile components are NOT reused elsewhere. If we want HrZones on the workout detail page or VDOT on the training page, we'd need to extract them into `web/components/`. This is a near-term refactor blocker for the redesign in section 8 — many of the proposed pages reuse tiles that today are private to `app/page.tsx`.

### 2.12 Routing topology

The Next.js App Router structure is 8 active routes plus 2 dynamic segments:

```
/
/training
/log
/health
/profile
/races/
/races/[slug]
/races/new
/runs/[id]
/workout/[date]
/dev-preview/  (poster + typography QA)
```

Plus a battery of API routes under `/api`:
- `/api/coach/today` — main daily payload (state + prescription + brief + 30-day strip + VDOT)
- `/api/brief` — race-detail adaptive brief
- `/api/retrospective` — post-race retrospective
- `/api/strava/*` — Strava cache + activity detail + shoe assignment
- `/api/races` + `/api/races/[slug]` — race CRUD
- `/api/shoes` + `/api/shoes/[id]` — shoe CRUD
- `/api/weather/*` — NOAA + Open-Meteo proxies
- `/api/health/*` — placeholder for HealthKit JSON ingest

The route map is shallow (no nested layouts beyond root). Adding `/season`, `/calibration`, `/patterns`, `/library`, `/research`, `/today` (proposed in section 8) is straightforward at the routing layer.

### 2.13 Component-level density observations

Some quick pulse-checks on per-page component density:

| Page | LOC | Distinct in-file components | Imported from `lib/` | Imported from `coach/doctrine/` |
|---|---|---|---|---|
| `app/page.tsx` | 2198 | ~22 | 7 modules | 7 constants |
| `app/races/[slug]/page.tsx` | 2056 | ~30 | 11 modules | 0 (HydrationTile inlines) |
| `app/training/page.tsx` | 672 | ~12 | 5 modules | 0 |
| `app/profile/page.tsx` | 596 | ~8 | 2 modules | 1 (RunnerSex type) |
| `app/workout/[date]/page.tsx` | 520 | 8 (all hardcoded) | 0 | 0 |
| `app/runs/[id]/page.tsx` | 450 | ~10 | 2 modules | 0 |
| `app/log/page.tsx` | 462 | ~8 | 4 modules | 0 |
| `app/health/page.tsx` | 220 | 5 | 2 modules | 0 |

Key observation: `app/page.tsx` is the densest page in doctrine consumption (7 constants imported). The others either consume doctrine indirectly (through `lib/`) or not at all. The race detail page has 0 direct doctrine imports despite being the deepest page — all doctrine flows through the planner libraries (`lib/pacing.ts`, `lib/fueling.ts`, etc.) and the brief route.

---

## 3. State + data flow

### 3.1 The state aggregator

`gatherCoachState()` lives in `web/lib/coach-state.ts:217-415`. Invoked from `/api/coach/today` and `/api/brief` only (server-side).

### 3.2 What it reads

- **Postgres**: `listRacesDB()` → saved races + `actualResult`
- **Strava cache**: `getCachedActivities()` → `NormalizedActivity[]`
- **HealthKit**: always null (`flags.healthKitAvailable: false`, line 411)

It does NOT read:
- Runner profile (lives in localStorage via `lib/runner-profile.ts`)
- Shoe closet (server table exists, not pulled into state)
- HealthKit anything (architecturally absent)
- Training preferences (long-run day, days-running-per-week from `/profile`)

### 3.3 What it returns

The `CoachState` shape (abbreviated):

```ts
{
  today: ISODate,
  races: { nextA, nextAny, recent, racesForVdot, raceCount30d, ...},
  volume: { last7Mi, last28Mi, last7Days, ... },
  intensity: { easyMi14d, hardMi14d, easyShare14d, ... },
  recovery: { consecutiveRunDays, hrv7dAvgMs, rhrBpm, sleep7dAvgHrs, strengthDaysThisWeek, recoveryWindowEndsISO, ... },
  flags: { healthKitAvailable: false, ... },
  // NO runner identity fields
}
```

### 3.4 Critical state-shape issues

**(A) No runner identity server-side.** Age, sex, weight, HRmax, RHR all absent. Consequence:
- Engine prescriptions don't know runner age — `AGE_DEFAULTS_BY_DECADE` cannot consult.
- The 152 bpm hard-effort threshold in `coach-engine.ts:391` is constant for everyone.
- The brief doesn't see sex/age, so it can't comment on age-grading or sex-cohort context.
- HRmax measured on the profile page only fuels the dashboard tile; it does NOT replace the 152 bpm magic number in the engine's quality-vs-easy gate.

**(B) Computed but never read.** Ghosts in the state shape:
- `races.nextAny` (always equals or supersets `nextA`)
- `races.raceCount30d` (only used in a single rationale string)
- `volume.last7Days` (UI computes its own week-day breakdown)
- `intensity.easyMi14d`, `intensity.hardMi14d` (only `easyShare14d` is read)
- `recovery.consecutiveRunDays`
- `recovery.hrv7dAvgMs`, `recovery.rhrBpm`, `recovery.sleep7dAvgHrs`, `recovery.strengthDaysThisWeek` (because HealthKit is mocked)
- `flags.healthKitAvailable`

**(C) Critical fields missing.** Things `gatherCoachState()` would need to compute coaching beyond what it does:
- runner age / sex / weight (server-side mirror of localStorage)
- HRmax / LTHR / RHR (server-side mirror)
- injury flag (with type + onset)
- travel state (departure/arrival/timezone diff)
- training preferences (long run day, days-running-per-week — UI-only today)
- explicit phase override
- carb tolerance / GI calibration delta
- past TT results as a first-class shape (currently has to be a generic race entry)

### 3.5 Two parallel "state" stores

Today there are essentially TWO state stores running in parallel:

1. **Server-side `CoachState`** — Postgres + Strava cache, ages out daily, drives the engine.
2. **Client-side `runner-profile.ts` localStorage** — runner identity, drives display tiles.

These NEVER reconcile. The hub-as-backbone redesign (section 8) requires merging them.

---

## 4. Coach methods inventory

`web/coach/coach.ts` defines the `Coach` interface (lines 254-296) with **8 methods**.

### 4.1 Method status

| Method | Stage | Wired? | Brain | Notes |
|---|---|---|---|---|
| `paceStrategy` | 1 | Stub (throws) | — | Surrogate: `lib/pacing.ts` direct Minetti call. |
| `taperDepth` | 1 | Stub | — | Surrogate: `lib/coach-principles.ts:weeklyVolumeMultiplier` + engine's TAPER phase logic. |
| `fuelingFor` | 1 | Stub | — | Surrogate: `lib/fueling-claude.ts` (Claude SDK direct) + `lib/fueling.ts` rule-based fallback. Doctrine bypassed. |
| `prescribeWorkout` | 3 | Wired | Deterministic | Drives the daily card prescription. |
| `assessReadiness` | 3 | Wired | Deterministic | Now collects 6 signal types and maps to 5-tier `recommendedAction` per doctrine 00b decision matrix (`coach.ts:432-480`). Returns `signals[]` + `recommendedAction` in `ReadinessAssessment`. |
| `briefRaceMorning` | 2 | Wired | LLM with deterministic fallback | Adaptive horizon (course/approach/race-week/race-morning). |
| `briefDailyTraining` | — | Wired | LLM with deterministic fallback | New surface. Anchors on TODAY rather than a race. Surfaces on dashboard via `CoachDailyBrief` with a `▸ WHY?` toggle exposing engine rationale + citations. |
| `retrospect` | 4 | Stub | — | Surrogate: `/api/retrospective` calls `lib/retrospective.ts` + Anthropic SDK directly with its own RETROSPECTIVE_SYSTEM_PROMPT, NOT voice.md. |
| `adjustForReality` | 5 | Stub | — | Not exposed. |

**Score: 5 wired (workout, readiness, race brief, daily brief, plus prescribeWorkout's plan integration), 4 stub.** Compared to the Coach Build Plan's stage-progression goals, we are mid-Stage 4 with Stage 5 untouched.

### 4.2 Surrogate-path liability

The four stubbed methods all have surrogate paths that bypass the Coach interface and bypass doctrine:

- `pacing.ts` → direct Minetti call, doesn't import `pacing.ts` doctrine constants beyond Minetti.
- `coach-principles.ts:weeklyVolumeMultiplier` → hand-rolled taper math, doesn't import `taper.ts`.
- `fueling-claude.ts` → Claude SDK direct, custom prompt, doesn't import `fueling.ts` doctrine.
- `lib/retrospective.ts` → Anthropic SDK direct, separate `RETROSPECTIVE_SYSTEM_PROMPT`, doesn't use the Coach voice prompt.

**Implication:** when doctrine changes, four downstream consumers won't notice. This is the same architectural anti-pattern as inline-doctrine in HydrationTile and FuelingTile, but at the engine layer instead of the UI layer.

---

## 5. Stat accuracy audit

For each numerical stat surface on the dashboard + race detail, we check the math, the source, and context-awareness. Legend: ✓ correct · ❌ wrong · ⚠️ misleading · ❓ unverifiable.

### 5.1 Dashboard tiles

#### `WeeklyMilesCard` (`page.tsx:246`)
- "X.X mi" headline: ✓ — sums `inWeek.distanceMi` from `runs` filtered by `thisWeekRange()` (Mon-Sun). `weeklyMiles(runs, 4)` for the 4-bar chart.
- "N RUNS" chip: ✓ — `inWeek.length`.
- 4-bar mini chart highlighting current week: ✓.

#### `YearMilesCard` (`page.tsx:279`)
- "X.XXX mi" YTD: ✓ — `rollupYear(runs).totalMiles`.
- "N RUNS" chip: ✓.
- Sub line `{totalElevFt} ft climbed · longest {longestRunMi} mi`: ✓.

#### `RecentRunCard` (`page.tsx:215`)
- "X.X mi" + "M:SS/MI · BPM": ✓.
- Days-ago chip "TODAY / YESTERDAY / N AGO": ✓.

#### `ThisWeekTile` (`page.tsx:317`)
- 7-day bar chart with future-day flag: ✓.
- Per-bar mile labels above each bar: ✓.

#### `TodayTile` (`page.tsx:380`)
- "Ran today" surfaces from `runs.filter(r => r.date === todayISO())` (LA-tz aware): ✓.
- Race-today / race-tomorrow override: ✓.

#### `CoachTodayCard` — Run prescription (`page.tsx:622-636`)
- Workout type label + color: ✓.
- "{distanceMi.toFixed(1)} MI" or "0 MI · REST DAY": ✓.
- "HR Z{hrZone}": ❓ — `hrZone` is set in `coach-workouts.ts` per workout type as a static 1-5 number; it's NOT yet computed from the runner's actual HRmax. **Misleading**: a 60-year-old with HRmax 165 sees the same "HR Z3" label as a 25-year-old with HRmax 200.
- Pace band "{lowS}-{highS}/MI": ✓.
- Description: ✓.

#### `CoachTodayCard` — Alerts (`page.tsx:589-610`)
- Heavy-block alert: suppressed since description carries it (engine.ts:430-437). ✓.
- Post-race alert: suppressed for same reason. ✓.
- Rebuild alert: ✓.
- Easy-share alert: phase-gated (only fires outside POST_RACE / REBUILD). ✓.
- Taper-window info alert (≤14 days): ✓.
- ACWR-high warn: ✓.

#### `ReadinessBanner` (`page.tsx:883`)
- Level (`green`/`yellow`/`red`): ✓ — comes from `coach.assessReadiness` decision tree (`coach.ts:393-428`).
- ACWR chip: ✓.
- "{X}% EASY" chip: ✓.
- Signals list: ✓.
- `recommendedAction`: ✓ — maps signal-count to action per doctrine 00b decision matrix.

#### `CoachDailyBrief` (`page.tsx:962`)
- Voice paragraph: ✓ when LLM available; deterministic fallback when not. Stub chip surfaces correctly.
- WHY toggle: shows engine rationale + voice rationale + citations. ✓.

#### `Next30DaysTile` (`page.tsx:1071`)
- 30-day strip: ✓.
- Long runs render taller, rest cells shorter: ✓.
- Race overlays: ✓.
- Header sub `"X mi · N quality · M long"`: ✓.
- ⚠️ Visual cells don't strongly indicate which day is *today* — `d.isToday` outline is set but easily missed.

#### `VdotTile` (`page.tsx:1359`)
- Big VDOT number: ✓.
- Tier badge label + color: ✓.
- Freshness chip (`FRESH`/`STALE SOON`/`STALE`/`EXPIRED`): ✓.
- "Last tested · X days ago" + source race name + "X.XX MI · H:MM:SS · M:SS/MI": ✓.
- Age-graded line — only renders when birth year set + age > 30 + |graded - raw| ≥ 1: ✓.
- 5 pace bands E/M/T/I/R: ✓.

#### `NoVdotPanel` (`page.tsx:1318`)
- 4 field-test option cards: ✓ in copy.
- ⚠️ "Apply +1 VDOT correction for solo effort" appears in the 5K TT card but the engine doesn't actually apply this when a solo TT is logged.

#### `HrZonesTile` (`page.tsx:1216`)
- 5 zone bands: ✓ — `Math.round((def.pctLow / 100) * hrmax.bpm)`.
- Source label "HRmax X BPM · Tanaka estimate / measured": ✓.
- ⚠️ Tanaka SE is ±10 BPM. Footer disclaimer mentions this; the actual zone bands are computed as point estimates.

#### `PhaseGuidanceCard` (`page.tsx:1205`)
- Hidden in BASE / BUILD / PEAK; renders TAPER / POST_RACE / REBUILD: ✓.
- TAPER copy uses `TAPER_VOLUME_REDUCTION` + `TAPER_INTENSITY_PRESERVATION` + `TAPER_ERRORS` + `TAPER_BENEFIT`: ✓.
- POST_RACE copy uses `POST_RACE_STAGES`: ✓.

#### `TrainingPulseTile` (`page.tsx:1493`)
- Phase chip: ✓ now reconciled with engine.
- Phase descriptor sentence: ✓.
- 8-week bar chart with current-week highlight: ✓.
- "Weekly avg X.X mi" with delta-vs-prior-4w chip: ✓.
- "Long run avg" — avg of longest-of-each-of-last-4-weeks: ✓.
- "PEAK LONG RUN — X.X MI · LAST 28 DAYS": ✓.
- **"NEXT-WEEK CAP ≤ X.X MI · DANIELS +10% RULE"**: ✓ math, but **disagrees with engine**. Tile uses TAPER `× 0.6`, POST-RACE `× 0.5`, REBUILD `× 0.7`; engine `longRunTarget` (`coach-engine.ts:362-374`) uses TAPER `× 0.65`, POST_RACE `× 0.4`, REBUILD `× 0.6`. **The runner sees one cap on the dashboard and a different long-run distance on the prescription.**
- "X / Y QUALITY THIS WEEK": ✓.
- Easy ratio %: ✓ — VDOT-aware classifier.
- LOW CONF chip when `!balance.highConfidence`: ✓.

### 5.2 Race detail tiles

All ✓ except:
- ⚠️ `FuelingTile.carb_target_g_per_hr` — comes from planner default (60g), not from `RACE_CARB_TARGETS_G_PER_HR` doctrine bands.
- ⚠️ `HydrationTile` numbers — hand-inlined rather than imported from doctrine.

### 5.3 Stats called out

**❌ Wrong:** none found.

**⚠️ Misleading:**
1. `CoachTodayCard.hrZone` label "HR Z{1-5}" is a static workout-type number, not derived from runner HRmax.
2. `NoVdotPanel` mentions "+1 VDOT correction for solo effort" but the engine doesn't apply it.
3. `FuelingTile.carb_target_g_per_hr` from planner default, not doctrine.
4. `HydrationTile` numbers hand-inlined rather than imported.
5. `easyShare14d` denominator excludes `unknownMi` (good), but the dashboard headline `{easyPct}%` doesn't make this clear.
6. `HrZonesTile` displays point-estimate band edges from a Tanaka HRmax that has ±10 BPM SE.
7. **Long-run cap disagreement** between TrainingPulseTile and engine `longRunTarget`. (Most consequential of the six.)

**❓ Unverifiable from code alone:**
1. `VDOT_AGE_DECLINE_*` per-decade rates — Daniels-extrapolated; whether they match WMA tables for any specific runner is not directly testable from code.
2. `recoveryWindowEndsISO` math — distance-driven recovery durations match doctrine ranges, but whether the latest race's window correctly closes for a stacked-race scenario depends on specific dates in fixture data.

**✓ Correct (the bulk):** WeeklyMilesCard / YearMilesCard / RecentRunCard / ThisWeekTile / TodayTile / CoachTodayCard run prescription (excluding hrZone caveat) / Next30DaysTile / VdotTile (raw + tier + freshness + bands + age-graded) / TrainingPulseTile (8-week bars + delta + long-run avg + cap math + quality-vs-target + easy ratio) / ReadinessBanner / FuelingTile gel schedule / MileSplits / PhaseCards / PerPhaseTable / PerMileTable.

---

## 6. Gap analysis — high-value info we HAVE but don't show

### 6.1 Recovery protocols catalog (Research/00b)
The decision matrix landed (in `assessReadiness`). Still unwired:
- `POST_RACE_BY_DISTANCE` — graduated reverse-taper by 5K/10K/HM/M/50K/50mi/100K/100mi.
- `MARATHON_BIOMARKER_TIMELINE` — CK/myoglobin/IL-6/cortisol/inflammation timeline (~14 days for biomarker normalization).
- `REVERSE_TAPER_PROTOCOL` + `MARATHON_RECOVERY_4WK_REVERSE_TAPER` — day-by-day reverse-taper.
- `MULTI_RACE_CADENCE` — between-race spacing rules.
- `INCOMPLETE_RECOVERY_QUALITATIVE_SIGNALS` — emotional/subjective markers (mood, sleep quality, motivation).
- `CARBON_PLATE_RECOVERY_EFFECTS` — super-shoes raise muscle damage; recovery should extend.

### 6.2 Intensity distribution (Research/00a)
`PHASE_DISTRIBUTION_RECOMMENDATION` (pyramidal in base/build, polarized in peak), `VOLUME_MODEL_THRESHOLDS`, `NORWEGIAN_DOUBLE_THRESHOLD` defined and never imported.

### 6.3 Taper specifics (Research/08)
The 19 race-week constants are inert. PhaseGuidanceCard's TAPER copy references `TAPER_VOLUME_REDUCTION` + `TAPER_INTENSITY_PRESERVATION` + `TAPER_ERRORS` + `TAPER_BENEFIT` (from `taper.ts`) but doesn't pull race-week meal logistics, sleep banking, kit dress rehearsal, or race-day timeline.

### 6.4 Post-race reverse-taper UI (Research/00b)
Day-by-day reverse-taper visible to the runner in POST_RACE phase. Currently they see "Recovery — volume drop is by design" + a static ladder; doctrine has a granular per-day plan.

### 6.5 Hydration: unconsumed pieces of Research/19
- `SWEAT_RATE_PROTOCOL` — runner-specific sweat rate measurement.
- `EAH_RISK_FACTORS` — slow finish time, female, NSAID use, low body weight, excessive drinking.
- `SWEAT_SODIUM_CLASSIFICATIONS` — light/average/heavy salty sweater calibration.

### 6.6 HR zone systems beyond %HRmax-5 (Research/03)
Still unwired: `HRMAX_ZONES_7`, `KARVONEN_FORMULA` (HRR — uses RHR which the runner profile already collects), `LTHR_30MIN_TT_PROTOCOL`, `FRIEL_LTHR_ZONES`. **Karvonen is low-hanging fruit** — RHR is on the profile, formula is in doctrine, no consumer.

### 6.7 HR field-test protocols (Research/03)
`HRMAX_FIELD_TEST_PROTOCOLS` (3 protocols: McMillan flat-then-hill, 2400m TT, treadmill ramp). Profile asks for HRmax but doesn't tell the runner how to measure it.

### 6.8 Strength periodization (Research/07)
`STRENGTH_PERIODIZATION` mirrored by hand in `coach-principles.ts`. `HEAVY_RESISTANCE.primaryAdaptation: 'running_economy'` is a key insight (strength training raises economy, not VO2) — never surfaced.

### 6.9 Cross-training substitution (Research/09)
No XT logging / substitution path. `XT_DECISION_RULES`, `XT_CARRYOVER_MATRIX` defined and never imported.

### 6.10 Mental training (Research/20)
`GOAL_SETTING_FRAMEWORKS` (A/B/C goals), `PETTLEP_VISUALIZATION`, self-talk catalog, pre-race anxiety protocols, post-race blues, DNF rules, burnout warnings — all unused. Race entry still has a single `goalDisplay` string.

### 6.11 Travel + jet lag (Research/12)
`TRAVEL_ARRIVAL`, `EAST_WEST_ASYMMETRY` defined; no travel field anywhere on CoachState or race entry.

### 6.12 Sex-specific guidance beyond grading (Research/13)
Sex field used for VDOT cohort framing only. `MENSTRUAL_CYCLE_GUIDANCE`, RED-S screening, hormonal-contraception notes, iron deficiency — all unused.

### 6.13 Age-specific defaults (Research/14)
Age field drives age-graded VDOT (display) and Tanaka HRmax estimate. Engine prescription still has no age-aware logic — `AGE_DEFAULTS_BY_DECADE` is unused.

### 6.14 Wearable load metrics (Research/15)
TRIMP, TSS, monotony, strain, EWMA-ACWR all defined. App computes only rolling-avg ACWR.

### 6.15 Form / cadence (Research/16)
`/runs/[id]:231` shows cadence in spm but doesn't compare to a target band.

### 6.16 Plan template surface
`PLAN_TEMPLATES` is wired into the engine's day picker, but the **template itself is never shown to the user**. They see today + 4 days + a weekly grid + 30-day strip but cannot see "you're on the marathon-intermediate plan, week 8 of 16."

### 6.17 Race-prediction (Research/02)
Riegel / Cameron / McMillan never used. The brief comments on VDOT-implied finish but doesn't compare against Riegel-derived prediction at adjacent distances.

---

## 7. Gap analysis — info we WANT but don't have

### 7.1 New CoachState fields needed (server-side)
- **age, sex (server-side mirror of runner-profile.ts)** — required for AGE_DEFAULTS_BY_DECADE, sex-specific rules, hydration ml/kg/day, PRE_RACE_MEAL g/kg.
- **weight (kg)** — for hydration ml/kg/day, pre-race meal g/kg, sweat-rate-based intake.
- **HRmax + RHR (server-side mirror)** — replaces hardcoded 152 bpm in `coach-engine.ts:391`. Then engine prescriptions become per-runner.
- **Injury flag with type + onset date** — drives `injury_return.ts:WALK_RUN_PROTOCOL`.
- **Travel itinerary** — drives `travel.ts:TRAVEL_ARRIVAL`.
- **Long run day preference + days-running-per-week** — `app/profile/page.tsx` has UI but local-only.
- **Cycle log** (optional) — for `sex.ts:MENSTRUAL_CYCLE_GUIDANCE`.
- **Carb tolerance calibration (g/hr ceiling)** — type def mentions `carbToleranceDelta` in FuelingInput; no consumer writes/reads it.
- **HRV / RHR / sleep stream (HealthKit)** — fields exist on CoachState; `flags.healthKitAvailable: false` hardcoded.
- **Past TT results** — when a 5K time trial is run (engine plans them), there's no schema for "this was the TT result, here's the new VDOT anchor."

### 7.2 New research / doctrine areas
- **Day-of-week placement rules** — `defaultByDow` is hand-coded; no doctrine constant.
- **Goal-pace negotiation** — when goal is unrealistic vs VDOT, no escalation protocol.
- **Race-week carb-load by goal time** — Research/18 has 8-10 g/kg/day flat; doesn't differentiate by anticipated finish time.
- **5K time-trial-as-VDOT-update flow** — engine plans the test but doctrine doesn't define the "and once you finish it, here's what to do with the result" piece.

### 7.3 New UI surfaces (high level)
- **Plan overview page** — "your training plan, weeks 1-16."
- **Onboarding flow** — currently optional /profile.
- **Wired `/workout/[date]` page** — biggest placeholder removal.
- **Injury intake + RTR walk-run wizard** — WALK_RUN_PROTOCOL has 8 stages.
- **Travel planner** for upcoming races.
- **Retrospective view** for past races — `briefRaceMorning` adapts by horizon, but `retrospect` is stubbed.
- **Race-pace-strategy editor** — even / negative-split / even-effort.
- **Hydration personalization** — sweat-rate intake calculation.
- **Health page real data or removal of placeholder cards.**

### 7.4 Cross-references between existing pieces
- **Two daily-card surfaces still duplicate effort** (`page.tsx:CoachTodayCard` + `training/page.tsx:DailyBriefing`).
- **Two long-run-cap calculations** disagree.
- **Two phase concepts** (`lib/strava-stats.ts:trainingPulse().phase` vs `lib/coach-principles.ts:Phase`) — dashboard reconciles them but parallel taxonomy persists in `strava-stats.ts:172`.
- **Profile sex/HRmax are localStorage-only** — invisible to server-side coach.
- **`hydration.ts` doctrine constants** exist but the HydrationTile inlines its own copies.

---

## 8. PRODUCT REDESIGN — what each page SHOULD be

> "If we need to rethink the overview page, fine. If we have more info to add, great. etc. This is the time to really think about this app as a WHOLE. With the source of truth being this data and coach hub and everything spawning from that. One source of truth, tons of ways to use it."

This section is a license to redesign. The premise: a canonical RunnerHub backs every surface. Every page is a *view* over the hub. The hub knows everything — runner identity, training history, race calendar, recovery state, doctrine — and each page chooses what to expose, in what hierarchy, for what context.

The redesign aims for three things:
1. **Coherence** — every number traces back to one source. No more "the dashboard says 32-mile cap and the prescription says 28-mile long run."
2. **Hierarchy** — the runner's eye should know within 2 seconds where to look. Today's overview is a flat stack of equally-weighted tiles; the redesign installs a primary/secondary/tertiary structure.
3. **Insight, not data** — every tile says something about what the data MEANS. A 38.2 VDOT raw number isn't an insight. "Your fitness is in the 70th percentile for 32-year-old women, and trending up since the Pasadena half" is.

### 8a. Overview / Hub page (`/`)

#### What it is today

A flat 14-tile stack: Greeting → 4-up race/recent/weekly/year row → ThisWeek + Today row → CoachTodayCard (with embedded ReadinessBanner + run/strength prescriptions + DailyBrief + week-shape grid) → PhaseGuidanceCard → Next30DaysCard → VdotCard → HrZonesCard → RecoveryWidget → TrainingPulseTile → YearHeatmap → FunStats. Two thousand lines of React, every component inlined.

The information density is genuinely high — there are real numbers everywhere. But the flatness is the problem: nothing dominates. A runner who opens the app on race-day morning sees the same hierarchy as a runner who opens it on a recovery Tuesday. The tile that matters most for THIS runner THIS minute is buried somewhere in the middle.

#### The "first 5 seconds" question

What does the runner most need to see when they open the app cold?

The answer depends on **mode**. There are at least 6 distinct runner-states:

1. **Race-day morning** (race today) — what time is the gun, what's the weather, how do I feel, what's the goal, where's the brief.
2. **Race-week** (1-7 days out) — the brief, the weather forecast for race day, what to do today, am I tapering correctly.
3. **Build phase** (regular training, race in 14-100+ days) — what's today's workout, am I recovered, where am I in the plan.
4. **Just woke up after a hard run / quality day** — am I OK, is the readiness yellow or red, did I overdo it.
5. **Coming off a race** (POST_RACE phase) — recovery guidance, when can I train again, biomarker timeline.
6. **No race scheduled** (REBUILD or BASE without target) — what should I be doing, what's the foundation work.

The current overview shows ALL of these states with the same hierarchy. The redesign should pick the dominant context and elevate it.

#### Proposed hierarchy

**Tier 1 — the single hero tile (one and only one above the fold):**

The hero tile changes by mode:
- Race-day: race poster mini, gun time, weather, goal, brief paragraph, "READY" check.
- Race-week: race poster mini, days-out countdown, brief, weather forecast band.
- Build: today's workout — distance, type, pace target, voice paragraph, ready/yellow/red verdict.
- Recovery alert (yellow/red): the readiness verdict ELEVATES to hero, displacing today's workout below.
- POST_RACE: where you are in the recovery curve, what today permits, biomarker note.

The hero tile is wide, tall, centered. It has the runner's eye for as long as they need.

**Tier 2 — the context band (two tiles, side-by-side):**
- This week's shape (7-cell strip — what's done, what's next, today highlighted)
- Where you are in the plan ("Marathon-intermediate · Week 8 of 16 · BUILD")

**Tier 3 — the metric strip (4-up card row):**
- VDOT (with tier + freshness chip)
- 7-day mileage vs 4-week avg (ACWR-aware)
- Easy-share % (with phase target)
- Recovery readiness (one number, color-coded)

**Tier 4 — the look-ahead (one wide tile):**
- 30-day calendar showing build pattern + races + quality day rhythm.

**Tier 5 — explorers (collapsible):**
- HR zones (only renders when expanded)
- Phase guidance (only when in TAPER/POST_RACE/REBUILD)
- Year heatmap, fun stats, recovery widget.

#### The "?" affordance

Every number should have a tap-to-trace path. A `?` icon next to "VDOT 38.2" reveals the source race, the formula, the citation to Research/01. This solves the "where did this come from" question without bloating the tile.

#### Mode-aware composition

A `useRunnerMode()` hook returns `'race-day' | 'race-week' | 'build' | 'taper' | 'post-race' | 'rebuild' | 'base' | 'recovery-alert'` and the page composes accordingly. The same component library, different ordering.

#### Information density vs scannability

Today's overview has high density and low scannability. The proposed hierarchy keeps the density (we don't drop content) but stacks it: hero is large and slow-read, metric strip is dense and fast-scan, explorers are present-but-collapsed. The runner can dwell on the hero for 30 seconds, sweep the metric strip in 2 seconds, expand explorers when needed.

### 8b. Training page

#### What it is today

A "daily briefing" — masthead, big Oswald date, phase line, big Oswald workout title, two-column lead (voice paragraph + stats sidebar), 7-cell week-strip, next-up list, 12-week mileage chart. Reads `coach.workout.answer` from `/api/coach/today`. 672 lines.

It's a nicely-typeset variant of the dashboard's CoachTodayCard. **It is essentially redundant.** Two daily voice paragraphs, two week-shapes, two prescription views.

#### What it should be

The training page should be the runner's **macro view of their training**, not another micro view of today. Today's prescription belongs on the dashboard hero (section 8a). The training page should answer:

- Where am I in the season?
- What does the build pattern look like — mileage curve, intensity distribution over weeks?
- What workout types am I about to encounter?
- What does last 12 weeks look like as a story, not just a chart?
- Where's the quality-day rhythm — Tuesdays + Saturdays? Monday hills + Thursday tempo?

#### Proposed sections

**Section 1 — Plan masthead.** "Marathon-intermediate · Week 8 of 16 · BUILD phase · 14 weeks to Big Sur."

**Section 2 — Build curve.** A horizontal mileage chart spanning the entire training cycle (Weeks 1 → 16). Past weeks filled in actual, future weeks projected from the plan template. Vertical band for current week. Long-run bar overlay. This makes the *shape* of the build visible — the steady ramp, the cutback weeks, the taper.

**Section 3 — Quality day rhythm.** A 7-day-of-week × 8-week grid. Each cell is a small icon for that day's workout type. The visual pattern of "Tuesday tempo, Saturday long" emerges as vertical stripes of color. When the rhythm breaks, it's visible.

**Section 4 — Workout type breakdown.** A pie or stacked bar showing the share of miles in each type over the last 4 weeks. "62% easy / 18% MP / 12% threshold / 8% interval" — the runner sees their actual intensity distribution and can compare to phase target.

**Section 5 — Session library.** A scrollable list of every workout type the doctrine knows (16 RunWorkoutType slugs). Each opens to: definition, structure, when to use, cited research. Today's prescribed workout is pinned at top. Last attempt of each type is shown ("Threshold · last done 12 days ago · 5×1mi @ 6:32").

**Section 6 — 12-week timeline.** Replaces the bottom chart. A vertical timeline scrollable backward — every week is a row with the highest-quality session, total miles, long run, key moment ("PR at Pasadena Half"), and any notes.

**Section 7 — Next-up.** Compact next-4-days strip linking to /workout/[date].

The principle: **the training page is the season-and-pattern view; the dashboard is the today-and-readiness view.** They don't compete.

### 8c. Race detail page

#### What it is today

The richest page in the app. PosterCard with hero/map/narrative/4-up stats/inline goal-edit/phase legend/elevation chart. CoachBriefBlock embedded in the description column. PhaseCards. MileSplits. FuelingTile. HydrationTile. ResultSection (post-race). WeatherTile.

It's already good. The redesign question is: **what context is missing that a runner would want?**

#### Proposed additions

**Addition 1 — Similar past races run.** "You've run 4 marathons. Closest to this course profile: Big Sur 2024 (D+5,200 ft, ran 3:42:16, suffered 287). Your prior best on this terrain: 3:38:45." This is a `findSimilarRaces(state, currentRace)` query: distance ± 10%, elevation gain ± 20%, surface match, weather match.

**Addition 2 — Performance trajectory at this distance.** A small chart showing every prior race at this distance with finish time. Trendline. Predicted time from current VDOT × course adjustment. This frames the goal time in context.

**Addition 3 — Course-specific training implications.** "Big Sur has 5,200 ft of climbing in the second half. Your last 4 weeks include 2,800 ft of climbing. Doctrine says you want at least 60% of race elevation in your peak 4 weeks — you're at 54%." This pulls from `course.ts` doctrine + recent Strava elev gain.

**Addition 4 — A/B/C goals.** Replace the single `goalDisplay` string with three goal slots:
- A: ambitious (90th-percentile execution)
- B: realistic (median execution)
- C: floor (just-finish, minimum acceptable)

Each goal has its own pace card. The brief references whichever is appropriate to weather/conditions.

**Addition 5 — Travel + sleep banking.** When the race is away from home and start time differs, surface a small travel block: "2hr time change west → arrive 2 days early. Sleep window starts 5/12 evening." Pulls from `travel.ts` doctrine + race location.

**Addition 6 — The "I'm worried about ___" list.** Five common race-week worries pre-loaded:
- Stomach
- Pace discipline (going out too hot)
- The wall
- Weather surprise
- DNF risk

Each opens to doctrine-backed mitigation. Pre-race anxiety is universal; the app should name it.

**Addition 7 — Kit dress rehearsal.** A checklist of "wear this in your last 14-mile run" — race shoes, race singlet, race belt. Cited to race-week doctrine.

**Addition 8 — Post-race retrospective (when finished).** Currently the result section shows tables. Add a Coach-voiced retrospective paragraph — what worked, what didn't, what to take into the next build. This is the `coach.retrospect` stub finally wired.

The race-detail page becomes **end-to-end race lifecycle:** pre-race (course + brief + goals + worries + travel + kit) → race-day (gun-time-aware brief, hydration, fueling) → post-race (results + retrospective + recovery onset).

### 8d. Run detail page

#### What it is today

`/runs/[id]` — one Strava activity, one screen. Polyline, stats, shoe, best efforts, splits, description. Self-contained — no training context.

#### What it should be

Hooked to the hub, the run detail page can answer: **what was this run's PURPOSE, and did it serve that purpose?**

Proposed sections:

**Section 1 — Hero (existing, but with context chips).** Add chips above the title: "Tuesday threshold · Week 8 BUILD" / "Long run · 35% of weekly mileage" / "Recovery jog · post-race day 4." The chip pulls from the engine's prescription for that date if one existed.

**Section 2 — Plan vs actual.** When a prescription was on the books, show it side-by-side:
- Prescribed: 5×1mi @ 6:30/mi, 90s float, total 8 mi
- Actual: 4×1mi @ 6:34/mi (rep 5 cut, total 7.4 mi)
- Verdict: "Pace within band, volume short — were you struggling?"

**Section 3 — Where this run fits in the week.** A 7-cell mini week-strip with this day highlighted. Quick glance: "you ran Mon-Tue back-to-back, then this." Helps interpret the run's place.

**Section 4 — VDOT + pace bands at run-time.** "At your VDOT 38.2 (this week), threshold pace was 6:28-6:35/mi. You ran 6:32 average — bang in band." Cite Research/01. This makes pace bands feel like calibration, not arbitrary numbers.

**Section 5 — HR + cadence vs target.** Existing HR chart, plus a cadence-target overlay (Research/16: 170-180 spm easy, 180+ at threshold). Highlight cells outside band.

**Section 6 — Splits (existing).**

**Section 7 — Best efforts (existing) but with PR context.** "1mi PR at this pace ranked #2 of 14 attempts in last 12 months" — adds insight to the lonely "PR" badge.

**Section 8 — What follows.** "Next prescribed session: Wed easy 6mi. Recovery window opens 24hrs post-quality-day per Research/00b decision matrix."

**Section 9 — Description (existing).**

**Section 10 — Shoe (existing).**

The run detail page transitions from a "Strava-mirror" to "this run, in your training arc."

### 8e. Profile page

#### What it is today

Birth year, sex, HRmax, RHR (NEW). Long-run-day, days-running-per-week (local-only). Shoe closet (server-backed).

#### What it should capture

Beyond identity and shoes, profile should capture **everything the hub needs to personalize coaching**. The hub-as-backbone redesign demands the profile be richer.

Proposed sections:

**Section 1 — Identity.** Birth date (precise, not just year), sex, weight (kg), height. Weight enables hydration ml/kg/day, fueling g/kg, EAH risk factor. Height enables pace-by-height adjustments where relevant.

**Section 2 — Cardiovascular calibration.**
- HRmax (measured) + how + when measured.
- LTHR (measured via 30-min TT or estimated).
- RHR (measured, with weekly trend if HealthKit).
- HRV baseline (trended).
- "Calibrate" button → walks the runner through `HRMAX_FIELD_TEST_PROTOCOLS` (3 protocols from Research/03).

**Section 3 — Pace anchoring.**
- Last TT or race that anchored VDOT.
- "Test now" prompt → engine plans 5K TT for tomorrow's prescription.

**Section 4 — Training preferences.**
- Days running per week (3-7).
- Long run day (Sat / Sun / other).
- Quality day preferences (Tue+Sat / Wed+Sun / etc.).
- Surface preferences (road / trail / mix).
- Time-of-day preferences (morning / lunch / evening).
- Group/solo (some runners need scheduled group long runs).
- Treadmill access.
- Pool access (cross-training option).

**Section 5 — Goals & history.**
- Lifetime PRs at canonical distances.
- Career-best VDOT.
- Most-recent A-race + result.
- Stated season goal (race + target time).

**Section 6 — Health & flags.**
- Active injury (type, onset, restriction level).
- Chronic concerns (Achilles, plantar, knee — for monitoring).
- Allergies / GI sensitivities (gels, gluten — for fueling planner).
- Iron-deficiency history (for women: RED-S monitoring).

**Section 7 — Cycle (optional, gated by sex).**
- Last menstrual period.
- Cycle length.
- Symptom profile.
- Drives `MENSTRUAL_CYCLE_GUIDANCE` from Research/13.

**Section 8 — Travel & racing logistics.**
- Home location (city, timezone).
- Typical race travel mode (drive / fly).
- Sleep window.

**Section 9 — Equipment & shoes.**
- Existing shoe closet.
- Watch model (for HR sensor accuracy + HRV reliability).
- Foot pod / power meter (Stryd) availability.

**Section 10 — Connections.**
- Strava (existing).
- HealthKit (M2 future).
- Calendar (for race scheduling reminders).
- Coach (human coach handoff option, future).

The profile becomes the **user-editable surface of the RunnerHub**. Every server-side coach decision pulls from it. Today the hub has no runner identity; this is where that lives.

#### Onboarding

Today the runner must know to go to `/profile` to set birth year + sex + HRmax. There's no onboarding flow. Proposed: a 5-screen onboarding that runs once after Strava connect:

1. "Hi, I'm Runcino. Let's get to know you." → name + birth date + sex.
2. "What's your fastest recent race?" → pick from Strava-flagged races OR "race anything → 5K TT."
3. "How often do you train?" → days-per-week + long-run day.
4. "What's your next goal?" → race picker or "I just want to run consistently."
5. "How do you know your HRmax?" → measured / will-measure / estimate-from-age.

5 screens, 90 seconds, every subsequent surface gets richer.

### 8f. Health page

#### What it is today

Strava-driven HR + cadence + mileage trends (real). HealthKit grid placeholder (4 dashed cards, always `—`).

#### What it should be

With HealthKit assumed present (design-for-the-future), the health page becomes the **biometric truth surface**. Everything the hub knows about the runner's body, organized by what's most actionable.

Proposed sections:

**Section 1 — Recovery score (hero).** A single 0-100 number with the math visible:
```
Recovery 78 / 100
+ HRV last night within band (62 ms vs 28-day avg 64 ms)
+ Sleep 7.4 hrs
+ RHR 51 bpm (vs trailing avg 50)
+ ACWR 0.95 (in band)
- Strain yesterday (TSS 145)
```
The runner sees not just the number but the contributing signals. Cite Research/15.

**Section 2 — HRV trend.** 28-day chart, baseline band, last-night marker. Below: a sentence like "HRV stable — body is absorbing training load."

**Section 3 — RHR trend.** 28-day chart, baseline band, weekly average overlay. Sentence: "RHR up 3 bpm this week — possible early illness or overload."

**Section 4 — Sleep.** 28-day chart of nightly sleep + 7-day rolling avg. Comparison to phase target (Research/00b: 7-9 hrs in build, 9+ in taper).

**Section 5 — Training load.** ACWR (existing math) + TRIMP daily bars + monotony index + strain. Color-coded bands per Research/15.

**Section 6 — Body weight (when measured).** 28-day weight chart with hydration-aware noise tolerance. Race-day target band.

**Section 7 — Cycle phase (when applicable).** Where in the cycle, what symptoms to expect, training implications per Research/13.

**Section 8 — Illness markers.** Combined-signal early warning: HRV drop + RHR rise + sleep disruption → "possible illness onset." Pulls Research/15 illness-early-signals.

**Section 9 — Cadence trend (existing, deepened).** With cadence-target band per Research/16.

The health page becomes the **objective state-of-the-runner**. Where today is "Strava said HR last week was 145 avg," tomorrow is "your body is currently in X state and here's why."

### 8g. NEW pages worth adding

The user asked for at least 3. I propose 6, with rationale.

#### 8g.1 `/season` — Strategic race calendar

**Mission:** Show the runner's season as a strategic arc, not a list.

**Why:** The race index (`/races`) is a chronological list. It doesn't show season *shape*. A runner training for Big Sur in May after running Pasadena Half in February has a STORY: "build to Pasadena, recover, build to Big Sur, recover, rest summer, build to NYC in fall." That story is invisible today.

**What it shows:**
- A horizontal timeline spanning current month through 12-18 months out.
- Races plotted as poster-mini cards on the timeline.
- Between-race blocks colored by training phase (BASE/BUILD/PEAK/TAPER/POST_RACE).
- Conflict warnings when races are too close (per `MULTI_RACE_CADENCE` from Research/00b).
- Goal-A vs goal-B race tagging.
- Suggested race additions ("you have a 14-week gap between Big Sur and Sept — could fit a tune-up half").
- Rolling fitness curve overlay (projected VDOT) showing peaks/valleys.

**Hub dependencies:**
- `state.races.upcoming` (all upcoming, not just nextA)
- `state.races.recent` (past)
- `MULTI_RACE_CADENCE` doctrine
- VDOT projection forward (not currently computed)

**Why it's worth building:** Multi-race seasons are the runner's reality. The app currently treats every race as if it were the only race. The season page acknowledges that runners build *across* races.

#### 8g.2 `/research` — Browseable doctrine

**Mission:** Let the runner discover the research that backs every decision the coach makes.

**Why:** The Research/ folder is 24 files of high-quality content the runner pays for (in trust) but never sees. Citation snippets in tile expansions are tiny windows. A real research browser would be:
- A topic index (24 sections, with subsection drill-down).
- Search ("carb loading", "menstrual cycle", "altitude").
- "Coach used this for: ..." cross-references showing where each constant is consumed.
- "What I'm using right now" section showing the doctrine currently informing today's prescription.

**What it shows:**
- Top-level grid of 24 topic cards (Pace zones / Recovery / Heart rate / etc.)
- Each card opens to a stripped-down render of the Research/.md file.
- Side rail shows "Active for you right now" — the constants the coach is currently applying to your training.
- "How this applies to you" personalization hints inline.

**Hub dependencies:**
- Doctrine constants (already in `coach/doctrine`)
- `state` to determine "active for you" set

**Why it's worth building:** Trust is built by transparency. A runner who can read the Daniels VDOT formula in the app is a runner who trusts the coach more deeply. It also creates a self-education path — the app becomes a textbook the runner can study.

#### 8g.3 `/calibration` — All your dials on one canvas

**Mission:** Show every personalized setting in one place — pace zones, HR zones, fueling rate, hydration rate, taper depth — with how each was derived.

**Why:** Today these live in different surfaces (pace bands on VdotTile, HR zones on HrZonesTile, fueling on race detail, hydration on race detail). The runner can't see them as a coherent set of personal calibrations. A coach would.

**What it shows:**
- Pace zones (E/M/T/I/R) — band edges, source (VDOT or measured TT), confidence chip.
- HR zones (5-zone, 7-zone, Karvonen) — band edges, source, confidence.
- LTHR — measured or estimated, with field-test prompt.
- Fueling rate — g/hr default, GI tolerance ceiling, last calibration race.
- Hydration rate — ml/hr default, sweat-rate measurement (when done), salty-sweater tier.
- Cadence target — based on height/age/level.
- Long-run cap — Daniels +10% × phase ceiling, current cap.
- Easy-share target — phase-based.
- Taper depth — based on race priority + experience.

Each setting has:
- The current value
- The source ("from your VDOT 38.2 last anchored at Pasadena Half 2026-02-22")
- A "recalibrate" CTA when stale.
- The doctrine citation.

**Hub dependencies:** all of state + doctrine.

**Why it's worth building:** Calibration is the heart of personalized coaching. Right now calibration data is scattered. Putting it on one canvas is both useful (the runner can audit) and reassuring (every dial is set deliberately).

#### 8g.4 `/patterns` — Recurring patterns in your training

**Mission:** Surface the runner's habits — the patterns they don't see themselves.

**Why:** Coaches notice things athletes don't: "you skip Wednesday tempos when you've had a Tuesday meeting" or "you push too hard the week before a cutback" or "you've never done a 22-mile long run without a niggle the next week." The app has the data; it should make the patterns visible.

**What it shows:**
- Day-of-week completion rate. "Tuesday workouts: 89% completed. Friday workouts: 41% completed. You skip Fridays."
- Workout-type completion. "Threshold workouts: 73% completed. Easy days: 96%. Threshold is your hardest sell."
- Pre-race patterns. "In your last 4 race weeks: avg 22% volume cut, expected 30%. You under-taper."
- Recovery patterns. "After every marathon you ran, you ran 14 miles within the first 5 days. Doctrine says wait 7."
- Streak/break patterns. "You break streaks after 12 days. Average run-streak: 11 days."
- Niggle patterns. "Achilles flares after 3 consecutive long runs. You've done this 4 times."

**Hub dependencies:**
- 12-month Strava history
- Past race results
- Logged niggles (would need new schema)
- Engine prescription history (what was prescribed vs what got done)

**Why it's worth building:** The athlete sees individual runs. The coach sees patterns. The patterns page is the coach's eye, surfaced. This is high-leverage because patterns inform the COACH'S NEXT PRESCRIPTION, not just the runner's awareness.

#### 8g.5 `/today` — A radically simple "just tell me what to do" view

**Mission:** When a runner just wants to know "what am I doing today," give them ONE answer in three seconds.

**Why:** The dashboard, even after the redesign, is dense. There are days when the runner just wants the smallest possible "today" view — gun-and-go.

**What it shows:**
- Big workout title (Threshold · 5×1mi).
- One-sentence description.
- Pace target. HR ceiling. Distance.
- Voice paragraph (one short paragraph).
- "Open detailed view" link.
- That's it.

This is the dashboard's hero tile, full-screen, minimal chrome. Probably accessed via a `/today` URL bookmarked on the watch face or home screen. It's not the dashboard — it's a focused command surface.

**Hub dependencies:** `coach.workout.answer` for today.

**Why it's worth building:** Cognitive load on race-day mornings or hard-Tuesday mornings is high. A runner doesn't always want to read the dashboard. This is the "mug of coffee, what am I doing" view.

#### 8g.6 `/library` — Workout type & session library

**Mission:** Browseable library of every workout type the doctrine knows.

**Why:** Today the runner sees a workout type *prescribed* but can't browse "what is a sub-threshold run, when do I do one, what's the structure." The library is the answer.

**What it shows:**
- 16 workout types (every `RunWorkoutType` slug + future additions).
- Each type opens to:
  - Definition + when used.
  - Standard structure (warm-up + main + cool-down with rep schemes).
  - Pace target derivation (from VDOT).
  - HR target band.
  - Cited research section.
  - Last time you did one ("12 days ago, 5×1mi @ 6:32, splits attached").
  - "Coach can prescribe one tomorrow" CTA when applicable.

**Hub dependencies:**
- Doctrine: `workouts.ts` + `coach-workouts.ts` palette.
- `state`: history of past attempts.

**Why it's worth building:** The runner doesn't have to wait for the coach to prescribe a session to learn what it is. Self-directed learning. Also feeds onboarding ("here's the vocabulary").

### 8h. Cross-cutting redesign principles

These are the design rules that govern every surface, given the hub-as-backbone architecture.

#### Principle 1 — Every number traces back to its source

Every numeric value on screen has a `?` affordance that reveals:
- The source (e.g., "From Strava activity 'Pasadena Half'")
- The formula (e.g., "VDOT = lookup(13.109 mi, 1:35:00)")
- The citation (e.g., "Research/01 §2.3")

This is non-negotiable for trust. A runner who can't answer "where does this number come from" can't trust the app deeply.

#### Principle 2 — Everything updates atomically

When data refreshes (Strava sync, race added, profile changed), the visual cue is a soft pulse on every affected number — not a global "loading" state. The runner sees what changed and what didn't.

Implementation: subscribe to `RunnerHub.changes$` and animate the affected DOM cells.

#### Principle 3 — Insight, not just data

Every tile says something about what the data MEANS, not just shows the number. Compare:

Today: `38.2 VDOT`

Proposed: `38.2 VDOT — INTERMEDIATE tier · 70th percentile for women age 30-35 · trending up since 02-22 (+1.1 VDOT)`.

The data is the same. The insight is added. This is the difference between a dashboard and a coach.

#### Principle 4 — Connections are visible

When stat A depends on stat B, show the linkage. Hover (or tap-and-hold) on a derived number → the source numbers light up. Hover on the easy-share % → the runs that contributed light up. Hover on the long-run cap → the longest recent run lights up.

This makes the data graph navigable rather than opaque.

#### Principle 5 — Modes shape composition, not new pages

We don't add a /race-day page or a /post-race page. The existing pages re-compose by mode. The dashboard's hero is different on race-day; the race-detail page elevates the post-race retrospective when the race has finished. Same surfaces, different priorities.

#### Principle 6 — Empty states are coaching moments

When data is missing — no VDOT, no Strava, no profile — the empty state is a coach's prompt: "Set up your VDOT in 30 seconds — pick a recent race and we'll do the math." Empty states are the most-leverage onboarding surface.

#### Principle 7 — Mobile-first, but desktop-aware

All current surfaces are desktop-aspect tiles. Mobile is treated as "scaled-down desktop." A real mobile redesign would re-stack: hero full-width, metric strip vertical, secondary collapsed. The hub-as-backbone makes mobile a different *composition* of the same data.

#### Principle 8 — Voice is consistent

The voice paragraph (engine deterministic + LLM polish) is one of the app's strongest assets. Voice should appear:
- In the dashboard hero
- In the brief on race detail
- In the run-detail "what was this run for" sentence
- In the pattern page narration ("you skip Fridays")
- In the retrospective post-race
- NOT in the calibration / library / season pages where data is the point.

Voice creates trust. Voice everywhere creates noise.

#### Principle 9 — Doctrine drift is caught at build time

Every place that uses a doctrine number imports the constant. Inline numbers fail typecheck (or fail an import-graph audit). The HydrationTile + FuelingTile inline-number antipattern is the canary; eliminating it is the doctrine integrity fix.

#### Principle 10 — Stale data is labeled, not hidden

A VDOT from 12 weeks ago shows a STALE chip. A weather forecast from yesterday shows a YESTERDAY chip. A profile field unset for 6 months shows a STALE chip. The runner should never see a number without knowing how fresh it is.

### 8i. The "professional running coach" question

What does a great human running coach do that this app doesn't?

I've spent some time imagining a real coach — Coach Martha, 30 years experience, her main client is a 32-year-old woman targeting Big Sur in May, currently 14 weeks out, BUILD phase. What does Martha do that the app doesn't?

#### Coach Martha's Tuesday morning ritual

She opens her client list. Each client has a notebook. She reviews:
- What did the athlete RUN this week (Strava-equivalent).
- Did the athlete COMPLETE the prescription (yes / no / modified).
- How does the athlete FEEL (text from athlete: "legs heavy, slept badly").
- What's the next 7 days look like.
- Are there any RED FLAGS (HR up, pace down, missed a workout, mentioned an niggle).

She writes back a paragraph: "Tuesday tempo went well — pace was right, HR slightly elevated, attribute to heat. Take Wed easy-as-needed. Long run Saturday at 18 mi keeping easy ratio above 80%. No threshold this week, focusing on aerobic depth. Sleep is showing up as fatigue — try to add 30 min."

#### What the app does well that mirrors Martha

- The voice paragraph (CoachDailyBrief) IS the Martha-paragraph in deterministic form.
- The readiness banner mirrors "are there red flags."
- The week-shape mirrors "what does the next 7 days look like."

#### What Martha does that the app doesn't

**1. She asks how the athlete FEELS.** No subjective input. The app has Strava data (objective) but never asks "did that workout feel hard." The 1-10 RPE per session is the single highest-leverage missing input. Doctrine 00b's `INCOMPLETE_RECOVERY_QUALITATIVE_SIGNALS` is exactly this and it's unused.

**2. She remembers context across weeks.** Martha knows her athlete had a hard work week, that her cycle is in luteal phase, that she's worried about her IT band. The app has no persistent memory of these qualitative threads.

**3. She negotiates goals.** When the athlete says "I want to run 3:15 at Big Sur," Martha says "based on your VDOT, 3:25 is realistic, 3:15 would require X, and we should pick A/B/C goals." The app accepts a single `goalDisplay` and never pushes back.

**4. She prescribes adaptations on the fly.** When the athlete texts "knee aches today," Martha says "swap the threshold for a swim, ice tonight, see how Wednesday feels." The `coach.adjustForReality` interface anticipates this — it's a stub.

**5. She talks about FEAR.** Race anxiety, post-race blues, plateau frustration. Martha names these. The app's voice paragraph stays operational ("threshold today") and skips the emotional layer entirely.

**6. She uses long arcs.** Martha thinks "this athlete needs a strength block in May, then a base in June, peaking for NYC." The app's horizon is the next race plus 30 days. Multi-race seasons (section 8g.1) are necessary to think Martha-style.

**7. She catches RED-S, iron deficiency, RED FLAGS.** Martha asks about cycles for female athletes, about diet, about energy availability. Doctrine has this; the app collects sex but not cycle, weight but not body composition.

**8. She hand-calibrates pace zones for the athlete's history.** Martha knows "this athlete runs hot — her HR is always 8 BPM higher than the chart says." The app has no per-runner offset for any of its calibration constants.

**9. She knows her athlete's running history before the relationship started.** Martha learns the PR list, the worst race, the best race, the marathon where she bonked at mile 21. The app has only what's in Strava since connect.

**10. She SETS BOUNDARIES.** Martha says "no, you cannot race two marathons three weeks apart." She refuses. The app accepts every race the runner enters with no resistance.

#### The experiential redesigns this implies

- **A "how did that feel" prompt** after every prescribed workout (and ad-hoc Strava run). 1-tap RPE 1-10 + one-line text. Stored on the activity. Available to the brief next day.
- **A "concerns" text input** on the dashboard — a single field updated weekly. "Knee feels off." "Sleep has been bad." Brief reads it.
- **Goal negotiation flow** — when goal is unrealistic vs VDOT, surface "goal feels ambitious — let's talk about A/B/C goals."
- **An "I'm hurt" button** — initiates injury intake + WALK_RUN_PROTOCOL.
- **Pre-race anxiety mode** — race-week brief includes mental-training cues from Research/20.
- **Post-race blues mode** — POST_RACE phase brief mentions "the post-race low is normal."
- **Multi-race conflict warnings** — when adding a race that conflicts with existing one's recovery window.
- **History import** — onboarding asks "any historical races to import" with a paste-table-of-PRs option.
- **Per-runner calibration overrides** — explicit "I run hot" / "I run cold" toggles that offset HR-based gating.

The mecca-gap section (6, 7) is research-backed insights. This is the *experiential* layer on top — the things a coach does that ISN'T just doctrine recitation. It's pattern-noticing, memory, empathy, negotiation, fear-naming, boundary-setting.

### 8j. Concrete page-by-page redesign sketches

For each of the 7 existing pages plus the 6 proposed new pages, here is:

- One-line mission
- Top 3 pieces of information (in priority order)
- Hub data dependencies
- What it currently is vs what it should be
- A 5-10 line ASCII sketch of the proposed layout

#### 8j.1 `/` Overview (existing, redesign)

**Mission:** Show the runner what matters most right now, no scrolling required.

**Top 3:**
1. The hero answer for THIS mode (today's workout / race brief / readiness alert).
2. Today's place in the week + this week's place in the season.
3. The 4 critical metrics (VDOT, weekly mi+ACWR, easy-share, recovery).

**Hub deps:** all of state.

**Currently:** flat 14-tile stack, equally weighted. Hero is implicit — there isn't one.
**Should be:** tiered hierarchy with a single hero per mode.

**ASCII sketch (BUILD mode, regular Tuesday morning):**
```
┌──────────────── HERO ────────────────┐
│  TODAY · Threshold · 5×1mi @ 6:30/mi  │
│  [voice paragraph, 3 lines]           │
│  🟢 READY · 8 mi · 58 min · HR ≤ 160  │
│  [ start workout ▶ ]   [ swap ▼ ]     │
└──────────────────────────────────────┘
┌──── WEEK ────┐ ┌──── PLAN ────┐
│ M T W T F S S│ │ MARATHON-INT │
│ ●·▶·░·░·░·▼·░│ │ Wk 8 of 16   │
└──────────────┘ └──────────────┘
┌──VDOT──┬──MI──┬──EASY──┬──RDY──┐
│  38.2  │ 32 │   78%   │  78  │
│ 02-22  │+12%│  ≥ 80%  │ /100 │
└────────┴────┴─────────┴──────┘
┌──────── NEXT 30 DAYS ──────────┐
│ ▁▂▃░▁▂▄▁▂▃░▂▂▄░▁▂▂░▁▂▂▄░▁▂▂  │
└──────────────────────────────┘
[ EXPLORERS · tap to expand: HR zones · phase guidance · year heatmap · fun stats ]
```

**ASCII sketch (RACE-DAY mode, Big Sur morning):**
```
┌──────────────── HERO ────────────────┐
│  RACE DAY · Big Sur Marathon          │
│  6:45 AM · gun in 2h 14min            │
│  Weather: 56°F · DP 48 · wind 8mph N  │
│  Goal A: 3:25 · pace 7:50/mi          │
│  [voice paragraph: race-morning]      │
│  [ READINESS · GREEN · gut: ok ]      │
│  [ open detailed brief ▶ ]            │
└──────────────────────────────────────┘
┌── HYDRATION ──┐ ┌── FUEL ──┐ ┌── PHASES ──┐
│ pre-race plan │ │ 6 gels    │ │ 1: 0-7   │
│ 480 ml/hr     │ │ 3 caf     │ │ 2: 7-21  │
│ during        │ │ 80 g/hr   │ │ 3: 21-26 │
└──────────────┘ └──────────┘ └────────────┘
[ COURSE · MILE-BY-MILE · KIT CHECK ▶ ]
```

**ASCII sketch (RECOVERY-ALERT mode, yellow readiness):**
```
┌──────────── HERO (readiness elevated) ────────────┐
│  ⚠️ READINESS · YELLOW                              │
│  ACWR 1.42 (band 0.8-1.3) · easy share 64%         │
│  Signals: heavy block · easy imbalance              │
│  Action: 24-48h easy-only window                    │
│  [voice paragraph, with citation to Research/00b]   │
└──────────────────────────────────────────────────┘
┌──── TODAY (demoted) ────┐ ┌──── WEEK ────┐
│ EASY 5mi · pace 9:15+   │ │ M·T·W·T·F·S·S │
│ [WAS: threshold, swapped]│ │ ●·▶·░·░·░·▼·░ │
└──────────────────────────┘ └──────────────┘
[continued: metric strip, 30-day, etc.]
```

**ASCII sketch (POST_RACE mode, day 4 after marathon):**
```
┌──────────── HERO (recovery centerpiece) ────────────┐
│  RECOVERY · DAY 4 of ~14                             │
│  Last race: Big Sur Marathon · 5/15 · 3:28:42        │
│  Where you are: STAGE 2 · light easy permitted       │
│  Today: 30-min easy or rest                          │
│  Biomarker note: CK still elevated, energy +good     │
│  [voice paragraph: post-race]                        │
└─────────────────────────────────────────────────────┘
RECOVERY CURVE             PHASE GUIDANCE
[chart: rest → walk → easy] [POST_RACE doctrine]

[continued: metric strip dimmed, plan resumes day 8-10]
```

**The mode dispatcher:**
```ts
function useRunnerMode(state: CoachState): RunnerMode {
  if (state.races.todayIsRace) return 'race-day';
  if (state.daysToNextA <= 7 && state.daysToNextA > 0) return 'race-week';
  if (state.recovery.inRecoveryWindow) return 'post-race';
  if (state.readiness.level === 'yellow') return 'recovery-alert-yellow';
  if (state.readiness.level === 'red') return 'recovery-alert-red';
  if (state.phase === 'TAPER') return 'taper';
  if (!state.races.nextA) return 'base';
  return 'build';
}
```

The dispatcher returns one of 8-10 modes; the page renders the matching layout. Same components, different priorities. The dashboard becomes a *router* over its own data.

#### 8j.2 `/training` (existing, redesign)

**Mission:** Show the runner the SHAPE of their training season.

**Top 3:**
1. Where you are in the plan (Week N of M, with phase chip + days-to-A-race).
2. The build curve (mileage + intensity over the entire cycle).
3. Workout-type rhythm (which days = which colors, over weeks).

**Hub deps:** plan template, weekly history (Strava-derived), prescriptions past + future.

**Currently:** redundant daily briefing — voice-lead + week-strip + 12-week chart, all duplicated from dashboard.
**Should be:** macro-view of the season. The training page is where you study the arc of your training.

**ASCII sketch:**
```
MARATHON-INTERMEDIATE · WEEK 8 OF 16 · BUILD · 56 DAYS TO BIG SUR

BUILD CURVE
┌─────────────────────────────────────────────┐
│ 50│                                ▄▄▄       │
│ 40│                       ▄▄▄  ▄▄▄        │
│ 30│              ▄▄▄  ▄▄▄                ▄│
│ 20│      ▄▄▄ ▄▄▄                          │
│ 10│ ▄▄▄                                    │
│  0└─wk1─2─3─4─5─6─7─◆─9─10─11─12─13─14─15─16│
│       BASE      BUILD   PEAK   TAPER   RACE  │
│   filled past · projected future · current ◆ │
└─────────────────────────────────────────────┘

QUALITY-DAY RHYTHM (last 8 weeks)
       Mon  Tue  Wed  Thu  Fri  Sat  Sun
Wk 1   ░    T    ░    ░    ░    L    ░
Wk 2   ░    T    ░    ░    ░    L    ░
Wk 3   ░    T    ░    I    ░    L    ░
Wk 4   ░    T    ░    ░    ░    L    ░    (cutback)
Wk 5   ░    T    ░    I    ░    L    ░
Wk 6   ░    T    ░    I    ░    L    ░
Wk 7   ░    T    ░    I    ░    L+   ░    (peak long 18mi)
Wk 8   ░    T◆   ░    ░    ░    L    ░    THIS WEEK
        T = threshold  I = interval  L = long  L+ = peak long
        Pattern is consistent: Tue+Sat. Thu interval added in week 3.

INTENSITY DISTRIBUTION (rolling 4 weeks)         vs PHASE TARGET
██████████████████████████████ 62% easy           ≥ 75% (slight gap)
████████████ 18% MP                               10-15% (slight over)
████████ 12% threshold                            10-12% (in band)
████ 8% interval                                  3-8% (in band)
[doctrine: Research/00a pyramidal in BUILD]

SESSION LIBRARY (16 types · click to drill)
[Easy] [Recovery] [Long steady] [Long progression] [Long MP block]
[Long fast finish] [Threshold] [Tempo] [Sub-threshold] [VO2]
[MP-specific] [MP combo] [MP long] [Strides] [Hills] [Race]

YOUR LAST 12 WEEKS (vertical timeline · scrollable)
WK 8 May 4   ─ 32 mi · 1Q · L 18 mi · TUES THRESHOLD 5×1mi @ 6:34
WK 7 Apr 27  ─ 38 mi · 2Q · L 18 mi · PEAK LONG · "felt strong"
WK 6 Apr 20  ─ 36 mi · 2Q · L 16 mi · interval Thu was hard
WK 5 Apr 13  ─ 34 mi · 2Q · L 15 mi
WK 4 Apr 6   ─ 26 mi · 1Q · L 12 mi · CUTBACK
WK 3 Mar 30  ─ 32 mi · 2Q · L 14 mi
[continues...]

NEXT-UP (compact, links to /workout/[date])
Tue T threshold 5×1mi @ 6:30  ◆ today
Wed easy 6mi
Thu rest  
Fri easy 4mi + strides
Sat L long 16mi
```

**Mechanics worth noting:**

The build curve is the most important chart in the app. It shows the *story* of the training: ramp, cutbacks, peak, taper. A runner who can see "I'm 8 of 16 weeks in, I should be near peak mileage soon" understands their position. The chart is filled past + projected future, with the current week highlighted.

The quality-day rhythm grid is high-leverage because it makes consistency *visible*. A runner who skips Wednesday tempos sees an 8-week column of partially-filled Wednesday cells. The pattern isn't anecdote anymore.

The intensity distribution band shows polarized vs pyramidal vs threshold. Research/00a says BUILD = pyramidal target. The runner sees their distribution against doctrine in real-time.

The session library at the bottom is a teaser for `/library` (section 8g.6); on the training page it's a compact strip with click-through.

#### 8j.2.5 Notes on the training-page redesign

A few open design questions worth noting:

- **Should the build curve be editable?** A runner who sees a projected dip might want to push back. Edit-mode could allow week-by-week mileage adjustment. v1: read-only. v2: editable.
- **Cutback weeks need clearer color coding.** Today's runner sees just "lower bar"; the redesigned curve should call out cutbacks as a distinct shade.
- **The quality-day grid is dense.** Consider a vertical-stripe view for runners with simple Tue+Sat patterns vs a heat-map for runners with varied schedules.
- **Plan-template selection is invisible today.** The training page is the place to expose "you're on this template; switch to X" — plan_templates.ts has `marathon_intermediate`, `marathon_advanced`, `half_intermediate` etc.

#### 8j.3 `/races/[slug]` (existing, expand)

**Mission:** End-to-end race lifecycle on one page.

**Top 3:**
1. The race poster (existing) + brief.
2. A/B/C goals + fueling + hydration + weather.
3. Course-specific training implications + similar past races.

**Hub deps:** race + state + course doctrine + travel doctrine.

**Currently:** rich pre-race + result tables.
**Should be:** add similar-races, A/B/C goals, course-implications, kit checklist, travel/sleep, post-race retrospective.

**ASCII sketch:**
```
┌────────────────── POSTER ──────────────────┐
│  BIG SUR INTERNATIONAL MARATHON              │
│  May 15, 2026 · 14 days out                  │
│  [hero image + course map]                   │
│  [narrative: history, vibe, vibe, vibe]      │
│  26.2 mi · D+5,200ft · road · point-to-point │
│                                              │
│  GOALS                                       │
│  A: 3:15:00  pace 7:26/mi  (ambitious)       │
│  B: 3:25:00  pace 7:50/mi  (realistic) ◆     │
│  C: 3:35:00  pace 8:13/mi  (floor)           │
└──────────────────────────────────────────────┘

COACH BRIEF · 14 days out · approach
[voice paragraph, 3-5 sentences]
[ ▸ WHY? expand for citations ]

WEATHER · NOAA forecast (when ≤7d) / Open-Meteo historical (else)
┌─────────────────────────────────┐
│ Race start 6:45 AM              │
│ 56°F · DP 48 · wind 8mph N      │
│ Heat factor 0%                  │
│ Confidence: HIGH (7-day forecast│
└─────────────────────────────────┘

PHASES                          MILE SPLITS
┌──────────────────────┐       ┌────────────────────┐
│ 1 · 0-7 mi · 7:48     │       │ Mi 1: 7:50         │
│ 2 · 7-21 mi · 7:50    │       │ Mi 2: 7:48         │
│ 3 · 21-26 mi · 7:55   │       │ ...                │
└──────────────────────┘       └────────────────────┘

FUELING                         HYDRATION
┌──────────────────────┐       ┌────────────────────┐
│ 6 gels @ 22g each    │       │ 24h pre: 35ml/kg   │
│ 3 caffeine           │       │ 2-4h pre: 5-7 ml/kg│
│ 80 g/hr              │       │ Final hr: 200ml    │
│ Schedule: mi 4,8...  │       │ During: 480 ml/hr  │
└──────────────────────┘       └────────────────────┘

NEW SECTIONS BELOW

SIMILAR PAST RACES (NEW)                    COURSE TRAINING (NEW)
┌────────────────────────────────┐         ┌──────────────────────────┐
│ Big Sur 2024 · D+5200          │         │ This course: 5,200 ft     │
│   3:42:16 · suffer 287 (high)  │         │ Last 4w climb: 2,800 ft   │
│ Pasadena 2026 · flat           │         │ Doctrine target: 60% race│
│   1:35:00 · current VDOT 38.2  │         │ You: 54% · slight gap    │
│ → predicted Big Sur: 3:25:30   │         │ Suggest: 1 hilly LR/wk   │
└────────────────────────────────┘         └──────────────────────────┘

A/B/C GOAL DETAIL                          KIT REHEARSAL (NEW)
┌────────────────────────────────┐         ┌──────────────────────────┐
│ A · 3:15 ── 78% confidence low │         │ [✓] Race shoes (LR 4/27)  │
│   Requires: 0 weather slowdown │         │ [✓] Race singlet          │
│   Fueling: 90 g/hr push        │         │ [ ] Race belt + gels      │
│ B · 3:25 ── 78% confidence high│         │ [ ] Headband / arm band   │
│   Standard execution           │         │ [ ] Watch face: race mode │
│ C · 3:35 ── floor / float      │         │ [ ] Bib + safety pins     │
│   Bail option                  │         └──────────────────────────┘
└────────────────────────────────┘

TRAVEL & SLEEP (NEW)                       I'M WORRIED ABOUT (NEW)
┌────────────────────────────────┐         ┌──────────────────────────┐
│ Drive · LA → Carmel · 5h        │         │ [ ] Stomach (GI)          │
│ Fly out · n/a                   │         │ [ ] Going out too hot     │
│ Arrive: Fri 5/13 evening        │         │ [ ] Hitting the wall      │
│ Sleep window: 5/12 onward       │         │ [ ] Weather surprise      │
│ Time zone: same · no jet lag    │         │ [ ] DNF pressure          │
│ Doctrine §12: 1+ days early     │         │ Tap each → mitigation card│
└────────────────────────────────┘         └──────────────────────────┘

WHEN POST-RACE
┌────────────────────────────────┐         ┌──────────────────────────┐
│ RESULT                          │         │ RETROSPECTIVE (NEW · wired│
│ [plan vs actual phase table]    │         │ to coach.retrospect)      │
│ [per-mile splits]               │         │ [voice paragraph: what    │
│ Suffer / kudos / achievements   │         │  worked, what didn't, what│
└────────────────────────────────┘         │  to take into next build] │
                                            └──────────────────────────┘
```

**Mechanics worth noting:**

The race detail page becomes the *full lifecycle* of a race — pre-race (course + brief + goals + worries + travel + kit) → race-day (gun-time-aware brief, fueling, hydration) → post-race (results + retrospective + recovery onset). Today the page is excellent at pre-race; the additions extend it backward (similar past races, course implications) and forward (retrospective).

The A/B/C goals replace the single goalDisplay string. The runner sees three goals with confidence ranges. The brief picks the appropriate goal to reference based on weather/conditions. This is the doctrine 20 (mental.ts:GOAL_SETTING_FRAMEWORKS) finally surfaced.

The "I'm worried about" list is the experiential layer (section 8i) made concrete. Five common worries, each with doctrine-backed mitigation. Pre-race anxiety is universal; the app should name it.

The kit checklist is the race-week doctrine (`race_week.ts`) finally surfaced. The "wear in your last LR" prompt is doctrine §8.

The retrospective post-race wires `coach.retrospect` (currently stub). It's a Coach-voiced paragraph: "what worked, what didn't, what to take into next build."

#### 8j.4 `/runs/[id]` (existing, expand)

**Mission:** Place this run in the training arc.

**Top 3:**
1. What was this run's purpose (prescription + actual + verdict).
2. Where it fits in the week.
3. Plan-vs-actual on pace + HR + cadence + distance.

**Hub deps:** Strava activity + engine prescription history + VDOT-at-time.

**Currently:** Strava-mirror.
**Should be:** Run-in-context.

**ASCII sketch:**
```
TUE MAY 5 · THRESHOLD · WK 8 BUILD · BIG SUR

┌─────────────── HERO ─────────────────────────────┐
│  THRESHOLD · 5×1mi attempt                        │
│  7.4 mi · 49:23 · 6:38/mi avg · HR 158 avg       │
│                                                   │
│  PRESCRIBED: 5×1mi @ 6:30, 90s float, 8.0 mi tot │
│  ACTUAL:     4×1mi @ 6:34, 90s float, 7.4 mi tot │
│                                                   │
│  VERDICT: PACE ON · VOLUME SHORT (1 rep cut)      │
│  [voice paragraph: "rep 5 cut — were legs heavy?] │
└──────────────────────────────────────────────────┘

WHERE THIS FITS IN THE WEEK         ROUTE
┌──────────────────────────┐        ┌──────────────────┐
│ M  T  W  T  F  S  S       │        │ [polyline · LA]  │
│ E  ▶  ?  ?  ?  L  ?       │        │ [elev profile]    │
│  ◆ today                  │        └──────────────────┘
│ Wed = easy / Thu = rest   │
│ Sat = long 16mi           │
└──────────────────────────┘

PACE CONTEXT (VDOT 38.2)            HR + CADENCE OVERLAY
┌──────────────────────────┐        ┌──────────────────┐
│ T pace band: 6:28-6:35/mi│        │ [chart]           │
│ You ran:     6:34 ✓ in   │        │ HR avg: 158       │
│ M pace:      7:32-7:48   │        │   target ≤ 168    │
│ E pace:      8:50-9:30   │        │ cadence: 178 spm  │
└──────────────────────────┘        │   target ≥ 175 ✓  │
                                    └──────────────────┘

PER-MILE SPLITS                     BEST EFFORTS
┌────────────────────────────┐      ┌──────────────────┐
│ Mi 1 · 8:34 (WU)            │      │ 1 mi · 6:32 · #2  │
│ Mi 2 · 6:34 (rep 1)         │      │ 5K · 22:18 · #5   │
│ Mi 3 · 6:36 (rep 2)         │      │ 10K · n/a         │
│ Mi 4 · 6:32 (rep 3)         │      └──────────────────┘
│ Mi 5 · 6:36 (rep 4)         │
│ Mi 6 · 8:50 (CD)            │
│ Mi 7 · 9:00 (CD)            │
└────────────────────────────┘

WHAT FOLLOWS                        DESCRIPTION
┌────────────────────────────┐      ┌──────────────────┐
│ Wed · easy 6mi               │     │ [Strava text]    │
│ Recovery window: 24hr open  │      │                  │
│ Back to quality Sat (long)  │      │                  │
└────────────────────────────┘      └──────────────────┘

SHOE
┌────────────────────────────┐
│ Endorphin Speed 4 · 347mi   │
│ Cap 400mi · 87% used        │
└────────────────────────────┘
```

**Mechanics worth noting:**

The hero answers the most important question: "what was this run FOR, and did it serve that purpose?" Today's `/runs/[id]` answers neither. With prescription history on the hub, both questions are answerable.

The pace context tile makes pace bands a *calibration* not just a number. A runner who sees "you ran 6:34, threshold band is 6:28-6:35" trusts the band more than one who sees just "T pace: 6:30/mi" abstract.

The cadence overlay is doctrine 16 (Research/16) finally surfaced. The runner sees their cadence vs target band — easy money.

The "what follows" tile is the run-detail page acknowledging it lives in a flow. The current page is a self-contained leaf; the redesign threads it back into training arc.

#### 8j.5 `/profile` (existing, expand)

**Mission:** All runner identity, every dial the coach can pull.

**Top 3:**
1. Identity + cardio (age, sex, weight, HRmax, RHR, LTHR).
2. Training preferences + goals.
3. Health flags + cycle (where applicable) + connections.

**Hub deps:** runner-profile (server-side mirror) + connected services.

**Currently:** age + sex + HRmax + RHR + shoes.
**Should be:** full identity surface (Section 8e).

**ASCII sketch:**
```
ATHLETE PROFILE
┌─────────────── IDENTITY ────────────────┐  ┌──────── CARDIO ─────────┐
│ Name      Maria Chen                     │  │ HRmax  188  (measured · │
│ Born      1993-06-15 · 32 yo             │  │              field test)│
│ Sex       Female                          │  │ LTHR   168  (est from   │
│ Weight    56 kg                            │  │              0.85×HRmax)│
│ Height    5'7" / 170cm                     │  │ RHR    51   (measured)  │
│ Email     maria@example.com                 │  │ HRV    62 ms (28d avg)  │
│                                             │  │ [calibrate field test ▶]│
└─────────────────────────────────────────┘  └─────────────────────────┘

┌──── PACE ANCHOR ────────────────┐ ┌──── PREFS ──────────────┐
│ VDOT 38.2 · FRESH (75 days ago) │ │ Days/week     5         │
│ Anchored: Pasadena Half 2/22    │ │ Long run day  Sun       │
│ Tier: INTERMEDIATE              │ │ Quality days  Tue + Sat  │
│ Stale at 8 weeks                │ │ Surface       road 80%  │
│ [recalibrate · 5K TT ▶]          │ │ Time of day   AM        │
└────────────────────────────────┘ │ Treadmill     yes        │
                                    │ Pool          yes        │
                                    └──────────────────────────┘

GOALS                              HISTORY
┌────────────────────────────┐    ┌────────────────────────┐
│ A · Big Sur 5/15 · 3:25    │    │ Marathons     4         │
│ B · NYC 11/3 · 3:30        │    │ Best M        3:38:45   │
│ Season  · sub-3:25 marathon │    │ Half PRs      1:35:00   │
└────────────────────────────┘    │ 5K            22:18     │
                                  │ 10K           45:30     │
                                  │ Career VDOT   39.4      │
                                  └────────────────────────┘

HEALTH FLAGS                        CYCLE (when sex=female)
┌────────────────────────────┐    ┌────────────────────────┐
│ Active injury    none      │    │ Last period   4/14      │
│ Chronic concerns           │    │ Cycle length  28 days   │
│   [ ] Achilles             │    │ Currently     luteal d22│
│   [ ] Plantar              │    │ Symptoms      mild PMS  │
│   [ ] Knee/IT band         │    │ Iron history  normal    │
│ Allergies        none      │    │ Energy avail  adequate  │
│ Iron history     normal    │    │ Doctrine §13 active     │
│ GI sensitivities           │    └────────────────────────┘
│   [ ] Caffeine             │
│   [ ] Maltodextrin gels    │
└────────────────────────────┘

TRAVEL & RACING                     EQUIPMENT
┌────────────────────────────┐    ┌────────────────────────┐
│ Home            LA · PT     │    │ Watch         Garmin 965│
│ Travel mode     drive       │    │ HR sensor    optical OK│
│ Race-week sleep             │    │ Foot pod     Stryd · y │
│   bedtime       9:30 PM     │    │ Power meter  yes        │
│   wake          5:00 AM     │    │ Shoes        [closet ▼]│
└────────────────────────────┘    └────────────────────────┘

CONNECTIONS
┌─────────────────────────────────────────────────┐
│ Strava        ✓ connected · auto-sync 6h         │
│ HealthKit     ░ M2 · iOS app needed              │
│ Calendar      ✗ optional · race date sync        │
│ Coach (human) ✗ M3 · handoff option              │
└─────────────────────────────────────────────────┘
```

**Mechanics worth noting:**

The profile is the user-editable face of the RunnerHub. Every field on this page becomes a personalization input for the engine. The current profile collects 4 of the ~20 fields shown above; the redesign captures the rest.

The Cycle section is gated by sex=female and disabled by default — it's optional. But when enabled, doctrine 13 (`MENSTRUAL_CYCLE_GUIDANCE`, `RED_S_SCREENING`) becomes consumable. The brief can comment on luteal-phase fatigue, PMS-week training cuts, etc.

The Health Flags section is the entrypoint for `injury_return.ts` (WALK_RUN_PROTOCOL when active injury is set). It's also where allergies/sensitivities feed into the fueling planner — gel brand recommendation differs for caffeine-sensitive athletes.

The Equipment section unlocks doctrine 17 (footwear) properly. The watch model unlocks HR sensor accuracy doctrine (Research/03). Power meter unlocks pacing-by-power for downhill races.

The Connections section is the "wire-up your services" surface. Strava is connected today; HealthKit is M2; Calendar (race date sync to Google Calendar) is a small but high-leverage add.

**Onboarding flow:**

Today the runner has to know to go to /profile to set fields. There's no onboarding. Proposed 5-screen onboarding:

1. **Identity.** "Hi, I'm Runcino. Let's get to know you." → name + birth date + sex + weight (optional).
2. **Race history.** "What's your best recent race?" → pick from Strava-flagged races OR "race nothing recently → 5K TT."
3. **Training rhythm.** "How often do you train?" → days-per-week + long-run day + quality day preference.
4. **Goals.** "What's your next goal?" → race picker (with autocomplete) OR "I just want consistent training."
5. **HRmax.** "How do you know your HRmax?" → 4 options:
   - Measured (then field-test protocol prompts)
   - Will measure soon (skip for now, prompt later)
   - Estimate from age (Tanaka)
   - Don't ask, I'll do it later

5 screens, ~90 seconds, every subsequent surface gets richer.

#### 8j.6 `/health` (existing, redesign)

**Mission:** Objective state-of-the-runner with clear interpretation.

**Top 3:**
1. Recovery score (with contributing signals).
2. HRV / RHR / sleep trends.
3. Training load (ACWR / TRIMP / monotony / strain).

**Hub deps:** HealthKit (assumed) + Strava load.

**Currently:** Strava trends + 4 placeholder cards.
**Should be:** Section 8f.

**ASCII sketch:**
```
HEALTH · objective state-of-the-runner

┌───────────────── RECOVERY · HERO ─────────────────┐
│  78 / 100  GREEN                                   │
│                                                    │
│  + HRV 62 ms · within band (28d avg 64)            │
│  + Sleep 7.4 hrs · target 8 (slight under)         │
│  + RHR 51 bpm · stable (28d avg 50)                │
│  + ACWR 0.95 · in band (0.8-1.3)                   │
│  - TSS yesterday 145 (heavy)                       │
│                                                    │
│  Recommendation: today permits standard training   │
│  Citation: Research/15 wearable load · Research/00b│
└───────────────────────────────────────────────────┘

HRV TREND · 28 DAYS                  RHR TREND · 28 DAYS
┌───────────────────────┐           ┌───────────────────────┐
│ 80│              ╱─    │           │ 56│                    │
│ 70│       ╱─╲╱─╱       │           │ 53│                    │
│ 60│ ╱─╲─╱        ╲     │           │ 50│ ╱╲─╲─╱─╲─╱─╲─╱─    │
│ 50│                ╲   │           │ 47│                    │
│   └──────────────────  │           │   └──────────────────  │
│ 28d avg 64 · today 62  │           │ 28d avg 50 · today 51  │
│ [stable]               │           │ [+1 vs trail]          │
└───────────────────────┘           └───────────────────────┘

SLEEP · LAST 28 DAYS                 LOAD · ACWR + TRIMP
┌───────────────────────┐           ┌───────────────────────┐
│ 9│                     │           │ ACWR     0.95          │
│ 8│ ▄▄ ▄ ▄▄ ▄▄ ▄ ▄▄ ▄  │           │ in band (0.8-1.3)      │
│ 7│ ██▄██▄██▄██▄██▄██▄ │           │                        │
│ 6│ ███████████████████ │           │ TRIMP 7d   612         │
│ 5│ ███████████████████ │           │ TRIMP 28d  2,460       │
│  └──────────────────── │           │ Monotony   1.2 (low)   │
│ Avg 7.2hr · target 8   │           │ Strain     low-mid     │
│ Last night: 7.4hr      │           │ [doctrine 15 ✓]        │
└───────────────────────┘           └───────────────────────┘

CYCLE PHASE (when sex=female)        BODY WEIGHT
┌───────────────────────┐           ┌───────────────────────┐
│ Day 22 · LUTEAL        │           │ 56.2 kg · today        │
│ [phase chart cycle ring]│           │ 28d avg 56.0 · stable │
│ Energy: typically     │           │ Race weight goal: 55kg │
│   slightly lower       │           │ [chart 28d]            │
│ Doctrine §13: easy      │           │ Hydration noise ±0.5kg │
│   to moderate week      │           │   day-to-day normal    │
└───────────────────────┘           └───────────────────────┘

ILLNESS WATCH · GREEN                CADENCE TREND
┌───────────────────────┐           ┌───────────────────────┐
│ HRV          stable   │           │ 178 spm · 28d avg     │
│ RHR          +1 bpm   │           │ Target: ≥ 175 (Daniels)│
│ Sleep        adequate │           │ Last run: 178 ✓       │
│ Subjective   ok       │           │ Trend: stable           │
│ → No flags      ✓     │           │ Doctrine §16            │
└───────────────────────┘           └───────────────────────┘
```

**Mechanics worth noting:**

The Recovery hero combines 5 inputs into one score. The math is visible — every contribution is shown with a sign and a magnitude. The runner can see exactly why their score is what it is. This is doctrine 15 (`wearables.ts`) finally surfaced as a coherent model.

The HRV + RHR + Sleep + Load grid is the standard biometric four-up. Each tile shows: 28-day chart, today's reading, comparison to baseline, doctrine reference. Unified visual language.

The Cycle Phase tile is gated by sex=female AND user opted-in on profile. When active, it pulls Research/13 (`sex.ts:MENSTRUAL_CYCLE_GUIDANCE`). The phase ring shows where in the cycle the runner is; the sentence below tells them what to expect (luteal = energy slightly lower; menstrual = first 1-2 days off if needed; etc.).

The Body Weight tile addresses a sensitive topic carefully. Race-weight goal is OPTIONAL and has explicit guardrails (no weight-loss recommendations from the app — only data display). Doctrine 13's RED-S protections inform this surface.

The Illness Watch is a combined-signal early warning. Research/15 says HRV drop + RHR rise + sleep disruption = likely illness onset. The tile aggregates these and either flags GREEN (all clear), YELLOW (one signal off), or RED (two+ signals off).

The Cadence Trend tile is the doctrine 16 (`cadence.ts`) surfacing. Today /runs/[id] shows raw cadence; here we show 28-day avg vs target.

#### 8j.7 `/log` (existing, light redesign)

**Mission:** Browse run history with structure.

**Top 3:**
1. PR shelf (existing).
2. Race shelf (existing).
3. Run feed grouped by week/month.

**Hub deps:** Strava activities + races.

**Currently:** chronological feed.
**Should be:** week/month-grouped feed with filters.

**ASCII sketch:**
```
PR SHELF                RACES SHELF
[5K · 10K · HM · M]     [past 4 races]

[FILTERS · easy / quality / long / race]
[GROUP BY · day / week / month]

WEEK OF MAY 4
  Tue · threshold · 7.4 mi · 6:38/mi
  Wed · easy · 6.0 mi · 9:12/mi
  Sat · long · 18.0 mi · 8:45/mi
  TOTAL · 31.4 mi · 1Q · 1L

WEEK OF APR 27
  ...
```

#### 8j.7.5 Notes on the log + health redesigns

A few open design questions:

- **Log filters and grouping.** The current chronological feed is fine for low-volume users; high-volume users (5+ runs/wk) need filters (easy / quality / long / race) and grouping (day / week / month). Adding filters is straightforward; grouping needs the week/month/year wraps with totals.
- **Health page when HealthKit is genuinely unavailable.** The placeholder grid today is a tease. The redesign assumes HealthKit; what happens when the user only has Strava? Either (a) hide the HealthKit-only tiles entirely (don't tease), or (b) show "connect HealthKit to unlock" CTAs with the placeholder layout. I lean toward (a) — empty tiles are deadweight.
- **Strava-only Recovery Score.** When HealthKit is absent, the Recovery Score can still be computed from Strava (TSS + ACWR + run count + recent suffer). It will be lower-fidelity but better than nothing. The score should label its confidence.
- **Cycle privacy.** This data is sensitive. Profile must default to off; UI should never surface cycle in-context unless explicitly opted in.

#### 8j.8 `/workout/[date]` (existing, FULLY REDESIGN — currently placeholder)

**Mission:** The single-session deep-dive — what, why, how, with whom (which past attempts).

**Top 3:**
1. The session itself (warm-up + main + cool-down + KPI strip).
2. Why this session — research + your training context.
3. Past attempts at this session type + conditions today + shoe recommendation.

**Hub deps:** engine prescription for this date + workouts doctrine + past activities.

**Currently:** 100% static placeholder.
**Should be:** the canonical session detail screen.

**ASCII sketch:**
```
TRAINING / Big Sur 2026 / Wk 8 BUILD / Tue May 5 · threshold

┌────────────────── HERO ─────────────────────────┐
│ THRESHOLD · 5 × 1 mi · LT2                        │
│ "Your hardest session of the build"                │
│                                                    │
│ ┌─────┬─────┬─────┬─────┐                         │
│ │ 8.0 │ ~58 │ 6:30│ 168 │                         │
│ │ mi  │ min │ /mi │ bpm │                         │
│ │     │     │ T   │ LT  │                         │
│ │ tot │ dur │ pace│ ceil│                         │
│ └─────┴─────┴─────┴─────┘                         │
│ [ start workout ▶ ] [ edit ▼ ]  [ swap to easy ✗ ] │
└──────────────────────────────────────────────────┘

WHY THIS SESSION
┌──────────────────────────────────────────────────┐
│ Threshold intervals build lactate buffering and   │
│ the velocity at which lactate begins accumulating │
│ (LT2). At week 8 of 16, you're in the build phase │
│ where threshold work delivers the highest         │
│ specificity gain for marathon pace.               │
│                                                    │
│ For your VDOT (38.2), threshold pace is 6:28-6:35.│
│ One mile at this pace × 5 reps with 90s float     │
│ trains the same physiology as a continuous tempo  │
│ but with less psychological drain.                 │
│                                                    │
│ Source: Daniels Running Formula 4e Ch3 ·           │
│         Research/04 §3.2 · ▸ open                 │
└──────────────────────────────────────────────────┘

STRUCTURE                              YOUR HISTORY
┌─────────────────────────┐           ┌────────────────────────┐
│ WARM-UP · 1.5 mi easy   │           │ Last 5 attempts:        │
│   target 9:15-9:30/mi   │           │                         │
│   purpose: open vascular│           │ 4/23 · 4×1mi @ 6:34 ✓   │
│                          │           │ 4/9  · 4×1mi @ 6:38 ✓   │
│ MAIN · 5×1mi @ T pace   │           │ 3/26 · 3×1mi @ 6:42 ✓   │
│   pace: 6:28-6:35/mi    │           │ 3/12 · 5×1mi @ 6:40 ✓   │
│   float: 90s easy jog   │           │ 2/26 · 5×1mi @ 6:44 ✓   │
│   HR: ≤ 168 bpm           │           │                         │
│   "uncomfortable, not    │           │ Trend:                  │
│   suffering"             │           │   pace -10s in 10wk    │
│                          │           │   reps stable 4-5       │
│ COOL-DOWN · 1 mi easy    │           │   completion 100%       │
│   target ≥ 9:30/mi       │           │                         │
└─────────────────────────┘           └────────────────────────┘

CONDITIONS · today                   SHOE RECOMMENDATION
┌─────────────────────────┐           ┌────────────────────────┐
│ Forecast 6:00-7:00 AM   │           │ Endorphin Speed 4 ◆     │
│ 72°F · DP 58 · wind 6   │           │   347 mi · 87% of cap   │
│ Heat factor +3 sec/mi   │           │ Threshold-friendly:     │
│ Adjusted target:        │           │   carbon plate, light   │
│   6:31-6:38/mi (was 28-35)│         │ Last threshold attempt: │
│                          │           │   Endorphin Pro 3 (12d) │
│ Doctrine 06: hot dewpoint│         │                         │
│   adds ~3 sec/mi at 58°F│           │ Alt: Pegasus 41 (recovery│
│ [open weather ▶]        │           │   from this session)    │
└─────────────────────────┘           └────────────────────────┘

FUELING (light · this is short enough no carb is required)
┌──────────────────────────────────────────────────┐
│ Pre · 1 small carb (banana / toast) 30min before  │
│ Mid · water + electrolyte sip during float       │
│ Post · 25g carb + 10g protein within 30min        │
│ Doctrine 18: short-quality requires only          │
│   pre-fuel; carbs during are over-fueling          │
└──────────────────────────────────────────────────┘

SEND TO DEVICE
┌──────────────────────────────────────────────────┐
│ [ Garmin Connect ▶ ]  [ Coros ]  [ Apple Watch ] │
│ [ download .fit ]    [ copy structure to clip ]   │
└──────────────────────────────────────────────────┘

POST-WORKOUT (when completed · log feels)
┌──────────────────────────────────────────────────┐
│ How did that feel?                                │
│ [ 1 ░ 2 ░ 3 ░ 4 ░ 5 ░ 6 ░ 7 ░ 8 ░ 9 ░ 10 ]      │
│   easy        moderate        very hard           │
│                                                    │
│ Anything to note? [text field]                    │
│   "Legs felt heavy on rep 4. Cut rep 5."          │
│                                                    │
│ Sleep last night: [7.4 hr]                        │
│                                                    │
│ [ save ]                                           │
└──────────────────────────────────────────────────┘
```

**Mechanics worth noting:**

The /workout/[date] page is the most-visited destination from the dashboard's week-strip and 30-day-strip. Today it's a frozen design canvas. The redesign turns it into the canonical session-detail screen.

The Hero's KPI strip is doctrine-derived: total distance from prescription, duration from pace × distance, T pace from VDOT band, HR ceiling from 92% × HRmax. Every number traces back.

The "Why this session" tile is the research-citation surface. Doctrine 04 (workouts.ts) provides the structure; doctrine 01 (pace_zones.ts) provides the pace; the explanation paragraph wraps both. This is the Coach explaining itself.

The Structure tile shows the workout step-by-step with paces, HR ceilings, and "purpose" notes. A runner can read this aloud and execute without further reference.

Your History tile is the prescription-aware past. Today /runs/[id] shows just the activity; the workout-detail page shows ALL past attempts at THIS session type, with a trend line. This is where progress becomes visible.

Conditions tile applies doctrine 06 weather adjustments. The pace target is FORECAST-AWARE — if it's hot, the band shifts. If a hard cancel trigger fires (per `HARD_CANCEL_TRIGGERS`), the session swaps automatically.

Shoe recommendation pulls from doctrine 17 + the runner's closet + recent shoe rotation. "Endorphin Speed for threshold; switch to Pegasus tomorrow" is the kind of intelligent rotation guidance a coach would give.

Send-to-device is the last-mile execution surface. .fit export, Garmin Connect deep link, structure-as-text fallback.

The Post-Workout RPE+notes input is the experiential layer (section 8i). 1-tap RPE 1-10 + free-text + sleep-last-night. Stored on the activity. Available to the brief next day. **This is the highest-leverage missing input in the app.**

#### 8j.9 `/season` (NEW, section 8g.1)

**Mission:** Strategic race calendar across months.

**Top 3:**
1. Race timeline + phase blocks between.
2. Conflict warnings + suggested additions.
3. Projected fitness curve.

**Hub deps:** all races + plan templates + VDOT projection.

**ASCII sketch:**
```
SEASON · 12 MONTHS · MAY 2026 → APR 2027

       MAY     JUN     JUL     AUG     SEP     OCT     NOV
       ────────────────────────────────────────────────────
       BIG    POST   ──── BASE ──── │ ──── BUILD ──── │ NYC
       SUR    RACE                  │                  │ ◆
       ●A     ░     ████████       │ ████████████    │ ●A
       5/15   1-2w  reset weeks    │ rebuild, BUILD,  │ 11/3
              recov.                │   PEAK          │
                                    │
       FITNESS PROJECTION · VDOT
       40 │                        ____________________
       38 │ ◆___                  /                    \◆
       36 │     \____            /                      
       34 │          \__________/                       
       32 │                                              
          └──────────────────────────────────────────────
              May  Jun  Jul  Aug  Sep  Oct  Nov

SUGGESTED ADDITIONS
┌──────────────────────────────────────────────────┐
│ ⚡ TUNE-UP HALF · suggested for Aug 16 weekend     │
│   You have a 14-week gap from Big Sur to NYC      │
│   build start. Doctrine: a tune-up race 8-10wk    │
│   before A-race builds confidence + checkpoints    │
│   fitness. Search for halfs near LA · Aug 16.      │
│   [ search races ▶ ]                              │
└──────────────────────────────────────────────────┘

CONFLICTS DETECTED
┌──────────────────────────────────────────────────┐
│ ⚠ Sept 15 trail 25K vs NYC Nov 3                 │
│   Spacing: 7 weeks apart                          │
│   Doctrine MULTI_RACE_CADENCE: marathon recovery  │
│   needs 4-6 weeks; 25K + adequate marathon build  │
│   needs 4+ weeks. Tight margin.                   │
│   Recommendation: keep both but de-prioritize     │
│   trail race to B-effort, no goal-time pressure.  │
│   [ acknowledge ▶ ] [ remove trail 25K ▶ ]        │
└──────────────────────────────────────────────────┘

SEASON ANNOTATIONS
┌──────────────────────────────────────────────────┐
│ Jun 1-21 · POST_RACE recovery (Big Sur)            │
│ Jun 22-Jul 19 · BASE 1 (4 wk · 32-38 mi)          │
│ Jul 20-Aug 16 · BASE 2 (4 wk · 38-45 mi)          │
│ Aug 16 · TUNE-UP HALF (suggested)                  │
│ Aug 17-Sep 13 · BUILD 1 (4 wk · 40-50 mi)         │
│ Sep 14-Oct 4 · BUILD 2 (3 wk · 45-55 mi)          │
│ Oct 5-Oct 19 · PEAK (2 wk · 50-55 mi)             │
│ Oct 20-Nov 2 · TAPER (2 wk · cuts to 30 mi)        │
│ Nov 3 · NYC ◆                                      │
└──────────────────────────────────────────────────┘
```

**Mechanics worth noting:**

The season page is the strategic view that's been missing from the app. A runner targeting two marathons in a year (which is a typical pattern) needs to see how the year fits together. Today the app shows nextA + nextAny + race index — none of these convey arc.

The Fitness Projection chart projects VDOT forward through expected build phases. The math: BASE phases hold VDOT; BUILD phases add 0.5-1.0 VDOT per 4 weeks; PEAK adds another 0.5; race-day depresses, then POST_RACE drops 1.0-1.5 VDOT temporarily. This is doctrine-derived (Research/14 age decline curve, Research/02 race prediction confidence).

Suggested Additions are doctrine-driven race recommendations. When the season has a long gap, the page suggests a tune-up. When the runner has only one race scheduled but their training history suggests they should be peaking more often, the page suggests an A2 race.

Conflict Detection cross-checks new races against the multi-race cadence rules from Research/00b. The runner gets warnings before they sign up for races that conflict.

Season Annotations are the textual narrative of the year. They name each phase, give the duration and mileage band, and link to the corresponding training-page view.

#### 8j.10 `/research` (NEW, section 8g.2)

**Mission:** Browseable doctrine the runner can study.

**Top 3:**
1. Topic index (24 sections).
2. "Active for you" — doctrine being applied to your training right now.
3. Search.

**Hub deps:** doctrine + state.

**ASCII sketch:**
```
THE COACH'S NOTEBOOK · 24 topics · [search]

ACTIVE FOR YOU RIGHT NOW
- Pace zones · VDOT 38.2 → bands E/M/T/I/R
- Phase distribution · BUILD = pyramidal target
- Easy share · ≥80% target
- Long run cap · 18 mi (Daniels +10%)

TOPIC INDEX
[Pace zones]    [HR]          [Recovery]
[Workouts]     [Injury]       [Weather]
[Strength]    [Pacing]       [XT]
[Mobility]    [Course]       [Travel]
[Sex]         [Age]          [Wearable]
[Form]        [Footwear]     [Fueling]
[Hydration]   [Mental]       [Form fix]
[Plan tpl]    [Grading]
```

#### 8j.11 `/calibration` (NEW, section 8g.3)

**Mission:** Every dial in one place.

**Top 3:**
1. Pace zones + HR zones + LTHR (the four cardio dials).
2. Fueling + hydration + sweat-rate (the three race-day dials).
3. Cadence + long-run cap + easy-share + taper depth (the four discipline dials).

**Hub deps:** all of state + doctrine.

**ASCII sketch:**
```
CALIBRATION · ALL YOUR DIALS, ALL THEIR SOURCES

PACE ZONES                            HR ZONES (5)
┌───────────────────────────────┐    ┌───────────────────────────────┐
│ E    9:15 - 10:00 / mi         │    │ Z1   < 130 bpm  (recovery)    │
│ M    7:32 - 7:48                │    │ Z2   130-150  (easy)          │
│ T    6:28 - 6:35                │    │ Z3   150-167  (steady)        │
│ I    5:55 - 6:05                │    │ Z4   167-180  (threshold)     │
│ R    5:20 - 5:35                │    │ Z5   180-188  (VO2)           │
│                                 │    │                               │
│ Source: VDOT 38.2 · FRESH       │    │ Source: HRmax 188 (measured)  │
│ Race: Pasadena Half 2/22        │    │ Method: HRMAX_ZONES_5         │
│ Doctrine: Research/01 §2        │    │ Doctrine: Research/03 §1      │
│ [recalibrate · 5K TT ▶]         │    │ [field test ▶]                │
└───────────────────────────────┘    └───────────────────────────────┘

KARVONEN HRR ZONES (5)               LTHR
┌───────────────────────────────┐    ┌───────────────────────────────┐
│ Z1   < 51% HRR  < 121 bpm      │    │ LTHR    168 bpm                │
│ Z2   60-70%   123-145          │    │ Source: estimated 0.85×HRmax  │
│ Z3   70-80%   145-160          │    │ Confidence: ±5 bpm             │
│ Z4   80-90%   160-175          │    │ Doctrine: Research/03 §3       │
│ Z5   > 90%   > 175             │    │ Field test: 30-min TT protocol │
│                                 │    │ [calibrate ▶]                  │
│ Source: HRmax 188 - RHR 51 = 137│    └───────────────────────────────┘
│ Doctrine: KARVONEN_FORMULA      │
└───────────────────────────────┘

FUELING                              HYDRATION
┌───────────────────────────────┐    ┌───────────────────────────────┐
│ Carb target  80 g/hr            │    │ Daily baseline   ~3.0 L/day    │
│ Tier         intermediate       │    │ Pre-race (24h)   ~5 L/day      │
│ Stretch      120 g/hr (untested)│    │ During (warm)    475 ml/hr     │
│ Pre-race     100g 2-4hr before  │    │ During (hot)     800 ml/hr     │
│ GI ceiling   uncalibrated       │    │                                │
│ [calibrate · race fueling log ▶]│    │ Sweat rate       UNCALIBRATED  │
│ Doctrine: Research/18           │    │ [measure protocol · 60min ▶]   │
└───────────────────────────────┘    │ Doctrine: Research/19          │
                                     └───────────────────────────────┘

DISCIPLINE DIALS                     STALENESS WATCH
┌───────────────────────────────┐    ┌───────────────────────────────┐
│ Cadence target   ≥ 175 spm     │    │ VDOT       FRESH (75d)         │
│ Long run cap     18.0 mi        │    │ HRmax      MEASURED (90d)      │
│ Easy share       ≥ 80% (build) │    │ LTHR       ESTIMATED · stale   │
│ Taper depth      35% volume    │    │ Sweat rate UNCALIBRATED        │
│ Quality/wk       2 (build)     │    │ Carb tol.  UNCALIBRATED        │
│ Strength/wk      2 sessions    │    │                                │
└───────────────────────────────┘    │ Action items:                  │
                                     │ → measure sweat rate (60min)   │
                                     │ → calibrate carb ceiling (race)│
                                     │ → confirm LTHR (30min TT)      │
                                     └───────────────────────────────┘
```

**Mechanics worth noting:**

The calibration page is the runner's own audit. Every doctrine number that's been personalized to them is here, with the source, the method, and the confidence. A coach would have a notebook with this; the app should have a page.

The Staleness Watch is the page's most valuable original insight. It surfaces what NEEDS recalibrating. "Your sweat rate is uncalibrated → measure protocol takes 60 minutes" is actionable. Today none of these stalenesses surface anywhere.

Karvonen HRR zones are the easiest doctrine win in the app. RHR is on the profile, formula is in `hr_zones.ts:KARVONEN_FORMULA`, no consumer. Wiring it into the calibration page is a 2-hour task.

Fueling and Hydration tiles read from doctrine 18 + 19 properly (not inlined). Both have "calibrate" CTAs that walk the runner through measurement protocols.

#### 8j.12 `/patterns` (NEW, section 8g.4)

**Mission:** Surface the runner's habits.

**Top 3:**
1. Day-of-week + workout-type completion rates.
2. Pre-race patterns (taper depth, race-week cuts).
3. Recovery + niggle patterns.

**Hub deps:** 12+ months of history + prescription audit.

**ASCII sketch:**
```
YOUR PATTERNS · last 12 months

DAY-OF-WEEK COMPLETION
M 92% · T 89% · W 78% · T 81% · F 41%* · S 88% · S 96%
(* Friday is your skip day)

WORKOUT-TYPE COMPLETION
Easy 96% · Long 88% · Threshold 73% · Strides 41%*
(* Strides are under-prescribed by you)

PRE-RACE TAPER
Last 4 race weeks: avg 22% volume cut · target 30%
You under-taper.

RECOVERY PATTERN
After every marathon, you ran 14 mi within first 5 days.
Doctrine says wait 7. You consistently break this.

NIGGLE TIMING
Achilles flares after 3 consecutive long runs.
You've done this 4 times in 12 months.
```

#### 8j.12.5 The patterns page caveat

The /patterns page requires significant historical data — at least 6 months of Strava history with complete prescriptions. For a brand-new user it's empty. For a 2-year power user it's gold.

This means /patterns is a power-user surface, not a v1 surface. It should ship after the rest of the redesign so that early users have data accumulated to populate it.

#### 8j.13 `/today` (NEW, section 8g.5)

**Mission:** "What am I doing today" in 3 seconds.

**Top 3:**
1. Workout title.
2. Voice paragraph.
3. Targets (pace / HR / distance).

**Hub deps:** prescription for today.

**ASCII sketch:**
```
THRESHOLD · 5 × 1 mi
8.0 mi · ~58 min

[voice paragraph, two short sentences]

PACE 6:30/mi · HR ≤ 160 · CADENCE ≥ 175

[ open detailed view ▶ ]
```

#### 8j.14 `/library` (NEW, section 8g.6)

**Mission:** Workout-type vocabulary.

**Top 3:**
1. Type list (16 types).
2. For selected type: structure + when to use + research.
3. Your history at this type.

**Hub deps:** doctrine + state.

**ASCII sketch:**
```
SESSION LIBRARY · 16 types

[Easy] [Recovery] [Long steady] [Long progression]
[Long MP block] [Long fast finish] [Threshold]
[Tempo continuous] [Sub-threshold] [VO2 max]
[MP-specific] [MP combo] [MP long] [Strides]
[Hill sprints] [Race]

SELECTED · THRESHOLD INTERVALS

DEFINITION
At lactate threshold pace (LT2). Builds buffering capacity.

WHEN TO USE
Mid-build, weekly. Replace with sub-threshold near taper.

STRUCTURE
WU 1.5mi easy → 4-6 × 1mi @ T pace, 90s float → CD 1mi
Total 7-9mi · ~50-65min

PACE TARGET (your VDOT 38.2)
6:28 - 6:35 / mi

RESEARCH
Daniels 2014, Research/04 §3.2

YOUR HISTORY
12 days ago · 4×1mi @ 6:34
26 days ago · 4×1mi @ 6:38
40 days ago · 3×1mi @ 6:42

[Coach can prescribe one tomorrow ▶]
```

---

That's 14 page sketches. Each is a starting point — the visual blueprints would refine them, but the architecture is solid: hub-as-backbone, mode-aware composition, every number traceable.

### 8k. The "first 5 seconds" — concrete rendered examples

To make the redesign concrete, here is what a runner would see in the first 5 seconds for each of the 8 modes the dashboard dispatches:

**Race-day morning (Big Sur, 4 hours before gun):**
> RACE DAY. Big Sur Marathon, gun at 6:45 AM, 2h 14min away. Weather 56°F, dewpoint 48, wind 8mph N. Goal A 3:25. The brief: "Sleep was 7.4 hours, RHR holding. Conditions are favorable for goal A — no heat penalty, gentle headwind in segment 2. Start conservative: first 5 miles at 8:00, settle into 7:48 by mile 7. Watch the early downhill — the field will pull you faster than your plan."

**Race-week (Big Sur 5 days out):**
> RACE WEEK. Big Sur in 5 days. Today: 4mi easy + strides. Brief: "Taper window. Volume drops to 65%, intensity preserved (one 4×400 strider session midweek). Sleep is the highest-leverage variable now — bank an extra hour each night through Friday. Race-week meals: practice the morning carb-load tomorrow."

**Build (regular Tuesday morning):**
> Threshold today. 5×1mi @ 6:30, 8.0 mi total, ~58min. Readiness GREEN. Brief: "VDOT 38.2 holds threshold band 6:28-6:35. Last threshold attempt 12 days ago hit 6:34, so today's pace is in your wheel. Keep cadence above 175. Cool down deliberately — recovery starts at the cool-down."

**Taper (last 7-14 days):**
> TAPER. 9 days to Big Sur. Today: easy 5mi + 6×100m strides. Brief: "Volume cut by 35% per Daniels. Intensity preserved. The taper anxiety is real — trust the doctrine. You are NOT losing fitness, you are absorbing it. Sleep extra. Hydrate baseline."

**POST_RACE (day 4 after marathon):**
> RECOVERY DAY 4 of ~14. Stage 2 — light easy permitted. Today: 30min easy or rest. Brief: "CK markers still elevated, energy returning. Walk-run is fine; pace doesn't matter. The temptation to test fitness is normal and you should resist it. Reverse-taper says light reload begins day 8."

**Recovery-alert YELLOW (heavy block + ACWR drift):**
> READINESS YELLOW. ACWR 1.42 (band 0.8-1.3), easy share 64%. Today swapped from threshold to easy 5mi. Brief: "Two warning signs converging — your 7-day load is high relative to 28-day, and your easy ratio dropped below 80%. The doctrine 00b decision matrix says: 24-48 hour easy-only window. We're swapping today. Reassess Thursday."

**Recovery-alert RED (multiple signals):**
> READINESS RED. STOP. ACWR 1.55, easy share 58%, RHR +5, sleep 5.8h. Today: rest day, no exceptions. Brief: "Four signals stacked. Your body is telling you to stop. This is doctrine 00b 'full cutback' territory. Take today and tomorrow completely off. We'll reassess Thursday morning."

**REBUILD (returning from break):**
> REBUILD. Day 5 of return-to-running. Today: easy 4mi @ comfortable pace. Brief: "Welcome back. We're capping at 4mi for now and ramping by ~10% per week. No quality work for at least two more weeks. The bigger picture matters more than today's run."

**BASE (no race scheduled):**
> BASE. Today: easy 6mi at conversational pace. Brief: "No race on the books — this is the foundation phase. Easy mileage builds aerobic depth, even when it feels boring. Aim for the same time/place each day; consistency is the engine of everything else."

These 9 modes share the same DOM structure. They differ only in which signals are elevated. The mode dispatcher is a single function over `state`, returning one of 9 strings; the page composes accordingly.

---

## Appendices

### A. File reference index

- Doctrine barrel: `web/coach/doctrine/index.ts`
- Doctrine new this session: `web/coach/doctrine/grading.ts`, `web/coach/doctrine/cite.ts`
- Coach interface + impl: `web/coach/coach.ts:254-901`
- Voice lead composer: `web/coach/explanations.ts`
- Citation helpers: `web/coach/citations.ts`
- LLM gateway: `web/coach/llm.ts`
- Voice prompt: `web/coach/voice.md`
- State aggregator: `web/lib/coach-state.ts:217-450`
- Daily engine: `web/lib/coach-engine.ts:93-663`
- Engine principles: `web/lib/coach-principles.ts`
- VDOT pipeline: `web/lib/vdot.ts:1-353`
- Runner profile: `web/lib/runner-profile.ts:1-97`
- Workout palette: `web/lib/coach-workouts.ts` (added `vdotTest5K` at line 266)
- Strength palette: `web/lib/coach-strength.ts`
- Plan template engine: `web/lib/coach-plan.ts`
- Weather slowdown: `web/lib/weather-slowdown.ts`
- Strava cache + stats: `web/lib/strava-cache.ts`, `web/lib/strava-stats.ts` (added quality-day count + VDOT-aware classifier)
- API routes: `web/app/api/coach/today/route.ts` (now also returns `vdot`, `vdotTestPrompt`, `dailyBrief`), `web/app/api/brief/route.ts`, `web/app/api/retrospective/route.ts`
- Pages:
  - `web/app/page.tsx` (2198 lines) — Overview / Hub
  - `web/app/training/page.tsx` (672 lines) — Daily briefing
  - `web/app/races/page.tsx` (400 lines) — Race index
  - `web/app/races/[slug]/page.tsx` (2056 lines) — Race detail
  - `web/app/races/new/page.tsx` — Create race
  - `web/app/log/page.tsx` (462 lines) — Run log
  - `web/app/runs/[id]/page.tsx` (450 lines) — Single run
  - `web/app/health/page.tsx` (220 lines) — Health (placeholder grid)
  - `web/app/profile/page.tsx` (596 lines) — Profile
  - `web/app/workout/[date]/page.tsx` (520 lines) — **STILL 100% PLACEHOLDER**

### B. Doctrine wired/unwired quick reference

**Newly imported and consumed (this session):**
- `pace_zones.ts` `VDOT_TIERS` + `vdotTierFor` + `VDOT_FRESHNESS_WINDOW` + `vdotFreshnessFor`
- `pace_zones.ts` `VDOT_FIELD_TESTS` (concept consumed; copy hand-curated)
- `hr_zones.ts` `HRMAX_ZONES_5`
- `recovery_protocols.ts` `INCOMPLETE_RECOVERY_DECISION_MATRIX` (indirect)
- `taper.ts` `TAPER_VOLUME_REDUCTION` + `TAPER_INTENSITY_PRESERVATION` + `TAPER_ERRORS` + `TAPER_BENEFIT`
- `post_race.ts` `POST_RACE_STAGES`
- `grading.ts` (NEW) `VDOT_AGE_DECLINE_MALE` + `VDOT_AGE_DECLINE_FEMALE` + `VDOT_SEX_COHORT_OFFSET` + `gradeVdot`

**Still imported and consumed (from prior sessions):**
- `pace_zones.ts` (`VDOT_LOOKUP_TABLE`, `PACE_ZONE_WIDTH`, `DanielsPace`, `MARATHON_VDOT_CORRECTION` incompletely)
- `weather.ts` (8 of 22 exports)
- `plan_templates.ts` (`PLAN_TEMPLATES`)
- `load.ts` (`ACWR_BAND`, `SINGLE_SESSION_SPIKE`)
- `workouts.ts` (`LONG_RUN`, `STRIDES` — vocabulary mirrored in `coach-workouts.ts`)
- `recovery.ts` (`SLEEP`)

**Still defined but no consumer:** every export of `cross_training.ts`, `mobility.ts`, `mental.ts`, `sex.ts` (cycle/RED-S parts), `age.ts` (server-side), `travel.ts`; `cadence.ts`; `course.ts`; `race_prediction.ts`; `race_week.ts`; bulk of `recovery_protocols.ts` outside the decision matrix; bulk of `hydration.ts` outside what HydrationTile inlines; bulk of `hr_zones.ts` outside `HRMAX_ZONES_5`; bulk of `wearables.ts`; `intensity.ts` (3 of 6 unused); `strength.ts` (engine has its own copy); `shoes.ts` (`shoe-utils.ts` is parallel); bulk of `fueling.ts`.

### C. Design-tokens crosswalk

The redesigns reference colors and tokens defined in the canonical palette (`memory/project_color_palette.md`). Key tokens used:
- `--color-l0` through `--color-l4` — light/dark surface levels
- `--color-t0` through `--color-t3` — text emphasis levels
- `--color-corporate` — primary blue (active runs / corporate band)
- `--color-attention` — orange (today, calls-to-action)
- `--color-success`, `--color-warning` — semantic status
- `--font-display` (Oswald), `--font-data` (mono caps), body system
- Race gradients are sacred — never modified.

### D. Recommendations queue (top 10, ordered by ROI)

These recommendations come from sections 6 and 7 plus the redesigns in section 8.

**1. Wire runner profile to server-side CoachState (M).** Mirror `lib/runner-profile.ts` to a Postgres `runner_profile` table; `gatherCoachState()` reads it. Unlocks every age- and HRmax-dependent doctrine pathway. The 152 BPM magic number becomes per-runner. `AGE_DEFAULTS_BY_DECADE` becomes consumable. **This is the single highest-leverage change in the entire backlog.**

**2. Build a real /workout/[date] page (M).** Replace static placeholder with engine-driven data. Pull `coachDaily(state).today` for the requested date. Largest remaining placeholder. Every link from dashboard week-strip + 30-day-strip lands here.

**3. Eliminate doctrine-inlining (S–M).** HydrationTile + FuelingTile + NoVdotPanel currently hand-inline doctrine numbers. Convert to imports. Add a build-time check that flags inline-number patterns where an importable doctrine constant exists.

**4. Reconcile the long-run cap math (S).** Pick one source — engine's `longRunTarget` ratios or dashboard's TrainingPulseTile ratios — and have the other read from it. Currently TAPER `× 0.65` vs `× 0.6`, POST-RACE `× 0.4` vs `× 0.5`, REBUILD `× 0.6` vs `× 0.7`. Trust erosion.

**5. Wire `recovery_protocols.ts` POST_RACE_BY_DISTANCE + REVERSE_TAPER_PROTOCOL into the engine (M).** Replace engine's hand-coded post-race ladder with doctrine-driven lookups.

**6. Build a `/season` page (M).** Strategic race calendar. Multi-race seasons are reality; the app currently treats each race as solo.

**7. Build a `/calibration` page (S–M).** Every dial in one place. High trust value, low complexity (just renders existing state + doctrine).

**8. Surface SWEAT_RATE_PROTOCOL + EAH_RISK_FACTORS in HydrationTile (S).** Generic distance × temp bands aren't enough.

**9. Add a "how did that feel" RPE input on every prescribed workout (S).** Highest-leverage missing input. Doctrine 00b's `INCOMPLETE_RECOVERY_QUALITATIVE_SIGNALS` becomes consumable.

**10. Wire HRmax to engine's "yesterday was hard" gate (S, depends on #1).** Replace `coach-engine.ts:391` `HARD_EFFORT_HR_DEFAULT_BPM = 152` with `0.80 × runner.hrmax`.

### E. Notes deliberately deprioritized

- Pacing strategy editor — current Minetti-derived per-segment is good without intervention.
- Travel / jet lag — high doctrine quality, rare event, can wait until #1 unlocks runner identity.
- Mental training visualizations (PETTLEP) — soft compared to operational items.
- Form-corrections doctrine (Research/21) — needs extraction first.
- The `/library` page — useful but lower urgency than fixing `/workout/[date]`.
- The `/research` page — lovely but not on the critical path; can ship after the engine is fully wired.
- The `/patterns` page — requires a year of completion-history data that few users will have.

### E.5 The 4-week and 12-week roadmap

Given the priority queue in section D, here's a concrete sequencing.

**Week 1 (the unlock week)**
- Day 1-2: Schema migration adding `runner_profile` to Postgres. Mirror lib/runner-profile.ts to server.
- Day 3-4: gatherCoachState() rewrite — adds `state.runner` field with age, sex, weight, hrmaxBpm, lthrBpm, rhrBpm.
- Day 5: Replace `coach-engine.ts:391` HARD_EFFORT_HR_DEFAULT_BPM constant with per-runner derivation.
- Weekend: deploy + verify per-runner HR gating works on the dashboard.

**Week 2 (the placeholder kill week)**
- Day 1-3: Build /workout/[date] real implementation. Hero + structure + history + conditions + shoe + send-to-device.
- Day 4: Add post-workout RPE input (saves to activity row in Postgres).
- Day 5: Wire the prescription-history table for "Your History" tile.
- Weekend: deploy + verify week-strip clicks land on real data.

**Week 3 (the doctrine integrity week)**
- Day 1-2: Eliminate inline doctrine in HydrationTile + FuelingTile + NoVdotPanel.
- Day 3: Reconcile long-run cap math between TrainingPulseTile and engine longRunTarget.
- Day 4: Wire recovery_protocols.ts POST_RACE_BY_DISTANCE + REVERSE_TAPER_PROTOCOL into engine.
- Day 5: Replace engine's hand-coded post-race ladder.
- Weekend: deploy + audit for new doctrine drift.

**Week 4 (the season+calibration week)**
- Day 1-3: Build /season page — race timeline, phase blocks, fitness projection, conflict detection.
- Day 4-5: Build /calibration page — every dial in one place.
- Weekend: deploy + soft launch to test users.

**Weeks 5-8 (the redesign deepening)**
- Dashboard mode-aware composition.
- Training page macro-redesign (build curve + quality-day grid).
- Race detail expansion (similar races, course implications, A/B/C goals).
- Run detail expansion (prescription context, plan-vs-actual).

**Weeks 9-12 (the experiential layer)**
- Profile expansion (cycle, health flags, equipment, connections).
- Health page redesign (Recovery score, HRV, RHR, sleep, load, cycle).
- "I'm worried about" race-week prompts.
- /patterns page if data is sufficient.
- Coach.retrospect wiring.

This sequence frontloads the architectural unlocks (week 1-3) before the redesign work (week 4+). The redesigns assume hub-as-backbone is in place.

### E.6 What "done" looks like

The North Star: a runner who opens the app cold sees, within 5 seconds, exactly what they need to do today, why, and how it fits their goal. They can drill into any number on screen to see its source. They can see the arc of their season, the rhythm of their week, the structure of today's session. The coach has memory across weeks, asks how the runner feels, names the patterns the runner doesn't see, and pushes back when goals are unrealistic. The app is *coaching*, not just dashboarding.

We are roughly 60% of the way there. The remaining 40% is the redesign.

### E.7 Design tokens and visual language guardrails

The redesigns assume the existing palette holds. Per `memory/project_color_palette.md`:

- The 4 priority colors (race / recovery / active / warn / milestone) are canonical.
- Race gradients are sacred — never modified.
- Wash variants exist for surface tinting (race-wash, recovery-wash, active-wash).
- L0-L4 lightness scale and T0-T3 text emphasis scale are invariant.

Specific guardrails for the redesigns:

1. **Don't introduce new accent colors.** The redesigns reuse existing tokens. If a tile needs visual distinction, use a wash variant and a typographic emphasis change rather than a new hue.

2. **Mode shifts use background tone, not chrome.** Race-day mode tints the hero in race-wash. Recovery-alert tints the hero in warn-wash. The runner sees mode at a glance without UI elements changing position.

3. **Doctrine citations use a consistent typography pattern.** "Research/N §X.Y" is always rendered in `--font-data` mono caps with `--color-t3`. Citations are visually consistent across the app.

4. **The "?" affordance.** A small information glyph (12-14px) in `--color-t3` next to any number that has a traceable source. Tapping reveals a small popover with source/formula/citation.

5. **Empty states are visually distinct from loaded states.** Empty: dashed border, no fill. Loaded: solid border, fill. The dashboard's HealthKit placeholder grid uses dashed borders correctly today; the pattern should generalize.

6. **The hero is always full-width, always tile-styled, always above the fold.** Even when the hero is a recovery alert, it occupies the same real estate as the workout-of-the-day hero would. The runner's eye lands in the same place.

### E.8 Component reuse plan

The dashboard's tiles are inlined as private components. To support the redesigns, several need extraction to `web/components/`:

| Component | Currently in | Should move to | Used by |
|---|---|---|---|
| HrZonesTile | `app/page.tsx` | `web/components/calibration/HrZonesTile.tsx` | dashboard, calibration, profile |
| VdotTile | `app/page.tsx` | `web/components/calibration/VdotTile.tsx` | dashboard, calibration, run-detail |
| ReadinessBanner | `app/page.tsx` | `web/components/coaching/ReadinessBanner.tsx` | dashboard, run-detail |
| CoachDailyBrief | `app/page.tsx` | `web/components/coaching/CoachDailyBrief.tsx` | dashboard, training, today |
| Next30DaysTile | `app/page.tsx` | `web/components/training/Next30DaysTile.tsx` | dashboard, training, season |
| TrainingPulseTile | `app/page.tsx` | `web/components/training/TrainingPulseTile.tsx` | dashboard, training |
| PhaseGuidanceCard | `app/page.tsx` | `web/components/coaching/PhaseGuidanceCard.tsx` | dashboard, training |
| HydrationTile | `app/races/[slug]/page.tsx` | `web/components/race/HydrationTile.tsx` | race-detail, calibration, /workout |
| FuelingTile | `app/races/[slug]/page.tsx` | `web/components/race/FuelingTile.tsx` | race-detail, calibration |
| WeatherTile | `app/races/[slug]/page.tsx` | `web/components/race/WeatherTile.tsx` | race-detail, /workout (conditions) |
| CoachBriefBlock | `app/races/[slug]/page.tsx` | `web/components/coaching/CoachBriefBlock.tsx` | race-detail, training |

Extraction is mechanical. The components are mostly self-contained — they take typed props, do their own rendering, don't touch Next.js routing. The work is ~1-2 days and unlocks reuse across all 14 redesigned pages.

### E.9 The data-graph diagram

The hub-as-backbone metaphor is concrete: every page is a *projection* of `RunnerHub`, and the hub's data graph looks like:

```
                     ┌─────────────┐
                     │  Strava     │
                     │  Postgres   │
                     │  HealthKit  │
                     └──────┬──────┘
                            │ ingest
                            ▼
                     ┌─────────────┐
                     │  RunnerHub  │
                     │             │
                     │  - identity │
                     │  - history  │
                     │  - races    │
                     │  - state    │
                     │  - prescrip.│
                     │  - retro    │
                     └──────┬──────┘
                            │ project
              ┌─────────────┴─────────────┐
              │             │             │
        ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
        │  Page A   │ │  Page B   │ │  Page C   │
        │ /         │ │ /training │ │ /races/x  │
        └───────────┘ └───────────┘ └───────────┘
              │
              ▼
       ┌──────────────┐
       │  Components  │
       │  (extracted) │
       └──────────────┘
```

Each page subscribes to the slice of hub it cares about. Components subscribe to the slice they render. When the hub changes, every page's affected components re-render. There is one canonical place where data lives.

This is the architecture the user described: "one source of truth, tons of ways to use it."

### F. The North Star

The hub-as-backbone vision: **one source of truth, many ways to use it.**

Concretely: every page is a *projection* of `RunnerHub` state. Every number on every page traces back to a single canonical source. Doctrine drift is impossible because constants are imported, not inlined. Mode-aware composition replaces page-multiplication. The runner gets the same coach intelligence on every surface, customized to the question they're asking.

This document maps the path. Section 8 says where we're going. Sections 1-7 say where we are.

The next 2-3 weeks of work should focus on:
- Recommendation #1 (server-side runner profile) — unlocks everything else.
- Recommendation #2 (real /workout/[date]) — removes the most-visible placeholder.
- Recommendation #3 (eliminate doctrine inlining) — installs structural integrity.
- Recommendation #4 (reconcile long-run cap) — restores trust.

Then the redesigns in sections 8a-8j become the layer cake on top.
