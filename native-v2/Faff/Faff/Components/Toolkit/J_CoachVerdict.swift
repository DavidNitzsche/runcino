//
//  J_CoachVerdict.swift
//  Family J · Coach verdict & narration.
//
//  Components: CitationChip · HeatBandChip.
//
//  RunPurposeCard + RunRecapCard already live in TodayView /
//  RunDetailView · this file holds the shared atoms that family uses.
//

import SwiftUI

// MARK: - CitationChip
//
// Atom · the deep-link into the Learn reader. Build once, reuse wherever
// the coach cites doctrine.

struct CitationChip: View {
    let label: String
    let slug: String

    var body: some View {
        NavigationLink(value: FaffRoute.learn(slug: slug)) {
            HStack(spacing: 4) {
                Text(label)
                    .font(.body(11, weight: .extraBold)).tracking(0.4)
                    .foregroundStyle(Theme.txt)
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Theme.mute)
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Theme.Glass.fill, in: Capsule())
            .overlay(Capsule().stroke(Theme.Glass.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

struct CitationRow: View {
    let citations: [(label: String, slug: String)]

    var body: some View {
        if citations.isEmpty { EmptyView() }
        else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Array(citations.enumerated()), id: \.offset) { _, c in
                        CitationChip(label: c.label, slug: c.slug)
                    }
                }
            }
        }
    }
}

// MARK: - HeatBandChip
//
// One field, four colors. Tints the conditions tag on a ramp:
//   neutral (grey) · warm (amber) · hot (orange) · extreme (red).

enum HeatBand: String {
    case neutral, warm, hot, extreme, unknown

    static func from(_ raw: String?) -> HeatBand {
        switch (raw ?? "").lowercased() {
        case "neutral": return .neutral
        case "warm":    return .warm
        case "hot":     return .hot
        case "extreme": return .extreme
        default:        return .unknown
        }
    }
    var label: String { rawValue.capitalized }
    var color: Color {
        switch self {
        case .neutral: return Theme.mute
        case .warm:    return Theme.goal
        case .hot:     return Theme.race
        case .extreme: return Theme.over
        case .unknown: return Theme.mute
        }
    }
    /// Derive a heat band from a temperature when the backend doesn't
    /// emit one. Maughan-ish breakpoints: 60/75/85°F.
    static func from(tempF: Double?) -> HeatBand {
        guard let t = tempF else { return .unknown }
        if t < 60 { return .neutral }
        if t < 75 { return .warm }
        if t < 85 { return .hot }
        return .extreme
    }
}

struct HeatBandChip: View {
    let band: HeatBand
    let tempLabel: String?    // "74°F"

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: bandIcon)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(band.color)
            Text(textLabel)
                .font(.body(11.5, weight: .extraBold)).tracking(0.4)
                .foregroundStyle(band == .neutral ? Theme.txt : band.color)
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(band == .neutral ? Theme.Glass.fill : band.color.opacity(0.14), in: Capsule())
        .overlay(Capsule().stroke(band.color.opacity(0.40), lineWidth: 1))
    }

    private var bandIcon: String {
        switch band {
        case .neutral: return "sun.max"
        case .warm:    return "sun.max"
        case .hot:     return "sun.max.fill"
        case .extreme: return "thermometer.sun.fill"
        case .unknown: return "sun.max"
        }
    }
    private var textLabel: String {
        let t = tempLabel.map { " · \($0)" } ?? ""
        return band == .unknown ? "Conditions" : "\(band.label)\(t)"
    }
}

