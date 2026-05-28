//
//  TodayView.swift
//
//  iPhone TODAY surface — Faff v3 layout (2026-05-28 cutover).
//
//  Mirrors the web /today design:
//    1. PosterCard — gradient hero with state-keyed verb + stat trio
//    2. SiblingCard — dark dashboard card with body tiles (sleep/RHR/HRV/load)
//    3. WeekStripV3 — 7-day strip with accent bars + 4-char vocab
//    4. CoachSlot — coach prose paragraph (kept · preserves working coach voice)
//
//  Existing data plumbing (.task loadAll, AppCache reads, briefing →
//  CoachSlot wiring) is unchanged. Only the visual shell swaps.
//

import SwiftUI

struct TodayView: View {
    // Initial values come from the last successful response on disk via
    // AppCache. First-ever launch reads nil; every subsequent launch
    // paints real (slightly stale) content the instant the view appears.
    @State private var briefing: Briefing? =
        AppCache.read(.todayBriefing, as: Briefing.self)
    @State private var workout: WatchWorkout? =
        AppCache.read(.todayWorkout, as: TodayWorkoutWrapper.self)?.workout
    @State private var planWeek: PlanWeek? =
        AppCache.read(.planWeek, as: PlanWeek.self)
    @State private var error: String?
    @State private var readiness: ReadinessSnapshot? =
        AppCache.read(.readiness, as: ReadinessSnapshot.self)
    // P-SKIP (Phase 12 · 2026-05-28). Mirror of the web "is today
    // skipped?" signal. Hydrated by GET /api/today/skip on every
    // loadAll() — see API.fetchTodaySkipped + the SKIP/UNDO SKIP
    // chip overlay below.
    @State private var todaySkipped: Bool = false
    @State private var skipBusy: Bool = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let error {
                        errorBlock(error)
                    }

                    let state = FaffAdapter.resolveDayState(
                        plan: planWeek,
                        briefing: briefing,
                        workout: workout,
                        skipped: todaySkipped
                    )

                    // 1. Poster · gradient hero
                    //
                    // P-SKIP (Phase 12) · the SKIP / UNDO SKIP chip is
                    // rendered as a topTrailing overlay on the PosterCard.
                    // PosterCard stays pure (no callbacks) — TodayView owns
                    // the network call + the @State + the haptic. Mirrors
                    // web Poster.tsx:76-97 (eyebrow row · trailing button).
                    PosterCard(payload: FaffAdapter.buildPoster(
                        state: state,
                        plan: planWeek,
                        readiness: readiness,
                        workout: workout
                    ))
                    .overlay(alignment: .topTrailing) {
                        if showSkipChip(for: state) {
                            skipChip(currentState: state)
                                .padding(.top, 16)
                                .padding(.trailing, 18)
                        }
                    }

                    // 2. Sibling · body dashboard
                    SiblingCard(payload: FaffAdapter.buildSibling(
                        state: state,
                        readiness: readiness,
                        plan: planWeek
                    ))

                    // 3. WeekStrip · 7-day arc
                    WeekStripV3(
                        payload: FaffAdapter.buildWeekStrip(plan: planWeek),
                        phaseLabel: nil
                    )

                    // 4. Coach prose slot — skeleton while loading, snaps
                    //    in when the brief arrives. Never blocks the screen.
                    CoachSlot(
                        briefing: briefing,
                        surface: "today",
                        askPrompt: briefing.map { askPrompt(for: $0.mode) },
                        onCheckIn: { rating in
                            guard let b = briefing else { return false }
                            do {
                                try await API.checkin(
                                    rating: rating.rawValue,
                                    briefingId: "\(b.surface)|\(b.mode)"
                                )
                                Task { await loadAll() }
                                return true
                            } catch {
                                return false
                            }
                        }
                    )
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 40)
                .animation(.spring(response: 0.45, dampingFraction: 0.85),
                           value: workout?.workoutId)
                .animation(.spring(response: 0.45, dampingFraction: 0.85),
                           value: briefing?.lead)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Today")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                // Readiness ring lives in the toolbar — native iOS pattern
                // for "always visible status" + frees up vertical space
                // for the actual run content.
                ToolbarItem(placement: .topBarTrailing) {
                    ReadinessRing(score: readiness?.score)
                }
            }
            .task { await loadAll() }
            .refreshable { await loadAll() }
            // Haptic ping when content lands so the refresh feels alive.
            .sensoryFeedback(.success, trigger: workout?.workoutId)
            // P-SKIP (Phase 12) · second haptic on skip toggle. Mirrors
            // the web router.refresh() vibe — the tap feels alive.
            .sensoryFeedback(.success, trigger: todaySkipped)
        }
    }

    // MARK: - Load
    //
    // Fan out the four calls in parallel so the screen paints fast.
    // Once the workout JSON is in hand, immediately push it to the watch
    // so the watch reflects any plan edit without a phone relaunch.
    private func loadAll() async {
        async let bRes = (try? await API.briefing(surface: "today"))
        async let wRes = (try? await API.fetchWatchWorkout())
        async let pRes = (try? await API.fetchPlanWeek())
        async let rRes = (try? await API.fetchReadiness())
        // P-SKIP (Phase 12) · fan out the skip status read alongside the
        // other 4 calls so the SKIP / UNDO SKIP surface is correct on
        // every refresh.
        async let sRes = (try? await API.fetchTodaySkipped())

        let b = await bRes
        let w = await wRes
        let p = await pRes
        let r = await rRes
        let s = await sRes

        self.briefing = b
        self.workout = w
        self.planWeek = p
        self.readiness = r ?? nil
        self.todaySkipped = s ?? false
        self.error = (b == nil && w == nil && p == nil)
            ? "Couldn't reach the coach. Pull to refresh."
            : nil

        // Push the freshly-fetched workout to the watch so the watch picks
        // up plan edits without the user having to relaunch the iPhone app.
        Task { await WatchSync.shared.pushTodayToWatch() }

        // Quiet HK workout import — pulls any HKWorkout that hit the phone
        // since the last refresh (e.g. a run done in Apple Watch Workouts
        // app, not Faff). Only runs if Health auth was previously granted;
        // never prompts here.
        Task { await HealthKitImporter.shared.importIfConnected(daysBack: 3) }
    }

    // MARK: - Skip chip (P-SKIP · Phase 12 · 2026-05-28)
    //
    // Renders only when there is a workout to skip (easy / quality / long)
    // OR when the runner already skipped (so they can UNDO). Mirrors web
    // Poster.tsx:22 — `SKIP_ELIGIBLE_STATES = { 'easy','quality','long' }`
    // plus the separate `state === 'skipped'` undo branch.
    private func showSkipChip(for state: FaffDayState) -> Bool {
        switch state {
        case .easy, .quality, .long, .skipped: return true
        default: return false
        }
    }

    @ViewBuilder
    private func skipChip(currentState: FaffDayState) -> some View {
        let isSkipped = currentState == .skipped
        let chipText = skipBusy ? "…" : (isSkipped ? "UNDO SKIP" : "SKIP TODAY")
        Button {
            guard !skipBusy else { return }
            Task { await toggleSkip(currentlySkipped: isSkipped) }
        } label: {
            Text(chipText)
                .font(.body(9, weight: .bold))
                .tracking(1.4)
                .foregroundStyle(Color.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.white.opacity(0.15))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(skipBusy)
        .accessibilityLabel(isSkipped ? "Undo skip" : "Skip today's workout")
    }

    private func toggleSkip(currentlySkipped: Bool) async {
        skipBusy = true
        defer { skipBusy = false }
        do {
            if currentlySkipped {
                try await API.deleteSkipToday()
                self.todaySkipped = false
            } else {
                try await API.postSkipToday()
                self.todaySkipped = true
            }
        } catch {
            // Network blip → silently re-fetch the truth from the server.
            // No alert; the chip will reflect the actual state after the
            // refresh below.
        }
        await loadAll()
    }

    // MARK: - Subviews

    private func askPrompt(for mode: String) -> String {
        switch mode {
        case "post-run": return "Let me know how it felt."
        case "pre-run":  return "How are the legs?"
        case "rest-day": return "Anything sore?"
        case "race-day": return "Ready?"
        default:         return "Let me know."
        }
    }

    private func errorBlock(_ msg: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("BRIEFING ERROR").font(.label(9)).tracking(1.6)
                .foregroundStyle(Theme.over)
            Text(msg).font(.body(12)).foregroundStyle(Theme.ink.opacity(0.85)).lineSpacing(2)
        }
        .padding(16)
        .background(Theme.over.opacity(0.04))
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.over.opacity(0.22), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
    }
}

// ReadinessChip extracted to Components/ReadinessRing.swift for reuse on
// /health and elsewhere. Use ReadinessRing(score:size:.chip) here.
private typealias ReadinessChip = ReadinessRing
