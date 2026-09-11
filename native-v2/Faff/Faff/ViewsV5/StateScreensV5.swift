//
//  StateScreensV5.swift
//  faff.run iPhone · four Today variants where there is nothing to prescribe,
//  or nothing to read.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THESE FOUR ARE BUILT TOGETHER
//
//  13a (injury flare), 14a (week off) and 15a (off-season) are REFUSALS: the
//  engine read the runner's state and the honest answer is "no session
//  today", each for a different reason. 16a (data outage) is NOT a refusal —
//  it is the one screen where the engine could not read something at all.
//  Rule three exists specifically so these four are never drawn the same way:
//
//      13a, 14a   we read it, there is no session, here is why    CoachSay
//      15a        there is nothing honest to say yet              Silence
//      16a        we could not read this                          ErrorNote + Skeleton
//
//  Mixing these up tells the runner the app is broken when it is working
//  (ErrorNote on a refusal), or that it is working when it cannot see
//  (Silence or CoachSay standing in for an outage). Every screen below is
//  built to keep that boundary, not to look tidy.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE ONE, AS IT LANDS HERE
//
//  Every number on these four screens comes through `FaffValue` — a dose, a
//  stat-plate value, a row value — so a modelled number cannot reach the
//  screen without its amber tilde. None of the four states below asserts a
//  changed SESSION. The screen that did (17a, "changed overnight") was
//  deleted 2026-09-02 with the readiness triggers behind it.
//

import SwiftUI
import Foundation

// MARK: - Shared account sheet
//
// The account sheet's body — runner name, week line, and rows — was
// previously defined once inside `TodayBeforeV5` (the only screen wired to
// open it) and nowhere else: `InjuryFlareV5`, `WeekOffV5`, `OffSeasonV5` and
// `TodayAfterV5` all already exposed an `onOpenAccount` closure, but the host
// never passed anything but the `{}` default, so the account button on those
// screens did nothing. Defined once, here, so `TodayHostV5` can present ONE
// sheet for every place-screen branch that isn't `TodayBeforeV5` (which keeps
// its own, using this same struct) rather than a copy of the same list per
// screen.

struct AccountSheetBodyV5: View {
    let accountName: String
    let accountWeekLine: String
    let accountRows: [V5Row]
    @Binding var isOpen: Bool
    var onRowTap: (V5Row) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            HStack(alignment: .lastTextBaseline, spacing: V5.S.s12) {
                Text(accountName)
                    .font(.faffDisplay(20))
                    .textCase(.uppercase)
                    .tracking(20 * 0.02)
                    .foregroundStyle(V5.textPrimary)
                Spacer(minLength: V5.S.s12)
                Text(accountWeekLine)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
            }
            .padding(.horizontal, V5.S.s4)

            ListGroup {
                ForEach(accountRows) { row in
                    ListRow(label: row.label,
                            sub: row.sub,
                            value: row.value.optionalValue,
                            // Close the sheet FIRST, then hand the tap up, on
                            // a separate tick — a push that happens while the
                            // sheet is still presented lands behind it, and a
                            // push coalesced into the same update as the
                            // dismissal gets dropped. Both look identical on
                            // device: a dead row. See `TodayBeforeV5`, where
                            // this was worked out originally.
                            onTap: row.action != nil ? {
                                withAnimation(V5.Motion.sheet) { isOpen = false }
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                                    onRowTap(row)
                                }
                            } : nil)
                }
            }

            FaffButton("Close", variant: .secondary, size: .lg) {
                withAnimation(V5.Motion.sheet) { isOpen = false }
            }
        }
    }
}

// MARK: - Shared panel header
//
// "Today" + the account button, exactly as the prototype draws it on every
// place screen. Still local to this file — it is the row, not the disc, and
// the four state screens are its only callers. The disc itself comes from the
// kit (`HeaderDiscV5`), which is what stops the fifth copy of it from being
// written here. The fill is the only thing that differs between a quiet panel
// (13a/15a, `--text-primary` on `--material-control`) and a gradient one
// (14a/16a, white on `rgba(255,255,255,.2)`).

private struct PlaceHeaderRow: View {
    @Environment(\.v5PanelInk) private var panelInk
    var onOpenAccount: () -> Void = {}
    var fill: HeaderDiscV5.Fill = .quiet
    /// Placeholder initials — no v5 payload in this file carries the
    /// runner's name. The prototype's own sample data hardcodes "JR" the
    /// same way.
    var initials: String = "JR"

    var body: some View {
        HStack(alignment: .center, spacing: V5.S.s8) {
            Text("Today")
                .font(.faffDisplay(20))
                .textCase(.uppercase)
                .tracking(20 * 0.02)
                .foregroundStyle(fill.ink(panelInk))
            Spacer(minLength: V5.S.s8)
            HeaderDiscV5(glyph: .initials(initials),
                         label: "Account and settings",
                         fill: fill,
                         action: onOpenAccount)
        }
    }
}

// MARK: - Shared scaffolding

/// The scroll band every one of these four screens uses: full-bleed panel
/// first (it escapes the gutter itself), everything else padded to the
/// content band's own gutter. Matches `NotOnPhoneYetV5`'s shape in
/// `ShellV5.swift`, the other screen in this app with nothing to prescribe.
private struct StateScreenScaffold<Panel: View, Body: View>: View {
    /// INJURYCHECKIN-1 · WHEN A NOTE APPEARS BELOW THE FOLD, BRING IT UP.
    ///
    /// The check-in tile sits under a 44pt display panel, a coach line and a
    /// "What changed" group, so on an iPhone SE — and on a 17 Pro — the
    /// failure note and its Retry button rendered entirely off-screen, behind
    /// the tab bar. The runner tapped a check-in row, nothing visible
    /// happened, and the only thing that would have told them otherwise was a
    /// scroll they had no reason to know was needed.
    ///
    /// A descendant asks with `v5Reveal(_:)`; the enclosing
    /// `V5RevealingScroll` answers.
    ///
    /// INJURYCHECKIN-1 · AND THIS SCREEN MUST NOT ADD A SECOND SCROLL VIEW.
    ///
    /// On the Today path these screens are drawn inside
    /// `TodayHostV5.inSharedShell`, which is itself a `ScrollView`. So the
    /// page had TWO nested vertical scroll views, and the inner one never
    /// scrolled — it sized to its content and the outer one moved. Measured
    /// on device: the first cut of this fix put a `ScrollViewReader` here and
    /// it was a no-op, because `scrollTo` cannot reach a target that sits
    /// inside a nested scroll container. `nested` removes the inner one, which
    /// is both what makes the reveal work and one fewer competing gesture.
    ///
    /// It is set from the same flag as `suppressOwnHeader` because it is the
    /// same fact — "a host already draws the shell around this content" — and
    /// that host's shell is a ScrollView. One flag would be Rule 16; two names
    /// for one fact would be the same violation, so the callers pass one value
    /// to both and the coupling is stated here.
    var nested: Bool = false
    /// SCROLLCLOCK-1 (PanelV5.swift) · the SAME `PanelFill` `panel()` was
    /// built with. Only read in the `!nested` branch below, which owns the
    /// ScrollView the cap protects — the `nested` branch's host
    /// (`TodayHostV5.inSharedShell`) is responsible for its own.
    var panelFill: PanelFill
    /// SCROLLCLOCK-3 (2026-09-10) · THE STALE-BANNER EXTENSION POINT, BUILT
    /// SO THE ORDERING BUG CANNOT COME BACK.
    ///
    /// `DataOutageV5` and `RaceJustFinishedV5` default to `nested: false` and
    /// have no other option — neither type exposes a `suppressOwnHeader`
    /// parameter at all. `InjuryFlareV5`/`WeekOffV5`/`OffSeasonV5` DO, and
    /// every real Today host that draws them passes `suppressOwnHeader: true`
    /// — except `InjuryPreviewHostV5` ("See it in Injury", off Today, per
    /// `TODAYWRITE-1`'s own header above), which calls `InjuryFlareV5(model:
    /// injury, onCheckIn:)` with NO `suppressOwnHeader`, so it ALSO reaches
    /// `!nested` in a real, currently-shipping build — it just has no
    /// `.v5StaleBanner` wired onto it today, so the bug this section fixes
    /// has not yet fired there. All five screens used to call
    /// `.v5ScrollSafeTop(fill:)` directly on their own `ScrollView`, exactly
    /// the shape SCROLLCLOCK-2 fixed at every OTHER call site in the app: a
    /// cap composed as an ANCESTOR of wherever `.v5StaleBanner` might attach,
    /// instead of the OUTERMOST layer. `DataOutageV5`'s own header names it as
    /// the data-outage/stale-readiness screen, and `InjuryPreviewHostV5`
    /// already loads over the network and already branches on
    /// `surface.isOutage` — a "Can't reach faff" banner landing on either one
    /// later is exactly the kind of change nobody would think to re-read this
    /// file's history for.
    ///
    /// So the fix does not just correct today's shape — it removes the
    /// choice. This scaffold now owns BOTH modifiers and composes them in the
    /// one order that works, INTERNALLY, so no caller (today's five screens or
    /// a sixth one added later) can attach `.v5StaleBanner` externally and get
    /// the order backwards, the way `Races`/`Block`/`Today` originally did.
    /// `nil` — every current caller — means no banner, matching today's
    /// behaviour byte for byte; a future screen that needs one passes it here
    /// rather than composing `.v5StaleBanner` + `.v5ScrollSafeTop` at its own
    /// call site.
    struct StaleBannerWiring {
        let stale: Bool
        let cachedAt: Date?
        let onRetry: () -> Void
    }
    var staleBanner: StaleBannerWiring? = nil
    @ViewBuilder var panel: () -> Panel
    @ViewBuilder var content: () -> Body

    private var band: some View {
        VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
            panel().v5MeasureFullBleedPanel()
            content()
        }
        .padding(.horizontal, V5.S.gutter)
        .padding(.bottom, V5.S.s24)
        // A vertical page must never pan sideways — see `v5PageWidth`.
        .v5PageWidth()
    }

    var body: some View {
        if nested {
            band
        } else {
            V5RevealingScroll {
                ScrollView { band }
                    .background(V5.surfacePage)
                    .scrollIndicators(.hidden)
            }
            // SCROLLCLOCK-3 · `.v5StaleBanner` FIRST, `.v5ScrollSafeTop`
            // LAST, in the SAME chain, both owned by this scaffold rather
            // than left for a caller to compose. `.v5StaleBanner(stale:
            // false, ...)` is what every current caller gets (`staleBanner ==
            // nil`) — its `.safeAreaInset` reserves nothing when `stale` is
            // false, so this is a no-op byte-for-byte, the same way
            // `HostsV5.swift`'s Today/Block/Races hosts already call
            // `.v5StaleBanner` unconditionally and rely on it doing nothing
            // while not stale. `.v5ScrollSafeTop` then caps the status-bar
            // band with the same slice of `panel()`'s own gradient that shows
            // there at rest — attached OUTERMOST so no section in `content()`
            // below it, and no banner a future caller wires in through
            // `staleBanner`, can ever collide with the clock or fight the cap
            // for the same pixels. See `PanelV5.swift`'s SCROLLCLOCK-2 header
            // for why the order is load-bearing and `StaleBannerWiring`'s own
            // comment above for why it lives here now instead of at a host.
            .v5StaleBanner(stale: staleBanner?.stale ?? false,
                           cachedAt: staleBanner?.cachedAt,
                           onRetry: staleBanner?.onRetry ?? {})
            .v5ScrollSafeTop(fill: panelFill)
        }
    }
}

// MARK: - 13a · Injury flare
//
// A REFUSAL, not an outage: we read the flare and the answer is "not today".
// The panel carries no gradient — `.quiet` — because there is no session to
// prescribe, the same designed-absence the README gives off-season. The
// check-in list is the app's one expand-in-place interaction: tapping a row
// logs the note in that row's own expansion, never on a new screen.

struct InjuryFlareV5: View {
    let model: V5Injury
    var onOpenAccount: () -> Void = {}
    /// Fires when a check-in option is tapped, so the caller can write it
    /// back, and answers whether the server took it. This view does not
    /// fetch or persist anything itself.
    ///
    /// TODAYWRITE-1 (2026-09-08 review) · it used to be `-> Void`, and the
    /// note under the tile ("Logged.") was drawn from `checkedRowID`, set
    /// in the tap handler. So a `POST /api/niggle/recovery` that recorded
    /// nothing still read back as logged — the same fabrication measured on
    /// the niggle flag and the sick report. See `V5WriteSettlement`.
    /// TODAYWRITE-2 · THE DEFAULT IS `.cancelled`, AND THAT IS THE POINT.
    ///
    /// It was `{ _ in .landed }`. Every screen that forgot to pass a handler
    /// therefore FABRICATED a server success: tap a row, get "Logged.", zero
    /// network traffic. `InjuryPreviewHostV5` was exactly that call site, and
    /// it is reachable by a real runner ("See it in Injury", off Today), so
    /// TODAYWRITE-1's claim that confirmed copy follows only a genuine server
    /// success did not actually hold. That host now passes a real handler.
    ///
    /// The default is `.cancelled` rather than `.didNotLand` because a view
    /// with no handler did not ASK the server anything — Rule 11's "we did
    /// not ask", the same reading `logSickTrend` gives an unrecognised
    /// action. It claims nothing in either direction and offers no Retry
    /// that could only repeat the same nothing. The next view that forgets
    /// to wire this now fails safe instead of lying.
    var onCheckIn: (V5Row) async -> V5WriteSettlement = { _ in .cancelled }
    /// The way onward once the flare has cleared — pushes `V5Route.returnToRunning`,
    /// the eight-stage walk-run ladder (19a). Absent (`returnAvailable == false`)
    /// draws nothing rather than a disabled row.
    var onReturnToRunning: () -> Void = {}
    /// SHAREDSHELL-1 (2026-09-04) · `true` when a caller already draws the
    /// persistent Today header+strip around this content — see the type's
    /// own doc comment for why this exists and who sets it.
    var suppressOwnHeader: Bool = false

    /// TODAYWRITE-1 · was `checkedRowID: String?`, set in the tap handler.
    /// One state machine now, and the `.done` case — the only one the
    /// "Logged." note is drawn from — is reachable only from a write the
    /// server confirmed. See `V5RowWriteState`.
    @State private var checkInState: V5RowWriteState = .idle

    /// The row the server has confirmed, if any.
    private var checkedRowID: String? {
        if case .done(let id) = checkInState { return id }
        return nil
    }

    private var failedRow: V5Row? {
        guard case .failed(let id) = checkInState else { return nil }
        return model.checkIn.first { $0.id == id }
    }

    /// INJURYCHECKIN-1 · the server's own refusal sentence, when it sent one.
    private var refusal: String? { checkInState.refusal }

    /// INJURYCHECKIN-1 · WHAT A LANDED CHECK-IN SAYS.
    ///
    /// It used to be `Text(checked.sub ?? "Logged.")` — and `sub` is never
    /// nil on a real payload, so the `"Logged."` fallback had never once
    /// rendered. What the runner actually got was the tapped row's OWN
    /// sub-line printed a second time, about 40pt below the first: "Loosen
    /// back in gradually tomorrow", then "Loosen back in gradually tomorrow".
    /// Rule 17 in its purest form, and worse than bloat here — it meant a
    /// successful check-in and a failed one were indistinguishable by
    /// looking at the screen, which is exactly what TODAYWRITE-1 and -2 spent
    /// two rounds making impossible everywhere else.
    ///
    /// So the confirmation now confirms. It names WHICH answer landed (the
    /// tile shows no selection of its own, so the note is the only place that
    /// can) and then says the thing only a confirmed write may say, in the
    /// same words the niggle row uses for the same fact.
    static func checkedNote(_ row: V5Row) -> String {
        "\(row.label) \u{00B7} the coach has today's answer"
    }

    /// The id the scaffold scrolls to when a note appears below the fold.
    /// One constant, so the anchor and the request cannot drift (Rule 16).
    static let noteAnchor = "injury-checkin-note"

    /// Non-nil exactly while there is something under the tile worth seeing.
    /// `.sending` and `.idle` deliberately do not scroll: nothing has been
    /// said yet, and moving the page under a finger is the defect next door.
    ///
    /// Pure and static so a test can walk all five states without a view host
    /// — the same reason `v5WriteSettlement` is extracted.
    static func revealTarget(for state: V5RowWriteState) -> String? {
        switch state {
        case .failed, .refused, .done: return noteAnchor
        case .idle, .sending: return nil
        }
    }

    private var revealNote: String? { Self.revealTarget(for: checkInState) }

    /// The one place a check-in is attempted, so the row and the Retry
    /// cannot drift apart (Rule 16).
    private func checkIn(_ row: V5Row) {
        guard !checkInState.isSending else { return }
        checkInState = .sending(row.id)
        Task {
            let settlement = await onCheckIn(row)
            checkInState = .settled(settlement, token: row.id)
        }
    }

    var body: some View {
        StateScreenScaffold(nested: suppressOwnHeader, panelFill: .quiet) {
            DayPanel(fill: .quiet) {
                if !suppressOwnHeader {
                    PlaceHeaderRow(onOpenAccount: onOpenAccount)
                }
                VStack(alignment: .leading, spacing: V5.S.s2) {
                    Text("\(model.area) · \(model.since)")
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textSecondary)
                    Text("Not today")
                        .faffDisplayV5(TypeScaleV5.display44)
                        .foregroundStyle(V5.textPrimary)
                }
            }
        } content: {
            CoachSay(text: model.verdict, size: .md)

            ListGroup(header: "What changed") {
                ForEach(model.whatChanged) { row in
                    ListRow(label: row.label, sub: row.sub, value: row.value.map { $0.value })
                }
            }

            // The prototype draws this as plain tappable rows in one tile,
            // with the logged note as a quiet 13pt line BELOW the tile
            // (13a markup: a `ListRow` per option, then `injury.checkedNote`
            // at `font-size:13px;color:var(--text-secondary);padding:0 4px`).
            //
            // It used to be an `ExpandingRow` whose expanded content was
            // `EmptyView()`, which drew a chevron on a row that had nothing
            // to open — the one affordance the behaviour rules name outright
            // — and put the note inside the row instead of under the group.
            // 19a's ladder check-in already renders the prototype's shape;
            // the README says 19a uses the "same expand-in-place pattern as
            // 13a", so the two now actually match.
            VStack(alignment: .leading, spacing: V5.S.s10) {
                V5SectionLabel(text: "How does it feel today")
                VStack(spacing: 0) {
                    ForEach(model.checkIn) { row in
                        ListRow(label: row.label,
                                sub: checkInState == .sending(row.id) ? "Sending" : row.sub) {
                            checkIn(row)
                        }
                    }
                }
                .background(V5.materialTile,
                            in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))

                // INJURYCHECKIN-1 · ONE SLOT, AND IT NEVER GETS SHORTER.
                //
                // These three notes used to be three independent `if`s
                // directly in the stack, so every transition between them
                // changed the page's height. Retry (`.failed` -> `.sending`)
                // removed ~141pt from a page that was already taller than the
                // screen, iOS clamped the scroll offset, and every row above
                // slid down into the space — putting "Worse" exactly where
                // "Retry" had been. See `NonShrinkingSlot`.
                //
                // The `.id` is what the scaffold scrolls to, so a note that
                // lands below the fold is brought up rather than left for a
                // runner who has no reason to scroll.
                NonShrinkingSlot {
                    VStack(alignment: .leading, spacing: V5.S.s10) {
                        // TODAYWRITE-1 · the note under the tile is the app
                        // saying "we have this". Only a confirmed write earns
                        // it. INJURYCHECKIN-1 · and it says something the
                        // screen does not already say.
                        if let checked = model.checkIn.first(where: { $0.id == checkedRowID }) {
                            Text(Self.checkedNote(checked))
                                .font(.faffText(TypeScaleV5.label13))
                                .foregroundStyle(V5.textSecondary)
                                .padding(.horizontal, V5.S.s4)
                        }

                        // INJURYCHECKIN-1 · a refusal is an ANSWER. The
                        // server's own sentence, `Alert` rather than
                        // `ErrorNote`, and NO Retry — the request cannot
                        // succeed however many times it is sent, and offering
                        // one would be the false reassurance this closes.
                        if let refusal {
                            Alert(text: refusal, tone: .attention)
                        }

                        if let failed = failedRow {
                            ErrorNote(text: V5UnconfirmedCopy.coachMayNotHaveIt,
                                      onRetry: { checkIn(failed) })
                        }
                    }
                }
                .padding(.bottom, V5.S.s12)
                .id(Self.noteAnchor)
                .v5Reveal(revealNote)
            }

            if model.returnAvailable {
                ListGroup(header: "Cleared to return") {
                    ListRow(label: "Return to running",
                            sub: "The eight-stage walk-run ladder",
                            onTap: onReturnToRunning)
                }
            }
        }
    }
}

// MARK: - 14a · Week off
//
// A REFUSAL that is not a flare: a planned break, not an injury. Rest-hue
// gradient panel — this is still a designed day state, just not one with a
// session in it — so it is NOT `.quiet` the way 13a/15a are. Not an apology:
// the coach line states the break as a fact and names what comes back.

struct WeekOffV5: View {
    private var panelInk: V5.PanelInk { PanelFill.state(.rest).ink }
    let model: V5WeekOff
    var onOpenAccount: () -> Void = {}
    /// SHAREDSHELL-1 (2026-09-04) · see `InjuryFlareV5`'s own doc comment —
    /// this is the state a NAVIGATED-TO date most commonly lands in ("Away
    /// from the plan" fires for any date outside the current training
    /// window, not just today), so it was the clearest live repro of the
    /// bug this flag exists to close.
    var suppressOwnHeader: Bool = false

    private var range: String { Self.formatRange(fromISO: model.fromISO, toISO: model.toISO) }

    var body: some View {
        StateScreenScaffold(nested: suppressOwnHeader, panelFill: .state(.rest)) {
            DayPanel(fill: .state(.rest)) {
                if !suppressOwnHeader {
                    PlaceHeaderRow(onOpenAccount: onOpenAccount, fill: .onPanel)
                }
                VStack(alignment: .leading, spacing: V5.S.s2) {
                    Text(range)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(panelInk.secondary)
                    Text("Week off")
                        .faffDisplayV5(TypeScaleV5.display44)
                        .foregroundStyle(panelInk.primary)
                }
                Text(model.reason)
                    .font(.faffText(TypeScaleV5.body15))
                    .foregroundStyle(panelInk.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } content: {
            CoachSay(text: model.coachLine, size: .md)

            if let nextUp = model.nextUp {
                ListGroup(header: "Next up") {
                    ListRow(label: nextUp.label, sub: nextUp.sub, value: nextUp.value.map { $0.value })
                }
            }
        }
    }

    /// "18 – 24 August" from two `yyyy-MM-dd`-prefixed ISO dates. Falls back
    /// to the raw strings rather than crashing on an unexpected format —
    /// this view never fetches, so a bad payload is not this file's bug to
    /// hide, but it should not take the screen down either.
    static func formatRange(fromISO: String, toISO: String) -> String {
        let iso = DateFormatter()
        iso.calendar = Calendar(identifier: .gregorian)
        iso.timeZone = TimeZone(identifier: "UTC")
        iso.dateFormat = "yyyy-MM-dd"

        guard let from = iso.date(from: String(fromISO.prefix(10))),
              let to = iso.date(from: String(toISO.prefix(10))) else {
            return "\(fromISO) – \(toISO)"
        }

        let cal = Calendar(identifier: .gregorian)
        // ── US ORDER, WHICH MOVES THE ABBREVIATION TO THE OTHER END ───────
        //
        // David, 2026-08-25: "it should be Month, Day, Year formatted."
        //
        // A range says the month once, and which end carries it depends on
        // the order. Written the British way the month trails, so the FIRST
        // date is the bare number: "24 – 30 August". Written the US way the
        // month leads, so the SECOND one is: "August 24 – 30". Swapping the
        // format string alone would have produced "24 – August 30", which is
        // neither convention and reads as a typo.
        let day = DateFormatter(); day.dateFormat = "d"
        day.locale = Locale(identifier: "en_US_POSIX")
        let monthDay = DateFormatter(); monthDay.dateFormat = "MMMM d"
        monthDay.locale = Locale(identifier: "en_US_POSIX")

        let sameMonth = cal.component(.month, from: from) == cal.component(.month, from: to)
            && cal.component(.year, from: from) == cal.component(.year, from: to)

        let left = monthDay.string(from: from)
        let right = sameMonth ? day.string(from: to) : monthDay.string(from: to)
        return "\(left) – \(right)"
    }
}

// MARK: - 15a · Off-season
//
// THE ONE SCREEN THAT USES `Silence`, NOT `CoachSay`. The README is explicit
// about why: the coach has nothing honest to say about a block that does not
// exist yet, and inventing a sentence to fill the space would be worse than
// leaving it quiet. Do not add a CoachSay here — that is rule three's whole
// point, and this screen is the one most likely to tempt it.

struct OffSeasonV5: View {
    let model: V5OffSeason
    var onOpenAccount: () -> Void = {}
    /// SHAREDSHELL-1 (2026-09-04) · see `InjuryFlareV5`'s own doc comment.
    var suppressOwnHeader: Bool = false

    var body: some View {
        StateScreenScaffold(nested: suppressOwnHeader, panelFill: .quiet) {
            DayPanel(fill: .quiet) {
                if !suppressOwnHeader {
                    PlaceHeaderRow(onOpenAccount: onOpenAccount)
                }
                VStack(alignment: .leading, spacing: V5.S.s2) {
                    if let since = model.sinceLastRace {
                        Text(since)
                            .font(.faffText(TypeScaleV5.label13))
                            .foregroundStyle(V5.textSecondary)
                    }
                    Text("Off-season")
                        .faffDisplayV5(TypeScaleV5.display44)
                        .foregroundStyle(V5.textPrimary)
                }
            }
        } content: {
            Silence(reason: model.silenceReason)

            // "Plan the next block" — RESTORED, with a real handler.
            //
            // It was removed on the reasoning that the prototype specs its
            // onClick as a noop and no route existed, so the row would be a
            // dead end. The first half is true and the second is no longer:
            // the handoff is explicit that the noops in the prototype "need
            // real handlers in the app but their visual design is final", so
            // removing a FINAL screen's only action was a scope decision the
            // design did not make.
            //
            // And there is an honest destination now. On this phone a block is
            // built around a race — that is the whole race-mode premise — so
            // planning the next block IS adding the race it is built toward.
            // `.faffOpenRaceSetup` is the same hop onboarding uses at the end
            // of its own flow, handled at the shell: select Races, push
            // add-a-race. One route, two entry points, no new dead end.
            ListGroup {
                ListRow(label: "Plan the next block",
                        sub: "Pick the race it is built around",
                        onTap: {
                            NotificationCenter.default.post(name: .faffOpenRaceSetup, object: nil)
                        })
            }

            if let weeklyRange = model.weeklyRange {
                ListGroup(header: "This week") {
                    ListRow(label: "Miles", sub: weeklyRange)
                }
            }
        }
    }
}

// MARK: - 16a · Data outage
//
// NOT a screen of its own — the same Today shell, demonstrating the
// network-failure content rules. The panel keeps painting from the last
// payload we could read (today's session is written and stored on the
// phone, so it does not need the network to be right); only the sections
// that actually failed to refresh take the outage treatment. `OutageBodyV5`
// (`SurfaceStoreV5.swift`) already IS that treatment — ErrorNote with retry,
// a height-reserving Skeleton, the on-device coach line — so this view
// composes it rather than re-authoring it.
//
// This is the one screen in the file where `ErrorNote` belongs. Reaching for
// `Alert` or `Silence` here would say "the answer is no" or "nothing honest
// to say" about a session that is, in fact, sitting on the phone right now.

struct DataOutageV5: View {
    private var panelInk: V5.PanelInk { today.panel.fill.ink }
    /// The last Today payload we could read — `V5Surface.model` when
    /// `stale == true`. The panel is real content, not a placeholder: the
    /// outage is in readiness and the weekly stats, not in today's session.
    let today: V5Today
    let onRetry: () -> Void
    var onOpenAccount: () -> Void = {}

    var body: some View {
        StateScreenScaffold(panelFill: today.panel.fill) {
            DayPanel(fill: today.panel.fill) {
                PlaceHeaderRow(onOpenAccount: onOpenAccount, fill: .onPanel)
                VStack(alignment: .leading, spacing: V5.S.s20) {
                    VStack(alignment: .leading, spacing: V5.S.s2) {
                        if let kicker = today.panel.kicker {
                            Text(kicker)
                                .font(.faffText(TypeScaleV5.label13))
                                .foregroundStyle(panelInk.secondary)
                        }
                        Text(today.panel.type)
                            .faffDisplayV5(TypeScaleV5.display56)
                            .foregroundStyle(panelInk.primary)
                    }
                    if let dose = today.panel.dose {
                        FaffValueText(dose.value, font: .faffText(28, weight: .semibold),
                                      color: panelInk.primary, mark: panelInk.mark,
                                      fault: panelInk.fault)
                    }
                }
                if !today.panel.stats.isEmpty {
                    PanelStatPlate(stats: today.panel.stats.map {
                        PanelStat($0.label, $0.value.value,
                                  ink: $0.toneValue.inkOverride)
                    })
                }
            }
        } content: {
            VStack(alignment: .leading, spacing: V5.S.inGroup) {
                V5SectionLabel(text: "Readiness")
                OutageBodyV5(onRetry: onRetry)
            }
        }
    }
}

// MARK: - SCROLLCLOCK-3 regression harness
//
// `StateScreenScaffold` is `private` to this file, and none of its five real
// callers wires `staleBanner` today — which is exactly how the bug this
// section fixes went unwatched (Rule 15: a mechanism no case can reach is
// untested). Rather than leaving the fix's correctness resting on the doc
// comment alone (Rule 20: a rule with no gate is a hypothesis), this view
// exercises the scaffold's own stale-banner composition directly, reachable
// from `ScreensCatalogV5` like every other render-verification fixture in
// this app, and sample-only — no network, no host, nothing to seed.
// `ScrollHeaderStatusBarCollisionUITests.testStateScreenScaffoldStaleBannerNeverLeavesABlackGapBehindTheStatusBarClock`
// drives it and samples the pixel behind the status-bar clock, falsified
// against the pre-fix composition (see that fix's own commit) before this
// landed.
struct ScrollClock3RegressionV5: View {
    private var panelInk: V5.PanelInk { PanelFill.state(.easy).ink }

    var body: some View {
        StateScreenScaffold(panelFill: .state(.easy),
                             staleBanner: .init(stale: true,
                                                 cachedAt: Date().addingTimeInterval(-900),
                                                 onRetry: {})) {
            DayPanel(fill: .state(.easy)) {
                PlaceHeaderRow(fill: .onPanel)
                Text("Easy")
                    .faffDisplayV5(TypeScaleV5.display56)
                    .foregroundStyle(panelInk.primary)
            }
        } content: {
            Text("SCROLLCLOCK-3 regression harness — proves the scaffold's own stale-banner wiring composes after the status-bar cap.")
                .font(.faffText(TypeScaleV5.body15))
                .foregroundStyle(V5.textSecondary)
        }
    }
}

// MARK: - Previews
//
// Built from the prototype's own sample data (`INJURY`, `WEEK_OFF`,
// `OFF_SEASON`, and the `easy` day for 16a's cached panel), decoded through
// the real wire types rather than constructed by hand — so a preview that
// compiles is also proof the JSON shape round-trips.

private func decode<T: Decodable>(_ type: T.Type, _ json: String) -> T {
    do {
        return try JSONDecoder().decode(T.self, from: Data(json.utf8))
    } catch {
        fatalError("StateScreensV5 sample failed to decode \(T.self): \(error)")
    }
}

extension V5Injury {
    static let sampleV5: V5Injury = decode(V5Injury.self, """
    {
      "area": "Left calf",
      "since": "Flagged 2 days ago",
      "verdict": "Rest, not run \\u00b7 the calf gets three days to settle before anything reintroduces load.",
      "whatChanged": [
        { "id": "this-week", "label": "This week", "sub": "12 mi this week, walking and easy cross-training only.", "value": null, "action": null }
      ],
      "checkIn": [
        { "id": "better", "label": "Better today", "sub": "Loosen back in gradually tomorrow", "value": null, "action": "checkin" },
        { "id": "same", "label": "About the same", "sub": "One more day off, then reassess", "value": null, "action": "checkin" },
        { "id": "worse", "label": "Worse", "sub": "Worth a call with someone who can look at it", "value": null, "action": "checkin" }
      ],
      "returnAvailable": true
    }
    """)
}

extension V5WeekOff {
    static let sampleV5: V5WeekOff = decode(V5WeekOff.self, """
    {
      "reason": "Travel \\u00b7 Denver, altitude and no motivation to chase miles",
      "fromISO": "2026-08-18",
      "toISO": "2026-08-24",
      "coachLine": "A zero week goes in the book \\u00b7 the plan resumes where you are, not where the calendar says.",
      "nextUp": { "id": "monday", "label": "Monday \\u00b7 Easy, 4 mi", "sub": null, "value": null, "action": null }
    }
    """)
}

extension V5OffSeason {
    static let sampleV5: V5OffSeason = decode(V5OffSeason.self, """
    {
      "sinceLastRace": "Since CIM \\u00b7 3 weeks ago",
      "silenceReason": "No block is written. Running is optional, and nothing here is measured against a goal.",
      "weeklyRange": "0 \\u2013 20 mi, whatever feels good"
    }
    """)
}

extension V5Today {
    /// A cached "before run, easy day" payload — 16a's own panel content
    /// while readiness and the weekly stats are what failed to refresh.
    static let sampleOutageV5: V5Today = decode(V5Today.self, """
    {
      "dateISO": "2026-08-20",
      "state": "before_run",
      "panel": {
        "dayState": "easy",
        "quiet": false,
        "place": "Today",
        "dateLine": "Thursday 20 August",
        "weekLine": "Week 6 of 16",
        "kicker": "55\\u00b0F \\u00b7 light rain, no wind \\u00b7 about 54 min",
        "type": "Easy",
        "dose": { "text": "6 mi", "modelled": false },
        "stats": []
      },
      "weekStrip": [],
      "groups": [],
      "whereYouAre": [],
      "beforeYouGo": [],
      "askedVsRan": [],
      "whatThisDidToTheWeek": []
    }
    """)
}

#Preview("13a · Injury flare") {
    InjuryFlareV5(model: .sampleV5)
        .preferredColorScheme(.dark)
}

#Preview("14a · Week off") {
    WeekOffV5(model: .sampleV5)
        .preferredColorScheme(.dark)
}

#Preview("15a · Off-season") {
    OffSeasonV5(model: .sampleV5)
        .preferredColorScheme(.dark)
}

#Preview("16a · Data outage") {
    DataOutageV5(today: .sampleOutageV5, onRetry: {})
        .preferredColorScheme(.dark)
}

// MARK: - 8c · A race, twenty minutes after it finished
//
// The receiving end of the watch's race-day finish, and the one screen in the
// app whose whole job is to REFUSE TO PROMOTE A NUMBER.
//
// The runner has just crossed a line holding a time they desperately want to
// be real. It is a watch clock: started by a thumb, stopped by a thumb, over a
// GPS distance that is not the certified course. The chip time will move it —
// by seconds, not minutes, which is exactly the size of thing worth saying out
// loud rather than hiding.
//
// So the screen holds the number without letting it become the result, and it
// does that without feeling like it is withholding:
//
//   · THE WATCH TIME IS IN THE VALUE REGISTER, NEVER THE DISPLAY REGISTER.
//     Display is where real results go. A watch clock set in 56pt Archivo
//     would BE a result, whatever the label beside it said, because the type
//     is the claim. 28pt in the value register with "on the watch" beside it
//     is a phrase the runner can interpret, which is the rule the whole
//     screen is built on: never a value the runner cannot interpret.
//
//   · IT CARRIES THE MARK. `FaffValue.modelled` puts the amber tilde on it —
//     rule one's own mechanism rather than a bespoke colour. The addendum
//     draws the figure itself in `#F2B03C`, which worked when this panel had
//     white ink; round three has since given the race ramp DARK ink, and
//     amber-on-amber is unreadable. The tilde says provisional and the figure
//     stays legible, which is what the colour was for.
//
//   · THE STATS PLATE DOES NOT REPEAT IT. Goal, margin and average pace are
//     three quantities that only make sense together. Printing the watch time
//     a second time would be the screen arguing with itself about how
//     important that number is.
//
//   · NO BUTTON THAT CANNOT BE HONOURED. There is no "lock in chip time"
//     here, because there is no chip time to lock. That row appears days
//     later in the Races table. A control that cannot do its job is worse
//     than no control — it invites a tap and answers with nothing.
struct RaceJustFinishedV5: View {
    private var panelInk: V5.PanelInk { PanelFill.state(.race).ink }

    let model: V5RaceJustFinished
    var onOpenAccount: () -> Void = {}

    var body: some View {
        StateScreenScaffold(panelFill: .state(.race)) {
            DayPanel(fill: .state(.race)) {
                PlaceHeaderRow(onOpenAccount: onOpenAccount, fill: .onPanel)

                VStack(alignment: .leading, spacing: V5.S.s2) {
                    Text(model.kicker)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(panelInk.secondary)
                    Text(model.distanceLabel)
                        .faffDisplayV5(TypeScaleV5.display56)
                        .foregroundStyle(panelInk.primary)
                }

                // The number, held at arm's length.
                HStack(alignment: .firstTextBaseline, spacing: V5.S.s8) {
                    FaffValueText(.modelled(model.watchTime),
                                  font: .faffText(TypeScaleV5.valueMin, weight: .semibold),
                                  color: panelInk.primary,
                                  // THE MARK IS THE WHOLE SCREEN. This is the
                                  // number the runner wants to be real, and
                                  // the tilde is the only thing saying it is
                                  // not. In amber it sat on the race ramp's
                                  // own hue and could not be seen.
                                  mark: panelInk.mark,
                                  fault: panelInk.fault)
                    Text("on the watch")
                        .font(.faffText(TypeScaleV5.body15))
                        .foregroundStyle(panelInk.secondary)
                }

                if !model.stats.isEmpty {
                    PanelStatPlate(stats: model.stats)
                }
            }
        } content: {
            CoachSay(text: model.coachLine, size: .md)

            // Two STATEMENTS, no chevrons. Nothing here opens, and a chevron
            // on a row with nothing behind it is a promise the screen cannot
            // keep.
            ListGroup(header: "Chip time") {
                // THE QUALIFIER IS AMBER, AND IT IS A RIGHT-HAND VALUE.
                //
                // 8c draws "Not published yet" on the left with "We check
                // hourly" on the right in amber. Built as a plain sub-line it
                // lost both the position and the colour.
                //
                // Amber is right here and it is NOT the amber that had to be
                // dropped from the panel: a result that is not published yet
                // is stale evidence, which is exactly what amber means. And
                // this row sits BELOW the panel, on the black page, where the
                // ramp's dark ink does not reach and amber-on-amber cannot
                // happen.
                ListRow(label: model.chipStatus,
                        value: model.chipSub.map { FaffValue.measured($0) },
                        valueInk: V5.attention)
                // WAS: "Nothing goes in the book today" over "The watch time
                // never becomes the result."
                //
                // Two denials stacked — "Nothing", then "never" — in the one
                // row on the one screen whose brief is to hold the number
                // WITHOUT feeling like it is withholding. The facts were
                // right and the grammar was doing the opposite job: the label
                // led on what the runner does not get, and the only sentence
                // giving the watch time any standing was the second half of
                // the sub.
                //
                // The same two facts, stated forward. "Stands in" is the
                // whole ruling in two words — real enough to work with, not
                // the one that counts — which is exactly what the register
                // upstairs already says by putting it in the value register
                // with a tilde on it.
                ListRow(label: "The book waits for the chip",
                        sub: "The watch time stands in until it lands. The official one is what goes on the record.")
            }

            ListGroup(header: "The rest of the week") {
                ListRow(label: "Tomorrow", value: .measured(model.tomorrow))
                ListRow(label: "Back in the plan", value: .measured(model.backInPlan))
            }

            CoachCaveat(text: "This week is for absorbing it, not chasing it.")
        }
    }
}

/// What 8c needs. Deliberately small: every field is something the backend
/// already knows the moment a race result lands, and nothing here is derived
/// on the phone.
struct V5RaceJustFinished: Equatable {
    /// "Crossed the line 22 minutes ago" — composed server-side, because the
    /// phone would have to guess a timezone to say it.
    let kicker: String
    /// "Half marathon".
    let distanceLabel: String
    /// The watch clock, as text. Always rendered modelled.
    let watchTime: String
    /// Goal / margin / average — three quantities that only read together.
    let stats: [PanelStat]
    let coachLine: String
    /// "Not published yet" / "Provisional result posted".
    let chipStatus: String
    /// "We check hourly".
    let chipSub: String?
    let tomorrow: String
    let backInPlan: String
}

extension V5RaceJustFinished {
    /// 8c's own drawn content, verbatim from the addendum. Sample data, the
    /// same way every other screen in `ScreensCatalogV5` is sampled — this is
    /// what makes the screen reviewable while it still has no production
    /// route, and the absence of exactly this is why it went unnoticed that
    /// nothing could reach it.
    static let sampleV5 = V5RaceJustFinished(
        kicker: "Crossed the line 22 minutes ago",
        distanceLabel: "Half",
        watchTime: "1:29:44",
        stats: [
            PanelStat("Goal", .measured("1:32:00")),
            PanelStat("Inside by", .measured("2:16")),
            PanelStat("Average", .measured("6:51 /mi")),
        ],
        coachLine: "You went under it. The chip will move that by seconds, not minutes \u{00B7} so hold the feeling and let the result catch up.",
        chipStatus: "Not published yet",
        chipSub: "We check hourly",
        tomorrow: "Nothing",
        backInPlan: "Thursday")
}

#Preview("8c \u{00B7} Race, twenty minutes after") {
    RaceJustFinishedV5(model: .sampleV5)
        .preferredColorScheme(.dark)
}
