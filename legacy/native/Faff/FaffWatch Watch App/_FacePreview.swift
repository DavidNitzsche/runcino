//
//  _FacePreview.swift
//  FaffWatch
//
//  TEMPORARY review harness. `-face <name>` renders one board with fixed
//  fixtures so a screenshot is deterministic and free of engine state.
//
//  REMOVE BEFORE SHIP, together with its mount in WorkoutRootView.
//
//  A WARNING THIS FILE EARNED. The harness used to pass a band to the phase
//  boards that the router never passed, so every board reviewed on screen had
//  a gauge under the pace and every board a runner would see had none. The
//  screenshots were accurate about a screen that did not exist.
//
//  So the rule for anything added here: a fixture may only supply what the
//  router supplies. If a board needs a value to look right, the router is
//  where that value has to come from, and this file follows it.
//
//  Fixtures are deliberately UGLY. Round numbers hide width bugs — the size
//  collapse survived a twelve-cell matrix because every cell in it was short.
//  So: 10:59, 1:11:48, 5:59:59, 100.0, 204, 12:34.
//
import SwiftUI

enum FacePreview {
    static var selected: String? {
        let a = ProcessInfo.processInfo.arguments
        guard let i = a.firstIndex(of: "-face"), i + 1 < a.count else { return nil }
        return a[i + 1]
    }
}

/// Bands as the router computes them: `band(for:)` maps the prescribed window
/// onto the middle 40% of the strip, so a target of 6:20-6:45 with the runner
/// at 6:31 lands the mark just left of centre inside the lit segment.
private let inBand  = (start: 0.30, end: 0.70, marker: 0.44, inBand: true)
private let offBand = (start: 0.30, end: 0.70, marker: 0.86, inBand: false)

struct FacePreviewView: View {
    let name: String

    // SPLIT BY CATEGORY, returning AnyView. One switch over fifty boards
    // inside a ViewBuilder does not type-check in reasonable time — the
    // compiler has to unify fifty distinct result types into one opaque
    // return. AnyView erases them, and the cost is irrelevant in a harness
    // that renders one board and exits.
    var body: some View {
        running() ?? phases() ?? controls() ?? faults()
            ?? asks() ?? moments() ?? lobby() ?? finish()
            ?? AnyView(Color.black)
    }

    private func running() -> AnyView? {
        switch name {

        // MARK: Page 1

        case "p1":
            return AnyView(RunFaceV6(pace: "7:38", grade: .onTarget, band: inBand,
                      heartRate: "154", distance: "8.72", elapsed: "1:14:28"))
        case "p1drift":
            return AnyView(RunFaceV6(pace: "8:24", grade: .drifting, band: offBand,
                      heartRate: "171", distance: "12.06", elapsed: "1:41:53"))
        case "p1nohr":
            return AnyView(RunFaceV6(pace: "7:38", grade: .onTarget, band: inBand,
                      heartRate: nil, distance: "8.72", elapsed: "1:14:28"))
        case "p1tread":
            // A belt grades nothing and gets no gauge: there is no trustworthy
            // pace to put a mark on. White throughout, by rule.
            return AnyView(RunFaceV6(pace: "8:00", grade: .neutral,
                      heartRate: "142", distance: "3.10", elapsed: "24:48"))
        case "p1free":
            // A steady run with no prescribed band. Pace is measured, not
            // graded, so it is white and there is no strip.
            return AnyView(RunFaceV6(pace: "8:57", grade: .neutral,
                      heartRate: "139", distance: "6.21", elapsed: "55:36"))
        case "p1ugly":
            // Worst case in every slot at once.
            return AnyView(RunFaceV6(pace: "10:59", grade: .drifting, band: offBand,
                      heartRate: "204", distance: "100.0", elapsed: "5:59:59"))
        // MARK: Page 2

        case "p2":
            return AnyView(PerfFaceV6(cadence: "158", averagePace: "7:51",
                       power: "287", elevation: "+842"))
        case "p2min":
            // Power and climb absent. The board becomes two metrics; it never
            // draws a dash, because a dash claims the slot is working.
            return AnyView(PerfFaceV6(cadence: "204", averagePace: "12:34"))
        case "p2tread":
            return AnyView(PerfFaceV6(cadence: "176", averagePace: "9:14"))
        // MARK: Always-On

        case "upnext":
            return AnyView(RunUpNextV6(steps: [
                .init(id: 0, name: "Work", dose: "400 m", current: true),
                .init(id: 1, name: "Recovery", dose: "90 sec", current: false),
                .init(id: 2, name: "Work", dose: "400 m", current: false),
                .init(id: 3, name: "Recovery", dose: "90 sec", current: false),
                .init(id: 4, name: "Cool-down", dose: "10 min", current: false),
            ]))
        case "upnextrace":
            return AnyView(RunUpNextV6(steps: [
                .init(id: 0, name: "Hurricane climb", dose: "19:00", current: true),
                .init(id: 1, name: "Point descent", dose: "12:00", current: false),
                .init(id: 2, name: "Coast miles", dose: "52:00", current: false),
                .init(id: 3, name: "Carmel run-in", dose: "25:00", current: false),
            ]))
        case "alwayson":
            return AnyView(AlwaysOnFaceV6(pace: "7:42", grade: .onTarget,
                           distance: "5.72", elapsedMinutes: "44"))
        // MARK: Structured phases

        case "warmup":
            return AnyView(PhaseFaceV6(phase: "Warm-up", metrics: [
                WorkoutMetric(value: "4:12", role: "Time left"),
                WorkoutMetric(value: "9:31", unit: "/mi", role: "Pace"),
                WorkoutMetric(value: "128", unit: "bpm", role: "Heart rate"),
                WorkoutMetric(value: "1.06", unit: "mi", role: "Distance"),
            ]))
        case "work":
            return AnyView(PhaseFaceV6(phase: "Work", context: "3 of 6",
                        band: offBand, bandRow: 1, metrics: [
                WorkoutMetric(value: "1:12", role: "Time left in rep"),
                WorkoutMetric(value: "6:48", unit: "/mi", grade: .drifting, role: "Pace"),
                WorkoutMetric(value: "168", unit: "bpm", role: "Heart rate"),
                WorkoutMetric(value: "0.42", unit: "mi", role: "Rep distance"),
            ]))
        case "recovery":
            // Two metrics, no pace, no band. A recovery is not asking for a
            // pace and drawing one invites the runner to race it.
            return AnyView(PhaseFaceV6(phase: "Recovery", context: "3 of 6", metrics: [
                WorkoutMetric(value: "1:12", role: "Time left"),
                WorkoutMetric(value: "148", unit: "bpm", role: "Heart rate"),
            ]))
        case "strides":
            // Cadence, not pace: over twenty seconds a GPS pace is mostly lag.
            return AnyView(PhaseFaceV6(phase: "Strides", context: "4 of 8", metrics: [
                WorkoutMetric(value: "0:14", role: "Time left in stride"),
                WorkoutMetric(value: "191", unit: "spm", role: "Cadence"),
                WorkoutMetric(value: "162", unit: "bpm", role: "Heart rate"),
            ]))
        case "threshold":
            return AnyView(PhaseFaceV6(phase: "Threshold", context: "2 of 4",
                        band: inBand, bandRow: 1, metrics: [
                WorkoutMetric(value: "5:30", role: "Time left in rep"),
                WorkoutMetric(value: "6:31", unit: "/mi", grade: .onTarget, role: "Pace"),
                WorkoutMetric(value: "6:34", unit: "avg", role: "Average pace"),
                WorkoutMetric(value: "172", unit: "bpm", role: "Heart rate"),
            ]))
        case "race":
            // The graded metric is row 0 here, not row 1 — which is why the
            // router derives the band row instead of hardcoding it.
            return AnyView(PhaseFaceV6(phase: "Mile 9", context: "sub 3:30",
                        band: inBand, bandRow: 0, metrics: [
                WorkoutMetric(value: "7:52", unit: "/mi", grade: .onTarget, role: "Pace"),
                WorkoutMetric(value: "−0:22", role: "Against goal"),
                WorkoutMetric(value: "9.14", unit: "mi", role: "Distance"),
                WorkoutMetric(value: "1:11:48", role: "Elapsed"),
            ]))
        case "raceugly":
            return AnyView(PhaseFaceV6(phase: "Mile 26", context: "sub 3:30",
                        band: offBand, bandRow: 0, metrics: [
                WorkoutMetric(value: "10:59", unit: "/mi", grade: .drifting, role: "Pace"),
                WorkoutMetric(value: "+12:47", role: "Against goal"),
                WorkoutMetric(value: "26.22", unit: "mi", role: "Distance"),
                WorkoutMetric(value: "4:38:02", role: "Elapsed"),
            ]))
        // MARK: The metric-count matrix
        //
        // Task 2 of the foundation brief: one to four metrics on the final
        // shell, at ugly widths, so the sizing rule is checked at every count
        // rather than at the one a board happens to use.

        case "m1":
            return AnyView(WorkoutPage { WorkoutMetricStack(metrics: [
                WorkoutMetric(value: "10:59", unit: "/mi", grade: .onTarget, role: "Pace"),
            ]) })
        case "m2":
            return AnyView(WorkoutPage { WorkoutMetricStack(metrics: [
                WorkoutMetric(value: "1:11:48", role: "Elapsed"),
                WorkoutMetric(value: "204", unit: "bpm", role: "Heart rate"),
            ]) })
        case "m3":
            return AnyView(WorkoutPage { WorkoutMetricStack(metrics: [
                WorkoutMetric(value: "10:59", unit: "/mi", grade: .drifting, role: "Pace"),
                WorkoutMetric(value: "100.0", unit: "mi", role: "Distance"),
                WorkoutMetric(value: "5:59:59", role: "Elapsed"),
            ]) })
        case "m4":
            return AnyView(WorkoutPage { WorkoutMetricStack(metrics: [
                WorkoutMetric(value: "10:59", unit: "/mi", grade: .drifting, role: "Pace"),
                WorkoutMetric(value: "204", unit: "bpm", role: "Heart rate"),
                WorkoutMetric(value: "100.0", unit: "mi", role: "Distance"),
                WorkoutMetric(value: "5:59:59", role: "Elapsed"),
            ]) })
        case "m4band":
            return AnyView(WorkoutPage { WorkoutMetricStack(band: offBand, bandRow: 0, metrics: [
                WorkoutMetric(value: "10:59", unit: "/mi", grade: .drifting, role: "Pace"),
                WorkoutMetric(value: "204", unit: "bpm", role: "Heart rate"),
                WorkoutMetric(value: "100.0", unit: "mi", role: "Distance"),
                WorkoutMetric(value: "5:59:59", role: "Elapsed"),
            ]) })
        default: return nil
        }
    }

    // MARK: - Structured phases (V6 boards live in running(); nothing here yet)

    private func phases() -> AnyView? { nil }

    // MARK: - Controls
    //
    // Reached by tapping the running face. Three verbs and no telemetry: the
    // runner came here to do something, not to read.

    private func controls() -> AnyView? {
        let sep = WatchV5.separator
        switch name {
        case "controls":
            return AnyView(FaceControlsV5(mode: .steady,
                header: "Mile 5 \(sep) 44:16",
                onLead: {}, onPause: {}, onEnd: {}))
        case "controlsrace":
            // One verb. A race cannot be paused, so Pause is not drawn.
            return AnyView(FaceControlsV5(mode: .race,
                header: "Mile 9 \(sep) 1:11:48",
                onLead: {}, onPause: {}, onEnd: {}))
        case "controlsrep":
            // Lap becomes Skip rep in the SAME slot, and the header names the
            // rep — Skip without it is a question the runner cannot answer.
            return AnyView(FaceControlsV5(mode: .structured,
                header: "Rep 4 of 6 \(sep) 1:12 left",
                onLead: {}, onPause: {}, onEnd: {}))
        case "endconfirm":
            return AnyView(FaceEndConfirmV5(unfinished: "Two reps unfinished",
                onEndAndSave: {}, onKeepRunning: {}, onDiscard: {}))
        case "endconfirmclean":
            return AnyView(FaceEndConfirmV5(
                onEndAndSave: {}, onKeepRunning: {}, onDiscard: {}))
        case "skipconfirm":
            return AnyView(FaceSkipConfirmV5(repLabel: "Skip rep 4",
                coachLine: "Three are banked \(sep) the last three are where the session earns its name.",
                onSkipAnyway: {}, onFinishIt: {}))
        case "extend":
            return AnyView(FaceExtendRecoveryV5(secondsRemaining: 72,
                onAddThirty: {}, onGoNow: {}))
        default: return nil
        }
    }

    // MARK: - Faults
    //
    // No sensor blocks the run. Start stays pressable on every board here.

    private func faults() -> AnyView? {
        switch name {
        case "gps":
            return AnyView(FaceGPSAcquiringV5(onStart: {}))
        // "heartdrop" is GONE. The design says the no-heart-signal state IS
        // page 1 with one slot broken, and page 1 does that — see "p1nohr".
        // A second board for the same state drew the same three numbers at
        // three different sizes and was wired to nothing.
        case "battery":
            return AnyView(FaceLowBatteryV5(percent: 14, projectedMinutes: 40,
                onDropGPS: {}, onKeepItAll: {}))
        case "batterynoest":
            // The projection clause is DROPPED, not guessed.
            return AnyView(FaceLowBatteryV5(percent: 14, projectedMinutes: nil,
                onDropGPS: {}, onKeepItAll: {}))
        case "waterlock":
            return AnyView(FaceWaterLockV5(distance: "4.88", elapsed: "41:02"))
        default: return nil
        }
    }

    // MARK: - The coach asks

    private func asks() -> AnyView? {
        let sep = WatchV5.separator
        switch name {
        case "bail":
            return AnyView(FaceBailOfferedV5(evidence: "Two miles adrift",
                judgement: "The stimulus is already banked \(sep) forcing the rest buys fatigue, not fitness.",
                onCutItShort: {}, onRunItOut: {}))
        case "ceiling":
            return AnyView(FaceCeilingBreachV5(bpm: "178", ceiling: "168"))
        case "ceilingoverride":
            return AnyView(FaceCeilingOverrideV5(bpm: "174", ceiling: "165",
                coachLine: "Hot day, so the number runs high \(sep) the effort may be honest.",
                onLiftForToday: {}, onEaseOff: {}))
        case "spokencue":
            return AnyView(FaceSpokenCueV5(
                line: "Last two miles. Hold what you have \(sep) this is the part that counts."))
        default: return nil
        }
    }

    // MARK: - Moments
    //
    // Take the screen for two or three seconds behind a haptic, then give it
    // back. A moment REDUCES density: one or two registers at a size no other
    // board uses.

    private func moments() -> AnyView? {
        let sep = WatchV5.separator
        switch name {
        case "mgo":
            return AnyView(WMomentGo(session: "easy"))
        case "mphasenoband":
            // A rep with a target but no tolerance: no band line, so the
            // detail carries the pace instead. The pace is present exactly
            // once either way.
            return AnyView(WMomentPhaseChange(word: "Work",
                detail: "Rep 4 of 6 \(sep) 6:47/mi", band: nil))
        case "mphaselong":
            // A race course segment, which is a place name rather than a word.
            return AnyView(WMomentPhaseChange(word: "Hurricane climb",
                detail: "10:38/mi \(sep) hold effort",
                band: "10:26\u{2013}10:50", bandUnit: "/mi"))
        case "mphase":
            // What the engine now actually sends at a work-rep boundary: the
            // phase label, the rep count, and the band underneath. The pace is
            // said once — it is on the band line, not repeated in the detail.
            return AnyView(WMomentPhaseChange(word: "Work",
                detail: "Rep 4 of 6", band: "6:45\u{2013}7:00", bandUnit: "/mi"))
        case "malmost":
            // The last quarter mile of a distance phase. One figure, one word:
            // the lowest-density board in the app, which is what a moment is
            // supposed to be.
            return AnyView(WMomentAlmostDone(value: "0.25"))
        case "malmostrep":
            return AnyView(WMomentAlmostDone(value: "0.40", unit: "km left"))
        case "msplitrace":
            // A race mile, compared to the goal rather than to the mile
            // before it — the question a runner asks at every marker.
            return AnyView(WMomentSplit(label: "Mile 9", time: "7:52",
                                        comparison: "6 sec under goal"))
        case "msplitracebehind":
            return AnyView(WMomentSplit(label: "Mile 21", time: "8:14",
                                        comparison: "16 sec over goal"))
        case "msplit":
            return AnyView(WMomentSplit(label: "Mile 5", time: "7:48",
                comparison: "4 sec quicker"))
        case "mfuel":
            return AnyView(WMomentFuel(index: 2, total: 3))
        case "measeoff":
            return AnyView(WMomentHeadsUp(direction: .easeOff, pace: "7:48",
                band: "8:15\u{2013}8:45"))
        case "mquicken":
            return AnyView(WMomentHeadsUp(direction: .quicken, pace: "7:14",
                band: "6:45\u{2013}7:00"))
        case "mpaused":
            return AnyView(WMomentPaused(distance: "5.72", elapsed: "44:16",
                onResume: {}, onEnd: {}))
        default: return nil
        }
    }

    // MARK: - Lobby
    //
    // The one place colour fills a screen. The lede steps DOWN as the session
    // name grows, which is the whole reason every name length is a fixture.

    private func lobby() -> AnyView? {
        switch name {
        case "lobbyindoors":
            return AnyView(V5LobbyPoster(session: V5LobbyFixtures.easy,
                pageCount: 2, pageIndex: 0, onStart: { },
                onStartIndoors: { }))
        case "lobbyindoorslong":
            // The densest poster that can still be run on a belt.
            return AnyView(V5LobbyPoster(session: V5LobbyFixtures.threshold,
                pageCount: 3, pageIndex: 0, onStart: { },
                onStartIndoors: { }))
        case "lobbyeasy":
            return AnyView(V5LobbyPoster(session: V5LobbyFixtures.easy,
                pageCount: 2, pageIndex: 0) { })
        case "lobbylong":
            return AnyView(V5LobbyPoster(session: V5LobbyFixtures.long,
                pageCount: 2, pageIndex: 0) { })
        case "lobbythreshold":
            return AnyView(V5LobbyPoster(session: V5LobbyFixtures.threshold,
                pageCount: 3, pageIndex: 0) { })
        case "lobbyintervals":
            return AnyView(V5LobbyPoster(session: V5LobbyFixtures.intervals,
                pageCount: 3, pageIndex: 0) { })
        case "lobbyracehr":
            // HR-SEMANTICS-2 · race morning with the expected heart-rate
            // reference in the qualifier register. The fixture uses the
            // owner's real CIM guidance (148-160, validated against seven
            // comparable efforts), and the string is composed by the ROUTER'S
            // OWN adapter rather than typed here — this file's standing rule
            // is that a fixture may only supply what the router supplies.
            return AnyView(V5LobbyPoster(
                session: V5LobbySession(
                    ramp: .race, lede: "CIM", dose: "26.22 mi",
                    qualifier: WatchLobbyAdapter.raceHrReference(for: WatchWorkout(
                        workoutId: "p", name: "CIM", summary: "CIM",
                        totalEstimatedMinutes: 197, phases: [],
                        completionEndpoint: "/x", expiresAt: "2099-12-31T00:00:00Z",
                        isRace: true, goalSec: 11820,
                        raceHr: WatchRaceHr(expectedLoBpm: 148, expectedHiBpm: 160,
                                            earlyCeilingBpm: 148, earlyThroughMi: 10,
                                            lateAllowanceBpm: 165, checkpointMi: 10,
                                            checkpointAbortBpm: 163, informationalOnly: false))),
                    band: "Goal 3:17:00", bandSub: "7:26–7:36 /mi"),
                pageCount: 2, pageIndex: 0, onStart: {}, onStartIndoors: nil))
        case "lobbyrace":
            return AnyView(V5LobbyPoster(session: V5LobbyFixtures.race,
                pageCount: 3, pageIndex: 0) { })
        case "lobbymoved":
            // Readiness arrived and changed the dose. It appears as a session
            // that HAS already changed, with the reason stated once — never as
            // a score to argue with at 6am.
            return AnyView(V5LobbyPoster(session: V5LobbyFixtures.readinessMoved,
                pageCount: 2, pageIndex: 0) { })
        case "lobbyplan":
            return AnyView(V5LobbyBreakdown(kicker: "The plan",
                steps: V5LobbyFixtures.racePlan,
                footerName: "Gels", footerValue: "8 \u{00B7} 15 \u{00B7} 21",
                pageCount: 3, pageIndex: 1))
        case "lobbysteps":
            return AnyView(V5LobbyBreakdown(kicker: "The steps",
                steps: V5LobbyFixtures.sessionSteps,
                pageCount: 3, pageIndex: 1))
        case "lobbyweek":
            return AnyView(V5LobbyWeek(days: V5LobbyFixtures.week,
                milesRun: "18", milesPlanned: "42",
                pageCount: 3, pageIndex: 2))
        case "restday":
            return AnyView(V5LobbyRefusal(lede: "Rest",
                sentence: "Nothing today \u{00B7} you ran 34 miles this week and the long one was Sunday. Resting is the work.",
                escapeLabel: "Run anyway", ramp: .rest) { })
        default: return nil
        }
    }

    // MARK: - Finish and pre-session

    private func finish() -> AnyView? {
        let sep = WatchV5.separator
        switch name {
        case "complete":
            return AnyView(FinishCompleteBoard(session: "easy", distance: "6.02",
                duration: "48:12", pace: "8:01 /mi",
                coachLine: "Held the band the whole way \(sep) that is the session.") { })
        case "racecomplete":
            return AnyView(FinishRaceCompleteBoard(raceName: "Marathon",
                watchTime: "3:28:44", goalComparison: "Under 3:29:59") { })
        case "receipt":
            // THE RECEIPT DAVID ACTUALLY SAW, 2026-09-02 — his own numbers off
            // the saved run row, not an invented fixture: 5.98 mi / 50:57,
            // 8:31 pace, 139 avg. A recovered run draws no splits and no
            // climb (`WatchRecoveryReceiptV5`), which is why this board was
            // short and why the missing exit was the whole screen.
            return AnyView(FinishSummaryBoard(distance: "5.98", duration: "50:57",
                averages: [FinishSummaryRow("Pace", "8:31 /mi"),
                           FinishSummaryRow("Heart", "139 avg")],
                splits: [], totals: [], onDone: { }))
        case "summary":
            return AnyView(FinishSummaryBoard(distance: "6.02", duration: "48:12",
                averages: [FinishSummaryRow("Pace", "8:01 /mi"),
                           FinishSummaryRow("Heart", "148 avg"),
                           FinishSummaryRow("Cadence", "159 spm")],
                splits: [FinishSummaryRow("Mile 1", "8:12"),
                         FinishSummaryRow("Mile 2", "8:04"),
                         FinishSummaryRow("Mile 3", "7:58"),
                         FinishSummaryRow("Mile 4", "7:56"),
                         FinishSummaryRow("Mile 5", "8:00"),
                         FinishSummaryRow("Mile 6", "7:54")],
                totals: [FinishSummaryRow("Climb", "312 ft")]))
        case "firstlaunch":
            return AnyView(PreSessionFirstLaunchBoard { })
        default: return notifications()
        }
    }

    // MARK: - Notifications
    //
    // One shell. An action appears only when there GENUINELY is one — "session
    // moved" and "race tomorrow" have none, and giving them a target would
    // make the notification a thing to dismiss rather than a thing to read.
    //
    // The complication/Smart Stack preview cases that used to live here
    // (compcircular, comprect, smartstack, ...) are gone: they rendered
    // FaffWidgetContent/FaffCircularComplication/etc. from "FaffWatch
    // Widgets", but that folder was never wired into Xcode as a target —
    // it has no PBXFileSystemSynchronizedRootGroup entry and nothing embeds
    // it, so those types were never in scope for any target that could
    // build this file. Restore them once the widget extension target
    // actually exists.

    private func notifications() -> AnyView? {
        switch name {
        case "notifmoved":
            return AnyView(V5NotificationBoard(content: FaffNotificationFixtures.sessionMoved))
        case "notifmovedlong":
            return AnyView(V5NotificationBoard(content: FaffNotificationFixtures.sessionMovedLong))
        case "notifrace":
            return AnyView(V5NotificationBoard(content: FaffNotificationFixtures.raceTomorrow))
        case "notifunread":
            return AnyView(V5NotificationBoard(content: FaffNotificationFixtures.runUnread) { })
        case "notifunreadsent":
            return AnyView(V5NotificationBoard(content: FaffNotificationFixtures.runUnreadAsSent) { })
        default: return nil
        }
    }
}
