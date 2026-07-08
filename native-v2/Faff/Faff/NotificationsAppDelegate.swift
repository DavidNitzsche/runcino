//
//  NotificationsAppDelegate.swift
//  Notifications v1 (2026-05-28 deck) — bridges UIKit's remote-push
//  hooks and the UNUserNotificationCenter delegate into the SwiftUI App
//  lifecycle.
//
//  SwiftUI's @main App doesn't expose application(_:didRegister…) and
//  application(_:didReceiveRemoteNotification:), so we attach this
//  AppDelegate via @UIApplicationDelegateAdaptor on FaffApp.
//
//  Two flows:
//    1. The runner grants notification permission → iOS hands us a token
//       in didRegisterForRemoteNotificationsWithDeviceToken → we POST it
//       to /api/notifications/register so the web scheduler can target
//       this device.
//    2. The runner taps a rich-notification action (SOLID / BETTER /
//       READY etc.) on the lock screen → iOS routes it to
//       userNotificationCenter(_:didReceive:withCompletionHandler:) →
//       we POST to /api/notifications/ack with the action + category.
//

import UIKit
import UserNotifications

final class NotificationsAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // Set ourselves as the notification center delegate so we own
        // foreground-presentation + action-tap dispatch.
        UNUserNotificationCenter.current().delegate = self

        // Activate WatchConnectivity as early as possible — here, NOT in
        // FaffApp's SwiftUI .task. iOS background-launches the app to deliver
        // queued watch completions (transferUserInfo), and only an app that
        // has activated its WCSession in didFinishLaunching receives them while
        // backgrounded. Activating in .task (foreground only) left a finished
        // run sitting in the queue until the runner next opened the app —
        // minutes if they checked soon, days if they didn't (e.g. a 06-05 run
        // that didn't land for 54h). UIApplicationDelegate is @MainActor, so
        // this main-thread call into the @MainActor WatchSync is synchronous.
        WatchSync.shared.start()

        // Same story for HealthKit: register the workout observer + turn on
        // HK background delivery HERE (not a SwiftUI .task) so iOS can
        // background-launch the app when a new workout lands in HealthKit and
        // ingest it without the runner opening Faff. This is what makes a
        // strength session sync on its own. No-op until Health is connected.
        // UIApplicationDelegate is @MainActor; HealthKitImporter is @MainActor;
        // the call is synchronous (it only registers — the drain runs async).
        HealthKitImporter.shared.startWorkoutBackgroundDelivery()
        HealthKitImporter.shared.startSleepBackgroundDelivery()
        return true
    }

    // MARK: - Token registration

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        Task {
            await API.registerDeviceToken(token, appVersion: appVersion)
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Soft-fail: keep the app usable; we'll retry on next foreground via
        // the FaffApp .onChange(of: scenePhase) when David adds it.
        print("[notifications] APNs registration failed:", error.localizedDescription)
    }

    // MARK: - Foreground presentation

    /// When a notification arrives while the app is FOREGROUND we still
    /// want it visible — that's the right behavior for race-day morning
    /// (the runner has just opened the app) and for the weekly check-in
    /// landing right as they tap in. iOS 14+ uses .banner/.list/.sound.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }

    // MARK: - Action tap dispatch

    /// The runner tapped a rich-action button (or the body of the
    /// notification). Route to /api/notifications/ack for the wire-level
    /// side-effect, then handle any deep-link the payload carries.
    ///
    /// 2026-07-06 audit P2-47 · this used to fire a DETACHED Task for the
    /// ack POST and call completionHandler() immediately, before the
    /// network call had a chance to start. iOS is free to suspend the
    /// process the instant completionHandler returns — a lock-screen tap
    /// on SOLID / READY / BETTER could suspend mid-request and the ack
    /// would silently never land, with no retry. Now: request a
    /// background-task assertion so iOS grants the process a real
    /// execution window, await the ack POST inside it, and only THEN call
    /// completionHandler. The assertion's own expiration handler is a
    /// backstop — if the OS is about to reclaim the window regardless, we
    /// still complete cleanly instead of getting killed mid-POST.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let request = response.notification.request
        let content = request.content
        let categoryId = content.categoryIdentifier
        let actionId = response.actionIdentifier

        // Extract the deep-link from the payload's `faff` dict so we can
        // route in-app if the runner tapped the body (not an inline action).
        let userInfo = content.userInfo
        let faff = userInfo["faff"] as? [String: Any]
        let dedupKey = faff?["dedup_key"] as? String
        let deepLink = faff?["deeplink"] as? String
        // dispatch.ts echoes the notifications_log row id into
        // faff.notification_id (P1-25) — pass it through so the ack lands
        // on THAT exact row instead of the dedup-key-latest heuristic,
        // same precision the in-app inbox tap already gets.
        let notificationId = (faff?["notification_id"] as? NSNumber)?.intValue

        // Action-id 'default' means "tapped body, not an action button" —
        // we just open the deep-link, no ack POST (there's no rating to
        // record). 'dismiss' means swiped away — record silently.
        let shouldPost = actionId != UNNotificationDefaultActionIdentifier
                      && actionId != UNNotificationDismissActionIdentifier

        func openDeepLinkIfNeeded() {
            guard let link = deepLink, let url = URL(string: link) else { return }
            // If the action carries .foreground (open, reconnect, etc.),
            // iOS is already foregrounding the app — we just need to route
            // to the deep-link target. For non-foreground actions (READY,
            // SOLID, BETTER …) we stay backgrounded so the runner doesn't
            // get yanked into the app.
            guard UIApplication.shared.applicationState == .active
                    || actionId == UNNotificationDefaultActionIdentifier else { return }
            // Use the universal-link opener — the rest of the app
            // (TodayView, RaceDetailSheet) already listens for these URLs
            // via SceneDelegate-less SwiftUI .onOpenURL.
            UIApplication.shared.open(url)
        }

        guard shouldPost else {
            openDeepLinkIfNeeded()
            completionHandler()
            return
        }

        let wireCategory = NotificationCategories.wireCategory(forCategoryId: categoryId)
        let wireAction = NotificationCategories.wireAction(forActionId: actionId)

        // Both the expiration handler and the ack Task can race to finish
        // first — route both through one @MainActor guard so the
        // completionHandler / endBackgroundTask pair fires exactly once
        // regardless of which side wins.
        let ackGuard = BackgroundAckGuard(completionHandler: completionHandler)
        let bgTaskId = UIApplication.shared.beginBackgroundTask(withName: "faff.notif.ack") {
            // Expiration handler · the OS is about to reclaim the window.
            // Complete now so we don't get killed mid-POST with the
            // completion handler never called (that itself is a policy
            // violation iOS penalizes on future background launches).
            Task { @MainActor in ackGuard.complete() }
        }
        ackGuard.bgTaskId = bgTaskId

        Task { @MainActor in
            await API.ackNotification(
                category: wireCategory,
                action: wireAction,
                dedupKey: dedupKey,
                notificationId: notificationId
            )
            openDeepLinkIfNeeded()
            ackGuard.complete()
        }
    }
}

/// One-shot completion guard for the background-task-assertion window
/// around a notification ack POST. `complete()` is idempotent — whichever
/// of (ack finished) / (assertion about to expire) fires first wins, and
/// the other becomes a no-op. @MainActor because UIApplication's
/// begin/endBackgroundTask and the completionHandler are all expected on
/// the main thread, and this collapses every call site onto one queue so
/// there's no separate lock to reason about.
@MainActor
private final class BackgroundAckGuard {
    private let completionHandler: () -> Void
    private var didComplete = false
    var bgTaskId: UIBackgroundTaskIdentifier = .invalid

    init(completionHandler: @escaping () -> Void) {
        self.completionHandler = completionHandler
    }

    func complete() {
        guard !didComplete else { return }
        didComplete = true
        if bgTaskId != .invalid {
            UIApplication.shared.endBackgroundTask(bgTaskId)
            bgTaskId = .invalid
        }
        completionHandler()
    }
}
