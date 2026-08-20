//
//  PanelV5.swift
//  faff.run iPhone · the day-state gradient panel, and the two things that
//  make it work: an oklab ramp and a grain layer.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE PANEL
//
//  Every "place" screen opens with a full-bleed gradient panel that runs from
//  behind the status bar down, rounded 30 at the BOTTOM corners only, and
//  scrolls away with the content. It carries the place label, the week strip,
//  the display-face headline and a translucent stats plate.
//
//  Two screens deliberately have no gradient — injury flare and off-season —
//  because there is no session to prescribe. They use the same container with
//  `.quiet`, which paints surface-2 instead. That is a designed state, not a
//  missing one.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THE RAMP IS NOT A PLAIN LinearGradient
//
//  The design's ramps are `linear-gradient(135deg in oklab, …)` with three
//  stops at 0% / 76% / 185% and an easing hint either side of the middle stop.
//  Two things in that are load-bearing:
//
//  · **oklab.** Interpolating #3EBD41 → #1F8A52 in sRGB puts a visible grey
//    crease at the midpoint. oklab is perceptually uniform and does not.
//    SwiftUI interpolates in its working space, not oklab, so this file
//    converts, interpolates and converts back, then hands SwiftUI a ramp
//    already sampled densely enough that its own interpolation cannot show.
//
//  · **The 185% terminal.** The darkest stop sits past the panel's edge on
//    purpose, so the deep end stays only just darker rather than bottoming
//    out inside the frame. Handing SwiftUI a stop at 1.85 would clamp it to
//    1.0 and darken every panel wrongly, so the ramp is re-sampled across the
//    0…1 window the panel actually shows.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE GRAIN IS NOT DECORATION
//
//  "Each gradient panel also carries a fine feTurbulence grain layer at 50%
//  opacity, mix-blend-mode: overlay, sitting between the gradient and the
//  type — this is what keeps white text legible on the gradient without a
//  scrim."
//
//  So: no scrim, and do not drop the grain. It is generated once, cached, and
//  tiled — a 180×180 tile, the same size the design's SVG filter uses.
//

import SwiftUI
import UIKit

// MARK: - oklab

/// Just enough oklab to interpolate a ramp without a hue crease.
/// Björn Ottosson's sRGB ↔ oklab, unmodified.
enum Oklab {

    static func fromSRGB(_ c: Color) -> (L: Double, a: Double, b: Double, alpha: Double) {
        let (r, g, bb, alpha) = components(c)
        let lr = linear(r), lg = linear(g), lb = linear(bb)

        let l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
        let m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
        let s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb

        let l_ = cbrt(l), m_ = cbrt(m), s_ = cbrt(s)
        return (
            0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
            1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
            0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
            alpha
        )
    }

    static func toSRGB(_ c: (L: Double, a: Double, b: Double, alpha: Double)) -> Color {
        let l_ = c.L + 0.3963377774 * c.a + 0.2158037573 * c.b
        let m_ = c.L - 0.1055613458 * c.a - 0.0638541728 * c.b
        let s_ = c.L - 0.0894841775 * c.a - 1.2914855480 * c.b

        let l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_

        let r =  4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
        let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
        let b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s

        return Color(.sRGB,
                     red: gamma(r), green: gamma(g), blue: gamma(b),
                     opacity: c.alpha)
    }

    static func mix(_ x: (L: Double, a: Double, b: Double, alpha: Double),
                    _ y: (L: Double, a: Double, b: Double, alpha: Double),
                    _ t: Double) -> (L: Double, a: Double, b: Double, alpha: Double) {
        (x.L + (y.L - x.L) * t,
         x.a + (y.a - x.a) * t,
         x.b + (y.b - x.b) * t,
         x.alpha + (y.alpha - x.alpha) * t)
    }

    private static func linear(_ v: Double) -> Double {
        v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
    }

    private static func gamma(_ v: Double) -> Double {
        let c = min(max(v, 0), 1)
        return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1 / 2.4) - 0.055
    }

    private static func components(_ c: Color) -> (Double, Double, Double, Double) {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(c).getRed(&r, green: &g, blue: &b, alpha: &a)
        return (Double(r), Double(g), Double(b), Double(a))
    }
}

// MARK: - The ramp

enum V5Ramp {

    /// The design's easing hints, as fractions of the whole gradient line.
    /// One per gap between stops. A hint at 34% between a stop at 0% and one
    /// at 76% means the two colours reach their halfway mix at 34%, not 38%.
    private static let hints: [Double] = [0.34, 1.08]

    /// The number of stops handed to SwiftUI. Dense enough that SwiftUI's own
    /// sRGB interpolation between neighbours is below a JND.
    private static let samples = 33

    /// Build a SwiftUI gradient for a day state, sampled in oklab across the
    /// 0…1 window the panel actually shows.
    static func gradient(_ state: V5.DayState) -> LinearGradient {
        LinearGradient(
            stops: stops(colors: state.stops, locations: state.locations),
            startPoint: .topLeading,     // CSS 135deg · top-left to bottom-right
            endPoint: .bottomTrailing
        )
    }

    static func stops(colors: [Color], locations: [Double]) -> [Gradient.Stop] {
        let lab = colors.map(Oklab.fromSRGB)
        return (0..<samples).map { i in
            let p = Double(i) / Double(samples - 1)     // 0…1, the visible window
            return Gradient.Stop(color: Oklab.toSRGB(sample(lab, locations, at: p)),
                                 location: p)
        }
    }

    /// Sample the CSS ramp at `p` along the gradient line.
    private static func sample(_ lab: [(L: Double, a: Double, b: Double, alpha: Double)],
                               _ loc: [Double],
                               at p: Double) -> (L: Double, a: Double, b: Double, alpha: Double) {
        if p <= loc[0] { return lab[0] }
        for i in 0..<(loc.count - 1) {
            let a = loc[i], b = loc[i + 1]
            guard p < b else { continue }
            let t = (p - a) / (b - a)
            return Oklab.mix(lab[i], lab[i + 1], eased(t, hint: hints[min(i, hints.count - 1)], a: a, b: b))
        }
        return lab[lab.count - 1]
    }

    /// The CSS colour-hint curve: the midpoint of the transition is moved to
    /// `hint`, and everything either side is warped by the exponent that puts
    /// it there. A hint outside the gap (the 108% one) leaves it linear.
    private static func eased(_ t: Double, hint: Double, a: Double, b: Double) -> Double {
        let h = (hint - a) / (b - a)
        guard h > 0, h < 1, abs(h - 0.5) > 0.001 else { return t }
        return pow(t, log(0.5) / log(h))
    }
}

// MARK: - Grain

/// The fine noise layer that sits between a gradient and its type. Generated
/// once per process, cached, and tiled at the design's own 180×180.
///
/// The design's source is an SVG `feTurbulence type='fractalNoise'
/// baseFrequency='.9' numOctaves='2'`. At that frequency the first octave is
/// very nearly per-pixel, so this reproduces it as per-pixel value noise plus
/// a half-amplitude second octave for a little clumping. Deterministic: the
/// same seed every launch, so the grain never crawls between renders.
enum V5Grain {

    static let tileSize = 180

    static let image: Image = Image(uiImage: make())

    private static func make() -> UIImage {
        let n = tileSize
        var px = [UInt8](repeating: 0, count: n * n * 4)

        // A fixed-seed xorshift. No Foundation randomness: the tile must be
        // byte-identical on every launch or the grain shimmers on a redraw.
        var state: UInt32 = 0x5A1F_F2B0
        func rand() -> Double {
            state ^= state << 13
            state ^= state >> 17
            state ^= state << 5
            return Double(state) / Double(UInt32.max)
        }

        // Octave 2 · a coarser lattice at half amplitude, bilinear-sampled.
        let coarse = n / 3
        var lattice = [Double](repeating: 0, count: (coarse + 1) * (coarse + 1))
        for i in lattice.indices { lattice[i] = rand() }

        for y in 0..<n {
            for x in 0..<n {
                let fy = Double(y) / Double(n) * Double(coarse)
                let fx = Double(x) / Double(n) * Double(coarse)
                let y0 = Int(fy), x0 = Int(fx)
                let ty = fy - Double(y0), tx = fx - Double(x0)
                let l = lattice[y0 * (coarse + 1) + x0]
                let r = lattice[y0 * (coarse + 1) + x0 + 1]
                let bl = lattice[(y0 + 1) * (coarse + 1) + x0]
                let br = lattice[(y0 + 1) * (coarse + 1) + x0 + 1]
                let octave2 = (l + (r - l) * tx) * (1 - ty) + (bl + (br - bl) * tx) * ty

                // fractalNoise sums octaves at halving amplitude and stays
                // CENTRED ON 0.5 — that is what makes overlay a no-op on
                // average and a texture locally.
                //
                // The amplitude matters more than anything else here, and it
                // is the one thing a first pass gets wrong. Uniform noise over
                // the full 0…1 range is not what feTurbulence produces: two
                // octaves of smooth gradient noise concentrate tightly around
                // the midpoint, and the difference on a device is the gap
                // between a fine tooth and visible static. Checked on glass,
                // not by reading the filter spec.
                let deviation = 0.30
                for c in 0..<3 {
                    let n1 = rand(), n2 = octave2
                    let v = 0.5 + ((n1 * 0.667 + n2 * 0.333) - 0.5) * deviation
                    px[(y * n + x) * 4 + c] = UInt8(min(max(v, 0), 1) * 255)
                }
                // Opaque. The layer's own 50% opacity is the design's stated
                // strength; noising alpha as well would double-dip it.
                px[(y * n + x) * 4 + 3] = 255
            }
        }

        let cs = CGColorSpaceCreateDeviceRGB()
        let ctx = CGContext(data: &px, width: n, height: n,
                            bitsPerComponent: 8, bytesPerRow: n * 4, space: cs,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        return UIImage(cgImage: ctx.makeImage()!)
    }
}

extension View {
    /// The grain layer, at the design's own 50% opacity and overlay blend.
    /// Applied by `DayPanel`; a screen drawing its own gradient surface (the
    /// onboarding reveal poster, a race poster) applies it directly.
    func v5Grain() -> some View {
        overlay(
            V5Grain.image
                .resizable(resizingMode: .tile)
                .opacity(Theme.V5.DayState.grainOpacity)
                .blendMode(.overlay)
                .allowsHitTesting(false)
        )
    }
}

// MARK: - The panel

/// What a panel is painted with.
enum PanelFill: Equatable {
    /// A day-state gradient, with grain.
    case state(V5.DayState)
    /// No gradient: a quiet fill, for the screens with nothing to prescribe.
    /// A designed state, not a missing one.
    case quiet
}

/// The full-bleed panel every "place" screen opens with.
///
/// It runs from behind the status bar down and rounds its BOTTOM corners
/// only. Put it as the first child of the scrolling band, and give the band
/// `V5.S.gutter` horizontal padding: the panel escapes that gutter itself.
struct DayPanel<Content: View>: View {
    let fill: PanelFill
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s20) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, V5.S.s20)
        .padding(.bottom, 26)
        // ── Reaching behind the status bar ──────────────────────────────
        //
        // "Full-bleed gradient panel from the status bar down." The system
        // draws the clock and the glyphs over whatever is beneath them, so
        // the gradient has to start at the very top of the display, not below
        // the safe-area inset — otherwise a black strip sits above it and the
        // panel reads as a card rather than as the top of the screen.
        //
        // Done by pulling the panel UP by the inset and pushing its content
        // back DOWN by the same amount: the gradient gains the status-bar
        // band, the content does not move, and the enclosing scroll view
        // keeps its ordinary safe-area behaviour. `.ignoresSafeArea` on the
        // background alone does not do this — the background is clipped to
        // the panel's frame, and the frame is what starts too low.
        .padding(.top, V5.Shell.statusBarInset)
        .background(alignment: .top) {
            Group {
                switch fill {
                case .state(let s): V5Ramp.gradient(s)
                case .quiet:        V5.surface2
                }
            }
            .v5Grain()
        }
        .clipShape(PanelShape(radius: V5.R.panel))
        .padding(.top, -V5.Shell.statusBarInset)
        // Escape the content band's gutter.
        .padding(.horizontal, -V5.S.gutter)
    }
}

/// Bottom corners only, per the design's `border-radius:0 0 30px 30px`.
struct PanelShape: Shape {
    var radius: CGFloat

    func path(in rect: CGRect) -> Path {
        Path(UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: [.bottomLeft, .bottomRight],
            cornerRadii: CGSize(width: radius, height: radius)
        ).cgPath)
    }
}

// MARK: - The stats plate

/// The translucent plate a panel carries: three values, side by side, on
/// `rgba(255,255,255,.16)` at radius 18.
///
/// Values go through `FaffValue`, so a projected number on a poster carries
/// its amber tilde without the caller remembering to add one.
struct PanelStat: Identifiable, Equatable {
    let id = UUID()
    let label: String
    let value: FaffValue
    /// Overrides the value's ink. Used for a gap that is behind its goal,
    /// which the design draws in amber.
    var ink: Color?

    init(_ label: String, _ value: FaffValue, ink: Color? = nil) {
        self.label = label
        self.value = value
        self.ink = ink
    }
}

struct PanelStatPlate: View {
    let stats: [PanelStat]

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: V5.S.s16) {
            ForEach(stats) { s in
                VStack(alignment: .leading, spacing: V5.S.s6) {
                    Text(s.label)
                        .font(.faffText(TypeScaleV5.label12))
                        .foregroundStyle(V5.OnPanel.secondary)
                    FaffValueText(s.value,
                                  font: .faffText(17, weight: .semibold),
                                  color: s.ink ?? V5.OnPanel.primary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.vertical, V5.S.s16)
        .padding(.horizontal, V5.S.tilePad)
        .background(V5.OnPanel.plate, in: RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
    }
}
