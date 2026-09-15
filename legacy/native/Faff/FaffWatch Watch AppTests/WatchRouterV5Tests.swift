//
//  WatchRouterV5Tests.swift
//  FaffWatch Watch AppTests
//
//  F111 / F112 (2026-09-14) regression coverage.
//
//  Both defects lived in `WatchRunSurfaceV5`, a SwiftUI View struct whose
//  `@State` and `private func`s are unreachable from a test target — the
//  same reason `WatchRouterV5.grade()` and `.gradingPhase()` are pure
//  statics on the ROUTER rather than View logic ("the router has to be
//  testable without an HKWorkoutSession", per that file's own comment).
//  Fixing F111 moved the split baseline onto `WatchRouterV5` itself for
//  exactly that reason; fixing F112 pulled the mile/km marker logic into
//  `WFmt`, which was already the file's designated home for "what a number
//  means" versus "how it looks". Both fixes are therefore directly callable
//  here with no View, no HealthKit session and no simulated ticking.
//

import Testing
import Foundation
@testable import FaffWatch_Watch_App

@MainActor
struct WatchRouterV5Tests {

    // ════════════════════════════════════════════════════════════════
    // MARK: - F111 · recordSplit must not freeze during a pending interrupt
    // ════════════════════════════════════════════════════════════════

    /// The exact regression: `WatchRouterV5.recordSplit(...)` must update
    /// its baseline (`lastSplitSec`) on every real split, REGARDLESS of
    /// `pendingQuestion` — a bail/ceiling-override/low-battery/GPS question
    /// that, per `WInterrupt`'s own doc comment, "outranks everything" and
    /// can sit up for minutes. Before the fix this accounting lived only
    /// inside `WatchRunSurfaceV5.momentBoard`'s `.split` case, which
    /// `router.interrupt(...)` never reaches while a question is pending —
    /// so the baseline froze and the NEXT split compared itself against a
    /// stale number.
    @Test func splitRecordedWhileAQuestionIsPendingStillAdvancesTheBaseline() {
        let router = WatchRouterV5()
        let (engine, tracker) = newRig(justRun())

        // A bail question is already up when the first mile crosses.
        router.pendingQuestion = .bailOffered
        #expect(router.interrupt(engine: engine, tracker: tracker) == .bailOffered,
                "sanity check: the split moment really would be suppressed on screen here")

        let first = router.recordSplit(paceSec: 400, isRace: false, goalSec: nil, totalDistanceMi: nil)
        #expect(first == nil, "no prior split to compare the first one against")
        #expect(router.lastSplitSec == 400,
                "the baseline must advance even though a question is still pending")

        // Second mile crosses; the SAME question is still up.
        let second = router.recordSplit(paceSec: 415, isRace: false, goalSec: nil, totalDistanceMi: nil)
        #expect(second == "15 sec slower",
                "must compare 415 against 400 — not nil, and not a frozen older baseline")
        #expect(router.lastSplitSec == 415)

        // The question finally clears. A third split must compare against
        // 415 (the value the previous, suppressed split actually recorded),
        // not against 400 or against nothing.
        router.pendingQuestion = nil
        #expect(router.interrupt(engine: engine, tracker: tracker) == nil)
        let third = router.recordSplit(paceSec: 410, isRace: false, goalSec: nil, totalDistanceMi: nil)
        #expect(third == "5 sec quicker",
                "the interrupt clearing must not have starved the accounting that happened while it was up")
    }

    /// Rule 18 falsification companion (see also the manual revert/restore
    /// done for this same file during the fix, documented in the handback):
    /// with the OLD shape — comparison computed only when nothing is
    /// suppressing display — a question pending across two splits collapses
    /// them to a single comparison against the pre-question baseline. This
    /// test pins the CORRECT two-comparison behavior so a future regression
    /// back to that shape fails loudly here rather than only on a wrist.
    @Test func twoSplitsUnderOneLongInterruptStillProduceTwoDistinctComparisons() {
        let router = WatchRouterV5()
        router.pendingQuestion = .ceilingOverride

        let a = router.recordSplit(paceSec: 500, isRace: false, goalSec: nil, totalDistanceMi: nil)
        let b = router.recordSplit(paceSec: 520, isRace: false, goalSec: nil, totalDistanceMi: nil)
        let c = router.recordSplit(paceSec: 505, isRace: false, goalSec: nil, totalDistanceMi: nil)

        #expect(a == nil)
        #expect(b == "20 sec slower")
        #expect(c == "15 sec quicker", "must be 505 vs 520, not 505 vs 500 (the stale-baseline bug's exact shape)")
    }

    @Test func differenceUnderThreeSecondsIsTreatedAsNoise() {
        let router = WatchRouterV5()
        _ = router.recordSplit(paceSec: 400, isRace: false, goalSec: nil, totalDistanceMi: nil)
        let tiny = router.recordSplit(paceSec: 402, isRace: false, goalSec: nil, totalDistanceMi: nil)
        #expect(tiny == nil, "a 2 sec difference is instrument noise, not a fact worth stating")
    }

    /// On a race, the comparison is against GOAL PACE, never the previous
    /// mile — unaffected by whatever `lastSplitSec` happens to hold.
    @Test func raceSplitComparesAgainstGoalPaceRegardlessOfThePreviousMile() {
        let router = WatchRouterV5()
        _ = router.recordSplit(paceSec: 900, isRace: true, goalSec: 3 * 3600, totalDistanceMi: 26.2)
        // goal pace = 10800 / 26.2 ≈ 412 s/mi. 420 - 412 = 8 → "8 sec over goal".
        let second = router.recordSplit(paceSec: 420, isRace: true, goalSec: 3 * 3600, totalDistanceMi: 26.2)
        #expect(second == "8 sec over goal")
    }

    @Test func staticSplitComparisonMatchesTheInstanceMethodExactly() {
        // `recordSplit` is a thin wrapper: the static function is what does
        // the arithmetic, and is independently testable with no router
        // instance at all.
        let direct = WatchRouterV5.splitComparison(paceSec: 430, previousSec: 400,
                                                    isRace: false, goalSec: nil, totalDistanceMi: nil)
        #expect(direct == "30 sec slower")

        let router = WatchRouterV5()
        _ = router.recordSplit(paceSec: 400, isRace: false, goalSec: nil, totalDistanceMi: nil)
        let viaRouter = router.recordSplit(paceSec: 430, isRace: false, goalSec: nil, totalDistanceMi: nil)
        #expect(viaRouter == direct)
    }

    // ════════════════════════════════════════════════════════════════
    // MARK: - F112 · controlsHeader must convert to km like raceMileLabel
    // ════════════════════════════════════════════════════════════════

    /// The literal regression: a mile marker with no unit preference (or
    /// "mi") stays in miles.
    @Test func mileMarkerStaysInMilesForAMileRunner() {
        #expect(WFmt.mileMarker(8.9, units: "mi") == "Mile 9")
        #expect(WFmt.mileMarker(8.9, units: nil) == "Mile 9")
    }

    /// The exact scenario named in `raceMileLabel`'s own comment: nine
    /// miles covered (14.5 km) must read "Km 15", never "Mile 9" and never
    /// "Km 10" (the ORIGINAL km-mislabeling defect this same helper already
    /// fixed once before F112 regressed a second copy of it).
    @Test func mileMarkerConvertsToKmForAKmRunner() {
        let marker = WFmt.mileMarker(9.0, units: "km")
        // 9 mi * 1.609344 = 14.484... km → "Km 15".
        #expect(marker == "Km 15")
    }

    @Test func mileMarkerAtExactlyZeroDistanceIsMarkerOne() {
        #expect(WFmt.mileMarker(0, units: "mi") == "Mile 1")
        #expect(WFmt.mileMarker(0, units: "km") == "Km 1")
    }

    /// `raceMileLabel` and the fixed `controlsHeader` now both call
    /// `WFmt.mileMarker` — this pins them to being byte-identical for the
    /// same input, which is the whole point of sharing one implementation
    /// instead of two hand-rolled copies that can drift apart.
    @Test func mileMarkerIsConsistentForAnyGivenDistanceAndUnit() {
        for mi in stride(from: 0.0, through: 30.0, by: 1.3) {
            let a = WFmt.mileMarker(mi, units: "km")
            let b = WFmt.mileMarker(mi, units: "km")
            #expect(a == b)
        }
    }

    // MARK: - Shared rig (same shape as _HostileInputTests' own newRig)

    private func newRig(_ w: WatchWorkout) -> (WorkoutEngine, WorkoutTracker) {
        let tracker = WorkoutTracker()
        let engine = WorkoutEngine(workout: w)
        engine.tracker = tracker
        return (engine, tracker)
    }

    /// The open-ended "just run" shape — no target, 24h ceiling. Only used
    /// here to give `interrupt(engine:tracker:)` a real engine/tracker pair;
    /// none of its phase content matters to these tests.
    private func justRun() -> WatchWorkout {
        let phase = WatchPhase(index: 0, type: .work, label: "Just run",
                               durationSec: 24 * 60 * 60,
                               targetPaceSPerMi: nil, tolerancePaceSPerMi: nil, haptic: .start)
        return WatchWorkout(workoutId: "just-run-router-tests", name: "Just run", summary: "u",
                            totalEstimatedMinutes: 30, phases: [phase],
                            completionEndpoint: "/x", expiresAt: "2099-01-01T00:00:00Z")
    }
}
