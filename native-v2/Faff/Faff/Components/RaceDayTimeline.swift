//
//  RaceDayTimeline.swift  (Phase 25b · iOS /races v3 mirror)
//
//  SwiftUI port of web-v2/components/races/RaceDayTimeline.tsx — the 9
//  emotional moments from night-before → debrief, gated to A-races in
//  the T-7 → T+14 window.
//
//  Gate (double-checked here for direct callers, matches web):
//    · race.priority == "A"         — B/C races render nothing
//    · daysUntil ∈ [-14, 7]         — race week through 2-week debrief
//    · outside window               — locked teaser card
//
//  Data model (RaceMoment) is the only iOS-side moment shape; both
//  MomentCard.swift and this builder consume it. Kept inside this file
//  so the moment vocabulary stays co-located with the builder.
//
//  Differences vs the web reference:
//    · iPhone collapses the 3-column grid into a single column of cards
//      (390-430pt screen is too narrow for 3-up).
//    · The "Order Uber" action stays DISABLED with "Add venue address"
//      copy, matching the web's gate. No fabricated deep link.
//    · The header right-rail "Race week · N days to go" string is the
//      same vocabulary as the web TimelineHeader.
//

import SwiftUI

// MARK: - Domain model

/// One moment in the 9-step race-day arc. Mirrors `Moment` in the web
/// RaceDayTimeline.tsx (same fields, same vocabulary).
struct RaceMoment: Identifiable, Equatable {
    enum Id: String, CaseIterable {
        case nightBefore = "night-before"
        case raceMorning = "race-morning"
        case preRace = "pre-race"
        case startLine = "start-line"
        case firstThird = "first-third"
        case halfway = "halfway"
        case finalThird = "final-third"
        case finish = "finish"
        case debrief = "debrief"
    }

    enum Tone: String {
        case night, race, green, learn
    }

    struct Action: Equatable {
        let label: String
        /// nil when disabled
        let url: URL?
        let disabled: Bool
        let disabledNote: String?
    }

    let momentId: Id
    let marker: String       // "T-12h" / "T+0" / "Mi 1-4.4" / "+14d"
    let eyebrow: String      // "Night before" / "Race morning · early"
    let headline: String     // "Sleep now." / "Go."
    let expect: String       // plain-English what-to-expect
    let coach: String        // single coach voice line
    let action: Action?
    let tone: Tone

    var id: String { momentId.rawValue }
}

// MARK: - View

struct RaceDayTimeline: View {
    let race: RaceDetail
    /// Days until race day (negative if past). Caller computes this from
    /// `race.days` so the gate stays consistent with the page chrome.
    let daysUntil: Int

    var body: some View {
        // Hard gate — A-races only, regardless of caller. Matches the web's
        // double-check pattern.
        if (race.priority ?? "").uppercased() != "A" {
            EmptyView()
        } else if daysUntil < -14 || daysUntil > 7 {
            lockedCard
        } else {
            mainTimeline
        }
    }

    // MARK: - Main timeline

    private var mainTimeline: some View {
        let moments = Self.buildMoments(for: race, hasVenueAddress: false)
        let activeId = Self.activeMomentId(daysUntil: daysUntil)
        return VStack(alignment: .leading, spacing: 16) {
            header
            VStack(spacing: 12) {
                ForEach(moments) { moment in
                    MomentCard(moment: moment, isActive: moment.momentId == activeId)
                }
            }
        }
        .padding(20)
        .background(Theme.card)
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
    }

    private var header: some View {
        HStack(alignment: .lastTextBaseline) {
            VStack(alignment: .leading, spacing: 6) {
                Text("RACE-DAY TIMELINE · THE FULL ARC")
                    .font(.label(11))
                    .tracking(1.6)
                    .foregroundStyle(Theme.race)
                Text(race.name.uppercased())
                    .displayRecipe(size: 24)
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 12)
            Text(Self.headerRightRail(daysUntil: daysUntil).uppercased())
                .font(.label(11))
                .tracking(1.4)
                .foregroundStyle(Theme.mute)
                .multilineTextAlignment(.trailing)
                .lineLimit(2)
        }
        .padding(.bottom, 12)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.line2).frame(height: 1)
        }
    }

    // MARK: - Locked teaser

    private var lockedCard: some View {
        VStack(alignment: .center, spacing: 8) {
            Text("RACE-DAY TIMELINE")
                .font(.label(10))
                .tracking(1.6)
                .foregroundStyle(Theme.mute)
            Text("Timeline unlocks 7 days before race day.")
                .displayRecipe(size: 22)
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Text(daysUntil > 7
                 ? "Currently \(daysUntil) days out. The night-before → debrief arc reveals itself in race week."
                 : "Debrief window closed. The race report sits below.")
                .font(.body(12.5))
                .foregroundStyle(Theme.ink.opacity(0.6))
                .multilineTextAlignment(.center)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 22)
        .padding(.vertical, 24)
        .background(Theme.card)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.rCard)
                .strokeBorder(Theme.line, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
    }

    // MARK: - Builders (pure)

    /// Build the 9 moments from a RaceDetail. Mirrors `buildMoments()` in
    /// RaceDayTimeline.tsx — same copy, same time markers, same disabled
    /// action vocabulary on race-morning.
    static func buildMoments(for race: RaceDetail, hasVenueAddress: Bool) -> [RaceMoment] {
        let distanceMi = distanceMiFromRow(race)
        let finishTime = predictedFinishLabel(race)
        let half = String(format: "%.1f", distanceMi / 2)
        let firstThird = String(format: "%.1f", distanceMi / 3)
        let lastThird = String(format: "%.1f", (distanceMi * 2) / 3)

        let raceMorningAction: RaceMoment.Action = hasVenueAddress
            ? RaceMoment.Action(
                label: "Order Uber",
                url: buildUberDeepLink(for: race),
                disabled: false,
                disabledNote: nil
              )
            : RaceMoment.Action(
                label: "Add venue address",
                url: nil,
                disabled: true,
                disabledNote: "Add a home + venue address to your profile to wire this."
              )

        return [
            RaceMoment(
                momentId: .nightBefore,
                marker: "T-12h",
                eyebrow: "Night before",
                headline: "Sleep now.",
                expect: "Final checklist sweep. Kit on the floor. Watch charging. Alarm armed.",
                coach: "You've done the work. The race is tomorrow. Lights out.",
                action: nil,
                tone: .night
            ),
            RaceMoment(
                momentId: .raceMorning,
                marker: "T-4h",
                eyebrow: "Race morning · early",
                headline: "Get to the start.",
                expect: "Coffee, breakfast 3h before gun, kit on, drop bag packed, ride to the venue.",
                coach: "Logistics dominant. No new decisions on race day — execute the plan.",
                action: raceMorningAction,
                tone: .race
            ),
            RaceMoment(
                momentId: .preRace,
                marker: "T-30m",
                eyebrow: "Pre-race · corral",
                headline: "Calm hands.",
                expect: "Warmup jog, dynamic mobility, last bathroom, phone in drop bag, into the corral.",
                coach: "First mile slower than feels right. Discipline opens this race.",
                action: nil,
                tone: .race
            ),
            RaceMoment(
                momentId: .startLine,
                marker: "T+0",
                eyebrow: "Gun",
                headline: "Go.",
                expect: "GPS auto-starts the watch. Phone is in the drop bag. It's you and the wrist.",
                coach: "Crowd surge. Don't chase. Settle into goal pace by mile 1.",
                action: nil,
                tone: .race
            ),
            RaceMoment(
                momentId: .firstThird,
                marker: "Mi 1–\(firstThird)",
                eyebrow: "First third · settling",
                headline: "Hold the leash.",
                expect: "Body warming up, breathing rhythmic. Pace can feel easy — that's the trap.",
                coach: "Run the plan, not the legs. The fast race is run from here.",
                action: nil,
                tone: .green
            ),
            RaceMoment(
                momentId: .halfway,
                marker: "Mi \(half)",
                eyebrow: "Halfway",
                headline: "Reset and reload.",
                expect: "Fueling window. Heart rate locked. Predicted finish is what you executed.",
                coach: "Halfway done. Now the race actually starts.",
                action: nil,
                tone: .green
            ),
            RaceMoment(
                momentId: .finalThird,
                marker: "Mi \(lastThird)+",
                eyebrow: "Final third · the work",
                headline: "This is the race.",
                expect: "Quads loading. Pace defended, not chased. Bumps landing on the wrist.",
                coach: "Drop the shoulders. Quick feet. One mile at a time to the line.",
                action: nil,
                tone: .race
            ),
            RaceMoment(
                momentId: .finish,
                marker: "T+\(finishTime)",
                eyebrow: "Finish",
                headline: "Across the line.",
                expect: "Watch auto-saves. Spectator graph lights up. Photo crew, medal, foil blanket.",
                coach: "You ran the race we built. Walk it out before the legs lock.",
                action: nil,
                tone: .green
            ),
            RaceMoment(
                momentId: .debrief,
                marker: "+14d",
                eyebrow: "Two weeks later · debrief",
                headline: "Read the race.",
                expect: "Strava synced. Per-phase + per-mile actuals against the plan. Calibration delta.",
                coach: "What the day taught us about the runner you are now — and what we tune next.",
                action: nil,
                tone: .learn
            ),
        ]
    }

    /// Active-moment selection — mirrors `activeMomentId()` in the web file.
    static func activeMomentId(daysUntil: Int) -> RaceMoment.Id {
        if daysUntil > 1  { return .nightBefore }
        if daysUntil == 1 { return .nightBefore }
        if daysUntil == 0 { return .raceMorning }
        if daysUntil >= -1 { return .finish }
        return .debrief
    }

    /// Right-rail header copy — same dictionary as TimelineHeader in the web.
    static func headerRightRail(daysUntil: Int) -> String {
        if daysUntil > 1   { return "Race week · \(daysUntil) days to go" }
        if daysUntil == 1  { return "Race tomorrow" }
        if daysUntil == 0  { return "Race day · now" }
        if daysUntil >= -7 {
            let abs = -daysUntil
            return "\(abs) day\(abs == 1 ? "" : "s") ago"
        }
        return "Debrief window"
    }

    /// Distance fallback from the label when distance_mi isn't carried.
    /// RaceDetail (Models/Races.swift) doesn't expose a numeric distance;
    /// we derive from the human-readable label, same logic as the web
    /// `distanceMiFromRow()`.
    static func distanceMiFromRow(_ race: RaceDetail) -> Double {
        let label = (race.distance_label ?? "").lowercased()
        if label.contains("marathon") && !label.contains("half") { return 26.2 }
        if label.contains("half") || label.contains("21k") { return 13.1 }
        if label.contains("10k") { return 6.2 }
        if label.contains("5k")  { return 3.1 }
        return 13.1 // sensible default
    }

    /// Predicted finish-time label. RaceDetail.goal is a free-text string
    /// like "1:35" / "sub-3" / "3:15". Best-effort parse otherwise falls
    /// back to a distance-keyed default — never reads "T+null".
    static func predictedFinishLabel(_ race: RaceDetail) -> String {
        let goal = (race.goal ?? "").trimmingCharacters(in: .whitespaces)
        // Regex for h:mm or h:mm:ss
        if let range = goal.range(of: #"(\d{1,2}):(\d{2})(?::(\d{2}))?"#, options: .regularExpression) {
            let match = String(goal[range])
            let parts = match.split(separator: ":")
            if parts.count >= 2, let h = Int(parts[0]), let m = Int(parts[1]) {
                return String(format: "%d:%02d", h, m)
            }
        }
        let mi = distanceMiFromRow(race)
        if mi >= 25 { return "3:30" }
        if mi >= 13 { return "1:45" }
        if mi >= 6  { return "50m" }
        return "25m"
    }

    /// Uber deep-link skeleton. No real coordinates — kept wired-and-waiting
    /// for when the profile gains a home + venue address. Today the
    /// disabled action prevents this URL ever being followed.
    static func buildUberDeepLink(for race: RaceDetail) -> URL? {
        let dropoff = "\(race.name) start"
            .addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? race.name
        return URL(string: "uber://?action=setPickup&pickup=my_location&dropoff[nickname]=\(dropoff)")
    }
}
