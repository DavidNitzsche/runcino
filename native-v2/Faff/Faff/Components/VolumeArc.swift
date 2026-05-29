//
//  VolumeArc.swift
//
//  iPhone mirror of web-v2/components/training/PlanArc.tsx.
//
//  Volume curve from week 1 → race day, phase-colored. Each bar
//  represents one week's planned mileage. Heights are normalized
//  against the max planned week (= 100% height). Current week bar gets
//  a 2pt ink outline + mileage tag above. A small W-index strip sits
//  underneath; a 5-swatch legend sits at the bottom.
//
//  Palette is shared with PhaseStrip — same RGBs so the pills above
//  and the bars below read as one continuous color story.
//    BASE  = #27B4E0 cyan-blue   (0.55 alpha)
//    BUILD = #F3AD38 amber       (0.55 alpha)
//    PEAK  = #FC4D64 red         (0.55 alpha)
//    TAPER = #B084FF purple      (0.60 alpha)
//    RACE  = #FF8847 orange      (0.85 alpha)
//
//  Unlike the previous inline implementation in TrainingView (which
//  used a horizontal ScrollView to display 16+ weeks), this matches
//  the web's compressed equal-width grid: every week fits in a single
//  card, scaling bar widths down rather than scrolling. The web ships
//  ~13 weeks fitted to the viewport; on iPhone we cap at 18 before
//  the bars get unreadably thin (still scrollable for >18 if needed).
//

import SwiftUI

/// One bar in the volume arc. Mirrors `PlanWeek` fields actually used
/// by PlanArc.tsx — idx, plannedMi, phase, isCurrent.
struct VolumeBar: Identifiable {
    let weekIdx: Int
    let plannedMi: Double
    /// Phase label (BASE / BUILD / PEAK / TAPER / RACE). Drives bar fill.
    let phase: String
    let isCurrent: Bool

    var id: Int { weekIdx }
}

struct VolumeArc: View {
    let bars: [VolumeBar]
    /// Optional race-name footer chip. Mirrors `raceName` on PlanArc.
    var raceName: String? = nil
    var raceDate: String? = nil
    var raceGoal: String? = nil

    /// Mirrors PHASE_FILL in PlanArc.tsx — same rgba values.
    private static func fill(for phase: String) -> Color {
        switch phase.uppercased() {
        case "BASE":            return Color(red: 0.153, green: 0.706, blue: 0.878, opacity: 0.55) // #27B4E0
        case "BUILD",
             "RACE-SPECIFIC":   return Color(red: 0.953, green: 0.678, blue: 0.220, opacity: 0.55) // #F3AD38
        case "PEAK":            return Color(red: 0.988, green: 0.302, blue: 0.392, opacity: 0.55) // #FC4D64
        case "TAPER":           return Color(red: 0.690, green: 0.518, blue: 1.000, opacity: 0.60) // #B084FF
        case "RACE":            return Color(red: 1.000, green: 0.533, blue: 0.278, opacity: 0.85) // #FF8847
        default:                return Theme.line2
        }
    }

    private var maxMi: Double {
        max(1, bars.map(\.plannedMi).max() ?? 1)
    }

    var body: some View {
        if bars.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 0) {
                header
                    .padding(.bottom, 16)
                barGrid
                    .frame(height: 90) // 80 web + 10 for the mileage tag above current
                weekIndexRow
                    .padding(.top, 6)
                legend
                    .padding(.top, 14)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 22)
            .background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16).stroke(Theme.line, lineWidth: 1)
            )
            .padding(.horizontal, 24)
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("VOLUME ARC · NOW → RACE DAY")
                .font(.display(22))
                .tracking(0.5)
                .foregroundStyle(Theme.ink)
                .lineLimit(2)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 8)
            if let raceName {
                Text(raceFooter(name: raceName, date: raceDate, goal: raceGoal))
                    .font(.body(11, weight: .bold))
                    .tracking(1.2)
                    .foregroundStyle(Theme.race)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
    }

    private func raceFooter(name: String, date: String?, goal: String?) -> String {
        var parts: [String] = [name.uppercased()]
        if let date { parts.append(date.uppercased()) }
        if let goal { parts.append("GOAL \(goal.uppercased())") }
        return parts.joined(separator: " · ")
    }

    // MARK: - Bar grid

    private var barGrid: some View {
        GeometryReader { geo in
            let count = max(1, bars.count)
            let gap: CGFloat = 4
            let totalGaps = CGFloat(count - 1) * gap
            let barW = max(4, (geo.size.width - totalGaps) / CGFloat(count))
            HStack(alignment: .bottom, spacing: gap) {
                ForEach(bars) { b in
                    bar(b, maxH: geo.size.height)
                        .frame(width: barW)
                }
            }
        }
    }

    @ViewBuilder
    private func bar(_ b: VolumeBar, maxH: CGFloat) -> some View {
        let pct = max(0.04, b.plannedMi / maxMi)
        let h = pct * (maxH - 12) // leave 12pt up top for the mileage tag
        VStack(spacing: 0) {
            // Mileage tag above current bar only — mirrors PlanArc.tsx.
            if b.isCurrent {
                Text(formatMi(b.plannedMi))
                    .font(.body(9))
                    .foregroundStyle(Theme.mute)
                    .padding(.bottom, 3)
            } else {
                Spacer(minLength: 0)
            }
            ZStack {
                UnevenRoundedRectangle(
                    topLeadingRadius: 4,
                    bottomLeadingRadius: 0,
                    bottomTrailingRadius: 0,
                    topTrailingRadius: 4,
                    style: .continuous
                )
                .fill(Self.fill(for: b.phase))
                if b.isCurrent {
                    UnevenRoundedRectangle(
                        topLeadingRadius: 4,
                        bottomLeadingRadius: 0,
                        bottomTrailingRadius: 0,
                        topTrailingRadius: 4,
                        style: .continuous
                    )
                    .stroke(Theme.ink, lineWidth: 2)
                    .padding(1)
                }
            }
            .frame(height: max(4, h))
        }
        .frame(maxHeight: .infinity, alignment: .bottom)
    }

    // MARK: - Week index row

    private var weekIndexRow: some View {
        GeometryReader { geo in
            let count = max(1, bars.count)
            let gap: CGFloat = 4
            let totalGaps = CGFloat(count - 1) * gap
            let colW = max(4, (geo.size.width - totalGaps) / CGFloat(count))
            HStack(spacing: gap) {
                ForEach(bars) { b in
                    Text("W\(b.weekIdx)")
                        .font(.body(9))
                        .tracking(0.5)
                        .foregroundStyle(b.isCurrent ? Theme.ink : Theme.dim)
                        .frame(width: colW)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                }
            }
        }
        .frame(height: 14)
    }

    // MARK: - Legend

    private var legend: some View {
        HStack(spacing: 18) {
            ForEach(["BASE", "BUILD", "PEAK", "TAPER", "RACE"], id: \.self) { p in
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Self.fill(for: p))
                        .frame(width: 10, height: 10)
                    Text(p)
                        .font(.body(10, weight: .bold))
                        .tracking(1.2)
                        .foregroundStyle(Theme.mute)
                }
            }
        }
    }

    private func formatMi(_ mi: Double) -> String {
        if mi.truncatingRemainder(dividingBy: 1) == 0 {
            return String(Int(mi))
        }
        return String(format: "%.1f", mi)
    }
}
