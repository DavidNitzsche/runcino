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
//  Those need four network reads (`GET /api/shoe`, `GET
//  /api/readiness/brief`, `GET /api/v5/block`, `GET /api/plan/move`) and
//  writes to `POST /api/today/shoe`, `POST /api/today/skip`, and
//  `GET`/`POST /api/plan/move`. `HostsV5.swift` is the composition root
//  that would normally own this, but per this task's constraints it is not
//  touched here — so this view sits between `TodayHostV5` and
//  `TodayBeforeV5`: it owns exactly the local state those reads need,
//  translates the screen's callbacks into real API calls, and asks the
//  host to `reload()` its `V5Surface` after a write lands, the same way
//  every other write in this codebase re-reads rather than patches local
//  state.
//
//  `TodayHostV5` (`HostsV5.swift`) is expected to construct THIS view in
//  place of the four bare `TodayBeforeV5(...)` calls in its `content(_:)` —
//  see the exact replacement lines in the audit report. Every parameter
//  below mirrors `TodayBeforeV5`'s own signature so that swap is a rename,
//  not a rewrite.
//
//  MOVEREADJUDICATE-TODAY-1 (2026-09-06) · the move flow used to call
//  `POST /api/today/reschedule`, whose own header names itself "the older,
//  dumber verb" — no re-adjudication against race proximity, hard-session
//  spacing or the reassessment queue, no ledger row, and no undo. That is
//  the SAME `recommendReschedule` decision owner and the SAME ranked
//  options `RescheduleV5.swift` already draws through the canonical
//  `/api/plan/move` route (MOVEREADJUDICATE-1); this file now calls the
//  identical `API.fetchReschedule` / `API.applyReschedule` /
//  `API.undoReschedule` functions that file defines, rather than inventing
//  a second client for the same protocol. The row's own shape (an
//  expandable "Move to <day>" list) is unchanged — only which days it
//  offers, and what applying one actually does, changed: the offered days
//  are now the coach's own ranked candidates instead of "any rest day this
//  week", and applying one is re-adjudicated and ledgered server-side.
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
    /// BOUNDARY-1 · straight through to `TodayBeforeV5`.
    var canPageBackward: Bool = true
    var canPageForward: Bool = true
    var onOpenPacesMoved: () -> Void = {}
    var onOpenRace: (String) -> Void = { _ in }
    /// TODAYWRITE-1 · straight through to `SickReportRowV5`, which may not
    /// say "Logged. Today rests." until the server has actually taken it.
    var onReportSick: (_ symptoms: [String], _ started: String, _ hasFever: Bool) async -> V5WriteSettlement = { _, _, _ in .cancelled }
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

    /// MOVEREADJUDICATE-TODAY-1 · the canonical route's own ranked
    /// recommendation for `model.dateISO`'s workout — the SAME
    /// `V5Reschedule` `RescheduleV5.swift` decodes from the same
    /// `GET /api/plan/move`. `reschedule.options` replaces the old
    /// client-derived "any rest day in `model.weekStrip`" list in
    /// `moveOptions()` below: the days offered are now the coach's own
    /// candidates, not a client guess at which days are free.
    @State private var reschedule: V5Reschedule? = nil
    /// The engine answered and the answer is no (e.g. the session is
    /// immovable). A real refusal, not a failed read — Rule 11.
    @State private var rescheduleAbsent: String? = nil
    /// RULE THREE · the `GET /api/plan/move` prefetch failed to reach the
    /// coach at all. Distinct from `rescheduleAbsent` for the same reason
    /// `pillarsUnread`/`shoesUnread` are distinct from an empty list above.
    @State private var rescheduleUnread = false
    /// A move the server refused at APPLY time (re-adjudication runs again
    /// there regardless of what prefetch showed — see `move(toOptionId:)`).
    /// RULE THREE, in the UI: this is the engine's own reason, shown in
    /// place of the option list rather than a generic failure.
    @State private var moveRefusal: String? = nil

    /// A move that just landed, kept only long enough to offer Undo.
    /// `reload()` re-fetches `V5Today` for `model.dateISO`, and once that
    /// day's run has actually moved away, the host renders a different
    /// screen state for it (nothing left to move or skip) — this view is
    /// torn down, and any `@State` on it goes with it. So Undo has to be
    /// offered HERE, before `reload()` runs, or not at all; see
    /// `move(toOptionId:)` and `undoMove()`.
    @State private var justMoved: JustMoved? = nil

    struct JustMoved: Equatable {
        let decisionId: String
        let originalLabel: String
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
            canPageBackward: canPageBackward,
            canPageForward: canPageForward,
            onOpenPacesMoved: onOpenPacesMoved,
            onRetryProposals: { Task { await reload() } },
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
        // MOVEREADJUDICATE-TODAY-1 · the same canonical GET RescheduleV5.swift
        // calls at browse time. `to` is a required-but-unused placeholder here
        // too (see that file's `V5MoveRecommendationEnvelope` comment) — the
        // ranked `.options` this prefetch wants do not depend on it.
        async let rescheduleFetch: API.V5RescheduleFetch? = try? await API.fetchReschedule(dateISO: model.dateISO)
        let (s, p, b, r) = await (shoesFetch, pillarsFetch, blockFetch, rescheduleFetch)
        // nil is "we could not read it"; a payload with an empty list is
        // "we read it and there is nothing". Only the second one is a
        // sentence about the runner.
        shoesUnread = s == nil
        pillarsUnread = p == nil
        shoes = s?.shoes ?? []
        pillars = p?.pillars ?? []
        if case .ok(let value)? = b { block = value }
        // Rule 11 · three facts, three states — an answer, a real "no", or a
        // read that failed — never collapsed into one.
        switch r {
        case .ok(let m):
            reschedule = m; rescheduleAbsent = nil; rescheduleUnread = false
        case .absent(let text):
            reschedule = nil; rescheduleAbsent = text; rescheduleUnread = false
        case .failed, nil:
            reschedule = nil; rescheduleAbsent = nil; rescheduleUnread = true
        }
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
                        // SKIPCAL-1 · one ladder, shared with `HostsV5
                        // .calendarWeeks`, so the live path and the fallback
                        // cannot disagree about a day. `isSkipped` is the new
                        // third input — see `V5BlockDay.skipped`.
                        status: TodayCalendarDay.status(isToday: day.isToday,
                                                        isDone: day.isDone ?? false,
                                                        skipped: day.isSkipped),
                        isToday: day.isToday,
                        // CALCELLWEEK-1 (2026-09-07) · this mapping was the
                        // one actually serving the sheet (a live `block`
                        // fetch almost always succeeds, so `HostsV5`'s own
                        // `calendarWeeks` fallback below is rarely reached)
                        // and it never carried `dateISO` — a block-sourced
                        // day's `id` is a plan_workout row id with no date
                        // embedded in it, so `onPickDay(day.dateISO ??
                        // day.id)` fell through to `day.id`, which
                        // `HostsV5.dateISO(forRowID:)` could not resolve for
                        // any week outside the current one, and the tap
                        // silently closed the sheet and did nothing. This is
                        // the missing half of that fix, on the path that was
                        // actually live.
                        dateISO: day.dateISO
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
            // A move just applied, or the server just refused one — both take
            // priority over the ordinary list, same precedence the old
            // conflict state held, and for the same reason: the runner is
            // mid-decision about the LAST tap, not free to start a new one.
            if justMoved != nil || moveRefusal != nil {
                return moveOptions()
            }
            // SKIPCONFIRM-1 · already skipped today. "Skip it" a second time
            // is not an option that means anything — offer the one action
            // that does (put it back) ahead of whatever move targets remain,
            // so the runner reads confirmation before anything else.
            if row.skipped == true {
                return [TodayBeforeGoOption(id: "unskip", label: "Put it back",
                                             sub: "Skip it, run it after all")]
                    + moveOptions().filter { $0.id != "skip" }
            }
            return moveOptions()
        default:
            return []
        }
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

    /// MOVEREADJUDICATE-TODAY-1 · the coach's own ranked candidates from
    /// `GET /api/plan/move` (`reschedule.options`), the SAME array
    /// `RescheduleV5.swift`'s option list draws — replacing the old
    /// client-derived "any rest day in `model.weekStrip`" guess. Each
    /// option's `id` is prefixed `moveopt-` so `select(_:_:)` can tell a
    /// real engine option apart from this function's own informational
    /// sentinel rows (`move-none`, `move-unread`, `move-refused-dismiss`)
    /// without the two id spaces ever colliding.
    ///
    /// Four mutually exclusive states, same shape as the old conflict
    /// handling: a move just landed (offer Undo), the server just refused
    /// one (say why), the ranked list came back, or it did not (Rule 11 —
    /// a real "no" and a failed read are different sentences).
    private func moveOptions() -> [TodayBeforeGoOption] {
        if let justMoved {
            return [
                TodayBeforeGoOption(id: "undo-move", label: "Undo the move",
                                    sub: "Put it back on \(justMoved.originalLabel)"),
                TodayBeforeGoOption(id: "done-move", label: "Done")
            ]
        }
        if let moveRefusal {
            return [TodayBeforeGoOption(id: "move-refused-dismiss", label: "Could not move it",
                                        sub: moveRefusal)]
        }

        var opts: [TodayBeforeGoOption] = []
        if let reschedule {
            for o in reschedule.options {
                opts.append(TodayBeforeGoOption(
                    id: "moveopt-\(o.id)",
                    label: "Move to \(weekdayName(o.newDateISO))",
                    // The coach's own one-line verdict — the exact field
                    // `RescheduleV5.swift`'s `optionRow` draws as `whyRankedHere`.
                    // This view composes, it never re-derives a reason to move.
                    sub: o.whyRankedHere
                ))
            }
            if opts.isEmpty {
                let reason = reschedule.refusals.first?.reason
                    ?? "No day in range works without breaking the plan."
                opts.append(TodayBeforeGoOption(id: "move-none", label: "No day works right now", sub: reason))
            }
        } else if rescheduleUnread {
            opts.append(TodayBeforeGoOption(id: "move-unread", label: "Could not read move options",
                                            sub: "Nothing about today changed."))
        } else if let rescheduleAbsent {
            opts.append(TodayBeforeGoOption(id: "move-none", label: "This can’t move", sub: rescheduleAbsent))
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
            } else if option.id == "unskip" {
                await unskip()
                return true
            } else if option.id == "undo-move" {
                await undoMove()
                return true
            } else if option.id == "done-move" {
                justMoved = nil
                await reload()
                return true
            } else if option.id == "move-refused-dismiss" {
                moveRefusal = nil
                return true
            } else if option.id == "move-none" || option.id == "move-unread" {
                // Informational only — nothing to apply, nothing to dismiss.
                return true
            } else if option.id.hasPrefix("moveopt-") {
                let engineOptionId = String(option.id.dropFirst("moveopt-".count))
                return await move(toOptionId: engineOptionId)
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

    /// SKIPCONFIRM-1 · the symmetric write. `API.deleteSkip(date:)` already
    /// existed for un-skipping a future day from the week-strip preview;
    /// this is the same call reached from today's own row once it can see
    /// it was already skipped.
    private func unskip() async {
        _ = try? await API.deleteSkip(date: model.dateISO)
        await reload()
    }

    /// MOVEREADJUDICATE-TODAY-1 · applies one of the coach's own ranked
    /// options through the canonical `POST /api/plan/move` — never
    /// `/api/today/reschedule`, which writes no ledger row and supports no
    /// undo (see this file's header). `applyMove` on the server always
    /// re-adjudicates against the ACTUAL requested destination at apply
    /// time regardless of what the prefetch showed, so this stays correct
    /// even if the block changed underneath since `prefetch()` ran.
    ///
    /// Returns whether the row should collapse — false while showing the
    /// just-moved Undo offer or a refusal, matching the old conflict state's
    /// own precedent: the runner is mid-decision about the last tap, not
    /// free to have the row snap shut under them.
    private func move(toOptionId engineOptionId: String) async -> Bool {
        guard let reschedule, let opt = reschedule.options.first(where: { $0.id == engineOptionId }) else {
            return true
        }
        guard let outcome = try? await API.applyReschedule(
            dateISO: model.dateISO,
            workoutId: reschedule.target.planWorkoutId,
            toISO: opt.newDateISO,
            optionId: opt.id,
            token: reschedule.token
        ) else {
            moveRefusal = "That did not go through, and nothing was changed. Try again."
            return false
        }
        switch outcome {
        case .applied(let a):
            justMoved = JustMoved(decisionId: a.summary.decisionId, originalLabel: weekdayName(model.dateISO))
            return false
        case .appliedUnreadable:
            // ACCEPTVOICE-1's own posture (`RescheduleV5.swift`): it landed
            // and the body did not decode, so there is no `decisionId` to
            // offer Undo through — a button that cannot do what it says is
            // worse than its absence. Re-sync and let the day itself show
            // the change, same as that file's `doneUnreadable`.
            justMoved = nil
            await reload()
            return true
        case .refused(let text):
            // RULE THREE, in the UI: a 409 here is `readjudication_refused`
            // with the engine's own named findings, not a generic failure —
            // `RescheduleRefusalBody` (RescheduleV5.swift) already extracts
            // that reason text from this exact response shape.
            moveRefusal = text
            return false
        case .failed:
            moveRefusal = "That did not go through, and nothing was changed. Try again."
            return false
        }
    }

    /// RS-6 · put a move back. `undoReschedule` posts `{action: "undo",
    /// decision_id}` to the SAME `/api/plan/move` route — the old
    /// `/api/today/reschedule` had no undo at all, which is the gap this
    /// whole file was repointed to close.
    private func undoMove() async {
        guard let justMoved else { return }
        if let outcome = try? await API.undoReschedule(decisionId: justMoved.decisionId) {
            switch outcome {
            case .undone, .undoneUnreadable:
                self.justMoved = nil
                await reload()
            case .refused(let text):
                moveRefusal = text
                self.justMoved = nil
            case .failed:
                moveRefusal = "That did not go through. Your plan is as the change left it."
                self.justMoved = nil
            }
        } else {
            moveRefusal = "That did not go through. Your plan is as the change left it."
            self.justMoved = nil
        }
    }
}
