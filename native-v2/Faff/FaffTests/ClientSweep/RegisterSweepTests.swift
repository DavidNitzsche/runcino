//
//  RegisterSweepTests.swift
//  faff.run iPhone · what is allowed to reach the glass, and as what.
//
//  ─────────────────────────────────────────────────────────────────────────
//  TWO WAYS A VALUE ARRIVES IN THE WRONG REGISTER.
//
//  1 · AN ENUM REACHES THE GLASS AT ALL.
//      `RACE_WEEK_TUNEUP` headlined a screen in 44pt Archivo because a `type`
//      was upper-cased straight into the display register. The token was a
//      database value; the screen treated it as a word. The map has covered
//      that particular type since — but the phone ALSO has a fallback of its
//      own (`FaffEffort.fromType` returns `.easy` for anything unknown), and
//      that fallback is worse than the raw token: an unmapped quality session
//      renders as a green easy run, which is a lie rather than an eyesore.
//      That is not hypothetical either. It is exactly what `race_week_tuneup`
//      did before someone noticed.
//
//  2 · A MODELLED NUMBER LOOKS MEASURED.
//      Rule one, and the only real sin. The amber tilde was retired on
//      2026-08-21 because nobody could interpret it, and the distinction was
//      kept in the DATA and in VOICEOVER instead — "a LABEL beats a symbol".
//      Which means one string is now carrying the whole rule at the point of
//      render, and nothing was checking it.
//
//  `TypeVocabulary` is generated from the server's own title map, so a type
//  added to the plan with no word for it fails here rather than on a runner's
//  screen.
//

import XCTest
@testable import Faff

final class RegisterSweepTests: XCTestCase {

    // MARK: - 1 · no enum reaches the glass

    /// Every type the server can send must have an EXPLICIT case on the phone.
    ///
    /// `FaffEffort.fromType` ends in `default: return .easy`, so a type it has
    /// never heard of is indistinguishable from a recovery jog — same hero,
    /// same week-strip dot, same hard-day accounting. The only way to tell a
    /// real `.easy` from a fallback `.easy` is to ask whether the token is one
    /// the switch actually names, which is what this does.
    func testEveryServerTypeHasAnExplicitEffortOnThePhone() {
        let ledger = SweepLedger("register · type vocabulary", floor: 15)

        // Types that genuinely ARE easy-effort, so an `.easy` answer here is
        // the switch agreeing rather than the switch giving up.
        let legitimatelyEasy: Set<String> = ["easy", "shakeout"]
        // Types with no effort of their own — they are not runs.
        let notRuns: Set<String> = ["cross", "strength", "unplanned", "post_race"]

        for t in TypeVocabulary.all {
            ledger.exercised("FaffEffort.fromType")

            // The server's own word must never be a raw token.
            if t.serverTitle.contains("_") {
                ledger.found("workoutTypeTitle",
                             "\(t.wire) headlines as \"\(t.serverTitle)\"",
                             onScreen: "a database value in 44pt Archivo where a word should be")
            }

            guard !notRuns.contains(t.wire) else { continue }
            let effort = FaffEffort.fromType(t.wire)
            guard effort == .easy, !legitimatelyEasy.contains(t.wire) else { continue }

            ledger.found("FaffEffort.fromType",
                         "\(t.wire) fell through to the `default: .easy` arm",
                         onScreen: "a quality session drawn as an easy run — the hero, the week-strip dot and the hard-day count all wrong, and nothing saying so")
        }

        ledger.settle()
    }

    /// The phone's own words must be words. A guard on the mapping itself
    /// rather than on its inputs.
    func testEveryEffortLabelIsHumanCopy() {
        for effort in FaffEffort.allCases {
            XCTAssertFalse(effort.title.contains("_"), "\(effort) title carries an underscore")
            XCTAssertFalse(effort.effortLabel.contains("_"), "\(effort) effortLabel carries an underscore")
            XCTAssertNotEqual(effort.title, effort.title.uppercased(),
                              "\(effort).title is ALL CAPS — it is documented as title-case, with .uppercased() applied at the call site")
        }
    }

    // MARK: - 2 · a modelled number never looks measured

    /// The wire's flag must survive into the type, and ABSENCE MUST READ AS
    /// MODELLED. Over-marking makes a real number look humble; under-marking
    /// is the sin.
    func testAbsentProvenanceReadsAsModelled() throws {
        let noFlag = try JSONDecoder().decode(
            V5Number.self, from: Data(#"{"text":"3:16:45"}"#.utf8))
        XCTAssertTrue(noFlag.modelled, "a payload with no `modelled` flag must not be treated as measured")
        XCTAssertEqual(noFlag.value.basis, .modelled)

        let flagged = try JSONDecoder().decode(
            V5Number.self, from: Data(#"{"text":"1:41:53","modelled":false}"#.utf8))
        XCTAssertEqual(flagged.value.basis, .measured)

        // A junk flag must not read as measured either.
        let junk = try JSONDecoder().decode(
            V5Number.self, from: Data(#"{"text":"3:16:45","modelled":"yes"}"#.utf8))
        XCTAssertTrue(junk.modelled, "an unreadable flag must fall to modelled, never to measured")
    }

    /// RULE ONE'S LAST REMAINING CARRIER.
    ///
    /// The tilde is gone. `voiceOverLabel` is what is left, and if it ever
    /// stops saying "estimated" the distinction has been silently deleted from
    /// the product with nothing on screen to show for it.
    func testAModelledValueSaysEstimatedOutLoud() {
        let ledger = SweepLedger("register · provenance", floor: 12)

        let figures = ["3:16:45", "7:42/mi", "42.2", "152"]
        for text in figures {
            ledger.exercised("FaffValue.voiceOverLabel")
            let modelled = FaffValue.modelled(text)
            XCTAssertEqual(modelled.basis, .modelled)
            guard !modelled.voiceOverLabel.hasPrefix("estimated ") else { continue }
            ledger.found("FaffValue.voiceOverLabel",
                         "a modelled \(text) is announced as \"\(modelled.voiceOverLabel)\"",
                         onScreen: "a projection read aloud as a result, with the tilde already retired and nothing else marking it")
        }

        for text in figures {
            ledger.exercised("FaffValue.voiceOverLabel")
            let measured = FaffValue.measured(text)
            guard measured.voiceOverLabel.contains("estimated") else { continue }
            ledger.found("FaffValue.voiceOverLabel",
                         "a MEASURED \(text) is announced as estimated",
                         onScreen: "a real result hedged as a guess — the harmless direction, but still wrong")
        }

        ledger.exercised("FaffValue.voiceOverLabel")
        XCTAssertEqual(FaffValue.unreadable.voiceOverLabel, "could not be read",
                       "an unreadable value must say so rather than reading its dash aloud")

        // A PHRASE CARRIES NO MARK. "Finish healthy" is a target the engine
        // worded rather than counted; there is no figure in it to qualify, and
        // announcing "estimated Finish healthy" is the mark applied to prose.
        ledger.exercised("FaffValue.from")
        let phrase = FaffValue.from("Finish healthy", modelled: true)
        XCTAssertEqual(phrase.basis, .measured,
                       "a value with no digit in it has nothing for rule one to protect")

        ledger.exercised("FaffValue.from")
        let figure = FaffValue.from("3:16:45", modelled: true)
        XCTAssertEqual(figure.basis, .modelled,
                       "the moment a digit appears the distinction comes back")

        ledger.exercised("FaffValue.from")
        XCTAssertEqual(FaffValue.from(nil, modelled: true).basis, .unreadable,
                       "nil is unreadable, never an empty string that reads as zero")

        ledger.settle()
    }
}
