//
//  WeekStripV3.swift
//
//  Mirrors web-v2/components/faff/WeekStrip.tsx (+ WeekStrip.module.css).
//
//  7-day strip · header row "THIS WEEK · BUILD WK X  /  N mi" then a
//  7-column grid. Each card:
//    · 4px accent band on top (state color from Theme.green/goal/dist/...)
//    · single-char DOW label (M T W T F S S)
//    · mileage (Inter 700 tabular)
//    · 4-char vocab label (EASY / INTS / TMPO / THRS / LONG / REST / ...)
//    · DONE check badge for completed past days (top-right)
//    · em-dash glyph for missed days (top-right)
//    · today gets a 1.5px ink outline + lifted background tint
//
//  Per spec: never collapses to a scrolling carousel — the 7 cards
//  must read as the arc of the week in one glance.
//

import SwiftUI

struct WeekStripV3: View {
    let payload: WeekStripPayload
    var phaseLabel: String? = nil

    var body: some View {
        if payload.days.isEmpty {
            emptyState
        } else {
            VStack(alignment: .leading, spacing: 14) {
                header
                weekRow
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("THIS WEEK")
                .font(.body(11, weight: .bold))
                .tracking(2.2)
                .foregroundStyle(Theme.mute)
            if let phaseLabel {
                Text(phaseLabel.uppercased())
                    .font(.body(10, weight: .bold))
                    .tracking(1.6)
                    .foregroundStyle(Theme.mute.opacity(0.78))
            }
            Spacer()
            Text(totalsLabel)
                .font(.body(18, weight: .bold))
                .foregroundStyle(Theme.ink)
                .monospacedDigit()
        }
    }

    private var totalsLabel: String {
        "\(fmt(payload.completedMi)) / \(fmt(payload.plannedMi)) mi"
    }

    // MARK: - Week row · 7 equal cards

    private var weekRow: some View {
        HStack(spacing: 4) {
            ForEach(payload.days) { day in
                DayCardV3(day: day)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: - Empty

    private var emptyState: some View {
        Text("PLAN BEGINS AFTER SETUP")
            .font(.body(11, weight: .bold))
            .tracking(2.2)
            .foregroundStyle(Theme.mute)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 22)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(style: StrokeStyle(lineWidth: 1, dash: [4]))
                    .foregroundStyle(Theme.line)
            )
    }

    // MARK: - Helpers

    private func fmt(_ n: Double) -> String {
        if n.truncatingRemainder(dividingBy: 1) == 0 {
            return String(Int(n))
        }
        return String(format: "%.1f", n)
    }
}

// MARK: - Day card

private struct DayCardV3: View {
    let day: FaffWeekDay

    /// Web's DOW_LABELS uses M·T·W·T·F·S·S (Mon-first). Our dow is 0..6.
    /// PlanWeek.days dow is 0=Sun..6=Sat on the iPhone side (matches web's
    /// `Date.getUTCDay()` convention), but the iPhone PlanWeek API ships
    /// days in Mon-Sun order (because the underlying plan engine writes
    /// the array in Mon-Sun order). To stay defensive: derive the label
    /// from the dow value rather than position.
    private var dowLabel: String {
        // Sun=0..Sat=6 mapped to single-char labels.
        let labels = ["S", "M", "T", "W", "T", "F", "S"]
        guard day.dow >= 0, day.dow < labels.count else { return "·" }
        return labels[day.dow]
    }

    private var state: DayCardState {
        if day.plannedType == "rest" { return .rest }
        if day.completedRunId != nil { return .done }
        if day.isToday { return .today }
        if day.isFuture { return .planned }
        return .missed
    }

    private var accentColor: Color {
        switch (day.plannedType ?? "").lowercased() {
        case "easy", "shakeout", "recovery": return Theme.green
        case "quality", "threshold", "tempo", "intervals", "fartlek", "progression":
            return Theme.goal
        case "long":   return Theme.dist
        case "rest":   return Theme.rest
        case "cross", "strength": return Theme.learn
        case "race":   return Theme.race
        default:       return Theme.line
        }
    }

    private var mileageText: String {
        switch (day.plannedType ?? "").lowercased() {
        case "rest", "cross", "strength":
            return "—"
        default:
            guard let mi = day.plannedDistance, mi > 0 else { return "—" }
            if mi.truncatingRemainder(dividingBy: 1) == 0 {
                return String(Int(mi))
            }
            return String(format: "%.1f", mi)
        }
    }

    var body: some View {
        ZStack(alignment: .top) {
            // Background card
            RoundedRectangle(cornerRadius: 10)
                .fill(state == .today ? Color.white.opacity(0.03) : Theme.card2)

            VStack(spacing: 4) {
                // Spacer for the 4px accent band that sits ON TOP
                Spacer().frame(height: 6)
                Text(dowLabel)
                    .font(.body(9, weight: .bold))
                    .tracking(1.2)
                    .foregroundStyle(Theme.mute)
                Text(mileageText)
                    .font(.body(15, weight: .bold))
                    .foregroundStyle(mileageColor)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .strikethrough(state == .missed, color: Theme.mute)
                Text(day.plannedTypeLabel.isEmpty ? "—" : day.plannedTypeLabel)
                    .font(.body(8, weight: .bold))
                    .tracking(1.2)
                    .foregroundStyle(typeLabelColor)
                Spacer()
            }
            .padding(.horizontal, 4)

            // Accent bar (always full saturation except missed which dims).
            // Use UnevenRoundedRectangle (iOS 16+) to round only the TOP
            // corners so the bar sits flush against the card's bottom.
            UnevenRoundedRectangle(
                topLeadingRadius: 10,
                bottomLeadingRadius: 0,
                bottomTrailingRadius: 0,
                topTrailingRadius: 10,
                style: .continuous
            )
                .fill(accentColor.opacity(state == .missed ? 0.35 : 1.0))
                .frame(height: 4)
                .frame(maxWidth: .infinity, alignment: .top)

            // Top-right glyph · check (done) or em-dash (missed)
            if state == .done {
                Text("✓")
                    .font(.body(10, weight: .bold))
                    .foregroundStyle(Theme.green)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .padding(.top, 8)
                    .padding(.trailing, 6)
            } else if state == .missed {
                Text("—")
                    .font(.body(10, weight: .bold))
                    .foregroundStyle(Theme.mute.opacity(0.6))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .padding(.top, 8)
                    .padding(.trailing, 6)
            }
        }
        .frame(minHeight: 92)
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(state == .today ? Theme.ink : Theme.line2,
                        lineWidth: state == .today ? 1.5 : 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .opacity(opacity)
    }

    private var mileageColor: Color {
        switch state {
        case .missed: return Theme.mute
        case .planned: return Theme.ink.opacity(0.5)
        default: return Theme.ink
        }
    }

    private var typeLabelColor: Color {
        switch state {
        case .today: return Theme.ink
        case .missed: return Theme.mute.opacity(0.6)
        case .planned: return Theme.mute.opacity(0.5)
        default: return Theme.mute
        }
    }

    private var opacity: Double {
        // We dim individual children for planned/missed in the colors
        // above. Whole-card opacity stays full so the accent bar reads.
        return 1.0
    }

    private enum DayCardState { case done, today, planned, missed, rest }
}
