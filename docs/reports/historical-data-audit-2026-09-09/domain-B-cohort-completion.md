# Domain B Completion Pass — the actual per-run truth table and real data-quality counts

## Correction/completion pass · faff.run historical-data forensic audit · 2026-09-09

**What this file is.** `domain-B-cohort.md` (v1) delivered aggregate canonical/absorbed counts and five hand-picked named cases (5.1–5.5), plus one deep trace of the current day's run. It never produced the thing the brief actually asked for: **every canonical run in the 14-day cohort, individually**, and **quantified, queried counts across a full data-quality category list**. This pass does both, against RUNNER_DAVID's real production data, read-only. It does not repeat today's (2026-09-09) run's own phase-level detail — that is already fully covered in v1 §6, the final handback §2.3/§9, and both independent reviewer passes; this file references it rather than re-deriving it.

**Read-only mandate.** No writes issued. Connected as `faff_readonly` (confirmed via `select current_user`). No production fixes performed — findings below that describe defects are described for a later engineering pass, not corrected here.

**Commits.** Two pins are in play. `8559245496bf498d3d4b0479e1117ae416988c4a` (2026-09-09 14:36:10 -0700) is the audit's original pin. `ae91e30668df7e14b1279cb6e4d20db87de5250e` (2026-09-09 18:15:37 -0700) is the commit the task handed me as "origin/main, moved." I independently re-fetched at the start of this pass and found **origin/main has moved a third time, to `80fca013f94b99ee5af3f84e79590591d42141da`** (this repo's own current `HEAD`, confirmed identical to `origin/main` via `git rev-parse`). Both `8559245` and `ae91e30` are ancestors of `80fca013`. Every `[SOURCE]` citation below is read via `git show <SHA>:<path>` against `8559245496bf498d3d4b0479e1117ae416988c4a` specifically (matching the original audit's pin, for continuity with the other three domain reports), and I separately re-checked every load-bearing citation against `HEAD` (`80fca013f9...`) to confirm the cited lines are unchanged at the current tip — stated per-citation below where it matters, and unremarked where it doesn't (i.e., identical at both).

**User.** RUNNER_DAVID, resolved via `users.email` → `users.id`. Used freely in queries below; never written in plain text per the task's pseudonymization instruction.

**Window.** `2026-08-26` through `2026-09-09` inclusive, by the runner's own local calendar date (`data->>'date'`, see the methodology finding in §0 below) — 15 calendar dates, called "the 14-day cohort" throughout this audit for continuity with v1's own naming; I did not shrink the window to match the label.

---

## §0. A methodology finding that changes what "the 14-day cohort" even contains

Before the per-run table: **the obvious way to window this query is wrong, and it is wrong in a way that would have silently dropped two of the thirteen canonical runs — including one half of the audit's own most-cited named case.**

`[PROD-QUERY]` Filtering canonical rows by `(data->>'startUtc')::timestamptz` between the two dates returns **11 rows**. Filtering the identical population by `data->>'date'` (a plain `YYYY-MM-DD` string, present on every row) returns **13 rows**. The two missing rows are both `source = 'treadmill'`:

```sql
select data->>'source', data ? 'startUtc' as has_start_utc, data ? 'startLocal' as has_start_local, data ? 'date' as has_date
from runs where user_uuid = '<uuid>' and NOT (data ? 'mergedIntoId')
group by 1;
```
```
    source    | has_start_utc | has_start_local | has_date
 apple_health |      2 of 14  |     14 of 14     |  14 of 14
 apple_watch  |     18 of 21  |     21 of 21     |  21 of 21
 treadmill    |      0 of 8   |      8 of 8      |   8 of 8
 watch        |     46 of 49  |     49 of 49     |  49 of 49
 (blank)      |      0 of 70  |     70 of 70     |  70 of 70
```

`treadmill`-sourced canonical rows carry **zero** `startUtc` keys, account-wide, not just in this window (`[PROD-QUERY]`, confirmed by direct key-presence check on a sample row: `has_startutc_key: f`, `start_local: "2026-09-03T17:25:18"`, `date: "2026-09-03"`). `data->>'date'` is the one date field populated on 100% of canonical rows regardless of source, so it is the only safe windowing key. This is not a hypothetical — it is exactly what happened to v1's own named Case 5.2 (the 09-03 dual-run tie-break): the `apple_watch` sibling (4.48 mi) survives a `startUtc`-windowed query, but its `treadmill` counterpart (4.71 mi, the one carrying the 21-phase HR-flatline detail Case 3 is built on) does not. v1 got both into its named-case prose because a named case is hand-picked, not systematically windowed — which is exactly the gap this completion pass exists to close. **Any future query that windows this table by `startUtc` will silently under-count treadmill sessions.** I flag this for whoever owns the ingest schema as worth a comment in `run-shape.ts` or a lint rule, not something I am fixing here.

The two recovered rows:

| id | date | source | distance | plan_workout_id |
|---|---|---|---|---|
| `-75039485987228` | 2026-08-27 | treadmill | 3.14 mi | *(none)* |
| `-240375143823562` | 2026-09-03 | treadmill | 4.71 mi | `wko_7afeef3d8f439088` |

---

## PART 1 — the per-run truth table

13 canonical rows, `NOT (data ? 'mergedIntoId')`, `data->>'date'` between `2026-08-26` and `2026-09-09` inclusive, RUNNER_DAVID. `[PROD-QUERY]` for every field below unless separately tagged.

### 1.1 Summary table

| # | Date | Run ID | Source | Distance (actual) | Duration | Plan-matched? | Tier |
|---|---|---|---|---|---|---|---|
| 1 | 08-26 | `-89674653468297` | watch | 7.78 mi | 4135 s | LEGACY (type only) | LEGACY |
| 2 | 08-27 | `-75039485987228` | treadmill | 3.14 mi | 1716 s | no | SUPPLEMENTAL |
| 3 | 08-28 | `-255291701482225` | watch | 6.32 mi | 3205 s | LEGACY (type only) | LEGACY |
| 4 | 08-30 | `-245190372869167` | watch | 13.49 mi | 6383 s | `wko_280c00bdcd4d56ba` | EXACT |
| 5 | 08-31 | `-41598809443969` | apple_watch | 6.18 mi | 3095 s | `wko_0f1aa86a6ab11c82` | EXACT |
| 6 | 09-01 | `-258355938987883` | watch | 8.50 mi | 4103 s | `wko_470a1327c80a75c3` | EXACT |
| 7 | 09-02 | `-145861381014809` | watch | 6.41 mi (repaired) | 3349 s | `wko_97a84cd44d93029f` | EXACT |
| 8 | 09-03 | `-166065474720154` | apple_watch | 4.48 mi | 2234 s | `wko_7afeef3d8f439088` | EXACT |
| 9 | 09-03 | `-240375143823562` | treadmill | 4.71 mi | 2563 s | `wko_7afeef3d8f439088` (**same as #8**) | EXACT |
| 10 | 09-04 | `-100975291972118` | watch | 15.51 mi | 8027 s | `wko_ff129cc011aae496` | EXACT |
| 11 | 09-07 | `-3581443162664630` | apple_watch | 5.01 mi | 2369 s | no (rest day) | SUPPLEMENTAL |
| 12 | 09-08 | `-75144899844434` | watch | 6.46 mi | 2994 s | `wko_1cf8cd95971f2226` | EXACT |
| 13 | 09-09 | `-218380344929823` | watch | 5.58 mi | 2947 s | `wko_d19936ca5659c63b` | EXACT |

Tier definitions per `[SOURCE]` `web-v2/lib/execution/day-resolver.ts:20-52` (8559245): **EXACT** = `data.planWorkoutId` names the actual prescription row; **LEGACY** = `data.workoutType`/`workoutTypeSource='plan'` matches the day's single non-rest prescription by type, with no durable id; **SUPPLEMENTAL** = neither — "a real run that happened... that never seals, completes, or grades a prescription it was not shown to have executed." I computed each row's tier myself from the fields below (not read off a stored tier field — there isn't one; `day-resolver.ts` resolves this live, at read time, from exactly the fields this table reports).

### 1.2 Absorbed-sibling census (same-day duplicates)

`[PROD-QUERY]`, querying `runs` for each cohort date with no canonicality filter, cross-checked against `absorbed_into_canonical_at`/`mergedIntoId`:

| Date | Canonical row(s) | Absorbed siblings same day |
|---|---|---|
| 08-26 | 1 (`-89674653468297`) | 2 — `apple_watch -1025521426633531`, `strava_webhook 19980656567` |
| 08-27 | 1 (`-75039485987228`) | 1 — `treadmill -8119127077267` |
| 08-28 | 1 (`-255291701482225`) | 2 — `apple_watch -3245870319477311`, `strava_webhook 19943143897` |
| 08-30 | 1 (`-245190372869167`) | 2 — `apple_watch -16421941758764`, `strava_webhook 19966462921` |
| 08-31 | 1 (`-41598809443969`) | 1 — `strava_webhook 19981296070` |
| 09-01 | 1 (`-258355938987883`) | 2 — `apple_watch -1661591963635005`, `strava_webhook 19998028774` |
| 09-02 | 1 (`-145861381014809`) | 1 — `apple_watch -2389606254281740` |
| **09-03** | **2** (`-166065474720154`, `-240375143823562`) | **0 — neither is absorbed into the other; both remain independently canonical** |
| 09-04 | 1 (`-100975291972118`) | 2 — `apple_watch -2243022732787187`, `strava_webhook 20034881664` |
| 09-07 | 1 (`-3581443162664630`) | 0 |
| 09-08 | 1 (`-75144899844434`) | 2 — `apple_watch -3968321712313549`, `strava_webhook 20097544348` |
| 09-09 | 1 (`-218380344929823`) | 2 — `apple_watch -2351291349937081`, `strava_webhook 20109710013` |

09-03 is the one date in the cohort with two *independently canonical* rows rather than a canonical-plus-absorbed set — that is v1's Case 5.2, confirmed exact by me again below (§1.5) and now correctly counted as part of a systematic sweep rather than a hand-picked highlight.

### 1.3 Match method and confidence — two different matchers, cited by name, applied per row

There is not one matcher in this codebase. There are **two, independently coded, using different distance bands**, and which one a given row went through is fully determined by its source:

- **`web-v2/app/api/watch/workouts/complete/route.ts:648-660`** (8559245) — the route the app's own comment calls "the ONLY place that ever stamps `planWorkoutId`... live since 2026-09-03" (`WORKOUT-EXECUTION-ID-1`). Queries the active plan's non-rest `plan_workouts` for the date, keeps candidates within a **symmetric ±30% band** (`totalMi >= plannedMi*0.7 && totalMi <= plannedMi*1.3`, inline, lines 652-654), and on a tie picks the **closest by absolute delta** — it does not refuse on ambiguity. Reached by `watch`, `apple` phone-GPS, and `treadmill` sources per its own comment.
- **`web-v2/app/api/ingest/workout/route.ts:250-280`, matcher extracted to `web-v2/lib/runs/plan-type-stamp.ts`** (8559245) — queries the same table the same way, but keeps candidates within an **asymmetric [0.7×, 2.0×] band** (`distanceMatchesPlan`, `plan-type-stamp.ts:39-42`), and **refuses to stamp anything if more than one candidate survives** ("AMBIGUITY IS REFUSED, NOT GUESSED," lines 246-250). This is the OVERRUN-MATCH-1 band, the fix for exactly the 08-31 overrun case named below.

`[SOURCE]`, confirmed on both files, and confirmed unchanged at `HEAD` (`80fca013`) — `watch/workouts/complete/route.ts:731` still reads `totalMi >= plannedMi * 0.7 && totalMi <= plannedMi * 1.3`, hardcoded inline, never importing `distanceMatchesPlan`. **This is a live, present-tense instance of the exact defect class `OVERRUN-MATCH-1` fixed in one matcher and never propagated to the other** — the same class of side-door duplication Domain C's report already caught once in this codebase (`RUNNER_AUTHORITY_TIERS`, duplicated verbatim in two files). I did not find a test that would catch a second widening of one band without the other; that is worth a line in a later engineering pass.

Applying this per row:

| # | Row | Prescription that day | Band used | Ratio (actual/plan) | Result |
|---|---|---|---|---|---|
| 1 | 08-26 | `easy 7 mi` | (LEGACY-era type stamp, pre-dates `planWorkoutId` stamping entirely — see §1.4) | 7.78/7 = 1.11 | matched by type, single candidate |
| 2 | 08-27 | `easy 7 mi` | either band | 3.14/7 = 0.45 | **below both floors — correctly refused, not a bug** |
| 3 | 08-28 | `easy 7 mi` | (LEGACY-era, see §1.4) | 6.32/7 = 0.90 | matched by type, single candidate |
| 4 | 08-30 | `long 13 mi` | watch-complete, ±30% | 13.49/13 = 1.04 | single candidate, in band |
| 5 | 08-31 | `easy 4.5 mi` | ingest/workout, [0.7,2.0] | 6.18/4.5 = **1.37** | **outside the ±30% band, inside [0.7,2.0]** — this is v1's Case 5.1, exactly, confirmed again |
| 6 | 09-01 | `threshold 8.5 mi` | watch-complete, ±30% | 8.5/8.5 = 1.00 | exact |
| 7 | 09-02 | `easy 5 mi` | watch-complete, ±30% (matched pre-repair, see manual-correction note §1.6) | 6.41/5 = 1.28 (post-repair) | within 1.3 ceiling either way |
| 8 | 09-03 apple_watch | `intervals 6 mi` | ingest/workout, [0.7,2.0] | 4.48/6 = 0.75 | in band |
| 9 | 09-03 treadmill | `intervals 6 mi` (**same prescription as #8**) | watch-complete, ±30% | 4.71/6 = 0.79 | in band |
| 10 | 09-04 | `long 15 mi` (current; `original_distance_mi=7.5`, see §1.4) | watch-complete, ±30% | 15.51/15 = 1.03 (against current); 15.51/7.5 = 2.07 (against original) | matched against the CURRENT authored distance |
| 11 | 09-07 | `rest` (0 mi, excluded from candidates by both matchers' `type NOT IN ('rest')` clause) | — | n/a | **zero non-rest candidates — correctly unmatched by design, not a bug** |
| 12 | 09-08 | `tempo 6.2 mi` | watch-complete, ±30% | 6.46/6.2 = 1.04 | in band |
| 13 | 09-09 | `easy 5 mi` | watch-complete, ±30% | 5.58/5 = 1.12 | in band (already covered in depth elsewhere) |

**Row #9 / #8 is genuinely a "multiple canonical runs matching one prescription" case**, not a merge/absorption relationship — both are independently canonical, both carry the identical `planWorkoutId`, and which one the app *shows* for that day is decided at read time by `day-resolver.ts`'s richness tie-break (`richer()`/`pickRichest()`, phase-count → split-count → distance order; v1's own Case 5.2, re-confirmed here as part of the systematic sweep rather than a spot-check).

### 1.4 A provenance question this pass surfaced and could not fully close

`data.planWorkoutId` is present on rows #4, #5, #6, #7 (08-30, 08-31, 09-01, 09-02) — **all four dated before `WORKOUT-EXECUTION-ID-1`'s own comment says the writing mechanism went live** ("2026-09-03") and before `OVERRUN-MATCH-1`/`EXECIDENT-2`'s comments (dated 2026-09-04) landed the *other* writer (`ingest/workout/route.ts`) that also stamps this field. Every one of these four rows' `planWorkoutId` therefore cannot have been written at original ingestion time by the mechanism whose own header comment claims to be the writer — the comment and the data disagree on when this is possible.

`[PROD-QUERY]` confirms `plan_workouts` `id` is a unique key (count=1 for every id checked) and that all matched ids belong to the CURRENTLY ACTIVE plan (`training_plans.archived_iso IS NULL`), which rules out a stale-plan mismatch as the explanation. `[SOURCE]` confirms neither `ingest/health/route.ts` nor any other route I checked writes this field independent of the two matchers already described. The most consistent explanation available from what I could check: **a retroactive re-ingestion or backfill touched these four canonical rows on or after 2026-09-03**, running the (by-then-live) matcher against already-existing rows and writing the id in after the fact, rather than the field having been present since each run's own original ingest. I did not find a dedicated `/api/admin/backfill-plan-workout-id`-style script (I checked the admin-route and `scripts/` directories for one) to confirm this directly, so I am reporting the pattern and the most consistent explanation as **[INFERENCE]**, not fact — the underlying dates and code are **[SOURCE]**/**[PROD-QUERY]**. This is worth a direct question to whoever owns the ingest pipeline rather than further speculation from a read-only pass: what actually re-touched these four rows.

### 1.5 Per-run detail

For each run: phase/split/route presence, HR/cadence, data-quality flags, grading verdict where determinable, evidence eligibility, and adaptation effect. `[PROD-QUERY]` unless tagged otherwise. Today's run (#13) is deliberately thin here — see the cross-reference.

---

**#1 — 2026-08-26, `-89674653468297`, source `watch`, 7.78 mi / 4135 s, LEGACY tier**

- Phases: **1** (a single unsegmented "work" phase, not a structured multi-phase session). Splits: **7** (per-mile). Route: **yes** (`startLatLng`, `summaryPolyline` both present).
- HR: **yes** — avg 138 / max 147 bpm, 564 raw samples on the one phase, 33 distinct values. Cadence: **yes** — avg 166 spm (plausible). Elevation: **2807 ft over 7.78 mi = 360.8 ft/mi**, `elevGainSource: "absent"`.
- **Data-quality flag — elevation provenance contradiction.** `[SOURCE]` `web-v2/lib/runs/elev-sanity.ts:100-206` (8559245): every branch of `sanitizeElevGain()` that returns `source: 'absent'` also returns `value: null` — there is no code path in this function that pairs a populated `elevGainFt` with `source: 'absent'`. This row's ft/mi (360.8) is well over the function's own `SUSPICION_THRESHOLD_FT_PER_MI = 250` (line 108), which is exactly the shape `sanitizeElevGain` exists to null out. `[PROD-QUERY]` confirms this exact pairing recurs on **8 of 162 canonical rows account-wide**, one of them this row. A companion test file, `emptyish-erase.test.ts` (8559245, lines 23-113), describes precisely this failure mode by name — a merge that preserves an existing numeric field while a later write only updates its provenance tag — which is the same Rule-6 shape (multi-writer jsonb field preservation) CLAUDE.md's own registry already tracks for `splits` and `actual_result`, applied here to a *pair* of fields (`elevGainFt`/`elevGainSource`) rather than one. I have not traced the exact write sequence that produced this specific row (that would need the row's full write history, not a point-in-time read), so I report the code-level contradiction as `[SOURCE]`, the row's stored state as `[PROD-QUERY]`, and the causal mechanism as `[INFERENCE]` consistent with the test file's own worked scenario — worth a direct engineering look, not a re-derivation here.
- Splits validation: `splits_unreliable: false`, `deltaS: -451s` (of 4144s elapsed vs 3693s split-sum, 8 splits "dropped" in the reconciliation check but flagged reliable regardless — see Part 2 §2.9 for the account-wide read on this field).
- **Grading verdict (stored, not re-derived by me):** the single phase carries `"verdict": "missed"`, `"completed": true`, `"timeInToleranceSec": 10`, `"timeOutOfToleranceSec": 2805` — i.e. essentially the entire recorded phase (2805 of 2920s, 96%) sat outside its pace tolerance. `targetPaceSPerMi: 602` (10:02/mi) vs. `actualPaceSPerMi: 531` (8:51/mi) — **the runner ran 71 s/mi FASTER than the target, not slower.** On an easy day this reads as exceeding an easy-pace ceiling, not falling short of a floor — `"missed"` here means "ran too hard for an easy day," the opposite of the intuitive reading of the word. `[SOURCE]`+`[PROD-QUERY]`, direct field read, not a computation I performed.
- **Evidence eligibility:** distance ≥ 4mi ✓; `workoutType='easy'` is not in `QUALITY_RUN_TYPES` (`web-v2/lib/training/vdot.ts:669-671`, 8559245) but avg/max HR ratio = 138/147 = 0.939 ≥ the 0.80 hard-effort floor → **passes `passesRunHonestyGate` via the HR path, despite being a nominal "easy" day** — consistent with the verdict above (this really was run at hard effort for an easy prescription). HR trace is credible (33 distinct values across 564 samples on the one work phase — no flatline).
- **Adaptation effect, same day:** `[PROD-QUERY]` `coach_intents` carries 6 `watch_heat_easing` rows this date (heat-adjustment intent, distinct from this run's own pace behaviour). More materially: `plan_proposals` id=55, `easy_drift`/`auto_applied`, `source='drift_cron_auto'`, timestamped **2026-08-26 09:34:46 UTC = 02:34 PDT — before this run started (06:20 PDT)**. Its own payload: `"Your easy days are running 4 mi but the plan is asking for 7 mi"`, `direction: "DOWN"`, `pct_drift: -42.9`, `actual_median_mi: 4`. Two things worth flagging together: (a) this drift computation could not have included this run (it fired before the run started), and (b) the cohort's own easy-day runs this window (7.78, 6.32, 6.18, 6.41 mi — median ≈6.25mi) do not resemble the "4 mi" the drift cited as the runner's actual median at all. This auto-applied a **downward** volume adjustment (`new_plan_id: pln_0e635603799fd7b1`) the same morning the runner then ran a 7.78-mile easy day, nearly double the drift's own stated premise. I did not trace what window fed the drift's "4 mi" figure (out of scope for this pass — flagging it, not resolving it), but the juxtaposition is real and dated.
- **UI surfaces (structural, source-based, not rendered):** LEGACY tier with `workoutTypeSource: 'plan'` → the Activity/history list and, per `day-resolver.ts`, the Plan/Week view's day cell for 08-26 (shown as completing that day's easy prescription by type, without the durable EXACT-tier badge). Not the Today tab (not today's date at query time).

---

**#2 — 2026-08-27, `-75039485987228`, source `treadmill`, 3.14 mi / 1716 s, SUPPLEMENTAL**

- Phases: **1**, unsegmented. Splits: **3**. Route: **no** (treadmill — GPS fields structurally absent, expected, not a defect).
- HR: **yes** — avg 121 / max 129, 241 samples, only **2 distinct bpm values** across the whole phase. This is *not* a flatline by the codebase's own `hrTraceIsCredible` predicate (distinct must equal exactly 1 to fire), but it is a strikingly low-variance trace for a 28-minute run — worth naming as a borderline case the guard's binary predicate does not catch, not itself a scored finding.
- Cadence: **no** (`avgCadence` key absent — treadmill rows in this cohort never carry it; see Part 2 §2.6).
- Elevation: 106 ft, source `treadmill_incline` (33.8 ft/mi — plausible for an incline session, no contradiction).
- Data-quality flags: none beyond the missing cadence/route (both structural to the source, not anomalies).
- **Grading verdict:** no `verdict` field on the phase at all, and `completed: false`. Consistent with SUPPLEMENTAL tier — this run was never matched to a prescription (3.14mi vs. the day's 7mi easy prescription, ratio 0.45, below both matchers' floor), so nothing graded it against a target.
- **Evidence eligibility:** distance 3.14mi < the vdotFromRun 4mi floor → **not VDOT-eligible on distance alone**, regardless of type or HR ratio (`passesRunHonestyGate`, `web-v2/lib/training/vdot.ts:895-905`).
- **Adaptation effect, same day:** `plan_proposals` — `easy_drift`/`no_change`, `source='drift_cron_auto'` (a drift check ran and found nothing to change). No `coach_intents` reason rows beyond `watch_completion`.
- **UI surfaces:** Activity/history only (SUPPLEMENTAL, no type stamp at all — `workoutTypeSource` is null). Not the Plan/Week day cell in any completing capacity, per `day-resolver.ts`'s own rule that SUPPLEMENTAL never completes a prescription.

---

**#3 — 2026-08-28, `-255291701482225`, source `watch`, status `abandoned`, 6.32 mi / 3205 s, LEGACY tier**

- Phases: **1**. Splits: **6**, but `splits_unreliable: true` (the ingest-time reconciliation check flagged this row's splits, `deltaS: -309s`, `droppedCount: 7` — the one row in the cohort carrying this flag; see Part 2 §2.1 for the account-wide read).
- Route: **yes**. HR: **yes** — avg 154/max 172, 624 samples, 62 distinct (credible, not flatlined). Cadence: **yes**, 158 spm. Elevation: 157 ft, `gps_derived`, 24.8 ft/mi (unremarkable).
- **Grading verdict:** phase carries `"verdict": "incomplete"`, `"completed": false`, `timeInToleranceSec: 140`, `timeOutOfToleranceSec: 2975` — consistent with the run-level `status: 'abandoned'`.
- **Evidence eligibility:** distance 6.32≥4 ✓; type `easy` (not quality) but HR ratio 154/172=0.895≥0.80 → passes the honesty gate via the HR path. HR trace credible.
- **Adaptation effect, same day:** `plan_proposals` — `easy_drift`/`superseded` (a pending drift proposal was superseded before acting) and `goal_renegotiation`/`expired` (a goal-renegotiation offer from `goal_gap_cron` expired unactioned).
- **UI surfaces:** LEGACY-tier completion badge on the day cell despite `status:'abandoned'` — worth flagging structurally: the type-stamp mechanism runs independent of the run's own abandonment status, so a day that the runner abandoned mid-run can still show as having completed that day's easy-type prescription by type-match alone. Whether the *rendered* card also carries the abandoned/incomplete framing is a `[RENDER]`-level question this pass did not attempt (no simulator build performed).

---

**#4 — 2026-08-30, `-245190372869167`, source `watch`, 13.49 mi / 6383 s, EXACT tier (`wko_280c00bdcd4d56ba`, plan long-run day, 13 mi)**

- Phases: **1**, unsegmented (the long run is not broken into warm-up/work/cooldown at the phase level, unlike the structured quality sessions elsewhere in the cohort). Splits: **13** per-mile. Route: **yes**.
- HR: **yes** — avg 159/max 179, 1195 samples, 62 distinct (credible). Cadence: **yes**, 162 spm. Elevation: 230 ft, `gps_derived`, 17.0 ft/mi.
- **Grading verdict:** phase `"verdict": "missed"`, `completed: true`, `timeInToleranceSec: 535`, `timeOutOfToleranceSec: 5435` — **5435 of 5970s (91%) of the graded window sat outside tolerance.** Average pace 457 s/mi (7:37/mi) for a 13.49-mile long run is fast; this is the same shape as run #1 — a long run that, by pace, substantially exceeded whatever ceiling the long-run target carried, and is recorded as "missed" rather than as evidence the current long-run pace band is conservative. Contrast directly with run #10 (09-04, another long run, verdict `"hit"`) — the cohort contains one long run marked hit and one marked missed for materially the same shape of overperformance, which is worth a side-by-side look by whoever owns the pace-band logic rather than treating either in isolation.
- **Evidence eligibility:** distance≥4 ✓; type `long` (not in QUALITY_RUN_TYPES) but HR ratio 159/179=0.888≥0.80 → passes via HR path. HR trace credible. **Not durability-evidence-eligible**, however — `[SOURCE]` `web-v2/lib/training/durability-anchor.ts`'s `loadRaceObservationsForDurability()` (8559245, line 644) sources its Riegel-exponent fit **exclusively from the `races` table**, not from training long runs. This training long run, however large or well-executed, is structurally outside the mechanism the codebase actually calls "durability" evidence — a real, useful negative result for this row, worth stating outright rather than leaving implied.
- **Adaptation effect, same day:** the busiest day in the cohort for adaptation machinery — `coach_intents`: `coach_log_lthr_reanchor` + `lthr_auto_calibrated` (an LTHR re-anchor event, same day as this long run); `plan_proposals`: `easy_drift`/`superseded`, `goal_outlook`/`superseded`, `race_goal_framing`/`pending`, `race_role`/`pending`, `recovery_complete`/`auto_applied`. I did not trace whether the LTHR re-anchor consumed this specific run's HR data as input (that would require reading `lthr-reanchor.ts`'s own window logic, out of scope for a per-run table) — flagging the same-day coincidence as fact, not asserting causation.
- **UI surfaces:** EXACT-tier badge on the day cell; Activity/history.

---

**#5 — 2026-08-31, `-41598809443969`, source `apple_watch`, 6.18 mi / 3095 s, EXACT tier (`wko_0f1aa86a6ab11c82`, plan easy day, 4.5 mi) — v1's Case 5.1, re-confirmed**

- Phases: **0** (no `phases` array at all on this row — the app-side phase-segmentation only fires for `watch`/`treadmill`-sourced ingests via the completion route; this row came through the general ingest path). Splits: **7**. Route: **yes**.
- HR: **yes** (run-level only, no per-phase samples to test for flatline) — avg 147/max 164. Cadence: **yes**, 162 spm. Elevation: 168 ft, `raw`, 27.2 ft/mi.
- **Grading verdict: not determinable.** No phases array → no stored per-phase verdict, and the session-level `sessionLadder`/`gradeSession` machinery (`execution-semantics.ts`) requires a phase list as input — there is nothing to feed it for this row. `[BLOCKED: no phases array on this row; the grading mechanism has no input to grade]`.
- **Evidence eligibility:** distance≥4 ✓; type `easy` but HR ratio 147/164=0.896≥0.80 → passes via HR path. **HR-flatline check `[BLOCKED]`**: `workTraceIsCredible` needs per-phase `hrSamples`; this row has none, so the guard cannot fire either way — it is neither confirmed credible nor flagged, simply unable to be asked.
- **Adaptation effect, same day:** `coach_intents` — `coach_log_week_close` (a week-close event, unrelated to this specific run's overrun).
- **UI surfaces:** EXACT-tier badge. This is the run David is directly quoted about in-code (`route.ts:213-228`, "Mondays run did match it just went longer") — a `[SOURCE]`-confirmed instance of the runner's own contemporaneous reaction to seeing this exact match resolve correctly.

---

**#6 — 2026-09-01, `-258355938987883`, source `watch`, 8.50 mi / 4103 s, EXACT tier (`wko_470a1327c80a75c3`, plan threshold day, 8.5 mi)**

- Phases: **9** (warmup / 4× 1-mile interval / 3× 1-min jog recovery / cooldown — `rep_count: 4`, `rep_rest_s: 60` per `workout_spec`). Splits: **8**. Route: **yes**.
- HR: **yes**, run-level avg 154/max 172; per-phase samples present on every phase (211/83/12/84/13/83/13/82/218 samples across the 9 phases). Work-phase distinct-bpm counts: 12, 13, 15, 20 — **no flatline** (all comfortably above 1 distinct value). Cadence: **yes**, 170 spm. Elevation: 786 ft, source `watch`, 92.5 ft/mi (the highest ft/mi in the cohort among non-treadmill rows, but below the 250 ft/mi suspicion threshold — not flagged, correctly).
- **Recovery-honesty sub-check (`recoveriesHonestOf`, `execution-semantics.ts:693-710`, 8559245):** recovery actual durations 61/64/64s against `rep_rest_s=60`; tolerance is `60×0.5=30s`; deltas 1/4/4s — **all pass, well inside tolerance.**
- **Per-phase verdicts (stored):** warmup `hit`; 3 of 4 work intervals `drifted`; 1 work interval `missed`; cooldown `missed`. Recoveries carry no verdict field (recoveries don't vote in `gradeSession`, per its own doc comment — `execution-semantics.ts:655-658`). This is a genuinely mixed session: not a clean pass, not a clean fail, three different verdict values across four graded work reps.
- **Evidence eligibility:** distance≥4 ✓; type `threshold` is in `QUALITY_RUN_TYPES` → passes on type alone, HR ratio (154/172=0.895) also clears the floor independently. HR trace fully credible.
- **Adaptation effect, same day:** none beyond `watch_completion` in `coach_intents`; no `plan_proposals`/`plan_mutations` rows this date.
- **UI surfaces:** EXACT-tier badge; Activity/history; the mixed per-rep verdicts (hit/drifted/missed) are exactly the kind of structured-workout detail v1/final-handback's §9 discussion of `sectionPieces` concerns — this run would be a second, independent test case for that same open rendering question, not examined by any of the four domain passes.

---

**#7 — 2026-09-02, `-145861381014809`, source `watch`, 6.41 mi / 3349 s (post-repair), EXACT tier (`wko_97a84cd44d93029f`, plan easy day + strides, 5 mi) — the WALKBACK-1/2 repair case, re-confirmed and extended**

- Phases: **13** (5mi easy + 6× stride/walk-back pairs). Splits: **5**. Route: **no** (`manualCorrection.note` confirms this explicitly: *"routePolyline, elevGainFt, avgCadence and kcal were never captured for this run"* — except avgCadence and elevGainFt ARE in fact present at the run level per the field dump below, which the correction note itself did not anticipate — see the flag immediately below).
- **A second, smaller data-quality flag inside the already-known repair.** `[PROD-QUERY]`: this row carries `avgCadence: 158` and `hrZonePcts` populated, despite `manualCorrection.note` (written 2026-09-02, quoted in full in v1 and the final handback) stating *"avgCadence and kcal were never captured for this run."* `avgCadence` is in fact present (158 spm). I did not check `kcal` specifically (out of scope creep from the original ask), but the cadence half of that sentence does not hold against the current row. This is a small, second-order inaccuracy inside a repair note that both prior passes quoted verbatim without checking its individual clauses against the row it describes — worth a one-line correction to the note, not a re-repair.
- HR: **yes**, run-level avg 139/max 163; per-phase samples on all 13 phases (main phase 510 samples/43 distinct; stride phases 4-5 samples each, below the `MIN_SAMPLES_TO_JUDGE=5` floor on 4 of 6 — sparse, correctly treated as "not enough to judge" rather than flatlined; the two strides with ≥5 samples show 5 and 3 distinct values, not flatlined either). **No HR flatline anywhere in this run.**
- **Recovery-honesty sub-check:** 6 walk-back recoveries, actual durations 60/60/60/59/60/61s against `strides_recovery_s=60`; all within the 30s tolerance trivially (max delta 1s). **Passes.** (Contrast with today's run, #13, where 2 of 6 fail this exact check by a wide margin — see the cross-reference below.)
- **Reconciliation:** phases sum to 5.98 mi / 3057 s; the stored top-level totals are 6.41 mi / 3349 s — **a 0.43 mi / 292 s gap**, exactly the already-documented WALKBACK-1 repair (crash-recovery snapshot totals for post-plan overtime that never entered the `phases` array). Fully re-confirmed, not re-derived.
- **Grading verdict (stored):** main work phase `"hit"` (`timeInToleranceSec: 2090`, `timeOutOfToleranceSec: 455` — mostly in tolerance). Stride phases carry no verdict.
- **Evidence eligibility:** distance≥4 ✓; type `easy` but HR ratio 139/163=0.853≥0.80 → passes via HR path.
- **Adaptation effect, same day:** none beyond `watch_completion` (which itself is the repair's own trigger, per the manual-correction note's citation of fix commits `8196d683a`/`2cd075a9d`).
- **UI surfaces:** EXACT-tier badge; Activity/history; per Rule 8/13's own domain concerns, this is a run whose recorded phases (5.98mi) undercount its true distance (6.41mi) by design, which any UI summing phase distances to check against the header total would surface as a discrepancy — worth naming for whoever eventually builds such a check.

---

**#8 — 2026-09-03, `-166065474720154`, source `apple_watch`, 4.48 mi / 2234 s, EXACT tier (`wko_7afeef3d8f439088`, plan intervals day, 6 mi) — v1's Case 5.2, apple_watch half**

- Phases: **0**. Splits: **5**. Route: **no**.
- HR: run-level avg 140/max 156 (ratio 0.897). Cadence: 161 spm.
- **Grading verdict: `[BLOCKED]`**, same reason as #5 — no phases array.
- **Evidence eligibility:** distance≥4 ✓; type `intervals` is in `QUALITY_RUN_TYPES` → passes on type alone. **HR-flatline check `[BLOCKED]`** — no phases, no per-phase samples.
- **Adaptation effect, same day:** shared with #9 below (both rows share the date) — `plan_proposals`: `goal_outlook`/`pending`, and **`silent_rebuild`/`auto_applied`** (see #9 for full detail — this is the more consequential of the two same-day findings).
- **UI surfaces:** EXACT tier, but **not the one `day-resolver.ts` shows** — see #9.

---

**#9 — 2026-09-03, `-240375143823562`, source `treadmill`, 4.71 mi / 2563 s, EXACT tier (`wko_7afeef3d8f439088`, **same prescription as #8**) — v1's Case 5.2, treadmill half AND v1's/Domain-C's Case 3 (HR flatline), now fully re-verified across every phase**

- Phases: **21** (warmup / 10× hill-work-and-jog-recovery pairs / cooldown). Splits: **4**. Route: **no** (treadmill).
- HR: run-level avg 129/max 163 (ratio **0.791 — below the 0.80 honesty-gate HR floor**). Per-phase samples present on all 21 phases.
- **Data-quality flag — HR flatline, confirmed on all 10 work phases, independently re-derived (not re-quoted) using the codebase's own exact predicate.** `[SOURCE]` `web-v2/lib/adaptation/canonical/hr-trace-credibility.ts:60-70` (8559245): `hrTraceIsCredible` fires when a phase has ≥5 usable samples and exactly 1 distinct bpm value. I computed distinct-bpm and sample counts directly from `data.phases[].hrSamples` for every phase of this run:

  | Hill rep | n samples | distinct bpm | Flatlined? |
  |---|---|---|---|
  | 1 | 18 | 1 | **yes** |
  | 2 | 18 | 1 | **yes** |
  | 3 | 17 | 1 | **yes** |
  | 4 | 15 | 1 | **yes** |
  | 5 | 18 | 1 | **yes** |
  | 6 | 19 | 1 | **yes** |
  | 7 | 15 | 1 | **yes** |
  | 8 | 17 | 1 | **yes** |
  | 9 | 15 | 1 | **yes** |
  | 10 | 11 | 1 | **yes** |

  **All 10 of 10 work phases are flatlined** — exactly reproducing Domain B/C's cited Case 3, now checked against every phase rather than the handful the original narrative named, with the same result. `workTraceIsCredible` fires on the first flatlined work phase it sees, so this session's whole HR trace is **not credible** by the codebase's own guard.
- **The concrete VDOT-eligibility consequence, traced and not merely asserted.** `[SOURCE]` `web-v2/lib/training/vdot.ts:895-905` (`passesRunHonestyGate`): this run's HR ratio (0.791) alone would FAIL the honesty gate's HR path — but `workoutType='intervals'` is in `QUALITY_RUN_TYPES`, and the gate is an OR: type-quality alone is sufficient regardless of HR. **This run is `vdotFromRun`-eligible purely on its workout-type label, independent of its known-flatlined HR.** Separately, `[SOURCE]` `web-v2/lib/evidence/classify-evidence.ts:566-576`: the `flatlinedTelemetry` context tag this run would carry (`present`, i.e. flagged) feeds `web-v2/lib/plan/adjudication/dose-responsive.ts:1074-1080`'s credibility count for the ADAPTATION progression pipeline specifically — a different consumer than `vdotFromRun`. So: **the flatline guard would correctly exclude this run's HR from the dose-responsive progression signal, but has no bearing at all on whether this run's pace×duration is read as VDOT evidence**, because `vdotFromRun`'s own gate never calls `hrTraceIsCredible`/`workTraceIsCredible` at any point I could find. This sharpens Domain C's own finding ("LTHR/readiness do not consume the flatline guard") by naming a *second* mechanism — VDOT itself — that also does not, for a reason specific to this run: its `intervals` type label makes the HR check moot to that one pipeline in the first place.
- **Recovery-honesty sub-check:** 9 jog-recovery phases (between 10 hill reps), `rep_rest_s=120`; actual durations 120/120/120/120/121/121/121/121/121s; deltas ≤1s against a 60s tolerance. **Passes cleanly** — this session's execution-honesty verdict is not blocked by the recovery check, only by the (unrelated) HR-trace guard.
- **Grading verdict (stored):** **no `verdict` field on any of this run's 21 phases**, unlike every other structured session in the cohort (runs #6, #7, #12, and today's #13 all carry per-phase verdicts). `completed: true` on 20 of 21 phases; the cooldown is `completed: false`. I did not find the reason no verdict was computed for this specific session in the time available — flagging as an open gap (`[BLOCKED: cause not traced]`) rather than guessing whether it is source-specific (treadmill), type-specific (hills/intervals), or a one-off.
- **Adaptation effect, same day (shared with #8):** `plan_proposals` id=65, `silent_rebuild`/`auto_applied`, `source='silent_rebuild_dispatch'`, `trigger: 'operator_dispatch'`, timestamped 2026-09-03 18:43 UTC. Payload: *"The plan engine was updated · your block was rebuilt around the same goal. Undo puts the old block back."* `new_plan_id: pln_7636bcc0a201bf2d` — **which `[PROD-QUERY]` confirms is the CURRENTLY ACTIVE plan** (`training_plans.archived_iso IS NULL`, re-checked directly, not inferred). The plan RUNNER_DAVID is training under today traces its own origin to an engineer-dispatched rebuild landing the same date as this cohort's HR-flatline session, not to a runner-facing or drift-triggered event.
- **UI surfaces:** this is the row `richer()`/`pickRichest()` does **not** select for display (per v1's Case 5.2 tie-break: `-166065474720154` (#8) has 0 phases and loses the phase-count-first tie-break to this row's 21 phases and 4 splits, so `day-resolver.ts` would actually show **this** row, #9, not #8, for 09-03 — worth stating precisely since v1's own prose left the direction of the tie-break implicit). If shown, this is a session whose HR is fully flatlined on every work rep — a direct, present-tense instance of the exact scenario `HRFLATLINE-1`'s own header comment warns about ("a controlled session that was never measured"), on the runner's real account, in the audited window, not a hypothetical.

---

**#10 — 2026-09-04, `-100975291972118`, source `watch`, 15.51 mi / 8027 s, EXACT tier (`wko_ff129cc011aae496`, plan long-run day)**

- Phases: **2** (15mi work + overtime tail). Splits: **15**. Route: **yes**.
- HR: yes, avg 133/max 146 (ratio 0.911). Per-phase samples: work phase 1509/48 distinct (credible); overtime phase 0 samples (too short to carry any). Cadence: yes, 162 spm. Elevation: 162 ft, `watch`, 10.4 ft/mi.
- **Reconciliation:** phases sum to 15.51 mi / 8027 s exactly matching the top-level totals — **clean, no gap.**
- **Planned-vs-actual distance flag.** `plan_workouts.distance_mi = 15`, but `plan_workouts.original_distance_mi = 7.5` — the authored target for this specific row **doubled** at some point between its original authoring and now, by a mechanism I did not trace (`[PROD-QUERY]` confirms `plan_mutations` has zero rows citing this `workout_id`, so it is not the Rule 6-cited positive-drift mutation table; some other repricing/rebuild touched it). Against the *current* 15mi target, this run (15.51mi) is a clean, in-band match (ratio 1.03); against the *original* 7.5mi target, it would be wildly over-band (ratio 2.07). The matcher at ingest time compared against whatever `distance_mi` the database held at that instant, which — given the match succeeded cleanly — was very likely already 15, not 7.5, by the time this run was ingested. Flagging the original/current split as a fact worth a direct question to whoever owns plan repricing, not resolving its cause here.
- **Grading verdict (stored):** work phase `"hit"` (`timeInToleranceSec: 6285`, `timeOutOfToleranceSec: 1255` — majority in tolerance). **Directly contrasts with run #4 (08-30), the cohort's other long run, verdict `"missed"`** — two long runs in the same 14-day window, materially similar in overall pace-vs-target shape by the numbers I could read, landing on opposite stored verdicts. Worth a side-by-side by whoever owns the long-run grading logic.
- **Evidence eligibility:** distance≥4 ✓; type `long` not quality but HR ratio 0.911≥0.80 → passes via HR path. HR trace credible. **Not durability-eligible**, same reasoning as #4 (durability evidence is race-sourced only).
- **Adaptation effect, same day:** none beyond `watch_completion`.
- **UI surfaces:** EXACT-tier badge; Activity/history.

---

**#11 — 2026-09-07, `-3581443162664630`, source `apple_watch`, 5.01 mi / 2369 s, SUPPLEMENTAL (by design — the day's prescription is `rest`, 0 mi, excluded from both matchers' candidate pool)**

- Phases: **0**. Splits: **6**. Route: **no**.
- HR: yes, avg 141/max 161 (ratio 0.876). Cadence: yes, 161 spm. Elevation: 175 ft, `raw`, 34.9 ft/mi.
- **Grading verdict: `[BLOCKED]`** — no phases, and SUPPLEMENTAL tier means there is no prescription to grade against in the first place, independent of the phases question.
- **Evidence eligibility:** distance≥4 ✓; no type label but HR ratio 0.876≥0.80 → passes via HR path alone. **HR-flatline check `[BLOCKED]`** — no phases.
- **Adaptation effect, same day:** none in `coach_intents` beyond `watch_completion`; `plan_workout_proposals` — `hold`/`pending`, dated this day, on a different workout id (not this run's), unrelated to this specific run.
- **UI surfaces:** SUPPLEMENTAL — Activity/history only, correctly never completing a "rest" prescription (there is nothing to complete). This is the cohort's cleanest example of the SUPPLEMENTAL tier working exactly as documented: a real run that happened, on a day the plan asked for nothing, counted toward mileage and nothing else.

---

**#12 — 2026-09-08, `-75144899844434`, source `watch`, 6.46 mi / 2994 s, EXACT tier (`wko_1cf8cd95971f2226`, plan tempo day, 6.2 mi)**

- Phases: **4** (warmup / 3.5mi tempo / cooldown / overtime). Splits: **6**. Route: **no**.
- HR: yes, avg 149/max 166 (ratio 0.898); per-phase samples on all 4 (148/39 distinct warmup, 293/19 distinct tempo work, 116/31 distinct cooldown, 0 overtime). **No flatline anywhere.** Cadence: yes, 171 spm.
- **Reconciliation:** phases sum to 6.45 mi / 2994 s vs. top-level 6.46 mi / 2994 s — 0.01mi rounding only, duration exact. Clean.
- **Data-quality flag — a second instance of the elevGainFt/elevGainSource pairing, but the CORRECT-shaped one.** `elevGainFt` key is **absent** (null), `elevGainSource: "absent"` — this is exactly the paired-null shape `sanitizeElevGain` is supposed to always produce, and does here. Contrast directly with run #1 (08-26), where the same `source:'absent'` tag is paired with a populated `elevGainFt:2807` — the same source tag, two different value pairings, one consistent with the function's contract and one not, both in the same 13-row cohort.
- **Grading verdict (stored):** warmup `hit`, tempo work `hit`, cooldown `hit` — the cohort's one cleanly-all-hit structured session.
- **Evidence eligibility:** distance≥4 ✓; type `tempo` is in `QUALITY_RUN_TYPES` → passes on type alone; HR ratio also independently clears (0.898). HR trace fully credible.
- **Adaptation effect, same day:** `plan_workout_proposals` — `reprice`/`expired`, dated this day (a repricing proposal expired unactioned; I did not trace whether its target workout is this run's own prescription or a different day's).
- **UI surfaces:** EXACT-tier badge; the cohort's cleanest positive contrast case for whatever surface eventually renders per-rep verdicts (nothing to flag, nothing contradictory).

---

**#13 — 2026-09-09, `-218380344929823`, source `watch`, 5.58 mi / 2947 s, EXACT tier (`wko_d19936ca5659c63b`) — today's run**

**Deliberately not re-derived here.** This run's full 14-phase table, its `recoveriesHonestOf` failure (2 of 6 walk-backs — phases 8 and 12 — miss the 30s tolerance by 36s and 52s respectively, denying the `'executed'` verdict under the pinned code), the `routePhases`/`sectionPieces`/`workoutPhasePieces` rendering-mechanism dispute between Domain D's original pass and its own reviewer, and the WALKBACK-2 unmerged-vs-integration-branch status are all already covered in full in v1 §6, the final handback §2.3 and §9, and both independent reviewer passes on Domains A and B. I re-confirmed only what this per-run table's own columns require and did not find in the existing coverage:

- Route: **no** (`startLatLng`/`summaryPolyline` both absent) — this specific field was not itemized in the existing coverage; noted here for completeness of this table's columns.
- HR-flatline check, run independently against this run's own work phases using the exact same predicate as run #9 above: work phase samples 507/48-distinct (main), then 4/2, 5/5, 5/3, 4/4, 5/3, 5/4 across the six stride phases — **none reach 5 samples with exactly 1 distinct value; no flatline on this run**, a clean negative result that directly contrasts with run #9's all-10-flatlined hill session four days earlier.
- **Adaptation effect, same day:** `plan_workout_proposals` — `reprice`/`dismissed`, this is v1's/the final handback's "proposal 13" bundled reprice card, already covered in depth (§9's correction that the bundle's actual anchor-move directions are the reverse of what the original prose stated).
- **UI surfaces:** already the subject of the audit's central open disagreement (§9 of the final handback); nothing new to add from this table's own columns.

---

## PART 2 — data-quality counts, computed for real over the full 13-row cohort

Every count below is queried directly against the 13-row cohort defined in Part 1 (or explicitly against the wider absorbed-sibling population where the category requires it, noted per row). Query given for each. Where v1 already established a definition, I reused it rather than redefining it, and say so.

### 2.1 Missing GPS/route data

```sql
select count(*) filter (where not (data ? 'startLatLng') and not (data ? 'summaryPolyline')) as missing_route,
       count(*) as total
from runs where id in (<13 ids>);
```
**Result: 7 of 13 (54%) missing both `startLatLng` and `summaryPolyline`.** Of those 7, **2 are treadmill** (source-structural, GPS genuinely inapplicable — #2, #9) and **5 are outdoor watch/apple_watch runs with no route captured despite being GPS-capable sources** (#7, #8, #11, #12, #13). That is **5 of 11 outdoor canonical runs in the cohort (45%)** missing route data — a real, non-trivial gap, not an artifact of the treadmill rows. I did not trace why route capture failed on these 5 specifically (would require the ingest payload's own logs, out of scope here).

### 2.2 Missing pace (stored field vs. derivable)

```sql
select count(*) filter (where data->>'paceSPerMi' is null) as missing_stored_pace,
       count(*) filter (where data->>'distanceMi' is null or data->>'durationSec' is null) as missing_derivable_pace
from runs where id in (<13 ids>);
```
**Result: 6 of 13 missing the stored `paceSPerMi` field** (#2, #7, #8, #9, #11, #13). **0 of 13 missing derivable pace** — every row has both `distanceMi` and `durationSec` populated, so pace is always computable even when not stored as its own field. Reporting both numbers because they answer different questions; the stored-field gap is real but not itself a data-quality defect if every consumer computes pace from distance/duration rather than reading the (frequently absent) dedicated field — I did not check which consumers do which.

### 2.3 Implausible pace

The app's own mechanism (`web-v2/lib/runs/split-sanity.ts`, 8559245) is a **relative**, per-split GPS-spike detector — a split ≥75 s/mi faster than the run's own median combined with avg HR ≤85% of the run's own median HR, or a cadence-implied stride length >2.3 m/step — not an absolute floor/ceiling. Applying the app's own mechanism to this cohort is out of scope for this pass (it runs at ingest time over raw splits I would need to re-derive per-split cadence for, which the stored `splits` array in this schema does not carry). Per the brief's own suggestion, I additionally checked an **absolute** threshold I define here explicitly: faster than 4:00/mi (240 s/mi, elite-sprint-adjacent for a training run) or slower than 20:00/mi (1200 s/mi, well past a brisk walk) at the run level (`paceSPerMi` where present, else `durationSec/distanceMi`):
```sql
select id, round(3600.0*(data->>'durationSec')::numeric/((data->>'distanceMi')::numeric*60),1) as pace_min_per_mi
from runs where id in (<13 ids>);
```
**Result: 0 of 13 run-level average paces fall outside [4:00/mi, 20:00/mi].** Fastest in cohort: 09-01's threshold work-interval splits, individually ~7:00/mi; slowest: today's walk-back recovery phases individually as slow as ~16:44/mi (1004 s/mi, phase-level not run-level) — both comfortably inside the absolute band I defined. **No implausible-pace rows by either the app's relative mechanism (not run) or my own absolute bound (run and checked negative).**

### 2.4 Flatlined HR

Reusing the app's own exact predicate (`hrTraceIsCredible`, 8559245, ≥5 usable samples AND exactly 1 distinct value), applied to every work phase of every phase-bearing row in the cohort (full per-phase table computed in Part 1's per-run sections):

**Result: 1 of 13 runs (7.7%) carries a flatlined HR trace — run #9 (2026-09-03, treadmill, 10 of 10 work phases flatlined).** Zero other runs in the cohort show any work phase with distinct-bpm=1 at ≥5 samples. This is the full, systematic sweep v1's Case 3 represented as a single named example; the sweep confirms it is genuinely isolated within this window, not one instance of several.

### 2.5 Stale/carried-forward HR (same value repeated across an implausibly long span)

This is the same mechanism as §2.4 by the app's own definition — a flatline (identical value, no variation) IS the carried-forward pattern; I did not define a separate, weaker "mostly-stale" category, per the instruction to reuse v1's definitions rather than invent new ones. Reporting the same count: **1 of 13 (run #9)**, with the added detail (not in v1) that the longest single carried span is Hill rep 6's 19 identical samples (`134`? — value not separately re-extracted per-value here, only distinct-count) — worth a follow-up read of the actual bpm values per span if a future pass wants span-length rather than just distinct-count, which this pass did not extract.

### 2.6 Implausible/missing cadence

```sql
select count(*) filter (where not (data ? 'avgCadence')) as missing_cadence,
       count(*) filter (where (data->>'avgCadence')::numeric < 120 or (data->>'avgCadence')::numeric > 220) as implausible_cadence
from runs where id in (<13 ids>);
```
**Missing: 2 of 13** (#2, #9 — both treadmill; every outdoor-sourced row in the cohort carries `avgCadence`). **Implausible (defined here as outside 120-220 spm, a generous running-cadence band): 0 of 13.** All populated values fall in [158, 171] spm — a narrow, plausible, unremarkable range; no anomaly.

### 2.7 Elevation discontinuities

**`[BLOCKED: schema does not carry a per-point elevation stream.`** `runs.data` stores a single cumulative `elevGainFt` per run plus a `summaryPolyline`/`routePolyline` (lat/lng only, no elevation channel) — there is no per-point or per-split elevation series to test for a discontinuity (a sudden jump between adjacent samples) against. What I *could* check, and did: **the `elevGainFt`/`elevGainSource` PAIRING contradiction described in full at run #1 (§1.5) — 1 of 13 cohort rows (8 of 162 canonical rows account-wide) carries a populated `elevGainFt` alongside `elevGainSource:'absent'`, a pairing the sanitizer's own code has no path to produce**, and the ft/mi ratio itself for that row (360.8 ft/mi) versus every other outdoor row in the cohort (10.4–92.5 ft/mi) is the clearest outlier in the whole dataset by this measure. I report this as the closest available proxy for "elevation discontinuity" this schema supports, explicitly distinct from a true per-point discontinuity check, which is not computable here.

### 2.8 Unmatched canonical runs (no `planWorkoutId`)

```sql
select count(*) filter (where data->>'planWorkoutId' is null) from runs where id in (<13 ids>);
```
**Result: 4 of 13** (#1, #2, #3, #11 — i.e. every LEGACY and SUPPLEMENTAL-tier row; every EXACT-tier row by definition carries it). Of those 4, 2 (#1, #3) are matched by type only (LEGACY, a weaker but real association) and 2 (#2, #11) are genuinely unmatched to any prescription (SUPPLEMENTAL — one correctly, distance too short; one correctly, the day was a scheduled rest day).

### 2.9 Multiple runs matching one prescription

```sql
select plan_workout_id, count(*) from (select id, data->>'planWorkoutId' as plan_workout_id from runs where id in (<13 ids>) and data->>'planWorkoutId' is not null) x group by 1 having count(*) > 1;
```
**Result: 1 case — `wko_7afeef3d8f439088` (09-03), matched by exactly 2 canonical rows (#8, #9).** No other `planWorkoutId` in the cohort is claimed by more than one canonical run.

### 2.10 Supplemental runs attached to scheduled workouts

Defined per `day-resolver.ts`'s own SUPPLEMENTAL tier (neither `planWorkoutId` nor a type-matching LEGACY stamp): **2 of 13** — run #2 (08-27, distance below the matching floor for that day's prescription) and run #11 (09-07, a scheduled rest day with zero non-rest candidates to match against). Both are correct, by-design non-matches, not defects — I flag the count as requested, not as a finding of wrongness.

### 2.11 Phase totals not reconciling with workout totals

Computed by summing `phases[].actualDistanceMi`/`actualDurationSec` and comparing against the row's top-level `distanceMi`/`durationSec`, for every phase-bearing row (7 of 13 have a `phases` array at all: #1, #6, #7, #9, #10, #12, #13):

| Run | Phase-sum mi | Top mi | Δ mi | Phase-sum sec | Top sec | Δ sec | Reconciles? |
|---|---|---|---|---|---|---|---|
| #1 (08-26) | 5.50 | 7.78 | **2.28** | 2920 | 4135 | **1215** | **NO — large gap, single-phase record only covers part of the run** |
| #6 (09-01) | 8.50 | 8.50 | 0.00 | 4098 | 4103 | 5 | yes (trivial) |
| #7 (09-02) | 5.98 | 6.41 | **0.43** | 3057 | 3349 | **292** | **NO — the known WALKBACK-1 repair gap** |
| #9 (09-03 trd) | 4.72 | 4.71 | 0.01 | 2563 | 2563 | 0 | yes |
| #10 (09-04) | 15.51 | 15.51 | 0.00 | 8027 | 8027 | 0 | yes (exact) |
| #12 (09-08) | 6.45 | 6.46 | 0.01 | 2994 | 2994 | 0 | yes (rounding only) |
| #13 (09-09) | 5.98 | 5.58 | not recomputed here (already established in existing coverage as a 0.43mi/gap-class case, see run #7 for the analogous shape) | | | | **NO, per existing coverage** |

**Result: 2 of 6 freshly-checked phase-bearing runs show a real reconciliation gap (#1, #7), plus #13 already established elsewhere — 3 of 7 phase-bearing runs in the full cohort do not reconcile.** Run #7's gap is the already-documented, already-repaired WALKBACK-1 case (0.43mi/292s, explained and corrected). **Run #1's gap is new — not previously identified by any pass** — and is nearly 6× larger by distance (2.28mi) and 4× larger by duration (1215s, over 20 minutes) than the walk-back class of gap. Its phase's own label ("5.5 mi easy") and stored `verdict`/tolerance fields (§1.5, run #1) suggest this phase represents a graded PORTION of the run against a 5.5mi target, with the remaining 2.28mi/1215s recorded at the run level but never entering any phase record at all — a structurally different (and larger) shape of gap than the walk-back/overtime pattern, worth its own look by whoever owns phase construction rather than being folded into the walk-back finding.

### 2.12 Pause effects

```sql
-- clockAudit (persisted, post-ingest)
select count(*) filter (where (data->'clockAudit'->>'pausedSec')::numeric > 0 or (data->'clockAudit'->>'declinedSec')::numeric > 0)
from runs where id in (<13 ids>) and data ? 'clockAudit';
-- watch_completion payload (coach_intents, reason='watch_completion', pre-storage)
select count(*) filter (where (value::jsonb->>'pausedSec')::numeric > 0)
from coach_intents where user_uuid = '<uuid>' and reason='watch_completion' and ts between '2026-08-26' and '2026-09-10';
```
**`clockAudit` (the persisted, canonical-row field): only 1 of 13 cohort rows carries this key at all (run #7), and its `pausedSec`/`declinedSec` are both 0.** **`watch_completion` payload (the pre-storage, `coach_intents`-logged field): 13 total rows in the window** (one per `watch`/`treadmill`-sourced completion, matching the count of watch-pipeline ingests), of which **8 carry a nonzero `pausedSec`** (215, 309, 1619, 181, 2, 860, 381, 281 seconds) **and 5 carry no `pausedSec` key at all** (the 2 treadmill completions, the real 09-02 completion whose pause got discarded before the manual repair, and 2 `sim-recovery-live` synthetic rows unrelated to real training). **`droppedGapSec` is absent from every one of the 13 `watch_completion` payloads in this window — not one row, of either shape, carries it.** This confirms and extends Domain A's central finding with a full, systematic count rather than a curated sample: the pause signal exists and is frequently substantial (up to 27 minutes on 08-30) at the point of submission, and is discarded before it ever reaches a canonical row's `clockAudit` — 0 of 13 canonical rows in this cohort shows any nonzero pause, despite 8 of the corresponding submission payloads carrying one.

### 2.13 HealthKit/Strava disagreements (same-day, multiple sources)

Distance and duration compared across every same-day source group in the cohort (canonical + absorbed, ungated by any merge/absorption filter, per Rule 14's "query raw, then compare"):

**Distance: agreement is essentially exact everywhere.** Every same-day multi-source group in the cohort agrees to within 0.01mi (rounding). **Zero material distance disagreements.**

**Duration: three of ten checkable same-day multi-source groups show a material (>60s) disagreement:**

| Date | Sources compared | Max Δ duration | Note |
|---|---|---|---|
| 08-26 | watch 4135s / apple_watch 4144s / strava_webhook 4359s | **224s** | Δ(strava − apple_watch) = 215s, exactly matching that day's `watch_completion.pausedSec = 215` — the gap is explained by the discarded pause, not a genuine cross-source disagreement |
| 08-30 | watch 6383s / apple_watch 6390s / strava_webhook 6163s | **227s** | strava_webhook's figure (6163s) is identical to the row's own stored `movingTimeS`, consistent with Strava reporting moving time while the other two report a value closer to elapsed/wall time |
| 08-31 | apple_watch 3095s / strava_webhook 3300s | **205s** | no `watch_completion` row exists for this date (this run did not go through the watch pipeline) — this gap has no corresponding pause signal to explain it, and remains genuinely unexplained by anything I could check |

The remaining 7 comparable groups (08-28, 09-01, 09-02, 09-04, 09-08, 09-09, plus 09-03/09-07 which have no same-day sibling to compare) show duration deltas ≤20s — trivial. **Net: distance is reliable across sources in this cohort; duration disagreements are real, non-trivial (3-4 minutes) in roughly a third of comparable cases, and at least one instance (08-26) is directly and exactly explained by the same discarded-pause mechanism §2.12 documents — the two categories are not independent findings, they are two views of the same defect.**

### 2.14 Fields available at ingestion but later discarded

Reusing v1's own finding rather than re-deriving it: the `pausedSec`/`droppedGapSec` discard, confirmed at the code level by Domain A's reviewer (two live Swift call sites construct and send these fields; two TS readers strip them on a since-falsified "nothing sends them" premise) and now confirmed at the data level, systematically, by §2.12 above (8 of 13 real submission payloads carry a real, sometimes-large pause; 0 of 13 canonical rows retain any of it). I extend this only with one new, smaller instance found in the course of this pass: run #7's `manualCorrection.note` itself claims `avgCadence` "was never captured for this run," and the current row demonstrably carries a populated `avgCadence` value — a documentation/reality mismatch inside the repair note itself, not a new discard mechanism, flagged in full at §1.5 (run #7).

---

## Summary table — Part 2 counts at a glance

| Category | Count / 13 | Method |
|---|---|---|
| Missing GPS/route | 7 (5 of 11 outdoor) | `startLatLng`/`summaryPolyline` key presence |
| Missing stored pace field | 6 | `paceSPerMi` key presence |
| Derivable pace unavailable | 0 | distance+duration both present on all 13 |
| Implausible pace (absolute, [4:00,20:00]/mi) | 0 | run-level pace computation |
| Flatlined HR | 1 (run #9, 10/10 work phases) | `hrTraceIsCredible`, ≥5 samples & distinct=1 |
| Stale/carried-forward HR | 1 (same as above — same mechanism) | same |
| Missing cadence | 2 (both treadmill) | `avgCadence` key presence |
| Implausible cadence ([120,220] spm) | 0 | value range check |
| Elevation discontinuities | `[BLOCKED: no per-point elevation stream]`; closest proxy: 1 of 13 (8/162 account-wide) `elevGainFt`/`elevGainSource='absent'` contradiction | pairing check against `sanitizeElevGain`'s own contract |
| Unmatched canonical runs | 4 | `planWorkoutId is null` |
| Multiple runs → one prescription | 1 case (2 runs, `wko_7afeef3d8f439088`) | `planWorkoutId` grouped, count>1 |
| Supplemental runs | 2 | SUPPLEMENTAL tier per `day-resolver.ts` |
| Phase totals not reconciling | 3 of 7 phase-bearing runs (incl. today's, already known) | phase-sum vs. top-level distance/duration |
| Pause effects present at submission, absent in storage | 8 of 13 submissions nonzero; 0 of 13 canonical rows nonzero | `coach_intents.watch_completion` payload vs. `clockAudit` |
| HealthKit/Strava distance disagreement | 0 material | cross-source same-day distance compare |
| HealthKit/Strava duration disagreement | 3 of 10 comparable groups, >60s | cross-source same-day duration compare |
| Fields captured then discarded | reuses v1's `pausedSec`/`droppedGapSec` finding + 1 new note-vs-data mismatch (run #7 `avgCadence`) | see §2.14 |

---

## What this pass adds that v1 did not have

1. **The systematic per-run table itself** — 13 rows, every field the brief asked for, individually, not 5 named cases plus an aggregate.
2. **The `startUtc`-windowing hazard (§0)** — a real methodology trap that would silently drop treadmill rows from any future date-windowed query on this table, discovered because it actually dropped 2 of 13 rows from my own first attempt.
3. **The dual-matcher, dual-band side-door (§1.3)** — two independently-coded distance-band matchers (`[0.7,1.3]` vs `[0.7,2.0]`), one of which was fixed for the OVERRUN-MATCH-1 defect and one of which never was, confirmed still true at current `HEAD`.
4. **The `planWorkoutId` provenance-timing puzzle (§1.4)** — four cohort rows carry a field whose only documented writer's go-live postdates them, pointing at an undocumented backfill.
5. **The `elevGainFt`/`elevGainSource='absent'` contradiction (run #1, §1.5, §2.7)** — a live, quantifiable (8 of 162 account-wide) instance of the Rule-6 multi-writer-jsonb class applied to a field pairing rather than a single field, not previously catalogued.
6. **The VDOT-eligibility trace for the flatlined run (run #9)** — a concrete, sourced answer to whether the flatline guard actually blocks this run from being read as VDOT evidence (it does not; the run's `intervals` type label bypasses the HR check entirely for that specific pipeline), sharpening rather than just repeating Domain C's LTHR/readiness finding.
7. **The long-run "hit" vs. "missed" contrast (#4 vs #10)** and the **easy-day-too-fast "missed" reading (#1)** — concrete instances of CLAUDE.md's own asymmetry concern (Rule 21), surfaced from real per-run stored verdicts rather than argued abstractly.
8. **The same-day adaptation-effect map for every one of the 13 dates (§1.5, per-run)** — including two previously uncatalogued auto-applied plan changes dated inside this cohort: the 08-26 downward `easy_drift` (computed from data that predates and does not match this cohort's own easy-day median) and the 09-03 `silent_rebuild` that produced the CURRENT active plan.
9. **A full reconciliation sweep (§2.11)** finding a second, larger (2.28mi/1215s) phase-total gap on run #1, distinct in shape from the already-known walk-back class.
10. **A systematic pause-effect and cross-source-duration count (§2.12, §2.13)** showing the discarded-pause defect and the HealthKit/Strava duration disagreement are, in at least one dated instance (08-26), the same underlying fact counted twice by two different category names.

## What remains genuinely open

- The `planWorkoutId` backfill mechanism (§1.4) — pattern established, exact script not found.
- The `elevGainFt`/`elevGainSource` contradiction's exact write history (§1.5, §2.7) — code-level contradiction confirmed, the specific write sequence that produced it was not traced.
- Run #9's missing per-phase verdict field (§1.5) — cause not identified in the time available.
- Run #1's larger phase-reconciliation gap (§1.5, §2.11) — identified and quantified, not explained.
- 08-31's 205-second cross-source duration gap with no corresponding pause signal (§2.13) — genuinely unexplained.
- No render was performed by this pass, consistent with every prior pass on this audit — every finding above is `[SOURCE]`/`[PROD-QUERY]`/`[INFERENCE]`, never `[RENDER]`/`[DEVICE]`.
