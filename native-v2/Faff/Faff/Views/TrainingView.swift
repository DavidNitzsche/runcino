//
//  TrainingView.swift
//
//  iPhone TRAINING tab — the WHOLE plan arc, not just a compact /today.
//
//  2026-05-27 redesign: David said the previous TrainingView was
//  "pointless — just a different version of TODAY." Now mirrors what
//  /training shows on web:
//
//    1) Race-proximity headline ("47 days to CIM.") or "Training."
//    2) Phase + week X of Y + planned mileage subtitle
//    3) Phase strip — base / build / peak / taper progression
//    4) Plan arc — every week's planned vs done mileage as a bar arc
//    5) Current-week detail (day list with planned + done per day)
//    6) Next-quality preview (if any)
//    7) Coach prose at the bottom (background-loaded, doesn't gate
//       the rest of the page)
//
//  /api/training/state ships the same data the web TrainingPage reads.
//  Coach brief still loads in parallel via CoachSlot — the page paints
//  the plan arc immediately while the LLM brief catches up.
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
                    headline
                    subtitle

                    if let s = state {
                        phaseStrip(s)
                            .transition(.opacity)
                        planArc(s)
                            .transition(.opacity)
                        if let week = currentWeek(s) {
                            weekAhead(week, today: s.today)
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
                    // never blocks the structural content above.
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
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                if let phase = state?.currentPhase {
                    ToolbarItem(placement: .topBarTrailing) {
                        Text(phase.uppercased())
                            .font(.label(10)).tracking(1.4)
                            .foregroundStyle(phaseColor(phase))
                            .padding(.horizontal, 10).padding(.vertical, 4)
                            .background(phaseColor(phase).opacity(0.12))
                            .overlay(Capsule().stroke(phaseColor(phase).opacity(0.35), lineWidth: 1))
                            .clipShape(Capsule())
                    }
                }
            }
            .task { await load() }
            .refreshable { await load() }
        }
    }

    // MARK: - Headline + subtitle

    @ViewBuilder
    private var headline: some View {
        if let race = state?.race, currentWeek(state!) != nil {
            Text("\(race.days_to_race) days to \(race.name).")
                .font(.display(36))
                .tracking(0.4)
                .foregroundStyle(Theme.ink)
                .lineLimit(3)
                .padding(.horizontal, 24)
                .padding(.top, 4)
        } else {
            Text("No active plan.")
                .font(.display(36))
                .tracking(0.4)
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 24)
                .padding(.top, 4)
        }
    }

    @ViewBuilder
    private var subtitle: some View {
        if let s = state, let week = currentWeek(s) {
            let parts = [
                s.currentPhase?.uppercased() ?? "NO PHASE",
                "WEEK \(week.idx) OF \(s.weeks.count)",
                s.weekPlanned != nil ? "\(Int(s.weekPlanned!)) MI PLANNED" : nil,
            ].compactMap { $0 }
            Text(parts.joined(separator: " · "))
                .font(.label(11)).tracking(1.4)
                .foregroundStyle(Theme.mute)
                .padding(.horizontal, 24)
        }
    }

    // MARK: - Phase strip
    //
    // Compact horizontal bar showing each phase as a segment, sized
    // proportionally to the number of weeks it covers. Current phase
    // is filled, others are muted outline.

    private func phaseStrip(_ s: TrainingState) -> some View {
        let total = max(1, s.weeks.count)
        return VStack(alignment: .leading, spacing: 8) {
            Text("PHASES")
                .font(.label(10)).tracking(1.6)
                .foregroundStyle(Theme.mute)
            // GeometryReader parent so we can size each segment by its
            // share of the FULL strip width (not the share of an
            // equal-divided HStack).
            GeometryReader { geo in
                HStack(spacing: 4) {
                    ForEach(s.phases) { phase in
                        let span = max(1, phase.endWeekIdx - phase.startWeekIdx + 1)
                        let fraction = CGFloat(span) / CGFloat(total)
                        let isCurrent = (s.currentPhase?.lowercased() == phase.label.lowercased())
                        let gaps = CGFloat(max(0, s.phases.count - 1)) * 4
                        let segW = max(40, fraction * (geo.size.width - gaps))
                        PhaseSegment(label: phase.label,
                                     color: phaseColor(phase.label),
                                     active: isCurrent)
                            .frame(width: segW)
                    }
                }
            }
            .frame(height: 36)
        }
        .padding(.horizontal, 24)
    }

    // MARK: - Plan arc
    //
    // One bar per week of the plan. Planned mileage = full bar height,
    // done mileage = filled portion (green). Current week is outlined.

    private func planArc(_ s: TrainingState) -> some View {
        let maxMi = max(1.0, s.weeks.map(\.plannedMi).max() ?? 1)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("PLAN ARC")
                    .font(.label(10)).tracking(1.6)
                    .foregroundStyle(Theme.mute)
                Spacer()
                if let race = s.race {
                    Text(race.name.uppercased())
                        .font(.label(10)).tracking(1.4)
                        .foregroundStyle(Theme.race)
                }
            }

            // Horizontal scroll so a 16-week plan doesn't get squashed.
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .bottom, spacing: 6) {
                        ForEach(s.weeks) { w in
                            arcBar(week: w, maxMi: maxMi)
                                .id(w.idx)
                        }
                    }
                    .padding(.vertical, 6)
                }
                .onAppear {
                    if let idx = s.currentWeekIdx {
                        proxy.scrollTo(idx, anchor: .center)
                    }
                }
            }
        }
        .padding(.horizontal, 24)
    }

    private func arcBar(week w: TrainingPlanWeek, maxMi: Double) -> some View {
        let plannedH = CGFloat(w.plannedMi / maxMi) * 96
        let doneSum = w.days.reduce(0) { $0 + $1.doneMi }
        let doneH = CGFloat(min(doneSum, w.plannedMi) / maxMi) * 96
        let isCurrent = w.isCurrent
        return VStack(spacing: 4) {
            ZStack(alignment: .bottom) {
                // Planned (muted background)
                RoundedRectangle(cornerRadius: 3)
                    .fill(Theme.ink.opacity(0.08))
                    .frame(width: 16, height: max(4, plannedH))
                // Done (green fill)
                RoundedRectangle(cornerRadius: 3)
                    .fill(isCurrent ? Theme.green : Theme.green.opacity(0.65))
                    .frame(width: 16, height: max(0, doneH))
            }
            .frame(height: 100, alignment: .bottom)
            .overlay(
                RoundedRectangle(cornerRadius: 3)
                    .stroke(isCurrent ? Theme.green : Color.clear, lineWidth: 1.5)
                    .frame(width: 18, height: max(4, plannedH))
                    .offset(y: -((100 - plannedH) / 2))
            )
            Text("\(w.idx)")
                .font(.label(9))
                .foregroundStyle(isCurrent ? Theme.green : Theme.mute)
        }
    }

    // MARK: - Week ahead

    private func weekAhead(_ week: TrainingPlanWeek, today: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("THIS WEEK")
                    .font(.label(10)).tracking(1.6)
                    .foregroundStyle(Theme.mute)
                Spacer()
                Text("\(Int(week.plannedMi)) mi planned")
                    .font(.body(11, weight: .semibold))
                    .foregroundStyle(Theme.mute)
            }

            VStack(spacing: 0) {
                ForEach(week.days) { d in
                    dayRow(d, isToday: d.date == today)
                    if d.id != week.days.last?.id {
                        Divider().background(Theme.line).padding(.leading, 16)
                    }
                }
            }
            .background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
            .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
        }
        .padding(.horizontal, 24)
    }

    private func dayRow(_ d: TrainingPlanDay, isToday: Bool) -> some View {
        HStack(spacing: 12) {
            // Day-of-week label
            VStack(alignment: .leading, spacing: 2) {
                Text(dowLabel(d.dow))
                    .font(.label(10)).tracking(1.2)
                    .foregroundStyle(isToday ? Theme.green : Theme.mute)
                Text(d.type.uppercased())
                    .font(.label(10)).tracking(1)
                    .foregroundStyle(colorForType(d.type))
            }
            .frame(width: 72, alignment: .leading)

            VStack(alignment: .leading, spacing: 2) {
                Text(d.label ?? d.type.capitalized)
                    .font(.body(13, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                if d.mi > 0 || d.doneMi > 0 {
                    Text(progressLabel(d))
                        .font(.body(11))
                        .foregroundStyle(d.activityId != nil ? Theme.green : Theme.mute)
                }
            }
            Spacer()
            if d.activityId != nil {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.green)
            } else if isToday {
                Image(systemName: "arrow.right.circle.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.green)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        .background(isToday ? Theme.green.opacity(0.05) : Color.clear)
    }

    private func progressLabel(_ d: TrainingPlanDay) -> String {
        if d.activityId != nil && d.doneMi > 0 {
            return String(format: "%.1f / %.1f mi", d.doneMi, d.mi)
        }
        if d.mi > 0 {
            return String(format: "%.1f mi planned", d.mi)
        }
        return "—"
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

    private func currentWeek(_ s: TrainingState) -> TrainingPlanWeek? {
        s.weeks.first(where: { $0.isCurrent })
    }

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

    private func colorForType(_ t: String) -> Color {
        switch t.lowercased() {
        case "easy", "recovery", "long_easy": return Theme.learn
        case "long":   return Theme.dist
        case "tempo", "threshold": return Theme.goal
        case "race":   return Theme.race
        case "rest":   return Theme.mute
        default:       return Theme.mute
        }
    }
}

// MARK: - PhaseSegment

private struct PhaseSegment: View {
    let label: String
    let color: Color
    let active: Bool

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(active ? color.opacity(0.22) : Color.white.opacity(0.04))
            RoundedRectangle(cornerRadius: 6)
                .stroke(active ? color : Theme.line, lineWidth: active ? 1.4 : 1)
            Text(label.uppercased())
                .font(.label(9)).tracking(1.1)
                .foregroundStyle(active ? color : Theme.mute)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(.horizontal, 4)
        }
    }
}
