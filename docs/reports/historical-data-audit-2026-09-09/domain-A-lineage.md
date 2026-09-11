Based on the extensive independent re-verification performed above (database queries against `faff_readonly`, and source reads at the pinned commit via `git show`), here is my complete review.

---

# INDEPENDENT REVIEW — Domain A "Data Inventory and Lineage" (Pass 2 Report)
## faff.run · Reviewer Pass · 2026-09-09

**Reviewer role:** Independent falsification pass on the Domain A report reproduced in the prompt above.
**Pinned commit re-confirmed:** `8559245496bf498d3d4b0479e1117ae416988c4a`. `git log -1` on this SHA and on local `HEAD` are identical; `git fetch origin main` confirms `origin/main` has **not moved** past this commit as of this review — the pin is still live and current. [SOURCE]
**DB access:** connected as `faff_readonly` via `DATABASE_URL_RO`; `SELECT current_user` returned `faff_readonly`. No write-shaped SQL issued at any point. [PROD-QUERY]
**Identity:** `users.id = '<RUNNER_UUID_REDACTED>'`, `email = 'RUNNER_DAVID'` — confirmed the schema really does use `id` (not `user_uuid`) on `users`, corroborating the report's naming-asymmetry observation. [PROD-QUERY]

I re-ran essentially every re-runnable claim in the report rather than sampling, because the domain is exactly "does the data say what the report says it says," and that is cheap to check exhaustively against a read-only replica. I found the report to be **extremely well-corroborated on every quantitative production-data claim** — I did not manage to break a single number. I did, however, find and confirm **one material, independently-derived contradiction** that both Pass 1 and Pass 2 of the report missed: an in-repo doctrine comment the report treated as a settled [SOURCE] fact is demonstrably false against the live Swift codebase at the same pinned commit. Full detail in §3.

---

## 1. Verdict table — my own classification per material claim

Legend: **CONFIRMED-BY-ME**, **COULD-NOT-REPRODUCE**, **CONTRADICTED-BY-ME**, **UNTESTABLE**.

| # | Claim | My verdict | My evidence |
|---|---|---|---|
| 1 | Identity: `users.id` (not `user_uuid`) is the PK; every other table uses FK col `user_uuid` | CONFIRMED-BY-ME | `\d users`, `\d runs` [PROD-QUERY] |
| 2 | 287 total runs / 162 canonical-by-key / 125 absorbed-by-stamp, zero cross-disagreement | CONFIRMED-BY-ME (exact) | Direct count query, both disagreement directions = 0 [PROD-QUERY] |
| 3 | `CANONICAL_ROW_SQL` exists as the one exported canonical predicate | CONFIRMED-BY-ME | `git grep`, exported from `lib/runs/volume.ts`, re-exported in `run-shape.ts:972` [SOURCE] |
| 4 | `hrZonePcts` 34/162, `phases` 52/162, `planWorkoutId` 9/162, `clockAudit` 4/162 | CONFIRMED-BY-ME (exact) | Direct count [PROD-QUERY] |
| 5 | `repSkips` 0/162 | CONFIRMED-BY-ME | Two independent query shapes (phase-level key check, per-row EXISTS), both 0 [PROD-QUERY] |
| 6 | `recoveryExtensions` 1/162, `ceilingLift` 3/162 | CONFIRMED-BY-ME (exact), **after correcting my own initial methodology** | My first query (checking inside phase objects) wrongly returned 0/0 — these keys live at the top level of `data`, not per-phase. Corrected query returned exactly 1 and 3, matching the specific rows and phase indices the report would need to be consistent with. [PROD-QUERY] — see note in §2. |
| 7 | `status`-present 15/162, 1 `abandoned` | CONFIRMED-BY-ME (exact) | [PROD-QUERY] |
| 8 | `ruleOutcomes` 0/162 | CONFIRMED-BY-ME | Checked via `jsonb_path_exists(data, '$.**.ruleOutcomes')` — top-level and nested, still 0 [PROD-QUERY] |
| 9 | Source distribution 88/69/56/33/21/11/9, all-time, sums to 287 | CONFIRMED-BY-ME (exact) | [PROD-QUERY] |
| 10 | `elevGainSource` distribution 91 key-absent/33 raw/18 absent/8 treadmill_incline/6 gps_derived/3 recomputed/3 watch, sums to 162 | CONFIRMED-BY-ME (exact) | [PROD-QUERY] |
| 11 | 4 canonical rows carry `clockAudit`, `pausedSec`=`declinedSec`=0 on all 4, dates 2026-08-21/08-23/08-24/09-02 | CONFIRMED-BY-ME (exact, including dates) | [PROD-QUERY] |
| 12 | `RECOVERY_DURATION_TOLERANCE = 0.5` at `execution-semantics.ts:639`; `recoveriesHonestOf` at lines 700-710, ignores `completed` | CONFIRMED-BY-ME (exact line numbers) | `git show <SHA>:web-v2/lib/training/execution-semantics.ts`, `grep -n` [SOURCE] |
| 13 | `strides_recovery_s: 60` on `wko_d19936ca5659c63b` | CONFIRMED-BY-ME | [PROD-QUERY] against `plan_workouts.workout_spec` |
| 14 | Today's run `-218380344929823`: 14 phases (1 work-long, 6 work-strides, 6 recovery, 1 overtime); the exact recovery-duration table (30/43/61/24/38/8 vs. prescribed 60, completed flags false/false/true/false/false/false) | CONFIRMED-BY-ME (exact, cell-for-cell) | [PROD-QUERY] — phase-by-phase extraction |
| 15 | 2/6 recoveries (phases 4 and 6) fail the 30-second tolerance; consequence: `recoveriesHonestOf` returns `false` for this run under the pinned code | CONFIRMED-BY-ME | Arithmetic re-derived from #14; `recoveriesHonestOf`'s exact predicate re-read from source, confirms `|24-60|=36>30` and `|8-60|=52>30` fail while the other four pass |
| 16 | `sessionLadder` gates the `'executed'` verdict on `recoveriesHonest !== false` | CONFIRMED-BY-ME — **this was NOT verified by the report itself** (it explicitly deferred this to "Domain C's territory"); I checked it anyway since it was cheap and it materially strengthens/weakens the central §2.1 claim | Read `sessionLadder` body directly: `landed === graded && !lateCollapse && recoveriesHonest !== false` is the sole path to `'executed'` [SOURCE] |
| 17 | WALKBACK-2 (`recoveryEndedEarly`/`RecoveryEndedEarlyRecord`) is absent from the pinned commit's `execution-semantics.ts` | CONFIRMED-BY-ME | `git grep` for both strings against the pinned SHA returns zero hits anywhere in `web-v2` [SOURCE] |
| 18 | WALKBACK-1/WALKBACK-2 both `REVIEWED — MERGE PENDING`, not merged to `main`, per canonical handback | CONFIRMED-BY-ME, **and I found something the report didn't have**: a merge commit (`e5bcc430b`, timestamped 16:25 -0700, i.e. ~2 hours **after** the pin) on branch `integration/programme-lead-merge-2026-09-09` already composes WALKBACK-1+WALKBACK-2 for both Swift and TS. It is confirmed **not** an ancestor of the pinned commit and **not** an ancestor of current `origin/main` — so the report's "still unmerged as of the pin" claim holds, but there is now a ready integration branch sitting one merge away. This postdates the pin and is not a contradiction, but is materially relevant forward-looking context (see §4). | `git merge-base --is-ancestor`, `git log --all` [SOURCE] |
| 19 | 63mi canonical-loss repair (2026-08-30) holds durably — 0 rows/0 miles on the reused detection query, all 7 named rows still un-absorbed with correct distances (18.0mi on 2026-07-25, 13.13mi on 2026-06-14, etc.) | CONFIRMED-BY-ME (exact, all 7 rows individually) | [PROD-QUERY] |
| 20 | 0.43mi watch-truncation repair (`-145861381014809`) holds — `distanceMi:6.41`, `durationSec:3349`, `manualCorrection` present with the exact before/after/source/reason text described, and `clockAudit.countedSec` (3057) internally matches the pre-repair `durationSec` | CONFIRMED-BY-ME (exact, including full text match) | [PROD-QUERY] — read the full `manualCorrection` object |
| 21 | `coach_intents`: 321 rows today (up from 309); `plan_adapt_downgrade`=5, `plan_adapt_long_floor`=5, `plan_adapt_reschedule`=3, `plan_adapt_missed_noted`=3, `plan_adapt_overridden`=2, `plan_adapt_gap`=1, `plan_adapt_drop_missed`=1, `vdot_auto_recalc`=1; zero reason strings matching upgrade/bump/accelerate/increase/push | CONFIRMED-BY-ME (exact) | [PROD-QUERY]; also cross-checked `user_id` vs `user_uuid` agree on every one of the 321 rows (Rule 14 sanity check the report didn't explicitly run) |
| 22 | `adaptation_log` is `{n, ts}`-only shape, no direction field | CONFIRMED-BY-ME, with one **imprecision** flagged | Only ONE plan (`pln_ca91f252bba50c74`) has a non-empty `adaptation_log` (4 entries, all bare `{n,ts}`) — every other plan's log is `[]`. The report's phrase "sampled 5 rows across 3 plans incl. one with 4 real log entries" is ambiguous/slightly imprecise about what was sampled, but the underlying factual claim (shape is `{n,ts}` only, no mechanism/direction recorded) is fully correct. |
| 23 | Case 1 (flatline HR), 2026-09-03 treadmill hill session: all 10 "Hill N of 10" work phases show `distinct_bpm = 1` with `n_samples` 11-19 | CONFIRMED-BY-ME (exact, all 10 phases) | [PROD-QUERY] — extracted every phase, label, sample count, distinct-bpm count |
| 24 | Negative-control claim: today's stride run does NOT reproduce the flatline pattern — distinct-bpm counts 48/2/4/5/7/3/11/4/4/3/5/4/1/0 | CONFIRMED-BY-ME (exact, all 14 values) | [PROD-QUERY] |
| 25 | `hrTraceIsCredible`, `MIN_SAMPLES_TO_JUDGE = 5`, wired into `classify-evidence.ts` as `flatlinedTelemetry` | CONFIRMED-BY-ME | `git grep`, direct file read, line 56 for the constant [SOURCE] |
| 26 | OVERTIME-PHASE-1 fix dated 2026-09-08, present at pinned commit in `TodayAfterV5.swift`, `RepBreakdownV5.swift`, `web-v2/app/api/v5/today/route.ts` | CONFIRMED-BY-ME | `git grep` for the literal tag across the pinned tree [SOURCE] |
| 27 | HealthKit `ALLOWED_TYPES` closed allowlist, ~29 types, historical silent-discard incidents documented inline | CONFIRMED-BY-ME (28 counted exactly, "~29" is a fair rounding; 3 distinct dated incident comments present) — **report marked this NOT_RE_TESTED; I resolved it** | Found and read `web-v2/app/api/ingest/health/route.ts:65-93` directly (report's Pass-1 citation didn't name this exact file/path) [SOURCE] |
| 28 | Weather: `dewpointF` never stored on a run row; computed at read time via Magnus-Tetens | CONFIRMED-BY-ME — **report marked this NOT_RE_TESTED; I resolved it empirically** | [PROD-QUERY]: 124/162 canonical rows carry `data.weather{}`, 130/162 carry legacy `data.tempF`, **0/162** ever carry `weather.dewpointF`; `git grep -l Magnus` finds `heat-model.ts` computing it live [SOURCE]+[PROD-QUERY] |
| 29 | `source_mode`/`sourceMode` present in code across the named files (`capacity-resolver.ts`, `decision-ledger.ts`, `reanchor-plan.ts`, `reprice-payload.ts`, `race-outlook-payload.ts`, `runner-state/store/*`) | CONFIRMED-BY-ME | `git grep -l "source_mode"` returns the exact 9-file set claimed (camelCase `sourceMode` in `capacity-resolver.ts` specifically) [SOURCE] |
| 30 | In-repo "Rule N" doctrine comments (Rule 6, 8, 9, 11, 14, 16, 20) genuinely appear inline in the code, matching CLAUDE.md's numbering, independent of the CLAUDE.md text itself | CONFIRMED-BY-ME (partial spot-check: Rule 6, 14, 16 confirmed in `run-shape.ts`; Rule 11 confirmed twice in `postrun/experience.ts` and `postrun/load.ts`, see §3) | `git grep` [SOURCE] |
| 31 | **"`pausedSec`/`droppedGapSec` structurally dead — no Swift client has ever sent them"** (Pass 1 claim, carried forward by Pass 2 as `NOT_RE_TESTED`, cited to "two TS code comments") | **CONTRADICTED-BY-ME** | See §3 in full below — this is my one substantive disagreement with the report. |
| 32 | Working-tree note: an untracked `_agentD_capture.audit.test.ts` file present at the reviewed report's session start | COULD-NOT-REPRODUCE (not a contradiction) | `git status --short` in my session shows only `?? AGENTS.md`; the named file does not exist on disk. Consistent with the file's own self-declared "temporary, delete after use" status — it was very plausibly cleaned up between that report's session and mine. I flag this as a time-of-check difference, not a defect in the report. |

---

## 2. A correction to my own methodology, disclosed rather than hidden

On claim #6 (`recoveryExtensions`/`ceilingLift`), my first query checked *inside each phase object* in `data.phases[]` for these keys and got 0/0 for both — apparently contradicting the report. Before concluding "CONTRADICTED," I checked where these keys actually live: they are **top-level arrays on `data`** (`data.recoveryExtensions`, `data.ceilingLift`), each entry carrying its own `phaseIndex`/`phaseLabel` pointer back into the phases array — not properties nested inside the phase objects themselves. Re-querying at the correct nesting level returned exactly 1 row for `recoveryExtensions` (row `-145861381014809`, the same watch-truncation row, four `addedSec:30` entries at `phaseIndex:10`) and exactly 3 rows for `ceilingLift` (`-245190372869167`, `-145861381014809`, `-255291701482225`), matching the report's counts exactly. I record this because Rule 13/18's own standard applies to a reviewer too — a hasty first-pass "gotcha" that turns out to be my own error is worth surfacing and correcting in the open rather than silently deleting.

---

## 3. The one material disagreement: the "no Swift client sends pausedSec/droppedGapSec" claim is FALSE

This is the substantive finding of this review pass, and it is exactly the class of defect this codebase's own Rule 18/19/20 warn about: **an in-repo comment asserting an invariant that nothing checked, sitting in the file this domain's whole Case 2 analysis is built on.**

**What the report says.** Pass 1 wrote (claim carried into Pass 2's classification table as row #7, `NOT_RE_TESTED`, sourced to "two TS code comments"):

> `pausedSec`/`droppedGapSec` structurally dead — no Swift client has ever sent them

The two comments in question, both read directly by me at the pinned commit:

- `web-v2/lib/postrun/experience.ts:1172-1173`: *"`pausedSec` and `declinedSec` are NOT [measurements]: the route computes each as `Number(body.pausedSec) || 0`, and **no Swift file in this repository sends either field**, so both are structurally `0` on every row ever written."*
- `web-v2/lib/postrun/load.ts:705-706`: *"`pausedSec` and `declinedSec` are deliberately NOT carried. **No Swift file sends either**, so the route's `Number(body.pausedSec) || 0` makes both structurally zero on every row, and a zero meaning 'nobody said' must not travel beside three real measurements (Rule 11)."*

**What I found by checking it.** `git grep -ln "pausedSec\|droppedGapSec" <pinned SHA> -- '*.swift'` returns **seven** Swift files, and two of them are live, currently-wired, current-generation (`native-v2`, not `legacy/native`) views that explicitly construct and send these exact wire keys:

- `native-v2/Faff/Faff/Views/TreadmillView.swift:1074-1076`:
  ```swift
  if session.belt.droppedSec >= 1 {
      payload["droppedGapSec"] = Int(session.belt.droppedSec.rounded())
  }
  if session.belt.pausedSec >= 1 { payload["pausedSec"] = Int(session.belt.pausedSec.rounded()) }
  ```
- `native-v2/Faff/Faff/ViewsV5/LiveRunTreadmillV5.swift:671-673`: identical construction.

Both files post to `api/watch/workouts/complete` (confirmed via the `URLRequest` construction at `TreadmillView.swift:1132`), which is the exact same route whose server-side code — `web-v2/app/api/watch/workouts/complete/route.ts:576-591` — reads `body.pausedSec` / `body.droppedGapSec` and maps them directly into `clockAudit.pausedSec` / `clockAudit.declinedSec`:

```ts
pausedSec: Number(body.pausedSec) || 0,
declinedSec: Number(body.droppedGapSec) || 0,
```

Both Swift views are reachable, current UI (`TreadmillView(...)` is instantiated from `RootTabView.swift`; `LiveRunTreadmillV5(...)` from `HostsV5.swift`) — this is not legacy/dead code sitting under `legacy/native`. And it is not merely theoretical: two of David's own nine treadmill rows (`-75039485987228`, 2026-08-27; `-240375143823562`, 2026-09-03) already carry `unmeasuredSec`, the sibling field gated by the identical `>= 1` conditional right next to `droppedGapSec`/`pausedSec` in the same payload-construction block — direct, empirical proof this belt-tracking mechanism is live and actually firing in this account's production history, not dormant code that happens to compile.

**What is and isn't still true.** The narrow empirical fact — that every `clockAudit` row this account has ever produced happens to show `pausedSec`/`declinedSec` = 0 — remains true and I re-confirmed it (claim #11 above). What is false is the *reason* the code gives for that fact, and the unconditional claim built on it: "no Swift file... sends either field" is not a fact about the codebase, it is a fact about this account's history so far that got written down as if it were a structural guarantee. If David ever pauses mid-treadmill-run long enough for `belt.pausedSec >= 1`, this mechanism will send a nonzero value, `route.ts` will store it, and the two `postrun` readers that currently strip these fields "because nothing sends them" will have their premise silently invalidated — with no gate anywhere that would notice.

This is precisely Rule 20's own diagnosis, pointed back at the codebase's own doctrine comments: *"a header comment asserting an invariant is documentation, not enforcement... gate the claim or delete the sentence."* Two sentences, in two files, assert exactly the kind of unverified invariant Rule 19/20 exist to catch — and they did so while explicitly invoking Rule 11 as their justification for stripping the fields, which makes the irony sharper: the comment cites the very rule ("a missing input must never silently disable a safety mechanism... ask why a number is low or absent before spending it") that its own unverified premise violates.

**Why this matters for the report's conclusions, and why it doesn't overturn them.** The report's Case 2 argument — "the pause/early-end is a second-order arithmetic inference, never a first-class recorded fact" — still stands; if anything this strengthens it, because it shows the *mechanism that could make it first-class* (a genuine wire-carried pause signal) already exists in two Swift views, is already read server-side, and is being thrown away downstream by two `postrun` readers on the strength of a false premise, rather than never having existed at all. The report's practical numeric claims (0/0/0/0 across the 4 `clockAudit` rows) are unaffected. What changes is the confidence level on one NOT_RE_TESTED row that both passes left unchecked despite having built an entire case study around the exact mechanism it describes — a "cheap to check, nobody checked it" gap, which is itself a finding about audit process worth naming: **Pass 1 flagged the claim's evidence tag correctly ([SOURCE], not [PROD-QUERY]) and Pass 2 explicitly listed it as carried-forward-unchanged rather than re-verified — the tagging discipline worked exactly as designed in surfacing where the gap was, it just wasn't acted on.**

---

## 4. Additional context I found, not a contradiction

While confirming the WALKBACK-1/WALKBACK-2 unmerged status (claim #18), I discovered a merge commit `e5bcc430b` ("Merge feat/recovery-ended-early-record ... programme-lead integration") on a branch `integration/programme-lead-merge-2026-09-09`, timestamped **2026-09-09 16:25:33 -0700** — about two hours after the pinned commit's 14:36:10 timestamp. I confirmed via `git merge-base --is-ancestor` that neither this commit nor its constituent branches are ancestors of the pinned commit or of current `origin/main`. So the report's claim ("still unmerged" as of the pin) is correct and unaffected. But it means that, as of right now, there is a ready-composed integration branch sitting one `git merge` away from closing the exact live production defect §2.1 describes on today's real run. This is worth surfacing to whoever owns the merge decision — not something the reviewed report could have known, since it postdates the pin, and not something I am fixing (read-only mandate).

---

## 5. Annotated report — corrections folded in inline

Below is the original report with my corrections marked `[REVIEWER: ...]` at the exact points they apply. All other text is the original, unmodified.

> ### 1. Identity resolution [PROD-QUERY]
> ...
> Total rows in `runs` for this user: **287**. Rows satisfying the canonical key-presence predicate `NOT (data ? 'mergedIntoId')`: **162**. Rows carrying the `absorbed_into_canonical_at` timestamp: **125**.
>
> **[REVIEWER: CONFIRMED-BY-ME, exact, independently re-run against `faff_readonly` on 2026-09-09. Zero rows of disagreement in either direction, matching the report's own re-check.]**

> ### 2.1 A material new finding...
> ...| 4 | false | 24 | 60 | 36 | **FAIL** |
> | 6 | false | 8 | 60 | 52 | **FAIL** |
>
> **[REVIEWER: CONFIRMED-BY-ME, cell-for-cell, against `runs.id = -218380344929823`. I additionally read `sessionLadder`'s definition directly — a step the report deferred to "Domain C" — and confirmed `recoveriesHonest !== false` is the sole gate on the `'executed'` verdict, which structurally corroborates the "concrete, present-tense instance of the WALKBACK-2 defect class" conclusion rather than just asserting it by citation.]**

> ...`recoveriesHonestOf()` at the pinned commit is a pure duration-tolerance check ... It does **not** read the `completed` boolean at all, and it does **not** yet reference any `recoveryEndedEarly`/`RecoveryEndedEarlyRecord` field — because WALKBACK-2 ... is confirmed by the canonical handback ... to be **still unmerged** ...
>
> **[REVIEWER: CONFIRMED-BY-ME. And: `origin/main` has not moved past the pinned commit as of this review, so the "still unmerged" status holds at time of review too — but a separate integration branch (`integration/programme-lead-merge-2026-09-09`, merge commit `e5bcc430b`, timestamped ~2 hours after the pin) already composes both fixes and is one merge away from `main`. See §4 of my review.]**

> ### 2.3 Claim-by-claim classification
> | 7 | Pass 1: `pausedSec`/`droppedGapSec` structurally dead — no Swift client has ever sent them | **NOT_RE_TESTED** ... | [SOURCE] (two TS code comments) only, unchanged |
>
> **[REVIEWER: CONTRADICTED-BY-ME. `native-v2/Faff/Faff/Views/TreadmillView.swift:1074-1076` and `native-v2/Faff/Faff/ViewsV5/LiveRunTreadmillV5.swift:671-673` — both live, reachable, current-generation code — construct and POST exactly these wire keys (`payload["droppedGapSec"]`, `payload["pausedSec"]`) to `api/watch/workouts/complete`, which reads them server-side into `clockAudit.pausedSec`/`declinedSec`. The claim "no Swift file... sends either field" is false as a statement about the codebase. The narrower empirical fact — that David's own `clockAudit` rows have always shown 0/0 — remains true, and I independently reconfirmed it, but the code-level reasoning behind it (asserted verbatim in `postrun/experience.ts:1172-1173` and `postrun/load.ts:705-706`) is not a fact, it is an unverified assertion that happens not to have been falsified by this account's history yet. See §3 of my review for full detail.]**

> All other rows of §2.3's table (#1-6, #8-29): **[REVIEWER: independently re-verified per the table in §1 above; no other disagreements found.]**

> ### 2.5 Net assessment for this domain, post-reconciliation
> Every quantitative claim in Pass 1 that was re-queried this pass came back **either identical or grew in exactly the direction its own stated mechanism predicted**... No claim was contradicted.
>
> **[REVIEWER: this sentence needs one amendment. One claim — a qualitative, non-numeric one about the Swift codebase — was carried forward as "unchanged" without being re-tested, and when I re-tested it, it was contradicted. The quantitative claims genuinely hold up perfectly; the "no claim was contradicted" statement should be scoped to the quantitative production-data claims, which is where this domain's real strength lies.]**

---

## 6. Explicit list of disagreements between me and the original report

1. **The central, substantive disagreement**: claim #7 in the report's own reconciliation table ("`pausedSec`/`droppedGapSec` structurally dead — no Swift client has ever sent them"), left as `NOT_RE_TESTED` by both Pass 1 and Pass 2, is **CONTRADICTED** by direct inspection of the Swift source at the identical pinned commit. Two live, reachable native-v2 views send exactly these fields, and two in-repo TS comments (`postrun/experience.ts`, `postrun/load.ts`) assert the opposite as settled fact. See §3.
2. A **process observation, not a factual disagreement**: the report's final "no claim was contradicted" summary sentence (§2.5) should be scoped — it is true of every quantitative/production-data claim, but not of the one qualitative Swift-codebase claim above, which the report itself flagged as unverified and I then verified.
3. **A minor imprecision, not a contradiction**: the report's phrase "sampled 5 rows across 3 plans incl. one with 4 real log entries" (re-testing `adaptation_log`'s shape) is ambiguously worded — I found exactly one plan with a non-empty `adaptation_log` (4 entries), and every other plan I could find has an empty array. The underlying claim (shape is `{n, ts}` only, no direction recorded) is fully correct regardless.
4. **A time-of-check difference, not a contradiction**: the working-tree note about `_agentD_capture.audit.test.ts` does not reproduce in my session (file no longer exists; `git status --short` shows only `?? AGENTS.md`). Consistent with the file's own self-declared temporary nature — most likely cleaned up between sessions, not evidence the report's original observation was wrong.
5. No disagreement on any other material, numeric, or structural claim in the report. Every production-data count, every cited line number, every phase-level and row-level fact I checked came back exact.