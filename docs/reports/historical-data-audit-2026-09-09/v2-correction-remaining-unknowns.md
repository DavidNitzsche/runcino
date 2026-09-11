# READ-ONLY CORRECTION/COMPLETION PASS — v1's Six Open Items, Chased to Ground

**Commits in play, and which I cite:**
- `8559245496bf498d3d4b0479e1117ae416988c4a` — v1's pin. Cited only where a claim is specifically about what v1 saw at that point.
- `ae91e30668df7e14b1279cb6e4d20db87de5250e` — the task's stated "current main." Confirmed by `git merge-base --is-ancestor` to be an ancestor of the present tip.
- `80fca013f94b99ee5af3f84e79590591d42141da` — the ACTUAL current `origin/main` as of this pass (one commit past `ae91e3066`). I fetched and confirmed this myself [SOURCE]. That one commit is `docs(audit): reserve ledger rows for preliminary forensic runner-data audit findings` — a docs-only edit to `docs/audit-2026-09-10-canonical-record.md`, no code. **All code citations below are against `ae91e3066` (== current code tip); nothing code-relevant changed between it and the actual HEAD.** WALKBACK-1 (`1a26aae87`) and WALKBACK-2 (`e5bcc430b`) are both merged into this tip — the §9 dispute in v1 is about code that has since landed; I did not re-litigate it since it isn't one of the six items, but flag it so nobody reads my citations against a codebase that still has the fallback-lane question open.

All DB queries below ran as `faff_readonly` (confirmed `current_user` per query) against `DATABASE_URL_RO`. No write-shaped SQL was issued anywhere in this pass. The one non-SQL executable step I took — running `scripts/adaptation-real-replay/real-replay.test.ts` — opens no database connection (confirmed by reading its own header and `run.sh`, which says so explicitly) and writes nothing; it replays a frozen JSON snapshot through the engine in memory. This is consistent with "read-only."

---

## 1. Consumers of `recoveryExtensions` / `ceilingLift`

**Verdict: v1 was wrong. A real, live, wired consumer exists.** It should not have been left as `[BLOCKED: consumer trace not chased]`.

`git grep` for both keys across `web-v2` and `native-v2` at `ae91e3066` turns up a chain v1 never walked past the storage layer:

1. **Storage** — `web-v2/app/api/watch/workouts/complete/route.ts` (lines 213, 245, 756-758, 838-840) writes the two top-level arrays into `runs.data` exactly as v1's field-lineage table describes.
2. **Read-side mapping** — `web-v2/lib/coach/run-state.ts:1500-1503`, inside `loadRunDetail(userId, activityId)` (exported at line 575): maps `r.ceilingLift` → `ceiling_lift` and `r.recoveryExtensions` → `recovery_extensions` on the object this function returns.
3. **Wire route** — `loadRunDetail` is called from `web-v2/app/api/runs/[id]/route.ts` — the run-detail API a phone actually hits when a runner opens a run.
4. **Client model** — `native-v2/Faff/Faff/Models/Runs.swift:310,312,402,453,455` decodes `ceiling_lift: RunCeilingLift?` and `recovery_extensions: [RunRecoveryExtension]` off that exact payload.
5. **Client render** — `native-v2/Faff/Faff/ViewsV5/RunDetailV5.swift:130-190`, function `decisionsFromWire`, reads both fields directly and turns them into rows on a UI panel the file itself calls "Wrist Decisions":
   - `ceiling_lift` → a row reading **"Lifted the ceiling for the day"** / reason **"Ran to {reading} · the ceiling was {ceiling}"**.
   - `recovery_extensions` → one collapsed row (never one row per extension — the comment explicitly rejects that as "the screen grading a choice by repetition") reading **"Took {N} seconds more recovery"** / reason **"{Once/Twice/N times}, {between reps X and Y}"**.
6. **Wiring confirmed live, not orphaned** — `resolvedDecisions` (line 224) falls through to `decisionsFromWire` whenever the caller passes no override list, and the one production call site, `native-v2/Faff/Faff/ViewsV5/HostsV5.swift:4429`, does exactly that (`RunDetailV5(detail: detail, recap: recap, onBack: {...})`, no `wristDecisions:` argument). `resolvedDecisions` is drawn at line 347 via `WristDecisionsV5(decisions: resolvedDecisions)`, gated only on non-empty.
7. **Corroboration, independent of the code trace** — `web-v2/lib/watch/safety-stop.ts:44`, a header comment dated 2026-09-02, independently names this exact mechanism: *"per-phase `verdict` throughout, `ceilingLift` / `recoveryExtensions` (the 2026-08-21 wrist decisions) on the runs that earned them."* That comment was written for an unrelated purpose (watch-build-compatibility reasoning) by someone who already knew this feature by name — it is not an inference from my own reading of `RunDetailV5.swift`, it is a second, independent citation of the same feature.

**What this changes about v1's item 5 ("Collected but unused") and item 6/(a) transfer note:** `recoveryExtensions`/`ceilingLift` are not "collected at write time, not chased further" — they are collected, mapped, wired, and rendered, by a named, dated feature ("Wrist Decisions," 2026-08-21). This should move from the "Collected but unused" table to either "Used but not surfaced" (if unverified as reaching the runner) or nowhere at all, once rendered.

**What is NOT closed:** I did not render the screen. Row `-145861381014809` (the one row carrying both fields, with `recoveryExtensions` entries at `phaseIndex:10`) would be the concrete render target — build, install, open Run Detail for that specific run, and confirm the "Wrist Decisions" section actually draws the two sentences above. `[SOURCE]`-confirmed end-to-end; `[RENDER]` = `[BLOCKED: no simulator session established in this pass]`. Given the strength of the source trace (five files, one comment, no ambiguity in the wiring), I'd treat this as a low-risk render — but it is a render, not a source-trace, and Rule 13 says the difference matters.

---

## 2. Provenance of the two-applied-mutation rounding gap (12.1→12.0, 4.9→5.0 mi)

**Verdict: genuinely unresolved, but meaningfully narrowed — several specific candidate mechanisms are now ruled out by direct evidence, which v1 did not attempt.**

`[PROD-QUERY]` The two rows, confirmed exactly as v1's reviewer found them:

| mutation id | workout_id | ts | reason | `changed_fields.distanceMi` | current `plan_workouts.distance_mi` | `original_distance_mi` |
|---|---|---|---|---|---|---|
| `a5a9088f-...` | `946dad0c-...` (long, 2026-05-31) | 2026-05-24 08:24:22 | "Running 10% above plan this week..." | **12.1** | **12.0** | 11 |
| `3e353dc3-...` | `ec7ae0eb-...` (easy, 2026-06-01) | 2026-05-25 18:27:11 | "Running 9% above plan this week..." | **4.9** | **5.0** | 4.5 |

Both workouts belong to `plan_id = 8599e3a1-07ab-4610-9f77-eae6a6f80032`, which is `archived_iso IS NOT NULL` today (the plan superseded on 2026-06-02 by the drift-cron rebuild `plan_proposals` id=1 discussed elsewhere in this doc). Neither workout's `workout_spec` carries a `distanceMi` key at all — only the top-level `plan_workouts.distance_mi` column holds the value, so there is no secondary copy to reconcile against.

**What I checked and ruled out, definitively:**

1. **No audit trail exists.** `\d plan_workouts` [PROD-QUERY] shows no `updated_at`, no history column, and the only tables in this database with "history"/"audit"/"log" in the name are `adaptation_shadow_log`, `canonical_adaptation_shadow_log`, `notifications_log` [PROD-QUERY] — none of them plan-workouts-shaped. There is no `plan_workouts`-adjacent table a value's provenance could be reconstructed from.
2. **No later `plan_mutations` row touches either workout.** `[PROD-QUERY]` — a direct requery for `workout_id IN (946dad0c-..., ec7ae0eb-...)` returns exactly the same one row each; nothing else ever mutated these two workouts through this table.
3. **No `plan_proposals` row touches this plan in the window.** `[PROD-QUERY]` — `plan_proposals` for this user between 2026-05-20 and 2026-06-03 has exactly 2 rows, both dated 2026-06-02, both `goal_time_changed`. Neither references these workout IDs, and both rebuild-shaped mechanisms in this codebase (`silent_rebuild`, the drift-cron auto-rebuild) work by **archiving the current plan and generating a new `plan_id`** [SOURCE: `web-v2/app/api/cron/silent-rebuild/route.ts:98`, `generatePlan` with `archiveReason`] — they would not leave the rows on plan `8599e3a1` with a mutated value; they'd move the runner onto a different plan entirely. Since these two rows are still sitting on the *original*, now-archived plan, no rebuild mechanism explains the change.
4. **The "accept" write path writes the literal, unrounded value.** `[SOURCE]` `git show 453490951` — the historical commit that introduced the applied/proposed/declined status column and its accept endpoint — shows the apply write as `UPDATE plan_workouts SET ${sets.join(', ')} WHERE id = $1` built directly off `changed_fields` with no rounding step. If these two rows auto-applied through that path (their `status` was `applied` at write time and neither reason reads like a "big adaptation" requiring approval), the value written at that moment would have been exactly 12.1 and 4.9 — not 12.0/5.0. Something touched them **after**.
5. **The current codebase's three live `distance_mi` writers don't produce this shape either.** `git grep -n "SET distance_mi"` across `web-v2/lib` and `web-v2/app` (excluding tests) returns exactly three sites: `app/api/plan/replan/route.ts:191` (`ROUND(distance_mi * $2, 1)` — 1-decimal, not half-mile), `lib/plan/adapt.ts:1967` (the `shave` trigger — half-mile-rounds, but only as part of a `distance_mi * (1 - shaveFraction)` **reduction**, gated to `a.kind === 'shave'`, which is not this mutation's `trigger_kind` of `positive-drift`), and `lib/plan/adapt.ts:1996` (`mark_upgrade` — writes the raw target value unrounded, with a strictly-increasing guard). None of the three, as currently written, produces "round this exact value to the nearest 0.5 mi with no other change" — which is what the data actually shows (12.1→12.0 is −0.1; 4.9→5.0 is +0.1; both are nearest-half-mile snaps in opposite directions, consistent with a generic "author on the half-mile grid" pass, not with a proportional shave or a raw overwrite).
6. **The `web/` (legacy, archived) codebase that was actually live in May 2026 is gone from the tree** (`legacy/web/` no longer exists as a checked-out path; `web/` was archived at commit `64ff3a9ad`), and `git grep` for `distance_mi` write sites returns nothing under `legacy/`. So whatever process actually ran against these rows in May 2026 cannot be re-read from the current source tree at all — only from git history, and I found no commit in that window touching `distance_mi` on this specific shape.
7. **A speculative candidate a domain-B reviewer raised ("EVENT-2-era repricing") does not exist.** `git grep -n "EVENT-2"` across `web-v2` returns zero hits — that reviewer's own hedge ("unsurprising given EVENT-2-era repricing exists elsewhere") does not check out as a real, named mechanism in this codebase.

**Net:** the direction and magnitude of both deltas (snap onto the 0.5-mi authoring grid, `roundHalf()`/`Math.round(n*2)/2` — the exact function defined at `web-v2/lib/plan/core.ts:63-64` and used pervasively in `generate.ts`/`drift-monitor.ts`) is consistent with **some** plan-authoring pass re-deriving these two workouts on the canonical half-mile grid after the mutation wrote an off-grid value — but I could not find a surviving code path, current or historical, that actually performs that specific operation against an already-mutated row without also changing its `plan_id`. This is `[INFERENCE]` at best, not a proven mechanism. **I am closing this as: genuinely unresolved, several concrete candidates ruled out with direct evidence (not just speculated away), and the honest state is that the code that did this either predates the archived `web/` tree's earliest retained commit or was never captured in a commit at all** (e.g., a manual DB correction, a one-off script run and discarded). A later engineering pass with a full `pg_stat_activity`/query-log retention window (which this read-only role does not have) is the only way this closes further.

---

## 3. The exact seven run IDs from the 2026-08-30 canonical-data-loss incident (63 mi)

**Verdict: fully resolved. Confirmed by exact run ID, not aggregate, and the repair holds today, row for row.**

The IDs were not in any doc under `docs/` (`docs/PRODUCT_DECISIONS.md` has no entry matching "canonical" + "data loss" / "63 mi" / "absorbed into nothing" — I grepped the whole tree for those phrases and only the audit's own four domain reports matched). They are in the user's memory store, outside the repo: `project_canonical_run_dataloss_2026-08-30.md`, written the same day David gave the repair go-ahead:

> Restored ids: `-89674653468297`, `-75222347127112`, `-226447289863060`, `-191288470618193`, `-87627419857791`, `-254892999381071`, `-177132011318458`.

`[PROD-QUERY]` — I queried exactly these seven IDs against production today:

| id | `startLocal` | mi | `absorbed_into_canonical_at` | `data ? 'mergedIntoId'` |
|---|---|---|---|---|
| `-226447289863060` | 2026-06-14T08:16:14 | 13.13 | (null) | false |
| `-75222347127112` | 2026-06-19T15:00:13 | 6.45 | (null) | false |
| `-191288470618193` | 2026-07-06T07:25:58 | 6.01 | (null) | false |
| `-87627419857791` | 2026-07-07T07:30:29 | 7.56 | (null) | false |
| `-254892999381071` | **2026-07-25T06:21:40** | **18.00** | (null) | false |
| `-177132011318458` | 2026-08-10T18:45:06 | 4.02 | (null) | false |
| `-89674653468297` | 2026-08-26T06:20:04 | 7.78 | (null) | false |

**Count: 7. Sum: exactly 63.0 mi.** All seven satisfy the canonical predicate (`absorbed_into_canonical_at IS NULL`, `NOT (data ? 'mergedIntoId')`) — i.e., all seven are covered by, and pass, the exact same repair-verification query the audit's system-wide "0 orphans" check ran. The 18.0-mi run on 2026-07-25 and the 13.13-mi run on 2026-06-14 that both prior memory citations and v1's own domain reports named are two of these seven, confirmed by ID, not inferred from the aggregate. This closes v1's §13.3/§14(e)5 UNKNOWN outright: yes, the specific seven rows from the named incident are the same rows the system-wide check covers, and the repair holds durably as of this pass.

---

## 4. Do all six race results reach the payload feeding the Races/PR screen?

**Verdict: yes for the schedule/history list; correctly no (by design, not a defect) for the bucketed personal-records list. v1 conflated two different screens under one question, and the missing race was purely an artifact of the audit's own prose, never of the app.**

There are two distinct server routes that could be called "the Races/PR UI," and I traced both:

**(a) `GET /api/v5/races`** (`web-v2/app/api/v5/races/route.ts`) — the iPhone V5 Races screen. Its `schedule` array (lines 542-567) is built from `loadRacesState(userId)`'s `aRaces`/`upcomingBs`/`upcomingCs`/`past` arrays, concatenated with **no slice, no limit, no priority filter**. `loadRacesState` (`web-v2/lib/coach/races-state.ts:207-214`) issues `SELECT slug, meta, actual_result FROM races WHERE user_uuid = $1 ORDER BY (meta->>'date') NULLS LAST` — unconditional, every row for the user, no `WHERE` clause narrowing by date or priority. `is_past` is computed as `date < today`, and `...racesState.past` is spread into `schedule` unconditionally at line 545. **Rose Bowl Half (2026-01-18, `actual_result.finishS = 5918`) is a past race for this user and would flow through this exact path with nothing to drop it.** `[SOURCE]`-traced end to end; not rendered, but there is no filter, slice, or limit anywhere in the chain that could exclude it — this is a stronger form of confirmation than most SOURCE traces in this audit, because there is no conditional logic left to be wrong about.

**(b) `GET /api/records`** (`web-v2/app/api/records/route.ts` → `loadPersonalRecords` in `web-v2/lib/race/personal-records.ts`) — a **different** screen, the bucketed PR ladder (5K/10K/half/marathon, one entry per bucket, `RECORD_BUCKETS` at line 51-56). By design (`composePersonalRecords`, line ~193-215: `best.timeS < ...` comparator), this returns only the **fastest** curated result per distance bucket. `[PROD-QUERY]` — this user has four half-marathon results (Rose Bowl 5918s, Disney 5694s, Sombrero 6057s, AFC 6113s) and two marathon results (LA Marathon 12700s, Big Sur 13015s); Disney Half wins the "half" bucket and LA Marathon wins the "marathon" bucket. **Rose Bowl Half, Sombrero Half, Big Sur Marathon, and AFC are all correctly absent from this specific list** — not omitted, out-competed. This is working exactly as the "personal records" concept requires and is not a completeness defect of any kind.

`native-v2/Faff/Faff/API.swift:1207` and `native-v2/Faff/Faff/Views/ActivityView.swift:403` confirm `/api/records` is live-wired to a client screen (`ActivityView`), so this bucketed behavior is genuinely user-facing, not dead code.

**Net:** v1's §7/§9(e)3 "does the PR screen omit Rose Bowl Half" question dissolves once the two screens are told apart. The schedule/history screen shows all 6 by construction; the bucketed-PR screen shows only 2 (Disney Half, LA Marathon) by design, and that design is correct. Neither screen has a completeness bug. **The only thing v1 got right to flag was that its own written enumeration, not the app, dropped a row.**

---

## 5. Proposal 13's actual runner-facing wire text

**Verdict: traced completely, to the exact generated strings. And the finding is sharper than either v1 or its reviewer noticed: the runner-facing card never states the individual anchor directions at all — the whole "did the card get 2 of 4 directions backwards" question is about internal payload data that never reaches a sentence on the phone.**

`[PROD-QUERY]` Proposal 13's full row (`plan_workout_proposals.id = 13`, `plan_workout_id = wko_d19936ca5659c63b`, `action_kind = 'reprice'`, `source = 'cron_reanchor'`, `status = 'dismissed'`, created 2026-09-09T07:03:58Z, resolved 2026-09-09T12:49:48Z — a ~5h46m-old decline, today's date, not a historical row). Its stored `action_payload.action` is a `COORDINATED` action with `direction: "MORE"` and `describe: "Threshold moves to 7:12 across the block"`. `action_payload.reprice.anchorMoves` (the internal, non-rendered detail both domain-D and its reviewer argued over):

| lever | from → to (sec/mi) | direction |
|---|---|---|
| threshold | 430 → 432 | slower |
| interval | 401 → 400 | faster |
| repetition | 365 → 364 | faster |
| easy ceiling | 502 → 492 | **faster** |
| shakeout ceiling | 532 → 522 | **faster** |
| marathon | 472 → 475 | **slower** |

This confirms the reviewers' correction of v1's own prose (easy/shakeout got faster, marathon got slower — the opposite of v1's characterization) exactly.

I then traced the **actual rendering functions**, not the payload, end to end:

1. **Headline** — `actionFromPending(p)` (`web-v2/lib/brain/proposal/staleness.ts:250-256`): since a stored `action` exists and its kind is `COORDINATED`, it is returned **as-is**. `headlineFor(p)` (`web-v2/lib/faff/v5-proposals.ts:130-138`) calls `actionHeadline(action, dayName)`. `actionHeadline`'s `COORDINATED` case (`web-v2/lib/faff/v5-action-render.ts:158-159`) is `return action.describe;` — **the generated headline is the literal string "Threshold moves to 7:12 across the block."** Nothing else. There is no code path anywhere in `v5-proposals.ts` or `v5-action-render.ts` that iterates `action.parts` for display — `.parts` is read only by execution/undo/watch-behavior code (`accept.ts`, `execute.ts`, `undo.ts`, `watch-facet.ts`), never by anything that produces runner-facing text.
2. **Direction badge** — `phoneDirectionOf` (`v5-action-render.ts:38-46`), rule `COORDINATED: 'FROM_DIRECTION'`, reads the stored `action.direction` field literally: `"MORE"` → **`push`**. (This is internally consistent with the payload's own `meanAnchorDeltaSecPerMi: -2.83` — net faster on average — even though one of the six parts, marathon, individually moved slower.)
3. **"Why" text** — `toWire` (`v5-proposals.ts:414`): `why = (p.reason ?? '').trim()` — the literal DB `reason` column: **"Your recent training puts your threshold at 7:12 per mile. This block is written at 7:10 per mile."**
4. **Affected-sessions row** — `affectedFrom` (`v5-proposals.ts:568-586`): since `action_kind === 'reprice'` and `workoutsAffected = 75` (≠1), and `workoutsSealed = 0`: one row, **"75 prescribed sessions, from this day to the end of the block."** (No second row, since `workoutsSealed` is 0.)
5. **Evidence detail sheet** — `detailFor` → `evidenceProse`'s `repriceRead` (`web-v2/lib/faff/v5-evidence-prose.ts:175-304`), fed the row's own `evidence` JSON (`evidence_source:"run"`, `anchor_confidence:0.79`, `anchor_vdot_now:47.8`, `anchor_vdot_proposed:47.8`, `ends_calibration_intro:false`): confidence 0.79 ≥ `CAPACITY_CONFIDENCE_BANDS.fallbackCeiling` (0.50) → "high" band; `pricedAt == readsNow` (47.8 = 47.8) → `level = true`, `calibrationEnding = false`. This generates exactly two sentences: **"The read comes from your own recent training, not from a race, and it is held with high confidence."** and **"Your fitness reads level with what this block was priced at. This is not a fitness change: the paces the block is written at have drifted from what your evidence now supports."**

**The complete generated card text, reconstructed exactly, is therefore:**

> **Threshold moves to 7:12 across the block** *(push)*
> Why: Your recent training puts your threshold at 7:12 per mile. This block is written at 7:10 per mile.
> Affects: 75 prescribed sessions, from this day to the end of the block.
> Detail: The read comes from your own recent training, not from a race, and it is held with high confidence. Your fitness reads level with what this block was priced at. This is not a fitness change: the paces the block is written at have drifted from what your evidence now supports.

**This distinguishes cleanly from v1's own prose error, in a way v1 never framed:** v1's report characterized the anchor directions incorrectly ("both easy ceilings slower," "marathon faster"); its reviewers corrected the *direction of the underlying payload data*. But **the actual runner-facing card never states any individual anchor's direction at all** — not the correct one, not the wrong one. The card is one sentence about the threshold lever specifically, one "push" badge, and a session count. The genuinely open product question this surfaces — which neither v1 nor either reviewer asked — is whether bundling six anchor moves (one of which, marathon pace, moves in the opposite direction from the other five and from the badge's own "push" framing) behind a single threshold-only headline and a single net-direction badge is the right level of disclosure for a decision RUNNER_DAVID is being asked to accept or decline. That is a real, unresolved UX question about the *design* of `COORDINATED` cards generally — it is not, and was never, a bug in what got rendered for proposal 13 specifically, and it is not fixable by correcting the anchor-direction prose, because the prose in question never reaches the card at all. `[SOURCE]`-complete; `[RENDER]` = `[BLOCKED: no simulator session this pass]` — though given the trace has no remaining conditional branches to be wrong about (same reasoning as item 4a), I'd weight this citation highly even unrendered.

---

## 6. The "14 PROGRESS outcomes" number

**Verdict: v1's classification (and the task's own suggested fallback classification, "INVALID/UNSUBSTANTIATED") is wrong. The number is real, reproducible right now, and I reproduced it myself, live, from a still-existing test harness — not from any of the three tables v1 (correctly) checked and came up empty on.**

**Where it actually comes from, found by broadening the search per the task's instruction:** grepping all of `docs/` (not just the audit trail) for "14" near "progress" surfaces `docs/reports/core-closure-2026-09-04/ADAPTATION-VERDICT.md`, `BUILD-278.md`, and `RUNNER-LOOP-VERDICT.md` — a 2026-09-04 build-closure exercise, entirely separate from `coach_intents`/`adaptation_shadow_log`/`canonical_adaptation_shadow_log`. `ADAPTATION-VERDICT.md` carries a section literally titled **"RECONCILED (later the same day) · 'PROGRESS 14' IS NOT WHAT IT SOUNDS LIKE"** — the number was already walked back, same day, by the same report, before v1 ever looked for it:

> Fourteen PROGRESS *proposals*. **ONE applied.** ... 10 suppressed by WEEKLY_VOLUME ("the threshold evidence supports this change, but this week already contains enough change"), 3 by PLAN_LOAD.

A later, still-current status report (`docs/audit-2026-09-08-full-status-master-report.md:701,800,842,1009`) independently flags the same figure as stale and un-recomputed, and `docs/audit-2026-09-10-canonical-record.md:239` (row 49, written by the very commit that set up this correction pass) reserves this exact question as "OPEN — awaiting corrected handback." **This task is that corrected handback.**

**I did not stop at finding the doc. I found the live mechanism and ran it.** `docs/reports/core-closure-2026-09-04/BUILD-278.md:84` names it "adaptation replay, 30 tests, 0 failures · PROGRESS 14." `git log` traces this concept forward through `5a418eec9 proof(adaptation): replay the canonical engine against his real training, and it never pushes` → `b10e6197f fix(adaptation): the engine could not go up` → `ac95f7b80 feat(replay): answer Rule 21's actual question — is the bar a bar, or a wall` → several more fixes, landing at **`scripts/adaptation-real-replay/real-replay.test.ts`**, which still exists in the tree today, still opens no database connection, and is built to replay the canonical adaptation engine against a frozen, documented, falsified (per its own Rule-18-style header: it deliberately broke its own no-lookahead fence and watched three tests catch 537 + 40 leaks before restoring it) snapshot of RUNNER_DAVID's real production history (`real-history.snapshot.json`: 156 canonical runs 2026-01-01→2026-09-02, 9 plan versions, 570 prescriptions, 11 races, extracted 2026-09-03T05:26:22Z).

`[TEST]` — I ran it myself, read-only, this pass:

```
Test Files  1 passed (1)
     Tests  22 passed (22)
```

with `REPLAY_LEDGER_OUT` capturing the full decision ledger. The resulting distribution:

```
distribution: { PROGRESS: 14, HOLD: 64, REGRESS: 4, REFUSE: 38 }
```

**Fourteen, exactly, reproduced today against the current codebase (`ae91e3066`), byte-for-byte matching `RUNNER-LOOP-VERDICT.md`'s 2026-09-04 figures** (PROGRESS 14 / HOLD 64 / REGRESS 4 / REFUSE 38 — all four numbers agree). Per-lever breakdown: all 14 PROGRESS decisions are on `THRESHOLD_PACE`; `WEEKLY_VOLUME` and `LONG_RUN` each show zero PROGRESS. And pulling the individual ledger rows confirms the reconciliation's own follow-up claim still holds exactly: of the 14, **13 carry a `suppressed` field** (9× `WEEKLY_VOLUME · the threshold evidence supports this change, but this week already contains enough change`, 3× `PLAN_LOAD · arbitrated at the weekly boundary`, 1× `PLAN_LOAD · another lever is already making a material change`), and **exactly one** (2026-06-22, threshold 7:22→7:19/mi) is unsuppressed.

**What "14" actually is, stated precisely for the ledger:** it is not a production count from any live table (which is exactly why `adaptation_shadow_log`, `canonical_adaptation_shadow_log`, and `coach_intents` — the three tables v1 and its reviewers correctly checked — all come up empty; none of them is what this number describes). It is the count of **decision-point verdicts** a **replay/simulation harness** produces when the current canonical Adaptation Engine is run, in memory, against RUNNER_DAVID's real historical training data as if that engine had been driving his plan the whole time. It answers "how many times would this engine have proposed pushing the threshold pace up, had it been live" — not "how many times did the plan actually change." Of those 14 hypothetical proposals, arbitration (a separate, real, currently-live component) would have let through only 1. This is a **capability proof**, not a **production log** — and per the migration-history check the task asked for, there is no dropped or renamed DB table (`find` for migration directories plus a `git log --diff-filter=D` sweep for deleted `.sql` files with "progress"/"adaptation" in the name returns nothing) that ever held this number. The mechanism that produces it has never been a database table at all.

**Classification, stated directly per the task's instruction:** not INVALID/UNSUBSTANTIATED. **VALID, but scoped to a different question than the one Rule 21 asks.** Rule 21's "zero upward, ever, in `coach_intents`" finding is unaffected and correctly scoped to production history. This "14" is the answer to "is the bar a bar or a wall" (literally the commit message that introduced the harness) — and the harness's own honest answer, unchanged since 2026-09-04 and reproduced fresh today, is: **the bar is real (14 genuine PROGRESS-shaped opportunities existed in his real training), but arbitration's weekly-cadence rule ate 13 of them, and the fix for that is a genuine doctrine choice already written up with a recommendation in `ADAPTATION-VERDICT.md`** (the `[1, 1.5)` sec/mi arbitration-exception-window defect `RUNNER-LOOP-VERDICT.md` names, gated today by `ARBREACH-1`) — not an open mystery, and not a number to discard.

---

## Summary table for the integration agent

| # | Item | Resolution |
|---|---|---|
| 1 | `recoveryExtensions`/`ceilingLift` consumers | **Real consumer found**: `RunDetailV5.swift`'s "Wrist Decisions" panel, wired live via `/api/runs/[id]` → `loadRunDetail`. v1's "no confirmed consumer" claim was false. Needs a render to close Rule 13 fully. |
| 2 | 12.1/4.9 → 12.0/5.0 rounding gap | Still unresolved, but 6 specific candidate mechanisms individually ruled out with direct evidence (no audit trail exists; no later mutation, proposal, or rebuild touches these rows; the accept-path writes unrounded; none of the 3 live `distance_mi` writers produce this shape; the legacy `web/` tree that ran at the time no longer exists in-tree; the reviewer's "EVENT-2" guess doesn't exist in the codebase). |
| 3 | 7 run IDs from the 2026-08-30 incident | **Fully resolved.** IDs recovered from user memory, confirmed by exact ID against production: 7 rows, 63.0 mi, all still un-absorbed, all covered by today's repair-verification predicate. |
| 4 | All 6 races in the Races/PR payload | **Resolved.** The schedule screen (`/api/v5/races`) includes all 6 unconditionally. The bucketed PR screen (`/api/records`) correctly shows only the fastest-per-distance-bucket (2 of 6) by design — not a defect. v1 conflated the two screens. |
| 5 | Proposal 13's actual wire text | **Fully traced and quoted.** The rendered card never states individual anchor directions — only a single threshold-lever headline, a net "push" badge, a reason sentence, and a session count. The anchor-direction dispute between v1 and its reviewers was entirely about payload data that never reaches a rendered sentence. |
| 6 | "14 PROGRESS outcomes" | **Resolved, and reproduced live.** Traced to `scripts/adaptation-real-replay/real-replay.test.ts`, a still-existing, DB-free replay harness; re-ran it this pass and got PROGRESS 14 / HOLD 64 / REGRESS 4 / REFUSE 38, matching the 2026-09-04 figures exactly. It answers a capability question (what the engine WOULD propose), not a production-history question — `coach_intents`/`adaptation_shadow_log`/`canonical_adaptation_shadow_log` correctly show nothing, because none of them is what "14" describes. Not invalid; scoped differently than Rule 21. |

No writes, migrations, merges, or proposal decisions were made or touched at any point in this pass.