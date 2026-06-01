//
//  ActivityView.swift
//  v3 Activity tab · FEED / STATS toggle.
//  FEED = your runs as a ribbon of effort.
//  STATS = the wall of work (mileage hero + PRs + consistency heatmap).
//

import SwiftUI

struct ActivityView: View {
    let onProfile: () -> Void

    enum Mode { case stats, feed }

    @State private var mode: Mode = .feed
    // Hydrate from AppCache synchronously so the runner sees their last
    // pulled log immediately on tab switch · network reload then refreshes
    // in the background. Was always-nil-until-fetched, which meant a
    // single 401 / network blip wiped the entire feed visually.
    @State private var log: LogState? =
        AppCache.read(.logState, as: LogState.self)
    @State private var range: Range = .year
    @State private var heatmapTip: String?
    @State private var fetchLimit: Int = 200    // pull lots; server caps at total
    @State private var loadingMore: Bool = false
    @State private var profile: ProfileState? =
        AppCache.read(.profileState, as: ProfileState.self)
    @State private var stravaStatus: API.StravaStatusResponse?
    /// Async-fetch lifecycle for /api/log · drives the FailedLoadBanner
    /// when fetch errors AND there's no cached log to fall back on.
    /// Initial state mirrors the AppCache hydration result so first paint
    /// doesn't show a "loading" pill when we've got prior data on disk.
    @State private var loadState: LoadState = AppCache.read(.logState, as: LogState.self) == nil ? .idle : .loaded
    /// Consecutive-days streak · drives StreakPill at the top of FEED.
    @State private var streak: StreakResponse?

    enum Range: String, CaseIterable { case month, year, all
        var label: String { rawValue.uppercased() == "ALL" ? "ALL TIME" : rawValue.uppercased() }
    }

    var body: some View {
        ZStack {
            FaffMeshView(mesh: FaffMesh.forView(.activity))

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    PageHeader(title: "ACTIVITY", avatarInitials: avatarInitials, onAvatarTap: onProfile)
                        .padding(.horizontal, 22).padding(.top, 12)
                    StravaReconnectBanner(status: stravaStatus)
                        .padding(.horizontal, 22).padding(.top, 10)
                    // FailedLoadBanner · only shown when the last fetch
                    // failed AND there's no cached log to fall back on.
                    // The cached path is silent (banner stays hidden so the
                    // runner sees their data, not an alert about a transient
                    // blip while the cache is still valid).
                    if let msg = loadState.failureMessage, log == nil {
                        FailedLoadBanner(message: msg, retry: { Task { await reload() } })
                            .padding(.horizontal, 22).padding(.top, 12)
                    }
                    toggle
                        .padding(.horizontal, 22).padding(.top, 16)
                    if mode == .stats {
                        statsBody
                    } else {
                        feedBody
                    }
                }
                .padding(.bottom, 120)
            }
        }
        .task { await reload(); await loadStreak() }
        .refreshable { await reload() }
        .onReceive(NotificationCenter.default.publisher(for: .faffForegroundRefresh)) { _ in
            // Runner returned from Safari (Strava OAuth) or just brought
            // the app forward · refresh so /api/strava/status flips back
            // to "connected" and the reconnect banner clears.
            Task { await reload() }
        }
    }

    private func loadStreak() async {
        let s = try? await API.fetchStreak()
        if let s { await MainActor.run { self.streak = s } }
    }

    private func reload() async {
        // Flip to .loading only when nothing is cached · cached views stay
        // visible during a background refresh, avoiding a skeleton blink.
        if log == nil { await MainActor.run { loadState = .loading } }
        async let p = (try? await API.fetchProfileState())
        async let ss = (try? await API.fetchStravaStatus())
        do {
            let logState = try await API.fetchLog(limit: fetchLimit)
            let (pf, sst) = await (p, ss)
            await MainActor.run {
                if let logState {
                    self.log = logState
                    self.loadState = .loaded
                } else {
                    // 200 OK but JSON decode failed · with the lenient
                    // doctrine in place this should be nearly impossible,
                    // but keep the explicit branch so we don't silently
                    // swallow the future case.
                    self.loadState = .failed("Couldn't read the run log.")
                }
                if let pf { self.profile = pf }
                if let sst { self.stravaStatus = sst }
            }
        } catch {
            // Network failure or auth error · keep cached log so the feed
            // stays visible. Banner only shows when log == nil (first run
            // OR post-sign-out cache wipe).
            let msg = loadFailureMessage(error)
            let (pf, sst) = await (p, ss)
            await MainActor.run {
                self.loadState = .failed(msg)
                if let pf { self.profile = pf }
                if let sst { self.stravaStatus = sst }
            }
        }
    }

    /// Avatar initials · delegates to ProfileIdentity.avatarInitials, the
    /// single source of truth across all 5 PageHeader-using views.
    private var avatarInitials: String { profile?.identity.avatarInitials ?? "" }

    // MARK: - Toggle

    private var toggle: some View {
        HStack(spacing: 0) {
            ForEach([Mode.stats, .feed], id: \.self) { m in
                Button { withAnimation(Theme.Motion.smooth) { mode = m } } label: {
                    Text(m == .stats ? "STATS" : "FEED")
                        .font(.body(13, weight: .extraBold))
                        .tracking(1)
                        .foregroundStyle(mode == m ? Color(hex: 0x16110D) : Theme.txt)
                        .frame(maxWidth: .infinity, minHeight: 38)
                        .background(mode == m ? Color.white : Color.clear, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(Color.white.opacity(0.1), in: Capsule())
        .overlay(Capsule().stroke(Color.white.opacity(0.2)))
    }

    // MARK: - STATS

    private var statsBody: some View {
        VStack(spacing: 0) {
            rangePicker
                .padding(.horizontal, 22).padding(.top, 20)

            VStack(spacing: 2) {
                Text(displayMiles)
                    .font(.display(96, weight: .bold))
                    .tracking(-6)
                    .foregroundStyle(
                        LinearGradient(colors: [Color(hex: 0xFFE0A0), Color(hex: 0xFF8A45), Color(hex: 0xFF5A52)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing)
                    )
                    .shadow(color: Color(hex: 0xFF783C).opacity(0.4), radius: 26, y: 6)
                Text("MILES")
                    .font(.display(18, weight: .bold))
                    .tracking(4)
                    .foregroundStyle(Theme.txt.opacity(0.9))
                Text(rangeLabel)
                    .font(.display(12, weight: .semibold))
                    .tracking(1)
                    .foregroundStyle(Theme.txt.opacity(0.6))
                    .padding(.top, 10)
            }
            .padding(.top, 18)

            StatRow(stats: [
                Stat(value: "\(log?.totalRuns ?? 0)", key: "RUNS"),
                Stat(value: totalTimeLabel,           key: "TIME"),
                Stat(value: totalElevLabel,           key: "ELEV GAIN")
            ], valueFont: 20, keyColor: Theme.txt.opacity(0.55))
            .padding(.horizontal, 22).padding(.top, 22)

            SectionLabel(title: "Personal records")
                .padding(.horizontal, 22).padding(.top, 26)
            recordsGrid
                .padding(.horizontal, 22).padding(.top, 13)

            SectionLabel(title: "Consistency")
                .padding(.horizontal, 22).padding(.top, 26)
            HStack {
                Text("21-DAY RUN STREAK")
                    .font(.display(12, weight: .semibold))
                    .foregroundStyle(Color(hex: 0xFFCE8A))
                Spacer()
                Text("LAST 18 WEEKS")
                    .font(.display(10, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.5))
            }
            .padding(.horizontal, 22).padding(.top, 4)

            Heatmap(columns: derivedHeatmap, tooltip: $heatmapTip)
                .frame(height: 110)
                .padding(.horizontal, 22).padding(.top, 14)

            HStack {
                ForEach(["JAN","FEB","MAR","APR","MAY"], id: \.self) { m in
                    Text(m)
                        .font(.display(9, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.4))
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 22).padding(.top, 4)

            if let tip = heatmapTip {
                Text(tip)
                    .font(.body(12, weight: .semibold))
                    .foregroundStyle(Color(hex: 0xFFCE8A))
                    .padding(.top, 8)
            }
        }
    }

    private var rangePicker: some View {
        HStack(spacing: 7) {
            ForEach(Range.allCases, id: \.self) { r in
                Button { withAnimation(Theme.Motion.smooth) { range = r } } label: {
                    Text(r.label)
                        .font(.body(11, weight: .extraBold))
                        .tracking(1)
                        .foregroundStyle(range == r ? Color(hex: 0x16110D) : Theme.txt.opacity(0.65))
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .background(range == r ? Color.white.opacity(0.92) : Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.white.opacity(range == r ? 1 : 0.16)))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var displayMiles: String {
        // Range picker was cosmetic — number was always all-time even when
        // the runner picked MONTH or YEAR. Sum the filtered run set so the
        // hero number matches the label below it.
        let miles = Int(rangeRuns.reduce(0.0) { $0 + $1.distance_mi })
        return miles.formatted(.number.grouping(.automatic))
    }

    private var rangeLabel: String {
        switch range {
        case .month: return "THIS MONTH"
        case .year:  return "THIS YEAR"
        case .all:   return "ALL TIME"
        }
    }

    /// Calendar cutoff for the selected range. `.all` returns nil so the
    /// filter passes every run through.
    private var rangeCutoff: Date? {
        let cal = Calendar.current
        switch range {
        case .month: return cal.date(byAdding: .day, value: -30, to: Date())
        case .year:  return cal.date(byAdding: .day, value: -365, to: Date())
        case .all:   return nil
        }
    }

    /// All runs from the cached log, filtered to the selected range. Used
    /// by every stats readout (hero miles, totals, records) so the numbers
    /// match the picker.
    private var rangeRuns: [LogRun] {
        let all = (log?.weeks ?? []).flatMap { $0.runs }
        guard let cutoff = rangeCutoff else { return all }
        let cutoffISO = isoFmt.string(from: cutoff)
        return all.filter { $0.date >= cutoffISO }
    }

    /// Same filter applied at the week level — used for the biggest-week
    /// PR so a single huge week from two years ago doesn't dominate the
    /// "THIS MONTH" view.
    private var rangeWeeks: [LogWeek] {
        let all = log?.weeks ?? []
        guard let cutoff = rangeCutoff else { return all }
        let cutoffISO = isoFmt.string(from: cutoff)
        return all.filter { week in week.runs.contains(where: { $0.date >= cutoffISO }) }
    }

    private var recordsGrid: some View {
        // Real PRs derived from /api/log run history.
        let prs = computeRecords()
        return LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            ForEach(prs, id: \.key) { r in
                recordTile(r.key, r.value, r.caption, color: r.color, unit: r.unit)
            }
        }
    }

    private struct PR { let key: String; let value: String; let caption: String; let color: Color; let unit: String? }

    private func computeRecords() -> [PR] {
        // Honor the range picker — PRs were always all-time even when the
        // runner picked THIS MONTH. Now records reflect the selected window.
        let runs = rangeRuns
        guard !runs.isEmpty else { return [] }

        // Fastest pace in range (any run, smallest pace)
        let fastestPace = runs.compactMap { r -> (LogRun, Int)? in
            guard let secs = paceSeconds(r.pace) else { return nil }
            return (r, secs)
        }.min(by: { $0.1 < $1.1 })

        // Longest run in range (biggest distance_mi)
        let longestRun = runs.max(by: { $0.distance_mi < $1.distance_mi })

        // Biggest week in range (sum distance_mi across weeks)
        let biggestWeek = rangeWeeks.max(by: { $0.totalMi < $1.totalMi })

        // Average pace for tempo / threshold runs
        let temposLast = runs.first(where: { ($0.workoutType ?? "").lowercased().contains("threshold") || ($0.workoutType ?? "").lowercased().contains("tempo") })

        // Best HR efficiency: lowest avg_hr at high distance
        let mostElev = runs.max(by: { ($0.elev_gain_ft ?? 0) < ($1.elev_gain_ft ?? 0) })

        var prs: [PR] = []
        if let (r, _) = fastestPace, let p = r.pace {
            prs.append(PR(key: "FASTEST PACE", value: p, caption: shortDate(r.date),
                          color: Color(hex: 0xFC4D64), unit: nil))
        }
        if let lr = longestRun {
            prs.append(PR(key: "LONGEST RUN", value: String(format: "%.1f", lr.distance_mi),
                          caption: shortDate(lr.date), color: Color(hex: 0xD6263C), unit: "mi"))
        }
        if let bw = biggestWeek {
            prs.append(PR(key: "BIGGEST WEEK", value: String(format: "%.1f", bw.totalMi),
                          caption: bw.label, color: Color(hex: 0xF3AD38), unit: "mi"))
        }
        if let mh = mostElev, let elev = mh.elev_gain_ft, elev > 0 {
            prs.append(PR(key: "MOST CLIMB", value: "\(elev)",
                          caption: shortDate(mh.date), color: Color(hex: 0x8A6A48), unit: "ft"))
        }
        if let t = temposLast, let p = t.pace {
            prs.append(PR(key: "LAST THRESHOLD", value: p,
                          caption: shortDate(t.date), color: Color(hex: 0xFF8847), unit: "/mi"))
        }
        let rangeTotalMi = runs.reduce(0.0) { $0 + $1.distance_mi }
        if rangeTotalMi > 0 {
            prs.append(PR(key: "RANGE TOTAL", value: String(format: "%.0f", rangeTotalMi),
                          caption: rangeLabel.capitalized, color: Color(hex: 0xFF8847), unit: "mi"))
        }
        return prs
    }

    private var totalTimeLabel: String {
        // Range-filtered like displayMiles · numbers match the picker label.
        let totalSecs = rangeRuns.compactMap { paceTimeSeconds($0.time_moving) }.reduce(0, +)
        if totalSecs == 0 { return "—" }
        let h = totalSecs / 3600
        let m = (totalSecs % 3600) / 60
        return h > 0 ? "\(h)h" : "\(m)m"
    }

    private var totalElevLabel: String {
        let total = rangeRuns.compactMap { $0.elev_gain_ft }.reduce(0, +)
        guard total > 0 else { return "—" }
        if total >= 1000 { return String(format: "%.1fk", Double(total) / 1000) }
        return "\(total)"
    }

    private func paceSeconds(_ pace: String?) -> Int? {
        guard let pace = pace else { return nil }
        let parts = pace.split(separator: ":")
        guard parts.count == 2, let m = Int(parts[0]), let s = Int(parts[1]) else { return nil }
        return m * 60 + s
    }
    private func paceTimeSeconds(_ time: String?) -> Int? {
        guard let time = time else { return nil }
        let parts = time.split(separator: ":").compactMap { Int($0) }
        if parts.count == 3 { return parts[0]*3600 + parts[1]*60 + parts[2] }
        if parts.count == 2 { return parts[0]*60 + parts[1] }
        return nil
    }

    private func recordTile(_ k: String, _ v: String, _ caption: String, color: Color, unit: String? = nil) -> some View {
        HStack(spacing: 0) {
            Rectangle().fill(color).frame(width: 4)
            VStack(alignment: .leading, spacing: 6) {
                SpecLabel(text: k, size: 9.5, tracking: 1, color: Theme.txt.opacity(0.6))
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(v).font(.display(27, weight: .bold)).tracking(-1.5).foregroundStyle(Theme.txt)
                    if let u = unit { Text(u).font(.body(12, weight: .extraBold)).foregroundStyle(Theme.txt.opacity(0.6)) }
                }
                Text(caption)
                    .font(.display(9.5, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.55))
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.1)))
    }

    private var derivedHeatmap: [[HeatmapDay]] {
        let cal = Calendar.current
        let today = Date()
        let weeks = 18
        var cols: [[HeatmapDay]] = []
        for w in 0..<weeks {
            var col: [HeatmapDay] = []
            for d in 0..<7 {
                let day = cal.date(byAdding: .day, value: -(weeks - 1 - w) * 7 - (6 - d), to: today) ?? today
                let iso = isoFmt.string(from: day)
                // Look up volume from log if present
                var intensity = 0
                var label = "Rest day"
                if let runs = log?.weeks.flatMap({ $0.runs }) {
                    if let r = runs.first(where: { $0.date == iso }) {
                        intensity = bucket(r.distance_mi)
                        label = "\(monthFmt.string(from: day)) · \(formatMi(r.distance_mi)) mi · \((r.workoutType ?? r.type ?? "Run").capitalized)"
                    }
                }
                col.append(HeatmapDay(date: day, intensity: intensity, label: label))
            }
            cols.append(col)
        }
        return cols
    }

    private func bucket(_ mi: Double) -> Int {
        switch mi { case 0: return 0; case ..<5: return 1; case ..<10: return 2; case ..<16: return 3; default: return 4 }
    }

    private let isoFmt: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f }()
    private let monthFmt: DateFormatter = { let f = DateFormatter(); f.dateFormat = "MMM d"; return f }()
    private func formatMi(_ d: Double) -> String { d == floor(d) ? "\(Int(d))" : String(format: "%.1f", d) }

    // MARK: - FEED

    private var feedBody: some View {
        VStack(spacing: 0) {
            // StreakPill · current run streak from /api/streak. Hidden
            // when count is 0 (no streak to celebrate).
            if let s = streak, s.current > 0 {
                HStack {
                    StreakPill(current: s.current, isMilestone: s.isMilestoneToday)
                    Spacer()
                }
                .padding(.horizontal, 22)
                .padding(.top, 14)
                .padding(.bottom, 4)
            }
            if let log = log {
                ForEach(log.weeks) { week in
                    weekHeader(week: week)
                    ForEach(week.runs) { run in
                        runRow(run)
                    }
                }
            }
            // Footer · honest about how many runs we've pulled. Tap to
            // double the limit (server returns total runs so this caps out
            // naturally when there's nothing earlier left to fetch).
            let loadedRuns = (log?.weeks ?? []).flatMap { $0.runs }.count
            Button {
                guard !loadingMore else { return }
                loadingMore = true
                fetchLimit = min(fetchLimit * 2, 1000)
                Task {
                    await reload()
                    await MainActor.run { loadingMore = false }
                }
            } label: {
                Text(loadingMore ? "LOADING…" : "LOAD EARLIER RUNS · \(loadedRuns) SO FAR")
                    .font(.body(12, weight: .extraBold))
                    .tracking(0.5)
                    .foregroundStyle(Theme.txt.opacity(loadingMore ? 0.4 : 1))
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.26), style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
            }
            .buttonStyle(.plain)
            .disabled(loadingMore)
            .padding(.horizontal, 22).padding(.top, 8).padding(.bottom, 40)
        }
    }

    private func weekHeader(week: LogWeek) -> some View {
        HStack {
            SpecLabel(text: week.label, size: 11, tracking: 2, color: Theme.txt.opacity(0.6))
            Spacer()
            Text(String(format: "%.1f mi", week.totalMi))
                .font(.display(12, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.85))
        }
        .padding(.horizontal, 22).padding(.top, 22).padding(.bottom, 12)
    }

    /// SF Symbol per LogRun.source · gives the runner a quick read on
    /// where each row came from (watch live vs HK import vs Strava
    /// webhook vs manual entry).
    private func sourceIcon(_ source: String) -> String {
        switch source.lowercased() {
        case "watch", "apple_watch":  return "applewatch"
        case "apple_health":          return "heart.fill"
        case "strava", "strava_webhook": return "arrow.up.right.square"
        case "manual":                return "pencil"
        default:                      return "circle.fill"
        }
    }

    private func sourceTint(_ source: String) -> Color {
        switch source.lowercased() {
        case "watch", "apple_watch":  return Theme.txt.opacity(0.75)
        case "apple_health":          return Color(hex: 0xFC4D64)
        case "strava", "strava_webhook": return Color(hex: 0xFC4D24)
        case "manual":                return Color(hex: 0x9AF0BF)
        default:                      return Theme.txt.opacity(0.5)
        }
    }

    private func runRow(_ run: LogRun) -> some View {
        let effort = FaffEffort.fromType(run.workoutType ?? run.type)
        return NavigationLink(value: FaffRoute.runDetail(id: run.id)) {
            HStack(spacing: 0) {
                Rectangle().fill(effort.dot).frame(width: 4)
                HStack(spacing: 13) {
                VStack(spacing: 2) {
                    SpecLabel(text: dowName(run.dow), size: 11, tracking: 0.5, color: Theme.txt.opacity(0.7))
                    Text(shortDate(run.date))
                        .font(.display(13, weight: .semibold))
                        .foregroundStyle(Theme.txt)
                }
                .frame(width: 38)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Image(systemName: sourceIcon(run.source))
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(sourceTint(run.source))
                        Text(run.name)
                            .font(.body(16, weight: .extraBold))
                            .tracking(-0.3)
                            .foregroundStyle(Theme.txt)
                    }
                    HStack(spacing: 5) {
                        Text("\(run.pace ?? "—") /mi")
                            .font(.display(11, weight: .semibold))
                            .foregroundStyle(Theme.txt.opacity(0.66))
                        Text("·")
                            .font(.body(11, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(0.5))
                        Text(run.time_moving ?? "—")
                            .font(.display(11, weight: .semibold))
                            .foregroundStyle(Theme.txt.opacity(0.66))
                        Text("·")
                            .font(.body(11, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(0.5))
                        Text(effort.title)
                            .font(.display(11, weight: .semibold))
                            .foregroundStyle(effort.dot)
                    }
                }
                Spacer()
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(formatMi(run.distance_mi))
                        .font(.display(30, weight: .bold))
                        .tracking(-1.5)
                        .foregroundStyle(Theme.txt)
                    Text("mi")
                        .font(.body(13, weight: .extraBold))
                        .foregroundStyle(Theme.txt.opacity(0.6))
                }
            }
            .padding(14)
            }
            .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.white.opacity(0.1)))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 22).padding(.bottom, 10)
    }

    private func dowName(_ dow: Int) -> String {
        ["SUN","MON","TUE","WED","THU","FRI","SAT"][dow % 7]
    }
    private func shortDate(_ iso: String) -> String {
        let parts = iso.split(separator: "-")
        guard parts.count == 3 else { return iso }
        return "\(parts[1])/\(parts[2])"
    }
}
