//
//  RaceDetailSheet.swift  (P40)
//  Tap a race anywhere → detail sheet with proximity-adaptive framing.
//

import SwiftUI

struct RaceDetailSheet: View {
    let slug: String
    /// Pre-fetched payload. When supplied the sheet renders synchronously
    /// with no spinner. Pattern matches RunDetailSheet + WorkoutDetailModal
    /// — parent view warms a date/slug-keyed cache and hands the matching
    /// entry in here. Currently unwired (no callers); ready for whichever
    /// surface lights up the race-detail pop-in.
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
    /// (matching web's /races/[slug]) and passed to /api/briefing so the
    /// voice frames the race correctly (building / sharpening / race-week
    /// / post-race).
    @State private var briefing: Briefing?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if loading {
                        HStack { Spacer(); ProgressView().tint(Theme.green); Spacer() }.padding(40)
                    } else if let d = data {
                        hero(d.race, proximity: d.proximity)
                        stats(d.race)
                        // Coach voice slots in between stats and the
                        // proximity-keyed structural block. Hidden if the
                        // brief hasn't loaded yet so the page paints fast.
                        if let briefing {
                            CoachBlock(
                                lead: briefing.lead,
                                voice: briefing.voice,
                                briefingId: "race-detail|\(briefing.mode)|\(slug)",
                                askPrompt: nil
                            )
                        }
                        proximityBlock(d.proximity, race: d.race)
                        if d.race.priority == "A" {
                            packingNote()
                        }
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
    }

    /// Compute the surface mode from days_to_race, matching web's
    /// resolveRaceDetail() in lib/coach/router.ts.
    private func raceDetailMode(daysToRace: Int?) -> String {
        guard let d = daysToRace else { return "building" }
        if d < 0 { return "post-race" }
        if d <= 7 { return "race-week" }
        if d <= 60 { return "sharpening" }
        return "building"
    }

    /// Fetch proximity-adaptive coach brief for this race.
    private func loadBrief() async {
        let days = data?.race.days
        let mode = raceDetailMode(daysToRace: days)
        briefing = try? await API.briefing(surface: "race-detail", mode: mode)
    }

    private func hero(_ r: RaceDetail, proximity: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                if let p = r.priority {
                    Text(p)
                        .font(.label(10)).tracking(1.2)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Capsule().fill(colorForPriority(p).opacity(0.18)))
                        .foregroundStyle(colorForPriority(p))
                }
                Text(proximityLabel(proximity))
                    .font(.label(10)).tracking(1.4)
                    .foregroundStyle(Theme.race)
            }
            Text(r.name).font(.display(36)).foregroundStyle(Theme.ink)
            Text("\(r.date) · \(r.distance_label ?? "")")
                .font(.body(12)).foregroundStyle(Theme.mute)
            if let loc = r.location {
                Text(loc).font(.body(12)).foregroundStyle(Theme.mute)
            }
        }
        .padding(.horizontal, 24)
    }

    private func stats(_ r: RaceDetail) -> some View {
        HStack(spacing: 16) {
            if let d = r.days {
                statBox("DAYS", d > 0 ? "\(d)" : (d == 0 ? "TODAY" : "PAST"))
            }
            if let goal = r.goal { statBox("GOAL", goal) }
            if let pb = r.pb { statBox("PB", pb) }
            if let f = r.finish_time { statBox("FINISH", f) }
        }
        .padding(.horizontal, 24)
    }

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

    private func proximityBlock(_ p: String, race: RaceDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("WHAT THIS MEANS").font(.label(10)).tracking(1.4)
                .foregroundStyle(Theme.mute)
            Text(proximityCopy(p, race))
                .font(.body(13))
                .foregroundStyle(Theme.ink.opacity(0.85))
                .lineSpacing(3)
        }
        .padding(.horizontal, 24)
    }

    private func packingNote() -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("PACKING LIST")
                .font(.label(10)).tracking(1.4)
                .foregroundStyle(Theme.goal)
            Text("Race-week packing surfaces on the web /races/[slug] page. The full list lives in your race details — shoes, gels, race-day plan, weather-adapted layers.")
                .font(.body(12))
                .foregroundStyle(Theme.ink.opacity(0.75))
                .lineSpacing(2)
        }
        .padding(.horizontal, 24)
    }

    private func proximityLabel(_ p: String) -> String {
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

    private func colorForPriority(_ p: String) -> Color {
        switch p {
        case "A": return Theme.race
        case "B": return Theme.goal
        case "C": return Theme.mute
        default:  return Theme.mute
        }
    }

    private func load() async {
        defer { loading = false }
        data = try? await API.fetchRaceDetail(slug: slug)
    }
}
