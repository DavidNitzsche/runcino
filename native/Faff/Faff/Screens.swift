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
    @State private var tab: FaffTabBar.Tab = RootTabView.initialTab
    @Environment(\.scenePhase) private var scenePhase

    /// DEBUG: `-tab plan|coach|health|more` opens that tab for screenshots.
    static var initialTab: FaffTabBar.Tab {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-tab"), i + 1 < args.count,
           let t = FaffTabBar.Tab(rawValue: args[i + 1]) { return t }
        #endif
        return .today
    }

    var body: some View {
        Group {
            if let o = overview, o.ok {
                screen(o)
                    .safeAreaInset(edge: .bottom, spacing: 0) {
                        FaffTabBar(active: tab) { tab = $0 }
                    }
            } else if let loadError {
                FaffStateView(title: "Couldn't load", detail: loadError) { Task { await load() } }
            } else {
                FaffLoadingView()
            }
        }
        .background(Faff.C.bg.ignoresSafeArea())
        .task {
            await load()
            // Quietly re-sync HealthKit on launch (no-op until connected).
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
        case .today:  TodayView(overview: o, onLogout: onLogout)
        case .plan:   PlanView(overview: o)
        case .coach:  CoachView(overview: o)
        case .health: HealthView(overview: o)
        case .more:   MoreView(overview: o, onLogout: onLogout)
        }
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
    var body: some View {
        let days = overview.planWeekWorkouts ?? []
        let planned = days.reduce(0.0) { $0 + ($1.distanceMi ?? 0) }
        return FaffPage(eyebrow: "\(overview.planCurrentPhase ?? "Plan") · this week", title: "Plan") {
            VStack(spacing: 0) {
                ForEach(Array(days.enumerated()), id: \.offset) { _, day in planRow(day) }
            }
            .faffCard(padding: 8)
            HStack {
                Text("\(Int(planned)) mi planned this week")
                    .font(Faff.F.inter(11, .semibold)).foregroundStyle(Faff.C.textMuted)
                Spacer()
            }
            .padding(.horizontal, 4)
        }
    }

    private func planRow(_ d: OPlanDay) -> some View {
        let isToday = d.dateISO == overview.today
        let isPast = (d.dateISO ?? "") < (overview.today ?? "")
        let dw = DerivedWorkout(plan: d, fallback: nil)
        let isRest = (d.type ?? "") == "rest"
        let isDone = overview.isPlanDayDone(d)   // real ≥60%-of-planned completion
        return HStack(spacing: 12) {
            ZStack {
                if isDone { Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)).foregroundStyle(Faff.C.recovery) }
                else if isToday { Circle().fill(Faff.C.milestone).frame(width: 9, height: 9) }
                else if isPast && !isRest { Circle().fill(Faff.C.warn.opacity(0.5)).frame(width: 7, height: 7) }  // missed
                else { Circle().fill(Faff.C.textFaint).frame(width: 7, height: 7) }
            }.frame(width: 16)
            Text(dowLabel(d.dow)).font(Faff.F.display(17)).foregroundStyle(Faff.C.textDim).frame(width: 36, alignment: .leading)
            VStack(alignment: .leading, spacing: 1) {
                Text(dw.label).font(Faff.F.inter(13, .semibold))
                    .foregroundStyle(isToday ? Faff.C.milestone : Faff.C.ink)
                Text(isRest ? "Rest day" : "\(OverviewFormat.distance(d.distanceMi)) mi").font(Faff.F.inter(10)).foregroundStyle(Faff.C.textDim)
            }
            Spacer()
            Text(isRest ? "—" : OverviewFormat.distance(d.distanceMi)).font(Faff.F.display(17))
                .foregroundStyle(isRest ? Faff.C.textFaint : (isToday ? Faff.C.milestone : Faff.C.ink))
        }
        .padding(.horizontal, 8).padding(.vertical, 11)
        .overlay(Rectangle().frame(height: 1).foregroundStyle(Faff.C.divider), alignment: .top)
    }
}

// MARK: - Coach (daily read, NOT a chat)

struct CoachView: View {
    let overview: OverviewResponse
    var body: some View {
        let dw = overview.todayWorkout
        return FaffPage(eyebrow: overview.briefing?.answer.label ?? "Coach", title: "Today's read") {
            faffMarkdown(overview.coachRead)
                .font(Faff.F.inter(17)).foregroundStyle(Faff.C.ink).lineSpacing(5)
                .fixedSize(horizontal: false, vertical: true)
            block("Focus", dw.guidance, Faff.C.recovery)
            if let acwr = overview.acwrValue {
                block("Load",
                      String(format: "Last 7 days are %.0f%% of your 8-week average (ACWR %.2f). %@",
                             acwr * 100, acwr, acwr > 1.3 ? "Keep the easy days honest." : "Balanced."),
                      acwr > 1.3 ? Faff.C.milestone : Faff.C.recovery)
            }
        }
    }
    private func block(_ label: String, _ body: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label.uppercased()).font(Faff.F.inter(9, .bold)).tracking(1.2).foregroundStyle(color)
            Text(body).font(Faff.F.inter(13)).foregroundStyle(Faff.C.ink).lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, 12)
        .overlay(Rectangle().frame(width: 3).foregroundStyle(color), alignment: .leading)
    }
}

// MARK: - Health

struct HealthView: View {
    let overview: OverviewResponse
    @ObservedObject private var hk = HealthKitManager.shared
    var body: some View {
        FaffPage(eyebrow: "Today", title: "Body state") {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("RECOVERY").font(Faff.F.inter(10, .medium)).tracking(0.8).foregroundStyle(Faff.C.textDim)
                    Spacer()
                    Badge(text: overview.hasHealthData ? "Tracked" : "No data",
                          tone: overview.hasHealthData ? .green : .none)
                }
                if overview.hasHealthData {
                    metricRow("Resting HR", overview.state?.recovery?.rhrBpm.map { "\(Int($0)) bpm" } ?? "—")
                    metricRow("HRV (7d)", overview.state?.recovery?.hrv7dAvgMs.map { "\(Int($0)) ms" } ?? "—")
                    metricRow("Sleep (7d)", overview.state?.recovery?.sleep7dAvgHrs.map { String(format: "%.1f h", $0) } ?? "—")
                } else {
                    Text("Connect Apple Health for resting heart rate, HRV, sleep, and VO₂max. Until then, readiness is estimated from training load only.")
                        .font(Faff.F.inter(12.5)).foregroundStyle(Faff.C.textMuted).lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                connectControl
            }
            .faffCard()
            VStack(alignment: .leading, spacing: 10) {
                Text("TRAINING LOAD").font(Faff.F.inter(10, .medium)).tracking(0.8).foregroundStyle(Faff.C.textDim)
                metricRow("Last 7 days", "\(OverviewFormat.distance(overview.state?.volume?.last7Mi)) mi")
                metricRow("Last 28 days", "\(OverviewFormat.distance(overview.state?.volume?.last28Mi)) mi")
                if let acwr = overview.acwrValue {
                    metricRow("Acute : chronic", String(format: "%.2f", acwr), warn: acwr > 1.3)
                }
            }
            .faffCard()
        }
    }
    private func metricRow(_ k: String, _ v: String, warn: Bool = false) -> some View {
        HStack {
            Text(k).font(Faff.F.inter(12)).foregroundStyle(Faff.C.textMuted)
            Spacer()
            Text(v).font(Faff.F.inter(13, .semibold)).foregroundStyle(warn ? Faff.C.milestone : Faff.C.ink)
        }
    }

    // ── Apple Health connect / sync ───────────────────────────────
    @ViewBuilder private var connectControl: some View {
        let busy = hk.status == .requesting || hk.status == .syncing
        VStack(alignment: .leading, spacing: 8) {
            Button {
                Task { await hk.connectAndSync() }
            } label: {
                HStack(spacing: 7) {
                    if busy {
                        ProgressView().controlSize(.small).tint(.white)
                    } else {
                        Image(systemName: "heart.fill").font(.system(size: 11, weight: .bold))
                    }
                    Text(busy ? "Syncing…" : "Connect Apple Health")
                        .font(Faff.F.oswald(12)).tracking(1.2)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 12)
                .foregroundStyle(.white).background(busy ? Faff.C.ink.opacity(0.6) : Faff.C.ink)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain).disabled(busy)
            if let msg = hk.lastMessage {
                Text(msg)
                    .font(Faff.F.inter(11.5))
                    .foregroundStyle(hk.status == .error ? Faff.C.warn : Faff.C.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.top, 4)
    }
}

// MARK: - More (profile · races · integrations · sign out)

struct MoreView: View {
    let overview: OverviewResponse
    let onLogout: () -> Void
    var body: some View {
        FaffPage(eyebrow: "More", title: overview.profileName ?? "Profile") {
            if let r = overview.state?.races?.nextA {
                VStack(alignment: .leading, spacing: 4) {
                    Text("NEXT A-RACE").font(Faff.F.inter(9, .semibold)).tracking(1.4).foregroundStyle(.white.opacity(0.85))
                    Text((r.name ?? "").uppercased()).font(Faff.F.display(24)).foregroundStyle(.white)
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("\(r.daysAway ?? 0)").font(Faff.F.display(40)).foregroundStyle(.white)
                        Text("days out · goal \(r.goalDisplay ?? "—")").font(Faff.F.inter(11, .semibold)).foregroundStyle(.white.opacity(0.9))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .background(Color.faffMark)
                .clipShape(RoundedRectangle(cornerRadius: Faff.R.card, style: .continuous))
            }
            if let recent = overview.state?.races?.recent, !recent.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    Text("RECENT RACES").font(Faff.F.inter(10, .medium)).tracking(0.8).foregroundStyle(Faff.C.textDim).padding(.bottom, 4)
                    ForEach(Array(recent.prefix(4).enumerated()), id: \.offset) { _, rr in
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(rr.name ?? "").font(Faff.F.inter(12, .semibold)).foregroundStyle(Faff.C.ink)
                                Text("\(rr.date ?? "") · \(OverviewFormat.distance(rr.distanceMi)) mi").font(Faff.F.inter(9)).foregroundStyle(Faff.C.textDim)
                            }
                            Spacer()
                            Text(finish(rr.finishS)).font(Faff.F.display(16)).foregroundStyle(Faff.C.ink)
                        }
                        .padding(.vertical, 9)
                        .overlay(Rectangle().frame(height: 1).foregroundStyle(Faff.C.divider), alignment: .top)
                    }
                }
                .faffCard()
            }
            VStack(alignment: .leading, spacing: 0) {
                Text("INTEGRATIONS").font(Faff.F.inter(10, .medium)).tracking(0.8).foregroundStyle(Faff.C.textDim).padding(.bottom, 4)
                setRow("Apple Health", connected: overview.hasHealthData || (overview.connectors?.contains("apple_health") ?? false))
                setRow("Strava", connected: overview.connectors?.contains("strava") ?? false)
                setRow("Apple Watch", connected: false)
            }
            .faffCard()
            Button { onLogout() } label: {
                Text("SIGN OUT").font(Faff.F.oswald(12)).tracking(1.5).foregroundStyle(Faff.C.warn)
                    .frame(maxWidth: .infinity).padding(.vertical, 13)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Faff.C.divider, lineWidth: 1.5))
            }
            .buttonStyle(.plain)
        }
    }
    private func setRow(_ name: String, connected: Bool) -> some View {
        HStack {
            Text(name).font(Faff.F.inter(12.5)).foregroundStyle(Faff.C.ink)
            Spacer()
            Badge(text: connected ? "Connected" : "Connect", tone: connected ? .green : .none)
        }
        .padding(.vertical, 9)
        .overlay(Rectangle().frame(height: 1).foregroundStyle(Faff.C.divider), alignment: .top)
    }
    private func finish(_ s: Double?) -> String {
        guard let s, s > 0 else { return "—" }
        let t = Int(s); let h = t / 3600, m = (t % 3600) / 60, sec = t % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
    }
}
