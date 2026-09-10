//
//  _RecoveryEndedEarlyTests.swift
//  FaffWatch Watch AppTests
//
//  WALKBACK-2 (2026-09-09) · the deeper half of WALKBACK-1.
//
//  WALKBACK-1 stopped the phone from reading a shortened walk-back as a
//  shortfall, but could not make it say anything POSITIVE — nothing on the
//  wire recorded WHY a recovery phase ended before its modelled duration.
//  This suite covers the watch-side half of the fix: `endCurrentPhase()`
//  ("End interval" / the extend-recovery face's "Go now") now recognises a
//  `.recovery` phase ending before `durationSec + phaseAddedSec` and records
//  an explicit `RecoveryEndedEarlyRecord`, mirroring `RepSkipRecord` /
//  `recordRepSkip`'s existing pattern: a decision is not a lapse, and the
//  data has to say so.
//
//  RULE 22 · WHAT THIS SUITE CANNOT FAIL ON
//
//  It proves the ENGINE records the choice and ships it on the wire. It
//  cannot see the server's normalisation (`complete/route.ts`), the
//  `RunData` decode, `recoveriesHonestOf`'s corrected reading, or the phone's
//  display — those are covered by their own TypeScript / Swift suites.
//

import Testing
import Foundation
@testable import FaffWatch_Watch_App

@MainActor
@Suite(.serialized)
struct RecoveryEndedEarlyTests {

    // MARK: - Fixture: work(180s) → recovery(60s) → work(180s)

    private func recoveryWorkout() -> WatchWorkout {
        let phases = [
            WatchPhase(index: 0, type: .work, label: "Rep 1", durationSec: 180,
                       targetPaceSPerMi: 391, tolerancePaceSPerMi: 10, haptic: .transitionWork),
            WatchPhase(index: 1, type: .recovery, label: "Walk back", durationSec: 60,
                       targetPaceSPerMi: nil, tolerancePaceSPerMi: nil, haptic: .transitionRecovery),
            WatchPhase(index: 2, type: .work, label: "Rep 2", durationSec: 180,
                       targetPaceSPerMi: 391, tolerancePaceSPerMi: 10, haptic: .transitionWork),
        ]
        return WatchWorkout(workoutId: "recovery-early-fixture", name: "R", summary: "r",
                            totalEstimatedMinutes: 8, phases: phases,
                            completionEndpoint: "/x", expiresAt: "2099-01-01T00:00:00Z")
    }

    private func newRig(_ w: WatchWorkout) -> (WorkoutEngine, WorkoutTracker) {
        let tracker = WorkoutTracker()
        let engine = WorkoutEngine(workout: w)
        engine.tracker = tracker
        return (engine, tracker)
    }

    /// Same simulated-clock helper as `_HostileInputTests.swift` and
    /// `WorkoutEngineTests.swift`: roll `phaseStart` back and tick once.
    private func simulate(_ engine: WorkoutEngine, seconds: Int) {
        engine.phaseStart = engine.phaseStart.addingTimeInterval(-Double(seconds))
        engine.tick()
    }

    // MARK: - 1 · THE EXACT CASE — a walk-back ended early records the choice

    @Test func endingAWalkBackEarlyRecordsTheChoice() throws {
        let (engine, tracker) = newRig(recoveryWorkout())
        engine.start()
        tracker.setFixture(pace: 391, hr: 165, cadence: 182, distanceMi: 0)

        simulate(engine, seconds: 181)   // finish rep 1 (180s), enter recovery
        #expect(engine.currentPhase?.type == .recovery)

        simulate(engine, seconds: 43)    // 43 of the modelled 60 seconds
        engine.endCurrentPhase()         // "Go now" — end it early
        #expect(engine.currentPhase?.type == .work, "advanced into rep 2")

        engine.abandon()
        let c = try #require(engine.completion)
        let recs = try #require(c.recoveryEndedEarly)
        #expect(recs.count == 1)
        let r = recs[0]
        #expect(r.prescribedSec == 60)
        #expect(r.actualSec == 43)
        #expect(r.phaseIndex == 1)
        #expect(r.phaseLabel == "Walk back")
        #expect(r.afterRepIndex == 1, "the rep just finished")
        #expect(r.beforeRepIndex == 2, "the rep it was delaying")
        engine.reset()
    }

    /// The recovery's own phase entry still banks `completed: false` — the
    /// explicit record travels ALONGSIDE that flag, never instead of it, so
    /// a reader with no knowledge of the new field still sees the honest
    /// tri-state.
    @Test func theRecoveryPhaseItselfStillBanksIncomplete() throws {
        let (engine, tracker) = newRig(recoveryWorkout())
        engine.start()
        tracker.setFixture(pace: 391, hr: 165, cadence: 182, distanceMi: 0)
        simulate(engine, seconds: 181)
        simulate(engine, seconds: 43)
        engine.endCurrentPhase()
        engine.abandon()
        let c = try #require(engine.completion)
        let recoveryPhase = try #require(c.phases.first { $0.type == "recovery" })
        #expect(recoveryPhase.completed == false)
        engine.reset()
    }

    // MARK: - 2 · a recovery that ran its FULL modelled duration records nothing

    @Test func aRecoveryThatRunsItsFullDurationRecordsNothing() throws {
        let (engine, tracker) = newRig(recoveryWorkout())
        engine.start()
        tracker.setFixture(pace: 391, hr: 165, cadence: 182, distanceMi: 0)
        simulate(engine, seconds: 181)          // enter recovery
        #expect(engine.currentPhase?.type == .recovery)
        simulate(engine, seconds: 61)           // full 60s + a tick over — auto-advances
        #expect(engine.currentPhase?.type == .work, "the recovery completed on its own clock")
        engine.abandon()
        let c = try #require(engine.completion)
        #expect(c.recoveryEndedEarly == nil, "nothing was ended EARLY — it ran its own course")
        engine.reset()
    }

    // MARK: - 3 · the asymmetry this must NOT create: a WORK phase ended early

    /// "End interval" on a work rep still ends it early, but that is
    /// `recordRepSkip`'s territory (a separate, explicit call the skip-confirm
    /// board makes) or an ordinary incomplete bank — never a recovery record.
    @Test func endingAWorkPhaseEarlyRecordsNoRecoveryDecision() throws {
        let (engine, tracker) = newRig(recoveryWorkout())
        engine.start()
        tracker.setFixture(pace: 391, hr: 165, cadence: 182, distanceMi: 0)
        simulate(engine, seconds: 90)     // 90 of rep 1's 180 seconds
        #expect(engine.currentPhase?.type == .work)
        engine.endCurrentPhase()          // ends rep 1 early
        #expect(engine.currentPhase?.type == .recovery)
        engine.abandon()
        let c = try #require(engine.completion)
        #expect(c.recoveryEndedEarly == nil)
        // The work phase's own incompleteness is still stated — just not
        // through this record.
        let rep1 = try #require(c.phases.first { $0.label == "Rep 1" })
        #expect(rep1.completed == false)
        engine.reset()
    }

    // MARK: - 4 · an EXTENDED recovery ended early prices the EXTENDED duration

    /// The prescribed figure this ships is `durationSec + phaseAddedSec` —
    /// the number the runner was actually watching count down — not the
    /// original ask. A walk-back extended once (+30s → 90s modelled) then
    /// cut at 70s must report "70 of 90", never "70 of 60".
    @Test func anExtendedRecoveryEndedEarlyPricesTheExtendedDuration() throws {
        let (engine, tracker) = newRig(recoveryWorkout())
        engine.start()
        tracker.setFixture(pace: 391, hr: 165, cadence: 182, distanceMi: 0)
        simulate(engine, seconds: 181)
        #expect(engine.currentPhase?.type == .recovery)
        engine.recordRecoveryExtension(addedSec: 30)   // 60 → 90 modelled
        #expect(engine.phaseRemainingSec == 90)
        simulate(engine, seconds: 70)
        engine.endCurrentPhase()
        engine.abandon()
        let c = try #require(engine.completion)
        let recs = try #require(c.recoveryEndedEarly)
        #expect(recs.count == 1)
        #expect(recs[0].prescribedSec == 90, "the extended clock, not the original 60")
        #expect(recs[0].actualSec == 70)
        engine.reset()
    }

    // MARK: - 5 · the record survives a crash (RunSnapshot round trip)

    /// Same discipline as every other wrist decision: "the watch does not
    /// quietly forget" has to survive the process dying. A recovery ended
    /// early at mile 4 must still reach the phone if the watch is killed
    /// at mile 9.
    @Test func recoveryEndedEarlySurvivesACrash() throws {
        let w = recoveryWorkout()
        let decisions = WorkoutEngine.RunSnapshot.Decisions(
            recoveryEndedEarly: [WorkoutEngine.RecoveryEndedEarlyRecord(
                afterRepIndex: 1, beforeRepIndex: 2, repCount: 2,
                prescribedSec: 60, actualSec: 43,
                phaseIndex: 1, phaseLabel: "Walk back", atSec: 224
            )]
        )
        let snap = WorkoutEngine.RunSnapshot(
            workoutId: w.workoutId,
            workoutJSON: (try? JSONEncoder().encode(w)) ?? Data(),
            startedAtEpoch: Date().timeIntervalSince1970 - 300,
            currentIndex: 2,
            planComplete: false,
            bankedSec: 224,
            phaseElapsedSec: 5,
            phaseStartMi: 0,
            results: [],
            mileSplits: nil,
            totalDistanceMi: nil,
            savedAtEpoch: Date().timeIntervalSince1970,
            decisions: decisions
        )
        let noStats = WorkoutTracker.RecoveredStats(
            distanceMi: nil, avgHr: nil, maxHr: nil, kcal: nil, elapsedSec: 0, startDate: nil)
        let c = WorkoutEngine.completionFromRecovery(snapshot: snap, stats: noStats)
        let recs = try #require(c.recoveryEndedEarly)
        #expect(recs.count == 1)
        #expect(recs[0].prescribedSec == 60)
        #expect(recs[0].actualSec == 43)
        #expect(recs[0].phaseLabel == "Walk back")
    }

    /// The `Decisions.isEmpty` gate must count this new array — otherwise a
    /// run whose ONLY decision was a recovery ended early would snapshot as
    /// "nothing happened" and lose it to a crash anyway.
    @Test func decisionsCarryingOnlyAnEndedEarlyRecoveryAreNotEmpty() {
        let decisions = WorkoutEngine.RunSnapshot.Decisions(
            recoveryEndedEarly: [WorkoutEngine.RecoveryEndedEarlyRecord(
                afterRepIndex: 1, beforeRepIndex: 2, repCount: 2,
                prescribedSec: 60, actualSec: 43,
                phaseIndex: 1, phaseLabel: "Walk back", atSec: 224
            )]
        )
        #expect(decisions.isEmpty == false)
    }
}
