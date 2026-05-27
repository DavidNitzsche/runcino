//
//  WeekStripView.swift
//
//  Mon-Sun day tiles matching web's WeekStrip. Today is highlighted; tap
//  any tile to open WorkoutDetailModal for that date.
//
//  Color semantics mirror web:
//    · easy / shakeout / long → purple (Theme.learn)
//    · tempo / marathon-pace  → race orange tint
//    · threshold / intervals  → gold (Theme.goal)
//    · race day               → race orange (Theme.race)
//    · rest                   → mute
//    · past day               → dimmer
//

import SwiftUI

struct WeekStripView: View {
    let week: PlanWeek
    @State private var selectedDate: String? = nil
    /// Date-keyed cache of fetched workouts so taps render synchronously.
    /// Filled in parallel on mount; modal reads the matching entry as
    /// `prefetched` — same pattern as web WeekStrip.
    @State private var workoutsByDate: [String: WatchWorkout] = [:]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("THIS WEEK")
                    .font(.label(10))
                    .tracking(1.6)
                    .foregroundStyle(Theme.mute)
                Spacer()
                if let weekTotal = totalMi {
                    Text(String(format: "%.0f mi", weekTotal))
                        .font(.display(15))
                        .foregroundStyle(Theme.ink.opacity(0.85))
                }
            }
            .padding(.horizontal, 24)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(week.days) { day in
                        DayTile(day: day)
                            .onTapGesture { selectedDate = day.date_iso }
                    }
                }
                .padding(.horizontal, 24)
            }
        }
        .sheet(item: Binding(
            get: { selectedDate.map { DateBox(date: $0) } },
            set: { selectedDate = $0?.date }
        )) { box in
            WorkoutDetailModal(date: box.date, prefetched: workoutsByDate[box.date])
        }
        .task(id: weekFingerprint) { await prefetchWeek() }
        // Soft tick when a day tile pops the workout modal.
        .sensoryFeedback(.selection, trigger: selectedDate)
    }

    /// Stable id for the .task so we re-prefetch only when the week changes
    /// (date list shifts on day-rollover or plan regen), not on every redraw.
    private var weekFingerprint: String {
        week.days.map(\.date_iso).joined(separator: ",")
    }

    /// Fetch every non-rest day in parallel. Best-effort — failures just
    /// fall back to the modal's on-appear fetch.
    private func prefetchWeek() async {
        await withTaskGroup(of: (String, WatchWorkout?).self) { group in
            for day in week.days where day.type != "rest" && day.distance_mi > 0 {
                group.addTask {
                    let w = try? await API.fetchWatchWorkout(date: day.date_iso)
                    return (day.date_iso, w)
                }
            }
            for await (date, workout) in group {
                if let w = workout { workoutsByDate[date] = w }
            }
        }
    }

    private var totalMi: Double? {
        let s = week.days.reduce(0) { $0 + $1.distance_mi }
        return s > 0 ? s : nil
    }
}

private struct DateBox: Identifiable {
    let date: String
    var id: String { date }
}

// MARK: - Day tile

private struct DayTile: View {
    let day: PlanDay

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(dayLabel)
                .font(.label(10))
                .tracking(1.4)
                .foregroundStyle(labelColor)
            Text(day.type == "rest" ? "REST" : String(format: "%.1f", day.distance_mi))
                .font(.display(20))
                .foregroundStyle(numberColor)
            if day.type != "rest" {
                Text(day.type.uppercased())
                    .font(.label(9))
                    .tracking(1.2)
                    .foregroundStyle(typeColor.opacity(0.85))
            } else {
                Text(" ").font(.body(9)) // spacer to keep tile heights uniform
            }
        }
        .frame(width: 76)
        .padding(.vertical, 12)
        .padding(.horizontal, 12)
        .background(tileBg)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(borderColor, lineWidth: day.is_today ? 1.5 : 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .opacity(day.is_past ? 0.55 : 1.0)
    }

    private var dayLabel: String {
        // dow: 0=Sun..6=Sat
        let names = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
        let base = names[day.dow]
        return day.is_today ? "TODAY" : base
    }

    private var labelColor: Color {
        day.is_today ? Theme.green : Theme.mute
    }

    private var numberColor: Color {
        if day.type == "rest" { return Theme.mute }
        return Theme.ink
    }

    private var typeColor: Color {
        switch day.type {
        case "easy", "shakeout", "long":      return Theme.learn
        case "threshold", "intervals":         return Theme.goal
        case "tempo":                           return Theme.race
        case "race":                            return Theme.race
        default:                                return Theme.mute
        }
    }

    private var tileBg: Color {
        if day.is_today { return Theme.green.opacity(0.10) }
        if day.type == "rest" { return Theme.card2.opacity(0.50) }
        return Theme.card
    }

    private var borderColor: Color {
        if day.is_today { return Theme.green.opacity(0.55) }
        return Theme.line
    }
}
