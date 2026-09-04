//
//  V5PostRunSurfacesTests.swift
//  faff.run iPhone · the composition seam between a watch phase and a sentence.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS EXISTS
//
//  `RunDetail.phase_breakdown` was decoded by Swift for months and fed exactly
//  one thing: the colour of the route polyline. The 2026-08-11 tune-up stored
//  NINE phases — a warm-up, four 1 km reps, three jogs, a cool-down, each with
//  its own target, actual, heart rate, the watch's own grade and its seconds
//  in and out of the pace band — and run detail drew a mile-by-mile bar chart.
//  The reps were never shown.
//
//  The wire half is tested on the server (`lib/coach/_phase_breakdown.test.ts`
//  proves the fields survive `mapWatchPhases`). This is the phone half: the
//  rules that decide what a phase is allowed to SAY.
//
//  THE FIXTURE IS PRODUCTION. Every number is `dnitch85@me.com`'s own, read at
//  `faff_readonly` on 2026-08-24 out of `coach_intents.value.phases` for the
//  2026-08-11 race-week tune-up and `plan_workouts` for the ask. A fixture
//  invented to fit the code only proves the code agrees with itself.
//
//  The one exception is the skipped rep. `rep_skips` is the 8b wrist-decision
//  contract and NO run in production carries one yet, so that case is
//  constructed — and it is the most important case in the file, because
//  `completed: false` is the same byte whether the coach offered the stop or
//  the runner lost the rep.
//

import XCTest
@testable import Faff

final class V5PostRunSurfacesTests: XCTestCase {

    // MARK: - Fixtures

    private func detail(_ json: String) throws -> RunDetail {
        try JSONDecoder().decode(RunDetail.self, from: Data(json.utf8))
    }

    private var tuneUp: RunDetail { RunDetailV5Sample.intervals }
    private var tuneUpWithSkip: RunDetail { RunDetailV5Sample.intervalsWithSkip }

    private func view(_ d: RunDetail, recap: RunRecap? = nil) -> RunDetailV5 {
        RunDetailV5(detail: d, recap: recap)
    }

    // MARK: - The wire carries what the watch recorded

    func testPhaseBreakdownDecodesVerdictAndTolerance() throws {
        let phases = try XCTUnwrap(tuneUp.phase_breakdown)
        XCTAssertEqual(phases.count, 9)
        XCTAssertEqual(phases.map(\.verdict),
                       ["missed", "missed", "hit", "missed", "missed",
                        "drifted", "missed", "drifted", "missed"])
        XCTAssertEqual(phases.map(\.time_in_tolerance_sec),
                       [25, 15, 70, 15, 5, 155, 0, 170, 15])
        XCTAssertEqual(phases.map(\.time_out_of_tolerance_sec),
                       [675, 225, 20, 225, 85, 95, 90, 90, 490])
    }

    /// ZERO IS A READING. Phase six spent none of its 90 seconds in band. That
    /// is not the same answer as a treadmill phase the console never graded,
    /// and `Number(null)` collapsing to 0 on the server would have made them
    /// identical.
    func testZeroSecondsInBandIsNotNil() throws {
        let phases = try XCTUnwrap(tuneUp.phase_breakdown)
        XCTAssertEqual(phases[6].time_in_tolerance_sec, 0)
    }

    /// A FRACTIONAL HEART RATE MUST NOT TAKE DOWN THE SCREEN. HealthKit and
    /// Apple Watch averaging emit `164.5`, which is JSON-valid and throws
    /// `Int.self`. `phase_breakdown` is read with `try c.decodeIfPresent`,
    /// which re-raises — so one fractional bpm inside one phase used to fail
    /// the ENTIRE `RunDetail` decode, not just the phase list.
    func testFractionalNumbersDoNotFailTheDecode() throws {
        let d = try detail("""
        {
          "id": "r", "date": "2026-08-11", "source": "watch", "type": "threshold",
          "distance_mi": 6.0, "has_route": false, "splits": [],
          "hrZonePcts": { "z1": 0, "z2": 0, "z3": 0, "z4": 100, "z5": 0 },
          "phase_breakdown": [
            { "index": 0, "label": "Rep", "type": "work", "avg_hr": 164.5,
              "avg_cadence": 171.4, "actual_duration_sec": 237.6,
              "actual_pace": "6:21", "completed": true,
              "verdict": "drifted", "time_in_tolerance_sec": 15.0,
              "time_out_of_tolerance_sec": 225.0 }
          ]
        }
        """)
        let phases = try XCTUnwrap(d.phase_breakdown)
        XCTAssertEqual(phases.count, 1)
        XCTAssertEqual(phases[0].avg_hr, 165)             // rounded, not thrown
        XCTAssertEqual(phases[0].time_in_tolerance_sec, 15)
        XCTAssertEqual(d.distance_mi, 6.0)                // the run survived
    }

    // MARK: - Rule three · a refusal is a correct answer

    /// A run with no phases draws NOTHING. Not a header over an empty list,
    /// which reads as a section that failed to load.
    func testNoPhasesDrawsNoSection() {
        let v = view(RunDetailV5Sample.outdoor)
        XCTAssertTrue(v.repPieces.isEmpty)
        XCTAssertNil(v.toleranceLine)
    }

    /// A SINGLE-PHASE SESSION IS THE WHOLE RUN. The poster at the top already
    /// carries its distance, time and pace; a list of one restates them. The
    /// tolerance line still draws, because that is a fact the poster does not
    /// hold — and on 2026-08-23 it is the only honest thing on the screen.
    func testSinglePhaseDrawsToleranceButNoList() throws {
        let d = try detail("""
        {
          "id": "aug23", "date": "2026-08-23", "source": "watch", "type": "easy",
          "distance_mi": 11.01, "pace": "8:01", "has_route": false, "splits": [],
          "hrZonePcts": { "z1": 4, "z2": 41, "z3": 38, "z4": 15, "z5": 2 },
          "phase_breakdown": [
            { "index": 0, "label": "5.0 mi easy", "type": "work",
              "target_pace": "9:22", "target_pace_sec": 562,
              "actual_pace": "7:58", "actual_distance_mi": 5,
              "actual_duration_sec": 2389, "avg_hr": 147, "max_hr": 171,
              "completed": true, "status": "fast", "verdict": "missed",
              "time_in_tolerance_sec": 90, "time_out_of_tolerance_sec": 2280 }
          ]
        }
        """)
        let v = view(d)
        XCTAssertTrue(v.repPieces.isEmpty)
        // 90 in, 2370 graded. LESS-IS-MORE-2, 2026-09-05 · plain-language
        // rewrite, and "target pace" → "pace window" (this sums only
        // non-ceiling phases, so "window" is the correct word for it).
        XCTAssertEqual(v.toleranceLine,
                       "Held the pace window for 1:30 of 39:30 of graded work.")
    }

    // MARK: - The rep list

    func testRepListNamesEveryPhaseInOrder() {
        let pieces = view(tuneUp).repPieces
        XCTAssertEqual(pieces.map(\.label), [
            "Warm-up", "Interval \u{00B7} 1 km", "Jog 1:30", "Interval \u{00B7} 1 km",
            "Jog 1:30", "Interval \u{00B7} 1 km", "Jog 1:30", "Interval \u{00B7} 1 km",
            "Cool-down",
        ])
        XCTAssertEqual(pieces.map(\.isWork), [false, true, false, true, false, true, false, true, false])
    }

    /// Four reps makes it a rep set. A tempo with one work block does not get
    /// called "Rep by rep" — that would name something a rep the plan never
    /// called one.
    func testSectionTitleFollowsTheSessionShape() throws {
        XCTAssertEqual(view(tuneUp).repSectionTitle, "Rep by rep")
        let tempo = try detail("""
        {
          "id": "r", "date": "2026-08-01", "source": "watch", "type": "tempo",
          "distance_mi": 8, "has_route": false, "splits": [],
          "hrZonePcts": { "z1": 0, "z2": 0, "z3": 0, "z4": 100, "z5": 0 },
          "phase_breakdown": [
            { "index": 0, "label": "Warm-up", "type": "warmup", "actual_pace": "8:57", "completed": true },
            { "index": 1, "label": "4.0 mi tempo", "type": "work", "actual_pace": "7:18", "completed": true },
            { "index": 2, "label": "Cool-down", "type": "cooldown", "actual_pace": "9:01", "completed": true }
          ]
        }
        """)
        XCTAssertEqual(view(tempo).repSectionTitle, "Piece by piece")
    }

    /// RULE ONE, updated for PACE-CONTRACT-1 (2026-09-05). An actual pace is
    /// a reading off the wrist. A target pace comes out of the plan's pace
    /// table, worded for its SHAPE (`paceContractText`) — and `tuneUp` is
    /// the 2026-08-11 fixture, genuinely dated BEFORE `pace_shape` shipped
    /// (2026-09-01). A work rep with a real target and tolerance but no
    /// shape opinion at all is exactly the "unrecognised/absent shape" case
    /// `paceContractText`'s own header documents choosing nil for, on
    /// purpose, over guessing a contract the wire never named — so this
    /// authentic pre-dated-the-field row correctly shows nothing now,
    /// where it used to show the bare, un-shaped number.
    func testOnlyWorkRepsCarryAnAsk() {
        let pieces = view(tuneUp).repPieces
        for p in pieces {
            XCTAssertNil(p.askedPace, "\(p.label): a payload with no pace_shape must not guess a contract")
        }
    }

    /// The watch's four grades, in plain words, on work reps only. A jog the
    /// device marked 'missed' against easy pace is a jog executed exactly as
    /// written.
    func testVerdictWordsAndTheJogThatIsNeverGraded() {
        let pieces = view(tuneUp).repPieces
        XCTAssertEqual(pieces.map(\.verdictPhrase), [
            nil,                            // warm-up
            "Outside the band",             // rep 1 · missed
            nil,                            // jog · the device said 'hit'
            "Outside the band",             // rep 2 · missed
            nil,                            // jog · the device said 'missed'
            "In and out of the band",       // rep 3 · drifted
            nil,                            // jog · the device said 'missed'
            "In and out of the band",       // rep 4 · drifted
            nil,                            // cool-down
        ])
    }

    func testDetailLineCarriesDistanceDurationAndHeartRate() {
        let pieces = view(tuneUp).repPieces
        XCTAssertEqual(pieces[1].detail, "0.6 mi \u{00B7} 3:57 \u{00B7} HR 164")
        XCTAssertEqual(pieces[1].actualPace, "6:21/mi")
    }

    // MARK: - A DECISION IS NOT A LAPSE

    /// The rule the whole register exists for, and the one easiest to break.
    ///
    /// The fixture leaves `verdict: "drifted"` ON the skipped phase — the
    /// watch graded the rep before the runner took the offer — so this proves
    /// the guard lives in the composer and is not an accident of the payload.
    func testAChosenSkipIsNeverGraded() {
        let pieces = view(tuneUpWithSkip).repPieces
        let skipped = pieces.first(where: { $0.chosen })
        XCTAssertNotNil(skipped, "the fixture's fourth rep must arrive as a chosen skip")
        XCTAssertNil(skipped?.verdictPhrase, "a rep the coach offered to stop may not be graded")
        // Nothing, not a dash. `FaffValue.measured(nil)` is `.unreadable`,
        // which draws "—" in FAULT RED and means "we tried to read this and
        // could not". The rep was never run.
        XCTAssertNil(skipped?.actualPace)
        XCTAssertEqual(RepBreakdownV5.note(skipped!), "You took the stop the watch offered")
        // PACE-CONTRACT-1 · `tuneUpWithSkip` predates `pace_shape` (2026-08-11
        // vs the field's 2026-09-01 ship date), same as `tuneUp` — see
        // `testOnlyWorkRepsCarryAnAsk`'s header. Correctly nil now rather
        // than a guessed bare number.
        XCTAssertNil(skipped?.askedPace)
    }

    /// `RunRepSkip.repIndex` counts REPS; `PhaseBreakdown.index` counts
    /// PHASES, with the jogs in between. The fourth rep is phase seven.
    func testSkipIndexResolvesRepOrdinalToPhaseIndex() {
        XCTAssertEqual(view(tuneUpWithSkip).chosenSkipPhaseIndices, [7])
        XCTAssertTrue(view(tuneUp).chosenSkipPhaseIndices.isEmpty)
    }

    /// A skipped rep contributes no graded seconds, so the denominator shrinks
    /// with it. Counting the rep the runner did not run as time out of band
    /// would charge them for the decision.
    func testToleranceLineExcludesTheSkippedRep() {
        XCTAssertEqual(view(tuneUp).toleranceLine,
                       "Held the pace window for 5:55 of 16:30 of graded work.")
        XCTAssertEqual(view(tuneUpWithSkip).toleranceLine,
                       "Held the pace window for 3:05 of 12:10 of graded work.")
    }

    /// WORK PHASES ONLY. The 2026-08-11 cool-down alone spent 490 seconds out
    /// of band, more than every rep together — a runner jogging home slowly
    /// must not make a executed set read as ragged.
    func testToleranceLineIgnoresWarmupAndCooldown() throws {
        let phases = try XCTUnwrap(tuneUp.phase_breakdown)
        let allSec = phases.reduce(0) { $0 + ($1.time_in_tolerance_sec ?? 0) + ($1.time_out_of_tolerance_sec ?? 0) }
        XCTAssertGreaterThan(allSec, 990 * 2, "the fixture must actually contain the trap")
        XCTAssertTrue(view(tuneUp).toleranceLine?.contains("16:30") == true)
    }

    // MARK: - Per-split heart rate · round three item 5, pending a ruling

    /// `RunSplit.hr` sat in the same row the chart reads pace from and nothing
    /// ever read it. It travels with the bar now. Whether it gets a VISIBLE
    /// channel is design's call and is still open (`DESIGN-ASKS-ROUND-3.md`
    /// item 5 asks them to confirm the chart is bars only), so for now it
    /// reaches VoiceOver and changes nothing a sighted reader sees.
    func testSplitBarsCarryHeartRate() {
        let bars = view(RunDetailV5Sample.intervals).splitBars
        XCTAssertEqual(bars.count, 7)
        XCTAssertEqual(bars.map(\.hr), [124, 146, 168, 158, 159, 155, 155])
        // The shape reading is untouched: height is still pace and nothing
        // else, and the trailing fragment is still drawn at its real width.
        XCTAssertEqual(bars[0].paceSec, 464)
        XCTAssertLessThan(bars[6].fraction, 0.95)
    }

    // MARK: - Asked vs ran, on run detail

    /// This screen showed a pace with nothing to read it against.
    func testAskedPaceShowsOnASteadyRun() {
        let v = view(RunDetailV5Sample.outdoor, recap: RunDetailV5Sample.recap)
        XCTAssertEqual(v.askedPaceText, "9:15")
    }

    /// SUPPRESSED ON A REP SESSION, and this is the guard that matters. The
    /// evaluated target is the REP pace, 6:52; the poster's pace is the
    /// average of a warm-up, four reps, three jogs and a cool-down, 7:18.
    /// Printing one under the other invites the runner to subtract two numbers
    /// that were never about the same thing, and reads as a 26-second miss on
    /// a session they executed.
    func testAskedPaceIsSuppressedOnARepSession() {
        let v = view(RunDetailV5Sample.intervals, recap: RunDetailV5Sample.intervalsRecap)
        XCTAssertEqual(v.recap?.evaluatedPaceSPerMi, 412, "the recap must carry the target it judged against")
        XCTAssertNil(v.askedPaceText, "a rep session names its ask per rep, never once over the whole run")
    }

    // MARK: - The recap's other four sentences

    /// `RunRecap` decoded `facts`, `win` and `conditions_note` and both
    /// after-run screens drew only `verdict`. The sentences were composed,
    /// returned, decoded, and discarded.
    func testRecapCarriesEverySentenceTheEngineWrote() {
        let r = RunDetailV5Sample.intervalsRecap
        XCTAssertEqual(r.win, "4 on the rail \u{00B7} clean set.")
        XCTAssertEqual(r.facts.count, 2)
        XCTAssertTrue(r.facts[0].hasPrefix("4 reps at 6:21"))
        XCTAssertNotNil(r.coach_tip)
        XCTAssertNil(r.conditions_note)   // a neutral day, and null is an answer
    }

    /// An enum is not a name. Run detail title-cased `type` and handed it to
    /// the display register, which is uppercase, so a race-week tune-up
    /// headlined RACE_WEEK_TUNEUP — a column value printed at a runner in
    /// 44pt Archivo.
    func testTheTitleIsAWordNotAColumnValue() throws {
        XCTAssertEqual(RunDetailV5Sample.intervals.type_display, "Tune-up")
        XCTAssertEqual(view(RunDetailV5Sample.intervals).title, "Tune-up")

        // And on a server that predates the field, an underscore still may not
        // reach the glass. "Race week tuneup" is not the word the plan uses —
        // the server owns that table and this is only the fallback — but it is
        // a phrase rather than a leaked column value.
        let old = try detail("""
        {
          "id": "r", "date": "2026-08-11", "source": "watch", "type": "race_week_tuneup",
          "distance_mi": 6.3, "has_route": false, "splits": [],
          "hrZonePcts": { "z1": 0, "z2": 0, "z3": 0, "z4": 100, "z5": 0 }
        }
        """)
        XCTAssertNil(old.type_display)
        XCTAssertFalse(view(old).title.contains("_"), "an enum may not reach the display register")
        XCTAssertEqual(view(old).title, "Race week tuneup")
    }
}
