//
//  Screens.swift
//  Faff
//
//  The tab shell + the non-Today pages (Plan, Coach, Health, More).
//  Light v4. RootTabView fetches /api/overview once and shares it with
//  every tab; the tab bar switches between them.
//

import SwiftUI
import MapKit
import Charts

// MARK: - Root tab shell

struct RootTabView: View {
    let onLogout: () -> Void

    @State private var overview: OverviewResponse?
    @State private var loadError: String?
    @State private var tab: FaffTab = RootTabView.initialTab
    @State private var showProfile = false
    @State private var showDetail = false
    /// Which day the workout-detail sheet should render. nil → today
    /// (default); set to a date when the user taps a future-day preview.
    @State private var detailDate: String? = nil
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
                .sheet(isPresented: $showDetail) {
                    WorkoutDetailView(overview: o, targetDate: detailDate, onReload: { Task { await load() } })
                }
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
        case .today:  TodayView(overview: o, onWhy: { showWhy = true }, onOpenWorkout: { date in detailDate = date; showDetail = true }, onReload: { Task { await load() } })
        case .plan:   PlanView(overview: o)
        case .coach:  CoachView(overview: o)
        case .health: HealthView(overview: o, onReload: { Task { await load() } })
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
    @State private var dayDetail: PlanRangeDay?

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
        .sheet(item: $dayDetail) { PlanDayDetailSheet(day: $0, phase: overview.planCurrentPhase) }
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
        let isDone = d.isDone
        let isSkipped = d.isSkipped
        let isShort = d.isShort && !isSkipped
        let isMissed = isPast && !isRest && !isDone && !isSkipped && !isShort
        // Title is always ink. Orange/amber is reserved for warnings, not for
        // marking "today" — the status dot + check carry that.
        let nameColor = Faff.C.ink
        return Button {
            if !isRest { dayDetail = d }
        } label: {
            HStack(spacing: 11) {
                statusDot(isToday: isToday, isRest: isRest, isDone: isDone, isSkipped: isSkipped, isShort: isShort, isMissed: isMissed).frame(width: 9, height: 9)
                Text(shortDow(d.date)).font(Faff.F.inter(12.5, .semibold))
                    .foregroundStyle(isToday ? Faff.C.ink : Faff.C.textMuted).frame(width: 36, alignment: .leading)
                VStack(alignment: .leading, spacing: 1) {
                    Text(isRest ? "Rest" : (d.label ?? "Run")).font(Faff.F.inter(14, .semibold)).foregroundStyle(nameColor)
                    Text(rowSub(d, isRest: isRest, isToday: isToday, isDone: isDone, isSkipped: isSkipped, isShort: isShort, isMissed: isMissed)).font(Faff.F.inter(11)).foregroundStyle(Faff.C.textDim)
                    // Per-day fuel line — surfaces the gel plan inline on the
                    // Plan list so Sunday's long run shows it without a tap.
                    if let f = d.fueling, f.needed {
                        Text(f.isRehearsal ? "Race rehearsal · \(f.gels) gel\(f.gels == 1 ? "" : "s")" : "Fuel · \(f.gels) gel\(f.gels == 1 ? "" : "s")")
                            .font(Faff.F.inter(10, .semibold)).tracking(0.4)
                            .foregroundStyle(f.isRehearsal ? Faff.C.recovery : Faff.C.textMuted)
                            .padding(.top, 2)
                    }
                }
                Spacer()
                if d.hasStrength == true { StrengthMark(size: 17) }
                if isDone {
                    Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(Faff.C.recovery)
                } else if isShort {
                    Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(Faff.C.milestone)
                } else if isSkipped {
                    Image(systemName: "slash.circle").font(.system(size: 13, weight: .bold)).foregroundStyle(Faff.C.milestone)
                } else {
                    Text(isRest ? ", " : OverviewFormat.distance(d.distanceMi)).font(Faff.F.display(18))
                        .foregroundStyle(isRest ? Faff.C.textFaint : nameColor)
                }
                if !isRest {
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Faff.C.textFaint)
                }
            }
            .padding(.horizontal, 18).padding(.vertical, 12)
            .contentShape(Rectangle())
            .overlay(Rectangle().frame(height: 1).foregroundStyle(Faff.C.divider).opacity(first ? 0 : 1), alignment: .top)
        }
        .buttonStyle(.plain)
    }
    @ViewBuilder private func statusDot(isToday: Bool, isRest: Bool, isDone: Bool, isSkipped: Bool, isShort: Bool, isMissed: Bool) -> some View {
        if isDone { Circle().fill(Faff.C.recovery) }                      // completed
        else if isShort { Circle().fill(Faff.C.milestone) }               // logged but short
        else if isSkipped { Image(systemName: "slash.circle").font(.system(size: 9, weight: .bold)).foregroundStyle(Faff.C.milestone) }  // skipped
        else if isRest { Circle().stroke(Faff.C.textFaint, lineWidth: 1.5) }
        else if isToday { Circle().fill(Faff.C.ink) }
        else if isMissed { Circle().stroke(Faff.C.warn.opacity(0.85), lineWidth: 1.5) }   // missed
        else { Circle().fill(Faff.C.textFaint.opacity(0.6)) }            // upcoming
    }
    private func rowSub(_ d: PlanRangeDay, isRest: Bool, isToday: Bool, isDone: Bool, isSkipped: Bool, isShort: Bool, isMissed: Bool) -> String {
        if isRest { return "recovery" }
        let mi = "\(OverviewFormat.distance(d.distanceMi)) mi"
        // Outcome wins over "today": a run completed earlier today reads DONE,
        // not "today". "today" only shows when nothing's logged yet.
        if isShort { return "\(mi) · short (\(OverviewFormat.distance(d.completedMi))) " }
        if isDone {
            if let actual = d.completedMi { return "\(mi) · done (\(OverviewFormat.distance(actual)))" }
            return "\(mi) · done"
        }
        if isSkipped { return "\(mi) · skipped" }
        if isMissed { return "\(mi) · missed" }
        if isToday { return "\(mi) · today" }
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
                             "Resting HR stays high two mornings, or the legs feel dead, we'll trade the long run for easy miles.",
                             color: Faff.C.warn)
            }
            Text("SIGNALS").font(Faff.F.inter(10, .semibold)).tracking(2).foregroundStyle(Faff.C.textDim)
            VStack(alignment: .leading, spacing: 12) {
                if let acwr = overview.acwrValue {
                    SignalRow("Watching", tone: .amber,
                              String(format: "Your last week is %.0f%% of your 8-week average, that's ramping fast. Hold easy until it settles.", acwr * 100))
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
    @State private var showReadiness = false
    @State private var showAnchorEdit = false
    var onReload: () -> Void = {}

    private struct Tile: Identifiable { let id = UUID(); let label, value: String; let unit, delta: String?; let tone: MetricTile.DeltaTone; let live: Bool; var sampleType: String? = nil }

    var body: some View {
        let r = overview.state?.recovery
        func num(_ v: Double?, _ dec: Int = 0) -> String {
            v.map { dec == 0 ? "\(Int($0.rounded()))" : String(format: "%.\(dec)f", $0) } ?? "-"
        }
        func vital(_ label: String, _ v: Double?, _ unit: String, dec: Int = 0, sub: String, type: String? = nil) -> Tile {
            Tile(label: label, value: num(v, dec), unit: v != nil ? unit : nil,
                 delta: v != nil ? sub : "No data", tone: .good, live: v != nil, sampleType: type)
        }
        func dyn(_ label: String, _ v: Double?, _ unit: String, dec: Int = 0, type: String) -> Tile {
            Tile(label: label, value: num(v, dec), unit: v != nil ? unit : nil,
                 delta: v != nil ? "30d avg" : "No data", tone: .flat, live: v != nil, sampleType: type)
        }
        // Prefer live HealthKit values (read on-device); fall back to the
        // backend 7-day rollup when HealthKit hasn't been read yet.
        let hrv = hk.hrvMs ?? r?.hrv7dAvgMs
        let rhr = hk.restingHrBpm ?? r?.rhrBpm
        let slp = hk.sleepHours ?? r?.sleep7dAvgHrs
        let vitals: [Tile] = [
            vital("HRV", hrv, "ms", sub: "latest", type: "hrv"),
            vital("Resting HR", rhr, "bpm", sub: "latest", type: "resting_hr"),
            vital("Sleep", slp, "h", dec: 1, sub: "last night", type: "sleep_hours"),
            vital("Respiration", hk.respiratoryRate, "br/m", dec: 1, sub: "latest", type: "respiratory_rate"),
            vital("Cardio fitness", hk.vo2Max, "", dec: 1, sub: "latest", type: "vo2_max"),
            vital("Wrist temp", hk.wristTempC, "°C", dec: 1, sub: "sleep", type: "wrist_temp"),
        ]
        let dynamics: [Tile] = [
            dyn("Cadence", hk.cadenceSpm, "spm", type: "cadence"),
            dyn("Stride", hk.strideM, "m", dec: 2, type: "stride_length"),
            dyn("Vert Osc", hk.vertOscCm, "cm", dec: 1, type: "vertical_oscillation"),
            dyn("Grnd Contact", hk.groundContactMs, "ms", type: "ground_contact_time"),
            dyn("Vert Ratio", hk.vertRatioPct, "%", dec: 1, type: "vertical_ratio"),
            Tile(label: "Run Power", value: num(hk.runPowerW), unit: hk.runPowerW != nil ? "W" : nil,
                 delta: (hk.runPowerW != nil && (hk.weightKg ?? 0) > 0) ? String(format: "%.1f W/kg", hk.runPowerW! / hk.weightKg!) : (hk.runPowerW != nil ? "30d avg" : "No data"),
                 tone: .flat, live: hk.runPowerW != nil, sampleType: "run_power"),
        ]
        let body: [Tile] = [
            vital("Weight", hk.weightKg, "kg", dec: 1, sub: "latest", type: "body_mass"),
            vital("Body Fat", hk.bodyFatPct, "%", dec: 1, sub: "latest", type: "body_fat_pct"),
            vital("Lean Mass", hk.leanMassKg, "kg", dec: 1, sub: "latest", type: "lean_mass"),
            vital("HR Recovery", hk.hrRecoveryBpm, "bpm", sub: "1-min drop", type: "hr_recovery"),
            vital("Blood O₂", hk.spo2Pct, "%", dec: 0, sub: "latest", type: "spo2"),
            vital("Active Energy", hk.activeEnergyKcal, "kcal", sub: "today", type: "active_energy"),
        ]
        let acwr = overview.acwrValue
        let loadWord = acwr == nil ? ", "
            : (acwr! > 1.3 ? "Building" : acwr! < 0.8 ? "Easing" : "Steady")
        let load: [Tile] = [
            Tile(label: "Training load", value: loadWord, unit: nil, delta: acwr != nil ? "last 7 vs 28 days" : "No data", tone: (acwr ?? 0) > 1.3 ? .watch : .good, live: acwr != nil),
            Tile(label: "Volume", value: OverviewFormat.distance(overview.state?.volume?.last7Mi), unit: "mi", delta: "last 7d", tone: .flat, live: true),
            Tile(label: "Freshness", value: "-", unit: nil, delta: "No data", tone: .flat, live: false),
        ]

        return FaffScreen(eyebrow: localHealth ? "Apple Health · connected" : "Apple Health", title: "Body State") {
            // Hero ring, tappable → full readiness breakdown.
            Button { showReadiness = true } label: {
                HStack(spacing: 14) {
                    ReadinessRing(score: overview.readinessScore, tone: TodayView.tone(for: overview.readinessState), size: 70)
                    VStack(alignment: .leading, spacing: 7) {
                        HStack(spacing: 6) {
                            Badge(text: badgeText, tone: badgeTone)
                            Spacer()
                            if overview.readinessHasDetail {
                                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Faff.C.textFaint)
                            }
                        }
                        Text(heroCopy).font(Faff.F.inter(12)).foregroundStyle(Faff.C.textMuted).lineSpacing(2)
                            .fixedSize(horizontal: false, vertical: true).multilineTextAlignment(.leading)
                    }
                }.faffCard()
            }.buttonStyle(.plain).disabled(!overview.readinessHasDetail)

            // Connect lives in Profile; only show it here when NOT connected.
            if !localHealth { connectControl }

            if let z = overview.hrZones {
                hrAnchorsCard(z)
                if !z.zones.isEmpty { HrZoneScale(zones: z.zones, framework: z.framework) }
            }
            section("Recovery & Vitals", vitals)
            section("Body Composition", body)
            section("Running Dynamics · 30-day avg", dynamics)
            section("Training Load", load)
        }
        .sheet(item: $metric) { MetricDetailSheet(metric: $0, overview: overview) }
        .sheet(isPresented: $showReadiness) { ReadinessDetailSheet(overview: overview) }
        .sheet(isPresented: $showAnchorEdit) {
            HrAnchorEditSheet(
                maxHr: overview.hrZones?.maxHr.map { Int($0) },
                restingHr: overview.hrZones?.restingHr.map { Int($0) },
                onSaved: { onReload() }
            )
        }
        // Always read whatever HealthKit has authorized so the tiles fill
        // in once access is granted (in Profile), not gated on a flag.
        .task { await hk.refreshDisplayMetrics() }
    }

    /// HealthKit is usable on THIS device, drives the hero + hides the
    /// in-tab connect button (connecting happens in Profile).
    private var localHealth: Bool {
        overview.hasHealthData || hk.hasConnected
            || hk.hrvMs != nil || hk.restingHrBpm != nil || hk.sleepHours != nil
    }

    private func section(_ title: String, _ tiles: [Tile]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased()).font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
            MetricGrid(items: tiles) { t in
                MetricTile(label: t.label, value: t.value, unit: t.unit, delta: t.delta, deltaTone: t.tone,
                           onTap: { metric = MetricDetailSheet.Metric(title: t.label, value: t.value, unit: t.unit, live: t.live, sampleType: t.sampleType, caption: t.live ? t.delta : nil) })
            }
        }
    }

    /// HR anchors, the two numbers every zone keys off. Shows max + resting
    /// HR with their framework and an edit affordance (auto from Apple Health,
    /// overridable).
    private func hrAnchorsCard(_ z: OHrZones) -> some View {
        Button { showAnchorEdit = true } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("HR ANCHORS").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
                    Spacer()
                    Text("Edit").font(Faff.F.inter(12, .semibold)).foregroundStyle(Faff.C.race)
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Faff.C.textFaint)
                }
                HStack(spacing: 14) {
                    anchorCell("MAX HR", z.maxHr.map { "\(Int($0))" } ?? "-", "bpm")
                    anchorCell("RESTING HR", z.restingHr.map { "\(Int($0))" } ?? "-", "bpm")
                    anchorCell("ZONES", z.framework == "HRR" ? "Personalized" : "Standard", z.framework == "HRR" ? "tuned to your resting HR" : "")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .faffCard()
        }.buttonStyle(.plain)
    }
    private func anchorCell(_ label: String, _ value: String, _ unit: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(Faff.F.inter(9.5, .semibold)).tracking(0.8).foregroundStyle(Faff.C.textDim)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value).font(Faff.F.display(24)).foregroundStyle(Faff.C.ink)
                if !unit.isEmpty { Text(unit).font(Faff.F.inter(10)).foregroundStyle(Faff.C.textFaint) }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private var badgeText: String {
        switch overview.readinessState { case "green": return "Primed"; case "yellow": return "Hold easy"; case "red": return "Back off"; default: return localHealth ? "Tracked" : "No data" }
    }
    private var badgeTone: Badge.Tone {
        switch overview.readinessState { case "green": return .green; case "yellow": return .amber; case "red": return .warn; default: return localHealth ? .green : .grey }
    }
    private var heroCopy: String {
        // Real score → the informative, data-driven summary (recommendation +
        // biggest driver). Tap the card for the full breakdown.
        if overview.readinessHasDetail { return overview.readinessSummary }
        if localHealth {
            return "Reading vitals from Apple Health on this device. They sync into your readiness score as days accumulate."
        }
        return "Connect Apple Health for heart-rate variability, resting heart rate, sleep and cardio fitness. Until then, readiness reads from training load only."
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

// MARK: - Races (tab), orange countdown + recent

struct RacesView: View {
    let overview: OverviewResponse
    @State private var races: [RaceSummary] = []
    @State private var loaded = false
    @State private var detail: RaceHeader?

    private var upcoming: [RaceSummary] {
        races.filter { !($0.isPast ?? false) }.sorted { ($0.daysAway ?? 9999) < ($1.daysAway ?? 9999) }
    }
    private var recent: [RaceSummary] {
        races.filter { ($0.isPast ?? false) && ($0.finishS ?? 0) > 0 }
            .sorted { ($0.date ?? "") > ($1.date ?? "") }
    }
    private var hero: RaceSummary? {
        upcoming.first { ($0.priority ?? "A") == "A" } ?? upcoming.first
    }

    var body: some View {
        FaffScreen(eyebrow: "Goal races", title: "Races") {
            if let h = hero {
                Button { detail = RaceHeader(h) } label: { raceCard(h) }.buttonStyle(.plain)
            } else if !loaded {
                HStack(spacing: 8) { ProgressView().scaleEffect(0.8); Text("Loading races…").font(Faff.F.inter(12.5)).foregroundStyle(Faff.C.textMuted) }.faffCard()
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("No race yet. Add a goal race on faff.run and we'll plan backward from race day.")
                        .font(Faff.F.inter(13)).foregroundStyle(Faff.C.textMuted).lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }.faffCard()
            }

            // Upcoming (excluding the hero)
            let restUpcoming = upcoming.filter { $0.slug != hero?.slug }
            if !restUpcoming.isEmpty {
                listCard("UPCOMING") {
                    ForEach(Array(restUpcoming.enumerated()), id: \.element.id) { i, r in
                        if i > 0 { Divider().overlay(Faff.C.divider) }
                        Button { detail = RaceHeader(r) } label: { upcomingRow(r) }.buttonStyle(.plain)
                    }
                }
            }
            // Recent results
            if !recent.isEmpty {
                listCard("RECENT") {
                    ForEach(Array(recent.enumerated()), id: \.element.id) { i, r in
                        if i > 0 { Divider().overlay(Faff.C.divider) }
                        Button { detail = RaceHeader(r) } label: { recentRow(r) }.buttonStyle(.plain)
                    }
                }
            }
        }
        .task { await load() }
        .sheet(item: $detail) { RaceDetailView(header: $0, phase: overview.planCurrentPhase) }
    }

    private func load() async {
        races = (try? await RacesListAPI.fetch()) ?? []
        loaded = true
    }

    // ── Hero (orange countdown card) ──────────────────────────────
    private func raceCard(_ r: RaceSummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 7) {
                Text((r.name ?? "").uppercased()).font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(.white.opacity(0.85))
                priorityChip(r.priority, onDark: true)
                Spacer()
            }
            Text(RacesView.raceShort(r.name ?? "").uppercased()).font(Faff.F.display(30)).foregroundStyle(.white)
            if let d = r.date { Text(RacesView.prettyDate(d)).font(Faff.F.inter(12, .medium)).foregroundStyle(.white.opacity(0.9)) }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(r.daysAway ?? 0)").font(Faff.F.display(54)).foregroundStyle(.white)
                Text("days out").font(Faff.F.inter(12, .semibold)).foregroundStyle(.white.opacity(0.9))
            }.padding(.top, 2)
            HStack(spacing: 18) {
                raceStat("Goal time", r.goalDisplay ?? "-")
                if let p = RacesView.goalPace(r.goalDisplay, r.distanceMi) { raceStat("Goal pace", "\(p)/mi") }
                raceStat("Distance", "\(OverviewFormat.distance(r.distanceMi)) mi")
            }.padding(.top, 8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(Color.faffMark)
        .clipShape(RoundedRectangle(cornerRadius: Faff.R.card, style: .continuous))
    }

    @ViewBuilder
    private func listCard<Content: View>(_ title: String, @ViewBuilder _ rows: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim).padding(.bottom, 8)
            rows()
        }.faffCard()
    }

    private func upcomingRow(_ r: RaceSummary) -> some View {
        HStack(spacing: 11) {
            priorityChip(r.priority, onDark: false)
            VStack(alignment: .leading, spacing: 2) {
                Text(r.name ?? "").font(Faff.F.inter(13.5, .semibold)).foregroundStyle(Faff.C.ink)
                Text("\(RacesView.prettyDate(r.date ?? "")) · \(OverviewFormat.distance(r.distanceMi)) mi")
                    .font(Faff.F.inter(10)).foregroundStyle(Faff.C.textDim)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 1) {
                Text(r.goalDisplay ?? "-").font(Faff.F.display(17)).foregroundStyle(Faff.C.ink)
                Text("\(r.daysAway ?? 0)d away").font(Faff.F.inter(9.5)).foregroundStyle(Faff.C.race)
            }
            Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Faff.C.textFaint)
        }.padding(.vertical, 11).contentShape(Rectangle())
    }

    private func recentRow(_ r: RaceSummary) -> some View {
        HStack(spacing: 11) {
            priorityChip(r.priority, onDark: false)
            VStack(alignment: .leading, spacing: 2) {
                Text(r.name ?? "").font(Faff.F.inter(13.5, .semibold)).foregroundStyle(Faff.C.ink)
                Text("\(RacesView.prettyDate(r.date ?? "")) · \(OverviewFormat.distance(r.distanceMi)) mi")
                    .font(Faff.F.inter(10)).foregroundStyle(Faff.C.textDim)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 1) {
                Text(r.finishDisplay ?? Self.finish(r.finishS)).font(Faff.F.display(18)).foregroundStyle(Faff.C.ink)
                if let p = r.paceDisplay { Text("\(p)/mi").font(Faff.F.inter(9.5)).foregroundStyle(Faff.C.textDim) }
            }
            Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Faff.C.textFaint)
        }.padding(.vertical, 11).contentShape(Rectangle())
    }

    /// A / B / C priority pill, orange / amber / grey (mirrors web).
    @ViewBuilder
    private func priorityChip(_ p: String?, onDark: Bool) -> some View {
        let pr = (p ?? "A").uppercased()
        let letter = ["A", "B", "C"].contains(pr) ? pr : "•"
        let color: Color = pr == "A" ? Faff.C.race : (pr == "B" ? Faff.C.milestone : Faff.C.textDim)
        Text(letter).font(Faff.F.display(12)).foregroundStyle(.white)
            .frame(width: 22, height: 22).background(Circle().fill(color))
            .overlay(Circle().stroke(onDark ? .white.opacity(0.5) : .clear, lineWidth: 1))
    }

    private func raceStat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(Faff.F.display(20)).foregroundStyle(.white)
            Text(label.uppercased()).font(Faff.F.inter(8.5, .semibold)).tracking(0.8).foregroundStyle(.white.opacity(0.8))
        }
    }
    static func finish(_ s: Double?) -> String {
        guard let s, s > 0 else { return ", " }
        let t = Int(s); let h = t / 3600, m = (t % 3600) / 60, sec = t % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
    }
    /// "Americas Finest City Half" → "AFC Half" (acronym + type word).
    static func raceShort(_ name: String) -> String {
        let types: Set<String> = ["half", "marathon", "10k", "5k", "15k", "mile", "miler", "5km", "10km"]
        let words = name.split(separator: " ").map(String.init)
        // A "Half Marathon" IS a half, prefer "Half" over the trailing
        // "Marathon" so "Sombrero Half Marathon" reads "Sombrero Half", not
        // "Sombrero Marathon". Otherwise take the last race-type word.
        let typeWord: String? = words.first(where: { $0.lowercased() == "half" }).map { _ in "Half" }
            ?? words.last(where: { types.contains($0.lowercased()) })
        let core = words.filter { !types.contains($0.lowercased()) && $0.lowercased() != "the" }
        let acr = core.count >= 2 ? core.compactMap { $0.first }.map(String.init).joined().uppercased() : (core.first ?? name)
        return typeWord != nil ? "\(acr) \(typeWord!)" : acr
    }
    static func goalPace(_ goalDisplay: String?, _ distanceMi: Double?) -> String? {
        guard let g = goalDisplay, let mi = distanceMi, mi > 0 else { return nil }
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

/// Lightweight header passed into RaceDetailView (works for upcoming or
/// past races, from ORace or RaceSummary).
struct RaceHeader: Identifiable {
    let slug: String?
    let name: String?
    let date: String?
    let distanceMi: Double?
    let goalDisplay: String?
    let priority: String?
    let daysAway: Int?
    let isPast: Bool
    let finishDisplay: String?
    let paceDisplay: String?
    var id: String { slug ?? (name ?? UUID().uuidString) }

    init(_ r: RaceSummary) {
        slug = r.slug; name = r.name; date = r.date; distanceMi = r.distanceMi
        goalDisplay = r.goalDisplay; priority = r.priority; daysAway = r.daysAway; isPast = r.isPast ?? false
        finishDisplay = r.finishDisplay; paceDisplay = r.paceDisplay
    }
    init(_ r: ORace) {
        slug = r.slug; name = r.name; date = r.date; distanceMi = r.distanceMi
        goalDisplay = r.goalDisplay; priority = "A"; daysAway = r.daysAway; isPast = false
        finishDisplay = nil; paceDisplay = nil
    }
}

// MARK: - Race detail (sheet from a race card)

struct RaceDetailView: View {
    let header: RaceHeader
    let phase: String?
    @Environment(\.dismiss) private var dismiss
    @State private var course: RaceCourse?
    @State private var loadingCourse = true

    private var slug: String {
        header.slug ?? RaceDetailView.slugify(header.name ?? "")
    }
    private var eyebrow: String {
        let pr = (header.priority ?? "A")
        if header.isPast { return "RESULT" }
        return "\(["A","B","C"].contains(pr) ? "\(pr)-RACE" : "RACE") · GOAL \(header.goalDisplay ?? "-")"
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Faff.S.rowGap) {
                HStack {
                    Text(header.isPast ? "RACE RESULT" : "RACE").font(Faff.F.oswald(13, .semibold)).tracking(1.5).foregroundStyle(Faff.C.ink)
                    Spacer()
                    Button("Done") { dismiss() }.font(Faff.F.inter(13, .semibold)).foregroundStyle(Faff.C.race)
                }.padding(.top, 16)
                VStack(alignment: .leading, spacing: 3) {
                    Text(eyebrow).font(Faff.F.inter(10, .semibold)).tracking(2).foregroundStyle(Faff.C.race)
                    Text(RacesView.raceShort(header.name ?? "").uppercased()).font(Faff.F.display(46)).foregroundStyle(Faff.C.ink)
                    Text(header.name ?? "").font(Faff.F.inter(12)).foregroundStyle(Faff.C.textMuted)
                }
                // Countdown (upcoming) or Result (past) card
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(header.isPast ? "FINISH" : "COUNTDOWN").font(Faff.F.inter(9.5, .semibold)).tracking(1.4).foregroundStyle(.white.opacity(0.85))
                            if header.isPast {
                                Text(header.finishDisplay ?? "-").font(Faff.F.display(46)).foregroundStyle(.white)
                            } else {
                                HStack(alignment: .firstTextBaseline, spacing: 6) {
                                    Text("\(header.daysAway ?? 0)").font(Faff.F.display(54)).foregroundStyle(.white)
                                    Text("days to go").font(Faff.F.inter(12, .semibold)).foregroundStyle(.white.opacity(0.9))
                                }
                            }
                        }
                        Spacer()
                        if header.isPast, let p = header.paceDisplay {
                            VStack(alignment: .trailing, spacing: 4) {
                                Text("AVG PACE").font(Faff.F.inter(9.5, .semibold)).tracking(1.4).foregroundStyle(.white.opacity(0.85))
                                Text("\(p)/mi").font(Faff.F.display(30)).foregroundStyle(.white)
                            }
                        } else if let p = RacesView.goalPace(header.goalDisplay, header.distanceMi) {
                            VStack(alignment: .trailing, spacing: 4) {
                                Text("GOAL PACE").font(Faff.F.inter(9.5, .semibold)).tracking(1.4).foregroundStyle(.white.opacity(0.85))
                                Text("\(p)/mi").font(Faff.F.display(30)).foregroundStyle(.white)
                            }
                        }
                    }
                    Divider().overlay(Color.white.opacity(0.25))
                    if header.isPast {
                        HStack(spacing: 18) {
                            rcStat("Goal", header.goalDisplay ?? "-")
                            rcStat("Distance", "\(OverviewFormat.distance(header.distanceMi)) mi")
                            if let d = header.date { rcStat("Date", RacesView.prettyDate(d)) }
                        }
                    } else if let pr = course?.projection, let cv = pr.currentVdot {
                        readinessBlock(pr, cv: cv)
                    } else {
                        HStack(spacing: 18) {
                            rcStat("Goal time", header.goalDisplay ?? "-")
                            rcStat("Distance", "\(OverviewFormat.distance(header.distanceMi)) mi")
                            rcStat("Phase", phase ?? "-")
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(18)
                .background(Color.faffMark).clipShape(RoundedRectangle(cornerRadius: Faff.R.card, style: .continuous))

                // ── Course map + elevation profile ──────────────────
                if let c = course, let coords = c.coords, coords.count > 1 {
                    courseCard(c, coords: coords)
                }
                // ── Phase-by-phase pacing ───────────────────────────
                if let c = course, let phases = c.phases, !phases.isEmpty {
                    pacingCard(phases, strategy: c.strategy)
                    if let f = c.fueling { fuelingCard(f, gels: c.gels ?? []) }
                    if !header.isPast, c.briefGeneratesISO != nil || c.brief != nil { executionCard(c) }
                } else if loadingCourse {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("COURSE & PACING").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
                        HStack(spacing: 8) { ProgressView().scaleEffect(0.8); Text("Loading course…").font(Faff.F.inter(12.5)).foregroundStyle(Faff.C.textMuted) }
                    }.faffCard()
                } else if course?.coords == nil {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("COURSE & PACING").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
                        Text("No course map for this race yet. Add a GPX on faff.run and the profile, grade bands and phase pacing will appear here.")
                            .font(Faff.F.inter(12.5)).foregroundStyle(Faff.C.textMuted).lineSpacing(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }.faffCard()
                }
            }
            .padding(.horizontal, Faff.S.pageEdge).padding(.bottom, Faff.S.scrollBottom)
        }
        .background(Faff.C.bg.ignoresSafeArea())
        .task { await loadCourse() }
    }

    private func loadCourse() async {
        defer { loadingCourse = false }
        course = try? await RaceCourseAPI.fetch(slug: slug)
    }

    // MARK: Course map + elevation profile
    @ViewBuilder
    private func courseCard(_ c: RaceCourse, coords: [[Double]]) -> some View {
        let pts = coords.compactMap { $0.count == 2 ? CLLocationCoordinate2D(latitude: $0[0], longitude: $0[1]) : nil }
        VStack(alignment: .leading, spacing: 12) {
            Text("COURSE").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
            if pts.count > 1 {
                Map(initialPosition: .region(Self.region(for: pts)), interactionModes: []) {
                    MapPolyline(coordinates: pts).stroke(Faff.C.race, lineWidth: 3)
                    Annotation("Start", coordinate: pts.first!) { courseDot(Faff.C.recovery) }
                    Annotation("Finish", coordinate: pts.last!) { courseDot(Faff.C.race) }
                }
                .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
                .frame(height: 170)
                .clipShape(RoundedRectangle(cornerRadius: Faff.R.tile, style: .continuous))
                .allowsHitTesting(false)
            }
            // Net-elevation summary line.
            if let s = c.stats {
                let net = Int(s.netFt ?? 0)
                (Text("\(OverviewFormat.distance(s.distanceMi)) mi").foregroundStyle(Faff.C.ink)
                 + Text("  ·  +\(Int(s.gainFt ?? 0)) / −\(Int(s.lossFt ?? 0)) ft").foregroundStyle(Faff.C.textMuted)
                 + Text("  ·  net \(net >= 0 ? "+" : "−")\(abs(net)) ft \(net <= -40 ? "(fast)" : net >= 40 ? "(climby)" : "")").foregroundStyle(net <= -40 ? Faff.C.recovery : net >= 40 ? Faff.C.warn : Faff.C.textMuted))
                    .font(Faff.F.inter(11.5, .semibold))
            }
            // Elevation profile, area filled by phase.
            if let samples = c.samples, samples.count > 1 {
                elevationProfile(samples, phases: c.phases ?? [])
            }
        }.faffCard()
    }

    private func courseDot(_ color: Color) -> some View {
        Circle().fill(color).frame(width: 11, height: 11)
            .overlay(Circle().stroke(.white, lineWidth: 2))
    }

    /// Elevation profile. The area under the curve is coloured per
    /// PHASE (climb = amber, descent = blue, flat = green), each sample
    /// segment gets its phase's solid colour, so the fill reads as clean
    /// bands that map to the pacing table (no per-segment gradient
    /// striping). Monotone interpolation keeps the curve smooth without
    /// overshoot. The ink line rides on top for definition.
    @ViewBuilder
    private func elevationProfile(_ rawSamples: [RaceCourseSample], phases: [RacePhase]) -> some View {
        // Sort by distance + drop duplicate/backwards x. A non-monotonic or
        // duplicated x makes the AreaMark path self-intersect → white sliver
        // fragments in the fill. Strictly-increasing x renders a clean band.
        let samples: [RaceCourseSample] = {
            var seen = Set<Double>(), out: [RaceCourseSample] = []
            for s in rawSamples.sorted(by: { $0.d < $1.d }) {
                let key = (s.d * 100).rounded() / 100
                if seen.insert(key).inserted { out.append(s) }
            }
            return out
        }()
        let minE = samples.map(\.e).min() ?? 0
        let maxE = samples.map(\.e).max() ?? 1
        let total = max(samples.last?.d ?? 1, 0.0001)
        let pad = max((maxE - minE) * 0.12, 8)
        let base = minE - pad
        Chart {
            ForEach(samples) { s in
                AreaMark(x: .value("Mile", s.d),
                         yStart: .value("base", base),
                         yEnd: .value("Elevation", s.e))
                    .foregroundStyle(Self.phaseColorAt(s.d, phases).opacity(0.24))
                    .interpolationMethod(.linear)
            }
            ForEach(samples) { s in
                LineMark(x: .value("Mile", s.d), y: .value("Elevation", s.e))
                    .foregroundStyle(Faff.C.ink.opacity(0.5))
                    .lineStyle(StrokeStyle(lineWidth: 1.6, lineJoin: .round))
                    .interpolationMethod(.linear)
            }
        }
        .chartXScale(domain: 0...total)
        .chartYScale(domain: base...(maxE + pad))
        .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) { v in
            AxisValueLabel { if let mi = v.as(Double.self) { Text("\(Int(mi))").font(Faff.F.inter(8)).foregroundStyle(Faff.C.textDim) } }
        } }
        .chartYAxis { AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { v in
            AxisValueLabel { if let ft = v.as(Double.self) { Text("\(Int(ft))").font(Faff.F.inter(8)).foregroundStyle(Faff.C.textDim) } }
        } }
        .frame(height: 96)
    }

    /// Phase colour for a given mile, used to band the elevation fill.
    static func phaseColorAt(_ mile: Double, _ phases: [RacePhase]) -> Color {
        let p = phases.first { mile >= ($0.startMi ?? 0) && mile <= ($0.endMi ?? 0) } ?? phases.last
        return gradeColor(p?.meanGradePct ?? 0)
    }

    // MARK: Phase-by-phase pacing
    @ViewBuilder
    private func pacingCard(_ phases: [RacePhase], strategy: String?) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("PHASE-BY-PHASE PACING").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
                Spacer()
                if let st = strategy { Text(Self.strategyLabel(st)).font(Faff.F.inter(9.5, .semibold)).foregroundStyle(Faff.C.textMuted) }
            }
            ForEach(Array(phases.enumerated()), id: \.offset) { i, p in
                phaseRow(i + 1, p)
                if i < phases.count - 1 { Divider().overlay(Faff.C.divider) }
            }
        }.faffCard()
    }

    private func phaseRow(_ n: Int, _ p: RacePhase) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .top, spacing: 10) {
                Text("\(n)").font(Faff.F.display(15)).foregroundStyle(.white)
                    .frame(width: 24, height: 24).background(Circle().fill(Self.gradeColor(p.meanGradePct ?? 0)))
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(p.label ?? "Segment").font(Faff.F.inter(13, .semibold)).foregroundStyle(Faff.C.ink)
                        Text(Self.gradeLabel(p.meanGradePct ?? 0))
                            .font(Faff.F.inter(8.5, .semibold)).tracking(0.2)
                            .foregroundStyle(Self.gradeColor(p.meanGradePct ?? 0))
                            .padding(.horizontal, 7).padding(.vertical, 2.5)
                            .background(Self.gradeWash(p.meanGradePct ?? 0)).clipShape(Capsule())
                    }
                    Text("Mile \(OverviewFormat.distance(p.startMi)) → \(OverviewFormat.distance(p.endMi)) · \(OverviewFormat.distance(p.distanceMi)) mi")
                        .font(Faff.F.inter(10)).foregroundStyle(Faff.C.textDim)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(p.targetPaceDisplay ?? "-").font(Faff.F.display(17)).foregroundStyle(Faff.C.ink)
                    if let t = p.cumulativeTimeDisplay { Text(t).font(Faff.F.inter(9.5)).foregroundStyle(Faff.C.textDim) }
                }
            }
            if let note = p.note, !note.isEmpty {
                Text(note).font(Faff.F.inter(11)).foregroundStyle(Faff.C.textMuted).lineSpacing(1.5)
                    .fixedSize(horizontal: false, vertical: true).padding(.leading, 34)
            }
        }.padding(.vertical, 2)
    }

    // MARK: Fueling
    @ViewBuilder
    private func fuelingCard(_ f: RaceFueling, gels: [RaceGel]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("FUELING").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
                Spacer()
                if let b = f.gelBrand { Text(b.uppercased()).font(Faff.F.inter(9.5, .semibold)).foregroundStyle(Faff.C.textMuted) }
            }
            HStack(spacing: Faff.S.inlineGap) {
                StatPill(value: "\(f.gelCount ?? gels.count)", unit: "gels", label: "Carry")
                StatPill(value: "\(f.totalCarbsG ?? 0)", unit: "g", label: "Total carbs")
                StatPill(value: "\(f.carbTargetGPerHr ?? 0)", unit: "g/hr", label: "Target")
            }
            if !gels.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(gels.enumerated()), id: \.offset) { i, g in
                        if i > 0 { Divider().overlay(Faff.C.divider).padding(.vertical, 9) }
                        HStack(spacing: 10) {
                            Text("\(g.number ?? i + 1)").font(Faff.F.display(13)).foregroundStyle(.white)
                                .frame(width: 22, height: 22).background(Circle().fill(Faff.C.milestone))
                            VStack(alignment: .leading, spacing: 1) {
                                Text(g.label ?? "Gel").font(Faff.F.inter(12.5, .semibold)).foregroundStyle(Faff.C.ink)
                                if let item = g.item { Text(item).font(Faff.F.inter(9.5)).foregroundStyle(Faff.C.textDim) }
                            }
                            Spacer()
                            Text("Mile \(OverviewFormat.distance(g.atMi))").font(Faff.F.display(16)).foregroundStyle(Faff.C.ink)
                        }
                    }
                }
            }
            if let notes = f.notes, !notes.isEmpty {
                Text(notes).font(Faff.F.inter(11)).foregroundStyle(Faff.C.textMuted).lineSpacing(1.5)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }.faffCard()
    }

    // MARK: Race-day execution brief
    @ViewBuilder
    private func executionCard(_ c: RaceCourse) -> some View {
        let genISO = c.briefGeneratesISO
        let daysToBrief = (header.daysAway ?? 0) - 7
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("RACE-DAY EXECUTION").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
                    Text("Race-week brief · packing list · wake-up timing · pre-race fueling")
                        .font(Faff.F.inter(10)).foregroundStyle(Faff.C.textFaint)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                if let g = genISO {
                    (Text("Generates ").foregroundColor(Faff.C.textDim)
                     + Text(Self.shortDate(g)).foregroundColor(Faff.C.ink).bold()
                     + Text(" (T−7d)").foregroundColor(Faff.C.textDim))
                        .font(Faff.F.inter(9.5)).fixedSize()
                }
            }
            if let b = c.brief, let narrative = b.narrative, !narrative.isEmpty {
                Text(narrative).font(Faff.F.inter(13)).foregroundStyle(Faff.C.ink).lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                if let w = b.weatherInput, !w.isEmpty {
                    Text("Weather: \(w)").font(Faff.F.inter(11)).foregroundStyle(Faff.C.textMuted)
                }
                if let adj = b.adjustments, !adj.isEmpty {
                    ForEach(adj) { a in
                        Text("• \(a.reason ?? "")").font(Faff.F.inter(11.5)).foregroundStyle(Faff.C.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("NO DATA YET · HONEST EMPTY STATE")
                        .font(Faff.F.inter(9.5, .semibold)).tracking(1.2).foregroundStyle(Faff.C.amberInk)
                    (Text("The race-day brief, ").foregroundColor(Faff.C.textMuted)
                     + Text("shakeout sequencing, kit layout, wake-up time, pre-race fueling, and weather-adjusted pace tweaks").foregroundColor(Faff.C.ink)
                     + Text(", generates exactly 7 days out from gun time. The coach needs the actual weather window and your taper-week readiness before writing it. Don't plan it now; trust the system.").foregroundColor(Faff.C.textMuted))
                        .font(Faff.F.inter(12.5)).lineSpacing(2).fixedSize(horizontal: false, vertical: true)
                    if let g = genISO {
                        Text("AWAITING \(Self.longDate(g))\(daysToBrief > 0 ? " · \(daysToBrief) DAYS FROM TODAY" : "")")
                            .font(Faff.F.inter(9.5, .semibold)).tracking(0.6).foregroundStyle(Faff.C.amberInk)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Faff.C.amberWash)
                .clipShape(RoundedRectangle(cornerRadius: Faff.R.chip, style: .continuous))
            }
        }.faffCard()
    }

    // MARK: Helpers
    static func shortDate(_ iso: String) -> String {  // "Aug 9"
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.timeZone = TimeZone(identifier: "UTC")
        guard let d = inF.date(from: String(iso.prefix(10))) else { return iso }
        let out = DateFormatter(); out.dateFormat = "MMM d"; out.timeZone = TimeZone(identifier: "UTC")
        return out.string(from: d)
    }
    static func longDate(_ iso: String) -> String {  // "SUN, AUG 9, 2026"
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.timeZone = TimeZone(identifier: "UTC")
        guard let d = inF.date(from: String(iso.prefix(10))) else { return iso.uppercased() }
        let out = DateFormatter(); out.dateFormat = "EEE, MMM d, yyyy"; out.timeZone = TimeZone(identifier: "UTC")
        return out.string(from: d).uppercased()
    }
    static func slugify(_ s: String) -> String {
        let lowered = s.lowercased()
        let mapped = lowered.map { ch -> Character in (ch.isLetter || ch.isNumber) ? ch : "-" }
        let joined = String(mapped)
        let parts = joined.split(separator: "-").map(String.init)
        return parts.joined(separator: "-")
    }
    static func region(for pts: [CLLocationCoordinate2D]) -> MKCoordinateRegion {
        let lats = pts.map(\.latitude), lons = pts.map(\.longitude)
        let minLat = lats.min() ?? 0, maxLat = lats.max() ?? 0
        let minLon = lons.min() ?? 0, maxLon = lons.max() ?? 0
        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2)
        let span = MKCoordinateSpan(
            latitudeDelta: max((maxLat - minLat) * 1.35, 0.01),
            longitudeDelta: max((maxLon - minLon) * 1.35, 0.01))
        return MKCoordinateRegion(center: center, span: span)
    }
    // Phase grade classification, mirrors the web /races/[slug] page
    // (phaseColor + gradeLabel) EXACTLY so the iPhone and web agree.
    enum PhaseTone { case orange, amber, blue, green }
    static func phaseTone(_ g: Double) -> PhaseTone {
        if g >= 2 { return .orange }    // hard climb
        if g >= 0.3 { return .amber }   // gentle climb
        if g <= -1.5 { return .blue }   // descent
        return .green                   // flat / rolling
    }
    static func gradeColor(_ g: Double) -> Color {
        switch phaseTone(g) {
        case .orange: return Faff.C.race        // #E85D26
        case .amber:  return Faff.C.milestone   // #D4900A
        case .blue:   return Faff.C.dataBlue     // #2563EB
        case .green:  return Faff.C.recovery     // #2CA82F
        }
    }
    static func gradeWash(_ g: Double) -> Color {
        switch phaseTone(g) {
        case .orange: return Faff.C.orangeWash
        case .amber:  return Faff.C.amberWash
        case .blue:   return Faff.C.dataBlueWash
        case .green:  return Faff.C.greenWash
        }
    }
    static func gradeLabel(_ g: Double) -> String {
        let v = String(format: "%.1f", g)
        if abs(g) < 0.15 { return "flat 0.0%" }
        if g >= 2 { return "+\(v)% hard climb" }
        if g >= 0.3 { return "+\(v)% climb" }
        if g <= -1.5 { return "\(v)% descent" }
        return "\(g > 0 ? "+" : "")\(v)% rolling"
    }
    static func strategyLabel(_ s: String) -> String {
        switch s {
        case "even_effort": return "EVEN EFFORT"
        case "even_split":  return "EVEN SPLITS"
        case "negative_split": return "NEGATIVE SPLIT"
        default: return s.uppercased()
        }
    }
    private func rcStat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(Faff.F.display(20)).foregroundStyle(.white)
            Text(label.uppercased()).font(Faff.F.inter(8.5, .semibold)).tracking(0.8).foregroundStyle(.white.opacity(0.85))
        }
    }
    /// Mirrors the /races/[slug] web card: projected finish at current
    /// VDOT, goal-required VDOT, and the gap (VDOT + T-pace seconds).
    @ViewBuilder
    private func readinessBlock(_ pr: RaceProjection, cv: Double) -> some View {
        let goalT = pr.goalDisplay ?? header.goalDisplay
        let pSec = Self.parseSecs(pr.predictedDisplay)
        let gSec = Self.parseSecs(goalT)
        let onPace = pr.onPace == true || (pSec != nil && gSec != nil && pSec! <= gSec!)
        VStack(alignment: .leading, spacing: 12) {
            // Projected (now) → Goal comparison.
            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("PROJECTED").font(Faff.F.inter(9, .semibold)).tracking(1.2).foregroundStyle(.white.opacity(0.8))
                    Text(pr.predictedDisplay ?? "-").font(Faff.F.display(26)).foregroundStyle(.white)
                    Text("at fitness score \(String(format: "%.1f", cv))").font(Faff.F.inter(10)).foregroundStyle(.white.opacity(0.8))
                }
                Spacer(minLength: 4)
                Image(systemName: "arrow.right").font(.system(size: 12, weight: .bold)).foregroundStyle(.white.opacity(0.55))
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 2) {
                    Text("GOAL").font(Faff.F.inter(9, .semibold)).tracking(1.2).foregroundStyle(.white.opacity(0.8))
                    Text(goalT ?? "-").font(Faff.F.display(26)).foregroundStyle(.white)
                    if let gv = pr.goalVdot {
                        Text("needs fitness score \(String(format: "%.1f", gv))").font(Faff.F.inter(10)).foregroundStyle(.white.opacity(0.8))
                    }
                }
            }
            // One verdict pill.
            HStack(spacing: 6) {
                Image(systemName: onPace ? "checkmark.circle.fill" : "arrow.up.circle.fill")
                    .font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                Text(Self.verdictText(pr, pSec: pSec, gSec: gSec, onPace: onPace))
                    .font(Faff.F.inter(11.5, .semibold)).foregroundStyle(.white)
            }
            .padding(.horizontal, 11).padding(.vertical, 6)
            .background(Color.white.opacity(0.18)).clipShape(Capsule())
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    static func parseSecs(_ display: String?) -> Int? {
        guard let d = display else { return nil }
        let p = d.split(separator: ":").compactMap { Int($0) }
        switch p.count { case 3: return p[0]*3600 + p[1]*60 + p[2]; case 2: return p[0]*60 + p[1]; default: return nil }
    }
    static func mmss(_ s: Int) -> String { "\(s/60):\(String(format: "%02d", s%60))" }
    static func verdictText(_ pr: RaceProjection, pSec: Int?, gSec: Int?, onPace: Bool) -> String {
        if onPace, let p = pSec, let g = gSec, g >= p { return "On pace, beats goal by \(mmss(g - p))" }
        if let gap = pr.vdotGap {
            let pace = pr.paceTGapS.map { " · ~\(Int(abs($0)))s/mi" } ?? ""
            return "\(String(format: "%.1f", abs(gap))) fitness points to find\(pace)"
        }
        return "Building toward goal"
    }
}

// MARK: - Profile (sheet from the avatar)

struct ProfileView: View {
    let overview: OverviewResponse
    let onLogout: () -> Void
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var watch = WatchSync.shared
    @ObservedObject private var health = HealthKitManager.shared
    @State private var shoes: [Shoe] = []
    @State private var shoesLoaded = false
    @State private var shoeEdit: ShoeEditTarget?
    struct ShoeEditTarget: Identifiable { let id = UUID(); let shoe: Shoe? }

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
                    // Identity
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
                    trainingCard
                    shoeCard
                    VStack(alignment: .leading, spacing: 0) {
                        Text("INTEGRATIONS").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim).padding(.bottom, 8)
                        // Apple Health, connect right here (tap → HealthKit auth + sync).
                        let healthOn = overview.hasHealthData || health.hasConnected
                        Button { Task { await health.connectAndSync() } } label: {
                            setRow("Apple Health", status: healthStatusText(healthOn), tone: healthOn ? .green : .orange, first: true)
                        }.buttonStyle(.plain).disabled(healthOn || health.status == .requesting || health.status == .syncing)
                        // Strava, status only (linked via OAuth on faff.run).
                        let stravaOn = overview.connectors?.contains("strava") ?? false
                        setRow("Strava", status: stravaOn ? "Connected" : "Connect", tone: stravaOn ? .green : .grey)
                        // Apple Watch, status only (the watch app is the link).
                        setRow("Apple Watch", status: watchStatus.0, tone: watchStatus.1)
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
        .task { WatchSync.shared.activate(); await loadShoes() }
    }

    // ── Training snapshot ─────────────────────────────────────────
    private var trainingCard: some View {
        let v = overview.state?.volume
        let vdot = overview.raceProjection?.vdot
        return VStack(alignment: .leading, spacing: 10) {
            Text("TRAINING").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
            HStack(spacing: Faff.S.inlineGap) {
                StatPill(value: vdot.map { String(Int($0)) } ?? "-", unit: vdot != nil ? "score" : nil, label: "Fitness")
                StatPill(value: OverviewFormat.distance(v?.last7Mi), unit: "mi", label: "Last 7d")
                StatPill(value: OverviewFormat.distance(v?.weeklyAvg8w), unit: "mi", label: "8wk avg")
            }
            if let r = overview.state?.races?.nextA, let name = r.name {
                Divider().overlay(Faff.C.divider)
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("NEXT RACE").font(Faff.F.inter(9, .semibold)).tracking(0.8).foregroundStyle(Faff.C.textDim)
                        Text(name).font(Faff.F.inter(13, .semibold)).foregroundStyle(Faff.C.ink)
                    }
                    Spacer()
                    if let d = r.daysAway { Text("\(d) days").font(Faff.F.display(18)).foregroundStyle(Faff.C.race) }
                }
            }
        }.faffCard()
    }

    // ── Shoe rotation ─────────────────────────────────────────────
    private var shoeCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("SHOE ROTATION").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
                Spacer()
                Button { shoeEdit = ShoeEditTarget(shoe: nil) } label: {
                    HStack(spacing: 3) {
                        Image(systemName: "plus").font(.system(size: 10, weight: .bold))
                        Text("ADD").font(Faff.F.inter(9.5, .semibold)).tracking(0.5)
                    }.foregroundStyle(Faff.C.race)
                }.buttonStyle(.plain)
            }
            if !shoesLoaded {
                HStack(spacing: 8) { ProgressView().scaleEffect(0.8); Text("Loading…").font(Faff.F.inter(12)).foregroundStyle(Faff.C.textMuted) }
            } else if shoes.isEmpty {
                Text("No shoes yet. Tap ADD to start tracking mileage.")
                    .font(Faff.F.inter(12.5)).foregroundStyle(Faff.C.textMuted).lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                let active = shoes.filter { !($0.retired ?? false) }
                ForEach(Array(active.enumerated()), id: \.element.id) { i, s in
                    if i > 0 { Divider().overlay(Faff.C.divider) }
                    Button { shoeEdit = ShoeEditTarget(shoe: s) } label: { shoeRow(s) }.buttonStyle(.plain)
                }
                let retired = shoes.filter { $0.retired ?? false }
                if !retired.isEmpty {
                    Divider().overlay(Faff.C.divider)
                    ForEach(Array(retired.enumerated()), id: \.element.id) { _, s in
                        Button { shoeEdit = ShoeEditTarget(shoe: s) } label: { shoeRow(s) }.buttonStyle(.plain)
                            .opacity(0.5)
                    }
                }
            }
        }
        .faffCard()
        .sheet(item: $shoeEdit) { t in
            ShoeEditSheet(shoe: t.shoe, onSaved: { Task { shoesLoaded = false; await loadShoes() } })
        }
    }

    private func shoeRow(_ s: Shoe) -> some View {
        let mi = Int(s.mileage ?? 0)
        let cap = Int(s.mileageCap ?? 0)
        let wear = s.wearFraction
        // Mirrors the web shoeStatus tones: ≥0.90 warn, ≥0.70 amber, else green.
        let st = Shoe.status(wear)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(s.name).font(Faff.F.inter(13, .semibold)).foregroundStyle(Faff.C.ink)
                if s.preferred == true {
                    Text("PREFERRED").font(Faff.F.inter(7.5, .semibold)).tracking(0.5).foregroundStyle(Faff.C.recovery)
                        .padding(.horizontal, 5).padding(.vertical, 2).background(Faff.C.greenWash).clipShape(Capsule())
                }
                Spacer()
                (Text("\(mi)").font(Faff.F.display(16)).foregroundStyle(Faff.C.ink)
                 + Text(cap > 0 ? " / \(cap) mi" : " mi").font(Faff.F.inter(10)).foregroundStyle(Faff.C.textDim))
            }
            if cap > 0 {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Faff.C.track).frame(height: 6)
                        Capsule().fill(st.1).frame(width: max(geo.size.width * wear, 4), height: 6)
                    }
                }.frame(height: 6)
            }
            HStack(spacing: 6) {
                if let types = s.runTypes, !types.isEmpty {
                    Text(types.joined(separator: " · ")).font(Faff.F.inter(9.5)).foregroundStyle(Faff.C.textFaint)
                }
                Spacer()
                Text(st.0).font(Faff.F.inter(9, .semibold)).foregroundStyle(st.1)
            }
        }.padding(.vertical, 2).contentShape(Rectangle())
    }

    private func loadShoes() async {
        guard !shoesLoaded else { return }
        shoes = (try? await ShoesAPI.fetch()) ?? []
        shoesLoaded = true
    }

    /// Apple Watch status from real WCSession pairing, there's no
    /// "connect" step, the watch app is the link. A paired watch with the
    /// Faff app reads as Connected.
    private var watchStatus: (String, Badge.Tone) {
        if watch.isWatchAppInstalled || watch.isPaired { return ("Connected", .green) }
        return (", ", .grey)
    }

    private func healthStatusText(_ on: Bool) -> String {
        if on { return "Connected" }
        switch health.status {
        case .requesting, .syncing: return "Connecting…"
        case .unavailable: return "Unavailable"
        default: return "Connect"
        }
    }

    private func setRow(_ name: String, status: String, tone: Badge.Tone, first: Bool = false) -> some View {
        HStack {
            Text(name).font(Faff.F.inter(12.5)).foregroundStyle(Faff.C.ink)
            Spacer()
            Badge(text: status, tone: tone)
        }
        .padding(.vertical, 10)
        .overlay(first ? nil : Rectangle().frame(height: 1).foregroundStyle(Faff.C.divider), alignment: .top)
    }
}

// MARK: - Why this (sheet), read-only rationale

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
                                 "Your recent training load is still elevated after the race, which is why today stays easy.",
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

/// Edit the HR anchors. Auto-populated from Apple Health; a manual override
/// wins until cleared. POSTs to /api/profile/{max-hr,resting-hr}.
struct HrAnchorEditSheet: View {
    let maxHr: Int?
    let restingHr: Int?
    var onSaved: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @State private var maxText: String = ""
    @State private var restText: String = ""
    @State private var saving = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Faff.S.rowGap) {
                SheetGrabHandle()
                HStack(alignment: .top) {
                    Text("HR ANCHORS").font(Faff.F.inter(10, .semibold)).tracking(2).foregroundStyle(Faff.C.textDim)
                    Spacer()
                    SheetCloseButton { dismiss() }
                }
                CoachVerdict("How this works",
                    "These come from Apple Health automatically (max HR from your hardest efforts, resting HR from your watch). Override either if you've measured it directly, clear the field to go back to automatic. Every HR zone keys off these two numbers.",
                    color: Faff.C.textDim)
                VStack(alignment: .leading, spacing: 14) {
                    anchorField("Max HR", placeholder: maxHr.map { "\($0)" } ?? "auto", text: $maxText, unit: "bpm")
                    anchorField("Resting HR", placeholder: restingHr.map { "\($0)" } ?? "auto", text: $restText, unit: "bpm")
                }.faffCard()
                PrimaryButton(title: saving ? "Saving…" : "Save", icon: nil) { Task { await save() } }
                    .disabled(saving)
            }
            .padding(.horizontal, Faff.S.pageEdge).padding(.bottom, Faff.S.scrollBottom)
        }
        .background(Faff.C.bg.ignoresSafeArea())
    }

    private func anchorField(_ label: String, placeholder: String, text: Binding<String>, unit: String) -> some View {
        HStack {
            Text(label).font(Faff.F.inter(13, .semibold)).foregroundStyle(Faff.C.ink)
            Spacer()
            TextField(placeholder, text: text)
                .keyboardType(.numberPad).multilineTextAlignment(.trailing)
                .font(Faff.F.oswald(18, .semibold)).frame(width: 80)
            Text(unit).font(Faff.F.inter(11)).foregroundStyle(Faff.C.textFaint)
        }
    }

    private func save() async {
        saving = true; defer { saving = false }
        // Empty field → clear override (back to auto). A number → override.
        let maxVal = maxText.trimmingCharacters(in: .whitespaces)
        let restVal = restText.trimmingCharacters(in: .whitespaces)
        if !maxVal.isEmpty, let v = Int(maxVal) { _ = try? await FaffAPI.shared.setMaxHrOverride(v) }
        if !restVal.isEmpty, let v = Int(restVal) { _ = try? await FaffAPI.shared.setRestingHrOverride(v) }
        onSaved()
        dismiss()
    }
}

/// Karvonen HR zone scale, the 5 zones with the runner's real bpm ranges,
/// so "145 = easy aerobic" is legible at a glance. Optionally marks where a
/// run's average HR landed. Reads /api/overview hrZones (HRR or %max).
struct HrZoneScale: View {
    let zones: [OHrZone]
    var markerBpm: Int? = nil
    var framework: String = "HRR"

    private func tone(_ tier: String) -> Color {
        switch tier {
        case "z1": return Faff.C.recovery.opacity(0.45)
        case "z2": return Faff.C.recovery
        case "z3": return Faff.C.milestone.opacity(0.8)
        case "z4": return Faff.C.milestone
        default:   return Faff.C.warn
        }
    }
    private func contains(_ z: OHrZone) -> Bool {
        guard let m = markerBpm else { return false }
        return m >= z.lowBpm && m <= z.highBpm
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("YOUR HR ZONES").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
                Spacer()
                Text(framework == "HRR" ? "Personalized to you" : "Standard zones")
                    .font(Faff.F.inter(9.5, .medium)).foregroundStyle(Faff.C.textFaint)
            }
            ForEach(zones) { z in
                HStack(spacing: 10) {
                    RoundedRectangle(cornerRadius: 3).fill(tone(z.tier)).frame(width: 4, height: 26)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(z.name).font(Faff.F.inter(12, contains(z) ? .bold : .medium)).foregroundStyle(Faff.C.ink)
                        Text(z.pctLabel).font(Faff.F.inter(9.5)).foregroundStyle(Faff.C.textFaint)
                    }
                    Spacer()
                    Text("\(z.lowBpm)–\(z.highBpm)")
                        .font(Faff.F.oswald(14, contains(z) ? .semibold : .regular))
                        .foregroundStyle(contains(z) ? tone(z.tier) : Faff.C.textMuted)
                    Text("bpm").font(Faff.F.inter(9.5)).foregroundStyle(Faff.C.textFaint)
                    if contains(z) {
                        Text("· you").font(Faff.F.inter(9.5, .semibold)).foregroundStyle(tone(z.tier))
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .faffCard()
    }
}

/// Readiness detail, the transparent breakdown behind the score. Opened
/// from the Today readiness card and the Health "Body State" hero. Shows the
/// signals that moved the score off baseline, the vitals feeding it, what's
/// not yet wired in, and a plain-language explainer of the scale.
struct ReadinessDetailSheet: View {
    let overview: OverviewResponse
    @Environment(\.dismiss) private var dismiss

    private var score: Int? { overview.readinessScore }
    private var tone: Color { TodayView.tone(for: overview.readinessState) }
    private var inputs: [OReadinessInput] { overview.readinessInputs ?? [] }
    private var missing: [String] { overview.readinessMissing ?? [] }
    private var badgeTone: Badge.Tone {
        switch overview.readinessState { case "green": return .green; case "yellow": return .amber; case "red": return .warn; default: return .grey }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Faff.S.rowGap) {
                SheetGrabHandle()
                HStack(alignment: .top) {
                    Text("READINESS").font(Faff.F.inter(10, .semibold)).tracking(2).foregroundStyle(Faff.C.textDim)
                    Spacer()
                    SheetCloseButton { dismiss() }
                }

                // Hero, ring + state + the coach's recommendation verbatim.
                HStack(spacing: 16) {
                    ReadinessRing(score: score, tone: tone, size: 76)
                    VStack(alignment: .leading, spacing: 7) {
                        Badge(text: overview.readinessWord, tone: badgeTone)
                        if let rec = overview.readinessRecommendation, !rec.isEmpty {
                            Text(rec).font(Faff.F.inter(13)).foregroundStyle(Faff.C.ink).lineSpacing(2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer(minLength: 0)
                }.faffCard()

                if score != nil {
                    // The signals that moved the score off its baseline.
                    VStack(alignment: .leading, spacing: 12) {
                        Text("WHAT'S FEEDING IT").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
                        if inputs.isEmpty {
                            Text("Sitting right at the baseline of 75, nothing is pulling it up or down today.")
                                .font(Faff.F.inter(13)).foregroundStyle(Faff.C.textMuted).lineSpacing(2)
                        } else {
                            ForEach(inputs) { i in
                                HStack(alignment: .top, spacing: 12) {
                                    Text(deltaText(i.delta))
                                        .font(Faff.F.oswald(15, .semibold))
                                        .foregroundStyle(i.delta >= 0 ? Faff.C.recovery : Faff.C.warn)
                                        .frame(width: 40, alignment: .leading)
                                    Text(i.note.prefix(1).uppercased() + i.note.dropFirst())
                                        .font(Faff.F.inter(13)).foregroundStyle(Faff.C.ink).lineSpacing(2)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading).faffCard()

                    // The recovery vitals the engine reads.
                    vitalsRow

                    // The runner's HR zones, so "hard" vs "easy" is legible.
                    if let z = overview.hrZones, !z.zones.isEmpty {
                        HrZoneScale(zones: z.zones, framework: z.framework)
                    }

                    // Honest about gaps, signals we'd use but don't have yet.
                    if !missing.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("NOT YET IN THE SCORE").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
                            ForEach(missing, id: \.self) { m in
                                Text("• \(friendlyMissing(m))").font(Faff.F.inter(12.5)).foregroundStyle(Faff.C.textMuted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading).faffCard()
                    }

                    CoachVerdict("How readiness works",
                        "Every day starts at a baseline of 75. Recent training load, how fresh you are, and how your easy pace tracks against heart rate nudge it up or down. 80+ is green, hit the plan. 60–79 is yellow, watch your effort. Under 60 is red, back off. It's a read on your body, not a command; you make the call.",
                        color: Faff.C.textDim)
                } else {
                    CoachVerdict("No score yet",
                        "Readiness posts once a few recent runs and your Apple Health vitals (HRV, resting HR, sleep) have synced. Keep logging and it'll fill in.",
                        color: Faff.C.textDim)
                }

                PrimaryButton(title: "Close", icon: nil) { dismiss() }
            }
            .padding(.horizontal, Faff.S.pageEdge).padding(.bottom, Faff.S.scrollBottom)
        }
        .background(Faff.C.bg.ignoresSafeArea())
    }

    private func deltaText(_ d: Int) -> String { d >= 0 ? "+\(d)" : "\(d)" }

    private func friendlyMissing(_ key: String) -> String {
        if key.hasPrefix("sleep") { return "Sleep quality (syncing from Apple Health)" }
        if key.hasPrefix("mileage") { return "This week's mileage vs. what's prescribed" }
        if key.hasPrefix("hr-pace-drift") { return "Heart-rate vs. pace drift (needs more easy-run volume)" }
        return key
    }

    @ViewBuilder private var vitalsRow: some View {
        let r = overview.state?.recovery
        let cells: [(String, String, String)] = [
            ("HRV", r?.hrv7dAvgMs.map { "\(Int($0))" } ?? "-", "ms · 7d"),
            ("RESTING HR", r?.rhrBpm.map { "\(Int($0))" } ?? "-", "bpm"),
            ("SLEEP", r?.sleep7dAvgHrs.map { String(format: "%.1f", $0) } ?? "-", "h · 7d"),
        ]
        VStack(alignment: .leading, spacing: 10) {
            Text("VITALS FEEDING IT").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
            HStack(spacing: 10) {
                ForEach(cells, id: \.0) { c in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(c.0).font(Faff.F.inter(9.5, .semibold)).tracking(0.8).foregroundStyle(Faff.C.textDim)
                        Text(c.1).font(Faff.F.display(26)).foregroundStyle(Faff.C.ink)
                        Text(c.2).font(Faff.F.inter(10)).foregroundStyle(Faff.C.textFaint)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading).faffCard()
    }
}

struct MetricDetailSheet: View {
    struct Metric: Identifiable {
        let id = UUID(); let title: String; let value: String; let unit: String?
        var live: Bool = true; var sampleType: String? = nil; var caption: String? = nil
    }
    let metric: Metric
    let overview: OverviewResponse
    @Environment(\.dismiss) private var dismiss
    @State private var rangeDays = 30
    @State private var series: [HealthSeriesPoint] = []
    @State private var loadingSeries = false
    private let rangeOptions = ["7D", "30D", "90D"]
    private func days(for label: String) -> Int { label == "7D" ? 7 : (label == "90D" ? 90 : 30) }
    private var rangeLabel: String { rangeDays == 7 ? "7D" : (rangeDays == 90 ? "90D" : "30D") }
    private var guide: MetricGuide? { MetricGuide.lookup(sampleType: metric.sampleType, title: metric.title) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Faff.S.rowGap) {
                SheetGrabHandle()
                HStack(alignment: .top) {
                    Text("APPLE HEALTH").font(Faff.F.inter(10, .semibold)).tracking(2).foregroundStyle(Faff.C.textDim)
                    Spacer()
                    SheetCloseButton { dismiss() }
                }
                valueCard
                if metric.live, metric.sampleType != nil {
                    // Every health metric gets the full daily history graph.
                    VStack(spacing: 12) {
                        Segmented(options: rangeOptions, selected: rangeLabel,
                                  onSelect: { rangeDays = days(for: $0) })
                        trendChart
                    }.faffCard()
                    if let t = trendRead { CoachVerdict("Your trend", t.text, color: t.color) }
                    guideCards
                    readinessNote
                } else if metric.live {
                    // Non-series metrics (ACWR, Volume), explanation, no chart.
                    guideCards
                } else {
                    CoachVerdict("No data yet",
                                 "\(metric.title) isn't syncing yet. Connect Apple Health (Health tab) and it'll appear here once your watch or phone records it.",
                                 color: Faff.C.textDim)
                }
                PrimaryButton(title: "Close", icon: nil) { dismiss() }
            }
            .padding(.horizontal, Faff.S.pageEdge).padding(.bottom, Faff.S.scrollBottom)
        }
        .background(Faff.C.bg.ignoresSafeArea())
        .task(id: rangeDays) { await loadSeries() }
    }

    private var valueCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("\(metric.title)\(metric.caption.map { " · \($0)" } ?? "")")
                    .font(Faff.F.inter(12.5, .semibold)).foregroundStyle(Faff.C.textMuted)
                Spacer()
                Badge(text: metric.live ? "Tracked" : "No data", tone: metric.live ? .green : .grey)
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(metric.value).font(Faff.F.display(58)).foregroundStyle(metric.live ? Faff.C.recovery : Faff.C.textFaint)
                if let u = metric.unit { Text(u).font(Faff.F.inter(15, .medium)).foregroundStyle(Faff.C.textMuted) }
            }
        }.faffCard()
    }

    /// What-it-is / what's-good / how-to-improve, the guidance the user
    /// actually wants, per metric. Colored accents: neutral → green → orange.
    @ViewBuilder private var guideCards: some View {
        if let g = guide {
            CoachVerdict("What it is", g.what, color: Faff.C.textDim)
            CoachVerdict("What's good", g.good, color: Faff.C.recovery)
            CoachVerdict("How to improve", g.improve, color: Faff.C.race)
        }
    }

    /// Only the recovery vitals feed the readiness score, note it where true.
    @ViewBuilder private var readinessNote: some View {
        if let s = overview.readinessScore,
           ["hrv", "resting_hr", "sleep_hours"].contains(metric.sampleType ?? "") {
            HStack(spacing: 12) {
                ReadinessRing(score: s, tone: TodayView.tone(for: overview.readinessState), size: 42)
                Text("**Feeds your readiness**, recovery vitals like this set today's score of \(s).")
                    .font(Faff.F.inter(12)).foregroundStyle(Faff.C.textMuted)
                Spacer()
            }.faffCard()
        }
    }

    /// A computed read on the direction of travel over the chosen window,
    /// interpreted against whether lower or higher is better for this metric.
    private var trendRead: (text: String, color: Color)? {
        guard series.count >= 3 else { return nil }
        let vals = series.map(\.value)
        let n = vals.count
        let head = Array(vals.prefix(max(1, n / 3)))
        let tail = Array(vals.suffix(max(1, n / 3)))
        let a = head.reduce(0, +) / Double(head.count)
        let b = tail.reduce(0, +) / Double(tail.count)
        guard a != 0 else { return nil }
        let pct = (b - a) / abs(a) * 100
        let mag = abs(pct)
        if mag < 3 {
            return ("Holding steady over \(rangeLabel), within a few percent of where it started.", Faff.C.textMuted)
        }
        let up = b > a
        let phrase = "Trending \(up ? "up" : "down") ~\(Int(mag.rounded()))% over \(rangeLabel)"
        if let lowerBetter = guide?.goodWhenLower {
            let good = (lowerBetter && !up) || (!lowerBetter && up)
            return (phrase + (good ? ", that's the direction you want." : ", worth keeping an eye on."),
                    good ? Faff.C.recovery : Faff.C.milestone)
        }
        return (phrase + ".", Faff.C.textMuted)
    }

    @ViewBuilder
    private var trendChart: some View {
        if loadingSeries {
            HStack(spacing: 8) { ProgressView().scaleEffect(0.8); Text("Loading…").font(Faff.F.inter(11.5)).foregroundStyle(Faff.C.textDim) }
                .frame(maxWidth: .infinity, minHeight: 110)
        } else if series.count >= 2 {
            let vals = series.map(\.value)
            let lo = (vals.min() ?? 0), hi = (vals.max() ?? 1)
            // Bars rise from a floor just below the minimum so day-to-day
            // variation is visible (a 160–170 spm range isn't flattened by a
            // zero baseline). Each bar is one recorded day.
            let pad = max(1, (hi - lo) * 0.18)
            let floor = lo - pad
            Chart(series) { p in
                BarMark(
                    x: .value("Date", p.date),
                    yStart: .value("Floor", floor),
                    yEnd: .value("Value", p.value),
                    width: .ratio(0.62)
                )
                .clipShape(RoundedRectangle(cornerRadius: 2, style: .continuous))
                .foregroundStyle(
                    LinearGradient(colors: [Faff.C.recovery, Faff.C.recovery.opacity(0.55)],
                                   startPoint: .top, endPoint: .bottom)
                )
            }
            .chartYScale(domain: floor...(hi + pad))
            .chartXAxis(.hidden)
            .chartYAxis { AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { v in
                AxisValueLabel { if let d = v.as(Double.self) { Text("\(Int(d))").font(Faff.F.inter(8)).foregroundStyle(Faff.C.textDim) } }
            } }
            .frame(height: 130)
        } else {
            Text(series.count == 1
                 ? "Only one day recorded so far, the trend fills in as more days sync."
                 : "No \(metric.title.lowercased()) recorded in this window yet. It fills in as Apple Health syncs each day.")
                .font(Faff.F.inter(11.5)).foregroundStyle(Faff.C.textDim)
                .frame(maxWidth: .infinity, minHeight: 110, alignment: .center)
                .multilineTextAlignment(.center)
        }
    }

    private func loadSeries() async {
        guard metric.live, let type = metric.sampleType else { return }
        loadingSeries = true
        defer { loadingSeries = false }
        series = (try? await HealthSeriesAPI.fetch(type: type, days: rangeDays)) ?? []
    }
}

// MARK: - Per-metric guidance (what it is / what's good / how to improve)

struct MetricGuide {
    let what: String
    let good: String
    let improve: String
    /// true → lower readings are better, false → higher is better, nil → neutral
    /// (no single "good" direction). Drives the trend interpretation.
    var goodWhenLower: Bool? = nil

    static func lookup(sampleType: String?, title: String) -> MetricGuide? {
        switch sampleType {
        case "hrv":
            return MetricGuide(
                what: "Heart-rate variability (HRV) is the beat-to-beat variation in your pulse, a window into recovery and how balanced your nervous system is.",
                good: "There's no universal 'good' number, your own baseline is what matters. Stable or rising HRV means you're absorbing training; a sharp drop often comes before fatigue or illness.",
                improve: "Protect sleep, keep easy days genuinely easy, hydrate, and manage life stress. HRV responds to total load, not just running.",
                goodWhenLower: false)
        case "resting_hr":
            return MetricGuide(
                what: "Resting heart rate (RHR) is your pulse at full rest, a simple, sensitive marker of aerobic fitness and recovery.",
                good: "Lower trends are generally better. A morning reading 5+ bpm above your baseline usually means under-recovery or an oncoming bug.",
                improve: "Build an aerobic base with easy mileage, prioritise sleep, and avoid stacking hard days. It drops over months, not days.",
                goodWhenLower: true)
        case "sleep_hours":
            return MetricGuide(
                what: "Nightly sleep duration, the single biggest lever on recovery, adaptation and staying injury-free.",
                good: "Most endurance runners do best on 7–9 hours, and consistency night-to-night matters as much as the total.",
                improve: "Hold a fixed wake time, dim screens before bed, and treat sleep as part of the plan, not the leftover.",
                goodWhenLower: false)
        case "vo2_max":
            return MetricGuide(
                what: "Cardio fitness (Apple's VO₂max read) estimates your aerobic ceiling — how much oxygen you can use at max effort.",
                good: "Higher is better and it climbs with consistent training. Apple's estimate is directional, so watch the trend, not the exact figure.",
                improve: "Easy Z2 volume builds the engine; controlled intervals sharpen the top end. Both, over weeks.",
                goodWhenLower: false)
        case "respiratory_rate":
            return MetricGuide(
                what: "Breaths per minute at rest, measured overnight.",
                good: "Stable is healthy. A rise of a couple of breaths above your norm can flag illness, poor sleep or piled-up fatigue.",
                improve: "It mostly tracks health and recovery, protect sleep and back off when it spikes.",
                goodWhenLower: true)
        case "wrist_temp":
            return MetricGuide(
                what: "Overnight wrist temperature, tracked against your own baseline.",
                good: "Steady near baseline is normal. A jump often precedes illness or signals heavy training stress.",
                improve: "You don't train this, use it as an early-warning flag to add recovery when it climbs.")
        case "cadence":
            return MetricGuide(
                what: "Cadence is your step rate while running (steps per minute).",
                good: "Many runners are efficient around 170–185 spm, but the right number is individual. A higher cadence usually shortens your stride and cuts overstriding and impact.",
                improve: "To raise it, nudge up ~5% at a time, run to a metronome or a playlist at the target beat for short stretches.",
                goodWhenLower: false)
        case "stride_length":
            return MetricGuide(
                what: "Stride length is the distance you cover per step.",
                good: "It grows naturally as you speed up and pairs with cadence to set your pace, there's no single ideal, it's part of your form signature.",
                improve: "It improves on its own with strength, mobility and aerobic fitness. Reaching for a longer stride directly usually causes overstriding.")
        case "vertical_oscillation":
            return MetricGuide(
                what: "Vertical oscillation is how much you bounce up-and-down each step (cm).",
                good: "Lower is generally more economical, roughly 6–9 cm is common for efficient runners.",
                improve: "A slightly higher cadence and a tall, relaxed posture usually reduce the bounce. Don't force it.",
                goodWhenLower: true)
        case "ground_contact_time":
            return MetricGuide(
                what: "Ground contact time is how long each foot stays on the ground (milliseconds).",
                good: "Quicker (lower) is generally more economical, efficient runners are often around 200–250 ms.",
                improve: "Higher cadence, strides and strength/plyometric work tend to shorten it over time.",
                goodWhenLower: true)
        case "vertical_ratio":
            return MetricGuide(
                what: "Vertical ratio is your bounce relative to your stride (oscillation ÷ stride length, %). It normalises 'bounciness' for speed.",
                good: "Lower is more efficient, you're moving forward, not up and down.",
                improve: "It comes down with higher cadence and better posture; it's a cleaner economy signal than raw oscillation.",
                goodWhenLower: true)
        case "run_power":
            return MetricGuide(
                what: "Running power estimates your mechanical output in watts.",
                good: "Use it relative to your own runs. Steadier power on hills and into wind helps you pace by effort instead of pace.",
                improve: "It's most useful live for pacing; for trends, watch your power-at-a-given-heart-rate as fitness improves.")
        default:
            break
        }
        switch title {
        case "Training load":
            return MetricGuide(
                what: "Compares how much you've run in the last 7 days against your rolling 28-day average.",
                good: "\"Steady\" is when the two are close. If your last week jumps well above your recent average, you're ramping fast, a higher injury-risk zone.",
                improve: "Build mileage gradually and follow a hard week with an easier one.")
        case "Volume":
            return MetricGuide(
                what: "Total running distance over the last 7 days.",
                good: "Progress it gradually, big week-to-week jumps are a classic injury trigger.",
                improve: "Add roughly 10% a week at most, and bank a down week every few weeks to absorb the work.")
        default:
            return nil
        }
    }
}

// MARK: - Plan day detail (sheet from a Plan row)

struct PlanDayDetailSheet: View {
    let day: PlanRangeDay
    let phase: String?
    @Environment(\.dismiss) private var dismiss
    @State private var detail: PlanWorkoutDetail?
    @State private var loaded = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Faff.S.rowGap) {
                SheetGrabHandle()
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 9) {
                        Text(eyebrow.uppercased()).font(Faff.F.inter(10, .semibold)).tracking(2).foregroundStyle(Faff.C.textDim)
                        Text(titleLine).font(Faff.F.display(46)).tracking(-0.5).foregroundStyle(Faff.C.ink)
                            .lineSpacing(-8).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer()
                    SheetCloseButton { dismiss() }
                }
                HStack(spacing: Faff.S.inlineGap) {
                    StatPill(value: OverviewFormat.distance(day.distanceMi), unit: "mi", label: "Distance")
                    StatPill(value: day.paceDisplay, unit: day.paceDisplay.contains(":") ? "/mi" : nil, label: "Pace", accent: day.isQuality ?? false)
                    StatPill(value: faffApproxDuration(day.durationMin).value, unit: faffApproxDuration(day.durationMin).unit, label: "Time")
                }
                // Structured steps (real describeWorkout, same as today's
                // detail) when available; fall back to the prose notes.
                if let steps = detail?.description?.steps, !steps.isEmpty {
                    WorkoutStructureView(steps: steps)
                } else if let n = day.description, !n.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("THE WORKOUT").font(Faff.F.inter(10, .semibold)).tracking(1.6).foregroundStyle(Faff.C.textDim)
                        Text(n).font(Faff.F.inter(13)).foregroundStyle(Faff.C.ink).lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }.faffCard()
                }
                if let why = detail?.description?.why, !why.isEmpty {
                    CoachVerdict("Why this run", why, color: Faff.C.recovery)
                }
                CoachVerdict("Focus", detail?.description?.effort ?? effort(day.type), color: Faff.C.milestone)
                PrimaryButton(title: "Close", icon: nil) { dismiss() }
            }
            .padding(.horizontal, Faff.S.pageEdge).padding(.bottom, Faff.S.scrollBottom)
        }
        .background(Faff.C.bg.ignoresSafeArea())
        .task {
            guard !loaded, !day.isRest, let d = day.date else { return }
            loaded = true
            detail = try? await WorkoutDayAPI.fetch(date: d)
        }
    }
    private var eyebrow: String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "UTC")
        var when = ""
        if let iso = day.date, let dt = f.date(from: String(iso.prefix(10))) {
            let out = DateFormatter(); out.dateFormat = "EEEE · MMM d"; out.timeZone = TimeZone(identifier: "UTC")
            when = out.string(from: dt)
        }
        return phase.map { "\(when) · \($0)" } ?? when
    }
    private var titleLine: String {
        let label = (day.label ?? "Run").uppercased()
        if let mi = day.distanceMi, mi > 0 { return "\(label)\n\(OverviewFormat.distance(mi)) MI" }
        return label
    }
    private func effort(_ type: String?) -> String {
        switch type ?? "" {
        case "threshold": return "Comfortably hard, controlled threshold effort. You can say 2–3 words at a time, not a full sentence."
        case "vo2", "interval": return "Hard reps with full recoveries. Hit the paces, don't exceed them."
        case "long_steady", "long": return "Steady aerobic miles. Time on feet is the stimulus, not pace."
        case "marathon_specific", "mp": return "Goal marathon-pace effort, controlled and rhythmic."
        case "race": return "Race day, execute the plan; conserve early, commit late."
        default: return "Easy and conversational. If you can't hold a sentence, slow down."
        }
    }
}
