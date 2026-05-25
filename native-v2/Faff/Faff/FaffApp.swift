//
//  FaffApp.swift
//  Entry point for v2. Mirrors the web-v2 tab bar.
//

import SwiftUI

@main
struct FaffApp: App {
    init() {
        // Wire the WatchConnectivity bridge as soon as the app boots.
        // Pushes today's workout to the (frozen) watch app on activation.
        WatchSync.shared.start()
    }
    var body: some Scene {
        WindowGroup {
            RootTabView()
                .preferredColorScheme(.dark)
                .background(Theme.bgPage.ignoresSafeArea())
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
