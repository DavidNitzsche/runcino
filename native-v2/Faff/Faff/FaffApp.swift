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
            RootContainer()
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

                    // 2026-06-05 round 89 · one-time 14-day backfill after
                    // the sleep-bucketing fix (round 87 / commit bb0671c1)
                    // + backend UPSERT (97b6f6f0). Per backend brief
                    // designs/briefs/backend-hk-sleep-upsert-aligned-
                    // 2026-06-05.md:
                    //
                    //   "If you want belt + suspenders: when build 162
                    //    first launches for a runner, fire one explicit
                    //    re-import of the last 14 days of sleep + per-
                    //    stage samples. That guarantees the entire
                    //    visible 14-day Health chart picks up the
                    //    corrected bucketing on day one of the new build
                    //    instead of trickling in night by night."
                    //
                    // The default 7-day re-import above only refreshes
                    // the last week; the SLEEP card's 14-bar history
                    // shows two weeks. Without this backfill, the older
                    // half of the chart would keep showing the OLD
                    // bucketing (sub-night undercounts) until 14 nights
                    // of new corrected rows naturally cycled through.
                    //
                    // Gates on a versioned UserDefaults key so it fires
                    // exactly once per device after this build installs ·
                    // not every launch. importIfConnected is idempotent
                    // server-side (the backend UPSERT means re-running
                    // is safe), so even if the gate flag misfires the
                    // worst case is one extra 14-day import.
                    let backfillKey = "faff.health.bucketing-backfill.v1"
                    if !UserDefaults.standard.bool(forKey: backfillKey)
                        && UserDefaults.standard.bool(forKey: key) {
                        await HealthKitImporter.shared.importIfConnected(daysBack: 14)
                        UserDefaults.standard.set(true, forKey: backfillKey)
                    }

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
        //
        // 2026-05-31: also post .faffForegroundRefresh so view-level data
        // (Strava status, plan week, log) refreshes when the runner returns
        // from Safari OAuth or just brings the app forward. Without this,
        // the StravaReconnectBanner stays visible after a successful OAuth
        // round-trip because the iPhone never re-polls /api/strava/status
        // until the next pull-to-refresh.
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            let now = Date()
            guard now.timeIntervalSince(lastImportAt) > 30 else { return }
            lastImportAt = now
            Task {
                await HealthKitImporter.shared.importIfConnected(daysBack: 2)
            }
            NotificationCenter.default.post(name: .faffForegroundRefresh, object: nil)
        }
    }
}

// RootTabView lives in Views/RootTabView.swift (5-tab v3 host).

extension Notification.Name {
    /// Posted by Settings → Sign out. RootContainer resets back to the
    /// SignIn gate when it fires.
    static let faffGateReset = Notification.Name("faff.gate.reset")
    /// Posted by FaffApp on every background→foreground transition (same
    /// throttle as the HK re-import). Surfaces subscribe to refresh their
    /// data so a returning runner sees current state, especially after
    /// completing Strava OAuth in Safari (which has no callback hook back
    /// into the app · this is the iPhone equivalent of a callback).
    static let faffForegroundRefresh = Notification.Name("faff.foreground.refresh")
}

/// Routes the user between the auth/onboarding gate and the main app.
///
/// Gate policy (soft, opt-in):
///   · If `faff.onboarded` UserDefaults is true, or AppCache has any prior
///     surface data, treat as a returning user and drop straight into
///     RootTabView. This preserves every existing TestFlight install (David,
///     internal testers) so a new build never strands them on a SignIn page.
///   · Else show SignIn → RolePick → Onboarding → mark onboarded → main app.
///     New TestFlight installs that have never opened the app see this flow.
///
/// `TokenStore.isSignedIn` exists as a real session-token signal but isn't
/// enforced as a gate today (beta uses DEFAULT_USER_ID fallback server-side).
struct RootContainer: View {
    @State private var step: GateStep = .checking

    enum GateStep: Equatable {
        case checking
        case signIn
        case rolePick
        case onboarding
        case main
    }

    var body: some View {
        ZStack {
            switch step {
            case .checking:
                Color.clear.task { await decideInitialStep() }
            case .signIn:
                // Returning users (David, anyone with onboarding_complete=true
                // on their `users` row) come back through SignIn occasionally
                // when their session expires. The auth response carries a
                // `redirect` of "/today" for that case; we forward it via the
                // skipOnboarding flag so they don't get re-routed through
                // RolePick + Onboarding. New sign-ups still walk the gate.
                SignInView(onSignedIn: { skipOnboarding in
                    if skipOnboarding {
                        complete()
                    } else {
                        advance(.rolePick)
                    }
                })
            case .rolePick:
                RolePickView(onPick: { _ in advance(.onboarding) })
            case .onboarding:
                OnboardingView(onComplete: { complete() })
            case .main:
                RootTabView()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .faffGateReset)) { _ in
            // Settings → Sign out cleared the session. Bounce back to gate.
            withAnimation(.easeInOut(duration: 0.32)) { step = .signIn }
        }
        .onReceive(NotificationCenter.default.publisher(for: .faffSessionExpired)) { _ in
            // Auth contract changed 2026-05-30 — /api/* no longer falls back
            // to DEFAULT_USER_ID, so a 401 from any read means the session
            // token expired (or never existed on this install). Clear local
            // state and bounce to SignIn so the user can mint a fresh one.
            //
            // We don't await here — the notification fires from the fetch
            // helper's hot path. The view layer keeps whatever stale data
            // it had until the user re-auths and the cache repopulates.
            TokenStore.shared.clear()
            UserDefaults.standard.removeObject(forKey: "faff.onboarded")
            // 2026-05-31 audit: also nuke the local surface cache. Without
            // this, when User A's session expires and User B signs in on
            // the same device, decideInitialStep() sees the prior cached
            // todayWorkout / planWeek / logState bytes and treats it as a
            // "returning user" · bypasses sign-in entirely AND first paint
            // shows User A's runs before the network refresh lands. Even
            // for a single user, stale cache from an expired session can
            // mislead the runner. Wipe it.
            AppCache.clearAll()
            withAnimation(.easeInOut(duration: 0.32)) { step = .signIn }
        }
    }

    private func decideInitialStep() async {
        let defaults = UserDefaults.standard
        if defaults.bool(forKey: "faff.onboarded") {
            step = .main; return
        }
        // Returning user heuristic: any cached surface bytes means they've
        // launched the app before and got real data back. Mark onboarded so
        // they never see the gate.
        let hasCachedSurfaces = AppCache.read(.todayWorkout, as: TodayWorkoutWrapper.self) != nil
            || AppCache.read(.planWeek, as: PlanWeek.self) != nil
            || AppCache.read(.logState, as: LogState.self) != nil
        if hasCachedSurfaces || TokenStore.shared.isSignedIn {
            defaults.set(true, forKey: "faff.onboarded")
            step = .main; return
        }
        step = .signIn
    }

    private func advance(_ next: GateStep) {
        withAnimation(.easeInOut(duration: 0.32)) { step = next }
    }
    private func complete() {
        UserDefaults.standard.set(true, forKey: "faff.onboarded")
        advance(.main)
    }
}
