//
//  HostsV5.swift
//  faff.run iPhone · the composition root.
//
//  The screens are pure: each takes a decoded model and renders it. This file
//  is where they meet the network, the cache, and each other — one host per
//  place, and one root that wires the three places to the shell.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE ONE DECISION EVERY HOST MAKES
//
//  A screen can be in exactly four situations, and three of them are content:
//
//    the payload said something      → render it
//    the payload said "no"           → still render it. A refusal is content.
//    we have an old payload          → render it. Old is not wrong.
//    we have nothing and cannot read → THIS is the outage screen, and only this.
//
//  `V5Surface` draws that line (see SurfaceStoreV5). A host never invents a
//  fourth case, and never shows an error where the engine gave an answer.
//
//  Today has a fifth, which is not a failure either: `not_on_phone_yet`. A
//  coached runner, a just-run runner, or a distance goal with no race all work
//  end to end on the server and simply have no phone screens yet. That is a
//  refusal with a reason, not three blank screens.
//

import SwiftUI

// MARK: - Today

struct TodayHostV5: View {
    @StateObject private var surface = V5Surfaces.today()
    @Binding var path: [V5Route]
    /// The runner's own name, for the account sheet.
    var accountName: String = ""

    /// ─────────────────────────────────────────────────────────────────────
    /// LOOKING AT ANOTHER DAY
    ///
    /// The week strip drew seven days and none of them did anything. They are
    /// the obvious way to ask "what was Tuesday" or "what is Sunday", and
    /// `/api/v5/today?date=` already answers exactly that — the tomorrow
    /// preview after a niggle uses the same read.
    ///
    /// Nil means today. Anything else is a day the runner asked for, and the
    /// panel says so and offers the way back, because a screen called TODAY
    /// showing another day without saying so is a lie.
    @State private var viewingDate: String?
    /// The account sheet, hoisted here so every Today variant can open it —
    /// the after-run screen and all four state screens had a dead button.
    @State private var accountOpen = false

    /// The runner's initials for the account button, or nil for a glyph.
    private var initials: String? {
        let letters = accountName.split(separator: " ").prefix(2).compactMap(\.first)
        return letters.isEmpty ? nil : String(letters).uppercased()
    }

    var body: some View {
        Group {
            if let model = surface.model {
                // Keyed on the day, so stepping between days crossfades
                // instead of snapping. The old day stays up until the new one
                // lands (see V5Surface.rebind), so this is a fade between two
                // real screens and never a fade through nothing.
                content(model)
                    .id(model.dateISO)
                    .transition(.opacity)
            } else if let reason = surface.absentReason {
                // The engine answered and the answer is that this does
                // not apply. Silence, never ErrorNote: nothing failed.
                ScrollView {
                    VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                        wayOutHeader
                        Silence(reason: reason)
                    }
                    .padding(.horizontal, V5.S.gutter)
                    .padding(.top, V5.S.s24)
                }
                .background(V5.surfacePage)
            } else if surface.isOutage {
                // Nothing cached and the read failed. The design's own outage
                // screen needs a Today shell to sit in, and we do not have one,
                // so this is the honest floor: the note and the reserved space.
                ScrollView {
                    VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                        wayOutHeader
                        OutageBodyV5(onRetry: { Task { await surface.load() } })
                    }
                    .padding(.horizontal, V5.S.gutter)
                    .padding(.top, V5.S.s24)
                }
                .background(V5.surfacePage)
            } else {
                // Cold start. Reserve the shape the real content will take.
                coldStart
            }
        }
        .animation(V5.Motion.fill, value: surface.model?.dateISO)
        // One account sheet for every Today variant. It used to live inside
        // TodayBeforeV5, so the after-run screen and all four state screens
        // had an account button that opened nothing.
        .overlay {
            V5SheetHost(isPresented: $accountOpen) {
                VStack(alignment: .leading, spacing: V5.S.s16) {
                    HStack(alignment: .lastTextBaseline, spacing: V5.S.s12) {
                        Text(accountName)
                            .font(.faffDisplay(20))
                            .textCase(.uppercase)
                            .tracking(20 * 0.02)
                            .foregroundStyle(V5.textPrimary)
                        Spacer(minLength: V5.S.s12)
                        Text(surface.model?.panel.weekLine ?? "")
                            .font(.faffText(TypeScaleV5.label13))
                            .foregroundStyle(V5.textQuiet)
                    }
                    .padding(.horizontal, V5.S.s4)

                    ListGroup {
                        ForEach(accountRows) { row in
                            ListRow(label: row.label, sub: row.sub, onTap: {
                                withAnimation(V5.Motion.sheet) { accountOpen = false }
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                                    switch row.action {
                                    case "settings": path.append(.settings)
                                    case "shoes":    path.append(.shoes)
                                    default: break
                                    }
                                }
                            })
                        }
                    }

                    FaffButton("Close", variant: .secondary) {
                        withAnimation(V5.Motion.sheet) { accountOpen = false }
                    }
                }
            }
        }
        // The launch gate holds the splash until every destination says it is
        // painted. "Painted" includes a surface that resolved to its outage
        // state — an app that never lifts its splash because the network is
        // down is worse than one that shows the outage screen honestly.
        .task {
            await surface.load()
            NotificationCenter.default.post(name: .faffSurfaceReady, object: "today")
            // The FIRST tap a runner makes is overwhelmingly a neighbour of
            // today — yesterday, tomorrow. `goTo` prefetches around wherever
            // it lands, but that is by definition one step too late for the
            // very first navigation of the session. Priming today's own
            // neighbours here means that first tap gets the instant path
            // too, not just the second one onward.
            if let m = surface.model { await prefetchAround(m.dateISO) }
        }
        // Learn the real today the instant any payload actually carries it —
        // see `todayISO(_:)`. A plain side effect, not a render-time read: a
        // computed property (`viewingDayLabel`) calls `todayISO` too, and
        // mutating state from inside a property `body` reads during layout
        // is exactly the "modifying state during view update" trap. This
        // fires on its own schedule, whenever the model changes underneath.
        .onChange(of: surface.model?.dateISO, initial: true) { _, _ in
            guard let m = surface.model,
                  let real = m.weekStrip.first(where: \.isToday)?.dateISO else { return }
            knownTodayISO = real
        }
        // Every day that lands is kept — including a refresh of a day
        // already in the cache, where the newer payload simply overwrites
        // the old entry. A passive write only: nothing reads `dayCache`
        // except `goTo`, so this cannot be the thing two navigations race
        // over — that's `navigationTask`'s job alone.
        .onChange(of: surface.model?.dateISO, initial: true) { _, _ in
            if let m = surface.model { dayCache[m.dateISO] = m }
        }
        .refreshable { await surface.load() }
        .v5ReloadOnForeground { await surface.load() }
    }

    @ViewBuilder
    private func content(_ model: V5Today) -> some View {
        switch model.state {
        case .notOnPhoneYet:
            NotOnPhoneYetV5(reason: model.notOnPhoneYet, onOpenAccount: { accountOpen = true })

        case .changedOvernight:
            // RULE TWO. The story only exists when three independent domains
            // converged. If the payload cannot show that, this is an ordinary
            // Today and the app says nothing about a change.
            if let changed = model.changed, changed.namesAConvergence {
                TodayChangedV5(panel: model.panel, convergence: changed,
                               onOpenAccount: { accountOpen = true })
            } else {
                TodayBeforeLiveV5(model: model, accountName: accountName,
                              accountWeekLine: model.panel.weekLine ?? "",
                              accountRows: [], fallbackCalendarWeeks: calendarWeeks(model))
            }

        case .injuryFlare:
            if let injury = model.injury {
                InjuryFlareV5(model: injury,
                              onOpenAccount: { accountOpen = true },
                              onCheckIn: { row in Task { await checkInNiggle(row.id) } },
                              onReturnToRunning: { path.append(.returnToRunning) })
            } else {
                TodayBeforeLiveV5(model: model, accountName: accountName,
                              accountWeekLine: model.panel.weekLine ?? "",
                              accountRows: [], fallbackCalendarWeeks: calendarWeeks(model))
            }

        case .sick:
            if let sick = model.sick {
                SickFlareV5(model: sick,
                            onOpenAccount: { accountOpen = true },
                            onLogTrend: { row in Task { await logSickTrend(row.action) } })
            } else {
                TodayBeforeLiveV5(model: model, accountName: accountName,
                                  accountWeekLine: model.panel.weekLine ?? "",
                                  accountRows: [], fallbackCalendarWeeks: calendarWeeks(model))
            }

        case .weekOff:
            if let off = model.weekOff {
                WeekOffV5(model: off, onOpenAccount: { accountOpen = true })
            } else {
                TodayBeforeLiveV5(model: model, accountName: accountName,
                              accountWeekLine: model.panel.weekLine ?? "",
                              accountRows: [], fallbackCalendarWeeks: calendarWeeks(model))
            }

        case .offSeason:
            if let off = model.offSeason {
                OffSeasonV5(model: off, onOpenAccount: { accountOpen = true })
            } else {
                NotOnPhoneYetV5(reason: nil, onOpenAccount: { accountOpen = true })
            }

        case .afterRun:
            TodayAfterV5(model: model,
                         onOpenAccount: { accountOpen = true },
                         onLogEffort: { rpe in Task { await logEffort(model, rpe) } },
                         onFlagNiggle: { part in Task { await flagNiggle(part) } },
                         onOpenInjuryFlare: { path.append(.injuryFlare) },
                         onChangeShoe: { path.append(.shoes) },
                         onPickShoe: { id in Task { await pickShoe(model, id) } },
                         onRowAction: { _ in },
                         onPushStrava: { Task { await pushStrava(model) } },
                         onPickDay: { id in pickDay(id, in: model) },
                         viewingDayLabel: viewingDayLabel,
                         selectedDateISO: viewingDate,
                         onBackToToday: { backToToday() },
                         onPageWeek: { step($0 * 7, from: model) },
                         initials: initials,
                         onReportSick: { sym, started, fever in
                             Task { await reportSick(sym, started, fever) }
                         })

        case .beforeRun, .raceDay:
            TodayBeforeLiveV5(model: model,
                          accountName: accountName,
                          accountWeekLine: model.panel.weekLine ?? "",
                          accountRows: accountRows,
                          fallbackCalendarWeeks: calendarWeeks(model),
                          onAccountRowTap: { row in
                              switch row.action {
                              case "settings": path.append(.settings)
                              case "shoes":    path.append(.shoes)
                              default: break
                              }
                          },
                          onPickDay: { id in pickDay(id, in: model) },
                          viewingDayLabel: viewingDayLabel,
                          selectedDateISO: viewingDate,
                          onBackToToday: { backToToday() },
                          onPageWeek: { step($0 * 7, from: model) },
                          onOpenPacesMoved: { path.append(.pacesMoved) },
                          onReportSick: { sym, started, fever in
                              Task { await reportSick(sym, started, fever) }
                          },
                          reload: { await surface.load() })
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // MOVING BETWEEN DAYS
    //
    // David, 2026-08-25: "the week strip is so slow and so clunky." Then,
    // after a caching/instant-plate layer was added to fix that: "position
    // still jumping" — tapping Today from a stepped day landed on a THIRD,
    // unrelated week, reproducibly, on a clean launch.
    //
    // The cause was concurrency, not the plate or the cache themselves. Every
    // tap kicked off its own independent, un-tracked `Task { await
    // surface.rebind(...) }` — tapping Sunday started a fetch for Sunday,
    // and tapping Today a moment later started a SECOND, completely separate
    // fetch for today, with nothing stopping the first one from finishing
    // AFTER the second and overwriting it. Two in-flight requests, and the
    // display showed whichever happened to land last — not whichever the
    // runner asked for last. A background prefetch (reading the neighbouring
    // days after every navigation) added a third and fourth unmanaged
    // request into the same race.
    //
    // The fix is not "make it slower" or "make it faster" — it is "make it
    // ONE navigation at a time." `navigationTask` is the single in-flight
    // request; a new `goTo` cancels whatever is still running before
    // starting its own. `V5Surface.load()` already turns a cancelled fetch
    // into a no-op (`catch is CancellationError`), so a stale request that
    // does complete late can never again overwrite what the runner is
    // actually looking at.
    //
    // A ROUND OF FIXES LATER: "it still feels pretty slow and clunky," and
    // then, precisely: "Click on the days needs to feel like it pushes the
    // data change. Not a button, a load, wait, see it."
    //
    // Right — a round trip is a round trip, however honestly it is handled.
    // The fix is not to skip the round trip; it is to skip it ONLY when the
    // answer is already known. `dayCache` brings that back, and it is safe
    // THIS time for a specific reason the deleted version was not: every
    // write to `surface.model` — cached or fresh — now flows through the ONE
    // `navigationTask`, cancelled and replaced whole by the next `goTo`. The
    // old version's cache-hit path (`V5Surface.present`) spawned its OWN
    // second, untracked `Task` for the refresh, which is what actually let
    // two navigations race — not the idea of showing a cached day instantly.
    // `present` is `async` now and does no task-spawning of its own; the
    // caller's single `Task` covers the cached paint AND the refresh behind
    // it, so cancelling it cancels both.
    // ─────────────────────────────────────────────────────────────────────

    /// The one navigation in flight, if any. Cancelled and replaced by every
    /// new `goTo` call, so an old request can never land after a newer one.
    @State private var navigationTask: Task<Void, Never>?

    /// Days decoded this session, keyed by ISO date. Populated passively (see
    /// the `.onChange` below) and read by `goTo` alone — nothing else derives
    /// truth from it, so a stale or missing entry can only ever cost a round
    /// trip, never show the wrong day.
    @State private var dayCache: [String: V5Today] = [:]

    /// The strip hands back a plan row's server id; the date lives beside it
    /// on the same row. Identity is the id, the date is a lookup — never the
    /// other way round.
    private func pickDay(_ id: String, in model: V5Today) {
        guard let day = model.weekStrip.first(where: { $0.id == id }) else { return }
        goTo(day.dateISO, todayISO: todayISO(model))
    }

    private func backToToday() {
        guard let model = surface.model else { return }
        goTo(todayISO(model), todayISO: todayISO(model))
    }

    /// Step by days. Nil means today, so stepping from nil starts at the
    /// runner's own today rather than at a date the device invented.
    private func step(_ days: Int, from model: V5Today) {
        let base = viewingDate ?? model.dateISO
        guard let d = Self.iso.date(from: base),
              let next = Calendar.current.date(byAdding: .day, value: days, to: d) else { return }
        goTo(Self.iso.string(from: next), todayISO: todayISO(model))
    }

    /// The one way onto another day. Everything above funnels here so the
    /// header, the strip and the fetch can never disagree about which day
    /// the screen is on.
    private func goTo(_ iso: String, todayISO today: String) {
        guard iso != (viewingDate ?? today) else { return }

        // Landing back on the runner's own today is going HOME, not visiting a
        // date: `viewingDate` goes nil so the header stops offering a way back
        // to where you already are, and the read drops its `date=` parameter.
        let isHome = iso == today
        viewingDate = isHome ? nil : iso

        let param: String? = isHome ? nil : iso
        let refresh: () async throws -> API.V5Fetch<V5Today> = { try await API.fetchV5Today(date: param) }

        navigationTask?.cancel()
        if let known = dayCache[iso] {
            // Already decoded — on screen this tick, refreshed for real
            // right behind it, both inside the one Task a newer tap cancels.
            navigationTask = Task { await surface.present(known, refreshWith: refresh) }
        } else {
            navigationTask = Task { await surface.rebind(refresh) }
        }
        Task { await prefetchAround(iso) }
    }

    /// Read the days either side of `iso` quietly, and keep whatever comes
    /// back. Deliberately NOT part of `navigationTask` — it never touches
    /// `surface.model`, only `dayCache`, so it cannot race the thing that
    /// actually needs single-flight protection. Worst case on a cancelled or
    /// overtaken prefetch: a wasted read, never a wrong screen.
    ///
    /// ONE DAY EITHER SIDE, AND ONE WEEK EITHER SIDE. Those are the four
    /// moves the strip offers: the neighbouring cells, and the swipe.
    /// Prefetching the whole visible week would be seven reads for a runner
    /// who taps one.
    private func prefetchAround(_ iso: String) async {
        guard let d = Self.iso.date(from: iso) else { return }

        // ── EVERY DAY THE STRIP IS ACTUALLY SHOWING, FIRST ─────────────────
        //
        // David, live in the simulator: tapped Sunday from a Tuesday-today
        // week and it was a real, visible wait. The old radius here was
        // `[-1, 1, -7, 7]` — built around STEPPING one day at a time or
        // paging a whole week, and it does not cover Sunday from Tuesday at
        // all: Sunday is 5 days away, which is neither ±1 nor ±7. Every one
        // of the seven cells in the strip is tappable RIGHT NOW — that is
        // the whole point of drawing them — so "what might get tapped next"
        // is the visible week, not an arithmetic neighbourhood the swipe
        // gesture happens to use.
        //
        // Read off `weekStrip` itself rather than re-deriving the week's
        // bounds by hand, so this can never disagree with what the strip is
        // actually drawing.
        //
        // CONCURRENT, NOT SEQUENTIAL. Seven `await`s in a row, one after
        // another, is seven round trips of wall-clock time before the LAST
        // cell in the strip is covered — which defeats the point when the
        // whole reason this runs is to be ready before the tap. A
        // `TaskGroup` fires every read at once; the cache is warm in roughly
        // the time ONE request takes, not seven.
        if let strip = surface.model?.weekStrip {
            let missing = strip.map(\.dateISO).filter { dayCache[$0] == nil }
            if !missing.isEmpty {
                await withTaskGroup(of: (String, API.V5Fetch<V5Today>?).self) { group in
                    for key in missing {
                        group.addTask { (key, try? await API.fetchV5Today(date: key)) }
                    }
                    for await (key, result) in group {
                        if case .ok(let payload)? = result { dayCache[key] = payload }
                    }
                }
            }
        }

        // ── THEN THE SWIPE NEIGHBOURHOOD, SAME WAY ──────────────────────
        //
        // ±1 day for stepping one at a time past the visible week's own
        // edge, ±7 for "the same weekday, a week over" — priming the week
        // the strip's own swipe would land on next.
        let neighbourKeys = [-1, 1, -7, 7].compactMap { off -> String? in
            guard let n = Calendar.current.date(byAdding: .day, value: off, to: d) else { return nil }
            let key = Self.iso.string(from: n)
            return dayCache[key] == nil ? key : nil
        }
        guard !neighbourKeys.isEmpty else { return }
        await withTaskGroup(of: (String, API.V5Fetch<V5Today>?).self) { group in
            for key in neighbourKeys {
                group.addTask { (key, try? await API.fetchV5Today(date: key)) }
            }
            for await (key, result) in group {
                if case .ok(let payload)? = result { dayCache[key] = payload }
            }
        }
    }

    /// The runner's own real today, once learned. See `todayISO(_:)` — this
    /// is what makes "back to Today" still know what today IS after a week
    /// spent stepping away from it.
    @State private var knownTodayISO: String?

    /// The runner's own today. NOT simply "whatever the current payload's
    /// `isToday` row says" — that row only exists when today happens to fall
    /// inside the SAME seven-day week the payload is describing.
    ///
    /// David, 2026-08-25, live in the simulator: swiped the strip forward a
    /// full week, then tapped "Today" — nothing happened. `weekStrip` for
    /// that far week (Aug31–Sep6) holds no row for the real today (Aug25) at
    /// all, because Aug25 isn't one of its seven days. `.first(where:
    /// isToday)` correctly found nothing, and the OLD fallback —
    /// `?? model.dateISO` — silently returned the VIEWED date instead,
    /// making `backToToday()` compare that date to itself and no-op. Working
    /// perfectly one week away, dead two weeks away: the fallback was never
    /// wrong on a nearby day, which is exactly why it went unnoticed.
    ///
    /// `knownTodayISO` is the fix: captured once, whenever a payload DOES
    /// carry a real `isToday` row (which every payload does the moment the
    /// runner is anywhere in today's own week, including the instant the app
    /// opens), and kept from then on as the fallback of last resort — ahead
    /// of the viewed date, which was never a safe guess.
    private func todayISO(_ model: V5Today) -> String {
        if let real = model.weekStrip.first(where: \.isToday)?.dateISO {
            return real
        }
        return knownTodayISO ?? model.dateISO
    }

    private static let iso: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

    /// "UPCOMING" or "EARLIER" — what the place label says when it is not today.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// DAVID, 2026-08-25: "other days show the date twice. not needed. Can
    /// just say UPCOMING."
    ///
    /// This used to return "THU 27 AUG", and the panel drew "Thursday 27
    /// August" at 26pt directly underneath it. The same date, twice, six
    /// points apart — and a third time in the week strip below, where the 27
    /// is the cell wearing the plate. Three statements of one fact, in a
    /// panel whose whole job is to say what the day ASKS FOR.
    ///
    /// The date line is gone from both Today screens (see `TodayBeforeV5` and
    /// `TodayAfterV5`), so the strip is now the thing that says WHICH day —
    /// which it was always doing better, because it says it in context. That
    /// leaves this label free to say the thing the strip cannot: what the day
    /// is TO you. Today, or one you have stepped forward to, or one behind.
    ///
    /// Not the date, then, but the tense. It keeps the header's promise that
    /// a screen called TODAY showing another day is a lie, without repeating
    /// what is already on screen twice.
    private var viewingDayLabel: String? {
        guard let viewingDate, let d = Self.iso.date(from: viewingDate) else { return nil }
        // Compared against the payload's own today, never the device's.
        // `V5Today.weekStrip` carries which cell is today, and the runner's
        // day boundary is the server's to decide — the same reason `step`
        // resolves "home" from the model rather than from `Date()`.
        guard let today = surface.model.map({ todayISO($0) }),
              let t = Self.iso.date(from: today) else { return "Upcoming" }
        return d < t ? "Earlier" : "Upcoming"
    }

    /// RULE THREE · a refusal is a correct answer, and a correct answer still
    /// needs a way out of the room.
    ///
    /// Every content Today draws the account button in its own panel header.
    /// The refusal and outage branches drew neither — just the reason, alone
    /// on black. Settings is only reachable through this button, and sign-out
    /// only through Settings, so a runner the engine refuses (`not_on_phone
    /// _yet`, off-season, no plan) had no route to either from the surface the
    /// app opens on. A refusal that traps you is not a correct answer.
    ///
    /// Deliberately plain: no gradient panel, no week strip, no big headline.
    /// There is no day to draw, and dressing a refusal as content is the other
    /// half of the same mistake.
    private var wayOutHeader: some View {
        HStack(alignment: .center, spacing: V5.S.s12) {
            Text("Today")
                .font(.faffDisplay(20))
                .textCase(.uppercase)
                .tracking(20 * 0.02)
                .foregroundStyle(V5.textPrimary)
            Spacer(minLength: 0)
            // `personSize: 13`, not the kit's 14 — this screen drew its
            // person glyph a point smaller than the panel headers do and that
            // is kept as drawn. A designer's ruling, not a refactor's.
            HeaderDiscV5(glyph: .account(initials, personSize: 13),
                         label: "Account and settings",
                         fill: .quietRaised,
                         action: { accountOpen = true })
        }
    }

    /// The account sheet's rows. Not on `V5Today`'s contract — it is a shell
    /// concern, so the shell supplies it.
    private var accountRows: [V5Row] {
        [
            V5Row(id: "settings", label: "Settings", sub: "Training, notifications, units", action: "settings"),
            V5Row(id: "shoes", label: "Shoes", sub: "Rotation and retirement", action: "shoes"),
        ]
    }

    /// The training calendar. Built from the week strip the payload already
    /// carries, so the sheet and the strip can never disagree about a day.
    private func calendarWeeks(_ model: V5Today) -> [TodayCalendarWeek] {
        guard !model.weekStrip.isEmpty else { return [] }
        return [
            TodayCalendarWeek(
                id: "current",
                range: model.panel.weekLine ?? "This week",
                days: model.weekStrip.map { d in
                    TodayCalendarDay(id: d.id,
                                     label: "\(d.letter) \(d.number)",
                                     sub: d.isRest ? "Rest day" : d.dayState.capitalized,
                                     status: d.isToday ? .measured("Today")
                                           : d.isDone ? .measured("Done") : nil,
                                     isToday: d.isToday)
                }
            )
        ]
    }

    private var coldStart: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                // The panel's own height, reserved. Nothing appears or
                // disappears and reflows.
                RoundedRectangle(cornerRadius: V5.R.panel, style: .continuous)
                    .fill(V5.surface1)
                    .frame(height: 380)
                Skeleton(lines: 3)
                Skeleton(lines: 2)
            }
            .padding(.horizontal, V5.S.gutter)
        }
        .background(V5.surfacePage)
    }

    // ── writes ──

    private func logEffort(_ model: V5Today, _ rpe: Int) async {
        guard let runId = model.runId else { return }
        var req = URLRequest(url: API.baseURL.appendingPathComponent("api/runs/\(runId)/rpe"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["rpe": rpe])
        _ = try? await API.authedSend(req)
        await surface.load()
    }

    /// Persist the pair the runner picked from the shoe menu.
    ///
    /// `POST /api/today/shoe { date_iso, shoe_id }` is the same endpoint the
    /// Shoes screen already writes through, so a choice made here and a
    /// choice made there land in exactly one place.
    private func pickShoe(_ model: V5Today, _ shoeId: String) async {
        var req = URLRequest(url: API.baseURL.appendingPathComponent("api/today/shoe"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(
            withJSONObject: ["date_iso": model.dateISO, "shoe_id": shoeId])
        _ = try? await API.authedSend(req)
        // Reload rather than mutate locally: the row's mileage line changes
        // with the assignment, and a locally-patched label beside a stale
        // mileage is two numbers disagreeing about one shoe.
        await surface.load()
    }

    private func flagNiggle(_ bodyPart: String) async {
        var req = URLRequest(url: API.baseURL.appendingPathComponent("api/niggle"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "body_part": bodyPart, "severity": 1, "status": "active",
        ])
        _ = try? await API.authedSend(req)
        await surface.load()
    }

    /// The ladder's sibling: the daily flare check-in. The row ids are
    /// literally the values the endpoint expects, so there is no mapping to
    /// get wrong.
    private func checkInNiggle(_ today: String) async {
        var req = URLRequest(url: API.baseURL.appendingPathComponent("api/niggle/recovery"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["today": today])
        _ = try? await API.authedSend(req)
        await surface.load()
    }

    private func reportSick(_ symptoms: [String], _ started: String, _ hasFever: Bool) async {
        _ = try? await API.postSick(symptoms: symptoms, started: started, fever: hasFever)
        await surface.load()
    }

    /// The sick check-in is a TREND, not a one-shot note: "recovered" clears
    /// the episode server-side, which the injury flow has no equivalent of.
    private func logSickTrend(_ action: String?) async {
        let trend: String
        switch action {
        case "trend_better":    trend = "better"
        case "trend_same":      trend = "same"
        case "trend_worse":     trend = "worse"
        case "trend_recovered": trend = "recovered"
        default: return
        }
        _ = try? await API.postSickRecovery(trend: trend)
        await surface.load()
    }

    private func pushStrava(_ model: V5Today) async {
        guard let runId = model.runId else { return }
        _ = try? await API.pushRunToStrava(runId: runId)
    }
}

// MARK: - Block

struct BlockHostV5: View {
    @StateObject private var surface = V5Surfaces.block()
    @Binding var path: [V5Route]

    var body: some View {
        Group {
            if let model = surface.model {
                BlockV5(model: model,
                        onChanged: { _ in
                            // A confirmed change re-authors the plan, so both
                            // surfaces that read it are refetched rather than
                            // patched locally.
                            Task { await surface.load() }
                        },
                        onOpenRunLog: { path.append(.runLog) })
            } else if let reason = surface.absentReason {
                // The engine answered and the answer is that this does
                // not apply. Silence, never ErrorNote: nothing failed.
                ScrollView {
                    Silence(reason: reason)
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s40)
                }
                .background(V5.surfacePage)
            } else if surface.isOutage {
                ScrollView {
                    OutageBodyV5(copy: .block, onRetry: { Task { await surface.load() } })
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s40)
                }
                .background(V5.surfacePage)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                        RoundedRectangle(cornerRadius: V5.R.panel, style: .continuous)
                            .fill(V5.surface1).frame(height: 300)
                        Skeleton(lines: 4)
                    }
                    .padding(.horizontal, V5.S.gutter)
                }
                .background(V5.surfacePage)
            }
        }
        .task {
            await surface.load()
            NotificationCenter.default.post(name: .faffSurfaceReady, object: "block")
        }
        .refreshable { await surface.load() }
        .v5ReloadOnForeground { await surface.load() }
    }
}

// MARK: - Races

struct RacesHostV5: View {
    @StateObject private var surface = V5Surfaces.races()
    @Binding var path: [V5Route]

    /// What the last card answer came back as, when it came back as anything
    /// other than "done". Cleared on the next answer and on a successful one.
    @State private var answerOutcome: V5WriteOutcome?

    var body: some View {
        ZStack {
            Group {
                if let model = surface.model {
                    RacesV5(model: model,
                            answerOutcome: answerOutcome,
                            onAnswer: { a in Task { await send(a) } },
                            onEvidenceTap: { _ in },
                            onOpenRace: { row in path.append(.raceDetail(slug: row.slug)) },
                            onAddRace: { path.append(.addRace) })
                } else if let reason = surface.absentReason {
                    ScrollView {
                        Silence(reason: reason)
                            .padding(.horizontal, V5.S.gutter)
                            .padding(.top, V5.S.s40)
                    }
                    .background(V5.surfacePage)
                } else if surface.isOutage {
                    ScrollView {
                        OutageBodyV5(copy: .races, onRetry: { Task { await surface.load() } })
                            .padding(.horizontal, V5.S.gutter)
                            .padding(.top, V5.S.s40)
                    }
                    .background(V5.surfacePage)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                            RoundedRectangle(cornerRadius: V5.R.panel, style: .continuous)
                                .fill(V5.surface1).frame(height: 340)
                            Skeleton(lines: 3)
                        }
                        .padding(.horizontal, V5.S.gutter)
                    }
                    .background(V5.surfacePage)
                }
            }
            .task {
                await surface.load()
                NotificationCenter.default.post(name: .faffSurfaceReady, object: "races")
            }
            .refreshable { await surface.load() }
        .v5ReloadOnForeground { await surface.load() }
            // Coming back from a pushed screen that may have written — adding
            // a race, answering on the detail — the list behind it is stale.
            // The stack does not re-run `.task` on pop, so watch the path.
            .onChange(of: path.isEmpty) { _, isRoot in
                if isRoot { Task { await surface.load() } }
            }

        }
    }

    /// The card's own answers, sent back verbatim. The client never decides
    /// what an answer means — `action` is the engine's vocabulary and the
    /// engine applies it.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// A REFUSAL THROWN AWAY IS A BUTTON THAT DOES NOTHING
    ///
    /// This used to be `_ = try? await …`. The route answers a bad request
    /// with a 400 and a sentence, `V5Write` already carries that sentence
    /// back, and both were dropped on the floor — so the runner tapped, the
    /// surface reloaded, the same card came back, and nothing on the screen
    /// said why. See `V5WriteOutcome`: the engine declining is an answer and
    /// draws `Alert`; a write we could not complete draws `ErrorNote`.
    @MainActor
    private func send(_ a: V5CardAnswer) async {
        answerOutcome = nil
        let result = (try? await API.answerGoalCard(action: a.action,
                                                    targetSec: a.targetSec,
                                                    raceSlug: raceSlug(for: a))) ?? .failed
        switch result {
        case .ok:
            answerOutcome = nil
        case .refused(let reason):
            answerOutcome = .refused(reason)
        case .failed:
            answerOutcome = .failed("That answer did not reach us. Nothing changed, and the card is still here to answer.")
        }
        await surface.load()
    }

    /// Which race an answer is ABOUT, which is not the same race for every
    /// answer.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// THE CARD ASKED ABOUT ONE RACE AND WE ANSWERED ABOUT ANOTHER
    ///
    /// This used to send the first UPCOMING race for every action except
    /// `choose_race`. But the chip-lock card is raised about the most recent
    /// PAST race (`detectChipLock` filters `racesState.past`), so "Confirm
    /// the time" arrived naming a race with nothing provisional on it and
    /// `POST /api/v5/goal-answer` refused it `not_provisional` every single
    /// time. The route already had the right fallback — `raceSlug ?? <most
    /// recent past race>` — and it could never fire, because the phone always
    /// supplied a slug.
    ///
    ///   choose_race     · the race that stays the goal. Only the card knows
    ///                     which, and it carries it as the answer's own id.
    ///   confirm / leave · the chip-lock race. Nil on purpose: the route
    ///                     resolves it from the same query `detectChipLock`
    ///                     used, and the phone does not hold the race
    ///                     calendar — `V5RaceRow` has no recency at all, only
    ///                     `isPast`, so any guess here would be a guess.
    ///   everything else · `hold`, `take`, `not_now`, `acknowledge`,
    ///                     `repace` — the route reads its own `nextA` and
    ///                     ignores whatever we send. Sending the upcoming
    ///                     slug only made it look load-bearing.
    private func raceSlug(for a: V5CardAnswer) -> String? {
        a.action == "choose_race" ? a.id : nil
    }
}

// MARK: - Pushed screens

struct RaceDetailHostV5: View {
    let slug: String
    @Environment(\.dismiss) private var dismiss
    @StateObject private var surface: V5Surface<V5RaceDetail>

    /// What the last result submission came back as. Same rule as the Races
    /// card: a declined write is an answer, not an outage.
    @State private var submitOutcome: V5WriteOutcome?

    init(slug: String) {
        self.slug = slug
        _surface = StateObject(wrappedValue: V5Surfaces.raceDetail(slug: slug))
    }

    var body: some View {
        Group {
            if let d = surface.model {
                RaceDetailV5(raceDetail: d,
                             onSubmitResult: { finish, hr in
                                 await submitResult(finish: finish, hr: hr)
                             },
                             submitOutcome: submitOutcome,
                             onBack: { dismiss() })
            } else if let reason = surface.absentReason {
                // The engine answered and the answer is that this does
                // not apply. Silence, never ErrorNote: nothing failed.
                ScrollView {
                    Silence(reason: reason)
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s40)
                }
                .background(V5.surfacePage)
            } else if surface.isOutage {
                ScrollView {
                    OutageBodyV5(copy: .raceDetail, onRetry: { Task { await surface.load() } })
                        .padding(.horizontal, V5.S.gutter)
                }
                .background(V5.surfacePage)
            } else {
                ScrollView { Skeleton(lines: 6).padding(.horizontal, V5.S.gutter) }
                    .background(V5.surfacePage)
            }
        }
        .task { await surface.load() }
        .navigationBarBackButtonHidden(true)
    }

    /// The result write, with what came back kept.
    ///
    /// `API.postRaceResult` answers `Bool`, which cannot tell "that race is
    /// not on your schedule any more" from a dropped connection — so this
    /// calls `postRaceResultOutcome` instead and lets the screen draw the
    /// right one of the two.
    @MainActor
    private func submitResult(finish: String, hr: Int?) async {
        submitOutcome = nil
        switch await API.postRaceResultOutcome(slug: slug, finishDisplay: finish, avgHrBpm: hr) {
        case .ok:
            submitOutcome = nil
        case .refused(let reason):
            submitOutcome = .refused(reason)
        case .failed:
            submitOutcome = .failed("That time did not save. Nothing was logged, so it is safe to enter it again.")
        }
        await surface.load()
    }
}

struct PacesHostV5: View {
    @StateObject private var surface = V5Surfaces.paces()

    var body: some View {
        Group {
            if let p = surface.model {
                PacesMovedV5(paces: p, onSettled: { Task { await surface.load() } })
            } else if let reason = surface.absentReason {
                // The engine answered and the answer is that this does
                // not apply. Silence, never ErrorNote: nothing failed.
                ScrollView {
                    Silence(reason: reason)
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s40)
                }
                .background(V5.surfacePage)
            } else if surface.isOutage {
                ScrollView {
                    OutageBodyV5(copy: .paces, onRetry: { Task { await surface.load() } })
                        .padding(.horizontal, V5.S.gutter)
                }
                .background(V5.surfacePage)
            } else {
                ScrollView { Skeleton(lines: 5).padding(.horizontal, V5.S.gutter) }
                    .background(V5.surfacePage)
            }
        }
        .task { await surface.load() }
        .navigationBarBackButtonHidden(true)
    }
}

struct ReturnHostV5: View {
    @StateObject private var surface = V5Surfaces.returnToRunning()

    var body: some View {
        Group {
            if let r = surface.model {
                ReturnToRunningV5(ret: r, onCheckedIn: { Task { await surface.load() } })
            } else if let reason = surface.absentReason {
                // The engine answered and the answer is that this does
                // not apply. Silence, never ErrorNote: nothing failed.
                ScrollView {
                    Silence(reason: reason)
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s40)
                }
                .background(V5.surfacePage)
            } else if surface.isOutage {
                ScrollView {
                    OutageBodyV5(copy: .returnLadder, onRetry: { Task { await surface.load() } })
                        .padding(.horizontal, V5.S.gutter)
                }
                .background(V5.surfacePage)
            } else {
                ScrollView { Skeleton(lines: 5).padding(.horizontal, V5.S.gutter) }
                    .background(V5.surfacePage)
            }
        }
        .task { await surface.load() }
        .navigationBarBackButtonHidden(true)
    }
}

/// Adding a race is its own screen. `AddRaceV5` is bare content — it draws
/// no bar and does not scroll — so the chrome lives here, exactly as
/// `ShoesV5` and `SettingsV5` carry theirs.
/// 20a · the details sheet, and the hop to 20b.
///
/// The 0821 handoff makes this a SHEET rather than a pushed screen, and puts
/// the course on its own screen behind it, because the course is a real
/// network round trip and the race must be saved before it — "failure never
/// blocks the race from saving".
struct AddRaceHostV5: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var path: [V5Route]
    @State private var open = true

    var body: some View {
        ZStack {
            V5.surfacePage.ignoresSafeArea()
            V5SheetHost(isPresented: $open, tall: true) {
                AddRaceV5(onCancel: { close() },
                          onCreated: { _ in close() },
                          onContinueToCourse: { slug, name, mi in
                              // Replace this sheet's route with the course
                              // screen, so Back from 20b returns to Races
                              // rather than to a form for a race that now
                              // exists.
                              open = false
                              path = [.courseImport(slug: slug, name: name, distanceMi: mi)]
                          })
            }
        }
        .navigationBarBackButtonHidden(true)
        .onChange(of: open) { _, isOpen in
            // Tapping the scrim is the same as Cancel.
            if !isOpen, path.last == .addRace { dismiss() }
        }
    }

    private func close() {
        open = false
        dismiss()
    }
}

/// 20b · the course import. The race already exists.
struct CourseImportHostV5: View {
    let raceSlug: String
    let raceName: String
    let distanceMi: Double?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        CourseImportV5(raceSlug: raceSlug,
                       raceName: raceName,
                       enteredDistanceMi: distanceMi,
                       onBack: { dismiss() },
                       onDone: { dismiss() })
    }
}

struct ShoesHostV5: View {
    @Environment(\.dismiss) private var dismiss
    @State private var shoes: [Shoe] = []

    var body: some View {
        ShoesV5(shoes: shoes,
                onWear: { id in Task { await patch(id, ["preferred": true]) } },
                onRetire: { id in Task { await patch(id, ["retired": true]) } },
                onAddPair: { brand, model, shoeType, startMi in
                    Task { await addPair(brand: brand, model: model,
                                         shoeType: shoeType, startMi: startMi) }
                },
                onBack: { dismiss() })
            .task { await load() }
            .navigationBarBackButtonHidden(true)
    }

    private func load() async {
        shoes = (try? await API.fetchShoes())?.shoes ?? []
    }

    private func patch(_ id: Int, _ fields: [String: Any]) async {
        _ = try? await API.patchShoe(id: id, fields: fields)
        await load()
    }

    /// The cap is nil unless the runner typed one. The retirement band is the
    /// engine's to resolve from the shoe TYPE — the README is explicit that
    /// those figures are a backend concern and must not be hardcoded here.
    /// `startMi` is miles already on the shoe when it joins the rotation, which
    /// the API keeps as `baseline_mi` and adds to everything logged after. NOT
    /// a retirement cap — screen 21a shows no retirement figure, because that
    /// band belongs to the engine and is gated against Research/17.
    private func addPair(brand: String, model: String, shoeType: String, startMi: Double) async {
        _ = try? await API.createShoeV5(brand: brand, model: model,
                                        shoeType: shoeType, baselineMi: startMi)
        await load()
    }
}

struct SettingsHostV5: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var runGate: PhoneRunGate
    @State private var stravaConnecting = false
    @State private var model: SettingsV5Model?

    var body: some View {
        Group {
            if let model {
                SettingsV5(model: model,
                           onSetLongRunDay: { d in Task { await patch(["long_run_day": Self.dayKey(d)]) } },
                           onSetDaysPerWeek: { n in Task { await patchProfile(["weekly_frequency": n]) } },
                           onToggleSessionReminders: { v in
                               Task { await setPref("skip_recovery_enabled", v) }
                           },
                           onToggleWeeklySummary: { v in
                               Task { await setPref("weekly_checkin_enabled", v) }
                           },
                           onSetUnits: { u in Task { await patch(["units_distance": Self.unitKey(u)]) } },
                           onToggleStrava: { Task { await connectStrava() } },
                           onSetPhoneRun: { v in Task { await patch(["phone_run_enabled": v]) } },
                           onBack: { dismiss() })
            } else {
                ScrollView { Skeleton(lines: 6).padding(.horizontal, V5.S.gutter) }
                    .background(V5.surfacePage)
            }
        }
        .task { await load() }
        .navigationBarBackButtonHidden(true)
    }

    /// THE WIRE SPEAKS SHORTCODES, THE SCREEN SPEAKS WEEKDAYS.
    ///
    /// The long run day is `sun`…`sat` and the whole plan engine parses it
    /// that way (`DOW_OF_SHORTCODE` in `lib/plan/adapt.ts`, `dose-guard`).
    ///
    /// The canonical store is `profile.user_settings.long_run_day`, which is
    /// what `PATCH /api/settings` merges into and what `lib/coach/settings.ts`
    /// reads. There is ALSO a `users.long_run_day` column; nothing in web-v2
    /// reads it and onboarding leaves it stale — an earlier version of this
    /// comment named it as the target, which was wrong.
    /// This screen listed full weekday names and posted them back verbatim,
    /// so choosing a long run day would have written "Sunday" into a column
    /// every reader treats as a three-letter code — and the long run day IS
    /// the training week's boundary. Onboarding already maps both ways
    /// (`OnboardingV5.longDayOptions`); Settings does now too.
    static let dayNames: [(key: String, label: String)] = [
        ("mon", "Monday"), ("tue", "Tuesday"), ("wed", "Wednesday"),
        ("thu", "Thursday"), ("fri", "Friday"), ("sat", "Saturday"), ("sun", "Sunday"),
    ]

    static func dayLabel(_ key: String) -> String {
        dayNames.first { $0.key == key.lowercased() }?.label ?? key
    }

    static func dayKey(_ label: String) -> String {
        dayNames.first { $0.label == label }?.key ?? label.lowercased()
    }

    /// The units row is a `Select`, and a `Select` shows what it is given.
    /// The prototype's own options are label/value pairs —
    /// `[{ value: 'mi', label: 'Miles' }, { value: 'km', label: 'Kilometres' }]`
    /// — so the row reads "Miles" and the wire keeps "mi". This host used to
    /// hand the row the wire codes themselves, so Settings showed the runner
    /// two-letter codes on device while the screen's own `#Preview` showed
    /// the words. Same shape as `dayNames` above: labels out, keys in.
    static let unitNames: [(key: String, label: String)] = [
        ("mi", "Miles"), ("km", "Kilometres"),
    ]

    static func unitLabel(_ key: String) -> String {
        unitNames.first { $0.key == key.lowercased() }?.label ?? key
    }

    static func unitKey(_ label: String) -> String {
        unitNames.first { $0.label == label }?.key ?? label.lowercased()
    }

    private func load() async {
        await SettingsCache.shared.warm()
        let (settings, profile) = await SettingsCache.shared.read()
        // THE SCHEDULER READS profile.notification_prefs, NOT settings.
        // These two switches wrote `push_enabled` (which no notification
        // category consults) and `weekly_summary_enabled` (which the
        // settings route's allowlist drops on the floor), and the screen
        // showed the weekly one as ON no matter what. Both now read and
        // write the jsonb the cron actually gates on.
        let prefs = try? await API.fetchNotificationPrefs()
        model = SettingsV5Model(
            longRunDay: Self.dayLabel(settings?.long_run_day ?? "sun"),
            longRunDayOptions: Self.dayNames.map(\.label),
            daysPerWeek: profile?.weekly_frequency ?? 5,
            phoneRunEnabled: settings?.phoneRunEnabled ?? true,
            sessionReminders: prefs?.skip_recovery_enabled ?? true,
            weeklySummary: prefs?.weekly_checkin_enabled ?? true,
            units: Self.unitLabel(settings?.units_distance ?? "mi"),
            unitsOptions: Self.unitNames.map(\.label),
            stravaConnected: StravaConnection.isConnected,
            email: profile?.email ?? ""
        )
    }

    private func setPref(_ key: String, _ value: Bool) async {
        _ = await API.patchNotificationPref(key: key, value: value)
        await load()
    }

    private func patch(_ fields: [String: Any]) async {
        _ = try? await API.patchSettings(fields)
        await SettingsCache.shared.invalidate()
        await runGate.refresh()
        await load()
    }

    private func connectStrava() async {
        guard !stravaConnecting else { return }
        stravaConnecting = true
        _ = await StravaOAuthSession.shared.start()
        stravaConnecting = false
        await load()
    }

    private func patchProfile(_ fields: [String: Any]) async {
        _ = try? await API.updateProfile(fields)
        await SettingsCache.shared.invalidate()
        await load()
    }
}

// MARK: - The root

/// The three places, wired.
///
/// `live` comes in from the caller so this file does not depend on the run
/// consoles: starting a run is the one navigation in the design that leaves the
/// shell entirely, and the consoles own their own machinery.
struct FaffV5Root<LiveContent: View>: View {
    @StateObject private var runGate = PhoneRunGate()
    @State private var selected: FaffTabV5 = .today
    /// Read from the profile rather than passed in, so the account button
    /// shows the runner's own initials instead of an empty disc.
    @State private var accountName: String = ""
    @ViewBuilder var live: (LiveRunMode, @escaping () -> Void) -> LiveContent

    var body: some View {
        RootV5(
            selected: $selected,
            showRun: runGate.enabled,
            today: { path in TodayHostV5(path: path, accountName: accountName) },
            block: { path in BlockHostV5(path: path) },
            races: { path in RacesHostV5(path: path) },
            route: { route, path in
                switch route {
                case .raceDetail(let slug): RaceDetailHostV5(slug: slug)
                case .runLog:               RunLogHostV5(path: path)
                case .runDetail(let id):    RunDetailHostV5(id: id)
                case .settings:             SettingsHostV5()
                case .shoes:                ShoesHostV5()
                case .addRace:              AddRaceHostV5(path: path)
                case .courseImport(let slug, let name, let mi):
                    CourseImportHostV5(raceSlug: slug, raceName: name, distanceMi: mi)
                case .pacesMoved:           PacesHostV5()
                case .returnToRunning:      ReturnHostV5()
                case .injuryFlare:          InjuryPreviewHostV5()
                }
            },
            live: live
        )
        .environmentObject(runGate)
        .task {
            await runGate.refresh()
            // The profile-state payload is already cached at launch, so this
            // is a synchronous read in the common case, not a fetch.
            if let cached = AppCache.read(.profileState, as: ProfileState.self),
               let name = cached.identity.full_name, !name.isEmpty {
                accountName = name
            } else if let fresh = try? await API.fetchProfileState(),
                      let name = fresh.identity.full_name, !name.isEmpty {
                accountName = name
            }
        }
    }
}

// MARK: - What tomorrow becomes
//
// "Flagging a niggle in 5b/5c reveals a link to 13a, showing what tomorrow
//  becomes if the niggle is still there."
//
// So this is not today's screen pushed onto itself — it is TOMORROW, asked for
// by date. `/api/v5/today?date=` already answers that, and the engine decides
// whether the flare it was just told about turns tomorrow into an injury day.
// If it does not, the honest answer is that nothing changes, and the screen
// says so rather than showing a flare that the engine did not call.

struct InjuryPreviewHostV5: View {
    @StateObject private var surface: V5Surface<V5Today>

    init() {
        let iso = InjuryPreviewHostV5.tomorrowISO()
        _surface = StateObject(wrappedValue: V5Surface(cache: nil) {
            try await API.fetchV5Today(date: iso)
        })
    }

    /// The runner's own tomorrow. The device's calendar is the right clock
    /// here: the server re-resolves the date in the runner's timezone anyway,
    /// and this is a preview, not a write.
    private static func tomorrowISO() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date())
    }

    var body: some View {
        Group {
            if let model = surface.model {
                if let injury = model.injury {
                    InjuryFlareV5(model: injury)
                } else {
                    // A refusal, not an empty state: we read tomorrow and the
                    // answer is that it still stands.
                    ScrollView {
                        VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                            Silence(reason: "Tomorrow still stands as planned. If the niggle is still there in the morning, say so and the day changes then.")
                        }
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s40)
                    }
                    .background(V5.surfacePage)
                }
            } else if let reason = surface.absentReason {
                // The engine answered and the answer is that this does
                // not apply. Silence, never ErrorNote: nothing failed.
                ScrollView {
                    Silence(reason: reason)
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s40)
                }
                .background(V5.surfacePage)
            } else if surface.isOutage {
                ScrollView {
                    OutageBodyV5(copy: .tomorrow, onRetry: { Task { await surface.load() } })
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s40)
                }
                .background(V5.surfacePage)
            } else {
                ScrollView { Skeleton(lines: 5).padding(.horizontal, V5.S.gutter) }
                    .background(V5.surfacePage)
            }
        }
        .task { await surface.load() }
        .navigationBarBackButtonHidden(true)
    }
}

// MARK: - Live run
//
// The one navigation in the design that leaves the shell entirely. Both
// consoles need the day's plan — the pace band, the ceiling, the phases — and
// that comes from the same `/api/watch/today` payload the watch reads, so the
// phone and the wrist are never prescribing different things.

struct LiveRunHostV5: View {
    let mode: LiveRunMode
    let onDismiss: () -> Void

    /// Owned here, for exactly the run's lifetime. The consoles observe it;
    /// they neither own nor drive it, because ending a run has to outlive the
    /// screen that was showing it — and because a run whose clock depends on
    /// a view rendering is a run that stops when the view does not. The
    /// tracker keeps its own clock (`PhoneRunTracker.startClock`).
    @StateObject private var tracker = PhoneRunTracker()
    @StateObject private var hr = TreadmillHRStreamer()

    @State private var plan: LiveRunPlanV5?
    /// True once the workout has been asked for. Until then neither console
    /// renders, because a live console that appears and then reflows when the
    /// plan lands is exactly what the design forbids.
    @State private var asked = false
    /// The End confirm. A run is hours of work and End is a single tap next
    /// to Pause; it used to finish, save and dismiss with no step in between.
    @State private var confirmingEnd = false
    /// Set when a run this app died in the middle of was recovered on the way
    /// in — see `.task`. Shown once, on this console, because there is
    /// nowhere else the runner would think to look for it.
    @State private var recovered: PhoneRunCheckpoint?

    var body: some View {
        Group {
            // 2026-08-21 · this was built unconditionally and merely hidden
            // with `.opacity(asked ? 1 : 0)`. A hidden view is still a live
            // view: the treadmill console's clock was already ticking, and its
            // `State(initialValue:)` seeds — including the belt's starting
            // speed — were resolved against a `plan` that had not arrived, so
            // every planned session opened at the flat fallback speed and
            // counted the fetch as running. Build it when there is something
            // to build it from.
            if asked {
                switch mode {
                case .outdoor:
                    // A run worth keeping gets a confirm; an empty console —
                    // the refusal screen's "Back", or a mode opened by
                    // accident — just leaves, because there is nothing to be
                    // sure about.
                    LiveRunOutdoorV5(tracker: tracker, hr: hr, plan: plan,
                                     onPause: togglePause,
                                     onEnd: { if hasRecordedRun { confirmingEnd = true } else { end() } })
                case .treadmill:
                    LiveRunTreadmillV5(plan: plan, hr: hr,
                                       onPause: togglePause, onEnd: end)
                }
            } else {
                V5.surfacePage.ignoresSafeArea()
            }
        }
        .overlay { if mode == .outdoor { endConfirmSheet } }
        .task {
            // A run the app was killed in the middle of, re-submitted through
            // the same durable queue a normal End uses. Done BEFORE this
            // session starts, so the checkpoint on disk belongs to exactly
            // one run at a time. Idempotent at the server (row id derives
            // from workoutId), so this can never duplicate a run that did
            // manage to save.
            if mode == .outdoor { recovered = PhoneRunTracker.flushInterruptedRun() }
            // A failure here is not an outage screen: the run can still be
            // recorded, it just has no target to hold. `plan` stays nil and
            // both consoles already draw their no-target layout.
            if let w = try? await API.fetchWatchWorkout() {
                plan = LiveRunPlanV5(workout: w, sessionType: w.name)
            }
            asked = true
            // Safe before authorization has been answered: the tracker
            // remembers the request and starts itself when the prompt is
            // answered. It used to return silently, leaving a live-looking
            // console frozen at 0:00 on every runner's first ever run.
            if mode == .outdoor { tracker.start() }
            // 2026-08-21 · the HR stream is NOT started here any more.
            // `TreadmillHRStreamer.start` is first-caller-wins on the sample
            // anchor, and this call fires with "whenever the plan finished
            // loading" — racing both consoles, which start it themselves with
            // the run's actual start instant. Whichever won pinned the anchor,
            // and the console's more accurate one was silently discarded.
            // Each console owns its own anchor because each console knows
            // when its run began.
        }
    }

    /// ─────────────────────────────────────────────────────────────────────
    /// THE END CONFIRM
    ///
    /// Three shapes, because there are three different things End can mean:
    ///
    ///   · a real run   → say what is about to be saved, and save it;
    ///   · nothing yet  → there is no run here to keep, so leaving is
    ///                    leaving, and it must not claim to have saved
    ///                    anything (the old path POSTed a 0.00 mi run, which
    ///                    the backend's sub-threshold guard then had to throw
    ///                    away — a lie that happened to be caught downstream);
    ///   · refused      → location is off, so the button is just a way out.
    @ViewBuilder
    private var endConfirmSheet: some View {
        V5SheetHost(isPresented: $confirmingEnd, title: hasRecordedRun ? "End the run" : "Leave") {
            VStack(alignment: .leading, spacing: V5.S.s16) {
                if let recovered {
                    Alert(text: "A run the app was interrupted during was saved on the way in: "
                          + "\(String(format: "%.2f", recovered.distanceMi)) mi.")
                }
                Text(endSheetBody)
                    .font(.faffText(TypeScaleV5.body15))
                    .foregroundStyle(V5.textSecondary)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                FaffButton(hasRecordedRun ? "End and save" : "Leave", variant: .primary, size: .lg) {
                    confirmingEnd = false
                    end()
                }
                FaffButton("Keep running", variant: .ghost, size: .lg) {
                    confirmingEnd = false
                }
            }
        }
    }

    /// Enough to be a run: the same thresholds the backend's sub-threshold
    /// guard uses (lib/runs/length-guard.ts · < 0.25 mi AND < 180 s is a tap
    /// test), asked here so the answer on screen matches the answer the
    /// server would give.
    private var hasRecordedRun: Bool {
        tracker.distanceMi >= 0.25 || tracker.elapsedSec >= 180
    }

    private var endSheetBody: String {
        guard hasRecordedRun else {
            return "Nothing has been recorded yet, so there is nothing to save."
        }
        let dist = String(format: "%.2f", tracker.distanceMi)
        let m = tracker.elapsedSec / 60, s = tracker.elapsedSec % 60
        let clock = "\(m):" + String(format: "%02d", s)
        var line = "Saves \(dist) mi in \(clock)."
        if tracker.trackHasGap {
            line += " Part of the track could not be measured, so the distance reads short."
        }
        return line
    }

    /// ─────────────────────────────────────────────────────────────────────
    /// ONLY AN OUTDOOR RUN HAS A TRACKER
    ///
    /// These drove `PhoneRunTracker` regardless of mode, and on a treadmill
    /// that is actively wrong: the treadmill console owns its own clock and
    /// its own speed/incline state, and there is no GPS involved at all. The
    /// symptom was unmissable once it was on a device — tapping Pause during
    /// a TREADMILL run called `tracker.start()`, which asked the runner for
    /// location permission mid-session, on the one screen the design defines
    /// as "speed and incline, no GPS".
    private func togglePause() {
        guard mode == .outdoor else { return }
        tracker.state == .running ? tracker.pause() : tracker.start()
    }

    /// ─────────────────────────────────────────────────────────────────────
    /// ENDING A RUN HAS TO SAVE IT, AND HAS TO LET GO OF THE SCREEN
    ///
    /// This used to call `tracker.finish()` and a caller-supplied `onDismiss`
    /// that was literally `{}`. Two failures at once, and the second one hid
    /// the first: the recorded run never reached the server, and the console
    /// is a `fullScreenCover` with no dismiss gesture, so the runner was left
    /// on a frozen clock with no way out short of force-quitting the app.
    ///
    /// The save goes through `WatchSync.saveCompletionDurably`, which is the
    /// same door the legacy recorder and the watch both use: it writes the
    /// payload to disk BEFORE attempting the network, so a failed POST is
    /// "will sync later" and never "run gone". That property is the whole
    /// reason to reuse it rather than POST from here.
    private func end() {
        guard mode == .outdoor else {
            // A treadmill session has no recorder behind it yet — the console
            // owns its own numbers and nothing has ever been persisted from
            // it. Leaving is leaving; it must not pretend to have saved.
            onDismiss()
            return
        }
        hr.stop()
        // Nothing worth keeping: throw it away rather than POST a run the
        // backend will only discard. `discard()` also clears the checkpoint,
        // so the recovery path does not resurrect it on the next open.
        guard hasRecordedRun else {
            tracker.discard()
            onDismiss()
            return
        }
        tracker.finish()
        // The phone is recording the ROUTE. That does not mean there is no
        // wrist: a watch worn on an outdoor run writes HR into HealthKit
        // exactly as it does on a treadmill, and this path used to drop
        // every one of those samples on the floor, so a phone-recorded run
        // reached the coach engine with no heart rate at all.
        let sessionHr = hr.closeSession()
        let id = tracker.workoutId
        let payload = tracker.buildCompletionPayload(status: "completed",
                                                     avgHr: sessionHr.avg,
                                                     maxHr: sessionHr.max)
        if let data = try? JSONSerialization.data(withJSONObject: payload) {
            Task {
                _ = await WatchSync.shared.saveCompletionDurably(data)
                // Only once the payload is in the durable queue. A crash in
                // the gap leaves the checkpoint intact and the run
                // recoverable; clearing it at `finish()` would have opened a
                // window where the run existed nowhere.
                PhoneRunTracker.clearCheckpoint(workoutId: id)
            }
        }
        onDismiss()
    }
}

// MARK: - Onboarding
//
// ─────────────────────────────────────────────────────────────────────────
// THE V5 ONBOARDING EXISTED AND NEVER RAN
//
// `OnboardingV5.swift` is a complete five-step flow and its only call sites
// were its own `#Preview` blocks. The launch gate still routed every new
// signup through the v4 `OnboardingView`, so a runner's very first experience
// of the app was the design the rest of it had replaced.
//
// This is the half that was missing: the submit. The screen collects answers
// and refuses to invent validation the engine does not have; this turns those
// answers into the two calls the backend actually wants, and then reads day
// one back out of the same Today surface the app runs on — rather than
// composing a preview of it, which would be a second source of truth for the
// most important screen in the product.

struct OnboardingHostV5: View {
    /// Fired once the runner has a plan and has seen day one.
    let onDone: () -> Void

    var body: some View {
        OnboardingV5(onSubmit: submit, onSeeToday: onDone)
    }

    /// The mileage rungs `/api/onboarding/complete` accepts (`VALID_WEEKLY_MI`).
    /// Anything else is dropped on the floor by the route, silently, so the
    /// stepper's arbitrary integer has to be snapped to a legal rung before it
    /// is sent. Snapping DOWN, never up: the cold-start volume curve and the
    /// pace floor both read this number, and over-reporting a base is the
    /// direction that hurts.
    /// The route requires a non-empty `name` and 400s without one. Signup
    /// already captured it, so this reads it back rather than asking again —
    /// the same source the v4 deck greets the runner from. The fallback is the
    /// v4 deck's own, so a nameless invite still gets past the gate instead of
    /// being stranded on a refusal it cannot answer.
    private static func resolvedName() async -> String {
        let n = (try? await API.fetchProfileState())?.identity.full_name ?? ""
        let trimmed = n.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? "Runner" : trimmed
    }

    private static let validWeeklyMi = [0, 5, 15, 25, 35, 45, 55, 65, 75, 85, 95]

    private static func snapWeeklyMi(_ mi: Int) -> Int {
        validWeeklyMi.last(where: { $0 <= mi }) ?? 0
    }

    /// The band `history_avg_weekly_mi` is derived from, mirroring the v4
    /// deck's own derivation (`OnboardingView.onboardingPayload`) so the two
    /// front doors seed the engine identically. Every value is in the route's
    /// `VALID_HIST_AVG`.
    private static func histAvgBand(_ mi: Int) -> String {
        switch mi {
        case ..<5:  return "0-5"
        case ..<15: return "5-15"
        case ..<25: return "15-25"
        case ..<35: return "25-35"
        case ..<45: return "35+"
        case ..<55: return "45+"
        case ..<65: return "45-60"
        case ..<85: return "60-80"
        default:    return "80+"
        }
    }

    private func submit(_ a: OnboardingV5Answers) async -> OnboardingV5Outcome {
        // ── the plan ──────────────────────────────────────────────────────
        // `distance` is the goal distance; the route validates it against its
        // own set and ignores anything it does not know, so there is no client
        // validation to duplicate here.
        //
        // EVERY FIELD BELOW WAS CHECKED AGAINST THE ROUTE'S OWN VALIDATORS
        // (2026-08-21 onboarding audit). Four of them did not survive the trip:
        //
        //   · `name` was never sent, and the route answers `400 name is
        //     required` before it reads anything else. Every submit from this
        //     screen refused, with the server's own sentence, no matter what
        //     the runner answered. The screen has no name field — signup
        //     already took it — so it is read back off the profile.
        //   · `weeklyMi` was sent unconditionally from a `10...70` stepper.
        //     `VALID_WEEKLY_MI` is a fixed rung set, so 24 (the stepper's own
        //     default) was dropped, AND it was sent for runners who never
        //     answered a volume question at all — a new runner was claiming a
        //     24 mi/wk base they had not reported.
        //   · `weeklyFreq` came off a `2...7` stepper; the route's `VALID_FREQ`
        //     stops at 6, so a seven-day runner's frequency was dropped.
        //   · `longRunDay` was patched through /api/settings AFTER this call —
        //     but this call is what authors the plan, and the generator reads
        //     `user_settings.long_run_day` while composing. The long run day is
        //     the training week's boundary, so the first block was built on the
        //     default Sunday and only later weeks would honour the answer. It
        //     belongs in this payload, which the route already accepts.
        var payload: [String: Any] = [
            "distance": a.distance,
            "timezone": TimeZone.current.identifier,
            "connectionsSkipped": true,
            "longRunDay": a.longRunDay,
            "weeklyFreq": min(max(a.daysPerWeek, 0), 6),
        ]
        // The route requires a name and the runner already gave one at signup.
        payload["name"] = await Self.resolvedName()
        if let raceDate = a.raceDate {
            let f = DateFormatter()
            f.dateFormat = "yyyy-MM-dd"
            payload["date"] = f.string(from: raceDate)
        }
        if !a.goalTime.isEmpty { payload["time"] = a.goalTime }

        // VOLUME IS ONLY SENT WHEN THE RUNNER ANSWERED A VOLUME QUESTION.
        // `weeklyMi` is the follow-up field for exactly one fitness mode; the
        // other four ask something else, and the stepper's default is not an
        // answer. A number nobody gave is a modelled number wearing a measured
        // number's clothes, which is the one thing this app does not do.
        if a.fitnessMode == .consistent {
            let mi = Self.snapWeeklyMi(a.weeklyMi)
            payload["weeklyMi"] = mi
            payload["histAvg"] = Self.histAvgBand(mi)
        }
        // "New to structured training" is the one mode that states a tier the
        // runner chose themselves. The others leave `experience_level` to the
        // route's own derivation rather than asserting a ±20 mi/wk claim off an
        // answer to a different question.
        if a.fitnessMode == .new { payload["experienceLevel"] = "beginner" }

        // A self-reported recent race is the strongest fitness evidence the
        // runner can give on day one — and it is NOT sent, because this screen
        // does not collect what the route needs. `validateRaceHistory` requires
        // `distance` from a fixed set, `timeSec` as an integer, and `whenRaced`
        // from `<6mo|6-12mo|1-2yr|2+yr`; the screen has two free-text fields and
        // never asks when. The previous code posted `{distance: "Half
        // marathon", time: "1:38:12"}`, which fails all three checks and was
        // dropped entry-by-entry with no error — the runner's PR looked
        // accepted and reached nothing. Sending a `whenRaced` the runner never
        // gave would be inventing evidence, so this stays unsent until the
        // screen asks the question (the v4 deck already does: distance chips, a
        // finish-time wheel, and a recency selector).
        _ = a.recentRaceDistance

        do {
            try await API.completeOnboarding(payload: payload)
        } catch let e as APIServerError {
            // A 4xx only — `completeOnboarding` now throws `badStatus` for a
            // 5xx, which lands in the generic catch below as an outage. The
            // engine read the goal and declined. That is an answer.
            // `?? fallback` here was dead: APIServerError.message is
            // non-optional, so an EMPTY `error` from the route rendered an
            // empty amber Alert with no sentence in it. Test the contents.
            let said = e.message.trimmingCharacters(in: .whitespacesAndNewlines)
            return .refused(reason: said.isEmpty
                ? "That goal is not one we can build a plan toward yet."
                : said)
        } catch {
            // Offline, or the engine fell over. Nothing was decided about
            // this runner's goal, so this is not a refusal.
            return .outage("We could not reach faff to write your plan. Nothing you entered is lost.")
        }

        // ── the week ──────────────────────────────────────────────────────
        // What is left after the payload: the phone-run switch, which is a
        // setting and not an onboarding field. `long_run_day` and
        // `weekly_frequency` now ride the payload above (they had to — the plan
        // is authored inside that call), and are re-sent here only so the two
        // stores agree if the route ever stops accepting them.
        _ = try? await API.patchSettings([
            "long_run_day": a.longRunDay,
            "phone_run_enabled": a.phoneStart,
        ])
        _ = try? await API.updateProfile(["weekly_frequency": min(max(a.daysPerWeek, 0), 6)])
        await SettingsCache.shared.invalidate()

        // ── day one ───────────────────────────────────────────────────────
        // Read it off the real Today surface. A preview composed here would be
        // a second source of truth for the first screen the runner ever sees.
        // The plan write above SUCCEEDED. Whatever happened here, the runner
        // is onboarded, so this must never read as a declined goal.
        guard case .ok(let today) = (try? await API.fetchV5Today()) ?? .failed else {
            return .outage("Your plan is written. We could not read day one just now.")
        }
        return .success(OnboardingV5DayOne(
            phaseLine: today.panel.dateLine,
            dayState: today.panel.state,
            sessionType: today.panel.type,
            dose: today.panel.dose.unreadableIfAbsent,
            coachLine: today.why ?? ""
        ))
    }
}


// MARK: - Run history
//
// The one surface v5 had no answer for at all: nothing could open a finished
// run. `GET /api/log` has the history and `GET /api/runs/[id]` has the run;
// neither was reachable.
//
// These take a plain `Model?` rather than a `V5Surface`, because they read the
// older endpoints that predate the v5 wire contract and do not carry its
// refusal shape. When those move over, so should these.

struct RunLogHostV5: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var path: [V5Route]
    @State private var log: LogState?
    /// RULE THREE · the read failed and we have nothing.
    ///
    /// This used to be the absence of `log` and nothing else, so a dropped
    /// connection drew the cold-start `Skeleton` — forever, with no retry.
    /// A skeleton is a claim that we are still looking. When we have stopped
    /// looking it is the one thing the screen must not say.
    @State private var outage = false

    var body: some View {
        Group {
            if let log {
                RunLogV5(log: log,
                         onOpenRun: { id in path.append(.runDetail(id: id)) },
                         onBack: { dismiss() })
            } else if outage {
                ScrollView {
                    OutageBodyV5(copy: .runLog, onRetry: { Task { await load() } }, skeletonLines: 6)
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s24)
                }
                .background(V5.surfacePage)
            } else {
                ScrollView { Skeleton(lines: 6).padding(.horizontal, V5.S.gutter) }
                    .background(V5.surfacePage)
            }
        }
        .task { await load() }
        .navigationBarBackButtonHidden(true)
    }

    private func load() async {
        outage = false
        let fetched = try? await API.fetchLog(limit: 120)
        if let fetched { log = fetched } else { outage = true }
    }
}

struct RunDetailHostV5: View {
    let id: String
    @Environment(\.dismiss) private var dismiss
    @State private var detail: RunDetail?
    @State private var recap: RunRecap?
    /// RULE THREE, the three states kept apart.
    ///
    /// One `RunDetail?` used to carry all three: a run that is not this
    /// runner's, a failed read, and a read still in flight all arrived as
    /// nil, and the screen drew a `Skeleton` that never resolved. The
    /// refusal case is the one the design names by name — a correct answer
    /// wearing the loading treatment is the same lie as one wearing the
    /// outage treatment, and it is a quieter lie, so it survived longer.
    @State private var absentReason: String?
    @State private var outage = false

    var body: some View {
        Group {
            if let detail {
                RunDetailV5(detail: detail, recap: recap, onBack: { dismiss() })
            } else if let absentReason {
                // The engine read it and the answer is no. `Silence`, never
                // `ErrorNote`: nothing failed.
                ScrollView {
                    Silence(reason: absentReason)
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s24)
                }
                .background(V5.surfacePage)
            } else if outage {
                ScrollView {
                    OutageBodyV5(copy: .runDetail, onRetry: { Task { await load() } }, skeletonLines: 8)
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s24)
                }
                .background(V5.surfacePage)
            } else {
                ScrollView { Skeleton(lines: 8).padding(.horizontal, V5.S.gutter) }
                    .background(V5.surfacePage)
            }
        }
        .task { await load() }
        .navigationBarBackButtonHidden(true)
    }

    private func load() async {
        absentReason = nil
        outage = false
        switch (try? await API.fetchV5RunDetail(id: id)) {
        case .ok(let value)?:
            detail = value
            // The recap is an enrichment, not the screen. A recap that does
            // not come back leaves the run itself perfectly readable, so its
            // absence must not reach any of the three states above.
            recap = try? await API.fetchRunRecap(runId: id)
        case .absent(let reason)?:
            absentReason = reason
        default:
            outage = true
        }
    }
}
