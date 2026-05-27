//
//  FaffApp.swift
//  Entry point for v2. Mirrors the web-v2 tab bar.
//

import SwiftUI

@main
struct FaffApp: App {
    @Environment(\.scenePhase) private var scenePhase
    /// Throttle background→foreground HK re-imports so opening + immediately
    /// re-opening the app doesn't fire two parallel ingests. 30s is enough
    /// to dedupe rapid switching while still catching "I haven't opened the
    /// app since this morning" gaps (the original sleep-stale bug).
    @State private var lastImportAt: Date = .distantPast

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
                    lastImportAt = Date()

                    // P35 — boot the HR alerter if the runner previously
                    // enabled phone alerts. Silent if disabled.
                    if HRAlerter.shared.enabled {
                        await HRAlerter.shared.start()
                    }
                }
        }
        // 2026-05-27: re-import HK samples on every background→foreground
        // transition. The `.task` above only fires once per app launch, so
        // overnight HealthKit writes (last night's sleep, HRV, RHR landing
        // around 6am) never reached the server unless David force-quit and
        // re-launched. Now bringing the app forward triggers a fresh pull,
        // throttled to once per 30s.
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            let now = Date()
            guard now.timeIntervalSince(lastImportAt) > 30 else { return }
            lastImportAt = now
            Task {
                await HealthKitImporter.shared.importIfConnected(daysBack: 2)
            }
        }
    }
}

struct RootTabView: View {
    @State private var selectedTab: Tab = .today

    enum Tab: String, CaseIterable, Identifiable {
        case today, training, log, races, health, tips, profile
        var id: String { rawValue }
        var label: String { rawValue.uppercased() }
        var systemImage: String {
            switch self {
            case .today:    return "house.fill"
            case .training: return "calendar"
            case .log:      return "list.bullet.rectangle.fill"
            case .races:    return "trophy.fill"
            case .health:   return "heart.fill"
            case .tips:     return "lightbulb.fill"
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
            TipsView()     .tabItem { Label("TIPS",     systemImage: Tab.tips.systemImage) }     .tag(Tab.tips)
            ProfileView()  .tabItem { Label("PROFILE",  systemImage: Tab.profile.systemImage) }  .tag(Tab.profile)
        }
        .tint(Theme.green)
    }
}
