# Post-run experience — round 8, truthfulness & simplification closure pass

**Branch:** `feat/postrun-experience-lead`
**Base reconciled against:** `origin/main` @ `626a4414` (fully caught up at the
time of the final full-suite run below — main moves fast; re-fetch before
merging)
**Final commit:** `a7be472c` (this handback), on top of `555cdbd0` (merge of
`047c474c`, the pass itself, onto `626a4414`)
**Committed locally, push to origin pending** — every commit above is
complete and verified through the full shipping chain (build, full
FaffTests, full vitest); the push itself is currently blocked by the
pre-push hook's watch-conformance gate colliding with what reads as
persistent, ongoing concurrent watch-simulator test activity from another
session on this machine (`SessionTimelineTests` dying inside a different
test case on nearly every attempt, and the hook's own log naming the exact
mechanism: "something else drove [the simulator] — shoot.sh terminates and
relaunches the same bundle id the test host runs under"). Roughly a dozen
attempts across this round, spaced to let the process list clear first each
time, all diagnosed the same way. No `--no-verify` was used at any point —
this is the one standing item to resolve before the push clears; nothing
about it reflects on this pass's own correctness, which is proven
independently above.

The race-card layout objection from the round-7 handback is withdrawn (your
own words, at original resolution). This pass did not touch that layout.

---

## 1 · Rep completion truthfulness

**The bug, found at its root.** `web-v2/lib/execution/verdict.ts`:

```ts
const completed = n.completed !== false;   // WAS
```

`n.completed` is already the honest tri-state `lib/runs/run-shape.ts`'s
`NormalizedPhase` resolves it to (`true` / `false` / `null` — null meaning
the wire never said either way). Coercing with `!== false` reads `null` as
`true`, which is Rule 11's exact forbidden shape: "don't know" collapsed
into "yes". This is what let "4 of 4 completed" print on data that never
claimed any of the four finished — confirmed by grep: **exactly one
non-test call site ever wrote to `.completed`** in the whole engine, and it
was this line.

**The fix.**
- `GradedPhase.completed: boolean` → `boolean | null`, the coercion removed
  (`const completed = n.completed;`). Grading is unaffected — both
  `gradeWorkPhase`/`gradeCeilingPhase` only branch on `=== false`, and
  `null !== false`, so a phase with no signal still grades on pace normally;
  only *display* reads this field now, and it may not read `null` as "yes".
- `PhaseBreakdown.completed` (wire interface, `lib/coach/run-state.ts`) and
  the Swift decode (`Runs.swift`) widened the same way — the Swift side was
  its own independent instance of the bug (`?? true` on decode), now
  removed.
- `V5RoutePhase` (Today's phase wire type, `APIV5.swift`) gained a
  `completed: Bool?` field it didn't have at all before, sourced from
  `app/api/v5/today/route.ts`'s `routePhases`.

**The resolver.** New `repCompletionSummary(states:planned:)` in
`RepBreakdownV5.swift` — a pure function from per-rep `RepRecordState`
(`.completed` / `.partial` / `.skipped` / `.unknown`) to the *weakest claim
the data actually supports*:

| Condition | Claim |
|---|---|
| any rep's completion unknown | `"Recorded"` / bare count — never the word "completed" |
| a rep explicitly incomplete | `"Completed"` / `N of M` (M excluding chosen skips), sub names how many ended early |
| all recorded, non-skipped reps explicitly complete, fewer than planned | `"Completed"` / `N of PLANNED`, sub names the gap as missing |
| more recorded than planned | `"Recorded"` / total, sub names the surplus |
| a chosen skip present, otherwise clean | `"Completed"` / `N of (recorded − skipped)`, sub names the skip |
| everything recorded is explicitly complete, planned unknown or matches | `"Completed"` / `N of N` |

Wired into `RunDetailV5.workCompletion` (which has `rep_skips` and
`planned_spec.rep_count`, so can reach every branch) and
`TodayAfterV5.repCompletionGrid` (which has neither yet — passes
`planned: nil`, so it can never claim missing/extra, which is the honest
degradation for a surface with less data, not a guess).

**Verified live, real data:** the interval fixture's four reps all carry
explicit `completed: true` on the wire — confirmed by reading the raw JSON,
not assumed — and the rendered grid still says "4 of 4" (screenshot below).
The fix does not regress the case where the claim is actually earned.

**Verified for the cases no single real fixture has all of:** eleven new
XCTest cases (`RepCompletionSummaryTests.swift`) exercise
`repCompletionSummary` directly — complete, ended-early, multiple-partial,
chosen-skip, skip+partial combined, extra-rep, missing-rep, and two
incomplete-phase-data shapes (all-unknown, and one-unknown-among-three-
known). Hand-editing a real fixture's JSON to fabricate these would have
been the exact fabrication Rule 13 forbids for a *render*; testing the pure
resolver directly is the honest way to prove its logic, and the two real
call sites are each verified separately against genuine wire data (both
described above).

**Fallback wording, exactly as asked:** until missing/extra data exists on
a surface, that surface says `"N reps recorded"` (well, `"Recorded" / "N"`
in the grid's label/value split — the equivalent of the sentence form) never
`"N of N completed"`.

---

## 2 · Pace-shape language, including charts

**The caption.** `RunAnalysisV5.swift`'s pace-chart caption said "The dashed
line is what each piece asked for" unconditionally — reintroducing the exact
ceiling/window ambiguity the rest of this closure pass removed from prose,
in the one place the chart explained its own marks. Now:

- both shapes present → `"Dashed line: pace ceiling. Shaded range: pace window."`
- ceiling only → `"The dashed line is the pace ceiling — not to run faster than."`
- window only → `"The shaded range is the pace window to hold."`

**The visual treatment now actually differs, not just the words.**
`AnalysisBand` (`lib/postrun/analysis.ts`) gained a `paceShape` field
(`GradedPhase.shape`, unmodified — no new computation, just exposed) and the
Swift `RunAnalysisBand` decodes it. The chart:

- draws a **ceiling** as the existing single dashed step-line (a one-sided
  boundary is correctly one line);
- draws a **window** as a new **filled range** between its two edges
  (`TargetStepBand`, a new `Shape` that fills between two step-functions) —
  never the same mark for a limit and a range;
- draws **effort-only** and **no-contract** phases with nothing at all,
  which was already correct (they carry no `targetSecPerMi`).

**The audit, beyond the caption:**

- `"came in ahead of the ceiling"` (the `allFast` branch, easy/long days run
  entirely too fast) read as **praise** for violating a ceiling — a
  ceiling's only failure mode is running faster than it, so "ahead of" is
  backwards. Now `"ran faster than the ceiling allowed"`, unambiguous either
  direction. (A window's "came in ahead of the window" was left — its sense,
  finishing quicker than the window's fast edge, is directionally correct
  and was already flagged as fine by the code's own prior audit comment.)
- Two identical `"Ended before its target"` verdict-phrase strings (one on
  the ceiling arm, one on the window arm of `phaseVerdictPhrase`) used
  "target" for a completion fact that has nothing to do with pace direction,
  and a ceiling never claimed a "target" point in the first place. Both now
  read `"Ended early"`.
- `RepBreakdownV5.swift`'s own header comment still described the pre-
  PACE-CONTRACT-1 "asked" convention as current. Corrected to describe
  `paceContractText`'s actual, shape-aware behaviour.

**Full audit performed** across `target`/`asked`/`hit`/`missed`/`under`/
`over` in the primary post-run surfaces (RunDetailV5, TodayAfterV5,
RepBreakdownV5, WorkoutResultV5, PostRunLearnedV5, ChartsV5,
experience.ts, run-recap.ts). The `bound`/`insideBound`/`aheadOfBound`/
`outsideBound` shape-routing mechanism in `experience.ts` was already
correct (a prior round's fix, confirmed by its own header comment and a
live sweep it cites) apart from the one `aheadOfBound` ceiling case above.

---

## 3 · Less-is-more, applied harder

- **`"Six strides after, walk-backs taken."` → `"Six strides completed."`**
  Routine walk-backs (doctrine's own prescription — full walk-back or a
  60–90s jog) are no longer narrated in the primary summary sentence, matching
  the same "do not make the runner scan six nearly identical rows" instruction
  applied to prose rather than a list.
- **`"You kept the run controlled, staying under the pace ceiling."` →
  `"Easy run stayed controlled."`** (or "Long run" / "Recovery run" /
  "Shakeout", per the session's own `runWord`.) The ceiling was already
  stated verbatim two inches above, in the stats grid's "No faster than
  X/mi" sub-text — restating it in the headline sentence was exactly the
  Rule 17 repetition this pass exists to remove.
- **The diagnostic sentence is off the primary page.** "The watch had you
  inside the target pace for 9:50 of the 27:40 of work it graded" no longer
  renders inside the always-visible Piece-by-Piece card at all.
  `RepBreakdownV5`'s `toleranceLine` parameter is now dead (every call site
  passes `nil`; kept rather than torn out in the same pass that touched
  every caller, for review-ability — a follow-up can delete it cleanly).
  The content moved into `PostRunVerdictV5`'s existing "Why" disclosure as a
  new `analysisNote` parameter, last in the list, and was rewritten in plain
  language: `"Held the pace window for 9:50 of 27:40 of graded work."`
  — "target pace" (ambiguous) → "pace window" (this sentence only ever sums
  non-ceiling phases, so the word is correct for what it measures).
  **Verified live**: rendered, tapped "Why", confirmed the sentence appears
  last in the disclosure, in plain language, off the primary scan path
  (screenshot below).
- **Routine walk-back rows.** Not restructured into a new collapsed/summary
  UI this pass (that would be a new section, against the explicit
  instruction) — the summary-sentence fix above removes the walk-back
  narration from the primary prose, which is the part actually on the
  primary scan path; the detailed per-row walk-back list still lives inside
  the existing Piece-by-Piece disclosure exactly as before. Flagging this as
  a partial: the *rows themselves* are unchanged; only the sentence
  narrating them moved/shortened.

---

## 4 · Plan impact is self-explanatory

`PostRunVerdictV5`'s compact status row now reads, e.g.:

> ↻ Plan updated. · Friday reduced to 5 mi

New `planStatusDetail` sources `model.changes.first` — itself already
gated server-side on a real `coach_intents` adaptation row
(`readPlan` in `experience.ts` only returns `status: 'UPDATED'` when
`input.adaptations.length > 0`; the change text is `adaptations.map(a =>
a.display)`, never invented client-side). **"Plan updated" was already
impossible to say without a canonical persisted mutation before this
pass** — verified by reading `readPlan`'s full branch structure, not
assumed. This item was therefore about *surfacing* the existing guarantee,
not adding one.

The detail renders as one `Text` concatenation with `.lineLimit(1)` +
`.truncationMode(.tail)`, so a long change description truncates gracefully
rather than wrapping the compact row to a second line. The promoted first
change is dropped from the "Why" disclosure's own change list (`changes
.dropFirst()`), so it is not read twice (Rule 17); any second or further
change still lives there in full.

**Verified live** on the race fixture: `"Plan updated. · The plan was
adjusted."` (the honest fallback text — this particular adaptation record's
`why` field did not resolve to a specific description, so `runnerSafeWhy`
fell to its own default rather than inventing one; the mechanism is proven,
the specific fixture's underlying adaptation just didn't carry a richer
`why`). "Plan unchanged." (no adaptation) confirmed unaffected on the other
three fixtures.

---

## 5 · Verification system repair

The round-7 handback flagged `run--161412146640788.json`'s
`phase_breakdown` as missing the non-optional `index` field on every phase,
causing a silent decode failure and fallback to the sign-in screen. **Re-
checked this round: the file on disk now decodes cleanly** (`index` present
on all five phases, confirmed by reading the raw JSON directly before
touching Swift at all). This is the same file as before — whether it was
regenerated by the walk-substrate between rounds or the earlier finding was
against a since-overwritten copy in the same `/tmp` path is not fully
resolved, but the current, actually-used copy is not malformed, and it was
rendered fresh this round rather than reusing the round-7 screenshot, per
the instruction.

It is the **Americas Finest City half marathon** — real race data,
`race_matched: true`, finish 1:41:53. Rendered fresh on all three device
sizes below.

**Multi-size clipping check, real device classes (not simulated scaling):**

| Device | Result |
|---|---|
| iPhone SE 3rd gen (smallest currently supported) | Clean. Title wraps to one line, hero and stats grid fit, "Plan updated · ..." row fits |
| iPhone 17 (standard) | Clean |
| iPhone 17 Pro Max (existing baseline) | Clean, confirmed unchanged from round 7 |

Also checked the densest layout — the marathon-specific long run's 2×3
stats grid (six labelled values, two with sub-text) — on the SE
specifically, since it is the tightest constraint: title wraps to two
lines, grid renders complete, no clipping.

This was a clipping check only, per the instruction — no layout changes
were made as a result of it; nothing needed one.

---

## 6 · Reconciliation

- Adaptation-engine failures — **6 tests across 3 files**
  (`lib/adaptation/_belief_source_pins.test.ts`,
  `lib/adaptation/_zero_mutation_scan.test.ts`,
  `lib/adaptation/canonical-shadow/_never_mutates_plan.test.ts`) —
  **confirmed still present on `origin/main` alone**, checked in an
  isolated worktree at three different points this round (`ae7bb6fd`,
  `626a4414`, and again at `de641aa2` — main kept moving during this pass),
  identical failing test names every time. Unrelated to any file this pass
  touches: two guard the `canonical-shadow`/adaptation-engine write
  boundary (`run-live-shadow-evaluation.ts`, `canonical-adaptation-shadow-
  log-retention.ts`), one is an import-ratchet on that same layer, and one
  is a content-hash ratchet on `lib/race/race-outlook.ts` — a different
  subsystem again, race prediction rather than adaptation writes. Not
  fixed here, not claimed as green, not merged past. This is a decision
  for you or whoever owns those subsystems, not something folded into this
  branch's scope.
- Re-fetched `origin/main` twice this round as it moved (`ae7bb6fd` →
  `6ad03ae0` → `626a4414`); reconciled against the latest each time. One
  real merge conflict across both merges, in `native-v2/Faff/Faff/ViewsV5
  /TodayAfterV5.swift` (this pass's comment change colliding with a
  concurrent `supplementalRunsSection` addition — both kept, verified by
  build). `project.pbxproj` conflicted both times, resolved by regenerating
  from `project.yml` via `xcodegen generate` rather than hand-merging the
  generated file, each time.
- **Full shipping chain, run clean at the final base:**
  - `tsc --noEmit`: clean.
  - `xcodebuild ... build` (full `Faff` scheme, watch target included as a
    dependency): `** BUILD SUCCEEDED **`.
  - `xcodebuild ... test` (full `FaffTests` suite, not a subset): **passes
    in full**, network fence intact (every live call to faff.run blocked,
    none reached a server). Running the FULL suite for the first time this
    round (rather than a targeted subset) surfaced two pre-existing
    regressions from before this pass — `askedPace` silently `nil` on a
    2026-08-11 fixture that pre-dates the `pace_shape` field (shipped
    2026-09-01) — fixed by correcting the *tests'* expectations to the
    documented, correct "nil rather than a guessed contract" behaviour
    (`paceContractText`'s own header already stated this was the intended
    behavior for an absent shape), not by changing the behavior itself.
  - `vitest run` (full suite, web-v2): **9991 passed, 6 failed, 24 skipped**
    (10021 total, 524 files). The 6 failures are exactly the pre-existing
    adaptation/race-outlook ratchets above — confirmed by name-for-name
    match against the isolated-worktree runs. A narrower run scoped to this
    pass's actual area (`lib/postrun`, `lib/execution`, `lib/coach`,
    `lib/training` — 143 files) is **fully clean: 3542 passed, 0 failed.**

---

## Screenshots

`docs/reports/postrun-experience-lead-2026-09-03/screenshots/round8-*`:
race fixture at SE / standard / Pro Max sizes, marathon-long fixture at SE,
interval fixture with "Why" expanded (the relocated tolerance sentence).

---

## Merge recommendation

**Ready for review.** Not self-merged to `main` per standing branch policy.
Build, full FaffTests, and this pass's own area of the vitest suite are all
clean; the only red in the full suite is the 6 pre-existing, unrelated
adaptation/race-outlook tests confirmed present on `origin/main` itself,
independent of this branch, at three different points as main moved during
this pass. That is the one open item outside this branch's control —
flagging for your decision on timing (or whoever owns
`lib/adaptation`/`lib/race`), not blocking this branch's own push.

Main moves fast (three re-fetches this round: `ae7bb6fd` → `6ad03ae0` →
`626a4414`, with a fourth commit landing during the final verification
pass — `de641aa2` — after this branch's own merge base was already locked
in and verified). Re-fetch and reconcile once more immediately before
actually merging this branch, rather than treating `626a4414` as still
current by then.
