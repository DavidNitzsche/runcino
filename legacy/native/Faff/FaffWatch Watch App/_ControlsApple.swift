//
//  _ControlsApple.swift
//  FaffWatch
//
//  THE ALTERNATIVE CONTROLS BOARD, for comparison only. Not wired.
//
//  The shipping controls board is three stacked full-width pills, which is
//  what the 0821 handoff draws and what its rule 6 requires: "Every target is
//  50pt tall, full width, pill radius. No exceptions."
//
//  Apple's kit draws the same job differently — `Guides - Layout / Three
//  Bottom Controls`: two 35pt round slots at the sides and one 46pt slot in
//  the centre, sharing a centre line, with the emphasised verb in the middle.
//  Round slots take icons, not the words Lap / Pause / End run, so this
//  version also carries Apple's caption-under-the-glyph pattern.
//
//  The two cannot both be right and the conflict is real, so this exists to be
//  looked at beside the other rather than argued about in the abstract.
//
//  WHAT CHANGES, beyond the shape:
//    · the lead verb moves to the CENTRE, because that is the emphasised slot
//      in Apple's arrangement and the largest target. Reading order stops
//      being left-to-right.
//    · each verb needs a glyph that survives without its caption, since the
//      caption is 11pt. "End run" as a glyph is the hard one.
//    · the board stops being able to carry a verb that is a sentence, so the
//      confirmations (End confirm, Skip confirm) would keep pills regardless.
//
import SwiftUI

struct FaceControlsAppleV1: View {
    var mode: WControlsMode = .steady
    let header: String
    let onLead: () -> Void
    let onPause: () -> Void
    let onEnd: () -> Void

    private var g: WatchLayout.Guides { WatchLayout.current }

    private var leadGlyph: String {
        switch mode {
        case .steady:     return "flag.fill"
        case .structured: return "forward.fill"
        }
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            WatchV5.ground.ignoresSafeArea()

            WKicker(text: header, color: WatchV5.valueMute)
                .offset(x: g.margins.minX, y: g.clockClearance)

            // NOT on Apple's Three-Bottom-Controls centre line.
            //
            // That line is for a control BAR sitting under content, and it has
            // no captions: at y=212.5 on a 46mm the 46pt centre slot ends at
            // 235, so a caption under it starts at 240 and runs off a 248pt
            // display. The first version of this file did exactly that and
            // clipped "Lap" and "Skip rep" in half.
            //
            // Apple's own Workout app does not use the bar for this screen
            // either — its in-session controls are a grid of round buttons with
            // captions beneath, sitting in the body of the screen. So the slot
            // SIZES are Apple's and the position is the body of the content
            // box, which is the honest version of the comparison.
            HStack(alignment: .top, spacing: 0) {
                slotColumn("pause.fill", "Pause", size: g.sideControl,
                           emphasised: false, action: onPause)
                slotColumn(leadGlyph, mode.leadVerb, size: g.centerControl,
                           emphasised: true, action: onLead)
                slotColumn("xmark", "End run", size: g.sideControl,
                           emphasised: false, action: onEnd)
            }
            .frame(width: g.margins.width)
            .offset(x: g.margins.minX)
            .frame(height: g.screen.height, alignment: .center)
        }
        .frame(width: g.screen.width, height: g.screen.height)
        .ignoresSafeArea()
    }

    /// One control and its caption, in a third of the content width — so the
    /// caption is bounded by the COLUMN and not by the circle. Bounding it by
    /// the circle clipped "Skip rep" against a 46pt slot.
    private func slotColumn(_ symbol: String, _ caption: String, size: CGFloat,
                            emphasised: Bool, action: @escaping () -> Void) -> some View {
        VStack(spacing: 6) {
            Button(action: action) {
                Image(systemName: symbol)
                    .font(.system(size: size * 0.42, weight: .semibold))
                    .foregroundStyle(emphasised ? Color.black : WatchV5.value)
                    .frame(width: size, height: size)
                    .background(emphasised ? WatchV5.value : WatchV5.surface3,
                                in: Circle())
            }
            .buttonStyle(.plain)

            Text(caption)
                .font(WatchV5.label(11, .semibold))
                .foregroundStyle(WatchV5.valueLabel)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
        .frame(maxWidth: .infinity)
    }

}
