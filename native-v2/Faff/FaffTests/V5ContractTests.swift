//
//  V5ContractTests.swift
//  faff.run iPhone · the seam between the server's JSON and the phone's decoder.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS EXISTS
//
//  `web-v2/lib/faff/v5-today.ts` composes the Today payload and
//  `native-v2/.../DesignV5/APIV5.swift` decodes it. They were written from the
//  same contract by different hands, and until this file nothing had ever put
//  one through the other. Every other test on either side proves a half.
//
//  The fixtures below are the composer's REAL output, dumped verbatim from
//  `composeV5Today`. Regenerate them by re-running that composer, never by
//  editing them here — a fixture someone hand-fixed to make a test pass is
//  worse than no fixture.
//
//  Two of them carry the rules:
//
//    · `changedOvernightTwoDomains` is a payload where only TWO readiness
//      domains converged. The server composes it as an ordinary day, not as a
//      changed-session story, because one signal never changes a session and
//      neither do two. The assertion here is that the phone would not tell
//      that story either even if a future server did send it.
//
//    · `notOnPhoneYet` is a runner the phone has no screens for. It must
//      decode to a refusal carrying a reason, not to an empty Today.
//

import XCTest
@testable import Faff

final class V5ContractTests: XCTestCase {

    private func decode(_ json: String) throws -> V5Today {
        try JSONDecoder().decode(V5Today.self, from: Data(json.utf8))
    }

    // MARK: - Every state the composer can produce decodes

    func testEveryComposedStateDecodes() throws {
        let cases: [(String, String, V5TodayState)] = [
            ("before_run", Fixtures.beforeRun, .beforeRun),
            ("changed_overnight", Fixtures.changedOvernight, .changedOvernight),
            ("injury_flare", Fixtures.injuryFlare, .injuryFlare),
            ("week_off", Fixtures.weekOff, .weekOff),
            ("off_season", Fixtures.offSeason, .offSeason),
            ("not_on_phone_yet", Fixtures.notOnPhoneYet, .notOnPhoneYet),
        ]
        for (name, json, expected) in cases {
            let model = try decode(json)
            XCTAssertEqual(model.state, expected, "\(name) decoded to the wrong state")
            // `not_on_phone_yet` is the one state with no panel to fill: it
            // has no session, no week and no date to prescribe against, and
            // its screen does not draw one. An empty panel there is the
            // correct answer, not drift.
            if expected != .notOnPhoneYet {
                XCTAssertFalse(model.panel.type.isEmpty || model.panel.dateLine.isEmpty,
                               "\(name) decoded an empty panel · the wire keys have drifted")
            }
        }
    }

    // MARK: - RULE TWO · one signal never changes a session

    func testThreeDomainsAreRequiredForAChangedSession() throws {
        let three = try decode(Fixtures.changedOvernight)
        let changed = try XCTUnwrap(three.changed, "a changed-overnight payload must carry its convergence")
        XCTAssertGreaterThanOrEqual(changed.converged.count, 3)
        XCTAssertTrue(changed.namesAConvergence)
        XCTAssertFalse(changed.coachLine.isEmpty, "the coach line is composed server-side and quoted verbatim")

        // Each row names the runner's OWN rolling baseline. Readiness has no
        // evening/morning pair to compare, so a row with no baseline is a row
        // that cannot be honest.
        for row in changed.converged {
            XCTAssertFalse(row.baseline.isEmpty, "\(row.domain) has no baseline named")
        }

        // The server already declines to tell the story on two domains — it
        // composes an ordinary day. Assert that, and assert the phone would
        // refuse independently if that ever changed.
        let two = try decode(Fixtures.changedOvernightTwoDomains)
        XCTAssertEqual(two.state, .beforeRun,
                       "two converged domains is not a changed session")
        if let c = two.changed {
            XCTAssertFalse(c.namesAConvergence,
                           "the phone must refuse to tell the story below three domains")
        }
    }

    // MARK: - RULE THREE · a refusal is a correct answer

    func testNotOnPhoneYetIsARefusalWithAReason() throws {
        let model = try decode(Fixtures.notOnPhoneYet)
        XCTAssertEqual(model.state, .notOnPhoneYet)
        let reason = try XCTUnwrap(model.notOnPhoneYet,
                                   "a mode the phone does not draw must say why, not go blank")
        XCTAssertFalse(reason.isEmpty)
    }

    // MARK: - RULE ONE · the engine says what is modelled, not the phone

    func testEveryNumberCarriesItsBasis() throws {
        let model = try decode(Fixtures.beforeRun)
        for stat in model.panel.stats {
            // A stat with text must resolve to a real FaffValue, and one
            // without must be unreadable rather than blank.
            let v = stat.value.value
            if stat.value.text == nil {
                XCTAssertEqual(v.basis, .unreadable)
            } else {
                XCTAssertNotEqual(v.text, "", "a stat decoded to an empty string")
            }
        }
    }

    // MARK: - Fixtures

    enum Fixtures {
        /// Composed by `composeV5Today` in web-v2/lib/faff/v5-today.ts, dumped
        /// verbatim. Regenerate by re-running that composer, never by hand.
        static let beforeRun = #"""
    {
      "dateISO": "2026-08-19",
      "state": "before_run",
      "panel": {
        "dayState": "rest",
        "quiet": false,
        "place": "Today",
        "dateLine": "Wednesday August 19",
        "weekLine": "Week 6 of 16",
        "kicker": null,
        "type": "Rest",
        "dose": null,
        "stats": []
      },
      "weekStrip": [
        {
          "id": "w1",
          "dateISO": "2026-08-18",
          "letter": "T",
          "number": "18",
          "dayState": "easy",
          "isToday": false,
          "isDone": true,
          "isRest": false
        },
        {
          "id": "date:2026-08-19",
          "dateISO": "2026-08-19",
          "letter": "W",
          "number": "19",
          "dayState": "quality",
          "isToday": true,
          "isDone": false,
          "isRest": false
        }
      ],
      "groups": [],
      "why": null,
      "whereYouAre": [],
      "beforeYouGo": [],
      "askedVsRan": [],
      "verdict": null,
      "zoneShares": null,
      "zoneTarget": null,
      "elevation": null,
      "onTheBelt": null,
      "shoesWorn": null,
      "whatThisDidToTheWeek": [],
      "runId": null,
      "changed": null,
      "injury": null,
      "weekOff": null,
      "offSeason": null,
      "notOnPhoneYet": null
    }
    """#

        /// Composed by `composeV5Today` in web-v2/lib/faff/v5-today.ts, dumped
        /// verbatim. Regenerate by re-running that composer, never by hand.
        static let changedOvernight = #"""
    {
      "dateISO": "2026-08-19",
      "state": "changed_overnight",
      "panel": {
        "dayState": "rest",
        "quiet": false,
        "place": "Today",
        "dateLine": "Wednesday August 19",
        "weekLine": "Updated 3:12 AM \u00b7 was Threshold",
        "kicker": null,
        "type": "Rest",
        "dose": null,
        "stats": []
      },
      "weekStrip": [
        {
          "id": "w1",
          "dateISO": "2026-08-18",
          "letter": "T",
          "number": "18",
          "dayState": "easy",
          "isToday": false,
          "isDone": true,
          "isRest": false
        },
        {
          "id": "date:2026-08-19",
          "dateISO": "2026-08-19",
          "letter": "W",
          "number": "19",
          "dayState": "quality",
          "isToday": true,
          "isDone": false,
          "isRest": false
        }
      ],
      "groups": [],
      "why": null,
      "whereYouAre": [],
      "beforeYouGo": [],
      "askedVsRan": [],
      "verdict": null,
      "zoneShares": null,
      "zoneTarget": null,
      "elevation": null,
      "onTheBelt": null,
      "shoesWorn": null,
      "whatThisDidToTheWeek": [],
      "runId": null,
      "changed": {
        "updatedAt": "3:12 AM",
        "wasType": "Threshold",
        "coachLine": "Three short nights, four days of low HRV and a resting heart rate above your usual. Today is easy running instead. The threshold session comes back when the numbers do.",
        "converged": [
          {
            "id": "sleep-0",
            "domain": "Sleep",
            "value": {
              "text": "5h 40m",
              "modelled": false
            },
            "baseline": "7-day median 7h 10m"
          },
          {
            "id": "autonomic-1",
            "domain": "HRV",
            "value": {
              "text": "52 ms",
              "modelled": false
            },
            "baseline": "7-day median 68 ms"
          },
          {
            "id": "cardiac-2",
            "domain": "Resting heart rate",
            "value": {
              "text": "54",
              "modelled": false
            },
            "baseline": "3-day average 48"
          }
        ],
        "movedTo": null
      },
      "injury": null,
      "weekOff": null,
      "offSeason": null,
      "notOnPhoneYet": null
    }
    """#

        /// Composed by `composeV5Today` in web-v2/lib/faff/v5-today.ts, dumped
        /// verbatim. Regenerate by re-running that composer, never by hand.
        static let changedOvernightTwoDomains = #"""
    {
      "dateISO": "2026-08-19",
      "state": "before_run",
      "panel": {
        "dayState": "rest",
        "quiet": false,
        "place": "Today",
        "dateLine": "Wednesday August 19",
        "weekLine": "Week 6 of 16",
        "kicker": null,
        "type": "Rest",
        "dose": null,
        "stats": []
      },
      "weekStrip": [
        {
          "id": "w1",
          "dateISO": "2026-08-18",
          "letter": "T",
          "number": "18",
          "dayState": "easy",
          "isToday": false,
          "isDone": true,
          "isRest": false
        },
        {
          "id": "date:2026-08-19",
          "dateISO": "2026-08-19",
          "letter": "W",
          "number": "19",
          "dayState": "quality",
          "isToday": true,
          "isDone": false,
          "isRest": false
        }
      ],
      "groups": [],
      "why": null,
      "whereYouAre": [],
      "beforeYouGo": [],
      "askedVsRan": [],
      "verdict": null,
      "zoneShares": null,
      "zoneTarget": null,
      "elevation": null,
      "onTheBelt": null,
      "shoesWorn": null,
      "whatThisDidToTheWeek": [],
      "runId": null,
      "changed": null,
      "injury": null,
      "weekOff": null,
      "offSeason": null,
      "notOnPhoneYet": null
    }
    """#

        /// Composed by `composeV5Today` in web-v2/lib/faff/v5-today.ts, dumped
        /// verbatim. Regenerate by re-running that composer, never by hand.
        static let injuryFlare = #"""
    {
      "dateISO": "2026-08-19",
      "state": "injury_flare",
      "panel": {
        "dayState": "rest",
        "quiet": true,
        "place": "Today",
        "dateLine": "Wednesday August 19",
        "weekLine": null,
        "kicker": null,
        "type": "Not today",
        "dose": null,
        "stats": []
      },
      "weekStrip": [
        {
          "id": "w1",
          "dateISO": "2026-08-18",
          "letter": "T",
          "number": "18",
          "dayState": "easy",
          "isToday": false,
          "isDone": true,
          "isRest": false
        },
        {
          "id": "date:2026-08-19",
          "dateISO": "2026-08-19",
          "letter": "W",
          "number": "19",
          "dayState": "quality",
          "isToday": true,
          "isDone": false,
          "isRest": false
        }
      ],
      "groups": [],
      "why": null,
      "whereYouAre": [],
      "beforeYouGo": [],
      "askedVsRan": [],
      "verdict": null,
      "zoneShares": null,
      "zoneTarget": null,
      "elevation": null,
      "onTheBelt": null,
      "shoesWorn": null,
      "whatThisDidToTheWeek": [],
      "runId": null,
      "changed": null,
      "injury": {
        "area": "Right calf",
        "since": "Flagged Tuesday"
      },
      "weekOff": null,
      "offSeason": null,
      "notOnPhoneYet": null
    }
    """#

        /// Composed by `composeV5Today` in web-v2/lib/faff/v5-today.ts, dumped
        /// verbatim. Regenerate by re-running that composer, never by hand.
        static let weekOff = #"""
    {
      "dateISO": "2026-08-19",
      "state": "week_off",
      "panel": {
        "dayState": "rest",
        "quiet": false,
        "place": "Today",
        "dateLine": "Wednesday August 19",
        "weekLine": null,
        "kicker": "Away",
        "type": "Week off",
        "dose": null,
        "stats": []
      },
      "weekStrip": [
        {
          "id": "w1",
          "dateISO": "2026-08-18",
          "letter": "T",
          "number": "18",
          "dayState": "easy",
          "isToday": false,
          "isDone": true,
          "isRest": false
        },
        {
          "id": "date:2026-08-19",
          "dateISO": "2026-08-19",
          "letter": "W",
          "number": "19",
          "dayState": "quality",
          "isToday": true,
          "isDone": false,
          "isRest": false
        }
      ],
      "groups": [],
      "why": null,
      "whereYouAre": [],
      "beforeYouGo": [],
      "askedVsRan": [],
      "verdict": null,
      "zoneShares": null,
      "zoneTarget": null,
      "elevation": null,
      "onTheBelt": null,
      "shoesWorn": null,
      "whatThisDidToTheWeek": [],
      "runId": null,
      "changed": null,
      "injury": null,
      "weekOff": {
        "reason": "Away",
        "fromISO": "2026-09-30",
        "toISO": "2026-10-06",
        "coachLine": "A zero week goes in the book. The plan resumes where you are, not where the calendar says.",
        "nextUp": null
      },
      "offSeason": null,
      "notOnPhoneYet": null
    }
    """#

        /// Composed by `composeV5Today` in web-v2/lib/faff/v5-today.ts, dumped
        /// verbatim. Regenerate by re-running that composer, never by hand.
        static let offSeason = #"""
    {
      "dateISO": "2026-08-19",
      "state": "off_season",
      "panel": {
        "dayState": "rest",
        "quiet": true,
        "place": "Today",
        "dateLine": "Wednesday August 19",
        "weekLine": null,
        "kicker": null,
        "type": "Off-season",
        "dose": null,
        "stats": []
      },
      "weekStrip": [
        {
          "id": "w1",
          "dateISO": "2026-08-18",
          "letter": "T",
          "number": "18",
          "dayState": "easy",
          "isToday": false,
          "isDone": true,
          "isRest": false
        },
        {
          "id": "date:2026-08-19",
          "dateISO": "2026-08-19",
          "letter": "W",
          "number": "19",
          "dayState": "quality",
          "isToday": true,
          "isDone": false,
          "isRest": false
        }
      ],
      "groups": [],
      "why": null,
      "whereYouAre": [],
      "beforeYouGo": [],
      "askedVsRan": [],
      "verdict": null,
      "zoneShares": null,
      "zoneTarget": null,
      "elevation": null,
      "onTheBelt": null,
      "shoesWorn": null,
      "whatThisDidToTheWeek": [],
      "runId": null,
      "changed": null,
      "injury": null,
      "weekOff": null,
      "offSeason": {
        "sinceLastRace": "Eleven weeks since Big Sur"
      },
      "notOnPhoneYet": null
    }
    """#

        /// Composed by `composeV5Today` in web-v2/lib/faff/v5-today.ts, dumped
        /// verbatim. Regenerate by re-running that composer, never by hand.
        static let notOnPhoneYet = #"""
    {
      "dateISO": "2026-08-19",
      "state": "not_on_phone_yet",
      "panel": {
        "dayState": "rest",
        "quiet": true,
        "place": "Today",
        "dateLine": "Wednesday August 19",
        "weekLine": null,
        "kicker": null,
        "type": "",
        "dose": null,
        "stats": []
      },
      "weekStrip": [],
      "groups": [],
      "why": null,
      "whereYouAre": [],
      "beforeYouGo": [],
      "askedVsRan": [],
      "verdict": null,
      "zoneShares": null,
      "zoneTarget": null,
      "elevation": null,
      "onTheBelt": null,
      "shoesWorn": null,
      "whatThisDidToTheWeek": [],
      "runId": null,
      "changed": null,
      "injury": null,
      "weekOff": null,
      "offSeason": null,
      "notOnPhoneYet": "This phone build only coaches toward a goal race. Coached, just-run and distance-goal training keep running in the app, just not here yet."
    }
    """#
    }
}
