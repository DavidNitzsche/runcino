//
//  DragSheet.swift
//  Drag-up sheet (peek → expanded) used on Today (completed/effort), Activity
//  card detail, Health readiness breakdown. Drag handle + peek header + scrollable body.
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
                Capsule()
                    .fill(Color(hex: 0xDCD6CA))
                    .frame(width: 42, height: 5)
                    .padding(.top, 11)
                    .padding(.bottom, 6)
                header()
                    .padding(.horizontal, 24)
                    .padding(.bottom, 16)
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
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { g in
                        if dragStart == nil { dragStart = CGFloat(progress) * collapsedY }
                        let new = (dragStart! + g.translation.height)
                        progress = Double(max(expandedY, min(collapsedY, new)) / collapsedY)
                    }
                    .onEnded { g in
                        dragStart = nil
                        let target: Double = progress < 0.55 ? 0 : 1
                        withAnimation(Theme.Motion.sheet) { progress = target }
                    }
            )
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
