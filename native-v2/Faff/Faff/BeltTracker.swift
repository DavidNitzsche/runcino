//
//  BeltTracker.swift
//  faff.run iPhone · the one integrator for an indoor belt session.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS EXISTS
//
//  A treadmill has no GPS and no odometer we can read. The only measurement
//  the phone gets is "the runner says the belt is at V mph, from now until
//  they say otherwise". Distance is therefore an INTEGRAL of belt speed over
//  time — and every place that number is needed has to be the SAME integral,
//  or the run disagrees with itself.
//
//  Two consoles were each doing that arithmetic inline, and both got a piece
//  of it wrong (2026-08-21 audit):
//
//   · `Views/TreadmillView.swift` integrated the RUN total correctly per
//     second, then recomputed each PHASE's distance as
//     `duration / 3600 × speedMph` using whatever speed was set when the
//     phase closed. Change the belt mid-phase and the whole phase was
//     credited at the final speed. Proven on David's 2026-08-20 run: the
//     run total came back 4.26 mi and the single phase 4.25 mi — two numbers
//     that cannot differ unless the speed moved, and only one of which was
//     integrated.
//
//   · `ViewsV5/LiveRunTreadmillV5.swift` averaged speed per TICK
//     (`speedSum / sampleCount`) rather than per SECOND, so any tick that
//     covered more than one second — every tick after a lock-screen or a
//     backgrounding — weighted a whole gap the same as one ordinary second.
//
//  Both are the same bug: a summary statistic standing in for an integral.
//  So the integral lives here, once, and both consoles call it.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE THREE THINGS THIS TYPE GUARANTEES
//
//  1. Σ (segment distance) == run distance, exactly. Every tick's distance
//     is added to the run total and to the open segment in the same
//     statement, so the segments partition the run by construction. There is
//     no second formula that can drift from the first.
//
//  2. Time is carried as a Double and never truncated. The old
//     `Int(interval.rounded())` discarded the sub-second remainder on EVERY
//     tick, and timer jitter is one-sided (a timer fires late, never early),
//     so the loss was systematic rather than self-cancelling.
//
//  3. A second the app did not witness is credited at the last known belt
//     speed — losing real running is not more honest than estimating it —
//     but it is COUNTED as unmeasured, so the console and the payload can
//     both say so. A modelled number must never look measured; when enough
//     of the distance is modelled, the number wears the amber mark.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE GAP POLICY
//
//  `TimelineView(.periodic)` stops firing when the app is backgrounded or
//  the screen is locked (`isIdleTimerDisabled` prevents AUTO-lock only, not
//  the side button). On return, one large delta arrives. Three bands:
//
//   · delta ≤ `liveToleranceSec` — an ordinary tick. Measured.
//   · `liveToleranceSec` < delta ≤ `maxCreditedGapSec` — the app was away.
//     Credited at the last known speed, and recorded as unmeasured.
//   · delta > `maxCreditedGapSec` — credited up to the cap; the remainder
//     is dropped, not invented. This is the guard against the catastrophic
//     shape of the same bug: a phone that sits in a locker for two hours
//     must not come back with a 14-mile run on it.
//

import Foundation

// MARK: - Samples

/// One instant of the belt, as it was. `tSec` and `distMi` are relative to
/// the START OF THE SEGMENT, because that is the shape
/// `deriveSplitsFromPaceSamples` (web-v2/app/api/watch/workouts/complete)
/// consumes: it walks each phase with its own offset and adds the phase's
/// `actualDistanceMi` / `actualDurationSec` between phases.
struct BeltSample: Equatable {
    var tSec: Int
    var distMi: Double
    var paceSPerMi: Int
    var bpm: Int?
}

// MARK: - Segment result

/// What one closed segment actually was. Every field is derived from the
/// same per-tick integration — `distanceMi` is not recomputed from
/// `avgSpeedMph`, they are two readings of one accumulator.
struct BeltSegmentActual: Equatable {
    var durationSec: Int
    var distanceMi: Double
    /// TIME-weighted mean belt speed. Because distance is defined as
    /// ∫v·dt, this satisfies `distanceMi == avgSpeedMph × durationSec / 3600`
    /// exactly — the phase's speed, distance and pace can never disagree.
    var avgSpeedMph: Double
    /// TIME-weighted mean incline.
    var avgInclinePct: Double
    /// Seconds inside this segment the app did not witness (see the gap
    /// policy above). Zero on an ordinary segment.
    var unmeasuredSec: Int
    /// Distance inside this segment credited across those unwitnessed
    /// seconds — the modelled share of `distanceMi`.
    var unmeasuredMi: Double
    var samples: [BeltSample]

    /// Seconds per mile, from duration and distance. Nil for a segment with
    /// no distance rather than a divide-by-zero sentinel.
    var paceSPerMi: Int? {
        guard distanceMi > 0, durationSec > 0 else { return nil }
        return Int((Double(durationSec) / distanceMi).rounded())
    }
}

// MARK: - The tracker

struct BeltTracker {

    // ── Tuning ──────────────────────────────────────────────────────────
    /// A tick longer than this means the app was not on screen. One second
    /// of scheduling jitter is ordinary; three is not.
    static let liveToleranceSec: Double = 3.0
    /// The most one gap may contribute. Half an hour is longer than any
    /// plausible interruption a runner stays on the belt through, and short
    /// enough that a forgotten session cannot invent a long run.
    static let maxCreditedGapSec: Double = 1800.0
    /// Pace-sample cadence, matching the watch's own ~5 s stream so the
    /// server-side split derivation sees one shape from both sources.
    static let sampleCadenceSec: Double = 5.0
    /// Below this, the modelled share of the run is not worth marking — a
    /// couple of seconds of scheduling noise is not an estimate.
    static let unmeasuredMarkThresholdMi: Double = 0.02

    // ── Whole session ───────────────────────────────────────────────────
    private(set) var elapsedSec: Double = 0
    private(set) var distanceMi: Double = 0
    private(set) var elevGainFt: Double = 0
    private(set) var unmeasuredSec: Double = 0
    private(set) var unmeasuredMi: Double = 0
    /// Time inside gaps longer than `maxCreditedGapSec`, credited to
    /// nothing. Reported so the run can say what it declined to count.
    private(set) var droppedSec: Double = 0
    /// Wall time that passed while the session was paused, after it started.
    /// Not distance and not duration — but it IS the difference between the
    /// run's clock and the wall clock, which is the only way a run can prove
    /// its own clock did not drop ticks. See `clockDriftSec`.
    private(set) var pausedSec: Double = 0
    private var started = false

    // ── Open segment ────────────────────────────────────────────────────
    private(set) var segElapsedSec: Double = 0
    private(set) var segDistanceMi: Double = 0
    private(set) var segUnmeasuredSec: Double = 0
    private(set) var segUnmeasuredMi: Double = 0
    private var segSpeedSecSum: Double = 0      // Σ mph · s
    private var segInclineSecSum: Double = 0    // Σ %   · s
    private var segSamples: [BeltSample] = []
    private var segNextSampleAt: Double = 0
    private var segLastSampleTSec: Int = -1
    private var segLastSampledSpeedMph: Double = .nan

    private var lastTickAt: Date

    init(now: Date = .now) {
        self.lastTickAt = now
    }

    /// Whole-run rounded reads, for the UI and the payload.
    var elapsedSecInt: Int { Int(elapsedSec.rounded()) }
    /// True once enough of the run's distance was credited across seconds
    /// the app did not witness for the number to be an estimate rather than
    /// a reading. Drives the amber mark.
    var distanceIsModelled: Bool { unmeasuredMi >= Self.unmeasuredMarkThresholdMi }

    // MARK: - Clock

    /// Mark the session as started and anchor the clock. Everything before
    /// this is not the run — the console can be on screen while a plan
    /// loads, or while the runner steps onto the belt.
    mutating func begin(at now: Date) {
        lastTickAt = now
        started = true
    }

    /// Re-anchor without crediting anything. Called on pause, on resume, and
    /// on every tick while the session is not running — any moment where wall
    /// time passed but the belt was not turning as far as this session is
    /// concerned. Once the session has started, that span is recorded: a run
    /// that cannot account for the wall clock cannot claim its clock is sound.
    mutating func resync(to now: Date) {
        if started {
            pausedSec += Swift.max(0, now.timeIntervalSince(lastTickAt))
        }
        lastTickAt = now
    }

    /// The run's own audit of its clock, in seconds: how far
    /// `wallClock - (running + paused + declined)` misses zero.
    ///
    /// Every second between the first play and now is in exactly one of those
    /// three buckets, so on a healthy session this is zero to within the final
    /// partial tick. A non-zero value means ticks were dropped without being
    /// noticed — the failure mode that used to require reading a row out of
    /// the database to catch. Rides on the payload so every run proves it
    /// rather than waiting to be spot-checked.
    func clockDriftSec(startedAt: Date, completedAt: Date) -> Double {
        let wall = completedAt.timeIntervalSince(startedAt)
        return wall - (elapsedSec + pausedSec + droppedSec)
    }

    /// Advance the session to `now` at the belt's current settings.
    ///
    /// `bpm` is the live heart rate if one is streaming; it rides along on
    /// the pace samples at the same instants so the server's per-mile split
    /// HR lookup (`hrByT.get(s.tSec)`) hits an exact key instead of missing
    /// every time.
    mutating func advance(to now: Date, speedMph: Double, inclinePct: Double, bpm: Int?) {
        let raw = now.timeIntervalSince(lastTickAt)
        lastTickAt = now
        started = true
        // A clock that moved backwards (NTP correction, timezone shift)
        // credits nothing rather than a negative distance.
        guard raw > 0 else { return }

        var credited = raw
        var unwitnessed: Double = 0
        if raw > Self.liveToleranceSec {
            credited = min(raw, Self.maxCreditedGapSec)
            droppedSec += raw - credited
            unwitnessed = credited
        }

        let dMi = (credited / 3600.0) * speedMph
        elapsedSec += credited
        distanceMi += dMi
        elevGainFt += dMi * 5280.0 * (inclinePct / 100.0)
        unmeasuredSec += unwitnessed
        unmeasuredMi += (unwitnessed / 3600.0) * speedMph

        segElapsedSec += credited
        segDistanceMi += dMi
        segSpeedSecSum += speedMph * credited
        segInclineSecSum += inclinePct * credited
        segUnmeasuredSec += unwitnessed
        segUnmeasuredMi += (unwitnessed / 3600.0) * speedMph

        recordSampleIfDue(speedMph: speedMph, bpm: bpm)
    }

    // MARK: - Segments

    /// Close the open segment and start a fresh one. The returned actual is
    /// the segment's own slice of the one integration — never a recompute.
    ///
    /// `speedMph` / `bpm` are the settings at the boundary, used only to
    /// stamp a final sample so the segment's sample stream reaches its true
    /// end rather than stopping up to `sampleCadenceSec` short.
    mutating func closeSegment(speedMph: Double, bpm: Int?) -> BeltSegmentActual {
        if segElapsedSec > 0 { appendSample(speedMph: speedMph, bpm: bpm, force: true) }
        let dur = Int(segElapsedSec.rounded())
        let actual = BeltSegmentActual(
            durationSec: dur,
            distanceMi: segDistanceMi,
            avgSpeedMph: segElapsedSec > 0 ? segSpeedSecSum / segElapsedSec : speedMph,
            avgInclinePct: segElapsedSec > 0 ? segInclineSecSum / segElapsedSec : 0,
            unmeasuredSec: Int(segUnmeasuredSec.rounded()),
            unmeasuredMi: segUnmeasuredMi,
            samples: segSamples
        )
        segElapsedSec = 0
        segDistanceMi = 0
        segUnmeasuredSec = 0
        segUnmeasuredMi = 0
        segSpeedSecSum = 0
        segInclineSecSum = 0
        segSamples = []
        segNextSampleAt = 0
        segLastSampleTSec = -1
        segLastSampledSpeedMph = .nan
        return actual
    }

    /// The open segment's actual WITHOUT closing it — for a live read, or
    /// for the final segment at End where closing and reading are the same
    /// act but the caller may still want to re-read.
    func openSegment(speedMph: Double) -> BeltSegmentActual {
        BeltSegmentActual(
            durationSec: Int(segElapsedSec.rounded()),
            distanceMi: segDistanceMi,
            avgSpeedMph: segElapsedSec > 0 ? segSpeedSecSum / segElapsedSec : speedMph,
            avgInclinePct: segElapsedSec > 0 ? segInclineSecSum / segElapsedSec : 0,
            unmeasuredSec: Int(segUnmeasuredSec.rounded()),
            unmeasuredMi: segUnmeasuredMi,
            samples: segSamples
        )
    }

    // MARK: - Sampling

    private mutating func recordSampleIfDue(speedMph: Double, bpm: Int?) {
        let speedMoved = segLastSampledSpeedMph.isNaN
            || abs(speedMph - segLastSampledSpeedMph) > 0.0001
        guard segElapsedSec >= segNextSampleAt || speedMoved else { return }
        appendSample(speedMph: speedMph, bpm: bpm, force: false)
    }

    /// One sample. `force` stamps the segment's closing instant even if a
    /// sample already exists for that whole second.
    private mutating func appendSample(speedMph: Double, bpm: Int?, force: Bool) {
        let t = Int(segElapsedSec.rounded())
        // Never two samples inside one second: the server keys per-mile HR
        // by exact `tSec`, and a duplicate key is a silent overwrite.
        if t <= segLastSampleTSec && !force { return }
        if t <= segLastSampleTSec, force, segSamples.isEmpty == false {
            // The closing instant lands inside a second already sampled —
            // update that sample rather than adding a colliding key.
            segSamples[segSamples.count - 1] = BeltSample(
                tSec: t, distMi: segDistanceMi,
                paceSPerMi: Int((3600.0 / Swift.max(0.1, speedMph)).rounded()), bpm: bpm)
            segLastSampledSpeedMph = speedMph
            return
        }
        segSamples.append(BeltSample(
            tSec: t,
            distMi: segDistanceMi,
            paceSPerMi: Int((3600.0 / Swift.max(0.1, speedMph)).rounded()),
            bpm: bpm
        ))
        segLastSampleTSec = t
        segLastSampledSpeedMph = speedMph
        segNextSampleAt = segElapsedSec + Self.sampleCadenceSec
    }
}

// MARK: - Wire shape

extension BeltSegmentActual {
    /// The `paceSamples` array as the completion endpoint declares it
    /// (`WatchCompletionPhaseSample`: `tSec` / `paceSPerMi` / `distMi`).
    var paceSamplesPayload: [[String: Any]] {
        samples.map { s in
            ["tSec": s.tSec,
             "distMi": (s.distMi * 1000).rounded() / 1000,
             "paceSPerMi": s.paceSPerMi]
        }
    }

    /// The `hrSamples` array, on the SAME `tSec` grid as `paceSamples` so
    /// the server's per-mile HR lookup finds a key for every pace sample.
    /// Empty when no watch is streaming — never a zero, never a guess.
    var hrSamplesPayload: [[String: Any]] {
        samples.compactMap { s in
            guard let bpm = s.bpm else { return nil }
            return ["tSec": s.tSec, "bpm": bpm]
        }
    }
}

// MARK: - Belt speed in the runner's own units
//
// The internal accumulator is mph and stays mph — that is the wire's unit
// and what `actualSpeedMph` means. But the ± steppers were ALSO stepping in
// mph, so a km-preferring runner saw a console they could not dial: each tap
// moved the display by 0.161 km/h and no sequence of taps reached a round
// km/h number, on a belt whose own console steps in 0.1 km/h. The step and
// the bounds belong in the unit the runner is reading.

enum BeltSpeed {
    /// Round bounds IN THE DISPLAY UNIT, so the reachable extremes are
    /// numbers a belt actually shows.
    static func bounds(for unit: DistanceUnit) -> ClosedRange<Double> {
        unit == .km ? 1.0...20.0 : 0.5...12.0
    }

    /// Step the belt by one notch in the runner's own unit and return the
    /// result back in mph.
    static func stepped(mph: Double, by notches: Double, unit: DistanceUnit) -> Double {
        let shown = Units.convertSpeed(mph: mph, to: unit)
        let range = bounds(for: unit)
        let next = ((shown + notches * 0.1) * 10).rounded() / 10
        let clamped = Swift.min(Swift.max(next, range.lowerBound), range.upperBound)
        return unit == .km ? clamped * Units.milesPerKm : clamped
    }
}
