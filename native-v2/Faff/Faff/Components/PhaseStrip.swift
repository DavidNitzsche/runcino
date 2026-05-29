//
//  PhaseStrip.swift
//
//  iPhone mirror of web-v2/components/training/PhaseStrip.tsx.
//
//  Compact two-row band showing all phases with current ringed, plus a
//  stats row underneath (total weeks · BUILDING TO {race} / NN D LEFT).
//
//  Row 1: secondary info — "13 WEEKS · BUILDING TO {race}" on the left,
//         "{N}D LEFT" on the right (race color when <= 14 days).
//  Row 2: phase pills (BASE · BUILD · PEAK · TAPER · RACE) — every pill
//         is filled with its phase accent (matching the volume-arc bars
//         below). Current phase is ringed with a 2pt ink outline. Pill
//         widths are proportional to week count so the BASE → BUILD →
//         PEAK → TAPER → RACE color transitions line up with the bar
//         color changes in VolumeArc directly underneath.
//
//  Inset 24px left/right to match the volume-arc card's internal
//  padding — keeps phase boundaries pixel-aligned with the bar grid
//  below, so you can read the strip + arc as one coordinated widget.
//
//  Palette mirrors PHASE_FILL in PhaseStrip.tsx and PlanArc.tsx — same
//  RGBs (0.55 / 0.60 / 0.85 alpha respectively) so the iPhone reads
//  identically to the web.
//

import SwiftUI

/// One phase block input — what the strip needs to render a pill.
struct PhaseBlock: Identifiable {
    /// Canonical label · BASE / BUILD / PEAK / TAPER / RACE. Compared
    /// case-insensitively against `currentPhase` to decide the ringed
    /// pill.
    let label: String
    /// Inclusive 0-based week index range — startWeekIdx … endWeekIdx.
    /// Width of the pill is proportional to (end - start + 1).
    let startWeekIdx: Int
    let endWeekIdx: Int

    var id: String { "\(label)|\(startWeekIdx)-\(endWeekIdx)" }
    var weekCount: Int { max(1, endWeekIdx - startWeekIdx + 1) }
}

struct PhaseStrip: View {
    let blocks: [PhaseBlock]
    /// Index INTO `blocks` (NOT a week index) of the current block.
    /// Pass nil when there's no active phase (pre-plan / new user).
    let currentBlockIdx: Int?

    // Optional secondary row content — mirrors the web's row 1.
    var totalWeeks: Int? = nil
    var currentWeekIdx: Int? = nil
    var raceName: String? = nil
    var daysToRace: Int? = nil

    /// Canonical phase order — mirrors PHASE_ORDER in PhaseStrip.tsx.
    /// Used to render every phase even when one isn't in `blocks` (e.g.
    /// pre-plan placeholder UI). Each unknown phase renders as a dim
    /// placeholder pill.
    private static let phaseOrder: [String] = ["BASE", "BUILD", "PEAK", "TAPER", "RACE"]

    /// Mirrors PHASE_FILL in PhaseStrip.tsx — same rgba values.
    private static func fill(for label: String) -> Color {
        switch label.uppercased() {
        case "BASE":  return Color(red: 0.153, green: 0.706, blue: 0.878, opacity: 0.55) // #27B4E0
        case "BUILD": return Color(red: 0.953, green: 0.678, blue: 0.220, opacity: 0.55) // #F3AD38
        case "PEAK":  return Color(red: 0.988, green: 0.302, blue: 0.392, opacity: 0.55) // #FC4D64
        case "TAPER": return Color(red: 0.690, green: 0.518, blue: 1.000, opacity: 0.60) // #B084FF
        case "RACE":  return Color(red: 1.000, green: 0.533, blue: 0.278, opacity: 0.85) // #FF8847
        default:      return Theme.line2
        }
    }

    /// Ink color that reads cleanly on each accent — taper's purple
    /// needs the slight tint shift the web uses.
    private static func ink(for label: String) -> Color {
        if label.uppercased() == "TAPER" {
            return Color(red: 0.102, green: 0.059, blue: 0.200) // #1a0f33
        }
        return Color(red: 0.055, green: 0.063, blue: 0.078)     // #0e1014
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // ROW 1 — secondary info, inset 24px to match the volume-arc
            // card padding so the labels and phase pills sit over the
            // same horizontal extent as the bars below.
            secondaryRow
                .padding(.horizontal, 24)

            // ROW 2 — phase pills, width-proportional to phase week counts.
            // Inset 24px to match volume-arc card padding.
            pillRow
        }
    }

    // MARK: - Secondary row

    private var secondaryRow: some View {
        HStack(spacing: 0) {
            HStack(spacing: 6) {
                if let totalWeeks {
                    Text("\(totalWeeks) WEEKS")
                        .font(.body(11, weight: .bold))
                        .tracking(1.6)
                        .foregroundStyle(Theme.mute)
                }
                if let raceName {
                    if totalWeeks != nil {
                        Text("·")
                            .font(.body(11, weight: .bold))
                            .foregroundStyle(Theme.mute)
                    }
                    Text("BUILDING TO \(raceName.uppercased())")
                        .font(.body(11, weight: .bold))
                        .tracking(1.6)
                        .foregroundStyle(Theme.ink.opacity(0.75))
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if let daysToRace {
                Text("\(daysToRace)D LEFT")
                    .font(.body(11, weight: .bold))
                    .tracking(1.6)
                    .foregroundStyle(daysToRace <= 14 ? Theme.race : Theme.mute)
            }
        }
    }

    // MARK: - Pill row

    private var pillRow: some View {
        // Lookup by label so we can render the canonical 5-phase order
        // even when the plan only carries a subset (matches web behavior
        // of rendering placeholder dim pills for missing phases).
        let byLabel: [String: PhaseBlock] = Dictionary(
            uniqueKeysWithValues: blocks.map { ($0.label.uppercased(), $0) }
        )
        let segWeights: [CGFloat] = Self.phaseOrder.map { label in
            CGFloat(byLabel[label]?.weekCount ?? 1)
        }
        let totalWeight = max(1, segWeights.reduce(0, +))

        // Current label resolved off `currentBlockIdx` (which indexes
        // `blocks`, not the canonical phase order).
        let currentLabel: String? = {
            guard let idx = currentBlockIdx, blocks.indices.contains(idx) else { return nil }
            return blocks[idx].label.uppercased()
        }()
        // Canonical position of the current phase — used to dim past
        // phases (matches web's `isPast` calculation).
        let currentOrderIdx: Int? = currentLabel.flatMap { Self.phaseOrder.firstIndex(of: $0) }

        return GeometryReader { geo in
            // 4pt gaps between pills, 24pt inset on each side, matching
            // the web's `padding: '4px 24px'` on the pill container.
            let gaps = CGFloat(Self.phaseOrder.count - 1) * 4
            let usable = max(0, geo.size.width - 48 - gaps)
            HStack(spacing: 4) {
                ForEach(Array(Self.phaseOrder.enumerated()), id: \.offset) { idx, label in
                    let weight = segWeights[idx]
                    let width = usable * (weight / totalWeight)
                    let block = byLabel[label]
                    let isCurrent = (label == currentLabel)
                    let isPast: Bool = {
                        guard let cur = currentOrderIdx else { return false }
                        return idx < cur
                    }()
                    pill(
                        label: label,
                        block: block,
                        isCurrent: isCurrent,
                        isPast: isPast
                    )
                    .frame(width: max(32, width))
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 4)
            .background(Color.white.opacity(0.02))
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .frame(height: 56) // 46pt pill + 8pt vertical padding
    }

    @ViewBuilder
    private func pill(label: String, block: PhaseBlock?, isCurrent: Bool, isPast: Bool) -> some View {
        let fill = Self.fill(for: label)
        let ink = Self.ink(for: label)
        let weeks = block?.weekCount ?? 0
        // Show current's "week X / total" pip when we know both.
        let weekInPhase: Int? = {
            guard isCurrent, let block, let cur = currentWeekIdx else { return nil }
            return cur - block.startWeekIdx + 1
        }()

        ZStack {
            RoundedRectangle(cornerRadius: 7)
                .fill(fill)
                .opacity(isPast ? 0.45 : 1)
            if isCurrent {
                // 2pt ink outline inset 1pt — matches web's
                // `outline: 2px solid var(--ink); outlineOffset: -1px`.
                RoundedRectangle(cornerRadius: 7)
                    .stroke(Theme.ink, lineWidth: 2)
                    .padding(1)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(label)
                    .font(.label(12))
                    .tracking(1.4)
                    .foregroundStyle(ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
                Text(weeksLabel(weeks: weeks, weekInPhase: weekInPhase))
                    .font(.body(9, weight: .semibold))
                    .tracking(0.5)
                    .foregroundStyle(ink.opacity(0.78))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: 46)
    }

    private func weeksLabel(weeks: Int, weekInPhase: Int?) -> String {
        if weeks <= 0 { return "—" }
        if let wip = weekInPhase {
            return "\(weeks) WK · \(wip)/\(weeks)"
        }
        return "\(weeks) WK"
    }
}
