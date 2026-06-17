//
//  TargetsView.swift
//  v3 Targets tab · A-race hero (or top goal) + projected vs goal beam +
//  races list + standing goals.
//

import SwiftUI
import UniformTypeIdentifiers

struct TargetsView: View {
    let onProfile: () -> Void
    /// Tab selection · lets the plan-bridge block ("THE ROAD TO …") switch
    /// to the Train tab, the canonical full-plan surface (race P4). Default
    /// binding so previews / any caller without a tab host still compile.
    @Binding var selectedTab: FaffTab

    @State private var races: RaceListResponse? =
        AppCache.read(.raceList, as: RaceListResponse.self)
    @State private var profile: ProfileState? =
        AppCache.read(.profileState, as: ProfileState.self)
    @State private var raceFacts: CoachFactsBlock?
    /// Targets projection panel state · 2026-05-31 redesign.
    /// `nil` while loading; cold-state when ok but no VDOT yet.
    @State private var projection: ProjectionSummary?
    @State private var projectionLoaded: Bool = false
    /// Macro-cycle phases + current week · drives the projection card's
    /// PHASE SPINE (the app's existing training-state source). Seeded from
    /// cache so the spine paints immediately on cold launch.
    @State private var trainingState: TrainingState? =
        AppCache.read(.trainingState, as: TrainingState.self)
    /// New-goal sheet (Volume / Speed / Distance / Habit / Strength / Health).
    /// Toolkit · Family F · POSTs to /api/goals.
    @State private var showNewGoalSheet: Bool = false
    @State private var showAddRaceSheet: Bool = false
    /// Race-edit sheet · long-press a race tile → "Edit race". Holds the
    /// tile the runner picked so RaceEditSheet prefills from it (race P1).
    @State private var editingRace: RaceListItem? = nil

    /// True when there is at least one upcoming race.
    private var hasUpcomingRace: Bool {
        races?.races.contains { ($0.days_to_race ?? 1) >= 0 } ?? false
    }
    /// Standalone time goal (no race required).
    private var fitnessGoal: FitnessGoal? { profile?.fitnessGoal }

    var body: some View {
        ZStack {
            FaffMeshView(mesh: .neutral)
                .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    if !hasUpcomingRace && fitnessGoal == nil {
                        // ── Cold empty state ──────────────────────────────
                        // No pill in this state, so clear only the top bar
                        // (not the 132pt pill reserve the other states need).
                        Color.clear.frame(height: 96)
                        coldEmptyBody
                    } else {
                        Color.clear.frame(height: 132)
                        // ── Hero verdict ──────────────────────────────────
                        Text(goalStatusHeadline)
                            .font(.heroDisplay(88))
                            .tracking(-2)
                            .foregroundStyle(goalStatusColor)
                            .minimumScaleFactor(0.5)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 24)
                            .padding(.top, 6)

                        // ── Goal block (always first) ─────────────────────
                        if hasUpcomingRace {
                            heroBlock
                                .padding(.horizontal, 24).padding(.top, -12)
                        } else if let g = fitnessGoal {
                            goalHeroBlock(g)
                                .padding(.horizontal, 24).padding(.top, -12)
                        }

                        // ── Races ─────────────────────────────────────────
                        if hasUpcomingRace {
                            section("RACES") {
                                let upcoming = (races?.races.filter { ($0.days_to_race ?? 1) >= 0 } ?? [])
                                    .sorted { ($0.days_to_race ?? 0) < ($1.days_to_race ?? 0) }
                                VStack(spacing: 10) {
                                    ForEach(upcoming) { race in raceTile(race) }
                                    addButton("+ ADD RACE") { showAddRaceSheet = true }
                                }
                            }
                        } else {
                            section("RACES") {
                                addButton("+ ADD RACE") { showAddRaceSheet = true }
                            }
                        }

                        // (THE ROAD TO … moved up, directly under the trajectory
                        // card — see heroBlock.)
                    }

                    // ── Fitness goal · between upcoming and past races ─────
                    if hasUpcomingRace {
                        section("GOAL") {
                            if let g = fitnessGoal {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("\(g.distance) · \(g.time)")
                                            .font(.body(15, weight: .extraBold))
                                            .foregroundStyle(Theme.txt)
                                        Text("Time target")
                                            .font(.body(11)).foregroundStyle(Theme.mute)
                                    }
                                    Spacer()
                                    Button("Edit") { showNewGoalSheet = true }
                                        .font(.body(13, weight: .semibold))
                                        .foregroundStyle(Theme.dist)
                                        .buttonStyle(.plain)
                                }
                                .padding(.horizontal, 14).padding(.vertical, 12)
                                .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
                            } else {
                                addButton("+ SET GOAL") { showNewGoalSheet = true }
                            }
                        }
                    }

                    // Past races always shown if present.
                    let past = (races?.races.filter { ($0.days_to_race ?? 1) < 0 } ?? [])
                        .sorted { ($0.days_to_race ?? 0) > ($1.days_to_race ?? 0) }
                    if !past.isEmpty {
                        section("PAST RACES") {
                            VStack(spacing: 10) {
                                ForEach(past) { race in raceTile(race) }
                            }
                        }
                    }
                }
                .padding(.bottom, 130)
            }
            .faffHeaderDissolve(clearTo: 56, opaqueAt: 80)
        }
        .faffHeaderPill(visible: hasUpcomingRace || fitnessGoal != nil) { headerPill }
        .task { await reload() }
        .refreshable { await reload() }
        .onReceive(NotificationCenter.default.publisher(for: .faffForegroundRefresh)) { _ in
            Task { await reload() }
        }
        .sheet(isPresented: $showNewGoalSheet) {
            NewGoalSheet(
                onSubmitted: { Task { await reload() }; afterTargetChange() },
                existingGoal: fitnessGoal
            )
            .presentationDetents([.large])
        }
        .sheet(isPresented: $showAddRaceSheet) {
            AddRaceSheet(onSaved: { Task { await reload() }; afterTargetChange() })
                .presentationDetents([.large])
        }
        .sheet(item: $editingRace) { race in
            RaceEditSheet(
                slug: race.slug,
                seedName: race.name,
                seedDate: race.date,
                seedDistanceLabel: race.distance_label,
                seedPriority: race.priority,
                seedLocation: race.location,
                onSaved: { Task { await reload() }; afterTargetChange() }
            )
            .presentationDetents([.large])
        }
    }

    /// A goal or race was just added/changed · tell the rest of the app to
    /// re-resolve (RootTabView un-hides the Train tab, Today swaps out of
    /// "just run" mode). The new plan also needs a beat to generate server-
    /// side, so nudge a second refresh shortly after.
    private func afterTargetChange() {
        NotificationCenter.default.post(name: .faffForegroundRefresh, object: nil)
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            NotificationCenter.default.post(name: .faffForegroundRefresh, object: nil)
        }
    }

    // ── Goal hero (no-race runner) ────────────────────────────────────────

    private func goalHeroBlock(_ g: FitnessGoal) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            // Goal tile
            VStack(alignment: .leading, spacing: 4) {
                Text("\(g.distance.uppercased()) · TARGET")
                    .font(.body(10, weight: .extraBold)).tracking(1.8)
                    .foregroundStyle(Theme.txt.opacity(0.55))
                Text(g.time)
                    .font(.display(36, weight: .bold)).tracking(-1)
                    .foregroundStyle(Theme.txt)
                Button { showNewGoalSheet = true } label: {
                    Text("Edit goal")
                        .font(.body(11, weight: .semibold))
                        .foregroundStyle(Theme.dist)
                }
                .buttonStyle(.plain)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))

            // Projection panel if available
            if let p = projection, p.vdot != nil {
                TargetsProjectionPanel(summary: p, trainingState: trainingState)
                if let age = profile?.physiology.vdot_anchor_age_days {
                    let stale = age >= 120
                    Text("ANCHOR · \((profile?.physiology.vdot_anchor_name ?? "RACE EFFORT").uppercased()) · \(age)D\(stale ? " · STALE" : "")")
                        .font(.body(10, weight: .bold)).tracking(1.2)
                        .foregroundStyle(stale ? Theme.Accent.amberBright : Theme.txt.opacity(0.55))
                        .padding(.horizontal, 4)
                }
                // Supporting depth (race P3) · same sections as the race-runner
                // path. Renders per-section only when its data is present.
                TargetsProjectionDepth(summary: p)
                    .padding(.top, 4)
            }
        }
    }

    /// CTA shown when the runner has neither a goal nor a race.
    private var coldGoalCTA: some View {
        Button { showNewGoalSheet = true } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("What are you training for?")
                        .font(.body(15, weight: .extraBold))
                        .foregroundStyle(Theme.txt)
                    Text("Set a distance and time target to unlock your projection.")
                        .font(.body(12)).foregroundStyle(Theme.mute)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.mute)
            }
            .padding(16)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.race.opacity(0.35), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var coldEmptyBody: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("What are you\ntraining for?")
                .font(.display(34, weight: .bold))
                .tracking(-0.5)
                .foregroundStyle(Theme.txt)
                .lineSpacing(2)
                .padding(.horizontal, 24)
                .padding(.top, 32)
                .padding(.bottom, 6)

            Text("Add a race or set a goal and we'll build your plan.")
                .font(.body(15))
                .foregroundStyle(Theme.txt.opacity(0.5))
                .lineSpacing(3)
                .padding(.horizontal, 24)
                .padding(.bottom, 32)

            coldOptionCard(
                eyebrow: "RACE",
                headline: "I have a race",
                detail: "Enter the date and distance. Your plan builds around it."
            ) { showAddRaceSheet = true }

            coldOptionCard(
                eyebrow: "GOAL",
                headline: "I have a goal",
                detail: "Set a time target and we'll work toward it."
            ) { showNewGoalSheet = true }
        }
    }

    private func coldOptionCard(
        eyebrow: String, headline: String, detail: String, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(eyebrow)
                        .font(.body(10, weight: .extraBold)).tracking(2)
                        .foregroundStyle(Theme.txt.opacity(0.4))
                    Text(headline)
                        .font(.body(17, weight: .extraBold))
                        .foregroundStyle(Theme.txt)
                    Text(detail)
                        .font(.body(13))
                        .foregroundStyle(Theme.txt.opacity(0.5))
                        .fixedSize(horizontal: false, vertical: true)
                        .lineSpacing(2)
                }
                Spacer(minLength: 8)
                Image(systemName: "arrow.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.3))
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 18)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 24)
        .padding(.bottom, 12)
    }

    /// Avatar initials · delegates to ProfileIdentity.avatarInitials.
    private var avatarInitials: String { profile?.identity.avatarInitials ?? "" }

    private func reload() async {
        async let r = (try? await API.fetchRaces())
        async let p = (try? await API.fetchProfileState())
        async let f = (try? await API.fetchCoachFacts(surface: "races"))
        async let ts = (try? await API.fetchTrainingState())
        let (rs, pr, fc, tst) = await (r, p, f, ts)
        await MainActor.run {
            // Preserve cached state on transient failures.
            if let rs { self.races = rs }
            if let pr { self.profile = pr }
            if let fc { self.raceFacts = fc }
            if let tst { self.trainingState = tst }
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
        case "on_track":  return Theme.green   // app green (#14C08C), not the pastel 0x5FD08A
        case "watch":     return Color(hex: 0xF3AD38)
        case "off":       return Color(hex: 0xFC4D64)
        case "race_week": return Color(hex: 0xF3AD38)
        default:          return Theme.race
        }
    }

    /// Header pill — adapts to race runner vs goal runner vs cold.
    @ViewBuilder private var headerPill: some View {
        if hasUpcomingRace {
            racePill
        } else if let g = fitnessGoal {
            goalPill(g)
        } else {
            coldPill
        }
    }

    private var racePill: some View {
        let h = hero
        return HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("A-RACE")
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

    private func goalPill(_ g: FitnessGoal) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("GOAL")
                    .font(.body(9.5, weight: .extraBold)).tracking(2)
                    .foregroundStyle(Theme.txt.opacity(0.6))
                Text(g.distance)
                    .font(.body(16, weight: .extraBold)).tracking(-0.2)
                    .foregroundStyle(Theme.txt)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                Text("TARGET")
                    .font(.body(9.5, weight: .extraBold)).tracking(1.2)
                    .foregroundStyle(Theme.txt.opacity(0.6))
                Text(g.time)
                    .font(.display(20, weight: .bold)).tracking(-0.5)
                    .foregroundStyle(Theme.txt)
            }
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 12)
    }

    private var coldPill: some View {
        HStack {
            Text("GOALS")
                .font(.body(9.5, weight: .extraBold)).tracking(2)
                .foregroundStyle(Theme.txt.opacity(0.6))
            Spacer()
            Text("Nothing set yet")
                .font(.body(13))
                .foregroundStyle(Theme.mute)
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
                        TargetsProjectionPanel(summary: p, trainingState: trainingState)
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
                        // The road to the race · plan bridge, directly UNDER the
                        // trajectory card (David 2026-06-17 — it was floating after
                        // RACES). Reads the already-fetched TrainingState; renders
                        // only when a real plan is loaded.
                        if let ts = trainingState, ts.plan_id != nil, !ts.weeks.isEmpty {
                            VStack(alignment: .leading, spacing: 10) {
                                SpecLabel(text: "THE ROAD TO \(roadRaceLabel)", size: 11, tracking: 2, color: Theme.txt.opacity(0.6))
                                roadToRaceCard(ts)
                            }
                            .padding(.top, 8)
                        }
                        // Supporting depth (race P3) · other-distance equivalents.
                        TargetsProjectionDepth(summary: p)
                            .padding(.top, 6)
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

    // ── The road to the race · plan bridge (race P4) ─────────────────────
    //
    // A compact summary of the build that leads to the A-race, reading the
    // already-fetched TrainingState (the same source the projection spine
    // uses). Taps through to the Train tab — the canonical full-plan surface.
    // It is a BRIDGE to the plan, not the plan itself: current phase, week
    // position, weeks-to-race, this-week mileage progress, next quality.

    /// Short race identity for the section header ("THE ROAD TO AFC").
    private var roadRaceLabel: String {
        let n = trainingState?.race?.name ?? hero.name
        let s = RaceName.short(n, abbreviateAlways: (n?.count ?? 0) > 12)
        return s.isEmpty ? "RACE" : s.uppercased()
    }

    private func roadToRaceCard(_ ts: TrainingState) -> some View {
        let phase = TrainPhase(phaseKey: ts.currentPhase ?? "base")
        // Locked categorical phase palette · the same source TrainView uses,
        // so the bridge card and the plan it links to read identically.
        let phaseColor = TrainView.phaseAccent(phase)
        // Overall week position · "Week X of Y" across the whole plan.
        let totalWeeks = ts.weeks.count
        let curOverall = (ts.currentWeekIdx ?? ts.weeks.first(where: { $0.isCurrent })?.idx)
        let weekNumber: Int? = curOverall.flatMap { ci in
            ts.weeks.firstIndex(where: { $0.idx == ci }).map { $0 + 1 }
        }
        // Within-phase position · "Phase wk a of b".
        let phaseWeeks = ts.weeks.filter { TrainPhase(phaseKey: $0.phase) == phase }
        let inPhase: (Int, Int)? = {
            guard let ci = curOverall, !phaseWeeks.isEmpty,
                  let pos = phaseWeeks.firstIndex(where: { $0.idx == ci }) else { return nil }
            return (pos + 1, phaseWeeks.count)
        }()
        // Weeks to race · prefer days_to_race → weeks; else weeks remaining.
        let weeksToRace: Int? = {
            if let d = ts.race?.days_to_race, d >= 0 { return max(0, Int((Double(d) / 7).rounded())) }
            if let n = weekNumber, totalWeeks > 0 { return max(0, totalWeeks - n) }
            return nil
        }()

        return Button {
            // Switch to the Train tab · the full multi-week plan surface.
            selectedTab = .train
        } label: {
            VStack(alignment: .leading, spacing: 14) {
                // Phase + week position row.
                HStack(alignment: .center, spacing: 12) {
                    Capsule().fill(phaseColor)
                        .frame(width: 4, height: 38)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("\(phase.label) PHASE")
                            .font(.body(10, weight: .extraBold)).tracking(1.6)
                            .foregroundStyle(phaseColor)
                        if let n = weekNumber, totalWeeks > 0 {
                            Text("Week \(n) of \(totalWeeks)"
                                 + (inPhase.map { " · phase wk \($0.0) of \($0.1)" } ?? ""))
                                .font(.body(14, weight: .extraBold)).tracking(-0.2)
                                .foregroundStyle(Theme.txt)
                        }
                    }
                    Spacer(minLength: 8)
                    if let w = weeksToRace {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("\(w)")
                                .font(.display(26, weight: .bold)).tracking(-1)
                                .foregroundStyle(Theme.txt)
                            Text(w == 1 ? "WEEK TO GO" : "WEEKS TO GO")
                                .font(.body(8.5, weight: .extraBold)).tracking(1)
                                .foregroundStyle(Theme.txt.opacity(0.55))
                        }
                    }
                }

                // This-week mileage progress.
                if let planned = ts.weekPlanned, planned > 0 {
                    let done = ts.weekDone
                    let frac = min(max(done / planned, 0), 1)
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("THIS WEEK")
                                .font(.body(9, weight: .extraBold)).tracking(1.4)
                                .foregroundStyle(Theme.txt.opacity(0.5))
                            Spacer()
                            Text("\(road1(done)) / \(road1(planned)) mi")
                                .font(.body(11, weight: .bold))
                                .foregroundStyle(Theme.txt.opacity(0.8))
                        }
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color.white.opacity(0.10))
                                    .frame(height: 5)
                                Capsule().fill(phaseColor)
                                    .frame(width: geo.size.width * frac, height: 5)
                            }
                        }
                        .frame(height: 5)
                    }
                }

                // Next quality session.
                if let nq = ts.nextQuality, nq.type != "rest" {
                    HStack(spacing: 8) {
                        Image(systemName: "bolt.fill")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(phaseColor)
                        Text("Next quality")
                            .font(.body(11, weight: .semibold))
                            .foregroundStyle(Theme.txt.opacity(0.55))
                        Text(roadNextQuality(nq))
                            .font(.body(11, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(0.85))
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                }

                // Footer · the bridge affordance.
                HStack(spacing: 6) {
                    Text("See the full plan")
                        .font(.body(12, weight: .extraBold)).tracking(0.2)
                        .foregroundStyle(phaseColor)
                    Image(systemName: "arrow.right")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(phaseColor)
                }
                .padding(.top, 2)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous)
                .stroke(phaseColor.opacity(0.28), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    /// Whole miles clean, fractional miles to one decimal (matches TrainView).
    private func road1(_ m: Double) -> String {
        m.truncatingRemainder(dividingBy: 1) == 0
            ? String(format: "%.0f", m)
            : String(format: "%.1f", m)
    }

    /// "Tempo · Tue · 7 mi" line for the next quality session.
    private func roadNextQuality(_ nq: TrainingNextQuality) -> String {
        let dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        let day = (nq.dow >= 0 && nq.dow < 7) ? dows[nq.dow] : ""
        let name = (nq.label?.isEmpty == false) ? nq.label! : nq.type.capitalized
        let miStr = nq.mi > 0 ? " · \(road1(nq.mi)) mi" : ""
        return day.isEmpty ? "\(name)\(miStr)" : "\(name) · \(day)\(miStr)"
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
        // Long-press to edit · the tile pushes the detail on tap, so the
        // editor rides a context menu (race P1). RaceDayView also carries a
        // pencil for the runner already on the detail page.
        .contextMenu {
            Button {
                editingRace = race
            } label: {
                Label("Edit race", systemImage: "pencil")
            }
        }
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

    private func addButton(_ title: String, action: @escaping () -> Void = {}) -> some View {
        Button(action: action) {
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
        case ..<140:  return Theme.goal
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

// MARK: - Add Race Sheet

struct AddRaceSheet: View {
    var onSaved: () -> Void = {}
    @Environment(\.dismiss) private var dismiss

    @State private var name: String = ""
    @State private var date: Date = Calendar.current.date(byAdding: .month, value: 3, to: Date()) ?? Date()
    @State private var distance: String = "Half Marathon"
    @State private var priority: String = "A"
    @State private var goal: String = ""
    @State private var stravaUrl: String = ""
    @State private var pickedGPXData: Data? = nil
    @State private var pickedGPXName: String = "course.gpx"
    @State private var showFilePicker: Bool = false
    @State private var saving: Bool = false
    @State private var error: String? = nil

    private let distances = ["5K", "10K", "Half Marathon", "Marathon", "50K", "50M", "100K", "100M", "Other"]

    var body: some View {
        NavigationStack {
            Form {
                Section("RACE") {
                    TextField("Race name", text: $name)
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    Picker("Distance", selection: $distance) {
                        ForEach(distances, id: \.self) { Text($0) }
                    }
                    Picker("Priority", selection: $priority) {
                        Text("A — goal race").tag("A")
                        Text("B — tune-up").tag("B")
                        Text("C — for fun").tag("C")
                    }
                }
                Section("GOAL (optional)") {
                    TextField("e.g. 1:45:00", text: $goal)
                        .keyboardType(.numbersAndPunctuation)
                }
                Section {
                    TextField("Strava route URL", text: $stravaUrl)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    if pickedGPXData != nil {
                        HStack {
                            Text(pickedGPXName).foregroundStyle(.secondary).font(.body(13))
                            Spacer()
                            Button("Remove") { pickedGPXData = nil }
                                .foregroundStyle(.red)
                                .font(.body(13))
                        }
                    } else {
                        Button("Upload GPX file") { showFilePicker = true }
                            .foregroundStyle(Theme.dist)
                    }
                } header: {
                    Text("COURSE (optional)")
                } footer: {
                    Text("Paste a Strava route URL or upload a .gpx file.")
                        .font(.body(11))
                }
                if let err = error {
                    Section { Text(err).foregroundStyle(.red).font(.body(13)) }
                }
            }
            .navigationTitle("Add Race")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") {
                        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else {
                            error = "Race name is required."
                            return
                        }
                        Task { await save() }
                    }
                    .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .fileImporter(
                isPresented: $showFilePicker,
                allowedContentTypes: [UTType.xml, UTType.data],
                allowsMultipleSelection: false
            ) { result in
                switch result {
                case .success(let urls):
                    guard let url = urls.first else { return }
                    let accessing = url.startAccessingSecurityScopedResource()
                    defer { if accessing { url.stopAccessingSecurityScopedResource() } }
                    if let data = try? Data(contentsOf: url) {
                        pickedGPXData = data
                        pickedGPXName = url.lastPathComponent
                    }
                case .failure(let err):
                    error = err.localizedDescription
                }
            }
        }
    }

    private var isoDate: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    private func save() async {
        saving = true
        error = nil
        guard let slug = try? await API.createRace(
            name: name.trimmingCharacters(in: .whitespaces),
            date: isoDate,
            distanceLabel: distance == "Other" ? nil : distance,
            priority: priority,
            goal: goal.trimmingCharacters(in: .whitespaces).isEmpty ? nil : goal
        ) else {
            error = "Could not save race. Check your connection and try again."
            saving = false
            return
        }

        let trimmedUrl = stravaUrl.trimmingCharacters(in: .whitespaces)
        if !trimmedUrl.isEmpty {
            let ok = (try? await API.importStravaRoute(slug: slug, stravaUrl: trimmedUrl)) ?? false
            if !ok {
                error = "Race saved, but the Strava route could not be imported. Check the URL and try again from the race detail."
                saving = false
                onSaved()
                dismiss()
                return
            }
        } else if let gpxData = pickedGPXData {
            _ = try? await API.uploadRaceGPX(slug: slug, gpxData: gpxData, filename: pickedGPXName)
        }

        onSaved()
        dismiss()
    }
}
