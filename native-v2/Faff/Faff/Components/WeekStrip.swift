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
    /// Strength recommender picked this day · renders a thin underline under
    /// the date number (no glyph — David's pick, keeps the strip uncluttered).
    var strengthSuggested: Bool = false
    /// A strength session was LOGGED on this date · the underline turns green
    /// (vs blue for merely recommended).
    var strengthDone: Bool = false
    /// Strength would have been on this day but the readiness gate paused it
    /// this week · the underline shows yellow ("paused") so the week isn't
    /// blank when recovery is low.
    var strengthPaused: Bool = false
}

struct WeekStrip: View {
    let weeks: [[WeekStripDay]]
    @Binding var selectedID: String
    @Binding var weekIndex: Int

    private let cellWidth: CGFloat = 44

    var body: some View {
        TabView(selection: $weekIndex) {
            ForEach(Array(weeks.enumerated()), id: \.offset) { idx, week in
                HStack(spacing: 0) {
                    ForEach(week) { d in
                        Button {
                            withAnimation(Theme.Motion.smooth) { selectedID = d.id }
                        } label: {
                            cell(d)
                        }
                        .buttonStyle(.plain)
                        // maxWidth distributes the page width equally across all
                        // day slots — no measurement needed. contentShape ensures
                        // the full slot (not just the 44pt cell) is tappable.
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .contentShape(Rectangle())
                    }
                }
                .tag(idx)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .frame(height: 80)
    }

    @ViewBuilder
    private func cell(_ d: WeekStripDay) -> some View {
        let isSelected = d.id == selectedID
        VStack(spacing: 7) {
            // Today's day letter is blue (no circle · a circle's frame grew the
            // cell and clipped the fixed selection box). Pure colour change, so
            // the cell + pill stay exactly the same size.
            Text(d.dow)
                .font(.label(10)).tracking(0.5).textCase(.uppercase)
                .foregroundStyle(d.isToday
                    ? Color(hex: 0x3AB0CF)
                    : Theme.txt.opacity(isSelected ? 1 : 0.65))
            Text("\(d.date)")
                .font(.body(15, weight: .semibold))
                .tracking(-0.3)
                .foregroundStyle(d.isToday
                    ? Color(hex: 0x3AB0CF)
                    : Theme.txt.opacity(isSelected ? 1 : 0.8))
                // Strength day · a thin underline below the number. Overlay (not
                // a stacked element) so it never shifts the cell's layout.
                .overlay(alignment: .bottom) {
                    if d.strengthDone {
                        Capsule()
                            .fill(Color(hex: 0x9AF0BF))   // green · strength logged
                            .frame(width: 14, height: 2.5)
                            .offset(y: 2)
                    } else if d.strengthSuggested {
                        Capsule()
                            .fill(Color(hex: 0x27B4E0))   // blue · recommended
                            .frame(width: 14, height: 2.5)
                            .offset(y: 2)
                    } else if d.strengthPaused {
                        Capsule()
                            .fill(Color(hex: 0xF3AD38).opacity(0.85))  // yellow · paused (readiness)
                            .frame(width: 14, height: 2.5)
                            .offset(y: 2)
                    }
                }
            if d.effort == .rest {
                Capsule()
                    .fill(Color.white.opacity(0.5))
                    .frame(width: 9, height: 2)
            } else if d.isSkipped {
                // Skipped · a muted grey dot in place of the live effort color
                // (David's pick — de-emphasize, don't flag with a slash). Same
                // 6pt dot as a normal day so only the colour reads as "off".
                Circle()
                    .fill(Color.white.opacity(0.38))
                    .frame(width: 6, height: 6)
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
        .padding(.top, 7).padding(.bottom, 11)
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
