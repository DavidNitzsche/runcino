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

// MARK: - Directional panel transition (PANELMOTION-1, motion redone PANELMOTION-2)
//
// "Later date: old content moves slightly left and fades; earlier date: old
// content moves slightly right and fades; new content enters from the
// corresponding direction... same-date refresh: crossfade only." A plain
// `.move(edge:)` slides a full frame width, which reads as a page changing,
// not a date changing — this moves by a fixed offset instead.
//
// PANELMOTION-2 (2026-09-04) · the offset and curve are `V5.Motion
// .dayTransition`/`dayTransitionOffset` now, not `fill`/12pt. David, live,
// on the original: "not really tied to a transition, its not moves out and
// back in." A flat `.easeInOut` decelerates identically on both ends, which
// reads as a soft crossfade with a nudge attached, not a push — there is no
// asymmetry in the curve to read as DIRECTION even though the offset itself
// is directional. `.animation(_:)` is chained directly onto each half of
// the transition below (not left to the ambient `.animation(value:)` at the
// call site) so this transition always uses its own curve regardless of
// what else is changing in the same transaction — the two are allowed to
// diverge, but only for a since-argued reason (see `V5.Motion.dayTransition`
// itself), not by accident of whatever value happened to trigger it.
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
    static func todayPanel(sign: Int, points: CGFloat = V5.Motion.dayTransitionOffset) -> AnyTransition {
        guard sign != 0 else { return .opacity }
        let enter = points * CGFloat(sign)
        let curve = V5.Motion.dayTransition
        return .asymmetric(
            insertion: .modifier(
                active: PanelSlideModifier(offsetX: enter, opacity: 0),
                identity: PanelSlideModifier(offsetX: 0, opacity: 1)
            ).animation(curve),
            removal: .modifier(
                active: PanelSlideModifier(offsetX: -enter, opacity: 0),
                identity: PanelSlideModifier(offsetX: 0, opacity: 1)
            ).animation(curve)
        )
    }
}

// MARK: - Today

struct TodayHostV5: View {
    @StateObject private var surface = V5Surfaces.today()
    /// CALCELLWEEK-1 (2026-09-07) · the Training calendar sheet needs every
    /// week of the block, not just the current one — `/api/v5/today` only
    /// ever carries `weekStrip`'s own seven days. `V5Surfaces.block()`'s
    /// init reads straight from `AppCache` with no network call, and
    /// `prefetchAllOnLaunch()` already warms that cache on every launch, so
    /// this is a free read here, not a new fetch this screen owns.
    @StateObject private var blockSurface = V5Surfaces.block()
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
                            // WKSTRIP-UTC-1 · `dateISO` first, matching every
                            // other resolver of this exact question (the
                            // calendar sheet, `inSharedShell`'s own strip) —
                            // it is the authoritative field when present;
                            // `isoDate(embeddedIn:)` is a last-resort guess
                            // at a substring of `id`, not a first choice.
                            if let iso = day.dateISO ?? Self.isoDate(embeddedIn: day.id) {
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
        let cal = Self.utcCalendar
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
            //
            // RECAP-1 · `matched_run == nil` MUST mirror `goTo`'s own
            // `shouldRenderFromSnapshot` exactly, or the two disagree on
            // which days skip the network: a day WITH a matched run falls
            // through to the `else if let model = surface.model` branch
            // below instead, so it renders `TodayAfterV5`'s real recap —
            // see `shouldRenderFromSnapshot`'s own header for why.
            if let viewingDate, let snapshotDay = PlanSnapshotStore.shared.current?.day(on: viewingDate),
               snapshotDay.matched_run == nil,
               let shellModel = surface.model {
                // `shellModel` supplies the shell's chrome ONLY (header text,
                // week-strip rotation via `stripDays(for:)`'s own snapshot
                // branch above, account initials) — never this date's
                // content, which is `snapshotDay` alone. `shellModel` is
                // whatever Today's own cache last held (seeded from disk at
                // cold launch, refreshed at launch/foreground) and is not
                // re-fetched for this date.
                inSharedShell(shellModel, fill: snapshotDay.fill, hero: {
                    // `type` passed RAW (lowercase), same as `/api/v5/today`'s
                    // own `ctx.type = prescriptionType` — `.faffDisplayV5`
                    // applies `.textCase(.uppercase)` at this point size on
                    // its own (`FontsV5.swift`), so uppercasing here would be
                    // redundant, not wrong, and this way there is exactly one
                    // place that decides display case.
                    HeroDayPanelContentV5(
                        kicker: snapshotDay.kicker,
                        type: snapshotDay.type,
                        dose: snapshotDay.dose?.value,
                        stats: snapshotDay.stats.map { stat in
                            PanelStat(stat.label, stat.value.value, ink: stat.toneValue.inkOverride)
                        }
                    )
                }) {
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
                                              onRetry: { Task { await API.resetConnectionPool(); await surface.load() } })
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
                        OutageBodyV5(onRetry: { Task { await API.resetConnectionPool(); await surface.load() } })
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
            // CALCELLWEEK-1 · not awaited, same reasoning: `blockSurface.
            // model` already reads whatever `prefetchAllOnLaunch()` cached,
            // so the calendar sheet works even on the very first frame;
            // this only refreshes it behind that, for a runner who opens
            // the calendar before Block's own tab has loaded this session.
            Task { await blockSurface.load() }
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
        // REQUESTSTORM-2 (2026-09-06) · `surface.load()` dropped from here.
        // `V5Surface`'s own `.faffForegroundRefresh` observer already
        // reloads this surface once per real foreground (throttled in
        // `SurfaceStoreV5.swift`); calling it again here, throttled only
        // against ITSELF, was a third independent trigger for the identical
        // reload — see `ForegroundWork.shouldLoadOnForeground`'s doc comment.
        // `syncPlanSnapshot()` stays: this modifier is still the ONLY
        // foreground trigger for the plan snapshot (PLANSNAPSHOT-1 above),
        // and its own 3s throttle correctly collapses the app's two
        // deliberate posts into one snapshot sync.
        .v5ReloadOnForeground { await syncPlanSnapshot() }
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
    /// HEROPANEL-1 (2026-09-04) · `fill`/`hero` are new, both defaulted, so
    /// every OTHER call site (loading, failed, pending, etc.) is byte-
    /// identical to before — `.quiet` fill, an empty hero slot, header alone
    /// in its own panel. The snapshot-day branch is the one caller that
    /// passes both: the day's own gradient, and the SAME
    /// `HeroDayPanelContentV5` block `TodayBeforeV5` draws, so header and
    /// hero content sit in ONE coloured panel together — David: "the top
    /// bar by Dynamic Island and week strip never move position" and
    /// "every day should look like this... only the color, run, specific
    /// info, etc." changes. Before this, a browsed day's header sat in a
    /// separately-coloured `.quiet` panel with the day's own content drawn
    /// FLAT below it — two templates, not one.
    @ViewBuilder
    private func inSharedShell<Hero: View, Content: View>(
        _ model: V5Today,
        fill: PanelFill = .quiet,
        @ViewBuilder hero: @escaping () -> Hero = { EmptyView() },
        @ViewBuilder content: () -> Content
    ) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                DayPanel(fill: fill) {
                    TodayHeaderStripV5(
                        place: model.panel.place,
                        viewingDayLabel: viewingDayLabel,
                        weekLine: model.panel.weekLine,
                        weekStripDays: stripDays(for: model),
                        onBackToToday: { backToToday() },
                        onCalendar: nil,
                        initials: initials,
                        onAccount: { accountOpen = true },
                        // WKSTRIP-UTC-1 · `stripDays(for:)` above can hand
                        // back a week `snapshotWeekStripDays` reconstructed
                        // for a date outside `model`'s own week — the exact
                        // shape CALCELLWEEK-1 already found on the calendar
                        // sheet. Those rows carry a real `dateISO`; their
                        // `id` (a plan_workout row id, or a `date:`-prefixed
                        // ghost key already equal to it) does NOT reliably
                        // resolve back through `model.weekStrip`, which is
                        // still whichever week the model itself loaded for.
                        // Reproduced live: jump to a future week via the
                        // calendar, then tap a DIFFERENT day in that same
                        // week's own strip — the old `day.id`-only lookup
                        // found nothing in `model.weekStrip` and the tap did
                        // nothing. Same fix, same reason as the calendar
                        // sheet's own `onPickDay(day.dateISO ?? day.id)`.
                        onPickDay: { day in pickDay(day.dateISO ?? day.id, in: model) },
                        onPageWeek: { await stepWeekAndWait($0 * 7, from: model) },
                        canPageBackward: canPageWeek(-1, weekStart: model.weekStrip.first?.dateISO, weekEnd: model.weekStrip.last?.dateISO),
                        canPageForward: canPageWeek(1, weekStart: model.weekStrip.first?.dateISO, weekEnd: model.weekStrip.last?.dateISO)
                    )
                    hero()
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
        let cal = Self.utcCalendar
        let daysDiff = cal.dateComponents([.day], from: firstDate, to: selectedDate).day ?? 0
        let weeksOffset = Int(floor(Double(daysDiff) / 7.0))
        return model.weekStrip.map { d in
            guard let base = Self.iso.date(from: d.dateISO),
                  let moved = cal.date(byAdding: .day, value: weeksOffset * 7, to: base)
            else { return d.strip }
            let movedISO = Self.iso.string(from: moved)
            let number = String(cal.component(.day, from: moved))
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
                                  onCheckIn: { row in await checkInNiggle(row.id) },
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
                                onLogTrend: { row in await logSickTrend(row.action) },
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
                         onFlagNiggle: { part in await flagNiggle(part) },
                         onOpenInjuryFlare: { path.append(.injuryFlare) },
                         onChangeShoe: { path.append(.shoes) },
                         onPickShoe: { id in await pickShoe(model, id) },
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
                             await reportSick(sym, started, fever)
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
                              await reportSick(sym, started, fever)
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

    /// PLANSNAPSHOT-SINGLEFLIGHT-1 (2026-09-07) · the sync in progress, if
    /// any. `syncPlanSnapshot()` has FIVE independent callers (launch,
    /// foreground, explicit Retry, pull-to-refresh, a plan mutation) with no
    /// coordination between them, and the fetch itself is genuinely slow —
    /// confirmed live on David's own device via the request-log sheet:
    /// `/api/v5/plan-snapshot` taking 5.3s and 6.8s on ordinary production
    /// load, TWO of them in flight at once (generation 6, requests #64 and
    /// #67). Two overlapping requests for the same block do not answer any
    /// question the first one wasn't already going to answer — they only
    /// compete for the same DB connections and CPU, each making the other
    /// slower, on the one read every launch and foreground depends on. This
    /// is "timeout caused by request duplication," named as a distinct
    /// failure mode from a genuine outage or a stuck connection. Every
    /// caller now awaits the SAME in-flight task instead of starting a
    /// sibling: the first caller in a window does the real work, everyone
    /// else gets its answer for free.
    @State private var planSnapshotSyncTask: Task<Bool, Never>?

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
    ///
    /// RECAP-1 (2026-09-04) · a day the runner has already RUN is excluded
    /// too, same reasoning as the `isHome` guard one line up. David, live,
    /// on a past day showing its authored plan instead of what he actually
    /// did: "this is not post run display... its not showing what I did."
    /// `PlanSnapshotDay` carries authored STRUCTURE only, by design — see
    /// `PlanSnapshotDayView.swift`'s own header — so a `matched_run` day
    /// forces the SAME live `/api/v5/today?date=` fetch `isHome` already
    /// gets, which returns the real `after_run` narrative (splits, actual
    /// pace, HR zones, route, coach's read) through `TodayAfterV5` — the
    /// exact screen today's own completed run already renders correctly
    /// with. Verified directly against production: `date=2026-09-03`, a
    /// day with a matched run, returns `state: "after_run"` with the full
    /// recap payload — nothing to build here, only to stop bypassing it.
    /// A day with ONLY a supplemental run (no completion of the day's OWN
    /// prescription) still renders from the snapshot — `PlanSnapshotDayView`
    /// already surfaces a supplemental run in its own activity section, and
    /// a session nobody asked this day to run is not "what I did today"
    /// in the sense this fix is about.
    static func shouldRenderFromSnapshot(iso: String, isHome: Bool, snapshot: PlanSnapshot?) -> Bool {
        guard !isHome, let day = snapshot?.day(on: iso) else { return false }
        return day.matched_run == nil
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
    /// PLANSNAPSHOT-SINGLEFLIGHT-1 · the public entry point every caller
    /// hits. If a sync is already running, this AWAITS that one rather than
    /// starting a sibling — every caller still gets a real answer for THIS
    /// call, it just may not be the caller whose request actually went out.
    /// `@MainActor` (this whole type is) makes the check-then-store below
    /// atomic against the other four call sites without a lock: nothing
    /// else can run between reading `planSnapshotSyncTask` and setting it.
    @discardableResult
    func syncPlanSnapshot() async -> Bool {
        if let existing = planSnapshotSyncTask {
            return await existing.value
        }
        // No `await` between the check above and the store below — this
        // whole function runs on the main actor, so nothing else can
        // observe `planSnapshotSyncTask` as nil and race to create a
        // second task in the gap. That also means nothing else can ever
        // overwrite it with a DIFFERENT task before this one clears it:
        // the only writer is this function, and it only writes when it
        // found nil. Clearing unconditionally after our own await is safe.
        let task = Task { await performPlanSnapshotSync() }
        planSnapshotSyncTask = task
        let result = await task.value
        planSnapshotSyncTask = nil
        return result
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
    private func performPlanSnapshotSync() async -> Bool {
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

    /// WKSTRIP-UTC-1 (2026-09-07) · every `date_iso` this app carries
    /// (`plan_workouts.date_iso`, `races.meta->>'date'`, `weekStrip[].dateISO`)
    /// is a bare `yyyy-MM-dd` CALENDAR date, never an instant — there is no
    /// "time of day" for a training day to have a timezone opinion about.
    /// `Self.iso` already parses and formats every one of them as UTC
    /// midnight, purely as a fixed, arbitrary anchor for doing day
    /// arithmetic — the actual zone is notional. Any `Calendar` operation on
    /// a `Date` built from `Self.iso` MUST use this same anchor, or the
    /// illusion breaks: `Calendar.current` resolves to the DEVICE's real
    /// timezone, and reading a component (`.day`, `.weekday`, …) off a
    /// UTC-midnight instant through a negative-UTC-offset calendar (Pacific,
    /// every device this app ships to) lands on the PREVIOUS civil day.
    ///
    /// This is exactly what broke `snapshotWeekStripDays`: `moved` (built via
    /// `Calendar.current.date(byAdding:)`) still ROUND-TRIPPED correctly
    /// through `Self.iso.string(from:)` — landing back on the right date
    /// string — but `Calendar.current.component(.day, from: moved)`, read
    /// through Pacific, reported the PREVIOUS day's number: navigating to
    /// Monday the 14th correctly opened the 14th's own content (via the
    /// correct `dateISO` string) while the strip pill under it displayed
    /// "13" — the number and the day it was labelling had silently
    /// diverged. Not a timezone edge case; it fires this way for any device
    /// west of UTC, every single navigation through this path, which is why
    /// it reproduced immediately and did not depend on DST or a month/year
    /// boundary to show up.
    ///
    /// `weekStripDays(for:)`'s own ghost-week fallback already got this
    /// right with its own local `cal` — this hoists that SAME pattern to one
    /// shared instance rather than leaving a second copy to drift, and
    /// `snapshotWeekStripDays` now uses it for every Calendar call, not just
    /// the ones that happened to still work by luck.
    private static let utcCalendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
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

    /// The training calendar. The current week is built from the week strip
    /// the Today payload already carries, so the sheet and the strip can
    /// never disagree about it.
    ///
    /// CALCELLWEEK-1 (2026-09-07) · every OTHER week now comes from
    /// `blockSurface.model?.weeks`, which is the whole block, not just seven
    /// days. Before this, `calendarWeeks` returned exactly one week no
    /// matter how far into a fifteen-week block the runner was — the sheet's
    /// own multi-week scaffold (the `ForEach`, the "opens on this week, not
    /// the top of the block" scroll behaviour) had nothing but that one week
    /// to ever show. David: "I can't select a specific day in any of the
    /// future weeks." The block's own `V5BlockDay.dateISO`/`type`/`isDone`
    /// fields were added 2026-08-20 for exactly this purpose and never
    /// wired up on this side — see that field's own comment in APIV5.swift.
    private func calendarWeeks(_ model: V5Today) -> [TodayCalendarWeek] {
        guard !model.weekStrip.isEmpty else { return [] }
        // SKIPCAL-1 (2026-09-08) · THE CURRENT WEEK'S SKIPS COME FROM THE
        // BLOCK, NOT FROM THE STRIP.
        //
        // `/api/v5/today`'s `weekStrip` carries no skip field, and adding one
        // is a wire change deliberately out of this fix's scope. But the block
        // payload already knows: it carries EVERY week including the current
        // one, and only `!isCurrent` filtering below keeps its copy of this
        // week off the screen. So the fact is in hand — it just needs joining
        // by date, which `V5WeekStripDay.dateISO` and `V5BlockDay.dateISO`
        // both carry.
        //
        // Without this the fix would answer "what did I miss" for every week
        // EXCEPT the one the question is usually about.
        let skippedDates: Set<String> = Set(
            (blockSurface.model?.weeks ?? [])
                .flatMap(\.days)
                .filter(\.isSkipped)
                .compactMap(\.dateISO))
        let current = TodayCalendarWeek(
            id: "current",
            range: model.panel.weekLine ?? "This week",
            days: model.weekStrip.map { d in
                TodayCalendarDay(id: d.id,
                                 label: "\(d.letter) \(d.number)",
                                 sub: d.isRest ? "Rest day" : d.dayState.capitalized,
                                 status: TodayCalendarDay.status(
                                    isToday: d.isToday,
                                    isDone: d.isDone,
                                    skipped: skippedDates.contains(d.dateISO)),
                                 isToday: d.isToday)
            }
        )
        // `isCurrent` skips the block's own copy of the current week — the
        // strip above is the authority for it, and showing both would be the
        // same week listed twice with two different day-label conventions.
        let others = (blockSurface.model?.weeks ?? [])
            .filter { !$0.isCurrent }
            .map { w in
                TodayCalendarWeek(
                    id: w.id,
                    range: w.flag == w.label ? w.label : "\(w.label) · \(w.flag)",
                    sub: w.miles.text,
                    days: w.days.map { d in
                        TodayCalendarDay(
                            id: d.id,
                            label: Self.calendarDayLabel(d.dateISO),
                            sub: d.type ?? (d.race ? "Race" : "Easy"),
                            status: TodayCalendarDay.status(isToday: d.isToday,
                                                            isDone: d.isDone == true,
                                                            skipped: d.isSkipped),
                            isToday: d.isToday,
                            dateISO: d.dateISO)
                    }
                )
            }
        return [current] + others
    }

    /// "M 7" from a `yyyy-MM-dd` string — the same single-letter-weekday +
    /// day-number shape the week strip's own `letter`/`number` pair draws,
    /// derived here because `V5BlockDay` (unlike `weekStrip`'s rows) carries
    /// only the raw date. Falls back to the date string itself on a parse
    /// failure rather than drawing a blank row.
    private static func calendarDayLabel(_ dateISO: String?) -> String {
        guard let dateISO, let date = Self.iso.date(from: dateISO) else { return dateISO ?? "" }
        let df = DateFormatter()
        df.dateFormat = "EEEEE d"
        df.timeZone = TimeZone(identifier: "UTC")
        return df.string(from: date)
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

    // ─────────────────────────────────────────────────────────────────────
    // TODAYWRITE-1 (2026-09-08 review) · EVERY WRITE BELOW RETURNS WHAT IT
    // SETTLED AS, AND ITS SCREEN IS OBLIGED TO SPEND THAT.
    //
    // All five used to end `_ = try? await API.authedSend(req)` followed by
    // an unconditional `await surface.load()`. Two consequences, both
    // measured on the real app by a Product Experience review:
    //
    //  1 · The outcome was DESTROYED at the call site, so the screen above
    //      had nothing to gate on and drew the confirmed-success copy from
    //      its own optimistic `@State` — "Left calf flagged · The coach has
    //      it, it shapes tomorrow" over a database that recorded no rows.
    //
    //  2 · The reload ran even when nothing had changed. A write that did
    //      not land changed nothing, so it invalidates nothing — the same
    //      reasoning `SettingsHostV5.applyWrite` already carries, and in an
    //      outage the extra GET is what turns a failed write into a blanked
    //      screen.
    //
    // See `V5WriteSettlement` in SurfaceStoreV5.swift for the full incident and
    // for why `.cancelled` is a third case rather than a failure.

    /// Persist the pair the runner picked from the shoe menu.
    ///
    /// `POST /api/today/shoe { date_iso, shoe_id }` is the same endpoint the
    /// Shoes screen already writes through, so a choice made here and a
    /// choice made there land in exactly one place.
    private func pickShoe(_ model: V5Today, _ shoeId: String) async -> V5WriteSettlement {
        var req = URLRequest(url: API.baseURL.appendingPathComponent("api/today/shoe"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(
            withJSONObject: ["date_iso": model.dateISO, "shoe_id": shoeId])
        // Reload rather than mutate locally: the row's mileage line changes
        // with the assignment, and a locally-patched label beside a stale
        // mileage is two numbers disagreeing about one shoe.
        return await settleAndReload { try await Self.ok(req) }
    }

    private func flagNiggle(_ bodyPart: String) async -> V5WriteSettlement {
        var req = URLRequest(url: API.baseURL.appendingPathComponent("api/niggle"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "body_part": bodyPart, "severity": 1, "status": "active",
        ])
        return await settleAndReload { try await Self.ok(req) }
    }

    /// The ladder's sibling: the daily flare check-in. The row ids are
    /// literally the values the endpoint expects, so there is no mapping to
    /// get wrong.
    private func checkInNiggle(_ today: String) async -> V5WriteSettlement {
        var req = URLRequest(url: API.baseURL.appendingPathComponent("api/niggle/recovery"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["today": today])
        return await settleAndReload { try await Self.ok(req) }
    }

    private func reportSick(_ symptoms: [String], _ started: String, _ hasFever: Bool) async -> V5WriteSettlement {
        await settleAndReload {
            try await API.postSick(symptoms: symptoms, started: started, fever: hasFever)
        }
    }

    /// The sick check-in is a TREND, not a one-shot note: "recovered" clears
    /// the episode server-side, which the injury flow has no equivalent of.
    private func logSickTrend(_ action: String?) async -> V5WriteSettlement {
        let trend: String
        switch action {
        case "trend_better":    trend = "better"
        case "trend_same":      trend = "same"
        case "trend_worse":     trend = "worse"
        case "trend_recovered": trend = "recovered"
        // An action this host does not recognise never reached the network,
        // so there is nothing to retry and nothing to confirm. Rule 11: this
        // is "we did not ask", which is closest to a torn-down request — NOT
        // `.landed`, which would be the fabrication this whole change exists
        // to stop, and not `.didNotLand`, which would offer a Retry that
        // could only ever do the same nothing again.
        default: return .cancelled
        }
        return await settleAndReload { try await API.postSickRecovery(trend: trend) }
    }

    /// `API.authedSend` returns a 500 rather than throwing, so "the call came
    /// back" is not "the server took it". One place says what 2xx means, so
    /// no call site can forget to ask.
    private static func ok(_ req: URLRequest) async throws -> Bool {
        let (_, http) = try await API.authedSend(req)
        return (200..<300).contains(http.statusCode)
    }

    /// Settle the write, and refetch ONLY if the server actually changed.
    private func settleAndReload(_ write: () async throws -> Bool) async -> V5WriteSettlement {
        let outcome = await v5SettleWrite(write)
        if outcome == .landed { await surface.load() }
        return outcome
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
                                          onRetry: { Task { await API.resetConnectionPool(); await surface.load() } })
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
                    OutageBodyV5(copy: .block, onRetry: { Task { await API.resetConnectionPool(); await surface.load() } })
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
        // REQUESTSTORM-2 (2026-09-06) · this modifier removed. It called
        // `surface.load()` on foreground, throttled only against itself —
        // but `V5Surface`'s own `.faffForegroundRefresh` observer already
        // reloads this surface once per real foreground (throttled in
        // SurfaceStoreV5.swift), so this was a fully redundant third
        // trigger for the identical reload. See
        // `ForegroundWork.shouldLoadOnForeground`'s doc comment for the
        // incident this closes.
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
                                              onRetry: { Task { await API.resetConnectionPool(); await surface.load() } })
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
                        OutageBodyV5(copy: .races, onRetry: { Task { await API.resetConnectionPool(); await surface.load() } })
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
            // REQUESTSTORM-2 (2026-09-06) · `.v5ReloadOnForeground { await
            // surface.load() }` removed from here. It was a fully redundant
            // third trigger for the same reload `V5Surface`'s own
            // `.faffForegroundRefresh` observer already fires once per real
            // foreground — see `ForegroundWork.shouldLoadOnForeground`'s doc
            // comment for the incident this closes.
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
                    OutageBodyV5(copy: .raceDetail, onRetry: { Task { await API.resetConnectionPool(); await surface.load() } })
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
                    OutageBodyV5(copy: .paces, onRetry: { Task { await API.resetConnectionPool(); await surface.load() } })
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
                    OutageBodyV5(copy: .returnLadder, onRetry: { Task { await API.resetConnectionPool(); await surface.load() } })
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

/// SETTINGSFAIL-1 (2026-09-07) · what `SettingsHostV5.load()` can tell went
/// wrong, each with its own sentence. Before this, every one of `load()`'s
/// four network calls was wrapped in `try?` and fell back to a hardcoded
/// default (`?? "sun"`, `?? 5`, `?? true`, `?? "mi"`, `?? ""`) — so on a total
/// backend outage the skeleton simply cleared into FABRICATED settings with
/// no error and no way to retry, because `model` was never left nil. David's
/// own requirement: "preserving the actual error category... Do not swallow
/// the error or replace every failure with 'Can't reach faff.'" — so this is
/// a category per shape of failure, not one flat string.
enum SettingsLoadFailure: Equatable, Sendable {
    case offline
    case timeout
    case unauthorized
    case serverError(Int)
    /// SETTINGSCANCEL-1 (2026-09-07 review) · WE STOPPED ASKING. NOT A FAULT.
    ///
    /// A superseded load — a second Retry tap, a write's own reload landing
    /// over an earlier one, the screen going away — cancels the first task,
    /// and a cancelled `URLSession` request throws `URLError.cancelled`.
    /// `categorize` had no branch for it, so it fell through to the
    /// `.offline` catch-all and a healthy connection was reported to the
    /// runner as a dead one. `load()` no longer writes ANY state from a
    /// cancelled task (see `application(for:isCancelled:)`), so this should
    /// never reach a screen — but a categorizer that silently mislabels its
    /// input is a Rule 11 collapse whether or not anyone is looking, and
    /// something else may call it directly tomorrow.
    case cancelled
    /// A 2xx response we could not make sense of (decode failure, or a
    /// transport error this app has no more specific code for).
    case unknown

    var message: String {
        switch self {
        case .offline:
            return "Can't reach faff. Check your connection and try again."
        case .timeout:
            return "faff is taking too long to respond. Try again."
        case .unauthorized:
            return "Your session has expired. Sign in again to see your settings."
        case .serverError(let code):
            return "faff hit an error (\(code)) reading your settings. Try again."
        case .cancelled:
            return "That read was cancelled before it finished. Try again."
        case .unknown:
            return "Settings did not load. Try again."
        }
    }

    /// SETTINGSPARTIAL-1 · the same fact, said as a clause rather than a
    /// whole screen. The partial banner already carries "Some settings did
    /// not load"; this adds only the cause, so the runner reads the reason
    /// once (Rule 17) instead of the word "settings" three times.
    var shortCause: String {
        switch self {
        case .offline:
            return "Check your connection and try again."
        case .timeout:
            return "faff took too long to respond. Try again."
        case .unauthorized:
            return "Your session has expired. Sign in again."
        case .serverError(let code):
            return "faff hit an error (\(code)). Try again."
        case .cancelled:
            return "That read was cancelled. Try again."
        case .unknown:
            return "Try again."
        }
    }

    /// Transport-level codes that mean "we never reached faff at all," as
    /// opposed to a request that connected and then either hung
    /// (`.timedOut`, its own case below) or was refused with a real status.
    private static let offlineCodes: Set<URLError.Code> = [
        .notConnectedToInternet, .networkConnectionLost, .cannotConnectToHost,
        .cannotFindHost, .dataNotAllowed, .internationalRoamingOff, .dnsLookupFailed,
    ]

    static func categorize(_ error: Error) -> SettingsLoadFailure {
        if error is APIAuthError { return .unauthorized }
        if error is CancellationError { return .cancelled }
        if let urlError = error as? URLError {
            // SETTINGSCANCEL-1 · order matters. `.cancelled` and `.timedOut`
            // are both "the request did not finish", and only one of them is
            // a statement about faff being slow. Neither is a statement about
            // the connection, which is what the `.offline` fallback below
            // asserts.
            if urlError.code == .cancelled { return .cancelled }
            if urlError.code == .timedOut { return .timeout }
            if offlineCodes.contains(urlError.code) { return .offline }
            return .offline
        }
        if let apiError = error as? API.APIError, case .badStatus(let code) = apiError {
            return code == 401 ? .unauthorized : .serverError(code)
        }
        return .unknown
    }
}

/// SETTINGSPARTIAL-1 (2026-09-07 review) · WHICH SOURCE ANSWERED, PER SOURCE.
///
/// The failure gate this replaces fired only when `settings == nil AND
/// profile == nil`. With ONE of `/api/profile` or `/api/settings` down and
/// the other healthy, the screen rendered a completely normal, confident
/// Settings page — with the failed endpoint's fields silently defaulted
/// (`?? "sun"`, `?? "mi"`, `?? true`) or blank (Email). For a runner whose
/// real values happen to match those defaults it is invisible; for a runner
/// on kilometres, or a Saturday long run, the screen states the WRONG
/// setting in the same ink it states a real one. That is the fabrication the
/// whole fix exists to remove, and a partial outage is the likelier shape of
/// it than a total one.
///
/// So the screen has three cases, not two: whole, partial, and nothing. This
/// carries the middle one. A source is recorded here ONLY when it both failed
/// and left us with no value — a source that is simply empty (the runner has
/// no row yet) is not a failure, and a source we already hold a value for is
/// not missing. Rule 11: "don't know", "measured zero" and "the read failed"
/// are three facts.
struct SettingsSourceHealth: Equatable, Sendable {
    /// `/api/settings` — long run day, distance units, phone-run switch.
    var settings: SettingsLoadFailure?
    /// `/api/profile` — days per week, email.
    var profile: SettingsLoadFailure?
    /// `/api/notification-prefs` — the two notification switches.
    var prefs: SettingsLoadFailure?

    static let healthy = SettingsSourceHealth()

    var isWhole: Bool { settings == nil && profile == nil && prefs == nil }

    /// The one sentence the partial banner shows. Nil when nothing failed.
    /// It does NOT enumerate the affected rows: those rows say "Unavailable"
    /// themselves, and saying it in both places is Rule 17's exact defect.
    var partialMessage: String? {
        guard let worst = settings ?? profile ?? prefs else { return nil }
        return "Some of your settings did not load. \(worst.shortCause)"
    }
}

struct SettingsHostV5: View {
    /// V5PROPOSALSURFACE-1 · so Settings can push the decision history. Every
    /// other pushed destination in this app is reached the same way, through
    /// the shell's own stack rather than a nested navigation.
    @Binding var path: [V5Route]
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var runGate: PhoneRunGate
    @State private var stravaConnecting = false
    @State private var model: SettingsV5Model?
    /// SETTINGSFAIL-1 · non-nil only when `model` is ALSO nil — a load that
    /// fails after we already have a good model leaves the runner looking at
    /// what they had (same posture the rest of this app takes: old content
    /// is not wrong, it is old — see `SurfaceStoreV5.swift`'s header). This is
    /// the true cold-start-with-no-answer case: we do not know this runner's
    /// settings at all.
    @State private var loadFailure: SettingsLoadFailure?
    /// SETTINGSDEDUP-1 · `patch`/`setPref`/`connectStrava`/`patchProfile` all
    /// end in `await load()`, and a runner can tap a second control before
    /// the first write's reload lands. Without this, both reloads ran their
    /// own independent `fetchNotificationPrefs`/`fetchProfileState` calls in
    /// parallel with no coalescing (unlike settings/profile, which
    /// `SettingsCache`'s own `inflightSettings`/`inflightProfile` already
    /// dedupe). Cancelling the superseded task rather than letting both run
    /// is strictly better than coalescing here: the superseded read's answer
    /// would have been stale the instant the newer write landed anyway.
    @State private var loadTask: Task<Void, Never>?
    /// TRAVEL-1 · the travel-windows sheet, hosted here the way AddRaceHostV5
    /// hosts its own: a V5SheetHost over the screen, never a system sheet.
    @State private var travelOpen = false
    /// SETTINGSREVERT-1 · see `ServerTruth`. Every writer below settles into
    /// it, and `SettingsV5` watches its revision.
    @State private var truth = ServerTruth()

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
                               onOpenDecisions: { path.append(.decisions) },
                               onBack: { dismiss() },
                               // SETTINGSPARTIAL-1 · the partial banner's
                               // Retry, which is the SAME load the full
                               // failure state's Retry runs. One quantity,
                               // one name (Rule 16).
                               onRetry: { requestLoad() },
                               // SETTINGSREVERT-1 · the screen's cue to put
                               // an optimistic value back when the write it
                               // came from did not land. See `ServerTruth`.
                               serverTruthRevision: truth.revision)
                } else if let loadFailure {
                    // SETTINGSFAIL-1 · the third state. `ErrorNote` + Retry is
                    // the same treatment `TodayHostV5.pendingCard`'s `.failed`
                    // case already uses (HostsV5.swift ~338) — reused rather
                    // than invented, per this fix's own brief.
                    ScrollView {
                        VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                            AppBar(title: "Settings", onBack: { dismiss() })
                            ErrorNote(text: loadFailure.message, onRetry: { requestLoad() })
                            // SETTINGSDIAG-1 (2026-09-07 review) · THE DOOR
                            // HAS TO EXIST ON THE SCREEN THAT NEEDS IT.
                            //
                            // Settings is the only way into the request
                            // diagnostics sheet, and the hidden seven-tap
                            // gesture lived on the version footer of the
                            // LOADED screen only. So a runner looking at
                            // "Can't reach faff" — the exact moment the
                            // request log is worth reading, and the exact
                            // moment a support conversation needs the build
                            // number — had no way to reach either. The same
                            // footer, on the failure state.
                            SettingsDiagnosticsFooter()
                        }
                        .padding(.horizontal, V5.S.gutter)
                        .v5PageWidth()
                    }
                    .background(V5.surfacePage)
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
        .task { await initialLoad() }
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

    /// SETTINGSFAIL-1 · what `performFetch()` came back with. A plain value
    /// type with no dependency on `self`, so it can run inside a
    /// `withTaskGroup` child task (`withDeadline` below) without capturing
    /// this View across the boundary.
    enum LoadOutcome: Equatable, Sendable {
        /// Whole OR partial. `health` says which — `.healthy` for whole, and
        /// otherwise the sources that failed, which the screen marks
        /// "Unavailable" instead of defaulting.
        case loaded(settings: UserSettings?, profile: ProfileFields?,
                    prefs: NotificationPrefs?, stravaConnected: Bool?,
                    health: SettingsSourceHealth)
        /// Nothing. We do not know this runner's settings at all.
        case failed(SettingsLoadFailure)
    }

    /// SETTINGSPARTIAL-1 · the whole/partial/nothing decision, as a pure
    /// function of what came back, so it can be walked case by case in a test
    /// instead of only through a live outage. Note what the discriminator is
    /// and is not: a source is FAILED when it has no value AND carries an
    /// error, not merely when its value is nil. A runner who genuinely has no
    /// settings row yet is not an outage, and the server's own defaults are
    /// the right answer for them.
    static func classify(settings: UserSettings?, settingsError: Error?,
                         profile: ProfileFields?, profileError: Error?,
                         prefs: NotificationPrefs?, prefsError: Error?,
                         stravaConnected: Bool?) -> LoadOutcome {
        func failure<T>(_ value: T?, _ error: Error?) -> SettingsLoadFailure? {
            guard value == nil, let error else { return nil }
            return SettingsLoadFailure.categorize(error)
        }
        let settingsFailure = failure(settings, settingsError)
        let profileFailure = failure(profile, profileError)

        // Both of the two sources that describe WHO THIS RUNNER IS are gone.
        // There is no screen to draw around, so this is the full failure
        // state, unchanged from before.
        //
        // SETTINGSCLASSIFY-1 (2026-09-07 review) · ONE CAUSE IS STATED, AND
        // IT IS ALWAYS SETTINGS'. An earlier version of this comment claimed
        // "the two categories agree in every outage shape observed", which
        // overclaims: a staggered double failure (`/api/settings` 503 at
        // once, `/api/profile` 500 after a delay) leaves the two carrying
        // different statuses, and the screen then states 503 and never
        // mentions the 500. That is a deliberate choice, not an accident —
        // the runner reads one cause once (Rule 17), and this screen is named
        // for settings — but it IS a choice, and the line below is where it
        // is made. The unstated category is still readable in the request
        // diagnostics the failure state now hosts.
        if let settingsFailure, profileFailure != nil {
            return .failed(settingsFailure)
        }

        let health = SettingsSourceHealth(
            settings: settingsFailure,
            profile: profileFailure,
            prefs: failure(prefs, prefsError)
        )
        return .loaded(settings: settings, profile: profile, prefs: prefs,
                       stravaConnected: stravaConnected, health: health)
    }

    /// Wraps a throwing async call so its error survives instead of being
    /// dropped by `try?` — Rule 11: don't-know, measured-zero and read-failed
    /// are three facts, never collapsed into one. `op` itself already returns
    /// an optional (every `API.fetch*` here does, for "no data" vs "some
    /// data"), so this is generic over the UNWRAPPED type — declaring it
    /// `T` instead would produce a `T??` in `.value` for every caller here.
    private static func fetchOutcome<T>(_ op: @escaping () async throws -> T?) async -> (value: T?, error: Error?) {
        do { return (try await op(), nil) } catch { return (nil, error) }
    }

    /// LOADDEADLINE-1 (2026-09-07) · races `operation` against `seconds` and
    /// returns nil if the deadline elapses first, cancelling `operation` so
    /// it does not keep running unobserved. `API.authedSend` already bounds
    /// EVERY individual request to 12s (`TIMEOUT-1`), but this host used to
    /// run its calls in strict sequence — `warm()` (up to 12s), then
    /// `fetchNotificationPrefs` (up to 12s), then `fetchProfileState` (up to
    /// 12s) — up to ~36s before a single terminal state, on a screen with no
    /// failure state to reach one at all. `performFetch()` below now runs
    /// every leg CONCURRENTLY (~12s worst case), which is the actual fix;
    /// this deadline is the backstop for anything that still manages to hang
    /// past that, so `load()` can never leave the runner on the skeleton
    /// indefinitely.
    private static func withDeadline<T: Sendable>(seconds: Double, _ operation: @escaping @Sendable () async -> T) async -> T? {
        await withTaskGroup(of: Optional<T>.self) { group in
            group.addTask { await operation() }
            group.addTask {
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    /// Every network call `load()` needs, run concurrently. Static — takes
    /// nothing from `self` — so `withDeadline` can run it in a detached child
    /// task; `load()` applies the result to `@State` afterward.
    private static func performFetch() async -> LoadOutcome {
        async let warmed: Void = SettingsCache.shared.warm()
        // THE SCHEDULER READS profile.notification_prefs, NOT settings.
        // These two switches wrote `push_enabled` (which no notification
        // category consults) and `weekly_summary_enabled` (which the
        // settings route's allowlist drops on the floor), and the screen
        // showed the weekly one as ON no matter what. Both now read and
        // write the jsonb the cron actually gates on.
        async let prefsOutcome = fetchOutcome { try await API.fetchNotificationPrefs() }
        // Re-mirror the wire's own answer at the moment this screen draws it.
        // `FaffV5Root` writes it at launch; this keeps the row honest for a
        // session in which the connection changed (an OAuth round-trip, or a
        // disconnect made on the web) without waiting for a relaunch. Same
        // authority, same field — never a second source of truth.
        async let profileStateOutcome = fetchOutcome { try await API.fetchProfileState() }

        _ = await warmed
        let prefs = await prefsOutcome
        let profileState = await profileStateOutcome
        let (settings, profile) = await SettingsCache.shared.read()
        let (settingsErr, profileErr) = await SettingsCache.shared.lastErrors()

        // SETTINGSPARTIAL-1 · `classify` owns the whole/partial/nothing
        // decision — see its own doc comment for why a nil value is not by
        // itself a failure. `SettingsCache.lastErrors()` is what makes the
        // distinction available at all.
        //
        // The Strava mirror is deliberately NOT a health input. When
        // `/api/profile/state` fails, the row falls back to
        // `StravaConnection.isConnected`, which is a real value this session
        // read at launch — stale, possibly, but never fabricated. Rule 11's
        // distinction cuts the other way there: a known-old fact is not a
        // failed read.
        return classify(settings: settings, settingsError: settingsErr,
                        profile: profile, profileError: profileErr,
                        prefs: prefs.value, prefsError: prefs.error,
                        stravaConnected: profileState.value?.connections.strava.connected)
    }

    /// SETTINGSCANCEL-1 (2026-09-07 review) · A CANCELLED LOAD HAS NO ANSWER,
    /// AND MUST NOT WRITE ONE.
    ///
    /// The reproduced defect: put the screen in a `serverError(503)` state,
    /// then tap Retry twice about 250ms apart against a backend that takes
    /// ~6s to answer — well inside every timeout, and about to SUCCEED. The
    /// copy flipped to "faff is taking too long to respond" mid-reload before
    /// settling. A false statement to the runner: the connection was healthy
    /// the whole time.
    ///
    /// Two mechanisms, and this closes the first. `requestLoad()` cancels the
    /// in-flight load before starting the new one. Cancelling the parent task
    /// makes `withDeadline`'s sleeper child throw immediately, so the group
    /// hands back `nil` — indistinguishable, at the call site, from the 20s
    /// deadline actually elapsing — and `load()` wrote `.timeout` from it,
    /// unconditionally. The cancelled task then went on to stomp the state
    /// the LIVE load was about to fill in.
    ///
    /// The decision is a pure function of (outcome, cancelled) so a test can
    /// walk it without a live race: a cancelled task applies NOTHING,
    /// whatever it happens to be holding.
    ///
    /// SETTINGSEQ-1 (2026-09-07 review) · THE EQUALITY COMPARES THE PAYLOAD.
    /// This conformance was hand-written and its `.apply` arm read
    /// `case (.apply, .apply): return true` — any two applications were
    /// equal, whatever model they carried, so
    /// `XCTAssertEqual(application(...), .apply(expected))` would have passed
    /// against the WRONG settings. An assertion that cannot distinguish its
    /// own subject is Rule 18's exact defect. It is synthesized now, all the
    /// way down: `LoadOutcome`, `UserSettings`, `ProfileFields` and
    /// `FlexibleDouble` gained `Equatable` so the compiler writes the
    /// comparison field by field and no future case can be silently dropped
    /// from it.
    enum LoadApplication: Equatable {
        /// Cancelled. Leave every piece of state exactly as it is.
        case ignore
        /// Terminal failure. The caller still refuses to blank a screen that
        /// already has content.
        case fail(SettingsLoadFailure)
        case apply(LoadOutcome)
    }

    static func application(for outcome: LoadOutcome?, isCancelled: Bool) -> LoadApplication {
        if isCancelled { return .ignore }
        guard let outcome else {
            // LOADDEADLINE-1 · the composite backstop elapsed with nothing
            // back at all. Only reachable now that cancellation is excluded
            // above, which is what makes `.timeout` an honest reading of it.
            return .fail(.timeout)
        }
        switch outcome {
        case .failed(let reason): return .fail(reason)
        case .loaded: return .apply(outcome)
        }
    }

    /// SETTINGSDEDUP-1 · cancel any load already in flight (a superseded
    /// write's own `await load()`, or a runner's tap on Retry) rather than
    /// letting two independent fetches of the same endpoints run at once.
    private func requestLoad() {
        loadTask?.cancel()
        loadTask = Task { await load() }
    }

    /// SETTINGSCANCEL-1 · the FIRST load goes through the same single-flight
    /// slot every other caller uses. `.task { await load() }` bypassed
    /// `requestLoad()` entirely, so a Retry or a write's reload arriving
    /// during the opening load raced it instead of superseding it — the
    /// dedup guarantee the host claims in `loadTask`'s doc comment simply did
    /// not cover the one load that always happens. `withTaskCancellationHandler`
    /// keeps `.task`'s own cancel-on-disappear working through the extra hop.
    private func initialLoad() async {
        loadTask?.cancel()
        let task = Task { await load() }
        loadTask = task
        await withTaskCancellationHandler {
            await task.value
        } onCancel: {
            task.cancel()
        }
    }

    private func load() async {
        let outcome = await Self.withDeadline(seconds: 20, { await Self.performFetch() })
        switch Self.application(for: outcome, isCancelled: Task.isCancelled) {
        case .ignore:
            // SETTINGSCANCEL-1 · superseded. The load that replaced this one
            // owns the state now; writing anything here is a guess presented
            // as a reading.
            return
        case .fail(let reason):
            // SETTINGSFAIL-1 · never blank a screen that already has good
            // content — see `loadFailure`'s own doc comment.
            if model == nil { loadFailure = reason }
        case .apply(let outcome):
            guard case .loaded(let settings, let profile, let prefs,
                               let stravaConnected, let health) = outcome else { return }
            if let stravaConnected { StravaConnection.set(stravaConnected) }
            loadFailure = nil
            model = SettingsV5Model(
                // SETTINGSPARTIAL-1 · every `??` below is the server's own
                // default for a runner who has no stored value, and it is the
                // right answer for exactly that runner. It is the wrong
                // answer for a runner whose value we FAILED to read, which is
                // why `health` travels with the model: the rows behind a
                // failed source render as unavailable rather than taking one
                // of these. Seeding them here regardless keeps the model
                // total, and nothing draws a defaulted value once its source
                // is marked.
                longRunDay: Self.dayLabel(settings?.long_run_day ?? "sun"),
                longRunDayOptions: Self.dayNames.map(\.label),
                daysPerWeek: profile?.weekly_frequency ?? 5,
                phoneRunEnabled: settings?.phoneRunEnabled ?? true,
                sessionReminders: prefs?.skip_recovery_enabled ?? true,
                weeklySummary: prefs?.weekly_checkin_enabled ?? true,
                units: Self.unitLabel(settings?.units_distance ?? "mi"),
                unitsOptions: Self.unitNames.map(\.label),
                stravaConnected: StravaConnection.isConnected,
                email: profile?.email ?? "",
                health: health
            )
        }
    }

    private func setPref(_ key: String, _ value: Bool) async {
        // SETTINGSREVERT-1 · THIS LINE USED TO BE `_ = await ...`.
        //
        // `patchNotificationPref` already answers "did it land" (it returns
        // whether the response was 2xx) and the answer was dropped on the
        // floor. These two switches take the SAME shape of defect as the
        // settings writers, by a different route: prefs are never cached, so
        // a failed PATCH is followed by a healthy GET that returns the value
        // from BEFORE the toggle — an identical model, an `onChange` that
        // does not fire, and a switch left standing where the runner put it.
        // No cache to invalidate here, which is exactly why `settlement` is
        // stated about the server rather than about the cache.
        truth.settle(Self.settlement(landed: await API.patchNotificationPref(key: key, value: value)))
        // SETTINGSDEDUP-1 · `requestLoad()`, not `await load()` — see its own
        // doc comment. Two of these firing back-to-back (a fast double-tap
        // across two switches) used to run two independent, uncoordinated
        // `fetchNotificationPrefs`/`fetchProfileState` reads; this cancels
        // the superseded one instead.
        requestLoad()
    }

    /// SETTINGSWRITE-1 (2026-09-07 review) · A WRITE THAT DID NOT LAND
    /// CHANGED NOTHING, SO IT INVALIDATES NOTHING.
    ///
    /// The reproduced sequence: a healthy load puts a value the screen has
    /// actually READ on screen (on the review substrate, "Distance ·
    /// Kilometres"). `/api/settings` then goes down.
    /// The runner toggles a switch, the PATCH 503s, and the throw is
    /// swallowed by `try?` — after which `invalidate()` wiped the good cached
    /// copy, the reload's GET 503d too, and the row the runner was looking at
    /// ONE SECOND EARLIER flipped from "Kilometres" to "Unavailable", as did
    /// the switch they had just touched.
    ///
    /// That contradicts this file's own posture two hundred lines up
    /// (`loadFailure`: "old content is not wrong, it is old"), which the FULL
    /// failure path honours and this PARTIAL path did not. The cached copy is
    /// stale only when the server actually changed; a write that threw
    /// changed nothing, so what we hold is still the truth and keeping it is
    /// the honest answer, not a fallback.
    ///
    /// The sequence lives here, as one function both writers call, so a test
    /// can walk it with a stand-in cache instead of a live outage — and so
    /// neither writer carries its own copy of the ordering (Rule 16).
    ///
    /// What it does NOT do: tell the runner the write failed. The screen
    /// reverts to the server's value and says nothing about why. A silent
    /// revert beats a silent lie, and beats a wiped screen; saying it out
    /// loud is still open.
    ///
    /// SETTINGSREVERT-1 (2026-09-08 review) · AND THAT REVERT HAD TO BE MADE
    /// TRUE AGAIN. This comment used to assert it as a standing fact, and for
    /// the "write fails, reads keep succeeding" case it was FALSE — precisely
    /// BECAUSE of the fix above. Keeping the cached copy means the reload
    /// rebuilds an identical model, and `SettingsV5`'s correction rode on
    /// `.onChange(of: model)`, which is equality-gated and therefore never
    /// fired. Two individually-correct fixes with a gap between them: the
    /// toggle stayed where the runner put it, the server still held the old
    /// value, and the tab bar (reading the same setting through
    /// `PhoneRunGate`) contradicted the switch in the same frame.
    ///
    /// So the outcome is now RETURNED rather than swallowed, and each writer
    /// is obliged to do something with it. See `WriteSettlement`.
    @discardableResult
    static func applyWrite(write: () async -> Bool,
                           invalidate: () async -> Void) async -> WriteSettlement {
        let settlement = Self.settlement(landed: await write())
        if settlement == .serverChanged { await invalidate() }
        return settlement
    }

    /// SETTINGSREVERT-1 · WHAT A WRITE ATTEMPT LEAVES BEHIND.
    ///
    /// Stated as the fact about the SERVER, not as an instruction to the
    /// cache, because two different writers spend it two different ways:
    /// `patch`/`patchProfile` hold a `SettingsCache` copy to drop, and
    /// `setPref` holds none at all (notification prefs are fetched fresh
    /// every load). Both owe the screen the same thing on the failure side.
    enum WriteSettlement: Equatable {
        /// It landed. Whatever we were holding is now stale by definition,
        /// and the screen's optimistic value is about to be confirmed by the
        /// reload rather than contradicted by it.
        case serverChanged
        /// It did not land — or we could not tell. `landed(_:)` below treats
        /// "the write call threw" as the one signal it has, and a throw
        /// covers two different facts: the server genuinely refused (its
        /// value truly is what we cached), and a transport failure where the
        /// request may have reached the server but its response never came
        /// back (the server's value is UNKNOWN, not confirmed unchanged).
        /// Restating the held value is the correct correction for the first
        /// case and an argued, accepted risk for the second: a review of
        /// this fix (2026-09-08) measured a landed write whose response was
        /// lost, and the screen held the stale pre-write value indefinitely
        /// (no self-heal short of another successful write or an app
        /// restart) rather than the true, already-saved one. Splitting this
        /// into a real three-state settlement (landed / refused / unknown)
        /// would close that gap; whether to show the optimistic value or the
        /// last-confirmed one in the unknown case is a product call, not
        /// something to decide silently here.
        case serverUnchanged
    }

    /// The whole decision, as a pure function, so a test can walk both sides
    /// without a live outage.
    static func settlement(landed: Bool) -> WriteSettlement {
        landed ? .serverChanged : .serverUnchanged
    }

    /// SETTINGSREVERT-1 · the host's running count of how many times it has
    /// had to tell the screen "what you are showing was never saved."
    ///
    /// The counter exists because the screen's correction is equality-gated
    /// and the model does NOT move in this case — see `applyWrite` above. Its
    /// value carries no meaning; only that it moved. `&+=` because a runner
    /// who somehow reaches `Int.max` failed writes deserves a wrapped counter
    /// rather than a crash.
    struct ServerTruth: Equatable {
        private(set) var revision = 0
        mutating func settle(_ settlement: WriteSettlement) {
            guard settlement == .serverUnchanged else { return }
            revision &+= 1
        }
    }

    // A known, accepted consequence of restating one mirror as a single unit
    // (2026-09-08 review, F2): a `.serverUnchanged` settlement restates every
    // field in `SettingsMirror`, not just the one whose write failed. A
    // second field with its OWN write concurrently in flight can be visibly
    // reverted and then correctly restored moments later when that write's
    // own reload lands — a transient flicker on a field that did not fail.
    // The single-comparison design is otherwise the right shape; this is its
    // known cost, not a bug to chase.

    /// True when the write actually landed. `patchSettings`/`updateProfile`
    /// both THROW on any non-2xx, and their `Bool` return is `replanned` —
    /// not success — so "did not throw" is the only success signal there is.
    private static func landed(_ write: () async throws -> Bool) async -> Bool {
        do { _ = try await write(); return true } catch { return false }
    }

    private func patch(_ fields: [String: Any]) async {
        // SETTINGSREVERT-1 · `long_run_day`, `units_distance` and
        // `phone_run_enabled` all come through here, and the first of those
        // is the day the training week ends. A runner who believes they moved
        // their long run to Saturday, on a server that still says Sunday,
        // gets a plan shaped against a week they think they changed.
        truth.settle(await Self.applyWrite(
            write: { await Self.landed { try await API.patchSettings(fields) } },
            invalidate: { await SettingsCache.shared.invalidate() }))
        await runGate.refresh()
        requestLoad()
    }

    private func connectStrava() async {
        guard !stravaConnecting else { return }
        stravaConnecting = true
        _ = await StravaOAuthSession.shared.start()
        stravaConnecting = false
        requestLoad()
    }

    private func patchProfile(_ fields: [String: Any]) async {
        // SETTINGSWRITE-1 · same sequence, same reason — see `applyWrite`.
        // SETTINGSREVERT-1 · and the same obligation. This one writes
        // `weekly_frequency`: how many times a week the engine writes a run.
        truth.settle(await Self.applyWrite(
            write: { await Self.landed { try await API.updateProfile(fields) } },
            invalidate: { await SettingsCache.shared.invalidate() }))
        requestLoad()
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
    @State private var selected: FaffTabV5 = FaffV5Root.launchTab

    /// DEBUG-only opening tab, the fourth sibling of `-faffToken`,
    /// `-faffHost` and `-faffRunDetail` in `FaffApp.swift`, and it exists for
    /// the same stated reason those three do: CLAUDE.md Rule 13 requires a
    /// runner-facing change to be verified by RENDERING it, and the tab bar is
    /// the only way onto Block or Races. Where a simulator cannot be driven by
    /// hand, verification either stopped at Today or reached for a temporary
    /// edit to this file — which is precisely the risk `-faffHost`'s own
    /// header says the launch-argument mechanism was introduced to remove.
    ///
    ///     xcrun simctl launch <udid> run.faff.app -faffTab block
    ///
    /// It selects a tab and nothing else: no data is substituted, no request
    /// is skipped, and the screen that draws is the real one against the real
    /// server. An unrecognised value opens Today, so a typo cannot produce a
    /// blank shell. Never compiled into a release build.
    static var launchTab: FaffTabV5 {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-faffTab"), i + 1 < args.count,
           let tab = FaffTabV5(rawValue: args[i + 1]) {
            return tab
        }
        #endif
        return .today
    }
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
                case .settings:             SettingsHostV5(path: path)
                case .decisions:            DecisionHistoryHostV5()
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
                    OutageBodyV5(copy: .tomorrow, onRetry: { Task { await API.resetConnectionPool(); await surface.load() } })
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

// MARK: - Decision history
//
// V5PROPOSALSURFACE-1. `GET /api/v5/decisions` speaks the v5 refusal shape, so
// this reads `V5Fetch` and keeps all three states apart end to end: `.ok` is
// the record (which may honestly be empty), `.failed` is the outage, and
// `.absent` cannot happen here because the route never refuses — a history has
// nothing to decline. It is mapped to the outage anyway rather than to an
// empty list, because a refusal this screen did not expect is a fact we do not
// understand, and Rule 11 says do not spend it as "nothing".

struct DecisionHistoryHostV5: View {
    @Environment(\.dismiss) private var dismiss
    @State private var state: DecisionHistoryV5.State = .loading
    /// ACCEPTVOICE-1 · the server's reason a take-back was declined. Kept
    /// apart from `state` because a refusal is an answer and an outage is
    /// not — see `DecisionHistoryV5.undoRefusal`.
    @State private var undoRefusal: String? = nil

    var body: some View {
        DecisionHistoryV5(state: state,
                          onBack: { dismiss() },
                          onRetry: { Task { await load() } },
                          onUndo: { d in Task { await undo(d) } },
                          undoRefusal: undoRefusal)
            .task { await load() }
            .navigationBarBackButtonHidden(true)
    }

    private func load() async {
        state = .loading
        undoRefusal = nil
        guard let fetched = try? await API.fetchDecisions() else {
            state = .failed
            return
        }
        switch fetched {
        case .ok(let env): state = .ready(env.decisions)
        case .absent, .failed: state = .failed
        }
    }

    /// V5UNDO-1 · put one accepted decision back, then re-read the record.
    ///
    /// The re-read is what moves the row from SETTLED back to STILL OPEN, so
    /// there is no local optimistic state to drift out of sync with the plan —
    /// the same posture `answerProposal` takes on Today.
    ///
    /// A refusal is NOT swallowed. `_ = try? await` would leave this screen
    /// exactly as it was and the runner would conclude the button does
    /// nothing, which is the shape this whole change exists to remove.
    ///
    /// ACCEPTVOICE-1 (2026-09-05) · AND A REFUSAL IS NOT AN OUTAGE EITHER.
    ///
    /// This used to test only `answered?.ok` and put everything else into
    /// `state = .failed`, which draws `OutageBodyV5` — "we could not reach
    /// your coach" — and replaces the whole loaded history. The 409 it was
    /// written for means the exact opposite: the coach answered, promptly and
    /// clearly, and said no because something else has moved this session
    /// since. `undoProposal` returns a tuple carrying `status` for precisely
    /// this, and the status was captured and never read.
    ///
    /// Three endings, three renderings now: a transport failure is the
    /// outage, a 409 keeps the record on screen under the reason, and any
    /// other non-2xx is the outage because we do not know what it was.
    private func undo(_ d: V5Decision) async {
        undoRefusal = nil
        let answered: (ok: Bool, status: Int)
        do {
            answered = try await API.undoProposal(id: d.id)
        } catch {
            state = .failed
            return
        }
        if answered.ok {
            await load()
            // The plan moved back, so the snapshot the week strip reads has
            // to move with it (PLANSNAPSHOT-1's named trigger).
            NotificationCenter.default.post(name: .faffPlanMutated, object: nil)
            // ACCEPTVOICE-1 · and TODAY has to hear about it too. Found by
            // walking this in the simulator: after a successful take-back the
            // decision was correctly STILL OPEN again on this screen, and
            // Today went on showing no decision at all until the runner
            // happened to pull to refresh. The proposal is pending again and
            // Today is where it is answered, so Today is the surface that
            // most needs to know. `load()` above only re-reads THIS screen.
            NotificationCenter.default.post(name: .faffForegroundRefresh, object: nil)
            return
        }
        if answered.status == 409 {
            // The one sentence the phone is allowed to write on the engine's
            // behalf, because the route answers 409 with machine text and
            // this is what 409 MEANS here — stated in `undoProposal`'s own
            // doc comment, which is the contract being honoured rather than
            // a reason being invented.
            undoRefusal = "Something else has moved this session since. "
                + "Taking it back now would write over that change."
            return
        }
        state = .failed
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
