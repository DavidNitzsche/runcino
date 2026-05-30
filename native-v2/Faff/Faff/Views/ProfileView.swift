//
//  ProfileView.swift
//  v3 Profile · reached via avatar in tab headers, not a sixth tab.
//

import SwiftUI

struct ProfileView: View {
    let onDismiss: () -> Void

    @State private var profile: ProfileState?
    @State private var meFacts: CoachFactsBlock?

    var body: some View {
        ZStack {
            FaffMeshView(mesh: FaffMesh.forView(.profile))

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    headerRow
                        .padding(.horizontal, 24).padding(.top, 16)

                    userRow
                        .padding(.horizontal, 24).padding(.top, 22)

                    if !coachStats.isEmpty {
                        SectionLabel(title: "AT A GLANCE")
                            .padding(.horizontal, 22).padding(.top, 26)
                        coachStatsCard
                            .padding(.horizontal, 22).padding(.top, 12)
                    }

                    if let shoes = profile?.shoes, !shoes.isEmpty {
                        SectionLabel(title: "SHOE GARAGE")
                            .padding(.horizontal, 22).padding(.top, 30)
                        shoeCarousel(shoes)
                            .padding(.top, 13)
                    }

                    SectionLabel(title: "CONNECTED")
                        .padding(.horizontal, 22).padding(.top, 30)
                    connectionsCard
                        .padding(.horizontal, 22).padding(.top, 13)

                    SectionLabel(title: "SETTINGS")
                        .padding(.horizontal, 22).padding(.top, 28)
                    settingsCard
                        .padding(.horizontal, 22).padding(.top, 13)
                }
                .padding(.bottom, 80)
            }
        }
        .task {
            async let p = (try? await API.fetchProfileState())
            async let f = (try? await API.fetchCoachFacts(surface: "me"))
            let (pr, fc) = await (p, f)
            await MainActor.run { self.profile = pr; self.meFacts = fc }
        }
    }

    private var coachStats: [CoachFact] {
        meFacts?.facts ?? []
    }

    private var coachStatsCard: some View {
        GlassTile(padding: 0) {
            VStack(spacing: 0) {
                ForEach(Array(coachStats.enumerated()), id: \.element.label) { i, f in
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 3) {
                            SpecLabel(text: f.label, size: 10, tracking: 1.5, color: Theme.txt.opacity(0.55))
                            if let meta = f.meta, !meta.isEmpty {
                                Text(meta)
                                    .font(.display(11, weight: .semibold))
                                    .foregroundStyle(Theme.txt.opacity(0.6))
                                    .lineLimit(2)
                            }
                        }
                        Spacer(minLength: 12)
                        Text(f.value)
                            .font(.display(15, weight: .bold))
                            .foregroundStyle(factColor(f.valueColor))
                            .multilineTextAlignment(.trailing)
                    }
                    .padding(14)
                    if i < coachStats.count - 1 {
                        Divider().background(Color.white.opacity(0.08))
                    }
                }
            }
        }
    }

    private func factColor(_ tone: String?) -> Color {
        switch (tone ?? "").lowercased() {
        case "race":  return Theme.race
        case "green": return Theme.green
        case "amber": return Theme.goal
        case "over":  return Theme.over
        default:      return Theme.txt
        }
    }

    private var headerRow: some View {
        HStack {
            SpecLabel(text: "YOU", size: 13, tracking: 2.5, color: Theme.txt)
            Spacer()
            Button { onDismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .frame(width: 38, height: 38)
                    .background(Theme.Glass.fill, in: Circle())
                    .overlay(Circle().stroke(Theme.Glass.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }

    private var userRow: some View {
        HStack(spacing: 16) {
            Text(initials)
                .font(.display(26, weight: .bold))
                .foregroundStyle(Theme.txt)
                .frame(width: 74, height: 74)
                .background(
                    LinearGradient(colors: [Color(hex: 0x62E08A), Color(hex: 0x3FB6B0)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: Circle()
                )
            VStack(alignment: .leading, spacing: 4) {
                Text(profile?.identity.full_name ?? "Faff Runner")
                    .font(.display(24, weight: .bold))
                    .foregroundStyle(Theme.txt)
                Text(subtitleLine)
                    .font(.body(13, weight: .medium))
                    .foregroundStyle(Theme.txt.opacity(0.7))
            }
            Spacer()
        }
    }

    private var initials: String {
        let name = profile?.identity.full_name ?? "FA"
        let parts = name.split(separator: " ")
        let first = parts.first.map(String.init)?.prefix(1) ?? "F"
        let last = parts.count > 1 ? String(parts.last!).prefix(1) : "A"
        return String(first) + String(last)
    }
    private var subtitleLine: String {
        var parts: [String] = []
        if let c = profile?.identity.city { parts.append(c) }
        if let exp = profile?.identity.experience_level?.capitalized { parts.append(exp) }
        return parts.joined(separator: " · ")
    }

    private var statRow: some View {
        StatRow(stats: [
            Stat(value: "—", key: "DAY STREAK"),
            Stat(value: "—", key: "THIS YEAR"),
            Stat(value: profile?.nextARace.map { "\($0.days_to_race)d" } ?? "—", key: "NEXT RACE")
        ], valueFont: 20, keyColor: Theme.txt.opacity(0.55))
    }

    private func shoeCarousel(_ shoes: [ProfileShoe]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(shoes) { s in
                    ShoeCompact(shoe: FaffShoe(
                        id: s.id,
                        brand: s.brand ?? "",
                        name: s.name ?? [s.brand, s.model].compactMap { $0 }.joined(separator: " "),
                        role: roleFor(s),
                        miles: s.mileage ?? 0,
                        lifeMi: s.cap ?? 450,
                        retired: s.retired ?? false
                    ))
                }
            }
            .padding(.horizontal, 22)
        }
    }
    private func roleFor(_ s: ProfileShoe) -> String {
        if s.preferred ?? false { return "RACE" }
        return "EASY"
    }

    private var connectionsCard: some View {
        GlassTile(padding: 0) {
            VStack(spacing: 0) {
                connectionRow("Apple Health", sub: "workouts · heart · sleep", on: profile?.connections.appleHealth.connected ?? false)
                Divider().background(Color.white.opacity(0.08))
                connectionRow("Strava", sub: "activity history", on: profile?.connections.strava.connected ?? false)
                Divider().background(Color.white.opacity(0.08))
                connectionRow("Apple Watch", sub: "live workouts", on: profile?.connections.appleWatch.connected ?? false)
            }
        }
    }

    private func connectionRow(_ name: String, sub: String, on: Bool) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.body(15, weight: .extraBold)).foregroundStyle(Theme.txt)
                Text(sub).font(.display(11, weight: .semibold)).foregroundStyle(Theme.txt.opacity(0.6))
            }
            Spacer()
            Text(on ? "SYNCED" : "CONNECT")
                .font(.display(12, weight: .semibold))
                .foregroundStyle(on ? Color(hex: 0x9AF0BF) : Theme.txt.opacity(0.7))
        }
        .padding(14)
    }

    private var settingsCard: some View {
        GlassTile(padding: 0) {
            VStack(spacing: 0) {
                settingsRow("Units & display", value: "Miles", route: .settings)
                Divider().background(Color.white.opacity(0.08))
                settingsRow("Notifications", value: nil, route: .settings)
                Divider().background(Color.white.opacity(0.08))
                settingsRow("Shoe garage", value: nil, route: .shoes)
                Divider().background(Color.white.opacity(0.08))
                settingsRow("Faff Pro", value: "Active", route: .pro)
            }
        }
    }
    private func settingsRow(_ title: String, value: String?, route: FaffRoute) -> some View {
        NavigationLink(value: route) {
            HStack {
                Text(title).font(.body(15, weight: .extraBold)).foregroundStyle(Theme.txt)
                Spacer()
                if let v = value { Text(v).font(.display(12, weight: .semibold)).foregroundStyle(Theme.txt.opacity(0.7)) }
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.5))
            }
            .padding(14)
        }
        .buttonStyle(.plain)
    }
}
