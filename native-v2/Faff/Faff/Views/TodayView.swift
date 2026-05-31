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
    @State private var profile: ProfileState?
    @State private var selectedDayID: String = ""
    @State private var sheetProgress: Double = 1     // 1 = collapsed
    @State private var skipped: Bool = false
    @State private var showNudge: Bool = false
    @State private var refreshing: Bool = false
    @State private var dayWorkout: WatchWorkout?   // workout fetched for a non-today selected day
    @State private var weather: WeatherBaseline?   // forecast vs 14-day baseline · drives the HOTTER THAN USUAL tag

    var body: some View {
        let mesh = selectedEffort.mesh
        ZStack {
            FaffMeshView(mesh: mesh)

            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    SpecLabel(text: titleForToday, size: 13, tracking: 2.5, color: Theme.txt)
                    Spacer()
                    Button {
                        guard !refreshing else { return }
                        refreshing = true
                        Task {
                            await loadAll()
                            await MainActor.run { refreshing = false }
                        }
                    } label: {
                        Image(systemName: "arrow.triangle.2.circlepath")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(refreshing ? 0.4 : 0.85))
                            .frame(width: 28, height: 28)
                            .background(Theme.Glass.fill, in: Circle())
                            .overlay(Circle().stroke(Theme.Glass.line, lineWidth: 1))
                            .rotationEffect(.degrees(refreshing ? 360 : 0))
                            .animation(refreshing ? .linear(duration: 1).repeatForever(autoreverses: false) : .default, value: refreshing)
                    }
                    .buttonStyle(.plain)
                    .disabled(refreshing)

                    Button { showNudge = true } label: {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: "bell.fill")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(Theme.txt)
                                .frame(width: 32, height: 32)
                                .background(Theme.Glass.fill, in: Circle())
                                .overlay(Circle().stroke(Theme.Glass.line, lineWidth: 1))
                            if hasNudge {
                                Circle()
                                    .fill(Theme.race)
                                    .frame(width: 8, height: 8)
                                    .overlay(Circle().stroke(Theme.bg, lineWidth: 1.5))
                                    .offset(x: -2, y: 2)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    Button { onProfile() } label: {
                        Text(avatarInitials)
                            .font(.display(12, weight: .bold))
                            .foregroundStyle(Theme.txt)
                            .frame(width: 32, height: 32)
                            .background(
                                LinearGradient(colors: [Color(hex: 0xFF7A45), Color(hex: 0xD6263C)],
                                               startPoint: .topLeading, endPoint: .bottomTrailing),
                                in: Circle()
                            )
                    }
                    .buttonStyle(.plain)
                }
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
                    NavigationLink(value: ctaRoute) {
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
        .onChange(of: selectedDayID) { _, newID in
            // Tapped a day in the week strip · fetch that day's planned
            // workout so the drag sheet + hero reflect Sunday's long run
            // instead of today's rest day, etc.
            guard !newID.isEmpty else { return }
            Task {
                if newID == todayISO {
                    // Today's workout was already loaded by loadAll().
                    await MainActor.run { dayWorkout = nil }
                } else {
                    let w = try? await API.fetchWatchWorkout(date: newID)
                    await MainActor.run { dayWorkout = w }
                }
            }
        }
        .sheet(isPresented: $showNudge) {
            NudgeSheet(
                onAccept: { showNudge = false },
                onKeep: { showNudge = false },
                readiness: readiness
            )
        }
    }

    /// Pip on the bell when readiness drops materially below baseline.
    /// Threshold: score < 65 (the band where coach intervenes per design).
    private var hasNudge: Bool {
        (readiness?.score ?? 100) < 65
    }

    // MARK: - Hero

    private var heroBlock: some View {
        VStack(alignment: .leading, spacing: 18) {
            // sub label + optional weather tag (drawn inline so it sits on
            // the same baseline as the existing "EASY · 8:30/mi" eyebrow)
            HStack(spacing: 8) {
                SpecLabel(text: subLabel, size: 13, tracking: 0.5, color: Theme.txt.opacity(0.92))
                    .textCase(.uppercase)
                if let tag = weatherTagLabel {
                    Text(tag)
                        .font(.label(9)).tracking(1.5)
                        .foregroundStyle(Color(hex: 0x1C0A02))
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(weatherTagColor, in: RoundedRectangle(cornerRadius: 5))
                }
            }
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
            // Prefer the server-emitted prescription rows when present
            // (briefing.workout_breakdown · PACE / HR CAP / DURATION / FUEL).
            // Falls back to client-derived phases when the briefing didn't
            // emit per-day breakdown rows (rest days, missed states, etc).
            if let rows = briefing?.workout_breakdown, !rows.isEmpty {
                pBlock(title: "PRESCRIPTION") {
                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(rows) { r in
                            HStack(alignment: .top, spacing: 13) {
                                Rectangle()
                                    .fill(selectedEffort.dot)
                                    .frame(width: 3)
                                    .frame(minHeight: 34)
                                    .clipShape(RoundedRectangle(cornerRadius: 3))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(r.label)
                                        .font(.body(15, weight: .extraBold))
                                        .tracking(-0.2)
                                        .foregroundStyle(Color(hex: 0x14110D))
                                    HStack(spacing: 6) {
                                        Text(r.body)
                                            .font(.body(13))
                                            .foregroundStyle(Color(hex: 0x736C61))
                                        if let tail = r.tail, !tail.isEmpty {
                                            Text(tail)
                                                .font(.body(11, weight: .semibold))
                                                .foregroundStyle(Color(hex: 0xA39A8C))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
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
            }

            // FUELING — promoted to its own block (2026-05-30 audit). Server
            // emits prescription.fueling with shortLine / gels / atMins; older
            // surfaces buried this inside a 2x2 conditions grid which lost the
            // detail. Tile renders only when the backend says fueling is needed.
            if let f = displayWorkout?.fueling, f.needed {
                pBlock(title: "FUELING") {
                    VStack(alignment: .leading, spacing: 10) {
                        if !f.shortLine.isEmpty {
                            Text(f.shortLine)
                                .font(.body(15, weight: .extraBold))
                                .tracking(-0.2)
                                .foregroundStyle(Color(hex: 0x14110D))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        HStack(spacing: 18) {
                            fuelStat(key: "GELS",   value: "\(f.gels)")
                            fuelStat(key: "G/HR",   value: "\(f.gPerHr)")
                            fuelStat(key: "TOTAL",  value: "\(f.totalCarbsG) g")
                        }
                        if !f.atMins.isEmpty {
                            HStack(spacing: 6) {
                                SpecLabel(text: "AT MIN", size: 9, tracking: 1.5, color: Color(hex: 0xA39A8C))
                                Text(f.atMins.map(String.init).joined(separator: " · "))
                                    .font(.display(13, weight: .bold))
                                    .foregroundStyle(Color(hex: 0x14110D))
                            }
                        }
                        if !f.why.isEmpty {
                            Text(f.why)
                                .font(.body(11, weight: .medium))
                                .foregroundStyle(Color(hex: 0x736C61))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(hex: 0xEEE7DA))
                    .clipShape(RoundedRectangle(cornerRadius: 16))
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

    /// Inline stat for the FUELING block — small caps label over a single
    /// big number. Lives inline so the gels/g·hr/total row reads as a
    /// quick-glance metric strip, not a sub-table.
    private func fuelStat(key: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            SpecLabel(text: key, size: 9, tracking: 1.2, color: Color(hex: 0xA39A8C))
            Text(value)
                .font(.display(17, weight: .bold))
                .tracking(-0.5)
                .foregroundStyle(Color(hex: 0x14110D))
        }
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

    /// The workout to render in the hero + drag sheet. For the today
    /// selection, prefer `workout` (cached at launch). For any other day
    /// in the strip, use `dayWorkout` fetched on selection change.
    private var displayWorkout: WatchWorkout? {
        if selectedDayID == todayISO { return workout }
        return dayWorkout
    }

    private var workoutName: String {
        // Use the WatchWorkout's name if available, else derive from PlanDay type.
        if let n = displayWorkout?.name {
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
        // Prefer the selected day's planned distance (server-of-truth for
        // future days). Fall back to the watch-workout distanceMi.
        if let dist = todaySelectedDay?.distance_mi, dist > 0 { return "\(formatMi(dist)) mi" }
        if let mi = displayWorkout?.distanceMi { return "\(formatMi(mi)) mi" }
        return "—"
    }

    private var paceStr: String {
        if let phase = displayWorkout?.phases.first, let p = phase.targetPaceSPerMi {
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
        if skipped { return "Log Recovery" }
        if selectedEffort == .rest { return "Log Recovery" }
        if selectedDayID == todayISO { return "Start \(plainWorkoutName)" }
        return "View \(plainWorkoutName)"
    }

    /// Route the CTA pushes to:
    ///   · today + active workout → live (watchMirror)
    ///   · future planned day → planned detail
    ///   · rest day / past completed → planned detail (or run detail in future)
    private var ctaRoute: FaffRoute {
        if selectedDayID == todayISO && selectedEffort != .rest && !skipped {
            return .watchMirror
        }
        if let day = todaySelectedDay, let runId = day.completedRunId {
            return .runDetail(id: runId)
        }
        // Pass the selected day's ISO so PlannedView fetches that day's
        // workout (not always today's).
        return .planned(date: selectedDayID.isEmpty ? nil : selectedDayID)
    }

    private var plainWorkoutName: String { workoutName.replacingOccurrences(of: "\n", with: " ") }

    /// "HOTTER 78°F" / "COOLER 52°F" tag derived from /api/prescription's
    /// weather_baseline. Hidden when the delta from baseline is < 6°F
    /// (Maughan's threshold for meaningful heat impact). Returns nil to
    /// hide the badge entirely.
    private var weatherTagLabel: String? {
        guard let wx = weather, let d = wx.deltaF, let t = wx.tempF else { return nil }
        if abs(d) < 6 { return nil }
        let degrees = Int(t.rounded())
        return d > 0 ? "HOTTER \(degrees)°F" : "COOLER \(degrees)°F"
    }

    /// Background color for the weather tag — race-orange for hotter (it's
    /// a "watch your effort" cue), recovery-cyan for cooler (a "you might
    /// surprise yourself" cue).
    private var weatherTagColor: Color {
        guard let d = weather?.deltaF, d > 0 else { return Color(hex: 0x9AF0BF) }
        return Color(hex: 0xFFD27A)
    }

    private var todayISO: String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: Date())
    }

    private var todaySelectedDay: PlanDay? {
        plan?.days.first { $0.date_iso == selectedDayID }
    }

    /// Derived avatar initials. Prefers profile.identity.full_name; falls
    /// back to the first letter of city; final fallback is "FA" (Faff).
    private var avatarInitials: String {
        if let n = profile?.identity.full_name, !n.isEmpty {
            let parts = n.split(separator: " ")
            let first = parts.first.map(String.init)?.prefix(1) ?? ""
            let last = parts.count > 1 ? String(parts.last!).prefix(1) : ""
            let raw = String(first) + String(last)
            if !raw.isEmpty { return raw.uppercased() }
        }
        if let c = profile?.identity.city, let f = c.first {
            return String(f).uppercased()
        }
        return "FA"
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
        if let phases = displayWorkout?.phases, !phases.isEmpty {
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
        async let pr = (try? await API.fetchProfileState())

        let (planWeek, watch, ready, brief, skip, prof) = await (p, w, r, b, s, pr)
        // Weather baseline runs second-pass — it needs the workout type
        // and weekly mileage from the plan/workout. Fire-and-forget; the
        // HOTTER THAN USUAL tag silently hides if the lookup fails.
        // Derive workout type from today's PlanWeek entry (PlanDay.type is
        // the canonical type string the prescription endpoint expects);
        // WatchWorkout doesn't carry a type field directly.
        let todayType = planWeek?.days.first(where: { $0.is_today })?.type.lowercased() ?? "easy"
        let weeklyMi = Int(planWeek?.days.reduce(0.0) { $0 + $1.distance_mi } ?? 30)
        let wx = try? await API.fetchPrescriptionWeather(type: todayType, weeklyMi: weeklyMi)
        await MainActor.run {
            self.plan = planWeek
            self.workout = watch
            self.readiness = ready
            self.briefing = brief
            self.skipped = skip
            self.profile = prof
            self.weather = wx
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
