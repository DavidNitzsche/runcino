# Overnight handback — 2026-09-08 — Two-track (Brain/Coach/Backend + Product Experience)

**Status: FINAL, with one open item.** Every fix dispatched this session is merged
to `main` and independently confirmed deployed to production (Railway). **However,
the Final-Integration Verification Addendum at the bottom found that GitHub CI's
full test suite is currently red on this exact `main` HEAD** — two real,
reproducible test failures, one of which this session's own work caused and has
not yet fixed as of this line. Read the addendum before treating this session as
fully closed; it is the more current information relative to everything above it.
No agent is still running as of the addendum's own writing, though a fix for the
CI failure may follow after. The tracker file (`fix_state_tracker.md`, referenced
throughout) is the append-only source of truth underneath this document.

---

## How to read this

Verification language is precise and not collapsed. Four different things, never
used interchangeably below:
- **code inspection** — read the diff, traced the logic, did not execute it
- **automated test** — a test ran and passed/failed in CI or locally
- **simulator rendering** — the real app was built and rendered on a simulator against real or clearly-labeled-synthetic data, screenshotted
- **physical-device verification** — David's own phone, his own account, his own eyes

Nothing in this doc claims physical-device verification unless stated. Every fix
below reached simulator-rendering + automated-test, which is this project's Rule 13
standard for anything the runner will see — that is not the same claim as "David has
looked at it," and this doc does not conflate the two. Several items below are
explicitly flagged as still needing that last step.

---

## Agents involved and their roles

**Orchestration model used all session:** implementer (isolated `git worktree`, own
scratch DB, own simulator/DerivedData) → independent technical and/or Product
Experience reviewer (separate agent, given the original issue not the implementer's
prose, required to independently reproduce and falsify) → orchestrator (this
session) merges only on a clean PASS or non-blocking PASS-WITH-CONDITIONS,
independently confirms Railway deployment, never on the strength of a push alone
(Rule 19). Two branches this session went implementer → reviewer → **FAIL** →
follow-up implementer → merge, rather than a clean single pass — both are called
out below rather than smoothed over.

**Orchestrator:** this session (Sonnet 5) — dispatched every agent below, merged
only on a clean review, independently confirmed every Railway deployment (catching
two real deploy failures in the process), wrote and reconciled this handback.

### Implementer agents (wrote code, isolated worktrees)

| Agent ID | Task | Outcome |
|---|---|---|
| `a70ff7c71d6073a47` | Work-pace wrong-row bug (Today reading a stray/simulator row) | Merged `18450c607`, deployed |
| `aa2fdd9ce8a383025` | Resilience-honesty round 1: pain/illness write fabrication (5 sites) + cancellation-as-outage | Superseded by round 2 after review found a false-claim regression |
| `ae9429ea5f45c7f56` | Resilience-honesty round 2: natural-key idempotency + honest uncertain-vs-failed copy | Merged `15a9ff0f5`, deployed |
| `adedfc578c40f0e8d` | Reprice-reason sentence naming an anchor that hadn't moved | Merged `bef88c509`, deployed |
| `aa1cda83f916745e4` | Evidence "reasoning" sheet: raw field dump → real prose | Merged `027fac340`, deployed |
| `a83de83d90506bab3` | Block `V5Phase` decode gap (hold/progress text, single-phase RECOVERY visibility) | Merged `2e83307d9`, deployed |
| `a0c509eecde58824e` | Contrast fix + calendar skip-day visibility | Merged `5bb7f14af`, deployed |
| `a61e0d8e94724787c` | Glance-state flattering-fallback regression fix | Merged `872d52a94`, deployed |
| `a7c8bec0654dcc547` → `abe1e7ce43b940e87` → `a59529a0d3bb93108` | Settings silent-write-failure, 3 successive rounds closing review conditions | Merged `66e5c0d67`, deployed |
| `a49ba952d6fb286d9` | URGENT: TODAYHERO-1 live-production regression fix | Merged (folded into the TODAYHERO/skip-projection line), deployed |
| `a0ef28c4a427c28bc` | Skip+projection 2A+B FAIL closure | Merged (`dfd6dbbbe`/`1896bea88` line), deployed |
| `ad3ec7d42a212f6f2` | Skip+projection gap-closure follow-up | Merged (same line), deployed |
| `a35e0ae1ed811b2bb` | Calibration-ending repricing sheet contradicting itself | Merged `98adaed86` — first deploy attempt FAILED (see Deploy incidents), retried as `54f5ba4a0`, deployed |
| `a2bcba43e4baeaf5a`, `aa59220412fa0b8c6`, `a4b67693ce34a4c47` | Watch/today dedup round-4 follow-ups | Merged (`4d158ebb8` line) / one superseded, not merged |
| `af762a4cfca137106` | Recap/glance-state follow-up | Merged into the `872d52a94` line above |
| `ae9bbed843ba35272` | Injury check-in path: 5 findings + 2 adjacent (permanent-404-shown-as-uncertain, duplicate writes, inert Undo, etc.) | Merged `41141fb89`, deployed |
| `a4c10210845fc73ea` | Today's-run screen: 7 PX findings (overtime-as-work bug, duplicate header, orange strip removal, wrong pace numbers, etc.) | Implemented `dffd749dc`, reviewed PASS WITH CONDITIONS, hit a real merge conflict against the meanwhile-merged per-mile-splits feature, integrated via `ab95168e9ae6c8471` |
| `a7b917fba7cab6748` | Per-mile splits inside long work phases | Merged `6413d3f88`, deployed — found and fixed two errors in my own design brief along the way (see Track B) |
| `ab95168e9ae6c8471` | Integration: resolved the 3-file conflict between the postrun-PX fixes and the per-mile-splits feature, verified both sides' fixes survive together | Merged `154edbf97` — first deploy attempt FAILED (see Deploy incidents), fixed directly as `841f23874`, deployed |
| `a6682610929196525` | RunDetailV5 duplicate "PIECE BY PIECE" (David's own bug report, self-reproduced with file/line refs and a11y-tree confirmation) + a caption/row-count mismatch found in passing (confirmed NOT a one-off — 17/60 real runs affected) | Merged `0b6e9e8ab`, deployed — clean rebase, no conflict with the earlier integration |
| `a561bf706b898ac5a` | Confusing PUSH proposal card ("76 sessions ahead... are paces already at 7:10?") | Implemented `1b0b86cdf`, reviewed **FAIL (blocking)** on a verification-fixture defect (see below), follow-up merged as part of `f1d1def0b` |
| `ac279c81f273a337c` | Follow-up: regenerate the reprice-headline verification fixture properly, document the newly-found chip/headline divergence | Merged `f1d1def0b`, deployed |

*(Note: an earlier version of this table had `a4c10210845fc73ea` and `a7b917fba7cab6748` swapped — corrected; see the tracker log.)*

### Technical reviewer agents (independently falsified a diff, no merge authority)

| Agent ID | Reviewed | Verdict |
|---|---|---|
| `a2594107c2871218f` | Work-pace fix | PASS |
| `ac4f0f3915175b35d` | Recap/glance-state fix | PASS WITH CONDITIONS — found a real regression risk (Site 2) |
| `a3d318eab86965ef8` | Post-run-screen TODAYHERO-1 | **FAIL — live regression on production** |
| `aa506d2b5cebaeca1` | TODAYHERO regression fix | PASS |
| `a30b930e0771862cb` | Reprice-reason fix | PASS WITH CONDITIONS |
| `ae6e660e4991fd581` | Proposal-evidence-prose fix | PASS WITH CONDITIONS |
| `a44becd5924f6570b` | Resilience-honesty round 1 | PASS WITH CONDITIONS — found a serious new defect, triggered round 2 |
| `ad09f611a7762d348` | Resilience-honesty round 2 | PASS WITH CONDITIONS, none blocking |
| `afc764362ec27e6d6` | Block decode-gap fix | PASS WITH CONDITIONS |
| `a9f7af901f237c27c` | Settings failure state (round 2C) | PASS WITH CONDITIONS |
| `a2aa393916c4c4ab8` | Settings final verification | PASS, MERGE GO |
| `ab355e41fc152680d` | Skip+projection (2A+B) | **FAIL** |
| `a6cde109df13c8f05` | Watch/today, reviewed commit `89f3cc5d0` | PASS WITH CONDITIONS — independently re-proved race-safety at 120×14 trials against the real coalescer, but PASS WITH CONDITIONS is treated as blocking for this Tier-1 fix, which is why a third round followed |
| `ad56bbb6997fc5df1` | Watch/today, reviewed commit `f6cca966d` (branch `fix/watch-today-real-coalescer-test`) | PASS WITH CONDITIONS — both conditions explicitly comment/annotation-only, confirmed non-blocking; the two one-line fixes were applied directly by the orchestrator rather than a further round, then merged as `8618ab6ef` |
| `a13fb1738eea5b04e` | Calibration-contradiction fix | PASS WITH CONDITIONS, nothing blocking |
| `ae9db1730ec333505` | Injury check-in path fix (7 findings) | PASS WITH CONDITIONS (8 non-blocking) — closed 2 of the implementer's own disclosed gaps by rendering what they couldn't |
| `a0d0fa8d11f9c063a` | Today's-run screen fixes (7 findings) | PASS WITH CONDITIONS, recommended merge — closed the implementer's own disclosed indoor-rendering gap; found 2 non-blocking issues |
| `ac53c8366e7c16ad7` | Per-mile splits feature | PASS WITH CONDITIONS (8 non-blocking) — independently re-derived every number from scratch, resolved a FaffTests ambiguity in the feature's favor |
| `a41fcd1b7392d9826` | RunDetailV5 duplicate-header fix | PASS WITH CONDITIONS (5 non-blocking) — falsified the implementer's most load-bearing claim directly by rendering the counterfactual, found a real gate blind spot along the way |
| `a7671717782dcb699` | PUSH proposal card wording fix | **FAIL (blocking)** — a hand-edited verification fixture asserted a render the code didn't actually produce; engine logic itself confirmed correct |

### Product Experience reviewer / investigator agents

| Agent ID | Scope | Verdict |
|---|---|---|
| `a8c5ee3a046c2124f`, `a608f85fdebff6744`, `a88b2101cfd8f72cf` | Original PX pass v1 | Stopped ~25min in — methodology didn't pin a common baseline SHA per David's guardrails; minimal work lost |
| `ab670eb5e6facd617` | PX review, post-run screen | PASS WITH CONDITIONS |
| `a11a2149c19c7b45f` | Settings PX review, reviewed the then-final merged Settings state | PASS WITH CONDITIONS — measured contrast/flicker findings confirmed good, but found a **new real defect** (Condition 1: a failed write renders as landed, with the tab-bar RUN pill contradicting the screen same-frame) caused by an interaction between two individually-correct prior fixes; triggered a further round |
| `a35f1700791ab5782` | Skip+projection PX review, reviewed commit `1896bea88` | PASS WITH CONDITIONS — found a real 1.08:1 contrast failure on the race-day fault-red dash (systematic, not an edge case), which is what the later contrast fix (`5bb7f14af`) closed; also flagged a design-judgment item (Condition 2) and a Rule-16 incidental unrelated to this fix, both queued rather than fixed |
| `a64c547c4e2729cf6` | Settings, third technical review | PASS WITH CONDITIONS (round 3) — all 3 core fixes confirmed real via independent falsification both directions, but found 3 medium-severity issues (a mislabeled test-data claim, a silently-skipping UI test reporting false-clean, and one test whose verdict wasn't actually decided by the mechanism it names) |
| `a89b9921a4a6f67b8` | Skip+projection, second technical review | PASS WITH CONDITIONS ("still not clean") — flicker fix and 3-state contract confirmed sound, but found 2 real gaps: an unGated deadline value, and a scanner allowlist that is file-level rather than statement-level (a sixth inline skip-predicate copy planted in an already-allowlisted file stayed undetected) |
| `a0ad332b17ecfc1f1` | Skip+projection, final verification | PASS, MERGE GO — all 4 gap-fixes independently reproduced by falsification with exact matching messages |
| `a90c3ca8ec1028363` | PX-A v3 — Today/Watch/post-run | Full journey/persona pass, pinned to a fixed SHA |
| `a72eba2899c5001fd` | PX-B v3 — Block/Decisions/Races + IA challenge | Full journey/persona pass |
| `a400b2a82bd623968` | PX-C v3 — resilience + visual sweep | Full journey/persona pass |
| `a7498f22db342463f` | Track A v2 — bounded backend safety-net check (1 positive + 1 negative case) | Backend-side counterpart running alongside the PX passes |
| `ae72ec150b04ead69` | PX spot-check: Block TAPER label + single-phase RECOVERY | PASS (TAPER) / PASS WITH CONDITIONS (RECOVERY) |
| `ac773a102727773d1` | PX spot-check: 3 resilience-honesty paths (niggle, injury check-in, shoe pick) | PASS / **FAIL** (injury check-in, 5 findings) / PASS WITH CONDITIONS |
| `a075bcdbe4c7e6845` | PX review: today's real completed run, David's own screenshots | 3 MAJOR + 3 MODERATE + 1 polish finding, direct verdict given on the orange bar (remove it) |
| `ac300f173dacd64f3` | Investigation: per-mile splits feasibility + design (no code) | Design validated against real data, handed to implementer |

### Investigation agents whose findings were logged but not acted on this session

`a7f9f82014b3fc97e` (mileage-responsive planning), `afa2438088e7bc98a` (continuous mileage evidence), `a240cb72dae64a7e4` (live phase-aware arbitration wiring), `a7c3062a3d392cec2` (classifyEvidence canonical owner / organic-push-full-proof), `ab7eda4308a96774e` (plan-snapshot latency investigation) — all predate the round-4/PX-pass work above; findings are in the tracker log for continuity but were not re-opened this session (don't reopen closed investigation without a concrete new trigger).

---

## Deploy incidents (both resolved, production never at risk)

Two of tonight's twelve deploys FAILED on their first attempt — both times on the
identical, unrelated cause, both times independently caught (not assumed) by
directly querying Railway rather than trusting a successful `git push`:

1. **`98adaed86`** (calibration-contradiction fix) — failed on a build-container timeout in `lib/runner-state/_owner_agreement.test.ts` test 7, a live production-DB liveness check with vitest's bare 5000ms default. Retried with a content-free empty commit (`54f5ba4a0`) — succeeded.
2. **`154edbf97`** (postrun-PX + phase-splits integration) — failed on the **identical** gate, same symptom. Confirmed as recurring rather than a one-off; fixed directly (mechanical infra change, not coaching logic) by giving that specific check an explicit 20000ms timeout, with the incident history cited inline in the code comment. Pushed as `841f23874` — succeeded.

Production served the prior good build throughout both gaps; verified by direct HTTP check each time, not assumed. **Watch item:** if this gate times out again even at 20s, the right fix is moving it off the build-blocking path entirely rather than raising the number a third time.

---

## Track A — Brain / Coach / Backend

### What became more operational tonight

- **Today's post-run work-pace/HR stats** now read from the canonical run row instead of an occasional stray/simulator row (`18450c607`).
- **Recap and glance-state** no longer silently flip a real day's grade toward a more flattering answer when identity matching fails (`872d52a94`).
- **The reprice/repricing pipeline** (proposal generation, headline, body) had three separate honesty defects closed across the night: an anchor-naming mismatch (`bef88c509`), a self-contradicting calibration-ending sheet (`98adaed86`), and a headline that answered the wrong question entirely while double-counting a number already shown elsewhere (`f1d1def0b`).
- **The evidence "reasoning" sheet** is real coach prose now, not a raw engine-field dump (`027fac340`).
- **Settings** closed a full 5-round arc: a failed write can no longer stand on screen looking landed (`66e5c0d67`).
- **The injury check-in path** closed 5 real Rule-11 violations plus 2 adjacent honesty defects, the most serious being a permanent, deterministic failure that was rendered as merely uncertain on a safety-adjacent screen (`41141fb89`).
- **Per-mile splits** now exist for long work phases — a feature David asked for directly, single-sourced server-side so Today and Run Detail cannot disagree (`6413d3f88`).
- **Today's post-run screen** closed a real data bug (a cool-down phase rendering with full work-visual-weight because an `overtime` phase type wasn't in the type union), a duplicate header, a direction-blind belief-tension sentence, and 3 more presentation defects (integrated as `154edbf97`/`841f23874`).
- **Run Detail's own duplicate "PIECE BY PIECE"** — the sibling of the Today-screen duplicate, present since before tonight and made materially worse by the new per-mile-splits nesting — is closed, with a new gate (`check-duplicate-sections.sh`) that would have caught it (`0b6e9e8ab`).

### What was verified (not just implemented)

Every merged fix above went through independent review with real production-shaped
data (via `walk-substrate.sh`/`adapt-harness-substrate.sh`) and simulator rendering.
**This claim is itemized, not blanket** — see the corrected count below; not every
merged commit individually carries a fresh Rule-18 falsification, and two (the empty
retry commit `54f5ba4a0` and the deploy-gate timeout fix `841f23874`) are pure infra
changes with no simulator rendering step at all, verified by automated test only.
Of the 20 code-content fixes reviewed tonight, every one went through independent
review with real production-shaped data and simulator rendering; a Rule-18
falsification (pre-fix defect reproduced, then confirmed fixed) is explicitly
recorded for each in the tracker except the three pure-infra/retry commits named
above, which had nothing to falsify.

**The synthesis below originally said "two branches failed review" — that
undercounts what actually happened.** Correcting here: counting every explicit
**FAIL** verdict plus every **PASS WITH CONDITIONS** that this project's own
review-state discipline treats as blocking (a Tier-1/runner-facing fix cannot
advance past PASS WITH CONDITIONS without a further round), there are **at least
9 distinct blocking-class review outcomes** across the session, not two:

1. `a3d318eab86965ef8` — post-run-screen TODAYHERO-1 — **FAIL**, live regression on production
2. `ab355e41fc152680d` — skip+projection (2A+B) — **FAIL**
3. `a7671717782dcb699` — PUSH proposal card wording — **FAIL** (blocking)
4. `a9f7af901f237c27c` — Settings failure state, round 2 — PASS WITH CONDITIONS, treated as blocking, triggered round 3
5. `a64c547c4e2729cf6` — Settings failure state, round 3 — PASS WITH CONDITIONS, treated as blocking, triggered round 4
6. `a11a2149c19c7b45f` — Settings PX review (round 4) — PASS WITH CONDITIONS, found a **new** real defect (a failed write rendering completely silent), triggered a further follow-up
7. `a89b9921a4a6f67b8` — skip+projection, second technical review — PASS WITH CONDITIONS, "still not clean," 2 real gaps found
8. `a6cde109df13c8f05` — watch/today, second technical review — PASS WITH CONDITIONS, triggered a third round
9. `a44becd5924f6570b` — resilience-honesty round 1 — PASS WITH CONDITIONS, found a serious new defect, triggered round 2

This list is reconstructed from the tracker and is a floor, not a verified-exhaustive
count — stated as "at least 9" rather than "9" for that reason.

### What remains approval-gated (explicit, not implicit)

- **Migration 166** — untouched, correctly gated, no DDL run.
- **Production data write on proposal row 12** — the reprice-headline fix is correct, but the one live production row's *body* sentence is a persisted string from before tonight's fix and nothing auto-refreshes it. David's phone will now show a new, correct headline over an old, differently-mismatched body until that row is superseded or its `reason` field is explicitly rewritten — a data write, not done without an explicit go.
- **Whether to build a replacement for the deleted orange timeline strip** — deleted for being unreadable (1.18:1 contrast, self-admittedly non-explanatory per its own code comment); if David wants a session-shape visual back, the recommendation is porting the already-correct `RunDetailV5.workoutAnalysisSection` rather than repairing the deleted one.
- **A reprice-anchor label naming inconsistency** ("threshold" vs "threshold pace" across two headline generators) — correctly left as a copy decision rather than a mechanical fix, since changing it repins three test suites' assertions.

### Whether any canonical owner or orchestration regressed

Not independently re-checked this session against the full 16/16 orchestration
baseline mentioned in the standing priorities — this should be re-verified before
treating tonight's work as fully closed. No fix this session added a second answer
to any coaching quantity; every fix consumed an existing canonical resolver
(`mapWatchPhases`, `BeliefTensionRead`, `repriceRead`/`repriceSubject`,
`resolveStoredPhases`) rather than computing its own — checked explicitly in every
review above, not assumed.

### Exact backend blockers, with owner and next action

| Blocker | Owner | Next action |
|---|---|---|
| July-6-HOLD conclusion / safety-rule consistency proof | Unassigned | Needs a dedicated pass; not started |
| Organic-PUSH-path mechanical verification (distinguishing "correctly held" from "push machinery broken") | Unassigned | Needs a dedicated pass; not started |
| Migration 166 | David | Stays gated on his explicit go |
| Orchestration 16/16 re-check | Unassigned — see Final-Integration Verification below for this session's own re-check result | Re-verify before next major merge wave if that result is stale by then |
| Deploy-gate timeout recurrence | This session (mitigated) | Watch; escalate to moving off build-path if it recurs a third time |

### Non-blocking follow-ups found by reviewers, queued for a deliberate pass (not fixed under time pressure tonight)

**Injury check-in path (8 items):** the new "reserve space" tap-swap guard is applied to one screen only, not its sibling (`SickFlareV5`); that same sibling also still has the below-the-fold defect this fix closed elsewhere; a third, unguarded writer (`notifications/ack/route.ts`) can still duplicate a row on the same two tables; a "refused" response doesn't reload the screen; `profile.timezone` is now load-bearing for a write that never needed it; a malformed refusal value would misclassify as permanent (currently unreachable); a cosmetic scroll collision; the fixed "Undo" row still draws a stale chevron alongside its label.

**Per-mile splits (8 items, mostly documentation accuracy):** the feature's own header comment slightly undercounts its threshold-safety population and overclaims "no cliff to smooth" (a real production phase sits 58 feet from the boundary — the feature is still correct because the check is monotonic and presentation-only, but the comment should say so more carefully); the "empty band" argument was measured only on work phases when the derivation runs on all phases (13 non-work phases sit inside the supposedly-empty band); one real phase would render a 0.96mi remainder as a full numeral, violating the app's own partial-mile convention (not currently reachable); two benign 0.01mi rounding exceptions; a pre-existing fork in how the two consuming screens resolve their phase array (matched on every tested run, not caused by this feature); an observably-dead refusal-reason path; one dead code export.

**RunDetailV5 duplicate-header fix (5 items):** the new duplicate-section gate has a real blind spot (two constructions inside one Swift method body both pass silently — verified by injecting an actual duplicate); the deferred `experience.ts` sibling defect's cited frequency ("6 of 60") was independently re-measured as wrong (actual: 15/60 reach the code path, 4/60 emit the affected sentence, 1/60 is wrong) — correct the number wherever it's tracked; two wire fields are now decoded but read by nothing in production code, with a stale doc comment asserting otherwise; a test-coverage asymmetry where only 1 of 4 new tests can catch a row-count regression; the pre-existing `_postrun_surface_parity` test failure (confirmed unrelated to this branch) should be triaged separately.

**PUSH proposal card (documented, not queued — already resolved as an accepted, pinned trade-off):** the direction chip can still show "hold" over a headline naming a real 1–5 sec/mi move, or disagree in sign with the headline. Twice independently confirmed as the correct call (fixing it would create a worse Rule 9 cliff) and is now pinned by a test rather than left as an implicit risk.

---

## Track B — Product Experience

### Central question

Can the runner see and understand the intelligence the backend already produces —
what the coach believes, what evidence changed it, why today's workout exists, why
holding or progressing, what earns the next step, what changed after a decision,
whether a HOLD came from safety, insufficient evidence, or actual underperformance?
No new coaching conclusions were invented anywhere tonight — every fix either
surfaces an existing computed value more honestly or removes a display that
couldn't be made honest cheaply.

### What the runner couldn't understand or find (the complaints that started this)

1. A raw engine-field dump behind "the reasoning," telling David nothing in normal wording.
2. A PUSH proposal card whose header claimed a directional pace change while its own body showed the same pace on both sides — "Are paces already at 7:10?"
3. A duplicated "PIECE BY PIECE" header on his own completed run, with an orange bar chart he correctly identified as meaningless.
4. No way to see a long tempo phase broken down mile-by-mile.
5. (Discovered by review, not reported by David) A cool-down phase silently painted with full work-visual-weight; two wrong pace numbers on the post-run screen; the day's best physiological signal reported as an anomaly with no directional awareness; a duplicate header on Run Detail specifically, made worse by the new per-mile table.

### What was fixed

All five items above — see the Track A operational list, which is the same list
under a different heading (deliberately not repeated twice, per this project's own
Rule 17).

### What was prototyped, not implemented

Nothing structural was implemented directly tonight, per the standing guardrail.
Two items reached "validated design, ready to build" without code shipping until
scrutinized: the per-mile-splits threshold rule and partial-mile convention were
proven against 87 real historical phases before any code was written; the
duplicate-header fix's "which site should own the piece list" decision was verified
against a real counterfactual render (the wrong choice was shown to silently drop a
real run's data) before being finalized.

### What needs David's decision

Consolidated from Track A's approval-gated list: the row-12 data write, the
timeline-strip replacement (or not), and the anchor-label copy inconsistency. No new
items beyond what's already listed there — repeating them here would itself be the
Rule 17 violation this whole pass exists to fix.

### What was physically verified

Nothing tonight reached physical-device verification (David's own phone, his own
eyes) as defined at the top of this document — everything reached simulator
rendering against real production-shaped data plus automated tests, which is one
step short. **This is the honest gap in tonight's work**, not a claim to paper over:
every fix should be considered "should be correct, verified as far as this session
can verify" rather than "confirmed working" until David has opened the app himself.

### PX spot-checks completed, no code change needed

- **Path 1, niggle flag**: PASS — solid across all 4 states, retry-no-duplicate confirmed, no over-broad guard.
- **Path 3, shoe pick**: PASS WITH CONDITIONS — 2 minor copy/layout conditions, non-blocking, queued above.
- **Block TAPER / single-phase RECOVERY**: PASS on TAPER (reviewer recommends against a label change a technical reviewer had flagged, having now seen it rendered); PASS WITH CONDITIONS on RECOVERY (one copy-adjacency finding; the widened gate currently benefits zero of David's actual plans since all predate the underlying feature — correct behavior, unrealized benefit).

---

## Synthesis — does the interface reveal the brain's power, or still trap it?

Closer than at the start of the night, and the gap is now better characterized than
it was. Every fix landed tonight was in the same family: a real, computed, often
already-correct backend answer was being displayed dishonestly, redundantly, or not
at all. None of them were the interface inventing new intelligence; all of them were
the interface either hiding intelligence that already existed (the raw evidence
dump, the duplicated headers eating a runner's attention before the real verdict) or
asserting something false about it (the contradictory calibration sheet, the
anomaly-labeled durability win, the "76 sessions" framing crowding out the direct
answer, the cool-down phase painted as work).

The recurring shape worth carrying forward: **the backend is measurably ahead of
what any single screen currently says about it.** `BeliefTensionRead` already
carried a `direction` field the display layer wasn't reading. `actual_pace` was
already on the wire while one screen recomputed a worse number from rounded
distance instead. `mapWatchPhases` already existed as the single source of truth and
just needed one more field. The reprice payload already carried per-anchor moves
while the headline averaged them into nonsense. This is a good sign for the
architecture — the "one brain" boundaries held all night; every fix consumed an
existing canonical value, none rebuilt logic on the Swift side. That held across
at least 9 distinct blocking-class review outcomes this session (corrected count
above, in "What was verified") — most of them real functional defects the review
pipeline caught before they shipped (a live-production regression, real
duplicate-write gaps, a silent-failed-write case), and exactly one purely a
verification-artifact problem rather than an engine defect. None were "one brain"
architectural violations — the pipeline is doing what it's for — and a clear
instruction for what comes next: **audit for more of this exact shape before
inventing anything new.** The three-defects-on-one-card pattern found on the PUSH
proposal (Rule 17 repetition + wrong-question framing + a mean masking a signal)
is worth treating as a checklist for every other proposal-type card, not a one-off.

What tonight did not do, and should not be read as having done: verify anything on
David's actual phone, resolve the two standing backend priorities untouched this
session (the July-6-HOLD proof and the organic-PUSH-path distinction), or re-confirm
the 16/16 orchestration baseline. Those are the honest boundaries of this session's
work, not gaps to gloss over in the next one.
## Final-Integration Verification Addendum

Appended after David flagged that the report's status language and a handful of
specific claims needed correction before this could serve as a trustworthy final
record. This section is the requested verification, not a restatement of the fixes
above.

### 1. Final `main` HEAD

**`f1d1def0bedbb6db76c86ec89f8dc16f3ff9715d`** — confirmed by direct `git rev-parse
origin/main` and cross-checked against `git ls-remote origin main` (both agree).
Commit timestamp: 2026-09-08T14:53:33-07:00.

### 2. Clean working tree

Confirmed via a fresh detached-HEAD checkout of that exact SHA in an isolated
worktree: `git status --short` returned empty. Local `.git` also had ~2,000
AppleDouble (`._*`) sidecar files from this machine's recurring WP-volume issue,
which had corrupted local ref-names and object-store entries with benign garbage
(`git fsck` showed `badRefName`/`bad sha1 file` on the sidecar paths specifically).
Swept them and re-ran `git fsck --full`: zero errors, only ~848 dangling objects
(expected after a night of heavy rebase/worktree activity, not corruption). This was
entirely local-machine housekeeping — the remote was never affected, confirmed by
the `git ls-remote` match above holding before, during, and after the sweep.

### 3. Combined-tree build/test verification

Run against the exact final SHA (`f1d1def0bedbb6db76c86ec89f8dc16f3ff9715d`,
confirmed by `git rev-parse` before and after) in an isolated worktree, own
simulators, own DerivedData, all deleted after. **3 of 4 checks PASS; backend
FAILS on 2 genuine, reproducible test failures — independently corroborated
against GitHub CI on this same SHA, not just asserted locally.**

**iPhone build + FaffTests — PASS.** Signed build (`Sign to Run Locally`, not an
unsigned build). **476 tests executed, 476 passed, 0 failed, 0 skipped**, 59
suites, 21.3s. Matches GitHub CI on this exact SHA exactly (also 476/0).

**Watch build + watch gate — PASS**, after one environment-only false start (a
never-booted simulator failed to install the test host — a launch-environment
issue, zero tests ran, not a product failure; resolved by booting first and
re-running). Full run: **223 test cases across 16 suites** (matches the 223
`@Test` declarations in source — nothing silently unbuilt), **22 boards** rendered
and pixel-audited against the 46mm content box (0 overflow, 0 blank), run-endable
check passed. Noted as a gate-robustness gap, not a fix: `check-watch.sh`'s retry
heuristic doesn't recognize a "failed to install the test runner" error and reports
it as a product failure rather than retrying.

**Backend (web-v2) — FAIL.** `npm run prebuild` (30 scripts) exit 0. `tsc --noEmit`
exit 0. `npx vitest run` (full suite, no glob, CI's exact environment —
`ALLOW_AUDIT_SKIP=1`, no `DATABASE_URL`/`DATABASE_URL_RO`) exit 1: **12106 total,
11899 passed, 2 failed, 1 expected-fail, 205 skipped.** Both failures confirmed
genuine (checked, not assumed — neither file references any DB env var or
`skipIf`; both are pure static analysis; both reproduce in isolation) and
**independently corroborated on GitHub Actions for this exact SHA** (run
`34283072957`, same two tests, same messages):

1. **`lib/adaptation/_belief_source_pins.test.ts`** — `lib/race/race-outlook.ts`
   changed (`ce2742b28`, 2026-09-07 18:31, "PLANSNAPSHOT-LATENCY-1 +
   READS-DEDUP-1") since its pinned digest was last set, without re-pinning.
   **Pre-dates this session's active window** — not caused by tonight's work, but
   live and CI-red on `main` right now. The test's own message states this is a
   decision (bump the epoch if resolved belief values moved, or re-pin the digest
   alone if it was a pure refactor) — not touched here, flagged for whoever owns
   `race-outlook.ts`.
2. **`lib/format/_format_lint.test.ts`** — flags `lib/coach/_replay_glance_done_state.script.ts`
   for a rounding-rule violation. **Caused by tonight's own merged work**
   (`872d52a94`, the glance-state regression fix, 06:00 this session). This is a
   real, currently-red CI failure this session introduced and left unfixed until
   now — see the fix dispatched below.

**Why this went unnoticed until now:** neither failing file is inside
`surface-sweep.yml`'s globs, which is what `scripts/verify-commit.sh` actually
runs, and `prebuild` runs no vitest file at all — so this project's own
merge-time self-check reports PASS on a commit that CI's full suite rejects. The
same Rule-19 shape ("cover the last step") as the build-container timeout found
earlier tonight, one gate further down the chain.

**Two more findings from the read-only CI cross-check, not fixed here:**
`native-check` is failing on GitHub for an unrelated reason — its own log-parsing
step reads the *last* "Executed N tests" line in the build log, which belongs to
`FaffUITests` (10 tests) rather than `FaffTests` (476 tests, actually green) when
the full scheme runs both — a gate parsing bug, not a product regression.
Separately, `test-full.yml`'s skip-count ceiling (120, set against 62 observed
skips on 2026-09-01) is now exceeded by legitimate credential-gated skips (205,
all verified to be `*.db.test.ts`/`*.audit.test.ts`/etc., none a disabled product
test) — the ceiling is stale, not the tests being switched off, but it means
`test-full` would still go red on its own liveness gate even after both real
failures above are fixed.

**Orchestration 16/16 — PASS, and Rule-18 falsified, not just read.** The actual
check is `lib/brain/orchestration/_orchestration.test.ts` (not
`check-client-graph.sh`, which is a different gate) — `WIRED_STEP_PIN = 16`,
all 16 declared orchestration steps confirmed `state: 'WIRED'`, 9/9 tests pass.
Falsified directly: the pin was bumped to 17, the ratchet correctly failed
naming the regression, then restored byte-for-byte and re-confirmed 9/9 green.

**Caveats stated by the verifying agent, carried forward honestly:** `next build`
itself was not run directly in this pass (a separate gate, `check-web-build.sh`;
covered externally by GitHub's `build-check`, which is green on this SHA, but not
independently re-run here). No physical rendering against real data was
performed in this verification pass — this is build-and-test evidence only, not
a Rule-13 render. The vitest run used no database by design (matching CI's own
posture), so the 205 DB-gated tests did not execute in this pass — including
`shadow-compare.ts` coverage.

### 4. Reviewed SHA → landed SHA mapping

Verified by literally diffing each commit's own patch (via `git show --pretty=format:
<sha> -- .`, i.e. what that commit itself introduces relative to its own parent —
not a raw two-commit diff, which would wrongly include everything else that landed
on `main` in between) against the corresponding commit in the other position. This
is real verification, not an assumption: two of the seven pre-compaction fixes
checked this way surfaced a real finding on first attempt (an apparent mismatch),
which turned out to be because I'd initially paired the implementer's commit against
a later "review conditions" follow-up commit instead of against its own true landing
point — corrected below by finding the right pair from the actual git log chain.

**Tonight's active-window fixes (12 commits) — personally verified at merge time,
every one via `git diff --stat` immediately before push, not assumed:**

| Fix | Reviewed commit | Landed commit | Content relationship |
|---|---|---|---|
| Calibration-contradiction | `98adaed86` | `98adaed86` (redeployed unchanged as `54f5ba4a0`) | Byte-identical; `54f5ba4a0` is a content-free empty retry commit, not a code change |
| Injury check-in path | `a4410972a` | `41141fb89` | Byte-identical (clean rebase, 0 conflicts, diff-stat confirmed exact: 13 files, +1110/-66) |
| Per-mile splits | `5c7bb4a878` | `6413d3f88` | Byte-identical (already up to date with main, 0 rebase needed) |
| Today's-run PX fixes | `dffd749dc` | integrated into `154edbf97` | **Materially changed by a real 3-file merge conflict** — see below, not byte-identical |
| Deploy-gate timeout fix | *(no separate review — see note)* | `841f23874` | N/A — self-executed infra fix, not coaching logic; see note below |
| RunDetailV5 duplicate-header | `1f4ab754c` | `0b6e9e8ab` | Byte-identical (reviewer independently confirmed 0-conflict rebase via `git merge-tree --write-tree`; I then rebased and confirmed diff-stat exact: 5 files, +458/-37) |
| PUSH card wording | `1b0b86cdf` | superseded — see next row | Reviewed and **FAILED (blocking)** on a hand-edited verification fixture; never merged standalone |
| PUSH card wording, fixture fix | `c85bd8e78` (based on the failed `1b0b86cdf`) | `f1d1def0b` | Byte-identical for both commits combined (clean 2-commit rebase, no conflicts, diff-stat confirmed exact: 8 files, +698/-37) — **but this was my own orchestrator-level diff-stat check, not a third independent review cycle of the combined 8-file result; see note below** |

**Note on the deploy-gate timeout fix (`841f23874`):** this was a mechanical,
non-coaching-logic infra change (a test timeout value) that I wrote and pushed
directly myself, per this project's own "Operational tasks · self-execute" doctrine
— there is no separate reviewer to cite because none was dispatched, correctly, not
because one was skipped that should have run.

**Note on the today's-run PX integration (`154edbf97`/`841f23874`):** this is the
one case this session where conflict resolution materially changed a reviewed
diff, and it is disclosed as such, not smoothed over. `dffd749dc` (7 findings,
independently reviewed PASS WITH CONDITIONS) conflicted against `6413d3f88`
(the meanwhile-merged per-mile-splits feature) in exactly 3 files:
`RepBreakdownV5.swift`, `TodayAfterV5.swift`, `web-v2/app/api/v5/today/route.ts`.
A dedicated integration agent resolved the conflicts and reported: a comment-only
resolution in `route.ts`; a pure-adjacency resolution in `RepBreakdownV5.swift`
(kept the deleted timeline strip removed, kept the newly-added mile-split table,
no logic overlap); one merged argument list in `TodayAfterV5.swift`. **Post-
integration verification performed:** the integration agent rendered both fixes'
behavior together on real production-shaped data (confirmed all 7 of the
postrun-PX fixes AND the mile-splits feature visible correctly on one card),
ran the full test suite, and specifically re-ran a Rule-18 falsification of the
overtime-phase fix against the *unmerged* `main` to prove the merged tree's fix
is real rather than assumed. I then independently confirmed the diff-stat of the
final integration branch matched exactly what the integration agent reported (12
files, +933/-162) before pushing. **What this addendum cannot claim:** a fresh,
independent third-party reviewer did not re-review the specific 3 conflict-resolved
files as a standalone diff after integration — the verification above is real, but
it is the integration agent's own extensive self-verification plus my own
orchestrator-level diff-stat check, not an independent re-review cycle equivalent to
what every other merge tonight received. If this needs to meet the same bar as
everything else, that re-review is the next concrete step, not yet done.

**Note on the PUSH-card wording fixture fix (`f1d1def0b`):** similarly, the 8-file
combined result (original engine-logic fix + fixture correction) was diff-stat
verified by me as the orchestrator (clean rebase, 0 conflicts) but not sent through
a fresh third independent review cycle of the combined result — the engine logic in
`1b0b86cdf` was independently reviewed and found correct; the fixture correction in
`c85bd8e78` was reviewed by the same agent that found the original blocking defect,
who confirmed the fix and re-ran the relevant falsifications, but this was the
follow-up implementer's *own* verification, not a separate reviewer's.

**Pre-compaction fixes — independently re-verified in this addendum by diffing each
commit's own patch against its true landing point (not assumed from the tracker):**

| Fix | Implementer's reviewed commit | True base landing commit on `main` | Content relationship |
|---|---|---|---|
| Work-pace wrong-row | `373ce51d8` | `18450c607` | Byte-identical **except one documented, deliberate merge-time change**: `swallowed-failure-registry.ts`'s `EMPTIED_BASELINE` ratchet value, combined with a second independently-landed fix's own decrement of the same constant — this was a known merge conflict I resolved and explicitly logged at the time (combining both decrements rather than picking one), not undisclosed drift |
| Glance-state regression | `00bda5d42` | `15c19834b` (base) + `872d52a94` (review-conditions follow-up, on top) | Base is byte-identical; the follow-up commit is a small, separately-authored, git-log-labeled polish ("review conditions — deterministic tie-break, honest fence, honest framing"), not hidden rework |
| Contrast + calendar visibility | `b9d64d2d4` | `b425a759f` (base) + `5bb7f14af` (follow-up) | Byte-identical base; follow-up is `check-panel-ink.sh`'s own missing-directory gate fix, separately labeled |
| Reprice-reason names the mover | `758cd3c18` | `3b1bbad0c` (base) + `bef88c509` (follow-up) | Byte-identical base; follow-up is a doc-comment correction, separately labeled |
| Resilience-honesty round 2 | `db3ba313e` | `15a9ff0f5` | Byte-identical, no separate follow-up needed |
| Evidence-prose rewrite | `0aeb6cb9a` | `7fbdc2c44` (base) + `027fac340` (follow-up) | Byte-identical base; follow-up is a corpus-provenance/guard correction, separately labeled |
| Block phase-decode gap | `47446422b` | `47446422b` (base) + `2e83307d9` (follow-up) | Base commit unchanged; follow-up is a one-line whitespace-trim condition fix, separately labeled |

**Settings (4-round arc: `a7c8bec0654dcc547` → `abe1e7ce43b940e87` → `a59529a0d3bb93108`,
landed as `66e5c0d67`): NOT independently re-verified at this same byte-level of rigor
in this addendum.** A spot-check of the final round's own commit (`784783a06`)
against its apparent landing point (`fae3d2d7b`) showed a patch-size mismatch (473
vs. 979 lines) consistent with the multi-round branch history having been
squashed or restructured when finally merged, which the simple "diff each commit's
own patch" technique used above cannot cleanly separate. Each round was
independently reviewed at the time (see the reviewer table above — 4 separate PASS-
WITH-CONDITIONS-or-better verdicts across the arc), but this addendum did not
re-derive byte-for-byte confirmation that the final merged state matches the sum of
those reviews. **Disclosed as a real gap in this addendum's own thoroughness,** not
glossed over — if this needs closing, it needs its own dedicated pass, not a
five-minute spot-check.

### 5. Production proposal row 12 — status, and the exact write prepared for approval

**This remains separately unresolved and is not described as closed anywhere in
this document.** The reprice-headline *generator* fix is merged and correct; the
one live *row* it would apply to was created before that fix existed and is not
automatically rewritten.

**Current, exact production state** (confirmed just now via `DATABASE_URL_RO`,
read-only, on David's own account):

- Table: `plan_workout_proposals`, `id = 12`, `user_uuid = 0645f40c-951d-4ccc-b86e-9979cd26c795`, `action_kind = 'reprice'`, `status = 'pending'`, `source = 'cron_reanchor'`, `created_at = 2026-09-08 07:00:28.478337+00`.
- Underlying repricing decision (`action_payload.reprice.anchorMoves`, `evidence`) is **not proposed to change** — only the two prose fields that describe it, both of which the merged fix would produce differently if this row were generated fresh today. Verified by two independent agents rendering the actual fixed code against this exact row's real data (not inferred, not synthetic) — both arrived at the identical "after" strings below.

**Exact before/after:**

| Field | Path | Before (current, live) | After (what the fixed code produces for this exact row) |
|---|---|---|---|
| Body | `reason` (top-level column) | `Your recent training puts your threshold at 7:10 per mile. This block is written at 7:10 per mile.` | `Your recent training puts your easy ceiling at 8:12 per mile. This block is written at 8:22 per mile.` |
| Body (duplicate) | `action_payload->>'why'` | *(same string as above)* | *(same string as above)* |
| Headline | `action_payload->'action'->'action'->>'describe'` | `76 sessions ahead move to faster paces` | `Easy ceiling moves to 8:12 across the block` |

Everything else in the row — `anchorMoves`, `workoutsAffected` (76),
`meanAnchorDeltaSecPerMi`, `evidence`, `status`, `created_at`, `plan_workout_id`,
`workout_date_iso`, `source` — is unchanged by this proposal. This is a text-only
correction to the two sentences the runner reads, not a change to the repricing
decision itself.

**Prepared SQL (NOT executed — awaiting explicit per-statement approval):**

```sql
BEGIN;

-- Pre-flight: confirms we are targeting exactly the expected row/values.
-- If this returns 0 rows, STOP — the row has already changed; do not proceed.
SELECT id FROM plan_workout_proposals
WHERE id = 12
  AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'
  AND action_kind = 'reprice'
  AND status = 'pending'
  AND reason = 'Your recent training puts your threshold at 7:10 per mile. This block is written at 7:10 per mile.'
  AND action_payload->'action'->'action'->>'describe' = '76 sessions ahead move to faster paces';

UPDATE plan_workout_proposals
SET
  reason = 'Your recent training puts your easy ceiling at 8:12 per mile. This block is written at 8:22 per mile.',
  action_payload = jsonb_set(
    jsonb_set(
      action_payload,
      '{why}',
      to_jsonb('Your recent training puts your easy ceiling at 8:12 per mile. This block is written at 8:22 per mile.'::text)
    ),
    '{action,action,describe}',
    to_jsonb('Easy ceiling moves to 8:12 across the block'::text)
  )
WHERE id = 12
  AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'
  AND action_kind = 'reprice'
  AND status = 'pending';
-- Expect exactly 1 row updated.

-- Post-write readback — confirm before committing.
SELECT id, status, reason,
       action_payload->>'why' AS why,
       action_payload->'action'->'action'->>'describe' AS describe
FROM plan_workout_proposals
WHERE id = 12;

-- COMMIT only if the readback above shows the "after" values exactly.
-- ROLLBACK otherwise.
```

**Rollback (reverts to the exact current production values):**

```sql
UPDATE plan_workout_proposals
SET
  reason = 'Your recent training puts your threshold at 7:10 per mile. This block is written at 7:10 per mile.',
  action_payload = jsonb_set(
    jsonb_set(
      action_payload,
      '{why}',
      to_jsonb('Your recent training puts your threshold at 7:10 per mile. This block is written at 7:10 per mile.'::text)
    ),
    '{action,action,describe}',
    to_jsonb('76 sessions ahead move to faster paces'::text)
  )
WHERE id = 12 AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795';
```

**Write scope:** exactly one row (`id = 12`), two columns (`reason`,
`action_payload`), and within `action_payload` exactly two of its many keys
(`why`, `action.action.describe`). Zero other rows, zero other tables. No DDL —
data only, on an existing row, no schema change.

**Not executed.** Per this project's standing policy, this is prepared for David's
explicit per-statement go and has not been run.
