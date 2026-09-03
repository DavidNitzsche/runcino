//
//  RunLobbyV5.swift
//  faff.run iPhone · the Run tab — how to execute and record today's workout.
//
//  ─────────────────────────────────────────────────────────────────────────
//  TAB OWNERSHIP (2026-09-03 correction, replaces this file's earlier framing)
//
//  Today and Run answer two different questions, and this file only answers
//  the second one:
//
//    Today · what am I doing and why — purpose, full structure, actionable
//            HR guidance, race strategy. Owns no start control at all.
//    Run   · how will I execute and record it — a COMPACT confirmation of
//            the same canonical workout, one execution cue, and the three
//            explicit choices (Apple Watch / Outdoor on iPhone / Treadmill).
//
//  RUN, was: a filled tab-bar pill that opened this content as a bottom
//  sheet OVER whichever tab the runner was on. That made Run read as
//  something Today launched, which is exactly the mixing David called out
//  ("wtf is all this?", then "None of this is needed. The runs start from
//  the watch"). Run is now a real fourth destination (`ShellV5.swift`'s
//  `FaffTabV5.run`), a peer of Today/Block/Races — tapping it selects the
//  tab, the way tapping any other one does, and Today never presents
//  anything related to starting or recording a run.
//
//  DEVICE READINESS IS NOT A GATE, RECORDING CHOICE IS EXPLICIT — an even
//  earlier version also carried a "Before you start" checklist (who
//  records, HR source, location) and an AUTOMATIC watch-vs-phone owner
//  resolution. Both are gone. The runner picks Apple Watch, Outdoor, or
//  Treadmill directly; an unreachable watch renders as a compact blocked
//  state with Retry, never a silent hand-off to the phone.
//
//  MISMATCH RISK THIS CLOSES
//
//  `TodayHostV5` lets a runner step to any day via the week strip and fully
//  render that day's workout. Run is a fixed destination, completely
//  disconnected from whatever day Today is showing, and `LiveRunHostV5.task`
//  fetches `API.fetchWatchWorkout()` unconditionally — the server's literal
//  "today," never whatever date Today happens to be previewing. A runner who
//  steps to tomorrow's workout to look at it, then switches to Run, must
//  never see or start tomorrow's workout by mistake.
//
//  A run can only ever be recorded NOW, so the fix is not "let Run start a
//  different day" — it is: **this screen fetches and shows exactly the
//  workout that is about to start**, so a mismatch between "what I was
//  looking at on Today" and "what I'm about to run" is structurally
//  impossible rather than merely unlikely. `PendingRunPlanV5` below then
//  hands that SAME fetched object to `LiveRunHostV5`, so what was shown and
//  what starts are guaranteed to be one read, not two.
//

import SwiftUI

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

/// Whether the watch is genuinely ready to take today's workout — used to
/// gate the Run tab's Apple Watch tile (tappable vs. a compact blocked
/// state), NOT to automatically pick a recorder any more (2026-09-03
/// correction). The runner's tap on Apple Watch / Outdoor / Treadmill IS the
/// recording-owner decision now; nothing here overrides it or infers one on
/// the runner's behalf. `.watch`/`.phone` names what CAN execute, not what
/// WILL — `LiveRunHostV5` reads the explicit `LiveRunMode` the tap produced,
/// never this type, when it actually decides which console to render.
enum RunLobbyRecordingOwner: Equatable {
    /// A compatible, reachable watch holds (or is about to receive) the
    /// canonical workout — the Apple Watch tile is a live choice.
    case watch
    /// No usable watch, or one that cannot be confirmed to hold today's
    /// workout — the Apple Watch tile renders as a compact blocked state
    /// with Retry instead. Outdoor and Treadmill remain explicit choices
    /// regardless, per "optional watch absence must never block a run."
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

// MARK: - Segment preview (pure, testable)

/// One scannable row in the lobby's structure preview — never a sentence
/// encoding the whole workout, per the pre-run design rule. Repeats collapse
/// to "N ×" instead of listing every rep, the way the design's own group
/// tiles do on Today.
struct RunLobbySegmentGroup: Identifiable, Equatable {
    let id: Int
    let title: String
    let detail: String?
    /// True when this row's HR (if any) is `.observational` — too short a
    /// rep for HR to reach the effort, per `WatchPhase.hrRole`. 2026-09-03
    /// correction: `detail(_:)` now DROPS an observational bpm from `detail`
    /// entirely rather than relabelling it, so this flag no longer changes
    /// anything the runner sees — it is kept as the internal record of the
    /// classification surviving grouping ("preserve the canonical semantic
    /// distinction internally, but do not surface non-actionable precision").
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

    /// HR-ROLE-1 (2026-09-03 correction) · an `.observational` bpm is DROPPED
    /// from the row entirely rather than relabelled ("reads N"). David,
    /// direct: showing a precise number and then telling the runner not to
    /// use it "creates false importance" — the earlier "reads N" wording
    /// still put a number beside every short rep, which is the exact
    /// impression this fix exists to remove. The workout-level caution
    /// (`executionGuidanceLines`, once per session) is where "heart rate
    /// will lag these reps" belongs; the row itself just states pace and
    /// length. `.target` HR (a session ceiling or a rep long enough for HR
    /// to actually govern) still renders — this only silences the
    /// non-actionable case.
    private static func detail(_ p: WatchPhase) -> String? {
        var parts: [String] = []
        if let pace = p.targetPaceSPerMi {
            parts.append(Units.formatPace(secPerMile: pace))
        }
        if let hr = p.hrTargetBpm, p.effectiveHrRole == .target {
            parts.append("HR \(hr)")
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

// MARK: - The Run tab

/// The Run tab's root content (`ShellV5.swift`'s `FaffTabV5.run`). Not a
/// sheet, not launched from Today — a real fourth destination the runner
/// switches to. `RunPickerV5` (`ShellV5.swift`) is left in place only as a
/// `GalleryV5` component reference; it has had no real call site since this
/// file replaced it.
struct RunLobbyV5: View {
    /// Decision 1, explicit choice (2026-09-03 correction) — three distinct
    /// actions, one per execution path, never an automatic owner resolution
    /// the runner did not ask for. `onCancel` is gone: Run is a tab now, not
    /// a dismissible sheet, so there is nothing to cancel back out of — the
    /// runner just taps a different tab.
    let onWatch: () -> Void
    let onOutdoor: () -> Void
    let onTreadmill: () -> Void

    @ObservedObject private var watchSync = WatchSync.shared
    @State private var workoutState: RunLobbyWorkoutState = .loading
    /// Double-tap guard, and what disables the start tiles while a re-fetch
    /// is verifying nothing changed underneath the lobby.
    @State private var isStarting = false
    /// Set when the pre-start re-verification finds the prescription differs
    /// from what was shown — `workoutState` is updated to the fresh read
    /// FIRST, so this alert's "review" action is reviewing the real update,
    /// not a stale display of the old one.
    @State private var planChanged = false

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s20) {
            workoutSection
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
    /// approved reschedule, or an adaptation can land while the Run tab sits
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

    /// Fetches the workout only — no coach-purpose read any more (2026-09-03
    /// correction). "What am I doing and why" is Today's question to answer;
    /// Run confirms exactly what is about to start and how to execute it.
    private func loadWorkout() async {
        do {
            if let w = try await API.fetchWatchWorkout() {
                workoutState = .ready(w)
            } else {
                workoutState = .none
            }
        } catch {
            workoutState = .failed
        }
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

    /// Confirmation only (2026-09-03 correction) — identity, distance and
    /// duration, structure, and ONE execution cue. No purpose paragraph (Run
    /// does not own "why," Today does), and for a race day, no HR ladder or
    /// fueling prose (those stay on Today and Races) — just enough to
    /// confirm which race this is and the pacing strategy for it.
    private func workoutCard(_ w: WatchWorkout) -> some View {
        let title = RunLobbyTitle.split(w.name)
        return VStack(alignment: .leading, spacing: V5.S.s8) {
            // 1 · exact workout being started
            V5SectionLabel(text: "Today", color: V5.textQuiet, size: TypeScaleV5.label12)
            Text(title.headline)
                .font(.faffDisplay(20))
                .foregroundStyle(V5.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            // Distance and duration together, one line — the confirmation a
            // runner glancing at this screen actually needs, not a second
            // heading's worth of prose.
            if w.distanceMi != nil || w.totalEstimatedMinutes > 0 {
                Text(headerLine(w))
                    .font(.faffText(TypeScaleV5.body15))
                    .foregroundStyle(V5.textSecondary)
            }

            if w.isRace {
                raceConfirmation(w)
            } else {
                segmentPreview(w.phases)
                    .padding(.top, V5.S.s4)
            }

            // The one concise execution cue — never a second paragraph
            // beside it. `RunLobbySegments.hasObservationalHr` still fires
            // its own short caution (HR-ROLE-1), because "don't chase this
            // number" is itself execution-relevant, not coaching prose.
            let guidance = executionGuidanceLines(w)
            if !guidance.isEmpty {
                VStack(alignment: .leading, spacing: V5.S.s4) {
                    ForEach(Array(guidance.enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .font(.faffText(TypeScaleV5.label13, weight: .medium))
                            .foregroundStyle(V5.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.top, V5.S.s4)
            }
        }
        .padding(V5.S.tilePad)
        .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
    }

    private func headerLine(_ w: WatchWorkout) -> String {
        var parts: [String] = []
        if let mi = w.distanceMi {
            parts.append(Units.formatDistance(miles: mi) + " " + Units.distanceLabel())
        }
        if w.totalEstimatedMinutes > 0 {
            parts.append("approximately \(w.totalEstimatedMinutes) min")
        }
        return parts.joined(separator: " · ")
    }

    /// The coach's own cue — the one execution-relevant sentence Run keeps —
    /// plus, only when it applies, the short-rep HR caution. Never a session
    /// HR ceiling here: "keep HR under N" is a live constraint worth stating
    /// once, and Today already states it as part of "actionable HR
    /// guidance" — repeating it here is exactly the duplication David flagged.
    private func executionGuidanceLines(_ w: WatchWorkout) -> [String] {
        var lines: [String] = []
        if let cue = w.cue, !cue.isEmpty { lines.append(cue) }
        if RunLobbySegments.hasObservationalHr(w.phases) {
            lines.append("Run by effort and form. Heart rate will lag these short reps.")
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
                            .foregroundStyle(V5.textSecondary)
                            .multilineTextAlignment(.trailing)
                    }
                }
            }
        }
    }

    /// Race day's compact confirmation — name is already the headline above;
    /// this adds only the goal (kept as its own line, per Rule 16 never
    /// merged with anything else) and the pacing strategy. HR ladder and
    /// fueling are deliberately absent: those are the fuller brief, and the
    /// fuller brief lives on Today and the race detail screen, not here.
    private func raceConfirmation(_ w: WatchWorkout) -> some View {
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
    }

    // MARK: - Execution choices

    private var watchReadiness: RunLobbyWatchReadiness {
        .resolve(isPaired: watchSync.isPaired,
                 isWatchAppInstalled: watchSync.isWatchAppInstalled,
                 isReachable: watchSync.isReachable,
                 lastSyncStatus: watchSync.lastSyncStatus)
    }

    /// Whether the watch tile is a live choice or a compact blocked state.
    /// Reuses the exact bar Decision 1 always used for "does the watch
    /// genuinely have today's workout" — a reachable watch with no
    /// confirmed sync is not enough, for the same reason it never was: it
    /// proves the watch can be TALKED to, not that it holds anything to
    /// execute.
    private var watchCanExecute: Bool { RunLobbyRecordingOwner.resolve(watchReadiness) == .watch }

    private var watchStatusLine: String {
        switch watchReadiness {
        case .noWatch:       return "No Apple Watch paired."
        case .notInstalled:  return "Faff isn't installed on your watch."
        case .unreachable:   return "Not reachable right now."
        case .ready:         return "Hasn't confirmed today's workout yet."
        }
    }

    @ViewBuilder
    private var startSection: some View {
        let unstructured = workoutState.hasNoCanonicalWorkout
        VStack(alignment: .leading, spacing: V5.S.s12) {
            if case .failed = workoutState {
                FaffButton("Retry workout", variant: .secondary, size: .md,
                           action: { Task { workoutState = .loading; await loadWorkout() } })
            }

            // "Apple Watch is my normal path... but do not silently choose
            // the phone merely because the Watch is temporarily
            // unreachable" — an unreachable/unpaired/unsynced watch renders
            // as a compact status with Retry, NEVER as a tappable choice
            // that would quietly hand off to the phone instead.
            if watchCanExecute {
                choice(title: unstructured ? "Start unstructured · Apple Watch" : "Apple Watch",
                       sub: "Executes and records on your watch",
                       action: { Task { await start(onWatch) } })
            } else {
                watchBlockedRow
            }
            choice(title: unstructured ? "Start unstructured · Outdoor" : "Outdoor on iPhone",
                   sub: unstructured ? "GPS pace and route, no plan" : "GPS pace and route",
                   action: { Task { await start(onOutdoor) } })
            choice(title: unstructured ? "Start unstructured · Treadmill" : "Treadmill",
                   sub: unstructured ? "Speed and incline, no plan" : "Speed and incline, no GPS",
                   action: { Task { await start(onTreadmill) } })

            // PICKERTRUTH-1 · gated on the same fact the live screen
            // reads, so this screen cannot promise what the build cannot
            // do. Kept verbatim from RunPickerV5 rather than restated,
            // per Rule 17 — one wording for one fact.
            Text(PhoneRunTracker.backgroundRecordingAvailable
                 ? "An outdoor run keeps recording with your screen locked and the phone in a pocket. Closing the app ends it."
                 : "This build can only record while the app is open. Keep the screen on until you end the run.")
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textQuiet)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, V5.S.s4)
        }
        .opacity(isStarting ? 0.5 : 1)
        .allowsHitTesting(!isStarting)
    }

    private var watchBlockedRow: some View {
        HStack(alignment: .top, spacing: V5.S.s12) {
            VStack(alignment: .leading, spacing: V5.S.s2) {
                Text("Apple Watch")
                    .font(.faffText(16, weight: .semibold))
                    .foregroundStyle(V5.textPrimary)
                Text(watchStatusLine)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            if watchReadiness.offersRetry {
                FaffButton("Retry", variant: .secondary, size: .md, full: false,
                           action: { Task { await WatchSync.shared.refresh(force: true) } })
            }
        }
        .padding(.vertical, V5.S.s16)
        .padding(.horizontal, V5.S.tilePad)
        .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
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
