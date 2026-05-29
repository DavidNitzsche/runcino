//
//  HealthView.swift
//
//  Phase 25b cutover (2026-05-28) — mirrors the v3 design of
//  web-v2/app/health/page.tsx onto iPhone. The legacy inline
//  "headline + metric grid" was rebuilt around the shared chrome
//  primitives shipped in Phase 25a:
//
//    1) PageHeader              ← FaffPageShell (display-recipe title
//                                 + caps-tracked eyebrow + optional
//                                 accent / title color override)
//    2) ReadinessHeroCard       ← <ReadinessBreakdownView /> card
//    3) BodyMetricCard × 5      ← <TrendCard /> compact mode
//    4) WATCH LIST card         ← <WatchListBox />
//    5) CoachSlot               ← <BriefingLoader surface="health" />
//
//  Headline title / color / eyebrow are derived by FaffAdapter so the
//  watch-mode branch logic lives in one place (matched 1:1 with the
//  web page). HealthView stays render-only — no string assembly here.
//

import SwiftUI

struct HealthView: View {
    // Hydrate from AppCache so the first tap after launch paints all
    // three (brief, readiness, metric cards) instantly. Network refresh
    // overwrites them when it lands.
    @State private var briefing: Briefing? =
        AppCache.read(.healthBriefing, as: Briefing.self)
    @State private var readiness: ReadinessSnapshot? =
        AppCache.read(.readiness, as: ReadinessSnapshot.self)
    @State private var health: HealthState? =
        AppCache.read(.healthState, as: HealthState.self)

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    PageHeader(
                        title: FaffAdapter.healthTitle(watchMode: health?.watchMode),
                        eyebrow: FaffAdapter.healthEyebrow(state: health),
                        titleColor: FaffAdapter.healthTitleColor(watchMode: health?.watchMode)
                    )

                    // §8.3 — readiness hero (big score + band).
                    ReadinessHeroCard(
                        score: readiness?.score,
                        label: readiness?.label
                    )
                    .transition(.opacity)

                    // Per-metric tiles · two-column grid.
                    metricGrid
                        .padding(.horizontal, 24)

                    // Check-in row across the bottom of the grid block.
                    checkInCard
                        .padding(.horizontal, 24)

                    // Watch list (amber/red flags) if any pending.
                    if let h = health, !h.watchItems.isEmpty {
                        watchList(h.watchItems)
                            .transition(.opacity)
                    }

                    // Coach prose — background-loaded, sits below the
                    // hard data. Never gates the cards above.
                    CoachSlot(
                        briefing: briefing,
                        surface: "health",
                        askPrompt: nil
                    )
                }
                .padding(.bottom, 40)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: readiness?.score)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: health?.today)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: briefing?.lead)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Health")
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
            .refreshable { await load() }
            .sensoryFeedback(.success, trigger: readiness?.score)
        }
    }

    // MARK: - Metric grid (SLEEP · RHR · HRV · LOAD)

    private var metricGrid: some View {
        LazyVGrid(
            columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)],
            spacing: 10
        ) {
            sleepCard
            rhrCard
            hrvCard
            loadCard
        }
    }

    @ViewBuilder
    private var sleepCard: some View {
        let s = health?.sleep
        let series = health?.sleepSeries.map(\.hours) ?? []
        let avg = s?.avg7n
        let target = 7.5
        let delta: String? = avg.map { v in
            let d = v - target
            if abs(d) < 0.1 { return "AT TARGET" }
            return d >= 0
                ? "+\(String(format: "%.1f", d))h vs 7.5h TARGET"
                : "\(String(format: "%.1f", d))h vs 7.5h TARGET"
        }
        let tone: BodyMetricDeltaTone = {
            guard let v = avg else { return .mute }
            if v >= target - 0.3 { return .green }
            if v >= target - 1.0 { return .amber }
            return .red
        }()

        BodyMetricCard(
            label: "SLEEP",
            labelColor: Theme.goal,
            value: avg.map { String(format: "%.1f", $0) } ?? "—",
            unit: "h",
            delta: delta,
            deltaTone: tone,
            sub: "7-NIGHT AVG · TARGET 7.5h",
            series: series,
            seriesMin: 4,
            seriesMax: 10,
            sparkBaseline: target
        )
    }

    @ViewBuilder
    private var rhrCard: some View {
        let r = health?.rhr
        let series = health?.rhrSeries.map { Double($0.bpm) } ?? []
        let delta = r?.delta
        let deltaText: String? = {
            guard let d = delta else { return nil }
            if d == 0 { return "AT BASELINE" }
            return d > 0
                ? "+\(d) bpm vs 60D BASELINE"
                : "\(d) bpm vs 60D BASELINE"
        }()
        let tone: BodyMetricDeltaTone = {
            guard let d = delta else { return .mute }
            if d >= 5 { return .red }
            if d >= 2 { return .amber }
            return .green
        }()

        BodyMetricCard(
            label: "RESTING HR",
            labelColor: Theme.over,
            value: r?.current.map(String.init) ?? "—",
            unit: "bpm",
            delta: deltaText,
            deltaTone: tone,
            sub: r?.baseline != nil
                ? "BASELINE \(r!.baseline!) bpm · 60-DAY WINDOW"
                : "60-DAY BASELINE BUILDING",
            series: series,
            seriesMin: 40,
            seriesMax: 70,
            sparkBaseline: r?.baseline.map(Double.init)
        )
    }

    @ViewBuilder
    private var hrvCard: some View {
        let h = health?.hrv
        let series = health?.hrvSeries.map { Double($0.ms) } ?? []
        let pct = h?.pctAboveBaseline
        let deltaText: String? = {
            guard let p = pct else { return nil }
            if abs(p) < 2 { return "AT BASELINE" }
            return p >= 0
                ? "+\(String(format: "%.0f", p))% vs BASELINE"
                : "\(String(format: "%.0f", p))% vs BASELINE"
        }()
        let tone: BodyMetricDeltaTone = {
            guard let p = pct else { return .mute }
            if p >= 5 { return .green }
            if p >= -3 { return .green }
            if p >= -10 { return .amber }
            return .red
        }()

        BodyMetricCard(
            label: "HRV",
            labelColor: Theme.green,
            value: h?.current.map(String.init) ?? "—",
            unit: "ms",
            delta: deltaText,
            deltaTone: tone,
            sub: h?.baseline != nil
                ? "BASELINE \(h!.baseline!) ms · NIGHTLY"
                : "BASELINE BUILDING",
            series: series,
            seriesMin: 30,
            seriesMax: 100,
            sparkBaseline: h?.baseline.map(Double.init)
        )
    }

    /// LOAD card · uses the loadAcwr field added to ReadinessSnapshot in
    /// Phase 12. ACWR (acute:chronic workload ratio) — 0.8-1.3 is the
    /// "sweet spot", >1.5 is the injury-risk threshold from the
    /// Gabbett research. No 14-day series yet on the wire; the
    /// MiniSparkline renders its placeholder dotted line.
    @ViewBuilder
    private var loadCard: some View {
        let acwr = readiness?.loadAcwr
        let deltaText: String? = acwr.map { v in
            if v >= 1.5 { return "INJURY-RISK BAND" }
            if v >= 1.3 { return "BUILD ZONE · UPPER" }
            if v >= 0.8 { return "SWEET SPOT 0.8–1.3" }
            return "DETRAINING RANGE"
        }
        let tone: BodyMetricDeltaTone = {
            guard let v = acwr else { return .mute }
            if v >= 1.5 { return .red }
            if v >= 1.3 { return .amber }
            if v >= 0.8 { return .green }
            return .amber
        }()

        BodyMetricCard(
            label: "LOAD",
            labelColor: Theme.dist,
            value: acwr.map { String(format: "%.2f", $0) } ?? "—",
            unit: "ACWR",
            delta: deltaText,
            deltaTone: tone,
            sub: "ACUTE : CHRONIC · 7D vs 28D AVG",
            series: [],
            seriesMin: nil,
            seriesMax: nil
        )
    }

    /// CHECK-IN row — placeholder for the morning subjective check-in
    /// (mood / soreness / motivation). The web /health page doesn't
    /// have this yet either; we ship the surface for visual parity
    /// with the task spec and a "TAP TO LOG" affordance.
    @ViewBuilder
    private var checkInCard: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("CHECK-IN")
                    .font(.label(10)).tracking(1.6)
                    .foregroundStyle(Theme.learn)
                Text("How does the body feel?")
                    .font(.display(18))
                    .foregroundStyle(Theme.ink)
                Text("SUBJECTIVE · MORNING WAKE")
                    .font(.label(9)).tracking(1.2)
                    .foregroundStyle(Theme.mute)
            }
            Spacer()
            Text("TAP TO LOG")
                .font(.label(10)).tracking(1.4)
                .foregroundStyle(Theme.learn)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(Theme.learn.opacity(0.12))
                .overlay(Capsule().stroke(Theme.learn.opacity(0.35), lineWidth: 1))
                .clipShape(Capsule())
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .background(Theme.card)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.rCard)
                .stroke(Theme.line, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
    }

    // MARK: - Watch list

    private func watchList(_ items: [WatchItem]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("WATCH LIST · \(items.count) \(items.count == 1 ? "ITEM" : "ITEMS")")
                .font(.label(10)).tracking(1.6)
                .foregroundStyle(Theme.goal)
                .padding(.horizontal, 24)
            VStack(spacing: 8) {
                ForEach(items) { item in
                    HStack(alignment: .top, spacing: 10) {
                        Circle()
                            .fill(item.status == "red" ? Theme.over : Theme.goal)
                            .frame(width: 8, height: 8)
                            .padding(.top, 6)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.label.uppercased())
                                .font(.label(10)).tracking(1.2)
                                .foregroundStyle(item.status == "red" ? Theme.over : Theme.goal)
                            Text(item.note)
                                .font(.body(13))
                                .foregroundStyle(Theme.ink.opacity(0.85))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer()
                    }
                    .padding(14)
                    .background((item.status == "red" ? Theme.over : Theme.goal).opacity(0.06))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.rCard)
                            .stroke((item.status == "red" ? Theme.over : Theme.goal).opacity(0.28), lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
                }
            }
            .padding(.horizontal, 24)
        }
    }

    // MARK: - Load

    private func load() async {
        async let bRes = (try? await API.briefing(surface: "health"))
        async let rRes = (try? await API.fetchReadiness())
        async let hRes = (try? await API.fetchHealthState())
        let (b, r, h) = await (bRes, rRes, hRes)
        briefing = b ?? nil
        readiness = r ?? nil
        health = h ?? nil
    }
}
