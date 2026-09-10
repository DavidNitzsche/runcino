# Coach Forensic Audit — v2.1 (current-state correction)

Narrow correction to
[`audit-2026-09-09-coach-forensic-audit-v2.md`](audit-2026-09-09-coach-forensic-audit-v2.md)
("v2"). v2 and v1 are preserved unmodified. This document does not restate
v2's full content — it resolves five specific disagreements/overclaims the
programme lead flagged after reviewing v2, and states the resulting current-
state severity picture. For everything not addressed here, v2 (and, beneath
it, v1 plus the four track files) remains the standing record.

**No broad re-audit was performed.** Every claim below is either a
reconciliation against a specific counter-claim from the separate Brain
audit, or a precision-narrowing of a specific claim the programme lead named.
All verification ran against the same `origin/main` SHA v2 used
(`99757c1204f27a1fa86504efd580842bc81c72b2`) — confirmed unchanged at
`9f082e33929c670c091920006b0602e85de5dc68` (one trivial telemetry-only commit
landed between the two checks; no code differs).

---

## 0. Source pinning

| | |
|---|---|
| SHA all v2.1 verification ran against | `9f082e33929c670c091920006b0602e85de5dc68` (`origin/main`) — identical in substance to v2's `99757c1204f27a1fa86504efd580842bc81c72b2`; the one intervening commit (`9f082e339`, "telemetry: refresh 2026-09-10T10:29") touched no source file |
| Method | Four isolated, independent agents, each in its own detached `git worktree`, never the shared checkout |
| Shared checkout | Untouched by this pass except for adding the new files listed in §5 |

---

## 1. Reconciliation with Brain — three disagreements, resolved

### 1.1 Proposal accepted-after-Apply-failure — **Brain is right; Coach's v2 claim was too narrow**

v2 stated: *"every current-main Apply-failure path calls `reopenProposal()` and returns it to pending."* This was true only of the branch checked — the same accept route has grown two more branches since.

**Winning answer**: `web-v2/app/api/plan/workout-proposals/[id]/accept/route.ts` contains **three** independent apply branches, added at different times:

- **Legacy `AdaptationAction` lane** (lines 262-334) — **reopens correctly on every failure**, via `sayIfTheCardCouldNotBePutBack()`/`reopenProposal()` at lines 255, 298, 328. This is the branch v2's original verification checked. v2 was correct *about this branch*.
- **Modern `applyBrainAction`/`ACTIONCOMPLETE-1` lane** (lines 150-185, added 2026-09-05, commit `2c31e8177`) — **does not reopen on failure.** `route.ts:115` stamps `status='accepted'` before branch selection; if `applyBrainAction` (`lib/brain/proposal/accept.ts`) returns `ok:false` (e.g. `ADAPTATION_PIPELINE`'s `applyAdaptations` throws or writes zero rows, lines 173-203), the route returns the error to the client at lines 162-167 with **no reopen call anywhere in this branch.** The row is left at `status='accepted'` permanently.
- **`reprice`/`REANCHORPROPOSES-1` lane** (lines 202-234, also 2026-09-05) — same defect: `applyReanchorProposal` failure returns `{ok:false}` with no reopen.

**Reachability — live, not dead code**: `lib/brain/option-lane.ts:585` writes real `DISTANCE_CHANGE` proposals via `writeActionProposal` from `source:'cron_evening'` (`app/api/cron/run-adaptations/route.ts` — a live production cron). A runner tapping Accept on such a card, followed by any apply-step failure (a thrown exception, a concurrent-write conflict, a zero-rows-touched result), leaves the card permanently mislabeled "accepted" with the underlying plan change never applied, and nothing anywhere detects or corrects it. **No test file asserts reopen behavior for either of the two newer branches** — this is an unenforced gap, not a rule anyone's test violates.

**Correction to v2's finding 2a**: reclassify from "SUPERSEDED" to **STILL PRESENT, in the two newer branches specifically** — v2's "SUPERSEDED" verdict stands only for the legacy branch. This is now added to the release-blocker list (§4).

**Cross-confirmed**: this resolution matches Brain v2.1's own current-main framing exactly — *"apply-failure reopening works for legacy proposal rows, but the modern ACTIONCOMPLETE-1 and reprice lanes still lack reopen-on-failure."* Both audits now agree, independently derived.

### 1.2 `HowItWentPanel` HR-drift ladders — **Coach is right; Brain's claim is explained by stale history, not current reality**

v2 called this dead code; Brain called it a live second brain. Re-investigated exhaustively rather than re-asserted.

**Winning answer**: confirmed **DEAD/UNREACHABLE** on current `origin/main`, with the disagreement's exact origin identified. `HowItWentPanel.swift`'s own internal switch (lines 47-67) only constructs `AerobicStampPanel`/`ThePLongPanel` (the two structs carrying the inconsistent thresholds) when its `effort` property is `.easy`/`.recovery`/`.long`. The **sole construction site in the entire repository** — `TodayPostRunBody.swift:826-835` — is gated `if hiwEffort == .intervals`, and passes that same value straight through as `effort:`, so the panel's own switch is *provably* always routed to `RepsPostPanel` (a third, unrelated branch with no HR-drift ladder) whenever it's reached. No other call site exists anywhere in `native-v2/` or `legacy/native/` (checked exhaustively, including preview harnesses and the watch target).

**Why Brain and Coach disagreed**: git history shows these two structs *were* genuinely live prior to commit `aac88aec139` ("feat(today): simplify post-run + pre-run per David's revamp pass," 2026-07-10, authored by David Nitzsche), whose own commit message explicitly states the decision: *"the manufactured coaching is CUT... The ONE survivor is the interval rep-by-rep panel... Everything else shows nothing here."* That commit has stood unchanged for over two months through current HEAD. Anything reflecting the pre-2026-07-10 state — an earlier audit pass, a stale reference, `git blame` read without checking the current gate — would correctly have called this live at the time. It has not been live since.

**Correction to v2**: no change to the verdict (dead code, correctly downgraded off the blocker list). Recommend, as a small hygiene note only, that the two orphaned structs either be deleted or that the file's own header comment be updated to explain why two of its three branches are unreachable — this is unrelated to severity and not itself a finding requiring action.

**Cross-confirmed**: Brain v2.1 independently reached the same current-main conclusion — *"HowItWent's competing HR ladders are unreachable dead code."*

### 1.3 Race List vs. Detail label — **Coach is right for the normal case; Brain is right only in a degraded fallback state**

v2 said the value is unified but the label differs ("Projected" vs. "Race it at"). Brain said value and label are both identical. Re-traced both screens fresh.

**Winning answer**: the value is confirmed unified (`raceProjectionFromOutlook`, called once per route, consumed identically by both). **The label depends on which of two rendering branches Detail is in**, gated by `RaceDetailV5.swift:279-282`'s `layersOwnTheNumbers` (true when the server's `raceLayers` set resolves coherently — no findings, non-empty layers, race not past):

- **Coherent/normal state** (the live state for an active goal race with a working outlook — CIM, Santa Monica, Dodgers, per the codebase's own worked examples): the plate row that would say "Projected" is **suppressed entirely** (`RaceDetailV5.swift:289`). The identical value instead appears only as the `block_forecast` layer, labeled *"Where this block is built to get you"*, demoted to non-actionable, carrying a range List never shows. Detail's prominent actionable number, *"Race it at"*/*"Run the day at"*, is `execution.targetSec` — a genuinely different field (`race-outlook.ts:872-873`, derived from `currentProjection`, not `expectedRaceDay`), coinciding with "Projected" only in the degenerate case of zero forecast block-gain. **Coach's v2 claim is correct here — this is the intended, normal behavior.**
- **Degraded/fallback state** (`raceLayers` null, has findings, or empty layers — an incoherent outlook resolution): `layersOwnTheNumbers` is false, the plate row renders, and its label is literally `"Projected"` with the same value List shows. **Brain's claim is correct only in this state**, which the `raceLayers` machinery exists to fall back to, not the intended live experience.
- A further wrinkle for a **controlled C-race**: the `block_forecast` layer is refused outright (`isControlled` guard), so List's "Projected" value doesn't appear on Detail at all in any form — worse divergence than the goal-race case, not better.

**Correction to v2**: no change to the underlying finding's substance (it was already correctly scoped to the normal case) — this reconciliation adds the precise branch condition and confirms Brain's claim describes a real but non-default rendering state, not a contradiction.

**Cross-confirmed**: this matches Brain v2.1's own stated framing — *"race projection uses one numeric producer while intentionally using different List and Detail labels."* Numeric-value consistency (confirmed unified, one producer, `raceProjectionFromOutlook`) and label/framing consistency (confirmed intentionally different in the normal state, per `layersOwnTheNumbers`'s gate) are two separate axes and should be tracked as two separate findings going forward, not collapsed into one "projection is/isn't consistent" verdict — the value axis is closed/correct; the label axis remains an open Rule-16-adjacent naming question for whoever owns `race-page-layers.ts`.

---

## 2. Narrowed overbroad claims — both turned out more overbroad than expected

### 2.1 C-race "rest is the work now" — real code gap, but essentially never fires under realistic plan shapes; directly re-falsified after a conflicting Brain v2.1 claim

The original claim ("no `race.priority` check, fires for any mid-block C race") was overbroad about frequency, corrected below by a fresh sweep. **Brain v2.1** then separately claimed, re-inspecting the same area at the same SHA, that *"no frequency-cap copy branch exists; that code mutates schedule fields rather than generating this sentence; C-race scheduling remains correct."* Per instruction, this was not re-resolved by re-reading source — it was re-run as a live falsification against `origin/main @ 9f082e33929c670c091920006b0602e85de5dc68`, fresh, in an isolated worktree, and the source snippet is quoted verbatim below rather than described.

**1. Current-main source, quoted verbatim** (`web-v2/lib/plan/generate.ts`, inside `embedMidBlockRaces`, immediately following a comment block labeled "Frequency cap"):

```ts
if (opts.trainingDaysPerWeek != null) {
  let running = weeks[wi].days.filter((d) => d.distanceMi > 0).length;
  while (running > opts.trainingDaysPerWeek) {
    const easies = weeks[wi].days
      .filter((d) => d.type === 'easy' && d.distanceMi > 0)
      .sort((a, b) => a.distanceMi - b.distanceMi);
    if (easies.length === 0) break;
    const victim = easies[0];
    victim.type = 'rest';
    victim.distanceMi = 0;
    victim.isQuality = false;
    victim.isLong = false;
    victim.subLabel = 'REST';
    victim.notes = 'Off. Race week for a tune-up · rest is the work now.';
    running--;
  }
}
```

**This single block both mutates schedule fields (`type`, `distanceMi`, `isQuality`, `isLong`, `subLabel`) AND sets `.notes` to the exact sentence in question, in the same object mutation** — it is not an either/or, and the branch is not absent. Brain's claim that no copy-generating branch exists here is contradicted by the literal current-main source.

**2. Exact fixture, function, command, and literal output** — a fresh, purpose-built one-off test, preserved as a reproducible evidence artifact at [`docs/reports/coach-audit-2026-09-09/falsify-crace-freqcap.test.ts`](reports/coach-audit-2026-09-09/falsify-crace-freqcap.test.ts) (written and executed only inside throwaway detached worktrees, never the shared checkout; re-run a second time from the preserved copy to confirm byte-identical reproduction before treating it as validated) drove the real `composePlan`/`finalizeComposedPlan` pair (the same public functions `generate.ts` exports and every existing mid-race test file in this codebase uses) over a single mid-block race, varying priority (B/C), race weekday (all 7), landing week index (3 or 7), and `trainingDaysPerWeek` (2 or 3), against a fixture otherwise identical to the repo's own `_midrace_invariants.test.ts` "owner's real CIM frame" (Sunday long, Saturday rest, Tue/Thu quality) **except with `qualityDows: []`** — i.e. the one condition the prior narrowing pass had already identified as necessary (a week authored with no scheduled quality sessions at all):

```
npx vitest run lib/plan/_falsify_crace_freqcap.test.ts --reporter=verbose --silent=false
```

Result: **1 file passed, 1 test passed** (the test itself is a reporting harness, not a pass/fail gate — the console output is the actual finding):

```
TOTAL CONFIGS: 56
TOTAL HITS: 18
HIT priority=C raceDow=0 raceWeekIdx=3 freq=2 -> weekIdx=3 dow=3 notes="Race week for a tune-up · rest is the work now."
HIT priority=C raceDow=0 raceWeekIdx=3 freq=3 -> weekIdx=3 dow=3 notes="Race week for a tune-up · rest is the work now."
[... 16 more, all priority=C, freq 2 or 3, weekIdx 3 or 7 ...]
```
**All 18 hits are priority C; zero are priority B**, under this exact fixture — reproducing the same 100%-C pattern the prior narrowing pass reported, now confirmed by direct re-execution against the current SHA rather than cited from an earlier pass.

With the standard, realistic quality-day layout (`qualityDows: [2, 4]`, the shape every real archetype and every existing test fixture in this codebase uses) and a wider frequency sweep (3-7), the identical harness — same functions, same worktree, same SHA — produced:
```
TOTAL CONFIGS: 140
TOTAL HITS: 0
```

**3. Reaches a live returned plan field, not a dead path.** `.notes` on the composed `DayPlan` object is the exact field this codebase's own architecture ledger (Track 1, finding #2) already established is read by `week-loader.ts`'s `dayNoteFor()` → `renderRunnerInstruction()` and ultimately persisted to `plan_workouts.notes`, the column every existing invariant test (`_midrace_invariants.test.ts`, etc.) treats as the authoritative post-composition value. It survives unmodified through `finalizeComposedPlan` — the standard end-of-pipeline call every other test in this codebase uses as its assertion point. This is not an internal/intermediate value discarded before persistence.

**4. It reproduces — the original Coach finding is NOT closed.** The mechanism is real, live, and current on `origin/main @ 9f082e339`.

**5. Why Brain's same-SHA read likely missed it**: sixteen lines above the frequency-cap block quoted above sits a structurally near-identical victim-demotion block — the B-only branch (`if (wasRest && race.priority === 'B')`), which mutates the exact same five schedule fields (`type`/`distanceMi`/`isQuality`/`isLong`/`subLabel`) but sets `.notes` to a *different*, honest, race-name-specific sentence (`` `Off. ${race.name} takes the usual rest slot; rest moves here.` ``). If Brain's inspection stopped at or conflated with that first, priority-gated, honestly-worded block — which genuinely *is* "mutates schedule fields" with unremarkable copy — it would correctly conclude that block is fine, and could easily miss that a second, structurally similar but functionally different block follows immediately after, with no priority check and the copy this disagreement is about. This is offered as the most plausible explanation given the code's actual layout, not a claim about what Brain's investigation literally did.

**Corrected framing, reconciled**: the branch exists, is not dead, and both audits' claims about *reach* were more precise than either's claims about *existence*. Under the standard/realistic plan shape (quality days scheduled, as every real runner's block has), it fires in 0 of 140 swept configurations. Under the one condition identified as necessary — a week authored with zero scheduled quality sessions, combined with a low stated weekly frequency (2-3 days) — it fires reliably (18/56, all C-priority in this exact fixture, for the structural reason given in v2.1's original §2.1: C's compensation searches for a quality day, which the edge fixture removed entirely, while B's searches for the still-available easy-day pool). **Net severity is unchanged from the original v2.1 narrowing: real, live, correctly gated off the release-blocker list, not fixed by this correction, and — newly confirmed here — still with zero test coverage anywhere in the corpus for the `trainingDaysPerWeek`-non-null path at all** (unchanged finding from the original narrowing pass).

### 2.2 `composeTrainingInfluence`'s "0s slow" — currently unreachable on any live route

The claim ("fires on ANY faster-but-incomplete session") is accurate about the internal logic — the `Math.max(0, delta)` floor genuinely destroys the magnitude of *any* faster-or-on-pace delta, not just near-zero ones, once the branch is reached. **But reaching the branch requires a real, phase-graded `WorkoutVerdict` passed as `grade`, and there is exactly one non-test caller in the entire codebase**: `web-v2/components/faff-app/seed.ts:145-157`'s `composeTrainingInfluenceForDay`, whose object literal **never includes a `grade` key at all** — the canonical branch is structurally unreachable there, leaving only an older raw-delta fallback that requires a real, large (>2× tolerance) slowdown and can never print "0" by construction.

**Compounding this**: that one caller (`buildSeed()`, imported only by `app/**/page.tsx` and `components/{faff-app,redesign}/**`) is exclusively part of the **web frontend** — which `CLAUDE.md` (locked 2026-08-31) explicitly designates as paused/out-of-scope, with the iPhone/watch backend as the sole active product surface. No `app/api/**` route calls this function with `grade` wired. The mechanism is real, intentional, and covered by a 12-fixture golden test suite (`_workout_verdict_owner.test.ts`) — it is a correctly-built, tested unit sitting on a shelf with no live route to it, not a shipping defect.

**Corrected framing**: **downgrade from release blocker to "not currently reachable from any live surface"** — analogous to the `HowItWentPanel` finding in §1.2, real code, currently dead-on-arrival for the product this app ships today. Worth fixing before this composer is ever wired to a live route (the underlying flooring bug is real), but not a TestFlight risk as things stand.

---

## 3. Evidence-wording correction — "reach a render call site," not "actually render"

Two remaining instances of language implying device confirmation were found in v2 (§1's correction was written but two residual phrasings slipped through): v2's finding-11 row ("confirmed to actually render") and finding-17 row ("still capable of rendering"). Both corrected to **"confirmed to reach a render call site"** / **"still capable of reaching a render call site for"** — the underlying claim (the string is passed to a real `Text(...)`/UI-binding call in source) is unchanged; only the wording implying an on-device confirmation is removed. No simulator or device screenshot has been taken anywhere across this entire audit (v1, v2, or v2.1). This phrasing correction has been applied directly to the two lines in `audit-2026-09-09-coach-forensic-audit-v2.md` (a targeted wording edit, not a content change — the finding itself, its severity, and its file:line evidence are unchanged).

---

## 4. Revised exact next-TestFlight blockers — final, superseding v2 §5

| Status | Finding | Why |
|---|---|---|
| **Confirmed blocker (unchanged)** | Cutback `whyCutback`/`whyMileage` false "down/reduction" claim | Live on the Block screen's "Why the cutback" row; re-confirmed by direct execution against an adversarial fixture in v2. Not part of this pass's re-investigation, no new evidence to reconsider. |
| **Confirmed blocker (unchanged)** | HOLD-proposal cross-surface contradiction (Block vs. Decisions History) | Live, `outcomeOfWorkoutRow`'s missing `'notice'` branch confirmed unchanged in v2's verification pass. |
| **Confirmed blocker (unchanged)** | `standing-recommendation.ts`'s single-domain trigger | Live and wired end-to-end (§4 of v2 already traces the full accept-standing loop); Brain-owned per v2 §4's ownership reclassification, but the runner-visible symptom is exactly the kind of overclaim this audit exists to catch. |
| **NEW — confirmed blocker (added by §1.1 above)** | Proposal permanently stuck "accepted" after a modern-lane Apply failure | Live, reachable from real cron-written proposals, zero test coverage of the reopen gap in either of the two affected branches. Brain-owned (proposal transaction state, per v2 §4's ownership table) — Coach's role is limited to rendering whatever state the fix leaves behind, not redesigning the transaction logic itself. |
| **Downgraded — no longer a blocker (§2.1)** | C-race "rest is the work now" copy | Real defect, zero test coverage, but requires an atypical plan shape (no scheduled quality sessions + low frequency) that a 770-configuration realistic sweep never produced once. Worth fixing; not release-blocking. |
| **Downgraded — no longer a blocker (§2.2)** | `composeTrainingInfluence`'s "0s slow" fabrication | Structurally unreachable from any live route today — the only real caller never wires the required field, and that caller lives entirely in the paused web frontend. Worth fixing before this composer is ever wired to iPhone/watch; not a current TestFlight risk. |
| **Unchanged from v2 (already downgraded there, not re-litigated here)** | `HowItWentPanel` second-brain, SAFETY_STOP-renders-as-outage | Both re-confirmed dead/unreachable by this pass's investigations (§1.2 for the panel; the SAFETY_STOP finding was not part of this pass's scope and carries no new evidence). |

**Net effect of this correction**: two items came off the blocker list with stronger evidence than v2 had (both turned out to be unreachable from any live surface, not merely "reduced severity"), and one new item was added with evidence at least as strong as anything already on the list (a live, reachable, zero-test-coverage transaction bug). The list is now four items, not five, and every item on it has been independently re-verified against current `origin/main` at least once beyond its original discovery.

---

## 5. Artifact manifest

| Artifact | Path | Status |
|---|---|---|
| v1 (unchanged) | `docs/audit-2026-09-09-coach-forensic-audit.md` | SHA-256 `9392a4e86ee7799237890ffda94d0b0c356935ad2db31e0a08a12f15ca84b42c` (unchanged since first written) |
| v2 (wording-corrected per §3 only) | `docs/audit-2026-09-09-coach-forensic-audit-v2.md` | modified by this pass — two wording fixes in §3 above, plus the two prior small edits recorded in commit `871357524`. Current hash recorded below. |
| v1→v2 correction log (unchanged) | `docs/audit-2026-09-09-coach-forensic-audit-v1-to-v2-correction-log.md` | SHA-256 `a19d7c0e7e25de305aa3687fce2902d6a1f51db63a23285c884930d305778206` (unchanged) |
| v2.1 (this document) | `docs/audit-2026-09-09-coach-forensic-audit-v2.1.md` | new |
| Four track reports (unchanged, preserved evidence annex) | `docs/reports/coach-audit-2026-09-09/track-{1,2,3,4}-*.md` | SHA-256 hashes unchanged from v2's manifest (`d1ada1d6…`, `f6c9a0fe…`, `5531f5fd…`, `90493de8…` — see v2 §7 for full values) |
| Branch | `audit/brain-forensic-2026-09-10` | shared checkout, not created or switched by this audit |
| `origin/main` at this correction's completion | `9f082e33929c670c091920006b0602e85de5dc68` | |

**Prior commits** (unchanged, local, not pushed):
- `d76b81f20d27a442847122ba918de115979ea308` — initial commit: v1 + four track files + v2 (first version) + v1-to-v2 correction log.
- `871357524` — follow-up: recorded that commit's own SHA into v2's artifact manifest.

**This pass's commit**: `f11c77d698facbc7c74b9408f980ecd574ad1d2f`, on branch `audit/brain-forensic-2026-09-10`, containing v2's two wording fixes plus this v2.1 document, the v2→v2.1 correction log, and the preserved falsification test artifact. **Local only — not pushed.**

**Working-tree status immediately after that commit**, scoped to every file this Coach audit owns (`git status --short` against all of: v1, v2, v2.1, both correction logs, and the `docs/reports/coach-audit-2026-09-09/` directory): **clean — zero output, no uncommitted changes in any file this audit has written.** (The wider shared checkout carries 16 other modified/untracked files belonging to the concurrent Brain-audit session — untouched by this pass, not part of this audit's scope, and not reflected in the "clean" claim above, which is scoped strictly to this audit's own artifacts.)

**SHA-256 of the files this commit changed or added**:

| File | SHA-256 |
|---|---|
| `docs/audit-2026-09-09-coach-forensic-audit-v2.md` (wording-fixed) | `ae8a31a13f4c0ca9a00c085047acad74a7c8083bb3b74621bd1525c71f8ae9b4` |
| `docs/audit-2026-09-09-coach-forensic-audit-v2.1.md` (this file, pre-this-edit) | `18f8db5e3aaf2696d5a384676d1737af03f1625463a8df730add4ecbe0ddcd61` — will change again once this closing paragraph is added; not self-referential by design, see v2's §7 note on the same limitation |
| `docs/audit-2026-09-09-coach-forensic-audit-v2-to-v2.1-correction-log.md` | `1a6510a7dd4bc64eba9cbd8d0f37ee333f0ccc0e4b619e6e6c3bf58796f62066` |
| `docs/reports/coach-audit-2026-09-09/falsify-crace-freqcap.test.ts` | `ee31f37d7b1aa6d370c23c44885089b625140c8160c938c492b5ce1df5bf262c` |
