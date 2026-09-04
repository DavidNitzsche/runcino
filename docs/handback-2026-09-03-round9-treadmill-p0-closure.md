# Handback · round 9 — TREADMILL P0 closure

3 September 2026, continuing directly from round 7's handback. This closes the five
gaps flagged in review of TREADMILL-STATE-MACHINE-1: a genuinely live HR channel
(not just async), equivalent-SET override propagation (not bare type), the server
target round-trip, HR summaries without suppressing raw HR, and a rebuilt verification
harness — then reconciles with a concurrent session's own live-rendered fix
(TREADMILL-SKIP-1) found on the exact same runtime.

## Verdict

**Complete for everything this session could verify without a physical device or a
physical watch. Not yet cleared for an important real workout** — same standing
verdict as round 7, now with a materially stronger evidence base underneath it: 60
Swift tests (was 15), 2 new backend tests, and a second session's own real
simulator-rendered walkthrough of the exact runtime (Skip → auto-advance through all
21 phases → cooldown → End, with the header staying in sync throughout). What's
missing is specifically what no simulator can prove: a real watch's HR actually
mirroring live to a real phone, and the whole loop on hardware in your hands.

## 1 · Root cause, per gap

**Gap 1 — live HR was async-only.** `TreadmillHRStreamer` read HR via
`HKObserverQuery`/`HKAnchoredObjectQuery` — real, but a HealthKit-store round-trip
(5-30s latency by its own prior header), not the "supported mirrored-workout
architecture" the review asked for. Root cause of "HR only appeared after
backgrounding, then stopped": neither this channel nor the five running-form/energy
channels ever called `enableBackgroundDelivery` (present already elsewhere in this
app, same entitlement) or their `HKObserverQuery` completion handler at all.

**Gap 2 — overrides keyed on bare type.** `speedOverrideByType`/`inclineOverrideByType`
treated every `.work` phase as one set. A session with two differently-prescribed work
blocks (e.g. hills then strides at a different speed) would have carried an edit on
the first block into the second.

**Gap 3 — no server target round-trip.** `NormalizedPhase`/`GradedPhase` (the
canonical stored-phase readers) had no `targetSpeedMph`/`targetInclinePct`/`hrRole`
fields at all, so a by-effort treadmill work phase's belt target — real, authored,
visible on the console the whole time — could never reach the post-run page. It read
"no prescribed pace," indistinguishable from a session that genuinely had nothing
prescribed.

**Gap 4 — HR summaries.** Raw HR samples for short work reps were already collected
(round 7), but nothing labelled WHY a rep's HR shouldn't be graded, so a
server-side/post-run reader had no honest way to tell "real data, not gradable" from
"nothing collected."

**Gap 5 — the harness was built for the pre-review architecture.** 15 tests, none
proving equivalent-SET propagation across two differently-targeted blocks, none
proving the checkpoint-to-resume gap is credited rather than dropped.

## 2 · What changed

**`TreadmillHRStreamer.swift` + new `TreadmillHRFreshness.swift`.** Registers
`HKHealthStore.workoutSessionMirroringStartHandler` in `init()` — before the watch's
own session can start, removing a registration race — receiving the watch's live
`HKLiveWorkoutBuilder` callbacks with no store round-trip. Gated behind
`if #available(iOS 26.0, *)`: `HKLiveWorkoutBuilder` is iOS-26-only **on the phone**
(long available on watchOS; this app's deployment target is 17.0), so iOS 17-25
silently keeps the async-only behavior — never a crash, never a wrong answer, just the
same reliability round 7 already shipped. Both channels feed one `applySample`,
keeping whichever sample is freshest regardless of source — provenance is recorded,
never used to prefer a staler sample. `TreadmillHRFreshness.swift` is the pure,
HealthKit-free policy (`TreadmillHRFreshnessPolicy`) computing
current-value/source/timestamp/connected-delayed-stale-unavailable from sample age —
unit-tested, unlike the HealthKit wrapper around it. Also fixed the missing
`enableBackgroundDelivery`/completion-handler calls.

**`BeltSession.swift` + new `TreadmillPhaseSets.swift`.** `TreadmillPhaseSets.setIds`
groups phases by (type, nominal target) tracked per type across the whole phase list.
**Falsified and fixed mid-session**: the first version compared each phase only to its
immediate predecessor, so a real Hill/Jog/Hill/Jog structure (recoveries interleaved)
gave every phase its own id — an override would have propagated to nothing. Caught by
its own test. `resetOverrideForCurrentSet()` replaces the old type-keyed reset.
Checkpoint override fields are now Int-keyed (set id).

**`run-shape.ts` / `verdict.ts` / `experience.ts` / `route.ts`.**
`NormalizedPhase`/`GradedPhase` gain `targetSpeedMph`/`actualSpeedMph`/
`targetInclinePct`/`actualInclinePct`/`hrRole`, sourced from the phone's own
`buildCompletionPayload` (which now sends the ORIGINAL authored target — never
reconstructed from actual — alongside `paceShape`/`targetPaceSPerMi`/
`tolerancePaceSPerMi`/`hrRole`/`hrTargetBpm`). `readExecution`'s `not_graded` branch
tells "by-effort treadmill work, never a pace target" apart from "genuinely nothing
was prescribed" and words the sentence accordingly — never re-grades, never invents a
pace. **Falsified and fixed a second real bug**: `isStridePhase`'s rung 2
("`shape === 'effort'` implies stride") predates any treadmill phase ever sending a
real `paceShape` back — the moment it round-tripped for real, a two-hill-rep test read
as "two strides." Fixed by excluding phases carrying `targetSpeedMph`
(treadmill-only) from that rung.

**Reconciled: TREADMILL-SKIP-1** (a concurrent session, found live-rendering the
runtime under a new DEBUG-only accelerated clock, `-faffFastPhases`). A manual Skip
advances `segmentIndex` immediately but deliberately never advances elapsed time
(elapsed time is the measured record of what happened, not something a skip should
fabricate) — so the view's `walk` property, a pure function of elapsed time, could
report a phase an entire step behind the one the belt had already moved to. Fixed with
`LiveRunPhaseWalk.skipFloorSec`, floors the walk's elapsed-time input at the
cumulative duration through the belt's own `segmentIndex`. This is the one case my own
state-machine unification didn't cover — auto-advance and skip are structurally
different (one driven by elapsed time, one an explicit override of position) — and
it's the right fix for it: extends the "one canonical answer" contract rather than
inventing a second one. Verified compatible: rebuilt and re-ran the full test suite
together, 60/60 pass.

## 3 · Falsification results (Rule 18 in practice)

Two of my own tests were red on first run against code I believed correct:

- `testAWorkOverrideNeverLeaksIntoRecovery`/`testARecoveryOverrideNeverLeaksIntoWork`
  (round 7) — the untyped `runnerSetSpeed` flag fighting the new typed dictionaries.
- `testSetIdsGroupConsecutivePhasesOfTheSameTypeAndTarget` (this round) — the
  adjacency-only grouping algorithm, described above.
- The `isStridePhase` collision (this round) — found via a new backend test
  (`TREADMILL EFFORT · a by-effort hill session is not read as "no prescribed pace"`)
  that initially failed with "This run carries no session structure... Two strides
  after."

All four are now green, and each fix is the reason a specific test exists — not
retrofitted after the fact.

## 4 · Automated results

- **iOS**: 60 tests pass (`TreadmillStateMachineTests` 28 — was 15 in round 7, plus
  TREADMILL-SKIP-1's own 2 — `BeltTrackerTests` 11, `V5ContractTests`,
  `PlanVersionInvalidationTests`, plus TREADMILL-SKIP-1's own falsifiers). `Faff`
  scheme builds clean, Debug, iOS Simulator.
- **Backend**: 2183 tests pass across `lib/postrun`, `lib/execution`, `lib/runs`
  (full directories, not just the touched files) — zero failures, zero regressions.
  `npx tsc --noEmit` clean.

## 5 · What this session could NOT verify, named plainly

- **The mirrored-session HR path itself.** Compiles, gated correctly, delegate wiring
  matches the watch's own working `TreadmillHRSession.swift` pattern — but this
  session has no physical watch, no physical iPhone, and driving two paired
  simulators through a real HealthKit workout-mirroring handshake was judged too
  fragile/uninformative to attempt blind (per the P0 brief's own item 14: simulator
  evidence must not be presented as physical-device proof). Real proof needs your
  watch on your wrist.
- **Audio ducking against real music**, on real hardware — the `AVAudioSession`
  configuration is standard/correct by inspection, unverified by ear.
- **The full accelerated live walkthrough** — done by the OTHER session
  (TREADMILL-SKIP-1's commit message), not independently repeated by this one; their
  account is taken as real evidence (a live render with a real screenshot-driven
  account, per this project's own Rule 13), not re-verified from scratch.

## 6 · Shared-checkout reconciliation, disclosed precisely

This session's commit `de641aa2` (round 7) was independently captured — via
`git commit -a` or equivalent — into another session's ship commit before this
session had a chance to commit it directly. That commit's `git add` swept up the
MODIFIED files my code depended on but not the two NEW files it referenced
(`TreadmillPhaseSets.swift`, `TreadmillHRFreshness.swift`) — leaving `origin/main`
non-compilable from a clean checkout for a period. This round's own commit
(`79b6f329`) corrected that (both files added), verified by a clean build from the
exact committed tree, not just the working directory.

Separately, this round's own push was blocked twice by Railway build failures
**unrelated to any of this session's own changes** — a stale spacing-token literal in
another session's concurrent diagnostics view, and a stray test/gate mismatch from
another session's sealing-logic refactor (SEALING-IDENTITY-1). Per the standing
instruction not to bypass a gate for convenience: this session did NOT force-push past
either failure, flagged both to the session that owned the underlying changes (Lead
Agent, confirmed as the owner of both), and coordinated rather than duplicating the
fix — including reverting a redundant local cherry-pick once Lead Agent confirmed a
broader combined fix was already in flight.

## 7 · Exact state at time of writing

- Branch: `main`. This session's commits, in order: `de641aa2` (round 7, the original
  state machine — captured into a concurrent ship commit before being committed
  directly), `b1ff9f71` (round 7 handback doc), `79b6f329` (this round's gap closure +
  the missing-files repair), `fde0b525` (physical-device test script), `cae09863`
  (TestFlight build-counter bump, this section).
- Reconciled with, not duplicating: `cd754fd3` (TREADMILL-SKIP-1, a concurrent
  session, merged in cleanly via fast-forward, re-verified together); `7a87f6b4` and
  `6e2fb564` (Lead Agent, two more merge-inherited gate breaks blocking Railway on
  commits neither session had touched — a spacing-token/coach-voice pair this session
  independently hit and fixed in parallel with theirs, and a `plan-snapshot.ts`
  derived-consistency finding this session held off on rather than duplicate).
- **Railway: SUCCESS**, verified independently against the deployment API (not taken
  on a peer's word alone) on commit `2b7b5afa7cf324da2e1534c7f967919a09b181a8` —
  the exact tip of `main` at the moment of shipping. Deployment id
  `53a53e80-34af-4cd5-b905-699daf3fd33e`.
- **TestFlight: build 269 shipped**, source commit `2b7b5afa`. Archived, exported,
  uploaded (`altool`, delivery UUID `148f1eb3-4982-4e16-8bb2-2772aff3a066`), validated
  `VALID` and export-compliant by App Store Connect, added to the Internal Testers
  beta group, and distributed. Build-counter bump (`.asc.build` 269→270,
  `CURRENT_PROJECT_VERSION`) committed as `cae09863` and pushed; `main` is green on
  that exact commit as of this writing (a stray non-deterministic XcodeGen UUID diff
  in `project.pbxproj` from the archive step was confirmed as noise — same logical
  `Secrets.xcconfig` reference, new random TEMP id — and discarded, not committed).
- **Not yet done: the physical-device test script itself has not been run.** Build 269
  is on David's phone via TestFlight now; the 10-step script at
  `docs/treadmill-p0-physical-device-test-script.md` (committed `fde0b525`) is what
  covers the two work reps / auto-transitions / live HR / one propagated override /
  audio-under-music / background-foreground / Skip / cooldown / End / post-run-page
  loop this handback's verdict (§0) still marks unverified.

## 8 · Known limitations carried forward from round 7, still open

- Checkpoint-based resume only carries session TOTALS, not a per-phase breakdown.
- Server-side consumption of `hrTargetBpm` beyond storage (grading against it) is not
  built — flagged, not done, per "do not implement HR pass/fail rule outcomes until
  the source and sample quality are trustworthy."
- Per-phase `avgHr`/`maxHr` summarization gap on very short work phases in already-
  stored rows (raw samples exist) — outside the treadmill execution loop, not this
  session's to fix.
- Physical-device and physical-watch verification, per §5.
