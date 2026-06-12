# iPhone Settings Consolidation — Backend Ready, Native Build Needed

**Status:** backend + web shipped live to main/Railway 2026-06-12. iPhone is the only remaining surface. Everything the native UI needs to read/write is already deployed — this is a pure SwiftUI job.

**Goal:** make iPhone settings actually let the runner set what the app needs (name, height, weight, sex, birthday, training days, days/week, timezone, fuel, physiology), matching the approved mock and the web surface. Kill the dead/fake controls. Consolidate the two overlapping native surfaces into one genuinely-wired home.

---

## What's already live on the backend (your API contract)

### `PATCH /api/profile` — JSON body, any subset. Response `{ ok, updated, replanned }`. Bad value → 400 with message. `null`/`""` clears the optional numeric/fuel fields.

| Key | Type | Bounds |
|---|---|---|
| `full_name` | string | — |
| `gender` | "male"\|"female"\|"other" | stored as sex |
| `birthday` | "YYYY-MM-DD" | — |
| `height_cm` | number | — |
| `weight_kg` | number | 20–300 (NEW column, falls back to HealthKit body_mass when null) |
| `experience_level` | beginner\|intermediate\|advanced\|advanced_plus | plan-shaping |
| `lthr` | int | 80–220 |
| `max_hr_override` | int | 100–230 (sovereign max-HR; writes users.max_hr_override) |
| `resting_hr_override` | int | 25–120 |
| `weekly_frequency` | int | 1–7, plan-shaping (was onboarding-only, now settable) |
| `weekly_mileage_target` | int | plan-shaping (already wired on iPhone) |
| `cross_training_modes` | string[] | plan-shaping (cycling/swimming/strength/elliptical/rowing/yoga) |
| `fuel_brand` | string ≤80 | race-day watch gel cues |
| `fuel_gel_carbs_g` | int | 0–100 |
| `fuel_target_g_per_hr` | int | 0–150 |
| `timezone` | IANA string | pins manual mode |
| `tz_mode` | "auto"\|"manual" | "auto" resumes travel-following |

### `PATCH /api/settings` — JSON body, any subset. Response `{ ok, patch, replanned }`.

`long_run_day`, `rest_day` (lowercase `"sun".."sat"`), `quality_days` (string[] of those), `briefing_time` ("HH:MM"), `push_enabled` (bool), `units_distance`/`units_temp`/`units_pace`.

### `GET /api/profile` now also returns: `email`, `weekly_frequency`, `weight_kg`, `timezone`, `tz_mode`, `max_hr_override`, `resting_hr_override`, `fuel_brand`, `fuel_gel_carbs_g`, `fuel_target_g_per_hr` (plus all existing fields). Seed the editor from this.

**`replanned: true`** comes back when a plan-shaping edit triggered a server-side plan rebuild. When you see it, refresh Today/Train so the new plan shows.

### Native models to extend (`API.swift`)
`ProfileFields` (~:1113) — add the new optional fields above. `updateProfile(patch)` (:160) and `patchSettings(patch)` (:331) already send arbitrary keys, so no new methods needed. `setRunnerTimezone` lives server-side; just PATCH `{timezone}` or `{tz_mode}`.

---

## Already wired on iPhone — DO NOT duplicate
ProfileView.swift: `NotificationPrefsList` → /api/profile/notifications (:89–107), weekly-mileage stepper (:294–301), `strava_auto_push`, `phone_hr_alerts`, sign-out. SettingsView.swift: units segments (:57–68), cycle toggle, connections (Strava/Health/Watch), sign-out.

## Dead code to fix/remove
**SettingsView.swift**
- `:183` hardcoded `navRow(title: "david@workprint.la")` → real `email` from GET /api/profile.
- `:74–78` dead "Week starts" / "Default shoe" / "Adaptive plan" → replace with real training-day controls.
- `:102–111` fake NOTIFICATIONS toggles (dead @State, never persisted) → remove; the real ones live in ProfileView's NotificationPrefsList.
- `:184–185` "Faff Pro" / "Privacy & data" dead rows → wire or drop.

**ProfileView.swift**
- `:276–292`, `:306–308` hardcoded display-only placeholders (`briefingTimeLabel "07:00"`, `longRunDayLabel "Saturday"`, `restDayLabel "Monday"`, `interactive:false`) → make real (PATCH /api/settings) or remove if SettingsView now owns them.

---

## Target surface (match the mock + web)
- **YOU** — name · sex · birthday · height (show ft/in, send cm) · weight (show lb, send kg) · experience
- **TRAINING** — days/week · long run · rest day · quality days · weekly target (wired) · cross-training
- **PHYSIOLOGY** — LTHR · max HR override (RHR/VDOT stay display-only)
- **TIMEZONE** — "Auto-update on travel" toggle (tz_mode) + manual zone picker when off
- **RACE FUELING** — gel brand · carbs/gel · target g/hr
- **ACCOUNT** — real email · Faff Pro · sign out (wired)

## Consolidation — pick ONE home
The audit found two overlapping native surfaces (ProfileView avatar sheet + nested SettingsView) that contradict each other. Web resolved it to one panel. Recommend: **SettingsView becomes the comprehensive editable home** (it already has section/row/navRow/segment scaffolding + units + connections + sign-out); ProfileView keeps DISPLAY (identity, physiology tiles, shoe garage, the already-wired notif panel) and its settings card deep-links into the now-real SettingsView; delete ProfileView's dead placeholder rows. Your call — you know the native tree best — but the end state is one surface with zero fake controls.

## Reuse
ProfileView `weeklyMiSheet` stepper (:294–385) is the edit-sheet template for numbers. SettingsView `segment()` for 2-way pickers. Chips for multiselect (quality days, cross-training). Web reference implementation (field list + generic editor): `web-v2/components/faff-app/views/SettingsPanel.tsx`.

## Notes
- **Units:** David hid the units toggle on web because nothing reads it for display (no formatter exists anywhere — confirmed). The iPhone units segments are the same: write-only, no display effect yet. For parity, consider hiding/de-emphasizing them too (low priority). Minor: native sends `"MI"/"KM"` uppercase while the server default is lowercase `'mi'/'km'` — harmless today (dead), align if you touch it.
- **Weight:** new manual field; HealthKit body_mass is the fallback when null. Show lb, store kg.

## Design + voice
Brief v2 (Theme.swift locked palette, Oswald/Inter, dark mesh, glass retired). Match the iPhone sections in `docs/design/settings-redesign-2026-06-12.html`. Coach voice for copy: short, direct, no hype, no emoji, no em dashes.

## Verify + ship gate
Build-verify it compiles (the usual native incantation — watch-AppIcon wall / DerivedData object-file trick). Then commit → push main → install on simulator → **David reviews → TestFlight ONLY on his explicit go.** Do not auto-ship TF.

## References
- Mock: `docs/design/settings-redesign-2026-06-12.html`
- Web impl: `web-v2/components/faff-app/views/SettingsPanel.tsx`
- Backend: `web-v2/app/api/profile/route.ts` (allow-lists + validateField bounds), `web-v2/app/api/settings/route.ts`, `web-v2/lib/runtime/runner-tz.ts` (`setRunnerTimezone`)
- Full context: memory `project_settings_redesign_2026-06-12.md`
