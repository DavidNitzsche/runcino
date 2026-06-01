//
//  J_CoachVerdict.swift
//  Family J · Coach verdict & narration.
//
//  Components: CitationChip · HeatBandChip · PostRunCheckinChips.
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

// MARK: - PostRunCheckinChips
//
// Two chip groups (execution + body) feed POST /api/checkin · backend
// returns a canned `coach_reply` string. Lift the legacy pattern into the
// new post-run flow.

struct PostRunCheckinChips: View {
    let runId: String
    @State private var execution: String? = nil
    @State private var bodyTags: Set<String> = []
    @State private var coachReply: String? = nil
    @State private var submitting: Bool = false
    var onCoachReply: (String) -> Void = { _ in }

    private let executions = ["Nailed it", "Solid", "Survived", "Rough"]
    private let bodyOptions = ["Fresh", "Legs heavy", "Niggle", "All good"]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            section("How did it go?", options: executions, single: true,
                    selected: { $0 == execution },
                    toggle: { o in
                        execution = (execution == o) ? nil : o
                        if execution != nil { Task { await fire() } }
                    })
            section("How's the body?", options: bodyOptions, single: false,
                    selected: { bodyTags.contains($0) },
                    toggle: { o in
                        if bodyTags.contains(o) { bodyTags.remove(o) } else { bodyTags.insert(o) }
                        if execution != nil { Task { await fire() } }
                    })
            if let reply = coachReply, !reply.isEmpty {
                replyRow(reply)
            }
        }
        .padding(14)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }

    private func section(_ q: String,
                         options: [String],
                         single: Bool,
                         selected: @escaping (String) -> Bool,
                         toggle: @escaping (String) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(q)
                .font(.body(11, weight: .extraBold)).tracking(0.6)
                .foregroundStyle(Theme.mute)
            FlowChips(items: options,
                      isSelected: selected,
                      onTap: toggle)
        }
    }

    private func replyRow(_ reply: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("F")
                .font(.body(11, weight: .extraBold))
                .foregroundStyle(Theme.bg)
                .frame(width: 24, height: 24)
                .background(Theme.Accent.amberBright, in: Circle())
            Text(reply)
                .font(.body(12.5, weight: .medium))
                .foregroundStyle(Theme.txt)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private func fire() async {
        guard let ex = execution else { return }
        submitting = true
        if let reply = try? await API.postCheckin(activityId: runId,
                                                  execution: ex.lowercased().replacingOccurrences(of: " ", with: "_"),
                                                  body: Array(bodyTags)) {
            await MainActor.run {
                coachReply = reply
                onCoachReply(reply)
                submitting = false
            }
        } else {
            await MainActor.run { submitting = false }
        }
    }
}

/// Tiny flowing chip strip. Wraps on overflow. Used by PostRunCheckinChips.
struct FlowChips: View {
    let items: [String]
    let isSelected: (String) -> Bool
    let onTap: (String) -> Void

    var body: some View {
        // Compact horizontal scroll instead of a true flow layout · keeps
        // the implementation small and matches the chip-strip pattern used
        // elsewhere in the app.
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(items, id: \.self) { o in
                    Button { onTap(o) } label: {
                        Text(o)
                            .font(.body(12, weight: .semibold))
                            .foregroundStyle(isSelected(o) ? Theme.bg : Theme.txt)
                            .padding(.horizontal, 11).padding(.vertical, 7)
                            .background(
                                Capsule().fill(isSelected(o) ? Theme.txt : Theme.Glass.fill)
                            )
                            .overlay(
                                Capsule().stroke(isSelected(o) ? Theme.txt : Theme.Glass.line, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 1)
        }
    }
}
