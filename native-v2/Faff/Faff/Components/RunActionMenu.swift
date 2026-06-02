//
//  RunActionMenu.swift   (2026-06-02 round 33 · design pkg runner_menu)
//
//  Action sheet anchored above the center RUN tab. Tap the RUN tab in
//  RootTabView's custom tab bar to toggle this menu. Tap the scrim or
//  any action to dismiss + fire the action.
//
//  Sections (top → bottom):
//    1. START A RUN · eyebrow + 2 mode buttons (Outdoor / Treadmill).
//       Outdoor = white-fill primary · Treadmill = outline secondary.
//    2. Divider line
//    3. Log a niggle or sick day · presents SymptomSheet
//    4. Log a non-run session     · presents LogNonRunSheet
//
//  Animation: fade + rise (translateY 14pt + scale 0.97 → 0). Spring
//  easing matches the design's cubic-bezier(.32, .72, 0, 1).
//
//  Reference: /Users/david/Downloads/design_handoff_runner_menu/
//             README.md + Runner Menu.html · 2026-06-02.
//

import SwiftUI

struct RunActionMenu: View {
    /// Drives the menu's visible state. Parent toggles this on Run-tab
    /// taps + on scrim/action dismissal.
    @Binding var isOpen: Bool
    /// Accent color · current run's effort tint, lights the toast dot
    /// and the dock fill in the parent. Defaults to the design's orange.
    var accent: Color = Color(hex: 0xEE6038)
    /// Tap handlers for the four action rows. Parent wires these to
    /// route pushes (Outdoor → WatchMirror, Treadmill → TreadmillView)
    /// or sheet presentations (niggle → SymptomSheet, non-run → LogNonRunSheet).
    let onOutdoor: () -> Void
    let onTreadmill: () -> Void
    let onNiggle: () -> Void
    let onNonRun: () -> Void

    var body: some View {
        // Outer ZStack houses scrim + menu so they share parent's
        // bounds. Parent positions us as a full-screen overlay.
        ZStack(alignment: .bottom) {
            // Tap-to-dismiss scrim · sits below the tab bar so the bar
            // stays bright while content dims. Parent enforces z-order
            // by stacking the tab bar OVER this view.
            Color.black.opacity(isOpen ? 0.32 : 0)
                .ignoresSafeArea()
                .onTapGesture { dismiss() }
                .animation(.easeOut(duration: 0.22), value: isOpen)
                .allowsHitTesting(isOpen)

            menuContent
                .padding(.horizontal, 14)
                // 88pt = tab bar pill height (62) + bottom-edge inset (14)
                // + 12pt of breathing room. Per design spec.
                .padding(.bottom, 88)
                .opacity(isOpen ? 1 : 0)
                .scaleEffect(isOpen ? 1 : 0.97, anchor: .bottom)
                .offset(y: isOpen ? 0 : 14)
                .animation(.spring(response: 0.24, dampingFraction: 0.85), value: isOpen)
                .allowsHitTesting(isOpen)
        }
    }

    // MARK: - Menu card

    private var menuContent: some View {
        VStack(spacing: 0) {
            startSection
            divider
            actionRow(
                icon: "waveform.path.ecg",
                label: "Log a niggle or sick day",
                onTap: { fire(onNiggle) }
            )
            actionRow(
                icon: "dumbbell.fill",
                label: "Log a non-run session",
                onTap: { fire(onNonRun) }
            )
        }
        .padding(9)
        .background(
            // Dark glass · matches the design's rgba(26,33,52,.9) +
            // backdrop-filter blur. SwiftUI's .regularMaterial under a
            // tint approximates the same dim translucency.
            ZStack {
                Color(hex: 0x1A2134).opacity(0.92)
                Color.clear.background(.ultraThinMaterial)
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(Color.white.opacity(0.13), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.66), radius: 32, y: -16)
    }

    // MARK: - Start-a-run section

    private var startSection: some View {
        VStack(alignment: .leading, spacing: 11) {
            SpecLabel(
                text: "START A RUN",
                size: 10, tracking: 1.3,
                color: Color.white.opacity(0.5)
            )
            HStack(spacing: 8) {
                modeButton(
                    label: "Outdoor",
                    icon: "figure.run",
                    isPrimary: true,
                    onTap: { fire(onOutdoor) }
                )
                modeButton(
                    label: "Treadmill",
                    icon: "figure.run.treadmill",
                    isPrimary: false,
                    onTap: { fire(onTreadmill) }
                )
            }
        }
        .padding(.horizontal, 12).padding(.top, 11).padding(.bottom, 13)
    }

    private func modeButton(label: String, icon: String, isPrimary: Bool, onTap: @escaping () -> Void) -> some View {
        Button(action: onTap) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .bold))
                Text(label)
                    .font(.body(14.5, weight: .extraBold))
                    .tracking(-0.2)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .foregroundStyle(isPrimary ? Color(hex: 0x16203A) : .white)
            .background(
                isPrimary
                    ? Color.white
                    : Color.white.opacity(0.10),
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(
                        isPrimary ? Color.clear : Color.white.opacity(0.32),
                        lineWidth: 1.5
                    )
            )
        }
        .buttonStyle(PressDownButtonStyle())
    }

    // MARK: - Divider

    private var divider: some View {
        Rectangle()
            .fill(Color.white.opacity(0.10))
            .frame(height: 1)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
    }

    // MARK: - Action row

    private func actionRow(icon: String, label: String, onTap: @escaping () -> Void) -> some View {
        Button(action: onTap) {
            HStack(spacing: 13) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.62))
                    .frame(width: 19, height: 19)
                Text(label)
                    .font(.body(15, weight: .semibold))
                    .foregroundStyle(Color(hex: 0xEEF1F6))
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 13).padding(.vertical, 13)
            .background(Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(RowHoverButtonStyle())
    }

    // MARK: - Helpers

    private func fire(_ action: @escaping () -> Void) {
        // Dismiss first, then fire the action on the next runloop tick
        // so the menu animates out cleanly before the destination renders.
        dismiss()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            action()
        }
    }

    private func dismiss() {
        isOpen = false
    }
}

// MARK: - Button styles

/// Mode buttons get a tiny scale-down on press (design: scale .97).
private struct PressDownButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.11), value: configuration.isPressed)
    }
}

/// Action rows get a brief white-on-press highlight (design: hover/
/// active backgrounds).
private struct RowHoverButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                configuration.isPressed
                    ? Color.white.opacity(0.11)
                    : Color.clear,
                in: RoundedRectangle(cornerRadius: 13, style: .continuous)
            )
            .animation(.easeOut(duration: 0.14), value: configuration.isPressed)
    }
}
