//
//  TreadmillHRFreshness.swift
//  faff.run iPhone · what the treadmill console is allowed to claim about its
//  own heart-rate number, and why.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE ACTUAL SOURCE, STATED PLAINLY (P0 gap #1)
//
//  Phone-led treadmill mode has TWO possible HR channels, and this app uses
//  BOTH, whichever is fresher at any instant — there is no single "the"
//  source:
//
//   1. MIRRORED HKWorkoutSession (`.mirroredWorkoutSession`). When the watch
//      opens its own `HKWorkoutSession` (`TreadmillHRSession.swift`, watch
//      target) and the phone has registered
//      `HKHealthStore.workoutSessionMirroringStartHandler` before that
//      happens, iOS hands the phone a MIRRORED session with its own
//      `HKLiveWorkoutBuilder`, receiving the SAME live delegate callbacks the
//      watch itself gets as HealthKit collects them — this is the genuinely
//      live, sub-few-second channel, the "supported mirrored-workout
//      architecture." Apple's own documented use case (Nike Run Club /
//      Strava's live-watch-metrics-on-phone pattern).
//
//   2. Asynchronous HealthKit sample sync (`.asyncHealthKitSync`). The
//      pre-existing `HKObserverQuery` + `HKAnchoredObjectQuery` drain in
//      `TreadmillHRStreamer` — reads whatever HR samples the watch's session
//      has already WRITTEN to the shared HealthKit store, once iCloud/local
//      sync delivers them. 5-30s latency by this file's own prior header.
//      Kept as the FALLBACK: mirroring requires the phone to have registered
//      its handler before the watch session starts, requires both devices
//      reachable, and this session cannot verify on real hardware that the
//      handshake always lands — a runner who ends up on channel 2 alone
//      still gets a real number, just a delayed one, and the freshness state
//      below tells them which they are looking at rather than pretending
//      both are the same thing.
//
//  Never claim "live" from channel 2's own timing — the STATE below is
//  computed from measured sample age, not from which channel produced it.
//  A slow mirror sample reads exactly the same as a slow async sample: both
//  are `.delayed` or `.stale` by age, honestly.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS IS ITS OWN FILE, WITH NO HEALTHKIT IMPORT
//
//  HealthKit cannot be exercised in a headless XCTest target — there is no
//  fake heart to attach to a simulator. Every decision that CAN be pulled out
//  of "what does HealthKit say" into "given a sample age, what do we say
//  about it" lives here, as a pure function over `Date`s, so this file's own
//  claims are the ones this session can actually prove rather than assert.
//  `TreadmillHRStreamer` is the untestable wrapper around real HealthKit
//  calls; this is the tested policy it calls into.
//

import Foundation

/// Which live channel most recently produced the current sample. Not a
/// ranking — the freshest sample wins regardless of which channel it came
/// from (see file header) — this is provenance, shown to the runner and
/// carried on the completion payload, never used to prefer a staler sample
/// over a fresher one from the "wrong" channel.
enum TreadmillHRSource: String, Equatable, Codable {
    case mirroredWorkoutSession
    case asyncHealthKitSync
    case none
}

/// What the console is allowed to tell the runner about its own number.
/// `.live`/`.delayed`/`.stale` are all "we have a real sample, here is how
/// old it is" — `.connecting` and `.unavailable` are the two states where
/// showing a bpm number at all would be showing something stale as if it
/// were current, which this type exists to prevent.
enum TreadmillHRFreshness: Equatable {
    /// No attempt has been made yet (console not started), or no watch has
    /// ever answered — never had a sample.
    case unavailable
    /// An attempt is in flight (console started, watch bridge requested)
    /// but no sample has landed yet. Distinct from `.unavailable` — Rule 11:
    /// "trying and getting nothing yet" and "never asked" are different
    /// facts.
    case connecting
    /// A sample within the live window — safe to read as "now."
    case live
    /// A sample past the live window but within the delayed window — real,
    /// but the runner should know it might be a few seconds to a couple of
    /// minutes behind.
    case delayed
    /// A sample old enough that treating it as current would be
    /// misleading — this is the state that answers "do not display a stale
    /// HealthKit sample as live."
    case stale
}

/// The complete, displayable/loggable answer to "what is this console's own
/// HR number, right now" — the four fields the P0 explicitly asks for:
/// current value, source, sample timestamp, connected/delayed/unavailable
/// state.
struct TreadmillHRSnapshot: Equatable {
    var bpm: Int?
    var source: TreadmillHRSource
    var sampleAt: Date?
    var freshness: TreadmillHRFreshness

    static let empty = TreadmillHRSnapshot(bpm: nil, source: .none, sampleAt: nil, freshness: .unavailable)
}

/// Pure classification — no HealthKit, no view, no side effects. Given when
/// "now" is and when the last real sample landed (if any), and whether an
/// attempt to connect is currently in flight, decide what can honestly be
/// claimed.
enum TreadmillHRFreshnessPolicy {
    /// A sample this recent reads as genuinely current. Matched to the
    /// mirrored session's expected cadence (HealthKit's own live-builder
    /// delegate fires within a couple of seconds of a real sample) — wide
    /// enough that ordinary jitter on the async channel's 5-30s latency
    /// does not flap between `.live` and `.delayed` on every tick, narrow
    /// enough that it never claims "live" off a sample that is actually
    /// several async-sync cycles old.
    static let liveWindowSec: TimeInterval = 12
    /// Past this, the sample is old enough that showing it as "your heart
    /// rate" rather than "your heart rate a while ago" would mislead a
    /// runner mid-interval. Matches the console's own pre-existing
    /// "stopped · reconnecting" threshold (`hrHint`), so the two only ever
    /// tell one story.
    static let staleWindowSec: TimeInterval = 120

    static func classify(now: Date, sampleAt: Date?, isAttemptInFlight: Bool) -> TreadmillHRFreshness {
        guard let sampleAt else {
            return isAttemptInFlight ? .connecting : .unavailable
        }
        let age = now.timeIntervalSince(sampleAt)
        if age <= liveWindowSec { return .live }
        if age <= staleWindowSec { return .delayed }
        return .stale
    }

    /// Full snapshot in one call — what `TreadmillHRStreamer` publishes and
    /// what the console reads, in one place, so no two call sites can
    /// independently disagree about the same question (Rule 16).
    static func snapshot(now: Date, bpm: Int?, source: TreadmillHRSource,
                         sampleAt: Date?, isAttemptInFlight: Bool) -> TreadmillHRSnapshot {
        let freshness = classify(now: now, sampleAt: sampleAt, isAttemptInFlight: isAttemptInFlight)
        // A snapshot never carries a bpm without a matching sample time, and
        // never carries a sample time without a bpm — the two are written
        // together on every real sample (see `TreadmillHRStreamer.applySample`).
        switch freshness {
        case .unavailable, .connecting:
            return TreadmillHRSnapshot(bpm: nil, source: .none, sampleAt: nil, freshness: freshness)
        case .live, .delayed, .stale:
            return TreadmillHRSnapshot(bpm: bpm, source: source, sampleAt: sampleAt, freshness: freshness)
        }
    }
}
