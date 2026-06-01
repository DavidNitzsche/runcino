# Onboarding + Settings Audit · Inputs the Coach Needs

**Locked 2026-05-30 · refreshed 2026-05-31.** This audit maps every
piece of information the coaching engine needs against where it
currently comes from, when it's asked, and what the fallback is when
the canonical source isn't available.

The contract: **every user — David, the next runner, the 1000th —
should arrive at first coaching with the SAME inputs filled.** The path
to fill them differs (Apple Health auto-fills some; manual entry fills
others), but the set of fields the coach reads is fixed.

> **Refresh note · 2026-05-31.** Several T3 manual-fallback gaps the
> original audit flagged are now closed by toolkit components (see the
> "Status as of 2026-05-31" annotations below). The onboarding page
> itself (`web-v2/app/onboarding/page.tsx`) is still a redirect stub —
> the no-race goal path is gated on the design brief at
> `designs/briefs/onboarding-no-race-path-brief.md`. Once that
> mockup lands, this audit becomes the build spec.

---

## Six input tiers

| Tier | Status | What it gates |
|---|---|---|
| **T1 · Identity** | REQUIRED at onboarding | Plan generation, briefing greeting, time-aware UX |
| **T2 · Physiology** | REQUIRED for accurate coaching | HR zones, age-grading, cadence thresholds, fueling math |
| **T3 · Connected-source data** | AUTO when connected, MANUAL fallback when not | Readiness, training load, run history |
| **T4 · Volume + history** | REQUIRED for plan generation | Plan-builder's volume target + level inference |
| **T5 · Schedule + units** | REQUIRED before first plan | Workout day-of-week, distance/pace/temp units |
| **T6 · Pro features** | OPTIONAL | Fueling brand, cross-training, phone HR alerts |

---

## T1 · Identity (REQUIRED at onboarding)

| Field | Where it lives | Asked at | Used for |
|---|---|---|---|
| `users.name` (or `profile.full_name`) | `users` table | Onboarding Step 1 · text input | Greeting, display, race-bib header |
| `users.email` | `users` table | Auth (Apple / Strava OAuth or email) | Login, recovery, notifications |
| `users.timezone` | `users` table | Onboarding (IP-derived → confirmed) | Every "today" boundary, race countdown, briefing time |
| `users.id` | `users.id PK` | Auto on sign-up (gen_random_uuid) | Every per-user row's FK |

**Gap:** the new Lilian onboarding asks for `name` + `timezone`. Birthday, sex, and city are NOT asked at onboarding today — only via post-onboarding profile edit.

---

## T2 · Physiology (REQUIRED for accurate coaching)

Without these, the coach hedges or defers. With them, the coach speaks plainly.

| Field | Where it lives | Auto source | Manual source | What it gates |
|---|---|---|---|---|
| `users.age` + `profile.birthday` | `users` + `profile` | n/a | Onboarding ask OR profile edit | Age-graded VDOT (`Research/24`); `220-age` HRmax sanity check |
| `users.sex` | `users.sex` | n/a (no auto path) | Onboarding ask OR profile edit | Sex-specific training (`Research/13`); RED-S screening; iron/bone considerations |
| `profile.height_cm` | `profile.height_cm` | n/a | Profile edit (or gap card on TODAY) | Cadence-overstriding thresholds (`Research/16` + `Research/21`) |
| `profile.experience_level` | `profile.experience_level` | Derived from history (Strava avg weekly mi + years running) | Onboarding ask OR profile edit | Plan template selection (beginner / intermediate / advanced / advanced_plus); volume scaling |

**Gap:** Onboarding does NOT ask birthday, sex, or height. The runner has to discover the profile edit screen to fill these in. **Recommendation:** add a "Physiology" step to onboarding between Goal and Signals.

---

## T3 · Connected-source data (AUTO when connected, MANUAL fallback otherwise)

When Apple Health is connected, these auto-flow into `health_samples` via the iOS bridge. When it's not, the runner needs a manual path.

| Field | Apple Health source | Manual fallback | Used by |
|---|---|---|---|
| **Max HR** (`users.max_hr` + override) | `health_samples` sample_type=`max_hr` → ratchets `users.max_hr` higher when exceeded | `users.max_hr_override` via profile edit; OR `220 - age` formula as last resort | HR zones, readiness Z4 floor, watch HR display |
| **Resting HR** (`users.resting_hr` + override) | `health_samples` sample_type=`resting_hr` → avg of last 60d into `users.resting_hr` | `users.resting_hr_override` via profile edit | Karvonen zones, readiness RHR pillar |
| **LTHR** (`profile.lthr`) | Derived from race `meta.avgHrBpm` for half-marathon-distance races (HM avg HR ≈ LTHR) | Profile edit; `lthr_set_at` + `lthr_method` stamped | Friel HR zones (canonical), threshold workouts, watch coach prompts |
| **Sleep** (`health_samples.sample_type='sleep_hours'`) | Auto-pushed daily | **GAP: no manual entry path** | Readiness Sleep pillar (25% weight), sleep_deficit card |
| **HRV** (`health_samples.sample_type='hrv'`) | Auto-pushed daily | **GAP: no manual entry path** | Readiness HRV pillar (25% weight) |
| **Weight** (`health_samples.sample_type='body_mass'`) | Auto-pushed (last value used) | **GAP: no manual entry path** | Running economy estimates, race-pace calorie burn |
| **Body fat %** (`health_samples.sample_type='body_fat_pct'`) | Auto | **GAP: no manual entry path** | Optional — fueling math + composition tracking |
| **VO2 Max** (`profile.vo2max_apple` + `health_samples`) | Auto-pushed | **GAP: no manual entry path** | Wellness signal only (NEVER training signal) per Doctrine 2.2 |
| **HR Recovery** (`health_samples.sample_type='hr_recovery'`) | Auto-pushed | **GAP: no manual entry path** | Readiness sub-signal (~5% weight in `readiness.ts`) |
| **Cadence** (`health_samples.sample_type='cadence'`) | Auto-pushed per run | **GAP: no manual entry path** | Cadence experiment card (gated on `height_cm`) |
| **Run power, ground contact, vertical oscillation, stride length, vertical ratio** | Auto from compatible watch | **GAP: no manual entry path** | Form-bio cards; running economy |

**Gap surface:** the only fields with a real manual fallback today are Max HR, Resting HR, and LTHR. The other 8+ HealthKit sample types **only flow when Apple Health is connected.** A web-only user (no iOS app) cannot enter sleep / HRV / weight manually — those readiness pillars degrade silently.

**Recommendation:** add a "manual daily check-in" path with optional fields for sleep duration + felt-recovery rating so the readiness chain has SOMETHING when Apple Health isn't connected. (The check_ins table can carry sleep/energy/soreness on the v2 reply-chip surface.)

> **Status as of 2026-05-31 · MOSTLY CLOSED.** The toolkit's
> `ManualHealthSheet` (live on `HealthView` behind a "+ Log measurement"
> pill, POST `/api/health/manual`) now provides manual fallbacks for:
> sleep_hours, hrv, resting_hr, body_mass (weight), hr_recovery,
> vo2_max. The 7 fields the original audit flagged as "GAP: no manual
> entry path" are reduced to the run-form bio metrics (cadence, run
> power, ground contact, vertical oscillation, stride length, vertical
> ratio) — which are watch-only signals by their nature and don't have
> a meaningful manual surrogate.

---

## T4 · Volume + history (REQUIRED for plan generation)

The plan-builder needs to know what the runner is currently capable of so it doesn't prescribe 60 mpw to a 15 mpw runner.

| Field | Onboarding bucket | Stored as | Used by |
|---|---|---|---|
| Weekly mileage target | `15` / `25` / `35` / `45` / `55` chip | `profile.weekly_mileage_target` (numeric) | Plan template selection; peak volume |
| Weekly frequency | `3` / `4` / `5` / `6` chip | `profile.weekly_frequency` (int) | Run-day distribution; `quality_days[]` length floor |
| Recent avg weekly mi | `0-5` / `5-15` / `15-25` / `25-35` / `35+` chip | `profile.history_avg_weekly_mi` (midpoint int) | Floor for auto-detected level; seed for `state.volume.weeklyAvg4w` when Strava isn't connected |
| Recent longest run | `0-3` / `3-6` / `6-10` / `10+` chip | `profile.history_longest_recent_mi` (midpoint int) | Floor for `peakLongRunMi` — prevents 12mi-long history getting a 6mi-long plan |
| Years running | `<1` / `1-3` / `3-7` / `7+` chip | `profile.history_years_running` (TEXT bucket) | Coarse advanced-level hint; 7+ years lifts auto-detected level by one |
| Recent races | `races` table | `actual_result.finishS` + `meta` | VDOT anchor; race-derived training paces |

**Status:** all six fields ARE collected in the Lilian onboarding (no-race path) OR derived from connected Strava activities. The race path skips the history chips (relies on Strava sync to fill `state.volume.weeklyAvg4w`).

**Gap when Strava ISN'T connected AND it's the race path:** the runner skipped history chips (only no-race path asks them) → plan-builder has no volume seed → falls back to default conservative ramp. Recommendation: ask the history chips on BOTH paths, OR detect no-Strava and surface the chips as a follow-up.

---

## T5 · Schedule + units (REQUIRED before first plan)

| Field | Where it lives | Set at | Default if unset |
|---|---|---|---|
| Long run day | `user_prefs.long_run_dow` (int 0-6) | Settings UI; also `user_prefs.long_run_day` legacy text | Sun (dow 0) |
| Quality days | `user_prefs.quality_dows` ("2,4") | Settings UI | Tue + Thu (2,4) |
| Rest day | `user_prefs.rest_dow` (int) | Settings UI | Sat (dow 6) |
| Distance unit | `user_prefs.units` ("imperial"/"metric") | Settings UI | Imperial (mi/F/min_per_mi) |
| Pace unit | `user_prefs.units` | Settings UI | min_per_mi |
| Temperature unit | `user_prefs.units` | Settings UI | F |
| Briefing time | `user_prefs.briefing_time` ("07:00") | Settings UI | 07:00 |
| Push enabled | `user_prefs.push_enabled` | Settings UI | true |

**Gap:** these are NOT asked at onboarding. The runner gets the default schedule (Sun/Tue+Thu/Sat) and has to discover Settings to change. **Recommendation:** add a "Week shape" step to onboarding so the first plan respects the runner's actual life.

---

## T6 · Pro features (OPTIONAL)

| Field | Where it lives | Set at | Status today |
|---|---|---|---|
| Fueling brand | `users.fuel_brand` | Settings UI (planned) | Schema ready, no UI |
| Gel carb content (g) | `users.fuel_gel_carbs_g` | Settings UI (planned) | Schema ready, no UI |
| Target carbs per hour | `users.fuel_target_g_per_hr` | Settings UI (planned) | Schema ready, no UI |
| Cross-training modes | `profile.cross_training_modes` TEXT[] | Profile edit (planned) | Schema ready, no UI |
| Strava writeback | `users.strava_writeback` | Settings UI / profile | Working |
| Strava auto-push | `profile.strava_auto_push` | Profile edit | Working |
| Phone HR alerts | `profile.phone_hr_alerts` | Profile edit | Working |
| Notification prefs (7 categories) | `profile.notification_prefs` JSONB | `/api/profile/notifications` | Working |

---

## The fallback ladder · per-field doctrine

For every physiology field, the resolution order is:

```
1. MANUAL OVERRIDE  · users.*_override or profile.* set explicitly
2. AUTO from CONNECTOR · health_samples ratchet (max_hr, resting_hr)
                         OR race-derived (LTHR from HM avg HR)
3. POPULATION FORMULA · 220-age for max_hr (last resort)
4. PROFILE_GAP CARD · coach surfaces "we need X to coach Y better"
```

Examples:

| Field | Resolution chain |
|---|---|
| **Max HR** | `users.max_hr_override` → `users.max_hr` (auto-ratchet from `health_samples`) → `220 - users.age` → profile_gap card |
| **Resting HR** | `users.resting_hr_override` → `users.resting_hr` (60d avg of `health_samples`) → null (defers HRR-Karvonen) |
| **LTHR** | `profile.lthr` (manual) → derived from HM race `avgHrBpm` → null (defers Friel zones; falls to %MHR) |
| **Weight** | `health_samples.body_mass` latest → null (no manual fallback today — GAP) |
| **Sleep** | `health_samples.sleep_hours` daily → null (no manual fallback today — GAP) |
| **Height** | `profile.height_cm` (manual) → null (suppresses cadence_experiment card; surfaces profile_gap card asking for height) |

---

## Where the new user lands today (David's actual path)

For David's account, here's how each field actually got filled:

| Field | Source | When |
|---|---|---|
| `users.id` (UUID) | Sign-up | 2026-05-17 |
| `users.email` (dnitch85@me.com) | Sign-up | 2026-05-17 |
| `users.name` ("David Nitzsche") | ? | unknown |
| `users.age` (40) | Manual edit | unknown |
| `users.sex` (M) | Manual edit | unknown |
| `users.timezone` (America/Los_Angeles) | iOS bridge | 2026-05-17+ |
| `users.max_hr` (181) | Apple Health auto-ratchet | 2026-05-20+ (Apple connected) |
| `users.resting_hr` (52) | Apple Health 60d avg | 2026-05-20+ |
| `profile.height_cm` (185) | Profile edit | 2026-05-26 (3 weeks after sign-up) |
| `profile.birthday` (1986-01-01) | Profile edit | unknown |
| `profile.lthr` (162) | Derived from race avg HR (Disney HM 159 + Rose Bowl HM 162 avg) | 2026-05-26 |
| `profile.hrmax_observed` (188) | Apple Health watch reading | 2026-05-20+ |
| `profile.experience_level` ("advanced") | Manual edit (or onboarding answer) | unknown |
| `profile.weekly_mileage_target` (null) | Never collected | — |
| `profile.history_*` (null × 3) | Never collected | — |
| `profile.cross_training_modes` ([]) | Never collected | — |
| `profile.fuel_brand` (null) | Never collected | — |

**Observations:**
- David has been on the platform 13 days. It took him **3 weeks** after sign-up to fill in `height_cm` and `lthr` — those were not asked at onboarding.
- His `history_*` fields are still null. The plan-builder relies on Strava-derived volume instead. That works for David (110 synced activities) but would fail for a runner without Strava history.
- `cross_training_modes` and fueling fields are completely untouched.

---

## The recommended onboarding flow (target state)

Compact, 4-step web flow (5-step iOS flow with HealthKit grant). Time budget: **&lt; 3 minutes** for a runner who knows their stuff.

### Step 1 · Identity (30 seconds)
- Name (text)
- Birthday (date picker → derived age)
- Sex (M / F)
- Location (auto from IP, confirmable)
- Timezone (auto from device, confirmable)

### Step 2 · Goal (45 seconds)
- Distance: 5K / 10K / Half / Marathon / Maintenance
- Race date (if race) — date picker
- Goal time (optional) — text
- Race name (optional — defaults to "My {distance}")

### Step 3 · Physiology (60 seconds — defers what Apple Health will fill)
- Height: cm or in (REQUIRED — no auto path)
- Weight: kg or lb (defer if Apple Health connected)
- Max HR: known? (optional — auto if Apple Health connected; `220-age` fallback)
- Resting HR: known? (optional — auto if Apple Health connected)
- LTHR: known? (optional — derived from race avg HR over time)

### Step 4 · Volume + experience (45 seconds)
- Experience level: 5 chips (beginner / intermediate / advanced / advanced_plus)
- Recent weekly volume: 5 chips (0-5 / 5-15 / 15-25 / 25-35 / 35+ mpw)
- Longest recent run: 4 chips (0-3 / 3-6 / 6-10 / 10+ mi)
- Years running: 4 chips (<1 / 1-3 / 3-7 / 7+)

### Step 5 · Week shape (30 seconds)
- Long run day (7 chips, default Sun)
- Quality days (multi-select, default Tue+Thu)
- Rest day (7 chips, default Sat)

### Step 6 · Connect signals (open-ended)
- Strava (OAuth or skip)
- Apple Health (iPhone only — defer if on web)
- Apple Watch (iPhone only — defer)
- Briefing time (default 07:00)
- Push enabled (default true)

### Step 7 · Confirm (5 seconds)
- Review every answer in a single column
- "Start training" → seeds first plan, lands at /today

---

## What's missing today vs target

> **Status refreshed 2026-05-31.** The "Status" column reflects what's
> shipped since the original 2026-05-30 audit.

| Gap | Today | Recommendation | Status 2026-05-31 |
|---|---|---|---|
| Onboarding doesn't ask birthday/sex/height | Done via profile edit weeks later | Add Step 3 "Physiology" | **REPLACED** · David locked the auto-nudge approach: skip the dedicated Step 1c, instead fire a `ProfileGapCard` on Today after 3 days post-onboard with no physiology data + no AppleHealth. Now wired in `TodayView`. |
| Onboarding doesn't ask schedule | Defaults Sun/Tue+Thu/Sat | Add Step 5 "Week shape" | **OPEN** · Defaults persist. Schedule-aware onboarding step needs design. Lower priority than the no-race goal path. |
| Onboarding skips history chips on race path | Plan-builder relies on Strava history (fails without Strava) | Always ask history chips (lightweight, low-friction) | **GATED** · Onboarding page is a redirect stub. Surfaces only when the race-anchored onboarding mockup lands. |
| No manual fallback for sleep / HRV / weight | Apple-Health-disconnected user has degraded readiness | Add lightweight daily check-in fields for sleep + felt recovery | **CLOSED** · `ManualHealthSheet` on `HealthView` covers sleep_hours, hrv, resting_hr, body_mass, hr_recovery, vo2_max via POST `/api/health/manual`. The 6 watch-only run-form metrics (cadence, power, GCT, etc.) remain manual-fallback-impossible by their nature. |
| No fueling UI | `users.fuel_*` columns unused | Build Settings → Fueling section (race-mode pre-fill) | **OPEN** · Out of scope this cycle. |
| No cross-training UI | `profile.cross_training_modes` unused | Build profile edit · cross-training preferences picker | **PARTIAL** · `LogNonRunSheet` on `TargetsView` lets the runner log strength + cross sessions ad-hoc (per David's "say what days, runner logs" decision). The persistent preferences picker (which modalities the runner does at all) is still open — small follow-up. |
| Profile gaps surface late | "no height → no cadence card" only after a few briefings | Profile gap cards should ALSO appear in onboarding Step 3 with explainer | **CLOSED** · `ProfileGapCard` is a live toolkit component, and the physiology auto-nudge on TodayView is the primary surface. Once the new onboarding flow ships, gap cards can also live mid-flow. |
| 7 inputs for the no-race goal path | Schema + state machine exist; design doesn't | Design Step 1b (TT distance + time, weekly volume + frequency, 3 history fields) | **BRIEF FILED** · `designs/briefs/onboarding-no-race-path-brief.md` (this cycle). |
| Goals (non-race) capture | `personal_goals` table never written from web | Capture via profile or Targets | **CLOSED** · `NewGoalSheet` lives on `TargetsView` behind "+ New goal" pill. POSTs to `/api/goals`. |
| Notification taxonomy management | `profile.notification_prefs` jsonb never edited from web | Settings → Notifications with 7-category list | **CLOSED** · `NotificationPrefsList` on `ProfileView` covers all 8 prefs keys (master + 7 categories) with optimistic PATCH `/api/profile/notifications`. |
| Connection management | One-time onboarding only, no post-onboard manage surface | Settings → Connections with per-source last sync | **CLOSED** · `ConnectionRow` per source on `ProfileView` shows connected + last sync + stale flag (amber when > 24h). |
| Per-user toggles (phone_hr_alerts, strava_auto_push) | Schema exists, no UI | Profile → Toggle rows | **CLOSED** · `ProfileToggleRows` on `ProfileView` lazy-fetches from `/api/profile` and PATCHes back. |

---

## Doctrine implications

These rules are now codified as system doctrine (eyebrow=`SYSTEM DOCTRINE` in `learn_articles`):

- `doctrine-input-tiers` — the 6-tier required-input model
- `doctrine-fallback-ladder` — the 4-step resolution order per physiology field
- `doctrine-apple-health-optional` — Apple Health is recommended, not required; every signal it provides has a manual or derived fallback (some pending)
- `doctrine-onboarding-min-set` — the minimum set of inputs to coach a runner safely (T1 + T2.birthday + T2.sex + T4.experience_level + T2.height_cm)

The contract: **the coaching engine never crashes for missing inputs.**
Every code path either has a fallback, defers gracefully, or surfaces a
profile_gap card asking for the input. Today's gaps are documented above
as pending work — not as blockers.

---

## Net state · 2026-05-31

**The audit has shifted from "where are the gaps" to "where do we
build."** Of the 7 gaps the original 2026-05-30 audit identified:

- **4 are CLOSED** by toolkit components shipped 2026-05-31:
  manual fallbacks for HRV/sleep/weight, late profile-gap surfacing,
  goals capture, notifications taxonomy management.
- **2 are GATED on the onboarding flow itself** (which is a redirect
  stub today): "always ask history chips on race path" and "Week shape
  step." These wait for the race-anchored onboarding design.
- **1 is REPLACED** by an explicit David decision: T2 physiology is
  now an auto-nudge on Today after 3 days, not a dedicated onboarding
  step.

**Plus 4 new closures** the original audit didn't flag (because the
toolkit + decisions hadn't shipped): cross-training logging,
connection-management surface, per-user toggles, no-race goal path
design brief.

**Plus 2 still-open items** the original audit underweighted:
- **Strength-day suggestion** is shipped via `pickStrengthDays` +
  the week-strip "+ STRENGTH" annotation. Settled.
- **Schedule-aware onboarding (Week shape step)** remains the lone
  open onboarding-flow gap that doesn't have a brief filed. Low
  priority — defaults work well — but is the next item if onboarding
  polish picks up.

The shape of "what onboarding needs to ask" is now well-defined by the
two design briefs:
- `designs/briefs/onboarding-no-race-path-brief.md` (locked, this cycle)
- (future) a race-anchored onboarding design — only when the existing
  redirect-to-Today behavior stops being correct.
