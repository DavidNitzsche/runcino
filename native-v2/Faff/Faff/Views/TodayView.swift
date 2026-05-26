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
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                appBar

                if loading {
                    HStack { Spacer(); ProgressView().tint(Theme.green); Spacer() }
                        .padding(40)
                } else if let error {
                    errorBlock(error)
                } else {
                    // 1) Today's structured workout — the thing you're about
                    //    to do. Leads the scroll so it's not buried in prose.
                    if let workout {
                        WorkoutTodayCard(workout: workout)
                    } else if let restMessage = restDayMessage {
                        restBlock(restMessage)
                    }

                    // 2) Week strip — tap any tile to preview that day.
                    if let week = planWeek, !week.days.isEmpty {
                        WeekStripView(week: week)
                    }

                    // 3) Coach prose — shorter on iOS via surface=today_ios,
                    //    drops to second slot now.
                    if let briefing {
                        CoachBlock(
                            lead: briefing.lead,
                            voice: briefing.voice,
                            briefingId: "\(briefing.surface)|\(briefing.mode)",
                            askPrompt: askPrompt(for: briefing.mode),
                            onCheckIn: { rating in
                                do {
                                    try await API.checkin(rating: rating.rawValue,
                                                           briefingId: "\(briefing.surface)|\(briefing.mode)")
                                    Task { await loadAll() }
                                    return true
                                } catch {
                                    return false
                                }
                            }
                        )

                        // 4) Topic cards — fueling / race horizon / readiness
                        //    detail / gap-fill prompts.
                        VStack(spacing: 10) {
                            ForEach(Array(briefing.topics.enumerated()), id: \.offset) { _, topic in
                                TopicRenderer(topic: topic)
                            }
                        }
                        .padding(.horizontal, 24)
                    }
                }
            }
            .padding(.bottom, 40)
        }
        .background(Theme.bg.ignoresSafeArea())
        .task { await loadAll() }
        .refreshable { await loadAll() }
    }

    // MARK: - App bar

    private var appBar: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("faff").font(.display(26)).tracking(1.2).foregroundStyle(Theme.ink)
            Text(todayLabel()).font(.body(11, weight: .bold)).tracking(1.2)
                .foregroundStyle(Theme.mute)
            Spacer()
            // Readiness ring — wired with real score when /api/readiness ships.
            ReadinessChip(value: 88)
        }
        .padding(.horizontal, 24).padding(.top, 8)
    }

    // MARK: - Load

    /// Fan out the three calls in parallel so the screen paints fast.
    /// Once the workout JSON is in hand, immediately push it to the watch
    /// so the watch reflects any plan edit without a phone relaunch.
    private func loadAll() async {
        loading = true
        defer { loading = false }
        async let bRes = (try? await API.briefing(surface: "today"))
        async let wRes = (try? await API.fetchWatchWorkout())
        async let pRes = (try? await API.fetchPlanWeek())

        let b = await bRes
        let w = await wRes
        let p = await pRes

        self.briefing = b
        self.workout = w
        self.planWeek = p
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
                .font(.body(11, weight: .bold)).tracking(1.6)
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
            Text("BRIEFING ERROR").font(.body(9, weight: .bold)).tracking(1.6)
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

private struct ReadinessChip: View {
    let value: Int
    var body: some View {
        ZStack {
            Circle().stroke(Color.white.opacity(0.08), lineWidth: 3)
            Circle()
                .trim(from: 0, to: CGFloat(value) / 100)
                .stroke(Theme.green, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(value)").font(.display(16)).foregroundStyle(Theme.green)
        }
        .frame(width: 44, height: 44)
    }
}
