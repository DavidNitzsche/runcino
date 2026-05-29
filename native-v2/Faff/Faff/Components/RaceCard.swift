//
//  RaceCard.swift  (Phase 25b · iOS /races v3 mirror)
//
//  Single race row for the iPhone /races list. Mirrors the web hero +
//  secondary patterns in web-v2/app/races/page.tsx:
//    · ARaceHero / SecondaryARace · A-races, race-orange left strip
//    · BCRaceCard                   · B (gold) / C (purple) compact
//    · PastRaceCard                 · past races, optional PB chip
//
//  iPhone rolls those four web patterns into ONE row component with a
//  `style` axis so the call site can request the variant it wants. This
//  keeps the list legible at iPhone widths (no two-column grid for B/C,
//  no three-column grid for past — the screen is too narrow). The visual
//  cues that distinguish A / B / C / past on the web (left strip color,
//  countdown tint, PB highlight) all carry over.
//
//  Composition pattern matches WeekStripV3 + WeekAheadGrid — pure View
//  driven by a small payload struct, no async work, no Adapter calls
//  beyond the priority-color helper that already lives there.
//

import SwiftUI

struct RaceCard: View {
    let race: RaceListItem
    /// Visual emphasis tier:
    ///   .hero      · the next A-race (or single A) — larger countdown
    ///   .secondary · additional A-races below the hero
    ///   .compact   · B / C races — single line with chip + days
    ///   .past      · finished races — muted countdown, no orange strip
    let style: Style
    /// Tap handler — RacesView wires this to `selected = race` to drive
    /// the detail sheet. Pulled out of the body so callers control the
    /// presentation (sheet vs nav vs whatever lands next).
    let onTap: () -> Void

    enum Style {
        case hero, secondary, compact, past
    }

    var body: some View {
        Button(action: onTap) { content }
            .buttonStyle(.plain)
            .contentShape(Rectangle())
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        switch style {
        case .hero:      heroRow
        case .secondary: secondaryRow
        case .compact:   compactRow
        case .past:      pastRow
        }
    }

    // MARK: - Hero (next A-race · large)

    private var heroRow: some View {
        let color = FaffAdapter.racePriorityColor(priority: race.priority)
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 10) {
                    priorityChip(
                        label: "A · GOAL RACE",
                        color: color,
                        filled: true
                    )
                    Text(race.name ?? race.slug)
                        .font(.display(34))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    metaLine
                }
                Spacer(minLength: 8)
                if let days = race.days_to_race {
                    countdownBlock(days: days, color: color, big: true)
                }
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 24)
        .background(Theme.card)
        .overlay(alignment: .leading) {
            // Race-orange left strip mirrors `borderLeft: '3px solid var(--race)'`
            // on the web ARaceHero. Kept at the same 3pt visual weight.
            Rectangle()
                .fill(color)
                .frame(width: 3)
        }
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
    }

    // MARK: - Secondary A-race

    private var secondaryRow: some View {
        let color = FaffAdapter.racePriorityColor(priority: race.priority)
        return HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 8) {
                priorityChip(label: "A", color: color, filled: true, compact: true)
                Text(race.name ?? race.slug)
                    .font(.display(22))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                metaLine
            }
            Spacer(minLength: 8)
            if let days = race.days_to_race {
                countdownBlock(days: days, color: color, big: false)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .background(Theme.card)
        .overlay(alignment: .leading) {
            Rectangle().fill(color).frame(width: 3)
        }
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
    }

    // MARK: - Compact (B / C)

    private var compactRow: some View {
        let color = FaffAdapter.racePriorityColor(priority: race.priority)
        let p = (race.priority ?? "").uppercased()
        return HStack(alignment: .center, spacing: 12) {
            if !p.isEmpty {
                priorityChip(label: p, color: color, filled: false)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(race.name ?? race.slug)
                    .font(.display(18))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                metaLine
            }
            Spacer(minLength: 8)
            if let days = race.days_to_race {
                Text("\(days)d")
                    .font(.display(20))
                    .foregroundStyle(color)
            }
        }
        .padding(14)
        .background(Theme.card)
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
    }

    // MARK: - Past

    private var pastRow: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(race.name ?? race.slug)
                    .font(.body(14, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                metaLine
            }
            Spacer(minLength: 8)
            if let days = race.days_to_race {
                Text("\(-days)d ago")
                    .font(.body(11, weight: .semibold))
                    .foregroundStyle(Theme.mute)
            }
        }
        .padding(14)
        .background(Color.white.opacity(0.02))
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
    }

    // MARK: - Subviews

    private var metaLine: some View {
        // Inline distance / location / date — mirrors the web meta line on
        // every card variant. `· ·` separators stripped when a piece is nil.
        let parts: [String?] = [
            race.distance_label?.uppercased(),
            race.location?.uppercased(),
            race.date.flatMap(Self.formatShortDate),
        ]
        let kept = parts.compactMap { $0 }
        return Text(kept.joined(separator: " · "))
            .font(.body(11, weight: .medium))
            .foregroundStyle(Theme.mute)
            .lineLimit(1)
    }

    private func priorityChip(
        label: String,
        color: Color,
        filled: Bool,
        compact: Bool = false
    ) -> some View {
        Text(label)
            .font(.label(compact ? 10 : 11))
            .tracking(1.2)
            .foregroundStyle(filled ? Color(hex: 0x0E1014) : color)
            .padding(.horizontal, compact ? 7 : 9)
            .padding(.vertical, compact ? 3 : 4)
            .background(filled ? color : color.opacity(0.18))
            .clipShape(RoundedRectangle(cornerRadius: 4))
    }

    private func countdownBlock(days: Int, color: Color, big: Bool) -> some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text("\(days)")
                .font(.display(big ? 64 : 40))
                .foregroundStyle(color)
                .lineLimit(1)
            Text("DAYS")
                .font(.label(big ? 11 : 10))
                .tracking(1.4)
                .foregroundStyle(Theme.mute)
        }
    }

    // MARK: - Date helper

    /// "MAY 28" — same shape as the web /races page formatDate().
    static func formatShortDate(_ iso: String) -> String? {
        let parts = iso.split(separator: "-")
        guard parts.count >= 3, let m = Int(parts[1]), let d = Int(parts[2]) else { return nil }
        let months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]
        guard m >= 1 && m <= 12 else { return nil }
        return "\(months[m - 1]) \(d)"
    }
}
