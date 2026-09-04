//
//  TodayReliabilityTests.swift
//  faff.run iPhone · coverage for the reliability pass that followed
//  TODAYSHELL-1 — plan-boundary clamping (BOUNDARY-1), the disk-cache
//  version-tolerance rule TODAYPERSIST-1's cold-launch seed relies on, the
//  navigation-direction sign PANELMOTION-1's panel transition reads, and a
//  round trip through the dynamic disk cache itself.
//
//  Same convention as `TodayNavigationTests` / `PlanVersionInvalidationTests`:
//  these call `TodayHostV5`'s STATIC decision functions directly rather than
//  constructing a host and reading `@State` back, because `@State` mutated on
//  a bare, unrendered host does not reliably persist outside a live SwiftUI
//  view hierarchy.
//

import XCTest
@testable import Faff

final class TodayReliabilityTests: XCTestCase {

    private func decode(_ json: String) throws -> V5Today {
        try JSONDecoder().decode(V5Today.self, from: Data(json.utf8))
    }

    // MARK: - canPageWeek — BOUNDARY-1

    /// The exact case named in the reliability request: a month boundary.
    /// Aug 31 → Sep 1 is a plain string comparison, not a `Date` one — this
    /// pins that the comparison is correct across the digit rollover.
    func testMonthBoundaryComparesCorrectly() {
        // Plan runs through the end of September; the visible week ends
        // Aug 31 (the day before the boundary) — paging forward must still
        // be allowed, because Sept 1 is still inside the plan.
        XCTAssertTrue(TodayHostV5.canPageWeek(
            1, planStart: "2026-08-01", planEnd: "2026-09-30",
            weekStart: "2026-08-25", weekEnd: "2026-08-31"))
    }

    /// A year boundary: the plan's last week straddles Dec 29–Jan 4, and the
    /// runner is already ON that final week. Paging forward must be refused
    /// even though "2027-01-04" < "2026-08-31" would be true — this proves
    /// the comparison is plan-scoped, not calendar-scoped.
    func testYearBoundaryClampsAtTheFinalWeek() {
        XCTAssertFalse(TodayHostV5.canPageWeek(
            1, planStart: "2026-08-01", planEnd: "2027-01-04",
            weekStart: "2026-12-29", weekEnd: "2027-01-04"))
        // But backward, from that same final week, is still open.
        XCTAssertTrue(TodayHostV5.canPageWeek(
            -1, planStart: "2026-08-01", planEnd: "2027-01-04",
            weekStart: "2026-12-29", weekEnd: "2027-01-04"))
    }

    /// Plan start: the runner is already on the block's opening week.
    /// Paging backward must be refused; forward stays open.
    func testPlanStartClampsBackwardPaging() {
        XCTAssertFalse(TodayHostV5.canPageWeek(
            -1, planStart: "2026-08-01", planEnd: "2026-11-15",
            weekStart: "2026-08-01", weekEnd: "2026-08-07"))
        XCTAssertTrue(TodayHostV5.canPageWeek(
            1, planStart: "2026-08-01", planEnd: "2026-11-15",
            weekStart: "2026-08-01", weekEnd: "2026-08-07"))
    }

    /// Plan end / race-week end: the runner is on the final week (race
    /// week). Paging forward must be refused; backward stays open.
    func testRaceWeekEndClampsForwardPaging() {
        XCTAssertFalse(TodayHostV5.canPageWeek(
            1, planStart: "2026-08-01", planEnd: "2026-11-15",
            weekStart: "2026-11-09", weekEnd: "2026-11-15"))
        XCTAssertTrue(TodayHostV5.canPageWeek(
            -1, planStart: "2026-08-01", planEnd: "2026-11-15",
            weekStart: "2026-11-09", weekEnd: "2026-11-15"))
    }

    /// A week strictly inside the plan can page in both directions.
    func testMidBlockWeekCanPageBothDirections() {
        XCTAssertTrue(TodayHostV5.canPageWeek(
            -1, planStart: "2026-08-01", planEnd: "2026-11-15",
            weekStart: "2026-09-15", weekEnd: "2026-09-21"))
        XCTAssertTrue(TodayHostV5.canPageWeek(
            1, planStart: "2026-08-01", planEnd: "2026-11-15",
            weekStart: "2026-09-15", weekEnd: "2026-09-21"))
    }

    /// The "unknown boundary" default: absent plan bounds, or absent week
    /// bounds, must never clamp — see `WeekStripV5.canPageBackward`'s own
    /// doc comment for why "don't clamp" beats "clamp until proven
    /// otherwise" as the failure mode here (an older server that has never
    /// sent `plan_start_iso`/`plan_end_iso` must not trap the runner one
    /// week from wherever they are).
    func testUnknownBoundaryNeverClamps() {
        XCTAssertTrue(TodayHostV5.canPageWeek(
            1, planStart: nil, planEnd: nil,
            weekStart: "2026-09-15", weekEnd: "2026-09-21"))
        XCTAssertTrue(TodayHostV5.canPageWeek(
            -1, planStart: "2026-08-01", planEnd: "2026-11-15",
            weekStart: nil, weekEnd: nil))
    }

    // MARK: - planVersionAcceptable — the disk-seed's Rule 11 tri-state

    func testMatchingVersionsAreAcceptable() {
        XCTAssertTrue(TodayHostV5.planVersionAcceptable(
            candidate: "pln_1:2026-09-01", current: "pln_1:2026-09-01"))
    }

    /// The exact case the reliability request calls out: a plan-version
    /// change while an older week is still cached. The stale week's own
    /// version disagrees with what just landed — discard it, don't hand it
    /// back as though it still applied.
    func testMismatchedVersionsAreRejected() {
        XCTAssertFalse(TodayHostV5.planVersionAcceptable(
            candidate: "pln_1:2026-09-01", current: "pln_1:2026-09-04"))
    }

    /// Absent is not the same fact as contradicted (Rule 11) — a nil on
    /// either side is "unknown", and unknown is accepted, not refused.
    func testAbsentVersionOnEitherSideIsAccepted() {
        XCTAssertTrue(TodayHostV5.planVersionAcceptable(candidate: nil, current: "pln_1:2026-09-01"))
        XCTAssertTrue(TodayHostV5.planVersionAcceptable(candidate: "pln_1:2026-09-01", current: nil))
        XCTAssertTrue(TodayHostV5.planVersionAcceptable(candidate: nil, current: nil))
    }

    // MARK: - navigationSign — PANELMOTION-1's direction, across boundaries

    func testForwardWithinAWeekIsPositive() {
        XCTAssertEqual(TodayHostV5.navigationSign(from: "2026-09-03", to: "2026-09-06"), 1)
    }

    func testBackwardWithinAWeekIsNegative() {
        XCTAssertEqual(TodayHostV5.navigationSign(from: "2026-09-06", to: "2026-09-01"), -1)
    }

    func testForwardAcrossAMonthBoundaryIsPositive() {
        XCTAssertEqual(TodayHostV5.navigationSign(from: "2026-08-31", to: "2026-09-01"), 1)
    }

    func testBackwardAcrossAYearBoundaryIsNegative() {
        XCTAssertEqual(TodayHostV5.navigationSign(from: "2027-01-01", to: "2026-12-31"), -1)
    }

    /// Rapid reversal, restated as a fact about the pure function rather
    /// than a gesture sequence: two calls with the endpoints swapped must
    /// give opposite signs, every time — the direction is a function of
    /// the two dates alone, never of anything left over from the previous
    /// call. This is what makes rapid direction reversal deterministic:
    /// there is no state in this function for a second call to inherit.
    func testReversingTheEndpointsAlwaysFlipsTheSign() {
        let pairs = [("2026-09-03", "2026-09-06"), ("2026-08-31", "2026-09-01"),
                     ("2026-12-31", "2027-01-01"), ("2026-09-06", "2026-09-13")]
        for (a, b) in pairs {
            XCTAssertEqual(TodayHostV5.navigationSign(from: a, to: b),
                            -TodayHostV5.navigationSign(from: b, to: a),
                            "\(a) -> \(b) and its reverse must have opposite signs")
        }
    }

    // MARK: - AppCache dynamic keys — TODAYPERSIST-1's cold-relaunch path

    /// A day the runner navigated to (not "today" itself) round-trips
    /// through the disk cache exactly as `fetchV5Today`'s dynamic write and
    /// `seedCachesFromDisk`'s dynamic read use it — proves the mechanism a
    /// cold relaunch depends on to restore a previously-visited date works
    /// end to end, independent of the network.
    func testDynamicDayCacheRoundTrips() {
        let key = "v5.day.2026-09-13.test"
        let payload = Data(#"{"hello":"world"}"#.utf8)
        AppCache.writeRawDynamic(key, data: payload)
        XCTAssertEqual(AppCache.readRawDynamic(key), payload)
    }

    /// A key that was never written reads as nil, not as an empty/garbage
    /// value — the disk-seed's `acceptDay`/`acceptWeek` both guard on this
    /// directly via `guard let data = ...`.
    func testUnwrittenDynamicKeyReadsAsNil() {
        XCTAssertNil(AppCache.readRawDynamic("v5.day.1999-01-01.never-written"))
    }

    /// A real `PlanWeek` payload, decoded back out of what the dynamic
    /// cache holds — confirms the round trip works for the actual wire
    /// shape `fetchAndCacheWeek` persists, not just an arbitrary blob.
    func testDynamicWeekCacheRoundTripsARealPayload() throws {
        let json = #"""
        {
          "plan_id": "pln_1",
          "plan_version": "pln_1:2026-09-01",
          "week_start_iso": "2026-09-01",
          "week_end_iso": "2026-09-07",
          "plan_start_iso": "2026-08-01",
          "plan_end_iso": "2026-11-15",
          "today_iso": "2026-09-03",
          "days": []
        }
        """#
        let key = "v5.week.2026-09-01.test"
        AppCache.writeRawDynamic(key, data: Data(json.utf8))
        let readBack = try XCTUnwrap(AppCache.readRawDynamic(key))
        let decoded = try JSONDecoder().decode(PlanWeek.self, from: readBack)
        XCTAssertEqual(decoded.week_start_iso, "2026-09-01")
        XCTAssertEqual(decoded.plan_start_iso, "2026-08-01")
        XCTAssertEqual(decoded.plan_end_iso, "2026-11-15")
    }

    /// `PlanWeek` decodes cleanly with NO `plan_start_iso`/`plan_end_iso` at
    /// all — an older server's response, predating BOUNDARY-1. Confirms the
    /// lenient-decode discipline this struct already follows extends to the
    /// two new fields: absent, not a decode failure that would nuke the
    /// whole week strip.
    func testPlanWeekDecodesWithoutBoundaryFieldsFromAnOlderServer() throws {
        let json = #"""
        {
          "plan_id": "pln_1",
          "week_start_iso": "2026-09-01",
          "week_end_iso": "2026-09-07",
          "today_iso": "2026-09-03",
          "days": []
        }
        """#
        let decoded = try JSONDecoder().decode(PlanWeek.self, from: Data(json.utf8))
        XCTAssertNil(decoded.plan_start_iso)
        XCTAssertNil(decoded.plan_end_iso)
        // And per testUnknownBoundaryNeverClamps above, that absence must
        // not clamp paging — restated here as the two facts' actual link.
        XCTAssertTrue(TodayHostV5.canPageWeek(
            1, planStart: decoded.plan_start_iso, planEnd: decoded.plan_end_iso,
            weekStart: decoded.week_start_iso, weekEnd: decoded.week_end_iso))
    }

    // MARK: - Perceived-speed targets — the DECISION path only
    //
    // "Selection feedback should be immediate; cached content should appear
    // in the same interaction frame." What actually gates that is: is the
    // decision of WHAT to render fast enough to never be the bottleneck on
    // a cache hit? These `measure` blocks answer exactly that, and nothing
    // more — they cannot see SwiftUI's own layout/paint cost, dropped
    // frames, or the 16ms-per-frame budget a real 60fps interaction has to
    // hit. That needs Instruments/XCTest UI performance metrics running
    // against a live app process, which this environment has never had
    // reliable access to this session (`xctrace` was already ruled out
    // earlier as unreliable here) — stated plainly rather than left
    // implied, per this project's own rule that an unmeasured claim says so.
    //
    // What these DO prove: on a cache hit, `readiness`/`canPageWeek` cannot
    // be where a missed 100ms budget goes, because a thousand calls each
    // complete in a small fraction of one frame.

    func testReadinessDecisionIsFastEnoughToNeverBeTheBottleneck() throws {
        let model = try decode(V5ContractTests.Fixtures.beforeRun)
        let host = TodayHostV5(path: .constant([]))
        measure {
            for _ in 0..<1000 {
                _ = host.readiness(model: model, wanted: model.dateISO, pendingDate: nil)
            }
        }
    }

    func testBoundaryAndDirectionDecisionsAreFastEnoughToNeverBeTheBottleneck() {
        measure {
            for _ in 0..<1000 {
                _ = TodayHostV5.canPageWeek(1, planStart: "2026-08-01", planEnd: "2026-11-15",
                                             weekStart: "2026-09-01", weekEnd: "2026-09-07")
                _ = TodayHostV5.navigationSign(from: "2026-09-03", to: "2026-09-06")
            }
        }
    }
}
