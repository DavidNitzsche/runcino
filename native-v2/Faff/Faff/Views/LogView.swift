//
//  LogView.swift
//  P28 — chronological run history. Mirrors web /log: weeks grouped
//  with weekly totals + per-run rows. Tap a row → RunDetailSheet.
//

import SwiftUI

struct LogView: View {
    @State private var log: LogState?
    @State private var loading = true
    @State private var error: String?
    @State private var selected: LogRun?
    /// Run-detail prefetch cache. Filled in parallel for the current week
    /// when log loads, plus on-tap for any earlier rows. Mirrors web
    /// LogTable's pattern — taps render synchronously when warm.
    @State private var detailById: [String: RunDetail] = [:]
    /// Shoes are app-wide, fetched once. Same idea as web LogTable.
    @State private var shoes: [Shoe] = []

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                // Background-load: header stats render the moment data
                // lands, weeks fill in below. No page-blocking spinner —
                // skeleton placeholders for the first few rows while we
                // wait. Same pattern as TodayView/CoachSlot.
                if let error {
                    errorBlock(error)
                } else if let log {
                    headerStats(log)
                        .transition(.opacity)
                    ForEach(log.weeks) { week in
                        weekBlock(week)
                            .transition(.opacity)
                    }
                    if log.weeks.isEmpty {
                        Text("No runs logged yet.")
                            .font(.body(13))
                            .foregroundStyle(Theme.mute)
                            .padding(.horizontal, 24).padding(.top, 8)
                    }
                } else if loading {
                    logSkeleton
                        .transition(.opacity)
                }
                }
                .padding(.bottom, 40)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Log")
            .navigationBarTitleDisplayMode(.large)
            .task { await load() }
            .refreshable { await load() }
            .sensoryFeedback(.selection, trigger: selected?.id)
            .sheet(item: $selected) { run in
                RunDetailSheet(
                    runId: run.id,
                    fallback: run,
                    prefetchedDetail: detailById[run.id],
                    prefetchedShoes: shoes.isEmpty ? nil : shoes
                )
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
            }
        }
    }

    /// Matched-shape skeleton rows so the screen doesn't go white while
    /// the log is in flight. Three placeholder weeks of three rows each.
    private var logSkeleton: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header stats placeholder
            HStack(spacing: 24) {
                ForEach(0..<2, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 4) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Theme.ink.opacity(0.06))
                            .frame(width: 50, height: 10)
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Theme.ink.opacity(0.08))
                            .frame(width: 60, height: 22)
                    }
                }
            }
            .padding(.horizontal, 24)

            ForEach(0..<3, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 8) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Theme.ink.opacity(0.05))
                        .frame(width: 110, height: 10)
                        .padding(.horizontal, 24)
                    VStack(spacing: 0) {
                        ForEach(0..<3, id: \.self) { _ in
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    RoundedRectangle(cornerRadius: 4)
                                        .fill(Theme.ink.opacity(0.06))
                                        .frame(width: 140, height: 13)
                                    RoundedRectangle(cornerRadius: 3)
                                        .fill(Theme.ink.opacity(0.04))
                                        .frame(width: 80, height: 10)
                                }
                                Spacer()
                                VStack(alignment: .trailing, spacing: 4) {
                                    RoundedRectangle(cornerRadius: 4)
                                        .fill(Theme.ink.opacity(0.06))
                                        .frame(width: 50, height: 13)
                                    RoundedRectangle(cornerRadius: 3)
                                        .fill(Theme.ink.opacity(0.04))
                                        .frame(width: 70, height: 10)
                                }
                            }
                            .padding(.horizontal, 16).padding(.vertical, 12)
                        }
                    }
                    .background(Theme.card)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
                    .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
                    .padding(.horizontal, 24)
                }
            }
        }
    }

    // appBar removed: NavigationStack + .navigationTitle("Log") at the
    // top of this view now provides the native iOS large title.

    private func headerStats(_ s: LogState) -> some View {
        HStack(spacing: 24) {
            stat("RUNS", "\(s.totalRuns)")
            stat("MILES", String(format: "%.1f", s.totalMi))
        }
        .padding(.horizontal, 24)
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.label(10)).tracking(1.4).foregroundStyle(Theme.mute)
            Text(value).font(.display(22)).foregroundStyle(Theme.ink)
        }
    }

    private func weekBlock(_ w: LogWeek) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(w.label)
                    .font(.label(10)).tracking(1.4)
                    .foregroundStyle(w.isCurrent ? Theme.green : Theme.mute)
                Spacer()
                if w.totalMi > 0 {
                    Text("\(String(format: "%.1f", w.totalMi)) mi")
                        .font(.body(11, weight: .semibold))
                        .foregroundStyle(Theme.mute)
                }
            }
            .padding(.horizontal, 24)

            VStack(spacing: 0) {
                ForEach(w.runs) { run in
                    Button { selected = run } label: { runRow(run) }
                        .buttonStyle(.plain)
                    if run.id != w.runs.last?.id {
                        Divider().background(Theme.line).padding(.leading, 24)
                    }
                }
            }
            .background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
            .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
            .padding(.horizontal, 24)
        }
    }

    private func runRow(_ run: LogRun) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(run.name)
                    .font(.body(13, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                HStack(spacing: 8) {
                    Text(run.date).font(.body(10)).foregroundStyle(Theme.mute)
                    if let t = run.type {
                        Text(t.uppercased())
                            .font(.label(9)).tracking(1.0)
                            .foregroundStyle(colorForType(t))
                    }
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(String(format: "%.1f mi", run.distance_mi))
                    .font(.body(13, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                HStack(spacing: 6) {
                    if let p = run.pace { Text(p).font(.body(10)).foregroundStyle(Theme.mute) }
                    if let t = run.time_moving { Text("· \(t)").font(.body(10)).foregroundStyle(Theme.mute) }
                    if let hr = run.avg_hr { Text("· \(hr)bpm").font(.body(10)).foregroundStyle(Theme.mute) }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }

    /// Match the web palette: easy=learn, long=dist, tempo=goal, race=race.
    private func colorForType(_ t: String) -> Color {
        switch t.lowercased() {
        case "easy", "recovery", "long_easy": return Theme.learn
        case "long":   return Theme.dist
        case "tempo", "threshold": return Theme.goal
        case "race":   return Theme.race
        case "rest":   return Theme.mute
        default:        return Theme.mute
        }
    }

    private func errorBlock(_ msg: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("LOG ERROR").font(.label(9)).tracking(1.6)
                .foregroundStyle(Theme.over)
            Text(msg).font(.body(12)).foregroundStyle(Theme.ink.opacity(0.85)).lineSpacing(2)
        }
        .padding(16)
        .background(Theme.over.opacity(0.04))
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.over.opacity(0.22), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
        .padding(.horizontal, 24)
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let log = try await API.fetchLog(limit: 80)
            self.log = log
            self.error = nil
            // Kick off background warming (don't block the list render).
            // fetchLog returns LogState? — only warm when non-nil.
            if let log {
                Task { await prefetchHotRuns(log: log) }
            }
            Task { await prefetchShoes() }
        } catch {
            self.error = "Couldn't reach the log. Pull to refresh."
        }
    }

    /// Pre-fetch run detail for the current week so taps feel instant.
    /// Older runs still hit the on-appear fetch in the sheet itself.
    private func prefetchHotRuns(log: LogState) async {
        guard let current = log.weeks.first(where: { $0.isCurrent }) ?? log.weeks.first else { return }
        await withTaskGroup(of: (String, RunDetail?).self) { group in
            for r in current.runs {
                group.addTask {
                    let d = try? await API.fetchRunDetail(id: r.id)
                    return (r.id, d)
                }
            }
            for await (id, detail) in group {
                if let d = detail { detailById[id] = d }
            }
        }
    }

    private func prefetchShoes() async {
        guard let resp = try? await API.fetchShoes(), let list = resp.shoes else { return }
        // Match web behavior: only active shoes in the picker.
        shoes = list.filter { !($0.retired ?? false) }
    }
}
