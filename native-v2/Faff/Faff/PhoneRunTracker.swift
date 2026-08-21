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
//  Scope: start/pause/resume/discard/finish, live distance + elapsed time
//  + pace, a route polyline, and a completion POST reusing the SAME wire
//  shape + endpoint the watch/treadmill use (WatchCompletion → POST
//  /api/watch/workouts/complete). Deferred: live per-mile splits,
//  elevation (no barometer read — CoreLocation altitude is noisy without
//  fusion, left null so no garbage ships).
//
//  ─────────────────────────────────────────────────────────────────────
//  2026-08-21 · OUTDOOR PATH AUDIT · four things this file used to get
//  wrong, none of which can be seen anywhere except on a real run.
//
//  1 · RECORDING NOW SURVIVES A LOCKED SCREEN.
//      This file used to say "foreground-only … recording pauses (does
//      NOT crash or lose data) if the runner backgrounds the app". That
//      is not what happened. `state` stayed `.running`, so `startedAt`
//      kept accruing wall-clock into `elapsedSec`, while CoreLocation
//      delivered nothing — and on return the FIRST fix was differenced
//      against the pre-suspend fix, so the whole gap landed as one
//      straight-line jump. A 2 mi out-and-back with the screen locked
//      credited ~16 minutes and ~0.00 mi. There is no reading of that
//      which is "does not lose data".
//      The fix is the real one: `UIBackgroundModes: [location]` on the
//      iPhone target (native-v2/project.yml — xcodegen regenerates
//      Info.plist from there, so it MUST live in the yml) plus
//      `allowsBackgroundLocationUpdates`. When-in-use authorization is
//      enough for this; no "Always" string is added.
//      `backgroundLocationDeclared` re-reads the built plist at runtime,
//      so if a future xcodegen regen drops the key again the app degrades
//      to foreground-only instead of throwing the exception UIKit raises
//      when you set `allowsBackgroundLocationUpdates` without it.
//
//  2 · A GAP IN THE TRACK IS NEVER CREDITED AS A STRAIGHT LINE.
//      Belt to (1)'s braces, and the same guard covers a tunnel, a
//      permission toggle mid-run, and pause-drive-resume. See `accept`.
//
//  3 · FIXES ARE FILTERED HERE, NOT BY `distanceFilter`.
//      The old shape asked CoreLocation for a fix only every 5 m and then
//      "dropped sub-2m deltas" — a test that could not fire, since nothing
//      under 5 m was ever delivered. Meanwhile a stationary phone under
//      tree cover bounces further than 5 m routinely, so a runner standing
//      at a light accrued distance. Now: fixes arrive at the receiver's own
//      cadence (~1 Hz — the GPS chip is already on at this accuracy, so
//      this is not a battery change) and this file decides what counts,
//      using horizontal accuracy, implied speed, and CoreLocation's own
//      Doppler speed, which is a far better stationary test than
//      differencing two noisy positions.
//
//  4 · A RUN THE APP DIES IN THE MIDDLE OF IS NO LONGER GONE.
//      Nothing was persisted until End. A jetsam kill on a long run took
//      the whole run with it, silently. There is now a checkpoint on disk,
//      rewritten every ~10 s of recording, and `flushInterruptedRun`
//      re-submits it through the same durable queue. Safe to double-fire:
//      the endpoint derives its row id from `workoutId` and upserts (see
//      route.ts, "same workoutId → same id, so re-POSTing overwrites").
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

// MARK: - Checkpoint
//
// Small enough to rewrite every ten seconds, complete enough to save the
// run from it. The route rides as an already-encoded polyline rather than
// a coordinate array: it is the shape the payload wants anyway, and it is
// roughly a quarter of the JSON.

struct PhoneRunCheckpoint: Codable {
    let workoutId: String
    let startedAt: Date
    let updatedAt: Date
    let elapsedSec: Int
    let distanceMi: Double
    let polyline: String?
    let hadGap: Bool
}

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
    /// Total elapsed seconds, EXCLUDING paused time. Advanced once a second
    /// by this class's OWN clock — see `startClock` for why the view no
    /// longer drives it. Derived from the start/pause anchors on every tick
    /// rather than incremented, so a tick that is late or missed entirely
    /// self-corrects on the next one instead of losing that time for good.
    @Published private(set) var elapsedSec: Int = 0
    /// Cumulative GPS distance in miles · integrated fix-to-fix across the
    /// whole run. Never recomputed from an average, and never re-derived
    /// from duration × a pace.
    @Published private(set) var distanceMi: Double = 0
    /// Live pace in seconds/mile · differenced from the SAME accumulator
    /// `distanceMi` is built from, over a trailing ~30s window, so the
    /// number on the console and the number in the payload can never
    /// disagree about what was measured. nil before GPS has locked, and
    /// nil while the window says the runner is not running.
    @Published private(set) var currentPaceSecPerMi: Int?
    /// Route so far, for the live map. Append-only while running; a pause
    /// leaves it untouched (no location updates land while paused).
    @Published private(set) var routeCoords: [CLLocationCoordinate2D] = []
    /// True once the OS has granted when-in-use (or always) authorization.
    @Published private(set) var authorizationGranted: Bool = false
    @Published private(set) var authorizationDenied: Bool = false
    /// Surfaced once, non-blocking — GPS signal loss doesn't stop the
    /// clock (dead reckoning would be worse than an honest gap), it just
    /// tells the runner why distance may undercount for a stretch.
    @Published private(set) var lastFixAgeIsStale: Bool = false
    /// False until a fix good enough to anchor a track has landed. Until
    /// then distance is not zero, it is UNREAD — a console that prints
    /// "0.00" during the first-fix wait is showing a measurement it does
    /// not have, and a runner who sets off before the lock lands will
    /// believe the tracker is broken.
    @Published private(set) var hasFirstFix: Bool = false
    /// True once at least one stretch of this run could not be measured —
    /// signal loss, or the app being killed and relaunched mid-run. The
    /// distance stays honest (nothing is invented across the gap) and is
    /// therefore SHORT, which is the part the runner has to be told.
    @Published private(set) var trackHasGap: Bool = false
    /// Whether this build can keep recording with the screen locked. False
    /// only if the background-modes key went missing from the built plist.
    @Published private(set) var backgroundRecordingEnabled: Bool = false

    /// Set once at first Start, reused across pause/resume so the workoutId
    /// and startedAt stay stable across the whole session (mirrors
    /// TreadmillView's `workoutId`/`startedAt` pattern exactly).
    private(set) var workoutId: String?
    private(set) var startedAt: Date?

    // ── Fix-acceptance constants ──────────────────────────────────────
    //
    // None of these is a doctrine constant; they are sensor-handling
    // thresholds, and every one is set by what a GPS receiver in a phone
    // actually does rather than by anything in Research/.

    private enum GPS {
        /// The fix that ANCHORS the track has to be a good one — a coarse
        /// first fix places the start hundreds of metres out, and the next
        /// good fix then credits that error as distance run.
        static let firstFixAccuracyM: CLLocationAccuracy = 20
        static let accuracyM: CLLocationAccuracy = 25
        /// Rejects a cached fix replayed by the location subsystem.
        static let freshnessSec: TimeInterval = 10
        /// Below this, a delta is receiver noise, not movement.
        static let minCreditM: CLLocationDistance = 1.0
        /// ~3:00/mi. Nothing above this is a person; it is a bounce.
        static let maxCreditSpeedMps: CLLocationSpeed = 9.0
        /// The longest silence still treated as "we were probably moving in
        /// roughly a straight line through it" — a tunnel, an underpass.
        static let bridgeableGapSec: TimeInterval = 90
        /// ~4:28/mi. Faster than this AVERAGED over a multi-second gap
        /// means the gap was not run, it was travelled some other way.
        static let bridgeSpeedMps: CLLocationSpeed = 6.0
        /// CoreLocation's Doppler speed, which is independent of the
        /// position noise that makes a stationary phone look like it moved.
        static let stationaryMps: CLLocationSpeed = 0.4
        static let staleNoticeSec: TimeInterval = 20
        static let paceWindowSec: TimeInterval = 30
        /// A route point every ~3 m — the receiver's full cadence would put
        /// 14,000 points in an easy long run's polyline for no visible
        /// gain. Distance still integrates over EVERY accepted fix; this
        /// only thins what gets drawn and stored.
        static let routePointM: CLLocationDistance = 3.0
        /// Slower than this is not running, and printing "44:12/mi"
        /// because the runner stopped to cross a road is noise.
        static let slowestReadablePaceSecPerMi = 1800
    }

    // ── Internals ────────────────────────────────────────────────────
    private let manager = CLLocationManager()
    /// (timestamp, cumulative credited miles) for the trailing pace
    /// window. Reading pace off the SAME accumulator the payload ships
    /// means the console cannot show a pace the saved run disagrees with.
    private var samples: [(at: Date, cumMi: Double)] = []
    /// Sum of paused-interval durations, subtracted from wall-clock elapsed
    /// so a pause never counts toward elapsedSec or the finish payload.
    private var pausedIntervals: [(start: Date, end: Date?)] = []
    /// Distance accumulator advances immediately on each accepted fix
    /// (not deferred to a tick), so `distanceMi` is always exact at any
    /// instant, not just at 1s boundaries.
    private var lastAcceptedFix: CLLocation?
    private var lastRoutePoint: CLLocation?
    /// Set when Start was called before the OS had answered the permission
    /// prompt. Without it the runner ends up on a live-looking console
    /// frozen at 0:00 with nothing saying that nothing is recording.
    private var startWhenAuthorized = false

    // Incremental polyline · see `appendRoutePoint`.
    private var polylineAcc = ""
    private var polyPrevLat = 0
    private var polyPrevLng = 0
    private var polylinePoints = 0

    private var lastCheckpointAt: Date?
    /// The run clock. See `startClock`.
    private var clock: Timer?

    /// Whether the built app declares the background-location mode. Read
    /// from the plist rather than assumed, because xcodegen regenerates
    /// Info.plist and this class of key has been lost that way before (TF
    /// 212's launch-screen colour; audit RK-1's watch workout-processing).
    private static let backgroundLocationDeclared: Bool = {
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String]
        return modes?.contains("location") ?? false
    }()

    override init() {
        super.init()
        manager.delegate = self
        manager.pausesLocationUpdatesAutomatically = false
        manager.activityType = .fitness
        authorizationGranted = [.authorizedWhenInUse, .authorizedAlways].contains(manager.authorizationStatus)
        authorizationDenied = [.denied, .restricted].contains(manager.authorizationStatus)
        backgroundRecordingEnabled = Self.backgroundLocationDeclared
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
    ///
    /// Being called before the OS has answered the permission prompt is the
    /// NORMAL first-run path, not an error: the request is remembered and
    /// the run begins by itself the moment authorization lands.
    func start() {
        guard state != .running else { return }
        guard authorizationGranted else {
            startWhenAuthorized = true
            requestPermission()
            return
        }
        startWhenAuthorized = false

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
        // A drop that was true before the pause is not true now, and the
        // console would otherwise hold "GPS signal dropped" over a resumed
        // run until the next fix recomputed it.
        lastFixAgeIsStale = false
        configureForRecording()
        manager.startUpdatingLocation()
        startClock()
        writeCheckpoint(force: true)
    }

    /// ─────────────────────────────────────────────────────────────────────
    /// THE RUN CLOCK LIVES HERE NOW, NOT IN THE VIEW
    ///
    /// This class used to have no timer: "the view ticks it", through
    /// `TimelineView(.periodic(from: .now, by: 1.0))` in a `.background`,
    /// with `.onChange(of: ctx.date)` calling `tick`. That idiom is a
    /// feedback loop, and it was measured spinning on a real launch:
    ///
    ///   `.now` is evaluated inside `body`. Every body evaluation therefore
    ///   builds a NEW schedule anchored at a new instant, which immediately
    ///   produces a new `ctx.date`, which fires `onChange`, which calls
    ///   `tick`, which writes `elapsedSec` (`@Published`, no equality
    ///   check), which invalidates the view, which evaluates `body`.
    ///
    /// Instrumented run, iPhone 17 simulator, first-run permission path:
    /// 5,543 ticks and 87,990 log lines in about fifteen seconds — and, in
    /// the same window, TWO accepted GPS fixes. That is the second half of
    /// the damage: the loop pegs the main actor, so the `Task { @MainActor }`
    /// hop out of `didUpdateLocations` cannot get scheduled and the fixes
    /// simply never arrive. On screen it looks like a console frozen at 0:00
    /// with a distance that never moves, which is exactly what it was.
    ///
    /// A recorder owning its own clock also fixes the quieter version of
    /// this: the clock stopping because a VIEW went away or failed to
    /// re-render. The run is not the screen.
    ///
    /// `.common` mode so a scroll or a sheet animation cannot stall it, and
    /// one immediate tick so the display does not sit a second behind.
    private func startClock() {
        clock?.invalidate()
        // `[weak self]` belongs on the OUTER closure. On the inner `Task` it
        // still requires a strong `self` to form the weak reference from, so
        // the Timer would retain the tracker and a run left un-paused would
        // keep it (and its location manager) alive for the life of the app.
        let t = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick(at: .now) }
        }
        RunLoop.main.add(t, forMode: .common)
        clock = t
        tick(at: .now)
    }

    private func stopClock() {
        clock?.invalidate()
        clock = nil
    }

    private func configureForRecording() {
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        // Filtering happens in `accept`, not here — see file header note 3.
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .fitness
        manager.pausesLocationUpdatesAutomatically = false
        // Setting this without the plist key raises an exception, so the
        // key is checked rather than assumed.
        if Self.backgroundLocationDeclared {
            manager.allowsBackgroundLocationUpdates = true
            manager.showsBackgroundLocationIndicator = true
            backgroundRecordingEnabled = true
        } else {
            backgroundRecordingEnabled = false
        }
    }

    /// Releases the background-location assertion (and the blue bar with
    /// it) the moment the run is not recording. A console left open must
    /// not hold the receiver on.
    private func stopRecordingHardware() {
        manager.stopUpdatingLocation()
        if Self.backgroundLocationDeclared {
            manager.allowsBackgroundLocationUpdates = false
        }
    }

    func pause() {
        guard state == .running else { return }
        // Freeze elapsedSec at the exact pause instant (same reasoning as
        // finish()'s catch-up tick) before flipping state — tick() no-ops
        // once state != .running, so this is the last chance to advance it.
        tick(at: .now)
        state = .paused
        stopClock()
        pausedIntervals.append((start: .now, end: nil))
        stopRecordingHardware()
        // Whatever happens between here and Resume — a walk back to the
        // car, a drive home, a lift to the top of the hill — is not
        // distance run. Dropping the anchor makes the first fix after
        // Resume anchor-only, so none of it can be credited.
        lastAcceptedFix = nil
        lastRoutePoint = nil
        currentPaceSecPerMi = nil
        samples.removeAll(keepingCapacity: true)
        writeCheckpoint(force: true)
    }

    /// Ends the session WITHOUT saving · stops GPS immediately. The view
    /// is responsible for confirming with the runner before calling this
    /// (accidental-tap protection lives in the console, not here, so the
    /// tracker stays a pure state machine testable without UI).
    func discard() {
        stopClock()
        stopRecordingHardware()
        Self.clearCheckpoint(workoutId: workoutId)
        state = .idle
        elapsedSec = 0
        distanceMi = 0
        currentPaceSecPerMi = nil
        routeCoords = []
        samples = []
        pausedIntervals = []
        lastAcceptedFix = nil
        lastRoutePoint = nil
        hasFirstFix = false
        trackHasGap = false
        lastFixAgeIsStale = false
        workoutId = nil
        startedAt = nil
        polylineAcc = ""
        polyPrevLat = 0
        polyPrevLng = 0
        polylinePoints = 0
        lastCheckpointAt = nil
    }

    /// Stops GPS and freezes state for the summary/save flow. Does NOT
    /// reset — the caller reads distanceMi/elapsedSec/routeCoords for the
    /// summary screen, then calls `buildCompletionPayload` to save.
    ///
    /// The checkpoint deliberately SURVIVES finish(): it is cleared by
    /// `clearCheckpoint(workoutId:)` once the payload is safely in the
    /// durable queue, so a crash in the half-second between the two still
    /// leaves the run recoverable.
    func finish() {
        guard state == .running || state == .paused else { return }
        // Finishing while still `.running` (the common path — "End" from
        // the live console) needs one last elapsedSec advance to the instant
        // of finishing; the view's periodic tick() only runs on ~1s
        // boundaries, so up to ~1s would otherwise be dropped from the
        // saved duration. Finishing while `.paused` needs no such catch-up:
        // the pause() call already froze elapsedSec via the tick right
        // before it, and no further wall-clock time should accrue.
        if state == .running {
            tick(at: .now)
        }
        stopClock()
        stopRecordingHardware()
        state = .finished
        writeCheckpoint(force: true)
    }

    /// Advance the published elapsed-seconds clock. Called by the view's
    /// 1s TimelineView tick (mirrors TreadmillView.tick) rather than an
    /// internal Timer, so SwiftUI's own render loop drives the cadence and
    /// there's no competing timer to leak/invalidate.
    func tick(at now: Date) {
        guard state == .running else { return }
        elapsedSec = elapsedSeconds(at: now)
        // GPS-stale flag · no accepted fix in the last 20s while actively
        // recording. Purely informational (clock keeps running · distance
        // just won't advance until signal returns).
        if let lastAt = samples.last?.at {
            lastFixAgeIsStale = now.timeIntervalSince(lastAt) > GPS.staleNoticeSec
        }
        // Pace has to expire on the CLOCK, not on the next fix. It used to be
        // recomputed only from `accept`, so when the signal went the tile kept
        // showing the last pace it had, as a measured value, for as long as
        // the drop lasted. Observed on the simulator: GPS off for two minutes,
        // "GPS signal dropped" correctly on screen, and 5:22/mi sitting above
        // it in white the whole time. RULE ONE — that number was not being
        // measured any more.
        updateCurrentPace(at: now)
    }

    /// Elapsed excluding paused time, computed from anchors. Never
    /// accumulated, so no remainder is lost and no missed tick is
    /// permanent.
    private func elapsedSeconds(at now: Date) -> Int {
        guard let started = startedAt else { return 0 }
        let pausedSoFar = pausedIntervals.reduce(0.0) { sum, interval in
            let end = interval.end ?? now
            return sum + end.timeIntervalSince(interval.start)
        }
        return max(0, Int((now.timeIntervalSince(started) - pausedSoFar).rounded()))
    }

    // MARK: - Completion payload

    /// WatchCompletion-shaped dict, matching TreadmillView.buildPayload's
    /// approach exactly (POST /api/watch/workouts/complete expects this
    /// shape · see WatchCompletionBody in
    /// web-v2/app/api/watch/workouts/complete/route.ts). A single `.work`
    /// phase spans the whole run — mirrors WatchWorkout.makeJustRun()'s
    /// "Just run" shape, since the phone recorder has no structured plan
    /// to subdivide into. `source: "phone"` is in that route's
    /// ALLOWED_SOURCES whitelist.
    ///
    /// `avgHr`/`maxHr` come from the caller because the HR source belongs
    /// to the console (HealthKit, written by a watch the runner may well be
    /// wearing even though the PHONE is recording the route). Omitted when
    /// there is no source, which the backend's null-HR handling covers.
    func buildCompletionPayload(status: String, avgHr: Int? = nil, maxHr: Int? = nil) -> [String: Any] {
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
        if let avgHr { phase["actualAvgHr"] = avgHr }
        if let maxHr { phase["actualMaxHr"] = maxHr }

        var payload: [String: Any] = [
            "workoutId": workoutId ?? "phone_\(UUID().uuidString)",
            "startedAt": iso.string(from: started),
            "completedAt": iso.string(from: finishedAt),
            "status": status, // "completed" | "partial" | "abandoned"
            "totalDistanceMi": roundedDistanceMi,
            "totalDurationSec": elapsedSec,
            "source": "phone",
            "indoor": false,
            "timezone": TimeZone.current.identifier,
            "phases": [phase],
        ]
        if let polyline = encodedPolyline() {
            payload["routePolyline"] = polyline
        }
        if let avgHr { payload["avgHr"] = avgHr }
        if let maxHr { payload["maxHr"] = maxHr }
        // kcal intentionally omitted (nil) — the backend's resolveCalories
        // tier-3 estimator already covers watch-less runs from other ingest
        // paths, so this is a known-good gap, not a new failure mode.
        return payload
    }

    /// Google polyline (precision 5) of the route, built incrementally as
    /// points land rather than re-encoded from scratch — the checkpoint
    /// wants it every ten seconds, and re-walking the whole array each time
    /// is work that grows with the length of the run.
    /// nil when fewer than 2 points (nothing to draw).
    func encodedPolyline() -> String? {
        polylinePoints >= 2 ? polylineAcc : nil
    }

    private func appendRoutePoint(_ loc: CLLocation) {
        if let prev = lastRoutePoint, loc.distance(from: prev) < GPS.routePointM { return }
        lastRoutePoint = loc
        routeCoords.append(loc.coordinate)
        let iLat = Int((loc.coordinate.latitude * 1e5).rounded())
        let iLng = Int((loc.coordinate.longitude * 1e5).rounded())
        encodeSigned(iLat - polyPrevLat)
        encodeSigned(iLng - polyPrevLng)
        polyPrevLat = iLat
        polyPrevLng = iLng
        polylinePoints += 1
    }

    private func encodeSigned(_ v: Int) {
        var value = v < 0 ? ~(v << 1) : (v << 1)
        while value >= 0x20 {
            polylineAcc.append(Character(UnicodeScalar(UInt8((0x20 | (value & 0x1f)) + 63))))
            value >>= 5
        }
        polylineAcc.append(Character(UnicodeScalar(UInt8(value + 63))))
    }
}

// MARK: - Crash / jetsam recovery
//
// The endpoint derives its row id from `workoutId` and upserts, so
// re-submitting a run that also saved normally is a no-op rather than a
// duplicate. That is what makes an unconditional flush safe.

extension PhoneRunTracker {

    private static var checkpointURL: URL? {
        guard let dir = try? FileManager.default.url(for: .applicationSupportDirectory,
                                                     in: .userDomainMask,
                                                     appropriateFor: nil,
                                                     create: true) else { return nil }
        return dir.appendingPathComponent("phone-run-checkpoint.json")
    }

    /// Rewritten at most every ten seconds while recording. Ten seconds is
    /// the most a jetsam kill can cost, and at ~1 Hz fixes it is one write
    /// per ten fixes rather than one per fix.
    private func writeCheckpoint(force: Bool = false) {
        let now = Date.now
        if !force, let last = lastCheckpointAt, now.timeIntervalSince(last) < 10 { return }
        guard let workoutId, let startedAt else { return }
        lastCheckpointAt = now
        let cp = PhoneRunCheckpoint(workoutId: workoutId,
                                    startedAt: startedAt,
                                    updatedAt: now,
                                    elapsedSec: elapsedSeconds(at: now),
                                    distanceMi: distanceMi,
                                    polyline: encodedPolyline(),
                                    hadGap: trackHasGap)
        guard let url = Self.checkpointURL,
              let data = try? JSONEncoder().encode(cp) else { return }
        // Off the main thread: the console is being read mid-stride and
        // must not hitch for a disk write.
        Task.detached(priority: .utility) {
            try? data.write(to: url, options: .atomic)
        }
    }

    /// Removes the checkpoint, but only if it is the one for `workoutId` —
    /// so a late clear from a finished run can never delete a live one.
    /// Passing nil clears unconditionally.
    static func clearCheckpoint(workoutId: String?) {
        guard let url = checkpointURL else { return }
        if let workoutId,
           let data = try? Data(contentsOf: url),
           let cp = try? JSONDecoder().decode(PhoneRunCheckpoint.self, from: data),
           cp.workoutId != workoutId {
            return
        }
        try? FileManager.default.removeItem(at: url)
    }

    /// The checkpoint of a run this process is not recording — i.e. one the
    /// app died in the middle of. nil when there is nothing to recover.
    ///
    /// Guards, in order: it has to be recent enough to belong to this block
    /// of training rather than a forgotten file; it has to be stale enough
    /// that no live recorder is still writing it; and it has to carry
    /// enough to be a run at all, using the SAME thresholds the backend's
    /// sub-threshold guard applies (lib/runs/length-guard.ts), so a
    /// tap-test is dropped here rather than round-tripped to be dropped
    /// there.
    static func interruptedRun() -> PhoneRunCheckpoint? {
        guard let url = checkpointURL,
              let data = try? Data(contentsOf: url),
              let cp = try? JSONDecoder().decode(PhoneRunCheckpoint.self, from: data) else { return nil }
        let age = Date.now.timeIntervalSince(cp.updatedAt)
        // The floor is 15s, not a minute: a live recorder's checkpoint is at
        // most 10s stale (the write throttle), so 15s is already past any
        // race with one — and a longer floor would silently drop the run of a
        // runner who relaunched quickly after a crash, which is precisely the
        // runner this exists for.
        guard age > 15, age < 24 * 3600 else { return nil }
        guard cp.distanceMi >= 0.25 || cp.elapsedSec >= 180 else {
            try? FileManager.default.removeItem(at: url)
            return nil
        }
        return cp
    }

    /// Re-submits an interrupted run through the same durable queue a
    /// normal save uses, and clears the checkpoint. Returns what was
    /// recovered so the caller can say so; nil when there was nothing.
    ///
    /// Status is "partial", not "completed": nobody pressed End on this
    /// run, and saying otherwise would be inventing a fact about it.
    @discardableResult
    static func flushInterruptedRun() -> PhoneRunCheckpoint? {
        guard let cp = interruptedRun() else { return nil }
        let iso = ISO8601DateFormatter()
        var phase: [String: Any] = [
            "index": 0,
            "type": "work",
            "label": "Run",
            "completed": true,
            "actualDurationSec": cp.elapsedSec,
            "actualDistanceMi": (cp.distanceMi * 100).rounded() / 100,
        ]
        if cp.elapsedSec > 0, cp.distanceMi > 0.05 {
            phase["actualPaceSPerMi"] = Int((Double(cp.elapsedSec) / cp.distanceMi).rounded())
        }
        var payload: [String: Any] = [
            "workoutId": cp.workoutId,
            "startedAt": iso.string(from: cp.startedAt),
            "completedAt": iso.string(from: cp.updatedAt),
            "status": "partial",
            "totalDistanceMi": (cp.distanceMi * 100).rounded() / 100,
            "totalDurationSec": cp.elapsedSec,
            "source": "phone",
            "indoor": false,
            "timezone": TimeZone.current.identifier,
            "phases": [phase],
        ]
        if let polyline = cp.polyline { payload["routePolyline"] = polyline }
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return nil }
        Task { _ = await WatchSync.shared.saveCompletionDurably(data) }
        clearCheckpoint(workoutId: cp.workoutId)
        return cp
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
            // The first-run path: Start ran, the OS asked, the runner said
            // yes. Without this the console sits at 0:00 forever and the
            // only way to actually begin is to tap the button labelled
            // "Pause".
            if self.authorizationGranted, self.startWhenAuthorized {
                self.start()
            }
            // Authorization revoked mid-run (Settings, or a downgrade out
            // of "while using"). Nothing more will be measured, so stop
            // pretending to measure: freeze the run where it stands rather
            // than letting the clock run on over a dead receiver.
            if self.authorizationDenied, self.state == .running {
                self.pause()
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        // Every fix, in order. Taking only `locations.last` threw away the
        // rest of a batched delivery — which is exactly what arrives after
        // a stretch with the screen off, when the fixes matter most.
        let batch = locations
        Task { @MainActor [weak self] in
            guard let self else { return }
            for loc in batch { self.accept(loc) }
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
    ///
    /// Rejection happens in two distinct places and the difference matters:
    /// a fix rejected ABOVE the `defer` is thrown away entirely (not
    /// trustworthy enough to be anywhere near this run); a fix rejected
    /// BELOW it still becomes the new anchor and contributes no distance.
    /// That second case is how a gap ends — the run picks up from where the
    /// runner actually is, and nothing is invented about how they got there.
    private func accept(_ loc: CLLocation) {
        guard state == .running else { return }
        // Negative accuracy means the fix is invalid outright.
        guard loc.horizontalAccuracy >= 0 else { return }
        // A cached fix replayed by the location subsystem.
        guard abs(loc.timestamp.timeIntervalSinceNow) < GPS.freshnessSec else { return }
        // The anchor fix has to be better than the ones that follow it.
        guard loc.horizontalAccuracy <= (hasFirstFix ? GPS.accuracyM : GPS.firstFixAccuracyM) else { return }
        // Out-of-order delivery would difference backwards in time.
        if let last = lastAcceptedFix, loc.timestamp <= last.timestamp { return }

        defer {
            lastAcceptedFix = loc
            hasFirstFix = true
            lastFixAgeIsStale = false
            appendRoutePoint(loc)
            samples.append((at: loc.timestamp, cumMi: distanceMi))
            // ~5 minutes at the receiver's cadence · the pace window only
            // looks back 30s, and the staleness read only wants the last.
            if samples.count > 300 { samples.removeFirst(samples.count - 300) }
            updateCurrentPace()
            writeCheckpoint()
        }

        // First fix of the run (or the first after a pause) anchors only.
        guard let last = lastAcceptedFix else { return }
        let dt = loc.timestamp.timeIntervalSince(last.timestamp)
        guard dt > 0 else { return }
        let delta = loc.distance(from: last)
        let implied = delta / dt

        // A silence too long to see through. A tunnel is one thing; an app
        // that was killed and relaunched twenty minutes later is another,
        // and from here the two look identical. Re-anchor, credit nothing,
        // and tell the runner the track has a hole in it. Crediting the
        // chord would draw a straight line through a loop nobody measured.
        if dt > GPS.bridgeableGapSec {
            trackHasGap = true
            return
        }
        // Still plausible as a person, over a gap long enough to hide a
        // vehicle.
        if dt > GPS.staleNoticeSec, implied > GPS.bridgeSpeedMps {
            trackHasGap = true
            return
        }
        // A single-fix jump nothing human produces: a receiver bounce.
        if implied > GPS.maxCreditSpeedMps {
            trackHasGap = true
            return
        }
        // Receiver noise around a stationary phone.
        if delta < GPS.minCreditM { return }
        // Doppler agrees the phone was not moving at either end. This is the
        // test that stops a runner waiting at a light from accruing
        // distance — differencing positions alone cannot tell drift from a
        // slow jog.
        if loc.speed >= 0, last.speed >= 0,
           loc.speed < GPS.stationaryMps, last.speed < GPS.stationaryMps {
            return
        }

        distanceMi += delta / 1609.344
    }

    /// Trailing-window pace, differenced from the credited-distance
    /// accumulator rather than re-measured off the raw fixes — so the pace
    /// on the console and the distance in the payload are the same
    /// measurement. nil when the window is too short to mean anything, or
    /// when it says the runner has stopped.
    private func updateCurrentPace(at now: Date = .now) {
        // The window has to be CURRENT, not merely non-empty. Tied to the
        // same threshold the "GPS signal dropped" note uses, so the number
        // and the explanation for its absence appear together.
        guard let last = samples.last,
              now.timeIntervalSince(last.at) <= GPS.staleNoticeSec else {
            currentPaceSecPerMi = nil
            return
        }
        let cutoff = last.at.addingTimeInterval(-GPS.paceWindowSec)
        guard let first = samples.first(where: { $0.at >= cutoff }) else {
            currentPaceSecPerMi = nil
            return
        }
        let windowSec = last.at.timeIntervalSince(first.at)
        let windowMi = last.cumMi - first.cumMi
        guard windowSec >= 8, windowMi > 0 else { currentPaceSecPerMi = nil; return }
        let pace = Int((windowSec / windowMi).rounded())
        currentPaceSecPerMi = pace <= GPS.slowestReadablePaceSecPerMi ? pace : nil
    }
}

// MARK: - Preview seam
//
// Every live property above is `private(set)` on purpose — this class is "a
// pure state machine testable without UI" (see file header) and nothing
// outside PhoneRunTracker.swift should be able to set GPS-derived state by
// hand. A SwiftUI #Preview still needs to show a representative mid-run
// console (LiveRunOutdoorV5), so this gives it one legal way in: a DEBUG-only
// seam, compiled out of every release build, that never touches CoreLocation.

#if DEBUG
extension PhoneRunTracker {
    /// Stamps the tracker into a specific display state for a #Preview.
    /// Bypasses GPS entirely — never call this outside DEBUG/preview code.
    func seedForPreview(state: RunState,
                        elapsedSec: Int,
                        distanceMi: Double,
                        currentPaceSecPerMi: Int?,
                        lastFixAgeIsStale: Bool = false,
                        hasFirstFix: Bool = true,
                        trackHasGap: Bool = false) {
        self.state = state
        self.elapsedSec = elapsedSec
        self.distanceMi = distanceMi
        self.currentPaceSecPerMi = currentPaceSecPerMi
        self.lastFixAgeIsStale = lastFixAgeIsStale
        self.hasFirstFix = hasFirstFix
        self.trackHasGap = trackHasGap
        self.workoutId = workoutId ?? "preview"
        self.startedAt = startedAt ?? Date(timeIntervalSinceNow: -Double(elapsedSec))
        self.authorizationGranted = true
    }
}
#endif
