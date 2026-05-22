//
//  ContentView.swift
//  Faff
//
//  Root coordinator · routes to LoginView when there's no session,
//  TodayView when the user is authenticated.  Owns the
//  isAuthenticated state and re-evaluates on token changes.
//
//  v0 single-screen iPhone bridge per docs/native/01-watchos-scoping.md:
//    "iPhone app v1 jobs: login, sync today's workout to watch,
//     ingest HealthKit, surface watch-app status."
//

import SwiftUI

struct ContentView: View {
    @State private var isAuthenticated: Bool = TokenStore.shared.isLoggedIn
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        #if DEBUG
        // Design-review hooks: launch with `-uiPreview` / `-previewDetail`
        // to render a screen directly (no login) for simulator
        // screenshots. Stripped from release builds.
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-previewDetail") {
            return AnyView(DetailPreviewLoader())
        }
        if args.contains("-uiPreview") {
            return AnyView(RootTabView(onLogout: {}))
        }
        #endif
        return AnyView(routed)
    }

    private var routed: some View {
        Group {
            if isAuthenticated {
                RootTabView(onLogout: {
                    Task {
                        await FaffAPI.shared.logout()
                        isAuthenticated = false
                    }
                })
            } else {
                LoginView(onLogin: {
                    isAuthenticated = true
                    // Push today's workout to the watch right after login, 
                    // automatic, no user action.
                    Task { await WatchSync.shared.syncTodayToWatch() }
                })
            }
        }
        // Bring up the WatchConnectivity session as soon as the app shows,
        // so the watch can reach us (and we can push context) immediately.
        .onAppear { WatchSync.shared.activate() }
        // Keep the (24h) access token fresh on launch and every foreground,
        // so even auth-optional calls (run recap, overview) carry a valid
        // token and resolve to the signed-in user, not anonymous.
        .task { await refreshSession() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await refreshSession() } }
        }
    }

    /// Refresh the access token if there's a session; if the refresh token is
    /// dead it clears the keychain, so route back to login.
    private func refreshSession() async {
        guard TokenStore.shared.isLoggedIn else { return }
        await FaffAPI.shared.refreshAccessToken()
        if !TokenStore.shared.isLoggedIn { isAuthenticated = false; return }
        // Keep the watch's workout current on every launch + foreground, 
        // automatic, no "send to watch" step (runs on .task and scenePhase .active).
        await WatchSync.shared.syncTodayToWatch()
        // Retry uploading any watch-recorded runs that haven't reached the
        // server yet (now that the token is fresh). Safe + idempotent.
        await WatchSync.shared.flushPendingCompletions()
    }
}

#if DEBUG
/// Fetches the overview, then shows the detail with real data (for the
/// `-previewDetail` screenshot path).
private struct DetailPreviewLoader: View {
    @State private var overview: OverviewResponse?
    var body: some View {
        Group {
            if let overview { WorkoutDetailView(overview: overview) }
            else { ProgressView() }
        }
        .task { overview = try? await OverviewAPI.fetch() }
    }
}
#endif

#Preview {
    ContentView()
}
