# FINAL CONSOLIDATED HANDBACK v2.1 — faff.run Historical-Run Data Forensic Audit
## RUNNER_DAVID's Real Running Data: Inventory, Lineage, Consumption, and Surfacing — Narrow Correction Pass over v2

**v2.1 is a targeted correction pass over v2, not a re-run of the audit.** v2's substantive findings stand; this pass corrects an evidence-tag error (`[RENDER]` used where no render was performed), a factual error (TestFlight build history), completes two exhibits v2 left incomplete (the decision-ledger caller list, the historical-mutation table), sharpens one finding with executed tests (the matcher defect), fixes a release-sequencing error, adds a distinction the pause section was missing (manual vs. automatic, and the three separable persist/display/grade questions), and adds this provenance section. See the companion delta log for the itemized diff. v2 itself is preserved unchanged at `docs/audit-2026-09-09-historical-data-forensic-audit-v2.md`.

---

## HEADER

**Pins in play, all three disclosed:**

| Label | SHA | Role |
|---|---|---|
| v1 pin | `8559245496bf498d3d4b0479e1117ae416988c4a` | Source-of-truth for every `[SOURCE]` citation in v1 and its four domain reports |
| Task's "current main" | `ae91e30668df7e14b1279cb6e4d20db87de5250e` | What this v2 correction pass was asked to check against |
| Actually-live `origin/main` during this pass | `80fca013f94b99ee5af3f84e79590591d42141da` | Confirmed via fresh `git fetch` by multiple correction agents independently; a docs-only commit, touches no code cited below; both prior pins are confirmed ancestors |

Where behavior differs between pins, both are named explicitly at the point of the claim. `origin/main` moved a further time *during* this very correction pass — the exact pattern CLAUDE.md warns about ("a second agent is frequently committing to `main` at the same time... never assume your worktree's base branch is the source of truth") — disclosed here, not silently absorbed.

**Runner:** referred to throughout as **RUNNER_DAVID**. Personal identifiers (name, email, literal `user_uuid`) are deliberately omitted from this document per redaction instruction. Run IDs, plan IDs, workout IDs, and commit SHAs are retained as non-personal identifiers.

**Data window:** Full 2026 canonical run history (287 total `runs` rows, 162 canonical / 125 absorbed) plus a **full, systematic 13-row 14-day cohort** (§2 below — v1 had 5 named cases plus aggregates only) plus a single-day deep trace on the run of 2026-09-09 (`runs.id = -218380344929823`), now substantially deepened (§9).

**Sessions represented in this document:** the original 8-session, 4-domain v1 audit, plus a **6-session correction/completion pass** (today-run settlement; 14-day cohort + data-quality counts; field-lineage completion; pause/gap end-to-end trace; remaining-unknowns chase; current-main reconciliation), all read-only, all against `faff_readonly` (SELECT-only, confirmed by each session independently), no writes, no merges, no migrations, no proposal decisions.

**Evidence limitations, updated from v1:**

1. **The central §9 mechanism question is settled; the render question is not, and v2 mislabeled that gap.** v2.1 correction: an HTTP call to `/api/v5/today` and inspection of its JSON response is `[TEST]`/`[PROD-QUERY]` evidence — it proves what the SERVER PAYLOAD contains. It does not prove the Swift client actually drew the expected screen from that payload. v2's `[RENDER]` tag on this evidence was unsupported and has been corrected throughout this document (§9, §8, §11a, §12, §14). The precise, three-part state is: **current server payload — proven** (`[TEST]`); **current client source path — traced** (`[SOURCE]`); **actual Swift rendering of this payload — still unverified** (`[BLOCKED: no simulator/device render performed]`). No genuine `[RENDER]` evidence exists anywhere in this document as of v2.1 — a Swift-side simulator build of the specific TestFlight build (290) that was actually on RUNNER_DAVID's phone at the time of the run remains the one outstanding step that would produce it.
2. **`origin/main` moved three times across the life of this audit** (v1's pin → the task's "current main" → the actual live tip found during this pass). Every commit-ancestry claim below states explicitly which pin(s) it was checked against.
3. **One genuine cross-pass disagreement was produced by this correction round itself** (not present in v1): whether today's run remains denied the `'executed'` verdict under current `main`. Two of the six correction sessions reached different conclusions because they traced the mechanism to different depths. This is preserved explicitly in §13, not silently resolved by picking the more convenient answer.
4. All evidence tags (`[SOURCE]` / `[TEST]` / `[PROD-QUERY]` / `[RENDER]` / `[DEVICE]` / `[INFERENCE]` / `[BLOCKED: reason]`) are carried from their originating pass. No claim's confidence is upgraded beyond what its tag supports.

---

## 1. COMPLETE FIELD-LINEAGE MATRIX — v1's rows plus 13 new rows, plus labeled distributions

### 1.A v1's original rows (unchanged unless noted — all population counts independently re-derived this pass and confirmed byte-identical)

| Field / mechanism | Storage location | Population (of 162 canonical) | Notes | Tag |
|---|---|---|---|---|
| `data.hrZonePcts` | `runs.data` jsonb | 34/162 | — | `[PROD-QUERY]` |
| `data.phases` | `runs.data` jsonb | 52/162 | — | `[PROD-QUERY]` |
| `data.planWorkoutId` | `runs.data` jsonb | 9/162 all-time; **within the 14-day cohort specifically, 9 of 13 rows carry it** (§2) | Four cohort rows carry a `planWorkoutId` dated before its only documented writer's stated go-live — an untraced backfill, not confirmed (new, §2.A.4) | `[PROD-QUERY]` |
| `data.clockAudit` | `runs.data` jsonb | 4/162, `pausedSec`=`declinedSec`=0 on all 4 | **Superseded — see §6 for the full end-to-end trace of why this field is always zero on every row that carries it, and where the real, nonzero values are discarded before ever reaching storage** | `[PROD-QUERY]` |
| `data.repSkips` | `runs.data` jsonb | 0/162 | — | `[PROD-QUERY]` |
| `data.recoveryExtensions` | `runs.data` jsonb, top-level array | 1/162 | **Consumer found this pass — see §5/§13; move out of "collected but unused"** | `[PROD-QUERY]` |
| `data.ceilingLift` | `runs.data` jsonb, top-level array | 3/162 | Same consumer finding as above | `[PROD-QUERY]` |
| `data.status` | `runs.data` jsonb | 15/162 present (14 `completed`, 1 `abandoned` — values named explicitly this pass, v1 never named them) | — | `[PROD-QUERY]` |
| `data.ruleOutcomes` | `runs.data` jsonb | 0/162 | — | `[PROD-QUERY]` |
| `data.source` distribution | `runs.data` jsonb | See §1.C — now labeled | — | `[PROD-QUERY]` |
| `data.elevGainSource` distribution | `runs.data` jsonb | 91 absent / 33 raw / 18 absent(dup) / 8 treadmill_incline / 6 gps_derived / 3 recomputed / 3 watch, sums to 162 | 8/162 carry the `elevGainFt`-populated + `elevGainSource:'absent'` contradiction (new, §1.B.5/§4) | `[PROD-QUERY]` |
| `canonicalLabel`/`canonicalFinishS` | `runs.data` jsonb | Present as keys, permanently null every row | Retired mechanism, not renamed | `[SOURCE]` |
| `weather.dewpointF` | `runs.data.weather` jsonb | 0/162, never stored | Computed at read time (Magnus-Tetens) — full weather object now traced, §1.B.12 | `[PROD-QUERY]`+`[SOURCE]` |
| `pausedSec`/`droppedGapSec` on `clockAudit` | `runs.data.clockAudit` jsonb | 0 nonzero of 4 carrying the key | **Fully superseded — see §6, the complete end-to-end trace** | `[PROD-QUERY]`+`[SOURCE]` |
| `target_duration_sec` on recovery phases | `runs.data.phases[].targetDurationSec` | 0/6 populated on today's run's recoveries; 0/162 account-wide | **Now load-bearing — see §9: the grading function that would fall back to a different field also fails to find it, for a reason traced to the exact line** | `[PROD-QUERY]` |
| `source_mode`/`sourceMode` | Code-level, 9-file set | N/A | Confirmed exactly the set claimed | `[SOURCE]` |

### 1.B New field-lineage rows (13, none present in v1 — full detail per row available in the field-lineage completion pass; summarized here with every population count and evidence tag preserved)

1. **Route/location samples (GPS points, not just top-level distance).** Captured client-side as a downsampled (~600pt), Google-polyline-encoded string. Storage: `runs.data.routePolyline` (78/162), `.summaryPolyline` (125/162, Strava-sourced), `.startLatLng`/`.endLatLng` (125/162). Lossy, no per-point timestamp, no per-point pace/HR/cadence — geometry only. **Genuine dead-table finding:** a wholly separate legacy table, `workout_routes`, holds **24 rows** for this account with real per-mile pace/elevation detail, last written 2026-05-25, read and written only by the retired `legacy/web` app — orphaned by the PORT-1 cutover, confirmed zero non-test references from `web-v2/**`. `[SOURCE]`+`[PROD-QUERY]`.
2. **Per-sample pace/speed (not just avg pace).** `runs.data.phases[].paceSamples`, `{tSec, distMi, paceSPerMi}` at ~5s cadence. Population **46/162**, identical to the sibling `hrSamples` population (both gated by the same watch-firmware threshold). Directly confirmed on today's run's first phase showing a real acceleration-from-standstill curve. Server-side derivation (`derive-splits.ts`/`derive-phase-splits.ts`) names a real recording gap: "5 of this runner's 51 eligible phases" are missing `paceSamples` despite otherwise being eligible. `[SOURCE]`+`[PROD-QUERY]`.
3. **Cadence raw samples — a genuine, confirmed-absent gap.** Raw per-second cadence exists transiently in HealthKit at ingestion and is queried (`cadenceInWindow`), but only its per-mile-split integer mean survives — **0 of 162** canonical rows carry any `cadenceSamples` key at the phase level, against 46/162 for pace/HR samples. There is no code path anywhere that derives a per-second, per-phase, or drift-curve cadence value, because the underlying stream is discarded at import, not downstream. A future cadence-variability or fatigue-drift feature would need a new ingestion path, not a new query. `[SOURCE]`+`[PROD-QUERY]`.
4. **HR sample timestamps and freshness/age.** No explicit age/staleness field exists anywhere (`msSinceLastReading`/`sampleAge`/similar: zero hits repo-wide). `tSec` inside `hrSamples`/`paceSamples` is a phase-relative offset, not a wall-clock ingestion stamp. Direct inspection of today's run's first phase shows the concrete shape of this gap: the first several samples carry `tSec` with **no `bpm` key at all**, and the first usable bpm doesn't appear until 45 seconds into the phase — a real wrist-sensor warm-up gap with no dedicated field naming it. The actual "freshness" mechanism in this codebase is a **symptom detector**, not an age field: `hrTraceIsCredible` (`MIN_SAMPLES_TO_JUDGE=5`) flags a sample-and-hold flatline by variance, not by timestamp. `[PROD-QUERY]`+`[SOURCE]`.
5. **Mile splits, plus three sibling confidence flags v1 never surfaced.** `runs.data.splits` (156/162) — plus `splits_unreliable` (boolean, 64/162), `splits_validation` (object, 25/162, carrying `{deltaS, durationS, splitsSumS, droppedCount}` — a real, quantified reconciliation-guard fingerprint), `splits_source` (string, 1/162, a provenance tag on one apparent manual/backfill rederivation). Notably, **0 of 162** canonical rows have ever shown `splits_unreliable:true` for this account — the guard exists, is wired, and has apparently never once fired. `[PROD-QUERY]`.
6. **Phase boundaries (start/end timestamps per phase) — confirmed absent.** Exhaustive key enumeration across a full 14-phase object shows only `actualDurationSec` (a span, not a boundary) — no phase carries a start/end wall-clock or run-relative timestamp, client- or server-side. Any reconstruction of "what wall-clock time was phase N running" requires summing every prior phase's duration, and that reconstruction is provably unsafe across a pause, background gap, or manual Skip — none of which register as a distinguishable discontinuity in a duration-only phase list. `[SOURCE]`+`[PROD-QUERY]`.
7. **Pause/resume events (the discrete event itself, not just the elapsed delta) — two independent pipelines, both discard it.** Full detail in §6. Treadmill (`BeltTracker`) never records discrete events, only running accumulators. Outdoor/GPS (`HealthKitImporter`) *does* see discrete, wall-clock-timestamped `HKWorkoutEvent` pause/resume pairs — with a manual-vs-automatic distinction the treadmill pipeline doesn't even have — but consumes them purely to correct split *durations* and never sends the ranges themselves to the server. `[SOURCE]`.
8. **Skip/Next/End/manual transition events.** Day-level Skip (`day_actions(action='skip')`, 9 rows) is genuinely distinguishable and event-logged. Mid-run treadmill "Skip to next phase" is **not** distinguishable downstream — it writes into the same `completed:Bool` field as a timer-driven completion or a background-gap auto-catchup, with no marker naming which path produced the value. **One narrow, brand-new exception:** WALKBACK-2's `recoveryEndedEarly` array (landed after the v1 pin) is structurally exactly the distinguishable-event field this brief asks about, but only for recovery/walk-back phases via the "End interval"/"Go now" affordance — confirmed **0 of 162** canonical rows carry it yet (no run in production history has been recorded on a build that sends it). `[SOURCE]`+`[PROD-QUERY]`.
9. **Shoe identity and cumulative mileage.** Identity assignment is a well-documented three-way priority (explicit pick → Strava gear → recommendation), 176/287 all-time rows carry `shoe_id`. **A genuinely live staleness finding, independently re-confirmed this pass:** the stored `shoes.mileage` column is materially wrong on **6 of 8 shoes** — up to ~12× off (Asics Superblast 3: stored 12.03 vs. computed 150.54), one inverted (Nike Zoom Fly 6, a legacy-seeded starting value), one (Nike Vomero Plus) marked retired despite zero canonical runs ever assigned to it. The canonical, correct value is computed live at read time (`computeShoeMileageBreakdown()`) — any code still reading the raw column directly is reading a stale number. `[PROD-QUERY]`+`[SOURCE]`.
10. **Treadmill speed/incline.** Runner-typed (±0.1 mph / ±0.5%), not measured — confirmed by the app's own header comment. Aggregate per-phase fields (`actualSpeedMph`/`actualInclinePct`) are populated on **40 of 40** treadmill phases account-wide, exhaustively checked. Per-sample granularity (reusing the generic `paceSamples` field) exists on 22 of those 40 — the gap is dated: "every treadmill run before this one landed with `splits: []`" per the route's own comment. `[PROD-QUERY]`+`[SOURCE]`.
11. **Perceived effort (RPE) — a live, materially-consuming table, entirely absent from v1.** `post_run_rpe`, 13 rows spanning 2026-05-24 to today (rpe:3 on today's own run). One row (2026-05-24) points to a run that has since been absorbed into a different canonical row — whether any RPE reader correctly walks that absorption is untraced, flagged as a worthwhile follow-up given this codebase's history of absorption-related data loss. `notes`: 0/13 populated, never used. **Consumers are genuinely live**, not merely collected: `activity-evidence.ts`, `adaptation/load.ts`, `execution/load.ts`, `postrun/load.ts`, and others — RPE plausibly feeds real coaching decisions, and no domain (v1 or this pass) established how much weight it carries against objective HR/pace evidence, or whether it is ever cross-checked against a flatlined HR trace. `[PROD-QUERY]`+`[SOURCE]`.
12. **Weather — full object, extending v1's `dewpointF`-only treatment.** All 9 non-`version` sub-fields of `data.weather{}` are 100% co-populated whenever the object exists (124/162). **A genuine two-provider finding:** `apple_hk` (7 rows, the watch's own on-wrist Apple Weather reading, preferred when present per an explicit in-code comment) vs. `open-meteo` (117 rows, a geocoded reanalysis-grid fallback, admitted in-code to be "1-2°F off"). No downstream consumer was confirmed to treat the two provenances differently when doing heat-adjustment math — an open, cheap follow-up. `version` (57/124, only value ever observed = `2`) looks like an unbackfilled schema marker rather than a live gate. `[PROD-QUERY]`+`[SOURCE]`.
13. **Completion/verdict state, as a field distinct from the grading logic.** `runs.data.status` (`completed`/`abandoned`, 15/162, values now named). `runs.data.phases[].verdict` — a per-phase, device-computed word — is read into a field a **new** file (`web-v2/lib/execution/verdict.ts`, landed between the v1 pin and current `main`) explicitly names `storedVerdict`, kept "for audit and never re-derived... NOT the verdict any surface prints." The authoritative verdict is now always **recomputed at read time** from stored phase actuals — the Rule-10 "recompute" posture, applied explicitly and by design for the phase case. **A gap this consolidation does not close:** there is still no persisted **run-level** ladder verdict anywhere in `runs.data` — `sessionLadder`'s output is computed fresh every read, with no historical audit trail of what a run's verdict was under a past ruleset. `[SOURCE]` (current tip)+`[PROD-QUERY]`.

Also newly surfaced this pass, filed under confidence/quality flags rather than as its own numbered row: **`runs.provenance`** (jsonb column, separate from `data`), 148/162 rows populated, a genuine per-field source-attribution map ("which source supplied *this specific field*" for a merged multi-source row) — a materially richer confidence substrate than anything v1's matrix named, not yet independently disambiguated as to consumers (several grep hits on the generic word "provenance" were not individually confirmed as this specific column). `[PROD-QUERY]`+`[SOURCE]`.

### 1.C `data.source` distribution — labeled (v1 gave unlabeled counts; required correction)

| `data.source` value | Count | Share of 287 |
|---|---|---|
| *(key absent — SQL NULL, not empty string)* | 88 | 30.7% |
| `apple_watch` | 69 | 24.0% |
| `watch` | 56 | 19.5% |
| `strava` | 33 | 11.5% |
| `apple_health` | 21 | 7.3% |
| `strava_webhook` | 11 | 3.8% |
| `treadmill` | 9 | 3.1% |

Sums to 287 (all-time, canonical + absorbed), byte-identical to v1's unlabeled figures. **New secondary finding:** `apple_watch` and `watch` are two distinct string values, plausibly the same underlying source recorded two different ways at two points in the app's history — not chased to a specific writer this pass; flagged as a cheap `git grep` follow-up. `[PROD-QUERY]`.

---

## 2. HISTORICAL-RUN TRUTH TABLE — the actual full 14-day cohort (replaces v1's aggregate-only version)

### 2.A Methodology correction, load-bearing

The obvious way to window this table — filtering by `startUtc` — is **wrong** and silently drops treadmill rows: `treadmill`-sourced canonical rows carry **zero** `startUtc` keys, account-wide. `data->>'date'` (a plain `YYYY-MM-DD` string, present on 100% of canonical rows regardless of source) is the only safe windowing key. Using it correctly recovers **13** cohort rows for 2026-08-26 through 2026-09-09 inclusive, not 11 — including one half of v1's own most-cited named case (the 09-03 treadmill/apple_watch tie-break). `[PROD-QUERY]`.

### 2.A.1 Per-run summary table

| # | Date | Run ID | Source | Distance (actual) | Duration | Plan match | Tier |
|---|---|---|---|---|---|---|---|
| 1 | 08-26 | `-89674653468297` | watch | 7.78 mi | 4135 s | type-match only | LEGACY |
| 2 | 08-27 | `-75039485987228` | treadmill | 3.14 mi | 1716 s | none (below matching floor) | SUPPLEMENTAL |
| 3 | 08-28 | `-255291701482225` | watch | 6.32 mi | 3205 s | type-match only | LEGACY |
| 4 | 08-30 | `-245190372869167` | watch | 13.49 mi | 6383 s | `wko_280c00bdcd4d56ba` | EXACT |
| 5 | 08-31 | `-41598809443969` | apple_watch | 6.18 mi | 3095 s | `wko_0f1aa86a6ab11c82` | EXACT |
| 6 | 09-01 | `-258355938987883` | watch | 8.50 mi | 4103 s | `wko_470a1327c80a75c3` | EXACT |
| 7 | 09-02 | `-145861381014809` | watch | 6.41 mi (repaired) | 3349 s | `wko_97a84cd44d93029f` | EXACT |
| 8 | 09-03 | `-166065474720154` | apple_watch | 4.48 mi | 2234 s | `wko_7afeef3d8f439088` | EXACT |
| 9 | 09-03 | `-240375143823562` | treadmill | 4.71 mi | 2563 s | `wko_7afeef3d8f439088` (**same as #8**) | EXACT |
| 10 | 09-04 | `-100975291972118` | watch | 15.51 mi | 8027 s | `wko_ff129cc011aae496` | EXACT |
| 11 | 09-07 | `-3581443162664630` | apple_watch | 5.01 mi | 2369 s | none (rest day) | SUPPLEMENTAL |
| 12 | 09-08 | `-75144899844434` | watch | 6.46 mi | 2994 s | `wko_1cf8cd95971f2226` | EXACT |
| 13 | 09-09 | `-218380344929823` | watch | 5.58 mi | 2947 s | `wko_d19936ca5659c63b` | EXACT |

Tier definitions per `day-resolver.ts`: **EXACT** = a durable `planWorkoutId` names the real prescription; **LEGACY** = type-matched only, no durable id; **SUPPLEMENTAL** = neither.

### 2.A.2 Two matchers, two bands — clarified this pass: what each one actually does, tested against four scenarios, and which shipping path reaches each

**v2.1 correction of attribution.** v2 said `plan-type-stamp.ts`'s `distanceMatchesPlan` "explicitly refuses to stamp anything if more than one candidate survives." That is imprecise: `distanceMatchesPlan` itself (`lib/runs/plan-type-stamp.ts:44`) is a pure boolean band predicate with no ambiguity logic at all. **The refusal lives in its caller**, `app/api/ingest/workout/route.ts:267-277`, which filters `planDays` through the predicate and only stamps when `candidates.length === 1`; `candidates.length > 1` logs a warning and stamps nothing (the OVERRUN-MATCH-1 refusal). `watch/workouts/complete/route.ts:750-762` does its own separate band check inline (**symmetric ±30%**, `[0.7×,1.3×]`) and picks the candidate with the smallest distance delta — no refusal logic anywhere in that route. So there are genuinely two independent implementations (confirmed `[SOURCE]`, both read in full), but only one of them — the caller in `ingest/workout/route.ts` — was ever built to refuse on ambiguity; the other was never given that behavior to begin with, not "un-fixed" in the sense of a regression.

**Four scenarios, actually executed** (`[TEST]` — a standalone script reproducing both comparison functions verbatim from the pinned source, not hand-computed):

| Scenario | Plan days | Actual mi | `watch/workouts/complete` (symmetric ±30%, closest-wins) | `ingest/workout` (asymmetric [0.7,2.0], refuse-on-ambiguity) |
|---|---|---|---|---|
| 1. Ambiguity — two same-day prescriptions both plausibly fit | 4.5mi, 6.0mi | 5.0 | Matches 4.5mi (silently picks closest, no refusal) | **REFUSES** (2 candidates fit, stamps neither) |
| 2. Under-run | 4.5mi | 2.5 | No match (unstamped) | No match (unstamped) — **identical to the other route**, since OVERRUN-MATCH-1 only widened the ceiling, the floor (`0.7×`) is unchanged in both |
| 3. Ordinary match | 4.5mi | 4.6 | Matches | Matches — both agree |
| 4. 37% overrun (Case 5.1's real shape) | 4.5mi | 6.18 | **No match (unstamped)** | Matches |

**What this settles:** scenarios 2 and 3 show the two matchers agree everywhere except the ceiling; scenario 4 is a **demonstrated wrong-classification-by-replication**, not merely a structural worry — feeding the exact real-world numbers that produced the historical Case 5.1 defect through `watch/workouts/complete`'s own current, live logic reproduces an unstamped (SUPPLEMENTAL-tier) result today. Scenario 1 shows the two routes fail differently under ambiguity: one silently commits to a specific (possibly wrong) answer, the other explicitly refuses and leaves the run unstamped — a real behavioral difference worth deciding on its own, independent of the ceiling gap.

**Which shipping path reaches which matcher, confirmed `[SOURCE]`:** `watch/workouts/complete` is called from `BeltTracker.swift`, `PhoneRunTracker.swift`, `WatchSync.swift`, `TreadmillView.swift`, and `LiveRunTreadmillV5.swift` — this is the **primary, live-tracked-workout completion path** across watch, phone GPS, and treadmill, i.e. the route most real-world runs actually complete through. `ingest/workout` is called from `API.swift` and `HealthKitImporter.swift` — the HealthKit-import/manual-ingest path, a secondary source. **The unfixed ceiling sits on the app's primary completion path, not a peripheral one.**

**Is this release-blocking execution-identity work? Yes**, on the evidence above: it is demonstrated by faithful replication (not merely structural), it reproduces the exact numeric shape of an already-known historical defect, and it sits on the primary shipping ingestion path. Scoped into the release sequence at §12/§14(b) alongside the recovery-honesty fix.

**One open thread this correction surfaced, not resolved:** run #5 (Case 5.1 itself, `-41598809443969`, `source='apple_watch'`, 6.18mi actual vs. 4.5mi plan) DOES carry a `planWorkoutId` in production today — meaning something stamped it despite exceeding the watch route's own ±30% ceiling by the scenario-4 math above. `runs.data` carries no route/writer-attribution field, so which mechanism actually wrote this specific stamp cannot be determined from the row alone. The two most consistent explanations, neither confirmed: (a) it was processed by `ingest/workout` despite the `apple_watch` source label, since that label describes the DEVICE, not necessarily the ingestion ROUTE; or (b) it is one of the four cohort rows already flagged in §2.A.3 as bearing an untraced retroactive backfill. **`[INFERENCE]`, not settled** — v2's "matched via the wider band" framing stated this as more certain than the evidence supports, corrected here.

Two further per-row findings from v1/v2, unchanged by this correction: run #10's authored target for its own workout row **doubled** (from `original_distance_mi=7.5` to the current `distance_mi=15`) by an untraced repricing mechanism (confirmed not `plan_mutations`); run #9/#8 is a genuine "two independently-canonical runs match one prescription" case, resolved at read time by a phase-count/split-count richness tie-break, not by absorption.

### 2.A.3 A provenance question surfaced, not closed

`planWorkoutId` on rows #4/#5/#6/#7 (08-30 through 09-02) predates the field's only documented writer's stated go-live (2026-09-03) by several days. The most consistent available explanation is a retroactive backfill/re-ingestion running the (by-then-live) matcher against already-existing rows — **[INFERENCE]**, not confirmed; no dedicated backfill script was found in `scripts/` or the admin routes to verify directly. Worth a direct question to whoever owns the ingest pipeline.

### 2.A.4 Per-run detail (condensed; full per-field detail is in the underlying completion exhibit)

- **#1 (08-26, 7.78mi, LEGACY):** single unsegmented phase; HR credible (33 distinct/564 samples), cadence plausible. **Elevation contradiction:** `elevGainFt:2807` populated alongside `elevGainSource:'absent'` — a pairing the sanitizer's own code cannot produce (8/162 account-wide instances of this exact shape). Stored verdict `"missed"` — but the runner ran 71 s/mi **faster**, not slower, than the easy-day target; "missed" here means "too hard for an easy day," an easy misread if taken at face value. **Phase-total gap:** phases sum to 5.50mi/2920s vs. top-level 7.78mi/4135s — a **2.28mi/1215s** unreconciled gap, larger than the known walk-back class and previously unidentified by any pass. A same-morning, pre-run-start `easy_drift` auto-applied a **downward** volume adjustment citing a "4mi median" easy day that doesn't match this cohort's own actual easy-day distances (6.2–7.8mi) — juxtaposed, not resolved.
- **#2 (08-27, 3.14mi, SUPPLEMENTAL, treadmill):** correctly unmatched (below the matching floor); no route/cadence (structural to source); HR low-variance (2 distinct/241 samples) but not a flatline by the codebase's own strict predicate — a borderline case the binary guard doesn't catch. Not VDOT-eligible (below the 4mi floor).
- **#3 (08-28, 6.32mi, LEGACY, `status:'abandoned'`):** `splits_unreliable:true` (the one cohort row carrying this flag); stored verdict `"incomplete"`, consistent with abandonment; the LEGACY completion badge fires by type-match independent of the abandonment status — whether the rendered card also communicates "abandoned" is unrendered.
- **#4 (08-30, 13.49mi long run, EXACT):** stored verdict `"missed"` at 91% out-of-tolerance despite `completed:true` — average pace 7:37/mi, i.e. a fast long run scored the same word as a slow one would be. Not durability-eligible (durability evidence is race-sourced only, structurally excluding even a large, well-executed training long run). Same-day LTHR re-anchor event, temporal coincidence only, causation untraced.
- **#5 (08-31, v1's Case 5.1, re-confirmed exactly):** no `phases` array at all (general-ingest path, not the completion route) — grading is `[BLOCKED: no input to grade]`, and the HR-flatline check is likewise un-askable, not confirmed-clean.
- **#6 (09-01, threshold day, EXACT):** 9 phases, recovery-honesty check passes cleanly (deltas 1-4s against 30s tolerance); mixed per-rep verdicts (`hit`/`drifted`×3/`missed`) — a genuinely mixed session, a second, independent test case for the §9 rendering question this audit already centers on.
- **#7 (09-02, the already-documented WALKBACK-1 repair, re-confirmed and extended):** the manual-correction note claiming `avgCadence` "was never captured for this run" is contradicted by the row's own stored `avgCadence:158` — a small, second-order inaccuracy inside a repair note both prior passes quoted verbatim without checking clause-by-clause.
- **#8/#9 (09-03, v1's Case 5.2 AND Case 3, fully re-verified):** two independently-canonical rows on one prescription. The treadmill row (#9) shows **all 10 of 10 work phases flatlined** (distinct bpm = 1, exhaustively re-derived per-phase, not spot-checked) — confirmed to have **zero bearing on this run's VDOT eligibility**, because its `intervals` type label satisfies `passesRunHonestyGate`'s OR-gate independent of HR; the flatline *does* correctly exclude this run's HR from the dose-responsive progression signal, a different, narrower consumer than VDOT. `richer()`'s tie-break selects this 21-phase, 4-split row over #8's 0-phase row for display — a direction v1's own prose left implicit, stated precisely here. Same-day, this prescription's plan traces to a **`silent_rebuild`, engineer-dispatched**, whose resulting plan is confirmed the **currently active** one — a previously uncatalogued fact.
- **#10 (09-04, long run, EXACT):** stored verdict `"hit"` at materially the same overperformance shape as #4's `"missed"` — a direct within-cohort contrast worth a side-by-side by whoever owns long-run grading. Clean phase/total reconciliation.
- **#11 (09-07, SUPPLEMENTAL, rest day):** the cohort's cleanest correct-by-design non-match — a real run on a day the plan asked for nothing.
- **#12 (09-08, tempo day, EXACT):** the cohort's one cleanly-all-`hit` structured session; the correctly-shaped (paired-null) `elevGainFt`/`elevGainSource:'absent'` case, contrasted directly against #1's contradictory pairing.
- **#13 (09-09, today's run):** see §9 for the full, deepened trace — not re-derived here beyond confirming no route data (`startLatLng`/`summaryPolyline` both absent) and no HR flatline on any of its own six work/stride phases (a clean negative contrast to #9's flatline four days earlier).

### 2.B Today's run — corrected phase table (fixes v1's arithmetic and boundary error)

**The predicate, exact:** `Math.abs(actualSec − prescribedSec) <= prescribedSec × 0.5` (inclusive `<=`). For `prescribedSec=60`, tolerance is 30s and a delta of exactly 30 **passes**.

| idx | prescribed (hypothetical, =60) | actual | Δ | v1 said | **Corrected** |
|---|---|---|---|---|---|
| 2 | 60 | 30 | **30** | FAIL (v1's table computed Δ=36, an arithmetic error) | **PASS** — 30 ≤ 30, inclusive |
| 4 | 60 | 43 | 17 | not stated | **PASS** |
| 6 | 60 | 61 | 1 | PASS | **PASS** (confirmed correct) |
| 8 | 60 | 24 | 36 | FAIL | **FAIL** (confirmed correct) |
| 10 | 60 | 38 | 22 | not stated | **PASS** |
| 12 | 60 | 8 | 52 | FAIL | **FAIL** (confirmed correct) |

**Corrected mechanical count (assuming `prescribedSec=60`): 4 pass, 2 fail (idx 8, 12).** v1's prose ("2 of 6, phases 8 and 12") was already numerically correct despite its own table cell being wrong — a wrong per-row computation sitting next to a right final answer, exactly the shape that makes the wrong row easy to trust by association.

**The critical caveat, which changes what this table actually means (see §9 for the full derivation):** the live grading code does **not** in fact resolve `prescribedSec` to 60 for this run. It resolves via `workout_spec.rep_rest_s`, a field **absent** on this strides-shaped spec (only the separate, unread `strides_recovery_s=60` exists). So in production, `prescribedSec` is `null` for all six recoveries, not 60 — meaning the table above is the answer to a hypothetical ("if the code read the field it plausibly should"), not a description of what the live code actually computes. Both facts are true and are not in tension once this distinction is made explicit; §9 carries the full consequence.

### 2.C Historical-mutation transfer — every named automatic/dispatched plan change, as its own row (new this pass; v2 mentioned these in body prose and they did not survive into a transferable table)

`[PROD-QUERY]` unless noted, RUNNER_DAVID's account, re-queried fresh this pass against `plan_mutations` and `plan_proposals` directly (not carried forward from v1/v2 prose).

| # | Event | Mechanism | Authority | Before → after | Scope | Audit trail | Current/retired status |
|---|---|---|---|---|---|---|---|
| 1 | 2026-05-24, `plan_mutations` id `a5a9088f…` | `positive-drift`, `trigger_kind='positive-drift'` | Automatic, engine-authored, `status='applied'` | `distance_mi` → **12.1** (workout `946dad0c…`) | Single workout | Row exists in `plan_mutations` with `reason`/`citation` (`Research/00a §Volume progression rules`) | Mechanism **live** — `plan_mutations`'s positive-drift path is not retired |
| 2 | 2026-05-25, `plan_mutations` id `3e353dc3…` | `positive-drift`, same mechanism as #1 | Automatic, engine-authored, `status='applied'` | `distance_mi` → **4.9** (workout `ec7ae0eb…`) | Single workout | Same as #1 | Same as #1 |
| 3 | **2026-06-02, June-2 automatic upward volume rebuild** (already established in prior passes, restated here as its own row per instruction) | `plan_proposals`, `proposal_kind='goal_time_changed'`, `source='drift_cron_auto'` | **Automatic**, `status` progressed to `superseded` (a later proposal replaced it) | `authored_state.weeklyAvg4w` **20.1 → 35.7 mi/wk** (+77%), `pct_drift: 62.2`, `direction: 'UP'` | Whole-plan rebuild (`new_plan_id` written) | Row exists in `plan_proposals`; **zero corresponding row in `coach_intents`** for this window — the audit-trail gap already flagged as its own finding (§10/§13) | **Mechanism RETIRED** — `plan-drift` cron is detect-only since 2026-09-02 per its own route doc comment |
| 4 | **2026-08-25, long-run automatic upward rebuild — NEW THIS PASS, not in v1 or v2** | `plan_proposals` id `54`, `proposal_kind='long_drift'`, `source='drift_cron_auto'` | **Automatic**, `status='auto_applied'` | `authored_median_mi` **7 → actual_median_mi 11.5** (long runs), `pct_drift: 64.3`, `direction: 'UP'`, `rebuild_ok: true` | Long-run distance basis | Row exists in `plan_proposals`, carries its own `message`/`citation` (`docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 1.2`) | **Mechanism RETIRED** — same cron, same 2026-09-02 detect-only cutover |
| 5 | **2026-08-26, easy-day automatic DOWNWARD rebuild — adjacent finding, surfaced for completeness** | `plan_proposals` id `55`, `proposal_kind='easy_drift'`, `source='drift_cron_auto'` | **Automatic**, `status='auto_applied'` | `authored_median_mi` **7 → actual_median_mi 4** (easy days), `pct_drift: -42.9`, `direction: 'DOWN'` | Easy-day distance basis, one week | Row exists in `plan_proposals` | **Mechanism RETIRED**, same cutover. Named here because it landed one day after #4, on the same rolling window, in the OPPOSITE direction — direct within-account evidence the drift mechanism was genuinely bidirectional before retirement, not one-way |
| 6 | **2026-09-02 re-anchor affecting 76 workouts** | **NOT CONFIRMED — `[BLOCKED: no discrete event/timestamp mechanism found]`.** `plan_workouts` has no `created_at`/`updated_at` column and no companion audit-trail table exists (`information_schema` search for `%reanchor%`/`%lthr%` tables returns zero rows) — an `hr_cap_bpm`/`lthr_bpm` re-stamp of this shape (CLAUDE.md's own Rule 23 names a 162→168 LTHR re-anchor incident) would be a live re-COMPUTE on `workout_spec` jsonb with no timestamp of when any given value was last written. Closest available evidence: `lthr_bpm=168` (Rule 23's cited post-re-anchor value) appears on 13 rows of the currently-active plan (`pln_9a57561debb776e5`) and 10 rows of its predecessor (`pln_7636bcc0a201bf2d`) — **23 total, not 76** — while `lthr_bpm=162` (the pre-re-anchor value) persists in small counts (1-10 rows each) across roughly a dozen older, archived plan versions. No single plan or date shows a 76-row cluster of either value. | N/A — could not confirm the mechanism fired on this date at this scope | N/A | N/A | **UNCONFIRMED.** This is Rule 23's incident CLASS (an LTHR re-anchor stamping `hr_cap_bpm` across a whole block), and the 168-value evidence is consistent with SOME re-anchor having happened, but the specific claim — 76 workouts, on 2026-09-02 — is not verifiable from this schema. Reported as `[BLOCKED]`, not asserted or denied. |
| 7 | 2026-09-03, `silent_rebuild` that created the current plan | `plan_proposals` id `65`, `proposal_kind='silent_rebuild'`, `source='silent_rebuild_dispatch'` | **Engineer-dispatched**, `trigger: 'operator_dispatch'`, `status='auto_applied'` | Whole-plan rebuild around the same goal: `thisWeekMiTo: 46.5`, `longRunMiTo: 15`, `weeksTo: 15`, `lastDayTo: '2026-12-06'` | Whole-plan (`new_plan_id` = `pln_9a57561debb776e5`, the account's currently active plan) | Row exists in `plan_proposals`, `message: "The plan engine was updated · your block was rebuilt around the same goal. Undo puts the old block back."` | **Live** — this IS the currently active plan; not retired, it is today's plan |

---

## 3. PER-CONSUMER EVIDENCE MATRIX — unchanged from v1, re-confirmed, plus one landed component

v1's six-way (`E/R/L/P/B/U`) matrix stands. One update: `web-v2/lib/execution/verdict.ts` (new since the v1 pin) is now the canonical resolver for the phase-level verdict question (§1.B.13) — this does not change any row of v1's matrix, but it means any future reference to "the grading path" should cite this file, not the pre-existing `execution-semantics.ts` alone.

*(v1's full matrix — `hrTraceIsCredible`, LTHR/max-HR/readiness non-consumption, `CANONICAL_ROW_SQL`, `RUNNER_AUTHORITY_TIERS` duplication, `SHADOW_EVIDENCE_EPOCH`, the two shadow-log tables, `plan_mutations`, `plan_proposals`'s 2026-06-02 upward rebuild, `plan_decision_ledger`, orphaned `recommendation.ts`, `coach_intents` — carries forward unchanged into this document; see §11a for what has since merged or been fixed at the code level.)*

---

## 4. DATA-QUALITY AND ANOMALY REGISTER — v1's 14 items plus systematic counts across every requested category

### 4.A v1's original 14 items — status unchanged unless noted

All 14 items from v1 stand as originally stated (2026-08-30 canonical-dataloss repair; 09-02 watch-truncation; `plan_workouts` population hazard; the 43-row-ceiling mischaracterization; HR flatline Case 3, now re-verified exhaustively across all 10 phases rather than a sample, §2.A.4; the 05-31 dedup pair; the AFC race-chip gap; the `pausedSec`/`droppedGapSec` field-lineage error, now fully superseded by §6's end-to-end trace; the `SHADOW_EVIDENCE_EPOCH` mismatch, now **FIXED**, see §11a; the `plan_mutations` reason-group table error; the two-applied-mutation rounding gap, still unresolved but narrowed, see §8.2; the 2026-06-02 upward volume-drift instance; the `watch_completion` payload-population correction; the races-enumeration undercount).

### 4.B Systematic data-quality counts — the full 14-day cohort, every requested category (new; replaces spot-checking with real queried counts)

| Category | Result | Method / tag |
|---|---|---|
| Missing GPS/route | **7 of 13** (54%) missing both `startLatLng`/`summaryPolyline`; of those, 2 are treadmill (structural); **5 of 11 outdoor canonical runs (45%)** are missing route despite being GPS-capable — a real, non-trivial gap | `[PROD-QUERY]` |
| Missing stored pace field | 6 of 13 missing `paceSPerMi`; **0 of 13** missing *derivable* pace (distance+duration always present) | `[PROD-QUERY]` |
| Implausible pace | **0 of 13** run-level averages fall outside an absolute [4:00, 20:00]/mi band; the app's own relative per-split GPS-spike detector was not re-run over this cohort (out of scope — needs per-split cadence this schema doesn't carry) | `[PROD-QUERY]` |
| Flatlined/stale HR | **1 of 13** (7.7%) — run #9 (09-03 treadmill), all 10 work phases, confirmed isolated within this window, not systemic | `[PROD-QUERY]`, reusing the app's own exact predicate |
| Missing/implausible cadence | Missing: **2 of 13** (both treadmill — every outdoor row carries it); implausible ([120,220]spm band): **0 of 13** | `[PROD-QUERY]` |
| Elevation discontinuities | `[BLOCKED: schema carries no per-point elevation stream]`; closest available proxy — the `elevGainFt`/`elevGainSource:'absent'` pairing contradiction, 1 of 13 cohort rows (8/162 account-wide), the clearest ft/mi outlier in the dataset (360.8 vs. 10.4–92.5 elsewhere) | `[PROD-QUERY]`+`[SOURCE]` |
| Unmatched canonical runs | **4 of 13** (every LEGACY/SUPPLEMENTAL row) | `[PROD-QUERY]` |
| Multiple runs matching one prescription | **1 case** (`wko_7afeef3d8f439088`, 2 canonical rows — run #8/#9) | `[PROD-QUERY]` |
| Supplemental runs | **2 of 13**, both correct by design | `[PROD-QUERY]` |
| Phase totals not reconciling | **3 of 7** phase-bearing runs (#1's newly-found 2.28mi/1215s gap; #7's known 0.43mi/292s walk-back repair; today's #13, already established elsewhere) | `[PROD-QUERY]` |
| Pause effects | **8 of 13** real submission payloads carry a nonzero `pausedSec` (2–1619s); **0 of 13** canonical rows retain any of it in `clockAudit` | `[PROD-QUERY]` — full mechanism in §6 |
| HealthKit/Strava disagreement | Distance: **0 material** disagreements. Duration: **3 of 10** comparable same-day groups show >60s disagreement; one (08-26) is *exactly* explained by that day's discarded pause (215s gap = 215s pause) — the same underlying defect counted twice under two different category names | `[PROD-QUERY]` |
| Fields captured then discarded | `pausedSec`/`droppedGapSec` (§6, systematic); one new, smaller instance — run #7's repair note claims `avgCadence` was never captured, contradicted by the row's own stored value | `[PROD-QUERY]`+`[SOURCE]` |

---

## 5. "COLLECTED BUT UNUSED" INVENTORY — corrected

| Item | Status | Tag |
|---|---|---|
| `pausedSec`/`droppedGapSec` | **Superseded — see §6.** Not simply "collected then discarded downstream": the primary drop is at the ingestion gate, before the false-invariant TS comments are ever reached; a second, independently-sufficient drop exists at those comments too. | `[SOURCE]` |
| `target_duration_sec` on recovery phases | Unchanged from v1 — never populated. **Now shown to be load-bearing, not cosmetic** — see §9's finding that the fallback field (`workout_spec.rep_rest_s`) is *also* absent for a strides-shaped spec, silently discarding the entire tolerance check rather than denying it. | `[PROD-QUERY]` |
| `recoveryExtensions`/`ceilingLift` | **MOVED OUT of this table.** A real, five-file-deep, independently-corroborated consumer was found this pass — see §13. | `[PROD-QUERY]`+`[SOURCE]` |
| `plan_decision_ledger` write path | Unchanged — table absent from production, freshly re-confirmed (§11a). | `[PROD-QUERY]`+`[SOURCE]` |
| `recommendation.ts` (`STAY/PROGRESS/MODIFY/PROTECT`) | Unchanged — zero client callers, no code in the delta range touches it. | `[SOURCE]` |
| Reprice payload anchor-move detail (proposal 13) | Unchanged in substance, but now **precisely** unused: the rendered card never states any anchor direction at all — see §8.5/§13. | `[PROD-QUERY]` |
| `elevGainSource` distribution detail | Unchanged — still no traced UI differentiation by source. | `[PROD-QUERY]` |
| **New: cadence raw samples** | Never collected past a transient query — a stronger absence than "collected but unused." See §1.B.3. | `[SOURCE]`+`[PROD-QUERY]` |
| **New: `runs.provenance` per-field source map** | Collected (148/162), consumer list not individually disambiguated from generic grep noise. | `[PROD-QUERY]`+`[SOURCE]` |
| **New: legacy `workout_routes` table** | 24 rows of richer per-mile route/elevation data, orphaned since PORT-1, zero live-app readers. | `[PROD-QUERY]`+`[SOURCE]` |

---

## 6. PAUSE/GAP — the full end-to-end trace (replaces v1's summary mention entirely)

### 6.1 Three senders, not two

Domain A's reviewer found two Swift senders of `pausedSec`/`droppedGapSec` — both treadmill consoles (`TreadmillView.swift`, `LiveRunTreadmillV5.swift`), both constructing the payload from `BeltTracker`'s internal accumulators only when `>=1`. **There is a third**: the live Watch app's own Pause/Resume control (`legacy/native/Faff/FaffWatch Watch App/WorkoutEngine.swift`). This directory name is misleading — it **is** the currently-shipping watch target: `native-v2/Faff.xcodeproj` builds its `FaffWatch Watch App` target directly from these files, confirmed via the project's own PBX group wiring, not a guess. `totalPausedSec` accumulates real, runner-driven pause time (blocked mid-race by design), is sent as `pausedSec` verbatim (the struct has no `CodingKeys`, so the Swift property name *is* the wire key), and is covered by its own regression test. This is the sender that has **actually fired** in production: 8 of 68 historical `watch_completion` submissions carry a real nonzero value, 2026-08-26 through today, values 2 through 1619 seconds. `droppedGapSec` has no watch-side equivalent — it is treadmill-belt-only vocabulary, and empirically has never once been nonzero in this account's history, at any sender.

### 6.2 The wire and the route — where the value is actually dropped

No transformation happens between capture and the wire (plain `JSONSerialization`/synthesized `Encodable`). All three senders post to the same endpoint, `api/watch/workouts/complete`. At the route, two things happen, and this is the precise, previously-unstated answer to "where does the value actually get lost":

1. `pausedSec`/`droppedGapSec` feed a diagnostic-only `clockAudit` computation that reconciles wall-clock time. When the pause **correctly explains** the gap — the normal, correct outcome of a real pause — `driftSec` lands inside a ±45s tolerance and the **entire `clockAudit` object, `pausedSec` and all, is discarded and never written to `runs.data` at all.** Only when the pause *fails* to explain the gap does `clockAudit` get persisted — and on every one of the 4 rows account-wide where it does, `pausedSec` is 0 by construction (those rows are, definitionally, the ones a pause did *not* explain).
2. `droppedGapSec` gets one additional, unconditional top-level write into `runs.data.droppedGapSec` independent of the drift gate — a path `pausedSec` structurally never receives. But (see §6.4) no reader anywhere consumes it, so this is an independent, second dead end, not a fix.

**Confirmed empirically, exhaustively, not by sample:** every one of the 8 real submissions in this account's history carrying a nonzero `pausedSec` — including today's own run (`pausedSec:281`) and the account's longest recorded pause (1619s / 27 minutes, 2026-08-30) — resulted in a matched `runs` row with `clockAudit` **entirely absent.** Zero exceptions, at both audit pins.

### 6.3 The two in-repo comments — corrected precisely, in three separable ways

Two comments (`postrun/experience.ts`, twice; `postrun/load.ts`) assert "no Swift file sends either field" and "both are structurally 0 on every row ever written." Both were already flagged false by v1's Domain A pass on the two-sender count; this trace corrects the claim precisely:

1. **Sender count is wrong**, not just under-cited — three senders exist, including the one that has actually fired.
2. **The "always 0" claim is empirically false**, not merely theoretically incomplete — 8 of 68 real submissions carried a nonzero value, the earliest **two weeks before** either audit pin was cut.
3. **What is durably true, and is the part neither comment states, is the operationally important half:** `runs.data.clockAudit.pausedSec` specifically has never been anything but 0 — not because nothing sends a real value, but because the *ingestion gate* (§6.2.1) discards the value before storage in every real case. The comments' factual premise is wrong; their operational conclusion happens to still be safe advice today, for the wrong reason, and will stop being safe the moment someone "fixes" the false premise without also fixing the ingestion-gate drop.

The reader (`postrun/load.ts`) additionally performs a **hard type-level drop** — `pausedSec`/`declinedSec` are not fields of the `clockAudit` type at all, so even the rare row that survives §6.2's gate would be dropped a second, independently-sufficient time on the way into `PostRunInput`.

### 6.4 Grading has zero wiring to this field at all

A repo-wide grep for `pausedSec`/`droppedGapSec`/`declinedSec`/`clockAudit` across `web-v2/lib` returns matches in exactly two files (`postrun/experience.ts`, `postrun/load.ts`) — **nowhere in `execution-semantics.ts` or `verdict.ts`.** This settles the question precisely: grading is not "blind because it strips the value" — it is blind because the value never flows anywhere near it. A pause during a tempo or long-run segment (as opposed to a recovery walk-back) has **no grading-layer representation at all**, gated or otherwise.

### 6.5 A latent, not-yet-fired structural exposure

`clockAudit`/`pausedSec`/`droppedGapSec` are absent from `canonical.ts`'s `NEVER_COPY` exclusion set — the generic, field-name-blind absorption-merge mechanism that decides what an absorbed row's fields overwrite on its canonical winner. This means a second future writer to any of these keys is exposed to exactly the Rule-6 whole-object-clobber shape this codebase's own doctrine already tracks for `splits`/`actual_result`. **Not observed to have happened** — zero canonical rows show evidence of it — because only one route has ever populated these keys on any row so far. Worth adding to `NEVER_COPY` before a second writer exists, not after.

### 6.6 Runner-facing consequence, stated with precision

No wrong elapsed-time computation, no wrong grading, no misleading disclosure results from this defect — because nothing downstream ever reads the figure at all (§6.4). The actual consequence is narrower and quieter: **no product surface, at any layer — not live on the watch, not live on the treadmill console, not on the post-run recap, not in grading — has ever told RUNNER_DAVID how long he paused on a run where he genuinely paused.** The data is captured correctly at the point of origin; it is spent correctly and silently to suppress a false clock-drift alarm; and it is never recorded as a fact in its own right anywhere a person or a grading routine could read it — on a roughly two-week cadence, including as recently as this morning's run.

### 6.6a Manual versus automatic pause — new this pass, and it must not collapse into "pause is pause"

**v2.1 addition.** The three senders traced above are not equally simple. The watch app (`WorkoutEngine.swift`) carries a genuine, live, speed-threshold automatic pause detector (`autoPauseEnabled`, default `true` via `UserDefaults`; triggers below `autoPauseSpeedMph = 2.0` for `autoPauseWindowSec = 15`), fully distinct from the manual `togglePause()` control — the file tracks WHICH kind fired via a private `pausedAutomatically` flag (`[SOURCE]`, lines 203/226/243/271/617/2892). **This distinction is observable in-app and is discarded before the wire**: `pausedAutomatically` is never read by any wire-struct-building code in this file, never appears in the `WatchCompletionBody` the server accepts, and has zero references anywhere in `web-v2` (`[SOURCE]`, confirmed by exhaustive grep). So the 8 real historical pause submissions traced in §6.2 are a mix of manual and automatic pauses **by construction** — the watch itself knew which was which at the moment of capture — but that distinction is lost before `pausedSec` ever leaves the device, and neither this audit nor any product surface can recover it after the fact. A separate, THIRD automatic-pause signal exists for HealthKit-imported activities specifically — `HealthKitImporter.swift`'s handling of Apple Watch OS's own `.motionPaused`/`.motionResumed` workout-event types (`[SOURCE]`) — deliberately kept distinct from the watch app's own detector to avoid double-counting, per that file's own comments. Phone-GPS tracking (`PhoneRunTracker.swift`) has no auto-pause at all, by explicit design (`[SOURCE]`, the file's own comment: "There is no auto-pause, so `elapsedSec` counts a stoplight"). **Where this distinction is genuinely unrecoverable (every historical row, since `pausedAutomatically` never reached storage), this document preserves that as an open unknown rather than guessing which of the 8 real pauses were manual.**

### 6.6b The three separable questions a fix must not collapse into one

**v2.1 addition, per instruction.** "Fix the pause defect" is not one decision — it is at least three, and they should not be bundled:

1. **Persist pause as an observable fact.** Give `pausedSec` (and, where the sender can distinguish it, whether it was manual or automatic) an unconditional storage path, independent of whether it was needed to explain a clock-drift gap. This is close to a pure bug fix — the value already exists at the point of capture and is simply discarded.
2. **Display it.** A separate decision: once persisted, should any product surface (post-run recap, Activity/history, live on-watch) tell the runner "you paused for N seconds," and if so, does it matter whether that pause was his choice or the watch's own motion detection? This is a product/UX decision, not an engineering one, and nothing in this audit should be read as answering it.
3. **Use it in grading.** A third, separate, and more consequential decision. **This document does not recommend that pause time automatically affect grading.** Whether a pause should ever change a verdict — and if so, only a manual one, only past some duration, only outside recovery phases — is a product/doctrine question with real evidence-policy stakes (a pause easily changes measured pace/HR without changing what the runner actually did), and it has not been decided anywhere in this codebase. The correct scope for the immediate fix is (1); (2) and (3) are named as open decisions, not implied next steps.

### 6.7 What a later engineering pass should do (described, not implemented)

1. Correct the false premise in the three comments cited above — per Rule 20, gate the claim or delete it.
2. Give `pausedSec` an unconditional persisted path, the way `droppedGapSec` already (uselessly) has one, so a real pause is a first-class fact independent of the drift-tolerance branch (§6.6b item 1 only — this is a persistence fix, not a grading change).
3. Widen the `clockAudit` type to actually carry `pausedSec`/`declinedSec` once (2) lands, and decide — per Rule 16 — whether "the clock drifted" and "the runner paused" deserve one sentence or two.
4. Add `clockAudit`/`pausedSec`/`droppedGapSec` to `canonical.ts`'s `NEVER_COPY`, closing the §6.5 exposure before it becomes a real loss.
5. **Separately, as an explicit product/doctrine decision requiring sign-off — not a default outcome of (2)-(4):** whether pause time should ever be displayed to the runner, and whether it should ever reach grading, for any run type. Today it structurally cannot do either. Fixing (2)-(4) does not answer this question and should not be read as pre-deciding it.

---

## 7. "USED BUT NOT SURFACED" INVENTORY — one addition

All of v1's original four rows stand unchanged. **New addition:** perceived effort (RPE) — a live table (§1.B.11) feeding real coaching consumers (`activity-evidence.ts`, `adaptation/load.ts`) with no established weighting against objective evidence, and no confirmed UI surface showing the runner what was logged or how it's used.

---

## 8. "SURFACED BUT NOT TRUSTWORTHY" INVENTORY — updated for settled and newly-settled items

| Item | Status this pass | Tag |
|---|---|---|
| Today-tab phase/pace breakdown, sub-mile walk-backs | **Mechanism SETTLED — see §9.** Server payload proven correct (`[TEST]`); client source path traced (`[SOURCE]`); actual Swift rendering of this specific payload still unverified. | `[SOURCE]`+`[TEST]`+`[PROD-QUERY]` |
| Case 3 treadmill HR flatline | Unchanged — real defect class, UI-reaching status still untested. Re-confirmed exhaustively across all 10 phases (not a sample) this pass, plus a new, sourced finding that the flatline does not block VDOT eligibility for this specific run (its type label bypasses the HR check). | `[PROD-QUERY]`+`[SOURCE]` |
| Race PRs / personal-records surface | **RESOLVED — see §13.** v1 conflated two screens; neither has a defect. | `[PROD-QUERY]`+`[SOURCE]` |
| Proposal-13-style bundled reprice cards | **RESOLVED as to what the card actually says — see §13.** A genuine, separate UX-design question about bundling remains open. | `[PROD-QUERY]`+`[SOURCE]` |

---

## 8a. CONFLICTING-OWNER / SIDE-DOOR REGISTER — restated in full, not by reference (v1's exhibit 8; a required exhibit, so it is reproduced here rather than pointed at)

| # | Conflict | Detail | Status this pass | Tag |
|---|---|---|---|---|
| 1 | `RUNNER_AUTHORITY_TIERS` duplicated | Both `vdot-inputs.ts` and `durability-anchor.ts` independently declare `const RUNNER_AUTHORITY_TIERS: readonly AuthorityTier[] = ['representative', 'compromised', 'unrepresentative']`, each importing the shared `AuthorityTier` *type* from `lib/race/effort-authority.ts` but re-declaring the *value array* locally — exactly the pattern `DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` §2 forbids | **UNCHANGED — and now confirmed a systemic pattern, not an isolated one** (see row 6 below) | `[SOURCE]`, confirmed verbatim on both sides |
| 2 | Five distinct, pairwise-non-matching adaptation-decision vocabularies live simultaneously | (a) `BRAIN_CONSTITUTION.md` §I doctrine: `PROGRESS/HOLD/REDUCE/RESTRUCTURE`; (b) `adaptation-model.ts`'s `CycleDecision`: `STAY/PROGRESS/MODIFY/PROTECT`; (c) `canonical_adaptation_shadow_log`'s DB `CHECK` constraint: `PROGRESS/HOLD/REGRESS/REFUSE`; (d) `dose-responsive.ts`: `PROGRESS/HOLD/REDUCE`; (e) Migration 166's ledger `CHECK` constraint: `PROGRESS/HOLD/REGRESS/REFUSE/APPLY/DEFER/EXPIRE/UNDO` (8 values) | UNCHANGED, not re-verified this pass (out of this correction brief's scope) | `[SOURCE]`, as re-confirmed in v1 |
| 3 | `SHADOW_EVIDENCE_EPOCH` pin mismatch | `race-outlook.ts`'s content hash vs. the pinned expected value in `shadow-evidence-epoch.ts` | **FIXED** (`52c5e8dd0`) — independently re-recomputed via SHA-256 against both the original pin and the current-main tip this pass; both now match. v1's "live, self-inconsistent doctrine-pin" language does not survive. | `[SOURCE]`+`[TEST]`, self-computed twice |
| 4 | `AUTOMATIC_ADAPTATION_AUTHORITY: false` vs. the 2026-06-02 `drift_cron_auto` history | The current architecture's single stated adaptation boundary is real and literal (`= false`) — but postdates a period when an earlier, now-retired cron mechanism did auto-apply an upward volume rebuild without that boundary existing | UNCHANGED — a historical side-door, not a live one | `[SOURCE]`+`[PROD-QUERY]` |
| 5 | `plan_decision_ledger` — write calls, table absent | An owner writing into a table that structurally cannot receive the write — every call site presumably falls through `TABLE_ABSENT` handling silently | **CORRECTED THIS PASS: the write-caller count is 8 distinct files (11 call-site lines), not 10.** v2's "10 live sites" over-counted by including two genuinely read-only callers and risked conflating a same-named-but-unrelated function. Re-derived fresh against current main (`99757c120`), not carried forward: the DEFINITIVE list — **1)** `web-v2/app/api/coach/proposal/[id]/decline/route.ts:167` (`recordDecision`); **2)** `web-v2/app/api/plan/workout-proposals/[id]/dismiss/route.ts:140` (`recordDecision`); **3)** `web-v2/app/api/today/reschedule/route.ts:365` (`recordDecision`); **4)** `web-v2/lib/adaptation/canonical-shadow/live-arbitration-proposals.ts:167` AND `:263` (`recordDecision`, 2 call sites in this one file); **5)** `web-v2/lib/brain/option-lane.ts:596` (`recordDecision`); **6)** `web-v2/lib/brain/orchestration/move-orchestrator.ts:1246` AND `:1337` (`recordDecision`, 2 call sites); **7)** `web-v2/lib/plan/mutate.ts:1088` (`recordDecision`) AND `:1143` (`recordDecisionInTransaction` — Lane A, 2 call sites, 2 different lane functions); **8)** `web-v2/lib/plan/workout-proposals.ts:248` (`recordDecision`). **Excluded, and named so the exclusion is checkable:** `web-v2/app/api/admin/decision-ledger/route.ts` — read-only by its own header comment and by direct inspection ("GET only. Every function it calls is a SELECT."), imports no write function; `web-v2/lib/runner-state/store/lineage.ts` — imports only `resolvePlanLineage` (a read) and the `LedgerExecutor` type, never `recordDecision`/`recordDecisionInTransaction`; `web-v2/lib/plan/reschedule.ts:2499` — calls a LOCAL function also named `recordDecision`, defined in the same file at `:2604` with an unrelated signature (`(tx: PoolClient, d: RescheduleDecision): Promise<void>`), not the decision-ledger's function at all. | `[SOURCE]`, fresh `git grep` against current `origin/main` |
| 6 | **NEW this pass** — two independently-coded plan-match distance bands | `watch/workouts/complete/route.ts` uses a symmetric ±30% band (`[0.7×,1.3×]`), picks closest on a tie, never refuses on ambiguity; `ingest/workout/route.ts` (via `plan-type-stamp.ts`) uses an asymmetric `[0.7×,2.0×]` band and explicitly refuses to stamp on ambiguity (the OVERRUN-MATCH-1 fix) — only one route received the fix | **NEW — confirms row 1's pattern is systemic, not isolated: this is the second live instance of the same shape** | `[SOURCE]`, from the 14-day cohort completion (§2.A.2) |

---

## 9. TODAY'S-RUN DEEP TRACE — the most important section to get right

**The run:** `runs.id = -218380344929823`, 2026-09-09, 5.58 mi / 2947s, easy day + 6 strides, `plan_workout_id = wko_d19936ca5659c63b`, 14 phases. Sole canonical row for the day.

### 9.1 The §9 dispute — SETTLED as to mechanism (audit-report omission, not a live UI defect)

Both v1 sides — the original diagnosis ("`routePhases` is GPS-mile-keyed, forcing a pace-less fallback") and Domain D's reviewer ("`routePhases` is phase-keyed; `sectionPieces` should fire cleanly") — were **arguing about the wrong mechanism entirely.**

**What actually explains the symptom, [SOURCE]+[PROD-QUERY]:** a third, separate Swift component, `workoutPhasesTile`/`phaseTrailingText` (introduced 2026-09-04 by "WORKOUTPHASES-1," deleted 2026-09-08 by `154edbf97`), renders **unconditionally**, above the `sectionPieces`/`workoutPhasePieces` breakdown both v1 sides debated. It reads `model.workoutPhases`, which "NEVER gated on indoor," carries every raw phase regardless of GPS presence. Its wire type (`V5WorkoutPhase`) has **no pace field at all** — not gated, structurally absent — and its rendering function stamps the literal string `"not completed"` for **any** phase with `completed:false`, of **any** type, with zero regard for recovery-vs-work. Feeding today's real raw phase data into this component's logic reproduces the reported symptom exactly (5 of 6 walk-backs show `completed:false`).

**[TEST]-grade confirmation of the *other* side of the story (v2.1: retagged from `[RENDER]` — this proves the server payload, not what the Swift client draws):** a live call against the actual current-`main` `/api/v5/today` server route (via the documented walk-substrate harness, against a real database copy of this exact row) confirms the SERVER RESPONSE BODY: `routePhases` has 14/14 entries (phase-keyed, exactly as the reviewer argued); every recovery phase carries a real, non-null pace string; the literal string `"not completed"` occurs **zero** times anywhere in the response. This is `[TEST]` evidence — real code executed, real output inspected — not a rendered screen. The current-client SOURCE PATH that would consume this payload was traced (`[SOURCE]`, matching the reviewer's own description), but no simulator or device actually drew the screen from it. So: **current server payload — proven correct. Current client source path — traced and consistent with a correct render. Actual Swift rendering of this exact payload — unverified.** What this evidence chain DOES establish with confidence is that the symptom RUNNER_DAVID actually saw was not produced by this mechanism — it was produced by the separate `workoutPhasesTile` component (below), confirmed live on his phone at the time via the build-history evidence, independent of whether the current mechanism would render correctly if tested.

**Why both were, and were not, right:** the original diagnosis's symptom claim was real, but attributed to an already-fixed code path instead of the separate `workoutPhasesTile` that was actually still live. The reviewer's mechanism trace was correct but incompletely scoped — it implicitly concluded "so the screen was fine," without considering the unconditionally-rendered tile neither side had examined.

**Which build was actually on the phone, and why this matters:** `[PROD-QUERY]` against the live App Store Connect API confirms **build 290 is the latest/highest build uploaded** for this app as of this pass — not "the only build ever shipped." `git log --all --grep="TestFlight build"` independently confirms a long, continuous ship history well before 290, including build 275 (`89f602df5`, "treadmill piece-by-piece breakdown") and build 278 (`9f2ff3f1a`, "integrated iPhone + Watch, mapping proven off the artifact") among many others back through at least build 225 — v2's "the only build ever shipped to this account" language was wrong and is corrected here. What matters for this section is narrower and still holds: build 290 was distributed to internal testers ~40 hours before the run, no build newer than 290 has ever existed, and its source commit predates `154edbf97` (the deletion) by **~18.5 hours**. The exact build number a phone was running at the moment of any specific run is never transmitted to the server by any code path in this repo (`[BLOCKED]`, confirmed by exhaustive grep) — the installed build is not directly queryable. Since 290 is the newest build that has ever existed, **290 was the newest build that could possibly have been installed at the time of the run**; that RUNNER_DAVID's phone was actually running 290 specifically (rather than some earlier build) remains an `[INFERENCE]`, not a certainty — his phone could equally have been on an earlier build and the same symptom would follow, since `workoutPhasesTile` was live on every build from 2026-09-04 (when it was introduced) through 290.

**The distinction this section must not blur, stated explicitly per instruction:**
- **Audit-report omission (v1's own error):** neither v1 side realized a third, separate component existed and was the actual explanation. This is a correction to the *report*, not a claim about the app changing behavior.
- **Actual UI reality, as best evidenced:** the fix (`154edbf97`'s deletion, plus WALKBACK-1/2's later patches) is merged to `main` but has **never shipped in any TestFlight build**. RUNNER_DAVID's phone will keep showing this exact defect on any future shortened walk-back until a new build is archived and distributed — this is the single most actionable, concrete fact in this whole section.

**Disclosed, deliberate render gap:** no actual Swift/simulator build of build 290 specifically was performed — judged low marginal value given the git-history proof is unambiguous and the server-side mechanism is now confirmed by a real live call rather than a trace. A fixture and reproduction instructions were prepared for a future pass that wants this final confirmation. This is a stated stopping point, not a silent one.

### 9.2 Stride/recovery pace evidence — four sub-questions, answered separately (was "nobody has evidence" in v1; replaced with the actual evidence package)

- **(a) Does the raw data exist?** Yes — every one of the 14 stored phases carries a positive distance and duration, down to the 8-second walk-back, plus a device-computed `actualPaceSPerMi` and a `paceSamples[]` array on every phase but the final overtime tail. `[PROD-QUERY]`.
- **(b) Precision sufficient for an average pace per segment?** Yes, trivially — hand arithmetic and the watch's own stored value agree to within a couple of seconds per mile even on the shortest phases. `[PROD-QUERY]`.
- **(c) Precision/density sufficient for a finer, intra-phase metric?** **No — and this scales with phase length, a real physical limit, not a bug.** Sample density is roughly 1 per 5 seconds regardless of phase length, so a phase shorter than ~10 seconds gets only 1-4 samples — the shortest phase in the entire run (8 seconds) gets exactly **1** sample. One sample cannot produce a delta, let alone a sub-split or a cadence-derived curve, within the segment. `[PROD-QUERY]`.
- **(d) Did the UI choose not to show pace despite (a) and (b) being true? Yes, and the exact structural gate is nameable on both sides:** the mechanism actually live on the phone (`workoutPhasesTile`/`phaseTrailingText`, §9.1) never carries pace **at all**, for any phase, as a blanket wire-type omission — correctly reasoned for a treadmill belt ("a treadmill phase has no GPS distance"), but applied unconditionally to outdoor GPS phases too, which genuinely do have real pace sitting unused. The current-`main` successor (`workoutPhasePieces`, post-WALKBACK) makes the identical choice even more explicitly, with a direct comment: an unconditional `nil`, regardless of phase type or whether real pace data exists for the specific run. By contrast, `sectionPieces` — the lane confirmed live via §9.1's render to actually fire for this run — reads real pace unconditionally, with no type-based gate at all.

### 9.3 The corrected phase-table math (from §2.B, restated in context)

v1's table had a compound error at idx 2 (a Δ36 that should be Δ30, plus a missed inclusive-boundary read) — corrected to **PASS**. Mechanically, assuming `prescribedSec=60` for all six recoveries: **4 pass (2, 4, 6, 10), 2 fail (8, 12)** — matching v1's prose, not its table.

### 9.4 The more consequential correction: today's run is likely NOT actually denied the `'executed'` verdict, for a reason no prior pass identified

**This reverses v1's central P0 framing and must be stated plainly.** Tracing `resolveWorkoutVerdict()`'s exact call site: `prescribedSec` for a recovery phase resolves as `p.targetDurationSec ?? opts.prescribedRecoverySec ?? null`, where `opts.prescribedRecoverySec = num(spec.rep_rest_s)`. `targetDurationSec` is confirmed null on all 6 recovery phases (§1.A). **`rep_rest_s` does not exist as a key on this run's actual `workout_spec`** — it is a strides-shaped spec, carrying only `strides_recovery_s: 60`, a *different, unread* field. So `prescribedSec` resolves to **`null`**, not 60, for every one of the six recoveries. `recoveriesHonestOf`'s own contract returns `null` — "no signal" — when zero recoveries carry a known `prescribedSec`, not `false`. `sessionLadder`'s gate is `recoveriesHonest !== false`; `null !== false` is `true`. **The tolerance check does not, and did not, block the `'executed'` verdict for today's run**, contrary to v1's headline claim.

This was verified by a standalone script replicating the exact production logic against the real stored data and the real `workout_spec`, and corroborated by the live render's own top-level narrative for this run: *"Easy run stayed controlled. Six strides completed."* — positive, with no denial language, consistent with `recoveriesHonest` never having been `false`.

**The actually correct characterization of the defect, and it is more concerning than v1's framing, not less:** this is not the run being conservatively denied credit. It is the entire recovery-tolerance check being **silently skipped** — "no data" rather than "checked and passed" or "checked and failed" — for every strides day this account has ever run or will run, because the grading code reads a rep-workout field name (`rep_rest_s`) on a strides-shaped spec that has never carried it, and never reads the field (`strides_recovery_s`) the strides-authoring path actually writes. Two genuinely short recoveries (Δ36s and Δ52s against the runner's own model) are real, checkable facts about this run's execution, and they are currently discarded as "unknown" rather than evaluated — precisely the Rule-11 shape ("don't know"/"measured zero"/"the check was skipped" collapsed into one) this codebase's own doctrine names as its most productive bug pattern. **This is still unfixed on current `main`** — the exact line is byte-identical at the live tip.

**A flagged, unresolved cross-pass disagreement (new to v2, not present in v1):** a separate correction session, working from the current-main reconciliation angle, independently re-derived the same tolerance check for today's run but assumed `prescribedSec=60` for all six recoveries (carrying that assumption forward from the original, uncorrected phase table rather than re-tracing the field resolution) and concluded the run **remains** denied `'executed'` under current `main`, identically to before WALKBACK-2's merge. **This document resolves the disagreement in favor of the deeper trace above** (§9.4's own standalone-script verification against the actual `workout_spec` JSON, corroborated by the live render's positive narrative) — the other session's derivation did not check whether the code's assumed input (`prescribedSec=60`) matches what the code actually resolves for this specific run's spec shape, and per the evidence above, it does not. Both sessions' conclusions about WALKBACK-2 itself stand: the merge is real, and its new `recoveryEndedEarly` input is absent from today's stored data regardless of which of the two readings of the tolerance check is correct — WALKBACK-2 would not have changed today's outcome either way, just for different reasons than either session individually stated.

### 9.5 Proposal 13's actual wire text (fully traced; corrects both the audit's prose error and settles what "the runner actually saw")

Proposal 13 (`plan_workout_proposals.id=13`, `reprice`, `cron_reanchor`, dismissed same-day) carries six internal anchor-move deltas (threshold slower, interval/repetition/easy/shakeout faster, marathon slower) — confirming the *reviewers'* correction of v1's original prose (which had reversed 2 of 4 directions), not v1's original characterization. **But tracing the actual rendering functions end to end, not just the payload, shows this dispute was never about what the runner saw at all: the rendered card never states any individual anchor's direction.** The complete generated card, reconstructed exactly from the render functions: a one-sentence threshold-only headline ("Threshold moves to 7:12 across the block"), a single net-direction badge ("push," derived from the payload's own `direction` field, internally consistent with the net average even though one of six levers moves the other way), a plain-text reason sentence, a session-affected count, and a two-sentence evidence-confidence detail. **Neither v1's prose nor its reviewers' correction was ever describing something that reaches a screen** — this resolves the "was the audit wrong or was the card wrong" question decisively in favor of "the audit's prose was wrong about internal payload data the card never renders." It surfaces a genuine, still-open UX question of its own: whether bundling six anchor moves (one moving opposite to the other five) behind a single-lever headline and one net-direction badge is the right level of disclosure for an accept/decline decision — not a bug in what rendered, a real design question.

---

## 10. THE "14 PROGRESS" QUESTION — resolved, reclassified

**v1's classification: "genuinely open, unmatched to any mechanism."** This is now superseded.

A broadened search across all of `docs/` (not just this audit's own trail) surfaces `docs/reports/core-closure-2026-09-04/ADAPTATION-VERDICT.md`, which already walked the number back the same day it was produced ("PROGRESS 14... ONE applied... 10 suppressed by WEEKLY_VOLUME, 3 by PLAN_LOAD"). Tracing the concept forward through git history to its live mechanism, `scripts/adaptation-real-replay/real-replay.test.ts` — a still-existing, database-free harness that replays the canonical adaptation engine, in memory, against a frozen snapshot of this runner's real 2026 training history — **was found and actually run this pass**:

```
Test Files  1 passed (1)
     Tests  22 passed (22)
distribution: { PROGRESS: 14, HOLD: 64, REGRESS: 4, REFUSE: 38 }
```

Byte-identical to the 2026-09-04 closure document, reproduced fresh. Of the 14, 13 carry a documented `suppressed` reason (9× weekly-volume cadence rule, 3× weekly-plan-load arbitration, 1× another lever already changing); exactly one (2026-06-22, threshold pace) was unsuppressed.

**Classification, stated per instruction:** a real source *was* found, so the fallback "invalid/unsubstantiated" classification does not apply. **VALID, but scoped to a different question than Rule 21's own claim.** "14" is the count of decision-point verdicts a **replay/simulation harness** produces when the current engine is run against real historical training data as if it had been live the whole time — a capability proof ("would the engine have pushed?"), not a production log ("did it push?"). None of the three production tables Rule 21 relies on (`coach_intents`, `adaptation_shadow_log`, `canonical_adaptation_shadow_log`) is what "14" describes, which is exactly why all of them correctly show nothing when queried for it — this was never a gap in those tables. Rule 21's own, narrower "zero upward in `coach_intents`, 321 rows" finding is unaffected and stands unchanged.

---

## 11. PRIOR-REPORT RECONCILIATION — consolidated classification table (v1's rows carry forward unchanged; this pass adds §11a below)

*(v1's full reconciliation table — every domain's CONFIRMED/CHANGED/STALE/CONTRADICTED/UNKNOWN/NOT_RE_TESTED classification — stands as originally written; nothing in it required correction by this pass except where explicitly superseded below.)*

## 11a. CURRENT-MAIN DELTA TABLE (new section — v1 lacked this entirely)

| Finding | Status at original pin (`8559245`) | Current-main status | Fixed/Unfixed/Changed | Branch / merge commit | Reaches production/TestFlight |
|---|---|---|---|---|---|
| WALKBACK-1 (recovery no longer flagged "not completed" in the server-side fallback) | REVIEWED — MERGE PENDING | **Merged**, confirmed ancestor of both later pins | **FIXED** | `1a26aae87` (merge of `7b0163c85`) | **Server: partial/unconfirmed** — Railway auto-deploy per doctrine, but deploy success itself not independently confirmable read-only; **the mechanism it fixes was never the live cause of the reported symptom anyway (§9.1)** |
| WALKBACK-2 (`recoveryEndedEarly` — honor a chosen early end) | REVIEWED — MERGE PENDING | **Merged** | **FIXED (merged), split by platform** | `e5bcc430b` (merge of `e80524809`) | **Server (TS): same deploy-status caveat as above. Watch/Swift capture code: CONFIRMED ABSENT from every TestFlight build ever shipped** — build 290, the newest build uploaded as of this pass (not the only one ever shipped — a long ship history precedes it), predates the merge by 2 days; no ship commit exists anywhere after it |
| `SHADOW_EVIDENCE_EPOCH` pin mismatch | "live, reproducible mismatch" | **Fixed**, independently re-recomputed via SHA-256 against both later pins, matches exactly | **FIXED** | `52c5e8dd0` | N/A — a CI-gate value, not a runtime path |
| `plan_decision_ledger` / Migration 166 | Table absent from production | **Unchanged** — fresh query this pass, still `to_regclass(...)` → NULL | **UNFIXED** | — (DDL, requires explicit per-statement approval) | No |
| `coach_intents` zero-upward (Rule 21, narrow scope) | 321 rows, 0 upward reasons | **Unchanged** — fresh query, still 321/0 | **UNFIXED (by design/unaddressed)** | — | N/A |
| "14 PROGRESS outcomes" | Genuinely unmatched | **Resolved** — see §10 | **RESOLVED (reclassified, not fixed — not a defect)** | `scripts/adaptation-real-replay/real-replay.test.ts` line, no single commit | N/A — a test harness, not a production path |
| §9 central dispute (`sectionPieces`/`workoutPhasePieces`) | Unresolved, needs a render | **Settled as to mechanism** (§9.1); one disclosed Swift-render gap remains | **SETTLED-WITH-CAVEAT** | `154edbf97` (the real fix; predates both WALKBACK merges) | **Fix merged, never shipped in any TestFlight build (build 290 predates it)** |
| Today's run denied `'executed'` (v1's other §9-adjacent P0) | Stated as fact | **Contradicted by a deeper trace — see §9.4.** Likely NOT actually denied, for an unrelated reason (silent field-mismatch skip, not a failed check) | **CORRECTED / RECLASSIFIED** — and flagged as a disagreement between two of this pass's own six sessions, resolved in favor of the deeper trace | — | N/A (a live grading-logic gap, unmerged fix does not exist for this specific defect) |
| `38b33f0f5`, `49be10229` (unrelated to this audit's own findings) | N/A — not a v1 claim | **Confirmed still unmerged** | Out of this audit's scope | — | No |

---

## 12. PRIORITIZED CORRECTION PLAN — updated

Severity unchanged from v1 (**P0** corrupts identity/grading/fitness belief/adaptation/safety · **P1** materially incomplete info · **P2** valuable evidence unsurfaced · **P3** usability · **P4** cleanup).

| # | Finding | Severity | Status this pass | Tag |
|---|---|---|---|---|
| 1 | **Recovery-honesty tolerance check silently no-ops on strides-shaped specs** because grading reads `workout_spec.rep_rest_s` (rep-workout vocabulary) and never `strides_recovery_s` (strides vocabulary) — a Rule-11 "check skipped, not checked" defect for every strides day this account has run, discovered this pass, distinct from and more consequential than v1's original "denied credit" framing | **P0** | **NEW, unfixed, still live on current `main`** | `[SOURCE]`+`[TEST]` |
| 2 | `sectionPieces`/`workoutPhasePieces` §9 dispute | was P0/P4-conditional | **Settled as to mechanism.** The actual live defect (`workoutPhasesTile`, live on every build 2026-09-04 through 290, the newest build ever shipped) is real and dormant on the phone until a new TestFlight build is distributed — see §12 for why "ship a build" is not the immediate next step | **P1** — a real, dated, actionable gap, not an engineering unknown | `[SOURCE]`+`[PROD-QUERY]`+`[TEST]` |
| 3 | `pausedSec`/`droppedGapSec` — full pipeline traced | was P1 | **Sharper P1**: the drop is at the ingestion gate (discards the value exactly when it's correct), not merely at two downstream comments; zero product surface has ever shown a real pause | **P1**, unfixed | `[SOURCE]`+`[PROD-QUERY]` |
| 4 | `coach_intents` invisible to the 2026-06-02 upward rebuild | unchanged | Unchanged, unfixed (mechanism retired but audit-trail gap remains) | **P0** | `[PROD-QUERY]`+`[SOURCE]` |
| 5 | HR flatline guard not reaching LTHR/max-HR/readiness | unchanged | Unchanged, unfixed; new finding this pass that it *also* doesn't reach VDOT eligibility (a third non-consumer, for a run-type-specific reason) | **P0** | `[SOURCE]` |
| 6 | `SHADOW_EVIDENCE_EPOCH` mismatch | was P1 | **FIXED** — remove from open list | closed | `[SOURCE]`+`[TEST]` |
| 7 | Five non-matching adaptation vocabularies | unchanged | Unchanged, unfixed | **P1** | `[SOURCE]` |
| 8 | `RUNNER_AUTHORITY_TIERS` duplication | unchanged | Unchanged, **now confirmed a systemic pattern**, not isolated — the plan-match distance-band duplication (§2.A.2) is a second live instance of the same shape | **P4→P2** (upgraded — this pattern has now recurred) | `[SOURCE]` |
| 9 | `plan_decision_ledger` fully wired, table absent | unchanged | Unchanged | **P2**, approval-blocked | `[PROD-QUERY]`+`[SOURCE]` |
| 10 | `recommendation.ts` orphaned | unchanged | Unchanged | **P2** | `[SOURCE]` |
| 11 | `target_duration_sec` never populated on recovery phases | was P3 | **Upgraded — this is now confirmed load-bearing, not cosmetic** (finding #1 above) | **P0** (folded into #1) | `[PROD-QUERY]` |
| 12 | Races enumeration completeness | was P1/P4-conditional | **RESOLVED — not a defect at either screen** (§13) | closed | `[PROD-QUERY]`+`[SOURCE]` |
| 13 | Proposal-13-style bundled reprice cards | was P1-candidate | **The specific concern (wrong anchor directions shown) does not exist — the card shows no directions at all.** A distinct, real UX-bundling question remains open, unscoped by severity yet | **P3-candidate (new framing)** | `[SOURCE]`+`[PROD-QUERY]` |
| 14 | `dewpointF` computed at read time, not a defect | unchanged | Unchanged | **P4**, working as designed | `[PROD-QUERY]`+`[SOURCE]` |
| 15 | `plan_workouts` unscoped-join hazard | unchanged | Unchanged | **P2** | `[PROD-QUERY]` |
| 16 | **New: two plan-match distance-band matchers, one fixed one not** | — | New this pass | **P1** — real, present-tense mis-matching exposure on the still-narrow-banded route | `[SOURCE]` |
| 17 | **New: `shoes.mileage` stale on 6/8 shoes** | — | New this pass | **P2** — any code still reading the raw column is materially wrong | `[PROD-QUERY]`+`[SOURCE]` |
| 18 | **New: cadence raw samples never persisted** | — | New this pass | **P3/P4** — a capability gap for any future cadence feature, not a current defect | `[SOURCE]`+`[PROD-QUERY]` |
| 19 | **New: `clockAudit`/`pausedSec`/`droppedGapSec` absent from `canonical.ts`'s `NEVER_COPY`** | — | New this pass, latent | **P2** — not yet fired, a real exposure | `[SOURCE]` |
| 20 | **New: TestFlight build 290 is 2+ days stale relative to `main`; no ship commit exists after either WALKBACK merge** | — | New this pass | **P1** — a real, dated, operational gap: merged fixes are not reaching the runner | `[SOURCE]`+`[PROD-QUERY]` |

---

## 13. CROSS-DOMAIN AND CROSS-PASS DISAGREEMENTS — updated

### 13.1 v1's original disagreements — resolution status

1. **The `sectionPieces`/`workoutPhasePieces` mechanism (v1's central open item): SETTLED as to mechanism.** See §9.1. The one remaining gap is a disclosed Swift-render of the specific TestFlight build, not a mechanism ambiguity.
2. **Domain C Pass-3 vs. Pass-2 on Rule 21's scope: unchanged, stands as v1 resolved it** — `coach_intents`'s narrow claim survives; the overreach to "no auto-applied upward change ever" was already corrected within v1 itself.
3. **`pausedSec`/`droppedGapSec`, storage-side vs. submission-side findings: no longer merely "complementary, not walked end-to-end" — fully walked, see §6.** Both were partial views of the same single ingestion-gate drop point.
4. No domain-vs-domain contradiction on any raw quantitative fact — unchanged, still true.

### 13.2 New disagreements produced by this correction pass itself (not present in v1 — must be preserved, not silently resolved)

1. **Whether today's run remains denied `'executed'` under current `main`.** One correction session (the today-run settlement pass, §9.4) traced the exact field resolution and found `prescribedSec` resolves to `null` (not 60) for this run's recoveries — the check silently no-ops, and the run is likely *not* actually denied. A second correction session (the current-main reconciliation pass) independently re-derived the same check assuming `prescribedSec=60` (carried forward from the original phase table) and concluded the run *remains* denied, unaffected by WALKBACK-2. **This document resolves in favor of the first, deeper trace** (verified against the actual `workout_spec` JSON via a standalone script, corroborated by the live render's positive top-level narrative), while explicitly preserving that the second session's WALKBACK-2-merge findings (still merged, still Swift-side-unshipped) are independently correct and unaffected by which reading of the tolerance check is right.
2. **Whether the §9 dispute needed a render to settle, or was already settled by source-tracing alone.** The current-main reconciliation session concluded "no commit in the delta range touches this; still unresolved," working purely from ancestry checks. The today-run settlement session obtained a `[TEST]`-grade server-payload confirmation (not a `[RENDER]` — v2.1 correction, see item 1 of the delta log) and closed the mechanism question as far as the server/source side goes; the actual Swift-rendered screen for this payload is still unverified by anyone. Both sessions' individual statements were accurate about what each of them did; this document's synthesis reflects the more complete evidence while being precise about which evidentiary tier that evidence sits at.

### 13.3 v1 items now closed by this pass — remove from any future "open" list

- `recoveryExtensions`/`ceilingLift` consumer question — **found** (§1.B/§5).
- 7 run IDs from the 2026-08-30 incident — **confirmed by exact ID**.
- Whether the PR/race screen omits Rose Bowl Half — **resolved: neither screen has a defect**, v1 conflated two screens.
- Proposal-13 card correctness — **resolved: the card states no anchor directions at all**, so the original concern cannot apply; a different, real bundling-UX question remains, unscoped.
- "14 PROGRESS outcomes" — **resolved and reclassified** (§10).
- `SHADOW_EVIDENCE_EPOCH` mismatch — **fixed**.
- WALKBACK-1/2 merge status — **merged**, with the platform split stated precisely (§11a).

### 13.4 Genuinely still-open items (carried forward, unresolved)

- The two-applied-mutation rounding gap (12.1→12.0, 4.9→5.0 mi) — narrowed to 6 ruled-out mechanisms, still unexplained.
- The `planWorkoutId` provenance-timing puzzle (four cohort rows predating their documented writer) — pattern established, exact backfill mechanism not found.
- The `elevGainFt`/`elevGainSource` contradiction's exact write history — code contradiction confirmed, write sequence not traced.
- Run #9's missing per-phase `verdict` field — cause not identified.
- 08-31's 205-second cross-source duration gap with no corresponding pause signal — genuinely unexplained.
- Whether Railway's deploy of the WALKBACK merges actually succeeded — read-only pass cannot confirm; disclosed gap, not assumed.
- Whether any RPE reader correctly walks absorption for the one orphaned RPE row — untraced.
- Whether heat-adjustment math treats an `apple_hk` weather reading with more trust than `open-meteo` — untraced.
- Whether `apple_watch` vs. `watch` as `data.source` values reflects an active fork or a benign historical rename — untraced.
- The genuine UX-bundling question proposal-13-style cards raise (one net badge/headline over six anchor moves, one moving opposite the rest) — a real, unscoped design question, not a defect.

---

## 14. TRANSFER SECTION — for the integration agent (rewritten to be fully self-contained; every fact stated once, with its evidence tag; no forward references to source material)

### (a) Facts to add to or correct in the canonical master ledger

1. **The §9 mechanism dispute is settled; the render question is separate and still open.** RUNNER_DAVID's reported "not completed, no pace" symptom is fully explained by a now-deleted Swift component (`workoutPhasesTile`, live 2026-09-04 through its deletion by `154edbf97` on 2026-09-08) that was compiled into every TestFlight build across that window, including build 290 — the newest build ever uploaded (not the only one ever shipped; a long ship history precedes it, e.g. builds 275 and 278), confirmed via the App Store Connect API. The exact build his phone was running at the moment of the run is not queryable (never transmitted to the server), so "build 290 specifically" is the best-evidenced `[INFERENCE]`, not a certainty — any build in that window produces the same symptom. Separately, a `[TEST]`-grade call to the actual current-`main` production route confirms the SERVER PAYLOAD for today's run is correct today: phase-keyed, real pace on every recovery, zero occurrences of "not completed." The CLIENT source path that would render that payload was traced (`[SOURCE]`) and is consistent with a correct render — but no simulator or device build has actually confirmed what the Swift client draws from it. **The fix (`154edbf97`'s deletion) is merged to `main` but has never shipped in any TestFlight build.** `[SOURCE]`+`[PROD-QUERY]`+`[TEST]`.
2. **The recovery-duration tolerance check silently no-ops on every strides-shaped workout, including today's.** Grading resolves the prescribed recovery duration via `workout_spec.rep_rest_s` (rep-workout vocabulary); strides-shaped specs carry `strides_recovery_s` instead — a different, never-read field. For today's run, this means `prescribedSec` is `null`, not the model's own 60-second target, for all six recoveries; the check returns "no signal" and does not deny the `'executed'` verdict. Two genuinely short recoveries (Δ36s, Δ52s against the model) are real facts about this run's execution that are currently discarded as unknown rather than evaluated — for every strides day this account has run or will run. **Still live and unfixed on current `main`.** `[SOURCE]`+`[TEST]`.
3. **`pausedSec` is dropped at the exact moment it is correct, not because nothing sends it.** Three Swift senders exist (two treadmill consoles, one live in the Watch app's own Pause/Resume control, which additionally distinguishes manual from automatic (speed-threshold) pauses in-app via a `pausedAutomatically` flag that is never transmitted — that distinction is lost before the wire and is not recoverable after the fact); the watch sender has fired 8 times in this account's real history, including a 27-minute pause, of unknown manual/automatic mix. The server's `clockAudit` reconciliation discards the pause figure, unwritten, the instant it successfully explains the wall-clock gap — the normal, correct case. Every one of those 8 real pauses resulted in a canonical row with no trace of the pause anywhere. Grading has zero wiring to this field at any point. No product surface, at any layer, has ever told RUNNER_DAVID how long he paused on a run where he genuinely paused. **Persisting the raw fact, displaying it, and using it in grading are three separate decisions — this finding supports only the first; the other two are open product questions, not implied fixes.** `[SOURCE]`+`[PROD-QUERY]`.
4. **A real automatic upward adaptation exists in this app's history** (2026-06-02, an engine-side `plan_proposals` row, `direction: UP`, 62.2% drift, `source: drift_cron_auto`) producing a plan rebuild that moved the authored weekly-volume basis 20.1→35.7 mi/wk (77% jump), continuing to 39.1 over the following ~3 weeks. This left zero trace in `coach_intents`. Rule 21's narrow "zero upward, 321 rows" finding remains true and correctly scoped to that table specifically — but `coach_intents` is a demonstrably incomplete record of upward adaptation, not proof none occurred. The mechanism that produced this instance is retired as of 2026-09-02 (detect-only since that date). `[PROD-QUERY]`+`[SOURCE]`.
5. **The "14 PROGRESS outcomes" figure is real, reproducible, and answers a different question than Rule 21's own claim.** It is the output of a still-existing, database-free replay harness that runs the current adaptation engine against RUNNER_DAVID's real historical training as if it had been live the whole time — a capability metric ("would the engine have pushed?"), not a production log. Re-run fresh this pass: PROGRESS 14 / HOLD 64 / REGRESS 4 / REFUSE 38. Of the 14, 13 were suppressed by a documented weekly-cadence arbitration rule; 1 was unsuppressed. None of the three production adaptation tables show this number because none of them is what it describes. `[TEST]`+`[PROD-QUERY]`.
6. **`SHADOW_EVIDENCE_EPOCH`'s pin mismatch is fixed.** Independently re-recomputed via SHA-256 against both the task's stated current-main pin and the actual live tip; both match the pinned value exactly. `[SOURCE]`+`[TEST]`.
7. **Five non-matching adaptation-decision vocabularies still coexist** (doctrine's 4-value enum, `adaptation-model.ts`'s 4-value enum, the shadow-log's DB-enforced 4-value CHECK, `dose-responsive.ts`'s 3-value set, Migration 166's 8-value ledger enum) — unchanged, unfixed, a Rule-16 violation at the schema/type level. `[SOURCE]`.
8. **A second instance of the `RUNNER_AUTHORITY_TIERS`-style side-door duplication has been found:** two independently-coded plan-match distance bands (`[0.7,1.3]` symmetric vs. `[0.7,2.0]` asymmetric) live in two different ingestion routes; only one received the OVERRUN-MATCH-1 fix. `[SOURCE]`.
9. **The HR-flatline guard is confirmed not to reach LTHR, max-HR, HR-zone-bucket, readiness, OR VDOT eligibility** — a third non-consumer beyond what was previously established, and for VDOT specifically, the reason is that a flatlined session's `intervals` type label satisfies the honesty gate's OR-condition independent of HR. `[SOURCE]`.
10. **`recoveryExtensions`/`ceilingLift` have a real, live, five-file-deep consumer** — a "Wrist Decisions" panel in Run Detail, reached via the run-detail API. Move these out of any "collected but unused" ledger; a render to confirm the panel actually draws for a real row is the one remaining step. `[SOURCE]`.
11. **All 6 of RUNNER_DAVID's races with results reach the schedule/history screen unconditionally by construction.** The separate, bucketed personal-records screen correctly shows only 2 (fastest-per-distance-bucket) by design. Neither screen has a completeness defect; v1's "which races are omitted" concern was about two different screens conflated as one. `[SOURCE]`.
12. **Proposal 13's rendered card states no individual anchor direction at all** — only a single threshold-lever headline, one net-direction badge, a reason sentence, a session count, and a two-sentence confidence detail. The audit's own prose reversed 2 of 4 anchor directions in its internal-payload description, but that data never reaches a rendered sentence either way. A real, separate UX question about bundling six anchor moves behind one net badge remains open. `[SOURCE]`+`[PROD-QUERY]`.
13. **The stored `shoes.mileage` column is materially stale on 6 of 8 shoes** (up to ~12× off), independently re-confirmed this pass; the canonical value is computed live at read time and any code still reading the raw column is wrong. `[PROD-QUERY]`+`[SOURCE]`.
14. **Raw per-second cadence data is never persisted past a transient ingestion query** — a stronger, structural gap than "collected but discarded downstream." A future cadence-variability feature needs a new ingestion path, not a new query. `[SOURCE]`+`[PROD-QUERY]`.
15. **A dead legacy table, `workout_routes`, holds 24 rows of richer per-mile route/elevation data for this account**, orphaned by the PORT-1 cutover, read/written only by the retired `legacy/web` app, zero live-app readers. `[SOURCE]`+`[PROD-QUERY]`.

### (b) Fixes that should enter the current release scope

**v2.1 correction — release SEQUENCE, not a flat list.** v2 listed "ship a new TestFlight build" as item 2, ahead of several items that are themselves accepted defects still open on `main`. That ordering is wrong: shipping a build before the P0 below is fixed would distribute `workoutPhasesTile`'s absence (real progress) while carrying the still-live, more consequential recovery-honesty no-op forward into a build RUNNER_DAVID would reasonably read as "fixed." Build 290 being stale is a real shipping gap, but shipping current `main` immediately is not the answer — the sequence is: **integrate the fixes below → run the project's full gate suite (doctrine, palette, normal-window, client-graph, etc. per `CLAUDE.md`) → cut a release candidate → verify physically (simulator/device render of at least §9's outstanding render gap and the recovery-honesty fix, per Rule 13 — do not ship on source-trace confidence alone for either) → distribute.**

1. **Fix the recovery-honesty tolerance check's field mismatch** (`rep_rest_s` vs. `strides_recovery_s`) — either read both fields, or introduce one canonical resolver per Rule 16. This is the single most consequential unfixed finding in this entire pass (item a.2), and the release-blocking item that must land before any new build is cut.
2. Correct the false premise in the `pausedSec` comments (`postrun/experience.ts`, `postrun/load.ts`) — as a report of a false invariant, not as a decision to make pause data affect grading (see §6.1 / item 7 of this delta log: whether pause should ever reach grading is a separate, undecided product question).
3. Propagate the OVERRUN-MATCH-1 distance-band fix to `watch/workouts/complete/route.ts` — demonstrated, not merely structural, on the app's primary live-tracked-workout completion path (§8a row 6 / §13); judged release-blocking execution-identity work for the same reason item 1 is.
4. Add `clockAudit`/`pausedSec`/`droppedGapSec` to `canonical.ts`'s `NEVER_COPY` set before a second writer creates a real absorption-clobber loss.
5. **Only after 1-4 are integrated and gated:** cut a release candidate, physically verify (§9's outstanding render, plus a direct check that the recovery-honesty and matcher fixes behave as traced), and distribute a new TestFlight build. `workoutPhasesTile`'s deletion (`154edbf97`), WALKBACK-1, and WALKBACK-2's server half are already merged to `main` and will ride along with this build once it ships — but shipping is the LAST step here, not a parallel or earlier one.

### (c) Larger architecture work for later

1. Consolidate the five adaptation-decision vocabularies into one canonical enum.
2. Decide the fate of `recommendation.ts`'s orphaned state machine.
3. Wire the HR-flatline guard into LTHR/max-HR/HR-zone-bucket/readiness/VDOT, or argue explicitly why each should remain exempt.
4. Consolidate `RUNNER_AUTHORITY_TIERS` and the two plan-match distance bands into single canonical exports.
5. Stamp a persisted, rule-version-anchored run-level ladder verdict, per Rule 10's own three-way posture — today it is pure recompute with no anchor at all, which the doctrine does not treat as a sanctioned posture.
6. Decide whether pause time should ever reach grading, for any run type, not just recoveries.
7. Give the raw cadence stream a real ingestion path if any future feature needs intra-mile cadence variability.

### (d) Production/data actions requiring explicit approval — never assume approval

1. Applying Migration 166 (`plan_decision_ledger`) — DDL, requires explicit per-statement approval.
2. Confirming and, if needed, re-triggering the Railway deploy for the WALKBACK merges — a production-visibility action, not a code change, but still worth an explicit go given it changes live grading behavior.
3. Shipping a new TestFlight build — an externally-consequential action in its own right.
4. Any retroactive repair of `coach_intents`'s missing record of the 2026-06-02 upward drift event, if repair is even desired — a historical-data write.

### (e) Items that remain genuinely unknown

1. Whether Railway actually deployed the WALKBACK merges — read-only access cannot confirm this; disclosed as a gap, not assumed either way.
2. The provenance of the 12.1/4.9 → 12.0/5.0 rounding gap — 6 mechanisms ruled out, still unexplained.
3. The exact backfill mechanism behind four cohort rows' pre-dated `planWorkoutId`.
4. The `elevGainFt`/`elevGainSource` contradiction's exact write history.
5. Whether any RPE reader correctly walks absorption for the one orphaned RPE row.
6. The 08-31 205-second cross-source duration gap with no corresponding pause signal.
7. Whether heat-adjustment math trusts an `apple_hk` weather reading differently from an `open-meteo` one.
8. Whether `apple_watch` vs. `watch` as `data.source` values is an active writer fork or a benign historical rename.
9. The genuine UX-bundling design question proposal-13-style cards raise — unscoped, not a defect.

---

## 15. ARTIFACT PROVENANCE (v2.1 addition, per instruction)

| Field | Value |
|---|---|
| Audit base SHA (original v1/v2 pin) | `8559245496bf498d3d4b0479e1117ae416988c4a` |
| `origin/main` at v2.1 completion (re-fetched live) | `99757c1204f27a1fa86504efd580842bc81c72b2` |
| Audit branch used to PRODUCE this content | None — every edit in v2.1 was made directly to working-tree files via Read/Edit, no branch was created or switched for this pass |
| **Shared-checkout finding, disclosed rather than acted on:** | This repository's working tree is currently checked out on `audit/brain-forensic-2026-09-10` — a branch this session did not create, carrying 2 unpushed commits (`5b41b0d99`, `c99d924ea`) authored by a **different, concurrent session** doing unrelated work (a "Brain/adaptation forensic report" — see `docs/audit-2026-09-09-coach-forensic-audit.md`, which appeared mid-session and was left untouched). That branch was created off `origin/main` at `80fca013f`, itself now behind the current tip. Because this is a shared checkout (per `CLAUDE.md`'s own standing warning that a second agent is frequently committing concurrently), this session did not check out a different branch or commit anything — doing either would move HEAD out from under the other session's in-progress work. |
| Final report commit SHA | **Not committed.** See the branch finding above — committing requires deciding which branch these files belong on, and that decision is not this session's to make unilaterally on a checkout another session is actively using. Flagged in the delta log and the chat response as a decision for you. |
| v2.1 file hash (SHA-256) | *(computed and reported in the chat response after this file's content was finalized, to avoid a hash that goes stale mid-edit)* |
| Delta-log file hash (SHA-256) | *(same — reported alongside the v2.1 hash)* |
| Final `git status --short` (docs/ only, at hand-back) | *(captured and reported in the chat response, alongside the hashes, as the true final state)* |

---

*End of v2.1 consolidated handback. This document performed no writes, migrations, merges, or proposal decisions — read-only throughout, consistent with every session that contributed to it (the one exception, disclosed at the point of use: the today-run settlement session used a local, throwaway Postgres copy built from `DATABASE_URL_RO` to execute real server code, torn down after use — zero production writes). Every finding above traces to one or more of the original four domain reports, the six v2 correction/completion passes, or this v2.1 pass's own `[SOURCE]`/`[PROD-QUERY]`/`[TEST]`/`[DEVICE]`/`[INFERENCE]`/`[BLOCKED: reason]` evidence. No `[RENDER]` evidence survives in this document as of v2.1 — see item 1 of the delta log. Where any two passes disagreed with each other, that disagreement is preserved explicitly (§13) rather than resolved by authorial fiat alone.*
