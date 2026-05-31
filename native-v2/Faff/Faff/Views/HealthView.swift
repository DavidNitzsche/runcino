//
//  HealthView.swift
//  v3 Health tab · readiness ring + chips strip + focus chart.
//  Tap the ring → readiness breakdown sheet.
//

import SwiftUI

struct HealthView: View {
    let onProfile: () -> Void

    enum Lens: String, CaseIterable { case body, form }

    @State private var state: HealthState? =
        AppCache.read(.healthState, as: HealthState.self)
    @State private var readiness: ReadinessSnapshot? =
        AppCache.read(.readiness, as: ReadinessSnapshot.self)
    @State private var healthFacts: CoachFactsBlock?
    @State private var lens: Lens = .body
    @State private var metric: String = "hrv"
    @State private var sheet: Bool = false
    @State private var scrubReadout: String?
    /// Async-fetch lifecycle for /api/health · drives the FailedLoadBanner
    /// shown when the fetch errors AND there's no cached HealthState.
    @State private var loadState: LoadState = AppCache.read(.healthState, as: HealthState.self) == nil ? .idle : .loaded

    var body: some View {
        ZStack {
            FaffMeshView(mesh: FaffMesh.forView(.health))

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    PageHeader(title: "HEALTH",
                               rightLabel: todayLabel,
                               avatarInitials: nil)
                        .padding(.horizontal, 24).padding(.top, 12)

                    if let msg = loadState.failureMessage, state == nil {
                        FailedLoadBanner(message: msg, retry: { Task { await reload() } })
                            .padding(.horizontal, 22).padding(.top, 12)
                    }

                    heroBlock
                        .padding(.horizontal, 24).padding(.top, 14)

                    if !whatsMovingFacts.isEmpty {
                        SectionLabel(title: "WHAT'S MOVING")
                            .padding(.horizontal, 22).padding(.top, 22)
                        whatsMovingCard
                            .padding(.horizontal, 22).padding(.top, 12)
                    }

                    lensToggle
                        .padding(.horizontal, 22).padding(.top, 18)

                    chipsStrip
                        .padding(.vertical, 14)

                    focusChart
                        .padding(.horizontal, 22).padding(.bottom, 22)

                    SectionLabel(title: "LEARN THE DOCTRINE")
                        .padding(.horizontal, 22).padding(.top, 12)
                    learnLinks
                        .padding(.horizontal, 22).padding(.top, 10).padding(.bottom, 40)
                }
                .padding(.bottom, 120)
            }
        }
        .task { await reload() }
        .refreshable { await reload() }
        .sheet(isPresented: $sheet) { ReadinessBreakdownSheet(snapshot: readiness) }
    }

    /// Doctrine entry points. Each tile pushes onto the tab's NavigationStack
    /// via FaffRoute.learn(slug:) — landing in LearnArticleSheet. Slugs match
    /// the article SEED in web-v2/app/learn/[slug]/seed.ts.
    private var learnLinks: some View {
        VStack(spacing: 8) {
            learnTile(slug: "why-rest-works", title: "Why rest works", eyebrow: "RECOVERY")
            learnTile(slug: "hrv",             title: "HRV — what it is",       eyebrow: "PHYSIOLOGY")
            learnTile(slug: "rhr",             title: "Resting heart rate",     eyebrow: "PHYSIOLOGY")
            learnTile(slug: "heart-rate-zones",title: "Heart-rate zones, Friel-style", eyebrow: "METHODOLOGY")
            learnTile(slug: "vo2-max",         title: "VO2 max",                eyebrow: "PHYSIOLOGY")
        }
    }

    private func learnTile(slug: String, title: String, eyebrow: String) -> some View {
        NavigationLink(value: FaffRoute.learn(slug: slug)) {
            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    SpecLabel(text: eyebrow, size: 9, tracking: 1.5, color: Theme.txt.opacity(0.5))
                    Text(title)
                        .font(.body(14, weight: .semibold))
                        .foregroundStyle(Theme.txt)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.4))
            }
            .padding(14)
            .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color.white.opacity(0.10), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func reload() async {
        if state == nil { await MainActor.run { loadState = .loading } }
        async let r = (try? await API.fetchReadiness())
        async let f = (try? await API.fetchCoachFacts(surface: "health"))
        do {
            let st = try await API.fetchHealthState()
            let (rd, fc) = await (r, f)
            await MainActor.run {
                if let st {
                    self.state = st
                    self.loadState = .loaded
                } else {
                    self.loadState = .failed("Couldn't read health data.")
                }
                if let rd { self.readiness = rd }
                if let fc { self.healthFacts = fc }
            }
        } catch {
            let msg = loadFailureMessage(error)
            let (rd, fc) = await (r, f)
            await MainActor.run {
                self.loadState = .failed(msg)
                if let rd { self.readiness = rd }
                if let fc { self.healthFacts = fc }
            }
        }
    }

    private var whatsMovingFacts: [CoachFact] { healthFacts?.facts ?? [] }

    private var whatsMovingCard: some View {
        GlassTile(padding: 0) {
            VStack(spacing: 0) {
                ForEach(Array(whatsMovingFacts.enumerated()), id: \.element.label) { i, f in
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 3) {
                            SpecLabel(text: f.label, size: 10, tracking: 1.5, color: Theme.txt.opacity(0.55))
                            if let meta = f.meta, !meta.isEmpty {
                                Text(meta)
                                    .font(.display(11, weight: .semibold))
                                    .foregroundStyle(Theme.txt.opacity(0.62))
                                    .lineLimit(2)
                            }
                        }
                        Spacer(minLength: 12)
                        Text(f.value)
                            .font(.display(15, weight: .bold))
                            .foregroundStyle(factTint(f.valueColor))
                            .multilineTextAlignment(.trailing)
                    }
                    .padding(14)
                    if i < whatsMovingFacts.count - 1 {
                        Divider().background(Color.white.opacity(0.08))
                    }
                }
            }
        }
    }

    private func factTint(_ tone: String?) -> Color {
        switch (tone ?? "").lowercased() {
        case "race":  return Theme.race
        case "green": return Theme.green
        case "amber": return Theme.goal
        case "over":  return Theme.over
        default:      return Theme.txt
        }
    }

    // MARK: - Hero

    private var heroBlock: some View {
        HStack(alignment: .top, spacing: 20) {
            Button { sheet = true } label: {
                ReadinessRing(
                    score: readiness?.score ?? 0,
                    size: 128,
                    color: Color(hex: 0x62E08A),
                    trackColor: Color.white.opacity(0.16),
                    subLabel: ReadinessRing.classify(readiness?.score ?? 0)?.uppercased(),
                    breathing: true
                )
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 6) {
                SpecLabel(text: "READINESS", size: 11, tracking: 2, color: Theme.txt.opacity(0.6))
                Text(readinessSubText)
                    .font(.body(14, weight: .bold))
                    .lineSpacing(2)
                    .foregroundStyle(Theme.txt.opacity(0.92))
                HStack(spacing: 14) {
                    feeder("SLEEP", value: sleepText)
                    feeder("HRV", value: hrvText, trendUp: hrvTrendGood)
                    feeder("RHR", value: rhrText, trendUp: rhrTrendGood)
                }
                .padding(.top, 8)
            }
        }
    }

    private var todayLabel: String {
        let f = DateFormatter(); f.dateFormat = "EEE · MMM d"
        return f.string(from: Date()).uppercased()
    }

    private var readinessSubText: String {
        switch readiness?.score ?? 0 {
        case 70...: return "Recovered and ready for a quality session today."
        case 55..<70: return "Recover into the day. Easy effort fits best."
        case 1..<55: return "Body is asking for slack. Move it down a notch."
        default: return "Awaiting your first sample."
        }
    }

    private var sleepText: String {
        guard let s = state?.sleep.avg7n else { return "—" }
        let h = Int(s); let m = Int((s - Double(h)) * 60)
        return String(format: "%d:%02d", h, m)
    }
    private var hrvText: String { state?.hrv.current.map(String.init) ?? "—" }
    private var rhrText: String { state?.rhr.current.map(String.init) ?? "—" }
    private var hrvTrendGood: Bool? { (state?.hrv.pctAboveBaseline ?? 0) > 0 }
    private var rhrTrendGood: Bool? {
        guard let cur = state?.rhr.current, let base = state?.rhr.baseline else { return nil }
        return cur < base
    }

    private func feeder(_ key: String, value: String, trendUp: Bool? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            SpecLabel(text: key, size: 8.5, tracking: 1, color: Theme.txt.opacity(0.55))
            HStack(spacing: 3) {
                Text(value)
                    .font(.display(14, weight: .semibold))
                    .tracking(-0.3)
                    .foregroundStyle(Theme.txt)
                if let up = trendUp {
                    Text(up ? "↑" : "↓")
                        .font(.display(11, weight: .bold))
                        .foregroundStyle(up ? Color(hex: 0x7BE8A0) : Color(hex: 0xFFB24D))
                }
            }
        }
    }

    // MARK: - Lens toggle

    private var lensToggle: some View {
        HStack(spacing: 0) {
            ForEach(Lens.allCases, id: \.self) { l in
                Button {
                    withAnimation(Theme.Motion.smooth) {
                        lens = l
                        metric = (l == .body ? bodyMetrics : formMetrics).first ?? "hrv"
                    }
                } label: {
                    Text(l == .body ? "BODY" : "FORM")
                        .font(.body(13, weight: .extraBold))
                        .tracking(1)
                        .foregroundStyle(lens == l ? Color(hex: 0x06302E) : Theme.txt)
                        .frame(maxWidth: .infinity, minHeight: 38)
                        .background(lens == l ? Color.white : Color.clear, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(Color.white.opacity(0.12), in: Capsule())
        .overlay(Capsule().stroke(Color.white.opacity(0.2)))
    }

    private var bodyMetrics: [String] { ["hrv","rhr","sleep","weight","vo2"] }
    private var formMetrics: [String] { ["cadence","gct","vosc","stride","balance"] }
    private var activeMetrics: [String] { lens == .body ? bodyMetrics : formMetrics }

    // MARK: - Chips strip

    private var chipsStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(activeMetrics, id: \.self) { k in
                    metricChip(k)
                }
            }
            .padding(.horizontal, 22)
        }
    }

    private func metricChip(_ k: String) -> some View {
        let on = metric == k
        return Button { withAnimation(Theme.Motion.smooth) { metric = k } } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 5) {
                    Circle().fill(Color(hex: 0x62E08A)).frame(width: 6, height: 6)
                    Text(metricShort(k))
                        .font(.body(8.5, weight: .extraBold))
                        .tracking(1)
                        .foregroundStyle(on ? Color(hex: 0x0A3A36).opacity(0.7) : Theme.txt.opacity(0.62))
                }
                Text(metricValue(k))
                    .font(.display(18, weight: .semibold))
                    .tracking(-0.5)
                    .foregroundStyle(on ? Color(hex: 0x06302E) : Theme.txt)
            }
            .frame(minWidth: 78, alignment: .leading)
            .padding(.horizontal, 13).padding(.vertical, 9)
            .background(on ? Color.white.opacity(0.95) : Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(on ? 1 : 0.16)))
        }
        .buttonStyle(.plain)
    }

    private func metricShort(_ k: String) -> String {
        ["hrv":"HRV","rhr":"RHR","sleep":"SLEEP","weight":"WT","vo2":"VO2",
         "cadence":"CAD","gct":"GCT","vosc":"VOSC","stride":"STR","balance":"L/R"][k] ?? k.uppercased()
    }

    private func metricValue(_ k: String) -> String {
        switch k {
        case "hrv": return hrvText
        case "rhr": return rhrText
        case "sleep": return sleepText
        case "weight": return state?.weight.current.map { String(format: "%.1f", $0) } ?? "—"
        case "vo2": return state?.vo2.current.map { String(format: "%.0f", $0) } ?? "—"
        case "cadence": return state?.cadence.baseline.map(String.init) ?? "—"
        default: return "—"
        }
    }

    // MARK: - Focus chart

    private var focusChart: some View {
        let series = seriesFor(metric)
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(metricShort(metric).uppercased())
                    .font(.label(12)).tracking(1.5).textCase(.uppercase)
                    .foregroundStyle(Theme.txt.opacity(0.66))
                Spacer()
            }
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(metricValue(metric))
                    .font(.display(52, weight: .bold))
                    .tracking(-2.5)
                    .foregroundStyle(Theme.txt)
                    .shadow(color: .black.opacity(0.3), radius: 22, y: 2)
            }
            if let read = scrubReadout {
                SpecLabel(text: read, size: 11, tracking: 1, color: Color(hex: 0x9AF0BF))
            }
            ScrubbableTrace(points: series, labels: [], color: Color(hex: 0x62E08A), fill: true, target: nil, band: nil, readout: $scrubReadout)
                .frame(height: 180)
                .padding(.top, 6)
            HStack {
                let labels = xAxisLabels(for: metric)
                Text(labels.0).font(.display(9, weight: .semibold)).foregroundStyle(Theme.txt.opacity(0.45))
                Spacer()
                Text(labels.1).font(.display(9, weight: .semibold)).foregroundStyle(Theme.txt.opacity(0.45))
                Spacer()
                Text(labels.2).font(.display(9, weight: .semibold)).foregroundStyle(Theme.txt.opacity(0.45))
            }
            .padding(.top, 4)
        }
    }

    private func seriesFor(_ k: String) -> [Double] {
        guard let s = state else { return Array(repeating: 0, count: 30) }
        switch k {
        case "rhr":    return s.rhrSeries.map { Double($0.bpm) }
        case "hrv":    return s.hrvSeries.map { Double($0.ms) }
        case "sleep":  return s.sleepSeries.map { $0.hours }
        case "weight": return s.weightSeries.map { $0.lb }
        default:       return []
        }
    }

    /// First / middle / "TODAY" labels derived from the active series' real
    /// dates. Falls back to the static labels when the series is empty.
    private func xAxisLabels(for k: String) -> (String, String, String) {
        let dates: [String] = {
            guard let s = state else { return [] }
            switch k {
            case "rhr":    return s.rhrSeries.map { $0.date }
            case "hrv":    return s.hrvSeries.map { $0.date }
            case "sleep":  return s.sleepSeries.map { $0.date }
            case "weight": return s.weightSeries.map { $0.date }
            default:       return []
            }
        }()
        guard dates.count >= 3 else { return ("4 WEEKS AGO", "2W", "TODAY") }
        let f = DateFormatter(); f.dateFormat = "MMM d"
        let isoIn = DateFormatter(); isoIn.dateFormat = "yyyy-MM-dd"
        let first = isoIn.date(from: dates.first ?? "").map { f.string(from: $0).uppercased() } ?? ""
        let mid   = isoIn.date(from: dates[dates.count / 2]).map { f.string(from: $0).uppercased() } ?? ""
        return (first.isEmpty ? "4 WEEKS AGO" : first, mid.isEmpty ? "2W" : mid, "TODAY")
    }
}

// MARK: - Readiness breakdown sheet

struct ReadinessBreakdownSheet: View {
    let snapshot: ReadinessSnapshot?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color(hex: 0x061E1C).ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    HStack(alignment: .lastTextBaseline, spacing: 13) {
                        Text("\(snapshot?.score ?? 0)")
                            .font(.display(62, weight: .bold))
                            .tracking(-3)
                            .foregroundStyle(Theme.txt)
                            .shadow(color: .black.opacity(0.3), radius: 18, y: 2)
                        Text((snapshot?.label ?? "").uppercased())
                            .font(.label(13)).tracking(3)
                            .foregroundStyle(Color(hex: 0x9AF0BF))
                        Spacer()
                    }

                    VStack(spacing: 10) {
                        Rectangle()
                            .fill(LinearGradient(colors: [Color(hex: 0x2B6F68), Color(hex: 0x2F9A7E), Color(hex: 0x62E08A), Color(hex: 0xBFFFD0)],
                                                 startPoint: .leading, endPoint: .trailing))
                            .frame(height: 12)
                            .clipShape(Capsule())
                            .overlay(alignment: .leading) {
                                GeometryReader { geo in
                                    Capsule()
                                        .fill(Color.white)
                                        .frame(width: 3, height: 22)
                                        .offset(x: geo.size.width * CGFloat(Double(snapshot?.score ?? 0) / 100.0) - 1.5, y: -5)
                                        .shadow(color: .white.opacity(0.8), radius: 6)
                                }
                            }
                        HStack {
                            ForEach(["EASY","STEADY","READY","PRIMED","PEAK"], id: \.self) { l in
                                Text(l).font(.label(8.5)).tracking(0.5).foregroundStyle(Theme.txt.opacity(0.5))
                                    .frame(maxWidth: .infinity)
                            }
                        }
                    }

                    SpecLabel(text: "WHAT'S DRIVING IT", size: 11, tracking: 2, color: Theme.txt.opacity(0.6))

                    ForEach((snapshot?.inputs ?? []), id: \.key) { i in
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(i.label)
                                    .font(.body(14, weight: .extraBold))
                                    .foregroundStyle(Theme.txt)
                                Text(i.meaning)
                                    .font(.display(10, weight: .semibold))
                                    .foregroundStyle(Theme.txt.opacity(0.62))
                                    .lineLimit(2)
                            }
                            Spacer()
                            Text(i.observedV ?? "")
                                .font(.display(15, weight: .semibold))
                                .foregroundStyle(i.weight >= 0 ? Color(hex: 0x7BE8A0) : Color(hex: 0xFFB24D))
                        }
                        .padding(.vertical, 8)
                    }
                    Spacer()
                }
                .padding(24)
            }
        }
    }
}

// ReadinessSnapshot.inputs is now a real wire-decoded field of type
// [ReadinessInput]? (see API.swift). The previous adapter extension was a
// placeholder that always returned an empty array · removed 2026-05-31
// once the actual /api/readiness payload's inputs[] block landed on the
// iPhone.
