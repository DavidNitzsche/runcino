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
    /// 2026-06-03 round 78 · tapped bar-card opens this metric in a
    /// bottom sheet (HealthMetricSheet). nil = no sheet open.
    @State private var selectedMetric: HealthMetric? = nil
    /// 2026-06-08 · WHAT TO DO actions · same /api/readiness/brief the Today
    /// panel uses. Replaces the deprecated overview.watchingTomorrow shape.
    @State private var brief: ReadinessBriefSeed? = nil
    /// 2026-06-05 round 85 · observe the HK importer so the SLEEP
    /// architecture "last night" number updates the moment a re-sync
    /// lands. The importer republishes `lastNightHours` whenever the
    /// most-recent `sleep_hours` row changes · without observation
    /// the page would stick to whatever value was cached at first
    /// render, which is how the round-84 totalMinutes fix would have
    /// looked invisible (importer wrote the corrected row, but the
    /// SwiftUI body never re-evaluated to pick it up).
    @ObservedObject private var hkImporter: HealthKitImporter = .shared

    var body: some View {
        ZStack {
            FaffMeshView(mesh: .neutral)
                .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    // Bar (50) + shared header pill (84) clearance, matching Today.
                    Color.clear.frame(height: 132)

                    VStack(alignment: .leading, spacing: 0) {
                        if let msg = loadState.failureMessage, state == nil {
                            Text(msg)
                                .font(.body(14, weight: .semibold))
                                .foregroundStyle(Color(hex: 0xFC4D64))
                                .frame(maxWidth: .infinity, alignment: .center)
                                .padding(.top, 40)
                        } else {
                            bodyPane
                            readinessTrendSection
                            healthSectionDivider("SLEEP");    sleepPane
                            healthSectionDivider("FORM");     formPane
                            healthSectionDivider("INSIGHTS"); insightsPane
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 18)
                    .padding(.bottom, 70)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .faffHeaderDissolve(clearTo: 56, opaqueAt: 80)
        }
        // Shared frosted header pill · readiness ring + verdict, in the Today
        // week-strip slot. Replaces the old section menu.
        .faffHeaderPill { healthReadinessPill }
        .task { await reload() }
        .refreshable { await reload() }
        .sheet(isPresented: $showLogSheet) {
            HealthLogSheet(onDismiss: { showLogSheet = false })
        }
        // 2026-06-03 round 78 · metric detail sheet (item: presentation)
        // opens whenever selectedMetric is set by a card tap. Setting
        // back to nil dismisses.
        .sheet(item: $selectedMetric) { metric in
            HealthMetricSheet(metric: metric) { selectedMetric = nil }
        }
    }

    // MARK: - Pinned region

    /// Top fixed region · header + gauge/verdict row + segmented control.
    /// Never scrolls. Padded for status bar.
    private var pinnedRegion: some View {
        VStack(spacing: 0) {
            // Header row · eyebrow context + log button
            HStack(alignment: .center) {
                Text(eyebrowText)
                    .font(.body(11, weight: .extraBold))
                    .tracking(1.5)
                    .foregroundStyle(Color.white.opacity(0.78))
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

            // Section menu moved to the shared header pill (faffHeaderPill).
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
                if let msg = loadState.failureMessage, state == nil {
                    Text(msg)
                        .font(.body(14, weight: .semibold))
                        .foregroundStyle(Color(hex: 0xFC4D64))
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.top, 60)
                } else {
                    switch section {
                    case .overview: overviewPane
                    case .body:     bodyPane
                    case .sleep:    sleepPane
                    case .form:     formPane
                    case .insights: insightsPane
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 16)
            .padding(.bottom, 70)        // clear of floating tab bar
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
        if let b = brief, !b.actions.isEmpty {
            whatToDoCard(b.actions, threshold: b.actionsThreshold).padding(.top, 14)
        }
        SectionLabel(title: "7-DAY READINESS")
            .padding(.top, 22).padding(.bottom, 10)
        HealthWeekBars(snapshot: readiness, state: state)
        // Aerobic fitness mini-card
        if let vo2 = state?.vo2.current {
            aerobicCard(vo2: vo2)
                .padding(.top, 18)
        }
        if let story = state?.overview?.story, story.paragraph?.isEmpty == false {
            storyCard(story).padding(.top, 14)
        }
        if let rec = state?.overview?.recoveryPhase, rec.anchor?.isEmpty == false {
            recoveryPhaseCard(rec).padding(.top, 14)
        }
    }

    // MARK: - 7-day readiness trend (Health tab section after BODY)

    @ViewBuilder
    private var readinessTrendSection: some View {
        healthSectionDivider("7-DAY READINESS")
        HealthWeekBars(snapshot: readiness, state: state)
        if let vo2 = state?.vo2.current {
            aerobicCard(vo2: vo2).padding(.top, 18)
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
                    Text("RECOVERY \(d)D ↓")
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

    // 2026-06-08 · WHAT TO DO · replaces WATCHING TOMORROW. Renders the
    // server's data-grounded `brief.actions` (each tied to a real trigger in
    // health-actions.ts) + the transparency `actionsThreshold` line. No
    // client extrapolation · the phone just paints what the engine sent.
    private func whatToDoCard(_ actions: [HealthAction], threshold: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("WHAT TO DO")
                .font(.body(9.5, weight: .extraBold)).tracking(0.8)
                .foregroundStyle(Color(hex: 0x5BBFB0))
            ForEach(actions) { a in
                HStack(alignment: .top, spacing: 10) {
                    Text(priorityLabel(a.priority))
                        .font(.body(8, weight: .extraBold)).tracking(0.5)
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(priorityColor(a.priority).opacity(0.18), in: Capsule())
                        .foregroundStyle(priorityColor(a.priority))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(a.action)
                            .font(.body(12.5, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.90))
                            .fixedSize(horizontal: false, vertical: true)
                        if !a.cite.isEmpty {
                            Text(a.cite)
                                .font(.body(10.5, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.58))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer(minLength: 0)
                }
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

    private func priorityColor(_ p: String) -> Color {
        switch p {
        case "urgent":    return Color(hex: 0xFC4D64)
        case "high":      return Color(hex: 0xF3AD38)
        case "medium":    return Color(hex: 0xE7C24A)
        case "on-course": return Color(hex: 0x5fd06a)
        default:          return Color(hex: 0x8A90A0)
        }
    }
    private func priorityLabel(_ p: String) -> String {
        p == "on-course" ? "ON COURSE" : p.uppercased()
    }

    // 2026-06-08 · slimmed (UI-HEALTH-REPORT 1.4). Removed the per-pillar
    // %-grid (one time-based number copied into all 4 pillars · fake
    // precision) and the EARLIEST QUALITY countdown (violated the locked
    // no-reactive-coach doctrine). Keeps only the honest descriptive read:
    // what the hard session was + where you are in the recovery window.
    private func recoveryPhaseCard(_ r: OverviewRecoveryPhase) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("RECOVERY PHASE")
                .font(.body(9.5, weight: .extraBold)).tracking(0.8)
                .foregroundStyle(Color.white.opacity(0.55))
            if let a = r.anchor {
                Text(a)
                    .font(.body(13, weight: .semibold))
                    .foregroundStyle(.white)
            }
            if let d = r.dayOf {
                Text(d.uppercased())
                    .font(.body(10.5, weight: .extraBold)).tracking(0.8)
                    .foregroundStyle(Color.white.opacity(0.62))
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

    private func aerobicCard(vo2: Double) -> some View {
        // 2026-06-03 round 77 · vo2Trend wires the pct change + coach
        // line when backend ships it (HealthState.vo2Trend · aa45d543).
        // Falls back to a generic coaching line when absent.
        let pct = state?.vo2Trend?.pctChange30d
        let coach: String? = state?.vo2Trend?.coach
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
            if let coach {
                Text(coach)
                    .font(.body(12, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.78))
                    .lineSpacing(2)
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
            sleepArchitectureLine
            metricsGrid(HealthSeed.sleepMetrics(readiness: readiness, healthState: state),
                        variant: .big)
        }
    }

    /// 2026-06-05 round 85 fix · "Architecture · last night Xh · 7-night Yh"
    /// used to read `readiness?.sleep7Avg` for BOTH numbers — the format
    /// string passed `(s7, s7)` so the two labels were just relabels of
    /// the same value. That's why David's QC saw 6.1h / 6.1h identical
    /// despite the round 84 totalMinutes fix landing on the iPhone side.
    ///
    /// Split:
    ///  · "last night" reads `hkImporter.lastNightHours` first · this is
    ///    the freshest single-night `sleep_hours` value the iPhone just
    ///    wrote to the backend. After build 158 + a re-sync it includes
    ///    the unspecified / legacy `.asleep` minutes that were missing
    ///    pre-round-84, so the displayed value jumps to match HK's
    ///    "Time Asleep" total immediately (no need to wait for the
    ///    7-night rolling window to drift up).
    ///  · "7-night" stays on `sleep7Avg` · the backend's rolling average
    ///    over the historical samples. This will drift up to match HK
    ///    gradually as the next 7 nights' worth of corrected rows land.
    ///  · Either number falls back to the other if missing, so the line
    ///    never shows a partial half-result.
    private var sleepArchitectureLine: some View {
        let lastNight: Double? = hkImporter.lastNightHours ?? readiness?.sleep7Avg
        let sevenNight: Double? = readiness?.sleep7Avg ?? hkImporter.lastNightHours
        return Group {
            if let ln = lastNight, let s7 = sevenNight {
                Text(String(format: "Architecture · last night %.1fh · 7-night %.1fh",
                            ln, s7))
                    .font(.body(11.5, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.66))
                    .padding(.bottom, 4)
            }
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
    /// 2026-06-03 round 78 · tap on a card now opens the metric in a
    /// bottom sheet via selectedMetric, instead of expanding in place.
    /// Avoids the L-shape layout where one card grew tall while its
    /// row neighbor stayed small.
    private func metricsGrid(_ metrics: [HealthMetric],
                             variant: HealthBarCardVariant) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10),
                            GridItem(.flexible(), spacing: 10)],
                  spacing: 10) {
            ForEach(metrics) { m in
                HealthBarCard(metric: m, variant: variant) {
                    selectedMetric = m
                }
            }
        }
    }

    private var eyebrowText: String {
        let f = DateFormatter()
        f.dateFormat = "EEE · MMM d"
        return "RECOVERY & FORM · \(f.string(from: Date()).uppercased())"
    }

    /// Single punchy band word for the big headline (the Health analog of
    /// Today's TEMPO / Train's BUILD). Falls back to the score when the band
    /// hasn't resolved yet.
    private var readinessWord: String {
        switch (readiness?.band ?? "").lowercased() {
        case "sharp":    return "SHARP"
        case "ready":    return "READY"
        case "moderate": return "HOLD"
        case "pullback": return "EASE"
        default:         return readiness?.score.map { "\($0)" } ?? "—"
        }
    }

    /// Headline tint for the band word · green ready, amber hold, red ease.
    private var readinessBandColor: Color {
        switch (readiness?.band ?? "").lowercased() {
        case "sharp", "ready": return Color(hex: 0x3EBD41)
        case "moderate":       return Color(hex: 0xF3AD38)
        case "pullback":       return Color(hex: 0xFC4D64)
        default:               return Color(hex: 0x8A90A0)
        }
    }

    /// Compact readiness ring + verdict for the shared header pill (the Today
    /// week-strip slot). Sized to the fixed 84pt pill · replaces the old gauge.
    private var healthReadinessPill: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().stroke(Color.white.opacity(0.15), lineWidth: 5)
                Circle()
                    .trim(from: 0, to: min(1, max(0, Double(readiness?.score ?? 0) / 100)))
                    .stroke(readinessBandColor, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text(readiness?.score.map(String.init) ?? "—")
                    .font(.display(19, weight: .bold))
                    .foregroundStyle(.white)
            }
            .frame(width: 56, height: 56)
            verdictAttributedText
                .font(.body(11.5, weight: .semibold))
                .foregroundStyle(.white)
                .lineSpacing(1)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button { showLogSheet = true } label: {
                Image(systemName: "plus")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .background(Color.white.opacity(0.15), in: Circle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 15)
    }

    /// Section header for the long health scroll · BODY / SLEEP / FORM / INSIGHTS.
    private func healthSectionDivider(_ title: String) -> some View {
        SectionLabel(title: title)
            .padding(.top, 28)
            .padding(.bottom, 10)
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
        guard let score = readiness?.score,
              let comp = brief?.composition,
              comp.baseline > 0 else { return nil }
        let baseline = comp.baseline
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
        // 2026-06-05 round 86 · also kick the HK importer here so
        // pull-to-refresh on the Health page actually re-reads HK
        // (last-night sleep, HRV, RHR, form metrics), not just
        // /api/readiness + /api/health/state which are downstream of
        // the importer. Without this the page depends entirely on
        // FaffApp's lifecycle for HK timing and David's QC kept
        // seeing stale sleep numbers between launches.
        //
        // daysBack: 3 catches today + last 2 nights of sleep · matches
        // the foreground-resync window used elsewhere. Fire-and-forget
        // since the importer publishes lastNightHours via @Published
        // and the @ObservedObject hkImporter on this view will
        // re-render the architecture line the instant the value lands.
        Task.detached(priority: .userInitiated) {
            await HealthKitImporter.shared.importIfConnected(daysBack: 3)
        }
        async let r = (try? await API.fetchReadiness())
        async let b = (try? await API.fetchReadinessBrief())
        do {
            let st = try await API.fetchHealthState()
            let rd = await r
            let bd = await b
            await MainActor.run {
                if let st {
                    self.state = st
                    self.loadState = .loaded
                }
                if let rd {
                    self.readiness = rd
                }
                if let bd {
                    self.brief = bd
                }
                // Zero-pop launch · Health surface painted, release the splash gate.
                NotificationCenter.default.post(name: .faffSurfaceReady, object: "health")
            }
        } catch {
            await MainActor.run {
                self.loadState = .failed("Couldn't read health data.")
                // Still "settled" — the error card is painted behind the
                // splash, so releasing the gate won't pop anything.
                NotificationCenter.default.post(name: .faffSurfaceReady, object: "health")
            }
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
        // Map internal key to user-facing display name.
        let bareName: String = {
            switch input.key.lowercased() {
            case "hrv":  return "Recovery"
            case "rhr":  return "Resting HR"
            case "load": return "Training Load"
            default:
                return input.label
                    .split(separator: "·").first
                    .map { String($0).trimmingCharacters(in: .whitespaces) }
                    ?? input.label
            }
        }()
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
        let score = Double(snapshot?.score ?? 0)
        return (0..<6).map { _ in 0.0 } + [score]
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
        case "sharp":     return Color(hex: 0x3EBD41)
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
