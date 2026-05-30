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

    @State private var mode: Mode = .stats
    @State private var log: LogState?
    @State private var range: Range = .year
    @State private var heatmapTip: String?

    enum Range: String, CaseIterable { case month, year, all
        var label: String { rawValue.uppercased() == "ALL" ? "ALL TIME" : rawValue.uppercased() }
    }

    var body: some View {
        ZStack {
            FaffMeshView(mesh: FaffMesh.forView(.activity))

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    PageHeader(title: "ACTIVITY", avatarInitials: "DK", onAvatarTap: onProfile)
                        .padding(.horizontal, 22).padding(.top, 12)
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
        .task { log = try? await API.fetchLog(limit: 120) }
    }

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
                Stat(value: "—",                       key: "TIME"),
                Stat(value: "—",                       key: "ELEV GAIN")
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
        let miles = Int(log?.totalMi ?? 0)
        return miles.formatted(.number.grouping(.automatic))
    }

    private var rangeLabel: String {
        switch range {
        case .month: return "THIS MONTH"
        case .year:  return "THIS YEAR"
        case .all:   return "ALL TIME"
        }
    }

    private var recordsGrid: some View {
        // Mock records grid (the LogState doesn't ship PRs today — coming from
        // /api/profile/state.nextARace + run history aggregates). Placeholder
        // until the wire ships them.
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            recordTile("FASTEST MILE", "5:48", "Mar 14", color: Color(hex: 0xFC4D64))
            recordTile("FASTEST 5K",   "19:42", "Feb 1",  color: Color(hex: 0xFF8847))
            recordTile("FASTEST 10K",  "41:18", "Apr 5",  color: Color(hex: 0xFF8847))
            recordTile("LONGEST RUN",  "26.2",  "Big Sur · Apr 26", color: Color(hex: 0xD6263C), unit: "mi")
            recordTile("BIGGEST WEEK", "58.6",  "Mar 2-8", color: Color(hex: 0xF3AD38), unit: "mi")
            recordTile("MARATHON PR",  "3:31:40", "LA · Mar 8", color: Color(hex: 0xD6263C))
        }
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
            if let log = log {
                ForEach(log.weeks) { week in
                    weekHeader(week: week)
                    ForEach(week.runs) { run in
                        runRow(run)
                    }
                }
            }
            Button { /* load more */ } label: {
                Text("LOAD EARLIER RUNS")
                    .font(.body(12, weight: .extraBold))
                    .tracking(0.5)
                    .foregroundStyle(Theme.txt)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.26), style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
            }
            .buttonStyle(.plain)
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
                    Text(run.name)
                        .font(.body(16, weight: .extraBold))
                        .tracking(-0.3)
                        .foregroundStyle(Theme.txt)
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
