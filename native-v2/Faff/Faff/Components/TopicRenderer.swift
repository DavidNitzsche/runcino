//
//  TopicRenderer.swift
//  Polymorphic switch over topic kind, mirroring web-v2 TopicRenderer.tsx.
//  Unknown kinds are silently dropped (forward-compat).
//

import SwiftUI

struct TopicRenderer: View {
    let topic: Topic

    var body: some View {
        switch topic.kind {
        case .run_recap:
            CardSurface {
                RunRecapCard(
                    mi: doubleVal("distance_mi") ?? 0,
                    pace: stringVal("pace"),
                    time: stringVal("time_moving"),
                    hr: intVal("hr"),
                    cadence: intVal("cadence"),
                    weatherChip: stringVal("weather_chip"),
                    note: topic.coach_note
                )
            }
        case .next_workout:
            CardSurface {
                NextWorkoutCard(
                    dow: stringVal("dow") ?? "TOMORROW",
                    workoutType: stringVal("type") ?? "EASY",
                    label: stringVal("label"),
                    mi: doubleVal("mi") ?? 0,
                    note: topic.coach_note
                )
            }
        case .race_horizon:
            CardSurface {
                RaceHorizonCard(
                    name: stringVal("race_name") ?? "RACE",
                    date: stringVal("race_date") ?? "",
                    daysToRace: intVal("days_to_race") ?? 0,
                    tone: stringVal("tone") ?? "building",
                    goal: stringVal("goal"),
                    note: topic.coach_note
                )
            }
        case .profile_gap:
            ProfileGapCard(
                field: stringVal("field") ?? "?",
                why:   stringVal("why")   ?? ""
            )
        case .sleep_deficit:
            CardSurface {
                SleepDeficitCard(
                    avg7n:     doubleVal("avg_h_7n")     ?? 0,
                    deficit:   doubleVal("deficit_h_7n") ?? 0,
                    lastNight: doubleVal("last_night_h"),
                    note: topic.coach_note
                )
            }
        case .watch_list:
            let items = (arrayVal("items") ?? []).compactMap { row -> (String, String, String)? in
                guard let d = row as? [String: Any],
                      let label = d["label"] as? String,
                      let status = d["status"] as? String,
                      let note = d["note"] as? String else { return nil }
                return (label, status, note)
            }
            WatchListCard(items: items)
        case .fun_fact:
            FunFactCard(
                term: stringVal("term") ?? "",
                text: stringVal("body") ?? "",
                linkSlug: stringVal("link_slug") ?? ""
            )
        default:
            EmptyView()
        }
    }

    private func stringVal(_ k: String) -> String? { (topic.payload?[k]?.value as? String) }
    private func intVal(_ k: String) -> Int? {
        if let i = topic.payload?[k]?.value as? Int { return i }
        if let d = topic.payload?[k]?.value as? Double { return Int(d) }
        return nil
    }
    private func doubleVal(_ k: String) -> Double? {
        if let d = topic.payload?[k]?.value as? Double { return d }
        if let i = topic.payload?[k]?.value as? Int { return Double(i) }
        return nil
    }
    private func arrayVal(_ k: String) -> [Any]? { topic.payload?[k]?.value as? [Any] }
}
