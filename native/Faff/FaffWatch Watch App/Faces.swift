//
//  Faces.swift
//  FaffWatch
//
//  Parameterised live-data versions of the locked face system. The router
//  (ActiveWorkoutView) maps engine + tracker state to these faces' props.
//  Layout / colour grammar is locked in FaceKit.swift; this file is the
//  visual surface for every in-run moment.
//
//  Naming maps to the engine's phase states:
//
//      WorkIntervalFace  ← phase.type == .work, non-race
//      LiveRaceFace      ← workout.isRace
//      EasyFace          ← easy / long / steady runs (rotating guardrail)
//      SteadyRunFace     ← cooldown / overtime (no target pace)
//      RestFace          ← phase.type == .recovery (countdown + next preview)
//      WarmupFace        ← phase.type == .warmup
//      GoFace            ← 2 s takeover when work begins
//      FuelFace          ← gel cue (any workout — race or training)
//      LandmarkFace      ← landmark cue (race)
//      MileSplitFace     ← auto-lap takeover
//      PauseFace         ← long-press / auto-pause overlay
//      CompleteFace      ← summary card with Done
//      TodayDoneFace     ← 1.5 s after Done dismisses
//      CalibrateFace     ← race-day GPS re-sync stepper
//

import SwiftUI
import Combine

// MARK: - Gradient helpers

private func wash(_ hex: UInt32) -> AnyView {
    AnyView(LinearGradient(colors: [Color(hex: hex), .black],
                           startPoint: .top, endPoint: .bottom).ignoresSafeArea())
}
private func radial(_ hex: UInt32) -> AnyView {
    AnyView(RadialGradient(colors: [Color(hex: hex), .black],
                           center: .topLeading, startRadius: 0, endRadius: 230).ignoresSafeArea())
}

// =====================================================================
// MAIN NUMBER-STACK FACES  (via the locked NumberFace primitive)
// =====================================================================

/// Rep · work face — live pace · target · total miles · rep counter · strip.
/// Live pace colour reflects the drift zone (green/amber/red); target is
/// reference white; total distance is canonical blue; bottom counter is white.
struct WorkIntervalFace: View {
    let livePace: String        // "6:33"
    let paceRole: Role          // .live / .goal / .over from PaceZone
    let targetPace: String      // "6:31"
    let totalDistance: String   // "3.78"
    let repCounter: String      // "0:24" (time left) or "0.30" (miles left)
    let stripStates: [Int]      // [1,1,1,2,0,0] per session segment

    var body: some View {
        NumberFace(
            rows: [
                NumRow(livePace,      paceRole),
                NumRow(targetPace,    .neutral),
                NumRow(totalDistance, .dist),
                NumRow(repCounter,    .neutral)
            ],
            strip: Strip(states: stripStates)
        )
    }
}

/// Race face — live pace · phase target · total miles · delta-to-goal · phase strip.
/// Delta-to-goal is `goalDeltaRole` (green = ahead/equal, over = behind).
struct LiveRaceFace: View {
    let livePace: String        // "8:28"
    let paceRole: Role
    let phaseTarget: String     // "8:30"
    let totalDistance: String   // "10.8"
    let goalDelta: String       // "+1:14" / "-0:42"
    let goalDeltaRole: Role     // .live / .over (or .neutral until banked)
    let phaseSegments: [Int]    // 0 empty, 1 done, 2 now

    var body: some View {
        NumberFace(
            rows: [
                NumRow(livePace,      paceRole),
                NumRow(phaseTarget,   .neutral),
                NumRow(totalDistance, .dist),
                NumRow(goalDelta,     goalDeltaRole)
            ],
            strip: Strip(states: phaseSegments,
                         doneColor: Faff.goal, nowColor: Faff.goal)
        )
    }
}

/// Easy face — live pace (in range) · rotating guardrail (HR ♥ / cadence 🏃) ·
/// miles-to-go. HR-over-ceiling overrides + holds red on the guardrail row so
/// the alert can't be missed (and you can't swipe past it like a banner).
struct EasyFace: View {
    let pace: String
    let paceRole: Role
    let hr: String
    let hrOver: Bool
    let cadence: String
    let distance: String

    @State private var idx = 0
    // 60s in production = comfortable read; the prototype used 3s for demo.
    private let timer = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

    private var guardrail: NumRow {
        if hrOver { return NumRow(hr, .over, icon: "heart.fill") }
        return idx == 0
            ? NumRow(hr, .neutral, icon: "heart.fill")
            : NumRow(cadence, .neutral, icon: "figure.run")
    }
    var body: some View {
        NumberFace(rows: [
            NumRow(pace, paceRole),
            guardrail,
            NumRow(distance, .dist)
        ])
        .onReceive(timer) { _ in if !hrOver { idx = (idx + 1) % 2 } }
    }
}

/// Progression face — live · target (current step) · total miles · miles-to-next-step.
struct ProgressionFace: View {
    let livePace: String
    let paceRole: Role
    let stepTarget: String
    let totalDistance: String
    let toNextStep: String      // miles or m:ss until the next step
    var body: some View {
        NumberFace(rows: [
            NumRow(livePace,      paceRole),
            NumRow(stepTarget,    .neutral),
            NumRow(totalDistance, .dist),
            NumRow(toNextStep,    .neutral)
        ])
    }
}

/// HR-governed face (MAF / Z2 / heat flag) — same row order as Easy, but green
/// highlight on HR (the guardrail you're holding), neutral on pace below it.
struct HRFace: View {
    let pace: String
    let hr: String
    let hrRole: Role            // .live in zone, .over above ceiling, .neutral otherwise
    let distance: String
    var body: some View {
        NumberFace(rows: [
            NumRow(pace,     .neutral),
            NumRow(hr,       hrRole, icon: "heart.fill"),
            NumRow(distance, .dist)
        ])
    }
}

/// Strides face — green live · white burst countdown · strip.
struct StridesFace: View {
    let livePace: String
    let burstCountdown: String
    let stripStates: [Int]
    var body: some View {
        NumberFace(rows: [
            NumRow(livePace,        .live),
            NumRow(burstCountdown,  .neutral)
        ],
                   strip: Strip(states: stripStates))
    }
}

/// Steady / cooldown / overtime — three big numbers, no target. Live pace +
/// distance + elapsed. Used for warmup-then-easy, cooldown, and overtime (the
/// "plan done · keep going" state) where there's nothing to chase.
struct SteadyRunFace: View {
    let livePace: String
    let paceRole: Role          // .live during easy execution, .neutral when no target
    let distance: String
    let elapsed: String
    var body: some View {
        NumberFace(rows: [
            NumRow(livePace, paceRole),
            NumRow(distance, .dist),
            NumRow(elapsed,  .neutral)
        ])
    }
}

// =====================================================================
// TWO-GROUP FACES (label + value, calm blue)
// =====================================================================

private struct LabelGroup: View {
    let label: String
    let values: [(String, Role)]
    let labelSize: CGFloat
    let valueSize: CGFloat
    var labelColor: Color = Faff.mute
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            FaceLabel(text: label, color: labelColor, size: labelSize)
            ForEach(Array(values.enumerated()), id: \.offset) { _, v in
                BigValue(text: v.0, role: v.1, size: valueSize)
            }
        }
    }
}

/// Recovery — REST countdown hero + NEXT rep preview (pace + distance).
struct RestFace: View {
    let restTimeLeft: String    // "1:30"
    let nextTargetPace: String  // "6:31"  (next rep's pace)
    let nextDistance: String    // "0.50"  (next rep's distance / "800m")
    var body: some View {
        Screen(background: radial(0x06243F)) {
            GeometryReader { geo in
                let h = geo.size.height
                VStack(alignment: .leading, spacing: h * 0.05) {
                    LabelGroup(label: "Rest", values: [(restTimeLeft, .rest)],
                               labelSize: h * 0.075, valueSize: h * 0.30)
                    LabelGroup(label: "Next",
                               values: [(nextTargetPace, .neutral), (nextDistance, .dist)],
                               labelSize: h * 0.075, valueSize: h * 0.19)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                .padding(.horizontal, h * 0.045)
            }
        }
    }
}

/// Warmup — WARMUP distance/time covered + THEN first effort target + distance.
struct WarmupFace: View {
    let coveredValue: String    // "0.4"  miles covered, or "2:15" elapsed
    let thenPace: String        // "6:31"
    let thenDistance: String    // "0.50"
    var body: some View {
        Screen(background: radial(0x06243F)) {
            GeometryReader { geo in
                let h = geo.size.height
                VStack(alignment: .leading, spacing: h * 0.05) {
                    LabelGroup(label: "Warmup", values: [(coveredValue, .rest)],
                               labelSize: h * 0.075, valueSize: h * 0.30)
                    LabelGroup(label: "Then",
                               values: [(thenPace, .neutral), (thenDistance, .dist)],
                               labelSize: h * 0.075, valueSize: h * 0.19)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                .padding(.horizontal, h * 0.045)
            }
        }
    }
}

// =====================================================================
// PAUSE — frozen, greyed, with Resume
// =====================================================================

struct LivePauseFace: View {
    let distance: String        // "4.10"
    let elapsed: String         // "38:20"
    var onResume: () -> Void = {}
    var body: some View {
        Screen(background: AnyView(Color(hex: 0x0A0D12).ignoresSafeArea())) {
            GeometryReader { geo in
                let h = geo.size.height
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: h * 0.05) {
                        RoundedRectangle(cornerRadius: h * 0.02).fill(Faff.mute).frame(width: h * 0.085)
                        RoundedRectangle(cornerRadius: h * 0.02).fill(Faff.mute).frame(width: h * 0.085)
                    }
                    .frame(width: h * 0.22, height: h * 0.20)
                    Spacer(minLength: 0)
                    BigValue(text: distance, role: .dist, size: h * 0.22, opacity: 0.55)
                    Spacer(minLength: 0)
                    BigValue(text: elapsed, role: .neutral, size: h * 0.22, opacity: 0.55)
                    Spacer(minLength: 0)
                    Button(action: onResume) {
                        Text("Resume")
                            .font(.custom("HelveticaNeue-Bold", size: h * 0.12))
                            .foregroundStyle(Color(hex: 0x06210C))
                            .frame(maxWidth: .infinity).padding(.vertical, h * 0.022)
                            .background(Capsule().fill(Faff.live))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, h * 0.075)
                .padding(.top, h * 0.075)
                .padding(.bottom, h * 0.085)         // clear bottom bezel curve
            }
        }
    }
}

// =====================================================================
// TAKEOVERS (glyph + big cue + sub)
// =====================================================================

/// Takeover layout = glyph (top) · big cue (centre) · sub (bottom). The bottom
/// row gets ~10% bottom padding so it clears Apple Watch's bottom-corner curve
/// — without that the sub-text's descenders ride into the bezel on hardware
/// (caught on TestFlight; sim screenshots are flat-rectangular so they don't
/// reveal it). Horizontal padding is similar — the bottom corners are the
/// tightest squeeze; the curve at left/right midline is generous.
private struct Takeover<Glyph: View>: View {
    let glyph: Glyph
    let big: String
    let bigColor: Color
    let sub: String
    var bigSize: CGFloat = 0.42
    var body: some View {
        GeometryReader { geo in
            let h = geo.size.height
            VStack(alignment: .leading, spacing: 0) {
                glyph
                    .frame(maxHeight: .infinity, alignment: .top)
                    .padding(.top, h * 0.045)            // clear the OS clock baseline
                Text(big).foregroundStyle(bigColor).tightNumber(h * bigSize)
                    .frame(maxHeight: .infinity, alignment: .center)
                Text(sub).font(.custom("HelveticaNeue-Bold", size: h * 0.10))
                    .foregroundStyle(Color(hex: 0xCFD2D8))
                    .lineLimit(1).minimumScaleFactor(0.5)
                    .frame(maxHeight: .infinity, alignment: .bottom)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, h * 0.075)             // clear left/right bezel curve
            .padding(.bottom, h * 0.105)                 // clear the bottom-corner curve
        }
    }
}

/// GO — green takeover when a work rep begins.
struct GoFace: View {
    let sub: String     // "Rep 1 · 6:31" / "Hold target"
    var body: some View {
        Screen(background: wash(0x0C2A14)) {
            GeometryReader { geo in
                let h = geo.size.height
                Takeover(glyph: Image(systemName: "play.fill")
                            .font(.system(size: h * 0.18))
                            .foregroundStyle(Faff.live),
                         big: "GO", bigColor: Faff.live, sub: sub, bigSize: 0.52)
            }
        }
    }
}

/// HEADS-UP — amber takeover ~3 s before a work rep ends. Clock glyph +
/// "ALMOST" + sub showing seconds/distance left. Auto-dismisses with the rep.
struct HeadsUpFace: View {
    let sub: String     // "3 SECONDS LEFT" / "200M LEFT" / nil-passing yields ""
    var body: some View {
        Screen(background: wash(0x3A2B08)) {
            GeometryReader { geo in
                let h = geo.size.height
                Takeover(glyph: Image(systemName: "clock")
                            .font(.system(size: h * 0.15))
                            .foregroundStyle(Faff.goal),
                         big: "ALMOST", bigColor: Faff.goal, sub: sub, bigSize: 0.38)
            }
        }
    }
}

/// PHASE CHANGE — race-day takeover when crossing into a new course phase
/// (e.g. "HURRICANE CLIMB"). Mountain glyph + phase name + new pace target.
struct PhaseChangeFace: View {
    let title: String   // "HURRICANE CLIMB"
    let sub: String     // "10:38/MI · HOLD EFFORT"
    var body: some View {
        Screen(background: wash(0x3A2B08)) {
            GeometryReader { geo in
                let h = geo.size.height
                Takeover(glyph: Image(systemName: "mountain.2.fill")
                            .font(.system(size: h * 0.14))
                            .foregroundStyle(Faff.goal),
                         big: title.uppercased(), bigColor: Faff.goal, sub: sub,
                         bigSize: 0.26)
            }
        }
    }
}

/// Fuel — gel cue (amber = act now). Workout-type-agnostic: fires for any
/// workout whose plan ships fuel markers (race or training). PERSISTENT —
/// stays on screen until the runner swipes it down to acknowledge. Just two
/// big lines (GEL / N of M) so the read is instant at a glance during a
/// run. The chevron at the bottom is the discoverability hint; the actual
/// dismiss gesture is wired in `ActiveWorkoutView` (DragGesture, ≥24pt).
struct FuelFace: View {
    let index: Int      // 1-based gel number
    let total: Int      // total gels in this run
    var body: some View {
        Screen(background: wash(0x3A2B08)) {
            GeometryReader { geo in
                let h = geo.size.height
                VStack(spacing: 0) {
                    Spacer(minLength: 0)
                    Text("GEL")
                        .font(.custom("HelveticaNeue-Bold", size: h * 0.34))
                        .foregroundStyle(Faff.goal)
                        .padding(.vertical, -h * 0.34 * 0.22)
                    Text("\(index) of \(total)")
                        .font(.custom("HelveticaNeue-Bold", size: h * 0.22))
                        .foregroundStyle(Faff.goal)
                        .padding(.vertical, -h * 0.22 * 0.22)
                        .padding(.top, h * 0.025)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.compact.down")
                        .font(.system(size: h * 0.085, weight: .bold))
                        .foregroundStyle(Color(hex: 0xCFD2D8).opacity(0.55))
                        .padding(.bottom, h * 0.035)
                        .allowsHitTesting(false)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            }
        }
    }
}

/// Landmark — course cue (calm blue). Distance-anchored mid-race notable.
struct LandmarkFace: View {
    let big: String     // "BIXBY"
    let sub: String     // "0.3 mi ahead"
    var body: some View {
        Screen(background: wash(0x06243F)) {
            GeometryReader { geo in
                let h = geo.size.height
                Takeover(glyph: Image(systemName: "diamond.fill")
                            .font(.system(size: h * 0.15))
                            .foregroundStyle(Faff.rest),
                         big: big, bigColor: Faff.rest, sub: sub, bigSize: 0.36)
            }
        }
    }
}

/// Mile-split — full-width MILE header + pace, centered. No OS clock dance:
/// the takeover briefly dominates after every auto-lap event.
struct MileSplitFace: View {
    let mile: String    // "MILE 7"
    let pace: String    // "8:42"
    var body: some View {
        Screen(background: wash(0x11151C)) {
            GeometryReader { geo in
                let h = geo.size.height
                VStack(spacing: h * 0.02) {
                    Text(mile).foregroundStyle(Color(hex: 0xAAB0BF)).tightNumber(h * 0.26)
                    Text(pace).foregroundStyle(Faff.live).tightNumber(h * 0.46)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            }
        }
    }
}

// =====================================================================
// JUST RUN (unstructured-run escape hatch — always one swipe away)
// =====================================================================

/// JustRunFace — the "I just want to go run" page. Available as a TabView
/// page on every home variant (rest day, workout day, no-phone-paired day).
/// Tapping START spins up an unstructured WatchWorkout (one open-ended
/// `.work` phase with no target pace) which routes to SteadyRunFace under
/// the existing single-work-phase router rule.
struct JustRunFace: View {
    var onStart: () -> Void = {}
    var body: some View {
        Screen {
            GeometryReader { geo in
                let h = geo.size.height
                VStack(alignment: .leading, spacing: 0) {
                    FaceLabel(text: "Just run", color: Faff.mute, size: h * 0.06)
                        .topTagInset(h)
                    Spacer(minLength: 0)
                    // Single big glyph centred — no target to chase, so there
                    // are no number rows. The icon says "going for a run."
                    Image(systemName: "figure.run")
                        .font(.system(size: h * 0.40, weight: .bold))
                        .foregroundStyle(Faff.ink)
                        .frame(maxWidth: .infinity, alignment: .center)
                    Spacer(minLength: 0)
                    Button(action: onStart) {
                        HStack(spacing: h * 0.035) {
                            Image(systemName: "play.fill")
                                .font(.system(size: h * 0.065, weight: .bold))
                            Text("START")
                                .font(.custom("HelveticaNeue-Bold", size: h * 0.10))
                                .tracking(2)
                        }
                        .foregroundStyle(Color(hex: 0x06210C))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, h * 0.030)
                        .background(Capsule().fill(Faff.live))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, h * 0.075)
                .padding(.bottom, h * 0.085)
            }
        }
    }
}

// =====================================================================
// LOBBY (pre-run launchpad — what you're about to do, then START)
// =====================================================================

/// LobbyFace — the pre-run screen. Three big number rows sized identically:
///   · distance  (blue · canon)
///   · pace      (green · live)
///   · time      (white · neutral · est minutes OR race goal time)
/// A small workout-name tag sits up top so you know which session is loaded,
/// and a Faff.live capsule at the bottom is the START.
///
/// Same layout for easy / threshold / long / race. The VALUES tell the story
/// — a race shows goal time + race pace + race distance, a workout shows
/// est minutes + work pace + total distance. No layout fork by type.
struct LobbyFace: View {
    let name: String        // "5×7" / "EASY" / "BIG SUR"
    let distance: String    // "5.8" / "26.2"
    let pace: String        // "6:31" / "8:46"
    let time: String        // "52" (workout, minutes) / "3:50" (race, hms)
    /// Optional pace range ("8:29-8:59") to show as a small muted subtitle
    /// directly under the pace number — for easy/long runs where you have
    /// a band, not a single target. Nil hides the row entirely (races,
    /// fixed-target workouts).
    var paceRange: String? = nil
    /// Show a clock glyph next to the time number. Default on — needed when
    /// `time` is a bare minute count ("61") so the row reads as duration.
    /// Pass false for races where `time` is already h:mm ("3:50") and the
    /// format alone reads as time.
    var showTimeIcon: Bool = true
    var onStart: () -> Void = {}

    var body: some View {
        Screen {
            GeometryReader { geo in
                let h = geo.size.height
                VStack(alignment: .leading, spacing: 0) {
                    // Tag — workout name (small, muted, top-left). Baseline-
                    // aligned with the OS clock via topTagInset.
                    FaceLabel(text: name, color: Faff.mute, size: h * 0.06)
                        .topTagInset(h)
                    Spacer(minLength: 0)
                    // Three data rows, equal-sized. Locked colour grammar:
                    // distance always blue, pace always green-when-on-target,
                    // time/duration neutral white. No labels — position +
                    // colour carry meaning, same as the in-run faces.
                    BigValue(text: distance, role: .dist,    size: h * 0.19)
                    Spacer(minLength: 0)
                    BigValue(text: pace,     role: .live,    size: h * 0.19)
                    // Pace range subtitle — only renders for runs with a
                    // tolerance band. Sits in the natural gap between pace
                    // and time rows so the 3-big-number cadence isn't broken.
                    if let paceRange {
                        Text(paceRange)
                            .font(.custom("HelveticaNeue-Bold", size: h * 0.050))
                            .tracking(0.8)
                            .foregroundStyle(Faff.mute)
                            .padding(.top, h * 0.005)
                    }
                    Spacer(minLength: 0)
                    // Time row — number + small clock icon. The bare integer
                    // "61" is ambiguous on its own (could be HR, calories,
                    // anything); the clock glyph identifies it as a duration.
                    // Matches the in-run pattern: HR has ♥, cadence has 🏃.
                    // Races (h:mm-formatted goal) can opt out by passing
                    // `showTimeIcon: false`. Icon is vertically centered on
                    // the digit row — baseline-align made the clock sit on
                    // the digit's baseline, which read as "dropped low."
                    HStack(alignment: .center, spacing: h * 0.030) {
                        Text(time)
                            .font(.custom("HelveticaNeue-Bold", size: h * 0.19))
                            .foregroundStyle(Faff.ink)
                            .padding(.vertical, -h * 0.19 * 0.22)
                        if showTimeIcon {
                            Image(systemName: "clock")
                                .font(.system(size: h * 0.08, weight: .bold))
                                .foregroundStyle(Faff.mute)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Spacer(minLength: 0)
                    // START — the only action on the screen.
                    Button(action: onStart) {
                        HStack(spacing: h * 0.035) {
                            Image(systemName: "play.fill")
                                .font(.system(size: h * 0.065, weight: .bold))
                            Text("START")
                                .font(.custom("HelveticaNeue-Bold", size: h * 0.10))
                                .tracking(2)
                        }
                        .foregroundStyle(Color(hex: 0x06210C))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, h * 0.030)
                        .background(Capsule().fill(Faff.live))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, h * 0.075)
                .padding(.bottom, h * 0.085)         // clear bottom bezel curve
            }
        }
    }
}

// =====================================================================
// SUMMARY / END FACES
// =====================================================================

/// Complete — session readout: type label · pace · distance · elapsed · Done.
struct CompleteFace: View {
    let label: String       // "Threshold" / "Easy run" / "Big Sur"
    let pace: String        // "8:48"
    let distance: String    // "9.6"
    let elapsed: String     // "1:24"
    var onDone: () -> Void = {}
    var body: some View {
        Screen(background: radial(0x0C2A14)) {
            GeometryReader { geo in
                let h = geo.size.height
                VStack(alignment: .leading, spacing: 0) {
                    // Type label at the top, baseline-aligned with the OS
                    // clock (via topTagInset, not centred with the values).
                    FaceLabel(text: label, color: Faff.live, size: h * 0.06)
                        .topTagInset(h)
                    // Three big rows centred in whatever's left.
                    VStack(alignment: .leading, spacing: h * 0.012) {
                        BigValue(text: pace,     role: .live,    size: h * 0.18)
                        BigValue(text: distance, role: .dist,    size: h * 0.18)
                        BigValue(text: elapsed,  role: .neutral, size: h * 0.18)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                    Button(action: onDone) {
                        Text("Done")
                            .font(.custom("HelveticaNeue-Bold", size: h * 0.12))
                            .foregroundStyle(Color(hex: 0x06210C))
                            .frame(maxWidth: .infinity).padding(.vertical, h * 0.022)
                            .background(Capsule().fill(Faff.live))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, h * 0.075)
                .padding(.bottom, h * 0.085)         // clear bottom bezel curve
            }
        }
    }
}

/// Today complete — post-Done confirmation (1.5 s).
struct TodayDoneFace: View {
    var body: some View {
        Screen(background: radial(0x0C2A14)) {
            GeometryReader { geo in
                let h = geo.size.height
                VStack(spacing: h * 0.03) {
                    Image(systemName: "checkmark")
                        .font(.system(size: h * 0.34, weight: .bold))
                        .foregroundStyle(Faff.live)
                    FaceLabel(text: "Today complete", color: Faff.live, size: h * 0.075)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            }
        }
    }
}

/// Calibrate — race-day GPS re-sync stepper.
struct CalibrateFace: View {
    let mile: Int
    var onMinus: () -> Void = {}
    var onPlus: () -> Void = {}
    var onSet: () -> Void = {}
    var body: some View {
        Screen {
            GeometryReader { geo in
                let h = geo.size.height
                VStack(spacing: 0) {
                    VStack(spacing: h * 0.02) {
                        FaceLabel(text: "Calibrate · mile marker", color: Faff.mute, size: h * 0.06)
                        HStack(spacing: h * 0.06) {
                            Button(action: onMinus) {
                                Image(systemName: "minus.circle.fill")
                                    .font(.system(size: h * 0.13)).foregroundStyle(Faff.mute)
                            }.buttonStyle(.plain)
                            Text("\(mile)").foregroundStyle(Faff.dist).tightNumber(h * 0.34)
                            Button(action: onPlus) {
                                Image(systemName: "plus.circle.fill")
                                    .font(.system(size: h * 0.13)).foregroundStyle(Faff.mute)
                            }.buttonStyle(.plain)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                    Button(action: onSet) {
                        Text("Set mile \(mile)")
                            .font(.custom("HelveticaNeue-Bold", size: h * 0.10))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, h * 0.04)
                            .background(Capsule().fill(Faff.brand))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, h * 0.075)
                .padding(.bottom, h * 0.085)         // clear bottom bezel curve
            }
        }
    }
}
