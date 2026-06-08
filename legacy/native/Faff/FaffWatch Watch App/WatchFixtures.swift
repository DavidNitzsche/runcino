//
//  WatchFixtures.swift
//  FaffWatch
//
//  AFTER the locked-face migration this file holds only two things:
//    1. `InRunStatsFace` — the swipe-page 2×2 grid (elapsed / distance /
//       avg pace / calories). Still owned by the WatchFaces.swift primitive
//       stack since it's an inventory view, not the in-run face.
//    2. `WatchFixtureView` — a thin stub that lets `-face <name>` still launch
//       the app without crashing. It now just renders a placeholder; the
//       formal visual-regression scaffolding (scripts/watch/refs) needs to be
//       rebuilt against the new face system before it can light back up.
//

import SwiftUI

// MARK: - In-run stats (swipe page · 2×2 grid)

/// In-run secondary stats — the swipe page off the work face. Re-skinned
/// under the locked grammar: four big number rows, colour-coded to type,
/// no labels (position + colour carry the meaning, same as the in-run
/// faces).
///
///   · distance  (blue · canonical)
///   · elapsed   (white · neutral readout)
///   · avg pace  (green · live when computed, muted while still 0)
///   · calories  (muted · least-actionable readout)
struct InRunStatsFace: View {
    let elapsed: String      // "24:18"
    let distance: String     // "3.2"
    let avgPace: String      // "6:42" or "—:—"
    let calories: String     // "412" or "—"

    private var paceRole: Role {
        avgPace == "—:—" || avgPace == "—" ? .mute : .live
    }
    var body: some View {
        // Top tag "STATS" anchors the face to the OS clock baseline;
        // four big rows flex below it under the locked law. Without a
        // label the face had no caption — just rows of numbers with no
        // declaration of what they meant.
        NumberFace(
            rows: [
                NumRow(distance, .dist),
                NumRow(elapsed,  .neutral),
                NumRow(avgPace,  paceRole),
                // Flame icon disambiguates the bare integer from HR /
                // cadence / any other count. Same icon pattern as HR (♥)
                // / cadence (🏃) on the in-run faces.
                NumRow(calories, .mute, icon: "flame.fill")
            ],
            topLabel: "STATS"
        )
    }
}

// MARK: - Fixture entry point (now a stub)

/// `-face <name>` used to render a per-face fixture; the locked face system
/// makes that scaffolding obsolete and a fresh visual-regression pass will be
/// authored against Faces.swift. Until then, render a single sample face so
/// the launch path still works without crashing.
struct WatchFixtureView: View {
    let face: String
    var body: some View {
        ResponsiveFace {
            content
        }
    }
    @ViewBuilder private var content: some View {
        switch face {
        case "easy":
            EasyFace(pace: "8:42", paceRole: .live,
                     hr: "145", hrOver: false, cadence: "172", distance: "2.30")
        case "easy-no-gps":
            // Simulate the just-pressed-Start state — no GPS lock yet, pace is
            // the "—:—" placeholder rendered in mute grey. The em-dash width
            // fix means the placeholder doesn't blow up the font size; the
            // three rows still read as a clean stack.
            EasyFace(pace: "—:—", paceRole: .mute,
                     hr: "66", hrOver: false, cadence: "—", distance: "0.00")
        case "easy-hr-over":
            EasyFace(pace: "8:42", paceRole: .live,
                     hr: "164", hrOver: true, cadence: "172", distance: "2.30")
        case "rep":
            WorkIntervalFace(livePace: "6:33", paceRole: .live, targetPace: "6:31",
                             totalDistance: "3.78", repCounter: "0:24",
                             stripStates: [1, 1, 1, 2, 0, 0])
        case "rep-hr":
            // Threshold rep with the live-HR floor row (♥ replaces total
            // distance). Live 164 ≥ target 149 → green; label "♥149" (no +,
            // threshold target). Swap to hr "151"/.neutral + "♥162+" to
            // preview the intervals floor (below-floor) state.
            WorkIntervalFace(livePace: "6:33", paceRole: .live, targetPace: "6:31",
                             totalDistance: "3.78", repCounter: "0:24",
                             stripStates: [1, 1, 1, 2, 0, 0],
                             hr: "164", hrRole: .live, hrReference: "♥149")
        // ── Cruise Intervals (4 × 1 mi) audit fixtures ────────────────────
        // Each renders the .sampleCruise workout frozen at a specific phase
        // index so we can verify the right face shows for every phase
        // without driving the workout in real time.
        case "cruise-lobby":
            // "TODAY" instead of "CRUISE INTERVALS" — workout name was
            // colliding with the OS clock + the iOS card already names it.
            // Race lobbies keep their name (BIG SUR etc).
            LobbyFace(name: "TODAY", distance: "7.9", pace: "6:47",
                      time: "1:08", paceRange: nil, onStart: {})
        case "cruise-warmup":
            // Phase 0 · WARMUP 1.8 mi — LiveWarmup renders covered + next pace.
            WarmupFace(pace: "8:18", paceRole: .live, hr: "138",
                       remaining: "2.55", remainingRole: .dist,
                       upNext: "1.0 mi  ·  6:47")
        case "cruise-rep-mid":
            // Phase 1 · REP 1/4 · 0.45 mi covered — multi-work session routes
            // here. WorkIntervalFace renders pace/target/total/repCounter (mi
            // remaining) + a strip showing 4 work cells.
            WorkIntervalFace(livePace: "6:45", paceRole: .live, targetPace: "6:47",
                             totalDistance: "2.25", repCounter: "0.55",
                             stripStates: [2, 0, 0, 0])
        case "cruise-rep-end":
            // Phase 1 · REP 1/4 · 0.97 mi covered — about to fire the static
            // "0.03 LEFT" heads-up flash.
            WorkIntervalFace(livePace: "6:45", paceRole: .live, targetPace: "6:47",
                             totalDistance: "2.77", repCounter: "0.03",
                             stripStates: [2, 0, 0, 0])
        case "cruise-rec":
            // Phase 2 · RECOVERY 1/4 · 2:00 jog · RestFace shows time-left
            // + the NEXT phase (Rep 2 at 6:47 / 1 mi).
            RestFace(restTimeLeft: "1:32", pace: "9:30", paceRole: .live, hr: "148")
        case "cruise-cooldown":
            // Phase 8 · COOLDOWN 1.2 mi — distance row counts DOWN from
            // 1.20 → 0. After 0 (overtime/planComplete), flips to purple
            // and counts UP total covered.
            SteadyRunFace(livePace: "8:14", paceRole: .live,
                          distance: "0.80", elapsed: "1:09",
                          topLabel: "COOL DOWN")
        case "cruise-decode-tomorrow":
            // Round-trip smoke test: the exact JSON the web agent says
            // /api/watch/today returns for tomorrow's Cruise Intervals.
            // Decodes through the real WatchWorkout Codable — if anything
            // drifted we'll see DECODE FAIL with the error, instead of
            // discovering it mid-rep.
            CruiseDecodeTestView()
        case "cruise-cooldown-overtime":
            // Cooldown done, planComplete fired — same face but distance
            // row is purple, counting total covered.
            SteadyRunFace(livePace: "9:02", paceRole: .neutral,
                          distance: "8.10", elapsed: "1:12",
                          distanceRole: .bonus,
                          topLabel: "OVERTIME")
        case "race":
            LiveRaceFace(livePace: "8:28", paceRole: .live, phaseTarget: "8:30",
                         totalDistance: "10.8", goalDelta: "+1:14", goalDeltaRole: .live,
                         phaseSegments: [1, 1, 2, 0, 0, 0])
        case "warmup":
            WarmupFace(pace: "8:18", paceRole: .live, hr: "138",
                       remaining: "0.60", remainingRole: .dist,
                       upNext: "0.5 mi  ·  6:31")
        case "recovery", "rest":
            RestFace(restTimeLeft: "1:30", pace: "9:30", paceRole: .live, hr: "148")
        case "go":
            GoFace(rep: "REP 2 / 4", target: "6:47")
        case "fuel":
            FuelFace(index: 2, total: 3)
        case "landmark":
            LandmarkFace(big: "BIXBY", sub: "0.3 mi ahead")
        case "milesplit", "mile-split":
            MileSplitFace(mile: "MILE 7", pace: "8:42")
        case "pause":
            LivePauseFace(distance: "4.10", elapsed: "38:20", onResume: {})
        case "complete":
            CompleteFace(label: "Threshold", pace: "8:48", distance: "9.6", elapsed: "1:24",
                         onDone: {})
        case "today":
            TodayDoneFace(pace: "8:14", distance: "5.8", elapsed: "46:18")
        case "calibrate":
            CalibrateFace(mile: 13)
        case "stats":
            InRunStatsFace(elapsed: "24:18", distance: "3.2", avgPace: "6:42", calories: "412")
        case "splits":
            SplitsFace(rows: [
                .init(repNo: 1, pace: "6:29", role: .live),
                .init(repNo: 2, pace: "6:30", role: .live),
                .init(repNo: 3, pace: "6:33", role: .neutral),   // current
                .init(repNo: 4, pace: "—",    role: .mute),
                .init(repNo: 5, pace: "—",    role: .mute),
                .init(repNo: 6, pace: "—",    role: .mute)
            ])
        case "session-map":
            SessionMapFace(rows: [
                .init(label: "Warmup",     value: "10:00", state: .done),
                .init(label: "Reps 1–2",   value: "✓",     state: .done),
                .init(label: "Rep 3 · now", value: "6:31", state: .current),
                .init(label: "Reps 4–6",   value: "3×",    state: .upcoming),
                .init(label: "Cooldown",   value: "10:00", state: .upcoming)
            ])
        case "justrun", "just-run":
            JustRunFace(onStart: {})
        case "lobby-easy":
            // Easy long run with a pace RANGE — exercises the new
            // paceRange subtitle under the midpoint. Time hits 101 min
            // → renders as h:mm "1:41" per the >=60-min rule.
            LobbyFace(name: "LONG RUN", distance: "11.6", pace: "8:44",
                      time: "1:41", paceRange: "8:29-8:59", onStart: {})
        case "lobby-race":
            LobbyFace(name: "BIG SUR", distance: "26.2", pace: "8:46",
                      time: "3:50", paceRange: nil, showTimeIcon: false, onStart: {})
        case "countdown":
            // Render a 3 — the engine drives the real countdown; this is
            // just a layout fixture.
            CountdownView(engine: WorkoutEngine.fixture(
                workout: .sample, currentIndex: 0,
                phaseElapsedSec: 0, totalElapsedSec: 0))
        case "endcountdown", "ending":
            // End-of-rep countdown frozen at "8" — what the runner sees
            // ~3 s into the final 10 of a time-based interval rep.
            EndingCountdownView(engine: {
                let e = WorkoutEngine.fixture(workout: .sample, currentIndex: 0,
                                              phaseElapsedSec: 0, totalElapsedSec: 0)
                e.setEndingCountdownFixture(8)
                return e
            }())
        case "summary-workout":
            SummaryView(
                workout: .sample,
                completion: WatchCompletion(
                    workoutId: "sample", startedAt: "", completedAt: "",
                    status: "completed", totalDistanceMi: 6.4,
                    totalDurationSec: 3134, avgHr: 171, maxHr: 182,
                    avgCadence: 181, phases: []),
                onDone: {})
        case "summary-race":
            SummaryView(
                workout: .sampleRace,
                completion: WatchCompletion(
                    workoutId: "race", startedAt: "", completedAt: "",
                    status: "completed", totalDistanceMi: 26.2,
                    totalDurationSec: 13752, avgHr: 168, maxHr: 184,
                    avgCadence: 178, phases: []),
                onDone: {})
        // ── Tomorrow's long-run fixtures ──────────────────────────────────
        case "tomorrow-easy-mid":
            // Easy face mid-run, on pace, GPS locked. Shows the rotating
            // guardrail in HR position.
            EasyFace(pace: "8:42", paceRole: .live,
                     hr: "145", hrOver: false, cadence: "172", distance: "5.30")
        case "tomorrow-easy-cadence":
            // Same face, 60s later — rotation has flipped to cadence.
            EasyFace(pace: "8:46", paceRole: .live,
                     hr: "147", hrOver: false, cadence: "172", distance: "5.31")
        case "tomorrow-milesplit":
            // Mid-run mile-split flash for mile 5.
            MileSplitFace(mile: "MILE 5", pace: "8:39")
        case "tomorrow-fuel-1":
            FuelFace(index: 1, total: 3)
        case "tomorrow-fuel-3":
            FuelFace(index: 3, total: 3)
        case "tomorrow-pause":
            LivePauseFace(distance: "5.30", elapsed: "46:18", onResume: {})
        case "tomorrow-summary":
            // Long-run completion — name "LONG RUN", ~11.6 mi, ~1:42:18.
            SummaryView(
                workout: WatchWorkout(
                    workoutId: "long-tomorrow",
                    name: "LONG RUN",
                    summary: "Long Run · 8:29-8:59/mi · easy",
                    totalEstimatedMinutes: 101,
                    phases: [], completionEndpoint: "",
                    expiresAt: "2099-01-01T00:00:00Z",
                    distanceMi: 11.6),
                completion: WatchCompletion(
                    workoutId: "long-tomorrow", startedAt: "", completedAt: "",
                    status: "completed", totalDistanceMi: 11.6,
                    totalDurationSec: 6138, avgHr: 148, maxHr: 162,
                    avgCadence: 173, phases: []),
                onDone: {})
        case "controls":
            ControlsFace(paused: false, onPrimary: {}, onEnd: {})
        case "headsup":
            HeadsUpFace(value: "0.25")
        case "headsup-time":
            HeadsUpFace(value: "10s")
        case "phase-change":
            PhaseChangeFace(title: "HURRICANE", sub: "10:38/MI · HOLD EFFORT")
        case "hr":
            HRFace(pace: "9:15", hr: "142", hrRole: .live, distance: "4.1")
        case "strides":
            StridesFace(livePace: "5:30", burstCountdown: "0:14",
                        stripStates: [1, 1, 1, 2, 0, 0])
        case "steady":
            SteadyRunFace(livePace: "8:55", paceRole: .live, distance: "9.6", elapsed: "1:25",
                          topLabel: "STEADY")
        case "overtime":
            // Plan done at 11.6, runner has banked 0.4 more — total 12.0,
            // distance row in purple (Faff.bonus) per the locked grammar.
            SteadyRunFace(livePace: "9:02", paceRole: .neutral,
                          distance: "12.0", elapsed: "1:47",
                          distanceRole: .bonus,
                          topLabel: "OVERTIME")
        case "finish":
            // Long-run FINISH segment face — ProgressionFace under a FINISH
            // label (no rep counter, no strip). 9.0 mi @ HM (6:52), 5.20 mi
            // left in the segment. This is what LiveFinish renders for an
            // isFinishSegment phase.
            ProgressionFace(livePace: "6:54", paceRole: .live, stepTarget: "6:52",
                            totalDistance: "12.8", toNextStep: "5.20",
                            topLabel: "FINISH")
        case "finish-decode":
            // Round-trip: decode the exact long-with-finish payload
            // /api/watch/today emits and assert isFinishSegment survives the
            // WatchWorkout re-stamp (phase[1] true, phase[0] omitted → false).
            LongFinishDecodeTestView()
        default:
            // Default fixture: rep-work face — the canonical reference.
            WorkIntervalFace(livePace: "6:33", paceRole: .live, targetPace: "6:31",
                             totalDistance: "3.78", repCounter: "0:24",
                             stripStates: [1, 1, 1, 2, 0, 0])
        }
    }
}

#Preview("Fixture · rep") { WatchFixtureView(face: "rep") }
#Preview("Fixture · race") { WatchFixtureView(face: "race") }
#Preview("Fixture · easy-hr-over") { WatchFixtureView(face: "easy-hr-over") }

// MARK: - JSON round-trip smoke test
//
// Decodes the exact payload web/api/watch/today returns for tomorrow's
// Cruise Intervals + renders a pass/fail card. Catches field-name skew,
// missing-vs-null mismatches, raw-enum drift before they show up at
// mile 1 on a real run.
private struct CruiseDecodeTestView: View {
    private static let payload = """
{
  "workoutId": "0645f40c-951d-4ccc-b86e-9979cd26c795-2026-05-26",
  "name": "Cruise Intervals",
  "summary": "7.9 mi · Threshold · 4 × 1 mile reps",
  "totalEstimatedMinutes": 58,
  "phases": [
    { "type": "warmup",   "label": "Warmup",       "durationSec": 886, "targetPaceSPerMi": 492, "tolerancePaceSPerMi": 25, "haptic": "start",               "repUnit": "distance", "distanceMi": 1.8 },
    { "type": "work",     "label": "Rep 1/4",      "durationSec": 407, "targetPaceSPerMi": 407, "tolerancePaceSPerMi":  8, "haptic": "transition-work",     "repUnit": "distance", "distanceMi": 1   },
    { "type": "recovery", "label": "Recovery 1/3", "durationSec": 120, "targetPaceSPerMi": null,"tolerancePaceSPerMi":null,"haptic": "transition-recovery", "repUnit": "time" },
    { "type": "work",     "label": "Rep 2/4",      "durationSec": 407, "targetPaceSPerMi": 407, "tolerancePaceSPerMi":  8, "haptic": "transition-work",     "repUnit": "distance", "distanceMi": 1   },
    { "type": "recovery", "label": "Recovery 2/3", "durationSec": 120, "targetPaceSPerMi": null,"tolerancePaceSPerMi":null,"haptic": "transition-recovery", "repUnit": "time" },
    { "type": "work",     "label": "Rep 3/4",      "durationSec": 407, "targetPaceSPerMi": 407, "tolerancePaceSPerMi":  8, "haptic": "transition-work",     "repUnit": "distance", "distanceMi": 1   },
    { "type": "recovery", "label": "Recovery 3/3", "durationSec": 120, "targetPaceSPerMi": null,"tolerancePaceSPerMi":null,"haptic": "transition-recovery", "repUnit": "time" },
    { "type": "work",     "label": "Rep 4/4",      "durationSec": 407, "targetPaceSPerMi": 407, "tolerancePaceSPerMi":  8, "haptic": "transition-work",     "repUnit": "distance", "distanceMi": 1   },
    { "type": "cooldown", "label": "Cooldown",     "durationSec": 590, "targetPaceSPerMi": 492, "tolerancePaceSPerMi": 25, "haptic": "transition-cooldown", "repUnit": "distance", "distanceMi": 1.2 }
  ],
  "completionEndpoint": "https://www.faff.run/api/watch/workouts/complete",
  "expiresAt": "2026-05-26T23:59:59.000Z",
  "distanceMi": 7.9,
  "paceLabel": "T",
  "isRace": false,
  "hrCeilingBpm": null,
  "displayHint": null
}
"""

    private struct Result {
        let ok: Bool
        let phaseCount: Int
        let distanceTotal: String
        let firstRepDistance: String
        let lastPhaseType: String
        let error: String?
    }

    private static let result: Result = {
        guard let data = payload.data(using: .utf8) else {
            return Result(ok: false, phaseCount: 0, distanceTotal: "—",
                          firstRepDistance: "—", lastPhaseType: "—",
                          error: "UTF8")
        }
        do {
            let w = try JSONDecoder().decode(WatchWorkout.self, from: data)
            let firstWork = w.phases.first(where: { $0.type == .work })
            return Result(
                ok: true,
                phaseCount: w.phases.count,
                distanceTotal: w.distanceMi.map { String(format: "%.1f", $0) } ?? "—",
                firstRepDistance: firstWork?.distanceMi.map { String(format: "%.1f", $0) } ?? "—",
                lastPhaseType: w.phases.last.map { "\($0.type)" } ?? "—",
                error: nil)
        } catch {
            return Result(ok: false, phaseCount: 0, distanceTotal: "—",
                          firstRepDistance: "—", lastPhaseType: "—",
                          error: String(describing: error))
        }
    }()

    var body: some View {
        GeometryReader { geo in
            let h = geo.size.height
            VStack(alignment: .leading, spacing: h * 0.025) {
                Text(Self.result.ok ? "DECODE OK" : "DECODE FAIL")
                    .font(.custom("HelveticaNeue-Bold", size: h * 0.10))
                    .foregroundStyle(Self.result.ok ? Faff.live : Faff.over)
                Group {
                    Text("phases   \(Self.result.phaseCount) / 9")
                    Text("total    \(Self.result.distanceTotal) mi")
                    Text("rep 1    \(Self.result.firstRepDistance) mi")
                    Text("last     \(Self.result.lastPhaseType)")
                }
                .font(.custom("HelveticaNeue-Bold", size: h * 0.055))
                .foregroundStyle(Color(hex: 0xCFD2D8))
                if let err = Self.result.error {
                    Text(err)
                        .font(.custom("HelveticaNeue", size: h * 0.045))
                        .foregroundStyle(Faff.over)
                        .lineLimit(4)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.horizontal, h * 0.06)
            .padding(.top, h * 0.05)
        }
        .background(Color.black)
    }
}

// MARK: - Long-run finish decode round-trip (isFinishSegment wire + re-stamp)
//
// Decodes the exact long-with-finish payload /api/watch/today emits and
// asserts the optional isFinishSegment field survives WatchWorkout's re-stamp
// init: phase[1] must be true (decoded + carried through the re-stamp), phase[0]
// must be false (field omitted on the wire → decodeIfPresent default). This is
// the guard for the highest-risk spot — a dropped field in the re-stamp would
// silently route the finish to the rep face. Launch: -face finish-decode.
private struct LongFinishDecodeTestView: View {
    private static let payload = """
{
  "workoutId": "0645f40c-951d-4ccc-b86e-9979cd26c795-2026-07-19",
  "name": "LONG · 9mi @ HM",
  "summary": "17.0 mi · last 9 @ HM pace",
  "totalEstimatedMinutes": 126,
  "phases": [
    { "type": "work", "label": "8.0 mi easy",      "durationSec": 3840, "targetPaceSPerMi": 480, "tolerancePaceSPerMi": 20, "haptic": "start",           "repUnit": "distance", "distanceMi": 8 },
    { "type": "work", "label": "9.0 mi @ HM pace", "durationSec": 3708, "targetPaceSPerMi": 412, "tolerancePaceSPerMi": 12, "haptic": "transition-work", "repUnit": "distance", "distanceMi": 9, "isFinishSegment": true }
  ],
  "completionEndpoint": "https://www.faff.run/api/watch/workouts/complete",
  "expiresAt": "2026-07-19T23:59:59.000Z",
  "distanceMi": 17,
  "paceLabel": "L",
  "isRace": false,
  "hrCeilingBpm": null,
  "displayHint": "pace"
}
"""

    private struct Result {
        let ok: Bool
        let phaseCount: Int
        let buildFinish: String    // phase[0].isFinishSegment (expect false)
        let finishFinish: String   // phase[1].isFinishSegment (expect true)
        let hint: String
        let error: String?
    }

    private static let result: Result = {
        guard let data = payload.data(using: .utf8) else {
            return Result(ok: false, phaseCount: 0, buildFinish: "—",
                          finishFinish: "—", hint: "—", error: "UTF8")
        }
        do {
            let w = try JSONDecoder().decode(WatchWorkout.self, from: data)
            let p0 = w.phases.indices.contains(0) ? w.phases[0].isFinishSegment : false
            let p1 = w.phases.indices.contains(1) ? w.phases[1].isFinishSegment : false
            let pass = w.phases.count == 2 && p1 == true && p0 == false && w.displayHint == "pace"
            return Result(ok: pass, phaseCount: w.phases.count,
                          buildFinish: "\(p0)", finishFinish: "\(p1)",
                          hint: w.displayHint ?? "nil", error: nil)
        } catch {
            return Result(ok: false, phaseCount: 0, buildFinish: "—",
                          finishFinish: "—", hint: "—", error: String(describing: error))
        }
    }()

    var body: some View {
        GeometryReader { geo in
            let h = geo.size.height
            VStack(alignment: .leading, spacing: h * 0.025) {
                Text(Self.result.ok ? "FINISH OK" : "FINISH FAIL")
                    .font(.custom("HelveticaNeue-Bold", size: h * 0.10))
                    .foregroundStyle(Self.result.ok ? Faff.live : Faff.over)
                Group {
                    Text("phases   \(Self.result.phaseCount) / 2")
                    Text("build    isFinish=\(Self.result.buildFinish)")
                    Text("finish   isFinish=\(Self.result.finishFinish)")
                    Text("hint     \(Self.result.hint)")
                }
                .font(.custom("HelveticaNeue-Bold", size: h * 0.055))
                .foregroundStyle(Color(hex: 0xCFD2D8))
                if let err = Self.result.error {
                    Text(err)
                        .font(.custom("HelveticaNeue", size: h * 0.045))
                        .foregroundStyle(Faff.over)
                        .lineLimit(4)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.horizontal, h * 0.06)
            .padding(.top, h * 0.05)
        }
        .background(Color.black)
    }
}
