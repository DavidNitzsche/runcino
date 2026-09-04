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
    private static let samples = 65

    /// Build a SwiftUI gradient for a day state, sampled in oklab across the
    /// 0…1 window the panel actually shows.
    static func gradient(_ state: V5.DayState) -> LinearGradient {
        LinearGradient(
            stops: stops(colors: state.stops, locations: state.locations),
            startPoint: .topLeading,     // CSS 135deg · top-left to bottom-right
            endPoint: .bottomTrailing
        )
    }

    /// How many smoothing passes run over the sampled ramp.
    ///
    /// THE CREASE THIS REMOVES. The CSS colour-hint easing is
    /// `pow(t, log(0.5)/log(h))`, and its slope at `t = 0` is INFINITE for any
    /// exponent below 1. That is harmless at the top of the panel, where the
    /// first segment starts and there is nothing above it to disagree with.
    /// It is not harmless at the middle stop: the first segment ARRIVES there
    /// at a slope near 1.1 and the second LEAVES at infinity, so the rate of
    /// colour change jumps discontinuously at one line across the panel.
    ///
    /// The colour is continuous — only its derivative is not — which is
    /// exactly the condition the eye reads as a hard edge rather than as
    /// banding. On the easy ramp the middle stop sits at 76%, and that is
    /// where David saw "a pretty hard diagonal line from the light to dark
    /// colour".
    ///
    /// More samples cannot fix it: the kink is in the function, not in how
    /// finely it is measured. Smoothing the SAMPLED values does, because it
    /// makes the first derivative continuous while leaving every authored stop
    /// where the design put it — the endpoints are never touched, and the
    /// filter is symmetric, so the ramp keeps its shape and loses its corner.
    private static let smoothingPasses = 3

    static func stops(colors: [Color], locations: [Double]) -> [Gradient.Stop] {
        let lab = colors.map(Oklab.fromSRGB)
        var pts = (0..<samples).map { i -> (L: Double, a: Double, b: Double, alpha: Double) in
            sample(lab, locations, at: Double(i) / Double(samples - 1))
        }
        // A symmetric 1-2-1 kernel over the interior. Endpoints are pinned so
        // the ramp still begins and ends on the design's own colours.
        for _ in 0..<smoothingPasses {
            var next = pts
            for i in 1..<(pts.count - 1) {
                next[i] = (
                    L:     (pts[i - 1].L     + 2 * pts[i].L     + pts[i + 1].L)     / 4,
                    a:     (pts[i - 1].a     + 2 * pts[i].a     + pts[i + 1].a)     / 4,
                    b:     (pts[i - 1].b     + 2 * pts[i].b     + pts[i + 1].b)     / 4,
                    alpha: (pts[i - 1].alpha + 2 * pts[i].alpha + pts[i + 1].alpha) / 4)
            }
            pts = next
        }
        return pts.enumerated().map { i, c in
            Gradient.Stop(color: Oklab.toSRGB(c), location: Double(i) / Double(samples - 1))
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

    /// Device-resolution grain, so one noise sample is one physical pixel.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// WHY THE FIRST TWO ATTEMPTS LOOKED WRONG
    ///
    /// Pass one was full-range white noise and read as visible static.
    ///
    /// Pass two dropped the amplitude but kept a second "octave" built as a
    /// COARSER lattice — a 60-cell grid bilinear-sampled across the tile — at
    /// a third of the weight. That is backwards. In fractal noise the octaves
    /// go UP in frequency and DOWN in amplitude; a low-frequency layer at
    /// meaningful weight is not grain, it is clouds. Tiled at one sample per
    /// POINT it was 3 device pixels per sample on top of that, so the clumps
    /// landed around nine pixels across. Blotchy, exactly as it looked.
    ///
    /// This renders at the device's own scale and drops the low-frequency
    /// layer entirely. What is left is per-pixel noise at a low amplitude,
    /// which is what film grain is and what the design's fine tooth reads as.
    /// The three colour channels get INDEPENDENT samples, the way feTurbulence
    /// does — shared samples give neutral grey speckle, independent ones give
    /// the faint chroma shimmer that keeps the panel from looking printed.
    private static func make() -> UIImage {
        // One sample per physical pixel, whatever the device is.
        let scale = Int(max(UIScreen.main.scale, 1))
        let n = tileSize * scale
        var px = [UInt8](repeating: 0, count: n * n * 4)

        // A fixed-seed xorshift. No Foundation randomness: the tile must be
        // byte-identical on every launch or the grain crawls on a redraw.
        var state: UInt32 = 0x5A1F_F2B0
        func rand() -> Double {
            state ^= state << 13
            state ^= state >> 17
            state ^= state << 5
            return Double(state) / Double(UInt32.max)
        }

        // Centred on 0.5 so `overlay` is a no-op on average and a texture
        // locally.
        //
        // The amplitude is the whole game, and it has taken four passes on a
        // real display to land: 1.0 read as static, 0.30-with-a-clouds-octave
        // read as blotches, 0.16 was a visible tooth, and this is the one that
        // reads as a surface rather than as an effect. Grain in this design is
        // there to keep white type legible on a gradient without a scrim — the
        // moment it is noticeable AS grain it is doing more than its job.
        let deviation = 0.085

        for i in 0..<(n * n) {
            for c in 0..<3 {
                let v = 0.5 + (rand() - 0.5) * deviation
                px[i * 4 + c] = UInt8(min(max(v, 0), 1) * 255)
            }
            // Opaque. The layer's own 50% opacity is the design's stated
            // strength; noising alpha as well would double-dip it.
            px[i * 4 + 3] = 255
        }

        let cs = CGColorSpaceCreateDeviceRGB()
        let ctx = CGContext(data: &px, width: n, height: n,
                            bitsPerComponent: 8, bytesPerRow: n * 4, space: cs,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        return UIImage(cgImage: ctx.makeImage()!,
                       scale: CGFloat(scale), orientation: .up)
    }
}

extension View {
    /// The grain layer, at the design's own 50% opacity and overlay blend.
    /// Applied by `DayPanel`; a screen drawing its own gradient surface (the
    /// onboarding reveal poster, a race poster) applies it directly.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// THE `.compositingGroup()` IS LOAD-BEARING
    ///
    /// A blend mode composites against whatever is BEHIND it in the rendering
    /// context, and it escapes an enclosing `.opacity()` unless the layer is
    /// flattened first. The shell keeps all three destinations alive and hides
    /// two of them with `.opacity(0)` — so the hidden Block and Races panels
    /// were still blending their gradients into the shared context, and the
    /// purple and blue leaked out as a faint hairline round the edge of the
    /// screen. David spotted it as "a weird outline".
    ///
    /// Flattening here means the overlay can only ever see the gradient it is
    /// sitting on, which is the only thing it was ever supposed to see.
    func v5Grain() -> some View {
        overlay(
            V5Grain.image
                .resizable(resizingMode: .tile)
                .opacity(Theme.V5.DayState.grainOpacity)
                .blendMode(.overlay)
                .allowsHitTesting(false)
        )
        .compositingGroup()
    }
}

// MARK: - The panel

/// What a panel is painted with.
extension PanelFill {
    /// The ink this fill requires.
    ///
    /// A SCREEN THAT OWNS THE FILL MUST READ THIS, NOT THE ENVIRONMENT.
    ///
    /// `DayPanel` publishes the same value through `\.v5PanelInk`, and that
    /// works for anything BELOW it in the view tree — `PanelStatPlate`,
    /// `PlaceHeaderV5`, any child struct placed inside the content closure.
    /// It does NOT work for the screen that renders the panel: `TodayBeforeV5`
    /// builds its header and lede inside its OWN body, which sits above
    /// `DayPanel` in the tree, so its `@Environment` resolves to the default
    /// white set no matter what the panel publishes underneath it.
    ///
    /// That is not a bug in the environment, it is what environment means —
    /// values travel down. A view cannot read what its own child sets. The
    /// screens compute the ink from the fill they already hold.
    var ink: V5.PanelInk {
        switch self {
        case .state(let s): return s.ink
        case .quiet:        return .onDarkRamp
        }
    }
}

enum PanelFill: Equatable, Hashable {
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

    /// Two-slot cross-dissolve for the background — see the `.onChange`
    /// below `body` for how they're driven. Nil means "not yet seeded";
    /// `slotA ?? fill` / `slotB ?? fill` is what's actually drawn, so a
    /// brand-new panel paints correctly before the first `.onChange` fires.
    @State private var slotA: PanelFill?
    @State private var slotB: PanelFill?
    /// Which slot is the visible one right now.
    @State private var showingA = true

    /// One gradient layer, at whatever `PanelFill` it's told to be.
    @ViewBuilder
    private func gradientLayer(_ f: PanelFill) -> some View {
        switch f {
        case .state(let s): V5Ramp.gradient(s)
        case .quiet:        V5.surface2
        }
    }

    /// The ink this panel's own fill requires, published to everything drawn
    /// inside it. A `.quiet` panel is surface-2, which is dark, so it keeps
    /// the white set.
    private var ink: V5.PanelInk {
        switch fill {
        case .state(let s): return s.ink
        case .quiet:        return .onDarkRamp
        }
    }

    /// The device's real inset, published by the shell. Falls back to the
    /// design's 44 in a preview or a detached screen.
    @Environment(\.v5TopInset) private var topInset

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s20) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // Uniform s20 on every side of the panel's own content — this used
        // to be s24 on the bottom alone, which was already inconsistent
        // WITH ITSELF before even reaching the screen below it: the panel's
        // own left/right margin was one number and its bottom was another,
        // for no documented reason. Fixed as part of the spacing audit
        // (David: "vertical spacing between things is still not even close
        // to being consistent").
        .padding(.horizontal, V5.S.s20)
        .padding(.bottom, V5.S.s20)
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
        .padding(.top, topInset)
        // Everything inside the panel takes the ramp's ink.
        //
        // NOT the status bar. Round three asks for its glyphs too, and they do
        // sit on our surface — the panel reaches behind the clock. But the
        // status bar style is a window-level property: `.preferredColorScheme`
        // here would flip the ENTIRE app to light, and every dark surface below
        // the panel with it. Doing it honestly needs the hosting controller to
        // publish a style, which is a shell change, not a panel one. Left as
        // white glyphs on the two light ramps and reported rather than faked —
        // the grain layer keeps them readable, and it is a far smaller failure
        // than the 1.94:1 lede this commit fixes.
        .environment(\.v5PanelInk, ink)
        .background(alignment: .top) {
            // ── THE CROSSFADE, DONE AS A GUARANTEED OPACITY DISSOLVE ──────
            //
            // David: "lets also animate the background color changing" —
            // and then, on the `.id(fill) + .transition(.opacity)` attempt:
            // "theres no animation between colors it just takes longer to
            // change now." Right: that technique depends on SwiftUI treating
            // an `.id()` change as a real remove-then-insert, which it does
            // reliably for a view behind a ViewBuilder `if`/`switch` or
            // inside a `ForEach` — NOT reliably for a single, always-present
            // view whose `.id()` just changed. What actually happened here
            // was the identity swap landing, unanimated, and the 200ms
            // being spent on something else nearby — a delayed cut, not a
            // fade, which is exactly "takes longer" with nothing visibly
            // interpolating.
            //
            // This is the technique that cannot fail that way: two ALWAYS-
            // PRESENT layers, each a plain, fully-formed gradient, and only
            // their OPACITY ever changes. Opacity is animatable for any
            // view, unconditionally — nothing here depends on SwiftUI
            // deciding a view was inserted or on `LinearGradient` knowing
            // how to interpolate its own stops. `showingA` flips which
            // layer is live; the OTHER slot is loaded with the new fill
            // first, UNANIMATED, then the flip itself is what animates.
            ZStack {
                gradientLayer(slotA ?? fill).opacity(showingA ? 1 : 0)
                gradientLayer(slotB ?? fill).opacity(showingA ? 0 : 1)
            }
            .onChange(of: fill, initial: true) { oldValue, newValue in
                guard slotA != nil || slotB != nil else {
                    // First appearance. Seed the visible slot directly —
                    // nothing to fade FROM yet, and no flip needed.
                    slotA = newValue
                    return
                }
                guard newValue != oldValue else { return }
                // Load the value into the layer that is currently INVISIBLE,
                // with no animation — it must be fully painted, at opacity
                // 0, before the flip starts, or the flip has nothing correct
                // to fade in TO.
                var t = Transaction()
                t.disablesAnimations = true
                withTransaction(t) {
                    if showingA { slotB = newValue } else { slotA = newValue }
                }
                withAnimation(V5.Motion.fill) { showingA.toggle() }
            }
            .v5Grain()
            // THE PANEL IS PAINT, NOT CONTENT.
            //
            // The grain layer is a tiled `Image`, and an Image is an
            // accessibility element whether or not anyone named it. Every v5
            // screen with a gradient panel therefore carried one unlabelled
            // element the size of the panel — VoiceOver announced a bare
            // "image" in the middle of Today, Races and all six state screens,
            // sitting between the stats plate and the first section below it.
            //
            // Everything the panel MEANS is already text on top of it. The
            // gradient and its grain say nothing a runner needs.
            //
            // Hidden INSIDE the background builder, not on the panel: applied
            // one line down it would take the panel's whole subtree with it
            // and silence the poster.
            .accessibilityHidden(true)
        }
        .clipShape(PanelShape(radius: V5.R.panel))
        .padding(.top, -topInset)
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

// MARK: - The hero content block (HEROPANEL-1, 2026-09-04)

/// The kicker/type/dose/stats block every day-state panel draws, extracted
/// from `TodayBeforeV5.panel` so it is the SAME view whether the day being
/// shown is the actual current day or a day the runner browsed to.
///
/// David, live, on seeing two different templates: "Every day should look
/// like this. The only thing that changes is the color, run, specific
/// info, etc." Before this, `TodayBeforeV5`/`TodayAfterV5` drew this block
/// themselves and `PlanSnapshotDayView` drew an unrelated, visually flatter
/// `ListGroup` stack for every OTHER day — the exact inconsistency he
/// named. Reads `\.v5PanelInk` from the environment, same as
/// `PanelStatPlate` below it — a caller only has to be inside the right
/// `DayPanel`, never pass the ink down by hand.
struct HeroDayPanelContentV5: View {
    let kicker: String?
    let type: String
    let dose: FaffValue?
    let stats: [PanelStat]

    @Environment(\.v5PanelInk) private var panelInk

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
            VStack(alignment: .leading, spacing: V5.S.s2) {
                if let kicker {
                    Text(kicker)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(panelInk.secondary)
                }
                Text(type)
                    .faffDisplayV5(TypeScaleV5.display56)
                    .foregroundStyle(panelInk.primary)
            }
            if let dose {
                FaffValueText(dose,
                              font: .faffText(28, weight: .semibold),
                              color: panelInk.primary, mark: panelInk.mark)
            }
            PanelStatPlate(stats: stats)
        }
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
    @Environment(\.v5PanelInk) private var panelInk
    let stats: [PanelStat]

    var body: some View {
        // A plate with nothing on it is not a plate. A rest day has no pace
        // band, no ceiling and no effort to state, and the empty translucent
        // block it used to leave behind read as a control the runner could
        // press. Nothing to say, nothing drawn.
        if !stats.isEmpty { plate }
    }

    private var plate: some View {
        // ── THE VALUES SHARE A BASELINE, NOT THE LABELS ──────────────────
        //
        // This was `.firstTextBaseline`, which aligns each column on its
        // LABEL. That is fine while every label is one line and wrong the
        // moment one is not: on Block, "This week's mileage" wraps to two
        // lines, so its column's label row grew and pushed "45 mi" 33pt below
        // "33%" and "15 mi". The three numbers the plate exists to show sat on
        // three different lines because one WORD was long.
        //
        // `.lastTextBaseline` pins the columns on their last line instead.
        // Every value is `.lineLimit(1)`, so the last baseline IS the value's
        // baseline and the numbers line up whatever the labels do. A wrapped
        // label now grows UPWARD, which is the direction with room in it.
        //
        // Deliberately not a `Grid`: that would align both rows, but it splits
        // each label from its value into separate row containers and would
        // cost the per-stat `.accessibilityElement(children: .combine)` below
        // — which is what makes VoiceOver read "Projected, estimated,
        // 3:16:45" instead of three labels followed by three numbers.
        HStack(alignment: .lastTextBaseline, spacing: V5.S.s16) {
            ForEach(stats) { s in
                VStack(alignment: .leading, spacing: V5.S.s6) {
                    Text(s.label)
                        .font(.faffText(TypeScaleV5.label12))
                        .foregroundStyle(panelInk.secondary)
                    FaffValueText(s.value,
                                  font: .faffText(17, weight: .semibold),
                                  color: s.ink ?? panelInk.primary,
                                  mark: panelInk.mark)
                        // A NUMBER MUST NOT SHATTER.
                        //
                        // The plate is three fixed columns across a 390pt
                        // phone — about 110pt each. At the first accessibility
                        // text size the Races poster's projected finish came
                        // out as "~3:16:4" on one line and "5" on the next.
                        // A finish time broken mid-figure is not a smaller
                        // problem than a truncated one; it is a wrong number
                        // that looks like a right one.
                        //
                        // So the value holds one line and shrinks to fit
                        // instead. At the default content size every value in
                        // the design already fits at full size, so this draws
                        // nothing differently for a runner who has not changed
                        // the setting — verified by pixel diff. Above it, the
                        // figure stays whole and still lands larger than the
                        // 17pt it started at.
                        //
                        // The plate cannot carry accessibility type at its
                        // designed width. This keeps it honest; making it
                        // actually large is a layout the design has to give.
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                // THREE LABELS, THEN THREE VALUES, THREE SWIPES APART.
                //
                // The plate is a row of columns, so VoiceOver read it in
                // layout order: "Goal", "Projected", "Gap", and only then
                // "Sub 3:30", "estimated 3:16:45", "+2:56". Which number
                // belonged to which word was left to the runner to count out.
                //
                // `.combine` keeps the children's own labels, so the amber
                // tilde's "estimated" survives into the pair and the stat
                // reads "Projected, estimated, 3:16:45".
                .accessibilityElement(children: .combine)
            }
        }
        .padding(.vertical, V5.S.s16)
        .padding(.horizontal, V5.S.tilePad)
        .background(panelInk.plate, in: RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
    }
}
