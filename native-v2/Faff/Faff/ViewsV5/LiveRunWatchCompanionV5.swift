//
//  LiveRunWatchCompanionV5.swift
//  faff.run iPhone · Decision 1 — Apple Watch execution.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS EXISTS
//
//  When a compatible, reachable watch has confirmed today's workout
//  (`RunLobbyRecordingOwner.resolve(...) == .watch`), the watch — not the
//  phone — executes and records the structured session. This screen is what
//  the phone shows instead of `LiveRunOutdoorV5` for that case: companion
//  status only. It never starts `PhoneRunTracker`, never shows Pause/End
//  controls of its own, and never independently persists a completion —
//  the watch's own dual-path posting (`WatchSync`'s relay + the watch's own
//  direct POST, both keyed on the SAME canonical `workoutId`) is what
//  reconciles this session back to the prescription. One recording owner
//  per session, decided once by `LiveRunHostV5` before this view appears,
//  never re-decided here.
//
//  WHAT THIS PORTS FROM THE LEGACY MIRROR, AND WHAT IT FIXES
//
//  The legacy `WatchMirrorView` (Views/RootTabView.swift's dead `-faffLegacy`
//  path) got the shape right — the phone is a passive header, Pause/Lap/End
//  happen on the wrist, Cancel only closes this screen — and that shape is
//  what's reused here. What it got wrong, per the audit this file answers:
//  its "live" dot reflected nothing but the one-shot fetch succeeding, so a
//  watch that went unreachable MID-RUN produced no visible change on the
//  phone at all. This version observes `WatchSync.isReachable` live and
//  says so, because "your watch is out of range" is exactly the moment a
//  runner glancing at their phone needs an honest answer, not a stale dot.
//
import SwiftUI

struct LiveRunWatchCompanionV5: View {
    let plan: LiveRunPlanV5?
    let onDismiss: () -> Void

    @ObservedObject private var watchSync = WatchSync.shared
    /// Elapsed time on THIS screen, purely for "how long has the phone been
    /// waiting" framing — never presented as the run's own duration, which
    /// only the watch's `HKWorkoutSession` actually knows.
    @State private var openedAt = Date()

    var body: some View {
        VStack(spacing: 0) {
            header
            Spacer(minLength: 0)
            standbyBody
            Spacer(minLength: 0)
            footer
        }
        .padding(.horizontal, V5.S.gutter)
        .padding(.top, V5.S.s56)
        .padding(.bottom, V5.S.s32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(V5.surfacePage.ignoresSafeArea())
        .onAppear { openedAt = Date() }
    }

    private var header: some View {
        HStack(spacing: V5.S.s12) {
            Circle()
                .fill(watchSync.isReachable ? V5.signal : V5.attention)
                .frame(width: 8, height: 8)
            Text(watchSync.isReachable ? "Watch connected" : "Watch out of range")
                .font(.faffText(TypeScaleV5.label13, weight: .semibold))
                .foregroundStyle(V5.textPrimary)
            Spacer(minLength: 0)
            FaffButton("Cancel", variant: .ghost, size: .md, full: false, action: onDismiss)
        }
    }

    @ViewBuilder
    private var standbyBody: some View {
        VStack(spacing: V5.S.s16) {
            Image(systemName: "applewatch.radiowaves.left.and.right")
                .font(.system(size: 40, weight: .regular))
                .foregroundStyle(V5.textSecondary)
            if let plan {
                Text(plan.sessionType)
                    .font(.faffDisplay(24))
                    .foregroundStyle(V5.textPrimary)
                if let totalMi = plan.totalMi {
                    Text(Units.formatDistance(miles: totalMi) + " " + Units.distanceLabel())
                        .font(.faffText(TypeScaleV5.body15))
                        .foregroundStyle(V5.textSecondary)
                }
            }
            Text("Standing by")
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textQuiet)
            if !watchSync.isReachable {
                Alert(text: "Your watch isn't reachable right now. If it's already recording, that continues on its own — this screen just can't confirm it until the watch comes back in range.",
                      tone: .attention)
                    .padding(.top, V5.S.s8)
            }
        }
    }

    private var footer: some View {
        VStack(spacing: V5.S.s8) {
            Text("PAUSE · LAP · END ON YOUR WATCH")
                .font(.faffText(TypeScaleV5.label12, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(V5.textQuiet)
            Text("Your watch is recording this run. Closing this screen does not stop it — end the run on your wrist when you're done.")
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textQuiet)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
