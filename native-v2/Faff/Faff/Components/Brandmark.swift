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
                // REDUCE MOTION REACHES THE SPLASH TOO.
                //
                // `AnimatedSweep` is a `TimelineView(.animation)` — a
                // perpetual, never-settling animation, and it is on the first
                // thing the app draws on every cold launch plus the sign-in
                // screen. It was the one animation in the app that did not go
                // through `V5.Motion`, so it was also the one that ignored the
                // setting. A runner who has asked the system for less motion
                // gets the mark, held still, in the sweep's own colours.
                .overlay { sweepOrStill.mask(logo) }
                // The logo is an `Image`, so it is an accessibility element and
                // announced itself by asset name — "FaffLogo". It is the brand
                // mark on a splash; it says nothing a runner needs.
                .accessibilityHidden(true)
        case .mono:
            logo
                .foregroundStyle(Theme.txt)
                .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private var sweepOrStill: some View {
        if V5.Motion.reduced {
            LinearGradient(colors: Theme.Brand.sweepStops,
                           startPoint: .leading, endPoint: .trailing)
        } else {
            AnimatedSweep()
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
