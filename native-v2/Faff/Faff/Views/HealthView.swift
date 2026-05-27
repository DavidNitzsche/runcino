//
//  HealthView.swift
//
//  2026-05-27 rebuild: David called the previous version "very slow" +
//  said "Health on iphone needs to be a bunch of cards and data that
//  is glanceable." This now shows what the web /health shows: readiness
//  ring on top, then a grid of metric cards (SLEEP / RHR / HRV /
//  WEIGHT / VO2) each with current value + a 30-day sparkline. Coach
//  voice drops to the bottom and stays out of the way — never gates
//  the cards.
//

import SwiftUI

struct HealthView: View {
    @State private var briefing: Briefing?
    @State private var readiness: ReadinessSnapshot?
    @State private var health: HealthState?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Watch-mode aware headline. Mirrors web /health.
                    headline

                    // Readiness ring hero — same component as TodayView.
                    HStack {
                        Spacer()
                        ReadinessRing(
                            score: readiness?.score,
                            label: readiness?.label,
                            size: .large
                        )
                        Spacer()
                    }
                    .padding(.vertical, 4)

                    // Metric grid — glanceable cards with sparkline.
                    metricGrid

                    // Watch list (amber/red flags) if any.
                    if let h = health, !h.watchItems.isEmpty {
                        watchList(h.watchItems)
                            .transition(.opacity)
                    }

                    // Coach prose — bottom, background-loaded, doesn't
                    // gate anything above. Tap to expand if needed.
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
            .navigationBarTitleDisplayMode(.large)
            .task { await load() }
            .refreshable { await load() }
            .sensoryFeedback(.success, trigger: readiness?.score)
        }
    }

    // MARK: - Headline

    @ViewBuilder
    private var headline: some View {
        let (text, color) = headlineForMode(health?.watchMode)
        VStack(alignment: .leading, spacing: 6) {
            Text(text)
                .font(.display(28))
                .tracking(0.4)
                .foregroundStyle(color)
            Text("LONG-TERM PATTERNS · 30-DAY VIEW\(health?.watchMode.map { " · MODE: \($0.uppercased())" } ?? "")")
                .font(.label(10)).tracking(1.4)
                .foregroundStyle(Theme.mute)
        }
        .padding(.horizontal, 24)
        .padding(.top, 4)
    }

    private func headlineForMode(_ mode: String?) -> (String, Color) {
        switch mode {
        case "watch-red":    return ("Pull back.",       Theme.over)
        case "watch-amber":  return ("Health.",          Theme.goal)
        case "green":        return ("Everything's green.", Theme.green)
        default:             return ("Health.",          Theme.ink)
        }
    }

    // MARK: - Metric grid

    private var metricGrid: some View {
        LazyVGrid(
            columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)],
            spacing: 10
        ) {
            sleepCard
            rhrCard
            hrvCard
            weightCard
            vo2Card
            cadenceCard
        }
        .padding(.horizontal, 24)
    }

    @ViewBuilder
    private var sleepCard: some View {
        let s = health?.sleep
        let series = health?.sleepSeries.map(\.hours) ?? []
        MetricCard(
            label: "SLEEP",
            value: s?.avg7n.map { String(format: "%.1f", $0) } ?? "—",
            unit: "h",
            sub: "7-NIGHT AVG · TARGET 7.5h",
            color: Theme.goal,
            series: series.suffix(30).map { $0 },
            seriesMin: 4, seriesMax: 10,
            baseline: 7.5
        )
    }

    @ViewBuilder
    private var rhrCard: some View {
        let r = health?.rhr
        let series = health?.rhrSeries.map { Double($0.bpm) } ?? []
        let elevatedRed = (r?.delta ?? 0) >= 5
        MetricCard(
            label: "RESTING HR",
            value: r?.current.map(String.init) ?? "—",
            unit: "bpm",
            sub: r?.baseline != nil
                ? "BASELINE \(r!.baseline!) · \(deltaLabel(r?.delta)) vs 60D"
                : "60-DAY BASELINE BUILDING",
            color: elevatedRed ? Theme.over : Theme.green,
            series: series.suffix(60).map { $0 },
            seriesMin: 40, seriesMax: 70,
            baseline: r?.baseline.map(Double.init)
        )
    }

    @ViewBuilder
    private var hrvCard: some View {
        let h = health?.hrv
        let series = health?.hrvSeries.map { Double($0.ms) } ?? []
        MetricCard(
            label: "HRV",
            value: h?.current.map(String.init) ?? "—",
            unit: "ms",
            sub: h?.baseline != nil ? "BASELINE \(h!.baseline!) ms · NIGHTLY" : "BASELINE BUILDING",
            color: Theme.green,
            series: series.suffix(30).map { $0 },
            seriesMin: 30, seriesMax: 100,
            baseline: h?.baseline.map(Double.init)
        )
    }

    @ViewBuilder
    private var weightCard: some View {
        let w = health?.weight
        let series = health?.weightSeries.map(\.lb) ?? []
        MetricCard(
            label: "WEIGHT",
            value: w?.current.map { String(format: "%.1f", $0) } ?? "—",
            unit: "lb",
            sub: w?.delta30 != nil
                ? "\(w!.delta30! >= 0 ? "+" : "")\(String(format: "%.1f", w!.delta30!)) lb vs 30D"
                : "30-DAY VIEW",
            color: Theme.dist,
            series: series.suffix(30).map { $0 },
            seriesMin: nil, seriesMax: nil
        )
    }

    @ViewBuilder
    private var vo2Card: some View {
        let v = health?.vo2.current
        MetricCard(
            label: "VO2 MAX",
            value: v.map { String(format: "%.1f", $0) } ?? "—",
            unit: "",
            sub: "APPLE WATCH",
            color: Theme.learn,
            series: [],
            seriesMin: nil, seriesMax: nil
        )
    }

    @ViewBuilder
    private var cadenceCard: some View {
        let c = health?.cadence.baseline
        MetricCard(
            label: "CADENCE",
            value: c.map(String.init) ?? "—",
            unit: "spm",
            sub: "BASELINE · LAST 60 DAYS",
            color: Theme.race,
            series: [],
            seriesMin: nil, seriesMax: nil
        )
    }

    // MARK: - Watch list

    private func watchList(_ items: [WatchItem]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("WATCH LIST")
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

    private func deltaLabel(_ d: Int?) -> String {
        guard let d else { return "—" }
        if d == 0 { return "flat" }
        return d > 0 ? "+\(d)" : "\(d)"
    }
}

// MARK: - MetricCard

private struct MetricCard: View {
    let label: String
    let value: String
    let unit: String
    let sub: String
    let color: Color
    let series: [Double]
    let seriesMin: Double?
    let seriesMax: Double?
    var baseline: Double? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.label(10)).tracking(1.4)
                .foregroundStyle(color)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value)
                    .font(.display(28))
                    .foregroundStyle(Theme.ink)
                if !unit.isEmpty {
                    Text(unit)
                        .font(.body(13))
                        .foregroundStyle(Theme.mute)
                }
            }
            if !series.isEmpty {
                Sparkline(values: series, color: color, min: seriesMin, max: seriesMax, baseline: baseline)
                    .frame(height: 28)
            } else {
                // Hold height even without a series so cards align.
                Rectangle()
                    .fill(Color.clear)
                    .frame(height: 28)
            }
            Text(sub)
                .font(.label(9)).tracking(1)
                .foregroundStyle(Theme.mute)
                .fixedSize(horizontal: false, vertical: true)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.card)
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
    }
}

// MARK: - Sparkline

private struct Sparkline: View {
    let values: [Double]
    let color: Color
    var min: Double? = nil
    var max: Double? = nil
    var baseline: Double? = nil

    var body: some View {
        GeometryReader { geo in
            let lo = min ?? (values.min() ?? 0)
            let hi = max ?? (values.max() ?? 1)
            let range = Swift.max(0.01, hi - lo)
            let count = Swift.max(1, values.count - 1)

            ZStack {
                // Baseline dashed line if set
                if let b = baseline, b >= lo, b <= hi {
                    let y = geo.size.height * (1 - CGFloat((b - lo) / range))
                    Path { p in
                        p.move(to: CGPoint(x: 0, y: y))
                        p.addLine(to: CGPoint(x: geo.size.width, y: y))
                    }
                    .stroke(Theme.line, style: StrokeStyle(lineWidth: 1, dash: [2, 3]))
                }
                // Bars
                HStack(alignment: .bottom, spacing: 2) {
                    ForEach(Array(values.enumerated()), id: \.offset) { _, v in
                        let h = CGFloat((Swift.min(hi, Swift.max(lo, v)) - lo) / range)
                            * geo.size.height
                        Capsule()
                            .fill(color.opacity(0.78))
                            .frame(width: Swift.max(1, (geo.size.width - CGFloat(count) * 2) / CGFloat(values.count)),
                                   height: Swift.max(2, h))
                    }
                }
                .frame(maxHeight: .infinity, alignment: .bottom)
            }
        }
    }
}
