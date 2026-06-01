//
//  StravaPushHistorySheet.swift
//  Last 10 strava_pushes rows for the runner · queued / succeeded /
//  failed with the title that landed (or the error_message when it
//  didn't). Surfaced from Profile · CONNECTED · Strava manage.
//

import SwiftUI

struct StravaPushHistorySheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var pushes: [StravaPushRow] = []
    @State private var loading: Bool = true

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Capsule().fill(Color.white.opacity(0.18))
                .frame(width: 40, height: 4)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 8)
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Strava push history")
                        .font(.display(22, weight: .bold))
                        .foregroundStyle(Theme.txt)
                    Text("Most recent 10 pushes to your Strava account.")
                        .font(.body(12.5, weight: .medium))
                        .foregroundStyle(Theme.mute)
                }
                Spacer()
            }
            .padding(.horizontal, 24).padding(.top, 12)

            if loading {
                VStack { Spacer(); ProgressView().tint(Theme.txt); Spacer() }
                    .frame(maxWidth: .infinity, minHeight: 220)
            } else if pushes.isEmpty {
                Text("No pushes yet · your runs will appear here once you push one to Strava.")
                    .font(.body(13, weight: .medium))
                    .foregroundStyle(Theme.mute)
                    .padding(24)
            } else {
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(pushes) { p in row(p) }
                    }
                    .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 24)
                }
            }
        }
        .background(Theme.Glass.strong)
        .ignoresSafeArea(edges: .bottom)
        .task {
            let result = (try? await API.fetchStravaPushes()) ?? []
            await MainActor.run { pushes = result; loading = false }
        }
    }

    private func row(_ p: StravaPushRow) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Circle().fill(statusColor(p.status)).frame(width: 8, height: 8)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 4) {
                Text(p.title ?? "Run \(p.run_id ?? "")")
                    .font(.body(13, weight: .extraBold))
                    .foregroundStyle(Theme.txt)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    Text(p.status.uppercased())
                        .font(.body(9, weight: .extraBold)).tracking(1)
                        .foregroundStyle(statusColor(p.status))
                    if let t = p.pushed_at {
                        Text("· \(formatRelative(t))")
                            .font(.body(10.5, weight: .semibold))
                            .foregroundStyle(Theme.mute)
                    }
                }
                if let err = p.error_message, !err.isEmpty, p.status == "failed" {
                    Text(err)
                        .font(.body(11, weight: .medium))
                        .foregroundStyle(Theme.over)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 4)
        }
        .padding(14)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }

    private func statusColor(_ s: String) -> Color {
        switch s {
        case "succeeded": return Theme.green
        case "failed":    return Theme.over
        case "queued":    return Theme.goal
        default:          return Theme.mute
        }
    }
    private func formatRelative(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let cleaned = iso.replacingOccurrences(of: " ", with: "T")
        guard let d = f.date(from: cleaned) ?? f.date(from: cleaned + "Z") else { return "" }
        let secs = Int(Date().timeIntervalSince(d))
        if secs < 60 { return "just now" }
        if secs < 3600 { return "\(secs / 60)m ago" }
        if secs < 86400 { return "\(secs / 3600)h ago" }
        return "\(secs / 86400)d ago"
    }
}
