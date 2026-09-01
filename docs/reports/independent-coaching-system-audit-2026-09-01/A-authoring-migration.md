# Independent audit — canonical authoring migration + cold-start prior fix

**Auditor:** agent A, isolated worktree `agent-ae33fa473012f4306`, detached at `main` = `7cac80f0`.
**Date of run:** 2026-09-01 (the branch report was written 2026-08-31/09-01; evidence has moved since, and several of its numbers no longer reproduce — see §3).
**Branches under review:** `origin/canonical-authoring-migration-20260901` (`8641a234`), `origin/cold-start-prior-fix-20260901` (`5017962c` on top).
**DB access:** `faff_readonly` only, via a wrapper that reads `DATABASE_URL_RO`. `web-v2/.env.local` in this worktree was written with **both** `DATABASE_URL` and `DATABASE_URL_RO` pointed at the read-only URL, so no code path in any test could have written. Nothing was committed or pushed. Two temporary probe test files were written, run, and deleted; the worktree is clean.

**Evidence grades used below:** `DIRECT` = I ran it and read the output / queried production. `CODE-PATH` = traced by reading the code, not executed. `FIXTURE` = proved only against synthetic inputs. `UNVERIFIED` = could not confirm.

---

## 0 · Headline

| | |
|---|---|
| **Legacy VDOT call inventory, `generate.ts`** | **38 call expressions across 34 distinct lines** (broad set) · **26 expressions across 22 distinct lines** using the branch report's own narrower name set. The report's "22 call sites" is a count of **lines**, not call expressions, and its name set silently excludes the three goal→pace calls. The earlier "32 across 19 lines" figure reproduces under neither method. |
| **`canonical-authoring-migration-20260901`** | **MERGE** — additive, shadow-only, structurally cannot touch a live plan, gates green, merges clean. Merge the *code*; **do not accept the report's §4/§8 conclusions**, which materially understate the divergence (see §3). |
| **`cold-start-prior-fix-20260901`** | **REVISE** — the mechanism is right (`user_prior`, distinct mode, low confidence, sealed from goal, superseded by real evidence), but it lands a **188 s/mi Rule 9 cliff** that its own test blesses, and it closes only about half the cold-start gap it was written for. Do not merge as the basis for switching authoring. |
| **Blocker for switching authoring over** | Still open, and **larger than the report says**. Two independent cold-start inputs are invisible to the canonical resolvers (weekly mileage — partly fixed; self-reported PR — not fixed at all), and **6 of 7 live plans in production have never been reanchored**, so cold-start users would be permanently priced by whatever authoring decides. |

---

## 1 · Q1 — every remaining legacy VDOT call in the initial authoring path

### 1.1 My count vs the reports'

Method: strip block comments, line comments, and the import lines; count `\bNAME\s*\(` occurrences.

| Name set | Call expressions | Distinct lines |
|---|---|---|
| Report's set (vdot.ts imports minus `parseRaceTime`, plus `conservativeVdotFromMileage`) | **26** | **22** |
| Broad set (adds `parseRaceTime`, `tPaceFromGoal`, `resolveMarathonPace`, `blendedTPaceForWeek`, `measuredProgressFraction`, `maxSeasonalVdotGain`, `achievableRaceTarget`, `boundedRacePaceSPerMi`) | **38** | **34** |

`DIRECT` — reproducible script run against `web-v2/lib/plan/generate.ts` @ `7cac80f0`.

The report's "22 real call sites" is exactly my 22 **distinct lines** for its name set (four lines carry two nested calls each: 9159, 9893, 10338, 10642). So the report is internally consistent but describes lines as "call expressions". **"32 call expressions across 19 lines"** — cited in the report as the prior day's figure and repeated verbatim in `lib/adaptation/authoring-convergence.ts:13` — reproduces under neither counting method and should be treated as stale.

The more important gap: **the report's name set omits `tPaceFromGoal` (2 sites), `blendedTPaceForWeek` (1) and `maxSeasonalVdotGain` (1)** — i.e. the entire goal→prescribed-pace path, which is the one Constitution §G question the inventory most needed to surface. See §2.

### 1.2 Full inventory, `web-v2/lib/plan/generate.ts` @ `7cac80f0`

Classification key: **(a)** legitimate declared fallback · **(b)** duplicate authority the canonical resolvers now own · **(c)** goal-sanity / input validation · **(d)** race-prediction input · **(e)** *new bucket I had to add* — **goal → prescribed training pace**, which is none of (a)–(d) and is a live §G/§7 concern.

| Line | Enclosing function | Call | Class |
|---|---|---|---|
| 744 | `parseGoalSeconds` | `parseRaceTime(goal)` | (c) — string parse |
| 7555 | `embedMidBlockRaces` | `boundedRacePaceSPerMi({…})` | (d) |
| 8683 | `composePlan` | `predictRaceTime(bestRecentVdot, raceDistanceMi)` | (d) — tier classification |
| 8709 | `composePlan` | `predictRaceTime(bestRecentVdot, h.distanceMi)` | (d) — horizon race |
| 8942 | `composePlan` | `conservativeVdotFromMileage(recentWeeklyMi)` | **(b)** — cold-start floor |
| 8952 | `composePlan` | `resolveCurrentTPace(…)` | **(b)** — *the* authoring threshold resolution |
| 8956 | `composePlan` | `tPaceFromVdot(estimatedCurrentVdot)` | **(b)** |
| **8997** | `composePlan` | **`tPaceFromGoal(input.goalSec, raceDistanceMi)`** | **(e)** — goal → `goalTraw` |
| **9004** | `composePlan` | **`maxSeasonalVdotGain(totalWeeks, raceDistanceMi)`** | **(e)** — bounds how far the goal may move the pace |
| 9010 | `composePlan` | `tPaceFromVdot(estimatedCurrentVdot + seasonalGainVdot)` | **(b)/(e)** — `achievableFloorT` |
| 9018 | `composePlan` | `clampToSanePace(goalTFloored, anchor)` | **(e)** — clamp on the goal-derived pace |
| 9043 | `composePlan` | `achievableRaceTarget({…})` | (d) — race-day target |
| 9058 | `composePlan` | `vdotFromRace(goalSec, raceDistanceMi)` | (c) — realism flag |
| 9065 | `composePlan` | `predictRaceTime(estimatedCurrentVdot, raceDistanceMi)` | (d) |
| **9110** | `composePlan::tPaceForWeek` | **`blendedTPaceForWeek({currentT, goalT, …})`** | **(e)** — THE goal→training-pace blend |
| 9158 | `composePlan::iPaceForWeek` | `iPaceFromAnchorPace(anchor)` | **(b)** |
| 9159 | `composePlan::iPaceForWeek` | `iPaceFromVdot(vdotFromTpace(t))` | **(b)** (2 expressions) |
| 9204 | `composePlan` (week loop) | `resolveMarathonPace({tPaceSec: weekT, …, goalPaceSPerMi})` | **(b)/(e)** — MP anchor; goal is an input |
| 9893 | `composeMaintenancePlan` | `tPaceFromVdot(conservativeVdotFromMileage(0))` | **(b)** (2 expressions) |
| 10338 | `composeRecoveryPlan` | `tPaceFromVdot(conservativeVdotFromMileage(recentWeeklyMi ?? 0))` | **(b)** (2 expressions) |
| 10641 | `specForComposedDay` | `iPaceFromAnchorPace(anchor)` | **(b)** |
| 10642 | `specForComposedDay` | `iPaceFromVdot(vdotFromTpace(weekT))` | **(b)** (2 expressions) |
| 13014 | `composeForUserInternal` | `vdotFromRace(goalSec, raceDistanceMi)` | (a)/(c) — season-progress gate input |
| **13019** | `composeForUserInternal` | **`measuredProgressFraction(anchor, best, goalVdot)`** | **(e)** — sets the blend gate |
| 13048 | `composeForUserInternal` | `predictRaceTime(bestRecentVdot, raceDistanceMi)` | (d) |
| 13298 | `persistComposedPlan` | `resolveCurrentTPace(…)` | **(b)** — 2nd independent computation |
| 13654 | `loadGeneratorInputs` | `vdotFromRace(goalSec, raceDistanceMi)` | **(c)** — off-the-top goal check |
| 13655 | `loadGeneratorInputs` | `predictRaceTime(85, raceDistanceMi)` | **(c)** |
| 13886 | `loadGeneratorInputs` | `computeBestRecentVdot(raceCandidates, todayISO, 180, runCandidates, floor)` | **(b)** — duplicated by `loadVdotFallback` |
| 13956 / 14002 / 14077 | `loadGeneratorInputs` | `parseRaceTime(meta.goal…)` ×3 | (c) |
| 14154 | `loadGeneratorInputs` | `resolveCurrentTPace(…)` | **(b)** — 3rd independent computation |
| **14160** | `loadGeneratorInputs` | **`tPaceFromGoal(goalSec, raceDistanceMi)`** → `tPaceSec = min(goalT, currentT)` | **(e)** — plan-wide T can be the goal's |

**Totals by class:** (a) 1 · (b) 14 lines / 18 expressions · (c) 7 · (d) 5 · **(e) 7 lines that let the goal reach a pace.**

### 1.3 Outside `generate.ts`

`DIRECT` (scripted scan of `lib/plan/*.ts`):

- `lib/plan/spec-builder.ts` — holds the *definitions* of `resolveMarathonPace` (281), `tPaceFromGoal` (1996), `conservativeVdotFromMileage` (2048), and one internal call at 234. Reached by both legs.
- `lib/plan/zone-anchors.ts:227,235` — `rPaceFromVdot(vdotFromTpace(tPaceSec))`, a VDOT round-trip to price the R / 10K / 3K zones off whatever T it is handed. Reached from `buildWorkoutSpec` via `resolveZoneAnchors`, on **both** legs. Class (a) with a caveat: it is a legitimate table lookup, but it re-enters VDOT space from a canonical pace, so a below-table canonical anchor silently clamps up to VDOT 30. Not a duplicate *authority*; worth listing because a migration will not remove it.
- `plan-templates.ts`, `goal-tiers.ts`, `layout.ts`, `catalogue-rx.ts`, `workout-library-static.ts`, `seal.ts` — **zero** legacy VDOT calls.

### 1.4 The structural finding the report gets right

`resolveCurrentTPace` is computed **three** times from the same inputs (8952, 13298, 14154). Confirmed `DIRECT`. Rule 16. A migration collapses it to one `resolvePrescribedPaceAnchors` call.

---

## 2 · Q2 — does the stated goal still move an authored training pace? **YES, on the rebuild path.**

`DIRECT` (probe test driving the real `blendedTPaceForWeek` / `tPaceFromGoal` / `maxSeasonalVdotGain`, owner-shaped inputs: VDOT 47.7, 3:00 marathon, 14 weeks):

```
currentT 7:11/mi (431s) · goalTraw 6:34/mi · seasonalGain +2.75 VDOT
achievableFloorT 6:51/mi  →  goalT 6:51/mi

measuredProgressFraction = null  → blend 0.00 → weekT 7:11/mi   Δ    0s   (FRESH AUTHORING)
measuredProgressFraction = 0     → blend 0.15 → weekT 7:08/mi   Δ  - 3s   (REBUILD, zero evidence)
measuredProgressFraction = 0.25  → blend 0.40 → weekT 7:03/mi   Δ  - 8s
measuredProgressFraction = 0.5   → blend 0.65 → weekT 6:58/mi   Δ  -13s
measuredProgressFraction = 1     → blend 1.00 → weekT 6:51/mi   Δ  -20s
```

**The verdict, precisely:**

- **A first authoring for a race is clean.** `composeForUserInternal` (generate.ts:12967) only sets `measuredProgressFraction` when a **prior non-archived plan for the same `race_id`** exists. Fresh → `undefined` → `gatedBlendFraction` returns 0 → `weekT === currentT`. The goal does not move the pace. `CODE-PATH` + `DIRECT`.
- **A mid-block rebuild is not.** `recompute-paces.ts:232` — `gatedBlendFraction` returns `min(1, measured + BLEND_GRACE_FRACTION)` with `BLEND_GRACE_FRACTION = 0.15` (`recompute-paces.ts:116`). So **even at zero demonstrated progress the goal moves the prescribed threshold pace 15% of the way toward it.** For the owner that is 3 s/mi; the ceiling is `tPaceFromVdot(v) − tPaceFromVdot(v + maxSeasonalVdotGain)` = 20 s/mi here, and larger on a longer build.
- **The owner's live plan is a rebuild.** `authored_state.pace_blend.measured_progress_fraction = 0` on `pln_9a57561debb776e5`. `DIRECT` (production query). So this fired, on the real account, on 2026-08-31.
- It is **asymmetric**: `BRK-1` (`recompute-paces.ts:262`) keeps `currentT` whenever the goal is slower. So the goal can only ever make training paces *faster* than evidence supports. Sweep: goals of 3:25 / 3:50 / 4:00 all produce `weekT = currentT`; only the 3:00 goal moves it. `DIRECT`.
- `generate.ts:14160` is a second, blunter leak: `tPaceSec = min(tPaceFromGoal(goal), currentT)` — the plan-wide T that the maintenance/recovery composers read and that `persistPlan` falls back to when a week carries no `tPaceSec`. `min` of two paces picks the **faster**, so for an ambitious goal this plan-wide value *is* the goal's T. `CODE-PATH`.

**This is a live Constitution §7 / §G violation at authoring time**, and it is now a §8 violation as well: `recomputePacesForPlan` deleted its goal blend on 2026-08-31 (`recompute-paces.ts:284-291` — "this path no longer reads a goal at all"), so **authoring and recomputation disagree about whether the goal may touch a training pace.** That is precisely the "sometimes old, sometimes new, depending on screen" state §8 forbids. The migration branch's inventory does not name it; its §2 classification table has no row for it.

Bounded in magnitude, unbounded in principle. It should be listed as a blocker of its own, independent of the cold-start issue.

---

## 3 · Q3 — the shadow-compare mechanism, reproduced

### 3.1 Runs, and what it produced today

`DIRECT`. `git checkout origin/canonical-authoring-migration-20260901`; `npx tsc --noEmit` → **0 errors**; `npx vitest run lib/plan/_authoring_shadow_compare.test.ts` → **11/11 pass, 1.7 s**; `npx vitest run lib/plan/_authoring_shadow_compare.audit.test.ts --reporter=verbose` → **2/2 pass, 31 s**, against production over `faff_readonly`.

Owner, `cim`, today 2026-09-01, 14 weeks, 98 composed days:

| Anchor | Today (my run) | Report's run (2026-08-31) |
|---|---|---|
| threshold | **7:00/mi**, `direct`, conf 0.79, vdot 49.2 | 7:10/mi, `direct`, conf 0.73 |
| interval | 6:41/mi, `vdot_fallback`, conf 0.50 | 6:47/mi, conf 0.29 |
| easy ceiling | 8:22/mi, `direct`, conf 0.63 | 8:22/mi, conf 0.63 |
| marathon | **7:43/mi**, exponent 1.087 | 7:55/mi |

### 3.2 The largest divergences — the report's account of these is wrong

`DIRECT`. Full per-day extraction from my run:

| Δ | Days | Type | Example sub_label | legacy → canonical |
|---|---|---|---|---|
| **+21 s/mi** | 3 | intervals ×1, tempo ×2 | `10×400m hills @ MP effort` (wk6) · `2.5 mi WU · 11 mi @ MP · 1.5 mi CD` (wk11) · `2 mi WU · 7 mi @ MP · 1 mi CD` (wk12) | **7:22/mi → 7:43/mi** |
| **+16 s/mi** | **11** | long | every long run, wk0–wk12 (11.3–20.0 mi) | **8:24/mi → 8:40/mi** |
| −4 to −5 s/mi | 13 | tempo / threshold / intervals | `4×1mi @ T pace` etc. | 7:04 → 7:00 |
| 0 | 4 | race | — | identical |

**The report's §4 claim** — *"the largest single-day divergence anywhere in the 98-day block is +23s/mi (two hill-repeat days whose legacy leg used a cruise-interval `T − 18` approximation the canonical `anchors.intervalSecPerMi` reads more precisely)"* — **is wrong on the cause and does not reproduce on the value.** The three largest-divergence days today are **marathon-pace** days, not cruise-interval approximations. The mechanism is `spec-builder.ts:1189-1190`: legacy takes `marathonPaceSPerMi({tPaceSec, easyAnchorTSec, goalPaceSPerMi})`, which for this runner refuses the 6:52 goal MP as out-of-zone and falls to the flat **T+18** population offset (7:22); canonical takes `anchors.marathonSecPerMi` = **the runner's own fitted Riegel exponent** (7:43). That is the single most doctrinally consequential difference in the whole comparison and the report does not identify it.

**The report also omits the long runs entirely.** Its phase table tabulates QUALITY / RACE-SPECIFIC / TAPER *quality days*; its "total stress proxy" is quality-days-only. My run reproduces the printed proxy (**246 s·mi**, vs the report's "+6 s·mi" — a 40× drift in one day, unexplained by anything in the report's own methodology), but the whole-block figure including long runs is:

```
WHOLE-BLOCK headline Σ Δ×mi (all priced days): 3011 s·mi over 366 mi  (mean +8.2 s/mi)
  of which long runs alone:                    2765 s·mi over 11 days
```

`DIRECT` (probe over the compare's own `days[]`). **93% of the volume-weighted divergence lives in a day type the report's summary never reports.**

Band edges (also printed as "-" in the audit table, since easy days carry no headline pace) — `DIRECT`:

```
×45  easy       legacy 8:31–9:11   canonical 8:22–9:02   Δ  −9 s/mi
×11  long       legacy 8:06–8:41   canonical 8:22–8:57   Δ +16 s/mi
× 3  shakeout   legacy 9:11–9:41   canonical 8:52–9:22   Δ −19 s/mi
× 4  race       identical
```

### 3.3 Which side is more credible

Per doctrine, **canonical wins on every one of these**, and the reasoning is already written down in the code the migration would be adopting:

- **MP (+21 s/mi).** `spec-builder.ts:1160-1188` states it explicitly: the T+18 offset is "one formula for every runner", and the goal branch "is the goal reaching a TRAINING pace, which Constitution §G forbids outright". `anchors.marathonSecPerMi` is threshold capacity carried to 26.2 through the runner's **own** fitted exponent (1.087, `personallyEvidenced: true`, conf 0.79). The canonical number is slower — and it is the honest one.
- **Long runs (+16 s/mi).** `spec-builder.ts:1128-1135`, verbatim: the legacy split "paced every long run at 8:36/mi against an easy band opening at 9:02, i.e. a long run prescribed FASTER than an easy day". Canonical gives easy and long one shared fast edge. Correct.
- **Threshold (−4/−5 s/mi).** `direct`, conf 0.79, corroborated observations vs a `vdot_fallback` scalar. Canonical.
- **Easy (−9 s/mi) and shakeout (−19 s/mi).** `resolveEasyCeiling` `direct` conf 0.63 vs an offset off a T-pace. Canonical.

### 3.4 **Authored or reanchored?** — the question the report never asks

**The shadow compare compares against the plan AS AUTHORED, never as reanchored.** `CODE-PATH` + `DIRECT`: `runAuthoringShadowCompare` calls `composeForUser` (in-memory compose, no persist) and never reads `plan_workouts`.

That matters, because on the owner's account **the runner already reads the canonical numbers**:

```
production, plan pln_9a57561debb776e5, future rows:
  long      ×11  pace_target 520 s/mi (8:40)  band lo 502 (8:22)   ← canonical, NOT legacy 8:24
  tempo "…@ MP…" ×2  pace_target 475 s/mi (7:55)                   ← canonical MP at reanchor time
authored_state.pace_blend.reanchored_at = 2026-08-31T07:04:27Z (authored 03:40:26Z)
```

`DIRECT` (production queries). So on this account the shadow compare is measuring **authoring vs. what the nightly reanchor already fixed**, three and a half hours later. The migration's real-world benefit for a reanchored runner is confined to that window; its real-world benefit — and risk — is concentrated entirely on runners who are *never* reanchored (§5).

### 3.5 Fidelity limits of the mechanism itself

Four, all `CODE-PATH`, none named in the report:

1. **"Zero structural diffs" is structurally guaranteed, not measured.** Both legs consume the *same* `composed.weeks` produced by the legacy `composeForUser`. Only `buildWorkoutSpec` is re-run. But `composePlan` uses `weekT` / `iPaceForWeek` / `weekMp` for **workout selection** (`OverloadTrajectory`'s at-pace caps at `generate.ts:9138-9145`, `layoutWeek`'s `weekMp` at 9204). A real migration changes those inputs and can change selection, distances and phases. The shadow compare cannot see that class at all.
2. **Persisted `distance_mi` is not compared.** `persistedDayShape` stores the *spec's* summed total, which depends on `repPaceSec` (rep-count capping at `spec-builder.ts:716-725`). `SpecSummary` captures `repCount` but not the summed total. Fine for the owner (no rep-count diffs); not fine for a cold-start account where the two legs differ by 100–180 s/mi.
3. **The 4-account corpus block reports only `mean quality Δ`** — no structural check, no long/easy deltas, no rep-count comparison (`_authoring_shadow_compare.audit.test.ts:196-201`). And a *signed mean* lets a +200 and a −200 cancel.
4. **`describe.skipIf(!RO)`** — without `DATABASE_URL_RO` the whole audit silently skips and reports green. Rule 18 liveness gap.

The mechanism's **safety** claims, by contrast, hold: `DIRECT` — no import of `mutatePlan` / `persistPlan` / `persistComposedPlan`; the audit test sets `process.env.DATABASE_URL = RO` before every dynamic import; `canonicalSpecForComposedDay` has no runtime importer and is declared in `MODULE_ORPHANS` with an argued reason.

---

## 4 · Q4 — the cold-start divergence and the fix

### 4.1 Root cause on `main`, traced

`CODE-PATH`, confirmed by reading both sides:

- **Legacy** (`generate.ts:13845-13872`, tags `COLD-2`/`HIGHVOL-1`): when measured mileage reads zero it seeds `recentMi` from **`profile.history_avg_weekly_mi`**. Separately, **`generate.ts:13901-13908`** (`PARITY-1`) seeds `bestRecentVdot` from **`profile.race_history`** (self-reported PRs, 180-day window) when nothing was measured.
- **Canonical** (`capacity-resolver.ts:1155` on `main`): `priorWeeklyMi(fallback.normalWeeklyMi)` → refusal or zero → `{ weeklyMi: 0 }` → `conservativeVdotFromMileage(0)` = VDOT 30 → `tPaceFromVdot(30)` = **10:42/mi**. `loadVdotFallback` reads only `loadVdotInputs` (which queries the `races` table, **not** `profile.race_history` — `DIRECT`, `vdot-inputs.ts:425`) and `normalWeeklyMileage` (which reads only `runs`).

So the canonical resolver ignores **two** self-reported cold-start inputs, not one. The branch report names only the mileage one.

Also worth recording: `SourceMode.user_prior` existed in the union (`capacity-resolver.ts:298`) and in `SOURCE_MODE_STRENGTH` (313) on `main` but was **never assigned by any resolver** — `DIRECT` grep.

### 4.2 What the fix does

`DIRECT` (diff read + tests run). `loadOnboardingWeeklyMiPrior` reads `profile.history_avg_weekly_mi` through `rowOrNull`; `priorWeeklyMi(real, selfReport)` substitutes it **only when the real filtered read is 0 or refused**; the tier map emits `user_prior` and the reason `ONBOARDING_MILEAGE_USER_PRIOR`; confidence is a new flat band `userPrior = 0.15`, strictly between `populationPrior` 0.10 and `fallbackFloor` 0.20. Mirrored in `composeHighIntensityCapacity`. `resolveEasyCeiling` inherits the mode from threshold (`capacity-resolver.ts:1367`).

**Against the audit's four criteria:**

| Criterion | Verdict | Evidence |
|---|---|---|
| Enters as a LOW-CONFIDENCE prior with a distinct `source_mode` | **PASS** | `user_prior`, conf 0.15, distinct reason code. `DIRECT` |
| NOT treated as demonstrated capacity | **PASS** | only substitutes the weekly-mileage scalar fed to `conservativeVdotFromMileage`; `evidenceIds: []`; never reaches `direct`/`inferred`/`race_derived`. `DIRECT` (probe asserts `evidenceIds` empty) |
| Direct evidence supersedes it over time | **PASS, but see the cliff** | `if (real > 0) return real` — any nonzero habit mileage displaces it, with no special-case code. `DIRECT` |
| Goal cannot move the prior | **PASS, structurally** | `VdotFallbackRead` and `ThresholdCapacityInputs` carry no goal field at all; probe asserts no key matches `/goal/i`. `DIRECT` |

### 4.3 Case results — probe driving the real resolvers

`DIRECT`, temporary probe (now deleted), cold-start branch:

**Zero-run**
```
selfReport=null → 10:42/mi · population_prior · 0.10
selfReport=   3 → 10:42/mi · user_prior       · 0.15    (VDOT-30 floor, no change in value)
selfReport=  20 →  9:23/mi · user_prior       · 0.15
selfReport=  30 →  8:23/mi · user_prior       · 0.15
selfReport=  40 →  7:34/mi · user_prior       · 0.15
selfReport= 100 →  6:54/mi · user_prior       · 0.15    (capped at VDOT 50)
```

**RULE 9 CONTINUITY WALK — self-report 40 mi/wk on file, real habit mileage swept 0 → 40**
```
real=   0 mi/wk → 7:34/mi (454s) · user_prior
real=0.05 mi/wk → 10:42/mi (642s) · population_prior      Δ +188 s/mi
real= 0.5 mi/wk → 10:42/mi
real=   5 mi/wk → 10:42/mi
real=  15 mi/wk → 10:08/mi
real=  40 mi/wk →  7:34/mi
WORST SINGLE-STEP JUMP: 188 s/mi at real = 0.05 mi/wk
```

**This is a textbook Rule 9 violation, and it carries Rule 9's own diagnostic signature: the runner who does MORE gets the categorically worse plan.** A runner who self-reported 40 mi/wk at onboarding and then logs a single short run has their prescribed threshold pace jump **+3:08/mi** — from 7:34 to 10:42 — and stays there until their *real* habit mileage climbs back past ~35 mi/wk, which for a 90-day habit window is weeks of full training.

**Sparse history (the exact case a new user is in for their first month):** 1–2 short runs ≈ 0.5 mi/wk representative → **10:42/mi**, worse than the same runner would have got the day before they ran at all. `DIRECT`.

The branch's own test **`3e-3` asserts this behaviour as correct** ("ANY real logged mileage displaces the self-report automatically — no special-case code needed", with `okNormal(1)` vs `selfReportedWeeklyMi: 40` expecting `population_prior`). The evidence-precedence *principle* is right; the *implementation* — a hard switch at `real > 0` — is what Rule 9 forbids. The legacy cascade has the same shape (`if (recentMi <= 0) recentMi = selfReport`), so the fix faithfully reproduces a pre-existing cliff; but Rule 9 was locked precisely to stop new code inheriting these, and no continuity walk was added.

The suggested shape: **blend, don't switch** — weight the self-report against real mileage by representative-day coverage, so one logged run moves the prior a little and a full month of logged running retires it. That is continuous, monotone, and keeps evidence precedence.

**Returning runner (old evidence only):**
```
measuredVdot 47 dated 2026-08-01 → 7:17/mi · vdot_fallback · conf 0.34
measuredVdot 47 dated 2026-05-01 → 7:17/mi · vdot_fallback · conf 0.21
measuredVdot 47 dated 2025-11-01 → 7:17/mi · vdot_fallback · conf 0.20
```
Value held, confidence decayed. **Correct** — this is the doctrine's "decay confidence, not value" rule, working. `DIRECT`.

**Extreme goal:** structurally impossible to reach the resolver. **PASS**. `DIRECT`.

**Self-reported ZERO vs unanswered:** `DIRECT` — both produce `population_prior` with reasons `NO_DIRECT_EVIDENCE, MILEAGE_POPULATION_PRIOR`, **indistinguishable downstream.** `loadOnboardingWeeklyMiPrior`'s comment explicitly claims it preserves the distinction ("must survive as `0`, not be coerced into the same null a missing answer produces (Rule 11)"), and it does preserve it *inside the reader* — then `priorWeeklyMi`'s `> 0` gate erases it one function later and nothing records that the runner answered. A header comment asserting an invariant that nothing enforces is exactly Rule 20's prose corollary. Minor, but it is a claim the code makes and does not keep.

### 4.4 Does the fix close the gap? Only about half.

`DIRECT` — shadow-compare audit run on the cold-start branch vs `main`, same day, same accounts:

| Account | `history_avg_weekly_mi` | `race_history` | main: canonT | fix: canonT | legacy T | mean quality Δ (main → fix) |
|---|---|---|---|---|---|---|
| `qa-phone-onboard-…` | 20 | **1 entry** | 10:42 | **9:23** | 7:42 | +107s → **+58s** |
| `qa-race-…` | 20 | 0 | 10:42 | 9:23 | 7:56 | (no quality days) |
| `apple-review@faff.run` | 30 | 0 | 10:42 | **8:23** | 7:43 | +169s → **+20s** |
| `qa-phone-verify-…` | **0** | 0 | 10:42 | 10:42 | 10:42 | unchanged |

- `apple-review`: gap essentially closed (+20 s/mi residual).
- `qa-phone-onboard`: **101 s/mi still open**, because the residual is driven by the *self-reported PR* (`profile.race_history`) that legacy's `PARITY-1` consumes and the canonical ladder has no rung for. The fix does not touch that path.
- `qa-phone-verify`: the runner answered "0 mi/wk"; the `> 0` gate discards the answer and the account stays on the population floor.

So the branch's own headline defect — "every runner's FIRST plan would be paced at the near-beginner VDOT-30 floor" — is **partially** fixed. A cold-start runner who typed a recent PR is still priced ~1:40/mi slower than the legacy path would price them.

---

## 5 · Q5 — convergence guards: how long can a plan stay legacy-priced?

### 5.1 The mechanism

`CODE-PATH` + `DIRECT`:

- `reanchorActivePlan` (`lib/plan/reanchor-plan.ts:281`) has exactly **one** production caller: `app/api/cron/snapshot-projections/route.ts:129`. `DIRECT` grep across `lib/`, `app/`, `scripts/`.
- `recomputePacesForPlan` has one production caller: `lib/plan/adapt.ts:2099` (inside `applyAdaptations`, i.e. `run-adaptations`), gated on an adaptation actually firing.
- **Nothing in the authoring path calls either.** `generate.ts` / `generatePlan` never ensure their own pace convergence. Rule 23's own words apply verbatim: authoring assumes a later job will fix its prices.
- `snapshot-projections` is scheduled `30 7 * * *` (`.github/workflows/snapshot-projections.yml:28`).

### 5.2 The hard gate nobody has written down

`reanchor-plan.ts:290` — **GUARD 2**:

```ts
if (measuredVdot == null || !Number.isFinite(measuredVdot) || measuredVdot <= 0) return null;
```

and the caller passes `vdot = bestRecentVdot(...)`, i.e. **evidence-only** (`snapshot-projections/route.ts:120-131`, comment: *"a null read leaves the plan alone rather than re-anchoring onto another estimate"*).

**So a runner with no qualifying measured VDOT is never reanchored — not late, never.**

### 5.3 Production evidence

`DIRECT`, every non-archived plan in production, 2026-09-01:

| Account | plan | authored | reanchored | runs |
|---|---|---|---|---|
| dnitch85@me.com | `pln_9a57561debb776e5` | 2026-08-31 03:40 | **2026-08-31 07:04** (+3h24m) | 272 |
| qa-phone-onboard-… | `pln_bb0ee646c2ace790` | 2026-08-28 20:37 | **never** | 0 |
| qa-phone-verify-… | `pln_0c75f856a3849c32` | 2026-08-21 16:27 | **never** | 0 |
| qa-race-… | `pln_0c917a6cbe63d080` | 2026-08-19 22:02 | **never** | 0 |
| qa-beginner-… | `pln_5e51f75b89cc8f00` | 2026-08-19 19:40 | **never** | 0 |
| qa-goal-… | `pln_2684dabde181e595` | 2026-08-19 19:39 | **never** | 0 |
| apple-review@faff.run | `pln_c773986632a66584` | 2026-08-08 09:31 | **never** (24 days) | 0 |

**6 of 7 live plans have never been through the canonical resolvers.** The one that has is the only account with running history.

### 5.4 Direct answers

- **What triggers reanchor?** Only the nightly `snapshot-projections` cron, and only when `bestRecentVdot` returns a non-null measured VDOT. `run-adaptations` can also recompute, but only when an adaptation fires.
- **Is it only the nightly cron?** Yes for the pace anchors. (`run-adaptations`' `reanchorLthr` moves LTHR, a different quantity — correctly noted in `authoring-convergence.ts:69-71`.)
- **What if the cron is late (Rule 23)?** Lateness alone is survivable — the cron ledger makes the job due-driven rather than clock-driven. Observed `cron_ok` heartbeats for `snapshot-projections`: 2026-08-31 04:19, 07:04, 15:18; 2026-09-01 07:02, 12:41 — **max observed gap 15.7 h**, one `cron_stale` alert on 2026-08-31. `DIRECT` (`ops_alerts`). So lateness gives a 24-hour-ish worst case for an *evidenced* runner.
- **Is there any path where a plan stays legacy-priced beyond 24 h?** **Yes — indefinitely.** Any runner without a qualifying measured VDOT. Demonstrated at 24 days on `apple-review`.
- **A plan authored for a NEW user before their first cron?** Legacy-priced from authoring until their **first qualifying run** produces a measured VDOT — not until the next cron. Under `CAPACITY_RUN_FLOOR_MI`/`EVIDENCE_RUN_FLOOR_MI` (3.0 mi) that is at minimum one 3-mile run, and in practice longer.

**Consequence for the migration decision:** the population for which authoring pace-authority actually matters most is exactly the population the reanchor safety net never reaches. `authoring-convergence.ts`'s four-state guard is well-built and correctly models `AUTHORED_TOO_RECENTLY` / `REANCHOR_STATUS_UNKNOWN`, but it has **no state for "this runner can never be reanchored because they have no measured VDOT"**, which is the majority state in this database today. That is a gap in the guard, and it is worth closing whether or not either branch merges.

---

## 6 · Q6 — non-pace consequences

`DIRECT` unless noted.

| Dimension | Changes? | Evidence |
|---|---|---|
| **`hr_cap_bpm`** | **No.** | `spec-builder.ts:1253,1267,1350,1618,1641,1765` — `hrCapEasy(lthr, maxHr)` / `hrCapLong(lthr, maxHr)`, pure functions of LTHR/maxHR. The `anchors` argument never reaches them. Byte-identical on both legs in my run. |
| **Warm-up / cool-down** | **No.** | Audit: legacy 2.00/1.78 mi vs canonical 2.00/1.78 mi. |
| **Rep count / structure (owner)** | **No.** | "STRUCTURAL DIFFS: none". |
| **Rep count / structure (cold start)** | **UNVERIFIED — and the shadow compare cannot answer it.** | Rep counts cap against `repPaceSec` (`spec-builder.ts:716-725`); a 100–180 s/mi difference could change them. The corpus block prints no structural check for the four non-owner accounts. |
| **Workout SELECTION, phases, distances** | **UNVERIFIED — out of the mechanism's reach.** | Both legs share `composed.weeks` from the legacy compose. `composePlan` uses `weekT`/`iPaceForWeek`/`weekMp` for selection and trajectory caps (`generate.ts:9138-9204`), so a real migration can move them. |
| **Grading bands** | **Yes.** | easy −9, long +16, shakeout −19 s/mi at both band edges. These drive adherence/grading, and the audit table prints "-" for all of them. |
| **Persisted `distance_mi`** | **Possible, unmeasured.** | `persistedDayShape` stores the spec's summed total, which is pace-dependent; `SpecSummary` does not capture it. |

### The `restS / 540` hardcode

`DIRECT`. `spec-builder.ts` uses a literal `540` (9:00/mi) as the recovery-jog pace for **mileage accounting** at lines **717, 867, 1500, 1550, 1724, 1845, 1865, 1933, 1956**, documented at 1799-1803 (*"Approximated at a 9:00/mi jog pace… within 5-10% of reality"*).

- It is **identical on both legs**, so it does not contribute to the divergence. The migration neither fixes nor breaks it.
- It is nonetheless a doctrine gap that a canonical-authoring migration should be honest about: `anchors.shakeoutCeilingSecPerMi` is the canonically-owned recovery pace (8:52/mi for the owner, 11:2x for a cold-start runner), and the accounting uses a population constant instead. For a 10:42/mi runner the float mileage is understated by ~20%; for a sub-elite it is overstated. It is a Rule 16 "one quantity, one number" smell, and after a migration it would be the **only** un-migrated pace constant left in the distance accounting. Worth a follow-up ticket, not a merge blocker.

---

## 7 · Q7 — build, tests, merge dry-runs

`DIRECT`, all in this worktree with `web-v2/node_modules` symlinked.

| Branch / state | `tsc --noEmit` | Tests |
|---|---|---|
| `origin/canonical-authoring-migration-20260901` (`8641a234`) | **0 errors** | `lib/plan/_authoring_shadow_compare.test.ts` **11/11 pass** · `lib/plan/_authoring_shadow_compare.audit.test.ts` **2/2 pass** (31 s, real prod reads) |
| `origin/cold-start-prior-fix-20260901` (`5017962c`) | **0 errors** | `lib/training/_capacity_resolver.test.ts` + `_authoring_shadow_compare.test.ts` **47/47 pass** |
| **`cold` + `main`(7cac80f0) merged** | **0 errors** | `lib/training` + `lib/plan`: **188 files passed, 6 skipped · 2828 tests passed, 8 skipped** |

**Merge dry-run.** `git merge --no-commit --no-ff 7cac80f0` into a local copy of `cold` (which contains `mig`): **"Automatic merge went well"**, **zero conflicts**, `git ls-files -u` empty. The only shared file is `web-v2/lib/audit/generated-content-registry.ts` (auto-merged, +4/−2). No conflict in `generate.ts`, `spec-builder.ts`, `capacity-resolver.ts`, `recompute-paces.ts`. Merge aborted; worktree restored to detached `7cac80f0`, `git status` clean.

**Enforcement gates on the merged state** — all `DIRECT`, all **PASS**:

```
check-doctrine.sh            PASS · 662/662, 323 citations resolve
check-coercion.sh            PASS · 33 argued exemptions, ratchet 133, baseline 181
check-swallowed-failure.sh   PASS · 13 argued exemptions, baseline 374
check-generated-content.sh   PASS · 38 authored columns, every one with a named reader
check-normal-window.sh       PASS · liveness probe present, 9 tests
check-goal-immutability.sh   PASS · 8 guards + ratchet, 13 tests
check-anchor-derivation.sh   PASS · 4 sites, 5 declared files, controls passed
check-derived-consistency.sh PASS
```

Note that `check-goal-immutability.sh` passes while §2's authoring goal-blend is live — that gate watches goal *mutation*, not goal→pace leakage. There is no gate for the latter. Rule 20.

---

## 8 · Q8 — recommendations

### `origin/canonical-authoring-migration-20260901` → **MERGE (code), REVISE (report)**

**Merge the code.** It is purely additive (3 new files + one argued `MODULE_ORPHANS` entry), structurally cannot reach a write path, typechecks, passes 13/13 of its own tests, passes every enforcement gate, and merges into current `main` with no conflict. It is genuinely useful apparatus and there is no reason to leave it on a branch where it will rot behind `main`.

**Before or alongside merging, correct the report and the mechanism on five points:**

1. **§4's largest-divergence claim is wrong.** The +21 s/mi days are marathon-pace days (flat T+18 vs the runner's own Riegel exponent), not cruise-interval approximations. This is the most doctrinally significant difference in the comparison and it is misattributed.
2. **The 11 long runs at +16 s/mi are omitted from every summary.** They carry 2,765 of the 3,011 s·mi whole-block divergence. Report a volume-weighted whole-block figure, not a quality-days-only proxy — the "+6 s·mi" headline is not a fair summary of a block where the canonical path moves 366 priced miles by a mean of +8.2 s/mi.
3. **Report the easy/long/shakeout BAND deltas.** The audit table prints "-" for the 45 easy days, which are the largest single group.
4. **Say plainly that the comparison is authoring-vs-canonical, not authoring-vs-what-the-runner-sees.** On the only evidenced account in the database, the live plan already carries the canonical numbers (long 520 s/mi, MP 475 s/mi — verified in production).
5. **State what the mechanism cannot fail on (Rule 22).** "Zero structural diffs" is guaranteed by construction — both legs share the legacy `composed.weeks`, so workout selection, phases and distances are never compared. Add that sentence to the file header; and either extend the corpus block to check structure on the non-owner accounts or say it doesn't.

Minor: fix the `describe.skipIf(!RO)` silent-skip (Rule 18 liveness); the unused `TODAY` constant; and use a mean of |Δ| or a distribution rather than a signed mean in the corpus block.

**Do not treat this branch as clearing the way to switch authoring.** Its own §8 says so and it is right.

### `origin/cold-start-prior-fix-20260901` → **REVISE**

The design is right and the code is careful: correct `SourceMode`, correct confidence ordering, correct evidence precedence, goal structurally sealed out, `rowOrNull` rather than a swallowed catch, mirrored in high-intensity, easy-ceiling inherits. Every gate passes. I would want it merged eventually.

**Three things to fix first:**

1. **The 188 s/mi Rule 9 cliff (blocker).** `real > 0` is a hard switch; a runner who logs 0.05 mi/wk after self-reporting 40 goes 7:34 → 10:42/mi, and the *sparse-history* case (1–2 runs, weeks 1–4 of a new account) lands in the worse bucket than the zero-run case it was written to fix. Rule 9's own signature — the more-engaged runner gets the worse plan — is present. Blend by representative-day coverage instead of switching, and add a continuity walk (`_restore_continuity`-style) across the substitution boundary. The branch's test `3e-3` currently *asserts the cliff as correct* and would need rewriting.
2. **The self-reported-PR rung is still missing (blocker for the stated goal of the branch).** The residual 101 s/mi on `qa-phone-onboard` comes from `profile.race_history`, which legacy's `PARITY-1` consumes and the canonical ladder has no rung for. Until that is decided — a `user_prior` VDOT rung, or an explicit product decision that a typed PR does not price a plan — the branch does not close the gap it names.
3. **The answered-zero / unanswered collapse.** `priorWeeklyMi`'s `> 0` gate erases the distinction the reader's own comment promises to keep, and nothing downstream can tell them apart. Either emit a distinct reason code for "the runner answered zero" or delete the sentence (Rule 20's prose corollary).

### Independent of both branches — three findings this audit surfaced

1. **The goal still moves a prescribed training pace at authoring** (§2), on the mid-block-rebuild path, on the owner's own live plan, including 15% of the gap on *zero* demonstrated progress. `recomputePacesForPlan` deleted this on 2026-08-31; `generate.ts` did not. That is a live Constitution §7/§G violation and a §8 "two truths depending on which path ran last" state. **There is no gate for it** — `check-goal-immutability.sh` watches goal *mutation*, not goal→pace leakage. This should be fixed before, not after, any authoring migration; migrating authoring to canonical anchors would in fact *fix it as a side effect*, which is an argument for the migration the report never makes.
2. **6 of 7 live plans have never been reanchored** (§5), and `reanchorActivePlan`'s GUARD 2 means a runner without a measured VDOT never will be. `authoring-convergence.ts` has no state for this. Add one (`CANNOT_CONVERGE_NO_MEASURED_VDOT` or similar) and surface it — per Rule 23, a precondition that can never be satisfied should be loud, not silent.
3. **`resolveCurrentTPace` runs three times per authoring** from identical inputs (§1.4). Rule 16. Collapsing it is the cheapest single win in the migration.

---

## 9 · Reproduction notes

- Worktree base branch was the pre-rewrite `claude/build-runcino-app-OIRJr` (no `web-v2` — the documented tell). Detached at `7cac80f0` before any work.
- `web-v2/node_modules` symlinked to the root checkout's; `web-v2/.env.local` (gitignored) written with `DATABASE_URL` **and** `DATABASE_URL_RO` both set to the read-only URL, so a write was impossible from any test process.
- Two temporary probes were written under `web-v2/lib/`, run, and deleted: `_agentA_coldstart_probe.test.ts` (8 cases, real resolvers) and `_agentA_bands_probe.test.ts` (band/volume-weighted extraction over the shadow compare's own output). Full stdout is in this scratchpad's `audit-run.txt` (main-side migration branch) and `audit-cold.txt` (cold-start branch).
- Nothing was committed. Nothing was pushed. The worktree is clean and detached at `7cac80f0`.
