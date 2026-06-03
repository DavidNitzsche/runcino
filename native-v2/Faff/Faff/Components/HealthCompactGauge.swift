//
//  HealthCompactGauge.swift
//
//  128×128 compact readiness gauge for the Health page's pinned top
//  region. Per design_handoff_iphone_health_a · A · Pinned Glance.
//
//  Renders an SVG-style arc ring (270° sweep, rotated -90° so the start
//  is at the top, rounded cap) over a faint track. Center shows ONLY
//  the score number in Oswald 600 48pt · the band label was removed
//  from inside the ring per the design (lives next to the verdict
//  copy instead, which the parent owns).
//
//  Created 2026-06-03 round 72.
//

import SwiftUI

struct HealthCompactGauge: View {
    /// Readiness score 0-100. Defaults to 0 when nil (cold start).
    let score: Int?
    /// Band string from backend ("ready" / "moderate" / "pullback" /
    /// "sharp" / "nodata"). Drives the arc + glow color.
    let band: String?

    /// Maps band string → progress arc color. Mirrors the BAND map in
    /// health-lib.js. Falls back to muted grey when band is empty or
    /// unrecognized.
    private var bandColor: Color {
        switch (band ?? "").lowercased() {
        case "sharp":     return Color(hex: 0x34D058)
        case "ready":     return Color(hex: 0x3EBD41)
        case "moderate":  return Color(hex: 0xF3AD38)
        case "pullback":  return Color(hex: 0xFC4D64)
        case "nodata":    return Color(hex: 0x8A90A0)
        default:          return Color(hex: 0x8A90A0)
        }
    }

    private var displayScore: Int { max(0, min(100, score ?? 0)) }

    var body: some View {
        ZStack {
            // Track (full ring, dim white)
            Circle()
                .stroke(Color.white.opacity(0.14), lineWidth: 14)
            // Progress arc
            Circle()
                .trim(from: 0, to: CGFloat(displayScore) / 100)
                .stroke(
                    bandColor,
                    style: StrokeStyle(lineWidth: 14, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .shadow(color: bandColor.opacity(0.55), radius: 7)
            // Center score · Oswald bold, scaled tighter so 3-digit
            // edge cases (99/100) don't crowd the ring.
            Text("\(displayScore)")
                .font(.display(52, weight: .bold))
                .tracking(-0.5)
                .foregroundStyle(Color.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(width: 128, height: 128)
    }
}
