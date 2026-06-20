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
        // Render ONLY for "needs_reauth" — a runner who WAS linked and whose
        // token expired. A never-connected runner ("disconnected") must see
        // NO Strava prompt here (product rule 2026-06-20: Strava is hidden
        // until connected, and connecting happens in Settings/onboarding, not
        // via a surprise banner). nil / "connected" / "disconnected" hide.
        if let s = status, s.state == "needs_reauth" {
            Button {
                Task { await openOAuth() }
            } label: {
                HStack(spacing: 11) {
                    Image(systemName: openingURL ? "ellipsis" : "exclamationmark.triangle.fill")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.Brand.strava)
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
                    Text(cta(for: s))
                        .font(.label(10)).tracking(1.2)
                        .foregroundStyle(Theme.Brand.strava)
                }
                .padding(.vertical, 11).padding(.horizontal, 14)
                .background(Theme.Brand.strava.opacity(0.10),
                            in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Theme.Brand.strava.opacity(0.45), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(openingURL)
        }
    }

    /// True when there's no token on file yet — the runner has never linked
    /// Strava, so the action is "connect", not "reconnect". `needs_reauth`
    /// is the only state that genuinely means "was linked, link again".
    private func isFirstTime(_ s: API.StravaStatusResponse) -> Bool {
        s.state != "needs_reauth"
    }

    private func cta(for s: API.StravaStatusResponse) -> String {
        isFirstTime(s) ? "CONNECT" : "RECONNECT"
    }

    private func title(for s: API.StravaStatusResponse) -> String {
        switch s.state {
        case "needs_reauth":  return "Strava needs reauth"
        case "disconnected":  return "Strava not connected"
        default:              return "Strava not connected"
        }
    }

    private func subtitle(for s: API.StravaStatusResponse) -> String {
        // First-time: friendly copy, not the raw "No Strava token on file"
        // reason (that's diagnostic, not runner-facing). Reauth: the reason
        // is useful ("token expired") so surface it when present.
        if isFirstTime(s) { return "Connect to sync your runs" }
        if let r = s.reason, !r.isEmpty { return r }
        return "Reconnect to keep runs syncing"
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
