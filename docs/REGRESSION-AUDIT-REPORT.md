# REGRESSION / STABILITY AUDIT — the three fix batches landing

**Date:** 2026-06-09 (late evening) · **Auditor:** read-only (code + `DATABASE_URL_RO`, role `faff_readonly`; zero writes except this file and two RO scripts)
**Subject:** What breaks when the UI, STATE, and ADVERSARIAL fix batches land, and what is already fragile underneath them. Landing window = the taper (Jul 13–Aug 16, AFC −68d).
**Method:** dependency graph traced from code (file:line for every claim), prod queried for every edge case, taper simulated date-by-date with real data, rollback paths checked per fix.

**A fact that reshaped this audit:** the batches are not "going to land" — they are **landing right now, uncommitted, in this shared checkout**. The working tree grew from 17 modified files to **64** (+2 untracked engine files) *during the audit*; the F4 readiness guard and the spec-builder race-pace fix arrived between my first sweep and this report's final pass, and both are folded in below. Everything here audits the actual in-flight diff, not the briefs' intentions, and distinguishes three states: **LANDED-IN-TREE** (in the uncommitted diff), **DECLARED-NOT-LANDED** (in a batch's scope but absent from the tree), and **STORED-DATA** (needs a gated DB write no code can do alone).

---

## Executive summary

The in-flight code is better than the briefs deserved — the fix agent found and fixed parsers the audits missed (`TargetsView.swift`, `RaceView.tsx`), built one shared heat model instead of two patched tables, and made the watch race payload self-defusing. But the landing, as it stands tonight, has five structural problems:

1. **The single worst dated bug — the Aug 1 VDOT cliff (F1) — is not in the landing set.** Everything around it landed; the cliff itself didn't. Worse, a *new* UI line that landed (`HealthView.tsx` anchor-staleness copy) promises a failure mode the engine cannot produce ("band widens to ±8% at 180 days") while the real failure (47.9 → 44.1 overnight, headline flips to 1:41:55, status → OFF-TRACK, CI ×1.5) remains fully armed for Aug 1.
2. **One in-flight change contains a live landmine:** `vdot-inputs.ts` adds `(data->>'timeMoving')::numeric` to a COALESCE — and `timeMoving` is an `"mm:ss"` **string** on every watch row in prod ("64:19", "100:41"). The branch is unreachable today (verified: 0 rows for any user lack a numeric duration field) but **can never succeed — if it is ever reached, the whole VDOT input query throws**, every caller swallows the throw (`.catch(() => ({rows:[]}))`), and the system silently regresses to goal-anchored plans. The exact C1 bug class, re-armed by a fix.
3. **Half the fixes deploy on two different clocks.** Server/web changes go live on the next push; iPhone (`RaceClock` parser, palette) and watch (TempoFace delta, colors) ride a TestFlight build David must *install*. Until he does, race-morning iPhone still runs the broken goal parser. The watch race payload, by contrast, is server-built — it's fixed the moment the server deploys, no TF needed.
4. **Code fixes don't touch stored rows.** The active plan's race row still stores `pace_target_s_per_mi = 407` / band 397–412 / `fuel_mi [5,9,13]` (verified in prod). The landed watch-payload override patches the *watch*; web race-day hero parses the goal directly; but every plan surface reading the stored row (week strip, plan card, RaceView pacing) keeps saying **6:47** until a gated re-pace lands. Three batches, zero of which can fix a number that lives in a database row.
5. **The whole pile is uncommitted in a shared checkout** that other agents commit from — including an **untracked** new file (`lib/training/heat-model.ts`) that three *tracked, modified* files now import. Any concurrent agent committing `weather-adjust.ts` by path without the untracked file ships a build-breaking import to main. This is the 2026-06-08 commit-capture incident (`e2f8f615`) with a sharper edge.

Nothing in the landed set corrupts data. The risks are: a dated cliff nobody defused, a swallowed-throw landmine, two-clock surface divergence, stored-vs-code divergence, and landing-process hazard. All fixable this week; the dated items have hard deadlines (Aug 1, Aug 2, race week).

---

# PART 1 — WHAT IS ACTUALLY LANDING (the wave map)

Verified against `git diff` / `git status` at audit time (HEAD = `ce85abab` = `origin/main`).

## Wave 1 · LANDED-IN-TREE (uncommitted)

| Fix | Files | Verified behavior change |
|---|---|---|
| F2 parsers, web ×5 | `TodayView.tsx:4334-4344`, `TrainView.tsx:1379-1387`, `GapPanel.tsx:84-90`, `phase-focus.ts:75-81`, `RaceView.tsx:841-846`, `RaceRetrospectiveForm.tsx:15-23` | All goal-string parsing delegates to shared `parseRaceTime` (`vdot.ts:145-157`). `"1:30"` → 5400s everywhere. RaceView's old parser had the *opposite* bug (forced H:MM: "45:00" → 45 hours) — also fixed. |
| F2 parsers, iPhone ×3 | `API.swift` (+`RaceClock` enum), `RaceDayView.swift:495-560`, `TargetsView.swift:209-215` | One Swift parser mirroring the web heuristic. **TF-gated** — see R2. |
| F3+F16+F5 race payload | `lib/watch/build-workout.ts:499-570` | Race `expiresAt` → end-of-day+8h (corral-refusal closed); single-work-phase race target overridden to `round(goalSec/distanceMi)` = **412 (6:52)**, tolerance ≤±12; `goalSec` populated (goal-delta row alive); `gelsMi` from spec `fuel_mi` filtered to `[2, distance−2]` → AFC `[5,9]`, mile-13 gel dropped. Server-side — live on deploy, old watch builds decode the new fields as optionals (wire-compatible, `WatchWorkoutModels.swift:205-219`). |
| Heat unification | NEW `lib/training/heat-model.ts` (untracked), `weather-adjust.ts`, `heat-adjustment.ts`, `weather-adjust.test.ts` | One doctrine table (Research/06 §1 verbatim) + additive §12 dewpoint + duration scale, shared by `judgeWeather` and `applyHeatToPace`. Post-run slowdowns roughly halve; bands recalibrated 2/4/8; race-projection HM scale 0.5× → duration-scale ≈0.85×. |
| Start-hour forecast | `race-conditions.ts:44-150`, `seed.ts:2249-2300` | `computeRaceConditions` reads `races.meta->>'startTimeLocal'`, prices the start→finish window instead of daily max. `fetchDayForecast` 4-arg signature verified present (`openmeteo.ts:309-339`). **Inert until the start time is stored — it is null in prod** (see R8). |
| Fitness-loop gate | `vdot-inputs.ts:193-216` | Run-candidate duration gate `movingTimeS > 60` → `COALESCE(durationSec, movingTimeS, movingSec, timeMoving, elapsedTimeS) > 60`. +12 rows enter the 180d window (78→90, verified); 6 in the 60d window pass the HR gate (avgHr 148–156). All compute VDOT ≈ 40–41 → headline unchanged. **Carries the timeMoving landmine — R4.** |
| workoutType stamp | `app/api/ingest/workout/route.ts:115-165, 256-262` | HK-ingested runs stamped from the matched plan day (±30% distance guard, `race_week_tuneup`→`threshold`, `workoutTypeSource:'plan'`). **HK path only — watch completion route unstamped (R5).** |
| Tempo-drift rewrite | `goal-projection.ts:700-776` | Detector re-keyed to plan tempo days × `coach_intents` watch-completion **work-phase** pace (the honest number). Needs ≥3 sessions/21d; prod has 2 tonight (437s, 438s vs T-pace 429.6 → drift ~8 < 10 → won't fire). |
| Decoupling filter | `decoupling-trend.ts:61-95` | Two-layer steady-state exclusion: `workoutType` string **plus** plan-day join (covers all unstamped history, archived plans included). Series survives: 19 qualifying runs ≥6mi/60d (≥3 floor). Tempo contamination removed → WATCHING may clear (R11). |
| F9 anchor age | `types.ts:612-630`, `HealthView.tsx:633-657`, seed plumbing | `vdotAnchor` (date, distance, race name, ageDays, fresh/aging/stale tiers) + staleness line on Health. **Copy promises the wrong failure mode — R12.** |
| UI ten-color lock | `globals.css`, `constants.ts`, `Theme.swift`, `WatchTheme.swift`, `FaceKit.swift`, `TodayView.tsx`, `TrainView.tsx`, `RunDetailModal.tsx`, `TodayReadinessPanel.swift`, `RootTabView.swift` | Palette synced byte-for-byte; off-track ≠ race orange; DETRAINING ≠ LOADED; zone ladder unified; `--brand1/2` deleted **with consumers rewritten in the same diff** (no orphaned `var()` refs — verified). |
| TempoFace delta | `Faces.swift:206-256`, `ActiveWorkoutView.swift:468-489` | Row 2 = signed delta; target moves to top label. TF-gated. |
| Misc UI | `FaffApp.swift:200-214` (cold-start brandmark), `PostRunCheckinChips.tsx:277-287` ("GOAL MET", wire value `crushed_goal` unchanged — backend enum intact ✓), `checkin-reply-canned.ts`, `/races` copy CTAs | Cosmetic, safe. |
| **F4 readiness guard** *(landed late in the audit)* | `health-actions.ts:265-282, 568-615` | Post-filter: race week (≤7d) suppresses the fatigue class (`compound`, HRV/RHR streaks, `tsb_overreach`, all ACWR bands) and says so in a transparent low-priority note; race morning keeps only medical hard rules + leads with "Race day. Time to execute." New wire values `race_day`/`race_week` are safe — iPhone decodes `signal` as plain `String` (`ReadinessBriefSeed.swift:89`), no strict enum to break. **Scope note:** this is the suppression half of F4 only — the HRV median window and ingest clamps are NOT in the tree; the readiness *score* (the ring) can still print 38 PULL-BACK on race morning even while the actions say execute. Tolerable: both race-day takeovers demote the readiness panel anyway. |
| **Race pace at the source** *(landed late in the audit)* | `spec-builder.ts:160-165, 304-338` (race), `:347-385` (tune-up) | Race rows now target goal pace (band ±5), HM HR cap = LTHR (was 0.95× — would have alarmed the whole race), M+ = 0.92×, sub-HM = none; `race_week_tuneup` honors its prescription (4×1km @ race pace) instead of a hardcoded 2×0.5 @ T−5. **Gap: the new `goalPaceSPerMi` param has zero callers** (generate.ts untouched) — the inverse-offset fallback (`tPaceSec + 5` for HM) recovers goal pace exactly *only while T is goal-anchored* (true for plans built via `tPaceFromGoal`). The day a plan is authored or re-paced from *fitness* T, plan-row race pace (fitness-T+5) and watch-payload race pace (goal) diverge again. Thread the param in generate.ts — G8. |

## Wave 2 · DECLARED-NOT-LANDED (in batch scope, absent from the tree)

| Fix | Where it should land | Status / risk |
|---|---|---|
| **F1 anchor cliff** | `vdot.ts:259` or `goal-projection.ts` | **NOT in tree. Hard deadline Aug 1.** See R1. |
| **F6 cron dead zone** | `.github/workflows/notifications.yml:32-33` | NOT in tree — verified yml still `*/30 14-23` + `*/30 0-6` UTC. `keep-warm.yml:28-29` has the same hole (cold container at 5 AM PT). |
| F4 remainder: HRV median window + ingest clamps | `readiness.ts` HRV pillar, `ingest/health/route.ts:88-92` | NOT in tree — the suppression guard landed (see wave 1), but a 29ms-style garbage HRV sample still enters baselines and the displayed score unclamped (the 102ms outlier row is still in prod). |
| F7 TSB bootstrap + day-stress dedupe | `training-form.ts:143-178` | NOT in tree. When it lands later, TSB jumps −25 → ≈−15 overnight (iPhone formLine, web FORM tile) — needs an expected-change note. |
| F11 race-week strides/tune-up · F23 next-plan targeting · iPhone hero re-architecture · white sheet | various | Not in tree; product decisions, not regressions. |

## Wave 3 · STORED-DATA (no code path can fix these; gated writes pending David's go)

| Item | Stored today (verified in prod) | Consequence of not landing |
|---|---|---|
| Race row re-pace | `wko_907063f1305256b9`: `pace_target_s_per_mi=407`, spec band 397–412, `fuel_mi [5,9,13]`, `hr_cap_bpm 154` | Plan surfaces print 6:47 / band 6:37–6:52 through race week while watch+hero say 6:52 (R7) |
| Aug 4/6 tempo targets | both stored 419 (6:59, goal-anchored) | The C1 carry-forward; unfixed by all three batches |
| `goalDisplay` normalization | AFC `"1:30"`, B `"1:37"` — the only H:MM rows in the table | Optional once parsers deploy, but it is the **rollback insurance** (old TF builds + any future parser regression read "1:30:00" correctly) |
| AFC `startTimeLocal` | null (all start/wave/gun fields null on every race) | Start-hour forecast path stays inert → **Aug 2 phantom heat jump fires** (R8) |

---

# PART 2 — FINDINGS

Severity: 🔴 RACE-KILLER (taper/race-day breaks) · 🟠 MAJOR (wrong data or wrong decision) · 🟡 MINOR (inconsistency/friction).

## 🔴 R1 — The Aug 1 cliff is not in the landing set, and a landed UI line now mis-describes it

**The cascade, verified end-to-end in code:**
- `bestRecentVdot` cutoff is a hard window: `vdot.ts:259` (`today − 180d`). Disney (Feb 1) survives Jul 31, exits Aug 1. Next-best in-window A/B race = LA Marathon 44.1 (Mar 8 — 146d old on Aug 1, so *not* stale). Prod race table verified: Rose Bowl exits Jul 17 (invisible — Disney still wins), Sombrero is priority C, Big Sur `hilly-excluded`.
- The snapshot cron writes 44.1 → `detectVdotTrendDrift` (`goal-projection.ts:647-675`) compares last-7d vs ≥28d-ago: 44.1 < 47.9 − 1 → **STRONG** signal → status **off-track** → headline projection flips from goal-pinned 1:30:00 to `predictRaceTime(44.1, 13.1)` ≈ **1:41:55** (per the Item-15 doctrine: off-track is the one status that swaps the headline) → CI multiplier 1.5 (`goal-projection.ts:951`).
- The **±8% stale-band override can never fire**: `computeConfidenceInterval` checks `ageDays > 180` (`goal-projection.ts:924-936`) but the anchor it receives always just swapped to something ≤180d old — `STALE_DAYS` equals the lookback window, so the stale branch is dead code on the race path.
- **The newly-landed run candidates cannot rescue it:** the 6 qualifying watch runs compute VDOT ≈ 40–41 (whole-run pace + the −1 run penalty, `vdot.ts:297`) — below 44.1. The STATE report's hope that "the Aug 4/6 tempos re-anchor the math" is **false as wired**; `vdotFromRun` reads whole-run average (the F10 problem), so taper tempos read ~VDOT 40.
- Meanwhile the landed `HealthView.tsx:633-657` staleness line tells David: *"At 180 days the projection band widens to ±8%."* It will not widen. The number will lurch 7 minutes and the page will say OFF TRACK.

**When it bites:** Aug 1, sixteen days out, peak taper anxiety. **Probability: certain** absent F1 or a logged tune-up race.
**The implementation trap to avoid:** "freeze projection inside T−14" freezes from **Aug 2** — one day *after* the cliff; it would freeze 44.1. Any freeze must key on anchor-expiry (or freeze from ≥T−16), or use keep-best-until-replaced / decay semantics instead.

## 🔴 R2 — iPhone fixes are TF-gated; the phone is the only surface that can still detonate F2 on race morning

Server-built surfaces (watch payload via `/api/watch/today`, web) are fixed at deploy. The iPhone `RaceClock` parser, palette, and cold-start gate ride the next TestFlight build (`ship-testflight-v2.sh`, build ≥200) **and David must install it**. If race morning arrives on the current installed build, `RaceDayView` still parses "1:30" as 90s → splits "0:21", B-goal "8:30", fueling from a 90-second race — the original F2, alive only on the phone.
**Defuse twice:** (a) ship + install the TF build well before race week; (b) land migration M1 (normalize `goalDisplay` → "1:30:00") — the *stored-data* fix that makes even the broken parser produce 5400s. M1 is the only fix that protects an un-updated phone.

## 🔴 R3 — Race-morning crons still dead (F6 unlanded)

Verified tonight: `notifications.yml:32-33` and `keep-warm.yml:28-29` both skip 07:00–13:59 UTC = 00:00–06:59 PT. No wake notification can fire at 05:30 PT, and the first app open of race morning hits a cold Railway container. One line each. (Slack-vs-poll mismatch from the adversarial report also stands: `isAtLocalTime` slack 15min vs 30min polling, `notifications/route.ts:253-260`.)

## 🟠 R4 — The `timeMoving` cast in the landed vdot-inputs fix is a swallowed-throw landmine

`timeMoving` is an mm:ss **display string** on every watch/HK row (33 rows verified: "64:19", "100:41", "49:54"…). The in-flight gate and SELECT add `(sa.data->>'timeMoving')::numeric` as COALESCE branch 4 (`vdot-inputs.ts:196, 211-216`). Postgres COALESCE is lazy, and **every existing row (all users) carries numeric `durationSec` first** — verified `0` rows where the cast is reachable — so nothing throws today. But the branch is strictly harmful:
- It can never produce a value: any row that *needs* it (no numeric duration fields) throws `invalid input syntax for type numeric`.
- A throw inside `loadVdotInputs` doesn't crash anything visible — it's swallowed at every caller (`generate.ts:1896` `.catch(() => ({rows:[]}))`, `profile-state`, snapshot cron, simulator `?? 45`) and becomes **silently wrong plans / vanished VDOT**: the exact Item-13 #1/#2 failure class, re-armed.
- The fix's own comment mis-states the data: watch rows carry `durationSec` (numeric); `timeMoving` was never the missing field, it's the formatted twin (Jun 9: `durationSec 3859` = `timeMoving "64:19"`).

**Fix before commit (one line):** drop `timeMoving` from both COALESCEs, or guard the cast: `CASE WHEN sa.data->>'timeMoving' ~ '^[0-9.]+$' THEN (sa.data->>'timeMoving')::numeric END`. Add the unit test (G6).

## 🟠 R5 — workoutType stamping is source-asymmetric: HK path stamped, watch path not

`app/api/ingest/workout/route.ts:115-165` stamps; `app/api/watch/workouts/complete/route.ts` (the **primary** source — `data` built at `:190`) has zero workoutType logic (verified by grep). Result: canonical rows won by `watch` stay null; rows won by `apple_watch` (HK import) carry strings. Mitigations already in the tree are real — the decoupling filter's plan-day join covers unstamped rows, `vdotFromRun` falls back to the HR gate, the tempo-drift detector doesn't read the field at all — and the merge absorber copies losers' unique fields (`merge.ts:8`), so a stamped HK sibling heals a watch canonical within a day. But: watch-only runs (no HK sibling — they exist; May 27/29 pattern) never heal, and the field now has **three coexisting vintages** in prod (verified distribution: 92 null / 47 `'0'` / 2 `'1'`, soon + plan strings). Mirror the stamp into the watch route (same ±30% guard) or document the asymmetry where the field is defined; **confirm the absorber's field-copy whitelist includes `workoutType`**.

## 🟠 R6 — The heat unification silently re-grades history and recomposes the gap

Verified: **nothing stores a slowdown** — runs carry only the raw weather blob (`has_wc=false`, no `slowdownPct` key on any recent row; writer `openmeteo.ts:704-710`); every verdict consumer recomputes via `judgeWeather` on read. So the moment wave 1 deploys:
- Every historical warm-day verdict re-grades under the halved table (band thresholds 2/6/12 → 2/4/8): "ON"/"KEPT IT EASY"/"HEAT DRIFT" chips on *past* runs can flip with no provenance. Jun 8's run (78°F, old slowdown ~14.5%) re-reads at roughly half that.
- **Stored prose doesn't re-grade:** canned check-in replies already written to `coach_intents` were composed under the old table — an old run card can now show a re-graded chip contradicting its stored coach reply. Cosmetic but brand-relevant (honesty).
- The Targets **Conditions chunk grows ~63s → ~105s** (HM scale 0.5× → duration ≈0.85× at 65°F climate-normal; `applyHeatToPace`, `heat-adjustment.ts:44-56`), so Fitness-as-remainder shrinks ~40s in the GapPanel overnight. Correct per doctrine — but it will look like the app changed its mind about his race for no visible reason.

No code change needed; needs a **one-paragraph expected-changes note to David** at deploy (chips may flip on warm-day history; conditions cost rises; doctrine now matches Research/06).

## 🟠 R7 — Stored-row divergence: three race paces across surfaces until the gated re-pace

After wave 1 deploys: watch race face **6:52** (server override), web race-day hero **6:52** (parser), iPhone RaceDayView **6:52** (once TF installed) — but `plan_workouts` still stores **407** and band **397–412**, so the week strip, plan card, RaceView pacing block, and any `pace_target_s_per_mi` reader print **6:47** (band floor **6:37**) through race week. Seal/adapt never recompute stored paces (`seal.ts:31-33`, `adapt.ts:1164-1186` only mark-dirty on pr_bank/goal-change). The same applies to the Aug 4/6 tempos stored at 419. **This is M2 — the one fix only a gated DB write can land.** Until then the divergence is at least *conservative* (the stale surfaces show the faster pace only on the plan card, not on the wrist).

## 🟠 R8 — The Aug 2 phantom heat jump still fires: the start-hour fix is code-complete and data-dead

The landed forecast-window code (`race-conditions.ts:128-150`) only activates when `races.meta.startTimeLocal` exists. Verified: **null on every race**, including AFC — and the editable wave/gun chips already shipped (`13144c86`). On **Aug 2** AFC enters the 14-day forecast horizon and the conditions source flips from climate-normal (~65°F) to **forecast daily max** (~75–78°F): the Conditions chunk jumps ~+90s overnight *on top of* the R6 recomposition, mid-taper, for purely mechanical reasons. **Defuse: David enters the AFC start time (~6:53 AM per the race's published wave plan — any HH:MM near 7:00 works) before Aug 2.** One field, already UI-supported.

## 🟠 R9 — F4 guard landed (verified wire-safe) — but only the suppression half; the score itself is still unguarded

The race-week guard arrived in the tree mid-audit (`health-actions.ts:265-282, 568-615`) and is well-shaped: post-filter (one auditable suppression list), keeps medical hard rules + behavioral sleep advice, names what it filtered instead of going silently quiet, and leads race morning with an execute line. Wire-compat verified — iPhone decodes `signal` as `String` (`ReadinessBriefSeed.swift:89`), so the new `race_day`/`race_week` values can't break the readiness-brief decode. Two residuals: **(a)** the HRV median window and ingest clamps from F4's scope are *not* in the tree — `ingest/health/route.ts:88-92` is still `isFinite()`-only and the 102ms outlier row is still in prod — so a garbage overnight read can still crater the displayed **score** (the ring can print 38 PULL-BACK at 5 AM while the actions correctly say "execute"; tolerable because both race-day takeovers demote the readiness panel, but the contradiction is visible on the Health tab). **(b)** the guard keys on `state.nextARace?.days_to_race` — confirm that field is populated for B-priority races too, or a Run Malibu race week gets no guard.

## 🟠 R10a — CONFIRMED at audit close: the in-flight tree fails `tsc` (duplicated signal union not extended)

Not hypothetical — the pre-push typecheck hook caught it live while this report was being committed: the F4 guard extended `HealthAction['signal']` with `'race_day' | 'race_week'` in `health-actions.ts:58-62`, but the **duplicated copy of that union** in `components/faff-app/types.ts:507` (`ReadinessBriefSeed.actions[].signal`) was not extended → `seed.ts:2572` fails `TS2322`. Two consequences: (1) **wave 1 cannot deploy as-is** — Railway build fails the moment it's pushed; (2) every agent's push from this checkout is now blocked by the hook until the one-line union extension lands. The deeper lesson is the same shape as the F2 parsers: a type duplicated across layers got fixed in one place. Fix: add `'race_day' | 'race_week'` at `types.ts:507` — or better, import the signal type from `health-actions.ts` so the union can't fork again.

## 🟠 R10 — Landing-process hazard: an untracked import target in a shared checkout

`weather-adjust.ts` and `heat-adjustment.ts` (tracked, modified) now import `@/lib/training/heat-model` — an **untracked** file. Same shape for `parse-race-time.test.ts`. Any concurrent session committing those tracked files by path — or sweeping `-am` from another worktree state — ships `main` a module-not-found build break (Railway deploy fails). This is precisely the 2026-06-08 incident class (`e2f8f615`, see memory: shared-root commit capture). **Guard: wave-1 commit must be atomic and explicitly include the two untracked files; nobody else commits web-v2 paths until it lands.** Secondary: the pile is also un-backed-up work-at-risk (~600 lines across 37 files) — commit-to-branch beats holding it loose in the tree while review happens.

## 🟠 R11 — Landing the decoupling fix can flip WATCHING → ON-TRACK overnight (expected, but explain it)

The two-layer filter (landed) removes tempo contamination from the decoupling series; the series survives (19 qualifying steady runs ≥6mi/60d — well over the 3-point floor, verified in prod). If the contaminated points were what made the status WATCHING (the STATE audit's hypothesis), the day this deploys: WATCHING chip clears, CI narrows ±178s → ±142s, the Targets ladder moves a rung. A *confidence improvement from a data-hygiene fix* — fine, but it will read as "fitness improved overnight." Include in the deploy note; verify post-deploy which signal had been driving WATCHING (the drift-signal evidence rows on Targets name it).

## 🟡 R12 — F9 staleness copy describes the wrong cliff

`HealthView.tsx:639-647`: "At 180 days the projection band widens to ±8%." As shown in R1, the band cannot widen at 180d (anchor swaps instead; `STALE_DAYS` == lookback). If F1 lands as decay/keep-best, update this line to describe the real behavior; if F1 doesn't land, this line is actively misleading on Jul 31. One sentence.

## 🟡 R13 — durationSec-first finish_seconds biases run-VDOT low (safe direction, worth knowing)

`durationSec` on watch rows is total elapsed (pauses included) and sits first in the finish-time COALESCE (`vdot-inputs.ts:191-198`). Run-VDOT candidates therefore read slightly *slower* than true moving pace — conservative for a ratchet that only fires upward, and irrelevant while whole-run averaging (F10) dominates the dilution. No action; documents why the training-VDOT path can't rescue R1.

## 🟡 R14 — Detector arming timelines are sane

Tempo-drift: 2 of 3 required sessions tonight (work-phase 437/438 vs T-pace 429.6 → drift ~8 s/mi < 10) — won't false-fire when the 3rd lands Jun 11; goes *less* likely to fire post-cliff (T-pace from 44.1 is slower than observed). Decoupling: needs nothing. The detectors landing mid-taper do not create new WATCHING/OFF-TRACK pressure during race week. ✓

## 🟡 R15 — Misc verified-safe

- **gelsMi filter** drops the mile-13 gel (`[5,9]` survive the `≤ distance−2` filter) ✓; the stored spec still says `[5,9,13]` — any surface printing `fuel_mi` raw still shows 13 (plan card detail).
- **`crushed_goal` wire value** unchanged under the "GOAL MET" label — `/api/checkin` + canned-reply keys intact ✓.
- **Race expiresAt math** (`Date.parse(today+'T23:59:59Z')+8h`) covers race-day local for all real timezones (worst case UTC+12 still reaches 19:59 next-day local); direction-of-error is "too valid," never "refuses" ✓.
- **Race-day mode gates** key on `meta.date` string equality (web `TodayView.tsx:88`, iPhone `TodayView.swift:147-152`) — goalDisplay normalization can't touch them ✓.
- **Palette deletion** of `--brand1/2` rewrote all consumers in the same diff (no orphaned `var()`) ✓; cross-surface color divergence until the TF install is cosmetic and time-bounded.
- **Sick episodes** in prod are two cleared test rows (logged + cleared within seconds on May 29) — no adapt interaction during taper ✓.

---

# PART 3 — TAPER TIMELINE SIMULATION (with the tree as it stands)

Assumes wave 1 commits cleanly this week and nothing else lands. VDOT timeline computed from prod race/run data against `bestRecentVdot` semantics (180d window, run penalty −1).

| Date | Event | Surface effect |
|---|---|---|
| **Jun 10–Jul 12** | Wave 1 deploys; heat verdicts re-grade (R6); Conditions ~+105s; WATCHING may clear (R11); TF build ships F2-iPhone + palette + TempoFace | One-time visible shifts — send the expected-changes note |
| **Jul 13** | RACE-SPECIFIC block starts (59.5 mi wk) | — |
| **Jul 17** | Rose Bowl (45.8) exits the 180d window | Invisible (Disney still best) |
| **Jul 20** | "What if VDOT updates?" — it cannot: no race scheduled, runs cap at ~41 | Sparkline stays 47.9 (flat, honest about the wrong thing) |
| **Jul 26** | 19 mi long w/ 10 @ HM 6:52 (stored; goal-anchored, F8) — unaddressed by all batches | The make-or-break session; no bail-out rule on the watch |
| **Jul 31** | Disney's last day in-window. HealthView staleness line says the band will widen (R12) | Last day of 47.9 / 1:34:54 |
| **Aug 1** | **CLIFF (if F1 still unlanded):** anchor → LA 44.1 → snapshots 44.1 → within days `vdot_trend` STRONG → **OFF-TRACK** → headline 1:30 → **1:41:55**, CI ×1.5, GapPanel gap 4:54 → ~11:55 | The worst psychological event of the block, 16 days out — and the landed F9 line predicted a different failure |
| **Aug 2** | T−14. AFC enters the forecast horizon: **if `startTimeLocal` still null, Conditions jumps ~+90s** (daily-max read, R8). A naive T−14 projection freeze implemented later would freeze *post-cliff* values | Two independent dated jumps on consecutive days |
| **Aug 4/6** | Taper tempos @ stored 419 (goal-anchored). Verdicts graded under the new heat table; HK-sibling stamp labels them `tempo` | Detectors honest; paces still the C1 carry-forward (M2) |
| **Aug 9–15** | Race week. F4 guard landed → pull-back *advice* suppressed, taper-noise note shown; the *score* can still dip ugly on a bad HRV night (median window unlanded, R9a); F6 unlanded → no wake notification path; F11 not inserted → zero intensity all week | |
| **Aug 15** | Last sync. Race payload `expiresAt` now end-of-day+8h → corral refusal closed ✓ (server-side, no TF needed) | |
| **Aug 16, 5:00 AM** | Web hero: goal + pace correct ✓ (parsers). "Fitness reads **1:41:55**" if F1 unlanded ✗. GUN TIME "—" unless David filled the (now-editable) field ✗. WHAT TO DO leads with "Time to execute" ✓ (F4 landed) — though the ring can still print a scary score (R9a). iPhone correct **only if the TF build is installed** (R2) | |
| **Aug 16, 6:50 AM** | Watch: starts ✓ (F5), target **6:52** ✓ (F3), goal-delta row live ✓, gels at 5 & 9 ✓ (F16) | **The wrist is the one fully-defused surface** |
| **Post-race** | Result write → `race_graduate` → auto-plan targets next A/B *by date* = Run Malibu (B), not CIM (F23, unaddressed) | Post-race surprise; not race-critical |

**VDOT-update what-ifs the brief asked for:** Jul 20 — impossible upward (no race; runs ≤41); a hypothetical tune-up race result *would* re-anchor and also defuse Aug 1 (the adversarial report's "race something in early July" remains the best single non-code fix). Jul 31/Aug 1 — the cliff above. Aug 15 — a (hypothetical) huge taper-tempo PR still can't beat 44.1 from a whole-run average; nothing destabilizes race week from the run path. If a *positive* VDOT jump somehow landed (tune-up race logged), `adapt.ts:1164-1186` marks the next 14 days "[paces stale – recompute]" — during taper that flags race-week rows for manual acceptance, which is noisy but human-gated; acceptable.

**Concurrency (brief's question):** snapshot cron, dedupe cron, notifications cron, and the watch-payload builder touch disjoint rows; the workoutType stamp happens inside the ingest INSERT (no separate UPDATE), so no new Rule-6 writer was created (weather-enrichment full-replace was already fixed `b8ce2ea9`; HK re-ingest preserves `mergedIntoId` at `ingest/workout/route.ts:325-331` — Cluster 1b's guard verified present). The only true concurrency hazard found is the **human** one: R10.

---

# PART 4 — ROLLBACK SAFETY (per landed fix)

| Fix | Revert effect | Stranded data | Verdict |
|---|---|---|---|
| Heat model | Verdicts recompute under old table (nothing stored) | Canned replies authored under new table keep their prose | Clean; prose drift only |
| vdot-inputs gate | Watch rows drop back out of candidacy | None | Clean |
| workoutType stamp | New rows stop being stamped; old stamped rows keep strings (all readers handle); re-ingest (DELETE-INSERT) sheds the stamp | Stamped strings (harmless) | Clean |
| F3/F16/F5 payload | Next sync rebuilds payload under old code → watch target back to 6:45, gels dark, 14h expiry | None — but **revert silently re-arms three race-killers**; treat this file as revert-with-alarm | Clean mechanically, dangerous semantically |
| F2 web parsers | Broken parsing returns | None | Clean only if M1 (goalDisplay normalization) landed — M1 is the insurance |
| F2 iPhone | Requires shipping an older TF build (won't happen accidentally) | — | N/A |
| Palette / UI | Pure presentation | None | Clean |
| Start-hour forecast | Falls back to daily max | `startTimeLocal` (still useful) | Clean |
| Stored-row re-pace (M2, future) | Code revert does NOT restore 407 — needs the inverse UPDATE; keep it in the migration note | The re-paced rows (correct values — keep them) | Write the inverse statement alongside the forward one |

---

# PART 5 — WHAT'S ALREADY FRAGILE (pre-existing, the load the batches land on)

1. **The silent-swallow class (~241 sites)** is the amplifier that turns R4 from "exception in logs" into "wrong plan, no error." Until the four VDOT-path swallows are converted to throw/propagate (Overnight Item 13 #1–#4), every query-shape bug in this area fails invisibly.
2. **Cron monoculture**: one `CRON_SECRET`, GitHub Actions as sole scheduler, no dead-man alerting — and now *more* correctness (snapshots with anchors, push polling, dedupe healing) rides on it.
3. **The 8 load-bearing merge flags** (49.6 mi of double-count held by flag bytes outside the 14-day self-heal window) — any future full-replace writer to `runs.data` re-opens it; the stamp avoided this, the next writer might not. The daily flag-count alert (STATE 4.1) remains unbuilt.
4. **Seal/adapt never re-pace future rows** — the structural reason M2 must be a migration and why every spec-builder fix strands the active plan.
5. **Watch data-quality gaps at completion**: final-mile split missing on 3 of 5 recent runs, and the Jun 7 polyline-less long run (no GPS/weather enrichment path for watch rows without route) — if that mode recurs **on the AFC completion itself**, the race log is data-poor. Worth a watch-side look before race day (pre-existing; untouched by the batches).
6. **TSB MAX-per-day vs volume-reader divergence** and the −10 bootstrap artifact — both declared (F7/STATE 1.3), both unlanded; the form ring overstates fatigue a band until then.

---

# PART 6 — TASK LIST

## Guards (code, before/with the wave-1 commit)

- **G0 (blocking everyone · 1 line)** Extend the duplicated signal union at `components/faff-app/types.ts:507` with `'race_day' | 'race_week'` (or import the type from `health-actions.ts`). The tree fails `tsc` until this lands; the pre-push hook is blocking all pushes from this checkout. — R10a
- **G1 (with commit · 10 min)** Drop `timeMoving` from both COALESCEs in `vdot-inputs.ts` (or regex-guard the cast). It cannot help and can only throw. — R4
- **G2 (before Aug 1 · half day)** Land F1 with **anchor-expiry-aware** semantics (keep-best-until-replaced, or decay past 150d, or freeze keyed to expiry — *not* naive T−14). Add the Aug-1 dry-run test: run the snapshot path with `today='2026-08-01'` against prod data and assert no cliff. Update the R12 copy to match the chosen behavior. — R1
- **G3 (before race week · half day)** The F4 *remainder*: HRV median window for the readiness pillar + ingest clamps (HRV 10–200ms ± baseline-band, RHR 25–110) so the displayed score can't crater off one garbage sample. Also verify `nextARace.days_to_race` populates for B races (guard coverage). — R9
- **G4 (one line each)** `notifications.yml` + `keep-warm.yml`: add `*/30 7-13 * * *` (and widen `isAtLocalTime` slack ≥ polling interval). — R3
- **G5 (1 hour)** Mirror the workoutType stamp into `app/api/watch/workouts/complete/route.ts` (same ±30% guard); verify the merge absorber's field-copy includes `workoutType`. — R5
- **G6 (with commit)** Unit test: `loadVdotInputs` against a row with string `timeMoving` and no numeric duration → expect skip, not throw. Confirm `parse-race-time.test.ts` covers "1:30" / "1:30:00" / "45:00" / "0:45:00".
- **G7 (process, immediate)** Wave-1 commit is **atomic and explicitly includes** `lib/training/heat-model.ts` + `parse-race-time.test.ts` (untracked). No other agent commits `web-v2` paths until it lands. — R10
- **G8 (30 min)** Thread `goalPaceSPerMi` from `generate.ts` into `buildWorkoutSpec` (the param landed with zero callers). Without it, the first fitness-anchored re-pace re-splits race pace across surfaces: plan row = fitness-T+5, watch payload = goal. — wave-1 spec-builder note

## Migrations / data writes (gated — each needs David's explicit go)

- **M1** `UPDATE races SET meta = jsonb_set(meta,'{goalDisplay}','"1:30:00"') WHERE slug='americas-finest-city'` (+ same for `goalSafeDisplay` → `"1:37:00"`). Rollback insurance for un-updated phones; harmless after parsers. — R2
- **M2** In-place re-pace of stored rows (race 407→412 + band 402–417 to match the landed payload override; decide Aug 4/6 tempo 419 and the easy bands at the same time). Write the inverse UPDATEs alongside. — R7
- **M3** David enters AFC `startTimeLocal` via the shipped race-detail chips **before Aug 2**. — R8
- **M4** (decision) F11 race-week strides/tune-up row inserts.
- **M5** (optional) Backfill `workoutType` for the last 60d from the plan-day join, so detectors read labeled history sooner — or accept the join fallbacks as sufficient.

## Testing / verification

- **T1** Full `tsc` + `vitest` on the combined tree before commit (the heat tests are already rewritten to the new doctrine; the suite must pass as a set).
- **T2** Post-deploy probes: `/api/watch/today` race payload carries `goalSec`/`gelsMi`/end-of-day expiry and target 412; snapshot cron still writes 47.9 + anchor cols; Targets shows Conditions ~+105s; note which drift signal (if any) holds WATCHING.
- **T3** TF build installed on David's phone **before Aug 9**; verify RaceDayView splits render against live AFC meta ("1:30" → 6:52/mi, B 1:37) and the cold-start brandmark.
- **T4** Expected-changes note to David at deploy: warm-day verdict chips may flip on history, Conditions cost rises ~40s, WATCHING may clear, TSB will shift later when F7 lands. — R6/R11/R18

## Deadline summary

| Date | Must be true by then |
|---|---|
| **This week** | G1+G6+G7 with the wave-1 commit; T1 green; M1 |
| **Before Aug 1** | G2 (the cliff) — the one hard code deadline |
| **Before Aug 2** | M3 (start time) — the one hard data deadline |
| **Before Aug 9** | G3, G4, M2, T3 (TF installed) |

---

*RO diagnostic scripts for every prod number in this report: `web-v2/scripts/_regression_audit_ro.mjs`, `_regression_audit_ro2.mjs`. Audited against working tree at `main` ce85abab + uncommitted diff, prod DB 2026-06-09 ~23:00 UTC. The tree was actively changing during the audit; re-verify the wave map against `git status` before acting on it.*
