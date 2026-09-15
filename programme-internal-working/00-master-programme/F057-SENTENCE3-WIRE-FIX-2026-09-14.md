# F057 sentence #3 — threading `reviewWindowElapsed` onto the wire (2026-09-14)

**Responds to**: RR-20260914-027 (F057, Santa Monica post-race copy truth fix) —
returned **CHANGES REQUIRED**, not a clean pass. This report covers the one
gap the review named: sentence #3 ("Under review.") was fixed in
`readPlan`'s own logic but that fix never reached the wire or the Swift
screen that renders the literal string.

**Branch**: `fix/u4-postrace-truth-final-2026-09-14`. This commit sits ON TOP
of the existing, already-reviewed commits for sentences #2/#5/#7
(`e18fae5a2` and its ancestors) — nothing on those commits was amended,
rewritten, or touched. **Not pushed, not merged** — per the standing
workflow, this needs to be resubmitted as a new external-review request.

**Explicitly out of scope, and untouched**: sentences #2, #5, #7 (confirmed
independently fixed, no further work needed) and the `correction-v2`
(`619b61d72`) exclusion decision (still correctly excluded, not re-opened).

---

## 1 · The gap, precisely

`readPlan` (`web-v2/lib/postrun/experience.ts`) already computes the right
fact and picks the right SENTENCE with it:

```ts
if (input.reviewWindowElapsed) {
  return {
    status: 'HELD_FOR_EVIDENCE',
    runnerSummary: 'The plan is unchanged. This run was strong enough to
      act on, but no automated review resolved it in the usual window —
      nothing further is currently scheduled to look at it.',
    ...
  };
}
return {
  status: 'HELD_FOR_EVIDENCE',
  runnerSummary: 'The plan is unchanged for now. This run is strong enough
    to act on, so the next review will look at it.',
  ...
};
```

Both branches return `status: 'HELD_FOR_EVIDENCE'`. The fact that
distinguishes "still open" from "already closed with nothing pending" lived
ONLY inside the free-text `runnerSummary` string — nowhere else on the
returned object, and therefore nowhere on the wire.

`lib/postrun/wire.ts`'s `postRunWire()` maps `x.plan.status` straight to
`changeState` and `x.plan.runnerSummary` to `change`. `changeState` is the
one field `native-v2/Faff/Faff/DesignV5/WorkoutResultV5.swift`'s
`planStatusLine` switches on to choose the compact row's copy:

```swift
private var planStatusLine: String? {
    switch model.changeState {
    case "UNCHANGED":         return "Plan unchanged."
    case "UPDATED":           return "Plan updated."
    case "HELD_FOR_EVIDENCE": return "Under review."
    case "NO_PLAN", "UNKNOWN": return nil
    default:                  return nil
    }
}
```

Because `changeState` is `"HELD_FOR_EVIDENCE"` in BOTH cases, this switch
could not tell them apart. It printed "Under review." unconditionally —
including in the exact case sentence #3's fix was written to close, sitting
next to a "Why" disclosure whose own text (`model.change`, decoded from
`runnerSummary`) had just told the runner, in full sentences, that nothing
further was scheduled. Same contradiction shape as sentence #5's original
bug: two adjacent pieces of copy asserting things that cannot both be true.

## 2 · Falsification — the pre-fix behaviour, traced

Concrete trace, not a live-DB repro (no real account currently sitting past
its 2-day review window with an eligible-but-unactioned run was found in the
time available; the code trace is exact and unconditional, so it stands on
its own):

1. A run fires `evidence.planAuthorityEligible = true` (a real threshold
   move, no adaptation yet recorded) and is opened for viewing more than
   `PLAN_CHANGE_REVIEW_WINDOW_DAYS` (2) days after the run's own date.
2. `load.ts` computes `reviewWindowElapsed = true` (verified: `daysBetweenISO(dateISO, today) >= 2`).
3. `readPlan` takes the `input.reviewWindowElapsed` branch and returns
   `status: 'HELD_FOR_EVIDENCE'`, `runnerSummary` = "...nothing further is
   currently scheduled to look at it."
4. `postRunWire()` emits `changeState: "HELD_FOR_EVIDENCE"` — pre-fix, with
   NO field carrying the elapsed fact itself.
5. `WorkoutResultV5.swift`'s `planStatusLine` switches on `changeState`,
   matches `"HELD_FOR_EVIDENCE"`, returns `"Under review."` — **unconditionally**,
   regardless of step 2's result. This renders on screen as the compact row.
6. The runner taps "Why" and reads, in the very next section, the sentence
   from step 3: "...nothing further is currently scheduled to look at it."

Steps 5 and 6 contradict each other on screen at the same time. This is the
exact gap the review flagged, confirmed by code trace through every hop from
`load.ts` to the rendered string.

## 3 · The fix

Threaded the SAME fact `readPlan` already has (`input.reviewWindowElapsed`,
computed once in `load.ts`, never re-derived) all the way to the Swift
switch, as its own field at every layer — not a new fact, not a new query,
the existing one made visible past `readPlan`'s own return value.

**`web-v2/lib/postrun/experience.ts`**
- `PostRunPlanImpact` gains `reviewWindowElapsed: boolean`.
- All 7 return sites in `readPlan` now set it — `input.reviewWindowElapsed`
  verbatim on every branch except the two `HELD_FOR_EVIDENCE` branches,
  which set the literal `true`/`false` matching the branch they are already
  in (both equal to `input.reviewWindowElapsed` by construction, spelled
  explicitly for readability at the point the decision is made).

**`web-v2/lib/postrun/wire.ts`**
- `PostRunWire` gains `reviewWindowElapsed: boolean`.
- `postRunWire()` sets it from `x.plan.reviewWindowElapsed`.

**`native-v2/Faff/Faff/DesignV5/PostRunLearnedV5.swift`**
- `PostRunV5` gains `let reviewWindowElapsed: Bool`, decoded leniently
  (defaults `false` — the conservative reading, matching `daysBetweenISO`'s
  own posture server-side — on a payload from before this key existed).
- Added to the `CodingKey` enum and the memberwise `init` (default `false`,
  for previews/tests).

**`native-v2/Faff/Faff/DesignV5/WorkoutResultV5.swift`**
- `planStatusLine`'s `HELD_FOR_EVIDENCE` case now reads
  `model.reviewWindowElapsed` to choose the copy:

  ```swift
  case "HELD_FOR_EVIDENCE":
      return model.reviewWindowElapsed ? "No further review scheduled." : "Under review."
  ```

  The icon (`planStatusIcon`, `clock.fill` for `HELD_FOR_EVIDENCE`) was left
  untouched — that is a visual-design decision beyond this fix's mandate,
  which is specifically the text contradiction the review named.

### Before / after — the exact copy

| State | Before | After |
|---|---|---|
| Window still open, run eligible | "Under review." | "Under review." (unchanged — correct) |
| Window elapsed, nothing pending | **"Under review."** (false) | **"No further review scheduled."** (matches `readPlan`'s own sentence) |

The "Why" disclosure's full sentence (`model.change`, unchanged) already said
the honest thing in both cases; the compact row now agrees with it instead
of contradicting it.

### A field the phone must decode, not just a sentence

`reviewWindowElapsed` was added as a typed boolean rather than left as prose
because `changeState` alone was already proven insufficient — inferring the
distinction from `change`'s TEXT would only move the same fragility
(sentence-parsing) one layer down instead of removing it. The field is set
on every `readPlan` branch, not only `HELD_FOR_EVIDENCE`, so a caller never
has to check `status` first to know the value means something.

## 4 · Scope discipline — what was NOT touched

- Sentences #2, #5, #7: no code path for any of them was read for editing;
  `git diff` (below) touches only `readPlan`'s `HELD_FOR_EVIDENCE` branches,
  the `PostRunPlanImpact`/`PostRunWire` interfaces, and the one Swift switch
  case for `HELD_FOR_EVIDENCE`.
- `correction-v2` (`619b61d72`): not rebased onto, not cherry-picked, not
  discussed further here. Still excluded per the prior report's own
  reasoning, unchanged.
- No prior commit was amended. This is a new commit on top of `e18fae5a2`.

## 5 · Verification

### 5.1 `tsc --noEmit` (web-v2)

Clean on first pass except one pre-existing test fixture that constructs a
`PostRunWire` object literal by hand
(`web-v2/lib/faff/_v5_today.test.ts`'s `postRunFor()`), which needed the new
required field added (`reviewWindowElapsed: false`) — a mechanical
consequence of widening the wire type, not a behavior change. After that
one-line addition:

```
TSC_EXIT:0
```

### 5.2 Targeted test suites (vitest)

Ran the tests the original submission cited plus the wire-consumption
gate and the fixture file touched above:

```
npx vitest run lib/postrun/_experience.test.ts \
  lib/postrun/_postrun_corpus.audit.test.ts \
  lib/postrun/_postrun_wire_consumed.audit.test.ts \
  lib/postrun/_detail_wire_consumed.audit.test.ts \
  lib/faff/_v5_today.test.ts

 Test Files  4 passed | 1 skipped (5)
      Tests  102 passed | 1 skipped (103)
VITEST_EXIT:0
```

Notably, `_postrun_wire_consumed.audit.test.ts` — the gate that fails when
the server emits a field no Swift decoder reads — passes with
`reviewWindowElapsed` now emitted AND decoded on both sides (it would have
failed had the Swift decode step been skipped).

The existing `_experience.test.ts` suite (`describe('U4-5 · "Under review"
resolves honestly once its own window has elapsed'`) already exercised both
branches of `readPlan`'s `reviewWindowElapsed` logic and continues to pass
unmodified — this fix only widens the returned object, it does not change
`readPlan`'s decision logic or either `runnerSummary` sentence.

### 5.3 Swift build

`native-v2/Secrets.xcconfig` (gitignored, not present in this fresh
worktree checkout) was copied over from the main checkout to unblock the
build — no code change, a local build-config file every worktree needs and
none of them track in git.

```
xcodebuild -project Faff.xcodeproj -scheme Faff \
  -destination 'generic/platform=iOS Simulator' -configuration Debug \
  build CODE_SIGNING_ALLOWED=YES

** BUILD SUCCEEDED **
XCODEBUILD_EXIT:0
```

Zero errors. The only warnings touching the edited file
(`PostRunLearnedV5.swift`) are the same pre-existing
"`left side of nil coalescing operator '??' has non-optional type ...`"
style warning already present at 8 other lines in the file (e.g.
`noPrescribedStructure`'s own decode line) — the new `reviewWindowElapsed`
decode line was written to match that file's own established lenient-decode
idiom verbatim, so it inherits the same pre-existing warning class rather
than introducing a new one.

## 6 · Files changed

```
native-v2/Faff/Faff/DesignV5/PostRunLearnedV5.swift  | 20 +++++++++++++-
native-v2/Faff/Faff/DesignV5/WorkoutResultV5.swift   | 17 +++++++++++-
web-v2/lib/faff/_v5_today.test.ts                    |  2 +-
web-v2/lib/postrun/experience.ts                     | 32 ++++++++++++++++++++++
web-v2/lib/postrun/wire.ts                           | 16 +++++++++++
```

Committed as a single new commit on `fix/u4-postrace-truth-final-2026-09-14`,
on top of `e18fae5a2` (the already-reviewed sentence #2/#5/#7 fix +
merge-prep report). Not pushed, not merged — ready for a new external-review
request per the standing workflow.
