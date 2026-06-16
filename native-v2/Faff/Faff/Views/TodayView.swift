//
//  TodayView.swift
//  v3 Today tab · effort readout. Mesh re-tints to the selected day's effort.
//
//  Per locked design intent:
//   · Today day card pops MORE, not less (selected day elevates)
//   · 7-day week strip: tapping a day repaints the hero in place (does NOT
//     push the workout detail overlay · that's a Train-only behavior)
//   · Hero is "effort readout", not a slider · labeled pointer on a gradient
//   · Drag-up sheet reveals workout breakdown + conditions + coach
//

import SwiftUI

struct TodayView: View {
    let onProfile: () -> Void
    @Binding var selectedTab: FaffTab

    // Hydrate from AppCache on first render so the runner sees their
    // last-known plan + workout + readiness instantly. The .task reload
    // refreshes in the background. Previously all started nil and the
    // hero / week strip / drag sheet showed "—" / empty / fallback type
    // labels until the network round-trip resolved · which is why a
    // brief auth blip felt like the whole tab had no data.
    @State private var plan: PlanWeek? =
        AppCache.read(.planWeek, as: PlanWeek.self)
    @State private var workout: WatchWorkout? =
        AppCache.read(.todayWorkout, as: TodayWorkoutWrapper.self)?.workout
    @State private var readiness: ReadinessSnapshot? =
        AppCache.read(.readiness, as: ReadinessSnapshot.self)
    @State private var briefing: Briefing? =
        AppCache.read(.todayBriefing, as: Briefing.self)
    @State private var profile: ProfileState? =
        AppCache.read(.profileState, as: ProfileState.self)
    @State private var selectedDayID: String = ""
    @State private var selectedWeekIndex: Int = 0
    @State private var sheetProgress: Double = 1     // 1 = collapsed
    @State private var skipped: Bool = false
    @State private var showSkipConfirm: Bool = false
    /// date_iso strings the strength recommender picked for the current week ·
    /// drives the strip underline + the Today nudge. Seeded from the cached
    /// training-state (instant), refreshed in loadAll.
    @State private var strengthDays: Set<String> = {
        guard let ts = AppCache.read(.trainingState, as: TrainingState.self) else { return [] }
        // Union ALL weeks so strength shows ahead (the backend now fills the
        // current + next week), not just the current one.
        return Set(ts.weeks.flatMap { $0.recommendedStrengthDays ?? [] })
    }()
    /// ISO dates a strength session was logged (current week) · drives the
    /// green "done" underline + nudge.
    @State private var strengthDoneDays: Set<String> = {
        guard let ts = AppCache.read(.trainingState, as: TrainingState.self),
              let cur = ts.weeks.first(where: { $0.isCurrent }) else { return [] }
        return Set(cur.completedStrengthDays ?? [])
    }()
    /// True when the readiness gate paused this week's strength · drives a
    /// yellow "Strength paused · readiness low" note so the empty strip reads
    /// as intentional, not a bug.
    @State private var strengthSuppressed: Bool = {
        guard let ts = AppCache.read(.trainingState, as: TrainingState.self),
              let cur = ts.weeks.first(where: { $0.isCurrent }) else { return false }
        return cur.strengthSuppressed ?? false
    }()
    /// Days strength WOULD be on this week but the readiness gate paused it ·
    /// drives the yellow "paused" underline on the strip.
    @State private var strengthPausedDays: Set<String> = {
        guard let ts = AppCache.read(.trainingState, as: TrainingState.self),
              let cur = ts.weeks.first(where: { $0.isCurrent }) else { return [] }
        return Set(cur.pausedStrengthDays ?? [])
    }()
    @State private var showNudge: Bool = false
    @State private var refreshing: Bool = false
    @State private var dayWorkout: WatchWorkout?   // workout fetched for a non-today selected day
    /// Prefetched per-day workout + forecast, keyed by date_iso. Filled in the
    /// background after loadAll so tapping a strip day renders from cache
    /// instantly instead of popping the detail in on a network round-trip
    /// (David 2026-06-12 · "load the days in the background").
    @State private var workoutCache: [String: WatchWorkout] = [:]
    @State private var forecastCache: [String: DailyForecast] = [:]
    @State private var weather: WeatherBaseline?   // forecast vs 14-day baseline · drives the HOTTER THAN USUAL tag
    /// Display-ready forecast for the selected day · /api/forecast/<date>.
    /// range_label + best_window are pre-composed server-side per the
    /// web agent's brief; iPhone renders them directly into the
    /// CONDITIONS & KIT 2x2 grid. Refetches on day-strip selection.
    @State private var forecast: DailyForecast?
    @State private var stravaStatus: API.StravaStatusResponse?  // drives the reconnect banner
    /// "WHY THIS RUN" coach payload · /api/today/purpose. Replaces the
    /// legacy briefing?.lead placeholder ("Stay in the temperature for
    /// the day..."). The whole Faff Coach block hides when this is nil ·
    /// no hardcoded fallback. The empty state IS the honest signal.
    @State private var purpose: RunPurpose?
    /// 2026-06-02 round 58 · post-run pivot brief · drives the 5
    /// recovery sections when isPostRunMode is true. Nil during
    /// morning OR before backend B1 ships (forward-compat). View
    /// renders empty-state cleanly when nil.
    @State private var recoveryBrief: RecoveryBrief?
    /// Fallback anchor race when /api/today/purpose returns nil (e.g.
    /// the backend 500 we hit 2026-06-02). Resolved from /api/races
    /// by highest-priority future race (A > B > C), tie-broken by
    /// earliest date. Powers the TO RACE chip so it lights up even if
    /// purpose is down. Cleared once purpose resumes returning a value.
    @State private var raceFallback: RaceListItem?
    /// Most-recent plan_adapt_* intent · drives AdaptationCard. Hidden
    /// when nil or older than 24h.
    @State private var adaptationIntent: CoachIntent?
    /// Active niggle row · drives DailyCheckChip + niggle-aware copy.
    @State private var activeNiggle: NiggleRow?
    /// Active sick episode · drives ReturnGateCard. Nil when no active episode.
    @State private var activeSick: SickRow?
    /// Daily check selection (better/same/worse/gone). Local · POSTs
    /// to /api/niggle/recovery on tap.
    @State private var niggleCheck: NiggleStatus? = nil
    /// Symptom report sheet toggle (Niggle | Sick).
    @State private var showSymptomSheet: Bool = false
    /// Log non-run sheet toggle (Strength | Cross-train).
    @State private var showLogNonRunSheet: Bool = false
    /// Pending coach proposals stack · drives the COACH PROPOSALS strip
    /// above the hero. Each card opens NudgeSheet for accept/decline.
    @State private var pendingProposals: [PendingProposal] = []
    /// Per-day shoe picker · POSTs the override to /api/today/shoe.
    @State private var showShoePicker: Bool = false
    /// Currently-selected shoe for the displayed run · drives the SHOE
    /// cell in the pre-run body. Hydrates from /api/today/shoe in a
    /// future round; today this is purely local state that updates on
    /// the runner's pick + persists for the rest of the session.
    @State private var selectedShoe: Shoe? = nil
    /// Shoe garage from /api/shoe · fetched on appear + lazily on
    /// picker-open as a belt-and-suspenders. /api/profile/state's
    /// `shoes` field was nil in prod for David which made the picker
    /// render "No active shoes in your garage" even though his garage
    /// has shoes. The dedicated endpoint returns [Shoe] directly with
    /// the right shape (Int ids, no string-prefix mapping needed).
    @State private var shoeGarage: [Shoe] = []
    /// Notification inbox sheet (past pushes + acks).
    @State private var showInbox: Bool = false
    /// Async-fetch lifecycle for /api/plan/week (the primary signal for
    /// this tab · drives hero + week strip + drag sheet). Banner shows
    /// only when fetch errors AND no cached PlanWeek exists.
    @State private var loadState: LoadState = AppCache.read(.planWeek, as: PlanWeek.self) == nil ? .idle : .loaded
    /// Time-of-day for the mesh background (2026-06-01 redesign).
    /// Re-evaluated whenever the app foregrounds (handled below) so the
    /// runner who leaves the app open across an hour boundary still sees
    /// the right palette when they come back. Initial value is from now.
    @State private var timeOfDay: TimeOfDay = TimeOfDay.current()
    /// 2026-06-02 round 42 · observe the HK importer so the LAST NIGHT
    /// chip updates the moment a background→foreground triggered import
    /// lands (importer publishes `lastNightHours` and the view re-renders).
    /// Without this the chip would only refresh on the next loadAll cycle.
    @ObservedObject private var hkImporter: HealthKitImporter = .shared
    /// This-week mileage · drives the THIS WEEK readiness stat chip.
    /// Hydrated from /api/training/state inside loadAll().
    @State private var thisWeekMiles: Double?
    /// Toggles the full readiness brief sheet (2026-06-01) · tap on the
    /// readiness panel hero presents this. Sheet hydrates from
    /// /api/readiness/brief inside its own .task.
    /// (VO₂ MAX chip removed from the panel · AFC fix 10 · VO₂ lives on Health.)
    @State private var showReadinessBrief: Bool = false
    @State private var glossaryEntry: GlossaryEntry? = nil
    /// Post-run RunDetail · hydrated when the selected day has a
    /// completedRunId. Drives the Today v2 post-run sheet body
    /// (designs/from Design agent/Today page v2/).
    @State private var completedDetail: RunDetail?
    /// Post-run RunRecap · verdict + facts + (future) `win` line.
    @State private var completedRecap: RunRecap?
    /// Adjacent-week plans · fetched in parallel with the current week.
    /// prevWeekPlan = 1 week back; futureWeekPlans = 4 weeks ahead.
    /// Combined with current week = ~35 days of scroll depth.
    @State private var prevWeekPlan: PlanWeek? = nil
    @State private var futureWeekPlans: [PlanWeek] = []

    var body: some View {
        // 2026-06-08 · race-morning takeover. The brief is categorical:
        // "Race day. The race takes the page." When today's plan workout is
        // the A-race and it's actually today (and not yet logged), the whole
        // Today surface becomes RaceDayView — the same component Targets
        // pushes to, now auto-promoted here so race morning stops rendering
        // the generic .race-styled pre-run sheet. Every other day falls
        // through to the normal readiness / pre-run / recovery body.
        if let slug = raceDayRouteSlug {
            RaceDayView(raceSlug: slug)
                .task { await loadAll() }
                .onReceive(NotificationCenter.default.publisher(for: .faffForegroundRefresh)) { _ in
                    Task { await loadAll() }
                }
        } else {
            mainBody
        }
    }

    /// Slug to route Today into RaceDayView on race morning, else nil.
    /// Mirrors the web gate (daysAway===0 && the selected day is the race
    /// date && not yet logged): the selected day is today, today's plan
    /// workout resolves to the race effort, the profile's A-race is actually
    /// today, and the run isn't logged yet (once done, Today shows the
    /// recap). nil on every other day, so the normal body renders unchanged.
    private var raceDayRouteSlug: String? {
        guard selectedIsToday, !isDone, selectedEffort == .race else { return nil }
        guard let nr = profile?.nextARace, !nr.slug.isEmpty else { return nil }
        guard nr.days_to_race == 0 || nr.date == todayISO else { return nil }
        return nr.slug
    }

    // @ViewBuilder restores what the `body` protocol requirement carried
    // implicitly (multi-statement body: `let mesh = …` then the ZStack).
    @ViewBuilder
    private var mainBody: some View {
        // AFC task 8 + brief v2 §8 (2026-06-09) · Today's default canvas is
        // CHARCOAL NEUTRAL. The time-of-day mesh (2026-06-01) is retired
        // from the background · the hour still drives the greeting eyebrow
        // (TimeOfDay.greeting) and per-run accents still tint the week dot
        // · peek/session ticks · Start dot. Race morning never reaches
        // this body (raceDayRouteSlug routes to RaceDayView, which carries
        // the dedicated race mesh via FaffEffort.race.mesh).
        let mesh = FaffMesh.neutral
        ZStack {
            FaffMeshView(mesh: mesh)

            VStack(spacing: 0) {
                // Clearance for globalTopBar (50pt) + week strip (80pt + 2pt pad = 82pt).
                // WeekStrip is promoted to its own ZStack layer above the top scrim
                // so it always renders crisp. Content scrolling behind it fades
                // through the gradient scrim rather than hard-clipping at the strip.
                Color.clear.frame(height: 132)

                StravaReconnectBanner(status: stravaStatus)
                    .padding(.horizontal, 22)
                    .padding(.top, 10)

                if let msg = loadState.failureMessage, plan == nil {
                    FailedLoadBanner(message: msg, retry: { Task { await loadAll() } })
                        .padding(.horizontal, 22)
                        .padding(.top, 10)
                }

                // 2026-06-02 round 38 · AdaptationCard hidden from
                // Today's hero. The "FAFF · Plan adapted · overridden"
                // copy was vague and not actionable · runner couldn't
                // tell what changed, from what to what, or why. The
                // adaptationIntent state still fetches and is passed
                // down to the pre-run sheet body for context. Re-enable
                // here once backend ships the structured from/to copy
                // (designs/briefs/adaptation-intent-structured-from-to.md).

                // COACH PROPOSALS strip · stack of pending swap/injury/
                // illness proposals from /api/coach/proposals. Tap accept
                // or decline routes through /api/coach/proposal (singular).
                ForEach(pendingProposals) { p in
                    proposalCard(p)
                        .padding(.horizontal, 22)
                        .padding(.top, 10)
                }

                // DailyCheckChip · once a niggle is active, ask daily.
                if let n = activeNiggle {
                    DailyCheckChip(bodyPart: n.body_part,
                                   selection: $niggleCheck,
                                   onSelect: { handleNiggleCheck($0) })
                        .padding(.horizontal, 22)
                        .padding(.top, 10)
                }

                // ReturnGateCard · shown while a sick episode is active.
                // "Yes, ease me back" posts recovered → clears the episode.
                // "Still resting" posts same → episode stays open.
                if let s = activeSick {
                    ReturnGateCard(
                        pausedDaysAgo: s.daysActive,
                        symptoms: s.symptoms,
                        onReturn: { Task { await handleSickReturn() } },
                        onStillResting: { Task { await handleStillResting() } }
                    )
                    .padding(.horizontal, 22)
                    .padding(.top, 10)
                }

                // 2026-06-02 round 58 · Today screen post-run pivot
                // (designs/briefs/today-postrun-pivot-execution.md +
                // /Users/david/Downloads/design_handoff_today_postrun_pivot).
                // 2026-06-02 round 61 · past-day flat-recap added.
                //
                // 3-way branch:
                //   past day       → flat recap, no drag-sheet, no hero
                //                    (morning decision furniture is
                //                    irrelevant on a historical day)
                //   today + done   → 5 recovery sections (A-E)
                //   today + ready  → readiness ring + 4 pillars + 6 chips
                //
                // Mode is gated on selectedIsToday + completedRunId for
                // V1. When backend B2 ships envelope flags
                // (todayRunDone + todayRunLong) the gate flips to
                // those · doctrine-correct (catches non-prescribed runs
                // too). Hard rule: once postRun fires, stays until
                // midnight rolls (no pivot BACK to morning).
                if isPastDayView {
                    // Flat recap · no DragSheet, no readiness/recovery
                    // hero, just the run recap on the mesh.
                    //
                    // 2026-06-03 round 69 · two layered fixes:
                    //
                    // (a) LEGIBILITY · a dark gradient scrim sits
                    //     BEHIND the recap content. The mesh stays
                    //     visible at the top edge (time-of-day identity
                    //     preserved through the header + week strip),
                    //     fades to ~28% black behind the recap so
                    //     white text + green pills + dividers all have
                    //     proper contrast against the warm palette.
                    //     Replaces the round-62 "transparent everything"
                    //     approach which left dark text floating on
                    //     warm orange.
                    //
                    // (b) HORIZONTAL PAN · GeometryReader + the inner
                    //     VStack already had .frame(width: proxy.size.
                    //     width). Round 67 wasn't enough — adding
                    //     .frame on the ScrollView itself + .clipped()
                    //     on BOTH the ScrollView AND the wrapping
                    //     ZStack. SwiftUI's vertical ScrollView can
                    //     still expose horizontal overflow if any
                    //     child sizes itself wider than the frame
                    //     declaration. The double-clip is the catch.
                    GeometryReader { proxy in
                        ZStack(alignment: .top) {
                            // Scrim layer · subtle dark wash for
                            // contrast. Top 80pt is fully transparent
                            // so the week strip + greeting + bell row
                            // above keep the mesh identity. Below that
                            // the scrim ramps to ~28% black so the
                            // recap content reads cleanly.
                            LinearGradient(
                                stops: [
                                    .init(color: Color.clear, location: 0),
                                    .init(color: Color.black.opacity(0.28), location: 0.18),
                                    .init(color: Color.black.opacity(0.32), location: 1.0),
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                            .allowsHitTesting(false)
                            ScrollView(.vertical, showsIndicators: false) {
                                VStack(alignment: .leading, spacing: 0) {
                                    if isDone {
                                        postRunBody
                                    } else {
                                        pastDayNoRunStub
                                    }
                                }
                                .frame(width: proxy.size.width, alignment: .leading)
                                .padding(.bottom, 100)
                            }
                            .frame(width: proxy.size.width, height: proxy.size.height)
                            .ignoresSafeArea(edges: .bottom)
                            .scrollClipDisabled(true)
                        }
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .ignoresSafeArea(edges: .bottom)
                    }
                    .padding(.top, 8)
                } else if isPostRunMode {
                    // Show the run directly on the main canvas — same flat
                    // layout as past-day recaps. DragSheet is suppressed
                    // in this mode (see gate below). The recovery panel
                    // (TodayRecoveryPanel) was here previously but the
                    // readiness score is orphaned now that the reactive
                    // coach layer is unmounted.
                    ScrollView(.vertical, showsIndicators: false) {
                        VStack(alignment: .leading, spacing: 0) {
                            postRunBody
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.bottom, 100)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .ignoresSafeArea(edges: .bottom)
                    .padding(.top, 6)
                    .scrollClipDisabled(true)
                } else if isNoGoalState {
                    // No race and no goal — hero empty state for new users
                    // who completed onboarding without setting a target.
                    noGoalHeroView
                } else {
                    // Run is always front and center. Readiness lives in the drag sheet.
                    ScrollView(showsIndicators: false) {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(isSkippedToday ? "SKIPPED" : selectedEffort.title.uppercased())
                                .font(.heroDisplay(88))
                                .tracking(-2)
                                .foregroundStyle(isSkippedToday ? Color(hex: 0x7E8794) : selectedEffort.dot)
                                .minimumScaleFactor(0.55)
                                .lineLimit(1)
                                .padding(.horizontal, 22)
                                .padding(.top, 6)
                            heroBlock
                                .padding(.horizontal, 22)
                                // Pull up into the 88pt headline's line-box
                                // whitespace (descender) so the gap below EASY
                                // matches the gap above it — was +16, which on
                                // top of the descender read as "too far down".
                                .padding(.top, -12)
                                .padding(.bottom, 220)
                        }
                    }
                    .scrollClipDisabled(true)
                    .opacity(max(0.05, 1.0 - (1 - sheetProgress) * 1.1))
                    .offset(y: -22 * (1 - sheetProgress))
                }

                // Spacer pushes the hero + DragSheet up in pre-run mode.
                // Suppressed on past days, post-run, and the no-goal empty state.
                if !isPastDayView && !isPostRunMode && !isNoGoalState {
                    Spacer(minLength: 0)
                }
            }
            // Dissolve bleeding scroll content into the mesh (shared modifier).
            // scrollClipDisabled lets the hero (e.g. the giant TEMPO) ride UP
            // behind the frosted strip — desired — but it kept going up into
            // the transparent top-bar zone too. Strip-tuned params: fully
            // CLEAR across the top-bar zone AND the strip's top edge (≈y0–56,
            // strip starts ~y50), with the clear→opaque ramp landing BEHIND
            // the frosted strip (y56–80) so the dissolve is blurred away;
            // content re-emerges softly behind the lower strip and below.
            .faffHeaderDissolve(clearTo: 56, opaqueAt: 80)

            // DragSheet suppressed on past days and today-post-run.
            // On past days the flat recap is the whole page.
            // On today-post-run the run is shown directly on the canvas.
            if !isPastDayView && !isPostRunMode && !isNoGoalState {
                DragSheet(
                    // 2026-06-02 round 25 · 150 → 180.
                    // 2026-06-02 round 46 · 180 → 200.
                    // 2026-06-11 · 200 → 170. Pill shrank (62→50) and
                    // moved down (14→4pt pad), so the pill zone dropped.
                    // 2026-06-12 · 170 → 200. Tab bar lifted (4→24pt pad), so
                    // the peek rises with it to keep clear air above the bar.
                    collapsedInsetFromBottom: 200,
                    // 2026-06-12 · cap the EXPANDED top just under the week
                    // strip. +44 slid under the strip (handle hidden); +140
                    // left too much gap (David: "more room here"). +110 tucks
                    // it a touch below the strip. One-number tweak if needed.
                    minTopOffset: screenSafeAreaTop + 110,
                    progress: $sheetProgress,
                    peekBackground: peekFill,
                    bodyBackground: peekFill,
                    grabTint: Color.white.opacity(0.35),
                    header: { peekHeader },
                    content: { sheetContent }
                )
            }

            // 2026-06-01 · Start Run / Share Run button.
            //
            // Pre-run (today, not rest): tap surfaces a SwiftUI Menu with
            //   Outdoor → WatchMirrorView (Apple-Watch-paired GPS run)
            //   Treadmill → TreadmillView (guided indoor console)
            // Each option is its own NavigationLink so tapping either
            // pushes directly · no path-state plumbing.
            // Rest day: "Log Recovery" → planned/today recovery surface.
            // Post-run: bar HIDDEN · per the v2 feedback round, the
            // Share Run CTA was burying the post-run body. The post-run
            // sheet body carries a small "View full run ›" link at the
            // bottom instead (inside TodayPostRunBody).
            //
            // Today v2 brief: "the start run or share run so its not
            // hidden" · the StickyCTABar respects the tab-bar safe area
            // (no .ignoresSafeArea(.bottom)) so the button sits just
            // above the floating tab bar pill.
            // 2026-06-02 round 18 · the bottom Start/Treadmill CTA bar
            // is suppressed entirely while we wait for the new tab-bar
            // design that will own run-launch affordances. Removes:
            //   · "Start <Run>" primary CTA
            //   · "Treadmill instead" subtle link
            //   · Outdoor / Apple Watch / Treadmill copy on this surface
            // The underlying routes (.watchMirror / .treadmill) stay
            // intact so the new menu can wire them up cleanly. Pre-run
            // sheet's own "Skip this run" footer is unaffected (lives
            // inside TodayPreRunBodyV3 · separate concern).

        }
        // Week strip + header scrim as .overlay on the ZStack — this is the
        // only placement guaranteed to render above scrollClipDisabled overflow.
        // ZStack siblings lose to scroll overflow in UIKit's layer ordering;
        // an overlay is added as a separate UIView after the ZStack's subtree.
        .overlay(alignment: .top) {
            VStack(spacing: 0) {
                // Invisible spacer · holds the week strip in its place below
                // the top bar. The opaque Theme.bg band that used to live here
                // was the hard-line source (flat fill over the gradient mesh);
                // content is now dissolved by the .mask on the content stack
                // above, so this only needs to reserve the strip's offset.
                Color.clear
                    .frame(height: 50)
                    .ignoresSafeArea(edges: .top)
                    .allowsHitTesting(false)
                if !allStripWeeks.isEmpty {
                    WeekStrip(weeks: allStripWeeks, selectedID: $selectedDayID, weekIndex: $selectedWeekIndex)
                        // Symmetric vertical inset · the day cells center inside
                        // the strip, so a top-only inset left more buffer above
                        // the row than below. Match it on the bottom.
                        .padding(.vertical, 2)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .stroke(Theme.line, lineWidth: 1)
                        )
                        .padding(.horizontal, 12)
                }
            }
            .frame(maxWidth: .infinity)
        }
        .task {
            await loadAll()
        }
        .onReceive(NotificationCenter.default.publisher(for: .faffForegroundRefresh)) { _ in
            // Runner returned from Safari (Strava OAuth) or just brought
            // the app forward · refresh plan/workout/readiness/strava
            // status so stale surfaces don't linger past the foreground
            // transition. Also re-evaluate time-of-day so an app left
            // open across an hour boundary still shows the right mesh.
            timeOfDay = TimeOfDay.current()
            Task { await loadAll() }
        }
        .onChange(of: selectedWeekIndex) { _, newIdx in
            // User swiped to a different week · update the selected day.
            // Prefer today if this week contains it, else land on the first day.
            guard newIdx < allStripWeeks.count else { return }
            let week = allStripWeeks[newIdx]
            if let today = week.first(where: { $0.isToday }) {
                withAnimation(Theme.Motion.smooth) { selectedDayID = today.id }
            } else if let first = week.first {
                withAnimation(Theme.Motion.smooth) { selectedDayID = first.id }
            }
        }
        .task(id: selectedDayID) {
            // Tapped a day in the week strip · fetch that day's planned
            // workout so the drag sheet + hero reflect Sunday's long run
            // instead of today's rest day, etc. Using .task(id:) cancels
            // the previous in-flight fetch when the selection changes, so
            // rapid taps don't produce racing results.
            guard !selectedDayID.isEmpty else { return }
            if selectedDayID == todayISO {
                // Today's workout was already loaded by loadAll().
                await MainActor.run { dayWorkout = nil }
            } else {
                // Seed from the prefetch cache FIRST so the hero + sheet render
                // instantly — no pop. A nil seed (uncached day) clears the
                // previous day's stale detail; the refresh below fills it.
                await MainActor.run {
                    dayWorkout = workoutCache[selectedDayID]
                    forecast = forecastCache[selectedDayID]
                }
                if let w = try? await API.fetchWatchWorkout(date: selectedDayID) {
                    await MainActor.run {
                        dayWorkout = w
                        workoutCache[selectedDayID] = w
                    }
                }
            }
            // Today v2 · also refetch RunDetail + RunRecap for the
            // new selected day's completion (or null them out when
            // the new day isn't completed).
            let runId = await MainActor.run { completedRunId }
            if let id = runId {
                async let d = (try? await API.fetchRunDetail(id: id))
                async let rc = (try? await API.fetchRunRecap(runId: id))
                let (det, rec) = await (d, rc)
                await MainActor.run {
                    self.completedDetail = det
                    self.completedRecap = rec
                }
            } else {
                await MainActor.run {
                    self.completedDetail = nil
                    self.completedRecap = nil
                }
            }
            // 2026-06-02 · refresh forecast for the newly selected day.
            // Only overwrite on a real value so a transient nil doesn't wipe
            // the cache-seeded forecast (and so switching days never blanks).
            if let f = try? await API.fetchDailyForecast(date: selectedDayID) {
                await MainActor.run {
                    self.forecast = f
                    self.forecastCache[selectedDayID] = f
                }
            }
        }
        .sheet(isPresented: $showNudge) {
            NudgeSheet(
                onAccept: { showNudge = false },
                onKeep: { showNudge = false },
                readiness: readiness
            )
        }
        .sheet(isPresented: $showSymptomSheet) {
            SymptomReportSheet(onSubmitted: { Task { await loadAll() } })
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showLogNonRunSheet) {
            LogNonRunSheet(onSubmitted: { Task { await loadAll() } })
                .presentationDetents([.medium])
        }
        .sheet(isPresented: $showShoePicker) {
            // 2026-06-01 round 8 · new TodayShoePicker (cream bottom sheet
            // per design package #3). Maps ProfileShoe → Shoe for the
            // picker, persists via /api/today/shoe, updates selectedShoe
            // so the SHOE cell reflects the new pick immediately.
            TodayShoePicker(
                shoes: pickerShoes,
                selectedId: selectedShoe?.id,
                accent: selectedEffort.dot,
                onSelect: { shoe in
                    selectedShoe = shoe
                    showShoePicker = false
                    Task {
                        let date = selectedDayID.isEmpty ? todayISO : selectedDayID
                        _ = try? await API.setShoeForDay(date: date, shoeId: shoe.id)
                        await loadAll()
                    }
                },
                onClose: { showShoePicker = false }
            )
            .presentationDetents([.medium])
            .presentationBackground(.clear)
            .presentationDragIndicator(.hidden)
        }
        .sheet(isPresented: $showInbox) {
            NotificationInboxSheet()
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showReadinessBrief) {
            // Full readiness brief sheet · 2026-06-01 redesign.
            // Presents full-height by default; the SwiftUI .large detent
            // matches the spec's full-screen-with-64pt-peek model when
            // the parent Today still renders behind via the mesh.
            ReadinessBriefSheet(timeOfDay: timeOfDay)
                .presentationDetents([.large])
                .presentationBackground(.clear)
                .presentationDragIndicator(.hidden)   // sheet draws its own grabber
        }
        .sheet(item: $glossaryEntry) { e in GlossarySheet(entry: e) }
    }

    // MARK: - Coach proposal card

    /// Minimal accept/decline card for one pending proposal. Tap accept
    /// to POST /api/coach/proposal action="accept"; decline POSTs
    /// action="decline". Both bust the briefing cache; reload after.
    private func proposalCard(_ p: PendingProposal) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("PROPOSAL")
                .font(.body(9, weight: .extraBold))
                .tracking(1.5)
                .foregroundStyle(Theme.bg)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(Theme.Accent.amberBright, in: Capsule())
            VStack(alignment: .leading, spacing: 6) {
                Text(p.suggested.isEmpty ? proposalTitle(p.proposal_type) : p.suggested)
                    .font(.body(13.5, weight: .extraBold))
                    .foregroundStyle(Theme.txt)
                    .fixedSize(horizontal: false, vertical: true)
                if !p.reason.isEmpty {
                    Text(p.reason)
                        .font(.body(11.5, weight: .medium))
                        .foregroundStyle(Theme.txt.opacity(0.82))
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 8) {
                    Button("ACCEPT") { decideProposal(p, action: "accept") }
                        .font(.body(11, weight: .extraBold))
                        .tracking(0.8)
                        .foregroundStyle(Theme.bg)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(Theme.Accent.mintReady, in: Capsule())
                    Button("DECLINE") { decideProposal(p, action: "decline") }
                        .font(.body(11, weight: .extraBold))
                        .tracking(0.8)
                        .foregroundStyle(Theme.txt)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(Theme.Glass.fill, in: Capsule())
                        .overlay(Capsule().stroke(Theme.Glass.line, lineWidth: 1))
                }
            }
        }
        .padding(14)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rCard, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard, style: .continuous).stroke(Theme.Accent.amberBright.opacity(0.35), lineWidth: 1))
    }
    private func proposalTitle(_ t: String) -> String {
        switch t {
        case "injury_adjust":  return "Proposed: ease the plan around your niggle"
        case "illness_adjust": return "Proposed: pause the plan while you recover"
        case "swap":           return "Proposed: swap today's workout"
        default:               return "Coach has a proposal"
        }
    }
    private func decideProposal(_ p: PendingProposal, action: String) {
        Task {
            var req = URLRequest(url: API.baseURL.appendingPathComponent("api/coach/proposal"))
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let body: [String: Any] = [
                "action": action,
                "proposal": ["id": p.id, "type": p.proposal_type]
            ]
            req.httpBody = try? JSONSerialization.data(withJSONObject: body)
            _ = try? await API.authedSend(req)
            await loadAll()
        }
    }

    /// Pip on the bell when readiness drops materially below baseline.
    /// Threshold: score < 65 (the band where coach intervenes per design).
    private var hasNudge: Bool {
        (readiness?.score ?? 100) < 65
    }

    // MARK: - Hero

    private var heroBlock: some View {
        VStack(alignment: .leading, spacing: 0) {
            if isSkippedToday {
                skippedHeroDetail
            } else {
                runHeroDetail
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // Custom bottom sheet instead of .confirmationDialog — the system
        // dialog anchored as a popover over the scrolled hero (David: "pops up
        // in a weird place"). A sheet always seats at the bottom.
        .sheet(isPresented: $showSkipConfirm) { skipConfirmSheet }
    }

    /// Minimal hero shown when today's run is skipped: acknowledgement + an
    /// undo. No stats / steps / pills — those describe a run that isn't
    /// happening. (David 2026-06-12)
    @ViewBuilder private var skippedHeroDetail: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("You skipped today's \(skippedRunNoun). Your plan keeps moving.")
                .font(.body(15))
                .foregroundStyle(Theme.txt.opacity(0.6))
                .fixedSize(horizontal: false, vertical: true)
            Button { unskipTodayAction() } label: {
                HStack(spacing: 7) {
                    Image(systemName: "arrow.uturn.backward")
                        .font(.system(size: 13, weight: .bold))
                    Text("Undo skip")
                        .font(.body(15, weight: .semibold))
                }
                .foregroundStyle(Color(hex: 0x8FD0FF))
            }
            .buttonStyle(.plain)
        }
        .padding(.top, 14)
    }

    @ViewBuilder private var runHeroDetail: some View {
        VStack(alignment: .leading, spacing: 0) {

            // Weather chip — right-aligned, only shown when heat is meaningful
            if let t = weather?.tempF, t > 10, t < 130 {
                HStack { Spacer(minLength: 0); HeatBandChip(band: HeatBand.from(tempF: t), tempLabel: "\(Int(t.rounded()))°F") }
            } else if let tag = weatherTagLabel {
                HStack {
                    Spacer(minLength: 0)
                    Text(tag)
                        .font(.label(9)).tracking(1.5)
                        .foregroundStyle(Color(hex: 0x1C0A02))
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(weatherTagColor, in: RoundedRectangle(cornerRadius: 5))
                }
            }

            // Big stat row — numbers are the hero
            if heroStatsPresent {
                HStack(alignment: .bottom, spacing: 0) {
                    heroStat(key: "DISTANCE",    value: distanceStr)
                    heroStat(key: "TARGET PACE", value: paceStr)
                    if let t = estTimeStr {
                        heroStat(key: "TIME", value: t)
                    }
                }
                // Tightened 20 → 14 · with the 88pt headline's descender +
                // heroBlock's -12 pull-up, the gap below EASY read wider than
                // the gap above it (David). This evens them.
                .padding(.top, 14)
            }

            // All run types use the same step-list layout.
            // Structured workouts use real phases; easy/long fall back to
            // a synthetic single-row so every run has consistent structure.
            let steps = heroSteps.isEmpty ? syntheticHeroSteps : heroSteps
            if !steps.isEmpty {
                HeroStepList(steps: steps, effort: selectedEffort)
                    .padding(.top, 22)
            }

            // Coach cue · one sentence from /api/today/purpose
            if let cue = heroCueLine {
                Text(cue)
                    .font(.body(14))
                    .italic()
                    .foregroundStyle(Theme.txt.opacity(0.68))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 22)
            }

            // Chip row: HR cap + best window. Hidden on rest days — there's no
            // run to cap or to time, so "BEFORE 7 AM" on a rest day is nonsense
            // (David 2026-06-12).
            let hasCap = (displayWorkout?.hrCeilingBpm ?? 0) > 0
            let hasWindow = !(forecast?.best_window?.isEmpty ?? true)
            if (hasCap || hasWindow) && selectedEffort != .rest {
                HStack(spacing: 10) {
                    if let cap = displayWorkout?.hrCeilingBpm, cap > 0 {
                        heroChip(icon: "heart.fill",
                                 iconColor: Color(hex: 0xFC4D64),
                                 text: "HR CAP \(cap)")
                    }
                    if let win = forecast?.best_window, !win.isEmpty {
                        heroChip(icon: "clock.fill",
                                 iconColor: Color(hex: 0x8FD0FF),
                                 text: win.uppercased())
                    }
                }
                .padding(.top, 18)
            }

            // Strength nudge · the recommender picked this day. The strip shows
            // WHICH days (the underline); this is the selected day's heads-up.
            // Purely additive — runs-only days look exactly as before.
            if strengthDoneDays.contains(selectedDayID) {
                HStack(spacing: 7) {
                    Image(systemName: "dumbbell.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Color(hex: 0x9AF0BF))
                    Text("Strength")
                        .font(.body(13, weight: .bold))
                        .foregroundStyle(Theme.txt)
                    Text("done")
                        .font(.body(12, weight: .bold))
                        .foregroundStyle(Color(hex: 0x9AF0BF))
                    Image(systemName: "checkmark")
                        .font(.system(size: 9, weight: .black))
                        .foregroundStyle(Color(hex: 0x9AF0BF))
                }
                .padding(.top, 16)
            } else if strengthDays.contains(selectedDayID) {
                HStack(spacing: 8) {
                    Image(systemName: "dumbbell.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Color(hex: 0x27B4E0))
                    Text("Strength")
                        .font(.body(13, weight: .bold))
                        .foregroundStyle(Theme.txt)
                    Text("recommended")
                        .font(.body(12, weight: .medium))
                        .foregroundStyle(Theme.txt.opacity(0.55))
                }
                .padding(.top, 16)
            } else if strengthPausedDays.contains(selectedDayID) {
                // This was a strength day, paused by the readiness gate · same
                // nudge as "recommended" but yellow + "paused · readiness low"
                // so the runner sees it's intentional, not missing.
                HStack(spacing: 8) {
                    Image(systemName: "dumbbell.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Color(hex: 0xF3AD38))
                    Text("Strength")
                        .font(.body(13, weight: .bold))
                        .foregroundStyle(Theme.txt)
                    Text("paused · readiness low")
                        .font(.body(12, weight: .medium))
                        .foregroundStyle(Color(hex: 0xF3AD38))
                }
                .padding(.top, 16)
            }

            // "Not running today?" · the skip affordance, under the pills
            // (David's pick 1b). The action already exists — skipTodayAction()
            // → POST /api/today/skip. Hidden once skipped / on rest+done days.
            if displayWorkout != nil && !skipped {
                Button { showSkipConfirm = true } label: {
                    HStack(spacing: 6) {
                        Text("Not running today?")
                            .font(.body(12.5))
                            .foregroundStyle(Theme.txt.opacity(0.5))
                        Text("Skip \u{203A}")
                            .font(.body(12.5, weight: .semibold))
                            .foregroundStyle(Color(hex: 0x8FD0FF))
                    }
                }
                .buttonStyle(.plain)
                .padding(.top, 16)
            }

            // (Removed the "No race or goal set · Add one" nudge — it only
            // ever rendered inside the pre-run sheet, which by definition
            // means a plan + workout exist, so the line was self-
            // contradictory. The no-target case is handled by TODAY's
            // "just run" hero and the Goal tab, not here.)
        }
    }

    private func heroStat(key: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(value)
                .font(.display(32, weight: .bold))
                .tracking(-0.8)
                .foregroundStyle(Theme.txt)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
                .shadow(color: .black.opacity(0.25), radius: 16, y: 1)
            SpecLabel(text: key, size: 9.5, tracking: 1.2, color: Theme.txt.opacity(0.50))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func heroChip(icon: String, iconColor: Color, text: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(iconColor)
            Text(text)
                .font(.body(11, weight: .extraBold)).tracking(0.8)
                .foregroundStyle(Theme.txt.opacity(0.88))
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Color.white.opacity(0.08), in: Capsule())
        .overlay(Capsule().stroke(Color.white.opacity(0.14), lineWidth: 1))
    }

    private var heroCueLine: String? {
        guard selectedIsToday else { return nil }
        guard let cue = purpose?.cue?.trimmingCharacters(in: .whitespaces),
              !cue.isEmpty else { return nil }
        return cue
    }

    /// Hide the stat row entirely on rest days where every cell is "—".
    private var heroStatsPresent: Bool {
        distanceStr != "—" || paceStr != "—" || estTimeStr != nil
    }

    /// Estimated time stat · "48 min" under an hour, "1h 44m" over.
    private var estTimeStr: String? {
        guard let m = displayWorkout?.totalEstimatedMinutes, m > 0 else { return nil }
        if m >= 60 {
            let h = m / 60, mm = m % 60
            return mm == 0 ? "\(h) hr" : "\(h)h \(mm)m"
        }
        return "\(m) min"
    }

    /// Name subtitle for single-phase runs · hidden when it just
    /// repeats the type word.
    private var heroNameSubtitle: String? {
        guard let raw = displayWorkout?.name else { return nil }
        let name = raw.trimmingCharacters(in: .whitespaces)
        if name.isEmpty { return nil }
        if name.uppercased() == peekTitleWord { return nil }
        return name
    }

    /// Step items for the hero step list. For interval workouts, consecutive
    /// work+recovery pairs are collapsed into a single repeatGroup item so
    /// the list stays 3 rows (Warm Up · Repeat N× · Cool Down) regardless
    /// of how many reps the workout contains.
    private var heroSteps: [HeroStepItem] {
        let phases = displayWorkout?.phases ?? []
        guard phases.count >= 2 else { return [] }
        let allHaveDistance = phases.allSatisfy { ($0.distanceMi ?? 0) > 0 }

        func makeSeg(_ p: WatchPhase) -> HeroSeg {
            let w: Double = allHaveDistance
                ? (p.distanceMi ?? 0)
                : Double(max(60, p.durationSec))
            switch p.type {
            case .work:
                return HeroSeg(weight: w, color: selectedEffort.dot,
                               topLabel: workPhaseShortLabel(p), bottomLabel: segDistLabel(p))
            case .warmup:
                return HeroSeg(weight: w, color: Color(hex: 0x5BBFB0),
                               topLabel: "Warm Up", bottomLabel: segDistLabel(p))
            case .cooldown:
                return HeroSeg(weight: w, color: Color(hex: 0x5BBFB0),
                               topLabel: "Cool Down", bottomLabel: segDistLabel(p))
            case .recovery:
                return HeroSeg(weight: w, color: Color(hex: 0x8AA0A8),
                               topLabel: "Recovery", bottomLabel: segDistLabel(p))
            }
        }

        // Interval workouts: collapse middle work+recovery pairs into one block.
        if selectedEffort == .intervals {
            var items: [HeroStepItem] = []
            var i = 0
            while i < phases.count && phases[i].type == .warmup {
                items.append(.row(makeSeg(phases[i]))); i += 1
            }
            let middleStart = i
            var repCount = 0
            var firstWork: HeroSeg? = nil
            var firstRec: HeroSeg? = nil
            while i < phases.count && phases[i].type != .cooldown {
                let p = phases[i]
                if p.type == .work {
                    if firstWork == nil { firstWork = makeSeg(p) }
                    repCount += 1
                } else if p.type == .recovery && firstRec == nil {
                    firstRec = makeSeg(p)
                }
                i += 1
            }
            if repCount > 0, let ws = firstWork {
                items.append(.repeatGroup(count: repCount, work: ws, recovery: firstRec))
            } else {
                for j in middleStart..<i { items.append(.row(makeSeg(phases[j]))) }
            }
            while i < phases.count {
                items.append(.row(makeSeg(phases[i]))); i += 1
            }
            return items
        }

        return phases.map { .row(makeSeg($0)) }
    }

    /// Single-row step for easy / long runs that have no structured phases.
    /// Keeps the hero layout identical across all run types.
    private var syntheticHeroSteps: [HeroStepItem] {
        guard selectedEffort != .rest else { return [] }
        let topLabel: String
        switch selectedEffort {
        case .easy:  topLabel = "Easy Run"
        case .long:  topLabel = "Long Run"
        case .tempo: topLabel = "Tempo"
        default:     topLabel = selectedEffort.effortLabel
        }
        let bottomLabel: String
        if distanceStr != "—", paceStr != "—" {
            bottomLabel = "\(distanceStr)  ·  \(paceStr)"
        } else if distanceStr != "—" {
            bottomLabel = distanceStr
        } else if let t = estTimeStr {
            bottomLabel = t
        } else {
            bottomLabel = ""
        }
        let seg = HeroSeg(weight: 1.0, color: selectedEffort.dot,
                          topLabel: topLabel, bottomLabel: bottomLabel)
        return [.row(seg)]
    }

    private func workPhaseShortLabel(_ p: WatchPhase) -> String {
        let lbl = p.label.uppercased()
        if lbl.contains("THRESHOLD") || lbl.contains("TEMPO") || lbl.contains("@T") { return "Tempo" }
        if lbl.contains("INTERVAL") || lbl.contains("@I") || lbl.contains("VO2") { return "Interval" }
        if lbl.contains("MARATHON") || lbl.contains("@MP") { return "Marathon Pace" }
        if lbl.contains("REPEAT") { return "Repeat" }
        if !p.label.isEmpty { return p.label }
        switch selectedEffort {
        case .tempo:     return "Tempo"
        case .intervals: return "Interval"
        case .long:      return "Marathon Pace"
        default:         return "Run"
        }
    }

    private func segDistLabel(_ p: WatchPhase) -> String {
        let distPart: String
        if let d = p.distanceMi, d > 0 {
            distPart = d.truncatingRemainder(dividingBy: 1) == 0
                ? "\(Int(d)) mi" : String(format: "%.1f mi", d)
        } else {
            let m = max(1, p.durationSec / 60)
            distPart = "\(m) min"
        }
        if let pace = p.targetPaceSPerMi, pace > 0 {
            let paceStr = String(format: "%d:%02d/mi", pace / 60, pace % 60)
            return "\(distPart) · \(paceStr)"
        }
        return distPart
    }

    /// Peek header · branches on mode:
    ///   · Pre-run: readiness score ring + headline + run type on the right.
    ///     The sheet is now the readiness surface, so the peek announces it.
    ///   · Post-run: existing run-type / DONE peek (effort color + recap cue).
    @ViewBuilder
    private var peekHeader: some View {
        // 2026-06-10 · readiness-only panel · the peek header is always the
        // readiness glance (no post-run effort/DONE variant on the panel).
        readinessPeekContent
    }

    /// Post-run peek · existing design: effort type word + distance + DONE pill.
    private var postRunPeekContent: some View {
        HStack(spacing: 12) {
            if isDone {
                ZStack {
                    Circle()
                        .fill(.white)
                        .frame(width: 22, height: 22)
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .black))
                        .foregroundStyle(Color(hex: 0x1F9A6F))
                }
            } else if selectedEffort != .rest {
                Circle()
                    .fill(.white)
                    .frame(width: 10, height: 10)
                    .shadow(color: .white.opacity(0.5), radius: 6)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(peekTitleWord)
                    .font(.body(17, weight: .extraBold))
                    .tracking(-0.3)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Text(peekDistanceSubtitle)
                    .font(.body(11, weight: .bold))
                    .foregroundStyle(.white.opacity(0.78))
            }
            Spacer(minLength: 4)
            if isDone {
                Text("DONE")
                    .font(.body(10, weight: .extraBold)).tracking(1.4)
                    .foregroundStyle(Color(hex: 0x1F9A6F))
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(.white, in: Capsule())
            } else {
                VStack(alignment: .trailing, spacing: 1) {
                    Text(paceStr.replacingOccurrences(of: "/mi", with: ""))
                        .font(.display(18, weight: .bold)).tracking(-0.3)
                        .foregroundStyle(.white)
                    Text(selectedEffort.effortLabel.uppercased())
                        .font(.body(9, weight: .extraBold)).tracking(1.2)
                        .foregroundStyle(.white.opacity(0.82))
                }
            }
        }
        .padding(.top, 2)
    }

    /// Pre-run peek · compact readiness ring on the left, score headline
    /// centre, run type + distance on the right so the runner gets both
    /// signals at a glance without opening the sheet.
    private var readinessPeekContent: some View {
        // 2026-06-10 · COMPACT peek header · just the ring + headline row,
        // no orb glow. The glow was a greedy RadialGradient that inflated
        // the peek to ~half the sheet, and once constrained it read as a
        // weird gradient box on the thin strip. The bare row is naturally
        // sized, so the peek stays a thin glance strip.
            HStack(spacing: 14) {
                ZStack {
                    Circle()
                        .stroke(Color.white.opacity(0.25), lineWidth: 4.5)
                    Circle()
                        .trim(from: 0, to: min(1.0, max(0.0, Double(readiness?.score ?? 0) / 100.0)))
                        .stroke(readinessBandArc,
                                style: StrokeStyle(lineWidth: 4.5, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .animation(.easeInOut(duration: 0.6), value: readiness?.score)
                    Text(readiness?.score.map(String.init) ?? "—")
                        .font(.display(16, weight: .semibold))
                        .foregroundStyle(.white)
                }
                .frame(width: 44, height: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text("READINESS")
                        .font(.body(9, weight: .extraBold)).tracking(1.2)
                        .foregroundStyle(.white.opacity(0.72))
                    Text(readinessPeekHeadline)
                        .font(.body(14, weight: .extraBold)).tracking(-0.2)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
            }
            .padding(.top, 2)
    }

    private var sheetContent: some View {
        // 2026-06-10 · the slide panel is the READINESS surface only.
        // No run detail (pre-run plan) and no post-run recap render here ·
        // the run is the background hero, the recap has its own surface.
        // David: the panel "is just readiness information."
        TodayReadinessPanel(
            snapshot: readiness,
            lastNightHours: lastNightHours,
            thisWeekMiles: thisWeekMiles,
            bestWindow: forecast?.best_window,
            weeksToRace: weeksToRaceValue,
            daysToRace: daysToRaceValue,
            nextHardLabel: nextHardLabel,
            onTap: { onReadinessTap() }
        )
        .padding(.horizontal, 22)
        .padding(.top, 22)
        .padding(.bottom, 20)
    }

    /// 2026-06-02 round 61 · extracted so the past-day flat layout (no
    /// drag-sheet) and the today + done drag-sheet body both render the
    /// same recap content from one source. Identical params either way.
    ///
    /// 2026-06-02 round 62 · `onMesh: isPastDayView` flips the recap's
    /// styling to white-on-mesh for the past-day flat layout. The
    /// today + done drag-sheet usage keeps the default (cream-context),
    /// preserving the white-cards-on-white-sheet read.
    @ViewBuilder
    private var postRunBody: some View {
        TodayPostRunBody(
            detail: completedDetail,
            recap: completedRecap,
            accent: selectedEffort.dot,
            runId: completedRunId,
            // 2026-06-02 round 45 · type word for eyebrow + hero
            // (matches pre-run + web). workout name moves to a
            // subtitle line. selectedEffort.effortLabel was the
            // severity ("MAX") · should be the type word so both
            // surfaces tell the same story.
            effortLabel: peekTitleWord,
            dowLabel: selectedIsToday ? "TODAY" : shortDOWLabel,
            titleText: peekTitleWord,
            nameSubtitle: plainWorkoutName,
            onMesh: true
        )
    }

    /// 2026-06-02 round 61 · placeholder body for past days where there's
    /// no completed run · rest day, skipped, missed, or a future day
    /// reached via the week strip (rare, but reachable). Single eyebrow +
    /// big title in the type word so the runner sees what was on the
    /// plan but no fake recap data is rendered. Minimal by design.
    @ViewBuilder
    private var pastDayNoRunStub: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(shortDOWLabel)
                .font(.body(11, weight: .extraBold))
                .tracking(1.4)
                .foregroundStyle(Color.white.opacity(0.66))
            Text(peekTitleWord.isEmpty ? "REST" : peekTitleWord)
                .font(.display(54, weight: .bold))
                .tracking(-0.5)
                .foregroundStyle(.white)
            Text(pastDayNoRunSubtitle)
                .font(.body(13.5, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.78))
                .padding(.top, 2)
        }
        .padding(.horizontal, 22)
        .padding(.top, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// 2026-06-02 round 61 · single-line context for the past-day stub.
    /// Maps the day's effort/state to plain coach voice.
    private var pastDayNoRunSubtitle: String {
        if selectedEffort == .rest { return "Rest day · nothing to recap." }
        if let day = todaySelectedDay, day.skipped == true { return "Skipped." }
        if let day = todaySelectedDay, day.completedRunId == nil {
            return "No run recorded."
        }
        return "No run recorded."
    }

    /// Pre-run sheet body · prescription + fueling + conditions + coach
    /// stack + Skip-this-run footer.
    ///
    /// 2026-06-01 round 2: in-sheet adaptation banner retired. The
    /// AdaptationCard ABOVE the hero is the canonical surface ·
    /// duplicating the banner inside the sheet stacked the same vague
    /// "Plan adapted · overridden" text twice. Backend brief out for
    /// structured from/to copy (designs/briefs/adaptation-intent-
    /// structured-from-to.md); both surfaces will read the cleaner
    /// "Adjusted from {original} · Restore" template once it lands.
    private var preRunSheetContent: some View {
        // 2026-06-01 round 7 · design package #3 wires the new
        // structured pre-run body (header → stats trio → effort target →
        // conditions 2x2 → session+CUE → THE PLAN → skip). Replaces the
        // generic prescription-stack used in v2. The component owns its
        // own skip-footer.
        TodayPreRunBodyV3(
            workout: displayWorkout,
            effort: selectedEffort,
            dowLabel: shortDOWLabel,
            isToday: selectedIsToday,
            weather: weather,
            forecast: forecast,
            shoeName: selectedShoe?.displayName,            // hydrated by picker
            briefing: briefing,
            purpose: purpose,
            adaptation: adaptationIntent,
            onSkip: skipTodayAction,
            onShoeTap: {
                // Lazy-refresh on tap · if the initial /api/shoe fetch
                // failed (network blip on launch), we get a second
                // chance to populate before the picker renders.
                if shoeGarage.isEmpty {
                    Task {
                        if let resp = try? await API.fetchShoes(),
                           let garage = resp.shoes, !garage.isEmpty {
                            await MainActor.run { self.shoeGarage = garage }
                        }
                    }
                }
                showShoePicker = true
            }
        )
    }

    /// Shoes the picker presents · primary source is the dedicated
    /// `/api/shoe` endpoint (canonical, returns [Shoe] with Int ids,
    /// no string-prefix mapping). Falls back to mapping
    /// profile.shoes (which can be nil) for the rare case where the
    /// dedicated fetch hasn't completed yet but profile has.
    private var pickerShoes: [Shoe] {
        if !shoeGarage.isEmpty { return shoeGarage }
        // Fallback path · profile.shoes → Shoe[]. ProfileShoe.id is
        // a string like "shoe_12"; the /api/today/shoe POST expects
        // an Int. Strip the prefix and skip rows whose id doesn't
        // parse cleanly.
        guard let raw = profile?.shoes else { return [] }
        return raw.compactMap { ps -> Shoe? in
            let intId = Int(ps.id.replacingOccurrences(of: "shoe_", with: ""))
            guard let id = intId else { return nil }
            return Shoe(
                id: id,
                brand: ps.brand,
                model: ps.model,
                color: ps.color,
                mileage: ps.mileage,
                mileage_cap: ps.cap,
                run_types: ps.runTypes,
                baseline_mi: nil,
                retired: ps.retired,
                preferred: ps.preferred,
                notes: nil
            )
        }
    }

    /// Short day-of-week label · "MON", "TUE", etc. Drives the pre-run
    /// header eyebrow for non-today selections.
    private var shortDOWLabel: String {
        let f = DateFormatter()
        f.dateFormat = "EEE"
        if !selectedDayID.isEmpty, selectedDayID != todayISO,
           let day = todaySelectedDay,
           let d = isoDateFromDay(day.date_iso) {
            return f.string(from: d).uppercased()
        }
        return f.string(from: Date()).uppercased()
    }

    private var skipThisRunButton: some View {
        Button(action: skipTodayAction) {
            HStack(spacing: 8) {
                Image(systemName: "forward.fill")
                    .font(.system(size: 11, weight: .bold))
                Text("Skip this run")
                    .font(.body(13, weight: .extraBold))
            }
            .foregroundStyle(Color(hex: 0x9A9286))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
        }
        .buttonStyle(.plain)
    }


    // MARK: - Derived

    private var selectedDayEffort: FaffEffort? {
        // Search across all loaded weeks so selecting a prev/next-week day
        // correctly resolves the effort without a separate "browsedPlan" state.
        let allDays = (prevWeekPlan?.days ?? []) + (plan?.days ?? []) + futureWeekPlans.flatMap { $0.days }
        guard let d = allDays.first(where: { $0.date_iso == selectedDayID })
        else { return nil }
        // 2026-06-02 round 43 · effort classification reads the
        // canonical PlanDay.type ONLY · NOT sub_label. sub_label for
        // quality sessions is the workout name ("4×1 mi @ I · 3 min jog"),
        // not an effort token, so FaffEffort.fromType fell through to
        // .easy. Hero, color, target pace, effort target all read off
        // this · using the wrong source made every quality session look
        // like an easy run (Z2, 8:12, green mesh).
        return FaffEffort.fromType(d.type)
    }

    private var selectedEffort: FaffEffort {
        // Skip applies to TODAY only — never relabel another selected day as
        // rest just because today was skipped.
        if skipped && selectedIsToday { return .rest }
        return selectedDayEffort ?? .easy
    }

    /// Today's run was actively skipped (day_actions). A skipped today reads
    /// as "SKIPPED" with the run detail dropped — distance/pace/time for a run
    /// you chose not to do is incoherent (David 2026-06-12). Scoped to today so
    /// it never relabels another selected day.
    private var isSkippedToday: Bool { skipped && selectedIsToday }

    /// The run you skipped, as a noun for the "You skipped today's …" line.
    /// Reads the REAL planned effort, not selectedEffort (which is .rest here).
    private var skippedRunNoun: String {
        switch selectedDayEffort ?? .easy {
        case .recovery:  return "recovery jog"
        case .easy:      return "easy run"
        case .long:      return "long run"
        case .tempo:     return "tempo run"
        case .intervals: return "intervals session"
        case .race:      return "race"
        case .rest:      return "session"
        }
    }

    private var isQualityWorkoutDay: Bool {
        switch selectedEffort {
        case .long, .tempo, .intervals, .race: return true
        default: return false
        }
    }

    private var subLabel: String {
        switch selectedEffort {
        case .recovery:  return "Zone 1"
        case .easy:      return "Zone 2"
        case .long:      return "Z2 → Marathon Pace"
        case .tempo:     return "Zone 4 Threshold"
        case .intervals: return "Zone 5 VO2"
        case .rest:      return "Recovery Day"
        case .race:      return "Race Day"
        }
    }

    /// The workout to render in the hero + drag sheet. For the today
    /// selection, prefer `workout` (cached at launch). For any other day
    /// in the strip, use `dayWorkout` fetched on selection change.
    private var displayWorkout: WatchWorkout? {
        if selectedDayID == todayISO { return workout }
        return dayWorkout
    }

    private var workoutName: String {
        // Use the WatchWorkout's name if available, else derive from PlanDay type.
        if let n = displayWorkout?.name {
            // Insert a soft break before the last word if 2+ words
            let words = n.split(separator: " ")
            if words.count >= 2 { return words.dropLast().joined(separator: " ") + "\n" + words.last! }
            return n
        }
        // Fallback to type-derived label
        switch selectedEffort {
        case .recovery:  return "Recovery\nJog"
        case .easy:      return "Easy\nAerobic"
        case .long:      return "Long\nRun"
        case .tempo:     return "Tempo\nRun"
        case .intervals: return "Track\nIntervals"
        case .rest:      return "Rest\nDay"
        case .race:      return "Race\nDay"
        }
    }

    private var distanceStr: String {
        // Prefer the selected day's planned distance (server-of-truth for
        // future days). Fall back to the watch-workout distanceMi.
        if let dist = todaySelectedDay?.distance_mi, dist > 0 { return "\(formatMi(dist)) mi" }
        if let mi = displayWorkout?.distanceMi { return "\(formatMi(mi)) mi" }
        return "—"
    }

    /// 2026-06-02 round 45 · peek bar title · single-word workout type
    /// from the locked vocabulary (purpose.typeTitle) with derived
    /// fallback. Matches the pre-run hero so the hierarchy stays
    /// consistent across collapsed + expanded states.
    ///
    /// 2026-06-02 round 51 · purpose.typeTitle is ONLY authoritative
    /// when the selected day IS today. /api/today/purpose returns
    /// today's payload regardless of strip selection · using it for
    /// non-today days made Wed (easy) read as "INTERVALS" because
    /// Tuesday's intervals purpose bled through.
    private var peekTitleWord: String {
        if isSkippedToday { return "SKIPPED" }
        if selectedIsToday, let t = purpose?.typeTitle?.uppercased(), !t.isEmpty {
            return t
        }
        switch selectedEffort {
        case .recovery:  return "RECOVERY"
        case .easy:      return "EASY"
        case .long:      return "LONG"
        case .tempo:     return "TEMPO"
        case .intervals: return "INTERVALS"
        case .rest:      return "REST"
        case .race:      return "RACE"
        }
    }

    /// 2026-06-02 round 45 · peek bar subtitle · actual mileage
    /// instead of dead-weight "Today's session" / "Today's run". When
    /// distance is unknown (loading / cold start) falls back to the
    /// old copy so the row never blanks.
    private var peekDistanceSubtitle: String {
        let d = distanceStr
        if d != "—" { return d }
        return isDone ? "Today's run" : "Today's session"
    }

    private var paceStr: String {
        // 2026-06-02 round 43 · prefer the WORK phase pace over the
        // first phase. For intervals/tempo, the first phase is the
        // warmup at 8:12 but the meaningful target is the rep pace.
        let phases = displayWorkout?.phases ?? []
        if let work = phases.first(where: { $0.type == .work && $0.targetPaceSPerMi != nil })?.targetPaceSPerMi {
            return formatPace(secondsPerMi: work)
        }
        if let any = phases.first(where: { $0.targetPaceSPerMi != nil })?.targetPaceSPerMi {
            return formatPace(secondsPerMi: any)
        }
        return "—"
    }

    private func formatPace(secondsPerMi: Int) -> String {
        let m = secondsPerMi / 60
        let s = secondsPerMi % 60
        return String(format: "%d:%02d/mi", m, s)
    }

    /// True when the selected day IS today · empty selectedDayID also
    /// counts as today (the .task hasn't populated it from
    /// plan.today_iso yet · everything else on the surface already
    /// treats empty as today, the CTA needs to as well so it doesn't
    /// flash "View THRESHOLD" → "Start THRESHOLD" on first load).
    ///
    /// Three-way fallback covers the timezone bug class:
    ///   1. selectedDayID empty (first frame, before .task seeds it) → today
    ///   2. selectedDayID matches iPhone-local DateFormatter today → today
    ///   3. selectedDayID matches the BACKEND's plan.today_iso → today
    /// The third path catches DST/UTC drift where iPhone-local
    /// DateFormatter and backend's Pacific-anchored today_iso disagree
    /// at hour boundaries · empirically build 136 was firing "View
    /// THRESHOLD" on what David saw as today, which is the symptom of
    /// the iPhone-local vs backend mismatch.
    private var selectedIsToday: Bool {
        if selectedDayID.isEmpty { return true }
        if selectedDayID == todayISO { return true }
        if let planToday = plan?.today_iso, selectedDayID == planToday { return true }
        return false
    }

    private var plainWorkoutName: String { workoutName.replacingOccurrences(of: "\n", with: " ") }

    /// "HOTTER 78°F" / "COOLER 52°F" tag derived from /api/prescription's
    /// weather_baseline. Hidden when the delta from baseline is < 6°F
    /// (Maughan's threshold for meaningful heat impact). Returns nil to
    /// hide the badge entirely.
    private var weatherTagLabel: String? {
        guard let wx = weather, let d = wx.deltaF, let t = wx.tempF else { return nil }
        guard t > 10, t < 130 else { return nil }   // unfetched default · not a reading
        if abs(d) < 6 { return nil }
        let degrees = Int(t.rounded())
        return d > 0 ? "HOTTER \(degrees)°F" : "COOLER \(degrees)°F"
    }

    /// Background color for the weather tag — race-orange for hotter (it's
    /// a "watch your effort" cue), recovery-cyan for cooler (a "you might
    /// surprise yourself" cue).
    private var weatherTagColor: Color {
        guard let d = weather?.deltaF, d > 0 else { return Color(hex: 0x9AF0BF) }
        return Color(hex: 0xFFD27A)
    }

    private var todayISO: String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: Date())
    }

    private var todaySelectedDay: PlanDay? {
        let allDays = (prevWeekPlan?.days ?? []) + (plan?.days ?? []) + futureWeekPlans.flatMap { $0.days }
        return allDays.first { $0.date_iso == selectedDayID }
    }

    /// Avatar initials · delegates to ProfileIdentity.avatarInitials.
    private var avatarInitials: String { profile?.identity.avatarInitials ?? "" }

    private var titleForToday: String {
        let f = DateFormatter()
        f.dateFormat = "EEEE d"
        let base = f.string(from: Date()).uppercased()
        if selectedDayID.isEmpty { return base }
        if selectedDayID == todayISO { return base }
        guard let day = todaySelectedDay else { return base }
        let iso = day.date_iso.split(separator: "-").compactMap { Int($0) }
        guard iso.count == 3 else { return base }
        let cal = Calendar.current
        if let d = cal.date(from: DateComponents(year: iso[0], month: iso[1], day: iso[2])) {
            return f.string(from: d).uppercased()
        }
        return base
    }

    // MARK: - Today redesign topbar helpers (2026-06-01)

    /// Date line for the Today topbar greeting block · e.g. "Monday 1".
    /// Mixed-case (not uppercase) per the design brief.
    private var dayHeaderLabel: String {
        let f = DateFormatter()
        f.dateFormat = "EEEE d"
        let d: Date = {
            // If the runner has tapped a non-today day in the week strip,
            // show that day's name so the topbar reflects the active session.
            if !selectedDayID.isEmpty, selectedDayID != todayISO,
               let day = todaySelectedDay,
               let parsed = isoDateFromDay(day.date_iso) {
                return parsed
            }
            return Date()
        }()
        return f.string(from: d)
    }

    /// 2026-06-02 round 42 · LAST NIGHT chip · prefer the most-recent
    /// HealthKit sleep_hours sample stashed by HealthKitImporter, fall
    /// back to readiness.sleep7Avg (7-night rolling) until the first
    /// import lands. Reactive: observing hkImporter means the chip
    /// updates the moment a background→foreground triggered import
    /// publishes a new value, without waiting for the next loadAll.
    private var lastNightHours: Double? {
        hkImporter.lastNightHours ?? readiness?.sleep7Avg
    }

    /// 2026-06-02 · Resolved weeks-to-next-anchor-race. Prefers the
    /// /api/today/purpose value (server-composed, knows about training-
    /// plan phase + which race the plan actually targets). Falls back
    /// to /api/races client-side resolution (next future race by
    /// priority A > B > C, tied-broken by earliest date) so the
    /// TO RACE chip lights up even when purpose 500s — defense in
    /// depth against the bug class.
    private var weeksToRaceValue: Int? {
        if let w = purpose?.weeksToRace, w > 0 { return w }
        if let d = raceFallback?.days_to_race, d > 0 {
            return max(1, Int(ceil(Double(d) / 7.0)))
        }
        return nil
    }

    /// Exact days to the next A-race · used by the TO RACE chip when <14
    /// days out so the chip shows "9D" instead of "1 WK". Prefers the
    /// live profile.nextARace value (updated nightly) over the raceFallback
    /// which may lag by one session.
    private var daysToRaceValue: Int? {
        if let d = profile?.nextARace?.days_to_race, d > 0 { return d }
        if let d = raceFallback?.days_to_race, d > 0 { return d }
        return nil
    }

    /// Optional context line below the date. Composes from the purpose
    /// payload when we have it. Null when nothing meaningful · the
    /// topbar drops the line gracefully (no placeholder).
    ///
    /// 2026-06-02 round 59 · per design_handoff_today_postrun_pivot:
    /// post-run mode uses race-name + days-out format ("CIM · 84 DAYS
    /// OUT") · runs front-of-mind during recovery. Pre-run keeps the
    /// phase + weeks format ("BASE · 11 WEEKS TO RACE") because the
    /// runner is in training-state thinking, not race-countdown.
    private var weekContextLabel: String? {
        // Post-run · race countdown by days, anchored to the race name.
        if isPostRunMode {
            let raceName = raceShortDisplay
            let days = recoveryNextRaceDays
            if !raceName.isEmpty, let d = days, d > 0 {
                return "\(raceName) · \(d) DAYS OUT"
            }
            if let d = days, d > 0 { return "\(d) DAYS OUT" }
            // Fall through to phase format if no race
        }
        // Pre-run · existing phase + weeks format.
        let phase = (purpose?.phase ?? "").uppercased()
        let weeks = weeksToRaceValue
        if !phase.isEmpty, let w = weeks, w > 0 {
            return "\(phase) · \(w) WEEKS TO RACE"
        }
        if !phase.isEmpty { return "\(phase) PHASE" }
        if let w = weeks, w > 0 { return "\(w) WEEKS TO RACE" }
        return nil
    }

    /// 2026-06-02 round 59 · short race name for the topbar eyebrow.
    /// Prefers an acronym for 3+ word names (Americas Finest City →
    /// AFC), else uppercased name. Pulls from purpose.race when
    /// loaded, falls back to raceFallback.
    private var raceShortDisplay: String {
        let name: String = {
            if let n = raceFallback?.name, !n.isEmpty { return n }
            return ""
        }()
        guard !name.isEmpty else { return "" }
        let words = name.split(separator: " ").map(String.init)
        if words.count >= 3 {
            let ac = words.compactMap { $0.first.map(String.init) }.joined()
            if ac.count >= 3 { return ac.uppercased() }
        }
        return name.uppercased()
    }

    /// Days-to-next-anchor-race · used by the post-run eyebrow.
    private var recoveryNextRaceDays: Int? {
        if let d = raceFallback?.days_to_race, d > 0 { return d }
        // Derive from weeksToRaceValue as a fallback.
        if let w = weeksToRaceValue, w > 0 { return w * 7 }
        return nil
    }

    /// 2026-06-02 round 39 · "NEXT HARD" stat chip · walks the
    /// remaining days in this plan week, picks the first that's not
    /// easy/recovery/rest, formats as "{DOW} · {EFFORT}". Nil when no
    /// hard sessions remain (or no plan loaded).
    private var nextHardLabel: String? {
        guard let days = plan?.days else { return nil }
        let todayKey = plan?.today_iso ?? todayISO
        let dowLetters = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
        // Walk days AFTER today (skip today itself · "next" means future)
        // looking for the first non-easy/non-rest entry.
        for day in days {
            guard day.date_iso > todayKey else { continue }
            // type-only · see selectedDayEffort comment.
            let effort = FaffEffort.fromType(day.type)
            switch effort {
            case .tempo, .intervals, .long, .race:
                let dow = dowLetters[((day.dow % 7) + 7) % 7]
                let typeWord: String = {
                    switch effort {
                    case .tempo:     return "TEMPO"
                    case .intervals: return "INTERVALS"
                    case .long:      return "LONG"
                    case .race:      return "RACE"
                    default:         return ""
                    }
                }()
                return "\(dow) · \(typeWord)"
            default:
                continue
            }
        }
        return nil
    }

    private func isoDateFromDay(_ iso: String) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var c = DateComponents()
        c.year = parts[0]; c.month = parts[1]; c.day = parts[2]
        return Calendar.current.date(from: c)
    }

    /// 2026-06-02 round 40 · client-side next-anchor-race resolution.
    /// Same doctrine the backend uses on /api/today/purpose · highest-
    /// priority future race (A > B > C), tie-broken by earliest date.
    /// Excludes "hilly-excluded" priority (Big Sur etc. · context-only
    /// races that don't anchor training). Returns nil when no future
    /// race exists · TO RACE chip then renders "—" honestly.
    private func pickAnchorRace(_ races: [RaceListItem]) -> RaceListItem? {
        let priorityOrder: [String: Int] = ["A": 0, "B": 1, "C": 2]
        let candidates = races.filter { r in
            guard let d = r.days_to_race, d > 0 else { return false }
            let pri = (r.priority ?? "").lowercased()
            return pri != "hilly-excluded" && pri != "excluded"
        }
        return candidates.sorted { a, b in
            let aPri = priorityOrder[a.priority ?? ""] ?? 99
            let bPri = priorityOrder[b.priority ?? ""] ?? 99
            if aPri != bPri { return aPri < bPri }
            return (a.days_to_race ?? Int.max) < (b.days_to_race ?? Int.max)
        }.first
    }

    /// Tap handler for the readiness panel · presents the full readiness
    /// brief sheet (2026-06-01). The sheet hydrates from
    /// /api/readiness/brief and renders the full envelope (score trend +
    /// pillars + streaks + watchTomorrow + cold-start when applicable).
    private func onReadinessTap() {
        showReadinessBrief = true
    }

    // MARK: - Today v2 (2026-06-01) · post-run state helpers

    /// True when the currently-selected day has a completed run · drives
    /// the sheet body branch (post-run vs pre-run), peek color, CTA
    /// text/action ("Start <Run>" vs "Share run"), and whether Skip is
    /// surfaced. Reads PlanDay.completedRunId straight from plan/week.
    private var isDone: Bool {
        todaySelectedDay?.completedRunId != nil
    }

    /// Run ID of the completed run for the selected day, if any. Used to
    /// fetch RunDetail + RunRecap for the post-run sheet body.
    private var completedRunId: String? {
        todaySelectedDay?.completedRunId
    }

    /// 2026-06-02 round 58 · Post-run pivot mode.
    ///
    /// True when the runner is viewing TODAY and today's prescribed
    /// run has a completedRunId. V1 gate. Backend B2 will surface
    /// `todayRunDone` + `todayRunLong` on the envelope which will
    /// supersede this (catches non-prescribed runs that still satisfy
    /// the "did a run today" rule per the brief). For now, plan-day
    /// completedRunId is the cleanest signal we already have.
    ///
    /// Hard rule (per the design brief): once postRun fires it stays
    /// until midnight rolls · no pivot BACK to morning. The
    /// completedRunId on the plan day naturally persists for the rest
    /// of the day, so this gate honors the rule for free.
    private var isPostRunMode: Bool {
        guard selectedIsToday else { return false }
        return isDone
    }

    /// 2026-06-02 round 61 · true ONLY for genuinely past days (not
    /// today, not future). Drives a different layout: morning
    /// readiness + drag-up sheet are killed, the post-run recap
    /// renders flat in their place.
    ///
    /// David: "going back to a previous day it makes no sense to
    /// show readiness or recovery · we should remove the slide-up
    /// panel altogether and just have the screen be the run recap."
    /// Morning decision furniture (readiness ring, today-only HR
    /// pillars, recovery curve) doesn't belong on a historical view ·
    /// the runner is reviewing a finished day, not planning one.
    ///
    /// Future days are deliberately EXCLUDED — the drag-up pre-run
    /// sheet is still useful for previewing the next session's
    /// prescription / fueling / conditions. Only past gets the
    /// flat-recap treatment.
    private var isPastDayView: Bool {
        guard !selectedIsToday else { return false }
        // Prefer the backend's is_past flag (Pacific-anchored,
        // agrees with the rest of the plan). Falls back to ISO
        // string compare when the flag is missing.
        if let day = todaySelectedDay { return day.is_past }
        return selectedDayID < todayISO
    }

    /// True when the profile has loaded but the runner has set neither a race
    /// nor a fitness goal — the new-user cold state after onboarding completes
    /// without race/goal entry. TODAY shows a hero empty state instead of the
    /// normal pre-run body so the runner has a clear path to starting a plan.
    /// True only when the runner has a real training plan (any planned run
    /// or any completed run across the loaded weeks). A planless account is
    /// the ONLY case that should ever see the "just run" empty state — a
    /// runner with a plan must see the plan even if nextARace / fitnessGoal
    /// aren't populated in profile state.
    private var hasPlan: Bool {
        let allDays = (prevWeekPlan?.days ?? [])
            + (plan?.days ?? [])
            + futureWeekPlans.flatMap { $0.days }
        return allDays.contains {
            ($0.type != "rest" && $0.distance_mi > 0) || $0.completedRunId != nil
        }
    }

    private var isNoGoalState: Bool {
        guard let p = profile else { return false }
        // A plan trumps everything — never replace it with "just run".
        if hasPlan { return false }
        let hasRace = !(p.nextARace?.slug ?? "").isEmpty
        let hasGoal = p.fitnessGoal != nil
        return !hasRace && !hasGoal
    }

    /// "Just run" casual home · shown when there's no race AND no goal, so
    /// there's no plan to render. Reframes the cold state from a wall
    /// ("you're missing a plan") into an invitation: log runs your way,
    /// they're all tracked, set a goal whenever you want one built. The RUN
    /// tab records; "All runs" opens the full tracked log.
    @ViewBuilder
    private var noGoalHeroView: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("JUST RUN")
                .font(.heroDisplay(76))
                .tracking(-2)
                .foregroundStyle(Theme.txt)
                .minimumScaleFactor(0.55)
                .lineLimit(1)
                .padding(.horizontal, 22)
                .padding(.top, 6)

            VStack(alignment: .leading, spacing: 0) {
                Text("No plan yet, and that's fine.")
                    .font(.body(18, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .padding(.bottom, 8)

                Text("Log runs your way and they're all tracked here. Set a goal whenever you want a plan built around it.")
                    .font(.body(14))
                    .foregroundStyle(Theme.txt.opacity(0.55))
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 26)

                // Primary · record a run (opens the run menu owned by RootTabView).
                Button {
                    NotificationCenter.default.post(name: .faffShowRunMenu, object: nil)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "figure.run")
                            .font(.system(size: 15, weight: .bold))
                        Text("Record a run")
                            .font(.body(15, weight: .extraBold))
                    }
                    .foregroundStyle(Theme.bg)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .background(Theme.txt, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
                .padding(.bottom, 10)

                // Secondary · all tracked runs.
                NavigationLink(value: FaffRoute.activity) {
                    noGoalRow(title: "All runs", system: "chevron.right", tint: Theme.txt.opacity(0.8))
                }
                .buttonStyle(.plain)
                .padding(.bottom, 10)

                // Tertiary soft nudge · set a goal to unlock a plan.
                Button { selectedTab = .targets } label: {
                    noGoalRow(title: "Set a goal for a plan", system: "flag.fill", tint: Color(hex: 0x8FD0FF))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 22)
            .padding(.top, 22)

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func noGoalRow(title: String, system: String, tint: Color) -> some View {
        HStack {
            Text(title).font(.body(14, weight: .semibold))
            Spacer()
            Image(systemName: system).font(.system(size: 12, weight: .semibold))
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 16).padding(.vertical, 14)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }

    /// Belt-and-suspenders for the StickyCTABar gate. Walks the plan
    /// week directly instead of relying on the todaySelectedDay
    /// computed property, so a state-resolution timing race in SwiftUI
    /// can't leave the CTA bar visible on a completed day. Returns
    /// true whenever ANY plan day with selectedDayID exists AND has a
    /// completedRunId · matches isDone semantically but reads through
    /// a different path.
    private var hasCompletedRunForSelectedDay: Bool {
        guard let week = plan?.days else { return false }
        let key = selectedDayID.isEmpty ? (plan?.today_iso ?? todayISO) : selectedDayID
        return week.contains { $0.date_iso == key && $0.completedRunId != nil }
    }

    /// Peek background color.
    ///   · Pre-run: readiness band tint — the sheet is the readiness
    ///     surface; band color gives a quick "body-state" signal from
    ///     the collapsed peek (amber = moderate, green = sharp, etc.).
    ///   · Post-run: effort dot color — communicates what was done,
    ///     consistent with the DONE pill + check icon signalling.
    private var peekFill: Color {
        if isPostRunMode {
            if selectedEffort == .rest { return Color(hex: 0x9FB0AD) }
            return selectedEffort.dot
        }
        return Color(hex: 0x2B303A)  // neutral charcoal · two steps up the mesh scale so the panel reads clearly distinct from the page background
    }

    /// Readiness band → deep background tint for the peek strip.
    /// Rich dark variants of the band palette so the peek reads as premium
    /// rather than flat/pastel; the radial orb glow provides the color punch.
    private var readinessBandTint: Color {
        switch (readiness?.band ?? "").uppercased() {
        case "SHARP", "PRIMED":                    return Color(hex: 0x0B2B18)   // deep forest green
        case "READY", "HOLD EASY":                 return Color(hex: 0x0B1D33)   // deep navy blue
        case "MODERATE":                           return Color(hex: 0x311E08)   // deep dark amber
        case "PULL-BACK", "PULL BACK", "BACK OFF": return Color(hex: 0x330A0A)   // deep dark red
        default:                                   return Color(hex: 0x18130E)   // warm very dark
        }
    }

    /// Readiness band → arc stroke color for the compact ring in the peek.
    private var readinessBandArc: Color {
        switch (readiness?.band ?? "").uppercased() {
        case "SHARP", "PRIMED":                    return Color(hex: 0x3CD370)
        case "READY", "HOLD EASY":                 return Color(hex: 0x58B8FF)
        case "MODERATE":                           return Color(hex: 0xFFB24D)
        case "PULL-BACK", "PULL BACK", "BACK OFF": return Color(hex: 0xFC4D64)
        default:                                   return Color(hex: 0x8AA0A8)
        }
    }

    /// One-line readiness summary for the peek strip.
    private var readinessPeekHeadline: String {
        guard let inputs = readiness?.inputs, !inputs.isEmpty else {
            return "No overnight data"
        }
        let drags = inputs
            .filter { $0.weight < 0 }
            .sorted { $0.weight < $1.weight }
            .prefix(2)
            .map { humanizeReadinessKey($0.key) }
        if drags.isEmpty {
            switch (readiness?.band ?? "").uppercased() {
            case "SHARP", "PRIMED": return "Everything firing"
            case "READY":           return "Solid across the board"
            default:                return readiness?.band?.capitalized ?? "Looking good"
            }
        }
        if drags.count == 1 { return "\(drags[0]) dragging" }
        return "\(drags[0]) + \(drags[1]) dragging"
    }

    private func humanizeReadinessKey(_ key: String) -> String {
        switch key.lowercased() {
        case "sleep": return "Sleep"
        case "hrv":   return "HRV"
        case "rhr":   return "RHR"
        case "load":  return "Load"
        case "rpe":   return "RPE"
        default:      return key.capitalized
        }
    }

    /// Skip-this-run action · POSTs to /api/today/skip via the existing
    /// API helper. Pre-run only (hidden when isDone or rest).
    private var skipConfirmSheet: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                Capsule().fill(Theme.txt.opacity(0.2))
                    .frame(width: 40, height: 4).padding(.top, 12)
                Text("Skip today's run?")
                    .font(.display(22, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .padding(.top, 26)
                Text("It'll show as skipped. Your plan keeps moving.")
                    .font(.body(14))
                    .foregroundStyle(Theme.txt.opacity(0.58))
                    .multilineTextAlignment(.center)
                    .padding(.top, 8).padding(.horizontal, 30)
                Spacer(minLength: 0)
                Button {
                    showSkipConfirm = false
                    skipTodayAction()
                } label: {
                    Text("Skip today's run")
                        .font(.body(15, weight: .extraBold))
                        .foregroundStyle(Color(hex: 0xFF8A82))
                        .frame(maxWidth: .infinity).padding(.vertical, 15)
                        .background(Color(hex: 0xFF5A52).opacity(0.14),
                                    in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(Color(hex: 0xFF5A52).opacity(0.3), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 22)
                Button { showSkipConfirm = false } label: {
                    Text("Cancel")
                        .font(.body(14, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.6))
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                }
                .buttonStyle(.plain)
                .padding(.bottom, 10)
            }
        }
        .presentationDetents([.height(280)])
        .presentationDragIndicator(.hidden)
    }

    private func skipTodayAction() {
        Task {
            do {
                try await API.postSkipToday()
                await MainActor.run { self.skipped = true }
            } catch {
                print("[today v2] skip failed: \(error)")
            }
        }
    }

    /// Undo today's skip · DELETE /api/today/skip, flip back to the run, and
    /// reload so the plan/workout re-hydrate into the run hero.
    private func unskipTodayAction() {
        Task {
            do {
                try await API.deleteSkipToday()
                await MainActor.run { self.skipped = false }
                await loadAll()
            } catch {
                print("[today v2] unskip failed: \(error)")
            }
        }
    }

    // restoreAdaptationAction retired 2026-06-01 round 2 along with
    // the in-sheet banner. When the AdaptationCard above the hero
    // grows a Restore affordance, re-introduce a posted decline-with-
    // intent-id call here (or move it onto AdaptationCard so both
    // surfaces share one path).

    /// Phase breakdown rendered in the drag-sheet. Empty when no real
    /// phases on the workout · TodayView's drag sheet gates the section on
    /// `segments.isEmpty` so this drops out cleanly. Was a type-derived
    /// hardcoded fallback ("Warm up · 2 mi @ easy", "Threshold · 4 mi @
    /// target", etc.) that showed every easy/tempo/long day regardless of
    /// the runner's actual plan.
    private var segments: [(String, String)] {
        guard let phases = displayWorkout?.phases, !phases.isEmpty else { return [] }
        return phases.map { p in
            let pace = p.targetPaceSPerMi.map { "@ \(formatPace(secondsPerMi: $0))" } ?? ""
            return (p.label, pace)
        }
    }

    /// Real conditions block · weather temperature from the prescription
    /// weather baseline, shoe assignment from the planned workout (when
    /// the runner pinned one), fuel summary from prescription fueling.
    /// All optional · the drag-sheet renders "—" when missing rather than
    /// the prior hardcoded "Water" fuel default.
    private struct Conditions { let weather: String; let shoe: String; let fuel: String }
    private var conditions: Conditions {
        // Weather · null-out clearly-bogus values so the cell renders
        // "—" instead of "0°F". 2026-06-01 round 2 feedback: 0°F was
        // showing on a run-day where the forecast hadn't fetched yet.
        // Real outdoor running temps sit in [10, 130]°F · anything
        // outside that is almost certainly a default or sensor glitch.
        let weather: String = {
            if let t = self.weather?.tempF, t > 10, t < 130 {
                return "\(Int(t.rounded()))°F"
            }
            return "—"
        }()
        // WatchWorkout doesn't carry a shoe field today. When it does, wire
        // it here. Returning "—" until then is more honest than "Apple
        // Watch" or any other guess.
        let shoe = "—"
        let fuel: String = {
            guard let f = displayWorkout?.fueling, f.needed else { return "—" }
            if !f.shortLine.isEmpty { return f.shortLine }
            if f.gels > 0 { return "\(f.gels) gels · \(f.gPerHr) g/hr" }
            return "—"
        }()
        return Conditions(weather: weather, shoe: shoe, fuel: fuel)
    }

    // coachNote · removed 2026-05-31. Was rendering a hardcoded
    // "Stay in the temperature..." string whenever briefing?.lead was
    // null, which was always for several user shapes. Faff Coach block
    // now reads /api/today/purpose (verdict + facts + citations) and
    // hides entirely when the payload is nil. No placeholder fallback.

    /// Status bar height for the current device. Used to compute the week strip
    /// clearance — FaffMeshView internally ignores safe area, pulling the ZStack
    /// to y=0, so the clearance must include the status bar + top bar content.
    private var screenSafeAreaTop: CGFloat {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first?.windows.first(where: { $0.isKeyWindow })?
            .safeAreaInsets.top ?? 54
    }

    /// All weeks available for the paged week strip (prev + current + future).
    /// Each element is a 7-day array — one page per week, Sat–Sun order.
    private var allStripWeeks: [[WeekStripDay]] {
        guard let current = plan else { return [] }
        // Build ordered list of backend weeks (Sat-anchored Sat→Fri each).
        var allBackend: [PlanWeek] = []
        if let prev = prevWeekPlan { allBackend.append(prev) }
        allBackend.append(current)
        allBackend += futureWeekPlans

        // Build Mon→Sun display windows by combining:
        //   Mon-Fri (dow 1-5) from backend[i]
        //   Sat-Sun (dow 6, 0) from backend[i+1]  (the upcoming weekend)
        // Without this, sorting within a single Sat-anchored week places the
        // PREVIOUS Sat-Sun at the end of the Mon→Sun strip instead of the
        // upcoming one.
        var result: [[WeekStripDay]] = []
        for i in 0..<allBackend.count {
            let monFri = Array(allBackend[i].days.prefix(7).filter { $0.dow >= 1 && $0.dow <= 5 })
            let weekendSource = i + 1 < allBackend.count ? allBackend[i + 1] : allBackend[i]
            let satSun = Array(weekendSource.days.prefix(7).filter { $0.dow == 6 || $0.dow == 0 })
            let displayDays = (monFri + satSun).sorted { $0.date_iso < $1.date_iso }
            if !displayDays.isEmpty {
                result.append(makeStripDays(from: displayDays))
            }
        }
        return result
    }

    private func makeStripDays(from days: [PlanDay]) -> [WeekStripDay] {
        days.map { d in
            WeekStripDay(
                id: d.date_iso,
                dow: dowLetter(d.dow),
                date: dayNumber(d.date_iso),
                effort: FaffEffort.fromType(d.type),
                isToday: d.is_today,
                isDone: d.completedRunId != nil,
                // Today's skip lands in day_actions (the `skipped` @State from
                // GET /api/today/skip) before the plan/week API folds it into
                // PlanDay.skipped — OR it in so the strip greys immediately,
                // consistent with the SKIPPED hero.
                isSkipped: (d.skipped ?? false) || (d.is_today && skipped),
                strengthSuggested: strengthDays.contains(d.date_iso),
                strengthDone: strengthDoneDays.contains(d.date_iso),
                strengthPaused: strengthPausedDays.contains(d.date_iso)
            )
        }
    }

    private func dowLetter(_ i: Int) -> String {
        // dow is 0=Sun..6=Sat (JS Date / UTC convention from the backend).
        let letters = ["S","M","T","W","T","F","S"]
        return letters[((i % 7) + 7) % 7]
    }
    private func dayNumber(_ iso: String) -> Int {
        Int(iso.split(separator: "-").last.map(String.init) ?? "0") ?? 0
    }
    private func formatMi(_ d: Double) -> String {
        d.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(d))" : String(format: "%.1f", d)
    }

    // MARK: - Loaders

    /// Background-fill workoutCache + forecastCache for every strip day so
    /// tapping a day renders from cache instantly (no pop). Bounded concurrency
    /// (5 at a time) keeps it gentle on the backend; skips today (already
    /// loaded) and already-cached days. (David 2026-06-12)
    private func prefetchStripDays() async {
        // Compute the work-list on the main actor — allStripWeeks + the caches
        // are @State and must not be read off-main.
        let ids: [String] = await MainActor.run {
            var seen = Set<String>()
            let cached = Set(workoutCache.keys).intersection(Set(forecastCache.keys))
            return allStripWeeks.flatMap { $0 }
                .map { $0.id }
                .filter { $0 != todayISO && !cached.contains($0) && seen.insert($0).inserted }
        }
        var i = 0
        while i < ids.count {
            let chunk = Array(ids[i ..< min(i + 5, ids.count)])
            await withTaskGroup(of: Void.self) { group in
                for id in chunk {
                    group.addTask {
                        async let w = (try? await API.fetchWatchWorkout(date: id))
                        async let f = (try? await API.fetchDailyForecast(date: id))
                        let (ww, ff) = await (w, f)
                        await MainActor.run {
                            if let ww { self.workoutCache[id] = ww }
                            if let ff { self.forecastCache[id] = ff }
                        }
                    }
                }
            }
            i += 5
        }
    }

    private func loadAll() async {
        if plan == nil { await MainActor.run { loadState = .loading } }
        async let w = (try? await API.fetchWatchWorkout())
        async let r = (try? await API.fetchReadiness())
        async let b = (try? await API.briefing(surface: "today", mode: nil))
        async let s = (try? await API.fetchTodaySkipped()) ?? false
        async let pr = (try? await API.fetchProfileState())
        async let ss = (try? await API.fetchStravaStatus())
        async let pp = (try? await API.fetchTodayPurpose())
        // 2026-06-02 round 58 · post-run pivot brief.
        // try? swallows 404 (endpoint not shipped yet) and any decode
        // failures so the morning view never blocks on this fetch.
        async let rb = (try? await API.fetchRecoveryBrief())
        // Toolkit additions · adaptation intent + active niggle +
        // pending coach proposals.
        async let ai = (try? await API.fetchCoachIntents(limit: 1, reasonLike: "plan_adapt_%"))
        async let an = (try? await API.fetchActiveNiggle())
        async let asc = (try? await API.fetchActiveSick())
        async let pp2 = (try? await API.fetchPendingProposals())
        // Strength days for the current week · drives the strip underline + the
        // Today nudge (the fetch also warms the training-state cache).
        async let tstr = (try? await API.fetchTrainingState())

        // Primary fetch · plan drives the hero + week strip + drag sheet.
        // Throws on network failure so we can flip loadState into the
        // explicit failed state; secondary fetches stay try?-swallowed
        // (their absence degrades gracefully via the existing UI).
        let planWeek: PlanWeek?
        let primaryFailure: String?
        do {
            planWeek = try await API.fetchPlanWeek()
            primaryFailure = nil
        } catch {
            planWeek = nil
            primaryFailure = loadFailureMessage(error)
        }
        // Adjacent weeks (1 back + 4 ahead) · all fetched concurrently.
        // Try? so any missing week degrades gracefully.
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"
        let baseStart = planWeek?.week_start_iso ?? todayISO
        func offsetISO(_ weeks: Int) -> String {
            guard let sat = df.date(from: baseStart),
                  let d = Calendar.current.date(byAdding: .day, value: 7 * weeks, to: sat)
            else { return todayISO }
            return df.string(from: d)
        }
        async let wPrev  = (try? await API.fetchPlanWeek(date: offsetISO(-1)))
        async let wNext1 = (try? await API.fetchPlanWeek(date: offsetISO(1)))
        async let wNext2 = (try? await API.fetchPlanWeek(date: offsetISO(2)))
        async let wNext3 = (try? await API.fetchPlanWeek(date: offsetISO(3)))
        async let wNext4 = (try? await API.fetchPlanWeek(date: offsetISO(4)))
        let (prevW, n1, n2, n3, n4) = await (wPrev, wNext1, wNext2, wNext3, wNext4)
        let futureW = [n1, n2, n3, n4].compactMap { $0 }
        let (watch, ready, brief, skip, prof) = await (w, r, b, s, pr)
        let stravaStat = await ss
        let pur = await pp
        let recBrief = await rb
        let adaptList = (await ai) ?? []
        let activeN   = await an
        let activeSickRow = await asc
        let proposals = (await pp2) ?? []
        let trainingS = await tstr
        // Weather baseline runs second-pass — it needs the workout type
        // and weekly mileage from the plan/workout. Fire-and-forget; the
        // HOTTER THAN USUAL tag silently hides if the lookup fails.
        // Derive workout type from today's PlanWeek entry (PlanDay.type is
        // the canonical type string the prescription endpoint expects);
        // WatchWorkout doesn't carry a type field directly.
        let todayType = planWeek?.days.first(where: { $0.is_today })?.type.lowercased() ?? "easy"
        let weeklyMi = Int(planWeek?.days.reduce(0.0) { $0 + $1.distance_mi } ?? 30)
        // weeklyMi (planned) feeds the weather prescription's load context.
        // The THIS WEEK chip, by contrast, shows ACTUAL completed miles:
        // sum done_mi (canonical, server-deduped); days not yet run contribute 0.
        let weekDoneMi = planWeek?.days.reduce(0.0) { $0 + ($1.done_mi ?? 0) } ?? 0
        let wx = try? await API.fetchPrescriptionWeather(type: todayType, weeklyMi: weeklyMi)
        await MainActor.run {
            // Only overwrite cached state if the network call returned
            // something · a transient 401 / 5xx shouldn't wipe the
            // hero / week strip / drag sheet visually. `skipped` is a
            // boolean that's safe to overwrite (defaults to false).
            // Adjacent weeks — always update so strip reflects latest data.
            self.prevWeekPlan = prevW
            self.futureWeekPlans = futureW
            if let ts = trainingS {
                self.strengthDays = Set(ts.weeks.flatMap { $0.recommendedStrengthDays ?? [] })
                if let cur = ts.weeks.first(where: { $0.isCurrent }) {
                    self.strengthDoneDays = Set(cur.completedStrengthDays ?? [])
                    self.strengthSuppressed = cur.strengthSuppressed ?? false
                    self.strengthPausedDays = Set(cur.pausedStrengthDays ?? [])
                }
            }
            if let planWeek {
                self.plan = planWeek
                self.loadState = .loaded
            } else if let primaryFailure {
                self.loadState = .failed(primaryFailure)
            } else {
                // 200 OK but JSON decode failed (post-lenient-sweep this
                // should be nearly impossible; keep the branch honest).
                self.loadState = .failed("Couldn't read today's plan.")
            }
            if let watch { self.workout = watch }
            if let ready { self.readiness = ready }
            if let brief { self.briefing = brief }
            if let prof { self.profile = prof }
            if let wx { self.weather = wx }
            // Snap the strip to the current week AND select today in ONE
            // silent (non-animated) transaction, so the first painted frame is
            // already today. allStripWeeks gains a prepended prev week during
            // loadAll, which shifts the current week's index; without a silent
            // snap + explicit today-selection the strip visibly slid from last
            // week into today and the hero showed a default "EASY" until the
            // selection landed (David 2026-06-12 · "always load on today").
            let resolvedTodayId = planWeek?.today_iso ?? self.plan?.today_iso
            if let idx = self.allStripWeeks.firstIndex(where: {
                $0.contains(where: { $0.isToday || ($0.id == resolvedTodayId && resolvedTodayId != nil) })
            }) {
                var tx = Transaction()
                tx.disablesAnimations = true
                withTransaction(tx) {
                    self.selectedWeekIndex = idx
                    if let tid = resolvedTodayId { self.selectedDayID = tid }
                }
            }
            // Zero-pop launch · the primary surface is painted. Signal the
            // splash gate. Trailing fetches (forecast, shoes) ride the
            // settle buffer in RootContainer — they never pop into a
            // visible tab because the splash still covers it.
            NotificationCenter.default.post(name: .faffSurfaceReady, object: "today")
            // Background-fill every strip day's workout + forecast so tapping a
            // day is instant (no pop). Runs after the primary surface is up so
            // it never delays first paint. (David 2026-06-12)
            Task { await prefetchStripDays() }
            // 2026-06-02 · forecast (range_label + best_window) fetched
            // separately · server returns 404 if no GPS home base yet,
            // which is fine · the iPhone falls back to "—" cells.
            Task {
                let date = selectedDayID.isEmpty
                    ? (planWeek?.today_iso ?? self.plan?.today_iso ?? todayISO)
                    : selectedDayID
                // 2026-06-02 round 41 · pass workout duration so backend
                // composes the workout-window temp range
                // (temp_start_f / temp_end_f / window_label). The pre-run
                // CONDITIONS row renders the window range, not the
                // daily min/max swing. Falls back gracefully if the
                // workout isn't loaded yet.
                let mins = workout?.totalEstimatedMinutes
                let f = try? await API.fetchDailyForecast(
                    date: date,
                    durationMin: (mins != nil && mins! > 0) ? mins : nil
                )
                await MainActor.run { self.forecast = f }
            }
            // 2026-06-02 · prime the shoe garage from the canonical
            // /api/shoe endpoint so the picker has data before the
            // runner ever taps the SHOE cell. /api/profile/state's
            // shoes field can be nil in prod (David's case · empty);
            // the dedicated fetch is the source of truth.
            Task {
                if let resp = try? await API.fetchShoes(),
                   let garage = resp.shoes, !garage.isEmpty {
                    await MainActor.run { self.shoeGarage = garage }
                }
            }
            if let stravaStat { self.stravaStatus = stravaStat }
            // Purpose · only overwrite when the fetch actually returned a
            // payload; nil from a transient 5xx shouldn't blank a previously
            // loaded coach card. Doctrine: empty-state from a successful nil
            // is honest; empty-after-a-fail looks identical and isn't.
            if let pur, !pur.verdict.isEmpty { self.purpose = pur }
            // 2026-06-02 round 58 · only overwrite recoveryBrief when
            // the fetch returned something. nil from a transient 404
            // (backend B1 not shipped) shouldn't blank a previously-
            // loaded brief. Doctrine matches purpose handling above.
            if let recBrief { self.recoveryBrief = recBrief }
            // 2026-06-02 round 40 · TO RACE chip fallback. When purpose
            // doesn't carry weeksToRace (server 500 / cold path / no
            // anchor race yet on the plan), resolve client-side from
            // /api/races. Picks the highest-priority future race
            // (A > B > C), tie-broken by earliest date. Excludes
            // priority=hilly-excluded (context-only races like Big Sur
            // that aren't meant to anchor training). Defense in depth
            // against /api/today/purpose hiccups; clears once purpose
            // resumes returning a value.
            let needsFallback = (pur?.weeksToRace ?? 0) <= 0
            if needsFallback {
                Task {
                    if let resp = try? await API.fetchRaces(),
                       let anchor = self.pickAnchorRace(resp.races) {
                        await MainActor.run { self.raceFallback = anchor }
                    }
                }
            } else {
                // Purpose came back with a real weeksToRace · drop any
                // stale fallback so the computed property prefers the
                // server-composed value cleanly.
                self.raceFallback = nil
            }
            self.skipped = skip
            self.adaptationIntent = adaptList.first
            self.activeNiggle = activeN
            self.activeSick = activeSickRow
            self.pendingProposals = proposals
            let resolvedToday = planWeek?.today_iso ?? self.plan?.today_iso
            if let today = resolvedToday, selectedDayID.isEmpty { selectedDayID = today }

            // Today redesign (2026-06-01) · readiness-panel stat chips.
            //
            // LAST NIGHT · 2026-06-02 round 42 · the value now lives as
            // a computed property reading hkImporter.lastNightHours with
            // a readiness.sleep7Avg fallback, so the chip refreshes
            // automatically when the importer publishes a new value
            // (background→fg triggered import lands). No write here.
            //
            // THIS WEEK · ACTUAL completed miles this week (done_mi, canonical
            // /server-deduped), computed above as weekDoneMi. Was previously
            // summing planned distance_mi, which disagreed with the web (~done)
            // and read as 44 vs 32 done. The Train tab's "MI PLANNED" card keeps
            // planned; this readiness chip intentionally shows done, not planned.
            self.thisWeekMiles = weekDoneMi
            // Re-pick the time-of-day in case the runner has been in the
            // app across an hour boundary (5am / noon / 5pm / 9pm). Cheap.
            self.timeOfDay = TimeOfDay.current()
        }

        // Today v2 (2026-06-01) · post-run hydration. When the selected
        // day has a completedRunId, fetch its RunDetail + RunRecap so
        // the sheet body can render the v2 post-run content. Both
        // fetches are best-effort · nil leaves the sheet in skeleton
        // until the next refresh.
        let runId = await MainActor.run { completedRunId }
        if let id = runId {
            async let d = (try? await API.fetchRunDetail(id: id))
            async let rc = (try? await API.fetchRunRecap(runId: id))
            let (detail, recap) = await (d, rc)
            await MainActor.run {
                if let detail { self.completedDetail = detail }
                if let recap { self.completedRecap = recap }
            }
        } else {
            await MainActor.run {
                self.completedDetail = nil
                self.completedRecap = nil
            }
        }
    }

    // MARK: - Toolkit helpers

    /// True when an ISO timestamp falls within the last 24 hours · drives
    /// AdaptationCard visibility on Today.
    /// True when a briefing topic actually has something to render. A
    /// topic with no payload AND no coach_note is just noise · skip it.
    /// Also skip topics already surfaced elsewhere (workout_breakdown
    /// is rendered as PRESCRIPTION above; next_workout is the hero).
    private func isWorthShowing(_ t: Topic) -> Bool {
        switch t.kind {
        case .next_workout, .weather_chip:
            return false   // already covered by the hero + HeatBandChip
        case .unknown:
            return (t.coach_note ?? "").isEmpty == false
        default:
            return (t.payload?.isEmpty == false) || (t.coach_note ?? "").isEmpty == false
        }
    }

    private func isWithinLast24h(_ iso: String) -> Bool {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let cleaned = iso.replacingOccurrences(of: " ", with: "T")
        guard let d = fmt.date(from: cleaned) ?? fmt.date(from: cleaned + "Z") else { return false }
        return Date().timeIntervalSince(d) <= 24 * 3600
    }

    /// Daily niggle check · POSTs the runner's "better/same/worse/gone"
    /// reply to /api/niggle/recovery. "Gone" also clears the niggle so
    /// the chip stops appearing tomorrow.
    private func handleNiggleCheck(_ status: NiggleStatus) {
        Task {
            _ = try? await API.postNiggleRecovery(status: status)
            if status == .gone {
                _ = try? await API.clearNiggle()
                await MainActor.run { self.activeNiggle = nil }
            }
        }
    }

    /// "Yes, ease me back" on ReturnGateCard · posts recovered, clears
    /// the local sick state immediately so the card disappears, then
    /// reloads so the rest of Today reflects the resumed plan.
    private func handleSickReturn() async {
        _ = try? await API.postSickRecovery(trend: "recovered")
        await MainActor.run { self.activeSick = nil }
        await loadAll()
    }

    /// "Still resting" on ReturnGateCard · logs a same-trend check-in
    /// without clearing the episode. Card stays visible tomorrow.
    private func handleStillResting() async {
        _ = try? await API.postSickRecovery(trend: "same")
    }
}

// MARK: - Hero step list (Garmin-inspired)

/// One step row in the hero workout breakdown.
fileprivate struct HeroSeg {
    let weight: Double
    let color: Color
    let topLabel: String
    let bottomLabel: String
}

fileprivate enum HeroStepItem {
    case row(HeroSeg)
    /// Interval repeat block: N identical work+recovery pairs collapsed into one entry.
    case repeatGroup(count: Int, work: HeroSeg, recovery: HeroSeg?)
}

/// Garmin-style vertical step list. Interval workouts render as a
/// compact repeat block (Warm Up · REPEAT N× · Cool Down) instead of
/// listing every rep/recovery row individually.
fileprivate struct HeroStepList: View {
    let steps: [HeroStepItem]
    var effort: FaffEffort = .easy
    @State private var showIntervalInfo = false

    private var effortNote: String? {
        switch effort {
        case .easy:
            return "A comfortable effort where you can hold a conversation. Builds your aerobic base and helps your body recover between harder sessions."
        case .long:
            return longRunNote
        case .tempo:
            return "A sustained hard effort — harder than easy but not all-out. Trains your body to clear lactate faster, which directly raises your race pace ceiling."
        default:
            return nil
        }
    }

    private var longRunNote: String {
        let rowLabels = steps.compactMap { item -> String? in
            if case .row(let seg) = item { return seg.topLabel.uppercased() }
            return nil
        }
        let hasMPace = rowLabels.contains { $0.contains("M PACE") || $0.contains("MARATHON") || $0.contains("@MP") || $0.contains("@M ") }
        let hasTempo = rowLabels.contains { $0.contains("TEMPO") || $0.contains("THRESHOLD") }
        if hasTempo {
            return "Mostly easy miles, finishing with a tempo push. Builds endurance while sharpening your lactate threshold — both matter for the back half of a race."
        }
        if hasMPace {
            let mpSeg = steps.compactMap { item -> HeroSeg? in
                if case .row(let seg) = item {
                    let l = seg.topLabel.uppercased()
                    if l.contains("M PACE") || l.contains("MARATHON") || l.contains("@MP") || l.contains("@M ") { return seg }
                }
                return nil
            }.first
            let dist = mpSeg.map { $0.bottomLabel.components(separatedBy: " · ").first ?? "" } ?? ""
            let distStr = dist.isEmpty ? "the final miles" : dist
            return "Mostly easy miles to build endurance, then \(distStr) at marathon pace on tired legs. This is one of the most specific workouts for marathon prep."
        }
        return "Your biggest run of the week at a fully conversational pace. Builds endurance and trains your body to burn fat efficiently."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(steps.indices, id: \.self) { i in
                switch steps[i] {
                case .row(let seg):
                    stepRow(seg)
                case .repeatGroup(let count, let work, let recovery):
                    repeatBlock(count: count, work: work, recovery: recovery)
                }
            }
            if let note = effortNote {
                Text(note)
                    .font(.body(13, weight: .regular))
                    .foregroundStyle(Color.white.opacity(0.52))
                    .lineSpacing(3)
                    .padding(.top, 4)
            }
        }
    }

    private func intervalExplainer(count: Int, work: HeroSeg, recovery: HeroSeg?) -> String {
        let wParts = work.bottomLabel.components(separatedBy: " · ")
        let wDist  = wParts.first ?? work.bottomLabel
        let wPace  = wParts.count > 1 ? wParts[1] : ""
        var text = "Run \(wDist)" + (wPace.isEmpty ? "" : " at \(wPace)")
        if let rec = recovery {
            let rTime = rec.bottomLabel.components(separatedBy: " · ").first ?? rec.bottomLabel
            text += ", then jog for \(rTime)"
        }
        text += ". Do that \(count) times."
        text += " Interval runs push your aerobic ceiling — the engine that converts into faster race pace."
        return text
    }

    @ViewBuilder
    private func stepRow(_ seg: HeroSeg) -> some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(seg.color)
                .frame(width: 4)
            Text(seg.topLabel)
                .font(.body(15, weight: .extraBold))
                .tracking(-0.2)
                .foregroundStyle(.white)
            Spacer(minLength: 0)
            Text(seg.bottomLabel)
                .font(.body(13, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.72))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Color.white.opacity(0.08),
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(Color.white.opacity(0.10), lineWidth: 1))
    }

    @ViewBuilder
    private func repeatBlock(count: Int, work: HeroSeg, recovery: HeroSeg?) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Neutral app-chrome repeat header — no interval color
            HStack(spacing: 5) {
                Image(systemName: "repeat")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Color.white.opacity(0.38))
                Text("REPEAT \(count)×")
                    .font(.body(10, weight: .extraBold))
                    .tracking(1.0)
                    .foregroundStyle(Color.white.opacity(0.38))
                Spacer(minLength: 0)
                Button {
                    withAnimation(.easeInOut(duration: 0.22)) { showIntervalInfo.toggle() }
                } label: {
                    Text(showIntervalInfo ? "close" : "what is this?")
                        .font(.body(10, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(showIntervalInfo ? 0.28 : 0.48))
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 11)
            .padding(.bottom, 7)

            if showIntervalInfo {
                Divider().background(Color.white.opacity(0.06))
                Text(intervalExplainer(count: count, work: work, recovery: recovery))
                    .font(.body(12.5, weight: .regular))
                    .foregroundStyle(Color.white.opacity(0.72))
                    .lineSpacing(4)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.white.opacity(0.03))
                    .transition(.opacity)
            }

            Divider().background(Color.white.opacity(0.08))

            // Work phase
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(work.color)
                    .frame(width: 3)
                Text(work.topLabel)
                    .font(.body(13, weight: .bold))
                    .foregroundStyle(.white)
                Spacer(minLength: 0)
                Text(work.bottomLabel)
                    .font(.body(12, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.65))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)

            if let rec = recovery {
                Divider().background(Color.white.opacity(0.06))
                HStack(spacing: 10) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(rec.color)
                        .frame(width: 3)
                    Text(rec.topLabel)
                        .font(.body(13, weight: .bold))
                        .foregroundStyle(Color.white.opacity(0.70))
                    Spacer(minLength: 0)
                    Text(rec.bottomLabel)
                        .font(.body(12, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.48))
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
            }
        }
        .background(Color.white.opacity(0.08),
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(Color.white.opacity(0.10), lineWidth: 1))
    }
}

// MARK: - Effort meter position

extension FaffEffort {
    /// Position of the marker on the effort meter (0..1).
    var meterPosition: Double {
        switch self {
        case .rest:      return 0.04
        case .recovery:  return 0.10
        case .easy:      return 0.30
        case .long:      return 0.55
        case .tempo:     return 0.76
        case .intervals: return 0.93
        case .race:      return 0.95
        }
    }
}
