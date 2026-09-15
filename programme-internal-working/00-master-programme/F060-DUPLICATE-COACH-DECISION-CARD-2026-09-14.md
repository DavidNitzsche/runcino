# F060 — the duplicate-looking HOLD card on Coach Decisions, fixed — 2026-09-14

**Status: FIXED, presentation-layer only, `tsc --noEmit` clean, native unit
tests green (548/548 `FaffTests`, full target), TS unit tests green
(`web-v2/lib/faff`: 493 passed, 3 pre-existing skips), Rule 18 falsification
performed twice (unit-test level and live on-device), before/after rendered
on `Faff-Review-1` (iPhone 17 Pro simulator). Committed on
`fix/f060-duplicate-coach-decision-card-2026-09-14`, based on
`origin/main`, NOT pushed, NOT merged — left for review per this project's
audit/handback workflow.**

---

## 1 · What was broken

Settings → Coach decisions (`DecisionHistoryV5.swift`) showed the same HOLD
decision card twice, word for word:

> **HOLD · WAITING ON YOU** — "Holding the plan as it is" — "The upcoming
> long run already carries a race-pace segment; the structure axis has
> already moved."

...and again, unchanged, under **SETTLED / EXPIRED**.

Design review already root-caused this (register entry
`for design review/findings/2026-09-14-007`) and the finding brief for this
task states the conclusion up front, so this fix does not re-derive it — it
only records the two facts that shaped the implementation:

1. **Not a data bug.** Design review queried `plan_workout_proposals`
   directly and confirmed the two cards come from genuinely distinct rows —
   production ids 10 (raised 9/7, against the old 9/20 long-run workout) and
   15 (raised 9/14, against the workout that replaced it after a plan
   rebuild). Both events are real; both belong on the screen.
2. **The duplication is downstream, in the copy.** `headline` and `why` are
   fixed per-action-kind template strings with no per-instance content:
   `lib/faff/v5-action-render.ts`'s `actionHeadline` returns the constant
   `'Holding the plan as it is'` for every `HOLD`, and the evidence facet
   that writes the reason (`lib/brain/proposal/evidence/long-run-structure
   .ts:258`) returns the constant sentence about the race-pace segment
   whenever the long run already carries one — a categorical judgement, not
   a computed quantity. Two distinct HOLD events with the same judgement
   produce byte-identical text.

## 2 · What I changed, and why this is the minimal correct fix

I did **not** touch the templates in (2). `actionHeadline`'s `HOLD` case and
the evidence facet's reason text are shared by every HOLD the engine has
ever raised or will raise; making them vary would mean inventing per-instance
wording for a judgement that is, correctly, categorical — a bigger and
riskier change than this Low–Medium finding calls for, and out of this
task's scope (the finding is about presentation, and design review's own
root-cause statement says so).

Instead I traced what the runner-facing wire ALREADY carries that is never
templated: `V5DecisionWire.dateISO` (`web-v2/lib/faff/v5-decisions.ts:87`,
`204-205`) is set to `r.workoutDateISO` — the actual date of the workout the
decision was raised against — **unconditionally, for every per-workout
decision, regardless of action kind**. It is decoded on the phone into
`V5Decision.dateISO` (`native-v2/Faff/Faff/DesignV5/APIV5.swift:1038`) and
was already carried all the way to the view model. `DecisionRowV5`
(`native-v2/Faff/Faff/ViewsV5/DecisionHistoryV5.swift`) simply never drew it
— confirmed by grepping the file for `decision.dateISO`: it appeared only in
the three `#Preview` fixtures, never in `DecisionRowV5.body`.

This matches the task's own preference order exactly: an existing slot that
already carries the correct differentiator, wired but not rendered — not a
bespoke new field, not a change to which HOLD fires or when.

### 2.1 The fix itself

`native-v2/Faff/Faff/ViewsV5/DecisionHistoryV5.swift`:

- Added a static helper, following the same pattern as the row's existing
  `dateLine`/`shortDate` helpers:

  ```swift
  /// "About the session on Sep 20." — nil for a block-level decision
  /// (`p`-prefixed), which has no single day, exactly where `dateISO` is
  /// already nil on the wire.
  static func contextLine(_ d: V5Decision) -> String? {
      guard let workoutDateISO = d.dateISO else { return nil }
      return "About the session on \(shortDate(workoutDateISO))."
  }
  ```

- Drew it in `DecisionRowV5.body`, between the headline and the reason text,
  as a small muted line (`label13` / `V5.textQuiet`) — the same visual
  register as the row's other secondary text, one tier quieter than the
  reason so it reads as a context stamp rather than the coach's own words:

  ```swift
  if let context = DecisionRowV5.contextLine(decision) {
      Text(context)
          .font(.faffText(TypeScaleV5.label13))
          .foregroundStyle(V5.textQuiet)
          .fixedSize(horizontal: false, vertical: true)
  }
  ```

Nil for every block-level (`p`-prefixed) decision, exactly where `dateISO`
is already nil on the wire (a rebuild is about the whole plan, not one day) —
so the two block-level rows already in the harness fixture (`p8`, `p9`) are
visually unaffected. Non-nil for every per-workout (`w`-prefixed) row,
including every existing single-HOLD, single-PACE_CHANGE, etc. card, which
now also gets the date line — a small, uniform addition, not a HOLD-only
special case (the task explicitly allowed this shape: "the fix is the same
shape everywhere").

No changes to `lib/plan/generate.ts`, the proposal-creation logic, the
adaptation engine, or `lib/training/coaching-thesis.ts` (`composeReviewTrigger`
is a different, unrelated mechanism — grepped and confirmed it does not touch
`v5-action-render.ts`, `v5-decisions.ts`, or `DecisionHistoryV5.swift`, so it
was correctly left alone per the task's own instruction).

## 3 · Before / after evidence

### 3.1 Unit-level (`FaffTests`)

New file: `native-v2/Faff/FaffTests/DecisionRowContextLineTests.swift`, four
tests against the pure `DecisionRowV5.contextLine` function:

- `testTwoIdenticalHoldCardsGetDifferentContextLines` — the falsification
  case: two `V5Decision`s shaped exactly like production rows 10/15 (same
  action kind, byte-identical `headline` and `why`, different `dateISO`,
  different outcome) assert `contextLine` differs and pins the exact
  strings (`"About the session on Oct 11."` vs. `"About the session on
  Sep 20."`).
- `testSingleHoldCardStillGetsAContextLine` — the common case (one HOLD,
  never duplicated) is unaffected other than gaining the line.
- `testBlockLevelDecisionHasNoContextLine` — a `p`-prefixed row (`dateISO:
  nil`) gets no fabricated date.
- `testUnparsableDateDoesNotCrash` — a malformed date does not crash; it
  inherits `shortDate`'s pre-existing (unrelated) fallback behaviour rather
  than this fix introducing a new failure mode.

Run on `Faff-Review-1` (udid `13C15A03-551C-455F-91BA-011F2407D557`, iPhone
17 Pro):

```
Test Suite 'DecisionRowContextLineTests' passed
	 Executed 4 tests, with 0 failures (0 unexpected) in 0.004 seconds
```

**Rule 18 falsification (unit level):** temporarily reverted `contextLine`
to `return nil` unconditionally (the exact pre-fix behaviour — the field was
decoded and never drawn), reran the same four tests:

```
testSingleHoldCardStillGetsAContextLine : XCTAssertEqual failed:
  ("nil") is not equal to ("Optional("About the session on Sep 16.")")
testTwoIdenticalHoldCardsGetDifferentContextLines :
  XCTAssertNotEqual failed: ("nil") is equal to ("nil") -
  F060: two distinct HOLD decisions must not read as one card shown twice
testUnparsableDateDoesNotCrash : XCTAssertNotNil failed
Executed 4 tests, with 7 failures (0 unexpected)
```

Restored the fix (`diff` against a pre-revert backup confirmed byte-identical
restoration), reran: 4/4 pass again, and the full `FaffTests` target
(548 tests) passes with 0 failures both before and after this change —
i.e., no regression anywhere else in the native suite.

### 3.2 On-device, via the existing `-faffProposals` debug harness

`ProposalHarnessV5` (`native-v2/Faff/Faff/ViewsV5/ProposalHarnessV5.swift`)
already exists for exactly this purpose (Rule 13: a runner-facing change is
verified by rendering it, and this surface has almost no real production
data to render against). It decodes a JSON file shaped like the server's own
`GET /api/v5/decisions` response with the real decoder and draws it with the
real `DecisionHistoryV5` view — no fixture-specific rendering code.

I do **not** have `DATABASE_URL_RO` or any other access to production in
this environment, so I could not pull the real rows for ids 10/15. Per the
task's own allowance ("or a synthetic equivalent"), I built a synthetic
fixture reproducing the exact shape design review described — two HOLD
decisions, byte-identical `headline` and `why`, one `pending`/"raised 9/14",
one `expired`/"settled 9/7", targeting two different workout dates:

```json
{
  "proposals": [],
  "proposalsRead": "ok",
  "decisions": [
    { "id": "w15", "dateISO": "2026-10-11", "decidedISO": "2026-09-14",
      "direction": "hold", "outcome": "pending",
      "headline": "Holding the plan as it is",
      "why": "The upcoming long run already carries a race-pace segment; the structure axis has already moved." },
    { "id": "w10", "dateISO": "2026-09-20", "decidedISO": "2026-09-07",
      "direction": "hold", "outcome": "expired",
      "headline": "Holding the plan as it is",
      "why": "The upcoming long run already carries a race-pace segment; the structure axis has already moved." }
  ],
  "decisionsRead": "ok"
}
```

Built the app (Debug), installed on `Faff-Review-1`, copied the fixture into
the app's Documents container, launched with
`xcrun simctl launch <udid> run.faff.app -faffProposals f060-verify.json`
(this argument bypasses sign-in entirely and renders `ProposalHarnessV5` as
the root view — no live account or network needed), and tapped History.

**Before** (fix reverted, same fixture, rebuilt and reinstalled):

Both cards read, verbatim, "HOLD WAITING ON YOU / Holding the plan as it is
/ The upcoming long run already carries a race-pace segment..." and "HOLD
EXPIRED / Holding the plan as it is / The upcoming long run already
carries..." — no visible difference between the STILL OPEN and SETTLED
cards other than the outcome label and the "Raised"/"Settled" date, which is
exactly F060: a runner cannot tell from the card itself that these are two
different events.

**After** (fix restored, rebuilt, reinstalled, same fixture):

- STILL OPEN: `HOLD WAITING ON YOU · Raised Sep 14` / "Holding the plan as
  it is" / **"About the session on Oct 11."** / "The upcoming long run
  already carries a race-pace segment; the structure axis has already
  moved."
- SETTLED: `HOLD EXPIRED · Settled Sep 7` / "Holding the plan as it is" /
  **"About the session on Sep 20."** / "The upcoming long run already
  carries a race-pace segment; the structure axis has already moved."

The two cards are now visibly distinct on the one line design review
identified as missing, with no change to the coach's own wording. Committed
evidence: `docs/verification/2026-09-14-f060/fixture.json` (the synthetic
fixture above), `before-duplicate-cards.png`, `after-differentiated-cards.png`.

## 4 · TypeScript-side coverage (pinning, not fixing)

`web-v2/lib/faff/v5-decisions.ts` was never wrong — it already puts a
correct, per-row `dateISO` on the wire regardless of action kind. I added
one test to `web-v2/lib/faff/_v5_decisions.test.ts` to pin that fact
explicitly, using the worst-case shape (`workoutRow`'s existing fixed
`actionKind`/`reason` already produce a fixed fallback headline, `'A change
to one session'`, for any two rows of that kind — the same "two events, one
template string" defect shape HOLD has, reproduced without needing HOLD's
own generator):

```
F060 (2026-09-14) · the field that survives the template collision
  ✓ two rows of one templated kind, raised against different workouts,
    share a headline and reason but never a dateISO
```

This documents *why* the fix belongs entirely on the native side: the
backend was already correct, and touching it was never necessary or in
scope.

## 5 · Verification bar, checked off

- `npx tsc --noEmit` in `web-v2`: clean, before and after every checkpoint.
- `npx vitest run lib/faff`: 493 passed, 3 pre-existing skips, before and
  after — no new failures.
- `npx vitest run` (full suite): 4 pre-existing failures, all unrelated to
  this change and present on a diff-free tree — two DB-gated audits that
  cannot run without `DATABASE_URL_RO`
  (`lib/plan/_authoring_shadow_compare.audit.test.ts`,
  `lib/adaptation/canonical-shadow/_f038_reign_scoping.audit.test.ts`, both
  fail loudly by design per their own Rule 18 comments rather than reporting
  a false green), one plan-engine fixture assertion unrelated to decision
  cards (`lib/plan/_rolling_seven_ceiling.test.ts`), and one scanner timeout
  (`lib/runs/_run_shape_lint.test.ts`). None of these files were touched by
  this change, confirmed via `git status --porcelain` showing only
  `_v5_decisions.test.ts`, `DecisionHistoryV5.swift`,
  `DecisionRowContextLineTests.swift` (new), and the xcodegen-regenerated
  `project.pbxproj` (needed only to register the new test file with the
  Xcode project; diff is two lines plus a cosmetic xcconfig placeholder
  UUID).
- `xcodebuild test -only-testing:FaffTests`: 548/548 passed, both before and
  after the fix (i.e. adding the fix caused zero regressions across the
  entire native unit-test suite).
- Rule 18 falsification: performed twice — once at the unit-test level
  (§3.1) and once live on a simulator (§3.2, before/after screenshots) —
  both times reproducing the exact byte-identical-card bug with the fix
  reverted, and both times going green on restoration.
- Native rendering: done on `Faff-Review-1` (iPhone 17 Pro), the first name
  in the allowed pool. No new simulator or device model was created.

## 6 · Scope boundaries respected

- Did not touch `lib/plan/generate.ts` or any proposal-creation/adaptation
  logic — nothing about when or why a HOLD fires changed.
- Did not touch `lib/training/coaching-thesis.ts` /
  `composeReviewTrigger` — confirmed by grep that this mechanism is
  unrelated to the Coach Decisions card path (HOLD's headline/reason come
  from `v5-action-render.ts` and the evidence facets under
  `lib/brain/proposal/evidence/`, a different, unconnected code path).
- Did not change `plan_workout_proposals` or any other table's schema or
  contents — no DDL, no writes, no database access at all in this
  environment.
- The one shape of change (draw an already-correct, already-decoded date
  field) is applied uniformly to every per-workout decision on this screen,
  not specially carved out for HOLD — consistent with the task's allowance
  that a uniform fix across kinds is fine as long as it does not redesign
  the card system. Nothing else about the card (layout, colours, the
  STILL OPEN/SETTLED grouping, the undo button) changed.
- No merge, no push to `main`. Work is committed on
  `fix/f060-duplicate-coach-decision-card-2026-09-14`, based on
  `origin/main`, awaiting review per this project's audit/handback workflow.

## 7 · Files changed

- `native-v2/Faff/Faff/ViewsV5/DecisionHistoryV5.swift` — the fix
  (`contextLine` + the render call).
- `native-v2/Faff/FaffTests/DecisionRowContextLineTests.swift` — new, 4
  tests including the Rule 18 falsification case.
- `native-v2/Faff.xcodeproj/project.pbxproj` — regenerated via `xcodegen
  generate` solely to register the new test file with the `FaffTests`
  target (this project's `project.yml` declares `FaffTests`'s sources as a
  folder glob, so a file added outside Xcode needs a regenerate to be
  picked up by `xcodebuild test`).
- `web-v2/lib/faff/_v5_decisions.test.ts` — one new test pinning that the
  backend wire already carries the differentiator (no production code
  change).
- `docs/verification/2026-09-14-f060/` — the synthetic harness fixture and
  the before/after simulator screenshots (§3.2).
- `programme-internal-working/00-master-programme/F060-DUPLICATE-COACH-DECISION-CARD-2026-09-14.md`
  — this report.
