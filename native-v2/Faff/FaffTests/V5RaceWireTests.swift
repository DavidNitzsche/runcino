//
//  V5RaceWireTests.swift
//  RACEWIRE-1 · the race detail payload decodes, and the four layers arrive.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE DEFECT THIS EXISTS FOR
//
//  `lib/race/race-outlook-payload.ts` says "Additive, snake_case" in its first
//  line. Every `V5Outlook*` struct was written in camelCase against a decoder
//  that sets no `keyDecodingStrategy`. The rest of `V5RaceDetail` IS camelCase
//  on the wire, so the mismatch was confined to one sub-object and invisible in
//  review.
//
//  AND UNDERNEATH IT, A SECOND AND OLDER DEFECT. `V5RaceDetail` carries a
//  hand-written lenient `init(from:)` whose `K` enum never listed `outlook` at
//  all, so the property kept its nil default on every render regardless of what
//  the server sent. No throw, no error, no empty state: the section read
//  `if let o = raceDetail.outlook` and the answer was always no. The race-pace
//  brain has been dark on the phone since the day it shipped.
//
//  That second one is why the first was invisible. It was found by RENDERING
//  the screen (Rule 13), not by reading the code: the screenshot had a Course
//  section sitting directly under the stat plate where four layers should have
//  been. Both are fixed; both are pinned below.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT THESE TESTS CANNOT FAIL ON  (Rule 22)
//
//  · A field the SERVER stops sending. They decode a fixture; nothing here can
//    see `route.ts`. `lib/race/_race_wire_shape.test.ts` owns that direction.
//  · Whether the values are RIGHT. They assert the keys land in the right
//    properties, not that 3:23:50 is a good projection.
//  · Whether the screen DRAWS what it decoded. Only a rendered screenshot
//    answers that (Rule 13).
//  · Any v5 payload other than race detail.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE FIXTURE IS THE SERVER'S OWN OUTPUT.
//
//  Every value below was read out of `resolveRaceOutlookBySlug(david, 'cim')`
//  on 2026-09-02, read-only, through `lib/race/_probe_race_page.test.ts`. Not
//  one of them was written to make a test pass — a fixture invented to fit the
//  decoder only proves the decoder agrees with itself.
//

import XCTest
@testable import Faff

final class V5RaceWireTests: XCTestCase {

    /// The owner's live CIM detail payload, snake_case outlook and all.
    private static let cimJSON = """
    {
      "slug": "cim",
      "name": "California International Marathon",
      "dateLine": "Sun, Dec 6, 2026 · Marathon",
      "goal": {"text": "3:00:00", "modelled": false},
      "projected": {"text": "3:19:42", "modelled": true},
      "gap": {"text": "+19:42", "modelled": true},
      "elevation": [100, 95, 90],
      "elevationMarks": [],
      "elevationFootnotes": ["723 ft gain", "Net -304 ft", "Measured from GPS."],
      "pacePlan": [],
      "taperProgress": null,
      "taperEndpoints": [],
      "taperCentreLabel": null,
      "gear": [],
      "coachLine": null,
      "resultEntry": {"isPast": false, "status": null, "finish": null},
      "coachGoal": null,
      "outlook": {
        "model_version": "v3",
        "resolved_at": "2026-09-02T00:00:00Z",
        "stated_goal": {"sec": 10800, "display": "3:00:00", "pace": "6:52"},
        "current_projection": {
          "sec": 12230, "display": "3:23:50", "pace": "7:46",
          "likely_range": {"lo_sec": 11863, "hi_sec": 12597, "lo": "3:17:43", "hi": "3:29:57"},
          "confidence": 0.51, "basis": "durability_blend", "primary_limiter": "endurance"
        },
        "training_prescription": {"kind": "marathon_specific", "pace": "7:52", "why": "Carried through your own endurance exponent."},
        "expected_race_day": {
          "sec": 11982, "display": "3:19:42", "pace": "7:37",
          "likely_range": {"lo_sec": 11608, "hi_sec": 12411, "lo": "3:13:28", "hi": "3:26:51"},
          "confidence": 0.3, "basis": "trajectory"
        },
        "execution": {
          "target_sec": 12230, "target_display": "3:23:50", "pace": "7:46",
          "pace_band": {"lo": "7:41", "hi": "7:51"},
          "source": "current_evidence",
          "strategy": "Controlled start · 7:46/mi average",
          "reason": "Today's evidence says 3:23:50.",
          "hr": {
            "expected_range_bpm": [148, 160], "early_ceiling_bpm": 148,
            "early_through_mi": 10, "late_allowance_bpm": 165, "checkpoint_mi": 10,
            "checkpoint_abort_bpm": 163, "informational_only": false,
            "comparable_efforts": 15, "reasons": ["DOCTRINE_BAND_FOR_DISTANCE"]
          }
        },
        "conditional_upside": {
          "sec": 11610, "display": "3:13:30", "pace": "7:23", "confidence": 0.3,
          "criteria": [
            "Marathon-effort sessions completed inside the prescribed range with heart rate under the ceiling.",
            "A substantial marathon-specific long run finished without late-session deterioration.",
            "The same quality repeated in a second session, not shown once.",
            "A tune-up race consistent with the faster target.",
            "The higher-volume weeks of the block absorbed, not merely attempted."
          ]
        },
        "block_seam": {
          "last_rehearsal_pace": null, "execution_pace": "7:46", "gap_s_per_mi": null,
          "credible": false,
          "reason": "The block authored no marathon-effort session, so nothing rehearses race day."
        },
        "goal_feasibility": {"status": "unlikely_currently", "gap_sec": 1182, "gap_to_range_edge_sec": 808},
        "bridge": [
          {"step": "current_capacity", "label": "Current threshold capacity",
           "value": "7:10/mi (VDOT 47.8)", "value_sec": null, "pace": "7:10", "range": null,
           "confidence": 0.84, "evidence": ["run -258355938987883"],
           "change_trigger": "Three corroborating threshold sessions.", "differs_from_previous": null}
        ],
        "change_triggers": [],
        "staleness": {"newest_evidence": "2026-09-01", "evidence_age_days": 1, "stale": false},
        "capacity": {"threshold_pace": "7:10", "threshold_vdot": 47.8, "source_mode": "direct", "confidence": 0.84},
        "flags": []
      },
      "raceLayers": {
        "temporality": "Based on what you have demonstrated today, the executable plan is 3:23:50. This block is designed to move that forward. 3:13:30 is available as an upside outcome if marathon-specific workouts, tune-up racing and accumulated training support it.",
        "collapsed_projection_into_target": true,
        "findings": [],
        "layers": [
          {"kind": "aspirational_goal", "label": "Your goal", "display": "3:00:00", "sec": 10800,
           "pace": "6:52", "range": null, "modelled": false, "actionable": false,
           "note": "Yours. The coach never changes it and never races off it.", "criteria": null},
          {"kind": "execution_target", "label": "Race it at", "display": "3:23:50", "sec": 12230,
           "pace": "7:46", "range": {"lo": "3:17:43", "hi": "3:29:57", "lo_sec": 11863, "hi_sec": 12597},
           "modelled": true, "actionable": true,
           "note": "What you could race now, from what you have already demonstrated. It moves when your evidence moves.",
           "criteria": null},
          {"kind": "block_forecast", "label": "Where this block is built to get you", "display": "3:19:42",
           "sec": 11982, "pace": "7:37", "range": {"lo": "3:13:28", "hi": "3:26:51", "lo_sec": 11608, "hi_sec": 12411},
           "modelled": true, "actionable": false,
           "note": "A forecast of the training still to come, not something you have done yet.", "criteria": null},
          {"kind": "conditional_upside", "label": "Available if the block earns it", "display": "3:13:30",
           "sec": 11610, "pace": "7:23", "range": null, "modelled": true, "actionable": false,
           "note": "Not the target. It becomes the target only when the evidence below arrives.",
           "criteria": [
             {"text": "Marathon-effort sessions completed inside the prescribed range with heart rate under the ceiling.", "status": "not_evaluated"},
             {"text": "A tune-up race consistent with the faster target.", "status": "not_evaluated"}
           ]}
        ]
      },
      "courseContext": {
        "gain_ft": 723, "loss_ft": 1027, "net_ft": -304,
        "provenance": "measured", "confidence": "high",
        "conflict_note": "Measured elevation differs from the listed course profile (gross gain: curated 100 ft vs measured 723 ft). The measured trace is what is drawn.",
        "adjustment_sec": 61, "descent_giveback_fraction": 0.5,
        "model_id": "elevation_hysteresis_v1",
        "sentence": "723 ft of climb and 1027 ft of descent, net downhill by 304 ft.",
        "meaning": "A descent gives back about half of what the matching climb costs, so this profile is close to neutral rather than a gift.",
        "applied_to_target": false
      }
    }
    """

    private func decodeCIM() throws -> V5RaceDetail {
        try JSONDecoder().decode(V5RaceDetail.self, from: Data(Self.cimJSON.utf8))
    }

    // MARK: - The decode itself

    func testTheWholePayloadDecodes() throws {
        // LIVENESS · the fixture is a real payload and reaches the struct.
        let d = try decodeCIM()
        XCTAssertEqual(d.slug, "cim")
        XCTAssertEqual(d.goal?.text, "3:00:00")
    }

    func testTheOutlookArrivesRatherThanTakingTheScreenDown() throws {
        let o = try XCTUnwrap(decodeCIM().outlook, "the outlook decoded to nil — the sub-object is being swallowed")
        XCTAssertEqual(o.currentProjection.display, "3:23:50")
        XCTAssertEqual(o.currentProjection.likelyRange?.lo, "3:17:43")
        XCTAssertEqual(o.expectedRaceDay.display, "3:19:42")
        XCTAssertEqual(o.execution.targetDisplay, "3:23:50")
        XCTAssertEqual(o.execution.pace, "7:46")
        XCTAssertEqual(o.goalFeasibility.status, "unlikely_currently")
        XCTAssertEqual(o.bridge.count, 1)
    }

    func testTheHeartRateLadderDecodesWholeEvenThoughOneSentenceIsDrawn() throws {
        let hr = try XCTUnwrap(decodeCIM().outlook?.execution.hr)
        XCTAssertEqual(hr.expectedRangeBpm, [148, 160])
        XCTAssertEqual(hr.earlyCeilingBpm, 148)
        XCTAssertEqual(hr.checkpointAbortBpm, 163)
        XCTAssertEqual(hr.lateAllowanceBpm, 165)
        XCTAssertFalse(hr.informationalOnly)
    }

    func testQ7sFourthLayerReachesThePhone() throws {
        let up = try XCTUnwrap(decodeCIM().outlook?.conditionalUpside,
                               "the conditional upside was resolved, serialised and dropped at the decoder")
        XCTAssertEqual(up.display, "3:13:30")
        XCTAssertEqual(up.pace, "7:23")
        XCTAssertEqual(up.criteria.count, 5)
    }

    func testTheBlockSeamSaysWhichKindOfNotCredible() throws {
        let seam = try XCTUnwrap(decodeCIM().outlook?.blockSeam)
        XCTAssertFalse(seam.credible)
        // Rule 11 · a nil gap beside a reason is how "the block rehearses
        // nothing" is told apart from "the gap is too wide".
        XCTAssertNil(seam.gapSPerMi)
        XCTAssertFalse(seam.reason.isEmpty)
    }

    // MARK: - RP-2 · the layers

    func testExactlyOneLayerIsTheNumberToRunTo() throws {
        let l = try XCTUnwrap(decodeCIM().raceLayers)
        XCTAssertTrue(l.findings.isEmpty)
        let actionable = l.layers.filter(\.actionable)
        XCTAssertEqual(actionable.count, 1)
        XCTAssertEqual(actionable.first?.kind, "execution_target")
        XCTAssertEqual(actionable.first?.display, "3:23:50")
    }

    func testTheGoalIsTheOnlyNumberWithoutTheMark() throws {
        let l = try XCTUnwrap(decodeCIM().raceLayers)
        for layer in l.layers {
            let expected = layer.kind != "aspirational_goal"
            XCTAssertEqual(layer.modelled, expected, "\(layer.label) has the wrong provenance")
        }
        // And the mark is drawn from the engine's flag, never re-decided here.
        let goal = try XCTUnwrap(l.layers.first { $0.kind == "aspirational_goal" })
        XCTAssertEqual(FaffValue.from(goal.display, modelled: goal.modelled).basis, .measured)
        let target = try XCTUnwrap(l.layers.first(where: \.actionable))
        XCTAssertEqual(FaffValue.from(target.display, modelled: target.modelled).basis, .modelled)
    }

    func testNoTwoLayersPrintTheSameNumber() throws {
        // The original defect: 3:22:17, 3:31:48 and 3:42:23 all labelled
        // "projected" on one screen.
        let l = try XCTUnwrap(decodeCIM().raceLayers)
        let shown = l.layers.compactMap(\.display)
        XCTAssertEqual(Set(shown).count, shown.count, "a number is drawn twice: \(shown)")
        let labels = l.layers.map(\.label)
        XCTAssertEqual(Set(labels).count, labels.count)
    }

    func testTheUpsideCriteriaAreHonestlyUnevaluated() throws {
        let l = try XCTUnwrap(decodeCIM().raceLayers)
        let up = try XCTUnwrap(l.layers.first { $0.kind == "conditional_upside" })
        let criteria = try XCTUnwrap(up.criteria)
        XCTAssertFalse(criteria.isEmpty)
        for c in criteria {
            // Rule 11 · nothing evaluates these. A tick here would tell the
            // runner he had earned 3:13 on evidence nobody looked at.
            XCTAssertFalse(c.isEvaluated, "a criterion claims a verdict nothing produced")
            XCTAssertFalse(c.isMet)
        }
    }

    // MARK: - RP-4 / RP-5 · the course

    func testTheCourseSaysWhatItMeansAndNotWhatTheFootnotesAlreadySay() throws {
        let c = try XCTUnwrap(decodeCIM().courseContext)
        XCTAssertEqual(c.gainFt, 723)
        XCTAssertEqual(c.netFt, -304)
        // Rule 17 · the footnotes above already print "723 ft gain".
        XCTAssertFalse(try XCTUnwrap(c.meaning).contains("723"))
        // RP-5 · the absence of a course-adjusted target is declared, so this
        // screen can never imply one.
        XCTAssertFalse(c.appliedToTarget)
    }

    // MARK: - Degradation

    func testAnOlderServerWithNoLayersStillDecodes() throws {
        // The additive contract: `raceLayers` and `courseContext` are `var … =
        // nil`, so a server that has not shipped them yet is not an outage.
        let stripped = Self.cimJSON
            .replacingOccurrences(of: "\"raceLayers\"", with: "\"raceLayers_absent\"")
            .replacingOccurrences(of: "\"courseContext\"", with: "\"courseContext_absent\"")
        let d = try JSONDecoder().decode(V5RaceDetail.self, from: Data(stripped.utf8))
        XCTAssertNil(d.raceLayers)
        XCTAssertNil(d.courseContext)
        XCTAssertNotNil(d.outlook, "the outlook must survive the other two being absent")
    }

    func testAPastRaceSendsNoOutlookAndThatIsNotAFailure() throws {
        let past = Self.cimJSON.replacingOccurrences(
            of: "\"resultEntry\": {\"isPast\": false, \"status\": null, \"finish\": null}",
            with: "\"resultEntry\": {\"isPast\": true, \"status\": \"confirmed\", \"finish\": {\"text\": \"3:18:04\", \"modelled\": false}}")
        let d = try JSONDecoder().decode(V5RaceDetail.self, from: Data(past.utf8))
        XCTAssertEqual(d.resultEntry?.isPast, true)
    }

    // MARK: - FALSIFICATION  (Rule 18)

    func testTheGateCatchesTheCamelCaseRegression() throws {
        // Re-key the payload the way the client USED to expect it. `V5RaceDetail`
        // decodes leniently (`c.opt` swallows a failure into nil), so the
        // regression does NOT throw — it silently blanks the section, which is
        // precisely the failure mode that hid this for as long as it did.
        //
        // Rule 18 · assert the shape of the result, not the absence of a crash.
        let regressed = Self.cimJSON
            .replacingOccurrences(of: "\"current_projection\"", with: "\"currentProjection\"")
        let d = try JSONDecoder().decode(V5RaceDetail.self, from: Data(regressed.utf8))
        XCTAssertNil(d.outlook,
                     "the decoder accepted camelCase, so it is not pinned to the server's snake_case")
        // And the correct spelling DOES populate it, so the assertion above is
        // not passing because the field is unreachable either way.
        XCTAssertNotNil(try decodeCIM().outlook)
    }

    func testTheLenientDecoderDoesNotDropTheAdditiveBLOCKS() throws {
        // THE DEFECT, AS A TEST. `V5RaceDetail` carries a hand-written
        // `init(from:)` whose `K` enum omitted `outlook` entirely, so the
        // property kept its nil default on every render since the day the
        // race-pace brain shipped. A lenient decoder is a ratchet in the wrong
        // direction: every field it forgets fails silently and forever.
        let d = try decodeCIM()
        XCTAssertNotNil(d.outlook, "outlook is not listed in V5RaceDetail.K")
        XCTAssertNotNil(d.raceLayers, "raceLayers is not listed in V5RaceDetail.K")
        XCTAssertNotNil(d.courseContext, "courseContext is not listed in V5RaceDetail.K")
    }

    func testAnIncoherentLayerSetArrivesWithItsFindingsSoTheScreenCanRefuse() throws {
        let broken = Self.cimJSON.replacingOccurrences(
            of: "\"findings\": []",
            with: "\"findings\": [\"MULTIPLE_PROJECTIONS · 2 layers labelled with the word projection\"]")
        let d = try JSONDecoder().decode(V5RaceDetail.self, from: Data(broken.utf8))
        let l = try XCTUnwrap(d.raceLayers)
        XCTAssertFalse(l.findings.isEmpty, "the refusal signal must survive the wire")
    }
}
