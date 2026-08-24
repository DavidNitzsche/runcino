//
//  _SplitsDecompositionTests.swift
//  FaffTests
//
//  A split array must add up to the run it sits under.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE DEFECT
//
//  `perMileSplits` used to close the gap between its last GPS fix and the
//  watch stopping with a synthetic trailing split whose `distanceMi` was
//
//      tailDistMi = Double(tailSecs) / Double(avgPaceSecPerMi)
//
//  chosen — its own comment said so — "so that pace × distanceMi = tailSecs
//  exactly", which zeroed a server-side deltaS check. That check has since
//  been replaced by `splitTimesReliable`, which tolerates an uncounted tail
//  by design, and what the reverse-engineering left behind was a DURATION
//  sitting in a distance field.
//
//  On 2026-08-23 the runner spent 392 s stopped (elapsed 5298 s against a
//  moving clock the row itself disproves). Divided by the run's 446 s/mi
//  average that became 0.879 mi of running that never happened, and run
//  detail drew twelve mile rows totalling 11.88 mi under an 11.01 mi
//  heading.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE NUMBERS BELOW ARE PRODUCTION ROWS
//
//  Measured over `faff_readonly` on 2026-08-24, not invented for the test.
//  102 rows carry splits with readable distances; 39 do not sum to their own
//  run. Twenty-six of those are the trailing-split defect and every one of
//  them lands EXACTLY on its run's distance once the residual is measured
//  rather than modelled. Thirteen are the other shape — GPS integrating
//  whole miles the run does not contain — and cannot be repaired by any
//  arithmetic, only refused.
//
import XCTest
@testable import Faff

final class SplitsDecompositionTests: XCTestCase {

    private typealias Verdict = HealthKitImporter.SplitsVerdict

    /// Residual for a `.tail`, or nil for any other verdict.
    private func tail(_ v: Verdict) -> Double? {
        if case .tail(let mi) = v { return mi }
        return nil
    }

    // ── THE TRAILING-SPLIT DEFECT · 26 production rows ────────────────────

    func testTrailingSplitCarriesTheMeasuredResidualNotADuration() throws {
        // 2026-08-23. Eleven whole miles crossed on an 11.01 mi run. The old
        // code appended 0.879 mi here — 392 stopped seconds at the run's
        // average pace. The remainder is one hundredth of a mile.
        let v = HealthKitImporter.splitsVerdict(milesCrossed: 11, workoutMiles: 11.01)
        XCTAssertEqual(try XCTUnwrap(tail(v)), 0.01, accuracy: 1e-9)

        // And the array now sums to the run, which is the whole claim.
        let residual = try XCTUnwrap(tail(v))
        XCTAssertEqual(11.0 + residual, 11.01, accuracy: 1e-9)
    }

    func testEveryTrailingDefectRowNowSumsToItsRun() throws {
        // (milesCrossed, workoutMiles, what the old code stored as the tail)
        // Every row here is real, and `old` is the fabricated distance the
        // row actually carries in production today.
        let rows: [(Int, Double, Double)] = [
            (11, 11.01, 0.8789),   // 2026-08-23 · the incident
            (12, 12.37, 0.6413),   // 2026-08-09
            (8,   8.02, 0.4109),   // 2026-07-14
            (7,   7.56, 1.0152),   // 2026-07-07 · a tail over a full mile
            (14, 14.02, 0.6811),   // 2026-06-27
            (13, 13.15, 0.4280),   // 2026-06-21
            (13, 13.13, 0.5826),   // 2026-06-14
            (7,   7.50, 0.7736),   // 2026-06-16
            (7,   7.41, 0.7271),   // 2026-06-02
            (7,   7.76, 1.0427),   // 2026-06-04 · another over a full mile
            (9,   9.14, 0.5062),   // 2026-08-21
            (7,   7.21, 0.7755),   // 2026-07-22
            (18, 18.00, 0.8930),   // 2026-07-25 · a flush 18, tail is pure invention
        ]
        for (crossed, miles, old) in rows {
            let v = HealthKitImporter.splitsVerdict(milesCrossed: crossed, workoutMiles: miles)
            switch v {
            case .tail(let residual):
                XCTAssertEqual(Double(crossed) + residual, miles, accuracy: 1e-9,
                               "\(crossed) miles + residual must equal \(miles)")
                XCTAssertLessThan(residual, old,
                                  "the measured residual must be smaller than the \(old) mi the old code modelled")
            case .none:
                // A flush run: the remainder is under a hundredth of a mile,
                // so nothing is emitted and the array already sums.
                XCTAssertEqual(Double(crossed), miles, accuracy: 0.01)
            case .refuse:
                XCTFail("\(crossed) whole miles on a \(miles) mi run is sound and must not be refused")
            }
        }
    }

    func testAFlushRunEmitsNoTrailingSplitRatherThanAZeroMileRow() {
        // 18 miles crossed on an 18.00 mi run. The residual is zero, and the
        // old code still appended 0.893 mi. A row of nothing is not worth
        // drawing; a row of 0.893 invented miles is worse.
        XCTAssertEqual(HealthKitImporter.splitsVerdict(milesCrossed: 18, workoutMiles: 18.0), .none)
    }

    // ── THE GPS-INTEGRATION DEFECT · 13 production rows ───────────────────

    func testGpsMilesTheRunDoesNotContainAreRefused() {
        // 2026-08-01, both rows. Four whole miles integrated from GPS jitter
        // on a 1.34 mi run; three on a 0.84 mi run. The first "mile" of the
        // 0.84 clocked 2:14 beside a cadence of 458 spm. A run cannot hold
        // more whole miles than its own distance.
        XCTAssertEqual(HealthKitImporter.splitsVerdict(milesCrossed: 4, workoutMiles: 1.34), .refuse)
        XCTAssertEqual(HealthKitImporter.splitsVerdict(milesCrossed: 3, workoutMiles: 0.84), .refuse)
        // 2026-06-19 · 7 whole miles claimed on 6.45. Milder, still refused.
        XCTAssertEqual(HealthKitImporter.splitsVerdict(milesCrossed: 7, workoutMiles: 6.45), .refuse)
        // 2026-07-12 · 13 on 12.60.
        XCTAssertEqual(HealthKitImporter.splitsVerdict(milesCrossed: 13, workoutMiles: 12.60), .refuse)
    }

    func testAHairOfGpsOvershootIsKeptRatherThanRefused() {
        // Real rows again, and the reason the tolerance is not zero. GPS
        // smoothing puts these a few hundredths past the workout's own
        // distance; the array still decomposes the run to well inside the
        // quarter mile the reader allows, so refusing them would throw away
        // good miles over rounding.
        //
        // 2026-08-11 · 6 crossed on 5.97. 2026-07-10 · 5 on 4.96.
        XCTAssertEqual(HealthKitImporter.splitsVerdict(milesCrossed: 6, workoutMiles: 5.97), .none)
        XCTAssertEqual(HealthKitImporter.splitsVerdict(milesCrossed: 5, workoutMiles: 4.96), .none)
        // 2026-08-03 · 6 on 5.77, the widest kept. 0.23 mi, inside 0.25.
        XCTAssertEqual(HealthKitImporter.splitsVerdict(milesCrossed: 6, workoutMiles: 5.77), .none)
    }

    func testTheRefusalBoundaryIsTheReadersTolerance() {
        // Byte-identical to MAX_SPLIT_SUM_DRIFT_MI in
        // web-v2/lib/runs/coherence.ts. The writer and the reader must not
        // disagree about what "decomposes the run" means, or this side emits
        // arrays the other side then refuses.
        XCTAssertEqual(HealthKitImporter.maxSplitSumDriftMi, 0.25, accuracy: 1e-12)

        // Just inside · kept.
        XCTAssertEqual(HealthKitImporter.splitsVerdict(milesCrossed: 6, workoutMiles: 5.76), .none)
        // Just outside · refused.
        XCTAssertEqual(HealthKitImporter.splitsVerdict(milesCrossed: 6, workoutMiles: 5.74), .refuse)
    }

    // ── DEGENERATE INPUT ──────────────────────────────────────────────────

    func testNoDistanceToJudgeAgainstChangesNothing() {
        // A workout with no distance statistic cannot contradict its splits.
        // The check abstains rather than refusing, which is what the code did
        // before it existed.
        XCTAssertEqual(HealthKitImporter.splitsVerdict(milesCrossed: 5, workoutMiles: 0), .none)
        XCTAssertEqual(HealthKitImporter.splitsVerdict(milesCrossed: 0, workoutMiles: 0), .none)
    }

    func testASubMileRunCrossesNothingAndKeepsItsWholeDistance() throws {
        // No whole mile completed. There is nothing to refuse, and the
        // residual is the entire run.
        let v = HealthKitImporter.splitsVerdict(milesCrossed: 0, workoutMiles: 0.84)
        XCTAssertEqual(try XCTUnwrap(tail(v)), 0.84, accuracy: 1e-9)
        // `perMileSplits` still emits nothing here — it guards on a non-empty
        // full-mile array — so a sub-mile run keeps its old behaviour of no
        // splits at all. This asserts the arithmetic, not that a row appears.
    }
}
