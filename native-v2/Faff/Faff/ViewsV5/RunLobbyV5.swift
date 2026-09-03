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

    enum Snapshot {
        /// A real workout, fetched and about to start.
        case workout(WatchWorkout)
        /// The fetch answered — cleanly — with "no workout today" (rest day,
        /// off-plan). Distinct from `nil` (never fetched / already consumed)
        /// per Rule 11: "no data" and "didn't ask" are different facts.
        case none
    }

    private var snapshot: Snapshot?
    private var capturedAt: Date = .distantPast

    func record(_ s: Snapshot) {
        snapshot = s
        capturedAt = Date()
    }

    /// Consumes the held snapshot if it is still fresh enough to describe
    /// "now" — the lobby's fetch and the console's own read are the same
    /// instant only as long as the runner acts on the lobby promptly.  Ten
    /// minutes covers a runner who reads the lobby, ties their shoes, and
    /// taps Start; past that, a fresh fetch is more honest than a held one.
    func consume(maxAge: TimeInterval = 600) -> Snapshot? {
        guard let snapshot, Date().timeIntervalSince(capturedAt) <= maxAge else { return nil }
        self.snapshot = nil
        return snapshot
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

    /// One line, stated plainly — never a promise the build can't back up.
    var line: String {
        switch self {
        case .noWatch:
            return "No Apple Watch paired. Recording and heart rate are on your phone."
        case .notInstalled:
            return "Faff isn't installed on your watch. Recording and heart rate are on your phone."
        case .ready(let lastSync):
            return "Watch connected" + (lastSync.map { " · \($0)" } ?? "") + "."
        case .unreachable(let lastSync):
            return "Watch not reachable right now" + (lastSync.map { " · last \($0)" } ?? "") + ". Recording continues on your phone."
        }
    }

    /// Only the unreachable case has anything a retry could fix — a genuinely
    /// absent or uninstalled watch has no connection to retry.
    var offersRetry: Bool { if case .unreachable = self { return true }; return false }
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
        case .denied:         return "Location is off. Outdoor pace and route need it — enable it in Settings, or run Treadmill instead."
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

    private static func detail(_ p: WatchPhase) -> String? {
        var parts: [String] = []
        if let pace = p.targetPaceSPerMi {
            parts.append(Units.formatPace(secPerMile: pace))
        }
        if let hr = p.hrTargetBpm {
            parts.append("HR ~\(hr)")
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

        func emit(title: String, detail: String?) {
            rows.append(RunLobbySegmentGroup(id: nextId, title: title, detail: detail))
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
                emit(title: title, detail: pieces.isEmpty ? nil : pieces.joined(separator: " · "))
                i = j
                grouped = true
                break
            }
            if !grouped {
                emit(title: p.label.isEmpty ? p.type.rawValue.capitalized : p.label,
                     detail: [length(p), detail(p)].compactMap { $0 }.joined(separator: " · "))
                i += 1
            }
        }
        return rows
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
            lines.append("Late miles may drift up to \(hr.lateAllowanceBpm) bpm as you close — that's expected, not a fault.")
        }
        if let checkpointMi = hr.checkpointMi, let abortBpm = hr.checkpointAbortBpm {
            lines.append("If HR is over \(abortBpm) bpm at mile \(String(format: "%.0f", checkpointMi)), back off the goal pace and finish easy.")
        }
        return lines
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

    private var watchReadiness: RunLobbyWatchReadiness {
        .resolve(isPaired: watchSync.isPaired,
                 isWatchAppInstalled: watchSync.isWatchAppInstalled,
                 isReachable: watchSync.isReachable,
                 lastSyncStatus: watchSync.lastSyncStatus)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s20) {
            workoutSection
            readinessSection
            VStack(alignment: .leading, spacing: V5.S.s16) {
                choice(title: "Outdoor", sub: "GPS pace and route", action: { start(onOutdoor) })
                choice(title: "Treadmill", sub: "Speed and incline, no GPS", action: { start(onTreadmill) })

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
        }
        .task { await loadWorkout() }
    }

    // MARK: Start — record the shown plan so the console reads the SAME one

    private func start(_ go: @escaping () -> Void) {
        switch workoutState {
        case .ready(let w): PendingRunPlanV5.shared.record(.workout(w))
        case .none:         PendingRunPlanV5.shared.record(.none)
        case .loading, .failed: break // nothing to hand forward; the console fetches its own
        }
        go()
    }

    private func loadWorkout() async {
        locationReadiness = .resolve(CLLocationManager().authorizationStatus)
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
            ErrorNote(text: "Couldn't load today's workout. You can still run without a target.",
                      onRetry: { Task { workoutState = .loading; await loadWorkout() } })
        case .none:
            Silence(reason: "Nothing scheduled today. This will record as a free run.")
        case .ready(let w):
            workoutCard(w)
        }
    }

    private func workoutCard(_ w: WatchWorkout) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s12) {
            HStack(alignment: .firstTextBaseline) {
                V5SectionLabel(text: "Today · about to start", color: V5.textQuiet, size: TypeScaleV5.label12)
                Spacer(minLength: 0)
                if let mi = w.distanceMi {
                    Text(Units.formatDistance(miles: mi) + " " + Units.distanceLabel())
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textSecondary)
                }
            }
            Text(w.name)
                .font(.faffDisplay(20))
                .foregroundStyle(V5.textPrimary)

            if w.isRace {
                raceBrief(w)
            } else {
                if let cue = w.cue, !cue.isEmpty {
                    Text(cue)
                        .font(.faffText(TypeScaleV5.body15))
                        .foregroundStyle(V5.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let ceiling = w.hrCeilingBpm {
                    Text("Keep heart rate under \(ceiling) bpm.")
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.attention)
                }
                segmentPreview(w.phases)
            }
        }
        .padding(V5.S.tilePad)
        .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
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

    // MARK: - Device readiness

    private var readinessSection: some View {
        VStack(alignment: .leading, spacing: V5.S.s8) {
            V5SectionLabel(text: "Before you start", color: V5.textQuiet, size: TypeScaleV5.label12)
            readinessRow(text: watchReadiness.line,
                         warn: watchReadiness.offersRetry,
                         retry: watchReadiness.offersRetry ? { Task { await WatchSync.shared.refresh(force: true) } } : nil)
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
                .padding(.top, 5)
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
