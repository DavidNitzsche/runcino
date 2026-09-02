//
//  _CapturePastPlanTests.swift
//  FaffWatch Watch AppTests
//
//  OVERTIME-1 / REPCOUNT-1 / STRIDE-RT-1 · the 2026-09-02 truncation, closed.
//
//  ── THE RUN THIS FILE IS ABOUT ──────────────────────────────────────────────
//
//  David ran his 2026-09-02 session — 5 mi easy, then 6 × 20 s strides with a
//  walk back between each. His watch read 6.41 mi / 55:49 when he stopped.
//  The row the app stored read 5.98 mi / 50:57. In his words: "after the last
//  stride I ran a bit longer."
//
//  Two defects, and they are independent:
//
//    REPCOUNT-1 · the engine counted SEVEN reps on a six-stride session,
//    because `repCountForDisplay` counted every `.work` phase and the 5-mile
//    easy leg is one. The stored completion still carries the evidence: four
//    `recoveryExtensions`, each stamped `repCount: 7`, `beforeRepIndex: 7`.
//
//    OVERTIME-1 · `results` holds one entry per PRESCRIBED phase, and the
//    running that happens after the last one is not a phase. On the live
//    finish path that cost only the breakdown (the totals read the tracker).
//    On the CRASH-RECOVERY path — which is the path that run actually took —
//    it cost the run: with no HKWorkoutSession left to read,
//    `completionFromRecovery` fell back to summing the phases, and the
//    phases did not know about the last 0.43 mi.
//
//  ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
//
//    · It drives `WorkoutEngine` through `SimRun`, which moves a FIXTURE
//      tracker. It proves the engine banks what the tracker reports; it
//      proves nothing about GPS, HealthKit, or whether the real
//      `WorkoutTracker` keeps reporting distance after the plan ends.
//    · It cannot see the process actually dying. `completionFromRecovery` is
//      called directly with a hand-built snapshot, so this proves the
//      RECONSTRUCTION is right, not that the snapshot on disk is what a
//      real crash leaves behind.
//    · It says nothing about what any SCREEN draws. `repCountForDisplay` is
//      asserted at the engine; the boards that read it are not rendered here.
//    · It does not cover the four-presses-in-two-seconds `recoveryExtensions`
//      anomaly on the real row. That is a control / input-repeat question,
//      not a capture one, and it is reported rather than fixed here.
//

import Testing
import Foundation
@testable import FaffWatch_Watch_App

// MARK: - The owner's real session, as a fixture

@MainActor
enum StrideFx {

    /// The 2026-09-02 payload, phase for phase, as `build-workout.ts` shipped
    /// it: ONE `.work` easy leg, then six strides each followed by a walk
    /// back. Thirteen phases, seven of them `.work`, six of them reps.
    static func easyWithSixStrides() -> WatchWorkout {
        var phases: [WatchPhase] = []
        var i = 0
        phases.append(WatchPhase(index: i, type: .work, label: "5.0 mi easy",
                                 durationSec: 2610, targetPaceSPerMi: 522,
                                 tolerancePaceSPerMi: 30, haptic: .start,
                                 paceShape: .ceiling, repUnit: .distance, distanceMi: 5))
        i += 1
        for n in 1...6 {
            phases.append(WatchPhase(index: i, type: .work, label: "Stride \(n) of 6",
                                     durationSec: 20, targetPaceSPerMi: 401,
                                     tolerancePaceSPerMi: nil, haptic: .transitionWork,
                                     paceShape: .effort, repUnit: .time,
                                     isStrideSegment: true))
            i += 1
            phases.append(WatchPhase(index: i, type: .recovery, label: "Walk back",
                                     durationSec: 60, targetPaceSPerMi: 522,
                                     tolerancePaceSPerMi: nil, haptic: .transitionRecovery,
                                     paceShape: .none, repUnit: .time))
            i += 1
        }
        return WatchWorkout(
            workoutId: "0645f40c-2026-09-02", name: "EASY · 6x20s strides",
            summary: "5.0 mi · Easy aerobic", totalEstimatedMinutes: 52,
            phases: phases,
            completionEndpoint: "/api/watch/workouts/complete",
            expiresAt: "2099-12-31T00:00:00Z",
            distanceMi: 5)
    }
}

// MARK: - REPCOUNT-1

@MainActor
struct RepCountTests {

    @Test func aSixStrideSessionCountsSixRepsAndNotSeven() {
        let w = StrideFx.easyWithSixStrides()

        // FALSIFICATION, IN THE FILE. This is the OLD rule, written out, so
        // the test cannot quietly agree with itself: the two disagree on this
        // fixture, and the assertion below names which one the engine uses.
        // Restore the old rule and the second line fails while the first
        // still passes — which is the failure this test exists to produce.
        let oldRule = w.phases.filter { $0.type == .work }.count
        #expect(oldRule == 7)

        let e = WorkoutEngine(workout: w)
        #expect(e.repCountForDisplay == 6)
    }

    @Test func theEasyLegIsNotRepOneAndStrideOneIs() {
        let sim = SimRun(StrideFx.easyWithSixStrides(), pace: 522)
        sim.start()

        // Phase 0 is the 5-mile easy leg. It is `.work`, and it is not a rep:
        // a progress strip must read "none done", not "rep 1 of 7".
        #expect(sim.engine.currentIndex == 0)
        #expect(sim.engine.repIndexForDisplay == 0)

        sim.engine.endCurrentPhase()          // → stride 1
        #expect(sim.engine.currentIndex == 1)
        #expect(sim.engine.repIndexForDisplay == 1)
        #expect(sim.engine.repCountForDisplay == 6)

        sim.engine.endCurrentPhase()          // → walk back 1
        // On a recovery the ordinal is the rep just FINISHED, still 1.
        #expect(sim.engine.repIndexForDisplay == 1)
        sim.stop()
    }

    @Test func theLastStrideIsSixOfSixAndNothingFollowsIt() {
        let sim = SimRun(StrideFx.easyWithSixStrides(), pace: 522)
        sim.start()
        // Walk the cursor to stride six (phase index 11) a phase at a time.
        for _ in 0..<11 { sim.engine.endCurrentPhase() }
        #expect(sim.engine.currentIndex == 11)
        #expect(sim.engine.currentPhase?.label == "Stride 6 of 6")
        // THE NUMBER THE RUNNER READ. It said "6 of 7" on stride five and
        // would have said "7 of 7" here.
        #expect(sim.engine.repIndexForDisplay == 6)
        #expect(sim.engine.repCountForDisplay == 6)
        sim.stop()
    }

    @Test func aSessionWithNoRecoveriesStillCountsItsWorkPhases() {
        // THE FALLBACK, AND IT IS LOAD-BEARING. Easy, long, tempo and just-run
        // sessions have no work/recovery alternation to read, so the rule
        // degrades to the old count and their boards are untouched.
        let easy = Fx.easyRun(miles: 6)
        #expect(WorkoutEngine(workout: easy).repCountForDisplay == 1)

        let tempo = [
            WatchPhase(index: 0, type: .warmup, label: "Warm-up", durationSec: 1096,
                       targetPaceSPerMi: 502, tolerancePaceSPerMi: 30, haptic: .start),
            WatchPhase(index: 1, type: .work, label: "2.0 mi tempo", durationSec: 860,
                       targetPaceSPerMi: 430, tolerancePaceSPerMi: 8, haptic: .transitionWork),
            WatchPhase(index: 2, type: .cooldown, label: "Cool-down", durationSec: 1096,
                       targetPaceSPerMi: 502, tolerancePaceSPerMi: 30, haptic: .transitionCooldown),
        ]
        let w = WatchWorkout(workoutId: "t", name: "T", summary: "t",
                             totalEstimatedMinutes: 51, phases: tempo,
                             completionEndpoint: "/c", expiresAt: "2099-12-31T00:00:00Z")
        #expect(WorkoutEngine(workout: w).repCountForDisplay == 1)
    }

    @Test func anIntervalSessionIsUnchangedByTheNewRule() {
        // 6 × 90 s with a warm-up and a cool-down: every work phase is a rep,
        // so old rule and new rule agree and must keep agreeing.
        let w = Fx.timeIntervals()
        #expect(w.phases.filter { $0.type == .work }.count == 6)
        #expect(WorkoutEngine(workout: w).repCountForDisplay == 6)
    }
}

// MARK: - OVERTIME-1 · the live path

@MainActor
struct OvertimeCaptureTests {

    /// Run the whole prescribed session, then keep running.
    private func runThenOvertime(_ extraSec: Int, pace: Int = 522) -> SimRun {
        let sim = SimRun(StrideFx.easyWithSixStrides(), pace: pace)
        sim.start()
        // 2610 + 6×20 + 6×60 = 3090 prescribed seconds; give it room.
        #expect(sim.runPlan(cap: 5000))
        sim.run(extraSec)
        return sim
    }

    @Test func everyOneOfTheSixStridesIsRunAndRecorded() {
        let sim = runThenOvertime(0)
        sim.engine.abandon()
        let phases = sim.engine.completion?.phases ?? []

        let strides = phases.filter { $0.label.hasPrefix("Stride") }
        #expect(strides.count == 6)
        #expect(strides.allSatisfy { $0.completed })
        #expect(strides.map(\.label).last == "Stride 6 of 6")
        // Thirteen prescribed phases, all banked. No overtime row: the run
        // ended on the last beat of the last phase.
        #expect(phases.count == 13)
        sim.stop()
    }

    @Test func theSessionKeepsRecordingAfterTheLastPrescribedPhase() {
        // THE CLOSURE. 292 s past the plan — the same duration that went
        // missing on 2026-09-02.
        let extra = 292
        let sim = runThenOvertime(extra)

        // The engine is in overtime and still counting.
        #expect(sim.engine.planComplete)
        #expect(sim.engine.overtimeSec == extra)

        sim.engine.abandon()
        guard let c = sim.engine.completion else { Issue.record("no completion"); return }

        // 1 · THE TOTALS INCLUDE IT.
        #expect(c.totalDurationSec == sim.second)
        #expect((c.totalDistanceMi ?? 0) > 5.9)

        // 2 · IT IS A ROW, NOT JUST A TOTAL. This is what the recovery path
        // had nothing to fall back on.
        let ot = c.phases.last
        #expect(ot?.type == "overtime")
        #expect(ot?.actualDurationSec == extra)
        #expect((ot?.actualDistanceMi ?? 0) > 0.4)
        // Nothing prescribed it, so nothing grades it (Rule 11).
        #expect(ot?.verdict == nil)
        // And it is not a runner who stopped early.
        #expect(ot?.completed == true)

        // 3 · THE PHASES AND THE HEADER AGREE AGAIN.
        //
        // This is the gap the repaired 2026-09-02 row still carries: header
        // 6.41 mi against phases summing to 5.98. On a run captured by this
        // engine the two reconcile, because the overtime is a phase.
        let sumSec = c.phases.reduce(0) { $0 + $1.actualDurationSec }
        #expect(sumSec == c.totalDurationSec)
        let sumMi = c.phases.compactMap(\.actualDistanceMi).reduce(0, +)
        #expect(abs(sumMi - (c.totalDistanceMi ?? 0)) < 0.05)
        sim.stop()
    }

    @Test func overtimeIsNotFoldedIntoTheWorkAverages() {
        // Overtime is typed "overtime" precisely so a jog home cannot drag an
        // interval session's work-weighted numbers. Assert the type, which is
        // what every work-phase filter keys on.
        let sim = runThenOvertime(120)
        sim.engine.abandon()
        let work = sim.engine.completion?.phases.filter { $0.type == "work" } ?? []
        #expect(work.count == 7)          // the easy leg plus six strides
        #expect(!work.contains { $0.label == "After the session" })
        sim.stop()
    }

    @Test func aWorkoutWithNoPhasesHasNoAfter() {
        // Found by `_HostileInputTests` on this change's first run, and kept
        // here because it is a statement about OVERTIME, not about hostile
        // input: `start()` sets `planComplete` immediately for an empty
        // payload, so without a guard the entire run became one "After the
        // session" row on a session that never began. The totals still carry
        // every mile — that is the hostile-input test's own contract.
        let w = WatchWorkout(workoutId: "empty", name: "E", summary: "e",
                             totalEstimatedMinutes: 0, phases: [],
                             completionEndpoint: "/c", expiresAt: "2099-12-31T00:00:00Z")
        #expect(WorkoutEngine.overtimePhase(afterPhaseCount: w.phases.count,
                                            sec: 3000, mi: 5.5) == nil)
        // And a real plan of the same length still gets its row.
        #expect(WorkoutEngine.overtimePhase(afterPhaseCount: 13,
                                            sec: 3000, mi: 5.5) != nil)
    }

    @Test func aTwoSecondTailIsNotARun() {
        // The floor. Ending on the last beat produces a 0-2 s artefact of the
        // tap, and a row for it would be noise the runner has to read past.
        let sim = runThenOvertime(2)
        sim.engine.abandon()
        #expect(sim.engine.completion?.phases.count == 13)
        #expect(sim.engine.completion?.phases.last?.type != "overtime")
        sim.stop()
    }
}

// MARK: - OVERTIME-1 · the crash-recovery path (the one that actually fired)

@MainActor
struct OvertimeRecoveryTests {

    /// The 2026-09-02 snapshot, as the engine would have left it: plan
    /// complete, 292 s and 0.43 mi of overtime observed, thirteen banked
    /// phases summing to 3057 s / 5.98 mi.
    private func snapshot(totalDistanceMi: Double?) -> WorkoutEngine.RunSnapshot {
        let w = StrideFx.easyWithSixStrides()
        var results: [WatchCompletionPhase] = []
        let secs = [2577, 20, 60, 20, 60, 20, 60, 20, 60, 20, 59, 20, 61]
        let mis = [5.0, 0.05, 0.11, 0.06, 0.12, 0.06, 0.11, 0.05, 0.09, 0.06, 0.10, 0.05, 0.12]
        for (i, p) in w.phases.enumerated() {
            results.append(WatchCompletionPhase(
                index: i, type: p.type.rawValue, label: p.label,
                targetPaceSPerMi: p.targetPaceSPerMi, actualPaceSPerMi: nil,
                actualDurationSec: secs[i], actualDistanceMi: mis[i],
                avgHr: 145, maxHr: 157, avgCadence: nil, completed: true))
        }
        return WorkoutEngine.RunSnapshot(
            workoutId: w.workoutId,
            workoutJSON: (try? JSONEncoder().encode(w)) ?? Data(),
            startedAtEpoch: Date().timeIntervalSince1970 - 3349,
            currentIndex: 12,
            planComplete: true,
            bankedSec: 3057,
            phaseElapsedSec: 292,          // the overtime the snapshot DID see
            phaseStartMi: 5.98,
            results: results,
            mileSplits: nil,
            totalDistanceMi: totalDistanceMi,
            savedAtEpoch: Date().timeIntervalSince1970)
    }

    /// No live builder — the battery-death / session-gone case, which is
    /// exactly what the real run hit (`routePolyline`, `avgCadence`, `kcal`
    /// and `movingSec` all null on the stored row).
    private var noStats: WorkoutTracker.RecoveredStats {
        .init(distanceMi: nil, avgHr: nil, maxHr: nil, kcal: nil, elapsedSec: 0, startDate: nil)
    }

    @Test func theHistoricalTruncationDoesNotReproduce() {
        let c = WorkoutEngine.completionFromRecovery(
            snapshot: snapshot(totalDistanceMi: 6.41), stats: noStats)

        // WHAT IT USED TO PRODUCE: 5.98 mi / 3057 s — the phase sum, because
        // the overtime was in no phase and the odometer was in no snapshot.
        #expect(c.totalDistanceMi == 6.41)
        #expect(c.totalDurationSec == 3057 + 292)
        #expect(c.status == "completed")

        let ot = c.phases.last
        #expect(ot?.type == "overtime")
        #expect(ot?.actualDurationSec == 292)
        #expect(ot?.actualDistanceMi == 0.43)
        #expect(c.phases.count == 14)
    }

    @Test func anOlderSnapshotWithNoOdometerStillKeepsTheSeconds() {
        // Rule 11 · a snapshot written before `totalDistanceMi` existed is a
        // DIFFERENT fact from one that recorded zero. The time axis was
        // always in the snapshot and must survive regardless; the distance
        // degrades rather than inventing a number.
        let c = WorkoutEngine.completionFromRecovery(
            snapshot: snapshot(totalDistanceMi: nil), stats: noStats)
        #expect(c.totalDurationSec == 3057 + 292)
        let ot = c.phases.last
        #expect(ot?.type == "overtime")
        #expect(ot?.actualDurationSec == 292)
        // No odometer, so no claim about how far. Not a fabricated 0.43.
        #expect(ot?.actualDistanceMi == nil)
    }

    @Test func aLiveBuilderStillWinsOverTheSnapshot() {
        // The odometer is tier 2, not tier 1. When HealthKit survived, its
        // total is ground truth and must not be displaced.
        let stats = WorkoutTracker.RecoveredStats(
            distanceMi: 6.55, avgHr: 140, maxHr: 160, kcal: 400,
            elapsedSec: 3400, startDate: Date())
        let c = WorkoutEngine.completionFromRecovery(
            snapshot: snapshot(totalDistanceMi: 6.41), stats: stats)
        #expect(c.totalDistanceMi == 6.55)
        #expect(c.totalDurationSec == 3400)
    }

    @Test func anInFlightCrashIsUnchanged() {
        // The other branch. A snapshot that did NOT complete its plan must
        // still append its in-flight phase and must NOT grow an overtime row.
        let w = StrideFx.easyWithSixStrides()
        let snap = WorkoutEngine.RunSnapshot(
            workoutId: w.workoutId,
            workoutJSON: (try? JSONEncoder().encode(w)) ?? Data(),
            startedAtEpoch: Date().timeIntervalSince1970 - 900,
            currentIndex: 3, planComplete: false,
            bankedSec: 800, phaseElapsedSec: 12, phaseStartMi: 2.0,
            results: [], mileSplits: nil, totalDistanceMi: 2.1,
            savedAtEpoch: Date().timeIntervalSince1970)
        let c = WorkoutEngine.completionFromRecovery(snapshot: snap, stats: noStats)
        #expect(c.status == "partial")
        #expect(c.phases.count == 1)
        #expect(c.phases.first?.label == "Stride 2 of 6")
        #expect(!c.phases.contains { $0.type == "overtime" })
    }
}

// MARK: - STRIDE-RT-1 · the flag makes the return trip

@MainActor
struct StrideRoundTripTests {

    @Test func strideSegmentsComeBackFlaggedAndNothingElseDoes() {
        let sim = SimRun(StrideFx.easyWithSixStrides(), pace: 522)
        sim.start()
        #expect(sim.runPlan(cap: 5000))
        sim.engine.abandon()
        let phases = sim.engine.completion?.phases ?? []

        let flagged = phases.filter { $0.isStrideSegment == true }
        #expect(flagged.count == 6)
        #expect(flagged.allSatisfy { $0.label.hasPrefix("Stride") })

        // The easy leg is `.work` too, and it is NOT a stride. This is the
        // assertion that would catch "flag every work phase".
        let easy = phases.first { $0.label == "5.0 mi easy" }
        #expect(easy?.isStrideSegment == nil)
        // Walk backs carry nothing.
        #expect(phases.filter { $0.type == "recovery" }.allSatisfy { $0.isStrideSegment == nil })
        sim.stop()
    }

    @Test func theKeyIsAbsentRatherThanFalseOnTheWire() throws {
        // The encoded body of an ordinary phase must be byte-identical to what
        // it sent before this field existed — `null` on every recovery phase
        // of every interval session is a real cost on a watch payload.
        let plain = WatchCompletionPhase(
            index: 0, type: "recovery", label: "Walk back",
            targetPaceSPerMi: nil, actualPaceSPerMi: nil, actualDurationSec: 60,
            actualDistanceMi: 0.11, avgHr: nil, maxHr: nil, avgCadence: nil,
            completed: true)
        let plainJSON = String(data: try JSONEncoder().encode(plain), encoding: .utf8) ?? ""
        #expect(!plainJSON.contains("isStrideSegment"))

        var stride = plain
        stride.isStrideSegment = true
        let strideJSON = String(data: try JSONEncoder().encode(stride), encoding: .utf8) ?? ""
        #expect(strideJSON.contains("\"isStrideSegment\":true"))
    }
}
