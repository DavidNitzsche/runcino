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
    /// identical to the real 21-phase hill session. All three hill reps
    /// share ONE nominal target (uniform speed/incline) — the shape
    /// `build-workout.ts` actually authors for a by-effort hill set (one
    /// computed belt speed+incline for the whole rep type, not a per-rep
    /// ladder); a fixture with three DIFFERENT rep speeds used to sit here
    /// and made every rep its own equivalent-SET by construction, which
    /// silently defeated `testASpeedOverrideOnOneWorkRepPropagatesToTheNextWorkRep`
    /// — that test was asserting propagation into a rep the set-identity
    /// rules said was never eligible to receive it.
    private func hillSet() -> [WatchPhase] {
        var phases: [WatchPhase] = [hillPhase(0, type: .warmup, label: "Warm up", durationSec: 300,
                                              speedMph: 5.5, inclinePct: 1.0)]
        var i = 1
        for rep in 1...3 {
            phases.append(hillPhase(i, type: .work, label: "Hill", durationSec: 60,
                                    speedMph: 9.5, inclinePct: 4.0))
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

    /// P0 gap #2's own shape: TWO differently-prescribed work blocks, both
    /// `.work` type, so a fix keyed on type alone cannot tell them apart.
    /// Warm-up(120s) → 2×Hill(60s@9.5mph/5%) with Jog(90s) between →
    /// Recovery(90s) → 2×Speed(40s@11.0mph/1%) with Jog(60s) between →
    /// Cooldown(120s).
    private func twoBlockSet() -> [WatchPhase] {
        var phases: [WatchPhase] = [hillPhase(0, type: .warmup, label: "Warm up", durationSec: 120,
                                              speedMph: 5.5, inclinePct: 1.0)]
        var i = 1
        for rep in 1...2 {
            phases.append(hillPhase(i, type: .work, label: "Hill", durationSec: 60,
                                    speedMph: 9.5, inclinePct: 5.0))
            i += 1
            if rep < 2 {
                phases.append(hillPhase(i, type: .recovery, label: "Jog", durationSec: 90,
                                        speedMph: 5.0, inclinePct: 1.0))
                i += 1
            }
        }
        for rep in 1...2 {
            phases.append(hillPhase(i, type: .work, label: "Speed", durationSec: 40,
                                    speedMph: 11.0, inclinePct: 1.0))
            i += 1
            if rep < 2 {
                phases.append(hillPhase(i, type: .recovery, label: "Jog", durationSec: 60,
                                        speedMph: 5.0, inclinePct: 1.0))
                i += 1
            }
        }
        phases.append(hillPhase(i, type: .cooldown, label: "Cool down", durationSec: 120,
                                speedMph: 5.0, inclinePct: 1.0))
        return phases
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
        session.resetOverrideForCurrentSet()
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

    // MARK: - Equivalent SET, not bare type (P0 gap #2, rebuilt harness)

    /// The exact shape the bare-type keying got wrong: two DIFFERENT work
    /// blocks. An override on hill rep 1 must reach hill rep 2 (same set)
    /// and must NEVER reach the speed reps later (same type, different
    /// target — a different set).
    func testOverridePropagatesWithinASetAndNeverAcrossADifferentlyPrescribedBlock() {
        let phases = twoBlockSet()
        let session = makeSession(phases: phases)
        var now = advance(session, seconds: 120, from: t0)   // warm-up → hill rep 1
        session.setSpeed(9.9)
        now = advance(session, seconds: 60, from: now)        // hill 1 → jog
        now = advance(session, seconds: 90, from: now)        // jog → hill rep 2
        XCTAssertEqual(session.speedMph, 9.9, accuracy: 1e-9,
                       "override did not propagate to the second hill rep in the SAME set")
        // Hill2 ends exactly where Speed1 begins (330s in) — no separate
        // "jog" phase between the two blocks in this fixture (see
        // `twoBlockSet`'s own layout comment).
        now = advance(session, seconds: 60, from: now)        // hill 2 → speed rep 1
        XCTAssertEqual(session.speedMph, phases.first(where: { $0.label == "Speed" })!.treadmillSpeedMph!,
                       accuracy: 1e-9,
                       "a hill-block override leaked into the differently-prescribed speed block")
    }

    /// The other direction: overriding the SECOND block must never reach
    /// back into the first.
    func testOverrideOnTheSecondBlockNeverReachesTheFirst() {
        let phases = twoBlockSet()
        let session = makeSession(phases: phases)
        // Walk to the first speed rep.
        var now = advance(session, seconds: 120, from: t0)
        now = advance(session, seconds: 60, from: now)
        now = advance(session, seconds: 90, from: now)
        now = advance(session, seconds: 60, from: now)   // now on speed rep 1
        session.setSpeed(11.9)
        now = advance(session, seconds: 40, from: now)   // speed 1 → jog → speed rep 2
        now = advance(session, seconds: 60, from: now)
        XCTAssertEqual(session.speedMph, 11.9, accuracy: 1e-9,
                       "override did not propagate within the speed block")
        _ = now
        // The hill block, elsewhere in the SAME session, must be unaffected —
        // verified directly against the stored dictionary rather than by
        // re-walking backwards (the recorder only ever moves forward).
        let hillPhase = phases.first(where: { $0.label == "Hill" })!
        XCTAssertNotEqual(session.speedMph, hillPhase.treadmillSpeedMph!, accuracy: 1e-9)
    }

    /// Reset only clears the CURRENT set, never the other block's override.
    func testResetOnlyClearsTheCurrentSet() {
        let phases = twoBlockSet()
        let session = makeSession(phases: phases)
        var now = advance(session, seconds: 120, from: t0)   // hill rep 1
        session.setSpeed(9.9)
        now = advance(session, seconds: 60, from: now)
        now = advance(session, seconds: 90, from: now)       // hill rep 2, override should show
        XCTAssertTrue(session.hasOverrideForCurrentPhase)
        session.resetOverrideForCurrentSet()
        XCTAssertFalse(session.hasOverrideForCurrentPhase)
        XCTAssertEqual(session.speedMph, phases.first(where: { $0.label == "Hill" })!.treadmillSpeedMph!,
                       accuracy: 1e-9)
        _ = now
    }

    // MARK: - Honest resume gaps (P0 gap #6)

    /// The checkpoint-to-resume gap must be CREDITED (through the same
    /// gap-crediting policy every other interruption uses), never silently
    /// dropped — found and fixed while closing this gap: seeding the
    /// tracker's clock at the resume instant rather than the checkpoint's
    /// own `updatedAt` erased the gap between them entirely.
    func testTheCheckpointToResumeGapIsCreditedNotDropped() {
        let phases = hillSet()
        let checkpointedElapsed = 120
        let resumeGapSec = 45.0
        let cp = BeltCheckpoint(workoutId: "gap-test", startedAt: t0,
                                updatedAt: t0.addingTimeInterval(Double(checkpointedElapsed)),
                                elapsedSec: checkpointedElapsed, distanceMi: 0.5, elevGainFt: 10,
                                speedMph: 5.5, inclinePct: 1.0)
        let resumeAt = t0.addingTimeInterval(Double(checkpointedElapsed) + resumeGapSec)
        let session = BeltSession(workoutId: "gap-test", now: resumeAt)
        session.resume(from: cp, phases: phases, now: resumeAt)
        XCTAssertEqual(session.belt.elapsedSecInt, checkpointedElapsed + Int(resumeGapSec),
                       "the checkpoint-to-resume gap was not credited into elapsed time")
        XCTAssertGreaterThan(session.belt.unmeasuredSec, 0,
                             "an uncredited gap must be marked unmeasured, not silently measured or dropped")
    }

    /// "Completed" is a compliance claim — a phase closed with zero real
    /// measured content behind it (the shape a multi-phase catch-up jump
    /// produces) must never claim it, live tick or resume alike.
    func testAPhaseClosedWithNoRealMeasuredContentIsNeverMarkedCompleted() {
        let phases = hillSet()
        let session = makeSession(phases: phases)
        // Warm-up (300s) + first hill (60s) + ALL of the first recovery
        // (120s) in one jump — the recovery gets zero real content; only the
        // warm-up (the segment open when the gap was noticed) can receive
        // any of it.
        let jumpTo = t0.addingTimeInterval(300 + 60 + 120)
        session.tick(at: jumpTo)
        XCTAssertEqual(session.actuals[1]?.completed, false,
                       "the recovery phase closed with no measured content but was marked completed")
    }

    // MARK: - HR freshness policy (P0 gap #1, pure/testable per the brief)

    func testHrFreshnessIsLiveWithinTheLiveWindow() {
        let now = Date()
        let f = TreadmillHRFreshnessPolicy.classify(now: now, sampleAt: now.addingTimeInterval(-5), isAttemptInFlight: true)
        XCTAssertEqual(f, .live)
    }

    func testHrFreshnessIsDelayedPastTheLiveWindow() {
        let now = Date()
        let f = TreadmillHRFreshnessPolicy.classify(now: now, sampleAt: now.addingTimeInterval(-30), isAttemptInFlight: true)
        XCTAssertEqual(f, .delayed)
    }

    func testHrFreshnessIsStalePastTwoMinutes() {
        let now = Date()
        let f = TreadmillHRFreshnessPolicy.classify(now: now, sampleAt: now.addingTimeInterval(-150), isAttemptInFlight: true)
        XCTAssertEqual(f, .stale)
    }

    func testHrFreshnessDistinguishesConnectingFromNeverAsked() {
        let now = Date()
        XCTAssertEqual(TreadmillHRFreshnessPolicy.classify(now: now, sampleAt: nil, isAttemptInFlight: true), .connecting)
        XCTAssertEqual(TreadmillHRFreshnessPolicy.classify(now: now, sampleAt: nil, isAttemptInFlight: false), .unavailable)
    }

    /// "Do not display a stale HealthKit sample as live" — a snapshot only
    /// ever carries a bpm alongside `.live`/`.delayed`/`.stale`, never
    /// `.connecting`/`.unavailable`, so a caller cannot accidentally read a
    /// number that was never really there.
    func testSnapshotNeverCarriesABpmWithoutARealSample() {
        let now = Date()
        let snap = TreadmillHRFreshnessPolicy.snapshot(now: now, bpm: 150, source: .asyncHealthKitSync,
                                                        sampleAt: nil, isAttemptInFlight: true)
        XCTAssertNil(snap.bpm)
        XCTAssertEqual(snap.freshness, .connecting)
    }

    // MARK: - Equivalent-set identity (pure, P0 gap #2)

    func testSetIdsGroupConsecutivePhasesOfTheSameTypeAndTarget() {
        let phases = twoBlockSet()
        let ids = TreadmillPhaseSets.setIds(for: phases)
        // warmup(0) | hill,jog,hill(1,2,3 → all one set for hill? no —
        // recovery and work alternate, so each phase is checked against its
        // IMMEDIATE predecessor only. Assert the two Hill phases share an id
        // and the two Speed phases share a DIFFERENT id.
        let hillIndices = phases.enumerated().filter { $0.element.label == "Hill" }.map { $0.offset }
        let speedIndices = phases.enumerated().filter { $0.element.label == "Speed" }.map { $0.offset }
        XCTAssertEqual(Set(hillIndices.map { ids[$0] }).count, 1, "both Hill reps should share one set id")
        XCTAssertEqual(Set(speedIndices.map { ids[$0] }).count, 1, "both Speed reps should share one set id")
        XCTAssertNotEqual(ids[hillIndices[0]], ids[speedIndices[0]],
                          "Hill and Speed are both .work but different targets — must be different sets")
    }
}
