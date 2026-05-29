//
//  NotificationCategories.swift
//  Notifications v1 — UNNotificationCategory + UNNotificationAction
//  registration for the seven categories in the design deck
//  (docs/2026-05-28-notifications.html §4).
//
//  Apple requires categories be registered at launch via
//  UNUserNotificationCenter.setNotificationCategories. Without this, the
//  rich-action buttons don't render — the OS just shows a flat alert with
//  no inline buttons.
//
//  Each category identifier MUST match the string the web returns in the
//  `aps.category` field (see web-v2/lib/notifications/apns.ts apnsCategoryId).
//
//  Action handlers (UNUserNotificationCenterDelegate) live in FaffApp's
//  AppDelegate — they POST to /api/notifications/ack on tap.
//

import UserNotifications

enum NotificationCategoryId {
    static let raceDay        = "FAFF_RACE_DAY"
    static let raceEve        = "FAFF_RACE_EVE"
    static let skipRecov      = "FAFF_SKIP_RECOV"
    static let weekly         = "FAFF_WEEKLY"
    static let niggle         = "FAFF_NIGGLE"
    static let milestone      = "FAFF_MILESTONE"
    static let stravaReconnect = "FAFF_STRAVA_RECON"
}

/// Action identifiers — match the ApnsActionButton.identifier strings
/// emitted by the web's templates.ts.
enum NotificationActionId {
    // Race day / eve — open-only
    static let openRace      = "OPEN_RACE"
    static let openChecklist = "OPEN_CHECKLIST"

    // Skip recovery
    static let ready         = "READY"
    static let stillSkipping = "STILL_SKIPPING"

    // Weekly check-in
    static let solid         = "SOLID"
    static let tired         = "TIRED"
    static let wrecked       = "WRECKED"

    // Niggle / sick
    static let better        = "BETTER"
    static let same          = "SAME"
    static let worse         = "WORSE"
    static let gone          = "GONE"
    static let recovered     = "RECOVERED"

    // Strava reconnect
    static let reconnect     = "RECONNECT"
}

enum NotificationCategories {
    /// Register all categories with the OS. Called once at app launch from
    /// FaffApp.task. Idempotent — re-registering the same set is a no-op.
    static func register() {
        let center = UNUserNotificationCenter.current()
        center.setNotificationCategories(allCategories())
    }

    private static func allCategories() -> Set<UNNotificationCategory> {
        // A · RACE DAY — one OPEN action.
        let raceDay = UNNotificationCategory(
            identifier: NotificationCategoryId.raceDay,
            actions: [
                UNNotificationAction(
                    identifier: NotificationActionId.openRace,
                    title: "OPEN FAFF",
                    options: [.foreground]
                )
            ],
            intentIdentifiers: [],
            options: []
        )

        // B · RACE EVE — one OPEN action.
        let raceEve = UNNotificationCategory(
            identifier: NotificationCategoryId.raceEve,
            actions: [
                UNNotificationAction(
                    identifier: NotificationActionId.openChecklist,
                    title: "OPEN CHECKLIST",
                    options: [.foreground]
                )
            ],
            intentIdentifiers: [],
            options: []
        )

        // C · SKIP RECOVERY — READY vs STILL SKIPPING (inline, no unlock).
        let skipRecov = UNNotificationCategory(
            identifier: NotificationCategoryId.skipRecov,
            actions: [
                UNNotificationAction(
                    identifier: NotificationActionId.ready,
                    title: "READY",
                    options: []
                ),
                UNNotificationAction(
                    identifier: NotificationActionId.stillSkipping,
                    title: "STILL SKIPPING",
                    options: []
                )
            ],
            intentIdentifiers: [],
            options: []
        )

        // D · WEEKLY — SOLID / TIRED / WRECKED (inline).
        let weekly = UNNotificationCategory(
            identifier: NotificationCategoryId.weekly,
            actions: [
                UNNotificationAction(
                    identifier: NotificationActionId.solid,
                    title: "SOLID",
                    options: []
                ),
                UNNotificationAction(
                    identifier: NotificationActionId.tired,
                    title: "TIRED",
                    options: []
                ),
                UNNotificationAction(
                    identifier: NotificationActionId.wrecked,
                    title: "WRECKED",
                    options: [.destructive]
                )
            ],
            intentIdentifiers: [],
            options: []
        )

        // E · NIGGLE / SICK — BETTER / SAME / WORSE / GONE / RECOVERED.
        // We register BOTH 'gone' (niggle) and 'recovered' (sick) on the
        // same category — the server routes per-category in the ack.
        let niggle = UNNotificationCategory(
            identifier: NotificationCategoryId.niggle,
            actions: [
                UNNotificationAction(
                    identifier: NotificationActionId.better,
                    title: "BETTER",
                    options: []
                ),
                UNNotificationAction(
                    identifier: NotificationActionId.same,
                    title: "SAME",
                    options: []
                ),
                UNNotificationAction(
                    identifier: NotificationActionId.worse,
                    title: "WORSE",
                    options: [.destructive]
                ),
                UNNotificationAction(
                    identifier: NotificationActionId.gone,
                    title: "GONE",
                    options: []
                )
            ],
            intentIdentifiers: [],
            options: []
        )

        // F · STREAK / MILESTONE — soft beat, no actions.
        let milestone = UNNotificationCategory(
            identifier: NotificationCategoryId.milestone,
            actions: [],
            intentIdentifiers: [],
            options: []
        )

        // G · STRAVA RECONNECT — RECONNECT requires unlock (touches OAuth).
        let stravaReconnect = UNNotificationCategory(
            identifier: NotificationCategoryId.stravaReconnect,
            actions: [
                UNNotificationAction(
                    identifier: NotificationActionId.reconnect,
                    title: "RECONNECT",
                    options: [.foreground, .authenticationRequired]
                )
            ],
            intentIdentifiers: [],
            options: []
        )

        return [raceDay, raceEve, skipRecov, weekly, niggle, milestone, stravaReconnect]
    }

    /// Map a UNNotificationCategory identifier to the wire-level kind the
    /// server expects in /api/notifications/ack. Mirrors apnsCategoryId
    /// (web-v2/lib/notifications/apns.ts) in reverse.
    static func wireCategory(forCategoryId id: String) -> String {
        switch id {
        case NotificationCategoryId.raceDay:         return "race_day"
        case NotificationCategoryId.raceEve:         return "race_eve"
        case NotificationCategoryId.skipRecov:       return "skip_recovery"
        case NotificationCategoryId.weekly:          return "weekly_checkin"
        case NotificationCategoryId.niggle:          return "niggle_sick"
        case NotificationCategoryId.milestone:       return "streak"
        case NotificationCategoryId.stravaReconnect: return "strava_reconnect"
        default:                                     return "unknown"
        }
    }

    /// Lowercase the action identifier for the wire — the web's ack
    /// endpoint compares against lowercase strings.
    static func wireAction(forActionId id: String) -> String {
        return id.lowercased()
    }
}
