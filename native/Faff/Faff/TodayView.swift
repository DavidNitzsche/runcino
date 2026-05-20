//
//  TodayView.swift
//  Faff
//
//  Today tab (handoff §1). Date strip + coach brief + state-driven hero
//  (run vs rest) + readiness + check-in. The sticky brand/avatar/race bar
//  lives in the shell (RootTabView), not here. Real data from
//  /api/overview; tap the hero / Open Workout → Workout detail sheet.
//

import SwiftUI

struct TodayView: View {
    let overview: OverviewResponse
    var onWhy: () -> Void = {}
    var onOpenWorkout: () -> Void = {}

    @State private var selected: String?   // nil = today
    @State private var recapDate: RecapDate?  // non-nil → show run recap sheet
    private struct RecapDate: Identifiable { let id: String }

    private var selDate: String { selected ?? overview.today ?? "" }
    private var selDay: OPlanDay? { overview.planWeekWorkouts?.first { $0.dateISO == selDate } }
    private var isTodaySel: Bool { selDate == overview.today }
    private var isPastSel: Bool { selDate < (overview.today ?? "") }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Faff.S.rowGap) {
                dateStrip(overview)
                coachLineView
                heroView
                if isTodaySel {
                    readinessCard(overview)
                    CheckInCard()
                } else if !isPastSel {
                    previewReadiness
                }
            }
            .padding(.horizontal, Faff.S.pageEdge)
            .padding(.top, Faff.S.scrollTop)
            .padding(.bottom, Faff.S.scrollBottom)
        }
        .background(Faff.C.bg)
        .sheet(item: $recapDate) { d in RunRecapView(date: d.id) }
    }

    @ViewBuilder private var heroView: some View {
        if isTodaySel {
            if overview.todayWorkout.isRest { restHero(overview) } else { runHero(overview) }
        } else if let d = selDay {
            if isPastSel {
                let dw = DerivedWorkout(plan: d, fallback: nil)
                PastDayHero(
                    date: d.dateISO ?? "",
                    eyebrow: eyebrowDate(d.dateISO),
                    title: dw.isRest ? "Rest" : heroTitle(dw),
                    isRest: dw.isRest,
                    plannedMi: d.distanceMi,
                    onOpenRecap: { date in recapDate = RecapDate(id: date) }
                )
            } else { previewHero(d) }
        }
    }
    @ViewBuilder private var coachLineView: some View {
        if isTodaySel { coachBrief(overview) }
        else if let d = selDay {
            Text(dayLine(d)).font(Faff.F.inter(14)).foregroundStyle(Faff.C.ink).lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 2)
        }
    }

    // ── Date strip ────────────────────────────────────────────────
    private func dateStrip(_ o: OverviewResponse) -> some View {
        let days = o.planWeekWorkouts ?? []
        return HStack(spacing: 4) {
            ForEach(Array(days.enumerated()), id: \.offset) { _, day in
                let isToday = day.dateISO == o.today
                let isSel = day.dateISO == selDate
                Button {
                    selected = (day.dateISO == o.today) ? nil : day.dateISO
                } label: {
                    VStack(spacing: 5) {
                        Text(dow(day.dow)).font(Faff.F.inter(9.5, .bold)).tracking(0.5)
                            .foregroundStyle(isSel ? .white : (isToday ? Faff.C.race : Faff.C.textDim))
                        Text(dom(day.dateISO)).font(Faff.F.display(20))
                            .foregroundStyle(isSel ? .white : (isToday ? Faff.C.race : Faff.C.textMuted))
                        statusDot(o, day).frame(width: 5, height: 5)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 7)
                    .background(isSel ? Faff.C.ink : .clear, in: RoundedRectangle(cornerRadius: Faff.R.tile, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: Faff.R.tile)
                            .stroke(Faff.C.race.opacity(0.55), lineWidth: (isToday && !isSel) ? 1.5 : 0)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func dayLine(_ d: OPlanDay) -> String {
        let dw = DerivedWorkout(plan: d, fallback: nil)
        let wd = weekday(d.dateISO)
        if dw.isRest { return "\(wd) is a rest day — recovery is part of the work." }
        let mi = OverviewFormat.distance(d.distanceMi)
        if isPastSel {
            let actual = overview.completedByDate?[d.dateISO ?? ""] ?? 0
            if overview.isPlanDayDone(d) { return "\(wd)'s \(dw.label.lowercased()), logged — \(OverviewFormat.distance(actual)) of \(mi) mi." }
            return "\(wd)'s \(dw.label.lowercased()) — \(mi) mi planned, not logged."
        }
        return "\(wd)'s \(dw.label.lowercased()) — \(mi) mi planned. Tap Open workout for the structure."
    }
    private func weekday(_ iso: String?) -> String {
        guard let iso, iso.count >= 10 else { return "That day" }
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.timeZone = TimeZone(identifier: "UTC")
        guard let dt = inF.date(from: String(iso.prefix(10))) else { return "That day" }
        let out = DateFormatter(); out.dateFormat = "EEEE"; out.timeZone = TimeZone(identifier: "UTC")
        return out.string(from: dt)
    }
    @ViewBuilder private func statusDot(_ o: OverviewResponse, _ d: OPlanDay) -> some View {
        let isRest = (d.type ?? "") == "rest"
        let isToday = d.dateISO == o.today
        let isPast = (d.dateISO ?? "") < (o.today ?? "")
        if isRest {
            Circle().stroke(Faff.C.textFaint, lineWidth: 1.5)
        } else if o.isPlanDayDone(d) {
            Circle().fill(Faff.C.recovery)
        } else if isToday {
            Circle().fill(Faff.C.milestone)
        } else if isPast {
            Circle().fill(Faff.C.warn.opacity(0.5))
        } else {
            Circle().fill(Faff.C.textFaint)
        }
    }
    private func dow(_ d: Int?) -> String { ["S","M","T","W","T","F","S"][(d ?? 0) % 7] }
    private func dom(_ iso: String?) -> String {
        guard let iso, iso.count >= 10 else { return "" }
        return String(Int(iso.suffix(2)) ?? 0)
    }

    // ── Coach brief (no eyebrow on Today — date strip gives context) ──
    private func coachBrief(_ o: OverviewResponse) -> some View {
        faffMarkdown(o.coachRead)
            .font(Faff.F.inter(14)).foregroundStyle(Faff.C.ink).lineSpacing(4)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 2)
    }

    // ── Run hero ──────────────────────────────────────────────────
    private func runHero(_ o: OverviewResponse) -> some View {
        let dw = o.todayWorkout
        let phase = o.planCurrentPhase ?? "Today"
        return Button(action: onOpenWorkout) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    Text("Today · \(phase)".uppercased())
                        .font(Faff.F.inter(10, .semibold)).tracking(1.6).foregroundStyle(Faff.C.textDim)
                    Spacer()
                    WhyChip(action: onWhy)
                }
                Text(heroTitle(dw).uppercased())
                    .font(Faff.F.display(54)).tracking(-0.5)
                    .foregroundStyle(Faff.C.ink).lineLimit(2).minimumScaleFactor(0.6)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 9).padding(.bottom, 15)
                HStack(spacing: Faff.S.inlineGap) {
                    StatPill(value: OverviewFormat.distance(dw.distanceMi), unit: "mi", label: "Distance")
                    StatPill(value: dw.paceDisplay, unit: dw.paceDisplay.contains(":") ? "/mi" : nil,
                             label: "Pace", accent: dw.isQuality)
                    StatPill(value: dw.durationMin.map { "~\($0)" } ?? "—",
                             unit: dw.durationMin != nil ? "min" : nil, label: "Time")
                }
                actionButtons
                    .padding(.top, 12)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .faffCard(padding: 17)
        }
        .buttonStyle(.plain)
    }

    /// Display label for the hero: bare types read better with "Run".
    private func heroTitle(_ dw: DerivedWorkout) -> String {
        switch dw.label.lowercased() {
        case "easy": return "Easy Run"
        case "long": return "Long Run"
        case "recovery": return "Recovery Run"
        default: return dw.label
        }
    }

    private var actionButtons: some View {
        VStack(spacing: 8) {
            PrimaryButton(title: "Open Workout", action: onOpenWorkout)
            HStack(spacing: 8) {
                GhostButton(title: "Skip", icon: "forward.end")
                GhostButton(title: "Substitute", icon: "arrow.left.arrow.right")
            }
        }
    }

    // ── Rest hero ─────────────────────────────────────────────────
    private func restHero(_ o: OverviewResponse) -> some View {
        let phase = o.planCurrentPhase ?? "Today"
        return VStack(alignment: .leading, spacing: 0) {
            Text("Today · \(phase)".uppercased())
                .font(Faff.F.inter(10, .semibold)).tracking(1.6).foregroundStyle(Faff.C.textDim)
            Text("REST").font(Faff.F.display(54)).tracking(-0.5)
                .foregroundStyle(Faff.C.ink).padding(.top, 9).padding(.bottom, 8)
            Text("No run on the schedule today. **Recovery is part of training** — let the body absorb the work from this week and come into the next session fresh.")
                .font(Faff.F.inter(13)).foregroundStyle(Faff.C.textMuted).lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .faffCard(padding: 17)
    }


    // ── Future day · preview hero ─────────────────────────────────
    private func previewHero(_ d: OPlanDay) -> some View {
        let dw = DerivedWorkout(plan: d, fallback: nil)
        let rest = dw.isRest
        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("\(eyebrowDate(d.dateISO)) · PLANNED")
                    .font(Faff.F.inter(10, .semibold)).tracking(1.6).foregroundStyle(Faff.C.textDim)
                Spacer()
                Badge(text: "Upcoming", tone: .grey)
            }
            Text((rest ? "REST" : heroTitle(dw)).uppercased())
                .font(Faff.F.display(54)).tracking(-0.5).foregroundStyle(Faff.C.ink)
                .padding(.top, 9).padding(.bottom, 14)
            if !rest {
                HStack(spacing: Faff.S.inlineGap) {
                    StatPill(value: OverviewFormat.distance(dw.distanceMi), unit: "mi", label: "Distance")
                    StatPill(value: dw.paceDisplay, unit: dw.paceDisplay.contains(":") ? "/mi" : nil, label: "Pace", accent: dw.isQuality)
                    StatPill(value: dw.durationMin.map { "~\($0)" } ?? "—", unit: dw.durationMin != nil ? "min" : nil, label: "Time")
                }
                GhostButton(title: "Open workout") { onOpenWorkout() }.padding(.top, 12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).faffCard(padding: 17)
    }

    private var previewReadiness: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("READINESS").font(Faff.F.inter(10, .semibold)).tracking(0.9).foregroundStyle(Faff.C.textDim)
                Spacer()
                Badge(text: "\(shortWeekday(selDate)) AM", tone: .grey)
            }
            HStack(spacing: 14) {
                ReadinessRing(score: nil, size: 54)
                Text("Your readiness score posts \(weekday(selDate)) morning, once sleep & HRV sync.")
                    .font(Faff.F.inter(12.5)).foregroundStyle(Faff.C.textMuted).lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).faffCard()
    }

    private func eyebrowDate(_ iso: String?) -> String {
        guard let iso, iso.count >= 10 else { return "" }
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.timeZone = TimeZone(identifier: "UTC")
        guard let dt = inF.date(from: String(iso.prefix(10))) else { return "" }
        let out = DateFormatter(); out.dateFormat = "EEE MMM d"; out.timeZone = TimeZone(identifier: "UTC")
        return out.string(from: dt)
    }
    private func shortWeekday(_ iso: String?) -> String {
        guard let iso, iso.count >= 10 else { return "" }
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.timeZone = TimeZone(identifier: "UTC")
        guard let dt = inF.date(from: String(iso.prefix(10))) else { return "" }
        let out = DateFormatter(); out.dateFormat = "EEE"; out.timeZone = TimeZone(identifier: "UTC")
        return out.string(from: dt)
    }

    // ── Readiness ─────────────────────────────────────────────────
    // Real 0–100 score from computeReadinessScore when available; dashed
    // "No data" otherwise. Badge reflects state (or the ACWR load read).
    private func readinessCard(_ o: OverviewResponse) -> some View {
        let acwr = o.acwrValue
        let ringTone = Self.tone(for: o.readinessState)
        let (badgeText, badgeTone): (String, Badge.Tone) = {
            switch o.readinessState {
            case "green": return ("Primed", .green)
            case "yellow": return ("Watch load", .amber)
            case "red": return ("Back off", .warn)
            default:
                guard let a = acwr else { return ("No data", .grey) }
                return a > 1.3 ? ("Watch load", .amber) : ("On track", .green)
            }
        }()
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("READINESS").font(Faff.F.inter(10, .semibold)).tracking(0.9)
                    .foregroundStyle(Faff.C.textDim)
                Spacer()
                Badge(text: badgeText, tone: badgeTone)
            }
            HStack(spacing: 14) {
                ReadinessRing(score: o.readinessScore, tone: ringTone, size: 54)
                Text(readinessCopy(acwr))
                    .font(Faff.F.inter(12.5)).foregroundStyle(Faff.C.textMuted).lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .faffCard()
    }
    static func tone(for state: String?) -> Color {
        switch state {
        case "green": return Faff.C.recovery
        case "yellow": return Faff.C.milestone
        case "red": return Faff.C.warn
        default: return Faff.C.recovery
        }
    }
    private func readinessCopy(_ acwr: Double?) -> String {
        guard let a = acwr else { return "No recovery data yet. Connect Apple Health for HRV, resting HR and sleep." }
        let load = a > 1.3
            ? String(format: "Load is climbing (ACWR %.2f). Keep easy days easy.", a)
            : String(format: "Training load is balanced (ACWR %.2f).", a)
        return load + (o_hasHealth ? "" : " Connect Apple Health for HRV & sleep.")
    }
    private var o_hasHealth: Bool { overview.hasHealthData }
}

// MARK: - Structure bar (quality days) — kept from the prior build

struct StructureBar: View {
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

// MARK: - Daily check-in (Energy / Soreness / Stress) — real data

private struct CheckInCard: View {
    @State private var energy: Double = 5
    @State private var soreness: Double = 3
    @State private var stress: Double = 3
    @State private var logged = false
    @State private var loaded = false
    @State private var saving = false

    private let energyColor   = Color(hex: 0x4FA45B)
    private let sorenessColor = Color(hex: 0xE0796B)
    private let stressColor   = Color(hex: 0xCBA23C)

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 5) {
                Text((logged ? "Today's Check-in · Logged" : "Today's Check-in").uppercased())
                    .font(Faff.F.inter(10, .semibold)).tracking(1.2).foregroundStyle(Faff.C.textDim)
                if logged {
                    Image(systemName: "checkmark").font(.system(size: 9, weight: .bold))
                        .foregroundStyle(Faff.C.recovery)
                } else {
                    Text("· not yet").font(Faff.F.inter(10)).foregroundStyle(Faff.C.textFaint)
                }
                Spacer()
            }
            CheckInRow(label: "Energy",   value: $energy,   color: energyColor)
            CheckInRow(label: "Soreness", value: $soreness, color: sorenessColor)
            CheckInRow(label: "Stress",   value: $stress,   color: stressColor)
            HStack {
                Spacer()
                Button { Task { await save() } } label: {
                    Text(saving ? "SAVING…" : (logged ? "UPDATE" : "LOG CHECK-IN"))
                        .font(Faff.F.oswald(13, .semibold)).tracking(2)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 24).padding(.vertical, 11)
                        .background(saving ? Faff.C.ink.opacity(0.6) : Faff.C.ink)
                        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                }
                .buttonStyle(.plain).disabled(saving)
            }
        }
        .faffCard()
        .task { await load() }
    }

    private func load() async {
        guard !loaded else { return }
        defer { loaded = true }
        // No token guard: /api/checkin serves the legacy 'me' demo row
        // anonymously, so the design-preview round-trips too.
        if let c = try? await FaffAPI.shared.getCheckin() {
            energy = c.energy; soreness = c.soreness; stress = c.stress; logged = true
        } else { logged = false }
    }
    private func save() async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        let e = min(10, max(1, Int(energy.rounded())))
        let s = min(10, max(1, Int(soreness.rounded())))
        let st = min(10, max(1, Int(stress.rounded())))
        if (try? await FaffAPI.shared.postCheckin(energy: e, soreness: s, stress: st)) != nil { logged = true }
    }
}

private struct CheckInRow: View {
    let label: String
    @Binding var value: Double
    let color: Color
    var body: some View {
        HStack(spacing: 12) {
            Text(label.uppercased()).font(Faff.F.inter(10, .medium)).tracking(0.8)
                .foregroundStyle(Faff.C.textDim).frame(width: 64, alignment: .leading)
            CheckInSlider(value: $value, color: color)
            Text("\(Int(value.rounded()))").font(Faff.F.display(21))
                .foregroundStyle(Faff.C.ink.opacity(0.7)).frame(width: 18, alignment: .trailing)
        }
    }
}

private struct CheckInSlider: View {
    @Binding var value: Double
    let color: Color
    private let thumb: CGFloat = 20
    var body: some View {
        GeometryReader { geo in
            let usable = max(0, geo.size.width - thumb)
            let x = usable * CGFloat(min(max(value, 0), 10) / 10)
            ZStack(alignment: .leading) {
                Capsule().fill(LinearGradient(colors: [color.opacity(0.28), color],
                                              startPoint: .leading, endPoint: .trailing)).frame(height: 7)
                Circle().fill(.white).frame(width: thumb, height: thumb)
                    .overlay(Circle().stroke(Faff.C.ink.opacity(0.06), lineWidth: 1))
                    .shadow(color: .black.opacity(0.18), radius: 3, x: 0, y: 1)
                    .offset(x: x)
                    .gesture(DragGesture(minimumDistance: 0).onChanged { g in
                        let nx = min(max(0, g.location.x - thumb / 2), usable)
                        value = (usable > 0 ? Double(nx / usable) : 0) * 10
                    })
            }
            .frame(height: thumb).frame(maxHeight: .infinity, alignment: .center)
        }
        .frame(height: thumb)
    }
}

// ── Past day hero ─────────────────────────────────────────────────
/// A selected past day. Loads the real run from /api/runs/by-date (the
/// source of truth — works around flaky completedByDate detection) so
/// the card shows the true result + a tap into the full recap (route,
/// mile splits, HR). Honest "missed" when nothing synced.
private struct PastDayHero: View {
    let date: String
    let eyebrow: String
    let title: String
    let isRest: Bool
    let plannedMi: Double?
    var onOpenRecap: (String) -> Void

    @State private var run: RunRecap?
    @State private var loaded = false

    var body: some View {
        let done = run != nil
        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("\(eyebrow) · \(isRest ? "REST" : (done ? "DONE" : "MISSED"))")
                    .font(Faff.F.inter(10, .semibold)).tracking(1.6).foregroundStyle(Faff.C.textDim)
                Spacer()
                if !isRest { Badge(text: done ? "On plan" : "Missed", tone: done ? .green : .amber) }
            }
            Text(title.uppercased())
                .font(Faff.F.display(54)).tracking(-0.5).foregroundStyle(Faff.C.ink)
                .padding(.top, 9).padding(.bottom, 14)
            if !isRest {
                HStack(spacing: Faff.S.inlineGap) {
                    StatPill(value: OverviewFormat.distance(plannedMi), unit: "mi", label: "Planned")
                    StatPill(value: done ? OverviewFormat.distance(run?.distanceMi) : "—",
                             unit: done ? "mi" : nil, label: "Ran", accent: done)
                }
                if let r = run {
                    HStack(spacing: Faff.S.inlineGap) {
                        StatPill(value: r.paceDisplay, unit: "/mi", label: "Avg pace")
                        StatPill(value: r.durationDisplay, unit: nil, label: "Time")
                        if let hr = r.avgHr { StatPill(value: "\(Int(hr))", unit: "bpm", label: "Avg HR") }
                    }.padding(.top, Faff.S.inlineGap)
                }
                HStack(spacing: 6) {
                    Text("View full recap").font(Faff.F.inter(12, .semibold)).foregroundStyle(Faff.C.race)
                    Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)).foregroundStyle(Faff.C.race)
                }.padding(.top, 12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).faffCard(padding: 17)
        .contentShape(Rectangle())
        .onTapGesture { if !isRest, !date.isEmpty { onOpenRecap(date) } }
        .task(id: date) { await load() }
    }

    private func load() async {
        guard !isRest, !date.isEmpty else { return }
        run = (try? await RunByDateAPI.fetch(date: date))?.run
        loaded = true
    }
}
