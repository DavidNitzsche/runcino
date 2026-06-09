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
    /// LEGACY · distance the sheet rests below the screen top when
    /// collapsed. Hardcoded device-specific value · breaks on phones
    /// with different screen heights. Prefer `collapsedInsetFromBottom`
    /// for new callers. Optional · ignored when the inset is set.
    var collapsedFromTop: CGFloat? = nil
    /// 2026-06-02 round 21 · device-agnostic anchor. Distance the
    /// COLLAPSED sheet's top edge sits ABOVE the screen's bottom edge.
    /// Computed against the live screen height inside the body, so the
    /// same value lands the peek at the same visual position on any
    /// iPhone size. Typical value: tabBarHeight + safeArea + a bit of
    /// breathing room (~200pt covers the floating tab bar pill on all
    /// iPhones, leaving the peek visible above with a small gap).
    var collapsedInsetFromBottom: CGFloat? = nil
    /// 0 = fully expanded (rests at top), 1 = fully collapsed (rests at peek).
    @Binding var progress: Double
    /// 2026-06-01 · Today v2 brief: "the whole peek (grab + peek) is filled
    /// with the run's effort color." Defaults to .clear. When non-clear,
    /// the grab + handle + caller header all render on this color,
    /// the divider hides, and the body still uses the standard cream background.
    var peekBackground: Color = .clear
    /// 2026-06-02 round 54 · sheet body background color. Defaults to
    /// the brand cream (#FAF7F1) so existing callers keep their look.
    /// Post-run today switches to white so the per-section white cards
    /// blend into one continuous surface · no "see-behind" cream band
    /// below the last card before the floating tab bar.
    var bodyBackground: Color = Color(hex: 0xFAF7F1)
    /// Color of the grab capsule. Stays at the cream-on-cream charcoal by
    /// default; switch to white-with-opacity when peekBackground is
    /// non-clear so the handle stays visible against the accent fill.
    var grabTint: Color = Color(hex: 0xDCD6CA)
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
            // 2026-06-03 round 69 · FIRST-FRAME UNDERFLOW GUARD.
            //
            // David: "still getting this issue sometimes with the
            // bottom tab being up on app load. its not every time,
            // but it is weird." On the first layout pass GeometryReader
            // can return geo.size.height = 0 (or a small value that
            // hasn't accounted for safe area), which yielded
            // collapsedY = -200 (or far smaller than the true bottom
            // anchor). With progress = 1, the sheet rendered at that
            // wrong y, then never re-snapped when the second-pass
            // layout settled.
            //
            // Fix: clamp screenH to a sane minimum (450pt). Anything
            // smaller is a guaranteed mid-layout artifact, not a real
            // device. The clamp uses a typical iPhone screen height
            // floor (smallest supported = SE @ 568pt) so we never
            // computed a garbage collapsedY. Once geo settles to the
            // real value, body re-evaluates and the sheet lands at
            // its true bottom position.
            let rawH = geo.size.height
            let screenH = max(rawH, 450)
            let collapsedY: CGFloat = {
                if let inset = collapsedInsetFromBottom { return screenH - inset }
                if let top = collapsedFromTop { return top }
                return screenH - 200
            }()
            let y = collapsedY * CGFloat(progress)

            VStack(spacing: 0) {
                grabRegion
                    // 2026-06-02 round 32 · orb overlay retired. The
                    // peek + the sheet's outer accent fill (round 31
                    // ZStack overlay) used different render paths for
                    // the same color · seam visible where the orb-
                    // shaded peek met the solid accent below. Now the
                    // peek's BG is just the same `peekBackground` color
                    // as a flat fill · the outer sheet ZStack overlay
                    // handles everything else, no seam.
                    .background(peekBackground)
                // Divider hides when the peek is accent-filled · the
                // color change itself reads as the boundary, and an
                // extra cream stripe would break the visual continuity.
                if peekBackground == .clear {
                    Divider().background(Color(hex: 0xEEE7DA))
                }
                ScrollView(showsIndicators: false) {
                    content()
                        // 2026-06-02 round 55 · 170 → 100.
                        // 2026-06-02 round 57 · 100 → 120. Signature
                        // row was reading too close to the tab bar pill ·
                        // 20pt more bottom gap pushes the last visible
                        // content row clear of the pill with comfortable
                        // breathing room.
                        .padding(.bottom, 120)
                }
                // When peeked, body scrolls would fight the sheet pan ·
                // disable so vertical drags bubble up to our gesture.
                .scrollDisabled(progress > 0.5)
                // 2026-06-02 round 24 · body fades out as the sheet
                // collapses. Peek stays solid (it's outside this
                // ScrollView · in grabRegion above). At progress >= 0.7
                // the body is fully hidden · prevents the first body
                // section ("EASY" Oswald hero, etc.) from peeking
                // between the collapsed peek and the floating tab bar.
                .opacity(max(0, 1 - Double(progress) * 1.4))
                .allowsHitTesting(progress < 0.5)
            }
            .frame(width: geo.size.width, height: screenH)
            // 2026-06-02 round 28 · reverted the peek-color overlay
            // that bled the accent down through the tab bar area · it
            // made the menu read as orange-on-orange. Back to the
            // simple cream gradient that fades to clear at the bottom
            // so the tab bar pill renders against dark mesh.
            //   - solid cream for the top 85% (body content reads here)
            //   - fades to clear over bottom 15% (tab bar renders against
            //     the dark mesh behind, stays legible)
            // Peek "life" (subtle orb overlay) stays on the peek itself
            // via the ZStack inside grabRegion's background (above) ·
            // affects only the peek surface, not the entire sheet.
            .background(
                // 2026-06-02 round 31 · sheet BG interpolates between
                // cream (expanded) and the peek accent (collapsed).
                // Collapsed state: accent fills the entire sheet
                // including the area below the peek that extends behind
                // the floating tab bar pill · the tab bar sits on
                // solid accent green/orange/etc. Expanded state: cream
                // shows behind the body content as before.
                //
                // Implementation: cream base + accent overlay whose
                // opacity tracks progress (0 = expanded → no accent,
                // 1 = collapsed → full accent).
                ZStack {
                    bodyBackground
                    if peekBackground != .clear {
                        peekBackground.opacity(Double(progress))
                    }
                }
            )
            .clipShape(RoundedCorner(radius: 30, corners: [.topLeft, .topRight]))
            .shadow(color: .black.opacity(0.4), radius: 18, x: 0, y: -10)
            .offset(y: y)
            // Whole-sheet pan · start-position-aware (see panGesture).
            .simultaneousGesture(panGesture(collapsedY: collapsedY))
        }
        // Re-enabled · sheet extends behind the tab bar so the gradient
        // can fade UNDER the floating pill. The gradient (above) handles
        // tab-bar legibility by going transparent in the bottom band.
        .ignoresSafeArea(.container, edges: .bottom)
    }

    /// Grab strip · handle + caller-provided peek header. Also accepts
    /// taps to toggle the sheet · gives runners a fallback when their
    /// flick doesn't quite register.
    private var grabRegion: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(grabTint)
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
