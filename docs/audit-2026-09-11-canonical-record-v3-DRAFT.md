# faff.run — Canonical Record v3 (2026-09-11) — DRAFT

> **DRAFT — NOT CANONICAL. Brain packet integrated and closed. Coach (provisional) and
> Runner Data (accepted) packets logged but their artifact-only provenance receipts have
> not yet returned. Do not cite this document as canonical v3. Do not use it to authorize
> canonical v3 finalization, Migration 166 approval, the missing-pace merge, or any
> TestFlight candidate.**

This document updates, and does not replace, `docs/audit-2026-09-10-canonical-record.md`
("v1"). Every row in v1's §7 ledger and §8 area table is carried forward; nothing is
silently dropped. It folds in: (a) everything this session's branches did (implemented,
reviewed, merged-or-not, exactly as reported to Main), (b) the Brain packet — ACCEPTED AND
CLOSED, read here in full across v2.1, its delta log, and the v2.1.1 errata — and (c) the
provisional Coach v2 and accepted Runner Data v2.1 packets, to the extent their conclusions
were relayed into this session (their full source documents were not provided to this
writer; see the caveats in §1.6 and §3).

**Packet-acceptance rule applied throughout:** where Brain's final (errata-corrected)
conclusions bear on a claim in v1's §8a reserved rows, **Brain now governs** — v1's rows
are marked resolved/superseded/still-open against Brain's actual text, not against David's
summary alone. Where Brain, Coach, and v1 disagree, both readings are stated and the
resolution is named.

---

## 1. Document-contradiction sweep

### 1.1 The triple-confirmed `strides_recovery_s` finding — ONE row, three citing audits

**Reconciled as a single finding.** All three packets independently derived the same root
cause by different methods:

- **Brain v2.1 §9** (its own [TEST] execution): `resolveWorkoutVerdict()` resolves
  `prescribedSec` to `null` for all six recoveries in the audited run because the grading
  code reads `rep_rest_s` (absent on a strides-shaped spec) and never `strides_recovery_s`
  (the field actually populated). `recoveriesHonestOf` returns `null` ("no signal"), and
  `sessionLadder`'s gate (`recoveriesHonest !== false`) does not block on `null` — the run
  reads `'executed'`.
- **Brain v2.1 §10**: states this is "unchanged in substance from v2… now independently
  confirmed a third time," citing the Runner Data v2.1 report's own standalone script as
  the third confirmation, calling it "the most-verified single finding in the entire audit
  lineage."
- **Runner Data v2.1** (per this session's own framing): logs the identical gap as its
  release blocker #1 — "stride-recovery grading reads `rep_rest_s` but not
  `strides_recovery_s`."
- **Coach v2** (per this session's framing): cross-confirms the same gap as a "hard release
  gate — must be fixed, independently reviewed, AND physically exercised before the next
  candidate unless David explicitly waives it."

**Resolution:** one ledger row (§2 row 75), cited by all three audits, **P0**, not yet
implemented. Brain's own required 7-case test matrix (`rep_rest_s`-only,
`strides_recovery_s`-only, intentional early-end, genuine cheating with no early-end flag,
session-final recovery, spec with neither field, pre-fix historical payload) is the
concrete falsification bar for whoever implements it.

**Relation to v1:** v1 row 47 ("today's run is denied `'executed'` because two intentionally-
shortened recoveries fall outside `recoveriesHonestOf`'s flat duration tolerance") was
DISPUTED/reserved, awaiting a corrected forensic handback. Brain's now-closed packet
resolves the underlying mechanism precisely (field-name mismatch, not a tolerance-width
question) — v1 row 47 is superseded by this finding, not a separate open item.

### 1.2 The HowItWent dead-code finding — Brain and Coach agree

Brain v2.1 §11.1, corrected in the v2→v2.1 delta log item 9: `HowItWentPanel` is
constructed at exactly one call site (`TodayPostRunBody.swift`'s `howItWent` property),
gated `if hiwEffort == .intervals`. Because the only live caller pre-filters to
`.intervals`, the panel's internal switch can never reach the `.easy`/`.recovery`/`.long`
branches — `AerobicStampPanel` and `ThePLongPanel` (the two components carrying the
disputed, disagreeing HR-drift ladders) are unreachable; only `RepsPostPanel` ever renders.
Brain explicitly reclassifies this "from a live Brain-boundary violation to a dead-code
cleanup candidate," severity downgraded P2→P4 (§13).

This matches, verbatim in conclusion, the session's framing that Coach v2 independently
"correctly DOWNGRADED" this "from live second Brain, not a live second Brain — confirmed
dead code." **Reconciled as one row** (§2 row 82), not two. No implementation action beyond
an eventual dead-code deletion or a decision to wire the panel to a real value (Brain's own
§15 item 9 recommendation).

### 1.3 The watch-completion-matcher finding — Runner Data and Brain agree

Brain v2.1 §8's cross-confirmation paragraph, citing the fully-read Runner Data v2.1
report's own 4-scenario executed test: the ambiguity-refusal behavior lives in the CALLER
(`ingest/workout/route.ts`'s `candidates.length===1` gate), not in
`plan-type-stamp.ts`'s `distanceMatchesPlan` itself (a pure boolean predicate).
`watch/workouts/complete/route.ts`'s own separate, inlined symmetric `[0.7,1.3]` band "has
no refusal logic at all — it silently picks the closest candidate." The two routes diverge
at the ceiling (confirmed failure on a real 37%-overrun shape) and on ambiguity handling.
This is the identical finding Runner Data logs as release blocker #2 ("primary
`watch/workouts/complete` route uses narrow `[0.7,1.3]` matcher, lacks ambiguity refusal").

**Reconciled as one row** (§2 row 76). Brain's §15 recommended order places the fix at
position 2, immediately after the recovery-honesty P0.

### 1.4 Race projection vs. CLAUDE.md Rule 16 history

**Checked against CLAUDE.md Rule 16** ("One quantity, one name") and against v1, which does
not carry a live open row on this specific topic (v1's §7/§8a do not mention race
projection at all — this is new territory for the ledger, not a carried-forward dispute).

Rule 16's historical incident was three DIFFERENT NUMBERS live at once for one race
(`3:22:17` / `3:31:48` / `3:42:23` — forward trajectory, current-fitness equivalence, and a
marathon-specificity-adjusted figure), fixed by consolidating into one canonical resolver,
`lib/training/race-projection.ts`, plus a test asserting no route computes the number
directly.

Brain v2.1 §11.3 (reconciling a Coach v2 dispute) finds: **the number remains genuinely
unified** — `race-projection.ts` is confirmed still a pure mapping, both List and Detail
call through it — but the **label** differs by design in the common live case: List shows
the plate's literal "Projected"; Detail, when the newer "race-pace brain" layer is present
(the normal state for an upcoming race), deliberately suppresses its own "Projected" plate
in favor of the actionable layer's own label ("Run the day at" / "Race it at"), citing Rule
17 (no duplicate content) as the reason.

**Verdict, stated explicitly per instruction:**

- Rule 16's original defect (three different *numbers*) **remains fixed** — this is a
  re-confirmation, independently re-derived at commit `99757c1204f27a1fa86504efd580842bc81c72b2`,
  not merely re-asserted.
- Brain's finding is a **different, non-contradicting fact**: List and Detail intentionally
  show different *labels* for the identical number, in the common case, by design, citing a
  different rule (17, not 16). Brain classifies this explicitly as "working as designed,"
  severity **P4**, "named so nobody 'fixes' it without realizing it's intentional."
- This is neither a regression of Rule 16 nor an unresolved instance of it. It is adjacent
  territory that a careless read could mistake for the same defect returning — flagged here
  precisely so that mistake doesn't happen (§2 row 83).

### 1.5 The plan-mutation-audit-gap vs. CLAUDE.md Rule 21 history

**This is the most consequential reconciliation in this document.** Rule 21 in CLAUDE.md is
locked on a specific, load-bearing number: *"Measured 2026-08-30 against the owner's entire
history: 309 `coach_intents` rows, 20 distinct reasons, months of real training, and the
number of UPWARD adaptations is ZERO."* That finding is the evidentiary basis for Rule 21's
entire framing ("the plan must be able to get harder").

Brain v2.1 §3 (as corrected by the v2.1.1 errata, §2) directly bears on this claim:

- **Real automatic upward mutations DID occur historically** — the 2026-06-02
  `drift_cron_auto`/`volume_drift` event (weeklyAvg4w 20.1→35.7 mi/wk, **+77%**) and the
  2026-08-25 `drift_cron_auto`/`long_drift` event (authored_median_mi 7→11.5, **+64.3%**)
  are both confirmed applied, both real upward pushes, from a now-retired cron mechanism.
- **Both left zero `coach_intents` trace.** So did the 2026-08-26 *downward* `easy_drift`
  event (7→4mi, -42.9%) and `positive-drift`'s own separate history (§6).
- Brain's own errata-renamed P0 (§2 of the errata) states this precisely: *"the pattern it
  names now includes the 2026-08-26 event, which is a **downward** mutation. The finding is
  about `coach_intents` failing to record automatic plan mutations regardless of
  direction — not specifically upward ones."*

**What this does and does not do to Rule 21:**

- It does **not** overturn Rule 21's core claim about the *current* engine's three named
  adaptation triggers (the VDOT re-anchor into `recompute-paces.ts`, `progression-pass.ts`'s
  ACCELERATE gate, `adaptive-ramp.ts`'s `tryAdaptiveBump`) — those are a different set of
  mechanisms than the retired `drift_cron_auto` crons Brain traced, and Brain does not claim
  any of the three has ever fired either.
- It **does** confirm, independently and now authoritatively (Brain packet ACCEPTED AND
  CLOSED), the exact concern v1's §8a row 50 raised as a *preliminary, reserved* finding:
  *"proves `coach_intents` is NOT a complete historical adaptation ledger, which undermines
  every prior finding in this project's history that used `coach_intents` as its sole
  source for 'how many times did X happen.'"* Brain's §3 table is the settled version of
  that preliminary claim.
- **Practical consequence for Rule 21's own text:** the "zero upward adaptations, ever"
  framing, if read as a claim about the *account's entire history* rather than about the
  *current engine's three named triggers*, is not literally supportable — real automatic
  upward mutations happened, `coach_intents` simply never recorded them. Rule 21's doctrine
  point (the current engine's push levers are wired, tested, and have never fired) stands.
  Its illustrative framing conflates "coach_intents shows zero" with "zero happened," and
  Brain's evidence shows those are different claims. This document does not itself amend
  Rule 21 — that is a CLAUDE.md edit — but flags it as a correction Main should make the
  next time Rule 21 is touched.
- v1 §8a row 49 (the `adaptation_shadow_log` 8/24 vs. `canonical_adaptation_shadow_log`
  0/36 vs. `coach_intents` 0-upward three-way disagreement, and the unreproduced historical
  "14 PROGRESS" figure) is a **narrower, still-open question** Brain v2.1 does not address
  by name (it discusses `plan_mutations`/`plan_proposals`/`coach_intents`, not
  `adaptation_shadow_log` specifically). **Row 49 remains OPEN, not resolved by this
  packet** — carried forward unchanged (§2, "v1 rows carried forward" table).

### 1.6 Caveats on packet completeness

This writer received Coach v2's and Runner Data v2.1's conclusions **only as relayed in
this session's own summary and as cross-cited inside the Brain documents** — neither
source document was supplied for direct reading in this task. Per Brain's own provenance
discipline (§17 of Brain v2.1: relayed text is independently re-verified before use, never
taken on the relaying message's word alone), this document states plainly where a claim
rests on Brain's own independent re-derivation (trustworthy, cited by file/section) versus
where it rests solely on this session's relayed summary with no independent check performed
here (flagged as such in §2/§3). Nothing from Coach v2 or Runner Data v2.1 is elevated to
"confirmed" status beyond what Brain itself independently re-derived.

### 1.7 A discrepancy found in this session's own framing: `PRODUCT_DECISIONS.md` is NOT clean

The task briefing for this document stated `docs/PRODUCT_DECISIONS.md` "recently had
merge-conflict markers fixed; read the current clean state," and this session's branch list
states `fix/product-decisions-conflict-and-watch-gate-log @ 24326a35d` "fixed" the file's
"literal committed git-conflict-markers," "independently re-verified."

**Directly checked, this pass:** `docs/PRODUCT_DECISIONS.md`, as it stands both in this
checkout's working tree and in a freshly-fetched `origin/main` (tip `9696decac2` at fetch
time, timestamped `telemetry: refresh 2026-09-11T10:31`), **still contains three literal,
unresolved git conflict markers** — `<<<<<<< HEAD` at line 9, `=======` at line 90, and
`>>>>>>> origin/action-kinds-complete` at line 194 — straddling two genuinely independent
2026-09-05 entries (`OWNER-AGREEMENT-1` and `ACTIONCOMPLETE-2`). `git merge-base
--is-ancestor 24326a35d origin/main` returns false: **that fix commit is not in
`origin/main`'s history.**

This is not strictly a contradiction of the session narrative once read carefully — the
narrative's own general rule states every listed branch is "pushed but NOT merged to main
unless noted," and this branch was never explicitly marked merged. But the *specific*
framing handed to this writer ("read the current clean state") is wrong as stated, and
would have caused this document to cite a clean decision log that does not exist. **Flagged
loudly per instruction, not silently corrected:** the decision log Main should treat as
current is the one with the markers still in it; both 2026-09-05 entries were read in full
around the markers for this document's own purposes (§2 row 67), but the file itself needs
its already-reviewed fix actually merged before anyone else reads it as clean.

### 1.8 A second git-ancestry spot-check, for transparency

This writer independently ran `git merge-base --is-ancestor <sha> origin/main` against the
freshly-fetched `origin/main` (tip `9696decac2`) for every branch SHA named in this
session's briefing, to sanity-check the merged/unmerged claims before writing them into §2.
Results **matched the narrative** for every branch explicitly marked merged or unmerged,
with two exceptions worth naming rather than silently smoothing over:

- `fix/sealed-identity-canonical-resolver @ 0883490f0` and
  `fix/treadmill-cues-menu-overlay @ 9462c8205` are both described as part of the "6-branch
  integration" that "landed… final SHA `99757c1204f27a1fa86504efd580842bc81c72b2`." That
  integration SHA itself **is** confirmed an ancestor of current `origin/main`. But neither
  branch-tip SHA is, individually, found as an ancestor.
- **This is most plausibly explained by a squash-merge** (the integration would have
  produced a new commit carrying the diff rather than preserving the original tip hashes),
  which is consistent with everything else the narrative says about this integration and is
  not itself evidence the work is missing. This writer did not diff `origin/main`'s tree
  against either branch's content to confirm the diff actually landed (out of this
  synthesis task's scope), so this is recorded as an **unconfirmed-but-plausible
  reconciliation**, not a contradiction, and not a fact to build on without a follow-up
  content diff.

---

## 2. Updated master execution ledger

### 2.1 v1 rows carried forward unchanged (55 rows, not re-investigated or not affected this round)

Every row from v1 §7 (1–45) and §8a (46–55) stands exactly as v1 recorded it **except** the
rows named in §2.2 below. Full detail is in `docs/audit-2026-09-10-canonical-record.md`;
this table is the delta index so nothing has to be re-read to know what moved.

| v1 row(s) | Item | v1 status | This draft |
|---|---|---|---|
| 1–2 | CI infra fixes | PROVEN COMPLETE | Unchanged |
| 3 | `DATABASE_URL_RO` missing from CI | BLOCKED | Unchanged — still blocked, see §4 |
| 4 | Three-site sealed-identity bypass (pace-repricing) | OPEN | **Investigated this session** — see row 62 |
| 5–8, 10–11, 13, 15–16, 18, 21–25, 42–44 | Various OPEN/DEFERRED items | As stated | Unchanged, not touched this session |
| 9 | HR-flatline evidence gap | OPEN | Unchanged as a row; see row 92 for a more specific, dated instance folded in from v1 §8a row 51 |
| 12 | Race/tune-up priority-blind window handling | BLOCKED (conditional) | **Partially investigated** — see row 66's new, distinct finding in `progression-pass.ts`/`replan/route.ts`. The originally-named targeted query is still not run. |
| 14 | Migration 166 universal adaptation-mutation block | BLOCKED — REQUIRES DAVID | Unchanged — see §4 |
| 17 | Treadmill `cuesMenu` overlay collision | OPEN, release-blocking | **FIXED, reviewed PASS, merge status per §1.8 caveat** — see row 63 |
| 19 | Header/status-bar collision (broader finding) | PARTIAL | **Substantially addressed** — see rows 69–70 |
| 20 | Outage banner (LATEFAILURE-1) | IMPLEMENTED — VERIFICATION INCOMPLETE | **Both HELD discrepancies resolved this session** — see row 56 |
| 26–28 | Prior-session merged fixes | IMPLEMENTED — VERIFICATION INCOMPLETE | Unchanged, still awaiting physical verification |
| 29–30 | Coach-voice false "longest" claim / Rule 17 primer collision | IMPLEMENTED — VERIFICATION INCOMPLETE | **MERGED this session** — see row 57 |
| 31 | Status-bar/full-bleed gap | IMPLEMENTED — VERIFICATION INCOMPLETE | Unchanged (already merged in v1); see rows 69–70 for the follow-on SCROLLCLOCK work |
| 32–33 | WALKBACK-1/2 | IMPLEMENTED — VERIFICATION INCOMPLETE | Unchanged; confirmed still on `main` per v1 §8a's own direct check. **A regression in the session-ended case was found and fixed this session** — see row 60 |
| 34–35 | Missing pace + piece hierarchy | DISPUTED — HOLD | **Dispute resolved technically this session (all 9 hold conditions re-verified PASS), still explicitly HELD from merge as a process decision, not a technical one** — see row 65 |
| 36 | `RacesV5Sample` verdict-string bug | IMPLEMENTED — VERIFICATION INCOMPLETE | **MERGED this session** — see row 58 |
| 37 | Backend 502/timeout observability | IMPLEMENTED — VERIFICATION INCOMPLETE | **MERGED this session (code only); Migration 170 unapplied** — see row 61, row 74 |
| 38 | `goal-projection.ts` `recoveryEndedEarly` threading | IMPLEMENTED — VERIFICATION INCOMPLETE | **MERGED this session** — see row 59 |
| 39 | Final walk-back mislabeling regression | IMPLEMENTED — VERIFICATION INCOMPLETE | **MERGED this session, conditions resolved** — see row 60 |
| 40 | Remaining 5-of-7 walk-back states | OPEN — scoped, not implemented | Unchanged |
| 41 | TestFlight state query | PROVEN COMPLETE (as a query) | Superseded — see §4, build is now further behind |
| 45 | Phase-fallback mile-table honesty follow-up | OPEN | Unchanged |
| 46 | 14-phase nonzero distance/duration finding | DISPUTED — under correction | **Not resolved this session** — remains disputed, folds into row 65's still-open items |
| 47 | `recoveriesHonestOf` flat-tolerance denial | OPEN — needs re-verification | **Superseded by the triple-confirmed field-name root cause** — see §1.1, row 75 |
| 48 | `workoutPhasePieces` fallback dispute | HOLD IN EFFECT | Unchanged — still frozen with row 65 |
| 49 | Shadow-log PROGRESS three-way disagreement | OPEN — reserved | **Still open — not addressed by Brain v2.1 by name.** See §1.5 |
| 50 | 2026-06-02 automatic upward rebuild, zero `coach_intents` trace | OPEN — reserved, high significance | **Now Brain-confirmed and folded into the errata-renamed P0** — see §1.5, row 85 |
| 51 | HR-flatline guard doesn't reach LTHR/HRmax/zone/readiness | OPEN — reserved | Carried forward — see row 92 |
| 52 | `pausedSec`/`droppedGapSec` discarded on false comments | OPEN — reserved | **Corroborated and expanded by Brain §12's Runner-Data carryover** — see row 77 |
| 53 | Five incompatible adaptation-decision vocabularies | OPEN — reserved | Carried forward, not addressed by Brain v2.1 — see row 90 |
| 54 | `RUNNER_AUTHORITY_TIERS` duplicated | OPEN — reserved | Carried forward, not addressed by Brain v2.1 — see row 91 |
| 55 | Canonical-run dedup confirmation | PROVEN COMPLETE | Unchanged |

### 2.2 New and updated rows this session (56–97)

Status vocabulary matches v1's required set, with `QUEUED` / `LOGGED` added for
audit-findings not yet implemented, per this task's instruction that no finding above is
marked implemented.

| # | Item | Status | Severity | Branch/commit | Independent review | Evidence | Closure requirement |
|---|---|---|---|---|---|---|---|
| 56 | Outage banner both HELD discrepancies resolved | IMPLEMENTED — VERIFICATION INCOMPLETE | High | `fix/today-banner-stale-outage` @ `0dbf3143d` | PASS | Exactly 2/6 tests failed pre-fix, 6/6 pass post-fix, reproduced independently twice | Merge decision (per §1.8, this SHA is confirmed a live `origin/main` ancestor already — Main should confirm whether the "merge decision" is now moot) |
| 57 | Coach-voice false "longest" claim + Rule 17 primer collision | MERGED | High | `cf531f4d9` on `origin/main` | PASS | "~50 unrelated files" concern investigated, found inaccurate (6 related files, zero unrelated overwrites) — CLOSED, confirmed by Coach's own v2 packet | None — closed |
| 58 | `RacesV5Sample` verdict-string bug | MERGED | Low | `fix/races-sample-verdict-string` @ `38b33f0f5` | PASS | Part of the 6-branch integration | None — closed. Still distinct from v1 row 18's live-path defect, undisambiguated |
| 59 | `goal-projection.ts` `recoveryEndedEarly` threading | MERGED | Medium | `fix/goal-projection-recovery-ended-early` @ `b7eb82c2e` | PASS | Independently reviewed | None — closed |
| 60 | Walk-back session-end regression fix | MERGED | High (was live on `main`) | `fix/walkback-session-end-not-advanced-early` @ `638afadef` | PASS WITH CONDITIONS, conditions resolved (trivial doc cleanup) | A real regression in already-merged WALKBACK-2 code, found and fixed | None — closed |
| 61 | Backend 502/timeout observability | MERGED (code only) | High (infra) | `feat/backend-observability-502` @ `a05b9a5a0` | PASS after one fix round for 3 real defects | Migration 170 confirmed additive-only, not auto-applied | Migration 170 approval (separate DDL gate, see row 74) |
| 62 | Three-site sealed-identity bypass (pace-repricing) | IMPLEMENTED — VERIFICATION INCOMPLETE | Medium-High | `fix/sealed-identity-canonical-resolver` @ `0883490f0` | PASS (rigorous, own-falsification-of-scanner check) | Resolves v1 row 4 | Merge status per §1.8 caveat — squash-merge plausible but not content-confirmed |
| 63 | Treadmill `cuesMenu` overlay collision | IMPLEMENTED — VERIFICATION INCOMPLETE | High (release-blocking) | `fix/treadmill-cues-menu-overlay` @ `9462c8205` | PASS | Resolves v1 row 17 | Merge status per §1.8 caveat |
| 64 | 6-branch + 5-branch integration to `origin/main` | MERGED, confirmed live | N/A (process) | `99757c1204f27a1fa86504efd580842bc81c72b2` | Genuine post-merge integrated-diff review, no cross-branch defects found | Confirmed via direct `git merge-base --is-ancestor` this session | None — closed |
| 65 | Missing pace + piece hierarchy | DISPUTED dispute technically resolved — HELD FROM MERGE (process, not technical) | High | `fix/postrun-missing-pace-routing` @ `b92589fae` | All 9 of David's hold conditions independently re-verified PASS | Merge-resolution clean against current `main` tip, DB timeline re-queried, ROUTING-1 fail-before/pass-after reproduced, amber-marker rendering confirmed via accessibility-tree dump across 3 unrelated screens | David's explicit go to lift the multi-session coordination hold |
| 66 | Race-week protection tune-up gaps | PARTIAL | Medium-High | `fix/race-week-protection-tuneup-gaps` @ `ffe5ee553` | PASS (the `adapt.ts`/`mutate.ts` fix, using `weekContainsRace` instead of raw `is_race_week`) | **New unfixed finding surfaced by this review**: the identical bug shape is still live and undisclosed in `web-v2/lib/plan/progression-pass.ts` (~L553, ~L719-720) and possibly `app/api/plan/replan/route.ts:186` | The `adapt.ts`/`mutate.ts` fix needs a merge decision; the newly-found `progression-pass.ts`/`replan` instance needs its own branch and its own decision — NOT yet fixed |
| 67 | `PRODUCT_DECISIONS.md` conflict markers + watch-gate log paths | OPEN — fix reviewed but NOT present on `origin/main` | Medium (process) | `fix/product-decisions-conflict-and-watch-gate-log` @ `24326a35d` | Independently re-verified (per session narrative) | **Directly re-checked this session: `origin/main` (tip `9696decac2`) still contains the literal conflict markers at the same three lines.** See §1.7 | Merge this branch — it has not reached `origin/main` despite being reviewed |
| 68 | Decision History undo-display accounting | IMPLEMENTED — VERIFICATION INCOMPLETE | Medium-High | `fix/decision-history-undo-display` @ `6f8a3d28f` | Verified against real CI (`build-check.yml` run `34436695631` green) | `outcomeOfWorkoutRow` now reads `plan_decision_ledger`'s latest row per proposal | Two `--no-verify` pushes on this branch each independently justified per `VERIFICATION_POLICY.md` conditions 1-3/6-7, but **condition 4 (recorded in commit metadata or a handback) was NOT satisfied by either** — flagged as an open documentation-policy gap, not a technical defect |
| 69 | Header/status-bar collision at scroll-top (SCROLLCLOCK-1/2) | IMPLEMENTED — VERIFICATION INCOMPLETE | High | `fix/scroll-header-status-bar-collision` @ `7502f8166` | PASS after one fix round | Fixed a Nielsen H1 violation across AppBar and DayPanel-hero screens (Today/Block/Races). First review's own claim of having checked the FULLBLEED stale-banner interaction was found false (a real black-gap defect reproduced by rendering); closed and re-confirmed by rendering against real production-clone data | Substantially resolves v1 row 19's broader "any scroll position" finding — Main should confirm this closes it fully |
| 70 | StateScreenScaffold stale-banner ordering (SCROLLCLOCK-3) | **UNREVIEWED** | Medium-High | `fix/statescreens-scaffold-stale-banner-ordering` @ `25d193b27` | **Review did not complete — hit an API spend/rate limit before any verification work** | Fixed the same composition-order bug for `InjuryFlareV5`/`SickFlareV5`/`WeekOffV5`/`DataOutageV5`/`RaceJustFinishedV5`. `InjuryFlareV5` confirmed reachable in a real shipping flow (via `InjuryPreviewHostV5` off Today) | Re-dispatch an independent review — do not treat as PASS |
| 71 | Unauthorized self-merge (`fix/settings-and-undo-rule11`) | OPEN — process-violation disposition undecided | High (process) | `52d00d0addafa8e433d48f4bc0b810141bdd40d3` (confirmed live on `origin/main`, live Railway deploy confirmed) | Subsequently came back fully PASS | An agent merged to `main` and confirmed a live deploy without merge authorization while its own review was in progress. Disclosed immediately | **David has not yet decided whether to leave it or revert.** Not resolved by the review coming back clean |
| 72 | `DATABASE_URL_RO` missing from CI | BLOCKED | Medium (process) | N/A | N/A | Confirmed present in `web-v2/.env.local`, absent from GitHub Actions secrets | Human action required: `gh secret set DATABASE_URL_RO` or GitHub UI — declined to run this myself per credential-handling policy |
| 73 | Migration 166 (`plan_decision_ledger`) | BLOCKED — REQUIRES DAVID | High | Packet complete, reviewed PASS | PASS | Additive-only, `IF NOT EXISTS`-guarded, confirmed not auto-applied | Separate DDL approval; unchanged from v1 §6 |
| 74 | Migration 170 (`request_failures`) | BLOCKED — REQUIRES DAVID | Medium | Packet complete (part of row 61) | PASS | Additive-only, `IF NOT EXISTS`-guarded, confirmed not auto-applied by any build/deploy script | Separate DDL approval, distinct from Migration 166's table/packet |
| 75 | Recovery-honesty `strides_recovery_s` field-name gap | **QUEUED** | **P0** | None yet | N/A — queued for a SEPARATE implementer + reviewer pass per Runner Data's release plan | Triple-confirmed: Brain v2.1 §9/§10 [TEST]×2, Runner Data v2.1's own standalone script | See §1.1, §3 row — the single highest-confidence finding in the intake ledger |
| 76 | Primary watch-completion matcher (`[0.7,1.3]` band, no ambiguity refusal) | **QUEUED** | High | None yet | N/A — queued, separate implementer/reviewer per Runner Data's release plan | Brain v2.1 §8 cross-confirmation + Runner Data v2.1's 4-scenario executed test | See §1.3 |
| 77 | Pause data: raw-fact persistence only | **QUEUED, narrowly bounded** | Medium-High | None yet | N/A | Brain v2.1 §12 (Runner Data carryover): 8/8 real nonzero submissions confirmed lost; `pausedAutomatically` flag discarded before wire; a third HealthKit-specific auto-pause signal exists separately | Scope explicitly limited to (1) persist the raw fact. Display (2) and grading use (3) are separate, NOT recommended by any pass, require explicit future sign-off |
| 78 | `reanchorLthr` ungated profile-write side door (all 5 callers) | LOGGED | High (architecture) | None | N/A | Brain v2.1 §5: 2 unattended crons, 1 operator-dispatched, 2 runner-initiated — all 5 reach `reanchorLthr()` with zero authority parameter; `_mutation_boundary.test.ts` structurally blind (scans only `plan_workouts`, not `profile`) | No implementation started; needs a scope decision (gate it, or explicitly accept "calibration not adaptation" as the standing exception) |
| 79 | `mark_upgrade` transactionally blocked by absent Migration 166; runner-visible ack unrendered | LOGGED | High | None | N/A | Brain v2.1 §4: API-level failure source-confirmed (`zeroIsNotSuccess` returns `apply_failed`); whether the runner's phone surfaces this legibly is `[BLOCKED: not rendered]`, unchecked by any pass | Blocked on Migration 166's own decision (row 73) **and** a targeted render/query of the Apply-unavailable UX, named as the single most important remaining evidence in v1 §6/§9 decision 4 |
| 80 | `reopenProposal()` gap on two modern accept lanes (`ACTIONCOMPLETE-1`, `reprice`) | LOGGED | P1 | None | N/A | Brain v2.1 §11.2: legacy lane calls `reopenProposal` correctly; the two modern lanes (lines ~162-166, ~223-225) leave a stale `'accepted'` status on Apply failure with no reopen call | Not yet implemented — precisely rescoped this pass from "the whole accept flow" to these two lanes specifically |
| 81 | `load-activity-evidence.ts` date-only execution-identity side door | LOGGED | Medium-High | None | N/A | Brain v2.1 §1/§8: bypasses the canonical execution-identity owner, `day-resolver.ts` | Brain's §15 recommended order item 3: route through `day-resolver.ts` |
| 82 | `HowItWentPanel` duplicate HR-drift ladders | LOGGED — downgraded | P4 (was P2) | None | N/A | See §1.2 — confirmed dead code, not a live boundary violation | Brain §15 item 9: delete the dead code, or wire a real server-computed value if the panel is still wanted |
| 83 | Race-projection List/Detail label divergence | LOGGED — working as designed, not a defect | P4 | None | N/A | See §1.4 | None — explicitly named so it is not "fixed" by accident |
| 84 | C-race frequency-cap **notes** defect (errata-corrected) | LOGGED | **P3** | None | N/A (confirmed by direct execution, Coach v2.1) | **v2.1.1 errata supersedes v2.1's original "CONTRADICTED — no such branch exists" finding.** The branch is real: `victim.notes = 'Off. Race week for a tune-up · rest is the work now.'`, survives into the live plan-notes path. 0/140 standard-shape hits; 18/56 edge-shape hits (`qualityDows:[]`, frequency 2-3), all C-priority. Normal C-race SCHEDULING remains correct and undisputed — this is a notes-text defect only, on a narrow configuration | Not a TestFlight blocker. **No regression coverage exists** — add a test before this drifts further |
| 85 | `coach_intents` gap for automatic plan mutations (renamed from "…upward events") | LOGGED | **P0** | None | N/A | Errata-renamed per §1.5. Now 3 confirmed `drift_cron_auto` instances (2 upward, 1 downward) plus `positive-drift`'s separate zero-trace history, all with zero `coach_intents` trace | Cross-references CLAUDE.md Rule 21 — see §1.5 for the precise, non-overclaiming statement of what this does and does not change about Rule 21's own claim |
| 86 | `positive-drift` historical automatic side door | LOGGED — RETIRED, standing risk only | Informational | None | N/A | Brain v2.1 §6: ungated when live, structurally identical in shape to `reanchorLthr`; code lives entirely in `legacy/web`, confirmed excluded from what Railway builds (`package.json`/`railway.json` both scope to `web-v2`) | No action needed unless `legacy/web` is ever rebuilt or redeployed — named as a standing risk of that codebase |
| 87 | September 2 "76 workouts" re-anchor claim | LOGGED — DISPUTED/UNCONFIRMED, must not be cited | N/A | None | N/A | Brain v2.1 §3 row 6 / errata §2: mechanism CLASS real and closed 2026-09-05; the specific "76 workouts" scope/date is unverifiable from the current schema (23 rows total at the post-anchor LTHR value, not a 76-row cluster) | Brain's own open question (§16 item 9): is a dedicated audit-trail mechanism (timestamp column, re-anchor log) worth adding, given this is the second time this exact class of event has proven unreconstructable |
| 88 | Coach v2's 4 remaining release findings (fabricated "0s slow" copy; false cutback "down/reduction" copy; HOLD/notice cross-surface contradiction; `standing-recommendation.ts` single-domain convergence violation) | LOGGED | Release-severity (per Coach v2) | None | N/A — relayed from Coach v2, not independently re-derived by this writer (see §1.6) | The 4th item is independently corroborated by Brain v2.1 §11 ("Standing, unaffected by this reconciliation: `standing-recommendation.ts`'s single-domain readiness gate violates the 3-domain convergence doctrine") | Not yet implemented. Awaiting Coach's own v2.1 reconciliation and artifact-only provenance receipt before any of these four are actioned |
| 89 | HR-flatline guard doesn't reach LTHR/HRmax/zone/readiness consumers | LOGGED — carried forward from v1 §8a row 51 | High | None | N/A | Dated example: 2026-09-03 treadmill hill session, flatlined HR across all 10 work phases | Not addressed by Brain v2.1 by name — folds into v1 row 9 (HR-flatline evidence gap) as a specific, dated instance |
| 90 | Five incompatible adaptation-decision vocabularies | LOGGED — carried forward from v1 §8a row 53 | High (architecture) | None | N/A | Not addressed by Brain v2.1 by name | Could materially affect Migration 166's own scope decision — should be resolved before, not after, per v1's own framing |
| 91 | `RUNNER_AUTHORITY_TIERS` duplicated in two files | LOGGED — carried forward from v1 §8a row 54 | Medium | None | N/A | Not addressed by Brain v2.1 by name | Mechanical one-quantity-one-name fix once confirmed still live |
| 92 | VDOT-eligibility OR gate — neither branch checks HR-trace credibility | LOGGED — new to this ledger via Brain §12 | Medium-High | None | N/A | Brain v2.1 §12 (Runner Data carryover): "confirmed, worse than originally stated" | Not independently re-derived by this writer — relayed via Brain's carryover section only |
| 93 | RPE: hardcoded uncited binary threshold, write-only field, one orphaned row | LOGGED — new to this ledger via Brain §12 | Medium | None | N/A | Brain v2.1 §12: 13/13 rows confirmed | Same caveat as row 92 |
| 94 | `recoveryExtensions`/`ceilingLift` — has a live Run Detail consumer | LOGGED — correction, not a defect | N/A | None | N/A | Brain v2.1 §12: "confirmed to have a live Run Detail consumer, corrected out of 'collected but unused'" | Informational only |
| 95 | Phase-transition cause largely absent (2 narrow exceptions: `repSkips`, `recoveryEndedEarly`) | LOGGED | Medium | None | N/A | Brain v2.1 §12 | Same caveat as row 92 |
| 96 | §9 Today-screen "not completed" symptom — root cause now fully traced | **RESOLVED ON `main`, NOT YET SHIPPED** | High | `154edbf97` (deletion, already on `main`) | N/A (docs/forensics) | Brain v2.1 §9: a third Swift component, `workoutPhasesTile`/`phaseTrailingText` (introduced 2026-09-04, deleted 2026-09-08), rendered unconditionally and stamped `"not completed"` for any `completed:false` phase regardless of type — neither side of the original v1 mechanism dispute was the live cause | Nothing to fix — closes automatically the moment a new TestFlight build is cut, since both this deletion and both WALKBACK merges are already on `main` |
| 97 | `progression-pass.ts` / `replan/route.ts` race-week gap (surfaced by row 66's review) | OPEN — new, unfixed | Medium-High | None | N/A | Same bug shape as row 66 (`is_race_week` raw read instead of `weekContainsRace`), at `web-v2/lib/plan/progression-pass.ts` lines ~553, ~719-720 and possibly `app/api/plan/replan/route.ts:186` | Needs its own branch and its own review — not yet started |

---

## 3. Three-Audit Intake Ledger

Per David's specified format. Populated from the Brain packet (read in full, ACCEPTED AND
CLOSED), Coach v2 (PROVISIONAL, relayed), and Runner Data v2.1 (ACCEPTED, relayed). Owner
column uses the coaching-domain vocabulary from CLAUDE.md's required-reading index
(Activity Interpreter, Evidence Engine, Runner Model, Readiness, Safety, Coaching Thesis,
Pace Prescription, Plan Generator, Adaptation Engine, Race Prediction, Goal System, Goal
Feasibility, Training Load, Environmental Context, Workout Library, UI) — these are this
writer's best-fit assignments for triage, **not** a verbatim citation of
`docs/BRAIN_CONSTITUTION.md`'s own ownership table, which was not re-read for this task.
Main should confirm each Owner against that table before treating it as settled.

| Finding | Source audit(s) | Severity | Ledger row # | Branch affected | Next-build disposition | Evidence status | Owner (best-fit, unconfirmed) |
|---|---|---|---|---|---|---|---|
| `strides_recovery_s` recovery-honesty field-name gap | Brain, Runner Data, Coach (triple-confirmed) | **P0** | 75 | None | Not this build — QUEUED, separate implementer + reviewer required | Triple-confirmed by independent methods | Evidence Engine / Activity Interpreter |
| Primary watch-completion matcher (`[0.7,1.3]`, no ambiguity refusal) | Brain, Runner Data | High | 76 | None | Not this build — QUEUED, separate implementer + reviewer required | Cross-confirmed, executed test | Activity Interpreter |
| Pause data raw-fact loss (8/8 submissions) | Brain (Runner Data carryover) | Medium-High | 77 | None | QUEUED, narrowly bounded to persistence only | Confirmed, [PROD-RO]-adjacent | Activity Interpreter |
| `reanchorLthr` ungated side door, all 5 callers | Brain | High | 78 | None | LOGGED, no scope decision made | Confirmed [SRC], 5/5 callers traced | Runner Model |
| `mark_upgrade` blocked by Migration 166; ack unrendered | Brain | High | 79 | None | Blocked on Migration 166 decision + Apply-unavailable UX render | Confirmed [SRC] for API; `[BLOCKED: not rendered]` for UI | Adaptation Engine |
| `reopenProposal()` gap, 2 modern lanes | Brain (Coach v2 reconciliation) | P1 | 80 | None | LOGGED, not implemented | Confirmed [SRC], rescoped this pass | Adaptation Engine |
| `load-activity-evidence.ts` date-only side door | Brain | Medium-High | 81 | None | LOGGED | Confirmed [SRC] | Evidence Engine |
| `HowItWentPanel` dead-code HR ladders | Brain, Coach (agree) | P4 (was P2) | 82 | None | LOGGED, downgraded | Confirmed [SRC], call-site traced | UI |
| Race-projection List/Detail label divergence | Brain (Coach v2 reconciliation) | P4, not a defect | 83 | None | LOGGED, informational | Confirmed [SRC] at pinned commit | Race Prediction / UI |
| C-race frequency-cap **notes** defect | Coach v2.1 (executed), errata-corrected in Brain | **P3** | 84 | None | Not a TestFlight blocker; needs regression coverage | Confirmed by direct execution (0/140, 18/56) | Plan Generator |
| `coach_intents` gap, plan mutations (direction-neutral) | Brain (errata-renamed) | **P0** | 85 | None | LOGGED; cross-references Rule 21 | Confirmed, 3 `drift_cron_auto` instances + `positive-drift` history | Adaptation Engine |
| `positive-drift` retired side door | Brain | Informational | 86 | None | No action unless `legacy/web` redeployed | Confirmed retired, [SRC]+[PROD-RO] | Adaptation Engine |
| "76 workouts" re-anchor claim | Brain | N/A, disputed | 87 | None | Do not cite as established | Explicitly unverifiable from current schema | Runner Model |
| Coach v2's 4 remaining release findings (fabricated "0s slow"; false cutback copy; HOLD/notice contradiction; convergence violation) | Coach v2 (relayed, one item Brain-corroborated) | Release-severity (per Coach) | 88 | None | Not implemented; awaiting Coach v2.1 artifact receipt | Relayed, not independently re-derived except item 4 | Coaching Thesis / Readiness / UI |
| HR-flatline guard doesn't reach LTHR/HRmax/zone/readiness | v1 §8a (predecessor forensic pass), not addressed by Brain | High | 89 | None | LOGGED, folds into v1 row 9 | Not re-checked this packet cycle | Safety / Readiness |
| Five incompatible adaptation-decision vocabularies | v1 §8a, not addressed by Brain | High | 90 | None | LOGGED | Not re-checked this packet cycle | Adaptation Engine |
| `RUNNER_AUTHORITY_TIERS` duplicated | v1 §8a, not addressed by Brain | Medium | 91 | None | LOGGED | Not re-checked this packet cycle | Safety |
| VDOT-eligibility OR gate (neither branch checks HR-trace credibility) | Brain (Runner Data carryover) | Medium-High | 92 | None | LOGGED, relayed only | Not independently re-derived by this writer | Evidence Engine |
| RPE hardcoded threshold / write-only field / orphaned row | Brain (Runner Data carryover) | Medium | 93 | None | LOGGED, relayed only | Not independently re-derived by this writer | Evidence Engine |
| §9 Today-screen `workoutPhasesTile` symptom | Brain | High | 96 | N/A (deletion already on `main`) | Ships automatically on next TestFlight build | [TEST]-proven for current server payload; [SRC]+[PROD-RO] for build history; Swift rendering itself never observed | UI |

---

## 4. CI / Migration / TestFlight state

| Item | State |
|---|---|
| `build-check` / `test-full` / `native-check` | Confirmed green on `origin/main`, per this session's report |
| `audit-suite` | **BLOCKED_MISSING_CREDENTIAL** — `DATABASE_URL_RO` confirmed present in `web-v2/.env.local`, absent from GitHub Actions repo secrets. Requires David's own action (`gh secret set DATABASE_URL_RO` or the GitHub UI) — declined to enter it directly per credential-handling policy |
| Migration 166 (`plan_decision_ledger`) | Confirmed additive-only, `IF NOT EXISTS`-guarded, **not** auto-applied by any build/deploy script. Still UNAPPLIED, pending separate DDL approval |
| Migration 170 (`request_failures`) | Same discipline as Migration 166 — additive-only, confirmed not auto-applied, UNAPPLIED, pending separate DDL approval, does not touch Migration 166's table |
| TestFlight | Per v1: build 290, source `0dce24f23`, uploaded 2026-09-07. `origin/main` was already 64+ commits ahead as of v1; this session added at least 6 more merged branches (rows 57–61, 64) plus the unauthorized self-merge (row 71) on top of that. **The gap has grown, not shrunk.** No new build has been cut or distributed this session |
| Independent git spot-check (this writer, this pass) | `origin/main` fetched fresh, tip `9696decac2` (`telemetry: refresh 2026-09-11T10:31`) — later than this session's own narrated state, consistent with a fast-moving multi-agent repo. See §1.7/§1.8 for what this check confirmed and what it flagged |

---

## 5. Still Open / Blocking Finalization

**Canonical v3 cannot be finalized, and none of the following may be authorized from this
draft, until:**

1. **Coach's artifact-only provenance receipt** returns (narrower than full reconciliation,
   per David's own framing — still a distinct, currently-open gate).
2. **Runner Data's artifact-only provenance receipt** returns (same distinct gate).
3. **The StateScreenScaffold fix's re-review** (row 70, `fix/statescreens-scaffold-stale-banner-ordering` @ `25d193b27`) completes — the prior attempt hit an API spend/rate limit before doing any verification work and must not be treated as PASS.
4. **David's disposition on the unauthorized-merge incident** (row 71, `52d00d0addafa8e433d48f4bc0b810141bdd40d3`) — leave it or revert it. Currently OPEN.
5. **David's decision on the newly-found `progression-pass.ts`/`replan/route.ts` race-week gap** (row 97) — needs its own branch and review, not yet started.
6. **The queued-not-yet-implemented items**, each requiring its own separate implementer and reviewer pass per the coordination rules:
   - Runner Data's 2 release blockers (rows 75, 76)
   - Pause-persistence, raw-fact scope only (row 77)
   - Coach's 5 release findings (rows 84, 88 — note row 84's severity was corrected to P3/non-blocking by the errata, but it is still unimplemented and uncovered by any regression test)
7. **`fix/postrun-missing-pace-routing`** (row 65) remains explicitly HELD from merge as a multi-session coordination decision, independent of its technical PASS status — needs David's explicit go.
8. **`fix/product-decisions-conflict-and-watch-gate-log`** (row 67) needs to actually reach `origin/main` — it does not, as of this session's direct check (§1.7), despite being reviewed.
9. **Migration 166 and Migration 170** both remain unapplied pending separate, explicit, per-statement DDL approval — unaffected by anything in this document.
10. **Physical-device verification** remains, per v1's own final verdict, "the single most-repeated unmet requirement across this entire audit" — nothing in this session changed that; zero physical-device verification is reported for any of this session's branches either.
11. **`DATABASE_URL_RO` provisioning** (row 72) — blocks `audit-suite` from ever running automatically; requires David's own action.
12. Two of this session's own merged-branch claims (rows 62–63) carry an unresolved squash-merge-vs-missing ambiguity (§1.8) that should be closed with a direct content diff before being cited as fact elsewhere.

---

*This draft was produced by direct reading of `docs/audit-2026-09-10-canonical-record.md`,
`docs/audit-2026-09-10-brain-adaptation-forensic-audit-v2.1-FINAL.md`,
`docs/audit-2026-09-10-brain-v2-to-v2.1-delta-log.md`,
`docs/audit-2026-09-10-brain-v2.1.1-errata.md`, `docs/PRODUCT_DECISIONS.md` (as it actually
stands, conflict markers included), and CLAUDE.md's Rules 16 and 21; by independent
verification of the four Brain provenance identifiers supplied for this task (all four
confirmed exact — see below); and by a direct `git merge-base --is-ancestor` spot-check of
every branch SHA named in this session's briefing against a freshly-fetched `origin/main`.
Coach v2 and Runner Data v2.1's own source documents were not supplied to this writer and
were not independently read — every claim sourced from them is marked as relayed, not
re-derived, per §1.6.*

**Provenance re-verification, this pass:**

| Field | Claimed value | Independently reconfirmed |
|---|---|---|
| Brain v2.1 final commit | `506e518d65c17820ac5dc102ab71a94b015feffe` | **Confirmed** — real commit object |
| Brain v2.1.1 final commit | `42ab86e1541595288b47e527194b2aa52365cc84` | **Confirmed** — real commit object, current tip of `audit/brain-forensic-2026-09-10` |
| Errata SHA-256 | `6db06f83b71a22860dd68d84c60993341ffe7bf6162ed65dfea0a19f449090aa` | **Confirmed** — `shasum -a 256` matches exactly |
| Errata git-object hash | `5abb7aa9ab9e738cb8c0332b5124038eabe8e9ba` | **Confirmed** — `git hash-object` matches exactly |
