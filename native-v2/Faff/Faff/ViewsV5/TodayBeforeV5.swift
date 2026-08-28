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
/// carries an `onClick` there, so this type carries no action of its own.
/// The screen wires the tap itself: a day with a `status` (done or today)
/// reopens through `onPickDay`, the same id-to-date resolution the week
/// strip already uses — see `calendarSheet` below.
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
    /// A closing sentence for the calendar, when the calendar needs one.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// DAVID, 2026-08-25: "clicking on the calendar icon here only brings up
    /// this week. Now, this could be because my next plan hasnt gone into
    /// effect yet, which is fine but I want to make sure it's an easy way to
    /// see the whole plan."
    ///
    /// It WAS the whole plan. His active block holds exactly one week, so one
    /// week is everything there is to list — and a screen called TRAINING
    /// CALENDAR that shows a single week is indistinguishable from one that
    /// failed to load the rest. The list was right and it read as broken,
    /// which is its own kind of wrong.
    ///
    /// So the calendar now ends by saying where the plan ends. Nil when the
    /// plan runs on past this week, because then the list is already saying
    /// it and a sentence would be noise.
    var calendarNote: String? = nil

    // The options behind an expanding "Before you go" row, and what happens
    // when one is picked. Both default to no-ops so a caller wiring only the
    // read path still compiles and renders (an empty expansion, not a crash).
    var beforeYouGoOptions: (V5Row) -> [TodayBeforeGoOption] = { _ in [] }
    /// `async` and returns whether the row should collapse. A plain pick
    /// (a shoe, "Skip it") returns true once its write is in flight. A move
    /// the server refuses returns false — RULE THREE, on screen: the runner
    /// gets asked (replace this day's run, or keep both as planned) rather
    /// than watching the row snap shut on a write that did not do what they
    /// tapped. Collapsing happens after the `await`, never before, so a
    /// caller that needs to re-expand with different options (the conflict
    /// case) can decide that from the network's actual answer, not a guess
    /// made before the request went out.
    var onSelectBeforeYouGoOption: (V5Row, TodayBeforeGoOption) async -> Bool = { _, _ in true }

    /// A "Where you are" row with an `action` other than `expand-readiness`
    /// was tapped. Nothing on this screen currently uses this — the readiness
    /// row expands in place below — but it stays as the escape hatch for any
    /// future "Where you are" row the design adds.
    var onWhereYouAreRowTap: (V5Row) -> Void = { _ in }

    /// Readiness's own detail — sleep, resting heart rate, the rest of the
    /// composite score's pillars — each read against ITS OWN rolling
    /// baseline. `V5Row` has no nested detail on the wire (same gap as
    /// `beforeYouGo`, see file header), so the caller supplies the resolved
    /// pillars directly, from `GET /api/readiness/brief`'s own `pillars`
    /// array (`ReadinessBriefSeed.swift`) — the same composer the full
    /// readiness sheet reads, so the two can never disagree on a number.
    ///
    /// RULE TWO: this expansion shows pillars SIDE BY SIDE, never combined
    /// into a claim that one caused another or that the score "changed
    /// because of X" — that convergence story belongs to `TodayChangedV5`,
    /// which only renders when three domains actually agree. This is just
    /// the score's own ingredients, each against its own baseline.
    var readinessPillars: [ReadinessPillar] = []

    /// RULE THREE · the pillar read FAILED, as opposed to coming back empty.
    ///
    /// These two used to be one empty array, and the screen said "Nothing to
    /// show yet." for both. That is the outage wearing the refusal's clothes
    /// — the mirror of the bug rule three is usually quoted for, and the more
    /// dangerous half: it asserts we looked and found nothing when we never
    /// looked at all. `V5OutageCopy`'s own note says it plainly, that a
    /// wrong-but-fluent sentence tells the runner we read something we did
    /// not.
    var readinessPillarsUnread: Bool = false

    /// The same distinction, per row, for the before-you-go lists.
    ///
    /// Per-row rather than per-screen because the lists have different
    /// sources: the shoe list is its own fetch and can fail on its own, the
    /// move list is derived from the Today payload already on screen and
    /// cannot. CLAUDE.md's per-finding context rule — a parent guard does not
    /// propagate, each finding asks its own question.
    var beforeYouGoUnread: (V5Row) -> Bool = { _ in false }

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
    /// `TodayHostV5.viewingDate`, straight through — see `stripDays()`.
    var selectedDateISO: String? = nil
    var onBackToToday: () -> Void = {}
    /// Page the week strip. -1 back a week, +1 forward.
    var onPageWeek: (Int) -> Void = { _ in }

    /// Job 2 · the coach-line entry point onto 18a (`V5Route.pacesMoved`).
    /// Present only when `model.paceNote != nil` — the way in must appear
    /// exactly when there is something to say, never as a standing nudge.
    var onOpenPacesMoved: () -> Void = {}
    /// Job 1 · "report sick" — expand-in-place, off Today. `SickReportRowV5`
    /// collects the backend's own vocabulary (symptom codes, the `started`
    /// enum); the caller POSTs `/api/sick` and reloads, which is what turns
    /// this into `SickFlareV5` on the next render.
    var onReportSick: (_ symptoms: [String], _ started: String, _ hasFever: Bool) -> Void = { _, _, _ in }

    @State private var calendarOpen = false
    @State private var accountOpen = false
    @State private var expandedBeforeRowID: String? = nil
    @State private var readinessExpanded = false


    /// The strip's plate — which of the seven cells wears the "you are here"
    /// mark. NOT the server's own `isToday` (that always names the runner's
    /// real today, everywhere in the payload); this compares each day
    /// against `model.dateISO`, the date THIS payload is describing.
    /// Ordinarily the same day — but the moment the runner steps away,
    /// `model.dateISO` moves with them and `isToday` does not, so this is
    /// what keeps the plate on the day actually on screen.
    ///
    /// A PURE FUNCTION OF `model`, DELIBERATELY. Two earlier attempts at this
    /// carried a SEPARATE piece of state (`selectedISO` / `selectedDayISO`)
    /// so the plate could move before the payload for the tapped day had
    /// arrived — the "instant tap" David asked for. That state could go
    /// stale independently of `model`, and when two navigations overlapped
    /// in flight it did: the plate, the header and the actual content payload
    /// could each be describing a DIFFERENT day at the same moment. This
    /// reads only `model`, which is the one thing on this screen that cannot
    /// disagree with itself — whichever payload is currently loaded is
    /// unambiguous by construction. The plate moves when the content moves,
    /// never before, and never to a day the screen isn't actually showing.
    private func stripDays() -> [WeekStripDayV5] {
        // David: "still feels pretty slow and clunky." The pill used to wait
        // for the network — `model.dateISO` only moves once the new payload
        // has actually landed, so tapping Thursday visibly did nothing for
        // the length of a round trip.
        //
        // `selectedDateISO` is `TodayHostV5`'s `viewingDate`, passed straight
        // through — the SAME synchronous, single-source-of-truth value that
        // already drives the header's "Upcoming"/"Earlier" tense instantly.
        // Reusing it here costs nothing new: no cache, no second variable
        // that could disagree with the fetch in flight, which is exactly
        // what made the last attempt at "instant" race. The pill moves the
        // instant the tap registers; the content underneath still waits for
        // the real payload, honestly, and simply falls back to describing
        // whatever IS on screen once it's home again.
        let selected = selectedDateISO ?? model.dateISO
        return model.weekStrip.map { d in
            var s = d.strip
            s.isToday = d.dateISO == selected
            return s
        }
    }

    var body: some View {
        ZStack {
            ScrollView {
                VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                    panel
                    blockNoteSection
                    groupsSection
                    whySection
                    paceNoteSection
                    // A GROUP WITH NO ROWS DRAWS NOTHING, NOT A BARE HEADER.
                    //
                    // These rendered unconditionally, so a payload with an
                    // empty list left "WHERE YOU ARE" sitting over blank
                    // space. That reads as a section that failed to load —
                    // the outage treatment, on a screen that is fine — which
                    // is rule three inside out.
                    //
                    // Live the moment the stepped-day rule started blanking
                    // this list on purpose: correct data, empty section,
                    // orphan header.
                    if !model.whereYouAre.isEmpty { whereYouAreSection }
                    if !model.beforeYouGo.isEmpty { beforeYouGoSection }
                    SickReportRowV5(onReport: onReportSick)
                }
                .padding(.horizontal, V5.S.gutter)
                .padding(.bottom, V5.S.s24)
                // A vertical page must never pan sideways — see `v5PageWidth`.
                .v5PageWidth()
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

    /// 22b. THE GRADIENT MEANS TODAY. Nothing else earns it.
    ///
    /// The day-state ramp is the loudest thing on the screen, and it is what
    /// makes Today feel like today. A day you have stepped to keeps every
    /// word — the kicker still names the state, the type still reads EASY —
    /// but drops the paint, so the two can never be confused at a glance.
    ///
    /// This applies FORWARD as well as back. A planned Friday carries a real
    /// day-state and the gradient would be truthful there, which is exactly
    /// the trap: truthful and still mistakable for today is the failure this
    /// screen exists to prevent. One rule, no exceptions, nothing to misread.
    private var steppedAway: Bool { viewingDayLabel != nil }

    /// Named once, because the ink has to come from the SAME value the panel
    /// is filled with. Computing them separately is how a stepped-to quality
    /// day would end up with a quiet fill and dark ink.
    /// DAVID, 2026-08-21, OVERRULING ROUND THREE ITEM 2: "If I go back to a
    /// past run, it should not change like this and remove the week strip
    /// etc. Keep everything just change the info below the week strip."
    ///
    /// So the panel keeps its day-state gradient and its week strip on a
    /// stepped-to day. What round three was protecting against — a past day
    /// mistaken for today — is carried by the words instead, which is where
    /// round three itself said tense belongs: the place label reads FRI 21
    /// AUG rather than TODAY, and a "‹ Today" chip sits beside it.
    private var panelFill: PanelFill { model.panel.fill }
    private var panelInk: V5.PanelInk { panelFill.ink }

    private var panel: some View {
        DayPanel(fill: panelFill) {
            // The one place header, shared with the after-run screen and the
            // state screens. This file used to hand-roll its own, which is how
            // the two Today variants ended up with different controls.
            PlaceHeaderV5(place: model.panel.place,
                          viewingDayLabel: viewingDayLabel,
                          onBackToToday: onBackToToday,
                          onCalendar: { withAnimation(V5.Motion.fill) { calendarOpen = true } },
                          initials: avatarInitials.isEmpty ? nil : avatarInitials,
                          onAccount: { withAnimation(V5.Motion.sheet) { accountOpen = true } })

            // ── THE DATE LINE IS GONE ────────────────────────────────────
            //
            // David, 2026-08-25: "TODAY does not need the 'Tuesday 25 August'
            // type", and on a stepped day, "other days show the date twice.
            // not needed."
            //
            // It was drawing the date a second time under a header that had
            // just given it, and a third time under a week strip whose whole
            // job is to say which day this is — in context, against the six
            // days around it, which is strictly more than a date line can say.
            // The panel's business is what the day ASKS FOR; the display
            // register below is the session, and that is what should be
            // wearing 26pt and up.
            //
            // The week line stays where it stood, hard right. It is the one
            // thing on this row the strip does not carry: which week of the
            // block this is.
            // ── THE ROW HOLDS ITS SPACE EVEN WITH NOTHING TO SAY ───────────
            //
            // David, 2026-08-25, watching the strip live: "the week 2 of 2
            // is gone making it jump. hold the space for it even if its not
            // there."
            //
            // Stepping past the end of the block (nothing written beyond it)
            // correctly has no week number to report — but `if let` made the
            // ABSENCE of that sentence also delete its ROW, so the panel's
            // height changed and everything below it — the strip, the
            // display register — shifted up a line the instant the runner
            // crossed that boundary. A real Text at empty string, not a
            // conditional view, reserves the exact line height every other
            // week already draws, invisibly, so nothing moves.
            HStack(spacing: V5.S.s12) {
                Spacer(minLength: 0)
                Text(model.panel.weekLine ?? "")
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(panelInk.secondary)
                    .opacity(model.panel.weekLine == nil ? 0 : 1)
            }

            // The strip stays on every day, and pages a week at a time.
            WeekStripV5(days: stripDays(),
                        onTap: { day in onPickDay(day.id) },
                        onPageWeek: { onPageWeek($0) })

            VStack(alignment: .leading, spacing: V5.S.s2) {
                if let kicker = model.panel.kicker {
                    Text(kicker)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(panelInk.secondary)
                }
                Text(model.panel.type)
                    .faffDisplayV5(TypeScaleV5.display56)
                    .foregroundStyle(panelInk.primary)
            }

            // Genuinely absent, not unreadable. A rest day carries no dose —
            // `type` already says REST at 56pt directly above, and the
            // server stopped restating it here (David: "it says REST, REST
            // day. then extra rest"). `.optionalValue` draws nothing for
            // nil; `.unreadableIfAbsent` would draw an unexplained dash
            // where the redundant word used to be.
            if let dose = model.panel.dose?.value {
                FaffValueText(dose,
                              font: .faffText(28, weight: .semibold),
                              color: panelInk.primary, mark: panelInk.mark)
            }

            PanelStatPlate(stats: model.panel.stats.map { stat in
                PanelStat(stat.label, stat.value.value,
                          ink: stat.toneValue.inkOverride)
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

            // PRERUN-1 · how to run it, and what to do when it goes wrong.
            // The design's own `groupFooter`. Quiet, under the tile, one
            // sentence per group — the numbers say what the session IS, this
            // says how to hold it. Drawn only when the engine sends one.
            if let footer = group.footer, !footer.isEmpty {
                Text(footer)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, V5.S.s4)
            }
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

    // MARK: - Block started
    //
    // The block-transition coach note (2026-08-28). The server sends
    // `blockNote` only while a fresh auto-applied block transition stands —
    // the recovery→build handoff and its lifecycle siblings, the same 24h
    // window the web notice card uses — so this section appears the morning
    // the block starts and is gone the next. Directly under the panel: the
    // reset week counter is the thing it explains, so the explanation sits
    // where the surprise is. Informational only — the transition already
    // happened, so no buttons (the undo lives on the decision-card surface).

    @ViewBuilder
    private var blockNoteSection: some View {
        if let note = model.blockNote {
            VStack(alignment: .leading, spacing: V5.S.s10) {
                V5SectionLabel(text: note.title, color: V5.textSecondary)
                CoachSay(text: note.body, size: .md)
            }
        }
    }

    // MARK: - Why this run

    @ViewBuilder
    private var whySection: some View {
        if let why = model.why, !why.isEmpty {
            VStack(alignment: .leading, spacing: V5.S.s10) {
                // 2026-08-25 · David: rename from "Why this run"/"Why this
                // day" to "About" — a deliberate deviation from the v5
                // README spec (§"Why this run"), which should be updated to
                // match rather than left to drift silently.
                V5SectionLabel(text: "About", color: V5.textSecondary)
                CoachSay(text: why, size: .md)
            }
        }
    }

    // MARK: - Paces moved · Job 2
    //
    // The coach-line entry point onto 18a, right under "Why this run" —
    // the closest thing on this screen to the route's own comment
    // ("reached from a coach line, not from the bar"). `model.paceNote` is
    // non-nil only when the active plan carries an unacknowledged pace-drop
    // event, so this row appears exactly then and never as a standing nudge.

    @ViewBuilder
    private var paceNoteSection: some View {
        if let note = model.paceNote {
            ListGroup {
                ListRow(label: note.label, sub: note.sub, onTap: onOpenPacesMoved)
            }
        }
    }

    // MARK: - Where you are

    private var whereYouAreSection: some View {
        ListGroup(header: "Where you are") {
            ForEach(model.whereYouAre) { row in
                if row.action == "expand-readiness" {
                    // Expand in place, same idiom as "Before you go" — never a
                    // chevron to a screen elsewhere, per the README's one
                    // interaction pattern for anything that opens.
                    ExpandingRow(label: row.label,
                                 sub: row.sub,
                                 value: row.value.optionalValue,
                                 question: "What's behind it",
                                 isExpanded: $readinessExpanded) {
                        readinessExpansion
                    }
                } else if row.action != nil {
                    ListRow(label: row.label,
                            sub: row.sub,
                            value: row.value.optionalValue,
                            onTap: { onWhereYouAreRowTap(row) })
                } else {
                    ListRow(label: row.label, sub: row.sub, value: row.value.optionalValue)
                }
            }
        }
    }

    /// The composite score's own ingredients — each pillar against ITS OWN
    /// baseline, standing side by side. Never a sentence that combines them:
    /// that convergence story is `TodayChangedV5`'s job, and only when three
    /// domains actually agree (RULE TWO).
    @ViewBuilder
    private var readinessExpansion: some View {
        if readinessPillars.isEmpty {
            Text(readinessPillarsUnread
                 ? "The breakdown did not load. The score above still stands, we just cannot open it up."
                 : "No pillar has enough nights behind it to break the score down yet.")
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textQuiet)
        } else {
            VStack(spacing: V5.S.s6) {
                ForEach(readinessPillars) { pillar in
                    HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
                        VStack(alignment: .leading, spacing: V5.S.s2) {
                            Text(pillar.label)
                                .font(.faffText(16, weight: .medium))
                                .foregroundStyle(V5.textPrimary)
                            if !pillar.observedSub.isEmpty {
                                Text(pillar.observedSub)
                                    .font(.faffText(TypeScaleV5.label13))
                                    .foregroundStyle(V5.textQuiet)
                            }
                        }
                        Spacer(minLength: V5.S.s8)
                        VStack(alignment: .trailing, spacing: V5.S.s2) {
                            Text(pillar.observedValue)
                                .font(.faffText(TypeScaleV5.body15, weight: .semibold))
                                .foregroundStyle(V5.textPrimary)
                            if !pillar.baseline.isEmpty {
                                Text("vs \(pillar.baseline)")
                                    .font(.faffText(TypeScaleV5.label13))
                                    .foregroundStyle(V5.textQuiet)
                            }
                        }
                    }
                    .padding(.horizontal, V5.S.s14)
                    .frame(minHeight: 48)
                    .frame(maxWidth: .infinity)
                    .background(V5.materialTile,
                                in: RoundedRectangle(cornerRadius: V5.R.r16, style: .continuous))
                }
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
                                 question: beforeYouGoQuestion(row),
                                 isExpanded: expandedBinding(for: row.id)) {
                        beforeYouGoExpansion(for: row)
                    }
                }
            }
        }
    }

    /// The expansion header names what is being ASKED. The row label names
    /// the current STATE — "Asics Novablast 5" — so repeating it as the
    /// question says nothing. Where the label is already the ask ("Move or
    /// skip") the label stands; the fallback only ever runs for a row whose
    /// verb this build does not know.
    private func beforeYouGoQuestion(_ row: V5Row) -> String {
        switch row.action {
        // The prototype writes both of these out — "Which pair" and
        // "Move or skip this run" — so they are copy, not paraphrase.
        case "change_shoe": return "Which pair"
        case "move_skip":   return "Move or skip this run"
        default:            return row.label
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
            Text(beforeYouGoUnread(row)
                 ? "This list did not load. Nothing about today changed."
                 : "Nothing to change here yet.")
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textQuiet)
        } else {
            VStack(spacing: V5.S.s6) {
                ForEach(options) { option in
                    Button {
                        Task {
                            let shouldCollapse = await onSelectBeforeYouGoOption(row, option)
                            if shouldCollapse {
                                withAnimation(V5.Motion.expand) { expandedBeforeRowID = nil }
                            }
                            // Not collapsing leaves this row's binding true;
                            // `beforeYouGoOptions(row)` is re-read on the next
                            // render, so a caller that changed what it would
                            // return (the reschedule conflict, replace/keep
                            // both) shows the new set in place.
                        }
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
                        .padding(.horizontal, V5.S.s14)
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
            // OPENS ON THIS WEEK, NOT ON THE TOP OF THE BLOCK.
            //
            // David: "on the full cal view we are seeing wk 1 even though its
            // in the past. it should always load with THIS WEEK at the top,
            // focused."
            //
            // A ScrollView starts at its content's origin, which here is the
            // first week of the block — so the calendar opened further into
            // the past every week of a build, and by week twelve the runner
            // would land on eleven weeks of history before finding today.
            //
            // The past is kept and reachable by scrolling up; only the resting
            // position moves. Anchored `.top` rather than centred so this week
            // sits where the eye starts, with next week already visible under
            // it — the two the runner opened the calendar to see.
            ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                    ForEach(calendarWeeks) { week in
                        ListGroup(header: week.range, footer: week.sub) {
                            ForEach(week.days) { day in
                                // A finished or current day is real: tapping
                                // it re-opens THAT day the same way stepping
                                // the week strip does — `onPickDay` already
                                // resolves an id to a date and reloads Today
                                // for it, so a "Done" day drops straight into
                                // the after-run screen it already knows how
                                // to render. A day that has not happened yet
                                // has nothing to open, so it stays a plain
                                // row with no chevron — "never a chevron on a
                                // row that has nothing to open."
                                ListRow(label: day.label, sub: day.sub, value: day.status, raised: day.isToday,
                                        onTap: (day.status != nil || day.isToday) ? {
                                            onPickDay(day.id)
                                            withAnimation(V5.Motion.fill) { calendarOpen = false }
                                        } : nil)
                            }
                        }
                        // `scrollTo` addresses this id. ForEach's own identity
                        // is not enough — the proxy needs it on the view.
                        .id(week.id)
                    }

                    // Where the plan ends, said out loud — see `calendarNote`.
                    // Quiet ink and no tile: it is a note about the list, not
                    // another row in it.
                    if let calendarNote {
                        Text(calendarNote)
                            .font(.faffText(TypeScaleV5.label13))
                            .foregroundStyle(V5.textQuiet)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, V5.S.s4)
                    }
                }
                .padding(.horizontal, V5.S.gutter)
                .padding(.bottom, V5.S.s24)
                // A vertical page must never pan sideways — see `v5PageWidth`.
                .v5PageWidth()
            }
            .scrollIndicators(.hidden)
            .onAppear {
                // No animation: this is where the sheet OPENS, not somewhere
                // it travels to. A visible scroll would say the runner had
                // been moved, when in fact they were never anywhere else.
                guard let week = calendarWeeks.first(where: { w in
                    w.days.contains(where: \.isToday)
                }) else { return }
                proxy.scrollTo(week.id, anchor: .top)
            }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(V5.surfacePage)
        .ignoresSafeArea(edges: .top)
        // THIS IS A MODAL, AND IT IS THE ONLY ONE THAT SAYS SO BY HAND.
        //
        // `V5SheetHost` carries `.isModal` for every sheet in the app, but the
        // training calendar is not a sheet — it is a hand-rolled full-screen
        // ZStack layer over Today. Opaque paint hides the screen underneath
        // from a sighted runner; it does nothing to the accessibility tree.
        // Without this a VoiceOver runner swipes past the last calendar row
        // straight into the Today panel behind it and can activate rows that
        // are not on screen.
        .accessibilityAddTraits(.isModal)
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
        beforeYouGoOptions: TodayBeforeV5Sample.options(for:),
        readinessPillars: TodayBeforeV5Sample.readinessPillars
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

    /// "Where you are" → Readiness's own expansion. Decoded through
    /// `ReadinessPillar` itself (via JSON, not a parallel initialiser) so the
    /// preview exercises the same decode path `GET /api/readiness/brief`
    /// goes through. Shape mirrors `ReadinessBriefSeed.swift`'s pillars —
    /// each value stands against its OWN baseline (RULE TWO: no combined
    /// causal claim).
    static let readinessPillars: [ReadinessPillar] = {
        try! JSONDecoder().decode([ReadinessPillar].self, from: Data(readinessPillarsJSON.utf8))
    }()

    private static let readinessPillarsJSON = """
    [
      { "key": "sleep", "label": "Sleep", "weightPct": 30, "observedValue": "7.2h", "observedSub": "last night", "baseline": "your avg 7.4h", "band": "ready", "weightContribution": 30, "meaning": "", "confounders": [], "trend": [], "citation": "" },
      { "key": "rhr", "label": "Resting heart rate", "weightPct": 25, "observedValue": "52 bpm", "observedSub": "this morning", "baseline": "your avg 51 bpm", "band": "ready", "weightContribution": 25, "meaning": "", "confounders": [], "trend": [], "citation": "" },
      { "key": "hrv", "label": "HRV", "weightPct": 25, "observedValue": "64 ms", "observedSub": "this morning", "baseline": "your avg 66 ms", "band": "ready", "weightContribution": 25, "meaning": "", "confounders": [], "trend": [], "citation": "" },
      { "key": "load", "label": "Training load", "weightPct": 20, "observedValue": "Moderate", "observedSub": "7-day rolling", "baseline": "your usual range", "band": "ready", "weightContribution": 20, "meaning": "", "confounders": [], "trend": [], "citation": "" }
    ]
    """
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
        { "id": "fitness", "label": "Half fitness", "sub": "That comes off Americas Finest City eight days ago, and you have not raced since.", "value": { "text": "1:39:00 \\u2013 1:44:30", "modelled": true }, "action": null },
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
      "zoneTargets": [],
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
