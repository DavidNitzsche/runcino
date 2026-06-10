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
    /// "REP 2/4" style label. Computed from stripStates by default so
    /// callers don't have to do it.
    var topLabel: String? = nil
    /// Work-phase ordinal (1-based) and total work-phase count, supplied by
    /// the caller when the strip contains non-work phases (warmup/recovery/
    /// cooldown). When set, these take precedence over the strip-derived count
    /// so the face reads "REP 2/4" instead of "REP 4/9" (W-0b, 2026-06-09).
    var repNo: Int? = nil
    var totalReps: Int? = nil
    /// Live HR for quality work (intervals/threshold). When non-nil the
    /// third row shows HR (♥) coloured by `hrRole` INSTEAD of total
    /// distance — HR is the effort read on a quality rep, and total
    /// distance is the least load-bearing number mid-rep (the strip +
    /// rep counter already convey progress). Nil (cold-start / no LTHR)
    /// falls back to the distance row.
    var hr: String? = nil
    /// .live once live HR reaches the carried floor, .neutral below,
    /// .mute before the first reading. No .over — quality work has no
    /// HR ceiling, so HR never reads as an error.
    var hrRole: Role = .neutral
    /// Small reference appended to the top label: "♥162+" (intervals ·
    /// floor — HR keeps climbing past LTHR on VO2max reps) or "♥149"
    /// (threshold · target — run AT LTHR). Nil hides it.
    var hrReference: String? = nil

    private var derivedLabel: String {
        let base: String
        if let t = topLabel {
            base = t
        } else if let n = repNo, let total = totalReps {
            base = "REP \(n)/\(total)"
        } else {
            let nowIdx = stripStates.firstIndex(where: { $0 == 2 }) ?? 0
            base = "REP \(nowIdx + 1)/\(stripStates.count)"
        }
        if let ref = hrReference { return "\(base) · \(ref)" }
        return base
    }

    /// Third row · live HR (♥) when a quality HR floor is present, else
    /// the canonical total-distance read.
    private var thirdRow: NumRow {
        if let hr = hr { return NumRow(hr, hrRole, icon: "heart.fill") }
        return NumRow(totalDistance, .dist)
    }

    var body: some View {
        NumberFace(
            rows: [
                NumRow(livePace,   paceRole),
                NumRow(targetPace, .neutral),
                thirdRow,
                NumRow(repCounter, .neutral)
            ],
            topLabel: derivedLabel,
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
    /// Optional phase name override ("OPENER", "BUILD", "FINISH", etc.).
    /// Defaults to "PHASE n/m" computed from segments.
    var topLabel: String? = nil

    private var derivedLabel: String {
        if let t = topLabel { return t }
        let nowIdx = phaseSegments.firstIndex(where: { $0 == 2 }) ?? 0
        return "PHASE \(nowIdx + 1)/\(phaseSegments.count)"
    }

    var body: some View {
        NumberFace(
            rows: [
                NumRow(livePace,      paceRole),
                NumRow(phaseTarget,   .neutral),
                NumRow(totalDistance, .dist),
                NumRow(goalDelta,     goalDeltaRole)
            ],
            topLabel: derivedLabel,
            topLabelColor: Faff.goal,
            strip: Strip(states: phaseSegments,
                         doneColor: Faff.goal, nowColor: Faff.goal)
        )
    }
}

/// Easy face — live pace (in range) · rotating guardrail (HR ♥ / cadence 🏃) ·
/// distance (counts down to 0 against the planned target; flips to purple
/// and counts up in overtime). HR-over-ceiling overrides + holds red on the
/// guardrail row so the alert can't be missed (and you can't swipe past it
/// like a banner).
///
/// The rotation index is driven by the parent (engine.guardrailIdx) instead
/// of a per-view Timer.publish — the view gets recreated every second when
/// HR / distance update, which would reset an internal timer's t=0 and
/// prevent it from ever reaching 60 s.
struct EasyFace: View {
    let pace: String
    let paceRole: Role
    let hr: String
    let hrOver: Bool
    let cadence: String
    let distance: String
    /// 0 = HR row · 1 = cadence row. Engine flips it every 60 s.
    var guardrailIdx: Int = 0
    /// Distance row role · .dist (blue) during the plan, .bonus (purple)
    /// in overtime.
    var distanceRole: Role = .dist
    /// Top tag (rides the OS clock baseline). Defaults to "EASY";
    /// callers can pass a context-specific string ("EASY · MAF", etc.).
    var topLabel: String = "EASY"

    private var guardrail: NumRow {
        if hrOver { return NumRow(hr, .over, icon: "heart.fill") }
        return guardrailIdx == 0
            ? NumRow(hr, .neutral, icon: "heart.fill")
            : NumRow(cadence, .neutral, icon: "figure.run")
    }
    var body: some View {
        NumberFace(
            rows: [
                NumRow(pace, paceRole),
                guardrail,
                NumRow(distance, distanceRole)
            ],
            topLabel: topLabel
        )
    }
}

/// Progression face — live · target (current step) · total miles · miles-to-next-step.
struct ProgressionFace: View {
    let livePace: String
    let paceRole: Role
    let stepTarget: String
    let totalDistance: String
    let toNextStep: String      // miles or m:ss until the next step
    var topLabel: String = "PROGRESSION"
    var body: some View {
        NumberFace(
            rows: [
                NumRow(livePace,      paceRole),
                NumRow(stepTarget,    .neutral),
                NumRow(totalDistance, .dist),
                NumRow(toNextStep,    .neutral)
            ],
            topLabel: topLabel
        )
    }
}

/// Tempo face — live pace + signed delta vs target + steady HR + miles to go.
/// Four rows, no strip. Unlike EasyFace the HR row is always visible (no
/// rotation with cadence). Routed when workout.displayHint == "tempo".
///
/// AFC fix 7 (2026-06-09) · the second row is now the SIGNED DELTA to the
/// target ("+0:11" = 11 s/mi slow, "-0:04" = 4 s/mi fast) instead of the
/// raw target pace. At 7:28 vs 7:17 the old face made the runner subtract
/// two mm:ss numbers mid-threshold to learn the magnitude; the drift color
/// said only THAT they were off, not by how much. The target itself moves
/// into the top label ("TEMPO · 7:17") so no information is lost.
struct TempoFace: View {
    let livePace: String         // "7:28"
    let paceRole: Role           // drift-zone color
    let targetPace: String       // "7:17" · rendered in the top label
    let paceDelta: String        // "+0:11" / "-0:04" / "—" (no GPS or no target)
    let hr: String               // "148" or "—"
    /// .live once live HR reaches the threshold target, .neutral below, .mute pre-HR.
    let hrRole: Role
    /// Small top-label reference: "TEMPO" — target pace is appended here.
    var topLabel: String = "TEMPO"
    let toGo: String             // "2.22" (miles remaining) or "m:ss"

    /// "TEMPO · 7:17" — keeps the chased number on screen without
    /// spending a big row on it. Placeholder targets stay bare.
    private var derivedLabel: String {
        targetPace == "—:—" || targetPace.isEmpty
            ? topLabel
            : "\(topLabel) · \(targetPace)"
    }

    /// Delta row rides the same drift-zone color as the live row so the
    /// two reads reinforce one signal; mute until a real delta exists.
    private var deltaRole: Role {
        paceDelta == "—" ? .mute : paceRole
    }

    var body: some View {
        NumberFace(
            rows: [
                NumRow(livePace,  paceRole),
                NumRow(paceDelta, deltaRole),
                NumRow(hr,        hrRole, icon: "heart.fill"),
                NumRow(toGo,      .neutral)
            ],
            topLabel: derivedLabel
        )
    }
}

/// HR-governed face (MAF / Z2 / heat flag) — same row order as Easy, but green
/// highlight on HR (the guardrail you're holding), neutral on pace below it.
struct HRFace: View {
    let pace: String
    let hr: String
    let hrRole: Role            // .live in zone, .over above ceiling, .neutral otherwise
    let distance: String
    var topLabel: String = "MAF"
    var body: some View {
        NumberFace(
            rows: [
                NumRow(pace,     .neutral),
                NumRow(hr,       hrRole, icon: "heart.fill"),
                NumRow(distance, .dist)
            ],
            topLabel: topLabel
        )
    }
}

/// Strides face — green live · white burst countdown · strip.
struct StridesFace: View {
    let livePace: String
    let burstCountdown: String
    let stripStates: [Int]
    var topLabel: String = "STRIDES"
    var body: some View {
        NumberFace(
            rows: [
                NumRow(livePace,        .live),
                NumRow(burstCountdown,  .neutral)
            ],
            topLabel: topLabel,
            strip: Strip(states: stripStates)
        )
    }
}

/// Steady / cooldown / overtime — three big numbers, no target. Live pace +
/// distance + elapsed. Used for warmup-then-easy, cooldown, and overtime (the
/// "plan done · keep going" state) where there's nothing to chase.
/// `distanceRole` lets the overtime variant flip distance to .bonus (purple
/// — the locked grammar's "past the plan" colour) while regular steady use
/// keeps the canonical .dist (blue).
struct SteadyRunFace: View {
    let livePace: String
    let paceRole: Role          // .live during easy execution, .neutral when no target
    let distance: String
    let elapsed: String
    var distanceRole: Role = .dist
    /// Required by the locked layout: each rendering context names what
    /// the screen IS — "STEADY" for the steady-run case, "COOL DOWN"
    /// for cooldown, "OVERTIME" for past-plan time, "WARMUP" if used
    /// for warmup, etc.
    let topLabel: String
    var body: some View {
        NumberFace(
            rows: [
                NumRow(livePace, paceRole),
                NumRow(elapsed,  .neutral),
                NumRow(distance, distanceRole)
            ],
            topLabel: topLabel
        )
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

/// Recovery — between-rep jog. Three big number rows in the same locked
/// grammar as the cooldown face:
///   · rest time-left (blue/rest, counts down to 0)
///   · live pace (green when easy, the actionable read)
///   · HR (♥ icon, white — see it drop as you recover)
/// No top label, no subtitle, no icon hero. The face is a data card.
struct RestFace: View {
    let restTimeLeft: String    // "1:30"
    let pace: String            // live pace · "9:30" / "—:—"
    let paceRole: Role          // .live in zone, .mute if no GPS yet
    let hr: String              // live HR · "148" / "—"
    var body: some View {
        // Top tag "REST" rides the OS clock baseline (anchored layout),
        // then three big rows below it filling the rest of the screen:
        //   row 1: rest time-left (blue/rest, counts down)
        //   row 2: live pace (green when running easy)
        //   row 3: HR (♥ icon, white)
        // The label anchors the face to a meaningful caption AND pulls
        // the row group out of the dead-centered "what is this screen?"
        // ambiguity.
        NumberFace(
            rows: [
                NumRow(restTimeLeft, .rest),
                NumRow(pace,         paceRole),
                NumRow(hr,           .neutral, icon: "heart.fill")
            ],
            topLabel: "REST",
            topLabelColor: Faff.rest
        )
    }
}

/// Warmup — same grammar as the live in-run face. Live pace + HR are the
/// reads, distance-remaining counts down to 0 so the runner sees how
/// close they are to the first work rep. Small "THEN 6:47 · 1.00"
/// subtitle teases the upcoming target.
///
/// Previous version showed only "covered" + "next target" — when distance
/// tracking broke on the user's run, this face fell back to a bare
/// elapsed-time counter and the user ran 15 minutes blind without HR or
/// pace visible. The redesign always shows live HR + pace, so if data
/// stops flowing the runner SEES it stop instead of running into the
/// first work rep flying.
struct WarmupFace: View {
    let pace: String            // live pace · "8:12" / "—:—"
    let paceRole: Role          // .live / .mute / .over
    let hr: String              // live HR · "142" / "—"
    let remaining: String       // distance OR time remaining · "1.40" / "12:30"
    let remainingRole: Role     // .dist for distance, .neutral for time
    let upNext: String?         // "1.0 mi · 6:47" — first work-rep brief, optional
    var body: some View {
        // All four elements (top tag, three number rows, bottom subtitle)
        // ride the SAME `H * leadF` offset inside NumberFace, so they
        // align by construction — no hand-tuned padding values to drift.
        NumberFace(
            rows: [
                NumRow(pace,      paceRole),
                NumRow(hr,        .neutral, icon: "heart.fill"),
                NumRow(remaining, remainingRole)
            ],
            topLabel: "WARMUP",
            bottomLabel: upNext
        )
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

/// GO — fires for 1.5 s when a new work rep starts. Replaces the old
/// big-"GO"-wordmark version: now a data card in the same locked
/// grammar as every other face. Two big rows give the runner what they
/// actually need at the start of a rep:
///   · "REP 2 / 4"   (which rep + how many total)
///   · target pace   (the number to chase, green)
/// No "GO" wordmark, no play-arrow glyph — the haptic + the hard fact
/// that the face just took over IS the "go" signal; the content is the
/// briefing for the rep about to happen.
struct GoFace: View {
    let rep: String      // "REP 2 / 4"
    let target: String   // "6:47"
    var body: some View {
        // Top tag + target both ride the same NumberFace leadF — no
        // hand-tuned padding. The green wash rides as the face's
        // background.
        NumberFace(
            rows: [NumRow(target, .live)],
            topLabel: rep,
            topLabelColor: Faff.live,
            faceBackground: Color(hex: 0x0C2A14)
        )
    }
}

// (PlanDoneFace removed — was a 6 s green takeover when the runner
// crossed the planned distance. The live face already signals overtime
// by flipping the distance row to .bonus purple + counting up, and
// Haptics.play(.end) fires alongside. The extra full-screen flash was
// noise — runner already knows they're done from the face change. If
// we want a confirmation later, it should be a smaller toast / a
// brief mile-split-style flash, not a 6 s wordmark takeover.)

/// HEADS-UP — amber takeover before a phase / workout ends. The value IS
/// the message: "0.25" (mi) or "10s" (time). Tiny "LEFT" caption under it.
/// No icon, no "ALMOST" word — at a glance the number tells the runner
/// everything they need ("a quarter mile left, ease in" or "ten seconds,
/// don't overrun"). Auto-dismisses with the rep / workout end.
struct HeadsUpFace: View {
    let value: String   // "0.25" / "10s" / "0.03"
    var body: some View {
        Screen(background: wash(0x3A2B08)) {
            GeometryReader { geo in
                let h = geo.size.height
                // tightNumber auto-scales (minimumScaleFactor 0.25 + lineLimit 1)
                // so we can push the size HUGE and let the fitter cap it for
                // wide strings ("0.25") while short ones ("10s") bloom edge to
                // edge. The padding-top on "LEFT" balances tightNumber's
                // negative vertical padding so the two reads cleanly.
                VStack(spacing: 0) {
                    Text(value)
                        .foregroundStyle(Faff.goal)
                        .tightNumber(h * 0.62)
                    Text("LEFT")
                        .font(.custom("HelveticaNeue-Bold", size: h * 0.11))
                        .foregroundStyle(Faff.goal)
                        .tracking(3)
                        .padding(.top, h * 0.06)
                }
                // Perfect-centered: no asymmetric bottom padding. The face is
                // a brief 2.6 s takeover so it doesn't need to clear the
                // bottom-corner bezel curve the way persistent faces do.
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                .padding(.horizontal, h * 0.06)
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
        // Converted to NumberFace: top tag "FUEL" rides the OS clock
        // baseline, single big "N OF M" row beneath. Amber wash + a
        // dismiss chevron overlay flag this as a "swipe down to ack"
        // persistent takeover.
        GeometryReader { geo in
            let h = geo.size.height
            ZStack(alignment: .bottom) {
                NumberFace(
                    rows: [NumRow("\(index) OF \(total)", .goal)],
                    topLabel: "FUEL",
                    topLabelColor: Faff.goal,
                    faceBackground: Color(hex: 0x3A2B08)
                )
                Image(systemName: "chevron.compact.down")
                    .font(.system(size: h * 0.085, weight: .bold))
                    .foregroundStyle(Color(hex: 0xCFD2D8).opacity(0.55))
                    .padding(.bottom, h * 0.035)
                    .allowsHitTesting(false)
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
        // Converted to NumberFace: workout-name tag rides the OS clock
        // baseline, three big data rows below (distance · pace · time),
        // START button overlays the bottom reservation slot.
        //
        // `paceRange` is rendered as a small bottom-label subtitle when
        // present (e.g. "8:29-8:59" for easy runs with a tolerance band).
        // Removes the old VStack+Spacer cascade for the strict locked
        // grammar.
        ZStack(alignment: .bottom) {
            NumberFace(
                rows: [
                    NumRow(distance, .dist),
                    NumRow(pace,     .live),
                    NumRow(time,     .neutral, icon: showTimeIcon ? "clock" : nil)
                ],
                topLabel: name.uppercased(),
                bottomLabel: paceRange,
                bottomReservation: 0.20    // START button area
            )
            GeometryReader { geo in
                let h = geo.size.height
                Button(action: onStart) {
                    HStack(spacing: h * 0.030) {
                        Image(systemName: "play.fill")
                            .font(.system(size: h * 0.055, weight: .bold))
                        Text("START")
                            .font(.custom("HelveticaNeue-Bold", size: h * 0.085))
                            .tracking(2)
                    }
                    .foregroundStyle(Color(hex: 0x06210C))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, h * 0.022)
                    .background(Capsule().fill(Faff.live))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, h * 0.075)
                .frame(maxHeight: .infinity, alignment: .bottom)
                .padding(.bottom, h * 0.020)
            }
        }
    }
}

// =====================================================================
// SUMMARY / END FACES
// =====================================================================

/// Complete — session readout: type label · pace · distance · elapsed · avg HR · Done.
/// `hr` is optional — when present (tracker had HR samples) a 4th row appears with a
/// heart icon; when nil the face shows the original 3 rows unchanged.
struct CompleteFace: View {
    let label: String       // "Threshold" / "Easy run" / "Big Sur"
    let pace: String        // "8:48"
    let distance: String    // "9.6"
    let elapsed: String     // "1:24"
    var hr: String? = nil   // avg HR bpm — appended as 4th row when sampled
    /// Brief v2 §9 verdict row · "GOOD · ON-PACE" / "SHARP · UNDER" /
    /// "STEADY · OVER" / "LOADED · OVER". Renders in the small bottom-label
    /// slot (after the metrics, above Done) so the locked shared-glyph row
    /// math is untouched. Nil hides the row (no target to judge against).
    var verdict: String? = nil
    var verdictRole: Role = .neutral
    /// W-7: one-line upload status shown just above Done ("Uploading…" /
    /// "Sent ✓" / failure hint). Nil hides the line — idle state is silent.
    var syncStatus: String? = nil
    var syncRole: Role = .neutral
    var onDone: () -> Void = {}

    private var rows: [NumRow] {
        var r: [NumRow] = [
            NumRow(pace,     .live),
            NumRow(distance, .dist),
            NumRow(elapsed,  .neutral)
        ]
        if let h = hr { r.append(NumRow(h, .neutral, icon: "heart.fill")) }
        return r
    }

    var body: some View {
        // Converted to NumberFace: workout-type tag rides the OS clock
        // baseline (green for completion), three big data rows flex
        // vertically below it. Done button overlays at the bottom; the
        // big rows reserve clearance for it via the strip slot.
        ZStack(alignment: .bottom) {
            NumberFace(
                rows: rows,
                topLabel: label.uppercased(),
                topLabelColor: Faff.live,
                bottomLabel: verdict,
                bottomLabelColor: verdictRole.color,
                bottomReservation: 0.20,   // Done button area
                faceBackground: Color(hex: 0x0C2A14)
            )
            GeometryReader { geo in
                let h = geo.size.height
                Button(action: onDone) {
                    Text("Done")
                        .font(.custom("HelveticaNeue-Bold", size: h * 0.085))
                        .foregroundStyle(Color(hex: 0x06210C))
                        .frame(maxWidth: .infinity).padding(.vertical, h * 0.016)
                        .background(Capsule().fill(Faff.live))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, h * 0.075)
                .frame(maxHeight: .infinity, alignment: .bottom)
                .padding(.bottom, h * 0.020)
            }
        }
    }
}

/// Today complete — post-Done confirmation flash (~1.5 s). One last look
/// at the run's headline numbers before the watch returns to the home
/// page. Green check on top + 3 big data rows (pace · distance · elapsed)
/// in the same locked grammar as the cooldown / steady faces — green pace,
/// blue distance, neutral elapsed. The check is the celebration; the
/// numbers are the receipt.
struct TodayDoneFace: View {
    var pace: String = "—:—"       // "8:14"
    var distance: String = "—"     // "5.8"
    var elapsed: String = "—"      // "46:18" / "1:09"
    var body: some View {
        // ✓ icon in the top slot + three rows in locked grammar. All
        // ride NumberFace's leadF — same construction-time alignment.
        NumberFace(
            rows: [
                NumRow(pace,     .live),
                NumRow(distance, .dist),
                NumRow(elapsed,  .neutral)
            ],
            topIcon: "checkmark",
            topIconColor: Faff.live
        )
    }
}

/// Calibrate — race-day GPS re-sync stepper.
/// Calibrate — mid-race GPS re-sync. The watch knows roughly where the
/// runner is from GPS / phase position, so it auto-selects the nearest
/// mile marker. The runner just confirms by tapping "Set mile N".
///
/// Old design had a +/- stepper to pick the mile manually — but mid-race
/// you'd only ever set the mile you're closest to. The stepper was
/// noise; one button is the read.
struct CalibrateFace: View {
    /// The mile marker the runner is nearest to — auto-detected from
    /// GPS position relative to the course. Caller is responsible for
    /// picking the right value.
    let mile: Int
    var onSet: () -> Void = {}
    var body: some View {
        ZStack(alignment: .bottom) {
            NumberFace(
                rows: [NumRow("MILE \(mile)", .dist)],
                topLabel: "CALIBRATE",
                topLabelColor: Faff.mute,
                bottomReservation: 0.22    // Set button area
            )
            GeometryReader { geo in
                let h = geo.size.height
                Button(action: onSet) {
                    Text("Set mile \(mile)")
                        .font(.custom("HelveticaNeue-Bold", size: h * 0.085))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, h * 0.022)
                        .background(Capsule().fill(Faff.brand))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, h * 0.075)
                .frame(maxHeight: .infinity, alignment: .bottom)
                .padding(.bottom, h * 0.020)
            }
        }
    }
}

