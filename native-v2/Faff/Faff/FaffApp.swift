//
//  FaffApp.swift
//  Entry point for v2. Mirrors the web-v2 tab bar.
//

import SwiftUI
import UserNotifications
import UIKit

@main
struct FaffApp: App {
    // Notifications v1 (2026-05-28 deck) — UIApplicationDelegateAdaptor
    // hooks the AppDelegate so we can implement
    // application(_:didRegisterForRemoteNotificationsWithDeviceToken:) +
    // application(_:didReceiveRemoteNotification:) without losing the
    // SwiftUI App lifecycle.
    @UIApplicationDelegateAdaptor(NotificationsAppDelegate.self) private var appDelegate

    @Environment(\.scenePhase) private var scenePhase
    /// Throttle background→foreground HK re-imports so opening + immediately
    /// re-opening the app doesn't fire two parallel ingests. 30s is enough
    /// to dedupe rapid switching while still catching "I haven't opened the
    /// app since this morning" gaps (the original sleep-stale bug).
    @State private var lastImportAt: Date = .distantPast

    var body: some Scene {
        WindowGroup {
            RootTabView()
                // v3 is dark-first. Effort mesh paints behind every screen;
                // the system canvas under the mesh stays black.
                .preferredColorScheme(.dark)
                .background(Theme.bg.ignoresSafeArea())
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

                    // Notifications v1 (2026-05-28 deck) — register
                    // categories so the OS knows the rich-action button
                    // sets, request permission once, kick the remote
                    // notification registration so the system hands us
                    // back a device token via the AppDelegate.
                    NotificationCategories.register()
                    Task.detached(priority: .background) {
                        let center = UNUserNotificationCenter.current()
                        let granted = (try? await center.requestAuthorization(
                            options: [.alert, .badge, .sound]
                        )) ?? false
                        if granted {
                            await MainActor.run {
                                UIApplication.shared.registerForRemoteNotifications()
                            }
                        }
                    }

                    // 2026-05-27: kick off the per-tab prefetch FIRST,
                    // in parallel with HK auth + import. By the time
                    // the user gets through the splash and taps any
                    // tab, the data is in cache (or in flight). This
                    // is what closes the "first-tap loading carpet"
                    // gap David flagged: web feels instant because
                    // Next.js SSRs every page; the iPhone equivalent
                    // is hitting every endpoint on boot so subsequent
                    // tab taps render from AppCache synchronously.
                    Task.detached(priority: .userInitiated) {
                        await API.prefetchAllOnLaunch()
                    }

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

// RootTabView lives in Views/RootTabView.swift (5-tab v3 host).
