# Onboarding · audit + process spec

**Status:** spec ready for an Xcode implementation session
**Surface:** iPhone app at `native-v2/Faff/Faff` (the live app · NOT `ios/Runcino`)
**Date:** 2026-06-20
**Decisions locked with David (2026-06-20):**

- Target codebase: **`native-v2/Faff`** (live SwiftUI app).
- Account model: **invite-only** (email + password sign-in · "Request access" door). No open self-serve signup, no Sign in with Apple.
- Capture depth: **Standard** (running level + self-reported race history + light schedule + optional physiology).
- Goal/race is **set later, in-app** (Goals/Targets tab), NOT during onboarding.

This doc is the audit of what exists, the broken bits, the data-capture list, the Strava "hide unless connected" design, and an implementation checklist. The backend is already ahead of the iOS UI, so most of this is client-side wiring and flow cleanup, not new API work.

---

## 1. Audit · what exists today

### Auth + gate (keep)

- **Entry:** `FaffApp.swift` → `RootContainer` decides the gate.
  - `faff.onboarded` UserDefaults true → straight to `.main`.
  - Any cached surface bytes or a signed-in token → treat as returning, mark onboarded, `.main`.
  - Else `.signIn` → `.onboarding` → `complete()` sets `faff.onboarded` → `.main`.
- **Sign-in:** `SignInView` → `EmailSignInSheet`. Two modes:
  - `signIn`: POST `/api/auth/email` (email + password). Response carries `skipOnboarding` ("/today" returning vs "/onboarding" new).
  - `requestAccess`: POST `/api/auth/request-access` (**name + email**). Admin approves, emails a temp password.
- **Consequence for onboarding:** the runner's **name already exists** on the `users` row by the time onboarding runs (captured at request-access). Onboarding should NOT re-ask for name. Prefill it (editable) at most.

This whole gate + auth path is fine. Leave it. Invite-only stays.

### Current onboarding flow (`Views/OnboardingView.swift`)

Rendered steps (the `body` ZStack):

| Index | Panel | Header | Captures |
|---|---|---|---|
| 0 | `welcomePanel` | (none) | nothing |
| 1 | `connectPanel` | STEP 1 | Apple Health, Strava, Garmin(disabled) |
| 2 | `trainingPanel` | STEP 2 | days/week, weekly mileage, start day, long-run day |
| 3 | `profilePanel` | STEP 3 | DOB, sex, optional LTHR |
| 4 | `confirmPanel` | (none) | submit |

On submit: `API.completeOnboarding(payload)` then a best-effort `PATCH /api/profile` for `lthr` + `health_connected_at`.

### Backend contract (already supports the target flow)

`POST /api/onboarding/complete` (`web-v2/app/api/onboarding/complete/route.ts`) accepts:

- Goal: `distance` (`5k|10k|half|marathon|none|coached`), `date`, `time`, `ttDistance`, `ttTime`, `ttTimeSeconds`.
- Running level: `weeklyMi`, `weeklyFreq`, `histAvg`, `histLong`, `histYears`, `raceHistory[]` (≤3 PRs).
- Physiology: `birthday`, `sex`, `height_cm`.
- Schedule: `startDate`, `longRunDay`.
- Identity: `name`, `timezone`, `connectionsSkipped`.

Plan-seeding branch logic (route.ts:475–587):

- `coached` → author nothing.
- race distance → write `races` row + `generatePlan`.
- `ttDistance` present → maintenance seeder.
- **no race AND no TT goal → author NOTHING; runner lands on empty Today and a plan is generated later when they add a race (`/api/race`) or a goal (`/api/profile/goal`).**

That last branch is exactly David's intended flow. **Onboarding sends `distance:"none"` and no TT goal, then goal/race is set in-app.**

### Where the runner sets a goal/race after onboarding (keep)

- `Views/TargetsView.swift` — Goals/Targets tab. Cold state shows "+ ADD RACE" / "+ SET GOAL".
- `Components/Toolkit/F_Sheets.swift` → `NewGoalSheet` / `SetGoalSheet` → `/api/profile/goal`.
- `AddRaceSheet` / `RaceEditSheet` → `/api/race`.
- `TodayView` already renders a cold "no target" state (TodayView.swift:377, 1860).

This is the post-onboarding handoff. It works. Plan-specific scheduling (start day, plan length) belongs here, not in onboarding (see §4).

---

## 2. Audit · what is broken / rotten

1. **Dead `targetPanel` (OnboardingView.swift:467–546).** A full race/goal/"coached" mode picker with a goal-time stepper is written but **never rendered** — `body` goes Connect → Training → Profile, skipping it. Result: `mode` is permanently `.just`, `distance` always serializes to `"none"`, and ~250 lines of state (`mode`, `distance`, `goalSec`, `raceName`, `raceDate`, `ttBucket`, `ttDistanceCode`, `defaultGoal`, `stepper`, `modeChips`, `distanceChips`, `headline`) is reachable-but-unused or fully dead.
   - **This is the single biggest source of "onboarding is broken" confusion.** It looks like onboarding captures a goal; it does not, and cannot.
   - **Verdict: correct to remove.** It aligns with the decision to set goal/race in-app, and the backend already handles `distance:"none"` cleanly.

2. **Strava is shown unconditionally (the core requirement gap).** No "hide unless connected" logic exists anywhere. Specifically:
   - `Components/StravaReconnectBanner.swift:19` renders for **any** non-connected state — including `disconnected`/never-connected. A runner who never linked Strava gets a "Strava not connected · CONNECT" banner on **Today and Activity**. This is the exact bug to kill.
   - `Views/SettingsView.swift:124–143` — Strava connection row (this one SHOULD stay; it is the re-enable door).
   - `Views/ProfileView.swift:509–515` — duplicate Strava card row (hide unless connected).
   - Post-run "POST TO STRAVA" UI (`Components/TodayPostRunBody.swift:157–159`, `Components/StravaPushSheet.swift`) — gated on run source + runId, NOT on connection. Shows to non-connected users.
   - Notification auto-push toggle (`Components/Toolkit/G_Settings.swift:59–68`, wired in `ProfileView.swift:91–96`) — shows regardless of connection.

3. **Step labels inconsistent.** "STEP 1/2/3" on connect/training/profile, unnumbered welcome/confirm, and the dead `targetPanel` also claims "STEP 2". Progress dots are 5 segments. Renumber after the flow is finalized.

4. **Name handling is murky.** The onboarding payload sends `name` = the **race** name (default "Goal Race"); the backend uses it only for the race row and preserves the person's `full_name` via COALESCE. Fine, but confusing. With invite-only, the person's name is already set — do not collect it in onboarding, and do not reuse the `name` key for a person.

5. **Schedule asked too early.** `trainingPanel` collects `startDate` + `longRunDay`, but no plan is authored at onboarding (the `none` branch). These values sit unused until the runner sets a goal/race. Start day is plan-specific and should move to goal/race setup; long-run day is a durable preference and can stay (see §4).

6. **Garmin row is decoration.** "Coming soon", disabled, no integration. Recommend dropping it from the connect step to keep the step honest (Health + Strava only).

---

## 3. The capture list (what onboarding collects · Standard depth)

Goal/race is intentionally **excluded** here (set in-app afterward). "Source" = where the value comes from; "Backend field" = what `/api/onboarding/complete` (or the profile PATCH) persists.

### A. Identity — NOT asked in onboarding (already captured)

| Item | Source | Backend field |
|---|---|---|
| Name | request-access signup | `users.name` / `profile.full_name` |
| Email | request-access signup | `users.email` |
| Timezone | auto (`TimeZone.current`) | `users.timezone`, `profile.timezone` |

Onboarding sends `timezone` automatically and may prefill name read-only. It does not re-collect identity.

### B. Connections — Step 1

| Item | Mechanism | What it unlocks | Stored |
|---|---|---|---|
| **Apple Health** | `HealthKitImporter.requestAuthAndImport(daysBack:180)` | RHR, HRV, sleep, VO2max → readiness pillars; 220-age fallback context | `faff.health.connected.v2` UserDefaults + `profile.health_connected_at` (PATCH) |
| **Strava** | `StravaOAuthSession.start()` | run history → VDOT seed, real volume baseline | `profile.strava_connected_at` + `/api/strava/status` state |
| Skip ("I'll start fresh") | sets `connectionsSkipped=true` | plan/coach run in calibration mode honestly | `profile.connections_skipped` |

Strava stays visible **in onboarding** (so a Strava user can link). Hiding only applies to the rest of the app (§5).

### C. Running level — Step 2 (the "running level etc." the audit was asked for)

| Item | UI | Values | Backend field | Why |
|---|---|---|---|---|
| Days per week | chips | 3 · 4 · 5 · 6 | `weeklyFreq` → `profile.weekly_frequency` | plan frequency (no more 6-day plans for a 3-day runner) |
| Current weekly mileage | chips | 15 · 25 · 35 · 45 · 55+ | `weeklyMi` → `profile.weekly_mileage_target` | volume baseline / level cap |
| Typical recent weekly miles | chips | 0-5 · 5-15 · 15-25 · 25-35 · 35+ | `histAvg` → `profile.history_avg_weekly_mi` (midpoint) | seeds `state.volume.weeklyAvg4w` when no Strava |
| Longest recent run | chips | 0-3 · 3-6 · 6-10 · 10+ | `histLong` → `profile.history_longest_recent_mi` (midpoint) | floor for peak long-run cap |
| Years running | chips | <1 · 1-3 · 3-7 · 7+ | `histYears` → `profile.history_years_running` | experience hint → level + voice |
| **Race history (PRs)** | up to 3 entries | distance (5k/10k/half/marathon/other) + time + when (<6mo/6-12mo/1-2yr/2+yr) | `raceHistory[]` → `profile.race_history` jsonb | VDOT seed + coach voice band (calibration/guided/challenge) |

Note: `histAvg` (recent actual) and `weeklyMi` (target/current) overlap conceptually. Keep both fields the backend wants, but the UI can present them as one "where are you now" group to avoid asking the same thing twice. When Strava connects, the history group can prefill silently (web does this via `lib/onboarding/strava-history.ts`).

### D. About you — Step 3 (physiology · optional, skippable)

| Item | UI | Backend field | Why | Required |
|---|---|---|---|---|
| Date of birth | date picker | `birthday` → `age` | age-graded zones, 220-age fallback | optional |
| Sex | chips M/F | `sex` | cycle-phase HRV, RHR baselines | optional |
| Threshold HR (LTHR) | number, optional | PATCH `/api/profile` `lthr` (120–210) | direct zone anchor when known from a test | optional |
| Height | number cm, optional | `height_cm` (120–230) | cadence/overstriding coaching | optional |

### E. Schedule — light (Step 3 tail or merged)

| Item | UI | Backend field | Notes |
|---|---|---|---|
| Long-run day | day chips sun–sat | `longRunDay` → `user_settings.long_run_day` + `user_prefs` | durable preference; OK to capture now |
| Start day | — | `startDate` | **DEFER to goal/race setup** (plan-specific; no plan exists at onboarding) |

### F. Derived — never asked

VDOT seed (from race_history/goal/best Strava effort), experience/auto-level (from volume + years), max HR (auto-ratchet from watch), RHR/HRV baselines (from Health), strength-day picks (post-plan). Do not ask for these.

---

## 4. Target onboarding flow (Standard)

Five steps, renumber dots accordingly:

```
0 · Welcome           "Welcome to Faff" + start          (no capture)
1 · Connect           Apple Health · Strava · skip        Step 1
2 · Running level      freq · mileage · history · PRs      Step 2
3 · About you          DOB · sex · (LTHR) · (height) ·     Step 3
                       long-run day
4 · Confirm           "You're all set" → Start running     (submit)
```

Submit payload (no goal/race):

```
distance:            "none"
date/time/tt*:       null
weeklyFreq:          3..6
weeklyMi:            15/25/35/45/55
histAvg/histLong/histYears
raceHistory:         [{distance,timeSec,whenRaced}, ...]   // ≤3
birthday/sex/height_cm                                      // optional
longRunDay:          "sun".."sat"
timezone:            TimeZone.current.identifier
connectionsSkipped:  !anyConnected
// then PATCH /api/profile { lthr?, health_connected_at? }
```

Backend takes the `none` branch → authors nothing → runner lands on Today's cold state.

**Then, in-app:** Today cold state and the Goals/Targets tab invite "Add a race / Set a goal." That flow (`AddRaceSheet` / `NewGoalSheet`) is where `startDate`, plan length, and goal time are chosen and the plan is actually generated. Onboarding stays short; commitment-shaped choices happen when there is a plan to shape.

---

## 5. Strava "hide unless connected" design

### Source of truth

`isStravaConnected` resolves from `profile?.connections.strava.connected` (`API.ProfileConnectionState`) backed by `/api/strava/status` (`state == "connected"`).

Add a synchronous mirror so launch-time gating does not flicker, matching the HealthKit pattern (`faff.health.connected.v2`):

- New UserDefaults key `faff.strava.connected.v1`.
- Set `true` on a successful `StravaOAuthSession` round-trip and whenever `/api/strava/status` returns `connected`.
- Set `false` when status returns `disconnected`, and on sign-out (alongside the existing `faff.onboarded` / health-key clears in `SettingsView`/`ProfileView`).

Expose `var isStravaConnected: Bool` (read the mirror, refresh from status on appear).

### Gating rules

| Surface | When NOT connected | File |
|---|---|---|
| Settings → Connections → Strava row | **SHOW** (this is the re-enable door; label "Connect") | `SettingsView.swift:124–143` |
| Onboarding → Connect → Strava | **SHOW** (let Strava users link) | `OnboardingView.swift:265–272` |
| Today reconnect banner | **HIDE** for never-connected; show only `needs_reauth` | `StravaReconnectBanner.swift:19` |
| Activity reconnect banner | same | `ActivityView.swift:64–65` |
| Profile → Strava card row | **HIDE** | `ProfileView.swift:509–515` |
| Post-run "POST TO STRAVA" + auto-push pill | **HIDE** | `TodayPostRunBody.swift:157–159`, `StravaPushSheet.swift` |
| Notification → Strava auto-push toggle | **HIDE** | `G_Settings.swift:59–68` (via `ProfileView.swift:91–96`) |

### The key banner fix

`StravaReconnectBanner` currently renders for `state != "connected"`, which includes `disconnected` (never linked). Change the guard to render **only** when `state == "needs_reauth"`:

```swift
// was: if let s = status, s.state != "connected"
if let s = status, s.state == "needs_reauth" {
```

A never-connected runner then sees zero Strava prompts on Today/Activity. The `isFirstTime`/`CONNECT` copy branch becomes dead and can be dropped — the banner is reconnect-only. Connecting Strava for the first time happens via Settings (or onboarding), never via a surprise banner.

### Garmin

Drop the disabled "Coming soon" Garmin row from the connect step. No integration exists; the step should be honest (Health + Strava).

---

## 6. Implementation checklist (for the Xcode session)

In `native-v2/Faff/Faff`:

1. **`OnboardingView.swift` — remove dead target/goal code.** Delete `targetPanel`, `TargetMode`/`Distance` usage tied to it, `modeChips`, `distanceChips`, `stepper`, `goalBlock`, `headline`, `defaultGoal`, `ttBucket`, `ttDistanceCode`, and the `mode/distance/goalSec/raceName/raceDate` state. Hard-set the payload to `distance:"none"` with all goal/TT fields null. Confirm the `none` branch in route.ts still fires.
2. **Restructure to the 5 steps in §4.** Reorder panels (Connect → Running level → About you → Confirm), fix STEP labels and the progress capsules.
3. **Add race-history capture UI** (Standard): up to 3 entries, each distance + time + when, serialize to `raceHistory[]`.
4. **Keep physiology** (DOB/sex/LTHR already present); optionally add height. Keep long-run day; **remove start-day** from onboarding (it moves to goal/race setup).
5. **Name:** prefill from profile (read-only) or omit. Stop overloading the `name` payload key as a person name.
6. **Strava gating (§5):**
   - Add `faff.strava.connected.v1` mirror + `isStravaConnected` accessor; set/clear on OAuth success, status refresh, and sign-out.
   - Fix `StravaReconnectBanner` guard to `needs_reauth` only.
   - Hide the Profile Strava row, post-run push UI, and notification auto-push toggle unless connected.
   - Keep the Settings Strava row and the onboarding Strava tile visible.
   - Drop the Garmin row.
7. **Verify the gate is untouched** (`RootContainer` keys off `faff.onboarded` + server `onboarding_complete`).

No backend changes required for the Standard flow — every field already lands. The only optional backend follow-up: have `/api/strava/status` distinguish `disconnected` vs `needs_reauth` reliably so the banner fix behaves (the contract already returns both states).

---

## 7. Open follow-ups (not blocking this session)

- Strava history prefill on the running-level step (mirror web `lib/onboarding/strava-history.ts`) so connected users skip the chips.
- First-morning coach voice band wiring from `race_history` (calibration/guided/challenge per the master brief).
- Decide whether long-run day should also defer to goal/race setup (currently kept in onboarding as a durable pref).
</content>
</invoke>
