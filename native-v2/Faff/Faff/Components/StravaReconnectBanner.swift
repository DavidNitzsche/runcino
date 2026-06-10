//
//  StravaReconnectBanner.swift
//  Glass banner shown on Today + Activity when /api/strava/status returns
//  a non-connected state. Without this the runner just sees stale data
//  with no explanation · the silent-Strava-failure-mode bug the WEB
//  agent's reconnect surface fixes.
//

import SwiftUI

struct StravaReconnectBanner: View {
    let status: API.StravaStatusResponse?

    @State private var openingURL: Bool = false

    var body: some View {
        // Hide when status is nil OR healthy ("connected"). Only render
        // when the runner needs to act.
        if let s = status, s.state != "connected" {
            Button {
                Task { await openOAuth() }
            } label: {
                HStack(spacing: 11) {
                    Image(systemName: openingURL ? "ellipsis" : "exclamationmark.triangle.fill")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Color(hex: 0xFC4D24))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(title(for: s))
                            .font(.body(13, weight: .extraBold))
                            .foregroundStyle(Theme.txt)
                        Text(subtitle(for: s))
                            .font(.body(10, weight: .semibold))
                            .foregroundStyle(Theme.txt.opacity(0.7))
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Text("RECONNECT")
                        .font(.label(10)).tracking(1.2)
                        .foregroundStyle(Color(hex: 0xFC4D24))
                }
                .padding(.vertical, 11).padding(.horizontal, 14)
                .background(Color(hex: 0xFC4D24).opacity(0.10),
                            in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color(hex: 0xFC4D24).opacity(0.45), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(openingURL)
        }
    }

    private func title(for s: API.StravaStatusResponse) -> String {
        switch s.state {
        case "needs_reauth":  return "Strava needs reauth"
        case "disconnected":  return "Strava disconnected"
        default:              return "Strava connection issue"
        }
    }

    private func subtitle(for s: API.StravaStatusResponse) -> String {
        s.reason ?? "Reconnect to keep runs syncing"
    }

    @MainActor
    private func openOAuth() async {
        openingURL = true
        defer { openingURL = false }
        if let url = try? await API.fetchStravaConnectURL() {
            await UIApplication.shared.open(url)
        }
    }
}
