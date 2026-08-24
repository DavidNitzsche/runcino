//
//  V5GaugeGeometryTests.swift
//  Two charts whose geometry told the runner something untrue.
//
//  Both were found by driving the screens on a simulator, not by reading the
//  code, and both are pure-function seams underneath a view — so the thing
//  that broke is testable even though the drawing is not.
//

import XCTest
import SwiftUI
@testable import Faff

final class V5PaceScaleTests: XCTestCase {

    /// `RangeScale` clamps its marker to [0, 1]. A pace outside the scale
    /// therefore pins to an edge and stops moving, above an endpoint label
    /// stating a range the runner is not in.
    ///
    /// The case that caught it, verified on screen 12a: a threshold session's
    /// RECOVERY phase targets 9:00 ± 20s, and the runner is jogging it at
    /// 7:32 — which is what a recovery jog looks like when it is too fast,
    /// the single most common way to be off-band on that phase.
    func testRecoveryJogRunTooFastStaysOnTheScale() {
        let band = LiveRunOutdoorV5.paceBand(
            phase: WatchPhase(index: 2, type: .recovery, label: "Recovery",
                              durationSec: 120, targetPaceSPerMi: 540,
                              tolerancePaceSPerMi: 20, haptic: .transitionRecovery))
        XCTAssertEqual(band?.low, 520)
        XCTAssertEqual(band?.high, 560)

        let scale = LiveRunOutdoorV5.paceScaleBounds(band: band, currentSecPerMi: 452)
        XCTAssertLessThan(scale.min, 452,
                          "7:32 sat left of an 8:00 scale minimum and the marker pinned")
        XCTAssertGreaterThan(scale.max, 452)
    }

    /// The general property, both directions, band and no-band.
    func testScaleAlwaysContainsTheCurrentPace() {
        let bands: [(low: Int, high: Int)?] = [
            nil,
            (low: 520, high: 560),      // recovery jog
            (low: 444, high: 460),      // threshold work
            (low: 400, high: 420),      // interval
            (low: 600, high: 660),      // easy, slow runner
        ]
        // 4:30/mi to 16:00/mi — an elite rep through a walk break.
        for current in stride(from: 270, through: 960, by: 10) {
            for band in bands {
                let s = LiveRunOutdoorV5.paceScaleBounds(band: band, currentSecPerMi: current)
                XCTAssertLessThan(s.min, Double(current),
                                  "scale min \(s.min) excluded pace \(current) for band \(String(describing: band))")
                XCTAssertGreaterThan(s.max, Double(current),
                                     "scale max \(s.max) excluded pace \(current) for band \(String(describing: band))")
                XCTAssertLessThan(s.min, s.max)
            }
        }
    }

    /// Widening for the runner must not shrink the band's own headroom — the
    /// band still has to be visible inside the scale.
    func testScaleStillContainsTheWholeBand() {
        for current in stride(from: 270, through: 960, by: 10) {
            let band = (low: 520, high: 560)
            let s = LiveRunOutdoorV5.paceScaleBounds(band: band, currentSecPerMi: current)
            XCTAssertLessThanOrEqual(s.min, Double(band.low))
            XCTAssertGreaterThanOrEqual(s.max, Double(band.high))
        }
    }

    /// No pace read yet (before the first GPS fix) still produces a usable
    /// scale rather than a degenerate one.
    func testNoCurrentPaceStillGivesAScale() {
        let s = LiveRunOutdoorV5.paceScaleBounds(band: (low: 520, high: 560), currentSecPerMi: nil)
        XCTAssertEqual(s.min, 480)
        XCTAssertEqual(s.max, 660)
    }
}

final class V5PhaseBarGeometryTests: XCTestCase {

    /// A 16-week block: Base 8 · Quality 4 · Race specific 3 · Taper 1.
    private let block: [PhaseSegment] = [
        PhaseSegment("Base", weeks: 8, current: true, at: 0.625),
        PhaseSegment("Quality", weeks: 4),
        PhaseSegment("Race specific", weeks: 3),
        PhaseSegment("Taper", weeks: 1),
    ]

    /// The names under the bar used `.frame(maxWidth: .infinity)`, giving every
    /// phase an EQUAL share while the bar above sized each by its weeks. On
    /// this block the bar read 50/25/19/6 and the names read 25/25/25/25, so
    /// "Taper" stood a third of the bar to the left of the sliver it names.
    ///
    /// A name has to start where its phase starts.
    func testEveryNameStartsWhereItsPhaseStarts() {
        let bar = PhaseBar(phases: block)
        let width: CGFloat = 350

        // The equal-share layout the bug produced, for contrast.
        let equalShare = width / CGFloat(block.count)

        var expected: CGFloat = 0
        for (idx, p) in block.enumerated() {
            XCTAssertEqual(bar.segmentStart(idx, in: width), expected, accuracy: 0.01)
            expected += width * CGFloat(Double(p.weeks) / 16.0)
        }

        // And the last two are exactly where the old layout got them wrong.
        XCTAssertEqual(bar.segmentStart(2, in: width), width * 0.75, accuracy: 0.01)
        XCTAssertNotEqual(bar.segmentStart(2, in: width), equalShare * 2, accuracy: 0.01)
        XCTAssertEqual(bar.segmentStart(3, in: width), width * 0.9375, accuracy: 0.01)
        XCTAssertNotEqual(bar.segmentStart(3, in: width), equalShare * 3, accuracy: 0.01)
    }

    /// A name's frame is its own segment's width, not one nth of the bar.
    func testNameWidthMatchesItsSegment() {
        let bar = PhaseBar(phases: block)
        let width: CGFloat = 350
        XCTAssertEqual(bar.segmentWidth(block[0], in: width), width * 0.5 - 2, accuracy: 0.01)
        XCTAssertEqual(bar.segmentWidth(block[3], in: width), width * 0.0625 - 2, accuracy: 0.01)
    }

    /// The starts are monotonic and the last one lands inside the bar — a
    /// phase list with an odd shape must not push a name off the end.
    func testStartsAreMonotonicAndInsideTheBar() {
        let shapes: [[PhaseSegment]] = [
            block,
            [PhaseSegment("Base", weeks: 1, current: true, at: 0.5)],
            [PhaseSegment("A", weeks: 1), PhaseSegment("B", weeks: 1)],
            [PhaseSegment("Base", weeks: 20), PhaseSegment("Taper", weeks: 2)],
        ]
        for phases in shapes {
            let bar = PhaseBar(phases: phases)
            let width: CGFloat = 350
            var last: CGFloat = -1
            for idx in phases.indices {
                let x = bar.segmentStart(idx, in: width)
                XCTAssertGreaterThan(x, last)
                XCTAssertLessThan(x, width)
                last = x
            }
        }
    }
}
