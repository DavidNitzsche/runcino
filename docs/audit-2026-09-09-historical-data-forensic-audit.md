# FINAL CONSOLIDATED HANDBACK — faff.run Historical-Run Data Forensic Audit (v1)
## RUNNER_DAVID's Real Running Data: Inventory, Lineage, Consumption, and Surfacing

**SUPERSEDED — kept for history only, do not cite as current.** A targeted correction/completion pass found this v1 document's §9 dispute was resolved via the wrong mechanism, its phase-table math had an arithmetic error, its 14-day truth table and data-quality register were incomplete relative to the original brief, and several "unmerged"/"unresolved" claims are now stale. See `docs/audit-2026-09-09-historical-data-forensic-audit-v2.md` (the corrected, complete report) and `docs/audit-2026-09-09-historical-data-forensic-audit-v1-to-v2-delta-log.md` (exactly what changed and why) before acting on anything below.

---

## HEADER

**Pinned commit (source-of-truth for all `[SOURCE]` citations across all four domains and their reviewers):** `8559245496bf498d3d4b0479e1117ae416988c4a` (`origin/main` at audit start)

**Runner:** RUNNER_DAVID, `RUNNER_DAVID`, resolved `user_uuid`/`users.id = <RUNNER_UUID_REDACTED>` (independently re-resolved by all four domain reviewers, byte-identical every time)

**Data window:** Full 2026 canonical run history (287 total `runs` rows, 162 canonical / 125 absorbed) plus a focused 14-day detailed cohort (per Domain B) and a single-day deep trace on today's run, 2026-09-09 (`runs.id = -218380344929823`)

**Agents and reviewers used (8 total sessions across 4 domains, each independently falsified by a second pass):**
- **Domain A** — Data Inventory and Lineage: original audit + independent Pass-2 reviewer
- **Domain B** — Historical-Run Cohort Audit: original audit + independent Pass-2 reviewer
- **Domain C** — Consumption, Learning and Adaptation: original audit, a Pass-2 reconciliation, + independent Pass-3 falsifier
- **Domain D** — Runner-Facing Surfacing and Usability: original audit + independent Pass-2 reviewer
- **This document** — a fifth, compiling pass. It performed no new database queries or source reads of its own; it is a structural synthesis of the four *already-completed and independently-reviewed* domain reports supplied verbatim above, reorganized into the requested exhibit structure, with every evidence tag, disagreement, and reviewer correction preserved rather than smoothed over. Where the four reports disagree with each other (not just within-domain reviewer disagreements), that is surfaced explicitly in §9, §10, and §13 below rather than resolved by picking a side.

**DB access used by the four domain passes:** `faff_readonly` role via `DATABASE_URL_RO`, independently confirmed SELECT-only (58 grants, zero INSERT/UPDATE/DELETE/TRUNCATE) by at least one pass. No write-shaped SQL was issued by any of the eight sessions.

**Evidence limitations carried into this compilation, stated plainly rather than hidden:**

1. **No domain, and no reviewer of any domain, ever rendered the app.** Every finding about what David's phone actually shows is either `[SOURCE]`-traced (what the code *should* produce) or `[DEVICE]`-cited secondhand (David's own words, reported in the canonical handback this audit reconciles against, not independently re-observed by any of the eight sessions in this audit). Domain D's own reviewer names this explicitly as "the load-bearing weakness in every version of this finding so far" (see §9).
2. **`origin/main` moved during the audit.** Domain C's reviewer disclosed that `git fetch origin main` mid-review found `origin/main` had advanced to `8b9fb31595cf5c5ed0f822e5df1c814fc7809116` — another agent pushed concurrently, consistent with CLAUDE.md's standing warning. All citations in all four domains remained pinned to `8559245...` throughout; this is disclosed, not acted on.
3. **A ready-but-unmerged integration branch exists.** `integration/programme-lead-merge-2026-09-09` (merge commit `e5bcc430b`, ~2 hours after the pin) already composes WALKBACK-1 and WALKBACK-2 for both Swift and TS, confirmed not-yet-ancestor of the pin or (at each domain's respective check time) of `origin/main`. Domain C's reviewer separately confirmed that by the time `origin/main` had moved to `8b9fb3159...`, this branch's merges *were* already contained in the new tip — meaning the unmerged status is a snapshot fact, not a durable one, and may already be stale by the time this handback is read.
4. **Domain B did not attempt a live render either**, and says so explicitly, deferring to "Domain D." Domain D's own central finding (§9 below) turned out to directly contradict Domain B's and Domain A's shared assumption about the mechanism — which is exactly why this compilation cannot simply adopt one domain's account as ground truth.
5. Every table below reproduces the specific evidence tag (`[SOURCE]` / `[TEST]` / `[PROD-QUERY]` / `[RENDER]` / `[DEVICE]` / `[INFERENCE]` / `[BLOCKED: reason]`) the originating domain or its reviewer used. Where a reviewer corrected or contradicted the original claim, both are shown with the reviewer's verdict taking precedence, per the instruction to preserve, not paper over, disagreement.

---

## 1. COMPLETE FIELD-LINEAGE MATRIX (from Domain A)

All population counts are against the **162 canonical rows** (`NOT (data ? 'mergedIntoId')`) for this user unless stated otherwise. All figures below are `[PROD-QUERY]`, independently re-confirmed exact by Domain A's reviewer.

| Field / mechanism | Storage location | Population (of 162 canonical) | Notes | Tag |
|---|---|---|---|---|
| `data.hrZonePcts` | `runs.data` jsonb | 34/162 | — | `[PROD-QUERY]` |
| `data.phases` | `runs.data` jsonb | 52/162 | — | `[PROD-QUERY]` |
| `data.planWorkoutId` | `runs.data` jsonb | 9/162 (Domain B separately re-derives "2 of 159" for a related but not identical slice — see §2) | — | `[PROD-QUERY]` |
| `data.clockAudit` | `runs.data` jsonb | 4/162, dates 2026-08-21/08-23/08-24/09-02; `pausedSec`=`declinedSec`=0 on all 4 | See correction below — the zero is empirical, not structural | `[PROD-QUERY]` |
| `data.repSkips` | `runs.data` jsonb | 0/162 | Confirmed via two independent query shapes | `[PROD-QUERY]` |
| `data.recoveryExtensions` | `runs.data` jsonb, **top-level array**, not nested in phase objects | 1/162 (row `-145861381014809`, four `addedSec:30` entries at `phaseIndex:10`) | Reviewer's own first-pass query (checking inside phase objects) wrongly returned 0 before correcting nesting level | `[PROD-QUERY]` |
| `data.ceilingLift` | `runs.data` jsonb, top-level array | 3/162 (`-245190372869167`, `-145861381014809`, `-255291701482225`) | Same nesting correction as above | `[PROD-QUERY]` |
| `data.status` | `runs.data` jsonb | 15/162 present, 1 `abandoned` | — | `[PROD-QUERY]` |
| `data.ruleOutcomes` | `runs.data` jsonb | 0/162 | Checked top-level AND nested via `jsonb_path_exists(..., '$.**.ruleOutcomes')` | `[PROD-QUERY]` |
| `data.source` distribution | `runs.data` jsonb | 88/69/56/33/21/11/9 across all-time 287 rows, sums to 287 | — | `[PROD-QUERY]` |
| `data.elevGainSource` distribution | `runs.data` jsonb | 91 key-absent / 33 raw / 18 absent / 8 treadmill_incline / 6 gps_derived / 3 recomputed / 3 watch, sums to 162 | — | `[PROD-QUERY]` |
| `canonicalLabel` / `canonicalFinishS` | `runs.data` jsonb | Present as keys, **permanently null** every row | Auto-detected-best-effort mechanism retired, not renamed | `[SOURCE]` `web-v2/lib/runs/run-shape.ts`'s `RunData.canonicalLabel` doc comment |
| `weather.dewpointF` | `runs.data.weather` jsonb | **0/162, never stored on any row, ever** | Computed at read time via Magnus-Tetens instead; 124/162 rows carry `weather{}`, 130/162 carry legacy `tempF` | `[PROD-QUERY]` + `[SOURCE]` (`heat-model.ts`) |
| `pausedSec` / `droppedGapSec` on `clockAudit` | `runs.data.clockAudit` jsonb | 0/4 non-zero (empirically zero on every row ever written) | **See dedicated correction below — the code's own claim that this is structural is FALSE.** | `[PROD-QUERY]` + `[SOURCE]` |
| `target_duration_sec` on recovery phases | `runs.data.phases[].targetDurationSec` | **0/6 populated** on today's run's recovery phases; no `targetDurationSec` key present at all, only `targetPaceSPerMi` | Server-side `GradedPhase.targetDurationSec` is therefore also null downstream | `[PROD-QUERY]` (Domain D reviewer, upgraded from Agent D's original `NOT_RE_TESTED`) |
| `source_mode` / `sourceMode` | Code-level, across `capacity-resolver.ts`, `decision-ledger.ts`, `reanchor-plan.ts`, `reprice-payload.ts`, `race-outlook-payload.ts`, `runner-state/store/*` | N/A (code presence, not row population) | Exactly the 9-file set claimed | `[SOURCE]` |

### The pausedSec/droppedGapSec field-lineage correction (Domain A reviewer's central finding)

Two in-repo TS comments (`web-v2/lib/postrun/experience.ts:1172-1173`, `web-v2/lib/postrun/load.ts:705-706`) assert as settled fact that **"no Swift file in this repository sends either field"** and therefore both are "structurally 0" on every row. Domain A's reviewer checked this directly:

`[SOURCE]` `git grep -ln "pausedSec\|droppedGapSec" -- '*.swift'` at the pinned commit returns **seven** files, two of which are live, currently-wired, current-generation views (not legacy):
- `native-v2/Faff/Faff/Views/TreadmillView.swift:1074-1076` — constructs `payload["droppedGapSec"]` and `payload["pausedSec"]` from `session.belt.droppedSec`/`pausedSec` when `>= 1`
- `native-v2/Faff/Faff/ViewsV5/LiveRunTreadmillV5.swift:671-673` — identical construction

Both POST to `api/watch/workouts/complete`, whose server route (`route.ts:576-591`) reads `body.pausedSec`/`body.droppedGapSec` directly into `clockAudit.pausedSec`/`declinedSec`. Both Swift views are reachable from current UI (`RootTabView.swift`, `HostsV5.swift`), not dead code. Direct empirical corroboration: two of David's nine treadmill rows already carry `unmeasuredSec`, the sibling field gated by the identical `>=1` conditional in the same payload block — proof the belt-tracking mechanism is live and firing in production, just never (yet) with a nonzero pause.

**Field-lineage verdict:** `pausedSec`/`declinedSec` = 0 on every historical row is an **empirical fact about this account's history so far**, not a structural guarantee. The two TS comments assert an unverified invariant as settled fact — precisely the Rule 19/20 failure mode the codebase's own doctrine warns against, made sharper because the comments explicitly invoke Rule 11 ("a missing input must never silently disable a safety mechanism") as their justification for stripping the fields, while their own premise violates that same rule. If David ever pauses a treadmill session long enough (`belt.pausedSec >= 1`), the field will populate, the route will store it, and the two `postrun` readers currently discarding it on a false premise will begin silently losing real data with no gate anywhere that would notice. **[SOURCE], contradicting the report's own carried-forward claim.**

---

## 2. HISTORICAL-RUN TRUTH TABLE (from Domain B, incl. 14-day cohort)

### 2.1 Aggregate canonical/absorbed split (2026, this user)

| Metric | Value | Tag |
|---|---|---|
| Canonical rows, 2026 | 162 rows / 1208.3 mi | `[PROD-QUERY]`, independently re-confirmed byte-identical by reviewer |
| Absorbed rows, 2026 | 125 rows / 971.0 mi | `[PROD-QUERY]`, same |
| Orphaned-absorption rows (stamp set, `mergedIntoId` null/dangling) | **0** | `[PROD-QUERY]`, independently confirmed by both Domain B's and Domain C's reviewers |
| 2026-08-30 canonical-dataloss repair (63 mi, 7 named rows) | Holds durably: 0 rows/0 mi on reused detection query, all 7 rows individually re-verified with correct un-absorbed distances (18.0 mi 07-25, 13.13 mi 06-14, etc.) | `[PROD-QUERY]`, exact, Domain A |

### 2.2 Case-by-case cohort findings

| Case | Finding | Verdict after review | Tag |
|---|---|---|---|
| **5.1** — Overrun-match | 6.18 mi run matched to 4.5 mi prescription via asymmetric `[0.7×, 2.0×]` band (`OVERRUN-MATCH-1`/`EXECIDENT-2`); "2 of 159 canonical rows carry `planWorkoutId`" quote matches David's own words in-code | **CONFIRMED-BY-ME, exactly**, including verbatim comment text and test's own worked example | `[SOURCE]` |
| **5.2** — Dual-run tie-break | 09-03: treadmill (4.71mi/21 phases/4 splits/indoor/avgHr 129) vs apple_watch (4.48mi/0 phases/5 splits/avgHr 140); `richer()`/`pickRichest()` selects by phase-count first | **CONFIRMED-BY-ME, exactly, including the 11 bpm HR gap** | `[SOURCE]` + `[PROD-QUERY]` |
| **5.3** — Race chip vs. raw watch | AFC race: chip 1:41:53 (6113s) vs. raw watch elapsed 1:42:33 (6153s), gap 40s | **CONFIRMED-BY-ME, exact** | `[PROD-QUERY]` |
| **5.4** — Pause data discarded at submission | `pausedSec`/`pauseSec`/`elapsedSec`/`pauseCount` absent from every canonical row | **CONFIRMED on the storage-loss claim; CONTRADICTED on "every single payload" framing** — full 13-row `watch_completion` population (not just the curated 8) includes 5 rows with no `pausedSec` field at all | `[PROD-QUERY]` |
| **5.5** — "14 PROGRESS outcomes" | Claim unreproducible; actual shadow-log counts are 8 (of 24) and 0 (of 36) | **CONFIRMED-BY-ME** — see §10 for the full cross-domain reconciliation | `[PROD-QUERY]` |
| **§6** — Today's run pace/phase data | All 14 raw phases carry nonzero `actualDistanceMi`/`actualDurationSec`; `routePhases`/`sectionPieces`/`workoutPhasePieces` chain traced at source | **CONFIRMED-BY-ME, exact table match** — but see §9, where Domain D's own reviewer directly contradicts the *downstream consequence* Domain B's pass attributed to this chain | `[SOURCE]` + `[PROD-QUERY]` |

### 2.3 Today's run — full raw phase table (the 14-day cohort's most recent entry, `runs.id = -218380344929823`, 2026-09-09)

Cross-confirmed identically by Domain A's reviewer, Domain B's original and reviewer passes, and Domain D's reviewer — this is the single most independently-re-derived table in the whole audit.

| idx | type | label | completed | mi | sec | pace/note |
|---|---|---|---|---|---|---|
| 0 | work | long | true | 5.01 | 2607 | — |
| 1 | work | stride | true | 0.05 | 20 | — |
| 2 | recovery | walk back | **false** | 0.04 | **30** | prescribed 60 — FAIL (Δ36 > 30 tolerance is close but see idx 4/6) |
| 3 | work | stride | true | 0.05 | 22 | — |
| 4 | recovery | walk back | **false** | 0.05 | **43** | prescribed 60 |
| 5 | work | stride | true | 0.05 | 21 | — |
| 6 | recovery | walk back | **true** | 0.06 | **61** | prescribed 60 — passes tolerance |
| 7 | work | stride | true | 0.05 | 20 | — |
| 8 | recovery | walk back | **false** | 0.03 | **24** | prescribed 60 — **FAIL, |24-60|=36>30** |
| 9 | work | stride | true | 0.05 | 22 | — |
| 10 | recovery | walk back | **false** | 0.06 | **38** | prescribed 60 |
| 11 | work | stride | true | 0.05 | 21 | — |
| 12 | recovery | walk back | **false** | 0.03 | **8** | prescribed 60 — **FAIL, |8-60|=52>30** |
| 13 | overtime | — | — | 0.01 | 10 | — |

**Consequence, traced at source and confirmed by Domain A's reviewer (a step Domain A's original report explicitly deferred):** `recoveriesHonestOf()` (`execution-semantics.ts:700-710`) is a pure duration-tolerance check against `RECOVERY_DURATION_TOLERANCE = 0.5` (i.e., 30s at `:639`), does **not** read the `completed` boolean, and does **not** reference `recoveryEndedEarly`/`RecoveryEndedEarlyRecord` (absent from the pinned commit entirely — confirmed zero hits repo-wide). 2 of 6 recoveries (phases 8 and 12) fail the tolerance. `sessionLadder`'s sole path to the `'executed'` verdict requires `recoveriesHonest !== false` — so **today's run is denied the `'executed'` verdict under the pinned code**, a concrete, present-tense, live instance of the WALKBACK-2 defect class the two unmerged branches (`7b0163c85`, `e80524809`) were built to fix.

---

## 3. PER-CONSUMER EVIDENCE MATRIX — the six-way distinction (from Domain C)

Legend: **E**=exists in code, **R**=readable/queryable, **L**=live call-path reached in production, **P**=persisted to a durable store, **B**=behavior-changing (actually alters what the runner is prescribed/shown), **U**=UI-reaching (confirmed to actually surface on a screen).

| Mechanism | E | R | L | P | B | U | Notes / tag |
|---|---|---|---|---|---|---|---|
| `hrTraceIsCredible()` / `workTraceIsCredible()` (`hr-trace-credibility.ts`) | ✅ | ✅ | ✅ (6 non-test callers confirmed by direct grep: `canonical-shadow/live-input.ts`, `volume-evidence/admit.ts`, `brain/orchestration/steps.ts`, `evidence/classify-evidence.ts`, `plan/adjudication/dose-responsive.ts`, `runner-state/ownership.ts`) | N/A (a predicate, not a stored value) | ✅ (feeds `classify-evidence.ts`, i.e. changes evidence classification for HR-based decisions) | ❓ UNTESTED | `[SOURCE]`. Domain C reviewer could not reproduce the original "8 files" caller count — found 6, flags rather than accepts |
| LTHR re-anchor / max-HR / HR-zone-bucket / readiness | ✅ | ✅ | ✅ (own paths) | ✅ | ✅ | ❓ | **Confirmed NOT to consume the flatline guard** — zero overlap between the flatline-credibility caller set and these four mechanisms' own files, meaning Case 3's flatlined treadmill HR (below) can still feed LTHR/readiness math uncontested | `[SOURCE]`, upgraded from Pass 2's `NOT_RE_TESTED` |
| `CANONICAL_ROW_SQL` / `runNotMergedSql()` | ✅ | ✅ | ✅ | N/A (predicate) | ✅ (gates every canonical-vs-absorbed read) | ✅ (indirectly, via every surface built on canonical rows) | `[SOURCE]` — same predicate under two names, confirmed by direct read of both definitions |
| `RUNNER_AUTHORITY_TIERS` | ✅ (×2, duplicated in `vdot-inputs.ts` and `durability-anchor.ts`) | ✅ | ✅ both copies | N/A | ✅ | ❓ | Genuine side-door duplication of a value both files claim to derive from one shared type — see §8 |
| `SHADOW_EVIDENCE_EPOCH` pin | ✅ | ✅ | ✅ (CI gate) | N/A | ❓ (unclear if this specific epoch mismatch changes any runtime decision) | N/A | **Live, reproducible CI-failure-shaped mismatch**, independently re-derived by computing the SHA-256 of `race-outlook.ts` at the pinned commit and getting `18f75b129d5d3ae8` against the pinned value `79bc095d2f7ceb3b` — genuinely recomputed, not just re-quoted. `[SOURCE]` + `[TEST]` |
| `adaptation_shadow_log` | ✅ | ✅ | ✅ (writes, 24 rows) | ✅ | **❌ — "shadow" by design, does not change plan output** | ❌ (no UI surface confirmed) | 16 HOLD / 8 PROGRESS. `[PROD-QUERY]` |
| `canonical_adaptation_shadow_log` | ✅ | ✅ | ✅ (36 rows) | ✅ | ❌ (shadow) | ❌ | HOLD/LONG_RUN=11, REFUSE/LONG_RUN=1, REFUSE/THRESHOLD_PACE=12, REFUSE/WEEKLY_VOLUME=10, REGRESS/WEEKLY_VOLUME=2, **zero PROGRESS**. `[PROD-QUERY]` |
| `plan_mutations` (positive-drift) | ✅ | ✅ | ✅ (10 rows fired) | ✅ | ✅ for the 2 `status='applied'` rows — these genuinely raised a stored `distance_mi` | ❌ (no `coach_intents`/UI trace found for either applied row) | 8 seen / 2 applied confirmed at the aggregate level; the reviewer's own reason-group/status breakdown table is internally wrong in its row-level detail (see §11) |
| `plan_proposals` — `drift_cron_auto`, `direction: UP`, `volume_drift` | ✅ | ✅ | ✅ **(fired and produced a real plan rebuild, 2026-06-02)** | ✅ (`new_plan_id` populated, `authored_state.weeklyAvg4w` moved 20.1→35.7 across the lineage) | ✅ **materially** — a 77% jump in the plan's authored volume basis | ❓ — no `coach_intents` trace found in the 06-01–03 window | **This is the Domain C reviewer's single most consequential independent finding — see §10.** `[PROD-QUERY]` + `[SOURCE]` (`drift-monitor.ts`'s `checkVolumeDrift()`) |
| Plan-drift cron itself, current state | ✅ | ✅ | ✅ (still runs) | N/A | ❌ **as of 2026-09-02** — self-documented "DETECTED AND LOGGED ONLY... no proposal, no rebuild, no card" | ❌ | The upward-rebuild mechanism above is retired, not live today. `[SOURCE]` (route's own `GET` doc comment) |
| `plan_decision_ledger` (Migration 166) | ✅ (write path fully built: `recordDecision`, `recordDecisionInTransaction`, `TABLE_ABSENT` handling) | ✅ (code) | ✅ (10 confirmed live non-test importers — 4 named by the report + 6 more the reviewer found: admin route, `option-lane.ts`, `move-orchestrator.ts`, `mutate.ts`, `workout-proposals.ts`, `runner-state/store/lineage.ts`) | **❌ — table does not exist in production** (`to_regclass('public.plan_decision_ledger')` → null) | ❌ (cannot be, nothing persists) | ❌ | Fully wired, zero data. `[PROD-QUERY]` + `[SOURCE]` |
| `recommendation.ts` `STAY/PROGRESS/MODIFY/PROTECT` | ✅ | ✅ | ✅ (only importer: `app/api/coach/read/route.ts`) | ❓ | ❓ | **❌ — confirmed zero references to `/api/coach/read` anywhere in `native-v2` or `web-v2/components`** | Genuinely orphaned, not merely under-adopted. `[SOURCE]`, independently checked by reviewer |
| `coach_intents` (Rule 21 table) | ✅ | ✅ | ✅ | ✅ (321 rows) | N/A (a log, not itself a decision) | ❓ | **Never once logs an upward adaptation**, across 22 distinct reasons — but per the finding above, this is now known to be an *incomplete* record of upward adaptation, not proof none occurred. `[PROD-QUERY]` |

---

## 4. DATA-QUALITY AND ANOMALY REGISTER, WITH REAL COUNTS (from Domain B)

| # | Anomaly | Real count | Repaired? | Tag |
|---|---|---|---|---|
| 1 | 2026-08-30 canonical-run dataloss (63 mi, 7 rows absorbed into nothing) | 7 rows, 63 mi | **Yes — holds durably**, re-verified 0/0 on reused detection query, all 7 rows individually confirmed with correct distances | `[PROD-QUERY]` |
| 2 | 09-02 watch-truncation (0.43 mi) | 1 run (`-145861381014809`): phase-sum 5.98 mi vs. actual 6.41 mi, gap 0.43 mi | **Yes** — `manualCorrection` object present with matching before/after/source/reason text; `clockAudit.countedSec` (3057) internally matches pre-repair `durationSec` | `[PROD-QUERY]`, exact including full text match |
| 3 | `plan_workouts` population hazard | **4,124 total rows, 103 active (2.50%, not the report's own internally-inconsistent "2.3%")** | Not a repair — a live structural hazard (unscoped `date_iso` joins over a repeatedly-rebuilt plan history) | `[PROD-QUERY]`, resolving Pass 1's own internal 96-vs-103 inconsistency in favor of 103 |
| 4 | "2026-08-10 alone carries 43 rows" | **Not unique — 75 distinct dates tie at that same 43-row ceiling** | N/A — mischaracterization of a real, systemic hazard as a single-date outlier | `[PROD-QUERY]`, CONTRADICTED-BY-ME on "alone" |
| 5 | HR flatline, Case 3 (treadmill hill session, 2026-09-03) | 10/10 "Hill N of 10" work phases show `distinct_bpm = 1`, `n_samples` 11–19 | Not a repair — `hrTraceIsCredible`/`MIN_SAMPLES_TO_JUDGE=5` guard exists and is wired, but confirmed NOT consumed by LTHR/readiness/max-HR (see §3) | `[PROD-QUERY]`, exact all 10 phases; negative control (today's stride run) confirmed genuinely different distribution (48/2/4/5/7/3/11/4/4/3/5/4/1/0) |
| 6 | Dedup pair, 2026-05-31 | `-1722688244` (canonical) / `18270567015` (merged), both 26.81 mi, `absorbed_into_canonical_at = 2026-05-31T17:47:03.05Z` | Working as designed | `[PROD-QUERY]` |
| 7 | Race chip vs. raw watch gap, AFC | 40s (6113 vs. 6153) | Working as designed — chip is authoritative | `[PROD-QUERY]` |
| 8 | `pausedSec`/`droppedGapSec` field-lineage error | 2 in-repo TS comments assert a false invariant; 2 live Swift call sites contradict them | **Not repaired — an open, unactioned finding** (this audit is read-only) | `[SOURCE]`, contradicted the carried-forward claim |
| 9 | `SHADOW_EVIDENCE_EPOCH` pin mismatch | Pinned `79bc095d2f7ceb3b` vs. actual file hash `18f75b129d5d3ae8` | Not repaired — independently re-derived, live | `[SOURCE]` + `[TEST]` (self-computed SHA-256) |
| 10 | `plan_mutations` reason-group/status table error (within the review's own "most consequential" reconciliation) | Aggregate 8-seen/2-applied holds; the row-level reason-group breakdown attributing both `applied` rows to the "6% above" group is wrong — actual: "6% above"=6/6 seen, "10% above"=2/3 seen+1 applied, "9% above"=1/1 applied | The audit's own detail table needed correcting, not the underlying data | `[PROD-QUERY]` |
| 11 | Two-applied-mutation rounding gap | Proposed 12.1/4.9 mi vs. current `plan_workouts.distance_mi` 12.0/5.0 — close but not identical | **Genuinely open, unexplained by any pass** | `[PROD-QUERY]`, newly surfaced |
| 12 | `plan_proposals` upward volume-drift instance (2026-06-02) | 1 row, `direction: UP`, `pct_drift: 62.2`, produced `authored_state.weeklyAvg4w` 20.1→35.7 mi/wk (77% jump), lineage continued 35.7→37.6→39.1 over ~3 weeks, entirely via automatic `drift_cron_auto` triggers, **zero trace in `coach_intents`** | Not a data-quality bug per se — a **process/audit-trail gap**: real upward adaptation happened and is invisible to the very table (`coach_intents`) Rule 21 relies on | `[PROD-QUERY]` + `[SOURCE]`, see §10 |
| 13 | `watch_completion` payload population | 13 total rows in the 14-day window, 5 with no `pausedSec` field at all (not just the curated 8-of-8 the original pass sampled) | Not a repair — a sampling-completeness correction to the audit's own methodology | `[PROD-QUERY]` |
| 14 | Races enumeration undercounts | **6 races confirmed with results** (adds Rose Bowl Half, 2026-01-18, finishS 5918/1:38:38, previously omitted) | Not a repair — an audit-completeness gap: "confirmed six races" was paired with a 5-item list in Domain D's own text | `[PROD-QUERY]` |

---

## 5. "COLLECTED BUT UNUSED" INVENTORY

| Item | Where collected | Why unused | Tag |
|---|---|---|---|
| `pausedSec` / `droppedGapSec` | Sent by 2 live Swift views, stored into `clockAudit` by the server route | Two downstream TS readers (`postrun/experience.ts`, `postrun/load.ts`) discard/strip these fields on the false premise "nothing sends them" | `[SOURCE]` |
| `target_duration_sec` on recovery phases | Never populated on any recovery phase, server or raw storage | No writer populates it; only `targetPaceSPerMi` is carried for recovery phases | `[PROD-QUERY]` |
| `recoveryExtensions` / `ceilingLift` | Top-level arrays on `runs.data`, 1/162 and 3/162 respectively | No confirmed downstream consumer traced by any domain — collected at write time, not chased further | `[PROD-QUERY]`, consumer trace = `[BLOCKED: out of scope for this pass]` |
| `plan_decision_ledger` write path | Fully built (10 live non-test importers) | Table absent from production (Migration 166 not applied) — every call is presumably a no-op via `TABLE_ABSENT` handling | `[PROD-QUERY]` + `[SOURCE]` |
| `recommendation.ts` (`STAY/PROGRESS/MODIFY/PROTECT`) | Computed by a real, built state machine | Zero client callers app-wide of its sole entry route `/api/coach/read` | `[SOURCE]` |
| Reprice payload anchor-move detail (e.g. proposal 13's per-anchor deltas) | Computed and stored in `action_payload.reprice.anchorMoves` on `plan_workout_proposals` | Both `reprice`-kind proposals in the audited set are `dismissed`/`expired` — computed, never applied, and (per Domain D's reviewer) not even correctly summarized by the audit's own prose | `[PROD-QUERY]` |
| `elevGainSource` distribution detail (raw/treadmill_incline/gps_derived/recomputed/watch) | Populated on 71/162 rows | No domain traced a UI surface that differentiates by source; collected as provenance only | `[PROD-QUERY]`, consumer `[BLOCKED: not chased]` |

---

## 6. "USED BUT NOT SURFACED" INVENTORY

| Item | How it's used | Why not surfaced | Tag |
|---|---|---|---|
| `plan_mutations` positive-drift, 2 applied instances (2026-05-24/25) | **Behavior-changing** — genuinely raised stored `distance_mi` on 2 workouts | No trace in `coach_intents`, no trace in any UI history surface any domain could find; only discoverable by directly querying the `plan_mutations` table | `[PROD-QUERY]` |
| `plan_proposals` `drift_cron_auto` upward volume-drift (2026-06-02) | **Behavior-changing** — produced a full plan rebuild, moved `weeklyAvg4w` 20.1→35.7 (77%) | No `coach_intents` trace in the relevant window; the entire lineage (19.5→...→39.1 across 3 weeks) is invisible outside directly reading `plan_proposals`/`training_plans.authored_state` | `[PROD-QUERY]` + `[SOURCE]` |
| `hrTraceIsCredible()` flatline detection | **Behavior-changing** — feeds `classify-evidence.ts`'s evidence classification | No domain confirmed a UI surface that tells David "this HR trace was judged unreliable and excluded" | `[SOURCE]`, UI-reaching = ❓ untested |
| `adaptation_shadow_log` 8 PROGRESS entries with real magnitude text (2026-08-31 to 09-03, e.g. "QUALITY 5 sec/mi quicker... TAPER 9 sec/mi quicker") | Exists, has genuine coaching-relevant content | **By design, "shadow" — does not change plan output and is not confirmed to reach the runner** | `[PROD-QUERY]` |
| `RUNNER_AUTHORITY_TIERS` effort-authority classification | Used in both `vdot-inputs.ts` and `durability-anchor.ts` to gate what evidence counts | No domain traced whether the tier assigned to any specific run (representative/compromised/unrepresentative) is ever shown to David | `[SOURCE]`, UI-reaching = ❓ |

---

## 7. "SURFACED BUT NOT TRUSTWORTHY" INVENTORY

| Item | What's surfaced | Why it may not be trustworthy | Confidence / status | Tag |
|---|---|---|---|---|
| Today-tab phase/pace breakdown for a run with sub-mile walk-backs (today's run is the live example) | Either `sectionPieces` (graded, paced, honest-silence on recovery verdicts) or `workoutPhasePieces` (fallback, string-labeled "not completed") — **which one fires for this exact run is directly disputed between Domain D's original pass and its own reviewer.** See §9 for the full unresolved disagreement. | If the fallback lane fires when it shouldn't, the runner sees an unlabeled, pace-less, potentially wrongly-worded completion state for real data | **DISPUTED, unresolved by this audit** — no render performed by anyone | `[SOURCE]` on both sides, conflicting; `[RENDER]` = `[BLOCKED: no simulator build attempted by any of the 8 sessions]` |
| Case 3 treadmill HR (avg 129, max 163, 2026-09-03) | Displayed as if a trustworthy heart-rate trace | Built from per-phase telemetry with `distinct_bpm=1` across all 10 work phases (11-19 samples each) — a flatline pattern the app's own guard (`hrTraceIsCredible`) is capable of detecting but is confirmed NOT wired into LTHR/readiness/max-HR consumers | Real defect class, confirmed by evidence but UI-reaching status untested | `[PROD-QUERY]` + `[SOURCE]` |
| Race PRs / personal-records surface | Presents 5 races' worth of results in the audited text | The 6th race with a real result (Rose Bowl Half, 2026-01-18) was silently dropped from the domain's own enumeration — this is an **audit-completeness** finding about the reports, not confirmed to be a **UI-completeness** finding about the app itself (no domain checked whether the PR *screen* also omits it, only that the domain's own written table did) | Needs a fresh, UI-specific check — currently conflated | `[PROD-QUERY]` for the DB fact; UI behavior = `[BLOCKED: not checked]` |
| Proposal-13-style bundled reprice cards, if ever surfaced | A multi-anchor pace change bundled into one accept/decline decision | The audit found the *audit's own* prose reversed 2 of 4 anchor directions (easy/shakeout ceilings actually got faster, marathon actually got slower — opposite of what was originally reported) — this doesn't itself prove the runner-facing card is wrong, but it means nobody has yet independently confirmed what the card *actually said* to David matches the payload | Open — worth checking the rendered card text directly | `[PROD-QUERY]` for payload; card text = `[BLOCKED: not rendered]` |

---

## 8. CONFLICTING-OWNER / SIDE-DOOR REGISTER (from Domain C)

| # | Conflict | Detail | Tag |
|---|---|---|---|
| 1 | `RUNNER_AUTHORITY_TIERS` duplicated | Both `vdot-inputs.ts` and `durability-anchor.ts` independently declare `const RUNNER_AUTHORITY_TIERS: readonly AuthorityTier[] = ['representative', 'compromised', 'unrepresentative']`, each importing the shared `AuthorityTier` *type* from `lib/race/effort-authority.ts` but re-declaring the *value array* locally — exactly the pattern `DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` §2 forbids ("No feature contains its own version. If a value has multiple implementations, doctrine is already compromised") | `[SOURCE]`, confirmed verbatim on both sides |
| 2 | **Five distinct, pairwise-non-matching adaptation-decision vocabularies live simultaneously** | (a) `BRAIN_CONSTITUTION.md` §I doctrine: `PROGRESS/HOLD/REDUCE/RESTRUCTURE` ("in flight right now — build against this exact boundary"); (b) `adaptation-model.ts`'s `CycleDecision`: `STAY/PROGRESS/MODIFY/PROTECT`; (c) `canonical_adaptation_shadow_log`'s DB `CHECK` constraint: `PROGRESS/HOLD/REGRESS/REFUSE`; (d) `dose-responsive.ts`: `PROGRESS/HOLD/REDUCE`; (e) Migration 166's ledger `CHECK` constraint: `PROGRESS/HOLD/REGRESS/REFUSE/APPLY/DEFER/EXPIRE/UNDO` (8 values) | `[SOURCE]`, all five independently re-confirmed verbatim by the Pass-3 reviewer |
| 3 | `SHADOW_EVIDENCE_EPOCH` pin mismatch | `race-outlook.ts`'s content hash at the pinned commit is `18f75b129d5d3ae8`; the pinned expected value in `shadow-evidence-epoch.ts` is `79bc095d2f7ceb3b`. A live, self-inconsistent doctrine-pin — recomputed independently, not just re-cited | `[SOURCE]` + `[TEST]`, self-computed |
| 4 | `AUTOMATIC_ADAPTATION_AUTHORITY: false` vs. the 2026-06-02 `drift_cron_auto` history | The current architecture's single stated adaptation boundary ("There must be exactly one future adaptation boundary, disabled by default") is real and confirmed literal (`= false`) — but it postdates a period when an earlier, now-retired cron mechanism *did* auto-apply an upward volume rebuild without that boundary existing. Not a live side-door today, but a side-door that existed historically and left no trace in the audit trail meant to catch exactly this | `[SOURCE]` + `[PROD-QUERY]` |
| 5 | `plan_decision_ledger` — write calls from 10 live sites, table absent | Not a conflicting *owner* so much as an owner writing into a table that structurally cannot receive the write — every one of those 10 call sites is presumably falling through `TABLE_ABSENT` handling silently | `[PROD-QUERY]` + `[SOURCE]` |

---

## 9. TODAY'S-RUN DEEP TRACE — merged, with the explicit disagreement stated plainly

**The run:** `runs.id = -218380344929823`, 2026-09-09, 5.58 mi / 2947s, easy day, `plan_workout_id = wko_d19936ca5659c63b`, 14 phases (see full table in §2.3). Sole canonical row for the day — two duplicate submissions (`20109710013` strava_webhook, `-2351291349937081` apple_watch) both confirmed `absorbed_into_canonical_at`, checked raw without any absorption filter applied per Rule 14.

**Ground truth, agreed by every domain and reviewer:**
- All 14 phases carry positive `actualDistanceMi`/`actualDurationSec`, including the smallest (0.03 mi / 8 sec walk-back).
- 5 of 6 walk-back recoveries were cut short relative to the prescribed 60s (30/43/61/24/38/8); only phase 6 (61s, `completed:true`) meets it.
- 2 of 6 (phases 8 and 12: 24s and 8s) fail `recoveriesHonestOf`'s 30s tolerance, which — traced at source, confirmed by Domain A's reviewer — gates `sessionLadder`'s `'executed'` verdict. **This run is denied the `'executed'` verdict under the pinned code.** This is a live, present-day instance of the exact defect class WALKBACK-1/WALKBACK-2 exist to fix.
- WALKBACK-2's `recoveryEndedEarly`/`RecoveryEndedEarlyRecord` field is confirmed absent from the pinned commit entirely (zero grep hits repo-wide) and both fixing branches remain unmerged as of the pin.

**Where the domains genuinely disagree — the `routePhases`/`sectionPieces`/`workoutPhasePieces` mechanism:**

Domain D's original Pass 2 (itself already a correction of an even earlier "design-review agent" diagnosis, and echoed by the framing both Domain A and Domain B's original passes adopted) states, as its own single highest-priority finding, that today's run's sub-mile phases cannot be decomposed by `routePhases` because it is "keyed by whole GPS miles," causing `sectionPieces.isEmpty` to be true and the entire Today-tab breakdown to fall into the pace-less `workoutPhasePieces` fallback lane, where the string `"not completed"` would render against real, honestly-executed walk-backs.

**Domain D's own independent reviewer traced this claim against the live server code at the pinned commit and could not reproduce it:**

1. `web-v2/app/api/v5/today/route.ts:1790` builds `routePhases` as **one entry per phase** (`grade.phases.flatMap(...)`), filtered only on `mi>0 && sec>0` — not GPS-mile-keyed at all.
2. Applied to today's actual 14 phases (§2.3's table), every phase clears that filter — including the 0.03mi/8sec walk-back, the smallest phase in the run.
3. The Swift-side `usable = model.routePhases.filter { mi>0 && sec>0 }; guard usable.count > 1 else { return [] }` (`TodayAfterV5.swift:1370-1376`) should therefore see `usable.count == 14`, not 0, and `sectionPieces` should be non-empty — meaning `breakdownPieces` should select `sectionPieces`, **not** the fallback.
4. `sectionPieces`'s verdict text comes from the same shared `phaseVerdictPhrase()` function `RunDetailV5` uses (its own "PARITY-1, 2026-09-04" comment: *"the same graded phase reads the same word on both screens by construction"*), which for a recovery-type phase returns `nil` — honest silence, never `"not completed"`. That string exists only inside `workoutPhasePieces`.
5. The commit that made `routePhases` phase-keyed (`154edbf97`, "seven post-run defects on the owner's 2026-09-08 tempo") is **already an ancestor of the pinned commit**, landed the day before today's run.

**The reviewer's own assessment, stated without resolving it either way:** either (a) this specific routing defect was incidentally fixed by unrelated `154edbf97`/PARITY-1/PHASE-GRAIN-1/COMPLETION-STATE-1 work between 2026-09-04 and 09-08, and the diagnosis everyone downstream cited is stale — the handback's own text admits the root claim came from *"a design-review agent in the prior session, not yet re-verified against today's specific screenshot"*; or (b) a different, real mechanism is still producing the defect that neither the original diagnosis, the handback, Domain D's Pass 2, nor this reviewer located in source.

**This compilation does not resolve this disagreement.** Both sides are `[SOURCE]`-traced against the identical pinned commit and the identical run; neither side has a `[RENDER]` or `[DEVICE]` observation to break the tie. The one piece of evidence that would settle it — actually building, installing, and rendering today's run on current `main` against David's real account — was attempted by **none** of the eight sessions across all four domains. Domain D's reviewer names this explicitly as "the load-bearing weakness in every version of this finding so far, mine included." This is carried into the transfer section (§14) as the single highest-priority open render.

**Secondary correction inside the same case:** the original Domain D pass also mischaracterized proposal 13's declined reprice bundle — its prose says "both easy ceilings slower" and "marathon pace faster"; the actual `action_payload.reprice.anchorMoves` shows the opposite for both (easy/shakeout ceilings **faster**, 502→492 and 532→522; marathon **slower**, 472→475). This doesn't change the fact David declined a coordinated multi-anchor reprice, but it means the follow-up product question the report itself poses ("was the bundle too much to decide on at once?") was being reasoned about with the wrong contents.

---

## 10. THE 14-PROGRESS RECONCILIATION (Domains B, C, D combined)

**The claim under investigation:** some prior document (predating this audit) asserted "14 PROGRESS outcomes" as evidence of the adaptation engine's upward-push history.

**What every domain that checked found, independently, byte-identical:**

| Source table | Total rows | PROGRESS count | Tag |
|---|---|---|---|
| `adaptation_shadow_log` | 24 | **8** (16 HOLD) | `[PROD-QUERY]`, confirmed 3× independently (Domain B, Domain C original, Domain C Pass-3 reviewer) |
| `canonical_adaptation_shadow_log` | 36 | **0** (HOLD/LONG_RUN=11, REFUSE/LONG_RUN=1, REFUSE/THRESHOLD_PACE=12, REFUSE/WEEKLY_VOLUME=10, REGRESS/WEEKLY_VOLUME=2) | `[PROD-QUERY]`, confirmed 3× |
| `coach_intents` | 321 | **0** upward-shaped reasons across 22 distinct reason strings | `[PROD-QUERY]`, confirmed by all four domains |

**No domain, including Domain C's own third-pass falsifier, could locate a mechanism that naturally produces the number 14.** This is stated as genuinely, durably open — not a gap in this audit's effort, a gap in what the underlying system logs.

**The reconciliation's real substance is not "where is 14" — it's what Domain C's reviewer found while looking for it, and it materially changes Rule 21's scope:**

Domain C's Pass-2 report had extended Rule 21's `coach_intents`-scoped "zero upward, ever" finding to two more tables (`plan_proposals`, `plan_workout_proposals`), concluding: *"nothing in any of those three tables, for David, shows a runner-accepted or auto-applied upward volume, pace, or duration change."*

**Domain C's independent Pass-3 falsifier directly contradicts this.** `plan_proposals` has 34 rows (not the 15 the Pass-2 report stated — whose own itemization doesn't even sum to 15), across 14 kind/status combinations (not 4). Row id=1 — `proposal_kind='goal_time_changed'`, `status='superseded'`, created 2026-06-02, `source='drift_cron_auto'` — carries in its own payload:

```json
{
  "message": "Your recent 4-week average (32.6 mi/wk) is 62% higher than what this plan was built for (20.1 mi/wk)...",
  "direction": "UP",
  "pct_drift": 62.2,
  "drift_kind": "volume_drift",
  "rebuild_ok": true
}
```

`direction: 'UP'` traces to `drift-monitor.ts`'s `checkVolumeDrift()`, a genuinely bidirectional signal (`direction = pctDrift > 0 ? 'UP' : 'DOWN'`). Tracing the plan lineage this row touched: `authored_state.weeklyAvg4w` moved from **20.1 mi/wk (pre-rebuild plan) to 35.7 mi/wk (the plan this row produced, `pln_d8bf42492f09dfe2`)** — a 77% jump, via `source='drift_cron_auto'`, i.e. **automatic, not runner-accepted**, with a real `new_plan_id` written. Pulling the fuller May–June lineage shows this wasn't isolated: the same authored basis moved 19.5→23.7→19.5→20.1→**35.7→37.6→39.1** across roughly three weeks through a sequence of drift-triggered rebuilds. **None of these left any trace in `coach_intents`** — the 2026-06-01–03 window's `coach_intents` rows are `plan_adapt_downgrade`, `plan_adapt_overridden`, `plan_adapt_long_floor`, `strength_*`, `watch_completion` — nothing volume- or drift-named.

**This mechanism has since been retired.** `web-v2/app/api/cron/plan-drift/route.ts`'s own `GET` doc comment states, as of 2026-09-02: *"soft drift (volume_drift/vdot_drift/staleness/easy_drift/long_drift/quality_drift) · DETECTED AND LOGGED ONLY since 2026-09-02 · no proposal, no rebuild, no card."* Consistent with `AUTOMATIC_ADAPTATION_AUTHORITY: false = false` and the `adaptation-authority.ts` doctrine ("There must be exactly one future adaptation boundary, disabled by default").

**Net reconciliation:**
- **The "14" number remains genuinely unmatched to any mechanism, across all three domains and all reviewers who looked.** Treat as `UNKNOWN`, not zero and not found.
- **Rule 21's `coach_intents`-scoped claim ("zero upward reasons in 321 rows") stands, unaffected.**
- **The *extension* of that claim to "no auto-applied upward change ever, across every proposal table" is FALSE.** A real, DB-and-source-verified automatic upward volume adaptation (77% jump) reached a live plan on 2026-06-02, via a mechanism that is retired today but left zero trace in the audit table (`coach_intents`) this app's own Rule 21 doctrine treats as authoritative. This is itself a **Rule 11-shaped finding** — a table that doesn't record what happened is not evidence that nothing happened — and belongs in the canonical ledger as a correction to how Rule 21's evidence base is described going forward.
- Additionally, `plan_workout_proposals`'s true row count is **9**, not the "5" one pass stated (whose own itemization summed to 9); its substantive claim ("zero upward `action_kind` literal — only downgrade/hold/reprice") does hold on inspection of both `reprice` payloads, one of which (row 13, the proposal-13 bundle discussed in §9) moves some anchors faster and some slower within the same declined proposal.

---

## 11. PRIOR-REPORT RECONCILIATION — consolidated classification table

Legend: **CONFIRMED** = reviewer independently reproduced the claim exactly; **CHANGED** = reviewer reproduced the underlying fact but corrected a number/detail in how it was stated; **STALE** = claim was true when made but ground has since shifted; **CONTRADICTED** = reviewer's independent check disagrees with the claim; **UNKNOWN** = neither side could settle it; **NOT_RE_TESTED** = explicitly deferred by the reviewer, not silently assumed clean.

| Domain | Claim | Classification | Tag |
|---|---|---|---|
| A | 287/162/125 split, all field-population counts, source/elevGainSource distributions | CONFIRMED (exact, all) | `[PROD-QUERY]` |
| A | Zero cross-disagreement canonical-vs-absorbed | CONFIRMED | `[PROD-QUERY]` |
| A | `recoveryExtensions`/`ceilingLift` counts | CONFIRMED, **after the reviewer's own methodology correction** (top-level array, not nested) | `[PROD-QUERY]` |
| A | `sessionLadder` gates `'executed'` on `recoveriesHonest !== false` | CONFIRMED — newly verified by the reviewer, beyond the original report's scope | `[SOURCE]` |
| A | WALKBACK-1/2 unmerged as of pin | CONFIRMED, **plus new context**: a ready integration branch (`e5bcc430b`) postdates the pin, not yet merged at pin-time | CONFIRMED + STALE-in-progress | `[SOURCE]` |
| A | `pausedSec`/`droppedGapSec` "structurally dead, no Swift sends them" | **CONTRADICTED** | `[SOURCE]` |
| A | `dewpointF` never stored | CONFIRMED — resolved from the original's `NOT_RE_TESTED` | `[PROD-QUERY]`+`[SOURCE]` |
| A | HealthKit `ALLOWED_TYPES` allowlist (~29 types) | CONFIRMED (28 exact, "~29" fair) — resolved from `NOT_RE_TESTED` | `[SOURCE]` |
| A | Working-tree note (`_agentD_capture.audit.test.ts`) | COULD-NOT-REPRODUCE (file no longer present — plausible cleanup, not a contradiction) | — |
| B | Canonical/absorbed split, 0.43mi gap run, HR flatline case, dedup pair, race chip gap | CONFIRMED (all, exact) | `[PROD-QUERY]` |
| B | Fix-commit timestamps (`8196d683a`/`2cd075a9d`) at "10:56:04/10:58:27 PDT" | **CONTRADICTED** — actual `10:40:01`/`10:46:07 PDT`, ~16 min earlier each; qualitative ordering conclusion unaffected, "~97 minutes" should read ~80-86 min | `[SOURCE]` |
| B | `plan_mutations` reason-group/status breakdown table | **CONTRADICTED** in row-level detail (both `applied` rows misattributed to the wrong reason group); aggregate 8-seen/2-applied and the overall correction survive | `[PROD-QUERY]` |
| B | `plan_mutations` date range "05-21 through 05-29" | **CONTRADICTED** — actual creation-ts range 05-21 to 05-25; target-workout-date range 05-21 to 06-01. Neither matches "through 05-29" | `[PROD-QUERY]` |
| B | `coach_intents` "21 distinct reasons" | **CONTRADICTED** — actual 22 | `[PROD-QUERY]` |
| B | "2026-08-10 alone carries 43 rows" | **CONTRADICTED** on "alone" — 75 dates tie | `[PROD-QUERY]` |
| B | `plan_workouts` 96/2.3% figure | **CONTRADICTED**, correct figure 103/2.50% (report's own internal inconsistency, resolved in favor of 103) | `[PROD-QUERY]` |
| B | "Every single watch-completion payload in 14-day cohort carries non-zero pausedSec, 8/8" | **CONTRADICTED** on the universal framing — true only of the curated 8-row sample; full 13-row population includes 5 rows with no field at all | `[PROD-QUERY]` |
| B | §2/§6 pace-mechanism correction (routePhases/usable()/fmtPaceShared type-blindness) | CONFIRMED, **and independently extended** one hop further (`avgSecPerMi`→`pos()`→`fmtPace` chain is type-blind end to end; `askedPace` vs `actualPace` distinction newly drawn) | `[SOURCE]` |
| B | `PostRunLearnedV5(.strides)` sibling-component question | CONFIRMED for Today (`TodayAfterV5.swift` has no competing strides component), **new finding**: Run Detail *does* filter strides out of its own phase list (`STRIDE-DEDUP-1`), a genuine, doctrine-cited, by-design difference between the two screens' stride display | `[SOURCE]` |
| C | HR flatline case, dedup, race authority, shadow-log counts, Migration 166 wiring, doctrine-vocabulary conflicts, SHADOW_EVIDENCE_EPOCH mismatch | CONFIRMED (all, several to the exact byte, including a self-computed SHA-256 re-derivation) | `[PROD-QUERY]`+`[SOURCE]`+`[TEST]` |
| C | "Live callers are the 8 files listed" (flatline guard) | **COULD-NOT-REPRODUCE** — direct grep finds 6 non-test files | `[SOURCE]` |
| C | `plan_proposals` "15 rows... nothing PROGRESS-shaped... nothing shows auto-applied upward change" | **CONTRADICTED** — see §10 in full | `[PROD-QUERY]`+`[SOURCE]` |
| C | `plan_workout_proposals` "5 rows" | **CONTRADICTED** — actual 9, matching the report's own itemized breakdown | `[PROD-QUERY]` |
| C | WALKBACK-1/2 unmerged as of pin | CONFIRMED, **plus disclosure**: `origin/main` moved mid-review to a tip that *does* contain these merges | CONFIRMED + STALE-in-progress | `[SOURCE]` |
| D | Today's run raw phase/duration table | CONFIRMED, exact, cell-for-cell (3rd independent confirmation across domains) | `[PROD-QUERY]` |
| D | `RunDetailV5.swift` "recovery never graded" comment, unfixed | CONFIRMED | `[SOURCE]` |
| D | `target_duration_sec` null on every recovery phase | CONFIRMED — resolved from `NOT_RE_TESTED` | `[PROD-QUERY]`+`[SOURCE]` |
| D | **Central §3 claim: `sectionPieces.isEmpty` fallback routing is live for today's run because `routePhases` is GPS-mile-keyed** | **CONTRADICTED** by the reviewer's own source trace — see §9 for full unresolved disagreement | `[SOURCE]` vs `[SOURCE]`, genuinely disputed |
| D | Proposal 13 anchor-direction characterization | **CONTRADICTED** — 2 of 4 anchor directions reversed in the original prose | `[PROD-QUERY]` |
| D | Six races, five enumerated | **CONTRADICTED** — Rose Bowl Half silently omitted from the report's own list despite correctly stating "six" | `[PROD-QUERY]` |
| D | Two distinct PROGRESS-vocabulary objects (doctrine "not yet built" vs. orphaned `recommendation.ts`) | CONFIRMED, both halves, **and independently strengthened** (zero client callers of `/api/coach/read` confirmed directly) | `[SOURCE]` |
| D | `recordRepSkip()` work-phase-only gate | CONFIRMED — located via a symlink (`native-v2/.../FaffWatch Watch App` → `legacy/native/...`) the original report didn't fall into but flagged as a trap for future audits | `[SOURCE]` |
| D | Handback §2b "root cause identified, not yet fixed" | **DOWNGRADED to UNKNOWN/likely stale** — the handback's own text self-flags this as unre-verified against today's screenshot, sourced to a prior-session design-review agent; the reviewer's independent trace does not support the stated mechanism | `[SOURCE]`+`[INFERENCE]` |

---

## 12. PRIORITIZED CORRECTION PLAN

Severity: **P0** (corrupts identity, grading, fitness belief, adaptation, or safety) · **P1** (gives the runner false/materially incomplete information) · **P2** (valuable evidence exists but is not surfaced) · **P3** (usability/clarity) · **P4** (cleanup/dead data path).

| # | Finding | Severity | Blocks | Tag |
|---|---|---|---|---|
| 1 | Today's run (and, structurally, any run with a legitimately-shortened recovery/walk-back) is denied the `'executed'` verdict by `recoveriesHonestOf`'s pure-duration-tolerance check with no honest-early-end field to distinguish "cut short but fine" from "actually cheated" — WALKBACK-2 unmerged | **P0** | Complete runner-loop readiness (grading integrity); does not block internal TestFlight per se, since it fails *conservatively* (denies credit rather than granting false credit) | `[SOURCE]`+`[PROD-QUERY]` |
| 2 | **Unresolved dispute over whether today's Today-tab actually shows a pace-less, mislabeled "not completed" fallback for real sub-mile phases** — two independently-argued `[SOURCE]` traces at the identical pinned commit reach opposite conclusions, and no one has rendered it | **P0 if the original claim is right; P4 (stale, already fixed) if the reviewer is right — genuinely unknown which** | **Blocks internal TestFlight validation of this specific screen** until rendered; do not scope further engineering work on `sectionPieces`/`workoutPhasePieces` before settling this | `[SOURCE]` vs `[SOURCE]`, `[BLOCKED: no render]` |
| 3 | `coach_intents` (Rule 21's evidence base) does not record the 2026-06-02 automatic upward volume-drift rebuild (77% jump) — a real upward adaptation is invisible to the app's own primary adaptation audit trail | **P0** — this is exactly the "wired, tested, inert, and we can't even tell" failure class Rule 20/21 exist to catch, now shown to extend to a real historical instance the doctrine's own audit missed | Complete runner-loop readiness (adaptation-engine trustworthiness); does not block TestFlight since the mechanism itself is retired | `[PROD-QUERY]`+`[SOURCE]` |
| 4 | Two TS comments (`postrun/experience.ts`, `postrun/load.ts`) assert a false invariant ("no Swift file sends pausedSec/droppedGapSec") and strip real fields on that premise; two live Swift views already send them | **P1** — dormant, will silently lose real pause/gap data the moment David pauses a tracked treadmill run long enough to trigger it, with zero gate to notice | Does not block TestFlight (not yet triggered in this account's history) but should block "complete runner-loop readiness" sign-off since it's a live latent Rule 19/20 violation | `[SOURCE]` |
| 5 | HR flatline guard (`hrTraceIsCredible`) exists, is wired into evidence classification, but confirmed NOT consumed by LTHR re-anchor, max-HR, HR-zone-bucket, or readiness — a flatlined treadmill HR trace (Case 3, 10/10 phases `distinct_bpm=1`) can still shape those four downstream fitness-belief mechanisms uncontested | **P0** — directly touches fitness belief / safety per the severity rubric | Blocks complete runner-loop readiness | `[SOURCE]` |
| 6 | `SHADOW_EVIDENCE_EPOCH` pin mismatch — a live, reproducible content-hash disagreement in a doctrine-pinned CI gate | **P1** (a gate that should be red and, per every domain's evidence, presumably is not caught/acted on) | Should block next internal TestFlight until the epoch is re-pinned or the underlying diff is shown to be immaterial | `[SOURCE]`+`[TEST]` |
| 7 | Five non-matching adaptation-decision vocabularies live simultaneously (`STAY/PROGRESS/MODIFY/PROTECT`, `PROGRESS/HOLD/REGRESS/REFUSE`, `PROGRESS/HOLD/REDUCE`, doctrine's 4-value, ledger's 8-value) | **P1** — a Rule 16 ("one quantity, one name") violation at the architectural level, not just a display bug | Complete runner-loop readiness (this is exactly the kind of side-door doctrine forbids) | `[SOURCE]` |
| 8 | `RUNNER_AUTHORITY_TIERS` duplicated across two files instead of one canonical export | **P4** — cleanup, currently in sync, but structurally a landmine for future drift | None currently; fix before it drifts | `[SOURCE]` |
| 9 | `plan_decision_ledger` (Migration 166) fully wired at 10 live call sites, table absent from production | **P2** — real engineering evidence-gap infrastructure sitting unused; per the canonical handback's own quote ("only your approval remains"), this appears to be an approval-blocked, not defect-blocked, item | Decision needed from David (per Operational vs Decision vs External boundary — this is a schema/DDL action requiring his explicit per-statement go) | `[PROD-QUERY]`+`[SOURCE]` |
| 10 | `recommendation.ts`'s built `STAY/PROGRESS/MODIFY/PROTECT` state machine has zero client callers | **P2** — real capability, unsurfaced | None (dormant, no active harm); candidate for either wiring or deletion per doctrine's "prefer deletion before addition" | `[SOURCE]` |
| 11 | `target_duration_sec` never populated on recovery phases | **P3** — likely a display/labeling gap on recovery-phase UI rather than a grading defect (grading already uses `targetPaceSPerMi`) | None confirmed; needs a render to know if the runner sees a visible gap | `[PROD-QUERY]` |
| 12 | Races enumeration/PR-surface completeness (Rose Bowl Half) | **P1 if the runner-facing PR screen actually omits it; P4 if it's purely an audit-writing gap** — currently unknown which | Needs a targeted DB-vs-render check before this can be scoped at all | `[PROD-QUERY]`, UI `[BLOCKED: not checked]` |
| 13 | Proposal-13-style bundled multi-anchor reprice cards — unclear whether the rendered card correctly communicates anchor directions | **P1 candidate, unconfirmed** — the *audit's* prose was wrong on 2 of 4 directions; the actual card's correctness is untested | Needs a render | `[PROD-QUERY]`, UI `[BLOCKED: not checked]` |
| 14 | `dewpointF` never stored, computed at read time instead | **P4** — working as designed per Domain A, not a defect, just worth recording in field lineage so nobody "fixes" a non-bug | None | `[PROD-QUERY]`+`[SOURCE]` |
| 15 | `plan_workouts` unscoped-join population hazard (4,124 total/103 active rows for one user, 75 dates tying at a 43-row ceiling) | **P2** — a real structural hazard for any future reader that joins on `date_iso` without scoping to the active plan (Rule 14 shape), even though nothing in this audit found it currently mis-firing | Complete runner-loop readiness; worth a defensive scoping pass before any new `plan_workouts`-joining feature ships | `[PROD-QUERY]` |

---

## 13. CROSS-DOMAIN DISAGREEMENTS, REVIEWER CORRECTIONS THAT CHANGED CONCLUSIONS, AND OPEN [BLOCKED] ITEMS

### 13.1 Disagreements *between* domains (not just within-domain reviewer disagreements)

1. **Domain D (original) vs. Domain D's own reviewer, echoed as unexamined fact by Domain A's and Domain B's original passes, on the central `sectionPieces`/`workoutPhasePieces` mechanism.** This is the one genuine cross-cutting disagreement in the whole audit that touches all four domains' shared subject (today's run): Domain A and Domain B both cite and build on the same "routePhases is GPS-mile-keyed, so it can't represent sub-mile phases" framing without independently re-deriving it; Domain D's reviewer is the only session in the entire eight-session audit that actually traced the current server-side construction of `routePhases` against today's actual data and found it phase-keyed, not mile-keyed, and that it *should not* trigger the fallback for this run. **No domain and no reviewer resolved this by rendering the app.** See §9 for full detail. This is the audit's single most important open item.
2. **Domain C's Pass-3 falsifier vs. Domain C's own Pass-2 report on the scope of Rule 21.** Pass 2 extended `coach_intents`'s "zero upward" finding to `plan_proposals`/`plan_workout_proposals` and concluded "no auto-applied upward change ever." Pass 3 found this false via `plan_proposals` row 1 (the 2026-06-02 volume-drift rebuild). This is a within-Domain-C reviewer correction, but it has cross-domain consequences: Domain B's own Rule 21 discussion and Domain D's reconciliation both cite the *narrower*, `coach_intents`-scoped version of Rule 21 correctly, and neither made the same overreach Domain C's Pass 2 made — so this correction is localized to Domain C but changes what the *combined* handback can say about "has this app ever pushed upward."
3. **Domain A and Domain D both independently investigate the `pausedSec`/`droppedGapSec` field**, but from different angles — Domain A's reviewer found the *storage/field-lineage* side (the TS comments' false invariant), while Domain B's case 5.4 (echoed in Domain D indirectly) found the *submission-time* side (pause data captured in `watch_completion` payloads but discarded before reaching `runs.data`). These are **not contradictory** — they describe the same overall data-loss shape from two different points in the pipeline (server-side stripping post-storage vs. never-carried-forward at ingestion) — but no domain explicitly connected the two into one end-to-end trace. This compilation treats them as complementary, not conflicting, but flags that nobody has walked the full ingestion→storage→display pipeline for this field in one pass.
4. **No direct domain-vs-domain contradiction was found on any quantitative production-data fact.** Every canonical/absorbed count, every phase-table value, every race result, every shadow-log count that more than one domain independently queried came back byte-identical across domains, which is itself notable given that each domain queried independently with its own hand-written SQL.

### 13.2 Every reviewer correction that changed a conclusion (consolidated from §11, most consequential first)

1. Domain A reviewer: `pausedSec`/`droppedGapSec` "no Swift client ever sends them" → **FALSE**, two live Swift views do. Changes the field-lineage story from "structurally dead" to "empirically zero so far, with an active landmine."
2. Domain C Pass-3: `plan_proposals` "nothing PROGRESS-shaped, ever" → **FALSE**, a real 77%-volume-jump automatic upward rebuild happened 2026-06-02. Changes the scope of Rule 21's applicability from "the engine has never pushed up" to "the engine's own audit trail (`coach_intents`) has never recorded pushing up, which is not the same claim."
3. Domain D reviewer: the central `routePhases`/fallback-lane mechanism → **directly disputed**, not simply corrected — changes the report's top recommendation from "needs a fix" to "needs a render before it can be triaged at all."
4. Domain B reviewer: `plan_mutations` reason-group/status table → row-level detail wrong even though the aggregate (8 seen/2 applied) and the overall Rule 21 correction survive. Changes confidence in the report's own supporting evidence for its most-cited finding, without changing the finding itself.
5. Domain B reviewer: fix-commit timestamps off by ~16 minutes each → changes the stated causal gap from "~97 minutes" to "~80-86 minutes," doesn't change the causal-ordering conclusion.
6. Domain D reviewer: proposal-13 anchor directions reversed on 2 of 4 → changes what the "declined reprice" case study can be used to argue about bundle complexity.
7. Domain A reviewer: `recoveryExtensions`/`ceilingLift` initially read as 0/0 due to the reviewer's own nesting-level error, corrected to 1/3 after finding the top-level array location — a reviewer self-correction disclosed rather than hidden, per the codebase's own Rule 13/18 standard.
8. Domain D reviewer: races enumeration undercounted (5 of 6) — changes the "confirmed clean" framing on race-data provisional-labeling to "confirmed clean on 5 of 6, 6th never checked by this text."

### 13.3 Remaining [BLOCKED] items, explicit

- **`[BLOCKED: no simulator/device render performed by any of the 8 sessions]`** — the central §9 disagreement; whether the PR screen renders all 6 races correctly; whether proposal-13-style cards communicate anchor direction correctly; whether the recovery-phase `target_duration_sec` gap is visible to the runner; whether the flatline HR guard's exclusion (or lack thereof) is visible anywhere.
- **`[BLOCKED: David's TestFlight build staleness relative to `main` not queried this pass]`** — a prior report cited "44 commits behind" as of 2026-09-08; if David's phone was on a pre-`154edbf97` build when he reported the fallback-lane symptom, that reconciles the §9 dispute without either source-trace being "wrong." Nobody in this audit queried current TestFlight build version against `main`.
- **`[BLOCKED: consumer trace for `recoveryExtensions`/`ceilingLift` not chased]`** — collected, location found, downstream reader never identified.
- **`[BLOCKED: two-applied-mutation rounding gap (12.1→12.0, 4.9→5.0) unexplained]`** — some further repricing pass touched these after the mutation applied; not traced by any domain.
- **`UNKNOWN: does the specific 63-mile 2026-08-30 incident's exact run IDs match what the current repair holds?`** — the repair holds durably in aggregate (0 orphans system-wide), but no domain reconstructed the specific historical run IDs from the memory item to confirm they are the same 7 rows now showing correct.
- **`UNKNOWN: "14 PROGRESS outcomes"`** — see §10, unmatched to any mechanism by all three domains that looked.
- **`[BLOCKED: Decision History screen, shoe-mileage live-recompute beyond raw DB value, Health/Readiness outage-disclosure render, Block/Paces/Watch screens]`** — Domain D explicitly deferred these (no session-minting path available to a read-only reviewer); not picked up by any other domain either.

---

## 14. TRANSFER SECTION — for the main integration agent

*This section is written to be read on its own. Everything the integration agent needs to decide what to do next is here; it does not need to re-read the domain reports above.*

### (a) Facts to add to the canonical master ledger

1. **The `pausedSec`/`droppedGapSec` invariant in `postrun/experience.ts` and `postrun/load.ts` is false.** Two live Swift views (`TreadmillView.swift`, `LiveRunTreadmillV5.swift`) already send these fields to `api/watch/workouts/complete`, which stores them into `clockAudit`. Every historical row happens to show 0/0 because David has never paused long enough to trigger it — that is an empirical fact about his history, not a structural guarantee, and the two comments asserting it as structural should be corrected.
2. **A real automatic upward adaptation exists in this app's history**, 2026-06-02, `plan_proposals` id=1, `direction: UP`, `pct_drift: 62.2%`, `drift_kind: volume_drift`, `source: drift_cron_auto`, producing a plan rebuild that moved `authored_state.weeklyAvg4w` from 20.1 to 35.7 mi/wk (77% increase), continuing to 37.6 then 39.1 over the following ~3 weeks. This event left **zero trace in `coach_intents`**. Rule 21's "zero upward, 309→321 rows, still zero" finding remains true and should stay in the ledger exactly as scoped to `coach_intents` — but the ledger should now also record that `coach_intents` is a demonstrably incomplete record of upward adaptation history, not proof that none occurred, and that the mechanism which produced this specific instance (`plan-drift` cron auto-rebuild) is retired as of 2026-09-02 (detect-only since that date, per the route's own doc comment).
3. **`recoveriesHonestOf` denies the `'executed'` verdict to today's actual run** (2026-09-09, `-218380344929823`) because 2 of 6 legitimately-executed walk-backs fall outside a flat 30-second tolerance with no way to distinguish "honestly cut short" from "cheated." This is a live, present-tense, named instance of the WALKBACK-2 defect class, not a hypothetical.
4. **A live doctrine-pin mismatch exists in `SHADOW_EVIDENCE_EPOCH`**: pinned `79bc095d2f7ceb3b`, actual file hash (independently recomputed via SHA-256) `18f75b129d5d3ae8`, on `web-v2/lib/race/race-outlook.ts` at the pinned commit.
5. **Five non-matching adaptation-decision vocabularies coexist**: doctrine's `PROGRESS/HOLD/REDUCE/RESTRUCTURE`, `adaptation-model.ts`'s `STAY/PROGRESS/MODIFY/PROTECT`, `canonical_adaptation_shadow_log`'s DB-enforced `PROGRESS/HOLD/REGRESS/REFUSE`, `dose-responsive.ts`'s `PROGRESS/HOLD/REDUCE`, and Migration 166's 8-value ledger enum. This is a Rule 16 violation at the schema/type level.
6. **The HR flatline guard (`hrTraceIsCredible`) is confirmed not to reach LTHR re-anchor, max-HR, HR-zone-bucket, or readiness.** A flatlined treadmill trace (10/10 work phases, `distinct_bpm=1`) can currently shape fitness belief uncontested by this guard.
7. **`plan_decision_ledger` (Migration 166) is fully built and live-wired at 10 call sites but the table does not exist in production.** Per the canonical handback's own language, this reads as approval-blocked (a DDL action awaiting David's explicit go), not defect-blocked.
8. **`RUNNER_AUTHORITY_TIERS` is duplicated verbatim in two files** (`vdot-inputs.ts`, `durability-anchor.ts`), currently in sync but structurally unprotected against future drift.
9. **`weather.dewpointF` is never stored, by design** — computed at read time via Magnus-Tetens. This is a correction to prior assumption, not a defect: do not "fix" this.
10. **A 6th race with results (Rose Bowl Half, 2026-01-18, finishS 5918/1:38:38) exists and was omitted from this audit's own race enumeration in one domain's text.** All 6 races' `actual_result` provisional-labeling logic (races-table-first, training-run-fallback-labeled) checks out correctly on the 5 that were checked; the 6th's UI presentation was never independently verified.

### (b) Fixes that should enter the current release scope

1. Correct the false invariant in `postrun/experience.ts:1172-1173` and `postrun/load.ts:705-706` — either wire `pausedSec`/`droppedGapSec` through properly (per Rule 10/11: stamp the anchor, or recompute, or exempt with an argued reason) or replace the false comment with an accurate one and add a gate so a future nonzero value doesn't silently vanish again.
2. Merge WALKBACK-1 (`7b0163c85`) and WALKBACK-2 (`e80524809`), or the already-composed `integration/programme-lead-merge-2026-09-09` branch (`e5bcc430b`) — this directly fixes finding (a)3 above, a live grading defect on David's own most recent run.
3. Re-pin `SHADOW_EVIDENCE_EPOCH` or determine why the CI check that should be catching this mismatch isn't blocking builds — this is a live, reproducible gate failure per this codebase's own Rule 18/19 standard.
4. **Before any further engineering on `sectionPieces`/`workoutPhasePieces`: render today's run on current `main`** (build, install, `-faffRunDetail`-style harness or equivalent against `user_uuid 0645f40c-...`'s real Today payload) and settle §9's disagreement. This determines whether item (b)2 above is the only fix needed for today's run, or whether a second, real Today-tab fallback-routing defect also needs fixing.

### (c) Larger architecture work for later

1. Consolidate the five adaptation-decision vocabularies into one canonical enum per Rule 16/Doctrine Enforcement §2, threading it through `BRAIN_CONSTITUTION.md`, `adaptation-model.ts`, the shadow-log DB constraints, `dose-responsive.ts`, and Migration 166 consistently.
2. Decide the fate of `recommendation.ts`'s orphaned `STAY/PROGRESS/MODIFY/PROTECT` machine — wire it into a real client caller, or delete it per "prefer deletion before addition."
3. Wire `hrTraceIsCredible`'s flatline detection into LTHR/max-HR/HR-zone-bucket/readiness, or explicitly and doctrine-citedly argue why those four should remain exempt.
4. Consolidate `RUNNER_AUTHORITY_TIERS` into a single exported value, imported everywhere, not re-declared.
5. Defensive re-scoping of any future `plan_workouts`-joining code against the population hazard (4,124 total rows / 103 active for one user).

### (d) Production/data actions requiring David's explicit approval — never assume approval

1. **Applying Migration 166** (creating the `plan_decision_ledger` table in production) — DDL, per CLAUDE.md's standing rule, requires his explicit per-statement go regardless of how ready the write path is.
2. **Merging WALKBACK-1/WALKBACK-2** (or the composed integration branch) to `main` — a code change, so per the Deployment Doctrine section this is a Claude-executes-on-approval item once David reviews and gives an explicit go, not a DDL item, but it is listed here because it changes live grading behavior for every future run and should be flagged for his sign-off rather than auto-merged.
3. Any decision about retroactively repairing `coach_intents`'s missing record of the 2026-06-02 upward drift event (if repair is even desired) — this would be a historical-data write and needs explicit per-statement approval.

### (e) Items that remain genuinely unknown

1. **Whether today's Today-tab actually shows the pace-less fallback for today's run.** Two `[SOURCE]`-traced accounts disagree; nobody rendered it. This is the single highest-priority unknown in the whole audit.
2. **The "14 PROGRESS outcomes" number** — unmatched to any mechanism across three independent domains and their reviewers.
3. **Whether the PR/race screen's UI actually omits Rose Bowl Half**, or whether that omission was purely in this audit's own written enumeration.
4. **Whether the proposal-13-style bundled reprice card communicates anchor directions correctly to the runner** — the audit's own prose got 2 of 4 directions backwards; the card itself was never rendered.
5. **Whether the specific 7 run IDs from the 2026-08-30 canonical-dataloss memory item are the same 7 rows this audit's repair-verification query found clean** — the aggregate (0 orphans system-wide) holds, but nobody reconstructed the specific historical IDs to confirm identity.
6. **The provenance of the two-applied-mutation rounding gap** (12.1→12.0, 4.9→5.0 mi) — some further repricing pass touched these after the mutation applied; unexplained.
7. **Whether David's installed TestFlight build is current enough for any of his phone-based `[DEVICE]` observations in the canonical handback to reflect current `main`** — build-staleness was flagged as unqueried by every domain that touched it.

---

*End of consolidated handback. This document performed no writes of any kind — no code, no git, no database, no production mutation. Every finding above traces to one or more of the four domain reports' own `[SOURCE]`/`[PROD-QUERY]`/`[TEST]`/`[SOURCE]`-vs-`[SOURCE]` evidence, reproduced or referenced rather than re-derived independently by this compiling pass. Where any of the eight prior sessions disagreed with itself or with another domain, that disagreement is preserved above rather than resolved by authorial fiat, per the instructions governing this compilation.*