//
//  RacesView.swift  (P5 — iOS parity for /races)
//  Coach voice + race list. 2026-05-27: added race list (web has it,
//  iPhone didn't) — same /api/races data the web /races page reads.
//  Tap a race → RaceDetailSheet (proximity-adaptive coach brief).
//

import SwiftUI

struct RacesView: View {
    @State private var briefing: Briefing?
    @State private var races: [RaceListItem] = []
    @State private var loadingRaces = true
    /// Tapped-race slug drives the RaceDetailSheet presentation.
    @State private var selected: RaceListItem?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Background-load coach — page chrome paints immediately.
                    CoachSlot(
                        briefing: briefing,
                        surface: "races",
                        askPrompt: nil
                    )

                    if let briefing, !briefing.topics.isEmpty {
                        VStack(spacing: 10) {
                            ForEach(Array(briefing.topics.enumerated()), id: \.offset) { _, topic in
                                TopicRenderer(topic: topic)
                            }
                        }
                        .padding(.horizontal, 24)
                        .transition(.opacity)
                    }

                    // Race list — same data web /races shows. Sorted
                    // soonest-first; past races sink to the bottom.
                    if !races.isEmpty {
                        racesSection
                            .transition(.opacity)
                    } else if loadingRaces {
                        racesSkeleton
                            .transition(.opacity)
                    }
                }
                .padding(.bottom, 40)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: briefing?.lead)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: races.count)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Races")
            .navigationBarTitleDisplayMode(.large)
            .task { await load() }
            .refreshable { await load() }
            .sensoryFeedback(.selection, trigger: selected?.slug)
            .sheet(item: $selected) { r in
                RaceDetailSheet(slug: r.slug)
            }
        }
    }

    // MARK: - Race list

    private var racesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("ALL RACES")
                .font(.label(10)).tracking(1.6)
                .foregroundStyle(Theme.mute)
                .padding(.horizontal, 24)

            VStack(spacing: 10) {
                ForEach(races) { race in
                    Button { selected = race } label: { raceRow(race) }
                        .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 24)
        }
    }

    private func raceRow(_ r: RaceListItem) -> some View {
        HStack(alignment: .center, spacing: 12) {
            // Priority chip — A in race orange, B in gold, C in mute.
            if let p = r.priority {
                Text(p)
                    .font(.label(11)).tracking(1.2)
                    .foregroundStyle(priorityColor(p))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(priorityColor(p).opacity(0.18))
                    .clipShape(Capsule())
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(r.name ?? r.slug)
                    .font(.display(18))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                HStack(spacing: 6) {
                    if let d = r.date { Text(d).font(.body(11)).foregroundStyle(Theme.mute) }
                    if let dist = r.distance_label {
                        Text("·").foregroundStyle(Theme.mute)
                        Text(dist).font(.body(11)).foregroundStyle(Theme.mute)
                    }
                    if let loc = r.location {
                        Text("·").foregroundStyle(Theme.mute)
                        Text(loc)
                            .font(.body(11)).foregroundStyle(Theme.mute)
                            .lineLimit(1)
                    }
                }
            }
            Spacer()
            // Days-out: positive = upcoming, negative = past.
            if let days = r.days_to_race {
                Text(daysLabel(days))
                    .font(.body(11, weight: .semibold))
                    .foregroundStyle(days >= 0 ? Theme.race : Theme.mute)
            }
        }
        .padding(14)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
        .contentShape(Rectangle())
    }

    private func priorityColor(_ p: String) -> Color {
        switch p.uppercased() {
        case "A":  return Theme.race
        case "B":  return Theme.goal
        case "C":  return Theme.mute
        default:   return Theme.mute
        }
    }

    private func daysLabel(_ days: Int) -> String {
        if days == 0 { return "TODAY" }
        if days > 0  { return "in \(days)d" }
        return "\(-days)d ago"
    }

    private var racesSkeleton: some View {
        VStack(alignment: .leading, spacing: 10) {
            RoundedRectangle(cornerRadius: 3)
                .fill(Theme.ink.opacity(0.05))
                .frame(width: 80, height: 10)
                .padding(.horizontal, 24)

            VStack(spacing: 10) {
                ForEach(0..<3, id: \.self) { _ in
                    HStack(spacing: 12) {
                        Capsule().fill(Theme.ink.opacity(0.06)).frame(width: 24, height: 18)
                        VStack(alignment: .leading, spacing: 4) {
                            RoundedRectangle(cornerRadius: 4)
                                .fill(Theme.ink.opacity(0.06))
                                .frame(width: 180, height: 16)
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Theme.ink.opacity(0.04))
                                .frame(width: 120, height: 10)
                        }
                        Spacer()
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Theme.ink.opacity(0.05))
                            .frame(width: 40, height: 10)
                    }
                    .padding(14)
                    .background(Theme.card)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
                    .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
                }
            }
            .padding(.horizontal, 24)
        }
    }

    private func load() async {
        async let bRes  = (try? await API.briefing(surface: "races"))
        async let rRes  = (try? await API.fetchRaces())
        briefing = await bRes ?? nil
        if let resp = await rRes ?? nil {
            races = resp.races
        }
        loadingRaces = false
    }
}
