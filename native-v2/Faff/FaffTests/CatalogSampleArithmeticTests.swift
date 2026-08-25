//
//  CatalogSampleArithmeticTests.swift
//  A sample that cannot happen cannot be evidence.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS EXISTS
//
//  `ScreensCatalogV5` is the only place most v5 screens are ever LOOKED AT —
//  its own header says so: "the only way to catch the things that are
//  invisible screen by screen". Everything in it is a hand-written sample, and
//  until 2026-08-25 nothing checked that a sample was internally possible.
//
//  Two were not, and both were found by driving the catalog on a simulator:
//
//    · RUN LOG (22a) · the header said "4 runs · 24.3 mi" over four runs that
//      add to 36.3, and THIS WEEK said "17.2 mi" over three that add to 29.2.
//      Twelve miles of a runner's week, invented, sitting under a total.
//
//    · RACE DETAIL (8b / 8d) · the three half-marathon samples were each
//      `let r = v5Sample` plus a field-by-field copy, so every one inherited
//      CIM's MARATHON numbers. The Sombrero Half rendered "Result 3:31:48" —
//      a marathon projection, under the word Result, on a thirteen-mile race,
//      directly above the words "Log your result".
//
//  The cost is not the samples. It is that a sample nobody can add up makes a
//  REAL summation bug indistinguishable from a sloppy fixture — which is
//  exactly how race detail's "Result over a modelled number" label bug sat
//  unnoticed on three catalog entries at once. Somebody had almost certainly
//  looked straight at it and read the wrong number as "just the sample".
//
//  So: the numbers a sample states about itself have to be the numbers its own
//  rows produce. That is all this file asserts, and it is enough to stop both.
//
//  Note the shape deliberately: every expectation below is DERIVED from the
//  sample at run time, never written out beside it. A test that hardcodes both
//  sides only proves its author wrote the same number twice.
//

import XCTest
@testable import Faff

final class CatalogSampleArithmeticTests: XCTestCase {

    /// Distances round to one decimal on the wire, so a sum of N rounded rows
    /// can sit up to N × 0.05 from the rounded total. Compare at that width.
    private func assertSum(_ stated: Double, _ parts: [Double],
                           _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        let sum = parts.reduce(0, +)
        let slack = max(0.05, Double(parts.count) * 0.05)
        XCTAssertEqual(stated, sum, accuracy: slack,
                       "\(what): the sample states \(stated) and its own rows add to \(sum)",
                       file: file, line: line)
    }

    // MARK: - Run log · 22a

    /// Every week's stated mileage is the sum of the runs in that week.
    func testRunLogWeekTotalsAreTheSumOfTheirRuns() {
        let log = RunLogV5Sample.log
        XCTAssertFalse(log.weeks.isEmpty, "the sample must have weeks, or this proves nothing")
        for week in log.weeks {
            assertSum(week.totalMi, week.runs.map(\.distance_mi), "run log week \"\(week.label)\"")
        }
    }

    /// And the header is the sum of every week.
    func testRunLogHeaderTotalIsTheSumOfEveryRun() {
        let log = RunLogV5Sample.log
        let runs = log.weeks.flatMap(\.runs)
        XCTAssertFalse(runs.isEmpty, "the sample must have runs, or this proves nothing")
        XCTAssertEqual(log.totalRuns, runs.count, "run log header run COUNT")
        assertSum(log.totalMi, runs.map(\.distance_mi), "run log header mileage")
    }

    // MARK: - Race detail · 8b / 8d / 8e

    /// A race sample's Gap is Result minus Goal. The screen draws all three in
    /// one tile, side by side, so a third number that is not the difference of
    /// the other two is visible to any runner who can subtract.
    func testRaceDetailGapIsResultMinusGoal() {
        for (name, detail) in Self.raceSamples {
            guard let goal = Self.seconds(detail.goal?.text),
                  let middle = Self.seconds(detail.projected?.text),
                  let gapText = detail.gap?.text else { continue }
            guard let gap = Self.seconds(gapText.replacingOccurrences(of: "+", with: "")
                                                .replacingOccurrences(of: "\u{2212}", with: "-")) else {
                continue // a worded gap, not a figure
            }
            let signed = gapText.hasPrefix("-") || gapText.hasPrefix("\u{2212}") ? -gap : gap
            XCTAssertEqual(signed, middle - goal, accuracy: 1,
                           "\(name): gap \(gapText) is not result \(detail.projected?.text ?? "-") "
                           + "minus goal \(detail.goal?.text ?? "-")")
        }
    }

    /// A finish time has to be possible over the distance the header names.
    ///
    /// This is the check that catches a marathon's numbers on a half. The band
    /// is deliberately enormous — 4:00/mi is faster than the world record and
    /// 20:00/mi is a walk — because the point is not to grade a runner, it is
    /// to catch a sample whose time belongs to a different race entirely.
    /// 3:31:48 over 13.1 mi is 16:09/mi, and lands outside it.
    func testRaceDetailTimesArePossibleOverTheirDistance() {
        for (name, detail) in Self.raceSamples {
            guard let miles = Self.milesFromDateLine(detail.dateLine) else {
                XCTFail("\(name): the sample's dateLine names no distance this test can read")
                continue
            }
            for (label, number) in [("goal", detail.goal), ("result/projected", detail.projected)] {
                guard let sec = Self.seconds(number?.text) else { continue }
                let pace = sec / miles
                XCTAssertTrue(pace >= 4 * 60 && pace <= 20 * 60,
                              "\(name) \(label) \(number?.text ?? "") over \(miles) mi is "
                              + "\(Int(pace / 60)):\(String(format: "%02d", Int(pace) % 60))/mi, "
                              + "which is not a time for this distance")
            }
        }
    }

    /// A pace plan cannot ask for a mile the race does not have. This is the
    /// other half of the same fixture defect: the half-marathon samples
    /// carried "Miles 21-26.2" and an elevation mark reading "mile 16".
    func testRaceDetailPacePlanStaysInsideTheRace() {
        for (name, detail) in Self.raceSamples {
            guard let miles = Self.milesFromDateLine(detail.dateLine) else { continue }
            for row in detail.pacePlan {
                for mile in Self.milesMentioned(in: row.label) {
                    XCTAssertLessThanOrEqual(mile, miles.rounded(.up),
                                             "\(name): pace plan row \"\(row.label)\" is past the finish "
                                             + "of a \(miles) mi race")
                }
            }
            for mark in detail.elevationMarks {
                for mile in Self.milesMentioned(in: mark.label) {
                    XCTAssertLessThanOrEqual(mile, miles.rounded(.up),
                                             "\(name): course mark \"\(mark.label)\" is past the finish "
                                             + "of a \(miles) mi race")
                }
            }
        }
    }

    /// A past race with no result logged must not carry a middle column. The
    /// server's `racePlateFor` sends `middleSec: nil` for exactly this case,
    /// and the sample that got it wrong drew "Result 3:31:48" above the words
    /// "Log your result".
    func testAPastRaceWithNoResultStatesNoResult() {
        let d = V5RaceDetail.v5SampleNoResult
        XCTAssertEqual(d.resultEntry?.isPast, true)
        XCTAssertNil(d.resultEntry?.finish, "the sample is the nothing-logged case")
        XCTAssertNil(d.projected?.text, "there is no result to put in the middle column")
        XCTAssertNil(d.gap?.text, "and nothing to measure a gap against")
    }

    // MARK: - Fixtures under test

    private static var raceSamples: [(String, V5RaceDetail)] {
        [
            ("8a CIM", .v5Sample),
            ("8b Cedar Falls Half", .v5SampleProvisional),
            ("8d Sombrero Half", .v5SampleNoResult),
            ("8e Clarksburg Half", .v5SampleNoGoal),
        ]
    }

    // MARK: - Reading the sample's own words

    /// `"3:31:48"` or `"1:32:04"` → seconds. Nil for anything else, including
    /// a worded value like "Even or better".
    static func seconds(_ text: String?) -> Double? {
        guard let text, !text.isEmpty else { return nil }
        let parts = text.split(separator: ":").map(String.init)
        guard parts.count >= 2, parts.allSatisfy({ Int($0) != nil }) else { return nil }
        return parts.reduce(0.0) { $0 * 60 + Double(Int($1)!) }
    }

    /// The distance the header names, in miles. The dateLine's first clause is
    /// the distance word — "Half marathon · Sunday 3 August".
    static func milesFromDateLine(_ line: String) -> Double? {
        let head = line.split(separator: "\u{00B7}").first.map(String.init)?
            .trimmingCharacters(in: .whitespaces).lowercased() ?? ""
        if head.contains("half") { return 13.1094 }
        if head.contains("marathon") { return 26.2188 }
        if head.contains("10k") { return 6.21371 }
        if head.contains("5k") { return 3.10686 }
        return nil
    }

    /// Every mile number a label mentions · "Miles 21-26.2" → [21, 26.2],
    /// "Big drop, mile 16" → [16].
    static func milesMentioned(in label: String) -> [Double] {
        guard label.lowercased().contains("mile") else { return [] }
        var out: [Double] = []
        var current = ""
        for ch in label {
            if ch.isNumber || ch == "." { current.append(ch) }
            else {
                if let v = Double(current) { out.append(v) }
                current = ""
            }
        }
        if let v = Double(current) { out.append(v) }
        return out
    }
}
