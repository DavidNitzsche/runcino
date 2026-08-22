//
//  StateScreensV5.swift
//  faff.run iPhone · four Today variants where there is nothing to prescribe,
//  or nothing to read.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THESE FOUR ARE BUILT TOGETHER
//
//  13a (injury flare), 14a (week off) and 15a (off-season) are REFUSALS: the
//  engine read the runner's state and the honest answer is "no session
//  today", each for a different reason. 16a (data outage) is NOT a refusal —
//  it is the one screen where the engine could not read something at all.
//  Rule three exists specifically so these four are never drawn the same way:
//
//      13a, 14a   we read it, there is no session, here is why    CoachSay
//      15a        there is nothing honest to say yet              Silence
//      16a        we could not read this                          ErrorNote + Skeleton
//
//  Mixing these up tells the runner the app is broken when it is working
//  (ErrorNote on a refusal), or that it is working when it cannot see
//  (Silence or CoachSay standing in for an outage). Every screen below is
//  built to keep that boundary, not to look tidy.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE ONE AND RULE TWO, AS THEY LAND HERE
//
//  Every number on these four screens comes through `FaffValue` — a dose, a
//  stat-plate value, a row value — so a modelled number cannot reach the
//  screen without its amber tilde. None of the four states below assert a
//  changed SESSION off one signal; 17a (changed overnight) is the screen that
//  carries the three-domain convergence, and it is deliberately not one of
//  these four.
//

import SwiftUI
import Foundation

// MARK: - Shared account sheet
//
// The account sheet's body — runner name, week line, and rows — was
// previously defined once inside `TodayBeforeV5` (the only screen wired to
// open it) and nowhere else: `InjuryFlareV5`, `WeekOffV5`, `OffSeasonV5`,
// `TodayChangedV5` (TodayChangedV5.swift) and `TodayAfterV5` all already
// exposed an `onOpenAccount` closure, but the host never passed anything
// but the `{}` default, so the account button on five screens did nothing.
// Defined once, here, so `TodayHostV5` can present ONE sheet for every
// place-screen branch that isn't `TodayBeforeV5` (which keeps its own,
// using this same struct) rather than five copies of the same list.

struct AccountSheetBodyV5: View {
    let accountName: String
    let accountWeekLine: String
    let accountRows: [V5Row]
    @Binding var isOpen: Bool
    var onRowTap: (V5Row) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            HStack(alignment: .lastTextBaseline, spacing: V5.S.s12) {
                Text(accountName)
                    .font(.faffDisplay(20))
                    .textCase(.uppercase)
                    .tracking(20 * 0.02)
                    .foregroundStyle(V5.textPrimary)
                Spacer(minLength: V5.S.s12)
                Text(accountWeekLine)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
            }
            .padding(.horizontal, V5.S.s4)

            ListGroup {
                ForEach(accountRows) { row in
                    ListRow(label: row.label,
                            sub: row.sub,
                            value: row.value.optionalValue,
                            // Close the sheet FIRST, then hand the tap up, on
                            // a separate tick — a push that happens while the
                            // sheet is still presented lands behind it, and a
                            // push coalesced into the same update as the
                            // dismissal gets dropped. Both look identical on
                            // device: a dead row. See `TodayBeforeV5`, where
                            // this was worked out originally.
                            onTap: row.action != nil ? {
                                withAnimation(V5.Motion.sheet) { isOpen = false }
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                                    onRowTap(row)
                                }
                            } : nil)
                }
            }

            FaffButton("Close", variant: .secondary, size: .lg) {
                withAnimation(V5.Motion.sheet) { isOpen = false }
            }
        }
    }
}

// MARK: - Shared panel header
//
// "Today" + the account button, exactly as the prototype draws it on every
// place screen. Still local to this file — it is the row, not the disc, and
// the four state screens are its only callers. The disc itself comes from the
// kit (`HeaderDiscV5`), which is what stops the fifth copy of it from being
// written here. The fill is the only thing that differs between a quiet panel
// (13a/15a, `--text-primary` on `--material-control`) and a gradient one
// (14a/16a, white on `rgba(255,255,255,.2)`).

private struct PlaceHeaderRow: View {
    @Environment(\.v5PanelInk) private var panelInk
    var onOpenAccount: () -> Void = {}
    var fill: HeaderDiscV5.Fill = .quiet
    /// Placeholder initials — no v5 payload in this file carries the
    /// runner's name. The prototype's own sample data hardcodes "JR" the
    /// same way.
    var initials: String = "JR"

    var body: some View {
        HStack(alignment: .center, spacing: V5.S.s8) {
            Text("Today")
                .font(.faffDisplay(20))
                .textCase(.uppercase)
                .tracking(20 * 0.02)
                .foregroundStyle(fill.ink(panelInk))
            Spacer(minLength: V5.S.s8)
            HeaderDiscV5(glyph: .initials(initials),
                         label: "Account and settings",
                         fill: fill,
                         action: onOpenAccount)
        }
    }
}

// MARK: - Shared scaffolding

/// The scroll band every one of these four screens uses: full-bleed panel
/// first (it escapes the gutter itself), everything else padded to the
/// content band's own gutter. Matches `NotOnPhoneYetV5`'s shape in
/// `ShellV5.swift`, the other screen in this app with nothing to prescribe.
private struct StateScreenScaffold<Panel: View, Body: View>: View {
    @ViewBuilder var panel: () -> Panel
    @ViewBuilder var content: () -> Body

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                panel()
                content()
            }
            .padding(.horizontal, V5.S.gutter)
            .padding(.bottom, V5.S.s24)
        }
        .background(V5.surfacePage)
        .scrollIndicators(.hidden)
    }
}

// MARK: - 13a · Injury flare
//
// A REFUSAL, not an outage: we read the flare and the answer is "not today".
// The panel carries no gradient — `.quiet` — because there is no session to
// prescribe, the same designed-absence the README gives off-season. The
// check-in list is the app's one expand-in-place interaction: tapping a row
// logs the note in that row's own expansion, never on a new screen.

struct InjuryFlareV5: View {
    let model: V5Injury
    var onOpenAccount: () -> Void = {}
    /// Fires when a check-in option is tapped, so the caller can write it
    /// back. This view does not fetch or persist anything itself.
    var onCheckIn: (V5Row) -> Void = { _ in }
    /// The way onward once the flare has cleared — pushes `V5Route.returnToRunning`,
    /// the eight-stage walk-run ladder (19a). Absent (`returnAvailable == false`)
    /// draws nothing rather than a disabled row.
    var onReturnToRunning: () -> Void = {}

    @State private var checkedRowID: String?

    var body: some View {
        StateScreenScaffold {
            DayPanel(fill: .quiet) {
                PlaceHeaderRow(onOpenAccount: onOpenAccount)
                VStack(alignment: .leading, spacing: V5.S.s2) {
                    Text("\(model.area) · \(model.since)")
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textSecondary)
                    Text("Not today")
                        .faffDisplayV5(TypeScaleV5.display44)
                        .foregroundStyle(V5.textPrimary)
                }
            }
        } content: {
            CoachSay(text: model.verdict, size: .md)

            ListGroup(header: "What changed") {
                ForEach(model.whatChanged) { row in
                    ListRow(label: row.label, sub: row.sub, value: row.value.map { $0.value })
                }
            }

            // The prototype draws this as plain tappable rows in one tile,
            // with the logged note as a quiet 13pt line BELOW the tile
            // (13a markup: a `ListRow` per option, then `injury.checkedNote`
            // at `font-size:13px;color:var(--text-secondary);padding:0 4px`).
            //
            // It used to be an `ExpandingRow` whose expanded content was
            // `EmptyView()`, which drew a chevron on a row that had nothing
            // to open — the one affordance the behaviour rules name outright
            // — and put the note inside the row instead of under the group.
            // 19a's ladder check-in already renders the prototype's shape;
            // the README says 19a uses the "same expand-in-place pattern as
            // 13a", so the two now actually match.
            VStack(alignment: .leading, spacing: V5.S.s10) {
                V5SectionLabel(text: "How does it feel today")
                VStack(spacing: 0) {
                    ForEach(model.checkIn) { row in
                        ListRow(label: row.label, sub: row.sub) {
                            checkedRowID = row.id
                            onCheckIn(row)
                        }
                    }
                }
                .background(V5.materialTile,
                            in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))

                if let checked = model.checkIn.first(where: { $0.id == checkedRowID }) {
                    Text(checked.sub ?? "Logged.")
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textSecondary)
                        .padding(.horizontal, V5.S.s4)
                }
            }

            if model.returnAvailable {
                ListGroup(header: "Cleared to return") {
                    ListRow(label: "Return to running",
                            sub: "The eight-stage walk-run ladder",
                            onTap: onReturnToRunning)
                }
            }
        }
    }
}

// MARK: - 14a · Week off
//
// A REFUSAL that is not a flare: a planned break, not an injury. Rest-hue
// gradient panel — this is still a designed day state, just not one with a
// session in it — so it is NOT `.quiet` the way 13a/15a are. Not an apology:
// the coach line states the break as a fact and names what comes back.

struct WeekOffV5: View {
    private var panelInk: V5.PanelInk { PanelFill.state(.rest).ink }
    let model: V5WeekOff
    var onOpenAccount: () -> Void = {}

    private var range: String { Self.formatRange(fromISO: model.fromISO, toISO: model.toISO) }

    var body: some View {
        StateScreenScaffold {
            DayPanel(fill: .state(.rest)) {
                PlaceHeaderRow(onOpenAccount: onOpenAccount, fill: .onPanel)
                VStack(alignment: .leading, spacing: V5.S.s2) {
                    Text(range)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(panelInk.secondary)
                    Text("Week off")
                        .faffDisplayV5(TypeScaleV5.display44)
                        .foregroundStyle(panelInk.primary)
                }
                Text(model.reason)
                    .font(.faffText(TypeScaleV5.body15))
                    .foregroundStyle(panelInk.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } content: {
            CoachSay(text: model.coachLine, size: .md)

            if let nextUp = model.nextUp {
                ListGroup(header: "Next up") {
                    ListRow(label: nextUp.label, sub: nextUp.sub, value: nextUp.value.map { $0.value })
                }
            }
        }
    }

    /// "18 – 24 August" from two `yyyy-MM-dd`-prefixed ISO dates. Falls back
    /// to the raw strings rather than crashing on an unexpected format —
    /// this view never fetches, so a bad payload is not this file's bug to
    /// hide, but it should not take the screen down either.
    static func formatRange(fromISO: String, toISO: String) -> String {
        let iso = DateFormatter()
        iso.calendar = Calendar(identifier: .gregorian)
        iso.timeZone = TimeZone(identifier: "UTC")
        iso.dateFormat = "yyyy-MM-dd"

        guard let from = iso.date(from: String(fromISO.prefix(10))),
              let to = iso.date(from: String(toISO.prefix(10))) else {
            return "\(fromISO) – \(toISO)"
        }

        let cal = Calendar(identifier: .gregorian)
        let day = DateFormatter(); day.dateFormat = "d"
        let dayMonth = DateFormatter(); dayMonth.dateFormat = "d MMMM"

        let sameMonth = cal.component(.month, from: from) == cal.component(.month, from: to)
            && cal.component(.year, from: from) == cal.component(.year, from: to)

        let left = sameMonth ? day.string(from: from) : dayMonth.string(from: from)
        let right = dayMonth.string(from: to)
        return "\(left) – \(right)"
    }
}

// MARK: - 15a · Off-season
//
// THE ONE SCREEN THAT USES `Silence`, NOT `CoachSay`. The README is explicit
// about why: the coach has nothing honest to say about a block that does not
// exist yet, and inventing a sentence to fill the space would be worse than
// leaving it quiet. Do not add a CoachSay here — that is rule three's whole
// point, and this screen is the one most likely to tempt it.

struct OffSeasonV5: View {
    let model: V5OffSeason
    var onOpenAccount: () -> Void = {}

    var body: some View {
        StateScreenScaffold {
            DayPanel(fill: .quiet) {
                PlaceHeaderRow(onOpenAccount: onOpenAccount)
                VStack(alignment: .leading, spacing: V5.S.s2) {
                    if let since = model.sinceLastRace {
                        Text(since)
                            .font(.faffText(TypeScaleV5.label13))
                            .foregroundStyle(V5.textSecondary)
                    }
                    Text("Off-season")
                        .faffDisplayV5(TypeScaleV5.display44)
                        .foregroundStyle(V5.textPrimary)
                }
            }
        } content: {
            Silence(reason: model.silenceReason)

            // "Plan the next block" — RESTORED, with a real handler.
            //
            // It was removed on the reasoning that the prototype specs its
            // onClick as a noop and no route existed, so the row would be a
            // dead end. The first half is true and the second is no longer:
            // the handoff is explicit that the noops in the prototype "need
            // real handlers in the app but their visual design is final", so
            // removing a FINAL screen's only action was a scope decision the
            // design did not make.
            //
            // And there is an honest destination now. On this phone a block is
            // built around a race — that is the whole race-mode premise — so
            // planning the next block IS adding the race it is built toward.
            // `.faffOpenRaceSetup` is the same hop onboarding uses at the end
            // of its own flow, handled at the shell: select Races, push
            // add-a-race. One route, two entry points, no new dead end.
            ListGroup {
                ListRow(label: "Plan the next block",
                        sub: "Pick the race it is built around",
                        onTap: {
                            NotificationCenter.default.post(name: .faffOpenRaceSetup, object: nil)
                        })
            }

            if let weeklyRange = model.weeklyRange {
                ListGroup(header: "This week") {
                    ListRow(label: "Miles", sub: weeklyRange)
                }
            }
        }
    }
}

// MARK: - 16a · Data outage
//
// NOT a screen of its own — the same Today shell, demonstrating the
// network-failure content rules. The panel keeps painting from the last
// payload we could read (today's session is written and stored on the
// phone, so it does not need the network to be right); only the sections
// that actually failed to refresh take the outage treatment. `OutageBodyV5`
// (`SurfaceStoreV5.swift`) already IS that treatment — ErrorNote with retry,
// a height-reserving Skeleton, the on-device coach line — so this view
// composes it rather than re-authoring it.
//
// This is the one screen in the file where `ErrorNote` belongs. Reaching for
// `Alert` or `Silence` here would say "the answer is no" or "nothing honest
// to say" about a session that is, in fact, sitting on the phone right now.

struct DataOutageV5: View {
    private var panelInk: V5.PanelInk { today.panel.fill.ink }
    /// The last Today payload we could read — `V5Surface.model` when
    /// `stale == true`. The panel is real content, not a placeholder: the
    /// outage is in readiness and the weekly stats, not in today's session.
    let today: V5Today
    let onRetry: () -> Void
    var onOpenAccount: () -> Void = {}

    var body: some View {
        StateScreenScaffold {
            DayPanel(fill: today.panel.fill) {
                PlaceHeaderRow(onOpenAccount: onOpenAccount, fill: .onPanel)
                VStack(alignment: .leading, spacing: V5.S.s20) {
                    VStack(alignment: .leading, spacing: V5.S.s2) {
                        if let kicker = today.panel.kicker {
                            Text(kicker)
                                .font(.faffText(TypeScaleV5.label13))
                                .foregroundStyle(panelInk.secondary)
                        }
                        Text(today.panel.type)
                            .faffDisplayV5(TypeScaleV5.display56)
                            .foregroundStyle(panelInk.primary)
                    }
                    if let dose = today.panel.dose {
                        FaffValueText(dose.value, font: .faffText(28, weight: .semibold),
                                      color: panelInk.primary)
                    }
                }
                if !today.panel.stats.isEmpty {
                    PanelStatPlate(stats: today.panel.stats.map {
                        PanelStat($0.label, $0.value.value,
                                  ink: $0.toneValue.inkOverride)
                    })
                }
            }
        } content: {
            VStack(alignment: .leading, spacing: V5.S.inGroup) {
                V5SectionLabel(text: "Readiness")
                OutageBodyV5(onRetry: onRetry)
            }
        }
    }
}

// MARK: - Previews
//
// Built from the prototype's own sample data (`INJURY`, `WEEK_OFF`,
// `OFF_SEASON`, and the `easy` day for 16a's cached panel), decoded through
// the real wire types rather than constructed by hand — so a preview that
// compiles is also proof the JSON shape round-trips.

private func decode<T: Decodable>(_ type: T.Type, _ json: String) -> T {
    do {
        return try JSONDecoder().decode(T.self, from: Data(json.utf8))
    } catch {
        fatalError("StateScreensV5 sample failed to decode \(T.self): \(error)")
    }
}

extension V5Injury {
    static let sampleV5: V5Injury = decode(V5Injury.self, """
    {
      "area": "Left calf",
      "since": "Flagged 2 days ago",
      "verdict": "Rest, not run \\u00b7 the calf gets three days to settle before anything reintroduces load.",
      "whatChanged": [
        { "id": "this-week", "label": "This week", "sub": "12 mi this week, walking and easy cross-training only.", "value": null, "action": null }
      ],
      "checkIn": [
        { "id": "better", "label": "Better today", "sub": "Loosen back in gradually tomorrow", "value": null, "action": "checkin" },
        { "id": "same", "label": "About the same", "sub": "One more day off, then reassess", "value": null, "action": "checkin" },
        { "id": "worse", "label": "Worse", "sub": "Worth a call with someone who can look at it", "value": null, "action": "checkin" }
      ],
      "returnAvailable": true
    }
    """)
}

extension V5WeekOff {
    static let sampleV5: V5WeekOff = decode(V5WeekOff.self, """
    {
      "reason": "Travel \\u00b7 Denver, altitude and no motivation to chase miles",
      "fromISO": "2026-08-18",
      "toISO": "2026-08-24",
      "coachLine": "A zero week goes in the book \\u00b7 the plan resumes where you are, not where the calendar says.",
      "nextUp": { "id": "monday", "label": "Monday \\u00b7 Easy, 4 mi", "sub": null, "value": null, "action": null }
    }
    """)
}

extension V5OffSeason {
    static let sampleV5: V5OffSeason = decode(V5OffSeason.self, """
    {
      "sinceLastRace": "Since CIM \\u00b7 3 weeks ago",
      "silenceReason": "No block is written. Running is optional, and nothing here is measured against a goal.",
      "weeklyRange": "0 \\u2013 20 mi, whatever feels good"
    }
    """)
}

extension V5Today {
    /// A cached "before run, easy day" payload — 16a's own panel content
    /// while readiness and the weekly stats are what failed to refresh.
    static let sampleOutageV5: V5Today = decode(V5Today.self, """
    {
      "dateISO": "2026-08-20",
      "state": "before_run",
      "panel": {
        "dayState": "easy",
        "quiet": false,
        "place": "Today",
        "dateLine": "Thursday 20 August",
        "weekLine": "Week 6 of 16",
        "kicker": "55\\u00b0F \\u00b7 light rain, no wind \\u00b7 about 54 min",
        "type": "Easy",
        "dose": { "text": "6 mi", "modelled": false },
        "stats": []
      },
      "weekStrip": [],
      "groups": [],
      "whereYouAre": [],
      "beforeYouGo": [],
      "askedVsRan": [],
      "whatThisDidToTheWeek": []
    }
    """)
}

#Preview("13a · Injury flare") {
    InjuryFlareV5(model: .sampleV5)
        .preferredColorScheme(.dark)
}

#Preview("14a · Week off") {
    WeekOffV5(model: .sampleV5)
        .preferredColorScheme(.dark)
}

#Preview("15a · Off-season") {
    OffSeasonV5(model: .sampleV5)
        .preferredColorScheme(.dark)
}

#Preview("16a · Data outage") {
    DataOutageV5(today: .sampleOutageV5, onRetry: {})
        .preferredColorScheme(.dark)
}

// MARK: - 8c · A race, twenty minutes after it finished
//
// The receiving end of the watch's race-day finish, and the one screen in the
// app whose whole job is to REFUSE TO PROMOTE A NUMBER.
//
// The runner has just crossed a line holding a time they desperately want to
// be real. It is a watch clock: started by a thumb, stopped by a thumb, over a
// GPS distance that is not the certified course. The chip time will move it —
// by seconds, not minutes, which is exactly the size of thing worth saying out
// loud rather than hiding.
//
// So the screen holds the number without letting it become the result, and it
// does that without feeling like it is withholding:
//
//   · THE WATCH TIME IS IN THE VALUE REGISTER, NEVER THE DISPLAY REGISTER.
//     Display is where real results go. A watch clock set in 56pt Archivo
//     would BE a result, whatever the label beside it said, because the type
//     is the claim. 28pt in the value register with "on the watch" beside it
//     is a phrase the runner can interpret, which is the rule the whole
//     screen is built on: never a value the runner cannot interpret.
//
//   · IT CARRIES THE MARK. `FaffValue.modelled` puts the amber tilde on it —
//     rule one's own mechanism rather than a bespoke colour. The addendum
//     draws the figure itself in `#F2B03C`, which worked when this panel had
//     white ink; round three has since given the race ramp DARK ink, and
//     amber-on-amber is unreadable. The tilde says provisional and the figure
//     stays legible, which is what the colour was for.
//
//   · THE STATS PLATE DOES NOT REPEAT IT. Goal, margin and average pace are
//     three quantities that only make sense together. Printing the watch time
//     a second time would be the screen arguing with itself about how
//     important that number is.
//
//   · NO BUTTON THAT CANNOT BE HONOURED. There is no "lock in chip time"
//     here, because there is no chip time to lock. That row appears days
//     later in the Races table. A control that cannot do its job is worse
//     than no control — it invites a tap and answers with nothing.
struct RaceJustFinishedV5: View {
    private var panelInk: V5.PanelInk { PanelFill.state(.race).ink }

    let model: V5RaceJustFinished
    var onOpenAccount: () -> Void = {}

    var body: some View {
        StateScreenScaffold {
            DayPanel(fill: .state(.race)) {
                PlaceHeaderRow(onOpenAccount: onOpenAccount, fill: .onPanel)

                VStack(alignment: .leading, spacing: V5.S.s2) {
                    Text(model.kicker)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(panelInk.secondary)
                    Text(model.distanceLabel)
                        .faffDisplayV5(TypeScaleV5.display56)
                        .foregroundStyle(panelInk.primary)
                }

                // The number, held at arm's length.
                HStack(alignment: .firstTextBaseline, spacing: V5.S.s8) {
                    FaffValueText(.modelled(model.watchTime),
                                  font: .faffText(TypeScaleV5.valueMin, weight: .semibold),
                                  color: panelInk.primary,
                                  // THE MARK IS THE WHOLE SCREEN. This is the
                                  // number the runner wants to be real, and
                                  // the tilde is the only thing saying it is
                                  // not. In amber it sat on the race ramp's
                                  // own hue and could not be seen.
                                  mark: panelInk.mark)
                    Text("on the watch")
                        .font(.faffText(TypeScaleV5.body15))
                        .foregroundStyle(panelInk.secondary)
                }

                if !model.stats.isEmpty {
                    PanelStatPlate(stats: model.stats)
                }
            }
        } content: {
            CoachSay(text: model.coachLine, size: .md)

            // Two STATEMENTS, no chevrons. Nothing here opens, and a chevron
            // on a row with nothing behind it is a promise the screen cannot
            // keep.
            ListGroup(header: "Chip time") {
                // THE QUALIFIER IS AMBER, AND IT IS A RIGHT-HAND VALUE.
                //
                // 8c draws "Not published yet" on the left with "We check
                // hourly" on the right in amber. Built as a plain sub-line it
                // lost both the position and the colour.
                //
                // Amber is right here and it is NOT the amber that had to be
                // dropped from the panel: a result that is not published yet
                // is stale evidence, which is exactly what amber means. And
                // this row sits BELOW the panel, on the black page, where the
                // ramp's dark ink does not reach and amber-on-amber cannot
                // happen.
                ListRow(label: model.chipStatus,
                        value: model.chipSub.map { FaffValue.measured($0) },
                        valueInk: V5.attention)
                // WAS: "Nothing goes in the book today" over "The watch time
                // never becomes the result."
                //
                // Two denials stacked — "Nothing", then "never" — in the one
                // row on the one screen whose brief is to hold the number
                // WITHOUT feeling like it is withholding. The facts were
                // right and the grammar was doing the opposite job: the label
                // led on what the runner does not get, and the only sentence
                // giving the watch time any standing was the second half of
                // the sub.
                //
                // The same two facts, stated forward. "Stands in" is the
                // whole ruling in two words — real enough to work with, not
                // the one that counts — which is exactly what the register
                // upstairs already says by putting it in the value register
                // with a tilde on it.
                ListRow(label: "The book waits for the chip",
                        sub: "The watch time stands in until it lands. The official one is what goes on the record.")
            }

            ListGroup(header: "The rest of the week") {
                ListRow(label: "Tomorrow", value: .measured(model.tomorrow))
                ListRow(label: "Back in the plan", value: .measured(model.backInPlan))
            }

            CoachCaveat(text: "This week is for absorbing it, not chasing it.")
        }
    }
}

/// What 8c needs. Deliberately small: every field is something the backend
/// already knows the moment a race result lands, and nothing here is derived
/// on the phone.
struct V5RaceJustFinished: Equatable {
    /// "Crossed the line 22 minutes ago" — composed server-side, because the
    /// phone would have to guess a timezone to say it.
    let kicker: String
    /// "Half marathon".
    let distanceLabel: String
    /// The watch clock, as text. Always rendered modelled.
    let watchTime: String
    /// Goal / margin / average — three quantities that only read together.
    let stats: [PanelStat]
    let coachLine: String
    /// "Not published yet" / "Provisional result posted".
    let chipStatus: String
    /// "We check hourly".
    let chipSub: String?
    let tomorrow: String
    let backInPlan: String
}

extension V5RaceJustFinished {
    /// 8c's own drawn content, verbatim from the addendum. Sample data, the
    /// same way every other screen in `ScreensCatalogV5` is sampled — this is
    /// what makes the screen reviewable while it still has no production
    /// route, and the absence of exactly this is why it went unnoticed that
    /// nothing could reach it.
    static let sampleV5 = V5RaceJustFinished(
        kicker: "Crossed the line 22 minutes ago",
        distanceLabel: "Half",
        watchTime: "1:29:44",
        stats: [
            PanelStat("Goal", .measured("1:32:00")),
            PanelStat("Inside by", .measured("2:16")),
            PanelStat("Average", .measured("6:51 /mi")),
        ],
        coachLine: "You went under it. The chip will move that by seconds, not minutes \u{00B7} so hold the feeling and let the result catch up.",
        chipStatus: "Not published yet",
        chipSub: "We check hourly",
        tomorrow: "Nothing",
        backInPlan: "Thursday")
}

#Preview("8c \u{00B7} Race, twenty minutes after") {
    RaceJustFinishedV5(model: .sampleV5)
        .preferredColorScheme(.dark)
}
