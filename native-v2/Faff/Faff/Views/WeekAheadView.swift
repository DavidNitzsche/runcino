//
//  WeekAheadView.swift
//  This-week agenda. Lives in Train (owner of time): 26-week arc → this
//  week's agenda → tap a session for Planned Detail.
//

import SwiftUI

struct WeekAheadView: View {
    @State private var planWeek: PlanWeek? =
        AppCache.read(.planWeek, as: PlanWeek.self)

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let mesh = FaffMesh.forView(.train)
        ZStack {
            FaffMeshView(mesh: mesh)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    header
                        .padding(.horizontal, 22)
                        .padding(.top, 8)

                    hero
                        .padding(.horizontal, 24)
                        .padding(.top, 18)

                    agenda
                        .padding(.top, 24)

                    Text("Tap any session for the full plan · paces, fuel & why")
                        .font(.display(10, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.45))
                        .padding(.horizontal, 24)
                        .padding(.vertical, 6)
                        .padding(.bottom, 40)
                }
            }
        }
        .task { await load() }
    }

    private var header: some View {
        HStack(spacing: 12) {
            BackChip { dismiss() }
            SpecLabel(text: "THIS WEEK", size: 13, tracking: 2.5, color: Theme.txt)
            Spacer()
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 0) {
            SpecLabel(text: "WEEK 14 OF 26 · BUILD PHASE", size: 11, tracking: 2.5, color: Theme.txt.opacity(0.66))
            Text("The week\nahead.")
                .font(.display(40, weight: .bold))
                .tracking(-1.5)
                .lineSpacing(-8)
                .foregroundStyle(Theme.txt)
                .padding(.top, 9)
            Text(dateRangeLabel)
                .font(.display(11, weight: .bold))
                .foregroundStyle(Theme.txt.opacity(0.7))
                .padding(.top, 10)

            HStack(alignment: .top, spacing: 26) {
                bigStat(value: plannedMi, unit: " mi", key: "PLANNED")
                bigStat(value: "\(sessionsCount)", unit: nil, key: "SESSIONS")
                bigStat(value: "\(doneCount)", unit: "/\(sessionsCount)", key: "DONE")
            }
            .padding(.top, 18)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func bigStat(value: String, unit: String?, key: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .lastTextBaseline, spacing: 2) {
                Text(value).font(.display(26, weight: .bold)).tracking(-1).foregroundStyle(Theme.txt)
                if let u = unit { Text(u).font(.display(13, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.7)) }
            }
            SpecLabel(text: key, size: 9, tracking: 1.5, color: Theme.txt.opacity(0.6))
        }
    }

    private var agenda: some View {
        VStack(alignment: .leading, spacing: 0) {
            SpecLabel(text: "UPCOMING & DONE", size: 11, tracking: 2, color: Theme.txt.opacity(0.55))
                .padding(.horizontal, 24).padding(.bottom, 12)

            VStack(spacing: 4) {
                ForEach(agendaRows) { d in
                    if d.effort == .rest {
                        AgendaRow(day: d).padding(.horizontal, 18)
                    } else {
                        NavigationLink(value: d.runId.map { FaffRoute.runDetail(id: $0) } ?? FaffRoute.planned(workoutId: nil)) {
                            AgendaRow(day: d).padding(.horizontal, 18)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: - Data

    private var dateRangeLabel: String {
        "May 26 – Jun 1"
    }

    private var plannedMi: String {
        if let pw = planWeek {
            let mi = pw.days.reduce(0.0) { $0 + $1.distance_mi }
            if mi > 0 { return "\(Int(round(mi)))" }
        }
        return "50"
    }

    private var sessionsCount: Int {
        if let pw = planWeek {
            return pw.days.filter { $0.type != "rest" && $0.distance_mi > 0 }.count
        }
        return 5
    }

    private var doneCount: Int {
        if let pw = planWeek {
            return pw.days.compactMap { $0.completedRunId }.count
        }
        return 2
    }

    private var agendaRows: [AgendaDay] {
        if let pw = planWeek {
            return pw.days.map { d in
                AgendaDay(
                    id: d.date_iso,
                    dow: dowFromIdx(d.dow),
                    dn: dayNumberFromDate(d.date_iso),
                    name: nameFor(type: d.type, label: d.sub_label),
                    detail: detailFor(d),
                    effort: FaffEffort.fromType(d.type),
                    isToday: d.is_today,
                    isDone: d.completedRunId != nil
                )
            }
        }
        return placeholderDays
    }

    private var placeholderDays: [AgendaDay] {
        [
            AgendaDay(id: "0", dow: "MON", dn: 26, name: "Easy Aerobic", detail: "6.0 mi · 8:45/mi", effort: .easy, isToday: false, isDone: true),
            AgendaDay(id: "1", dow: "TUE", dn: 27, name: "Track Intervals", detail: "6.0 mi · 6×800 @ 6:05", effort: .intervals, isToday: false, isDone: true),
            AgendaDay(id: "2", dow: "WED", dn: 28, name: "Tempo Run", detail: "8.0 mi · 6:38 threshold", effort: .tempo, isToday: true, isDone: false),
            AgendaDay(id: "3", dow: "THU", dn: 29, name: "Recovery Jog", detail: "4.0 mi · 9:30/mi", effort: .recovery, isToday: false, isDone: false),
            AgendaDay(id: "4", dow: "FRI", dn: 30, name: "Rest Day", detail: "mobility · sleep", effort: .rest, isToday: false, isDone: false),
            AgendaDay(id: "5", dow: "SAT", dn: 31, name: "Long Run", detail: "18.0 mi · Z2→MP", effort: .long, isToday: false, isDone: false),
            AgendaDay(id: "6", dow: "SUN", dn: 1, name: "Recovery Jog", detail: "4.0 mi · shakeout", effort: .recovery, isToday: false, isDone: false)
        ]
    }

    private func dowFromIdx(_ i: Int) -> String {
        let map = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
        return map[max(0, min(6, i - 1))]
    }

    private func dayNumberFromDate(_ iso: String) -> Int {
        let parts = iso.split(separator: "-")
        guard parts.count == 3 else { return 0 }
        return Int(parts[2]) ?? 0
    }

    private func nameFor(type: String, label: String?) -> String {
        switch type.lowercased() {
        case "easy": return "Easy Aerobic"
        case "long": return "Long Run"
        case "tempo", "threshold": return "Tempo Run"
        case "intervals", "vo2", "track": return "Track Intervals"
        case "recovery": return "Recovery Jog"
        case "rest", "off": return "Rest Day"
        case "race", "race_a", "race_b", "race_c": return "Race"
        default: return label ?? type.capitalized
        }
    }

    private func detailFor(_ d: PlanDay) -> String {
        if let sub = d.sub_label, !sub.isEmpty { return sub }
        if d.type == "rest" { return "mobility · sleep" }
        return "\(String(format: "%.1f", d.distance_mi)) mi"
    }

    private func load() async {
        if let pw = try? await API.fetchPlanWeek() {
            await MainActor.run { planWeek = pw }
        }
    }
}

private struct AgendaDay: Identifiable {
    let id: String
    let dow: String
    let dn: Int
    let name: String
    let detail: String
    let effort: FaffEffort
    let isToday: Bool
    let isDone: Bool
    var runId: String? = nil
}

private struct AgendaRow: View {
    let day: AgendaDay
    var body: some View {
        HStack(spacing: 14) {
            RoundedRectangle(cornerRadius: 3).fill(day.effort.dot).frame(width: 4)
                .frame(maxHeight: .infinity)
            VStack(spacing: 1) {
                Text(day.dow).font(.label(10)).tracking(0.5).foregroundStyle(Theme.txt.opacity(0.55))
                Text("\(day.dn)").font(.display(17, weight: .bold)).foregroundStyle(Theme.txt)
            }
            .frame(width: 34)

            VStack(alignment: .leading, spacing: 3) {
                Text(day.name).font(.body(16, weight: .extraBold)).tracking(-0.3).foregroundStyle(Theme.txt)
                Text(day.detail).font(.display(11, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.6))
            }

            Spacer(minLength: 0)

            HStack(spacing: 9) {
                if day.isDone {
                    ZStack {
                        Circle().fill(Color(hex: 0x9AF0BF).opacity(0.18)).frame(width: 20, height: 20)
                        Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(Color(hex: 0x9AF0BF))
                    }
                } else if day.isToday {
                    Text("TODAY")
                        .font(.label(8.5)).tracking(1)
                        .foregroundStyle(Color(hex: 0x1C0A02))
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(Color(hex: 0xFFD27A), in: RoundedRectangle(cornerRadius: 5))
                }
                if day.effort != .rest {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.4))
                }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 14)
        .frame(minHeight: 64)
        .background(
            day.isToday ? Color.white.opacity(0.08) : Color.clear,
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(day.isToday ? Color.white.opacity(0.18) : Color.clear, lineWidth: 1)
        )
        .opacity(day.effort == .rest ? 0.5 : 1)
    }
}
