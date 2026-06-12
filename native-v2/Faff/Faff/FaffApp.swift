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
                // Kick the HealthKit importer + the rest of app setup in ONE
                // .task — build 78 had two stacked .task modifiers and SwiftUI
                // silently dropped the second one (the HK side), so no
                // permission prompt and no import ever fired. One .task block,
                // sequential setup.
                //
                // WatchConnectivity activation moved OUT of this .task into
                // NotificationsAppDelegate.didFinishLaunchingWithOptions so iOS
                // can background-launch the app to deliver queued watch
                // completions. A foreground-only .task stranded finished runs
                // until the app was next opened.
                .task {
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

                    // Health auth policy: a runner who's already connected
                    // gets a quiet re-sync (never prompts). A RETURNING runner
                    // (onboarded) who hasn't connected yet gets the prompt +
                    // initial 7-day pull. A brand-new runner mid-onboarding is
                    // NOT surprise-prompted here — OnboardingView's "Connect
                    // Apple Health" step drives the first HK auth so the
                    // permission dialog has context instead of popping over the
                    // sign-in screen.
                    let key = "faff.health.connected.v2"
                    if UserDefaults.standard.bool(forKey: key) {
                        await HealthKitImporter.shared.importIfConnected(daysBack: 7)
                    } else if UserDefaults.standard.bool(forKey: "faff.onboarded") {
                        await HealthKitImporter.shared.requestAuthAndImport(daysBack: 7)
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
            // 2026-06-09 (RK-4): re-push today's workout to the watch + flush
            // the completion relay queue on every foreground. WatchSync.start()
            // only runs once per process, so an iPhone that sat backgrounded
            // overnight never re-pushed and the watch kept yesterday's plan
            // until the next cold launch. refresh() throttles itself to once
            // per 60s (same pattern as the lastImportAt throttle below), so
            // this call is safe to make unconditionally — and it must run
            // BEFORE the HK 30s guard, which returns early.
            Task { await WatchSync.shared.refresh() }
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
    static let faffShowRunMenu = Notification.Name("faff.show.run.menu")
    /// Posted by each tab (object: tab name) when its first full load finishes.
    /// RootContainer holds the FAFF splash until every tab has signaled, so the
    /// app reveals fully painted — nothing pops as the user navigates.
    static let faffSurfaceReady = Notification.Name("faff.surface.ready")
}

/// Routes the user between the auth/onboarding gate and the main app.
///
/// Gate policy (soft, opt-in):
///   · If `faff.onboarded` UserDefaults is true, or AppCache has any prior
///     surface data, treat as a returning user and drop straight into
///     RootTabView. This preserves every existing TestFlight install (David,
///     internal testers) so a new build never strands them on a SignIn page.
///   · Else show SignIn → Onboarding → mark onboarded → main app.
///     New TestFlight installs that have never opened the app see this flow.
///   · RolePick is removed from the gate — the spectator product does not
///     exist yet and showing a role picker that routes both choices to runner
///     onboarding adds a confusing dead step to cold start.
///
/// `TokenStore.isSignedIn` exists as a real session-token signal but isn't
/// enforced as a gate today (beta uses DEFAULT_USER_ID fallback server-side).
struct RootContainer: View {
    @State private var step: GateStep = .checking
    /// Zero-pop launch · the FAFF splash overlay stays over .main until every
    /// tab has loaded (each posts .faffSurfaceReady), then a short settle for
    /// trailing fetches, then it fades. Capped so it can never hang.
    @State private var mainReady = false
    @State private var readySurfaces: Set<String> = []
    @State private var revealScheduled = false
    private static let launchSurfaces: Set<String> = ["today", "train", "health", "targets"]

    enum GateStep: Equatable {
        case checking
        case signIn
        case onboarding
        case main
    }

    var body: some View {
        ZStack {
            switch step {
            case .checking:
                // AFC fix 11 (2026-06-09) · the first frame of every launch
                // was a bare void while the gate decided (Color.clear over
                // the dark window). Now: brand canvas + the animated
                // FAFF·RUN sweep, reusing the canonical Brandmark component
                // (Anton, skew −9°, 6s rainbow sweep · Components/Brandmark
                // .swift). The .task stays on this view so gate timing is
                // unchanged · the brandmark simply fills the decision gap.
                ZStack {
                    Theme.bg.ignoresSafeArea()
                    Brandmark(size: 40)
                }
                .task { await decideInitialStep() }
            case .signIn:
                // Returning users (David, anyone with onboarding_complete=true
                // on their `users` row) come back through SignIn occasionally
                // when their session expires. The auth response carries a
                // `redirect` of "/today" for that case; we forward it via the
                // skipOnboarding flag so they don't get re-routed through
                // Onboarding. New sign-ups still walk the gate.
                SignInView(onSignedIn: { skipOnboarding in
                    if skipOnboarding {
                        complete()
                    } else {
                        advance(.onboarding)
                    }
                })
            case .onboarding:
                OnboardingView(onComplete: { complete() })
            case .main:
                RootTabView()
                    .overlay {
                        if !mainReady {
                            ZStack {
                                Theme.bg.ignoresSafeArea()
                                Brandmark(size: 40)
                            }
                            .transition(.opacity)
                        }
                    }
                    .task {
                        // Hard cap · reveal even if a tab never signals (slow
                        // net / error) so the splash can never hang. Generous
                        // because we hold for all four tabs to load.
                        try? await Task.sleep(nanoseconds: 6_000_000_000)
                        if !mainReady {
                            withAnimation(.easeOut(duration: 0.4)) { mainReady = true }
                        }
                    }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .faffGateReset)) { _ in
            // Settings → Sign out cleared the session. Bounce back to gate.
            resetLaunchHydration()
            withAnimation(.easeInOut(duration: 0.32)) { step = .signIn }
        }
        .onReceive(NotificationCenter.default.publisher(for: .faffSessionExpired)) { _ in
            // Auth contract changed 2026-05-30 — /api/* no longer falls back
            // to DEFAULT_USER_ID, so a 401 from any read means the session
            // token expired. Clear the token + onboarded flag and bounce to
            // SignIn so the user can mint a fresh one.
            //
            // RK-4 2026-06-10: AppCache is NOT cleared here any more. The
            // spurious-trigger vectors (pre-unlock background 401, late-arrival
            // 401 after re-auth) mean this handler can fire on a perfectly valid
            // session — wiping the cache in those cases erases run history and
            // offline state. Explicit sign-out still calls AppCache.clearAll()
            // (both sign-out paths already do this correctly). For a genuine
            // expiry the cache data stays stale until the network refresh lands
            // after re-auth — a small visual glitch, not a data-loss risk.
            TokenStore.shared.clear()
            UserDefaults.standard.removeObject(forKey: "faff.onboarded")
            resetLaunchHydration()
            withAnimation(.easeInOut(duration: 0.32)) { step = .signIn }
        }
        .onReceive(NotificationCenter.default.publisher(for: .faffSurfaceReady)) { note in
            guard step == .main, !mainReady, !revealScheduled else { return }
            if let s = note.object as? String { readySurfaces.insert(s) }
            guard readySurfaces.isSuperset(of: Self.launchSurfaces) else { return }
            // Every tab is loaded · settle briefly for trailing fetches
            // (forecast chip, etc.), then fade the splash into a ready app.
            revealScheduled = true
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 800_000_000)
                withAnimation(.easeOut(duration: 0.4)) { mainReady = true }
            }
        }
    }

    /// Re-arm the splash hold when bouncing back to the gate (sign-out /
    /// expiry) so the next .main entry waits for a fresh full load again.
    private func resetLaunchHydration() {
        mainReady = false
        readySurfaces = []
        revealScheduled = false
    }

    private func decideInitialStep() async {
        // The gate FADES into .signIn / .onboarding (0.32s easeInOut). It does
        // NOT fade into .main: the .checking brandmark and .main's splash
        // overlay are the identical Brandmark-on-bg, so an instant swap is
        // seamless (the brandmark simply stays on screen and keeps holding).
        // A crossfade here would briefly show the cache-warm content under the
        // still-fading-in overlay — a flash before the splash covers it again.
        // enterMain() = instant, no flash.
        let defaults = UserDefaults.standard
        if defaults.bool(forKey: "faff.onboarded") {
            enterMain(); return
        }
        // Returning user heuristic: any cached surface bytes means they've
        // launched the app before and got real data back. Mark onboarded so
        // they never see the gate.
        let hasCachedSurfaces = AppCache.read(.todayWorkout, as: TodayWorkoutWrapper.self) != nil
            || AppCache.read(.planWeek, as: PlanWeek.self) != nil
            || AppCache.read(.logState, as: LogState.self) != nil
        if hasCachedSurfaces || TokenStore.shared.isSignedIn {
            defaults.set(true, forKey: "faff.onboarded")
            enterMain(); return
        }
        advance(.signIn)
    }

    private func advance(_ next: GateStep) {
        withAnimation(.easeInOut(duration: 0.32)) { step = next }
    }
    /// Enter .main with NO crossfade · the brandmark splash overlay on .main is
    /// visually identical to the .checking brandmark, so an instant swap keeps
    /// it on screen seamlessly and never flashes the loading content beneath.
    private func enterMain() {
        step = .main
    }
    private func complete() {
        UserDefaults.standard.set(true, forKey: "faff.onboarded")
        enterMain()
    }
}
