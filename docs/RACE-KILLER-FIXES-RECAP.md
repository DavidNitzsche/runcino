# RACE-KILLER FIXES — CONSOLIDATED RECAP (awaiting GO)

_Session 2026-06-09. All five race-killers from the adversarial audit implemented + verified. **Nothing committed, nothing merged, no DB writes** — working-tree diffs only, per the task flow. Companion to `docs/ADVERSARIAL-AUDIT-REPORT.md` and `Briefs to Claude/ADVERSARIAL-RACE-KILLER-TASK.md`._

## Verification gates

| Gate | Result |
|---|---|
| `tsc --noEmit` (web-v2) | **0 errors** |
| `vitest run` (web-v2, full suite) | **446 passed** (20 files; includes 26 new tests in 4 new files) |
| `xcodebuild` Faff scheme (iPhone + watch ride-along) | **BUILD SUCCEEDED** |
| Aug 16 payload smoke vs **prod data** (read-only, real `buildWatchToday`) | course-phase race plan, goal armed, gels armed — output below |

## Footprint

20 modified files (+489/−98) + 4 new test files + 1 new lib (`lib/race/pacing.ts`) + 1 smoke script. Also carries F2 hunks inside `web-v2/components/faff-app/views/TodayView.tsx` and `TrainView.tsx` — **both files hold another session's uncommitted WIP**, so staging must be hunk-level (`git add -p`) or coordinated.

---

## F2 — One race-clock parser everywhere (was: "1:30" = 90 seconds)

**Before:** seven private parsers each decided what "1:30" means. The two race-day surfaces (web `RaceDayHero`, iPhone `RaceDayView`) read it as 90 seconds → race morning would have rendered 5K split "0:21", B-goal "8:30", goal pace "0:07/mi". TrainView's tempo "why" copy was live-bugged daily; RaceView's goal editor inverted the bug ("45:00" 10K goal → 45 hours).

**After:** every goal/finish string flows through `parseRaceTime` (web) / `RaceClock.seconds` (iPhone, exact mirror in `API.swift`).
- Web: `TodayView.tsx` (parseHMSToSec → delegate), `TrainView.tsx` (inline parse → shared), `GapPanel.tsx` + `lib/faff/phase-focus.ts` (parseClockToSec → shared), `RaceView.tsx` (parseHMS → shared, fixes the 45-hour normalize), `RaceRetrospectiveForm.tsx` (typed finish times).
- iPhone: `RaceDayView.swift` `parsedGoalSec` + `goalPace`, `TargetsView.swift` `goalSeconds` → `RaceClock`.
- Already-correct paths confirmed untouched: `raceDetail.ts` (RaceView splits/B-goal — used the shared parser all along), watch `build-workout` goal parse.

**Tests** (`lib/training/parse-race-time.test.ts`, 7): `"1:30"→5400`, `"1:30:00"→5400`, `"90:00"→5400` (all three ways of writing ninety minutes converge), `"1:30:30"→5430`, `"23:15"→1395`, `"45:00"→2700`, malformed → null. Plus the literal race-morning derivations: pace 412 (6:52/mi), B-goal 5820 (1:37:00), 5K ≈ 21:21.

---

## F3 + F16 — The race payload races (was: 6:45 flat target, dead goal-delta/gels)

**Before (smoked against prod):** one phase "Race effort" @ **6:45/mi ±12** (spec band midpoint — 7 s/mi faster than goal, ~29 s/mi faster than fitness), `goalSec`/`gelsMi` never sent (watch goal-delta row and gel alerts ran empty), spec wanted a gel at **mile 13.0 of 13.1**, payload expired 14h after last phone sync (corral-refusal hole, F5).

**After (same smoke, same prod data, real code path):**

```
name=RACE isRace=true dist=13.1 estMin=90
goalSec=5400 (90min)  gelsMi=[5,9]
expiresAt=2026-08-17T07:59:59Z (valid the whole race day)
  Point Loma Climb   2.0mi  target 7:01/mi ±12
  The Drop           2.5mi  target 6:35/mi ±12   (descent credit capped 15 s/mi)
  Mission Bay        5.4mi  target 6:51/mi ±12
  Harbor Approach    1.0mi  target 6:53/mi ±12
  Balboa Finish      2.2mi  target 7:05/mi ±12   (the sting priced in)
phase-sum 1:29:57 ≈ goal 1:30:00
```

**How:** `build-workout.ts` race block now (1) loads **the plan's own race** (`plan.race_id`, not "next A race" — wrong goal on a B-race day), (2) expands the race into one work phase per course phase via the new `lib/race/pacing.ts` (grade model: +3.3% cost per 1% grade, cite `Research/11`; descent credit capped at 15 s/mi, cite the AFC course doctrine itself; normalized so the total is exactly the goal), (3) falls back to a single phase at flat **goal pace** when no usable course profile, (4) sends `goalSec` + `gelsMi` (spec `fuel_mi` filtered to ≤ distance−2), (5) **race payloads expire end-of-race-day + 8h** instead of +14h — closes F5's corral refusal (`WorkoutRootView.swift:51` guard now can't fire on a same-day sync). **Zero watch-code changes** — LiveRaceFace per-phase targets, goal-delta (`WorkoutEngine.swift:297`), and gel cues (`:764`) were already built and light up from the data.
- iPhone RaceDayView splits card + web RaceView splits (`raceDetail.ts`) now prefer the same course-aware splits (`/api/race/[slug]` serves `pacing`; `Models/Races.swift` decodes it; linear fallback preserved). Bonus: the iPhone fueling card's `gelsMi` source is real now.

**Tests** (`lib/race/pacing.test.ts`, 8): real AFC geometry fixture — finish lands exactly on goal, climb/drop/Balboa shaped correctly, 10K split ~20s ahead of linear (banked descent), 30K/40K rungs filtered on a half, linear fallback on missing/gappy/short phase coverage.

**Honest residuals:** (a) the watch goal-delta projects linearly, so it reads slightly "behind" on the opening climb even on-plan — the per-phase pace row tells the right story; (b) if the phone never syncs at all on race day the watch still has no race payload — the expiry fix removes the *refusal*, not the need for one sync after local midnight.

---

## F4 — Race-week readiness guard + HRV median (was: pull-back advice possible at 5 AM Aug 16)

**Before:** `health-actions.ts` had zero race-proximity awareness — production fired score-38 PULL-BACK + prescriptions off a single 29 ms partial-night HRV read on Jun 8 (corrected to 46 ms by re-sync). Worse, the glance fast-path fed `computeReadiness` a **single-day** HRV while the brief path used a 7-day **mean** (outlier still moves it; yesterday a 102 ms sample landed unbounded).

**After:**
- `buildHealthActions`: inside T−7..T−0, the fatigue class (`compound`, HRV/RHR streaks, `tsb_overreach`, all ACWR bands, `hrv_cv_destabilizing`) is suppressed and a named taper-noise note shows in its place (cite `Research/08 §9` "taper crud … resist the urge"); **race morning returns "Race day. Time to execute — the work is done."** with only medical hard rules (illness / flare / wrist temp) allowed through — flu at 5 AM still outranks the pep line. Sleep advice (behavioral) stays through race week.
- HRV/RHR `current` = **median** of the window (7d HRV / 3d RHR) in *both* loaders, windows now identical between brief and glance. Jun 8 replay with prod values: median of the last 7 = **54 ms vs 56 baseline → pillar ≈ −1, not −18; score ≈ moderate, not 38 PULL-BACK.**

**Tests** (`lib/coach/health-actions.race-week.test.ts`, 5): every fatigue trigger armed at once → fires at T−20, suppressed-with-note at T−3, execute-only at T−0, illness retained at T−0, no-race behavior unchanged.

---

## F1 — Stale-anchor fade (was: VDOT cliffs 47.9 → 44.1 on Aug 1)

**Before:** hard 180-day window. Disney (Feb 1) exits Aug 1 → VDOT 44.1 (LA Marathon) → projection **1:34:54 → 1:41:55 overnight**, T−15, race-day hero reading "+11:55."

**After (Choice A, decay):** `bestRecentVdot` keeps full value through the 180-day window, then fades **0.1 VDOT per 14 days for up to 120 more days** before the anchor drops out. Estimator smoothing of the same staleness judgment the hard window encoded — not physiology; fresh evidence (race or qualifying run) still takes over the instant it scores higher. Candidates now carry `vdot_raw` + `age_days`.
- **Today's display is untouched** (Disney at 128d is inside the window → still 47.9).
- New timeline: Aug 1 → **47.9** (no cliff) · race morning → **47.8**, projection ≈ **1:35:0x** (was 1:41:55) · Disney finally exits in mid-December, by which time the AFC result anchors.
- **Provenance display (F9 folded in):** profile-state now serves `vdot_anchor_age_days` + resolved `vdot_anchor_name` (iPhone-ready), and the Targets GapPanel VDOT strip gains an anchor pill — "anchor **Disney Half Marathon · 128d · stale**" (amber ≥120d, tooltip suggests a tune-up race). Rides the same `seed.health.vdotAnchor` envelope the state-audit session's Health-page warning already uses; snapshot anchor columns started populating Jun 9.

**Tests** (`lib/training/vdot-anchor-fade.test.ts`, 6, real race history): full value today, no Aug 1 cliff, 47.8/≈1:35 on race morning, fade tail expiry (Disney gone by Dec 18 → LA anchors), a hypothetical Jul 11 tune-up 10K immediately outranks the faded anchor, pre-fade behavior bit-identical for fresh anchors.

---

## F6 — The notification dead zone (was: race-day wake notification mathematically unreachable)

**Before:** `notifications.yml` had zero ticks 07:00–13:59 UTC = **00:00–06:59 Pacific**; the 05:30 wake notification needed a tick at 12:30 UTC. Also `isAtLocalTime` slack was 15 min against a 30-min polling cadence — second-half targets silently skipped even inside the window.

**After:** `*/30 7-13 * * *` added (full 24h coverage — also fixes early-morning sends for any non-Pacific runner); slack widened 15 → 25 min (covers the 30-min cadence + GitHub's habitual delay; `enqueueIfFresh`'s 24h dedup makes double-matches no-ops). Companion: `keep-warm.yml` gets hourly overnight ticks so the 5 AM race-morning app open doesn't hit a cold container.

---

## Aug 16, re-walked with these diffs

**5:00 AM** — wake notification *can* fire at 05:30 (F6). App opens warm-ish (keep-warm). Readiness panel says **"Race day. Time to execute — the work is done."** no matter what last night's HRV did (F4). Web hero: GOAL 1:30 · **6:52/mi** · B·SAFE **1:37:00** (F2), projection line reads ≈1:35 anchored "Disney Half · 196d · stale" — not 1:41:55 (F1). iPhone RaceDayView: splits 5K ~21:30 / 10K ~42:20 shaped to the course, not 0:21/0:43 (F2+F3).
**6:50 AM, corral** — one app-open any time after midnight gave the watch a payload valid all day (F5-via-F3). Watch shows RACE; start works.
**7:00 AM, gun** — LiveRaceFace: phase target 7:01 on the Point Loma climb, 6:35 cap on The Drop, 6:51 through Mission Bay, goal-delta live against 5400s, gel haptics at miles 5 and 9, Balboa priced at 7:05.
**Residual risks, named:** phone dead since Saturday → no payload at all (sync-after-midnight still required); goal-delta reads conservative early; `gun_time` is still "—" until Phase 2's F14.

## What needs David (the GO list)

1. **GO to commit + merge + deploy** the above (I stage `TodayView.tsx`/`TrainView.tsx` hunk-level to avoid sweeping the other session's WIP; then push, merge to main, watch Railway, smoke prod).
2. **TestFlight build** after merge — the iPhone/watch changes (RaceClock, RaceDayView, Races.swift decode) ride the next build (counter at 200).
3. **Optional, recommended, needs explicit per-statement GO (DB write):** normalize the legacy goal string so the data matches the parsers:
   `UPDATE races SET meta = meta || jsonb_build_object('goalDisplay','1:30:00') WHERE slug='americas-finest-city' AND user_uuid='0645f40c-…';`
   (Code no longer needs it — defense in depth only.)
4. **Post-deploy eyeball:** Targets page anchor pill + race-week GapPanel state (I skipped the live preview — booting the dev server runs mount-time writes against prod RW credentials, which the constraints forbid without GO).
5. **Decision noted, reversible:** F1 ships as Choice A (decay). Choice B (snapshot freeze T−14) is a ~20-line swap if you prefer a hard lock; my recommendation stays A (works year-round, all runners, CIM included).

**Phase 2 queue (post-GO, same week):** F11 race-week strides + Aug 13 HMP touch (plan edit — gated write), F14 gun-time editable + race-week nag, F7 TSB bootstrap seed, F9 anchor age on the iPhone Targets card, plus: send `fueling` envelope for long runs, surface `strategyLabel`, web RaceDayHero anchor line.
