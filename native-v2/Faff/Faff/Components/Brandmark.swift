//
//  Brandmark.swift
//  The FAFF·RUN wordmark + supporting marks.
//
//  Anton, uppercase, skew −9°, animated rainbow sweep 6s linear ∞,
//  with a solid gold #F5C518 middot between FAFF and RUN. Never re-letter,
//  re-color the sweep, or unskew (per brand-identity.html).
//

import SwiftUI

struct Brandmark: View {
    let size: CGFloat
    /// `.swept` is the primary animated rainbow lockup on dark surfaces.
    /// `.mono` is the white-with-gold-dot fallback for one-color contexts.
    var style: Style = .swept

    enum Style { case swept, mono }

    var body: some View {
        // Use SkewMark internally to share the skew + layout math.
        HStack(spacing: 0) {
            piece("FAFF")
            dot
            piece("RUN")
        }
        .rotation3DEffect(.degrees(0), axis: (x: 0, y: 0, z: 0))
        .transformEffect(skewTransform)
        .frame(height: size * 1.05)
    }

    @ViewBuilder
    private func piece(_ text: String) -> some View {
        switch style {
        case .swept:
            Text(text)
                .font(.brand(size))
                .textCase(.uppercase)
                .tracking(-size * 0.02)
                .overlay {
                    AnimatedSweep().mask(
                        Text(text)
                            .font(.brand(size))
                            .textCase(.uppercase)
                            .tracking(-size * 0.02)
                    )
                }
                .foregroundStyle(.clear)
        case .mono:
            Text(text)
                .font(.brand(size))
                .textCase(.uppercase)
                .tracking(-size * 0.02)
                .foregroundStyle(Theme.txt)
        }
    }

    private var dot: some View {
        Circle()
            .fill(Theme.Brand.dot)
            .frame(width: size * 0.16, height: size * 0.16)
            .padding(.horizontal, size * 0.03)
            .padding(.bottom, size * 0.04)
    }

    private var skewTransform: CGAffineTransform {
        CGAffineTransform(a: 1, b: 0,
                          c: CGFloat(tan(Theme.Brand.skewDegrees * .pi / 180)), d: 1,
                          tx: 0, ty: 0)
    }
}

// MARK: - The animated rainbow sweep

private struct AnimatedSweep: View {
    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate
            let cycle = (t / Theme.Brand.sweepDuration).truncatingRemainder(dividingBy: 1)
            // Sweep moves the gradient leftward across the wordmark.
            let shift = CGFloat(cycle) * 2.0
            GeometryReader { geo in
                LinearGradient(
                    stops: zip(Theme.Brand.sweepStops.indices, Theme.Brand.sweepStops).map { i, c in
                        .init(color: c, location: CGFloat(i) / CGFloat(Theme.Brand.sweepStops.count - 1))
                    },
                    startPoint: UnitPoint(x: -shift, y: 0.5),
                    endPoint: UnitPoint(x: 1 - shift + 1, y: 0.5)
                )
                .frame(width: geo.size.width * 2)
                .offset(x: -geo.size.width * shift / 2)
            }
        }
        .clipped()
    }
}
