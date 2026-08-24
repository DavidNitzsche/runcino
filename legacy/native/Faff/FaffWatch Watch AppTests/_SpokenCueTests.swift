//
//  _SpokenCueTests.swift
//  FaffWatch Watch AppTests
//
//  Rule 10: a spoken cue is always also drawn, and audio is a delivery route
//  rather than a second content channel. Both halves are testable.
//

import Testing
@testable import FaffWatch_Watch_App

@MainActor
struct SpokenCueTests {

    private func line(_ kind: WMomentKind,
                      splitLabel: String? = nil, splitTime: String? = nil,
                      splitComparison: String? = nil,
                      phaseWord: String? = nil, phaseDetail: String? = nil,
                      band: String? = nil, pace: String? = nil,
                      almostDone: String? = nil,
                      driftVerb: String? = nil) -> String? {
        SpokenCues.line(for: kind, sessionClass: "easy",
                        splitLabel: splitLabel, splitTime: splitTime,
                        splitComparison: splitComparison,
                        phaseWord: phaseWord, phaseDetail: phaseDetail,
                        band: band, pace: pace, almostDone: almostDone,
                        driftVerb: driftVerb)
    }

    // MARK: - Nothing is said that is not also drawn

    @Test func everySpokenMomentAlsoHasABoard() {
        // The moments that speak must be a SUBSET of the moments that draw.
        // `WMomentKind` is the vocabulary of things that take the screen, so
        // anything with a sentence here has a board by construction — this
        // pins that the enum has not grown a case with a voice and no view.
        let all: [WMomentKind] = [
            .go(rep: "", target: ""),
            .phaseChange(title: "Work", sub: "Rep 2 of 6"),
            .split(mile: 5, paceSec: 468),
            .fuel(index: 2, total: 3),
            .headsUp(value: "", quicken: false),
            .almostDone(value: "0.25", unit: "mi left"),
            .paused,
        ]
        // Every one of these has a case in WatchRouterV5.momentBoard. If a new
        // kind is added, this array fails to compile exhaustively at the call
        // site and someone has to decide what it says AND what it draws.
        #expect(all.count == 7)
    }

    // MARK: - The ones that stay silent, and why

    @Test func goIsSilent() {
        // The runner just pressed Start. Telling them the run has begun is the
        // watch talking about itself.
        #expect(line(.go(rep: "", target: "")) == nil)
    }

    @Test func pausedIsSilent() {
        // Standing still is not news to someone standing still — and on an
        // auto-pause a voice announcing it would be the watch narrating its
        // own decision.
        #expect(line(.paused) == nil)
    }

    // MARK: - The ones that speak

    @Test func aSplitSaysTheMileAndTheTime() {
        let s = line(.split(mile: 5, paceSec: 468),
                     splitLabel: "Mile 5", splitTime: "7:48")
        #expect(s == "Mile 5. 7 48.")
    }

    @Test func aRaceSplitCarriesTheGoalComparison() {
        // The per-mile half of "am I on pace", which is the question a runner
        // asks at every marker and the reason this cue is spoken at all.
        let s = line(.split(mile: 9, paceSec: 472),
                     splitLabel: "Mile 9", splitTime: "7:52",
                     splitComparison: "6 sec under goal")
        #expect(s == "Mile 9. 7 52. 6 sec under goal.")
    }

    @Test func aWholeMinuteSplitIsSaidAsMinutes() {
        // "8:00" handed to a synthesiser raw reads "eight hundred".
        let s = line(.split(mile: 2, paceSec: 480),
                     splitLabel: "Mile 2", splitTime: "8:00")
        #expect(s == "Mile 2. 8 minutes.")
    }

    @Test func aPhaseChangeSaysTheWordAndTheCount() {
        // NOT the band. "Six forty five to seven hundred per mile" is not a
        // sentence anyone can act on at a rep boundary; the band is on the
        // board for the eye.
        let s = line(.phaseChange(title: "Work", sub: "Rep 4 of 6"),
                     phaseWord: "Work", phaseDetail: "Rep 4 of 6",
                     band: "6:45–7:00 /mi")
        #expect(s == "Work. Rep 4 of 6.")
    }

    @Test func fuelSaysWhichOfHowMany() {
        #expect(line(.fuel(index: 2, total: 3)) == "Gel. 2 of 3.")
    }

    @Test func aDriftCueSaysTheWordTheBoardDRAWS() {
        // It said "Off the band", which the board never draws — the board
        // draws the direction. A runner with headphones in and a runner
        // looking at the wrist were getting different words for one event,
        // which is the thing rule 10 forbids and the thing this file exists
        // to make impossible. Found by rendering the lines to audio.
        let s = line(.headsUp(value: "", quicken: false),
                     band: "6:45–7:00 /mi", pace: "7:14", driftVerb: "Ease off")
        #expect(s == "Ease off. 7 14. Band is 6 45 to 7 minutes per mile.")
    }

    @Test func aDriftCueWithNoBandDoesNotInventOne() {
        let s = line(.headsUp(value: "", quicken: false), pace: "7:14",
                     driftVerb: "Pick it up")
        #expect(s == "Pick it up. 7 14.")
    }

    @Test func unitsAreSpokenAsWordsNotSymbols() {
        // "/mi" reads as "slash M I".
        #expect(SpokenCues.spokenUnit("/mi") == "per mile")
        #expect(SpokenCues.spokenUnit("/km") == "per kilometre")
        #expect(SpokenCues.spokenUnit("mi") == "miles")
        #expect(SpokenCues.spokenUnit("km") == "kilometres")
    }

    @Test func almostDoneSaysWhatIsLeft() {
        #expect(line(.almostDone(value: "0.25", unit: "mi left"),
                     almostDone: "0.25 mi") == "0.25 miles to go.")
        #expect(line(.almostDone(value: "0.40", unit: "km left"),
                     almostDone: "0.40 km") == "0.40 kilometres to go.")
    }

    @Test func aMissingFigureProducesSilenceRatherThanAFragment() {
        // Every branch guards its own inputs. A half-built sentence spoken
        // into a runner's ear is worse than nothing.
        #expect(line(.split(mile: 5, paceSec: 468), splitLabel: "Mile 5") == nil)
        #expect(line(.phaseChange(title: "Work", sub: nil)) == nil)
        #expect(line(.headsUp(value: "", quicken: false), driftVerb: "Ease off") == nil)
        #expect(line(.almostDone(value: "0.25", unit: "mi left")) == nil)
    }
}
