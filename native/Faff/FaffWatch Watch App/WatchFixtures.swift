//
//  WatchFixtures.swift
//  FaffWatch
//
//  Visual-regression fixtures (scripts/watch). Each `-face <name>` renders
//  ONE face with watch-app.html's exact canonical values, using the same
//  reference components as the live app (WatchFaces.swift). The headless
//  reference (scripts/watch/refs) and the simulator screenshot then line up,
//  so the diff measures layout fidelity, not live data.
//
//  Launched via `-face <name>` (see WorkoutRootView). Run the gate with:
//      node scripts/watch/verify-all.mjs
//

import SwiftUI

struct WatchFixtureView: View {
    let face: String

    var body: some View {
        // Background fills the corners; content respects the safe area so it
        // sits where the deck's .w-screen padding puts it (and the OS clock
        // stays in the top inset, not over the face).
        ZStack {
            WP.bg.ignoresSafeArea()
            content   // respect the safe area so text clears the rounded corners + the OS clock
        }
    }

    // The §C work-interval whole-session strip (13 phases, rep 3 current).
    private var workSegs: [Seg] {
        [Seg(weight: 1.3, state: .done), Seg(weight: 1, state: .done), Seg(weight: 0.5, state: .done),
         Seg(weight: 1, state: .done), Seg(weight: 0.5, state: .done), Seg(weight: 1, state: .current),
         Seg(weight: 0.5, state: .upcoming), Seg(weight: 1, state: .upcoming), Seg(weight: 0.5, state: .upcoming),
         Seg(weight: 1, state: .upcoming), Seg(weight: 0.5, state: .upcoming), Seg(weight: 1, state: .upcoming),
         Seg(weight: 1.3, state: .upcoming)]
    }
    // The §F race phase strip (6 course phases, sized by distance).
    private var raceSegs: [Seg] {
        [Seg(weight: 1.3, state: .done), Seg(weight: 1, state: .done), Seg(weight: 0.8, state: .current),
         Seg(weight: 1, state: .upcoming), Seg(weight: 0.5, state: .upcoming), Seg(weight: 2.6, state: .upcoming),
         Seg(weight: 1.3, state: .upcoming)]
    }

    @ViewBuilder private var content: some View {
        switch face {

        // ── §C · work interval + color states ─────────────────────────────
        case "work-interval":
            WorkIntervalFace(rep: "Int 3 / 6", elapsed: "24:18", segments: workSegs,
                             currentPace: "6:33", targetPace: "6:31", deltaSeconds: 2,
                             heartRate: "168", cadence: "182", repFraction: 0.5, repTimeLeft: "0:24")
        case "green-on-the-band":
            WorkIntervalFace(rep: "Int 3 / 6", elapsed: "24:18", segments: workSegs,
                             currentPace: "6:31", targetPace: "6:31", deltaSeconds: 0,
                             heartRate: "168", cadence: "182", repFraction: 0.5, repTimeLeft: "0:24")
        case "amber-drifting":
            WorkIntervalFace(rep: "Int 3 / 6", elapsed: "24:18", segments: workSegs,
                             currentPace: "6:44", targetPace: "6:31", deltaSeconds: 13,
                             heartRate: "164", cadence: "176", repFraction: 0.5, repTimeLeft: "0:24")
        case "red-off-pace":
            WorkIntervalFace(rep: "Int 3 / 6", elapsed: "24:18", segments: workSegs,
                             currentPace: "6:51", targetPace: "6:31", deltaSeconds: 20,
                             heartRate: "159", cadence: "171", repFraction: 0.5, repTimeLeft: "0:24")
        case "work-interval-distance":
            // A DISTANCE rep (e.g. 800m / a mile rep) — the bottom counts down
            // miles instead of time. Same face, unit-aware value.
            WorkIntervalFace(rep: "Int 3 / 6", elapsed: "24:18", segments: workSegs,
                             currentPace: "6:33", targetPace: "6:31", deltaSeconds: 2,
                             heartRate: "168", cadence: "182", repFraction: 0.4, repTimeLeft: "0.30 mi")

        // ── §B · warmup ───────────────────────────────────────────────────
        case "warmup":
            SteadyFace(label: "Warmup", accent: WP.green, elapsed: "7:16", hero: "2:15",
                       refLabel: "Easy", refPace: "7:58", heartRate: "142", cadence: "168",
                       fraction: 0.22, timeLeft: "7:45")

        // ── §C3 · recovery ────────────────────────────────────────────────
        case "recovery":
            RecoveryFace(rest: "Rest 3 / 6", elapsed: "24:42", countdown: "0:42",
                         nextRef: "Next rep · 6:31/mi", heartRate: "148", cadence: "96", fraction: 0.70)

        // ── §F · race view ────────────────────────────────────────────────
        case "race-view":
            RaceFace(phase: "Hurricane", elapsed: "1:34:20", segments: raceSegs,
                     currentPace: "10:42", phaseTarget: "10:38", deltaSeconds: 4,
                     projectedFinish: "3:49", goalDeltaSec: -48, distanceToGo: "15.8",
                     nextFuel: "Gel 3 · 1.6mi")

        // ── §D · alt pages ────────────────────────────────────────────────
        case "controls":
            ControlsFace()
        case "paused":
            PausedFixture()
        case "splits":
            SplitsFace(rows: [
                .init(repNo: 1, label: "800", pace: "6:29", color: WP.green),
                .init(repNo: 2, label: "800", pace: "6:30", color: WP.green),
                .init(repNo: 3, label: "800", pace: "6:33", color: WP.orange),
                .init(repNo: 4, label: "800", pace: "—", color: WP.faint),
            ])
        case "session-map":
            SessionMapFace(rows: [
                .init(label: "Warmup", value: "10:00", state: .done),
                .init(label: "Reps 1–2", value: "✓", state: .done),
                .init(label: "Rep 3 · now", value: "6:31", state: .current),
                .init(label: "Reps 4–6", value: "800", state: .upcoming),
                .init(label: "Cooldown", value: "10:00", state: .upcoming),
            ])
        case "always-on-dimmed":
            AODFixture()
        case "in-run-stats":
            InRunStatsFixture()

        // ── §B / §C3 / §F2 · transitions + countdown ──────────────────────
        case "countdown":
            CountdownFixture()
        case "heads-up-3s":
            TransitionFace(icon: "clock", title: "Almost there", titleColor: WP.amber,
                           sub: "3 SECONDS LEFT", next: "90s jog")
        case "next-rep":
            PaceCue(eyebrow: "INT 4 / 6", color: WP.green, pace: "6:31", spec: "800M")
        case "phase-change":
            PaceCue(eyebrow: "Hurricane climb", color: WP.orange, pace: "10:38", spec: "2.1 MI")
        case "fuel-cue":
            TransitionFace(icon: "bolt.fill", title: "Gel 3", titleColor: WP.orange, sub: "+ WATER")

        // ── §E / §F2 · finish ─────────────────────────────────────────────
        case "summary":
            SummaryFixture()
        case "finish":
            RaceFinishFixture()

        // ── §A / §F2 · home + pre-run ─────────────────────────────────────
        case "home-workout-day":
            HomeWorkoutFixture()
        case "home-rest-day":
            HomeRestFixture()
        case "pre-run-briefing":
            PreRunBriefingFixture()
        case "pre-run-detail":
            WorkoutDetailFixture()
        case "pre-race":
            PreRaceFixture()

        // ── §G · on the watch face ────────────────────────────────────────
        case "glance":
            ReadinessGlanceView(readiness: WatchReadiness(
                score: 82, state: "green", label: "Primed",
                recommendation: "Green. Hit today's prescription as written.",
                hrvMs: 68, rhrBpm: 48, suppressReason: nil,
                nextRace: .init(name: "CIM", slug: "cim", daysAway: 198)))
        case "glance-empty":
            ReadinessGlanceView(readiness: WatchReadiness(
                score: nil, state: "yellow", label: "Hold easy", recommendation: "",
                hrvMs: nil, rhrBpm: nil, suppressReason: "no-data", nextRace: nil))

        default:
            WorkIntervalFace(rep: "Int 3 / 6", elapsed: "24:18", segments: workSegs,
                             currentPace: "6:33", targetPace: "6:31", deltaSeconds: 2,
                             heartRate: "168", cadence: "182", repFraction: 0.5, repTimeLeft: "0:24")
        }
    }
}

// MARK: - Fixture-only faces (deck §A/B/E/F2/G, reference component style)

/// Always-on dimmed (deck §D): the work face minus the progress row, dimmed
/// the way watchOS dims at ~1 Hz when the wrist drops.
private struct AODFixture: View {
    var body: some View {
        VStack(spacing: 0) {
            FaceHeader(label: "Int 3 / 6", color: WP.amber)
            VStack(spacing: -10) {
                Hero(value: "6:33", color: WP.green)
                RefLine(target: "6:31", delta: "+2s", deltaColor: WP.green)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            StatsRow(left: Stat(value: "168", unit: "bpm"), right: Stat(value: "182", unit: "spm"))
        }
        .executionFace()
        .saturation(0.85)
        .brightness(-0.18)
        .opacity(0.5)
    }
}

/// Pace-led cue flash (rep start / race phase shift) — the target PACE is the hero (the
/// number you execute on), under a context eyebrow, with a spec line: a distance/value
/// (`specIsValue`) or a coaching cue like "HOLD EFFORT".
private struct PaceCue: View {
    let eyebrow: String
    var color: Color = WP.green
    let pace: String
    let spec: String          // how long the rep/phase is — "800M", "2.1 MI" (the value)
    var body: some View {
        VStack(spacing: 4) {
            Text(eyebrow).font(WF.interBold(13)).tracking(1.1).foregroundStyle(color)
                .lineLimit(1).minimumScaleFactor(0.7)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(pace).font(WF.bebas(100)).foregroundStyle(color)
                Text("/MI").font(WF.interSemi(16)).foregroundStyle(WP.muted)
            }
            .lineLimit(1).minimumScaleFactor(0.5)
            Text(spec).font(WF.bebas(34)).foregroundStyle(WP.ink)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
    }
}

/// Paused state (mirrors PausedVeil): the whole screen becomes the paused read with one
/// big can't-miss Resume bar — so resuming after a traffic light is a single tap.
private struct PausedFixture: View {
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "pause.circle.fill").font(.system(size: 38)).foregroundStyle(WP.amber)
            Text("PAUSED").font(WF.bebas(34)).foregroundStyle(WP.ink).tracking(1)
            Text("24:18").font(WF.interSemi(13)).monospacedDigit().foregroundStyle(WP.muted)
            HStack(spacing: 8) {
                Image(systemName: "play.fill").font(.system(size: 16, weight: .bold))
                Text("RESUME").font(WF.oswald(16)).tracking(1.5)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 15)
            .foregroundStyle(Color(red: 0.016, green: 0.075, blue: 0.051))
            .background(WP.green, in: Capsule())
            .padding(.top, 6)
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
    }
}

/// Countdown (deck §B): "Get ready" + the big 3-count.
private struct CountdownFixture: View {
    var body: some View {
        Text("3")
            .font(WF.bebas(240))
            .foregroundStyle(WP.green)
            .lineLimit(1).minimumScaleFactor(0.3)
            .offset(y: 10)               // optically center: Bebas's line box rides high (empty descender below)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(WP.bg)
            .ignoresSafeArea()
    }
}

/// Workout-day home (deck §A): logo, readiness pill, session, meta, Start.
private struct HomeWorkoutFixture: View {
    var body: some View {
        VStack(spacing: 0) {
            // FAFF logo lifted level with the OS clock (top-right is the system's).
            HStack {
                Text("FAFF").font(WF.bebas(15)).italic().tracking(1.5).foregroundStyle(WP.orange)
                Spacer(minLength: 0)
            }
            .padding(.leading, 8).padding(.top, 20)
            ReadyPill(score: "82", word: "Primed").padding(.top, 10)
            Text("6×800").font(WF.bebas(52)).textCase(.uppercase).foregroundStyle(WP.ink)
                .lineLimit(2).minimumScaleFactor(0.45).multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.top, 10)
            Text("@ T · 6:31/MI").font(WF.oswald(15)).tracking(0.5).foregroundStyle(WP.orange)
            Text("52 MIN · 6.4 MI").font(WF.interSemi(13)).tracking(0.4).foregroundStyle(WP.muted)
                .padding(.top, 4)
            Spacer()
            StartButton()
        }
        .padding(.horizontal, 14).padding(.bottom, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
        .ignoresSafeArea(.container, edges: .top)
    }
}

/// Rest-day home (deck §A): plain REST + the body read.
private struct HomeRestFixture: View {
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("FAFF").font(WF.bebas(15)).italic().tracking(1.5).foregroundStyle(WP.orange)
                Spacer(minLength: 0)
            }
            .padding(.leading, 8).padding(.top, 20)
            Spacer()
            Text("REST").font(WF.bebas(70)).foregroundStyle(WP.green)
            Text("Recovery is the workout. Easy walk if you want it.")
                .font(WF.interSemi(12.5)).foregroundStyle(WP.muted)
                .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 178).padding(.top, 10)
            Text("HRV 68 · RHR 48").font(WF.interBold(13)).monospacedDigit()
                .foregroundStyle(WP.muted).padding(.top, 8)
            Spacer()
        }
        .padding(.horizontal, 14).padding(.bottom, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
        .ignoresSafeArea(.container, edges: .top)
    }
}

/// Pre-run briefing (deck §A): the structure before you go, with the dots.
private struct PreRunBriefingFixture: View {
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("TODAY").font(WF.interBold(12.5)).tracking(1.1).foregroundStyle(WP.muted)
                Spacer(minLength: 0)
            }
            .padding(.leading, 8).padding(.top, 20)
            Text("6×800").font(WF.bebas(52)).textCase(.uppercase).foregroundStyle(WP.ink)
                .lineLimit(2).minimumScaleFactor(0.45).multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.top, 12)
            Text("@ T · 6:31/MI · 60S REC").font(WF.oswald(15)).tracking(0.5).foregroundStyle(WP.orange)
            Text("EST 52 MIN · 6.4 MI").font(WF.interSemi(13)).tracking(0.4).foregroundStyle(WP.muted)
                .padding(.top, 4)
            DotsStrip(dots: briefingDots).padding(.top, 12)
            Spacer()
            StartButton()
        }
        .padding(.horizontal, 14).padding(.bottom, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
        .ignoresSafeArea(.container, edges: .top)
    }
    private var briefingDots: [DotsStrip.Dot] {
        var d: [DotsStrip.Dot] = [.init(weight: 1.4, color: Color.white.opacity(0.32))]
        for _ in 0..<6 {
            d.append(.init(weight: 1, color: WP.orange))
            d.append(.init(weight: 0.5, color: WP.orange.opacity(0.4)))
        }
        d.append(.init(weight: 1.4, color: Color.white.opacity(0.32)))
        return d
    }
}

/// In-run secondary stats — the swipe page off the work face for the "nice but rarely
/// looked at" metrics: elapsed, distance, avg pace, active calories. A 2×2 grid that fills
/// the screen. (Elapsed lives here, not the top-right corner the OS clock owns.)
struct InRunStatsFace: View {
    let elapsed: String
    let distance: String      // "3.2"
    let avgPace: String       // "6:42"
    let calories: String      // "412"
    var body: some View {
        // No header — the metric labels self-describe. The 2×2 grid fills the whole
        // screen below the clock (safe area respected), each cell centered in its quadrant.
        VStack(spacing: 0) {
            row(left: cell(elapsed, nil, "Elapsed"), right: cell(distance, "mi", "Distance"))
            Rectangle().fill(WP.line).frame(height: 1)
            row(left: cell(avgPace, "/mi", "Avg pace"), right: cell(calories, nil, "Calories"))
        }
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
    }
    private func row<L: View, R: View>(left: L, right: R) -> some View {
        HStack(spacing: 6) {
            left.frame(maxWidth: .infinity)
            Rectangle().fill(WP.line).frame(width: 1, height: 40)
            right.frame(maxWidth: .infinity)
        }
        .frame(maxHeight: .infinity)
    }
    private func cell(_ value: String, _ unit: String?, _ label: String) -> some View {
        VStack(spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value).font(WF.bebas(42)).monospacedDigit().foregroundStyle(WP.ink)
                if let unit { Text(unit).font(WF.interSemi(13)).foregroundStyle(WP.muted) }
            }
            .lineLimit(1).minimumScaleFactor(0.6)
            Text(label.uppercased()).font(WF.interBold(9.5)).tracking(0.7).foregroundStyle(WP.muted)
        }
    }
}

private struct InRunStatsFixture: View {
    var body: some View {
        InRunStatsFace(elapsed: "24:18", distance: "3.2", avgPace: "6:42", calories: "412")
    }
}

/// Pre-run DETAIL — swipe page 2 of the briefing: the step-by-step plan so you know exactly
/// what you're about to do. Phases listed top→bottom, repeated blocks collapsed to "5×".
private struct WorkoutDetailFixture: View {
    private struct Step: Identifiable {
        let id = UUID(); let n: String; let title: String; let detail: String; let color: Color
    }
    private let steps: [Step] = [
        .init(n: "1",  title: "Warm up",         detail: "15 min · easy · 8:29/mi",       color: WP.green),
        .init(n: "5×", title: "Cruise intervals", detail: "7 min @ 7:11/mi · 90s jog",     color: WP.orange),
        .init(n: "3",  title: "Cool down",        detail: "10 min · easy · 8:29/mi",       color: WP.muted),
    ]
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Eyebrow(text: "The plan", color: WP.orange)
                Spacer(minLength: 78)
            }
            .padding(.leading, 8).padding(.top, 20)
            Text("7.9 MI · 7:11/MI · ~57 MIN")
                .font(WF.interSemi(10.5)).tracking(0.3).foregroundStyle(WP.muted)
                .padding(.top, 3).padding(.leading, 8)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(steps.enumerated()), id: \.element.id) { idx, s in
                        if idx > 0 { Rectangle().fill(WP.line).frame(height: 1) }
                        HStack(alignment: .firstTextBaseline, spacing: 9) {
                            Text(s.n).font(WF.bebas(22)).foregroundStyle(s.color)
                                .frame(width: 30, alignment: .leading)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(s.title).font(WF.interBold(13)).foregroundStyle(WP.ink).lineLimit(1)
                                Text(s.detail.uppercased()).font(WF.interSemi(10)).tracking(0.3)
                                    .foregroundStyle(WP.muted).lineLimit(1).minimumScaleFactor(0.8)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 7)
                    }
                }
            }
            .padding(.top, 4)
        }
        .padding(.horizontal, 12).padding(.bottom, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
        .ignoresSafeArea(.container, edges: .top)
    }
}

/// Pre-race (deck §F2): goal, strategy, gels, the course strip, Start.
private struct PreRaceFixture: View {
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("BIG SUR").font(WF.interBold(12.5)).tracking(1.1).foregroundStyle(WP.orange)
                Spacer(minLength: 0)
            }
            .padding(.leading, 8).padding(.top, 20)
            Spacer(minLength: 6)
            Text("3:50").font(WF.bebas(64)).monospacedDigit().foregroundStyle(WP.ink)
            Text("EVEN EFFORT · 8:46 FLAT").font(WF.oswald(15)).tracking(0.5).foregroundStyle(WP.orange)
            Text("26.2 MI · 6 GELS").font(WF.interSemi(13)).tracking(0.4).foregroundStyle(WP.muted)
                .padding(.top, 4)
            // Course PROFILE by terrain/effort (not progress): climb = warn, descent = green,
            // rolling/flat = orange. So you can see where the hard parts are before you start.
            DotsStrip(dots: [
                .init(weight: 5, color: WP.orange),   // rolling start
                .init(weight: 5, color: WP.orange),   // rolling
                .init(weight: 2, color: WP.warn),     // Hurricane Point climb
                .init(weight: 2, color: WP.green),    // descent
                .init(weight: 8, color: WP.orange),   // rolling
                .init(weight: 4.2, color: WP.orange), // finish
            ]).padding(.top, 12)
            Spacer()
            StartButton()
        }
        .padding(.horizontal, 14).padding(.bottom, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
        .ignoresSafeArea(.container, edges: .top)
    }
}

/// Workout summary (deck §E): ring, Complete, a six-cell grid, save line.
private struct SummaryFixture: View {
    private let cells: [(String, String)] = [
        ("6/6", "Reps"), ("6:30", "Avg pace"), ("6.4", "Miles"),
        ("171", "Avg HR"), ("181", "Cadence"), ("52:14", "Time"),
    ]
    var body: some View {
        VStack(spacing: 0) {
            Text("COMPLETE").font(WF.bebas(28)).foregroundStyle(WP.ink)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 10) {
                ForEach(cells, id: \.1) { c in
                    VStack(spacing: 2) {
                        Text(c.0).font(WF.bebas(22)).monospacedDigit().foregroundStyle(WP.ink)
                        Text(c.1.uppercased()).font(WF.interBold(7.5)).tracking(0.4)
                            .foregroundStyle(WP.muted).lineLimit(1)
                    }
                }
            }
            .padding(.top, 13)
            Text("SAVED · SYNCING").font(WF.interSemi(9.5)).tracking(0.3)
                .foregroundStyle(WP.muted).padding(.top, 12)
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .background(WP.bg)
    }
}

/// Race finish (deck §F2): ring, Finish, the time vs goal, save line.
private struct RaceFinishFixture: View {
    var body: some View {
        VStack(spacing: 0) {
            Text("FINISH").font(WF.bebas(28)).foregroundStyle(WP.ink)
            Text("3:49:12").font(WF.bebas(56)).monospacedDigit().foregroundStyle(WP.green).padding(.top, 8)
            Text("48S UNDER GOAL · NEGATIVE SPLIT").font(WF.oswald(12)).tracking(0.4)
                .foregroundStyle(WP.green).multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true).padding(.top, 8)
            Text("SAVED · SYNCING").font(WF.interSemi(9.5)).tracking(0.3)
                .foregroundStyle(WP.muted).padding(.top, 12)
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .background(WP.bg)
    }
}

// MARK: - Small shared fixture bits

private struct ReadyPill: View {
    let score: String; let word: String
    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(WP.green).frame(width: 6, height: 6)
            Text("\(score) · \(word)").font(WF.interBold(10)).tracking(0.5).textCase(.uppercase)
                .foregroundStyle(WP.green)
        }
        .padding(.horizontal, 9).padding(.vertical, 4)
        .background(WP.green.opacity(0.15), in: Capsule())
    }
}

private struct StartButton: View {
    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: "play.fill").font(.system(size: 12, weight: .bold))
            Text("START").font(WF.oswald(15)).tracking(2)
        }
        .foregroundStyle(Color(red: 0.016, green: 0.075, blue: 0.051))
        .frame(maxWidth: .infinity).padding(.vertical, 13)
        .background(WP.green, in: Capsule())
    }
}

/// The plan dots strip (deck .w-dots) — proportional, colored by segment type.
private struct DotsStrip: View {
    struct Dot: Identifiable { let id = UUID(); let weight: CGFloat; let color: Color }
    let dots: [Dot]
    var body: some View {
        GeometryReader { g in
            let gap: CGFloat = 3
            let total = max(1, dots.reduce(0) { $0 + $1.weight })
            let avail = g.size.width - gap * CGFloat(max(0, dots.count - 1))
            HStack(spacing: gap) {
                ForEach(dots) { d in
                    Capsule().fill(d.color).frame(width: avail * d.weight / total)
                }
            }
        }
        .frame(height: 5)
    }
}

#Preview("Fixture · work") { WatchFixtureView(face: "work-interval") }
#Preview("Fixture · race") { WatchFixtureView(face: "race-view") }
