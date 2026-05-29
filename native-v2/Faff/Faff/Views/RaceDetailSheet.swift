//
//  RaceDetailSheet.swift  (Phase 25b · iOS /races v3 mirror)
//
//  iPhone race detail sheet — aligned with the web v3 layout at
//  web-v2/app/races/[slug]/page.tsx. Reuses the shared PageHeader
//  (Phase 25a) so the chrome matches /races and the rest of the
//  secondary surfaces.
//
//  Composition (top → bottom):
//    1) PageHeader            ← race name title +
//                               "PRIORITY · TONE · DISTANCE · LOCATION · DATE · GOAL"
//                               eyebrow +
//                               countdown chip accent
//    2) RaceDayTimeline       ← 9-moment arc (A-races, T-7 → T+14 only)
//    3) CoachSlot             ← background-loaded proximity-adaptive voice
//    4) COURSE · PACE PLAN ·  ← BCard sections (one per labeled block,
//       CHECKLIST · NOTES         using the iOS Card pattern)
//
//  Proximity is computed from `race.days` and matches the web router:
//    days < 0   → post-race
//    days ≤ 7   → race-week
//    days ≤ 60  → sharpening
//    else       → building
//

import SwiftUI

struct RaceDetailSheet: View {
    let slug: String
    /// Pre-fetched payload. When supplied the sheet renders synchronously
    /// with no spinner. Pattern matches RunDetailSheet + WorkoutDetailModal.
    let prefetched: RaceDetailResponse?

    init(slug: String, prefetched: RaceDetailResponse? = nil) {
        self.slug = slug
        self.prefetched = prefetched
        _data = State(initialValue: prefetched)
        _loading = State(initialValue: prefetched == nil)
    }

    @Environment(\.dismiss) private var dismiss
    @State private var data: RaceDetailResponse?
    @State private var loading: Bool
    /// Proximity-adaptive coach brief. Mode is computed from days_to_race
    /// and passed to /api/briefing so the voice frames the race
    /// correctly (building / sharpening / race-week / post-race).
    @State private var briefing: Briefing?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let d = data {
                        PageHeader(
                            title: d.race.name,
                            eyebrow: Self.buildEyebrow(race: d.race, proximity: d.proximity),
                            accent: countdownAccent(days: d.race.days, proximity: d.proximity)
                        )

                        // Race-day timeline · self-gates on priority + window
                        if let days = d.race.days {
                            RaceDayTimeline(race: d.race, daysUntil: days)
                                .padding(.horizontal, 24)
                                .transition(.opacity)
                        }

                        // Coach voice — background-loads, skeleton while pending
                        CoachSlot(
                            briefing: briefing,
                            surface: "race-detail",
                            askPrompt: nil
                        )

                        // BCard sections — COURSE · PACE PLAN · CHECKLIST · NOTES
                        // (Suppress COURSE + PACE PLAN deep in post-race; the
                        // web does the same — they're built around looking
                        // forward at the route.)
                        if d.proximity != "post-race" {
                            bCardSection(title: "COURSE", color: Theme.race) {
                                courseBody(d.race)
                            }
                            bCardSection(title: "PACE PLAN", color: Theme.dist) {
                                pacePlanBody(d.race)
                            }
                        }

                        bCardSection(title: "CHECKLIST", color: Theme.goal) {
                            checklistBody(d.race, proximity: d.proximity)
                        }

                        bCardSection(title: "NOTES", color: Theme.mute) {
                            notesBody(d.race, proximity: d.proximity)
                        }
                    } else if loading {
                        raceDetailSkeleton
                            .transition(.opacity)
                    } else {
                        Text("Couldn't load this race.")
                            .font(.body(13)).foregroundStyle(Theme.mute)
                            .padding(.horizontal, 24)
                    }
                }
                .padding(.vertical, 18)
            }
            .background(Theme.bg.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }.foregroundStyle(Theme.green)
                }
            }
        }
        .task {
            // Skip the race-detail fetch when prefetched, but always
            // attempt to load the proximity-adaptive coach brief once
            // we know the days_to_race.
            if prefetched == nil { await load() }
            await loadBrief()
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    // MARK: - PageHeader inputs

    /// Eyebrow assembly mirrors web /races/[slug] lines 75-81:
    ///   "A · RACE WEEK · HALF MARATHON · BOULDER, CO · MAY 28, 2026 · GOAL 1:35"
    /// Pieces drop out cleanly when nil.
    static func buildEyebrow(race: RaceDetail, proximity: String) -> String {
        var parts: [String] = []
        let priority = (race.priority ?? "C").uppercased()
        parts.append("\(priority) · \(proximityLabel(proximity))")
        if let d = race.distance_label { parts.append(d.uppercased()) }
        if let loc = race.location     { parts.append(loc.uppercased()) }
        if !race.date.isEmpty          { parts.append(Self.formatLongDate(race.date)) }
        if let g = race.goal           { parts.append("GOAL \(g)") }
        return parts.joined(separator: " · ")
    }

    /// Right-aligned countdown chip — replaces the old hero stat block.
    /// Color picks proximity-aware tint (race-orange / green / learn).
    private func countdownAccent(days: Int?, proximity: String) -> AnyView? {
        guard let days else { return nil }
        let color: Color = {
            switch proximity {
            case "race-week":  return Theme.race
            case "post-race":  return Theme.green
            case "sharpening": return Theme.learn
            default:           return Theme.race
            }
        }()
        let label = proximity == "post-race" ? "DAYS AGO" : "DAYS"
        return AnyView(
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(abs(days))")
                    .font(.display(56))
                    .foregroundStyle(color)
                    .lineLimit(1)
                Text(label)
                    .font(.label(10))
                    .tracking(1.4)
                    .foregroundStyle(Theme.mute)
            }
        )
    }

    // MARK: - BCard section helper

    /// One BCard section — labeled eyebrow + bordered card. Mirrors the
    /// `.card` rhythm on the web race detail body so each block reads as
    /// a discrete unit.
    @ViewBuilder
    private func bCardSection<Content: View>(
        title: String,
        color: Color,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.label(10))
                .tracking(1.6)
                .foregroundStyle(color)
            content()
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .background(Theme.card)
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
        .padding(.horizontal, 24)
    }

    // MARK: - Section bodies
    //
    // OPEN DATA GAP (Phase 25b) — RaceDetail on iOS doesn't carry
    // course_geometry / checklist rows / pace splits today. These bodies
    // render the section *frames* with the same vocabulary as the web,
    // but the live data underneath is deferred to a follow-up that
    // grows RaceDetailResponse to include the same geometry + checklist
    // payloads the web /races/[slug] page consumes. Until then each
    // section shows a placeholder line so the chrome reads honestly.

    @ViewBuilder
    private func courseBody(_ r: RaceDetail) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(r.distance_label?.uppercased() ?? "DISTANCE PENDING")
                .font(.display(20))
                .foregroundStyle(Theme.ink)
            Text("Course geometry, elevation, and the GPX route render on the web /races/[slug] page. Course payload not yet wired to the iPhone RaceDetailResponse — coming next round.")
                .font(.body(12))
                .foregroundStyle(Theme.ink.opacity(0.75))
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private func pacePlanBody(_ r: RaceDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .lastTextBaseline, spacing: 14) {
                if let goal = r.goal {
                    statBox("GOAL", goal)
                }
                if let finish = r.finishTime {
                    statBox("FINISH", finish)
                }
                if r.pb == true {
                    statBox("RESULT", "PB")
                }
            }
            Text("Pace plan + elevation-aware splits live on the web /races/[slug] page. Splits payload deferred — same data-gap as the course section.")
                .font(.body(12))
                .foregroundStyle(Theme.ink.opacity(0.75))
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private func checklistBody(_ r: RaceDetail, proximity: String) -> some View {
        switch proximity {
        case "race-week":
            checklistItems([
                "Shoes broken in — race pair confirmed",
                "Fuel locked — same brand + dose as long runs",
                "Pacing plan written — splits + heart-rate ceiling",
                "Logistics — drop bag, transit, bib pickup",
                "Sleep — 8h tonight, 8h tomorrow",
            ])
        case "sharpening":
            checklistItems([
                "Marathon-pace block on schedule",
                "Threshold week locked in",
                "Race-day fuel rehearsed twice on long runs",
                "Course studied — one elevation note nailed",
            ])
        case "post-race":
            checklistItems([
                "Walk it out — 20m loose movement",
                "Refuel within the hour — protein + carbs",
                "Race notes written before bed",
                "Easy week — no quality for 7 days",
            ])
        default:
            checklistItems([
                "Long run hitting time-on-feet target",
                "Quality 2x/week — one threshold, one long-form",
                "Sleep + RHR trends clean",
                "Race plan written — splits + fuel",
            ])
        }
    }

    @ViewBuilder
    private func checklistItems(_ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(items, id: \.self) { item in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "circle")
                        .font(.body(13, weight: .semibold))
                        .foregroundStyle(Theme.mute)
                        .padding(.top, 2)
                    Text(item)
                        .font(.body(13))
                        .foregroundStyle(Theme.ink.opacity(0.85))
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    @ViewBuilder
    private func notesBody(_ r: RaceDetail, proximity: String) -> some View {
        Text(proximityCopy(proximity, r))
            .font(.body(13))
            .foregroundStyle(Theme.ink.opacity(0.85))
            .lineSpacing(3)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: - Stat helper (used by PACE PLAN)

    private func statBox(_ k: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(k).font(.label(9)).tracking(1.2).foregroundStyle(Theme.mute)
            Text(v).font(.body(14, weight: .semibold)).foregroundStyle(Theme.ink)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.025))
        .clipShape(RoundedRectangle(cornerRadius: 9))
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(Theme.line, lineWidth: 1))
    }

    // MARK: - Proximity copy + labels

    private static func proximityLabel(_ p: String) -> String {
        switch p {
        case "race-week":  return "RACE WEEK"
        case "sharpening": return "SHARPENING"
        case "post-race":  return "POST-RACE"
        case "building":   return "BUILDING"
        default:           return p.uppercased()
        }
    }

    private func proximityCopy(_ p: String, _ r: RaceDetail) -> String {
        switch p {
        case "race-week":
            return "Final week. Volume drops 30-50%. Quality stays sharp but short. No new shoes, no new fuel, nothing untested. Trust the work."
        case "sharpening":
            return "1-2 months out. Volume holding at peak. Workouts get more race-specific — marathon-pace work, threshold reps. The hay's almost in the barn."
        case "post-race":
            return "Recovery first. Easy week. Reflect. The coach will absorb the result and recalibrate paces."
        default:
            return "Build phase. Steady volume ramp, weekly long run, quality 2x/week. Keep training honest; the race will come to you."
        }
    }

    // MARK: - Skeleton

    private var raceDetailSkeleton: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Capsule().fill(Theme.ink.opacity(0.05)).frame(width: 24, height: 14)
                    Capsule().fill(Theme.ink.opacity(0.05)).frame(width: 100, height: 12)
                }
                RoundedRectangle(cornerRadius: 6)
                    .fill(Theme.ink.opacity(0.06))
                    .frame(width: 240, height: 32)
                RoundedRectangle(cornerRadius: 3)
                    .fill(Theme.ink.opacity(0.05))
                    .frame(width: 180, height: 12)
            }
            .padding(.horizontal, 24)

            HStack(spacing: 10) {
                ForEach(0..<3, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 4) {
                        RoundedRectangle(cornerRadius: 3).fill(Theme.ink.opacity(0.05)).frame(width: 50, height: 10)
                        RoundedRectangle(cornerRadius: 3).fill(Theme.ink.opacity(0.06)).frame(width: 60, height: 18)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(Theme.card)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
                    .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
                }
            }
            .padding(.horizontal, 24)
        }
    }

    // MARK: - Compute proximity mode (for /api/briefing)

    private func raceDetailMode(daysToRace: Int?) -> String {
        guard let d = daysToRace else { return "building" }
        if d < 0 { return "post-race" }
        if d <= 7 { return "race-week" }
        if d <= 60 { return "sharpening" }
        return "building"
    }

    // MARK: - Load

    private func loadBrief() async {
        let days = data?.race.days
        let mode = raceDetailMode(daysToRace: days)
        briefing = try? await API.briefing(surface: "race-detail", mode: mode)
    }

    private func load() async {
        defer { loading = false }
        data = try? await API.fetchRaceDetail(slug: slug)
    }

    // MARK: - Date formatting

    /// "MAY 28, 2026" — long-form for the detail eyebrow.
    static func formatLongDate(_ iso: String) -> String {
        let parts = iso.split(separator: "-")
        guard parts.count >= 3,
              let m = Int(parts[1]),
              let d = Int(parts[2]),
              m >= 1, m <= 12
        else { return iso.uppercased() }
        let months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]
        let y = String(parts[0])
        return "\(months[m - 1]) \(d), \(y)"
    }
}
