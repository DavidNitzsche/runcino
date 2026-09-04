//
//  V5RaceOnTodayDecodeTests.swift
//  faff.run iPhone · Decision 2 — race content on Today.
//
//  Unlike `V5ContractTests.swift`'s fixtures (real composer output, never
//  hand-edited), this is a WIRE-SHAPE test: it asserts the Swift decoder
//  accepts the exact key names `web-v2/lib/faff/race-on-today.ts`'s
//  `V5RaceOnToday` interface declares, and that a payload with NO `race`
//  key (every server response before this feature existed) still decodes
//  the rest of `V5Today` — the field is optional precisely so an older
//  payload keeps working.
//
import XCTest
@testable import Faff

final class V5RaceOnTodayDecodeTests: XCTestCase {

    private func todayJSON(raceFragment: String) -> Data {
        let json = """
        {
          "dateISO": "2026-09-03",
          "state": "race_day",
          "panel": {"dayState": "quality", "quiet": false, "place": "Today",
                     "dateLine": "Tuesday, September 3", "weekLine": null, "kicker": null,
                     "type": "RACE", "dose": null, "stats": []},
          "weekStrip": [], "groups": [], "why": null,
          "whereYouAre": [], "beforeYouGo": [],
          "askedVsRan": [], "verdict": null, "facts": [], "win": null,
          "conditionsNote": null, "coachTip": null
          \(raceFragment)
        }
        """
        return Data(json.utf8)
    }

    func test_decodesAFullRacePayload() throws {
        let json = todayJSON(raceFragment: """
        , "race": {
            "slug": "cim-2026",
            "name": "California International Marathon",
            "distanceMi": 26.2,
            "role": "race",
            "priority": "A",
            "executionTargetSec": 12680,
            "goalSec": 10800,
            "strategyLabel": "Controlled start \\u00b7 8:04/mi average",
            "hrLine": "Expect 150-160 bpm. Under 155 through mile 3; up to 165 late is drift, not a fault.",
            "checkpointMi": 20,
            "checkpointAbortBpm": 175,
            "fuelingSummary": "2 gels at 45, 75 min \\u00b7 60 g/hr"
        }
        """)
        let today = try JSONDecoder().decode(V5Today.self, from: json)
        let race = try XCTUnwrap(today.race)
        XCTAssertEqual(race.slug, "cim-2026")
        XCTAssertEqual(race.role, "race")
        XCTAssertEqual(race.executionTargetSec, 12680)
        XCTAssertEqual(race.goalSec, 10800)
        // The two must decode as genuinely separate values, never one
        // number doing double duty (Rule 16).
        XCTAssertNotEqual(race.executionTargetSec, race.goalSec)
        XCTAssertEqual(race.checkpointMi, 20)
        XCTAssertEqual(race.checkpointAbortBpm, 175)
        XCTAssertNotNil(race.fuelingSummary)
    }

    func test_missingRaceKeyDecodesToNilWithoutFailingTheWholePayload() throws {
        let json = todayJSON(raceFragment: "")
        let today = try JSONDecoder().decode(V5Today.self, from: json)
        XCTAssertNil(today.race)
        XCTAssertEqual(today.dateISO, "2026-09-03", "the rest of the payload must still decode")
    }

    func test_aControlledCEffortDayHasNoGoalOrHrLineAndStillDecodes() throws {
        let json = todayJSON(raceFragment: """
        , "race": {
            "slug": "tuneup-10k", "name": "Tune-up 10K", "distanceMi": 6.2,
            "role": "controlled_c_effort", "priority": "B",
            "executionTargetSec": 2400, "goalSec": null,
            "strategyLabel": "Strong, not all-out", "hrLine": null,
            "checkpointMi": null, "checkpointAbortBpm": null, "fuelingSummary": null
        }
        """)
        let today = try JSONDecoder().decode(V5Today.self, from: json)
        let race = try XCTUnwrap(today.race)
        XCTAssertEqual(race.role, "controlled_c_effort")
        XCTAssertNil(race.goalSec)
        XCTAssertNil(race.hrLine)
    }
}
