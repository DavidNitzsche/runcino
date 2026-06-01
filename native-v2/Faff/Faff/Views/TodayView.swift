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
    @State private var stravaStatus: API.StravaStatusResponse?  // drives the reconnect banner
    /// "WHY THIS RUN" coach payload · /api/today/purpose. Replaces the
    /// legacy briefing?.lead placeholder ("Stay in the temperature for
    /// the day..."). The whole Faff Coach block hides when this is nil ·
    /// no hardcoded fallback. The empty state IS the honest signal.
    @State private var purpose: RunPurpose?
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
    /// Last-night sleep hours · drives the LAST NIGHT readiness stat chip.
    /// Hydrated from /api/health/state inside loadAll().
    @State private var lastNightHours: Double?
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

                    Menu {
                        // Tap-equivalent · keep the existing nudge sheet
                        // as the primary action so the bell behaves the
                        // way runners expect.
                        Button("View nudges") { showNudge = true }
                        Button("Notification inbox") { showInbox = true }
                        Divider()
                        // Toolkit entry points (David's spec: bell/nudge menu).
                        Button("Log a niggle or sick day") { showSymptomSheet = true }
                        Button("Log a non-run session")     { showLogNonRunSheet = true }
                        Button("Today's shoe")             { showShoePicker = true }
                    } label: {
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
                        Text(avatarInitials)
                            .font(.display(12, weight: .bold))
                            .foregroundStyle(Theme.txt)
                            .frame(width: 32, height: 32)
                            .background(
                                LinearGradient(colors: [Color(hex: 0xFF7A45), Color(hex: 0xD6263C)],
                                               startPoint: .topLeading, endPoint: .bottomTrailing),
                                in: Circle()
                            )
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

                // AdaptationCard · only when an adaptation fired in the last 24h.
                if let intent = adaptationIntent, isWithinLast24h(intent.when_iso) {
                    AdaptationCard(intent: intent, onTapDetail: nil)
                        .padding(.horizontal, 22)
                        .padding(.top, 10)
                }

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
                    onTap: { onReadinessTap() }
                )
                .padding(.horizontal, 22)
                .padding(.top, 22)
                .opacity(max(0.05, 1.0 - (1 - sheetProgress) * 1.1))
                .offset(y: -22 * (1 - sheetProgress))

                Spacer(minLength: 0)
            }

            DragSheet(
                collapsedFromTop: 540,
                progress: $sheetProgress,
                peekBackground: peekFill,
                grabTint: Color.white.opacity(0.6),
                header: { peekHeader },
                content: { sheetContent }
            )

            // 2026-06-01 · Start Run / Share Run button.
            //
            // Pre-run: "Start <Run>" (or "Log Recovery" on rest) → routes
            // to ctaRoute (watch mirror / planned / etc.).
            // Post-run: "Share run" → routes to .runDetail(id:) so the
            // runner can hit the existing "Push to Strava" affordance.
            // Today v2 brief: "the start run or share run so its not
            // hidden" · the StickyCTABar respects the tab-bar safe area
            // (no .ignoresSafeArea(.bottom)) so the button sits just
            // above the floating tab bar pill.
            VStack {
                Spacer()
                StickyCTABar(bgColor: Color(hex: 0xFAF7F1)) {
                    NavigationLink(value: ctaTargetRoute) {
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
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 17)
                        .background(Color(hex: 0x1B1814), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .shadow(color: .black.opacity(0.45), radius: 12, y: 4)
                    }
                    .buttonStyle(.plain)
                }
                .frame(height: 100)   // 30pt shorter · no safe-area pad to absorb anymore
            }
            .opacity(1 - sheetProgress)  // hide when sheet is up; sheet has its own CTA below
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
            TodayShoeOverrideSheet(
                profile: profile,
                date: selectedDayID.isEmpty ? todayISO : selectedDayID,
                onPicked: { _ in Task { await loadAll() } }
            )
            .presentationDetents([.medium])
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
                Text(workoutName.replacingOccurrences(of: "\n", with: " "))
                    .font(.body(17, weight: .extraBold))
                    .tracking(-0.3)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Text(isDone ? "Today's run" : "Today's session")
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
                    accent: selectedEffort.dot
                )
            } else {
                preRunSheetContent
            }
        }
    }

    /// Pre-run sheet body · the existing prescription + fueling +
    /// conditions + coach stack, plus the v2 additions (adaptation
    /// banner + Skip this run). Extracted for the isDone branch.
    private var preRunSheetContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Adaptation banner · in-sheet variant of the AdaptationCard
            // above the hero (2026-06-01 Today v2 brief). Reads from the
            // same coach_intents plan_adapt_* signal. "Restore" decodes
            // via the existing coach proposal flow.
            if let intent = adaptationIntent, isWithinLast24h(intent.when_iso) {
                inSheetAdaptationBanner(intent)
            }
            existingPrescriptionAndConditions
            if !isDone && selectedEffort != .rest {
                skipThisRunButton
            }
        }
    }

    private func inSheetAdaptationBanner(_ intent: CoachIntent) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Color(hex: 0xC47812))
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                Text(intent.summary)
                    .font(.body(13, weight: .extraBold))
                    .foregroundStyle(Color(hex: 0x14110D))
                    .fixedSize(horizontal: false, vertical: true)
                Button("Restore", action: restoreAdaptationAction)
                    .font(.body(11, weight: .extraBold)).tracking(0.4)
                    .foregroundStyle(Color(hex: 0xC47812))
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 24).padding(.vertical, 14)
        .background(Color(hex: 0xFFF4DC))
        .overlay(
            Rectangle().fill(Color(hex: 0xEEE7DA)).frame(height: 1),
            alignment: .bottom
        )
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

            pBlock(title: "CONDITIONS & KIT") {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 1), GridItem(.flexible(), spacing: 1)], spacing: 1) {
                    infoCell(key: "Weather", value: conditions.weather)
                    infoCell(key: "Shoe",    value: conditions.shoe)
                    infoCell(key: "Fuel",    value: conditions.fuel)
                    infoCell(key: "Effort",  value: selectedEffort.effortLabel)
                }
                .background(Color(hex: 0xEEE7DA))
                .clipShape(RoundedRectangle(cornerRadius: 16))
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
        return FaffEffort.fromType(d.sub_label ?? d.type)
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

    private var paceStr: String {
        if let phase = displayWorkout?.phases.first, let p = phase.targetPaceSPerMi {
            return formatPace(secondsPerMi: p)
        }
        return "—"
    }

    private func formatPace(secondsPerMi: Int) -> String {
        let m = secondsPerMi / 60
        let s = secondsPerMi % 60
        return String(format: "%d:%02d/mi", m, s)
    }

    private var startButtonTitle: String {
        if skipped { return "Log Recovery" }
        if selectedEffort == .rest { return "Log Recovery" }
        if selectedDayID == todayISO { return "Start \(plainWorkoutName)" }
        return "View \(plainWorkoutName)"
    }

    /// Route the CTA pushes to:
    ///   · today + active workout → live (watchMirror)
    ///   · future planned day → planned detail
    ///   · rest day / past completed → planned detail (or run detail in future)
    private var ctaRoute: FaffRoute {
        if selectedDayID == todayISO && selectedEffort != .rest && !skipped {
            return .watchMirror
        }
        if let day = todaySelectedDay, let runId = day.completedRunId {
            return .runDetail(id: runId)
        }
        // Pass the selected day's ISO so PlannedView fetches that day's
        // workout (not always today's).
        return .planned(date: selectedDayID.isEmpty ? nil : selectedDayID)
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

    /// Optional context line below the date. Composes from the purpose
    /// payload when we have it: "BUILD · 12 weeks to race" or the phase
    /// alone. Null when nothing meaningful · the topbar drops the line
    /// gracefully (no placeholder).
    private var weekContextLabel: String? {
        let phase = (purpose?.phase ?? "").uppercased()
        let weeks = purpose?.weeksToRace
        if !phase.isEmpty, let w = weeks, w > 0 {
            return "\(phase) · \(w) WEEKS TO RACE"
        }
        if !phase.isEmpty { return "\(phase) PHASE" }
        if let w = weeks, w > 0 { return "\(w) WEEKS TO RACE" }
        return nil
    }

    private func isoDateFromDay(_ iso: String) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var c = DateComponents()
        c.year = parts[0]; c.month = parts[1]; c.day = parts[2]
        return Calendar.current.date(from: c)
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

    /// Restore an adapted plan day · taps from the in-sheet adaptation
    /// banner. Wires to the existing /api/coach/proposal flow with
    /// action="decline" on the adapt intent, so the backend can revert
    /// to the original session. If the backend rejects the action shape,
    /// the banner stays read-only and the next refresh resolves state.
    private func restoreAdaptationAction() {
        guard let intent = adaptationIntent else { return }
        Task {
            _ = try? await API.postCoachProposal(
                action: "decline",
                proposal: ["intent_id": intent.id]
            )
            await loadAll()
        }
    }

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
        let weather: String = {
            if let t = self.weather?.tempF { return "\(Int(t.rounded()))°F" }
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
                effort: FaffEffort.fromType(d.sub_label ?? d.type),
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
            if let stravaStat { self.stravaStatus = stravaStat }
            // Purpose · only overwrite when the fetch actually returned a
            // payload; nil from a transient 5xx shouldn't blank a previously
            // loaded coach card. Doctrine: empty-state from a successful nil
            // is honest; empty-after-a-fail looks identical and isn't.
            if let pur, !pur.verdict.isEmpty { self.purpose = pur }
            self.skipped = skip
            self.adaptationIntent = adaptList.first
            self.activeNiggle = activeN
            self.pendingProposals = proposals
            let resolvedToday = planWeek?.today_iso ?? self.plan?.today_iso
            if let today = resolvedToday, selectedDayID.isEmpty { selectedDayID = today }

            // Today redesign (2026-06-01) · readiness-panel stat chips.
            //
            // LAST NIGHT · the panel labels the chip "LAST NIGHT" but the
            // most-granular sleep number we surface today is the readiness
            // 7-night average. Wire it as a stand-in until a per-night
            // sample lands on /api/readiness (or until the iPhone fetches
            // /api/health/state for the last sleep_hours sample directly).
            // The TODO is intentional · placeholder display is more honest
            // than fabricating a single-night number.
            self.lastNightHours = ready?.sleep7Avg
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
