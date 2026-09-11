//
//  V5CourseElevationDecodeTests.swift
//  Defect 1 (2026-09-11 CIM elevation-integrity review) · `V5DecisionCard`
//  gained a `courseElevationDetail` stored property but its hand-written
//  `init(from:)` and `K: CodingKey` enum were never updated to include it —
//  a Swift COMPILE error ("return from initializer without initializing all
//  stored properties"), the exact RACEWIRE-1 shape (`APIV5.swift`'s own
//  header on `V5RaceDetail`, and `V5RaceWireTests.swift` above) except here
//  the compiler catches it outright rather than silently defaulting to nil.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT THIS FILE CANNOT FALSIFY AT RUNTIME
//
//  Unlike RACEWIRE-1 (a lenient lower-in-the-object lenient lookup that
//  swallowed a bad key into `nil`), the defect this file guards is a MISSING
//  case in a non-optional stored property's assignment, which does not
//  compile at all. There is no way to construct a failing *test* for a
//  program that does not build — the fact this file compiles and its tests
//  run is itself the falsification: on the pre-fix branch, this whole target
//  fails at `swiftc`, before any test can execute. See the session's build
//  log for the reproduction (`error: return from initializer without
//  initializing all stored properties`).
//
//  What these tests DO cover going forward: that `courseElevationDetail`
//  actually arrives through the real decoder for both the informational
//  (`resolved: true`) and choice (`resolved: false`) card shapes, so a
//  FUTURE field added to `V5DecisionCard` and forgotten in `K` regresses to
//  RACEWIRE-1's silent-nil shape rather than staying invisible.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE FIXTURE IS THE SERVER'S OWN OUTPUT (informational card).
//
//  Read read-only, 2026-09-11, directly from the account's real CIM data via
//  the production database's DATABASE_URL_RO role — the exact function the
//  route calls (`resolveCourseElevation()` in `web-v2/lib/race/course-
//  elevation.ts`, then `computeCourseImpact()`), not values copied out of a
//  design doc:
//
//    confidence:  "high"
//    conflict:    curatedGainFt 100, curatedNetFt -340,
//                 measuredGainFt 723, measuredNetFt -304
//    reasons:     ["dense track, distance matches, no dropouts or altitude
//                  spikes"]
//    oldSecondsImpact (curated, priced via computeCourseImpact): 0
//    newSecondsImpact (measured, priced via computeCourseImpact): 54
//
//  `resolveCourseElevation()`'s `high` confidence clears
//  `elevationIsTrustedForAdjustment()`'s bar, so CIM's real conflict composes
//  through `courseChangedFactCard` (`resolved: true`) — CIM's real data never
//  reaches the CHOICE shape, which is why the choice-card test below is a
//  synthetic low-confidence scenario instead (matching the review's own
//  framing), built from the resolver's own reason-string vocabulary
//  (`course-elevation.ts`'s `degrade('low', ...)` calls), not invented copy.
//

import XCTest
@testable import Faff

final class V5CourseElevationDecodeTests: XCTestCase {

    // MARK: - Informational (fact) card · CIM's real numbers

    private static let cimInformationalJSON = """
    {
      "shape": "fact",
      "verdict": "realistic",
      "trigger": "course_changed",
      "question": "CIM's course record on file did not match your own GPS upload. Your upload is dense enough to trust, so we've corrected it. See the numbers below. The corrected reading adds about 54 seconds at your goal pace, in the course chunk of your goal gap. Not your projected finish. No verification date is on record for either source.",
      "safeTarget": null,
      "stretchTarget": null,
      "cautions": [],
      "answers": [
        {"id": "course_ack", "label": "Acknowledge", "action": "acknowledge", "targetSec": null}
      ],
      "courseElevationDetail": {
        "oldNetFt": -340, "oldGainFt": 100, "oldSecondsImpact": 0,
        "newNetFt": -304, "newGainFt": 723, "newSecondsImpact": 54,
        "confidence": "high", "resolved": true,
        "reasons": ["dense track, distance matches, no dropouts or altitude spikes"]
      }
    }
    """

    func testInformationalCardDecodesWithRealCIMNumbers() throws {
        let card = try JSONDecoder().decode(V5DecisionCard.self, from: Data(Self.cimInformationalJSON.utf8))
        XCTAssertEqual(card.shape, .fact)
        XCTAssertEqual(card.trigger, "course_changed")
        XCTAssertEqual(card.answers.map(\.action), ["acknowledge"])
        let detail = try XCTUnwrap(card.courseElevationDetail,
                                   "courseElevationDetail decoded to nil — the exact RACEWIRE-1 shape this file exists to catch")
        XCTAssertTrue(detail.resolved, "high confidence must compose the informational shape")
        XCTAssertEqual(detail.confidence, "high")
        XCTAssertEqual(detail.oldGainFt, 100)
        XCTAssertEqual(detail.oldNetFt, -340)
        XCTAssertEqual(detail.newGainFt, 723)
        XCTAssertEqual(detail.newNetFt, -304)
        XCTAssertEqual(detail.oldSecondsImpact, 0)
        XCTAssertEqual(detail.newSecondsImpact, 54)
    }

    // MARK: - Choice card · synthetic low-confidence scenario

    // CIM's real data resolves at HIGH confidence (see above) and never
    // reaches this shape. This scenario is synthetic on purpose — a sparse
    // upload for a race the review calls "Sample 10K" — but its reason
    // string, action ids and answer labels are the resolver's and
    // `race-card.ts`'s real vocabulary, not invented copy.
    private static let syntheticChoiceJSON = """
    {
      "shape": "choice",
      "verdict": "realistic",
      "trigger": "course_changed",
      "question": "Sample 10K's course record on file and your own GPS upload disagree, and the upload isn't dense enough for us to trust it over the record (only 3 elevation samples per mile \\u00b7 too coarse for gross gain). Your call. No verification date is on record for either source.",
      "safeTarget": null,
      "stretchTarget": null,
      "cautions": [],
      "answers": [
        {"id": "course_use_measured", "label": "Use my GPS track \\u00b7 260 ft gain, 10 ft net drop", "action": "use_measured_elevation", "targetSec": null},
        {"id": "course_keep_curated", "label": "Keep the course record \\u00b7 200 ft gain, 50 ft net drop", "action": "keep_curated_elevation", "targetSec": null}
      ],
      "courseElevationDetail": {
        "oldNetFt": -50, "oldGainFt": 200, "oldSecondsImpact": 5,
        "newNetFt": -10, "newGainFt": 260, "newSecondsImpact": 18,
        "confidence": "low", "resolved": false,
        "reasons": ["only 3 elevation samples per mile \\u00b7 too coarse for gross gain"]
      }
    }
    """

    func testChoiceCardDecodesAndDivergesFromTheInformationalShape() throws {
        let card = try JSONDecoder().decode(V5DecisionCard.self, from: Data(Self.syntheticChoiceJSON.utf8))
        XCTAssertEqual(card.shape, .choice)
        XCTAssertEqual(card.answers.map(\.action), ["use_measured_elevation", "keep_curated_elevation"])
        let detail = try XCTUnwrap(card.courseElevationDetail)
        XCTAssertFalse(detail.resolved, "low confidence must compose the choice shape, not the informational one")
        XCTAssertEqual(detail.confidence, "low")
        // The two cards are visually distinct at the data level, not just by
        // `shape`: the choice card's two answers name the actual numbers
        // (Rule 16), the informational card's one answer does not.
        XCTAssertTrue(card.answers.allSatisfy { $0.label != "Acknowledge" })
    }

    func testTheTwoCardsAreGenuinelyDifferentShapes() throws {
        let info = try JSONDecoder().decode(V5DecisionCard.self, from: Data(Self.cimInformationalJSON.utf8))
        let choice = try JSONDecoder().decode(V5DecisionCard.self, from: Data(Self.syntheticChoiceJSON.utf8))
        XCTAssertNotEqual(info.shape, choice.shape)
        XCTAssertNotEqual(info.answers.count, choice.answers.count)
        XCTAssertNotEqual(info.courseElevationDetail?.resolved, choice.courseElevationDetail?.resolved)
    }
}
