//
//  ActiveEnergyAggregationTests.swift
//  REQUESTSTORM-2 (2026-09-05) · the gate over `activeEnergyDailyRows`.
//
//  ──────────────────────────────────────────────────────────────────────────
//  WHAT THIS GATE CANNOT FAIL ON (Rule 22)
//
//  It is a PURE-FUNCTION gate and it is structurally blind to four things:
//
//    · Whether `activeEnergyDailyTotals` actually CALLS this function. A
//      future edit that queries HealthKit and appends buckets directly, next
//      to this function rather than through it, passes every case below.
//      Nothing here reads the call site.
//    · Whether the HealthKit query returns the right buckets in the first
//      place. It is handed an array; it never talks to HK.
//    · Whether the SERVER stores what the phone sends. The chunk-split
//      corruption this change exists for lived in the request boundary, and
//      that half is covered by web-v2's `active-energy-batch.test.ts`, not
//      here.
//    · The REQUEST COUNT. It cannot see that one import used to post 21
//      chunks; it only proves the row count per day is 1. The link between
//      "one row per day" and "one POST" is arithmetic stated in the source
//      comment, not something any case below measures.
//
//  What it CAN fail on is the thing that was actually wrong: emitting more
//  than one row per calendar day, losing energy in the sum, stamping the day
//  with the wrong instant, and turning "no data" into a measured zero.
//
//  FALSIFICATION RECORD (2026-09-05) · `activeEnergyDailyRows` was reverted to
//  the pre-fix shape — one VitalSample per bucket, as `activeEnergySamples`
//  did — and 7 of these 9 cases failed by name. The two that matter, verbatim:
//
//    testADaysBucketsCollapseToExactlyOneRow
//      XCTAssertEqual failed: ("1470") is not equal to ("1")
//      - 1,470 HK buckets in one day must produce ONE row. 1470 rows is the
//        request flood.
//
//    testTheDailyTotalIsTheWholeDayNotAFragment
//      XCTAssertEqual failed: ("Optional(1.0)") is not equal to
//      ("Optional(1000.0)") - The day's total must be the sum of every
//      bucket, not a fragment of it.
//
//  That second number is the production defect exactly: a day's whole energy
//  reduced to one bucket's worth. Restored, all 9 pass.
//

import XCTest
@testable import Faff

final class ActiveEnergyAggregationTests: XCTestCase {

    /// Fixed day key so these cases never depend on the device timezone.
    /// The production key is `isoDay`, pinned to America/Los_Angeles.
    private func dayKey(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    private func stamp(_ d: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: d)
    }

    private func rows(_ buckets: [(kcalValue: Double, start: Date)]) -> [HealthKitImporter.VitalSample] {
        HealthKitImporter.activeEnergyDailyRows(buckets: buckets, dayKey: dayKey, stamp: stamp)
    }

    /// 06:00 Pacific on the given day, plus `minutes`.
    ///
    /// Six, not noon: the 1,470-bucket case below steps forward in 30-second
    /// slices, which is 12h15m of wall clock, and anchoring at noon pushed the
    /// tail past midnight into the NEXT day. The gate caught that on its first
    /// run — as two rows where one was asserted — which is the assertion doing
    /// its job on the fixture rather than on the code, and worth leaving a note
    /// about: a day-boundary split is exactly what this function must never do
    /// silently.
    private func pt(_ iso: String, plusMinutes minutes: Double = 0) -> Date {
        var c = DateComponents()
        let parts = iso.split(separator: "-").map { Int($0)! }
        c.year = parts[0]; c.month = parts[1]; c.day = parts[2]; c.hour = 6
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        return cal.date(from: c)!.addingTimeInterval(minutes * 60)
    }

    // MARK: - The defect itself

    /// THE ONE THAT MATTERS. 1,470 buckets in a day — the real rate a worn
    /// Apple Watch emits at, and the number behind the owner's 21-POST
    /// import — must leave this function as ONE row.
    ///
    /// Falsified against the per-bucket shape: expected 1, got 1470.
    func testADaysBucketsCollapseToExactlyOneRow() {
        let buckets = (0..<1470).map { i in
            (kcalValue: 0.5, start: pt("2026-08-23", plusMinutes: Double(i) * 0.5))
        }
        let out = rows(buckets)
        XCTAssertEqual(out.count, 1,
                       "1,470 HK buckets in one day must produce ONE row. \(out.count) rows is the request flood.")
        XCTAssertEqual(out.first?.sample_date, "2026-08-23")
    }

    /// The energy must all still be there. The production symptom was 11.4
    /// kcal stored for a day the runner ran 11 miles, because only the last
    /// chunk's fragment survived — so a sum that silently drops buckets
    /// would reproduce the bug with the row count looking right.
    func testTheDailyTotalIsTheWholeDayNotAFragment() {
        let buckets = (0..<1000).map { i in
            (kcalValue: 1.0, start: pt("2026-08-23", plusMinutes: Double(i) * 0.5))
        }
        let out = rows(buckets)
        XCTAssertEqual(out.first?.value, 1000.0,
                       "The day's total must be the sum of every bucket, not a fragment of it.")
    }

    /// Days must not bleed into each other.
    func testTwoDaysProduceTwoRowsEachWithItsOwnTotal() {
        let out = rows([
            (kcalValue: 100, start: pt("2026-08-23")),
            (kcalValue: 50,  start: pt("2026-08-23", plusMinutes: 60)),
            (kcalValue: 7,   start: pt("2026-08-24")),
        ])
        XCTAssertEqual(out.count, 2)
        XCTAssertEqual(out.map(\.sample_date), ["2026-08-23", "2026-08-24"])
        XCTAssertEqual(out.map(\.value), [150.0, 7.0])
    }

    // MARK: - Rule 11 · no data is not a measured zero

    func testNoBucketsProducesNoRowRatherThanAZero() {
        XCTAssertTrue(rows([]).isEmpty,
                      "A day HK has nothing for must emit no row. A 0 would read as a measurement.")
    }

    func testADayOfOnlyZeroBucketsProducesNoRow() {
        let out = rows([
            (kcalValue: 0, start: pt("2026-08-23")),
            (kcalValue: 0, start: pt("2026-08-23", plusMinutes: 30)),
        ])
        XCTAssertTrue(out.isEmpty,
                      "HK's explicit idle-zero markers are not evidence the runner burned zero.")
    }

    /// A tiny real bucket is NOT a zero marker and must survive — the 0.05
    /// threshold that once dropped almost every real sample is the reason
    /// this case exists.
    func testASubKilocalorieBucketIsKept() {
        let out = rows([(kcalValue: 0.01, start: pt("2026-08-23"))])
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out.first?.value, 0.0,
                       "Rounds to one decimal, but the row exists — presence is the fact being asserted.")
    }

    // MARK: - The timestamp

    /// `recorded_at` must point at a moment the energy was spent, not at the
    /// sync. lib/runs/energy.ts deleted a whole tier over exactly this.
    func testRecordedAtIsTheDaysLatestBucketNotTheIngestInstant() {
        let early = pt("2026-08-23")
        let late  = pt("2026-08-23", plusMinutes: 300)
        let out = rows([
            (kcalValue: 10, start: late),
            (kcalValue: 10, start: early),
        ])
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out.first?.recorded_at, stamp(late),
                       "The day's stamp must be its latest bucket, whatever order HK returned them in.")
    }

    // MARK: - Shape

    func testRowsAreSortedByDateAndAllCarryTheActiveEnergyType() {
        let out = rows([
            (kcalValue: 5, start: pt("2026-08-25")),
            (kcalValue: 5, start: pt("2026-08-23")),
            (kcalValue: 5, start: pt("2026-08-24")),
        ])
        XCTAssertEqual(out.map(\.sample_date), ["2026-08-23", "2026-08-24", "2026-08-25"])
        XCTAssertTrue(out.allSatisfy { $0.sample_type == "active_energy" })
    }

    /// LIVENESS (Rule 18) · if `activeEnergyDailyRows` is ever renamed or
    /// stubbed to return nothing, every case above still "passes" its
    /// emptiness assertions. This one fails instead.
    func testTheFunctionUnderTestActuallyProducesRows() {
        XCTAssertFalse(rows([(kcalValue: 42, start: pt("2026-08-23"))]).isEmpty,
                       "The aggregator returned nothing for a well-formed bucket. Every other case here is now meaningless.")
    }
}
