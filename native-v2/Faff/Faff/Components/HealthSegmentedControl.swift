//
//  HealthSegmentedControl.swift
//
//  5-way segmented control for the Health page pinned top region.
//  OVERVIEW · BODY · SLEEP · FORM · INSIGHTS · swaps the section
//  rendered in the scrolling panel below.
//
//  Per design_handoff_iphone_health_a:
//   - Container: rgba(0,0,0,.28) fill, 1px white-opacity border,
//     radius 13pt, padding 4pt, all 5 must fit (no horizontal scroll)
//   - Inactive button: white @ 60%, Inter 800 10.5pt, tracking 0.6
//   - Active button: white 95% fill, dark teal text #06302E
//
//  Created 2026-06-03 round 72.
//

import SwiftUI

enum HealthSection: String, CaseIterable, Identifiable {
    case overview, body, sleep, form, insights
    var id: String { rawValue }
    var label: String {
        switch self {
        case .overview: return "OVERVIEW"
        case .body:     return "BODY"
        case .sleep:    return "SLEEP"
        case .form:     return "FORM"
        case .insights: return "INSIGHTS"
        }
    }
}

struct HealthSegmentedControl: View {
    @Binding var selection: HealthSection
    /// Drop the dark pill container so a host (e.g. the shared header pill)
    /// supplies the chrome — the buttons then sit directly on the host's
    /// frosted surface, the way the week-strip day cells do.
    var chromeless: Bool = false

    var body: some View {
        HStack(spacing: 3) {
            ForEach(HealthSection.allCases) { section in
                Button {
                    withAnimation(.easeOut(duration: 0.18)) {
                        selection = section
                    }
                } label: {
                    Text(section.label)
                        .font(.body(12, weight: .extraBold))
                        .tracking(0.5)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                        .foregroundStyle(selection == section
                                         ? Color(hex: 0x06302E)
                                         : Color.white.opacity(0.66))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(
                            RoundedRectangle(cornerRadius: 11, style: .continuous)
                                .fill(selection == section
                                      ? Color.white.opacity(0.95)
                                      : Color.clear)
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(chromeless ? 0 : 4)
        .background {
            if !chromeless {
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .fill(Color.black.opacity(0.28))
                    .overlay(
                        RoundedRectangle(cornerRadius: 13, style: .continuous)
                            .stroke(Color.white.opacity(0.12), lineWidth: 1)
                    )
            }
        }
    }
}
