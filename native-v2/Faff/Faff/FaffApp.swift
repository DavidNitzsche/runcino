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
                // Wire the WatchConnectivity bridge + kick the HealthKit
                // importer in ONE .task — build 78 had two stacked .task
                // modifiers and SwiftUI silently dropped the second one
                // (the HK side), so no permission prompt and no import
                // ever fired. One .task block, sequential setup.
                //
                // WatchSync.shared is @MainActor; .task already runs in
                // a MainActor context, so direct .start() is safe.
                .task {
                    WatchSync.shared.start()

                    // First open: prompt for Health auth + initial 7-day
                    // pull (workouts + samples). On subsequent opens:
                    // quiet re-sync, never prompts.
                    let key = "faff.health.connected.v2"
                    if !UserDefaults.standard.bool(forKey: key) {
                        await HealthKitImporter.shared.requestAuthAndImport(daysBack: 7)
                    } else {
                        await HealthKitImporter.shared.importIfConnected(daysBack: 7)
                    }
                }
        }
    }
}

struct RootTabView: View {
    @State private var selectedTab: Tab = .today

    enum Tab: String, CaseIterable, Identifiable {
        case today, training, log, races, health, profile
        var id: String { rawValue }
        var label: String { rawValue.uppercased() }
        var systemImage: String {
            switch self {
            case .today:    return "house.fill"
            case .training: return "calendar"
            case .log:      return "list.bullet.rectangle.fill"
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
            LogView()      .tabItem { Label("LOG",      systemImage: Tab.log.systemImage) }      .tag(Tab.log)
            RacesView()    .tabItem { Label("RACES",    systemImage: Tab.races.systemImage) }    .tag(Tab.races)
            HealthView()   .tabItem { Label("HEALTH",   systemImage: Tab.health.systemImage) }   .tag(Tab.health)
            ProfileView()  .tabItem { Label("PROFILE",  systemImage: Tab.profile.systemImage) }  .tag(Tab.profile)
        }
        .tint(Theme.green)
    }
}
