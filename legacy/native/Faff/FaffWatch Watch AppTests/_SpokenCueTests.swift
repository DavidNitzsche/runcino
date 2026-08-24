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
        #expect(s == "Mile five, seven forty-eight.")
    }

    @Test func aRaceSplitCarriesTheGoalComparison() {
        // The per-mile half of "am I on pace", which is the question a runner
        // asks at every marker and the reason this cue is spoken at all.
        let s = line(.split(mile: 9, paceSec: 472),
                     splitLabel: "Mile 9", splitTime: "7:52",
                     splitComparison: "6 sec under goal")
        #expect(s == "Mile nine, seven fifty-two. Six seconds under goal.")
    }

    @Test func aWholeMinuteSplitIsSaidAsMinutes() {
        // "8:00" handed to a synthesiser raw reads "eight hundred".
        let s = line(.split(mile: 2, paceSec: 480),
                     splitLabel: "Mile 2", splitTime: "8:00")
        #expect(s == "Mile two, eight flat.")
    }

    @Test func aPhaseChangeSaysTheWordAndTheCount() {
        // NOT the band. "Six forty five to seven hundred per mile" is not a
        // sentence anyone can act on at a rep boundary; the band is on the
        // board for the eye.
        let s = line(.phaseChange(title: "Work", sub: "Rep 4 of 6"),
                     phaseWord: "Work", phaseDetail: "Rep 4 of 6",
                     band: "6:45–7:00 /mi")
        #expect(s == "Work, rep four of six.")
    }

    @Test func fuelSaysWhichOfHowMany() {
        #expect(line(.fuel(index: 2, total: 3)) == "Gel, two of three.")
    }

    @Test func aDriftCueSaysTheWordTheBoardDRAWS() {
        // It said "Off the band", which the board never draws — the board
        // draws the direction. A runner with headphones in and a runner
        // looking at the wrist were getting different words for one event,
        // which is the thing rule 10 forbids and the thing this file exists
        // to make impossible. Found by rendering the lines to audio.
        let s = line(.headsUp(value: "", quicken: false),
                     band: "6:45–7:00 /mi", pace: "7:14", driftVerb: "Ease off")
        #expect(s == "Ease off. Seven fourteen, band is six forty-five to seven flat per mile.")
    }

    @Test func aDriftCueWithNoBandDoesNotInventOne() {
        let s = line(.headsUp(value: "", quicken: false), pace: "7:14",
                     driftVerb: "Pick it up")
        #expect(s == "Pick it up. Seven fourteen.")
    }

    @Test func aClockIsSaidTheWayASplitIsCalledOut() {
        // The three that give a machine away when it gets them wrong.
        #expect(SpokenCues.spokenClock("7:48") == "seven forty-eight")
        #expect(SpokenCues.spokenClock("7:05") == "seven oh five")
        #expect(SpokenCues.spokenClock("7:00") == "seven flat")
    }

    @Test func onlyOneSecondIsSingular() {
        #expect(SpokenCues.spokenPhrase("1 sec quicker") == "one second quicker")
        #expect(SpokenCues.spokenPhrase("6 sec under goal") == "six seconds under goal")
    }

    @Test func aQuarterMileIsSaidAsAQuarterMile() {
        #expect(SpokenCues.spokenDistance("0.25", unit: "mi") == "a quarter mile")
        #expect(SpokenCues.spokenDistance("0.5", unit: "mi") == "half a mile")
        #expect(SpokenCues.spokenDistance("0.12", unit: "mi") == "0.12 miles")
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
                     almostDone: "0.25 mi") == "a quarter mile to go.")
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


// MARK: - Which voice the watch picks

/// David heard Compact Samantha and called it computery. Compact is the
/// platform floor, and the Enhanced and Premium tiers are downloads rather
/// than something every watch ships with — so the app cannot choose to sound
/// better, it can only avoid choosing to sound worse.
///
/// The bug these lock: preferring the NAME ahead of the QUALITY. Filtering to
/// Samantha and then taking her best variant sounds like a preference for the
/// better voice, and is in fact a preference for the worse one on any watch
/// that has something good installed under another name.
@MainActor
struct VoicePreferenceTests {

    // AVSpeechSynthesisVoiceQuality raw values.
    private let compact = 1, enhanced = 2, premium = 3

    @Test("quality outranks the name preference")
    func qualityBeatsName() {
        let enhancedAva = SpokenCues.rank(
            quality: enhanced, name: "Ava", language: "en-US")
        let compactSamantha = SpokenCues.rank(
            quality: compact, name: "Samantha", language: "en-US")
        #expect(enhancedAva > compactSamantha)
    }

    @Test("the name breaks a tie inside one quality tier")
    func nameBreaksTieWithinTier() {
        let samantha = SpokenCues.rank(
            quality: compact, name: "Samantha", language: "en-US")
        let fred = SpokenCues.rank(
            quality: compact, name: "Fred", language: "en-US")
        #expect(samantha > fred)
    }

    @Test("a voice David never named still beats a worse-quality one he did")
    func unnamedVoiceCanWinOnQuality() {
        let premiumStranger = SpokenCues.rank(
            quality: premium, name: "Nathan", language: "en-US")
        let enhancedSamantha = SpokenCues.rank(
            quality: enhanced, name: "Samantha", language: "en-US")
        #expect(premiumStranger > enhancedSamantha)
    }

    @Test("US English wins only when quality and name are level")
    func localeIsTheLastWord() {
        let us = SpokenCues.rank(
            quality: compact, name: "Samantha", language: "en-US")
        let gb = SpokenCues.rank(
            quality: compact, name: "Samantha", language: "en-GB")
        #expect(us > gb)

        // ...and never ahead of quality.
        let enhancedGB = SpokenCues.rank(
            quality: enhanced, name: "Daniel", language: "en-GB")
        #expect(enhancedGB > us)
    }

    @Test("every name David picked is ranked, and Samantha is first")
    func preferredListIsHonoured() {
        #expect(SpokenCues.preferredNames.first == "Samantha")
        let ranks = SpokenCues.preferredNames.map {
            SpokenCues.rank(quality: compact, name: $0, language: "en-US").1
        }
        // Strictly descending: each named voice outranks the next.
        #expect(ranks == ranks.sorted(by: >))
        #expect(Set(ranks).count == ranks.count)
        // An unlisted voice ranks below all of them.
        let unlisted = SpokenCues.rank(
            quality: compact, name: "Zarvox", language: "en-US").1
        #expect(ranks.allSatisfy { $0 > unlisted })
    }
}
