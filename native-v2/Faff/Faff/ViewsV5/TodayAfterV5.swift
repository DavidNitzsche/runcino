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
import CoreLocation

struct TodayAfterV5: View {
    /// Same rule as the before-run screen: the ink comes from the same
    /// value the panel is filled with, computed here rather than read from
    /// the environment, because this view sits ABOVE the panel that
    /// publishes it.
    /// Same ruling as the before-run screen: a stepped-to day keeps the
    /// gradient and the strip, and the words carry the tense.
    private var panelFill: PanelFill { model.panel.fill }
    private var panelInk: V5.PanelInk { panelFill.ink }
    /// The garage, when the payload did not carry one. See `shoeRow`.
    @State private var fetchedShoes: [V5Row] = []
    @State private var shoesLoading = false
    @State private var shoePickerOpen = false
    let model: V5Today

    var onOpenAccount: () -> Void
    /// A body part was picked in the niggle picker. Leaves the screen: the
    /// caller persists it.
    var onFlagNiggle: (String) -> Void
    /// "See it in Injury" — this view does not navigate.
    var onOpenInjuryFlare: () -> Void
    /// "Manage shoes", and the fallback when the garage did not arrive.
    var onChangeShoe: () -> Void
    /// A pair was chosen from the menu. Leaves the screen: the caller
    /// persists it and refreshes.
    var onPickShoe: (String) -> Void
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
    /// `TodayHostV5.viewingDate`, straight through — see `stripDays()`.
    var selectedDateISO: String? = nil
    var onBackToToday: (() -> Void)? = nil
    /// Page the week strip. -1 back a week, +1 forward. Async — see
    /// WKSTRIP-RACE-1 in ChartsV5.swift; the strip's recentre awaits this.
    var onPageWeek: (Int) async -> Void = { _ in }
    /// BOUNDARY-1 · straight through to `TodayHeaderStripV5`.
    var canPageBackward: Bool = true
    var canPageForward: Bool = true
    var initials: String? = nil
    /// Job 1 · "report sick" — a runner who just finished and feels off
    /// should not have to wait for tomorrow's Today to say so. Same
    /// expand-in-place row as the before-run screen; see `SickV5.swift`.
    var onReportSick: (_ symptoms: [String], _ started: String, _ hasFever: Bool) -> Void = { _, _, _ in }

    @State private var niggleOpen = false
    @State private var niggleFlagged: String?

    /// Ported from `Components/TodayPostRunBody.swift`'s Strava section —
    /// same states, same sheet, same poll. The old naive version here just
    /// flipped a local bool to "Sent to Strava" the instant the button was
    /// tapped and threw away `onPushStrava()`'s result with `_ = try?`, so a
    /// failed push (e.g. the runId-lookup bug fixed in lib/strava/push.ts)
    /// showed success anyway (David, 2026-08-27: "it also never pushed
    /// anything to Strava").
    private enum StravaPushUIState { case idle, pushing, pending, done, dup, failed }
    @State private var stravaPushState: StravaPushUIState = .idle
    @State private var stravaAutoPush = false
    @State private var stravaSuggestedTitle: String? = nil
    @State private var showStravaSheet = false
    @State private var stravaEditTitle = ""
    @State private var stravaEditDesc = ""

    /// Fixed body-part list for the in-place niggle picker. Not on the wire —
    /// `V5Row` carries no child options — and stable across runners, so it is
    /// a local constant rather than a server round trip, matching the
    /// prototype's own fixed list.
    private static let bodyParts = ["Left calf", "Right calf", "Achilles", "Knee", "Hip", "Foot"]

    init(model: V5Today,
         onOpenAccount: @escaping () -> Void = {},
         onFlagNiggle: @escaping (String) -> Void = { _ in },
         onOpenInjuryFlare: @escaping () -> Void = {},
         onChangeShoe: @escaping () -> Void = {},
         onPickShoe: @escaping (String) -> Void = { _ in },
         onRowAction: @escaping (V5Row) -> Void = { _ in },
         onPushStrava: @escaping () -> Void = {},
         onPickDay: @escaping (String) -> Void = { _ in },
         viewingDayLabel: String? = nil,
         selectedDateISO: String? = nil,
         onBackToToday: (() -> Void)? = nil,
         onPageWeek: @escaping (Int) async -> Void = { _ in },
         canPageBackward: Bool = true,
         canPageForward: Bool = true,
         initials: String? = nil,
         onReportSick: @escaping (_ symptoms: [String], _ started: String, _ hasFever: Bool) -> Void = { _, _, _ in }) {
        self.viewingDayLabel = viewingDayLabel
        self.selectedDateISO = selectedDateISO
        self.onBackToToday = onBackToToday
        self.onPageWeek = onPageWeek
        self.canPageBackward = canPageBackward
        self.canPageForward = canPageForward
        self.initials = initials
        self.model = model
        self.onOpenAccount = onOpenAccount
        self.onFlagNiggle = onFlagNiggle
        self.onOpenInjuryFlare = onOpenInjuryFlare
        self.onChangeShoe = onChangeShoe
        self.onPickShoe = onPickShoe
        self.onRowAction = onRowAction
        self.onPushStrava = onPushStrava
        self.onPickDay = onPickDay
        self.onReportSick = onReportSick
    }


    /// The strip's plate — which of the seven cells wears the "you are here"
    /// mark. NOT the server's own `isToday` (that always names the runner's
    /// real today, everywhere in the payload); this compares each day
    /// against `model.dateISO`, the date THIS payload is describing.
    /// Ordinarily the same day — but the moment the runner steps away,
    /// `model.dateISO` moves with them and `isToday` does not, so this is
    /// what keeps the plate on the day actually on screen.
    ///
    /// A PURE FUNCTION OF `model`, DELIBERATELY. Two earlier attempts at this
    /// carried a SEPARATE piece of state (`selectedISO` / `selectedDayISO`)
    /// so the plate could move before the payload for the tapped day had
    /// arrived — the "instant tap" David asked for. That state could go
    /// stale independently of `model`, and when two navigations overlapped
    /// in flight it did: the plate, the header and the actual content payload
    /// could each be describing a DIFFERENT day at the same moment. This
    /// reads only `model`, which is the one thing on this screen that cannot
    /// disagree with itself — whichever payload is currently loaded is
    /// unambiguous by construction. The plate moves when the content moves,
    /// never before, and never to a day the screen isn't actually showing.
    private func stripDays() -> [WeekStripDayV5] {
        // David: "still feels pretty slow and clunky." The pill used to wait
        // for the network — `model.dateISO` only moves once the new payload
        // has actually landed, so tapping Thursday visibly did nothing for
        // the length of a round trip.
        //
        // `selectedDateISO` is `TodayHostV5`'s `viewingDate`, passed straight
        // through — the SAME synchronous, single-source-of-truth value that
        // already drives the header's "Upcoming"/"Earlier" tense instantly.
        // Reusing it here costs nothing new: no cache, no second variable
        // that could disagree with the fetch in flight, which is exactly
        // what made the last attempt at "instant" race. The pill moves the
        // instant the tap registers; the content underneath still waits for
        // the real payload, honestly, and simply falls back to describing
        // whatever IS on screen once it's home again.
        let selected = selectedDateISO ?? model.dateISO
        return model.weekStrip.map { d in
            var s = d.strip
            s.isToday = d.dateISO == selected
            return s
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                panel
                // MULTI-RUN-DAY-1 (2026-09-03) · a supplemental run reads
                // right under the hero, never inside it — visible, never a
                // second completion. See `supplementalRunsSection`'s own
                // doc comment for why.
                if !model.supplementalRuns.isEmpty {
                    supplementalRunsSection
                }
                // Block-transition note (2026-08-28) — same section the
                // before-run screen draws, because a runner who ran early
                // still wakes into a new block and is owed the sentence.
                if let note = model.blockNote {
                    VStack(alignment: .leading, spacing: V5.S.s10) {
                        V5SectionLabel(text: note.title, color: V5.textSecondary)
                        CoachSay(text: note.body, size: .md)
                    }
                }

                /* ═══ DIGEST-1 (2026-09-04) — THE SAME HIERARCHY RunDetailV5
                 * NOW USES, applied over what THIS payload can honestly
                 * support:
                 *
                 *   1. identity          → `panel` (above)
                 *   2. activity stats    → `marathonPaceStatsGrid` for a
                 *      marathon-specific long run, `repCompletionGrid` for
                 *      a rep-style session (TODAY-PARITY-1, 2026-09-05 —
                 *      completion count + rep range, the SAME Shape 1
                 *      `RunDetailV5.activityStats` builds), else
                 *      `WorkoutResultFactsV5`. `routePhases` carries
                 *      `label`/`pace_shape`/`target_pace`/`actual_pace`/
                 *      `avg_hr` (same five fields `PhaseBreakdown` always
                 *      had). STILL NOT PORTED: `workoutAnalysisSection`'s
                 *      bar chart, and a genuine per-phase `completed` flag
                 *      (this wire has no way yet to know a rep was SKIPPED
                 *      rather than simply not yet reported).
                 *   3. Coach's Read      → `PostRunVerdictV5`, the SAME
                 *      component, same `postRun` object as RunDetailV5 —
                 *      genuinely canonical, not a parallel implementation.
                 *   4. Route             → `routeOrBeltCard`, moved up from
                 *      Layer 4 to sit directly after Coach's Read.
                 *   5. Workout Analysis  → not built here; see §2.
                 *   6. Piece by Piece    → `groupsTile`, this screen's own
                 *      equivalent structure.
                 *   7. Splits            → `breakdownSection`.
                 *   8. Secondary evidence → everything below.
                 */
                if let grid = marathonPaceStatsGrid {
                    SessionDetailsGridV5(scopeCaption: nil, metrics: grid)
                } else if let grid = repCompletionGrid {
                    SessionDetailsGridV5(scopeCaption: nil, metrics: grid)
                } else {
                    WorkoutResultFactsV5(workPaceText: model.paceWork)
                }

                if let pr = model.postRun {
                    PostRunLearnedV5(model: pr, includes: .capture)
                }

                if let pr = model.postRun {
                    PostRunVerdictV5(model: pr,
                                     conditions: model.conditionsNote,
                                     coachTip: model.coachTip)
                }

                routeOrBeltCard

                VStack(alignment: .leading, spacing: 0) {
                    askedVsRanSection
                    readingSection
                }

                if !model.groups.isEmpty {
                    groupsTile
                }
                if let pr = model.postRun {
                    PostRunLearnedV5(model: pr, includes: .strides)
                }

                breakdownSection

                /* ═══ §8 · SECONDARY EVIDENCE AND LOGGING ═══════════════ */

                if let shares = model.zoneShares, !shares.isEmpty {
                    zoneTile(shares)
                }

                /* ═══ LAYER 5 · ACTIONS ══════════════════════════════════ */

                if let shoe = model.shoesWorn {
                    ListGroup(header: "Shoes you wore") {
                        shoeRow(shoe)
                    }
                }
                whatThisDidSection
                if niggleFlagged != nil {
                    niggleLink
                }
                SickReportRowV5(onReport: onReportSick)
                if let runId = model.runId {
                    stravaSection(runId: runId)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, V5.S.gutter)
            .padding(.bottom, V5.S.s24)
            // A vertical page must never pan sideways — see `v5PageWidth`.
            .v5PageWidth()
        }
        .background(V5.surfacePage)
        .scrollIndicators(.hidden)
    }

    // MARK: - Strava push
    //
    // Self-contained, like the legacy component it's ported from — this view
    // calls `API` directly rather than round-tripping the result through
    // `onPushStrava`, because the host has no way to hand a push OUTCOME back
    // through a fire-and-forget `() -> Void` closure. `onPushStrava` stays on
    // the initializer for the previews/host call sites that still pass it;
    // it is simply no longer what drives this section.

    @ViewBuilder
    private func stravaSection(runId: String) -> some View {
        VStack(spacing: 0) {
            switch stravaPushState {
            case .done, .dup:
                stravaStatusLine("Published to Strava")
            case .pushing, .pending:
                stravaStatusLine(stravaAutoPush ? "Publishing to Strava…" : "Pushing…")
            case .idle, .failed:
                if stravaAutoPush {
                    stravaStatusLine(
                        stravaPushState == .failed ? "Couldn’t publish to Strava" : "Publishing to Strava…",
                        failed: stravaPushState == .failed)
                } else {
                    FaffButton(stravaPushState == .failed ? "Push failed · tap to retry" : "Send it to Strava",
                               variant: stravaPushState == .failed ? .secondary : .primary,
                               size: .lg) {
                        stravaEditTitle = stravaSuggestedTitle ?? (model.workoutType?.capitalized ?? "Run")
                        stravaEditDesc = ""
                        showStravaSheet = true
                    }
                }
            }
        }
        .task(id: runId) { await loadStravaStatus(runId: runId) }
        .sheet(isPresented: $showStravaSheet) {
            StravaPushSheet(
                title: $stravaEditTitle,
                description: $stravaEditDesc,
                isPushing: stravaPushState == .pushing,
                onPush: { performStravaPush(runId: runId) },
                onCancel: { showStravaSheet = false }
            )
            .presentationDetents([.height(440), .large])
            .presentationDragIndicator(.visible)
            .preferredColorScheme(.dark)
        }
    }

    /// A STATUS IS NOT AN ACTION, SO IT DOES NOT WEAR AN ACTION'S CLOTHES.
    ///
    /// This drew a full-width 52pt filled pill — deliberately, so it would line
    /// up with the `FaffButton(.lg)` it replaces. But matching the button's
    /// geometry gave a terminal, untappable status the exact visual weight of
    /// the screen's primary action, and it sits at the bottom of the after-run
    /// screen where the primary action lives. "Published to Strava" was the
    /// loudest thing on the page and the only thing on it that does nothing.
    ///
    /// It is now a quiet line: the run is on Strava, the runner needs to know
    /// once, and nothing is being asked of them. No fill, no button height, no
    /// border (containment in this system is a fill step, never a hairline).
    ///
    /// A FAILURE IS STILL NOT A SUCCESS. `.failed` came through here too, so a
    /// push that did not happen rendered in Strava orange at primary weight —
    /// the same treatment as the one that did. Failure now takes fault red,
    /// which is what the palette has for "we could not do this".
    @ViewBuilder
    private func stravaStatusLine(_ text: String, failed: Bool = false) -> some View {
        Text(text)
            .font(.faffText(TypeScaleV5.label13))
            .foregroundStyle(failed ? V5.fault : V5.textQuiet)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, V5.S.s8)
    }

    /// Load current push status on appear · mirrors `TodayPostRunBody`'s
    /// `loadStravaStatus`. A read that fails leaves the section idle rather
    /// than claiming a state it hasn't confirmed.
    private func loadStravaStatus(runId: String) async {
        guard let s = try? await API.fetchStravaPushStatus(runId: runId) else { return }
        await MainActor.run {
            stravaAutoPush = s.autoPush ?? false
            if let t = s.suggestedTitle { stravaSuggestedTitle = t }
            switch s.status {
            case "uploaded":  stravaPushState = .done
            case "duplicate": stravaPushState = .dup
            case "pending":
                stravaPushState = .pending
                Task { await pollStravaPush(runId: runId) }
            case "failed":    stravaPushState = .failed
            default:          break   // "never" · stay idle
            }
        }
    }

    /// Push with the sheet's edited title + description, then dismiss. Only
    /// flips to `.done`/`.dup` on the server's own confirmed status — never
    /// optimistically, per the bug this replaced.
    private func performStravaPush(runId: String) {
        guard stravaPushState != .pushing else { return }
        stravaPushState = .pushing
        let title = stravaEditTitle
        let desc = stravaEditDesc
        Task {
            let s = try? await API.pushRunToStrava(runId: runId, title: title, description: desc)
            await MainActor.run {
                switch s?.status {
                case "uploaded":  stravaPushState = .done
                case "duplicate": stravaPushState = .dup
                case "pending":
                    stravaPushState = .pending
                    Task { await pollStravaPush(runId: runId) }
                default:          stravaPushState = .failed
                }
                showStravaSheet = false
            }
        }
    }

    private func pollStravaPush(runId: String, attempt: Int = 0) async {
        guard attempt < 8 else { return }
        try? await Task.sleep(nanoseconds: 5_000_000_000)
        guard let s = try? await API.fetchStravaPushStatus(runId: runId) else {
            await pollStravaPush(runId: runId, attempt: attempt + 1)
            return
        }
        await MainActor.run {
            switch s.status {
            case "uploaded":  stravaPushState = .done
            case "duplicate": stravaPushState = .dup
            case "failed":    stravaPushState = .failed
            default:          Task { await pollStravaPush(runId: runId, attempt: attempt + 1) }
            }
        }
    }

    // MARK: - Panel

    private var panel: some View {
        // 22b. Same rule as the before-run screen: the gradient means today.
        // This is the screen a tapped past "Done" row actually lands on, so it
        // is the one that carries 22b most of the time.
        DayPanel(fill: panelFill) {
            // TODAYSHELL-1 · same shared shell as TodayBeforeV5 — see
            // `TodayHeaderStripV5`'s own header for why this is one
            // definition now, not hand-rolled per screen.
            TodayHeaderStripV5(
                place: model.panel.place,
                viewingDayLabel: viewingDayLabel,
                weekLine: model.panel.weekLine,
                weekStripDays: stripDays(),
                onBackToToday: onBackToToday,
                onCalendar: nil,
                initials: initials,
                onAccount: onOpenAccount,
                onPickDay: { day in onPickDay(day.id) },
                onPageWeek: { await onPageWeek($0) },
                canPageBackward: canPageBackward,
                canPageForward: canPageForward
            )

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
                HStack(alignment: .firstTextBaseline, spacing: V5.S.s6) {
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

    // `recapSection` REMOVED 2026-09-03. `win`/`verdict`/`facts`/
    // `conditionsNote`/`coachTip` are the same canonical composition
    // `PostRunVerdictV5` now draws from `model.postRun` (`headline`/
    // `summary`/`cost`), called above with `conditionsNote`/`coachTip`
    // passed through as the two fields `postRun` does not itself carry.
    // See `PostRunVerdictV5`'s own header.

    // MARK: - Asked vs ran
    //
    // Bare rows on the page, no tile background — matches the design, which
    // sits this table directly between the panel and the coach verdict tile.
    // Effort is the only row the server marks actionable (`action != nil`);
    // it expands in place to a 1-10 scale. Every other row is a plain,
    // chevronless `ListRow`.

    /// TRUE WHEN THE ASKED-VS-RAN TABLE IS ALREADY PRINTING AVERAGE HR.
    ///
    /// Matched on the row's own rendered TEXT against `model.hrAvg`, not on
    /// the row's id alone. The server only emits the `heart` row when the
    /// session carried a hard cap, and it fills it with `avgHr` — but a
    /// predicate that trusted the id would suppress the reading on any future
    /// day the row carried a different number (across-the-work HR, say), and
    /// the runner would silently lose a reading. Comparing the printed strings
    /// means this can only ever hide a genuine duplicate.
    private var hrAvgShownInAskedVsRan: Bool {
        guard let hr = model.hrAvg else { return false }
        return model.askedVsRan.contains { row in
            row.id == "heart" && row.value?.text == "\(hr)"
        }
    }

    /// MULTI-RUN-DAY-1 (2026-09-03) · a run that happened today but did NOT
    /// satisfy the prescription above — `lib/execution/day-resolver.ts`'s
    /// `supplementalRuns`, wire-shaped. Real training, real mileage, and a
    /// visible row here — never folded into the hero's own numbers, never
    /// carrying a verdict or a workout-type label, because it was never
    /// shown to execute anything prescribed. Found live: a friend's
    /// unrelated 4.48mi easy run once rendered AS the day's graded interval
    /// session; this is the correct representation of what actually
    /// happened, distinct from that completion, not merely hidden from it.
    private var supplementalRunsSection: some View {
        ListGroup(header: "Also today") {
            ForEach(model.supplementalRuns) { run in
                ListRow(
                    label: FaffFmt.miles(run.distanceMi).map { "\($0) easy" } ?? "Extra run",
                    sub: run.indoor ? "Treadmill · not part of today's session" : "Not part of today's session",
                    value: FaffFmt.pace(secPerMi: run.paceSPerMi.map(Double.init))
                        .map { FaffValue.measured($0) }
                )
            }
        }
    }

    /// 2026-09-03 · THE EFFORT ROW NO LONGER DRAWS HERE.
    ///
    /// This ForEach used to special-case the one row the server marks
    /// actionable (`row.action != nil`, always effort) into a ten-button
    /// picker at 29pt per cell — the component's own prior comment named the
    /// defect outright: "Ten cells in a row across a phone cannot each be
    /// 44... it is reported rather than quietly altered." It was also, as of
    /// this pass, a SECOND effort-logging control on the same screen:
    /// `RPECaptureRow` (Layer 5, the "Log" group below) writes the exact same
    /// `POST /api/runs/[id]/rpe` this row's `onLogEffort` called directly —
    /// two pickers for one number is worse than the accessibility defect
    /// either one has alone. The actionable row is filtered out here; its
    /// job belongs to the one accessible picker now.
    private var askedVsRanSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(model.askedVsRan.filter { $0.action == nil }) { row in
                ListRow(label: row.label, sub: row.sub, value: Self.fv(row.value))
            }
        }
        .padding(.horizontal, V5.S.s4)
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
            // LABELLED, THE SAME WAY RUN DETAIL LABELS IT.
            //
            // This drew the identical component over the identical data with
            // `labels: false` while `RunDetailV5.zoneSection` drew it with
            // `labels: true` — two screens, one chart, one of them readable.
            //
            // Unlabelled, the bar is five blocks on an ordinal density ramp
            // with no key: the ramp says WHICH zone only if you already know
            // the segments run Z1→Z5 left to right, and the caption beside it
            // names exactly one of them. Rendered on the owner's 2026-08-30
            // long run — 4/15/11/10/60 — the eye lands on a 60%-wide block
            // that the screen never names, over a caption reading "15% in
            // zone 2". `ZoneBar` already places each label under its own
            // segment and omits it for an empty zone, so this costs 15pt and
            // makes the distribution the chart is for actually readable.
            ZoneBar(shares: shares, targets: Set(targets), height: 44, labels: true)
        }
    }

    // MARK: - The one difference: route (outdoor) vs on the belt (treadmill)
    //
    // Driven entirely by which field the engine populated. Never an empty
    // map, never a zero — the treadmill run gets its own card, not a hollow
    // version of the outdoor one.

    /// PICK THE SHOE WITHOUT LEAVING THE RUN.
    ///
    /// Three attempts, and the first two both failed the same way. It pushed
    /// the whole Shoes screen — answering a question about THIS run by
    /// sending the runner somewhere else. Then it became a popup Menu, which
    /// worked and never navigated, but drew no affordance at all: the row
    /// looked exactly like a dead row, so the only way to discover it was to
    /// tap something that appeared inert.
    ///
    /// `ExpandingRow` is the answer this screen already had. It is what "Flag
    /// a niggle" and "Not feeling right" use two inches below — a chevron, a
    /// verb, and a list that opens IN PLACE. The picker should not have been
    /// a new interaction; it should have been the one already here.
    @ViewBuilder
    private func shoeRow(_ shoe: V5Row) -> some View {
        let options = shoeChoices
        if options.count <= 1 {
            // One pair, or none loaded yet: nothing to choose between. Draw it
            // plain — no chevron, because a chevron promises somewhere to go.
            ListRow(label: shoe.label, sub: shoe.sub, value: Self.fv(shoe.value), onTap: nil)
                .task { await loadShoesIfNeeded() }
        } else {
            ExpandingRow(label: shoe.label,
                         sub: shoe.sub,
                         value: .measured("Change"),
                         question: "Which pair did you wear",
                         isExpanded: $shoePickerOpen) {
                VStack(spacing: V5.S.s6) {
                    ForEach(options, id: \.id) { opt in
                        Button {
                            if opt.id != shoe.id { onPickShoe(opt.id) }
                            withAnimation(V5.Motion.expand) { shoePickerOpen = false }
                        } label: {
                            HStack(spacing: V5.S.s6) {
                                VStack(alignment: .leading, spacing: V5.S.s2) {
                                    Text(opt.label)
                                        .font(.faffText(TypeScaleV5.body15))
                                        .foregroundStyle(V5.textPrimary)
                                    // The mileage rides along, so the list says
                                    // the same thing about a pair that the row
                                    // above says about the worn one.
                                    if let sub = opt.sub, !sub.isEmpty {
                                        Text(sub)
                                            .font(.faffText(TypeScaleV5.label13))
                                            .foregroundStyle(V5.textQuiet)
                                    }
                                }
                                Spacer(minLength: 0)
                                if opt.id == shoe.id {
                                    Image(systemName: "checkmark")
                                        .font(.faffText(TypeScaleV5.label13, weight: .semibold))
                                        .foregroundStyle(V5.textSecondary)
                                }
                            }
                            .padding(.horizontal, V5.S.s14)
                            .frame(minHeight: 52)
                            .frame(maxWidth: .infinity)
                            .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r16, style: .continuous))
                        }
                        .buttonStyle(V5PressStyle())
                        .accessibilityLabel(opt.id == shoe.id
                                            ? "\(opt.label), currently worn"
                                            : opt.label)
                    }
                }
            }
            .task { await loadShoesIfNeeded() }
        }
    }

    /// The payload's garage, or the one this view fetched for itself.
    private var shoeChoices: [V5Row] {
        model.shoeOptions.isEmpty ? fetchedShoes : model.shoeOptions
    }

    /// A `Picker` binding whose setter is the write. Reading it gives the pair
    /// currently worn, so the tick sits in the right place without this view
    /// keeping a second copy of that fact.
    private var shoeSelection: Binding<String> {
        Binding(
            get: { model.shoesWorn?.id ?? "" },
            set: { newId in
                guard !newId.isEmpty, newId != model.shoesWorn?.id else { return }
                onPickShoe(newId)
            }
        )
    }

    /// Fetch the garage once, only when the payload did not carry it.
    ///
    /// A phone on a new build talking to a server that predates `shoeOptions`
    /// still gets a working picker. When the field is present this never runs.
    private func loadShoesIfNeeded() async {
        guard model.shoeOptions.isEmpty, fetchedShoes.isEmpty, !shoesLoading else { return }
        shoesLoading = true
        defer { shoesLoading = false }
        var req = URLRequest(url: API.baseURL.appendingPathComponent("api/shoe"))
        req.httpMethod = "GET"
        guard let (data, _) = try? await API.authedSend(req) else { return }
        struct Row: Decodable { let id: Int?; let brand: String?; let model: String?; let mileage: Double?; let retired: Bool? }
        struct Payload: Decodable { let shoes: [Row] }
        guard let payload = try? JSONDecoder().decode(Payload.self, from: data) else { return }
        fetchedShoes = payload.shoes.compactMap { r in
            guard r.retired != true, let id = r.id else { return nil }
            let name = [r.brand, r.model].compactMap { $0 }.joined(separator: " ")
            guard !name.isEmpty else { return nil }
            // Same sentence the server writes, so a fetched row and a payload
            // row are indistinguishable to the reader.
            let sub = r.mileage.map { "\(Int($0.rounded())) mi on them" } ?? "Mileage not tracked"
            return V5Row(id: String(id), label: name, sub: sub, value: nil, action: nil)
        }
    }

    // MARK: - What the run was made of

    /// THE BREAKDOWN, AT THE GRAIN THE RUN WAS ACTUALLY RUN AT.
    ///
    /// "lets just add in a breakdown for per mile on easy or longer runs and
    /// per section for intervals and tempos or whatever is best for the run."
    ///
    /// The choice is made from the run, not from the day's label: a session
    /// that recorded phases is a session made of sections, and a mile of one
    /// holds the back of a rep, a jog and the front of the next averaged
    /// together. Everything else is made of miles.
    /// THE SHAPE OF THIS SESSION, which decides what the screen may claim.
    /// One rule, in `PostRunShapeV5`, shared with run detail — the two screens
    /// may not answer one run differently.
    private var shape: RunShapeV5 {
        RunShapeV5.of(workoutType: model.workoutType,
                      indoor: model.onTheBelt != nil)
    }

    /// TRUE WHEN THE ROUTE CARD ABOVE ALREADY EXPLAINED THE PACE RAMP.
    ///
    /// The map's caption and the mile table's caption are deliberately built
    /// from the same vocabulary (see `RouteMapView.routeCaption` /
    /// `paceColumnCaption`), and on run detail — where the map sits BELOW the
    /// table — only one of them is ever in front of the runner at a time.
    ///
    /// On THIS screen the map sits ABOVE the table, so both printed, and the
    /// two sentences end in the same seven words: "reads speed, not whether
    /// the pace was right." Rendered on the owner's 2026-08-30 long run they
    /// read as the same instruction given twice, ~600pt apart, which is the
    /// bloat this pass exists to remove. One ramp, one sentence — the map's,
    /// because it is the first one the runner meets and the table inherits its
    /// colours. When the map draws no caption (no GPS, or no pace on the
    /// splits) the table keeps its own, so the rule is never left unsaid.
    private var routeCaptionAlreadyShown: Bool {
        guard routeCoords.count >= 2 else { return false }
        return RouteMapView.routeCaption(splits: model.routeSplits,
                                         phases: routePhaseSamples) != nil
    }

    @ViewBuilder
    private var breakdownSection: some View {
        // The shape states a preference; what the run actually recorded
        // decides. A rep session whose phases never reached the phone is still
        // better served by its miles than by nothing at all.
        let d = shape.decomposition(hasSections: !sectionPieces.isEmpty,
                                    hasMiles: !milePieces.isEmpty)
        switch d {
        case .sections:
            RepBreakdownV5(title: shape.breakdownTitle(.sections), pieces: sectionPieces)
        /* MILES ONLY ON *THIS* SCREEN, and the strides come from `postRun`.
         *
         * `.milesAndSections` says the session is a steady body with pieces
         * appended — an easy run with strides. Run Detail draws both, because
         * its `phase_breakdown` carries each phase's own LABEL, its pace shape
         * and its heart rate. This screen's `routePhases` carries only
         * `{mi, sec, type, verdict, status_label}`: no label, because its
         * stated job is colouring the route line. `sectionPieces` therefore
         * names every work phase "Interval N", which over six 20-second
         * accelerations would be seven intervals that the plan never
         * prescribed — the same off-by-one, in the runner's own words, on the
         * screen he sees first.
         *
         * So the pieces are not drawn from that payload. The strides reach
         * this screen through `PostRunLearnedV5`, which both post-run screens
         * already share and which reads the canonical composer's own answer.
         * Enriching `routePhases` with labels and paces is a real follow-up
         * and an additive wire change; until then this refuses rather than
         * mislabels. */
        case .milesAndSections:
            MileBreakdownV5(title: shape.breakdownTitle(.miles),
                            pieces: milePieces,
                            paceLine: (shape.showsPerMilePace && !routeCaptionAlreadyShown)
                                ? RouteMapView.paceColumnCaption(splits: model.routeSplits,
                                                                 phases: routePhaseSamples)
                                : nil,
                            paceColor: MileBreakdownV5.paceRamp(splits: model.routeSplits,
                                                                phases: routePhaseSamples),
                            allowsElevation: shape.showsElevation,
                            allowsPace: shape.showsPerMilePace)
        case .miles:
            MileBreakdownV5(title: shape.breakdownTitle(.miles),
                            pieces: milePieces,
                            // The pace column runs on the route line's ramp
                            // now, so its sentence is the map's sentence. See
                            // `RunDetailV5`'s route section for the ruling —
                            // and `routeCaptionAlreadyShown` for why, on THIS
                            // screen only, the map having said it means the
                            // table does not say it again.
                            paceLine: (shape.showsPerMilePace && !routeCaptionAlreadyShown)
                                ? RouteMapView.paceColumnCaption(splits: model.routeSplits,
                                                                 phases: routePhaseSamples)
                                : nil,
                            paceColor: MileBreakdownV5.paceRamp(splits: model.routeSplits,
                                                                phases: routePhaseSamples),
                            allowsElevation: shape.showsElevation,
                            allowsPace: shape.showsPerMilePace)
        case .none:
            // RULE THREE. A run with neither draws nothing — not a header over
            // an empty list, which reads as a section that failed to load.
            EmptyView()
        }
    }

    // MARK: - The reading

    /// THE FOUR INSTRUMENT VALUES, AND ONLY THE ONES THIS RUN EARNS.
    ///
    /// Run detail has drawn a Reading card since it was written and this
    /// screen never had one — "I like seeing this too which isnt on the latest
    /// sim build im seeing". Same builder shape as `RunDetailV5.readingRows`,
    /// same refusals, plus the per-type composition that neither screen had.
    ///
    /// WHAT IS REMOVED, AND FROM WHAT. See `PostRunShapeV5` for the argument
    /// behind each of these; in summary:
    ///   · whole-run average HR and cadence come OFF tempo, threshold,
    ///     tune-up, interval, fartlek and progression runs, because an average
    ///     across a session made of pieces is a number no part of it was at.
    ///   · maximum HR comes OFF easy, recovery, long and progression runs,
    ///     where the peak is a hill or a road crossing and printing it beside
    ///     a Z2 prescription invites reading a spike as a failed session.
    ///   · temperature comes OFF treadmill runs entirely. It is a weather
    ///     model for a grid square the runner was not standing in.
    ///
    /// An absent reading draws no row. A run with no cadence shows no cadence
    /// row — not a zero, and not a dash we typed.
    private var readingRows: [(String, FaffValue)] {
        var out: [(String, FaffValue)] = []
        // NOT TWICE ON ONE SCREEN. The asked-vs-ran table two rows above
        // prints average HR as the value against a prescribed ceiling
        // ("Heart · under 145 · 159") whenever the session carried a hard cap.
        // This row then printed the SAME integer again ("Heart rate, avg ·
        // 159 bpm"), two rows down — 159 rendered twice on the owner's
        // 2026-08-30 long run, and a third time inside the coach line below.
        //
        // The design contract's own rule: "No content is ever printed twice on
        // one screen." The asked-vs-ran row is the one that has to stay — it
        // carries the ceiling and the breach tone, which is a judgement this
        // plain reading cannot make. So the reading yields when, and only
        // when, the row above is already showing this number. On every session
        // with no hard cap (the majority) nothing changes and the reading
        // stands, which is what David asked for when he added this card.
        if shape.showsWholeRunHrAvg, let hr = model.hrAvg, !hrAvgShownInAskedVsRan {
            out.append(("Heart rate, avg", .measured("\(hr) bpm")))
        }
        if shape.showsMaxHr, let hrMax = model.hrMax {
            out.append(("Heart rate, max", .measured("\(hrMax) bpm")))
        }
        // NAMED FOR ITS SCOPE. "Heart rate, avg" on a rep session would be
        // the same words over a different population, so the label carries
        // the scope and the two can never be read as the same number.
        if shape.showsWorkHrAvg, let hrWork = model.hrAvgWork {
            out.append(("Heart rate, across the work", .measured("\(hrWork) bpm")))
        }
        if shape.showsWholeRunCadence, let cad = model.cadenceAvg {
            out.append(("Cadence", .measured("\(cad) spm")))
        }
        if shape.showsWorkCadence, let cadWork = model.cadenceAvgWork {
            out.append(("Cadence, across the work", .measured("\(cadWork) spm")))
        }
        if shape.showsWorkHrAvg, let paceWork = model.paceWork {
            out.append(("Pace, across the work", .measured(paceWork)))
        }
        // RULE ONE. Nothing on the phone or the watch has a thermometer in it,
        // so a run's temperature is a weather read for a grid square and an
        // hour bucket. The wire carries no source with it, and by the type's
        // own rule — if a screen cannot tell, the answer is modelled — this is
        // modelled. The same call `RunDetailV5` already makes, made the same
        // way, because the two screens print the same number.
        if shape.showsTemperature, let temp = model.tempF {
            out.append(("Temperature", .modelled("\(Int(temp.rounded()))\u{00B0}F")))
        }
        return out
    }

    /// THE READINGS, AS THE SAME ROW THE EFFORT IS.
    ///
    /// These were hand-built `HStack`s while the effort row above them was a
    /// `ListRow`, so the two lists differed in every dimension that makes a
    /// column read as a column: a different horizontal inset, a 15pt
    /// secondary label against a 16pt medium primary one, and 44pt rows
    /// against 58pt. The labels did not line up and the weights did not
    /// match, which is exactly what it looked like.
    ///
    /// Alignment is not something to nudge into place, it is something to
    /// make structural. One component, so the two halves cannot drift apart
    /// the next time either is touched.
    ///
    /// They stay OFF a tile and under no heading. Effort is the last thing
    /// the session asked for; these are the rest of what the watch recorded
    /// about the same run, and one continuous column says that. A heading
    /// would insist they are a new subject.
    @ViewBuilder
    private var readingSection: some View {
        if !readingRows.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(readingRows, id: \.0) { row in
                    ListRow(label: row.0, value: row.1)
                }
            }
        }
    }

    private var milePieces: [MilePiece] {
        // No run total on this payload, so a trailing piece is sized only if
        // the wire told us its length. Unknown is not "a whole mile".
        MileBreakdownV5.pieces(from: model.routeSplits)
    }

    /// The samples the route map normalises its pace ramp across, built the
    /// same way `routeCard` builds the map's own — one expression read twice,
    /// so the table and the line cannot be handed different runs.
    private var routePhaseSamples: [PhaseSample] {
        model.routePhases.map { PhaseSample(mi: $0.mi, sec: $0.sec) }
    }

    /// Sections, from what this screen actually has.
    ///
    /// TODAY'S PAYLOAD IS THINNER THAN RUN DETAIL'S, BUT NOT SILENT ABOUT WHAT
    /// EACH ROW IS. `RunDetailV5` builds its pieces from `phase_breakdown` —
    /// real per-phase labels, the asked pace, the watch's own grade — and gets
    /// "Interval · 1 km, 6:45, asked 6:40, held it". This screen's
    /// `routePhases` carries only a distance, a duration and (since
    /// 2026-09-01) the phase's `type` — no target and no verdict, because
    /// inventing either from a pace would be the phone deciding what the plan
    /// asked for. `type` is enough to NAME the row, though, and naming it is
    /// the whole difference between a plan and a list: "Section 1", "Section
    /// 2" numbered every phase off its position with no regard for what it
    /// was, and read, in the runner's own words, as "some random bullshit" —
    /// "needs to be warm up, interval 1, break, interval 2, etc. the plan."
    ///
    /// THE SAME WORDS THE REST OF THE APP ALREADY USES. "Interval N of M",
    /// counted within the work phases only, is `LiveRunOutdoorV5.lineHead`'s
    /// convention for the run in progress; "Recovery" is `RunDetailV5
    /// .fallbackLabel`'s word for a jog between reps and the pre-run card's
    /// own word for the same phase (`spec-card.ts`'s `recovery: 'Honest jog,
    /// not standing.'`). One name per concept, so a runner who has already
    /// met these words on the watch and before the run meets them again here.
    ///
    /// `isWork` now reads the phase's real type instead of asserting one
    /// uniform weight for every row — the type is the reason it can, where
    /// before nothing on this payload supported the claim.
    ///
    /// A PHASE WITH NO `type` (a payload from before 2026-09-01, or a future
    /// era this screen does not recognise) still gets a row — it just falls
    /// back to a numbered, unnamed one rather than guessing what it was.
    private var sectionPieces: [RepPiece] {
        let usable = model.routePhases.filter { $0.mi > 0 && $0.sec > 0 }
        // A SINGLE PHASE IS THE RUN, and the poster at the top of this screen
        // already carries its distance, its time and its pace. Restating them
        // in a list of one is a section that says nothing — the same ruling
        // `RunDetailV5.repPieces` makes, for the same reason.
        guard usable.count > 1 else { return [] }
        // WORK ORDINALS, COUNTED WITHIN THE WORK PHASES ONLY — "Interval 1",
        // "Interval 2", not the phase's position among warm-ups and jogs.
        // Same walk `LiveRunOutdoorV5`'s `workIndex` does for the live phase.
        var workOrdinal: [Int: Int] = [:]
        for (idx, p) in usable.enumerated() where p.type == "work" {
            workOrdinal[idx] = workOrdinal.count + 1
        }
        return usable.enumerated().map { i, p in
            // A DURATION IS NOT A PACE. Found 2026-09-01, the day `p.mi`/
            // `p.sec` first carried real data (a server field-name bug had
            // made `model.routePhases` empty on every run before that — see
            // `web-v2/app/api/v5/today/route.ts`'s `routePhases` comment).
            // This passed `p.sec` — the phase's raw duration in seconds —
            // straight into `formatPace(secPerMile:)`, which prints it as a
            // pace unchanged. It read as a plausible pace on a ~1-mile
            // interval by coincidence (seconds-per-mile happens to be close
            // to seconds-elapsed when the distance is close to 1), and was
            // wrong everywhere else: a 2.10 mi, 1084 s warm-up (a real
            // 8:36/mi) rendered as "18:04/mi" — 1084 seconds read back as a
            // pace. Divide by the phase's own distance first.
            let paceSecPerMi = p.mi > 0 ? Double(p.sec) / p.mi : Double(p.sec)
            // PARITY-1, 2026-09-04 · `p.label` is the server's own phase
            // name ("10.0 mi easy", "Interval · 1 km") now that `routePhases`
            // carries it — the SAME string run detail's `phase_breakdown`
            // has always shown. Falls back to the generic numbered label
            // only for a payload from before this date.
            let label: String
            if let real = p.label, !real.isEmpty {
                label = real
            } else {
                switch p.type {
                case "warmup":   label = "Warm Up"
                case "cooldown": label = "Cool Down"
                case "recovery": label = "Recovery"
                case "work":     label = "Interval \(workOrdinal[i] ?? 1)"
                default:         label = "Section \(i + 1)"
                }
            }
            return RepPiece(id: i,
                     label: label,
                     isWork: p.type.map { $0 == "work" } ?? true,
                     actualPace: Units.formatPace(secPerMile: paceSecPerMi),
                     // Same rule `RunDetailV5.repPieces` applies: a recovery
                     // jog's target is a band the watch needed to draw
                     // something, not a real prescription, and a stride is
                     // never pace-graded at all (`pace_shape == "effort"`).
                     // PACE-CONTRACT-1 · shape-aware text, not the bare
                     // number — see `RunDetailV5.repPieces`' own comment.
                     askedPace: (p.type == "work" && p.paceShape != "effort")
                        ? paceContractText(shape: p.paceShape, targetPaceSec: p.targetPaceSec,
                                            tolerancePaceSec: p.tolerancePaceSec)
                        : nil,
                     detail: "\(Units.formatDistance(miles: p.mi, decimals: 2)) \(Units.distanceLabel())",
                     // VERDICT-1 · the canonical word, from the same resolver
                     // run detail's phase panel reads — now the full
                     // pace-shape-aware phrase (`phaseVerdictPhrase`), not
                     // just the bare `status_label`, so a ceiling phase
                     // reads "Under the ceiling" here exactly as it does on
                     // run detail rather than falling through to nil.
                     verdictPhrase: phaseVerdictPhrase(paceShape: p.paceShape, verdict: p.verdict,
                                                        statusLabel: p.statusLabel, type: p.type),
                     chosen: false,
                     kind: RepPiece.Kind.of(type: p.type, isWork: p.type.map { $0 == "work" } ?? true),
                     durationSec: p.sec)
        }
    }

    /// PARITY-1, 2026-09-04 · `RunDetailV5.marathonPacePhase`'s twin, off
    /// `V5RoutePhase` now that `routePhases` carries `label`. Same detection
    /// rule (a work phase whose own label names marathon pace), so the two
    /// screens agree on whether a session IS this shape without either
    /// guessing from a pace value.
    private var marathonPacePhase: V5RoutePhase? {
        model.routePhases.first {
            $0.type == "work" && ($0.label?.lowercased().contains("marathon pace") ?? false)
        }
    }

    private var marathonEasyPhase: V5RoutePhase? {
        guard marathonPacePhase != nil else { return nil }
        return model.routePhases.first {
            $0.type == "work" && !($0.label?.lowercased().contains("marathon pace") ?? false)
        }
    }

    /// The marathon-pace stats grid — `RunDetailV5.activityStats`' Shape 2,
    /// off the same server-computed label/pace/HR fields, now that
    /// `routePhases` carries them (closes the gap this file's own header
    /// comment on `sectionPieces` used to name). Total distance/time/pace
    /// are deliberately NOT repeated here — `askedVsRanSection` /
    /// `readingSection` already state them once on this screen, and
    /// restating them in a second grid would be Rule 17 on this file's own
    /// page rather than across two screens.
    private var marathonPaceStatsGrid: [SessionDetailsGridV5.Metric]? {
        guard let mp = marathonPacePhase else { return nil }
        let easy = marathonEasyPhase
        return [
            .init("MP distance", .measured(Units.formatDistance(miles: mp.mi, decimals: 1) + " " + Units.distanceLabel())),
            // PACE-CONTRACT-1 · shape-aware sub text — see `RunDetailV5
            // .activityStats`' own comment for the same fix on the twin grid.
            .init("MP pace", .measured(mp.actualPace.map { "\($0)/mi" }),
                  sub: paceContractText(shape: mp.paceShape, targetPaceSec: mp.targetPaceSec,
                                         tolerancePaceSec: mp.tolerancePaceSec)),
            .init("Easy pace", .measured(easy?.actualPace.map { "\($0)/mi" }),
                  sub: easy.flatMap { paceContractText(shape: $0.paceShape, targetPaceSec: $0.targetPaceSec,
                                                        tolerancePaceSec: $0.tolerancePaceSec) }),
            .init("MP heart rate", .measured(mp.avgHr.map { "\($0) bpm" })),
        ]
    }

    /// TODAY-PARITY-1, 2026-09-05 · `RunDetailV5.activityStats`' Shape 1
    /// (rep-style completion/work-pace/rep-range), ported so Today does not
    /// omit the defining result of an interval workout — David's own
    /// standing: "Today can remain the concise version and Run Detail the
    /// complete version, but Today cannot omit the defining result." Same
    /// `structuredIdentityTypes` vocabulary `RunDetailV5.isRepStyleSession`
    /// gates on, read here off `model.workoutType` instead of `type_display`
    /// (the same string, different wire — both come from the one server-
    /// side `displayTypeFor`/`workoutType` resolution, so the two screens
    /// cannot classify a session differently).
    private static let repStyleWorkoutTypes: Set<String> = [
        "threshold", "interval", "intervals", "tempo", "vo2max", "vo2",
    ]
    private var isRepStyleSession: Bool {
        guard let t = model.workoutType?.lowercased() else { return false }
        return Self.repStyleWorkoutTypes.contains(t)
    }
    private var trueWorkReps: [V5RoutePhase] {
        model.routePhases.filter { $0.type == "work" && $0.paceShape != "effort" }
    }
    private var repCompletionGrid: [SessionDetailsGridV5.Metric]? {
        guard isRepStyleSession else { return nil }
        let reps = trueWorkReps
        guard reps.count >= 2 else { return nil }
        // No per-phase `completed` flag on this wire yet (the genuinely
        // open gap named in the handback) — every decoded rep is one the
        // watch reported back, so "done" reads as the count actually
        // present rather than a guess, same posture as `verdict == nil`
        // reading as ungraded rather than as failed (Rule 11).
        let done = reps.count
        let repRange: String? = {
            let secs = reps.compactMap { p -> Int? in
                guard p.mi > 0, p.sec > 0 else { return nil }
                return Int(Double(p.sec) / p.mi)
            }
            guard let lo = secs.min(), let hi = secs.max(), lo != hi,
                  let loText = FaffFmt.pace(secPerMi: Double(lo)),
                  let hiText = FaffFmt.pace(secPerMi: Double(hi)) else { return nil }
            return "\(loText)-\(hiText)/mi"
        }()
        return [
            .init("Completed", .measured("\(done) of \(reps.count)")),
            .init("Work pace", .measured(model.paceWork.map { "\($0)/mi" })),
            .init("Rep range", .measured(repRange)),
        ]
    }

    @ViewBuilder
    private var routeOrBeltCard: some View {
        if let belt = model.onTheBelt, !belt.isEmpty {
            beltCard(belt)
        } else if model.routePolyline != nil || (model.elevation?.count ?? 0) > 1 {
            routeCard(model.elevation ?? [])
        }
    }

    // THE LEGEND SENTENCE IS GONE, AND SO IS THE CLAIM IT WAS MAKING.
    //
    // `routeLegend` named the axis the map was drawn along — "shaded by
    // heart-rate zone" — and the runner's reply was that naming an axis is
    // not decoding it: "instead of saying 'shaded by HR zone' we need a key."
    // The honest end of that thread is not a key. A line has one channel and
    // the reading has four, so the breakdown below carries it as numbers and
    // the map goes back to saying where he went.
    //
    // It was also drifting. It re-derived the axis here with `!routePhases
    // .isEmpty` where the component needs two VALID phases, `!hrZones.isEmpty`
    // where it needs two bands, and `hr != nil` where it needs `hr > 0` — so
    // runs existed whose caption named an axis the line had not been drawn
    // along. A second copy of a rule is a second thing to get wrong, and the
    // fix for that is to stop keeping one.

    /// Which axis the map colours along, from the day's own state.
    ///
    /// The same choice `RunDetailV5.mappedEffort` makes from `detail.type` —
    /// this screen has `panel.dayState` instead, which is the same fact one
    /// step earlier. It picks the AXIS, never a number.
    private var mappedEffort: FaffEffort {
        switch model.panel.dayState.lowercased() {
        case "long":    return .long
        case "quality": return .intervals
        case "race":    return .race
        case "rest":    return .rest
        default:        return .easy
        }
    }

    private var routeCoords: [CLLocationCoordinate2D] {
        guard let poly = model.routePolyline, !poly.isEmpty else { return [] }
        return decodePolyline(poly).map { CLLocationCoordinate2D(latitude: $0.0, longitude: $0.1) }
    }

    private func beltCard(_ stats: [V5Stat]) -> some View {
        Tile {
            Text("On the belt")
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textSecondary)
            HStack(alignment: .top, spacing: V5.S.s16) {
                ForEach(Array(stats.enumerated()), id: \.offset) { i, s in
                    VStack(alignment: i == 0 ? .leading : .trailing, spacing: V5.S.s4) {
                        Text(s.label.uppercased())
                            .font(.faffText(TypeScaleV5.label12))
                            .foregroundStyle(V5.textQuiet)
                        HStack(alignment: .firstTextBaseline, spacing: V5.S.s2) {
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

    /// THE ROUTE, and then the terrain under it.
    ///
    /// This card was an elevation sparkline wearing the word "Route". The
    /// runner's own polyline — a couple of thousand characters of it, on the
    /// row — never reached this screen at all, while run detail has drawn a
    /// real map from that exact key for months.
    ///
    /// The climb beside the heading is the run's MEASURED `elevGainFt`, not a
    /// sum of the profile. Deriving it from the picture is how a run with 128
    /// recorded feet of climb came to print "0 ft up": its splits carried no
    /// elevation, the profile was a row of zeros, and zero summed to zero.
    private func routeCard(_ points: [Double]) -> some View {
        let coords = routeCoords
        return Tile {
            HStack(alignment: .firstTextBaseline) {
                Text("Route")
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textSecondary)
                Spacer(minLength: 0)
                // Nothing in this corner. "128 ft up" was here first and
                // answered a question nobody asks of a map; the axis sentence
                // that replaced it made a claim the line could not keep. The
                // climb sits under the elevation profile, which is the
                // graphic about climbing, and the per-mile reading sits in
                // the breakdown below.
            }

            if coords.count >= 2 {
                RouteMapView(coords: coords,
                             splits: model.routeSplits,
                             phases: routePhaseSamples,
                             effort: mappedEffort,
                             // No zone axis. See `RunDetailV5`'s route map for
                             // the reasoning: a line has one channel, and the
                             // breakdown under this card carries the reading
                             // as numbers instead.
                             // No band either. The map is a pace gradient
                             // normalised across this run's own range, and
                             // knows nothing about the prescription; the
                             // breakdown below keeps band adherence. See
                             // `RunDetailV5`'s route section for the ruling.
                             hrZones: [])
                    .frame(height: 200)
                    .clipShape(RoundedRectangle(cornerRadius: V5.R.r16, style: .continuous))
                    // MapKit hit-tests its region even when non-interactive,
                    // which otherwise hijacks the parent ScrollView's pan.
                    .allowsHitTesting(false)
                    // `.allowsHitTesting(false)` suppresses touch, not the
                    // accessibility tree; MKMapView publishes its overlays as
                    // children and VoiceOver walks into MapKit's furniture.
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Route map")
                // THE LINE'S COLOUR RULE, SAID IN WORDS. The card printed the
                // climb and never explained the gradient. Authored beside the
                // table's caption in `RouteMapView` so the two describe one
                // rule; see `RunDetailV5`'s route section for the ruling. Nil
                // where the run recorded no pace for the line to encode.
                if let caption = RouteMapView.routeCaption(splits: model.routeSplits,
                                                          phases: routePhaseSamples) {
                    Text(caption)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textQuiet)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                // RULE THREE. No GPS is an answer, not an empty frame.
                Text("No GPS for this run.")
                    .font(.faffText(TypeScaleV5.body15))
                    .foregroundStyle(V5.textQuiet)
            }

            // The terrain, under the route it belongs to. Drawn only when the
            // run actually recorded some — the server sends null rather than
            // a row of zeros now, so an absent profile means absent.
            if points.count > 1 {
                ElevationProfile(points: points, height: 110)
            }
            // The climb, under the graphic that is about climbing, and only
            // when an instrument measured it. `gps_derived` is arithmetic over
            // GPS altitude — it read 128 ft on a run the watch's barometer put
            // at 13, and 3195 ft on an eleven-miler the barometer put at 57.
            // Rule one: a derived number must never wear a measurement's
            // clothes, so an unmeasured climb prints nothing at all.
            if let ft = model.elevGainFt, ft > 0, model.elevGainMeasured {
                Text("\(ft) ft of climb")
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
            }
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

    // WHAT THIS SECTION IS NOT ANY MORE.
    //
    // It was "What this did", and what it held was a weekly mileage
    // percentage — 33% of 45 mi — plus the niggle row. A completion
    // percentage is not an answer to what a run changed, and the post-run
    // brief's DELETE list names it: "weekly mileage percentage as the meaning
    // of a run". The real answer now arrives typed, from the Evidence Engine,
    // through `PostRunLearnedV5`, which run detail draws from the same object.
    //
    // The percentage is NOT re-homed here. The week's progress belongs to the
    // week, it is already on Block, and this screen is about one run. Deleting
    // it is the point rather than a side effect.
    //
    // What survives is the niggle row, because it is an ACTION the runner can
    // only take here, and it keeps its own header rather than living under a
    // heading about what the coach learned.
    @ViewBuilder
    private var whatThisDidSection: some View {
        // `PostRunLearnedV5` no longer drawn here (2026-09-03) — `.capture`
        // and `.meaning` moved to Layer 1, `.strides` to Layer 2, each with
        // the rest of the section it belongs beside. This group is now
        // Layer 5's Log, exactly what its header already says it is.
        //
        // Always drawn: the picker is the only way to flag a niggle, and an
        // action the runner cannot find is an action that does not exist.
        ListGroup(header: "Log") {
            // The server's own flagged-niggle row, when it carries one.
            ForEach(model.whatThisDidToTheWeek.filter { $0.action != nil }) { row in
                ListRow(label: row.label, sub: row.sub, value: Self.fv(row.value),
                        onTap: { onRowAction(row) })
            }
            // Only when the server is not already carrying one. Its row is
            // the persisted truth (with Undo); this screen's is the picker
            // that SETS one. Both at once read as two identical rows.
            if serverFlaggedNiggle == nil {
                niggleRow
            }
            // The brief's "Add effort/RPE where supported", grouped with the
            // rest of this screen's log-and-share actions rather than sitting
            // in the analytical story above (post-run brief §"Actions").
            if let runId = model.runId {
                RPECaptureRow(runId: runId)
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
                            .padding(.horizontal, V5.S.s14)
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
        { "id": "distance", "label": "Distance", "sub": "asked 6 mi", "value": { "text": "6 mi", "modelled": false }, "action": null },
        { "id": "r1", "label": "Pace", "sub": "8:50–9:35", "value": { "text": "9:02", "modelled": false }, "action": null },
        { "id": "r2", "label": "Heart", "sub": "under 148", "value": { "text": "141", "modelled": false }, "action": null },
        { "id": "r3", "label": "Effort", "sub": "3 to 6", "value": null, "action": "log_effort" }
      ],
      "verdict": "Sat in the band all the way bar mile five, which crept thirty seconds quick. Pull that one back and this is a clean easy day.",
      "facts": ["6.02 mi at 9:02/mi, HR averaged 141."],
      "win": "Easy and honest \\u00b7 legs stayed fresh",
      "conditionsNote": null,
      "coachTip": "Mile five ran hot. Worth a check on effort next time it happens twice in a row.",
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

    // ─────────────────────────────────────────────────────────────────────
    // THE DAY THE TABLE HAD NOTHING TO SAY ABOUT THE BIGGEST THING THAT
    // HAPPENED. 2026-08-23, read out of production on 2026-08-24: the plan
    // asked for a 5 mile medium-long and the runner covered 11.01 in 1:28:18,
    // averaging 147 bpm over 3195 feet of climb. Asked-vs-ran showed pace,
    // heart and effort.
    //
    // Note what the Distance row does NOT do here. Six extra miles carry no
    // tone, no chevron and nothing tappable, exactly as a wrist decision
    // would not — the screen does not know whether the runner felt good and
    // added, or ran a route that came out long, and inking it would grade
    // both as faults. It states the two numbers and lets the verdict, which
    // has the context, do the talking.
    static let overshot: V5Today = decode(overshotJSON)

    private static let overshotJSON = """
    {
      "dateISO": "2026-08-23",
      "state": "after_run",
      "panel": {
        "dayState": "long",
        "quiet": false,
        "place": "Today",
        "dateLine": "Maintenance",
        "weekLine": "Logged 7:22",
        "kicker": null,
        "type": "Medium-long",
        "dose": null,
        "stats": [
          { "label": "Distance", "value": { "text": "11.0", "modelled": false }, "tone": null },
          { "label": "Time", "value": { "text": "1:28:18", "modelled": false }, "tone": null },
          { "label": "Pace", "value": { "text": "8:01", "modelled": false }, "tone": null }
        ]
      },
      "weekStrip": [],
      "groups": [],
      "why": null,
      "whereYouAre": [],
      "beforeYouGo": [],
      "askedVsRan": [
        { "id": "distance", "label": "Distance", "sub": "asked 5 mi", "value": { "text": "11 mi", "modelled": false }, "action": null },
        { "id": "pace", "label": "Pace", "sub": "9:22", "value": { "text": "8:01", "modelled": false }, "action": null },
        { "id": "heart", "label": "Heart", "sub": null, "value": { "text": "147", "modelled": false }, "action": null },
        { "id": "effort", "label": "Effort", "sub": null, "value": null, "action": "log_effort" }
      ],
      "verdict": "Six miles past what the day asked for, at a minute a mile quicker. Good legs, but that was tomorrow's session spent today.",
      "facts": [
        "11.0 mi at 8:01/mi, HR averaged 147.",
        "3195 ft of climb, which is most of why the effort held at that pace."
      ],
      "win": null,
      "conditionsNote": null,
      "coachTip": "Tomorrow was easy and it still is. Take it slower than feels right.",
      "zoneShares": [4, 41, 38, 15, 2],
      "zoneTarget": 2,
      "zoneTargets": [2],
      "elevation": [220, 480, 760, 1010, 880, 1240, 1490, 1180, 900, 610, 300],
      "onTheBelt": null,
      "shoesWorn": null,
      "whatThisDidToTheWeek": [
        { "id": "w1", "label": "This week", "sub": "24.2 of 38 mi done", "value": { "text": "64%", "modelled": false }, "action": null }
      ],
      "runId": "run_aug23",
      "changed": null,
      "injury": null,
      "weekOff": null,
      "offSeason": null,
      "notOnPhoneYet": null
    }
    """
}
