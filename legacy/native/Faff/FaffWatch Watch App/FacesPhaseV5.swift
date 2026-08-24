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

// MARK: - What used to be here
//
// Six V5 phase boards, a shared `WPhaseScaffold`, and the `WBandReading`
// type they were built on. All deleted 2026-08-24.
//
// They were replaced by `PhaseFaceV6`, which the router has built since the
// foundation landed, and nothing referenced them: not the router, not each
// other, only their own previews. Dead code shaped like a shipping board is
// a trap — the heart-dropout board in FacesControlV5 was the same shape and
// still carried the three-different-sizes defect that page 1 had already
// had fixed, so anyone opening the file would have found a board that looked
// current, looked wrong, and could not be reached.
//
// The Moments below ARE live.

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
