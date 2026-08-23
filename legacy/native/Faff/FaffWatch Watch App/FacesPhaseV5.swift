//
//  FacesPhaseV5.swift
//  FaffWatch
//
//  Handoff § 3 · Structured phases  and  § 4 · Moments.
//
//  SOURCE OF TRUTH — see WatchThemeV5.swift's header:
//    /Volumes/WP/06 Claude Code/Faff/design/0821/design_handoff_faff_watch_app/
//      README.md + Faff-Watch-App.dc.html
//  Boards drawn here, by their `data-screen-label` in that file:
//    Warm-up · Work interval · Recovery · Strides · Threshold · Race
//    Go · Phase change · Split · Fuel · Heads-up · Heads-up quicken · Paused
//
//  Every number below is the design's 2× px halved. Nothing is invented; where
//  the handoff and the shared kit disagree the divergence is a NEEDS note
//  rather than a quiet local fix.
//
//  THE TWO FAMILIES, AND WHY THEY ARE OPPOSITES
//
//  A PHASE BOARD is a face the runner sits on for minutes. It names the phase,
//  the count and the target band, and puts telemetry underneath. The phase
//  label lives in the SAME SLOT on all six, and the numbers below it keep
//  page 1's order — pace, then heart, then distance, then time — so the muscle
//  memory built over the first twenty minutes survives the interval.
//
//  A MOMENT is the opposite. It takes the screen for two or three seconds
//  behind a haptic and gives it back. Handoff rule 9: a moment REDUCES
//  density, never adds it. It drops to one or two registers at a size no
//  other board uses — that size IS the signal — so there is no telemetry on a
//  moment, ever. If you find yourself adding a heart rate to one of these,
//  the moment has become a face and the rule is broken.
//
//  These views are pure. No timers, no haptics, no engine. The caller drives
//  the 2-3 second hold and fires the haptic; see the NEEDS block for which
//  haptic each moment wants, because a phase change and a split must not feel
//  the same.
//
//  ─────────────────────────────────────────────────────────────────────────
//  NEEDS — things in the shared kit that this file worked around rather than
//  changed. None of these are edited here; each is a decision for whoever
//  owns WatchKitV5.swift.
//
//  NEEDS 1 · RESOLVED WHILE THIS FILE WAS BEING WRITTEN, no action needed —
//    recorded because the reasoning matters. The kit originally carried the
//    README table's ranks (48 / 28 / 22); the drawn boards are 44 / 33 on
//    every phase face. WMetricRank has since been re-measured off the boards
//    to 44 / 36 / 33 with a per-rank unit step (18 / 16 / 15), and WMetric
//    gained a `size:` override. This file is written against that version and
//    the phase boards now land on the design's exact figures with no local
//    type scale. If WMetricRank is ever reverted to the README table, every
//    phase board here goes 4-8pt small.
//
//  NEEDS 2 · The MOMENTS deliberately do not use WMetricRank at all. A rank
//    is a running-face concept — it exists to serve rule 4's hierarchy, and a
//    moment has no hierarchy, only a single register at a size no other board
//    uses (65-66pt). They are set with WatchV5.number() directly. The two
//    exceptions are Heads-up's pace and Paused's distance, which are figure +
//    unit readings and one of them grades, so WMetric earns its place there.
//    The Strides countdown takes the `size:` override at 75pt for the same
//    reason: that board IS one figure.
//
//  NEEDS 3 · CLOSED, in this file's favour. WKicker rendered in the coach
//    register; the design's phase labels sit inside the ui-rounded container
//    and are SF Rounded Bold, uppercase, .08em, like every other figure on
//    the board. Checking the rest of the file settled it: all twenty kickers
//    in the 0821 handoff are ui-rounded, and there is no kicker anywhere in
//    it drawn in Instrument Sans. So WKicker lost its `figures` switch and is
//    the telemetry register outright, and its default colour moved from .72
//    to the .62 the design actually draws. The phase labels here are
//    unchanged at the call site and now render as drawn.
//
//  NEEDS 4 · CLOSED. The band gauge, the rep strip and the progress strip are
//    page 1's too, and are now `WBandStrip` and `WProgressStrip` in
//    WatchKitV5. The rep strip was not a third object — it is the progress
//    strip cut into segments — so it is the same type reached through a
//    second initialiser, and the white-versus-orange fill that Threshold and
//    Race need is a named `WProgressTone` rather than a colour a board picks.
//    Two corrections came with the move: the white fill was `valueDim` (.72)
//    and the design draws it at .62, and the mark on the band strip was
//    centred on its position where the design places it by its leading edge,
//    the way CSS `left` does. Both boards shift by a few points.
//
//  NEEDS 5 · WBoard pads 10pt at the sides and 10pt at the bottom. The phase
//    boards in the design pad 8pt / 7pt (16px / 14px), and the moments pad
//    10pt / 12pt. The 2pt is inside the design's own stated 8-11 / 8-12
//    range, so this is a note, not a defect.
//
//  NEEDS 6 · HAPTICS. Every moment is delivered by one, the visual is the
//    confirmation and not the alert, and the handoff is explicit that a phase
//    change and a split MUST NOT feel the same. Suggested WKHapticType per
//    moment, all distinct by texture, for the caller to fire:
//
//      Go              .start          the run is beginning
//      Phase change    .notification   two-beat, "read this"
//      Split           .click          one light tap, nothing to do about it
//      Fuel            .retry          a triple, unmistakable at mile 14,
//                                      and it is the only one that repeats
//      Heads-up · ease off   .directionDown   the verb, felt
//      Heads-up · quicken    .directionUp     the mirror of it
//      Paused          .stop
//
//    Go / Phase change / Split / Fuel / Heads-up hold 2-3s and return.
//    Paused holds until the runner answers.
//
//  NEEDS 7 · WMetricStack is NOT used here, so rule 4's four-metric cap is not
//    machine-enforced on these boards. The reason is structural: the band
//    gauge sits BETWEEN the pace and the next metric on every phase board that
//    has one, and WMetricStack takes `[WMetric]` with no way to interleave
//    anything. So these lay out their own VStack and the cap is held by
//    construction instead. Counted, so the next editor can check the claim:
//      Warm-up          3  (clock, pace, heart)
//      Work interval    3  (pace, heart, distance) — the rep clock is in the
//                          LABEL slot, not the stack
//      Recovery         2  (countdown, heart)
//      Strides          1  (countdown)
//      Threshold        4  (pace, avg pace, heart, elapsed) — at the cap
//      Race             4  (pace, on-goal, distance, elapsed) — at the cap
//    Adding a fifth row to Threshold or Race is a rule-4 break and nothing in
//    the compiler will say so. WMetricStack wants a variant that accepts a
//    ViewBuilder and still counts its WMetrics.
//  ─────────────────────────────────────────────────────────────────────────
//

import SwiftUI

// MARK: - Shared readings

/// The one value the session is asking the runner to hold, with the band it
/// is being held against.
///
/// This is a single type on purpose. Rule 1 is that colour grades and only on
/// this value, so the grade and the gauge have to travel together — a board
/// that could set the pace green without moving the mark, or move the mark
/// without recolouring the figure, is a board that can say two things at once.
struct WBandReading {
    /// The figure. "7:42", "6:48".
    let value: String
    /// The unit carrying its meaning. There are no labels on a metric.
    var unit: String = "/mi"
    /// Inside the prescribed band. The ONLY thing in this system that turns
    /// something green, and it is false the instant the runner leaves it.
    let inBand: Bool
    /// The real three-state grade. `inBand` alone collapsed `.untrusted` into
    /// `.outOfBand`, so a treadmill, a dropped GPS and the first minute of
    /// every outdoor run painted "--" in attention amber on all five phase
    /// boards — the exact assertion-over-nothing the router forbids on Page 1
    /// and lost everywhere else.
    var metric: WMetricGrade = .plain
    /// False when the phase prescribes no band. The gauge is then not drawn:
    /// a band with no target is not a band, and a fabricated one puts the
    /// mark dead-centre and claims the runner is exactly on a target that
    /// does not exist.
    var hasBand: Bool = true
    /// The lit segment, as fractions of the gauge's width.
    let bandStart: Double
    let bandEnd: Double
    /// Where the runner is, as a fraction of the gauge's width.
    let marker: Double

    var grade: WMetricGrade { metric }
}

// MARK: - The phase scaffold

/// Every structured phase, from the same skeleton.
///
/// The label slot is the point of this type. It is the first thing under the
/// clock clearance on all six boards, at one size, in one place, so that when
/// the board swaps underneath the runner mid-session the only thing that moved
/// is the word. A phase board that put its label somewhere else would make the
/// swap itself the event, which is what the Phase change moment is for.
///
/// `trailing` is the one variation: Work interval hangs the time left in the
/// rep off the right of the label line, because on that board the count and
/// the clock are the same thought.
struct WPhaseScaffold<Content: View, Footer: View>: View {
    let label: String
    var trailing: String? = nil
    var pageCount: Int = 2
    var pageIndex: Int = 0
    @ViewBuilder var content: () -> Content
    @ViewBuilder var footer: () -> Footer

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 0) {

                HStack(alignment: .firstTextBaseline) {
                    WKicker(text: label, size: 11)   // 22px in the 2× set
                    if let trailing {
                        Spacer(minLength: 6)
                        Text(trailing)
                            .font(WatchV5.number(17))
                            .foregroundStyle(WatchV5.value)
                    }
                }
                .padding(.bottom, 4)

                // The reading block is vertically centred in what is left, so
                // the lead figure lands in the same place whether the board
                // carries two rows or four.
                VStack(alignment: .leading, spacing: 3) {
                    content()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)

                footer()

                WPageDots(count: pageCount, index: pageIndex)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 6)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

// MARK: - § 3 · Structured phases

/// Warm-up.
///
/// The ask is the clock, so the clock is first and largest. Pace still carries
/// the easy band underneath it, because the one way to ruin a warm-up is to
/// run it hard.
struct WPhaseWarmUp: View {
    var label: String = "Warm-up"
    /// Time left in the warm-up. "4:12".
    let remaining: String
    let pace: WBandReading
    /// Dropped entirely when the strap is not reading, never placeholdered —
    /// a stale number is worse than none (rule 2), and the fault itself is
    /// stated on page 1 rather than here.
    var heartRate: String? = nil
    var pageCount: Int = 2
    var pageIndex: Int = 0

    var body: some View {
        WPhaseScaffold(label: label, pageCount: pageCount, pageIndex: pageIndex) {
            WMetric(value: remaining, rank: .hero)

            // 66px / 30px in the 2x set → 33pt with a 15pt unit, which is
            // exactly .tertiary. The clock above it is .hero at 44.
            WMetric(value: pace.value, unit: pace.unit,
                    rank: .tertiary, grade: pace.grade)

            if pace.hasBand {

                WBandStrip(start: pace.bandStart,
                       end: pace.bandEnd,
                       marker: pace.marker,
                       inBand: pace.inBand)
                .padding(.vertical, 2)
            }

            if let heartRate {
                WMetric(value: heartRate, unit: "bpm", rank: .tertiary)
            }
        } footer: {
            EmptyView()
        }
    }
}

/// Work interval.
///
/// The density test, and the only phase board that fills its metric budget
/// while still naming a count and a clock. Rep count and time left share the
/// label line; pace against the rep's own target leads; the strip at the foot
/// is reps rather than distance.
struct WPhaseWorkInterval: View {
    let repIndex: Int
    let repCount: Int
    /// Time left in this rep. "1:42".
    let remaining: String
    let pace: WBandReading
    var heartRate: String? = nil
    /// Distance covered in this rep. "0.42".
    var distance: String? = nil
    var distanceUnit: String = "mi"
    var pageCount: Int = 2
    var pageIndex: Int = 0

    var body: some View {
        WPhaseScaffold(label: "Rep \(repIndex) / \(repCount)",
                       trailing: remaining,
                       pageCount: pageCount,
                       pageIndex: pageIndex) {

            WMetric(value: pace.value, unit: pace.unit,
                    rank: .hero, grade: pace.grade)

            if pace.hasBand {

                WBandStrip(start: pace.bandStart,
                       end: pace.bandEnd,
                       marker: pace.marker,
                       inBand: pace.inBand)
                .padding(.vertical, 2)
            }

            if let heartRate {
                WMetric(value: heartRate, unit: "bpm", rank: .tertiary)
            }
            if let distance {
                WMetric(value: distance, unit: distanceUnit, rank: .tertiary)
            }
        } footer: {
            WProgressStrip(total: repCount, done: repIndex)
                .padding(.bottom, 6)
        }
    }
}

/// Recovery.
///
/// Two quantities and no band, because nothing is being held. Pace is
/// deliberately ABSENT — on a recovery jog it is noise, and printing it
/// invites the runner to race it. There is no parameter for one here, so the
/// board cannot grow one by accident.
struct WPhaseRecovery: View {
    var label: String = "Recovery"
    /// Countdown to the next rep. "1:48".
    let remaining: String
    var heartRate: String? = nil
    let repIndex: Int
    let repCount: Int
    var pageCount: Int = 2
    var pageIndex: Int = 0

    var body: some View {
        WPhaseScaffold(label: label, pageCount: pageCount, pageIndex: pageIndex) {
            // The biggest figures on any phase board (104px / 76px = 52 /
            // 38), because there are only two of them. Density drops, so size
            // rises — the same trade the moments make.
            VStack(alignment: .leading, spacing: 11) {
                WMetric(value: remaining, rank: .hero, size: 52)
                if let heartRate {
                    WMetric(value: heartRate, unit: "bpm", rank: .hero, size: 38)
                }
            }
        } footer: {
            WProgressStrip(total: repCount, done: repIndex)
                .padding(.bottom, 6)
        }
    }
}

/// Strides.
///
/// Twenty seconds is too short to read a number, so the face is a count and a
/// clock and nothing else. Pace on a stride is meaningless before it has
/// settled, so there is no pace parameter.
///
/// The countdown is set with WatchV5.number(75) rather than a rank: this board
/// is one figure and the figure IS the board (see NEEDS 2).
struct WPhaseStrides: View {
    let strideIndex: Int
    let strideCount: Int
    /// "0:18".
    let remaining: String
    var pageCount: Int = 2
    var pageIndex: Int = 0

    var body: some View {
        WPhaseScaffold(label: "Stride \(strideIndex) / \(strideCount)",
                       pageCount: pageCount,
                       pageIndex: pageIndex) {
            WMetric(value: remaining, rank: .hero, size: 75)   // 150px
                .frame(maxHeight: .infinity, alignment: .center)
        } footer: {
            WProgressStrip(total: strideCount, done: strideIndex)
                .padding(.bottom, 6)
        }
    }
}

/// Threshold.
///
/// Average pace earns its row HERE AND NOWHERE ELSE: a threshold block is
/// judged on the whole rep, not the current second. Four metrics exactly — the
/// cap, spent.
struct WPhaseThreshold: View {
    var name: String = "Threshold"
    let blockIndex: Int
    let blockCount: Int
    let pace: WBandReading
    /// Average pace across this block. "6:57".
    var averagePace: String? = nil
    var heartRate: String? = nil
    /// Elapsed in the block. "14:26".
    var elapsed: String? = nil
    /// How far through the block, 0...1. The strip is white, not orange.
    var progress: Double = 0
    var pageCount: Int = 2
    var pageIndex: Int = 0

    var body: some View {
        WPhaseScaffold(label: "\(name) \(WatchV5.separator) \(blockIndex) of \(blockCount)",
                       pageCount: pageCount,
                       pageIndex: pageIndex) {

            // 84px / 62px in the 2x set. Five registers deep, so the whole
            // ladder steps down a little from Work interval's 88 / 66.
            WMetric(value: pace.value, unit: pace.unit,
                    rank: .hero, grade: pace.grade, size: 42)

            if pace.hasBand {

                WBandStrip(start: pace.bandStart,
                       end: pace.bandEnd,
                       marker: pace.marker,
                       inBand: pace.inBand)
                .padding(.vertical, 2)
            }

            // Average pace is white. Only the live figure grades — an average
            // that turned green would be a second verdict on the same run.
            if let averagePace {
                WMetric(value: averagePace, unit: "\(pace.unit) avg",
                        rank: .tertiary, size: 31)
            }
            if let heartRate {
                WMetric(value: heartRate, unit: "bpm", rank: .tertiary, size: 31)
            }
            if let elapsed {
                WMetric(value: elapsed, rank: .tertiary, size: 31)
            }
        } footer: {
            // `.quiet` — white. Threshold and Race sit on the quality and
            // race ramps, where signal orange would read as a live warning.
            WProgressStrip(fraction: progress, tone: .quiet)
                .padding(.bottom, 6)
        }
    }
}

/// Race.
///
/// One question all day: am I on the goal or off it. Pace against goal pace
/// leads, and the second row is the only SIGNED number in the system —
/// elapsed against where the goal says you should be, which is the figure a
/// runner actually wants at mile 9.
///
/// The sign is the caller's: pass "−0:22" with the true minus (U+2212), not a
/// hyphen, so it lines up in the tabular figures.
struct WPhaseRace: View {
    /// "Mile 9".
    let mileLabel: String
    /// "sub 3:30". Dropped from the label when the runner has no goal time.
    var goalLabel: String? = nil
    let pace: WBandReading
    /// "−0:22" or "+0:14", against the goal's own schedule.
    var onGoal: String? = nil
    var onGoalUnit: String = "on goal"
    /// "9.14".
    var distance: String? = nil
    var distanceUnit: String = "mi"
    /// "1:12:18".
    var elapsed: String? = nil
    /// Fraction of the race distance covered, 0...1.
    var progress: Double = 0
    var pageCount: Int = 2
    var pageIndex: Int = 0

    private var label: String {
        guard let goalLabel else { return mileLabel }
        return "\(mileLabel) \(WatchV5.separator) \(goalLabel)"
    }

    var body: some View {
        WPhaseScaffold(label: label, pageCount: pageCount, pageIndex: pageIndex) {

            WMetric(value: pace.value, unit: pace.unit,
                    rank: .hero, grade: pace.grade, size: 42)

            if pace.hasBand {

                WBandStrip(start: pace.bandStart,
                       end: pace.bandEnd,
                       marker: pace.marker,
                       inBand: pace.inBand)
                .padding(.vertical, 2)
            }

            // White, even though it is a verdict of sorts. Rule 1 gives the
            // grade to the pace and only the pace; a second graded figure on a
            // race board is a second opinion at mile 9.
            if let onGoal {
                WMetric(value: onGoal, unit: onGoalUnit, rank: .tertiary, size: 31)
            }
            if let distance {
                WMetric(value: distance, unit: distanceUnit, rank: .tertiary, size: 31)
            }
            if let elapsed {
                WMetric(value: elapsed, rank: .tertiary, size: 31)
            }
        } footer: {
            // `.quiet` — white. Threshold and Race sit on the quality and
            // race ramps, where signal orange would read as a live warning.
            WProgressStrip(fraction: progress, tone: .quiet)
                .padding(.bottom, 6)
        }
    }
}

// MARK: - § 4 · Moments
//
// Rule 9, restated because it is the rule these break first: a moment REDUCES
// density. One or two registers, at a size no other board uses. No telemetry.
// No animation — no spinner, no pulse, no shimmer (rule 13). The caller holds
// each of these for two to three seconds behind its haptic (NEEDS 6) and then
// puts the face back.

/// A moment's body, centred in the board with the clock clearance kept.
private struct WMomentFrame<Content: View>: View {
    var alignment: HorizontalAlignment = .leading
    var spacing: CGFloat = 6
    @ViewBuilder var content: () -> Content

    private var boxAlignment: Alignment {
        alignment == HorizontalAlignment.center ? Alignment.center : Alignment.leading
    }

    var body: some View {
        VStack(alignment: alignment, spacing: spacing) {
            content()
        }
        .frame(maxWidth: .infinity,
               maxHeight: .infinity,
               alignment: boxAlignment)
    }
}

/// Go.
///
/// The ramp's last appearance until the finish. One word, then black for the
/// next hour. The word is the display register at 65pt — the size is the
/// signal, and nothing else is on the board to dilute it.
struct WMomentGo: View {
    var word: String = "Go"
    /// The session's own ramp, by the class the wire already carries.
    var session: String = "easy"

    var body: some View {
        WGradientBoard(session: session) {
            WMomentFrame(alignment: .center) {
                WDisplayWord(text: word, size: 65)   // 130px
            }
        }
    }
}

/// Phase change.
///
/// The instruction, the count, the target. Three lines, no telemetry:
/// whatever the runner was reading a second ago no longer applies, so
/// reprinting it would be the one thing this board must not do.
struct WMomentPhaseChange: View {
    /// "Work", "Recover", "Threshold". Display register, uppercased.
    let word: String
    /// "Rep 4 of 6 · 3 min". Build it with WatchV5.separator.
    let detail: String
    /// "6:45–7:00". Nil on a phase with nothing to hold, e.g. recovery —
    /// and then the board is two lines, not a line with a blank under it.
    var band: String? = nil
    var bandUnit: String = "/mi"

    var body: some View {
        WBoard {
            WMomentFrame(spacing: 7) {
                WDisplayWord(text: word, size: 38)       // 76px

                Text(detail)
                    .font(WatchV5.number(22))            // 44px
                    .foregroundStyle(WatchV5.valueDim)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)

                // Green NAMES the band here, it does not grade anything: there
                // is no live pace on this board to be inside or outside of.
                // The design colours the prescription so the runner reads the
                // band and the colour they are about to be judged against as
                // the same thing.
                if let band {
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        Text(band)
                            .font(WatchV5.number(26))    // 52px
                            .foregroundStyle(WatchV5.band)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                        Text(bandUnit)
                            .font(WatchV5.number(13))
                            .foregroundStyle(WatchV5.band.opacity(0.62))
                    }
                }
            }
        }
    }
}

/// Split.
///
/// A mile went by. The number is the only thing that matters and it is stated
/// once, at 66pt — a size nothing else on the wrist uses.
struct WMomentSplit: View {
    /// "Mile 5".
    let label: String
    /// "7:48".
    let time: String
    /// "4 sec quicker". Nil on the first split, where there is nothing to
    /// compare against and an invented comparison would be the unfalsifiable
    /// claim the copy rules require silence on.
    var comparison: String? = nil

    var body: some View {
        WBoard {
            WMomentFrame(spacing: 4) {
                WKicker(text: label, size: 13)           // 26px

                Text(time)
                    .font(WatchV5.number(66))            // 132px
                    .foregroundStyle(WatchV5.value)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)

                if let comparison {
                    Text(comparison)
                        .font(WatchV5.number(19))        // 38px
                        .foregroundStyle(WatchV5.valueDim)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
            }
        }
    }
}

/// Fuel.
///
/// RACE ONLY, from the plan's own gel points, and the one moment that takes a
/// colour field — at mile 14 with a screen full of black, a lit panel is what
/// gets seen. The ramp is fixed to race and is not a parameter, because a fuel
/// prompt on an easy ramp would be a fuel prompt on a training run, which the
/// design does not have.
///
/// Two things on it, the word and which one of how many, both big enough to
/// read without stopping.
struct WMomentFuel: View {
    var word: String = "Gel"
    let index: Int
    let total: Int

    var body: some View {
        WGradientBoard(session: "race") {
            WMomentFrame(alignment: .center, spacing: 2) {
                WDisplayWord(text: word, size: 66)       // 132px

                Text("\(index) / \(total)")
                    .font(WatchV5.number(36))            // 72px
                    .foregroundStyle(WatchV5.value)
            }
        }
    }
}

/// Which way the runner has left the band. The ONLY thing that differs between
/// the two heads-up boards is this verb — same slot, same amber, same band
/// line last — because the first word is the only thing to act on.
enum WHeadsUpDirection {
    /// Over the band: running quicker than prescribed.
    case easeOff
    /// Under a band with a floor. Drifting slow on an easy day is not an
    /// event, so this fires on a quality or race face only.
    case quicken

    var verb: String {
        switch self {
        case .easeOff: return "Ease off"
        case .quicken: return "Pick it up"
        }
    }
}

/// Heads-up · the band crossing, said in words for the two seconds it takes to
/// act on it.
///
/// Amber is already the colour page 1 turned, so this is the same event stated
/// louder, not a new vocabulary. No scold: it names the drift and the band and
/// gets out of the way.
struct WMomentHeadsUp: View {
    let direction: WHeadsUpDirection
    /// The live pace. "7:48".
    let pace: String
    var paceUnit: String = "/mi"
    /// The band itself. "8:15–8:45" — the sentence is composed here so the
    /// copy lives in one place.
    let band: String

    var body: some View {
        WBoard {
            WMomentFrame(spacing: 6) {
                WDisplayWord(text: direction.verb, size: 29,     // 58px
                             color: WatchV5.attention)

                WMetric(value: pace, unit: paceUnit,
                        rank: .hero, grade: .outOfBand, size: 48)

                Text("Band is \(band)")
                    .font(WatchV5.number(18))                    // 36px
                    .foregroundStyle(WatchV5.valueDim)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
        }
    }
}

/// Paused.
///
/// The one moment the runner is standing still, so it is the one that carries
/// controls — and the one moment that does NOT give the screen back on its
/// own. Two numbers to prove the run is still there, and two answers.
///
/// Both targets are the same 50pt height, because a sweating thumb deserves
/// the same area either way: Resume leads on FILL, not on size (rule 6).
/// Neither verb is destructive here — ending a run saves it — so neither is
/// drawn as text.
struct WMomentPaused: View {
    /// "5.72".
    let distance: String
    var distanceUnit: String = "mi"
    /// "44:16".
    let elapsed: String
    var label: String = "Paused"
    var resumeLabel: String = "Resume"
    var endLabel: String = "End run"
    let onResume: () -> Void
    let onEnd: () -> Void

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 4) {
                    WKicker(text: label, size: 13)               // 26px
                    WMetric(value: distance, unit: distanceUnit,
                            rank: .hero, size: 38)      // 76px
                    Text(elapsed)
                        .font(WatchV5.number(28))                // 56px
                        .foregroundStyle(WatchV5.valueDim)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)

                WTargetStack {
                    WTarget(label: resumeLabel, weight: .filled, action: onResume)
                    WTarget(label: endLabel, weight: .quiet, action: onEnd)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

// MARK: - Previews
//
// Fixture values are the design file's own, board for board, so a preview that
// stops matching the html is a regression and not a taste difference.

#Preview("Warm-up") {
    WPhaseWarmUp(
        remaining: "4:12",
        pace: WBandReading(value: "8:38", inBand: true,
                           bandStart: 0.22, bandEnd: 0.86, marker: 0.44),
        heartRate: "128"
    )
}

#Preview("Work interval") {
    WPhaseWorkInterval(
        repIndex: 3, repCount: 6,
        remaining: "1:42",
        pace: WBandReading(value: "6:48", inBand: true,
                           bandStart: 0.26, bandEnd: 0.70, marker: 0.48),
        heartRate: "168",
        distance: "0.42"
    )
}

#Preview("Recovery") {
    WPhaseRecovery(
        remaining: "1:48",
        heartRate: "138",
        repIndex: 3, repCount: 6
    )
}

#Preview("Strides") {
    WPhaseStrides(strideIndex: 4, strideCount: 8, remaining: "0:18")
}

#Preview("Threshold") {
    WPhaseThreshold(
        blockIndex: 2, blockCount: 2,
        pace: WBandReading(value: "6:54", inBand: true,
                           bandStart: 0.30, bandEnd: 0.68, marker: 0.50),
        averagePace: "6:57",
        heartRate: "171",
        elapsed: "14:26",
        progress: 0.72
    )
}

#Preview("Race") {
    WPhaseRace(
        mileLabel: "Mile 9",
        goalLabel: "sub 3:30",
        pace: WBandReading(value: "7:56", inBand: true,
                           bandStart: 0.34, bandEnd: 0.66, marker: 0.46),
        onGoal: "\u{2212}0:22",
        distance: "9.14",
        elapsed: "1:12:18",
        progress: 0.35
    )
}

#Preview("Work interval · off band") {
    WPhaseWorkInterval(
        repIndex: 4, repCount: 6,
        remaining: "0:58",
        pace: WBandReading(value: "7:14", inBand: false,
                           bandStart: 0.26, bandEnd: 0.70, marker: 0.86),
        heartRate: "174",
        distance: "0.21"
    )
}

#Preview("Moment · Go") {
    WMomentGo(session: "easy")
}

#Preview("Moment · Phase change") {
    WMomentPhaseChange(
        word: "Work",
        detail: "Rep 4 of 6 \(WatchV5.separator) 3 min",
        band: "6:45\u{2013}7:00"
    )
}

#Preview("Moment · Split") {
    WMomentSplit(label: "Mile 5", time: "7:48", comparison: "4 sec quicker")
}

#Preview("Moment · Fuel") {
    WMomentFuel(index: 2, total: 3)
}

#Preview("Moment · Heads-up") {
    WMomentHeadsUp(direction: .easeOff, pace: "7:48", band: "8:15\u{2013}8:45")
}

#Preview("Moment · Heads-up quicken") {
    WMomentHeadsUp(direction: .quicken, pace: "7:14", band: "6:45\u{2013}7:00")
}

#Preview("Moment · Paused") {
    WMomentPaused(distance: "5.72", elapsed: "44:16",
                  onResume: {}, onEnd: {})
}
