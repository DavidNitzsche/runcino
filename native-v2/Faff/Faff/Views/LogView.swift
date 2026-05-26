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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                appBar

                if loading {
                    HStack { Spacer(); ProgressView().tint(Theme.green); Spacer() }
                        .padding(40)
                } else if let error {
                    errorBlock(error)
                } else if let log {
                    headerStats(log)
                    ForEach(log.weeks) { week in
                        weekBlock(week)
                    }
                    if log.weeks.isEmpty {
                        Text("No runs logged yet.")
                            .font(.body(13))
                            .foregroundStyle(Theme.mute)
                            .padding(.horizontal, 24).padding(.top, 8)
                    }
                }
            }
            .padding(.bottom, 40)
        }
        .background(Theme.bg.ignoresSafeArea())
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $selected) { run in
            RunDetailSheet(runId: run.id, fallback: run)
        }
    }

    private var appBar: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("LOG").font(.display(26)).tracking(1.2).foregroundStyle(Theme.ink)
            Spacer()
        }
        .padding(.horizontal, 24).padding(.top, 8)
    }

    private func headerStats(_ s: LogState) -> some View {
        HStack(spacing: 24) {
            stat("RUNS", "\(s.totalRuns)")
            stat("MILES", String(format: "%.1f", s.totalMi))
        }
        .padding(.horizontal, 24)
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.body(10, weight: .bold)).tracking(1.4).foregroundStyle(Theme.mute)
            Text(value).font(.display(22)).foregroundStyle(Theme.ink)
        }
    }

    private func weekBlock(_ w: LogWeek) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(w.label)
                    .font(.body(10, weight: .bold)).tracking(1.4)
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
                            .font(.body(9, weight: .bold)).tracking(1.0)
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
            Text("LOG ERROR").font(.body(9, weight: .bold)).tracking(1.6)
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
            self.log = try await API.fetchLog(limit: 80)
            self.error = nil
        } catch {
            self.error = "Couldn't reach the log. Pull to refresh."
        }
    }
}
