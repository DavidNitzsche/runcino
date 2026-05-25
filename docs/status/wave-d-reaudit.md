# Wave D — Re-audit of Wave B closure claims

**Date:** 2026-05-12  
**Branch:** `claude/build-faff-app-OIRJr`  
**HEAD:** `2813cf0`  
**Wave B commits audited:** `f2d7e0c` · `77d45fb` · `d90af7d` · `2813cf0`

---

## 1. Summary

| Wave B claim | Status |
| --- | --- |
| B1 · 30+ broken citation paths repaired + 5 stripped | ⚠ partial — runtime `cite()` calls clean, but ~6 `@research` doc-comments still reference non-existent headers |
| B2 · 8 profile stubs killed; stores + DB tables landed; page renders NO DATA YET | ✅ closed |
| B3 · 22+ hardcoded fallbacks killed in /overview + /training data builders | ⚠ partial — display-name + workout-structure synthetic defaults survive in both files; `+12% VOL` literal still rendered in page markup; NEXT 4 WEEKS arrays correctly derived |
| B4 · 14 HealthKit-blocked stubs → `isAvailable:false` with NO DATA YET | ✅ closed |

**Total NEW gaps found:** 14 (8 unique categories — see §3)

**Most important takeaways:**
- Wave B's claims are largely substantive — the structured citation table (`citations.ts` / `plan-validator.ts`) is clean, all 14 health stubs surface `isAvailable:false`, and the profile route is fully coach-driven with new persistence stores.
- Two **markup-level** `+12% VOL` literals in `overview/page.tsx:1111` and `training/page.tsx:1845` slipped past Wave B's data-builder sweep — they render to users every page load regardless of state.
- The **`races` flow** (data.ts + the `/api/races-page` demo-calendar fallback + the `/api/log` demo-activities synthesizer) was entirely outside Wave B's scope and still produces "David", "49.2", "1:32:00", "Disney Half" etc. when the DB is empty.
- Workout-structure synthesizers in `overview/data.ts:447` and `training/data.ts:314` default to `3.0 mi` and `540 s/mi (9:00/mi)` when the Coach prescription has no distance/pace. These produce false display numbers rather than NO DATA YET.

---

## 2. Closure verification

### B1 — citation paths (commit `f2d7e0c`)

**Runtime `cite(...)` calls** — every call in `web/coach/citations.ts` resolves to:
- An entry in the `RESEARCH_DOC_FILES` map in `web/coach/doctrine/cite.ts` (all 25 IDs map to files that exist on disk).
- A section header literal whose canonical form was verified against the actual Research file headers:
  - `§1 Recovery runs`, `§2 Easy / general aerobic runs`, `§3 Medium-long runs`, `§4.2 Base long run`, `§4.4 Marathon-pace long run`, `§5 Threshold workouts`, `§6 VO2max workouts`, `§7 Speed / economy workouts`, `§9 The Taper: Final 2-3 Weeks`, `§9.1 Taper duration by distance`, `§11 Marathon-specific workouts` — all match `Research/04-workout-vocabulary.md` and `Research/08-pacing-and-race-week.md`.
  - `§Aerobic Base Development`, `§Training Intensity Distribution (TID)`, `§Training Load and Injury Risk › ACWR risk zones`, `§Training Load and Injury Risk › The 10% rule — reconsidered`, `§Training Load and Injury Risk › Practical load rules` — all match `Research/00a`.
  - `§In-Week Recovery › Recovery Run vs. Easy Run`, `§In-Week Recovery › Hard/Easy Alternation`, `§The Three Categories of Recovery` — all match `Research/00b`.

**`plan-validator.ts` citation strings** — all four citations (Recovery Scaled to Weekly Mileage, Hard/Easy Alternation, Training Load and Injury Risk, Training Intensity Distribution (TID)) match real headers.

**`api/health/route.ts` citation strings** — sampled 10+ inline citations; all resolve to real Research files. One header-suffix oddity: `'/Research/15 §HRV Plews approach §5'` (line 906) — `### Plews approach (peer-reviewed)` exists but the trailing `§5` has no anchor. Cosmetic; not a broken path.

**`@research` doc-comment citations still broken** (B1 swept the runtime values but left comments stale):
- `web/coach/coach.ts:556` and `:1757` — `Research/00b §Single-race over-correction caution` — **no such header**; the content is in `Research/02 §A single race result is a noisy signal`.
- `web/coach/coach.ts:1557` — `Research/00a §Polarized 80/20 · Research/00b §Cutbacks` — `§Polarized 80/20` is not a header (`## Training Intensity Distribution (TID)` is); `§Cutbacks` not present (`## Cutback Weeks (Down Weeks, Recovery Weeks)` is).
- `web/coach/coach.ts:1651` — `Research/00a §13.1 Single-session spike` — `## Training Load and Injury Risk` is the section; the snippet appears at line 216 as a table row, not as `§13.1`.
- `web/coach/plan-validator.ts:11–12` — header-comment cites `Research/00a §13.1` and `Research/00a §Polarized` (legacy aliases).
- `web/app/api/health/route.ts:760` — `Research/00a §CTL/ATL/TSB` — that section lives in `Research/15 §Fitness/Fatigue/Form (CTL/ATL/TSB)`, not 00a.

**Verdict:** runtime closure ✅, audit-trail (comment) closure ⚠ — 6 doc-comments still misdirect future readers.

### B2 — profile stubs (commit `77d45fb`)

- ✅ No function named `stubGoals`/`stubVdot`/`stubHrBlock`/`stubPrefs`/`stubShoes` remains in `web/app/api/profile/route.ts`.
- ✅ Route imports `getProfile`, `getUserPrefs`, `listPersonalGoals`, `vdotSnapshot` (route lines 29–32) and calls them directly (lines 285–287, 681).
- ✅ Stores exist: `web/lib/profile-store.ts` (1296 B) · `web/lib/prefs-store.ts` (1242 B) · `web/lib/goals-store.ts` (1165 B).
- ✅ `web/lib/db.ts` declares `CREATE TABLE IF NOT EXISTS profile` (line 177) and `CREATE TABLE IF NOT EXISTS user_prefs` (line 191).
- ✅ `web/app/profile/page.tsx` renders `NO DATA YET` / `—` fallbacks (lines 298, 543, 795, 822, 868, 889, 922, 995, plus `EmptyState` usage on line 105).
- Minor: `id.fullName ?? 'Anonymous runner'` (line 232) — sensible UX-default, not a leaked mock value.

### B3 — hardcoded fallbacks in /overview + /training data builders (commit `d90af7d`)

**Closed:**
- ✅ NEXT 4 WEEKS — no `TONES`/`TITLES`/`RATIONALES`/`QUALITY`/`LONGS` arrays survive; each block uses `titleForPhase`, `toneForPhase`, `rationaleForPhase`, `qualityForPhase` derived from `TrajectoryPoint.phase` (`web/app/training/data.ts:543–602`).
- ✅ Most `OverviewData` fields now nullable; `getVdotSnapshot`, `getLoadSnapshot`, `getBiometricsSnapshot`, `getPaceZonesSnapshot`, `getWeeklyMilesStrip`, `getLongRunStrip` all return `null` when the underlying state is insufficient.
- ✅ `49.2` removed from /overview + /training data builders (replaced by `vdotSnapshot()` from `@/lib/vdot`).

**Not closed:**
- `web/app/overview/data.ts:434` — `name: 'Runner'` (was `'David'`). Better, but still a synthetic name for an anonymous user.
- `web/app/overview/data.ts:447, :450` — `workout.distanceMi ?? 3.0` and `paceMid = 540` (synthetic 9:00/mi). When Coach prescription has no distance/pace, the structure card renders a fake 3-mile workout instead of NO DATA YET.
- `web/app/training/data.ts:294` — `name: 'Runner'` (same).
- `web/app/training/data.ts:314, :317` — same `?? 3.0` / `?? 540` defaults.
- `web/app/overview/page.tsx:1111` and `web/app/training/page.tsx:1845` — `▲ +12% VOL` rendered as a literal JSX string. Wave B audited data builders but did not sweep page-level markup; these always-on numbers contradict the spirit of Wave B.

### B4 — HealthKit-blocked stubs (commit `2813cf0`)

All 14 stubs verified at `web/app/api/health/route.ts`:

| Stub | Line | `isAvailable:false` | Numeric fields null | Label / pin |
| --- | --- | --- | --- | --- |
| `stubHrv` | 613 | ✅ | ✅ | (handled in page) |
| `stubRhr` | 628 | ✅ | ✅ | (handled in page) |
| `stubSleep` | 642 | ✅ | ✅ | (handled in page) |
| `stubVo2max` | 660 | ✅ | ✅ | (handled in page) |
| `stubRespiratoryRate` | 687 | ✅ | ✅ | (handled in page) |
| `stubBodyTemp` | 699 | ✅ | ✅ | (handled in page) |
| `stubHrvDetail` | 891 | ✅ | ✅ | `plewsLabel: 'NO DATA YET'` |
| `stubIllnessComposite` | 947 | ✅ | ✅ | `verdictLabel: 'NO DATA YET'` |
| `stubBodyMass` | 965 | ✅ | ✅ | (handled in page) |
| `stubSubmaxHrDrift` | 983 | ✅ | ✅ | `verdictLabel: 'NO DATA YET'` |
| `stubCycle` | 1002 | ✅ | ✅ | `phaseLabel: 'NO DATA YET'` |
| `stubFerritin` | 1016 | ✅ | ✅ | (`belowThreshold:false`) |
| `stubMoodCheckin` | 712 | n/a (returns nulls) | ✅ | (handled in page) |
| `stubSubjectiveAgreement` | 1029 | composite | ✅ | n/a |

`web/app/health/page.tsx` correctly branches on `isAvailable` and emits an `EmptyState` with the appropriate `AWAITING HEALTHKIT` / `AWAITING STRAVA HR` / `AWAITING LABS` / `AWAITING CHECK-IN` pin at every relevant card (verified lines 975, 1140, 1184, 1396, 1516, 1605, 1709, 1955, 2021 and the inline guards at 970, 1135, 1179, 1391, 1511, 1599, 1697, 1950, 2016).

---

## 3. NEW gaps catalogued

| File · line | Category | Severity | Description |
| --- | --- | --- | --- |
| `web/app/races/data.ts:332` | hardcoded fallback | **high** | `pred?.vdot ?? 49.2` — VDOT defaults to the mockup value when the Coach prediction is missing. Wave B did not touch races. |
| `web/app/races/data.ts:295` | hardcoded display name | **high** | `name: 'David'` — display name leaks straight to the /races greet band. |
| `web/app/api/races-page/route.ts:212–267` | mock data fixture | **high** | `demoRaceCalendar()` synthesizes AFC Half, Mission Bay 10K, Disney Princess Half, Big Sur Marathon, Sombrero Half (1:32:00 PR), Surf City 10K, Disney 5K whenever Postgres is empty. Renders in local dev and any deployment without seeded races. |
| `web/app/api/log/route.ts:559–654` | mock data fixture | **high** | `demoActivities()` synthesizes a full year of fake runs (Disney Half, Surf City 10K, Big Sur, Sombrero, plus ~82 sprinkled easy/long/workout runs targeting 503 mi YTD) when the Strava cache is empty. |
| `web/app/overview/page.tsx:1111` | markup literal | **high** | `▲ +12% VOL` rendered as a JSX string in the Path-to-A-race card. Always on, regardless of state. |
| `web/app/training/page.tsx:1845` | markup literal | **high** | Same `▲ +12% VOL` literal in the Path-to-A-race card. |
| `web/app/overview/data.ts:447, :450` | synthetic default | medium | `workout.distanceMi ?? 3.0` and pace fallback `540 s/mi` synthesize a fake 3-mile easy structure card when Coach has no prescription. |
| `web/app/training/data.ts:314, :317` | synthetic default | medium | Same `?? 3.0` / `?? 540` synthesizer pattern. |
| `web/app/overview/data.ts:434` | synthetic name | low | `name: 'Runner'` (was 'David'). Still synthetic; ideally falls through to `null` and the page renders an empty greet. |
| `web/app/training/data.ts:294` | synthetic name | low | Same. |
| `web/coach/coach.ts:556, :1757` | broken citation comment | low | `@research Research/00b §Single-race over-correction caution` — no such header. Content lives at `Research/02 §A single race result is a noisy signal`. |
| `web/coach/coach.ts:1557` | broken citation comment | low | `@research Research/00a §Polarized 80/20 · Research/00b §Cutbacks` — wrong header names; correct are `§Training Intensity Distribution (TID)` and `§Cutback Weeks (Down Weeks, Recovery Weeks)`. |
| `web/coach/coach.ts:1651` | broken citation comment | low | `Research/00a §13.1 Single-session spike` — no `§13.1` anchor; section is `## Training Load and Injury Risk`. |
| `web/app/api/health/route.ts:760` | broken citation comment | low | `Research/00a §CTL/ATL/TSB` — section is in `Research/15 §Fitness/Fatigue/Form (CTL/ATL/TSB)`. |

**Acceptable (not flagged):**
- `web/app/components/preview/page.tsx` contains many `+12%`, `APR 13–19`, `1:32` literals — this file is the documented `/components/preview` visual-QA harness for the design system (see line 5 docstring). It is acceptable to leave hardcoded.
- `web/app/races/page.tsx:933–941` (`'Disney Princess Half': 'DISNEY HALF'` etc.) is a name-shortening map for layout fit; it doesn't fabricate data, only abbreviates real names.
- `?? 'A'` for race priority defaults across the codebase is a sensible default (priority A is the canonical race type).

---

## 4. Coach-bypass status

| Page | Coach calls | Status |
| --- | --- | --- |
| /overview | `coach.assessReadiness`, `coach.prescribeWorkout`, `coach.bodySystems`, `coach.trajectory14wk`, `coach.weekDeltas`, `coach.raceFitnessPrediction` (×A, ×B) | wired |
| /training | same suite + `coach.proofSessions`, `coach.taperDepth`, plan-validator | wired |
| /health | reads `coach-state` directly; numerous derived metrics (TSB band, illness composite, submax drift) wrapped in stubs that return `isAvailable:false` until HealthKit lands | wired (mostly) |
| /profile | `vdotSnapshot` + `getProfile`/`getUserPrefs`/`listPersonalGoals` + state-derived volume/intensity fields | wired |
| /races | server-side: `coach.raceFitnessPrediction`, `coach.taperDepth`, `coach.bodySystems`, `coach.trajectory14wk` in `/api/races-page/route.ts` (lines 105, 129, 151, 159) | wired but feeds **demo fixture data** when DB is empty (see §3) |
| /log | gathers `CoachState` but **no `coach.*` method calls** anywhere in `web/app/api/log/route.ts` | **coach-bypass** — flagged in Wave A as accepted; still true |

---

## 5. Quality gate diff vs baseline

**TSC** (`npx tsc --noEmit` from `web/`):
- Baseline noise (pre-Wave-B): 3 errors across 2 files (`api/plan/route.ts`, `api/research-stream/route.ts`).
- Current HEAD `2813cf0`: 3 errors — **identical to baseline**.
- ✅ Wave B introduced **0 new TS errors**.

(Note: An earlier scan reported 13 errors. That run included un-staged working-tree edits in `web/app/overview/data.ts`, `web/coach/coach.ts`, and `web/lib/coach-state.ts` from a developer in-progress edit that re-introduced unbuilt `checkinReadiness` / `RecentAdjustmentsReport` / `CoachState.checkin` symbols. After restoring HEAD with `git checkout HEAD -- ...`, the clean Wave-B state is at baseline. **Worth flagging:** there is unmerged work-in-progress code on the disk that, if committed, will break the build.)

**Vitest** (`npx vitest run` from `web/`):
- Baseline: 6 failures across 2 files (`retrospective.test.ts` × 0 failures shown but file fails to load; `coach-engine-scenarios.test.ts` × 6 scenario failures — early-base-rebuild quality work, injury-return week-1 volume, taper-quality, peak-to-taper drop, build-ramp tolerance, race-week purity).
- Current HEAD: 6 failures — **identical to baseline**.
- ✅ Wave B introduced **0 new test failures**.

---

## 6. Recommended next wave

Priority order, based on what's still open and what hurts the user-facing app the most:

1. **E1 — kill the markup literals.** Replace `▲ +12% VOL` in `web/app/overview/page.tsx:1111` and `web/app/training/page.tsx:1845` with a derived value off `data.coach.weekDeltas` (or hide the pin when no delta is computable). Trivial 2-file edit.

2. **E2 — neutralize the demo data fixtures.** `demoRaceCalendar()` in `web/app/api/races-page/route.ts:212–267` and `demoActivities()` in `web/app/api/log/route.ts:559–654` should be gated behind `process.env.NODE_ENV === 'development' && process.env.FAFF.RUN_DEMO === '1'` (or similar). Today they fire whenever the DB/cache is empty — including any clean production database — and silently fabricate Big Sur, Disney, AFC etc. into the user's view.

3. **E3 — finish the /races data wiring.** `web/app/races/data.ts:295` (`name: 'David'`) and `:332` (`vdot ?? 49.2`) need the same treatment Wave B applied to /overview + /training: fall through to `null` + render a NO DATA YET branch.

4. **E4 — workout structure synthesis honesty.** `web/app/overview/data.ts:447–450` and `web/app/training/data.ts:314–317` should return `null` (and the structure card should render NO DATA YET) when `workout.distanceMi == null` or `workout.paceTargetSPerMi == null`, rather than synthesize a fake 3 mi @ 9:00/mi block.

5. **E5 — clean up doc-comment citations.** Update 6 stale `@research` comments in `coach.ts` / `plan-validator.ts` / `api/health/route.ts` to point at the real Research headers. Quick mechanical fix; matters for future doctrine reviewers.

6. **E6 — wire /log to the Coach.** `web/app/api/log/route.ts` is the last consumer that gathers `CoachState` but never asks the Coach anything. Once `coach.retrospect()` (Stage R) lands, the Log feed's run rows should be threaded through `coach.runRead()` for the kind/notes columns.

7. **E7 — clean up working-tree drift.** There are un-committed changes to `web/app/overview/data.ts`, `web/coach/coach.ts`, and `web/lib/coach-state.ts` on the working tree that, if committed, will break TSC. Confirm with the user whether this is intended in-progress work or should be discarded.

8. **E8 — guard the 6 pre-existing test failures.** Not introduced by Wave B but on the books: hard/easy alternation in race week, injury-return week-1 cap, taper-quality purity. These are engine-correctness failures that pre-date this audit chain and should be triaged.
