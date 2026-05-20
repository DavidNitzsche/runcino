//
//  TodayView.swift
//  Faff
//
//  The Today screen — "what now, in two seconds" (docs/native/05 §1).
//  Light v4. Reads real data from GET /api/overview: coach briefing,
//  today's prescribed workout, load-based readiness. Tap the workout to
//  open its detail. Daily check-in at the bottom.
//

import SwiftUI

struct TodayView: View {
    let onLogout: () -> Void

    @State private var overview: OverviewResponse?
    @State private var loadError: String?
    @State private var showDetail = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Faff.S.rowGap) {
                topbar
                content
            }
            .padding(.horizontal, Faff.S.pageEdge)
            .padding(.top, 6)
            .padding(.bottom, 24)
        }
        .background(Faff.C.bg.ignoresSafeArea())
        .safeAreaInset(edge: .bottom, spacing: 0) { FaffTabBar(active: .today) }
        .task { await load() }
        .sheet(isPresented: $showDetail) {
            if let o = overview { WorkoutDetailView(overview: o) }
        }
    }

    private func load() async {
        loadError = nil
        do { overview = try await OverviewAPI.fetch() }
        catch { loadError = error.localizedDescription }
    }

    // ── Content states ────────────────────────────────────────────
    @ViewBuilder private var content: some View {
        if let o = overview, o.ok {
            coachStrip(o)
            Button { showDetail = true } label: { heroCard(o) }
                .buttonStyle(.plain)
            readinessCard(o)
            CheckInCard()
        } else if let loadError {
            stateCard("Couldn't load today", loadError)
        } else if let o = overview, !o.ok {
            stateCard("Couldn't load today", "The coach service returned an error.")
        } else {
            stateCard("Loading today…", nil, spinner: true)
        }
    }

    // ── Topbar ────────────────────────────────────────────────────
    private var topbar: some View {
        HStack {
            Text("FAFF")
                .font(Faff.F.display(20)).italic().tracking(1.5)
                .foregroundStyle(Color.faffMark)
                .onLongPressGesture { onLogout() }
            Spacer()
            Text(dateLabel(overview?.today).uppercased())
                .font(Faff.F.inter(9, .semibold)).tracking(1.3)
                .foregroundStyle(Faff.C.textDim)
        }
        .padding(.top, 2)
    }

    // ── Coach strip ───────────────────────────────────────────────
    private func coachStrip(_ o: OverviewResponse) -> some View {
        let label = o.briefing?.answer.label ?? "COACH"
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Circle().fill(Faff.C.recovery).frame(width: 7, height: 7)
                Text(label.uppercased())
                    .font(Faff.F.inter(10, .semibold)).tracking(1.4)
                    .foregroundStyle(Faff.C.textDim)
            }
            Text(coachBody(o))
                .font(Faff.F.inter(21))
                .foregroundStyle(Faff.C.ink)
                .lineSpacing(5)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 4).padding(.bottom, 2)
    }

    /// Coach line composed from the PLAN workout + race countdown (the
    /// /api/overview briefing text is built from the old engine and can
    /// disagree with the plan, so we summarize the plan ourselves).
    private func coachBody(_ o: OverviewResponse) -> String {
        let dw = o.todayWorkout
        var parts: [String] = []
        if dw.isRest {
            parts.append("Rest day. Let the work absorb.")
        } else {
            parts.append("Today is \(dw.label.lowercased()) at \(distanceStr(dw.distanceMi)) mi. \(dw.guidance)")
        }
        if let rc = o.raceCountdown { parts.append("\(rc.days) days to \(rc.name).") }
        return parts.joined(separator: " ")
    }

    // ── Hero workout card ─────────────────────────────────────────
    private func heroCard(_ o: OverviewResponse) -> some View {
        let dw = o.todayWorkout
        let phase = o.planCurrentPhase ?? "Today"
        return VStack(alignment: .leading, spacing: 0) {
            Text("Today · \(phase)".uppercased())
                .font(Faff.F.inter(9, .medium)).tracking(1.6)
                .foregroundStyle(Faff.C.textDim)
            Text(dw.label.uppercased())
                .font(Faff.F.display(46)).tracking(-1)
                .foregroundStyle(Faff.C.ink)
                .lineSpacing(-6)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4).padding(.bottom, 10)

            HStack(spacing: Faff.S.inlineGap) {
                statPill(value: distanceStr(dw.distanceMi), unit: "mi", label: "Distance")
                statPill(value: OverviewFormat.pace(dw.paceSPerMi),
                         unit: OverviewFormat.paceUnit(dw.paceSPerMi),
                         label: "Pace", accent: dw.isQuality)
                statPill(value: dw.durationMin.map { "~\($0)" } ?? "—", unit: dw.durationMin != nil ? "min" : nil, label: "Time")
            }

            if dw.isQuality {
                StructureBar().padding(.top, 10)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .faffCard()
    }

    // ── Readiness (load-based level + message; honest, no fake score)
    private func readinessCard(_ o: OverviewResponse) -> some View {
        let r = o.readiness?.answer
        let (badgeText, tone) = OverviewFormat.readinessBadge(r?.level)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("READINESS")
                    .font(Faff.F.inter(10, .medium)).tracking(0.8)
                    .foregroundStyle(Faff.C.textDim)
                Spacer()
                Badge(text: badgeText, tone: tone)
            }
            if let msg = r?.message, !msg.isEmpty {
                coachText(msg)
                    .font(Faff.F.inter(12.5))
                    .foregroundStyle(Faff.C.textMuted)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("No recovery data yet. Connect Apple Health for HRV, resting HR and sleep.")
                    .font(Faff.F.inter(12.5))
                    .foregroundStyle(Faff.C.textMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .faffCard()
    }

    // ── State card (loading / error) ──────────────────────────────
    private func stateCard(_ title: String, _ detail: String?, spinner: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if spinner { ProgressView() }
            Text(title).font(Faff.F.inter(14, .semibold)).foregroundStyle(Faff.C.ink)
            if let detail { Text(detail).font(Faff.F.inter(12)).foregroundStyle(Faff.C.textMuted) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .faffCard()
        .padding(.top, 20)
    }

    // ── small helpers ─────────────────────────────────────────────
    private func statPill(value: String, unit: String?, label: String, accent: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value).font(Faff.F.display(21))
                    .foregroundStyle(accent ? Faff.C.race : Faff.C.ink)
                    .lineLimit(1).minimumScaleFactor(0.5)
                if let unit { Text(unit).font(Faff.F.inter(9, .medium)).foregroundStyle(Faff.C.textMuted) }
            }
            Text(label.uppercased()).font(Faff.F.inter(7.5, .medium)).tracking(0.8)
                .foregroundStyle(Faff.C.textDim)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 9).padding(.vertical, 8)
        .background(Faff.C.pillBg)
        .clipShape(RoundedRectangle(cornerRadius: Faff.R.pill, style: .continuous))
    }

    private func distanceStr(_ mi: Double?) -> String {
        guard let mi else { return "—" }
        return mi == mi.rounded() ? String(Int(mi)) : String(format: "%.1f", mi)
    }
    private func planDayToday(_ o: OverviewResponse) -> OPlanDay? {
        o.planWeekWorkouts?.first { $0.dateISO == o.today }
    }
    private func planPaceToday(_ o: OverviewResponse) -> Double? { planDayToday(o)?.paceTargetSPerMi }
    private func planDurationToday(_ o: OverviewResponse) -> Double? { planDayToday(o)?.durationMin }

    private func dateLabel(_ iso: String?) -> String {
        guard let iso else { return "" }
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.timeZone = TimeZone(identifier: "UTC")
        guard let d = inF.date(from: String(iso.prefix(10))) else { return "" }
        let out = DateFormatter(); out.dateFormat = "EEE · d MMM"
        out.timeZone = TimeZone(identifier: "UTC")
        return out.string(from: d)
    }

    /// Render coach copy with **markdown bold** support.
    private func coachText(_ s: String) -> Text {
        if let a = try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
            return Text(a)
        }
        return Text(s)
    }
}

// MARK: - Structure bar (quality days)

private struct StructureBar: View {
    enum Seg { case warm, work, rec, cool }
    private let segs: [Seg] = [.warm, .work, .rec, .work, .rec, .work, .rec, .work, .rec, .work, .rec, .work, .cool]
    private func weight(_ k: Seg) -> CGFloat { switch k { case .warm,.cool: return 1.3; case .work: return 1; case .rec: return 0.5 } }
    private func color(_ k: Seg) -> Color { switch k { case .warm,.cool: return Faff.C.ink.opacity(0.14); case .work: return Faff.C.race; case .rec: return Faff.C.orangeWash } }
    var body: some View {
        GeometryReader { geo in
            let gap: CGFloat = 2
            let total = segs.reduce(0) { $0 + weight($1) }
            let usable = geo.size.width - gap * CGFloat(segs.count - 1)
            HStack(spacing: gap) {
                ForEach(Array(segs.enumerated()), id: \.offset) { _, s in
                    RoundedRectangle(cornerRadius: 2).fill(color(s)).frame(width: usable * weight(s) / total)
                }
            }
        }
        .frame(height: 6)
    }
}

// MARK: - Badge

struct Badge: View {
    let text: String
    let tone: OverviewFormat.ReadinessTone
    private var fg: Color {
        switch tone { case .green: return Faff.C.recovery; case .amber: return Faff.C.milestone
        case .red: return Faff.C.warn; case .none: return Faff.C.textDim }
    }
    private var bg: Color {
        switch tone { case .green: return Faff.C.greenWash; case .amber: return Faff.C.amberWash
        case .red: return Faff.C.warn.opacity(0.12); case .none: return Faff.C.pillBg }
    }
    var body: some View {
        Text(text.uppercased())
            .font(Faff.F.inter(8.5, .bold)).tracking(0.5)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .foregroundStyle(fg).background(bg)
            .clipShape(RoundedRectangle(cornerRadius: Faff.R.chip, style: .continuous))
    }
}

// MARK: - Daily check-in (Energy / Soreness / Stress)

private struct CheckInCard: View {
    @State private var energy: Double = 6
    @State private var soreness: Double = 4
    @State private var stress: Double = 2

    // Softer, distinct hues (not the harsh error-red).
    private let energyColor   = Color(hex: 0x4FA45B)   // calm green
    private let sorenessColor = Color(hex: 0xE0796B)   // soft coral
    private let stressColor   = Color(hex: 0xCBA23C)   // warm ochre

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 5) {
                Text("Today's Check-in · Logged".uppercased())
                    .font(Faff.F.inter(10, .medium)).tracking(1.2)
                    .foregroundStyle(Faff.C.textDim)
                Image(systemName: "checkmark").font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Faff.C.recovery)
                Spacer()
            }
            CheckInRow(label: "Energy",   value: $energy,   color: energyColor)
            CheckInRow(label: "Soreness", value: $soreness, color: sorenessColor)
            CheckInRow(label: "Stress",   value: $stress,   color: stressColor)
            HStack {
                Spacer()
                Button { } label: {
                    Text("UPDATE")
                        .font(Faff.F.oswald(13, .semibold)).tracking(2)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 24).padding(.vertical, 11)
                        .background(Faff.C.ink)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .faffCard()
    }
}

private struct CheckInRow: View {
    let label: String
    @Binding var value: Double
    let color: Color
    var body: some View {
        HStack(spacing: 12) {
            Text(label.uppercased())
                .font(Faff.F.inter(10, .medium)).tracking(0.8)
                .foregroundStyle(Faff.C.textDim)
                .frame(width: 64, alignment: .leading)
            CheckInSlider(value: $value, color: color)
            Text("\(Int(value.rounded()))")
                .font(Faff.F.display(22))
                .foregroundStyle(Faff.C.ink.opacity(0.7))
                .frame(width: 18, alignment: .trailing)
        }
    }
}

private struct CheckInSlider: View {
    @Binding var value: Double   // 0…10
    let color: Color
    private let thumb: CGFloat = 22
    var body: some View {
        GeometryReader { geo in
            let usable = max(0, geo.size.width - thumb)
            let x = usable * CGFloat(min(max(value, 0), 10) / 10)
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(LinearGradient(colors: [color.opacity(0.28), color],
                                         startPoint: .leading, endPoint: .trailing))
                    .frame(height: 7)
                Circle()
                    .fill(.white)
                    .frame(width: thumb, height: thumb)
                    .overlay(Circle().stroke(Faff.C.ink.opacity(0.06), lineWidth: 1))
                    .shadow(color: .black.opacity(0.18), radius: 3, x: 0, y: 1)
                    .offset(x: x)
                    .gesture(DragGesture(minimumDistance: 0).onChanged { g in
                        let nx = min(max(0, g.location.x - thumb / 2), usable)
                        value = (usable > 0 ? Double(nx / usable) : 0) * 10
                    })
            }
            .frame(height: thumb)
            .frame(maxHeight: .infinity, alignment: .center)
        }
        .frame(height: thumb)
    }
}

// MARK: - Tab bar (custom; navigation wired later)

struct FaffTabBar: View {
    enum Tab: String, CaseIterable { case today, plan, coach, health, more }
    let active: Tab
    private func icon(_ t: Tab) -> String {
        switch t {
        case .today: return "house"
        case .plan: return "calendar"
        case .coach: return "questionmark.circle"
        case .health: return "waveform.path.ecg"
        case .more: return "ellipsis"
        }
    }
    var body: some View {
        HStack {
            ForEach(Tab.allCases, id: \.self) { t in
                VStack(spacing: 3) {
                    Image(systemName: icon(t)).font(.system(size: 18))
                    Text(t.rawValue.uppercased()).font(Faff.F.inter(7.5, .semibold)).tracking(0.3)
                }
                .foregroundStyle(t == active ? Faff.C.race : Faff.C.textDim)
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.top, 10).padding(.bottom, 6)
        .frame(maxWidth: .infinity)
        .background(Faff.C.bg)
        .overlay(Rectangle().frame(height: 1).foregroundStyle(Faff.C.divider), alignment: .top)
    }
}

#Preview { TodayView(onLogout: {}) }
