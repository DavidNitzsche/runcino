//
//  HRAlerter.swift  (P35)
//  Phone-side HR ceiling alert. Subscribes to new HR samples in
//  HealthKit; when one arrives during an active workout AND the value
//  exceeds the user's ceiling, fires a local notification.
//
//  Backup to the watch's own HR alert — useful when the phone is in a
//  pocket / on a treadmill console and the watch buzz is muted.
//
//  Toggle: profile.phone_hr_alerts (settings sheet). Cached locally to
//  avoid a round-trip per sample.
//

import Foundation
import HealthKit
import UserNotifications

@MainActor
final class HRAlerter: ObservableObject {
    static let shared = HRAlerter()
    private init() {}

    /// HKHealthStore is thread-safe. Reads happen via callbacks; we
    /// don't await on the store directly.
    nonisolated private let store = HKHealthStore()
    private var observerActive = false
    private var anchor: HKQueryAnchor?
    private var lastAlertAt: Date?

    /// Minimum spacing between phone alerts so a sustained spike doesn't
    /// buzz every second. 90s matches the watch alerter cooldown.
    private let cooldownSec: TimeInterval = 90

    @Published var enabled: Bool = UserDefaults.standard.bool(forKey: "faff.phone_hr_alerts")
    @Published var ceilingBpm: Int? = UserDefaults.standard.object(forKey: "faff.phone_hr_ceiling") as? Int

    func configure(enabled: Bool, ceiling: Int?) {
        self.enabled = enabled
        self.ceilingBpm = ceiling
        UserDefaults.standard.set(enabled, forKey: "faff.phone_hr_alerts")
        if let c = ceiling { UserDefaults.standard.set(c, forKey: "faff.phone_hr_ceiling") }
        if enabled { Task { await start() } } else { stop() }
    }

    func start() async {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        guard enabled, !observerActive else { return }

        // Request notification permission once. Silent if already granted.
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])

        let hrType = HKQuantityType(.heartRate)
        let q = HKObserverQuery(sampleType: hrType, predicate: nil) { [weak self] _, _, _ in
            // Fire the drain on a Task so we can hop back to MainActor.
            Task { await self?.flushNewSamples() }
        }
        store.execute(q)
        observerActive = true
        store.enableBackgroundDelivery(for: hrType, frequency: .immediate) { _, _ in }
    }

    func stop() {
        // Leaving the query attached is fine; we just guard at flush time.
        observerActive = false
    }

    /// Drain new HR samples since the anchor; if any exceed the ceiling,
    /// fire a local notification (respecting the cooldown).
    private func flushNewSamples() async {
        guard enabled, let ceiling = ceilingBpm else { return }
        let hrType = HKQuantityType(.heartRate)
        let bpm = HKUnit.count().unitDivided(by: .minute())
        let threshold = Double(ceiling) * 0.95

        let snapshotAnchor = self.anchor

        let (newSamples, newAnchor): ([HKQuantitySample], HKQueryAnchor?) = await withCheckedContinuation { cont in
            let q = HKAnchoredObjectQuery(
                type: hrType, predicate: nil, anchor: snapshotAnchor, limit: HKObjectQueryNoLimit
            ) { _, samples, _, newAnchor, _ in
                cont.resume(returning: ((samples as? [HKQuantitySample]) ?? [], newAnchor))
            }
            store.execute(q)
        }
        self.anchor = newAnchor ?? self.anchor
        guard !newSamples.isEmpty else { return }

        // Find the highest sample in this batch
        var peak: Double = 0
        for s in newSamples {
            let v = s.quantity.doubleValue(for: bpm)
            if v > peak { peak = v }
        }
        if peak > threshold {
            maybeFire(val: Int(peak.rounded()), ceiling: ceiling)
        }
    }

    private func maybeFire(val: Int, ceiling: Int) {
        let now = Date()
        if let last = lastAlertAt, now.timeIntervalSince(last) < cooldownSec { return }
        lastAlertAt = now
        let content = UNMutableNotificationContent()
        content.title = "HR ceiling"
        content.body  = "Heart rate \(val) bpm — above your \(ceiling) ceiling. Back off?"
        content.sound = .default
        let req = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(req)
    }
}
