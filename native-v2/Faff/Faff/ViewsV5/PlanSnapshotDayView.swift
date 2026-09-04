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

/// HEROPANEL-1 (2026-09-04) · plain content now, NOT its own scrolling
/// screen. `type`/`kicker`/`dose`/`stats` — the "RACE DAY" eyebrow, the big
/// display face, the mileage, the pace/HR stat plate — moved OUT of this
/// view and into `HeroDayPanelContentV5`, drawn inside the SAME coloured
/// `DayPanel` the header sits in (see `HostsV5.swift`'s snapshot-day call
/// site). This view used to wrap that same information in its own
/// `ScrollView`, separately coloured (`.quiet`) from the header above it —
/// two templates for one day, which is the exact inconsistency David named
/// live: "Every day should look like this. The only thing that changes is
/// the color, run, specific info, etc." What is left here — the workout's
/// own headline/notes, the step list, matched/supplemental activity — is
/// everything the hero panel does NOT already say, scrolling as one piece
/// with the panel above it inside `inSharedShell`'s own `ScrollView`.
struct PlanSnapshotDayView: View {
    let day: PlanSnapshotDay

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
            if let headline = day.card?.headline ?? day.sub_label, !day.is_rest {
                Text(headline)
                    .font(.faffDisplay(24))
                    .foregroundStyle(V5.textPrimary)
            }
            if let notes = day.notes, !notes.isEmpty {
                Text(notes)
                    .font(.faffText(TypeScaleV5.label14))
                    .foregroundStyle(V5.textSecondary)
            }
            if day.is_rest {
                restCard
            } else if let card = day.card {
                workoutCard(card)
            }
            if day.matched_run != nil || !day.supplemental_runs.isEmpty {
                activityOverlay
            }
        }
        // Bottom clearance above the tab bar is `inSharedShell`'s own job
        // now (`.padding(.bottom, V5.S.s24)` on its outer VStack) — the
        // same one every other `content()` it wraps already relies on,
        // rather than this view adding a second, view-specific inset.
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
