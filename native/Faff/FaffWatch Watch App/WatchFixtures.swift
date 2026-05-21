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

        // ── §B / §C3 / §F2 · transitions + countdown ──────────────────────
        case "countdown":
            CountdownFixture()
        case "heads-up-3s":
            TransitionFace(icon: "clock", title: "Ease off", titleColor: WP.amber, sub: "3 SECONDS LEFT")
        case "next-rep":
            TransitionFace(icon: "arrow.right", title: "Go · Int 4", titleColor: WP.green, sub: "TARGET 6:31/MI")
        case "phase-change":
            TransitionFace(icon: "chart.line.uptrend.xyaxis", title: "Hurricane climb",
                           titleColor: WP.orange, sub: "10:38 TARGET · HOLD EFFORT")
        case "fuel-cue":
            TransitionFace(icon: "bolt.fill", title: "Gel 3", titleColor: WP.orange,
                           sub: "+ WATER · 60G/HR, ON TRACK")

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
        case "pre-race":
            PreRaceFixture()

        // ── §G · on the watch face ────────────────────────────────────────
        case "glance":
            GlanceFixture()
        case "complication":
            ComplicationFixture()

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

/// Countdown (deck §B): "Get ready" + the big 3-count.
private struct CountdownFixture: View {
    var body: some View {
        VStack(spacing: 8) {
            Text("GET READY").font(WF.interBold(13)).tracking(1.1).foregroundStyle(WP.green)
            Text("3").font(WF.bebas(130)).foregroundStyle(WP.green)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
    }
}

/// Workout-day home (deck §A): logo, readiness pill, session, meta, Start.
private struct HomeWorkoutFixture: View {
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("FAFF").font(WF.bebas(15)).italic().tracking(1.5).foregroundStyle(WP.orange)
                Spacer()
                Text("7:14").font(WF.interBold(11)).monospacedDigit().foregroundStyle(WP.muted)
            }
            ReadyPill(score: "82", word: "Primed").padding(.top, 10)
            Text("6×800").font(WF.bebas(52)).textCase(.uppercase).foregroundStyle(WP.ink)
                .padding(.top, 10)
            Text("@ T · 6:31/MI").font(WF.oswald(12)).tracking(0.5).foregroundStyle(WP.orange)
            Text("52 MIN · 6.4 MI").font(WF.interSemi(10.5)).tracking(0.5).foregroundStyle(WP.muted)
                .padding(.top, 4)
            Spacer()
            StartButton()
        }
        .padding(.horizontal, 14).padding(.vertical, 13)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
    }
}

/// Rest-day home (deck §A): plain REST + the body read.
private struct HomeRestFixture: View {
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("FAFF").font(WF.bebas(15)).italic().tracking(1.5).foregroundStyle(WP.orange)
                Spacer()
                Text("7:14").font(WF.interBold(11)).monospacedDigit().foregroundStyle(WP.muted)
            }
            Spacer()
            Text("REST DAY").font(WF.interBold(13)).tracking(1.1).foregroundStyle(WP.green)
            Text("REST").font(WF.bebas(70)).foregroundStyle(WP.green).padding(.top, 4)
            Text("Recovery is the workout. Easy walk if you want it.")
                .font(WF.interSemi(12.5)).foregroundStyle(WP.muted)
                .multilineTextAlignment(.center).frame(maxWidth: 150).padding(.top, 10)
            Text("HRV 68 · RHR 48").font(WF.interBold(13)).monospacedDigit()
                .foregroundStyle(WP.muted).padding(.top, 8)
            Spacer()
        }
        .padding(.horizontal, 14).padding(.vertical, 13)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
    }
}

/// Pre-run briefing (deck §A): the structure before you go, with the dots.
private struct PreRunBriefingFixture: View {
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("TODAY · READY").font(WF.interBold(12.5)).tracking(1.1).foregroundStyle(WP.muted)
                Spacer()
                Text("7:14").font(WF.interBold(11)).monospacedDigit().foregroundStyle(WP.muted)
            }
            Text("6×800").font(WF.bebas(52)).textCase(.uppercase).foregroundStyle(WP.ink)
                .padding(.top, 12)
            Text("@ T · 6:31/MI · 60S REC").font(WF.oswald(12)).tracking(0.5).foregroundStyle(WP.orange)
            Text("EST 52 MIN · 6.4 MI").font(WF.interSemi(10.5)).tracking(0.5).foregroundStyle(WP.muted)
                .padding(.top, 4)
            DotsStrip(dots: briefingDots).padding(.top, 12)
            Spacer()
            StartButton()
        }
        .padding(.horizontal, 14).padding(.vertical, 13)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
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

/// Pre-race (deck §F2): goal, strategy, gels, the course strip, Start.
private struct PreRaceFixture: View {
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("BIG SUR · READY").font(WF.interBold(12.5)).tracking(1.1).foregroundStyle(WP.orange)
                Spacer()
                Text("7:28").font(WF.interBold(11)).monospacedDigit().foregroundStyle(WP.muted)
            }
            Spacer(minLength: 6)
            Text("3:50").font(WF.bebas(64)).monospacedDigit().foregroundStyle(WP.ink)
            Text("EVEN EFFORT · 8:46 FLAT").font(WF.oswald(12)).tracking(0.5).foregroundStyle(WP.orange)
            Text("26.2 MI · 6 GELS").font(WF.interSemi(10.5)).tracking(0.5).foregroundStyle(WP.muted)
                .padding(.top, 4)
            DotsStrip(dots: [
                .init(weight: 5, color: WP.orange), .init(weight: 5, color: WP.orange),
                .init(weight: 2, color: WP.orange), .init(weight: 2, color: WP.orange),
                .init(weight: 8, color: WP.orange), .init(weight: 4.2, color: WP.orange),
            ]).padding(.top, 12)
            Spacer()
            StartButton()
        }
        .padding(.horizontal, 14).padding(.vertical, 13)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
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
            CheckRing()
            Text("COMPLETE").font(WF.bebas(28)).foregroundStyle(WP.ink).padding(.top, 8)
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
            CheckRing()
            Text("FINISH").font(WF.bebas(28)).foregroundStyle(WP.ink).padding(.top, 8)
            Text("3:49:12").font(WF.bebas(56)).monospacedDigit().foregroundStyle(WP.green).padding(.top, 8)
            Text("48S UNDER GOAL · NEGATIVE SPLIT").font(WF.oswald(12)).tracking(0.4)
                .foregroundStyle(WP.green).multilineTextAlignment(.center).padding(.top, 8)
            Text("SAVED · SYNCING").font(WF.interSemi(9.5)).tracking(0.3)
                .foregroundStyle(WP.muted).padding(.top, 12)
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .background(WP.bg)
    }
}

/// Readiness glance (deck §G): the watch's slice of the phone read.
private struct GlanceFixture: View {
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("READINESS").font(WF.interBold(12.5)).tracking(1.1).foregroundStyle(WP.green)
                Spacer()
                Text("7:14").font(WF.interBold(11)).monospacedDigit().foregroundStyle(WP.muted)
            }
            Spacer()
            Text("RECOVERED").font(WF.interBold(11)).tracking(1.2).foregroundStyle(WP.muted)
            Text("82").font(WF.bebas(96)).foregroundStyle(WP.green).padding(.top, 15)
            Text("HRV 68 · RHR 48").font(WF.interSemi(12)).foregroundStyle(WP.muted).padding(.top, 13)
            Text("CIM · 198 DAYS").font(WF.interSemi(12)).foregroundStyle(WP.muted).padding(.top, 12)
            Spacer()
        }
        .padding(.horizontal, 14).padding(.vertical, 13)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
    }
}

/// Complication (deck §G): the time + today's session/readiness chips.
private struct ComplicationFixture: View {
    var body: some View {
        ZStack {
            Text("7:14").font(WF.bebas(58)).monospacedDigit().foregroundStyle(WP.ink)
            VStack {
                Spacer()
                HStack(spacing: 6) {
                    chip(orange: "6×800", rest: "today")
                    chip(orange: "82", rest: "ready")
                }
                .padding(.bottom, 6)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
    }
    private func chip(orange: String, rest: String) -> some View {
        HStack(spacing: 5) {
            Text(orange).font(WF.bebas(14)).foregroundStyle(WP.orange)
            Text(rest).font(WF.interBold(10)).foregroundStyle(WP.ink)
        }
        .padding(.horizontal, 9).padding(.vertical, 5)
        .background(Color.white.opacity(0.10), in: Capsule())
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

private struct CheckRing: View {
    var body: some View {
        Circle().stroke(WP.green, lineWidth: 3).frame(width: 40, height: 40)
            .overlay(Image(systemName: "checkmark").font(.system(size: 16, weight: .bold)).foregroundStyle(WP.green))
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
