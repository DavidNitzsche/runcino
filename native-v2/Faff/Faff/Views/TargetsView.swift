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
    /// Targets projection panel state · 2026-05-31 redesign.
    /// `nil` while loading; cold-state when ok but no VDOT yet.
    @State private var projection: ProjectionSummary?
    @State private var projectionLoaded: Bool = false
    /// New-goal sheet (Volume / Speed / Distance / Habit / Strength / Health).
    /// Toolkit · Family F · POSTs to /api/goals.
    @State private var showNewGoalSheet: Bool = false

    var body: some View {
        ZStack {
            FaffMeshView(mesh: .neutral)
                .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    // Bar (50) + shared header pill (84) clearance, matching Today.
                    Color.clear.frame(height: 132)
                    // Big headline · the GOAL VERDICT (AHEAD / ON TRACK /
                    // WATCHING / BEHIND) so you see at a glance how the plan is
                    // tracking to the goal — the way HOLD leads Health. Falls
                    // back to the race identity (AFC) until the projection is
                    // live. Tint encodes the verdict (green/amber/red).
                    Text(goalStatusHeadline)
                        .font(.heroDisplay(88))
                        .tracking(-2)
                        .foregroundStyle(goalStatusColor)
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 24)
                        .padding(.top, 6)
                    heroBlock
                        // Pull the card up into the heroDisplay line-box
                        // whitespace under WATCHING — the default 16pt left it
                        // floating too low.
                        .padding(.horizontal, 24).padding(.top, -12)

                    section("RACES") {
                        let upcoming = races?.races.filter { ($0.days_to_race ?? 1) >= 0 } ?? []
                        let past     = races?.races.filter { ($0.days_to_race ?? 1)  < 0 } ?? []
                        if upcoming.isEmpty && past.isEmpty {
                            emptyState("No races scheduled", "+ Add a race when you're ready")
                        } else {
                            VStack(spacing: 10) {
                                ForEach(upcoming) { race in raceTile(race) }
                                addButton("+ ADD RACE")
                            }
                        }
                    }
                    let past = races?.races.filter { ($0.days_to_race ?? 1) < 0 } ?? []
                    if !past.isEmpty {
                        section("PAST RACES") {
                            VStack(spacing: 10) {
                                ForEach(past) { race in raceTile(race) }
                            }
                        }
                    }
                    // NewGoalSheet entry · non-race goals (volume / speed /
                    // distance / habit / strength / health). Toolkit · F.
                    // The Targets tab was race-only until now.
                    section("PERSONAL GOALS") {
                        Button { showNewGoalSheet = true } label: {
                            HStack(spacing: 8) {
                                Image(systemName: "plus.circle.fill")
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundStyle(Theme.Accent.mintReady)
                                Text("Set a non-race goal")
                                    .font(.body(13, weight: .extraBold))
                                    .tracking(0.4)
                                    .foregroundStyle(Theme.txt)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(Theme.mute)
                            }
                            .padding(.horizontal, 14).padding(.vertical, 12)
                            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.bottom, 130)
            }
            // Dissolve the projection panel into the mesh behind the frosted
            // pill, same as Today/Train.
            .faffHeaderDissolve(clearTo: 56, opaqueAt: 80)
        }
        // Shared frosted header pill · condensed race summary in the slot.
        .faffHeaderPill { racePill }
        .task { await reload() }
        .refreshable { await reload() }
        .onReceive(NotificationCenter.default.publisher(for: .faffForegroundRefresh)) { _ in
            Task { await reload() }
        }
        .sheet(isPresented: $showNewGoalSheet) {
            NewGoalSheet(onSubmitted: { Task { await reload() } })
                .presentationDetents([.medium])
        }
    }

    /// Avatar initials · delegates to ProfileIdentity.avatarInitials.
    private var avatarInitials: String { profile?.identity.avatarInitials ?? "" }

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
        }
        // Projection panel · derive distance from the A-race or fall back
        // to half. Run after races/profile so we can pick up the right
        // distance from the same source the hero uses.
        let dist = await MainActor.run { distanceForProjection() }
        let proj = try? await API.fetchTargetsProjection(distanceMi: dist)
        await MainActor.run {
            self.projection = proj
            self.projectionLoaded = true
            // Zero-pop launch · Targets surface painted, release the splash gate.
            NotificationCenter.default.post(name: .faffSurfaceReady, object: "targets")
        }
    }

    /// Decide which race distance the projection should anchor on.
    /// Reads in priority order:
    ///   1. races list · matching profile.nextARace slug → distance_label
    ///   2. raceFacts NEXT A label
    ///   3. 13.1 default (most common active-goal distance)
    private func distanceForProjection() -> Double {
        // Direct hit: the races list carries distance_label alongside slug.
        var label = ""
        if let slug = profile?.nextARace?.slug,
           let lab = races?.races.first(where: { $0.slug == slug })?.distance_label {
            label = lab.lowercased()
        }
        // Fallback: parse the textual NEXT A fact ("NAME · 78 days · half marathon").
        if label.isEmpty {
            label = (raceFacts?.facts
                        .first { $0.label.uppercased() == "NEXT A" }?
                        .value
                        .components(separatedBy: " · ")
                        .last ?? "")
                .lowercased()
        }
        if label.contains("marathon") && !label.contains("half") { return 26.2 }
        if label.contains("half") { return 13.1 }
        if label.contains("10k") { return 6.2 }
        if label.contains("5k")  { return 3.1 }
        return 13.1
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

    // 2026-06-09 · race-killer F2 — RaceClock (API.swift). The local 2-part
    // branch read the stored "1:30" goal as 90s → hero pace "0:06/mi".
    private func goalSeconds(_ g: String) -> Int? {
        RaceClock.seconds(from: g)
    }

    /// Goal finish time without seconds · "1:30:00" → "1:30". Still used by
    /// the pill / projection detail; no longer the page headline.
    private var goalHeadline: String {
        guard let g = hero.goal, !g.isEmpty else { return "—" }
        let parts = g.split(separator: ":")
        if parts.count == 3 { return "\(parts[0]):\(parts[1])" }
        return g
    }

    /// Race identity · "Americas Finest City" → "AFC". The cold fallback for
    /// the headline before the projection resolves.
    private var raceHeadline: String {
        let s = RaceName.short(hero.name, abbreviateAlways: (hero.name?.count ?? 0) > 14)
        return s.isEmpty ? "—" : s
    }

    /// Goal verdict word for the big headline · the projection status as a
    /// glance ("how am I going for the goal"), the way HOLD/READY leads
    /// Health. Cold falls back to the race identity (AFC) so there's never an
    /// empty headline.
    private var goalStatusHeadline: String {
        guard let p = projection, p.vdot != nil else { return raceHeadline }
        // Server-derived over-performance flag · single source of truth. Fires
        // when the goal-seeking trajectory is projected to beat the goal — which
        // the old current-fitness math (projectionSec < goal) would miss.
        if p.aheadOfGoal == true { return "AHEAD" }
        switch p.status {
        case "on_track":  return "ON PACE"
        case "watch":     return "IN REACH"
        case "off":       return "BEHIND"
        case "race_week": return "RACE WEEK"
        default:          return raceHeadline
        }
    }

    /// Headline tint for the verdict · green ahead/on-track, amber watching,
    /// red behind. Race-orange when cold (the AFC fallback).
    private var goalStatusColor: Color {
        guard let p = projection, p.vdot != nil else { return Theme.race }
        if p.aheadOfGoal == true { return Theme.Accent.mintReady }
        switch p.status {
        case "on_track":  return Color(hex: 0x5FD08A)
        case "watch":     return Color(hex: 0xF3AD38)
        case "off":       return Color(hex: 0xFC4D64)
        case "race_week": return Color(hex: 0xF3AD38)
        default:          return Theme.race
        }
    }

    /// Condensed race summary for the shared header pill · A-RACE · short
    /// name · full name on the left; days-out · goal time · pace on the
    /// right. Replaces the old 88pt AFC hero that headed the scroll body.
    private var racePill: some View {
        let h = hero
        return HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                // Short name (AFC) is the page headline now, so the pill leads
                // with the full race name to avoid printing AFC twice.
                Text(h.name != nil ? "A-RACE" : "TOP GOAL")
                    .font(.body(9.5, weight: .extraBold)).tracking(2)
                    .foregroundStyle(Theme.txt.opacity(0.6))
                Text(h.name ?? "Set a target")
                    .font(.body(16, weight: .extraBold)).tracking(-0.2)
                    .foregroundStyle(Theme.txt)
                    .lineLimit(2).minimumScaleFactor(0.7)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                if let d = h.days {
                    Text("\(d) DAYS OUT")
                        .font(.body(9.5, weight: .extraBold)).tracking(1.2)
                        .foregroundStyle(Theme.txt.opacity(0.6))
                }
                // Goal time moved to the big headline; pace stays as the pill's
                // goal detail.
                Text("GOAL PACE")
                    .font(.body(9.5, weight: .extraBold)).tracking(1.2)
                    .foregroundStyle(Theme.txt.opacity(0.6))
                Text(h.pace ?? "—")
                    .font(.display(20, weight: .bold)).tracking(-0.5)
                    .foregroundStyle(Theme.txt)
                    .lineLimit(1).minimumScaleFactor(0.7)
            }
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 12)
    }

    /// Closing-the-gap projection panel. The race summary that used to head
    /// this block now lives in the shared header pill (racePill).
    private var heroBlock: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Closing-the-gap projection panel · renders cold state until
            // /api/targets/projection returns, then the full panel once we
            // have a VDOT + projection_sec.
            Group {
                if let p = projection, p.vdot != nil {
                    VStack(alignment: .leading, spacing: 8) {
                        TargetsProjectionPanel(summary: p)
                        // 2026-06-09 · Phase 2 F9 — anchor provenance. The
                        // VDOT rendered with no hint its anchor was months
                        // old (adversarial audit F9: 47.9 was a February
                        // race while everything since read 44-45). Amber
                        // past the 120-day confidence window (Research/02
                        // §13.7) — same threshold as the web Health page.
                        if let age = profile?.physiology.vdot_anchor_age_days {
                            let stale = age >= 120
                            Text("ANCHOR · \((profile?.physiology.vdot_anchor_name ?? "RACE EFFORT").uppercased()) · \(age)D\(stale ? " · STALE — A TUNE-UP RACE RE-RATES IT" : "")")
                                .font(.body(10, weight: .bold))
                                .tracking(1.2)
                                .foregroundStyle(stale ? Theme.Accent.amberBright : Theme.txt.opacity(0.55))
                                .padding(.horizontal, 4)
                        }
                        // Over-performer advisory · the plan now under-builds the
                        // trajectory. Passive read — native has no goal-edit
                        // endpoint, so it points at the web rebuild door.
                        if p.planUnderBuilt == true {
                            Text("Tracking ahead of plan. Set a faster goal on the web to rebuild around it.")
                                .font(.body(11, weight: .medium))
                                .foregroundStyle(Theme.Accent.mintReady.opacity(0.9))
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.horizontal, 4)
                        }
                    }
                } else if projectionLoaded {
                    TargetsProjectionColdState()
                } else {
                    // First-load skeleton · keep the slot's vertical rhythm
                    // so the layout doesn't pop when the panel hydrates.
                    RoundedRectangle(cornerRadius: 14)
                        .fill(Theme.card)
                        .frame(height: 240)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .stroke(Theme.line, lineWidth: 1)
                        )
                        .overlay(
                            ProgressView()
                                .progressViewStyle(.circular)
                                .tint(Theme.mute)
                        )
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
                        .font(.body(11, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.6))
                }
                Spacer()
                Text("\(days)d")
                    .font(.body(11, weight: .semibold))
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
                        .font(.body(11, weight: .semibold))
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
