//
//  WatchDeviceState.swift
//  FaffWatch
//
//  The three V5 boards that draw the WATCH rather than the run — `Low
//  battery`, `Water lock` and the Always-On page — need device conditions
//  that nothing in this app was reading. This file is where those readings
//  come from. It publishes nothing itself: `WorkoutTracker` owns the
//  @Published surface (one ObservableObject for the faces to bind to), and
//  this file supplies the machinery behind it.
//
//  Three pieces:
//
//  · `BatteryDrainEstimator` — pure arithmetic over a series of quantised
//    battery readings. Its whole job is to be willing to answer "I don't
//    know". The `Low battery` board's doc is explicit that the projected
//    minutes MUST be a real estimate and that a constant there would be a
//    lie, so the estimator returns nil far more often than it returns a
//    number, and that is the intended behaviour, not a gap.
//
//  · `WatchDeviceMonitor` — opts battery monitoring in for the duration of
//    a run, polls battery + water lock on a slow timer, and hands readings
//    back. Read-only with respect to the run: it can start nothing, pause
//    nothing and end nothing (rule 8 — no sensor may degrade the run).
//
//  · `WatchLuminanceBridge` — Always-On has no imperative API. The reduced-
//    luminance state exists ONLY as a SwiftUI environment value, so some
//    view has to read it and hand it over. That modifier is the one place
//    in this file that touches the view layer.
//

import Foundation
import SwiftUI
import WatchKit
import Combine

// MARK: - Battery drain estimator

/// Turns a series of battery readings taken DURING a run into an honest
/// projection of how many more minutes of running the watch can hold — or
/// into nothing at all.
///
/// ## Why this is not `level / someConstant`
///
/// The handoff flags the projected-minutes clause on the `Low battery` board
/// for device confirmation and is strict about it: a hardcoded number there
/// would be a fabrication dressed as a measurement. The only honest source is
/// the drain this run is actually producing, on this watch, with this GPS and
/// this display brightness. So the estimator measures it.
///
/// ## Why it anchors on TRANSITIONS, not on the first sample
///
/// `WKInterfaceDevice.batteryLevel` is quantised (watchOS reports in coarse
/// steps, historically 5%). If you anchor on the first reading of the run you
/// do not know where inside its step you started: seeing 20% → 15% could mean
/// anything from a hair over 0% of real drain to nearly 10%. Anchoring on the
/// MOMENT THE LEVEL FIRST CHANGED gives an exact crossing point, and measuring
/// to a later crossing point gives a second one. The interval between two
/// crossings is an unbiased measurement of the drain rate; anything shorter is
/// a guess with a number on it.
///
/// That is why the first projection of a run does not arrive early: two
/// observed step-downs at a typical workout drain (~10-15%/hr) is roughly 40
/// minutes in. Before that, `projectedMinutes()` returns nil and the board
/// drops the clause. This is the correct answer, not a deficiency.
struct BatteryDrainEstimator {

    private struct Mark {
        let fraction: Double    // 0…1
        let at: Date
    }

    /// The first downward level transition observed this run — the unbiased
    /// zero of the measurement window.
    private var anchor: Mark?
    /// The most recent reading (transition or not).
    private var latest: Mark?
    /// Downward transitions observed AFTER the anchor. One is enough: anchor
    /// plus one more crossing bounds a real interval.
    private var transitionsSinceAnchor = 0

    /// Level deltas below this are float noise, not a real step.
    private static let stepEpsilon = 0.005
    /// Never project off a window shorter than this, even if the device
    /// reports fine-grained steps that cross quickly.
    private static let minWindowSec: TimeInterval = 300
    /// Sanity band on the answer. Outside it the model is wrong, so say
    /// nothing rather than print a number the runner would act on.
    private static let plausibleMinutes: ClosedRange<Int> = 1...600

    mutating func reset() {
        anchor = nil
        latest = nil
        transitionsSinceAnchor = 0
    }

    /// Feed one reading.
    ///
    /// - Parameters:
    ///   - fraction: `WKInterfaceDevice.batteryLevel`, 0…1. Negative (unknown)
    ///     readings are IGNORED rather than treated as a reset — a transient
    ///     unknown must not throw away a window we spent 40 minutes earning.
    ///   - charging: on a charger the drain model is meaningless. Reset, so
    ///     that a run that passed through a charging spell cannot project off
    ///     a rate that mixes charging with running.
    mutating func observe(fraction: Double, charging: Bool, now: Date = .now) {
        guard fraction >= 0 else { return }

        if charging {
            reset()
            latest = Mark(fraction: fraction, at: now)
            return
        }

        guard let previous = latest else {
            latest = Mark(fraction: fraction, at: now)
            return
        }

        let delta = previous.fraction - fraction

        // Level went UP without the device reporting charging (a re-seated
        // reading, a device that under-reported). The window is no longer
        // measuring monotonic drain, so it is no longer measuring anything.
        if delta < -Self.stepEpsilon {
            reset()
            latest = Mark(fraction: fraction, at: now)
            return
        }

        // Same step as last time — nothing new is known.
        guard delta > Self.stepEpsilon else { return }

        latest = Mark(fraction: fraction, at: now)
        if anchor == nil {
            anchor = Mark(fraction: fraction, at: now)
            transitionsSinceAnchor = 0
        } else {
            transitionsSinceAnchor += 1
        }
    }

    /// Minutes of running the watch can still hold at the drain this run has
    /// actually produced, or nil when no honest answer exists yet.
    ///
    /// Returns nil when: fewer than two level transitions have been observed;
    /// the window between them is shorter than `minWindowSec`; the battery is
    /// or was on a charger; the level moved upward; or the arithmetic lands
    /// outside `plausibleMinutes`.
    func projectedMinutes(now: Date = .now) -> Int? {
        guard let anchor, let latest, transitionsSinceAnchor >= 1 else { return nil }

        let window = latest.at.timeIntervalSince(anchor.at)
        guard window >= Self.minWindowSec else { return nil }

        let drop = anchor.fraction - latest.fraction
        guard drop > 0 else { return nil }

        let perSecond = drop / window
        guard perSecond > 0 else { return nil }

        // Time from the last crossing to empty, less the time already spent
        // since that crossing. `latest.fraction` is exact at `latest.at`
        // because that reading IS a crossing.
        let secondsLeft = (latest.fraction / perSecond) - now.timeIntervalSince(latest.at)
        guard secondsLeft > 0 else { return nil }

        let minutes = Int((secondsLeft / 60).rounded())
        guard Self.plausibleMinutes.contains(minutes) else { return nil }
        return minutes
    }

    /// Diagnostic only — true once the estimator has an unbiased window and
    /// is capable of producing a number. Useful for a debug face; the board
    /// itself should just read the optional.
    var hasUnbiasedWindow: Bool { anchor != nil && transitionsSinceAnchor >= 1 }
}

// MARK: - Device monitor

/// Polls the device conditions the run cannot get from HealthKit: battery and
/// water lock.
///
/// **This type never touches the run.** It holds no reference to the session,
/// the builder or the location manager, so there is no path by which a battery
/// read or a water-lock read can pause, stop or degrade recording (rule 8).
/// It reports; something else decides.
@MainActor
final class WatchDeviceMonitor {

    struct Reading {
        /// 0…100, or nil when the device will not report a level (monitoring
        /// off, or `batteryState == .unknown`).
        let batteryPercent: Int?
        /// See `BatteryDrainEstimator.projectedMinutes()`. Frequently nil.
        let batteryProjectedMinutes: Int?
        /// watchOS water lock. The run keeps recording while this is true.
        let isWaterLocked: Bool
    }

    /// Water lock is the reason this is 2 s and not 30 s: the board that
    /// proves the run is still alive should appear promptly. The tick itself
    /// is two property reads, so the cost is the timer, not the work.
    static let tickInterval: TimeInterval = 5
    /// Battery level is quantised in coarse steps; sampling it faster than
    /// this buys nothing and costs a little. ~30 s.
    private static let batteryEveryNTicks = 6

    private let onReading: (Reading) -> Void
    private var timer: Timer?
    private var estimator = BatteryDrainEstimator()
    private var ticksSinceBattery = 0
    private var batteryPercent: Int?
    private var batteryProjectedMinutes: Int?
    /// Whether battery monitoring was already on before we asked for it, so
    /// `stop()` restores rather than assumes.
    private var monitoringWasAlreadyOn = false

    init(onReading: @escaping (Reading) -> Void) {
        self.onReading = onReading
    }

    /// Opt battery monitoring in and start polling. Scoped to a run: battery
    /// monitoring is only worth its cost while there is a run whose remaining
    /// minutes are the question, and the drain window has to be measured
    /// during the run to describe the run.
    func start() {
        guard timer == nil else { return }

        let device = WKInterfaceDevice.current()
        monitoringWasAlreadyOn = device.isBatteryMonitoringEnabled
        // Required opt-in: without this `batteryLevel` is -1 and
        // `batteryState` is .unknown.
        device.isBatteryMonitoringEnabled = true

        estimator.reset()
        batteryPercent = nil
        batteryProjectedMinutes = nil
        ticksSinceBattery = Self.batteryEveryNTicks   // sample on the first tick

        // The run loop retains the timer, and the timer's block holds the
        // monitor weakly — so a monitor that outlives its owner would leave a
        // timer firing forever into nothing. The guard invalidates it instead.
        // (A deinit would be the obvious home for that, but a global-actor-
        // isolated deinit touching a non-Sendable stored Timer is exactly the
        // shape that stops compiling under stricter concurrency later.)
        timer = Timer.scheduledTimer(withTimeInterval: Self.tickInterval, repeats: true) { [weak self] firing in
            guard self != nil else { firing.invalidate(); return }
            Task { @MainActor in self?.tick() }
        }

        // Don't make the first board wait a whole tick for a reading.
        tick()
    }

    /// Stop polling and hand battery monitoring back to whatever state it was
    /// in. Safe to call when never started.
    func stop() {
        timer?.invalidate()
        timer = nil
        if !monitoringWasAlreadyOn {
            WKInterfaceDevice.current().isBatteryMonitoringEnabled = false
        }
        estimator.reset()
        batteryPercent = nil
        batteryProjectedMinutes = nil
    }

    private func tick() {
        let device = WKInterfaceDevice.current()

        ticksSinceBattery += 1
        if ticksSinceBattery >= Self.batteryEveryNTicks {
            ticksSinceBattery = 0
            sampleBattery(device)
        }

        onReading(Reading(batteryPercent: batteryPercent,
                          batteryProjectedMinutes: batteryProjectedMinutes,
                          isWaterLocked: device.isWaterLockEnabled))
    }

    private func sampleBattery(_ device: WKInterfaceDevice) {
        let level = Double(device.batteryLevel)   // -1.0 when unknown
        guard level >= 0 else {
            // The percentage on the board is a REAL reading or it is absent.
            // A device that will not report one gets no number.
            batteryPercent = nil
            batteryProjectedMinutes = nil
            return
        }
        let state = device.batteryState
        estimator.observe(fraction: level, charging: state == .charging || state == .full)
        batteryPercent = Int((level * 100).rounded())
        batteryProjectedMinutes = estimator.projectedMinutes()
    }
}

// MARK: - Always-On bridge

/// Pipes SwiftUI's `\.isLuminanceReduced` into a plain callback.
///
/// Always-On / wrist-down is not readable imperatively — there is no
/// `WKInterfaceDevice.isLuminanceReduced`. The environment value is the only
/// source, so a view has to observe it and forward it. Attach this ONCE, high
/// in the workout view tree; attaching it more than once is harmless but
/// pointless.
struct WatchLuminanceBridge: ViewModifier {
    @Environment(\.isLuminanceReduced) private var reduced
    let sink: (Bool) -> Void

    func body(content: Content) -> some View {
        content
            .onAppear { sink(reduced) }
            .onChange(of: reduced) { _, now in sink(now) }
    }
}

extension View {
    /// Keep `tracker.isLuminanceReduced` in step with the display's Always-On
    /// state, so the Always-On board knows when it is the board being drawn.
    func faffTracksLuminance(_ tracker: WorkoutTracker) -> some View {
        modifier(WatchLuminanceBridge { [weak tracker] reduced in
            tracker?.setLuminanceReduced(reduced)
        })
    }
}
