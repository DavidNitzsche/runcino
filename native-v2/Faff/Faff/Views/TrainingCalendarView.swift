//
//  TrainingCalendarView.swift
//  Week-by-week training plan calendar. Shows each week as a section
//  with planned workouts per day. Completed days show a checkmark.
//  Accessed via the calendar icon in the global top bar.
//

import SwiftUI

struct TrainingCalendarView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var weeks: [PlanWeek] = []
    @State private var loading = true

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                HStack {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.txt)
                            .frame(width: 36, height: 36)
                    }
                    .buttonStyle(.plain)

                    Spacer(minLength: 0)
                    Text("Training Calendar")
                        .font(.body(17, weight: .extraBold))
                        .foregroundStyle(Theme.txt)
                    Spacer(minLength: 0)

                    // Placeholder to balance chevron
                    Color.clear.frame(width: 36, height: 36)
                }
                .padding(.horizontal, 18)
                .padding(.top, 10)
                .padding(.bottom, 8)

                Divider()
                    .background(Color.white.opacity(0.10))

                if loading {
                    Spacer()
                    ProgressView()
                        .tint(Theme.txt.opacity(0.5))
                    Spacer()
                } else {
                    ScrollView(showsIndicators: false) {
                        LazyVStack(spacing: 0, pinnedViews: []) {
                            ForEach(weeks, id: \.week_start_iso) { week in
                                weekSection(week)
                            }
                        }
                        .padding(.bottom, 120)
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
        .task { await loadCalendar() }
    }

    // MARK: - Week section

    @ViewBuilder
    private func weekSection(_ week: PlanWeek) -> some View {
        let totalMi = week.days.reduce(0.0) { $0 + $1.distance_mi }
        let dateRange = weekRangeLabel(week)

        VStack(spacing: 0) {
            // Week header
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(dateRange)
                        .font(.body(14, weight: .extraBold))
                        .foregroundStyle(Theme.txt)
                    if totalMi > 0 {
                        Text("Total: \(formatMi(totalMi)) mi")
                            .font(.body(12, weight: .semibold))
                            .foregroundStyle(Theme.txt.opacity(0.55))
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 12)

            // Days
            ForEach(week.days, id: \.date_iso) { day in
                dayRow(day)
                if day.date_iso != week.days.last?.date_iso {
                    Divider()
                        .background(Color.white.opacity(0.07))
                        .padding(.leading, 20)
                }
            }
        }

        Divider()
            .background(Color.white.opacity(0.14))
            .padding(.top, 4)
    }

    @ViewBuilder
    private func dayRow(_ day: PlanDay) -> some View {
        let effort = FaffEffort.fromType(day.type)
        let isDone = day.completedRunId != nil
        let isRest = day.type.lowercased() == "rest"

        HStack(alignment: .center, spacing: 14) {
            // DOW + date
            VStack(alignment: .leading, spacing: 1) {
                Text(dowLabel(day.dow))
                    .font(.label(10)).tracking(0.8)
                    .foregroundStyle(Theme.txt.opacity(day.is_today ? 1 : 0.5))
                Text("\(dayNumber(day.date_iso))")
                    .font(.body(18, weight: .extraBold))
                    .foregroundStyle(Theme.txt.opacity(day.is_today ? 1 : 0.85))
                    .frame(width: 32, alignment: .leading)
            }
            .frame(width: 36)

            if isRest {
                Text("Rest Day")
                    .font(.body(13, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.38))
                Spacer()
            } else {
                // Workout card
                workoutCard(day: day, effort: effort, isDone: isDone)
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .background(day.is_today ? Color.white.opacity(0.04) : Color.clear)
    }

    @ViewBuilder
    private func workoutCard(day: PlanDay, effort: FaffEffort, isDone: Bool) -> some View {
        HStack(spacing: 10) {
            // Color bar
            RoundedRectangle(cornerRadius: 2)
                .fill(effort.dot)
                .frame(width: 3, height: 38)

            VStack(alignment: .leading, spacing: 3) {
                Text(effort.title.uppercased())
                    .font(.body(13, weight: .extraBold))
                    .foregroundStyle(Theme.txt)
                if day.distance_mi > 0 {
                    Text("\(formatMi(day.distance_mi)) mi")
                        .font(.body(12, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.55))
                }
            }

            Spacer(minLength: 0)

            if isDone {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color(hex: 0x9AF0BF))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.10), lineWidth: 1))
    }

    // MARK: - Data

    private func loadCalendar() async {
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"
        let today = df.string(from: Date())

        // Load current week + 7 weeks ahead concurrently
        // (back 1 + today + forward 6 = 8 weeks)
        func offsetDate(_ weeks: Int) -> String {
            guard let base = df.date(from: today),
                  let d = Calendar.current.date(byAdding: .day, value: 7 * weeks, to: base)
            else { return today }
            return df.string(from: d)
        }

        async let w0 = (try? await API.fetchPlanWeek(date: offsetDate(-1)))
        async let w1 = (try? await API.fetchPlanWeek(date: offsetDate(0)))
        async let w2 = (try? await API.fetchPlanWeek(date: offsetDate(1)))
        async let w3 = (try? await API.fetchPlanWeek(date: offsetDate(2)))
        async let w4 = (try? await API.fetchPlanWeek(date: offsetDate(3)))
        async let w5 = (try? await API.fetchPlanWeek(date: offsetDate(4)))
        async let w6 = (try? await API.fetchPlanWeek(date: offsetDate(5)))
        async let w7 = (try? await API.fetchPlanWeek(date: offsetDate(6)))

        let fetched = await [w0, w1, w2, w3, w4, w5, w6, w7].compactMap { $0 }

        // Dedupe by week_start_iso, preserve order
        var seen = Set<String>()
        let deduped = fetched.filter { w in
            guard let s = w.week_start_iso else { return false }
            return seen.insert(s).inserted
        }.sorted { ($0.week_start_iso ?? "") < ($1.week_start_iso ?? "") }

        await MainActor.run {
            weeks = deduped
            loading = false
        }
    }

    // MARK: - Helpers

    private func weekRangeLabel(_ week: PlanWeek) -> String {
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"
        let out = DateFormatter(); out.dateFormat = "MMM d"
        guard let s = week.week_start_iso,
              let startDate = df.date(from: s),
              let endDate = Calendar.current.date(byAdding: .day, value: 6, to: startDate)
        else { return week.week_start_iso ?? "" }
        return "\(out.string(from: startDate)) – \(out.string(from: endDate))"
    }

    private func dowLabel(_ i: Int) -> String {
        let labels = ["SUN","MON","TUE","WED","THU","FRI","SAT"]
        return labels[((i % 7) + 7) % 7]
    }

    private func dayNumber(_ iso: String) -> Int {
        Int(iso.split(separator: "-").last.map(String.init) ?? "0") ?? 0
    }

    private func formatMi(_ d: Double) -> String {
        d.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(d))" : String(format: "%.1f", d)
    }
}
