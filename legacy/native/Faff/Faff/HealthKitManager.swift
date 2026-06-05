//
//  HealthKitManager.swift
//  Faff
//
//  The roots of the Apple Health integration (docs/native/05 §Health).
//  Reads the biometric streams Faff's coaching surfaces consume, resting
//  HR, max HR, VO2max, sleep, and batch-uploads them to
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
import CoreLocation

@MainActor
final class HealthKitManager: ObservableObject {
    static let shared = HealthKitManager()
    private init() {}

    /// HKHealthStore is thread-safe; reads run off the main actor.
    nonisolated let store = HKHealthStore()

    enum Status: Equatable { case idle, requesting, syncing, done, unavailable, error }
    @Published var status: Status = .idle
    @Published var lastMessage: String?

    // ── Live display metrics (read straight from HealthKit for the
    //    Health tab tiles, no backend round-trip needed to show them).
    @Published var hrvMs: Double?
    @Published var restingHrBpm: Double?
    @Published var sleepHours: Double?
    @Published var vo2Max: Double?
    @Published var respiratoryRate: Double?
    @Published var wristTempC: Double?
    // Running dynamics, a 30-day average across runs (cumulative, for the
    // Health tab). Per-run dynamics for the recap come from runDynamics().
    @Published var cadenceSpm: Double?
    @Published var strideM: Double?
    @Published var vertOscCm: Double?
    @Published var groundContactMs: Double?
    @Published var vertRatioPct: Double?
    @Published var runPowerW: Double?
    // Body composition (smart-scale) + recovery/energy.
    @Published var weightKg: Double?
    @Published var bodyFatPct: Double?
    @Published var leanMassKg: Double?
    @Published var hrRecoveryBpm: Double?
    @Published var activeEnergyKcal: Double?
    @Published var spo2Pct: Double?

    var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    /// Read scopes. Faff never writes to Health from the phone (the watch
    /// owns workout write-back), so `toShare` is empty.
    nonisolated static let readTypes: Set<HKObjectType> = [
        HKQuantityType(.restingHeartRate),
        HKQuantityType(.heartRate),
        HKQuantityType(.heartRateVariabilitySDNN),
        HKQuantityType(.vo2Max),
        HKQuantityType(.respiratoryRate),
        HKQuantityType(.appleSleepingWristTemperature),
        HKQuantityType(.stepCount),
        HKQuantityType(.distanceWalkingRunning),
        HKQuantityType(.runningSpeed),
        HKQuantityType(.runningPower),
        HKQuantityType(.runningStrideLength),
        HKQuantityType(.runningVerticalOscillation),
        HKQuantityType(.runningGroundContactTime),
        // Body composition (smart-scale) + recovery/energy.
        HKQuantityType(.bodyMass),
        HKQuantityType(.bodyFatPercentage),
        HKQuantityType(.leanBodyMass),
        HKQuantityType(.heartRateRecoveryOneMinute),
        HKQuantityType(.activeEnergyBurned),
        HKQuantityType(.oxygenSaturation),
        HKCategoryType(.sleepAnalysis),
        HKObjectType.workoutType(),
        HKSeriesType.workoutRoute(),   // GPS route → map + splits for watch-only runs
    ]

    /// Set once the user has granted (or been prompted for) Health access,
    /// so we can quietly re-sync on later launches without re-prompting.
    private let connectedKey = "faff.health.connected"
    var hasConnected: Bool { UserDefaults.standard.bool(forKey: connectedKey) }

    /// Set once the one-time historical backfill has succeeded, so later
    /// syncs only pull a short rolling window instead of a full year again.
    private let backfilledKey = "faff.health.backfilled"

    /// How far back to read. The FIRST sync backfills a full year so Faff has
    /// a deep history to coach from; after that, a rolling 30-day window keeps
    /// recent days fresh (the backend UPSERTs by (type, date), so re-sending
    /// is idempotent). The backend caps a batch at 1000 samples, so a year's
    /// worth is uploaded in chunks.
    private let backfillDays = 365
    private let rollingDays = 30
    private let uploadChunk = 500

    // MARK: - Top-level flow

    /// Request authorization, read samples, and (when signed in) push them to
    /// the backend. Drives `status` / `lastMessage` for the UI.
    ///
    /// `daysBack` defaults to nil = auto: a full-year backfill the first time,
    /// then a rolling 30-day window. Pass an explicit value to override.
    func connectAndSync(daysBack: Int? = nil) async {
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
        // Populate the on-device display metrics first so the Health tab
        // shows real values immediately (independent of the backend sync).
        await refreshDisplayMetrics()

        let isBackfill = !UserDefaults.standard.bool(forKey: backfilledKey)
        let window = daysBack ?? (isBackfill ? backfillDays : rollingDays)
        let samples = await collectSamples(daysBack: window)

        guard !samples.isEmpty else {
            status = .done
            lastMessage = "Connected, no recent Health samples to sync yet."
            return
        }
        guard TokenStore.shared.accessToken != nil else {
            status = .done
            lastMessage = "Read \(samples.count) Health readings. Sign in to sync them to your plan."
            return
        }
        do {
            // The backend caps a batch at 1000 samples, so a year's worth is
            // uploaded in chunks. Each (type, date) UPSERTs, so order/overlap
            // is safe.
            var ingested = 0
            for chunk in stride(from: 0, to: samples.count, by: uploadChunk) {
                let slice = Array(samples[chunk ..< min(chunk + uploadChunk, samples.count)])
                let result = try await FaffAPI.shared.ingestHealthSamples(slice)
                ingested += result.ingested
            }
            // GPS routes (map + per-mile splits) for watch-only runs, best
            // effort, never blocks or fails the vitals sync.
            await collectAndUploadRoutes(daysBack: window)
            UserDefaults.standard.set(true, forKey: backfilledKey)
            status = .done
            lastMessage = isBackfill
                ? "Imported \(ingested) readings from the past year of Apple Health."
                : "Synced \(ingested) readings from Apple Health."
        } catch {
            status = .error
            lastMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Quiet re-sync on launch / foreground. Pushes vitals to the backend so
    /// readiness can compute (the on-device tiles read HealthKit directly and
    /// don't need this; the server score does).
    ///
    /// Self-healing: if the `connected` flag is unset (reinstall / older build /
    /// access granted outside our connect flow) but vitals are actually
    /// readable, adopt it and sync, otherwise a runner with Health authorized
    /// would never get a readiness score. Never prompts: we only adopt when a
    /// real read returns data, and we don't call requestAuthorization here.
    func syncIfConnected() async {
        guard isAvailable else { return }
        if !hasConnected {
            await refreshDisplayMetrics()
            let readable = hrvMs != nil || restingHrBpm != nil || sleepHours != nil || vo2Max != nil
            guard readable else { return }
            UserDefaults.standard.set(true, forKey: connectedKey)
        }
        await connectAndSync()
    }

    // MARK: - Reads → backend sample shape

    /// Pull the last `daysBack` days of every ingestable stream, vitals
    /// (resting/max HR, HRV, VO₂max, sleep, respiration, wrist temp) and
    /// daily running dynamics (cadence, stride, oscillation, ground
    /// contact, vertical ratio, power), for POST /api/health/ingest.
    nonisolated func collectSamples(daysBack: Int) async -> [HealthSample] {
        var out: [HealthSample] = []
        let bpm = HKUnit.count().unitDivided(by: .minute())

        // Resting HR, daily average.
        for (date, stat) in await dailyStats(HKQuantityType(.restingHeartRate), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                out.append(HealthSample(type: "resting_hr", value: q.doubleValue(for: bpm).rounded(),
                                        dateISO: Self.isoDay(date), source: "apple_health"))
            }
        }
        // Max HR, daily maximum.
        for (date, stat) in await dailyStats(HKQuantityType(.heartRate), options: .discreteMax, days: daysBack) {
            if let q = stat.maximumQuantity() {
                out.append(HealthSample(type: "max_hr", value: q.doubleValue(for: bpm).rounded(),
                                        dateISO: Self.isoDay(date), source: "apple_health"))
            }
        }
        // HRV (SDNN), daily average, in milliseconds.
        let ms = HKUnit.secondUnit(with: .milli)
        for (date, stat) in await dailyStats(HKQuantityType(.heartRateVariabilitySDNN), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                out.append(HealthSample(type: "hrv", value: q.doubleValue(for: ms).rounded(),
                                        dateISO: Self.isoDay(date), source: "apple_health"))
            }
        }
        // VO2max, single most-recent reading.
        if let (date, v) = await mostRecentQuantity(HKQuantityType(.vo2Max), unit: HKUnit(from: "ml/kg*min")) {
            out.append(HealthSample(type: "vo2_max", value: (v * 10).rounded() / 10,
                                    dateISO: Self.isoDay(date), source: "apple_health"))
        }
        // Sleep, asleep hours per night.
        for (day, hours) in await sleepHoursByDay(days: daysBack) where hours > 0 {
            out.append(HealthSample(type: "sleep_hours", value: (hours * 10).rounded() / 10,
                                    dateISO: day, source: "apple_health"))
        }
        // Respiration, daily average (breaths/min).
        let perMin = HKUnit.count().unitDivided(by: .minute())
        for (date, stat) in await dailyStats(HKQuantityType(.respiratoryRate), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                out.append(HealthSample(type: "respiratory_rate", value: (q.doubleValue(for: perMin) * 10).rounded() / 10,
                                        dateISO: Self.isoDay(date), source: "apple_health"))
            }
        }
        // Wrist temperature, nightly reading (°C).
        for (date, stat) in await dailyStats(HKQuantityType(.appleSleepingWristTemperature), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                out.append(HealthSample(type: "wrist_temp", value: (q.doubleValue(for: .degreeCelsius()) * 10).rounded() / 10,
                                        dateISO: Self.isoDay(date), source: "apple_health"))
            }
        }
        // Running dynamics, one daily average per day that has runs. The
        // dynamics quantities are only recorded during runs, so a daily
        // discreteAverage is the day's running form.
        let strideByDay = await dailyAvgMap(HKQuantityType(.runningStrideLength), unit: .meter(), days: daysBack)
        let oscByDay    = await dailyAvgMap(HKQuantityType(.runningVerticalOscillation), unit: HKUnit.meterUnit(with: .centi), days: daysBack)
        let gctByDay    = await dailyAvgMap(HKQuantityType(.runningGroundContactTime), unit: HKUnit.secondUnit(with: .milli), days: daysBack)
        let powerByDay  = await dailyAvgMap(HKQuantityType(.runningPower), unit: .watt(), days: daysBack)
        let speedByDay  = await dailyAvgMap(HKQuantityType(.runningSpeed), unit: HKUnit.meter().unitDivided(by: .second()), days: daysBack)
        for (day, v) in strideByDay { out.append(HealthSample(type: "stride_length", value: (v * 100).rounded() / 100, dateISO: day, source: "apple_health")) }
        for (day, v) in oscByDay    { out.append(HealthSample(type: "vertical_oscillation", value: (v * 10).rounded() / 10, dateISO: day, source: "apple_health")) }
        for (day, v) in gctByDay    { out.append(HealthSample(type: "ground_contact_time", value: v.rounded(), dateISO: day, source: "apple_health")) }
        for (day, v) in powerByDay  { out.append(HealthSample(type: "run_power", value: v.rounded(), dateISO: day, source: "apple_health")) }
        // Derived form, HealthKit has no direct cadence/vertical-ratio quantity,
        // so compute them from the day's averages:
        //   cadence (spm)      = speed (m/s) ÷ stride (m) × 60
        //   vertical ratio (%) = osc (cm)    ÷ stride (m)         (cm ÷ m collapses to %)
        // Server drops out-of-range values (cadence 100–230, vert ratio 3–20).
        for (day, sp) in speedByDay {
            guard let st = strideByDay[day], st > 0 else { continue }
            out.append(HealthSample(type: "cadence", value: (sp / st * 60).rounded(), dateISO: day, source: "apple_health"))
            if let osc = oscByDay[day] {
                out.append(HealthSample(type: "vertical_ratio", value: (osc / st * 10).rounded() / 10, dateISO: day, source: "apple_health"))
            }
        }
        // Body composition (smart-scale), slow-moving; one daily average.
        let kg = HKUnit.gramUnit(with: .kilo)
        for (date, stat) in await dailyStats(HKQuantityType(.bodyMass), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                out.append(HealthSample(type: "body_mass", value: (q.doubleValue(for: kg) * 10).rounded() / 10,
                                        dateISO: Self.isoDay(date), source: "apple_health"))
            }
        }
        for (date, stat) in await dailyStats(HKQuantityType(.bodyFatPercentage), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                out.append(HealthSample(type: "body_fat_pct", value: (q.doubleValue(for: .percent()) * 1000).rounded() / 10,
                                        dateISO: Self.isoDay(date), source: "apple_health"))
            }
        }
        for (date, stat) in await dailyStats(HKQuantityType(.leanBodyMass), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                out.append(HealthSample(type: "lean_mass", value: (q.doubleValue(for: kg) * 10).rounded() / 10,
                                        dateISO: Self.isoDay(date), source: "apple_health"))
            }
        }
        // HR recovery (1 min post-exertion drop), daily max (best of the day).
        for (date, stat) in await dailyStats(HKQuantityType(.heartRateRecoveryOneMinute), options: .discreteMax, days: daysBack) {
            if let q = stat.maximumQuantity() {
                out.append(HealthSample(type: "hr_recovery", value: q.doubleValue(for: bpm).rounded(),
                                        dateISO: Self.isoDay(date), source: "apple_health"))
            }
        }
        // Active energy, daily cumulative total (kcal).
        for (date, stat) in await dailyStats(HKQuantityType(.activeEnergyBurned), options: .cumulativeSum, days: daysBack) {
            if let q = stat.sumQuantity() {
                out.append(HealthSample(type: "active_energy", value: q.doubleValue(for: .kilocalorie()).rounded(),
                                        dateISO: Self.isoDay(date), source: "apple_health"))
            }
        }
        // Blood oxygen (SpO₂), daily average, fraction → %.
        for (date, stat) in await dailyStats(HKQuantityType(.oxygenSaturation), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                out.append(HealthSample(type: "spo2", value: (q.doubleValue(for: .percent()) * 1000).rounded() / 10,
                                        dateISO: Self.isoDay(date), source: "apple_health"))
            }
        }
        // Derived per day: cadence = speed·60 ÷ stride; vertical ratio = osc ÷ stride.
        for (day, stride) in strideByDay where stride > 0 {
            if let spd = speedByDay[day] {
                let cad = (spd * 60 / stride).rounded()
                if cad >= 100, cad <= 230 { out.append(HealthSample(type: "cadence", value: cad, dateISO: day, source: "apple_health")) }
            }
            if let osc = oscByDay[day] {
                let ratio = ((osc / stride) * 10).rounded() / 10
                if ratio >= 3, ratio <= 20 { out.append(HealthSample(type: "vertical_ratio", value: ratio, dateISO: day, source: "apple_health")) }
            }
        }
        return out
    }

    /// Daily discrete-average of a quantity → [dayISO: value]. Used for the
    /// running-dynamics ingest (and the speed input to derived cadence).
    private nonisolated func dailyAvgMap(_ type: HKQuantityType, unit: HKUnit, days: Int) async -> [String: Double] {
        var m: [String: Double] = [:]
        for (date, stat) in await dailyStats(type, options: .discreteAverage, days: days) {
            if let q = stat.averageQuantity() { m[Self.isoDay(date)] = q.doubleValue(for: unit) }
        }
        return m
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

    // MARK: - Live display metrics (direct HealthKit reads)

    /// Read the latest vitals + the most-recent run's dynamics and publish
    /// them for the Health tab tiles. Best-effort, any unavailable metric
    /// stays nil and the tile shows its honest "No data" state.
    func refreshDisplayMetrics() async {
        guard isAvailable else { return }
        let bpm = HKUnit.count().unitDivided(by: .minute())

        if let (_, v) = await mostRecentQuantity(HKQuantityType(.heartRateVariabilitySDNN), unit: HKUnit.secondUnit(with: .milli)) { hrvMs = v.rounded() }
        if let (_, v) = await mostRecentQuantity(HKQuantityType(.restingHeartRate), unit: bpm) { restingHrBpm = v.rounded() }
        if let (_, v) = await mostRecentQuantity(HKQuantityType(.vo2Max), unit: HKUnit(from: "ml/kg*min")) { vo2Max = (v * 10).rounded() / 10 }
        if let (_, v) = await mostRecentQuantity(HKQuantityType(.respiratoryRate), unit: bpm) { respiratoryRate = (v * 10).rounded() / 10 }
        if let (_, v) = await mostRecentQuantity(HKQuantityType(.appleSleepingWristTemperature), unit: .degreeCelsius()) { wristTempC = (v * 10).rounded() / 10 }
        let sleep = await sleepHoursByDay(days: 2)
        if let latest = sleep.keys.sorted().last, let h = sleep[latest], h > 0 { sleepHours = (h * 10).rounded() / 10 }

        // Body composition (smart-scale) + recovery/energy, latest readings.
        let kg = HKUnit.gramUnit(with: .kilo)
        if let (_, v) = await mostRecentQuantity(HKQuantityType(.bodyMass), unit: kg) { weightKg = (v * 10).rounded() / 10 }
        if let (_, v) = await mostRecentQuantity(HKQuantityType(.bodyFatPercentage), unit: .percent()) { bodyFatPct = (v * 1000).rounded() / 10 }
        if let (_, v) = await mostRecentQuantity(HKQuantityType(.leanBodyMass), unit: kg) { leanMassKg = (v * 10).rounded() / 10 }
        if let (_, v) = await mostRecentQuantity(HKQuantityType(.heartRateRecoveryOneMinute), unit: bpm) { hrRecoveryBpm = v.rounded() }
        if let (_, v) = await mostRecentQuantity(HKQuantityType(.oxygenSaturation), unit: .percent()) { spo2Pct = (v * 1000).rounded() / 10 }
        // Active energy, today's cumulative total.
        let dayStart = Calendar.current.startOfDay(for: Date())
        let todayPred = HKQuery.predicateForSamples(withStart: dayStart, end: Date(), options: .strictStartDate)
        if let kcal = await sum(HKQuantityType(.activeEnergyBurned), unit: .kilocalorie(), predicate: todayPred) { activeEnergyKcal = kcal.rounded() }

        // Running dynamics, CUMULATIVE: a 30-day average across every run,
        // not the last run. The per-run breakdown lives on the run recap.
        // The dynamics quantities are only recorded by the watch during
        // runs, so a windowed discreteAverage naturally averages over runs.
        let now = Date()
        let start = Calendar.current.date(byAdding: .day, value: -30, to: now) ?? now
        let win = HKQuery.predicateForSamples(withStart: start, end: now, options: .strictStartDate)
        if let stride = await avg(HKQuantityType(.runningStrideLength), unit: .meter(), predicate: win) { strideM = (stride * 100).rounded() / 100 }
        if let osc = await avg(HKQuantityType(.runningVerticalOscillation), unit: HKUnit.meterUnit(with: .centi), predicate: win) { vertOscCm = (osc * 10).rounded() / 10 }
        if let gct = await avg(HKQuantityType(.runningGroundContactTime), unit: HKUnit.secondUnit(with: .milli), predicate: win) { groundContactMs = gct.rounded() }
        if let power = await avg(HKQuantityType(.runningPower), unit: .watt(), predicate: win) { runPowerW = power.rounded() }
        if let osc = vertOscCm, let st = strideM, st > 0 { vertRatioPct = ((osc / 100) / st * 1000).rounded() / 10 }
        // Cadence (spm) over the window = avg running speed (m/min) ÷ stride (m).
        let mps = HKUnit.meter().unitDivided(by: .second())
        if let spd = await avg(HKQuantityType(.runningSpeed), unit: mps, predicate: win), let st = strideM, st > 0 {
            cadenceSpm = (spd * 60 / st).rounded()
        }
    }

    /// Per-run running dynamics for the run recap, averaged over the
    /// running workout on a given calendar day. This is the LAST-RUN read
    /// (the recap's job); the Health tab shows the cumulative 30-day avg.
    struct RunDynamics: Equatable {
        var cadenceSpm: Double?
        var strideM: Double?
        var vertOscCm: Double?
        var groundContactMs: Double?
        var vertRatioPct: Double?
        var runPowerW: Double?
        var hasAny: Bool { [cadenceSpm, strideM, vertOscCm, groundContactMs, vertRatioPct, runPowerW].contains { $0 != nil } }
    }

    /// Read the dynamics for the run on `dateISO` (yyyy-MM-dd). Returns nil
    /// when HealthKit is unavailable or no run is found / nothing recorded.
    func runDynamics(forDateISO dateISO: String) async -> RunDynamics? {
        guard isAvailable, let run = await runWorkout(onDateISO: dateISO) else { return nil }
        let pred = HKQuery.predicateForObjects(from: run)
        var d = RunDynamics()
        if let stride = await avg(HKQuantityType(.runningStrideLength), unit: .meter(), predicate: pred) { d.strideM = (stride * 100).rounded() / 100 }
        if let osc = await avg(HKQuantityType(.runningVerticalOscillation), unit: HKUnit.meterUnit(with: .centi), predicate: pred) { d.vertOscCm = (osc * 10).rounded() / 10 }
        if let gct = await avg(HKQuantityType(.runningGroundContactTime), unit: HKUnit.secondUnit(with: .milli), predicate: pred) { d.groundContactMs = gct.rounded() }
        if let power = await avg(HKQuantityType(.runningPower), unit: .watt(), predicate: pred) { d.runPowerW = power.rounded() }
        if let osc = d.vertOscCm, let st = d.strideM, st > 0 { d.vertRatioPct = ((osc / 100) / st * 1000).rounded() / 10 }
        if let steps = await sum(HKQuantityType(.stepCount), unit: .count(), predicate: pred) {
            let mins = run.duration / 60
            if mins > 0 { d.cadenceSpm = (steps / mins).rounded() }
        }
        return d.hasAny ? d : nil
    }

    /// The running workout on a calendar day (UTC day window matches the
    /// recap's date key), the latest-ending run that day.
    private nonisolated func runWorkout(onDateISO dateISO: String) async -> HKWorkout? {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "UTC")
        guard let day = f.date(from: String(dateISO.prefix(10))) else { return nil }
        let end = day.addingTimeInterval(86_400)
        return await withCheckedContinuation { cont in
            let runP = HKQuery.predicateForWorkouts(with: .running)
            let dayP = HKQuery.predicateForSamples(withStart: day, end: end, options: .strictStartDate)
            let pred = NSCompoundPredicate(andPredicateWithSubpredicates: [runP, dayP])
            let sort = [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
            let q = HKSampleQuery(sampleType: .workoutType(), predicate: pred, limit: 1, sortDescriptors: sort) { _, samples, _ in
                cont.resume(returning: samples?.first as? HKWorkout)
            }
            store.execute(q)
        }
    }

    /// The most recent running workout (for per-run dynamics).
    private nonisolated func mostRecentRun() async -> HKWorkout? {
        await withCheckedContinuation { cont in
            let pred = HKQuery.predicateForWorkouts(with: .running)
            let sort = [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
            let q = HKSampleQuery(sampleType: .workoutType(), predicate: pred, limit: 1, sortDescriptors: sort) { _, samples, _ in
                cont.resume(returning: samples?.first as? HKWorkout)
            }
            store.execute(q)
        }
    }

    private nonisolated func avg(_ type: HKQuantityType, unit: HKUnit, predicate: NSPredicate) async -> Double? {
        await withCheckedContinuation { cont in
            let q = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: .discreteAverage) { _, stats, _ in
                cont.resume(returning: stats?.averageQuantity()?.doubleValue(for: unit))
            }
            store.execute(q)
        }
    }
    private nonisolated func sum(_ type: HKQuantityType, unit: HKUnit, predicate: NSPredicate) async -> Double? {
        await withCheckedContinuation { cont in
            let q = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, stats, _ in
                cont.resume(returning: stats?.sumQuantity()?.doubleValue(for: unit))
            }
            store.execute(q)
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

// MARK: - GPS routes (HKWorkoutRoute → map + per-mile splits)

private struct RouteSplitUpload: Encodable {
    let mile: Int; let paceSPerMi: Int; let avgHr: Int?; let elevDeltaFt: Int?
}
private struct RouteUpload: Encodable {
    let startedAt: String; let routeDate: String
    let distanceMi: Double?; let durationSec: Int?
    let polyline: String
    let startLat: Double?; let startLng: Double?; let endLat: Double?; let endLng: Double?
    let splits: [RouteSplitUpload]
}

/// Accumulates the HKWorkoutRouteQuery's batched callbacks. HealthKit calls
/// the handler serially, so the unchecked Sendable is safe.
private final class RouteBox: @unchecked Sendable { var locs: [CLLocation] = []; var done = false }

extension HealthKitManager {
    /// Read recent running workouts' GPS routes from Apple Health, encode each
    /// as a polyline + compute per-mile splits, and upload to /api/watch/route.
    /// Best-effort: every failure is swallowed so it never disrupts the vitals
    /// sync. Gives watch-only runs (not on Strava) a recap map + splits.
    nonisolated func collectAndUploadRoutes(daysBack: Int) async {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        let store = HKHealthStore()
        let start = Calendar.current.date(byAdding: .day, value: -daysBack, to: Date()) ?? Date()
        let datePred = HKQuery.predicateForSamples(withStart: start, end: Date(), options: .strictStartDate)
        let runPred = HKQuery.predicateForWorkouts(with: .running)
        let pred = NSCompoundPredicate(andPredicateWithSubpredicates: [datePred, runPred])
        let workouts: [HKWorkout] = await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: .workoutType(), predicate: pred,
                                  limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
                cont.resume(returning: (samples as? [HKWorkout]) ?? [])
            }
            store.execute(q)
        }
        // Run SUMMARIES (distance/time/HR) for every running workout — posted
        // to the de-duped import so a run shows up even when it has no GPS
        // route and even if the watch->phone completion never fired. The
        // backend keys on start time, so this can't duplicate a run that also
        // arrived via the watch completion or Strava.
        let bpm = HKUnit.count().unitDivided(by: .minute())
        var summaries: [[String: Any]] = []
        for w in workouts {
            let meters = w.statistics(for: HKQuantityType(.distanceWalkingRunning))?
                .sumQuantity()?.doubleValue(for: .meter())
                ?? w.totalDistance?.doubleValue(for: .meter()) ?? 0
            let miles = meters / 1609.344
            if miles > 0 && w.duration > 0 {
                var s: [String: Any] = [
                    "startISO": ISO8601DateFormatter().string(from: w.startDate),
                    "distanceMi": (miles * 100).rounded() / 100,
                    "durationSec": Int(w.duration.rounded()),
                ]
                let hr = w.statistics(for: HKQuantityType(.heartRate))
                if let avg = hr?.averageQuantity()?.doubleValue(for: bpm) { s["avgHr"] = Int(avg.rounded()) }
                if let mx = hr?.maximumQuantity()?.doubleValue(for: bpm) { s["maxHr"] = Int(mx.rounded()) }
                summaries.append(s)
            }
        }
        if !summaries.isEmpty,
           let data = try? JSONSerialization.data(withJSONObject: ["workouts": summaries]) {
            _ = try? await FaffAPI.shared.importHealthWorkouts(data)
        }

        // GPS route + per-mile splits for the recap map (only runs that have one).
        for w in workouts {
            guard let locs = await routeLocations(for: w, store: store), locs.count >= 2 else { continue }
            guard let payload = Self.buildRoutePayload(workout: w, locations: locs),
                  let data = try? JSONEncoder().encode(payload) else { continue }
            _ = try? await FaffAPI.shared.postWatchRoute(data)
        }
    }

    /// Stream the CLLocations for a workout's route (nil if it has none).
    nonisolated func routeLocations(for workout: HKWorkout, store: HKHealthStore) async -> [CLLocation]? {
        let routes: [HKWorkoutRoute] = await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: HKSeriesType.workoutRoute(),
                                  predicate: HKQuery.predicateForObjects(from: workout),
                                  limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
                cont.resume(returning: (samples as? [HKWorkoutRoute]) ?? [])
            }
            store.execute(q)
        }
        guard let route = routes.first else { return nil }
        let box = RouteBox()
        return await withCheckedContinuation { (cont: CheckedContinuation<[CLLocation]?, Never>) in
            let rq = HKWorkoutRouteQuery(route: route) { _, locations, finished, _ in
                if let locations { box.locs.append(contentsOf: locations) }
                if finished && !box.done { box.done = true; cont.resume(returning: box.locs.isEmpty ? nil : box.locs) }
            }
            store.execute(rq)
        }
    }

    /// Downsampled polyline + per-mile splits from a route's locations.
    ///
    /// 2026-06-03 round 71 · pause-aware per-mile elapsed time, per
    /// backend brief designs/briefs/iphone-split-pause-fix.md.
    /// Prior bug: raw GPS timestamps included paused intervals,
    /// inflating mile pace whenever the runner paused mid-mile.
    /// Now reads HKWorkoutEvent pause/resume markers and subtracts
    /// any overlap from each mile's elapsed time. Reconciliation
    /// self-check (sum of splits vs workout.duration ± 5s) drops the
    /// splits if the math doesn't add up · same tolerance as backend.
    nonisolated fileprivate static func buildRoutePayload(workout: HKWorkout, locations rawLocs: [CLLocation]) -> RouteUpload? {
        let locs = rawLocs
            .filter { $0.horizontalAccuracy >= 0 && $0.horizontalAccuracy <= 50 }
            .sorted { $0.timestamp < $1.timestamp }
        guard locs.count >= 2 else { return nil }

        let pauses = pauseRanges(in: workout)

        // Per-mile splits, walk the path accumulating distance + time.
        let mileMeters = 1609.344
        var splits: [RouteSplitUpload] = []
        var distSoFar = 0.0, lastMileMark = 0.0
        var mileStartTime = locs[0].timestamp, mileStartElev = locs[0].altitude
        var mileNo = 1
        for i in 1..<locs.count {
            distSoFar += locs[i].distance(from: locs[i - 1])
            while distSoFar >= lastMileMark + mileMeters {
                lastMileMark += mileMeters
                let pace = Int(unpaused(
                    from: mileStartTime, to: locs[i].timestamp, pauses: pauses
                ).rounded())
                if pace >= 120 && pace <= 3600 {
                    let elevFt = Int(((locs[i].altitude - mileStartElev) * 3.28084).rounded())
                    splits.append(RouteSplitUpload(mile: mileNo, paceSPerMi: pace, avgHr: nil, elevDeltaFt: elevFt))
                }
                mileNo += 1
                mileStartTime = locs[i].timestamp
                mileStartElev = locs[i].altitude
            }
        }

        // Reconciliation self-check · sum of splits must match
        // workout.duration ± 5s. If off, our derivation is still
        // wrong — drop the splits rather than ship bad numbers.
        // Backend's /api/ingest/workout uses the same 5s tolerance.
        let splitsSumS = splits.reduce(0) { $0 + $1.paceSPerMi }
        let durationS = Int(workout.duration.rounded())
        if !splits.isEmpty && abs(splitsSumS - durationS) > 5 {
            print("⚠️ [HK] splits don't reconcile · sum=\(splitsSumS)s vs duration=\(durationS)s (Δ\(abs(splitsSumS - durationS))s) · dropping splits")
            splits = []
        }

        // Downsample so the payload stays small (~600 points is plenty for a map).
        var coords: [(Double, Double)] = []
        let step = max(1, locs.count / 600)
        var idx = 0
        while idx < locs.count { coords.append((locs[idx].coordinate.latitude, locs[idx].coordinate.longitude)); idx += step }
        if let last = locs.last { coords.append((last.coordinate.latitude, last.coordinate.longitude)) }

        let distMi = workout.totalDistance?.doubleValue(for: .mile()) ?? (distSoFar / mileMeters)
        return RouteUpload(
            startedAt: ISO8601DateFormatter().string(from: workout.startDate),
            routeDate: HealthKitManager.isoDay(workout.startDate),
            distanceMi: (distMi * 100).rounded() / 100,
            durationSec: Int(workout.duration.rounded()),
            polyline: encodePolyline(coords),
            startLat: locs.first?.coordinate.latitude, startLng: locs.first?.coordinate.longitude,
            endLat: locs.last?.coordinate.latitude, endLng: locs.last?.coordinate.longitude,
            splits: splits)
    }

    /// 2026-06-03 round 71 · paused-time ranges from HKWorkoutEvent
    /// pause + resume markers (per backend brief). Pairs each pause
    /// with its matching resume. Workout-ended-while-paused edge
    /// case closes the open range at workout.endDate.
    /// 2026-06-05 round 88 · added `.motionPaused` / `.motionResumed`
    /// alongside `.pause` / `.resume`. Apple Watch's AUTO-PAUSE
    /// (motion-detected stop at red lights, water stops, etc.) emits
    /// the motion pair, not the user-initiated pair. Backend audit
    /// (designs/briefs/iphone-hk-splits-regression-2026-06-05.md)
    /// confirmed iPhone was producing n_splits=0 across every recent
    /// apple_watch ingest row because the reconciliation guard
    /// dropped splits whose sum exceeded duration by 60-315s · that
    /// 60-315s was auto-pause time the old code wasn't subtracting.
    nonisolated fileprivate static func pauseRanges(in workout: HKWorkout) -> [(Date, Date)] {
        var ranges: [(Date, Date)] = []
        var pausedAt: Date? = nil
        let events = workout.workoutEvents ?? []
        for ev in events {
            switch ev.type {
            case .pause, .motionPaused:
                pausedAt = ev.dateInterval.start
            case .resume, .motionResumed:
                if let start = pausedAt {
                    ranges.append((start, ev.dateInterval.start))
                    pausedAt = nil
                }
            default:
                break
            }
        }
        if let start = pausedAt {
            ranges.append((start, workout.endDate))
        }
        return ranges
    }

    /// 2026-06-03 round 71 · elapsed time across [start, end] MINUS any
    /// overlap with paused intervals. Mirrors what workout.duration
    /// already does at the whole-workout level.
    nonisolated fileprivate static func unpaused(
        from start: Date, to end: Date, pauses: [(Date, Date)]
    ) -> TimeInterval {
        var elapsed = end.timeIntervalSince(start)
        for (pStart, pEnd) in pauses {
            let overlapStart = max(start, pStart)
            let overlapEnd = min(end, pEnd)
            let overlap = overlapEnd.timeIntervalSince(overlapStart)
            if overlap > 0 { elapsed -= overlap }
        }
        return max(0, elapsed)
    }

    /// Google polyline encoder (precision 5).
    nonisolated static func encodePolyline(_ coords: [(Double, Double)]) -> String {
        var result = ""
        var prevLat = 0, prevLng = 0
        func enc(_ v: Int) {
            var value = v < 0 ? ~(v << 1) : (v << 1)
            while value >= 0x20 {
                result.append(Character(UnicodeScalar(UInt8((0x20 | (value & 0x1f)) + 63))))
                value >>= 5
            }
            result.append(Character(UnicodeScalar(UInt8(value + 63))))
        }
        for (lat, lng) in coords {
            let iLat = Int((lat * 1e5).rounded()), iLng = Int((lng * 1e5).rounded())
            enc(iLat - prevLat); enc(iLng - prevLng)
            prevLat = iLat; prevLng = iLng
        }
        return result
    }
}
