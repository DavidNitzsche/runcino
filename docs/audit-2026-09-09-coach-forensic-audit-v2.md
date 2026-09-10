# Coach Forensic Audit — v2 (corrected)

This is a **corrected pass** over [`docs/audit-2026-09-09-coach-forensic-audit.md`](audit-2026-09-09-coach-forensic-audit.md)
("v1"), which is preserved unchanged. This document does not repeat v1's
full evidence trail for findings whose substance is unchanged — it states
the current-state classification and cites v1/the track files for detail.
Where a finding's substance, severity, or ownership changed, the full
corrected reasoning is here. See
[`audit-2026-09-09-coach-forensic-audit-v1-to-v2-correction-log.md`](audit-2026-09-09-coach-forensic-audit-v1-to-v2-correction-log.md)
for a compact diff of every change and why.

**This correction pass did not rerun the four audit tracks.** It re-verified
a fixed list of material findings against current `origin/main` (in isolated
detached worktrees, never the shared checkout), corrected evidence-tag
misuse, resolved the branch-integration question against current reality,
reclassified findings by true ownership domain, incorporated one new Brain
dependency, and ran an independent adversarial review over the highest-
severity claims. No code was fixed, merged, or cherry-picked.

---

## 0. Source pinning

| | |
|---|---|
| Base SHA the four original tracks actually audited | `80fca013f94b99ee5af3f84e79590591d42141da` (`origin/main`, stated explicitly in Track 2 §1.1: *"main HEAD at audit time: 80fca013f"*) |
| `origin/main` at this correction's completion | `99757c1204f27a1fa86504efd580842bc81c72b2` — **27 commits ahead** of the audited base (`git log 80fca013f..origin/main --oneline \| wc -l`) |
| Shared checkout's current branch (informational only — not audited, not modified) | `audit/brain-forensic-2026-09-10`, HEAD `c99d924ea` — a concurrent session's Brain/historical-data audit branch, sharing this working directory. This Coach audit never switched this branch and made no edits to any file already tracked on it. |
| Fix branch referenced throughout | `origin/fix/coach-voice-tie-and-primer`, tip `7aacb0e36d19804a3a399fc48cc80a385a4a99ef` |
| All re-verification in this correction | performed in isolated `git worktree add --detach` checkouts of `origin/main` @ `99757c120`, symlinking `node_modules`, removed after use. Zero edits to the shared checkout at any point in this correction pass. |

Twenty-seven commits landed on `origin/main` between the audited base and
this correction, including — critically — **the merge of the fix branch
itself** (`cf531f4d9`, see §3) and a related watch/recovery fix
(`259d7aa1d`, `feat(watch): WALKBACK-2`) that turned out to matter for the
new stride-day Brain dependency (§6).

---

## 1. Evidence-label correction: `[RENDER]` retracted throughout

**Every `[RENDER]` tag in v1 and in Track 4 is corrected to `[SRC]`.** No
simulator or device screenshot was taken anywhere in this audit — Track 3
said so explicitly and left device verification `[BLOCKED: not attempted]`.
Track 4 and v1, however, defined `[RENDER]` as "confirmed against the exact
Swift `Text(...)` call site" and used it that way in six places. Tracing a
composed value to the line of Swift that calls `Text(...)` on it is a
**source read**, not a render — it does not confirm what actually appears on
a screen (layout, truncation, a higher-priority view modifier suppressing
it, a stale cached payload, localization, dynamic type, etc. are all
invisible to a source trace). Per Rule 13, this must be labeled honestly.

**Corrected citations** (v1 §12 item 10, and Track 4's Defects A/B):

- *"Confirmed rendered via `DecisionHistoryV5.swift:209-210`"* → **corrected to** *"traced to the `Text(decision.why)` call site at `DecisionHistoryV5.swift:209-210` — a source trace, not a device confirmation"* `[SRC]`.
- *"Confirmed rendered via `CoachLogCard.swift:125-126`"* → same correction, `[SRC]`.
- v1 §11's "Rendered evidence" section header claim — *"`[RENDER]`-confirmed (exact Swift `Text(...)` call site traced...)"* — is retracted. There is **no `[RENDER]`-tier evidence anywhere in this audit.** Every claim is `[SRC]`, `[TEST]`, `[PROD-RO]`, `[INF]`, or explicitly `[BLOCKED]`.
- The runner-visible behavior of every finding whose only evidence was a Swift call-site trace (the VDOT-leak render sites, the DecisionHistoryV5/CoachLogCard sites) is **unverified** in the Rule 13 sense: the string is confirmed to exist and to be passed to a `Text(...)` call in source, but whether it is what a runner actually sees on the current build, unobstructed and untruncated, has not been confirmed by this audit. This does not change the underlying finding (the jargon token is genuinely in the string), but it downgrades the confidence tier of the "reaches the runner" claim from confirmed to highly-likely-but-unverified.

This correction applies retroactively to how every finding below should be
read: any "confirmed live/rendered" language in v1 that traced only to a
`Text(...)` call site is downgraded to "confirmed in source, reaching a
render call site; on-device appearance unverified."

---

## 2. Per-finding current-state classification

Re-verified against `origin/main` @ `99757c120` in isolated worktrees,
several by re-running real tests, one by writing and executing a fresh
adversarial fixture. Numbering matches v1 §12's severity table.

| # | Finding | Status vs. audited base | Notes |
|---|---|---|---|
| 1 | `HowItWentPanel.swift` "second brain" | **STILL PRESENT in source, but DEAD CODE — reclassify off the blocker list entirely** | See §5. `TodayPostRunBody.swift:826` gates the whole panel to `hiwEffort == .intervals`, which routes to a *third*, different struct (`RepsPostPanel`) with no HR-drift ladder at all. The two structs carrying the inconsistent thresholds (`AerobicStampPanel`, `ThePLongPanel`) are `private` and unreachable by any runner today. |
| 2a | Proposal accepted-then-failed stuck at `'accepted'` | **SUPERSEDED** | `reopenProposal()` now runs on every apply-failure path (`accept/route.ts:255,298,328`), correctly resetting the row to `'pending'`. Fixed since the audited base. |
| 2b | `outcomeOfWorkoutRow` has no `'failed'` case | **Moot** | Dead code path — since 2a means `'failed'` is never written to the status column, the missing case can never fire. |
| 2c | `'superseded'` (a safety override) maps to `'expired'` | **STILL PRESENT, live write path confirmed** | `workout-proposals.ts:220-224` writes `status='superseded'` in a real competing-proposal path; `outcomeOfWorkoutRow`'s `default` branch (still, `v5-decisions.ts:105`) maps it to `'expired'`. The gate's own status fixture (`_v5_decisions.test.ts:44`) still omits `'superseded'` from its enumeration, so the passing test provides zero coverage. |
| 2d | SAFETY_STOP decline (422) decodes as a generic outage | **STILL PRESENT IN CODE, but UNREACHABLE TODAY — reclassify off the blocker list** | See §5. `ProposalCardV5.swift`'s `isAnswerable` is true only when `standing == .proposal`; `standingOf()` maps every `RECORD_ONLY`-executor action (SAFETY_STOP included) to `standing: 'notice'`, which never renders a decline button. The 422/key-mismatch bug is real and should be fixed (Rule 18: an unexercised safeguard is a hypothesis), but the runner cannot currently trigger it through the shipped UI. |
| 3 | `standing-recommendation.ts` single-domain trigger | **STILL PRESENT, confirmed live and wired end-to-end** | `accept-standing/route.ts` closes the loop by writing a `coach_intents` row the same file reads back to suppress re-firing — confirmed a real, reachable, non-dead code path. **Remains a release-severity finding.** |
| 4 | TIEFIX-1 / PRIMER-SPECIFIC-1 (both known bugs) | **SUPERSEDED — fix is merged, independently confirmed three times** | See §3. `_primer_specific.test.ts` (26/26) and `_sentence_repetition.test.ts` (0 findings, 95 exempted) both pass against current `origin/main`. |
| 5 | C-race told "rest is the work now" | **STILL PRESENT** | `generate.ts:9652-9668`'s frequency-cap branch still has no `race.priority` check, unlike the B-only branch immediately above it (`:9634`) which proves the codebase already knows how to gate this. `race-week-role.ts:27-29`'s "never treated as a taper week" ruling for C races is still directly contradicted. |
| 6 | `training-influence.ts` "0s slow" fabrication | **STILL PRESENT** | `composeTrainingInfluence()` line 111/114, `Math.max(0, delta)` confirmed at line 114, `composeSlippingCopy`'s `${paceDeltaSec.toFixed(0)}s slow` confirmed at line 186-187. No test file exists for this composer. |
| 7 | Cutback `whyCutback`/`whyMileage` unconditional "down" claim | **STILL PRESENT — re-confirmed by direct execution** | A fresh scratch test against `deriveBlockStrategy()` (mileage 30→40, `isCutback:true`) reproduced the false "Down from 30 mi... the reduction is deliberate" claim on a week whose volume rose. |
| 8 | Readiness "five independent narrators" | **STILL PRESENT as a systemic pattern — specific example list corrected** | The core defect (multiple uncoordinated numeric readiness thresholds) is real and demonstrable, but two of the five originally-named functions need correction: `health-actions.ts#voice()` has since been stripped to a pure passthrough (superseded, dated comment confirms 2026-09-02) and should be dropped from the list; `morning-brief.ts#bandPhrase` was never independently thresholding — it dispatches on a pre-computed shared band and should never have been listed as a fifth narrator. A previously-unlisted independent threshold system was found instead: `readiness.ts:863`'s z-score-based pull-back band (`BAND_Z`). Net count of genuinely independent threshold systems is still ≥4 (`synthesis.ts`, `readiness-brief.ts`'s two functions with three distinct threshold types between them, `health-actions.ts`'s `HARD_RULES` outside `voice()`, and `readiness.ts`'s `BAND_Z`), just not the same five as originally named. |
| 9 | Heat-drift invented causality | **STILL PRESENT** | Line numbers shifted by ~1 (1066→1065), logic unchanged. `run-recap.test.ts` (45/45 passing) does not cover this specific gap. |
| 10 | VDOT jargon leaks (5 call sites) | **STILL PRESENT** | All five sites confirmed with minor line drift. Render-site claims corrected per §1 — traced to `Text(...)` call sites, not device-confirmed. |
| 11 | ACWR/limiter jargon in unscanned `lib/coach` | **STILL PRESENT** | Literal tokens confirmed still present and confirmed to reach a render call site (via `HealthView.tsx:717` / `HealthView.swift:282`, both `[SRC]`-traced, not device-confirmed). Gate scope (`jargon_targets()`) confirmed still excludes `lib/coach`/`lib/plan`. |
| 12 | Duplicated aerobic/HR-ceiling verdict | **STILL PRESENT** | `readCost` (no grace band) vs. `hrCapBreached` (`HR_CAP_GRACE_BPM = 1`) confirmed still independent, still diverge at the 1bpm boundary. |
| 13 | HOLD-proposal cross-surface contradiction | **STILL PRESENT** | `outcomeOfWorkoutRow` confirmed to still have no `'notice'`/`RECORD_ONLY` branch; `standingOf()` confirmed to correctly return `'notice'` for the same action. The asymmetry is unchanged. |
| 14 | Race projection List-vs-Detail label divergence | **STILL PRESENT** | Confirmed: a separate, earlier fix (`raceProjectionFromOutlook`) unified the *numeric value* across surfaces (2026-08-30/09-01) but never touched the *label/framing/range* divergence this finding describes — the two are genuinely separate defects, and only the first was closed. |
| 15 | Moved-run reason never reaches the runner | **STILL PRESENT, with one partial mitigation** | `GET /api/plan/move` was fixed 2026-09-05 ("RS-2 FIX") to plumb the runner's `note` through — but `POST /api/plan/move` (the path an in-app move actually uses) still drops it, and even where `note` is threaded through on GET, no composer reads it to vary copy. The byte-identical-copy defect as originally described stands. |
| 16 | Evidence Engine's date-only prescription lookup | **STILL PRESENT** | Confirmed unchanged. The independent reviewer additionally found the practical exposure is narrower than "confirmed live" implies for most cases (an `ANCHOR_MOVE_MIN_WEIGHT` gate self-limits most inherited-intent scenarios) but identified one genuinely uncapped path — see §5, Claim 3. |
| 17 | `computeTodayExecution` fallback grading + false "no runner has read a wrong word" comment | **STILL PRESENT, comment reconfirmed false** | All three other real consumers in `glance-adapter.ts` (hero verb, stat tile, poster prose) confirmed still present and still capable of rendering the fallback-graded value; the file's own mitigating comment is unchanged and still contradicted by its own dependency graph. |
| 18 | Three-way "why this run" vocabulary duplication | **STILL PRESENT** | Confirmed, including the specific verbatim-phrase drift between all three composers. |
| 19 | Four independently-computed "longest run" quantities | **STILL PRESENT** | All four confirmed unchanged, including the specific asymmetry that the sibling "FASTEST PACE" tile in the same native function was already fixed the same way "LONGEST RUN" needs to be. |
| 20 | `BLOCK_STANDING_SENTENCES` table gap | **STILL PRESENT** | Confirmed, exact strings still absent from the table. |
| 21 | `FAMILY_NOTES` cross-week repetition | **STILL PRESENT** | Confirmed; the repetition gate's own header still explicitly documents the cross-week blind spot as by-design (not yet closed). |
| 22 | `accessibilitySummary` duplication | **STILL PRESENT** | Confirmed, exact scenario still reachable. |
| 23 | Watch/phone verbatim reuse | **STILL PRESENT, confirmed deliberate** | The "character for character" design-intent comment is still present verbatim at the route. |
| 24 | `layerOne` 2-of-3 clause cap | **STILL PRESENT — file relocated, framing corrected** | The file moved from `web-v2/lib/postrun/explanation.ts` to `web-v2/lib/faff/explanation.ts:178-183` (introduced fresh in commit `0d4f3498e`, not a pure rename — this consolidated multiple prior explanation paths). The cap's behavior is unchanged, but it is **no longer an undocumented oversight**: a doc comment now states the tradeoff explicitly and `_voice_corpus.test.ts` (35/35 passing) asserts the 2-sentence cap as intended design. **Reclassify from "REFINE, material" to "a documented design tradeoff worth revisiting, not a silent bug"** — the plan-impact clause is still dropped from Layer 1 in the common case, which may still be worth fixing, but it is a product decision to challenge, not a defect to patch. |
| 25 | `health-state.ts` four-pillar fake-precision | **STILL PRESENT (backend), confirmed latent (client)** | Re-confirmed zero `muscleStatus` references anywhere in `native-v2`. |

**Corpus/scenario findings in v1 §4** (the required-scenario walkthrough — cutback week, race week vs. tune-up, supplemental run, duplicate/absorbed run, etc.) were not independently re-run against current `origin/main` line-by-line in this correction pass beyond the specific findings enumerated above, which cover the highest-severity claims from that section. The scenario narratives in v1 §4 should be read as **accurate as of the audited base (`80fca013f`) and spot-confirmed accurate as of `99757c120`** for every specific claim re-verified in the table above; anything in v1 §4 not covered by an item in this table carries the same confidence it had in v1 (untouched by this correction).

---

## 3. The Coach-branch contradiction — resolved

**v1's central premise here is stale and its recommendation is moot.** v1
(Track 1 §0) found that `origin/fix/coach-voice-tie-and-primer` was behind
`main` and warned that a naive merge would delete ~50 unrelated files
(`docs/PRODUCT_DECISIONS.md`, native watch tests, etc.), recommending a
cherry-pick of two commits instead of a merge.

**What actually happened, independently confirmed by two separate passes in
this correction (the orchestrating session and the adversarial reviewer):**

- `origin/main` contains commit **`cf531f4d9`**: *"Merge fix/coach-voice-tie-and-primer (7aacb0e36) into integration branch."*
- `git merge-base origin/main origin/fix/coach-voice-tie-and-primer` = `7aacb0e36d19804a3a399fc48cc80a385a4a99ef` — exactly the fix branch's tip. `git merge-base --is-ancestor origin/fix/coach-voice-tie-and-primer origin/main` returns **true**.
- `git diff origin/fix/coach-voice-tie-and-primer origin/main -- web-v2/lib/plan/generate.ts web-v2/lib/plan/runner-instruction.ts` is **empty on both files** — `origin/main`'s versions are byte-identical to the fix branch's, not a divergent rewrite that happens to pass the same tests.
- The files v1 worried would be deleted (`docs/PRODUCT_DECISIONS.md`, `native-v2/Faff/FaffTests/WalkBackCompletionLabelTests.swift`, `native-v2/Faff/Faff/ViewsV5/StaleStateV5.swift`, `web-v2/app/api/watch/workouts/complete/route.ts`) **all still exist on `origin/main`**, at full size, not stubs.
- `_primer_specific.test.ts` (26/26) and `_sentence_repetition.test.ts` (0 findings, 95 exempted) both pass when run directly against `origin/main` @ `99757c120` — run independently three separate times across this correction (orchestrating session, verification agent, adversarial reviewer), all three with identical results.
- The remaining `git diff` between the fix branch and current `origin/main` (84 files, 219 insertions / 7,262 deletions) is **`origin/main` having moved forward** — deleting old observability/replan-outcome/recovery-ended-early modules the fix branch predates — not evidence of anything being lost from the fix. `origin/main` is a strict superset of the fix branch's content plus unrelated later work, confirmed by the diff direction (net deletions are all in files that exist only on the now-stale fix branch, none of which touch the two coach-voice files).

**Exact commits that transferred, and how:** `bc8010bbe` (TIEFIX-1 +
PRIMER-SPECIFIC-1), `49be10229` (independent-review-condition follow-up),
`7aacb0e36` (a falsification-count correction to `_primer_specific.test.ts`'s
own doc comment). Test files that transferred with them:
`web-v2/lib/plan/_primer_specific.test.ts` (new) and
`web-v2/lib/plan/_sentence_repetition.test.ts` (extended). All four are
confirmed present, unmodified relative to the source branch, on
`origin/main` today.

**What integration method was actually used, and was it safe:** the merge
commit message ("Merge ... into integration branch") indicates this went
through a reconciling integration-branch process — merging the fix branch
alongside `main`'s other concurrent work into a shared integration branch
before it became today's `origin/main` — rather than a raw `git merge
fix/coach-voice-tie-and-primer` from a stale local `main`. This is exactly
the "dry-run the merge/cherry-pick in an isolated detached worktree,
inspect conflicts, don't regress" discipline CLAUDE.md's branching section
calls for, and the empty diff on the two core files plus the intact
unrelated-file set confirms it was executed correctly. **The safest
integration method is the one that was used.** There is no further
integration action to take — the recommendation in this correction is
**verification, not a new merge/cherry-pick**, and per this task's own
instruction, none was performed.

**Expected final diff, for the record (already realized, not prospective):**
zero net change to `generate.ts`/`runner-instruction.ts` beyond what the fix
branch itself specified; zero files deleted; the two new/extended test files
added. This is what `origin/main` already shows.

---

## 4. Ownership reclassification — Coach owns presentation, not underlying semantics

Per instruction, findings whose root cause is a decision/data-model/
transaction-state problem — not a coaching-language problem — are
reclassified below by true owner. **Coach's remaining scope on each is
narrowed to: render whatever the owning layer concludes, honestly and
consistently — never re-derive the underlying judgment itself.**

| Finding cluster | True owner | What stays in Coach's scope | What must NOT be a Coach-layer fix |
|---|---|---|---|
| Supplemental-run evidence matching (findings 16, 17; v1 §4/§8's "supplemental run" scenario) | **Brain / execution identity** (Activity Interpreter, per `BRAIN_CONSTITUTION.md`) | Render whichever run/prescription match `lib/execution/day-resolver.ts`'s canonical resolver produces; never independently disambiguate which run satisfies which prescription. | `load-activity-evidence.ts`'s date-only lookup and `glance-state.ts`'s fallback-to-biggest-canonical-run are Brain-owned identity-resolution bugs. Coach must not patch them with its own heuristic — it should point both call sites at the canonical `day-resolver.ts` resolver `postrun/load.ts` already uses correctly, which is an identity-layer fix, not a copy fix. |
| Proposal transaction/outcome state (findings 2a-2d, 13) | **Brain / adaptation** (the proposal state machine, `LEGAL_TRANSITIONS`, executor classification) | Render the outcome the state machine actually recorded, honestly, including the label mapping (`outcomeOfWorkoutRow`). | The missing `'superseded'`/`'notice'` cases in `outcomeOfWorkoutRow` are a **presentation-layer mapping gap** Coach does own (it's choosing which word to show for a state Brain already recorded correctly) — this one stays with Coach. But *whether* a decline should be `NOT_DECLINABLE`, *whether* an apply failure should reopen to `'pending'` vs. some other state, and the SAFETY_STOP/422 key shape itself are Brain/API-contract decisions; Coach's fix is limited to "read the keys the API actually sends and map every state that actually exists to a distinct, honest word," not to redesigning the state machine. |
| Race/cutback derivation (findings 5, 7, and the `is_cutback` flag generally) | **Plan / Brain** (Plan Generator, `H` in the Constitution) | Render whatever character (`CUTBACK`/`RACE`/`RECOVERY`/etc.) Plan assigns to a week, and say only what that character supports. | Coach must **not** independently compute `vol < prevVol` as a workaround inside `strategy-contracts.ts` to patch around a bad `is_cutback` flag — that would be Coach re-deriving Plan semantics, exactly what this correction was told to guard against. The actual fix belongs in Plan Generator: `is_cutback`'s derivation (`generate.ts`) and `embedMidBlockRaces`'s missing priority branch both need to produce a *correct* flag/derivation; Coach's job is only to stop asserting "down"/"reduction" language when the flag it's handed doesn't actually support that claim (i.e., Coach may add a guard that suppresses the directional claim on disagreement, but should not silently substitute its own volume comparison as the new source of truth). |
| Readiness convergence (finding 8, `standing-recommendation.ts`) | **Brain** (Readiness/Current State, Rule 2's convergence discipline) | Render whichever single readiness verdict the convergence-gated resolver (`convergence.ts`) produces. | `standing-recommendation.ts` computing its OWN single-domain trigger and its own severity ladder is itself a Brain-boundary violation — Coach is doing Brain's convergence job. The correct fix is not a Coach-side copy change; it's deleting `standing-recommendation.ts`'s independent trigger logic and having it consume the existing convergence-gated surface, or removing the module if that surface already exists and is sufficient. |
| Race-number semantics (finding 14, the List-vs-Detail divergence; the dormant `achievable-target.ts` second producer) | **Brain / Race** (Race Prediction, Goal Feasibility) | Render whichever field Brain designates as the primary number for a given screen, consistently. | Which of "Projected" (List) or "Race it at" (Detail) should be the number a runner tracks — and whether both should carry the same range/confidence treatment — is a Race-Prediction semantic decision about what these two numbers *mean*, not a wording choice. Coach should not decide this unilaterally; it should surface the disagreement to whoever owns `race-outlook.ts`/`race-page-layers.ts` and render whatever single answer comes back, everywhere, the same way. |
| Move-a-Run reason persistence (finding 15) | **Schedule-management backend** (the reschedule/replan API surface) | Render the runner's own stated reason once the backend actually captures and persists it. | The `note` field being dropped by `POST /api/plan/move` and never read downstream is a backend data-capture defect, not a copy-generation defect — Coach cannot invent language explaining a reason the backend never recorded. This is explicitly out of Coach's fixable scope until the backend captures the field. |

**Findings that remain squarely Coach-owned, unchanged by this
reclassification** (these are genuinely about how many independent
language generators exist and whether they agree/repeat, which is exactly
Coach's architecture mandate): the three-way "why this run" vocabulary
(#18), the four "longest run" naming collisions (#19), the
`BLOCK_STANDING_SENTENCES`/`FAMILY_NOTES` repetition gaps (#20, #21), the
`accessibilitySummary` duplication (#22), the watch/phone verbatim-reuse
design choice (#23), the `layerOne` clause cap (#24), the VDOT/ACWR/limiter
jargon leaks and the gate-scope gap that lets them through (#10, #11), the
duplicated aerobic/HR-ceiling verdict (#12) — this one sits closest to the
boundary (the *correct threshold* is a Brain/Activity-Interpreter call, but
*having two independent implementations at all* is squarely a Coach/
architecture finding regardless of which threshold turns out to be right —
and the heat-drift invented-causality finding (#9), which is a pure
prose-composition choice (whether to check a fact already in hand before
asserting its negation), not a data-derivation question.

---

## 5. Independent adversarial review — corrections to severity

A fresh, uninvolved reviewer was run specifically against the five
originally-stated release blockers, the supplemental-identity claim, the
proposal-status/SAFETY_STOP claim, the branch-integration recommendation,
and the final severity/TestFlight classification. Full findings folded into
§2's table; the severity-relevant conclusions:

- **Finding 1 (HowItWentPanel "second brain") is real in source but
  unreachable.** `TodayPostRunBody.swift:826` gates the entire panel to
  `hiwEffort == .intervals`, which routes to a *third* struct
  (`RepsPostPanel`) with a completely different grading scheme and no
  HR-drift ladder at all — confirmed via a full recursive grep finding no
  other call site. The two structs carrying the inconsistent thresholds are
  `private` and structurally unreachable. **A release blocker must be
  reachable by a runner; this one is not. Downgraded to a cleanup/dead-code
  item** — delete the dead structs or, at minimum, correct the file's own
  header comment to state plainly why two of its three verdict branches are
  unreachable.
- **Finding 2d (SAFETY_STOP renders as generic outage) is a real code-level
  bug that the shipped UI currently forecloses.** `ProposalCardV5.swift`'s
  `isAnswerable` gate and `standingOf()`'s `RECORD_ONLY → 'notice'` mapping
  mean the phone never shows a decline button for a SAFETY_STOP card in the
  first place — so the specific failure mode (a runner declining a safety
  stop and getting a nonsensical "try again") cannot currently occur.
  **Downgraded from release blocker to a hardening/defense-in-depth
  ticket** — the underlying key mismatch should still be fixed on Rule 18
  grounds (an unexercised safeguard is a hypothesis, not a guarantee), but
  it is not blocking anything today.
- **Finding 3 (supplemental-run evidence identity) holds, with the
  justification narrowed.** The reviewer traced the downstream consumer
  (`ANCHOR_CAPABLE_INTENTS` + `ANCHOR_MOVE_MIN_WEIGHT`) and found most
  inherited-intent scenarios are self-limiting — a low-effort supplemental
  run generally can't cross the anchor-move weight bar regardless of what
  intent label it borrowed. **But one genuinely uncapped path survives**:
  `capSingleActivity`'s unconditional evidence-ceiling bypass for
  `RACE`/`TIME_TRIAL` intent, with no weight gate at all — a supplemental
  run on a day whose plan row happens to be a scheduled race/time-trial
  could inject uncapped, wrongly-provenanced evidence. **Kept on the
  findings list, re-scoped to this specific mechanism** rather than "date-
  only lookup generally corrupts evidence weighting."
- **Finding 4 (branch-integration recommendation) is confirmed correct as
  resolved in §3**, independently re-derived by the reviewer via the same
  `merge-base`/empty-diff evidence.
- **Findings 6 and 7 ("0s slow" fabrication, cutback false-reduction claim)
  were not in scope of the reviewer's blind search** (it wasn't given the
  original file:line citations and searched for a literal string that
  doesn't exist as a fixed constant). Both remain **CONFIRMED STILL
  PRESENT** on the strength of the dedicated verification pass in §2, which
  cited exact current file:line evidence and, for finding 7, executed a
  fresh adversarial fixture against the real composer.

**Revised exact next-TestFlight blockers** (supersedes v1 §15):

1. **C-race "rest is the work now" claim** (finding 5) — confirmed live,
   directly contradicts an explicit doctrine ruling, will visibly fire for
   any runner with a mid-block C-priority race.
2. **Fabricated "0s slow" claim** (finding 6) — confirmed live, produces a
   numerically-specific false claim on any faster-but-incomplete session.
3. **False cutback "down/reduction" claim** (finding 7) — confirmed live by
   direct execution against an adversarial fixture.
4. **HOLD-proposal cross-surface contradiction** (finding 13) — confirmed
   live, a runner can see the same card read as calm on one screen and
   urgent on another.
5. **`standing-recommendation.ts`'s single-domain trigger** (finding 3) —
   confirmed live and wired end-to-end; this is a doctrine (Rule 2)
   violation with runner-facing consequences, not a wording defect, and
   belongs to Brain per §4, but its user-facing symptom is a Coach-audible
   overclaim ("ease this run" stated with unwarranted confidence) and
   should not wait on a full Brain-side redesign to at least stop
   presenting the recommendation as more settled than one domain supports.

**Removed from the blocker list** (both downgraded per the adversarial
review above): the HowItWentPanel second-brain finding (dead code) and the
SAFETY_STOP-renders-as-outage finding (unreachable through the shipped UI).
Both remain real, tracked findings — just not release-blocking ones.

---

## 6. New Brain dependency — stride-day recovery honesty

**Reported dependency:** *"The current execution verdict can falsely treat
stride-workout recovery honesty as passing because `strides_recovery_s` is
not read by the grading path."*

**Confirmed accurate.** `web-v2/lib/execution/verdict.ts`'s
`resolveWorkoutVerdict()` reads exactly two spec fields for recovery
grading — `spec.rep_rest_s` and `spec.strides_reps` — and never references
`spec.strides_recovery_s` anywhere. The stride-bolt-on authoring path
(`web-v2/lib/plan/spec-builder.ts`'s `strideFields()`) writes
`strides_recovery_s: 60` but **never** writes `rep_rest_s`, so for any
stride-bearing session the grading path's prescribed-recovery input is
always `null`. `recoveriesHonestOf()` filters to recovery records with a
non-null prescribed duration before it will compute a `true`/`false`
verdict; with no stride recovery record ever qualifying, it returns `null`
("no signal") rather than `false`, and `sessionLadder()` treats
`recoveriesHonest !== false` as passing. **Net effect: a stride session's
recovery discipline — whether the runner actually rested between reps —
cannot currently affect the session's execution verdict at all, in either
direction.** A second, independent gap compounds this: the watch's wire
struct (`WatchCompletionPhase`) never sends back a prescribed recovery
duration at all, so even a spec-side fix would still need a non-wire
(opts-level) source for it.

**Coaching-language consequence, per instruction:** any coaching statement
built from an `'executed'`/`'nailed'`/`'hit'`/`'controlled'`/`'completed'`
verdict on a stride-bolted-on session is now classified
**BLOCKED ON BRAIN TRUTH** until this grading gap closes and is verified.
This affects, at minimum:

- `web-v2/lib/postrun/experience.ts`'s `strideClause` + the verdict-gated
  headline it's appended to (e.g., the constructible sentence "Easy run
  stayed controlled. Six strides completed." makes no distinction between
  honest 60s recoveries and rushed 8-second ones) — `[SRC]`, not rendered.
- `web-v2/lib/coach/glance-state.ts`'s Today "nailed"/hero-verb surface for
  any stride-bearing day — `[SRC]`.
- Every other direct caller of `resolveWorkoutVerdict()` for a stride-
  bearing session: `app/api/v5/today/route.ts`, `lib/postrun/load.ts`,
  `lib/postrun/detail-load.ts`, `app/api/runs/[id]/recap/route.ts` — `[SRC]`
  for call sites, downstream wording not individually traced in this pass.

**Not a copy fix.** Per §4's ownership rule, Coach must not independently
invent a recovery-honesty check to paper over this — the fix belongs in the
grading path (`resolveWorkoutVerdict()` needs a stride-aware prescribed-
recovery source, and/or the watch wire needs to carry one). Coach's only
correct move today is to **stop implying recovery discipline was validated**
for stride-bolted-on sessions until that fix lands — i.e., the `strideClause`
and any "controlled"/"executed" framing for these sessions should not be
read as vouching for recovery quality, and no new copy should be written
that would make that implication stronger.

**One open disambiguation, explicitly flagged rather than assumed either
way:** `_recovery_ended_early.test.ts` ("WALKBACK-2", merged to `origin/main`
via `259d7aa1d` since the audited base) fixes a related recovery-honesty
defect by hand-setting `targetDurationSec` directly on synthetic phase
objects — a field this investigation found **no production writer for**.
Two readings are possible: WALKBACK-2 fixes a *different* stride mechanism
(a `rep_rest_s`-bearing catalogue "reps" structure, which does set
`rep_rest_s` correctly) and the `strides_recovery_s` bolt-on gap described
above is a separate, still-open defect; or WALKBACK-2's own fix may
currently be unreachable in production for the bolt-on path specifically.
**`[BLOCKED: needs a real `runs.data.phases` + `plan_workouts.workout_spec`
row for a stride-bolted-on-easy day, pulled from `faff_readonly` — not
resolvable from code inspection alone]`.**

---

## 7. Artifact completeness

| Artifact | Path | SHA-256 |
|---|---|---|
| v1 consolidated report (unchanged) | `docs/audit-2026-09-09-coach-forensic-audit.md` | `9392a4e86ee7799237890ffda94d0b0c356935ad2db31e0a08a12f15ca84b42c` |
| Track 1 — architecture ledger | `docs/reports/coach-audit-2026-09-09/track-1-architecture.md` | `d1ada1d61dd68861b82050b728cc74fadab59e75b26b56722a05ea9dd2aaa6b1` |
| Track 2 — corpus truthfulness | `docs/reports/coach-audit-2026-09-09/track-2-corpus-truthfulness.md` | `f6c9a0fe2b5ed42ec8bfc2036d5972d0bf6f1e451816147f6b011cb558c616e0` |
| Track 3 — cross-surface | `docs/reports/coach-audit-2026-09-09/track-3-cross-surface.md` | `5531f5fd6113b052cd8b01a5091ba333eb05c8a281da0085e41844129223d370` |
| Track 4 — voice/usability | `docs/reports/coach-audit-2026-09-09/track-4-voice-usability.md` | `90493de840584a7a794f5ba1e528768e920d30dc89e8290711f7de89540fec43` |
| v2 (this document) | `docs/audit-2026-09-09-coach-forensic-audit-v2.md` | not self-hashed (a hash embedded in the file would invalidate itself on write) — integrity is via the git commit SHA below instead |
| Correction log | `docs/audit-2026-09-09-coach-forensic-audit-v1-to-v2-correction-log.md` | `a19d7c0e7e25de305aa3687fce2902d6a1f51db63a23285c884930d305778206` (unchanged since first written) |

All four track reports are preserved exactly as originally written —
**not edited** as part of this correction, including their own `[RENDER]`
tag-definition looseness (Track 4's and v1's), which is superseded by §1 of
this document rather than retroactively altered in the original evidence
files. This keeps the original evidence trail intact and append-only; §1 of
this document is the authoritative correction to how those tags should now
be read.

**Repository state at time of writing:**
- Branch: `audit/brain-forensic-2026-09-10` (shared checkout; not switched, not created by this audit)
- `origin/main` at completion: `99757c1204f27a1fa86504efd580842bc81c72b2`
- This audit's own changes to the shared checkout were strictly additive and scoped to new files (`docs/audit-2026-09-09-coach-forensic-audit*.md`, `docs/reports/coach-audit-2026-09-09/**`) — no existing tracked file was modified by this Coach audit. The shared checkout separately carries uncommitted modifications from the concurrent Brain audit session (`docs/audit-2026-09-09-historical-data-forensic-audit.md` and its domain reports) — those are untouched and not staged by this commit.
- Initial commit (v1 report + all four track files + this v2 + the correction log, added via explicit-path `git add`, no other tracked file touched): `d76b81f20d27a442847122ba918de115979ea308`, on branch `audit/brain-forensic-2026-09-10`. **Local commit only — not pushed.** Per this project's audit-doc convention, pushing/relocating this commit (e.g. onto `main`) is a decision for the programme lead, not taken unilaterally here.
- A follow-up commit adds this closing paragraph itself (see repository history immediately after the SHA above) — an unavoidable one-line chase since a commit's own SHA cannot be known before it exists.
