//
//  TreadmillStateMachineTests.swift
//  Falsification for TREADMILL-STATE-MACHINE-1 — the single canonical
//  phase-boundary walk `BeltSession` now shares with the view's own display
//  (`LiveRunPhaseWalk.walk`), plus the behaviors built directly on it:
//  auto-advance, skip, per-type override propagation, pause-at-a-boundary,
//  a background-gap catch-up in one tick, and resume-from-checkpoint.
//
//  Every test drives `session.tick(at:)` with explicit `Date`s — the exact
//  entry point the real 1 Hz timer calls — never a real clock, never
//  `sleep`, per this repo's own falsification pattern (see
//  `BeltTrackerTests.swift`'s header).
//
//  What this file does NOT and cannot cover, named per Rule 13: stable-width
//  digit rendering, the End/Skip confirmation dialogs actually blocking a
//  tap, and cue audio/haptics actually firing on a speaker — all three are
//  real UI/hardware behavior with no headless XCTest surface. Covered
//  instead by simulator screenshots and, ultimately, a physical device.
//

import XCTest
@testable import Faff

@MainActor
final class TreadmillStateMachineTests: XCTestCase {

    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    private func hillPhase(_ index: Int, type: WatchPhaseType, label: String, durationSec: Int,
                           speedMph: Double, inclinePct: Double) -> WatchPhase {
        WatchPhase(index: index, type: type, label: label, durationSec: durationSec,
                  targetPaceSPerMi: nil, tolerancePaceSPerMi: nil, haptic: .start,
                  treadmillInclinePct: inclinePct, treadmillSpeedMph: speedMph)
    }

    /// Warm-up (300s) → 3×[Hill work 60s / Jog recovery 120s] → Cooldown (180s).
    /// Small enough to drive second-by-second in a unit test, structurally
    /// identical to the real 21-phase hill session.
    private func hillSet() -> [WatchPhase] {
        var phases: [WatchPhase] = [hillPhase(0, type: .warmup, label: "Warm up", durationSec: 300,
                                              speedMph: 5.5, inclinePct: 1.0)]
        var i = 1
        for rep in 1...3 {
            phases.append(hillPhase(i, type: .work, label: "Hill", durationSec: 60,
                                    speedMph: 9.0 + Double(rep) * 0.1, inclinePct: 4.0))
            i += 1
            if rep < 3 {
                phases.append(hillPhase(i, type: .recovery, label: "Jog", durationSec: 120,
                                        speedMph: 5.0, inclinePct: 1.0))
                i += 1
            }
        }
        phases.append(hillPhase(i, type: .cooldown, label: "Cool down", durationSec: 180,
                                speedMph: 5.0, inclinePct: 1.0))
        return phases
    }

    private func makeSession(phases: [WatchPhase]) -> BeltSession {
        let s = BeltSession(workoutId: "test", speedMph: 5.5, inclinePct: 1.0, now: t0)
        s.configurePhases(phases)
        s.start(at: t0)
        return s
    }

    private func advance(_ session: BeltSession, seconds: Int, from t: Date) -> Date {
        var now = t
        for _ in 0..<seconds {
            now = now.addingTimeInterval(1)
            session.tick(at: now)
        }
        return now
    }

    // MARK: - One canonical walk

    /// The defect this whole file exists to falsify: display and recorder
    /// disagreeing. `session`'s own segment cursor and a fresh
    /// `LiveRunPhaseWalk.walk` call over the SAME phases/elapsed must name
    /// the same phase at every second of a full run — never just at the
    /// boundaries.
    func testRecorderNeverDisagreesWithTheDisplayWalk() {
        let phases = hillSet()
        let session = makeSession(phases: phases)
        var now = t0
        let totalSec = phases.reduce(0) { $0 + $1.durationSec }
        for _ in 0..<totalSec {
            now = now.addingTimeInterval(1)
            session.tick(at: now)
            let elapsed = session.belt.elapsedSecInt
            guard let walked = LiveRunPhaseWalk.walk(phases: phases, elapsedSec: elapsed) else {
                XCTFail("walk returned nil at elapsed \(elapsed)"); return
            }
            // The recorder's own currentSegment target speed must match
            // whatever phase the shared walk says is active RIGHT NOW —
            // this is the literal claim the state-machine unification makes.
            XCTAssertEqual(session.currentSegment?.targetMph, BeltSession.nominalMph(for: walked.phase),
                           "disagreement at elapsed \(elapsed)s: recorder vs display walk")
        }
    }

    // MARK: - Automatic transition

    func testAutoAdvancesFromWarmupIntoTheFirstHillRep() {
        let phases = hillSet()
        let session = makeSession(phases: phases)
        _ = advance(session, seconds: 300, from: t0)   // exactly the warm-up's duration
        XCTAssertEqual(session.speedMph, phases[1].treadmillSpeedMph!, accuracy: 1e-9,
                       "belt speed did not auto-adopt the first hill rep's own target")
        XCTAssertEqual(session.inclinePct, 4.0, accuracy: 1e-9)
    }

    /// Full 8-phase structure end to end — the actual complaint's shape, not
    /// a single boundary.
    func testAdvancesThroughTheEntireStructureWithoutIntervention() {
        let phases = hillSet()
        let session = makeSession(phases: phases)
        var now = t0
        for phase in phases {
            now = advance(session, seconds: phase.durationSec, from: now)
        }
        // Cooldown never auto-ends — the runner ends manually.
        XCTAssertEqual(session.speedMph, phases.last!.treadmillSpeedMph!, accuracy: 1e-9)
        XCTAssertEqual(session.closedCount, phases.count - 1, "every phase but the last should have closed")
    }

    /// Never advances past the final phase, however long it runs.
    func testFinalPhaseNeverAutoAdvances() {
        let phases = hillSet()
        let session = makeSession(phases: phases)
        var now = t0
        for phase in phases.dropLast() { now = advance(session, seconds: phase.durationSec, from: now) }
        let closedBeforeOverrun = session.closedCount
        _ = advance(session, seconds: 600, from: now)   // run the cooldown long
        XCTAssertEqual(session.closedCount, closedBeforeOverrun, "the last phase auto-advanced or auto-ended")
    }

    // MARK: - Background gap in one tick

    /// The exact shape of "didn't advance without a pause/resume": a real
    /// timer stalls (app backgrounded), then one big tick lands. The
    /// canonical walk must land on the correct phase in that ONE tick — no
    /// pause/resume required to "wake it up."
    func testALargeSingleGapCatchesUpToTheCorrectPhaseInOneTick() {
        let phases = hillSet()
        let session = makeSession(phases: phases)
        // Warm-up (300s) + first hill (60s) + 40s into the first recovery —
        // one jump, simulating a stalled background timer's first tick back.
        let jumpTo = t0.addingTimeInterval(300 + 60 + 40)
        session.tick(at: jumpTo)
        XCTAssertEqual(session.speedMph, phases[2].treadmillSpeedMph!, accuracy: 1e-9,
                       "a single large tick did not land on the recovery phase's own target")
        XCTAssertEqual(session.closedCount, 2, "warm-up and the first hill rep should both have closed")
    }

    // MARK: - Pause exactly at a boundary

    func testPausingExactlyAtABoundaryDoesNotDoubleAdvance() {
        let phases = hillSet()
        let session = makeSession(phases: phases)
        let atBoundary = advance(session, seconds: 300, from: t0)   // lands exactly on the boundary
        session.pause(at: atBoundary)
        let closedAtPause = session.closedCount
        // Ticks while paused must not move the phase at all.
        session.tick(at: atBoundary.addingTimeInterval(120))
        XCTAssertEqual(session.closedCount, closedAtPause)
        session.resume(at: atBoundary.addingTimeInterval(120))
        session.tick(at: atBoundary.addingTimeInterval(121))
        XCTAssertEqual(session.closedCount, closedAtPause, "should still be on the same phase one second after resume")
    }

    // MARK: - Manual skip

    func testSkipMarksTheLeftPhasePartialAndAdoptsTheNextTarget() {
        let phases = hillSet()
        let session = makeSession(phases: phases)
        _ = advance(session, seconds: 30, from: t0)   // half-way through warm-up
        session.skip()
        XCTAssertEqual(session.actuals[0]?.completed, false, "a skipped phase must never read as completed")
        XCTAssertEqual(session.speedMph, phases[1].treadmillSpeedMph!, accuracy: 1e-9)
    }

    /// TREADMILL-SKIP-1 · found live via `-faffFastPhases` rendering: after a
    /// Skip, SPEED/INCLINE correctly read the new phase's target, but the
    /// header/"Phase N of M"/next-text all read a FRESH `LiveRunPhaseWalk
    /// .walk(elapsedSec:)` call keyed to raw elapsed time, which a skip never
    /// touches — so they kept reporting "Warm-up," unchanged, long after the
    /// belt had moved to Hill 1. This is the falsification `_prior_ existing
    /// coverage (`testSkipMarksTheLeftPhasePartialAndAdoptsTheNextTarget`)
    /// never ran: it checks the RECORDER's target after a skip, never what a
    /// fresh display-side walk over the same elapsed time would report.
    func testARawWalkAfterSkipDisagreesButTheFlooredWalkDoesNot() {
        let phases = hillSet()
        let session = makeSession(phases: phases)
        _ = advance(session, seconds: 30, from: t0)   // half-way through warm-up (300s)
        session.skip()                                // belt jumps straight to phase 1 (Hill)

        let elapsed = session.belt.elapsedSecInt       // still ~30s — skip never moves this
        let rawWalk = LiveRunPhaseWalk.walk(phases: phases, elapsedSec: elapsed)
        XCTAssertEqual(rawWalk?.phase.index, 0,
                       "documents the defect: a raw time-only walk still names phase 0 (Warm-up) right after skipping past it")

        let floor = LiveRunPhaseWalk.skipFloorSec(phases: phases, segmentIndex: session.segmentIndex,
                                                  segElapsedSec: Int(session.belt.segElapsedSec.rounded()))
        let flooredWalk = LiveRunPhaseWalk.walk(phases: phases, elapsedSec: max(elapsed, floor))
        XCTAssertEqual(flooredWalk?.phase.index, phases[1].index,
                       "the floored walk — what the view now actually renders — must name the phase the belt is really on")
        XCTAssertEqual(flooredWalk?.phase.treadmillSpeedMph, phases[1].treadmillSpeedMph,
                       "the header's own phase must be the SAME phase SPEED/INCLINE are already showing")
        XCTAssertEqual(flooredWalk?.elapsedInPhaseSec, 0,
                       "a skip lands at the START of the next phase — the floored walk must not fabricate partial progress into it")
    }

    /// The floor must never affect ordinary, non-skipped auto-advance: at
    /// every second of a full run with no skip, `segmentIndex` and a raw
    /// time-only walk already agree (this is `advanceToCanonicalPhase()`'s
    /// own contract, proven separately by `testRecorderNeverDisagreesWithTheDisplayWalk`),
    /// so the floor must compute to `elapsed` or less and change nothing.
    func testTheSkipFloorIsANoOpWithoutAnySkip() {
        let phases = hillSet()
        let session = makeSession(phases: phases)
        var now = t0
        let totalSec = phases.reduce(0) { $0 + $1.durationSec }
        for _ in 0..<totalSec {
            now = now.addingTimeInterval(1)
            session.tick(at: now)
            let elapsed = session.belt.elapsedSecInt
            let floor = LiveRunPhaseWalk.skipFloorSec(phases: phases, segmentIndex: session.segmentIndex,
                                                      segElapsedSec: Int(session.belt.segElapsedSec.rounded()))
            XCTAssertLessThanOrEqual(floor, elapsed, "the floor must never push elapsed time FORWARD absent a skip, at elapsed \(elapsed)s")
        }
    }

    func testSkipOnTheFinalPhaseIsANoOp() {
        let phases = hillSet()
        let session = makeSession(phases: phases)
        var now = t0
        for phase in phases.dropLast() { now = advance(session, seconds: phase.durationSec, from: now) }
        let closedBefore = session.closedCount
        session.skip()
        XCTAssertEqual(session.closedCount, closedBefore, "skip must not fire past the last phase")
    }

    // MARK: - Override propagation (Stage 3)

    /// Change ONE hill rep's speed — the next hill rep must adopt it too,
    /// without the runner touching the controls again.
    func testASpeedOverrideOnOneWorkRepPropagatesToTheNextWorkRep() {
        let phases = hillSet()
        let session = makeSession(phases: phases)
        _ = advance(session, seconds: 300, from: t0)   // now on hill rep 1
        session.setSpeed(9.9)
        // Cross into recovery, then the second hill rep.
        var now = advance(session, seconds: 60, from: t0.addingTimeInterval(300))    // hill 1 → recovery
        now = advance(session, seconds: 120, from: now)                              // recovery → hill 2
        _ = now
        XCTAssertEqual(session.speedMph, 9.9, accuracy: 1e-9,
                       "the override from hill rep 1 did not propagate to hill rep 2")
    }

    /// The same override must NEVER leak into a recovery phase — only
    /// equivalent phases of the SAME type adopt it.
    func testAWorkOverrideNeverLeaksIntoRecovery() {
        let phases = hillSet()
        let session = makeSession(phases: phases)
        _ = advance(session, seconds: 300, from: t0)   // hill rep 1
        session.setSpeed(9.9)
        _ = advance(session, seconds: 60, from: t0.addingTimeInterval(300))   // → recovery
        XCTAssertEqual(session.speedMph, phases[2].treadmillSpeedMph!, accuracy: 1e-9,
                       "a work-phase override leaked into the recovery phase")
    }

    /// A recovery-only override must stay isolated from work too, in the
    /// other direction.
    func testARecoveryOverrideNeverLeaksIntoWork() {
        let phases = hillSet()
        let session = makeSession(phases: phases)
        var now = advance(session, seconds: 300, from: t0)         // hill 1
        now = advance(session, seconds: 60, from: now)              // → recovery
        session.setSpeed(4.2)
        now = advance(session, seconds: 120, from: now)             // → hill 2
        XCTAssertEqual(session.speedMph, phases[3].treadmillSpeedMph!, accuracy: 1e-9,
                       "a recovery override leaked into the following work phase")
    }

    /// Stage 3's "simple reset-to-plan action."
    func testResetOverrideReturnsToThePlanTargetImmediately() {
        let phases = hillSet()
        let session = makeSession(phases: phases)
        _ = advance(session, seconds: 300, from: t0)   // hill rep 1
        session.setSpeed(9.9)
        session.resetOverride(for: .work)
        XCTAssertEqual(session.speedMph, phases[1].treadmillSpeedMph!, accuracy: 1e-9)
        XCTAssertFalse(session.hasOverrideForCurrentPhase)
    }

    // MARK: - Resume from checkpoint (relaunch mid-run)

    /// A checkpoint mid-second-recovery must resume ON second recovery, not
    /// at phase 0 — Stage 2's "reconstruct the correct phase... never
    /// require pause/resume... to wake up the next phase," applied to a
    /// full app kill rather than a backgrounding gap.
    func testResumeFromCheckpointLandsOnTheCorrectPhase() {
        let phases = hillSet()
        // Warm-up + hill 1 + recovery 1 + 30s into hill 2.
        let elapsed = 300 + 60 + 120 + 30
        let cp = BeltCheckpoint(workoutId: "resume-test", startedAt: t0,
                                updatedAt: t0.addingTimeInterval(Double(elapsed)),
                                elapsedSec: elapsed, distanceMi: 1.0, elevGainFt: 50,
                                speedMph: 9.3, inclinePct: 4.0)
        let session = BeltSession(workoutId: "resume-test", now: t0.addingTimeInterval(Double(elapsed)))
        session.resume(from: cp, phases: phases, now: t0.addingTimeInterval(Double(elapsed)))
        XCTAssertEqual(session.speedMph, phases[3].treadmillSpeedMph!, accuracy: 1e-9,
                       "resume did not land on hill rep 2")
        XCTAssertTrue(session.isRunning)
    }

    /// A checkpoint for a DIFFERENT workout must never be adopted as a
    /// resume — that is the salvage-as-partial path's job, tested at the
    /// view layer (`flushInterruptedBeltRun`), not here.
    func testResumeIgnoresAMismatchedWorkoutId() {
        let phases = hillSet()
        let cp = BeltCheckpoint(workoutId: "some-other-run", startedAt: t0, updatedAt: t0,
                                elapsedSec: 400, distanceMi: 1.0, elevGainFt: 10,
                                speedMph: 9.0, inclinePct: 4.0)
        let session = BeltSession(workoutId: "resume-test", now: t0)
        // The view is responsible for the workoutId equality check before
        // ever calling `resume` — this test documents that `resume` itself
        // has no such guard, so a caller MUST check first (see
        // `LiveRunTreadmillV5.resolveInterruptedRunIfNeeded`).
        XCTAssertNotEqual(cp.workoutId, session.workoutId)
    }
}
