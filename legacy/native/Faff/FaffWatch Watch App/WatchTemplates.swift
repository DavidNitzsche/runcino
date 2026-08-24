//
//  WatchTemplates.swift
//  FaffWatch
//
//  Apple's four layout templates as containers. A board picks one and fills
//  its slots; it does not do its own layout.
//
//  This is the correction to how the boards were built the first time. They
//  each laid themselves out — a VStack here, a Spacer there, a padding tuned
//  until a screenshot looked passable — so every board drifted independently
//  and no two agreed on where anything sat. Geometry now lives in exactly one
//  place, comes from `WatchLayout` (Apple's kit), and a board cannot reach
//  past it, because these containers take CONTENT, not positions.
//
//  Which template a board uses is a real decision and it is recorded on the
//  board, not here:
//
//    Pill                  one primary action, everything else is reading
//    Three Bottom Controls a decision with two or three verbs
//    List View             a scrolling list, or a header over rows
//    Infographic           dense live data on fixed rows — the running faces
//
//  What these DO NOT decide: colour, type, copy, what a board says or refuses
//  to say. That is the 0821 handoff's, and it is ported in on top.
//

import SwiftUI

// MARK: - Ground

/// The full-bleed background every template sits on.
///
/// Only the ground ignores the safe area. Content never does — it is
/// positioned by Apple's margins instead, which are tighter than the system
/// safe area at the top (18pt vs 53pt on a 46mm) and wider at the sides
/// (15pt vs 2pt).
private struct TemplateGround<Background: View>: View {
    let background: Background
    var body: some View {
        background.ignoresSafeArea()
    }
}

// MARK: - Pill
//
// Content above, one full-width control at the foot. 46mm: control is
// 178x52.5 at y=180.5, so its bottom sits 15pt off the display — the same
// as the side margin, which is what makes it read as inset rather than
// dropped.

struct TPill<Content: View>: View {
    var background: AnyView = AnyView(WatchV5.ground)
    /// Where the reading block sits in the space above the control.
    var align: Alignment = .center
    @ViewBuilder var content: () -> Content
    let action: () -> Void
    var label: String
    var weight: WTargetWeight = .filled

    private var g: WatchLayout.Guides { WatchLayout.current }

    var body: some View {
        ZStack(alignment: .topLeading) {
            TemplateGround(background: background)

            VStack(spacing: 0) {
                content()
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: align)
                Spacer(minLength: 0)
            }
            .frame(width: g.margins.width, height: g.pill.minY - g.margins.minY - 8)
            .offset(x: g.margins.minX, y: g.margins.minY)

            WTarget(label: label, weight: weight, action: action)
                .frame(width: g.pill.width, height: g.pill.height)
                .offset(x: g.pill.minX, y: g.pill.minY)
        }
        .ignoresSafeArea()
    }
}

// MARK: - Three Bottom Controls
//
// Apple's slots are round: two 35pt at the sides and one 46pt in the centre,
// sharing a centre line at y=212.5 on a 46mm. The centre slot is the larger
// one and takes the verb the runner is most likely to want.
//
// The 0821 handoff draws controls as a stack of full-width pills instead.
// Under the ruling, Apple's arrangement wins — so `stacked` exists only for
// a board that genuinely cannot use round slots (a confirmation whose verbs
// are sentences, not icons), and it still uses Apple's pill geometry.

struct TThreeControls<Header: View>: View {
    var background: AnyView = AnyView(WatchV5.ground)
    @ViewBuilder var header: () -> Header
    /// Leading, centre, trailing. Centre is the emphasised slot.
    let leading: (label: String, action: () -> Void)?
    let center: (label: String, action: () -> Void)
    let trailing: (label: String, action: () -> Void)?

    private var g: WatchLayout.Guides { WatchLayout.current }

    var body: some View {
        ZStack(alignment: .topLeading) {
            TemplateGround(background: background)

            header()
                .frame(width: g.margins.width, alignment: .leading)
                .offset(x: g.margins.minX, y: g.margins.minY)

            if let leading {
                slot(leading.label, size: g.sideControl, emphasised: false, action: leading.action)
                    .offset(x: g.sideControlX.leading,
                            y: g.controlCenterY - g.sideControl / 2)
            }
            slot(center.label, size: g.centerControl, emphasised: true, action: center.action)
                .offset(x: g.centerControlX,
                        y: g.controlCenterY - g.centerControl / 2)
            if let trailing {
                slot(trailing.label, size: g.sideControl, emphasised: false, action: trailing.action)
                    .offset(x: g.sideControlX.trailing,
                            y: g.controlCenterY - g.sideControl / 2)
            }
        }
        .ignoresSafeArea()
    }

    private func slot(_ label: String, size: CGFloat, emphasised: Bool,
                      action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(WatchV5.label(emphasised ? 15 : 13, emphasised ? .heavy : .bold))
                .foregroundStyle(emphasised ? Color.black : WatchV5.value)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(.horizontal, 2)
                .frame(width: size, height: size)
                .background(emphasised ? WatchV5.value : WatchV5.surface3, in: Circle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - List View
//
// A header over scrolling rows. The fold — where the first screenful ends —
// is Apple's `Scroll Safe Area Inset`, 207.2 on a 46mm. That is the number
// the design's "a sliced row reads as a bug" rule has to be measured
// against, and it is NOT the screen height.

struct TList<Header: View, Rows: View>: View {
    var background: AnyView = AnyView(WatchV5.ground)
    var showsHeaderRule: Bool = true
    @ViewBuilder var header: () -> Header
    @ViewBuilder var rows: () -> Rows

    private var g: WatchLayout.Guides { WatchLayout.current }

    var body: some View {
        ZStack(alignment: .topLeading) {
            TemplateGround(background: background)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.bottom, 6)

                    if showsHeaderRule {
                        Rectangle()
                            .fill(WatchV5.surface3)
                            .frame(height: 1)
                            .padding(.bottom, 8)
                    }

                    rows()
                }
                .frame(width: g.margins.width, alignment: .leading)
                .padding(.top, g.margins.minY)
                // Tail inset so the last row clears the bottom curve rather
                // than dying under it.
                .padding(.bottom, g.screen.height - g.scrollFold)
            }
            .offset(x: g.margins.minX)
        }
        .ignoresSafeArea()
    }
}

// MARK: - Infographic
//
// Dense live data on FIXED rows. 46mm rows: 34.8, 52, 68.3, 141.8, 167.8,
// 203.8, 221.2.
//
// This is the template the running faces and every phase board use, and the
// fixed rows are the point: a runner glancing down mid-rep finds the same
// number in the same place whether the board underneath swapped or not. The
// first two attempts at these faces distributed the metrics by Spacer, so
// every board put its numbers somewhere slightly different and the swap
// itself became the event.
//
// Rows are given as INDICES into the guide, so a board says "hero on row 1,
// support on rows 3 and 4" and cannot invent a position.

struct TInfographic<Content: View>: View {
    var background: AnyView = AnyView(WatchV5.ground)
    /// Content is laid out against the row grid by `InfographicRow`.
    @ViewBuilder var content: () -> Content

    private var g: WatchLayout.Guides { WatchLayout.current }

    var body: some View {
        ZStack(alignment: .topLeading) {
            TemplateGround(background: background)
            content()
                .frame(width: g.margins.width, alignment: .leading)
                .offset(x: g.margins.minX)
        }
        .ignoresSafeArea()
    }
}

/// One element pinned to an Apple infographic row.
///
/// `row` is an index into `WatchLayout.current.infographicRows`. The element
/// is positioned by its BASELINE, which is what the guide's rows are — so a
/// 44pt figure and a 15pt label on the same row share a baseline rather than
/// a top edge.
struct InfoRow<Content: View>: View {
    let row: Int
    var alignment: HorizontalAlignment = .leading
    @ViewBuilder var content: () -> Content

    private var g: WatchLayout.Guides { WatchLayout.current }
    private var y: CGFloat {
        let rows = g.infographicRows
        guard !rows.isEmpty else { return g.margins.minY }
        return rows[min(max(0, row), rows.count - 1)]
    }

    var body: some View {
        content()
            .frame(maxWidth: .infinity,
                   alignment: alignment == .leading ? .leading
                            : alignment == .trailing ? .trailing : .center)
            .alignmentGuide(.top) { d in d[.firstTextBaseline] }
            .offset(y: y)
    }
}
