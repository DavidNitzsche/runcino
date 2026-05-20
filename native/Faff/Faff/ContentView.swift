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
                    // Push today's workout to the watch right after login —
                    // automatic, no user action.
                    Task { await WatchSync.shared.syncTodayToWatch() }
                })
            }
        }
        // Bring up the WatchConnectivity session as soon as the app shows,
        // so the watch can reach us (and we can push context) immediately.
        .onAppear { WatchSync.shared.activate() }
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
