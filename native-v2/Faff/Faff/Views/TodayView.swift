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
    @State private var briefing: Briefing?
    @State private var workout: WatchWorkout?
    @State private var planWeek: PlanWeek?
    @State private var error: String?
    /// Observable HK importer — surfaces auth status + last sync result.
    /// Without this, a silent HK failure (no permission, empty result,
    /// network error) would be invisible. Visible status = debuggable.
    @StateObject private var hk = HealthKitImporter.shared
    @State private var readiness: ReadinessSnapshot?

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

                    // HK importer status strip — only shows when not idle.
                    // Lets David see auth state + sync results in one glance
                    // instead of having to dig into the Health app or wait
                    // for runs to appear in /log.
                    healthStatusStrip

                    // No page-blocking spinner. Each section renders the
                // instant its data lands; until then it shows nothing
                // (or a matched-shape skeleton for the coach slot).
                // Inspired by web /today's BriefingLoader pattern.

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

                // 2) Week strip — tap any tile to preview that day.
                if let week = planWeek, !week.days.isEmpty {
                    WeekStripView(week: week)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }

                // 3) Coach prose slot — skeleton while loading, snaps in
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

                // 4) Topic cards — fueling / race horizon / readiness
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
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: planWeek?.days.count)
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

    // MARK: - Health status strip
    //
    // Shows the HK importer's current state so silent failures (no auth,
    // empty pull, network error) are visible. Tap to force a re-sync.

    @ViewBuilder
    private var healthStatusStrip: some View {
        if hk.status != .idle {
            let (label, color) = healthStatusLabel
            HStack(spacing: 10) {
                Circle().fill(color).frame(width: 7, height: 7)
                Text(label)
                    .font(.body(11, weight: .semibold))
                    .tracking(0.8)
                    .foregroundStyle(color)
                Spacer()
                Button {
                    Task { await hk.importIfConnected(daysBack: 7) }
                } label: {
                    Text("SYNC")
                        .font(.label(10)).tracking(1.2)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Theme.ink.opacity(0.06))
                        .clipShape(Capsule())
                        .foregroundStyle(Theme.mute)
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, -4)
        }
    }

    private var healthStatusLabel: (String, Color) {
        switch hk.status {
        case .idle:       return ("HEALTH · IDLE",        Theme.mute)
        case .requesting: return ("HEALTH · ASKING",      Theme.goal)
        case .importing:  return ("HEALTH · IMPORTING",   Theme.dist)
        case .done:       return ("HEALTH · \(hk.lastMessage ?? "SYNCED")", Theme.green)
        case .error:      return ("HEALTH · \(hk.lastMessage ?? "ERROR")",  Theme.over)
        }
    }

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
