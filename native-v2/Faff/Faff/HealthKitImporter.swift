//
//  HealthKitImporter.swift
//  Faff
//
//  Reads completed running workouts (HKWorkout) from Apple Health and POSTs
//  them to /api/ingest/workout. Without this, runs done in the Apple Watch
//  Workouts app (not the Faff watch app) never reach the server.
//
//  Why this exists: the watch path (WatchSync → /api/watch/workouts/complete)
//  only covers Faff-watch-app runs. Any run done in Apple Watch Workouts (or
//  any third-party app that writes to HealthKit) lives only in HK on the
//  phone. The legacy iPhone app had a richer reader; this is the minimal v2
//  port focused on the one thing that matters: get the run into the DB.
//
//  Idempotency: each HKWorkout has a stable `uuid`. We use that as
//  `client_workout_id`, and the server's /api/ingest/workout dedupes on it
//  (DELETE-then-INSERT), so re-running the import is safe.
//
//  Scope: today + recent days (default 7-day window). Includes per-mile
//  splits if an HKWorkoutRoute is attached. HR avg/max + cadence + distance
//  + duration come from HKWorkout.statistics().
//

import Foundation
import HealthKit
import CoreLocation

@MainActor
final class HealthKitImporter: ObservableObject {
    static let shared = HealthKitImporter()
    private init() {}

    /// HKHealthStore is thread-safe — reads run off the main actor.
    nonisolated private let store = HKHealthStore()

    @Published var status: Status = .idle
    @Published var lastMessage: String?
    @Published var lastImportedAt: Date?

    enum Status: Equatable { case idle, requesting, importing, done, error }

    private let connectedKey = "faff.health.connected.v2"
    private var hasConnected: Bool {
        get { UserDefaults.standard.bool(forKey: connectedKey) }
        set { UserDefaults.standard.set(newValue, forKey: connectedKey) }
    }

    var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    /// HK types we read. Empty share set — Faff never writes from the phone
    /// (the watch app handles workout write-back to HK).
    ///
    /// Two groups: workout types (for HKWorkout import) and daily-vitals
    /// types (for /api/ingest/health sample push). Both prompts merge
    /// into one auth dialog since they're submitted together.
    nonisolated private static let readTypes: Set<HKObjectType> = [
        // Workout types
        HKObjectType.workoutType(),
        HKSeriesType.workoutRoute(),
        HKQuantityType(.heartRate),
        HKQuantityType(.distanceWalkingRunning),
        HKQuantityType(.runningPower),
        HKQuantityType(.runningStrideLength),
        HKQuantityType(.runningVerticalOscillation),
        HKQuantityType(.runningGroundContactTime),
        HKQuantityType(.stepCount),
        HKQuantityType(.activeEnergyBurned),
        // Daily vitals (P27.1) — readiness inputs
        HKQuantityType(.restingHeartRate),
        HKQuantityType(.heartRateVariabilitySDNN),
        HKQuantityType(.vo2Max),
        HKQuantityType(.respiratoryRate),
        HKQuantityType(.appleSleepingWristTemperature),
        HKQuantityType(.oxygenSaturation),
        HKQuantityType(.heartRateRecoveryOneMinute),
        HKQuantityType(.bodyMass),
        HKQuantityType(.bodyFatPercentage),
        HKQuantityType(.leanBodyMass),
        HKCategoryType(.sleepAnalysis),
    ]

    // MARK: - Top-level entry points

    /// First-launch path: prompt for Health auth, then import the last 7 days.
    /// Idempotent on the server, so re-running is safe.
    func requestAuthAndImport(daysBack: Int = 7) async {
        guard isAvailable else {
            status = .error
            lastMessage = "Apple Health isn't available on this device."
            return
        }
        status = .requesting
        do {
            try await store.requestAuthorization(toShare: [], read: Self.readTypes)
            hasConnected = true
        } catch {
            status = .error
            lastMessage = "Health auth failed: \(error.localizedDescription)"
            return
        }
        await importRecent(daysBack: daysBack)
    }

    /// Quiet re-sync on foreground / TodayView refresh. Only runs if the user
    /// already granted access (avoids ever prompting outside the explicit
    /// auth call). Imports today + N days back so missed sessions catch up.
    func importIfConnected(daysBack: Int = 3) async {
        guard isAvailable, hasConnected else { return }
        await importRecent(daysBack: daysBack)
    }

    // MARK: - Import flow

    private func importRecent(daysBack: Int) async {
        status = .importing

        // 1) Workouts → /api/ingest/workout
        var workoutOk = 0, workoutFail = 0
        let workouts = await fetchRunWorkouts(daysBack: daysBack)
        for w in workouts {
            do {
                let payload = await buildPayload(for: w)
                try await postWorkout(payload: payload)
                workoutOk += 1
            } catch {
                workoutFail += 1
                print("[HKImporter] workout ingest failed \(w.uuid): \(error)")
            }
        }

        // 2) Daily vitals → /api/ingest/health  (P27.1)
        // Pulls HRV / sleep / RHR / VO2 / respiration / wrist temp /
        // body mass / fat / lean mass / HR recovery / SpO2. Idempotent —
        // server dedupes on (user, type, date, recorded_at).
        var sampleOk = 0, sampleFail = 0
        let samples = await collectVitalSamples(daysBack: daysBack)
        if !samples.isEmpty {
            do {
                try await postHealthSamples(samples)
                sampleOk = samples.count
            } catch {
                sampleFail = samples.count
                print("[HKImporter] sample ingest failed: \(error)")
            }
        }

        let anyFail = workoutFail + sampleFail
        status = anyFail == 0 ? .done : .error
        lastMessage = "\(workoutOk) runs · \(sampleOk) vitals" +
            (anyFail > 0 ? " · \(anyFail) failed" : "")
        lastImportedAt = Date()
    }

    /// Query HKWorkout for runs in the last `daysBack` days.
    private nonisolated func fetchRunWorkouts(daysBack: Int) async -> [HKWorkout] {
        let start = Calendar.current.date(byAdding: .day, value: -daysBack, to: Date()) ?? Date()
        let datePred = HKQuery.predicateForSamples(withStart: start, end: Date(), options: .strictStartDate)
        let runPred = HKQuery.predicateForWorkouts(with: .running)
        let pred = NSCompoundPredicate(andPredicateWithSubpredicates: [datePred, runPred])
        return await withCheckedContinuation { (cont: CheckedContinuation<[HKWorkout], Never>) in
            let q = HKSampleQuery(
                sampleType: .workoutType(),
                predicate: pred,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
            ) { _, samples, _ in
                cont.resume(returning: (samples as? [HKWorkout]) ?? [])
            }
            store.execute(q)
        }
    }

    // MARK: - Build /api/ingest/workout payload

    /// Build the JSON body matching the route handler's expected shape.
    /// Per-mile splits attached when the workout has an HKWorkoutRoute.
    private nonisolated func buildPayload(for w: HKWorkout) async -> [String: Any] {
        let bpm = HKUnit.count().unitDivided(by: .minute())
        let meters = w.statistics(for: HKQuantityType(.distanceWalkingRunning))?
            .sumQuantity()?.doubleValue(for: .meter())
            ?? w.totalDistance?.doubleValue(for: .meter()) ?? 0
        let miles = meters / 1609.344
        let durationSec = Int(w.duration.rounded())
        let avgHr = w.statistics(for: HKQuantityType(.heartRate))?
            .averageQuantity()?.doubleValue(for: bpm)
        let maxHr = w.statistics(for: HKQuantityType(.heartRate))?
            .maximumQuantity()?.doubleValue(for: bpm)

        // Local-date helpers — UTC start converted to America/Los_Angeles for
        // the `date` + `start_local` fields the server expects.
        let pt = TimeZone(identifier: "America/Los_Angeles") ?? .current
        let isoLocal: String = {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = pt
            f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
            return f.string(from: w.startDate)
        }()
        let dateStr: String = {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = pt
            f.dateFormat = "yyyy-MM-dd"
            return f.string(from: w.startDate)
        }()
        let avgPace: String? = {
            guard miles > 0 && durationSec > 0 else { return nil }
            let secPerMi = Int(Double(durationSec) / miles)
            return "\(secPerMi / 60):\(String(format: "%02d", secPerMi % 60))"
        }()

        var payload: [String: Any] = [
            "client_workout_id": w.uuid.uuidString,
            "start_local": isoLocal,
            "date": dateStr,
            "activity_type": "running",
            "distance_mi": (miles * 100).rounded() / 100,
            "duration_sec": durationSec,
            "moving_sec": durationSec,
            "source": "apple_watch",
        ]
        if let avgPace { payload["avg_pace_min_per_mi"] = avgPace }
        if let avgHr  { payload["avg_hr_bpm"] = Int(avgHr.rounded()) }
        if let maxHr  { payload["max_hr_bpm"] = Int(maxHr.rounded()) }

        // Cadence: total steps / minutes.
        if let steps = w.statistics(for: HKQuantityType(.stepCount))?.sumQuantity()?.doubleValue(for: .count()) {
            let mins = w.duration / 60.0
            if mins > 0 { payload["avg_cadence_spm"] = Int((steps / mins).rounded()) }
        }
        // Active energy → just for context; backend doesn't store it.
        // Elev gain comes from route + locations; we'll add it in route handling.

        // Per-mile splits from HKWorkoutRoute (if present). Enriches each
        // split with HR + cadence by querying HKQuantitySamples in the
        // split's time window — the route alone has only GPS, so per-
        // split HR/cadence aren't there for free.
        if let route = await routeLocations(for: w),
           let splits = perMileSplits(locations: route) {
            var enrichedSplits: [[String: Any]] = []
            for s in splits.splits {
                var split: [String: Any] = [
                    "mile": s.mile,
                    "pace": s.pace,
                    "elev_ft": s.elevDeltaFt,
                ]
                if let hr = await avgHRInWindow(start: s.startTime, end: s.endTime) {
                    split["hr"] = Int(hr.rounded())
                }
                if let cad = await cadenceInWindow(start: s.startTime, end: s.endTime) {
                    split["cadence"] = Int(cad.rounded())
                }
                enrichedSplits.append(split)
            }
            payload["splits"] = enrichedSplits
            if splits.elevGainFt > 0 { payload["elev_gain_ft"] = splits.elevGainFt }
            if let poly = splits.polyline { payload["route_polyline"] = poly }
        }
        return payload
    }

    /// HR average across a time window — used to fill per-split HR
    /// (HKWorkout-level stats give a workout-wide average; we want
    /// per-mile granularity).
    private nonisolated func avgHRInWindow(start: Date, end: Date) async -> Double? {
        let bpm = HKUnit.count().unitDivided(by: .minute())
        return await withCheckedContinuation { (cont: CheckedContinuation<Double?, Never>) in
            let pred = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
            let q = HKStatisticsQuery(
                quantityType: HKQuantityType(.heartRate),
                quantitySamplePredicate: pred,
                options: .discreteAverage
            ) { _, stats, _ in
                cont.resume(returning: stats?.averageQuantity()?.doubleValue(for: bpm))
            }
            store.execute(q)
        }
    }

    /// Cadence (spm) across a time window — steps / minutes.
    private nonisolated func cadenceInWindow(start: Date, end: Date) async -> Double? {
        let pred = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let stepsRes: Double? = await withCheckedContinuation { (cont: CheckedContinuation<Double?, Never>) in
            let q = HKStatisticsQuery(
                quantityType: HKQuantityType(.stepCount),
                quantitySamplePredicate: pred,
                options: .cumulativeSum
            ) { _, stats, _ in
                cont.resume(returning: stats?.sumQuantity()?.doubleValue(for: .count()))
            }
            store.execute(q)
        }
        guard let steps = stepsRes else { return nil }
        let mins = end.timeIntervalSince(start) / 60.0
        guard mins > 0 else { return nil }
        return steps / mins
    }

    // MARK: - GPS / route

    /// Stream HKWorkoutRoute CLLocations for a workout (nil if no route).
    private nonisolated func routeLocations(for workout: HKWorkout) async -> [CLLocation]? {
        let routes: [HKWorkoutRoute] = await withCheckedContinuation { (cont: CheckedContinuation<[HKWorkoutRoute], Never>) in
            let q = HKSampleQuery(
                sampleType: HKSeriesType.workoutRoute(),
                predicate: HKQuery.predicateForObjects(from: workout),
                limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, samples, _ in
                cont.resume(returning: (samples as? [HKWorkoutRoute]) ?? [])
            }
            store.execute(q)
        }
        guard let route = routes.first else { return nil }
        let box = RouteBox()
        return await withCheckedContinuation { (cont: CheckedContinuation<[CLLocation]?, Never>) in
            let rq = HKWorkoutRouteQuery(route: route) { _, locations, finished, _ in
                if let locations { box.locs.append(contentsOf: locations) }
                if finished && !box.done {
                    box.done = true
                    cont.resume(returning: box.locs.isEmpty ? nil : box.locs)
                }
            }
            store.execute(rq)
        }
    }

    private struct SplitsResult {
        struct Split {
            let mile: Int
            let pace: String
            let elevDeltaFt: Int
            let startTime: Date     // for per-split HR/cadence query (P40 enrichment)
            let endTime: Date
        }
        let splits: [Split]
        let elevGainFt: Int
        let polyline: String?
    }

    /// Walk locations, accumulate per-mile splits + total elevation gain.
    /// Includes start/end timestamps per split so we can later query HR +
    /// cadence samples in that window (the route alone has only GPS).
    private nonisolated func perMileSplits(locations rawLocs: [CLLocation]) -> SplitsResult? {
        let locs = rawLocs
            .filter { $0.horizontalAccuracy >= 0 && $0.horizontalAccuracy <= 50 }
            .sorted { $0.timestamp < $1.timestamp }
        guard locs.count >= 2 else { return nil }

        let mileMeters = 1609.344
        var splits: [SplitsResult.Split] = []
        var distSoFar = 0.0
        var lastMileMark = 0.0
        var mileStartTime = locs[0].timestamp
        var mileStartElev = locs[0].altitude
        var mileNo = 1
        var elevGainM = 0.0
        var prevElev = locs[0].altitude
        for i in 1..<locs.count {
            distSoFar += locs[i].distance(from: locs[i - 1])
            let dElev = locs[i].altitude - prevElev
            if dElev > 0 { elevGainM += dElev }
            prevElev = locs[i].altitude
            while distSoFar >= lastMileMark + mileMeters {
                lastMileMark += mileMeters
                let secs = Int(locs[i].timestamp.timeIntervalSince(mileStartTime).rounded())
                if secs >= 120 && secs <= 3600 {
                    let pace = "\(secs / 60):\(String(format: "%02d", secs % 60))"
                    let elevFt = Int(((locs[i].altitude - mileStartElev) * 3.28084).rounded())
                    splits.append(.init(
                        mile: mileNo,
                        pace: pace,
                        elevDeltaFt: elevFt,
                        startTime: mileStartTime,
                        endTime: locs[i].timestamp
                    ))
                }
                mileNo += 1
                mileStartTime = locs[i].timestamp
                mileStartElev = locs[i].altitude
            }
        }

        // Downsample polyline to ~600 points for the map.
        var coords: [(Double, Double)] = []
        let step = max(1, locs.count / 600)
        var idx = 0
        while idx < locs.count {
            coords.append((locs[idx].coordinate.latitude, locs[idx].coordinate.longitude))
            idx += step
        }
        if let last = locs.last { coords.append((last.coordinate.latitude, last.coordinate.longitude)) }

        return SplitsResult(
            splits: splits,
            elevGainFt: Int((elevGainM * 3.28084).rounded()),
            polyline: encodePolyline(coords)
        )
    }

    /// Google polyline encoder (precision 5).
    private nonisolated func encodePolyline(_ coords: [(Double, Double)]) -> String {
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

    // MARK: - Daily vitals (P27.1)

    /// One sample as the /api/ingest/health endpoint expects.
    private struct VitalSample: Encodable {
        let sample_type: String
        let value: Double
        let sample_date: String     // yyyy-MM-dd in PT
        let recorded_at: String     // ISO 8601 UTC
    }

    /// Read the last `daysBack` days of every vital + body-comp metric
    /// the backend accepts. Each type uses the right aggregation (daily
    /// avg / max / sum) and gets posted as one sample per day.
    private nonisolated func collectVitalSamples(daysBack: Int) async -> [VitalSample] {
        var out: [VitalSample] = []
        let bpm = HKUnit.count().unitDivided(by: .minute())
        let ms  = HKUnit.secondUnit(with: .milli)

        // resting_hr — daily avg
        for (d, stat) in await dailyStats(HKQuantityType(.restingHeartRate), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                out.append(VitalSample(sample_type: "resting_hr", value: q.doubleValue(for: bpm).rounded(),
                                       sample_date: isoDay(d), recorded_at: isoUTC(d)))
            }
        }
        // max_hr — daily peak
        for (d, stat) in await dailyStats(HKQuantityType(.heartRate), options: .discreteMax, days: daysBack) {
            if let q = stat.maximumQuantity() {
                out.append(VitalSample(sample_type: "max_hr", value: q.doubleValue(for: bpm).rounded(),
                                       sample_date: isoDay(d), recorded_at: isoUTC(d)))
            }
        }
        // hrv (SDNN) — daily avg, ms
        for (d, stat) in await dailyStats(HKQuantityType(.heartRateVariabilitySDNN), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                out.append(VitalSample(sample_type: "hrv", value: q.doubleValue(for: ms).rounded(),
                                       sample_date: isoDay(d), recorded_at: isoUTC(d)))
            }
        }
        // vo2_max — most recent reading per day
        for (d, stat) in await dailyStats(HKQuantityType(.vo2Max), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                let unit = HKUnit(from: "ml/kg*min")
                out.append(VitalSample(sample_type: "vo2_max", value: (q.doubleValue(for: unit) * 10).rounded() / 10,
                                       sample_date: isoDay(d), recorded_at: isoUTC(d)))
            }
        }
        // respiratory_rate — daily avg
        for (d, stat) in await dailyStats(HKQuantityType(.respiratoryRate), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                out.append(VitalSample(sample_type: "respiratory_rate", value: q.doubleValue(for: bpm).rounded(),
                                       sample_date: isoDay(d), recorded_at: isoUTC(d)))
            }
        }
        // wrist_temp — overnight deviation, °C
        for (d, stat) in await dailyStats(HKQuantityType(.appleSleepingWristTemperature), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                out.append(VitalSample(sample_type: "wrist_temp", value: (q.doubleValue(for: .degreeCelsius()) * 10).rounded() / 10,
                                       sample_date: isoDay(d), recorded_at: isoUTC(d)))
            }
        }
        // spo2 — daily avg %
        for (d, stat) in await dailyStats(HKQuantityType(.oxygenSaturation), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                out.append(VitalSample(sample_type: "spo2", value: (q.doubleValue(for: .percent()) * 1000).rounded() / 10,
                                       sample_date: isoDay(d), recorded_at: isoUTC(d)))
            }
        }
        // hr_recovery (1-min) — daily avg
        for (d, stat) in await dailyStats(HKQuantityType(.heartRateRecoveryOneMinute), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                out.append(VitalSample(sample_type: "hr_recovery", value: q.doubleValue(for: bpm).rounded(),
                                       sample_date: isoDay(d), recorded_at: isoUTC(d)))
            }
        }
        // body_mass — daily latest, kg
        for (d, stat) in await dailyStats(HKQuantityType(.bodyMass), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                out.append(VitalSample(sample_type: "body_mass", value: (q.doubleValue(for: .gramUnit(with: .kilo)) * 10).rounded() / 10,
                                       sample_date: isoDay(d), recorded_at: isoUTC(d)))
            }
        }
        // body_fat_pct
        for (d, stat) in await dailyStats(HKQuantityType(.bodyFatPercentage), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                out.append(VitalSample(sample_type: "body_fat_pct", value: (q.doubleValue(for: .percent()) * 1000).rounded() / 10,
                                       sample_date: isoDay(d), recorded_at: isoUTC(d)))
            }
        }
        // lean_mass
        for (d, stat) in await dailyStats(HKQuantityType(.leanBodyMass), options: .discreteAverage, days: daysBack) {
            if let q = stat.averageQuantity() {
                out.append(VitalSample(sample_type: "lean_mass", value: (q.doubleValue(for: .gramUnit(with: .kilo)) * 10).rounded() / 10,
                                       sample_date: isoDay(d), recorded_at: isoUTC(d)))
            }
        }
        // sleep_hours — sum of asleepCore/Deep/REM across the night, in hours
        for (d, hours) in await dailySleepHours(daysBack: daysBack) {
            out.append(VitalSample(sample_type: "sleep_hours", value: (hours * 10).rounded() / 10,
                                   sample_date: isoDay(d), recorded_at: isoUTC(d)))
        }
        return out
    }

    /// HKStatisticsCollectionQuery wrapper — daily stat for one type, last N days.
    private nonisolated func dailyStats(_ type: HKQuantityType, options: HKStatisticsOptions, days: Int) async -> [(Date, HKStatistics)] {
        let anchor = Calendar.current.startOfDay(for: Date())
        let start = Calendar.current.date(byAdding: .day, value: -days, to: anchor) ?? anchor
        return await withCheckedContinuation { (cont: CheckedContinuation<[(Date, HKStatistics)], Never>) in
            let q = HKStatisticsCollectionQuery(
                quantityType: type,
                quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: Date(), options: .strictStartDate),
                options: options,
                anchorDate: anchor,
                intervalComponents: DateComponents(day: 1)
            )
            q.initialResultsHandler = { _, results, _ in
                var out: [(Date, HKStatistics)] = []
                results?.enumerateStatistics(from: start, to: Date()) { stats, _ in
                    out.append((stats.startDate, stats))
                }
                cont.resume(returning: out)
            }
            store.execute(q)
        }
    }

    /// Asleep duration per night (asleepCore + asleepDeep + asleepREM) in hours.
    private nonisolated func dailySleepHours(daysBack: Int) async -> [(Date, Double)] {
        let start = Calendar.current.date(byAdding: .day, value: -daysBack, to: Date()) ?? Date()
        let pred = HKQuery.predicateForSamples(withStart: start, end: Date(), options: .strictStartDate)
        let samples: [HKCategorySample] = await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: HKCategoryType(.sleepAnalysis), predicate: pred,
                                  limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
                cont.resume(returning: (samples as? [HKCategorySample]) ?? [])
            }
            store.execute(q)
        }
        // Group by sleep-end date (the "morning of" date).
        var byDate: [String: Double] = [:]
        let cal = Calendar.current
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "America/Los_Angeles")
        for s in samples {
            let val = s.value
            // asleepCore=3, asleepDeep=4, asleepREM=5, asleep (legacy)=1
            guard val == HKCategoryValueSleepAnalysis.asleepCore.rawValue
                || val == HKCategoryValueSleepAnalysis.asleepDeep.rawValue
                || val == HKCategoryValueSleepAnalysis.asleepREM.rawValue
                || val == HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue
            else { continue }
            let key = f.string(from: s.endDate)
            byDate[key, default: 0] += s.endDate.timeIntervalSince(s.startDate) / 3600.0
        }
        return byDate.compactMap { (k, hrs) in
            guard let d = f.date(from: k) else { return nil }
            return (cal.startOfDay(for: d), hrs)
        }
    }

    private nonisolated func isoDay(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "America/Los_Angeles")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }
    private nonisolated func isoUTC(_ d: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: d)
    }

    private func postHealthSamples(_ samples: [VitalSample]) async throws {
        let url = API.baseURL.appendingPathComponent("api/ingest/health")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "samples": try samples.map { sample throws -> [String: Any] in
                let d = try JSONEncoder().encode(sample)
                return try JSONSerialization.jsonObject(with: d) as? [String: Any] ?? [:]
            }
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let bodyStr = String(data: data, encoding: .utf8) ?? "<unreadable>"
            print("[HKImporter] POST /api/ingest/health \((resp as? HTTPURLResponse)?.statusCode ?? -1): \(bodyStr)")
            throw API.APIError.badStatus((resp as? HTTPURLResponse)?.statusCode ?? -1)
        }
    }

    // MARK: - POST workout

    private func postWorkout(payload: [String: Any]) async throws {
        let url = API.baseURL.appendingPathComponent("api/ingest/workout")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw API.APIError.badStatus(-1) }
        guard (200..<300).contains(http.statusCode) else {
            let bodyStr = String(data: data, encoding: .utf8) ?? "<unreadable>"
            print("[HKImporter] POST /api/ingest/workout \(http.statusCode): \(bodyStr)")
            throw API.APIError.badStatus(http.statusCode)
        }
    }
}

// MARK: - helpers

/// HKWorkoutRouteQuery batches CLLocations across multiple callbacks. Box
/// accumulates them; HK calls the handler serially so unchecked-Sendable is
/// safe here. `nonisolated init` lets us instantiate from non-MainActor
/// contexts (the workout-route worker is nonisolated; project default is
/// MainActor isolation).
private final class RouteBox: @unchecked Sendable {
    var locs: [CLLocation] = []
    var done = false
    nonisolated init() {}
}
