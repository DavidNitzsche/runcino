//
//  RacesV5.swift
//  faff.run iPhone · screen 7a, "is the A-race goal still realistic."
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE TWO AXES, AND WHY THE CARD SWITCHES ON SHAPE, NOT ON VERDICT
//
//  `model.card?.verdict` (V5Feasibility) is what the engine thinks of the goal
//  today — always present, rendered as the quiet badge via its own `.badge`.
//  `model.card?.trigger` is why we are asking now, and may be nil (the goal
//  simply drifted). Only `model.card?.shape` decides what the card RENDERS:
//
//    .decision → safe target, stretch target, up to 3 cautions, answers as
//                pill buttons naming real numbers ("Hold the goal" / "Take
//                3:16:45" / "Not now"), row WRAPS rather than clipping.
//    .fact / .choice → no target pair, no target-naming buttons — the
//                question and its own 1–2 answers as full-width rows.
//
//  Rendering `safeTarget`/`stretchTarget` or target-naming buttons under a
//  `.fact` or `.choice` card is exactly the mistake §2 of the design contract
//  warns against ("a Take 3:16:45 button under 'is it hot on race morning'
//  answers a question nobody asked") — so this file only reads those two
//  fields inside the `.decision` branch, never elsewhere.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHERE THIS FILE HAD TO INFER, AND WHAT IT CHOSE
//
//  No `/api/v5/races` route exists yet, so there is no live payload to check
//  a mapping against — the choices below are recorded so a future route
//  author can verify or correct them rather than re-derive them blind.
//
//  · V5Panel field mapping. 7a.html's hero has FOUR text lines above the
//    stats plate: a 20px line ("Races"), a 26px line ("Next A race") paired
//    with a quiet trailing line ("6 on file"), a quiet line above the 56px
//    name ("10 weeks out"), the 56px name itself ("CIM"), and a 28px line
//    ("Marathon · Dec 7"). `V5Panel.weekLine`'s own doc — "the right-hand
//    line beside the DATE" — only lines up with a 26px/quiet-trailing PAIR,
//    which is `dateLine`/`weekLine`, not `place`/`weekLine`. So: `place` =
//    "Races" (the 20px line, hardcoded text in THIS static mock but plainly
//    meant to come from data so the panel component never hardcodes a screen
//    name), `dateLine` = "Next A race", `weekLine` = "6 on file", `kicker` =
//    "10 weeks out", `type` = "CIM", `dose` = "Marathon · Dec 7".
//
//  · Day state. The task brief says "DayPanel (day state race)". 7a.html
//    itself paints the panel with `var(--g-long-panel)` (the Long-run ramp,
//    blue), not the Race ramp (orange/red) — a real disagreement between the
//    prototype's literal CSS and the brief's own instruction. Followed the
//    brief: `model.panel.fill` is read generically (never hardcoded here),
//    and the sample JSON sets `dayState: "race"` so the preview shows what
//    was asked for. Flagging this for whoever owns the actual payload.
//
//  · The "Needs a decision" label's ink. The prototype's raw token is
//    `var(--state-quality-ink)`, which is not one of TokensV5's DERIVED
//    tokens and isn't listed anywhere else in the whole handoff. Painted it
//    `V5.attention` instead — the README's own words for amber are "outside
//    its target range, stale data, A DECISION WAITING," which is a literal
//    description of this exact label, and every other "answer needed" mark
//    in the system (Alert's tone, 6a's plan refusal) already uses attention.
//
//  · The verdict badge text. `V5Feasibility.badge` (APIV5.swift) always
//    renders one of eight fixed single-concept strings ("Comfortable",
//    "Aggressive", …). The static mock's badges are richer compounds
//    ("Comfortable · realistic", "Training effort · race to lock in",
//    "Open-ended, loosely") and for the three `.fact` triggers the mock's
//    badge text ("Unchanged", "Unchanged · projection moves") isn't a
//    feasibility grade at all. Since the wire contract only carries the
//    8-case enum, this file always renders `card.verdict.badge` — the sample
//    JSON below picks the closest of the 8 cases per trigger, but for
//    weather/course/lock there isn't a good fit (the goal's feasibility is
//    simply unaffected by any of those triggers), so those three samples use
//    `.realistic` as a defensible steady-state stand-in. Worth a real
//    decision from whoever specs the route: either add a distinct
//    "unaffected" case, or accept that fact-shape cards show a genuine
//    feasibility grade alongside their unrelated question.
//
//  · V5CardAnswer carries no `sub` field. The mock's `.fact`/`.choice`
//    buttons are two lines (a bold label plus a quiet explanatory line, e.g.
//    "Acknowledge" / "The goal and pacing plan stay exactly as they are").
//    The wire struct only has `label`. Fact/choice rows below render label
//    only — a real gap between what the design draws and what the contract
//    can currently carry.
//
//  · Schedule-row reconstruction. `V5RaceRow` splits what the mock shows as
//    one string ("Half marathon · 8 Nov · 6 weeks") into `distance` and
//    `dateLine` separately. Rendered back as "`distance` · `dateLine`".
//
//  · Push to race detail (8a). `_script-data.js`'s own comment on
//    `RACE_DETAIL` says "a push from the Races schedule row," and
//    `ShellV5.swift` already carries `V5Route.raceDetail(slug:)` as a real
//    destination — but 7a.html's schedule rows only ever toggle local
//    expand-in-place (`r.onClick` flips `raceOpen`), with no push anywhere
//    in the markup, and this task's own build list says the schedule is
//    "each expandable in place." Built exactly that: local `@State`, no
//    navigation. `onEvidenceTap` is exposed as the nearest hook a composition
//    root has if 8a is meant to be reached from this screen at all.
//

import SwiftUI

// MARK: - The screen

struct RacesV5: View {
    let model: V5Races

    /// What the last answer came back as, when it came back as anything other
    /// than "done". Drawn immediately under the card that asked, because a
    /// refusal answers the question it was given and belongs beside it.
    var answerOutcome: V5WriteOutcome? = nil

    /// A decision-card or fact/choice answer was tapped. What it does next
    /// (POST it, refetch, show a toast) is the composition root's business —
    /// this screen only reports which one.
    var onAnswer: (V5CardAnswer) -> Void = { _ in }

    /// An evidence row with an `action` was tapped.
    var onEvidenceTap: (V5Row) -> Void = { _ in }
    /// Push race detail for a schedule row.
    var onOpenRace: (V5RaceRow) -> Void = { _ in }
    /// Opens the add-race sheet (`AddRaceV5`, off this screen). The design
    /// never drew this affordance — there is no mock for adding a race at
    /// all — so this reuses the exact round panel-header button the READ
    /// screens already establish (`HeaderDiscV5`, painted from
    /// `V5.OnPanel.control`, "a round header button on a panel," which the
    /// README states outright and no other Races element was using).
    var onAddRace: () -> Void = {}

    /// Identity is the server id, never the date — expand-in-place keys off
    /// `V5RaceRow.id`.
    @State private var expandedRaceID: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                heroPanel

                if let card = model.card {
                    RaceDecisionCardV5(card: card, onAnswer: onAnswer)
                }

                // Outside the `if` on purpose: an answer can be refused on a
                // payload that then comes back with no card at all, and the
                // reason must not vanish with it.
                if let answerOutcome {
                    WriteNote(outcome: answerOutcome)
                }

                RaceScheduleGroupV5(rows: model.schedule, expandedID: $expandedRaceID, onOpen: onOpenRace)

                Tile {
                    TrendBars(values: model.trend,
                              highlight: -1,
                              height: 96,
                              headline: model.trendHeadline.unreadableIfAbsent,
                              headlineLabel: "Projected finish, today",
                              footnotes: model.trendFootnotes)
                }

                ListGroup(header: "The evidence") {
                    ForEach(model.evidence) { row in
                        ListRow(label: row.label,
                                sub: row.sub,
                                value: row.value?.value,
                                valueInk: row.toneValue.inkOverride,
                                onTap: row.action != nil ? { onEvidenceTap(row) } : nil)
                    }
                }

                VStack(alignment: .leading, spacing: V5.S.s10) {
                    V5SectionLabel(text: "The log")
                        .padding(.horizontal, V5.S.s4)
                    VStack(spacing: V5.S.inGroup) {
                        ForEach(model.coachLog) { entry in
                            LogEntry(kind: entry.kind, date: entry.date, text: entry.body)
                        }
                    }
                }
            }
            .padding(.horizontal, V5.S.gutter)
            .padding(.bottom, V5.S.s24)
            // A vertical page must never pan sideways — see `v5PageWidth`.
            .v5PageWidth()
        }
        .background(V5.surfacePage)
        .scrollIndicators(.hidden)
    }

    // MARK: Hero

    /// "Next A race" + the race name at 56pt display + date/distance + a
    /// `PanelStatPlate` of Goal / Projected / Gap. Gap renders amber when
    /// the engine flags it; Projected always carries the modelled mark
    /// because a projected finish is modelled by definition.
    ///
    /// THE INK COMES FROM THE FILL, NOT FROM A CONSTANT.
    ///
    /// This screen sits ABOVE its own `DayPanel`, so `@Environment(\.v5PanelInk)`
    /// would resolve to the default white set no matter what the panel
    /// publishes underneath it — the same reason `TodayBeforeV5` computes it.
    /// Races never did, and its own sample carries `dayState: "race"`, one of
    /// the two LIGHT ramps. Every line in this panel — the place label, the
    /// date, the week line, the kicker, the race name, the dose — was drawing
    /// white on it, measured on device at 2.47:1 through 2.68:1, while the
    /// `PanelStatPlate` below them (a child, so the environment reaches it)
    /// correctly drew dark. One panel, two inks, and the half this screen
    /// owned was the failing half.
    private var panelInk: V5.PanelInk { model.panel.fill.ink }

    private var heroPanel: some View {
        DayPanel(fill: model.panel.fill) {
            HStack(alignment: .center, spacing: V5.S.s12) {
                Text(model.panel.place)
                    .font(.faffDisplay(20))
                    .textCase(.uppercase)
                    .tracking(20 * 0.02)
                    .foregroundStyle(panelInk.primary)
                Spacer(minLength: V5.S.s12)
                // Alone on its side of the header, so it takes the full 44.
                HeaderDiscV5(glyph: .symbol("plus"),
                             label: "Add a race",
                             action: onAddRace)
            }

            HStack(alignment: .lastTextBaseline, spacing: V5.S.s12) {
                Text(model.panel.dateLine)
                    .faffDisplayV5(26, fit: .free)
                    .foregroundStyle(panelInk.primary)
                Spacer(minLength: 0)
                if let weekLine = model.panel.weekLine {
                    Text(weekLine)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(panelInk.secondary)
                }
            }

            VStack(alignment: .leading, spacing: V5.S.s2) {
                if let kicker = model.panel.kicker {
                    Text(kicker)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(panelInk.secondary)
                }
                // A race name is a proper noun of arbitrary length, not a
                // category word. "MY HALF MARATHON" needs 778pt at 56 and
                // truncated to "MY HALF MARATH…" even at the scale floor.
                // Names wrap; the one-word graphics (session type, phase) fit.
                Text(model.panel.type)
                    .faffDisplayV5(TypeScaleV5.display56, fit: .name)
                    .foregroundStyle(panelInk.primary)
            }

            FaffValueText(model.panel.dose.unreadableIfAbsent,
                          font: .faffText(28, weight: .semibold),
                          color: panelInk.primary, mark: panelInk.mark)

            // The DECODED tone, not the raw string. `s.tone == "attention"`
            // matched one of four cases: `fault` and `signal` both fell
            // through to nil, so a value the engine said it could not read
            // was inked exactly like one it could. `inkOverride` keeps
            // neutral nil so the plate holds its own on-panel ink.
            PanelStatPlate(stats: model.panel.stats.map { s in
                PanelStat(s.label, s.value.value, ink: s.toneValue.inkOverride)
            })
        }
    }
}

// MARK: - The decision card

/// Two bodies under one identical top, switched on `shape` — never on
/// `verdict`, and never by checking whether `safeTarget`/`stretchTarget`
/// happen to be present (a `.fact` payload could carry them and still must
/// not draw them).
struct RaceDecisionCardV5: View {
    let card: V5DecisionCard
    let onAnswer: (V5CardAnswer) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            HStack(alignment: .center, spacing: V5.S.s10) {
                V5SectionLabel(text: "Needs a decision", color: V5.attention, size: TypeScaleV5.label12)
                Spacer(minLength: V5.S.s10)
                Text(card.verdict.badge)
                    .font(.faffText(TypeScaleV5.label12))
                    .foregroundStyle(V5.textQuiet)
            }

            Text(card.question)
                .font(.faffText(TypeScaleV5.body17))
                .foregroundStyle(V5.textPrimary)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)

            if case .decision = card.shape {
                HStack(spacing: V5.S.s10) {
                    if let safe = card.safeTarget {
                        targetTile(label: "Safe target", value: safe.value)
                    }
                    if let stretch = card.stretchTarget {
                        targetTile(label: "Stretch target", value: stretch.value)
                    }
                }
            }

            if !card.cautions.isEmpty {
                VStack(alignment: .leading, spacing: V5.S.s8) {
                    ForEach(card.cautions, id: \.self) { text in
                        HStack(alignment: .top, spacing: V5.S.s10) {
                            Circle()
                                .fill(V5.attention)
                                .frame(width: 5, height: 5)
                                .padding(.top, V5.S.s6)
                            Text(text)
                                .font(.faffText(TypeScaleV5.label14))
                                .foregroundStyle(V5.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }

            switch card.shape {
            case .decision:
                // "The button row must wrap so a longer label like 'Wait for
                // Saturday' drops to its own line instead of clipping" — a
                // wrapping Layout, never an HStack that would just clip.
                FlowLayoutV5(spacing: V5.S.s8, lineSpacing: V5.S.s8) {
                    ForEach(card.answers) { answer in
                        DecisionAnswerButtonV5(answer: answer) { onAnswer(answer) }
                    }
                }
            case .fact, .choice:
                // No safe/stretch pair, no target-naming buttons — just the
                // question (already shown above) and its own answers.
                VStack(alignment: .leading, spacing: V5.S.s8) {
                    ForEach(card.answers) { answer in
                        FactAnswerRowV5(answer: answer) { onAnswer(answer) }
                    }
                }
            }
        }
        .padding(V5.S.tilePad)
        .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
    }

    private func targetTile(label: String, value: FaffValue) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s4) {
            Text(label)
                .font(.faffText(TypeScaleV5.label12))
                .foregroundStyle(V5.textQuiet)
            FaffValueText(value, font: .faffText(20, weight: .semibold))
                // Two tiles side by side inside a padded card is about 150pt
                // each. At the first accessibility text size the stretch
                // target came out as "~3:16:4" on one line and "5" beneath —
                // the same shattered-figure failure as the panel plate, in
                // the one place the runner is being asked to accept or refuse
                // that exact number. A target you cannot read is not a
                // decision you can make.
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, V5.S.s14)
        .padding(.vertical, V5.S.s12)
        .background(V5.materialTileRaised, in: RoundedRectangle(cornerRadius: V5.R.r16, style: .continuous))
    }
}

/// A `.decision` shape's pill button — "Hold the goal" / "Take 3:16:45" /
/// "Not now", styled from the answer's `action` verb since the wire contract
/// carries no per-answer style.
private struct DecisionAnswerButtonV5: View {
    let answer: V5CardAnswer
    let action: () -> Void

    private var fill: Color {
        switch answer.action {
        case "hold": return V5.materialAction
        case "take": return V5.materialTileRaised
        default:     return .clear
        }
    }
    private var ink: Color {
        switch answer.action {
        case "hold": return V5.actionPrimaryText
        case "take": return V5.textPrimary
        default:     return V5.textSecondary
        }
    }
    private var weight: InstrumentWeight { answer.action == "hold" ? .bold : .semibold }

    var body: some View {
        Button(action: action) {
            Text(answer.label)
                .font(.faffText(14, weight: weight))
                .foregroundStyle(ink)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .padding(.horizontal, V5.S.s12)
                .frame(minWidth: 96, minHeight: 44)
                .background(fill, in: Capsule(style: .continuous))
                // "NOT NOW" WAS TAPPABLE ON ITS LETTERS AND NOWHERE ELSE.
                //
                // The ghost variant's fill is `Color.clear`, and clear is not
                // hit-testable in SwiftUI — the same trap `ListRow` records
                // two files away. Measured live, the button's target was
                // 56×17: the glyphs, not the pill. The other two came in at
                // 42 tall, two points under Apple's minimum.
                //
                // The pill is drawn exactly as before. 42 → 44 is the two
                // points that make the target legal, taken inside a layout
                // that already wraps, so nothing is pushed off a line.
                .contentShape(Capsule(style: .continuous))
        }
        .buttonStyle(V5PressStyle())
    }
}

/// A `.fact`/`.choice` shape's own row — full width, left aligned, no
/// target-naming, no pill.
private struct FactAnswerRowV5: View {
    let answer: V5CardAnswer
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(answer.label)
                .font(.faffText(15, weight: .semibold))
                .foregroundStyle(V5.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, V5.S.s14)
                .padding(.vertical, V5.S.s12)
                .background(V5.materialTileRaised, in: RoundedRectangle(cornerRadius: V5.R.r16, style: .continuous))
        }
        .buttonStyle(V5PressStyle())
    }
}

/// A simple wrap layout: natural width per button, onto as many lines as it
/// takes. Satisfies "the row wraps rather than clipping" without needing the
/// prototype's literal flex ratios, which have no equivalent worth forcing
/// through SwiftUI's `Layout` protocol for three buttons.
struct FlowLayoutV5: Layout {
    var spacing: CGFloat = V5.S.s8
    var lineSpacing: CGFloat = V5.S.s8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, lineHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += lineHeight + lineSpacing
                lineHeight = 0
            }
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
        y += lineHeight
        return CGSize(width: width.isFinite ? width : x, height: y)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, lineHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += lineHeight + lineSpacing
                lineHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}

// MARK: - The schedule

/// The full six-race schedule: upcoming ranked A/B/C in colour, past dimmed,
/// each expandable in place.
struct RaceScheduleGroupV5: View {
    let rows: [V5RaceRow]
    @Binding var expandedID: String?
    /// Pushes race detail (8a). The README is explicit that 8a is "pushed
    /// from a schedule row on Races" — the prototype's markup only ever
    /// toggles the expansion, so the first build read it as expand-only and
    /// left the whole screen unreachable. The expansion keeps its rows AND
    /// carries the way in.
    var onOpen: (V5RaceRow) -> Void = { _ in }

    /// ─────────────────────────────────────────────────────────────────────
    /// AHEAD AND BEHIND ARE TWO DIFFERENT LISTS
    ///
    /// The design says "upcoming ranked A/B/C in colour, past races dimmed",
    /// and the first build honoured the colour half but ran both into one
    /// unbroken list. On a real schedule — five ahead, six behind — the only
    /// thing telling them apart was whether a finish time happened to be on
    /// the row, which means the runner reads every row to find the boundary.
    ///
    /// They are separate questions. Ahead is what you are training for; behind
    /// is what you have done. Two groups, own headers, and the past group
    /// dimmed as the design asks.
    private var upcoming: [V5RaceRow] { rows.filter { !$0.isPast } }
    private var past: [V5RaceRow] { rows.filter(\.isPast) }

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
            if !upcoming.isEmpty {
                group("The schedule", upcoming)
            }
            if !past.isEmpty {
                // "Completed", not "Run" — the tab bar already owns RUN as a
                // verb, and a header reading RUN over a list of finished races
                // asks the runner to work out which sense is meant.
                group("Completed", past)
                    // "Past races dimmed." One step back, so they read as
                    // history without becoming unreadable.
                    .opacity(0.62)
            }
        }
    }

    private func group(_ header: String, _ items: [V5RaceRow]) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s10) {
            HStack(alignment: .firstTextBaseline) {
                V5SectionLabel(text: header)
                Spacer(minLength: 0)
                Text("\(items.count)")
                    .font(.faffText(TypeScaleV5.label12))
                    .foregroundStyle(V5.textQuiet)
            }
            .padding(.horizontal, V5.S.s4)

            VStack(spacing: 0) {
                ForEach(items) { row in
                    RaceScheduleRowV5(row: row,
                                      isExpanded: expandedID == row.id,
                                      onOpen: { onOpen(row) }) {
                        withAnimation(V5.Motion.expand) {
                            expandedID = (expandedID == row.id) ? nil : row.id
                        }
                    }
                }
            }
            .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
        }
    }
}

private struct RaceScheduleRowV5: View {
    let row: V5RaceRow
    let isExpanded: Bool
    let onOpen: () -> Void
    let onTap: () -> Void

    /// The upcoming A race — the one the season is currently pointed at.
    /// The wire contract carries no explicit "is this the next one" flag, so
    /// this mirrors the prototype's own predicate (`rank === 'A' && !done`)
    /// exactly, which also naturally covers the two-A-races-conflict trigger
    /// without extra logic: both upcoming A rows read as "next" at once.
    private var isNextA: Bool { rank == "A" && !row.isPast }

    /// Nil unless the engine actually gave this race a rank.
    private var rank: String? {
        let r = row.priority.uppercased()
        return ["A", "B", "C"].contains(r) ? r : nil
    }

    var body: some View {
        VStack(spacing: 0) {
            Button(action: onTap) {
                HStack(spacing: V5.S.s12) {
                    // A / B / C are the ranks. Anything else is not a rank —
                    // one race came through carrying "high", which rendered as
                    // a truncated "hi…" in a badge that means priority. An
                    // unranked race gets no badge rather than a wrong one.
                    Text(rank ?? "")
                        .font(.faffText(12, weight: .bold))
                        .foregroundStyle(isNextA ? V5.actionPrimaryText : V5.textSecondary)
                        .frame(width: 26, height: 26)
                        .background(rank == nil ? Color.clear
                                    : (isNextA ? V5.signal : V5.materialControl),
                                    in: RoundedRectangle(cornerRadius: 8, style: .continuous))

                    VStack(alignment: .leading, spacing: V5.S.s2) {
                        Text(row.name)
                            .font(.faffText(15, weight: isNextA ? .bold : .regular))
                            .foregroundStyle(row.isPast ? V5.textSecondary : V5.textPrimary)
                        // A past race often carries no distance label, which
                        // left a dangling "· 2026-05-03" hanging off nothing.
                        Text([row.distance, row.dateLine]
                                .filter { !$0.isEmpty }
                                .joined(separator: " \u{b7} "))
                            .font(.faffText(TypeScaleV5.label12))
                            .foregroundStyle(V5.textQuiet)
                    }

                    Spacer(minLength: V5.S.s8)

                    // A race that has not been run has no result, and that is
                    // not a result we failed to read. nil draws nothing; the
                    // fault-red dash used to sit on every upcoming race and
                    // claim we could not read five results that do not exist.
                    if let result = row.result?.value {
                        FaffValueText(result,
                                      font: .faffText(TypeScaleV5.body15),
                                      color: row.isPast ? V5.textSecondary : (isNextA ? V5.textPrimary : V5.textSecondary))
                            .lineLimit(1)
                    }
                }
                .padding(.horizontal, V5.S.tilePad)
                .frame(minHeight: 58)
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
                .background(isExpanded ? V5.materialControl : Color.clear)
            }
            .buttonStyle(V5PressStyle())
            .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")

            if isExpanded {
                VStack(alignment: .leading, spacing: V5.S.s10) {
                    ForEach(row.detail) { d in
                        HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
                            Text(d.label)
                                .font(.faffText(TypeScaleV5.body15))
                                .foregroundStyle(V5.textPrimary)
                            Spacer(minLength: 0)
                            if let v = d.value?.value {
                                // The engine's tone, honoured. Dropping it
                                // put "Status · Watch time · chip time to
                                // lock in" in quiet grey — the design's own
                                // word for amber is "a decision waiting",
                                // and an unlocked chip time is exactly that.
                                FaffValueText(v,
                                              font: .faffText(TypeScaleV5.body15),
                                              color: d.toneValue.inkOverride ?? V5.textSecondary)
                            }
                        }
                    }

                    // The way into race detail. Expand-in-place answers "what
                    // is this race"; the pushed screen answers "how am I going
                    // to run it", and the design has both.
                    ListRow(label: "Race detail",
                            sub: "Course, pace plan, taper, gear",
                            onTap: onOpen)
                        .padding(.horizontal, -V5.S.tilePad)
                }
                .padding(.horizontal, V5.S.tilePad)
                .padding(.vertical, V5.S.s10)
                .background(V5.materialTileRaised)
                .transition(.opacity)
            }
        }
    }
}

// MARK: - Preview samples
//
// Built from JSON + `JSONDecoder`, per the brief — not `V5Races(panel:
// card: …)` struct literals — so a preview exercises the exact decode path
// a real payload would go through, lenient extensions included.

enum RacesV5Sample {

    struct Spec {
        let shape: String        // "decision" | "fact" | "choice"
        let verdict: String      // one of V5Feasibility's 8 raw values
        let question: String
        let cautions: [String]
        let safeTarget: String?
        let stretchTarget: String?
        let answers: [(id: String, label: String, action: String, targetSec: Double?)]
        let goal: String
        let gap: String
        let gapAttention: Bool
    }

    static let specs: [(key: String, spec: Spec)] = [
        ("ahead", Spec(
            shape: "decision", verdict: "comfortable",
            question: "Fitness now supports more than the plan asked for \u{b7} VDOT reads at 51.2 against a goal that only needed 49.8.",
            cautions: [
                "Only two long runs have touched marathon effort",
                "The last hard week ran short on sleep",
                "Chip time locks four weeks out, not sooner"
            ],
            safeTarget: "Sub 3:30", stretchTarget: "3:16:45",
            answers: [
                ("hold", "Hold the goal", "hold", nil),
                ("take", "Take 3:16:45", "take", 11805),
                ("not_now", "Not now", "not_now", nil)
            ],
            goal: "Sub 3:30", gap: "+2:56", gapAttention: false
        )),
        ("behind", Spec(
            shape: "decision", verdict: "aggressive",
            question: "The goal needs more than today\u{2019}s fitness shows \u{b7} VDOT reads 46.1 against the 49.8 that Sub 3:30 requires, with eight weeks left to close it.",
            cautions: [
                "Long runs have stalled at 12 mi for three weeks",
                "Two threshold sessions were cut short this block",
                "Eight weeks is tight for a gap this size"
            ],
            safeTarget: "Sub 3:42", stretchTarget: "Sub 3:30",
            answers: [
                ("hold", "Hold the goal", "hold", nil),
                ("take", "Take Sub 3:42", "take", nil),
                ("not_now", "Not now", "not_now", nil)
            ],
            goal: "Sub 3:30", gap: "\u{2212}4:10", gapAttention: true
        )),
        ("stale", Spec(
            shape: "decision", verdict: "unreadable",
            question: "The last real evidence is 19 days old \u{b7} nothing since has touched marathon effort, so today\u{2019}s number is a guess wearing a decimal point.",
            cautions: [
                "No run above 10 mi since the 19-day mark",
                "The next real test is not until Saturday",
                "Chip time locks in five weeks, not sooner"
            ],
            safeTarget: "Sub 3:30", stretchTarget: "3:16:45",
            answers: [
                ("hold", "Hold the goal", "hold", nil),
                ("take", "Take 3:16:45", "take", 11805),
                ("wait", "Wait for Saturday", "not_now", nil)
            ],
            goal: "Sub 3:30", gap: "+2:56", gapAttention: false
        )),
        ("injury", Spec(
            shape: "decision", verdict: "outOfReach",
            question: "Sub 3:30 was set before the calf flare \u{b7} four weeks back running is not four weeks of marathon buildup.",
            cautions: [
                "Longest run back is 9 mi, not 20",
                "The calf has not been tested above threshold",
                "Six weeks remain to rebuild what three months lost"
            ],
            safeTarget: "Finish healthy", stretchTarget: "Sub 3:30",
            answers: [
                ("hold", "Hold the goal", "hold", nil),
                ("take", "Take finish healthy", "take", nil),
                ("not_now", "Not now", "not_now", nil)
            ],
            goal: "Sub 3:30", gap: "\u{2014}", gapAttention: false
        )),
        ("course", Spec(
            shape: "fact", verdict: "realistic",
            question: "The final six miles were rerouted uphill this week \u{b7} we can see the elevation moved, we cannot know which course you will actually race.",
            cautions: [
                "312 ft more climb than the original route",
                "No long run has touched a grade like mile 24",
                "The race director has not confirmed a certified time"
            ],
            safeTarget: nil, stretchTarget: nil,
            answers: [
                ("ack", "Acknowledge", "acknowledge", nil)
            ],
            goal: "Sub 3:30", gap: "+2:56", gapAttention: false
        )),
        ("lock", Spec(
            shape: "fact", verdict: "realistic",
            question: "Chip time locks Friday \u{b7} confirm the official time now, or leave it provisional until then.",
            cautions: [
                "Two more long runs before the lock, not four",
                "VDOT has moved twice already this block",
                "A wrong guess here means the wrong corral all day"
            ],
            safeTarget: nil, stretchTarget: nil,
            answers: [
                ("confirm", "Confirm official time", "confirm", nil),
                ("provisional", "Leave it provisional", "leave", nil)
            ],
            goal: "Sub 3:30", gap: "+2:56", gapAttention: false
        )),
        ("races", Spec(
            shape: "choice", verdict: "openEnded",
            question: "CIM and the half in October are both marked A \u{b7} the plan can peak for one, not both \u{b7} which one is the goal.",
            cautions: [
                "The half sits five weeks before CIM",
                "Peaking twice costs both a full taper",
                "Only one can keep the current long-run ramp"
            ],
            safeTarget: nil, stretchTarget: nil,
            answers: [
                ("cim", "CIM is the goal", "choose_race", nil),
                ("half", "The half is the goal", "choose_race", nil)
            ],
            goal: "Sub 3:30", gap: "+2:56", gapAttention: false
        ))
    ]

    private static let scheduleJSON = """
    [
      {
        "id": "clarksburg-half", "slug": "clarksburg-half", "name": "Clarksburg Half",
        "dateLine": "8 Nov \u{b7} 6 weeks", "distance": "Half marathon", "priority": "B", "isPast": false,
        "result": {"text": "Sub 1:36", "modelled": true},
        "detail": [
          {"id": "cb-1", "label": "Why it is on here", "sub": null, "value": {"text": "A real read", "modelled": false}, "action": null},
          {"id": "cb-2", "label": "Taper", "sub": null, "value": {"text": "Three easy days", "modelled": false}, "action": null},
          {"id": "cb-3", "label": "Reads as", "sub": null, "value": {"text": "VDOT 49 if hit", "modelled": true}, "action": null}
        ],
        "authority": null
      },
      {
        "id": "davis-turkey-trot", "slug": "davis-turkey-trot", "name": "Davis Turkey Trot",
        "dateLine": "27 Nov \u{b7} 9 weeks", "distance": "10k", "priority": "C", "isPast": false,
        "result": {"text": "No taper", "modelled": false},
        "detail": [
          {"id": "dt-1", "label": "Why it is on here", "sub": null, "value": {"text": "It is fun", "modelled": false}, "action": null},
          {"id": "dt-2", "label": "Taper", "sub": null, "value": {"text": "None", "modelled": false}, "action": null},
          {"id": "dt-3", "label": "Counts toward", "sub": null, "value": {"text": "Nothing", "modelled": false}, "action": null}
        ],
        "authority": null
      },
      {
        "id": "cim-2026", "slug": "cim", "name": "CIM",
        "dateLine": "7 Dec \u{b7} 10 weeks", "distance": "Marathon", "priority": "A", "isPast": false,
        "result": {"text": "Sub 3:30", "modelled": false},
        "detail": [
          {"id": "cim-1", "label": "The plan is written for this", "sub": null, "value": {"text": "16 weeks", "modelled": false}, "action": null},
          {"id": "cim-2", "label": "Taper", "sub": null, "value": {"text": "Three weeks", "modelled": false}, "action": null},
          {"id": "cim-3", "label": "Course", "sub": null, "value": {"text": "Net downhill", "modelled": false}, "action": null}
        ],
        "authority": null
      },
      {
        "id": "summer-breeze-half", "slug": "summer-breeze-half", "name": "Summer Breeze Half",
        "dateLine": "16 Jul", "distance": "Half marathon", "priority": "B", "isPast": true,
        "result": {"text": "1:38:12", "modelled": false},
        "detail": [
          {"id": "sb-1", "label": "Read", "sub": null, "value": {"text": "VDOT 47.9", "modelled": true}, "action": null},
          {"id": "sb-2", "label": "Weight", "sub": null, "value": {"text": "Full for 7 more days", "modelled": false}, "action": null},
          {"id": "sb-3", "label": "Against goal", "sub": null, "value": {"text": "2:14 short", "modelled": false}, "action": null}
        ],
        "authority": "representative"
      },
      {
        "id": "bay-bridge-10k", "slug": "bay-bridge-10k", "name": "Bay Bridge 10k",
        "dateLine": "4 May", "distance": "10k", "priority": "C", "isPast": true,
        "result": {"text": "41:20", "modelled": false},
        "detail": [
          {"id": "bb-1", "label": "Read", "sub": null, "value": {"text": "VDOT 46.2", "modelled": true}, "action": null},
          {"id": "bb-2", "label": "Weight", "sub": null, "value": {"text": "Decayed to nothing", "modelled": false}, "action": null},
          {"id": "bb-3", "label": "Against goal", "sub": null, "value": {"text": "Not comparable", "modelled": false}, "action": null}
        ],
        "authority": null
      },
      {
        "id": "cim-2025", "slug": "cim-2025", "name": "CIM",
        "dateLine": "8 Dec, last year", "distance": "Marathon", "priority": "A", "isPast": true,
        "result": {"text": "3:52:40", "modelled": false},
        "detail": [
          {"id": "c25-1", "label": "Read", "sub": null, "value": {"text": "VDOT 43.8", "modelled": true}, "action": null},
          {"id": "c25-2", "label": "Weight", "sub": null, "value": {"text": "History only", "modelled": false}, "action": null},
          {"id": "c25-3", "label": "To beat", "sub": null, "value": {"text": "22:40 quicker", "modelled": false}, "action": null}
        ],
        "authority": null
      }
    ]
    """

    private static let evidenceJSON = """
    [
      {"id": "ev-fitness", "label": "Fitness", "sub": "49.8 needed for Sub 3:30", "value": {"text": "VDOT 47.9", "modelled": false}, "action": null},
      {"id": "ev-last-race", "label": "Last race", "sub": "Half marathon, 16 Jul \u{b7} full weight for 7 more days", "value": {"text": "63 days ago", "modelled": false}, "action": "open_race"}
    ]
    """

    private static let logJSON = """
    [
      {"id": "log-1", "kind": "week-close", "date": "14 Sep", "body": "42.1 mi of 44 planned \u{b7} both quality days landed."},
      {"id": "log-2", "kind": "first", "date": "7 Sep", "body": "Longest run you have ever logged \u{b7} 18.2 mi. Old mark 16.4."},
      {"id": "log-3", "kind": "phase", "date": "24 Aug", "body": "Base done \u{b7} 8 weeks, 240 mi, long run 10 to 16. Build starts today."},
      {"id": "log-4", "kind": "discipline", "date": "18 Aug", "body": "Your last five easy days averaged 79% of max. Easy is 65 to 75 \u{b7} run them under 148 and let the pace fall where it wants."}
    ]
    """

    private static let trendJSON = "[62,60,57,54,51,48,45,42,39,36,33,31,29,27,25,23,21,20,19,18,17,17,18,19,21,24,27,31,36,42]"

    private static func cardJSON(_ s: Spec, key: String) -> String {
        let targetsJSON: String
        if s.shape == "decision" {
            targetsJSON = """
            "safeTarget": {"text": "\(s.safeTarget ?? "")", "modelled": true},
            "stretchTarget": {"text": "\(s.stretchTarget ?? "")", "modelled": true},
            """
        } else {
            targetsJSON = """
            "safeTarget": null,
            "stretchTarget": null,
            """
        }
        let cautionsJSON = s.cautions.map { "\"\($0)\"" }.joined(separator: ",\n    ")
        let answersJSON = s.answers.map { a in
            let ts = a.targetSec.map { String($0) } ?? "null"
            return "{\"id\": \"\(a.id)\", \"label\": \"\(a.label)\", \"action\": \"\(a.action)\", \"targetSec\": \(ts)}"
        }.joined(separator: ",\n    ")

        return """
        {
          "shape": "\(s.shape)",
          "verdict": "\(s.verdict)",
          "trigger": "\(key)",
          "question": "\(s.question)",
          \(targetsJSON)
          "cautions": [
            \(cautionsJSON)
          ],
          "answers": [
            \(answersJSON)
          ]
        }
        """
    }

    private static func fullJSON(key: String, spec s: Spec) -> String {
        let gapTone = s.gapAttention ? "\"attention\"" : "null"
        return """
        {
          "panel": {
            "dayState": "race",
            "quiet": false,
            "place": "Races",
            "dateLine": "Next A race",
            "weekLine": "6 on file",
            "kicker": "10 weeks out",
            "type": "CIM",
            "dose": {"text": "Marathon \u{b7} Dec 7", "modelled": false},
            "stats": [
              {"label": "Goal", "value": {"text": "\(s.goal)", "modelled": false}, "tone": null},
              {"label": "Projected", "value": {"text": "3:16:45", "modelled": true}, "tone": null},
              {"label": "Gap", "value": {"text": "\(s.gap)", "modelled": false}, "tone": \(gapTone)}
            ]
          },
          "card": \(cardJSON(s, key: key)),
          "schedule": \(scheduleJSON),
          "trend": \(trendJSON),
          "trendHeadline": {"text": "3:16:45", "modelled": true},
          "trendFootnotes": ["Twelve weeks of daily reads", "Best read so far 3:18"],
          "evidence": \(evidenceJSON),
          "coachLog": \(logJSON)
        }
        """
    }

    static func decode(_ key: String) -> V5Races {
        guard let entry = specs.first(where: { $0.key == key }) else {
            fatalError("RacesV5Sample: no spec for '\(key)'")
        }
        let data = Data(fullJSON(key: entry.key, spec: entry.spec).utf8)
        do {
            return try JSONDecoder().decode(V5Races.self, from: data)
        } catch {
            fatalError("RacesV5Sample: failed to decode '\(key)' — \(error)")
        }
    }
}

extension RacesV5 {
    /// The default sample — an A race with a live decision, fitness ahead of
    /// the goal.
    static let sample: V5Races = RacesV5Sample.decode("ahead")
}

// MARK: - Previews · every one of the 7 verdicts, both shapes

#Preview("Ahead \u{b7} decision") {
    RacesV5(model: RacesV5.sample)
}

#Preview("Behind \u{b7} decision") {
    RacesV5(model: RacesV5Sample.decode("behind"))
}

#Preview("Stale \u{b7} decision") {
    RacesV5(model: RacesV5Sample.decode("stale"))
}

#Preview("Injury \u{b7} decision") {
    RacesV5(model: RacesV5Sample.decode("injury"))
}

#Preview("Course changed \u{b7} fact") {
    RacesV5(model: RacesV5Sample.decode("course"))
}

#Preview("Chip-time lock \u{b7} fact") {
    RacesV5(model: RacesV5Sample.decode("lock"))
}

#Preview("Two A races \u{b7} choice") {
    RacesV5(model: RacesV5Sample.decode("races"))
}
