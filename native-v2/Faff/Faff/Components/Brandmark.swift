//
//  Brandmark.swift
//  The FAFF logomark (blocky rounded letterforms · David's brand asset,
//  shipped as Assets/FaffLogo.imageset). 2026-06-11: replaced the old
//  "FAFF·RUN" Anton wordmark with the new logo so every surface (sign-in,
//  onboarding) shows the current mark. The signature animated rainbow
//  sweep is preserved by masking it through the new letterforms; `.mono`
//  is the solid one-color fallback.
//

import SwiftUI

struct Brandmark: View {
    /// Rendered height of the logo in points.
    let size: CGFloat
    /// `.swept` is the primary animated rainbow lockup on dark surfaces.
    /// `.mono` is the solid foreground-tinted fallback.
    var style: Style = .swept

    enum Style { case swept, mono }

    /// The new logo as a tintable template image, framed to `size` tall.
    private var logo: some View {
        Image("FaffLogo")
            .renderingMode(.template)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(height: size)
    }

    var body: some View {
        switch style {
        case .swept:
            logo
                .foregroundStyle(.clear)
                .overlay { AnimatedSweep().mask(logo) }
        case .mono:
            logo
                .foregroundStyle(Theme.txt)
        }
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
