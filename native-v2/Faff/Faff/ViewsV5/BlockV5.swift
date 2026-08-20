//
//  BlockV5.swift
//  faff.run iPhone · screen 6a, "Block" — where today sits in the 16-week plan.
//
//  Source: docs/design/iphone-v5/reference/screens/6a.html, the "Block (6a)"
//  section of README-v5-handoff.md, and §6 of docs/faff-iphone-design-contract.md
//  ("Change the plan — built, and there are five not four").
//
//  ─────────────────────────────────────────────────────────────────────────
//  SCOPE
//
//  This file owns the place screen's OWN content: the phase panel, the arc,
//  the coach line, the block-to-date stats, all sixteen weeks, the workout
//  library, and the "Change the plan" sheet. It does not own the avatar/
//  account sheet, the status-bar row, or the RUN picker — those are shared
//  shell chrome. A composition root wires this view up alongside the other
//  two place screens, same shape as the RUN picker already being shell-level
//  rather than duplicated per screen.
//
//  The prototype ALSO shows a "Changed" `ListGroup` above "so far in this
//  block", populated from local `planApplied` state with an "Undo" value on
//  each row. The real wire contract (`V5Block` in APIV5.swift) carries no such
//  field, and the design contract says outright: "Two things not built …
//  Undo. The response carries what changed, but nothing restores it." So that
//  group is NOT built here — building it would mean inventing client-side
//  state the backend does not back, and an "Undo" button that does nothing is
//  worse than no button. See the report for this flagged explicitly.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE FOUR RULES, AS THEY LAND HERE
//
//  1 · A MODELLED NUMBER MUST NEVER LOOK MEASURED. Every number on this screen
//      — the panel's dose and stats, every row value, every week's mileage —
//      comes through `V5Number.value` into a `FaffValue`. There is no `String`
//      call site for a number anywhere in this file.
//
//  2 · ONE SIGNAL NEVER CHANGES A SESSION. Not this screen's job directly —
//      Today owns the convergence note — but the plan-change sheet respects
//      it by construction: every "changed session" outcome here is the
//      engine's own `tradeOff` sentence, never a client-composed one.
//
//  3 · A REFUSAL IS A CORRECT ANSWER, NOT AN EMPTY STATE. The plan-change
//      sheet has three distinct "no" states and they are NOT interchangeable:
//        · `V5Scenario.available == false` → the refusal is already known,
//          before any network round trip, and renders the instant it's
//          picked — no propose call needed, because the answer was already
//          in the payload that built the menu.
//        · `V5PlanChangeRefusal.isRefusal == true` (after a propose) → the
//          engine read the request and declined on purpose. `Alert`, no
//          confirm button.
//        · `V5PlanChangeRefusal.isRefusal == false` → something broke, or the
//          token went stale. `ErrorNote`, with a retry.
//
//  4 · COACH VOICE. Every line of copy on this screen is either the engine's
//      own string (`coachLine`, `tradeOff`, `caveats`, `refusal`/`reason`) or
//      a short structural label ("Every week", "Which dates"). Nothing here
//      is invented persuasive copy.
//

import Foundation
import SwiftUI

// MARK: - The screen

struct BlockV5: View {
    let model: V5Block
    /// Fires once a scenario is actually applied, so the caller can refresh
    /// the cached block (and Today, which the same change can touch).
    var onChanged: (V5PlanChangeProposal) -> Void = { _ in }

    @State private var openWeekID: String?
    @State private var openLibraryID: String?

    @State private var planSheetOpen: Bool
    @State private var stage: PlanStage
    @State private var travelFrom: Date
    @State private var travelTo: Date
    @State private var busy = false

    init(model: V5Block, onChanged: @escaping (V5PlanChangeProposal) -> Void = { _ in }) {
        self.model = model
        self.onChanged = onChanged
        _planSheetOpen = State(initialValue: false)
        _stage = State(initialValue: .menu)
        _travelFrom = State(initialValue: Date())
        _travelTo = State(initialValue: Calendar.current.date(byAdding: .day, value: 6, to: Date()) ?? Date())
    }

    /// Preview-only: open straight into a given sheet stage, so the longest
    /// trade-off string and the refusal state can be inspected without
    /// simulating taps through the menu.
    fileprivate init(model: V5Block,
                      onChanged: @escaping (V5PlanChangeProposal) -> Void = { _ in },
                      previewStage: PlanStage) {
        self.model = model
        self.onChanged = onChanged
        _planSheetOpen = State(initialValue: true)
        _stage = State(initialValue: previewStage)
        _travelFrom = State(initialValue: Date())
        _travelTo = State(initialValue: Calendar.current.date(byAdding: .day, value: 6, to: Date()) ?? Date())
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                panel
                arcSection
                coachSection
                soFarSection
                changePlanRow
                weeksSection
                librarySection
            }
            .padding(.horizontal, V5.S.gutter)
            .padding(.bottom, V5.S.s24)
        }
        .background(V5.surfacePage)
        .scrollIndicators(.hidden)
        .overlay {
            V5SheetHost(isPresented: $planSheetOpen) {
                planSheetBody
            }
        }
    }

    // MARK: Panel
    // "DayPanel with phase name at 56pt display, 'N weeks to [race]', and a
    //  PanelStatPlate of quality share / long run / this week's mileage. Its
    //  day state is phase." The dateLine/weekLine/kicker row above it is the
    //  same V5Panel shape Races and Today draw from — carried across for
    //  fidelity even though the task's own bullet list only calls out the
    //  three pieces below it.

    private var panel: some View {
        DayPanel(fill: model.panel.fill) {
            HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
                Text(model.panel.dateLine)
                    .faffDisplayV5(26, fit: false)
                    .foregroundStyle(V5.OnPanel.primary)
                Spacer(minLength: 0)
                if let weekLine = model.panel.weekLine {
                    Text(weekLine)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.OnPanel.secondary)
                }
            }

            VStack(alignment: .leading, spacing: V5.S.s20) {
                VStack(alignment: .leading, spacing: 2) {
                    if let kicker = model.panel.kicker {
                        Text(kicker)
                            .font(.faffText(TypeScaleV5.label13))
                            .foregroundStyle(V5.OnPanel.secondary)
                    }
                    Text(model.panel.type.uppercased())
                        .font(.faffDisplay(TypeScaleV5.display56))
                        .textCase(.uppercase)
                        .foregroundStyle(V5.OnPanel.primary)
                }

                FaffValueText(model.panel.dose.value,
                              font: .faffText(TypeScaleV5.valueMin, weight: .semibold),
                              color: V5.OnPanel.primary)

                PanelStatPlate(stats: model.panel.stats.map {
                    PanelStat($0.label, $0.value.value, ink: $0.tone == "attention" ? V5.attention : nil)
                })
            }
        }
    }

    // MARK: The arc

    private var arcSection: some View {
        VStack(alignment: .leading, spacing: V5.S.s12) {
            V5SectionLabel(text: "The arc")
            PhaseBar(phases: model.phases.map(\.segment), height: 30)
        }
        .padding(.horizontal, V5.S.s4)
    }

    // MARK: Where this goes

    private var coachSection: some View {
        VStack(alignment: .leading, spacing: V5.S.s10) {
            V5SectionLabel(text: "Where this goes")
            if let coachLine = model.coachLine, !coachLine.isEmpty {
                CoachSay(text: coachLine, size: .md)
            } else {
                // RULE THREE: the coach has nothing honest to say right now —
                // a designed silence, not a blank space where a line usually is.
                Silence(reason: "Nothing new to say about this block right now.")
            }
        }
        .padding(.horizontal, V5.S.s4)
    }

    // MARK: So far in this block

    private var soFarSection: some View {
        ListGroup(header: "So far in this block") {
            ForEach(model.soFar) { row in
                ListRow(label: row.label, sub: row.sub, value: row.value?.value)
            }
        }
    }

    // MARK: Change the plan (row)

    private var changePlanRow: some View {
        ListGroup {
            ListRow(label: "Change the plan",
                    sub: "Cutback, travel, extra day, another race, move a day",
                    onTap: {
                        stage = .menu
                        planSheetOpen = true
                    })
        }
    }

    // MARK: Every week
    // "All sixteen weeks listed, not sampled … sized by that week's biggest
    //  day … Pass scaleMax as the biggest day across the WHOLE block, so
    //  weeks are sized against each other."

    private var blockScaleMax: Double {
        model.weeks.flatMap { $0.days.map(\.miles) }.max() ?? 1
    }

    private var weeksSection: some View {
        VStack(alignment: .leading, spacing: V5.S.s10) {
            HStack(alignment: .firstTextBaseline) {
                V5SectionLabel(text: "Every week")
                Spacer(minLength: V5.S.s12)
                Text("All \(model.weeks.count)")
                    .font(.faffText(TypeScaleV5.label13, weight: .semibold))
                    .foregroundStyle(V5.textQuiet)
            }
            .padding(.horizontal, V5.S.s4)

            VStack(spacing: 0) {
                ForEach(model.weeks) { week in
                    BlockWeekRow(
                        week: week,
                        scaleMax: blockScaleMax,
                        isOpen: openWeekID == week.id,
                        onTap: {
                            withAnimation(V5.Motion.expand) {
                                openWeekID = (openWeekID == week.id) ? nil : week.id
                            }
                        }
                    )
                }
            }
            .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
        }
    }

    // MARK: Workout library

    private var librarySection: some View {
        ListGroup(header: "Workout library") {
            ForEach(model.library) { workout in
                ExpandingRow(
                    label: workout.name,
                    sub: workout.family,
                    question: workout.prescription,
                    isExpanded: Binding(
                        get: { openLibraryID == workout.id },
                        set: { open in openLibraryID = open ? workout.id : nil }
                    )
                ) {
                    VStack(alignment: .leading, spacing: V5.S.s8) {
                        if let structure = workout.structure, !structure.isEmpty {
                            Text(structure)
                                .font(.faffText(TypeScaleV5.body15))
                                .foregroundStyle(V5.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if let citation = workout.citation, !citation.isEmpty {
                            Text(citation)
                                .font(.faffText(TypeScaleV5.label12))
                                .foregroundStyle(V5.textQuiet)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Change the plan (sheet)
    //
    // A two-step contract, not a button: propose, read the trade-off, then
    // confirm or back out. See `PlanStage` below for the state machine.

    private var sheetSubtitle: String {
        if case .menu = stage {
            return "Tell the coach and the block gets rewritten around it"
        }
        return "The coach has read the rest of the block"
    }

    @ViewBuilder
    private var planSheetBody: some View {
        VStack(alignment: .leading, spacing: V5.S.tilePad) {
            VStack(alignment: .leading, spacing: 4) {
                Text("What changed")
                    .font(.faffDisplay(20))
                    .textCase(.uppercase)
                    .tracking(20 * 0.02)
                    .foregroundStyle(V5.textPrimary)
                Text(sheetSubtitle)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
            }
            .padding(.horizontal, V5.S.s4)

            switch stage {
            case .menu:
                menuBody
            case .refusalUpfront(let scenario):
                refusalUpfrontBody(scenario)
            case .travelInput(let scenario):
                travelInputBody(scenario)
            case .proposed(let scenario, let proposal):
                proposedBody(scenario, proposal)
            case .refused(let scenario, let refusal):
                refusedBody(scenario, refusal)
            case .failed(let scenario, let refusal):
                failedBody(scenario, refusal)
            }
        }
    }

    private var menuBody: some View {
        VStack(spacing: V5.S.s16) {
            ListGroup {
                ForEach(model.scenarios) { scenario in
                    ListRow(label: scenario.label, sub: scenario.sub, onTap: { choose(scenario) })
                }
            }
            FaffButton("Close", variant: .secondary, size: .md) {
                planSheetOpen = false
            }
        }
    }

    /// RULE THREE, upfront: `scenario.available == false` is already known
    /// from the menu payload, so this renders the instant the scenario is
    /// picked — no propose round trip, because there is nothing left to ask.
    private func refusalUpfrontBody(_ scenario: V5Scenario) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            Alert(text: scenario.refusal ?? "This is not available for this week.", tone: .attention)
            FaffButton("Leave it alone", variant: .ghost, size: .md) {
                stage = .menu
            }
        }
    }

    /// "Travel is a real date-range picker (from/to), not a length toggle …
    ///  do not implement a client-side day-count rule." The dates are simply
    ///  sent; the server decides satisfiability against this runner's block.
    private func travelInputBody(_ scenario: V5Scenario) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            VStack(alignment: .leading, spacing: V5.S.s10) {
                V5SectionLabel(text: "Which dates")
                    .padding(.horizontal, V5.S.s4)
                HStack(spacing: V5.S.s10) {
                    dateField(label: "From", date: $travelFrom)
                    dateField(label: "To", date: $travelTo)
                }
                FaffButton(busy ? "Checking these dates…" : "Check these dates",
                           variant: .primary, size: .lg, enabled: !busy) {
                    propose(scenario, params: [
                        "from": Self.isoDay(travelFrom),
                        "to": Self.isoDay(travelTo)
                    ])
                }
            }
            FaffButton("Leave it alone", variant: .ghost, size: .md) {
                stage = .menu
            }
        }
    }

    private func dateField(label: String, date: Binding<Date>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.faffText(TypeScaleV5.label12))
                .foregroundStyle(V5.textQuiet)
                .padding(.horizontal, 2)
            DatePicker("", selection: date, displayedComponents: .date)
                .datePickerStyle(.compact)
                .labelsHidden()
                .tint(V5.signal)
                .padding(.horizontal, V5.S.s12)
                .frame(height: 44)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r14, style: .continuous))
        }
        .frame(maxWidth: .infinity)
    }

    /// "The trade-off strings are real output … size the container for the
    ///  longest realistic string, not the average one." `CoachSay` reserves
    ///  its own full height (`fixedSize(vertical: true)`), and this sheet has
    ///  no `ScrollView` and no `lineLimit` anywhere in the chain, so nothing
    ///  here can truncate the sentence — see the report for the line-count
    ///  and total-height estimate this was checked against.
    private func proposedBody(_ scenario: V5Scenario, _ proposal: V5PlanChangeProposal) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            CoachSay(text: proposal.tradeOff, size: .md)
            // "Caveats get quieter treatment than the trade-off … a small
            //  quiet line below the CoachSay, never folded into it."
            if !proposal.caveats.isEmpty {
                CoachCaveat(text: proposal.caveats.joined(separator: " "))
            }
            VStack(spacing: V5.S.s8) {
                FaffButton(busy ? "Working…" : proposal.verb, variant: .primary, size: .lg, enabled: !busy) {
                    confirm(scenario, proposal)
                }
                FaffButton("Leave it alone", variant: .ghost, size: .md) {
                    stage = .menu
                }
            }
        }
    }

    /// The engine declined on purpose. `Alert`, and — deliberately — no
    /// generic "try again": there is nothing to confirm, and nothing to
    /// retry with the same inputs. Travel is the one exception, since a
    /// different date range is a genuinely different request.
    private func refusedBody(_ scenario: V5Scenario, _ refusal: V5PlanChangeRefusal) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            Alert(text: refusal.reason, tone: .attention)
            VStack(spacing: V5.S.s8) {
                if scenario.id == "travel" {
                    FaffButton("Try different dates", variant: .secondary, size: .md) {
                        stage = .travelInput(scenario)
                    }
                }
                FaffButton("Leave it alone", variant: .ghost, size: .md) {
                    stage = .menu
                }
            }
        }
    }

    /// Something broke, or the token went stale underneath the runner. This
    /// is NOT a refusal — `ErrorNote`, with a retry, per rule three.
    private func failedBody(_ scenario: V5Scenario, _ refusal: V5PlanChangeRefusal) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            ErrorNote(text: refusal.reason, onRetry: {
                if scenario.id == "travel" {
                    propose(scenario, params: [
                        "from": Self.isoDay(travelFrom),
                        "to": Self.isoDay(travelTo)
                    ])
                } else {
                    propose(scenario, params: [:])
                }
            })
            FaffButton("Leave it alone", variant: .ghost, size: .md) {
                stage = .menu
            }
        }
    }

    // MARK: Sheet state machine

    private func choose(_ scenario: V5Scenario) {
        guard scenario.available else {
            // RULE THREE, upfront: already known, no network call needed.
            stage = .refusalUpfront(scenario)
            return
        }
        if scenario.id == "travel" {
            stage = .travelInput(scenario)
        } else {
            propose(scenario, params: [:])
        }
    }

    private func propose(_ scenario: V5Scenario, params: [String: Any]) {
        busy = true
        Task { @MainActor in
            defer { busy = false }
            do {
                let outcome = try await API.planChange(scenario: scenario.id, params: params, confirm: false)
                handle(outcome, for: scenario)
            } catch {
                stage = .failed(scenario, Self.networkFailure)
            }
        }
    }

    private func confirm(_ scenario: V5Scenario, _ proposal: V5PlanChangeProposal) {
        busy = true
        Task { @MainActor in
            defer { busy = false }
            do {
                // "A confirm must carry the token from the propose the runner
                //  actually read" — never a token the screen invented.
                let outcome = try await API.planChange(scenario: scenario.id, confirm: true, token: proposal.token)
                handle(outcome, for: scenario)
            } catch {
                stage = .failed(scenario, Self.networkFailure)
            }
        }
    }

    private func handle(_ outcome: API.V5PlanChangeOutcome, for scenario: V5Scenario) {
        switch outcome {
        case .proposed(let p):
            stage = .proposed(scenario, p)
        case .applied(let p):
            planSheetOpen = false
            stage = .menu
            onChanged(p)
        case .refused(let r):
            stage = .refused(scenario, r)
        case .failed(let r):
            stage = .failed(scenario, r)
        }
    }

    private static var networkFailure: V5PlanChangeRefusal {
        V5PlanChangeRefusal(ok: false, error: "network",
                             reason: "Could not reach the plan. Try again.",
                             violations: nil)
    }

    private static func isoDay(_ date: Date) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC") ?? .current
        let c = cal.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }
}

// MARK: - Sheet stage

/// The plan-change sheet's own state machine. `Equatable` so `#Preview` can
/// seed it directly without simulating taps.
fileprivate enum PlanStage: Equatable {
    /// Five scenarios on offer.
    case menu
    /// `scenario.available == false` — known from the menu payload itself.
    case refusalUpfront(V5Scenario)
    /// Travel only: the date-range step before a propose call is possible.
    case travelInput(V5Scenario)
    /// A live proposal, read the trade-off, confirm or back out.
    case proposed(V5Scenario, V5PlanChangeProposal)
    /// The engine declined on purpose. `Alert`.
    case refused(V5Scenario, V5PlanChangeRefusal)
    /// Something broke, or the token went stale. `ErrorNote`.
    case failed(V5Scenario, V5PlanChangeRefusal)
}

// MARK: - Block week row
//
// Not `ExpandingRow`: that component's shape is label/sub/value with a
// trailing chevron, built for an editable field. A week's row carries a
// drawn shape (`WeekShape`) in place of the label, so it needs its own
// layout — but the same disclosure mechanics (tap toggles, background steps
// up one fill level when open, no chevron because nothing is being "asked").

private struct BlockWeekRow: View {
    let week: V5BlockWeek
    let scaleMax: Double
    let isOpen: Bool
    let onTap: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Button(action: onTap) {
                HStack(alignment: .center, spacing: V5.S.s12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(week.label)
                            .font(.faffText(15, weight: week.isCurrent ? .bold : .regular))
                            .foregroundStyle(week.isCurrent ? V5.textPrimary : V5.textSecondary)
                        Text(week.flag)
                            .font(.faffText(TypeScaleV5.label12))
                            .foregroundStyle(V5.textQuiet)
                    }
                    .frame(width: 74, alignment: .leading)

                    WeekShape(days: week.days.map(\.load), scaleMax: scaleMax, height: 44)
                        .frame(maxWidth: .infinity)

                    FaffValueText(week.miles.value,
                                  font: .faffText(TypeScaleV5.body15),
                                  color: V5.textSecondary)
                        .fixedSize()
                }
                .padding(.horizontal, V5.S.tilePad)
                .frame(minHeight: 58)
                .frame(maxWidth: .infinity)
                .background(isOpen ? V5.materialControl : Color.clear)
            }
            .buttonStyle(V5PressStyle())

            if isOpen {
                VStack(alignment: .leading, spacing: V5.S.s10) {
                    ForEach(week.detail) { row in
                        HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
                            Text(row.label)
                                .font(.faffText(14))
                                .foregroundStyle(V5.textPrimary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            FaffValueText(row.value.value, font: .faffText(14), color: V5.textSecondary)
                        }
                    }
                }
                .padding(.horizontal, V5.S.tilePad)
                .padding(.vertical, V5.S.s14x)
                .background(V5.materialTileRaised)
                .transition(.opacity)
            }
        }
    }
}

// MARK: - Sample data
//
// "Build samples from JSON + JSONDecoder inside your own file." These are
// decoded through the real wire structs, not hand-built Swift values, so a
// preview exercises the same decode path a live payload would. The 16-week
// generator below ports `BLOCK_WEEKS` verbatim from the prototype's own
// `_script-data.js` (phases, cutback weeks, the week-6 "now" marker) rather
// than inventing a simplified stand-in.

extension V5Block {
    fileprivate static var sample: V5Block {
        guard let data = sampleJSON.data(using: .utf8),
              let block = try? JSONDecoder().decode(V5Block.self, from: data) else {
            fatalError("BlockV5 sample JSON failed to decode")
        }
        return block
    }

    private static var sampleJSON: String {
        struct Phase { let name: String; let from: Int; let to: Int; let q: Int }
        let phases = [
            Phase(name: "Base", from: 1, to: 8, q: 1),
            Phase(name: "Quality", from: 9, to: 12, q: 2),
            Phase(name: "Race specific", from: 13, to: 15, q: 2),
            Phase(name: "Taper", from: 16, to: 16, q: 1)
        ]
        let totals: [Double] = [34, 36, 40, 28, 42, 44, 46, 34, 48, 50, 46, 38, 54, 52, 42, 26]
        let longs: [Double]  = [14, 14, 16, 11, 16, 16, 18, 13, 18, 20, 16, 14, 20, 18, 14, 26]

        struct Day { let load: Double; var quality = false; var race = false; var today = false; var future = false }

        var weekJSON: [String] = []
        var lastPhase = ""

        for i in 0..<16 {
            let n = i + 1
            let mi = totals[i]
            let long = longs[i]
            guard let phase = phases.first(where: { n >= $0.from && n <= $0.to }) else { continue }
            let cut = [4, 8, 12].contains(n)
            let race = n == 16
            let rest = mi - long
            let easy = ((rest / Double(phase.q + 3)) * 10).rounded() / 10
            let now = n == 6

            var days: [Day] = [
                Day(load: easy),
                Day(load: phase.q > 1 ? easy + 1 : 0, quality: phase.q > 1),
                Day(load: easy + 1, quality: true),
                Day(load: easy),
                Day(load: max(3, easy - 1)),
                Day(load: 0),
                Day(load: long, quality: n >= 9 || race, race: race)
            ]
            if now {
                days[3].today = true
                for k in 4..<7 { days[k].future = true }
            } else if n > 6 {
                for k in days.indices { days[k].future = true }
            }

            let flagRaw = now ? "This week" : race ? "Race week" : cut ? "Cutback" : phase.name
            let flag = (now || flagRaw == "Cutback" || flagRaw == "Race week")
                ? flagRaw
                : (i == 0 || lastPhase != phase.name ? phase.name : "")
            lastPhase = phase.name

            let daysJSON = days.enumerated().map { idx, d in
                "{\"id\":\"w\(n)d\(idx)\",\"miles\":\(d.load.clean),\"quality\":\(d.quality),\"race\":\(d.race),\"isToday\":\(d.today),\"isFuture\":\(d.future)}"
            }.joined(separator: ",")

            let qualityLabel = "\(phase.q)\(phase.q > 1 ? " sessions" : " session")\(n <= 6 ? ", done" : "")"
            let ranMi = n < 6 ? mi : (n == 6 ? 34 : mi)

            let detailJSON = """
            [{"id":"w\(n)-long","label":"\(race ? "Race" : "Long run")","sub":null,"value":{"text":"\(long.clean)\(race ? ".2 mi Sunday" : " mi")","modelled":false},"action":null},
            {"id":"w\(n)-quality","label":"Quality","sub":null,"value":{"text":"\(qualityLabel)","modelled":false},"action":null},
            {"id":"w\(n)-ran","label":"\(n <= 6 ? "Ran" : "Planned")","sub":null,"value":{"text":"\(ranMi.clean) of \(mi.clean) mi","modelled":false},"action":null}]
            """

            weekJSON.append("""
            {"id":"week-\(n)","label":"Wk \(n)","flag":"\(flag)","miles":{"text":"\(mi.clean) mi","modelled":false},"isCurrent":\(now),"days":[\(daysJSON)],"detail":\(detailJSON)}
            """)
        }

        return """
        {
          "panel": {
            "dayState": "phase",
            "quiet": false,
            "place": "Block",
            "dateLine": "Week 6 of 16",
            "weekLine": "Sub 3:30 \\u00b7 7 Dec",
            "kicker": "2 weeks left of this phase",
            "type": "Base",
            "dose": {"text": "10 weeks to CIM", "modelled": false},
            "stats": [
              {"label": "Quality share", "value": {"text": "18%", "modelled": false}, "tone": null},
              {"label": "Long run", "value": {"text": "16 mi", "modelled": false}, "tone": null},
              {"label": "This week", "value": {"text": "44 mi", "modelled": false}, "tone": null}
            ]
          },
          "phases": [
            {"id": "base", "name": "Base", "weeks": 8, "current": true, "at": 0.72},
            {"id": "quality", "name": "Quality", "weeks": 4, "current": false, "at": null},
            {"id": "race-specific", "name": "Race specific", "weeks": 3, "current": false, "at": null},
            {"id": "taper", "name": "Taper", "weeks": 1, "current": false, "at": null}
          ],
          "coachLine": "Two more weeks of miles, then the work that decides the race arrives. Nothing about today is meant to feel hard yet.",
          "soFar": [
            {"id": "so-miles", "label": "Miles run", "sub": "Of 656 in the whole block", "value": {"text": "234", "modelled": false}, "action": null},
            {"id": "so-sessions", "label": "Sessions", "sub": "3 missed, 1 moved", "value": {"text": "38 of 42", "modelled": false}, "action": null},
            {"id": "so-longest", "label": "Longest so far", "sub": "The block peaks at 20 mi", "value": {"text": "16 mi", "modelled": false}, "action": null}
          ],
          "weeks": [\(weekJSON.joined(separator: ","))],
          "library": [
            {"id": "lib-threshold", "name": "Threshold ladder", "family": "Threshold", "prescription": "3 to 5 reps at threshold pace, 2 to 3 min float between.", "structure": "Warm up 15 min \\u00b7 reps \\u00b7 cool down 10 min", "citation": "Daniels, Table 4", "isQuality": true},
            {"id": "lib-mile-repeats", "name": "Mile repeats", "family": "Interval", "prescription": "4 to 6 x 1 mile at interval pace, equal-time jog recovery.", "structure": "Warm up 15 min \\u00b7 reps \\u00b7 cool down 10 min", "citation": "Daniels, Table 3", "isQuality": true},
            {"id": "lib-mp-long", "name": "Long run with marathon pace", "family": "Long run", "prescription": "Final 6 to 8 miles of the long run at marathon effort.", "structure": "Easy build \\u00b7 marathon-pace finish", "citation": "Daniels, Chapter 6", "isQuality": true},
            {"id": "lib-hills", "name": "Hill circuit", "family": "Hills", "prescription": "8 to 10 x 60 to 90 sec uphill at hard effort, jog down recovery.", "structure": "Warm up 15 min \\u00b7 reps \\u00b7 cool down 10 min", "citation": "Daniels, Table 5", "isQuality": true}
          ],
          "scenarios": [
            {"id": "cutback", "label": "I need an easier week", "sub": "Week 6 becomes a cutback", "available": true, "refusal": null},
            {"id": "travel", "label": "I am away", "sub": "Pick your dates", "available": true, "refusal": null},
            {"id": "extra_day", "label": "I can run more days", "sub": "Five now, six from week 7", "available": true, "refusal": null},
            {"id": "another_race", "label": "I entered another race", "sub": "Add a race to the calendar", "available": true, "refusal": null},
            {"id": "move_day", "label": "I need to move a day", "sub": "Easy run, Fri \\u2192 Mon", "available": false, "refusal": "This week is already underway \\u00b7 moving a day now would leave less than 24 hours to adjust the days around it. Try it from next week instead."}
          ]
        }
        """
    }
}

extension V5Scenario {
    fileprivate static var sampleAnotherRaceScenario: V5Scenario {
        V5Scenario(id: "another_race", label: "I entered another race",
                   sub: "Add a race to the calendar", available: true, refusal: nil)
    }

    fileprivate static var sampleTravelScenario: V5Scenario {
        V5Scenario(id: "travel", label: "I am away", sub: "Pick your dates",
                   available: true, refusal: nil)
    }
}

extension V5PlanChangeProposal {
    /// The longest realistic trade-off in the design's own accounting:
    /// another-race with an A/B race AND a displaced long run — 5 clauses,
    /// the last one itself two sentences, 6 sentences total. Not literally
    /// in the prototype's sample data (its `another_race` sample is a plain
    /// C-race, 5 sentences with no displacement clause) — built here per the
    /// spec in README-v5-handoff.md and the design contract §6, in the same
    /// voice and clause shape as the contract's five real strings.
    fileprivate static var sampleAnotherRaceLongest: V5PlanChangeProposal {
        let json = """
        {
          "ok": true,
          "applied": false,
          "scenario": "another_race",
          "verb": "Put the half in",
          "headline": "CIM Half in week 9",
          "tradeOff": "CIM Half on 12 October lands in week 9. It becomes that week\\u2019s quality session and the days either side go easy. You trade that week\\u2019s threshold session for a real fitness read 9 weeks out. The long run on 12 October is displaced eight days earlier to avoid overlap, so week 8 carries two long efforts instead of one. The rest of the block is re-authored from where you are now, so other weeks can move by a mile or two. Because this is an A race, the taper around it does not shorten, and the week that follows returns to the block\\u2019s plan exactly as written.",
          "caveats": [
            "The week mileages after this are re-authored by the plan engine, not the numbers above.",
            "The diff shows exactly what moved once it has run."
          ],
          "token": "preview-token-another-race",
          "planId": "preview-plan",
          "effect": {"weeks": [], "milesDelta": 0, "firstAffectedISO": null, "lastAffectedISO": null, "rebuilds": true},
          "changed": {"label": "CIM Half in week 9", "sub": "Replaces the threshold session"}
        }
        """
        guard let data = json.data(using: .utf8),
              let proposal = try? JSONDecoder().decode(V5PlanChangeProposal.self, from: data) else {
            fatalError("BlockV5 sample proposal JSON failed to decode")
        }
        return proposal
    }
}

extension V5PlanChangeRefusal {
    /// The design contract's own quoted refusal (§6, "the sheet must be able
    /// to refuse"): a two-week travel window is genuinely unsatisfiable.
    fileprivate static var sampleTravelRefusal: V5PlanChangeRefusal {
        let json = """
        {
          "ok": false,
          "error": "unavailable",
          "reason": "Being away that long is not a week off, it is a different block.",
          "violations": null
        }
        """
        guard let data = json.data(using: .utf8),
              let refusal = try? JSONDecoder().decode(V5PlanChangeRefusal.self, from: data) else {
            fatalError("BlockV5 sample refusal JSON failed to decode")
        }
        return refusal
    }
}

private extension Double {
    /// `34` not `34.0`, `2.9` not `2.9000000000000004` — keeps the generated
    /// sample JSON's numeric literals clean.
    var clean: String {
        let r = (self * 10).rounded() / 10
        return r == r.rounded() ? String(Int(r)) : String(format: "%.1f", r)
    }
}

// MARK: - Previews

#Preview("6a · Block") {
    BlockV5(model: .sample)
}

#Preview("6a · Change the plan — longest trade-off") {
    BlockV5(model: .sample,
            previewStage: .proposed(.sampleAnotherRaceScenario, .sampleAnotherRaceLongest))
}

#Preview("6a · Change the plan — refusal") {
    BlockV5(model: .sample,
            previewStage: .refused(.sampleTravelScenario, .sampleTravelRefusal))
}
