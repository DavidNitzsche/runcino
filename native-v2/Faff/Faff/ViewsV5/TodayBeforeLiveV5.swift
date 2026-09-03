//
//  TodayBeforeLiveV5.swift
//  faff.run iPhone · wires `TodayBeforeV5` (screen 5a) to the network.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS FILE EXISTS SEPARATELY FROM TodayBeforeV5 AND FROM HostsV5
//
//  `TodayBeforeV5`'s own header is explicit: "This file does not fetch."
//  It takes `beforeYouGoOptions` / `onSelectBeforeYouGoOption` /
//  `readinessPillars` as plain data or synchronous closures, and until now
//  every call site left them at their no-op defaults — the row expanded
//  into nothing, because nothing supplied a shoe list, a set of open days,
//  or a readiness pillar breakdown.
//
//  Those need three network reads (`GET /api/shoe`, `GET
//  /api/readiness/brief`, `GET /api/v5/block`) and three writes (`POST
//  /api/today/shoe`, `POST /api/today/skip`, `POST /api/today/reschedule`).
//  `HostsV5.swift` is the composition root that would normally own this,
//  but per this task's constraints it is not touched here — so this view
//  sits between `TodayHostV5` and `TodayBeforeV5`: it owns exactly the
//  local state those three reads need, translates the screen's callbacks
//  into real API calls, and asks the host to `reload()` its `V5Surface`
//  after a write lands, the same way every other write in this codebase
//  re-reads rather than patches local state.
//
//  `TodayHostV5` (`HostsV5.swift`) is expected to construct THIS view in
//  place of the four bare `TodayBeforeV5(...)` calls in its `content(_:)` —
//  see the exact replacement lines in the audit report. Every parameter
//  below mirrors `TodayBeforeV5`'s own signature so that swap is a rename,
//  not a rewrite.
//

import SwiftUI

struct TodayBeforeLiveV5: View {
    let model: V5Today
    let accountName: String
    let accountWeekLine: String
    let accountRows: [V5Row]
    /// The current week only, built by the host from `model.weekStrip` —
    /// `HostsV5.calendarWeeks(_:)` already does exactly this. Shown until
    /// the full block loads, so the calendar sheet is never empty even on a
    /// slow network; see `resolvedCalendarWeeks` below for the handoff.
    let fallbackCalendarWeeks: [TodayCalendarWeek]
    var onAccountRowTap: (V5Row) -> Void = { _ in }
    var onPickDay: (String) -> Void = { _ in }
    var viewingDayLabel: String? = nil
    /// `TodayHostV5.viewingDate`, straight through — see `TodayBeforeV5.stripDays()`.
    var selectedDateISO: String? = nil
    var onBackToToday: () -> Void = {}
    /// Page the week strip. -1 back a week, +1 forward. Async — see
    /// WKSTRIP-RACE-1 in ChartsV5.swift; the strip's recentre awaits this.
    var onPageWeek: (Int) async -> Void = { _ in }
    var onOpenPacesMoved: () -> Void = {}
    var onOpenRace: (String) -> Void = { _ in }
    var onReportSick: (_ symptoms: [String], _ started: String, _ hasFever: Bool) -> Void = { _, _, _ in }
    /// Re-reads the Today surface after a write. Owned by `TodayHostV5`'s
    /// own `V5Surface<V5Today>` — this view never holds a surface of its
    /// own, per "a screen does not fetch"; it only writes, then asks the
    /// host to read again, same as every other mutation in `HostsV5.swift`.
    var reload: () async -> Void = {}

    @State private var shoes: [Shoe] = []
    @State private var pillars: [ReadinessPillar] = []
    /// RULE THREE · which of the prefetches FAILED, as against came back
    /// with nothing in it. Both used to collapse into an empty array, and
    /// the screen then told the runner there was nothing to show — a claim
    /// about their data made on the strength of a read that never landed.
    @State private var pillarsUnread = false
    @State private var shoesUnread = false
    @State private var block: V5Block? = nil
    @State private var moveConflict: MoveConflict? = nil

    /// A reschedule the server refused because the target day already holds
    /// a run. RULE THREE: this is a correct answer, not an error — the
    /// runner gets asked, not bounced. See `move(to:)` / `confirmReplace()`.
    struct MoveConflict: Equatable {
        let targetISO: String
        let targetLabel: String
        let existingType: String
        let existingDistanceMi: Double
        let existingSubLabel: String?
    }

    var body: some View {
        TodayBeforeV5(
            model: model,
            accountName: accountName,
            accountWeekLine: accountWeekLine,
            accountRows: accountRows,
            calendarWeeks: resolvedCalendarWeeks,
            calendarNote: calendarNote,
            beforeYouGoOptions: options(for:),
            onSelectBeforeYouGoOption: select,
            readinessPillars: pillars,
            readinessPillarsUnread: pillarsUnread,
            beforeYouGoUnread: { row in row.action == "change_shoe" && shoesUnread },
            onAccountRowTap: onAccountRowTap,
            onPickDay: onPickDay,
            viewingDayLabel: viewingDayLabel,
            selectedDateISO: selectedDateISO,
            onBackToToday: onBackToToday,
            onPageWeek: onPageWeek,
            onOpenPacesMoved: onOpenPacesMoved,
            onOpenRace: onOpenRace,
            onReportSick: onReportSick
        )
        .task { await prefetch() }
    }

    // MARK: - Prefetch
    //
    // All three are read-only GETs, fetched in parallel alongside the
    // host's own Today load. Eager rather than fetched lazily on first tap:
    // the runner has to scroll past the panel and instruction groups before
    // reaching either list, which is normally enough time for three small
    // reads to land, and it means neither expansion pops from empty to
    // populated mid-interaction.
    //
    // A failed read is NOT an empty list. This used to leave the list empty
    // and let the expansion say "Nothing to change here yet." for both, on
    // the reasoning that an error was too loud for a list the runner had to
    // go looking for. The volume was the right instinct and the sentence was
    // the wrong one: it is a claim about the runner's garage, made when we
    // never opened it. The two states are separate now and both stay quiet.

    private func prefetch() async {
        async let shoesFetch: ShoesResponse? = try? API.fetchShoes()
        async let pillarsFetch: ReadinessBriefSeed? = try? API.fetchReadinessBrief()
        async let blockFetch: API.V5Fetch<V5Block>? = try? API.fetchV5Block()
        let (s, p, b) = await (shoesFetch, pillarsFetch, blockFetch)
        // nil is "we could not read it"; a payload with an empty list is
        // "we read it and there is nothing". Only the second one is a
        // sentence about the runner.
        shoesUnread = s == nil
        pillarsUnread = p == nil
        shoes = s?.shoes ?? []
        pillars = p?.pillars ?? []
        if case .ok(let value)? = b { block = value }
    }

    /// The full block once it has loaded; the current week alone until then.
    /// Built from the same `V5BlockDay.dateISO/type/isDone` the calendar
    /// sheet needs — see `lib/plan/v5-block.ts:buildWeeks` and the doc
    /// comment on `V5BlockDay` for why those three fields exist now.
    private var resolvedCalendarWeeks: [TodayCalendarWeek] {
        guard let block, !block.weeks.isEmpty else { return fallbackCalendarWeeks }
        return block.weeks.map { week in
            TodayCalendarWeek(
                id: week.id,
                range: week.isCurrent ? "This week" : week.label,
                // A category word only ("Race week", "Cutback", the phase
                // name) — never the week's mileage here. `week.miles` can be
                // modelled (a future week's planned volume), and this footer
                // is a plain SwiftUI `Text`, not `FaffValueText` — it cannot
                // carry the amber tilde RULE ONE requires. A word carries no
                // such risk; a number formatted by hand here would.
                sub: week.isCurrent ? nil : week.flag,
                days: week.days.map { day in
                    TodayCalendarDay(
                        id: day.id,
                        label: dayLabel(day.dateISO),
                        sub: daySub(day),
                        status: day.isToday ? .measured("Today") : ((day.isDone ?? false) ? .measured("Done") : nil),
                        isToday: day.isToday
                    )
                }
            )
        }
    }

    /// Where the plan ends, when the calendar would otherwise end without
    /// explanation. See `TodayBeforeV5.calendarNote`.
    ///
    /// THE TEST IS "IS THERE ANOTHER WEEK AFTER THIS ONE", not "how many
    /// weeks are there". A sixteen-week block read in its last week needs
    /// this sentence exactly as much as a one-week recovery plan does, and
    /// for the same reason: the runner has reached the end of what is
    /// written and nothing on the screen says so.
    ///
    /// Silent while the block is still loading. A sentence about the shape of
    /// the plan, published before the plan has been read, is a guess.
    private var calendarNote: String? {
        guard let block, !block.weeks.isEmpty else { return nil }
        guard let currentIdx = block.weeks.firstIndex(where: { $0.isCurrent }) else { return nil }
        guard currentIdx == block.weeks.count - 1 else { return nil }

        let last = block.weeks[currentIdx].days.compactMap(\.dateISO).max()
        guard let last, let d = Self.iso.date(from: last) else {
            return "This is the whole plan as written."
        }
        return "The plan runs to \(Self.noteDateFormatter.string(from: d)). Nothing is written past it yet."
    }

    private func daySub(_ day: V5BlockDay) -> String {
        let type = day.type ?? ""
        if type.caseInsensitiveCompare("Rest") == .orderedSame || type.isEmpty {
            return "Rest day"
        }
        guard day.miles > 0 else { return type }
        return "\(type) · \(Units.formatDistance(miles: day.miles, decimals: 1)) \(Units.distanceLabel())"
    }

    private func dayLabel(_ dateISO: String?) -> String {
        guard let dateISO, let d = Self.iso.date(from: dateISO) else { return "" }
        return Self.dayLabelFormatter.string(from: d)
    }

    private static let iso: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

    /// "Sun, Aug 30" — month, day, US order, matching `lib/format/date.ts`.
    /// No year: this sentence is always about a date inside the block the
    /// runner is reading.
    private static let noteDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "EEE, MMM d"
        f.timeZone = TimeZone(identifier: "UTC")
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    private static let dayLabelFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "EEE d"
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

    private static let weekdayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "EEEE"
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

    private func weekdayName(_ dateISO: String) -> String {
        guard let d = Self.iso.date(from: dateISO) else { return dateISO }
        return Self.weekdayFormatter.string(from: d)
    }

    // MARK: - "Before you go" options
    //
    // Switches on `row.action` — the verb V5Row's own doc comment names for
    // exactly this ("what tapping it does... the client switches on"), and
    // the one that matches what `web-v2/app/api/v5/today/route.ts` actually
    // sends today: `id: 'shoe'` / `action: 'change_shoe'` and `id: 'move'` /
    // `action: 'move_skip'`. The design's own sample fixture
    // (`_script-data.js`, mirrored in `TodayBeforeV5Sample` in this file's
    // sibling) uses `id: "shoes"` / `action: "shoes"` — a preview-only
    // mismatch against the live route, not a contract this file should
    // follow; switching on `action` is right either way once the two
    // converge.
    private func options(for row: V5Row) -> [TodayBeforeGoOption] {
        switch row.action {
        case "change_shoe":
            return shoeOptions()
        case "move_skip":
            if let conflict = moveConflict {
                return [
                    TodayBeforeGoOption(id: "replace-\(conflict.targetISO)",
                                         label: "Replace \(conflict.existingType.capitalized) on \(conflict.targetLabel)",
                                         sub: replacedSub(conflict)),
                    TodayBeforeGoOption(id: "cancel-move", label: "Keep both as planned")
                ]
            }
            return moveOptions()
        default:
            return []
        }
    }

    private func replacedSub(_ conflict: MoveConflict) -> String {
        let mi = "\(Units.formatDistance(miles: conflict.existingDistanceMi, decimals: 1)) \(Units.distanceLabel())"
        if let sub = conflict.existingSubLabel, !sub.isEmpty { return "\(sub) · \(mi) moves aside" }
        return "\(mi) moves aside"
    }

    /// Non-retired shoes from the runner's garage. The one already marked
    /// `preferred` reads "Wearing" — a measured fact off the shoe row, never
    /// a modelled guess (RULE ONE only governs numbers the engine projects;
    /// this is just today's own garage state).
    private func shoeOptions() -> [TodayBeforeGoOption] {
        shoes.filter { $0.retired != true }.map { shoe in
            TodayBeforeGoOption(
                id: "shoe-\(shoe.id)",
                label: shoe.displayName.isEmpty ? "Untitled shoe" : shoe.displayName,
                sub: mileageSub(shoe),
                value: shoe.preferred == true ? .measured("Wearing") : nil
            )
        }
    }

    private func mileageSub(_ shoe: Shoe) -> String {
        guard let mi = shoe.mileage, mi > 0 else { return "New" }
        return "\(Units.formatDistance(miles: mi, decimals: 0)) \(Units.distanceLabel()) on them"
    }

    /// Rest days later in the currently-loaded week, from `model.weekStrip`
    /// — the same array the panel's own strip renders, so a move target can
    /// never disagree with what the strip shows as open. Each option also
    /// says whether it sits right before the week's long run, when the next
    /// day in the strip actually is one — never inferred beyond what the
    /// payload already states.
    private func moveOptions() -> [TodayBeforeGoOption] {
        let strip = model.weekStrip
        var opts: [TodayBeforeGoOption] = []
        for (idx, day) in strip.enumerated() where day.isRest && day.dateISO > model.dateISO {
            let name = weekdayName(day.dateISO)
            let sub: String
            if idx + 1 < strip.count, strip[idx + 1].dayState == "long" {
                sub = "Sits before \(weekdayName(strip[idx + 1].dateISO))’s long run"
            } else {
                sub = "\(name) is empty"
            }
            opts.append(TodayBeforeGoOption(id: "move-\(day.dateISO)", label: "Move to \(name)", sub: sub))
        }
        // The dose goes in `value`, not hand-typed into `sub` — `value` is
        // the one path `beforeYouGoExpansion` renders through `FaffValueText`,
        // which is what actually draws RULE ONE's amber tilde when the
        // engine marked the dose modelled. `check-modelled-mark.sh` forbids
        // a literal "~" glued into a string for exactly this reason: only
        // the type can be trusted to carry the mark all the way to pixels.
        opts.append(TodayBeforeGoOption(id: "skip", label: "Skip it",
                                        sub: "The week loses", value: model.panel.dose.optionalValue))
        return opts
    }

    // MARK: - Selecting an option
    //
    // Returns whether `TodayBeforeV5` should collapse the row. True for
    // every plain pick; false only when a reschedule comes back `.conflict`
    // — the row stays open and re-renders with "Replace" / "Keep both"
    // (RULE THREE: a refusal is an answer, not a dead end).

    private func select(_ row: V5Row, _ option: TodayBeforeGoOption) async -> Bool {
        switch row.action {
        case "change_shoe":
            guard let idStr = option.id.split(separator: "-").last, let shoeId = Int(idStr) else { return true }
            await assignShoe(shoeId)
            return true
        case "move_skip":
            if option.id == "skip" {
                await skip()
                return true
            } else if option.id == "cancel-move" {
                moveConflict = nil
                return true
            } else if option.id.hasPrefix("replace-") {
                await confirmReplace()
                return true
            } else if option.id.hasPrefix("move-") {
                let targetISO = String(option.id.dropFirst("move-".count))
                return await move(to: targetISO)
            }
            return true
        default:
            return true
        }
    }

    // MARK: - Writes
    //
    // Every write re-reads via `reload()` rather than patching local state —
    // the same posture `HostsV5.swift`'s own writes take (`logEffort`,
    // `flagNiggle`, `pushStrava`, …): the server's answer is the truth, and
    // a client-computed guess at what changed is how the phone and the
    // engine end up disagreeing.

    private func assignShoe(_ shoeId: Int) async {
        _ = try? await API.setShoeForDay(date: model.dateISO, shoeId: shoeId)
        await reload()
    }

    private func skip() async {
        _ = try? await API.postSkip(date: model.dateISO)
        await reload()
    }

    /// Returns whether the row should collapse — false on `.conflict`, so
    /// the runner sees the replace/keep-both choice instead of the row
    /// snapping shut on a move that did not happen.
    private func move(to targetISO: String) async -> Bool {
        guard let outcome = try? await API.rescheduleRun(from: model.dateISO, to: targetISO) else { return true }
        switch outcome {
        case .moved:
            moveConflict = nil
            await reload()
            return true
        case .conflict(let type, let distanceMi, let subLabel):
            // RULE THREE, in the UI: the server declined because the target
            // day is taken, not because anything failed. The row re-expands
            // with the runner's actual choice — replace it or keep both —
            // rather than surfacing an error.
            moveConflict = MoveConflict(targetISO: targetISO, targetLabel: weekdayName(targetISO),
                                        existingType: type, existingDistanceMi: distanceMi,
                                        existingSubLabel: subLabel)
            return false
        }
    }

    private func confirmReplace() async {
        guard let conflict = moveConflict else { return }
        _ = try? await API.rescheduleRun(from: model.dateISO, to: conflict.targetISO, replace: true)
        moveConflict = nil
        await reload()
    }
}
