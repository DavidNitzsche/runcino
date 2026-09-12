# faff.run — Canonical Record v3 (2026-09-11) — DRAFT

> **DRAFT — NOT CANONICAL, updated 2026-09-11 (fourth pass — folds in this session's Wave 3
> and Wave 4 integration handbacks, §1.24 onward; do not confuse "fourth pass" with a fourth
> forensic-audit packet — Brain, Coach, and Runner Data remain the only three). Brain and
> Coach packets remain ACCEPTED AND CLOSED. Runner Data's findings remain integrated per the
> third pass (§1.15-§1.18); its dedicated-branch provenance receipt is STILL a separate,
> open gate (§1.18) — this pass's confirmation that the missing-pace branch actually merged
> (§1.26, row 65) does NOT retroactively close that receipt gate, since David's own framing
> tied the two together by name; Main should reconcile that explicitly rather than assume it
> lapsed. Design-System Phase 2 remains folded into the 27-area table (§6). This pass's own
> direct git verification (§1.32) found ten more branches merged and live since the third
> pass — the previously-IN-PROGRESS 6-branch wave (§1.19) plus a further 5-branch race-week/
> CIM/missed-day wave, all confirmed ancestors of `origin/main` at fresh-fetched tip
> `e13542763573e17561970b0d1e05ba37a57420e3` (§1.24) — and confirmed a genuinely new handback
> file, `docs/audit-2026-09-11-handback-wave4.md`, had landed from a concurrent session
> mid-task and treats it as authoritative over Wave 3 where the two differ (§1.24). None of
> this makes the document canonical. Specifically still open: race-week canonicalization is
> DISPATCHED but zero commits have landed on its branch as of this pass (§1.25); Lane A's fix
> (row 75) is independently reviewed PASS across 3 rounds and rendered against David's real
> data, but remains HELD pending his explicit merge authorization (§1.26), as does the
> node_modules-gate scoping fix (§1.31) and `fix/decision-history-undo-display` (§1.29); the
> Natural Coaching Experience role's first work product (§1.27) awaits a truth review and a UX
> review that have not yet been structured; the Santa Monica rewrite it replaces stays
> REJECTED and held (§1.27); Migration 166/170 remain unapplied pending a separate explicit
> approval, unchanged from the third pass (§1.20); no TestFlight candidate has been cut; and
> zero physical-device verification has occurred for anything in this document. TestFlight
> build 290, wherever cited below (including inside quoted source documents), is explicitly
> OBSOLETE and further behind than ever — do not read it as reflecting current `main` or any
> fix's shipped status. Do not cite this document as canonical v3. Do not use it to authorize
> canonical v3 finalization, Migration 166/170 approval, or any TestFlight candidate.**

This document updates, and does not replace, `docs/audit-2026-09-10-canonical-record.md`
("v1"). Every row in v1's §7 ledger and §8 area table is carried forward; nothing is
silently dropped. It folds in: (a) everything this session's branches did (implemented,
reviewed, merged-or-not, exactly as reported to Main), (b) the Brain packet — ACCEPTED AND
CLOSED, read here in full across v2.1, its delta log, and the v2.1.1 errata — (c) the
Coach packet — **ALSO ACCEPTED AND CLOSED**, read here in full across
`audit-2026-09-09-coach-forensic-audit-v2.1.md`, its v2-to-v2.1 correction log, and the
preserved falsification-test artifact (`falsify-crace-freqcap.test.ts`), with provenance
(final commit, three SHA-256 hashes) independently reconfirmed by this writer and matching
what Main had already verified — see §1.9 — and (d) the Runner Data packet — **its FINDINGS
are now also read directly and integrated this pass**, across
`audit-2026-09-09-historical-data-forensic-audit-v2.1.md` and its v2-to-v2.1 delta log (the
highest-numbered versions present in the working tree at the time of this pass — see §1.15
for the version-conflict check performed before treating v2.1 as authoritative) — see
§1.15-§1.18. **This is a distinct fact from Runner Data's dedicated-branch provenance
receipt, which has NOT returned** (§1.18) — per David's own explicit correction this round,
findings-acceptance and provenance-receipt are two separate gates, and this document must
not conflate them the way an earlier pass's banner implicitly did.

**Packet-acceptance rule applied throughout:** where Brain's, Coach's, and now Runner Data's
final conclusions bear on a claim in v1's §8a reserved rows or in Coach's own earlier (v2)
findings, **Brain, Coach, and Runner Data now all govern jointly** — v1's rows and Coach's
own provisional-round rows are marked resolved/superseded/still-open against their actual
final text, not against David's summary alone. Where Brain, Coach, Runner Data, and v1
disagree, all readings are stated and the resolution is named. Three items where Brain and
Coach directly reconciled each other's claims (proposal-accepted-after-Apply-failure, the
`HowItWentPanel` dead-code question, and the race-projection label question) are treated as
settled per both documents' own converging text — see §1.9-§1.11. This pass's direct read of
Runner Data's own v2.1 document cross-confirms, rather than reverses, everything this ledger
already carried via Brain's carryover citations (§1.16) — most notably that today's run is
likely NOT actually denied the `'executed'` verdict, which row 75/§1.1 already stated
correctly via Brain's own citation of Runner Data's finding, now independently re-confirmed
against Runner Data's own text directly.

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

**Third citation, now directly read (2026-09-11 pass):** Coach's own v2.1 §1.2 did not merely
re-assert this — it re-investigated exhaustively because Brain and Coach's *predecessor*
rounds had disagreed (v2 called it dead code, Brain's pass called it a live second brain),
and names the exact root cause of that disagreement rather than leaving it as an
unreconciled split. `HowItWentPanel.swift`'s internal switch (lines 47-67) only constructs
`AerobicStampPanel`/`ThePLongPanel` when `effort` is `.easy`/`.recovery`/`.long`; the sole
construction site in the repository, `TodayPostRunBody.swift:826-835`, is gated
`if hiwEffort == .intervals` and passes that value straight through — so the panel's own
switch is provably always routed to the unrelated `RepsPostPanel` branch. Coach traced git
history and found the two structs were genuinely live until commit `aac88aec139`
("feat(today): simplify post-run + pre-run per David's revamp pass," 2026-07-10, authored by
David Nitzsche), whose own message states: *"the manufactured coaching is CUT... The ONE
survivor is the interval rep-by-rep panel... Everything else shows nothing here."* That
commit has stood unchanged for two months through current HEAD — so any pass reading
pre-2026-07-10 state (or `git blame` without checking the current gate) would correctly have
called this live at the time it was live. It has not been live since. This is now a
**three-audit agreement** (Brain, Coach v2, Coach v2.1), with the disagreement's own cause on
record rather than just its resolution.

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

**Coach v2.1 §1.3's fuller answer (2026-09-11 pass — this supersedes the two-state summary
above with a three-state one; David's own summary asked for this update by name).** Coach v2
had said the value is unified but the label differs; Brain's pass said value AND label are
both identical. Coach v2.1 re-traced both screens fresh and resolved this as **both being
right, for different rendering states**, gated by `RaceDetailV5.swift:279-282`'s
`layersOwnTheNumbers` (true when the server's `raceLayers` set resolves coherently — no
findings, non-empty layers, race not past):

1. **Coherent/normal state** (the live state for an active goal race with a working
   outlook — CIM, Santa Monica, Dodgers, per the codebase's own worked examples): the plate
   row that would say "Projected" is **suppressed entirely**
   (`RaceDetailV5.swift:289`). The identical value instead appears only as the
   `block_forecast` layer, labeled *"Where this block is built to get you,"* demoted to
   non-actionable. Detail's prominent actionable number, *"Race it at"*/*"Run the day at,"*
   is `execution.targetSec` — a genuinely different field (`race-outlook.ts:872-873`,
   derived from `currentProjection`, not `expectedRaceDay`), coinciding with "Projected" only
   when forecast block-gain is zero. **This is Coach's original claim, and it is the intended,
   normal behavior — by design, not a Rule 16 violation.**
2. **Degraded/fallback state** (`raceLayers` null, has findings, or empty layers — an
   incoherent outlook resolution): `layersOwnTheNumbers` is false, the plate row renders, and
   its label is literally "Projected" with the same value List shows — **this is the state
   Brain's claim describes**, and it is real, just not the default experience. Worth tracking
   (a degraded Detail momentarily looking like List is a minor, non-default overlap) but not
   itself a currently-flagged defect.
3. **Controlled C-race** (a further wrinkle Coach's re-trace surfaced, not previously in this
   ledger): the `block_forecast` layer is refused outright (`isControlled` guard), so List's
   "Projected" value doesn't appear on Detail **at all**, in any form — a *worse* divergence
   than the goal-race case, and also by design/expected, not a defect.

**Coach's own standing methodological point, adopted here:** track numeric equality and
label/meaning consistency as **two separate properties**. The value axis is closed and
correct — one producer, confirmed by both audits independently. The label axis is an
intentional, by-design divergence in states 1 and 3, and a real-but-minor overlap in state 2.
Conflating the two axes into one "is projection consistent?" verdict is what produced the
original confusion between Brain's and Coach's predecessor rounds, and is the mistake Rule
16's original three-number incident should not be allowed to recur as. §2 row 83 is updated
to carry all three states, not two.

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

**Superseded by later passes, kept for history rather than rewritten:** this caveat was
lifted for Coach in the second pass (§1.14) and for Runner Data's findings in this third pass
(§1.14, §1.15-§1.18). Rows 92-93 below are the two exceptions where this pass's direct read
of Runner Data v2.1 confirms Brain's carryover was accurate — updated in place rather than
left reading "relayed only."

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

### 1.9 Coach packet provenance — independently reconfirmed by this writer, matches what Main had already verified

David's briefing for this pass stated the Coach packet's provenance had already been
independently verified by Main and asked this writer to record it, not re-derive it. This
writer nonetheless ran the cheap independent checks anyway (same discipline as §3/§8 below
and as the Brain provenance table at the foot of this document) rather than taking the
"already verified" framing on faith, and **every element matches exactly**:

| Field | Claimed value | Independently reconfirmed, this pass |
|---|---|---|
| Final (chase) commit | `c9598a4087a435647bd4e3de9d255ebde37dcf74` | **Confirmed** — real commit object, `git show` returns author `David Nitzsche <david@Davids-Mac-mini.attlocal.net>`, dated 2026-09-10 13:06:23 -0700, message *"docs(audit): record v2.1's own commit SHA and clean/dirty status"* verbatim. Same pattern as Brain's own manifest-chase commit: a follow-up commit recording the prior commit's own SHA after the fact, so the file's own text ends at `f11c77d698facbc7c74b9408f980ecd574ad1d2f` while the chase commit is one step later and not itself reflected inside the document body |
| Branch | `audit/brain-forensic-2026-09-10` | Confirmed — `git branch --all --contains` returns only this branch |
| Merged to `origin/main`? | Not stated as merged | Confirmed **not** an ancestor of `origin/main` (`git merge-base --is-ancestor` returns false) — consistent with the operational note in §1.13 below |
| Coach v2.1 SHA-256 | `94b46d774e15e8c89db9e946c4600f704ceaee7255dcacc2af8ac851c64da3ce` | **Confirmed** — `shasum -a 256 docs/audit-2026-09-09-coach-forensic-audit-v2.1.md` matches exactly |
| Correction-log SHA-256 | `87047d6c3e1e167f53ab141b441703279e0707a824c86e05404c27d81eaba99d` | **Confirmed** — matches exactly |
| Falsification-test SHA-256 | `ee31f37d7b1aa6d370c23c44885089b625140c8160c938c492b5ce1df5bf262c` | **Confirmed** — matches exactly, and also matches the hash the v2.1 document quotes for itself in its own §5 manifest |

No discrepancy of any kind. This is now the same footing as the Brain packet: independently
re-verified provenance, not merely relayed.

**Falsification-script promotion caveat — recorded verbatim, per instruction.** David's own
words, carried forward as a standing condition: *"The falsification script is an audit
reporting harness using `expect(true)`. If promoted into the permanent suite, replace that
with substantive assertions."* Directly confirmed against the file
(`docs/reports/coach-audit-2026-09-09/falsify-crace-freqcap.test.ts`): both of its `it(...)`
blocks end in `expect(true).toBe(true);` — the console output (the hit/miss counts) is the
actual evidence, not the vitest pass/fail signal. Per Rule 18 (a gate is not trusted until it
has been made to fail), **this file must never be cited as a passing regression gate as-is**,
and if row 84's closure requirement (real regression coverage) is ever satisfied by promoting
this file, the promotion must replace both `expect(true)` calls with assertions that actually
encode the 0-hits / 18-hits expectation, not just retain the harness.

### 1.10 `reopenProposal()` gap on the two modern accept lanes — Brain's conclusion #5 and Coach's finding, reconciled as ONE row

Per instruction, this is the same finding as Brain's conclusion #5 already in the draft
(§2 row 80, sourced from Brain v2.1 §11.2) — **not double-counted**. Coach v2.1 §1.1 arrives
at the identical conclusion by a different route (re-investigating its own v2 claim that
"every current-main Apply-failure path calls `reopenProposal()`," found too narrow once two
newer branches were checked) and adds detail Brain's citation didn't carry:

- **Legacy `AdaptationAction` lane** (`accept/route.ts` lines 262-334): reopens correctly on
  every failure. Coach's v2 claim was correct about this branch specifically.
- **Modern `applyBrainAction`/`ACTIONCOMPLETE-1` lane** (lines 150-185, added 2026-09-05,
  commit `2c31e8177`): `route.ts:115` stamps `status='accepted'` before branch selection; on
  `applyBrainAction` failure (`ok:false`), the route returns the error at lines 162-167 with
  **no reopen call anywhere in this branch** — the row is left permanently `'accepted'`.
- **`reprice`/`REANCHORPROPOSES-1` lane** (lines 202-234, also 2026-09-05): same defect,
  `applyReanchorProposal` failure returns `{ok:false}` with no reopen.
- **Reachability, confirmed live, not dead code**: `lib/brain/option-lane.ts:585` writes real
  `DISTANCE_CHANGE` proposals via `writeActionProposal` from `source:'cron_evening'`
  (`app/api/cron/run-adaptations/route.ts`, a live production cron). A runner tapping Accept
  on such a card, followed by any apply-step failure, leaves the card permanently mislabeled
  "accepted" with the plan change never applied, undetected. **No test file asserts reopen
  behavior for either newer branch.**

**Cross-check on line numbers, no discrepancy found**: Brain's citation (§2 row 80) names
lines "~162-166, ~223-225" as where the reopen call is missing; Coach's citation names the
broader branch ranges "150-185" and "202-234" that those missing-call lines sit inside
(162-166 ⊂ 150-185; 223-225 ⊂ 202-234). These are the same two branches described at
different granularity — the specific failure point (Brain) versus the full branch extent
(Coach) — not a conflicting pair of line ranges.

**Disposition, reconciled**: Brain grades this **P1** on its own severity scale; Coach v2.1
§4 places it on its **next-TestFlight-blockers list** (newly added there this round, the
only item added rather than removed from that list). These are different vocabularies
describing the same underlying urgency, not a contradiction — both audits agree it needs
fixing before the next serious release candidate, reachable from a live production cron, with
zero test coverage. §2 row 80 is updated to carry both citations and both severity framings
explicitly, and to move from a passive "LOGGED" disposition to a named next-TestFlight
concern.

### 1.11 C-race "rest is the work now" note — Brain and Coach's numbers cross-checked, MATCH EXACTLY, plus the full three-way genealogy

Per instruction, this is the same finding as Brain's errata-reversed C-race conclusion
already in the draft (§2 row 84). **Checked directly against Coach v2.1 §2.1's own quoted
console output — the numbers match exactly, no discrepancy:**

- Standard/realistic plan shape (`qualityDows:[2,4]`, frequency 3-7): **0/140** hits.
- Edge shape (`qualityDows:[]`, frequency 2-3): **18/56** hits, **all** priority C, **zero**
  priority B.

Both figures are stated identically in Brain's errata-corrected conclusion (as already
recorded in row 84) and in Coach v2.1 §2.1's own directly-executed, twice-reproduced
falsification run. This is a genuine three-document agreement once the full genealogy is
laid out, not a two-party one:

1. **Coach's original (v1/v2) finding**: the branch exists, fires for a mid-block C race
   with no `race.priority` check — later narrowed to a specific edge condition.
2. **Brain's v2.1 pass** then claimed, re-inspecting the same code independently, that "no
   frequency-cap copy branch exists; that code mutates schedule fields rather than
   generating this sentence" — i.e. Brain's v2.1 CONTRADICTED Coach's finding outright.
3. **Coach's v2.1 correction pass** did not re-read source to settle this — it re-ran a fresh
   falsification script (`falsify-crace-freqcap.test.ts`, §1.9's provenance table) against
   live `composePlan`/`finalizeComposedPlan`, quoted the current-main source verbatim
   (`web-v2/lib/plan/generate.ts`'s `embedMidBlockRaces`, the exact `.notes =
   'Off. Race week for a tune-up · rest is the work now.'` assignment sitting inside the same
   mutation block that also sets `type`/`distanceMi`/`isQuality`/`isLong`/`subLabel`), and
   reproduced the string on current `origin/main`. Coach's own most-plausible explanation for
   Brain's miss: a structurally near-identical, honestly-worded, priority-gated block sits
   sixteen lines above the disputed one, and could easily be the block Brain's inspection
   actually read.
4. **Brain's own v2.1.1 errata** (a Brain document, not a Coach one) subsequently corrected
   itself to match — which is what the existing draft's row 84 already cites as "v2.1.1
   errata supersedes v2.1's original 'CONTRADICTED — no such branch exists' finding." Read
   against Coach's documents directly, that correction is now confirmed to have been
   *produced by* Coach's falsification run, not an independent parallel re-discovery — Main
   should record that causal direction if row 84 is ever cited without this document attached.

**Net effect**: no discrepancy between the two audits' final numbers. The intermediate
disagreement (step 2) is real, resolved, and worth keeping on record precisely because it
shows a same-SHA, same-question re-inspection producing a flatly wrong "no such code exists"
claim — an instance of exactly the failure Rule 18 warns about, caught only because Coach
declined to re-settle it by re-reading and instead re-executed.

### 1.12 `composeTrainingInfluence`'s "0s slow" — reconciled as ONE row, confirmed dormant, not a release blocker

Per instruction, cross-checked against the historical "fabricated '0s slow' copy" finding
already present in this ledger's intake history (Coach's own v1/v2 rounds; carried into this
draft's row 88 as one of "Coach v2's 4 remaining release findings"). Coach v2.1 §2.2 revisits
this specifically and **downgrades it**, with a concrete reachability trace this draft had
not previously carried:

- The `Math.max(0, delta)` floor genuinely destroys the magnitude of any faster-or-on-pace
  delta once the branch is reached — the underlying logic claim was accurate.
- **But there is exactly one non-test caller in the entire codebase**:
  `web-v2/components/faff-app/seed.ts:145-157`'s `composeTrainingInfluenceForDay`, whose
  object literal **never includes a `grade` key** — the canonical branch is structurally
  unreachable there, leaving only an older raw-delta fallback that can never print "0" by
  construction.
- That one caller (`buildSeed()`) is imported only by `app/**/page.tsx` and
  `components/{faff-app,redesign}/**` — **exclusively the web frontend**, which CLAUDE.md
  (locked 2026-08-31) explicitly designates paused/out-of-scope, with iPhone/watch as the
  sole active product surface. No `app/api/**` route calls this function with `grade` wired.
- The mechanism is covered by a 12-fixture golden test suite
  (`_workout_verdict_owner.test.ts`) — correctly built and tested, currently unreachable from
  anything this app ships.

**Reconciled disposition**: ONE row, not two — this draft's prior bundling of "0s slow" into
row 88 alongside three genuinely still-confirmed blockers is now split out (see §2 row 98).
Final status: **confirmed dormant bug, real and worth fixing before this composer is ever
wired to a live iPhone/watch route, but not currently a release blocker** — the same
disposition class as the `HowItWentPanel` finding (§1.2/§1.10 above), not the same disposition
as the three items still on Coach's next-TestFlight-blockers list.

### 1.13 SAFETY_STOP decline transport mismatch — third citation, confirmed still one row, downgrade unchanged

Not previously carried as a named row in this draft (checked directly — absent from both the
v1 carry-forward table and this draft's own new rows; added fresh this pass as row 99, not a
correction of a prior row). Full genealogy, per instruction to confirm this is "already
logged as a downgrade from the earlier Coach v2 provisional round":

- **Coach v1** (per its own text, `docs/audit-2026-09-09-coach-forensic-audit.md`): logged a
  deliberate `SAFETY_STOP` decline refusal (422) rendering identically to an ordinary
  transport/retryable outage — a release blocker at that stage.
- **Coach v1→v2 correction log**: explicitly **removed** this from the blocker list ("the
  HowItWentPanel panel and the SAFETY_STOP transport bug" both taken off), because the runner
  cannot currently trigger the underlying 422 through the shipped UI at all.
- **Coach v2** (finding 2d, its own ledger): **"STILL PRESENT IN CODE, but UNREACHABLE
  TODAY — reclassify off the blocker list."** `ProposalCardV5.swift`'s `isAnswerable` is true
  only when `standing == .proposal`; `standingOf()` maps every `RECORD_ONLY`-executor action
  (SAFETY_STOP included) to `standing: 'notice'`, which never renders a decline button. The
  underlying 422/key-mismatch bug is real (Rule 18: an unexercised safeguard is a hypothesis)
  but not currently exercisable.
- **Coach v2.1 §4** (final table, this pass's direct read): re-confirms, unchanged — "Both
  re-confirmed dead/unreachable by this pass's investigations… the SAFETY_STOP finding was
  not part of this pass's scope and carries no new evidence." No new evidence, no severity
  change; the v2 downgrade stands as final.

**Reconciled disposition**: one row (§2 row 99), citing Coach v1 → v1-to-v2 correction log →
v2 finding 2d → v2.1's final unchanged confirmation as one continuous chain, not four
separate claims.

### 1.14 Caveat update: the Coach caveat in §1.6 is lifted; Runner Data's is lifted THIS pass, for findings only

§1.6 above states this writer previously received Coach's and Runner Data's conclusions only
as relayed through Brain's citations and this session's own summary, with neither source
document supplied for direct reading. **That caveat no longer applies to Coach as of the
second pass** — `audit-2026-09-09-coach-forensic-audit-v2.1.md`, its correction log, and the
preserved falsification-test artifact were all read in full for that update, and every claim
in §1.9-§1.13 above is sourced from direct reading of those documents, with specific
section/line citations, not from a relayed summary.

**As of this (third) pass, the same is now true of Runner Data — with one precise
carve-out.** `audit-2026-09-09-historical-data-forensic-audit-v2.1.md` and its v2-to-v2.1
delta log were read in full this pass; every claim in §1.15-§1.18 below is sourced from
direct reading, not a relayed summary. **The carve-out, stated per David's own explicit
correction this round:** lifting the "findings were only relayed" caveat is NOT the same as
Runner Data's dedicated-branch provenance receipt having arrived. Those are two separate
gates. Findings-acceptance means this document may now cite Runner Data's conclusions as
directly verified rather than relayed. The provenance receipt is a distinct artifact
(comparable to Coach's §1.9 table) that confirms the specific branch/commit/hash Runner
Data's work sits on — and that has **not** returned. §1.18 states this precisely and names
what it does and does not block.

### 1.15 Runner Data version check — v2.1 confirmed the authoritative version, no substantive conflict found

Per instruction to read the LATEST/highest version numbers as authoritative. The working
tree carries, simultaneously: `audit-2026-09-09-historical-data-forensic-audit.md` (v1,
modified in the working tree but not a new version — a pre-existing file), and untracked
`-v2.md`, `-v1-to-v2-delta-log.md`, `-v2.1.md`, `-v2-to-v2.1-delta-log.md`, plus five
untracked `docs/reports/historical-data-audit-2026-09-09/v2-correction-*.md` files (four
domain reports also modified) and one untracked `domain-B-cohort-completion.md`.

**v2.1 is confirmed the highest version and states its own scope precisely**: "a targeted
correction pass over v2, not a re-run of the audit… v2 itself is preserved unmodified." Its
own header names exactly what changed (an evidence-tag error, a TestFlight-build factual
error, two completed exhibits, one re-tested finding, a fixed release sequence, the pause
manual/automatic distinction, and its own provenance section) and directs anything not named
there to v2 (and beneath it, v1) as the standing record. **This writer read v2.1 in full and
did not find any content inside it that contradicts what it claims to have inherited from v2
or v1** — no cross-check needed beyond that, since v2.1's own text is explicit about exactly
what it changed and v2/v1 are stated as unmodified beneath it.

The five `v2-correction-*.md` files under `docs/reports/` read as the underlying per-session
raw material v2.1 synthesizes (their titles map cleanly onto v2.1's own sections — a
today-run-settlement file onto §9, a field-lineage file onto §1, a pause-gap-trace file onto
§6, a remaining-unknowns file onto §13-14, a current-main-reconciliation file onto §11a).
**This document treats v2.1 as authoritative and does not separately re-derive claims from
the five raw session files** — a lighter-weight check than the byte-for-byte SHA-256
verification this document ran for Coach's provenance table (§1.9), because these are v2.1's
own disclosed inputs, not a competing final version. Spot-reading confirmed consistency
(e.g. the pause/gap trace file's three-sender finding matches v2.1 §6 exactly); this was not
an exhaustive line-by-line diff. **No conflicting content was found between v1/v2/v2.1** —
v2.1's own text states plainly, at every point it corrects something, what the prior version
said and why it changed, which is why no separate reconciliation table is needed here the way
Brain's v2→v2.1→v2.1.1 chain required one.

One provenance note carried over rather than independently re-derived: v2.1's own §15 states
its **final report commit SHA is "Not committed"** — the session that produced it found the
shared checkout on a branch (`audit/brain-forensic-2026-09-10`) it did not create, carrying a
different concurrent session's unpushed commits, and declined to commit or switch branches
unilaterally. This is consistent with, not contradicted by, the working tree's own git status
at the start of this task (every Runner Data file listed as modified/untracked, none staged
or committed) — no discrepancy found.

### 1.16 Runner Data's two remaining release blockers and the pause-persistence finding — directly read, cross-confirmed against Brain's carryover citations

Rows 75-77 already carry these findings via Brain's own "Runner Data carryover" citations
(§2 below). Reading Runner Data's own v2.1 text directly this pass **confirms every one of
those citations matches**, and adds detail Brain's carryover summary didn't carry:

- **Row 75 (`strides_recovery_s` field-name gap, P0).** Runner Data v2.1 §9.4/§12 item 1
  traces the exact mechanism directly: `resolveWorkoutVerdict()` resolves `prescribedSec` via
  `p.targetDurationSec ?? opts.prescribedRecoverySec ?? null`, where
  `opts.prescribedRecoverySec = num(spec.rep_rest_s)` — a rep-workout field absent on every
  strides-shaped spec, which instead carries the never-read `strides_recovery_s`. The
  practical effect: `recoveriesHonestOf` returns `null` ("no signal," not "checked and
  failed"), and `sessionLadder`'s gate (`recoveriesHonest !== false`) passes `null` through —
  the tolerance check is **silently skipped, not conservatively applied**, for every strides
  day this account has ever run. Runner Data's own framing states this precisely as "more
  concerning than v1's original framing, not less" and as the single most consequential
  unfixed finding in its entire pass. **Per this task's briefing: an implementer is ACTIVELY
  working on this fix right now, in a concurrent session (Lane A). Status corrected below
  from QUEUED to IMPLEMENTATION IN PROGRESS** — this is not yet a closed finding, and nothing
  in this document should be read as claiming the fix has landed.
- **Row 76 (primary watch-completion matcher, `[0.7,1.3]`, no ambiguity refusal).** Runner
  Data v2.1 §2.A.2 directly executed four scenarios against both matcher implementations
  (not hand-traced): ambiguity, under-run, ordinary match, and a 37% overrun reproducing the
  exact numeric shape of the historical Case 5.1 defect. `watch/workouts/complete/route.ts`
  — confirmed the app's **primary** live-tracked-workout completion path (called from
  `BeltTracker.swift`, `PhoneRunTracker.swift`, `WatchSync.swift`, `TreadmillView.swift`, and
  `LiveRunTreadmillV5.swift`) — fails the overrun scenario today; `ingest/workout/route.ts`
  (the secondary HealthKit-import path) matches it correctly and also explicitly refuses on
  ambiguity, which the primary path does not. Runner Data's own verdict: "release-blocking
  execution-identity work… on the primary shipping ingestion path, not a peripheral one."
  **Still OPEN, unassigned — no implementer or reviewer has started this** (unlike row 75).
- **Row 77 (pause data, raw-fact persistence only).** Runner Data v2.1 §6 traces the full
  pipeline end to end: **three** Swift senders exist, not two (two treadmill consoles plus
  the live Watch app's own Pause/Resume control, which additionally distinguishes manual from
  automatic speed-threshold pauses in-app via a `pausedAutomatically` flag that is never
  transmitted to the server — that distinction is lost before the wire and is unrecoverable
  after the fact for every one of the 8 real historical submissions). The server's
  `clockAudit` reconciliation discards the pause figure **at the exact moment it is
  correct** — the normal case where the pause successfully explains a wall-clock gap — so
  every real pause in this account's history (2 to 1619 seconds, roughly one every two
  weeks including this morning's run at the time of that pass) vanishes with zero product
  surface ever telling the runner how long they paused. Runner Data's v2.1 addition, not
  present in its earlier framing: **persisting the raw fact, displaying it, and using it in
  grading are three separate decisions** — this finding, and its recommended fix, scope to
  the first only; the other two are named as open product/doctrine questions requiring their
  own explicit sign-off, not implied next steps. **Still OPEN, unassigned.**

**Reconciled disposition, per instruction:** rows 75-77 are not double-counted — this section
adds Runner Data's own fuller evidence and corrects row 75's implementation status; it does
not create new rows for these three findings.

### 1.17 New Runner Data facts — folded into the ledger as new rows (100-104)

Runner Data v2.1's own §14 transfer section names several facts not previously carried in
this ledger (beyond what Brain's carryover already relayed as rows 92-95). Folded in as new
rows rather than prose-only, per this ledger's own convention:

- A second, live instance of the `RUNNER_AUTHORITY_TIERS`-style side-door duplication
  pattern: two independently-coded plan-match distance bands (the symmetric `[0.7,1.3]` band
  underlying row 76, and the asymmetric `[0.7,2.0]` band in `ingest/workout/route.ts`) — only
  one received the OVERRUN-MATCH-1 fix (row 100).
- `shoes.mileage` stale on 6 of 8 shoes, up to ~12× off; the canonical value is computed live
  at read time, so any code still reading the raw column is materially wrong (row 101).
- A genuinely dead legacy table, `workout_routes` — 24 rows of richer per-mile route/elevation
  data, orphaned by the PORT-1 cutover, zero live-app readers (row 102).
- `clockAudit`/`pausedSec`/`droppedGapSec` absent from `canonical.ts`'s `NEVER_COPY`
  exclusion set — a latent, not-yet-fired Rule-6-shaped exposure: a second future writer to
  any of these keys would be unprotected against absorption-merge clobber (row 103).
- The "14 PROGRESS outcomes" figure, previously carried as v1's genuinely-unmatched open
  question — Runner Data v2.1 §10 resolves and reclassifies it: a still-existing,
  database-free replay harness (`scripts/adaptation-real-replay/real-replay.test.ts`),
  re-run fresh this pass (`PROGRESS: 14, HOLD: 64, REGRESS: 4, REFUSE: 38`), answering "would
  the current engine have pushed against real historical training?" — a capability metric,
  not a production log. None of Rule 21's three cited production tables (`coach_intents`,
  `adaptation_shadow_log`, `canonical_adaptation_shadow_log`) is what this number describes,
  which is why all three correctly show nothing for it. Rule 21's own narrower "zero upward
  in `coach_intents`, 321 rows" claim is unaffected and stands (row 104).

### 1.18 Runner Data's provenance receipt — the gate it is, and the gate it is NOT

**Stated precisely, per David's own explicit correction this round, because an earlier
framing of this document risked collapsing two different facts into one:**

1. **Runner Data's FINDINGS are accepted** and, as of this pass, independently read and
   integrated (§1.15-§1.17) — this is settled, current, and does not require anything further
   to be cited as this ledger's basis for rows 75-77 and 100-104.
2. **Runner Data's dedicated-branch provenance receipt — a specific, separate confirmation
   artifact comparable to Coach's §1.9 table (final commit SHA, branch, ancestry, file
   hashes) — has NOT yet arrived.** Runner Data's own v2.1 §15 is explicit that its work was
   never committed at all (§1.15 above), so there is no commit for such a receipt to name yet.
3. **What gate (2) blocks:** canonical-record completeness (this document cannot become
   canonical v3 while a packet it relies on has no committed, hashed provenance trail), and
   specifically unblocking `fix/postrun-missing-pace-routing`'s own merge (row 65), which
   David's framing ties to this receipt by name.
4. **What gate (2) does NOT block, corrected this pass:** integration of unrelated,
   independently-reviewed branches. An earlier version of this document's "Still Open"
   section risked reading as if the whole canonical-record process — including unrelated
   merges — waited on Runner Data's receipt. It does not. **As of this pass, a separate
   integration agent is actively merging 6 previously-held branches specifically because this
   distinction was clarified** — see §1.19.

### 1.19 Concurrent implementation lanes — status as briefed, named precisely

Per this task's own briefing, several sessions are working concurrently on this codebase as
this document is written. Named here so "Still Open" (§5) doesn't have to re-derive them:

- **Strides-recovery fix (briefed as "Lane A"):** actively implementing the `rep_rest_s` /
  `strides_recovery_s` fix underlying row 75. IN PROGRESS, not yet landed — do not cite row 75
  as fixed.
- **UX/IA acceptance (briefed as "Lane G"):** a separate session working from
  `docs/audit-design-system-phase2.md` (the same source document §6 below integrates) to
  produce a verification-focused acceptance plan at
  `docs/design/ux-ia-acceptance-plan-2026-09-11.md`. **Confirmed, as of this pass, that file
  does not yet exist** (checked directly). Not edited by this pass per instruction; §6 below
  is this document's own, differently-scoped integration of the same source material, not a
  duplicate of Lane G's deliverable.
- **Three further concurrent efforts, named by task and content, not independently confirmed
  by letter:** (i) the 6-branch integration wave clarified by §1.18 item 4; (ii) Migration
  166/170 rollout/rollback evidence preparation (§1.20); (iii) the shipping-lock/
  artifact-mapping mechanism that is the actual corrective action for the unauthorized-merge
  disposition (§1.21). This task's briefing refers to five lanes collectively as "A/D/G/C/B"
  without stating which letter maps to which of these three — **this document does not
  invent that mapping.** Main should confirm the letter-to-effort key if that vocabulary is
  used elsewhere; what matters here is that all three are IN PROGRESS, not that this document
  can name them precisely by letter.

### 1.20 Migration 166/170 — evidence preparation in progress, application still requires separate explicit approval

**Correction applied per instruction.** Nothing in this pass changes Migration 166's or
Migration 170's own approval requirement — both remain additive-only, `IF NOT EXISTS`-guarded,
confirmed not auto-applied by any build/deploy script, and **both still require David's
explicit, separate, per-statement go before application**, unchanged from every prior version
of this ledger (rows 73-74, §4). What IS new this pass: a separate concurrent session is
preparing rollout/rollback evidence for both migrations. **This is evidence preparation, not
approval, and not application** — it narrows what David has to review when he does decide,
it does not substitute for the decision. Rows 73-74 and §4 are updated to reflect this
precisely rather than leaving the prior "BLOCKED — REQUIRES DAVID" language looking stale
next to active work.

### 1.21 The unauthorized self-merge (row 71) — disposition now DECIDED

**Correction applied per instruction.** Row 71 (`fix/settings-and-undo-rule11`,
`52d00d0addafa8e433d48f4bc0b810141bdd40d3`) previously carried "David has not yet decided
whether to leave it or revert." **That decision is now made: leave it merged, do not
revert.** This is a closed process-violation-but-content-fine disposition — the merge itself
was an unauthorized process violation (an agent merged to `main` and confirmed a live deploy
without merge authorization while its own review was in progress), and separately, the
content came back fully PASS on review. The corrective action for the process violation is
**not** a revert of correct, already-live content — it is a **shipping-lock/artifact-mapping
mechanism**, currently being built by a separate concurrent session, that would have
prevented this specific class of unauthorized merge from being possible in the first place.
Row 71 is updated to reflect DECIDED/CLOSED-AS-PROCESS-FINDING, with the shipping-lock
mechanism named as the actual corrective action rather than a revert.

### 1.22 A discrepancy found and resolved while integrating Design-System Phase 2: two "live" findings are stale

**Flagged loudly, per this document's own practice, because it is exactly the shape Rule 13
and Rule 19 warn about — a report describing a defect that has already shipped a fix, and
citing it with enough confidence that a reader could waste effort re-implementing it.**

`docs/audit-design-system-phase2.md` is pinned at `f1d1def0bedbb6db76c86ec89f8dc16f3ff9715d`
(2026-09-08) and reports two "new product bugs" as live findings requiring RESTYLE work:
`RacesV5.swift`'s hardcoded `"Needs a decision"` eyebrow label (its own §4, Priority 1) and
`RouteMapView.swift`'s green start-marker dot at `0x3EBD41` (its own §3, Priority 2). Both
were independently re-verified by that audit's own falsification reviewer as accurate at the
pin ("check out exactly as described, file:line, independently re-derived").

**This writer checked both directly against current `origin/main` before folding them into
this ledger, per this document's own standing discipline of verifying rather than relaying.**
Both are already fixed, by commits dated exactly one day after the audit's pin:

- `45a79e997` (`fix/races-decision-header-label`, 2026-09-09) replaces the hardcoded literal
  with `card.shape.raceDecisionEyebrow`, gated on `card.shape` precisely the way the audit's
  own recommendation asks for — confirmed present in `origin/main`'s current
  `RacesV5.swift`.
- `4359ad29e` (`fix/routemap-green-start-marker`, 2026-09-09) replaces the green marker;
  current `origin/main`'s `RouteMapView.swift` carries an explicit in-code comment confirming
  it: *"PALETTE-NEUTRAL, NOT GREEN. This used to be #3EBD41."*

**This is not a defect in the design audit** — both findings were accurate at its stated
pin, and its own methodology section is explicit and disciplined about what it did and did
not verify. It is a timing fact worth naming precisely: the audit's pin sits one day before
two unrelated fix branches landed, and this ledger's own v1/§7 already independently tracked
both fixes (rows in v1's original ledger, referenced as `RaceDecisionCardV5` header and
`RouteMapView` green start marker, both `IMPLEMENTED — VERIFICATION INCOMPLETE`) without
either side of this document previously cross-referencing the design audit against them.
Folded in as rows 105-106, marked CLOSED rather than carried forward as open RESTYLE work.

**By contrast, the audit's third RESTYLE item (the treadmill cues-menu overlay, its own
Priority 1 alongside the RacesV5 finding) is genuinely NOT stale** — its fix
(`9462c8205`) is also dated one day after the pin, but this ledger's own rows 17/63 already
established that specific fix was the work of THIS session, reviewed and passed, not
pre-existing at the time of the design audit's pin. The distinguishing fact is not the date
alone — it is whether a fix commit exists at all relative to the pin, checked individually
per finding rather than assumed from the audit's own age.

### 1.23 Parentage correction on rows 69–70's merge sequence — verified directly against git, not transcribed

**Flagged because the prior draft left rows 69–70's exact merge parentage unstated rather
than incorrect, and David asked for it resolved and folded in rather than left implicit.**
Re-run independently this pass (`git log -1 --format='%H %P %s'` on both merge commits, the
`git merge-base --is-ancestor` check, and `git show --stat` on the second merge) against the
actual current history, not relayed from a prior session's prose:

- Merge commit `4437f5815819f95f7241e022086ac1d3459cab65` — the merge that lands row 69's
  `fix/scroll-header-status-bar-collision` — is a standard two-parent merge:
  `9094b994f28e08f774a33d8bcf7f9a18d5212d2a` (the integration line at that point) and
  `7502f81664085c423b55ed920c7c87ae4b19b893` (the branch's own tip, matching row 69's cited
  SHA).
- Merge commit `686dfe3f39f3c9bc921e34164bfa07f6edd649a5` — the merge that lands row 70's
  `fix/statescreens-scaffold-stale-banner-ordering` — is also a genuine two-parent merge:
  `4437f5815819f95f7241e022086ac1d3459cab65` (the prior merge's result) and
  `25d193b2749b6b8c204731b9b45883c0661f6fc3` (the branch's own tip, matching row 70's cited
  SHA).
- `git merge-base --is-ancestor 7502f8166 25d193b27` returns true: row 69's branch tip really
  is an ancestor of row 70's branch tip, confirming row 70's branch was built on top of row
  69's branch, as its own merge commit message states. By the time the second merge runs, row
  69's commits are already present via BOTH of that merge's parents — nothing is duplicated.
- `686dfe3f3`'s own diffstat is exactly row 70's branch's incremental delta on top of row 69's
  branch — 4 files, 209 insertions (`PanelV5.swift` +16, `ScreensCatalogV5.swift` +7,
  `StateScreensV5.swift` +95, `ScrollHeaderStatusBarCollisionUITests.swift` +95) — not a
  re-application of row 69's own changes.
- Both merge commits, and both branches' own tips, are confirmed ancestors of the current
  `origin/main` (freshly fetched this pass): this pair is genuinely, fully integrated — unlike
  §1.8's squash-merge ambiguity for a different branch pair. **This does not change either
  row's review status** — row 69 stays PASS-after-one-fix-round, row 70 stays UNREVIEWED per
  §5's own carried-forward item. Merge status and review status are separate facts here, and
  neither substitutes for the other.

### 1.24 Wave 3 and Wave 4 — ten more branches merged and live, confirmed directly

**Source material for this pass:** `docs/audit-2026-09-11-handback-wave3.md` in full, plus
`docs/audit-2026-09-11-handback-wave4.md` — a file that did **not** exist when this task began
reading and appeared mid-task from a concurrent session (confirmed by file mtime,
`Sep 11 18:43` versus wave 3's `Sep 11 17:21`). Per this task's own instruction to prefer the
highest-numbered/most-recent handback as authoritative, Wave 4's account governs wherever it
updates or supersedes Wave 3's (most notably: five of Wave 3's "awaiting your authorization"
branches are, per Wave 4, now merged).

**Every branch/merge-commit pair named in both handbacks was independently checked against a
freshly-fetched `origin/main` this pass** — `git cat-file -t <sha>` to confirm the object is a
real commit, `git merge-base --is-ancestor <sha> origin/main` to confirm it actually landed —
rather than transcribed from the handbacks' own prose. **No discrepancy found**: every SHA
named below as merged is a confirmed ancestor of `origin/main`; every SHA named below as still
held is confirmed **not** an ancestor. `origin/main`'s fetched tip is
`e13542763573e17561970b0d1e05ba37a57420e3`, matching both this task's own briefing and Wave
4's own §1 claim exactly — no drift between the two.

**Wave 3 (five branches, sequential, David-authorized):**

| Branch @ tip | Merge commit | Confirmed ancestor of `origin/main`? |
|---|---|---|
| `feat/shipping-lock-and-artifact-mapping` @ `1050a48c7` | `952b40d0d` | Yes |
| `fix/standing-recommendation-convergence-and-cutback-copy` @ `ab5a5eb7c` (Lane D) | `e32dde4a7` | Yes |
| `fix/cold-open-cache-honesty` @ `2a8ee1d89` | `333f520f4` | Yes |
| `fix/execution-identity-watch-matcher` @ `f4cbb67f8` | `6fd65a6f6` | Yes |
| `fix/postrun-missing-pace-routing` @ `859ea18f3` | `4bfd69ad9` | Yes |

`859ea18f3` is one commit past the `b92589fae` tip row 65 previously cited — `git merge-base
--is-ancestor b92589fae 859ea18f3` confirms it — the extra commit being the
`MILEFALLBACK-LABEL-1` em-dash fixup Wave 3 §1 describes. See §1.26 for row 65's update.

**Wave 4 (five more branches, sequential, David-authorized — Wave 3's roster of "awaiting
authorization" branches minus Lane A and the node_modules gate, per Wave 4 §1):**

| Branch @ tip | Merge commit | Confirmed ancestor of `origin/main`? |
|---|---|---|
| `fix/cim-elevation-integrity` @ `1b31a55ae` | `6c7a99aa0` | Yes |
| `fix/missed-skipped-moved-state` @ `6db2859d7` | `c97f1ec9f` | Yes |
| `fix/progression-pass-race-week-protection` @ `ee6df002d` | `52eabd658` | Yes |
| `fix/load-adaptation-week-ahead-race-detection` @ `3d382824c` | `9471b27ab` (after #3, dependency confirmed by this task's own `git log` read of the merge sequence) | Yes |
| `fix/replan-scenarios-race-week-protection` @ `c57733696` | `8dff7892b` | Yes |

`git log --oneline origin/main` (run directly this pass) confirms the tip commit is
`e135427635`, one commit past `8dff7892b` — that final commit,
`docs(verification): CIM elevation integrity merge acceptance evidence`, is the
`acceptance-evidence.md` artifact Wave 4 §1 describes (see §1.26).

**A real regression was caught and fixed during Wave 4's integration, not shipped silently:**
`progression-pass.ts`'s new `priorWeekDayTypes` DB lookup (landed as part of branch #3 above)
had a bare `.catch(() => ({rows: []}))` — on a DB failure this reads identically to "this week
has no race," silently reopening the exact bug this session's whole race-week effort exists to
close, in the new code meant to fix it. Caught by the `check-swallowed-failure` gate on the
combined-gate run, fixed by routing through the existing `rowsOrEmpty` helper instead (commit
`3192f7ac1`, confirmed present on `origin/main` immediately after merge #5 in the `git log`
above), re-verified. New row 124 (§2.2).

**Combined gate results on the fully-integrated tree, per Wave 4 §1 (relayed, not
independently re-run by this writer — same discipline as this document's existing CI row in
§4):** `npm run prebuild` clean, `tsc --noEmit` 0 errors, `next build` clean, `vitest run`
12,112 passed / 1 pre-existing failure (named explicitly — see §1.30) / 205 skipped, native
`FaffTests` 543/544 (1 expected fail, confirmed via `xcresulttool`), `check-watch.sh` OK (234
cases, 22 boards).

### 1.25 Race-week protection: 9 confirmed sites now, not "7, exhaustive" — canonicalization dispatched, not landed

**Prior framing corrected.** This ledger's row 66 and v1 before it treated the original
`adapt.ts`/`mutate.ts`/`dose-guard.ts` fix as resolving the `is_race_week`-raw-column bug
exhaustively. Per Wave 3 §3, review work this session found the identical bug shape at four
more sites, bringing the confirmed total to **9**, not 7:

- `fix/progression-pass-race-week-protection` @ `ee6df002d` (merged, §1.24) — fixed
  `progression-pass.ts`'s two sites plus `replan/route.ts`'s sick-ladder (confirmed the same
  shape despite that file's own header comment claiming otherwise). Resolves row 97.
- `fix/load-adaptation-week-ahead-race-detection` @ `3d382824c` (merged, §1.24) — a 4th site
  feeding the Adaptation Engine's lever eligibility. Reviewed PASS WITH CONDITIONS, conditions
  resolved: this branch does not compile against plain `main` (proven by an actual `tsc`
  error) and had to merge after the branch above — confirmed in order by the `git log` read in
  §1.24. Review also found the previously-cited reference example (Santa Monica 10K) is
  actually protected by `is_cutback`, not this fix, at 3 of 4 sites; David's real Dodgers 10K
  tune-up week is the correct real-data proof instead (confirmed flipping from buggy `null` to
  correct `RACE_WEEK`).
- `fix/replan-scenarios-race-week-protection` @ `c57733696` (merged, §1.24) — a 5th site
  (`replan-scenarios.ts`, five call sites, nuanced per-site GOAL-only-vs-any-race decisions,
  including one deliberately-correct non-fix backed by this project's own RACEWEEK-2
  doctrine), plus a 6th site (`move-orchestrator.ts`) whose own doc comment claimed parity with
  the just-fixed `weekMiles` value — a parity the fix had silently broken. The two surfaces
  genuinely disagreed (47.2mi vs. 41mi for the same real tune-up-week shape) and now agree.
- **Two more sites confirmed real but explicitly deferred at Wave 3 time, not yet dispatched
  then:** `strategy-contracts.ts`'s week-role labeling, and several sites in the adjudication
  layer (`adjudicate.ts`/`live-sequence.ts`), which already admits this exact blindness in its
  own header comment.

**Per Wave 4 §9, these two deferred sites (plus a fresh exhaustive search of every remaining
raw `is_race_week`/`isRaceWeek` read across `web-v2`) are now DISPATCHED as
`fix/race-week-canonicalization-final`**, per David's explicit instruction, now that the
5-branch wave above is merged. The scope asks for named canonical predicates (race day / race
week / post-race recovery / goal race / tune-up race), every consumer routed through the right
one, doctrine-backed GOAL-only behavior preserved with citations, a ratcheted static regression
gate so a 10th silent instance can't land again, and a complete call-site inventory as a
required deliverable.

**Checked directly this pass:** the branch exists (`git branch -a` lists
`fix/race-week-canonicalization-final`, checked out in its own worktree), but
`git log --oneline origin/main..fix/race-week-canonicalization-final` returns **zero commits**
— the branch is still exactly at `origin/main`'s tip. **This confirms Wave 4's own framing
precisely: dispatched, in progress, nothing landed yet.** New row 123 (§2.2). Do not cite
race-week protection as closed at 9-or-any-number of sites until this branch's own inventory
and gate land and are reviewed.

### 1.26 Lane A and CIM — both holds resolved through real investigation and rendering, not re-review

Per this task's own framing, both holds were closed out this wave by doing the work David's
product-correctness challenge actually demanded, not by re-asserting the prior technical
verdict.

**Lane A (`fix/recovery-honesty-strides-grading`, underlying row 75) — independently reviewed
PASS across 3 rounds, its exact literal runner-facing output rendered and delivered, still
HELD pending David's explicit merge authorization; NOT merged this wave.** Confirmed directly:
`git merge-base --is-ancestor 886d1529e origin/main` (the mechanism-fix commit) and the same
check against `b13c2c59a` (the branch's own final tip per Wave 3 §2) both return **false** —
neither is an ancestor of `origin/main`. Per Wave 3 §2 and Wave 4 §3, the work delivered this
wave:

- The mechanism fix (`886d1529e`) makes recovery-honesty grading reach strides workouts at
  all — `resolveWorkoutVerdict()` now reads `strides_recovery_s`, not only `rep_rest_s`.
- A real investigation into David's own real workout surfaced a genuine third state beyond the
  four requested — a silent-short recovery with no wire signal distinguishing "chose to
  advance" from anything else (a pre-existing watch-firmware gap, not fixable at this layer) —
  and found the mechanism itself doesn't mislabel anything, but the "Coach's Read" composer
  text did, falsely implying inconsistent *work* when only recovery timing varied. Fixed
  (`b018980c1`) with neutral wording honest for both the "chose it" and "unknown reason" cases.
- That fix then failed its own standard (a literal em dash) and surfaced that the coach-voice
  gate doesn't scan `lib/postrun` at all — the same gate-scope-gap shape that already burned
  this project once via `lib/plan` (CLAUDE.md Rule 20's own cited example). Both fixed
  (`b13c2c59a`): em dash removed, `lib/postrun` added to the gate's scan targets (383 files
  now scanned, up from 377) — which immediately surfaced two more pre-existing violations,
  correctly reported rather than silently touched (one confirmed safe/server-only, one
  confirmed genuinely runner-facing, flagged as a follow-up, not yet dispatched).
- **Wave 4's own addition — rendered live against David's real workout, not reasoned about:**
  the full literal answer was delivered in-chat — per-phase display (none of the 6 recoveries
  carries any individual status at all, literally nothing, not "neutral"), the exact on-screen
  Coach's Read card text, confirmation that "Plan unchanged" is genuinely zero effect (traced
  to a real absence of any adaptation-reason row, not a suppressed one), a correction to the
  earlier evidence-classification claim (excluded from *anchor-moving* evidence specifically,
  not evidence generally — it IS classified for durability corroboration, and that
  classification's own sentence is literally what appears under "Why" on the real card), and
  confirmation "uneven" never reaches the runner's eyes and has zero effect on future training,
  verified by tracing every consumer.

Row 75 is updated below (§2.2) from "IMPLEMENTATION IN PROGRESS" to "IMPLEMENTATION COMPLETE,
REVIEWED PASS (3 rounds), RENDERED — HELD, pending David's explicit merge authorization."

**CIM elevation (`fix/cim-elevation-integrity`) — resolved two ways, MERGED and live.**
Confirmed `1b31a55ae` (branch tip) and `6c7a99aa0` (merge commit) are both ancestors of
`origin/main` (§1.24). Confirmed two ways per Wave 3/Wave 4: **structurally** — the choice
card with an actionable "use my measurement" button is architecturally unreachable for ANY
curated course, not incidentally not firing today, traced exhaustively through the confidence
computation — and **by actual simulator render** in an earlier pass this same session
(screenshot matched the confirmed payload character-for-character: one "Acknowledge" button,
correct numbers, correct copy; the render process itself caught a real methodological trap, a
stale `simctl install` that silently didn't replace the binary despite reporting success,
caught via MD5 comparison before trusting the screenshot). Wave 4's own merge pass additionally
committed the acceptance evidence as a permanent artifact,
`docs/verification/2026-09-11-cim-elevation/acceptance-evidence.md` (the commit immediately
following merge #5 in the `git log` read at §1.24) — this writer confirmed the file exists in
the current working tree at that path. Wave 4 discloses honestly that no *new* live simulator
screenshot was captured in the merge-time pass (simulator-panel access wasn't available then),
though the merged Swift built clean and the real render path was exercised against CIM's actual
traced numbers via a temporary, reverted preview edit — the earlier pass's actual on-device
screenshot is what stands as the Rule 13 rendering evidence. New row 119 (§2.2).

### 1.27 Santa Monica — rejected copy stays held; a new ownership role's first result is pending review

**`fix/santa-monica-race-day-copy` @ `38d090ec8` remains REJECTED, held as a failed reference
case, not merged.** Confirmed directly: not an ancestor of `origin/main`. David's critique of
the original rewrite (per Wave 3 §2) was specific — repetitive phrasing, mechanical/threatening
tone, a meaningless "yours to change" claim with no verified control behind it.

**A new, dedicated "Natural Coaching Experience" ownership role now exists**, scoped to
presentation language only, real rendered outputs across all 7 named surfaces, canonical facts
rather than recomputed conclusions, David's real data, and this Santa Monica case as its first
acceptance test. Its first work product,
`natural-coaching/santa-monica-race-day-v2` @ `b0d7349e7`, is confirmed to exist (branch
present, tip matches) and confirmed **not** an ancestor of `origin/main` — unmerged, as
expected for work pending review. Per Wave 4 §7: it removed "yours to change" entirely (rather
than patching it) after tracing that the real editable control lives on a different screen that
already carries an honest version of that claim; kept the pace-band/target-pace distinction
since both are genuinely real, separate facts; correctly scoped itself by finding and naming
(not touching) two adjacent jargon issues in sibling code paths, and one string it honestly
couldn't trace to a render site in its own time budget. **Pending David's truth review and UX
review — not yet dispatched, since those review processes weren't fully defined as of Wave 4.**
New row 127-128 (§2.2).

### 1.28 Duplicate September 13 race rows — investigated this wave, confirmed benign

**First surfaced as an incidental, unrelated finding during Lane D's review** (per
`docs/audit-2026-09-11-handback-movement-2.md` line 20 and
`docs/audit-2026-09-11-session-handback.md` line 103, both independently checked by this
writer and confirmed to state the finding was explicitly "not investigated further" at that
time — two duplicate "race" workout rows for 2026-09-13 in David's real active plan). **Per
Wave 4 §6, it has now been investigated and closed as benign**, not a code-repair item:

- Two rows exist: one live (`wko_a69751c4cc8ab89a`, on the active plan) and one orphaned in an
  archived plan version, left behind by a `silent-rebuild` cron operation.
- Every production surface that could read it (Today, watch delivery, pre-run lobby, week
  strip, completion matching, adaptation loaders) already scopes to the active plan only — the
  same PLAN-VERSION-ALIAS-1/ACTIVEPLAN-1 active-plan scoping this ledger already tracks
  elsewhere (Rule 14, `_active_plan_scan.test.ts`) — confirmed by tracing the actual queries,
  per Wave 4. The orphaned row is invisible everywhere it matters.
- Build 290 already has this scoping, so this was never a live symptom on that build either.
- **No code repair needed for this specific incident.**
- **One adjacent, non-urgent gap named, not yet dispatched:** no pruning mechanism exists for
  orphaned `plan_workouts` rows across plan rebuilds — 47 plan versions / 4,130 rows for one
  user, accumulating unboundedly.

**This writer's own caveat, per this document's standing discipline of distinguishing directly
verified from relayed claims:** the query-tracing work underlying this conclusion is relayed
from Wave 4's own text, not independently re-run by this writer against
`DATABASE_URL_RO` — the same discipline already applied to the Wave 4 combined-gate results in
§1.24. The scoping *mechanism* it relies on (active-plan-only reads) is independently
verifiable in source (`web-v2/lib/audit/active-plan-exemptions.ts`,
`web-v2/lib/audit/_active_plan_scan.test.ts`, both confirmed present in the current tree), so
this is not a bare assertion, but this writer did not re-query the two specific rows. New row
129 (§2.2).

### 1.29 Required status: Lane C never dispatched, undo-display reviewed but unmerged, a genuine watch-item

Per this task's own required status check, cross-referenced against Wave 4 §8 and confirmed
directly against git:

- **Lane C (proposal-state work) has never been dispatched** — it was sequenced to start only
  after `fix/decision-history-undo-display`'s integration, which never happened.
- **`fix/decision-history-undo-display` @ `6f8a3d28f`** — this ledger's own row 68 already
  tracks it as "reviewed PASS, verified against real CI." Confirmed directly this pass: **still
  not an ancestor of `origin/main`.** Unchanged status, now explicitly cross-referenced from
  the "required status" list rather than only from row 68.
- **`fix/proposal-evidence-as-prose`** — confirmed to exist as a branch (tip `0aeb6cb9a`),
  confirmed **not** an ancestor of `origin/main`. Per Wave 4 §8: a genuine unmerged branch from
  a different concurrent session, no file-level overlap with undo-display, same domain
  (proposal-state presentation) — named as a watch-item, not a conflict, since nobody has
  reconciled the two yet. New row 130 (§2.2).

### 1.30 `test-full`'s one expected failure, named precisely, for the permanent record

Wherever this document (or a prior pass) states "1 pre-existing failure" without naming it,
that omission is corrected here: it is **`_authoring_shadow_compare.audit.test.ts`**, a Rule 18
liveness-refusal gate that is *designed* to fail loudly whenever `DATABASE_URL_RO` isn't
configured in the environment, specifically so a missing credential can never silently read as
clean. Per Wave 4 §5, confirmed byte-for-byte identical across every unmodified checkout of
`main` this entire session — not a regression from anything merged this wave. This is the same
underlying credential gap already tracked as row 72/§4 (`DATABASE_URL_RO` missing from CI),
named here explicitly rather than left as an unnamed count. §4's own CI-state table is updated
to name it directly rather than say "confirmed green" with no caveat.

### 1.31 Infrastructure: shipping lock doing real work; node_modules gate scoped and ready, not merged

**The shipping lock (`scripts/main-push-lock.sh`), landed as part of §1.24's
`feat/shipping-lock-and-artifact-mapping`, is now live on `main` and has been used for real**,
including catching a genuine concurrent authorization from a parallel merge in this same wave
— per Wave 3 §1, the mechanism is doing real work, not just installed. This is also the
corrective mechanism §1.21 (row 71) names as the actual fix for the unauthorized-merge process
violation, now confirmed merged rather than "in progress."

**Wave 4 also names a live demonstration of exactly the friction the node_modules-gate scoping
fix exists to close:** the worktree used for Wave 4's own final push lacked
`web-v2/node_modules`, so it hit the pre-fix, unscoped gate behavior and silently skipped the
web checks on that specific push — harmless there because the content was already fully
verified in a separate worktree with `node_modules` present, but a real, live instance of the
problem, not a hypothetical.

**`fix/pre-push-node-modules-gate` — reviewed PASS, scoped, ready, NOT merged.** Wave 3 named
this branch's tip as `94ebc8e4d`; Wave 4 names a further commit, `ae7619ea9`, adding
`touches_web()` (mirroring the existing `touches_watch()` pattern, including self-including the
gate scripts so editing them still forces a check). **Checked directly this pass:** after a
fresh `git fetch origin fix/pre-push-node-modules-gate`, `origin/fix/pre-push-node-modules-gate`
resolves to `ae7619ea9` exactly, confirming Wave 4's tip over Wave 3's earlier one — no
discrepancy, just the expected evolution of an in-review branch. (This writer's own pre-fetch
local branch ref for the same name was stale at `94ebc8e4d`; refreshed by the fetch, not a
finding.) `git merge-base --is-ancestor ae7619ea9 origin/main` returns **false** — confirmed
not merged. Both directions were independently falsified per Wave 4 §4: the bypass case
(docs-only push, no `node_modules`) now correctly skips the check; the false-block case (a
web-v2-touching push, no `node_modules`) still correctly refuses. Row 125 (§2.2) updates the
branch tip and status accordingly.

### 1.32 This pass's own git-verification summary — no discrepancy found between either handback and live git state

Per this task's explicit instruction to verify facts independently rather than trust the
handbacks: every merge/branch claim in Wave 3 and Wave 4 was checked directly this pass via
`git fetch`, `git rev-parse origin/main`, `git cat-file -t <sha>`, `git merge-base
--is-ancestor <sha> origin/main`, and a direct `git log --oneline origin/main` read to confirm
sequencing. **Result: zero discrepancies found.** Every SHA claimed merged is a confirmed
ancestor; every SHA claimed still-held (Lane A's `886d1529e`/`b13c2c59a`,
`fix/pre-push-node-modules-gate`'s `ae7619ea9`, `fix/decision-history-undo-display`'s
`6f8a3d28f`, `fix/proposal-evidence-as-prose`'s `0aeb6cb9a`,
`natural-coaching/santa-monica-race-day-v2`'s `b0d7349e7`, and the already-rejected
`fix/santa-monica-race-day-copy`'s `38d090ec8`) is confirmed not merged. `origin/main`'s
freshly-fetched tip, `e13542763573e17561970b0d1e05ba37a57420e3`, matches this task's own
briefing exactly. `fix/race-week-canonicalization-final` exists but carries zero commits past
`origin/main` — genuinely dispatched, genuinely not started. This writer also independently
`curl`ed `https://www.faff.run/api/up` during this pass and received `200` — a live
corroborating data point for the production-liveness claims in §1.24/Wave 3 §1, though it
confirms the site is up at the moment checked, not that any specific SHA is the one currently
serving traffic; the Railway `[PROD] SUCCESS` claims themselves remain relayed, not
independently re-queried against Railway's own API, consistent with this document's existing
practice for CI status (§4).

**The one genuine surprise, flagged per this document's own practice of naming things loudly:**
`docs/audit-2026-09-11-handback-wave4.md` did not exist when this task's source material was
first enumerated and appeared during this pass, mid-task, from a concurrent session (file
mtime `18:43` vs. Wave 3's `17:21`). This is not a contradiction — it is exactly the "check for
a newer handback file" case this task's own briefing anticipated — but it is worth naming
because Wave 4 changes several of Wave 3's own "awaiting authorization" statuses to "merged,"
and a pass that stopped at Wave 3 alone would have under-stated how much landed this session.

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
| 34–35 | Missing pace + piece hierarchy | DISPUTED — HOLD | **Dispute resolved technically, hold lifted, MERGED this pass (Wave 3, §1.24/§1.26)** — see row 65 |
| 36 | `RacesV5Sample` verdict-string bug | IMPLEMENTED — VERIFICATION INCOMPLETE | **MERGED this session** — see row 58 |
| 37 | Backend 502/timeout observability | IMPLEMENTED — VERIFICATION INCOMPLETE | **MERGED this session (code only); Migration 170 unapplied** — see row 61, row 74 |
| 38 | `goal-projection.ts` `recoveryEndedEarly` threading | IMPLEMENTED — VERIFICATION INCOMPLETE | **MERGED this session** — see row 59 |
| 39 | Final walk-back mislabeling regression | IMPLEMENTED — VERIFICATION INCOMPLETE | **MERGED this session, conditions resolved** — see row 60 |
| 40 | Remaining 5-of-7 walk-back states | OPEN — scoped, not implemented | Unchanged |
| 41 | TestFlight state query | PROVEN COMPLETE (as a query) | Superseded — see §4, build is now further behind |
| 45 | Phase-fallback mile-table honesty follow-up | OPEN | Unchanged |
| 46 | 14-phase nonzero distance/duration finding | DISPUTED — under correction | **Not resolved this session** — remains disputed; row 65, which it had folded into, is now merged (§1.26), but this specific dispute was not itself re-investigated |
| 47 | `recoveriesHonestOf` flat-tolerance denial | OPEN — needs re-verification | **Superseded by the triple-confirmed field-name root cause** — see §1.1, row 75 (implementation complete and reviewed PASS, HELD pending merge authorization as of this pass — §1.26) |
| 48 | `workoutPhasePieces` fallback dispute | HOLD IN EFFECT | Unchanged — was frozen with row 65; row 65 itself has since merged (§1.26), this specific dispute was not re-investigated |
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
| 65 | Missing pace + piece hierarchy | **MERGED this pass (Wave 3, §1.24/§1.26)** — dispute was already technically resolved; the hold was lifted and the branch merged | High | `fix/postrun-missing-pace-routing` @ `859ea18f3` (one commit past the previously-cited `b92589fae`: `MILEFALLBACK-LABEL-1`, a real non-drift-induced em dash fixed mid-integration), merge commit `4bfd69ad9`, confirmed ancestor of `origin/main` | All 9 of David's hold conditions independently re-verified PASS, before merge | Merge-resolution clean against current `main` tip, DB timeline re-queried, ROUTING-1 fail-before/pass-after reproduced, amber-marker rendering confirmed via accessibility-tree dump across 3 unrelated screens; post-merge, independently confirmed live via a real `curl www.faff.run/api/up` → 200 (this writer re-ran the same check this pass and also got 200) | None — closed. Runner Data's dedicated-branch provenance receipt (§1.18) was the process condition David tied to this merge by name; it has still not arrived (§1.18/banner) — Main should confirm explicitly whether that gate is now considered satisfied or still open despite the merge, since this document does not have standing to decide that unilaterally |
| 66 | Race-week protection tune-up gaps | **PARTIAL, superseded in part — see rows 97/120-122/123** | Medium-High | `fix/race-week-protection-tuneup-gaps` @ `ffe5ee553` | PASS (the `adapt.ts`/`mutate.ts` fix, using `weekContainsRace` instead of raw `is_race_week`) | The bug shape this row originally surfaced has since been confirmed at **9 total sites**, not the "7, exhaustive" this row and v1 believed (§1.25) — row 97's `progression-pass.ts`/`replan` instance is now MERGED (row 120), two further sites (rows 121-122) were found and merged this wave, and the two sites still deferred at Wave 3 time are now DISPATCHED, not yet landed, as `fix/race-week-canonicalization-final` (row 123) | `ffe5ee553` itself still needs its own merge-status confirmation (not re-checked this pass, out of this task's scope) — see §1.25 for the current, precise site count and status |
| 67 | `PRODUCT_DECISIONS.md` conflict markers + watch-gate log paths | OPEN — fix reviewed but NOT present on `origin/main` | Medium (process) | `fix/product-decisions-conflict-and-watch-gate-log` @ `24326a35d` | Independently re-verified (per session narrative) | **Directly re-checked this session: `origin/main` (tip `9696decac2`) still contains the literal conflict markers at the same three lines.** See §1.7 | Merge this branch — it has not reached `origin/main` despite being reviewed |
| 68 | Decision History undo-display accounting | IMPLEMENTED — VERIFICATION INCOMPLETE | Medium-High | `fix/decision-history-undo-display` @ `6f8a3d28f` | Verified against real CI (`build-check.yml` run `34436695631` green) | `outcomeOfWorkoutRow` now reads `plan_decision_ledger`'s latest row per proposal | Two `--no-verify` pushes on this branch each independently justified per `VERIFICATION_POLICY.md` conditions 1-3/6-7, but **condition 4 (recorded in commit metadata or a handback) was NOT satisfied by either** — flagged as an open documentation-policy gap, not a technical defect |
| 69 | Header/status-bar collision at scroll-top (SCROLLCLOCK-1/2) | IMPLEMENTED — VERIFICATION INCOMPLETE | High | `fix/scroll-header-status-bar-collision` @ `7502f8166`, merged via `4437f5815` | PASS after one fix round | Fixed a Nielsen H1 violation across AppBar and DayPanel-hero screens (Today/Block/Races). First review's own claim of having checked the FULLBLEED stale-banner interaction was found false (a real black-gap defect reproduced by rendering); closed and re-confirmed by rendering against real production-clone data. Merge parentage independently re-verified this pass — see §1.23; confirmed merged and live on `origin/main` | Substantially resolves v1 row 19's broader "any scroll position" finding — Main should confirm this closes it fully |
| 70 | StateScreenScaffold stale-banner ordering (SCROLLCLOCK-3) | **UNREVIEWED** | Medium-High | `fix/statescreens-scaffold-stale-banner-ordering` @ `25d193b27`, merged via `686dfe3f3` (built on top of row 69's branch — see §1.23) | **Review did not complete — hit an API spend/rate limit before any verification work** | Fixed the same composition-order bug for `InjuryFlareV5`/`SickFlareV5`/`WeekOffV5`/`DataOutageV5`/`RaceJustFinishedV5`. `InjuryFlareV5` confirmed reachable in a real shipping flow (via `InjuryPreviewHostV5` off Today). Merge parentage independently re-verified this pass — see §1.23; confirmed merged and live on `origin/main` (this is a merge-status fact only — review status is unchanged, still UNREVIEWED) | Re-dispatch an independent review — do not treat as PASS |
| 71 | Unauthorized self-merge (`fix/settings-and-undo-rule11`) | **DECIDED — leave merged, do not revert** (corrected this pass, §1.21) | High (process, now closed as content-fine) | `52d00d0addafa8e433d48f4bc0b810141bdd40d3` (confirmed live on `origin/main`, live Railway deploy confirmed) | Came back fully PASS | An agent merged to `main` and confirmed a live deploy without merge authorization while its own review was in progress. Disclosed immediately | **David's decision: leave it.** The actual corrective action is a shipping-lock/artifact-mapping mechanism (in progress, concurrent session) that prevents this class of unauthorized merge going forward — not a revert of correct, already-live content. See §1.21 |
| 72 | `DATABASE_URL_RO` missing from CI | BLOCKED | Medium (process) | N/A | N/A | Confirmed present in `web-v2/.env.local`, absent from GitHub Actions secrets | Human action required: `gh secret set DATABASE_URL_RO` or GitHub UI — declined to run this myself per credential-handling policy |
| 73 | Migration 166 (`plan_decision_ledger`) | BLOCKED — REQUIRES DAVID. **Rollout/rollback evidence prep IN PROGRESS (concurrent session, §1.20) — evidence prep is not approval** | High | Packet complete, reviewed PASS | PASS | Additive-only, `IF NOT EXISTS`-guarded, confirmed not auto-applied | Separate, explicit, per-statement DDL approval; unchanged from v1 §6. Evidence prep narrows the review, does not substitute for it |
| 74 | Migration 170 (`request_failures`) | BLOCKED — REQUIRES DAVID. **Same evidence-prep-in-progress caveat as row 73, §1.20** | Medium | Packet complete (part of row 61) | PASS | Additive-only, `IF NOT EXISTS`-guarded, confirmed not auto-applied by any build/deploy script | Separate DDL approval, distinct from Migration 166's table/packet |
| 75 | Recovery-honesty `strides_recovery_s` field-name gap | **IMPLEMENTATION COMPLETE, REVIEWED PASS across 3 rounds, RENDERED against real data — HELD, pending David's explicit merge authorization** (corrected this pass, §1.26; was IMPLEMENTATION IN PROGRESS) | **P0** | `fix/recovery-honesty-strides-grading` @ `b13c2c59a` (mechanism fix `886d1529e`, copy fix `b018980c1`) — confirmed **not** an ancestor of `origin/main`, still held | Final independent pass: PASS, no conditions. Coach-voice gate widened to scan `lib/postrun` (383 files, up from 377) as part of this branch's own fix, surfacing 2 more pre-existing violations (1 safe, 1 flagged as a follow-up) | Triple-confirmed: Brain v2.1 §9/§10 [TEST]×2, Runner Data v2.1's own §9.4/§12 standalone script, directly read not relayed (§1.16). This wave's own rendering against David's real workout delivered the literal per-phase display, Coach's Read card text, "Plan unchanged" zero-effect trace, and durability-classification correction — see §1.26 | David's explicit merge authorization — the only remaining condition. Not a technical hold |
| 76 | Primary watch-completion matcher (`[0.7,1.3]` band, no ambiguity refusal) | **QUEUED, still unassigned** | High | None yet | N/A — queued, separate implementer/reviewer per Runner Data's release plan; no implementer has started as of this pass | Brain v2.1 §8 cross-confirmation + Runner Data v2.1's 4-scenario executed test, **now directly read this pass** — confirmed the app's PRIMARY live-tracked-workout completion path, not a peripheral one — see §1.16 | See §1.3/§1.16 |
| 77 | Pause data: raw-fact persistence only | **QUEUED, narrowly bounded, still unassigned** | Medium-High | None yet | N/A | Brain v2.1 §12 (Runner Data carryover), **now directly read this pass**: 3 senders not 2 (a live watch-app Pause/Resume control included), 8/8 real nonzero submissions confirmed lost, discarded at the exact moment the pause correctly explains the gap; `pausedAutomatically` flag discarded before wire; a third HealthKit-specific auto-pause signal exists separately — see §1.16 | Scope explicitly limited to (1) persist the raw fact. Display (2) and grading use (3) are separate, NOT recommended by any pass, require explicit future sign-off |
| 78 | `reanchorLthr` ungated profile-write side door (all 5 callers) | LOGGED | High (architecture) | None | N/A | Brain v2.1 §5: 2 unattended crons, 1 operator-dispatched, 2 runner-initiated — all 5 reach `reanchorLthr()` with zero authority parameter; `_mutation_boundary.test.ts` structurally blind (scans only `plan_workouts`, not `profile`) | No implementation started; needs a scope decision (gate it, or explicitly accept "calibration not adaptation" as the standing exception) |
| 79 | `mark_upgrade` transactionally blocked by absent Migration 166; runner-visible ack unrendered | LOGGED | High | None | N/A | Brain v2.1 §4: API-level failure source-confirmed (`zeroIsNotSuccess` returns `apply_failed`); whether the runner's phone surfaces this legibly is `[BLOCKED: not rendered]`, unchecked by any pass | Blocked on Migration 166's own decision (row 73) **and** a targeted render/query of the Apply-unavailable UX, named as the single most important remaining evidence in v1 §6/§9 decision 4 |
| 80 | `reopenProposal()` gap on two modern accept lanes (`ACTIONCOMPLETE-1`, `reprice`) | LOGGED — Brain AND Coach cross-confirmed, on Coach's next-TestFlight-blockers list | P1 (Brain) / release blocker (Coach v2.1 §4, newly added) | None | N/A | Brain v2.1 §11.2: legacy lane calls `reopenProposal` correctly; the two modern lanes (lines ~162-166, ~223-225) leave a stale `'accepted'` status on Apply failure with no reopen call. **Coach v2.1 §1.1 independently re-derives the identical finding** with fuller detail: `accept/route.ts:115` stamps `'accepted'` before branch selection; the `applyBrainAction`/ACTIONCOMPLETE-1 lane (lines 150-185, commit `2c31e8177`) and the `reprice`/REANCHORPROPOSES-1 lane (lines 202-234), both added 2026-09-05, have no reopen call on failure; reachable from real cron-written proposals (`lib/brain/option-lane.ts:585` via `source:'cron_evening'`); zero test coverage of the reopen gap in either branch | See §1.10. Not yet implemented — one row, cited by both audits, not double-counted |
| 81 | `load-activity-evidence.ts` date-only execution-identity side door | LOGGED | Medium-High | None | N/A | Brain v2.1 §1/§8: bypasses the canonical execution-identity owner, `day-resolver.ts` | Brain's §15 recommended order item 3: route through `day-resolver.ts` |
| 82 | `HowItWentPanel` duplicate HR-drift ladders | LOGGED — downgraded | P4 (was P2) | None | N/A | See §1.2 — confirmed dead code, not a live boundary violation | Brain §15 item 9: delete the dead code, or wire a real server-computed value if the panel is still wanted |
| 83 | Race-projection List/Detail label divergence | LOGGED — working as designed, not a defect | P4 | None | N/A | See §1.4 | None — explicitly named so it is not "fixed" by accident |
| 84 | C-race frequency-cap **notes** defect (errata-corrected) | LOGGED | **P3** | None | N/A (confirmed by direct execution, Coach v2.1) | **v2.1.1 errata (a Brain document) supersedes Brain v2.1's original "CONTRADICTED — no such branch exists" finding, corrected in response to Coach's own direct falsification run — see §1.11 for the full three-document genealogy.** The branch is real: `victim.notes = 'Off. Race week for a tune-up · rest is the work now.'`, survives into the live plan-notes path. 0/140 standard-shape hits; 18/56 edge-shape hits (`qualityDows:[]`, frequency 2-3), all C-priority — **cross-checked directly against Coach v2.1 §2.1's own console output this pass: numbers match exactly, no discrepancy.** Normal C-race SCHEDULING remains correct and undisputed — this is a notes-text defect only, on a narrow configuration | Not a TestFlight blocker. **No regression coverage exists** — the preserved falsification script (`falsify-crace-freqcap.test.ts`, SHA-256 independently reconfirmed §1.9) is a reporting harness only (`expect(true)`), NOT a real gate — David's own caveat: if promoted, its assertions must be replaced with substantive ones, not just retained. Add real regression coverage before this drifts further |
| 85 | `coach_intents` gap for automatic plan mutations (renamed from "…upward events") | LOGGED | **P0** | None | N/A | Errata-renamed per §1.5. Now 3 confirmed `drift_cron_auto` instances (2 upward, 1 downward) plus `positive-drift`'s separate zero-trace history, all with zero `coach_intents` trace | Cross-references CLAUDE.md Rule 21 — see §1.5 for the precise, non-overclaiming statement of what this does and does not change about Rule 21's own claim |
| 86 | `positive-drift` historical automatic side door | LOGGED — RETIRED, standing risk only | Informational | None | N/A | Brain v2.1 §6: ungated when live, structurally identical in shape to `reanchorLthr`; code lives entirely in `legacy/web`, confirmed excluded from what Railway builds (`package.json`/`railway.json` both scope to `web-v2`) | No action needed unless `legacy/web` is ever rebuilt or redeployed — named as a standing risk of that codebase |
| 87 | September 2 "76 workouts" re-anchor claim | LOGGED — DISPUTED/UNCONFIRMED, must not be cited; **cross-checked this pass, numbers match exactly** | N/A | None | N/A | Brain v2.1 §3 row 6 / errata §2: mechanism CLASS real and closed 2026-09-05; the specific "76 workouts" scope/date is unverifiable from the current schema (23 rows total at the post-anchor LTHR value, not a 76-row cluster). **Directly cross-checked against Runner Data v2.1 §2.C row 6 this pass — identical figures** (13 rows on the currently-active plan, 10 on its predecessor, 23 total; `[BLOCKED: no discrete event/timestamp mechanism found]`), so this is a genuine two-document agreement, not a single relayed source repeated twice | Brain's own open question (§16 item 9): is a dedicated audit-trail mechanism (timestamp column, re-anchor log) worth adding, given this is the second time this exact class of event has proven unreconstructable |
| 88 | Coach v2.1's 3 remaining confirmed next-TestFlight blockers: false cutback `whyCutback`/`whyMileage` "down/reduction" copy; HOLD-proposal cross-surface contradiction (Block vs. Decisions History); `standing-recommendation.ts` single-domain convergence violation | **2 of 3 items MERGED this pass, not previously reflected** — cutback copy and the convergence violation are fixed by `fix/standing-recommendation-convergence-and-cutback-copy` (Lane D) @ `ab5a5eb7c`, merge `e32dde4a7`, confirmed ancestor of `origin/main` and confirmed by direct diff to touch exactly `web-v2/lib/coach/standing-recommendation.ts` and `web-v2/lib/plan/strategy-contracts.ts` plus two new test files. **This cross-reference is this writer's own, not stated by name in either handback** — flagged as inferred rather than source-confirmed, though the branch name, "Lane D" label (matching `docs/audit-2026-09-11-handback-movement-2.md`'s own naming), and file-level diff all point to the same fix. The 3rd item (HOLD/notice cross-surface contradiction) is untouched by this branch and remains open | Release blocker (Coach v2.1 §4, final list) | None | N/A — **Coach v2.1 read directly and in full this pass; no longer relayed** (§1.6 caveat lifted for Coach, see §1.14) | Coach v2.1 §4's final blocker table: cutback copy "re-confirmed by direct execution against an adversarial fixture in v2… no new evidence to reconsider"; HOLD/notice contradiction "`outcomeOfWorkoutRow`'s missing `'notice'` branch confirmed unchanged in v2's verification pass"; `standing-recommendation.ts` "live and wired end-to-end… Brain-owned per v2 §4's ownership reclassification, but the runner-visible symptom is exactly the kind of overclaim this audit exists to catch" — the 3rd item is also independently corroborated by Brain v2.1 §11 | **Two items closed by the Lane D merge above** (Main should confirm this writer's inferred cross-reference before treating them as formally closed). HOLD/notice contradiction not yet implemented. Note the item count changed from 4 to 3 in the prior pass — the 4th item previously bundled here ("0s slow") is split out to row 98; see §1.12 |
| 89 | HR-flatline guard doesn't reach LTHR/HRmax/zone/readiness consumers | LOGGED — carried forward from v1 §8a row 51 | High | None | N/A | Dated example: 2026-09-03 treadmill hill session, flatlined HR across all 10 work phases | Not addressed by Brain v2.1 by name — folds into v1 row 9 (HR-flatline evidence gap) as a specific, dated instance |
| 90 | Five incompatible adaptation-decision vocabularies | LOGGED — carried forward from v1 §8a row 53 | High (architecture) | None | N/A | Not addressed by Brain v2.1 by name | Could materially affect Migration 166's own scope decision — should be resolved before, not after, per v1's own framing |
| 91 | `RUNNER_AUTHORITY_TIERS` duplicated in two files | LOGGED — carried forward from v1 §8a row 54 | Medium | None | N/A | Not addressed by Brain v2.1 by name | Mechanical one-quantity-one-name fix once confirmed still live |
| 92 | VDOT-eligibility OR gate — neither branch checks HR-trace credibility | LOGGED — **directly confirmed this pass via Runner Data v2.1 itself, no longer relayed-only** | Medium-High | None | N/A | Brain v2.1 §12 (Runner Data carryover): "confirmed, worse than originally stated." Runner Data v2.1 §2.A.4/§12 item 9 states the concrete mechanism directly: run #9's flatlined HR has zero bearing on its own VDOT eligibility because its `intervals` type label satisfies `passesRunHonestyGate`'s OR-condition independent of HR — a third non-consumer, distinct from LTHR/max-HR/readiness | Confirmed by this writer's direct read of Runner Data v2.1, matches Brain's carryover exactly |
| 93 | RPE: hardcoded uncited binary threshold, write-only field, one orphaned row | LOGGED — **directly confirmed this pass, no longer relayed-only** | Medium | None | N/A | Brain v2.1 §12: 13/13 rows confirmed. Runner Data v2.1 §1.B.11 directly: `post_run_rpe`, 13 rows (2026-05-24 to present), `notes` 0/13 populated; live consumers (`activity-evidence.ts`, `adaptation/load.ts`, `execution/load.ts`, `postrun/load.ts`) with no established weighting against objective HR/pace evidence; one row's absorption-walk untraced | Confirmed by this writer's direct read, matches Brain's carryover exactly |
| 94 | `recoveryExtensions`/`ceilingLift` — has a live Run Detail consumer | LOGGED — correction, not a defect; **directly confirmed this pass** | N/A | None | N/A | Brain v2.1 §12: "confirmed to have a live Run Detail consumer, corrected out of 'collected but unused'." Runner Data v2.1 §1.A/§5/§13 item 10 directly: a real, five-file-deep "Wrist Decisions" panel in Run Detail; a render to confirm the panel draws for a real row is the one remaining step | Confirmed by this writer's direct read, matches Brain's carryover exactly |
| 95 | Phase-transition cause largely absent (2 narrow exceptions: `repSkips`, `recoveryEndedEarly`) | LOGGED — **directly confirmed this pass, no longer relayed-only** | Medium | None | N/A | Brain v2.1 §12. Runner Data v2.1 §1.B.6/§1.B.8 directly: no phase carries a start/end wall-clock timestamp (boundary reconstruction is provably unsafe across a pause/gap/Skip); mid-run treadmill Skip writes into the same `completed:Bool` as any other completion path, with WALKBACK-2's `recoveryEndedEarly` the one new, narrow, still-0/162-populated exception | Confirmed by this writer's direct read, matches Brain's carryover exactly |
| 96 | §9 Today-screen "not completed" symptom — root cause now fully traced | **RESOLVED ON `main`, NOT YET SHIPPED** | High | `154edbf97` (deletion, already on `main`) | N/A (docs/forensics) | Brain v2.1 §9: a third Swift component, `workoutPhasesTile`/`phaseTrailingText` (introduced 2026-09-04, deleted 2026-09-08), rendered unconditionally and stamped `"not completed"` for any `completed:false` phase regardless of type — neither side of the original v1 mechanism dispute was the live cause | Nothing to fix — closes automatically the moment a new TestFlight build is cut, since both this deletion and both WALKBACK merges are already on `main` |
| 97 | `progression-pass.ts` / `replan/route.ts` race-week gap (surfaced by row 66's review) | **MERGED (Wave 3/4, §1.24/§1.25)** | Medium-High | `fix/progression-pass-race-week-protection` @ `ee6df002d`, merge commit `52eabd658`, confirmed ancestor of `origin/main` | PASS — fixed `progression-pass.ts`'s two sites plus `replan/route.ts`'s sick-ladder (confirmed the same shape despite that file's own header comment claiming otherwise) | Same bug shape as row 66 (`is_race_week` raw read instead of `weekContainsRace`), at `web-v2/lib/plan/progression-pass.ts` lines ~553, ~719-720 and `app/api/plan/replan/route.ts`'s sick-ladder | None — closed. See row 124 for a real regression this same branch's new DB query introduced and had fixed before merge |
| 98 | `composeTrainingInfluence`'s "0s slow" fabrication | LOGGED — CONFIRMED DORMANT, downgraded off the blocker list | Medium (was release-severity when bundled in row 88) | None | N/A | Coach v2.1 §2.2: `Math.max(0, delta)` floor genuinely destroys magnitude once reached, but the sole non-test caller (`web-v2/components/faff-app/seed.ts:145-157`) never wires the required `grade` key, making the branch structurally unreachable; that caller is exclusively part of the paused web frontend per CLAUDE.md (locked 2026-08-31). Covered by a 12-fixture golden suite (`_workout_verdict_owner.test.ts`), correctly built and tested, currently reachable from nothing this app ships | Split out of row 88 this pass — see §1.12. Not a TestFlight blocker. Worth fixing before this composer is ever wired to a live iPhone/watch route |
| 99 | SAFETY_STOP decline (422) decodes as a generic outage | LOGGED — CONFIRMED still unreachable through the shipped UI, downgrade unchanged since Coach v2 | Informational (real code-level bug, not currently exercisable) | None | N/A | New row this pass — not previously carried in this ledger. Full chain: Coach v1 (blocker) → v1-to-v2 correction log (removed from blocker list) → Coach v2 finding 2d ("STILL PRESENT IN CODE, but UNREACHABLE TODAY… `ProposalCardV5.swift`'s `isAnswerable` is true only when `standing == .proposal`; `standingOf()` maps every `RECORD_ONLY`-executor action to `standing: 'notice'`, which never renders a decline button") → Coach v2.1 §4 final table, unchanged, "not part of this pass's scope and carries no new evidence" | See §1.13. Rule 18 note: an unexercised safeguard is a hypothesis — the 422/key-mismatch bug is real and should eventually be fixed, but is not release-blocking while unreachable |
| 100 | Second `RUNNER_AUTHORITY_TIERS`-style side-door duplication instance: two plan-match distance bands | LOGGED — new via Runner Data v2.1, directly read | **P2** (upgraded from the general pattern's P4 — Runner Data v2.1 §12 item 8: "this pattern has now recurred") | None | N/A | Runner Data v2.1 §2.A.2/§8a row 6: `watch/workouts/complete/route.ts`'s symmetric `[0.7,1.3]` band vs. `ingest/workout/route.ts`'s asymmetric `[0.7,2.0]` band — only one received the OVERRUN-MATCH-1 fix. Same underlying gap as row 76 | Consolidate into one canonical export once row 76 is fixed, per row 91's own pattern |
| 101 | `shoes.mileage` column stale on 6 of 8 shoes | LOGGED — new via Runner Data v2.1, directly read | **P2** | None | N/A | Runner Data v2.1 §1.B.9: up to ~12× off (Asics Superblast 3: stored 12.03 vs. computed 150.54); the canonical value is computed live at read time (`computeShoeMileageBreakdown()`) | Any code reading the raw `shoes.mileage` column directly should be redirected to the live computation |
| 102 | Legacy `workout_routes` table — 24 orphaned rows | LOGGED — new via Runner Data v2.1, directly read | Informational | None | N/A | Runner Data v2.1 §1.B.1: richer per-mile pace/elevation detail than anything the current schema carries, last written 2026-05-25, orphaned by the PORT-1 cutover, zero non-test references from `web-v2/**` | No action needed unless a future feature wants to recover this historical detail |
| 103 | `clockAudit`/`pausedSec`/`droppedGapSec` absent from `canonical.ts`'s `NEVER_COPY` set | LOGGED — new via Runner Data v2.1, directly read, latent | **P2** | None | N/A | Runner Data v2.1 §6.5: not yet fired (only one route has ever populated these keys on any row), but a second future writer is exposed to the exact Rule-6 whole-object-clobber shape this codebase's doctrine already tracks for `splits`/`actual_result` | Add to `NEVER_COPY` before a second writer exists, not after — bundled with row 77's fix scope in Runner Data's own release plan |
| 104 | "14 PROGRESS outcomes" — resolved and reclassified, not a defect | LOGGED — informational correction to how Rule 21 evidence is read | N/A | None | N/A | Runner Data v2.1 §10: a still-existing replay harness (`scripts/adaptation-real-replay/real-replay.test.ts`), re-run fresh this pass, produces `PROGRESS:14/HOLD:64/REGRESS:4/REFUSE:38` against real historical training — a capability metric ("would the engine have pushed?"), not a production log. Rule 21's own "zero upward in `coach_intents`, 321 rows" claim is unaffected | None — informational, closes a previously-open question (v1's "genuinely unmatched" framing) |
| 105 | Design-System Phase 2 — `RacesV5.swift`'s `"Needs a decision"` eyebrow (RESTYLE #1) | **CLOSED — already fixed on `origin/main`, audit finding is STALE relative to current `main`** | N/A (was Priority 1 at the audit's own pin) | `45a79e997` (`fix/races-decision-header-label`, merged) | N/A — verified by this writer via direct source diff, not by the design audit | Design-System Phase 2 is pinned at `f1d1def0bedbb6db76c86ec89f8dc16f3ff9715d` (2026-09-08); this writer confirmed `45a79e997` (2026-09-09, one day later) already replaced the hardcoded `"Needs a decision"` literal with `card.shape.raceDecisionEyebrow`, gated exactly the way the audit recommends — confirmed present on `origin/main` today | None — flagged so nobody re-implements an already-shipped fix. See §1.22 |
| 106 | Design-System Phase 2 — `RouteMapView.swift`'s green start-marker dot (RESTYLE #2) | **CLOSED — already fixed on `origin/main`, audit finding is STALE relative to current `main`** | N/A (was Priority 2 at the audit's own pin) | `4359ad29e` (`fix/routemap-green-start-marker`, merged) | N/A — verified by this writer via direct source diff | Same stale-pin pattern as row 105: the audit's pin (2026-09-08) predates this fix (2026-09-09) by one day. Current `origin/main`'s `RouteMapView.swift` carries an explicit comment confirming the marker is "PALETTE-NEUTRAL, NOT GREEN. This used to be #3EBD41" | None — flagged so nobody re-implements an already-shipped fix. See §1.22 |
| 107 | Design-System Phase 2 — CREATE #1, reinstate the modelled `~` marker | **MERGED — row 65's branch merged this pass (§1.24/§1.26)** | N/A | `adcea6f15` (`MARKER-RESTORE-1`), on `fix/postrun-missing-pace-routing`, confirmed ancestor of `origin/main` via row 65's merge | Same review status as row 65 — all 9 hold conditions independently re-verified PASS, before merge | Design-System Phase 2 named this its single highest-leverage recommendation; this writer confirmed the fix already exists, on the same branch as row 65, now merged and live | None — closed, resolved by row 65's merge |
| 108 | Design-System Phase 2 — treadmill cues-menu overlay (RESTYLE #3) | LOGGED — same underlying defect as row 63, not double-counted | High (release-blocking at the audit's pin) | `9462c8205` (row 63's fix, dated one day after the audit's pin) | Same as row 63 | Design-System Phase 2 independently re-confirmed Phase 1's original finding still present at its own pin, reproducing at every Dynamic Type category and both size extremes tested — consistent with the ledger's own timeline, since row 63's fix postdates the audit's pin | See row 63 — same fix, same merge-status caveat |
| 109 | Design-System Phase 2 — REFINE items (bundled): hardcoded `"3:16:45"` catalog fixture; ambiguous "Elevation" sub-label beside "No GPS" caption; 14 `.system()` font sites bypassing `faffText`; catalog harness "Close" pill collision; `BlockV5.swift:863` `Alert(text:...)` omitting `tone:` | LOGGED, not implemented | Priority 3 (per the audit's own severity) | None | N/A | `docs/audit-design-system-phase2.md` §16 REFINE list — the font-site and `Alert` items carry forward from Phase 1 unchanged; the fixture/sub-label/harness items are new to Phase 2 | No implementation started; low individual severity, bundled for tracking |
| 110 | Design-System Phase 2 — REMOVE: 40 sites / 13 files, legacy `Theme.green` as a grade under `-faffLegacy` | LOGGED — carried forward from Phase 1, unchanged, still unreachable | Priority 2 (currently unreachable) | None | N/A | `docs/audit-design-system-phase2.md` §16 REMOVE — real code, confirmed still present, behind the `-faffLegacy` debug flag | Remove once that debug path is retired — not urgent while unreachable |
| 111 | Design-System Phase 2 — CREATE #2, standalone Training-calendar-sheet view | LOGGED, genuinely new and unaddressed | Not severity-scoped (a capability gap, not a defect) | None | N/A | `docs/audit-design-system-phase2.md` §0.3/§16: `TodayBeforeV5`'s private `calendarSheet` computed property cannot be exercised standalone; extracting it (with an `initialOpen` parameter, analogous to `OnboardingV5`'s `initialStep`) is a product-view change, out of scope for a catalog-only addition | Needs its own branch — no implementation started |
| 112 | Design-System Phase 2 — Dynamic Type inconclusion re-confirmed, not resolved | LOGGED — unchanged, area 26 remains BLOCKED | N/A | None | N/A | `docs/audit-design-system-phase2.md` §0.5/§11: two visual-impression errors were caught and corrected by the audit's own re-measurement before being reported (a scaling artifact, and a byte-identical-screenshot false negative); the corrected finding is "no representative screen showed a visually confirmed size change under Dynamic Type in this environment," itself qualified as possibly a tooling limitation, not a confirmed app defect | No physical-device Dynamic Type verification has ever been performed — carried forward unchanged into §5/§6 |

### 2.3 Wave 3 / Wave 4 integration rows (113–130)

New this pass, per §1.24-§1.32. Every branch/merge-commit SHA below was independently checked
by this writer against a freshly-fetched `origin/main` (§1.32) — the "Independent review"
column states what the two handbacks themselves report; the "Evidence" column's ancestry
claims are this writer's own direct git checks, not transcribed.

| # | Item | Status | Severity | Branch/commit | Independent review | Evidence | Closure requirement |
|---|---|---|---|---|---|---|---|
| 113 | Shipping lock + artifact mapping infrastructure | MERGED, confirmed live and in real use | High (process) | `feat/shipping-lock-and-artifact-mapping` @ `1050a48c7`, merge `952b40d0d` | 3 real defects found by adversarial review (main-branch-deletion bypass, TTL-fails-open concurrency race, false-clean SHA-verification gap), all fixed and re-verified against a real scratch remote | Confirmed ancestor of `origin/main`. Per Wave 3 §5/§1.31, has already caught a genuine concurrent authorization from a parallel merge this same wave — doing real work, not just installed. This is the corrective mechanism row 71/§1.21 names for the unauthorized-self-merge process finding | None — closed. Also closes row 71's "corrective mechanism still being built" caveat |
| 114 | Standing-recommendation convergence + false cutback copy (Lane D) | MERGED | High (2 of row 88's 3 items) | `fix/standing-recommendation-convergence-and-cutback-copy` @ `ab5a5eb7c`, merge `e32dde4a7` | PASS, no conditions (per `docs/audit-2026-09-11-handback-movement-2.md`'s own Lane D row) | Confirmed ancestor of `origin/main`; diff confirmed to touch `web-v2/lib/coach/standing-recommendation.ts`, `web-v2/lib/plan/strategy-contracts.ts`, plus two new test files. **Cross-referenced to row 88 by this writer, not stated by name in Wave 3/4** — flagged per §2.2's row 88 update | None — closed. See row 88 for the cross-reference caveat |
| 115 | Stale cache reading as the outage screen | MERGED | Medium-High (new) | `fix/cold-open-cache-honesty` @ `2a8ee1d89`, merge `333f520f4` | PASS (per Wave 3 §1) | Confirmed ancestor of `origin/main`; per Wave 3 §1, `[PROD] SUCCESS` reported on Railway (relayed, not independently re-queried against Railway's API) | None — closed |
| 116 | `plan_match_ambiguous` leak into runner-visible coach-intents timeline (WATCHMATCH-1 follow-up) | MERGED | Medium-High (new, adjacent to row 76) | `fix/execution-identity-watch-matcher` @ `f4cbb67f8`, merge `6fd65a6f6` | PASS (per Wave 3 §1) | Confirmed ancestor of `origin/main`; this writer's own read of the commit message confirms the mechanism: an ambiguous-match refusal intent, pre-acknowledged so it never reaches the pending-intents query, was leaking into `GET /api/coach/intents`'s separate unfiltered-by-default read path into native-v2's `CoachActivityTimeline` | None — closed. Distinct from row 76 (the primary matcher's own `[0.7,1.3]` band fix), which remains QUEUED and unassigned |
| 117 | `fix/postrun-missing-pace-routing` final tip / live confirmation | MERGED, see row 65 | High | `859ea18f3`, merge `4bfd69ad9` | See row 65 | Independently confirmed live via `curl www.faff.run/api/up` → 200, both by the session (Wave 3 §1) and by this writer directly this pass | Folded into row 65 — not a separate open item |
| 118 | Missed/skipped/moved-day resolution (Finding 3), including `PlanSnapshotStore` gap | MERGED | High | `fix/missed-skipped-moved-state` @ `6db2859d7`, merge `c97f1ec9f` | Two review rounds. First: PASS WITH CONDITIONS — mechanism solid (17/17 + 506/506 native tests, real button-taps including a genuine 401/sign-out against an unauthenticated request), but `PlanSnapshotStore` — the app's own stated "ONLY" path for date navigation — bypassed the feature by default, the default case for the population it exists to serve, not disclosed initially. Fix made the snapshot itself carry resolution data via the canonical resolver rather than routing around the gap. Second, final review: PASS — independently reproduced the exact before/after against a real copy of the reference runner's data at both commits, not fixtures; all test counts matched on independent re-execution | Confirmed ancestor of `origin/main` | None — closed |
| 119 | CIM elevation integrity — choice card structurally unreachable for curated courses | MERGED | High (was OPEN/HELD) | `fix/cim-elevation-integrity` @ `1b31a55ae`, merge `6c7a99aa0` | Confirmed two ways: structurally (confidence computation traced exhaustively) and by an actual on-device simulator screenshot matching the confirmed payload character-for-character, in an earlier pass this session (a stale `simctl install` methodological trap was caught via MD5 comparison first) | Confirmed ancestor of `origin/main`; acceptance evidence committed as `docs/verification/2026-09-11-cim-elevation/acceptance-evidence.md` (this writer confirmed the file's presence in the current tree) | None — closed. See §1.26 for the full two-part confirmation and Wave 4's own honest disclosure that no *new* screenshot was captured at merge time |
| 120 | Race-week protection: `progression-pass.ts` + `replan/route.ts` sick-ladder | MERGED, resolves row 97 | Medium-High | `fix/progression-pass-race-week-protection` @ `ee6df002d`, merge `52eabd658` | PASS | Confirmed ancestor of `origin/main` | None — closed. See row 124 for a regression this branch's new code introduced, caught and fixed before merge |
| 121 | Race-week protection: Adaptation Engine week-ahead lever eligibility (4th site) | MERGED, dependency-ordered after row 120 | Medium-High | `fix/load-adaptation-week-ahead-race-detection` @ `3d382824c`, merge `9471b27ab` | PASS WITH CONDITIONS, resolved — cannot compile against plain `main` alone (proven by an actual `tsc` error), must merge after row 120's branch; confirmed merged in that order by direct `git log` read (§1.24) | Confirmed ancestor of `origin/main`. Review found the previously-cited reference example (Santa Monica 10K) is actually protected by `is_cutback` at 3 of 4 sites, not this fix — David's real Dodgers 10K tune-up week is the correct real-data proof (confirmed flipping from buggy `null` to correct `RACE_WEEK`) | None — closed |
| 122 | Race-week protection: `replan-scenarios.ts` (5 call sites) + `move-orchestrator.ts` parity fix (6th site) | MERGED, 3 review rounds | Medium-High | `fix/replan-scenarios-race-week-protection` @ `c57733696`, merge `8dff7892b` | PASS after 3 rounds. Round 2 found `move-orchestrator.ts`'s own doc comment claimed parity with the just-fixed `weekMiles` — a parity the fix had silently broken; the two surfaces genuinely disagreed (47.2mi vs. 41mi for the same real tune-up-week shape) and now agree | Confirmed ancestor of `origin/main`. Includes one deliberately-correct non-fix at a 5th call site, backed by this project's own RACEWEEK-2 doctrine, independently verified | None — closed |
| 123 | Race-week canonicalization final pass (`strategy-contracts.ts`, `adjudicate.ts`/`live-sequence.ts`, exhaustive `is_race_week`/`isRaceWeek` sweep) | **DISPATCHED, IN PROGRESS — zero commits landed** | Medium-High | `fix/race-week-canonicalization-final` (branch exists, checked out; confirmed 0 commits ahead of `origin/main` via `git log --oneline origin/main..fix/race-week-canonicalization-final`) | Not yet reviewed — nothing has landed to review | Scope per Wave 4 §9: named canonical predicates (race day / race week / post-race recovery / goal race / tune-up race), every consumer routed through the right one, doctrine-backed GOAL-only behavior preserved with citations, a ratcheted static regression gate, and a complete call-site inventory as a required deliverable | Implementation, then independent review — nothing to close yet |
| 124 | Swallowed-failure regression in `progression-pass.ts`'s new `priorWeekDayTypes` DB read | MERGED (caught and fixed before shipping) | High (would have reopened the entire race-week protection effort on a DB blip) | `3192f7ac1`, on `origin/main` directly after the 5-branch wave's final merge | Caught by the `check-swallowed-failure` gate on the combined-gate run during Wave 4's integration, not by a human review pass | A bare `.catch(() => ({rows: []}))` reads a DB failure identically to "this week has no race" — the exact bug class rows 66/97/120-122 exist to close, reintroduced by the fix meant to close it. Fixed by routing through the existing `rowsOrEmpty` helper. Confirmed ancestor of `origin/main` | None — closed. Cited here as a worked example of Rule 15/18's own point: a full gate chain caught what a narrower one would have missed |
| 125 | Pre-push hook's node_modules gate — scope to web-v2-touching pushes only | **REVIEWED PASS, scoped, ready — NOT merged** | Medium (process/friction) | `fix/pre-push-node-modules-gate`, tip `ae7619ea9` (supersedes Wave 3's `94ebc8e4d` — confirmed via fresh `git fetch`, §1.31) | PASS. Both directions independently falsified: bypass case (docs-only push, no `node_modules`) now correctly skips the check; false-block case (web-v2-touching push, no `node_modules`) still correctly refuses. The re-reviewer additionally stress-tested the falsifier's own "self-skip if history changes" safety mechanism three separate ways and confirmed it fails closed every time | Confirmed **not** an ancestor of `origin/main`. Adds `touches_web()`, mirroring the existing `touches_watch()` pattern, including self-including the gate scripts. A live instance of the friction it fixes occurred during Wave 4's own final push (§1.31) | David's explicit merge authorization |
| 126 | Santa Monica race-day copy — rejected rewrite | REJECTED, held as a failed reference case | N/A (not a defect — copy-quality judgment) | `fix/santa-monica-race-day-copy` @ `38d090ec8` | David's own critique: repetitive phrasing, mechanical/threatening tone, a meaningless "yours to change" claim with no verified control behind it | Confirmed **not** an ancestor of `origin/main` — correctly never merged | None to close — held permanently as a reference case unless revisited from scratch |
| 127 | Natural Coaching Experience — new ownership role established | New process/org item, not a code defect | N/A | N/A | N/A | Scoped to presentation language only, real rendered outputs across all 7 named surfaces, canonical facts not recomputed conclusions, David's real data, row 126's rejected case as its first acceptance test | Its first work product is row 128 |
| 128 | Natural Coaching Experience's first result: `santa-monica-race-day-v2` | **DELIVERED, PENDING truth review and UX review — NOT merged** | N/A pending review | `natural-coaching/santa-monica-race-day-v2` @ `b0d7349e7` | Not yet reviewed — the review processes themselves are not yet structured, per Wave 4 §7 | Confirmed branch exists, confirmed **not** an ancestor of `origin/main`. Removed "yours to change" entirely (traced the real editable control to a different screen already carrying an honest version of the claim, rather than patching in place); kept the pace-band/target-pace distinction as two genuinely real facts; named but did not touch two adjacent jargon issues in sibling code, and one string it honestly could not trace to a render site in its own time budget | David to define and run the truth review and UX review, then a merge decision |
| 129 | Duplicate September 13 race workout rows | **INVESTIGATED, CONFIRMED BENIGN — no code repair needed for this instance** | Was flagged Medium (incidental), resolved Informational | N/A (no fix branch — nothing to fix) | Investigation only, per Wave 4 §6; not independently re-run by this writer against `DATABASE_URL_RO` — the scoping *mechanism* it relies on was independently confirmed present in source by this writer (§1.28) | One live row (`wko_a69751c4cc8ab89a`, active plan), one orphaned in an archived plan version from a `silent-rebuild` cron operation. Every production surface (Today, watch delivery, pre-run lobby, week strip, completion matching, adaptation loaders) already scopes to the active plan only — the same PLAN-VERSION-ALIAS-1/ACTIVEPLAN-1 mechanism this ledger already tracks (Rule 14). Build 290 already has this scoping. First surfaced, unexamined, during Lane D's review (`docs/audit-2026-09-11-handback-movement-2.md` line 20) | None — closed for this instance. One adjacent gap named, not dispatched: no pruning mechanism exists for orphaned `plan_workouts` rows across plan rebuilds (47 plan versions / 4,130 rows for one user, unbounded growth) |
| 130 | Lane C (proposal-state work) never dispatched; `fix/decision-history-undo-display` reviewed but unmerged; `fix/proposal-evidence-as-prose` a genuine concurrent-session watch-item | LOGGED — status/process finding, not a code defect in itself | Medium-High (Lane C blocks on this) | `fix/decision-history-undo-display` @ `6f8a3d28f` (= row 68's branch); `fix/proposal-evidence-as-prose` @ `0aeb6cb9a` | Row 68's own review already covers undo-display (verified against real CI, one open documentation-policy gap on `--no-verify` justification). `fix/proposal-evidence-as-prose` not yet reviewed by anyone in this ledger's history | Both confirmed **not** ancestors of `origin/main`. The two branches share a domain (proposal-state presentation) but confirmed no file-level overlap — named as a watch-item, not a conflict | Merge `fix/decision-history-undo-display` (or explicitly decide not to) to unblock Lane C's own dispatch; reconcile `fix/proposal-evidence-as-prose` against it before both land |

---

## 3. Three-Audit Intake Ledger

Per David's specified format. Populated from the Brain packet (read in full, ACCEPTED AND
CLOSED), the Coach packet (read in full, ACCEPTED AND CLOSED), and **Runner Data v2.1 — now
also read in full this pass, its FINDINGS integrated directly (§1.15-§1.17); its dedicated-
branch provenance receipt remains a separate, still-open gate, §1.18**. Owner
column uses the coaching-domain vocabulary from CLAUDE.md's required-reading index
(Activity Interpreter, Evidence Engine, Runner Model, Readiness, Safety, Coaching Thesis,
Pace Prescription, Plan Generator, Adaptation Engine, Race Prediction, Goal System, Goal
Feasibility, Training Load, Environmental Context, Workout Library, UI) — these are this
writer's best-fit assignments for triage, **not** a verbatim citation of
`docs/BRAIN_CONSTITUTION.md`'s own ownership table, which was not re-read for this task.
Main should confirm each Owner against that table before treating it as settled.

| Finding | Source audit(s) | Severity | Ledger row # | Branch affected | Next-build disposition | Evidence status | Owner (best-fit, unconfirmed) |
|---|---|---|---|---|---|---|---|
| `strides_recovery_s` recovery-honesty field-name gap | Brain, Runner Data (**directly read this pass**), Coach (triple-confirmed) | **P0** | 75 | `fix/recovery-honesty-strides-grading` @ `b13c2c59a` | **IMPLEMENTATION COMPLETE, REVIEWED PASS, RENDERED — HELD pending merge authorization** (Lane A, §1.26; not merged this wave) | Triple-confirmed by independent methods, Runner Data no longer relayed | Evidence Engine / Activity Interpreter |
| Primary watch-completion matcher (`[0.7,1.3]`, no ambiguity refusal) | Brain, Runner Data (**directly read this pass**) | High | 76 | None | Not this build — QUEUED, still unassigned, no implementer started | Cross-confirmed, executed test, confirmed the app's primary completion path | Activity Interpreter |
| Pause data raw-fact loss (8/8 submissions), 3 senders not 2 | Runner Data (**directly read this pass**, no longer Brain-carryover-only) | Medium-High | 77 | None | QUEUED, narrowly bounded to persistence only, still unassigned | Confirmed [SOURCE]+[PROD-QUERY], directly read | Activity Interpreter |
| `reanchorLthr` ungated side door, all 5 callers | Brain | High | 78 | None | LOGGED, no scope decision made | Confirmed [SRC], 5/5 callers traced | Runner Model |
| `mark_upgrade` blocked by Migration 166; ack unrendered | Brain | High | 79 | None | Blocked on Migration 166 decision + Apply-unavailable UX render | Confirmed [SRC] for API; `[BLOCKED: not rendered]` for UI | Adaptation Engine |
| `reopenProposal()` gap, 2 modern lanes | Brain **AND** Coach (both v2.1, independently derived, cross-confirmed — see §1.10) | P1 (Brain) / release blocker (Coach v2.1 §4) | 80 | None | LOGGED — on Coach's next-TestFlight-blockers list, not yet implemented | Confirmed [SRC] by both audits independently; Coach v2.1 read directly this pass, not relayed | Adaptation Engine |
| `load-activity-evidence.ts` date-only side door | Brain | Medium-High | 81 | None | LOGGED | Confirmed [SRC] | Evidence Engine |
| `HowItWentPanel` dead-code HR ladders | Brain, Coach v2, **Coach v2.1** (three-way agreement, root cause now on record — see §1.2) | P4 (was P2) | 82 | None | LOGGED, downgraded | Confirmed [SRC], call-site traced; Coach v2.1 additionally traces the orphaning commit (`aac88aec139`, 2026-07-10) | UI |
| Race-projection List/Detail label divergence — **now 3 states, not 2** (coherent/normal, degraded/fallback, controlled C-race) | Brain, Coach v2, **Coach v2.1** (fuller answer — see §1.4) | P4, not a defect | 83 | None | LOGGED, informational | Confirmed [SRC] at pinned commit; Coach v2.1 read directly this pass, adds the `layersOwnTheNumbers` branch condition and the controlled-C-race wrinkle | Race Prediction / UI |
| C-race frequency-cap **notes** defect | Coach v2.1 (executed, directly read this pass), errata-corrected in Brain's own v2.1.1 (see §1.11 for the full genealogy) | **P3** | 84 | None | Not a TestFlight blocker; needs regression coverage (existing falsification script is `expect(true)` only, per David's own caveat §1.9) | Confirmed by direct execution (0/140, 18/56) — cross-checked this pass against Coach v2.1 §2.1's own console output, numbers match exactly | Plan Generator |
| `coach_intents` gap, plan mutations (direction-neutral) | Brain (errata-renamed) | **P0** | 85 | None | LOGGED; cross-references Rule 21 | Confirmed, 3 `drift_cron_auto` instances + `positive-drift` history | Adaptation Engine |
| `positive-drift` retired side door | Brain | Informational | 86 | None | No action unless `legacy/web` redeployed | Confirmed retired, [SRC]+[PROD-RO] | Adaptation Engine |
| "76 workouts" re-anchor claim | Brain | N/A, disputed | 87 | None | Do not cite as established | Explicitly unverifiable from current schema | Runner Model |
| Coach v2.1's 3 remaining confirmed release blockers (false cutback "down/reduction" copy; HOLD/notice cross-surface contradiction; `standing-recommendation.ts` convergence violation) | Coach v2.1 (**directly read in full this pass — §1.6 caveat lifted**, one item Brain-corroborated) | Release blocker (per Coach v2.1 §4) | 88 | None | Not implemented; Coach packet is now ACCEPTED AND CLOSED (no further artifact receipt pending) | **Confirmed via direct reading of Coach's own document this pass, not relayed.** Item count corrected from 4 to 3 — "0s slow" split out, see row 98 | Coaching Thesis / Readiness / UI |
| HR-flatline guard doesn't reach LTHR/HRmax/zone/readiness | v1 §8a (predecessor forensic pass), not addressed by Brain or Coach | High | 89 | None | LOGGED, folds into v1 row 9 | Not re-checked this packet cycle | Safety / Readiness |
| Five incompatible adaptation-decision vocabularies | v1 §8a, not addressed by Brain or Coach | High | 90 | None | LOGGED | Not re-checked this packet cycle | Adaptation Engine |
| `RUNNER_AUTHORITY_TIERS` duplicated | v1 §8a, not addressed by Brain or Coach | Medium | 91 | None | LOGGED | Not re-checked this packet cycle | Safety |
| VDOT-eligibility OR gate (neither branch checks HR-trace credibility) | Brain (carryover) + Runner Data v2.1 (**directly read this pass**) | Medium-High | 92 | None | LOGGED, no longer relayed-only | Confirmed by direct reading, matches Brain's carryover | Evidence Engine |
| RPE hardcoded threshold / write-only field / orphaned row | Brain (carryover) + Runner Data v2.1 (**directly read this pass**) | Medium | 93 | None | LOGGED, no longer relayed-only | Confirmed by direct reading, matches Brain's carryover | Evidence Engine |
| §9 Today-screen `workoutPhasesTile` symptom | Brain | High | 96 | N/A (deletion already on `main`) | Ships automatically on next TestFlight build | [TEST]-proven for current server payload; [SRC]+[PROD-RO] for build history; Swift rendering itself never observed | UI |
| `composeTrainingInfluence`'s "0s slow" fabrication | Coach v2.1 (directly read this pass — see §1.12) | Medium, **downgraded from release-severity** | 98 | None | LOGGED, confirmed dormant, not a TestFlight blocker | Confirmed [SRC] — sole caller never wires `grade`; caller lives entirely in the paused web frontend per CLAUDE.md | Workout Library / Coaching Thesis |
| SAFETY_STOP decline (422) decodes as a generic outage | Coach v1 → v2 → v2.1 (four-document chain, all agree — see §1.13) | Informational (real bug, unreachable) | 99 | None | LOGGED, unchanged since Coach v2's downgrade | Confirmed [SRC], `isAnswerable`/`standingOf()` traced; re-confirmed unchanged by Coach v2.1's final table with no new evidence | Safety / UI |
| Second plan-match distance-band duplication instance | Runner Data v2.1 (directly read, §1.17) | P2 (upgraded) | 100 | None | LOGGED | Confirmed [SRC] | Activity Interpreter |
| `shoes.mileage` stale on 6/8 shoes | Runner Data v2.1 (directly read, §1.17) | P2 | 101 | None | LOGGED | Confirmed [PROD-QUERY]+[SRC] | Runner Model |
| Legacy `workout_routes` orphaned table | Runner Data v2.1 (directly read, §1.17) | Informational | 102 | None | No action needed | Confirmed [SRC]+[PROD-QUERY] | Activity Interpreter |
| `NEVER_COPY` gap for pause fields | Runner Data v2.1 (directly read, §1.17) | P2, latent | 103 | None | LOGGED, bundled with row 77's fix | Confirmed [SRC] | Activity Interpreter |
| "14 PROGRESS outcomes" resolved/reclassified | Runner Data v2.1 (directly read, §1.17) | N/A, informational | 104 | None | Closes a previously-open question | Confirmed [TEST]+[PROD-QUERY], re-run fresh | Adaptation Engine |
| Design-System Phase 2 — RacesV5 eyebrow label | Design-System Phase 2 audit, this writer's own direct source-diff (§1.22) | N/A — CLOSED, stale finding | 105 | `45a79e997` (already merged) | CLOSED — already fixed on `origin/main` | Confirmed [SRC] by this writer, independent of the audit | UI |
| Design-System Phase 2 — RouteMapView green dot | Design-System Phase 2 audit, this writer's own direct source-diff (§1.22) | N/A — CLOSED, stale finding | 106 | `4359ad29e` (already merged) | CLOSED — already fixed on `origin/main` | Confirmed [SRC] by this writer, independent of the audit | UI |
| Design-System Phase 2 — modelled `~` marker (CREATE #1) | Design-System Phase 2 audit, this writer's own direct source-diff (§1.22) | N/A — already implemented, now MERGED | 107 | `adcea6f15`, on row 65's now-merged branch (§1.24/§1.26) | Same as row 65 | Confirmed [SRC] and confirmed ancestor of `origin/main` | UI |
| Design-System Phase 2 — treadmill cues-menu overlay | Design-System Phase 2 audit (cross-checked against row 63) | High at the audit's pin | 108 | `9462c8205` (row 63's fix) | Same as row 63 | Confirmed [SRC] | UI |
| Design-System Phase 2 — REFINE bundle (5 items) | Design-System Phase 2 audit | Priority 3 | 109 | None | LOGGED | Confirmed [SRC] per the audit | UI |
| Design-System Phase 2 — legacy `Theme.green` REMOVE | Design-System Phase 2 audit (carried from Phase 1) | Priority 2, unreachable | 110 | None | LOGGED | Confirmed [SRC] per the audit | UI |
| Design-System Phase 2 — Training-calendar-sheet CREATE #2 | Design-System Phase 2 audit | Capability gap | 111 | None | LOGGED | Confirmed [SRC] per the audit | UI |
| Design-System Phase 2 — Dynamic Type inconclusion | Design-System Phase 2 audit | N/A | 112 | None | LOGGED, unchanged | Two self-caught measurement errors disclosed by the audit itself | UI / Accessibility |

---

## 4. CI / Migration / TestFlight state

| Item | State |
|---|---|
| `build-check` / `test-full` / `native-check` | Confirmed green on the fully-integrated tree per Wave 4's own report (relayed, not independently re-run by this writer): `npm run prebuild` clean, `tsc --noEmit` 0 errors, `next build` clean, `vitest run` **12,112 passed / 1 pre-existing failure / 205 skipped**, native `FaffTests` 543/544 (1 expected fail). **The one named failure is `_authoring_shadow_compare.audit.test.ts`** — a Rule 18 liveness-refusal gate designed to fail loudly whenever `DATABASE_URL_RO` isn't configured, confirmed identical across every unmodified checkout of `main` this entire session (§1.30). Do not read "1 pre-existing failure" anywhere in this document as an unnamed or unexplained number — this is it |
| `audit-suite` | **BLOCKED_MISSING_CREDENTIAL** — `DATABASE_URL_RO` confirmed present in `web-v2/.env.local`, absent from GitHub Actions repo secrets. Requires David's own action (`gh secret set DATABASE_URL_RO` or the GitHub UI) — declined to enter it directly per credential-handling policy. Same missing credential is what makes `_authoring_shadow_compare.audit.test.ts` fail (above) |
| Migration 166 (`plan_decision_ledger`) | Confirmed additive-only, `IF NOT EXISTS`-guarded, **not** auto-applied by any build/deploy script. Still UNAPPLIED, pending separate, explicit DDL approval. **Rollout/rollback evidence preparation is IN PROGRESS (concurrent session, §1.20) — this narrows the review, it is not itself approval and does not change the UNAPPLIED status.** Unchanged by Wave 3/Wave 4 |
| Migration 170 (`request_failures`) | Same discipline as Migration 166 — additive-only, confirmed not auto-applied, UNAPPLIED, pending separate DDL approval, does not touch Migration 166's table. Same evidence-prep-in-progress caveat as above. Unchanged by Wave 3/Wave 4 |
| TestFlight | Per v1: build 290, source `0dce24f23`, uploaded 2026-09-07. **Build 290 is explicitly OBSOLETE as of this pass — do not cite it, anywhere, as evidence of any fix's current shipped status.** `origin/main` was already 64+ commits ahead as of v1; the third pass added at least 6 more merged branches on top of that; **this (fourth) pass adds a confirmed further TEN merged branches** (Wave 3's five + Wave 4's five, §1.24), plus the still-held Lane A, node_modules-gate, undo-display, and Natural Coaching Experience work, none of which is on any build. **The gap has grown, not shrunk, on every single pass that has checked it.** No new build has been cut or distributed. A real TestFlight candidate remains outstanding — see §5 |
| Independent git spot-check (this writer, this pass) | `origin/main` fetched fresh, confirmed tip **`e13542763573e17561970b0d1e05ba37a57420e3`** — matches this task's own briefing and Wave 4's own §1 claim exactly, no drift. `git log --oneline origin/main` (run directly) confirms the ten Wave 3/4 merge commits land in the order both handbacks describe, ending in the CIM acceptance-evidence commit. This writer also `curl`ed `https://www.faff.run/api/up` directly and received `200` (§1.32) — a live corroborating data point, not proof of which exact SHA is serving. See §1.24-§1.32 for the full verification |

---

## 5. Still Open / Blocking Finalization

**Rewritten this (fourth) pass to be current and precise, per instruction.** Runner Data's
provenance receipt is UNCHANGED and remains open (item 1). Race-week canonicalization
(previously framed as "9 confirmed sites, exhaustive") is now DISPATCHED but not landed —
renamed from a closed count to an explicit in-progress item (item 2). Lane A and the
node_modules gate moved from "in progress" to "reviewed PASS, held pending merge
authorization" (item 3). The Natural Coaching Experience track and the duplicate-race-row
follow-up are new (items 4, 6). Six things, named precisely, block finalization or remain
genuinely open:

1. **Runner Data's dedicated-branch provenance receipt** still has not returned — unchanged
   since the third pass. Distinct from Runner Data's findings, which remain accepted and
   directly integrated (§1.15-§1.17). The receipt specifically blocks (a) canonical-record
   completeness, and (b) — per David's own framing, which ties the two together by name — the
   merge of `fix/postrun-missing-pace-routing` (row 65). **That merge has now happened
   (§1.24/§1.26), while the receipt itself still has not arrived.** This document does not
   have standing to decide unilaterally whether the merge going ahead means the receipt
   condition lapsed or is simply outstanding on already-live content — Main should resolve
   this explicitly rather than let it go unstated.
2. **Race-week canonicalization** (`fix/race-week-canonicalization-final`) is DISPATCHED per
   David's explicit instruction, now that its prerequisite 5-branch wave is merged (§1.25), but
   carries **zero commits** as of this pass — confirmed directly via `git log`. Do not cite
   race-week protection as closed, at 9 sites or any other number, until this branch's own
   call-site inventory, canonical predicates, and regression gate land and are reviewed.
3. **Three implementation/product holds, reviewed PASS or delivered, awaiting David's
   authorization or review process, not a further technical gap:**
   - **Lane A** (`fix/recovery-honesty-strides-grading`, row 75) — reviewed PASS across 3
     rounds, rendered against David's real workout (§1.26). HELD pending explicit merge
     authorization.
   - **The node_modules-gate scoping fix** (`fix/pre-push-node-modules-gate` @ `ae7619ea9`,
     row 125) — reviewed PASS, both directions independently falsified (§1.31). HELD pending
     explicit merge authorization.
   - **`fix/decision-history-undo-display`** (row 68/130) — reviewed PASS long ago via real CI,
     still unmerged. Blocks Lane C's own dispatch (item 5 below).
4. **Natural Coaching Experience's first result** (`natural-coaching/santa-monica-race-day-v2`,
   row 128) is delivered but pending a truth review and a UX review that have not yet been
   structured (§1.27). The rejected Santa Monica original (row 126) stays held as a reference
   case.
5. **Lane C (proposal-state work) has never been dispatched** — it was sequenced to start only
   after undo-display's integration, which has not happened (item 3 above). Separately,
   `fix/proposal-evidence-as-prose` is a genuine unmerged branch from a different concurrent
   session, same domain as undo-display, no file-level overlap — a watch-item for whoever
   reconciles the two, not yet anyone's assignment (§1.29/row 130).
6. **Migration 166 and Migration 170 application** remains blocked on David's separate,
   explicit, per-statement DDL approval — evidence preparation in progress (§1.20) narrows
   the review but is not the approval itself. Unchanged since the third pass.
7. **A real TestFlight candidate.** Build 290 is confirmed OBSOLETE (§4) and must not be cited
   as current. No new build has been cut. The gap has grown by ten more merged branches this
   pass alone (§4) — see Runner Data v2.1's own release sequence (§14(b)) for why shipping
   should be the LAST step, not a parallel or earlier one.
8. **Physical-device verification**, per v1's own final verdict, "the single most-repeated
   unmet requirement across this entire audit" — still true, unchanged. Zero physical-device
   verification exists for anything in this document except CIM's own earlier-session
   simulator screenshot (§1.26) and the on-device evidence already cited for rows 56/69-70.

**Duplicate-race-row follow-up, named separately since it is not a blocker but is a real open
item:** no pruning mechanism exists for orphaned `plan_workouts` rows across plan rebuilds
(§1.28/row 129) — 47 plan versions / 4,130 rows for one user, accumulating unboundedly. Not
dispatched.

**Remaining open items, carried forward, shortened:**

- Row 70's re-review (`fix/statescreens-scaffold-stale-banner-ordering`) — the prior attempt
  hit an API spend/rate limit before any verification; must not be treated as PASS.
- `strategy-contracts.ts` / adjudication-layer race-week follow-ups — now folded into row 123's
  dispatched-but-unstarted canonicalization branch, not a separate item.
- Row 67 (`fix/product-decisions-conflict-and-watch-gate-log`) — reviewed but still not on
  `origin/main` as of the third pass's direct check (§1.7); not re-checked this pass.
- Coach's one remaining unimplemented release finding not addressed by Lane D's merge — the
  HOLD/notice cross-surface contradiction, the 3rd item bundled in row 88 — no branch yet.
- `DATABASE_URL_RO` provisioning (row 72) — requires David's own action; blocks `audit-suite`
  and is also why `test-full`'s one named failure fails (§1.30/§4).
- Rows 62-63's unresolved squash-merge-vs-missing ambiguity (§1.8) — needs a direct content
  diff before being cited as fact elsewhere; not re-checked this pass.
- Rows 100-104, 108-112 (Runner Data's newly-folded facts, Design-System Phase 2's REFINE/
  REMOVE/CREATE-#2 items) — logged, none implemented, none release-blocking.
- `experience.ts:711`'s em-dash follow-up, found by Lane A's widened coach-voice gate scan
  (§1.26) — flagged, not dispatched.

---

## 6. Design-System Phase 2 — full 27-area table, updated

v1's §8 table ("Full master product status — 27 areas") is carried forward here in full,
per this document's own opening promise that nothing in v1's §7/§8 is silently dropped, with
`docs/audit-design-system-phase2.md`'s findings folded into the areas they bear on. Rows not
touched by Design-System Phase 2 are unchanged from v1 and reproduced for completeness, not
re-investigated. See §1.22 for the two findings independently confirmed stale by this writer
before being folded in — they are marked CLOSED here, not carried as open design work.

| # | Area | Status | Basis |
|---|---|---|---|
| 1 | Today | PARTIAL | Unchanged from v1 §8 — outage banner, walk-back display, recovery-ended-early grading, session-ended regression fix, and status-bar gradient fix all reviewed/merged-or-pending; none physically verified |
| 2 | Pre-run | DEFERRED WITH REASON | Unchanged — not touched by Design-System Phase 2 (out of its 9-screen representative subset) |
| 3 | Run execution | DEFERRED WITH REASON | Unchanged — Design-System Phase 2's `12a`/`12a-noheart`/`12a-gps`/`12b` renders (§9 KEEP items 2; Nielsen H1) bear on this area but were scoped to catalog-state rendering, not a full re-audit; not re-classified |
| 4 | Post-run | PARTIAL | Unchanged from v1 §8 |
| 5 | Activity/history | DEFERRED WITH REASON | Design-System Phase 2 rendered `22a`/`23a`-`23d` (Past runs, Run detail variants) with no new defect beyond the already-tracked green route-start dot (row 106, now CLOSED) |
| 6 | Block/plan | DEFERRED WITH REASON | Design-System Phase 2 rendered `6a`/`6a-longest`/`6a-refusal` cleanly, plus one sub-finding (`6a-longest`'s content extending past the viewport, §1 of that audit) not severity-scoped by that pass; not folded into a ledger row given the audit's own disclosed inability to scroll and confirm (§0.2) |
| 7 | Adaptation | BLOCKED | Migration 166 still blocks all adaptation-apply (§1.20: evidence prep in progress, application still requires David's separate approval); the `decisions` catalog entry Design-System Phase 2 added (tooling-only, §0.3 of that audit) is direct rendered evidence Rule 21's vocabulary reaches the UI correctly (KEEP item 4 of that audit) — worth citing the next time "wired, tested and inert" comes up, since the UI side is not inert |
| 8 | Move a Run | DEFERRED WITH REASON | Unchanged |
| 9 | Coaching voice | PARTIAL | Unchanged from v1 §8 |
| 10 | Progress and fitness | PARTIAL | Unchanged from v1 §8 |
| 11 | Race page | **PARTIAL, updated** | RaceDecisionCardV5 header and RouteMapView marker fixes (rows 105-106) **now CONFIRMED CLOSED on `origin/main`, not merely reviewed-pending**, per this writer's own direct source-diff (§1.22) — Design-System Phase 2's re-discovery of both was against its own stale pin, one day before both fixes landed. Status-bar gradient and sample verdict-string fix unchanged (reviewed/pending). Item #18 (the LIVE-path mis-cased-literal defect) remains OPEN, not disambiguated. Race-projection List/Detail label divergence (row 83) is informational, not a defect |
| 12 | Race morning | DEFERRED WITH REASON | Unchanged |
| 13 | Post-race | DEFERRED WITH REASON | Unchanged |
| 14 | Shoes | **DEFERRED WITH REASON, new finding logged** | Design-System Phase 2 rendered `11a` cleanly (retired-shoe row correctly drops progress bar/chevron); separately, Runner Data v2.1 found `shoes.mileage` stale on 6/8 shoes (row 101) — a data-layer finding, not a rendering one; area status unchanged pending a full re-audit |
| 15 | Health and runner metrics | DEFERRED WITH REASON | Unchanged |
| 16 | Profile/settings | **OPEN, updated** | Items #7/#8 in §7 remain unfixed (unchanged). Design-System Phase 2 rendered `10a`/`account` cleanly, no new defect. Row 71 (unauthorized merge on this area's own branch, `fix/settings-and-undo-rule11`) is now DECIDED — leave merged (§1.21) |
| 17 | Notifications | DEFERRED WITH REASON | Unchanged |
| 18 | Reliability/synchronization | PARTIAL | Unchanged from v1 §8 |
| 19 | Onboarding | DEFERRED WITH REASON | Design-System Phase 2 rendered `9a`/`9a-goal`/`9a-fitness`/`9a-availability`/`9a-reveal` cleanly, one tilde-marker note folded into row 107 (already resolved on the held branch) |
| 20 | Readiness/illness/injury | DEFERRED WITH REASON | Design-System Phase 2 rendered `13a`/`14a`/`15a`/`sick`/`19a`/`19a-refused` — all compliant, no new findings; `19a-refused`'s refusal `Alert` confirmed present in source but not visually confirmed (viewport limit, §0.2 of that audit) |
| 21 | Travel/missed training | OPEN | Unchanged |
| 22 | Cold-start/returning runners | DEFERRED WITH REASON | Unchanged |
| 23 | Additional runner types/goals | DEFERRED WITH REASON | Unchanged |
| 24 | Generalized coaching rules | DEFERRED WITH REASON | Unchanged |
| 25 | App Store/privacy/auth/commercial readiness | DEFERRED WITH REASON | Unchanged |
| 26 | Accessibility/device coverage | **BLOCKED, re-confirmed not resolved** | Dynamic Type remains explicitly INCONCLUSIVE (row 112) — Design-System Phase 2 ran a representative-subset matrix (4 Dynamic Type categories × 3 iPhone sizes × 9 screens) and caught two of its own measurement errors before reporting (§0.5 of that audit), landing on the same "no visually confirmed size change, possibly a tooling limitation" conclusion as before. No physical-device verification has occurred — this area's status is unchanged, not newly resolved by a larger sample |
| 27 | Dead-code and obsolete-path removal | **PARTIAL, updated** | v1's findings unchanged (dead `-faffLegacy` consumer, `is_peak`/`selectionRationale` open decision). Design-System Phase 2 adds: 40 sites/13 files of legacy `Theme.green` under `-faffLegacy` (row 110, unreachable, not urgent); the training-calendar-sheet gap is a CREATE item, not a removal (row 111) |

**Design-System Phase 2's own KEEP findings** (worth stating so they are not silently lost,
per that audit's own framing): the dark-ink-on-light-ramp gradient accessibility exception;
`12a-noheart`/`12a-gps`'s Rule-11-compliant "don't know/measured zero/read failed" handling,
among the clearest examples of that discipline found anywhere in either audit; `16a`'s
ErrorNote+Skeleton outage handling, exemplary and byte-for-byte matching the design contract;
the `decisions` screen as direct rendered evidence for Rule 21's UI vocabulary (above); and
Phase 1's "single 30-component library, no duplication" and "no hardcoded hex outside the two
token files" findings, both re-confirmed on a more than doubled render set (65 vs. 30 states).

---

*This draft was produced by direct reading of `docs/audit-2026-09-10-canonical-record.md`,
`docs/audit-2026-09-10-brain-adaptation-forensic-audit-v2.1-FINAL.md`,
`docs/audit-2026-09-10-brain-v2-to-v2.1-delta-log.md`,
`docs/audit-2026-09-10-brain-v2.1.1-errata.md`, `docs/PRODUCT_DECISIONS.md` (as it actually
stands, conflict markers included), and CLAUDE.md's Rules 16 and 21; by independent
verification of the four Brain provenance identifiers supplied for this task (all four
confirmed exact — see below); and by a direct `git merge-base --is-ancestor` spot-check of
every branch SHA named in this session's briefing against a freshly-fetched `origin/main`.
This footer describes the SECOND pass's provenance work only (Brain's own re-verification
table below is unchanged from that pass). **This third pass additionally read, in full and
directly:** `docs/audit-2026-09-09-coach-forensic-audit-v2.1.md` and its correction log
(§1.9-§1.14); `docs/audit-2026-09-09-historical-data-forensic-audit-v2.1.md` and its
v2-to-v2.1 delta log, plus a version-conflict check against the other Runner Data files
present in the working tree (§1.15-§1.18); and `docs/audit-design-system-phase2.md` in full
(§1.22, §6) — the latter two folded into this document's ledger, intake table, and 27-area
table for the first time this pass. Two Design-System Phase 2 findings were independently
checked against current `origin/main` by this writer (not merely relayed) and found stale;
that check is disclosed at §1.22 rather than asserted from the audit's own text alone. The
§1.6 caveat ("Coach v2 and Runner Data v2.1's own source documents were not supplied…") is
now historical — both caveats are lifted for FINDINGS as of the second (Coach) and this
third (Runner Data, Design-System Phase 2) pass respectively; Runner Data's SEPARATE
provenance-receipt gate is unaffected and remains open (§1.18). **This fourth pass
additionally read, in full and directly:** `docs/audit-2026-09-11-handback-wave3.md` and
`docs/audit-2026-09-11-handback-wave4.md` — the latter appeared mid-task from a concurrent
session and was treated as authoritative over the former per this task's own instruction
(§1.24) — folded in as §1.24-§1.32, rows 113-130, and the rewritten §4/§5. Every branch and
merge-commit SHA named in either handback was independently checked this pass against a
freshly-fetched `origin/main` via `git cat-file -t` and `git merge-base --is-ancestor`, plus a
direct `git log --oneline origin/main` read to confirm sequencing and a direct `curl` of
`https://www.faff.run/api/up`. **Zero discrepancies were found between either handback and
live git state** (§1.32) — every claimed-merged SHA is a confirmed ancestor of `origin/main`,
every claimed-held SHA is confirmed not merged, and `origin/main`'s tip matches this task's own
briefing exactly.*

**Provenance re-verification, this pass:**

| Field | Claimed value | Independently reconfirmed |
|---|---|---|
| Brain v2.1 final commit | `506e518d65c17820ac5dc102ab71a94b015feffe` | **Confirmed** — real commit object |
| Brain v2.1.1 final commit | `42ab86e1541595288b47e527194b2aa52365cc84` | **Confirmed** — real commit object, current tip of `audit/brain-forensic-2026-09-10` |
| Errata SHA-256 | `6db06f83b71a22860dd68d84c60993341ffe7bf6162ed65dfea0a19f449090aa` | **Confirmed** — `shasum -a 256` matches exactly |
| Errata git-object hash | `5abb7aa9ab9e738cb8c0332b5124038eabe8e9ba` | **Confirmed** — `git hash-object` matches exactly |
