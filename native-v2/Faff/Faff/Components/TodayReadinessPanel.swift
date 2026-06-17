//
//  TodayReadinessPanel.swift
//  The new Today-hero element introduced by the 2026-06-01 redesign.
//  Replaces the legacy run-name + pace + effort-meter hero.
//
//  Layout (top → bottom):
//    1. Ring + words row
//       · 108pt ring · track white@20% · arc colored by band
//       · Center: number only (Oswald 42 / 600). NO label inside.
//       · Right column: `READINESS` eyebrow + band tag · 24pt bold headline
//    2. WHY strip · 5 rows · 42pt key label · center-anchored bar · value
//    3. Three glass stat chips · Last night sleep / This week miles / VO₂
//
//  Data source: existing /api/readiness (ReadinessSnapshot + ReadinessInput).
//  Doctrine 2026-06-01:
//    · No prescriptive copy (READINGS, not orders)
//    · State both numbers, no derived deltas
//    · Dark-first · text always solid white over the mesh
//    · No em dashes
//
//  Tap target: routes to the "full readiness brief" surface (TODO · design
//  pending per designs/briefs/readiness-brief-iphone-surface-brief.md).
//  Today logs the tap and no-ops.
//
//  Reference: designs/from Design agent/Today page/Faff Today Redesign.html
//

import SwiftUI

// MARK: - Band → tint

private enum ReadinessBand {
    static func tint(_ raw: String?) -> Color {
        switch (raw ?? "").uppercased() {
        case "SHARP", "PRIMED":          return Color(hex: 0x62E08A)   // green
        case "READY", "HOLD EASY":       return Color(hex: 0x8FD0FF)   // blue
        case "MODERATE":                 return Color(hex: 0xFFCE8A)   // amber
        case "PULL-BACK", "PULL BACK", "BACK OFF":
                                         return Color(hex: 0xFF7A66)   // red-orange
        case "NO-DATA", "NO DATA", "":   return Color(hex: 0xB8B0A6)   // mute
        default:                         return Color(hex: 0xFFCE8A)   // moderate fallback
        }
    }

    /// Arc stroke · slightly punchier than the band tag color so the ring
    /// reads on the mesh. Mirrors the HTML prototype's `arc` color.
    static func arc(_ raw: String?) -> Color {
        switch (raw ?? "").uppercased() {
        case "SHARP", "PRIMED":          return Color(hex: 0x3CD370)
        case "READY", "HOLD EASY":       return Color(hex: 0x58B8FF)
        case "MODERATE":                 return Color(hex: 0xFFB24D)
        case "PULL-BACK", "PULL BACK", "BACK OFF":
                                         return Color(hex: 0xFC4D64)
        case "NO-DATA", "NO DATA", "":   return Color(hex: 0xB8B0A6)
        default:                         return Color(hex: 0xFFB24D)
        }
    }
}

// MARK: - Public panel

struct TodayReadinessPanel: View {
    let snapshot: ReadinessSnapshot?
    /// HK last-night sleep total (hours). Drives the LAST NIGHT stat chip.
    let lastNightHours: Double?
    /// Weekly mileage so far (current ISO week). Drives the THIS WEEK chip.
    let thisWeekMiles: Double?
    // VO₂ MAX chip removed (AFC fix 10) · a monthly-moving number has no
    // place on the daily glance. VO₂ lives on the Health tab.
    /// 2026-06-02 round 39 · second-row chips: BEST WINDOW / TO RACE /
    /// NEXT HARD. All optional · render "—" when their backing data
    /// isn't loaded yet (no GPS home base for forecast, no race
    /// scheduled, etc.).
    var bestWindow: String? = nil      // "Before 7 AM" from forecast.best_window
    var weeksToRace: Int? = nil        // purpose.weeksToRace
    var daysToRace: Int? = nil         // profile.nextARace.days_to_race; used when <14
    var nextHardLabel: String? = nil   // e.g. "TUE · TEMPO"
    /// Tap target · routes to the "full readiness brief" surface.
    let onTap: () -> Void

    private var bandTint: Color { ReadinessBand.tint(snapshot?.band) }
    private var arcTint: Color  { ReadinessBand.arc(snapshot?.band) }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            signalTileGrid
            statChips
        }
    }

    // MARK: 2 · 2×2 signal tile grid

    @ViewBuilder
    private var signalTileGrid: some View {
        let tiles = (snapshot?.inputs ?? []).filter { !["hr_recovery", "rpe"].contains($0.key) }
        if !tiles.isEmpty {
            LazyVGrid(
                columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)],
                spacing: 10
            ) {
                ForEach(tiles) { input in
                    TodaySignalTile(input: input)
                }
            }
        }
    }

    // MARK: 3 · stat chips
    //
    // AFC fix 10 (2026-06-09) ·
    //   · ordered by daily relevance: TO RACE (the top motivator, was
    //     buried at slot 5) → NEXT HARD → BEST WINDOW → LAST NIGHT →
    //     THIS WEEK.
    //   · VO₂ MAX dropped · it moves monthly at best and has no business
    //     on a daily glance surface (it lives on Health).
    //   · chips with no backing data don't render at all (the grid
    //     reflows) · per the brief, don't render empty versions of beats
    //     with nothing to say. A fresh install previously showed a grid
    //     of six "—" chips.

    // Chip grid: 3-column Grid so NEXT HARD can span 2 columns (double wide).
    // Row 1: TO RACE (1/3) | NEXT HARD (2/3)
    // Row 2: BEST WINDOW | LAST NIGHT | THIS WEEK (equal thirds)
    // Missing chips render as invisible placeholders so column widths stay consistent.

    @ViewBuilder
    private var statChips: some View {
        let hasRow1 = toRaceDisplay != nil || nextHardDisplay != nil
        let hasRow2 = bestWindowDisplay != nil || lastNightDisplay != nil || thisWeekDisplay != nil
        if hasRow1 || hasRow2 {
            Grid(horizontalSpacing: 8, verticalSpacing: 8) {
                if hasRow1 {
                    GridRow {
                        if let v = toRaceDisplay {
                            StatChip(label: "TO RACE", value: v)
                        } else {
                            Color.clear.frame(height: 1)
                        }
                        Group {
                            if let v = nextHardDisplay {
                                StatChip(label: "NEXT HARD", value: v)
                            } else {
                                Color.clear.frame(height: 1)
                            }
                        }
                        .gridCellColumns(2)
                    }
                }
                if hasRow2 {
                    GridRow {
                        if let v = bestWindowDisplay {
                            StatChip(label: "BEST WINDOW", value: v)
                        } else {
                            Color.clear.frame(height: 1)
                        }
                        if let v = lastNightDisplay {
                            StatChip(label: "LAST NIGHT", value: v)
                        } else {
                            Color.clear.frame(height: 1)
                        }
                        if let v = thisWeekDisplay {
                            StatChip(label: "THIS WEEK", value: v)
                        } else {
                            Color.clear.frame(height: 1)
                        }
                    }
                }
            }
        }
    }

    private var lastNightDisplay: String? {
        guard let h = lastNightHours, h > 0 else { return nil }
        let hours = Int(h)
        let mins = Int((h - Double(hours)) * 60)
        return mins > 0 ? "\(hours)h \(mins)m" : "\(hours)h"
    }

    private var thisWeekDisplay: String? {
        guard let m = thisWeekMiles, m > 0 else { return nil }
        // One decimal everywhere (27.5 must not read 28), matching the rest of
        // the app's mileage display.
        let v = m.truncatingRemainder(dividingBy: 1) == 0
            ? String(format: "%.0f", m) : String(format: "%.1f", m)
        return "\(v) mi"
    }

    private var bestWindowDisplay: String? {
        guard let s = bestWindow, !s.isEmpty else { return nil }
        return s
    }

    private var toRaceDisplay: String? {
        // Final stretch: show exact days when <14 out ("9D", "3D", "1D").
        if let d = daysToRace, d > 0, d < 14 {
            return "\(d)D"
        }
        guard let w = weeksToRace, w > 0 else { return nil }
        return w == 1 ? "1 WK" : "\(w) WK"
    }

    private var nextHardDisplay: String? {
        guard let s = nextHardLabel, !s.isEmpty else { return nil }
        return s
    }
}

// MARK: - Signal tile atom (2×2 grid)

private struct TodaySignalTile: View {
    let input: ReadinessInput

    private var displayLabel: String {
        switch input.key.lowercased() {
        case "hrv":  return "RECOVERY"
        case "rhr":  return "RESTING HR"
        case "load": return "LOAD"
        default:
            let primary = (input.label.split(separator: "·").first ?? "").trimmingCharacters(in: .whitespaces)
            return primary.isEmpty ? input.key.uppercased() : primary.uppercased()
        }
    }

    private var tint: Color {
        let w = input.weight
        if w <= -8 { return Color(hex: 0xFC4D64) }
        if w <  0  { return Color(hex: 0xF3AD38) }
        if w >  0  { return Color(hex: 0x3EBD41) }
        return Color(hex: 0x8A90A0)
    }

    private var isNoData: Bool {
        let v = (input.observedV ?? "").lowercased()
        return v == "no data" || v == "building history" || v.isEmpty
    }

    private var displayValue: String {
        let v = input.observedV ?? "—"
        guard !isNoData, let dot = v.range(of: " · ") else { return isNoData ? "—" : v }
        return String(v[..<dot.lowerBound])
    }

    private var displaySub: String {
        guard !isNoData else { return "" }
        let v = input.observedV ?? ""
        guard let dot = v.range(of: " · ") else { return input.observedSub ?? "" }
        let trailing = String(v[dot.upperBound...])
        return trailing.isEmpty ? (input.observedSub ?? "") : trailing
    }

    private var valueIsWord: Bool {
        displayValue.first.map { !$0.isNumber } ?? false
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 5) {
                Circle()
                    .fill(tint)
                    .frame(width: 6, height: 6)
                Text(displayLabel)
                    .font(.body(8, weight: .extraBold))
                    .tracking(1.2)
                    .foregroundStyle(tint)
                Spacer(minLength: 0)
            }
            Text(displayValue)
                .font(.body(valueIsWord ? 14 : 20, weight: .bold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .padding(.top, 8)
            if !displaySub.isEmpty {
                Text(displaySub)
                    .font(.body(9, weight: .regular))
                    .foregroundStyle(Color.white.opacity(0.5))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .padding(.top, 2)
            }
            if !input.meaning.isEmpty && !isNoData {
                Text(input.meaning)
                    .font(.body(10, weight: .regular))
                    .foregroundStyle(Color.white.opacity(0.56))
                    .lineSpacing(1.5)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 7)
            }
        }
        .padding(13)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.white.opacity(0.05),
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(tint.opacity(isNoData ? 0.1 : 0.2), lineWidth: 1)
        )
    }
}

// MARK: - Stat chip atom

private struct StatChip: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.body(9, weight: .extraBold)).tracking(0.9)
                .foregroundStyle(Color.white.opacity(0.62))
                .lineLimit(1)
            Text(value)
                .font(.display(21, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 13).padding(.vertical, 11)
        .background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color.white.opacity(0.18), lineWidth: 1)
        )
    }
}
