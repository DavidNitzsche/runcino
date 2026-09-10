//
//  WalkBackCompletionLabelTests.swift
//  faff.run iPhone · a walk-back a runner ends on purpose is not "not completed".
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS EXISTS
//
//  David, on his own 5-mile-easy-plus-6×20s-strides session, on the Today
//  screen's "Piece by piece" list: five of his six "Walk back" rows carried a
//  duration and a heart rate, then "· not completed" in dimmed text. His own
//  words: "the walk back says not completed but I did, I just didn't do the
//  full minute. I was ready to go to the next stride." He cut the recovery
//  short on purpose, not because he lost it.
//
//  WALKBACK-1 (2026-09-09) traced this to `TodayAfterV5.workoutPhasePieces` —
//  the fallback lane that renders straight off `runs.data.phases` whenever
//  the GPS-mile-keyed `routePhases` cannot represent the session (a sub-mile
//  stride+walkback structure is exactly such a case, alongside the treadmill
//  sessions the lane was built for). It stamped the raw wire `completed`
//  flag on every phase type alike with no `pace_shape` awareness at all —
//  unlike the canonical resolver on the GPS-keyed path, which never grades a
//  recovery phase on anything. `execution-semantics.ts`'s `paceShapeFor`
//  returns `'none'` for every recovery phase UNCONDITIONALLY: "A recovery has
//  no prescribed pace even when a legacy row carries one... Grading it
//  against anything is the defect." That principle is stated for PACE; a
//  walk-back's own doctrine entry (`Research/04-workout-vocabulary.md` §7.2 —
//  "Full walk-back or 60–90 s jog — no fatigue between strides") makes the
//  same point about DURATION: the recovery's job is satisfied once the
//  runner is not fatigued, which the runner judges, not the clock. The watch
//  even has a purpose-built way to act on that judgement —
//  `WorkoutEngine.endCurrentPhase()`, "End interval" — and using it on a
//  walk-back is not a lapse.
//
//  `TodayAfterV5.completionNote(type:completed:)` is the fix: a pure function
//  from a phase's raw `type`/`completed` to the string this fallback lane
//  should show, extracted so this file can prove the fix without rendering a
//  screen (Rule 15 · a case worth naming) and so a future edit that widens
//  the exemption to the wrong phase type fails here first.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE 22 · WHAT THIS GATE CANNOT FAIL ON
//
//  It proves the LABEL DECISION only — that `type == "recovery"` never reads
//  "not completed" here and every other unfinished phase still does. It
//  cannot see whether `workoutPhasePieces` is actually the lane that rendered
//  David's session (that is a live-data question, answered by the handback's
//  own render verification, not by this file), and it says nothing about the
//  GPS-keyed path's own verdict wording (`RunDetailV5`/`RepBreakdownV5`'s
//  `phaseVerdictPhrase`, covered by `V5PostRunSurfacesTests`).
//

import XCTest
@testable import Faff

final class WalkBackCompletionLabelTests: XCTestCase {

    // MARK: - 1 · the reported defect, fixed

    /// THE EXACT CASE. A walk-back ended before the modelled duration, by the
    /// runner's own hand — must say nothing at all here, not "not completed".
    func testAnEndedEarlyRecoveryCarriesNoCompletionNote() {
        XCTAssertNil(TodayAfterV5.completionNote(type: "recovery", completed: false),
                     "a walk-back cut short on purpose is not a shortfall to state")
    }

    /// A recovery that DID run to its full modelled duration must also say
    /// nothing — completion was never a claim this row makes either way.
    func testACompletedRecoveryCarriesNoCompletionNote() {
        XCTAssertNil(TodayAfterV5.completionNote(type: "recovery", completed: true))
    }

    /// Rule 11 · a payload that never said carries no claim in either
    /// direction. Nil in, nil out.
    func testARecoveryWithUnknownCompletionCarriesNoCompletionNote() {
        XCTAssertNil(TodayAfterV5.completionNote(type: "recovery", completed: nil))
    }

    // MARK: - 2 · the asymmetry this must NOT create

    /// A work phase — the treadmill interval this lane was built to flag —
    /// keeps the word. This fallback lane has no `pace_shape` awareness to
    /// route a stride's `effort` grade away the way the canonical resolver
    /// does, so an unfinished structured work interval still reads honestly.
    func testAnEndedEarlyWorkPhaseStillReadsNotCompleted() {
        XCTAssertEqual(TodayAfterV5.completionNote(type: "work", completed: false), "not completed")
    }

    /// A completed work phase says nothing — the flag names a shortfall, not
    /// a state to confirm.
    func testACompletedWorkPhaseCarriesNoCompletionNote() {
        XCTAssertNil(TodayAfterV5.completionNote(type: "work", completed: true))
    }

    // MARK: - 3 · the other bookends behave like `work`, not like `recovery`

    /// Warm-up and cool-down are `ceiling`-shaped on the canonical resolver,
    /// not `none` like recovery — `paceShapeFor` grades them and this lane's
    /// exemption must not spread past the one phase type doctrine actually
    /// excludes.
    func testEndedEarlyWarmupAndCooldownStillReadNotCompleted() {
        XCTAssertEqual(TodayAfterV5.completionNote(type: "warmup", completed: false), "not completed")
        XCTAssertEqual(TodayAfterV5.completionNote(type: "cooldown", completed: false), "not completed")
    }

    /// A phase with no recorded type at all is not a recovery by default —
    /// the exemption is only for the phase the wire NAMED `recovery`, never
    /// the absence of a name (Rule 11 again: absence is not "recovery").
    func testEndedEarlyUntypedPhaseStillReadsNotCompleted() {
        XCTAssertEqual(TodayAfterV5.completionNote(type: nil, completed: false), "not completed")
    }

    // MARK: - 4 · WALKBACK-2 · the positive label, once the watch can say why

    /// THE POSITIVE COUNTERPART WALKBACK-1's OWN HEADER CALLED OUT AS
    /// MISSING. A walk-back cut to 43 of a modelled 60 seconds, with the
    /// watch's explicit record present, reads the truthful sentence instead
    /// of silence.
    func testAnEndedEarlyRecoveryWithARecordReadsThePositiveLabel() {
        let record = V5RecoveryEndedEarly(prescribedSec: 60, actualSec: 43)
        XCTAssertEqual(
            TodayAfterV5.completionNote(type: "recovery", completed: false, endedEarly: record),
            "0:43 of 1:00 \u{00B7} advanced early")
    }

    /// A different pair of figures, to prove the sentence is built from the
    /// record's own numbers and not hardcoded.
    func testTheLabelReflectsTheRecordsOwnFigures() {
        let record = V5RecoveryEndedEarly(prescribedSec: 90, actualSec: 8)
        XCTAssertEqual(
            TodayAfterV5.completionNote(type: "recovery", completed: false, endedEarly: record),
            "0:08 of 1:30 \u{00B7} advanced early")
    }

    /// NO REGRESSION OF WALKBACK-1'S FIX: a recovery with NO record still
    /// falls back to today's silent behaviour — nil, never "not completed"
    /// and never a fabricated positive label.
    func testARecoveryWithNoRecordStillFallsBackToSilence() {
        XCTAssertNil(TodayAfterV5.completionNote(type: "recovery", completed: false, endedEarly: nil))
        // And the default-parameter call site (no third argument at all)
        // behaves identically — this is what every pre-WALKBACK-2 call site
        // in this file above already exercises.
        XCTAssertNil(TodayAfterV5.completionNote(type: "recovery", completed: false))
    }

    /// A record with a non-positive `prescribedSec` carries nothing the
    /// phone can render truthfully ("X of 0:00" is not a sentence) and must
    /// fall back to silence rather than printing a broken figure.
    func testARecordWithNoPrescribedDurationFallsBackToSilence() {
        let record = V5RecoveryEndedEarly(prescribedSec: 0, actualSec: 8)
        XCTAssertNil(TodayAfterV5.completionNote(type: "recovery", completed: false, endedEarly: record))
    }

    /// THE ASYMMETRY THIS MUST NOT CREATE, PART TWO: the positive label is
    /// consulted ONLY for `type == "recovery"`. A work phase carrying a
    /// (meaningless, server-never-sends-this) record still reads "not
    /// completed" exactly as it always has — the server's own contract
    /// (`V5WorkoutPhase.recoveryEndedEarly`'s doc comment) already promises
    /// this never happens in practice, and this pins the client's side of
    /// that promise too.
    func testAWorkPhaseNeverReadsThePositiveLabelEvenIfARecordIsPresent() {
        let record = V5RecoveryEndedEarly(prescribedSec: 60, actualSec: 43)
        XCTAssertEqual(
            TodayAfterV5.completionNote(type: "work", completed: false, endedEarly: record),
            "not completed")
    }
}
