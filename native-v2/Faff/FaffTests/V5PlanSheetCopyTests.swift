//
//  V5PlanSheetCopyTests.swift
//  The change-the-plan sheet only claims a read that happened.
//

import XCTest
@testable import Faff

private func decodeJSON<T: Decodable>(_ t: T.Type, _ json: String) -> T {
    // swiftlint:disable:next force_try
    try! JSONDecoder().decode(T.self, from: Data(json.utf8))
}

final class V5PlanSheetCopyTests: XCTestCase {

    private let scenario = decodeJSON(V5Scenario.self, """
    {"id":"travel","label":"I am away","sub":"Pick your dates","available":true,"refusal":null}
    """)

    private let refusal = decodeJSON(V5PlanChangeRefusal.self, """
    {"ok":false,"error":"unavailable","reason":"Being away that long is not a week off, it is a different block.","violations":null}
    """)

    /// The sheet's subtitle was `.menu` versus everything else, so every stage
    /// still COLLECTING the question sat under "The coach has read the rest of
    /// the block" before anything had been sent. Seen on device: tapping "I am
    /// away" shows a From/To picker and a "Check these dates" button under a
    /// line claiming the block had already been read.
    func testInputStagesDoNotClaimTheCoachHasRead() {
        let inputStages: [PlanStage] = [
            .travelInput(scenario), .moveInput(scenario),
            .dayInput(scenario), .raceInput(scenario),
        ]
        for stage in inputStages {
            XCTAssertFalse(stage.coachHasRead)
            XCTAssertFalse(stage.sheetSubtitle.contains("has read"),
                           "an input stage claimed a read before anything was sent")
        }
    }

    /// `refusalUpfront` is decided by the MENU payload — no propose call
    /// happened — and `failed` is the coach not being reachable at all, which
    /// is the state where claiming a read is furthest from true.
    func testRefusalUpfrontAndFailureDoNotClaimARead() {
        for stage in [PlanStage.refusalUpfront(scenario), .failed(scenario, refusal)] {
            XCTAssertFalse(stage.coachHasRead)
            XCTAssertFalse(stage.sheetSubtitle.contains("has read"))
        }
    }

    /// The stage that DOES follow a real propose call keeps the line.
    func testRefusedKeepsTheLine() {
        XCTAssertTrue(PlanStage.refused(scenario, refusal).coachHasRead)
        XCTAssertEqual(PlanStage.refused(scenario, refusal).sheetSubtitle,
                       "The coach has read the rest of the block")
    }

    /// The menu is the one stage that was always right.
    func testMenuIsUnchanged() {
        XCTAssertEqual(PlanStage.menu.sheetSubtitle,
                       "Tell the coach and the block gets rewritten around it")
    }

    /// Coach voice: no exclamation marks, no emoji, no em dashes, never empty.
    func testEverySubtitleKeepsCoachVoice() {
        let all: [PlanStage] = [
            .menu, .refusalUpfront(scenario), .travelInput(scenario), .moveInput(scenario),
            .dayInput(scenario), .raceInput(scenario), .failed(scenario, refusal),
            .refused(scenario, refusal),
        ]
        for stage in all {
            let s = stage.sheetSubtitle
            XCTAssertFalse(s.isEmpty)
            XCTAssertFalse(s.contains("!"), "exclamation mark in: \(s)")
            XCTAssertFalse(s.contains("\u{2014}"), "em dash in: \(s)")
        }
    }
}
