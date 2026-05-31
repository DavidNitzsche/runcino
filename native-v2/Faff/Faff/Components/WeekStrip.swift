//
//  WeekStrip.swift
//  7-day mini week strip · used on Today/restday/completed/weekly.
//  Each day shows DOW letter + date + effort-color dot (or rest dash).
//  Today is highlighted; selected day pops; non-selected days dim.
//

import SwiftUI

struct WeekStripDay: Identifiable, Hashable {
    let id: String        // e.g. "2026-05-28"
    let dow: String       // "M"
    let date: Int         // 28
    let effort: FaffEffort
    var isToday: Bool = false
    var isDone: Bool = false
}

struct WeekStrip: View {
    let days: [WeekStripDay]
    @Binding var selectedID: String

    var body: some View {
        HStack(spacing: 5) {
            ForEach(days) { d in
                Button {
                    withAnimation(Theme.Motion.smooth) { selectedID = d.id }
                } label: {
                    let isSelected = d.id == selectedID
                    VStack(spacing: 7) {
                        Text(d.dow)
                            .font(.label(10)).tracking(0.5).textCase(.uppercase)
                            .foregroundStyle(Theme.txt.opacity(isSelected || d.isToday ? 1 : 0.65))
                        Text("\(d.date)")
                            .font(.display(15, weight: .semibold))
                            .tracking(-0.3)
                            .foregroundStyle(Theme.txt.opacity(isSelected || d.isToday ? 1 : 0.8))
                        // The day's effort dot · or a filled checkmark badge
                        // when the runner has a logged completion. Was
                        // rendering the effort dot only · so even after
                        // running Monday's easy + Tuesday's threshold +
                        // Wednesday's easy + Friday's easy + today's long,
                        // every day in the strip looked identical to the
                        // unstarted rest of the week. The `isDone` signal
                        // existed on WeekStripDay but the view threw it
                        // away. Plumbed from PlanDay.completedRunId.
                        if d.effort == .rest {
                            Capsule()
                                .fill(Color.white.opacity(0.5))
                                .frame(width: 9, height: 2)
                        } else if d.isDone {
                            ZStack {
                                Circle()
                                    .fill(d.effort.dot)
                                    .frame(width: 13, height: 13)
                                Image(systemName: "checkmark")
                                    .font(.system(size: 7.5, weight: .black))
                                    .foregroundStyle(Color.black.opacity(0.78))
                            }
                        } else {
                            Circle()
                                .fill(d.effort.dot.opacity(d.isToday ? 1 : 0.55))
                                .frame(width: 6, height: 6)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
                    .background(
                        RoundedRectangle(cornerRadius: 15)
                            .fill(isSelected ? Color.white.opacity(0.17) : Color.clear)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 15)
                            .stroke(isSelected ? Color.white.opacity(0.5) : Color.clear, lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
            }
        }
    }
}
