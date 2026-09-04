//
//  RequestDiagnosticsView.swift
//  STAGE1-DIAG-1 · internal-only request-lifecycle inspector.
//
//  Reachable ONLY via seven taps on the version footer in Settings (see
//  SettingsV5.swift) — deliberately not a labeled settings row, so this
//  never reads as a runner-facing feature. Exists so a physical-device
//  report of "can't reach faff" / "old data" can be answered from the
//  device itself: which endpoint, which date, cancelled or a real failure,
//  how long it took, what HTTP status came back.
//

import SwiftUI

struct RequestDiagnosticsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var entries: [RequestDiagnosticEntry] = []
    @State private var refreshTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            AppBar(title: "Request log", onBack: { dismiss() })

            if entries.isEmpty {
                Spacer()
                Text("No requests recorded yet this session.")
                    .font(.faffText(TypeScaleV5.label12))
                    .foregroundStyle(V5.textQuiet)
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: V5.S.s8) {
                        ForEach(entries) { entry in
                            row(entry)
                        }
                    }
                    .padding(.horizontal, V5.S.gutter)
                    .padding(.vertical, V5.S.s16)
                }
                .scrollIndicators(.hidden)
            }

            HStack {
                Button("Clear") {
                    Task {
                        await RequestDiagnosticsLog.shared.clear()
                        entries = []
                    }
                }
                .font(.faffText(TypeScaleV5.label12))
                .foregroundStyle(V5.textQuiet)
                Spacer()
                Text("\(entries.count) requests")
                    .font(.faffText(TypeScaleV5.label12))
                    .foregroundStyle(V5.textQuiet)
            }
            .padding(.horizontal, V5.S.gutter)
            .padding(.bottom, V5.S.s16)
        }
        .background(V5.surfacePage)
        .task {
            // Polled rather than pushed — this is a debug view, not a
            // production data path, and a 1s cadence is plenty to watch
            // a live navigation session.
            while !Task.isCancelled {
                entries = await RequestDiagnosticsLog.shared.snapshot()
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }

    @ViewBuilder
    private func row(_ entry: RequestDiagnosticEntry) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("#\(entry.id) · \(entry.endpoint)")
                    .font(.faffText(TypeScaleV5.label12))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Spacer()
                Text(entry.outcome?.label ?? "in flight")
                    .font(.faffText(TypeScaleV5.label12))
                    .foregroundStyle(color(for: entry.outcome))
            }
            HStack(spacing: V5.S.s8) {
                if let date = entry.dateParam {
                    Text("date=\(date)")
                }
                if let ms = entry.durationMs {
                    Text("\(ms)ms")
                }
                Text(entry.startedAt, style: .time)
            }
            .font(.faffText(TypeScaleV5.label12))
            .foregroundStyle(V5.textQuiet)
        }
        .padding(V5.S.s8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(V5.surface1)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func color(for outcome: RequestOutcome?) -> Color {
        guard let outcome else { return V5.textQuiet }
        switch outcome {
        case .success: return V5.textQuiet
        case .cancelled: return V5.textQuiet
        case .httpError: return V5.attention
        case .timeout, .transportError, .decodingError: return V5.fault
        }
    }
}
