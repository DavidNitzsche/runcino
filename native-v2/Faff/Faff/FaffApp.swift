//
//  FaffApp.swift
//  Entry point for v2. Mirrors the web-v2 tab bar.
//

import SwiftUI

@main
struct FaffApp: App {
    var body: some Scene {
        WindowGroup {
            RootTabView()
                .preferredColorScheme(.dark)
                .background(Theme.bgPage.ignoresSafeArea())
                // Wire the WatchConnectivity bridge after the first scene
                // is up. WatchSync.shared is @MainActor — accessing it
                // from FaffApp.init() (non-isolated) crashed at runtime
                // under Xcode 16+ strict-concurrency checks (build 72).
                // .task runs inside a MainActor context.
                .task { WatchSync.shared.start() }
        }
    }
}

struct RootTabView: View {
    @State private var selectedTab: Tab = .today

    enum Tab: String, CaseIterable, Identifiable {
        case today, training, races, health, profile
        var id: String { rawValue }
        var label: String { rawValue.uppercased() }
        var systemImage: String {
            switch self {
            case .today:    return "house.fill"
            case .training: return "calendar"
            case .races:    return "trophy.fill"
            case .health:   return "heart.fill"
            case .profile:  return "person.fill"
            }
        }
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            TodayView()    .tabItem { Label("TODAY",    systemImage: Tab.today.systemImage) }    .tag(Tab.today)
            TrainingView() .tabItem { Label("TRAINING", systemImage: Tab.training.systemImage) } .tag(Tab.training)
            RacesView()    .tabItem { Label("RACES",    systemImage: Tab.races.systemImage) }    .tag(Tab.races)
            HealthView()   .tabItem { Label("HEALTH",   systemImage: Tab.health.systemImage) }   .tag(Tab.health)
            ProfileView()  .tabItem { Label("PROFILE",  systemImage: Tab.profile.systemImage) }  .tag(Tab.profile)
        }
        .tint(Theme.green)
    }
}
