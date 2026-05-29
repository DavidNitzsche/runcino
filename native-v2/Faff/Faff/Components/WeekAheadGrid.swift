//
//  WeekAheadGrid.swift
//
//  iPhone mirror of web-v2/components/training/WeekAhead.tsx.
//
//  7-day grid w/ DOW, miles, type, and bottom-anchored target line
//  (pace + HR/intent). Compared to the existing WeekStripV3 (which
//  powers /today's strip — single-char DOW labels, 4-char vocab type),
//  this is the Plan-view tuning: 3-char DOW, full type names, target
//  pace shown per cell. Mirrors the §3 spec referenced in WeekAhead.tsx.
//
//  Unlike WeekStripV3 — which fits Mon-Sun into the full viewport width
//  with 7 equal columns — WeekAheadGrid wraps onto a 2-row grid (4 + 3)
//  on iPhone so each cell is tall enough to surface target pace + HR
//  without truncation. The web ships 7-up on a 1.4fr column; iPhone
//  doesn't have that horizontal room. The header agrees with the web:
//  "WEEK AHEAD" left, "X.X / Y.Y MI" right.
//
//  Day tile structure (mirrors DayCell on WeekAhead.tsx):
//    1. DOW eyebrow (small caps, mute or green if today)
//    2. Big mileage number — done or planned, display recipe
//    3. Type label (COMPLETED / EASY / LONG / etc.)
//    4. Bottom-anchored target line: pace + secondary (HR / label).
//

import SwiftUI

/// One day card input. Mirrors the relevant subset of PlanWeek's day
/// shape from web-v2/lib/coach/training-state.ts. The adapter builds
/// these off iOS's TrainingPlanDay (rich shape) — see FaffAdapter.
struct WeekAheadDay: Identifiable {
    /// ISO date (YYYY-MM-DD). Used as id + for past/today comparisons.
    let date: String
    /// 0=Sun..6=Sat (matches the web's `Date.getUTCDay()` convention).
    let dow: Int
    /// Planned distance for this day (mi). 0 = rest.
    let plannedMi: Double
    /// Plan type (easy / long / threshold / tempo / intervals / race / rest).
    let type: String
    /// Optional sub-label (e.g. "4×8' threshold"). Falls back to type.uppercased().
    let label: String?
    /// Done distance, if a run is logged. > 0 marks the cell as completed.
    let doneMi: Double
    /// Strava activity id, if a run is logged.
    let activityId: String?
    /// Pace target string for the tile's bottom line. Adapter formats this
    /// (e.g. "9:00 /mi"). Open data gap: iOS doesn't yet fetch
    /// prescriptions — adapter currently falls back to type-based defaults
    /// matching `targetFor()` in WeekAhead.tsx.
    let paceTarget: String
    /// Secondary line under the pace (HR range, intent, fuel note).
    let secondaryTarget: String

    var id: String { date }
}

struct WeekAheadGrid: View {
    let days: [WeekAheadDay]
    /// Today's ISO date (YYYY-MM-DD). Drives the "today" highlight.
    let today: String
    /// Planned mileage for the week — for the header rollup.
    let plannedMi: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            // 2-row grid: 4 cells across, then 3 + 1 spacer. Keeps tiles
            // tall enough to show pace + HR without truncation on iPhone.
            grid
        }
        .padding(20)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16).stroke(Theme.line, lineWidth: 1)
        )
        .padding(.horizontal, 24)
    }

    // MARK: - Header
    //
    // Mirrors WeekAhead.tsx's projected-vs-planned header — show the
    // running total of done + remaining planned, not just the original
    // planned total, so the header agrees with what the coach voice
    // says elsewhere ("you'll be over by 3 mi this week"). The optional
    // overPlanBy chip surfaces when the delta is meaningful (|Δ| ≥ 3 mi).

    private var header: some View {
        let projected = days.reduce(0.0) { sum, d in
            let useActual = d.doneMi > 0 && d.activityId != nil
            return sum + (useActual ? d.doneMi : d.plannedMi)
        }
        let done = days.reduce(0.0) { sum, d in
            sum + (d.doneMi > 0 ? d.doneMi : 0)
        }
        let overPlanBy = (projected - plannedMi)
        let showDelta = abs(overPlanBy) >= 3

        return HStack(alignment: .firstTextBaseline) {
            Text("WEEK AHEAD")
                .font(.display(22))
                .tracking(0.5)
                .foregroundStyle(Theme.ink)
            Spacer()
            HStack(spacing: 8) {
                Text("\(fmt(done)) / \(fmt(projected)) MI")
                    .font(.display(18))
                    .tracking(0.5)
                    .foregroundStyle(Theme.mute)
                if showDelta {
                    Text("(\(overPlanBy > 0 ? "+" : "")\(fmt(overPlanBy)) vs \(fmt(plannedMi)) planned)")
                        .font(.body(10, weight: .semibold))
                        .tracking(0.5)
                        .foregroundStyle(Theme.mute)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
        }
    }

    // MARK: - Grid

    private var grid: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4),
            alignment: .leading,
            spacing: 8
        ) {
            ForEach(days) { d in
                DayTile(day: d, isToday: d.date == today, isPast: d.date < today)
            }
        }
    }

    // MARK: - Helpers

    private func fmt(_ n: Double) -> String {
        if n.truncatingRemainder(dividingBy: 1) == 0 {
            return String(Int(n))
        }
        return String(format: "%.1f", n)
    }
}

// MARK: - DayTile
//
// Mirrors DayCell in WeekAhead.tsx — DOW + big mileage + type label +
// bottom-anchored target line. Today gets the green 1pt outline + tint.
// Completed past days get a lighter green outline. Rest days dim.

private struct DayTile: View {
    let day: WeekAheadDay
    let isToday: Bool
    let isPast: Bool

    private static let dowNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

    private var isRest: Bool { day.type == "rest" || day.plannedMi == 0 }
    private var isQuality: Bool {
        ["threshold", "tempo", "intervals"].contains(day.type)
    }
    private var isLong: Bool { day.type == "long" }
    private var isRace: Bool { day.type == "race" }
    private var isEasy: Bool { day.type == "easy" || day.type == "shakeout" }
    private var ran: Bool { day.doneMi > 0 && day.activityId != nil }

    private var typeColor: Color {
        if isToday    { return Theme.green }
        if isQuality  { return Theme.goal }
        if isLong     { return Theme.dist }
        if isRace     { return Theme.race }
        if isEasy     { return Theme.learn }
        return Theme.mute
    }

    private var typeLabel: String {
        if ran { return "COMPLETED" }
        if isRest { return "REST" }
        if let label = day.label, !label.isEmpty { return label.uppercased() }
        return day.type.uppercased()
    }

    private var background: Color {
        if isToday { return Theme.green.opacity(0.10) }
        if ran     { return Theme.green.opacity(0.05) }
        return Color.white.opacity(0.025)
    }

    private var borderColor: Color {
        if isToday { return Theme.green.opacity(0.30) }
        if ran && isPast { return Theme.green.opacity(0.18) }
        return Color.clear
    }

    private var mileageDisplay: String {
        if ran {
            if day.doneMi.truncatingRemainder(dividingBy: 1) == 0 {
                return String(Int(day.doneMi))
            }
            return String(format: "%.1f", day.doneMi)
        }
        if isRest { return "—" }
        if day.plannedMi.truncatingRemainder(dividingBy: 1) == 0 {
            return String(Int(day.plannedMi))
        }
        return String(format: "%.1f", day.plannedMi)
    }

    private var mileageColor: Color {
        if isRest && !ran { return Theme.dim }
        return Theme.ink
    }

    private var dowLabel: String {
        guard day.dow >= 0, day.dow < Self.dowNames.count else { return "—" }
        return Self.dowNames[day.dow]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // 1. DOW eyebrow
            Text(dowLabel)
                .font(.body(10, weight: .bold))
                .tracking(1.4)
                .foregroundStyle(isToday ? Theme.green : Theme.mute)

            // 2. Mileage hero number
            Text(mileageDisplay)
                .font(.display(24))
                .foregroundStyle(mileageColor)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(.top, 2)

            // 3. Type label
            Text(typeLabel + (isToday ? " · TODAY" : ""))
                .font(.body(9, weight: .bold))
                .tracking(0.8)
                .foregroundStyle(ran ? Theme.green : typeColor)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .padding(.top, 2)

            Spacer(minLength: 6)

            // 4. Bottom-anchored target line — divider + pace + secondary
            VStack(alignment: .leading, spacing: 3) {
                Rectangle()
                    .fill(Theme.line2)
                    .frame(height: 1)
                Text(isRest && !ran ? "—" : day.paceTarget)
                    .font(.body(11, weight: .semibold))
                    .foregroundStyle(isRest && !ran ? Theme.dim : Theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .padding(.top, 2)
                if !day.secondaryTarget.isEmpty {
                    Text(day.secondaryTarget.uppercased())
                        .font(.body(9, weight: .semibold))
                        .tracking(0.8)
                        .foregroundStyle(Theme.mute)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 130)
        .background(background)
        .overlay(
            RoundedRectangle(cornerRadius: 10).stroke(borderColor, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}
