//
//  RacesView.swift  (Phase 25b · iOS /races v3 mirror)
//
//  iPhone /races surface — aligned with the web v3 design at
//  web-v2/app/races/page.tsx. Reuses the shared PageHeader (Phase 25a)
//  so the chrome matches Training / Log / Health / Profile.
//
//  Composition (top → bottom):
//    1) PageHeader            ← FaffPageShell mirror (display-recipe
//                               title + caps-tracked eyebrow + accent
//                               slot = next A-race countdown chip)
//    2) Coach voice (CoachSlot, background-loaded)
//    3) Race cards (A hero · A secondary · B compact · C compact · past)
//
//  Title rule (mirrors races/page.tsx line 14):
//    · "Races."         when an A-race is set
//    · "What's next?"   when there's no A-race
//
//  Eyebrow rule (mirrors races/page.tsx lines 15-22):
//    "3 A-RACES · 1 B-RACE · 1 C-RACE · 5 PAST"
//
//  Accent chip:
//    Next A-race countdown — "17 DAYS" — race-orange. Hidden when no
//    A-race exists (the eyebrow already says NO A-RACE SET).
//
//  Cardinal Rule #4 — Theme tokens only · no inline hex. Adapter
//  pure-function helpers fan out the bucketing + colors so the View
//  stays a thin shell.
//

import SwiftUI

struct RacesView: View {
    // Hydrate from AppCache so first tap after launch paints instantly.
    @State private var briefing: Briefing? =
        AppCache.read(.racesBriefing, as: Briefing.self)
    @State private var races: [RaceListItem] =
        AppCache.read(.raceList, as: RaceListResponse.self)?.races ?? []
    /// `loadingRaces` only fires when there's literally nothing cached
    /// — i.e. fresh install. Otherwise we paint and refresh quietly.
    @State private var loadingRaces: Bool = AppCache.readRaw(.raceList) == nil
    /// Tapped-race slug drives the RaceDetailSheet presentation.
    @State private var selected: RaceListItem?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    PageHeader(
                        title: headerTitle,
                        eyebrow: FaffAdapter.racesEyebrow(races: races),
                        accent: headerAccent
                    )

                    // Coach voice — background-loads, never blocks page paint.
                    CoachSlot(
                        briefing: briefing,
                        surface: "races",
                        askPrompt: nil
                    )

                    if !races.isEmpty {
                        raceList
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
            // PageHeader paints the in-shell title. Suppress the system
            // chrome title so we don't double up.
            .navigationTitle("Races")
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
            .refreshable { await load() }
            .sensoryFeedback(.selection, trigger: selected?.slug)
            .sheet(item: $selected) { r in
                RaceDetailSheet(slug: r.slug)
            }
        }
    }

    // MARK: - Header inputs

    /// "Races." when at least one A-race exists, "What's next?" otherwise.
    /// Matches races/page.tsx:14 exactly.
    private var headerTitle: String {
        let hasA = races.contains {
            ($0.priority ?? "").uppercased() == "A" && ($0.days_to_race ?? -1) >= 0
        }
        return hasA ? "Races." : "What's next?"
    }

    /// Next-A countdown chip in the accent slot. Hidden when no A-race
    /// is set (the eyebrow already communicates the gap).
    private var headerAccent: AnyView? {
        guard let days = FaffAdapter.nextARaceCountdown(races: races) else { return nil }
        let color = Theme.race
        return AnyView(
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(days)")
                    .font(.display(40))
                    .foregroundStyle(color)
                    .lineLimit(1)
                Text("DAYS")
                    .font(.label(10))
                    .tracking(1.4)
                    .foregroundStyle(Theme.mute)
            }
        )
    }

    // MARK: - Race list

    /// A-races (hero + secondaries) → B-races → C-races → past races.
    /// Each bucket is wrapped in a labeled section header to mirror the
    /// web's SectionLabel rhythm.
    private var raceList: some View {
        let upcoming = races.filter { ($0.days_to_race ?? 0) >= 0 }
        let past = races.filter { ($0.days_to_race ?? 0) < 0 }

        // Sort each bucket soonest-first; past sorts most-recent first.
        let aRaces = upcoming
            .filter { ($0.priority ?? "").uppercased() == "A" }
            .sorted { ($0.days_to_race ?? .max) < ($1.days_to_race ?? .max) }
        let bRaces = upcoming
            .filter { ($0.priority ?? "").uppercased() == "B" }
            .sorted { ($0.days_to_race ?? .max) < ($1.days_to_race ?? .max) }
        let cRaces = upcoming
            .filter {
                let p = ($0.priority ?? "").uppercased()
                return p == "C" || p.isEmpty
            }
            .sorted { ($0.days_to_race ?? .max) < ($1.days_to_race ?? .max) }
        let pastSorted = past
            .sorted { ($0.days_to_race ?? .max) > ($1.days_to_race ?? .max) }

        return VStack(alignment: .leading, spacing: 18) {
            if let hero = aRaces.first {
                bucket(label: "UPCOMING · A-RACE") {
                    RaceCard(race: hero, style: .hero) { selected = hero }
                    ForEach(aRaces.dropFirst()) { r in
                        RaceCard(race: r, style: .secondary) { selected = r }
                    }
                }
            }

            if !bRaces.isEmpty {
                bucket(label: "UPCOMING · B-RACES") {
                    ForEach(bRaces) { r in
                        RaceCard(race: r, style: .compact) { selected = r }
                    }
                }
            }

            if !cRaces.isEmpty {
                bucket(label: "UPCOMING · C-RACES") {
                    ForEach(cRaces) { r in
                        RaceCard(race: r, style: .compact) { selected = r }
                    }
                }
            }

            if !pastSorted.isEmpty {
                bucket(label: "PAST") {
                    ForEach(pastSorted) { r in
                        RaceCard(race: r, style: .past) { selected = r }
                    }
                }
            }
        }
        .padding(.horizontal, 24)
    }

    @ViewBuilder
    private func bucket<Content: View>(
        label: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(label)
                .font(.label(10))
                .tracking(1.6)
                .foregroundStyle(Theme.mute)
            VStack(spacing: 10) { content() }
        }
    }

    // MARK: - Skeleton

    private var racesSkeleton: some View {
        VStack(alignment: .leading, spacing: 10) {
            RoundedRectangle(cornerRadius: 3)
                .fill(Theme.ink.opacity(0.05))
                .frame(width: 80, height: 10)

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
        }
        .padding(.horizontal, 24)
    }

    // MARK: - Load

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
