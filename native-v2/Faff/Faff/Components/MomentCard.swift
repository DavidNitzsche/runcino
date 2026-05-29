//
//  MomentCard.swift  (Phase 25b · iOS /races v3 mirror)
//
//  Single moment in the race-day timeline. SwiftUI port of MomentCard
//  inside web-v2/components/races/RaceDayTimeline.tsx.
//
//  Visual structure carried over from the web:
//    · 4pt accent strip on the left (tone color)
//    · Eyebrow (caps) + time marker (right-aligned)
//    · Display-recipe headline (Oswald 700)
//    · What-to-expect prose
//    · Coach voice line with 2pt accent rule on the left
//    · Optional action chip (live or disabled-with-note)
//    · NOW pill in the upper-right corner when this is the active moment
//
//  Authoring discipline (per CLAUDE.md):
//    · Theme tokens only — no inline hex (one rare exception: `#0E1014`
//      via `Color(hex:)` is the bg-page foreground for chip text on
//      filled chips, mirroring web's hard-coded `color: '#0e1014'`).
//    · No fabricated Uber link — disabled state lives in the model.
//

import SwiftUI

struct MomentCard: View {
    let moment: RaceMoment
    let isActive: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Eyebrow + time marker row
            HStack(alignment: .firstTextBaseline) {
                Text(moment.eyebrow.uppercased())
                    .font(.label(10))
                    .tracking(1.4)
                    .foregroundStyle(accent)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(moment.marker)
                    .font(.body(11, weight: .bold))
                    .foregroundStyle(Theme.mute)
                    .lineLimit(1)
            }

            // Headline — display recipe
            Text(moment.headline.uppercased())
                .displayRecipe(size: 22)
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)

            // What-to-expect line
            Text(moment.expect)
                .font(.body(12.5))
                .foregroundStyle(Theme.ink.opacity(0.78))
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)

            // Coach voice — italic, accent-ruled left edge
            Text(moment.coach)
                .font(.body(13))
                .italic()
                .foregroundStyle(Theme.ink)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.leading, 10)
                .overlay(alignment: .leading) {
                    Rectangle().fill(accent).frame(width: 2)
                }

            // Optional action chip
            if let action = moment.action {
                actionChip(action)
            }
        }
        .padding(16)
        .background(Theme.card2)
        .overlay(
            // Active state thickens the border to 1.5pt (mirrors the web
            // `1.5px solid ${accent}` swap on isActive).
            RoundedRectangle(cornerRadius: 10)
                .stroke(isActive ? accent : Theme.line, lineWidth: isActive ? 1.5 : 1)
        )
        .overlay(alignment: .leading) {
            // 4pt left accent strip · constant across active / inactive
            Rectangle().fill(accent).frame(width: 4)
        }
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(alignment: .topTrailing) {
            if isActive { nowPill }
        }
    }

    // MARK: - Subviews

    private var nowPill: some View {
        Text("NOW")
            .font(.label(9))
            .tracking(1.2)
            .foregroundStyle(Color(hex: 0x0E1014))
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(accent)
            .clipShape(Capsule())
            .padding(10)
    }

    @ViewBuilder
    private func actionChip(_ action: RaceMoment.Action) -> some View {
        if action.disabled {
            VStack(alignment: .leading, spacing: 4) {
                Text(action.label.uppercased())
                    .font(.label(10))
                    .tracking(1.2)
                    .foregroundStyle(Theme.mute)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color.white.opacity(0.04))
                    .overlay(
                        Capsule()
                            .strokeBorder(Theme.line, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    )
                    .clipShape(Capsule())
                if let note = action.disabledNote {
                    Text(note)
                        .font(.body(10.5))
                        .foregroundStyle(Theme.mute)
                        .lineSpacing(2)
                }
            }
            .padding(.top, 4)
        } else if let url = action.url {
            // Live action — Link drops out to the OS for non-http schemes
            // (uber://). SwiftUI Link handles both http(s) and custom
            // schemes transparently.
            Link(destination: url) {
                Text("→ \(action.label.uppercased())")
                    .font(.label(10))
                    .tracking(1.2)
                    .foregroundStyle(accent)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(accent.opacity(0.10))
                    .overlay(Capsule().stroke(accent.opacity(0.30), lineWidth: 1))
                    .clipShape(Capsule())
            }
            .padding(.top, 4)
        }
    }

    private var accent: Color {
        switch moment.tone {
        case .night: return Theme.Zone.z1   // slate-blue night arc (matches web #5B7CB8)
        case .race:  return Theme.race
        case .green: return Theme.green
        case .learn: return Theme.learn
        }
    }
}
