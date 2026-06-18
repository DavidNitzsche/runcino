//
//  GapBeam.swift
//  Horizontal projected → goal progress beam with "gap" striped tail.
//  Used on targets hero, withinreach, raceday gap bar.
//

import SwiftUI

struct GapBeam: View {
    /// 0..1 fraction of how close projected is to goal.
    let progress: Double
    var height: CGFloat = 14
    /// Colors for filled portion (gradient) and gap tail.
    var fillStops: [Color] = [Color(hex: 0xFFD27A).opacity(0.55), Color(hex: 0xE88021).opacity(0.92)]
    var gapColor: Color = Theme.goal
    /// Show the "now" knob.
    var showKnob: Bool = true

    var body: some View {
        let p = max(0.06, min(0.94, progress))
        GeometryReader { geo in
            let w = geo.size.width
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.1))
                    .frame(height: height)

                LinearGradient(colors: fillStops, startPoint: .leading, endPoint: .trailing)
                    .frame(width: max(0, w * CGFloat(p)), height: height)
                    .clipShape(UnevenRoundedRectangle(
                        topLeadingRadius: height / 2,
                        bottomLeadingRadius: height / 2,
                        bottomTrailingRadius: 0,
                        topTrailingRadius: 0
                    ))

                StripedFill(color: gapColor)
                    .frame(width: max(0, w * CGFloat(1 - p)), height: height)
                    .clipShape(UnevenRoundedRectangle(
                        topLeadingRadius: 0,
                        bottomLeadingRadius: 0,
                        bottomTrailingRadius: height / 2,
                        topTrailingRadius: height / 2
                    ))
                    .offset(x: w * CGFloat(p))

                // Goal flag
                Capsule()
                    .fill(Color.white)
                    .frame(width: 3, height: height + 8)
                    .offset(x: w - 1, y: -4)

                if showKnob {
                    Circle()
                        .fill(Color.white)
                        .frame(width: 16, height: 16)
                        .shadow(color: .white.opacity(0.78), radius: 6)
                        .offset(x: w * CGFloat(p) - 8, y: (height - 16) / 2)
                }
            }
        }
        .frame(height: height + 8)
    }
}

/// Tiny striped pattern used for the gap tail.
private struct StripedFill: View {
    let color: Color
    var body: some View {
        Canvas { ctx, size in
            let stripe: CGFloat = 6
            var x: CGFloat = -size.height
            while x < size.width + size.height {
                let path = Path { p in
                    p.move(to: CGPoint(x: x, y: 0))
                    p.addLine(to: CGPoint(x: x + size.height, y: size.height))
                    p.addLine(to: CGPoint(x: x + size.height + stripe, y: size.height))
                    p.addLine(to: CGPoint(x: x + stripe, y: 0))
                    p.closeSubpath()
                }
                ctx.fill(path, with: .color(color.opacity(0.34)))
                x += stripe * 2
            }
            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(color.opacity(0.12)))
        }
    }
}
