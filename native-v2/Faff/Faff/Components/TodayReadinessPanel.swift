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

// MARK: - Pillar row model

/// One row in the WHY strip. Built by mapping `ReadinessInput` → row
/// model. The bar is center-anchored: fill extends right (green) when
/// the pillar lifts the score, left (amber/red) when it drags it down.
private struct PillarRow: Identifiable {
    let id: String           // input.key
    let label: String        // "SLEEP"
    let value: String        // "5.9h · 7-night"
    let dir: Int             // -1 / 0 / 1
    let mag: Double          // 0..1, fraction of half-bar width
    let tint: Color
}

private func rowsFromInputs(_ inputs: [ReadinessInput]?) -> [PillarRow] {
    guard let inputs else { return [] }
    // Keep the 5 canonical inputs in the brief's order. The endpoint may
    // return them in any order; we normalize so the panel reads the same
    // every render.
    let order: [String] = ["sleep", "hrv", "rhr", "load", "rpe"]
    let byKey: [String: ReadinessInput] = Dictionary(
        uniqueKeysWithValues: inputs.map { ($0.key.lowercased(), $0) }
    )
    return order.compactMap { key in
        guard let row = byKey[key] else { return nil }
        let dir: Int
        if row.weight > 0 { dir = 1 }
        else if row.weight < 0 { dir = -1 }
        else { dir = 0 }
        // Magnitude · weight typically ranges -14..+8 across pillars. Map
        // |weight| → 0..1 of the half-bar width using 14 as the practical
        // ceiling (clamped). 0-weight rows still render a small dot.
        let mag = min(1.0, Double(abs(row.weight)) / 14.0)
        let tint: Color
        switch dir {
        case 1:  tint = Color(hex: 0x62E08A)
        case -1: tint = Color(hex: 0xFFB24D)
        default: tint = Color(hex: 0x8AA0A8)
        }
        // Label cleanup · the endpoint emits "SLEEP · 28%" / "HRV · 28%"
        // etc. Strip the weight suffix for this surface (the panel doesn't
        // show pillar weights). Keep ≤6 chars so it fits the 42pt column.
        let label: String = {
            let primary = (row.label.split(separator: "·").first ?? "").trimmingCharacters(in: .whitespaces)
            // The endpoint uses "RPE" for the 5th pillar; the design calls
            // it "HR REC". Until the iPhone migrates to the richer brief
            // contract, render with the source's label and the design
            // intent is preserved (5 rows, same column widths).
            return primary.isEmpty ? key.uppercased() : primary
        }()
        return PillarRow(
            id: row.key,
            label: label,
            value: row.observedV ?? "—",
            dir: dir,
            mag: mag,
            tint: tint
        )
    }
}

// MARK: - Public panel

struct TodayReadinessPanel: View {
    let snapshot: ReadinessSnapshot?
    /// HK last-night sleep total (hours). Drives the LAST NIGHT stat chip.
    let lastNightHours: Double?
    /// Weekly mileage so far (current ISO week). Drives the THIS WEEK chip.
    let thisWeekMiles: Double?
    /// VO₂ max from profile.physiology. Drives the VO₂ MAX chip.
    let vo2: Double?
    /// 2026-06-02 round 39 · second-row chips: BEST WINDOW / TO RACE /
    /// NEXT HARD. All optional · render "—" when their backing data
    /// isn't loaded yet (no GPS home base for forecast, no race
    /// scheduled, etc.).
    var bestWindow: String? = nil      // "Before 7 AM" from forecast.best_window
    var weeksToRace: Int? = nil        // purpose.weeksToRace
    var nextHardLabel: String? = nil   // e.g. "TUE · TEMPO"
    /// Tap target · routes to the "full readiness brief" surface.
    let onTap: () -> Void

    private var rows: [PillarRow] { rowsFromInputs(snapshot?.inputs) }
    private var bandTint: Color { ReadinessBand.tint(snapshot?.band) }
    private var arcTint: Color  { ReadinessBand.arc(snapshot?.band) }
    private var bandText: String {
        let raw = (snapshot?.band ?? "").uppercased()
        return raw.isEmpty ? "" : raw
    }
    private var scoreText: String {
        if let s = snapshot?.score { return String(s) }
        return "—"
    }
    private var headlineText: String {
        // Derive a one-line headline from the snapshot. Until the iPhone
        // wires the richer ReadinessBriefSeed.headline, we compose from
        // the two lowest-weight pillars (the things dragging the score).
        // No prescription · purely descriptive.
        guard let inputs = snapshot?.inputs, !inputs.isEmpty else {
            return "Wear the watch overnight\nto light up readiness."
        }
        let negatives = inputs
            .filter { $0.weight < 0 }
            .sorted { $0.weight < $1.weight }
            .prefix(2)
            .map { humanize($0.key) }
        if negatives.isEmpty {
            switch bandText {
            case "SHARP":    return "Everything's stacked.\nThe system is firing."
            case "READY":    return "Solid across the board.\nGood day to do work."
            case "MODERATE": return "Sitting in the middle.\nOne pillar dipped."
            default:         return "Readiness reading is steady."
            }
        }
        if negatives.count == 1 {
            return "\(negatives[0]) is dragging."
        }
        return "\(negatives[0]) and \(negatives[1])\nare dragging."
    }

    private func humanize(_ key: String) -> String {
        switch key.lowercased() {
        case "sleep": return "Sleep"
        case "hrv":   return "HRV"
        case "rhr":   return "RHR"
        case "load":  return "Load"
        case "rpe":   return "RPE"
        case "hr_recovery", "hr-rec", "hr_rec": return "HR recovery"
        default:      return key.capitalized
        }
    }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 22) {
                ringPlusWords
                whyStrip
                statChips
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Readiness \(scoreText), \(bandText). Tap for the full brief.")
    }

    // MARK: 1 · ring + words

    private var ringPlusWords: some View {
        HStack(alignment: .center, spacing: 20) {
            TodayReadinessRing(score: snapshot?.score, arcTint: arcTint)
                .frame(width: 108, height: 108)
            VStack(alignment: .leading, spacing: 7) {
                // 2026-06-03 round 68 · "READINESS · READY" eyebrow
                // retired. David: "we dont need any labels here the
                // number and circle is doing enough." Ring + score
                // already communicate the band state; the eyebrow was
                // redundant noise above the actual headline.
                Text(headlineText)
                    .font(.body(24, weight: .extraBold))
                    .foregroundStyle(.white)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .shadow(color: .black.opacity(0.28), radius: 20, y: 2)
                // 2026-06-02 round 40 · subtle "view full" affordance.
                // The panel was tappable end-to-end (whole Button) but
                // gave no visual cue · runners might not realize the
                // ring + headline + WHY all expand into a full brief.
                // Inline low-contrast chevron-text covers the cue
                // without competing with the headline.
                HStack(spacing: 4) {
                    Text("View full read")
                        .font(.body(11, weight: .semibold)).tracking(0.2)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                }
                .foregroundStyle(Color.white.opacity(0.55))
                .padding(.top, 2)
            }
        }
    }

    // MARK: 2 · WHY strip

    @ViewBuilder
    private var whyStrip: some View {
        if !rows.isEmpty {
            VStack(spacing: 9) {
                ForEach(rows) { row in
                    WhyRow(row: row)
                }
            }
        }
    }

    // MARK: 3 · stat chips

    private var statChips: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                StatChip(label: "LAST NIGHT", value: lastNightDisplay)
                StatChip(label: "THIS WEEK", value: thisWeekDisplay)
                StatChip(label: "VO₂ MAX",   value: vo2Display)
            }
            HStack(spacing: 8) {
                StatChip(label: "BEST WINDOW", value: bestWindowDisplay)
                StatChip(label: "TO RACE",     value: toRaceDisplay)
                StatChip(label: "NEXT HARD",   value: nextHardDisplay)
            }
        }
    }

    private var lastNightDisplay: String {
        guard let h = lastNightHours, h > 0 else { return "—" }
        let hours = Int(h)
        let mins = Int((h - Double(hours)) * 60)
        return mins > 0 ? "\(hours)h \(mins)m" : "\(hours)h"
    }

    private var thisWeekDisplay: String {
        guard let m = thisWeekMiles, m > 0 else { return "—" }
        let rounded = Int(m.rounded())
        return "\(rounded) mi"
    }

    private var vo2Display: String {
        guard let v = vo2, v > 0 else { return "—" }
        if v >= 60 { return String(Int(v.rounded())) }
        return String(format: "%.1f", v)
    }

    private var bestWindowDisplay: String {
        guard let s = bestWindow, !s.isEmpty else { return "—" }
        return s
    }

    private var toRaceDisplay: String {
        guard let w = weeksToRace, w > 0 else { return "—" }
        return w == 1 ? "1 WK" : "\(w) WK"
    }

    private var nextHardDisplay: String {
        guard let s = nextHardLabel, !s.isEmpty else { return "—" }
        return s
    }
}

// MARK: - Ring atom

private struct TodayReadinessRing: View {
    let score: Int?
    let arcTint: Color

    private var progress: Double {
        guard let s = score else { return 0 }
        return min(1.0, max(0.0, Double(s) / 100.0))
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.2), lineWidth: 6.5)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(arcTint,
                        style: StrokeStyle(lineWidth: 6.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.easeInOut(duration: 0.6), value: progress)
            Text(score.map(String.init) ?? "—")
                .font(.display(42, weight: .semibold))
                .foregroundStyle(.white)
        }
    }
}

// MARK: - WHY row atom

private struct WhyRow: View {
    let row: PillarRow

    var body: some View {
        HStack(spacing: 12) {
            Text(row.label.uppercased())
                .font(.body(9.5, weight: .extraBold)).tracking(0.6)
                .foregroundStyle(Color.white.opacity(0.7))
                .frame(width: 42, alignment: .leading)

            GeometryReader { geo in
                ZStack {
                    // Track
                    Capsule()
                        .fill(Color.white.opacity(0.14))
                        .frame(height: 7)

                    // Center axis tick
                    Rectangle()
                        .fill(Color.white.opacity(0.3))
                        .frame(width: 1, height: 11)
                        .position(x: geo.size.width / 2, y: geo.size.height / 2)

                    // Fill bar (center-anchored)
                    if row.dir != 0 {
                        let half = geo.size.width / 2
                        let fillW = max(6, half * CGFloat(row.mag))
                        let xPos = row.dir > 0
                            ? half + fillW / 2
                            : half - fillW / 2
                        Capsule()
                            .fill(row.tint)
                            .frame(width: fillW, height: 7)
                            .position(x: xPos, y: geo.size.height / 2)
                    } else {
                        // Dir=0: tiny dot on the axis
                        Circle()
                            .fill(Color.white.opacity(0.45))
                            .frame(width: 5, height: 5)
                            .position(x: geo.size.width / 2, y: geo.size.height / 2)
                    }
                }
            }
            .frame(height: 11)

            Text(row.value)
                .font(.body(11, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.92))
                .frame(width: 118, alignment: .trailing)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
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
