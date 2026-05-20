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
    let overview: OverviewResponse
    let onLogout: () -> Void

    @State private var showDetail = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Faff.S.rowGap) {
                topbar(overview)
                weekStrip(overview)
                Button { showDetail = true } label: { heroCard(overview) }
                    .buttonStyle(.plain)
                actionButtons
                readinessCard(overview)
                CheckInCard()
            }
            .padding(.horizontal, Faff.S.pageEdge)
            .padding(.top, 4)
            .padding(.bottom, 24)
        }
        .background(Faff.C.bg.ignoresSafeArea())
        .sheet(isPresented: $showDetail) {
            WorkoutDetailView(overview: overview)
        }
    }

    // ── Week strip (Runna-style) ──────────────────────────────────
    private func weekStrip(_ o: OverviewResponse) -> some View {
        let days = o.planWeekWorkouts ?? []
        return HStack(spacing: 0) {
            ForEach(Array(days.enumerated()), id: \.offset) { _, day in
                let isToday = day.dateISO == o.today
                VStack(spacing: 6) {
                    Text(dow(day.dow)).font(Faff.F.inter(8.5, .semibold)).tracking(0.5)
                        .foregroundStyle(Faff.C.textDim)
                    Text(dom(day.dateISO)).font(Faff.F.display(18))
                        .foregroundStyle(isToday ? .white : Faff.C.ink)
                        .frame(width: 30, height: 30)
                        .background(isToday ? Faff.C.ink : .clear, in: Circle())
                    Circle().fill(dotColor(day))
                        .frame(width: 5, height: 5)
                        .opacity(hasWork(day) ? 1 : 0)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.vertical, 6)
    }
    private func dow(_ d: Int?) -> String { ["SUN","MON","TUE","WED","THU","FRI","SAT"][(d ?? 0) % 7] }
    private func dom(_ iso: String?) -> String {
        guard let iso, iso.count >= 10 else { return "" }
        return String(Int(iso.suffix(2)) ?? 0)
    }
    private func hasWork(_ d: OPlanDay) -> Bool { (d.type ?? "rest") != "rest" && (d.distanceMi ?? 0) > 0 }
    private func dotColor(_ d: OPlanDay) -> Color {
        guard hasWork(d) else { return .clear }
        return (d.isQuality ?? false) ? Faff.C.race : Faff.C.recovery
    }

    // ── Open / Skip / Substitute ──────────────────────────────────
    private var actionButtons: some View {
        VStack(spacing: 8) {
            Button { showDetail = true } label: {
                HStack(spacing: 7) {
                    Image(systemName: "play.fill").font(.system(size: 11, weight: .bold))
                    Text("Open Workout").font(Faff.F.oswald(12)).tracking(1.3)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 13)
                .foregroundStyle(.white).background(Faff.C.ink)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
            HStack(spacing: 8) {
                ghostButton("Skip Today", icon: "forward.end")
                ghostButton("Substitute", icon: "arrow.left.arrow.right")
            }
        }
    }
    private func ghostButton(_ label: String, icon: String) -> some View {
        Button { } label: {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 10, weight: .bold))
                Text(label).font(Faff.F.oswald(11)).tracking(1.2)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 11)
            .foregroundStyle(Faff.C.ink)
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Faff.C.divider, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
    }

    // ── Topbar ────────────────────────────────────────────────────
    private func topbar(_ o: OverviewResponse?) -> some View {
        HStack {
            Circle().fill(Faff.C.race.opacity(0.14))
                .frame(width: 34, height: 34)
                .overlay(Text(initial(o)).font(Faff.F.inter(14, .bold)).foregroundStyle(Faff.C.race))
                .onLongPressGesture { onLogout() }
            Spacer()
            Text("FAFF").font(Faff.F.display(26)).italic().tracking(2)
                .foregroundStyle(Color.faffMark)
            Spacer()
            Image(systemName: "calendar")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Faff.C.textDim)
                .frame(width: 34, height: 34)
        }
        .padding(.top, 2).padding(.bottom, 2)
    }
    private func initial(_ o: OverviewResponse?) -> String {
        let name = (o?.profileName ?? "Faff").trimmingCharacters(in: .whitespaces)
        return String(name.prefix(1)).uppercased()
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

    // ── Readiness (honest: load-based until Health is connected) ──
    private func readinessCard(_ o: OverviewResponse) -> some View {
        let hasHealth = o.hasHealthData
        let acwr = o.acwrValue
        // Without biometrics, readiness is a load read, not a recovery score.
        let (badgeText, tone): (String, OverviewFormat.ReadinessTone) = {
            guard let a = acwr else { return ("No data", .none) }
            if a > 1.3 { return ("Watch load", .amber) }
            return ("On track", .green)
        }()
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("READINESS")
                    .font(Faff.F.inter(10, .medium)).tracking(0.8)
                    .foregroundStyle(Faff.C.textDim)
                Spacer()
                Badge(text: badgeText, tone: tone)
            }
            Text(readinessCopy(hasHealth: hasHealth, acwr: acwr))
                .font(Faff.F.inter(12.5))
                .foregroundStyle(Faff.C.textMuted)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .faffCard()
    }

    private func readinessCopy(hasHealth: Bool, acwr: Double?) -> String {
        if let a = acwr {
            let load = a > 1.3
                ? String(format: "Load is climbing (ACWR %.2f). Keep easy days easy.", a)
                : String(format: "Training load is balanced (ACWR %.2f).", a)
            return hasHealth ? load
                : load + " Connect Apple Health for HRV, resting HR and sleep."
        }
        return "No recovery data yet. Connect Apple Health for HRV, resting HR and sleep."
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
    var onSelect: (Tab) -> Void = { _ in }
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
                Button { onSelect(t) } label: {
                    VStack(spacing: 3) {
                        Image(systemName: icon(t)).font(.system(size: 18))
                        Text(t.rawValue.uppercased()).font(Faff.F.inter(7.5, .semibold)).tracking(0.3)
                    }
                    .foregroundStyle(t == active ? Faff.C.race : Faff.C.textDim)
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 10).padding(.bottom, 6)
        .frame(maxWidth: .infinity)
        .background(Faff.C.bg)
        .overlay(Rectangle().frame(height: 1).foregroundStyle(Faff.C.divider), alignment: .top)
    }
}

