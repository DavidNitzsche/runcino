import SwiftUI

/// The slide-up sheet behind the Today "Not running today?" affordance.
/// David's spec (2026-06-26): skip became skip/reschedule. The sheet first
/// asks Skip vs Move; Move opens a day picker; picking a day that already
/// has a run asks to replace it.
///
/// Self-contained so it stays out of TodayView's body. It only renders and
/// calls back — the parent owns the async API calls, dismissal, and reload.
struct DayActionSheet: View {
    struct TargetDay: Identifiable, Equatable {
        let id: String        // ISO date "2026-06-27"
        let weekday: String   // "Saturday"
        let runLabel: String  // "Easy 5 mi" / "Long 13 mi" / "Rest"
        let hasRun: Bool
    }

    /// e.g. "Sunday's long run" — the run being acted on.
    let sourceLabel: String
    /// Skip is a today-only concept; for a future day the sheet is Move-only.
    let canSkip: Bool
    /// Days the run can move to (this week, not the source day, not past).
    let targets: [TargetDay]

    var onSkip: () -> Void
    /// (targetISO, replace) — replace is true when the target already had a run.
    var onMove: (_ toISO: String, _ replace: Bool) -> Void
    var onCancel: () -> Void

    private enum Step: Equatable { case choose, pickDay, confirmReplace(TargetDay) }
    @State private var step: Step = .choose
    @State private var acted = false   // guard against double taps

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                Capsule().fill(Theme.txt.opacity(0.2))
                    .frame(width: 40, height: 4).padding(.top, 12)

                switch step {
                case .choose:            chooseStep
                case .pickDay:           pickDayStep
                case .confirmReplace(let d): replaceStep(d)
                }
            }
        }
        .presentationDetents([.height(detentHeight)])
        .presentationDragIndicator(.hidden)
    }

    private var detentHeight: CGFloat {
        switch step {
        case .choose:         return canSkip ? 320 : 250
        case .pickDay:        return min(520, 200 + CGFloat(targets.count) * 58)
        case .confirmReplace: return 300
        }
    }

    // MARK: Step 1 — Skip vs Move

    private var chooseStep: some View {
        VStack(spacing: 0) {
            Text(canSkip ? "Today's run" : titleCase(sourceLabel))
                .font(.display(22, weight: .bold))
                .foregroundStyle(Theme.txt)
                .padding(.top, 26)
            Text(canSkip
                 ? "Skip it, or move it to another day."
                 : "Move it to another day this week.")
                .font(.body(14))
                .foregroundStyle(Theme.txt.opacity(0.58))
                .multilineTextAlignment(.center)
                .padding(.top, 8).padding(.horizontal, 30)

            Spacer(minLength: 0)

            VStack(spacing: 10) {
                primaryButton(title: "Move to another day", tint: Theme.dist) {
                    withAnimation(Theme.Motion.smooth) { step = .pickDay }
                }
                if canSkip {
                    primaryButton(title: "Skip today's run", tint: Color(hex: 0xFC4D64)) {
                        guard !acted else { return }
                        acted = true
                        onSkip()
                    }
                }
            }
            .padding(.horizontal, Theme.Space.pageH)

            cancelButton
        }
    }

    // MARK: Step 2 — pick a target day

    private var pickDayStep: some View {
        VStack(spacing: 0) {
            Text("Move to")
                .font(.display(22, weight: .bold))
                .foregroundStyle(Theme.txt)
                .padding(.top, 24)
            Text(titleCase(sourceLabel))
                .font(.body(13, weight: .semibold))
                .foregroundStyle(Theme.dist)
                .padding(.top, 4)

            ScrollView {
                VStack(spacing: 8) {
                    ForEach(targets) { day in
                        Button {
                            guard !acted else { return }
                            if day.hasRun {
                                withAnimation(Theme.Motion.smooth) { step = .confirmReplace(day) }
                            } else {
                                acted = true
                                onMove(day.id, false)
                            }
                        } label: {
                            HStack {
                                Text(day.weekday)
                                    .font(.body(15, weight: .bold))
                                    .foregroundStyle(Theme.txt)
                                Spacer()
                                Text(day.runLabel)
                                    .font(.body(13, weight: .medium))
                                    .foregroundStyle(day.hasRun ? Theme.txt.opacity(0.65) : Theme.txt.opacity(0.38))
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(Theme.txt.opacity(0.3))
                            }
                            .padding(.horizontal, 16).padding(.vertical, 14)
                            .background(Color.white.opacity(0.05),
                                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(Theme.line, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, Theme.Space.pageH)
                .padding(.top, 18)
            }

            cancelButton
        }
    }

    // MARK: Step 3 — confirm replace

    private func replaceStep(_ d: TargetDay) -> some View {
        VStack(spacing: 0) {
            Text("Replace \(d.weekday)'s run?")
                .font(.display(21, weight: .bold))
                .foregroundStyle(Theme.txt)
                .multilineTextAlignment(.center)
                .padding(.top, 26).padding(.horizontal, 24)
            Text("\(d.runLabel) is already on \(d.weekday). Moving here replaces it.")
                .font(.body(14))
                .foregroundStyle(Theme.txt.opacity(0.58))
                .multilineTextAlignment(.center)
                .padding(.top, 8).padding(.horizontal, 30)

            Spacer(minLength: 0)

            VStack(spacing: 10) {
                primaryButton(title: "Replace it", tint: Color(hex: 0xFC4D64)) {
                    guard !acted else { return }
                    acted = true
                    onMove(d.id, true)
                }
                Button { withAnimation(Theme.Motion.smooth) { step = .pickDay } } label: {
                    Text("Back")
                        .font(.body(14, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.6))
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, Theme.Space.pageH)
            .padding(.bottom, 10)
        }
    }

    // MARK: shared bits

    private func primaryButton(title: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.body(15, weight: .extraBold))
                .foregroundStyle(tint)
                .frame(maxWidth: .infinity).padding(.vertical, 15)
                .background(tint.opacity(0.14),
                            in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(tint.opacity(0.3), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var cancelButton: some View {
        Button { onCancel() } label: {
            Text("Cancel")
                .font(.body(14, weight: .bold))
                .foregroundStyle(Theme.txt.opacity(0.6))
                .frame(maxWidth: .infinity).padding(.vertical, 14)
        }
        .buttonStyle(.plain)
        .padding(.bottom, 10)
    }

    /// "Sunday's long run" → "Sunday's long run" (already cased); used where we
    /// want the source label to read as a sentence start.
    private func titleCase(_ s: String) -> String { s }
}
