//
//  RunLobbyV5.swift
//  faff.run iPhone · pre-run experience — the Run sheet becomes a lobby.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS EXISTS
//
//  `RunPickerV5` (ShellV5.swift) was two buttons and one static sentence. A
//  runner tapping RUN had no way to see, before committing: what workout is
//  about to start, whether the watch has it, whether location is granted, or
//  whether the phone even has a target to hold. All of that was discovered
//  only AFTER tapping Outdoor/Treadmill and landing in the live console —
//  which is the wrong side of the commit for "device readiness" and "what am
//  I about to do."
//
//  MISMATCH RISK THIS CLOSES
//
//  `TodayHostV5` lets a runner step to any day via the week strip and fully
//  render that day's workout. The RUN pill is global (tab bar), completely
//  disconnected from whatever day is on screen, and `LiveRunHostV5.task`
//  fetches `API.fetchWatchWorkout()` unconditionally — the server's literal
//  "today," never the previewed date. A runner who steps to tomorrow's
//  workout to look at it, then taps RUN, used to start recording against
//  actual-today's workout with zero indication the two differ.
//
//  A run can only ever be recorded NOW, so the fix is not "let the lobby
//  start a different day" — it is: **the lobby fetches and shows exactly the
//  workout that is about to start**, so a mismatch between "what I was
//  looking at" and "what I'm about to run" is visible before the tap, not
//  discovered after. `PendingRunPlanV5` below then hands that SAME fetched
//  object to `LiveRunHostV5`, so what was shown and what starts are
//  guaranteed to be one read, not two.
//

import SwiftUI
import CoreLocation

// MARK: - The one fetch, handed forward

/// Bridges the lobby's pre-flight fetch to `LiveRunHostV5` so the workout the
/// runner was SHOWN and the workout that STARTS are one API read, not two.
/// Without this, the lobby and the console each call
/// `API.fetchWatchWorkout()` independently — normally the same answer, but a
/// plan rebuild, a midnight rollover mid-lobby, or a flaky read could hand
/// back two different workouts a few seconds apart, which is exactly the
/// "started workout must match what was shown" guarantee this file exists to
/// keep. A tiny in-memory hold, consumed once, is enough: this is not a
/// cache, it does not persist across launches, and a stale or unconsumed
/// value can never leak into an unrelated run because `consume` clears it.
@MainActor
final class PendingRunPlanV5 {
    static let shared = PendingRunPlanV5()
    private init() {}

    enum Snapshot: Equatable {
        /// A real workout, fetched and about to start.
        case workout(WatchWorkout)
        /// The fetch answered — cleanly — with "no workout today" (rest day,
        /// off-plan). Distinct from `nil` (never fetched / already consumed)
        /// per Rule 11: "no data" and "didn't ask" are different facts.
        case none
    }

    /// The date this snapshot was fetched FOR — `workoutId`'s own embedded
    /// date is a private wire detail (`"<uid>-<date>"`) this file must not
    /// parse; the lobby already knows what date it asked for, and that is
    /// the honest source for "did this snapshot survive to the date it
    /// claims to be." Stamped alongside every `record` so a snapshot can
    /// never silently outlive a midnight rollover.
    private(set) var dateISO: String?
    private var snapshot: Snapshot?
    private var capturedAt: Date = .distantPast

    func record(_ s: Snapshot, dateISO: String) {
        snapshot = s
        self.dateISO = dateISO
        capturedAt = Date()
    }

    /// Consumes the held snapshot if it is still fresh enough to describe
    /// "now" — the lobby's fetch and the console's own read are the same
    /// instant only as long as the runner acts on the lobby promptly.  Ten
    /// minutes covers a runner who reads the lobby, ties their shoes, and
    /// taps Start; past that, a fresh fetch is more honest than a held one.
    /// `expectedDateISO`, when passed, additionally refuses a snapshot
    /// recorded for a DIFFERENT date — the guard against a cached workout
    /// from another day or plan version ever reaching Start, independent of
    /// the age check (a snapshot can be young in wall-clock time and still
    /// belong to the wrong day if the device date rolled over underneath it).
    func consume(maxAge: TimeInterval = 600, expectedDateISO: String? = nil) -> Snapshot? {
        guard let snapshot, Date().timeIntervalSince(capturedAt) <= maxAge else { return nil }
        if let expectedDateISO, let recordedDateISO = dateISO, recordedDateISO != expectedDateISO {
            self.snapshot = nil
            self.dateISO = nil
            return nil
        }
        self.snapshot = nil
        self.dateISO = nil
        return snapshot
    }

    #if DEBUG
    /// Test seam only — `WatchSync`'s equivalent pattern. Never used by
    /// product code; a singleton's state must not bleed between test cases.
    func resetForTesting() {
        snapshot = nil
        dateISO = nil
        capturedAt = .distantPast
    }
    #endif
}

// MARK: - Recording owner (Decision 1 · Apple Watch execution)

/// Which device is the SOLE recorder for a session about to start. Resolved
/// once, off the same `RunLobbyWatchReadiness` the lobby already shows the
/// runner — never re-derived independently at the point a run actually
/// starts, because two different answers to "who is recording this" is
/// exactly the shape that produces two independently-persisted activities
/// for one run.
enum RunLobbyRecordingOwner: Equatable {
    /// A compatible, reachable watch holds (or is about to receive) the
    /// canonical workout and executes it. The phone shows companion status
    /// only and never starts its own tracking session for this run.
    case watch
    /// No usable watch — the phone is the sole recorder, exactly as it is
    /// today. Also the answer whenever the watch's last sync is unknown or
    /// failed: "reachable" alone does not prove the watch actually holds
    /// today's workout, and the phone recording is always available as the
    /// safe fallback per "optional watch absence must never block a run."
    case phone

    /// `watchReadiness.ready` means paired + installed + reachable — but
    /// that alone only proves the watch CAN be talked to, not that today's
    /// workout actually landed there. `lastSync` carrying `WatchSync`'s own
    /// "Synced …" success string (set only after `pushTodayToWatch()`
    /// actually completes, `WatchSync.swift`) is the closest signal this
    /// app has to "the watch has the canonical workout" without a two-way
    /// handshake this pass does not build. A reachable watch with no
    /// successful sync on record falls back to phone — the conservative
    /// direction, since the alternative is claiming an execution surface
    /// that may not have anything to execute.
    static func resolve(_ watchReadiness: RunLobbyWatchReadiness) -> Self {
        guard case .ready(let lastSync) = watchReadiness,
              let lastSync, lastSync.hasPrefix("Synced") else { return .phone }
        return .watch
    }
}

// MARK: - Watch readiness (pure, testable)

/// What the lobby tells the runner about the watch, resolved from
/// `WatchSync`'s own published state rather than re-deriving anything. Kept
/// as a pure function of its inputs so it can be unit tested without
/// standing up WatchConnectivity.
enum RunLobbyWatchReadiness: Equatable {
    /// No Apple Watch paired to this phone at all.
    case noWatch
    /// Paired, but Faff isn't installed on it.
    case notInstalled
    /// Paired, installed, and the last sync attempt succeeded.
    case ready(lastSync: String?)
    /// Paired, installed, but not currently reachable (out of range, off
    /// wrist, Bluetooth down) — recording still works on the phone.
    case unreachable(lastSync: String?)

    static func resolve(isPaired: Bool, isWatchAppInstalled: Bool,
                         isReachable: Bool, lastSyncStatus: String?) -> Self {
        guard isPaired else { return .noWatch }
        guard isWatchAppInstalled else { return .notInstalled }
        return isReachable ? .ready(lastSync: lastSyncStatus) : .unreachable(lastSync: lastSyncStatus)
    }

    /// Only the unreachable case has anything a retry could fix — a genuinely
    /// absent or uninstalled watch has no connection to retry.
    var offersRetry: Bool { if case .unreachable = self { return true }; return false }
}

// MARK: - Recording + HR honesty (pure, testable)
//
// CORRECTION (2026-09-03) · the line this replaces —
// "No Apple Watch paired. Recording and heart rate are on your phone." — was
// wrong on its face: an iPhone does not inherently provide running heart
// rate, and "no watch" says nothing about whether ANY heart-rate source is
// connected. Device choice (paired or not) is not the same fact as HR
// availability, and the old line claimed the second from the first. These
// two types render the two facts the runner actually needs — who records,
// and whether heart rate is connected — each true on its own terms.

/// WHO records this session, in words, given the same `RunLobbyRecordingOwner`
/// decision the console will make. One line states both the owner AND why,
/// so a phone-recorded run because the watch is not ready explains the
/// capability difference before the runner commits, not after.
enum RunLobbyRecordingLine: Equatable {
    case watchWillRecord(lastSync: String?)
    case phoneWillRecord(watchReason: String?)

    static func resolve(owner: RunLobbyRecordingOwner, watch: RunLobbyWatchReadiness) -> Self {
        switch owner {
        case .watch:
            if case .ready(let lastSync) = watch { return .watchWillRecord(lastSync: lastSync) }
            return .watchWillRecord(lastSync: nil)
        case .phone:
            switch watch {
            case .noWatch:
                return .phoneWillRecord(watchReason: nil)
            case .notInstalled:
                return .phoneWillRecord(watchReason: "Faff isn't installed on your watch.")
            case .unreachable:
                return .phoneWillRecord(watchReason: "Your watch is paired but not reachable right now.")
            case .ready:
                // Reachable, but resolve() above only grants `.watch` when
                // the last sync actually succeeded — reachable-with-no-
                // confirmed-sync is exactly the gap between "can talk to
                // it" and "it has today's workout."
                return .phoneWillRecord(watchReason: "Your watch hasn't confirmed today's workout yet.")
            }
        }
    }

    var line: String {
        switch self {
        case .watchWillRecord(let lastSync):
            return "Your Apple Watch will execute and record this run." + (lastSync.map { " \($0)." } ?? "")
        case .phoneWillRecord(let reason):
            return "Your phone will record this run." + (reason.map { " \($0)" } ?? "")
        }
    }

    /// True whenever there is a watch-side reason a retry (re-sync) could
    /// fix. A genuinely absent or uninstalled watch has no sync to retry.
    var offersWatchRetry: Bool {
        if case .phoneWillRecord(let reason) = self { return reason != nil }
        return false
    }
}

/// WHETHER heart rate will be available, resolved from the SAME owner
/// decision — never from watch pairing alone. A watch that is paired but not
/// the recording owner is not a live HR source: the wrist only streams
/// samples fast enough to matter during ITS OWN active workout session, not
/// merely by being worn while the phone records.
enum RunLobbyHrLine: Equatable {
    case connectedFromWatch
    case unavailable

    static func resolve(owner: RunLobbyRecordingOwner) -> Self {
        owner == .watch ? .connectedFromWatch : .unavailable
    }

    var line: String {
        switch self {
        case .connectedFromWatch:
            return "Heart rate is connected from your Apple Watch."
        case .unavailable:
            return "No heart-rate source is available. Your phone can record GPS and pace; heart rate will be unavailable."
        }
    }
}

// MARK: - Location readiness (pure, testable)

enum RunLobbyLocationReadiness: Equatable {
    case authorized
    case notDetermined
    case denied

    static func resolve(_ status: CLAuthorizationStatus) -> Self {
        switch status {
        case .authorizedAlways, .authorizedWhenInUse: return .authorized
        case .denied, .restricted: return .denied
        default: return .notDetermined
        }
    }

    var line: String {
        switch self {
        case .authorized:     return "Location ready for outdoor GPS."
        case .notDetermined:  return "Outdoor mode will ask for location access when you start."
        case .denied:         return "Location is off. Outdoor pace and route need it. Enable it in Settings, or run Treadmill instead."
        }
    }

    var isBlockingForOutdoor: Bool { self == .denied }
}

// MARK: - Segment preview (pure, testable)

/// One scannable row in the lobby's structure preview — never a sentence
/// encoding the whole workout, per the pre-run design rule. Repeats collapse
/// to "N ×" instead of listing every rep, the way the design's own group
/// tiles do on Today.
struct RunLobbySegmentGroup: Identifiable, Equatable {
    let id: Int
    let title: String
    let detail: String?
    /// True when this row's HR number (if any) is `.observational` — too
    /// short a rep for HR to reach the effort, per `WatchPhase.hrRole`. The
    /// row still shows the number; this only changes HOW it reads (never a
    /// live target) so a runner does not chase a signal that has not
    /// caught up yet.
    let hrIsObservational: Bool
}

enum RunLobbySegments {
    /// Real payloads bake the rep index into every rep's own label — AND
    /// not only at the end. Rendering this against a real account (Rule 13)
    /// turned up the actual wire shape: `"Hill 1 of 10 \u{00B7} 1 min"` — the
    /// index sits in the MIDDLE, followed by a duration clause. A first
    /// version of this function anchored the strip to end-of-string and
    /// matched nothing, so every hill rendered as its own row instead of
    /// grouping into one "10 ×" row; this is the fix, found by that render.
    ///
    /// Two independent strips, because the label carries two kinds of
    /// per-rep noise: the "N of M" / "N/M" index (wherever it falls) and a
    /// trailing "· <duration>" clause — the duration is already shown
    /// separately (`length(_:)`), so keeping it here would read redundant
    /// in the group title even where it doesn't block grouping outright.
    private static func normalizedLabel(_ label: String) -> String {
        var s = label
        if let re = try? NSRegularExpression(pattern: #"\d+\s*(of|/)\s*\d+"#, options: [.caseInsensitive]) {
            let range = NSRange(s.startIndex..., in: s)
            s = re.stringByReplacingMatches(in: s, options: [], range: range, withTemplate: "")
        }
        if let sep = s.range(of: "\u{00B7}") { s = String(s[..<sep.lowerBound]) }
        return s.trimmingCharacters(in: .whitespaces)
    }

    /// Two phases are "the same rep" for grouping purposes if everything a
    /// runner would read off them matches — type, label STRUCTURE (see
    /// `normalizedLabel`), target, ceiling, and length. Duration is
    /// intentionally excluded from distance reps (`distanceMi` already
    /// carries the length; `durationSec` there is only ever an estimate,
    /// per `WatchPhase`'s own doc comment, and comparing it would fracture
    /// an otherwise-identical group over rounding).
    private static func sameRep(_ a: WatchPhase, _ b: WatchPhase) -> Bool {
        a.type == b.type && normalizedLabel(a.label) == normalizedLabel(b.label)
            && a.targetPaceSPerMi == b.targetPaceSPerMi
            && a.tolerancePaceSPerMi == b.tolerancePaceSPerMi
            && a.hrTargetBpm == b.hrTargetBpm
            && a.repUnit == b.repUnit
            && a.distanceMi == b.distanceMi
            && (a.repUnit == .distance || a.durationSec == b.durationSec)
    }

    private static func length(_ p: WatchPhase) -> String {
        if p.repUnit == .distance, let mi = p.distanceMi {
            return Units.formatDistance(miles: mi, decimals: mi < 1 ? 2 : 1) + " " + Units.distanceLabel()
        }
        let m = p.durationSec / 60
        return m > 0 ? "\(m) min" : "\(p.durationSec) sec"
    }

    /// HR-ROLE-1 · `.observational` reads as "reads ~N", never "HR ~N" — the
    /// wording itself is the signal that this number is not something to
    /// chase, on top of the workout-level caution `executionGuidance` adds
    /// once for the whole session rather than repeating it every row
    /// (Rule 17).
    private static func detail(_ p: WatchPhase) -> String? {
        var parts: [String] = []
        if let pace = p.targetPaceSPerMi {
            parts.append(Units.formatPace(secPerMile: pace))
        }
        if let hr = p.hrTargetBpm {
            // No hand-drawn tilde (check-modelled-mark.sh rule one) — and
            // rightly so beyond the gate: this bpm is a measured LTHR-based
            // anchor, not a modelled/projected number, so the tilde would
            // have been the wrong mark even where it's typed by FaffValue.
            // The word choice alone carries the distinction.
            parts.append(p.effectiveHrRole == .observational ? "reads \(hr)" : "HR \(hr)")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// Builds the preview rows. Warm-up and cooldown bookend as their own
    /// (ungrouped) rows, matching how the Today screen already brackets the
    /// work — the middle is where reps repeat and grouping earns its keep.
    static func summarize(_ phases: [WatchPhase]) -> [RunLobbySegmentGroup] {
        guard !phases.isEmpty else { return [] }
        var rows: [RunLobbySegmentGroup] = []
        var i = 0
        var nextId = 0

        func emit(title: String, detail: String?, hrIsObservational: Bool = false) {
            rows.append(RunLobbySegmentGroup(id: nextId, title: title, detail: detail,
                                              hrIsObservational: hrIsObservational))
            nextId += 1
        }

        while i < phases.count {
            let p = phases[i]
            if p.type == .warmup || p.type == .cooldown {
                emit(title: p.type == .warmup ? "Warm-up" : "Cooldown",
                     detail: [length(p), detail(p)].compactMap { $0 }.joined(separator: " · "))
                i += 1
                continue
            }

            // Try the two shapes that actually occur: a bare repeated work
            // phase (pattern length 1) and a work+recovery pair (pattern
            // length 2). Anything else (an odd one-off segment) falls
            // through to a single ungrouped row below.
            //
            // Length 1 MUST be tried before length 2. A run of N identical
            // bare reps is trivially also "periodic at length 2" (any
            // constant sequence is), so checking length 2 first would group
            // six identical reps as three identical PAIRS — half the real
            // count, silently. Length 1 either finds the true count (bare
            // reps) or fails outright (work ≠ recovery, so it can't match
            // at length 1), so it never masks a real length-2 grouping.
            var grouped = false
            for patternLen in [1, 2] where i + patternLen <= phases.count {
                let pattern = Array(phases[i..<(i + patternLen)])
                var count = 1
                var j = i + patternLen
                while j + patternLen <= phases.count {
                    let candidate = Array(phases[j..<(j + patternLen)])
                    guard candidate.count == pattern.count,
                          zip(candidate, pattern).allSatisfy({ sameRep($0, $1) }) else { break }
                    count += 1
                    j += patternLen
                }
                // The FINAL rep of a work+recovery pattern (patternLen 2)
                // commonly has no recovery after it — recovery happens
                // BETWEEN reps, not following the last one — so the loop
                // above stops one rep short whenever anything (a cooldown, a
                // different segment, or simply the end of the array) follows
                // the bare final work phase instead of another full pair.
                // Real data (Rule 13 render) showed exactly this: "9 × 1 min
                // Hill" plus a stray, ungrouped tenth "Hill 10 of 10" row —
                // a real count silently short by one on screen, with the
                // cooldown sitting right after it. If the phase at the
                // loop's stopping point matches the pattern's WORK half
                // alone, it is that trailing rep — absorb it regardless of
                // what (if anything) follows, since the loop above already
                // proved nothing there continues a full pair.
                if patternLen == 2, j < phases.count,
                   let workOnly = pattern.first(where: { $0.type == .work }),
                   sameRep(phases[j], workOnly) {
                    count += 1
                    j += 1
                }
                guard count >= 2 else { continue }
                let work = pattern.first { $0.type == .work } ?? pattern[0]
                let recovery = pattern.first { $0.type == .recovery }
                var title = "\(count) \u{00D7} \(length(work))"
                let workLabel = normalizedLabel(work.label)
                if !workLabel.isEmpty, workLabel.lowercased() != "work" {
                    title += " \(workLabel)"
                }
                var pieces = [detail(work)].compactMap { $0 }
                if let recovery {
                    pieces.append("\(length(recovery)) recovery")
                }
                emit(title: title, detail: pieces.isEmpty ? nil : pieces.joined(separator: " · "),
                     hrIsObservational: work.hrTargetBpm != nil && work.effectiveHrRole == .observational)
                i = j
                grouped = true
                break
            }
            if !grouped {
                emit(title: p.label.isEmpty ? p.type.rawValue.capitalized : p.label,
                     detail: [length(p), detail(p)].compactMap { $0 }.joined(separator: " · "),
                     hrIsObservational: p.hrTargetBpm != nil && p.effectiveHrRole == .observational)
                i += 1
            }
        }
        return rows
    }

    /// One workout-level sentence, said ONCE, when any work phase in the
    /// session carries an observational HR role — the caution belongs to
    /// the session, not to every row that has an observational number
    /// (Rule 17: a sentence that would otherwise repeat per row belongs to
    /// the block instead).
    static func hasObservationalHr(_ phases: [WatchPhase]) -> Bool {
        phases.contains { $0.type == .work && $0.hrTargetBpm != nil && $0.effectiveHrRole == .observational }
    }
}

// MARK: - Race brief (pure, testable)

enum RunLobbyRaceBrief {
    static func goalLine(goalSec: Int?) -> String? {
        guard let goalSec, goalSec > 0 else { return nil }
        let h = goalSec / 3600, m = (goalSec % 3600) / 60, s = goalSec % 60
        let clock = h > 0
            ? String(format: "%d:%02d:%02d", h, m, s)
            : String(format: "%d:%02d", m, s)
        return "Goal: \(clock)"
    }

    /// Race HR guidance, stated as bands to hold — never an alarm, per
    /// `WatchRaceHr.informationalOnly` when the band carries no personal
    /// evidence. `checkpointAbortBpm` is the one line that reads as a hard
    /// rule, because it is the abort criterion the pre-run brief must state.
    static func hrLines(_ hr: WatchRaceHr?) -> [String] {
        guard let hr else { return [] }
        var lines: [String] = []
        lines.append("Hold \(hr.expectedLoBpm)\u{2013}\(hr.expectedHiBpm) bpm through most of the race.")
        lines.append("Through mile \(String(format: "%.0f", hr.earlyThroughMi)): stay under \(hr.earlyCeilingBpm) bpm, even if it feels slow.")
        if hr.lateAllowanceBpm > hr.expectedHiBpm {
            lines.append("Late miles may drift up to \(hr.lateAllowanceBpm) bpm as you close. That's expected, not a fault.")
        }
        if let checkpointMi = hr.checkpointMi, let abortBpm = hr.checkpointAbortBpm {
            lines.append("If HR is over \(abortBpm) bpm at mile \(String(format: "%.0f", checkpointMi)), back off the goal pace and finish easy.")
        }
        return lines
    }
}

// MARK: - The device's own "today"

/// The device's real calendar day, `yyyy-MM-dd`. A run can only ever be
/// recorded NOW, so the device's own clock — not a server-resolved date — is
/// the right reference for "does this snapshot still belong to today,"
/// mirroring `InjuryPreviewHostV5.tomorrowISO()`'s own reasoning.
enum RunLobbyDate {
    static func todayISO() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = .current
        return f.string(from: Date())
    }
}

// MARK: - Plan-change detection (pure, testable)

/// Answers "did the PRESCRIPTION change" between two reads of today's
/// workout — used right before Start to catch a plan rebuild, an approved
/// reschedule, or an adaptation that landed while the lobby sat open.
enum RunLobbyPlanCheck {
    /// Compares the prescription, never the envelope. `readinessScore`,
    /// `readinessLabel`, and `expiresAt` are freshness/telemetry metadata
    /// that can legitimately differ between two fetches moments apart with
    /// nothing about the WORKOUT having changed — folding them into this
    /// comparison would manufacture a false "the plan changed" on every
    /// routine re-check, which trains a runner to ignore the real ones.
    static func prescriptionChanged(_ shown: WatchWorkout?, _ fresh: WatchWorkout?) -> Bool {
        switch (shown, fresh) {
        case (nil, nil): return false
        case (nil, _?), (_?, nil): return true
        case (let a?, let b?):
            return a.workoutId != b.workoutId
                || a.name != b.name
                || a.phases != b.phases
                || a.distanceMi != b.distanceMi
                || a.isRace != b.isRace
                || a.goalSec != b.goalSec
                || a.hrCeilingBpm != b.hrCeilingBpm
        }
    }
}

// MARK: - Workout fetch state (Rule 11: three facts, never one)

enum RunLobbyWorkoutState {
    case loading
    case ready(WatchWorkout)
    /// The engine answered cleanly: nothing scheduled today.
    case none
    /// The fetch itself failed — distinct from `.none`. Never collapsed into
    /// it, because "no plan" and "couldn't reach the server" are different
    /// facts and call for different sentences.
    case failed

    /// Neither state carries a canonical workout to run structured — the
    /// shared condition the "no canonical workout" UI branches on, so the
    /// two callers of it (the section body, the button-row swap) can never
    /// disagree about which states qualify.
    var hasNoCanonicalWorkout: Bool {
        switch self {
        case .none, .failed: return true
        case .loading, .ready: return false
        }
    }

    var workout: WatchWorkout? {
        if case .ready(let w) = self { return w }
        return nil
    }
}

// MARK: - Workout title (pure, testable)

/// Splits the backend's authored `name` — which for a structured session
/// bakes the full prescription into one string, e.g.
/// `"10×60s hills @ 5K-10K effort · 2 min jog down"` — into a short
/// headline and an optional descriptor, so the primary heading a runner
/// reads first is a NAME, not a paragraph. Never rewrites the words
/// themselves — canonical text stays canonical — this only decides where
/// the line break goes.
enum RunLobbyTitle {
    static func split(_ name: String) -> (headline: String, descriptor: String?) {
        guard let r = name.range(of: " @ ") else { return (name, nil) }
        let headline = String(name[..<r.lowerBound])
        let descriptor = String(name[r.upperBound...]).trimmingCharacters(in: .whitespaces)
        return (headline.isEmpty ? name : headline, descriptor.isEmpty ? nil : descriptor)
    }
}

// MARK: - The lobby

/// Replaces the bare `RunPickerV5` at the one real call site (`ShellV5.swift`
/// · the RUN pill's sheet). `RunPickerV5` itself is left in place — it is
/// still exercised from `GalleryV5` as a plain component reference — but the
/// runner-facing sheet now shows what is about to start and whether the
/// devices are ready to record it, not just two buttons.
struct RunLobbyV5: View {
    let onOutdoor: () -> Void
    let onTreadmill: () -> Void
    let onCancel: () -> Void

    @ObservedObject private var watchSync = WatchSync.shared
    @State private var workoutState: RunLobbyWorkoutState = .loading
    @State private var locationReadiness: RunLobbyLocationReadiness = .resolve(CLLocationManager().authorizationStatus)
    /// The concise "why this workout" line, read from the SAME canonical
    /// sentence Today already shows (`V5Today.why` / `.thesis.coachLine`) —
    /// never a new coaching sentence authored here. Purely additive: a
    /// failure of this fetch never blocks or degrades anything else in the
    /// lobby, it just leaves this one line absent.
    @State private var purpose: String?
    /// Double-tap guard, and what disables the start tiles while a re-fetch
    /// is verifying nothing changed underneath the lobby.
    @State private var isStarting = false
    /// Set when the pre-start re-verification finds the prescription differs
    /// from what was shown — `workoutState` is updated to the fresh read
    /// FIRST, so this alert's "review" action is reviewing the real update,
    /// not a stale display of the old one.
    @State private var planChanged = false

    private var watchReadiness: RunLobbyWatchReadiness {
        .resolve(isPaired: watchSync.isPaired,
                 isWatchAppInstalled: watchSync.isWatchAppInstalled,
                 isReachable: watchSync.isReachable,
                 lastSyncStatus: watchSync.lastSyncStatus)
    }

    private var recordingOwner: RunLobbyRecordingOwner { .resolve(watchReadiness) }

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s20) {
            workoutSection
            readinessSection
            startSection
        }
        .task { await loadWorkout() }
        .alert("Your plan updated", isPresented: $planChanged) {
            Button("Review") {}
        } message: {
            Text("What's about to start has changed since you opened this screen. Review it below before starting.")
        }
    }

    // MARK: Start — re-verify, then record the shown plan so the console reads the SAME one

    /// Re-fetches immediately before handing off, because a plan rebuild, an
    /// approved reschedule, or an adaptation can land while this sheet sits
    /// open. Never silently starts an obsolete prescription: if the fresh
    /// read differs from what was shown, this stops and asks the runner to
    /// review rather than proceeding (`planChanged`). A re-fetch that FAILS
    /// is a different fact from a re-fetch that CHANGED — per "never block a
    /// run for optional data," a failed re-verification proceeds with what
    /// was already shown rather than stopping the runner over a network blip.
    private func start(_ go: @escaping () -> Void) async {
        guard !isStarting else { return }
        isStarting = true
        defer { isStarting = false }

        let shown = workoutState.workout
        do {
            let fresh = try await API.fetchWatchWorkout()
            if RunLobbyPlanCheck.prescriptionChanged(shown, fresh) {
                workoutState = fresh.map { .ready($0) } ?? .none
                planChanged = true
                return
            }
            recordAndGo(fresh ?? shown, go: go)
        } catch {
            recordAndGo(shown, go: go)
        }
    }

    /// `unstructured` records `.none` explicitly (an honest "no target,
    /// started anyway") rather than leaving `PendingRunPlanV5` untouched —
    /// so the console never independently re-fetches and possibly finds a
    /// workout the runner just explicitly chose to skip.
    private func recordAndGo(_ workout: WatchWorkout?, go: @escaping () -> Void) {
        if let workout {
            PendingRunPlanV5.shared.record(.workout(workout), dateISO: RunLobbyDate.todayISO())
        } else {
            PendingRunPlanV5.shared.record(.none, dateISO: RunLobbyDate.todayISO())
        }
        go()
    }

    private func loadWorkout() async {
        locationReadiness = .resolve(CLLocationManager().authorizationStatus)
        async let purposeFetch: String? = {
            // Best-effort, additive only — see `purpose`'s doc comment.
            guard case .ok(let today) = try? await API.fetchV5Today() else { return nil }
            // Same precedence TodayBeforeV5 itself uses (`why` then
            // `thesis.coachLine`) — the ONE existing rule, read again here,
            // not a second one invented for this screen.
            if let why = today.why, !why.isEmpty { return why }
            if let coachLine = today.thesis?.coachLine, !coachLine.isEmpty { return coachLine }
            return nil
        }()
        do {
            if let w = try await API.fetchWatchWorkout() {
                workoutState = .ready(w)
            } else {
                workoutState = .none
            }
        } catch {
            workoutState = .failed
        }
        purpose = await purposeFetch
    }

    // MARK: - What's about to start

    @ViewBuilder
    private var workoutSection: some View {
        switch workoutState {
        case .loading:
            Skeleton(lines: 3)
        case .failed:
            ErrorNote(text: "Couldn't load today's planned workout. Starting now will record an unstructured run.",
                      onRetry: { Task { workoutState = .loading; await loadWorkout() } })
        case .none:
            Silence(reason: "Nothing scheduled today. Starting now will record an unstructured run.")
        case .ready(let w):
            workoutCard(w)
        }
    }

    private func workoutCard(_ w: WatchWorkout) -> some View {
        let title = RunLobbyTitle.split(w.name)
        return VStack(alignment: .leading, spacing: V5.S.s12) {
            // 1 · exact workout being started
            HStack(alignment: .firstTextBaseline) {
                V5SectionLabel(text: "Today · about to start", color: V5.textQuiet, size: TypeScaleV5.label12)
                Spacer(minLength: 0)
                if let mi = w.distanceMi {
                    Text(Units.formatDistance(miles: mi) + " " + Units.distanceLabel())
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textSecondary)
                }
            }
            Text(title.headline)
                .font(.faffDisplay(20))
                .foregroundStyle(V5.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            if let descriptor = title.descriptor {
                Text(descriptor)
                    .font(.faffText(TypeScaleV5.body15))
                    .foregroundStyle(V5.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if w.isRace {
                raceBrief(w)
            } else {
                // 2 · concise purpose
                if let purpose {
                    Text(purpose)
                        .font(.faffText(TypeScaleV5.body15))
                        .foregroundStyle(V5.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                // 3 · grouped structure
                segmentPreview(w.phases)
                // 4 · primary execution guidance
                let guidance = executionGuidanceLines(w)
                if !guidance.isEmpty {
                    VStack(alignment: .leading, spacing: V5.S.s4) {
                        ForEach(Array(guidance.enumerated()), id: \.offset) { _, line in
                            Text(line)
                                .font(.faffText(TypeScaleV5.label13))
                                .foregroundStyle(V5.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(.top, V5.S.s2)
                }
            }
        }
        .padding(V5.S.tilePad)
        .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
    }

    /// The coach's own cue, then any workout-level HR framing — a session
    /// ceiling (easy/long) or, per the HR-role fix, the one-time caution
    /// that this session's reps are too short for heart rate to govern
    /// live. Never both a ceiling and the short-rep caution: doctrine gates
    /// `hrCeilingBpm` to easy/long sessions only, and the short-rep role
    /// only ever appears on quality-session work phases, so the two facts
    /// cannot co-occur on one workout.
    private func executionGuidanceLines(_ w: WatchWorkout) -> [String] {
        var lines: [String] = []
        if let cue = w.cue, !cue.isEmpty { lines.append(cue) }
        if let ceiling = w.hrCeilingBpm {
            lines.append("Keep heart rate under \(ceiling) bpm.")
        }
        if RunLobbySegments.hasObservationalHr(w.phases) {
            lines.append("Effort and controlled form govern this. The reps are too short for heart rate to guide pace live. Don't chase it.")
        }
        return lines
    }

    private func segmentPreview(_ phases: [WatchPhase]) -> some View {
        let rows = RunLobbySegments.summarize(phases)
        return VStack(alignment: .leading, spacing: V5.S.s8) {
            ForEach(rows) { row in
                HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
                    Text(row.title)
                        .font(.faffText(TypeScaleV5.body15, weight: .semibold))
                        .foregroundStyle(V5.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let detail = row.detail {
                        Text(detail)
                            .font(.faffText(TypeScaleV5.label13))
                            // Quieter than the target-pace detail beside it —
                            // an observational HR reading is not the same
                            // KIND of fact as a pace to hold, and should not
                            // read with the same weight.
                            .foregroundStyle(row.hrIsObservational ? V5.textQuiet : V5.textSecondary)
                            .multilineTextAlignment(.trailing)
                    }
                }
            }
        }
        .padding(.top, rows.isEmpty ? 0 : V5.S.s4)
    }

    private func raceBrief(_ w: WatchWorkout) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s8) {
            HStack(spacing: V5.S.s12) {
                if let goal = RunLobbyRaceBrief.goalLine(goalSec: w.goalSec) {
                    Text(goal)
                        .font(.faffText(TypeScaleV5.body15, weight: .semibold))
                        .foregroundStyle(V5.textPrimary)
                }
                if let strategy = w.strategyLabel {
                    Text(strategy)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textSecondary)
                }
            }
            ForEach(Array(RunLobbyRaceBrief.hrLines(w.raceHr).enumerated()), id: \.offset) { _, line in
                Text(line)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let fueling = w.fueling, fueling.needed, !fueling.shortLine.isEmpty {
                Text(fueling.shortLine)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - Device and recording readiness

    private var readinessSection: some View {
        let recording = RunLobbyRecordingLine.resolve(owner: recordingOwner, watch: watchReadiness)
        let hr = RunLobbyHrLine.resolve(owner: recordingOwner)
        return VStack(alignment: .leading, spacing: V5.S.s8) {
            V5SectionLabel(text: "Before you start", color: V5.textQuiet, size: TypeScaleV5.label12)
            // 5 · who records, and 6 · the actual blocking problem (if the
            // watch isn't ready, that reason IS the blocking-problem slot —
            // stated once here, not duplicated as a second row).
            readinessRow(text: recording.line,
                         warn: recording.offersWatchRetry,
                         retry: recording.offersWatchRetry ? { Task { await WatchSync.shared.refresh(force: true) } } : nil)
            readinessRow(text: hr.line, warn: false, retry: nil)
            readinessRow(text: locationReadiness.line, warn: locationReadiness.isBlockingForOutdoor,
                         retry: nil,
                         openSettings: locationReadiness.isBlockingForOutdoor)
        }
        .padding(.horizontal, V5.S.s4)
    }

    private func readinessRow(text: String, warn: Bool, retry: (() -> Void)?, openSettings: Bool = false) -> some View {
        HStack(alignment: .top, spacing: V5.S.s8) {
            Circle()
                .fill(warn ? V5.attention : V5.textQuiet)
                .frame(width: 6, height: 6)
                .padding(.top, V5.S.s4)
            Text(text)
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(warn ? V5.textPrimary : V5.textQuiet)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let retry {
                FaffButton("Retry", variant: .secondary, size: .md, full: false, action: retry)
            }
            if openSettings {
                FaffButton("Settings", variant: .secondary, size: .md, full: false, action: {
                    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                    UIApplication.shared.open(url)
                })
            }
        }
    }

    // MARK: - 7 · start choice, 8 · cancel

    /// The subtitle on "Outdoor" tells the truth about WHO executes it —
    /// "GPS pace and route" undersells what actually happens when the watch
    /// is the recording owner, and overstates it when watch HR isn't
    /// actually connected. Treadmill is unaffected: it always needs the
    /// phone's own belt-speed/incline input regardless of watch presence,
    /// matching the legacy routing's own scope (Outdoor-only).
    private var outdoorSubtitle: String {
        recordingOwner == .watch ? "Executes and records on your Apple Watch" : "GPS pace and route"
    }

    @ViewBuilder
    private var startSection: some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            if workoutState.hasNoCanonicalWorkout {
                // "Do not present the normal workout-start action when no
                // canonical workout has been loaded" — the tiles below are
                // relabelled, not the ordinary Outdoor/Treadmill choice, so
                // the state reads as unmistakably different rather than
                // silently identical to a real prescribed run.
                if case .failed = workoutState {
                    FaffButton("Retry workout", variant: .secondary, size: .md,
                               action: { Task { workoutState = .loading; await loadWorkout() } })
                }
                choice(title: "Start unstructured · Outdoor", sub: "GPS pace and route, no plan",
                       action: { Task { await start(onOutdoor) } })
                choice(title: "Start unstructured · Treadmill", sub: "Speed and incline, no plan",
                       action: { Task { await start(onTreadmill) } })
            } else {
                choice(title: "Outdoor", sub: outdoorSubtitle, action: { Task { await start(onOutdoor) } })
                choice(title: "Treadmill", sub: "Speed and incline, no GPS", action: { Task { await start(onTreadmill) } })
            }

            // PICKERTRUTH-1 · gated on the same fact the live screen
            // reads, so the sheet cannot promise what the build cannot
            // do. Kept verbatim from RunPickerV5 rather than restated,
            // per Rule 17 — one wording for one fact.
            Text(PhoneRunTracker.backgroundRecordingAvailable
                 ? "An outdoor run keeps recording with your screen locked and the phone in a pocket. Closing the app ends it."
                 : "This build can only record while the app is open. Keep the screen on until you end the run.")
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textQuiet)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, V5.S.s4)

            FaffButton("Cancel", variant: .ghost, size: .md, action: onCancel)
        }
        .opacity(isStarting ? 0.5 : 1)
        .allowsHitTesting(!isStarting)
    }

    private func choice(title: String, sub: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: V5.S.s2) {
                Text(title)
                    .font(.faffText(16, weight: .semibold))
                    .foregroundStyle(V5.textPrimary)
                Text(sub)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, V5.S.s16)
            .padding(.horizontal, V5.S.tilePad)
            .background(V5.materialTile,
                        in: RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
        }
        .buttonStyle(V5PressStyle())
    }
}
