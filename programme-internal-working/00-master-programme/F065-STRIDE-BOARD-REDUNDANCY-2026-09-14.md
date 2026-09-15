# F065 — the transition board says the rep count twice, in two grammars (2026-09-14)

**Branch**: `fix/f065-stride-board-redundancy-2026-09-14`, based on
`origin/main` (`e2f4a03bb`, current tip at commit time — includes the
TestFlight build 294 ship commit that landed mid-session). **Not pushed,
not merged** — a fresh worktree branch prepared for review per the standing
workflow.

**Root cause, as already established by the prior investigation (not
re-derived here)**: `WorkoutEngine.swift`'s `advance()` work-phase-entry
branch (`p.type == .work`, ~line 1746) fires
`flash(.phase(title: p.label, sub: sub), for: 1.6)` on every work-rep
transition. `p.label` is the phase's own server-authored label — on a
stride/hill/rep/step session it already reads e.g. "Stride 3 of 6" — and
`sub` was INDEPENDENTLY built as `"Rep \(n) of \(totalWorks)"`, restating the
identical count in a different grammar. Both strings are real, visible
`Text` on `WMomentPhaseChange` (the transition-moment board), not
accessibility-only. `REPCOUNT-1` (documented immediately above this branch)
fixed a related-but-different bug — the two NUMBERS used to be able to
disagree — and made them always agree, which is very likely why the
restatement stopped reading as a bug: once "Stride 3 of 6" and "Rep 3 of 6"
always match, the redundancy looks like confirmation rather than clutter.

## 0 · Environment note — a hostile shared worktree, handled

Partway through verification, `git status`/`git log` in this worktree
turned up: HEAD detached at a commit I never made
(`1a004b3e8`, author `Scratch Merge Sim <scratch@local>`), and my own named
branch ref repointed to a **different** unauthored commit (`e32b04b15`) —
both carrying an independently-written version of essentially this same
fix (different variable shapes, e.g. `rep` typed as `String?` instead of a
separate `labelStatesCount` boolean), stacked on an older base. Neither
commit exists on `origin` (`git ls-remote` confirms) — this was purely
local churn injected into the shared worktree disk while this session was
waiting on the shared watchOS simulator, not real reviewed work. Separately,
a file I had already written to `programme-internal-working/` (an earlier
draft of this exact report) was deleted from disk by something in the same
window.

Treated it the way a bad measurement gets treated, not the way ground truth
does: did not adopt the unauthored commits or represent their content as
verified. Recovery taken: `git branch -D` the corrupted branch ref,
recreated it fresh from a freshly-fetched `origin/main`, and reapplied
**my own** already-tested fix and tests from a local file backup (not
`git stash` — shared across worktrees in this environment, per standing
guidance — a plain file copy). Rebuilt and reran the full test suite from
that clean base before committing anything. This report and its commit
describe only that reapplied, independently-verified state.

## 1 · The fix

`legacy/native/Faff/FaffWatch Watch App/WorkoutEngine.swift`
(the real source — `native-v2/Faff/FaffWatch Watch App` is a symlink to this
directory, confirmed with `readlink` before editing):

- Added a private helper, `labelAlreadyStatesRepCount(_:)`, just above
  `advance()`. It checks `p.label` for an already-baked-in `"<n> of <m>"`
  count via a plain regex (`\d+\s+of\s+\d+`) rather than hard-coding
  "stride" — the server (`web-v2/lib/training/expand-spec.ts`) writes that
  exact shape into the label from **three** different generators, not just
  strides:
  - `strideLabelFor` → `"Stride 3 of 6"`
  - `expandReps`'s time-based sets → `"Rep 2 of 4 · 3:00"` / `"Hill 2 of 4 · 1:30"`
  - `expandSteps` (GRAMMAR-SEQ-1 ladders) → `"1:30 @ Zone2 · 2 of 6"`

  A distance-based interval rep (`"Interval · 0.50 mi"`, also from
  `expandReps`) carries **no** count in its label — that shape is the
  genuine non-redundant case and is exercised explicitly in the tests below.
  (Threshold's own block label, `"Block N/2"` from the test fixtures, uses a
  slash rather than the word "of" and correctly does **not** match — see §4
  for why that matters to the verification story.)

  This is a **display** check, not a routing one. `DOCTRINE-STRIDES-1`
  (documented in `WatchWorkoutModels.swift`, cited in the root cause this
  finding was handed with) specifically warns against regexing `label` for
  *behavioural* decisions — that is exactly why `isStrideSegment` exists as
  a typed field instead of `label.contains("stride")`. Nothing here decides
  which board or state transition to run off the label text; worst case if
  a future label shape slips past the regex, `sub` goes back to (harmlessly)
  restating the count — not a crash, not a wrong board, not a mis-routed
  session.

- In the `p.type == .work` branch itself: `sub` is now computed as
  `String?` (was `String`, always non-nil). When
  `labelAlreadyStatesRepCount(p.label)` is true:
  - if there's no band (`hasBand == false`) and a real target pace exists,
    `sub` carries **just the pace** (no restated count);
  - otherwise `sub` is `nil` — nothing left to say that isn't already on
    the headline, so the line goes empty rather than manufacturing a second
    fact to fill it. (This mirrors the existing single-recovery case a few
    lines below, which already sets `sub = nil` when there's nothing
    non-redundant to add — `WMomentPhaseChange.detail` is a non-optional
    `String` fed by `sub ?? ""`, so a nil `sub` renders as an empty detail
    line, exactly as it already does for a workout with only one recovery
    phase.)

  When the label does **not** already state the count, behaviour is
  byte-identical to before: `"Rep N of M · pace"` when there's no band and a
  pace exists, `"Rep N of M"` otherwise.

- Dense WHY-comments at both the helper and the call site cite this finding
  and the F120 sweep recommendation, matching the file's existing
  comment style (REPCOUNT-1, DOCTRINE-STRIDES-1, PACE-SHAPE-1, etc.).

## 2 · Sweep results (F120's explicit recommendation — scope, not one instance)

F120's synthesis named F065 as one of six examples of a redundancy fix that
could land narrowly. Checked every other `flash(...)` call site in
`WorkoutEngine.swift` and every board-composition function in
`WatchRouterV5.swift` for the same "same fact, two phrasings" shape:

| Site | Verdict | Why |
|---|---|---|
| `flash(.phase(...))` — race phase boundary (~line 1738) | **Clean, no action** | `title = p.label` is a course-segment place name ("Hurricane climb"), never an "N of M" count; `sub` carries pace + "· hold effort" — different fact entirely, no restatement. |
| `flash(.phase(title: "Finish", sub: "\(p.label) · \(target)"))` (~line 1745) | **Clean, no action** | `title` is the fixed word "Finish"; `sub` names the segment + pace. No count anywhere to restate. |
| `flash(.phase(title: p.label, sub: sub))` — **work-phase entry** | **Fixed** | This finding. See §1. |
| `flash(.phase(title: "Recovery", sub: sub))` — recovery entry (~line 1818) | **Already correct, no action** | `title` is the fixed word "Recovery" (no count); `sub` is `"\(n) of \(totalRecoveries)"` **only when `totalRecoveries > 1`**, else `nil`. This is precisely the non-redundant pattern the fix above now also follows. |
| `flash(.go(rep: "", target: ""))` (~line 660) | **Clean, no action** | Carries no payload "on purpose" per its own comment — `WMomentGo` draws only the session-ramp word. Nothing to be redundant with. |
| `flash(.fuel(index:total:))` (×2) | **Clean, no action** | `FuelFace` renders "GEL" (fixed word) + "n of m" from a single index/total pair — one source, not two independently-computed strings. |
| `flash(.split(...))`, `flash(.headsUp(...))`, `flash(.almostDone(...))` | **Clean, no action** | Single-fact cues; no title/sub pair to be redundant. |
| `WatchRouterV5.phaseName(_:)` / `phaseContext(_:)` → `PhaseFaceV6` (persistent phase board, `FacesRunV6.swift`) | **Confirmed clean — pre-existing finding, not this fix** | `phase` ("Work"/"Strides"/"Threshold") is `.accessibilityLabel(phase)` only — literally commented `// NEVER DRAWN` in the source — while `context` ("3 of 6") is the only visible count. One visible count, one invisible role name: not a restatement. Matches the scope note that this board was already investigated and ruled clean. |
| `FaceSkipConfirmV5`'s `repLabel: "Skip rep \(repIndex)"` | **Clean, no action** | Single string, no paired sub-line. |
| `FinishSummaryRow("Rep \(i + 1)", pace)` (finish summary list) | **Clean, no action** | Table row label + value, not a headline/subline pair; the row label is the only place the rep number appears. |

**No new ambiguous candidates to flag** — every other `flash(...)` site and
every other board-composition function checked either has no count to
restate, or (recovery's own `sub`, and the persistent phase board) already
follows the non-redundant pattern this fix now brings the work-phase-entry
branch in line with.

## 3 · Scope discipline — confirmed untouched

- `REPCOUNT-1`'s resolver (`repPhaseIndices` / `repCountForDisplay` /
  `repIndexForDisplay`) — read only as context, not modified.
- `FacesPhaseV5.swift` / `FacesRunV6.swift` — not edited. `PhaseFaceV6`'s
  `phase`/`context` split was re-checked directly (§2 table) and confirmed
  to already be the non-redundant, accessibility-only-for-the-name pattern
  the prior investigation reported.
- `p.label`'s own construction (`expand-spec.ts`) — not modified. Only the
  Swift-side `sub` computation that sits alongside it changed.

## 4 · Verification

### 4.1 Build

```
xcodebuild -project Faff.xcodeproj -scheme "FaffWatch Watch App" \
  -destination "platform=watchOS Simulator,id=DC794E30-23E7-475B-AECD-05DC44E39A75" build
** BUILD SUCCEEDED **
```

(`native-v2/Secrets.xcconfig` — gitignored, absent in this fresh worktree —
copied from `Secrets.example.xcconfig` to unblock the build, same one-line
local-config step other reports in this folder have needed; no code
change, nothing committed.)

### 4.2 New tests

Added to
`legacy/native/Faff/FaffWatch Watch AppTests/WorkoutEngineTests.swift`
(new `MARK: - F065` section, 5 tests):

- `strideLabelWithNoPaceGetsNoRedundantSub` — **the exact reported pairing**:
  label `"Stride 1 of 1"`, no pace, no band → asserts `sub == nil` (was
  `"Rep 1 of 1"` pre-fix).
- `redundantLabelWithPaceShowsPaceAloneInSub` — redundant label + a real
  pace, no band → asserts `sub` is the pace string alone, not
  `"Rep 1 of 1 · 6:31/mi"`.
- `redundantLabelWithBandShowsNilSub` — redundant label + a band (pace AND
  tolerance) → asserts `sub == nil` (the band already carries the pace
  separately; nothing non-redundant left for `sub` to say).
- `nonRedundantLabelStillGetsRepFallbackWithPace` — **non-regression**:
  label `"Interval · 0.50 mi"` (no baked-in count, the real shape
  `expandReps` emits for a distance-based interval), pace present, no band →
  asserts `sub == "Rep 1 of 1 · 6:31/mi"`, i.e. byte-identical to pre-fix
  behaviour.
- `nonRedundantLabelWithBandStillGetsRepText` — same non-redundant label,
  now with a band → asserts `sub == "Rep 1 of 1"`, also byte-identical to
  pre-fix behaviour.

All five passed in every run of the `WorkoutEngineTests` suite across this
session (initial implementation run and every re-run after the environment
incident in §0).

### 4.3 Rule 18 falsification

1. Copied the fixed file to a scratch backup (a plain file copy, not
   `git stash` — shared across worktrees in this environment per standing
   guidance).
2. Reverted the `p.type == .work` branch in place to the exact pre-fix
   logic (`sub` unconditionally `rep` or `rep + " · " + pace`, no
   `labelAlreadyStatesRepCount` check).
3. Ran the `WorkoutEngineTests` target. **3 of the 5 new tests failed**,
   reproducing the exact reported shape:
   - `strideLabelWithNoPaceGetsNoRedundantSub`: `moment.sub → "Rep 1 of 1"` (expected `nil`) —
     the literal "Stride 1 of 1" / "Rep 1 of 1" pairing, at 1-of-1 scale.
   - `redundantLabelWithPaceShowsPaceAloneInSub`: `moment.sub → "Rep 1 of 1 · 6:31/mi"` (expected `"6:31/mi"`).
   - `redundantLabelWithBandShowsNilSub`: `moment.sub → "Rep 1 of 1"` (expected `nil`).
   - The two non-redundant tests (`nonRedundantLabelStillGetsRepFallbackWithPace`,
     `nonRedundantLabelWithBandStillGetsRepText`) **passed** even against the
     reverted code — confirming those cases were never broken and the fix
     doesn't change them either way.
   - Overall: `Test run with 29 tests in 1 suite failed after 0.357 seconds
     with 3 issues` (exit 65).
4. Restored the fixed version from the backup copy (byte-diffed against the
   version that had already built + tested clean, confirmed identical).
5. Re-ran the same test target: all five F065 tests pass again, whole
   suite green.

### 4.4 Full Watch test suite — and a genuine contention story worth recording

**F114 contention check was run before every single simulator invocation**
(`ps aux | grep -i xcodebuild`, `xcrun simctl list devices booted`), per
this finding's own instruction, and the environment tonight fully lived up
to F114's warning: multiple other worktrees' `xcodebuild test`/`build`
processes were almost continuously attached to the same shared
`Apple Watch Series 11 (46mm)` simulator (the only approved watchOS device)
and to other simulators on the same host throughout this session. Windows
were grabbed the instant the target device showed no attached `xcodebuild`
process, per F114's "retry rather than trust a single contended run"
instruction — this device changed hands with several other sessions
multiple times over roughly 25 minutes of real time.

**`WorkoutEngineTests` (the suite containing the changed code and all 5 new
tests) passed 100% in every single run this session** — the original clean
run (**239 tests / 17 suites, all passing**, run before the environment
incident in §0) and three more full/targeted runs after reapplying the fix
post-incident.

Across those same post-incident runs, a **different** `SessionTimelineTests`
test failed each time — never the same one twice, and never anything in
`WorkoutEngineTests`:

| Run | Failing test(s) | In my changed code path? |
|---|---|---|
| Full suite, run 1 | `easyRunGoFiresOnce`, `thresholdPhaseCuePerBlock`, `racePhaseCuePerSegment` | No — traced each: `easyRunGoFiresOnce` uses a single-phase workout whose only cue is `.go` from `start()`, never touching the `advance()` branch this fix changed; `thresholdPhaseCuePerBlock`'s fixture labels work phases `"Block N/2"` (a slash, not the word "of") so `labelAlreadyStatesRepCount` returns `false` and `sub` takes the exact pre-fix path (`hasBand` is true for that fixture, so `sub = rep`, byte-identical); `racePhaseCuePerSegment` exercises the `isRace` branch, which this fix never touched. |
| Targeted retry, `SessionTimelineTests` alone | `timeIntervalsSplitSuppressedInReps` | No — asserts mile-split suppression during a rep, an entirely different code path (`WorkoutEngine`'s mile-split gating, not the phase-entry `sub` computation). |
| Full suite, run 2 (post-restore) | `noCueFiresWhilePaused` | No — single-phase `easyRun()` fixture again; asserts nothing publishes while paused, unrelated to `sub` content. |
| Dedicated baseline run, `SessionTimelineTests` against **unmodified `origin/main`** `WorkoutEngine.swift` | **None — 34/34 passed** | N/A (this run proves the suite CAN pass; it isn't a fundamentally broken/always-red suite) |

`SessionTimelineTests` drives the engine through a real `Timer`-based
simulation (`SimRun`) rather than the deterministic `phaseStart`-rewind
helper `WorkoutEngineTests` uses — real wall-clock sensitivity is exactly
the profile that would flake under heavy concurrent simulator load on a
shared host, and five *different* tests failing once each, with zero repeat
offenders and zero overlap with the code this fix touches, is the signature
of contention-driven timing jitter rather than a logic regression. Traced
each of the four inspectable failures directly to code that this fix does
not exercise (table above); did not additionally re-litigate the fifth
(`timeIntervalsSplitSuppressedInReps`) beyond confirming its assertion
targets split-suppression, an unrelated subsystem.

**Conclusion: no new failures attributable to this fix.** The one suite
this fix's code lives in (`WorkoutEngineTests`) is unconditionally green
across every run; the only suite that ever failed (`SessionTimelineTests`)
failed on a different, code-path-unrelated test each time, consistent with
pre-existing environmental flakiness under the exact contention pattern
F114 already documents, not a regression this session introduced.

**Confirmed directly**: a fifth full-suite run, launched to fire only once
the ENTIRE host showed zero `xcodebuild` processes anywhere (not just on
the target simulator), finally landed in a genuinely quiet window and ran
against this exact committed state:

```
✔ Test run with 239 tests in 17 suites passed after 22.692 seconds.
** TEST SUCCEEDED **
```

Full green, 17/17 suites, 239/239 tests — the same total this fix's very
first (pre-incident) run also produced. This is the clean confirmation the
contended runs above were standing in for; the contention-flakiness analysis
stands as the explanation for why the intermediate runs weren't this clean,
not as a substitute for it.

## 5 · Files changed

```
legacy/native/Faff/FaffWatch Watch App/WorkoutEngine.swift        | ~50 ++--
legacy/native/Faff/FaffWatch Watch AppTests/WorkoutEngineTests.swift | 104 +++++
```

Committed on `fix/f065-stride-board-redundancy-2026-09-14`, based on a
freshly-fetched `origin/main`. Not pushed, not merged.
