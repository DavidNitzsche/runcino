//
//  TrainingCalendarView.swift
//  Week-by-week training plan calendar. Shows each week as a section
//  with planned workouts per day. Completed days show a checkmark.
//  Accessed via the calendar icon in the global top bar.
//

import SwiftUI

struct TrainingCalendarView: View {
    @State private var weeks: [PlanWeek] = []
    @State private var loading = true
    @State private var scrolledToCurrentWeek = false
    // Strength days from the recommender (training-state · current + next week).
    // PlanWeek itself carries no strength info, so we overlay it here.
    @State private var strengthDays: Set<String> = []
    @State private var strengthDoneDays: Set<String> = []

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()

            VStack(spacing: 0) {
                // Drag pill + title
                VStack(spacing: 10) {
                    Capsule()
                        .fill(Color.white.opacity(0.25))
                        .frame(width: 36, height: 4)
                        .padding(.top, 12)
                    Text("Training Calendar")
                        .font(.body(17, weight: .extraBold))
                        .foregroundStyle(Theme.txt)
                        .padding(.bottom, 8)
                }

                Divider()
                    .background(Color.white.opacity(0.10))

                if loading {
                    Spacer()
                    ProgressView()
                        .tint(Theme.txt.opacity(0.5))
                    Spacer()
                } else {
                    ScrollViewReader { proxy in
                        ScrollView(showsIndicators: false) {
                            LazyVStack(spacing: 0, pinnedViews: []) {
                                ForEach(weeks, id: \.week_start_iso) { week in
                                    weekSection(week)
                                        .id(week.week_start_iso ?? "")
                                }
                            }
                            .padding(.bottom, 120)
                        }
                        .onChange(of: scrolledToCurrentWeek) { _, jumped in
                            guard jumped, let current = currentWeekID else { return }
                            // No animation — lands instantly on current week
                            proxy.scrollTo(current, anchor: .top)
                        }
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
        let doneMi = week.days.reduce(0.0) { $0 + ($1.done_mi ?? 0) }
        let dateRange = weekRangeLabel(week)

        VStack(spacing: 0) {
            // Week header
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(dateRange)
                        .font(.body(14, weight: .extraBold))
                        .foregroundStyle(Theme.txt)
                    if totalMi > 0 {
                        // Progress when the week has activity (run-so-far over
                        // planned); plain planned total for untouched weeks.
                        Text(doneMi > 0.05
                             ? "\(formatMi(doneMi)) / \(formatMi(totalMi)) mi"
                             : "\(formatMi(totalMi)) mi planned")
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
                // Strength can land on a rest-from-running day · keep the
                // marker on the row's right edge, same side as the run rows.
                strengthIcon(for: day.date_iso)
            } else {
                // Workout card (strength dumbbell rides inside, on its right)
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

            strengthIcon(for: day.date_iso)

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

    /// Small dumbbell on the right of a day · the recommender picked this day
    /// for strength (blue) or one was logged (green). Renders nothing on
    /// non-strength days. (David 2026-06-12)
    @ViewBuilder
    private func strengthIcon(for dateIso: String) -> some View {
        if strengthDoneDays.contains(dateIso) {
            Image(systemName: "dumbbell.fill")
                .font(.system(size: 12.5, weight: .bold))
                .foregroundStyle(Color(hex: 0x9AF0BF))
        } else if strengthDays.contains(dateIso) {
            Image(systemName: "dumbbell.fill")
                .font(.system(size: 12.5, weight: .bold))
                .foregroundStyle(Color(hex: 0x27B4E0))
        }
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
        // Strength recommendations ride a separate endpoint (training-state).
        async let ts = (try? await API.fetchTrainingState())

        let fetched = await [w0, w1, w2, w3, w4, w5, w6, w7].compactMap { $0 }

        // Union strength days across the weeks the recommender returns
        // (current + next). Days beyond that simply get no marker.
        var sDays = Set<String>(), sDone = Set<String>()
        if let weeks = await ts?.weeks {
            for w in weeks {
                for d in (w.recommendedStrengthDays ?? []) { sDays.insert(d) }
                for d in (w.completedStrengthDays ?? []) { sDone.insert(d) }
            }
        }

        // Dedupe by week_start_iso, preserve order
        var seen = Set<String>()
        let deduped = fetched.filter { w in
            guard let s = w.week_start_iso else { return false }
            return seen.insert(s).inserted
        }.sorted { ($0.week_start_iso ?? "") < ($1.week_start_iso ?? "") }

        await MainActor.run {
            weeks = deduped
            strengthDays = sDays
            strengthDoneDays = sDone
            loading = false
            // Trigger scroll to current week after the list renders.
            // Small delay lets LazyVStack place the rows before we jump.
            Task {
                try? await Task.sleep(nanoseconds: 80_000_000)
                scrolledToCurrentWeek = true
            }
        }
    }

    // MARK: - Helpers

    /// week_start_iso of the week that contains today, for scroll targeting.
    private var currentWeekID: String? {
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"
        let today = df.string(from: Date())
        return weeks.first(where: { w in
            guard let start = w.week_start_iso else { return false }
            return w.days.contains(where: { $0.date_iso == today || $0.is_today })
                || (start <= today && (w.week_end_iso ?? "") >= today)
        })?.week_start_iso
    }

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
