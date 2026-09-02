//
//  _WatchGraderTests.swift
//  FaffWatch Watch AppTests
//
//  GRADER-SWIFT-1 (2026-09-02) · THE WRIST GRADER, TESTED IN SWIFT.
//
//  ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
//  `web-v2/lib/training/_watch_grader_parity.test.ts` is the only thing that
//  has ever checked the per-phase verdict, and it says in its own header what
//  it is: a TypeScript PORT of the rule in `WorkoutEngine.recordCurrentPhase`,
//  plus text assertions that the Swift still LOOKS like the thing it ported.
//  Its own Rule 22 section is blunt about the gap — "It does not run Swift.
//  The port agreeing with `gradePhase` proves the two RULES match, not that
//  the compiled watch executes the port."
//
//  Measured before writing this file: the string `verdict` appeared in ZERO
//  Swift test files. The rule that decides what every completed rep is called
//  had no executable coverage on the platform that runs it.
//
//  These tests run the REAL `WorkoutEngine` — no reimplementation, no port.
//  Phases are driven through `tick()` and the assertions read
//  `engine.completion`, which is the same object the watch POSTs.
//
//  ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
//
//    · It does not check PARITY with the server. It asserts the wrist's own
//      answers; `_watch_grader_parity.test.ts` remains the seam that says the
//      server agrees. Both are needed, and neither replaces the other.
//    · It grades against a FIXTURE tracker whose pace is exact. Real GPS pace
//      is a smoothed derivative, and the settling behaviour that motivated
//      PACE-SHAPE-1 in the first place is not reproduced here.
//    · It says nothing about the LIVE colour on the wrist (`PaceDrift`), only
//      about the recorded per-phase verdict.
//    · It cannot see a `paceShape` the server never sends. When the key is
//      absent the watch falls back to `WatchPaceShape.legacyDefault`, and the
//      last test here pins that fallback because it is what every already
//      deployed watch uses.
//

import Testing
import Foundation
@testable import FaffWatch_Watch_App

@MainActor
struct WatchGraderTests {

    // MARK: - Rig
    //
    // Distance is advanced by hand so a phase's average pace is EXACT, which
    // is what the `.window` rule grades. `phaseCoveredMi` is
    // `tracker.distanceMi - phaseStartMi`, so moving the odometer by
    // `sec / pace` miles gives the phase precisely that average.

    private func rig(_ phases: [WatchPhase]) -> (WorkoutEngine, WorkoutTracker) {
        let w = WatchWorkout(workoutId: "grade", name: "G", summary: "g",
                             totalEstimatedMinutes: 30, phases: phases,
                             completionEndpoint: "/c", expiresAt: "2099-12-31T00:00:00Z")
        let t = WorkoutTracker()
        let e = WorkoutEngine(workout: w)
        e.tracker = t
        return (e, t)
    }

    /// Run the phase in flight for `sec` seconds at exactly `paceSPerMi`.
    /// `odo` is carried by the caller because the tracker's distance is a
    /// lifetime odometer, not a per-phase one.
    ///
    /// DO NOT ALSO CALL `endCurrentPhase()` WHEN `sec` IS THE PHASE'S FULL
    /// DURATION. The engine advances by itself on the last tick, so a manual
    /// end on top of that advances a SECOND time and cuts the following phase
    /// to zero. Three tests in this file failed exactly that way on their
    /// first run and reported `incomplete` on reps that were run in full —
    /// which is the rig lying, not the grader. `endEarly` is only for a phase
    /// deliberately cut short.
    private func runPhase(_ e: WorkoutEngine, _ t: WorkoutTracker,
                          sec: Int, paceSPerMi: Int, odo: inout Double,
                          endEarly: Bool = false) {
        let step = 1.0 / Double(paceSPerMi)        // miles per second
        for _ in 0..<sec {
            odo += step
            t.setFixture(pace: paceSPerMi, hr: 150, cadence: 178, distanceMi: odo)
            e.phaseStart = e.phaseStart.addingTimeInterval(-1)
            e.tick()
        }
        if endEarly { e.endCurrentPhase() }
    }

    private func phase(_ i: Int, _ type: WatchPhaseType, _ label: String,
                       sec: Int, target: Int?, tol: Int?,
                       shape: WatchPaceShape?) -> WatchPhase {
        WatchPhase(index: i, type: type, label: label, durationSec: sec,
                   targetPaceSPerMi: target, tolerancePaceSPerMi: tol,
                   haptic: .transitionWork, paceShape: shape)
    }

    /// The verdicts on a completed run, in phase order.
    private func verdicts(_ e: WorkoutEngine) -> [String?] {
        (e.completion?.phases ?? []).map(\.verdict)
    }

    // MARK: - `.window` · the completed segment average, both sides

    @Test func aWindowRepInsideTheBandIsHit() {
        let (e, t) = rig([phase(0, .work, "Rep", sec: 420, target: 391, tol: 10, shape: .window)])
        e.start()
        var odo = 0.0
        runPhase(e, t, sec: 420, paceSPerMi: 391, odo: &odo)
        e.abandon()
        #expect(verdicts(e).first ?? nil == "hit")
        e.reset()
    }

    @Test func aWindowRepFasterThanTheBandIsFastAndNotAMiss() {
        // 375 against 391 ± 10 · the fast edge is 381.
        let (e, t) = rig([phase(0, .work, "Rep", sec: 400, target: 391, tol: 10, shape: .window)])
        e.start()
        var odo = 0.0
        runPhase(e, t, sec: 400, paceSPerMi: 375, odo: &odo)
        e.abandon()
        // `fast` and `slow` exist because the retired `missed` conflated two
        // opposite events. A runner who ran QUICKER must never read "missed".
        #expect(verdicts(e).first ?? nil == "fast")
        e.reset()
    }

    @Test func aWindowRepSlowerThanTheBandIsSlow() {
        let (e, t) = rig([phase(0, .work, "Rep", sec: 420, target: 391, tol: 10, shape: .window)])
        e.start()
        var odo = 0.0
        runPhase(e, t, sec: 420, paceSPerMi: 420, odo: &odo)
        e.abandon()
        #expect(verdicts(e).first ?? nil == "slow")
        e.reset()
    }

    @Test func theOwnersFourByOneMileSessionGradesEveryRepHit() {
        // THE SESSION THAT MOTIVATED PACE-SHAPE-1. 2026-09-01, 4 × 1 mi at
        // 422 / 429 / 422 / 419 s/mi against a 430 ± 8 target, negative split.
        // The old sample-share rule returned drifted, drifted, drifted,
        // MISSED — and `missed` reads as TOO SLOW to a runner who had just
        // been told to run the last one at the pace of the first and did it
        // three seconds quicker.
        //
        // Every one of these averages is inside 430 ± 8 except rep 4 at 419,
        // which is one second past the fast edge of 422 and so is `fast` —
        // never `missed`.
        let paces = [422, 429, 422, 419]
        var phases: [WatchPhase] = []
        for (n, _) in paces.enumerated() {
            phases.append(phase(n * 2, .work, "Rep \(n + 1) of 4",
                                sec: 430, target: 430, tol: 8, shape: .window))
            phases.append(phase(n * 2 + 1, .recovery, "Jog",
                                sec: 60, target: nil, tol: nil, shape: WatchPaceShape.none))
        }
        let (e, t) = rig(phases)
        e.start()
        var odo = 0.0
        for p in paces {
            runPhase(e, t, sec: 430, paceSPerMi: p, odo: &odo)
            runPhase(e, t, sec: 60, paceSPerMi: 1034, odo: &odo)
        }
        e.abandon()
        let work = (e.completion?.phases ?? []).filter { $0.type == "work" }
        #expect(work.count == 4)
        #expect(work.map(\.verdict) == ["hit", "hit", "hit", "fast"])
        // NOT ONE OF THEM IS "missed" OR "drifted". Those words are gone.
        #expect(!work.contains { $0.verdict == "missed" || $0.verdict == "drifted" })
        e.reset()
    }

    // MARK: - `.ceiling` · slower is correct running

    @Test func aCooldownSlowerThanItsCeilingIsHitNotSlow() {
        // 534 s/mi under a 502 ceiling. This is the case the old two-sided
        // rule graded `missed` while a 516 warm-up against the SAME number
        // read `hit`.
        let (e, t) = rig([phase(0, .cooldown, "Cool-down", sec: 600,
                                target: 502, tol: 30, shape: .ceiling)])
        e.start()
        var odo = 0.0
        runPhase(e, t, sec: 600, paceSPerMi: 534, odo: &odo)
        e.abandon()
        #expect(verdicts(e).first ?? nil == "hit")
        e.reset()
    }

    @Test func aCeilingPhaseRunFasterThanItsSlackIsFast() {
        // 502 ceiling with 30 s of slack · anything under 472 is genuinely
        // faster than an easy leg was asked to be.
        let (e, t) = rig([phase(0, .work, "Easy", sec: 600,
                                target: 502, tol: 30, shape: .ceiling)])
        e.start()
        var odo = 0.0
        runPhase(e, t, sec: 600, paceSPerMi: 450, odo: &odo)
        e.abandon()
        #expect(verdicts(e).first ?? nil == "fast")
        e.reset()
    }

    @Test func aCeilingPhaseInsideItsOwnSlackIsStillHit() {
        // 480 against 502 − 30 = 472. Quicker than the ceiling, inside the
        // slack, and doctrine's own easy-run test says briefly exceeding the
        // easy ceiling is not a compliance failure.
        let (e, t) = rig([phase(0, .work, "Easy", sec: 600,
                                target: 502, tol: 30, shape: .ceiling)])
        e.start()
        var odo = 0.0
        runPhase(e, t, sec: 600, paceSPerMi: 480, odo: &odo)
        e.abandon()
        #expect(verdicts(e).first ?? nil == "hit")
        e.reset()
    }

    // MARK: - Abstention · what the wrist refuses to grade

    @Test func aRecoveryJogIsNotGradedAtAll() {
        // One run at 1034 s/mi because the runner was catching his breath
        // between two 422s is a correctly executed recovery. Rule 11: nil is
        // "nothing to say", and it must not become a verdict.
        let (e, t) = rig([
            phase(0, .work, "Rep", sec: 420, target: 391, tol: 10, shape: .window),
            phase(1, .recovery, "Jog", sec: 90, target: nil, tol: nil, shape: WatchPaceShape.none),
        ])
        e.start()
        var odo = 0.0
        runPhase(e, t, sec: 420, paceSPerMi: 391, odo: &odo)
        runPhase(e, t, sec: 90, paceSPerMi: 1034, odo: &odo)
        e.abandon()
        let v = verdicts(e)
        #expect(v.count == 2)
        #expect(v[0] == "hit")
        #expect(v[1] == nil)
        e.reset()
    }

    @Test func anEffortPhaseCarriesNoVerdictEvenWithATarget() {
        // A stride is prescribed BY EFFORT. It carries a target pace for the
        // board to draw and that target is not a bar to be judged against —
        // twenty seconds is far too short for a wrist pace estimate to settle.
        let (e, t) = rig([phase(0, .work, "Stride 1 of 6", sec: 20,
                                target: 401, tol: nil, shape: .effort)])
        e.start()
        var odo = 0.0
        runPhase(e, t, sec: 20, paceSPerMi: 600, odo: &odo)
        e.abandon()
        #expect(verdicts(e).first ?? nil == nil)
        e.reset()
    }

    @Test func aPhaseWithNoTargetIsNotGraded() {
        let (e, t) = rig([phase(0, .work, "Just run", sec: 300,
                                target: nil, tol: nil, shape: .window)])
        e.start()
        var odo = 0.0
        runPhase(e, t, sec: 300, paceSPerMi: 500, odo: &odo)
        e.abandon()
        #expect(verdicts(e).first ?? nil == nil)
        e.reset()
    }

    // MARK: - Ending early

    @Test func aRepEndedEarlyIsIncompleteWhateverThePaceWas() {
        // Even a rep run perfectly on pace is `incomplete` when the runner
        // ended it — the completion flag decides this before the band does.
        let (e, t) = rig([
            phase(0, .work, "Rep", sec: 420, target: 391, tol: 10, shape: .window),
            phase(1, .recovery, "Jog", sec: 90, target: nil, tol: nil, shape: WatchPaceShape.none),
        ])
        e.start()
        var odo = 0.0
        runPhase(e, t, sec: 100, paceSPerMi: 391, odo: &odo, endEarly: true)
        e.abandon()
        #expect(verdicts(e).first ?? nil == "incomplete")
        e.reset()
    }

    // MARK: - The fallback every deployed watch is actually using

    @Test func anAbsentPaceShapeResolvesThroughTheLegacyDefault() {
        // `paceShape` is decoded, never nil, and an omitted wire key resolves
        // through `WatchPaceShape.legacyDefault(for:hasTarget:)`. That is the
        // shape a watch uses for any payload authored before PACE-SHAPE-1, so
        // it is graded here rather than assumed.
        //
        // Passing `shape: nil` to the initialiser is exactly what decoding an
        // absent key does.
        let warm = WatchPhase(index: 0, type: .warmup, label: "Warm-up", durationSec: 600,
                              targetPaceSPerMi: 502, tolerancePaceSPerMi: 30,
                              haptic: .start, paceShape: nil)
        let rep = WatchPhase(index: 1, type: .work, label: "Rep", durationSec: 420,
                             targetPaceSPerMi: 391, tolerancePaceSPerMi: 10,
                             haptic: .transitionWork, paceShape: nil)
        let (e, t) = rig([warm, rep])
        e.start()
        var odo = 0.0
        // A warm-up run SLOWER than its target. Under the legacy default this
        // is a ceiling, so slower is correct running.
        runPhase(e, t, sec: 600, paceSPerMi: 540, odo: &odo)
        // A work rep run slower than its band. That one IS a window.
        runPhase(e, t, sec: 420, paceSPerMi: 420, odo: &odo)
        e.abandon()
        let v = verdicts(e)
        #expect(v[0] == "hit")
        #expect(v[1] == "slow")
        e.reset()
    }
}
