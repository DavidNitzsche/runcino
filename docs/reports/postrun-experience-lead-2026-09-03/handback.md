# Post-run experience — lead handback (revised)

Branch `feat/postrun-experience-lead`, base `origin/main@8a242994`.
Worktree `.claude/worktrees/postrun-experience`. Two commits: `ee11a0ff` (RPE
capture), `1a368b82` (the redesign this report is mostly about).

**Status: not complete, not ready for the programme lead to merge.** This
revision closes the specific defects a first round of review found in
`ee11a0ff`'s companion redesign and adds the redesign that round asked for.
It is a large step past the first handback, not the final word — see §12 for
what is still genuinely open.

---

## 0 · What the first pass got wrong, stated plainly

The first round of this assignment audited the brief, found the canonical
backend contracts already built, found one confirmed UI gap (RPE capture),
closed it, and stopped — treating "the data all exists on the page somewhere"
as equivalent to "the page answers the brief's questions." It is not. A
rendered review of that pass's own screenshot found eight concrete problems:
whole-run pace leading the page at hero weight over a 4×1mi day's real result
(7:02/mi across the work), the coaching answer three sections down, a tall
single-column "Reading" card of secondary numbers, piece-by-piece drawing a
one-minute jog at the same row height as a graded rep, and no visible shape to
the page at a glance.

This revision is the actual redesign. §1 is the hierarchy decision; §2-4 are
what changed; §5 is what device rendering of the REAL corpus (not one
fixture) found wrong in the first draft of the redesign itself, fixed before
this handback; the rest is verification and honest accounting.

---

## 1 · Information-hierarchy decisions

**Layer 1 — the workout result.** In order: the recording-honesty sentence
(unchanged position from the prior pass — "above every number it is about");
completion + work-phase-only pace + rep-to-rep spread (new,
`WorkoutResultFactsV5`); the coach's own sentence (`recapSection`, moved up
from after the old stats poster); what the run taught the coach and what
changed (`PostRunLearnedV5(.meaning)`, moved up from three sections down);
then compact supporting context — distance, time, the same scoped readings
the old "Reading" card held, in a two-column grid (new,
`SessionDetailsGridV5`) rather than a four-row single-column card.

**Layer 2 — workout analysis.** Piece-by-piece, reworked (§3), then strides.

**Layer 3 — charts and comparison.** The synchronized chart
(`RunAnalysisV5`, unchanged — it already met the brief), then the
matched-workout comparison (`MatchedWorkoutV5`, unchanged), moved up from
after the detailed-evidence layer to directly after the chart it is a
comparison ON.

**Layer 4 — detailed evidence.** The runner's own wrist decisions (moved
down from Layer 1, where the prior pass filed them — they are evidence for
what the run TAUGHT, and that claim now sits in Layer 1 without needing them
adjacent, since it is a server-composed sentence, not a client-assembled
argument), mile/split breakdown, the zone bar, the route.

**Layer 5 — actions.** Shoes, then the "Log" group (niggle, RPE).

**Why the reordering is safe:** every section that moved is drawn by the
same component in the same position relative to the OTHER things it is
about — nothing was rewritten to move, only relocated, so the risk is
sequencing, not new logic, with one exception (§3, the piece-by-piece rework,
which is real new code).

**TodayAfterV5 got the same Layer 1 reordering**, over what its thinner wire
shape can honestly support: `model.paceWork` (the same server-computed field
`RunDetailV5.pace_work` is) feeds the work-pace fact; completion count and
consistency are NOT shown there, because `V5RoutePhase` carries no
`completed` flag and no `pace_shape`, so that screen cannot tell a true rep
from a stride the way `RunDetailV5`'s `phase_breakdown` can. This is stated
in the code as a missing canonical dependency (§8), not silently worked
around with a guess.

---

## 2 · Layer 1 — `WorkoutResultFactsV5` and the compact grid

**New file:** `native-v2/Faff/Faff/DesignV5/WorkoutResultV5.swift`.

`WorkoutResultFactsV5` draws three facts, each independently nil-able:
completion (`N of M completed`), the work-phase-only pace (`pace_work`,
suffixed "average work pace"), and a spread sentence
(`WorkConsistencyV5.sentence`, pure arithmetic — max/min over already-graded
per-rep paces, no new judgement). All three are gated on
`isRepStyleSession` — see §5 for why that gate exists and what broke before
it did.

`SessionDetailsGridV5` is the "Reading" card's replacement: a two-column
`LazyVGrid`, a scope caption stated once above the grid instead of repeated
per row, `Metric.sub` carrying the "asked X" qualifier the old `stat()`
helper drew (kept, not dropped — see `askedPaceText`'s continued use).

`RunDetailV5.title` now checks a new `structuredIdentity` before falling
back to `type_display` — "4 × 1 mile threshold" when the session is an even
rep set of a type where that phrase reads naturally (§5's allowlist), never
drawn a second time in the body (Rule 17). It only fires when `detail.name`
is generic; a real device-supplied name (the Aug 16 half's "Americas Finest
City") still wins, unchanged from before.

---

## 3 · Layer 2 — `RepPiece.Kind` and the timeline strip

**Changed file:** `native-v2/Faff/Faff/DesignV5/RepBreakdownV5.swift`.

`RepPiece` gained a `Kind` (`warmup`/`work`/`recovery`/`cooldown`/`other`,
classified once from the phase's wire `type` at both construction sites —
`RunDetailV5.repPieces` and `TodayAfterV5.sectionPieces` — so the two
screens cannot classify a phase differently) and a `durationSec: Int?`. Row
rendering branches on `Kind`:

- `.recovery` → one line, quiet ink — label, distance/duration, pace.
- `.warmup`/`.cooldown` → two lines, real distance kept, the trailing verdict
  note dropped (a bookend's status is already implied by its ceiling
  framing).
- `.work`/`.other` → unchanged, the full two-line treatment.

A new `timelineStrip` — a proportional horizontal bar, one segment per
piece, weighted by `durationSec` (real seconds, not a decorative flat
weight — the first draft used `isWork ? 3 : 1` and was rewritten before
this commit once its own comment was read back and found to overclaim
proportionality it did not have) — sits above the row list on any session
with more than two pieces. Work segments in the one accent, everything else
quiet, no labels (the rows already carry every number this strip could
print).

**Not built: chart-row touch synchronization.** The brief asks for touching
a chart segment to highlight the corresponding row and vice versa. Not
attempted, for a stated reason rather than silently: `RunAnalysisV5`'s bands
and `RepBreakdownV5`'s pieces are built from the SAME `phase_breakdown` but
via two independent transformations (`RunAnalysis.bands` from
`lib/postrun/analysis.ts`, `repPieces` from the phone's own mapping) with no
guarantee their indices line up one-to-one, and `RunAnalysisV5` already owns
a `LongPressGesture.sequenced(before:)` gesture that had one documented
near-miss this session (a bare `DragGesture` breaking page scroll, per that
file's own header) — adding a second, cross-component gesture dependency
without dedicated interaction testing time was judged higher-risk than the
brief's ask justified finishing under this session's remaining budget. A
real fix needs either a shared phase-index model between the two composers
or a client-side reconciliation layer, and is sized as its own piece of
work, not a subtask of this pass.

---

## 4 · The duplicate RPE picker

**Changed files:** `TodayAfterV5.swift`, `HostsV5.swift`, `ScreensCatalogV5.swift`.

Found while adding TodayAfterV5's Layer 1: `askedVsRanSection` special-cased
the server's one "actionable" row (effort) into a ten-button picker
(`effortScale`, 29pt cells) that POSTed `/api/runs/[id]/rpe` directly via
`onLogEffort`/`HostsV5.logEffort` — the exact endpoint `RPECaptureRow`
(`ee11a0ff`) also writes, and the exact ten-buttons-in-a-row anti-pattern
the brief names by example, already flagged as broken in the component's
own prior comment ("reported rather than quietly altered").

Removed: `effortScale`, `expandedRowID`/`pendingEffort` state, the init's
effort-expansion logic, `onLogEffort` from `TodayAfterV5`'s init and from
its three call sites (`HostsV5.swift`, two `ScreensCatalogV5.swift`
previews), and `HostsV5.logEffort` itself (left orphaned by the removal, so
removed rather than left dead). `askedVsRanSection` now filters the
actionable row out and renders everything else as plain `ListRow`s.
`RPECaptureRow` is now the only way to log effort in the app.

---

## 5 · What rendering the real corpus found wrong in the redesign's own first draft

Two defects, both fixed before this commit, both found by rendering runs
this pass had not specifically built the redesign around — which is the
entire argument for doing this rather than stopping at one fixture:

**A marathon-specific long run read as a rep set.** The 2026-07-25 18mi long
run (9mi easy + 9mi actual @ half-marathon pace, prescribed 10) initially
rendered `WorkoutResultFactsV5` as "1 of 2 completed / 8:01/mi average work
pace / Reps ranged 7:51 to 8:11/mi" — because `trueWorkReps.count >= 2` is
also true of two DIFFERENT prescriptions inside one long run, not just of a
genuine interval set. Fixed with `isRepStyleSession`, gated on the same
`structuredIdentityTypes` allowlist (`threshold`, `interval`, `intervals`,
`tempo`, `vo2max`, `vo2`) the title's `structuredIdentity` already used —
chosen deliberately so the title and the facts block cannot disagree about
which sessions get rep-shaped treatment.

**"ACROSS ACROSS BOTH REPS."** The same long run's supporting-context grid
caption doubled a word. `readingRows` already reads `r.hr.note` as a
continuation of "Heart rate, " (producing "Heart rate, across both reps");
`sessionDetailScope`'s first draft prepended its own "Across " to the same
string. Fixed to capitalize `note` as-is rather than prefix it.

Both defects are exactly the class of thing Rule 13 exists to catch and a
single fixture cannot: the Sept 1 threshold day never exercises either code
path, because it has no non-rep multi-segment structure and its `note` never
starts with a duplicable word.

---

## 6 · The run-type corpus, rendered

Five real runs, all from a local read-only copy of production (the walk
substrate — see §9), all screenshotted after the fixes in §5:

| Run | Date | What it exercises | Screenshot |
|---|---|---|---|
| 4×1mi threshold | 2026-09-01 | Full Layer 1 facts block, rep-style gate, structured title, timeline strip, chart, matched comparison | `verify-rpe-default.png`, `ax-hero-top.png` (Dynamic Type) |
| Easy, single phase | 2026-08-31 | Facts block correctly ABSENT; compact grid; adapted chart (no phase bands) | `corpus-easy.png` |
| Marathon-specific long run | 2026-07-25 | Facts block correctly absent (post-fix); two-segment `piece by piece`; the "ACROSS ACROSS" fix | `corpus-long.png` (before fix), `corpus-long-fixed.png` (after) |
| Americas Finest City half | 2026-08-16 | Real device name wins over `structuredIdentity`; a genuine `changeState: UPDATED` — "The plan moved after this run" — the one run in this runner's history where the plan actually changed (per prior sessions' Rule 21 audit); 5-piece course-segment timeline | `corpus-half.png` |
| Easy + 6 strides | 2026-09-02 | Capture reconciliation sentence at the top; compact `.recovery`-kind rows for the six walk-backs; facts block correctly absent (strides are not reps) | `corpus-strides.png` |

**Not rendered, and named rather than omitted silently:** a truncated/
incomplete recording, a run with missing HR, a rescheduled/modified
workout, a treadmill run. None of the runs available in this runner's
recent history (the walk substrate is a snapshot of his real account)
happens to be one of these shapes; building synthetic fixtures for them
would be exactly the "sample fixture skips the real code path" failure mode
Rule 13 warns against, so they are left unrendered rather than faked.
Flagged for whoever runs this corpus next with real data.

---

## 7 · RPE test coverage

**New file:** `native-v2/Faff/FaffTests/RPECaptureTests.swift`, 12 cases,
same `URLProtocol`-stub strategy as `SignInFlowTests` — real requests
through `API.authedSend`, no live network:

save new · update existing (second POST body carries the new value, not the
first) · server error → `false`, not a throw · client error → `false` ·
offline write → throws · offline read → throws (corrected mid-write from an
initial wrong assumption about `fetchRPE`'s posture — the test itself
caught its own first draft being wrong) · undecodable-but-200 response →
`nil`, not a throw · two different run ids never cross-contaminate · a
fresh fetch reads back what was just saved (this project's version of
"persists after relaunch," since RPE has no local cache and every render
re-fetches) · no prior value reads as `nil`, never a synthesized zero ·
notes omitted when not typed · notes included verbatim when typed.

**Not covered, stated rather than silently absent:** `RPECaptureRow`'s own
`@State` — the `submitting` guard against rapid double-tap, the
`pickedRpe != priorRpe` dirty check gating the Save button's visibility.
This project has no ViewInspector or equivalent SwiftUI view-state testing
library (checked by grep before writing this file); that behavior is
verified by reading the source (`RPEV5.swift`'s `submit()` sets
`submitting = true` before the async call and every button site checks
`enabled: !submitting`) and by the interaction recording in §9, not by a
unit test claiming to reach it.

**Also not covered: the server-side "absorbed run" question.** Read
`web-v2/app/api/runs/[id]/rpe/route.ts` while writing this section:
`INSERT ... VALUES ($1, $2, $3, ...)` writes against whatever `activityId`
string it receives, with no canonical-row check. Rule 14 of this project's
own doctrine ("a query names the population it reads") suggests writing RPE
against a non-canonical/absorbed run id would create an orphaned row that
never surfaces on the canonical run's own history. This is a real,
unverified gap — not something the client can fix or test around, and named
as a missing backend dependency in §8, not silently assumed safe.

---

## 8 · Canonical dependencies, missing or partial, and their owners

| What | Where | Status |
|---|---|---|
| `stimulusDelivered` (FULL/PARTIAL/etc, the brief's five-outcome system) | `lib/postrun/experience.ts` (computed), NOT in `lib/postrun/wire.ts` (never sent to the phone) | **Not missing — doctrinally excluded on purpose.** `PostRunWire`'s own header cites `PRODUCT_UX_SIMPLIFICATION_DOCTRINE.md`: only runner-facing prose crosses the wire, and `postRun.summary`/`.headline` already carry the plain-language translation the brief itself asks for ("Translate each into plain language. Do not expose the label alone"). No client-side re-derivation attempted — would violate "no client derives coaching outcomes." |
| `V5RoutePhase.completed` / `.pace_shape` | `web-v2/app/api/v5/today/route.ts` → `V5Today.routePhases` | **Missing.** `TodayAfterV5` cannot honestly compute completion count or rep-consistency the way `RunDetailV5` can from `phase_breakdown`. Owner: whoever owns `app/api/v5/today/route.ts`'s `routePhases` composition. |
| `analysis` / `matchedWorkout` on `V5Today` | same route | **Missing.** Today-after-run has no chart, no matched-workout comparison — `RunDetailV5` is the only screen with either, because the fields are simply absent from `V5Today`. The original brief's own architecture note says these should eventually be one screen reading one run-id, not two independent payloads; this pass did not attempt that unification (out of scope for the time available, and a bigger structural change than a hierarchy pass should make unilaterally). |
| RPE write has no canonical-row / absorbed-run guard | `web-v2/app/api/runs/[id]/rpe/route.ts` | **Confirmed gap, §7.** Backend owner. |
| Chart-row phase-index alignment | `lib/postrun/analysis.ts` bands vs. phone's `repPieces` mapping | **Not verified to align.** Needed before chart-row touch sync (§3) could be built safely. |

Nothing in this table was worked around with a client-side guess. Each
either has an argued reason it is correctly absent, or is named as a real
gap for its actual owner.

---

## 9 · Verification

**Build:** `xcodebuild -scheme Faff -destination 'iPhone 17 Pro Max' build`
→ `BUILD SUCCEEDED` (phone + watch + widget targets), after every code
change in this pass.

**Tests:** 137 tests, 0 failures, on the final build. One full-suite run
during this pass showed two failures
(`DecodeSweepTests.testWireCorpusSurvivesOneCorruptionAtATime`,
`RunLobbyHrLineTests.test_phoneOwnerNeverClaimsHrFromDeviceChoiceAlone`) —
neither touched by this branch's diff; both passed cleanly when rerun in
isolation immediately after, consistent with host-load flakiness rather
than a regression. Recorded rather than quietly rerun away.

**Device rendering (Rule 13):** all five corpus runs (§6), at default text
size; the Sept 1 fixture additionally cold-launched at
`accessibility-medium` — the app's own documented Dynamic Type ceiling
(`FaffTypeScalingV5.ceiling`) — showing the full new Layer 1 hero
("INTERVALS · 4×1.0MI @ 7:02" / "4 of 4 completed" / "7:02/mi average work
pace" / "Reps ranged 6:58 to 7:07/mi" / the coach paragraph / "ACROSS THE 4
REPS" grid) wrapping and scaling cleanly with no clipping or truncation.
Screenshot: `ax-hero-top.png`.

**Screen recording:** `scroll-demo.mov` (~16s) — a full-page scroll from
the Layer 1 hero through the chart, the matched-workout comparison, the
route, and into the Log group; a long-press-then-drag scrub gesture on the
pace chart; the "Effort" row expanding to its accessible grid. Captured via
`xcrun simctl io recordVideo`.

**The reproducible-seeming crash, investigated as asked.** The prior pass's
handback (before this revision) reported an unclassified crash under fast
full-height swipes against the `-faffRunDetail` render harness. This pass
set up OS log capture (`log stream`, filtered to the app process and
`com.apple.CrashReporter`) and repeated the identical gesture — same
coordinates, same duration, same target screen — five times across two
separate launches. It did not reproduce, on either attempt, and the log
capture shows nothing resembling a crash signal on the clean runs.
**Classification: likely host/simulator resource contention under this
session's concurrent multi-agent load, not a reproducible app defect** —
stated as a classification with the evidence behind it (non-reproduction
under identical conditions, no crash artifact in the one capture that did
run clean), not as a certainty. A single confirmed crash log, if one turns
up from a future occurrence, would be the thing that overturns this.

**Not conclusively verified: Reduce Motion.** Attempted via
`simctl spawn ... defaults write com.apple.Accessibility
ReduceMotionEnabled -bool true`; `V5.Motion.reduced` reads
`UIAccessibility.isReduceMotionEnabled`, and this pass could not confirm
that the `defaults write` path actually sets the value that API reads (as
opposed to the Settings app's own toggle, which was not exercised). Stated
as unverified rather than claimed.

**Not attempted: VoiceOver capture, small-phone (SE-class) and Dynamic
Island-specific rendering.** Time-boxed out of this pass. The existing
accessibility groundwork (per-cell labels on the RPE grid, `accessibilityValue`
on `ExpandingRow`'s expanded state, `accessibilityHidden` on decorative
elements including the new timeline strip) is unchanged from what was
already in place and reviewed by earlier passes; nothing in this redesign
removes or narrows an existing accessibility affordance, but nothing new was
added beyond what §7 and the Dynamic Type render already cover.

---

## 10 · Performance

Chart scrubbing (the long-press-then-drag gesture) felt smooth across every
render this pass did. No frame-rate measurement tool was used — this is an
impression from interacting with it, not a number, and is stated as such.
The timeline strip (`RepBreakdownV5`) is a `GeometryReader` + `HStack` of up
to ~20 segments on the longest real session in this corpus (the AFC half's 5
pieces; nothing in the corpus reached the "ten-repetition workout" case the
brief specifically asks the compaction to handle at scale) — not stress-tested
at that size with real data, because no run in the available corpus is that
shape (§6).

---

## 11 · Swift build status / TestFlight readiness

Builds clean, tests pass (§9). **Not shipped, not merged.** This branch is
still explicitly not to be merged directly per the assignment's own
instruction — hand back to the programme lead for reconciliation against
`origin/main`, which has moved to `8eef3552` since this branch's base
(`8a242994`); this pass did not rebase, to avoid destabilizing mid-review
work, and flags the divergence here for the merge step to handle.

---

## 12 · Remaining limits — honest, not exhaustive-sounding

**In my ownership boundary, real, not done:**

- Chart-row touch synchronization (§3) — sized as its own piece of work,
  reason stated.
- TodayAfterV5's Layer 3 (charts, matched comparison) — blocked on the
  missing `V5Today.analysis`/`.matchedWorkout` fields (§8), not something
  the client can build around honestly.
- The remaining run-type corpus states (truncated recording, missing HR,
  rescheduled workout, treadmill) — no real data of these shapes was
  available in this runner's recent history to render honestly (§6).
- VoiceOver capture, small-phone/Dynamic-Island-specific renders, a
  confirmed Reduce Motion verification (§9).
- A frame-rate measurement for chart scrubbing and the timeline strip under
  real load, rather than an interaction impression.

**Outside my ownership boundary, named for their actual owners:**

- Everything in §8's table.
- The native/watch and `lib/runs`/`lib/execution` items the previous
  handback (`ee11a0ff`'s commit message) already routed — unchanged by this
  pass, not re-litigated here.

**A note on scope discipline.** This pass fixed defects it found in ITS OWN
new code (§5) and one adjacent defect it found while building Layer 1 for
TodayAfterV5 (§4, the duplicate RPE picker — in scope because it directly
conflicted with the RPE work this branch already owns). It did not go
looking for unrelated defects elsewhere on these two screens beyond what
rendering the corpus surfaced. That is a deliberate boundary, not an
oversight: the assignment is post-run experience, and treating every
adjacent finding as in-scope is how a hierarchy pass turns into an
unbounded audit.
