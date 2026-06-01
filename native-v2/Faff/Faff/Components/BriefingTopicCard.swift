//
//  BriefingTopicCard.swift
//  Polymorphic renderer for /api/briefing topics (27 kinds).
//
//  The server emits a list of Topic envelopes; each carries a kind +
//  loose-typed payload + coach_note. iPhone previously rendered ONLY
//  workout_breakdown and silently dropped the other 26. This dispatcher
//  closes that gap: every known kind picks up a card; an unknown kind
//  falls back to a kind-label + coach_note row so the runner sees
//  *something* meaningful even on a future server-side addition.
//
//  Doctrine 2026-05-31:
//    · No emoji · no em dashes
//    · Coach voice copy (server payload owns the words)
//    · Effort + heat colors accent the dot/border, never the body text
//    · Each card stays minimal so a Today briefing with 10 topics
//      doesn't blow the layout up
//

import SwiftUI

struct BriefingTopicCard: View {
    let topic: Topic

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle().fill(accentColor).frame(width: 8, height: 8)
                Text(headline.uppercased())
                    .font(.body(10, weight: .extraBold)).tracking(1.4)
                    .foregroundStyle(accentColor)
                Spacer()
            }
            if !leadLine.isEmpty {
                Text(leadLine)
                    .font(.body(13, weight: .extraBold))
                    .foregroundStyle(Theme.txt)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let note = topic.coach_note, !note.isEmpty {
                Text(note)
                    .font(.body(12.5, weight: .medium))
                    .foregroundStyle(Theme.txt.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(accentColor.opacity(0.30), lineWidth: 1))
    }

    // MARK: - Per-kind copy + color

    private var headline: String {
        switch topic.kind {
        case .run_recap:        return "Run recap"
        case .sleep_deficit:    return "Sleep deficit"
        case .sleep_trend:      return "Sleep trend"
        case .hrv_trend:        return "HRV trend"
        case .rhr_trend:        return "RHR trend"
        case .weight_trend:     return "Weight trend"
        case .next_workout:     return "Next workout"
        case .race_horizon:     return "Race horizon"
        case .race_trajectory:  return "Race trajectory"
        case .cadence_insight:  return "Cadence"
        case .cadence_experiment: return "Cadence experiment"
        case .profile_gap:      return "Profile gap"
        case .fun_fact:         return "Fun fact"
        case .watch_list:       return "Watch list"
        case .shoe_status:      return "Shoe status"
        case .shoe_race_fit:    return "Race shoe"
        case .shoe_rotation:    return "Shoe rotation"
        case .plan_arc:         return "Plan arc"
        case .phase_context:    return "Phase"
        case .next_quality:     return "Next quality"
        case .volume_delta:     return "Volume delta"
        case .weather_chip:     return "Weather"
        case .fueling_plan:     return "Fueling"
        case .kit_list:         return "Kit list"
        case .race_morning_schedule: return "Race morning"
        case .unknown:          return "Briefing"
        }
    }

    private var leadLine: String {
        // Prefer the payload's lead / value / summary when present.
        let p = topic.payload ?? [:]
        for key in ["lead", "headline", "summary", "value", "label", "text", "title"] {
            if let s = p[key]?.value as? String, !s.isEmpty { return s }
        }
        return ""
    }

    /// Color picked to match the surface theme. Sleep / HRV / RHR / weight
    /// trends ride the dist (info) ramp; race + plan ride the race orange;
    /// shoes + cadence ride the green-amber midline; gaps ride mint.
    private var accentColor: Color {
        switch topic.kind {
        case .sleep_deficit, .sleep_trend, .hrv_trend, .rhr_trend, .weight_trend:
            return Theme.dist
        case .race_horizon, .race_trajectory, .race_morning_schedule:
            return Theme.race
        case .next_workout, .next_quality, .phase_context, .plan_arc, .volume_delta:
            return Theme.goal
        case .shoe_status, .shoe_race_fit, .shoe_rotation:
            return Theme.Accent.amberBright
        case .cadence_insight, .cadence_experiment:
            return Theme.Accent.mintReady
        case .profile_gap, .fun_fact, .watch_list:
            return Theme.Accent.mintReady
        case .weather_chip, .fueling_plan, .kit_list:
            return Theme.goal
        case .run_recap, .unknown:
            return Theme.mute
        }
    }
}
