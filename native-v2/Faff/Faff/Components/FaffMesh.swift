//
//  FaffMesh.swift
//  The animated 5-blob mesh that paints every Faff surface.
//
//  Spec: Effort Mesh Background handoff (2026-05-31).
//   · 5 blurred radial blobs over a deep `base` wash, blur 46pt, opacity 0.92
//   · per-blob drift on independent ease-in-out loops (22 / 26 / 30 / 24 / 28 s)
//   · container "breathe" loop ~17s nudges blur + saturation + brightness
//   · grain overlay 5% mix-blend, top + bottom dark scrim for legibility
//   · 0.7s ease cross-fade when stops change (per-day re-theme)
//   · reduce-motion: freeze the loops, fall back to a static gradient of the
//     same stops (never a flat fill)
//
//  Per-blob color mapping (deep stops sit low/back, light stops sit high/front):
//    blob 1 → c1 · top-left, 22s
//    blob 2 → c2 · top-right, 26s
//    blob 3 → c5 · deep, large, mid, 30s
//    blob 4 → c4 · bottom-left, 24s
//    blob 5 → c3 · bottom-right, 28s
//
//  Text on warm meshes (TEMPO / INTERVALS / TARGETS / RACE) keeps #F6F7F8 ink.
//  Do NOT auto-invert. The top/bottom fade carries legibility.
//

import SwiftUI
import UIKit

struct FaffMeshView: View {
    let mesh: FaffMesh
    /// How long color stops take to lerp when `mesh` changes (per-day re-theme).
    var transition: Double = 0.7
    /// Per-blob blur radius. Spec calls for 46pt.
    var blobBlur: CGFloat = 46
    /// Add the noise grain overlay (5% mix). On by default.
    var grain: Bool = true
    /// Add the top + bottom legibility scrim. On by default.
    var scrim: Bool = true

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            mesh.base
                .animation(.easeInOut(duration: transition), value: mesh)
                .ignoresSafeArea()

            if reduceMotion {
                // Static gradient using the same stops · never a dead flat
                // fill. Mirrors the web `prefers-reduced-motion` fallback.
                LinearGradient(
                    stops: [
                        .init(color: mesh.c1, location: 0.00),
                        .init(color: mesh.c2, location: 0.24),
                        .init(color: mesh.c4, location: 0.64),
                        .init(color: mesh.base, location: 1.00),
                    ],
                    startPoint: UnitPoint(x: 0.20, y: 0.10),
                    endPoint:   UnitPoint(x: 0.85, y: 1.05)
                )
                .animation(.easeInOut(duration: transition), value: mesh)
                .ignoresSafeArea()
            } else {
                BlobLayer(mesh: mesh, blur: blobBlur)
                    .animation(.easeInOut(duration: transition), value: mesh)
                    .ignoresSafeArea()
            }

            if grain {
                GrainOverlay()
                    .opacity(0.05)
                    .blendMode(.overlay)
                    .allowsHitTesting(false)
                    .ignoresSafeArea()
            }

            if scrim {
                LinearGradient(
                    stops: [
                        .init(color: Color.black.opacity(0.32), location: 0.00),
                        .init(color: Color.black.opacity(0.00), location: 0.18),
                        .init(color: Color.black.opacity(0.00), location: 0.62),
                        .init(color: Color.black.opacity(0.38), location: 1.00),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .allowsHitTesting(false)
                .ignoresSafeArea()
            }
        }
    }
}

// MARK: - Blob layer (5 animated radial gradients + breathe)
//
// Layout (% of the geometry box) lifted verbatim from the spec table:
//
//   blob | left  | top   | width | height | loop | color
//   1    | -12%  | -14%  | 74%   | 74%    | 22s  | c1
//   2    | 34%   | -10%  | 70%   | 72%    | 26s  | c2
//   3    | 4%    | 18%   | 96%   | 88%    | 30s  | c5
//   4    | -16%  | 42%   | 78%   | 78%    | 24s  | c4
//   5    | 30%   | 40%   | 80%   | 80%    | 28s  | c3
//
// Each blob has a `from`→`to` translate + scale pair sin-interpolated
// on its own loop so the field never visibly repeats.

private struct BlobLayer: View {
    let mesh: FaffMesh
    let blur: CGFloat

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            ZStack {
                // Order: paint the deep large mid blob (b3) first so the
                // lighter top-layers sit visually on top.
                Blob(color: mesh.c5,
                     frame: blobFrame(left: 0.04,  top: 0.18, w: 0.96, h: 0.88, in: w, h: h),
                     loop: 30, drift: CGSize(width:  0.06, height: -0.07), scaleFrom: 1.00, scaleTo: 1.12, phase: 0.0,
                     blur: blur)
                Blob(color: mesh.c4,
                     frame: blobFrame(left: -0.16, top: 0.42, w: 0.78, h: 0.78, in: w, h: h),
                     loop: 24, drift: CGSize(width:  0.09, height: -0.06), scaleFrom: 1.05, scaleTo: 0.95, phase: 0.15,
                     blur: blur)
                Blob(color: mesh.c3,
                     frame: blobFrame(left: 0.30,  top: 0.40, w: 0.80, h: 0.80, in: w, h: h),
                     loop: 28, drift: CGSize(width: -0.08, height: -0.08), scaleFrom: 0.97, scaleTo: 1.12, phase: 0.55,
                     blur: blur)
                Blob(color: mesh.c2,
                     frame: blobFrame(left: 0.34,  top: -0.10, w: 0.70, h: 0.72, in: w, h: h),
                     loop: 26, drift: CGSize(width: -0.08, height:  0.09), scaleFrom: 1.04, scaleTo: 0.95, phase: 0.30,
                     blur: blur)
                Blob(color: mesh.c1,
                     frame: blobFrame(left: -0.12, top: -0.14, w: 0.74, h: 0.74, in: w, h: h),
                     loop: 22, drift: CGSize(width:  0.07, height:  0.06), scaleFrom: 1.00, scaleTo: 1.13, phase: 0.70,
                     blur: blur)
            }
            // Container "breathe" · ~17s, nudges saturation + brightness so
            // the whole field gently swells. Blur is held by per-blob `blur`
            // so the breathe stays cheap (no extra Metal pass).
            .modifier(BreatheFilter(period: 17))
            .compositingGroup()
        }
    }

    /// Translate a left/top/width/height spec into a SwiftUI `frame + position`
    /// shape · returns a CGRect in absolute points so the Blob can place itself
    /// centered. left/top are the spec's top-left corner percentages.
    private func blobFrame(left: CGFloat, top: CGFloat, w: CGFloat, h: CGFloat,
                           in width: CGFloat, h height: CGFloat) -> CGRect {
        let bw = w * width
        let bh = h * height
        // center = (left + width/2, top + height/2)
        let cx = (left + w / 2) * width
        let cy = (top  + h / 2) * height
        return CGRect(x: cx, y: cy, width: bw, height: bh)
    }
}

private struct Blob: View {
    let color: Color
    /// Spec-derived frame · origin is the BLOB CENTER, width/height are size.
    let frame: CGRect
    /// Loop period in seconds (22 / 24 / 26 / 28 / 30 per the spec table).
    let loop: Double
    /// Drift vector as fraction of the blob's own size · matches the spec's
    /// per-blob `transform: translate(X%, Y%)` keyframes.
    let drift: CGSize
    /// Scale endpoints · 1.0→1.13, 1.04→0.95 etc per the spec's d1..d5.
    let scaleFrom: CGFloat
    let scaleTo: CGFloat
    /// Phase offset 0..1 so the loops don't all crest together.
    let phase: Double
    let blur: CGFloat

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0/30.0)) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate
            let raw = ((t / loop) + phase).truncatingRemainder(dividingBy: 1)
            // Sin in [0, 1] eases like ease-in-out · pair with `alternate`
            // behavior by interpolating from `scaleFrom`→`scaleTo` over the
            // half cycle and back, matching the spec's alternating keyframes.
            let s = (sin(raw * 2 * .pi - .pi / 2) + 1) / 2          // 0→1→0 over the loop

            let dx = drift.width  * frame.size.width  * s
            let dy = drift.height * frame.size.height * s
            let scale = scaleFrom + (scaleTo - scaleFrom) * CGFloat(s)

            RadialGradient(
                gradient: Gradient(colors: [
                    color,
                    color.opacity(0.6),
                    color.opacity(0),
                ]),
                center: .center,
                startRadius: 0,
                endRadius: max(frame.size.width, frame.size.height) * 0.55
            )
            .frame(width: frame.size.width, height: frame.size.height)
            .scaleEffect(scale)
            .blur(radius: blur)
            .opacity(0.92)
            .position(x: frame.origin.x + dx, y: frame.origin.y + dy)
        }
    }
}

// MARK: - Breathe (saturation + brightness swell on the container)
//
// Spec: ~17s ease-in-out loop, blur+saturation+brightness all nudge up at
// the apex. We hold blur via per-blob `.blur(radius:)` (cheaper) and apply
// saturation + brightness here on the compositing group.

private struct BreatheFilter: ViewModifier {
    let period: Double

    func body(content: Content) -> some View {
        TimelineView(.animation(minimumInterval: 1.0/12.0)) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate
            let raw = (t / period).truncatingRemainder(dividingBy: 1)
            let s = (sin(raw * 2 * .pi - .pi / 2) + 1) / 2          // 0→1→0
            // 1.0 → 1.14 saturation, 1.0 → 1.06 brightness at apex.
            let sat = 1.0 + 0.14 * s
            let bri = 0.0 + 0.06 * s
            content
                .saturation(sat)
                .brightness(bri)
        }
    }
}

// MARK: - Grain overlay
//
// Deterministic high-frequency speckle. SVG-noise → SwiftUI: tile a small
// per-pixel-random image. Built once, drawn at native resolution, mixed at 5%.

private struct GrainOverlay: View {
    var body: some View {
        Canvas { ctx, size in
            // Pseudo-random speckle (deterministic seed so it doesn't shimmer).
            var seed: UInt64 = 0xFA77F00D
            let count = Int(size.width * size.height / 90)
            for _ in 0..<count {
                seed = seed &* 6364136223846793005 &+ 1442695040888963407
                let nx = CGFloat(seed >> 32 & 0xFFFFFF) / CGFloat(0xFFFFFF) * size.width
                seed = seed &* 6364136223846793005 &+ 1442695040888963407
                let ny = CGFloat(seed >> 32 & 0xFFFFFF) / CGFloat(0xFFFFFF) * size.height
                seed = seed &* 6364136223846793005 &+ 1442695040888963407
                let alpha = Double(seed >> 32 & 0xFF) / 255.0
                let r = CGRect(x: nx, y: ny, width: 1, height: 1)
                ctx.fill(Path(r), with: .color(Color.white.opacity(alpha * 0.5)))
            }
        }
        .allowsHitTesting(false)
    }
}
