//
//  OpenEndedSessionTests.swift
//  Locks `WatchWorkout.isOpenEnded`, the predicate the watch engine's
//  `abandon()` uses to decide whether ending a run is a completion or a
//  runner cutting the plan short.
//
//  Before it existed, `abandon()` asked only `planComplete` — did the plan
//  run out first. For a just-run there is no plan to run out: it is one work
//  phase under a 24h ceiling placed there so the phase never ends on its own.
//  So every just-run came back stamped `abandoned`, its single work phase
//  recorded `completed: false`. Confirmed in prod — the one just-run on
//  record (2026-08-21, 9.14 mi) is also the ONLY `abandoned` row in the runs
//  table.
//
//  The engine lives in the watch target, which has no test bundle. This
//  target compiles the mirrored `WatchWorkout` in Faff/Models/Watch.swift,
//  so the predicate is testable here even though the caller is not — and
//  these also catch the two copies drifting apart, since a change made in
//  one file and not the other fails here.
//
import XCTest
@testable import Faff

final class OpenEndedSessionTests: XCTestCase {

    private func workout(id: String, phases: [WatchPhase]) -> WatchWorkout {
        WatchWorkout(workoutId: id, name: "W", summary: "S",
                     totalEstimatedMinutes: 30, phases: phases,
                     completionEndpoint: "/api/watch/workouts/complete",
                     expiresAt: "2099-12-31T00:00:00Z")
    }

    private func work(durationSec: Int, target: Int?) -> WatchPhase {
        WatchPhase(index: 0, type: .work, label: "Run", durationSec: durationSec,
                   targetPaceSPerMi: target, tolerancePaceSPerMi: nil, haptic: .start)
    }

    func test_theJustRunTheAppActuallyBuildsIsOpenEnded() {
        XCTAssertTrue(WatchWorkout.makeJustRun().isOpenEnded,
                      "makeJustRun is the shape this predicate exists for. If this fails, "
                      + "every just-run is being stamped `abandoned` again.")
    }

    func test_aPlannedEasyRunIsNot() {
        // expand-spec.ts expands easy/long/recovery to ONE work phase too, so
        // phase count cannot be what separates them — only the ceiling can.
        let easy = workout(id: "wko_abc", phases: [work(durationSec: 40 * 60, target: 537)])
        XCTAssertFalse(easy.isOpenEnded)
    }

    func test_aSingleWorkPhaseWithNoTargetButARealDurationIsNot() {
        // The by-feel case: no target pace, but the session still ends on its
        // own. This is the one a phases-count-plus-nil-target check would get
        // wrong, and the reason the 12h floor is in the predicate.
        let byFeel = workout(id: "wko_def", phases: [work(durationSec: 45 * 60, target: nil)])
        XCTAssertFalse(byFeel.isOpenEnded)
    }

    func test_aStructuredSessionIsNot() {
        XCTAssertFalse(WatchWorkout.sample.isOpenEnded)
    }

    func test_eitherSignalAloneCarriesIt() {
        // The id prefix is the contract the backend stores and both builders
        // emit; the shape check is what survives that prefix being renamed.
        // Each must stand on its own, or a rename silently regresses this.
        let prefixOnly = workout(id: "just-run-\(UUID().uuidString)",
                                 phases: [work(durationSec: 40 * 60, target: 537)])
        XCTAssertTrue(prefixOnly.isOpenEnded, "the id prefix alone must qualify")

        let shapeOnly = workout(id: "wko_renamed",
                                phases: [work(durationSec: 24 * 60 * 60, target: nil)])
        XCTAssertTrue(shapeOnly.isOpenEnded, "the open-ended shape alone must qualify")
    }
}
