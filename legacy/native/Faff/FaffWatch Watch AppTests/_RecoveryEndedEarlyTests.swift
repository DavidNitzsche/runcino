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

    // MARK: - 6 · WALKBACK-SESSIONEND-1 (2026-09-09) · the last recovery,
    // ended because the SESSION ended, not because the runner chose to
    // advance to something else.
    //
    // THE REGRESSION. `endCurrentPhase()` recorded `recordRecoveryEndedEarlyIfApplicable()`
    // BEFORE `advance()` ever checked `currentIndex + 1 >= workout.phases.count`
    // — the exact predicate that decides whether the plan is complete. So the
    // plan's FINAL recovery (the walk-back after the last stride, with
    // nothing left to advance to) got a `RecoveryEndedEarlyRecord` exactly
    // like any genuine mid-session early end, and the phone rendered
    // "0:43 of 1:00 · advanced early" for a runner who had simply finished
    // his workout. David: "Specifically test the final recovery after the
    // last stride. It must not be falsely described as a normal mid-session
    // advance if the runner simply ended the completed workout."

    /// Fixture: work(180s) → recovery(60s) — the recovery IS the plan's
    /// LAST phase. Exactly David's "final walk-back after the last stride."
    private func lastRecoveryWorkout() -> WatchWorkout {
        let phases = [
            WatchPhase(index: 0, type: .work, label: "Stride 6", durationSec: 180,
                       targetPaceSPerMi: 391, tolerancePaceSPerMi: 10, haptic: .transitionWork),
            WatchPhase(index: 1, type: .recovery, label: "Walk back", durationSec: 60,
                       targetPaceSPerMi: nil, tolerancePaceSPerMi: nil, haptic: .transitionRecovery),
        ]
        return WatchWorkout(workoutId: "session-end-fixture", name: "R", summary: "r",
                            totalEstimatedMinutes: 4, phases: phases,
                            completionEndpoint: "/x", expiresAt: "2099-01-01T00:00:00Z")
    }

    /// THE EXACT CASE DAVID ASKED FOR. Ending the final walk-back early must
    /// record a `SessionEndedRecord`, never a `RecoveryEndedEarlyRecord` —
    /// this is the fail-before/pass-after case: reverting
    /// `endCurrentPhase()`'s `endsSession` computation back to the
    /// unconditional `recordRecoveryEndedEarlyIfApplicable()` call this
    /// replaced makes this test fail with a populated `recoveryEndedEarly`
    /// and a nil `sessionEnded` — confirmed by hand against the pre-fix
    /// code per Rule 18 before this test was written to pass.
    @Test func endingTheFinalWalkBackEarlyRecordsSessionEndedNotAdvancedEarly() throws {
        let (engine, tracker) = newRig(lastRecoveryWorkout())
        engine.start()
        tracker.setFixture(pace: 391, hr: 165, cadence: 182, distanceMi: 0)

        simulate(engine, seconds: 181)   // finish the last stride, enter the final walk-back
        #expect(engine.currentPhase?.type == .recovery)

        simulate(engine, seconds: 8)     // 8 of the modelled 60 seconds
        engine.endCurrentPhase()         // "Go now" — with nothing left to advance to
        #expect(engine.planComplete, "the plan's last phase just ended — nothing left to run")

        engine.abandon()
        let c = try #require(engine.completion)

        // THE FIX: no `RecoveryEndedEarlyRecord` for this phase — "early"
        // relative to nothing is not a fact this record may state.
        #expect(c.recoveryEndedEarly == nil,
                "the last recovery ending because the session is over is not an 'ended early, by choice' fact")

        // Instead, an explicit `SessionEnded` record naming this as the
        // plan's last phase.
        let s = try #require(c.sessionEnded)
        #expect(s.wasLastPrescribedPhase == true)
        #expect(s.phaseType == "recovery")
        #expect(s.phaseIndex == 1)
        #expect(s.phaseLabel == "Walk back")
        #expect(s.elapsedSecInPhase == 8)
        #expect(s.prescribedSecInPhase == 60)
        engine.reset()
    }

    /// THE ASYMMETRY THIS MUST NOT CREATE. The ORDINARY mid-session case —
    /// a walk-back ended early with a rep still to come — is untouched:
    /// still a `RecoveryEndedEarlyRecord`, never a `SessionEndedRecord`.
    @Test func ordinaryMidSessionEarlyAdvanceCarriesNoSessionEndedRecord() throws {
        let (engine, tracker) = newRig(recoveryWorkout())   // work → recovery → work
        engine.start()
        tracker.setFixture(pace: 391, hr: 165, cadence: 182, distanceMi: 0)
        simulate(engine, seconds: 181)
        simulate(engine, seconds: 43)
        engine.endCurrentPhase()
        #expect(engine.currentPhase?.type == .work, "advanced into rep 2 — something genuinely WAS next")
        #expect(!engine.planComplete)

        engine.abandon()
        let c = try #require(engine.completion)
        let recs = try #require(c.recoveryEndedEarly)
        #expect(recs.count == 1, "the ordinary case is unaffected by this fix")
        #expect(c.sessionEnded == nil, "there was a next phase to advance to — this was not a session end")
        engine.reset()
    }

    /// The record survives a crash, same discipline as every other wrist
    /// decision (RunSnapshot round trip).
    @Test func sessionEndedSurvivesACrash() throws {
        let w = lastRecoveryWorkout()
        let decisions = WorkoutEngine.RunSnapshot.Decisions(
            sessionEnded: WorkoutEngine.SessionEndedRecord(
                phaseIndex: 1, phaseLabel: "Walk back", phaseType: "recovery",
                elapsedSecInPhase: 8, prescribedSecInPhase: 60, atSec: 188,
                wasLastPrescribedPhase: true
            )
        )
        let snap = WorkoutEngine.RunSnapshot(
            workoutId: w.workoutId,
            workoutJSON: (try? JSONEncoder().encode(w)) ?? Data(),
            startedAtEpoch: Date().timeIntervalSince1970 - 300,
            currentIndex: 1,
            planComplete: true,
            bankedSec: 180,
            phaseElapsedSec: 8,
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
        let s = try #require(c.sessionEnded)
        #expect(s.wasLastPrescribedPhase == true)
        #expect(s.elapsedSecInPhase == 8)
        #expect(s.prescribedSecInPhase == 60)
        #expect(c.recoveryEndedEarly == nil)
    }

    /// The `Decisions.isEmpty` gate must count this new field too — a run
    /// whose ONLY decision was the session ending on a short last recovery
    /// must not snapshot as "nothing happened" and lose it to a crash.
    @Test func decisionsCarryingOnlyASessionEndedRecordAreNotEmpty() {
        let decisions = WorkoutEngine.RunSnapshot.Decisions(
            sessionEnded: WorkoutEngine.SessionEndedRecord(
                phaseIndex: 1, phaseLabel: "Walk back", phaseType: "recovery",
                elapsedSecInPhase: 8, prescribedSecInPhase: 60, atSec: 188,
                wasLastPrescribedPhase: true
            )
        )
        #expect(decisions.isEmpty == false)
    }
}
