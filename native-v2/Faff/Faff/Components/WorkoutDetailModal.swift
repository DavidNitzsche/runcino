//
//  WorkoutDetailModal.swift
//
//  Sheet presented when the runner taps any day tile in WeekStripView.
//  Fetches /api/watch/today?date=YYYY-MM-DD and renders the structured
//  workout using WorkoutTodayCard. Rest days + days outside the plan
//  show a short message instead.
//

import SwiftUI

struct WorkoutDetailModal: View {
    let date: String

    @Environment(\.dismiss) private var dismiss
    @State private var workout: WatchWorkout?
    @State private var message: String?
    @State private var loading = true

    var body: some View {
        ZStack(alignment: .topTrailing) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    headerBlock
                    if loading {
                        HStack { Spacer(); ProgressView().tint(Theme.green); Spacer() }
                            .padding(40)
                    } else if let workout {
                        WorkoutTodayCard(workout: workout)
                            .padding(.horizontal, -24)
                            // ↑ WorkoutTodayCard pads horizontal 24 itself;
                            // we counter so it can paint to the modal edge.
                    } else if let message {
                        Text(message)
                            .font(.body(14))
                            .foregroundStyle(Theme.ink.opacity(0.78))
                            .padding(.horizontal, 24)
                    }
                }
                .padding(.top, 20)
                .padding(.bottom, 40)
            }

            Button(action: { dismiss() }) {
                ZStack {
                    Circle().fill(Theme.card2).frame(width: 36, height: 36)
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Theme.ink)
                }
            }
            .padding(.top, 16).padding(.trailing, 16)
        }
        .background(Theme.bg.ignoresSafeArea())
        .task { await load() }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private var headerBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(formatDate(date))
                .font(.body(11, weight: .bold))
                .tracking(1.6)
                .foregroundStyle(Theme.mute)
            Text(headlineText)
                .font(.display(28))
                .tracking(0.6)
                .foregroundStyle(Theme.ink)
        }
        .padding(.horizontal, 24)
    }

    private var headlineText: String {
        if let w = workout { return w.name.uppercased() }
        if message != nil { return "REST DAY" }
        return "WORKOUT"
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            if let w = try await API.fetchWatchWorkout(date: date) {
                self.workout = w
                self.message = nil
            } else {
                self.workout = nil
                self.message = "Rest day — recover hard."
            }
        } catch {
            self.workout = nil
            self.message = "Couldn't load this day. \(error.localizedDescription)"
        }
    }

    private func formatDate(_ iso: String) -> String {
        let inFmt = DateFormatter()
        inFmt.dateFormat = "yyyy-MM-dd"
        guard let d = inFmt.date(from: iso) else { return iso }
        let outFmt = DateFormatter()
        outFmt.dateFormat = "EEEE · MMM d"
        return outFmt.string(from: d).uppercased()
    }
}
