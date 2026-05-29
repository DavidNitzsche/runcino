//
//  TrainingView.swift
//
//  iPhone TRAINING tab — the WHOLE plan arc, not just a compact /today.
//
//  v3 chrome cutover (2026-05-28) — mirrors the web /training surface
//  harmonized in Phase 11 (web commit fdf12bf). The legacy inline
//  phase strip + plan arc + week-ahead list have been extracted into
//  dedicated SwiftUI components under Components/, mirroring the web's
//  PhaseStrip / PlanArc / WeekAhead one-for-one:
//
//    1) PageHeader        ← FaffPageShell (display-recipe title +
//                           caps-tracked eyebrow + optional accent)
//    2) PhaseStrip        ← PhaseStrip.tsx
//    3) VolumeArc         ← PlanArc.tsx
//    4) WeekAheadGrid     ← WeekAhead.tsx
//    5) CoachSlot         ← BriefingLoader (background-loaded)
//
//  Data still comes from /api/training/state via API.fetchTrainingState
//  (decoded into TrainingState). FaffAdapter.buildPhaseStrip /
//  buildVolumeArc / buildWeekAhead derive the per-component inputs.
//

import SwiftUI

struct TrainingView: View {
    // Hydrate from AppCache so the first tap after launch paints the
    // last-seen plan instantly. Network refresh overwrites both state
    // values when it lands (see load() below).
    @State private var briefing: Briefing? =
        AppCache.read(.trainingBriefing, as: Briefing.self)
    @State private var state: TrainingState? =
        AppCache.read(.trainingState, as: TrainingState.self)
    /// `loading` only kicks in when there's nothing cached — the very
    /// first launch. From then on we paint real content and let
    /// `.task` refresh silently in the background.
    @State private var loading: Bool = AppCache.readRaw(.trainingState) == nil

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    PageHeader(
                        title: planTitle,
                        eyebrow: phaseEyebrow,
                        accent: phaseAccent
                    )

                    if let s = state, !s.weeks.isEmpty {
                        let blocks = FaffAdapter.buildPhaseStrip(state: s)
                        let currentIdx = FaffAdapter.currentPhaseBlockIdx(
                            blocks: blocks,
                            currentPhase: s.currentPhase
                        )
                        PhaseStrip(
                            blocks: blocks,
                            currentBlockIdx: currentIdx,
                            totalWeeks: s.weeks.count,
                            currentWeekIdx: s.currentWeekIdx,
                            raceName: s.race?.name,
                            daysToRace: s.race?.days_to_race
                        )
                        .transition(.opacity)

                        VolumeArc(
                            bars: FaffAdapter.buildVolumeArc(state: s),
                            raceName: s.race?.name,
                            raceDate: s.race?.date,
                            raceGoal: s.race?.goal
                        )
                        .transition(.opacity)

                        let weekDays = FaffAdapter.buildWeekAhead(state: s)
                        if !weekDays.isEmpty,
                           let currentWeek = s.weeks.first(where: { $0.isCurrent }) {
                            WeekAheadGrid(
                                days: weekDays,
                                today: s.today,
                                plannedMi: currentWeek.plannedMi
                            )
                            .transition(.opacity)
                        }

                        if let q = s.nextQuality {
                            nextQualityCard(q)
                                .transition(.opacity)
                        }
                    } else if loading {
                        trainingSkeleton
                            .transition(.opacity)
                    }

                    // Coach voice on the phase / arc — background-loads,
                    // never blocks the structural content above. Stays
                    // here verbatim; will swap to the fact-reciter post
                    // Phase 24b on web.
                    CoachSlot(
                        briefing: briefing,
                        surface: "training",
                        askPrompt: nil
                    )
                }
                .padding(.bottom, 40)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: state?.plan_id)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: briefing?.lead)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Training")
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
            .refreshable { await load() }
        }
    }

    // MARK: - Title + eyebrow (drives PageHeader)

    private var planTitle: String {
        if let race = state?.race, let s = state, s.weeks.first(where: { $0.isCurrent }) != nil {
            return "\(race.days_to_race) days to \(race.name)."
        }
        if state?.weeks.isEmpty == false {
            return "Training."
        }
        return "No active plan."
    }

    private var phaseEyebrow: String {
        guard let s = state else { return "" }
        guard let week = s.weeks.first(where: { $0.isCurrent }) else {
            return s.currentPhase?.uppercased() ?? "NO PLAN"
        }
        let parts = [
            s.currentPhase?.uppercased() ?? "NO PHASE",
            "WEEK \(week.idx) OF \(s.weeks.count)",
            s.weekPlanned != nil ? "\(Int(s.weekPlanned!)) MI PLANNED" : nil,
        ].compactMap { $0 }
        return parts.joined(separator: " · ")
    }

    /// Phase chip in the accent slot — mirrors the `accent` prop on
    /// FaffPageShell. Was previously rendered in the navigation
    /// toolbar; now hops into the in-shell header band.
    private var phaseAccent: AnyView? {
        guard let phase = state?.currentPhase else { return nil }
        let color = phaseColor(phase)
        return AnyView(
            Text(phase.uppercased())
                .font(.label(10)).tracking(1.4)
                .foregroundStyle(color)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(color.opacity(0.12))
                .overlay(Capsule().stroke(color.opacity(0.35), lineWidth: 1))
                .clipShape(Capsule())
        )
    }

    // MARK: - Next-quality card

    private func nextQualityCard(_ q: TrainingNextQuality) -> some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("NEXT QUALITY")
                    .font(.label(10)).tracking(1.6)
                    .foregroundStyle(Theme.goal)
                Text(q.label ?? q.type.capitalized)
                    .font(.display(18)).foregroundStyle(Theme.ink)
                HStack(spacing: 6) {
                    Text(dowLabel(q.dow))
                        .font(.body(11, weight: .semibold))
                        .foregroundStyle(Theme.mute)
                    Text("·").foregroundStyle(Theme.mute)
                    Text(String(format: "%.1f mi", q.mi))
                        .font(.body(11))
                        .foregroundStyle(Theme.mute)
                }
            }
            Spacer()
        }
        .padding(16)
        .background(Theme.goal.opacity(0.06))
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.goal.opacity(0.28), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
        .padding(.horizontal, 24)
    }

    // MARK: - Skeleton

    private var trainingSkeleton: some View {
        VStack(alignment: .leading, spacing: 14) {
            RoundedRectangle(cornerRadius: 4)
                .fill(Theme.ink.opacity(0.06))
                .frame(height: 24)
                .padding(.horizontal, 24)
            HStack(spacing: 4) {
                ForEach(0..<4, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Theme.ink.opacity(0.06))
                        .frame(height: 28)
                }
            }
            .padding(.horizontal, 24)
            HStack(alignment: .bottom, spacing: 6) {
                ForEach(0..<10, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Theme.ink.opacity(0.05))
                        .frame(width: 16, height: CGFloat(40 + (i % 4) * 18))
                }
            }
            .padding(.horizontal, 24)
        }
    }

    // MARK: - Load

    private func load() async {
        loading = true
        defer { loading = false }
        // State + brief in parallel. State paints the page immediately;
        // brief snaps in below when ready.
        async let sRes = (try? await API.fetchTrainingState())
        async let bRes = (try? await API.briefing(surface: "training"))
        let s = await sRes
        let b = await bRes
        self.state = s ?? nil
        self.briefing = b ?? nil
    }

    // MARK: - Helpers

    private func dowLabel(_ dow: Int) -> String {
        // 0 = Sunday per the loader convention.
        let labels = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
        return labels.indices.contains(dow) ? labels[dow] : "—"
    }

    private func phaseColor(_ phase: String) -> Color {
        switch phase.lowercased() {
        case "taper":  return Theme.goal
        case "race":   return Theme.race
        case "peak":   return Theme.learn
        case "build":  return Theme.dist
        case "base":   return Theme.green
        default:       return Theme.mute
        }
    }
}
