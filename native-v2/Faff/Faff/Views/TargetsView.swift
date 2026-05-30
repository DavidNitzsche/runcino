//
//  TargetsView.swift
//  v3 Targets tab · A-race hero (or top goal) + projected vs goal beam +
//  races list + standing goals.
//

import SwiftUI

struct TargetsView: View {
    let onProfile: () -> Void

    @State private var races: RaceListResponse?
    @State private var profile: ProfileState?

    var body: some View {
        ZStack {
            FaffMeshView(mesh: FaffMesh.forView(.targets))

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    PageHeader(title: "TARGETS", avatarInitials: "DK", onAvatarTap: onProfile)
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
                    section("STANDING GOALS") {
                        VStack(spacing: 10) {
                            goalTile(title: "5K", detail: "SUB-19", start: "20:35", now: "19:42", goal: "18:59", progress: 0.74)
                            goalTile(title: "1 MILE", detail: "SUB-5:30", start: "6:05", now: "5:48", goal: "5:29", progress: 0.63)
                            addButton("+ ADD GOAL")
                        }
                    }
                }
                .padding(.bottom, 130)
            }
        }
        .task {
            races = try? await API.fetchRaces()
            profile = try? await API.fetchProfileState()
        }
    }

    private var heroBlock: some View {
        let next = profile?.nextARace ?? nil
        return VStack(alignment: .leading, spacing: 16) {
            SpecLabel(text: next != nil ? "A-RACE" : "TOP GOAL", size: 11, tracking: 2.5, color: Theme.txt.opacity(0.66))

            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 7) {
                    Text(RaceName.short(next?.name, abbreviateAlways: (next?.name.count ?? 0) > 14))
                        .font(.display(50, weight: .bold))
                        .tracking(-2.5)
                        .foregroundStyle(Theme.txt)
                        .shadow(color: .black.opacity(0.32), radius: 22, y: 2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text(next?.name ?? "Set a target")
                        .font(.body(13, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.82))
                        .lineLimit(2)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    if let d = next?.daysToRace {
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
                Text(next?.goalLabel ?? "—")
                    .font(.display(58, weight: .bold))
                    .tracking(-2.5)
                    .foregroundStyle(Theme.txt)
                    .shadow(color: .black.opacity(0.3), radius: 22, y: 2)
                Text("GOAL TIME · \(next?.goalPaceLabel ?? "—")")
                    .font(.display(14, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.8))
            }
            .padding(.top, 12)

            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("PROJECTED \(next?.projectedLabel ?? "—")")
                        .font(.display(11, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.85))
                    Spacer()
                    Text(next?.gapLabel ?? "")
                        .font(.display(11, weight: .semibold))
                        .foregroundStyle(Color(hex: 0xFFCE8A))
                }
                GapBeam(progress: next?.gapProgress ?? 0.55)

                HStack {
                    Text("START \(next?.startLabel ?? "—")")
                        .font(.display(10, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.5))
                    Spacer()
                    Text("GOAL \(next?.goalLabel ?? "—")")
                        .font(.display(10, weight: .semibold))
                        .foregroundStyle(Color(hex: 0xFFCE8A))
                }
                if let trend = next?.trendLabel {
                    Text(trend)
                        .font(.display(10, weight: .semibold))
                        .foregroundStyle(Color(hex: 0x9AF0BF))
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
