//
//  WeekStrip.swift
//  7-day week strip with full-week page-snap.
//  Each page = one Sat–Sun week. Swipe left/right flips the whole week.
//  Tap a day to select it within the visible page.
//

import SwiftUI

struct WeekStripDay: Identifiable, Hashable {
    let id: String        // e.g. "2026-05-28"
    let dow: String       // "M"
    let date: Int         // 28
    let effort: FaffEffort
    var isToday: Bool = false
    var isDone: Bool = false
    /// Runner tapped Skip Today on this date · day_actions row exists.
    var isSkipped: Bool = false
}

struct WeekStrip: View {
    let weeks: [[WeekStripDay]]
    @Binding var selectedID: String
    @Binding var weekIndex: Int

    private let cellWidth: CGFloat = 44

    var body: some View {
        TabView(selection: $weekIndex) {
            ForEach(Array(weeks.enumerated()), id: \.offset) { idx, week in
                weekRow(week)
                    .tag(idx)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .frame(height: 72)
    }

    private func weekRow(_ week: [WeekStripDay]) -> some View {
        HStack(spacing: 0) {
            ForEach(week) { d in
                Button {
                    withAnimation(Theme.Motion.smooth) { selectedID = d.id }
                } label: {
                    cell(d)
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, 6)
    }

    @ViewBuilder
    private func cell(_ d: WeekStripDay) -> some View {
        let isSelected = d.id == selectedID
        VStack(spacing: 7) {
            Text(d.dow)
                .font(.label(10)).tracking(0.5).textCase(.uppercase)
                .foregroundStyle(Theme.txt.opacity(isSelected || d.isToday ? 1 : 0.65))
            Text("\(d.date)")
                .font(.body(15, weight: .semibold))
                .tracking(-0.3)
                .foregroundStyle(Theme.txt.opacity(isSelected || d.isToday ? 1 : 0.8))
            if d.effort == .rest {
                Capsule()
                    .fill(Color.white.opacity(0.5))
                    .frame(width: 9, height: 2)
            } else if d.isSkipped {
                ZStack {
                    Circle()
                        .stroke(Color.white.opacity(0.30), lineWidth: 1)
                        .frame(width: 14, height: 14)
                    Image(systemName: "slash.circle")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.45))
                }
            } else if d.isDone {
                ZStack {
                    Circle()
                        .fill(Color(hex: 0x9AF0BF).opacity(0.18))
                        .frame(width: 14, height: 14)
                    Circle()
                        .stroke(Color(hex: 0x9AF0BF).opacity(0.6), lineWidth: 1)
                        .frame(width: 14, height: 14)
                    Image(systemName: "checkmark")
                        .font(.system(size: 7, weight: .black))
                        .foregroundStyle(Color(hex: 0x9AF0BF))
                }
            } else {
                Circle()
                    .fill(d.effort.dot)
                    .frame(width: 6, height: 6)
            }
        }
        .frame(width: cellWidth)
        .padding(.vertical, 9)
        .background(
            RoundedRectangle(cornerRadius: 15)
                .fill(isSelected ? Color.white.opacity(0.17) : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 15)
                .stroke(isSelected ? Color.white.opacity(0.5) : Color.clear, lineWidth: 1)
        )
        .opacity(d.isSkipped ? 0.6 : 1.0)
    }
}
