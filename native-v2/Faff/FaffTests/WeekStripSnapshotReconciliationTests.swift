//
//  WeekStripSnapshotReconciliationTests.swift
//  faff.run iPhone · F029's own regression coverage.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE GAP THIS CLOSES
//
//  David hit this live, on two separate days, unprompted: a plan correction
//  (Thursday 9/17 moved quality→easy) rendered EASY on the day-detail card
//  and QUALITY (orange) on the week-strip cell directly above it — two
//  surfaces, one date, two different colours.
//
//  Root cause (see `TodayHostV5.stripDays(for:)`'s own F029 comment for the
//  full trace): a plan mutation refreshes `PlanSnapshotStore` alone
//  (`.onReceive(.faffPlanMutated)` calls only `syncPlanSnapshot()`), never
//  `surface.model` — and `stripDays(for:)` only ever consulted the snapshot
//  for a date OUTSIDE `model`'s already-loaded week, so a same-week
//  correction (the ordinary case) fell straight through to `model.weekStrip`
//  with no reconciliation at all. NOT the plan-version cache-eviction gap
//  originally suspected — `dayCache`/`weekCache` (`PLANVERSION-1`,
//  `WEEKCACHE-1`) were already evicting correctly; this was a client read
//  path that never consulted the fresher source in the first place.
//
//  These tests exercise `TodayHostV5.reconcileStripDayType`, the pure
//  function the fix factors the decision into — same reason
//  `PlanVersionInvalidationTests` calls `reconciledDayCache` directly rather
//  than reading `@State` off a bare, unrendered host.
//

import XCTest
@testable import Faff

final class WeekStripSnapshotReconciliationTests: XCTestCase {

    private func staleQualityCell(dateISO: String = "2026-09-17") -> WeekStripDayV5 {
        WeekStripDayV5(id: "date:\(dateISO)", dateISO: dateISO, letter: "T", number: "17",
                       state: .quality, isToday: false, isDone: false, isRest: false)
    }

    private func snapshotDay(dateISO: String = "2026-09-17", isQuality: Bool, isRest: Bool = false) -> PlanSnapshotDay {
        PlanSnapshotDay(plan_workout_id: "wko_\(dateISO)", date_iso: dateISO, dow: 4,
                        type: isQuality ? "Intervals" : "Easy", is_rest: isRest, is_race: false,
                        is_quality: isQuality, is_long: false, distance_mi: 5, sub_label: nil,
                        notes: nil, card: nil, treadmill: nil, matched_run: nil,
                        supplemental_runs: [], day_state: isRest ? "rest" : (isQuality ? "quality" : "easy"),
                        kicker: nil, dose: nil, stats: [])
    }

    private func snapshot(days: [PlanSnapshotDay]) -> PlanSnapshot {
        PlanSnapshot(plan_id: "pln_1", plan_version: "pln_1:2026-09-14T00:00:00-07:00",
                     plan_start_iso: "2026-09-01", plan_end_iso: "2026-12-01",
                     today_iso: "2026-09-16", synced_at: "2026-09-16T12:00:00-07:00", days: days)
    }

    /// THE BUG, REPRODUCED: a strip cell still carrying the pre-correction
    /// `.quality` state must be repainted `.easy` once the snapshot has the
    /// corrected day — exactly the disagreement David reported.
    func testCorrectedDayOverridesStaleQualityStateWithSnapshotsEasy() {
        let stale = staleQualityCell()
        let corrected = snapshot(days: [snapshotDay(isQuality: false)])

        let reconciled = TodayHostV5.reconcileStripDayType(stale, snapshot: corrected)

        XCTAssertEqual(reconciled.state, .easy, "the week-strip cell must repaint to match the corrected snapshot, not keep the pre-correction quality colour")
    }

    /// The negative case, so the test above isn't trivially satisfied by a
    /// function that always overrides: a snapshot that still agrees with the
    /// stale cell must leave it exactly as it was (no spurious churn).
    func testUnchangedSnapshotLeavesTheCellAlone() {
        let stillQuality = staleQualityCell()
        let unchangedSnapshot = snapshot(days: [snapshotDay(isQuality: true)])

        let reconciled = TodayHostV5.reconcileStripDayType(stillQuality, snapshot: unchangedSnapshot)

        XCTAssertEqual(reconciled.state, .quality)
    }

    /// A day the snapshot has no answer for (not yet synced, or outside its
    /// authored range) must degrade to whatever `model.weekStrip` already
    /// said — never blank, never a crash.
    func testDayMissingFromSnapshotFallsBackToTheOriginalCell() {
        let cell = staleQualityCell(dateISO: "2026-09-20")
        let snapshotWithoutThatDate = snapshot(days: [snapshotDay(dateISO: "2026-09-17", isQuality: false)])

        let reconciled = TodayHostV5.reconcileStripDayType(cell, snapshot: snapshotWithoutThatDate)

        XCTAssertEqual(reconciled.state, .quality, "no snapshot entry for this date must leave the cell exactly as model.weekStrip already had it")
    }

    /// No snapshot has ever synced at all (`nil`) — the ordinary case for a
    /// brand-new session before the first `syncPlanSnapshot()` lands. Must
    /// not crash and must not blank the cell.
    func testNilSnapshotLeavesTheCellAlone() {
        let cell = staleQualityCell()
        let reconciled = TodayHostV5.reconcileStripDayType(cell, snapshot: nil)
        XCTAssertEqual(reconciled.state, .quality)
    }

    /// A day-TYPE change is not the only thing a correction can do — a rest
    /// day turned into a real session (or vice versa) must also repaint,
    /// since `isRest` is what `WeekStripV5.rail(_:)` checks before it ever
    /// looks at `state` (`guard !d.isRest else { return .clear }`).
    func testRestFlagAlsoReconciles() {
        let cell = WeekStripDayV5(id: "date:2026-09-18", dateISO: "2026-09-18", letter: "F",
                                   number: "18", state: .rest, isToday: false, isDone: false, isRest: true)
        let noLongerRest = snapshot(days: [snapshotDay(dateISO: "2026-09-18", isQuality: false, isRest: false)])

        let reconciled = TodayHostV5.reconcileStripDayType(cell, snapshot: noLongerRest)

        XCTAssertFalse(reconciled.isRest, "a rest day promoted to a real session by a correction must stop drawing as rest")
        XCTAssertEqual(reconciled.state, .easy)
    }

    /// Scope check: completion (`isDone`) is deliberately NOT sourced from
    /// the snapshot (see `stripDays(for:)`'s own F029 comment for why —
    /// finishing a run is not one of `syncPlanSnapshot`'s triggers). A
    /// snapshot with no `matched_run` for a day `model` already knows is
    /// done must not un-mark it.
    func testCompletionIsNeverPulledFromTheSnapshot() {
        var doneCell = staleQualityCell()
        doneCell.isDone = true
        let snapshotSayingNotDone = snapshot(days: [snapshotDay(isQuality: false)])

        let reconciled = TodayHostV5.reconcileStripDayType(doneCell, snapshot: snapshotSayingNotDone)

        XCTAssertTrue(reconciled.isDone, "completion must keep reading model.weekStrip, not the snapshot")
        XCTAssertEqual(reconciled.state, .easy, "the type still reconciles even though completion does not")
    }
}
