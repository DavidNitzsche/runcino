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

        // 3) Strength sessions → /api/strength (2026-06-01)
        // HK workouts of strength / functional / core / cross / yoga /
        // pilates / mobility / mixed-cardio activity types over a 28-day
        // window. Idempotent on HKWorkout.uuid via the unique partial
        // index. Sweeps deletions against a UserDefaults uuid-cache so
        // workouts the runner removes from Apple Fitness eventually
        // clear from strength_sessions too (brief:
        // strength-hk-delete-backend-brief.md).
        let strengthResult = await syncStrengthFromHK()

        let anyFail = workoutFail + sampleFail + strengthResult.failed
        status = anyFail == 0 ? .done : .error
        var summary = "\(workoutOk) runs · \(sampleOk) vitals"
        if strengthResult.posted > 0 || strengthResult.deleted > 0 {
            summary += " · \(strengthResult.posted)↑/\(strengthResult.deleted)↓ strength"
        }
        if anyFail > 0 { summary += " · \(anyFail) failed" }
        lastMessage = summary
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

        // #180 — running form metrics from HealthKit. When a Faff watch
        // session glitches and only the HKWorkout shell exists, these
        // averages still ship so the coach reads non-null avgPowerW +
        // avgVertOscCm via getRuns — no manual patch needed.
        //
        // HKWorkout.statistics() with .discreteAverage gives the workout-
        // wide mean, computed over the per-sample series HealthKit
        // collected during the run. Units pulled straight from HKUnit;
        // server expects floats.
        let wattsUnit = HKUnit.watt()
        let cmUnit    = HKUnit.meterUnit(with: .centi)
        let mUnit     = HKUnit.meter()
        let msUnit    = HKUnit.secondUnit(with: .milli)
        if let pw = await statAvg(workout: w, type: HKQuantityType(.runningPower), unit: wattsUnit) {
            payload["avg_power_w"] = (pw * 10).rounded() / 10
        }
        if let vo = await statAvg(workout: w, type: HKQuantityType(.runningVerticalOscillation), unit: cmUnit) {
            payload["avg_vert_osc_cm"] = (vo * 10).rounded() / 10
        }
        if let sl = await statAvg(workout: w, type: HKQuantityType(.runningStrideLength), unit: mUnit) {
            payload["avg_stride_length_m"] = (sl * 100).rounded() / 100
        }
        if let gct = await statAvg(workout: w, type: HKQuantityType(.runningGroundContactTime), unit: msUnit) {
            payload["avg_gct_ms"] = Int(gct.rounded())
        }

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

    /// Average of any quantity type across a whole HKWorkout.
    /// #180 — used to pull running power, vertical oscillation, stride
    /// length, ground contact time. Falls through to nil when HealthKit
    /// hasn't collected the metric (older watch, third-party recorder).
    private nonisolated func statAvg(workout: HKWorkout, type: HKQuantityType, unit: HKUnit) async -> Double? {
        // Some metrics aren't in HKWorkout.statistics() — query the raw
        // samples filtered to the workout's time window. Same predicate
        // shape HealthKit recommends for cross-referencing.
        let pred = HKQuery.predicateForSamples(
            withStart: workout.startDate,
            end: workout.endDate,
            options: .strictStartDate
        )
        return await withCheckedContinuation { (cont: CheckedContinuation<Double?, Never>) in
            let q = HKStatisticsQuery(
                quantityType: type,
                quantitySamplePredicate: pred,
                options: .discreteAverage
            ) { _, stats, _ in
                cont.resume(returning: stats?.averageQuantity()?.doubleValue(for: unit))
            }
            store.execute(q)
        }
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
        for i in 1..<locs.count {
            distSoFar += locs[i].distance(from: locs[i - 1])
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

        // 2026-05-31 · derive elevGainFt from the per-mile split deltas,
        // NOT by summing every sample-to-sample altitude tick. The old
        // approach (`if dElev > 0 { elevGainM += dElev }` over every GPS
        // point) compounded ±2m altitude jitter across 5000+ samples
        // into thousands of fictional feet — David's 12.36mi suburban
        // long run came back at 4684 ft (379 ft/mi) when the per-mile
        // splits sum to 587 ft (a believable 48 ft/mi). Summing per-mile
        // deltas takes mile_end_altitude − mile_start_altitude, which
        // naturally smooths sample noise: across a mile (~5 minutes,
        // hundreds of samples) the noise averages out.
        let elevGainFtFromSplits = splits.reduce(0) { acc, s in
            acc + max(0, s.elevDeltaFt)
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
            elevGainFt: elevGainFtFromSplits,
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
        // active_energy — TIME-SERIES, not a daily scalar. HK ships ~15-second
        // buckets during workouts and sparser passive samples between. The
        // backend's resolveCalories tier 2 sums these in the run's time window
        // when the watch payload's `kcal` field is absent · the iPhone needs
        // to upload buckets, not daily totals, for that path to work.
        // Brief: designs/briefs/iphone-calories-and-absorption-brief.md
        // (2026-06-01). Use HKSampleQuery (discrete samples) instead of
        // HKStatisticsCollectionQuery (which would sum to a daily scalar).
        for sample in await activeEnergySamples(daysBack: daysBack) {
            out.append(sample)
        }
        return out
    }

    /// Per-bucket active-energy samples from HK · maps each HKQuantitySample
    /// to a VitalSample row. Bucket start = sample.startDate.
    /// recorded_at carries millisecond precision so the server's dedupe
    /// key `(user, type, date, recorded_at)` can distinguish ~15-second
    /// buckets that fall in the same calendar second.
    private nonisolated func activeEnergySamples(daysBack: Int) async -> [VitalSample] {
        let kcal = HKUnit.kilocalorie()
        let start = Calendar.current.date(byAdding: .day, value: -daysBack, to: Date()) ?? Date()
        let pred = HKQuery.predicateForSamples(withStart: start, end: Date(), options: .strictStartDate)
        let samples: [HKQuantitySample] = await withCheckedContinuation { (cont: CheckedContinuation<[HKQuantitySample], Never>) in
            let q = HKSampleQuery(
                sampleType: HKQuantityType(.activeEnergyBurned),
                predicate: pred,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, samples, _ in
                cont.resume(returning: (samples as? [HKQuantitySample]) ?? [])
            }
            store.execute(q)
        }
        // Drop sub-bucket zeros (HK emits placeholders during idle). The
        // server's per-run sum is robust to missing slices but useless
        // rows still bloat the payload.
        return samples.compactMap { s in
            let v = s.quantity.doubleValue(for: kcal)
            guard v > 0.05 else { return nil }
            return VitalSample(
                sample_type: "active_energy",
                value: (v * 100).rounded() / 100,
                sample_date: isoDay(s.startDate),
                recorded_at: isoUTCMillis(s.startDate)
            )
        }
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

    /// Millisecond-precision UTC ISO · used by per-bucket active_energy
    /// samples so two buckets that share a calendar second (rare but it
    /// happens) don't dedupe on the server's `(user,type,date,recorded_at)`
    /// key. ISO8601DateFormatter doesn't emit sub-second by default; the
    /// `.withFractionalSeconds` option turns it on (".SSS" suffix).
    private nonisolated func isoUTCMillis(_ d: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
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
        // Was using a raw URLSession.shared.data(for:) — no Authorization
        // header, no 401 → SignIn bounce. After the 2026-05-30 audit
        // hardened /api/ingest/health to require Bearer, every HK push was
        // silently 401'ing and the runner's sleep/HRV/RHR never reached
        // the server. Route through authedSend so the same Bearer +
        // .faffSessionExpired contract that surface reads use applies here.
        let (data, http) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else {
            let bodyStr = String(data: data, encoding: .utf8) ?? "<unreadable>"
            print("[HKImporter] POST /api/ingest/health \(http.statusCode): \(bodyStr)")
            throw API.APIError.badStatus(http.statusCode)
        }
    }

    // MARK: - HK strength ingest (2026-06-01)
    //
    // Brief: designs/briefs/strength-hk-ingest-brief.md
    //
    // Pattern matches the run importer: query HKWorkout for the 8 allowed
    // activity types over a 28-day window, map to the strength session
    // type the backend expects, POST one per workout. Server is idempotent
    // on HKWorkout.uuid via the unique partial index from migration 133.
    //
    // Delete diffing: each successful POST is added to a UserDefaults
    // uuid-cache. On every sync, any cached uuid that's no longer present
    // in HK is DELETE'd via the hk_uuid query-param route. The DELETE
    // endpoint is owned by the backend agent (brief:
    // strength-hk-delete-backend-brief.md); when it lands, no iPhone
    // change is needed — re-syncs will simply succeed instead of swallow-
    // erroring.

    /// HKWorkoutActivityType raw values for the 8 strength-flavored types
    /// we ingest. Cited inline because Swift's enum cases vary by SDK and
    /// the raw values are the stable identifier across versions.
    /// (`.mixedCardio` added on iPhone agent's read · catches "strength
    /// + cardio circuit" sessions the watch labels as mixed.)
    nonisolated private static let strengthActivityRaws: [UInt: String] = [
        HKWorkoutActivityType.traditionalStrengthTraining.rawValue: "strength",
        HKWorkoutActivityType.functionalStrengthTraining.rawValue:  "functional_strength",
        HKWorkoutActivityType.coreTraining.rawValue:                "core",
        HKWorkoutActivityType.crossTraining.rawValue:               "cross_training",
        HKWorkoutActivityType.yoga.rawValue:                        "yoga",
        HKWorkoutActivityType.pilates.rawValue:                     "pilates",
        HKWorkoutActivityType.flexibility.rawValue:                 "mobility",
        HKWorkoutActivityType.mixedCardio.rawValue:                 "cross_training",
    ]

    /// UserDefaults key holding the set of HKWorkout.uuid strings we've
    /// successfully POSTed in the most recent 28-day window. Compared
    /// against the fresh HK set each sync to detect deletions.
    private let strengthUUIDCacheKey = "faff.health.strength.uuids.v1"

    /// Per-sync rollup returned to the parent importRecent so it can
    /// shape the user-facing status string.
    private struct StrengthSyncResult {
        var posted: Int = 0
        var deleted: Int = 0
        var failed: Int = 0
    }

    private func syncStrengthFromHK() async -> StrengthSyncResult {
        var result = StrengthSyncResult()
        let workouts = await fetchStrengthWorkouts(daysBack: 28)

        var freshUUIDs = Set<String>()
        for w in workouts {
            let uuid = w.uuid.uuidString
            freshUUIDs.insert(uuid)
            guard let payload = buildStrengthPayload(for: w) else { continue }
            do {
                try await API.postStrengthFromHK(
                    date: payload.date,
                    sessionType: payload.session_type,
                    durationMin: payload.duration_min,
                    hkUUID: payload.hk_uuid
                )
                result.posted += 1
            } catch {
                result.failed += 1
                print("[HKImporter] strength ingest failed \(uuid): \(error)")
            }
        }

        // Delete diffing · cached uuids no longer in HK → DELETE.
        let cached = Set(UserDefaults.standard.stringArray(forKey: strengthUUIDCacheKey) ?? [])
        let toDelete = cached.subtracting(freshUUIDs)
        var stillStale: [String] = []
        for uuid in toDelete {
            do {
                let ok = try await API.deleteStrengthByHKUUID(uuid)
                if ok {
                    result.deleted += 1
                } else {
                    // Non-2xx · keep in cache so next sync retries. This
                    // covers the window where the DELETE endpoint isn't
                    // shipped yet (returns 404/405) and the case where
                    // a transient 5xx happens. Either way, no data loss.
                    stillStale.append(uuid)
                }
            } catch {
                stillStale.append(uuid)
                print("[HKImporter] strength delete failed \(uuid): \(error)")
            }
        }

        // Update the cache: fresh uuids that POSTed cleanly + any deletes
        // that didn't go through yet (so we retry next sync).
        let nextCache = freshUUIDs.union(stillStale)
        UserDefaults.standard.set(Array(nextCache), forKey: strengthUUIDCacheKey)

        return result
    }

    /// Query HKWorkout for the 8 strength-flavored activity types in the
    /// last `daysBack` days. Loops the activityType predicate per type
    /// (HealthKit doesn't accept an OR of activityType predicates in a
    /// single query the way it does for sample types).
    private nonisolated func fetchStrengthWorkouts(daysBack: Int) async -> [HKWorkout] {
        let start = Calendar.current.date(byAdding: .day, value: -daysBack, to: Date()) ?? Date()
        let datePred = HKQuery.predicateForSamples(withStart: start, end: Date(), options: .strictStartDate)
        var collected: [HKWorkout] = []
        for raw in Self.strengthActivityRaws.keys {
            guard let activity = HKWorkoutActivityType(rawValue: raw) else { continue }
            let activityPred = HKQuery.predicateForWorkouts(with: activity)
            let pred = NSCompoundPredicate(andPredicateWithSubpredicates: [datePred, activityPred])
            let batch: [HKWorkout] = await withCheckedContinuation { (cont: CheckedContinuation<[HKWorkout], Never>) in
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
            collected.append(contentsOf: batch)
        }
        return collected
    }

    /// /api/strength HK-path payload. Plain struct so we can inspect it
    /// before POSTing.
    private struct HKStrengthPayload {
        let date: String          // yyyy-MM-dd (PT)
        let session_type: String  // strength | functional_strength | core | cross_training | yoga | pilates | mobility
        let duration_min: Int     // HKWorkout.duration ÷ 60, rounded
        let hk_uuid: String       // HKWorkout.uuid.uuidString
    }

    /// Map one HKWorkout into the strength payload. Returns nil if the
    /// activity type isn't in our allowed set (defensive · the query
    /// already filters, but a future SDK adding new mapping cases
    /// shouldn't fall through to a 400 from the backend).
    private nonisolated func buildStrengthPayload(for w: HKWorkout) -> HKStrengthPayload? {
        guard let sessionType = Self.strengthActivityRaws[w.workoutActivityType.rawValue] else {
            return nil
        }
        let pt = TimeZone(identifier: "America/Los_Angeles") ?? .current
        let dateStr: String = {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = pt
            f.dateFormat = "yyyy-MM-dd"
            return f.string(from: w.startDate)
        }()
        let minutes = Int((w.duration / 60.0).rounded())
        return HKStrengthPayload(
            date: dateStr,
            session_type: sessionType,
            duration_min: max(0, minutes),
            hk_uuid: w.uuid.uuidString
        )
    }

    // MARK: - POST workout

    private func postWorkout(payload: [String: Any]) async throws {
        let url = API.baseURL.appendingPathComponent("api/ingest/workout")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        // Same audit gap as postHealthSamples — was bypassing authedSend, so
        // every HK-imported workout silently 401'd post-audit. Runs from
        // Apple Watch that aren't on Strava (treadmill, indoor) never
        // landed in workout_completions. Route through authedSend.
        let (data, http) = try await API.authedSend(req)
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
