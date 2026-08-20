//
//  TodayBeforeV5.swift
//  faff.run iPhone · screen 5a, "Today — before the run".
//
//  The day's prescription. A full-bleed day-state panel (place label, calendar
//  and account buttons, date/week line, the 7-day strip, kicker, session type,
//  dose, a translucent stats plate), then the instruction groups (Warm up /
//  Work / Cool down), a "Why this run" coach line, "Where you are", and
//  "Before you go" — shoes, fuel, move/skip, each expanding in place.
//
//  This file does not fetch. `model: V5Today` arrives already resolved — the
//  composition root owns `V5Surface<V5Today>` (see `SurfaceStoreV5.swift`) and
//  the outage/cold-start states it renders in this screen's place. This view
//  renders one thing: a `V5Today` whose `state == .beforeRun`.
//
//  ─────────────────────────────────────────────────────────────────────────
//  A CONTRACT GAP, AND HOW THIS FILE WORKS AROUND IT WITHOUT BLOCKING
//
//  "Before you go" rows (`V5Today.beforeYouGo: [V5Row]`) are flat — one row
//  per pickable thing (shoes, fuel, move/skip), each with a label/sub/value
//  and an `action` verb. `V5Row` carries no nested option list, so the wire
//  contract alone cannot say which shoe pairs exist or what the move/skip
//  choices are (see BUILD-PLAN.md's backend-gaps table — this is the same
//  shape of gap as B1/B9, just not yet itemised there for Today specifically).
//
//  Rather than inventing fields on `APIV5.swift` (frozen — "You are almost
//  certainly not adding a component", and never a screen's job to redefine the
//  contract), this screen takes the option list for a row as data the caller
//  already has in hand, exactly the way `FaffSelect` takes `options: [String]`
//  directly rather than fetching them: `beforeYouGoOptions: (V5Row) -> [TodayBeforeGoOption]`.
//  Selecting one calls back `onSelectBeforeYouGoOption` and the caller does the
//  actual mutation (through the backend's `mutatePlan` boundary) and re-renders
//  with a fresh `model`. A row with no options renders its expansion with
//  nothing to choose rather than failing — the row still opens; it is just
//  empty until that endpoint exists, per "a screen is never blocked on a route".
//
//  The same gap, and the same fix, applies to the account sheet's rows and the
//  calendar's weeks: neither is part of `V5Today`, so both come in as plain
//  parameters rather than being fetched here.
//

import SwiftUI

// MARK: - Screen-local data the wire contract does not carry

/// One choice inside an expanded "Before you go" row — a shoe in the shoes
/// picker, a move/skip option. See the file header: `V5Row` has no nested
/// option list on the wire, so the caller supplies these directly.
struct TodayBeforeGoOption: Identifiable, Equatable {
    let id: String
    let label: String
    let sub: String?
    let value: FaffValue?

    init(id: String, label: String, sub: String? = nil, value: FaffValue? = nil) {
        self.id = id
        self.label = label
        self.sub = sub
        self.value = value
    }
}

/// One day row in the calendar sheet. Read-only in the prototype — no day row
/// carries an `onClick` there, so this type carries no action either.
struct TodayCalendarDay: Identifiable, Equatable {
    let id: String
    let label: String
    let sub: String
    let status: FaffValue?
    let isToday: Bool

    init(id: String, label: String, sub: String, status: FaffValue? = nil, isToday: Bool = false) {
        self.id = id
        self.label = label
        self.sub = sub
        self.status = status
        self.isToday = isToday
    }
}

/// One week's group in the calendar sheet.
struct TodayCalendarWeek: Identifiable, Equatable {
    let id: String
    /// The `ListGroup` header — "This week", "Week 7".
    let range: String
    /// The `ListGroup` footer — "34 of 44 mi".
    let sub: String?
    let days: [TodayCalendarDay]

    init(id: String, range: String, sub: String? = nil, days: [TodayCalendarDay]) {
        self.id = id
        self.range = range
        self.sub = sub
        self.days = days
    }
}

// MARK: - The screen

struct TodayBeforeV5: View {
    let model: V5Today

    // Account sheet content. Not part of `V5Today` — see file header.
    let accountName: String
    let accountWeekLine: String
    let accountRows: [V5Row]

    // Calendar sheet content. Not part of `V5Today` either.
    let calendarWeeks: [TodayCalendarWeek]

    // The options behind an expanding "Before you go" row, and what happens
    // when one is picked. Both default to no-ops so a caller wiring only the
    // read path still compiles and renders (an empty expansion, not a crash).
    var beforeYouGoOptions: (V5Row) -> [TodayBeforeGoOption] = { _ in [] }
    var onSelectBeforeYouGoOption: (V5Row, TodayBeforeGoOption) -> Void = { _, _ in }

    /// A "Where you are" row with an `action` was tapped. Readiness's own
    /// expansion (the prototype's Sleep/Resting-heart detail) is state the
    /// wire contract does not carry either (see file header) — the caller
    /// decides what, if anything, happens.
    var onWhereYouAreRowTap: (V5Row) -> Void = { _ in }

    /// An account-sheet row with an `action` was tapped — e.g. the "start
    /// runs from this phone" switch.
    var onAccountRowTap: (V5Row) -> Void = { _ in }
    /// A day in the week strip was tapped. The id is the plan row's server id
    /// (or a `date:`-prefixed key for a synthesised rest day) — the caller
    /// resolves it to a date and reloads. Identity is never the date itself.
    var onPickDay: (String) -> Void = { _ in }
    /// Set when the runner has stepped off today. The panel says which day and
    /// offers the way back.
    var viewingDayLabel: String? = nil
    var onPrevDay: () -> Void = {}
    var onNextDay: () -> Void = {}
    var onBackToToday: () -> Void = {}

    @State private var calendarOpen = false
    @State private var accountOpen = false
    @State private var expandedBeforeRowID: String? = nil

    var body: some View {
        ZStack {
            ScrollView {
                VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                    panel
                    groupsSection
                    whySection
                    whereYouAreSection
                    beforeYouGoSection
                }
                .padding(.horizontal, V5.S.gutter)
                .padding(.bottom, V5.S.s24)
            }
            .background(V5.surfacePage)
            .scrollIndicators(.hidden)

            if calendarOpen {
                calendarSheet
                    .transition(.opacity)
                    .zIndex(6)
            }

            V5SheetHost(isPresented: $accountOpen) {
                accountSheetBody
            }
            .zIndex(5)
        }
    }

    // MARK: - Panel

    private var panel: some View {
        DayPanel(fill: model.panel.fill) {
            HStack(alignment: .center, spacing: V5.S.s8) {
                // The place label tells the truth about which day is on
                // screen. A screen headed TODAY showing Tuesday is a lie, so
                // when the runner steps off today it says which day, and the
                // way back is right there.
                Text(viewingDayLabel ?? model.panel.place)
                    .font(.faffDisplay(20))
                    .textCase(.uppercase)
                    .tracking(20 * 0.02)
                    .foregroundStyle(V5.OnPanel.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                if viewingDayLabel != nil {
                    Button(action: onBackToToday) {
                        Text("Today")
                            .font(.faffText(TypeScaleV5.label12, weight: .semibold))
                            .foregroundStyle(V5.OnPanel.primary)
                            .padding(.horizontal, V5.S.s10)
                            .frame(height: 26)
                            .background(V5.OnPanel.control, in: Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(V5PressStyle())
                }

                Spacer(minLength: V5.S.s8)

                HStack(spacing: V5.S.s6) {
                    // Step a day at a time. The strip covers this week; these
                    // are how the runner leaves it.
                    panelHeaderButton(systemImage: "chevron.left", action: onPrevDay)
                    panelHeaderButton(systemImage: "chevron.right", action: onNextDay)
                    panelHeaderButton(systemImage: "calendar") {
                        withAnimation(V5.Motion.fill) { calendarOpen = true }
                    }
                    panelHeaderButton(systemImage: avatarInitials.isEmpty ? "person" : nil,
                                      text: avatarInitials.isEmpty ? nil : avatarInitials) {
                        withAnimation(V5.Motion.sheet) { accountOpen = true }
                    }
                }
            }

            HStack(alignment: .lastTextBaseline, spacing: V5.S.s12) {
                Text(model.panel.dateLine)
                    .faffDisplayV5(26, fit: .free)
                    .foregroundStyle(V5.OnPanel.primary)
                if let weekLine = model.panel.weekLine {
                    Text(weekLine)
                        .font(.faffText(TypeScaleV5.body15))
                        .foregroundStyle(V5.OnPanel.secondary)
                }
                Spacer(minLength: 0)
            }

            WeekStripV5(days: model.weekStrip.map(\.strip),
                        onTap: { day in onPickDay(day.id) })

            VStack(alignment: .leading, spacing: 2) {
                if let kicker = model.panel.kicker {
                    Text(kicker)
                        .font(.faffText(TypeScaleV5.body15))
                        .foregroundStyle(V5.OnPanel.secondary)
                }
                Text(model.panel.type)
                    .faffDisplayV5(TypeScaleV5.display56)
                    .foregroundStyle(V5.OnPanel.primary)
            }

            FaffValueText(model.panel.dose.unreadableIfAbsent,
                          font: .faffText(28, weight: .semibold),
                          color: V5.OnPanel.primary)

            PanelStatPlate(stats: model.panel.stats.map { stat in
                PanelStat(stat.label, stat.value.value,
                          ink: stat.tone == "attention" ? V5.attention : nil)
            })
        }
    }

    private var avatarInitials: String {
        // Initials when we know the name. A person glyph when we do not —
        // never an empty disc, which is what a blank name rendered and what
        // reads on device as a control that failed to load.
        let letters = accountName.split(separator: " ").prefix(2).compactMap(\.first)
        return letters.isEmpty ? "" : String(letters).uppercased()
    }

    private func panelHeaderButton(systemImage: String? = nil, text: String? = nil,
                                   action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Group {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 14, weight: .semibold))
                } else {
                    Text(text ?? "")
                        .font(.faffText(12, weight: .semibold))
                }
            }
            .foregroundStyle(V5.OnPanel.primary)
            .frame(width: V5.Shell.headerButton, height: V5.Shell.headerButton)
            .background(V5.OnPanel.control, in: Circle())
        }
        .buttonStyle(V5PressStyle())
    }

    // MARK: - Instruction groups (Warm up / Work / Cool down)

    private var groupsSection: some View {
        VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
            ForEach(Array(model.groups.enumerated()), id: \.element.id) { index, group in
                groupSection(group, index: index, count: model.groups.count)
            }
        }
    }

    /// Bookend groups (Warm up, Cool down) render quiet; an inner group (the
    /// work itself) renders as a tinted tile. A single group — an easy day's
    /// whole run, a race's whole race — renders tinted too. The prototype's
    /// sample data carries this as an explicit `tone` per group, but
    /// `V5Group` has no such field on the wire; this is the same shape
    /// inferred from position instead, since a group's place among its
    /// siblings (first/last vs. the middle) is exactly what "warm up and cool
    /// down bracket the work" means. Flagged in the report as a gap worth
    /// closing on the server (an explicit `tone`) rather than inferred here.
    private func groupSection(_ group: V5Group, index: Int, count: Int) -> some View {
        let hue = count <= 1 ? true : (index != 0 && index != count - 1)
        return VStack(alignment: .leading, spacing: V5.S.s10) {
            HStack(alignment: .lastTextBaseline, spacing: V5.S.s12) {
                V5SectionLabel(text: group.title, color: hue ? V5.textPrimary : V5.textQuiet)
                Spacer(minLength: V5.S.s12)
                if let note = group.note, !note.isEmpty {
                    Text(note)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textQuiet)
                }
            }
            .padding(.horizontal, V5.S.s4)

            groupTile(group, hue: hue)
        }
    }

    private func groupTile(_ group: V5Group, hue: Bool) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s12) {
            ForEach(group.steps) { step in
                HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
                    Text(step.main)
                        .font(.faffText(TypeScaleV5.body15))
                        .foregroundStyle(V5.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let sub = step.sub {
                        FaffValueText(sub.value, font: .faffText(TypeScaleV5.body15), color: V5.textSecondary)
                            .multilineTextAlignment(.trailing)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(hue ? V5.S.s16 : 0)
        .padding(.horizontal, hue ? 0 : V5.S.s4)
        .background(hue ? V5.materialTile : Color.clear,
                    in: RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
    }

    // MARK: - Why this run

    @ViewBuilder
    private var whySection: some View {
        if let why = model.why, !why.isEmpty {
            VStack(alignment: .leading, spacing: V5.S.s10) {
                V5SectionLabel(text: "Why this run", color: V5.textSecondary)
                CoachSay(text: why, size: .md)
            }
        }
    }

    // MARK: - Where you are

    private var whereYouAreSection: some View {
        ListGroup(header: "Where you are") {
            ForEach(model.whereYouAre) { row in
                ListRow(label: row.label,
                        sub: row.sub,
                        value: row.value.optionalValue,
                        onTap: row.action != nil ? { onWhereYouAreRowTap(row) } : nil)
            }
        }
    }

    // MARK: - Before you go

    private var beforeYouGoSection: some View {
        ListGroup(header: "Before you go") {
            ForEach(model.beforeYouGo) { row in
                if row.action == nil {
                    // No action, no chevron, no expansion — a purely
                    // informational row like the race-day fuel line.
                    ListRow(label: row.label, sub: row.sub, value: row.value.optionalValue)
                } else {
                    ExpandingRow(label: row.label,
                                 sub: row.sub,
                                 value: row.value.optionalValue,
                                 question: row.label,
                                 isExpanded: expandedBinding(for: row.id)) {
                        beforeYouGoExpansion(for: row)
                    }
                }
            }
        }
    }

    private func expandedBinding(for id: String) -> Binding<Bool> {
        Binding(
            get: { expandedBeforeRowID == id },
            set: { isExpanded in
                expandedBeforeRowID = isExpanded ? id : (expandedBeforeRowID == id ? nil : expandedBeforeRowID)
            }
        )
    }

    @ViewBuilder
    private func beforeYouGoExpansion(for row: V5Row) -> some View {
        let options = beforeYouGoOptions(row)
        if options.isEmpty {
            Text("Nothing to change here yet.")
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textQuiet)
        } else {
            VStack(spacing: V5.S.s6) {
                ForEach(options) { option in
                    Button {
                        onSelectBeforeYouGoOption(row, option)
                        withAnimation(V5.Motion.expand) { expandedBeforeRowID = nil }
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
                            VStack(alignment: .leading, spacing: V5.S.s2) {
                                Text(option.label)
                                    .font(.faffText(16, weight: .medium))
                                    .foregroundStyle(V5.textPrimary)
                                if let sub = option.sub {
                                    Text(sub)
                                        .font(.faffText(TypeScaleV5.label13))
                                        .foregroundStyle(V5.textQuiet)
                                }
                            }
                            Spacer(minLength: V5.S.s8)
                            if let value = option.value {
                                FaffValueText(value, font: .faffText(TypeScaleV5.body15), color: V5.textSecondary)
                            }
                        }
                        .padding(.horizontal, V5.S.s14x)
                        .frame(minHeight: 48)
                        .frame(maxWidth: .infinity)
                        .background(V5.materialTile,
                                    in: RoundedRectangle(cornerRadius: V5.R.r16, style: .continuous))
                    }
                    .buttonStyle(V5PressStyle())
                }
            }
        }
    }

    // MARK: - Calendar sheet

    private var calendarSheet: some View {
        VStack(spacing: 0) {
            AppBar(title: "Training calendar", onBack: {
                withAnimation(V5.Motion.fill) { calendarOpen = false }
            })
            ScrollView {
                VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                    ForEach(calendarWeeks) { week in
                        ListGroup(header: week.range, footer: week.sub) {
                            ForEach(week.days) { day in
                                ListRow(label: day.label, sub: day.sub, value: day.status, raised: day.isToday)
                            }
                        }
                    }
                }
                .padding(.horizontal, V5.S.gutter)
                .padding(.bottom, V5.S.s24)
            }
            .scrollIndicators(.hidden)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(V5.surfacePage)
        .ignoresSafeArea(edges: .top)
    }

    // MARK: - Account sheet
    //
    // The body is `AccountSheetBodyV5` (`StateScreensV5.swift`) — this used
    // to be defined here inline as the ONLY copy, until every other place
    // screen's account button turned out to need the identical sheet and
    // there was nowhere to reuse it from. Extracted so `TodayHostV5` can
    // present the same list for the other branches without a second
    // definition; this screen keeps owning its own `accountOpen` state and
    // `V5SheetHost` placement, since those are specific to its own layout
    // (the calendar sheet shares the same z-stack).

    private var accountSheetBody: some View {
        AccountSheetBodyV5(accountName: accountName,
                            accountWeekLine: accountWeekLine,
                            accountRows: accountRows,
                            isOpen: $accountOpen,
                            onRowTap: onAccountRowTap)
    }
}

// MARK: - Preview

#Preview("5a · Today, before the run") {
    TodayBeforeV5(
        model: .sampleBeforeRun,
        accountName: "Jamie Rowe",
        accountWeekLine: "Week 6 of 16",
        accountRows: TodayBeforeV5Sample.accountRows,
        calendarWeeks: TodayBeforeV5Sample.calendarWeeks,
        beforeYouGoOptions: TodayBeforeV5Sample.options(for:)
    )
    .preferredColorScheme(.dark)
}

// MARK: - Sample data
//
// Built from the prototype's own `DAYS.easy` fixture in
// `docs/design/iphone-v5/reference/screens/_script-data.js`, decoded through
// `V5Today` itself (via JSON, not a parallel initialiser) so the preview
// exercises the exact same decode path the real API response goes through.

enum TodayBeforeV5Sample {

    static let accountRows: [V5Row] = [
        V5Row(id: "phone-run", label: "Start runs from this phone",
              sub: "RUN sits in the bottom bar", value: V5Number(text: "On", modelled: false),
              action: "toggle-phone-run"),
        V5Row(id: "units", label: "Units", sub: "Pace in minutes per mile",
              value: V5Number(text: "Miles", modelled: false), action: nil),
        V5Row(id: "coach", label: "Coach", sub: "Honest, no cheerleading",
              value: V5Number(text: "As is", modelled: false), action: nil)
    ]

    static let calendarWeeks: [TodayCalendarWeek] = [
        TodayCalendarWeek(id: "this-week", range: "This week", sub: "34 of 44 mi", days: [
            TodayCalendarDay(id: "date:2026-08-17", label: "Mon 17", sub: "Rest day", status: .measured("Done")),
            TodayCalendarDay(id: "pw-2026-08-18", label: "Tue 18", sub: "Easy · 5 mi", status: .measured("Done")),
            TodayCalendarDay(id: "pw-2026-08-19", label: "Wed 19", sub: "Threshold · 2 × 3 mi", status: .measured("Done")),
            TodayCalendarDay(id: "pw-2026-08-20", label: "Thu 20", sub: "Easy · 6 mi", status: .measured("Today"), isToday: true),
            TodayCalendarDay(id: "pw-2026-08-21", label: "Fri 21", sub: "Easy · 5 mi"),
            TodayCalendarDay(id: "date:2026-08-22", label: "Sat 22", sub: "Rest day"),
            TodayCalendarDay(id: "pw-2026-08-23", label: "Sun 23", sub: "Long · 16 mi")
        ]),
        TodayCalendarWeek(id: "week-7", range: "Week 7", sub: "34 mi planned · cutback", days: [
            TodayCalendarDay(id: "pw-2026-08-24", label: "Mon 24", sub: "Easy · 4 mi"),
            TodayCalendarDay(id: "date:2026-08-25", label: "Tue 25", sub: "Rest day"),
            TodayCalendarDay(id: "pw-2026-08-26", label: "Wed 26", sub: "Threshold · 2 × 2 mi"),
            TodayCalendarDay(id: "pw-2026-08-27", label: "Thu 27", sub: "Easy · 4 mi"),
            TodayCalendarDay(id: "date:2026-08-28", label: "Fri 28", sub: "Rest day"),
            TodayCalendarDay(id: "date:2026-08-29", label: "Sat 29", sub: "Rest day"),
            TodayCalendarDay(id: "pw-2026-08-30", label: "Sun 30", sub: "Long · 13 mi")
        ]),
        TodayCalendarWeek(id: "week-8", range: "Week 8", sub: "46 mi planned · quality returns", days: [
            TodayCalendarDay(id: "pw-2026-08-31", label: "Mon 31", sub: "Easy · 5 mi"),
            TodayCalendarDay(id: "date:2026-09-01", label: "Tue 1", sub: "Rest day"),
            TodayCalendarDay(id: "pw-2026-09-02", label: "Wed 2", sub: "Threshold · 3 × 2 mi"),
            TodayCalendarDay(id: "pw-2026-09-03", label: "Thu 3", sub: "Easy · 6 mi"),
            TodayCalendarDay(id: "pw-2026-09-04", label: "Fri 4", sub: "Easy · 5 mi"),
            TodayCalendarDay(id: "date:2026-09-05", label: "Sat 5", sub: "Rest day"),
            TodayCalendarDay(id: "pw-2026-09-06", label: "Sun 6", sub: "Long · 17 mi")
        ])
    ]

    /// The "Before you go" pickers this preview knows how to answer, keyed by
    /// `V5Row.id`. A real caller would build this from whatever endpoint ends
    /// up serving shoe rotation / move-or-skip choices — see the file header.
    static func options(for row: V5Row) -> [TodayBeforeGoOption] {
        switch row.id {
        case "shoes":
            return [
                TodayBeforeGoOption(id: "shoe-0", label: "Endorphin Speed 4", sub: "214 mi on them"),
                TodayBeforeGoOption(id: "shoe-1", label: "Novablast 5", sub: "386 mi on them", value: .measured("Wearing")),
                TodayBeforeGoOption(id: "shoe-2", label: "Vaporfly 3", sub: "58 mi on them")
            ]
        case "move":
            return [
                TodayBeforeGoOption(id: "move-fri", label: "Move to Friday", sub: "Friday is empty"),
                TodayBeforeGoOption(id: "move-sat", label: "Move to Saturday", sub: "Sits before Sunday’s long run"),
                TodayBeforeGoOption(id: "skip", label: "Skip it", sub: "The week loses 6 mi")
            ]
        default:
            return []
        }
    }
}

extension V5Today {

    /// Screen 5a's sample, decoded from the same shape `GET /api/v5/today`
    /// returns — see `DAYS.easy` in `_script-data.js` for the source copy.
    static let sampleBeforeRun: V5Today = {
        try! JSONDecoder().decode(V5Today.self, from: Data(sampleBeforeRunJSON.utf8))
    }()

    private static let sampleBeforeRunJSON = """
    {
      "dateISO": "2026-08-20",
      "state": "before_run",
      "panel": {
        "dayState": "easy",
        "quiet": false,
        "place": "Today",
        "dateLine": "Thursday 20 August",
        "weekLine": "Week 6 of 16 \\u00b7 Base",
        "kicker": "about 54 min \\u00b7 55\\u00b0F light rain, no wind",
        "type": "Easy",
        "dose": { "text": "6 mi", "modelled": false },
        "stats": [
          { "label": "Pace band", "value": { "text": "8:50 \\u00b7 9:35", "modelled": false }, "tone": null },
          { "label": "Ceiling", "value": { "text": "146 bpm", "modelled": false }, "tone": null },
          { "label": "Effort", "value": { "text": "3 of 10", "modelled": false }, "tone": null }
        ]
      },
      "weekStrip": [
        { "id": "date:2026-08-17", "dateISO": "2026-08-17", "letter": "M", "number": "17", "dayState": "rest", "isToday": false, "isDone": true, "isRest": true },
        { "id": "pw-2026-08-18", "dateISO": "2026-08-18", "letter": "T", "number": "18", "dayState": "easy", "isToday": false, "isDone": true, "isRest": false },
        { "id": "pw-2026-08-19", "dateISO": "2026-08-19", "letter": "W", "number": "19", "dayState": "quality", "isToday": false, "isDone": true, "isRest": false },
        { "id": "pw-2026-08-20", "dateISO": "2026-08-20", "letter": "T", "number": "20", "dayState": "easy", "isToday": true, "isDone": false, "isRest": false },
        { "id": "pw-2026-08-21", "dateISO": "2026-08-21", "letter": "F", "number": "21", "dayState": "easy", "isToday": false, "isDone": false, "isRest": false },
        { "id": "date:2026-08-22", "dateISO": "2026-08-22", "letter": "S", "number": "22", "dayState": "rest", "isToday": false, "isDone": false, "isRest": true },
        { "id": "pw-2026-08-23", "dateISO": "2026-08-23", "letter": "S", "number": "23", "dayState": "long", "isToday": false, "isDone": false, "isRest": false }
      ],
      "groups": [
        {
          "id": "g-easy-run",
          "title": "Easy run",
          "note": null,
          "steps": [
            { "id": "g-easy-run-1", "main": "Conversational the whole way", "sub": { "text": "8:50 \\u00b7 9:35 /mi", "modelled": false } }
          ]
        }
      ],
      "why": "Base miles are the floor the rest of the block stands on. Saturday is the run that needs your legs \\u00b7 today just keeps the engine turning over.",
      "whereYouAre": [
        { "id": "readiness", "label": "Readiness", "sub": "Inside your own normal", "value": { "text": "64", "modelled": false }, "action": "expand-readiness" },
        { "id": "week", "label": "This week", "sub": "34 of 44 mi planned", "value": { "text": "77%", "modelled": false }, "action": null }
      ],
      "beforeYouGo": [
        { "id": "shoes", "label": "Novablast 5", "sub": "386 mi on them", "value": { "text": "Change", "modelled": false }, "action": "shoes" },
        { "id": "move", "label": "Move or skip this run", "sub": "Friday and Saturday are both open", "value": { "text": "Change", "modelled": false }, "action": "move" }
      ],
      "askedVsRan": [],
      "verdict": null,
      "zoneShares": null,
      "zoneTarget": null,
      "elevation": null,
      "onTheBelt": null,
      "shoesWorn": null,
      "whatThisDidToTheWeek": [],
      "runId": null,
      "changed": null,
      "injury": null,
      "weekOff": null,
      "offSeason": null,
      "notOnPhoneYet": null
    }
    """
}
