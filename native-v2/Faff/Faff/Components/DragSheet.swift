//
//  DragSheet.swift
//  Drag-up sheet (peek → expanded) used on Today (completed/effort), Activity
//  card detail, Health readiness breakdown. Drag handle + peek header +
//  scrollable body.
//
//  Gesture model (2026-05-30 fix · user reported "hard to flick up"):
//   · Drag gesture lives ONLY on the grab area (handle + peek header), not
//     the inner ScrollView, so vertical scrolls in the body never compete
//     with the sheet pan.
//   · onEnded honors velocity via `predictedEndTranslation` instead of
//     pure position. A small upward flick at any progress now snaps open.
//   · Snap threshold loosened from 0.55 → 0.45 so even a static release
//     past the midline expands.
//

import SwiftUI

struct DragSheet<Header: View, Body: View>: View {
    /// Distance the sheet rests below the screen top when collapsed (peek height).
    let collapsedFromTop: CGFloat
    /// 0 = fully expanded (rests at top), 1 = fully collapsed (rests at peek).
    @Binding var progress: Double
    @ViewBuilder var header: () -> Header
    @ViewBuilder var content: () -> Body

    @State private var dragStart: CGFloat? = nil

    var body: some View {
        GeometryReader { geo in
            let screenH = geo.size.height
            let expandedY: CGFloat = 0
            let collapsedY: CGFloat = collapsedFromTop
            let y = collapsedY * CGFloat(progress)

            VStack(spacing: 0) {
                // GRAB AREA · handle + peek header. Drag gesture lives here
                // only; the ScrollView below is free to scroll vertically
                // without fighting the sheet pan.
                grabRegion(collapsedY: collapsedY)

                Divider().background(Color(hex: 0xEEE7DA))

                ScrollView(showsIndicators: false) {
                    content()
                        .padding(.bottom, 130)
                }
            }
            .frame(width: geo.size.width, height: screenH - expandedY)
            .background(Color(hex: 0xFAF7F1))
            .clipShape(RoundedCorner(radius: 30, corners: [.topLeft, .topRight]))
            .shadow(color: .black.opacity(0.4), radius: 18, x: 0, y: -10)
            .offset(y: y)
        }
    }

    /// Grab strip (handle + peek header). Holds the drag gesture.
    private func grabRegion(collapsedY: CGFloat) -> some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Color(hex: 0xDCD6CA))
                .frame(width: 42, height: 5)
                .padding(.top, 11)
                .padding(.bottom, 6)
                .frame(maxWidth: .infinity)
            header()
                .padding(.horizontal, 24)
                .padding(.bottom, 16)
        }
        .contentShape(Rectangle())          // make whole strip hittable
        .gesture(panGesture(collapsedY: collapsedY))
    }

    private func panGesture(collapsedY: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 4, coordinateSpace: .local)
            .onChanged { g in
                if dragStart == nil { dragStart = CGFloat(progress) * collapsedY }
                let new = (dragStart! + g.translation.height)
                progress = Double(max(0, min(collapsedY, new)) / collapsedY)
            }
            .onEnded { g in
                dragStart = nil
                // Honor velocity. predictedEndTranslation is roughly
                // (translation + velocity × 0.1). A small upward flick at any
                // progress collapses < 0.45 → snap open. Same for downward.
                let predicted = (CGFloat(progress) * collapsedY) + (g.predictedEndTranslation.height - g.translation.height)
                let predictedProgress = max(0, min(collapsedY, predicted)) / collapsedY
                let target: Double = predictedProgress < 0.45 ? 0 : 1
                withAnimation(.interpolatingSpring(stiffness: 240, damping: 28)) {
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
