//
//  RunDetailView.swift
//  Post-run detail · one run, one home. Mesh wears the effort.
//  Splits lead, then the scrubbable trace, then route. Reached from
//  Activity and the post-run Today.
//

import SwiftUI

struct RunDetailView: View {
    let runId: String

    @State private var run: RunDetail?
    // Coach engine output · "what this run did" with heat-aware framing.
    // Fetched in parallel with the run detail · failures are silent so
    // the rest of the screen renders even if the engine 404s.
    @State private var recap: RunRecap?
    @State private var splitReadout: String?
    @State private var traceReadout: String?
    @State private var currentMetric: TraceMetric = .pace
    /// Async-fetch lifecycle for /api/runs/[id] · drives the
    /// FailedLoadBanner shown when fetch errors AND no RunDetail is
    /// loaded (this view doesn't hydrate from AppCache · always cold
    /// fetched, so `.idle` is the only valid initial state).
    @State private var loadState: LoadState = .idle
    /// HR zone method · %MHR (default) or LTHR (Friel-anchored). Local
    /// toggle; the ZoneBar palette stays the same. Toolkit · Family I.
    @State private var zoneMethod: ZoneMethod = .pctMhr

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let eff = effort
        let mesh = eff.mesh
        ZStack {
            FaffMeshView(mesh: mesh)
                .animation(Theme.Motion.mesh, value: mesh)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    header
                        .padding(.horizontal, 22)
                        .padding(.top, 8)

                    if let msg = loadState.failureMessage, run == nil {
                        FailedLoadBanner(message: msg, retry: { Task { await load() } })
                            .padding(.horizontal, 22)
                            .padding(.top, 12)
                    }

                    hero
                        .padding(.horizontal, 24)
                        .padding(.top, 18)

                    // HOW IT WENT · coach engine's "what this run did"
                    // payload. Verdict + facts + heat-aware conditions
                    // note + forward-looking coach tip. Rendered above
                    // mile splits because it's the headline · the
                    // splits are the supporting detail.
                    if let rc = recap, !rc.verdict.isEmpty {
                        section(title: "HOW IT WENT", right: nil) {
                            VStack(alignment: .leading, spacing: 10) {
                                Text(rc.verdict)
                                    .font(.display(22, weight: .bold))
                                    .foregroundStyle(Theme.txt)
                                    .fixedSize(horizontal: false, vertical: true)
                                ForEach(Array(rc.facts.enumerated()), id: \.offset) { _, f in
                                    Text(f)
                                        .font(.body(13.5))
                                        .foregroundStyle(Theme.txt.opacity(0.86))
                                        .lineSpacing(2)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                if let cn = rc.conditions_note {
                                    coachCallout(label: "CONDITIONS", body: cn,
                                                 bg: Color(red: 1, green: 0.533, blue: 0.278).opacity(0.12),
                                                 stroke: Color(red: 1, green: 0.533, blue: 0.278).opacity(0.32),
                                                 chip: Color(red: 1, green: 0.533, blue: 0.278))
                                }
                                if let tip = rc.coach_tip {
                                    coachCallout(label: "COACH TIP", body: tip,
                                                 bg: Color(red: 0.333, green: 0.867, blue: 0.816).opacity(0.10),
                                                 stroke: Color(red: 0.333, green: 0.867, blue: 0.816).opacity(0.32),
                                                 chip: Color(red: 0.333, green: 0.867, blue: 0.816))
                                }
                                // 2026-05-31: citation footer removed per voice
                                // doctrine · plain English, no academic chrome.
                            }
                        }
                        .padding(.top, 22)
                    }

                    if !splitBars.isEmpty {
                        section(title: "MILE SPLITS", right: fastestSplitLabel) {
                            VStack(alignment: .leading, spacing: 8) {
                                MileBars(bars: splitBars, target: Double(splitTargetSecs), readout: $splitReadout)
                                    .frame(height: 150)
                                Text(splitReadout ?? "Tap a mile to read its pace · HR · effort")
                                    .font(.display(11, weight: .bold))
                                    .foregroundStyle(Theme.txt.opacity(0.72))
                                    .padding(.top, 4)
                            }
                        }
                        .padding(.top, 26)
                    }

                    // PLAN VS ACTUAL · per-phase breakdown. Backend's
                    // RunDetail.phase_breakdown is a list of PhaseBreakdown
                    // rows with target pace / actual pace / status. For a
                    // long run with a marathon-pace finish, this is the
                    // most valuable single chart on the page.
                    if let phases = run?.phase_breakdown, !phases.isEmpty {
                        section(title: "PLAN VS ACTUAL", right: nil) {
                            VStack(spacing: 10) {
                                ForEach(phases) { ph in
                                    phaseRow(ph)
                                }
                            }
                        }
                        .padding(.top, 26)
                    }

                    section(title: "TRACE", right: traceAvgLabel) {
                        VStack(alignment: .leading, spacing: 12) {
                            chipsRow
                            if traceIsEmpty(currentMetric) {
                                emptyTrace
                            } else {
                                ScrubbableTrace(
                                    points: tracePointsFor(currentMetric),
                                    labels: traceLabelsFor(currentMetric),
                                    color: currentMetric.color,
                                    fill: true,
                                    target: nil,
                                    band: nil,
                                    readout: $traceReadout
                                )
                                .frame(height: 120)
                                Text(traceReadout ?? "drag the trace to read any point")
                                    .font(.display(11, weight: .bold))
                                    .foregroundStyle(Theme.txt.opacity(0.72))
                            }
                        }
                    }
                    .padding(.top, 26)

                    // ROUTE section · only render when the run actually has
                    // a captured route (apple_watch / strava with GPS). The
                    // previous routePanel drew a hardcoded swooping
                    // polyline + "START / FINISH" marker for every run,
                    // including treadmill and indoor sessions that have
                    // no route data.
                    if run?.has_route == true {
                        section(title: "ROUTE", right: routeStatLabel) {
                            routePanel
                        }
                        .padding(.top, 26)
                    }

                    if let zones = zonePcts {
                        section(title: "TIME IN ZONE", right: timeInZoneLabel) {
                            VStack(alignment: .leading, spacing: 12) {
                                // ZoneMethodToggle · %MHR / LTHR switch.
                                // When the backend ships hr_zones_from_lthr,
                                // the toggle is meaningful (the two methods
                                // can differ 5-10 bpm). Otherwise it stays
                                // visible but locked to %MHR. Toolkit · Family I.
                                if run?.hr_zones_from_lthr != nil {
                                    HStack {
                                        Spacer()
                                        ZoneMethodToggle(method: $zoneMethod)
                                    }
                                }
                                ZoneBar(zones: zones, height: 14, legend: true)
                            }
                        }
                        .padding(.top, 26)
                    }

                    // WORK SEGMENTS · stats over just the work intervals
                    // (excluding warmup / recovery / cooldown). For a
                    // tempo / threshold session these are the numbers that
                    // matter, not the whole-run averages. Backend supplies
                    // pace_work / hr_avg_work / cadence_avg_work / work_seconds;
                    // hidden when none populated (recovery / easy runs).
                    if hasWorkSegmentData {
                        section(title: "WORK SEGMENTS", right: workSecondsLabel) {
                            workSegmentTile
                        }
                        .padding(.top, 26)
                    }

                    // FORM · cadence_spm + ground_contact_ms + stride_length_m
                    // + vertical_oscillation_cm + vertical_ratio_pct +
                    // run_power_w + respiratory_rate + spo2_pct. iPhone
                    // decodes all 8; this section renders whichever the
                    // watch / HK actually wrote (often partial).
                    if hasFormData {
                        section(title: "FORM", right: nil) {
                            formGrid
                        }
                        .padding(.top, 26)
                    }

                    // RPE entry · post-run subjective effort. Loads any
                    // prior rating from /api/runs/[id]/rpe so re-opening
                    // doesn't show a blank slate. Toolkit · Family I.
                    section(title: "HOW HARD WAS IT?", right: nil) {
                        RPEEntryCard(runId: runId)
                    }
                    .padding(.top, 26)

                    if let planSpec = vsPlanLabel {
                        section(title: "VS PLAN", right: nil) {
                            HStack(alignment: .top, spacing: 13) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(planSpec)
                                        .font(.body(14, weight: .bold))
                                        .foregroundStyle(Theme.txt)
                                    if let r = run?.planned_distance_mi {
                                        Text("planned \(String(format: "%.1f", r)) mi · ran \(String(format: "%.1f", run?.distance_mi ?? 0)) mi")
                                            .font(.display(11, weight: .bold))
                                            .foregroundStyle(Theme.txt.opacity(0.6))
                                    }
                                }
                                Spacer()
                            }
                        }
                        .padding(.top, 26)
                    }

                    section(title: "DETAILS", right: nil) {
                        detailsTile
                    }
                    .padding(.top, 12)

                    section(title: "SHARE", right: nil) {
                        stravaPushButton
                    }
                    .padding(.top, 18)

                    Spacer(minLength: 60)
                }
            }
            .refreshable { await load() }
        }
        .task { await load() }
    }

    @State private var stravaPushState: StravaPushState = .idle
    enum StravaPushState { case idle, pushing, done, failed }

    private var stravaPushButton: some View {
        Button {
            guard stravaPushState != .pushing && stravaPushState != .done else { return }
            stravaPushState = .pushing
            Task {
                let ok = (try? await API.pushRunToStrava(runId: runId)) ?? false
                await MainActor.run {
                    stravaPushState = ok ? .done : .failed
                }
            }
        } label: {
            HStack(spacing: 9) {
                Image(systemName: stravaIcon)
                    .font(.system(size: 13, weight: .bold))
                Text(stravaLabel)
                    .font(.body(14, weight: .extraBold))
                    .tracking(0.3)
            }
            .foregroundStyle(Theme.txt)
            .frame(maxWidth: .infinity, minHeight: 46)
            .background(Color(hex: 0xFC4D24).opacity(stravaPushState == .done ? 0.18 : 0.32),
                        in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: 0xFC4D24).opacity(0.6), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(stravaPushState == .pushing || stravaPushState == .done)
    }

    private var stravaIcon: String {
        switch stravaPushState {
        case .idle:    return "arrow.up.right.square.fill"
        case .pushing: return "ellipsis"
        case .done:    return "checkmark"
        case .failed:  return "exclamationmark.triangle.fill"
        }
    }
    private var stravaLabel: String {
        switch stravaPushState {
        case .idle:    return "PUSH TO STRAVA"
        case .pushing: return "PUSHING..."
        case .done:    return "PUSHED"
        case .failed:  return "PUSH FAILED · TAP TO RETRY"
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            BackChip { dismiss() }
            SpecLabel(text: "RUN DETAIL", size: 13, tracking: 2.5, color: Theme.txt)
            Spacer()
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 0) {
            SpecLabel(text: eyebrowText, size: 11, tracking: 2.5, color: Theme.txt.opacity(0.7))
            Text(workoutName)
                .displayRecipe(size: 46, weight: .bold)
                .foregroundStyle(Theme.txt)
                .shadow(color: .black.opacity(0.3), radius: 22, y: 2)
                .padding(.top, 9)

            HStack(alignment: .top, spacing: 24) {
                heroStat(value: distanceValue, key: "MILES")
                heroStat(value: timeValue, key: "TIME")
                heroStat(value: paceValue, key: "AVG /MI")
            }
            .padding(.top, 20)

            // "COMPLETED · FELT STRONG" claimed a strong RPE on every run
            // regardless of whether the runner logged one. Drop "FELT
            // STRONG" until the model exposes post_run_rpe.
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Color(hex: 0x9AF0BF))
                    Text("COMPLETED")
                        .font(.label(10)).tracking(1)
                        .foregroundStyle(Color(hex: 0x9AF0BF))
                }
                .padding(.horizontal, 10).padding(.vertical, 4)
                .background(Color(hex: 0x9AF0BF).opacity(0.2), in: Capsule())
                .overlay(Capsule().stroke(Color(hex: 0x9AF0BF).opacity(0.4), lineWidth: 1))

                // RunSourceBadge · "watch / health / strava / manual"
                // marker so the runner knows where a run's numbers came
                // from. Toolkit · Family I (atom shipped earlier).
                if let raw = run?.source, !raw.isEmpty {
                    RunSourceBadge(source: RunSource.from(raw), compact: false)
                }
                Spacer()
            }
            .padding(.top, 16)

            // STRAVA ENGAGEMENT · suffer_score + kudos chip strip when
            // either field is set on the wire (Strava-source runs only).
            // Surfaces social signal honestly while leaving the
            // coaching-grade verdict to the toolkit's HOW IT WENT card.
            if hasStravaEngagement {
                HStack(spacing: 8) {
                    if let s = run?.suffer_score, s > 0 {
                        Label("\(s) Strava suffer", systemImage: "flame.fill")
                            .font(.body(11, weight: .extraBold)).tracking(0.4)
                            .foregroundStyle(Theme.race)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(Theme.race.opacity(0.14), in: Capsule())
                            .overlay(Capsule().stroke(Theme.race.opacity(0.40), lineWidth: 1))
                    }
                    if let k = run?.kudos, k > 0 {
                        Label("\(k) kudos", systemImage: "hand.thumbsup.fill")
                            .font(.body(11, weight: .extraBold)).tracking(0.4)
                            .foregroundStyle(Theme.Accent.amberGold)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(Theme.Accent.amberGold.opacity(0.14), in: Capsule())
                            .overlay(Capsule().stroke(Theme.Accent.amberGold.opacity(0.40), lineWidth: 1))
                    }
                    Spacer()
                }
                .padding(.top, 8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// True when the wire has either of the Strava engagement fields set
    /// to a non-zero value · drives the source-tinted chips just under
    /// the hero stat row.
    private var hasStravaEngagement: Bool {
        ((run?.suffer_score ?? 0) > 0) || ((run?.kudos ?? 0) > 0)
    }

    private func heroStat(value: String, key: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(value)
                .font(.display(26, weight: .bold))
                .tracking(-1)
                .foregroundStyle(Theme.txt)
            SpecLabel(text: key, size: 9, tracking: 1.5, color: Theme.txt.opacity(0.6))
        }
    }

    private var chipsRow: some View {
        HStack(spacing: 7) {
            ForEach(TraceMetric.allCases, id: \.self) { m in
                let on = currentMetric == m
                Button {
                    withAnimation(Theme.Motion.smooth) {
                        currentMetric = m
                        traceReadout = nil
                    }
                } label: {
                    Text(m.label)
                        .font(.display(10, weight: .bold))
                        .tracking(0.5)
                        .foregroundStyle(on ? Color(hex: 0x5A1606) : Theme.txt)
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(on ? Color.white.opacity(0.92) : Color.white.opacity(0.1), in: Capsule())
                        .overlay(Capsule().stroke(Color.white.opacity(on ? 0 : 0.18), lineWidth: 1))
                        .opacity(on ? 1 : 0.6)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var routePanel: some View {
        ZStack {
            RadialGradient(
                colors: [Color.black.opacity(0.34), Color.black.opacity(0)],
                center: .center, startRadius: 0, endRadius: 200
            )
            Path { p in
                p.move(to: .init(x: 52, y: 92))
                p.addCurve(to: .init(x: 110, y: 44), control1: .init(x: 40, y: 60), control2: .init(x: 70, y: 40))
                p.addCurve(to: .init(x: 192, y: 86), control1: .init(x: 150, y: 48), control2: .init(x: 150, y: 84))
                p.addCurve(to: .init(x: 292, y: 50), control1: .init(x: 236, y: 88), control2: .init(x: 250, y: 56))
                p.addCurve(to: .init(x: 286, y: 86), control1: .init(x: 320, y: 46), control2: .init(x: 318, y: 78))
            }
            .stroke(
                LinearGradient(colors: [Color(hex: 0xFFCE8A), Color(hex: 0xFF5A3C)], startPoint: .topLeading, endPoint: .bottomTrailing),
                style: StrokeStyle(lineWidth: 3.4, lineCap: .round)
            )

            // Start/finish marker
            VStack {
                Spacer()
                HStack {
                    HStack(spacing: 8) {
                        Circle().fill(Color(hex: 0x9AF0BF)).frame(width: 10, height: 10)
                        Text("START / FINISH")
                            .font(.display(8.5, weight: .bold))
                            .foregroundStyle(Color(hex: 0x9AF0BF))
                    }
                    Spacer()
                }
                .padding(.bottom, 12).padding(.leading, 50)
            }
        }
        .frame(height: 120)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var detailsTile: some View {
        // 2026-05-31 audit: hardcoded "+8 → 276 mi" shoe-progression and
        // "clear" weather conditions removed. Show whatever's actually
        // known. shoeShort and weatherTemp degrade gracefully to "—".
        GlassTile(padding: 6) {
            VStack(spacing: 0) {
                detailRow("Shoes", shoeShort, chev: true)
                detailRow("Avg / Max HR", "\(hrAvg) / \(hrMax) bpm", chev: false)
                detailRow("Avg cadence", "\(cadAvg) spm", chev: false)
                detailRow("Weather", weatherTemp != "—" ? "\(weatherTemp)°F" : "—", chev: false, good: weatherTemp != "—")
            }
        }
    }

    private func detailRow(_ k: String, _ v: String, chev: Bool, good: Bool = false) -> some View {
        HStack {
            Text(k).font(.body(13, weight: .semibold)).foregroundStyle(Theme.txt.opacity(0.66))
            Spacer()
            HStack(spacing: 7) {
                Text(v)
                    .font(.display(13, weight: .bold))
                    .foregroundStyle(good ? Color(hex: 0x9AF0BF) : Theme.txt)
                if chev {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.6))
                }
            }
        }
        .padding(.vertical, 11)
        .padding(.horizontal, 10)
    }

    private func section<C: View>(title: String, right: String?, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                SpecLabel(text: title, size: 11, tracking: 2, color: Theme.txt.opacity(0.6))
                Spacer()
                if let r = right {
                    Text(r).font(.display(11, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.85))
                }
            }
            content()
        }
        .padding(.horizontal, 22)
    }

    // MARK: - Data

    private var effort: FaffEffort { FaffEffort.fromType(run?.type ?? "tempo") }

    private var eyebrowText: String {
        guard let r = run else { return "RUN DETAIL" }
        let f = DateFormatter(); f.dateFormat = "EEE, MMM d"
        let dateLabel: String = {
            let parts = r.date.split(separator: "-").compactMap { Int($0) }
            guard parts.count == 3 else { return r.date }
            let cal = Calendar.current
            if let d = cal.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) {
                return f.string(from: d).uppercased()
            }
            return r.date.uppercased()
        }()
        let typeLabel = (r.type ?? "RUN").uppercased()
        var pieces = [dateLabel]
        if let start = r.start_local, let timeOnly = start.split(separator: "T").last,
           let parsed = timeOnly.split(separator: ":").first {
            pieces.append("\(parsed):\(timeOnly.split(separator: ":").dropFirst().first ?? "") AM".replacingOccurrences(of: "  ", with: " "))
        }
        pieces.append(typeLabel)
        return pieces.joined(separator: " · ")
    }
    private var workoutName: String { run?.name ?? "Run" }

    /// Hero stats · "—" instead of pretending the runner ran 8.0 mi at
    /// 6:47 with 158/172 HR when no run data has loaded. The view-level
    /// gate (showing "loading…" until `run` resolves) is the proper UX
    /// for this case · for now the cells just read "—".
    private var distanceValue: String {
        if let d = run?.distance_mi { return String(format: "%.1f", d) }
        return "—"
    }
    private var timeValue: String { run?.time_moving ?? "—" }
    private var paceValue: String { run?.pace ?? "—" }
    private var hrAvg: String { run?.hr_avg.map(String.init) ?? "—" }
    private var hrMax: String { run?.hr_max.map(String.init) ?? "—" }
    private var cadAvg: String { run?.cadence_avg.map(String.init) ?? "—" }
    private var weatherTemp: String { run?.temp_f.map { String(Int($0)) } ?? "—" }
    private var shoeShort: String {
        if let n = run?.shoes?.first?.displayName {
            return n.replacingOccurrences(of: "ASICS ", with: "").replacingOccurrences(of: "Nike ", with: "")
        }
        return "—"
    }

    /// Real mile splits from the run · empty when none. Was falling back
    /// to an 8-mile fabricated tempo block (7:18, 6:58, 6:36, 6:33, 6:35,
    /// 6:34, 6:37, 7:05) any time the actual run had no splits or hadn't
    /// loaded yet · gave every run that fake CIM-rehearsal look.
    private var splitBars: [MileBar] {
        guard let splits = run?.splits, !splits.isEmpty else { return [] }
        return splits.map { s in
            let secs = paceToSeconds(s.pace) ?? 400
            let color = colorForSplit(secs: secs)
            // Sub-label · HR plus optional elev delta. The +N ft / -N ft
            // tick explains why a slow split was slow without needing the
            // full elevation profile. Decoded already on every RunSplit ·
            // was unrendered.
            let parts: [String] = [
                s.hr.map { "\($0) bpm" } ?? "",
                elevDeltaLabel(s.elev_change_ft),
            ].filter { !$0.isEmpty }
            return MileBar(
                id: s.mile,
                value: Double(800 - secs),  // invert so faster = taller
                label: s.pace ?? "-",
                subLabel: parts.isEmpty ? nil : parts.joined(separator: " · "),
                color: color,
                isHighlight: secs < 410
            )
        }
    }

    /// "+24 ft" / "-15 ft" / "" · empty when null or trivially flat (< 3 ft).
    private func elevDeltaLabel(_ ft: Int?) -> String {
        guard let ft, abs(ft) >= 3 else { return "" }
        return ft > 0 ? "+\(ft) ft" : "\(ft) ft"
    }

    /// Right-side header for the splits section · "FASTEST 6:33 · MI 4"
    /// derived from the actual splits instead of being hardcoded. Hidden
    /// when no splits load.
    private var fastestSplitLabel: String? {
        guard let splits = run?.splits, !splits.isEmpty else { return nil }
        let timed = splits.compactMap { s -> (Int, Int, String)? in
            guard let p = paceToSeconds(s.pace) else { return nil }
            return (s.mile, p, s.pace ?? "")
        }
        guard let fastest = timed.min(by: { $0.1 < $1.1 }) else { return nil }
        return "FASTEST \(fastest.2) · MI \(fastest.0)"
    }

    /// Target line on the splits chart · the planned work-block pace from
    /// the matched planned spec, or the run's average pace when no plan
    /// match exists. Was hardcoded to 398s (6:38/mi) so the target line
    /// landed in the same spot for every run.
    private var splitTargetSecs: Int {
        if let pace = run?.pace_work_s_per_mi { return pace }
        if let pace = run?.pace_s_per_mi { return pace }
        if let splits = run?.splits, !splits.isEmpty {
            let secs = splits.compactMap { paceToSeconds($0.pace) }
            if !secs.isEmpty { return secs.reduce(0, +) / secs.count }
        }
        return 420
    }

    // `defaultSplits` removed · was an 8-mile fabricated tempo block that
    // rendered whenever the actual run had no splits. Now the splits
    // section hides entirely when `splitBars.isEmpty`.

    private func colorForSplit(secs: Int) -> Color {
        switch secs {
        case ..<395: return Color(hex: 0xD62D1C)
        case 395..<410: return Color(hex: 0xDB3620)
        case 410..<420: return Color(hex: 0xF97B3F)
        default: return Color(hex: 0xFFB45A)
        }
    }

    private func paceToSeconds(_ s: String?) -> Int? {
        guard let s else { return nil }
        let parts = s.split(separator: ":")
        guard parts.count == 2, let m = Int(parts[0]), let sec = Int(parts[1]) else { return nil }
        return m * 60 + sec
    }

    /// Real zone distribution from the run, or nil if HR-zone data wasn't
    /// computed for this source (e.g. raw Apple Watch HR without LTHR ranges).
    /// Don't fall back to demo data · "pull in what you can" means honest gaps.
    private var zonePcts: [ZonePct]? {
        guard let z = run?.hrZonePcts else { return nil }
        let t = z.z1 + z.z2 + z.z3 + z.z4 + z.z5
        guard t > 0 else { return nil }
        let totalSec = paceTimeSeconds(run?.time_moving) ?? 0
        let mins = max(1, totalSec / 60)
        return [
            ZonePct(zone: 1, pct: z.z1 / t, timeLabel: "\(Int(round(z.z1 / t * Double(mins))))m"),
            ZonePct(zone: 2, pct: z.z2 / t, timeLabel: "\(Int(round(z.z2 / t * Double(mins))))m"),
            ZonePct(zone: 3, pct: z.z3 / t, timeLabel: "\(Int(round(z.z3 / t * Double(mins))))m"),
            ZonePct(zone: 4, pct: z.z4 / t, timeLabel: "\(Int(round(z.z4 / t * Double(mins))))m"),
            ZonePct(zone: 5, pct: z.z5 / t, timeLabel: "\(Int(round(z.z5 / t * Double(mins))))m")
        ]
    }

    private func paceTimeSeconds(_ time: String?) -> Int? {
        guard let time = time else { return nil }
        let parts = time.split(separator: ":").compactMap { Int($0) }
        if parts.count == 3 { return parts[0]*3600 + parts[1]*60 + parts[2] }
        if parts.count == 2 { return parts[0]*60 + parts[1] }
        return nil
    }

    private var traceAvgLabel: String {
        guard let r = run else { return "" }
        switch currentMetric {
        case .pace: return "AVG \(r.pace ?? "—") /mi"
        case .hr:   return r.hr_avg.map { "AVG \($0) bpm" } ?? ""
        case .elev: return r.elev_gain_ft.map { "+\($0) ft GAIN" } ?? ""
        case .cad:  return r.cadence_avg.map { "AVG \($0) spm" } ?? ""
        }
    }

    private var routeStatLabel: String {
        let mi = run.map { String(format: "%.1f MI", $0.distance_mi) } ?? ""
        let elev = run?.elev_gain_ft.map { "+\($0) FT" } ?? ""
        return [mi, elev].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private var timeInZoneLabel: String {
        guard let secs = paceTimeSeconds(run?.time_moving) else { return "" }
        return "\(secs / 60) MIN"
    }

    /// Builds a "1.5 wu · 5.0 @ 6:38 · 1.5 cd"-style spec from the planned
    /// workout when present. Returns nil for runs without a plan attached
    /// (so the VS PLAN section + COACH section hide entirely rather than
    /// showing fake tempo-block copy).
    private var vsPlanLabel: String? {
        guard let s = run?.planned_spec, let kind = Optional(s.kind), !kind.isEmpty else { return nil }
        return run?.planned_sub_label
    }

    private var emptyTrace: some View {
        VStack(spacing: 6) {
            SpecLabel(text: "NO PER-MILE DATA", size: 10, tracking: 1.2, color: Theme.txt.opacity(0.45))
            Text("This run was logged without \(currentMetric.label.lowercased())-per-mile splits.")
                .font(.body(12, weight: .medium))
                .foregroundStyle(Theme.txt.opacity(0.62))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 120)
        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.1), style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
    }

    private func tracePointsFor(_ m: TraceMetric) -> [Double] {
        guard let splits = run?.splits, !splits.isEmpty else { return [] }
        let pts: [Double?] = splits.map { s in
            switch m {
            case .pace: return paceToSeconds(s.pace).map(Double.init)
            case .hr:   return s.hr.map(Double.init)
            case .elev: return s.elev_change_ft.map(Double.init)
            case .cad:  return s.cadence.map(Double.init)
            }
        }
        let real = pts.compactMap { $0 }
        return real.count >= 2 ? real : []
    }

    private func traceLabelsFor(_ m: TraceMetric) -> [String] {
        guard let splits = run?.splits, !splits.isEmpty else { return [] }
        return splits.map { s in
            let v: String
            switch m {
            case .pace: v = s.pace.map { "\($0) /mi" } ?? "—"
            case .hr:   v = s.hr.map { "\($0) bpm" } ?? "—"
            case .elev: v = s.elev_change_ft.map { "\($0) ft" } ?? "—"
            case .cad:  v = s.cadence.map { "\($0) spm" } ?? "—"
            }
            return "mi \(s.mile) · \(v)"
        }
    }

    /// Returns true when no real data exists for this metric. Render an empty
    /// state instead of a fake demo curve.
    private func traceIsEmpty(_ m: TraceMetric) -> Bool {
        tracePointsFor(m).count < 2
    }

    private func load() async {
        if run == nil { await MainActor.run { loadState = .loading } }
        // Fire run detail + recap fetches in parallel. Each updates state
        // independently · the recap section renders the moment its
        // payload lands, regardless of the run detail's progress.
        async let recapTask = API.fetchRunRecap(runId: runId)
        do {
            let r = try await API.fetchRunDetail(id: runId)
            await MainActor.run {
                if let r {
                    run = r
                    loadState = .loaded
                } else {
                    loadState = .failed("Couldn't load this run.")
                }
            }
        } catch {
            await MainActor.run { loadState = .failed(loadFailureMessage(error)) }
        }
        if let rc = try? await recapTask {
            await MainActor.run { recap = rc }
        }
    }

    /// Heat / coach-tip callout row. Used by HOW IT WENT to surface the
    /// engine's conditions_note + coach_tip with the right visual weight.
    @ViewBuilder
    private func coachCallout(label: String, body: String, bg: Color, stroke: Color, chip: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.display(10, weight: .bold))
                .foregroundStyle(chip)
                .kerning(1.2)
            Text(body)
                .font(.body(12.5))
                .foregroundStyle(Theme.txt.opacity(0.92))
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(bg))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(stroke, lineWidth: 1))
    }

    // MARK: - PLAN VS ACTUAL · per-phase breakdown

    /// One row per planned phase · target pace / actual pace / status dot.
    /// Status color reads green=on, amber=slow, blue=fast, grey=skipped.
    @ViewBuilder
    private func phaseRow(_ ph: PhaseBreakdown) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Circle().fill(phaseStatusColor(ph)).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 2) {
                Text(ph.label.uppercased())
                    .font(.label(11)).tracking(1.2)
                    .foregroundStyle(Theme.txt.opacity(0.85))
                Text(phaseSubLabel(ph))
                    .font(.display(11, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.62))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 12)
            VStack(alignment: .trailing, spacing: 2) {
                Text(ph.actual_pace ?? "—")
                    .font(.display(15, weight: .bold))
                    .tracking(-0.3)
                    .foregroundStyle(Theme.txt)
                Text("/MI")
                    .font(.label(8)).tracking(1)
                    .foregroundStyle(Theme.txt.opacity(0.55))
            }
        }
        .padding(.vertical, 12).padding(.horizontal, 14)
        .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
            .stroke(Color.white.opacity(0.12), lineWidth: 1))
    }

    private func phaseStatusColor(_ ph: PhaseBreakdown) -> Color {
        switch (ph.status ?? "").lowercased() {
        case "on":   return Color(hex: 0x9AF0BF)
        case "slow": return Color(hex: 0xFFB24D)
        case "fast": return Color(hex: 0x86E0FF)
        default:     return Color.white.opacity(0.4)
        }
    }

    private func phaseSubLabel(_ ph: PhaseBreakdown) -> String {
        var parts: [String] = []
        if let tp = ph.target_pace { parts.append("target \(tp)/mi") }
        if let mi = ph.actual_distance_mi { parts.append("\(String(format: "%.1f", mi)) mi") }
        if let bpm = ph.avg_hr { parts.append("\(bpm) bpm") }
        return parts.joined(separator: " · ")
    }

    // MARK: - WORK SEGMENTS

    private var hasWorkSegmentData: Bool {
        run?.pace_work != nil || run?.hr_avg_work != nil ||
            run?.cadence_avg_work != nil || (run?.work_seconds ?? 0) > 0
    }

    private var workSecondsLabel: String? {
        guard let s = run?.work_seconds, s > 0 else { return nil }
        let m = s / 60, sec = s % 60
        return "\(m):\(String(format: "%02d", sec))"
    }

    private var workSegmentTile: some View {
        HStack(spacing: 22) {
            workStat(value: run?.pace_work ?? "—", key: "PACE")
            workStat(value: run?.hr_avg_work.map(String.init) ?? "—", key: "HR")
            workStat(value: run?.cadence_avg_work.map(String.init) ?? "—", key: "CAD")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 14).padding(.horizontal, 14)
        .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
            .stroke(Color.white.opacity(0.12), lineWidth: 1))
    }

    private func workStat(value: String, key: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value)
                .font(.display(20, weight: .bold))
                .tracking(-0.5)
                .foregroundStyle(Theme.txt)
            SpecLabel(text: key, size: 9, tracking: 1.2, color: Theme.txt.opacity(0.55))
        }
    }

    // MARK: - FORM metrics

    private var hasFormData: Bool {
        guard let f = run?.form else { return false }
        return f.cadence_spm != nil || f.ground_contact_ms != nil ||
               f.stride_length_m != nil || f.vertical_oscillation_cm != nil ||
               f.vertical_ratio_pct != nil || f.run_power_w != nil ||
               f.respiratory_rate != nil || f.spo2_pct != nil
    }

    private var formGrid: some View {
        let f = run?.form
        return LazyVGrid(
            columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)],
            spacing: 8
        ) {
            formCell(value: fmt(f?.cadence_spm, "%.0f"),         unit: "spm", key: "CADENCE")
            formCell(value: fmt(f?.ground_contact_ms, "%.0f"),   unit: "ms",  key: "GCT")
            formCell(value: fmt(f?.stride_length_m, "%.2f"),     unit: "m",   key: "STRIDE")
            formCell(value: fmt(f?.vertical_oscillation_cm, "%.1f"), unit: "cm", key: "VERT OSC")
            formCell(value: fmt(f?.vertical_ratio_pct, "%.1f"),  unit: "%",   key: "VERT RATIO")
            formCell(value: fmt(f?.run_power_w, "%.0f"),         unit: "w",   key: "POWER")
            formCell(value: fmt(f?.respiratory_rate, "%.0f"),    unit: "/min", key: "RESP")
            formCell(value: fmt(f?.spo2_pct, "%.0f"),            unit: "%",   key: "SPO2")
        }
    }

    private func fmt(_ d: Double?, _ pat: String) -> String? {
        guard let d else { return nil }
        return String(format: pat, d)
    }

    private func formCell(value: String?, unit: String, key: String) -> some View {
        HStack(alignment: .lastTextBaseline, spacing: 4) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .lastTextBaseline, spacing: 3) {
                    Text(value ?? "—")
                        .font(.display(17, weight: .bold))
                        .tracking(-0.4)
                        .foregroundStyle(value == nil ? Theme.txt.opacity(0.45) : Theme.txt)
                    if value != nil {
                        Text(unit)
                            .font(.display(10, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(0.55))
                    }
                }
                SpecLabel(text: key, size: 9, tracking: 1.2, color: Theme.txt.opacity(0.55))
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 10).padding(.horizontal, 12)
        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(Color.white.opacity(0.10), lineWidth: 1))
    }
}

// TraceMetric · just the label + color, no fake data.
//
// The 33-element `var points` / `var labels` arrays (CIM-rehearsal demo
// curve) used to live here. Even though every render path called
// tracePointsFor() (real splits), the demo arrays were one careless
// refactor away from leaking into the UI. Per doctrine 2026-05-31
// (no placeholder fallbacks · the runner is paying attention), the
// fake data is gone.
private enum TraceMetric: String, CaseIterable {
    case pace, hr, elev, cad

    var label: String {
        switch self {
        case .pace: return "PACE"
        case .hr:   return "HR"
        case .elev: return "ELEV"
        case .cad:  return "CADENCE"
        }
    }

    var color: Color {
        switch self {
        case .pace: return Color(hex: 0xFF7A45)
        case .hr:   return Color(hex: 0xFF5A6E)
        case .elev: return Color(hex: 0xFFCE8A)
        case .cad:  return Color(hex: 0x9AF0BF)
        }
    }
}
