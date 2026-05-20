//
//  TodayView.swift
//  Faff
//
//  v0 iPhone bridge surface · fetches today's workout from
//  GET /api/watch/today and displays it.  Future versions push the
//  payload to the watch via WatchConnectivity; v0 just renders so
//  we can confirm the end-to-end auth + fetch loop works against
//  production.
//

import SwiftUI

struct TodayView: View {
    let onLogout: () -> Void

    @State private var workout: WatchWorkout?
    @State private var isLoading: Bool = true
    @State private var errorMessage: String?
    @ObservedObject private var watchSync = WatchSync.shared

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if isLoading {
                        ProgressView().padding()
                    } else if let errorMessage {
                        errorView(errorMessage)
                    } else if let workout {
                        workoutContent(workout)
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationTitle("Today")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Sign out", action: onLogout)
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        Task { await refresh() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .task { await refresh() }
        }
    }

    @ViewBuilder
    private func workoutContent(_ w: WatchWorkout) -> some View {
        // Rest day / no-plan-window / race day branches
        if w.workoutId == nil {
            VStack(alignment: .leading, spacing: 8) {
                Text(w.message ?? "No workout today")
                    .font(.title2)
                if let reason = w.reason {
                    Text("Reason: \(reason)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text(w.name ?? "Workout")
                    .font(.title2).fontWeight(.bold)
                if let summary = w.summary {
                    Text(summary)
                        .font(.headline)
                        .foregroundStyle(.secondary)
                }
                if let total = w.totalEstimatedMinutes {
                    Text("≈ \(total) min")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            Divider()
            if let phases = w.phases {
                ForEach(Array(phases.enumerated()), id: \.offset) { _, phase in
                    PhaseRow(phase: phase)
                }
            }
            Divider()
            VStack(alignment: .leading, spacing: 4) {
                Text("Status")
                    .font(.headline)
                Text(watchSync.lastSyncStatus ?? "Syncing to watch…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func errorView(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Could not load today's workout")
                .font(.headline)
            Text(message)
                .font(.callout)
                .foregroundStyle(.red)
            Button("Try again") { Task { await refresh() } }
                .buttonStyle(.bordered)
        }
    }

    private func refresh() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            workout = try await FaffAPI.shared.fetchToday()
            // Keep the watch in sync on every refresh — automatic.
            await WatchSync.shared.syncTodayToWatch()
        } catch APIError.unauthorized {
            // Token expired · drop back to login
            TokenStore.shared.clear()
            onLogout()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct PhaseRow: View {
    let phase: WatchPhase

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            phaseTypeChip
            VStack(alignment: .leading, spacing: 2) {
                Text(phase.label)
                    .font(.body).fontWeight(.medium)
                HStack(spacing: 8) {
                    Text(durationLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let target = phase.targetPaceSPerMi {
                        Text("· target \(paceLabel(target))/mi")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            Spacer()
        }
        .padding(.vertical, 6)
    }

    private var phaseTypeChip: some View {
        Text(phase.type.uppercased())
            .font(.system(size: 9, weight: .bold))
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .background(chipColor.opacity(0.15))
            .foregroundStyle(chipColor)
            .clipShape(Capsule())
    }

    private var chipColor: Color {
        switch phase.type {
        case "warmup":   return .blue
        case "work":     return .orange
        case "recovery": return .green
        case "cooldown": return .purple
        default:         return .gray
        }
    }

    private var durationLabel: String {
        let m = phase.durationSec / 60
        let s = phase.durationSec % 60
        if m == 0 { return "\(s)s" }
        if s == 0 { return "\(m) min" }
        return "\(m):\(String(format: "%02d", s))"
    }

    private func paceLabel(_ sPerMi: Int) -> String {
        let m = sPerMi / 60
        let s = sPerMi % 60
        return "\(m):\(String(format: "%02d", s))"
    }
}

#Preview {
    TodayView(onLogout: { })
}
