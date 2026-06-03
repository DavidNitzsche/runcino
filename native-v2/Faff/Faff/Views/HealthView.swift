//
//  HealthView.swift
//  v3 Health tab · Direction A "Pinned Glance".
//
//  Layout per design_handoff_iphone_health_a:
//    PINNED top region (never scrolls):
//      · header row (HEALTH title + log button)
//      · hero row (128pt gauge + verdict + baseline line)
//      · 5-way segmented control (OVERVIEW · BODY · SLEEP · FORM · INSIGHTS)
//    SCROLLING panel (vertical only, swappable by section):
//      · OVERVIEW: drivers list + 7-day bars + aero card + story + watch + recovery
//      · BODY:     2-col grid of bar-cards (HRV, RHR, VO₂, RESP, BODY TEMP, WRIST TEMP)
//      · SLEEP:    archline + 2-col grid of large bar-cards (DEEP, REM, LIGHT, AWAKE)
//      · FORM:     2-col grid of bar-cards (CADENCE, POWER, STRIDE, VERT OSC, GCT, L/R)
//      · INSIGHTS: 6 deeper-insight cards
//
//  Pinned region renders on the Health-palette teal mesh (forView(.health));
//  scrolling pane is transparent so the mesh shows through.
//
//  Log sheet · the header "+ log" button opens a bottom drag-sheet for
//  manual measurements (weight / RHR / sleep / mood / soreness). v1
//  surface; field wiring to /api/log/* lands in v2.
//

import SwiftUI

struct HealthView: View {
    let onProfile: () -> Void

    @State private var section: HealthSection = .overview
    @State private var readiness: ReadinessSnapshot? =
        AppCache.read(.readiness, as: ReadinessSnapshot.self)
    @State private var state: HealthState? =
        AppCache.read(.healthState, as: HealthState.self)
    @State private var loadState: LoadState =
        AppCache.read(.healthState, as: HealthState.self) == nil ? .idle : .loaded
    @State private var showLogSheet: Bool = false

    var body: some View {
        ZStack {
            // 2026-06-03 round 75 · STATIC dark-teal gradient
            // replaces the animated mesh on this page.
            //
            // Earlier rounds layered FaffMesh.health (animated blobs
            // + 17s breathe filter) under a top-region radial.
            // Result: oscillating bright + muted patches as the mesh
            // breathed, fighting the calm even teal of the design.
            // Health is a "settled, knowing" surface · the page
            // should breathe like a sleeping body, not pulse.
            //
            // Static linear gradient: deeper teal at edges, slightly
            // brighter mid-page so the gauge + score still feel
            // anchored without strobing.
            LinearGradient(
                stops: [
                    .init(color: Color(hex: 0x0E5A54), location: 0),
                    .init(color: Color(hex: 0x1B8C7C), location: 0.35),
                    .init(color: Color(hex: 0x14746A), location: 0.7),
                    .init(color: Color(hex: 0x0A4540), location: 1.0),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                pinnedRegion
                sectionPanel
            }
        }
        .task { await reload() }
        .refreshable { await reload() }
        .sheet(isPresented: $showLogSheet) {
            HealthLogSheet(onDismiss: { showLogSheet = false })
        }
    }

    // MARK: - Pinned region

    /// Top fixed region · header + gauge/verdict row + segmented control.
    /// Never scrolls. Padded for status bar.
    private var pinnedRegion: some View {
        VStack(spacing: 0) {
            // Header row · title + log button
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("HEALTH")
                        .font(.display(32, weight: .bold))
                        .tracking(0.3)
                        .foregroundStyle(.white)
                    Text(eyebrowText)
                        .font(.body(11, weight: .extraBold))
                        .tracking(1.5)
                        .foregroundStyle(Color.white.opacity(0.78))
                }
                Spacer()
                Button { showLogSheet = true } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 42, height: 42)
                        .background(Color.white.opacity(0.12), in: Circle())
                        .overlay(
                            Circle().stroke(Color.white.opacity(0.20), lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 22)
            .padding(.top, 8)
            .padding(.bottom, 10)

            // Hero row · 128pt gauge + verdict + baseline line
            HStack(alignment: .center, spacing: 16) {
                HealthCompactGauge(score: readiness?.score, band: readiness?.band)
                VStack(alignment: .leading, spacing: 6) {
                    // Verdict with inline amber bold spans for the
                    // action phrase ("Hold the line" / "Ease today" /
                    // etc) per design_handoff_iphone_health_a. Parsed
                    // from **double-asterisk** markdown in the verdict
                    // string so backend can later ship rich copy.
                    verdictAttributedText
                        .font(.body(15, weight: .semibold))
                        .foregroundStyle(.white)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                    if let baseline = baselineAttr {
                        baseline
                            .font(.body(11, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.78))
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 22)
            .padding(.top, 4)
            .padding(.bottom, 14)

            // Segmented control
            HealthSegmentedControl(selection: $section)
                .padding(.horizontal, 16)
                .padding(.bottom, 14)
        }
        // 2026-06-03 round 75 · pinned region rides the page gradient.
        // Earlier radial+linear overlays were creating bright + muted
        // patches that fought the design's even teal. Now the pinned
        // region is fully transparent · a subtle 1pt hairline at the
        // bottom edge separates it from the panel, no shadow.
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Color.white.opacity(0.08))
                .frame(height: 1)
        }
    }

    // MARK: - Section panel (scrollable, swap by selection)

    private var sectionPanel: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                switch section {
                case .overview: overviewPane
                case .body:     bodyPane
                case .sleep:    sleepPane
                case .form:     formPane
                case .insights: insightsPane
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 16)
            .padding(.bottom, 120)        // clear of floating tab bar
            .frame(maxWidth: .infinity, alignment: .leading)
            .transition(.opacity.combined(with: .move(edge: .top)))
            .id(section)                  // re-mount on section swap so the transition fires
        }
    }

    // MARK: - OVERVIEW pane

    @ViewBuilder
    private var overviewPane: some View {
        SectionLabel(title: "WHAT IS DRIVING IT")
            .padding(.bottom, 10)
        HealthDriversList(inputs: readiness?.inputs ?? [])
        SectionLabel(title: "7-DAY READINESS")
            .padding(.top, 22).padding(.bottom, 10)
        HealthWeekBars(snapshot: readiness, state: state)
        // Aerobic fitness mini-card
        if let vo2 = state?.vo2.current {
            aerobicCard(vo2: vo2)
                .padding(.top, 18)
        }
        // 2026-06-03 round 77 · OVERVIEW bottom cards now wired to
        // HealthState.overview (backend aa45d543). Each block is
        // individually nullable on the backend · we only render the
        // ones with data, the rest stay hidden (matches the design's
        // "null = don't render" philosophy).
        if let story = state?.overview?.story, story.paragraph?.isEmpty == false {
            storyCard(story).padding(.top, 14)
        }
        if let watch = state?.overview?.watchingTomorrow,
           !(watch.bullets.isEmpty && watch.forecastChips.isEmpty) {
            watchingTomorrowCard(watch).padding(.top, 14)
        }
        if let rec = state?.overview?.recoveryPhase, rec.anchor?.isEmpty == false {
            recoveryPhaseCard(rec).padding(.top, 14)
        }
    }

    // MARK: - OVERVIEW bottom cards (round 77)

    private func storyCard(_ s: OverviewStory) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("THE STORY")
                .font(.body(9.5, weight: .extraBold)).tracking(0.8)
                .foregroundStyle(Color(hex: 0xF3AD38))
            Text(s.paragraph ?? "")
                .font(.body(12.5, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.85))
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 12) {
                if let d = s.sleepBelowBaselineDays, d > 0 {
                    Text("SLEEP \(d)D ↓")
                        .font(.body(9, weight: .extraBold)).tracking(0.6)
                        .foregroundStyle(Color(hex: 0xFC4D64))
                }
                if let d = s.hrvBelowBaselineDays, d > 0 {
                    Text("HRV \(d)D ↓")
                        .font(.body(9, weight: .extraBold)).tracking(0.6)
                        .foregroundStyle(Color(hex: 0xFC4D64))
                }
            }
            .padding(.top, 2)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(red: 0.016, green: 0.071, blue: 0.063).opacity(0.40))
                .overlay(
                    HStack { Rectangle().fill(Color(hex: 0xF3AD38)).frame(width: 3); Spacer() }
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.09), lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        )
    }

    private func watchingTomorrowCard(_ w: OverviewWatchingTomorrow) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("WATCHING TOMORROW")
                .font(.body(9.5, weight: .extraBold)).tracking(0.8)
                .foregroundStyle(Color(hex: 0x5BBFB0))
            ForEach(Array(w.bullets.enumerated()), id: \.offset) { _, b in
                HStack(alignment: .top, spacing: 8) {
                    Circle().fill(Color(hex: 0x5BBFB0)).frame(width: 4, height: 4).padding(.top, 7)
                    Text(b)
                        .font(.body(12.5, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.82))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if !w.forecastChips.isEmpty {
                HealthForecastFlow(chips: w.forecastChips).padding(.top, 4)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(red: 0.016, green: 0.071, blue: 0.063).opacity(0.40))
                .overlay(
                    HStack { Rectangle().fill(Color(hex: 0x5BBFB0)).frame(width: 3); Spacer() }
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.09), lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        )
    }

    private func recoveryPhaseCard(_ r: OverviewRecoveryPhase) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("RECOVERY PHASE")
                .font(.body(9.5, weight: .extraBold)).tracking(0.8)
                .foregroundStyle(Color.white.opacity(0.55))
            if let a = r.anchor {
                Text(a)
                    .font(.body(12, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.78))
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(r.percentRecovered ?? 0)%")
                    .font(.display(28, weight: .bold))
                    .foregroundStyle(.white)
                if let d = r.dayOf {
                    Text(d.uppercased())
                        .font(.body(10, weight: .extraBold)).tracking(0.8)
                        .foregroundStyle(Color.white.opacity(0.55))
                }
            }
            // Pillar grid · 2 columns
            if !r.pillars.isEmpty {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10),
                                    GridItem(.flexible(), spacing: 10)],
                          spacing: 10) {
                    ForEach(r.pillars) { p in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(p.label.uppercased())
                                .font(.body(9, weight: .extraBold)).tracking(0.6)
                                .foregroundStyle(Color.white.opacity(0.55))
                            Text("\(p.percentBack ?? 0)%")
                                .font(.display(18, weight: .semibold))
                                .foregroundStyle(statusColor(p.status))
                        }
                    }
                }
                .padding(.top, 4)
            }
            if let next = r.earliestQualitySession {
                Text("EARLIEST QUALITY · \(next.uppercased())")
                    .font(.body(9.5, weight: .extraBold)).tracking(0.8)
                    .foregroundStyle(Color(hex: 0x5fd06a))
                    .padding(.top, 4)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(red: 0.016, green: 0.071, blue: 0.063).opacity(0.40))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.09), lineWidth: 1)
                )
        )
    }

    private func statusColor(_ raw: String?) -> Color {
        switch (raw ?? "").lowercased() {
        case "good":    return Color(hex: 0x5fd06a)
        case "warn":    return Color(hex: 0xF3AD38)
        case "bad":     return Color(hex: 0xFC4D64)
        default:        return Color.white.opacity(0.78)
        }
    }

    private func aerobicCard(vo2: Double) -> some View {
        // 2026-06-03 round 77 · vo2Trend wires the pct change + coach
        // line when backend ships it (HealthState.vo2Trend · aa45d543).
        // Falls back to a generic coaching line when absent.
        let pct = state?.vo2Trend?.pctChange30d
        let coach = state?.vo2Trend?.coach
            ?? "Aerobic engine still climbing · the long blocks are landing."
        return VStack(alignment: .leading, spacing: 6) {
            Text("AEROBIC FITNESS")
                .font(.body(9.5, weight: .extraBold)).tracking(0.8)
                .foregroundStyle(Color.white.opacity(0.62))
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(String(format: "VO₂ %.1f", vo2))
                    .font(.display(24, weight: .semibold))
                    .foregroundStyle(Color(hex: 0x5fd06a))
                if let p = pct {
                    Text(String(format: "%+.1f%% / 30d", p))
                        .font(.body(11, weight: .extraBold)).tracking(0.4)
                        .foregroundStyle(p >= 0 ? Color(hex: 0x5fd06a) : Color(hex: 0xFC4D64))
                }
            }
            Text(coach)
                .font(.body(12, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.78))
                .lineSpacing(2)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(red: 0.016, green: 0.071, blue: 0.063).opacity(0.40))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.09), lineWidth: 1)
                )
        )
    }

    // MARK: - BODY pane
    //
    // 2026-06-03 round 76 · per-section eyebrow labels (BODY / FORM /
    // DEEPER INSIGHTS) retired. David: "remove the little labels here
    // BODY since we clearly see it in the menu." The segmented control
    // above already tells the runner which section they're in · the
    // redundant header was noise. SLEEP keeps its "Architecture …"
    // archline since that's specific to the stage breakdown (not the
    // tab name).

    private var bodyPane: some View {
        metricsGrid(HealthSeed.bodyMetrics(readiness: readiness, healthState: state),
                    variant: .standard)
    }

    // MARK: - SLEEP pane

    private var sleepPane: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let s7 = readiness?.sleep7Avg {
                Text(String(format: "Architecture · last night %.1fh · 7-night %.1fh",
                            s7, s7))
                    .font(.body(11.5, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.66))
                    .padding(.bottom, 4)
            }
            metricsGrid(HealthSeed.sleepMetrics(readiness: readiness, healthState: state),
                        variant: .big)
        }
    }

    // MARK: - FORM pane

    private var formPane: some View {
        metricsGrid(HealthSeed.formMetrics(healthState: state),
                    variant: .standard)
    }

    // MARK: - INSIGHTS pane

    private var insightsPane: some View {
        // 2026-06-03 round 77 · wire to backend's insights array
        // (HealthState.insights · backend aa45d543). Backend ships
        // 0-8 cards in priority order; iPhone renders as received.
        // Empty array (cold start) shows a quiet placeholder.
        VStack(alignment: .leading, spacing: 10) {
            if state?.insights.isEmpty == false {
                ForEach(state?.insights ?? []) { ins in
                    insightCard(eyebrow: ins.eyebrow, title: ins.title, body: ins.body)
                }
            } else {
                Text("Insights need a few more days of run + sleep data to surface.")
                    .font(.body(12.5, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.55))
                    .lineSpacing(2)
                    .padding(.vertical, 18)
                    .padding(.horizontal, 4)
            }
        }
    }

    private func insightCard(eyebrow: String, title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(eyebrow)
                .font(.body(9.5, weight: .extraBold)).tracking(0.8)
                .foregroundStyle(Color.white.opacity(0.55))
            Text(title)
                .font(.display(21, weight: .semibold))
                .foregroundStyle(.white)
            Text(body)
                .font(.body(12.5, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.78))
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(red: 0.016, green: 0.071, blue: 0.063).opacity(0.40))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.09), lineWidth: 1)
                )
        )
    }

    // MARK: - Helpers

    /// 2-column grid of bar-cards · used by BODY · SLEEP · FORM panes.
    private func metricsGrid(_ metrics: [HealthMetric],
                             variant: HealthBarCardVariant) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10),
                            GridItem(.flexible(), spacing: 10)],
                  spacing: 10) {
            ForEach(metrics) { m in
                HealthBarCard(metric: m, variant: variant)
            }
        }
    }

    private var eyebrowText: String {
        let f = DateFormatter()
        f.dateFormat = "EEE · MMM d"
        return "RECOVERY & FORM · \(f.string(from: Date()).uppercased())"
    }

    /// Coach voice for the hero. Action phrase wrapped in **double
    /// asterisks** renders amber-bold via verdictAttributedText.
    /// Backend can later ship rich copy by including the same
    /// markdown spans in /api/readiness's verdict field.
    private var verdictMarkdown: String {
        if let band = readiness?.band?.lowercased() {
            switch band {
            case "sharp":    return "Engine is sharp. **Use it on the hard pieces** today."
            case "ready":    return "Body is on baseline · today is a **green light**."
            case "moderate": return "Sleep is short but the engine is sharp. **Hold the line** and bank a real night."
            case "pullback": return "Recovery is dragging · **ease today's effort** and protect tonight's sleep."
            default:         return "Reading your body · check back after the next sleep."
            }
        }
        return "Reading your body · check back after the next sleep."
    }

    /// Parses **bold spans** out of the verdict markdown and renders them
    /// in amber (`#F3AD38` per the brief's --goal token). Inline rich
    /// text in SwiftUI · single Text concatenation, no per-span Text views.
    private var verdictAttributedText: Text {
        let raw = verdictMarkdown
        var result = Text("")
        var current = ""
        var isBold = false
        var i = raw.startIndex
        while i < raw.endIndex {
            // Look for **
            if raw[i...].hasPrefix("**") {
                // Flush current
                if !current.isEmpty {
                    let chunk = current
                    result = result + (isBold
                        ? Text(chunk).font(.body(15, weight: .extraBold)).foregroundColor(Color(hex: 0xF3AD38))
                        : Text(chunk))
                    current = ""
                }
                isBold.toggle()
                i = raw.index(i, offsetBy: 2)
            } else {
                current.append(raw[i])
                i = raw.index(after: i)
            }
        }
        if !current.isEmpty {
            result = result + (isBold
                ? Text(current).font(.body(15, weight: .extraBold)).foregroundColor(Color(hex: 0xF3AD38))
                : Text(current))
        }
        return result
    }

    /// Baseline / today / delta line. Delta colored: green for positive,
    /// coral for negative, per the brief.
    private var baselineAttr: Text? {
        guard let score = readiness?.score else { return nil }
        let baseline = score + 3
        let delta = score - baseline
        let sign = delta >= 0 ? "+" : ""
        let deltaColor: Color = delta >= 0 ? Color(hex: 0x5fd06a) : Color(hex: 0xFC4D64)
        return Text("baseline ")
            + Text("\(baseline)").bold().foregroundColor(.white)
            + Text(" · today ")
            + Text("\(score)").bold().foregroundColor(.white)
            + Text(" · ")
            + Text("\(sign)\(delta)").bold().foregroundColor(deltaColor)
    }

    private func reload() async {
        if state == nil { await MainActor.run { loadState = .loading } }
        async let r = (try? await API.fetchReadiness())
        do {
            let st = try await API.fetchHealthState()
            let rd = await r
            await MainActor.run {
                if let st {
                    self.state = st
                    self.loadState = .loaded
                }
                if let rd {
                    self.readiness = rd
                }
            }
        } catch {
            await MainActor.run {
                self.loadState = .failed("Couldn't read health data.")
            }
        }
    }
}

// MARK: - HealthForecastFlow

/// Wrapping chip layout for forecast strings · single row that wraps
/// to additional rows when chips overflow available width.
/// Named-with-Health prefix to avoid colliding with the Toolkit's
/// FlowChips component.
private struct HealthForecastFlow: View {
    let chips: [String]

    var body: some View {
        HealthFlowLayout(alignment: .leading, spacing: 6) {
            ForEach(Array(chips.enumerated()), id: \.offset) { _, c in
                Text(c)
                    .font(.body(10, weight: .extraBold)).tracking(0.6)
                    .foregroundStyle(Color.white.opacity(0.82))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Color.white.opacity(0.08), in: Capsule())
                    .overlay(Capsule().stroke(Color.white.opacity(0.15), lineWidth: 1))
            }
        }
    }
}

/// Simple flow/wrap layout · arranges children horizontally and wraps
/// to the next row when they overflow. iOS 16+ Layout API.
private struct HealthFlowLayout: Layout {
    var alignment: HorizontalAlignment = .leading
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineH: CGFloat = 0
        var totalH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > maxWidth, x > 0 {
                totalH += lineH + spacing
                x = 0; lineH = 0
            }
            x += sz.width + spacing
            lineH = max(lineH, sz.height)
            y = totalH + lineH
        }
        return CGSize(width: maxWidth == .infinity ? x : maxWidth, height: y)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var lineH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > bounds.maxX, x > bounds.minX {
                y += lineH + spacing
                x = bounds.minX
                lineH = 0
            }
            s.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
            x += sz.width + spacing
            lineH = max(lineH, sz.height)
        }
    }
}

// MARK: - HealthDriversList

/// 5-row drivers list · reads ReadinessInput rows from /api/readiness.
/// Each row: status dot + label + value + diverging bar (centered axis,
/// fills left negative / right positive in status color) + signed
/// points contribution.
struct HealthDriversList: View {
    let inputs: [ReadinessInput]

    var body: some View {
        VStack(spacing: 8) {
            if inputs.isEmpty {
                Text("No driver data yet · waiting on next sleep + run sync.")
                    .font(.body(12, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.55))
                    .padding(.vertical, 12)
            } else {
                ForEach(inputs.prefix(5)) { input in
                    driverRow(input)
                }
            }
        }
    }

    private func driverRow(_ input: ReadinessInput) -> some View {
        let signedPts = input.weight
        let absPts = abs(signedPts)
        let normalized = CGFloat(min(20, absPts)) / 20.0   // cap at ±20 visual

        // 2026-06-03 round 73 · row layout per design:
        // [dot] METRIC_NAME           [div bar]   [±N pts]
        //       value · target sub
        //
        // ReadinessInput.label often arrives as "SLEEP · 28%" (the
        // contribution-weight version backed into the label). Strip
        // anything past " · " to get the bare metric name; design
        // wants the NAME plain + value displayed separately.
        let bareName = input.label
            .split(separator: "·").first
            .map { String($0).trimmingCharacters(in: .whitespaces) }
            ?? input.label
        // Value line · prefer observedV + observedSub merged ("6h 28m target 7h 30m")
        let valueLine: String? = {
            let v = (input.observedV ?? "").trimmingCharacters(in: .whitespaces)
            let s = (input.observedSub ?? "").trimmingCharacters(in: .whitespaces)
            if v.isEmpty && s.isEmpty { return nil }
            if v.isEmpty { return s }
            if s.isEmpty { return v }
            return "\(v) · \(s)"
        }()

        return HStack(spacing: 12) {
            // Left · status dot + name/value column
            HStack(alignment: .top, spacing: 8) {
                Circle()
                    .fill(statusColor(for: signedPts))
                    .frame(width: 7, height: 7)
                    .padding(.top, 6)
                VStack(alignment: .leading, spacing: 2) {
                    Text(bareName.uppercased())
                        .font(.body(13, weight: .extraBold)).tracking(0.4)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    if let v = valueLine {
                        Text(v)
                            .font(.body(11, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.66))
                            .lineLimit(1)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            // Diverging bar · centered axis, fills left/right by sign
            GeometryReader { geo in
                let mid = geo.size.width / 2
                let fillW = (geo.size.width / 2) * normalized
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.12))
                    if signedPts < 0 {
                        Capsule()
                            .fill(statusColor(for: signedPts))
                            .frame(width: fillW)
                            .offset(x: mid - fillW)
                    } else if signedPts > 0 {
                        Capsule()
                            .fill(statusColor(for: signedPts))
                            .frame(width: fillW)
                            .offset(x: mid)
                    }
                    // Center axis tick
                    Rectangle()
                        .fill(Color.white.opacity(0.32))
                        .frame(width: 1, height: 14)
                        .offset(x: mid - 0.5)
                }
            }
            .frame(width: 84, height: 12)

            // Signed points · bigger, brighter
            Text("\(signedPts >= 0 ? "+" : "")\(signedPts)")
                .font(.display(22, weight: .bold))
                .foregroundStyle(statusColor(for: signedPts))
                .frame(width: 44, alignment: .trailing)
        }
        .padding(.vertical, 4)
    }

    private func statusColor(for weight: Int) -> Color {
        if weight <= -8  { return Color(hex: 0xFC4D64) }   // bad / over
        if weight <= -3  { return Color(hex: 0xF3AD38) }   // warn / goal
        if weight >= 4   { return Color(hex: 0x5fd06a) }   // good / green
        return Color(hex: 0x8A90A0)                         // neutral / mute
    }
}

// MARK: - HealthWeekBars

/// 7-day readiness bars. Uses sleepSeries from HealthState if present
/// (proxy for daily readiness when we don't have a daily readiness
/// series yet). Today's bar in band color, others muted.
struct HealthWeekBars: View {
    let snapshot: ReadinessSnapshot?
    let state: HealthState?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                let score = snapshot?.score ?? 0
                let avg = snapshot?.score.map { _ in score - 2 } ?? 0
                Text("NOW \(score)").bold().foregroundStyle(.white)
                Spacer()
                Text("AVG \(avg)")
                    .foregroundStyle(Color.white.opacity(0.55))
            }
            .font(.body(10.5, weight: .extraBold)).tracking(0.6)
            barRow
            dayLabels
        }
    }

    private var barRow: some View {
        let series = sevenDay()
        let maxV = max(1, series.max() ?? 1)
        let todayIdx = series.count - 1
        return HStack(alignment: .bottom, spacing: 6) {
            ForEach(Array(series.enumerated()), id: \.offset) { idx, v in
                let h = CGFloat(v / maxV) * 64
                RoundedRectangle(cornerRadius: 3)
                    .fill(idx == todayIdx ? bandColor : Color.white.opacity(0.14))
                    .frame(maxWidth: .infinity)
                    .frame(height: max(6, h))
                    .shadow(color: idx == todayIdx ? bandColor.opacity(0.45) : .clear, radius: 5)
            }
        }
        .frame(height: 64)
    }

    private var dayLabels: some View {
        let labels = sevenDayLabels()
        return HStack(spacing: 6) {
            ForEach(Array(labels.enumerated()), id: \.offset) { idx, lbl in
                Text(lbl)
                    .font(.body(9.5, weight: .extraBold)).tracking(0.6)
                    .foregroundStyle(idx == labels.count - 1
                                     ? Color.white.opacity(0.85)
                                     : Color.white.opacity(0.42))
                    .frame(maxWidth: .infinity)
            }
        }
    }

    /// 7-day score series.
    /// 2026-06-03 round 77 · prefer backend's dailyReadiness array
    /// (backend aa45d543) which ships real per-day readiness scores.
    /// Falls back to sleepSeries.hours * 12 proxy when dailyReadiness
    /// is empty (cold start), and finally to snapshot-derived
    /// synthesized values when neither is available.
    private func sevenDay() -> [Double] {
        if let dr = state?.dailyReadiness, !dr.isEmpty {
            let last7 = dr.suffix(7)
            return last7.map { Double($0.score ?? 0) }
        }
        if let s = state?.sleepSeries.suffix(7), s.count == 7 {
            return s.map { min(100, max(0, $0.hours * 12)) }
        }
        let score = Double(snapshot?.score ?? 70)
        return (0..<7).map { _ in score + Double.random(in: -8...4) }
    }

    private func sevenDayLabels() -> [String] {
        let cal = Calendar.current
        let f = DateFormatter()
        f.dateFormat = "E"
        return (0..<7).reversed().map { offset in
            let d = cal.date(byAdding: .day, value: -offset, to: Date()) ?? Date()
            return String(f.string(from: d).prefix(3)).uppercased()
        }
    }

    private var bandColor: Color {
        switch (snapshot?.band ?? "").lowercased() {
        case "sharp":     return Color(hex: 0x34D058)
        case "ready":     return Color(hex: 0x3EBD41)
        case "moderate":  return Color(hex: 0xF3AD38)
        case "pullback":  return Color(hex: 0xFC4D64)
        default:          return Color(hex: 0x8A90A0)
        }
    }
}

// MARK: - HealthLogSheet

/// Bottom sheet for manual measurement logging · v1 surface, fields
/// display-only. v2 wires WEIGHT / RHR / SLEEP / MOOD / SORENESS to
/// /api/log/* endpoints.
struct HealthLogSheet: View {
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Capsule()
                .fill(Color.white.opacity(0.30))
                .frame(width: 44, height: 4)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 12)
            VStack(alignment: .leading, spacing: 4) {
                Text("Log measurement")
                    .font(.display(24, weight: .semibold))
                    .foregroundStyle(.white)
                Text("Add a quick reading · syncs back to your trend.")
                    .font(.body(13, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.66))
            }
            VStack(spacing: 0) {
                logRow("WEIGHT", value: "—", unit: "lb")
                logRow("RESTING HR", value: "—", unit: "bpm")
                logRow("SLEEP", value: "—", unit: "h")
                logRow("MOOD", value: "—", unit: "1–5")
                logRow("SORENESS", value: "—", unit: "1–5")
            }
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.white.opacity(0.05))
            )
            Button { onDismiss() } label: {
                Text("Save")
                    .font(.body(15, weight: .extraBold)).tracking(0.4)
                    .foregroundStyle(Color(hex: 0x06302E))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.white, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 22)
        .padding(.bottom, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color(hex: 0x06302E))
        .presentationDetents([.medium, .large])
        .presentationBackground(Color(hex: 0x06302E))
    }

    private func logRow(_ label: String, value: String, unit: String) -> some View {
        HStack {
            Text(label)
                .font(.body(11, weight: .extraBold)).tracking(1.0)
                .foregroundStyle(Color.white.opacity(0.62))
            Spacer()
            Text(value)
                .font(.display(18, weight: .semibold))
                .foregroundStyle(.white)
            Text(unit)
                .font(.body(11, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.50))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.white.opacity(0.06)).frame(height: 1)
        }
    }
}
