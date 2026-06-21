# Local-session brief — onboarding rewrite + Strava gating + HealthKit import

**Branch:** `claude/onboarding-process-audit-mxhekq` (pull it; all work is here)
**App:** `native-v2/Faff/Faff.xcodeproj` (the live app — NOT `ios/Runcino`)
**Full spec/audit:** `docs/design/onboarding-process-audit-and-spec.md`
**Your job:** open in Xcode, build, fix any compile nits (this work was written without a compiler), run on a **real device with Apple Health data**, and verify the three feature areas below.

---

## What changed (already committed on the branch)

**New file — must be added to the `Faff` target in Xcode:**
- `native-v2/Faff/Faff/Util/StravaConnection.swift` — synchronous "is Strava linked" flag (UserDefaults mirror).

**Modified:**
- `Views/OnboardingView.swift` — full rewrite. 5 steps: Welcome → Connect → Your running → About you → Confirm. Dead goal/race picker removed (goal/race is set in-app later). Adds race-history PRs, height, start day + long-run day. Greets by name. Sends `distance:"none"`.
- `FaffApp.swift` — `RootContainer.complete(deepHealthImport:)` re-runs a 365-day HK import after onboarding.
- `HealthKitImporter.swift` — start background delivery on connect; `importInFlight` guard; chunked vitals POST (500/req).
- `Util/StravaOAuthSession.swift` — set `StravaConnection.set(true)` on OAuth success.
- `Components/StravaReconnectBanner.swift` — render only for `needs_reauth` (not never-connected).
- `Components/TodayPostRunBody.swift`, `Views/RunDetailView.swift` — hide post-run Strava push unless connected.
- `Views/ProfileView.swift` — hide Strava connection row + notification auto-push toggle unless connected; mirror set on profile load + sign-out clear.
- `Views/SettingsView.swift`, `Views/ActivityView.swift`, `Views/TodayView.swift` — set the Strava mirror on profile/state loads.

---

## Build first

1. Add `Util/StravaConnection.swift` to the `Faff` target (Xcode won't pick it up automatically).
2. Build. Most-likely compile nits (written without a compiler):
   - `OnboardingView.swift` — the result-builder `runningPanel`/`raceHistorySection`, the `ForEach($raceEntries)` binding loop, and the `chipRow(_:action:)` helper. If anything red-lines it's almost certainly here and one-line.
   - Confirm `ProfileState.full_name` and `API.fetchProfileState()` resolve (used for the name greeting).
3. Fixes should be minimal — don't redesign; match the surrounding style.

---

## Verify — onboarding

- Walk all 5 steps. Progress dots = 5. Back chip works.
- "I'll start fresh" skips connect; "Continue" is enabled only once Health or Strava connects.
- Running step: days/week, weekly mileage, longest run, years, **race history** (toggle "I've raced" → add up to 3 entries, time field + distance/when chips, remove works), start day, long-run day.
- About you: DOB, sex, optional height + threshold HR.
- Confirm greets by name ("You're set, {name}.").
- Submit → lands on Today's cold state ("add a race or set a goal"). Then confirm the Goals/Targets tab still creates a race/goal and generates a plan (unchanged path).

## Verify — Strava hidden until connected

Test **both** states:
- **Not connected:** no Strava banner on Today/Activity; no Strava row on Profile; no post-run "POST TO STRAVA" (Today + Run Detail); no auto-push toggle in notifications. Settings → Connections **still shows** the Strava connect row, and onboarding still shows the Strava tile.
- **Connected:** all of the above reappear. Connect via Settings, confirm UI flips without needing a relaunch.
- Sign out → confirm Strava visibility resets for the next account.

## Verify — HealthKit import (the Lilian bug)

Use a **real device with Health data** (Simulator has none → false negative).
- In onboarding, tap Connect Apple Health → **grant the read toggles** in the sheet (this is the #1 gotcha: tapping through without enabling = silent empty import).
- The connect row shows the count. **"0 runs · 0 vitals" = permission not granted**, not a transport bug.
- After finishing onboarding, confirm Today/Health populate (sleep, RHR/HRV, recent runs).
- If it still shows 0 after granting on a device with data: tell the home session — we'll add an in-app diagnostic that reports raw HK query counts.

---

## Guardrails

- Keep developing on `claude/onboarding-process-audit-mxhekq`. Commit as you fix; don't merge to `main` without David's go.
- No backend changes are required — every field already lands server-side.
- Don't re-add the goal/race picker to onboarding; that's deliberately in-app now.
</content>
