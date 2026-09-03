//
//  TrendBarsHonestyTests.swift
//  faff.run iPhone · a chart may not overstate its own data.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE DEFECT THIS WAS WRITTEN AGAINST
//
//  Measured on the rendered Races screen, 2026-09-03. A projected finish
//  moving 3:19:43 to 3:30:13 — 5.2% — drew bar heights of 289 / 103 / 53 /
//  53 / 54 image pixels. The tallest bar was 5.4x the shortest, under a
//  caption that correctly read "Faster by 10m 30s over 4 days".
//
//  The cause was structural rather than a bad constant: min-max normalisation
//  maps the series MINIMUM to `barFloorFraction` and its MAXIMUM to full
//  height, so the drawn spread is a fixed 5.55x for EVERY series that clears
//  the padded domain's floor. A 3% move and a 300% move drew the same
//  picture. `domainFloorFraction` was meant to prevent exactly this and at
//  0.02 was too small to engage on anything real.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS TESTS A PROPERTY AND NOT THE TWO CONSTANTS
//
//  Pinning `domainFloorFraction == 0.20` would only assert that somebody
//  typed 0.20. The property that actually matters is PROPORTIONALITY: a
//  series that moved a little must draw as a little movement. So these
//  measure the real `barHeight` the view draws with, across real series, and
//  assert the drawn spread tracks the underlying one.
//
//  That also means the constants can be retuned freely — the gate follows.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT THESE TESTS CANNOT FAIL ON (Rule 22)
//
//  · They measure BAR HEIGHTS ONLY. They say nothing about colour, the
//    highlighted-bar index, spacing, or whether the caption above the chart
//    agrees with the series — the last of which is a Rule 16 question and is
//    not checked anywhere.
//  · They cannot see whether the SERIES ITSELF is right. A chart drawn
//    faithfully from wrong numbers passes every assertion here.
//  · They assert an upper bound on exaggeration and a lower bound on
//    flatness. They do not assert the chart is READABLE — a change so small
//    it draws as no visible slope passes, because the honest rendering of a
//    quantity that barely moved is a flat chart, and the decision to withhold
//    it belongs to the server's `composeProjectionTrend`.
//

import XCTest
import SwiftUI
@testable import Faff

final class TrendBarsHonestyTests: XCTestCase {

    private let full: CGFloat = 96

    /// Tallest drawn bar over shortest drawn bar, for a series.
    private func drawnSpread(_ values: [Double]) -> CGFloat {
        let bars = TrendBars(values: values)
        let heights = values.map { bars.barHeight($0, in: full) }
        return heights.max()! / heights.min()!
    }

    /// The series' own relative movement — the thing the picture is supposed
    /// to be a picture of.
    private func realSpread(_ values: [Double]) -> Double {
        let lo = values.min()!, hi = values.max()!
        return (hi - lo) / ((hi + lo) / 2)
    }

    // MARK: - The measured case

    /// FAILS AGAINST THE PREVIOUS CODE at 5.55x.
    ///
    /// The exact shape read off the rendered screen: a projected finish
    /// falling 3:19:43 (11983s) to 3:30:13 (12613s), holding for three days.
    func testTheFivePercentCaseDoesNotDrawAsACliff() {
        let series: [Double] = [12613, 12240, 11983, 11983, 11990]
        let real = realSpread(series)
        let drawn = drawnSpread(series)
        XCTAssertEqual(real, 0.052, accuracy: 0.004,
                       "fixture drifted · this is meant to be the measured 5.2% case")
        XCTAssertLessThan(drawn, 2.0,
            "a \(String(format: "%.1f", real * 100))% change draws with a "
            + "\(String(format: "%.2f", drawn))x bar spread · it was 5.4x on the "
            + "rendered screen and that is the defect")
    }

    // MARK: - The property, across the range

    /// A small real change may not draw as a large one, at any magnitude.
    ///
    /// The bound is deliberately generous — a chart is allowed to amplify, or
    /// nothing small would ever be visible. What it may not do is amplify
    /// WITHOUT LIMIT, which is what a fixed min-max mapping does.
    func testDrawnSpreadTracksRealSpread() {
        // relative movement -> the most exaggeration allowed
        let cases: [(Double, CGFloat)] = [
            (0.01, 1.35),   // 1%
            (0.05, 2.00),   // 5%  · the measured case
            (0.10, 2.90),   // 10%
        ]
        for (move, limit) in cases {
            let base = 12000.0
            let series = [base, base * (1 + move / 2), base * (1 + move)]
            let drawn = drawnSpread(series)
            XCTAssertLessThan(drawn, limit,
                "a \(Int(move * 100))% change draws with a \(String(format: "%.2f", drawn))x "
                + "spread, over the \(limit)x this size of change may claim")
            XCTAssertGreaterThan(drawn, 1.0,
                "a \(Int(move * 100))% change draws completely flat · the chart has "
                + "stopped carrying information rather than stopped exaggerating")
        }
    }

    /// A genuinely large move must still fill the chart. Without this, the
    /// fix for exaggeration could be "flatten everything", which trades one
    /// dishonesty for another.
    func testALargeMoveStillFillsTheChart() {
        let series: [Double] = [12000, 13800, 15600]   // 30%
        let drawn = drawnSpread(series)
        XCTAssertGreaterThan(drawn, 3.0,
            "a 30% change draws with only a \(String(format: "%.2f", drawn))x spread · "
            + "the chart has gone flat on a move that genuinely matters")
    }

    /// A series that does not move draws flat, not as a broken chart and not
    /// as an invented trend. This is the behaviour the original padding was
    /// written for and it must survive the retune.
    func testAFlatSeriesDrawsFlat() {
        let series: [Double] = [12000, 12000, 12000, 12000]
        XCTAssertEqual(drawnSpread(series), 1.0, accuracy: 0.001,
                       "identical values must draw identical bars")
        let bars = TrendBars(values: series)
        let h = bars.barHeight(12000, in: full)
        XCTAssertGreaterThan(h, full * 0.25,
            "a flat series collapsed to \(h)pt of \(full) · it reads as a broken chart")
        XCTAssertLessThan(h, full * 0.85,
            "a flat series drew at \(h)pt of \(full) · it reads as a maxed-out one")
    }

    /// Every bar stays visible. A datum drawn at zero height is a missing
    /// datum, not a small one.
    func testNoBarIsInvisible() {
        for series in [[12613.0, 12240, 11983, 11983, 11990],
                       [1.0, 100.0],
                       [12000.0, 12000.0]] {
            let bars = TrendBars(values: series)
            for v in series {
                XCTAssertGreaterThanOrEqual(bars.barHeight(v, in: full), 2,
                    "a bar for \(v) drew below the 2pt visibility floor")
            }
        }
    }
}
