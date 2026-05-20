//
//  HealthKitManager.swift
//  Faff
//
//  The roots of the Apple Health integration (docs/native/05 §Health).
//  Reads the biometric streams Faff's coaching surfaces consume — resting
//  HR, max HR, VO2max, sleep — and batch-uploads them to
//  POST /api/health/ingest, which UPSERTs by (type, dateISO).
//
//  Authorization + reads run against the live HKHealthStore. The
//  entitlement (com.apple.developer.healthkit) and the
//  NSHealthShareUsageDescription strings are already on the iPhone target.
//
//  Scope of these roots: read + ingest the four daily streams the backend
//  accepts today. workout_hr_avg comes from the watch workout path, not
//  here. HRV isn't an accepted ingest type yet, so it's intentionally
//  omitted until the backend adds it.
//

import Foundation
import Combine
import HealthKit

@MainActor
final class HealthKitManager: ObservableObject {
    static let shared = HealthKitManager()
    private init() {}

    /// HKHealthStore is thread-safe; reads run off the main actor.
    nonisolated let store = HKHealthStore()

    enum Status: Equatable { case idle, requesting, syncing, done, unavailable, error }
    @Published var status: Status = .idle
    @Published var lastMessage: String?

    var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    /// Read scopes. Faff never writes to Health from the phone (the watch
    /// owns workout write-back), so `toShare` is empty.
    nonisolated static let readTypes: Set<HKObjectType> = [
        HKQuantityType(.restingHeartRate),
        HKQuantityType(.heartRate),
        HKQuantityType(.heartRateVariabilitySDNN),
        HKQuantityType(.vo2Max),
        HKCategoryType(.sleepAnalysis),
        HKObjectType.workoutType(),
    ]

    /// Set once the user has granted (or been prompted for) Health access,
    /// so we can quietly re-sync on later launches without re-prompting.
    private let connectedKey = "faff.health.connected"
    var hasConnected: Bool { UserDefaults.standard.bool(forKey: connectedKey) }

    // MARK: - Top-level flow

    /// Request authorization, read recent samples, and (when signed in)
    /// push them to the backend. Drives `status` / `lastMessage` for the UI.
    func connectAndSync(daysBack: Int = 14) async {
        guard isAvailable else {
            status = .unavailable
            lastMessage = "Apple Health isn't available on this device."
            return
        }
        status = .requesting
        do {
            try await store.requestAuthorization(toShare: [], read: Self.readTypes)
            UserDefaults.standard.set(true, forKey: connectedKey)
        } catch {
            status = .error
            lastMessage = "Health authorization failed: \(error.localizedDescription)"
            return
        }

        status = .syncing
        let samples = await collectSamples(daysBack: daysBack)

        guard !samples.isEmpty else {
            status = .done
            lastMessage = "Connected — no recent Health samples to sync yet."
            return
        }
        guard TokenStore.shared.accessToken != nil else {
            status = .done
            lastMessage = "Read \(samples.count) Health readings. Sign in to sync them to your plan."
            return
        }
        do {
            let result = try await FaffAPI.shared.ingestHealthSamples(samples)
            status = .done
            lastMessage = "Synced \(result.ingested) readings from Apple Health."
        } catch {
            status = .error
            lastMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Quiet re-sync on launch / foreground — only once the user has
    /// connected, so it never prompts unprompted. No-ops otherwise.
    func syncIfConnected() async {
        guard hasConnected, isAvailable else { return }
        await connectAndSync()
    }

    // MARK: - Reads → backend sample shape

    /// Pull the last `daysBack` days of the four accepted streams.
    nonisolated func collectSamples(daysBack: Int) async -> [HealthSample] {
        var out: [HealthSample] = []
        let bpm = HKUnit.count().unitDivided(by: .minute())

        // Resting HR — daily average.
        for (date, stat) in await dailyStats(HKQuantityType(.restingHeartRate), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                out.append(HealthSample(type: "resting_hr", value: q.doubleValue(for: bpm).rounded(),
                                        dateISO: Self.isoDay(date), source: "apple_health"))
            }
        }
        // Max HR — daily maximum.
        for (date, stat) in await dailyStats(HKQuantityType(.heartRate), options: .discreteMax, days: daysBack) {
            if let q = stat.maximumQuantity() {
                out.append(HealthSample(type: "max_hr", value: q.doubleValue(for: bpm).rounded(),
                                        dateISO: Self.isoDay(date), source: "apple_health"))
            }
        }
        // HRV (SDNN) — daily average, in milliseconds.
        let ms = HKUnit.secondUnit(with: .milli)
        for (date, stat) in await dailyStats(HKQuantityType(.heartRateVariabilitySDNN), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                out.append(HealthSample(type: "hrv", value: q.doubleValue(for: ms).rounded(),
                                        dateISO: Self.isoDay(date), source: "apple_health"))
            }
        }
        // VO2max — single most-recent reading.
        if let (date, v) = await mostRecentQuantity(HKQuantityType(.vo2Max), unit: HKUnit(from: "ml/kg*min")) {
            out.append(HealthSample(type: "vo2_max", value: (v * 10).rounded() / 10,
                                    dateISO: Self.isoDay(date), source: "apple_health"))
        }
        // Sleep — asleep hours per night.
        for (day, hours) in await sleepHoursByDay(days: daysBack) where hours > 0 {
            out.append(HealthSample(type: "sleep_hours", value: (hours * 10).rounded() / 10,
                                    dateISO: day, source: "apple_health"))
        }
        return out
    }

    // MARK: - Query wrappers (off-main; HKHealthStore is thread-safe)

    /// Daily statistics (one bucket per calendar day) over the last `days`.
    private nonisolated func dailyStats(
        _ type: HKQuantityType, options: HKStatisticsOptions, days: Int,
    ) async -> [(Date, HKStatistics)] {
        await withCheckedContinuation { cont in
            let cal = Calendar.current
            let end = Date()
            let anchor = cal.startOfDay(for: end)
            guard let start = cal.date(byAdding: .day, value: -days, to: anchor) else {
                cont.resume(returning: []); return
            }
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end)
            let query = HKStatisticsCollectionQuery(
                quantityType: type,
                quantitySamplePredicate: predicate,
                options: options,
                anchorDate: anchor,
                intervalComponents: DateComponents(day: 1),
            )
            query.initialResultsHandler = { _, results, _ in
                var out: [(Date, HKStatistics)] = []
                results?.enumerateStatistics(from: start, to: end) { stat, _ in
                    out.append((stat.startDate, stat))
                }
                cont.resume(returning: out)
            }
            store.execute(query)
        }
    }

    /// Most-recent quantity sample of a type (e.g. VO2max).
    private nonisolated func mostRecentQuantity(
        _ type: HKQuantityType, unit: HKUnit,
    ) async -> (Date, Double)? {
        await withCheckedContinuation { cont in
            let sort = [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
            let query = HKSampleQuery(sampleType: type, predicate: nil, limit: 1, sortDescriptors: sort) { _, samples, _ in
                if let s = samples?.first as? HKQuantitySample {
                    cont.resume(returning: (s.endDate, s.quantity.doubleValue(for: unit)))
                } else {
                    cont.resume(returning: nil)
                }
            }
            store.execute(query)
        }
    }

    /// Asleep hours summed per night, keyed by the wake date ("yyyy-MM-dd").
    private nonisolated func sleepHoursByDay(days: Int) async -> [String: Double] {
        await withCheckedContinuation { cont in
            let cal = Calendar.current
            let end = Date()
            guard let start = cal.date(byAdding: .day, value: -days, to: cal.startOfDay(for: end)) else {
                cont.resume(returning: [:]); return
            }
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end)
            let query = HKSampleQuery(
                sampleType: HKCategoryType(.sleepAnalysis),
                predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil,
            ) { _, samples, _ in
                let asleep: Set<Int> = [
                    HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
                    HKCategoryValueSleepAnalysis.asleepCore.rawValue,
                    HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
                    HKCategoryValueSleepAnalysis.asleepREM.rawValue,
                ]
                var byDay: [String: Double] = [:]
                for case let s as HKCategorySample in (samples ?? []) where asleep.contains(s.value) {
                    let key = Self.isoDay(s.endDate)
                    byDay[key, default: 0] += s.endDate.timeIntervalSince(s.startDate) / 3600
                }
                cont.resume(returning: byDay)
            }
            store.execute(query)
        }
    }

    // MARK: - Helpers

    nonisolated static func isoDay(_ date: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}
