//
//  PhoneRunTracker.swift
//  Phone-only GPS run recorder (wave3b/phone-gps-recording).
//
//  Audit finding (P1, archetypes): "No-watch users have no way to record
//  an outdoor run — the primary Outdoor CTA dead-ends in a watch mirror."
//  WatchMirrorView is read-only (the watch owns the timer): a runner
//  without a paired/reachable watch had NO way to record an outdoor run
//  from the app at all. This is the recording engine for that gap.
//
//  Scope (MVP, per the brief): start/pause/resume/discard/finish, live
//  distance + elapsed time + pace, a route polyline, and a completion
//  POST reusing the SAME wire shape + endpoint the watch/treadmill use
//  (WatchCompletion → POST /api/watch/workouts/complete). Deferred:
//  live per-mile splits, elevation (no barometer read — CoreLocation
//  altitude is noisy without fusion, left null so no garbage ships),
//  live HR (no watch = no HR sensor; a future revision could read the
//  phone's own HealthKit HR samples if the runner wears a chest strap
//  that writes to HK independently).
//
//  Foreground-only GPS (task instruction): no UIBackgroundModes/location
//  entitlement exists on the iPhone target and none is added here.
//  allowsBackgroundLocationUpdates stays false — recording pauses (does
//  NOT crash or lose data) if the runner backgrounds the app; the HUD
//  documents this. iPhone-side HealthKit background delivery is a
//  DIFFERENT entitlement (workout ingestion, not live location) and
//  does not cover foreground-suspended GPS.
//
//  Battery/accuracy: kCLLocationAccuracyBestForNavigation ONLY while
//  actively recording (not paused, not idle) — stopUpdatingLocation on
//  pause/finish/discard so a forgotten-open HUD doesn't drain the phone.
//
//  Wire contract: docs/coach/WATCH_CONTRACT.md · Models/Watch.swift
//  carries the phone-side copies of WatchCompletion/WatchCompletionPhase
//  (canonical source is the watch's own WatchWorkoutModels.swift — this
//  tracker builds the SAME shape as a plain [String: Any] dict, mirroring
//  TreadmillView.buildPayload, so it doesn't have to touch that file).
//

import Foundation
import CoreLocation
import Combine

@MainActor
final class PhoneRunTracker: NSObject, ObservableObject {

    enum RunState: Equatable {
        case idle
        case running
        case paused
        case finished
    }

    // ── Published live state ──────────────────────────────────────────
    @Published private(set) var state: RunState = .idle
    /// Total elapsed seconds, EXCLUDING paused time. Advances via a 1s
    /// TimelineView tick in the view (mirrors TreadmillView's pattern) —
    /// this class just exposes the accumulated value + start/pause anchors
    /// so the view's timer can compute a live "now" without polling us.
    @Published private(set) var elapsedSec: Int = 0
    /// Cumulative GPS distance in miles · CLLocation.distance(from:) summed
    /// between consecutive accepted fixes (Haversine-equivalent geodesic;
    /// CoreLocation computes this internally, no need to hand-roll it).
    @Published private(set) var distanceMi: Double = 0
    /// Live instantaneous pace in seconds/mile · a trailing-window average
    /// (last ~30s of accepted fixes) so it doesn't jitter fix-to-fix. nil
    /// before GPS has locked or while stationary long enough that the
    /// window has no meaningful distance.
    @Published private(set) var currentPaceSecPerMi: Int?
    /// Route so far, for the live map. Append-only while running; a pause
    /// leaves it untouched (no location updates land while paused).
    @Published private(set) var routeCoords: [CLLocationCoordinate2D] = []
    /// True once the OS has granted when-in-use (or always) authorization.
    /// The view uses this to decide whether to show the permission-denied
    /// empty state instead of the recording HUD.
    @Published private(set) var authorizationGranted: Bool = false
    @Published private(set) var authorizationDenied: Bool = false
    /// Surfaced once, non-blocking — GPS signal loss doesn't stop the
    /// clock (dead reckoning would be worse than an honest gap), it just
    /// tells the runner why distance may undercount for a stretch.
    @Published private(set) var lastFixAgeIsStale: Bool = false

    /// Set once at first Start, reused across pause/resume so the workoutId
    /// and startedAt stay stable across the whole session (mirrors
    /// TreadmillView's `workoutId`/`startedAt` pattern exactly).
    private(set) var workoutId: String?
    private(set) var startedAt: Date?

    // ── Internals ────────────────────────────────────────────────────
    private let manager = CLLocationManager()
    /// Raw accepted fixes (post-filter) with their timestamps · used both
    /// to build the route polyline and to compute the trailing-pace window.
    /// Kept separate from `routeCoords` (published, coordinate-only) so the
    /// pace window can read timestamps without re-deriving them.
    private var fixes: [(loc: CLLocation, at: Date)] = []
    /// Sum of paused-interval durations, subtracted from wall-clock elapsed
    /// so a pause never counts toward elapsedSec or the finish payload.
    private var pausedIntervals: [(start: Date, end: Date?)] = []
    /// Distance accumulator advances immediately on each accepted fix
    /// (not deferred to a tick), so `distanceMi` is always exact at any
    /// instant, not just at 1s boundaries.
    private var lastAcceptedFix: CLLocation?

    override init() {
        super.init()
        manager.delegate = self
        // Foreground-only. No allowsBackgroundLocationUpdates, no
        // UIBackgroundModes entry — see file header. showsBackgroundLocation
        // Indicator only applies when background updates are on, left at
        // its default (false) here for clarity.
        manager.allowsBackgroundLocationUpdates = false
        manager.pausesLocationUpdatesAutomatically = false
        manager.activityType = .fitness
        authorizationGranted = [.authorizedWhenInUse, .authorizedAlways].contains(manager.authorizationStatus)
        authorizationDenied = [.denied, .restricted].contains(manager.authorizationStatus)
    }

    // MARK: - Permission

    func requestPermission() {
        let status = manager.authorizationStatus
        if status == .notDetermined {
            manager.requestWhenInUseAuthorization()
        } else {
            authorizationGranted = [.authorizedWhenInUse, .authorizedAlways].contains(status)
            authorizationDenied = [.denied, .restricted].contains(status)
        }
    }

    // MARK: - Controls

    /// Start (first play) or resume (after pause). Idempotent against a
    /// double-tap: no-ops if already running.
    func start() {
        guard state != .running else { return }
        guard authorizationGranted else { requestPermission(); return }

        if workoutId == nil {
            // First start of this session.
            workoutId = "phone_\(UUID().uuidString)"
            startedAt = .now
        } else if state == .paused {
            // Resume · close out the open pause interval.
            if let last = pausedIntervals.indices.last, pausedIntervals[last].end == nil {
                pausedIntervals[last].end = .now
            }
        }
        state = .running
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = 5 // meters · trims noisy sub-5m jitter fixes
        manager.startUpdatingLocation()
    }

    func pause() {
        guard state == .running else { return }
        // Freeze elapsedSec at the exact pause instant (same reasoning as
        // finish()'s catch-up tick) before flipping state — tick() no-ops
        // once state != .running, so this is the last chance to advance it.
        tick(at: .now)
        state = .paused
        pausedIntervals.append((start: .now, end: nil))
        manager.stopUpdatingLocation()
    }

    /// Ends the session WITHOUT saving · stops GPS immediately. The view
    /// is responsible for confirming with the runner before calling this
    /// (accidental-tap protection lives in PhoneRunView, not here, so the
    /// tracker stays a pure state machine testable without UI).
    func discard() {
        manager.stopUpdatingLocation()
        state = .idle
        elapsedSec = 0
        distanceMi = 0
        currentPaceSecPerMi = nil
        routeCoords = []
        fixes = []
        pausedIntervals = []
        lastAcceptedFix = nil
        workoutId = nil
        startedAt = nil
    }

    /// Stops GPS and freezes state for the summary/save flow. Does NOT
    /// reset — the caller reads distanceMi/elapsedSec/routeCoords for the
    /// summary screen, then calls `buildCompletionPayload` to save.
    func finish() {
        guard state == .running || state == .paused else { return }
        // Finishing while still `.running` (the common path — "Finish" from
        // the live HUD) needs one last elapsedSec advance to the instant of
        // finishing; the view's periodic tick() only runs on ~1s boundaries,
        // so up to ~1s would otherwise be dropped from the saved duration.
        // Finishing while `.paused` needs no such catch-up: the pause() call
        // already froze elapsedSec via the tick right before it, and no
        // further wall-clock time should accrue while paused.
        if state == .running {
            tick(at: .now)
        }
        manager.stopUpdatingLocation()
        state = .finished
    }

    /// Advance the published elapsed-seconds clock. Called by the view's
    /// 1s TimelineView tick (mirrors TreadmillView.tick) rather than an
    /// internal Timer, so SwiftUI's own render loop drives the cadence and
    /// there's no competing timer to leak/invalidate.
    func tick(at now: Date) {
        guard state == .running, let started = startedAt else { return }
        let pausedSoFar = pausedIntervals.reduce(0.0) { sum, interval in
            let end = interval.end ?? now // an open interval can't occur while running, but be defensive
            return sum + end.timeIntervalSince(interval.start)
        }
        let raw = now.timeIntervalSince(started) - pausedSoFar
        elapsedSec = max(0, Int(raw.rounded()))
        // GPS-stale flag · no accepted fix in the last 20s while actively
        // recording. Purely informational (clock keeps running · distance
        // just won't advance until signal returns).
        if let lastAt = fixes.last?.at {
            lastFixAgeIsStale = now.timeIntervalSince(lastAt) > 20
        }
    }

    // MARK: - Completion payload

    /// WatchCompletion-shaped dict, matching TreadmillView.buildPayload's
    /// approach exactly (POST /api/watch/workouts/complete expects this
    /// shape · see WatchCompletionBody in
    /// web-v2/app/api/watch/workouts/complete/route.ts). A single `.work`
    /// phase spans the whole run — mirrors WatchWorkout.makeJustRun()'s
    /// "Just run" shape, since the phone recorder has no structured plan
    /// to subdivide into. `source: "phone"` is a new, additive value in
    /// the backend's source whitelist (falls back to 'watch' if the
    /// backend hasn't been updated — see that route's ALLOWED_SOURCES
    /// comment — so this never regresses to a hard failure even against
    /// an unpatched backend).
    func buildCompletionPayload(status: String) -> [String: Any] {
        // ISO8601DateFormatter defaults to a Z-suffixed UTC string (same
        // choice TreadmillView.buildPayload makes). This matters: the
        // backend's toUtcIso() trusts any string carrying an explicit Z/
        // offset marker and normalizes it directly, WITHOUT consulting
        // `source` at all — so a new source value here never needs to be
        // taught to lib/runs/normalize-time.ts's source-local/source-utc
        // whitelist. Sending a bare local-time string (no Z) would have
        // required that backend change; this sidesteps it entirely.
        let iso = ISO8601DateFormatter()
        let started = startedAt ?? Date(timeIntervalSinceNow: -Double(elapsedSec))
        let finishedAt = Date.now
        let roundedDistanceMi = (distanceMi * 100).rounded() / 100
        let paceSec = elapsedSec > 0 && distanceMi > 0.05
            ? Int((Double(elapsedSec) / distanceMi).rounded())
            : nil

        var phase: [String: Any] = [
            "index": 0,
            "type": "work",
            "label": "Run",
            "completed": true,
            "actualDurationSec": elapsedSec,
            "actualDistanceMi": roundedDistanceMi,
        ]
        if let paceSec { phase["actualPaceSPerMi"] = paceSec }

        var payload: [String: Any] = [
            "workoutId": workoutId ?? "phone_\(UUID().uuidString)",
            "startedAt": iso.string(from: started),
            "completedAt": iso.string(from: finishedAt),
            "status": status, // "completed" | "partial" | "abandoned"
            "totalDistanceMi": roundedDistanceMi,
            "totalDurationSec": elapsedSec,
            // New additive source value — see doc-comment above.
            "source": "phone",
            "indoor": false,
            "phases": [phase],
        ]
        if let polyline = encodedPolyline() {
            payload["routePolyline"] = polyline
        }
        // avgHr / maxHr / kcal intentionally omitted (nil) · no watch =
        // no HR sensor on this recording path. Backend's resolveCalories
        // tier-3 estimator + null-HR handling already cover watch-less
        // runs from other ingest paths (manual entry), so this is a known-
        // good gap, not a new failure mode.
        return payload
    }

    /// Google polyline (precision 5) encoding of routeCoords, full
    /// resolution — same algorithm as HealthKitImporter's private
    /// encodePolyline (duplicated here rather than shared/exposed across
    /// files for one ~15-line self-contained algorithm; see file header).
    /// No downsampling: a single run's point count is small enough that
    /// HealthKitImporter's ~600-point downsample (built for multi-workout
    /// backfill imports) isn't needed here. nil when fewer than 2 points
    /// (nothing to draw).
    private func encodedPolyline() -> String? {
        guard routeCoords.count >= 2 else { return nil }
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
        for c in routeCoords {
            let iLat = Int((c.latitude * 1e5).rounded()), iLng = Int((c.longitude * 1e5).rounded())
            enc(iLat - prevLat); enc(iLng - prevLng)
            prevLat = iLat; prevLng = iLng
        }
        return result
    }
}

// MARK: - CLLocationManagerDelegate

extension PhoneRunTracker: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.authorizationGranted = [.authorizedWhenInUse, .authorizedAlways].contains(status)
            self.authorizationDenied = [.denied, .restricted].contains(status)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let newest = locations.last else { return }
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.accept(newest)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Best-effort: a transient GPS error (e.g. kCLErrorLocationUnknown)
        // is common indoors/under-tree-cover and self-heals on the next fix.
        // No user-facing surfacing here — lastFixAgeIsStale (tick-driven)
        // already covers "GPS has been quiet for a while."
        print("[PhoneRunTracker] location error: \(error.localizedDescription)")
    }

    /// Accept/reject a raw fix and, if accepted, advance distance + route +
    /// pace. Runs on the MainActor (published-property writes require it).
    private func accept(_ loc: CLLocation) {
        guard state == .running else { return }
        // Reject fixes with poor horizontal accuracy (> 50m) or that are
        // significantly stale (cached fix replayed from the location
        // subsystem) — same class of filter CoreLocation-based trackers
        // conventionally apply so a single bad GPS bounce doesn't inject a
        // multi-hundred-meter distance spike.
        guard loc.horizontalAccuracy >= 0, loc.horizontalAccuracy <= 50 else { return }
        guard abs(loc.timestamp.timeIntervalSinceNow) < 15 else { return }

        if let last = lastAcceptedFix {
            let delta = loc.distance(from: last) // meters, geodesic
            // Drop sub-2m deltas (GPS jitter while stationary at a light).
            if delta >= 2 {
                distanceMi += delta / 1609.344
            }
        }
        lastAcceptedFix = loc
        fixes.append((loc: loc, at: .now))
        // Bound memory on very long runs (ultras) · keep the last ~2h of
        // fixes for the pace window, which only looks back 30s anyway.
        if fixes.count > 7200 { fixes.removeFirst(fixes.count - 7200) }
        routeCoords.append(loc.coordinate)
        lastFixAgeIsStale = false

        updateCurrentPace()
    }

    /// Trailing-window pace: distance and time covered by fixes within the
    /// last 30s, converted to sec/mi. nil when the window has moved < 0.02
    /// mi (below GPS noise floor at typical running speed over 30s) so the
    /// HUD doesn't flash a wild "0:14/mi" from two adjacent jittery fixes.
    private func updateCurrentPace() {
        let now = Date.now
        let windowFixes = fixes.filter { now.timeIntervalSince($0.at) <= 30 }
        guard windowFixes.count >= 2,
              let first = windowFixes.first, let last = windowFixes.last else {
            currentPaceSecPerMi = nil
            return
        }
        var windowDistMi = 0.0
        for i in 1..<windowFixes.count {
            windowDistMi += windowFixes[i].loc.distance(from: windowFixes[i - 1].loc) / 1609.344
        }
        let windowSec = last.at.timeIntervalSince(first.at)
        guard windowDistMi > 0.02, windowSec > 0 else {
            currentPaceSecPerMi = nil
            return
        }
        currentPaceSecPerMi = Int((windowSec / windowDistMi).rounded())
    }
}
