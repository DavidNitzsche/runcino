# Runcino Codebase Audit — 2026-05-08 (final)

End-of-session synthetic review. Replaces `docs/AUDIT-2026-05-08.md` and reflects what landed today: VDOT pipeline (tier + freshness + grading + no-data state), 5K time-trial as a stale-VDOT remediation, next-30-days dashboard tile, daily training voice paragraph, readiness banner with doctrine-backed signals, hydration tile on race detail, HR-zones tile, easy-ratio classifier rewrite, training pulse phase/quality reconciled with engine, force-pushed `main` to match production.

**Scope:** `web/` codebase at branch `claude/objective-black-8f3e69`, Research doctrine at `/Volumes/WP/06 Claude Code/Runcino/Research/`, 25 numbered research files (added 24-vdot-age-sex-grading.md this session).

**Method:** static read of every page, every doctrine constant export, every consumer import path. References are `file:line` where it matters.

---

## 1. Research doc coverage matrix (UPDATED)

The Research/ folder has **24 numbered .md files** (Research/23 is reserved/empty; the new file is 24-vdot-age-sex-grading.md) plus 5 meta files. The `web/coach/doctrine/` folder has **35 .ts files** (added `grading.ts`). Mapping is roughly 1:1 by topic.

A doctrine file is **WIRED** when at least one of its constants is imported and consumed by `web/lib/*` engine code, `web/coach/coach.ts`, `web/coach/explanations.ts`, `web/app/api/*/route.ts`, or a UI tile. The consumer set has expanded since the prior audit — `runner-profile.ts`, `app/page.tsx` (HrZonesTile, VdotTile, PhaseGuidanceCard), and `app/races/[slug]/page.tsx` (HydrationTile) now read doctrine directly.

| # | Research file | Doctrine file(s) | Status | Δ since 5/7 audit | What's covered | What's NOT yet wired |
|---|---|---|---|---|---|---|
| 00a | distance-running-training.md | concepts split across `intensity.ts`, `volume.ts`, `recovery.ts` | PARTIAL | unchanged | `POLARIZED_DISTRIBUTION`, `PYRAMIDAL_DISTRIBUTION`, `THRESHOLD_DISTRIBUTION` (intensity.ts), `LONG_RUN`, `STRIDES`, `SLEEP` via `coach-principles.ts:174-181` | `PHASE_DISTRIBUTION_RECOMMENDATION`, `VOLUME_MODEL_THRESHOLDS`, `NORWEGIAN_DOUBLE_THRESHOLD` (intensity.ts:69-136) — defined, never imported |
| 00b | recovery-protocols.md | `recovery_protocols.ts` (22 exports) | **PARTIAL ⬆ (was UNWIRED)** | `INCOMPLETE_RECOVERY_DECISION_MATRIX` is now consumed indirectly by `coach.assessReadiness` (`coach.ts:471-480`) — the engine collects volume/intensity/race-recovery signals + maps signal-count to action ("continue / 24-48h defer / 3-5d cutback / full cutback / stop"); citation surfaces in the readiness card | `POST_RACE_BY_DISTANCE`, `MARATHON_BIOMARKER_TIMELINE`, `REVERSE_TAPER_PROTOCOL`, `MARATHON_RECOVERY_4WK_REVERSE_TAPER`, `MULTI_RACE_CADENCE`, `CARBON_PLATE_RECOVERY_EFFECTS`, `INCOMPLETE_RECOVERY_QUALITATIVE_SIGNALS`, `RECOVERY_TIMESCALES`, `HARD_EASY_ALTERNATION_RULES`, `RECOVERY_VS_EASY_RUN`, `SLEEP_TIERS`, `SLEEP_EXTENSION_PROTOCOL`, `POST_SESSION_NUTRITION_WINDOWS`, `RECOVERY_MODALITY_TIERS`, `CUTBACK_*`, `RACE_PRIORITY_RECOVERY`, `TISSUE_RECOVERY_TIMELINES`, `RECOVERY_HIERARCHY`. Engine still uses its own ad-hoc post-race ladder (`coach-engine.ts:271-321`). |
| 01 | pace-zones-vdot.md | `pace_zones.ts` (~30 exports) | **WIRED ⬆⬆ (was WIRED, now richer)** | New consumers: `VDOT_TIERS` + `vdotTierFor` + `VDOT_FRESHNESS_WINDOW` + `vdotFreshnessFor` + `VDOT_FIELD_TESTS` + `VDOT_TEST_TRIGGERS` (all in `lib/vdot.ts:24-353` and `app/page.tsx:1318` NoVdotPanel + `app/page.tsx:1383` freshness chip). Pace bands now also feed `lib/strava-stats.ts:effortBalance` for VDOT-aware classification. | `DANIELS_PACE_OFFSETS_S_PER_MI` (legacy fallback path), `HANSONS_PACE_OFFSETS_S_PER_MI`, `MCMILLAN_PRINCIPLES`, `PFITZINGER_ZONES`, `WORKOUT_PACE_PRESCRIPTION`, `MARATHON_VDOT_CORRECTION` (engine doesn't apply it), `RIEGEL_FATIGUE_EXPONENT`, `PACE_LOCK_BY_SITUATION` |
| 02 | race-time-prediction.md | `race_prediction.ts` (16 exports) | UNWIRED | unchanged | None | All 16 — Riegel, Cameron, McMillan runner types, asymmetry rules, multi-race weights, age grading. App still uses VDOT lookup for race-equivalent only. |
| 03 | heart-rate-zones.md | `hr_zones.ts` (23 exports) | **PARTIAL ⬆ (was PARTIAL, much wider now)** | `HRMAX_ZONES_5` is now a real consumer — `app/page.tsx:1217-1278` HrZonesTile renders the full 5-zone band table, computed from a per-runner HRmax (measured or Tanaka-estimated via `lib/runner-profile.ts:resolveHrmax`). The "152 bpm" magic number is still in `coach-engine.ts:391` (`HARD_EFFORT_HR_DEFAULT_BPM`) but a comment at `coach.ts:489` cites `HRMAX_ZONES_5` as its origin. | `HRMAX_ZONES_7`, `KARVONEN_FORMULA`, `LTHR_30MIN_TT_PROTOCOL`, `FRIEL_LTHR_ZONES`, `HRMAX_FIELD_TEST_PROTOCOLS`, `HRV_INTERPRETATION_PATTERNS`, `RHR_RECOVERY_DECISION_RULES`, `HR_VS_PACE_DIVERGENCE`, `PA_HR_DECOUPLING_BANDS`, `HR_UTILITY_BY_REP_DURATION`, `COACH_BY_METRIC_DECISION`, `HR_SENSOR_ACCURACY`, `HR_SYSTEM_PICKER`, `HR_SYSTEM_CROSSWALK`, `HR_COACHING_HEURISTICS`, `HR_CONFOUNDERS`, MAF formula |
| 04 | workout-vocabulary.md | `workouts.ts` (26 exports) | PARTIAL | unchanged + new `vdot_test_5k` workout type | The 16 `RunWorkoutType` slugs in `coach-workouts.ts:18-35` (added `vdot_test_5k` at line 266) match the doctrine vocabulary; `LONG_RUN` and `STRIDES` constants read via `coach-principles.ts` | The 23 other constants (`THRESHOLD_INTERVALS_PROTOCOL`, `VO2_REPS_PROTOCOL`, `MARATHON_PACE_BLOCK`, `PROGRESSION_PROTOCOL`, `HILL_REPS_PROTOCOL`, `STRIDE_GUIDELINES`, etc.) — engine still hardcodes rep schemes in `coach-workouts.ts:101+`. The `/workout/[date]` page is still entirely static placeholder. |
| 05 | injury-return-protocols.md | `injury_return.ts` (6 exports) | UNWIRED | unchanged | None | `WALK_RUN_PROTOCOL`, `PAIN_MONITORING_RULES`, INJURY_CATALOG. No injury intake anywhere. `coach.adjustForReality` is a Stage-5 stub. |
| 06 | weather-adjustments.md | `weather.ts` (22 exports) | WIRED | unchanged | `MAUGHAN_HEAT_SLOWDOWN`, `TEMP_DEWPOINT_SUM_ADJUSTMENT`, `DEWPOINT_PACE_ADJUSTMENT`, `ALTITUDE_RACE_LOSS`, `WIND_PER_MILE_COST`, `SINGLE_NUMBER_HEAT_FALLBACK`, `QUALITY_SESSION_BAIL_TRIGGERS`, `HARD_CANCEL_TRIGGERS` consumed by `lib/weather-slowdown.ts`. Used in `briefRaceMorning` (coach.ts:506-744). | `WBGT_FLAGS`, `WBGT_COMPUTATION`, `HEAT_ACCLIMATION_*`, `LHTL_PROTOCOL`, `AQI_THRESHOLDS`, `HEAT_ILLNESS_WARNING_SIGNS`, `COLD_PERFORMANCE_IMPACT`, `WIND_CHILL_THRESHOLDS` |
| 07 | strength-programming.md | `strength.ts` (5 exports) | PARTIAL | unchanged | `STRENGTH_PERIODIZATION` mirrored by hand in `coach-principles.ts:201-222`; coincidence not import. | `HEAVY_RESISTANCE`, `PLYOMETRICS`, `STRENGTH_INJURY_REDUCTION_PCT`, `AMP_MODES` |
| 08 | pacing-and-race-week.md | `pacing.ts` (18 exports), `race_week.ts` (19 exports) | PARTIAL | unchanged | `pacing.ts` consumed in `lib/pacing.ts` (Minetti grade-adjusted-pace). Brief cites §3.5 (coach.ts:606). | `race_week.ts`'s 19 constants — taper specifics, race-week meal logistics, sleep banking, kit dress rehearsal — defined, never imported. |
| 09 | cross-training.md | `cross_training.ts` (5 exports) | UNWIRED | unchanged | None | `XT_DECISION_RULES`, `XT_CARRYOVER_MATRIX`, modality lookup. No XT substitution path in app. |
| 10 | mobility-warmup.md | `mobility.ts` (7 exports) | UNWIRED | unchanged | None | `WARMUP_RATIONALE`, `DYNAMIC_WARMUP_PROTOCOL`, `DAILY_MOBILITY_ROUTINE`, RAMP framework. |
| 11 | course-specific-training.md | `course.ts` (6 exports) | PARTIAL | unchanged | `course-facts.ts` legacy file feeds the race detail page with hand-curated facts. `course.ts` doctrine constants defined but unused. | Hill repeats / down-hill protocols, surface adjustments, altitude prep timing. |
| 12 | travel-timezone.md | `travel.ts` (5 exports) | UNWIRED | unchanged | None | `TRAVEL_ARRIVAL`, `EAST_WEST_ASYMMETRY`, jet-lag protocols. |
| 13 | sex-specific-training.md | `sex.ts` (6 exports) | UNWIRED | unchanged | None | `MENSTRUAL_CYCLE_GUIDANCE`, `HORMONAL_CONTRACEPTION_NOTES`, RED-S, iron deficiency. CoachState + runner profile have NO cycle log. (Profile has sex field for grading only.) |
| 14 | age-considerations.md | `age.ts` (5 exports) | UNWIRED | unchanged at server side; **PARTIAL on client** | None on server. **Client side: `lib/runner-profile.ts:birthYear` is read by `app/page.tsx:1370` VdotTile + age-grading via `coach/doctrine/grading.ts:gradeVdot`.** | `AGE_DEFAULTS_BY_DECADE` (engine-side prescription not yet age-aware), `VO2MAX_DECLINE_CURVE`, age-specific recovery rules |
| 15 | wearable-data.md | `wearables.ts` (5 exports) | PARTIAL | unchanged | ACWR consumed by `coach-principles.ts:121-126`. | `TRIMP`, `TSS`, `monotony`, `strain`, EWMA-ACWR, illness early signals, `DEVICE_SOURCE_OF_TRUTH` |
| 16 | form-biomechanics.md | `cadence.ts` (3 exports) | UNWIRED | unchanged | None | Cadence guidelines, form benchmarks. /runs/[id] shows cadence but no target. |
| 17 | footwear.md | `shoes.ts` (4 exports) | PARTIAL | unchanged | Shoe closet uses `lib/shoe-utils.ts` (parallel source of truth). | `shoes.ts` doctrine constants. |
| 18 | fueling-products.md | `fueling.ts` (7 exports) | PARTIAL | unchanged | `RACE_CARB_TARGETS_G_PER_HR`, `GLUCOSE_FRUCTOSE_RATIO`, `CARB_LOAD_24_48HR`, `PRE_RACE_MEAL`, `HYDRATION` defined; `lib/fueling-claude.ts` + `lib/fueling.ts` are the active code paths and don't import doctrine. | The 80-100 g/hr default + 120 g/hr stretch. Pre-race carb loading per-kg numbers. |
| 19 | hydration-electrolytes.md | `hydration.ts` (12 exports) | **PARTIAL ⬆ (was UNWIRED)** | `app/races/[slug]/page.tsx:848-948` HydrationTile renders pre-race blocks (24h / 2-4h / final hour) + during-race ml/hr table by distance × temperature. The numbers come from PRE_RACE_HYDRATION + FLUID_DURING_RACE BUT they're hand-inlined into the tile rather than imported from `hydration.ts` — same problem as fueling: parallel sources of truth. | `DAILY_HYDRATION_BASELINE`, `HYDRATION_STATUS_INDICATORS`, `HYDRATION_STRATEGY_BY_SCENARIO`, `SODIUM_INTAKE_BY_SCENARIO`, `EAH_RISK_FACTORS`, `EAH_PREVENTION_AND_TREATMENT`, `EAH_CLASSIFICATION`, `SWEAT_RATE_PROTOCOL`, `SWEAT_SODIUM_CLASSIFICATIONS`, `DEHYDRATION_PERFORMANCE_IMPACT` |
| 20 | mental-training.md | `mental.ts` (13 exports) | UNWIRED | unchanged | None | A/B/C goals, PETTLEP, self-talk catalog, pre-race anxiety, post-race blues, DNF rules, burnout warnings |
| 21 | form-corrections.md | (no doctrine file) | UNWIRED | unchanged | None | Per-error drill catalog |
| 22 | plan-templates.md | `plan_templates.ts` (4 exports) | WIRED | unchanged | `PLAN_TEMPLATES` consumed by `lib/coach-plan.ts:19,50` and orchestrated by `coach-engine.ts:231-237`. | Template selection is currently distance + experience-level only. |
| 24 | **vdot-age-sex-grading.md (NEW)** | **`grading.ts` (3 exports + gradeVdot fn)** | **WIRED ✨** | New file added this session. | `VDOT_AGE_DECLINE_MALE`, `VDOT_AGE_DECLINE_FEMALE`, `VDOT_SEX_COHORT_OFFSET`, `gradeVdot()` consumed by `app/page.tsx:1372` — VdotTile shows age-graded VDOT inline when birth year + sex are known and the grade differs from raw by ≥1.0 VDOT. | World Masters Athletics tables (planned future replacement for the simplified Daniels per-decade model). |
| — | INDEX.md / GLOSSARY.md / SOURCES.md | — | n/a | unchanged | Manual TOC / definitions / provenance | — |

### Coverage summary (Δ from prior audit)

| Bucket | Prior count | Current count | Δ |
|---|---|---|---|
| Fully WIRED | 4 (01, 06, 22, partial 03) | **6** (01, 06, 22, 24 new, +HR-5-zone, +grading) | +2 |
| PARTIAL | 9 | **11** (added 00b for readiness signals; 19 for hydration tile; 14 client-side via runner profile) | +2 |
| UNWIRED doctrine file | 11 | **9** (00b + 19 promoted) | -2 |
| Research file with no doctrine file | 1 (Research/21) | 1 | 0 |

The needle moved meaningfully on three doctrine files (00b, 19, 14-client-side) plus the brand-new 24. Everything else held the same wiring posture as the morning audit.

---

## 2. UI surface inventory

Eight live page roots under `web/app/`. Page sizes (lines): `page.tsx` 2198, `training/page.tsx` 672, `races/[slug]/page.tsx` 2056, `profile/page.tsx` 596, `health/page.tsx` 220, `log/page.tsx` 462, `runs/[id]/page.tsx` 450, `workout/[date]/page.tsx` 520, `races/page.tsx` 400.

### `app/page.tsx` — Overview / Hub (2198 lines, +719 since prior audit)

Render order (page.tsx:65-103):

1. `Greeting` (line 124) — name display, race-day callout chip. Live.
2. **Top-tile row** (line 74-79):
   - `NextRaceCard` (line 175): next race name, days-out, goal. Live.
   - `RecentRunCard` (line 215): last Strava run distance/pace/name. Live.
   - `WeeklyMilesCard` (line 246): this-week sum + 4-week mini bar chart. Live.
   - `YearMilesCard` (line 279): YTD miles + total elev + longest. Live.
3. **Mid row** (line 81-84):
   - `ThisWeekTile` (line 317): 7-day calendar bar chart of completed Strava miles. Live.
   - `TodayTile` (line 380): "ran today" status, race-day override. Live.
4. `CoachTodayCard` (line 520) — the legacy v1 daily card. **Significantly expanded since last audit**:
   - **`ReadinessBanner`** (line 883, NEW): green/yellow/red verdict from `coach.assessReadiness`. Renders inline at top of card when level ≠ green or signals exist (line 617). Shows `acwr` + `easyShare` chips, message sentence, and an expandable `▸ N SIGNALS` toggle that reveals each detected signal (heavy-block, race-recovery, ACWR-out-of-band, ACWR-running-hot, ACWR-low, easy-imbalance, missed-runs) + the `recommendedAction` from doctrine 00b decision matrix.
   - Run + Strength prescription side-by-side.
   - **`CoachDailyBrief`** (line 962, NEW): voice paragraph from `coach.briefDailyTraining`. Shows `▸ WHY?` toggle exposing engine rationale + voice rationale + research citations. Renders a `FALLBACK · NO API KEY` chip when `brain === 'deterministic'`. Live.
   - 7-cell week-shape grid with strength chips.
5. **`PhaseGuidanceCard`** (line 1205, NEW): hidden in BASE/BUILD/PEAK; surfaces in TAPER / POST_RACE / REBUILD with research-backed phase guidance. Imports `TAPER_VOLUME_REDUCTION`, `TAPER_INTENSITY_PRESERVATION`, `TAPER_ERRORS`, `TAPER_BENEFIT`, `POST_RACE_STAGES` from `coach/doctrine`. Live.
6. **`Next30DaysCard`** (line 1047, NEW): 30-cell strip color-coded by workout type from `payload.next30Days`. Long runs taller, races flagged with priority-colored top bar. Footer race callouts + legend. Live.
7. **`VdotCard`** (line 1281, NEW pipeline):
   - When VDOT is unavailable AND `vdotTestPrompt` is true → renders **`NoVdotPanel`** (line 1318) with 4 field-test option cards (5K TT / 30-min TT / 3K+5K combo / "race anything").
   - When VDOT present → **`VdotTile`** (line 1359) with big number, **tier badge** (`novice`/`intermediate`/`advanced`/`elite`, color-coded), **freshness chip** (`FRESH`/`STALE SOON`/`STALE`/`EXPIRED`), source race, paces. Includes inline **age-graded VDOT** line when birth year + sex are configured (`gradeVdot` from `coach/doctrine/grading.ts`) — only renders when raw vs graded ≥1.0 to avoid noise. Live.
   - Stale/expired chip prompts: *"Coach can plan a 5K time trial — see today's prescription."*
8. **`HrZonesCard`** (line 1205, NEW): hides itself when neither HRmax nor age is known. Otherwise renders 5-zone band table from `HRMAX_ZONES_5` × resolved HRmax (measured or Tanaka). Footer disclaimer when source is `tanaka_estimate`. Live.
9. `RecoveryWidget` (line 1975) — Pause Studio City credits + scheduled recovery sessions. Live.
10. `TrainingPulseTile` (line 1493) — **reconciled** with engine: phase chip + easyShare target now read from `/api/coach/today` (line 1503-1540). Long-run cap stat added (Daniels +10% × phase ceiling, line 1697-1718). Quality-day-this-week count vs phase target added (line 1647-1661). Easy ratio uses VDOT-aware classifier (line 1577).
11. `YearHeatmapSection` (line 1783) — GitHub-style contribution grid. Live.
12. `FunStatsSection` (line 1891) — comparator cards. Live.

### `app/races/page.tsx` — Race index (400 lines, unchanged)
- `UpcomingRaceHero` + `RaceCard` grid + `EmptyState`. Live.

### `app/races/[slug]/page.tsx` — Race detail (2056 lines, +175 since prior)
- `PosterCard` (line 322) — hero, course map, narrative, 4-up stats, inline goal-time edit, phase legend, elevation chart.
  - **`CoachBriefBlock`** (line 1648) embedded inside the description column for upcoming races. The brief itself has had its `▸ WHY?` toggle wired in this session (mirrors the daily brief affordance) so citations render inline beneath the paragraph when the user expands. Adaptive horizon — `briefTitleFor()` switches between course / approach / race-week / race-morning.
- `PhaseCards` (line 626) — per-phase stacked cards. Live.
- `MileSplits` (line 690) and `FuelingTile` (line 797) — two-column row. Live.
- **`HydrationTile`** (line 848, NEW) — pre-race blocks (24h/2-4h/final hour) + during-race ml/hr table indexed by race distance bucket × 4 temp bands (cool/temperate/warm/hot). Numbers cited to Research/19 — but copied inline rather than imported from `coach/doctrine/hydration.ts`. Live.
- `ResultSection` (line 958) post-race only:
  - `PerPhaseTable` (line 1031): plan vs actual per phase + delta + avgHR.
  - `PerMileTable` (line 1106): per-mile target/actual/delta/HR/Δelev.
  - `RaceMetaTile`: suffer/kudos/achievements/best-efforts.
  - `ResultForm`: finish + PR + notes.
- `WeatherTile` (line 1279) — NOAA forecast (≤7d) or Open-Meteo historical (>7d). Live.
- `useAdaptiveBrief` hook (line 1541) — single source of truth for /api/brief calls.
- `briefTitleFor()` (line 1634) — horizon → label mapping.
- `EditRaceModal` (line 1660), `ExportFooter` (line 1605).

### `app/training/page.tsx` — Daily briefing (672 lines)
- `DailyBriefing` (line 156): masthead, big Oswald date, phase line with orange dot, Oswald workout title, two-column lead (`voiceLead` + stats sidebar), 7-cell week-strip, Next-up list. Reads `coach.workout.answer` from `/api/coach/today` (the prescription with the composed `voiceLead`).
- `RecentWeeksTile` (line 426) — last-12-weeks bar chart.
- The voice-paragraph divergence with the dashboard noted in the prior audit is unchanged: dashboard's `CoachTodayCard` shows engine-rationale + the new `briefDailyTraining` LLM voice; training page shows the engine's per-prescription `voiceLead` from `coach/explanations.ts:composeVoiceLead`. Two voice surfaces, two distinct copy paths.

### `app/log/page.tsx` — Run log (462 lines, unchanged)
- `PRShelf`, `RacesShelf`, `RunFeed`, `ConnectStravaBanner`. Live.

### `app/runs/[id]/page.tsx` — Single run (450 lines, unchanged)
- `RoutePoly`, `StatsTile`, `ShoeTile`, `BestEffortsTile`, `SplitsTable`, `DescriptionTile`. Live.

### `app/health/page.tsx` — Health (220 lines, unchanged)
- `FromStravaPanel` live; HealthKit metrics grid (4 cards) is **still M2 placeholder**. Critical: now that `/profile` could optionally hold HRmax + RHR, the placeholder is even more out of place — three of those four cards (RHR, HRV, Recovery score) could surface real numbers from the runner profile, but the page still shows `—`.

### `app/profile/page.tsx` — Profile (596 lines, +135 since prior)
- **`RunnerProfileSection` (NEW)**: birth year, sex, HRmax, RHR fields with explanations of when each matters. Persists to localStorage via `lib/runner-profile.ts`. Confirms tier-changing on save. The HRmax + RHR fields drive the dashboard's HrZonesCard.
- Long-run-day picker still local-only (unchanged from prior audit — still doesn't reach the engine).
- Shoe closet (line 121-167) — server-backed via `/api/shoes`. Live.
- `ShoeForm` modal — full add/edit with auto-cap suggestion.

### `app/workout/[date]/page.tsx` — Workout detail (520 lines, unchanged — ENTIRELY STATIC PLACEHOLDER)
Same situation as the prior audit. None of: HeroTile, WhyTile, StructureTile, PastAttemptsTile, SendToWatchTile, ConditionsTile, ShoeTile, FuelingTile is wired. This is still the most prominent placeholder surface in the app — every link from the dashboard's week strip lands here.

---

## 3. State + data flow

`gatherCoachState()` lives in `web/lib/coach-state.ts:217-415`. Invoked from `/api/coach/today` and `/api/brief` only (server-side).

### Reads (unchanged from prior audit)
- **Postgres**: `listRacesDB()` → saved races + `actualResult`
- **Strava cache**: `getCachedActivities()` → NormalizedActivity[]
- HealthKit: still always null (`flags.healthKitAvailable: false`, line 411)

### New / changed CoachState fields

| Field | Source | Consumer (Δ) |
|---|---|---|
| **`races.racesForVdot`** (NEW) | 56-day window from saved races + Strava-flagged races (Daniels' 8-week VDOT freshness rule) | `lib/vdot.ts:228` `pickStrongestRecentRace`, `lib/vdot.ts:310` `vdotSnapshot`. Walks racesForVdot for VDOT inference; `state.races.recent` (28d) stays scoped to heavy-block detection. |
| **`races.recent`** (semantics) | 28-day window | now ONLY used for heavy-block + recovery-window math, not VDOT |
| `intensity.easyShare14d` (semantics) | `effortBalance(activities, 14, 152, stateVdot)` (`coach-state.ts:323`) — **now passes derived VDOT** (line 314-322 quickVdotFromRace from racesForVdot) | engine alerts, readiness card, brief, training pulse |

**Critical: server-side state still has NO age, sex, HRmax, RHR.** Those live entirely in `localStorage` via `lib/runner-profile.ts`. Consequence:
- Engine prescriptions don't know runner age — `AGE_DEFAULTS_BY_DECADE` cannot consult.
- The 152 bpm hard-effort threshold in `coach-engine.ts:391` is still constant for everyone.
- The brief doesn't see sex/age, so it can't comment on age-grading or sex-cohort context.
- HRmax measured on the profile page only fuels the dashboard tile; it does NOT replace the 152 bpm magic number in the engine's quality-vs-easy gate.

### Computed but never read (unchanged)
- `races.nextAny` (always equals or supersets `nextA`)
- `races.raceCount30d` (only used in a single rationale string)
- `volume.last7Days` (UI computes its own week-day breakdown)
- `intensity.easyMi14d`, `intensity.hardMi14d` (only `easyShare14d` is read)
- `recovery.consecutiveRunDays`
- `recovery.hrv7dAvgMs`, `recovery.rhrBpm`, `recovery.sleep7dAvgHrs`, `recovery.strengthDaysThisWeek`
- `flags.healthKitAvailable`

### Critical gap: CoachState still has no
- **runner age / sex / weight (server-side)** — runner-profile.ts is browser-only
- **HRmax / LTHR (server-side)** — same
- injury flag
- travel state
- training preferences (long run day, days running per week)
- explicit phase override
- carb tolerance / GI calibration delta

---

## 4. Coach methods inventory

`web/coach/coach.ts` defines the `Coach` interface (lines 254-296) with **8 methods** (one new since prior audit).

### Method status

| Method | Stage | Implemented? | Brain | Δ |
|---|---|---|---|---|
| `paceStrategy` | 1 | **Stub** (throws) | — | unchanged |
| `taperDepth` | 1 | **Stub** | — | unchanged |
| `fuelingFor` | 1 | **Stub** | — | unchanged |
| `prescribeWorkout` | 3 | Wired | Deterministic | unchanged |
| `assessReadiness` | 3 | Wired | Deterministic | **richer**: now collects 6 signal types and maps to 5-tier `recommendedAction` per doctrine 00b decision matrix (`coach.ts:432-480`). Returns `signals[]` + `recommendedAction` in `ReadinessAssessment`. |
| `briefRaceMorning` | 2 | Wired | LLM with deterministic fallback | unchanged |
| **`briefDailyTraining`** (NEW) | — | **Wired** | LLM with deterministic fallback | New surface (`coach.ts:750-850`). Anchors on TODAY rather than a race. Takes `state` + already-computed `prescription` (CoachToday) + `vdot` snapshot + `vdotTestPrompt` flag. Deterministic fallback assembles a serviceable paragraph from structured pieces; LLM path gives the model the runner's full picture and asks for a short voice paragraph. Surfaces on the dashboard's CoachTodayCard via `CoachDailyBrief` with a `▸ WHY?` toggle exposing engine rationale + citations. |
| `retrospect` | 4 | **Stub** | — | unchanged |
| `adjustForReality` | 5 | **Stub** | — | unchanged |

Four methods now wired (was three); four still stub. The active surrogates for the stubbed methods:
- Pacing: `lib/pacing.ts` (Minetti grade-adjusted-pace direct call) — bypasses Coach.
- Taper: implicit in `lib/coach-principles.ts:weeklyVolumeMultiplier` and engine's TAPER phase logic.
- Fueling: `lib/fueling-claude.ts` (Claude SDK call) with `lib/fueling.ts` rule-based fallback — bypasses Coach.
- Retrospect: `/api/retrospective` calls `lib/retrospective.ts` + Anthropic SDK directly with its own RETROSPECTIVE_SYSTEM_PROMPT, not voice.md.
- adjustForReality: not exposed.

---

## 5. STAT ACCURACY AUDIT (NEW SECTION — load-bearing)

For each numerical stat surface on the dashboard + race detail, check the math, source, and context-awareness. Legend: ✓ correct · ❌ wrong · ⚠️ misleading · ❓ unverifiable.

### Dashboard tiles

#### `WeeklyMilesCard` (`page.tsx:246`)
- "X.X mi" headline: ✓ — sums `inWeek.distanceMi` from `runs` filtered by `thisWeekRange()` (Mon-Sun). `weeklyMiles(runs, 4)` for the 4-bar chart.
- "N RUNS" chip: ✓ — `inWeek.length`.
- 4-bar mini chart highlighting current week: ✓.

#### `YearMilesCard` (`page.tsx:279`)
- "X.XXX mi" YTD: ✓ — `rollupYear(runs).totalMiles`.
- "N RUNS" chip: ✓ — `r.totalRuns`.
- Sub line `{totalElevFt} ft climbed · longest {longestRunMi} mi`: ✓ — straight from rollup.

#### `RecentRunCard` (`page.tsx:215`)
- "X.X mi" + "M:SS/MI · BPM" — ✓; `lastRun` is the most-recent by `startLocal` from `onlyRuns(activities)`.
- Days-ago chip "TODAY / YESTERDAY / ND AGO": ✓ — `daysUntil(lastRun.date)`.

#### `ThisWeekTile` (`page.tsx:317`)
- 7-day bar chart from `currentWeekDays(runs)`: ✓ — produces calendar Mon-Sun with `isToday`/`isFuture`.
- "X.X mi" total: ✓ — sum of days.
- Per-bar mile labels above each bar: ✓.

#### `TodayTile` (`page.tsx:380`)
- "Ran today" surfaces from `runs.filter(r => r.date === todayISO())` (LA-tz aware): ✓.
- Race-today / race-tomorrow override: ✓.

#### `CoachTodayCard` — Run prescription (page.tsx:622-636)
- Workout type label + color: ✓ — pulled from `payload.today.type` × hand-curated `typeColor` map. New `vdot_test_5k` row added (line 576).
- "{distanceMi.toFixed(1)} MI" or "0 MI · REST DAY": ✓.
- "HR Z{hrZone}": ❓ — `hrZone` is set in `coach-workouts.ts` per workout type as a static 1-5 number; it's NOT yet computed from the runner's actual HRmax. **Misleading**: a 60-year-old with HRmax 165 sees the same "HR Z3" label as a 25-year-old with HRmax 200.
- Pace band "{lowS}-{highS}/MI": ✓ — comes from VDOT pipeline when fresh, falls through to engine's pace-offset table otherwise.
- Description: ✓ — engine builds from workout type + state.

#### `CoachTodayCard` — Alerts (page.tsx:589-610)
- Heavy-block alert: suppressed since description carries the message (engine.ts:430-437). ✓
- Post-race alert: suppressed for same reason. ✓
- Rebuild alert: ✓.
- Easy-share alert: phase-gated (only fires outside POST_RACE / REBUILD). ✓
- Taper-window info alert (≤14 days): ✓.
- ACWR-high warn: ✓.

#### `ReadinessBanner` (`page.tsx:883`)
- Level (`green`/`yellow`/`red`): ✓ — comes from `coach.assessReadiness` decision tree (`coach.ts:393-428`). Recovery context (heavyBlock / inRaceRecovery) overrides ratio drift correctly.
- ACWR chip: ✓ — `acwr(state)` = `volume.last7Mi / (volume.last28Mi/4)`.
- "{X}% EASY" chip: ✓ — from `state.intensity.easyShare14d`.
- Signals list: ✓ — built from same state.flags + ratio bands as the readiness verdict; severity correctly distinguishes heavy-block / race-recovery (info) from threshold breaches (warn).
- `recommendedAction`: ✓ — maps signal-count to action per doctrine 00b decision matrix (coach.ts:474-480). Cited in the readiness `citations[]`.

#### `CoachDailyBrief` (`page.tsx:962`)
- Voice paragraph: ✓ when LLM available; deterministic fallback when not. Stub chip surfaces correctly.
- WHY toggle: shows engine rationale + voice rationale + citations. ✓.

#### `Next30DaysTile` (`page.tsx:1071`)
- 30-day strip: ✓ — pulled from `payload.next30Days` produced by `coach-engine.ts:simulateNext30Days` (line 517-554), which advances state forward N days and re-runs the picker.
- Long runs render taller, rest cells shorter: ✓ — height keyed off `isLong`/`isRest`/`isQuality`.
- Race overlays from `inWindow` + `nextA`: ✓ — flagged with priority-colored top bar.
- "RACE FLAG" calltouts at the bottom: ✓ — sorted in display order.
- Header sub `"X mi · N quality · M long"`: ✓ — sums over `days`.
- ⚠️ The strip renders dates as visual cells but doesn't show which day is *actually today*. The `d.isToday` outline (line 1150) is set but easily missed. Minor.

#### `VdotTile` (`page.tsx:1359`)
- Big VDOT number `vdot.vdot.toFixed(1)`: ✓ — `vdotFromRace(distMi, timeS)` linearly interpolates the canonical `VDOT_LOOKUP_TABLE`, picking the best by VDOT across `racesForVdot` (56-day window).
- Tier badge label + color: ✓ — `vdotTierFor(vdot)` from `coach/doctrine/pace_zones.ts:VDOT_TIERS`. Color maps to t2/corporate/attention/warning.
- Freshness chip (`FRESH`/`STALE SOON`/`STALE`/`EXPIRED`): ✓ — `vdotFreshnessFor(daysAgo)` uses VDOT_FRESHNESS_WINDOW windows (≤4 / 4-8 / 8-12 / >12 weeks). When `stale`/`expired`, line 1424-1427 nudges to today's prescription (which the engine has already overridden to a 5K TT — see workout flow below).
- "Last tested · X days ago" + source race name + "X.XX MI · H:MM:SS · M:SS/MI": ✓.
- Age-graded line — only renders when birth year set + age > 30 + |graded - raw| ≥ 1. ✓ — well-gated to avoid false signal for under-30 runners.
- 5 pace bands E/M/T/I/R: ✓ — `pacesFromVdot(vdot)` builds bands from `marathonS/26.219` (M), `halfS/13.109` or `km15S/9.321` (T depending on VDOT), `km5S/3.107` (I), `mileS/1` (R), `M+75` (E). Bandwidths from `PACE_ZONE_WIDTH`.

#### `NoVdotPanel` (`page.tsx:1318`) — when no VDOT signal
- 4 field-test option cards (5K TT / 30-min TT / 3K+5K combo / "race anything"). ✓ — copy lines up with VDOT_FIELD_TESTS doctrine but is hand-curated (not imported).
- ⚠️ "Apply +1 VDOT correction for solo effort" appears in the 5K TT card but the engine doesn't actually apply this when a solo TT is logged. Doctrine has the correction; consumer doesn't.

#### `HrZonesTile` (`page.tsx:1216`)
- 5 zone bands `{lo}–{hi} BPM` × `{pctLow}–{pctHigh}% HRmax`: ✓ — math is `Math.round((def.pctLow / 100) * hrmax.bpm)` from HRMAX_ZONES_5 doctrine.
- Source label "HRmax X BPM · Tanaka estimate / measured": ✓ — `resolveHrmax` prefers measured, falls back to `208 - 0.7 × age`.
- ⚠️ When source is Tanaka estimate, the stated SE is ±10 BPM. The tile mentions this in the footer disclaimer ("±10 BPM SE") but the actual zone bands are computed as point estimates. Acceptable but worth noting that the bands are wider in reality than the displayed numbers suggest.

#### `PhaseGuidanceCard` (`page.tsx:1205`)
- Hidden in BASE / BUILD / PEAK; renders TAPER / POST_RACE / REBUILD with phase-specific copy + research-backed numerics: ✓.
- TAPER copy uses `TAPER_VOLUME_REDUCTION` + `TAPER_INTENSITY_PRESERVATION` + `TAPER_ERRORS` + `TAPER_BENEFIT`. ✓
- POST_RACE copy uses `POST_RACE_STAGES` (per-distance recovery stages). ✓.

#### `TrainingPulseTile` (`page.tsx:1493`)
- **Phase chip** — ✓ now reconciled with engine: line 1503-1540 fetches `/api/coach/today` and uses `today.phase` rather than `pulse.phase` heuristic. Falls back to local heuristic before fetch resolves.
- Phase descriptor sentence (line 1555-1566): ✓ — phase × (daysToRace + raceName) → text.
- Phase-color-keyed 8-week bar chart with current-week highlight: ✓.
- "Weekly avg X.X mi" with delta-vs-prior-4w chip: ✓ — uses `pulse.weeklyAvg` + `pulse.deltaPct`.
- "Long run avg" — `pulse.longRunAvgMi` is the avg of the longest run from each of the last 4 weeks. ✓.
- "PEAK LONG RUN — X.X MI · LAST 28 DAYS": ✓.
- **"NEXT-WEEK CAP ≤ X.X MI · DANIELS +10% RULE"**: ✓ — `min(longestRecentMi × 1.10, phaseCap[displayPhase])`. TAPER caps at `max(8, longest × 0.6)`, POST_RACE at `max(4, longest × 0.5)`, REBUILD at `max(6, longest × 0.7)`. **Math is correct**; phase ceilings are reasonable Daniels-aligned approximations.
- **"X / Y QUALITY THIS WEEK"**: ✓ — `pulse.qualityDaysThisWeek` (from `strava-stats.ts:trainingPulse` line 239-243) counts current-week activities with `workoutType === 3` OR matching `HARD_NAME_RE`. Target by phase: PEAK 2, BUILDING 2, BASE 1, TAPER 1, POST-RACE 0, REBUILD 0, RACE MONTH 2. Color-codes overshoot/undershoot. ✓
- **Easy ratio %**: ✓ — uses VDOT-aware classifier (`effortBalance(runs, 14, 152, vdot)` line 1577). Cascade: name → VDOT pace zone → HR threshold → long-run default → unknown bucket. The phase target replaces the prior static 75% threshold; verdict references the phase by name.
- LOW CONF chip when `!balance.highConfidence`: ✓ — fires when <70% of miles got name/pace classification.
- Stacked easy/hard/unknown bar with `unknownMi` bucket: ✓ — explicit "unclassified" reporting is a clear improvement over the prior silent-flatten-into-easy approach.

#### `FunStatsSection` (`page.tsx:1891`)
- `funStats(rollup)` returns landmark comparisons; not load-bearing. Cosmetic. ✓.

### Race detail tiles

#### `PhaseCards` (`races/[slug]/page.tsx:626`)
- Per-phase target pace + grade % + mile range + cumulative time: ✓ — straight from `race.plan.phases`.

#### `MileSplits` (`races/[slug]/page.tsx:690`)
- Per-mile target paces with gel chips: ✓ — deterministic from `race.plan`.

#### `FuelingTile` (`races/[slug]/page.tsx:797`)
- "{N gels · {M}g carbs": ✓ — `f.gel_count`, `f.total_carbs_g`.
- Gel schedule with brand + per-gel carbs: ✓.
- ⚠️ "{f.carb_target_g_per_hr}g/hr target" — this number comes from the fueling planner output, not from `RACE_CARB_TARGETS_G_PER_HR` doctrine. The planner uses 60g/hr as default; doctrine specifies 60-90g/hr (default) / 80-100 (intermediate) / 120 (stretch). Disconnect remains from the prior audit.

#### `HydrationTile` (`races/[slug]/page.tsx:848`)
- Bucket assignment (5K/10K/half/marathon by distance): ✓ — straight thresholds.
- Pre-race blocks (24h/2-4h/final hour): ✓ — copy is hand-curated to match `PRE_RACE_HYDRATION` doctrine.
- During-race ml/hr table by distance × temp: ✓ — numbers match `FLUID_DURING_RACE` doctrine. ⚠️ **Hand-inlined, not imported** — same architectural problem as the fueling tile. If doctrine numbers change, the tile won't follow.
- Footer "Body mass should drop 1-3% during long events; weight gain post-race indicates over-drinking (EAH risk). General upper limit: ~800 ml/hr." — ✓ matches doctrine but again hand-inlined.

#### `WeatherTile` (`races/[slug]/page.tsx:1279`)
- NOAA forecast within 7 days, Open-Meteo historical (last year same date) when >7 days. ✓.

#### `CoachBriefBlock` (`races/[slug]/page.tsx:1648`)
- Voice paragraph from `coach.briefRaceMorning`: ✓.
- `▸ WHY?` toggle reveals citations + rationale: ✓ (mirrors the dashboard daily brief).
- Horizon label `{days} days out · approach`: ✓.
- "USING LAST YR WEATHER" chip when source is historical: ✓.
- "FALLBACK · NO API KEY" when no LLM: ✓.

#### `ResultSection` — `PerPhaseTable` (line 1031)
- Plan vs actual per phase + delta + avgHR: ✓ — actuals aggregated from per-mile splits filtered by phase mile range.
- Δ color: green when <=0 (faster than plan), warning when slower. ✓.

#### `PerMileTable` (line 1106)
- Per-mile target/actual/delta/HR/Δelev: ✓ — splits from Strava `splits_standard`.

### Stats called out as wrong / misleading / unverifiable

**❌ Wrong:** none found.

**⚠️ Misleading:**
1. `CoachTodayCard.hrZone` label "HR Z{1-5}" is a static workout-type number, not derived from runner HRmax. A 60-year-old reading "HR Z4" sees a misleading prescription if their HRmax is 30 BPM lower than the implicit assumption.
2. `NoVdotPanel` mentions "+1 VDOT correction for solo effort" but the engine doesn't apply it. Cosmetic until the engine ingests a TT result.
3. `FuelingTile.carb_target_g_per_hr` — the displayed target comes from the planner's hardcoded 60g default, not from `RACE_CARB_TARGETS_G_PER_HR` doctrine bands.
4. `HydrationTile` numbers are hand-inlined rather than imported from `coach/doctrine/hydration.ts`. Correct today; will silently drift if doctrine changes.
5. The `easyShare14d` denominator excludes `unknownMi` (good), but the dashboard headline `{easyPct}%` doesn't make this clear — a runner with 100% unknown miles sees `0%` rather than `—`. Edge case but worth surfacing.
6. `HrZonesTile` displays point-estimate band edges from a Tanaka HRmax that has ±10 BPM SE. Disclaimer is in the footer; the bands themselves don't visually communicate the uncertainty.

**❓ Unverifiable from code alone (need data):**
1. The `VDOT_AGE_DECLINE_*` per-decade rates are a Daniels-extrapolated approximation; whether they match the WMA tables for any specific runner age + sex is not directly testable from code.
2. The `recoveryWindowEndsISO` math (`coach-state.ts:359-369`) — distance-driven recovery durations match doctrine ranges, but whether the latest race's window correctly closes for a stacked-race scenario depends on the specific dates in fixture data.
3. The phase-cap multipliers in TrainingPulseTile (TAPER `× 0.6`, POST-RACE `× 0.5`, REBUILD `× 0.7`) are hand-picked approximations; match the engine's `longRunTarget` (`coach-engine.ts:362-374`) which uses TAPER `× 0.65`, POST_RACE `× 0.4`, REBUILD `× 0.6`. **These two surfaces disagree.**

**✓ Correct (the bulk):** WeeklyMilesCard / YearMilesCard / RecentRunCard / ThisWeekTile / TodayTile / CoachTodayCard run prescription (excluding hrZone caveat) / Next30DaysTile / VdotTile (raw + tier + freshness + bands + age-graded) / TrainingPulseTile (8-week bars + delta + long-run avg + cap + quality-vs-target + easy ratio) / ReadinessBanner (verdict + signals + recommendedAction) / FuelingTile gel schedule / MileSplits / PhaseCards / PerPhaseTable / PerMileTable.

---

## 6. Gap analysis — high-value info we HAVE but don't show

### 6.1 Recovery protocols catalog (Research/00b + `recovery_protocols.ts`)
The decision matrix landed (in `assessReadiness`). Still unwired:
- `POST_RACE_BY_DISTANCE` — graduated reverse-taper by 5K/10K/HM/M/50K/50mi/100K/100mi. Engine still uses its own ad-hoc ladder.
- `MARATHON_BIOMARKER_TIMELINE` — CK/myoglobin/IL-6/cortisol/inflammation timeline (~14 days for biomarker normalization). Could feed a "your body is still recovering" tile.
- `REVERSE_TAPER_PROTOCOL` + `MARATHON_RECOVERY_4WK_REVERSE_TAPER` — the day-by-day reverse-taper. PhaseGuidanceCard's POST_RACE copy uses `POST_RACE_STAGES` (different doctrine file, less granular).
- `MULTI_RACE_CADENCE` — between-race spacing rules.
- `INCOMPLETE_RECOVERY_QUALITATIVE_SIGNALS` — emotional / subjective markers (mood, sleep quality, motivation). Currently the readiness banner only sees quantitative signals.
- `CARBON_PLATE_RECOVERY_EFFECTS` — super-shoes raise muscle damage; recovery should extend.

### 6.2 Intensity distribution recommendation (Research/00a + `intensity.ts`)
Still defined and never imported: `PHASE_DISTRIBUTION_RECOMMENDATION` (pyramidal in base/build, polarized in peak), `VOLUME_MODEL_THRESHOLDS`, `NORWEGIAN_DOUBLE_THRESHOLD`. The TrainingPulseTile "easy ratio" tile is the natural place to surface "you're running pyramidal this block" but doesn't.

### 6.3 Taper specifics (Research/08 + `race_week.ts`)
The 19 race-week constants are still inert. PhaseGuidanceCard's TAPER copy references `TAPER_VOLUME_REDUCTION` + `TAPER_INTENSITY_PRESERVATION` + `TAPER_ERRORS` + `TAPER_BENEFIT` (from `taper.ts`) but doesn't pull race-week meal logistics, sleep banking, kit dress rehearsal specifics, or the race-day timeline. The race-week brief variant in `coach.ts:558-563` mentions these in prose but doesn't pull doctrine.

### 6.4 Post-race reverse-taper UI (Research/00b)
Day-by-day reverse-taper visible to the runner in POST_RACE phase. Currently they see "Recovery — volume drop is by design" + a static ladder; doctrine has a granular per-day plan.

### 6.5 Hydration: unconsumed pieces of Research/19
- `SWEAT_RATE_PROTOCOL` — runner-specific sweat rate measurement. Critical for personalized ml/hr — the tile currently shows generic distance × temp bands.
- `EAH_RISK_FACTORS` — list of EAH risk factors (slow finish time, female, NSAID use, low body weight, excessive drinking). Tile mentions EAH risk in passing but doesn't surface the factors.
- `SWEAT_SODIUM_CLASSIFICATIONS` — light/average/heavy salty sweater calibration. No personalization.

### 6.6 HR zone systems beyond %HRmax-5 (Research/03)
The 5-zone tile is wired. Still unwired: `HRMAX_ZONES_7`, `KARVONEN_FORMULA` (HRR — uses RHR which the runner profile already collects), `LTHR_30MIN_TT_PROTOCOL`, `FRIEL_LTHR_ZONES`. Karvonen would actually use the RHR field already on the profile — low-hanging fruit.

### 6.7 HR field-test protocols (Research/03)
`HRMAX_FIELD_TEST_PROTOCOLS` (3 protocols: McMillan flat-then-hill, 2400m TT, treadmill ramp). Profile asks for HRmax but doesn't tell the runner how to measure it.

### 6.8 Strength periodization (Research/07)
`STRENGTH_PERIODIZATION` mirrored by hand in `coach-principles.ts`. `HEAVY_RESISTANCE.primaryAdaptation: 'running_economy'` is a key insight (strength training raises economy, not VO2) — never surfaced anywhere.

### 6.9 Cross-training substitution (Research/09)
No XT logging / substitution path. `XT_DECISION_RULES`, `XT_CARRYOVER_MATRIX` defined and never imported.

### 6.10 Mental training (Research/20)
`GOAL_SETTING_FRAMEWORKS` (A/B/C goals), `PETTLEP_VISUALIZATION`, self-talk catalog, pre-race anxiety protocols, post-race blues, DNF rules, burnout warnings — all unused. Race entry still has a single `goalDisplay` string.

### 6.11 Travel + jet lag (Research/12)
`TRAVEL_ARRIVAL`, `EAST_WEST_ASYMMETRY` defined; no travel field anywhere on CoachState or race entry.

### 6.12 Sex-specific guidance beyond grading (Research/13)
The sex field on the runner profile is read for VDOT cohort framing only. `MENSTRUAL_CYCLE_GUIDANCE`, RED-S screening, hormonal-contraception notes, iron deficiency — all unused.

### 6.13 Age-specific defaults (Research/14)
The age field drives age-graded VDOT (display) and Tanaka HRmax estimate. Engine prescription still has no age-aware logic — `AGE_DEFAULTS_BY_DECADE` (volume / recovery / strength / injury risk per decade) is unused.

### 6.14 Wearable load metrics (Research/15)
TRIMP, TSS, monotony, strain, EWMA-ACWR all defined. App computes only rolling-avg ACWR. Health page shows raw HR / cadence / mileage trends.

### 6.15 Form / cadence (Research/16)
`/runs/[id]:231` shows cadence in spm but doesn't compare to a target band.

### 6.16 Plan template surface
`PLAN_TEMPLATES` is wired into the engine's day picker, but the **template itself is still never shown to the user**. They see today + 4 days + a weekly grid + 30-day strip but cannot see "you're on the marathon-intermediate plan, week 8 of 16."

### 6.17 Race-prediction (Research/02)
Riegel / Cameron / McMillan never used. The brief comments on VDOT-implied finish but doesn't compare against Riegel-derived prediction at adjacent distances.

---

## 7. Gap analysis — info we WANT but don't have

### 7.1 New CoachState fields needed (server-side)
- **age, sex (server-side mirror of runner-profile.ts)** — required for AGE_DEFAULTS_BY_DECADE, sex-specific rules, hydration ml/kg/day, PRE_RACE_MEAL g/kg.
- **weight (kg)** — for hydration ml/kg/day, pre-race meal g/kg, sweat-rate-based intake.
- **HRmax + RHR (server-side mirror)** — replaces the hardcoded 152 bpm in `coach-engine.ts:391`. Then engine prescriptions become per-runner.
- **Injury flag with type + onset date** — drives `injury_return.ts:WALK_RUN_PROTOCOL`.
- **Travel itinerary** — drives `travel.ts:TRAVEL_ARRIVAL`.
- **Long run day preference + days-running-per-week** — `app/profile/page.tsx` has UI but local-only.
- **Cycle log** (optional) — for sex.ts MENSTRUAL_CYCLE_GUIDANCE.
- **Carb tolerance calibration (g/hr ceiling)** — type definition mentions `carbToleranceDelta` in FuelingInput; no consumer writes/reads it.
- **HRV / RHR / sleep stream (HealthKit)** — fields exist on CoachState; `flags.healthKitAvailable: false` hardcoded.
- **Past TT results** — when a 5K time trial is run (engine now plans them), there's no schema for "this was the TT result, here's the new VDOT anchor." Currently has to be saved as a generic race.

### 7.2 New research / doctrine areas
- **Day-of-week placement rules** — `defaultByDow` is hand-coded; no doctrine constant.
- **Goal-pace negotiation** — when goal is unrealistic vs VDOT, no escalation protocol.
- **Race-week carb-load by goal time** — Research/18 has 8-10 g/kg/day flat; doesn't differentiate by anticipated finish time.
- **5K time-trial-as-VDOT-update flow** — engine plans the test but doctrine doesn't define the "and once you finish it, here's what to do with the result" piece (the +1 correction for solo effort, the +5 BPM HRmax adjustment, etc.).

### 7.3 New UI surfaces
- **Plan overview page** — "your training plan, weeks 1-16" — would consume `PLAN_TEMPLATES` properly.
- **Onboarding** — currently the runner has to know to go to /profile to set birth year + sex + HRmax. No onboarding flow.
- **Wired `/workout/[date]` page** — biggest placeholder removal.
- **Injury intake + RTR walk-run wizard** — WALK_RUN_PROTOCOL has 8 stages.
- **Travel planner** for upcoming races.
- **Retrospective view** for past races — `briefRaceMorning` adapts by horizon, but `retrospect` is stubbed; race detail page in debrief mode doesn't pull a Coach-voiced narrative.
- **Race-pace-strategy editor** — even / negative-split / even-effort.
- **Hydration personalization** — sweat-rate intake calculation.
- **Health page real data or removal of placeholder cards.**

### 7.4 Cross-references between existing pieces
- Two daily-card surfaces still duplicate effort (`page.tsx:CoachTodayCard` + `training/page.tsx:DailyBriefing`).
- TWO long-run-cap calculations: `TrainingPulseTile` (page.tsx:1697-1718) uses TAPER `× 0.6`, POST-RACE `× 0.5`, REBUILD `× 0.7`; engine `longRunTarget` (coach-engine.ts:362-374) uses TAPER `× 0.65`, POST_RACE `× 0.4`, REBUILD `× 0.6`. **These disagree.** The runner sees one "cap" on the dashboard and a different long run distance on the prescription.
- TWO phase concepts (`lib/strava-stats.ts:trainingPulse().phase` vs `lib/coach-principles.ts:Phase`) — the dashboard now reconciles them at the top of `TrainingPulseTile` via `/api/coach/today` fetch, but the parallel taxonomy persists in `strava-stats.ts:172` (still 6 enum values vs engine's 7).
- **Profile sex/HRmax are localStorage-only** — not visible to the server-side coach engine. The brief never says "your VDOT is exceptional for a 60-year-old woman" because the brief route doesn't see the runner profile.
- HRmax measured on /profile is not used in `coach-engine.ts:391` (still 152 BPM constant).
- `hydration.ts` doctrine constants exist but the HydrationTile inlines its own copies of the numbers.

---

## 8. Recommendations queue (prioritized)

The prior audit's top 5 are largely DONE:
- ✓ #1 (age + sex into CoachState — partial: client-side only via runner-profile.ts)
- ✓ #2 (hydration tile on race detail — done; tile inlines numbers, doesn't import doctrine)
- ✗ #3 (real /workout/[date] page) — still placeholder
- ✓-ish #4 (POST_RACE_BY_DISTANCE — partial: PhaseGuidanceCard surfaces POST_RACE_STAGES, doctrine 00b decision matrix wires into readiness)
- ✗ #5 (coach.fuelingFor + retire fueling-claude — still bypassed)

New top-10, ordered by ROI:

### 1. Wire runner profile to server-side CoachState (M)
**What**: Mirror `lib/runner-profile.ts` (birthYear, sex, hrmaxBpm, rhrBpm) to a Postgres `runner_profile` table; have `gatherCoachState()` read it and add `state.runner` field.
**Why**: Unlocks every age- and HRmax-dependent doctrine pathway. The `coach-engine.ts:391` magic number (152 BPM ≈ 80% × 190 default) finally becomes per-runner. The brief can comment on age-grading without the runner being on the dashboard. AGE_DEFAULTS_BY_DECADE becomes consumable.
**Why now**: The data already exists on the client; piping it server-side is the cheapest unlock.
**Dependencies**: schema migration, gatherCoachState rewrite, optional sync from localStorage.

### 2. Build a real /workout/[date] page (M)
**What**: Replace static placeholder with engine-driven data. Pull `coachDaily(state).today` for the requested date; render `voiceLead`; deterministic structure (warm-up/main/cool-down derived from workout type); past-attempts from Strava activity matching; conditions forecast.
**Why**: Largest remaining placeholder surface. Every link from dashboard week-strip + 30-day-strip lands here.
**Dependencies**: workout-type → structure mapping (probably belongs in doctrine), home location for weather.

### 3. Replace fueling planner with doctrine-imported version + retire fueling-claude direct path (M)
**What**: Wire `coach.fuelingFor` per its interface (`coach.ts:259`) reading `RACE_CARB_TARGETS_G_PER_HR`, `GLUCOSE_FRUCTOSE_RATIO`, `PRE_RACE_MEAL` from `fueling.ts`. Update `FuelingTile` and `HydrationTile` to import doctrine rather than inlining numbers.
**Why**: Both tiles work but parallel sources of truth. Doctrine drift will silently break them.
**Dependencies**: minor refactor; doctrine constants already exist.

### 4. Wire `recovery_protocols.ts` POST_RACE_BY_DISTANCE + REVERSE_TAPER_PROTOCOL into the engine (M)
**What**: Replace engine's hand-coded post-race ladder (`coach-engine.ts:271-321`) with doctrine-driven lookups. Add a per-day reverse-taper preview tile in race-detail debrief mode.
**Why**: Engine and doctrine still disagree on day-by-day specifics. Single source of truth.
**Dependencies**: doctrine import only.

### 5. Reconcile the long-run cap math (S)
**What**: Pick one — either the engine's `longRunTarget` ratios or the dashboard's TrainingPulseTile ratios — and have the other read from it. Currently TAPER `× 0.65` vs `× 0.6`, POST-RACE `× 0.4` vs `× 0.5`, REBUILD `× 0.6` vs `× 0.7`.
**Why**: User sees two different "next-week cap" numbers. Trust erosion.
**Dependencies**: minor; centralize in `coach-principles.ts`.

### 6. Build a /plan overview page (S–M)
**What**: Show active `PLAN_TEMPLATES` selection — N-week marathon-intermediate, current week M, sample peak week, calendar projecting `pickRun` forward across remaining build window.
**Why**: Most expensive doctrine landed (Stage 4) is still invisible.
**Dependencies**: route + extending `simulateNext30Days` to N weeks.

### 7. Surface SWEAT_RATE_PROTOCOL + EAH_RISK_FACTORS in HydrationTile (S)
**What**: Add a "calibrate your sweat rate" CTA and an EAH risk-factor checklist (slow finish, female, NSAID use, low body weight) to the hydration tile.
**Why**: Generic distance × temp bands aren't enough for personalization. EAH risk is real for slow runners.
**Dependencies**: hydration.ts already has the constants; minor UI.

### 8. Wire mental.ts:GOAL_SETTING_FRAMEWORKS into race entry form (S)
**What**: Split `goalDisplay` into A/B/C goals on the race form; race detail shows all three; brief references whichever is appropriate.
**Why**: Best-practice mainstream; brief currently has no way to softly recommend a goal revision.
**Dependencies**: race storage schema bump, form UI.

### 9. Add Karvonen / HRR HR zones tile + LTHR field-test prompt (S)
**What**: Once RHR is on the profile (already is), surface a "Karvonen HRR" zone variant alongside the %HRmax tile. Add an LTHR field-test prompt for runners who want sharper threshold work.
**Why**: Doctrine has KARVONEN_FORMULA + LTHR_30MIN_TT_PROTOCOL ready; the runner profile already collects RHR; nothing is using it.
**Dependencies**: small.

### 10. Wire HRmax to engine's "yesterday was hard" gate (S)
**What**: Replace `coach-engine.ts:391` `HARD_EFFORT_HR_DEFAULT_BPM = 152` with `0.80 × runner.hrmax`, falling back to 152 only if runner profile is unset.
**Why**: A 65-year-old with HRmax 165 has 80% threshold at 132 BPM, not 152. Currently the engine never flags her threshold runs as "hard yesterday."
**Dependencies**: depends on #1 (server-side runner profile).

### Notes on what was deliberately NOT prioritized

- **Pacing strategy editor** — the current Minetti-derived per-segment pacing is good without runner intervention. Editing strategy is power-user.
- **Travel / jet lag** — high doctrine quality, rare event.
- **Mental training visualizations (PETTLEP)** — soft compared to direct race-day items.
- **Form-corrections doctrine** (Research/21) — no doctrine file yet; would need extraction first.
- **Onboarding flow** — useful but profile is currently optional and the dashboard already degrades gracefully when fields are unset.

---

## Appendices

### Wired vs unwired doctrine quick reference (Δ from prior audit)

**Newly imported and consumed (this session):**
- `pace_zones.ts` `VDOT_TIERS` + `vdotTierFor` + `VDOT_FRESHNESS_WINDOW` + `vdotFreshnessFor` (consumed by `lib/vdot.ts` + `app/page.tsx` VdotTile)
- `pace_zones.ts` `VDOT_FIELD_TESTS` (consumed conceptually by `app/page.tsx` NoVdotPanel — copy is hand-curated, not imported)
- `hr_zones.ts` `HRMAX_ZONES_5` (consumed by `app/page.tsx:1217` HrZonesTile)
- `recovery_protocols.ts` `INCOMPLETE_RECOVERY_DECISION_MATRIX` (consumed indirectly by `coach.ts:474-480` action mapping; cited in readiness)
- `taper.ts` `TAPER_VOLUME_REDUCTION` + `TAPER_INTENSITY_PRESERVATION` + `TAPER_ERRORS` + `TAPER_BENEFIT` (consumed by `app/page.tsx` PhaseGuidanceCard)
- `post_race.ts` `POST_RACE_STAGES` (consumed by PhaseGuidanceCard)
- `grading.ts` (NEW): `VDOT_AGE_DECLINE_MALE` + `VDOT_AGE_DECLINE_FEMALE` + `VDOT_SEX_COHORT_OFFSET` + `gradeVdot` (consumed by `app/page.tsx:1372` VdotTile)

**Still imported and consumed (unchanged):**
- `pace_zones.ts` (VDOT_LOOKUP_TABLE, PACE_ZONE_WIDTH, DanielsPace, MARATHON_VDOT_CORRECTION incompletely)
- `weather.ts` (8 of 22 exports)
- `plan_templates.ts` (PLAN_TEMPLATES)
- `load.ts` (ACWR_BAND, SINGLE_SESSION_SPIKE)
- `workouts.ts` (LONG_RUN, STRIDES — vocabulary mirrored in coach-workouts.ts)
- `recovery.ts` (SLEEP)

**Still defined but no consumer:** every export of `cross_training.ts`, `mobility.ts`, `mental.ts`, `sex.ts` (cycle/RED-S parts), `age.ts` (server-side), `travel.ts`; `cadence.ts`; `course.ts` (course-facts.ts is parallel/legacy); `race_prediction.ts`; `race_week.ts`; the bulk of `recovery_protocols.ts` outside the decision matrix; the bulk of `hydration.ts` outside what HydrationTile inlines; the bulk of `hr_zones.ts` outside HRMAX_ZONES_5; the bulk of `wearables.ts`; `intensity.ts` (3 of 6 constants unused); `strength.ts` (engine has its own copy); `shoes.ts` (shoe-utils.ts is parallel); the bulk of `fueling.ts`.

### File reference index (unchanged)

- Doctrine barrel: `web/coach/doctrine/index.ts`
- Doctrine new: `web/coach/doctrine/grading.ts`
- Coach interface + impl: `web/coach/coach.ts:254-901`
- Voice lead composer: `web/coach/explanations.ts`
- Citation helpers: `web/coach/citations.ts`
- LLM gateway: `web/coach/llm.ts`
- Voice prompt: `web/coach/voice.md`
- State aggregator: `web/lib/coach-state.ts:217-450`
- Daily engine: `web/lib/coach-engine.ts:93-663`
- Engine principles: `web/lib/coach-principles.ts`
- VDOT pipeline: `web/lib/vdot.ts:1-353`
- Runner profile (NEW): `web/lib/runner-profile.ts:1-97`
- Workout palette: `web/lib/coach-workouts.ts` (added `vdotTest5K` at line 266)
- Strength palette: `web/lib/coach-strength.ts`
- Plan template engine: `web/lib/coach-plan.ts`
- Weather slowdown: `web/lib/weather-slowdown.ts`
- Strava cache + stats: `web/lib/strava-cache.ts`, `web/lib/strava-stats.ts` (added quality-day count + VDOT-aware classifier)
- API routes: `web/app/api/coach/today/route.ts` (now also returns `vdot`, `vdotTestPrompt`, `dailyBrief`), `web/app/api/brief/route.ts`, `web/app/api/retrospective/route.ts`
- Pages: `web/app/page.tsx` (2198 lines), `web/app/training/page.tsx`, `web/app/races/page.tsx`, `web/app/races/[slug]/page.tsx` (2056 lines), `web/app/log/page.tsx`, `web/app/runs/[id]/page.tsx`, `web/app/health/page.tsx` (still placeholder grid), `web/app/profile/page.tsx` (596 lines, +RunnerProfileSection), `web/app/workout/[date]/page.tsx` (still 100% placeholder)
