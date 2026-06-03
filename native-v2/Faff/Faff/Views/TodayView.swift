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
    @State private var sheetProgress: Double = 1     // 1 = collapsed
    @State private var skipped: Bool = false
    @State private var showNudge: Bool = false
    @State private var refreshing: Bool = false
    @State private var dayWorkout: WatchWorkout?   // workout fetched for a non-today selected day
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
    // 2026-06-02 round 14 · run-mode picker state retired. The pre-run
    // CTA splits into two inline NavigationLink buttons (Outdoor +
    // Treadmill) · no popover, no action sheet, no pending-route state.
    // See modeButton() in startCTAButton for the implementation.
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
    /// VO₂ max · drives the VO₂ MAX readiness stat chip.
    /// Comes from profile.physiology.vo2.
    /// Toggles the full readiness brief sheet (2026-06-01) · tap on the
    /// readiness panel hero presents this. Sheet hydrates from
    /// /api/readiness/brief inside its own .task.
    @State private var showReadinessBrief: Bool = false
    /// Post-run RunDetail · hydrated when the selected day has a
    /// completedRunId. Drives the Today v2 post-run sheet body
    /// (designs/from Design agent/Today page v2/).
    @State private var completedDetail: RunDetail?
    /// Post-run RunRecap · verdict + facts + (future) `win` line.
    @State private var completedRecap: RunRecap?

    var body: some View {
        // Time-of-day mesh (2026-06-01) · no longer recolors by run.
        // Per-run accent still tints the week dot · peek/session ticks ·
        // Start button dot · but the background is hour-bound.
        let mesh = FaffMesh.forTimeOfDay(timeOfDay)
        ZStack {
            FaffMeshView(mesh: mesh)

            VStack(spacing: 0) {
                HStack(alignment: .top, spacing: 12) {
                    // Greeting eyebrow + date + week label · per the
                    // Today redesign brief (2026-06-01). Replaces the
                    // legacy "TODAY" SpecLabel — gives the runner the
                    // time-of-day context the mesh palette is set to.
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 8) {
                            Circle()
                                .fill(.white)
                                .frame(width: 7, height: 7)
                                .shadow(color: .white.opacity(0.7), radius: 5)
                            Text(timeOfDay.greeting.uppercased())
                                .font(.body(11, weight: .extraBold))
                                .tracking(1.4)
                                .foregroundStyle(Color.white.opacity(0.78))
                                .lineLimit(1)
                        }
                        Text(dayHeaderLabel)
                            .font(.body(22, weight: .extraBold))
                            .tracking(-0.4)
                            .foregroundStyle(Theme.txt)
                            .padding(.top, 4)
                        if let wk = weekContextLabel {
                            Text(wk)
                                .font(.body(11, weight: .bold))
                                .tracking(1.0)
                                .foregroundStyle(Color.white.opacity(0.66))
                        }
                    }
                    Spacer(minLength: 4)
                    Button {
                        guard !refreshing else { return }
                        refreshing = true
                        Task {
                            await loadAll()
                            await MainActor.run { refreshing = false }
                        }
                    } label: {
                        Image(systemName: "arrow.triangle.2.circlepath")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(refreshing ? 0.4 : 0.85))
                            .frame(width: 28, height: 28)
                            .background(Theme.Glass.fill, in: Circle())
                            .overlay(Circle().stroke(Theme.Glass.line, lineWidth: 1))
                            .rotationEffect(.degrees(refreshing ? 360 : 0))
                            .animation(refreshing ? .linear(duration: 1).repeatForever(autoreverses: false) : .default, value: refreshing)
                    }
                    .buttonStyle(.plain)
                    .disabled(refreshing)

                    // 2026-06-02 round 37 · bell stripped to a direct
                    // notification-inbox tap. The other three menu
                    // items (Log niggle / Log non-run / Today's shoe)
                    // moved to the Run-tab action menu where they
                    // belong (centralized run actions). No more menu
                    // wrap · single-purpose button.
                    Button { showInbox = true } label: {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: "bell.fill")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(Theme.txt)
                                .frame(width: 32, height: 32)
                                .background(Theme.Glass.fill, in: Circle())
                                .overlay(Circle().stroke(Theme.Glass.line, lineWidth: 1))
                            if hasNudge {
                                Circle()
                                    .fill(Theme.race)
                                    .frame(width: 8, height: 8)
                                    .overlay(Circle().stroke(Theme.bg, lineWidth: 1.5))
                                    .offset(x: -2, y: 2)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    Button { onProfile() } label: {
                        // 2026-06-02 round 16 · avatar button now matches the
                        // other topbar circles (translucent glass + stroke)
                        // instead of the coral→red gradient, which read as
                        // a notification badge / alert. Falls back to a
                        // person SF Symbol when initials are empty (profile
                        // hasn't loaded yet or identity has no name).
                        Group {
                            if !avatarInitials.isEmpty {
                                Text(avatarInitials)
                                    .font(.display(12, weight: .bold))
                            } else {
                                Image(systemName: "person.fill")
                                    .font(.system(size: 13, weight: .bold))
                            }
                        }
                        .foregroundStyle(Theme.txt)
                        .frame(width: 32, height: 32)
                        .background(Theme.Glass.fill, in: Circle())
                        .overlay(Circle().stroke(Theme.Glass.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 24)
                .padding(.top, 8)

                if let week = plan {
                    let days = makeStripDays(from: week)
                    WeekStrip(days: days, selectedID: $selectedDayID)
                        .padding(.horizontal, 22)
                        .padding(.top, 12)
                }

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

                // Readiness panel · the new Today hero (2026-06-01).
                // Replaces the legacy run-name + pace + effort-meter
                // hero. Tap routes to the full readiness brief surface
                // (stubbed until that surface design lands · brief:
                // designs/briefs/readiness-brief-iphone-surface-brief.md).
                TodayReadinessPanel(
                    snapshot: readiness,
                    lastNightHours: lastNightHours,
                    thisWeekMiles: thisWeekMiles,
                    vo2: profile?.physiology.vo2,
                    bestWindow: forecast?.best_window,
                    weeksToRace: weeksToRaceValue,
                    nextHardLabel: nextHardLabel,
                    onTap: { onReadinessTap() }
                )
                .padding(.horizontal, 22)
                .padding(.top, 22)
                .opacity(max(0.05, 1.0 - (1 - sheetProgress) * 1.1))
                .offset(y: -22 * (1 - sheetProgress))

                Spacer(minLength: 0)
            }

            DragSheet(
                // 2026-06-02 round 25 · 150 → 180.
                // 2026-06-02 round 46 · 180 → 200. David flagged the
                // peek sat right against the tab bar pill · 20pt more
                // clearance gives a comfortable gap so the tab bar
                // reads as separate from the peek.
                collapsedInsetFromBottom: 200,
                progress: $sheetProgress,
                peekBackground: peekFill,
                grabTint: Color.white.opacity(0.6),
                header: { peekHeader },
                content: { sheetContent }
            )

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
            //
            // `startCTAButton`, `showsRunModePicker`, and the related
            // state stay in the file as dead-but-cheap symbols ready
            // for the new design to re-enable or repoint.
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
        .onChange(of: selectedDayID) { _, newID in
            // Tapped a day in the week strip · fetch that day's planned
            // workout so the drag sheet + hero reflect Sunday's long run
            // instead of today's rest day, etc.
            guard !newID.isEmpty else { return }
            Task {
                if newID == todayISO {
                    // Today's workout was already loaded by loadAll().
                    await MainActor.run { dayWorkout = nil }
                } else {
                    let w = try? await API.fetchWatchWorkout(date: newID)
                    await MainActor.run { dayWorkout = w }
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
                // 2026-06-02 · refresh forecast for the newly selected
                // day so FORECAST + BEST WINDOW reflect that day's
                // strings, not yesterday's cache.
                let f = try? await API.fetchDailyForecast(date: newID)
                await MainActor.run { self.forecast = f }
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
        VStack(alignment: .leading, spacing: 18) {
            // sub label + optional weather tag (drawn inline so it sits on
            // the same baseline as the existing "EASY · 8:30/mi" eyebrow)
            HStack(spacing: 8) {
                SpecLabel(text: subLabel, size: 13, tracking: 0.5, color: Theme.txt.opacity(0.92))
                    .textCase(.uppercase)
                // HeatBandChip · tints the conditions chip on the
                // neutral / warm / hot / extreme ramp derived from
                // today's tempF. Replaces the legacy HOTTER/COOLER tag
                // visually (we keep the absolute temp in the chip).
                // Toolkit · Family J.
                if let t = weather?.tempF {
                    HeatBandChip(band: HeatBand.from(tempF: t),
                                 tempLabel: "\(Int(t.rounded()))°F")
                } else if let tag = weatherTagLabel {
                    // Fallback for the (rare) case where deltaF is set
                    // but tempF is nil · keeps the legacy delta tag
                    // visible until the next weather refresh.
                    Text(tag)
                        .font(.label(9)).tracking(1.5)
                        .foregroundStyle(Color(hex: 0x1C0A02))
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(weatherTagColor, in: RoundedRectangle(cornerRadius: 5))
                }
            }
            // big workout name
            Text(workoutName)
                .displayRecipe(size: 58, weight: .bold)
                .foregroundStyle(Theme.txt)
                .lineSpacing(-12)
                .shadow(color: .black.opacity(0.32), radius: 30, y: 2)

            HStack(spacing: 26) {
                stat(key: "Distance",     value: distanceStr)
                stat(key: "Target Pace",  value: paceStr)
            }
            .padding(.top, 2)

            // HR cap chip · only on easy / heat-flag days where the
            // watch carries an explicit hrCeilingBpm. Toolkit · Family B.
            // The pace shows what to run; the cap shows when easy would
            // turn into tempo if you let it.
            if let cap = displayWorkout?.hrCeilingBpm, cap > 0 {
                HRTargetPill(variant: .cap(bpm: cap,
                                            note: "let it climb and easy becomes tempo"))
                    .padding(.top, 4)
            }

            EffortMeter(
                position: selectedEffort.meterPosition,
                label: selectedEffort.effortLabel.uppercased(),
                height: 6,
                showZones: true
            )
            .padding(.top, 16)
            .frame(maxWidth: 236, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func stat(key: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            SpecLabel(text: key, size: 10, tracking: 1, color: Theme.txt.opacity(0.72))
            Text(value)
                .font(.display(23, weight: .bold))
                .tracking(-0.5)
                .foregroundStyle(Theme.txt)
                .shadow(color: .black.opacity(0.3), radius: 18, y: 1)
        }
    }

    /// Peek header · the row inside the accent-filled grab band. White
    /// text in all states; on done, swaps the small dot for a green
    /// check-in-circle and the effort label for a DONE pill. (Today
    /// v2 brief 2026-06-01.)
    private var peekHeader: some View {
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
                // 2026-06-02 round 45 · type-word title, distance subtitle.
                // Old: workout name + "Today's session" — name read as
                // noise (already echoed in the hero) and "Today's session"
                // told the runner nothing. Now: vocabulary matches the
                // hero (INTERVALS / TEMPO / LONG / EASY) + actual mileage.
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

    private var sheetContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Today v2 (2026-06-01) · branch: completed days render the
            // post-run results body; pre-run days fall through to the
            // existing prescription/fueling/conditions/coach stack.
            if isDone {
                TodayPostRunBody(
                    detail: completedDetail,
                    recap: completedRecap,
                    accent: selectedEffort.dot,
                    runId: completedRunId,
                    // 2026-06-02 round 45 · type word for eyebrow + hero
                    // (matches pre-run + web). workout name moves to a
                    // subtitle line. selectedEffort.effortLabel was the
                    // severity ("MAX") · should be the type word so
                    // both surfaces tell the same story.
                    effortLabel: peekTitleWord,
                    dowLabel: selectedIsToday ? "TODAY" : shortDOWLabel,
                    titleText: peekTitleWord,
                    nameSubtitle: plainWorkoutName
                )
            } else {
                preRunSheetContent
            }
        }
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

    /// Existing pre-run content (prescription/segments + fueling +
    /// conditions + coach + start-button-inside-sheet) hoisted out so
    /// the post-run branch can substitute cleanly. The body below is
    /// unchanged from the v1 implementation · only its enclosing
    /// container changed.
    private var existingPrescriptionAndConditions: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Prefer the server-emitted prescription rows when present
            // (briefing.workout_breakdown · PACE / HR CAP / DURATION / FUEL).
            // Falls back to client-derived phases when the briefing didn't
            // emit per-day breakdown rows (rest days, missed states, etc).
            if let rows = briefing?.workout_breakdown, !rows.isEmpty {
                pBlock(title: "PRESCRIPTION") {
                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(rows) { r in
                            HStack(alignment: .top, spacing: 13) {
                                Rectangle()
                                    .fill(selectedEffort.dot)
                                    .frame(width: 3)
                                    .frame(minHeight: 34)
                                    .clipShape(RoundedRectangle(cornerRadius: 3))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(r.label)
                                        .font(.body(15, weight: .extraBold))
                                        .tracking(-0.2)
                                        .foregroundStyle(Color(hex: 0x14110D))
                                    HStack(spacing: 6) {
                                        Text(r.body)
                                            .font(.body(13))
                                            .foregroundStyle(Color(hex: 0x736C61))
                                        if let tail = r.tail, !tail.isEmpty {
                                            Text(tail)
                                                .font(.body(11, weight: .semibold))
                                                .foregroundStyle(Color(hex: 0xA39A8C))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } else if !segments.isEmpty {
                // Only render THE SESSION when the workout has real phase
                // data · the segments fallback used to fabricate a Warm
                // up / Threshold / Cool down breakdown derived purely
                // from the effort type so easy days got fake structure.
                pBlock(title: "THE SESSION") {
                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(segments, id: \.0) { (label, desc) in
                            HStack(alignment: .top, spacing: 13) {
                                Rectangle()
                                    .fill(selectedEffort.dot)
                                    .frame(width: 3)
                                    .frame(minHeight: 34)
                                    .clipShape(RoundedRectangle(cornerRadius: 3))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(label)
                                        .font(.body(15, weight: .extraBold))
                                        .tracking(-0.2)
                                        .foregroundStyle(Color(hex: 0x14110D))
                                    Text(desc)
                                        .font(.body(13))
                                        .foregroundStyle(Color(hex: 0x736C61))
                                }
                            }
                        }
                    }
                }
            }

            // FUELING — promoted to its own block (2026-05-30 audit). Server
            // emits prescription.fueling with shortLine / gels / atMins; older
            // surfaces buried this inside a 2x2 conditions grid which lost the
            // detail. Tile renders only when the backend says fueling is needed.
            if let f = displayWorkout?.fueling, f.needed {
                pBlock(title: "FUELING") {
                    VStack(alignment: .leading, spacing: 10) {
                        if !f.shortLine.isEmpty {
                            Text(f.shortLine)
                                .font(.body(15, weight: .extraBold))
                                .tracking(-0.2)
                                .foregroundStyle(Color(hex: 0x14110D))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        HStack(spacing: 18) {
                            fuelStat(key: "GELS",   value: "\(f.gels)")
                            fuelStat(key: "G/HR",   value: "\(f.gPerHr)")
                            fuelStat(key: "TOTAL",  value: "\(f.totalCarbsG) g")
                        }
                        if !f.atMins.isEmpty {
                            HStack(spacing: 6) {
                                SpecLabel(text: "AT MIN", size: 9, tracking: 1.5, color: Color(hex: 0xA39A8C))
                                Text(f.atMins.map(String.init).joined(separator: " · "))
                                    .font(.display(13, weight: .bold))
                                    .foregroundStyle(Color(hex: 0x14110D))
                            }
                        }
                        if !f.why.isEmpty {
                            Text(f.why)
                                .font(.body(11, weight: .medium))
                                .foregroundStyle(Color(hex: 0x736C61))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(hex: 0xEEE7DA))
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                }
            }

            // CONDITIONS & KIT · only render the cells that have real
            // data. 2026-06-01 round 2 feedback: "—" placeholders made
            // the grid feel empty (Weather 0°F + Shoe — + Fuel — left
            // only Effort meaningful). Effort always shows; the rest
            // gate on a non-"—" value. Section header hides when only
            // Effort is left (the effort label is already on the peek).
            do {
                let cells: [(String, String)] = [
                    ("Weather", conditions.weather),
                    ("Shoe",    conditions.shoe),
                    ("Fuel",    conditions.fuel),
                    ("Effort",  selectedEffort.effortLabel),
                ].filter { _, v in v != "—" }
                if cells.count > 1 {  // hide section if only Effort has data
                    pBlock(title: "CONDITIONS & KIT") {
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 1), GridItem(.flexible(), spacing: 1)], spacing: 1) {
                            ForEach(Array(cells.enumerated()), id: \.offset) { _, kv in
                                infoCell(key: kv.0, value: kv.1)
                            }
                        }
                        .background(Color(hex: 0xEEE7DA))
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                    }
                }
            }

            // BRIEFING TOPICS · polymorphic dispatcher across the 27
            // TopicKinds the server emits. Each kind gets a card with
            // a kind-headline + payload lead + coach_note. Unknown
            // kinds gracefully degrade to a kind-label row.
            let renderable = (briefing?.topics ?? []).filter { isWorthShowing($0) }
            if !renderable.isEmpty {
                pBlock(title: "TODAY · NOTES") {
                    VStack(spacing: 8) {
                        ForEach(Array(renderable.enumerated()), id: \.offset) { _, t in
                            BriefingTopicCard(topic: t)
                        }
                    }
                }
            }

            // Faff Coach · driven by /api/today/purpose ("WHY THIS RUN").
            // The whole block hides when purpose is nil OR has an empty
            // verdict. Empty IS the signal · per doctrine, never insert
            // a hardcoded fallback that could be mistaken for real data.
            if let pp = purpose, !pp.verdict.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Faff Coach")
                        .font(.label(10)).tracking(1.5).textCase(.uppercase)
                        .foregroundStyle(selectedEffort.dot)
                    // Verdict · sentence-treatment per design contract
                    // (the verdict is the headline, not a tag).
                    Text(pp.verdict)
                        .font(.body(17, weight: .extraBold))
                        .tracking(-0.3)
                        .foregroundStyle(Color(hex: 0x1B1814))
                        .fixedSize(horizontal: false, vertical: true)
                    if !pp.facts.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(pp.facts.prefix(3), id: \.self) { fact in
                                Text(fact)
                                    .font(.body(13.5, weight: .medium))
                                    .foregroundStyle(Color(hex: 0x3C362F))
                                    .lineSpacing(3)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .padding(.top, 2)
                    }
                    // Citation chips removed 2026-05-31 · coach voice
                    // doctrine (c14df7c5) dropped the academic citations
                    // surface from /api/today/purpose payloads. The science
                    // is in the rules · it's not in the words shown to the
                    // runner. RunPurpose.citations no longer exists on the
                    // wire model so the chip row is dead code.
                }
                .padding(.horizontal, 24).padding(.vertical, 18)
            }
        }
    }

    private func pBlock<C: View>(title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 13) {
            SpecLabel(text: title, size: 11, tracking: 1.5, color: Color(hex: 0xA39A8C))
            content()
        }
        .padding(.horizontal, 24).padding(.vertical, 18)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color(hex: 0xEEE7DA)).frame(height: 1)
        }
    }

    private func infoCell(key: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SpecLabel(text: key, size: 10, tracking: 1, color: Color(hex: 0xA39A8C))
            Text(value)
                .font(.body(15, weight: .bold))
                .tracking(-0.2)
                .foregroundStyle(Color(hex: 0x14110D))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.white)
    }

    /// Inline stat for the FUELING block — small caps label over a single
    /// big number. Lives inline so the gels/g·hr/total row reads as a
    /// quick-glance metric strip, not a sub-table.
    private func fuelStat(key: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            SpecLabel(text: key, size: 9, tracking: 1.2, color: Color(hex: 0xA39A8C))
            Text(value)
                .font(.display(17, weight: .bold))
                .tracking(-0.5)
                .foregroundStyle(Color(hex: 0x14110D))
        }
    }

    // MARK: - Derived

    private var selectedDayEffort: FaffEffort? {
        guard let week = plan,
              let d = week.days.first(where: { $0.date_iso == selectedDayID })
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
        if skipped { return .rest }
        return selectedDayEffort ?? .easy
    }

    private var subLabel: String {
        switch selectedEffort {
        case .recovery:  return "Easiest · Zone 1"
        case .easy:      return "Easy · Zone 2"
        case .long:      return "Sustained · Z2 → MP"
        case .tempo:     return "Hard · Zone 4 Threshold"
        case .intervals: return "Hardest · Zone 5 VO2"
        case .rest:      return "Rest · Recovery Day"
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

    private var startButtonTitle: String {
        if skipped { return "Log Recovery" }
        if selectedEffort == .rest { return "Log Recovery" }
        // Only today gets a CTA. For non-today selections, the entire
        // CTA is hidden via showsAnyCTA · this title only renders for
        // today, so "Start X" is correct unconditionally.
        return "Start \(plainWorkoutName)"
    }

    /// Route the CTA pushes to:
    ///   · today + active workout → live (watchMirror)
    ///   · past completed day → run detail
    ///   · everything else · CTA hidden, route unused
    ///
    /// 2026-06-01 round 5: dropped the .planned(date:) fallback for
    /// future days. PlannedView was being pushed from Today as a
    /// separate page even though the Today sheet already renders the
    /// same content (selected day's planned workout, conditions,
    /// fueling, coach block). David's feedback: "we do not need it
    /// on or from TODAY." Train + WeekAhead still drill into
    /// PlannedView · those callers are unchanged.
    private var ctaRoute: FaffRoute {
        if selectedIsToday && selectedEffort != .rest && !skipped {
            return .watchMirror
        }
        if let day = todaySelectedDay, let runId = day.completedRunId {
            return .runDetail(id: runId)
        }
        // Unreachable in practice · the CTA is hidden when no real
        // route applies. Fall back to watchMirror so a degenerate
        // tap doesn't crash.
        return .watchMirror
    }

    private var plainWorkoutName: String { workoutName.replacingOccurrences(of: "\n", with: " ") }

    /// "HOTTER 78°F" / "COOLER 52°F" tag derived from /api/prescription's
    /// weather_baseline. Hidden when the delta from baseline is < 6°F
    /// (Maughan's threshold for meaningful heat impact). Returns nil to
    /// hide the badge entirely.
    private var weatherTagLabel: String? {
        guard let wx = weather, let d = wx.deltaF, let t = wx.tempF else { return nil }
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
        plan?.days.first { $0.date_iso == selectedDayID }
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

    /// Optional context line below the date. Composes from the purpose
    /// payload when we have it: "BUILD · 12 weeks to race" or the phase
    /// alone. Null when nothing meaningful · the topbar drops the line
    /// gracefully (no placeholder).
    private var weekContextLabel: String? {
        let phase = (purpose?.phase ?? "").uppercased()
        let weeks = weeksToRaceValue
        if !phase.isEmpty, let w = weeks, w > 0 {
            return "\(phase) · \(w) WEEKS TO RACE"
        }
        if !phase.isEmpty { return "\(phase) PHASE" }
        if let w = weeks, w > 0 { return "\(w) WEEKS TO RACE" }
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

    /// Peek background color · accent for pre-run, emerald for post-run,
    /// neutral grey for rest. Matches the Today v2 brief.
    private var peekFill: Color {
        if isDone { return Color(hex: 0x1F9A6F) }
        if selectedEffort == .rest { return Color(hex: 0x9FB0AD) }
        return selectedEffort.dot
    }

    /// CTA text · swaps to "Share run" on completed days, "Log Recovery"
    /// on rest, "Start <Run>" otherwise.
    private var ctaTitle: String {
        if isDone { return "Share run" }
        if selectedEffort == .rest { return "Log Recovery" }
        return startButtonTitle
    }

    /// CTA tap target · post-run routes to the existing RunDetail surface
    /// (push) where the runner can hit "Push to Strava" already. Pre-run
    /// stays on the existing ctaRoute (watch mirror / planned / etc.).
    private var ctaTargetRoute: FaffRoute {
        if isDone, let id = completedRunId { return .runDetail(id: id) }
        return ctaRoute
    }

    /// Skip-this-run action · POSTs to /api/today/skip via the existing
    /// API helper. Pre-run only (hidden when isDone or rest).
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

    // MARK: - Start CTA · Outdoor / Treadmill picker (2026-06-01)
    //
    // The pre-run CTA shows a Menu with two options · "Outdoor" pushes
    // WatchMirrorView (live Apple Watch mirror), "Treadmill" pushes
    // TreadmillView (guided indoor console). Post-run and rest cases
    // skip the Menu and push directly.
    //
    // Menu is a native SwiftUI affordance · taps land cleanly without
    // any NavigationStack path plumbing, the picker dismisses on a
    // tap-outside, and accessibility maps for free.

    /// True when the Start button should expand into the Outdoor/Treadmill
    /// menu (active workout today, not done, not rest). Other states
    /// (post-run share, rest day "Log Recovery", future planned) push
    /// directly via the existing single-route NavigationLink.
    private var showsRunModePicker: Bool {
        // 2026-06-02 round 12 · dropped selectedIsToday from the gate.
        // The Outdoor / Treadmill picker is meaningful on EVERY pre-run
        // day, not just today · a runner previewing tomorrow's session
        // still needs to choose how they'll execute it. The earlier
        // gate fell straight to the default ctaRoute (.watchMirror)
        // when not-today, bypassing the picker. Symptom: tap Start
        // on a future day → went directly to "FOLLOWING APPLE WATCH ·
        // MIRRORED" with no pick affordance.
        !isDone
            && selectedEffort != .rest
            && !skipped
    }

    /// The bottom CTA · in pre-run state, one primary button defaulting
    /// to Outdoor (~95% of runs) with a tiny subtle "Treadmill instead"
    /// text-link below for the rare indoor case. Treadmill stays
    /// discoverable without dominating screen real-estate · the runner
    /// who needs it sees it; everyone else taps Start and goes.
    ///
    /// Earlier rounds tried: a SwiftUI Menu popover (David: "wack"),
    /// a confirmationDialog action sheet (too Apple-system-y), an
    /// inline 70/30 split (sloppy · sizes felt off, gave treadmill
    /// equal hierarchy to the dominant outdoor case).
    @ViewBuilder
    private var startCTAButton: some View {
        if showsRunModePicker {
            VStack(spacing: 9) {
                NavigationLink(value: FaffRoute.watchMirror) {
                    startButtonShell
                }
                .buttonStyle(.plain)
                NavigationLink(value: FaffRoute.treadmill) {
                    HStack(spacing: 6) {
                        Image(systemName: "figure.run.treadmill.circle.fill")
                            .font(.system(size: 12, weight: .semibold))
                        Text("Treadmill instead")
                            .font(.body(12, weight: .semibold))
                    }
                    .foregroundStyle(Color(hex: 0x9A9286))
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
            }
        } else {
            NavigationLink(value: ctaTargetRoute) {
                startButtonShell
            }
            .buttonStyle(.plain)
        }
    }

    /// Shared visual shell · accent dot (pre-run) or share glyph (post-
    /// run) + title text in the dark capsule. Same look in both Menu
    /// and NavigationLink paths so the runner sees one button no matter
    /// the state.
    private var startButtonShell: some View {
        HStack(spacing: 10) {
            if isDone {
                Image(systemName: "square.and.arrow.up.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
            } else {
                Circle()
                    .fill(selectedEffort.dot)
                    .frame(width: 11, height: 11)
                    .shadow(color: selectedEffort.dot, radius: 4)
            }
            Text(ctaTitle)
                .font(.body(16.5, weight: .extraBold))
                .foregroundStyle(.white)
            // Chevron-up hint retired with the popover · the split CTA
            // doesn't need a "this opens a picker" affordance because
            // each half IS the picker.
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 17)
        .background(Color(hex: 0x1B1814), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .shadow(color: .black.opacity(0.45), radius: 12, y: 4)
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

    private func makeStripDays(from week: PlanWeek) -> [WeekStripDay] {
        week.days.prefix(7).map { d in
            WeekStripDay(
                id: d.date_iso,
                dow: dowLetter(d.dow),
                date: dayNumber(d.date_iso),
                effort: FaffEffort.fromType(d.type),
                isToday: d.is_today,
                isDone: d.completedRunId != nil,
                isSkipped: d.skipped ?? false
            )
        }
    }

    private func dowLetter(_ i: Int) -> String {
        // Backend dow is 1-based (Mon=1..Sun=7). Be defensive: 0-6 also OK.
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

    private func loadAll() async {
        if plan == nil { await MainActor.run { loadState = .loading } }
        async let w = (try? await API.fetchWatchWorkout())
        async let r = (try? await API.fetchReadiness())
        async let b = (try? await API.briefing(surface: "today", mode: nil))
        async let s = (try? await API.fetchTodaySkipped()) ?? false
        async let pr = (try? await API.fetchProfileState())
        async let ss = (try? await API.fetchStravaStatus())
        async let pp = (try? await API.fetchTodayPurpose())
        // Toolkit additions · adaptation intent + active niggle +
        // pending coach proposals.
        async let ai = (try? await API.fetchCoachIntents(limit: 1, reasonLike: "plan_adapt_%"))
        async let an = (try? await API.fetchActiveNiggle())
        async let pp2 = (try? await API.fetchPendingProposals())

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
        let (watch, ready, brief, skip, prof) = await (w, r, b, s, pr)
        let stravaStat = await ss
        let pur = await pp
        let adaptList = (await ai) ?? []
        let activeN   = await an
        let proposals = (await pp2) ?? []
        // Weather baseline runs second-pass — it needs the workout type
        // and weekly mileage from the plan/workout. Fire-and-forget; the
        // HOTTER THAN USUAL tag silently hides if the lookup fails.
        // Derive workout type from today's PlanWeek entry (PlanDay.type is
        // the canonical type string the prescription endpoint expects);
        // WatchWorkout doesn't carry a type field directly.
        let todayType = planWeek?.days.first(where: { $0.is_today })?.type.lowercased() ?? "easy"
        let weeklyMi = Int(planWeek?.days.reduce(0.0) { $0 + $1.distance_mi } ?? 30)
        let wx = try? await API.fetchPrescriptionWeather(type: todayType, weeklyMi: weeklyMi)
        await MainActor.run {
            // Only overwrite cached state if the network call returned
            // something · a transient 401 / 5xx shouldn't wipe the
            // hero / week strip / drag sheet visually. `skipped` is a
            // boolean that's safe to overwrite (defaults to false).
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
            // THIS WEEK · sum of plan days, already computed above. The
            // Train tab does the same calculation; both surfaces stay in
            // sync.
            self.thisWeekMiles = Double(weeklyMi)
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
