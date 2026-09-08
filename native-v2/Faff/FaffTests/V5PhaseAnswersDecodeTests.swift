//
//  V5PhaseAnswersDecodeTests.swift
//  faff.run iPhone · PHASEANSWERS-PHONE-1 — the phase's own answers reach the
//  Block screen.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT WENT WRONG
//
//  `lib/plan/phase-answers.ts` has written six sentences per phase since
//  PHASE-ANSWERS-1 (2026-09-01), and `lib/plan/v5-block.ts:buildPhases` has
//  spread every one of them onto `/api/v5/block` ever since, saying so in its
//  own comment: "ADDITIVE keys on the wire (`developing`, `whyNow`,
//  `evidence`, `hold`, `progress`, `restructure`) — the phone's lenient
//  decoder ignores what it does not read."
//
//  It ignored all six. `V5Phase` declared five properties and relied on a
//  SYNTHESISED `Decodable`, which drops an unmatched key with no error and no
//  warning, so the block screen drew a progress bar and nothing else. The two
//  that mattered most were `hold` and `progress` — between them the only
//  answer this app gives to "what must I demonstrate to earn the next step",
//  composed by the engine, stored on the plan, and never once shown:
//
//    "Three corroborated sessions faster than target with heart rate in the
//     band move the threshold anchor. A long run finished under control earns
//     the next step in duration. One stressor moves at a time."
//
//  This is the same failure shape as SKIPCAL-1 one week earlier, and it is a
//  WIRE-SHAPE test for the same reason: nothing misbehaved. The app rendered
//  correctly for the data it believed it had. The only way to catch it is to
//  feed the decoder the server's actual keys and check the values come out.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT THIS FILE CANNOT FAIL ON (Rule 22)
//
//  It exercises the DECODER and `V5Block.arcProgressionLines`, which is the
//  exact expression `BlockV5.arcSection` draws from. It does not build a
//  SwiftUI view, so it cannot tell you that `arcSection` still CALLS that
//  resolver — a surface that quietly stops calling the shared resolver is
//  exactly the failure Rule 16 warns about, and only rendering catches it.
//  That half was verified by rendering the real account on a simulator
//  (Rule 13), not here.
//
//  Nor can it see LAYOUT. It knows the two sentences are resolved for the
//  screen; it does not know they are legible, ordered on the page, or inside
//  the section a runner would look in.
//
//  It also cannot judge whether the engine's sentences are RIGHT. Every string
//  in this file is the engine's, quoted; whether "three corroborated sessions"
//  is the correct bar belongs to `phase-answers.ts` and its doctrine gate.
//
//  And it says nothing about the four fields that are decoded but not yet
//  drawn (`developing` / `whyNow` / `evidence` / `restructure`). It asserts
//  they DECODE, which is the whole claim being made about them.
//
import XCTest
@testable import Faff

final class V5PhaseAnswersDecodeTests: XCTestCase {

    // MARK: - Fixtures
    //
    // Shaped exactly as `buildPhases` emits it: `id` / `name` / `weeks` /
    // `current` / `at` always, then the six answer keys SPREAD IN — present
    // together or absent together, never null, because the server writes
    // `...(answers ? {…} : {})` precisely so that "this block predates the
    // answers" is said by absence (Rule 11).
    //
    // The two sentences on the QUALITY phase are verbatim from
    // `phase-answers.ts`'s QUALITY arm and are the strings a Product
    // Experience reviewer captured off the real wire. The BASE ones are
    // verbatim from its BASE arm.

    private static let baseHold =
        "Easy days that run above the heart-rate ceiling, or a week that is not absorbed, hold volume where it is."
    private static let baseProgress =
        "Weeks absorbed at the prescribed volume earn the next step, toward 48 mi by the end of the phase."
    private static let qualityHold =
        "Quality sessions not held with control, or heart rate climbing well past the band for the pace, hold pace where it is. A long run that fades late holds duration."
    private static let qualityProgress =
        "Three corroborated sessions faster than target with heart rate in the band move the threshold anchor. A long run finished under control earns the next step in duration. One stressor moves at a time."

    /// A block whose CURRENT phase is QUALITY and whose non-current BASE phase
    /// carries a full answer set of its own. The point of giving BOTH phases
    /// answers is that "only the current phase renders" is then a real claim
    /// rather than an artefact of the other phase having nothing to show.
    private func blockJSON(currentPhaseFields: String, otherPhaseFields: String) -> Data {
        let json = """
        {
          "panel": {
            "dayState": "phase", "quiet": false, "place": "Block",
            "dateLine": "Week 9 of 16", "weekLine": null, "kicker": null,
            "type": "Quality",
            "dose": {"text": "7 weeks to CIM", "modelled": false},
            "stats": []
          },
          "phases": [
            {"id": "base", "name": "Base", "weeks": 8, "current": false, "at": null\(otherPhaseFields)},
            {"id": "quality", "name": "Quality", "weeks": 4, "current": true, "at": 0.25\(currentPhaseFields)},
            {"id": "taper", "name": "Taper", "weeks": 3, "current": false, "at": null}
          ],
          "coachLine": "The work that decides the race starts now.",
          "soFar": [],
          "weeks": [],
          "library": [],
          "scenarios": []
        }
        """
        return Data(json.utf8)
    }

    private static func answerFields(hold: String, progress: String) -> String {
        """
        ,
         "developing": "Threshold and high-intensity capacity, and the long run's duration, before marathon pace work starts.",
         "whyNow": "Volume has been rebuilt. 4 weeks are spent here, from 11 to 7 weeks out.",
         "evidence": "You have held 43.5 mi a week repeatedly and are running 44.0 mi now.",
         "hold": "\(hold)",
         "progress": "\(progress)",
         "restructure": "A layoff longer than 3 weeks hands the block to the comeback protocol and it is re-authored."
        """
    }

    private func decodeBlock(_ data: Data) throws -> V5Block {
        try JSONDecoder().decode(V5Block.self, from: data)
    }

    private func fullPayload() throws -> V5Block {
        try decodeBlock(blockJSON(
            currentPhaseFields: Self.answerFields(hold: Self.qualityHold, progress: Self.qualityProgress),
            otherPhaseFields: Self.answerFields(hold: Self.baseHold, progress: Self.baseProgress)))
    }

    // MARK: - 1 · the fields decode, they are not dropped

    /// FAILS AGAINST THE PREVIOUS CODE. `V5Phase` had no `hold` or `progress`
    /// property, so these keys were dropped in silence and there was nothing
    /// to ask. Deleting the properties again stops this file COMPILING, which
    /// is the loudest failure available for a field a lenient decoder would
    /// otherwise ignore without complaint.
    func test_holdAndProgressDecodeOffTheBlockWire() throws {
        let block = try fullPayload()
        let quality = try XCTUnwrap(block.phases.first { $0.id == "quality" })

        XCTAssertEqual(quality.hold, Self.qualityHold, "the server's own key name is `hold`")
        XCTAssertEqual(quality.progress, Self.qualityProgress, "the server's own key name is `progress`")
        // The five that were already decoded must survive the new init.
        XCTAssertEqual(quality.name, "Quality")
        XCTAssertEqual(quality.weeks, 4)
        XCTAssertTrue(quality.current)
        XCTAssertEqual(quality.at, 0.25)
    }

    /// The other four are decoded and not yet drawn. That is a deliberate
    /// posture, not an oversight, and it is asserted so the next reader does
    /// not conclude a second time that the wire is silent.
    func test_theOtherFourAnswersAlsoDecode() throws {
        let block = try fullPayload()
        let quality = try XCTUnwrap(block.phases.first { $0.id == "quality" })

        XCTAssertNotNil(quality.developing)
        XCTAssertNotNil(quality.whyNow)
        XCTAssertNotNil(quality.evidence)
        XCTAssertNotNil(quality.restructure)
        XCTAssertEqual(quality.restructure,
            "A layoff longer than 3 weeks hands the block to the comeback protocol and it is re-authored.")
    }

    // MARK: - 2 · they render for the CURRENT phase

    /// `BlockV5.arcSection` draws exactly `V5Block.arcProgressionLines`, and
    /// so does this. Asserting against the SAME resolver the screen calls is
    /// what makes the scoping test below a real check rather than a test
    /// re-deriving the scope it is meant to be testing (Rule 16).
    func test_theCurrentPhaseRendersBothLinesInOrder() throws {
        let block = try fullPayload()
        let lines = block.arcProgressionLines

        XCTAssertEqual(lines.count, 2)
        // HOLD FIRST, then PROGRESS — the order the engine's own question asks
        // them in ("what would cause the phase to hold, progress, or
        // restructure?"). Pinned so a later edit has to argue with it.
        XCTAssertEqual(lines[0].label, V5Phase.holdLabel)
        XCTAssertEqual(lines[0].text, Self.qualityHold)
        XCTAssertEqual(lines[1].label, V5Phase.progressLabel)
        XCTAssertEqual(lines[1].text, Self.qualityProgress)
    }

    /// THE SENTENCE THE REVIEWER CAPTURED, QUOTED AND NOT REWRITTEN.
    ///
    /// The screen has no standing to shorten, reorder or re-word what the
    /// runner must demonstrate. If a future edit starts composing this copy on
    /// the device, this assertion is what stops it.
    func test_theEngineSentenceIsRenderedVerbatim() throws {
        let block = try fullPayload()
        let rendered = block.arcProgressionLines.map(\.text)

        XCTAssertTrue(rendered.contains(Self.qualityProgress))
        XCTAssertTrue(rendered.contains(Self.qualityHold))
        for text in rendered {
            XCTAssertFalse(text.contains("—"), "coach voice: no em dashes")
            XCTAssertFalse(text.contains("!"), "coach voice: no exclamation marks")
        }
    }

    /// A phase that answered one and not the other renders the one it has.
    /// Half an answer is still an answer; showing none would be the original
    /// defect in miniature.
    func test_aPhaseWithOnlyOneAnswerRendersThatOne() throws {
        let block = try decodeBlock(blockJSON(
            currentPhaseFields: #", "progress": "\#(Self.qualityProgress)""#,
            otherPhaseFields: ""))
        let lines = block.arcProgressionLines

        XCTAssertEqual(lines.count, 1)
        XCTAssertEqual(lines[0].label, V5Phase.progressLabel)
        XCTAssertEqual(lines[0].text, Self.qualityProgress)
    }

    /// An engine that emitted an EMPTY string draws nothing, rather than a
    /// label over a blank. Absent and empty are different facts on the wire
    /// (Rule 11) and they agree on the only question this screen asks.
    func test_anEmptyStringDrawsNothing() throws {
        let block = try decodeBlock(blockJSON(
            currentPhaseFields: #", "hold": "", "progress": """#,
            otherPhaseFields: ""))
        let current = try XCTUnwrap(block.phases.first(where: \.current))

        XCTAssertEqual(current.hold, "", "the key was sent, so the field is not nil")
        XCTAssertTrue(block.arcProgressionLines.isEmpty, "but nothing is drawn")
    }

    // MARK: - 3 · they do NOT render for a non-current phase

    /// THE SCOPING, AND WHY IT IS THE POINT.
    ///
    /// Every phase in this payload carries `hold` and `progress`. Drawing all
    /// of them would put three "what earns the next step" answers on one
    /// screen, two of them about a phase the runner is not in — noise wearing
    /// the clothes of thoroughness (Rule 17). "Decode works" is satisfied by a
    /// screen that shows all three, so this is the assertion that separates
    /// the fix from a bug of its own.
    func test_aNonCurrentPhaseDoesNotContributeItsLines() throws {
        let block = try fullPayload()
        let base = try XCTUnwrap(block.phases.first { $0.id == "base" })

        // The BASE phase decoded its own answers perfectly well ...
        XCTAssertEqual(base.hold, Self.baseHold)
        XCTAssertEqual(base.progress, Self.baseProgress)
        XCTAssertFalse(base.current)

        // ... and what the screen draws is the CURRENT phase's, only.
        //
        // FALSIFIED against a resolver widened to `phases.flatMap(\.progressionLines)`:
        // these four assertions go red and the count below reads 4, not 2.
        let drawn = block.arcProgressionLines.map(\.text)
        XCTAssertEqual(drawn.count, 2, "two sentences on this screen, not two per phase")
        XCTAssertFalse(drawn.contains(Self.baseHold),
            "a phase the runner finished eight weeks ago does not get to speak here")
        XCTAssertFalse(drawn.contains(Self.baseProgress))
        XCTAssertTrue(drawn.contains(Self.qualityHold))
        XCTAssertTrue(drawn.contains(Self.qualityProgress))
        XCTAssertEqual(block.phases.filter(\.current).count, 1,
            "the wire names exactly one current phase; the resolver picks that one")
    }

    /// A block between phases — nothing marked `current`. The section draws
    /// nothing rather than falling back to the first phase in the list, which
    /// would be a confident answer about a phase nobody is in.
    func test_aBlockWithNoCurrentPhaseDrawsNothing() throws {
        let json = String(decoding: blockJSON(
            currentPhaseFields: Self.answerFields(hold: Self.qualityHold, progress: Self.qualityProgress),
            otherPhaseFields: Self.answerFields(hold: Self.baseHold, progress: Self.baseProgress)),
                          as: UTF8.self)
            .replacingOccurrences(of: #""current": true"#, with: #""current": false"#)
        let block = try decodeBlock(Data(json.utf8))

        XCTAssertNil(block.phases.first(where: \.current))
        XCTAssertTrue(block.arcProgressionLines.isEmpty, "the section draws nothing")
        XCTAssertEqual(block.phases.filter { !$0.progressionLines.isEmpty }.count, 2,
            "the sentences are still on the wire; they simply have no phase to belong to")
    }

    // MARK: - 4 · backward compatibility

    /// A block authored before 2026-09-01 carries `phase_answers: null`, so
    /// `buildPhases` spreads no keys at all and the phase objects look exactly
    /// as they did the day this screen shipped. A cached payload of that shape
    /// sits on real phones — a 105-day cache is on record — and it must still
    /// decode, still draw its arc, and simply say nothing extra.
    func test_anOlderPayloadWithNoAnswerKeysStillDecodes() throws {
        let block = try decodeBlock(blockJSON(currentPhaseFields: "", otherPhaseFields: ""))

        XCTAssertEqual(block.phases.count, 3, "the arc is intact")
        let current = try XCTUnwrap(block.phases.first(where: \.current))
        XCTAssertEqual(current.name, "Quality")
        XCTAssertEqual(current.weeks, 4)
        XCTAssertEqual(current.at, 0.25)
        XCTAssertEqual(current.segment.name, "Quality", "the bar still has its segment")

        // Absent is not empty. Every one of the six reads as "no claim".
        XCTAssertNil(current.hold, "an absent key is not an empty sentence")
        XCTAssertNil(current.progress)
        XCTAssertNil(current.developing)
        XCTAssertNil(current.whyNow)
        XCTAssertNil(current.evidence)
        XCTAssertNil(current.restructure)
        XCTAssertTrue(block.arcProgressionLines.isEmpty, "and the section does not draw")
    }

    /// A malformed value on ONE phase must not empty the whole arc.
    ///
    /// `V5Block.phases` is `c.list(.phases)`, which swallows a throw on the
    /// ARRAY — so a phase that threw would have taken every other phase with
    /// it and left the block screen with no arc at all. The lenient per-field
    /// decode is what keeps that from being a possible outcome.
    func test_aMalformedAnswerValueDoesNotTakeTheArcDown() throws {
        let block = try decodeBlock(blockJSON(
            currentPhaseFields: #", "hold": 17, "progress": "\#(Self.qualityProgress)""#,
            otherPhaseFields: ""))

        XCTAssertEqual(block.phases.count, 3, "every phase survived")
        let current = try XCTUnwrap(block.phases.first(where: \.current))
        XCTAssertNil(current.hold, "an unreadable value is absent, not a rendered number")
        XCTAssertEqual(block.arcProgressionLines.count, 1)
        XCTAssertEqual(block.arcProgressionLines[0].text, Self.qualityProgress)
    }

    // MARK: - The labels

    /// RULE 16 · one quantity, one name. The two labels are structural, not
    /// coaching copy: they name the question `phase-answers.ts` already
    /// answered, in that file's own words. Held as constants so the view and
    /// this test cannot drift apart, and pinned here so a reword is a
    /// deliberate act.
    func test_theLabelsAreTheEnginesOwnVocabulary() {
        XCTAssertEqual(V5Phase.holdLabel, "What holds this phase where it is")
        XCTAssertEqual(V5Phase.progressLabel, "What earns the next step")
        // Both phrases appear verbatim inside the engine's own sentences, which
        // is why they are labels and not an added claim.
        XCTAssertTrue(Self.qualityHold.contains("hold pace where it is"))
        XCTAssertTrue(Self.qualityProgress.contains("earns the next step"))
    }
}
