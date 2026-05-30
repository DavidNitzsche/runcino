//
//  FaffMesh.swift
//  The animated 5-blob mesh that paints every Faff surface.
//
//  Per locked design (canonical web palette + chat intent):
//   · 5 radial-gradient blobs over a deep base wash
//   · animated translate + scale on independent ease-in-out loops (19–28s)
//   · grain overlay 5% mix-blend overlay
//   · top + bottom scrim for legibility
//   · color stops transition smoothly when the palette changes (0.7s ease)
//
//  Text on warm meshes (TEMPO/INTERVALS/TARGETS/RACE) keeps #F6F7F8 ink.
//  Do NOT auto-invert.
//

import SwiftUI

struct FaffMeshView: View {
    let mesh: FaffMesh
    /// How long color stops take to lerp when `mesh` changes.
    var transition: Double = 0.7
    /// Per-blob blur radius. Larger = softer wash. Defaults to 36.
    var blobBlur: CGFloat = 36
    /// Add the noise grain overlay (5% mix). On by default.
    var grain: Bool = true
    /// Add the top + bottom legibility scrim. On by default.
    var scrim: Bool = true

    var body: some View {
        ZStack {
            mesh.base
                .animation(.easeInOut(duration: transition), value: mesh)
                .ignoresSafeArea()

            // Blob layer: 5 radial gradients animated through independent loops.
            BlobLayer(mesh: mesh, blur: blobBlur)
                .animation(.easeInOut(duration: transition), value: mesh)
                .ignoresSafeArea()

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
                        .init(color: Color.black.opacity(0.38), location: 1.00)
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

// MARK: - Blob layer (5 animated radial gradients)

private struct BlobLayer: View {
    let mesh: FaffMesh
    let blur: CGFloat

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Blob(color: mesh.c3,
                     size: CGSize(width: geo.size.width * 0.84, height: geo.size.height * 0.70),
                     position: CGPoint(x: -geo.size.width * 0.06, y: geo.size.height * 0.20),
                     anim: .init(period: 19, drift: CGSize(width: 0.12, height: 0.10)),
                     blur: blur)

                Blob(color: mesh.c2,
                     size: CGSize(width: geo.size.width * 0.78, height: geo.size.height * 0.66),
                     position: CGPoint(x: geo.size.width * 1.06, y: geo.size.height * 0.22),
                     anim: .init(period: 23, drift: CGSize(width: -0.10, height: 0.12), phase: 0.3),
                     blur: blur)

                Blob(color: mesh.c5,
                     size: CGSize(width: geo.size.width * 1.00, height: geo.size.height * 0.84),
                     position: CGPoint(x: geo.size.width * 0.56, y: geo.size.height * 0.58),
                     anim: .init(period: 27, drift: CGSize(width: 0.08, height: -0.10), phase: 0.5),
                     blur: blur)

                Blob(color: mesh.c4,
                     size: CGSize(width: geo.size.width * 0.84, height: geo.size.height * 0.74),
                     position: CGPoint(x: -geo.size.width * 0.10, y: geo.size.height * 1.12),
                     anim: .init(period: 21, drift: CGSize(width: 0.14, height: -0.08), phase: 0.15),
                     blur: blur)

                Blob(color: mesh.c1,
                     size: CGSize(width: geo.size.width * 0.86, height: geo.size.height * 0.76),
                     position: CGPoint(x: geo.size.width * 1.10, y: geo.size.height * 1.10),
                     anim: .init(period: 25, drift: CGSize(width: -0.12, height: -0.12), phase: 0.7),
                     blur: blur)
            }
            .compositingGroup()
            .blendMode(.normal)
        }
    }
}

private struct Blob: View {
    let color: Color
    let size: CGSize
    let position: CGPoint
    let anim: BlobAnim
    let blur: CGFloat

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0/30.0)) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate
            let phase = (t / anim.period + anim.phase).truncatingRemainder(dividingBy: 1)
            // Sin wave 0..1
            let s = (sin(phase * 2 * .pi) + 1) / 2

            let dx = anim.drift.width  * size.width  * (s - 0.5) * 2
            let dy = anim.drift.height * size.height * (s - 0.5) * 2
            let scale = 0.92 + s * 0.20
            let opacity = 0.78 + s * 0.22

            RadialGradient(
                gradient: Gradient(colors: [
                    color,
                    color.opacity(0.6),
                    color.opacity(0)
                ]),
                center: .center,
                startRadius: 0,
                endRadius: max(size.width, size.height) * 0.55
            )
            .frame(width: size.width, height: size.height)
            .scaleEffect(scale)
            .blur(radius: blur)
            .opacity(opacity)
            .position(x: position.x + dx, y: position.y + dy)
        }
    }
}

private struct BlobAnim {
    let period: Double         // seconds per cycle
    let drift: CGSize          // normalized drift relative to blob size
    var phase: Double = 0      // 0..1 offset
}

// MARK: - Grain overlay
//
// Deterministic high-frequency speckle. SVG-noise → SwiftUI: tile a small
// per-pixel-random image. Built once, drawn at native resolution, mixed at 5%.

private struct GrainOverlay: View {
    var body: some View {
        Canvas { ctx, size in
            let tile: CGFloat = 120
            var x: CGFloat = 0
            while x < size.width {
                var y: CGFloat = 0
                while y < size.height {
                    ctx.draw(Image(systemName: "circle.fill"), in: CGRect(x: x, y: y, width: 0.01, height: 0.01))
                    y += tile
                }
                x += tile
            }
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
