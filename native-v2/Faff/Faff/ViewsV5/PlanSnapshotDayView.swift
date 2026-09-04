//
//  PlanSnapshotDayView.swift
//  PLANSNAPSHOT-1 · the content view for any date rendered from the local
//  `PlanSnapshot` — every date the runner browses to that is NOT the actual
//  current day (which keeps the existing live `TodayBeforeV5`/`TodayAfterV5`
//  narrative, refreshed at launch/foreground per the sync contract, not per
//  navigation tap).
//
//  Deliberately simpler than Today's own live screens: a `PlanSnapshotDay`
//  carries authored STRUCTURE (phase list, pace/HR guidance, matched vs
//  supplemental activity), never live narrative (readiness, contingency,
//  "where you are") — see `web-v2/lib/plan/plan-snapshot.ts`'s header for
//  why that's a deliberate scope line, not an oversight. Wrapped in the same
//  shared shell (`TodayHostV5.inSharedShell`) every other Today state uses,
//  so the header/week-strip/tabs never re-mount for this state either.
//

import SwiftUI

struct PlanSnapshotDayView: View {
    let day: PlanSnapshotDay

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                header
                if day.is_rest {
                    restCard
                } else if let card = day.card {
                    workoutCard(card)
                }
                if day.matched_run != nil || !day.supplemental_runs.isEmpty {
                    activityOverlay
                }
            }
            .padding(.horizontal, V5.S.gutter)
            .padding(.top, V5.S.s16)
            // Content must scroll fully above the persistent bottom tab bar —
            // see `ShellV5.swift`'s `TabBarV5` height token. A fixed bottom
            // inset here (rather than relying on safe-area alone) is what
            // keeps the LAST row readable when the sheet's own safe-area
            // inset is absorbed by the tab bar's own background.
            .padding(.bottom, V5.Shell.tabBarHeight + V5.S.s24)
            .v5PageWidth()
        }
        .scrollIndicators(.hidden)
        .background(V5.surfacePage)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: V5.S.s4) {
            Text(day.is_race ? "RACE DAY" : day.type.uppercased())
                .font(.faffText(TypeScaleV5.label12))
                .foregroundStyle(V5.textQuiet)
            Text(day.card?.headline ?? (day.is_rest ? "Rest" : day.sub_label ?? day.type.capitalized))
                .font(.faffDisplay(24))
                .foregroundStyle(V5.textPrimary)
            if let notes = day.notes, !notes.isEmpty {
                Text(notes)
                    .font(.faffText(TypeScaleV5.label14))
                    .foregroundStyle(V5.textSecondary)
            }
        }
    }

    private var restCard: some View {
        ListGroup {
            ListRow(label: "Today", sub: "No running. Sleep, mobility, fuel.")
        }
    }

    @ViewBuilder
    private func workoutCard(_ card: PlanSnapshotCard) -> some View {
        ListGroup(header: statLine(card)) {
            ForEach(Array(card.steps.enumerated()), id: \.offset) { _, step in
                ListRow(label: stepLabel(step), sub: stepSub(step))
                if let recovery = step.recovery {
                    ListRow(label: "Recovery", sub: [recovery.duration, recovery.pace_target]
                        .compactMap { $0 }.joined(separator: " · "))
                }
            }
        }
        if let treadmill = dayTreadmillGuidance {
            ListGroup(header: "On a treadmill") {
                ListRow(label: treadmillLabel(treadmill), sub: nil)
            }
        }
    }

    private var dayTreadmillGuidance: PlanSnapshotTreadmillGuidance? { day.treadmill }

    private func treadmillLabel(_ t: PlanSnapshotTreadmillGuidance) -> String {
        let incline = "\(Int(t.inclinePct))% incline"
        guard let speed = t.speedMph else { return "By effort · \(incline)" }
        return "\(speed) mph · \(incline)"
    }

    private func statLine(_ card: PlanSnapshotCard) -> String {
        var parts: [String] = []
        if card.total_mi > 0 {
            parts.append(String(format: "%.1f mi", card.total_mi))
        }
        if let sec = card.totalDurationSec, sec > 0 {
            parts.append("about \(Int(sec / 60)) min")
        }
        return parts.joined(separator: " · ")
    }

    private func stepLabel(_ step: PlanSnapshotStep) -> String {
        if let reps = step.reps {
            let unit = step.rep_distance_mi.map { String(format: "%.2f mi", $0) } ?? step.duration ?? ""
            let noun = step.rep_noun.map { " \($0)" } ?? ""
            return "\(reps) × \(unit)\(noun)"
        }
        if let dist = step.distance_mi { return String(format: "%@ · %.1f mi", step.label, dist) }
        return step.label
    }

    private func stepSub(_ step: PlanSnapshotStep) -> String {
        var parts: [String] = []
        if let pace = step.pace_target { parts.append(pace) }
        if let hr = step.hr_target { parts.append(hr) }
        if let effort = step.effort_target { parts.append(effort) }
        if parts.isEmpty { return step.note }
        return parts.joined(separator: " · ")
    }

    // MARK: - Matched vs supplemental (never conflated — see day-resolver.ts)

    private var activityOverlay: some View {
        ListGroup(header: "Activity") {
            if let matched = day.matched_run {
                ListRow(label: matchedLabel(matched), sub: activitySub(distanceMi: matched.distanceMi,
                                                                        durationSec: matched.durationSec,
                                                                        paceSPerMi: matched.paceSPerMi))
            }
            ForEach(day.supplemental_runs) { run in
                ListRow(label: "Also logged", sub: activitySub(distanceMi: run.distanceMi,
                                                                durationSec: run.durationSec,
                                                                paceSPerMi: run.paceSPerMi))
            }
        }
    }

    private func matchedLabel(_ m: PlanSnapshotMatchedRun) -> String {
        switch m.match {
        case "exact": return "Matched this session"
        case "legacy_type": return "Logged this session"
        default: return "Logged"
        }
    }

    private func activitySub(distanceMi: Double?, durationSec: Double?, paceSPerMi: Double?) -> String {
        var parts: [String] = []
        if let d = distanceMi { parts.append(String(format: "%.2f mi", d)) }
        if let s = durationSec, s > 0 {
            let m = Int(s) / 60, sec = Int(s) % 60
            parts.append(String(format: "%d:%02d", m, sec))
        }
        return parts.joined(separator: " · ")
    }
}
