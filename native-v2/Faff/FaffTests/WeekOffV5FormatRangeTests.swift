//
//  WeekOffV5FormatRangeTests.swift
//  F078 (2026-09-14): `WeekOffV5.formatRange()` parsed the wire `fromISO` /
//  `toISO` strings with a UTC-anchored `DateFormatter`, correctly, but then
//  built the DISPLAYED string with a fresh `Calendar` and two `DateFormatter`s
//  that never had `timeZone` set — they silently fell back to the device's
//  local zone. For anyone west of UTC (all of the continental US) a UTC
//  midnight renders as the previous evening's local date, so a single-day
//  week-off with wire dates `"2026-09-14"` / `"2026-09-14"` rendered on
//  screen as "September 13 – 13": off by one day on BOTH ends.
//
//  The fix mirrors `RunLogV5`'s own formatter construction (that file's
//  `isoDayFormatter` / `displayFormatter` already set `timeZone = UTC` on
//  both ends) by adding the same `timeZone = UTC` assignment to the
//  previously-unanchored `Calendar` and both display `DateFormatter`s in
//  `WeekOffV5.formatRange()`. The parsing stage was already correct and is
//  untouched.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT THIS TEST CANNOT FAIL ON (Rule 22)
//
//  · Whether "September 14" is the best possible copy for a single-day
//    range — it pins the date value against the off-by-one regression, not
//    against a copy-review opinion.
//  · Whether the range actually RENDERS correctly on screen — only a
//    rendered screenshot answers that (Rule 13); this is the pure formatting
//    logic that feeds it, and it's isolated from view state on purpose so it
//    can be tested this way.
//  · Any other date formatter in the app. This is scoped to
//    `WeekOffV5.formatRange()` only.
//

import XCTest
@testable import Faff

final class WeekOffV5FormatRangeTests: XCTestCase {

    /// The exact repro from the finding: a single-day week-off block whose
    /// wire `fromISO`/`toISO` are both `"2026-09-14"` must render September
    /// 14 on both ends, not September 13 — regardless of the test machine's
    /// local timezone (this suite may run anywhere west of UTC).
    func testSingleDayRangeDoesNotShiftBackADay() {
        let result = WeekOffV5.formatRange(fromISO: "2026-09-14", toISO: "2026-09-14")
        XCTAssertEqual(result, "September 14 – 14")
        XCTAssertFalse(result.contains("13"), "regressed to the pre-fix off-by-one-day rendering")
    }

    /// A real multi-day block shifts by the same one day on both ends when
    /// this bug is present, so it still LOOKS internally coherent — exactly
    /// why the finding needed precise root-causing. Pin the correct anchor
    /// dates directly rather than relying on "looks plausible."
    func testMultiDayRangeAnchorsToWireDatesNotLocalShiftedOnes() {
        let result = WeekOffV5.formatRange(fromISO: "2026-09-30", toISO: "2026-10-06")
        XCTAssertEqual(result, "September 30 – October 6")
    }

    /// Same-month range still collapses to the "Month d – d" short form once
    /// the anchor dates are correct.
    func testSameMonthRangeUsesShortForm() {
        let result = WeekOffV5.formatRange(fromISO: "2026-08-18", toISO: "2026-08-24")
        XCTAssertEqual(result, "August 18 – 24")
    }
}
