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
import UIKit

// MARK: - Bounded, deduplicating day-fetch coordinator
//
// REQCOORD-1 (2026-09-03) · "Fourteen concurrent single-day requests are an
// improvement over no prefetch, but they are not the desired architecture.
// The development server crashing under rapid navigation is evidence that
// the request shape matters."
//
// A genuine one-request-per-week endpoint does not land in this pass — see
// the handback's own "Load weeks as weeks" section for why (the composition
// a week response needs does not exist server-side yet, and writing it
// fresh, under this pass's time budget, for coaching-facing pace/HR output
// is exactly the kind of rushed addition this codebase's doctrine warns
// against). This is the review's own explicit fallback: a coordinator that
// prevents uncontrolled fan-out, so the master task — weeks loading as
// coherent units — stays open rather than silently declared done.
//
// Two things a widened `TaskGroup` alone did not give:
//   1 · DEDUPE. Two overlapping prefetch calls — the visible week's own
//       fetch and the adjacent-week fetch, or two navigations landing close
//       together — used to each fire their own request for the same date.
//       A date already in flight is handed the SAME task, never a second one.
//   2 · A BOUND. However many dates a burst of swipes wants primed, only
//       `maxConcurrent` requests are ever open on this coordinator at once —
///      the measured cause of the local dev server crash this pass's own
//       torture test recorded.
@MainActor
final class DayFetchCoordinator {
    private var inFlight: [String: Task<V5Today?, Never>] = [:]
    private let maxConcurrent: Int
    /// The actual network call — injectable so `DayFetchCoordinatorTests`
    /// can exercise dedup, the concurrency bound, and stale-response
    /// rejection against a controllable fake, never a real network
    /// dependency. Defaults to the real endpoint for every production call
    /// site.
    private let fetchOne: (String) async -> V5Today?

    init(
        maxConcurrent: Int = 6,
        fetchOne: @escaping (String) async -> V5Today? = { date in
            if case .ok(let payload)? = try? await API.fetchV5Today(date: date) { return payload }
            return nil
        }
    ) {
        self.maxConcurrent = maxConcurrent
        self.fetchOne = fetchOne
    }

    /// How many fetches are in flight RIGHT NOW — a testable seam for
    /// asserting the concurrency bound actually held mid-flight, not one
    /// inferred from timing alone.
    var inFlightCount: Int { inFlight.count }

    /// Fetch `dates`, deduped and capped, and return whatever came back
    /// `.ok`, keyed by date. Never cancels anything — this feeds prefetch,
    /// which is advisory. `TodayHostV5.navigationTask` remains the ONLY
    /// thing that owns cancellation of the runner's actual selection; a
    /// prefetch that turns out to be unwanted just goes unread, the same
    /// as it always has.
    func fetch(_ dates: [String]) async -> [String: V5Today] {
        var results: [String: V5Today] = [:]
        var pending = dates
        while !pending.isEmpty {
            let batch = Array(pending.prefix(maxConcurrent))
            pending.removeFirst(batch.count)
            await withTaskGroup(of: (String, V5Today?).self) { group in
                for date in batch {
                    let task = inFlight[date] ?? {
                        let t = Task { await self.fetchOne(date) }
                        inFlight[date] = t
                        return t
                    }()
                    group.addTask {
                        (date, await task.value)
                    }
                }
                for await (date, payload) in group {
                    if let payload { results[date] = payload }
                }
            }
            for date in batch { inFlight.removeValue(forKey: date) }
        }
        return results
    }
}

// MARK: - Directional panel transition (PANELMOTION-1)
//
// "Later date: old content moves slightly left and fades; earlier date: old
// content moves slightly right and fades; new content enters from the
// corresponding direction... same-date refresh: crossfade only." A plain
// `.move(edge:)` slides a full frame width, which reads as a page changing,
// not a date changing — this moves by a fixed, small offset instead, the
// "8-16pt, not theatrical" the polish pass asked for.
private struct PanelSlideModifier: ViewModifier {
    let offsetX: CGFloat
    let opacity: Double
    func body(content: Content) -> some View {
        content.offset(x: offsetX).opacity(opacity)
    }
}

private extension AnyTransition {
    /// `sign` is +1 for a later date (content enters from the trailing edge,
    /// exits toward leading) and -1 for an earlier one (reversed). A `sign`
    /// of 0 (no directional read yet — first render) degrades to a plain
    /// crossfade rather than guessing a direction nothing chose.
    static func todayPanel(sign: Int, points: CGFloat = 12) -> AnyTransition {
        guard sign != 0 else { return .opacity }
        let enter = points * CGFloat(sign)
        return .asymmetric(
            insertion: .modifier(
                active: PanelSlideModifier(offsetX: enter, opacity: 0),
                identity: PanelSlideModifier(offsetX: 0, opacity: 1)
            ),
            removal: .modifier(
                active: PanelSlideModifier(offsetX: -enter, opacity: 0),
                identity: PanelSlideModifier(offsetX: 0, opacity: 1)
            )
        )
    }
}

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

    /// STATEGATE-1 (2026-09-03) · THE GOVERNING INVARIANT, AS A TYPE.
    ///
    /// "The app must never render workout content for date A beneath a
    /// selected or labeled date B." STALEDAY-1 answered this with an honest
    /// banner explaining the mismatch — correct information, wrong fix: the
    /// review that followed it named the actual rule precisely — "do not
    /// solve a state-integrity defect with explanatory copy" — because the
    /// workout card itself still rendered the WRONG day underneath. A caller
    /// could always read past the banner (or fail to render it — the two
    /// mismatch conditions were themselves stacked as two separate `if`s at
    /// one point in this file's history) and reach `content(model)` with a
    /// `model` that did not belong to the visible selection.
    ///
    /// `readiness(for:wanted:)` is the fix: `content(_:)` is called from
    /// EXACTLY ONE place below, and only when `.match` says the payload's own
    /// `dateISO` equals the date the runner asked for. There is no second
    /// path in. A day whose content has not arrived yet is `.loading`, not a
    /// stale render of some OTHER day; a day whose fetch genuinely failed is
    /// `.failed`, not a silent freeze on whatever loaded before it. See
    /// `TodayNavigationTests.testReadinessNeverMatchesADifferentDate` for the
    /// assertion this makes into a compile-time-adjacent guarantee — the enum
    /// carries no case that can hold a mismatched pair at all.
    enum ContentReadiness: Equatable {
        case match(V5Today)
        case loading(date: String)
        case failed(date: String)

        static func == (l: ContentReadiness, r: ContentReadiness) -> Bool {
            switch (l, r) {
            case (.match(let a), .match(let b)): return a.dateISO == b.dateISO
            case (.loading(let a), .loading(let b)): return a == b
            case (.failed(let a), .failed(let b)): return a == b
            default: return false
            }
        }
    }

    /// The date the runner has actually asked to see. `viewingDate` when set,
    /// else whatever the current payload calls today — the same resolution
    /// `goTo`'s callers already use, named once so `readiness` cannot drift
    /// from it.
    private func wantedDate(given model: V5Today) -> String { viewingDate ?? todayISO(model) }

    /// STATEGATE-1's actual gate, pulled out of `body` so it is a plain
    /// function a test can call directly rather than a fact only provable by
    /// rendering. `pendingDate` is what distinguishes the two ways `model`
    /// can fail to match `wanted`: a fetch for it is still in flight (loading)
    /// versus one already ran and did not produce a match (failed) — see
    /// `goTo`, the only place that sets it.
    func readiness(model: V5Today?, wanted: String, pendingDate: String?) -> ContentReadiness {
        if let model, model.dateISO == wanted { return .match(model) }
        if pendingDate == wanted { return .loading(date: wanted) }
        return .failed(date: wanted)
    }

    /// A stable string discriminator for `.animation(value:)` — see the
    /// call site below. Nil-safe: before the first payload ever lands there
    /// is no `readiness` to compute, and that is `coldStart`'s territory,
    /// unaffected by this key changing.
    private var readinessKey: String {
        guard let model = surface.model else { return "none" }
        switch readiness(model: model, wanted: wantedDate(given: model), pendingDate: pendingDate) {
        case .match(let m): return "match:\(m.dateISO)"
        case .loading(let d): return "loading:\(d)"
        case .failed(let d): return "failed:\(d)"
        }
    }

    /// TODAYSHELL-1 (2026-09-04) · THE PERSISTENT SHELL, FOR REAL THIS TIME.
    ///
    /// David, P0, on build 254: "tapping a future day replaces the entire
    /// Today screen with a giant unexplained skeleton; the week strip
    /// disappears; the page changes into a different layout... I cannot
    /// tell whether a day, workout, week, or plan is loading; navigation
    /// feels coupled to network requests."
    ///
    /// The old `navigatingCard`/`navigatingHeader` this replaces built a
    /// SECOND, unrelated screen — its own header (no calendar button, no
    /// account button, no week line), and no `WeekStripV5` at all. Every
    /// `.loading`/`.failed` readiness therefore tore the whole panel down
    /// and rebuilt a different one, which is externally indistinguishable
    /// from "the app changed pages." `TodayHeaderStripV5` (ComponentsV5.swift)
    /// is the fix at the root: the SAME header+strip cluster `TodayBeforeV5`
    /// and `TodayAfterV5` draw for a MATCHED day is what this draws too, so
    /// the runner's finger never sees a different screen — only the content
    /// beneath the strip changes, exactly as 22b's cross-day rule already
    /// requires for a cached day (David, 2026-08-21: "Keep everything just
    /// change the info below the week strip").
    ///
    /// `weekStripDays(for:)` below is what makes this possible even when
    /// NOTHING has loaded for `date` yet: it degrades gracefully from an
    /// exact cached day, to the currently-loaded model (if its week still
    /// covers `date`), to a week computed by pure DATE ARITHMETIC — the
    /// same technique `WeekStripV5.neighbour(_:)` already uses for its own
    /// un-fetched neighbour pages — so the strip always has something
    /// honest to draw.
    @ViewBuilder
    private func pendingCard(for date: String, phase: PendingPhase) -> some View {
        let stripDays = weekStripDays(for: date)
        return ScrollView {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                DayPanel(fill: .quiet) {
                    TodayHeaderStripV5(
                        place: "Today",
                        viewingDayLabel: viewingDayLabel,
                        weekLine: weekLine(for: date),
                        weekStripDays: stripDays,
                        onBackToToday: { backToToday() },
                        // No calendar sheet here — this card has no full
                        // `V5Today` to build one from (that is what is
                        // still loading). The account sheet is hoisted onto
                        // `TodayHostV5` itself and works regardless.
                        onCalendar: nil,
                        initials: initials,
                        onAccount: { accountOpen = true },
                        onPickDay: { day in
                            if let iso = Self.isoDate(embeddedIn: day.id) ?? day.dateISO {
                                goTo(iso, todayISO: knownTodayISO ?? date)
                            }
                        },
                        onPageWeek: { await stepWeekFromWanted($0, wanted: date) },
                        canPageBackward: canPageWeek(-1, weekStart: stripDays.first?.dateISO, weekEnd: stripDays.last?.dateISO),
                        canPageForward: canPageWeek(1, weekStart: stripDays.first?.dateISO, weekEnd: stripDays.last?.dateISO)
                    )

                    switch phase {
                    case .loading(let summary):
                        pendingContentBody(for: date, summary: summary)
                    case .failed:
                        ErrorNote(
                            text: "Can't reach faff. \(Self.dayName(date)) did not load.",
                            onRetry: { retryPending(date) }
                        )
                    case .offlineNoCache:
                        ErrorNote(
                            text: "\(Self.dayName(date))’s workout isn’t available offline.",
                            onRetry: { retryPending(date) }
                        )
                    }
                }
            }
            .padding(.horizontal, V5.S.gutter)
            .padding(.bottom, V5.S.s24)
            .v5PageWidth()
        }
        .background(V5.surfacePage)
    }

    /// The content region alone — what changes while the header and strip
    /// stay put. A week-summary hit (from `weekCache`, a much cheaper read
    /// than the full day) renders the real type/dose/duration immediately,
    /// satisfying "if additional information is loading, render the
    /// available plan information immediately and quietly enrich it
    /// afterward"; with nothing cached at all, a single compact, labeled
    /// line — never the old 380pt anonymous rectangle.
    @ViewBuilder
    private func pendingContentBody(for date: String, summary: PlanDay?) -> some View {
        if let summary {
            VStack(alignment: .leading, spacing: V5.S.s2) {
                if let sub = summary.sub_label, !sub.isEmpty {
                    Text(sub)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textQuiet)
                }
                Text(summary.type.capitalized)
                    .faffDisplayV5(TypeScaleV5.display44)
                    .foregroundStyle(V5.textPrimary)
            }
            if summary.distance_mi > 0 {
                Text(Self.miles(summary.distance_mi))
                    .font(.faffText(28, weight: .semibold))
                    .foregroundStyle(V5.textPrimary)
            }
            HStack(spacing: V5.S.s8) {
                ProgressView().tint(V5.textQuiet).controlSize(.small)
                Text("Getting the full session…")
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
            }
            .padding(.top, V5.S.s8)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(summary.type), \(Self.miles(summary.distance_mi)). Getting the full session.")
        } else {
            HStack(spacing: V5.S.s8) {
                ProgressView().tint(V5.textQuiet)
                Text("Loading \(Self.dayName(date))’s workout…")
                    .font(.faffText(TypeScaleV5.body15))
                    .foregroundStyle(V5.textQuiet)
            }
            .padding(.vertical, V5.S.s16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
    }

    private enum PendingPhase {
        case loading(summary: PlanDay?)
        case failed
        case offlineNoCache
    }

    private static func miles(_ mi: Double) -> String {
        let whole = mi.truncatingRemainder(dividingBy: 1) == 0
        return String(format: whole ? "%.0f mi" : "%.1f mi", mi)
    }

    /// Re-run the fetch for a pending date, whether it is currently
    /// `.failed` or `.offlineNoCache` — both retry the same way. Not a
    /// blanket `surface.load()` (that only ever re-reads `viewingDate`);
    /// this re-enters `goTo` so a retry on a date the runner has since
    /// swiped past does not silently override a newer selection.
    private func retryPending(_ date: String) {
        // PLANSNAPSHOT-1 · an explicit Retry is one of the named triggers
        // for a fresh whole-block sync — not awaited here so the per-date
        // retry below (the existing pending-card contract) is not held up
        // by it; if the snapshot sync lands first, `date` may resolve
        // straight from it without `goTo` needing its own fetch at all.
        Task { await syncPlanSnapshot() }
        goTo(date, todayISO: knownTodayISO ?? date)
    }

    /// The best available week-strip data for `date` — exact cached day,
    /// else the loaded model if its own week still covers `date`, else a
    /// week computed by pure date arithmetic. See `pendingCard`'s own doc
    /// comment for why this exists.
    /// The plate marks `date` — the day the runner is WAITING on, not
    /// whichever the last-loaded `model` happens to say is its own today —
    /// same reasoning as `TodayBeforeV5.stripDays()`'s own `selectedDateISO`
    /// remap: the pill moves the instant the tap registers, never after a
    /// round trip.
    private func weekStripDays(for date: String) -> [WeekStripDayV5] {
        func selected(_ days: [WeekStripDayV5]) -> [WeekStripDayV5] {
            days.map { var d = $0; d.isToday = d.dateISO == date; return d }
        }
        if let exact = dayCache[date] {
            return selected(exact.weekStrip.map { $0.strip })
        }
        if let current = surface.model,
           let first = current.weekStrip.first?.dateISO,
           let last = current.weekStrip.last?.dateISO,
           (first...last).contains(date) {
            return selected(current.weekStrip.map { $0.strip })
        }
        guard let reference = surface.model?.weekStrip, reference.count == 7,
              let refFirstISO = reference.first?.dateISO,
              let refFirstDate = Self.iso.date(from: refFirstISO),
              let wantedDate = Self.iso.date(from: date) else { return [] }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let refWeekday = cal.component(.weekday, from: refFirstDate)
        var start = wantedDate
        var guardCount = 0
        while cal.component(.weekday, from: start) != refWeekday, guardCount < 7 {
            start = cal.date(byAdding: .day, value: -1, to: start) ?? start
            guardCount += 1
        }
        return selected((0..<7).compactMap { (offset: Int) -> WeekStripDayV5? in
            guard let d = cal.date(byAdding: .day, value: offset, to: start) else { return nil }
            let iso = Self.iso.string(from: d)
            let refDay = reference[offset].strip
            return WeekStripDayV5(id: "ghost:\(iso)", dateISO: iso,
                                   letter: refDay.letter, weekday: refDay.weekday,
                                   number: String(cal.component(.day, from: d)),
                                   state: .rest, isToday: false, isDone: false, isRest: true)
        })
    }

    private func weekLine(for date: String) -> String? {
        if let exact = dayCache[date] { return exact.panel.weekLine }
        if let current = surface.model,
           let first = current.weekStrip.first?.dateISO,
           let last = current.weekStrip.last?.dateISO,
           (first...last).contains(date) {
            return current.panel.weekLine
        }
        return nil
    }

    /// `WeekStripV5`'s own paging, generalized off an arbitrary `wanted`
    /// date rather than always `viewingDate ?? model.dateISO` — the pending
    /// card has no `model` for `wanted` to read that from.
    private func stepWeekFromWanted(_ weeks: Int, wanted: String) async {
        guard let d = Self.iso.date(from: wanted),
              let next = Calendar.current.date(byAdding: .day, value: weeks * 7, to: d) else { return }
        goTo(Self.iso.string(from: next), todayISO: knownTodayISO ?? wanted)
        await navigationTask?.value
    }

    var body: some View {
        Group {
            // PLANSNAPSHOT-1 · a browsed (non-today) date the local snapshot
            // covers renders ENTIRELY from it — checked FIRST, ahead of
            // every network-driven branch below, so it can never wait on
            // `surface.model`. `goTo`'s own snapshot short-circuit (see its
            // header comment) is what guarantees `viewingDate` is set here
            // with no fetch ever having started for it.
            //
            // Wrapped in the SAME shared shell every other Today state
            // uses (`inSharedShell`, SHELLBYPASS-1) — header, week strip
            // and account button stay mounted exactly as they do for
            // every other branch this switch draws.
            if let viewingDate, let snapshotDay = PlanSnapshotStore.shared.current?.day(on: viewingDate),
               let shellModel = surface.model {
                // `shellModel` supplies the shell's chrome ONLY (header text,
                // week-strip rotation via `stripDays(for:)`'s own snapshot
                // branch above, account initials) — never this date's
                // content, which is `snapshotDay` alone. `shellModel` is
                // whatever Today's own cache last held (seeded from disk at
                // cold launch, refreshed at launch/foreground) and is not
                // re-fetched for this date.
                inSharedShell(shellModel) {
                    PlanSnapshotDayView(day: snapshotDay)
                }
                .id(snapshotDay.date_iso)
                .transition(.todayPanel(sign: navDirection))
            } else if let model = surface.model {
                let wanted = wantedDate(given: model)
                switch readiness(model: model, wanted: wanted, pendingDate: pendingDate) {
                case .match(let matched):
                    // Keyed on the day, so stepping between days crossfades
                    // instead of snapping.
                    content(matched)
                        .id(matched.dateISO)
                        // PANELMOTION-1 · `navDirection` is set synchronously
                        // in `goTo`, so it always reflects the navigation
                        // that produced THIS transition, never a later one —
                        // there is no in-flight window where it could be
                        // stale, because `.id` changing and `navDirection`
                        // changing happen in the same `goTo` call.
                        .transition(.todayPanel(sign: navDirection))
                        // Deliberately NOT a second "‹ Today" chip here.
                        // `PlaceHeaderV5` already draws one, inside the panel,
                        // the moment `viewingDayLabel` is non-nil — right at
                        // the top of the scroll, not scrolled away. A pinned
                        // duplicate sat above it and both were visible at
                        // once, which is exactly the "no content printed
                        // twice on one screen" rule this file elsewhere
                        // enforces on everyone else.
                        .safeAreaInset(edge: .top, spacing: 0) {
                            // OFFLINE MUST NOT LOOK LIKE ONLINE. See
                            // StaleStateV5.swift. This is the ONLY banner
                            // reachable from the matched branch, and it names
                            // exactly one fact — connectivity — because a day
                            // mismatch can no longer coexist with rendered
                            // content at all; it is a different `readiness`
                            // case, rendered as a different screen, never
                            // stacked as a second card beside this one.
                            if surface.stale {
                                StaleBannerV5(cachedAt: surface.cachedAt,
                                              onRetry: { Task { await surface.load() } })
                                    .padding(.horizontal, V5.S.gutter)
                                    .padding(.bottom, V5.S.s12)
                                    .background(V5.surfacePage)
                                    .transition(.opacity)
                            }
                        }
                        .animation(V5.Motion.fill, value: surface.stale)
                case .loading(let date):
                    pendingCard(for: date, phase: .loading(summary: weekSummary(for: date)))
                case .failed(let date):
                    // isOffline is a best-effort local signal (see its own
                    // doc comment) — genuine loss vs. any other failure
                    // changes the copy, never the mechanism: both retry
                    // through the exact same `retryPending`.
                    if isOffline && dayCache[date] == nil {
                        pendingCard(for: date, phase: .offlineNoCache)
                    } else {
                        pendingCard(for: date, phase: .failed)
                    }
                }
            } else if let viewingDate {
                // SHELLBYPASS-1 (2026-09-04) · `surface.model` is nil, but the
                // runner is mid-navigation to a date that is NOT their real
                // today — never route that through `wayOutHeader` below.
                //
                // David, physical device, after TODAYSHELL-1 shipped: "the
                // normal top controls disappear on future dates... a
                // different, stripped-down UPCOMING shell." `wayOutHeader`'s
                // own doc comment says exactly why it looks like that:
                // "Deliberately plain: no gradient panel, no week strip, no
                // big headline." Correct for the ONE case it was built for —
                // "today itself" has genuinely nothing (off-season, no plan
                // at all) — and silently wrong for a navigated-to date,
                // because `surface.absentReason`/`surface.isOutage` are
                // fields on the SAME surface `goTo` fetches arbitrary dates
                // through, so a `.absent` or outright-failed response for
                // Sept 25 lands here exactly as if TODAY itself had nothing,
                // and this branch used to trust that unconditionally.
                //
                // Route it through the SAME shared shell every other
                // pending/failed state already uses instead: an engine
                // refusal (`absentReason`) reads as unavailable-for-this-
                // date, same copy and same Retry as any other fetch that
                // came back with nothing to show; a genuine outage
                // (`isOutage`) reads as offline-or-unreachable. Neither is
                // reachable when `surface.model` is non-nil (the `if let
                // model` branch above already owns that case via
                // `readiness()`), so this can only fire for a date whose
                // fetch produced nothing at all to paint.
                if isOffline && dayCache[viewingDate] == nil {
                    pendingCard(for: viewingDate, phase: .offlineNoCache)
                } else {
                    pendingCard(for: viewingDate, phase: .failed)
                }
            } else if let reason = surface.absentReason {
                // The engine answered and the answer is that this does
                // not apply, for the runner's OWN today — `viewingDate` is
                // nil here, so this is never reached for a navigated date.
                // Silence, never ErrorNote: nothing failed.
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
                // Nothing cached and the read failed, for today itself
                // (again, `viewingDate == nil` here). The design's own
                // outage screen needs a Today shell to sit in, and we do not
                // have one, so this is the honest floor: the note and the
                // reserved space.
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
        // A crossfade for every readiness transition, not just a matched
        // day changing — moving into or out of a loading/failed card is a
        // real change too, and this file's own brief is explicit that
        // header, strip and card must never pop.
        .animation(V5.Motion.fill, value: readinessKey)
        // TAPPING "TODAY" WHEN YOU ARE ALREADY ON TODAY MEANS "TAKE ME HOME".
        //
        // The shell empties this tab's navigation path itself. It cannot undo
        // `viewingDate`, because stepping onto another day pushes nothing — so
        // without this the tab stayed on a past Tuesday through four tab
        // switches and twelve minutes.
        //
        // Guarded on the tab, so a re-tap of Block or Races never moves Today.
        .onReceive(NotificationCenter.default.publisher(for: .faffTabReselected)) { note in
            guard note.object as? FaffTabV5 == .today else { return }
            guard viewingDate != nil else { return }
            withAnimation(V5.Motion.fill) { backToToday() }
        }
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
                                    handleAccountRowTap(row.action)
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
            // TODAYPERSIST-1 · disk-only, synchronous, before the first
            // `await` — `surface.model` is already the disk-cached "today"
            // by this point (seeded at `V5Surface.init`), so this can
            // restore the runner's other recently-visited days and weeks
            // in the same tick, before the network is ever asked.
            // PLANSNAPSHOT-1 · synchronous, disk-only, same "before the
            // first await" contract `seedCachesFromDisk()` already keeps —
            // so a cold launch can paint a browsed date from local storage
            // in the very first frame, offline or not.
            PlanSnapshotStore.shared.loadFromDiskSynchronously()
            seedCachesFromDisk()
            await surface.load()
            NotificationCenter.default.post(name: .faffSurfaceReady, object: "today")
            // Not awaited: the launch gate above is keyed to `surface.load()`
            // landing, not to the (much larger) whole-block sync. The first
            // frame paints from whatever `loadFromDiskSynchronously()` just
            // restored; this fills in a fresher snapshot behind it exactly
            // as `WEEKCACHE-1`'s prefetch does for the week strip.
            Task { await syncPlanSnapshot() }
            // The FIRST tap a runner makes is overwhelmingly a neighbour of
            // today — yesterday, tomorrow. `goTo` prefetches around wherever
            // it lands, but that is by definition one step too late for the
            // very first navigation of the session. Priming today's own
            // neighbours here means that first tap gets the instant path
            // too, not just the second one onward.
            if let m = surface.model {
                await prefetchAround(m.dateISO)
                await fetchAndCacheWeek(anchoredOn: m.dateISO)
            }
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
            if let m = surface.model {
                dayCache[m.dateISO] = m
                reconcileDayCache(against: m)
                // Any payload landing is proof the network is reachable
                // right now, whatever caused an earlier failure.
                isOffline = false
            }
        }
        // WEEKCACHE-1 · best-effort transport-level signal — see
        // `isOffline`'s own doc comment for exactly what this can and
        // cannot promise.
        .onReceive(NotificationCenter.default.publisher(for: .faffReachabilityLost)) { _ in
            isOffline = true
        }
        // PLANSNAPSHOT-1 · a plan mutation (reschedule apply/undo — see
        // `RescheduleV5.swift`) is a named sync trigger.
        .onReceive(NotificationCenter.default.publisher(for: .faffPlanMutated)) { _ in
            Task { await syncPlanSnapshot() }
        }
        .refreshable { await surface.load(); await syncPlanSnapshot() }
        .v5ReloadOnForeground { await surface.load(); await syncPlanSnapshot() }
    }

    /// SHAREDSHELL-1 (2026-09-04) · the ROOT CAUSE closure for the physical-
    /// device P0: TODAYSHELL-1 (build 255) shared the header+strip cluster
    /// for the `.loading`/`.failed`/matched-content path `readiness()`
    /// governs — but `content(_:)`'s own switch on `model.state`, one level
    /// deeper, has FIVE branches (`notOnPhoneYet`, `injuryFlare`, `sick`,
    /// `weekOff`, `offSeason`) that predate TODAYSHELL-1 and never went
    /// through it: `NotOnPhoneYetV5`, `InjuryFlareV5`, `SickFlareV5`,
    /// `WeekOffV5`, `OffSeasonV5` each drew their OWN header (`PlaceHeaderRow`
    /// or equivalent — no week strip, no calendar button, no back-to-today).
    /// `model.state` is a property of the requested DATE, not of the app, so
    /// navigating to ANY date whose state happened to be one of these five —
    /// most commonly `weekOff`, which `lib/faff/v5-today.ts` returns for
    /// "Away from the plan," i.e. any date outside the current training
    /// window — dropped the runner onto a completely different, stripped
    /// screen. David, physical device, TestFlight 259: "the normal top
    /// controls disappear on future dates... a different, stripped-down
    /// UPCOMING shell." Exactly that shape, on exactly that trigger — and
    /// invisible to every round of simulator testing so far, because the
    /// synthetic test data used for those checks never happened to place a
    /// week-off/injury/sick/off-season day inside the navigated range.
    ///
    /// The fix: draw `TodayHeaderStripV5` here, ONCE, for every one of the
    /// seven `model.state` cases — not just the two (`beforeRun`/`raceDay`,
    /// `afterRun`) that already had it — and pass `suppressOwnHeader: true`
    /// to the five screens that used to draw their own. `TodayBeforeV5`/
    /// `TodayAfterV5` keep drawing their own header internally (unchanged);
    /// wrapping them here too would be the double-header Rule 17 already
    /// forbids elsewhere in this file, so those two cases are deliberately
    /// left alone below.
    @ViewBuilder
    private func inSharedShell<Content: View>(_ model: V5Today, @ViewBuilder content: () -> Content) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                DayPanel(fill: .quiet) {
                    TodayHeaderStripV5(
                        place: model.panel.place,
                        viewingDayLabel: viewingDayLabel,
                        weekLine: model.panel.weekLine,
                        weekStripDays: stripDays(for: model),
                        onBackToToday: { backToToday() },
                        onCalendar: nil,
                        initials: initials,
                        onAccount: { accountOpen = true },
                        onPickDay: { day in pickDay(day.id, in: model) },
                        onPageWeek: { await stepWeekAndWait($0 * 7, from: model) },
                        canPageBackward: canPageWeek(-1, weekStart: model.weekStrip.first?.dateISO, weekEnd: model.weekStrip.last?.dateISO),
                        canPageForward: canPageWeek(1, weekStart: model.weekStrip.first?.dateISO, weekEnd: model.weekStrip.last?.dateISO)
                    )
                }
                content()
            }
            .padding(.horizontal, V5.S.gutter)
            .padding(.bottom, V5.S.s24)
            .v5PageWidth()
        }
        .background(V5.surfacePage)
    }

    /// The pill's position, remapped exactly like `TodayBeforeV5.stripDays()`
    /// — `viewingDate` (this file's own single source of truth for "which
    /// day is selected," the same value that drives the header's tense)
    /// rather than the server's own `isToday`, so the pill follows the
    /// runner's selection instantly rather than waiting on a round trip.
    private func stripDays(for model: V5Today) -> [WeekStripDayV5] {
        let selected = viewingDate ?? model.dateISO
        // PLANSNAPSHOT-1 · `model.weekStrip` is whichever week `model` was
        // itself fetched for — with per-date network fetches gone for any
        // snapshot-covered date, `model` usually still holds TODAY's own
        // week even while `viewingDate` points somewhere else entirely. If
        // `selected` falls outside `model`'s own week, rebuild the strip
        // from the LOCAL snapshot instead of drawing the wrong week's pills.
        let modelWeekISOs = Set(model.weekStrip.compactMap { $0.dateISO as String? })
        if !modelWeekISOs.contains(selected), let snapshotWeek = snapshotWeekStripDays(selected: selected, alignedTo: model) {
            return snapshotWeek
        }
        return model.weekStrip.map { d in
            var s = d.strip
            s.isToday = d.dateISO == selected
            return s
        }
    }

    /// Rebuilds a week strip for `selected` entirely from the local
    /// `PlanSnapshot` — no fetch. Reuses the SAME "shift a known week by
    /// whole weeks" trick `WeekStripV5.neighbour(_:)` already uses for an
    /// unread ghost week, except every resulting date is looked up in the
    /// snapshot for REAL type/completion data instead of staying a ghost.
    /// `alignedTo` only supplies the day-of-week ROTATION (which weekday the
    /// runner's week starts on) — never date content — by borrowing it from
    /// whatever week `model` last actually held.
    private func snapshotWeekStripDays(selected: String, alignedTo model: V5Today) -> [WeekStripDayV5]? {
        guard let store = PlanSnapshotStore.shared.current,
              let firstISO = model.weekStrip.first?.dateISO,
              let firstDate = Self.iso.date(from: firstISO),
              let selectedDate = Self.iso.date(from: selected)
        else { return nil }
        let daysDiff = Calendar.current.dateComponents([.day], from: firstDate, to: selectedDate).day ?? 0
        let weeksOffset = Int(floor(Double(daysDiff) / 7.0))
        return model.weekStrip.map { d in
            guard let base = Self.iso.date(from: d.dateISO),
                  let moved = Calendar.current.date(byAdding: .day, value: weeksOffset * 7, to: base)
            else { return d.strip }
            let movedISO = Self.iso.string(from: moved)
            let number = String(Calendar.current.component(.day, from: moved))
            if let day = store.day(on: movedISO) {
                return WeekStripDayV5(id: day.plan_workout_id ?? "date:\(movedISO)", dateISO: movedISO,
                                       letter: d.letter, weekday: d.strip.weekday, number: number,
                                       state: Self.dayState(for: day), isToday: movedISO == selected,
                                       isDone: day.matched_run != nil, isRest: day.is_rest)
            }
            // Outside the authored block (or no snapshot has ever synced far
            // enough) — an honest ghost, same as `neighbour(_:)` draws for
            // any week nothing is known about yet.
            return WeekStripDayV5(id: "date:\(movedISO)", dateISO: movedISO, letter: d.letter, weekday: d.strip.weekday,
                                   number: number, state: .rest, isToday: movedISO == selected,
                                   isDone: false, isRest: true)
        }
    }

    private static func dayState(for day: PlanSnapshotDay) -> V5.DayState {
        if day.is_race { return .race }
        if day.is_rest { return .rest }
        if day.is_long { return .long }
        if day.is_quality { return .quality }
        return .easy
    }

    @ViewBuilder
    private func content(_ model: V5Today) -> some View {
        switch model.state {
        case .notOnPhoneYet:
            inSharedShell(model) {
                NotOnPhoneYetV5(reason: model.notOnPhoneYet, onOpenAccount: { accountOpen = true },
                                suppressOwnHeader: true)
            }

        case .injuryFlare:
            if let injury = model.injury {
                inSharedShell(model) {
                    InjuryFlareV5(model: injury,
                                  onOpenAccount: { accountOpen = true },
                                  onCheckIn: { row in Task { await checkInNiggle(row.id) } },
                                  onReturnToRunning: { path.append(.returnToRunning) },
                                  suppressOwnHeader: true)
                }
            } else {
                TodayBeforeLiveV5(model: model, accountName: accountName,
                              accountWeekLine: model.panel.weekLine ?? "",
                              accountRows: [], fallbackCalendarWeeks: calendarWeeks(model))
            }

        case .sick:
            if let sick = model.sick {
                inSharedShell(model) {
                    SickFlareV5(model: sick,
                                onOpenAccount: { accountOpen = true },
                                onLogTrend: { row in Task { await logSickTrend(row.action) } },
                                suppressOwnHeader: true)
                }
            } else {
                TodayBeforeLiveV5(model: model, accountName: accountName,
                                  accountWeekLine: model.panel.weekLine ?? "",
                                  accountRows: [], fallbackCalendarWeeks: calendarWeeks(model))
            }

        case .weekOff:
            if let off = model.weekOff {
                inSharedShell(model) {
                    WeekOffV5(model: off, onOpenAccount: { accountOpen = true }, suppressOwnHeader: true)
                }
            } else {
                TodayBeforeLiveV5(model: model, accountName: accountName,
                              accountWeekLine: model.panel.weekLine ?? "",
                              accountRows: [], fallbackCalendarWeeks: calendarWeeks(model))
            }

        case .offSeason:
            if let off = model.offSeason {
                inSharedShell(model) {
                    OffSeasonV5(model: off, onOpenAccount: { accountOpen = true }, suppressOwnHeader: true)
                }
            } else {
                inSharedShell(model) {
                    NotOnPhoneYetV5(reason: nil, onOpenAccount: { accountOpen = true }, suppressOwnHeader: true)
                }
            }

        case .afterRun:
            TodayAfterV5(model: model,
                         onOpenAccount: { accountOpen = true },
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
                         onPageWeek: { await stepWeekAndWait($0 * 7, from: model) },
                         canPageBackward: canPageWeek(-1, weekStart: model.weekStrip.first?.dateISO, weekEnd: model.weekStrip.last?.dateISO),
                         canPageForward: canPageWeek(1, weekStart: model.weekStrip.first?.dateISO, weekEnd: model.weekStrip.last?.dateISO),
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
                          onAccountRowTap: { row in handleAccountRowTap(row.action) },
                          onPickDay: { id in pickDay(id, in: model) },
                          viewingDayLabel: viewingDayLabel,
                          selectedDateISO: viewingDate,
                          onBackToToday: { backToToday() },
                          onPageWeek: { await stepWeekAndWait($0 * 7, from: model) },
                          canPageBackward: canPageWeek(-1, weekStart: model.weekStrip.first?.dateISO, weekEnd: model.weekStrip.last?.dateISO),
                          canPageForward: canPageWeek(1, weekStart: model.weekStrip.first?.dateISO, weekEnd: model.weekStrip.last?.dateISO),
                          onOpenPacesMoved: { path.append(.pacesMoved) },
                          onOpenRace: { slug in path.append(.raceDetail(slug: slug)) },
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

    /// REQCOORD-1 · every prefetch this host fires goes through this one
    /// bounded, deduplicating coordinator — see its own doc comment.
    @State private var fetchCoordinator = DayFetchCoordinator()

    /// STATEGATE-1 · the date a real fetch is currently in flight for, or
    /// nil. This is what tells `readiness` (below) apart "still loading the
    /// date the runner asked for" from "already failed to load it" — the two
    /// facts a governing invariant this file did not used to distinguish
    /// collapsed into "whatever `model` happens to hold," which is exactly
    /// how a date mismatch used to render as if it belonged to the selection.
    /// Set the instant a real (non-cache-hit) `goTo` starts; cleared only by
    /// the specific task that set it, and only if nothing newer has already
    /// moved past it — see `goTo`.
    @State private var pendingDate: String?

    /// Days decoded this session, keyed by ISO date. Populated passively (see
    /// the `.onChange` below) and read by `goTo` alone — nothing else derives
    /// truth from it, so a stale or missing entry can only ever cost a round
    /// trip, never show the wrong day.
    // Not `private` — same reason as `readiness` below: PLANVERSION-1's own
    // regression test constructs a host and asserts on this directly rather
    // than driving it through a live view render.
    @State var dayCache: [String: V5Today] = [:]

    /// PLANVERSION-1 · the last `planVersion` this session has actually
    /// seen. Nil until the first payload that carries one lands — an older
    /// server, or the very first fetch of a session, is not "a version
    /// change" and must not wipe a cache that was never populated under a
    /// different plan in the first place.
    @State var lastKnownPlanVersion: String?

    /// WEEKCACHE-1 (2026-09-04) · `GET /api/plan/week` for the visible week
    /// plus its immediate neighbours, keyed by `week_start_iso`. Far
    /// cheaper than a full day and — per `loadPlanWeek`'s own doc comment —
    /// already the SAME loader `/api/v5/today`'s own `weekStrip` calls
    /// internally, so this is not a new server-side cost, only a new
    /// client-side use of an existing one. What lets a date with no full
    /// detail yet still show its real type/dose immediately: "if
    /// additional information is loading, render the available plan
    /// information immediately and quietly enrich it afterward."
    @State private var weekCache: [String: PlanWeek] = [:]
    /// Anchor dates currently being fetched — a week is not known by its
    /// OWN start date until the response names it, so dedup keys on
    /// whatever date was actually requested, not on a week_start_iso this
    /// call cannot yet know.
    @State private var weekFetchInFlight: Set<String> = []

    /// BOUNDARY-1 (2026-09-04) · the plan's own first/last authored day —
    /// see `PlanWeek.plan_start_iso`'s doc comment. Set from whichever
    /// `PlanWeek` last landed, network or disk; every week of the same
    /// plan carries the same two values, so overwriting on each arrival is
    /// self-correcting rather than something that needs its own
    /// invalidation path tied to `lastKnownPlanVersion`.
    @State private var planStartISO: String?
    @State private var planEndISO: String?

    /// Whether paging one week further in `direction` (-1 back, +1
    /// forward) from the week spanning `weekStart...weekEnd` leads
    /// somewhere the plan actually has. `true` when the boundary is
    /// unknown (either plan bound absent, or either week bound absent) —
    /// see `WeekStripV5.canPageBackward`'s own doc comment for why "don't
    /// clamp" is the correct default rather than "clamp everything until
    /// proven otherwise."
    ///
    /// A free function of its four inputs, not an instance method reading
    /// `@State` directly — `TodayNavigationTests` already establishes the
    /// pattern of testing this file's decision logic directly rather than
    /// through a rendered view, and a pure function is what that pattern
    /// needs. ISO `yyyy-MM-dd` strings compare correctly with plain `<`/`>`
    /// — lexicographic order equals chronological order for that format,
    /// the same fact `navDirection`'s own computation in `goTo` already
    /// relies on — so this needs no `Date` parsing to get a month or year
    /// boundary right.
    static func canPageWeek(_ direction: Int, planStart: String?, planEnd: String?,
                             weekStart: String?, weekEnd: String?) -> Bool {
        guard let planStart, let planEnd, let weekStart, let weekEnd else { return true }
        return direction < 0 ? weekStart > planStart : weekEnd < planEnd
    }

    private func canPageWeek(_ direction: Int, weekStart: String?, weekEnd: String?) -> Bool {
        Self.canPageWeek(direction, planStart: planStartISO, planEnd: planEndISO,
                          weekStart: weekStart, weekEnd: weekEnd)
    }

    /// Best-effort, local-only connectivity signal. Set the instant a
    /// request fails at the TRANSPORT level (`API.authedSend`'s own catch
    /// posts `.faffReachabilityLost` before any HTTP status exists to
    /// read) and cleared the moment any fetch actually lands — never
    /// authoritative, only enough to choose between "can't reach faff"
    /// (a real, worth-retrying error) and "isn't available offline" (a
    /// state the runner should read as expected, not alarming) on the
    /// pending card's failed phase.
    @State private var isOffline = false

    /// PANELMOTION-1 (2026-09-04) · which way the runner just navigated, so
    /// the workout panel can slide in the SAME direction as the date moved
    /// instead of only crossfading. +1 = a later date (content slides in
    /// from the trailing edge, old content exits leading), -1 = earlier
    /// (reversed), 0 = no directional read yet (first render). Set
    /// synchronously in `goTo`, where both the old and new date are known —
    /// never derived inside `body`, so it never fights the transition it
    /// drives. String comparison is safe and correct here because every
    /// date on screen is `yyyy-MM-dd`, which sorts lexicographically exactly
    /// like it sorts chronologically.
    @State private var navDirection: Int = 0

    /// One week summary for `date`, if a cached week covers it. Cheaper
    /// than the full day and, per `pendingCard`'s own doc comment, what
    /// lets a still-loading date show its real type/dose instead of a bare
    /// "Loading…" label.
    private func weekSummary(for date: String) -> PlanDay? {
        for week in weekCache.values {
            if let day = week.days.first(where: { $0.date_iso == date }) { return day }
        }
        return nil
    }

    /// Fetch and cache the week containing `date`, deduped by the anchor
    /// date actually requested. PLANVERSION-1 applies here too: a plan
    /// re-anchor that changes `planVersion` invalidates cached week
    /// summaries the same way it invalidates cached full days, so a
    /// provisional dose from before a re-anchor can never survive to be
    /// shown as if it were still current.
    private func fetchAndCacheWeek(anchoredOn date: String) async {
        if weekCache.values.contains(where: { w in
            guard let s = w.week_start_iso, let e = w.week_end_iso else { return false }
            return (s...e).contains(date)
        }) { return }
        guard !weekFetchInFlight.contains(date) else { return }
        weekFetchInFlight.insert(date)
        defer { weekFetchInFlight.remove(date) }
        guard let week = try? await API.fetchPlanWeek(date: date), let start = week.week_start_iso else { return }
        if let known = lastKnownPlanVersion, let fresh = week.plan_version, known != fresh {
            weekCache.removeAll()
        }
        weekCache[start] = week
        // BOUNDARY-1 · every week of the same plan carries the same two
        // values, so the last one to land wins and that's fine.
        if let s = week.plan_start_iso { planStartISO = s }
        if let e = week.plan_end_iso { planEndISO = e }
    }

    /// A day cached under a plan the runner no longer has must never be
    /// handed back as though it still applied.
    ///
    /// TWO SIGNALS, IN ORDER OF STRENGTH.
    ///
    /// **Primary — `planVersion`.** It is a WHOLE-PLAN identity
    /// (`${training_plans.id}:${last_adapted_at}`, see `V5Today.planVersion`'s
    /// doc comment), not a per-day one, so the correct response to it
    /// changing is not a per-day diff — it is "every cached day was fetched
    /// under a plan that is no longer the active one," and the whole
    /// `dayCache` is dropped. This is what closes the gap the per-day diff
    /// below cannot: an in-place pace re-anchor rewrites `plan_workouts`
    /// under the SAME `plan_workout_id` on every affected day, so a
    /// row-by-row id diff sees nothing to invalidate even though every
    /// cached day's paces just moved. `last_adapted_at` is the half of
    /// `planVersion` that catches exactly this.
    ///
    /// **Fallback — `plan_workout_id`.** For a server too old to send
    /// `planVersion` at all (nil), or as a second check even when it is
    /// present: any cached day whose stored row id no longer matches what
    /// the plan currently says for that date is describing a workout that
    /// no longer exists, and is dropped individually rather than served.
    ///
    /// Called wherever a fresh payload actually lands — the base Today read
    /// and every prefetch — so a rebuild or re-anchor is caught the moment
    /// its evidence is in hand, not only when the runner happens to revisit
    /// the affected date. Only ever prunes `dayCache`, the same
    /// non-authoritative read `goTo` already treats as "a lookup, never a
    /// mutation" — never touches `surface.model`. A dropped entry costs the
    /// next visit to that date one round trip; keeping a wrong one costs
    /// the runner a workout, a pace, or a completion state that was never
    /// true under the plan now active.
    func reconcileDayCache(against fresh: V5Today) {
        let result = Self.reconciledDayCache(dayCache, lastKnownPlanVersion: lastKnownPlanVersion, against: fresh)
        dayCache = result.cache
        lastKnownPlanVersion = result.lastKnownPlanVersion
    }

    /// The actual decision behind `reconcileDayCache`, factored out as a pure
    /// function — same reason `readiness(model:wanted:pendingDate:)` above
    /// takes its inputs as parameters rather than reading `@State` directly:
    /// `@State` mutated through a bare, unrendered `TodayHostV5` does not
    /// reliably persist across statements outside a live SwiftUI view
    /// hierarchy, so PLANVERSION-1's own regression tests call this, never
    /// the `@State`-touching wrapper above.
    static func reconciledDayCache(
        _ cache: [String: V5Today],
        lastKnownPlanVersion: String?,
        against fresh: V5Today
    ) -> (cache: [String: V5Today], lastKnownPlanVersion: String?) {
        var cache = cache
        var lastKnownPlanVersion = lastKnownPlanVersion
        if let freshVersion = fresh.planVersion {
            if let known = lastKnownPlanVersion, known != freshVersion {
                cache.removeAll()
            }
            lastKnownPlanVersion = freshVersion
        }
        for freshDay in fresh.weekStrip {
            guard let cachedPayload = cache[freshDay.dateISO] else { continue }
            let cachedOwnID = cachedPayload.weekStrip.first(where: { $0.dateISO == freshDay.dateISO })?.id
            guard let cachedOwnID, cachedOwnID != freshDay.id else { continue }
            cache.removeValue(forKey: freshDay.dateISO)
        }
        return (cache, lastKnownPlanVersion)
    }

    /// The strip hands back a plan row's server id; the date lives beside it
    /// on the same row. Identity is the id, the date is a lookup — never the
    /// other way round.
    private func pickDay(_ id: String, in model: V5Today) {
        guard let iso = Self.dateISO(forRowID: id, in: model) else { return }
        goTo(iso, todayISO: todayISO(model))
    }

    /// A row id to the day it stands for.
    ///
    /// THE WEEK STRIP IS NOT THE ONLY THING THAT HANDS US AN ID.
    ///
    /// This used to be `weekStrip.first(where: { $0.id == id })` and nothing
    /// else, which is correct for the strip — seven days, all present — and
    /// silently wrong for the CALENDAR, which lists the whole block. Any row
    /// outside the current week resolved to nothing and the tap did nothing,
    /// with no way for the runner to tell a day that could not open from a day
    /// that would not.
    ///
    /// That mattered the moment future days became tappable (they were dead
    /// rows before, so the gap could not show). Both id shapes the server
    /// emits carry the date in them — `date:2026-09-05` and `pw-2026-09-04` —
    /// so the strip stays the authority where it has an answer, and the id
    /// itself answers where it does not. Identity is still the id; the date is
    /// still a lookup, never the other way round.
    static func dateISO(forRowID id: String, in model: V5Today) -> String? {
        if let day = model.weekStrip.first(where: { $0.id == id }) { return day.dateISO }
        return isoDate(embeddedIn: id)
    }

    /// The first `yyyy-MM-dd` inside a string, validated by actually parsing
    /// it — so `pw-2026-13-45` is rejected rather than passed to the server as
    /// a date that does not exist.
    static func isoDate(embeddedIn s: String) -> String? {
        let chars = Array(s)
        guard chars.count >= 10 else { return nil }
        for start in 0...(chars.count - 10) {
            let candidate = String(chars[start..<(start + 10)])
            if Self.iso.date(from: candidate) != nil { return candidate }
        }
        return nil
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

    /// WKSTRIP-RACE-1 (2026-09-03) · `step`, but the caller waits for the
    /// destination day to actually be the one `surface.model` reflects. The
    /// week strip's own recentre awaits this — see ChartsV5.swift — instead
    /// of firing on a fixed clock and racing whichever of `V5Surface.present`
    /// (near-instant, a prefetched week) or `V5Surface.rebind` (a real round
    /// trip) `goTo` happens to take.
    ///
    /// Reuses `step`/`goTo` verbatim rather than re-deriving the date
    /// arithmetic or the same-day no-op guard — this only adds the await.
    /// `navigationTask` is read AFTER `step` returns, synchronously, so it is
    /// always the specific task `step`'s own `goTo` call just assigned, never
    /// a later one from an overlapping navigation — the same "single flight,
    /// cancelled and replaced" task `goTo` already guarantees for every other
    /// caller is what this awaits, unchanged.
    private func stepWeekAndWait(_ days: Int, from model: V5Today) async {
        step(days, from: model)
        await navigationTask?.value
    }

    /// The one way onto another day. Everything above funnels here so the
    /// header, the strip and the fetch can never disagree about which day
    /// the screen is on.
    /// +1 when `to` is later than `from`, -1 when earlier. `yyyy-MM-dd`
    /// strings compare correctly with plain `>`, including across a month
    /// or year boundary ("2026-08-31" < "2026-09-01" < ... < "2027-01-01"
    /// all hold as plain string comparisons) — extracted so PANELMOTION-1's
    /// direction call is testable on its own rather than only observable
    /// through which way a rendered panel slides.
    static func navigationSign(from: String, to: String) -> Int {
        to > from ? 1 : -1
    }

    private func goTo(_ iso: String, todayISO today: String) {
        let from = viewingDate ?? today
        guard iso != from else { return }

        // PANELMOTION-1 · the only place both the old and new date are known
        // synchronously, before anything async starts.
        navDirection = Self.navigationSign(from: from, to: iso)

        // ONE haptic, exactly here — the single place every navigation
        // (a day tap, a week-strip swipe, "Today") funnels through, and
        // guarded by the line above so a re-tap of the day already showing
        // never fires one. It marks the SELECTION, not the data: "the
        // calendar follows the runner's finger immediately; data quietly
        // catches up" — firing on `surface.model` landing instead would tie
        // the feedback to a round trip the runner's thumb has already moved
        // past, and it would fire on a day the reader had NOT yet confirmed
        // is the one now showing, which is exactly what STATEGATE-1 exists
        // to rule out.
        UISelectionFeedbackGenerator().selectionChanged()

        // Landing back on the runner's own today is going HOME, not visiting a
        // date: `viewingDate` goes nil so the header stops offering a way back
        // to where you already are, and the read drops its `date=` parameter.
        let isHome = iso == today
        viewingDate = isHome ? nil : iso

        // PLANSNAPSHOT-1 · a date the local snapshot already covers is
        // rendered ENTIRELY from that snapshot — no fetch, no cache lookup,
        // no `navigationTask`, no `pendingDate`. This is the whole point of
        // the snapshot: once a sync has landed, browsing the block must
        // never depend on the network again. Only a genuinely non-today
        // date takes this path — landing back on today keeps the existing
        // live-narrative fetch below, since a snapshot day carries authored
        // STRUCTURE only, never today's readiness/contingency narrative
        // (see `PlanSnapshotDayView.swift`'s header).
        //
        // `surface.model`/`dayCache`/`navigationTask` are left completely
        // alone here — `body`'s own snapshot branch (see its header
        // comment) reads `viewingDate` + `PlanSnapshotStore` directly and
        // never looks at `surface.model` for this date, so there is no
        // stale-model risk from skipping the fetch.
        if Self.shouldRenderFromSnapshot(iso: iso, isHome: isHome, snapshot: PlanSnapshotStore.shared.current) {
            pendingDate = nil
            navigationTask?.cancel()
            navigationTask = nil
            return
        }

        let param: String? = isHome ? nil : iso
        let refresh: () async throws -> API.V5Fetch<V5Today> = { try await API.fetchV5Today(date: param) }

        // WEEKCACHE-1 · fired the instant a navigation starts, not awaited —
        // a week summary is what the pending card upgrades to on a cache
        // miss (see `pendingContentBody`), so the earlier this lands the
        // sooner a "Loading…" label becomes a real type/dose. Independent
        // of `navigationTask`: it never touches `surface.model`, same
        // reasoning as `prefetchAround` below.
        if dayCache[iso] == nil { Task { await fetchAndCacheWeek(anchoredOn: iso) } }

        navigationTask?.cancel()
        // FETCHOWNER-1 · only an `isHome` navigation is allowed to
        // permanently rebind the shared surface's canonical fetch — that
        // IS "today" going forward, correctly. Any other date borrows the
        // surface for exactly this one read (`fetchOnce`) so a later,
        // unrelated refresh (`.faffForegroundRefresh`, the StaleBanner's
        // Retry) can never re-fetch a date the runner already navigated
        // away from — see `fetchOnce`'s own doc comment for the concrete
        // failure this closes.
        if let known = dayCache[iso] {
            // STATEGATE-1 · painted SYNCHRONOUSLY, this line, not inside the
            // Task below — see `presentSync`'s own doc comment for why a
            // Task hop here would open exactly the render-gate false-mismatch
            // window this whole mechanism exists to close. `pendingDate` is
            // cleared because there is nothing left to be "pending": the
            // content on screen right now already matches `iso`.
            surface.presentSync(known)
            pendingDate = nil
            navigationTask = Task {
                if isHome { await surface.refreshBehind(refresh) }
                else { await surface.fetchOnce(refresh) }
            }
        } else {
            // No cache hit — genuinely nothing to show for `iso` yet.
            // `pendingDate` is what `readiness` (below) reads to tell "still
            // loading this date" apart from "already failed to load it."
            pendingDate = iso
            navigationTask = Task {
                if isHome { await surface.rebind(refresh) }
                else { await surface.fetchOnce(refresh) }
                // Only clear if nothing newer has already moved on — a
                // cancelled task's late completion must not un-pend a date
                // the runner is no longer waiting on.
                if pendingDate == iso { pendingDate = nil }
            }
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
    /// REQCOORD-1 (2026-09-03) · ONE coordinated fetch for everything worth
    /// priming, not two independent `TaskGroup`s each opening their own
    /// requests.
    ///
    /// David, live in the simulator, before this pass: tapped Sunday from a
    /// Tuesday-today week and it was a real, visible wait — Sunday is 5 days
    /// away, which the old `[-1, 1, -7, 7]` radius never covered. Every one
    /// of the seven cells in the strip is tappable RIGHT NOW, so "what might
    /// get tapped next" is the WHOLE visible week, not an arithmetic
    /// neighbourhood a swipe gesture happens to use — and "Prefetch the
    /// immediately previous and next weeks" is the brief's own words, not
    /// just the day either side of today.
    ///
    /// Bounds are read off `weekStrip` itself (first/last date), never
    /// re-derived by hand, so this can never disagree with what the strip is
    /// actually drawing, including on a short first or last week of the
    /// block.
    /// TODAYPERSIST-1 (2026-09-04) · cold-launch cache seed, disk only, no
    /// network — synchronous, so it's done before this file's own `.task`
    /// ever reaches its first `await`. `surface.model` is ALREADY populated
    /// by the time this runs, because `V5Surface.init` seeds itself from
    /// `AppCache.read(.v5Today, ...)` synchronously at construction — this
    /// function exists to do the SAME thing for the OTHER dates and weeks
    /// the runner has previously visited, which today's fixed cache slot
    /// has no room for.
    ///
    /// Deliberately mirrors `prefetchAround`'s own definition of "nearby"
    /// (the visible week, the immediately previous/next week's days, two
    /// weeks of summaries) rather than inventing a second one — a cold
    /// launch should be able to instantly show exactly what a warm launch
    /// would have prefetched by now, no more, no less.
    ///
    /// A cached entry whose OWN `planVersion` disagrees with what
    /// `surface.model` just loaded is discarded, not accepted — the same
    /// call PLANVERSION-1's `reconcileDayCache` already makes for a
    /// network arrival. A nil version (a legacy payload, or the very first
    /// launch before any version has ever been seen) is treated as
    /// "unknown, not necessarily wrong" and accepted rather than refused —
    /// Rule 11's three-state discipline applied to a version tag rather
    /// than a measurement: absent is not the same fact as contradicted.
    /// Rule 11's three-state discipline, applied to a version tag instead
    /// of a measurement: a `candidate` version that disagrees with
    /// `current` is discarded, but an ABSENT version on either side is
    /// "unknown, not necessarily wrong" and passes. Extracted as a static
    /// function — same reasoning as `canPageWeek` above — so
    /// `seedCachesFromDisk`'s acceptance rule for a disk-cached day or week
    /// is directly testable rather than only reachable through a full
    /// cold-launch simulation.
    static func planVersionAcceptable(candidate: String?, current: String?) -> Bool {
        candidate == nil || current == nil || candidate == current
    }

    /// PLANSNAPSHOT-1 · the decision `goTo` gates its whole network
    /// short-circuit on, extracted as a plain, static, input-to-output
    /// function — same reasoning as `canPageWeek`/`planVersionAcceptable`
    /// above — so "does this navigation need the network" is directly
    /// testable rather than provable only by driving a live host through a
    /// real navigation. `isHome` always routes to the existing live-Today
    /// path (never the snapshot) — see `PlanSnapshotDayView.swift`'s header
    /// for why today specifically keeps its live narrative.
    static func shouldRenderFromSnapshot(iso: String, isHome: Bool, snapshot: PlanSnapshot?) -> Bool {
        guard !isHome else { return false }
        return snapshot?.day(on: iso) != nil
    }

    /// PLANSNAPSHOT-1 · the ONLY place that fetches the whole-block
    /// snapshot. Triggered by launch (`.task` below), foreground
    /// (`.v5ReloadOnForeground`), explicit Retry, a plan mutation, or a
    /// completion sync — NEVER by `goTo`/week-strip paging, which is the
    /// whole point of the snapshot existing. A cancelled or failed fetch
    /// leaves `PlanSnapshotStore.current` exactly as it was — `commit`
    /// itself never touches it on failure, and a genuine cancellation
    /// (e.g. this task superseded by a newer sync request) is read as
    /// routine, not a failure, so it does not even reach `markSyncFailed`.
    @discardableResult
    func syncPlanSnapshot() async -> Bool {
        PlanSnapshotStore.shared.markSyncing()
        let raw: Data
        do {
            raw = try await API.fetchPlanSnapshotRaw()
        } catch {
            if API.isCancellation(error) { return false }
            PlanSnapshotStore.shared.markSyncFailed(String(describing: error).prefix(300).description)
            return false
        }
        switch PlanSnapshotStore.shared.commit(rawData: raw) {
        case .success:
            return true
        case .failure:
            // `commit` has already recorded its own `lastError`/`syncState`
            // — nothing further to do here. The prior valid snapshot (if
            // any) is untouched; see `PlanSnapshotStore`'s own contract.
            return false
        }
    }

    private func seedCachesFromDisk() {
        guard let model = surface.model,
              let first = model.weekStrip.first?.dateISO,
              let last = model.weekStrip.last?.dateISO,
              let firstDate = Self.iso.date(from: first),
              let lastDate = Self.iso.date(from: last)
        else { return }
        let planVersion = model.planVersion

        func versionOK(_ candidate: String?) -> Bool {
            Self.planVersionAcceptable(candidate: candidate, current: planVersion)
        }
        func acceptDay(_ iso: String) {
            guard dayCache[iso] == nil,
                  let data = AppCache.readRawDynamic("v5.day.\(iso)"),
                  let decoded = try? JSONDecoder().decode(V5Today.self, from: data),
                  versionOK(decoded.planVersion)
            else { return }
            dayCache[iso] = decoded
        }
        func acceptWeek(_ start: String) {
            guard weekCache[start] == nil,
                  let data = AppCache.readRawDynamic("v5.week.\(start)"),
                  let decoded = try? JSONDecoder().decode(PlanWeek.self, from: data),
                  versionOK(decoded.plan_version)
            else { return }
            weekCache[start] = decoded
            if let s = decoded.plan_start_iso { planStartISO = s }
            if let e = decoded.plan_end_iso { planEndISO = e }
        }

        for d in model.weekStrip.map(\.dateISO) { acceptDay(d) }
        for offset in 1...7 {
            if let prev = Calendar.current.date(byAdding: .day, value: -offset, to: firstDate) {
                acceptDay(Self.iso.string(from: prev))
            }
            if let next = Calendar.current.date(byAdding: .day, value: offset, to: lastDate) {
                acceptDay(Self.iso.string(from: next))
            }
        }

        acceptWeek(first)
        if let prevStart = Calendar.current.date(byAdding: .day, value: -1, to: firstDate) {
            acceptWeek(Self.iso.string(from: prevStart))
        }
        if let nextStart = Calendar.current.date(byAdding: .day, value: 1, to: lastDate) {
            acceptWeek(Self.iso.string(from: nextStart))
        }
        if let nextNextStart = Calendar.current.date(byAdding: .day, value: 8, to: lastDate) {
            acceptWeek(Self.iso.string(from: nextNextStart))
        }
    }

    private func prefetchAround(_ iso: String) async {
        var wanted: Set<String> = []

        if let strip = surface.model?.weekStrip, let first = strip.first?.dateISO,
           let last = strip.last?.dateISO,
           let firstDate = Self.iso.date(from: first), let lastDate = Self.iso.date(from: last) {
            // The visible week itself.
            wanted.formUnion(strip.map(\.dateISO))
            // The full seven days of the immediately previous and next week.
            for offset in 1...7 {
                if let prev = Calendar.current.date(byAdding: .day, value: -offset, to: firstDate) {
                    wanted.insert(Self.iso.string(from: prev))
                }
                if let next = Calendar.current.date(byAdding: .day, value: offset, to: lastDate) {
                    wanted.insert(Self.iso.string(from: next))
                }
            }
        } else if let d = Self.iso.date(from: iso) {
            // No strip in hand yet (a cold prefetch before the first payload
            // has landed) — fall back to the single-day radius this
            // replaced, which needs only `iso` and no strip bounds.
            for off in [-1, 1, -7, 7] {
                if let n = Calendar.current.date(byAdding: .day, value: off, to: d) {
                    wanted.insert(Self.iso.string(from: n))
                }
            }
        }

        let missing = wanted.filter { dayCache[$0] == nil }

        // WEEKCACHE-1 · "fetch and cache: the visible week; the immediately
        // previous week; the immediately next week" — three week-summary
        // reads, run alongside the per-day prefetch below rather than
        // gating on it, since a summary is useful even for a day whose
        // full detail prefetch hasn't landed yet.
        if let strip = surface.model?.weekStrip, let first = strip.first?.dateISO,
           let last = strip.last?.dateISO,
           let firstDate = Self.iso.date(from: first), let lastDate = Self.iso.date(from: last) {
            async let visible: Void = fetchAndCacheWeek(anchoredOn: first)
            async let prev: Void = {
                if let d = Calendar.current.date(byAdding: .day, value: -1, to: firstDate) {
                    await fetchAndCacheWeek(anchoredOn: Self.iso.string(from: d))
                }
            }()
            async let next: Void = {
                if let d = Calendar.current.date(byAdding: .day, value: 1, to: lastDate) {
                    await fetchAndCacheWeek(anchoredOn: Self.iso.string(from: d))
                }
            }()
            // PRELOAD-1 (2026-09-04) · "at rest, the app already has ... the
            // next two weeks." One week ahead was the swipe-adjacent case;
            // this is the second, so a runner who swipes twice in a row
            // still lands on cached content rather than a network round trip
            // on the second swipe.
            async let nextNext: Void = {
                if let d = Calendar.current.date(byAdding: .day, value: 8, to: lastDate) {
                    await fetchAndCacheWeek(anchoredOn: Self.iso.string(from: d))
                }
            }()
            _ = await (visible, prev, next, nextNext)
        }

        guard !missing.isEmpty else { return }

        // ONE call into the bounded, deduplicating coordinator — never more
        // than `maxConcurrent` requests open at once, however many dates a
        // burst of navigation asked for, and a date already in flight from
        // an earlier call is never started a second time.
        let fetched = await fetchCoordinator.fetch(Array(missing))
        for (key, payload) in fetched {
            dayCache[key] = payload
            reconcileDayCache(against: payload)
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
    // ─────────────────────────────────────────────────────────────────────
    // STALEDAY-1 → STATEGATE-1 (2026-09-02 → 2026-09-03)
    //
    // STALEDAY-1 answered "a screen must never pass one day off as another"
    // with an honest banner naming the mismatch — `otherDayOnScreen`, once
    // here, compared `viewingDate` against `model.dateISO` and let a caller
    // render `content(model)` regardless, with a note stacked above it. That
    // is real information, and it is still the wrong fix: the review that
    // followed named the actual rule — "do not solve a state-integrity
    // defect with explanatory copy" — the workout card underneath was still
    // the WRONG day.
    //
    // The comparison this function made is now `readiness(model:wanted:
    // pendingDate:)`, at the top of this file, and it does not return
    // information for a caller to render a banner from — it returns which of
    // three screens gets built, and `content(_:)` is reachable from exactly
    // one of them. See that function's own doc comment.

    /// "Tuesday 1 September", for the one sentence that has to name two days
    /// and cannot lean on the strip to disambiguate them.
    private static let dayNameFormat: DateFormatter = {
        let f = DateFormatter()
        f.locale = .autoupdatingCurrent
        // UTC, TO MATCH `Self.iso`. Caught by rendering it (Rule 13), not by
        // reading it: `Self.iso` parses "2026-09-01" as UTC midnight, and a
        // formatter left on the device's zone renders that instant as the
        // evening of August 31 in any negative offset. On the simulator, in
        // PDT, the note read "Monday, August 31 did not load. You are looking
        // at Tuesday, September 1" on a screen showing Wednesday the 2nd —
        // BOTH days off by one, on the one component whose entire job is to
        // say which day you are actually looking at.
        f.timeZone = TimeZone(identifier: "UTC")
        f.setLocalizedDateFormatFromTemplate("EEEEdMMMM")
        return f
    }()

    private static func dayName(_ iso: String) -> String {
        guard let d = Self.iso.date(from: iso) else { return iso }
        return dayNameFormat.string(from: d)
    }

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
    ///
    /// "Sign out" lives here, one tap from the account button, not nested a
    /// screen deeper inside Settings. This sheet is the runner's ONLY route
    /// to Settings (see `wayOutHeader`'s doc comment) — it is also the only
    /// route out of a stuck session, and a runner stuck on an outage screen
    /// with a dead token has no reason to expect "sign out" lives inside a
    /// preferences page rather than in the menu the account button itself
    /// opens. A Lilley in this exact state tapped the account button, saw
    /// only Settings and Shoes, and never found sign out at all.
    private var accountRows: [V5Row] {
        [
            V5Row(id: "settings", label: "Settings", sub: "Training, notifications, units", action: "settings"),
            V5Row(id: "shoes", label: "Shoes", sub: "Rotation and retirement", action: "shoes"),
            V5Row(id: "signOut", label: "Sign out", sub: "End this session on this device", action: "signOut"),
        ]
    }

    /// Shared by both places this sheet's rows get tapped from (the outage/
    /// refusal overlay above, and `TodayBeforeLiveV5`'s account sheet) so the
    /// action vocabulary is defined once.
    private func handleAccountRowTap(_ action: String?) {
        switch action {
        case "settings": path.append(.settings)
        case "shoes":    path.append(.shoes)
        case "signOut":  Task { await SessionHygiene.signOut() }
        default: break
        }
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
            // A11Y · same fix as `pendingCard`'s `.loading` case: the
            // 380pt placeholder is a bare Shape (publishes nothing to the
            // accessibility tree) and the two `Skeleton`s each independently
            // announced "Loading", so the FIRST thing a VoiceOver runner
            // heard on a cold launch was a silent gap then a duplicated
            // "Loading". One element, one label — there is no date to name
            // yet here (no payload has ever landed), so "Loading your plan"
            // rather than a specific day.
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                // The panel's own height, reserved. Nothing appears or
                // disappears and reflows.
                RoundedRectangle(cornerRadius: V5.R.panel, style: .continuous)
                    .fill(V5.surface1)
                    .frame(height: 380)
                Skeleton(lines: 3)
                Skeleton(lines: 2)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Loading your plan")
            .padding(.horizontal, V5.S.gutter)
        }
        .background(V5.surfacePage)
    }

    // ── writes ──

    // `logEffort` removed 2026-09-03 — `RPECaptureRow` (DesignV5/RPEV5.swift)
    // now owns writing `POST /api/runs/[id]/rpe`, over `API.postRPE`. This
    // function POSTed the same endpoint directly for the ten-button picker
    // `TodayAfterV5.askedVsRanSection` used to draw; removed with that
    // picker rather than left as a second, unused path to the same write.

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
                    // Offline must not look like online. See StaleStateV5.swift.
                    .safeAreaInset(edge: .top, spacing: 0) {
                        if surface.stale {
                            StaleBannerV5(cachedAt: surface.cachedAt,
                                          onRetry: { Task { await surface.load() } })
                                .padding(.horizontal, V5.S.gutter)
                                .padding(.bottom, V5.S.s12)
                                .background(V5.surfacePage)
                                .transition(.opacity)
                        }
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
                        // Offline must not look like online. See StaleStateV5.swift.
                        .safeAreaInset(edge: .top, spacing: 0) {
                            if surface.stale {
                                StaleBannerV5(cachedAt: surface.cachedAt,
                                              onRetry: { Task { await surface.load() } })
                                    .padding(.horizontal, V5.S.gutter)
                                    .padding(.bottom, V5.S.s12)
                                    .background(V5.surfacePage)
                                    .transition(.opacity)
                            }
                        }
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
    /// Race P1 on V5 · `RaceEditSheet` already does the real work (prefill
    /// GET, PATCH, plan/VDOT auto-rebuild server-side); this host only owns
    /// the toggle and the reload-on-save, same shape as `RaceDayView`'s.
    @State private var showEditSheet = false

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
                             onBack: { dismiss() },
                             onEdit: { showEditSheet = true })
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
        .sheet(isPresented: $showEditSheet) {
            // `RaceEditSheet` does its own authoritative GET
            // (`API.fetchRaceDetail`) against `/api/race/[slug]` — the raw
            // editor shape (distance_label, ISO date, priority, wave, bib,
            // fuel, logistics), a different, wider payload than this V5
            // screen's own `V5RaceDetail`. So the only instant seeds worth
            // passing here are the two fields the V5 model actually carries;
            // everything else arrives a moment later from that GET, same as
            // it does for every other caller of this sheet.
            RaceEditSheet(
                slug: slug,
                seedName: surface.model?.name,
                seedGoal: surface.model?.goal?.text,
                onSaved: {
                    // The PATCH already ran the plan/VDOT/LTHR auto-rebuild
                    // server-side (`web-v2/app/api/race/route.ts`), so a
                    // fresh load is all this needs — goal, distance, course
                    // and pace plan all come off the same reloaded model.
                    Task { await surface.load() }
                }
            )
            .presentationDetents([.large])
        }
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
    /// TRAVEL-1 · the travel-windows sheet, hosted here the way AddRaceHostV5
    /// hosts its own: a V5SheetHost over the screen, never a system sheet.
    @State private var travelOpen = false

    var body: some View {
        ZStack {
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
                               onOpenTravel: { travelOpen = true },
                               onBack: { dismiss() })
                } else {
                    ScrollView { Skeleton(lines: 6).padding(.horizontal, V5.S.gutter) }
                        .background(V5.surfacePage)
                }
            }
            if travelOpen {
                V5SheetHost(isPresented: $travelOpen, tall: true) {
                    TravelSheetV5(onClose: { travelOpen = false })
                }
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
        // Re-mirror the wire's own answer at the moment this screen draws it.
        // `FaffV5Root` writes it at launch; this keeps the row honest for a
        // session in which the connection changed (an OAuth round-trip, or a
        // disconnect made on the web) without waiting for a relaunch. Same
        // authority, same field — never a second source of truth.
        if let state = try? await API.fetchProfileState() {
            StravaConnection.set(state.connections.strava.connected)
        }
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
            run: { _, onExecute in
                RunLobbyV5(
                    onWatch: { onExecute(.watch) },
                    onOutdoor: { onExecute(.outdoor) },
                    onTreadmill: { onExecute(.treadmill) }
                )
            },
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
            // ── THE STRAVA MIRROR HAD NO WRITER IN v5 ────────────────────
            //
            // `StravaConnection` is a `UserDefaults` mirror of one wire field,
            // `connections.strava.connected`. All eight `set(...)` call sites
            // live in the legacy `Views/` tree — `ProfileView`, `ActivityView`,
            // `SettingsView`, `TodayView` — none of which the v5 app ever
            // runs. So the key was never written, `UserDefaults.bool` returned
            // its `false` default forever, and two things were wrong at once:
            //
            //   · Settings read "Strava · Not connected" for a runner with a
            //     live token (`connected_at 2026-06-01`, `disconnected_at`
            //     NULL) whose runs this app has actually pushed.
            //   · `TodayPostRunBody` gates the **Push to Strava** button on the
            //     same flag, so a working feature was permanently invisible.
            //
            // Rule 11, exactly: "never synced" and "explicitly disconnected"
            // collapsed into one value.
            //
            // This is the WRITE PATH being fixed, not a second source of truth.
            // The wire stays authoritative; the mirror is only ever a cache of
            // it, and it is now written wherever v5 resolves a profile state.
            // Both branches below set it, because the cached payload carries
            // `connections` just as the fresh one does — reading the cache and
            // skipping the write is how a mirror goes stale.
            if let cached = AppCache.read(.profileState, as: ProfileState.self) {
                StravaConnection.set(cached.connections.strava.connected)
                if let name = cached.identity.full_name, !name.isEmpty { accountName = name }
            }
            if let fresh = try? await API.fetchProfileState() {
                StravaConnection.set(fresh.connections.strava.connected)
                if let name = fresh.identity.full_name, !name.isEmpty { accountName = name }
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

/// DUPLICATE-1 · shown instead of either phone console when the watch has
/// already published an active session. Deliberately terse: the runner does
/// not need a diagnosis, they need to know their run is already being
/// recorded and where to look for it.
struct LiveRunBlockedByOtherDeviceV5: View {
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            Spacer(minLength: 0)
            Text("Already recording on your Apple Watch")
                .font(.faffDisplay(22))
                .foregroundStyle(V5.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Text("Your watch started this run. Starting it again here would record two activities for the same run. Use your watch to pause or end it.")
                .font(.faffText(TypeScaleV5.body15))
                .foregroundStyle(V5.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            FaffButton("Back to Run", variant: .secondary, size: .md, action: onDismiss)
        }
        .padding(V5.S.gutter)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(V5.surfacePage.ignoresSafeArea())
    }
}

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
    /// DUPLICATE-1 · set in `.task`, before either console ever mounts, when
    /// the watch has already published an active session. Checked for BOTH
    /// `.outdoor` and `.treadmill` (both are "phone recording" in the sense
    /// this guard cares about) — `.watch` mode needs no check of its own,
    /// since it never starts anything on the phone to conflict with.
    @State private var blockedByActiveWatchSession = false

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
            if blockedByActiveWatchSession {
                // DUPLICATE-1 · the whole point: never silently let this
                // console start recording over a session the watch already
                // owns. Named, explicit, and gives the runner the one
                // sensible next step (leave; the watch is already going).
                LiveRunBlockedByOtherDeviceV5(onDismiss: onDismiss)
            } else if asked {
                switch mode {
                case .watch:
                    // The runner explicitly chose Apple Watch on the Run
                    // tab (only offered there when the watch already has
                    // today's workout) — this phone screen is companion
                    // status only. It never touches `tracker` (never
                    // started for this session, see `.task`) and never
                    // shows Pause/End of its own — those live on the watch,
                    // which is the one recording owner for this session.
                    LiveRunWatchCompanionV5(plan: plan, onDismiss: onDismiss)
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
            // The lobby (`RunLobbyV5`) already fetched today's workout to
            // show the runner what was about to start — reuse that exact
            // read rather than fetching a second time, so "what was shown"
            // and "what starts" can never be two different answers a few
            // seconds apart (a plan rebuild or midnight rollover landing
            // between the two calls). Only a fresh, still-relevant snapshot
            // is consumed (see `PendingRunPlanV5`); anything else (opened via
            // some other path, or the lobby's own fetch failed) falls
            // through to the same fetch this always did.
            //
            // Unwrapped explicitly (not a same-level switch) on purpose:
            // `Snapshot` declares its own `.none` case, and matching
            // `PendingRunPlanV5.Snapshot?` in one switch makes bare `.none`
            // ambiguous between "never captured" (the Optional's own nil)
            // and "captured, and the answer was no workout" (`Snapshot.none`
            // wrapped in `.some`) — exactly the Rule 11 distinction this
            // holder exists to keep separate. Binding first removes the
            // ambiguity instead of relying on which one Swift picks.
            // `expectedDateISO` refuses a snapshot recorded for a different
            // calendar day — the guard against a cached workout from
            // another date or plan version ever reaching Start, independent
            // of the age check (a midnight rollover between the lobby
            // opening and this task running is otherwise invisible to a
            // pure elapsed-time check).
            var canonicalWorkoutId: String?
            if let snapshot = PendingRunPlanV5.shared.consume(expectedDateISO: RunLobbyDate.todayISO()) {
                switch snapshot {
                case .workout(let w): plan = LiveRunPlanV5(workout: w, sessionType: w.name); canonicalWorkoutId = w.workoutId
                case .none:           plan = nil
                }
            } else {
                // A failure here is not an outage screen: the run can still
                // be recorded, it just has no target to hold. `plan` stays
                // nil and both consoles already draw their no-target layout.
                if let w = try? await API.fetchWatchWorkout() {
                    plan = LiveRunPlanV5(workout: w, sessionType: w.name)
                    canonicalWorkoutId = w.workoutId
                }
            }
            // DUPLICATE-1 · checked ONCE, here, before either phone console
            // ever mounts or `tracker.start` is ever called — the same
            // "decide once, before anything starts" discipline Decision 1
            // already applies to the owner itself. `.watch` mode is exempt:
            // it starts nothing on the phone, so there is nothing here for
            // it to conflict with.
            if mode != .watch, WatchSync.shared.watchActiveWorkoutIsCurrent {
                blockedByActiveWatchSession = true
                asked = true
                return
            }
            asked = true
            // DECISION-1 · one recording owner per session — `mode` IS that
            // decision now (2026-09-03 correction), made explicitly by the
            // runner tapping Apple Watch / Outdoor / Treadmill on the Run
            // tab, never inferred here from live reachability. `.watch`
            // never starts `tracker`; `.outdoor` always does, unconditionally
            // — the phone is only ever recording because the runner picked
            // it, not because the watch happened to be unreachable at the
            // moment this view appeared. It stamps the SAME canonical
            // workoutId the watch would have used, rather than a random
            // `phone_<uuid>` unrelated to the day's prescription.
            if mode == .outdoor {
                tracker.start(canonicalWorkoutId: canonicalWorkoutId)
            }
            // DUPLICATE-1 · the phone's own half of the handshake, published
            // the moment either phone console actually commits to a session
            // — so a direct watch start a moment later can (once the watch
            // side reads this app's context) see the phone already owns
            // one. Both `.outdoor` and `.treadmill` publish; `.watch` never
            // reaches this line (returned above). `canonicalWorkoutId` alone
            // — never `tracker.workoutId`, which is only meaningful for
            // `.outdoor` (`.treadmill` never starts this `tracker` at all;
            // its own console synthesizes its own id from this SAME
            // `plan?.workoutId` source, so an unstructured run's fallback
            // placeholder here does not need to match it byte-for-byte to
            // serve this guard's actual job — flagging "a session exists."
            if mode == .outdoor || mode == .treadmill {
                WatchSync.shared.publishPhoneActiveWorkout(id: canonicalWorkoutId ?? "phone-run")
            }
            // 2026-08-21 · the HR stream is NOT started here any more.
            // `TreadmillHRStreamer.start` is first-caller-wins on the sample
            // anchor, and this call fires with "whenever the plan finished
            // loading" — racing both consoles, which start it themselves with
            // the run's actual start instant. Whichever won pinned the anchor,
            // and the console's more accurate one was silently discarded.
            // Each console owns its own anchor because each console knows
            // when its run began.
        }
        // DUPLICATE-1 · clears the phone's half of the handshake regardless
        // of WHICH exit path this view leaves through (End, discard, the
        // blocked-refusal's own dismiss, `.faffSessionExpired` tearing the
        // whole shell down) — one place, not one call per exit, so a future
        // exit path cannot forget it. Harmless to call when nothing was ever
        // published (`.watch` mode, or the blocked path that returned
        // before publishing): `publishPhoneActiveWorkout(id: nil)` merges a
        // key-removal into whatever context already exists.
        .onDisappear { WatchSync.shared.publishPhoneActiveWorkout(id: nil) }
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
