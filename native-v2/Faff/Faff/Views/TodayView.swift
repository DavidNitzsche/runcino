//
//  TodayView.swift
//  v3 Today tab · effort readout. Mesh re-tints to the selected day's effort.
//
//  Per locked design intent:
//   · Today day card pops MORE, not less (selected day elevates)
//   · 7-day week strip: tapping a day repaints the hero in place (does NOT
//     push the workout detail overlay · that's a Train-only behavior)
//   · Hero is "effort readout", not a slider · labeled pointer on a gradient
//   · Drag-up sheet reveals workout breakdown + conditions + coach
//

import SwiftUI

struct TodayView: View {
    let onProfile: () -> Void

    @State private var plan: PlanWeek?
    @State private var workout: WatchWorkout?
    @State private var readiness: ReadinessSnapshot?
    @State private var briefing: Briefing?
    @State private var selectedDayID: String = ""
    @State private var sheetProgress: Double = 1     // 1 = collapsed
    @State private var skipped: Bool = false

    var body: some View {
        let mesh = selectedEffort.mesh
        ZStack {
            FaffMeshView(mesh: mesh)

            VStack(spacing: 0) {
                PageHeader(title: titleForToday,
                           avatarInitials: "DK",
                           onAvatarTap: onProfile)
                    .padding(.horizontal, 24)
                    .padding(.top, 8)

                if let week = plan {
                    let days = makeStripDays(from: week)
                    WeekStrip(days: days, selectedID: $selectedDayID)
                        .padding(.horizontal, 22)
                        .padding(.top, 12)
                }

                heroBlock
                    .padding(.horizontal, 26)
                    .padding(.top, 28)
                    .opacity(1.0 - sheetProgress * -0 + 0)
                    .opacity(max(0.05, 1.0 - (1 - sheetProgress) * 1.1))
                    .offset(y: -22 * (1 - sheetProgress))

                Spacer(minLength: 0)
            }

            DragSheet(
                collapsedFromTop: 540,
                progress: $sheetProgress,
                header: { peekHeader },
                content: { sheetContent }
            )

            VStack {
                Spacer()
                StickyCTABar(bgColor: Color(hex: 0xFAF7F1)) {
                    NavigationLink(value: FaffRoute.watchMirror) {
                        HStack(spacing: 10) {
                            Circle()
                                .fill(selectedEffort.dot)
                                .frame(width: 11, height: 11)
                                .shadow(color: selectedEffort.dot, radius: 4)
                            Text(startButtonTitle)
                                .font(.body(16.5, weight: .extraBold))
                                .foregroundStyle(.white)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 17)
                        .background(Color(hex: 0x1B1814), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .shadow(color: .black.opacity(0.45), radius: 12, y: 4)
                    }
                    .buttonStyle(.plain)
                }
                .frame(height: 130)
            }
            .ignoresSafeArea(edges: .bottom)
            .opacity(1 - sheetProgress)  // hide when sheet is up; sheet has its own CTA below
        }
        .task {
            await loadAll()
        }
    }

    // MARK: - Hero

    private var heroBlock: some View {
        VStack(alignment: .leading, spacing: 18) {
            // sub label
            SpecLabel(text: subLabel, size: 13, tracking: 0.5, color: Theme.txt.opacity(0.92))
                .textCase(.uppercase)
            // big workout name
            Text(workoutName)
                .displayRecipe(size: 58, weight: .bold)
                .foregroundStyle(Theme.txt)
                .lineSpacing(-12)
                .shadow(color: .black.opacity(0.32), radius: 30, y: 2)

            HStack(spacing: 26) {
                stat(key: "Distance",     value: distanceStr)
                stat(key: "Target Pace",  value: paceStr)
            }
            .padding(.top, 2)

            EffortMeter(
                position: selectedEffort.meterPosition,
                label: selectedEffort.effortLabel.uppercased(),
                height: 6,
                showZones: true
            )
            .padding(.top, 16)
            .frame(maxWidth: 236, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func stat(key: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            SpecLabel(text: key, size: 10, tracking: 1, color: Theme.txt.opacity(0.72))
            Text(value)
                .font(.display(23, weight: .bold))
                .tracking(-0.5)
                .foregroundStyle(Theme.txt)
                .shadow(color: .black.opacity(0.3), radius: 18, y: 1)
        }
    }

    private var peekHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(workoutName.replacingOccurrences(of: "\n", with: " "))
                    .font(.body(18, weight: .extraBold))
                    .tracking(-0.3)
                    .foregroundStyle(Color(hex: 0x14110D))
                Spacer()
                Text(selectedEffort.effortLabel)
                    .font(.body(12, weight: .bold))
                    .foregroundStyle(Color(hex: 0x9A9286))
            }
        }
        .padding(.top, 6)
    }

    private var sheetContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            pBlock(title: "THE SESSION") {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(segments, id: \.0) { (label, desc) in
                        HStack(alignment: .top, spacing: 13) {
                            Rectangle()
                                .fill(selectedEffort.dot)
                                .frame(width: 3)
                                .frame(minHeight: 34)
                                .clipShape(RoundedRectangle(cornerRadius: 3))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(label)
                                    .font(.body(15, weight: .extraBold))
                                    .tracking(-0.2)
                                    .foregroundStyle(Color(hex: 0x14110D))
                                Text(desc)
                                    .font(.body(13))
                                    .foregroundStyle(Color(hex: 0x736C61))
                            }
                        }
                    }
                }
            }

            pBlock(title: "CONDITIONS & KIT") {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 1), GridItem(.flexible(), spacing: 1)], spacing: 1) {
                    infoCell(key: "Weather", value: conditions.weather)
                    infoCell(key: "Shoe",    value: conditions.shoe)
                    infoCell(key: "Fuel",    value: conditions.fuel)
                    infoCell(key: "Effort",  value: selectedEffort.effortLabel)
                }
                .background(Color(hex: 0xEEE7DA))
                .clipShape(RoundedRectangle(cornerRadius: 16))
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Faff Coach")
                    .font(.label(10)).tracking(1.5).textCase(.uppercase)
                    .foregroundStyle(selectedEffort.dot)
                Text(coachNote)
                    .font(.body(14.5, weight: .medium))
                    .foregroundStyle(Color(hex: 0x3C362F))
                    .lineSpacing(4)
            }
            .padding(.horizontal, 24).padding(.vertical, 18)
        }
    }

    private func pBlock<C: View>(title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 13) {
            SpecLabel(text: title, size: 11, tracking: 1.5, color: Color(hex: 0xA39A8C))
            content()
        }
        .padding(.horizontal, 24).padding(.vertical, 18)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color(hex: 0xEEE7DA)).frame(height: 1)
        }
    }

    private func infoCell(key: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SpecLabel(text: key, size: 10, tracking: 1, color: Color(hex: 0xA39A8C))
            Text(value)
                .font(.body(15, weight: .bold))
                .tracking(-0.2)
                .foregroundStyle(Color(hex: 0x14110D))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.white)
    }

    // MARK: - Derived

    private var selectedDayEffort: FaffEffort? {
        guard let week = plan,
              let d = week.days.first(where: { $0.date_iso == selectedDayID })
        else { return nil }
        return FaffEffort.fromType(d.sub_label ?? d.type)
    }

    private var selectedEffort: FaffEffort {
        if skipped { return .rest }
        return selectedDayEffort ?? .easy
    }

    private var subLabel: String {
        switch selectedEffort {
        case .recovery:  return "Easiest · Zone 1"
        case .easy:      return "Easy · Zone 2"
        case .long:      return "Sustained · Z2 → MP"
        case .tempo:     return "Hard · Zone 4 Threshold"
        case .intervals: return "Hardest · Zone 5 VO2"
        case .rest:      return "Rest · Recovery Day"
        case .race:      return "Race Day"
        }
    }

    private var workoutName: String {
        // Use the WatchWorkout's name if today, else derive from PlanDay type.
        if selectedDayID == todayISO, let n = workout?.name {
            // Insert a soft break before the last word if 2+ words
            let words = n.split(separator: " ")
            if words.count >= 2 { return words.dropLast().joined(separator: " ") + "\n" + words.last! }
            return n
        }
        // Fallback to type-derived label
        switch selectedEffort {
        case .recovery:  return "Recovery\nJog"
        case .easy:      return "Easy\nAerobic"
        case .long:      return "Long\nRun"
        case .tempo:     return "Tempo\nRun"
        case .intervals: return "Track\nIntervals"
        case .rest:      return "Rest\nDay"
        case .race:      return "Race\nDay"
        }
    }

    private var distanceStr: String {
        if let dist = todaySelectedDay?.distance_mi { return "\(formatMi(dist)) mi" }
        return "—"
    }

    private var paceStr: String {
        if let phase = workout?.phases.first, let p = phase.targetPaceSPerMi {
            return formatPace(secondsPerMi: p)
        }
        return "—"
    }

    private func formatPace(secondsPerMi: Int) -> String {
        let m = secondsPerMi / 60
        let s = secondsPerMi % 60
        return String(format: "%d:%02d/mi", m, s)
    }

    private var startButtonTitle: String {
        skipped ? "Log Recovery" : "Start \(plainWorkoutName)"
    }

    private var plainWorkoutName: String { workoutName.replacingOccurrences(of: "\n", with: " ") }

    private var todayISO: String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: Date())
    }

    private var todaySelectedDay: PlanDay? {
        plan?.days.first { $0.date_iso == selectedDayID }
    }

    private var titleForToday: String {
        let f = DateFormatter()
        f.dateFormat = "EEEE d"
        let base = f.string(from: Date()).uppercased()
        if selectedDayID.isEmpty { return base }
        if selectedDayID == todayISO { return base }
        guard let day = todaySelectedDay else { return base }
        let iso = day.date_iso.split(separator: "-").compactMap { Int($0) }
        guard iso.count == 3 else { return base }
        let cal = Calendar.current
        if let d = cal.date(from: DateComponents(year: iso[0], month: iso[1], day: iso[2])) {
            return f.string(from: d).uppercased()
        }
        return base
    }

    private var segments: [(String, String)] {
        if let phases = workout?.phases, !phases.isEmpty {
            return phases.map { p in
                let pace = p.targetPaceSPerMi.map { "@ \(formatPace(secondsPerMi: $0))" } ?? ""
                return (p.label, pace)
            }
        }
        // Type-derived fallback
        switch selectedEffort {
        case .recovery:  return [("Steady miles","Nasal-breathing easy")]
        case .easy:      return [("Easy aerobic","Hold Zone 2")]
        case .long:      return [("Aerobic miles","Build into marathon-pace finish")]
        case .tempo:     return [("Warm up","2 mi @ easy"),
                                 ("Threshold","4 mi @ target"),
                                 ("Cool down","2 mi @ easy")]
        case .intervals: return [("Warm up","2 mi + drills"),
                                 ("Intervals","Even-effort reps"),
                                 ("Cool down","1.5 mi easy")]
        case .rest:      return [("Optional","20-30 min easy walk or mobility"),
                                 ("Focus","Sleep, hydration, soft-tissue")]
        case .race:      return [("Race","Execute the plan")]
        }
    }

    private struct Conditions { let weather: String; let shoe: String; let fuel: String }
    private var conditions: Conditions {
        Conditions(weather: "—", shoe: "—", fuel: "Water")
    }

    private var coachNote: String {
        briefing?.lead ?? "Stay in the temperature for the day. The plan is built to adapt to where you are."
    }

    private func makeStripDays(from week: PlanWeek) -> [WeekStripDay] {
        week.days.prefix(7).map { d in
            WeekStripDay(
                id: d.date_iso,
                dow: dowLetter(d.dow),
                date: dayNumber(d.date_iso),
                effort: FaffEffort.fromType(d.sub_label ?? d.type),
                isToday: d.is_today,
                isDone: d.completedRunId != nil
            )
        }
    }

    private func dowLetter(_ i: Int) -> String {
        // Backend dow is 1-based (Mon=1..Sun=7). Be defensive: 0-6 also OK.
        let letters = ["S","M","T","W","T","F","S"]
        return letters[((i % 7) + 7) % 7]
    }
    private func dayNumber(_ iso: String) -> Int {
        Int(iso.split(separator: "-").last.map(String.init) ?? "0") ?? 0
    }
    private func formatMi(_ d: Double) -> String {
        d.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(d))" : String(format: "%.1f", d)
    }

    // MARK: - Loaders

    private func loadAll() async {
        async let p = (try? await API.fetchPlanWeek())
        async let w = (try? await API.fetchWatchWorkout())
        async let r = (try? await API.fetchReadiness())
        async let b = (try? await API.briefing(surface: "today", mode: nil))
        async let s = (try? await API.fetchTodaySkipped()) ?? false

        let (planWeek, watch, ready, brief, skip) = await (p, w, r, b, s)
        await MainActor.run {
            self.plan = planWeek
            self.workout = watch
            self.readiness = ready
            self.briefing = brief
            self.skipped = skip
            if let today = planWeek?.today_iso, selectedDayID.isEmpty { selectedDayID = today }
        }
    }
}

// MARK: - Effort meter position

extension FaffEffort {
    /// Position of the marker on the effort meter (0..1).
    var meterPosition: Double {
        switch self {
        case .rest:      return 0.04
        case .recovery:  return 0.10
        case .easy:      return 0.30
        case .long:      return 0.55
        case .tempo:     return 0.76
        case .intervals: return 0.93
        case .race:      return 0.95
        }
    }
}
