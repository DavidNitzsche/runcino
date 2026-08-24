//
//  TodayAfterV5.swift
//  faff.run iPhone · Today, after the run (5b) and after a treadmill run (5c).
//
//  One view, one difference: 5c swaps the route/elevation card for an
//  "On the belt" card. The engine drives the swap — `model.onTheBelt != nil`
//  means treadmill, `model.elevation` means outdoor — this view does not
//  infer it from anything else. The treadmill kicker ("Treadmill · indoor,
//  no GPS") is server copy via `panel.kicker`; this view does not compose it.
//
//  Same panel grammar as before the run (`docs/design/iphone-v5` 5a), but the
//  poster reads distance/time/pace instead of a prescription, and the panel's
//  `weekLine` carries "Logged HH:MM" instead of "Week N of M" — both already
//  the server's job, not this view's.
//
//  RULE ONE, concretely: every number on this screen — the poster's
//  distance/time/pace, the asked-vs-ran readings, the per-mile numbers, the
//  belt's speed/incline, the route's climb — arrives through `V5Number` and
//  reaches the screen only through `FaffValueText`. Nothing here decides
//  measured vs modelled; the payload says.
//
//  RULE THREE, concretely: `V5Row.value` is doubly optional on the wire for a
//  reason — `nil` means this row has no value cell, a present `V5Number` with
//  a `nil` text means we could not read it (fault red). `fv(_:)` below keeps
//  that distinction; collapsing it to a single `.unreadable` default would
//  turn every row without a value into a false "could not read this".
//

import SwiftUI
import Foundation

struct TodayAfterV5: View {
    /// Same rule as the before-run screen: the ink comes from the same
    /// value the panel is filled with, computed here rather than read from
    /// the environment, because this view sits ABOVE the panel that
    /// publishes it.
    private var panelFill: PanelFill { viewingDayLabel != nil ? .quiet : model.panel.fill }
    private var panelInk: V5.PanelInk { panelFill.ink }
    let model: V5Today

    var onOpenAccount: () -> Void
    /// The runner answered "how hard was it". Leaves the screen: the caller
    /// persists it.
    var onLogEffort: (Int) -> Void
    /// A body part was picked in the niggle picker. Leaves the screen: the
    /// caller persists it.
    var onFlagNiggle: (String) -> Void
    /// "See it in Injury" — this view does not navigate.
    var onOpenInjuryFlare: () -> Void
    /// Tapping the shoe row, when the server marked it actionable.
    var onChangeShoe: () -> Void
    /// Any `whatThisDidToTheWeek` row the server marked actionable, other
    /// than the niggle row this view composes itself.
    var onRowAction: (V5Row) -> Void
    var onPushStrava: () -> Void
    /// Day stepping, shared with the before-run screen — a finished day is
    /// just as steppable as a planned one.
    /// A day in the strip was tapped. The id is the plan row's server id, the
    /// same contract `TodayBeforeV5` uses — identity is never the date.
    var onPickDay: (String) -> Void = { _ in }
    var viewingDayLabel: String? = nil
    var onBackToToday: (() -> Void)? = nil
    var initials: String? = nil
    /// Job 1 · "report sick" — a runner who just finished and feels off
    /// should not have to wait for tomorrow's Today to say so. Same
    /// expand-in-place row as the before-run screen; see `SickV5.swift`.
    var onReportSick: (_ symptoms: [String], _ started: String, _ hasFever: Bool) -> Void = { _, _, _ in }

    /// Which asked-vs-ran / per-mile row is expanded in place. Keyed by the
    /// row's own server id, per the "identity is the server id" rule — never
    /// a single shared bool, so a future payload with more than one
    /// actionable row would not cross-wire two rows to one disclosure.
    @State private var expandedRowID: String?
    @State private var pendingEffort: Int?

    @State private var niggleOpen = false
    @State private var niggleFlagged: String?

    @State private var stravaSent = false

    /// Fixed body-part list for the in-place niggle picker. Not on the wire —
    /// `V5Row` carries no child options — and stable across runners, so it is
    /// a local constant rather than a server round trip, matching the
    /// prototype's own fixed list.
    private static let bodyParts = ["Left calf", "Right calf", "Achilles", "Knee", "Hip", "Foot"]

    init(model: V5Today,
         onOpenAccount: @escaping () -> Void = {},
         onLogEffort: @escaping (Int) -> Void = { _ in },
         onFlagNiggle: @escaping (String) -> Void = { _ in },
         onOpenInjuryFlare: @escaping () -> Void = {},
         onChangeShoe: @escaping () -> Void = {},
         onRowAction: @escaping (V5Row) -> Void = { _ in },
         onPushStrava: @escaping () -> Void = {},
         onPickDay: @escaping (String) -> Void = { _ in },
         viewingDayLabel: String? = nil,
         onBackToToday: (() -> Void)? = nil,
         initials: String? = nil,
         onReportSick: @escaping (_ symptoms: [String], _ started: String, _ hasFever: Bool) -> Void = { _, _, _ in }) {
        self.viewingDayLabel = viewingDayLabel
        self.onBackToToday = onBackToToday
        self.initials = initials
        self.model = model
        self.onOpenAccount = onOpenAccount
        self.onLogEffort = onLogEffort
        self.onFlagNiggle = onFlagNiggle
        self.onOpenInjuryFlare = onOpenInjuryFlare
        self.onChangeShoe = onChangeShoe
        self.onRowAction = onRowAction
        self.onPushStrava = onPushStrava
        self.onPickDay = onPickDay
        self.onReportSick = onReportSick

        // The one row the server marks actionable in this table is effort.
        // If it has not been answered yet, the scale opens by default —
        // the prototype's own behaviour — rather than waiting for a tap.
        let effortRow = model.askedVsRan.first(where: { $0.action != nil })
        let notAnswered = effortRow?.value?.text == nil
        _expandedRowID = State(initialValue: notAnswered ? effortRow?.id : nil)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                panel
                askedVsRanSection
                if let verdict = model.verdict, !verdict.isEmpty {
                    CoachSay(text: verdict, size: .md)
                }
                if !model.groups.isEmpty {
                    groupsTile
                }
                if let shares = model.zoneShares, !shares.isEmpty {
                    zoneTile(shares)
                }
                routeOrBeltCard
                if let shoe = model.shoesWorn {
                    ListGroup(header: "Shoes you wore") {
                        ListRow(label: shoe.label, sub: shoe.sub, value: Self.fv(shoe.value),
                                onTap: shoe.action != nil ? onChangeShoe : nil)
                    }
                }
                whatThisDidSection
                if niggleFlagged != nil {
                    niggleLink
                }
                SickReportRowV5(onReport: onReportSick)
                FaffButton(stravaSent ? "Sent to Strava" : "Send it to Strava",
                           variant: stravaSent ? .secondary : .primary,
                           size: .lg) {
                    stravaSent = true
                    onPushStrava()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, V5.S.gutter)
            .padding(.bottom, V5.S.s24)
        }
        .background(V5.surfacePage)
        .scrollIndicators(.hidden)
    }

    // MARK: - Panel

    private var panel: some View {
        // 22b. Same rule as the before-run screen: the gradient means today.
        // This is the screen a tapped past "Done" row actually lands on, so it
        // is the one that carries 22b most of the time.
        DayPanel(fill: panelFill) {
            PlaceHeaderV5(place: model.panel.place,
                          viewingDayLabel: viewingDayLabel,
                          onBackToToday: onBackToToday,
                          onCalendar: nil,
                          initials: initials,
                          onAccount: onOpenAccount)

            HStack(alignment: .lastTextBaseline, spacing: V5.S.s12) {
                Text(model.panel.dateLine)
                    .font(.faffDisplay(26))
                    .foregroundStyle(panelInk.primary)
                Spacer(minLength: 0)
                if let weekLine = model.panel.weekLine {
                    Text(weekLine)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(panelInk.secondary)
                }
            }

            // The strip is a WAY THROUGH THE WEEK on every state that shows
            // it, not only the one before the run. It was inert here — which
            // is the state the runner is in for most of the day once they
            // have run.
            // No week strip on a stepped-to day — it marks today, and it is
            // the control that got you here.
            if viewingDayLabel == nil {
                WeekStripV5(days: model.weekStrip.map { $0.strip },
                            onTap: { day in onPickDay(day.id) })
            }

            VStack(alignment: .leading, spacing: V5.S.s2) {
                if let kicker = model.panel.kicker {
                    Text(kicker)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(panelInk.secondary)
                }
                Text(model.panel.type)
                    .faffDisplayV5(56)
                    .foregroundStyle(panelInk.primary)
            }

            posterStatsRow
        }
    }

    /// Distance / time / pace, read positionally off `panel.stats` (falling
    /// back to a label match) since the wire contract carries this poster's
    /// three numbers the same way it carries before-the-run's pace-band /
    /// ceiling / effort — one generic `stats` array, different content by
    /// state. Rendered bare, with no translucent plate: the design's after-run
    /// poster sits its three values directly on the gradient.
    private var posterStats: [(value: FaffValue, unit: String?, label: String)] {
        let stats = model.panel.stats
        func pick(_ needle: String, _ index: Int) -> V5Stat? {
            stats.first(where: { $0.label.lowercased().contains(needle) })
                ?? (stats.indices.contains(index) ? stats[index] : nil)
        }
        // ─────────────────────────────────────────────────────────────────
        // THE UNIT IS ON THE VALUE ALREADY
        //
        // These appended "mi" and "/mi" to values the composer had already
        // formatted with them, so the poster read "4 mi mi" and "9:22/mi /mi"
        // and wrapped onto a second line under the weight of it. The unit is
        // only added when the value does not already carry one.
        func unitFor(_ v: FaffValue, _ suffix: String) -> String? {
            v.text.lowercased().hasSuffix(suffix.lowercased()) ? nil : suffix
        }
        var out: [(FaffValue, String?, String)] = []
        if let distance = pick("dist", 0) {
            let v = distance.value.value
            out.append((v, unitFor(v, "mi"), distance.label))
        }
        if let time = pick("time", 1) { out.append((time.value.value, nil, time.label)) }
        if let pace = pick("pace", 2) {
            let v = pace.value.value
            out.append((v, unitFor(v, "/mi"), pace.label))
        }
        return out
    }

    /// THREE NUMBERS, ONE LINE, ALL THE SAME SIZE.
    ///
    /// The row was a fixed HStack at 32pt with 28pt gaps. Three values fit
    /// comfortably while the middle one was a time under an hour — "54:16",
    /// five glyphs. An eleven-mile run reads "1:28:18", two glyphs wider, and
    /// the pace fell off the end: the unit wrapped to a second line and the
    /// poster read "8:01/" over "mi".
    ///
    /// It survived because it only breaks past sixty minutes, which on this
    /// runner's plan is the long run and nothing else.
    ///
    /// `ViewThatFits` picks the first size that fits on one line, so all three
    /// numbers shrink TOGETHER. Per-`Text` `minimumScaleFactor` would have
    /// been one line of code and would have scaled each number independently
    /// — three different sizes on a poster whose whole effect is that they
    /// are one row of type.
    private var posterStatsRow: some View {
        ViewThatFits(in: .horizontal) {
            statsRow(size: 32)
            statsRow(size: 28)
            statsRow(size: 24)
            statsRow(size: 20)
        }
    }

    private func statsRow(size: CGFloat) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: size >= 32 ? V5.S.s24 + V5.S.s4 : V5.S.s16) {
            ForEach(Array(posterStats.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    FaffValueText(item.value, font: .faffText(size, weight: .semibold),
                                  color: panelInk.primary, mark: panelInk.mark)
                    if let unit = item.unit {
                        Text(unit)
                            .font(.faffText(14))
                            .foregroundStyle(panelInk.secondary)
                    }
                }
                // FIVE ELEMENTS FOR THREE NUMBERS, AND NOT ONE OF THEM NAMED.
                //
                // The design draws these bare on the gradient — no captions,
                // because the numbers' shapes tell a sighted runner which is
                // which (6.02 mi · 54:16 · 9:02 /mi). Spoken, they arrived as
                // "6.02", "mi", "54:16", "9:02", "/mi": five stops, the units
                // divorced from their figures, and the middle one a bare
                // number with nothing at all saying it was the elapsed time.
                //
                // The wire already carries the label for each. It is not
                // drawn — the poster stays exactly as designed — it is only
                // spoken, which is where the shape cue does not exist.
                .accessibilityElement(children: .combine)
                .accessibilityLabel(item.label)
                .accessibilityValue(
                    [item.value.isModelled ? "estimated" : nil, item.value.text, item.unit]
                        .compactMap { $0 }.joined(separator: " ")
                )
            }
        }
        // THREE GUARANTEES, NOT ONE.
        //
        // `ViewThatFits` above keeps the three numbers the same size. It is a
        // single mechanism, and a single mechanism is how this shipped broken
        // twice: it depends on the parent proposing a real width, and if
        // anything ever proposes an unbounded one it silently picks the
        // largest candidate and the row overflows.
        //
        // So the row does not rely on it. `lineLimit(1)` makes a wrap
        // physically impossible — that alone is what stops "8:01/mi" ever
        // breaking into "8:01/" over "mi", whatever the width turns out to
        // be. `minimumScaleFactor` then shrinks rather than truncates if
        // every candidate is still too wide, which can happen at the largest
        // accessibility text sizes on the narrowest phone.
        //
        // `fixedSize` is deliberately NOT here. It forces the ideal width and
        // would clip off the edge of the panel instead of scaling.
        .lineLimit(1)
        .minimumScaleFactor(0.5)
    }

    // MARK: - Asked vs ran
    //
    // Bare rows on the page, no tile background — matches the design, which
    // sits this table directly between the panel and the coach verdict tile.
    // Effort is the only row the server marks actionable (`action != nil`);
    // it expands in place to a 1-10 scale. Every other row is a plain,
    // chevronless `ListRow`.

    private var askedVsRanSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(model.askedVsRan) { row in
                if row.action != nil {
                    ExpandingRow(label: row.label,
                                 sub: row.sub,
                                 value: Self.fv(row.value),
                                 question: row.sub.map { "How hard was it \u{00B7} \($0)" } ?? "How hard was it",
                                 isExpanded: expandedBinding(for: row.id)) {
                        effortScale
                    }
                } else {
                    ListRow(label: row.label, sub: row.sub, value: Self.fv(row.value))
                }
            }
        }
        .padding(.horizontal, V5.S.s4)
    }

    private func expandedBinding(for id: String) -> Binding<Bool> {
        Binding(
            get: { expandedRowID == id },
            set: { isOpen in expandedRowID = isOpen ? id : (expandedRowID == id ? nil : expandedRowID) }
        )
    }

    private var effortScale: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 10), spacing: 4) {
            ForEach(1...10, id: \.self) { n in
                Button {
                    pendingEffort = n
                    onLogEffort(n)
                    withAnimation(V5.Motion.expand) { expandedRowID = nil }
                } label: {
                    Text("\(n)")
                        // TEN CELLS IN A ROW ACROSS A PHONE IS 29 POINTS EACH.
                        //
                        // Scaled with the reading register, "10" outgrew its
                        // cell at the first accessibility size and rendered as
                        // "…" — the top of the effort scale, unreachable,
                        // where the runner is being asked to pick a number.
                        // The grid is a fixed graphic; its digits are sized to
                        // the cell. The question above it still scales, and
                        // every cell is named for VoiceOver below.
                        .font(.faffText(16, scales: false))
                        .foregroundStyle(pendingEffort == n ? V5.actionPrimaryText : V5.textPrimary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 46)
                        .background(pendingEffort == n ? V5.signal : V5.materialTile,
                                    in: RoundedRectangle(cornerRadius: V5.R.r10, style: .continuous))
                }
                .buttonStyle(V5PressStyle())
                // TEN BUTTONS CALLED "1" THROUGH "10", AND NOTHING SAYING
                // WHAT THEY WERE FOR OR WHICH ONE WAS ALREADY CHOSEN.
                //
                // The scale opens in place under the Effort row, so a sighted
                // runner reads the question from the row above. VoiceOver
                // moves focus into the expansion and the question is behind
                // it. And the chosen number is drawn as an orange fill, which
                // is a colour — nothing announced it.
                //
                // The cells are 29pt wide. Ten of them across a phone cannot
                // each be 44, so the width is the design's to change, not
                // this file's; it is reported rather than quietly altered.
                .accessibilityLabel("Effort \(n) of 10")
                .accessibilityAddTraits(pendingEffort == n ? [.isSelected] : [])
            }
        }
    }

    // MARK: - Per-mile instruction groups, with actual numbers

    private var groupsTile: some View {
        Tile {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                ForEach(model.groups) { group in
                    VStack(alignment: .leading, spacing: V5.S.s10) {
                        HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
                            V5SectionLabel(text: group.title, size: TypeScaleV5.body15)
                            Spacer(minLength: 0)
                            if let note = group.note {
                                Text(note)
                                    .font(.faffText(TypeScaleV5.label13))
                                    .foregroundStyle(V5.textQuiet)
                            }
                        }
                        VStack(alignment: .leading, spacing: V5.S.s12) {
                            ForEach(group.steps) { step in
                                HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
                                    Text(step.main)
                                        .font(.faffText(15))
                                        .foregroundStyle(V5.textPrimary)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                    if let sub = step.sub {
                                        FaffValueText(sub.value, font: .faffText(17), color: V5.textPrimary)
                                            .frame(width: 58, alignment: .trailing)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Zone bar

    /// The zone(s) the session asked for, ascending.
    ///
    /// This read `model.zoneTarget` alone, and that single Int is NULL
    /// whenever the ask is a set. A half-marathon asks for Z4 and Z5 both —
    /// its %HRmax band straddles the 90% edge — so the server sends null
    /// rather than pick one of them, and this screen highlighted NOTHING on
    /// the one kind of day the bar is most worth drawing. `zoneTargets`
    /// carries the whole ask; the Int stays as the fallback for a phone
    /// talking to a server that predates it.
    private var zoneTargets: [Int] {
        if let t = model.zoneTargets, !t.isEmpty { return t.sorted() }
        return model.zoneTarget.map { [$0] } ?? []
    }

    /// "zone 2" / "zones 4 and 5" — the caption's own tail, so the set case
    /// reads as a sentence instead of as a list.
    private func zonePhrase(_ zones: [Int]) -> String {
        guard let last = zones.last else { return "" }
        if zones.count == 1 { return "zone \(last)" }
        let head = zones.dropLast().map(String.init).joined(separator: ", ")
        return "zones \(head) and \(last)"
    }

    private func zoneTile(_ shares: [Double]) -> some View {
        // Guard the indices here rather than at each use — a target outside
        // the five zones is a wire fault, not something to crash over.
        let targets = zoneTargets.filter { $0 >= 1 && $0 <= shares.count }
        return Tile {
            HStack(alignment: .firstTextBaseline) {
                Text("Where the heart sat")
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textSecondary)
                Spacer(minLength: 0)
                if !targets.isEmpty {
                    // Summed across the ask, because the ask is one
                    // instruction: a half run 38% in Z4 and 24% in Z5 spent
                    // 62% where it was told to, and reporting either half
                    // alone would understate a race that went right.
                    let pct = targets.reduce(0.0) { $0 + shares[$1 - 1] }
                    HStack(spacing: 0) {
                        Text("\(Int(pct.rounded()))%")
                            .font(.faffText(15, weight: .semibold))
                            .foregroundStyle(V5.textPrimary)
                        Text(" in \(zonePhrase(targets))")
                            .font(.faffText(TypeScaleV5.label13))
                            .foregroundStyle(V5.textQuiet)
                    }
                    // The leading space is the gap — the HStack has none, so
                    // the two runs sit flush and the space does the spacing.
                    // Split across two elements it read out as "58 percent"
                    // and then, separately, " in zone 2" with a stray space
                    // in front of it. One element, one sentence.
                    .accessibilityElement(children: .combine)
                }
            }
            ZoneBar(shares: shares, targets: Set(targets), height: 44, labels: false)
        }
    }

    // MARK: - The one difference: route (outdoor) vs on the belt (treadmill)
    //
    // Driven entirely by which field the engine populated. Never an empty
    // map, never a zero — the treadmill run gets its own card, not a hollow
    // version of the outdoor one.

    @ViewBuilder
    private var routeOrBeltCard: some View {
        if let belt = model.onTheBelt, !belt.isEmpty {
            beltCard(belt)
        } else if let points = model.elevation, points.count > 1 {
            routeCard(points)
        }
    }

    private func beltCard(_ stats: [V5Stat]) -> some View {
        Tile {
            Text("On the belt")
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textSecondary)
            HStack(alignment: .top, spacing: V5.S.s16) {
                ForEach(Array(stats.enumerated()), id: \.offset) { i, s in
                    VStack(alignment: i == 0 ? .leading : .trailing, spacing: 4) {
                        Text(s.label.uppercased())
                            .font(.faffText(TypeScaleV5.label12))
                            .foregroundStyle(V5.textQuiet)
                        HStack(alignment: .firstTextBaseline, spacing: 2) {
                            FaffValueText(s.value.value, font: .faffText(26, weight: .semibold), color: V5.textPrimary)
                            Text(s.label.lowercased().contains("speed") ? "mph" : "%")
                                .font(.faffText(TypeScaleV5.label13))
                                .foregroundStyle(V5.textQuiet)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: i == 0 ? .leading : .trailing)
                }
            }
        }
    }

    private func routeCard(_ points: [Double]) -> some View {
        Tile {
            HStack(alignment: .firstTextBaseline) {
                Text("Route")
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textSecondary)
                Spacer(minLength: 0)
                HStack(spacing: 4) {
                    FaffValueText(.measured("\(elevationGain(points))"), font: .faffText(15, weight: .semibold), color: V5.textPrimary)
                    Text("ft up")
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textQuiet)
                }
            }
            ElevationProfile(points: points, height: 150)
        }
    }

    /// Total climb, summed straight off the same points `ElevationProfile`
    /// draws — a run's own logged/measured elevation, never modelled.
    private func elevationGain(_ points: [Double]) -> Int {
        guard points.count > 1 else { return 0 }
        var gain = 0.0
        for i in 1..<points.count {
            let delta = points[i] - points[i - 1]
            if delta > 0 { gain += delta }
        }
        return Int(gain.rounded())
    }

    // MARK: - What this did to the week, and the niggle row

    private var whatThisDidSection: some View {
        ListGroup(header: "What this did") {
            ForEach(model.whatThisDidToTheWeek) { row in
                ListRow(label: row.label, sub: row.sub, value: Self.fv(row.value),
                        onTap: row.action != nil ? { onRowAction(row) } : nil)
            }
            // Only when the server is not already carrying one. Its row is
            // the persisted truth (with Undo); this screen's is the picker
            // that SETS one. Both at once read as two identical rows.
            if serverFlaggedNiggle == nil {
                niggleRow
            }
        }
    }

    /// The flagged niggle as the server sees it, found by the verb rather
    /// than by the label — the label is copy and copy moves.
    private var serverFlaggedNiggle: String? {
        model.whatThisDidToTheWeek.first { $0.action == "undo_niggle" }?.label
    }

    @ViewBuilder
    private var niggleRow: some View {
        if let flagged = niggleFlagged {
            ListRow(label: "\(flagged) flagged",
                    sub: "The coach has it \u{00B7} it shapes tomorrow",
                    value: .measured("Undo"),
                    onTap: { niggleFlagged = nil })
        } else {
            ExpandingRow(label: "Flag a niggle",
                         sub: "Anything that felt wrong",
                         value: .measured("Add"),
                         question: "Where did it hurt",
                         isExpanded: $niggleOpen) {
                VStack(spacing: V5.S.s6) {
                    ForEach(Self.bodyParts, id: \.self) { part in
                        Button {
                            niggleFlagged = part
                            onFlagNiggle(part)
                            withAnimation(V5.Motion.expand) { niggleOpen = false }
                        } label: {
                            HStack {
                                Text(part)
                                    .font(.faffText(TypeScaleV5.body15))
                                    .foregroundStyle(V5.textPrimary)
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, V5.S.s14x)
                            .frame(height: 44)
                            .frame(maxWidth: .infinity)
                            .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r16, style: .continuous))
                        }
                        .buttonStyle(V5PressStyle())
                    }
                    FaffButton("Nothing did", variant: .ghost, size: .md) {
                        withAnimation(V5.Motion.expand) { niggleOpen = false }
                    }
                }
            }
        }
    }

    /// The design's "see 13a" is the deck's own screen id — never shipped
    /// copy. This names the real destination instead.
    private var niggleLink: some View {
        Button(action: onOpenInjuryFlare) {
            (Text("If it's still there tomorrow, see ")
                .foregroundColor(V5.textSecondary)
             + Text("Injury")
                .foregroundColor(V5.signal))
                .font(.faffText(TypeScaleV5.label13))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, V5.S.s4)
    }

    // MARK: - Rule three, kept honest
    //
    // `V5Row.value` is doubly optional: the KEY may be absent (this row has
    // no value cell — render nothing) or present with a null `text` (we
    // could not read it — render the fault-red dash). Collapsing those two
    // into one default would turn every valueless row into a false
    // "could not read this".
    private static func fv(_ n: V5Number?) -> FaffValue? { n.map { $0.value } }
}

// MARK: - Previews

#Preview("5b · after the run") {
    TodayAfterV5(model: TodayAfterV5Samples.outdoor)
}

#Preview("5c · after the run · treadmill") {
    TodayAfterV5(model: TodayAfterV5Samples.treadmill)
}

/// Built from the prototype's own sample data (`docs/design/iphone-v5/reference/screens/_script-data.js`,
/// the `easy` and `quality` entries in `doneRun()`), decoded through the real
/// wire contract so the preview exercises the same path production data does.
enum TodayAfterV5Samples {
    static let outdoor: V5Today = decode(outdoorJSON)
    static let treadmill: V5Today = decode(treadmillJSON)

    private static func decode(_ json: String) -> V5Today {
        // swiftlint:disable:next force_try
        try! JSONDecoder().decode(V5Today.self, from: Data(json.utf8))
    }

    private static let outdoorJSON = """
    {
      "dateISO": "2026-09-18",
      "state": "after_run",
      "panel": {
        "dayState": "easy",
        "quiet": false,
        "place": "Today",
        "dateLine": "Thursday 18 Sep",
        "weekLine": "Logged 7:04",
        "kicker": "61°F, clear, light wind",
        "type": "Easy",
        "dose": null,
        "stats": [
          { "label": "Distance", "value": { "text": "6.02", "modelled": false }, "tone": null },
          { "label": "Time", "value": { "text": "54:16", "modelled": false }, "tone": null },
          { "label": "Pace", "value": { "text": "9:02", "modelled": false }, "tone": null }
        ]
      },
      "weekStrip": [
        { "id": "d1", "dateISO": "2026-09-14", "letter": "M", "number": "14", "dayState": "easy", "isToday": false, "isDone": true, "isRest": false },
        { "id": "d2", "dateISO": "2026-09-15", "letter": "T", "number": "15", "dayState": "quality", "isToday": false, "isDone": true, "isRest": false },
        { "id": "d3", "dateISO": "2026-09-16", "letter": "W", "number": "16", "dayState": "rest", "isToday": false, "isDone": true, "isRest": true },
        { "id": "d4", "dateISO": "2026-09-17", "letter": "T", "number": "17", "dayState": "easy", "isToday": false, "isDone": true, "isRest": false },
        { "id": "d5", "dateISO": "2026-09-18", "letter": "F", "number": "18", "dayState": "easy", "isToday": true, "isDone": true, "isRest": false },
        { "id": "d6", "dateISO": "2026-09-19", "letter": "S", "number": "19", "dayState": "long", "isToday": false, "isDone": false, "isRest": false },
        { "id": "d7", "dateISO": "2026-09-20", "letter": "S", "number": "20", "dayState": "rest", "isToday": false, "isDone": false, "isRest": true }
      ],
      "groups": [
        {
          "id": "g1",
          "title": "Easy run",
          "note": "6.02 mi",
          "steps": [
            { "id": "s1", "main": "Mile 1", "sub": { "text": "9:05", "modelled": false } },
            { "id": "s2", "main": "Mile 2", "sub": { "text": "9:12", "modelled": false } },
            { "id": "s3", "main": "Mile 3", "sub": { "text": "8:58", "modelled": false } },
            { "id": "s4", "main": "Mile 4", "sub": { "text": "9:21", "modelled": false } },
            { "id": "s5", "main": "Mile 5", "sub": { "text": "8:31", "modelled": false } },
            { "id": "s6", "main": "Mile 6", "sub": { "text": "9:09", "modelled": false } }
          ]
        }
      ],
      "why": null,
      "whereYouAre": [],
      "beforeYouGo": [],
      "askedVsRan": [
        { "id": "r1", "label": "Pace", "sub": "8:50–9:35", "value": { "text": "9:02", "modelled": false }, "action": null },
        { "id": "r2", "label": "Heart", "sub": "under 148", "value": { "text": "141", "modelled": false }, "action": null },
        { "id": "r3", "label": "Effort", "sub": "3 to 6", "value": null, "action": "log_effort" }
      ],
      "verdict": "Sat in the band all the way bar mile five, which crept thirty seconds quick. Pull that one back and this is a clean easy day.",
      "zoneShares": [6, 58, 30, 5, 1],
      "zoneTarget": 2,
      "zoneTargets": [2],
      "elevation": [412, 418, 430, 452, 470, 460, 445, 458, 468, 452, 430],
      "onTheBelt": null,
      "shoesWorn": { "id": "shoe1", "label": "Endorphin Speed 4", "sub": "214 mi on them", "value": null, "action": null },
      "whatThisDidToTheWeek": [
        { "id": "w1", "label": "This week", "sub": "38.0 of 44 mi done", "value": { "text": "86%", "modelled": false }, "action": null },
        { "id": "w2", "label": "Threshold, tomorrow", "sub": "6 x 1000m at 10k pace", "value": null, "action": null }
      ],
      "runId": "run_9f21",
      "changed": null,
      "injury": null,
      "weekOff": null,
      "offSeason": null,
      "notOnPhoneYet": null
    }
    """

    private static let treadmillJSON = """
    {
      "dateISO": "2026-09-16",
      "state": "after_run",
      "panel": {
        "dayState": "quality",
        "quiet": false,
        "place": "Today",
        "dateLine": "Tuesday 16 Sep",
        "weekLine": "Logged 6:41",
        "kicker": "Treadmill · indoor, no GPS",
        "type": "Threshold",
        "dose": null,
        "stats": [
          { "label": "Distance", "value": { "text": "10.1", "modelled": false }, "tone": null },
          { "label": "Time", "value": { "text": "1:18:44", "modelled": false }, "tone": null },
          { "label": "Pace", "value": { "text": "7:47", "modelled": false }, "tone": null }
        ]
      },
      "weekStrip": [
        { "id": "d1", "dateISO": "2026-09-14", "letter": "M", "number": "14", "dayState": "rest", "isToday": false, "isDone": true, "isRest": true },
        { "id": "d2", "dateISO": "2026-09-15", "letter": "T", "number": "15", "dayState": "easy", "isToday": false, "isDone": true, "isRest": false },
        { "id": "d3", "dateISO": "2026-09-16", "letter": "W", "number": "16", "dayState": "quality", "isToday": true, "isDone": true, "isRest": false },
        { "id": "d4", "dateISO": "2026-09-17", "letter": "T", "number": "17", "dayState": "easy", "isToday": false, "isDone": false, "isRest": false },
        { "id": "d5", "dateISO": "2026-09-18", "letter": "F", "number": "18", "dayState": "rest", "isToday": false, "isDone": false, "isRest": true },
        { "id": "d6", "dateISO": "2026-09-19", "letter": "S", "number": "19", "dayState": "long", "isToday": false, "isDone": false, "isRest": false },
        { "id": "d7", "dateISO": "2026-09-20", "letter": "S", "number": "20", "dayState": "rest", "isToday": false, "isDone": false, "isRest": true }
      ],
      "groups": [
        {
          "id": "g1",
          "title": "Warm up",
          "note": "1.5 mi",
          "steps": [
            { "id": "s1", "main": "1.5 mi easy", "sub": { "text": "9:36", "modelled": false } }
          ]
        },
        {
          "id": "g2",
          "title": "Work",
          "note": "7 mi",
          "steps": [
            { "id": "s2", "main": "3 mi at 7:22", "sub": { "text": "7:21", "modelled": false } },
            { "id": "s3", "main": "1 mi float", "sub": { "text": "9:12", "modelled": false } },
            { "id": "s4", "main": "3 mi at 7:22", "sub": { "text": "7:33", "modelled": false } }
          ]
        },
        {
          "id": "g3",
          "title": "Cool down",
          "note": "1.5 mi",
          "steps": [
            { "id": "s5", "main": "1.5 mi easy", "sub": { "text": "9:41", "modelled": false } }
          ]
        }
      ],
      "why": null,
      "whereYouAre": [],
      "beforeYouGo": [],
      "askedVsRan": [
        { "id": "r1", "label": "Work pace", "sub": "7:22", "value": { "text": "7:27", "modelled": false }, "action": null },
        { "id": "r2", "label": "Heart", "sub": "under 172", "value": { "text": "169", "modelled": false }, "action": null },
        { "id": "r3", "label": "Effort", "sub": "6 to 8", "value": { "text": "7 of 10", "modelled": false }, "action": "log_effort" }
      ],
      "verdict": "First block sat dead on it, second gave up eleven seconds a mile. That is the honest edge of your threshold today, not a miss.",
      "zoneShares": [2, 14, 28, 44, 12],
      "zoneTarget": 4,
      "zoneTargets": [4],
      "elevation": null,
      "onTheBelt": [
        { "label": "Avg speed", "value": { "text": "7.7", "modelled": false }, "tone": null },
        { "label": "Avg incline", "value": { "text": "1.5", "modelled": false }, "tone": null }
      ],
      "shoesWorn": { "id": "shoe2", "label": "Vaporfly 3", "sub": "62 mi on them", "value": null, "action": null },
      "whatThisDidToTheWeek": [
        { "id": "w1", "label": "This week", "sub": "24.1 of 44 mi done", "value": { "text": "55%", "modelled": false }, "action": null },
        { "id": "w2", "label": "Easy, tomorrow", "sub": "6 mi recovery", "value": null, "action": null }
      ],
      "runId": "run_2b7a",
      "changed": null,
      "injury": null,
      "weekOff": null,
      "offSeason": null,
      "notOnPhoneYet": null
    }
    """
}
