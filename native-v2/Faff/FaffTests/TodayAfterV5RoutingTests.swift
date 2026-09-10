//
//  TodayAfterV5RoutingTests.swift
//  faff.run iPhone · ROUTING-1 (2026-09-09).
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE FIXTURE IS PRODUCTION (Rule 13, clause 2).
//
//  `MID_WRITE_JSON` below is David's real 2026-09-09 5-mile-easy-plus-6-strides
//  run, `runs.id -218380344929823`, read read-only at `faff_readonly`. Every
//  phase value — type, label, durationSec, avgHr, speedMph — is copied
//  verbatim from `data.phases`. `routeSplits` and `routePhases` are forced
//  empty to reproduce the TRANSIENT WINDOW the investigation proved real: the
//  row's own `fetched_at` (14:17:04) sits nineteen minutes before its own
//  `data.ingestedAt` (14:36:46), which is the two-write gap this fixture
//  stands in for — `phases` on the row, `splits` not yet. `workoutPhases`
//  stays populated because THAT field reads `data.phases` directly and is
//  never gated on the mile-split derivation landing (`WORKOUTPHASES-1`).
//
//  This is not an idealised case invented to fit the fix. It is the shape
//  that broke, reproduced from the real numbers.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT THIS FILE PROVES
//
//  1. FAIL-BEFORE (falsifier): `workoutPhasePieces` — read straight off
//     `data.phases`, exactly as `TodayAfterV5` always has — is non-empty for
//     this run and every one of its pace fields is nil. That is the raw,
//     undeduplicated, no-pace list the runner actually saw. If a future edit
//     makes this assertion fail, this test has stopped describing the bug.
//  2. PASS-AFTER: `breakdownPieces` — the gate ROUTING-1 added — is EMPTY for
//     this same fixture, because the run is not indoor. The wrong lane can no
//     longer reach the screen, regardless of why `sectionPieces` came back
//     empty.
//  3. The server-side fix, exercised at the routing seam it feeds: once
//     `routeSplits` carries the one honest phase-fallback row
//     (`lib/runs/splits-pick.ts`'s `phaseFallbackSplits`, proven server-side in
//     `_phase_fallback_splits.test.ts`), `hasMiles` is true and
//     `PostRunShapeV5.decomposition` correctly resolves `.milesAndSections`.
//

import XCTest
@testable import Faff

final class TodayAfterV5RoutingTests: XCTestCase {

    private func decode(_ json: String) -> V5Today {
        // swiftlint:disable:next force_try
        try! JSONDecoder().decode(V5Today.self, from: Data(json.utf8))
    }

    private func view(_ model: V5Today) -> TodayAfterV5 {
        TodayAfterV5(model: model)
    }

    // MARK: - The reproduction

    /// `phases` verbatim, `routeSplits`/`routePhases` forced empty — the
    /// mid-write window.
    private var midWrite: V5Today { decode(Self.midWriteJSON) }

    /// The SAME run, with the server-side fix's one honest row on
    /// `routeSplits` — what `phaseFallbackSplits` produces from the 5.0 mi
    /// work phase alone (proven server-side; this is the wire shape it sends).
    private var withPhaseFallback: V5Today { decode(Self.withPhaseFallbackJSON) }

    // MARK: - 1 · FAIL-BEFORE falsifier

    func testWorkoutPhasePiecesIsTheRawUndedupedNoPaceList() {
        let pieces = view(midWrite).workoutPhasePieces
        XCTAssertEqual(pieces.count, 14, "all fourteen raw phases — the 5mi body, six strides, six walk-backs, one overtime tail")
        XCTAssertTrue(pieces.allSatisfy { $0.actualPace == nil },
                      "workoutPhasePieces hard-codes actualPace: nil on every row — this is the reported 'no pace on the 5-mile phase'")
        // The strides and their walk-backs appear TWICE each — once as the
        // stride, once as the following walk-back — with no grouping. This is
        // the reported "raw/undeduplicated stride and walk-back pairs".
        let labels = pieces.map(\.label)
        XCTAssertEqual(labels.filter { $0.contains("Stride") }.count, 6)
        XCTAssertEqual(labels.filter { $0 == "Walk back" }.count, 6)
    }

    // MARK: - 2 · PASS-AFTER

    func testBreakdownPiecesDoesNotFallBackToTheTreadmillLaneOutdoors() {
        XCTAssertEqual(view(midWrite).shape, .steady, "workoutType 'easy', not indoor")
        XCTAssertTrue(view(midWrite).sectionPieces.isEmpty, "the fixture reproduces routePhases not yet landed")
        XCTAssertTrue(view(midWrite).milePieces.isEmpty, "the fixture reproduces routeSplits not yet landed")
        // THE FIX. Before ROUTING-1 this equalled `workoutPhasePieces` (14
        // raw rows). An outdoor run with neither miles nor sections now draws
        // nothing, which `breakdownSection`'s `.none` case (Rule 11's refusal)
        // already knows how to render.
        XCTAssertTrue(view(midWrite).breakdownPieces.isEmpty,
                      "an outdoor run must never fall into the treadmill-only lane")
    }

    func testTheTreadmillLaneStillWorksOnAnActualTreadmillRun() {
        let indoorJSON = Self.midWriteJSON
            .replacingOccurrences(
                of: "\"onTheBelt\": null",
                with: "\"onTheBelt\": [{\"label\": \"Avg speed\", \"value\": {\"text\": \"6.9\", \"modelled\": false}, \"tone\": null}]")
        let model = decode(indoorJSON)
        XCTAssertEqual(view(model).shape, .indoor)
        // The lane this fallback was actually built for is untouched by the gate.
        XCTAssertEqual(view(model).breakdownPieces.count, 14)
    }

    // MARK: - 3 · the server fix, at the seam it feeds

    func testPhaseFallbackRowRestoresTheMilesAndSectionsLane() {
        XCTAssertFalse(view(withPhaseFallback).milePieces.isEmpty, "the one honest row makes hasMiles true")
        XCTAssertEqual(view(withPhaseFallback).milePieces.first?.paceSec, 521, "8:41/mi — the phase's own measured pace")
        XCTAssertEqual(view(withPhaseFallback).milePieces.first?.distanceMi, 5.01)
        let d = view(withPhaseFallback).shape.decomposition(
            hasSections: !view(withPhaseFallback).breakdownPieces.isEmpty,
            hasMiles: !view(withPhaseFallback).milePieces.isEmpty)
        XCTAssertEqual(d, .miles, "sectionPieces is still empty in this fixture — routePhases grading is a separate landing")
    }

    // MARK: - Fixtures

    private static let midWriteJSON = """
    {
      "dateISO": "2026-09-09",
      "state": "after_run",
      "workoutType": "easy",
      "panel": {
        "dayState": "easy", "quiet": false, "place": "Today",
        "dateLine": "Wednesday 9 Sep", "weekLine": "Logged 49:07",
        "kicker": null, "type": "Easy", "dose": null,
        "stats": [
          { "label": "Distance", "value": { "text": "5.58", "modelled": false }, "tone": null },
          { "label": "Time", "value": { "text": "49:07", "modelled": false }, "tone": null },
          { "label": "Pace", "value": { "text": "8:48", "modelled": false }, "tone": null }
        ]
      },
      "weekStrip": [], "groups": [], "why": null,
      "whereYouAre": [], "beforeYouGo": [], "askedVsRan": [],
      "verdict": null, "facts": [], "win": null, "conditionsNote": null, "coachTip": null,
      "zoneShares": null, "zoneTarget": null, "zoneTargets": null, "elevation": null,
      "onTheBelt": null, "shoesWorn": null, "whatThisDidToTheWeek": [],
      "runId": "-218380344929823", "changed": null, "injury": null, "weekOff": null,
      "offSeason": null, "notOnPhoneYet": null,
      "routeSplits": [],
      "routePhases": [],
      "workoutPhases": [
        { "type": "work", "label": "5.0 mi easy", "durationSec": 2607, "avgHr": 133, "maxHr": 144, "completed": true, "speedMph": null, "inclinePct": null },
        { "type": "work", "label": "Stride 1 of 6", "durationSec": 20, "avgHr": 135, "maxHr": 137, "completed": true, "speedMph": null, "inclinePct": null },
        { "type": "recovery", "label": "Walk back", "durationSec": 30, "avgHr": 144, "maxHr": 148, "completed": false, "speedMph": null, "inclinePct": null },
        { "type": "work", "label": "Stride 2 of 6", "durationSec": 22, "avgHr": 137, "maxHr": 140, "completed": true, "speedMph": null, "inclinePct": null },
        { "type": "recovery", "label": "Walk back", "durationSec": 43, "avgHr": 141, "maxHr": 147, "completed": false, "speedMph": null, "inclinePct": null },
        { "type": "work", "label": "Stride 3 of 6", "durationSec": 21, "avgHr": 126, "maxHr": 132, "completed": true, "speedMph": null, "inclinePct": null },
        { "type": "recovery", "label": "Walk back", "durationSec": 61, "avgHr": 135, "maxHr": 146, "completed": true, "speedMph": null, "inclinePct": null },
        { "type": "work", "label": "Stride 4 of 6", "durationSec": 20, "avgHr": 109, "maxHr": 115, "completed": true, "speedMph": null, "inclinePct": null },
        { "type": "recovery", "label": "Walk back", "durationSec": 24, "avgHr": 132, "maxHr": 138, "completed": false, "speedMph": null, "inclinePct": null },
        { "type": "work", "label": "Stride 5 of 6", "durationSec": 22, "avgHr": 131, "maxHr": 136, "completed": true, "speedMph": null, "inclinePct": null },
        { "type": "recovery", "label": "Walk back", "durationSec": 38, "avgHr": 144, "maxHr": 149, "completed": false, "speedMph": null, "inclinePct": null },
        { "type": "work", "label": "Stride 6 of 6", "durationSec": 21, "avgHr": 135, "maxHr": 142, "completed": true, "speedMph": null, "inclinePct": null },
        { "type": "recovery", "label": "Walk back", "durationSec": 8, "avgHr": 139, "maxHr": 139, "completed": false, "speedMph": null, "inclinePct": null },
        { "type": "overtime", "label": "After the session", "durationSec": 10, "avgHr": null, "maxHr": null, "completed": true, "speedMph": null, "inclinePct": null }
      ]
    }
    """

    /// Same run, `routeSplits` carrying the server fix's one honest row.
    private static let withPhaseFallbackJSON = midWriteJSON.replacingOccurrences(
        of: "\"routeSplits\": [],",
        with: """
        "routeSplits": [
          { "mile": 1, "pace": "8:41", "hr": 133, "cadence": null, "elev_change_ft": null, "distanceMi": 5.01 }
        ],
        """)
}
