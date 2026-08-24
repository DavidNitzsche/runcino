//
//  _HostileInputTests.swift
//  FaffWatch Watch AppTests
//
//  ROBUSTNESS / HOSTILE-INPUT suite for WorkoutEngine.
//
//  WorkoutEngineTests.swift feeds the engine the run a fixture would have:
//  pace lands exactly on target, distance advances forever, HR never drops,
//  every phase has a sane duration. This file feeds it the run a WRIST has —
//  GPS that jitters across the band edge, GPS that dies mid-rep, a band that
//  stops reading, a belt that never moves, a teleport, a five-hour ultra, a
//  zero-phase payload, a kilometre runner.
//
//  Anything marked `// BUG:` is a real product defect found by these inputs.
//  Per the brief the defect is NOT fixed here — it is documented, wrapped in
//  `withKnownIssue` so the suite stays green, and reported. When someone
//  fixes the engine the `withKnownIssue` will start failing ("known issue
//  was not recorded"), which is exactly the signal wanted.
//
//  Every test is fully synchronous on the main actor. That is deliberate:
//  `WorkoutTracker.start()` spins a simulator mock Task that overwrites
//  paceSPerMi / heartRate / distanceMi once per second, and it can only run
//  at an await point. No awaits ⇒ the injected `setFixture` values are the
//  only sensor readings the engine ever sees.
//

import Testing
import Foundation
@testable import FaffWatch_Watch_App

@MainActor
@Suite(.serialized)
struct HostileInputTests {

    // MARK: - Simulated-clock helper (same contract as WorkoutEngineTests)

    /// Roll `phaseStart` backward by `seconds` and run one tick. Cumulative
    /// within a phase; `advance()` re-anchors `phaseStart` on every boundary.
    private func simulate(_ engine: WorkoutEngine, seconds: Int) {
        engine.phaseStart = engine.phaseStart.addingTimeInterval(-Double(seconds))
        engine.tick()
    }

    // MARK: - Fixtures

    /// warmup 600s → work 420s (target 391 ± 10) → cooldown 600s. All TIME.
    private func timeWorkout(units: String? = nil) -> WatchWorkout {
        let phases = [
            WatchPhase(index: 0, type: .warmup, label: "Warmup", durationSec: 600,
                       targetPaceSPerMi: nil, tolerancePaceSPerMi: nil, haptic: .start),
            WatchPhase(index: 1, type: .work, label: "Interval 1/1", durationSec: 420,
                       targetPaceSPerMi: 391, tolerancePaceSPerMi: 10, haptic: .transitionWork),
            WatchPhase(index: 2, type: .cooldown, label: "Cooldown", durationSec: 600,
                       targetPaceSPerMi: nil, tolerancePaceSPerMi: nil, haptic: .transitionCooldown),
        ]
        return WatchWorkout(workoutId: "hostile-time", name: "T", summary: "t",
                            totalEstimatedMinutes: 27, phases: phases,
                            completionEndpoint: "/x", expiresAt: "2099-01-01T00:00:00Z",
                            unitsDistance: units)
    }

    /// 1 mi warmup → 1 mi work → 1 mi cooldown, all DISTANCE reps.
    private func distanceWorkout() -> WatchWorkout {
        let phases = [
            WatchPhase(index: 0, type: .warmup, label: "Warmup", durationSec: 600,
                       targetPaceSPerMi: nil, tolerancePaceSPerMi: nil, haptic: .start,
                       repUnit: .distance, distanceMi: 1.0),
            WatchPhase(index: 1, type: .work, label: "Rep 1/1", durationSec: 420,
                       targetPaceSPerMi: 391, tolerancePaceSPerMi: 10, haptic: .transitionWork,
                       repUnit: .distance, distanceMi: 1.0),
            WatchPhase(index: 2, type: .cooldown, label: "Cooldown", durationSec: 600,
                       targetPaceSPerMi: nil, tolerancePaceSPerMi: nil, haptic: .transitionCooldown,
                       repUnit: .distance, distanceMi: 1.0),
        ]
        return WatchWorkout(workoutId: "hostile-dist", name: "D", summary: "d",
                            totalEstimatedMinutes: 27, phases: phases,
                            completionEndpoint: "/x", expiresAt: "2099-01-01T00:00:00Z")
    }

    /// The open-ended "just run" shape: ONE work phase, no target, 24h ceiling.
    /// `isEasyBandSingleWork` is true for it, so mile splits are allowed.
    private func justRun(units: String? = nil) -> WatchWorkout {
        let phase = WatchPhase(index: 0, type: .work, label: "Just run",
                               durationSec: 24 * 60 * 60,
                               targetPaceSPerMi: nil, tolerancePaceSPerMi: nil, haptic: .start)
        return WatchWorkout(workoutId: "just-run-hostile", name: "Just run", summary: "u",
                            totalEstimatedMinutes: 30, phases: [phase],
                            completionEndpoint: "/x", expiresAt: "2099-01-01T00:00:00Z",
                            unitsDistance: units)
    }

    /// Single-phase DISTANCE run with a workout-level distance — the shape
    /// that drives the almost-done board.
    private func singlePhaseDistanceRun(totalMi: Double, units: String?) -> WatchWorkout {
        let phase = WatchPhase(index: 0, type: .work, label: "Long run",
                               durationSec: 3600, targetPaceSPerMi: nil,
                               tolerancePaceSPerMi: nil, haptic: .start,
                               repUnit: .distance, distanceMi: totalMi)
        return WatchWorkout(workoutId: "hostile-single", name: "L", summary: "l",
                            totalEstimatedMinutes: 60, phases: [phase],
                            completionEndpoint: "/x", expiresAt: "2099-01-01T00:00:00Z",
                            distanceMi: totalMi, unitsDistance: units)
    }

    private func newRig(_ w: WatchWorkout) -> (WorkoutEngine, WorkoutTracker) {
        let tracker = WorkoutTracker()
        let engine = WorkoutEngine(workout: w)
        engine.tracker = tracker
        return (engine, tracker)
    }

    /// Fresh-transition probe: nil the cue, tick, report what (if anything)
    /// the engine put back. `flash()`'s auto-clear is an async Task that
    /// cannot run inside a synchronous test, so anything non-nil here fired
    /// on THIS tick.
    private func tickCapturingCue(_ engine: WorkoutEngine, seconds: Int) -> WorkoutEngine.TransitionCue? {
        engine.transition = nil
        simulate(engine, seconds: seconds)
        return engine.transition
    }

    private func countZoneTransitions(_ zones: [PaceZone]) -> Int {
        guard zones.count > 1 else { return 0 }
        var n = 0
        for i in 1..<zones.count where zones[i] != zones[i - 1] { n += 1 }
        return n
    }

    // ════════════════════════════════════════════════════════════════
    // MARK: - 1 · GPS PACE NOISE
    // ════════════════════════════════════════════════════════════════

    /// The engine consumes `tracker.paceSPerMi`, which HealthKit-fed runs
    /// already EWMA-smooth (0.7/0.3) inside WorkoutTracker.apply — so raw
    /// ±40 s/mi alternating noise arrives here attenuated to a few s/mi of
    /// ripple. What smoothing CANNOT fix is the band edge: a runner whose
    /// (already smoothed) pace sits a couple of seconds either side of the
    /// tolerance edge crosses it over and over, and `paceZone` is assigned
    /// straight off the instantaneous comparison with NO hysteresis and NO
    /// dwell time. Target 391 ± 10 ⇒ the edge is 401. A pace wandering
    /// 399 ↔ 404 is one runner holding one effort; the grade underneath it
    /// is a strobe.
    @Test func paceZoneFlickersAtTheBandEdgeWithNoHysteresis() {
        let (engine, tracker) = newRig(timeWorkout())
        engine.start()
        engine.endCurrentPhase()                       // into the work rep
        #expect(engine.currentPhase?.type == .work)

        // 240 s of a pace hovering either side of the 401 s/mi band edge,
        // each side held for 3 s — a slow wander, not tick-to-tick hash.
        var zones: [PaceZone] = []
        var mi = 0.0
        for i in 0..<240 {
            // +8 in / +18 out. Was 399/404, which straddled the RAW edge by
            // three — exactly the hysteresis margin, so the fix absorbs it
            // entirely and the zone never leaves .onTarget. That is the right
            // outcome for a runner that close to target, but it stops the test
            // exercising a boundary. Widened so the input genuinely crosses.
            let pace = ((i / 3) % 2 == 0) ? 399 : 409
            mi += 1.0 / Double(pace)
            tracker.setFixture(pace: pace, hr: 152, cadence: 178, distanceMi: mi)
            simulate(engine, seconds: 1)
            zones.append(engine.paceZone)
        }

        // Sanity: the input really did straddle the edge.
        #expect(zones.contains(.onTarget))
        #expect(zones.contains(.drifting))

        let flips = countZoneTransitions(zones)
        // WAS 79 FLIPS IN 240 SECONDS. `paceZone` was recomputed from the
        // instantaneous sample every tick with no hysteresis and no minimum
        // dwell, so a steady effort sitting on the tolerance edge repainted
        // the one graded colour on the face dozens of times in four minutes —
        // WatchRouterV5.grade() maps .onTarget to .inBand and everything else
        // to .outOfBand, so it was a literal green/amber strobe on the wrist.
        //
        // FIXED 2026-08-24: leaving a zone now costs three more seconds a mile
        // than entering it, which is under the accuracy of a GPS pace, so
        // nothing legible changes except the flicker.
        #expect(flips <= 12, "paceZone changed \(flips) times in 240 s")
        engine.reset()
    }

    /// The brief's literal sequence — 350 → 430 → 360 → 420 against a
    /// 391 ± 10 target. Every one of those is >15 s/mi off, so all four land
    /// in `.offTarget` and the ZONE is perfectly stable. Worth locking: the
    /// flicker above is an edge phenomenon, not a "loud noise" phenomenon,
    /// and a future smoothing fix must not accidentally start grading gross
    /// swings as on-target.
    @Test func grossPaceJitterStaysPinnedOffTargetWithoutFlicker() {
        let (engine, tracker) = newRig(timeWorkout())
        engine.start()
        engine.endCurrentPhase()

        let jitter = [350, 430, 360, 420]
        var zones: [PaceZone] = []
        var deltas: [Int] = []
        var mi = 0.0
        for i in 0..<200 {
            let pace = jitter[i % jitter.count]
            mi += 1.0 / Double(pace)
            tracker.setFixture(pace: pace, hr: 168, cadence: 182, distanceMi: mi)
            simulate(engine, seconds: 1)
            zones.append(engine.paceZone)
            deltas.append(engine.paceDeltaSPerMi)
        }

        #expect(countZoneTransitions(zones) == 0)
        #expect(zones.allSatisfy { $0 == .offTarget })
        // The signed delta is a faithful, unsmoothed passthrough of the
        // sample. Documented, not flagged: the tracker smooths upstream and
        // WatchRouterV5 only reads the delta's SIGN (ease off / quicken).
        #expect(deltas.contains(-41))
        #expect(deltas.contains(39))
        engine.reset()
    }

    /// Noise must never produce a nonsense delta: the published value is
    /// always exactly `sample - target`, never NaN-adjacent, never absurd.
    @Test func paceDeltaAlwaysEqualsSampleMinusTarget() {
        let (engine, tracker) = newRig(timeWorkout())
        engine.start()
        engine.endCurrentPhase()
        for pace in [151, 2399, 392, 400, 1200] {
            tracker.setFixture(pace: pace, hr: 150, cadence: 178, distanceMi: 0.4)
            simulate(engine, seconds: 1)
            #expect(engine.paceDeltaSPerMi == pace - 391)
        }
        engine.reset()
    }

    // ════════════════════════════════════════════════════════════════
    // MARK: - 2 · GPS LOSS
    // ════════════════════════════════════════════════════════════════

    /// GPS drops at 0.5 mi into a 1.0 mi rep. Distance freezes; pace reads 0.
    ///
    /// The rep used to be STRANDED FOREVER: `noDistanceSource` only fired when
    /// the phase had banked less than 0.05 mi, which catches a source that was
    /// dead from the phase's first second and not one that dies part-way. The
    /// runner was stuck on that rep for the rest of the session and had to
    /// hand-skip every remaining phase.
    @Test func gpsLossHalfwayThroughADistanceRepFallsBackToTime() {
        let (engine, tracker) = newRig(distanceWorkout())
        engine.start()

        // Half the rep banked, honestly.
        tracker.setFixture(pace: 480, hr: 148, cadence: 172, distanceMi: 0.5)
        simulate(engine, seconds: 240)
        #expect(engine.currentIndex == 0)
        #expect(engine.phaseCoveredMi == 0.5)

        // GPS dies. Distance frozen at 0.5, pace reads 0. Two more hours.
        tracker.setFixture(pace: 0, hr: 148, cadence: 172, distanceMi: 0.5)
        for _ in 0..<720 { simulate(engine, seconds: 10) }

        // Nothing here may be nonsense even while stranded.
        #expect(engine.phaseRemainingMi ?? 0 >= 0)
        #expect(engine.phaseProgress >= 0 && engine.phaseProgress <= 1)
        #expect(engine.phaseProgress.isFinite)
        #expect(engine.totalElapsedSec >= 0)

        // FIXED 2026-08-24. The rep falls back to its own TIME estimate once
        // the source is seen to have stopped, so the session keeps moving.
        // The phase does not end the instant the source dies — the runner
        // still owes the rep its duration — it ends at the same 1.5x estimate
        // a never-started source has always used.
        #expect(engine.currentIndex > 0, "the rep must not strand the session")
        #expect(engine.phaseElapsedSec >= 0)

        engine.reset()
    }

    /// The case P2-56 DOES cover: no distance from the phase's first second
    /// (HealthKit denied / session never started). Falls back to time at
    /// 1.5 × the phase's duration estimate and flags the tracker.
    @Test func gpsDeadFromTheStartFallsBackToTimeAndFlagsTheSource() {
        let (engine, tracker) = newRig(distanceWorkout())
        engine.start()
        tracker.setFixture(pace: 0, hr: 150, cadence: 0, distanceMi: 0)

        // Warmup estimate is 600 s ⇒ fallback at 900 s. Not before.
        for _ in 0..<89 { simulate(engine, seconds: 10) }   // 890 s
        #expect(engine.currentIndex == 0, "the phase still owes its time estimate")
        // The FLAG lands earlier than the phase change now, and deliberately.
        // A rolling distance-progress watch marks the source dead after six
        // minutes of a running, unpaused session covering under a hundredth of
        // a mile — independent of which phase is in flight or how long it was
        // meant to be. That flag is what `isTreadmill` reads to stop grading
        // pace and drop the outdoor-only rows, so waiting fifteen minutes to
        // set it meant a belt run drew the outdoor face throughout, and an
        // open-ended just-run (24h ceiling) would have waited thirty-six hours.
        //
        // Detecting the source is separate from ending the phase: the phase
        // below still runs to its 1.5x time estimate.
        #expect(tracker.distanceSourceUnavailable == true,
                "six minutes of no progress is a dead source")

        simulate(engine, seconds: 20)                        // 910 s
        #expect(engine.currentIndex == 1, "time fallback should have advanced the phase")
        #expect(tracker.distanceSourceUnavailable == true)
        engine.reset()
    }

    /// Pace 0 is "no reading", not "infinitely slow". It must not reach the
    /// drift evaluator, must not fire a heads-up cue, and must not move the
    /// published delta off whatever was last genuinely measured.
    @Test func zeroPaceNeverGradesAndNeverCuesOnGarbage() {
        let (engine, tracker) = newRig(timeWorkout())
        engine.start()
        engine.endCurrentPhase()

        tracker.setFixture(pace: 402, hr: 160, cadence: 180, distanceMi: 0.2)
        simulate(engine, seconds: 5)
        let lastGraded = engine.paceDeltaSPerMi
        #expect(lastGraded == 11)

        tracker.setFixture(pace: 0, hr: 160, cadence: 180, distanceMi: 0.2)
        for _ in 0..<120 {
            let cue = tickCapturingCue(engine, seconds: 1)
            if case .headsUp = cue { Issue.record("drift cue fired on a pace of 0") }
        }
        // Held, not recomputed from 0 (which would read as −391 s/mi, i.e.
        // "you are six and a half minutes per mile too fast"). The face is
        // protected downstream too: WatchRouterV5.grade() returns .untrusted
        // when `tracker.paceSPerMi == 0`, so the stale zone is never drawn.
        #expect(engine.paceDeltaSPerMi == lastGraded)
        #expect(engine.paceDeltaSPerMi > -300)
        engine.reset()
    }

    /// A TIME phase is immune to GPS loss — it must still end on schedule.
    @Test func timePhaseStillAdvancesWithNoDistanceSourceAtAll() {
        let (engine, tracker) = newRig(timeWorkout())
        engine.start()
        tracker.setFixture(pace: 0, hr: 0, cadence: 0, distanceMi: 0)
        simulate(engine, seconds: 601)
        #expect(engine.currentIndex == 1)
        #expect(engine.phaseRemainingSec >= 0)
        engine.reset()
    }

    // ════════════════════════════════════════════════════════════════
    // MARK: - 3 · HEART-RATE DROPOUT
    // ════════════════════════════════════════════════════════════════

    /// A band that reads 150, drops to 0 for five minutes, then comes back.
    /// The zeroes must be excluded from the phase average entirely — an
    /// average dragged toward 0 by a dead sensor is worse than no average.
    @Test func hrDropoutIsExcludedFromThePhaseAverage() throws {
        let (engine, tracker) = newRig(timeWorkout())
        engine.start()

        tracker.setFixture(pace: 500, hr: 150, cadence: 170, distanceMi: 0.05)
        for _ in 0..<60 { simulate(engine, seconds: 1) }
        tracker.setFixture(pace: 500, hr: 0, cadence: 170, distanceMi: 0.6)
        for _ in 0..<300 { simulate(engine, seconds: 1) }
        tracker.setFixture(pace: 500, hr: 150, cadence: 170, distanceMi: 0.7)
        for _ in 0..<60 { simulate(engine, seconds: 1) }

        engine.abandon()
        let c = try #require(engine.completion)
        let warm = try #require(c.phases.first)
        #expect(warm.avgHr == 150, "zeroed samples must not dilute the average")
        #expect(warm.maxHr == 150)
        #expect((warm.avgHr ?? 0) > 0)
        engine.reset()
    }

    /// A dead band must not read as "under the ceiling" in a way that
    /// silently clears a real alert, and must never read as over it.
    @Test func hrDropoutNeverTriggersOrCorruptsTheCeilingAlert() {
        let w = WatchWorkout(workoutId: "hostile-ceiling", name: "E", summary: "e",
                             totalEstimatedMinutes: 40,
                             phases: [WatchPhase(index: 0, type: .work, label: "Easy",
                                                 durationSec: 2400, targetPaceSPerMi: nil,
                                                 tolerancePaceSPerMi: nil, haptic: .start)],
                             completionEndpoint: "/x", expiresAt: "2099-01-01T00:00:00Z",
                             hrCeilingBpm: 150)
        let (engine, tracker) = newRig(w)
        engine.start()

        tracker.setFixture(pace: 520, hr: 162, cadence: 168, distanceMi: 0.1)
        simulate(engine, seconds: 10)
        #expect(engine.hrOverCeiling == true)

        tracker.setFixture(pace: 520, hr: 0, cadence: 168, distanceMi: 0.2)
        for _ in 0..<60 { simulate(engine, seconds: 1) }
        #expect(engine.hrOverCeiling == false, "a dead band is not a cool runner, but it is not over the ceiling either")

        tracker.setFixture(pace: 520, hr: 171, cadence: 168, distanceMi: 0.3)
        simulate(engine, seconds: 1)
        #expect(engine.hrOverCeiling == true)
        engine.reset()
    }

    /// A run where HR never lands at all: nil, not zero, on the wire.
    @Test func totalHrAbsenceProducesNilRatherThanZero() throws {
        let (engine, tracker) = newRig(timeWorkout())
        engine.start()
        tracker.setFixture(pace: 500, hr: 0, cadence: 0, distanceMi: 0.5)
        for _ in 0..<120 { simulate(engine, seconds: 1) }
        engine.abandon()
        let c = try #require(engine.completion)
        #expect(c.phases.first?.avgHr == nil)
        #expect(c.phases.first?.maxHr == nil)
        #expect(c.maxHr == nil)
        engine.reset()
    }

    // ════════════════════════════════════════════════════════════════
    // MARK: - 4 · TREADMILL
    // ════════════════════════════════════════════════════════════════

    /// Forty minutes on a belt: time advances, distance never does. The run
    /// records fine — but nothing ever tells the app it is on a belt.
    @Test func fortyMinuteTreadmillRunIsNeverDetectedAsHavingNoDistance() {
        let (engine, tracker) = newRig(justRun())
        engine.start()
        tracker.setFixture(pace: 0, hr: 154, cadence: 176, distanceMi: 0)

        for _ in 0..<480 { simulate(engine, seconds: 5) }   // 2400 s
        #expect(engine.totalElapsedSec == 2400)
        #expect(engine.state == .running)
        #expect(engine.phaseCoveredMi == 0)

        // BUG: `markDistanceSourceUnavailable()` has exactly two callers —
        // the runner manually choosing "Drop GPS", and the engine's
        // noDistanceSource fallback, which requires
        // `phaseElapsedSec >= 1.5 × max(durationSec, 60)`. A TIME phase
        // always ends at 1.0 × its duration, and an open-ended just-run
        // carries a 24 h ceiling (fallback at 36 h), so the fallback is
        // unreachable for every non-distance session. Real-world
        // consequence: an indoor run is never recognised as one.
        // WatchRouterV5's `isTreadmill` reads this exact flag to stop
        // grading pace and to drop the outdoor-only rows, so the belt run
        // keeps drawing the outdoor face for its whole duration.
        // FIXED: a rolling distance-progress watch flags a dead source on its own schedule.
        #expect(tracker.distanceSourceUnavailable == true,
                "40 minutes with zero distance is a belt, and nothing said so")
        engine.reset()
    }

    /// The counterpart the fallback MUST NOT fire on: a recovery the runner
    /// deliberately extended. Two "+30 sec" presses hold a 120 s recovery to
    /// 180 s = exactly 1.5 × the duration, and a runner standing at a
    /// fountain covers nothing. Flagging that would turn an outdoor run into
    /// a treadmill run permanently (the flag is sticky for the whole run).
    @Test func extendedRecoveryIsNotMistakenForALostDistanceSource() {
        let phases = [
            WatchPhase(index: 0, type: .work, label: "Rep 1", durationSec: 180,
                       targetPaceSPerMi: 391, tolerancePaceSPerMi: 10, haptic: .transitionWork),
            WatchPhase(index: 1, type: .recovery, label: "Recovery", durationSec: 120,
                       targetPaceSPerMi: nil, tolerancePaceSPerMi: nil, haptic: .transitionRecovery),
            WatchPhase(index: 2, type: .work, label: "Rep 2", durationSec: 180,
                       targetPaceSPerMi: 391, tolerancePaceSPerMi: 10, haptic: .transitionWork),
        ]
        let w = WatchWorkout(workoutId: "hostile-recov", name: "R", summary: "r",
                             totalEstimatedMinutes: 8, phases: phases,
                             completionEndpoint: "/x", expiresAt: "2099-01-01T00:00:00Z")
        let (engine, tracker) = newRig(w)
        engine.start()

        tracker.setFixture(pace: 391, hr: 170, cadence: 184, distanceMi: 0.46)
        simulate(engine, seconds: 181)
        #expect(engine.currentPhase?.type == .recovery)

        // Standing still at a fountain, twice extended.
        engine.recordRecoveryExtension(addedSec: 30)
        engine.recordRecoveryExtension(addedSec: 30)
        #expect(engine.phaseRemainingSec == 180)

        for _ in 0..<179 { simulate(engine, seconds: 1) }   // 179 s, distance frozen
        #expect(tracker.distanceSourceUnavailable == false,
                "an extended recovery is not a lost distance source")
        #expect(engine.currentIndex == 1)

        simulate(engine, seconds: 2)                        // 181 s > 120 + 60
        #expect(engine.currentIndex == 2, "the EXTENDED clock is what ends the recovery")
        #expect(tracker.distanceSourceUnavailable == false)
        engine.reset()
    }

    /// A belt run still has to bank an honest clock and an honest (nil)
    /// distance on the wire — never a zero posing as a measurement.
    @Test func treadmillCompletionCarriesTimeButNoFabricatedDistance() throws {
        let (engine, tracker) = newRig(justRun())
        engine.start()
        tracker.setFixture(pace: 0, hr: 150, cadence: 174, distanceMi: 0)
        for _ in 0..<360 { simulate(engine, seconds: 5) }   // 30 min
        engine.abandon()
        let c = try #require(engine.completion)
        #expect(c.totalDurationSec == 1800)
        #expect(c.totalDistanceMi == nil, "0.00 mi must be absent, not a measured zero")
        #expect(c.phases.first?.actualPaceSPerMi == nil)
        #expect(c.status == "completed", "an open-ended session the runner ends is not abandoned")
        engine.reset()
    }

    // ════════════════════════════════════════════════════════════════
    // MARK: - 5 · GPS TELEPORT
    // ════════════════════════════════════════════════════════════════

    /// Distance jumps 3 miles in one tick (a re-acquired fix stitching a
    /// straight line). The split takeover must fire ONCE, not three times.
    @Test func threeMileTeleportFiresExactlyOneSplit() {
        let (engine, tracker) = newRig(justRun())
        engine.start()

        tracker.setFixture(pace: 540, hr: 150, cadence: 176, distanceMi: 0.4)
        _ = tickCapturingCue(engine, seconds: 200)

        tracker.setFixture(pace: 540, hr: 150, cadence: 176, distanceMi: 3.4)
        let cue = tickCapturingCue(engine, seconds: 1)
        var fired = 0
        var mileNo = -1
        if case .split(let m, let lap) = cue {
            fired = 1; mileNo = m
            #expect(lap >= 1, "a banked split is never zero or negative")
        }
        #expect(fired == 1)
        #expect(mileNo == 3, "the most recent boundary, not a queue of three")

        // And nothing more fires until the NEXT boundary.
        for _ in 0..<5 {
            let c = tickCapturingCue(engine, seconds: 1)
            if case .split = c { Issue.record("a second split fired without a new mile") }
        }
        engine.reset()
    }

    /// Bookkeeping after a teleport: mile 4 must read as mile 4, and its
    /// banked split must be the time since the teleport — not since the run
    /// began, and never negative.
    @Test func mileBookkeepingSurvivesATeleport() {
        let (engine, tracker) = newRig(justRun())
        engine.start()

        tracker.setFixture(pace: 540, hr: 150, cadence: 176, distanceMi: 3.4)
        _ = tickCapturingCue(engine, seconds: 300)

        tracker.setFixture(pace: 540, hr: 150, cadence: 176, distanceMi: 4.05)
        let cue = tickCapturingCue(engine, seconds: 420)
        if case .split(let m, let lap) = cue {
            #expect(m == 4)
            #expect(lap == 420, "split = elapsed since the last crossing")
            #expect(lap > 0)
        } else {
            Issue.record("no split at mile 4 after a teleport")
        }
        engine.reset()
    }

    /// A teleport across a distance-rep boundary must not corrupt the phase
    /// cursor. It advances exactly ONE phase and DISCARDS the overshoot:
    /// `advance()` re-anchors `phaseStartMi` to the post-teleport odometer,
    /// so a 2.4 mi jump satisfies one 1 mi rep and leaves the next rep with
    /// a full mile still to run. That is the conservative reading and the
    /// right one — a GPS glitch must not tick three reps off the plan — but
    /// it is worth pinning, because the alternative (carrying the remainder
    /// forward) is the obvious "fix" someone will reach for.
    @Test func teleportAdvancesOnePhaseAndDiscardsTheOvershoot() {
        let (engine, tracker) = newRig(distanceWorkout())
        engine.start()
        tracker.setFixture(pace: 400, hr: 160, cadence: 180, distanceMi: 2.4)

        simulate(engine, seconds: 1)
        #expect(engine.currentIndex == 1)
        #expect(engine.phaseCoveredMi == 0, "the 1.4 mi overshoot is discarded, not banked")
        #expect(abs((engine.phaseRemainingMi ?? 0) - 1.0) < 0.0001)

        // A further tick with the odometer frozen must NOT advance again.
        simulate(engine, seconds: 1)
        #expect(engine.currentIndex == 1, "one teleport, one advance")
        #expect(engine.phaseCoveredMi >= 0)
        #expect((engine.phaseRemainingMi ?? 0) >= 0)

        // And a genuine further mile advances it normally.
        tracker.setFixture(pace: 400, hr: 160, cadence: 180, distanceMi: 3.45)
        simulate(engine, seconds: 400)
        #expect(engine.currentIndex == 2)
        engine.reset()
    }

    // ════════════════════════════════════════════════════════════════
    // MARK: - 6 · EXTREMES
    // ════════════════════════════════════════════════════════════════

    /// A payload that decodes cleanly and contains no phases at all.
    /// `start()` opens with `if workout.phases.isEmpty { planComplete = true }`
    /// — and then, fifteen lines later in the same function, unconditionally
    /// assigns `planComplete = false`.
    @Test func zeroPhaseWorkoutFreezesTheClockAtZero() {
        let w = WatchWorkout(workoutId: "hostile-empty", name: "E", summary: "e",
                             totalEstimatedMinutes: 0, phases: [],
                             completionEndpoint: "/x", expiresAt: "2099-01-01T00:00:00Z")
        let (engine, tracker) = newRig(w)
        engine.start()
        tracker.setFixture(pace: 500, hr: 150, cadence: 176, distanceMi: 2.0)

        #expect(engine.state == .running)
        #expect(engine.currentPhase == nil)

        for _ in 0..<120 { simulate(engine, seconds: 1) }

        // BUG: `start()` sets `planComplete = true` for an empty payload and
        // then overwrites it with `planComplete = false` further down the
        // same function, so the overtime branch of `tick()` is never taken.
        // `tick()` then hits `guard let phase = currentPhase else { return }`
        // BEFORE it publishes elapsed, and the clock never moves. This is
        // verbatim the failure `start()`'s own comment says it fixed: "the
        // run recorded in HealthKit while the face showed 0:00 for ninety
        // minutes and the completion carried a zero duration."
        // FIXED: the empty-phase guard is set AFTER the reset that used to clear it.
        #expect(engine.planComplete == true)
        #expect(engine.totalElapsedSec == 120, "clock frozen at \(engine.totalElapsedSec)")
        engine.reset()
    }

    /// The wire consequence of the same defect: the run is reported as
    /// abandoned, with zero duration and zero phases, no matter how far the
    /// runner actually ran.
    @Test func zeroPhaseWorkoutShipsAZeroDurationAbandonedCompletion() throws {
        let w = WatchWorkout(workoutId: "hostile-empty-2", name: "E", summary: "e",
                             totalEstimatedMinutes: 0, phases: [],
                             completionEndpoint: "/x", expiresAt: "2099-01-01T00:00:00Z")
        let (engine, tracker) = newRig(w)
        engine.start()
        tracker.setFixture(pace: 500, hr: 150, cadence: 176, distanceMi: 5.5)
        for _ in 0..<600 { simulate(engine, seconds: 5) }   // 50 minutes of running
        engine.abandon()

        let c = try #require(engine.completion)
        #expect(c.phases.isEmpty)
        #expect(c.totalDistanceMi == 5.5, "distance comes from the tracker, so it survives")

        // BUG: same root cause as above — 50 minutes of real running is
        // written to the server as a 0-second abandoned run. Downstream
        // (`reconstruct.ts`, `glance-state`) reads "abandoned" as "did not
        // run to its end".
        // FIXED: the empty-phase guard survives start().
        #expect(c.totalDurationSec == 3000, "shipped \(c.totalDurationSec)s")
        #expect(c.status == "completed")
        engine.reset()
    }

    /// Five hours. The clock must stay exact and monotonic, the phase must
    /// not end, and the mile bookkeeping must still be right at mile 33.
    @Test func fiveHourRunKeepsAnExactMonotonicClock() {
        let (engine, tracker) = newRig(justRun())
        engine.start()

        var lastTotal = -1
        var mi = 0.0
        var splits = 0
        for _ in 0..<3600 {                       // 3600 × 5 s = 18000 s
            mi += 5.0 / 540.0                     // 9:00 /mi
            tracker.setFixture(pace: 540, hr: 148, cadence: 172, distanceMi: mi)
            let cue = tickCapturingCue(engine, seconds: 5)
            if case .split = cue { splits += 1 }
            #expect(engine.totalElapsedSec > lastTotal, "clock went backwards")
            lastTotal = engine.totalElapsedSec
        }

        #expect(engine.totalElapsedSec == 18000)
        #expect(engine.phaseElapsedSec == 18000)
        #expect(engine.phaseRemainingSec == 24 * 3600 - 18000)
        #expect(engine.phaseRemainingSec > 0)
        #expect(engine.state == .running)
        #expect(engine.planComplete == false)
        #expect(splits == Int(mi), "one split per integer mile over five hours")
        #expect(engine.phaseProgress.isFinite)
        engine.reset()
    }

    /// Thirty seconds, then ended. Nothing may be negative or NaN, and the
    /// tiny distance must not become a garbage average pace.
    @Test func thirtySecondRunProducesASaneCompletion() throws {
        let (engine, tracker) = newRig(justRun())
        engine.start()
        tracker.setFixture(pace: 540, hr: 132, cadence: 168, distanceMi: 0.055)
        for _ in 0..<30 { simulate(engine, seconds: 1) }
        engine.abandon()

        let c = try #require(engine.completion)
        #expect(c.totalDurationSec == 30)
        #expect(c.totalDurationSec > 0)
        #expect((c.totalDistanceMi ?? 0) > 0)
        let p = try #require(c.phases.first)
        #expect(p.actualDurationSec == 30)
        #expect(p.actualDurationSec >= 0)
        // 30 s / 0.055 mi ≈ 545 s/mi — plausible, and above the 0.02 mi floor.
        #expect((p.actualPaceSPerMi ?? 0) > 0)
        #expect((p.actualPaceSPerMi ?? 0) < 4000)
        engine.reset()
    }

    /// A phase with `durationSec: 0` must clear on the first tick rather
    /// than hang or produce a negative remaining.
    @Test func zeroDurationPhaseClearsImmediatelyWithoutNegatives() {
        let phases = [
            WatchPhase(index: 0, type: .warmup, label: "Zero", durationSec: 0,
                       targetPaceSPerMi: nil, tolerancePaceSPerMi: nil, haptic: .start),
            WatchPhase(index: 1, type: .work, label: "Rep", durationSec: 120,
                       targetPaceSPerMi: 391, tolerancePaceSPerMi: 10, haptic: .transitionWork),
        ]
        let w = WatchWorkout(workoutId: "hostile-zero-dur", name: "Z", summary: "z",
                             totalEstimatedMinutes: 2, phases: phases,
                             completionEndpoint: "/x", expiresAt: "2099-01-01T00:00:00Z")
        let (engine, _) = newRig(w)
        engine.start()
        #expect(engine.phaseRemainingSec == 0)
        #expect(engine.phaseRemainingSec >= 0)
        #expect(engine.phaseProgress.isFinite, "0/0 must not be NaN")
        #expect(engine.phaseProgress == 0)

        simulate(engine, seconds: 1)
        #expect(engine.currentIndex == 1, "a zero-length phase must not hang the workout")
        #expect(engine.totalElapsedSec >= 0)
        engine.reset()
    }

    /// `tolerancePaceSPerMi: 0` — the evaluator clamps to a 1 s/mi floor
    /// rather than grading every sample as drift, and hardDrift stays 15.
    @Test func zeroToleranceIsClampedRatherThanGradingEverythingRed() {
        let phases = [
            WatchPhase(index: 0, type: .work, label: "Knife edge", durationSec: 600,
                       targetPaceSPerMi: 391, tolerancePaceSPerMi: 0, haptic: .start),
        ]
        let w = WatchWorkout(workoutId: "hostile-zero-tol", name: "K", summary: "k",
                             totalEstimatedMinutes: 10, phases: phases,
                             completionEndpoint: "/x", expiresAt: "2099-01-01T00:00:00Z")
        let (engine, tracker) = newRig(w)
        engine.start()

        tracker.setFixture(pace: 391, hr: 170, cadence: 184, distanceMi: 0.1)
        simulate(engine, seconds: 1)
        #expect(engine.paceZone == .onTarget, "dead on target must still be green with tol 0")

        tracker.setFixture(pace: 392, hr: 170, cadence: 184, distanceMi: 0.2)
        simulate(engine, seconds: 1)
        #expect(engine.paceZone == .onTarget, "clamped to a 1 s/mi floor")

        tracker.setFixture(pace: 420, hr: 170, cadence: 184, distanceMi: 0.3)
        simulate(engine, seconds: 1)
        #expect(engine.paceZone == .offTarget)
        #expect(engine.paceDeltaSPerMi == 29)
        engine.reset()
    }

    /// `distanceMi: 0` on a distance rep — degenerate but must not hang,
    /// must not divide by zero, must not report a negative remaining.
    @Test func zeroDistanceRepDoesNotHangOrDivideByZero() {
        let phases = [
            WatchPhase(index: 0, type: .warmup, label: "Nowhere", durationSec: 600,
                       targetPaceSPerMi: nil, tolerancePaceSPerMi: nil, haptic: .start,
                       repUnit: .distance, distanceMi: 0),
            WatchPhase(index: 1, type: .work, label: "Rep", durationSec: 300,
                       targetPaceSPerMi: 391, tolerancePaceSPerMi: 10, haptic: .transitionWork),
        ]
        let w = WatchWorkout(workoutId: "hostile-zero-dist", name: "N", summary: "n",
                             totalEstimatedMinutes: 15, phases: phases,
                             completionEndpoint: "/x", expiresAt: "2099-01-01T00:00:00Z")
        let (engine, tracker) = newRig(w)
        engine.start()
        tracker.setFixture(pace: 0, hr: 0, cadence: 0, distanceMi: 0)

        #expect(engine.phaseRemainingMi == 0)
        #expect(engine.phaseProgress.isFinite, "covered/0 must not be NaN or infinite")

        simulate(engine, seconds: 1)
        #expect(engine.currentIndex == 1, "a 0-mile rep is instantly satisfied, not eternal")
        engine.reset()
    }

    /// Nothing the engine publishes may ever go negative, at any point in a
    /// hostile run — a sweep across every derived number.
    @Test func noPublishedNumberEverGoesNegative() {
        let (engine, tracker) = newRig(distanceWorkout())
        engine.start()
        let inputs: [(Int, Int, Int, Double)] = [
            (0, 0, 0, 0),            // dead everything
            (391, 150, 178, 0.5),    // normal
            (0, 0, 0, 0.5),          // GPS loss, distance frozen
            (2400, 220, 250, 9.9),   // teleport + absurd sensors
            (150, 30, 30, 9.9),      // absurd fast pace, bradycardia
        ]
        for (p, h, c, d) in inputs {
            tracker.setFixture(pace: p, hr: h, cadence: c, distanceMi: d)
            for _ in 0..<20 { simulate(engine, seconds: 3) }
            #expect(engine.phaseElapsedSec >= 0)
            #expect(engine.totalElapsedSec >= 0)
            #expect(engine.phaseRemainingSec >= 0)
            #expect(engine.phaseCoveredMi >= 0)
            #expect((engine.phaseRemainingMi ?? 0) >= 0)
            #expect(engine.phaseProgress >= 0 && engine.phaseProgress <= 1)
            #expect(engine.phaseProgress.isFinite)
            #expect((engine.endingCountdownSec ?? 0) >= 0)
            #expect((engine.distanceToGoMi ?? 0) >= 0)
            if let proj = engine.projectedFinishSec { #expect(proj >= 0) }
        }
        engine.reset()
    }

    // ════════════════════════════════════════════════════════════════
    // MARK: - 7 · UNITS
    // ════════════════════════════════════════════════════════════════

    /// The board says "Km N". The engine counts MILES.
    ///
    /// `WatchRouterV5.momentBoard` renders a `.split` cue as
    /// `(WFmt.isKm(units) ? "Km " : "Mile ") + String(mile)` — but the cue is
    /// built in `tick()` from `let mileIndex = Int(coveredMi)`, in miles, with
    /// a lap time measured over a mile.
    @Test func kmRunnerIsToldKilometresAndGivenMiles() {
        let (engine, tracker) = newRig(justRun(units: "km"))
        engine.start()

        // One kilometre = 0.6214 mi. A km runner expects a split here.
        tracker.setFixture(pace: 540, hr: 150, cadence: 176, distanceMi: 0.63)
        let atOneKm = tickCapturingCue(engine, seconds: 336)
        var firedAtOneKm = false
        if case .split = atOneKm { firedAtOneKm = true }

        // BUG: the split takeover is anchored to integer MILES regardless of
        // `unitsDistance`, while the board that draws it prefixes the number
        // with "Km" for a kilometre runner. A km runner gets their first
        // "Km 1" flash at 1.609 km, their "Km 2" at 3.219 km, and the split
        // time under it is a mile split. Every marathon split a metric
        // runner sees on this watch is wrong by 61%.
        // FIXED 2026-08-24. The split index is computed in the runner's own
        // unit, so a km runner's first flash lands at 1 km and the time under
        // it is a kilometre split. Locked here because every marathon split a
        // metric runner saw was previously wrong by 61%.
        #expect(firedAtOneKm, "a km runner's first split must land at 1 km")

        engine.reset()
    }

    /// The almost-done board DOES convert — `formatMiRemaining` multiplies by
    /// 1.609344 and the unit word follows. Locking it so the fix above can't
    /// regress it.
    @Test func almostDoneBoardConvertsItsFigureAndItsUnitToKm() {
        let (engine, tracker) = newRig(singlePhaseDistanceRun(totalMi: 3.0, units: "km"))
        engine.start()
        // Walk the mile boundaries first — the split takeover is flashed
        // AFTER the almost-done takeover in tick(), so a tick that crosses a
        // mile AND enters the last quarter would only leave the split behind.
        tracker.setFixture(pace: 540, hr: 150, cadence: 176, distanceMi: 2.5)
        _ = tickCapturingCue(engine, seconds: 1350)
        tracker.setFixture(pace: 540, hr: 150, cadence: 176, distanceMi: 2.8)
        let cue = tickCapturingCue(engine, seconds: 162)
        if case .almostDone(let value, let unit) = cue {
            #expect(unit == "km left")
            #expect(value == "0.32", "0.2 mi remaining is 0.32 km, and it says so")
        } else {
            Issue.record("no almost-done board at 0.2 mi to go; got \(String(describing: cue))")
        }
        engine.reset()
    }

    /// Same run in miles — same figure, unconverted, with the mile word.
    @Test func almostDoneBoardStaysInMilesForAMileRunner() {
        let (engine, tracker) = newRig(singlePhaseDistanceRun(totalMi: 3.0, units: "mi"))
        engine.start()
        tracker.setFixture(pace: 540, hr: 150, cadence: 176, distanceMi: 2.5)
        _ = tickCapturingCue(engine, seconds: 1350)
        tracker.setFixture(pace: 540, hr: 150, cadence: 176, distanceMi: 2.8)
        let cue = tickCapturingCue(engine, seconds: 162)
        if case .almostDone(let value, let unit) = cue {
            #expect(unit == "mi left")
            #expect(value == "0.2")
        } else {
            Issue.record("no almost-done board for a mile runner")
        }
        engine.reset()
    }

    /// Everything the engine COMPUTES (rather than draws) is documented as
    /// staying in miles regardless of `unitsDistance` — WatchWorkout's own
    /// doctrine, "DISPLAY ONLY". Locked so a units fix converts at the edge
    /// and does not silently double-convert here.
    @Test func engineInternalDistanceMathStaysInMilesUnderKmUnits() {
        let (engine, tracker) = newRig(singlePhaseDistanceRun(totalMi: 6.0, units: "km"))
        engine.start()
        tracker.setFixture(pace: 540, hr: 150, cadence: 176, distanceMi: 3.0)
        simulate(engine, seconds: 1620)

        #expect(engine.phaseCoveredMi == 3.0)
        #expect(abs((engine.distanceToGoMi ?? 0) - 3.0) < 0.0001)
        #expect(abs((engine.phaseRemainingMi ?? 0) - 3.0) < 0.0001)
        // 1620 s for 3.0 mi extrapolated to 6.0 mi = 3240 s.
        #expect(engine.projectedFinishSec == 3240)
        engine.reset()
    }

    /// And the completion is miles on the wire for a km runner — the server
    /// owns the conversion.
    @Test func kmRunnerCompletionIsStillWrittenInMiles() throws {
        let (engine, tracker) = newRig(justRun(units: "km"))
        engine.start()
        tracker.setFixture(pace: 540, hr: 150, cadence: 176, distanceMi: 5.0)
        for _ in 0..<540 { simulate(engine, seconds: 5) }
        engine.abandon()
        let c = try #require(engine.completion)
        #expect(c.totalDistanceMi == 5.0, "5.0 means five MILES on the wire")
        engine.reset()
    }

    // ════════════════════════════════════════════════════════════════
    // MARK: - 8 · PAUSE ABUSE
    // ════════════════════════════════════════════════════════════════

    /// Fifty pause/resume cycles as fast as the API can take them. The clock
    /// must stay monotonic, the flag must land correct, and no counter may
    /// go backwards.
    @Test func fiftyRapidPauseResumeCyclesKeepEveryCounterMonotonic() {
        let (engine, tracker) = newRig(timeWorkout())
        engine.start()
        tracker.setFixture(pace: 500, hr: 150, cadence: 174, distanceMi: 0.1)
        simulate(engine, seconds: 60)
        #expect(engine.phaseElapsedSec == 60)

        var lastTotal = engine.totalElapsedSec
        var lastPaused = engine.totalPausedSec
        for _ in 0..<50 {
            engine.pause()
            #expect(engine.isPaused == true)
            engine.tick()                                   // must be a no-op
            #expect(engine.totalElapsedSec >= lastTotal, "elapsed went backwards while paused")
            engine.resume()
            #expect(engine.isPaused == false)
            simulate(engine, seconds: 1)
            #expect(engine.totalElapsedSec >= lastTotal, "elapsed went backwards on resume")
            #expect(engine.totalPausedSec >= lastPaused, "paused counter went backwards")
            lastTotal = engine.totalElapsedSec
            lastPaused = engine.totalPausedSec
        }

        // 50 simulated seconds added on top of the first 60. Rapid cycling
        // must not have eaten or invented any of them.
        #expect(engine.phaseElapsedSec == 110)
        #expect(engine.totalElapsedSec == 110)
        #expect(engine.totalPausedSec >= 0)
        #expect(engine.state == .running)
        engine.reset()
    }

    /// Ticks that land while paused must not advance anything, however many
    /// of them arrive.
    @Test func aHundredTicksWhilePausedChangeNothing() {
        let (engine, tracker) = newRig(timeWorkout())
        engine.start()
        tracker.setFixture(pace: 500, hr: 150, cadence: 174, distanceMi: 0.2)
        simulate(engine, seconds: 45)

        let elapsed = engine.phaseElapsedSec
        let total = engine.totalElapsedSec
        let idx = engine.currentIndex
        engine.pause()
        for _ in 0..<100 { engine.tick() }
        #expect(engine.phaseElapsedSec == elapsed)
        #expect(engine.totalElapsedSec == total)
        #expect(engine.currentIndex == idx)
        engine.resume()
        #expect(engine.phaseElapsedSec == elapsed)
        engine.reset()
    }

    /// Resume without a pause, pause twice, resume twice — the unbalanced
    /// calls must all be inert rather than corrupting the clock.
    @Test func unbalancedPauseAndResumeCallsAreInert() {
        let (engine, tracker) = newRig(timeWorkout())
        engine.start()
        tracker.setFixture(pace: 500, hr: 150, cadence: 174, distanceMi: 0.2)
        simulate(engine, seconds: 30)

        engine.resume()                       // never paused
        #expect(engine.isPaused == false)
        #expect(engine.phaseElapsedSec == 30)

        engine.pause(); engine.pause()        // double pause
        #expect(engine.isPaused == true)
        engine.resume(); engine.resume()      // double resume
        #expect(engine.isPaused == false)

        simulate(engine, seconds: 10)
        #expect(engine.phaseElapsedSec == 40, "unbalanced calls must not skew the clock")
        #expect(engine.totalPausedSec >= 0)
        engine.reset()
    }

    /// Pausing must not be possible in a race, however many times it is
    /// asked for — the existing suite asserts one call; this asserts the
    /// abuse case, since a blocked verb that half-works is worse than none.
    @Test func fiftyPauseAttemptsDuringARaceAllBounce() {
        let phase = WatchPhase(index: 0, type: .work, label: "Marathon", durationSec: 14400,
                               targetPaceSPerMi: 407, tolerancePaceSPerMi: 15, haptic: .start)
        let w = WatchWorkout(workoutId: "hostile-race", name: "M", summary: "m",
                             totalEstimatedMinutes: 240, phases: [phase],
                             completionEndpoint: "/x", expiresAt: "2099-01-01T00:00:00Z",
                             isRace: true)
        let (engine, tracker) = newRig(w)
        engine.start()
        tracker.setFixture(pace: 407, hr: 172, cadence: 182, distanceMi: 1.0)
        simulate(engine, seconds: 407)

        for _ in 0..<50 {
            engine.pause()
            #expect(engine.isPaused == false)
            engine.resume()
        }
        simulate(engine, seconds: 100)
        #expect(engine.phaseElapsedSec == 507, "race elapsed is gun-to-mat and cannot be stopped")
        #expect(engine.totalPausedSec == 0)
        engine.reset()
    }

    /// Pause during overtime — the plan is done but the session is live, and
    /// the clock must behave exactly as it does mid-plan.
    @Test func pauseInOvertimeFreezesTheOvertimeClock() {
        let (engine, tracker) = newRig(timeWorkout())
        engine.start()
        tracker.setFixture(pace: 500, hr: 150, cadence: 174, distanceMi: 0.5)
        for p in engine.workout.phases { simulate(engine, seconds: p.durationSec + 1) }
        #expect(engine.planComplete == true)

        simulate(engine, seconds: 120)
        let overtime = engine.totalElapsedSec
        engine.pause()
        for _ in 0..<50 { engine.tick() }
        #expect(engine.totalElapsedSec == overtime)
        engine.resume()
        simulate(engine, seconds: 30)
        #expect(engine.totalElapsedSec >= overtime)
        #expect(engine.state == .running)
        engine.reset()
    }
}
