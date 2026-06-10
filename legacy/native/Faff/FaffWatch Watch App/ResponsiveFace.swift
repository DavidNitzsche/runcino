//
//  ResponsiveFace.swift
//  FaffWatch
//
//  The ONE responsiveness rule for every watch face.
//
//  Apple Watch sizes (40mm → Ultra) all share ~the same 0.82 aspect ratio, so
//  instead of per-device font tweaks (which turned into whack-a-mole) we author
//  each face once for the Ultra's point bounds and uniformly scale that canvas
//  to whatever watch we're on:
//
//    · Ultra 49mm  → scale 1.0  → pixel-identical to the approved design
//    · 45 / 44mm   → ~0.95
//    · 41mm        → ~0.86
//    · 40mm        → ~0.79  → same layout + proportions, just smaller
//
//  Because the scale is uniform, the hero, the detail type, AND the Start button
//  shrink together — the proportions you approved are preserved on every screen,
//  and nothing ever clips or overflows.
//

import SwiftUI

struct ResponsiveFace<Content: View>: View {
    @ViewBuilder var content: () -> Content

    /// Reference canvas = Apple Watch Ultra (49mm) logical points. Faces are
    /// authored to look right at this size; everything else scales off it.
    static var refSize: CGSize { CGSize(width: 205, height: 251) }

    var body: some View {
        GeometryReader { geo in
            // Same factor for width and height (aspect ratios match across watches),
            // so we take the limiting dimension and never distort.
            let s = min(geo.size.width / Self.refSize.width,
                        geo.size.height / Self.refSize.height)
            content()
                .frame(width: Self.refSize.width, height: Self.refSize.height)
                .scaleEffect(s, anchor: .center)
                .frame(width: geo.size.width, height: geo.size.height)
        }
        .ignoresSafeArea()
        .background(Color.black.ignoresSafeArea())
    }
}
