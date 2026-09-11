# Reconciliation of v1 Historical-Data Forensic Audit Against Current `origin/main`

**Scope of this pass:** read-only correction/completion pass. No product fixes, no merges, no migrations, no writes performed. All git ancestry checks and DB queries below were run fresh in this session, not taken on faith from the task brief or from v1.

**Pins in play, and a disclosure the task itself asked me to make explicit:**

| Label | SHA | Committed | Role |
|---|---|---|---|
| v1 original pin | `8559245496bf498d3d4b0479e1117ae416988c4a` | 2026-09-09 14:36:10 -0700 | What every `[SOURCE]` citation in the four domain reports and the v1 handback was pinned to |
| Task's "current" pin | `ae91e30668df7e14b1279cb6e4d20db87de5250e` | 2026-09-09 18:17:37 -0700 | What this reconciliation was asked to check against |
| Actually-live `origin/main` at the moment I ran `git fetch` | `80fca013f94b99ee5af3f84e79590591d42141da` | 2026-09-09 18:59:58 -0700 | `[SOURCE]`, `git fetch origin main` output, this session |

`[SOURCE]` `git merge-base --is-ancestor ae91e30668df7e14b1279cb6e4d20db87de5250e origin/main` → **YES**. `origin/main` moved again during this very reconciliation pass — the exact CLAUDE.md-warned pattern ("a second agent is frequently committing to `main` at the same time... never assume your worktree's base branch is the source of truth") — but the one commit between the task's pin and the live tip is `80fca013f docs(audit): reserve ledger rows for preliminary forensic runner-data audit findings`, a docs-only commit touching no code. I checked its diff; it does not touch any file cited below. **All findings below are verified against both `ae91e30668df7e14b1279cb6e4d20db87de5250e` and the live tip `80fca013f`, and the two pins agree on every code-level fact in this report.** Where I say "current main" without qualification, both pins concur.

**Database access used:** `faff_readonly` role via `DATABASE_URL_RO`, `web-v2/.env.local`, per the task's instruction. Every query below is `[PROD-QUERY]`, freshly run this session, none reused verbatim from v1's own query text (though several intentionally re-derive the same fact v1 checked, to see if it moved).

---

## 1. The full commit/branch delta table

Every named commit, branch, or explicit "unmerged"/"pending" status claim across the four domain reports and the v1 handback, reconciled against current `main`.

| Finding / claim (as v1 stated it) | Status at v1's pin (`8559245`) | Status at current main (`ae91e306` / live `80fca013f`) | Fixed / Unfixed / Changed | Responsible commit(s) | Reaches PRODUCTION today? |
|---|---|---|---|---|---|
| **WALKBACK-1** — a shortened recovery no longer flagged "not completed" (server/TS-side Today-tab display fix) | `REVIEWED — MERGE PENDING`, not an ancestor of the pin `[SOURCE]` | **Merged.** `git merge-base --is-ancestor 7b0163c85 ae91e30668df7e14b1279cb6e4d20db87de5250e` → YES; same vs. live tip → YES. Lands on `main` via merge commit `1a26aae87` ("Merge fix/walkback-recovery-not-completed (7b0163c85)"). The merged content is byte-identical to `7b0163c85` except a pbxproj registration fixed 3 commits later by `8b9fb3159` — confirmed by `git diff 7b0163c85 522714789` showing only the `.pbxproj` delta. | **FIXED (merged)** | `1a26aae87` (merge), original branch tip `7b0163c85` | **Server side: yes, if the Railway deploy landed** — this is a Next.js/TS change under `web-v2/app/api/v5/today/route.ts` region, and per CLAUDE.md's deployment doctrine ("main now builds and deploys web-v2 only... fires automatically on push to main") this class of change auto-deploys on merge to main. `[BLOCKED: I have no Railway dashboard/API access in this read-only pass to directly confirm the deploy succeeded and is live — see §3 below for the CI-health evidence that bears on this.]` |
| **WALKBACK-2** — record and honor a deliberately-ended-early recovery (adds `endedEarlyByChoice`/`RecoveryEndedEarlyRecord`, both TS grading logic and Swift watch capture) | `REVIEWED — MERGE PENDING`, not an ancestor of the pin `[SOURCE]`; `recoveryEndedEarly`/`RecoveryEndedEarlyRecord` confirmed absent repo-wide at the pin | **Merged.** `git merge-base --is-ancestor e8052480946e2012a5bdb0a470af1787e821879f ae91e30668df7e14b1279cb6e4d20db87de5250e` → YES; same vs. live tip → YES. Lands via merge commit `e5bcc430b` ("Merge feat/recovery-ended-early-record (e80524809) — programme-lead integration (part 2 of 2)"). I read the merged `execution-semantics.ts` directly: `recoveriesHonestOf` now takes `endedEarlyByChoice?: boolean` per recovery and **excludes** any recovery so-flagged from the tolerance check entirely (`known = recs.filter(... && r.endedEarlyByChoice !== true)`) — this is the exact "excluded, not counted as compliant" shape the task brief pre-confirmed, and I confirm it myself by direct code read, not by taking the brief's word. | **FIXED (merged), but see the production-reachability split below — this is the one finding where "merged" is NOT the same question as "live for RUNNER_DAVID today."** | `e5bcc430b` (merge), original branch tip `e80524809` | **Split. Server (TS) half: same Railway-auto-deploy caveat as WALKBACK-1 above.** **Swift/watch half: definitively NOT yet on RUNNER_DAVID's watch.** See §2 for the full trace — this is the task's highest-priority verification target and I ran it end to end. |
| **Composed integration branch** `integration/programme-lead-merge-2026-09-09`, merge commit `e5bcc430b` | Confirmed by all domains as postdating the pin (~2h after), not-yet-ancestor of the pin or of `origin/main` at each domain's respective check time | **Now an ancestor of both `ae91e30668df7e14b1279cb6e4d20db87de5250e` and the live tip.** Confirmed above. | **FIXED (merged)** | `e5bcc430b` | Same split as WALKBACK-2 above — this merge commit is literally what carries WALKBACK-1+2 together. |
| `38b33f0f5` — "RacesV5Sample verdict-string fix" (`fix(races): sample fixtures use V5Feasibility's real raw values, not enum-case-name casing`) | Not referenced anywhere in the v1 historical-data-audit's four domain reports or its handback — `[SOURCE]` `grep -rn "38b33f0f5\|RacesV5Sample" docs/audit-2026-09-09-historical-data-forensic-audit.md docs/reports/historical-data-audit-2026-09-09/*.md` returns zero hits | `git merge-base --is-ancestor 38b33f0f5 ae91e30668df7e14b1279cb6e4d20db87de5250e` → **NO**. Same vs. live tip → **NO**. Confirmed genuinely not an ancestor of either. | **Still unmerged** — but this finding is **not part of the v1 historical-data audit's own finding set at all.** It belongs to a separate, concurrent audit stream (the current git log's recent commits — `081276a4b`, `dc3390e3b`, `319a0feeb`, `6135ee1c4` — show a parallel "FULLBLEED"/verdict-string/coach-voice review track). I confirm the ancestry fact the task asked me to confirm, and flag that it is out-of-scope of the four domain reports I was asked to reconcile — including it here only because the task instructed me to verify and report it. | N/A — no code from this commit reaches production regardless, since it never merged. |
| `49be10229` — "coach-voice header-comment fix" (`fix(coach-voice): address independent review conditions on PRIMER-SPECIFIC-1`) | Same as above — zero hits in any v1 doc | `git merge-base --is-ancestor 49be10229 ae91e30668df7e14b1279cb6e4d20db87de5250e` → **NO**. Same vs. live tip → **NO**. | **Still unmerged**, same out-of-scope caveat as `38b33f0f5` above. | — | N/A |
| `154edbf97` — "seven post-run defects on the owner's 2026-09-08 tempo" (the commit Domain D's reviewer cites as making `routePhases` phase-keyed rather than GPS-mile-keyed, central to the unresolved §9 dispute) | **Already an ancestor of the v1 pin** (`8559245`) — landed 2026-09-08, the day before the audit started. Never claimed "unmerged" by any domain. | Unchanged — still an ancestor of everything downstream, obviously. | **No change (was never a merge question)** | `154edbf97` | Same status as everything else that predates the pin: whatever was live at pin-time regarding this commit is still live now, undisturbed by the WALKBACK merges. |
| Any other named unmerged branch across the four domain reports | I grepped all five documents for every spelling of "unmerged," "merge pending," "not yet merged," "still unmerged" — every hit traces to WALKBACK-1/WALKBACK-2/`e5bcc430b` (see command output above). No fourth branch exists in v1's finding set. | — | — | — | — |

**Net read on this section:** the task brief's pre-confirmed facts about WALKBACK-1/2 and the integration branch are correct, and I reproduced them independently rather than trusting the brief. `38b33f0f5` and `49be10229` are also correctly described as unmerged, but they are not v1 findings — they're a different, currently-active audit thread that happens to share this repository's git history at the moment I looked.

---

## 2. WALKBACK-2 in depth: server-live vs. watch-not-yet-live, and why today's specific run is unaffected either way

This is the task's most load-bearing verification request, and I ran it as a full chain rather than accepting any single link.

### 2a. The server-side TS logic is on `main` and behaves exactly as claimed

`[SOURCE]`, direct read of `web-v2/lib/training/execution-semantics.ts` at `origin/main`:

```ts
export function recoveriesHonestOf(
  recs: readonly {
    prescribedSec?: number | null;
    actualSec?: number | null;
    endedEarlyByChoice?: boolean;
  }[],
): boolean | null {
  const known = recs.filter(
    (r) => r.prescribedSec != null && r.prescribedSec > 0 && r.actualSec != null && r.actualSec > 0
      && r.endedEarlyByChoice !== true,
  );
  if (known.length === 0) return null;
  return known.every(
    (r) => Math.abs(r.actualSec! - r.prescribedSec!) <= r.prescribedSec! * RECOVERY_DURATION_TOLERANCE,
  );
}
```

The function's own header comment, dated WALKBACK-2 (2026-09-09), states the intent precisely: *"a recovery carrying the choice is excluded from the tolerance check entirely — not forced to 'honest' — so it drops out of `known`."* This exactly matches the Rule-11-shaped framing the task brief pre-confirmed, and I verified it by reading the merged code directly rather than accepting the description.

The caller, `web-v2/lib/execution/verdict.ts`, builds `endedEarlyByChoice` from a real input:

```ts
recoveryEndedEarly?: readonly { phaseIndex?: number | null }[] | null;
...
const recoveries = phases...map(p => ({ ..., endedEarlyByChoice: earlyEndPhaseIndices.has(p.index) }));
```

where `earlyEndPhaseIndices` is built from `opts.recoveryEndedEarly ?? []`. So the mechanism is genuinely wired end to end on `main`: if a run's stored `runs.data` carries a `recoveryEndedEarly` array naming a phase index, that phase's recovery is excluded from the tolerance check. **This is a real fix, correctly merged, correctly wired.**

### 2b. Today's specific run (`-218380344929823`) has NO such record, and I checked the raw row myself rather than inferring it

`[PROD-QUERY]`, fresh query this session against `faff_readonly`:

```
select id, fetched_at, data ? 'recoveryEndedEarly' as has_ree,
       jsonb_path_exists(data, '$.**.recoveryEndedEarly') as has_ree_nested,
       jsonb_array_length(data->'phases') as n_phases
from runs where id = -218380344929823;
```

Result: `has_ree = f`, `has_ree_nested = f`, `n_phases = 14`. **The row carries zero `recoveryEndedEarly` data anywhere in its jsonb, top-level or nested.** `fetched_at = 2026-09-09 14:17:04.095398+00`.

### 2c. The timing makes this inevitable, not incidental

The merge commit that brings WALKBACK-2 onto `main`, `e5bcc430b`, is timestamped `2026-09-09 16:25:33 -0700` = `23:25:33 UTC`. Today's run was fetched/stored at `14:17:04 UTC` — **over 9 hours before the merge existed on any branch reachable from `main`.** Even setting aside whether the watch has ever shipped this capture code, the run was recorded before the fix existed in any form on the integration line. Replaying it through current-`main` code cannot produce a different grading outcome than before, because the input the new code branches on is categorically absent from the stored row, not merely zero.

### 2d. Consequence for grading, verified by re-deriving the arithmetic against the merged function, not the pre-merge one

With `earlyEndPhaseIndices` empty (no `recoveryEndedEarly` array to build it from), `endedEarlyByChoice` is `false` for all 6 recoveries on today's run, so all 6 remain inside `known` and are evaluated by the literal tolerance check exactly as before the merge:

| phase idx | prescribed | actual | Δ | tolerance (30s) | pass/fail |
|---|---|---|---|---|---|
| 2 | 60 | 30 | 30 | ≤30 | pass (boundary) |
| 4 | 60 | 43 | 17 | ≤30 | pass |
| 6 | 60 | 61 | 1 | ≤30 | pass |
| 8 | 60 | 24 | 36 | >30 | **FAIL** |
| 10 | 60 | 38 | 22 | ≤30 | pass |
| 12 | 60 | 8 | 52 | >30 | **FAIL** |

`known.every(...)` is `false` (two failures), so `recoveriesHonestOf` still returns `false`, and `sessionLadder`'s sole path to `'executed'` (`recoveriesHonest !== false`) is still blocked. **Today's run is denied the `'executed'` verdict under current `main`, identically to how it was denied under the pre-merge pin.** This is not a hypothesis — I re-derived it from the actual merged predicate against the actual stored row, not carried forward from v1's pre-merge analysis.

### 2e. Which half is live for RUNNER_DAVID, and which requires a build he does not have

**Server (TS) half — the grading function and the API route that serves the Today-tab payload.** This lives under `web-v2/lib` and `web-v2/app/api`, which CLAUDE.md's deployment doctrine states auto-deploys via Railway on push to `main`. The merge landed at 16:25-16:42 -0700 on 2026-09-09. I looked for corroborating evidence that the deploy actually succeeded rather than assuming the doctrine fired automatically (per Rule 19's own lesson — "a passing gate chain is evidence about the checks, not about production"):

- `[SOURCE]` Immediately after the WALKBACK merges, three more commits landed fixing native-check/CI issues (`8b9fb3159`, `2f7c5b90f`, `73dc90cc2`, `aab7d068f`), and their commit messages describe watching a real CI run (`gh run 34419718531`, `gh run 34419718534`) fail and get progressively fixed. The final fix in the chain, `52c5e8dd0`, closes out `_belief_source_pins.test.ts` and `_format_lint.test.ts` failures that the `aab7d068f` message states "were failing outright before this session's first two fixes" — i.e., at some point in this window, tests in the repo's vitest suite were red.
- I checked whether those specific failing tests are wired into Railway's actual `prebuild` gate (`web-v2/package.json`'s `prebuild` script, a chain of ~29 `check-*.sh` shell scripts) or only into the separate `test-full.yml` GitHub Actions workflow. `grep -rl "belief_source_pins" scripts/` returns nothing — these tests are not invoked by any of the `prebuild` shell scripts, and the workflow filenames matching the CI-run pattern in the commit messages (`test-full.yml`) are a distinct GH Actions gate from Railway's own build pipeline.
- **`[BLOCKED: Railway deploy status not independently confirmed]`** — I have no Railway dashboard or API credential in this read-only pass. I can say the code is on `main`, the doctrine says it auto-deploys, and the failing tests I found evidence of do not appear to be wired into the specific script chain Railway's `prebuild` runs — but I cannot see Railway's own deploy log, so I am not asserting the server half is confirmed live. This is exactly the gap Rule 19 exists to name; I am naming it rather than assuming past it.

**Swift/watch half — `WorkoutEngine.swift`'s capture of the `RecoveryEndedEarlyRecord` and its POST to the completion route.** This is unambiguous and I traced it fully:

- `[SOURCE]` The capture code lives at `legacy/native/Faff/FaffWatch Watch App/WorkoutEngine.swift`. I confirmed this is **not** orphaned legacy code — `native-v2/Faff/FaffWatch Watch App` is a real symlink (`lrwx------ ... -> ../../legacy/native/Faff/FaffWatch Watch App`) into that exact directory, so it is a genuine compilation input of the current native-v2 watch target, matching what Domain D's reviewer flagged as a trap for future audits.
- `[SOURCE]` `git log --oneline` for the most recent `chore(ship): TestFlight build NNN` commit finds `b6bf7c314 chore(ship): TestFlight build 290 · PLANSNAPSHOT-SINGLEFLIGHT-1`, dated `2026-09-07 17:22:11 -0700`.
- `[SOURCE]` `git merge-base --is-ancestor e5bcc430b b6bf7c314` → **NO**. The WALKBACK merge is not an ancestor of build 290 — meaning build 290 predates the WALKBACK-2 merge by two days and cannot contain the capture code.
- `[SOURCE]` `git log --oneline e5bcc430b..origin/main | grep -i "ship\|testflight"` → **zero results.** No TestFlight ship commit of any kind exists between the WALKBACK-2 merge and the live tip.

**Conclusion, stated as plainly as the task asked for:** the server-side grading logic that would let a future run with an honest early-end record pass `recoveriesHonestOf` is on `main` (deploy-status caveat above notwithstanding), but **no new TestFlight build has shipped since the merge, so the watch RUNNER_DAVID is actually running still cannot produce a `recoveryEndedEarly` record — the capture code exists in the source tree that would build his watch app, but has not yet been compiled into a build he has installed.** Even once that build ships, it only helps *future* runs: today's run's stored data structurally cannot retroactively gain the field, so it will forever grade as denied-`'executed'` under this exact mechanism unless a separate, explicit backfill/reprocessing decision is made — which is a data-write decision requiring RUNNER_DAVID's explicit approval per this project's own operational boundaries, not something this pass is authorized to recommend performing.

---

## 3. `SHADOW_EVIDENCE_EPOCH` pin mismatch — resolved. I recomputed the hash fresh; the task's framing needs updating.

v1 (Domain C, corroborated 3× including a self-computed SHA-256) reported a live mismatch: pinned digest `79bc095d2f7ceb3b` for `web-v2/lib/race/race-outlook.ts` vs. an actual file hash of `18f75b129d5d3ae8` at the pin commit.

**This has already been fixed on `main`, and I did not take that on faith — I recomputed the digest myself, twice, against two different checkouts:**

```
git show ae91e30668df7e14b1279cb6e4d20db87de5250e:web-v2/lib/race/race-outlook.ts | shasum -a 256 | cut -c1-16
  → 18f75b129d5d3ae8
git show origin/main:web-v2/lib/race/race-outlook.ts | shasum -a 256 | cut -c1-16   (live tip, 80fca013f)
  → 18f75b129d5d3ae8
```

And the pin itself, read directly from `web-v2/lib/adaptation/shadow-evidence-epoch.ts` (note: this file lives under `lib/adaptation/`, not `lib/race/` — worth flagging since v1's own citations were slightly imprecise about the pin file's location):

```ts
{
  file: 'lib/race/race-outlook.ts',
  digest: '18f75b129d5d3ae8',
  why: 'Re-pinned ALONE at epoch 3, branch (b), 2026-09-02 · CEFFORT-1 made race.priority load-bearing...'
}
```

**The pinned value and the recomputed value are now identical: `18f75b129d5d3ae8` = `18f75b129d5d3ae8`.** I traced the responsible commit: `52c5e8dd0 fix(ci): re-pin race-outlook belief digest, fix format-lint rounding, scope native-check schemes`, which is an ancestor of both `ae91e30668df7e14b1279cb6e4d20db87de5250e` and the live tip (it sits directly in the first-parent chain between the two pins, per the `git log --first-parent 8559245..ae91e306` output I captured). Its own commit message explains the mechanism precisely: the drift was caused by an unrelated performance change (`ce2742b28`, single-flighting evidence reads) that did not move any belief a shadow record compares against, so the fix is a re-pin-alone under this file's own documented "branch (b)" rule, not an epoch bump.

**Verdict: FIXED. This is a clean close, not a "changed" or "partial."** The v1 language describing this as "a live, reproducible CI-failure-shaped mismatch" no longer holds and should not survive into any downstream ledger unqualified. I additionally confirmed the test that would have caught this (`web-v2/lib/adaptation/_belief_source_pins.test.ts`, which recomputes `createHash('sha256').update(readFileSync(file)).digest('hex').slice(0,16)` and asserts it equals the pinned value) uses the identical algorithm my `shasum -a 256 | cut -c1-16` check does — so I am not just trusting the file's own narrative comment, I independently verified the actual bytes.

---

## 4. `plan_decision_ledger` / Migration 166 — still absent from production. Fresh query, unchanged from v1.

```sql
select to_regclass('public.plan_decision_ledger') as ledger_table, current_database(), now();
```

Result: `ledger_table` = **NULL**, `current_database` = `railway`, `now()` = `2026-09-10 02:04:23.046438+00`.

**Verdict: UNCHANGED / still unfixed.** The table does not exist in production as of this fresh check, run this session against the live read-only replica, independent of anything v1 queried. Per v1's own framing (and CLAUDE.md's DDL rule), this remains an approval-blocked item — applying Migration 166 requires RUNNER_DAVID's explicit per-statement go, which this read-only pass is not authorized to seek or assume. The 10 live call sites v1 found (`recordDecision`, `recordDecisionInTransaction`, the admin route, `option-lane.ts`, `move-orchestrator.ts`, `mutate.ts`, `workout-proposals.ts`, `runner-state/store/lineage.ts`, and others) are presumably still falling through `TABLE_ABSENT` handling as no-ops — I did not re-derive this call-site list myself in this pass (out of the task's explicit scope, which named this item as a status-check, not a re-audit item), but nothing in the git history between the two pins touches Migration 166 or its call sites, so there is no code-level reason to expect the count changed.

---

## 5. Rule 21 / `coach_intents` — re-queried fresh, identical to v1, still correctly scoped

```sql
select count(*) from coach_intents where user_uuid = '<runner>';                          → 321
select reason, count(*) from coach_intents where user_uuid='<runner>'
  and reason ~* 'up|bump|accelerat|increase|push|progress' group by 1;                     → 0 rows
```

**Unchanged from v1's own fresh recheck (which also found 321, up from an earlier 309).** No new upward-shaped `coach_intents` row has appeared in the ~12 hours between v1's pin and this session. Rule 21's `coach_intents`-scoped claim ("zero upward reasons") continues to hold exactly as v1 stated it, and — per v1's own correctly-scoped conclusion, which I am not revising — this narrow claim was never the part that was wrong; only Domain C Pass-2's *overreach* extending it to "no auto-applied upward change in any table, ever" was wrong, and that overreach was already caught and corrected within v1 itself (Pass-3's `plan_proposals` row-1 finding). I re-confirm the shadow-log row counts are also unchanged:

```sql
select count(*) from adaptation_shadow_log where user_uuid='<runner>';            → 24  (matches v1 exactly)
select count(*) from canonical_adaptation_shadow_log where user_uuid='<runner>';  → 36  (matches v1 exactly)
```

**The "14 PROGRESS outcomes" number remains genuinely unmatched to any mechanism.** No new row exists that could resolve it, and no commit between the two pins touches either shadow-log write path. This should stay `UNKNOWN` in any downstream ledger, not be silently dropped or silently assumed resolved.

---

## 6. Everything else in v1 that this task did not explicitly ask me to re-check

Per the task's own framing ("Do not let any 'unmerged'/'pending' language survive into your output if it is no longer true — say explicitly, for each finding, whether the v1 language still holds"), here is the explicit disposition of every other status-bearing claim in v1's own §11/§12/§13, checked against whether the specific commits between the two pins could plausibly have touched it. I did not re-run these DB queries fresh (out of the task's named scope, which called out WALKBACK, SHADOW_EVIDENCE_EPOCH, plan_decision_ledger, and "any other unmerged branch v1 named" as the specific re-verification targets) — historical `runs`/`plan_proposals`/`plan_mutations` rows do not retroactively change unless a write occurs, and I confirmed no write-shaped commit touching those tables exists in the `8559245..ae91e306` range (the only DB-adjacent commits in that range are the CI/native-check fixes already discussed, none of which are migrations or backfills):

- **The `pausedSec`/`droppedGapSec` false-invariant finding (P1, Domain A reviewer's central contradiction)** — no commit in the delta range touches `postrun/experience.ts` or `postrun/load.ts`. `[SOURCE]` confirmed by `git log --oneline 8559245..ae91e306 -- web-v2/lib/postrun/` → empty. **Still open, unfixed, v1's language holds.**
- **The five non-matching adaptation-decision vocabularies (P1, Rule 16 violation)** — no commit in range touches `adaptation-model.ts`, `dose-responsive.ts`, or the shadow-log DB constraints. **Still open, unfixed.**
- **`RUNNER_AUTHORITY_TIERS` duplicated across `vdot-inputs.ts`/`durability-anchor.ts` (P4)** — I did check this one directly since it was a one-line grep: `grep -c "RUNNER_AUTHORITY_TIERS" lib/training/vdot-inputs.ts lib/training/durability-anchor.ts` on current main returns 2 hits in each file, same as v1. **Still open, unfixed, v1's language holds.**
- **The HR flatline guard not reaching LTHR/max-HR/readiness (P0)** — no commit in range touches `hr-trace-credibility.ts` or its four named non-consuming files. **Still open, unfixed.**
- **The §9 dispute — whether today's Today-tab actually renders the pace-less `workoutPhasePieces` fallback for sub-mile phases, or correctly renders `sectionPieces`** — I checked whether any commit in the delta range touches the specific files this dispute turns on: `git log --oneline 8559245..ae91e306 -- web-v2/app/api/v5/today/route.ts native-v2/Faff/Faff/ViewsV5/TodayAfterV5.swift` returns exactly the WALKBACK-1/WALKBACK-2 commits (`522714789`, `7c916a1f7`) — which I confirmed by diff are byte-identical in content to `7b0163c85`/`e80524809` except for the unrelated pbxproj fixup. **No commit in the delta range independently resolves the §9 dispute.** It remains exactly as unresolved as v1 left it: two `[SOURCE]`-traced accounts disagree, and this reconciliation pass — like all eight v1 sessions before it — did not render the app. I am not manufacturing a render I did not do; this stays `[BLOCKED: no simulator/device render performed]`, unchanged.
- **The 2026-06-02 automatic upward volume-drift rebuild invisible to `coach_intents` (P0)** — this is a historical `plan_proposals` row; nothing retroactively changes it, and no migration/backfill commit exists in range. **Still an open finding about the audit trail's completeness, unchanged.**
- **`recommendation.ts`'s orphaned `STAY/PROGRESS/MODIFY/PROTECT` machine (P2)** — no commit in range touches `recommendation.ts` or adds a client caller of `/api/coach/read`. I ran a broad grep for confirmation and found the substring-noise expected from an unscoped search (route paths, type names) rather than genuine new call sites; nothing indicates this was wired up. **Still open, unfixed.**
- **Races enumeration / Rose Bowl Half PR-screen completeness (P1 candidate)** — this needs a render/UI check v1 never performed and this pass was not asked to perform. **Still `[BLOCKED: not checked]`, unchanged.**
- **Proposal-13 bundled reprice card correctness (P1 candidate)** — same, still `[BLOCKED: not checked]`.
- **`plan_workouts` unscoped-join population hazard (P2)** — structural, not a merge question; no commit in range touches the join sites v1 named. **Still open.**

---

## 7. Summary disposition table (the compact version of everything above)

| Finding | v1 language | Still true? | This pass's verdict |
|---|---|---|---|
| WALKBACK-1 unmerged | "REVIEWED — MERGE PENDING" | **NO — stale, do not carry forward** | Merged (`1a26aae87`); server auto-deploy caveat only |
| WALKBACK-2 unmerged | "REVIEWED — MERGE PENDING" | **NO — stale, do not carry forward** | Merged (`e5bcc430b`); **server merged, watch capture code NOT yet in any shipped TestFlight build**; today's run structurally unaffected either way |
| SHADOW_EVIDENCE_EPOCH pin mismatch | "live, reproducible CI-failure-shaped mismatch" | **NO — stale, do not carry forward** | Fixed (`52c5e8dd0`), independently re-recomputed to confirm |
| `plan_decision_ledger` table absent | "table does not exist in production" | **YES — still true** | Confirmed via fresh query |
| `coach_intents` zero-upward (Rule 21, narrow scope) | "zero upward, 321 rows" | **YES — still true, unchanged row count** | Confirmed via fresh query |
| "14 PROGRESS outcomes" unmatched | "genuinely open" | **YES — still true, no new evidence either way** | Confirmed shadow-log counts unchanged |
| `38b33f0f5`, `49be10229` unmerged | (not a v1 claim at all) | N/A | Confirmed unmerged; explicitly out of v1's own scope |
| §9 `sectionPieces`/`workoutPhasePieces` dispute | "unresolved, needs a render" | **YES — still true** | No commit in the delta range touches this; still unresolved |
| Everything else in §6 above | various "open"/"unfixed" | **YES for all of them** | Confirmed no code in the delta range touches any of them |

**The one piece of v1 language that must not survive into any downstream ledger unqualified is "WALKBACK-1/2... REVIEWED — MERGE PENDING."** Both are merged. But the correct replacement is not simply "fixed" — it is the split stated in full in §2e: merged to `main` (with an honest, named gap in confirming the Railway deploy itself), and, for the watch-side capture code specifically, **confirmed absent from every TestFlight build RUNNER_DAVID has ever received**, because no ship commit exists anywhere between the merge and the live tip of `main`.