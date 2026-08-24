//
//  _ControlsRedesign.swift
//  FaffWatch
//
//  Controls, redesigned. Two candidates, neither wired.
//
//  WHAT WAS WRONG WITH BOTH EXISTING VERSIONS
//
//  Apple's round slots left two thirds of the display empty and shrank the
//  targets from ~9,250pt of area to ~1,660. On a wrist that is moving, at mile
//  20, that is the wrong direction. Rejected.
//
//  The stacked pills are better but carry a milder version of the same fault:
//  they are laid out at a fixed 52.5pt with whatever is left over falling as
//  dead space between the header and the first verb. The board is a MODE — the
//  runner has stopped reading and is reaching — so every point of the display
//  that is not a target is a point doing nothing.
//
//  Both candidates below fill the screen. They differ on whether the three
//  verbs are equals.
//
import SwiftUI

// MARK: - A · Three bands

/// Equal thirds, filling everything under the header.
///
/// Targets grow from 52.5pt to whatever the display has left — about 62pt on a
/// 46mm — and the gaps between them stay at the 5pt that separates a target
/// from its neighbour rather than absorbing the slack. Nothing is centred in
/// space it is not using.
struct FaceControlsBandsV1: View {
    var mode: WControlsMode = .steady
    let header: String
    let onLead: () -> Void
    let onPause: () -> Void
    let onEnd: () -> Void

    private var g: WatchLayout.Guides { WatchLayout.current }

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 0) {
                WKicker(text: header, color: WatchV5.valueMute)
                    .padding(.leading, 2)
                    .padding(.bottom, 9)

                VStack(spacing: 5) {
                    band(mode.leadVerb, .filled, onLead)
                    band("Pause", .quiet, onPause)
                    band("End run", .quiet, onEnd)
                }
                .frame(maxHeight: .infinity)
            }
        }
    }

    private func band(_ label: String, _ weight: WTargetWeight,
                      _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(WatchV5.label(weight == .filled ? 20 : 19, .heavy))
                .foregroundStyle(weight == .filled ? Color.black
                                                   : WatchV5.value.opacity(0.86))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(weight == .filled ? WatchV5.value : WatchV5.surface3,
                            in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - B · One verb, then the rest

/// The three verbs are NOT equals, so this stops drawing them as if they were.
///
/// Lap and Skip rep do not interrupt the run. Pause does, reversibly. End run
/// does not reverse at all. So the lead verb takes the top half of the board
/// on its own, Pause takes a full-width band under it, and End run is a text
/// line at the foot — the same treatment "Discard it" already gets on End
/// confirm, and for the same reason: a filled pill beside a filled pill is how
/// a run gets ended by accident.
///
/// The trade: ending a run becomes a slightly smaller target on purpose. That
/// is the point, and End confirm still stands behind it.
struct FaceControlsWeightedV1: View {
    var mode: WControlsMode = .steady
    let header: String
    let onLead: () -> Void
    let onPause: () -> Void
    let onEnd: () -> Void

    private var g: WatchLayout.Guides { WatchLayout.current }

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 0) {
                WKicker(text: header, color: WatchV5.valueMute)
                    .padding(.leading, 2)
                    .padding(.bottom, 9)

                Button(action: onLead) {
                    Text(mode.leadVerb)
                        .font(WatchV5.label(26, .heavy))
                        .foregroundStyle(Color.black)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(WatchV5.value,
                                    in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                }
                .buttonStyle(.plain)
                .frame(maxHeight: .infinity)

                Button(action: onPause) {
                    Text("Pause")
                        .font(WatchV5.label(19, .heavy))
                        .foregroundStyle(WatchV5.value.opacity(0.86))
                        .frame(maxWidth: .infinity)
                        .frame(height: g.pill.height)
                        .background(WatchV5.surface3, in: Capsule())
                }
                .buttonStyle(.plain)
                .padding(.top, 6)

                WDestructive(label: "End run", action: onEnd)
                    .padding(.top, 2)
            }
        }
    }
}


// MARK: - C · Colour carries the hierarchy

/// David, 2026-08-24: "end run can be RED and Pause can be ORANGE."
///
/// This is the version where that idea does the most work, because colour
/// replaces the thing SIZE was being used for. The weighted candidate made the
/// lead verb huge and demoted End run to a text line so the three would not
/// read as equals. If the verbs are coloured they no longer need to be
/// different sizes to be different things — so all three go back to equal
/// bands filling the screen, and every one of them is a full-size target.
///
/// WHY COLOUR IS SAFE HERE AND NOWHERE ELSE. The palette keeps colour off
/// everything but the graded metric because a coloured number reads as a
/// graded number. This board has NO numbers on it. Nothing is present that a
/// hue could be mistaken for a judgement about, so colour is free to mean what
/// the button does.
///
/// It also matches Apple: the Workout app's own in-session controls are a red
/// End and an amber Pause.
///
/// THE ONE RISK, and why `pauseTone` is a parameter. Signal orange #FF5A1F and
/// fault red #FF4438 are about ten degrees apart. Stacked adjacently, at arm's
/// length, on a moving wrist, they may not separate. Attention amber #F2B03C
/// plainly does — and amber already means "a condition, a decision waiting",
/// which is what a pause is.
struct FaceControlsTonedV1: View {
    var mode: WControlsMode = .steady
    /// Drop the lead verb entirely and run two targets.
    ///
    /// On a steady run the lead verb is Lap, and Lap does nothing the runner
    /// can see: it closes the current segment, and no board in this app draws a
    /// lap figure — not page 1, not page 2, not any phase board. `lapCount` and
    /// `lastLapElapsedSec` exist in the engine and are never rendered. So the
    /// controls dismiss and every number on screen is identical.
    ///
    /// A verb whose effect is invisible cannot be understood from its label,
    /// which is exactly how it reads. Inside a rep the same slot is Skip rep,
    /// which has an obvious referent and stays.
    var showsLead: Bool = true
    /// Rename the lead verb, for comparing "Lap" against "Split".
    var leadOverride: String? = nil
    let header: String
    /// The pause fill. Amber and signal orange both drawn so the pair can be
    /// judged against red rather than argued about.
    var pauseTone: Color = WatchV5.attention
    /// End run as a filled band, or as a coloured line with no pill.
    var endFilled: Bool = true
    let onLead: () -> Void
    let onPause: () -> Void
    let onEnd: () -> Void

    private var g: WatchLayout.Guides { WatchLayout.current }

    /// TOP AND BOTTOM GAPS, MEASURED AND MATCHED.
    ///
    /// The stack used to sit in normal flow: bands filling, count after them.
    /// That put 4pt between the clock's ink and the first button and 20pt
    /// between the last button and the count — the buttons nearly touching the
    /// clock and floating clear of the foot. Flow cannot fix it, because the
    /// count's position is then whatever is left over.
    ///
    /// So both ends are pinned instead. The running faces already settle the
    /// top number: their first ink lands at 44pt, 12pt below the clock's ink at
    /// 32. Controls now starts its first band at the same 44. The count keeps
    /// the position it has on every phase board, and the last band ends 12pt
    /// above it.
    ///
    /// Equal gaps top and bottom, and the band height falls out of the two
    /// rather than being chosen: 53.7pt on a 46mm, which is larger than the
    /// 52.5pt pill it replaces.
    private var topPad: CGFloat { 8 }      // 36 (clock clearance) + 8 = 44
    private var footPad: CGFloat { 15 }    // last band ends at 215; count inks at 227

    var body: some View {
        WBoard {
            ZStack(alignment: .bottom) {
                VStack(spacing: 5) {
                    if showsLead {
                        band(leadOverride ?? mode.leadVerb, fill: WatchV5.value, ink: .black, action: onLead)
                    }
                    band("Pause", fill: pauseTone, ink: .black, action: onPause)
                    if endFilled {
                        // Safe as a filled target because End run is not the
                        // destructive step — it opens End confirm, where the
                        // actual discard is still text with no pill.
                        band("End run", fill: WatchV5.fault, ink: .white, action: onEnd)
                    } else {
                        Button(action: onEnd) {
                            Text("End run")
                                .font(WatchV5.label(19, .heavy))
                                .foregroundStyle(WatchV5.fault)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, topPad)
                .padding(.bottom, footPad)
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                // Pinned to the foot, not left to the end of the flow — which
                // is what makes the bottom gap a decision rather than a
                // remainder. Into the bottom inset by the same 10pt the phase
                // boards use, safe at the horizontal centre where the corner
                // curve is furthest away.
                Text(header)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .tracking(0.4)
                    .foregroundStyle(.white.opacity(0.42))
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                    .frame(maxWidth: .infinity, alignment: .center)
                    // Measured from the BEZEL, not from the content box, so the
                    // count sits the same 12pt off the bottom of every watch.
                    // A fixed offset put it 5.5pt off on the 42mm — under the
                    // corner curve — and 19pt off on the Ultra.
                    .offset(y: g.bottomInset - 8)
            }
        }
    }

    private func band(_ label: String, fill: Color, ink: Color,
                      action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(WatchV5.label(19, .heavy))
                .foregroundStyle(ink)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(fill, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
