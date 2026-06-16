//
//  K_TargetsProjection.swift
//  Family K · Targets projection panel ("Closing the gap").
//
//  Companion to the web GapPanel (web-v2/components/faff-app/views/
//  GapPanel.tsx). Both surfaces read the SAME composed numbers from
//  the SAME helpers · iPhone via GET /api/targets/projection.
//
//  Replaces the "PROJECTED · waiting for projection wire" placeholder
//  + the legacy GapBeam fallback on TargetsView. Direction E from
//  designs/from Design agent/Targets page/Targets phone reframed
//  around honesty: steady is the truth, here's what the gap is made
//  of, here's the cheapest way to close it.
//
//  Layout (top → bottom):
//    1. Status chip (on_track / watch / off / race_week / cold)
//    2. Truth headline · one coach sentence, no hype
//    3. VDOT meta pills · current · held N days · last move
//    4. Stacked gap bar · Fitness / Conditions / Course / Execution
//       with controllability tags + provenance footnote
//    5. Hit list · the cheapest movable seconds (server-composed via
//       computeProjectionLevers · 5-rule decision tree)
//
//  Doctrine: every number is server-derived. There is no client-side
//  fabrication. The provenance fields (courseSource, conditionsSource,
//  executionSource) drive the doctrine copy so each chunk says how
//  honest it is.
//

import SwiftUI

// MARK: - SWATCH palette (matches the HTML mockup)

private enum GapColor {
    static let fitness    = Color(hex: 0xF3AD38)   // Theme.goal · trainable yellow
    static let conditions = Theme.race                 // race/tempo slot · partly orange
    static let course     = Color(hex: 0xD6263C)   // fixed red
    static let execution  = Color(hex: 0x8A90A0)   // Theme.mute · neutral grey

    static func of(_ key: String) -> Color {
        switch key {
        case "fitness":    return fitness
        case "conditions": return conditions
        case "course":     return course
        case "execution":  return execution
        default:           return Theme.mute
        }
    }
}

// MARK: - Local gap-segment model
//
// Derived from `ProjectionSummary`'s named fields. The wire model uses
// named fields (matches the web GoalRace contract); the panel collapses
// them into rows for rendering.

private struct GapRow: Identifiable {
    let key: String          // "fitness" | "conditions" | "course" | "execution"
    let name: String
    let sec: Int
    let tag: String          // "Trainable" | "Partly" | "Fixed"
    let doctrine: String
    var id: String { key }
}

private func gapRows(from s: ProjectionSummary) -> [GapRow] {
    var rows: [GapRow] = []

    // Fitness · the residual after the 3 doctrine-priced chunks. Always
    // surface · "0s · holding fitness" is itself a finding.
    let fitnessDoctrine = "Pure VDOT math against a flat, neutral-weather reference. The only piece training moves directly."
    rows.append(GapRow(
        key: "fitness", name: "Fitness", sec: s.fitnessSec,
        tag: "Trainable", doctrine: fitnessDoctrine
    ))

    // Conditions · null when forecast + climate-normals both unknown.
    // Web GapPanel hides the chunk in that case; iPhone matches.
    if let c = s.conditionsImpactSec, c > 0 {
        let provenance = s.conditionsSource == "forecast"
            ? "Race-day forecast (≤14d window)."
            : "Climate normals · typical morning at this location, this month."
        rows.append(GapRow(
            key: "conditions", name: "Conditions", sec: c,
            tag: "Partly",
            doctrine: "\(provenance) Heat above 60°F costs roughly 1% per 5°F. Earlier corral or cooler course recovers some."
        ))
    }

    // Course · null when course_library is a stub for this race.
    if let co = s.courseImpactSec, co > 0 {
        let elevHint = (s.courseElevGainFtPerMi ?? 0) > 0
            ? " · \(Int((s.courseElevGainFtPerMi ?? 0).rounded())) ft/mi"
            : ""
        rows.append(GapRow(
            key: "course", name: "Course", sec: co,
            tag: "Fixed",
            doctrine: "Net elevation\(elevHint). Fixed by the route · plan for it, do not fight it."
        ))
    }

    // Execution · always populated · doctrine copy reflects observed vs default.
    let execDoctrine: String = {
        if s.executionSource == "observed", let cv = s.executionCV {
            let band: String
            if cv < 0.02 { band = "tight · CV under 2%" }
            else if cv < 0.04 { band = "typical · CV around 3%" }
            else { band = "drift · CV above 4%" }
            return "Pacing-discipline buffer · \(band) across your last \(s.executionN) typed efforts. The most winnable seconds on the list."
        }
        return "Pacing-discipline buffer · 30s doctrine default. Will light up as your plan adds typed tempo/threshold work."
    }()
    rows.append(GapRow(
        key: "execution", name: "Execution", sec: s.executionBufferSec,
        tag: "Trainable", doctrine: execDoctrine
    ))

    return rows
}

// MARK: - Status chip

private struct ProjectionStatusChip: View {
    let status: String

    private var copy: (label: String, tint: Color) {
        switch status {
        case "on_track":  return ("ON PACE",  Theme.green)
        case "watch":     return ("IN REACH", Theme.goal)
        case "off":       return ("BEHIND",   Theme.over)
        case "race_week": return ("RACE WEEK", Theme.race)
        case "cold":      return ("BASELINE NEEDED", Theme.mute)
        default:          return (status.uppercased(), Theme.mute)
        }
    }

    var body: some View {
        Text(copy.label)
            .font(.body(10, weight: .extraBold)).tracking(1.4)
            .foregroundStyle(copy.tint)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(copy.tint.opacity(0.14), in: Capsule())
            .overlay(Capsule().stroke(copy.tint.opacity(0.4), lineWidth: 0.6))
    }
}

// MARK: - VDOT meta pill

private struct VdotMetaPill: View {
    let key: String
    let value: String

    var body: some View {
        HStack(spacing: 4) {
            Text(key.uppercased())
                .font(.body(9, weight: .bold)).tracking(1.0)
                .foregroundStyle(Theme.mute)
            Text(value)
                .font(.body(11, weight: .extraBold))
                .foregroundStyle(Theme.ink)
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(Theme.Glass.fill, in: Capsule())
        .overlay(Capsule().stroke(Theme.Glass.line, lineWidth: 0.8))
    }
}

// MARK: - Stacked gap bar

private struct StackedGapBar: View {
    let rows: [GapRow]
    let totalSec: Int

    var body: some View {
        if totalSec <= 0 || rows.isEmpty {
            EmptyView()
        } else {
            GeometryReader { geo in
                HStack(spacing: 2) {
                    ForEach(rows.filter { $0.sec > 0 }) { row in
                        let w = max(0, geo.size.width * CGFloat(row.sec) / CGFloat(totalSec))
                        Rectangle()
                            .fill(GapColor.of(row.key))
                            .frame(width: w)
                    }
                }
            }
            .frame(height: 18)
            .clipShape(RoundedRectangle(cornerRadius: 4))
        }
    }
}

// MARK: - Segment legend rows

private struct GapSegmentRow: View {
    let row: GapRow

    private var tagTint: Color {
        switch row.tag {
        case "Trainable": return Theme.green
        case "Partly":    return Theme.goal
        case "Fixed":     return Theme.over
        default:          return Theme.mute
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(GapColor.of(row.key))
                .frame(width: 8, height: 8)
            Text(row.name.uppercased())
                .font(.body(11, weight: .extraBold)).tracking(1.0)
                .foregroundStyle(Theme.ink)
            Spacer(minLength: 4)
            Text(row.tag.uppercased())
                .font(.body(9, weight: .bold)).tracking(1.0)
                .foregroundStyle(tagTint)
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(tagTint.opacity(0.12), in: Capsule())
            Text(formatGap(row.sec))
                .font(.body(12, weight: .extraBold))
                .foregroundStyle(Theme.ink)
                .frame(width: 50, alignment: .trailing)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Hit-list row (server-composed lever)

private struct LeverRow: View {
    let lever: ProjectionLever

    private var icon: String {
        // The wire `icon` field is a doctrine name; map to an SF Symbol.
        switch lever.icon {
        case "flag":   return "flag.fill"
        case "bolt":   return "bolt.fill"
        case "clock":  return "clock.fill"
        case "shield": return "shield.fill"
        case "spark":  return "sparkles"
        default:       return "circle.fill"
        }
    }

    private var controlTint: Color {
        switch lever.controllability {
        case "Trainable":  return Theme.green
        case "Logistics":  return Theme.goal
        case "Smart":      return Theme.race
        default:           return Theme.mute
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(controlTint)
                .frame(width: 22, alignment: .leading)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(lever.title.uppercased())
                        .font(.body(12, weight: .extraBold)).tracking(0.6)
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(deltaText)
                        .font(.body(14, weight: .bold))
                        .foregroundStyle(deltaTint)
                }
                Text(lever.detail)
                    .font(.body(11, weight: .regular))
                    .foregroundStyle(Theme.mute)
                    .lineSpacing(1.5)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 6) {
                    Text(lever.controllability.uppercased())
                        .font(.body(9, weight: .bold)).tracking(1.0)
                        .foregroundStyle(controlTint)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(controlTint.opacity(0.12), in: Capsule())
                    if !lever.lvtag.isEmpty {
                        Text(lever.lvtag)
                            .font(.body(10, weight: .medium))
                            .foregroundStyle(Theme.mute)
                    }
                    Spacer(minLength: 0)
                    if !lever.projectedTime.isEmpty {
                        Text("→ \(lever.projectedTime)")
                            .font(.body(10, weight: .bold))
                            .foregroundStyle(Theme.mute)
                    }
                }
            }
        }
        .padding(.vertical, 8)
    }

    private var deltaText: String {
        let d = lever.deltaSec
        if d == 0 { return "·" }
        let sign = d < 0 ? "−" : "+"
        return "\(sign)\(formatGap(abs(d)))"
    }

    private var deltaTint: Color {
        if lever.deltaSec < 0 { return Theme.goal }   // faster = good
        return Theme.mute
    }
}

// MARK: - Helpers

private func formatGap(_ sec: Int) -> String {
    let a = Swift.abs(sec)
    let m = a / 60
    let s = a % 60
    return String(format: "%d:%02d", m, s)
}

private func formatTime(_ sec: Int?) -> String {
    guard let sec, sec > 0 else { return "—" }
    let h = sec / 3600
    let m = (sec % 3600) / 60
    let s = sec % 60
    if h > 0 {
        return String(format: "%d:%02d:%02d", h, m, s)
    }
    return String(format: "%d:%02d", m, s)
}

private func formatVdot(_ v: Double?) -> String {
    guard let v else { return "—" }
    return String(format: "%.1f", v)
}

private func relativeDate(_ iso: String) -> String {
    guard !iso.isEmpty,
          let d = ISO8601DateFormatter().date(from: iso + "T12:00:00Z") ??
                  ISO8601DateFormatter().date(from: iso) else {
        return iso
    }
    let days = Int(Date().timeIntervalSince(d) / 86400)
    if days < 1 { return "today" }
    if days < 7 { return "\(days)d ago" }
    if days < 60 { return "\(days / 7)w ago" }
    return "\(days / 30)mo ago"
}

// MARK: - Public panel

struct TargetsProjectionPanel: View {
    let summary: ProjectionSummary

    private var rows: [GapRow] { gapRows(from: summary) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header
            truthHeadline
            raceDayLine
            confidenceBand
            metaPills
            if summary.totalGapSec > 0 {
                gapBlock
            }
        }
        .padding(18)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(Theme.line, lineWidth: 1)
        )
    }

    // 1 — Title row + status chip

    private var header: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("YOUR PROJECTION")
                .font(.body(11, weight: .extraBold)).tracking(2.0)
                .foregroundStyle(Theme.mute)
            Text(formatTime(summary.projectionSec))
                .font(.display(30, weight: .bold))
                .foregroundStyle(Theme.ink)
        }
    }

    // 2 — Truth headline + confidence band (range · tier label)

    private var truthHeadline: some View {
        Text(headlineText)
            .font(.display(20, weight: .bold))
            .foregroundStyle(Theme.ink)
            .lineSpacing(2)
            .fixedSize(horizontal: false, vertical: true)
    }

    // "Show both" · the big number is current fitness ("if you raced today");
    // this states the goal-seeking projection explicitly so the runner sees
    // BOTH where they are now and where the plan lands them by race day
    // (David 2026-06-16). Hidden when ahead of goal — the headline already
    // leads with the trajectory there — and when there's no separate
    // trajectory value to add.
    @ViewBuilder
    private var raceDayLine: some View {
        if summary.aheadOfGoal != true,
           let traj = summary.trajectoryProjectedSec,
           traj > 0, traj != summary.projectionSec {
            // Goal-relative + honest (David 2026-06-16): the trajectory is a
            // forward model (current fitness + projected build gain), NOT pinned
            // to the goal. If it lands short, say so and by how much — the plan
            // projecting 1:30:59 against a 1:30:00 goal is a miss, not a hit.
            let goal = summary.goalSec ?? 0
            let short = goal > 0 && traj > goal
            Text(short
                 ? "Plan projects \(formatTime(traj)) by race day — \(formatGap(traj - goal)) short of your \(formatTime(goal)) goal."
                 : "Plan projects \(formatTime(traj)) by race day — on track for \(formatTime(goal)).")
                .font(.body(13, weight: .semibold))
                .foregroundStyle(short ? Theme.over : Theme.green)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func ciTint(_ tier: String) -> Color {
        tier == "high" ? Theme.green : tier == "medium" ? Theme.goal : Theme.over
    }

    @ViewBuilder
    private var confidenceBand: some View {
        if let ci = summary.confidenceInterval, let cl = summary.confidenceLabel {
            HStack(spacing: 8) {
                Text("\(formatTime(ci.lo)) – \(formatTime(ci.hi))")
                    .font(.body(13, weight: .extraBold))
                    .foregroundStyle(Theme.ink)
                Text("·")
                    .font(.body(12, weight: .regular))
                    .foregroundStyle(Theme.mute)
                Text("\(cl.word) · \(cl.descriptor)")
                    .font(.body(11, weight: .medium))
                    .foregroundStyle(ciTint(cl.tier))
            }
        }
    }

    private var headlineText: String {
        // Over-performing · the goal-seeking trajectory leads, mirroring web.
        // Reframes positively rather than dropping the trajectory time into the
        // current-fitness gap copy below (which would read as a contradiction).
        if summary.aheadOfGoal == true {
            let traj = formatTime(summary.trajectoryProjectedSec ?? summary.projectionSec)
            let goal = formatTime(summary.goalSec)
            if let t = summary.trajectoryProjectedSec, let g = summary.goalSec, g > t {
                return "Trajectory hits \(traj) by race day · \(formatGap(g - t)) faster than \(goal). Recent quality is landing ahead of plan."
            }
            return "Tracking to beat \(goal) by race day. Recent quality is landing ahead of plan."
        }
        let goal = formatTime(summary.goalSec)
        let gapSec = summary.totalGapSec
        switch summary.status {
        case "cold":
            return "Need a clean baseline run to project. Race a 5K or threshold rep in the next 10 days."
        case "race_week":
            if gapSec == 0 {
                return "Goal \(goal). Fitness is set. Race week is execution and conditions."
            }
            return "Goal \(goal). Fitness is set. \(formatGap(gapSec)) left — pacing and cooling, not training."
        case "off":
            return "Goal \(goal). You're \(formatGap(gapSec)) off. The gap below shows where it lives."
        case "watch":
            return "Goal \(goal). \(formatGap(gapSec)) to close. Most of it is movable."
        case "on_track":
            if gapSec == 0 {
                return "At \(goal). Hold the plan."
            }
            return "Goal \(goal). \(formatGap(gapSec)) to close. Mix below."
        default:
            return "Goal \(goal)."
        }
    }

    // 3 — VDOT meta pills

    @ViewBuilder
    private var metaPills: some View {
        // Up to 5 chips (VDOT / GOAL / B / HELD / MOVE) exceed the panel
        // width. A plain HStack would stretch the card's layout past the
        // screen and let the whole page drag sideways — contain the overflow
        // in a horizontal scroll so only the chip row scrolls, never the page.
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                VdotMetaPill(key: "VDOT", value: formatVdot(summary.vdot))
                if let goalV = summary.confidenceLabel?.evidence?.goalVdot {
                    VdotMetaPill(key: "GOAL", value: formatVdot(goalV))
                }
                if let bSec = summary.goalSafeSec, bSec > 0 {
                    VdotMetaPill(key: "B", value: formatTime(bSec))
                }
                if summary.heldDays > 0 {
                    VdotMetaPill(key: "HELD", value: "\(summary.heldDays)d")
                }
                if let mv = summary.lastMove {
                    let arrow = mv.deltaVdot >= 0 ? "+" : ""
                    VdotMetaPill(key: "MOVE", value: "\(arrow)\(String(format: "%.1f", mv.deltaVdot)) · \(relativeDate(mv.iso))")
                }
            }
            .padding(.vertical, 1)
        }
    }

    // 4 — Gap bar + segment legend

    @ViewBuilder
    private var gapBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(formatGap(summary.totalGapSec))
                    .font(.display(26, weight: .bold))
                    .foregroundStyle(Theme.ink)
                Text("TO CLOSE")
                    .font(.body(10, weight: .extraBold)).tracking(1.6)
                    .foregroundStyle(Theme.mute)
                Spacer()
            }
            StackedGapBar(rows: rows, totalSec: summary.totalGapSec)
            VStack(spacing: 0) {
                let visible = rows.filter { $0.sec > 0 }
                ForEach(visible) { row in
                    GapSegmentRow(row: row)
                    if row.id != visible.last?.id {
                        Divider().background(Theme.line2)
                    }
                }
            }
        }
    }

    // 5 — Hit list · server-composed levers from computeProjectionLevers

    @ViewBuilder
    private var hitsBlock: some View {
        if !summary.levers.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("HIT LIST")
                    .font(.body(10, weight: .extraBold)).tracking(1.6)
                    .foregroundStyle(Theme.mute)
                VStack(spacing: 0) {
                    ForEach(summary.levers) { lv in
                        LeverRow(lever: lv)
                        if lv.id != summary.levers.last?.id {
                            Divider().background(Theme.line2)
                        }
                    }
                }
            }
            .padding(.top, 4)
        }
    }
}

// MARK: - Cold-start variant

struct TargetsProjectionColdState: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("CLOSING THE GAP")
                    .font(.body(11, weight: .extraBold)).tracking(2.0)
                    .foregroundStyle(Theme.mute)
                Spacer()
                ProjectionStatusChip(status: "cold")
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
        .padding(18)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(Theme.line, lineWidth: 1)
        )
    }
}
