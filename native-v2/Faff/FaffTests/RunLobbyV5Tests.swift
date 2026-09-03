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
        XCTAssertFalse(r.offersRetry, "already ready — nothing for a retry to fix")
    }

    func test_unreachableIsTheOnlyRetryableState() {
        let r = RunLobbyWatchReadiness.resolve(isPaired: true, isWatchAppInstalled: true,
                                                isReachable: false, lastSyncStatus: "Watch fetch error: offline")
        XCTAssertEqual(r, .unreachable(lastSync: "Watch fetch error: offline"))
        XCTAssertTrue(r.offersRetry)
    }
}

// MARK: - Decision 1 · recording owner, and the corrected HR/recording lines

final class RunLobbyRecordingOwnerTests: XCTestCase {
    func test_syncedReachableWatchOwns() {
        let owner = RunLobbyRecordingOwner.resolve(.ready(lastSync: "Synced 9:00 AM"))
        XCTAssertEqual(owner, .watch)
    }

    func test_reachableButNeverSyncedFallsBackToPhone() {
        // Reachable alone proves the watch CAN be talked to, not that it
        // HAS today's workout — the exact gap this task is about.
        let owner = RunLobbyRecordingOwner.resolve(.ready(lastSync: nil))
        XCTAssertEqual(owner, .phone)
    }

    func test_reachableWithAFailedSyncStatusFallsBackToPhone() {
        let owner = RunLobbyRecordingOwner.resolve(.ready(lastSync: "Watch context error: offline"))
        XCTAssertEqual(owner, .phone, "a non-'Synced' status string must not be read as success")
    }

    func test_everyNonReadyStateOwnsOnThePhone() {
        for r in [RunLobbyWatchReadiness.noWatch, .notInstalled, .unreachable(lastSync: "Synced 9:00 AM")] {
            XCTAssertEqual(RunLobbyRecordingOwner.resolve(r), .phone)
        }
    }
}

final class RunLobbyRecordingLineTests: XCTestCase {
    func test_watchOwnerStatesExecutionAndRecording() {
        let line = RunLobbyRecordingLine.resolve(owner: .watch, watch: .ready(lastSync: "Synced 9:00 AM"))
        XCTAssertTrue(line.line.contains("Apple Watch"))
        XCTAssertTrue(line.line.contains("execute"))
        XCTAssertFalse(line.offersWatchRetry, "already executing on watch — nothing to retry")
    }

    func test_noWatchAtAllNamesNoWatchWithNoRetry() {
        let line = RunLobbyRecordingLine.resolve(owner: .phone, watch: .noWatch)
        XCTAssertTrue(line.line.contains("phone"))
        XCTAssertFalse(line.line.contains("Apple Watch"), "must not mention a watch that does not exist")
        XCTAssertFalse(line.offersWatchRetry)
    }

    func test_unreachableWatchOffersRetryAndNamesTheReason() {
        let line = RunLobbyRecordingLine.resolve(owner: .phone, watch: .unreachable(lastSync: "Synced 8:00 AM"))
        XCTAssertTrue(line.line.contains("not reachable"))
        XCTAssertTrue(line.offersWatchRetry)
    }

    func test_reachableButUnsyncedWatchNamesThatSpecificReason() {
        let line = RunLobbyRecordingLine.resolve(owner: .phone, watch: .ready(lastSync: nil))
        XCTAssertTrue(line.line.contains("hasn't confirmed"))
        XCTAssertTrue(line.offersWatchRetry)
    }
}

final class RunLobbyHrLineTests: XCTestCase {
    func test_watchOwnerMeansHrConnected() {
        XCTAssertEqual(RunLobbyHrLine.resolve(owner: .watch), .connectedFromWatch)
        XCTAssertTrue(RunLobbyHrLine.resolve(owner: .watch).line.contains("Apple Watch"))
    }

    func test_phoneOwnerNeverClaimsHrFromDeviceChoiceAlone() {
        // This is the corrected-bug case: "no watch" must not be rendered as
        // "recording and heart rate are on your phone" — an iPhone does not
        // inherently provide running heart rate.
        let hr = RunLobbyHrLine.resolve(owner: .phone)
        XCTAssertEqual(hr, .unavailable)
        XCTAssertTrue(hr.line.lowercased().contains("unavailable"))
        XCTAssertFalse(hr.line.contains("connected"), "must not claim a connection that was not verified")
    }
}

final class RunLobbyTitleTests: XCTestCase {
    func test_splitsHeadlineFromDescriptorAtAtSign() {
        let (headline, descriptor) = RunLobbyTitle.split("10\u{00D7}60s hills @ 5K-10K effort \u{00B7} 2 min jog down")
        XCTAssertEqual(headline, "10\u{00D7}60s hills")
        XCTAssertEqual(descriptor, "5K-10K effort \u{00B7} 2 min jog down")
    }

    func test_noAtSignReturnsWholeNameAsHeadlineWithNoDescriptor() {
        let (headline, descriptor) = RunLobbyTitle.split("Easy run")
        XCTAssertEqual(headline, "Easy run")
        XCTAssertNil(descriptor)
    }

    func test_neverProducesAnEmptyHeadline() {
        // Pathological input (starts with " @ ") must still show something
        // rather than an empty title.
        let (headline, _) = RunLobbyTitle.split(" @ effort only")
        XCTAssertFalse(headline.isEmpty)
    }
}

final class RunLobbyPlanCheckTests: XCTestCase {
    private func workout(id: String = "wko_a", name: String = "Test") -> WatchWorkout {
        WatchWorkout(workoutId: id, name: name, summary: "S", totalEstimatedMinutes: 30,
                     phases: [WatchPhase(index: 0, type: .work, label: "Run", durationSec: 1800,
                                         targetPaceSPerMi: 480, tolerancePaceSPerMi: nil, haptic: .start)],
                     completionEndpoint: "/api/watch/workouts/complete", expiresAt: "2099-12-31T00:00:00Z")
    }

    func test_identicalWorkoutsAreUnchanged() {
        let w = workout()
        XCTAssertFalse(RunLobbyPlanCheck.prescriptionChanged(w, w))
    }

    func test_bothNilIsUnchanged() {
        XCTAssertFalse(RunLobbyPlanCheck.prescriptionChanged(nil, nil))
    }

    func test_nilVersusSomeIsChanged() {
        XCTAssertTrue(RunLobbyPlanCheck.prescriptionChanged(nil, workout()))
        XCTAssertTrue(RunLobbyPlanCheck.prescriptionChanged(workout(), nil))
    }

    func test_differentWorkoutIdIsChanged() {
        XCTAssertTrue(RunLobbyPlanCheck.prescriptionChanged(workout(id: "wko_a"), workout(id: "wko_b")))
    }

    func test_midnightRolloverLooksLikeAChangedWorkoutId() {
        // workoutId embeds the date server-side (`<uid>-<date>`) — this test
        // does not assume that format, it only asserts that ANY id change
        // (which a rollover produces) is caught, which is what actually
        // matters here.
        XCTAssertTrue(RunLobbyPlanCheck.prescriptionChanged(
            workout(id: "u1-2026-09-03"), workout(id: "u1-2026-09-04")))
    }

    func test_readinessScoreAloneIsNotAPlanChange() {
        // Envelope/telemetry metadata (readinessScore, readinessLabel,
        // expiresAt) can legitimately differ between two fetches moments
        // apart with nothing about the WORKOUT having changed — comparing
        // them would manufacture a false "the plan changed" on every
        // routine re-check.
        let a = WatchWorkout(workoutId: "w1", name: "N", summary: "S", totalEstimatedMinutes: 30,
                              phases: [], completionEndpoint: "e", expiresAt: "2099-01-01T00:00:00Z",
                              readinessScore: 70, readinessLabel: "READY")
        let b = WatchWorkout(workoutId: "w1", name: "N", summary: "S", totalEstimatedMinutes: 30,
                              phases: [], completionEndpoint: "e", expiresAt: "2099-01-01T01:00:00Z",
                              readinessScore: 55, readinessLabel: "MODERATE")
        XCTAssertFalse(RunLobbyPlanCheck.prescriptionChanged(a, b))
    }

    func test_differentPhasesIsChanged() {
        let a = workout()
        var b = a
        // Equatable structs are value types — build a genuinely different
        // phases array rather than mutating `a`'s in place.
        let differentPhase = WatchPhase(index: 0, type: .work, label: "Run", durationSec: 900,
                                         targetPaceSPerMi: 480, tolerancePaceSPerMi: nil, haptic: .start)
        b = WatchWorkout(workoutId: a.workoutId, name: a.name, summary: a.summary,
                          totalEstimatedMinutes: a.totalEstimatedMinutes, phases: [differentPhase],
                          completionEndpoint: a.completionEndpoint, expiresAt: a.expiresAt)
        XCTAssertTrue(RunLobbyPlanCheck.prescriptionChanged(a, b))
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

    private func workout(id: String = "wko_test") -> WatchWorkout {
        WatchWorkout(workoutId: id, name: "Test", summary: "S",
                     totalEstimatedMinutes: 30,
                     phases: [WatchPhase(index: 0, type: .work, label: "Run", durationSec: 1800,
                                         targetPaceSPerMi: 480, tolerancePaceSPerMi: nil, haptic: .start)],
                     completionEndpoint: "/api/watch/workouts/complete",
                     expiresAt: "2099-12-31T00:00:00Z")
    }

    @MainActor
    override func setUp() {
        super.setUp()
        // The test seam, not manual draining — a prior test's leftover
        // snapshot must never leak into this one's assertions.
        #if DEBUG
        PendingRunPlanV5.shared.resetForTesting()
        #endif
    }

    @MainActor
    func test_recordedWorkoutIsConsumedExactlyOnce() {
        let holder = PendingRunPlanV5.shared
        let w = workout()
        holder.record(.workout(w), dateISO: "2026-09-03")

        guard case .some(.workout(let consumed)) = holder.consume(expectedDateISO: "2026-09-03") else {
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
        holder.record(.none, dateISO: "2026-09-03")
        guard case .some(.none) = holder.consume() else {
            return XCTFail("a clean 'no workout today' answer must survive to be read back")
        }
    }

    @MainActor
    func test_neverRecordedConsumesToNil() {
        XCTAssertNil(PendingRunPlanV5.shared.consume())
    }

    @MainActor
    func test_staleSnapshotIsNotHandedToADifferentRun() {
        // A snapshot captured long enough ago (the runner opened the lobby,
        // walked away, and started a run through some other path much later)
        // must not be handed forward as if it were fresh — the console falls
        // through to its own fetch instead.
        let holder = PendingRunPlanV5.shared
        holder.record(.workout(workout()), dateISO: "2026-09-03")
        // A negative maxAge, not zero: `Date()` calls microseconds apart can
        // report a genuinely zero elapsed interval on a fast run, which made
        // `maxAge: 0` a flaky assertion (elapsed <= 0 sometimes true rather
        // than false). Negative forces "stale" deterministically, since
        // elapsed is never negative.
        XCTAssertNil(holder.consume(maxAge: -1), "a negative maxAge must treat any prior capture as stale")
    }

    @MainActor
    func test_aSnapshotFromAnotherDateNeverReachesStart() {
        // The guard against a cached workout from another date or plan
        // version ever starting — a midnight rollover between the lobby
        // opening and Start running is otherwise invisible to a pure
        // elapsed-time check, since the snapshot can still be young in
        // wall-clock terms.
        let holder = PendingRunPlanV5.shared
        holder.record(.workout(workout()), dateISO: "2026-09-03")
        XCTAssertNil(holder.consume(expectedDateISO: "2026-09-04"),
                     "a snapshot recorded for a different date must never be handed to Start")
    }

    @MainActor
    func test_matchingExpectedDateConsumesNormally() {
        let holder = PendingRunPlanV5.shared
        holder.record(.workout(workout()), dateISO: "2026-09-03")
        XCTAssertNotNil(holder.consume(expectedDateISO: "2026-09-03"))
    }

    @MainActor
    func test_noExpectedDateSkipsTheDateCheck() {
        // LiveRunHostV5 always passes one, but the parameter is optional —
        // omitting it must not silently refuse an otherwise-valid snapshot.
        let holder = PendingRunPlanV5.shared
        holder.record(.workout(workout()), dateISO: "2026-09-03")
        XCTAssertNotNil(holder.consume())
    }

    @MainActor
    func test_aDateMismatchAlsoClearsTheSnapshotRatherThanLeavingItStuck() {
        let holder = PendingRunPlanV5.shared
        holder.record(.workout(workout()), dateISO: "2026-09-03")
        _ = holder.consume(expectedDateISO: "2026-09-04") // refused
        XCTAssertNil(holder.consume(expectedDateISO: "2026-09-03"),
                     "a refused snapshot must not linger for a later, unrelated consume to pick up")
    }
}

// MARK: - Decision 1 · the phone's own completion identity

final class PhoneRunTrackerCanonicalIdTests: XCTestCase {
    func test_directCanonicalIdWins() {
        let id = PhoneRunTracker.resolveStartWorkoutId(canonical: "u1-2026-09-03", pending: "u1-2026-09-02")
        XCTAssertEqual(id, "u1-2026-09-03")
    }

    func test_pendingIsUsedWhenNoDirectCanonicalId() {
        // The deferred-permission path: Start ran before authorization
        // landed, and the re-invocation from
        // `locationManagerDidChangeAuthorization` calls `start()` with no
        // argument — losing the ORIGINAL call's canonical id here would
        // silently fall back to a synthetic id on exactly the runs most
        // likely to be a runner's first-ever session.
        let id = PhoneRunTracker.resolveStartWorkoutId(canonical: nil, pending: "u1-2026-09-03")
        XCTAssertEqual(id, "u1-2026-09-03")
    }

    func test_bothNilProducesASyntheticPhoneId() {
        let id = PhoneRunTracker.resolveStartWorkoutId(canonical: nil, pending: nil)
        XCTAssertTrue(id.hasPrefix("phone_"), "an unstructured run must still get SOME id: \(id)")
    }
}
