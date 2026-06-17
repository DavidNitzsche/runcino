//
//  K_TargetsProjectionDepth.swift
//  Family K · Targets PROJECTION DEPTH · supporting section (race P3).
//
//  Sits BELOW the clean Pace Projection hero card (K_TargetsProjection) on
//  TargetsView. Surfaces the one decode-but-never-shown piece that is NEW
//  information, not a repeat of the card:
//
//    AT OTHER DISTANCES · raceProjections[] · equivalent 5K / 10K / Half /
//                         Marathon times at current fitness.
//
//  David 2026-06-17 cut LIKELY RANGE, SAFE TARGET, and WHAT'S THE GAP MADE OF:
//  they overlapped the hero card's own goal / projection and floated below it
//  without a home ("randomly here ... I don't think it's needed"). The card
//  carries the goal-relative story; this section only adds the equivalent
//  efforts at other distances.
//
//  Doctrine: display-only, coach voice (no hype / emoji / em dash), Theme
//  tokens. Renders only when the data is present. Values are REAL from
//  ProjectionSummary; no client-side race-time math.
//

import SwiftUI

// MARK: - Public · supporting depth block

struct TargetsProjectionDepth: View {
    let summary: ProjectionSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            if hasRaceProjections { otherDistancesSection }
        }
    }

    // ── AT OTHER DISTANCES ────────────────────────────────────────────────

    private var hasRaceProjections: Bool {
        !(summary.raceProjections ?? []).isEmpty
    }

    private var otherDistancesSection: some View {
        let rows = summary.raceProjections ?? []
        return depthSection("AT OTHER DISTANCES", caption: "Equivalent efforts at today's fitness") {
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { idx, entry in
                    if idx > 0 {
                        Rectangle()
                            .fill(Color.white.opacity(0.06))
                            .frame(height: 1)
                    }
                    HStack {
                        Text(entry.distance.uppercased())
                            .font(.body(12, weight: .extraBold))
                            .tracking(0.8)
                            .foregroundStyle(Theme.txt.opacity(0.7))
                        Spacer()
                        Text(entry.time)
                            .font(.display(18, weight: .semibold))
                            .tracking(-0.5)
                            .foregroundStyle(Theme.txt)
                            .monospacedDigit()
                    }
                    .padding(.vertical, 11)
                }
            }
            .depthTile()
        }
    }

    // ── Shared section chrome (matches TargetsView styling) ───────────────

    @ViewBuilder
    private func depthSection<C: View>(
        _ title: String,
        caption: String? = nil,
        @ViewBuilder content: () -> C
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                SpecLabel(text: title, size: 11, tracking: 2, color: Theme.txt.opacity(0.6))
                if let caption {
                    Text(caption)
                        .font(.body(11))
                        .foregroundStyle(Theme.txt.opacity(0.4))
                }
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Tile chrome (matches the hero card's surface language)

private extension View {
    /// Tile body matching the projection card · 0x11141A fill, white-opacity
    /// hairline, 18 radius (a notch tighter than the hero's 22 so the
    /// supporting tile reads as secondary).
    func depthTile() -> some View {
        self
            .padding(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
            .background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
            )
    }
}
