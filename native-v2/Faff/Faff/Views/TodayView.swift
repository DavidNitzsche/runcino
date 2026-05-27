//
//  TodayView.swift
//
//  iPhone TODAY screen — structured workout card + week strip lead;
//  coach prose follows; topic cards (gels, race horizon, etc.) drop
//  below. This is the layout fix for "wall of text on the phone."
//
//  Also pushes today's workout to the watch on every successful refresh
//  (not just app start) so the watch picks up plan edits without the
//  phone being relaunched.
//

import SwiftUI

struct TodayView: View {
    // Initial values come from the last successful response on disk via
    // AppCache. First-ever launch reads nil; every subsequent launch
    // paints real (slightly stale) content the instant the view appears.
    // The .task hook below refreshes from the server and writes new
    // bytes back to the cache for next time.
    @State private var briefing: Briefing? =
        AppCache.read(.todayBriefing, as: Briefing.self)
    @State private var workout: WatchWorkout? =
        AppCache.read(.todayWorkout, as: TodayWorkoutWrapper.self)?.workout
    /// Kept for the rest-day-message fallback (loadAll still pulls the
    /// plan to know if today is a planned rest day). UI no longer shows
    /// the week strip on this surface — Training owns the multi-day
    /// view now.
    @State private var planWeek: PlanWeek? =
        AppCache.read(.planWeek, as: PlanWeek.self)
    @State private var error: String?
    @State private var readiness: ReadinessSnapshot? =
        AppCache.read(.readiness, as: ReadinessSnapshot.self)

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Date label sits under the iOS large title — drops
                    // the redundant "faff" wordmark since the tab bar +
                    // app icon already identify the app.
                    Text(todayLabel())
                        .font(.label(11)).tracking(1.2)
                        .foregroundStyle(Theme.mute)
                        .padding(.horizontal, 24)
                        .padding(.top, 0)

                    // 2026-05-27 restructure: TODAY is now PURE today.
                    // The healthStatusStrip ("HEALTH · IMPORTING / SYNCED 3
                    // runs · 31 vitals") was leaking backend state to the
                    // user — "should just work" instead. The WeekStripView
                    // also moved out of here: David said "TODAY should be
                    // a pure today tab with todays run and coach" — the
                    // multi-day plan view lives on the TRAINING tab now.

                if let error {
                    errorBlock(error)
                }

                // 1) Today's structured workout — leads the scroll.
                if let workout {
                    WorkoutTodayCard(workout: workout)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                } else if let restMessage = restDayMessage {
                    restBlock(restMessage)
                        .transition(.opacity)
                }

                // 2) Coach prose slot — skeleton while loading, snaps in
                //    when the brief arrives. Never blocks the screen.
                CoachSlot(
                    briefing: briefing,
                    surface: "today",
                    askPrompt: briefing.map { askPrompt(for: $0.mode) },
                    onCheckIn: { rating in
                        guard let b = briefing else { return false }
                        do {
                            try await API.checkin(rating: rating.rawValue,
                                                   briefingId: "\(b.surface)|\(b.mode)")
                            Task { await loadAll() }
                            return true
                        } catch {
                            return false
                        }
                    }
                )

                // 3) Topic cards — fueling / race horizon / readiness
                //    detail / gap-fill prompts.
                    if let briefing, !briefing.topics.isEmpty {
                        VStack(spacing: 10) {
                            ForEach(Array(briefing.topics.enumerated()), id: \.offset) { _, topic in
                                TopicRenderer(topic: topic)
                            }
                        }
                        .padding(.horizontal, 24)
                        .transition(.opacity)
                    }
                }
                .padding(.bottom, 40)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: workout?.workoutId)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: briefing?.lead)
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
            // Haptic ping when the run-card lands so the refresh feels alive.
            .sensoryFeedback(.success, trigger: workout?.workoutId)
        }
    }

    // Health status strip removed 2026-05-27: David said "We dont want
    // to see behind the scenes / the backend. It should all just work."
    // HK import still runs silently via FaffApp.scenePhase observer +
    // the loadAll() background task below; user just doesn't see chatter.

    // App bar removed in iPhone-rebuild — replaced by NavigationStack
    // large title + ReadinessRing in the toolbar's topBarTrailing slot.

    // MARK: - Load

    /// Fan out the three calls in parallel so the screen paints fast.
    /// Once the workout JSON is in hand, immediately push it to the watch
    /// so the watch reflects any plan edit without a phone relaunch.
    private func loadAll() async {
        // No global loading flag — each piece renders the instant it
        // lands. CoachSlot shows a skeleton while `briefing` is nil.
        async let bRes = (try? await API.briefing(surface: "today"))
        async let wRes = (try? await API.fetchWatchWorkout())
        async let pRes = (try? await API.fetchPlanWeek())
        async let rRes = (try? await API.fetchReadiness())

        let b = await bRes
        let w = await wRes
        let p = await pRes
        let r = await rRes

        self.briefing = b
        self.workout = w
        self.planWeek = p
        self.readiness = r ?? nil
        self.error = (b == nil && w == nil && p == nil) ? "Couldn't reach the coach. Pull to refresh." : nil

        // Push the freshly-fetched workout to the watch so the watch picks
        // up plan edits without the user having to relaunch the iPhone app.
        Task { await WatchSync.shared.pushTodayToWatch() }

        // Quiet HK workout import — pulls any HKWorkout that hit the phone
        // since the last refresh (e.g. a run done in Apple Watch Workouts
        // app, not Faff). Only runs if Health auth was previously granted;
        // never prompts here. After import lands, /api/ingest/workout busts
        // the briefing cache so the next refresh picks up the new run.
        Task { await HealthKitImporter.shared.importIfConnected(daysBack: 3) }
    }

    // MARK: - Subviews

    private func restBlock(_ msg: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("REST DAY")
                .font(.label(11)).tracking(1.6)
                .foregroundStyle(Theme.learn)
            Text(msg).font(.body(14)).foregroundStyle(Theme.ink.opacity(0.85)).lineSpacing(2)
        }
        .padding(18)
        .background(Theme.learn.opacity(0.06))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.rCard)
                .stroke(Theme.learn.opacity(0.22), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
        .padding(.horizontal, 24)
    }

    /// Today is a rest day if /api/watch/today returned no workout. We
    /// surface the message from that endpoint; if it didn't ship one,
    /// fall back to a sane default.
    private var restDayMessage: String? {
        // workout==nil but planWeek loaded successfully and today is in it
        // and today.type == "rest" → show rest block.
        guard workout == nil else { return nil }
        if let today = planWeek?.days.first(where: { $0.is_today }),
           today.type == "rest" {
            return "No workout on the calendar today. Recover hard — that's the work."
        }
        return nil
    }

    private func todayLabel() -> String {
        let fmt = DateFormatter()
        fmt.dateFormat = "E · MMM d"
        return fmt.string(from: Date()).uppercased()
    }

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
        .padding(.horizontal, 24)
    }
}

// ReadinessChip extracted to Components/ReadinessRing.swift for reuse on
// /health and elsewhere. Use ReadinessRing(score:size:.chip) here.
private typealias ReadinessChip = ReadinessRing
