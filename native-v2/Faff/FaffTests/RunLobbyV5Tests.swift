//
//  RunLobbyV5Tests.swift
//  faff.run iPhone · pre-run lobby (RunLobbyV5) — the logic behind the sheet
//  the runner sees right before tapping Start.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT THIS COVERS, AND WHY IT IS SPLIT OUT AS PURE FUNCTIONS
//
//  `RunLobbyV5`'s SwiftUI body has no test target of its own — nothing in
//  this app's view layer does. So every decision the lobby makes (watch
//  readiness wording, location wording, segment grouping, race brief,
//  whether a fetched workout survives to the console) is factored into a
//  pure, non-SwiftUI type it can be exercised here, per this codebase's own
//  Rule 15: a mechanism no test can reach is untested however many screens
//  render it.
//
//  `PendingRunPlanV5` is the correctness-critical piece: it is what
//  guarantees the workout the lobby SHOWED and the workout `LiveRunHostV5`
//  STARTS are one fetch, not two independent ones that could disagree.
//
import XCTest
@testable import Faff

final class RunLobbyWatchReadinessTests: XCTestCase {

    func test_noWatchPairedAtAll() {
        let r = RunLobbyWatchReadiness.resolve(isPaired: false, isWatchAppInstalled: false,
                                                isReachable: false, lastSyncStatus: nil)
        XCTAssertEqual(r, .noWatch)
        XCTAssertFalse(r.offersRetry, "nothing to retry when there is no watch")
    }

    func test_pairedButAppNotInstalled() {
        // Contradictory-looking input (paired, but somehow "reachable" true)
        // must not leak through — installed gates before reachable does.
        let r = RunLobbyWatchReadiness.resolve(isPaired: true, isWatchAppInstalled: false,
                                                isReachable: true, lastSyncStatus: "Synced 9:00 AM")
        XCTAssertEqual(r, .notInstalled)
        XCTAssertFalse(r.offersRetry)
    }

    func test_readyWhenPairedInstalledAndReachable() {
        let r = RunLobbyWatchReadiness.resolve(isPaired: true, isWatchAppInstalled: true,
                                                isReachable: true, lastSyncStatus: "Synced 9:00 AM")
        XCTAssertEqual(r, .ready(lastSync: "Synced 9:00 AM"))
        XCTAssertTrue(r.line.contains("Synced 9:00 AM"))
        XCTAssertFalse(r.offersRetry, "already ready — nothing for a retry to fix")
    }

    func test_unreachableIsTheOnlyRetryableState() {
        let r = RunLobbyWatchReadiness.resolve(isPaired: true, isWatchAppInstalled: true,
                                                isReachable: false, lastSyncStatus: "Watch fetch error: offline")
        XCTAssertEqual(r, .unreachable(lastSync: "Watch fetch error: offline"))
        XCTAssertTrue(r.offersRetry)
        XCTAssertTrue(r.line.contains("phone"), "must state the phone fallback plainly, never a bare error")
    }

    func test_neverPromisesAWatchOutcomeWithNoWatch() {
        // Never start another date's workout / never claim a capability the
        // build hasn't verified — applied here as "never say 'watch connected'
        // for a phone with no watch."
        for readiness in [RunLobbyWatchReadiness.noWatch, .notInstalled] {
            XCTAssertFalse(readiness.line.lowercased().contains("connected"))
        }
    }
}

final class RunLobbyLocationReadinessTests: XCTestCase {
    func test_deniedIsBlockingForOutdoor() {
        let r = RunLobbyLocationReadiness.resolve(.denied)
        XCTAssertTrue(r.isBlockingForOutdoor)
        XCTAssertTrue(r.line.contains("Treadmill"), "a blocked runner must be told the fallback, not just the problem")
    }

    func test_restrictedIsTreatedAsDenied() {
        XCTAssertEqual(RunLobbyLocationReadiness.resolve(.restricted), .denied)
    }

    func test_notDeterminedIsNotBlocking() {
        let r = RunLobbyLocationReadiness.resolve(.notDetermined)
        XCTAssertFalse(r.isBlockingForOutdoor, "never block a run for optional/not-yet-asked permission")
    }

    func test_authorizedIsReady() {
        let r = RunLobbyLocationReadiness.resolve(.authorizedWhenInUse)
        XCTAssertEqual(r, .authorized)
        XCTAssertFalse(r.isBlockingForOutdoor)
    }
}

final class RunLobbySegmentsTests: XCTestCase {

    private func phase(_ type: WatchPhaseType, label: String = "", durationSec: Int = 300,
                        target: Int? = nil, tolerance: Int? = nil, hr: Int? = nil,
                        repUnit: WatchRepUnit = .time, distanceMi: Double? = nil) -> WatchPhase {
        WatchPhase(index: 0, type: type, label: label, durationSec: durationSec,
                   targetPaceSPerMi: target, tolerancePaceSPerMi: tolerance, haptic: .start,
                   repUnit: repUnit, distanceMi: distanceMi, hrTargetBpm: hr)
    }

    func test_emptyPhasesProduceNoRows() {
        XCTAssertEqual(RunLobbySegments.summarize([]), [])
    }

    func test_warmupAndCooldownAreAlwaysTheirOwnUngroupedRows() {
        let phases = [
            phase(.warmup, durationSec: 600),
            phase(.work, durationSec: 1800, target: 480),
            phase(.cooldown, durationSec: 600),
        ]
        let rows = RunLobbySegments.summarize(phases)
        XCTAssertEqual(rows.count, 3)
        XCTAssertEqual(rows[0].title, "Warm-up")
        XCTAssertEqual(rows[2].title, "Cooldown")
    }

    /// The intervals shape: 4 × (800m work + 400m recovery). Phases alternate
    /// work/recovery, so a naive "group consecutive identical phases" would
    /// never group anything — this is the case that motivated pattern-length-2
    /// grouping rather than plain run-length encoding.
    func test_fourByEightHundredCollapsesToOneGroupedRow() {
        let work = phase(.work, label: "Interval", durationSec: 200, target: 390, hr: 168,
                          repUnit: .distance, distanceMi: 0.5)
        let recovery = phase(.recovery, durationSec: 120, repUnit: .distance, distanceMi: 0.25)
        let phases = [work, recovery, work, recovery, work, recovery, work, recovery]

        let rows = RunLobbySegments.summarize(phases)
        XCTAssertEqual(rows.count, 1, "four identical work+recovery pairs must collapse to one scannable row")
        XCTAssertTrue(rows[0].title.hasPrefix("4"), "the count must be visible: \(rows[0].title)")
        XCTAssertTrue(rows[0].title.contains("Interval"))
        XCTAssertNotNil(rows[0].detail)
        XCTAssertTrue(rows[0].detail!.contains("recovery"))
    }

    /// Falsified against the real account this feature was verified on
    /// (Rule 13): production's ACTUAL wire label is
    /// `"Hill 1 of 10 \u{00B7} 1 min"` — the index sits in the MIDDLE,
    /// followed by a duration clause, not at the end. A first version of
    /// this fixture used `"Hill \(n) of 10"` (index at the end) and passed
    /// against a first version of the fix that anchored its strip to
    /// end-of-string — and the anchored version still failed to group a
    /// single real hill rep, because the real label never ends right after
    /// the index. This fixture is the exact string the render returned, not
    /// a simplification of it — the case that actually broke.
    func test_realHillWorkoutWithPerRepIndexedLabelsStillGroups() {
        let reps = (1...10).map { n in
            phase(.work, label: "Hill \(n) of 10 \u{00B7} 1 min", durationSec: 60, hr: 176)
        }
        let jog = phase(.recovery, label: "Jog 2 min", durationSec: 120)
        var phases: [WatchPhase] = []
        for rep in reps { phases.append(rep); phases.append(jog) }

        let rows = RunLobbySegments.summarize(phases)
        XCTAssertEqual(rows.count, 1, "ten indexed hill reps must still collapse to one row: \(rows.map(\.title))")
        XCTAssertTrue(rows[0].title.hasPrefix("10"), "the real count must survive: \(rows[0].title)")
        XCTAssertTrue(rows[0].title.contains("Hill"), "the descriptive word must survive the index strip: \(rows[0].title)")
        XCTAssertFalse(rows[0].title.contains("of 10"), "the per-rep index must NOT leak into the group title")
        // The title legitimately shows "1 min" once, via `length(work)` (the
        // group's own duration) — that is not what's being guarded here.
        // What must NOT happen is the raw label's "· 1 min" suffix riding
        // along unstripped, which would read as a doubled, redundant clause.
        XCTAssertFalse(rows[0].title.contains("\u{00B7}"),
                        "the label's own '· <duration>' clause must be stripped, not carried into the title: \(rows[0].title)")
    }

    /// Second defect found by the SAME real render: recovery only happens
    /// BETWEEN reps, so a 10-hill workout is work,recovery × 9 followed by a
    /// bare 10th work phase with nothing after it (then cooldown). The
    /// pair-matching loop stopped the moment it could not find a full
    /// trailing pair, so ten hills rendered as "9 × … Hill" plus a stray,
    /// ungrouped "Hill 10 of 10" row — a real count silently short by one
    /// on screen. This is the exact 10-hill shape that showed it.
    func test_trailingRepWithNoClosingRecoveryStillCountsTowardTheGroup() {
        let reps = (1...10).map { n in
            phase(.work, label: "Hill \(n) of 10 \u{00B7} 1 min", durationSec: 60, hr: 176)
        }
        var phases: [WatchPhase] = []
        for (i, rep) in reps.enumerated() {
            phases.append(rep)
            if i < reps.count - 1 { phases.append(phase(.recovery, label: "Jog 2 min", durationSec: 120)) }
        }
        phases.append(phase(.cooldown, label: "Cooldown", durationSec: 60, repUnit: .distance, distanceMi: 1.0))

        let rows = RunLobbySegments.summarize(phases)
        let workRow = rows.first { $0.title.contains("Hill") }
        XCTAssertEqual(rows.count, 2, "one grouped hill row plus the cooldown row, not a stray 10th hill: \(rows.map(\.title))")
        XCTAssertNotNil(workRow)
        XCTAssertTrue(workRow?.title.hasPrefix("10") == true,
                       "the trailing rep with no closing recovery must still count: \(workRow?.title ?? "nil")")
    }

    /// "N/M" is the other separator real or plausible payloads might use —
    /// same defect, different punctuation.
    func test_slashSeparatedIndexAlsoNormalizes() {
        let reps = (1...4).map { n in phase(.work, label: "Rep \(n)/4", durationSec: 45) }
        let rows = RunLobbySegments.summarize(reps)
        XCTAssertEqual(rows.count, 1)
        XCTAssertTrue(rows[0].title.hasPrefix("4"))
        XCTAssertFalse(rows[0].title.contains("/4"))
    }

    func test_aBareRepeatedWorkPhaseWithNoRecoveryStillGroups() {
        // Some sessions repeat a work phase with nothing between reps
        // (pattern length 1) — must not require a recovery phase to group.
        let rep = phase(.work, label: "Strides", durationSec: 20, repUnit: .distance, distanceMi: 0.06)
        let rows = RunLobbySegments.summarize([rep, rep, rep, rep, rep, rep])
        XCTAssertEqual(rows.count, 1)
        XCTAssertTrue(rows[0].title.hasPrefix("6"))
    }

    func test_singleOddSegmentIsNotFalselyGrouped() {
        let odd = phase(.work, label: "Tempo", durationSec: 1200, target: 420)
        let rows = RunLobbySegments.summarize([odd])
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].title, "Tempo")
    }

    func test_easyRunSinglePhaseNeverInventsRepsThatDoNotExist() {
        // A plain easy run expands to one `.work` phase (expand-spec.ts).
        // Grouping logic must not manufacture a "1 ×" row for it — it should
        // render as its own single, ungrouped row.
        let easy = phase(.work, label: "Easy", durationSec: 2400, target: 540)
        let rows = RunLobbySegments.summarize([easy])
        XCTAssertEqual(rows.count, 1)
        XCTAssertFalse(rows[0].title.contains("\u{00D7}"), "a single segment must never read as a rep count")
    }

    func test_differingHrTargetsPreventsAFalseGroup() {
        // Contradictory-looking canonical data (same pace, different HR
        // targets) must fail to group loudly (i.e., render as separate rows)
        // rather than silently averaging or picking one.
        let a = phase(.work, label: "Interval", durationSec: 200, target: 390, hr: 168)
        let b = phase(.work, label: "Interval", durationSec: 200, target: 390, hr: 172)
        let rows = RunLobbySegments.summarize([a, b])
        XCTAssertEqual(rows.count, 2, "phases that disagree on HR target must not be silently merged")
    }
}

final class RunLobbyRaceBriefTests: XCTestCase {
    func test_goalLineFormatsUnderAnHourAsMinSec() {
        XCTAssertEqual(RunLobbyRaceBrief.goalLine(goalSec: 22 * 60 + 30), "Goal: 22:30")
    }

    func test_goalLineFormatsOverAnHourAsHMS() {
        XCTAssertEqual(RunLobbyRaceBrief.goalLine(goalSec: 3 * 3600 + 0 * 60 + 0), "Goal: 3:00:00")
    }

    func test_noGoalProducesNoLine() {
        XCTAssertNil(RunLobbyRaceBrief.goalLine(goalSec: nil))
        XCTAssertNil(RunLobbyRaceBrief.goalLine(goalSec: 0))
    }

    func test_noRaceHrProducesNoLines() {
        XCTAssertEqual(RunLobbyRaceBrief.hrLines(nil), [])
    }

    func test_raceHrStatesTheAbortCriterionWhenPresent() {
        let hr = WatchRaceHr(expectedLoBpm: 150, expectedHiBpm: 160, earlyCeilingBpm: 155,
                              earlyThroughMi: 3, lateAllowanceBpm: 165, checkpointMi: 20,
                              checkpointAbortBpm: 175, informationalOnly: false)
        let lines = RunLobbyRaceBrief.hrLines(hr)
        XCTAssertTrue(lines.contains { $0.contains("mile 20") && $0.contains("175") },
                      "the checkpoint abort criterion must be stated explicitly, not implied")
    }

    func test_raceHrWithNoCheckpointOmitsTheAbortLine() {
        let hr = WatchRaceHr(expectedLoBpm: 150, expectedHiBpm: 160, earlyCeilingBpm: 155,
                              earlyThroughMi: 3, lateAllowanceBpm: 160, checkpointMi: nil,
                              checkpointAbortBpm: nil, informationalOnly: true)
        let lines = RunLobbyRaceBrief.hrLines(hr)
        XCTAssertFalse(lines.contains { $0.lowercased().contains("abort") || $0.lowercased().contains("back off") },
                       "must never invent an abort criterion the payload didn't send")
    }
}

final class PendingRunPlanV5Tests: XCTestCase {

    private func workout() -> WatchWorkout {
        WatchWorkout(workoutId: "wko_test", name: "Test", summary: "S",
                     totalEstimatedMinutes: 30,
                     phases: [WatchPhase(index: 0, type: .work, label: "Run", durationSec: 1800,
                                         targetPaceSPerMi: 480, tolerancePaceSPerMi: nil, haptic: .start)],
                     completionEndpoint: "/api/watch/workouts/complete",
                     expiresAt: "2099-12-31T00:00:00Z")
    }

    @MainActor
    func test_recordedWorkoutIsConsumedExactlyOnce() {
        let holder = PendingRunPlanV5.shared
        let w = workout()
        holder.record(.workout(w))

        guard case .some(.workout(let consumed)) = holder.consume() else {
            return XCTFail("expected the recorded workout back")
        }
        XCTAssertEqual(consumed.workoutId, w.workoutId)

        // Second consume must find nothing — this is what stops a STALE
        // lobby snapshot from silently answering a later, unrelated run.
        XCTAssertNil(holder.consume(), "a snapshot must not survive being consumed once")
    }

    @MainActor
    func test_noneSnapshotIsDistinctFromNeverRecorded() {
        // Rule 11: "the engine answered cleanly, no workout" and "nothing was
        // ever asked" must never collapse into the same nil.
        let holder = PendingRunPlanV5.shared
        holder.record(.none)
        guard case .some(.none) = holder.consume() else {
            return XCTFail("a clean 'no workout today' answer must survive to be read back")
        }
    }

    @MainActor
    func test_neverRecordedConsumesToNil() {
        let holder = PendingRunPlanV5.shared
        _ = holder.consume() // drain anything left by another test in this run
        XCTAssertNil(holder.consume())
    }

    @MainActor
    func test_staleSnapshotIsNotHandedToADifferentRun() {
        // A snapshot captured long enough ago (the runner opened the lobby,
        // walked away, and started a run through some other path much later)
        // must not be handed forward as if it were fresh — the console falls
        // through to its own fetch instead.
        let holder = PendingRunPlanV5.shared
        holder.record(.workout(workout()))
        // A negative maxAge, not zero: `Date()` calls microseconds apart can
        // report a genuinely zero elapsed interval on a fast run, which made
        // `maxAge: 0` a flaky assertion (elapsed <= 0 sometimes true rather
        // than false). Negative forces "stale" deterministically, since
        // elapsed is never negative.
        XCTAssertNil(holder.consume(maxAge: -1), "a negative maxAge must treat any prior capture as stale")
    }
}
