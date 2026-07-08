//
//  StrengthSessionSheet.swift
//  The strength prescription, finally on screen (audit P2-50 · 2026-07-06).
//
//  The recommender has generated full session content (2 movements ×
//  3 sets + finisher, 20 minutes, Research/07 §runner maintenance dose)
//  since Phase 2, but the Today chip only ever said "Strength
//  recommended" — no what, no intensity, no tap. The documented failure
//  mode (17 skips in 28 days while the chip stayed wallpaper) was the
//  reason the content was written. This sheet renders the pick that
//  training-state now carries per week (`strengthPicks`):
//    · session title + duration
//    · intensity tag (heavy / maintenance / mobility · Rule 14)
//    · timing (pm = after the day's run, 4-6h gap · hard-with-hard)
//    · the exercises with sets × reps
//    · one-tap log when the pick is for today (POST /api/strength via
//      the existing API.postStrength helper)
//
//  Opened from TodayView's strength chip via .sheet(item:).
//

import SwiftUI

struct StrengthSessionSheet: View {
    @Environment(\.dismiss) private var dismiss

    let pick: StrengthPick
    /// Log CTA renders only for today's pick · logging a future date would
    /// poison the weekly count and the 28-day habit window.
    var isToday: Bool = false
    var onLogged: () -> Void = {}

    @State private var logging: Bool = false
    @State private var logError: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    tagRow
                    exerciseList
                    Text(coachLine)
                        .font(.body(13))
                        .foregroundStyle(Theme.txt.opacity(0.72))
                        .fixedSize(horizontal: false, vertical: true)
                    if let e = logError {
                        Text(e)
                            .font(.body(12, weight: .medium))
                            .foregroundStyle(Theme.over)
                    }
                    if isToday {
                        Button(action: logIt) {
                            Text(logging ? "Saving…" : "Log it done")
                                .font(.body(15, weight: .extraBold))
                                .foregroundStyle(logging ? Theme.mute : Theme.bg)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(logging ? Color.white.opacity(0.12) : Theme.txt,
                                            in: RoundedRectangle(cornerRadius: 14))
                        }
                        .buttonStyle(.plain)
                        .disabled(logging)
                    } else {
                        Text("Log it here on the day.")
                            .font(.body(12, weight: .medium))
                            .foregroundStyle(Theme.mute)
                    }
                }
                .padding(24)
            }
        }
        .background(Theme.Glass.strong)
        .ignoresSafeArea(edges: .bottom)
    }

    // MARK: - Pieces

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Capsule().fill(Color.white.opacity(0.18)).frame(width: 40, height: 4)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 8)
            SpecLabel(text: "STRENGTH · \(pick.session?.durationMin ?? 20) MIN",
                      size: 10, tracking: 2, color: Theme.txt.opacity(0.6))
                .padding(.top, 10)
            Text(sessionTitle)
                .font(.display(22, weight: .bold))
                .foregroundStyle(Theme.txt)
        }
        .padding(.horizontal, 24)
    }

    private var tagRow: some View {
        HStack(spacing: 8) {
            tag(intensityLabel, color: intensityColor)
            if pick.timing == "pm" {
                tag("PM · AFTER THE RUN", color: Theme.dist)
            }
        }
    }

    private func tag(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.label(10))
            .tracking(1.2)
            .foregroundStyle(color)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(color.opacity(0.14), in: Capsule())
            .overlay(Capsule().stroke(color.opacity(0.35), lineWidth: 1))
    }

    private var exerciseList: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(exercises.enumerated()), id: \.offset) { i, ex in
                HStack(alignment: .firstTextBaseline) {
                    Text(ex.name)
                        .font(.body(14, weight: .semibold))
                        .foregroundStyle(Theme.txt)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 12)
                    Text(ex.sets > 0 ? "\(ex.sets) × \(ex.reps)" : ex.reps)
                        .font(.body(13, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.75))
                        .layoutPriority(1)
                }
                .padding(.vertical, 12)
                if i < exercises.count - 1 {
                    Rectangle().fill(Theme.Glass.line).frame(height: 1)
                }
            }
        }
        .padding(.horizontal, 16)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rCard, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard, style: .continuous)
            .stroke(Theme.Glass.line, lineWidth: 1))
    }

    // MARK: - Derivations

    private var exercises: [StrengthPickExercise] { pick.session?.exercises ?? [] }

    private var sessionTitle: String {
        if let t = pick.session?.title, !t.isEmpty { return t }
        return "Strength session"
    }

    private var intensityLabel: String {
        switch pick.intensity {
        case "heavy":       return "HEAVY"
        case "mobility":    return "MOBILITY"
        default:            return "MAINTENANCE"
        }
    }

    private var intensityColor: Color {
        switch pick.intensity {
        case "heavy":    return Theme.over
        case "mobility": return Theme.Accent.mintReady
        default:         return Theme.dist
        }
    }

    /// One coach line · intensity first, timing folded in. Short, direct,
    /// per the brief's tone section.
    private var coachLine: String {
        let timing = pick.timing == "pm"
            ? " Do it after the run, 4 to 6 hours later."
            : ""
        switch pick.intensity {
        case "heavy":
            return "Heavy day. Low reps, real load, full rest between sets." + timing
        case "mobility":
            return "No load this close to race stress. Range and control, nothing more." + timing
        default:
            return "Maintenance dose. Smooth reps, stop two short of failure." + timing
        }
    }

    /// session_type string for /api/strength · matches the free-string
    /// convention LogNonRunSheet uses (lowercased descriptors).
    private var sessionType: String {
        switch pick.intensity {
        case "heavy":    return "lower"
        case "mobility": return "mobility"
        default:         return "full body"
        }
    }

    private func logIt() {
        logging = true
        logError = nil
        Task {
            do {
                _ = try await API.postStrength(type: sessionType,
                                               durationMin: pick.session?.durationMin ?? 20)
                await MainActor.run {
                    logging = false
                    onLogged()
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    logging = false
                    logError = "Couldn't save. Check connection and try again."
                }
            }
        }
    }
}
