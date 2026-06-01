//
//  DragSheet.swift
//  Drag-up sheet (peek → expanded) used on Today, Activity, Health.
//
//  Gesture model (2026-05-31 rewrite · prior fix was 2026-05-30):
//   The 2026-05-30 attempt put the pan only on the small grab strip
//   so the body's ScrollView wouldn't fight it. That solved the body
//   conflict but introduced three new complaints:
//
//     1. "Hard to slide up naturally" · when peeked, the user can SEE
//        body content but dragging on it does nothing (gesture is only
//        in the ~80pt header strip up top).
//     2. "Glitchy" · @State `dragStart` is captured once per gesture;
//        any concurrent progress mutation (animations, hydration)
//        breaks the math mid-drag.
//     3. "Weird to get it back down" · when expanded, only the tiny
//        grab strip closes the sheet · the body is one big drag-eater.
//
//  This rewrite:
//   · Pan gesture lives on the WHOLE sheet (simultaneousGesture)
//   · `scrollDisabled(progress > 0.5)` locks the inner ScrollView
//     while peeked, so body drags bubble up to the sheet pan cleanly.
//   · When expanded, the gesture only engages if the drag STARTS in
//     the grab band (top ~80pt) · the body keeps full scroll control.
//   · Tap on the grab handle toggles peek ↔ expanded.
//   · Velocity-priority snap · a meaningful flick beats the position
//     threshold (|v| > 120pt-projected → snap that direction).
//   · Snappier spring (response 0.36, dampingFraction 0.84) · feels
//     like a native sheet, not a slow-moving panel.
//   · `dragStart` is replaced with a per-drag start snapshot read
//     fresh from `progress` on first onChanged event, immune to
//     concurrent mutations.
//

import SwiftUI

struct DragSheet<Header: View, Body: View>: View {
    /// Distance the sheet rests below the screen top when collapsed (peek height).
    let collapsedFromTop: CGFloat
    /// 0 = fully expanded (rests at top), 1 = fully collapsed (rests at peek).
    @Binding var progress: Double
    @ViewBuilder var header: () -> Header
    @ViewBuilder var content: () -> Body

    /// Top-edge band (in points) where a drag is allowed to engage even
    /// when the sheet is fully expanded. Matches the visual grab strip
    /// (handle + header) so dragging down from where the runner expects
    /// the grab to be always closes the sheet.
    private let grabBandHeight: CGFloat = 90

    /// Snapshot of `progress` captured on the first onChanged event of
    /// the current drag. Used instead of a live closure capture so a
    /// concurrent progress mutation (hydration, animation finish)
    /// doesn't break the math mid-drag.
    @State private var dragStartProgress: Double? = nil

    /// Snap animation used by both the gesture-end snap and the tap-
    /// toggle. Native-feeling response + slight bounce.
    private var snapAnim: Animation {
        .spring(response: 0.36, dampingFraction: 0.84, blendDuration: 0.08)
    }

    var body: some View {
        GeometryReader { geo in
            let screenH = geo.size.height
            let collapsedY: CGFloat = collapsedFromTop
            let y = collapsedY * CGFloat(progress)

            VStack(spacing: 0) {
                grabRegion
                Divider().background(Color(hex: 0xEEE7DA))
                ScrollView(showsIndicators: false) {
                    content()
                        .padding(.bottom, 130)
                }
                // When peeked, body scrolls would fight the sheet pan ·
                // disable so vertical drags bubble up to our gesture.
                .scrollDisabled(progress > 0.5)
            }
            .frame(width: geo.size.width, height: screenH)
            .background(Color(hex: 0xFAF7F1))
            .clipShape(RoundedCorner(radius: 30, corners: [.topLeft, .topRight]))
            .shadow(color: .black.opacity(0.4), radius: 18, x: 0, y: -10)
            .offset(y: y)
            // Whole-sheet pan · start-position-aware (see panGesture).
            .simultaneousGesture(panGesture(collapsedY: collapsedY))
        }
    }

    /// Grab strip · handle + caller-provided peek header. Also accepts
    /// taps to toggle the sheet · gives runners a fallback when their
    /// flick doesn't quite register.
    private var grabRegion: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Color(hex: 0xDCD6CA))
                .frame(width: 52, height: 6)
                .padding(.top, 12)
                .padding(.bottom, 8)
                .frame(maxWidth: .infinity)
            header()
                .padding(.horizontal, 24)
                .padding(.bottom, 16)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            withAnimation(snapAnim) {
                progress = progress > 0.5 ? 0 : 1
            }
        }
    }

    private func panGesture(collapsedY: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 3, coordinateSpace: .local)
            .onChanged { g in
                // Decide whether this drag belongs to the sheet:
                //   · peeked (progress > 0.05) → ALWAYS engage; body
                //     scrolls are disabled and the user is reaching for
                //     the sheet pull-up
                //   · expanded → engage ONLY if the drag STARTED in the
                //     grab band (top ~90pt); body keeps scroll control
                //     everywhere else
                if dragStartProgress == nil {
                    let isPeeked = progress > 0.05
                    let startedInGrab = g.startLocation.y < grabBandHeight
                    guard isPeeked || startedInGrab else { return }
                    dragStartProgress = progress
                }
                guard let start = dragStartProgress else { return }
                let startY = CGFloat(start) * collapsedY
                let newY = max(0, min(collapsedY, startY + g.translation.height))
                progress = Double(newY / collapsedY)
            }
            .onEnded { g in
                guard dragStartProgress != nil else { return }
                dragStartProgress = nil
                // Velocity proxy: predictedEndTranslation - translation ≈ v·0.1
                let velProxy = g.predictedEndTranslation.height - g.translation.height
                let target: Double
                if velProxy < -120 {
                    target = 0           // upward flick → open
                } else if velProxy > 120 {
                    target = 1           // downward flick → close
                } else {
                    target = progress < 0.5 ? 0 : 1     // static · nearest snap
                }
                withAnimation(snapAnim) {
                    progress = target
                }
            }
    }
}

// MARK: - Rounded corners helper

struct RoundedCorner: Shape {
    var radius: CGFloat
    var corners: UIRectCorner

    func path(in rect: CGRect) -> Path {
        let p = UIBezierPath(roundedRect: rect, byRoundingCorners: corners,
                             cornerRadii: CGSize(width: radius, height: radius))
        return Path(p.cgPath)
    }
}
