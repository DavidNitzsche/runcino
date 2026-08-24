//
//  FacesLobbyV5.swift
//  FaffWatch
//
//  Screen 1 of the 0821 handoff: the LOBBY, at every session-name length,
//  plus the pages behind it and the three boards that are not a session.
//
//  SOURCE OF TRUTH — see WatchThemeV5.swift's header.
//    README.md § "Screens · 1 · Lobby" and § "The rules the design enforces"
//    Faff-Watch-App.dc.html, boards:
//      Pre-run · Lobby long · Lobby threshold · Lobby intervals · Lobby race
//      Lobby page 2 race plan · Lobby page 2 session steps
//      Lobby page 3 this week · Rest day · No session · Countdown
//      Lobby readiness
//  Every point value below is the design file's 2x set divided by two, and the
//  2x set is the spec.
//
//  These views take PLAIN parameters on purpose. They know nothing about
//  WorkoutEngine, WatchWorkout, PhoneSync or the legacy `Faff.*` palette; the
//  call site translates. A board that can only be rendered by starting a
//  workout cannot be reviewed against the design file, and the legacy palette
//  is being retired face by face.
//
//  ─────────────────────────────────────────────────────────────────────────
//  NEEDS: three gaps in the shared vocabulary. ALL THREE ARE NOW CLOSED and
//  every local workaround has been deleted — this file reaches for the shared
//  component in each case.
//
//  1. `WatchV5.DayState.muted` — CLOSED. The "No session" board's grey-blue
//     ramp is a token now (#8792A8 → #5A6072 → #25272E, with its own flatter
//     55% middle stop), so `V5LobbyMutedRamp` is gone and the board goes
//     through `WGradientBoard` like every other ramp board. The workaround
//     approximated the ramp with stepped white and said so; this is the real
//     one.
//
//  2. A target weight that sits ON A RAMP — CLOSED. `WTargetWeight` gained
//     `.onRamp` (black fill, white label, because the ramp has already said
//     what kind of day it is) and `.onRampQuiet` (black at 42%, so the ramp
//     reads through the escape). `V5LobbyTarget` is gone.
//
//  3. A grouped-rows container — CLOSED. `WRowGroup` + `WGroupRow` draw the
//     design's one 10pt plate with squared inner rows and 1pt fill gaps.
//     `WRow` is still the right component for the standalone Gels tile, which
//     genuinely is one rounded row, and it is still used for it.
//
//  KNOWN DISCREPANCY, resolved toward the design file:
//     The handoff README says "Start stays at 26 pt on every variant so the
//     thumb target never moves between sessions." The design file draws that
//     target 104px tall with a 38px label on every lobby variant — 52pt and
//     19pt — and its own annotation on the intervals board reads "same 52pt
//     Start". 26pt matches neither, and a 26pt-tall target would break rule 6
//     (every target is 50pt). What the sentence is protecting is that the pill
//     does not MOVE OR RESIZE between sessions, so that is what is built: one
//     fixed-height pill in the bottom band of every variant, at the shared
//     `WatchV5.Metric.targetHeight`, with the lede stepping down instead.
//  ─────────────────────────────────────────────────────────────────────────
//

import SwiftUI

// MARK: - Vocabulary

/// Which day-state ramp fills the board. Maps to the session class the wire
/// already carries (`SessionClass` in lib/watch/build-workout.ts), which is
/// what `WatchV5.DayState.forSession` switches on.
enum V5LobbyRamp: String {
    case easy
    case quality        // threshold, intervals, tempo
    case long
    case race
    case rest
    /// No session at all — off-season, a week off, injury, sick. Named
    /// `noSession` rather than `none` so it can never be read as
    /// `Optional.none` at a call site.
    case noSession

    /// The string `WatchV5.DayState.forSession` switches on. Every case but
    /// one is its own raw value; `noSession` maps to the wire's `none`, which
    /// is what selects the muted ramp and its flatter middle stop.
    var wireName: String {
        self == .noSession ? "none" : rawValue
    }
}

/// One row of a page-2 breakdown: a race segment or a workout step.
struct V5LobbyStep {
    let name: String
    let value: String
    /// The row the session is actually about — the rep, not the warm-up. Steps
    /// in FILL (surface3 over surface2), never in a border: there are no
    /// borders anywhere in this design.
    var emphasised: Bool = false
}

/// Where a day sits in the week. Done days are solid, today is lit, what is
/// left is outlined — the week strip is LOAD, not seven rows of text.
enum V5LobbyDayState {
    case done, today, planned
}

/// One column of the week strip.
struct V5LobbyDay {
    /// The one 10pt annotation exception in the whole app, read as a row
    /// rather than individually.
    let letter: String
    let miles: Double
    let state: V5LobbyDayState
}

/// Everything the poster can hold. Optionals are absent registers, not empty
/// ones — a lobby with no band draws four registers, never a blank fifth.
struct V5LobbySession {
    var ramp: V5LobbyRamp = .easy
    /// The display word. `nil` on No session, because there is no session type
    /// to name and inventing one is the failure that board exists to avoid.
    var lede: String?
    /// The dose in the value register. `\n` splits it, which is how a formula
    /// dose ("2 × 3 mi / at 6:52") keeps the pace target whole.
    var dose: String?
    /// The qualifier that changes the session without changing the dose:
    /// "last 3 at marathon pace".
    var qualifier: String?
    /// The band, or on race morning the goal — the number the day is measured
    /// against.
    var band: String?
    /// Race morning's third register: the pace the goal implies.
    var bandSub: String?
    /// The coach's one sentence. Used where the session has already changed
    /// and the reason is stated once. Never a score.
    var note: String?

    // ── Type sizes, derived rather than passed ──
    //
    // The lede steps down with name length so the Start target never has to.
    // Design: EASY / LONG (4) 36pt · MARATHON (8) 28pt · THRESHOLD /
    // INTERVALS (9) 22pt.
    static func ledeSize(_ text: String) -> CGFloat {
        switch text.count {
        case ...4: return 36
        case ...8: return 28
        default:   return 22
        }
    }

    /// A two-line formula dose gives up 3pt so both lines and the register
    /// under them survive.
    var doseSize: CGFloat { (dose?.contains("\n") ?? false) ? 21 : 24 }

    /// The band is the last register, and it yields to whatever else the
    /// session needed room for: 19pt on its own, 17pt when a qualifier line
    /// sits above it, 15pt when the dose already took two lines.
    var bandSize: CGFloat {
        if dose?.contains("\n") ?? false { return 15 }
        if qualifier != nil { return 17 }
        return 19
    }
}

// MARK: - 1 · The poster
//
// Pre-run, Lobby long, Lobby threshold, Lobby intervals, Lobby race and Lobby
// readiness are ONE board. They differ in the ramp, in which registers are
// present, and in the lede size — nothing else moves, which is the point.

struct V5LobbyPoster: View {
    let session: V5LobbySession
    /// The real page count. An empty page is never drawn to even a count, so a
    /// session with no breakdown passes 2 and one with a breakdown passes 3.
    var pageCount: Int = 2
    var pageIndex: Int = 0
    var startLabel: String = "Start"
    let onStart: () -> Void
    /// "Indoors". Present on a session that could plausibly be run on a belt,
    /// absent on one that could not (a race).
    ///
    /// A QUIET SECOND TARGET, not a toggle and not a question after the tap.
    /// Apple's own Workout app makes this choice every time and so does every
    /// other running watch, because the app cannot know: GPS silence means a
    /// treadmill and it means a tunnel, and the only thing that can tell them
    /// apart is the runner. Inferring it — which is what this app did — takes
    /// six minutes to decide and gets a lost fix wrong.
    ///
    /// `onRampQuiet` weight, the same register Rest day's "Run anyway" uses:
    /// present, one tap, and nothing here is being sold.
    var onStartIndoors: (() -> Void)? = nil

    var body: some View {
        WGradientBoard(session: session.ramp.wireName) {
            VStack(spacing: 0) {
                // INDOORS SITS IN THE TOP LEFT, which is empty on every
                // variant of this board — the system clock owns the right of
                // that line and nothing owns the left.
                //
                // It was a second full-width pill under Start first, and that
                // is what the target vocabulary would suggest. Rendered, it
                // cost the poster its lede: EASY fell from 36pt to about 22
                // and THRESHOLD compressed until it competed with the clock,
                // on every session, to carry a choice most runners make once a
                // month. Start also stopped sitting where it sits on every
                // other variant, which is the one thing the lobby's own spec
                // says must never move.
                //
                // A DELIBERATE EXCEPTION TO RULE 6, and the only one. That
                // rule exists so a target is reliable when a runner is moving,
                // sweating, or deciding under pressure — a fault, a
                // confirmation, a mid-run control. This one is pressed
                // standing still, before the run, with full attention, and it
                // is the cheapest possible thing to undo: start the wrong way
                // and you end the run and start it again.
                if let onStartIndoors {
                    HStack {
                        Button(action: onStartIndoors) {
                            Text("Indoors")
                                .font(WatchV5.label(13, .bold))
                                .foregroundStyle(WatchV5.value.opacity(0.86))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(WatchV5.ground.opacity(0.42), in: Capsule())
                        }
                        .buttonStyle(.plain)
                        Spacer(minLength: 0)
                    }
                }

                Spacer(minLength: 0)

                // TYPE RHYTHM, not a flat 4pt gap.
                //
                // The registers step down in size, so a single spacing value
                // sets them at very different optical distances: 4pt under a
                // 36pt display word is a collision, and 4pt under a 15pt line
                // is a gulf. Each gap is now proportional to the type above
                // it, which is what makes three lines read as one block
                // instead of as three stacked labels.
                VStack(spacing: 0) {
                    if let lede = session.lede {
                        WDisplayWord(text: lede, size: V5LobbySession.ledeSize(lede))
                    }
                    if let dose = session.dose {
                        Text(dose)
                            .font(WatchV5.number(session.doseSize))
                            .foregroundStyle(WatchV5.value)
                            .multilineTextAlignment(.center)
                            // TAKES THE HEIGHT IT NEEDS, so the pressure lands
                            // on the spacers instead of on the words. Without
                            // this a poster short of room truncated a
                            // deliberately two-line dose to "2 x 3 mi..." — the
                            // same failure the full-bleed collapse produced
                            // this morning, arriving from a different
                            // direction. A register that silently drops half
                            // its content is worse than a tighter layout.
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, session.doseSize * 0.22)
                    }
                    if let qualifier = session.qualifier {
                        Text(qualifier)
                            .font(WatchV5.number(15))
                            .foregroundStyle(WatchV5.prose)
                            .multilineTextAlignment(.center)
                            .padding(.top, 3)
                    }
                    if let band = session.band {
                        Text(band)
                            .font(WatchV5.number(session.bandSize))
                            .foregroundStyle(WatchV5.valueStated)
                            .padding(.top, session.bandSize * 0.34)
                    }
                    if let sub = session.bandSub {
                        Text(sub)
                            .font(WatchV5.number(15))
                            .foregroundStyle(WatchV5.valueStated)
                            .padding(.top, 2)
                    }
                    if let note = session.note {
                        // The reason, stated once, in the coach's register.
                        // Never a score: a score on a lobby is a thing to
                        // argue with at 6am.
                        WCoachLine(text: note, size: 14, color: WatchV5.proseOnRamp)
                            .multilineTextAlignment(.center)
                            .padding(.top, 8)
                    }
                }
                .frame(maxWidth: .infinity)

                Spacer(minLength: 0)

                // The dots belong to the reading block above, not to the
                // target below — they say how many pages this session has.
                // Sitting them 7pt off the pill made them read as part of it.
                WPageDots(count: pageCount, index: pageIndex)
                    .padding(.bottom, 10)

                WTarget(label: startLabel, weight: .onRamp, action: onStart)
            }
            .frame(maxHeight: .infinity)
        }
    }
}

// MARK: - 2 · Rest day and No session
//
// Refusals with a reason, not empty states. Rest day sits in the rest ramp so
// it reads as a state of the plan rather than a screen that failed to load;
// No session is the muted ramp with NO display word, because there is no
// session type to name.

struct V5LobbyRefusal: View {
    /// `nil` on No session. Present ("Rest") on a rest day.
    var lede: String?
    let sentence: String
    /// The escape. Present but quiet — nothing here is being sold.
    let escapeLabel: String
    var ramp: V5LobbyRamp = .rest
    let onEscape: () -> Void

    var body: some View {
        WGradientBoard(session: ramp.wireName) {
            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 6) {
                    if let lede {
                        // 30pt, one step under the lobby's 36 — this board is
                        // a sentence with a word over it, not a poster.
                        WDisplayWord(text: lede, size: 30)
                    }
                    WCoachLine(text: sentence,
                               size: lede == nil ? 15 : 14,
                               color: lede == nil ? WatchV5.value : WatchV5.proseOnRamp)
                }

                Spacer(minLength: 0)

                WTarget(label: escapeLabel, weight: .onRampQuiet, action: onEscape)
                    .padding(.top, WatchV5.Metric.readingToStack)
            }
            .frame(maxHeight: .infinity)
        }
    }
}

// MARK: - 3 · Countdown
//
// The last frame of the lobby, not a new place: three seconds, one numeral,
// the session's ramp still on screen, and NOTHING MOVES except the number.
// No ring, no sweep, no scale — rule 13, motion is the failure this system was
// built against.

struct V5LobbyCountdown: View {
    let ramp: V5LobbyRamp
    /// 3, 2, 1. Driven by the caller's timer; this view only draws it.
    let seconds: Int

    var body: some View {
        WGradientBoard(session: ramp.wireName) {
            Text("\(seconds)")
                .font(WatchV5.number(130))
                .foregroundStyle(WatchV5.value)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

// MARK: - 4 · Page 2 · the breakdown
//
// One swipe from the poster. Black ground and stepped fills, because this is a
// list to read standing still rather than a thing to glance at, and the ramp's
// job was already done on page 1.

/// The same page for a race plan ("The plan", plus the gel points) and for any
/// session with steps ("The steps"). Anything with no breakdown has NO second
/// page rather than an empty one — which is why `pageCount` is a parameter and
/// not a constant.
struct V5LobbyBreakdown: View {
    let kicker: String
    let steps: [V5LobbyStep]
    /// The one row that is not part of the sequence: gel points on race
    /// morning. Absent on a workout, and absent means absent.
    var footerName: String? = nil
    var footerValue: String? = nil
    var pageCount: Int = 3
    var pageIndex: Int = 1

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 8) {
                WKicker(text: kicker)

                // One plate, squared rows, 1pt fill gaps — the design's page-2
                // list, not a stack of pills. Steps in FILL: surface3 over
                // surface2 is how the row the session is actually about says
                // so, without a border.
                WRowGroup {
                    ForEach(Array(steps.enumerated()), id: \.offset) { _, step in
                        WGroupRow(fill: step.emphasised ? WatchV5.surface3
                                                        : WatchV5.surface2) {
                            Text(step.name)
                                .font(WatchV5.number(13))
                                .foregroundStyle(step.emphasised ? WatchV5.value
                                                                 : WatchV5.valueDim)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        } trailing: {
                            Text(step.value)
                                .font(WatchV5.number(16))
                                .foregroundStyle(WatchV5.value)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                    }
                }

                if let footerName, let footerValue {
                    WRow(fill: WatchV5.surface1) {
                        Text(footerName)
                            .font(WatchV5.number(13))
                            .foregroundStyle(WatchV5.valueDim)
                    } trailing: {
                        Text(footerValue)
                            .font(WatchV5.number(16))
                            .foregroundStyle(WatchV5.value)
                    }
                }

                Spacer(minLength: 0)

                WPageDots(count: pageCount, index: pageIndex)
                    .frame(maxWidth: .infinity)
            }
            .frame(maxHeight: .infinity)
        }
    }
}

// MARK: - 5 · Page 3 · this week
//
// Seven days as LOAD, not seven rows of text: done days solid, today lit, what
// is left outlined. It answers the only week-shaped question a runner asks
// before leaving the house, which is whether the hard one has been done yet.
// Miles run against miles planned sit underneath, and NOTHING HERE IS
// TAPPABLE.

struct V5LobbyWeek: View {
    let days: [V5LobbyDay]
    let milesRun: String
    let milesPlanned: String
    /// "mi" or "km". The board used to say "mi" in its own body, so a
    /// kilometre runner read a converted figure under a mile's label.
    var unit: String = "mi"
    var pageCount: Int = 3
    var pageIndex: Int = 2

    /// The tallest column in the design, which is what every other column is
    /// drawn against. Bars are relative to the week's own biggest day: the
    /// strip reads shape, not absolute distance.
    private let tallestBar: CGFloat = 75
    /// A day that was run but barely still has to be visible as run.
    private let shortestBar: CGFloat = 10

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 0) {
                WKicker(text: "This week")

                HStack(alignment: .bottom, spacing: 4) {
                    ForEach(Array(days.enumerated()), id: \.offset) { _, day in
                        VStack(spacing: 4) {
                            RoundedRectangle(cornerRadius: 5, style: .continuous)
                                .fill(barFill(day.state))
                                .frame(height: barHeight(day.miles))
                            Text(day.letter)
                                .font(WatchV5.number(10))
                                .foregroundStyle(letterFill(day.state))
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .padding(.top, 8)
                .padding(.bottom, 5)

                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text(milesRun)
                        .font(WatchV5.number(27))
                        .foregroundStyle(WatchV5.value)
                    Text("of \(milesPlanned) \(unit)")
                        .font(WatchV5.number(15))
                        .foregroundStyle(WatchV5.valueMute)
                }

                Spacer(minLength: 0)

                WPageDots(count: pageCount, index: pageIndex)
                    .frame(maxWidth: .infinity)
                    .padding(.top, WatchV5.Metric.readingToStack)
            }
            .frame(maxHeight: .infinity)
        }
    }

    private func barHeight(_ miles: Double) -> CGFloat {
        let peak = days.map(\.miles).max() ?? 0
        guard peak > 0, miles > 0 else { return shortestBar }
        return max(shortestBar, tallestBar * CGFloat(miles / peak))
    }

    /// Today is the ONE lit column, and it is lit in band green — the wrist's
    /// sanctioned colour, on a strip that is a shape rather than a verdict.
    private func barFill(_ state: V5LobbyDayState) -> Color {
        switch state {
        case .done:    return WatchV5.valueDim
        case .today:   return WatchV5.band
        case .planned: return WatchV5.value.opacity(0.20)
        }
    }

    private func letterFill(_ state: V5LobbyDayState) -> Color {
        switch state {
        case .done:    return WatchV5.valueMute
        case .today:   return WatchV5.band
        case .planned: return WatchV5.value.opacity(0.32)
        }
    }
}

// MARK: - Fixtures
//
// The design file's own values, so a preview and a board review are looking at
// the same thing.

enum V5LobbyFixtures {

    /// Pre-run · the easy lobby. Two pages: poster, then week.
    static let easy = V5LobbySession(
        ramp: .easy,
        lede: "Easy",
        dose: "6.0 mi",
        band: "8:15\u{2013}8:45 /mi"
    )

    /// Long · 4 characters. The qualifier takes its own line and the band
    /// still lands last, in the slot the easy lobby puts it.
    static let long = V5LobbySession(
        ramp: .long,
        lede: "Long",
        dose: "16 mi",
        qualifier: "last 3 at marathon pace",
        band: "8:00\u{2013}8:20 /mi"
    )

    /// Threshold · 9 characters, the step that stops the lede hyphenating.
    static let threshold = V5LobbySession(
        ramp: .quality,
        lede: "Threshold",
        dose: "2 \u{00D7} 3 mi\nat 6:52",
        band: "2 mi easy either end"
    )

    /// Intervals · densest in the fleet. Three registers, one glance.
    static let intervals = V5LobbySession(
        ramp: .quality,
        lede: "Intervals",
        dose: "8 \u{00D7} 400 m\nat 5:48",
        band: "90 sec jog between"
    )

    /// Race morning. The only lobby that names the event instead of the
    /// session type, and the goal replaces the band.
    static let race = V5LobbySession(
        ramp: .race,
        lede: "Marathon",
        dose: "26.2 mi",
        band: "Goal 3:29:59",
        bandSub: "8:00 /mi"
    )

    /// The session already moved. The dose that was six miles is four, the
    /// reason is stated once, and the runner still only has to press Start.
    static let readinessMoved = V5LobbySession(
        ramp: .easy,
        lede: "Easy",
        dose: "4 mi",
        note: "Six hours of sleep \u{00B7} was six miles."
    )

    static let racePlan: [V5LobbyStep] = [
        .init(name: "Mi 1\u{2013}6",  value: "8:10"),
        .init(name: "Mi 7\u{2013}20", value: "8:00"),
        .init(name: "Mi 21+",         value: "on feel"),
    ]

    static let sessionSteps: [V5LobbyStep] = [
        .init(name: "Warm-up",         value: "10 min"),
        .init(name: "8 \u{00D7} 400 m", value: "5:48", emphasised: true),
        .init(name: "Jog",             value: "90 sec"),
        .init(name: "Cool-down",       value: "10 min"),
    ]

    /// Mon 5 · Tue 10 · Wed 3 (done) · Thu 7 (today) · Fri 3 · Sat 15 ·
    /// Sun 2 (planned) — 18 of 42 mi, the long one still to come.
    static let week: [V5LobbyDay] = [
        .init(letter: "M", miles:  5, state: .done),
        .init(letter: "T", miles: 10, state: .done),
        .init(letter: "W", miles:  3, state: .done),
        .init(letter: "T", miles:  7, state: .today),
        .init(letter: "F", miles:  3, state: .planned),
        .init(letter: "S", miles: 15, state: .planned),
        .init(letter: "S", miles:  2, state: .planned),
    ]
}

// MARK: - Previews

#Preview("Pre-run") {
    V5LobbyPoster(session: V5LobbyFixtures.easy, pageCount: 2, pageIndex: 0) { }
}

#Preview("Lobby long") {
    V5LobbyPoster(session: V5LobbyFixtures.long, pageCount: 2, pageIndex: 0) { }
}

#Preview("Lobby threshold") {
    V5LobbyPoster(session: V5LobbyFixtures.threshold, pageCount: 3, pageIndex: 0) { }
}

#Preview("Lobby intervals") {
    V5LobbyPoster(session: V5LobbyFixtures.intervals, pageCount: 3, pageIndex: 0) { }
}

#Preview("Lobby race") {
    V5LobbyPoster(session: V5LobbyFixtures.race, pageCount: 3, pageIndex: 0) { }
}

#Preview("Lobby readiness") {
    V5LobbyPoster(session: V5LobbyFixtures.readinessMoved, pageCount: 2, pageIndex: 0) { }
}

#Preview("Lobby page 2 race plan") {
    V5LobbyBreakdown(kicker: "The plan",
                     steps: V5LobbyFixtures.racePlan,
                     footerName: "Gels",
                     footerValue: "8 \u{00B7} 15 \u{00B7} 21",
                     pageCount: 3,
                     pageIndex: 1)
}

#Preview("Lobby page 2 session steps") {
    V5LobbyBreakdown(kicker: "The steps",
                     steps: V5LobbyFixtures.sessionSteps,
                     pageCount: 3,
                     pageIndex: 1)
}

#Preview("Lobby page 3 this week") {
    V5LobbyWeek(days: V5LobbyFixtures.week,
                milesRun: "18",
                milesPlanned: "42",
                pageCount: 3,
                pageIndex: 2)
}

#Preview("Rest day") {
    V5LobbyRefusal(
        lede: "Rest",
        sentence: "Nothing today \u{00B7} you ran 34 miles this week and the long one was Sunday. Resting is the work.",
        escapeLabel: "Run anyway",
        ramp: .rest
    ) { }
}

#Preview("No session") {
    V5LobbyRefusal(
        lede: nil,
        sentence: "Week off \u{00B7} the block resumes Monday. Walk, swim, or do nothing. None of it goes in the book.",
        escapeLabel: "Just run",
        ramp: .noSession
    ) { }
}

#Preview("Countdown") {
    V5LobbyCountdown(ramp: .easy, seconds: 3)
}
