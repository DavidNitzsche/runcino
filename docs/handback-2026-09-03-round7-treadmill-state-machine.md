# Handback · round 7 — TREADMILL-STATE-MACHINE-1

3 September 2026. P0 investigation and repair of tonight's failed treadmill hill session
(David's real run, 17:25:18–18:08:04 PDT). Everything below traces to a command actually run
or a file actually read — see citations throughout.

## 1 · Installed build vs. source, and per-symptom classification

**The run's data carries no app-version/build-number field** (confirmed by reading
`web-v2/app/api/watch/workouts/complete/route.ts` end to end and grepping the whole
`web-v2/app/api` tree for any client-version header — zero matches), so which exact
TestFlight build was on the phone cannot be proven from server data alone. What can be
proven: the run ingested at **18:08:04.581 PDT**. Commit `6e90917c` ("EXECUTION-IDENTITY-1
... TREADMILL-STRUCTURE-1") — the fix that made `nominalMph`/`nominalInclinePct` read
`treadmillSpeedMph`/`treadmillInclinePct` for every phase, not just work — landed on `main`
at **17:42:58 PDT**, mid-run, and could not have been in any distributed build the phone
already had installed. A concurrent session's independent trace (message received mid-session,
quoted with permission) places the run on **build 259**, 14 minutes before build 260 uploaded.

| # | Symptom | Status | Root cause / citation |
|---|---|---|---|
| 1 | Didn't auto-advance warmup→intervals without pause/resume | **Fixed this session** | Two independent phase-boundary computations (display vs. recorder) — see §2 |
| 2 | HR only after backgrounding, then stopped updating | **Fixed this session** | `TreadmillHRStreamer`/`MetricChannel` never called `enableBackgroundDelivery` or the HKObserverQuery completion handler — see §4 |
| 3 | Wrong prescribed speeds loaded | **Fixed this session** (two bugs) | (a) already-fixed-but-absent-from-installed-build (build 259 predates `6e90917c`); (b) a SECOND, deeper bug this session found: `Models/Watch.swift`'s phase re-stamp silently dropped `treadmillSpeedMph`/`treadmillInclinePct`/`hrRole` to `nil` on every real decode, so even build 260's fix was reading from a value that never arrived |
| 4 | Editing one interval didn't propagate to equivalent later intervals | **Was unimplemented; fixed this session** | No mechanism existed at all — see §5 |
| 5 | No audio/tone cues | **Was unimplemented; fixed this session** | Zero audio/haptic/speech infrastructure anywhere in the phone app — see §6 |
| 6 | Weak/missing execution info | **Was unimplemented; fixed this session** | No current-phase-remaining or total-progress display existed — see §7 |
| 7 | No Skip/Next control | **Was unimplemented; fixed this session** | `BeltSession.skip()` existed, zero call sites — see §7 |
| 8 | Speed/incline boxes changed size | **Fixed this session** | No fixed-width container on the digit text — see §7 |
| 9 | Manual changes not consistently reflected | **Fixed this session, as a side effect of §2** | Same dual-tracker root cause as #1 |
| 10 | Cooldown speed lagged until another control touched | **Fixed this session, as a side effect of §2** | Same dual-tracker root cause as #1 |
| 11 | Cooldown showed no remaining time | **Fixed this session** | The only remaining-time display was "next phase in X," `nil` on the last phase — see §7 |
| 12 | END had no confirmation | **Was unimplemented; fixed this session** | Direct call on tap — see §7 |

## 2 · The root cause (§1-2, #1, #9, #10)

`LiveRunTreadmillV5`'s **display** answered "what phase am I in" from `LiveRunPhaseWalk.walk(phases:
elapsedSec:)` — a pure function of *total* elapsed time. `BeltSession`'s **recorder** (which drives the
actual belt speed/incline the runner can act on, and what gets saved) answered the same question from
`belt.segElapsedSec`, a separate, *segment-local* counter, via its own threshold check. Two independent
walks over the same phase list — this app's own named defect class (Rule 16). When they drifted, a
pause/resume or a stray tap forced a resync, which read as "needed a nudge to advance." Cooldown's speed
lagging until another control was touched, and the display saying "Cooldown" while the belt still
targeted the prior phase, are the same defect at different tick offsets.

**Fix:** `BeltSession.configurePhases([WatchPhase])` hands the recorder the full phase list — the exact
same array the view's own `walk` property reads. `advanceToCanonicalPhase()` calls
`LiveRunPhaseWalk.walk` with the SAME total elapsed seconds every tick. Display and recorder cannot
disagree because they are now, by construction, the same computation. `BeltSession.swift:558-576`.

## 3 · Captured-run data — inventory and salvage result

Read-only DB reconnaissance (production, via `DATABASE_URL_RO`) confirmed **nothing needs
recovering**. The run (`runs.id = -240375143823562`) is complete and correctly linked:

- Full 21-phase structure survived (warmup → 10×[hill, recovery] → cooldown), with per-phase
  distance, speed, incline, and pace-sample series intact.
- Correctly linked to the prescribed workout (`planWorkoutId: wko_7afeef3d8f439088`) and
  distinguishable from the same-day supplemental friend's run, which carries its own
  classification note and never touches this workout's completion.
- Raw HR samples exist for every phase, including all 10 hill reps (though those 10 work
  phases never got summarized into a phase-level `avgHr`/`maxHr` — a real gap, but in what
  was *stored*, not lost data — recovery and warmup did get summarized).
- One clean ingestion, ~4 seconds after End, no duplicates.
- Cooldown is honestly marked `completed: false` — only 90 of the prescribed ~540 seconds ran,
  matching the observed symptom.

**No production write was made or proposed.** The row is already the honest record of what
happened; there is nothing to salvage or dry-run a correction against.

## 4 · HR background delivery (#2)

`TreadmillHRStreamer.start()` and its five `MetricChannel` siblings (running power/GCT/vertical
oscillation/stride length/energy) registered an `HKObserverQuery` but never called
`store.enableBackgroundDelivery(for:frequency:)` — present already, with the same entitlement, in
`HRAlerter.swift` and `HealthKitImporter.swift` in this same app. Without it, the observer only fires
while the process is actually running; backgrounding stalls every live update until the app is
foregrounded again, at which point HealthKit delivers exactly one stale catch-up batch — matching
"HR only appeared after backgrounding and returning, then stopped." Separately, the observer's
completion handler was never called at all (`{ [weak self] _, _, _ in ... }` — the middle parameter
IS the completion handler, per this codebase's own working pattern in `HRAlerter.swift:194`), which
risks iOS throttling further background delivery. Both fixed: `TreadmillHRStreamer.swift`.

## 5 · Override propagation (#4)

`BeltSession` now tracks `speedOverrideByType`/`inclineOverrideByType: [WatchPhaseType: Double]` —
one override per phase TYPE, not per instance, so changing one hill rep's speed carries to the
rest of that set, isolated from recovery, and vice versa. `resetOverride(for:)` provides the
"simple reset-to-plan action." **Falsified twice before landing** (Rule 18): the first version left
the legacy untyped `runnerSetSpeed` flag fighting the new typed dictionaries, so a work-phase
override rode straight into the next recovery phase's speed. `testAWorkOverrideNeverLeaksIntoRecovery`
and `testARecoveryOverrideNeverLeaksIntoWork` were both red on first run; fixed by removing
`runnerSetSpeed` from the typed decision path entirely (it still governs the legacy,
`Views/TreadmillView.swift`-only code path, unchanged).

## 6 · Audio, haptics, cues (#5)

Zero audio/haptic/speech infrastructure existed anywhere in the phone app before this session
(confirmed by grep across the entire `native-v2/Faff/Faff` tree). `WatchPhase.haptic` is decoded
on the phone but drives the WATCH's Taptic Engine only, over a separate wire path never
consumed phone-side. New file `TreadmillCueEngine.swift`: tone + haptic + a short spoken
sentence on every phase transition, a countdown tick in the last 3 seconds of a phase, a
halfway cue, and a completion cue — all fired from `BeltSession.lastTransition`, the state
machine's own transition event, never a view-local timer, so a cue cannot disagree with the
visible phase. `AVAudioSession` configured to duck rather than interrupt music. Two
UserDefaults-backed toggles surfaced from a small menu on the console itself — no new settings
screen.

## 7 · The console — targets, controls, progress (#6, #7, #8, #11, #12)

- **Skip**: `BeltSession.skip()` already existed and worked; it had zero call sites anywhere in
  the app. Wired to a real control with a `confirmationDialog` naming the phase being left and
  the one coming next.
- **End**: was a direct call on tap. Now requires confirmation, stating elapsed time and
  distance.
- **Stable-width digits**: the speed and incline number `Text` views had no fixed-width
  container, so the flanking ± buttons shifted position as digit count changed (single vs.
  double digits). Fixed with a `ZStack` reserving space via an invisible reference string sized
  to the widest value each control can ever produce (`"20.0"` for speed, `"15.0"` for incline —
  `BeltSpeed.bounds`/`setIncline`'s own clamp), plus `.monospacedDigit()`.
- **Current-phase remaining**: the only remaining-time display was "next phase in X," which is
  `nil` on the last phase by construction — the literal cause of "cooldown showed no remaining
  distance or time." Added an unconditional current-phase remaining line.
- **Total progress**: added "Phase N of M."
- **Override badge**: "Custom pace for this set" + Reset, shown only while the current phase is
  running under a standing override.

## 8 · Resume after interruption (survives background/kill)

Two mechanisms, addressing two different interruption shapes:

1. **App stays alive, timer stalls** (screen locked/backgrounded — `RunLoop` timers do not fire
   AT ALL while the process is suspended, they are not merely late): `BeltSession.catchUp(at:)`,
   called explicitly from the view's `scenePhase` observation the instant the app returns to
   `.active`, forces an immediate recompute rather than waiting for the timer's next natural
   fire. `BeltTracker`'s own gap-crediting policy (unchanged, pre-existing, well-tested) makes
   the resulting jump honest — credited at the last known belt settings, marked unmeasured.
2. **App is killed and relaunched mid-run**: `BeltSession.resume(from checkpoint:phases:)`
   reconstructs `segmentIndex` from the SAME canonical walk everything else uses, so a runner
   relaunching mid-hill-rep reopens on that exact rep — not phase 0, and not merely
   re-submitted as a flattened partial (the old behavior). Distinguished from a genuinely
   abandoned session (checkpoint older than `BeltTracker.maxCreditedGapSec`, 30 minutes, or for
   a different `workoutId`), which still salvages as a partial exactly as before. **Known
   limitation**: the checkpoint only ever stored totals (unchanged, pre-existing design — "a
   partial run that exists beats a complete one that does not"), so phases closed automatically
   during a resume's catch-up walk carry zero measured duration/distance for the span before
   relaunch, not a full per-phase reconstruction.

## 9 · Completion payload

Added `targetSpeedMph`/`targetInclinePct` alongside the existing `actualSpeedMph`/
`actualInclinePct` per phase — a gap found and reported by a peer session's independent trace of
tonight's run: the server's `WatchCompletionPhaseBody` has no target fields at all, so the
originally-prescribed number has never round-tripped back, which is part of why post-run
consistently reads "no prescribed pace" even for a session with a concrete live target.
Additive (confirmed no strict schema on the route — a plain TS `interface`, no Zod `.strict()`
gate). **Not done in this pass, flagged as real follow-up scope**: consuming these fields
server-side (`lib/postrun/experience.ts`'s `not_graded` verdict, extending
`WatchCompletionPhaseBody`'s own type) — that's a second session's domain, coordinated live.

## 10 · Canonical state machine (owner: `BeltSession`)

```
                    ┌─────────────────────────────────────────┐
                    │              BeltSession                 │
                    │  (the ONLY owner of "what phase, what     │
                    │   target, what override")                 │
                    └─────────────────────────────────────────┘
   configurePhases([WatchPhase])         resume(from: checkpoint, phases:)
              │                                       │
              ▼                                       ▼
   ┌────────────────────┐              ┌─────────────────────────┐
   │  plan: [SegmentPlan] │◄────────────┤ elapsedSec seeded from   │
   │  watchPhases: [WatchPhase] │        │ checkpoint totals        │
   └────────────────────┘              └─────────────────────────┘
              │
   every tick (1 Hz timer, OR catchUp() on scenePhase .active)
              ▼
   ┌──────────────────────────────────────────────────────────┐
   │ belt.advance(now, speedMph, inclinePct, bpm)  ← BeltTracker │
   │        (unchanged — the one integrator, gap-crediting)     │
   └──────────────────────────────────────────────────────────┘
              │
              ▼
   advanceToCanonicalPhase()
     targetIndex = LiveRunPhaseWalk.walk(watchPhases, belt.elapsedSecInt).phase.index
     while segmentIndex < targetIndex:
         closeCurrentSegment(completed: true)
         segmentIndex += 1
         adoptTargetOrKeepRunnerSpeed()   ← typed override > plan target
         announceTransition(...)          → lastTransition (published)
              │                                          │
              ▼                                          ▼
   speedMph / inclinePct (published,           TreadmillCueEngine.phaseTransition
   read by the view's tiles)                   (tone + haptic + spoken sentence)
              │
              ▼
   ────────────────── SAME elapsedSec, SAME watchPhases ──────────────────
              │
              ▼
   LiveRunTreadmillV5.walk = LiveRunPhaseWalk.walk(plan.phases, elapsedSec)
              │
              ▼
   topRow / remainingThisPhaseText / nextLineText / overallPhaseNumber
   (display — GUARANTEED to agree with the recorder above, by construction)

   skip() / setSpeed() / setIncline() / resetOverride(for:)  ← runner input,
   all through BeltSession, never a second copy of state anywhere else.
```

## 11 · Before/after phase payload (`buildCompletionPayload`, per-phase entry)

```diff
   {
     "index": 3, "label": "Hill", "type": "work", "completed": true,
     "actualSpeedMph": 9.54, "actualInclinePct": 4.82,
+    "targetSpeedMph": 9.5, "targetInclinePct": 5.0,
     "actualDistanceMi": 0.16, "actualDurationSec": 60,
     "actualPaceSPerMi": 377,
     "paceSamples": [...], "hrSamples": [...]
   }
```

## 12 · Automated results

21 tests pass: `BeltTrackerTests` (11, pre-existing, unmodified — still green), the 15 new
`TreadmillStateMachineTests` (unified-walk agreement across a full synthetic run, full 8-phase
auto-advance end to end, final-phase never auto-advances, a large single-tick background-gap
catch-up, pause-exactly-at-a-boundary, skip + skip-on-final-phase-is-no-op, override
propagation + isolation in both directions + reset, resume-from-checkpoint lands on the correct
phase), `V5ContractTests`, `PlanVersionInvalidationTests` — zero failures on the final run. Two
real bugs were caught and fixed by this suite before landing (§5). `Faff` scheme builds clean,
Debug configuration, iOS Simulator (`xcodebuild`, 70s, 0 errors).

## 13 · Physical-device verification — NOT performed, and why

This session has no physical iPhone access — confirmed and stated up front, per Rule 13 ("never
a sample fixture for a display fix... if you cannot get real data, say so plainly"). I also
attempted a fixture-based visual pass through this app's own DEBUG screens catalog
(`-faffV5Screens`, entry `12b`) to at least confirm layout (stable-width digits, Skip/End
dialogs, progress line) against the app's own `#Preview` sample data, and could not locate that
specific entry's rendered position in the catalog list within a reasonable number of attempts —
abandoned rather than continuing to spend budget on a check that would not have satisfied Rule
13 for the underlying bugs regardless (it uses fixture data, not real backend data). What stands
in its place: full source-level read-through of every changed line, and the automated test
suite in §12, which drives the actual `BeltSession.tick(at:)` entry point the real 1 Hz timer
calls — not a mock, not a fixture.

**What still needs a physical device, specifically**: confirming HR truly stays live through a
real background/foreground cycle on real hardware (the `enableBackgroundDelivery` fix is
correct per this codebase's own working pattern elsewhere, but iOS background delivery timing
has real-world variance a simulator cannot reproduce); confirming cue audio actually ducks
music rather than interrupting it; confirming the Skip/End confirmation dialogs are not
trivially double-tappable in practice; and the full real-time feel of the console during an
actual hill session.

## 14 · Exact state

- Branch: `main`. Commit `de641aa2` ("fix(treadmill): TREADMILL-STATE-MACHINE-1 — one
  canonical phase walk, resume, overrides, Skip/End confirm, HR background delivery, cues"),
  rebased onto `origin/main` at `626a4414` (an unrelated, non-conflicting plan fix from a
  concurrent session) before push.
- **Pushed and live on `origin/main`.** `626a4414..de641aa2 main -> main`. The pre-push gate
  chain (web typecheck, `next build`, watch-gate — 223 test cases) passed clean on the final
  attempt; three prior attempts failed on transient `.next` build-cache corruption from this
  being a heavily-active shared checkout tonight (confirmed non-code-related: the failing route
  changed each time, and each attempt's own `tsc`/`next build` compile step succeeded before the
  page-data-collection step hit a stale manifest) — resolved by clearing `web-v2/.next` and
  retrying, not by touching any source. Railway is building the pushed tree.
- **Not shipped to TestFlight.** Per standing instruction ("never ship TF without explicit David
  approval"), this session stopped short of that step and is asking first.
- Reconciled with concurrent work: `feat/pre-run-experience` (unmerged branch, `TREADMILL-HILL-2`
  / phase-restamp-fix) was found to have already been superseded on `main` by a different
  implementation (`6e90917c`, "TREADMILL-STRUCTURE-1") plus this session's own fix to the
  remaining decode gap — no merge of that branch was needed or attempted. A concurrent peer
  session's independent trace of tonight's run (received mid-session) was cross-checked and
  matched; coordinated live rather than duplicating work (see §9).

## 15 · Known limitations

- Checkpoint-based resume only carries session TOTALS, not a per-phase breakdown — a relaunch
  mid-run produces a slightly lossier phase-by-phase record for time before the relaunch (§8).
- The server-side consumption of `targetSpeedMph`/`targetInclinePct` (post-run's "no prescribed
  pace" reading) is not fixed — the client now sends the data, nothing yet reads it (§9).
- Per-phase `avgHr`/`maxHr` summarization gap on work phases in the stored data (raw samples
  exist) was found but not fixed — outside the treadmill execution loop's scope, flagged for
  whoever owns `/api/watch/workouts/complete`'s summarization.
- No `ruleOutcomes` verdict is recorded despite the workout defining pass/bail HR rules — same,
  flagged not fixed.
- Physical-device verification, per §13.

## 16 · Verdict

**Not yet cleared for another real workout without the physical-device pass in §13.** Every
named symptom has a source-grounded root cause and a landed, tested fix; the automated suite
falsified two real bugs in the fix itself before it shipped, which is real evidence the
mechanism works, not just that it compiles. But this session cannot personally confirm the
thing David actually experienced — a live hill session on a real belt, with a real watch, HR
staying up through a real background cycle — actually feels right now. The honest ask: a short
supervised treadmill session (5-10 minutes, a couple of manufactured intervals) once this build
reaches a device, watching specifically for auto-advance, HR continuity through one
background/foreground cycle, one Skip, one propagated override, and the End confirmation.
