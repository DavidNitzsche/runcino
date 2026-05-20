//
//  Screens.swift
//  Faff
//
//  The tab shell + the non-Today pages (Plan, Coach, Health, More).
//  Light v4. RootTabView fetches /api/overview once and shares it with
//  every tab; the tab bar switches between them.
//

import SwiftUI

// MARK: - Root tab shell

struct RootTabView: View {
    let onLogout: () -> Void

    @State private var overview: OverviewResponse?
    @State private var loadError: String?
    @State private var tab: FaffTab = RootTabView.initialTab
    @State private var showProfile = false
    @State private var showDetail = false
    @State private var showWhy = false
    @Environment(\.scenePhase) private var scenePhase

    /// DEBUG: `-tab plan|coach|health|races` opens that tab for screenshots.
    static var initialTab: FaffTab {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-tab"), i + 1 < args.count,
           let t = FaffTab(rawValue: args[i + 1]) { return t }
        #endif
        return .today
    }

    var body: some View {
        Group {
            if let o = overview, o.ok {
                VStack(spacing: 0) {
                    StickyTopBar(
                        raceName: o.raceCountdown.map { shortRace($0.name) },
                        raceDaysOut: o.raceCountdown?.days,
                        avatarInitial: initial(o),
                        onRaceTap: { tab = .races },
                        onAvatarTap: { showProfile = true }
                    )
                    screen(o)
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    FaffTabBar(active: tab) { tab = $0 }
                }
                .sheet(isPresented: $showProfile) { ProfileView(overview: o, onLogout: onLogout) }
                .sheet(isPresented: $showDetail) { WorkoutDetailView(overview: o) }
                .sheet(isPresented: $showWhy) { WhyThisSheet(overview: o) { showWhy = false; tab = .coach } }
            } else if let loadError {
                FaffStateView(title: "Couldn't load", detail: loadError) { Task { await load() } }
            } else {
                FaffLoadingView()
            }
        }
        .background(Faff.C.bg.ignoresSafeArea())
        .task {
            await load()
            await HealthKitManager.shared.syncIfConnected()
        }
        .onChange(of: scenePhase) { _, p in
            if p == .active {
                Task { await load() }
                Task { await HealthKitManager.shared.syncIfConnected() }
            }
        }
    }

    @ViewBuilder private func screen(_ o: OverviewResponse) -> some View {
        switch tab {
        case .today:  TodayView(overview: o, onWhy: { showWhy = true }, onOpenWorkout: { showDetail = true })
        case .plan:   PlanView(overview: o)
        case .coach:  CoachView(overview: o)
        case .health: HealthView(overview: o)
        case .races:  RacesView(overview: o)
        }
    }

    private func initial(_ o: OverviewResponse) -> String {
        String((o.profileName ?? "F").trimmingCharacters(in: .whitespaces).prefix(1)).uppercased()
    }
    /// Abbreviate a race name to an acronym for the chip (never truncate
    /// mid-word): "Americas Finest City Half" → "AFC". Drops distance/type
    /// words; falls back to a short clip for single-word names.
    private func shortRace(_ n: String) -> String {
        let drop: Set<String> = ["half", "marathon", "10k", "5k", "15k", "mile", "miler", "run", "race", "the"]
        let words = n.split(separator: " ").map(String.init)
        let core = words.filter { !drop.contains($0.lowercased()) }
        if core.count >= 2 {
            let acr = core.compactMap { $0.first }.map(String.init).joined().uppercased()
            return String(acr.prefix(4))
        }
        return n.count > 12 ? String(n.prefix(11)) + "…" : n
    }

    private func load() async {
        loadError = nil
        do { overview = try await OverviewAPI.fetch() }
        catch { if overview == nil { loadError = error.localizedDescription } }
    }
}

// MARK: - Shared loading / error

struct FaffLoadingView: View {
    var body: some View {
        VStack(spacing: 14) {
            Text("FAFF").font(Faff.F.display(48)).italic().tracking(2).foregroundStyle(Color.faffMark)
            ProgressView().tint(Faff.C.race)
            Text("Loading…").font(Faff.F.inter(11, .medium)).tracking(0.5).foregroundStyle(Faff.C.textDim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct FaffStateView: View {
    let title: String; let detail: String; let retry: () -> Void
    var body: some View {
        VStack(spacing: 12) {
            Text(title).font(Faff.F.inter(16, .semibold)).foregroundStyle(Faff.C.ink)
            Text(detail).font(Faff.F.inter(12)).foregroundStyle(Faff.C.textMuted)
                .multilineTextAlignment(.center)
            Button(action: retry) {
                Text("Retry").font(Faff.F.oswald(12)).tracking(1.2).foregroundStyle(Faff.C.race)
            }
        }
        .padding(40).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Page scaffold (eyebrow + big title + scroll)

struct FaffPage<Content: View>: View {
    let eyebrow: String
    let title: String
    @ViewBuilder var content: Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Faff.S.rowGap) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(eyebrow.uppercased()).font(Faff.F.inter(9, .medium)).tracking(2)
                        .foregroundStyle(Faff.C.textDim)
                    Text(title.uppercased()).font(Faff.F.display(34))
                        .foregroundStyle(Faff.C.ink)
                }
                .padding(.bottom, 2)
                content
            }
            .padding(.horizontal, Faff.S.pageEdge).padding(.top, 10).padding(.bottom, 24)
        }
        .background(Faff.C.bg.ignoresSafeArea())
    }
}

private func dowLabel(_ d: Int?) -> String { ["SUN","MON","TUE","WED","THU","FRI","SAT"][(d ?? 0) % 7] }

// MARK: - Plan

struct PlanView: View {
    let overview: OverviewResponse
    @State private var allDays: [PlanRangeDay] = []
    @State private var loaded = false

    var body: some View {
        FaffScreen(eyebrow: "\(overview.planCurrentPhase ?? "Plan") phase · \(weeks.count) weeks", title: "Full Plan") {
            progressCard
            ForEach(weeks) { wk in
                Text("WEEK \(wk.index)\(wk.containsToday ? " · THIS WEEK" : "")")
                    .font(Faff.F.inter(10, .semibold)).tracking(1.6)
                    .foregroundStyle(wk.containsToday ? Faff.C.race : Faff.C.textDim)
                VStack(spacing: 0) {
                    ForEach(Array(wk.days.enumerated()), id: \.offset) { i, d in rangeRow(d, first: i == 0) }
                }.faffCard(padding: 0)
            }
            if !loaded { ProgressView().tint(Faff.C.race).frame(maxWidth: .infinity).padding(.vertical, 20) }
            else if weeks.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("No plan yet. Set a goal race and we'll build your weeks.")
                        .font(Faff.F.inter(13)).foregroundStyle(Faff.C.textMuted)
                }.faffCard()
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard !loaded else { return }
        if let r = try? await PlanRangeAPI.fetch(months: 8) { allDays = r.days ?? [] }
        loaded = true
    }

    // ── Current-week progress (from overview) ─────────────────────
    private var progressCard: some View {
        let days = overview.planWeekWorkouts ?? []
        let work = days.filter { ($0.type ?? "") != "rest" }
        let done = work.filter { overview.isPlanDayDone($0) }.count
        let planned = days.reduce(0.0) { $0 + ($1.distanceMi ?? 0) }
        let frac = work.isEmpty ? 0 : Double(done) / Double(work.count)
        return VStack(spacing: 9) {
            HStack {
                Text("\(done) of \(work.count) done this week").font(Faff.F.inter(12.5)).foregroundStyle(Faff.C.textMuted)
                Spacer()
                (Text("\(Int(planned)) mi ").font(Faff.F.inter(12.5, .bold)).foregroundStyle(Faff.C.ink)
                 + Text("planned").font(Faff.F.inter(12.5)).foregroundStyle(Faff.C.textMuted))
            }
            FaffProgressBar(fraction: frac)
        }.faffCard(padding: 16)
    }

    // ── Group the full plan into weeks ────────────────────────────
    private struct Week: Identifiable {
        let id: String; let index: Int; let days: [PlanRangeDay]; let containsToday: Bool
    }
    private var weeks: [Week] {
        var buckets: [String: [PlanRangeDay]] = [:]
        for d in allDays { if let m = Self.mondayOf(d.date) { buckets[m, default: []].append(d) } }
        var result: [Week] = []
        var idx = 0
        var started = false
        for m in buckets.keys.sorted() {
            let ds = (buckets[m] ?? []).sorted { ($0.date ?? "") < ($1.date ?? "") }
            let hasWork = ds.contains { !$0.isRest }
            if !hasWork { if started { break } else { continue } }   // skip leading rest; stop at trailing rest
            started = true; idx += 1
            result.append(Week(id: m, index: idx, days: ds, containsToday: ds.contains { ($0.isToday ?? false) }))
        }
        return result
    }
    static func mondayOf(_ iso: String?) -> String? {
        guard let iso, iso.count >= 10 else { return nil }
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "UTC")!
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = cal.timeZone
        guard let d = f.date(from: String(iso.prefix(10))) else { return nil }
        let wd = cal.component(.weekday, from: d)        // 1=Sun … 7=Sat
        let offset = wd == 1 ? -6 : -(wd - 2)
        guard let mon = cal.date(byAdding: .day, value: offset, to: d) else { return nil }
        return f.string(from: mon)
    }

    private func rangeRow(_ d: PlanRangeDay, first: Bool) -> some View {
        let isToday = d.isToday ?? false
        let isPast = (d.date ?? "") < (overview.today ?? "")
        let isRest = d.isRest
        let isDone = isDoneRange(d)
        let nameColor = isToday ? Faff.C.amberInk : Faff.C.ink
        return HStack(spacing: 11) {
            statusDot(isToday: isToday, isPast: isPast, isRest: isRest, isDone: isDone).frame(width: 9, height: 9)
            Text(shortDow(d.date)).font(Faff.F.inter(12.5, .semibold))
                .foregroundStyle(isToday ? Faff.C.milestone : Faff.C.textMuted).frame(width: 36, alignment: .leading)
            VStack(alignment: .leading, spacing: 1) {
                Text(isRest ? "Rest" : (d.label ?? "Run")).font(Faff.F.inter(14, .semibold)).foregroundStyle(nameColor)
                Text(rowSub(d, isRest: isRest, isToday: isToday, isDone: isDone)).font(Faff.F.inter(11)).foregroundStyle(Faff.C.textDim)
            }
            Spacer()
            if isDone {
                Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(Faff.C.recovery)
            } else {
                Text(isRest ? "—" : OverviewFormat.distance(d.distanceMi)).font(Faff.F.display(18))
                    .foregroundStyle(isRest ? Faff.C.textFaint : nameColor)
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .overlay(Rectangle().frame(height: 1).foregroundStyle(Faff.C.divider).opacity(first ? 0 : 1), alignment: .top)
    }
    private func isDoneRange(_ d: PlanRangeDay) -> Bool {
        guard !d.isRest, let mi = d.distanceMi, mi > 0, let date = d.date else { return false }
        return (overview.completedByDate?[date] ?? 0) >= mi * 0.6
    }
    @ViewBuilder private func statusDot(isToday: Bool, isPast: Bool, isRest: Bool, isDone: Bool) -> some View {
        if isRest { Circle().stroke(Faff.C.textFaint, lineWidth: 1.5) }
        else if isDone { Circle().fill(Faff.C.recovery) }
        else if isToday { Circle().fill(Faff.C.milestone) }
        else if isPast { Circle().fill(Faff.C.warn.opacity(0.5)) }
        else { Circle().fill(Faff.C.textFaint) }
    }
    private func rowSub(_ d: PlanRangeDay, isRest: Bool, isToday: Bool, isDone: Bool) -> String {
        if isRest { return "recovery" }
        let mi = "\(OverviewFormat.distance(d.distanceMi)) mi"
        if isToday { return "\(mi) · today" }
        if isDone { return "\(mi) · done" }
        return mi
    }
    private func shortDow(_ iso: String?) -> String {
        guard let iso, iso.count >= 10 else { return "" }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "UTC")
        guard let d = f.date(from: String(iso.prefix(10))) else { return "" }
        let out = DateFormatter(); out.dateFormat = "EEE"; out.timeZone = TimeZone(identifier: "UTC")
        return out.string(from: d)
    }
}

// MARK: - Coach (daily read, NOT a chat)

struct CoachView: View {
    let overview: OverviewResponse
    var body: some View {
        let dw = overview.todayWorkout
        return FaffScreen(eyebrow: "Coach", title: "Today's Read") {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Circle().fill(Faff.C.recovery).frame(width: 6, height: 6)
                    Text((overview.briefing?.answer.label ?? "Coach").uppercased())
                        .font(Faff.F.inter(10, .bold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
                }
                faffMarkdown(overview.coachRead)
                    .font(Faff.F.inter(14)).foregroundStyle(Faff.C.ink).lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
            CoachVerdict("Focus", dw.guidance, color: Faff.C.milestone)
            if let acwr = overview.acwrValue, acwr > 1.3 {
                CoachVerdict("Back off if",
                             "Resting HR stays high two mornings, or the legs feel dead — we'll trade the long run for easy miles.",
                             color: Faff.C.warn)
            }
            Text("SIGNALS").font(Faff.F.inter(10, .semibold)).tracking(2).foregroundStyle(Faff.C.textDim)
            VStack(alignment: .leading, spacing: 12) {
                if let acwr = overview.acwrValue {
                    SignalRow("Watching", tone: .amber,
                              String(format: "Acute load is %.0f%% of your 8-week base (ACWR %.2f). Hold easy until it settles under 1.3.", acwr * 100, acwr))
                }
                let bankedMi = (overview.completedByDate ?? [:]).values.reduce(0, +)
                if bankedMi > 0 {
                    SignalRow("On track", tone: .green,
                              String(format: "%.1f mi banked this week at conversational effort.", bankedMi))
                }
            }
            .faffCard()
        }
    }
}

// MARK: - Health (tile dashboard)

struct HealthView: View {
    let overview: OverviewResponse
    @ObservedObject private var hk = HealthKitManager.shared
    @State private var metric: MetricDetailSheet.Metric?

    private struct Tile: Identifiable { let id = UUID(); let label, value: String; let unit, delta: String?; let tone: MetricTile.DeltaTone; let live: Bool }

    var body: some View {
        let r = overview.state?.recovery
        let vitals: [Tile] = [
            Tile(label: "HRV", value: r?.hrv7dAvgMs.map { "\(Int($0))" } ?? "—", unit: r?.hrv7dAvgMs != nil ? "ms" : nil, delta: r?.hrv7dAvgMs != nil ? "7-day avg" : "No data", tone: .good, live: r?.hrv7dAvgMs != nil),
            Tile(label: "Resting HR", value: r?.rhrBpm.map { "\(Int($0))" } ?? "—", unit: r?.rhrBpm != nil ? "bpm" : nil, delta: r?.rhrBpm != nil ? "7-day avg" : "No data", tone: .good, live: r?.rhrBpm != nil),
            Tile(label: "Sleep", value: r?.sleep7dAvgHrs.map { String(format: "%.1f", $0) } ?? "—", unit: r?.sleep7dAvgHrs != nil ? "h" : nil, delta: r?.sleep7dAvgHrs != nil ? "7-day avg" : "No data", tone: .good, live: r?.sleep7dAvgHrs != nil),
            Tile(label: "Respiration", value: "—", unit: nil, delta: "No data", tone: .flat, live: false),
            Tile(label: "VO₂max", value: "—", unit: nil, delta: "No data", tone: .flat, live: false),
            Tile(label: "Wrist temp", value: "—", unit: nil, delta: "No data", tone: .flat, live: false),
        ]
        let dynamics: [Tile] = ["Cadence", "Stride", "Vert Osc", "Grnd Contact", "Vert Ratio", "Run Power"].map {
            Tile(label: $0, value: "—", unit: nil, delta: "No data", tone: .flat, live: false)
        }
        let acwr = overview.acwrValue
        let load: [Tile] = [
            Tile(label: "Load · ACWR", value: acwr.map { String(format: "%.2f", $0) } ?? "—", unit: nil, delta: acwr != nil ? ((acwr ?? 0) > 1.3 ? "watching" : "ok") : "No data", tone: (acwr ?? 0) > 1.3 ? .watch : .good, live: acwr != nil),
            Tile(label: "Volume", value: OverviewFormat.distance(overview.state?.volume?.last7Mi), unit: "mi", delta: "last 7d", tone: .flat, live: true),
            Tile(label: "Form · TSB", value: "—", unit: nil, delta: "No data", tone: .flat, live: false),
        ]

        return FaffScreen(eyebrow: overview.hasHealthData ? "Apple Health · synced" : "Apple Health", title: "Body State") {
            // Hero ring
            HStack(spacing: 14) {
                ReadinessRing(score: overview.readinessScore, tone: TodayView.tone(for: overview.readinessState), size: 70)
                VStack(alignment: .leading, spacing: 7) {
                    Badge(text: badgeText, tone: badgeTone)
                    Text(heroCopy).font(Faff.F.inter(12)).foregroundStyle(Faff.C.textMuted).lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }.faffCard()

            if !overview.hasHealthData { connectControl }

            section("Recovery & Vitals", vitals)
            section("Running Dynamics · last run", dynamics)
            section("Training Load", load)
        }
        .sheet(item: $metric) { MetricDetailSheet(metric: $0, overview: overview) }
    }

    private func section(_ title: String, _ tiles: [Tile]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased()).font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
            MetricGrid(items: tiles) { t in
                MetricTile(label: t.label, value: t.value, unit: t.unit, delta: t.delta, deltaTone: t.tone,
                           onTap: t.live ? { metric = MetricDetailSheet.Metric(title: t.label, value: t.value, unit: t.unit) } : nil)
            }
        }
    }

    private var badgeText: String {
        switch overview.readinessState { case "green": return "Primed"; case "yellow": return "Hold easy"; case "red": return "Back off"; default: return overview.hasHealthData ? "Tracked" : "No data" }
    }
    private var badgeTone: Badge.Tone {
        switch overview.readinessState { case "green": return .green; case "yellow": return .amber; case "red": return .warn; default: return .grey }
    }
    private var heroCopy: String {
        if overview.hasHealthData {
            return "Vitals from Apple Health (7-day average). Acute load is what's holding the score — stay aerobic until it settles."
        }
        return "Connect Apple Health for HRV, resting heart rate, sleep and VO₂max. Until then, readiness reads from training load only."
    }

    @ViewBuilder private var connectControl: some View {
        let busy = hk.status == .requesting || hk.status == .syncing
        VStack(alignment: .leading, spacing: 6) {
            PrimaryButton(title: busy ? "Syncing…" : "Connect Apple Health", icon: "heart.fill") {
                Task { await hk.connectAndSync() }
            }
            if let msg = hk.lastMessage {
                Text(msg).font(Faff.F.inter(11.5)).foregroundStyle(hk.status == .error ? Faff.C.warn : Faff.C.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: - Races (tab) — orange countdown + recent

struct RacesView: View {
    let overview: OverviewResponse
    @State private var showDetail = false
    var body: some View {
        FaffScreen(eyebrow: "Next A-race", title: "Races") {
            if let r = overview.state?.races?.nextA {
                Button { showDetail = true } label: { raceCard(r) }.buttonStyle(.plain)
                    .sheet(isPresented: $showDetail) { RaceDetailView(race: r, phase: overview.planCurrentPhase) }
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    Text("No race yet. Pick your goal and we'll plan backward from race day.")
                        .font(Faff.F.inter(13)).foregroundStyle(Faff.C.textMuted)
                    GhostButton(title: "Add a race", icon: "flag.checkered")
                }.faffCard()
            }
            if let recent = overview.state?.races?.recent, !recent.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    Text("RECENT").font(Faff.F.inter(10, .semibold)).tracking(0.9).foregroundStyle(Faff.C.textDim).padding(.bottom, 4)
                    ForEach(Array(recent.prefix(5).enumerated()), id: \.offset) { _, rr in
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(rr.name ?? "").font(Faff.F.inter(12.5, .semibold)).foregroundStyle(Faff.C.ink)
                                Text("\(rr.date ?? "") · \(OverviewFormat.distance(rr.distanceMi)) mi").font(Faff.F.inter(9)).foregroundStyle(Faff.C.textDim)
                            }
                            Spacer()
                            Text(Self.finish(rr.finishS)).font(Faff.F.display(17)).foregroundStyle(Faff.C.ink)
                        }
                        .padding(.vertical, 9)
                        .overlay(Rectangle().frame(height: 1).foregroundStyle(Faff.C.divider), alignment: .top)
                    }
                }.faffCard()
            }
        }
    }
    private func raceCard(_ r: ORace) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text((r.name ?? "").uppercased()).font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(.white.opacity(0.85))
            Text(RacesView.raceShort(r.name ?? "").uppercased()).font(Faff.F.display(30)).foregroundStyle(.white)
            if let d = r.date { Text(RacesView.prettyDate(d)).font(Faff.F.inter(12, .medium)).foregroundStyle(.white.opacity(0.9)) }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(r.daysAway ?? 0)").font(Faff.F.display(54)).foregroundStyle(.white)
                Text("days out").font(Faff.F.inter(12, .semibold)).foregroundStyle(.white.opacity(0.9))
            }.padding(.top, 2)
            HStack(spacing: 18) {
                raceStat("Goal time", r.goalDisplay ?? "—")
                if let p = RacesView.goalPace(r) { raceStat("Goal pace", p) }
                raceStat("Phase", overview.planCurrentPhase ?? "—")
            }.padding(.top, 8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(Color.faffMark)
        .clipShape(RoundedRectangle(cornerRadius: Faff.R.card, style: .continuous))
    }
    private func raceStat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(Faff.F.display(20)).foregroundStyle(.white)
            Text(label.uppercased()).font(Faff.F.inter(8.5, .semibold)).tracking(0.8).foregroundStyle(.white.opacity(0.8))
        }
    }
    static func finish(_ s: Double?) -> String {
        guard let s, s > 0 else { return "—" }
        let t = Int(s); let h = t / 3600, m = (t % 3600) / 60, sec = t % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
    }
    /// "Americas Finest City Half" → "AFC Half" (acronym + type word).
    static func raceShort(_ name: String) -> String {
        let types: Set<String> = ["half", "marathon", "10k", "5k", "15k", "mile", "miler", "5km", "10km"]
        let words = name.split(separator: " ").map(String.init)
        let typeWord = words.last(where: { types.contains($0.lowercased()) })
        let core = words.filter { !types.contains($0.lowercased()) && $0.lowercased() != "the" }
        let acr = core.count >= 2 ? core.compactMap { $0.first }.map(String.init).joined().uppercased() : (core.first ?? name)
        return typeWord != nil ? "\(acr) \(typeWord!)" : acr
    }
    static func goalPace(_ r: ORace) -> String? {
        guard let g = r.goalDisplay, let mi = r.distanceMi, mi > 0 else { return nil }
        let parts = g.split(separator: ":").compactMap { Int($0) }
        let secs: Int
        switch parts.count { case 3: secs = parts[0]*3600 + parts[1]*60 + parts[2]
                             case 2: secs = parts[0]*60 + parts[1]; default: return nil }
        let per = Int((Double(secs) / mi).rounded())
        return "\(per/60):\(String(format: "%02d", per%60))"
    }
    static func prettyDate(_ iso: String) -> String {
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.timeZone = TimeZone(identifier: "UTC")
        guard let d = inF.date(from: String(iso.prefix(10))) else { return iso }
        let out = DateFormatter(); out.dateFormat = "d MMM yyyy"; out.timeZone = TimeZone(identifier: "UTC")
        return out.string(from: d)
    }
}

// MARK: - Race detail (sheet from a race card)

struct RaceDetailView: View {
    let race: ORace
    let phase: String?
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Faff.S.rowGap) {
                HStack {
                    Text("RACE").font(Faff.F.oswald(13, .semibold)).tracking(1.5).foregroundStyle(Faff.C.ink)
                    Spacer()
                    Button("Done") { dismiss() }.font(Faff.F.inter(13, .semibold)).foregroundStyle(Faff.C.race)
                }.padding(.top, 16)
                VStack(alignment: .leading, spacing: 3) {
                    Text("A-RACE · GOAL \(race.goalDisplay ?? "—")").font(Faff.F.inter(10, .semibold)).tracking(2).foregroundStyle(Faff.C.race)
                    Text(RacesView.raceShort(race.name ?? "").uppercased()).font(Faff.F.display(46)).foregroundStyle(Faff.C.ink)
                    Text(race.name ?? "").font(Faff.F.inter(12)).foregroundStyle(Faff.C.textMuted)
                }
                // Countdown card
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("COUNTDOWN").font(Faff.F.inter(9.5, .semibold)).tracking(1.4).foregroundStyle(.white.opacity(0.85))
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text("\(race.daysAway ?? 0)").font(Faff.F.display(54)).foregroundStyle(.white)
                                Text("days to go").font(Faff.F.inter(12, .semibold)).foregroundStyle(.white.opacity(0.9))
                            }
                        }
                        Spacer()
                        if let p = RacesView.goalPace(race) {
                            VStack(alignment: .trailing, spacing: 4) {
                                Text("GOAL PACE").font(Faff.F.inter(9.5, .semibold)).tracking(1.4).foregroundStyle(.white.opacity(0.85))
                                Text("\(p)/mi").font(Faff.F.display(30)).foregroundStyle(.white)
                            }
                        }
                    }
                    Divider().overlay(Color.white.opacity(0.25))
                    HStack(spacing: 18) {
                        rcStat("Goal time", race.goalDisplay ?? "—")
                        if let d = race.distanceMi { rcStat("Distance", "\(OverviewFormat.distance(d)) mi") }
                        rcStat("Phase", phase ?? "—")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(18)
                .background(Color.faffMark).clipShape(RoundedRectangle(cornerRadius: Faff.R.card, style: .continuous))
                // Honest note for the GPX-dependent sections.
                VStack(alignment: .leading, spacing: 6) {
                    Text("COURSE & PACING").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
                    Text("The course profile, grade band and phase-by-phase pacing build from the race GPX — open this race on faff.run for the full plan. The race-day brief unlocks at T−7.")
                        .font(Faff.F.inter(12.5)).foregroundStyle(Faff.C.textMuted).lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }.faffCard()
            }
            .padding(.horizontal, Faff.S.pageEdge).padding(.bottom, Faff.S.scrollBottom)
        }
        .background(Faff.C.bg.ignoresSafeArea())
    }
    private func rcStat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(Faff.F.display(20)).foregroundStyle(.white)
            Text(label.uppercased()).font(Faff.F.inter(8.5, .semibold)).tracking(0.8).foregroundStyle(.white.opacity(0.85))
        }
    }
}

// MARK: - Profile (sheet from the avatar)

struct ProfileView: View {
    let overview: OverviewResponse
    let onLogout: () -> Void
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("PROFILE").font(Faff.F.oswald(13, .semibold)).tracking(1.5).foregroundStyle(Faff.C.ink)
                Spacer()
                Button("Done") { dismiss() }.font(Faff.F.inter(13, .semibold)).foregroundStyle(Faff.C.race)
            }
            .padding(.horizontal, Faff.S.pageEdge).padding(.top, 18).padding(.bottom, 8)
            ScrollView {
                VStack(alignment: .leading, spacing: Faff.S.rowGap) {
                    HStack(spacing: 14) {
                        FaffAvatar(initial: String((overview.profileName ?? "F").prefix(1)).uppercased(), size: 52)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(overview.profileName ?? "Runner").font(Faff.F.inter(17, .semibold)).foregroundStyle(Faff.C.ink)
                            if let phase = overview.planCurrentPhase {
                                Text("\(phase) phase").font(Faff.F.inter(12)).foregroundStyle(Faff.C.textMuted)
                            }
                        }
                        Spacer()
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        Text("INTEGRATIONS").font(Faff.F.inter(10, .semibold)).tracking(0.9).foregroundStyle(Faff.C.textDim).padding(.bottom, 4)
                        setRow("Apple Health", connected: overview.hasHealthData || (overview.connectors?.contains("apple_health") ?? false))
                        setRow("Strava", connected: overview.connectors?.contains("strava") ?? false)
                        setRow("Apple Watch", connected: false)
                    }.faffCard()
                    Button { onLogout() } label: {
                        Text("SIGN OUT").font(Faff.F.oswald(12, .semibold)).tracking(1.5).foregroundStyle(Faff.C.warn)
                            .frame(maxWidth: .infinity).padding(.vertical, 13)
                            .overlay(RoundedRectangle(cornerRadius: 11).stroke(Faff.C.divider, lineWidth: 1.5))
                    }.buttonStyle(.plain)
                }
                .padding(.horizontal, Faff.S.pageEdge).padding(.bottom, Faff.S.scrollBottom)
            }
        }
        .background(Faff.C.bg.ignoresSafeArea())
    }
    private func setRow(_ name: String, connected: Bool) -> some View {
        HStack {
            Text(name).font(Faff.F.inter(12.5)).foregroundStyle(Faff.C.ink)
            Spacer()
            Badge(text: connected ? "Connected" : "Connect", tone: connected ? .green : .grey)
        }
        .padding(.vertical, 9)
        .overlay(Rectangle().frame(height: 1).foregroundStyle(Faff.C.divider), alignment: .top)
    }
}

// MARK: - Why this (sheet) — read-only rationale

struct WhyThisSheet: View {
    let overview: OverviewResponse
    var onOpenCoach: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        let dw = overview.todayWorkout
        return ScrollView {
            VStack(alignment: .leading, spacing: Faff.S.rowGap) {
                SheetGrabHandle()
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("COACH · WHY THIS WORKOUT").font(Faff.F.inter(10, .semibold)).tracking(2).foregroundStyle(Faff.C.textDim)
                        Text("Why \(dw.label.lowercased())").font(Faff.F.display(34)).foregroundStyle(Faff.C.ink)
                    }
                    Spacer()
                    SheetCloseButton { dismiss() }
                }
                faffMarkdown(overview.composedCoach)
                    .font(Faff.F.inter(15)).foregroundStyle(Faff.C.ink).lineSpacing(5)
                    .fixedSize(horizontal: false, vertical: true)
                CoachVerdict("Focus", dw.guidance, color: Faff.C.milestone)
                if let acwr = overview.acwrValue, acwr > 1.3 {
                    CoachVerdict("Watching",
                                 String(format: "Acute load (ACWR %.2f) is still elevated post-race, which is why today stays easy.", acwr),
                                 color: Faff.C.amberInk)
                }
                PrimaryButton(title: "Open today's coach read", icon: "questionmark.circle") { dismiss(); onOpenCoach() }
            }
            .padding(.horizontal, Faff.S.pageEdge).padding(.bottom, Faff.S.scrollBottom)
        }
        .background(Faff.C.bg.ignoresSafeArea())
    }
}

// MARK: - Metric detail (sheet from a Health tile)

struct MetricDetailSheet: View {
    struct Metric: Identifiable { let id = UUID(); let title: String; let value: String; let unit: String? }
    let metric: Metric
    let overview: OverviewResponse
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Faff.S.rowGap) {
                SheetGrabHandle()
                HStack(alignment: .top) {
                    Text("APPLE HEALTH").font(Faff.F.inter(10, .semibold)).tracking(2).foregroundStyle(Faff.C.textDim)
                    Spacer()
                    SheetCloseButton { dismiss() }
                }
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("\(metric.title) · 7-day average").font(Faff.F.inter(12.5, .semibold)).foregroundStyle(Faff.C.textMuted)
                        Spacer()
                        Badge(text: "Tracked", tone: .green)
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(metric.value).font(Faff.F.display(58)).foregroundStyle(Faff.C.recovery)
                        if let u = metric.unit { Text(u).font(Faff.F.inter(15, .medium)).foregroundStyle(Faff.C.textMuted) }
                    }
                }.faffCard()
                // Trend — honest placeholder until a daily series is wired.
                VStack(spacing: 12) {
                    Segmented(options: ["7D", "30D", "90D"], selected: "30D")
                    Text("30-day trend appears here as more days sync from Apple Health.")
                        .font(Faff.F.inter(11.5)).foregroundStyle(Faff.C.textDim)
                        .frame(maxWidth: .infinity, minHeight: 80, alignment: .center)
                        .multilineTextAlignment(.center)
                }.faffCard()
                CoachVerdict("What this means",
                             "Your 7-day average from Apple Health. Day-to-day trend charts fill in here as more days sync.",
                             color: Faff.C.recovery)
                if let s = overview.readinessScore {
                    HStack(spacing: 12) {
                        ReadinessRing(score: s, tone: TodayView.tone(for: overview.readinessState), size: 42)
                        Text("**Feeds Readiness** — load is what's holding the score at \(s).")
                            .font(Faff.F.inter(12)).foregroundStyle(Faff.C.textMuted)
                        Spacer()
                    }.faffCard()
                }
                relatedTiles
                PrimaryButton(title: "Close", icon: nil) { dismiss() }
            }
            .padding(.horizontal, Faff.S.pageEdge).padding(.bottom, Faff.S.scrollBottom)
        }
        .background(Faff.C.bg.ignoresSafeArea())
    }

    private var relatedTiles: some View {
        struct T: Identifiable { let id = UUID(); let label, value: String; let unit: String? }
        let r = overview.state?.recovery
        let tiles = [
            T(label: "Resting HR", value: r?.rhrBpm.map { "\(Int($0))" } ?? "—", unit: r?.rhrBpm != nil ? "bpm" : nil),
            T(label: "HRV", value: r?.hrv7dAvgMs.map { "\(Int($0))" } ?? "—", unit: r?.hrv7dAvgMs != nil ? "ms" : nil),
            T(label: "Sleep", value: r?.sleep7dAvgHrs.map { String(format: "%.1f", $0) } ?? "—", unit: r?.sleep7dAvgHrs != nil ? "h" : nil),
        ]
        return VStack(alignment: .leading, spacing: 8) {
            Text("RELATED").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
            MetricGrid(items: tiles) { t in
                MetricTile(label: t.label, value: t.value, unit: t.unit,
                           delta: t.value == "—" ? "No data" : "7-day avg", deltaTone: .good)
            }
        }
    }
}
