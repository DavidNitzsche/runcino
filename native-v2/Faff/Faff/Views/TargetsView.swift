//
//  TargetsView.swift
//  v3 Targets tab · A-race hero (or top goal) + projected vs goal beam +
//  races list + standing goals.
//

import SwiftUI

struct TargetsView: View {
    let onProfile: () -> Void

    @State private var races: RaceListResponse? =
        AppCache.read(.raceList, as: RaceListResponse.self)
    @State private var profile: ProfileState? =
        AppCache.read(.profileState, as: ProfileState.self)
    @State private var raceFacts: CoachFactsBlock?
    @State private var standingGoals: [StandingGoal] = []

    var body: some View {
        ZStack {
            FaffMeshView(mesh: FaffMesh.forView(.targets))

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    PageHeader(title: "TARGETS", avatarInitials: avatarInitials, onAvatarTap: onProfile)
                        .padding(.horizontal, 22).padding(.top, 12)

                    heroBlock
                        .padding(.horizontal, 24).padding(.top, 20)

                    section("RACES") {
                        if let r = races, !r.races.isEmpty {
                            VStack(spacing: 10) {
                                ForEach(r.races) { race in raceTile(race) }
                                addButton("+ ADD RACE")
                            }
                        } else {
                            emptyState("No races scheduled", "+ Add a race when you're ready")
                        }
                    }
                    if !standingGoals.isEmpty {
                        section("STANDING GOALS") {
                            VStack(spacing: 10) {
                                ForEach(standingGoals) { g in standingGoalTile(g) }
                            }
                        }
                    }
                }
                .padding(.bottom, 130)
            }
        }
        .task { await reload() }
        .refreshable { await reload() }
    }

    /// Avatar initials from the runner's profile · was hardcoded "DK".
    private var avatarInitials: String {
        if let name = profile?.identity.full_name, !name.isEmpty {
            let parts = name.split(separator: " ")
            let first = parts.first.map(String.init)?.prefix(1) ?? ""
            let last = parts.count > 1 ? String(parts.last!).prefix(1) : ""
            let raw = String(first) + String(last)
            if !raw.isEmpty { return raw.uppercased() }
        }
        if let c = profile?.identity.city, let f = c.first {
            return String(f).uppercased()
        }
        return ""
    }

    private func reload() async {
        async let r = (try? await API.fetchRaces())
        async let p = (try? await API.fetchProfileState())
        async let f = (try? await API.fetchCoachFacts(surface: "races"))
        let (rs, pr, fc) = await (r, p, f)
        await MainActor.run {
            // Preserve cached state on transient failures.
            if let rs { self.races = rs }
            if let pr { self.profile = pr }
            if let fc { self.raceFacts = fc }
            self.standingGoals = (self.races?.races ?? [])
                .filter { $0.priority == "A" || $0.priority == "B" }
                .prefix(3)
                .map { race in
                    StandingGoal(
                        title: RaceName.short(race.name, abbreviateAlways: true),
                        detail: race.distance_label?.uppercased() ?? "",
                        sub: race.name ?? ""
                    )
                }
        }
    }

    private struct StandingGoal: Identifiable, Hashable {
        let id = UUID()
        let title: String
        let detail: String
        let sub: String
    }

    /// Resolved A-race hero data. Prefers profile.nextARace; falls back to
    /// the coach-facts NEXT A line when the plan row hasn't yet wired
    /// race_id (the backend gap we surfaced separately).
    private struct HeroData {
        let name: String?
        let days: Int?
        let goal: String?
        let pace: String?
        let distance: String?
    }
    private var hero: HeroData {
        if let n = profile?.nextARace {
            return HeroData(name: n.name, days: n.days_to_race, goal: n.goal,
                            pace: nil, distance: nil)
        }
        if let f = raceFacts {
            // Parse "AMERICAS FINEST CITY · 78 days · half marathon" + "GOAL 1:30:00"
            let nextA = f.facts.first { $0.label.uppercased() == "NEXT A" }
            let goal  = f.facts.first { $0.label.uppercased() == "GOAL" }
            let pieces = (nextA?.value ?? "").components(separatedBy: " · ")
            let name = pieces.first
            let days: Int? = {
                guard pieces.count > 1,
                      let raw = pieces[1].components(separatedBy: " ").first
                else { return nil }
                return Int(raw)
            }()
            let distance = pieces.count > 2 ? pieces[2] : nil
            return HeroData(name: name, days: days, goal: goal?.value,
                            pace: paceFromGoal(goal?.value, distance: distance),
                            distance: distance)
        }
        return HeroData(name: nil, days: nil, goal: nil, pace: nil, distance: nil)
    }

    private func paceFromGoal(_ goal: String?, distance: String?) -> String? {
        guard let goal, let distance else { return nil }
        let secs = goalSeconds(goal)
        let mi: Double? = {
            let d = distance.lowercased()
            if d.contains("half") { return 13.1 }
            if d.contains("marathon") { return 26.2 }
            if d.contains("10k") { return 6.2 }
            if d.contains("5k") { return 3.1 }
            return nil
        }()
        guard let secs, let mi, mi > 0 else { return nil }
        let perMi = Int(Double(secs) / mi)
        return String(format: "%d:%02d/mi", perMi / 60, perMi % 60)
    }

    private func goalSeconds(_ g: String) -> Int? {
        let parts = g.split(separator: ":").compactMap { Int($0) }
        if parts.count == 3 { return parts[0]*3600 + parts[1]*60 + parts[2] }
        if parts.count == 2 { return parts[0]*60 + parts[1] }
        return nil
    }

    private var heroBlock: some View {
        let h = hero
        return VStack(alignment: .leading, spacing: 16) {
            SpecLabel(text: h.name != nil ? "A-RACE" : "TOP GOAL", size: 11, tracking: 2.5, color: Theme.txt.opacity(0.66))

            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 7) {
                    Text(RaceName.short(h.name, abbreviateAlways: (h.name?.count ?? 0) > 14))
                        .font(.display(50, weight: .bold))
                        .tracking(-2.5)
                        .foregroundStyle(Theme.txt)
                        .shadow(color: .black.opacity(0.32), radius: 22, y: 2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text(h.name ?? "Set a target")
                        .font(.body(13, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.82))
                        .lineLimit(2)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    if let d = h.days {
                        Text("\(d)")
                            .font(.display(30, weight: .semibold))
                            .tracking(-1)
                            .foregroundStyle(Theme.txt)
                        SpecLabel(text: "DAYS OUT", size: 9, tracking: 1.5, color: Theme.txt.opacity(0.6))
                    } else {
                        Text("OPEN")
                            .font(.display(15, weight: .semibold))
                            .foregroundStyle(Theme.txt.opacity(0.8))
                        SpecLabel(text: "NO DATE SET", size: 9, tracking: 1.5, color: Theme.txt.opacity(0.6))
                    }
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text(h.goal ?? "—")
                    .font(.display(58, weight: .bold))
                    .tracking(-2.5)
                    .foregroundStyle(Theme.txt)
                    .shadow(color: .black.opacity(0.3), radius: 22, y: 2)
                Text("GOAL TIME\(h.pace.map { " · \($0)" } ?? "")")
                    .font(.display(14, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.8))
            }
            .padding(.top, 12)

            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("PROJECTED · waiting for projection wire")
                        .font(.display(11, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.6))
                    Spacer()
                }
                GapBeam(progress: 0.55)

                HStack {
                    Text("START —")
                        .font(.display(10, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.5))
                    Spacer()
                    Text("GOAL \(h.goal ?? "—")")
                        .font(.display(10, weight: .semibold))
                        .foregroundStyle(Color(hex: 0xFFCE8A))
                }
            }
            .padding(.top, 18)
        }
    }

    private func raceTile(_ race: RaceListItem) -> some View {
        let days = race.days_to_race ?? 0
        let iso = race.date ?? ""
        return NavigationLink(value: FaffRoute.raceDay(slug: race.slug)) {
            HStack(spacing: 14) {
                Rectangle().fill(heatColor(days)).frame(width: 4)
                VStack(spacing: 0) {
                    SpecLabel(text: monthOf(iso), size: 11, tracking: 1, color: Theme.txt.opacity(0.7))
                    Text("\(dayOf(iso))")
                        .font(.display(24, weight: .bold))
                        .tracking(-1)
                        .foregroundStyle(Theme.txt)
                }
                .frame(width: 50)
                VStack(alignment: .leading, spacing: 3) {
                    Text(race.name ?? "Race")
                        .font(.body(17, weight: .extraBold))
                        .tracking(-0.3)
                        .foregroundStyle(Theme.txt)
                    Text(race.distance_label ?? "")
                        .font(.display(11, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.6))
                }
                Spacer()
                Text("\(days)d")
                    .font(.display(11, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.7))
            }
            .padding(15)
            .background(Color(hex: 0x140610).opacity(0.46), in: RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20)
                .stroke(race.priority == "A" ? Color(hex: 0xFF965A).opacity(0.6) : Color.white.opacity(0.14)))
        }
        .buttonStyle(.plain)
    }

    private func standingGoalTile(_ g: StandingGoal) -> some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(g.title).font(.body(17, weight: .extraBold)).tracking(-0.3).foregroundStyle(Theme.txt)
                    if !g.detail.isEmpty {
                        Text(g.detail).font(.body(11, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.62))
                    }
                }
                if !g.sub.isEmpty {
                    Text(g.sub)
                        .font(.display(11, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.6))
                        .lineLimit(1)
                }
            }
            Spacer()
        }
        .padding(15)
        .background(Color(hex: 0x140610).opacity(0.46), in: RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.white.opacity(0.14)))
    }

    private func goalTile(title: String, detail: String, start: String, now: String, goal: String, progress: Double) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title).font(.body(17, weight: .extraBold)).tracking(-0.3).foregroundStyle(Theme.txt)
                    Text(detail).font(.body(11, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.62))
                }
                Spacer()
                Text("CUT")
                    .font(.display(11, weight: .semibold))
                    .foregroundStyle(Color(hex: 0xFFCE8A))
            }
            GapBeam(progress: progress, height: 10)
                .padding(.top, 5)
            HStack {
                Text("WAS \(start)").font(.display(10, weight: .semibold)).foregroundStyle(Theme.txt.opacity(0.5))
                Spacer()
                Text("PR \(now)").font(.display(10, weight: .semibold)).foregroundStyle(Theme.txt.opacity(0.95))
                Spacer()
                Text("GOAL \(goal)").font(.display(10, weight: .semibold)).foregroundStyle(Color(hex: 0xFFCE8A))
            }
        }
        .padding(15)
        .background(Color(hex: 0x140610).opacity(0.46), in: RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.white.opacity(0.14)))
    }

    private func section<C: View>(_ title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 13) {
            SpecLabel(text: title, size: 11, tracking: 2, color: Theme.txt.opacity(0.6))
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 22).padding(.top, 24)
    }

    private func addButton(_ title: String) -> some View {
        Button {} label: {
            Text(title)
                .font(.body(13, weight: .extraBold))
                .tracking(0.5)
                .foregroundStyle(Theme.txt)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(Color.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
        }
        .buttonStyle(.plain)
    }

    private func emptyState(_ title: String, _ cta: String) -> some View {
        VStack(spacing: 8) {
            Text(title).font(.body(13, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.8))
            Text(cta).font(.body(12, weight: .extraBold)).tracking(0.5).foregroundStyle(Color(hex: 0xFFCE8A))
        }
        .frame(maxWidth: .infinity)
        .padding(20)
        .background(Color(hex: 0x140610).opacity(0.36), in: RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.white.opacity(0.26), style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
    }

    private func heatColor(_ d: Int) -> Color {
        switch d {
        case ..<75:   return Color(hex: 0xFF5A3C)
        case ..<140:  return Color(hex: 0xFFA94D)
        default:      return Color(hex: 0x5FC9C0)
        }
    }
    private func monthOf(_ iso: String) -> String {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return "—" }
        return ["—","JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][parts[1]]
    }
    private func dayOf(_ iso: String) -> Int {
        Int(iso.split(separator: "-").last.map(String.init) ?? "0") ?? 0
    }
}

// MARK: - ProfileNextRace presentation helpers

extension ProfileNextRace {
    var daysToRace: Int? { days_to_race }
    var goalLabel: String { goal ?? "—" }
    var goalPaceLabel: String { "—" }
    var projectedLabel: String { "—" }
    var gapLabel: String { "" }
    var gapProgress: Double { 0.6 }
    var startLabel: String { "—" }
    var trendLabel: String? { nil }
    var location: String? { nil }
}
