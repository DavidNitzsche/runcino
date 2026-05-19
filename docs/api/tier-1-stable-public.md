# Tier 1 · Stable public API

Routes documented here have settled contracts and stable auth shapes.
Safe to call from a native iPhone client.

**Entry shape**:
```
### METHOD /path
- **Auth** · what authentication is required
- **Purpose** · one-line description
- **Request** · request shape (POST/PUT/DELETE only)
- **Response** · response JSON shape, key fields
- **Consumers** · which web surfaces use it today
- **Audit** · discipline-rule check result
```

---

## Profile · user-set values + accent

### GET /api/profile/max-hr
- **Auth** · cookie session (`requireActiveUser`)
- **Purpose** · resolved max HR with source (manual override / computed / none)
- **Response** · `{ value: number | null, source: 'manual' | 'computed' | 'none', computed: { value, source: { id, name, date, workoutType, distanceMi } } | null }`
- **Consumers** · `/profile` MaxHrIsland (SSR)
- **Audit** · ✅ reads from `users.max_hr`; source-of-truth clear

### POST /api/profile/max-hr
- **Auth** · cookie session
- **Purpose** · set or clear manual max HR override
- **Request** · `{ maxHr: number | null }` (null clears; valid range 100-230)
- **Response** · same shape as GET (post-update)
- **Consumers** · `/profile` MaxHrIsland apply
- **Audit** · ✅ stamps `max_hr_updated_at`, clears `max_hr_validation_dismissed_at` on change

### GET /api/profile/resting-hr
- **Auth** · cookie session
- **Purpose** · resting HR (from `profile.rhr`)
- **Response** · `{ value: number | null }`
- **Consumers** · `/profile` RestingHrIsland
- **Audit** · ✅ future HealthKit-M2 ingest planned; today manual-only

### POST /api/profile/resting-hr
- **Auth** · cookie session
- **Purpose** · set manual resting HR
- **Request** · `{ value: number }` (typical 35-80)
- **Response** · `{ ok: true, value }`
- **Consumers** · `/profile` RestingHrIsland
- **Audit** · ✅ clean write

### GET /api/profile/accent
- **Auth** · cookie session
- **Purpose** · UI accent color preference
- **Response** · `{ accent: 'corp' | 'race' | 'xp' | ... }`
- **Consumers** · `/profile` accent picker
- **Audit** · ✅ pure UI pref

### POST /api/profile/accent
- **Auth** · cookie session
- **Purpose** · set accent color
- **Request** · `{ accent: string }`
- **Response** · `{ ok: true, accent }`
- **Consumers** · `/profile` accent picker

### GET /api/profile/vo2-max
- **Auth** · cookie session
- **Purpose** · Apple Health VO2max + last-updated timestamp
- **Response** · `{ value: number | null, updatedAt: ISO | null }`
- **Consumers** · `/profile` VO2maxIsland
- **Audit** · ✅ wellness signal only; **never** feeds VDOT/pace prescription

### POST /api/profile/vo2-max
- **Auth** · cookie session
- **Purpose** · manual VO2max entry (HealthKit-M2 ingest path TBD)
- **Request** · `{ value: number }`
- **Response** · `{ ok: true, value, updatedAt }`

### GET /api/profile/activity-gap/mark
- **Auth** · cookie session
- **Purpose** · record user acknowledgment of E1/E4 gap state (planned / injured / unexpected)
- **Response** · `{ ok: true }`
- **Consumers** · `/overview` StravaGapCard action buttons

### POST /api/profile/max-hr/validate/dismiss
- **Auth** · cookie session
- **Purpose** · dismiss max HR validation banner (suppresses for 30d or until new contradiction)
- **Response** · `{ ok: true }`
- **Consumers** · `/profile` MaxHrValidationBanner dismiss button
- **Audit** · ✅ writes `max_hr_validation_dismissed_at` timestamp

### POST /api/profile/acknowledge-pace-migration
- **Auth** · cookie session
- **Purpose** · acknowledge one-time pace-zones migration banner
- **Response** · `{ ok: true }`
- **Consumers** · `/profile` PaceMigrationBanner dismiss

---

## Fitness · derived training paces

### GET /api/fitness
- **Auth** · cookie session
- **Purpose** · resolved fitness bundle — single source of truth for pace prescriptions across the app
- **Response** ·
  ```
  {
    vdot: { value, source, contributors: [...], cycleStartIso },
    maxHr: { value, source },
    restingHr: { value, source },
    hrZones: { z1: {lowBpm, highBpm}, z2, z3, z4, z5 },
    pacesByDistance: { mile, 3k, 5k, 10k, 15k, half, marathon },
    paceBands: { E, M, T, I, R },
  }
  ```
- **Consumers** · `/training`, `/overview` TodayCard pace targets, workout modals
- **Audit** · ✅ canonical resolver; every pace-rendering surface in the app reads from this

---

## Plan · weekly schedule + skip actions

### GET /api/plan/active
- **Auth** · cookie session
- **Purpose** · active plan post-lifecycle, with recent mutations applied
- **Response** · `{ plan: { weeks: [...], phases: [...] }, lifecycleAction: string, recentMutations: [...] }`
- **Consumers** · `/training` PlanCalendar (SSR), `/overview` TodayCard

### POST /api/plan/skip
- **Auth** · cookie session
- **Purpose** · mark today's planned workout as skipped (toggle)
- **Request** · `{ action: 'skip' | 'unskip', dateISO: string }`
- **Response** · `{ ok: true, skip: { dateISO, plannedWorkoutType, reason } | null }`
- **Consumers** · `/overview` TodayCard skip button, `/log` skip toggle
- **Audit** · ✅ LA-time normalization; clear intent signal for adaptive surfaces

---

## Races · saved races + plans

### GET /api/races
- **Auth** · cookie session
- **Purpose** · list saved races (upcoming first, then past)
- **Response** · `{ races: [{ slug, name, date, distanceMi, goal, plan, gpxText, meta }] }`
- **Consumers** · `/races` RaceList (SSR), race-picker modals

### POST /api/races
- **Auth** · cookie session
- **Purpose** · upsert race plan (slug-based idempotent write)
- **Request** · `{ slug, name, date, distanceMi, goal, plan, gpxText, meta }`
- **Response** · `{ ok: true, slug }`
- **Consumers** · `/races` RaceBuilder
- **Audit** · ✅ writes to `races` table; idempotent upsert by slug; race_results separately tracked in `actual_result` jsonb column

### GET /api/races/[slug]
- **Auth** · cookie session
- **Purpose** · single race plan + historical actual result
- **Response** · `{ race: { slug, name, date, distanceMi, plan, gpxText, meta, actualResult: { finishS, splits, activityId } | null } }`
- **Consumers** · `/races/[slug]` detail page, race-rebuilder
- **Audit** · ✅ reads `actual_result` from `races` table (L6 source-of-truth)

### POST /api/races/[slug]/priority
- **Auth** · cookie session
- **Purpose** · set race priority (A / B / C)
- **Request** · `{ priority: 'A' | 'B' | 'C' }`
- **Response** · `{ ok: true }`
- **Consumers** · `/races` priority picker; coach uses priority for next-A selection + cycle window logic

---

## Shoes · rotation tracking

### GET /api/shoes
- **Auth** · cookie session
- **Purpose** · list active + retired shoes with mileage tracking
- **Response** · `{ shoes: [{ id, name, brand, mileage, mileage_cap, retired, run_types }] }`
- **Consumers** · `/profile` ProfileModalsIsland, `/runs/[id]` shoe-picker

### POST /api/shoes
- **Auth** · cookie session
- **Purpose** · create new shoe
- **Request** · `{ name, brand, mileage_cap, run_types?: string[] }`
- **Response** · `{ ok: true, id }`

### GET /api/shoes/[id]
- **Auth** · cookie session
- **Purpose** · single shoe record
- **Response** · `{ shoe: { id, name, brand, mileage, mileage_cap, retired, run_types } }`

### POST /api/shoes/[id]
- **Auth** · cookie session
- **Purpose** · update shoe attributes
- **Request** · `{ name?, brand?, mileage_cap?, retired? }`
- **Response** · `{ ok: true }`

### DELETE /api/shoes/[id]
- **Auth** · cookie session
- **Purpose** · soft-delete (sets `retired: true`)
- **Response** · `{ ok: true }`

---

## Runs · cached Strava activities

### GET /api/runs/[id]
- **Auth** · cookie session (implicit; multi-tenant filter applied)
- **Purpose** · single run from `strava_activities` cache, computed details
- **Response** · `{ run: { id, name, distanceMi, paceSPerMi, hrAvg, elevGainFt, splits: [...], shoeId } }`
- **Consumers** · `/log` run detail modal
- **Audit** · ✅ reads from `strava_activities`; splits preservation per Rule 6 holds

### POST /api/runs/[id]/shoe
- **Auth** · cookie session
- **Purpose** · assign shoe to a run
- **Request** · `{ shoeId: string | null }`
- **Response** · `{ ok: true }`

### POST /api/strava/activity/[id]/shoe
- **Auth** · cookie session
- **Purpose** · same as `/api/runs/[id]/shoe` — Strava activity ID variant
- **Note** · duplicate path; preserved for backward compat.  Cleanup candidate.

### GET /api/runs/by-date
- **Auth** · cookie session
- **Purpose** · aggregated runs for date range (year heatmap, monthly rollup)
- **Request** · query: `?start=ISO&end=ISO`
- **Response** · `{ runs: [{ dateISO, distanceMi, count }] }`
- **Consumers** · `/log` YearHeatmap, MonthlyVolumeCard

### GET /api/strava/bests
- **Auth** · cookie session
- **Purpose** · PR (personal best) times across the Strava cache
- **Response** · `{ prs: [{ label, distance, time, date, pace }] }`
- **Consumers** · `/log` LifetimePRList, `/profile` PR strip
- **Audit** · ⚠ naive algorithm — uses Strava best-effort estimates, not race-source filtered.  Race PRs on `/races` use a stricter filter (race-source only).  Don't confuse the two.

---

## Health · check-in + recovery

### GET /api/checkin
- **Auth** · cookie session (implicit)
- **Purpose** · daily check-in for a date (energy / soreness / stress)
- **Request** · query: `?date=ISO`
- **Response** · `{ checkin: { dateISO, energy, soreness, stress } | null }`
- **Consumers** · `/health` CheckInCard

### POST /api/checkin
- **Auth** · cookie session
- **Purpose** · create / upsert daily check-in
- **Request** · `{ dateISO, energy: 1-5, soreness: 1-5, stress: 1-5 }`
- **Response** · `{ ok: true }`

### GET /api/recovery
- **Auth** · cookie session
- **Purpose** · recovery activities for date range with credit summary
- **Request** · query: `?start=ISO&end=ISO`
- **Response** · `{ services: [...], activities: [...], creditSummary: { total, available, pending } }`
- **Consumers** · `/health` RecoveryList

### POST /api/recovery
- **Auth** · cookie session
- **Purpose** · create recovery activity (cold plunge, massage, etc.)
- **Request** · `{ type: string, dateISO: string, durationMin?: number }`
- **Response** · `{ ok: true, activity }`

### DELETE /api/recovery/[id]
- **Auth** · cookie session
- **Purpose** · soft-delete recovery activity
- **Response** · `{ ok: true }`

---

## Connectors · integration status

### GET /api/connectors
- **Auth** · cookie session
- **Purpose** · active / available integrations (Strava, HealthKit, Garmin)
- **Response** · `{ connectors: [{ id: string, name: string, connected: boolean, status: string }] }`
- **Consumers** · `/profile` ConnectorsCard, `/training` ConnectBanner

### GET /api/connectors/[provider]/disconnect
- **Auth** · cookie session
- **Purpose** · revoke integration (Strava token, HealthKit perms)
- **Response** · `{ ok: true }`

### GET /api/profile/writeback
- **Auth** · cookie session
- **Purpose** · check if Strava connection allows activity writeback (for shoe-assignment sync)
- **Response** · `{ ok: boolean, reason?: string }`
- **Consumers** · `/runs/[id]` shoe-picker pre-check

### POST /api/profile/writeback
- **Auth** · cookie session
- **Purpose** · trigger Strava writeback sync (push shoe tags to activity descriptions)
- **Response** · `{ ok: true, updated: number }`

### POST /api/strava/sync-me
- **Auth** · cookie session
- **Purpose** · refresh this user's Strava activities now
- **Response** · `{ ok: true, synced: number }`
- **Consumers** · `/profile` "Sync now" button

---

## Adaptive banners · user agency on system findings

### POST /api/profile/vdot-shift/action
- **Auth** · cookie session
- **Purpose** · respond to large-shift guard (>2pt VDOT drift since last review)
- **Request** · `{ action: 'apply' | 'snooze' | 'dismiss' }`
- **Response** · `{ ok: true }`
- **Consumers** · `/profile` VdotShiftBanner

### POST /api/profile/adaptive-vdot
- **Auth** · cookie session
- **Purpose** · respond to L7 verdict (Signal 1-4 fitness movement evidence)
- **Request** · `{ action: 'apply' | 'dismiss', vdot?: number }`
- **Response** · `{ ok: true, appliedVdot?: number }`
- **Consumers** · `/profile` AdaptiveVdotBanner
- **Audit** · ✅ Rule 2 falsifier rendered inline (`What would change our mind: …`)

---

---

## Native auth · Bearer token (S6 watch-bridge phase)

### POST /api/auth/token
- **Auth** · public (email+password)
- **Purpose** · exchange credentials for an access+refresh token pair
- **Request** · `{ email, password }`
- **Response** · `{ accessToken, refreshToken, expiresIn, user }`
- **Consumers** · iPhone bridge login flow
- **Audit** · ✅ generic auth-failure response (no enumeration)

### POST /api/auth/token/refresh
- **Auth** · refresh token in body
- **Purpose** · rotate refresh + access · old refresh revoked atomically
- **Request** · `{ refreshToken }`
- **Response** · `{ accessToken, refreshToken, expiresIn }`

### POST /api/auth/token/revoke
- **Auth** · refresh token in body
- **Purpose** · logout · revokes refresh + cascades to active access tokens
- **Request** · `{ refreshToken }`
- **Response** · `{ ok: true }`

---

## Watch app

### GET /api/watch/today
- **Auth** · Bearer (cookie also accepted for testing)
- **Purpose** · today's structured workout in watchOS-consumable phases array
- **Response** · `WatchWorkout` · `{ workoutId, name, summary, totalEstimatedMinutes, phases, completionEndpoint, expiresAt }` — see `lib/watch-workout.ts`
- **Consumers** · iPhone bridge (fetches, pushes to watch via WatchConnectivity)
- **Audit** · ✅ reads from synthetic-plan (same source as web TodayCard); rest/race days return `{ workoutId: null, reason }`

---

## HealthKit ingest

### POST /api/health/ingest
- **Auth** · Bearer (cookie also accepted)
- **Purpose** · batch ingest of HealthKit samples from the iPhone bridge
- **Request** · `{ samples: [{ type, value, dateISO, source?, metadata? }] }` — types: `resting_hr` | `max_hr` | `vo2_max` | `sleep_hours` | `workout_hr_avg`
- **Response** · `{ ok, ingested, skipped, errors, byType }`
- **Consumers** · iPhone bridge (HKObserverQuery → POST batch)
- **Audit** · ✅ idempotent UPSERT on (user_id, sample_type, sample_date); per-sample plausibility validation; updates `users.resting_hr` + `users.max_hr` + `max_hr_updated_at` as side effect of newer samples

---

## Tier-2-to-tier-1 lifts (S6 watch-bridge phase)

Computations that previously ran inside Next.js SSR envelopes,
extracted as standalone GET endpoints so native clients can compose
without the envelope.  All take Bearer auth (cookie also accepted).

### GET /api/profile/activity-gap
- **Purpose** · E1/E4 gap state machine
- **Response** · `StravaGapFinding` · `{ state, daysSinceLastRun, lastRunDate, mark, markedAt, signalsSuspended, plannedBreakActive }`

### GET /api/health/readiness
- **Purpose** · C6 readiness score with V5 cross-reference
- **Response** · `ReadinessFinding` · `{ score, state, recommendation, inputs, missingInputs, suppressReason?, crossRef? }`
- **Audit** · ✅ V5 → C6 cross-ref `consistent with` relation fires when fatigue-family inputs reduced the score

### GET /api/health/z2-coverage
- **Purpose** · V5 Z2 stimulus check
- **Response** · `Z2CoverageFinding` · `{ shouldRender, suppressReason?, z2CeilingBpm, ePaceRangeDisplay, last7d, last28d, thresholdUnderReach }`

### GET /api/health/z2-sparkline
- **Purpose** · C2 8-week Z2 pace trend with recalibration cross-reference
- **Response** · `Z2SparklineResult` · `{ z2Band, points, paceRange, hasSignal, crossRef?, recalibrationHedge? }`
- **Audit** · ✅ V7 three-case recalibration window logic active

### GET /api/races/[slug]/trajectory
- **Purpose** · V3 race trajectory state (AHEAD / ON-TRACK / BEHIND / COLLECTING)
- **Response** · `{ slug, state, signals, headline, falsifier }`
- **Audit** · ✅ falsifier always present (Rule 2)

### GET /api/races/[slug]/projection
- **Purpose** · C9 race result projection chart data
- **Response** · `{ slug, raceName, weeksToRace, currentVdot, goalVdot, goalFinishS, distanceMi, points, hasMeaningfulPlanTrajectory }`
- **Error responses** · 404 race not found, 400 race has no parseable goal

### GET /api/adaptive/vdot-verdict
- **Purpose** · the L7 adaptive verdict (the most adaptive-state surface in the system)
- **Response** · `AdaptiveVdotVerdict` · `{ currentVdot, dismissed, manualOverride, signals, signal2, signal3, signal4, hasFinding, recommendation: { kind, ... } }`
- **Audit** · ✅ falsifier present on bump-suggested and downgrade-investigate; V7 Signal-4 → VDOT cross-reference present when Signal 4 contributed to bump
- **Note** · `recommendation.kind` is the discriminated-union signal · iPhone client branches on it

---

## Notes on auth

Tier 1 routes accept BOTH **cookie session** (web) and **Bearer
access token** (native).  The dual-mode check happens in
`getCurrentUser(req)` — Bearer is checked first when the request
provides an Authorization header, cookie is the fallback.  Web flow
is bit-for-bit unchanged; native flow has the new path.

Token issuance / rotation / revocation live in `/api/auth/token{,/refresh,/revoke}`.
