# Independent Review — Domain C (Consumption, Learning and Adaptation), Pass 3 (Falsification)

**Reviewer:** Independent forensic reviewer, third pass
**Method:** Every `[PROD-QUERY]` claim re-run against `DATABASE_URL_RO`; every `[SOURCE]` claim re-read via `git show <pinned-SHA>:<path>` (never the live working tree, except where noted); one claim independently re-derived by computing a SHA-256 digest myself rather than trusting either prior pass's number.
**Pinned commit:** `8559245496bf498d3d4b0479e1117ae416988c4a`. Confirmed at session start: `git rev-parse HEAD` = `git rev-parse origin/main` = this SHA. **Note:** partway through this review I ran `git fetch origin main` (read-only, does not touch the working tree or HEAD) to check a branch-ancestry question, and discovered `origin/main` has since advanced to `8b9fb31595cf5c5ed0f822e5df1c814fc7809116` — another agent pushed during this review, consistent with CLAUDE.md's standing warning that a second agent is frequently committing to `main` concurrently. My local `HEAD` was not moved; all citations below remain pinned to `8559245...` as instructed. This is disclosed for the record, not acted on.
**User:** resolved independently via `users.email = 'RUNNER_DAVID'` → `id = <RUNNER_UUID_REDACTED>`. Note: the actual column on `users` is `id`, not `user_uuid` as the report's header implies — `user_uuid` is the *foreign-key column name* used on the 48 downstream tables that reference it, not a column on `users` itself. Cosmetic, not a defect, but worth a precise correction.
**DB role:** confirmed `current_user = faff_readonly` for every query in this review.

---

## 1. Verdict per material claim

Legend: **CONFIRMED-BY-ME** / **COULD-NOT-REPRODUCE** / **CONTRADICTED-BY-ME** / **UNTESTABLE**.

### 1.1 Census and identity

| Claim | Verdict | My evidence |
|---|---|---|
| `user_uuid = <RUNNER_UUID_REDACTED>` | **CONFIRMED-BY-ME** | `[PROD-QUERY]` `select id from users where email='RUNNER_DAVID'` → exact match |
| `coach_intents` = 321 rows | **CONFIRMED-BY-ME** | `[PROD-QUERY]` exact count |
| `races` actual_result rows = 6 | **CONFIRMED-BY-ME** | `[PROD-QUERY]` exact count |
| Active plan = `pln_7636bcc0a201bf2d` | **CONFIRMED-BY-ME** | `[PROD-QUERY]` — note: `training_plans` has no `status` column; "active" is `archived_iso IS NULL`, enforced by a partial unique index `training_plans_active_uq`. The report's phrasing ("still `pln_7636bcc0a201bf2d`") is correct in substance but I want to flag that neither pass showed how they resolved "active" — I verified it's schema-enforced, not a convention. |

### 1.2 Named Case 3 (HR flatline / treadmill)

| Claim | Verdict | My evidence |
|---|---|---|
| Treadmill run `-240375143823562`, avg_hr 129, max_hr 163, 2026-09-03 | **CONFIRMED-BY-ME** | `[PROD-QUERY]` byte-identical |
| `hrTraceIsCredible()` / `workTraceIsCredible()` exist in `hr-trace-credibility.ts` | **CONFIRMED-BY-ME** | `[SOURCE]` — actual path is `web-v2/lib/adaptation/canonical/hr-trace-credibility.ts` (neither pass gave the full path; I resolved it via `git ls-tree`). Both functions present, content matches the HRFLATLINE-1 narrative described. |
| "Live callers are the 8 files listed" | **COULD-NOT-REPRODUCE** | `[SOURCE]` — I ran `git grep -l "hrTraceIsCredible\|workTraceIsCredible"` at the pinned SHA across all `.ts`/`.tsx`. Result: **10 files total, of which 3 are test files** (`_zero_mutation_scan.test.ts`, `_cannot_mutate.test.ts`, `_hr_trace.test.ts`) and 1 is the definition file itself. That leaves **6 non-test call/definition sites**: `canonical-shadow/live-input.ts`, `volume-evidence/admit.ts`, `brain/orchestration/steps.ts`, `evidence/classify-evidence.ts`, `plan/adjudication/dose-responsive.ts`, `runner-state/ownership.ts`. I cannot reproduce "8" from a direct grep. This is a minor, non-load-bearing count discrepancy (Pass 1's full file list isn't reproduced in the text I was given, so I can't tell if Pass 1 counted differently, e.g. including API routes I didn't check with a broader glob) — but I flag it as unverified rather than silently accepting it. |
| LTHR re-anchor / max-HR / HR-zone-bucket / readiness do **not** consume the flatline guard | **CONFIRMED-BY-ME** (upgraded from Pass 2's own NOT_RE_TESTED) | `[SOURCE]` — I listed every file matching `lthr-reanchor|max-hr|hr-zone-bucket|readiness` in the tree and cross-referenced against my own grep of `hrTraceIsCredible`/`workTraceIsCredible` callers: zero overlap. `lib/coach/hr-zone-bucket.ts`, `lib/coach/readiness*.ts`, `lib/training/lthr-reanchor*.ts`, `lib/training/max-hr.ts` do not appear in the caller grep. I ran this directly rather than inferring it from absence in a handback, so I can upgrade this row's confidence past what either pass achieved. |

### 1.3 Named Case 4 (dedup / supplemental runs)

| Claim | Verdict | My evidence |
|---|---|---|
| Dedup pair `-1722688244` (canonical) / `18270567015` (merged), both 26.81 mi, `absorbed_into_canonical_at = 2026-05-31 17:47:03.05...` | **CONFIRMED-BY-ME** | `[PROD-QUERY]` byte-identical |
| `CANONICAL_ROW_SQL` (`web-v2/lib/runs/volume.ts`) and `runNotMergedSql()` (`web-v2/lib/runs/run-shape.ts`) are the same predicate under two names | **CONFIRMED-BY-ME** | `[SOURCE]` — read both definitions directly: `CANONICAL_ROW_SQL = `NOT (data ? 'mergedIntoId')`` (unaliased) and `runNotMergedSql(alias='') => `NOT (${col(alias)} ? 'mergedIntoId')`` (aliased). Same predicate, parameterized differently. Confirmed, not inferred. |
| Zero orphan-absorbed rows system-wide for David (pattern from the 2026-08-30 memory item doesn't reproduce today) | **CONFIRMED-BY-ME** | `[PROD-QUERY]` — `absorbed_into_canonical_at IS NOT NULL AND NOT (data ? 'mergedIntoId')` → 0 rows; `absorbed_into_canonical_at` count = `mergedIntoId` count = 125 exactly. Whether the *specific* historical incident's 63 miles were repaired remains genuinely **UNTESTABLE** by me too — I did not have the specific run ID(s) from the memory item and did not attempt to reconstruct them. This part of Pass 2's UNKNOWN classification stands. |

### 1.4 Named Case 5 (race / tune-up resolver)

| Claim | Verdict | My evidence |
|---|---|---|
| All 6 races' `actual_result.finishS` values | **CONFIRMED-BY-ME** | `[PROD-QUERY]` byte-identical to both passes: rose-bowl-half-2026 5918, disney-half-2026 5694, la-marathon-2026 12700, big-sur-marathon 13015 (has miles), sombrero-half 6057 (has miles), americas-finest-city 6113 |
| `RUNNER_AUTHORITY_TIERS` duplicated in `vdot-inputs.ts` and `durability-anchor.ts` | **CONFIRMED-BY-ME** | `[SOURCE]` — both files independently declare `const RUNNER_AUTHORITY_TIERS: readonly AuthorityTier[] = ['representative', 'compromised', 'unrepresentative']`, both importing the shared `AuthorityTier` *type* from `lib/race/effort-authority.ts` but each re-declaring the *value* array locally. Genuine duplication. |
| Doctrine quote: *"No feature contains its own version. If a value has multiple implementations, doctrine is already compromised"* | **CONFIRMED-BY-ME** | `[SOURCE]` — verbatim in `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` §2, exact text |
| `race-outlook.ts` `SHADOW_EVIDENCE_EPOCH` mismatch: pinned `79bc095d2f7ceb3b`, actual `18f75b129d5d3ae8` | **CONFIRMED-BY-ME, independently re-derived, not just re-quoted** | `[SOURCE]` + `[TEST]` — I extracted `lib/race/race-outlook.ts` at the pinned SHA into a scratch file and computed `sha256(file).slice(0,16)` myself in Node: **result = `18f75b129d5d3ae8`**, exactly matching what both the handback and Pass 2 claim as the "got" value, and the pin in `shadow-evidence-epoch.ts` reads `79bc095d2f7ceb3b`. This is a genuinely live, reproducible CI failure — I did not just trust the citation, I recomputed the hash myself and it matches. Whether the underlying diff affects the Case-5 read-order conclusion remains correctly flagged **UNTESTABLE** by both prior passes and by me (I did not diff the file against its pre-epoch-3 version). |

### 1.5 Named Case 6 (paused runs / WALKBACK)

| Claim | Verdict | My evidence |
|---|---|---|
| Commits `8196d683a` / `2cd075a9d` are ancestors of the pinned commit, exact messages as quoted | **CONFIRMED-BY-ME** | `[SOURCE]` — `git merge-base --is-ancestor` true for both; `git log --oneline` shows exact message text: "restore Pause and End run during recovery — the run could not be ended" / "draw a Done button on the finish summary and the recovery receipt" |
| WALKBACK-1/WALKBACK-2 still unmerged **as of the pinned commit** | **CONFIRMED-BY-ME** | `[SOURCE]` — merge commits `e5bcc430b` (feat/recovery-ended-early-record) and `1a26aae87` (fix/walkback-recovery-not-completed) exist in the repo's full ref set but `git merge-base --is-ancestor` returns false against `8559245...` for both. **However**: as noted above, `origin/main` moved to `8b9fb3159...` during this review, and that new tip *does* contain these merges (`git branch -a --contains e5bcc430b` lists `origin/main`). So the claim is correct exactly as scoped ("as of this pass," pinned to `8559245...`) but is now stale in real time — not a defect in either report, just a note that the ground has already shifted again. |

### 1.6 Named Case 7 (the "14 PROGRESS outcomes" / shadow logs / ledger)

| Claim | Verdict | My evidence |
|---|---|---|
| `canonical_adaptation_shadow_log`: 36 rows, HOLD/LONG_RUN=11, REFUSE/LONG_RUN=1, REFUSE/THRESHOLD_PACE=12, REFUSE/WEEKLY_VOLUME=10, REGRESS/WEEKLY_VOLUME=2, zero PROGRESS | **CONFIRMED-BY-ME** | `[PROD-QUERY]` — exact match, using the correct column names (`decision`, `lever` — not `verdict`/`axis` as the report's own prose paraphrased them; I confirmed the real column names via `\d`) |
| `adaptation_shadow_log`: 24 rows, 16 HOLD / 8 PROGRESS, the 8 PROGRESS rows dated 2026-08-31 to 2026-09-03 with real magnitude text, then HOLD from 2026-09-04 through 2026-09-09 | **CONFIRMED-BY-ME** | `[PROD-QUERY]` — exact counts; I pulled the actual `engine_explanation` text for all 8 PROGRESS rows: *"Your recent threshold work consistently supports faster training... QUALITY 5 sec/mi quicker... TAPER 9 sec/mi quicker"* (and a later cluster reading "6 sec/mi quicker"). Confirmed the HOLD streak runs 2026-09-04 → 2026-09-09 (today) inclusive, 6 calendar days as claimed. |
| `plan_mutations`: 10 rows total, `positive-drift/applied=2` (2026-05-24→25), `positive-drift/seen=8` (2026-05-21→22) | **CONFIRMED-BY-ME** | `[PROD-QUERY]` byte-identical, both via direct `user_uuid` filter and via the `plan_workouts`→`training_plans` join |
| `training_plans.adaptation_log`: active plan empty `[]`, `pln_ca91f252bba50c74` holds the only 4 non-empty entries, shape `{"n": int, "ts": ...}` | **CONFIRMED-BY-ME** | `[PROD-QUERY]` exact match, entries: n=1 (2026-07-01), n=2 (2026-07-03), n=1 (2026-07-06), n=1 (2026-07-31) |
| Migration 166 (`plan_decision_ledger`) not in production, write path fully built and live-wired | **CONFIRMED-BY-ME** | `[PROD-QUERY]` `to_regclass('public.plan_decision_ledger')` → null. `[SOURCE]` — migration file's own header literally states "NOT APPLIED TO PRODUCTION." `decision-ledger.ts` exports `recordDecision`, `recordDecisionInTransaction`, `TABLE_ABSENT` handling exactly as described. Live (non-test) importers, confirmed via `git grep`: `app/api/coach/proposal/[id]/decline/route.ts`, `app/api/plan/workout-proposals/[id]/dismiss/route.ts`, `app/api/today/reschedule/route.ts`, `lib/adaptation/canonical-shadow/live-arbitration-proposals.ts` — **exactly** the four the report names — **plus six more** the report doesn't mention (`app/api/admin/decision-ledger/route.ts`, `lib/brain/option-lane.ts`, `lib/brain/orchestration/move-orchestrator.ts`, `lib/plan/mutate.ts`, `lib/plan/workout-proposals.ts`, `lib/runner-state/store/lineage.ts`) — this doesn't contradict the report (it never claimed exhaustiveness) and if anything strengthens the underlying point. |
| Migration 166's `decision` enum = 8 values (`PROGRESS/HOLD/REGRESS/REFUSE/APPLY/DEFER/EXPIRE/UNDO`) | **CONFIRMED-BY-ME** | `[SOURCE]` — read the literal `CHECK` constraint in the SQL file: `decision text NOT NULL CHECK (decision IN ('PROGRESS', 'HOLD', 'REGRESS', 'REFUSE', 'APPLY', 'DEFER', 'EXPIRE', 'UNDO'))` |
| Canonical handback quote: *"Only your approval remains — no further engineering evidence gap exists on the packet itself"* | **CONFIRMED-BY-ME** | `[SOURCE]` — verbatim in `docs/audit-2026-09-09-canonical-handback.md` line 140, and materially identical phrasing repeated at line 353 |
| **"The '14' number remains unmatched to any mechanism"** | **CONFIRMED-BY-ME** | I found no additional table or code path in this review that produces a natural count of 14 for upward outcomes either. Genuinely still open. |
| `coach_proposals`: 2 rows, both `goal_time_change`, both expired | **CONFIRMED-BY-ME** | `[PROD-QUERY]` exact match |
| `plan_proposals`: "15 rows: `easy_drift`/`long_drift`/`recovery_complete`/`silent_rebuild` all `auto_applied`; nothing PROGRESS-shaped" | **CONTRADICTED-BY-ME** — see §2 below, this is the most substantive finding of this review | `[PROD-QUERY]` |
| `plan_workout_proposals`: "5 rows: downgrade×5, hold×2, reprice×2 — zero upward action_kind ever" | **COULD-NOT-REPRODUCE the row count; substantively CONFIRMED-BY-ME on "zero upward action_kind literal"** — see §2 | `[PROD-QUERY]` |

### 1.7 Doctrine text citations

| Claim | Verdict | My evidence |
|---|---|---|
| `docs/BRAIN_CONSTITUTION.md` §I: `PROGRESS / HOLD / REDUCE / RESTRUCTURE`, annotated *"(In flight right now — build against this exact boundary.)"*, doc locked 2026-08-31 | **CONFIRMED-BY-ME** | `[SOURCE]` verbatim, same section (§I Adaptation Engine), directly under §29 |
| `lib/plan/adaptation-authority.ts` header: *"This seam is about ADAPTATION... deliberately NOT a gate on: the runner asking. `POST /api/plan/replan`, `/api/plan/change`, `/api/plan/proposal` accept, `/api/plan/workout-proposals/[id]/accept`... all still work"* | **CONFIRMED-BY-ME** | `[SOURCE]` verbatim (I read the full surrounding paragraph, not just the fragment quoted — context confirms the quote isn't cherry-picked misleadingly) |
| `AUTOMATIC_ADAPTATION_AUTHORITY: false = false` | **CONFIRMED-BY-ME** | `[SOURCE]` line 113, literal `export const AUTOMATIC_ADAPTATION_AUTHORITY: false = false;` |
| Three live decision vocabularies (`STAY/PROGRESS/MODIFY/PROTECT` in `adaptation-model.ts`; `PROGRESS/HOLD/REGRESS/REFUSE` in the canonical shadow log's own DB `CHECK`; `PROGRESS/HOLD/REDUCE` in `dose-responsive.ts`), none matching each other or the two doctrine/ledger vocabularies | **CONFIRMED-BY-ME** | `[SOURCE]` — `export type CycleDecision = 'STAY' | 'PROGRESS' | 'MODIFY' | 'PROTECT';` (adaptation-model.ts); DB `CHECK` constraint literally enumerates `PROGRESS/HOLD/REGRESS/REFUSE` (canonical_adaptation_shadow_log, confirmed via `\d`); `readonly decision: 'PROGRESS' | 'HOLD' | 'REDUCE';` (dose-responsive.ts). All five vocabularies (these three + Constitution's 4-value + Ledger's 8-value) are pairwise distinct. |

### 1.8 Rule 21 re-test

| Claim | Verdict | My evidence |
|---|---|---|
| `coach_intents` reason distribution unchanged from doctrine's 2026-08-30 table (5/5/3/3/2/1/1 + vdot_auto_recalc=1) across the +12 new rows | **CONFIRMED-BY-ME** | `[PROD-QUERY]` — I pulled the **full** reason distribution (22 distinct reasons, not just the 8 doctrine cites), confirming the plan_adapt_* + vdot_auto_recalc counts are byte-identical to CLAUDE.md's cited table. The 12 new rows since the doctrine's 309-row measurement are accounted for by other reasons entirely (coach_log_week_close=4, workout_swapped=4, goal_card_dismissed=2, coach_log_lthr_reanchor=1, coach_log_race_replacement=1, coach_log_goal_answer=1, strength_recommend=1, lthr_auto_calibrated=1 — none upward-shaped either). |
| Regex sweep `upgrade\|bump\|accelerate\|increase\|progress\|ramp_up` on `coach_intents.reason` → 0 rows | **CONFIRMED-BY-ME** | `[PROD-QUERY]` re-ran the identical regex, 0 rows |

---

## 2. The substantive disagreement: `plan_proposals` does **not** corroborate "zero upward, ever"

This is where my independent pass diverges materially from Pass 2's own conclusion, and I want to state it plainly rather than bury it in a table cell.

### 2.1 What the report claims

Pass 2's B.5(F) "additional discovery" row and B.7's reconciled conclusion both assert:

> *"`plan_proposals` (15 rows: `easy_drift`/`long_drift`/`recovery_complete`/`silent_rebuild` all `auto_applied`; nothing PROGRESS-shaped)"*

> *"nothing in any of those three tables, for David, shows a runner-accepted or auto-applied upward volume, pace, or duration change. Every non-empty status in those tables is a drift-correction, a downgrade, a hold, a reprice-refusal, or an expired goal-renegotiation offer."*

### 2.2 What I found

`[PROD-QUERY]` — David's `plan_proposals` table has **34 rows, not 15**, across **14 distinct `(proposal_kind, status)` combinations**, not the 4 kinds the report names. The report's stated total ("15 rows") does not even match its own itemization (`easy_drift`+`long_drift`+`recovery_complete`+`silent_rebuild` sums to 7 rows in the actual data, not 15), and it omits 27 rows entirely: 21 `goal_time_changed` rows, 2 `goal_renegotiation`, 2 `goal_outlook`, 1 `race_goal_framing`, 1 `race_role`.

Inspecting the omitted rows, `plan_proposals` id=1 (`proposal_kind = 'goal_time_changed'`, `status = 'superseded'`, created `2026-06-02 12:37:42+00`, source `drift_cron_auto`) carries in its own `reasons` payload:

```json
{
  "message": "Your recent 4-week average (32.6 mi/wk) is 62% higher than what this plan was built for (20.1 mi/wk). The plan's volume curve starts behind where you actually are · refit to use the work you've been doing.",
  "direction": "UP",
  "pct_drift": 62.2,
  "drift_kind": "volume_drift",
  "rebuild_ok": true
}
```

`[SOURCE]` — I traced `direction: 'UP'` to `lib/plan/drift-monitor.ts`'s `checkVolumeDrift()`, which computes `direction = pctDrift > 0 ? 'UP' : 'DOWN'` from `(currentAvg - authoredAvg) / authoredAvg` — a genuinely bidirectional signal, not a synthetic label.

I then traced the plan lineage this proposal touched, `[PROD-QUERY]`:

| Plan id | Authored | `authored_state.weeklyAvg4w` |
|---|---|---|
| `8599e3a1-07ab-4610-9f77-eae6a6f80032` (pre-rebuild) | 2026-05-20 16:58:58 | **20.1** |
| `pln_d8bf42492f09dfe2` (the rebuild `plan_proposals` row 1 produced — `new_plan_id` populated) | 2026-06-02 12:37:42 (same instant row 1 resolved) | **35.7** |
| `pln_92f5cc2ad3350831` (superseded row 1's plan hours later, over an unrelated goal-time format fix — row 2, `direction` not volume-related) | 2026-06-02 18:21:36 | 35.7 (unchanged) |

That is a **77% jump in the plan's authored weekly-volume basis** (20.1 → 35.7 mi/wk), produced by an automatic (`source = 'drift_cron_auto'`, not a runner-initiated accept), UP-direction volume-drift signal, with a real `new_plan_id` written. Pulling the fuller lineage back to mid-May shows this wasn't an isolated blip: `weeklyAvg4w` on this same plan chain moved 19.5 → 23.7 → 19.5 → 20.1 → **35.7 → 37.6 → 39.1** across roughly three weeks in May–June 2026, almost entirely upward, through a sequence of drift-triggered rebuilds — none of which left any trace in `coach_intents` (I checked: the `coach_intents` rows in the 2026-06-01–03 window are `plan_adapt_downgrade`, `plan_adapt_overridden`, `plan_adapt_long_floor`, `strength_*`, `watch_completion` — nothing naming volume or drift).

`[SOURCE]` — this mechanism has since been closed off. `web-v2/app/api/cron/plan-drift/route.ts`'s own `GET` self-documentation states as of 2026-09-02: *"soft drift (volume_drift / vdot_drift / staleness / easy_drift / long_drift / quality_drift) · DETECTED AND LOGGED ONLY since 2026-09-02 · no proposal, no rebuild, no card."* This is consistent with David's ruling quoted in `adaptation-authority.ts` ("There must be exactly one future adaptation boundary, disabled by default") — the cron-triggered auto-rebuild path that fired for David in June is not the live architecture today.

### 2.3 My verdict

- **CONTRADICTED-BY-ME**: the specific claim that `plan_proposals` shows "nothing PROGRESS-shaped" and corroborates "zero upward, ever." It does not. There is a real, DB-and-source-verified instance of an automatic upward volume adaptation that reached a live plan.
- **Correctly scoped, still standing**: Rule 21's own `coach_intents`-based finding ("zero upward reasons in 321 rows") is unaffected — `coach_intents` genuinely never logs this event, which is itself a Rule 11-shaped finding (a table that doesn't record what happened is not evidence that nothing happened).
- **Correctly scoped, still standing**: the *current* architecture (`AUTOMATIC_ADAPTATION_AUTHORITY=false`, plan-drift cron detect-only since 2026-09-02) genuinely does block this class of unattended push going forward — I did not find a live path today that would reproduce it.
- **What's wrong**: the report's language is not "no upward push exists in the current architecture" (true) — it's "nothing in any of those three tables, for David, shows a runner-accepted or auto-applied upward volume, pace, or duration change" (unqualified, "ever," false). This matters because the report explicitly used this cross-table check to *extend* Rule 21's claim, not merely repeat it — and the extension doesn't hold up.

I also want to flag, more mildly: the `plan_workout_proposals` "5 rows" figure is internally inconsistent in the report's own text (it lists `downgrade×5 + hold×2 + reprice×2 = 9`, not 5) — `[PROD-QUERY]` confirms the true total is **9 rows**, matching the itemized breakdown, not the stated headline. The substance of that row ("zero upward `action_kind` literal") does hold — I inspected both `reprice` payloads directly and found `action_kind` values are only `downgrade`/`hold`/`reprice`, never anything upward-named — but I'll note the `reprice` payloads themselves are more interesting than the report credits: both are automatic VDOT-based read-time repricing computations (`toVdot`/`fromVdot`, `anchorMoves`) that move some pace anchors faster and some slower in the same proposal (e.g. row 13: threshold 430→432 sec/mi slower, but interval and easy paces faster) — this is direct, first-hand evidence bearing on the report's own **open question #5** ("does read-time pace repricing independently move paces upward, irrespective of `AUTOMATIC_ADAPTATION_AUTHORITY`?"). Both proposals are `dismissed`/`expired`, i.e. never applied, so this doesn't itself contradict "zero applied," but the report should have surfaced this content — it went looking in exactly the right table and didn't read the payloads it found.

---

## 3. Corrected, annotated report

Below is Pass 2's own reconciliation table, reproduced with my corrections inserted inline as **[REVIEWER: ...]** blocks. Everything not annotated I independently confirmed and have nothing to add.

> **§B.5 "Additional discovery" row** — original text:
> *"`plan_proposals` (15 rows: `easy_drift`/`long_drift`/`recovery_complete`/`silent_rebuild` all `auto_applied`; nothing PROGRESS-shaped)... None shows a runner-accepted or auto-applied upward volume/pace change for David."*
>
> **[REVIEWER: CONTRADICTED. The table has 34 rows, not 15, across 14 kind/status combinations, not 4. Row id=1 (`goal_time_changed`/`superseded`, 2026-06-02, source `drift_cron_auto`) carries `"direction": "UP"`, `"drift_kind": "volume_drift"` in its payload and a populated `new_plan_id`. The plan it produced (`pln_d8bf42492f09dfe2`) shows `authored_state.weeklyAvg4w` jumping from 20.1 to 35.7 mi/wk — a 77% increase — with no runner action recorded. See §2 of this review for the full evidence chain. This mechanism has since been retired (plan-drift cron is detect-only since 2026-09-02), so it does not describe the current architecture, but it does falsify "nothing... ever" as stated.]**

> **§B.7, closing paragraph** — original text:
> *"Given that, I went and checked whether David has ever accepted an upward proposal through the runner-initiated path, across every proposal table in the schema... The answer is still no: nothing in any of those three tables, for David, shows a runner-accepted or auto-applied upward volume, pace, or duration change."*
>
> **[REVIEWER: The "runner-initiated" half of this sentence is accurate — I found no runner-accepted upward proposal anywhere. The "or auto-applied" half is not — see §2. The sentence conflates two different questions (did the runner ever accept one; did the system ever auto-apply one) and answers "no" to both when only the first is true.]**

> **§B.5, Mechanism F table row, Migration 166** — original text stands, and I found it **understates** the live-wiring slightly by omission (not error): 6 additional non-test live importers exist beyond the 4 named. **[REVIEWER: CONFIRMED, and stronger than stated — not a correction, an upgrade.]**

> **Case 3, "Live callers are the 8 files listed"** — **[REVIEWER: I count 6 non-test files via direct grep, not 8. Could not reproduce "8" independently; flagging rather than silently accepting.]**

Every other row of Pass 2's B.1–B.4, B.6, B.8, and B.9 tables, and every doctrine-text citation in the report, I independently re-ran or re-read and found **CONFIRMED-BY-ME**, generally to the byte. That includes the single most load-bearing forensic technique in the whole report — the `SHADOW_EVIDENCE_EPOCH` digest mismatch — which I did not just re-quote but re-derived from raw bytes myself and got the identical hash.

---

## 4. Explicit list of disagreements (not papered over)

1. **`plan_proposals`, Case 7 / B.5(F) / B.7** — the report's claim that this table shows "nothing PROGRESS-shaped" and corroborates zero-upward is **wrong**. A real, automatic, upward volume-drift proposal (`direction: UP`) produced a plan rebuild that raised `weeklyAvg4w` from 20.1 to 35.7 mi/wk on 2026-06-02. The report's stated row count for this table (15) is also wrong (actual: 34); its own itemized breakdown doesn't sum to its stated total.
2. **`plan_workout_proposals` row count** — the report says "5 rows" but its own itemization (`downgrade×5, hold×2, reprice×2`) sums to 9, and I independently confirmed the true total is 9. Internally inconsistent in the report as written, regardless of which number was intended.
3. **Case 3, "8 files"** — I could not reproduce this count via direct grep at the pinned commit; I find 6 non-test files. Minor, and I can't rule out the two passes used a broader search (e.g. including a glob I didn't try) that legitimately finds 8, but as stated I can't confirm it.
4. **No disagreement, but a scoping note**: the report is careful to scope Case 7's "zero upward" conclusion mostly to `coach_intents`, and Rule 21 itself is explicitly `coach_intents`-scoped in CLAUDE.md. My disagreement is specifically with the report's *extension* of that conclusion across the three proposal tables in B.7, which is where the falsification lands — not with Rule 21's own text, which I re-confirmed accurately describes `coach_intents`.

No other disagreements. The overwhelming majority of this report — every dedup claim, every race-authority claim, the flatline-guard claim, the shadow-log counts, the doctrine-text citations, the SHADOW_EVIDENCE_EPOCH digest, the Migration 166 wiring, the WALKBACK ancestry, the `plan_mutations`/`adaptation_log` dead-path claims — reproduced cleanly, several of them to the exact byte, across two independent methods (database re-query and source re-read at the pinned SHA) ten days and one additional pass after they were first established. That is a genuinely strong track record for the parts of the report I could fully re-test, and it should be weighed alongside the one substantive miss.