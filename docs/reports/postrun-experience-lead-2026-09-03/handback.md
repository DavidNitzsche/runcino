# Post-run experience — lead handback

Branch `feat/postrun-experience-lead`, base `origin/main@8a242994` (fresh fetch at session start).
Worktree `.claude/worktrees/postrun-experience`. One commit: `ee11a0ff`.

---

## 0 · The headline finding

**Before writing any code, I audited what already exists.** The post-run brief
(`docs/0901/post-run-experience-review-and-brief-2026-09-02.md`) asks for a
canonical `PostRunExperienceV1` contract, typed execution/cost/evidence/plan
sections, a synchronized pace/HR/elevation chart, matched-workout comparison,
and a full information hierarchy across Today-after-run and Run Detail.

**All of it is already built and merged to `main`**, across three prior
efforts:

- `stage4/post-run` (`d4ad5130`, `f4aa227d`, `b4ccad56`, `76d05a0d`) — the
  canonical contract, execution/cost/evidence/plan typed sections, CEIL-SLACK-1
  cross-surface grading parity.
- `df795881` "the chart stack, grade-adjusted pace, and a matched workout" —
  `RunAnalysisV5.swift`, the synchronized chart with phase bands, per-band
  target overlay, touch-scrub, grade-adjusted pace; `MatchedWorkoutV5.swift`.
- `fix/postrun-breakdown` (`45f2d02f`, `433b4083`) — the simulator-payload bug
  (post-run screen was grading a QA simulator's 0.27 mi activity instead of
  the runner's real run), the strides section, `beliefTension` wiring so
  `CHALLENGES` can actually fire.

I did not re-derive, re-architect, or duplicate any of this. Building a
second post-run composer on top of working, doctrine-compliant, extensively
tested code would have been exactly the mistake this assignment's ownership
boundary warns against ("Do not create a second post-run composer, evidence
engine, grader, or adaptation explanation path").

**What I found genuinely missing, confirmed by grep across the whole native
tree:** the runner has no way to log RPE/effort on the current build. The
brief's own Actions section names this ("Add effort/RPE where supported")
and, in the same sentence, names the exact anti-pattern to avoid ("Do not
place ten tiny RPE buttons in one fixed row at accessibility sizes"). A
control matching that anti-pattern exists — `RPEEntryCard` in the legacy
`Components/Toolkit/I_RunDetail.swift` — but it is dead code: nothing
instantiates it, and the two screens this brief governs
(`RunDetailV5`/`TodayAfterV5`) never call it or its API. `post_run_rpe` holds
9 rows in production, all from before the V5 migration.

This is the one piece of the brief's explicit scope that was real, confirmed,
and unclosed. I built it.

---

## 1 · Provenance

- Start `8a242994` (origin/main, fetched fresh), one commit `ee11a0ff`.
- Worktree, not the shared main checkout — see §7 for a process note on a
  mistake I caught and reversed early in the session.
- No migrations. No production writes. Device verification used a local,
  isolated copy of production (`faff_visual_walk_postrun`, port 3112 — a
  distinct DB/port from the shared `faff_visual_walk`/3111 substrate another
  session had running, so as not to disturb it) via the documented
  `scripts/walk-substrate.sh` / `scripts/walk-server.sh` read-only-from-prod
  pipeline.
- Not pushed to `origin` yet as of this report — pending the go-ahead in this
  conversation, consistent with "Do not merge a competing post-run
  implementation directly into `main`. Hand the focused branch back to the
  main programme lead for reconciliation, verification, and release."

---

## 2 · Files changed

```
native-v2/Faff/Faff/DesignV5/RPEV5.swift          | 216 ++++++++++++++++++ (new)
native-v2/Faff/Faff/ViewsV5/RunDetailV5.swift      |   9 +
native-v2/Faff/Faff/ViewsV5/TodayAfterV5.swift     |   6 +
native-v2/Faff.xcodeproj/project.pbxproj           |  14 +- (xcodegen regen)
```

`RPECaptureRow` (new): an `ExpandingRow` — the app's existing one picker
interaction, the same component the niggle row already uses — whose expanded
content is a `LazyVGrid(.adaptive(minimum: 44))` 1–10 scale. Wired into
`RunDetailV5`'s Layer 4 (new "Log" `ListGroup`, beside Shoes) and into
`TodayAfterV5`'s existing "Log" `ListGroup` (beside the niggle row), both
over the existing `GET`/`POST /api/runs/[id]/rpe` — a real, working endpoint
the dead card already called; I added no server code.

Design decisions, argued in the file's own header comments:

- **Adaptive grid, not a fixed 5-column layout.** Reflows to more rows as
  Dynamic Type grows rather than shrinking cells — every cell stays a real
  44×44 target at every text size.
- **No severity colour.** The legacy card graded 1–3/4–6/7–10 into three
  colours, one green. An RPE is the runner's own report, not a coach verdict,
  so selection uses the single accent (`V5.signal`) the rest of the design
  reserves for "selected" — the same rule `RunAnalysisV5`'s layer picker
  already follows, and consistent with the palette brief's "no green as a
  grade."
- **Per-cell accessibility labels** ("6 of 10, comfortably hard") rather than
  relying on the visible "Easy"/"Max" endpoints, which are marked
  `accessibilityHidden` and restated per-cell instead.
- **Reuses the existing `RPEValue`/`RPEResponse` wire types and
  `API.fetchRPE`/`API.postRPE`** rather than adding a second decoder for the
  same shape (Rule 16).

---

## 3 · Existing work reused

- `ExpandingRow`, `V5PressStyle`, `FaffButton`, `FaffValue`/`FaffValueText`,
  the full `TypeScaleV5`/`V5.S`/`V5.R` token set — no new design-system
  primitives.
- `API.fetchRPE`/`API.postRPE` and `/api/runs/[id]/rpe` — unmodified,
  pre-existing, working.
- `scripts/walk-substrate.sh` / `scripts/walk-server.sh` (the visual-walk
  substrate) and the `-faffToken`/`-faffHost`/`-faffRunDetail` DEBUG launch
  arguments in `FaffApp.swift` — all built by other sessions for exactly this
  verification purpose; I used them as documented rather than inventing a
  parallel path.

## 4 · Canonical contracts consumed

`PostRunExperienceV1` / `PostRunWire` (`lib/postrun/experience.ts`,
`lib/postrun/wire.ts`) via `detail.postRun`; `RunAnalysis`
(`lib/postrun/analysis.ts`) via `detail.analysis`; `MatchedWorkout`
(`lib/postrun/matched.ts`) via `detail.matchedWorkout`/`matchedRefusal`. My
addition consumes none of these — RPE is orthogonal to the coaching
interpretation (it is the runner's report, not a derived belief), so it
reads/writes only the pre-existing `/api/runs/[id]/rpe` route.

## 5 · Missing canonical dependency

None for what I built. For what I found already built by others but not yet
closed (§8), the missing pieces belong to owners outside this assignment's
boundary — named there.

---

## 6 · Before/after renders

Real production data (2026-09-01, run `-258355938987883`, 4×1mi threshold,
the brief's own worked fixture), via a local read-only copy of `main`.
Screenshots in `docs/reports/postrun-experience-lead-2026-09-03/screenshots/`:

| File | What it shows |
|---|---|
| `verify-rpe-default.png` | Full post-run screen at default text size: overview, reading, piece-by-piece with reconciliation sentence, the synchronized pace chart with phase bands and dashed target line, grade-adjusted "Worth on the flat," "What this taught the coach," the matched-workout comparison table against an 11-week-prior session — all pre-existing, confirmed rendering correctly together. |
| (inline, see transcript) | The "Log" group open, showing `RPECaptureRow` collapsed as "6 · comfortably hard" — the runner's real prior RPE, fetched live from `/api/runs/[id]/rpe` — beside the pre-existing "Flag a niggle" row. |
| (inline, see transcript) | `RPECaptureRow` expanded: "How hard did that feel, 1 to 10," the 7-across grid at this screen width, cell 6 selected in the single accent colour, no severity gradient. |
| `ax-medium-cold.png` | Same screen, cold-launched with the OS text-size setting at `accessibility-medium` — the app's own documented Dynamic Type ceiling (`FaffTypeScalingV5.ceiling`). Reading rows ("Heart rate, across the 4 reps," "Cadence, across the 4 reps," "Temperature, from weather") wrap to two lines cleanly; nothing clips or overlaps. |

**Before:** no RPE control reachable anywhere in the V5 app. **After:** one,
in both screens the brief governs, over the endpoint that already worked.

## 7 · Screen recordings

Not captured — the interactive simulator session in this environment proved
unstable under scripted swipe gestures late in verification (§9), and I
judged repeating the full scroll for video capture not worth the added risk
once static screenshots had confirmed the render. Flagging this honestly
rather than claiming a recording that doesn't exist.

**Process note, disclosed in full rather than glossed over:** early in this
session I mis-targeted several `Write`/`Edit` calls at the shared main
checkout (`/Volumes/WP/06 Claude Code/Runcino/...`) instead of this worktree,
before I'd actually entered it. I caught this via `git status` before
committing anything, confirmed via `git diff` that the only delta against
`HEAD` in the affected files was my own addition (i.e., no concurrent
session's uncommitted work was sitting in those two files at the time), moved
the change into the worktree with a patch, and reverted the main checkout to
clean. No data was lost, and the main checkout was verified clean before I
continued. Noted here per this project's own standing rule that a mistake
gets named, not buried.

---

## 8 · Test and build results

- `xcodebuild -scheme Faff -destination 'iPhone 17 Pro Max' build` →
  **BUILD SUCCEEDED** (phone + watch + widget targets).
- `xcodebuild ... test` → **137 tests, 0 failures.**
- `scripts/check-xcodeproj-sync.sh` → OK, 224 Swift files / 224 references.
- `scripts/check-palette-sync.sh` → OK (pre-existing 49-file legacy-palette
  exemption unaffected by this change).
- No new unit tests added for `RPECaptureRow` specifically — it has no
  business logic of its own to unit-test (the adjective table is the only
  pure function, six lines, and is exercised indirectly by every screenshot
  above showing the correct word for 6). The load-bearing behaviour (does the
  right value round-trip through the real endpoint) is what device rendering
  verified, per Rule 13, which explicitly ranks rendering over a fixture-based
  test for exactly this class of change.
- Backend (`web-v2`) untouched by this branch — no `npm run prebuild`,
  `tsc`, or `vitest` run needed, and none skipped that should have run.

## 9 · Performance findings

- Chart interaction (`RunAnalysisV5`'s hold-to-scrub) felt smooth in the
  portions I exercised.
- **Simulator instability, disclosed as a genuine finding, not swept under
  cross-surface consistency:** repeated fast full-height swipes against the
  `-faffRunDetail` fixture harness reproducibly crashed/respawned the app
  process on this shared, heavily-loaded host (dozens of concurrent
  agent worktrees were active throughout this session). Slower, smaller
  swipes did not reproduce it. I cannot tell from here whether this is a real
  gesture-handling defect in `RunAnalysisV5`'s
  `LongPressGesture.sequenced(before:)` composition under synthetic touch
  injection specifically, or simulator/host resource contention unrelated to
  the app. Naming it rather than guessing at a cause I didn't verify.
- A likely-unrelated, minor finding surfaced incidentally while testing
  Dynamic Type: the "Start the Run" sheet's workout-title line ("10×60s hills
  @ 5K-10K effor…") truncates with an ellipsis at `accessibility-medium`.
  Outside this assignment's boundary (not a post-run surface), flagged for
  whoever owns that sheet.

## 10 · Integration risks

Low. The diff is additive (one new file, two small insertions into existing
`ListGroup`s, a routine `xcodegen` regen). Nothing existing was restructured.
The only shared surface touched is the "Log" `ListGroup` in `TodayAfterV5`,
where I added a sibling row beside the pre-existing niggle row without
changing its logic.

## 11 · Overlap with the main programme

None found. `git log --all` shows no other branch currently touching
`RPEV5.swift` (it didn't exist before this commit), and no other branch's
diff against `main` touches the specific lines I added to
`RunDetailV5.swift`/`TodayAfterV5.swift`. `fix/postrun-breakdown` and the
chart-stack work are already merged, not concurrent with this.

## 12 · TestFlight inclusion status

Not shipped. This branch is unmerged, per this assignment's explicit
instruction not to merge a competing implementation directly — the main
programme lead should fold this in on their own schedule.

## 13 · Remaining work

**In my ownership boundary, not done:**

- None identified as outstanding after this change. The brief's Actions
  section also names shoe assignment, activity-match correction, and a
  data-problem report — all three already exist and render correctly
  (confirmed in the same screenshots: "Shoes you wore" with a working
  "Change" control; the niggle/"Not feeling right" rows).

**Outside my ownership boundary (evidence admission, stimulus grading,
workout prescription), already identified and routed to their owners by
the prior sessions that found them — restated here only so this handback is
a complete map, not to reopen or duplicate them:**

- `WatchCompletionPhase.isStrideSegment` not carried on the outgoing watch
  completion struct — native/watch.
- `WorkoutEngine.repCountForDisplay` off-by-one on a stride day — native/watch.
- Sixth partial-mile split row: `deriveSplitsFromPaceSamples` only emits on a
  whole-mile crossing — `lib/runs/**`.
- `work.paceSPerMi` in `lib/execution/verdict.ts`'s `WorkSummary` still
  averages strides into the work-pace mean that `goal-projection.ts` reads —
  stimulus grading, `lib/execution/**` owner.
- Capture-path truncation on a crash/battery-salvage completion
  (`WorkoutEngine.completionFromRecovery` drops overtime) — native/watch,
  diagnosed in full by `fix/postrun-breakdown`'s own report.
- The Start-the-Run sheet title truncation noted in §9 — whoever owns that
  sheet.

**A note on the brief's own §11 handback structure** (Executive scorecard,
run-type corpus, cross-surface consistency matrix, etc.): I did not reproduce
it in full here. Nearly every row in that scorecard reflects work completed
and already scored by `stage4/post-run`'s own handback
(`docs/reports/complete-coaching-brain-handback-2026-09-02/stage4-post-run.md`)
and `fix/postrun-breakdown`'s
(`docs/reports/complete-coaching-brain-handback-2026-09-02/postrun-breakdown.md`).
Restating those scores here as my own work would misattribute it; pointing
at the two documents that already carry it, with this report's own §0
correcting their one now-stale line (charts/matched-effort were "not
attempted" at stage4's time, then closed by `df795881` two days later),
seemed more honest than a superficially complete scorecard built by copying
numbers I did not personally re-derive.
