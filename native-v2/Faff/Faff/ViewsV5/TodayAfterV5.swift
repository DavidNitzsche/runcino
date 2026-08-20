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
         onPushStrava: @escaping () -> Void = {}) {
        self.model = model
        self.onOpenAccount = onOpenAccount
        self.onLogEffort = onLogEffort
        self.onFlagNiggle = onFlagNiggle
        self.onOpenInjuryFlare = onOpenInjuryFlare
        self.onChangeShoe = onChangeShoe
        self.onRowAction = onRowAction
        self.onPushStrava = onPushStrava

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
        DayPanel(fill: model.panel.fill) {
            HStack(alignment: .center) {
                Text(model.panel.place)
                    .font(.faffDisplay(20))
                    .textCase(.uppercase)
                    .tracking(20 * 0.02)
                    .foregroundStyle(V5.OnPanel.primary)
                Spacer(minLength: V5.S.s8)
                Button(action: onOpenAccount) {
                    Image(systemName: "person.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(V5.OnPanel.primary)
                        .frame(width: V5.Shell.headerButton, height: V5.Shell.headerButton)
                        .background(V5.OnPanel.control, in: Circle())
                }
                .buttonStyle(V5PressStyle())
            }

            HStack(alignment: .lastTextBaseline, spacing: V5.S.s12) {
                Text(model.panel.dateLine)
                    .font(.faffDisplay(26))
                    .foregroundStyle(V5.OnPanel.primary)
                Spacer(minLength: 0)
                if let weekLine = model.panel.weekLine {
                    Text(weekLine)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.OnPanel.secondary)
                }
            }

            WeekStripV5(days: model.weekStrip.map { $0.strip })

            VStack(alignment: .leading, spacing: V5.S.s2) {
                if let kicker = model.panel.kicker {
                    Text(kicker)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.OnPanel.secondary)
                }
                Text(model.panel.type)
                    .faffDisplayV5(56)
                    .foregroundStyle(V5.OnPanel.primary)
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
    private var posterStats: [(value: FaffValue, unit: String?)] {
        let stats = model.panel.stats
        func pick(_ needle: String, _ index: Int) -> V5Stat? {
            stats.first(where: { $0.label.lowercased().contains(needle) })
                ?? (stats.indices.contains(index) ? stats[index] : nil)
        }
        var out: [(FaffValue, String?)] = []
        if let distance = pick("dist", 0) { out.append((distance.value.value, "mi")) }
        if let time = pick("time", 1) { out.append((time.value.value, nil)) }
        if let pace = pick("pace", 2) { out.append((pace.value.value, "/mi")) }
        return out
    }

    private var posterStatsRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: V5.S.s24 + V5.S.s4) {
            ForEach(Array(posterStats.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    FaffValueText(item.value, font: .faffText(32, weight: .semibold), color: V5.OnPanel.primary)
                    if let unit = item.unit {
                        Text(unit)
                            .font(.faffText(14))
                            .foregroundStyle(V5.OnPanel.secondary)
                    }
                }
            }
        }
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
                        .font(.faffText(16))
                        .foregroundStyle(pendingEffort == n ? V5.actionPrimaryText : V5.textPrimary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 46)
                        .background(pendingEffort == n ? V5.signal : V5.materialTile,
                                    in: RoundedRectangle(cornerRadius: V5.R.r10, style: .continuous))
                }
                .buttonStyle(V5PressStyle())
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

    private func zoneTile(_ shares: [Double]) -> some View {
        Tile {
            HStack(alignment: .firstTextBaseline) {
                Text("Where the heart sat")
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textSecondary)
                Spacer(minLength: 0)
                if let target = model.zoneTarget, target >= 1, target <= shares.count {
                    HStack(spacing: 0) {
                        Text("\(Int(shares[target - 1].rounded()))%")
                            .font(.faffText(15, weight: .semibold))
                            .foregroundStyle(V5.textPrimary)
                        Text(" in zone \(target)")
                            .font(.faffText(TypeScaleV5.label13))
                            .foregroundStyle(V5.textQuiet)
                    }
                }
            }
            ZoneBar(shares: shares, target: model.zoneTarget, height: 44, labels: false)
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
            niggleRow
        }
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
