//
//  K_TargetsProjection.swift
//  Family K · Targets PACE PROJECTION card.
//
//  Rebuilt 2026-06-17 per the design handoff
//  (design_handoff_pace_projection). The card answers five questions at a
//  glance, sitting BELOW the big ON PACE / WATCHING / OFF PACE hero on
//  TargetsView (the hero is out of scope · owned by TargetsView):
//
//    1. Where am I today?      → Today time (equivalent race at current fitness)
//    2. Where on race day?     → race-day projection + likely range
//    3. Am I executing?        → EXECUTION read · % of key runs hit
//    4. Is fitness responding? → FITNESS read · got/need VDOT verdict
//    5. Where in the build?    → PHASE SPINE · macro-cycle phases + you-marker
//
//  Design premise (from the handoff): the plan is ASSUMED to be built to
//  reach the goal. So the card does not ask "is the plan good enough" · it
//  isolates the two levers that actually knock a runner off track —
//  EXECUTION (are you doing the work) and FITNESS (is your body responding).
//  The state (on / watch / off) recolors the gap value, race-day time,
//  current-phase highlight, you-marker, and ok-icons/values together.
//
//  Layout (top → bottom):
//    1+2. Today → GAP → Race-day row (3-col)
//    Summary line · one centered coach sentence, per-state
//    5.   WHERE YOU ARE IN THE BUILD · phase spine + blurb
//    3+4. EXECUTION & FITNESS reads · two equal cards
//
//  Doctrine: display-only. State drives everything. fitnessTime / projTime /
//  range / execution / VDOT gains are REAL from ProjectionSummary; the phase
//  spine reads the app's existing TrainingState (phases + currentWeekIdx).
//  No client-side fabrication — see per-field wiring notes inline.
//

import SwiftUI

// MARK: - State palette
//
// Three states, each carrying its own accent set. Base accents map to the
// CI-locked Theme tokens (green/goal/over · byte-for-byte with web); the
// soft/dim/line variants are literal per the handoff (no Theme alias exists).

private enum ProjState {
    case on, watch, off

    var accent: Color {
        switch self {
        case .on:    return Theme.green          // 0x3EBD41
        case .watch: return Theme.goal           // 0xF3AD38
        case .off:   return Theme.over           // 0xFC4D64
        }
    }
    /// Soft tint for highlighted phase + race labels.
    var accentSoft: Color {
        switch self {
        case .on:    return Color(hex: 0x86EFA0)
        case .watch: return Color(hex: 0xF3AD38)
        case .off:   return Color(hex: 0xFF9DA8)
        }
    }
    /// Dim fill behind the current phase segment.
    var accentDim: Color {
        switch self {
        case .on:    return Color(hex: 0x3EBD41, alpha: 0.16)
        case .watch: return Color(hex: 0xF3AD38, alpha: 0.16)
        case .off:   return Color(hex: 0xFC4D64, alpha: 0.15)
        }
    }
    /// Stroke on the current phase + race segments.
    var accentLine: Color {
        switch self {
        case .on:    return Color(hex: 0x3EBD41, alpha: 0.34)
        case .watch: return Color(hex: 0xF3AD38, alpha: 0.34)
        case .off:   return Color(hex: 0xFC4D64, alpha: 0.34)
        }
    }
}

// MARK: - Phase-spine geometry model

private struct SpinePhase {
    let key: TrainPhase
    let label: String
    let dw: Double
    let isRace: Bool
}

/// Display weights tuned so late phases don't cram (from the handoff PLAN).
/// These are render weights, NOT real week counts.
private let kPhaseDisplayWeight: [TrainPhase: Double] = [
    .base: 3.0, .build: 2.5, .peak: 1.7, .taper: 1.5, .race: 1.7,
]

// MARK: - Status icon (check / alert in a circle)

private struct ProjTick: View {
    let ok: Bool
    let accent: Color

    var body: some View {
        ZStack {
            Circle()
                .fill(ok ? accent.opacity(0.18) : Color(hex: 0x646464, alpha: 0.16))
                .frame(width: 16, height: 16)
            if ok {
                // Check stroked in the accent.
                CheckShape()
                    .stroke(accent, style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
                    .frame(width: 16, height: 16)
            } else {
                // "!" · vertical stroke + dot, in neutral grey.
                VStack(spacing: 1.6) {
                    Capsule()
                        .fill(Color(hex: 0xC9CED8))
                        .frame(width: 1.8, height: 4.2)
                    Circle()
                        .fill(Color(hex: 0xC9CED8))
                        .frame(width: 2, height: 2)
                }
            }
        }
        .frame(width: 16, height: 16)
    }
}

/// Check mark matching the handoff path "M4.6 8.2l2.1 2.1 4.7-4.8" in a 16-box.
private struct CheckShape: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 16
        var p = Path()
        p.move(to: CGPoint(x: 4.6 * s, y: 8.2 * s))
        p.addLine(to: CGPoint(x: 6.7 * s, y: 10.3 * s))
        p.addLine(to: CGPoint(x: 11.4 * s, y: 5.5 * s))
        return p
    }
}

// MARK: - Gap arrow (horizontal line + triangle head)

private struct GapArrow: View {
    let accent: Color

    var body: some View {
        Canvas { ctx, size in
            // Scale the 46×10 design coordinate system to the rendered box.
            let sx = size.width / 46
            let sy = size.height / 10
            var line = Path()
            line.move(to: CGPoint(x: 0, y: 5 * sy))
            line.addLine(to: CGPoint(x: 40 * sx, y: 5 * sy))
            ctx.stroke(line, with: .color(accent), lineWidth: 1.6)

            var head = Path()
            head.move(to: CGPoint(x: 40 * sx, y: 1.5 * sy))
            head.addLine(to: CGPoint(x: 45 * sx, y: 5 * sy))
            head.addLine(to: CGPoint(x: 40 * sx, y: 8.5 * sy))
            head.closeSubpath()
            ctx.fill(head, with: .color(accent))
        }
        .frame(width: 46, height: 10)
    }
}

// MARK: - Phase spine (segmented rail + you-marker)

private struct PhaseSpine: View {
    let st: ProjState
    let phases: [SpinePhase]
    let youPhase: TrainPhase
    let youProgress: Double   // 0…1 fraction through the current phase

    // Design constants (handoff): rail height 13, gap 3, rx 3, y=16, total H=60.
    private let railH: CGFloat = 13
    private let railY: CGFloat = 16
    private let segGap: CGFloat = 3
    private let totalH: CGFloat = 60

    /// Cumulative segment x-extents + the you-marker x, computed imperatively
    /// (outside the ViewBuilder · result builders can't take a `for` loop).
    private func layout(railW: CGFloat) -> (segs: [(SpinePhase, CGFloat, CGFloat)], youX: CGFloat) {
        let totalDw = phases.reduce(0) { $0 + $1.dw }
        let scale = totalDw > 0 ? railW / CGFloat(totalDw) : 0
        var cum: CGFloat = 0
        var segs: [(SpinePhase, CGFloat, CGFloat)] = []
        var youX: CGFloat = 0
        for ph in phases {
            let x0 = cum * scale
            cum += CGFloat(ph.dw)
            let x1 = cum * scale
            if ph.key == youPhase && !ph.isRace {
                youX = x0 + (x1 - x0) * CGFloat(min(max(youProgress, 0), 1))
            }
            segs.append((ph, x0, x1))
        }
        return (segs, youX)
    }

    var body: some View {
        GeometryReader { geo in
            let computed = layout(railW: geo.size.width)
            let segs = computed.segs
            let youX = computed.youX

            ZStack(alignment: .topLeading) {
                // Phase segments + labels.
                ForEach(Array(segs.enumerated()), id: \.offset) { _, item in
                    let (ph, x0, x1) = item
                    let isCurrent = ph.key == youPhase && !ph.isRace
                    let highlighted = isCurrent || ph.isRace
                    let w = max(2, x1 - x0 - segGap)

                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(isCurrent ? st.accentDim : Color.white.opacity(0.07))
                        .overlay(
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .stroke(highlighted ? st.accentLine : Color.clear, lineWidth: 1)
                        )
                        .frame(width: w, height: railH)
                        .offset(x: x0 + segGap / 2, y: railY)

                    Text(ph.label)
                        .font(.body(9.5, weight: highlighted ? .extraBold : .semibold))
                        .tracking(0.6)
                        .foregroundStyle(highlighted ? st.accentSoft : Color(hex: 0x737985))
                        .frame(width: x1 - x0, alignment: .center)
                        .offset(x: x0, y: railY + railH + 6)
                }

                // Completed fill up to the you-marker.
                if youX > segGap / 2 {
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(st.accent.opacity(0.32))
                        .frame(width: youX - segGap / 2, height: railH)
                        .offset(x: segGap / 2, y: railY)
                }

                // YOU marker · vertical line + filled circle + label.
                // Vertical white line spanning the rail (+ overshoot per handoff).
                Rectangle()
                    .fill(Color.white)
                    .frame(width: 2, height: railH + 10)
                    .offset(x: youX - 1, y: railY - 6)
                Circle()
                    .fill(st.accent)
                    .overlay(Circle().stroke(Theme.card, lineWidth: 2))
                    .frame(width: 11, height: 11)
                    .offset(x: youX - 5.5, y: railY + railH / 2 - 5.5)
                Text("YOU")
                    .font(.body(8.5, weight: .extraBold))
                    .tracking(1.0)
                    .foregroundStyle(Color.white)
                    .fixedSize()
                    .frame(width: 40, alignment: .center)
                    .offset(x: youX - 20, y: 0)
            }
        }
        .frame(height: totalH)
    }
}

// MARK: - Time helpers (h:mm:ss / m:ss · mirror pace-data.js sec()/clock())

private func projFormatTime(_ sec: Int?) -> String {
    guard let sec, sec > 0 else { return "—" }
    let h = sec / 3600
    let m = (sec % 3600) / 60
    let s = sec % 60
    if h > 0 { return String(format: "%d:%02d:%02d", h, m, s) }
    return String(format: "%d:%02d", m, s)
}

/// "m:ss" of an absolute second-delta (the gap / residual values).
private func projClock(_ sec: Int) -> String {
    let a = Swift.abs(sec)
    let m = a / 60
    let s = a % 60
    return String(format: "%d:%02d", m, s)
}

// MARK: - Public panel · the PACE PROJECTION card

struct TargetsProjectionPanel: View {
    let summary: ProjectionSummary
    /// Optional · drives the phase spine. When nil, a single-phase fallback
    /// renders so the build never blocks on training-state being present.
    var trainingState: TrainingState? = nil

    // MARK: Derived state (on / watch / off)
    //
    // Mirror the ON PACE hero's resolution (TargetsView.goalStatusHeadline)
    // so hero + card never disagree: aheadOfGoal / on_track / race_week → on,
    // watch → watch, off → off. The handoff's "execution + fitness levers"
    // model is preserved inside the reads (each colors independently); the
    // top-level state follows the server status, the same single source the
    // hero reads.
    private var state: ProjState {
        if summary.aheadOfGoal == true { return .on }
        switch summary.status {
        case "on_track", "race_week": return .on
        case "watch":                 return .watch
        case "off":                   return .off
        default:
            // cold / unknown · fall back to the execution+fitness levers.
            if !execOk { return .off }
            return fitOk ? .on : .watch
        }
    }

    // MARK: Times

    /// REAL · current-fitness equivalent race time ("if you raced today").
    private var fitnessSec: Int? { summary.projectionSec }
    /// REAL · race-day / trajectory projection. Falls back to current-fitness
    /// when the server has no separate trajectory value.
    private var projSec: Int? { summary.trajectoryProjectedSec ?? summary.projectionSec }
    /// REAL · goal finish.
    private var goalSec: Int? { summary.goalSec }

    /// GAP shown in the connector = today − race-day projection (what the plan
    /// closes). Mirrors pace-data.js `improveStr`.
    private var improveSec: Int? {
        guard let f = fitnessSec, let p = projSec else { return nil }
        return f - p
    }
    /// Residual at race day = projection − goal. Mirrors `projGapStr`.
    private var projGapSec: Int? {
        guard let p = projSec, let g = goalSec else { return nil }
        return p - g
    }
    /// reachesGoal = residual ≤ 4s. Hides the "+X vs goal" sublabel when on track.
    private var reachesGoal: Bool {
        guard let r = projGapSec else { return true }
        return r <= 4
    }

    /// Replaces the static "at today's fitness" label with how long the
    /// fitness number has been frozen — answers "when does this update?"
    /// directly from the projection payload's heldDays counter.
    private var fitnessStaleLabel: String {
        let d = summary.heldDays
        if d == 0 { return "updated today" }
        if d == 1 { return "updated yesterday" }
        return "held \(d) days"
    }

    // MARK: Execution & Fitness reads

    /// REAL · executionQuality (0…1) → percentage. ok ≥ 0.80 (matches the
    /// handoff: on 100% ok, watch 96% ok, off 72% not-ok).
    private var execPctText: String {
        guard let e = summary.executionQuality else { return "—" }
        return "\(Int((e * 100).rounded()))%"
    }
    private var execOk: Bool { (summary.executionQuality ?? 1.0) >= 0.80 }

    /// got = the plan's MODELED projected gain (projectedGainVdot), NOT a fresh
    /// measured read — David's VDOT is frozen, so a measured read would falsely
    /// show "Lagging". This keeps the card consistent with the "plan trusts
    /// itself" model + the ON PACE hero.
    private var gotVdot: Double { summary.projectedGainVdot ?? 0 }
    /// need = goalVdot − currentVdot (the gain the plan must deliver).
    private var needVdot: Double {
        guard let g = summary.goalVdot, let c = summary.currentVdot else { return 0 }
        return max(0, g - c)
    }
    private var buildRatio: Double {
        needVdot > 0 ? gotVdot / needVdot : 1.0
    }
    /// FITNESS verdict from got/need ratio (handoff thresholds):
    /// ≥0.95 → Responding (ok) · 0.6–0.95 → Lagging · <0.6 → Stalled.
    private var fitVerdict: String {
        if buildRatio >= 0.95 { return "Responding" }
        if buildRatio >= 0.60 { return "Lagging" }
        return "Stalled"
    }
    private var fitOk: Bool { buildRatio >= 0.95 }

    // MARK: Summary line (per-state · coach voice · filled with real times)

    private var summaryLine: String {
        let goal = projFormatTime(goalSec)
        let proj = projFormatTime(projSec)
        switch state {
        case .on:
            return "On track for \(goal). You're doing the work and your fitness is responding on schedule."
        case .watch:
            return "Tracking to \(proj). Execution's there, but your fitness is responding slower than the plan needs."
        case .off:
            return "Slipped to \(proj). Missed key runs are stalling the fitness gains the plan was built on."
        }
    }

    // MARK: Phase spine wiring (from TrainingState · the app's existing source)

    /// Macro-cycle phases present in the plan, in canonical order, each carrying
    /// its display weight. Always appends a trailing Race segment. Falls back to
    /// the current phase alone when no plan weeks are loaded.
    ///
    /// David's rule (2026-06-17): "if the phase was or is part of the plan it
    /// should be visible as completed/filled at all times." So presence is the
    /// UNION of two sources — the plan WEEKS (which the backend returns in full,
    /// completed weeks included) AND the plan PHASES blocks (`phases[]`, the
    /// canonical phase ledger). Reading both means an earlier completed phase
    /// like Base stays in the spine — and renders filled by the you-marker
    /// completed fill — even if a future weeks-array were ever pruned to
    /// current+future. We never drop a phase that was part of the build.
    private var spinePhases: [SpinePhase] {
        let order: [TrainPhase] = [.base, .build, .peak, .taper]
        var present: Set<TrainPhase> = []
        // 1) Phase ledger · the authoritative set of phase blocks (incl. done).
        if let phases = trainingState?.phases {
            for p in phases { present.insert(TrainPhase(phaseKey: p.label)) }
        }
        // 2) Plan weeks · the backend returns ALL weeks (completed included),
        //    so this also carries earlier phases. Union with (1) for safety.
        if let weeks = trainingState?.weeks {
            for w in weeks { present.insert(TrainPhase(phaseKey: w.phase)) }
        }
        // 3) Always include the phase the runner is currently in.
        present.insert(youPhase)
        // Drop the standalone race phase if it leaked into the ledger — the
        // spine appends its own trailing Race segment below.
        present.remove(.race)

        var out: [SpinePhase] = order
            .filter { present.contains($0) }
            .map { SpinePhase(key: $0, label: $0.label.capitalizedPhase, dw: kPhaseDisplayWeight[$0] ?? 1.5, isRace: false) }
        if out.isEmpty {
            out = [SpinePhase(key: youPhase, label: youPhase.label.capitalizedPhase, dw: 2.5, isRace: false)]
        }
        out.append(SpinePhase(key: .race, label: "Race", dw: kPhaseDisplayWeight[.race] ?? 1.7, isRace: true))
        return out
    }

    /// Current phase · from TrainingState.currentPhase, else the current plan
    /// week, else base.
    private var youPhase: TrainPhase {
        if let pk = trainingState?.currentPhase { return TrainPhase(phaseKey: pk) }
        if let cur = trainingState?.weeks.first(where: { $0.isCurrent }) {
            return TrainPhase(phaseKey: cur.phase)
        }
        return .base
    }

    /// Fraction through the current phase, by week position within the phase.
    private var youProgress: Double {
        guard let weeks = trainingState?.weeks, !weeks.isEmpty else { return 0.42 }
        let phaseWeeks = weeks.enumerated().filter {
            TrainPhase(phaseKey: $0.element.phase) == youPhase
        }
        guard !phaseWeeks.isEmpty else { return 0.42 }
        let firstOffset = phaseWeeks.first!.offset
        let count = phaseWeeks.count
        let curOffset = trainingState?.currentWeekIdx
            ?? weeks.firstIndex(where: { $0.isCurrent })
            ?? firstOffset
        // Position the marker mid-way through the current week within the phase.
        let into = Double(curOffset - firstOffset) + 0.5
        return min(max(into / Double(count), 0), 1)
    }

    /// "Build · Week X of Y" meta.
    private var phaseMeta: String {
        let name = youPhase.label.capitalizedPhase
        guard let weeks = trainingState?.weeks, !weeks.isEmpty else {
            return name
        }
        let phaseWeeks = weeks.enumerated().filter {
            TrainPhase(phaseKey: $0.element.phase) == youPhase
        }
        guard !phaseWeeks.isEmpty else { return name }
        let firstOffset = phaseWeeks.first!.offset
        let count = phaseWeeks.count
        let curOffset = trainingState?.currentWeekIdx
            ?? weeks.firstIndex(where: { $0.isCurrent })
            ?? firstOffset
        let weekInPhase = max(1, curOffset - firstOffset + 1)
        return "\(name) · Week \(min(weekInPhase, count)) of \(count)"
    }

    /// Phase blurb · short factual description per phase (matches TrainView's
    /// phaseContextBody voice). Used when no server blurb is available.
    private var phaseBlurb: String {
        switch youPhase {
        case .base:
            return "Easy miles and long runs build the aerobic base the rest of the plan stacks on."
        case .build:
            return "Sharpening speed at threshold and VO2 pace. This is where the big fitness gains are made, turning the aerobic base into race-specific sharpness."
        case .peak:
            return "Race-pace work at peak volume. The plan's hardest, most specific block before the taper."
        case .taper:
            return "Volume drops, intensity holds. Banking the fitness so you're sharp by race morning."
        case .race:
            return "Light activation keeps the legs fresh. The work is done."
        }
    }

    // MARK: Body

    var body: some View {
        let st = state
        VStack(alignment: .leading, spacing: 0) {
            todayToRaceRow(st)
            summarySection
            buildSection(st)
            readsSection(st)
        }
        .padding(EdgeInsets(top: 20, leading: 22, bottom: 18, trailing: 22))
        .background(Theme.card)            // 0x11141A
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    // 1+2 · Today → GAP → Race-day row

    private func todayToRaceRow(_ st: ProjState) -> some View {
        HStack(alignment: .center, spacing: 0) {
            // LEFT · Today
            VStack(alignment: .leading, spacing: 0) {
                eyebrow("TODAY")
                Text(projFormatTime(fitnessSec))
                    .font(.display(38, weight: .semibold))
                    .tracking(-1)
                    .foregroundStyle(Color.white)
                    .monospacedDigit()
                    .padding(.top, 4)
                Text(fitnessStaleLabel)
                    .font(.body(10.5))
                    .foregroundStyle(Color(hex: 0x646464))
                    .padding(.top, 4)
            }

            Spacer(minLength: 8)

            // CENTER · gap connector
            VStack(spacing: 0) {
                Text("GAP")
                    .font(.body(8.5, weight: .extraBold))
                    .tracking(1.0)
                    .foregroundStyle(Color(hex: 0x737985))
                Text(improveSec.map { "−\(projClock($0))" } ?? "—")
                    .font(.display(17, weight: .semibold))
                    .foregroundStyle(st.accent)
                    .monospacedDigit()
                    .padding(.top, 2)
                GapArrow(accent: st.accent)
                    .padding(.top, 3)
            }
            .padding(.horizontal, 8)
            .fixedSize()

            Spacer(minLength: 8)

            // RIGHT · Race day
            VStack(alignment: .trailing, spacing: 0) {
                eyebrow("RACE DAY")
                Text(projFormatTime(projSec))
                    .font(.display(38, weight: .semibold))
                    .tracking(-1)
                    .foregroundStyle(st.accent)
                    .monospacedDigit()
                    .padding(.top, 4)
                if !reachesGoal, let gap = projGapSec {
                    Text("+\(projClock(gap)) vs goal")
                        .font(.body(10.5))
                        .foregroundStyle(Color(hex: 0x646464))
                        .multilineTextAlignment(.trailing)
                        .padding(.top, 4)
                }
            }
        }
    }

    // Summary line · centered coach sentence.

    private var summarySection: some View {
        Text(summaryLine)
            .font(.body(13, weight: .medium))
            .foregroundStyle(Color(hex: 0xC9CED8))
            .lineSpacing(3)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, 14)
    }

    // 5 · Where you are in the build

    private func buildSection(_ st: ProjState) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle()
                .fill(Color.white.opacity(0.08))
                .frame(height: 1)
                .padding(.top, 20)

            HStack(alignment: .firstTextBaseline) {
                eyebrow("WHERE YOU ARE IN THE BUILD")
                Spacer(minLength: 8)
                Text(phaseMeta)
                    .font(.body(11, weight: .semibold))
                    .foregroundStyle(Color(hex: 0xC9CED8))
            }
            .padding(.top, 16)
            .padding(.bottom, 12)

            PhaseSpine(st: st,
                       phases: spinePhases,
                       youPhase: youPhase,
                       youProgress: youProgress)

            Text(phaseBlurb)
                .font(.body(12))
                .foregroundStyle(Color(hex: 0x9AA0AE))
                .lineSpacing(3)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 12)
        }
    }

    // 3+4 · Execution & Fitness reads

    private func readsSection(_ st: ProjState) -> some View {
        HStack(spacing: 10) {
            readCard(title: "EXECUTION",
                     ok: execOk,
                     value: execPctText,
                     accent: st.accent)
            readCard(title: "FITNESS",
                     ok: fitOk,
                     value: fitVerdict,
                     accent: st.accent)
        }
        .padding(.top, 18)
    }

    private func readCard(title: String, ok: Bool, value: String, accent: Color) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.body(9.5, weight: .extraBold))
                .tracking(1.2)
                .foregroundStyle(Color(hex: 0x737985))
            HStack(spacing: 8) {
                ProjTick(ok: ok, accent: accent)
                Text(value)
                    .font(.body(15, weight: .bold))
                    .tracking(0.1)
                    .foregroundStyle(ok ? accent : Color(hex: 0xD4D8DF))
                    .lineLimit(1)
            }
            .padding(.top, 11)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(EdgeInsets(top: 13, leading: 14, bottom: 13, trailing: 14))
        .background(Color.white.opacity(0.035))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    // Eyebrow label recipe · 10px / 800 / tracked / muted.
    private func eyebrow(_ text: String) -> some View {
        Text(text)
            .font(.body(10, weight: .extraBold))
            .tracking(1.6)
            .foregroundStyle(Color(hex: 0x737985))
    }
}

// MARK: - Title-case phase label helper

private extension String {
    /// "BUILD" → "Build" · the spine + meta want title-case from the uppercase
    /// TrainPhase.label.
    var capitalizedPhase: String {
        guard let first = self.first else { return self }
        return String(first).uppercased() + self.dropFirst().lowercased()
    }
}

// MARK: - Cold-start variant

struct TargetsProjectionColdState: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("PACE PROJECTION")
                    .font(.body(11, weight: .extraBold)).tracking(2.0)
                    .foregroundStyle(Theme.mute)
                Spacer()
            }
            Text("No projection yet · need a clean baseline run.")
                .font(.display(18, weight: .bold))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text("Race a 5K, run a controlled threshold rep, or upload a recent hard effort to Strava. Once Faff has 1 honest data point the projection comes online.")
                .font(.body(13, weight: .regular))
                .foregroundStyle(Theme.mute)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(20)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }
}
