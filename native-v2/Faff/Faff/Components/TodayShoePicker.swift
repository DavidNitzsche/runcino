//
//  TodayShoePicker.swift   (2026-06-01 round 8 · design package #3 follow-up)
//
//  Bottom-sheet shoe picker presented from the Today pre-run sheet's
//  SHOE cell. Reads the runner's shoe garage and lets them assign a
//  shoe to today's run.
//
//  Surface: bottom action sheet · scrim + slide-up card · title
//  "Shoe for this run" · one row per non-retired shoe (name +
//  mileage line) · checkmark on the current pick in the run accent
//  color · tap a row to select + dismiss.
//
//  Selection persistence: local-only in v1 · the iPhone holds
//  selectedShoeId in TodayView state, the picker just emits the
//  selected Shoe via onSelect. When backend ships per-workout shoe
//  assignment (designs/briefs/backend-per-workout-shoe-assignment.md
//  · TBD), wire onSelect to POST /api/workout/shoe.
//

import SwiftUI

struct TodayShoePicker: View {
    let shoes: [Shoe]
    let selectedId: Int?
    let accent: Color
    let onSelect: (Shoe) -> Void
    let onClose: () -> Void

    /// Filtered to non-retired shoes only · a retired shoe in the picker
    /// is noise. If all shoes are retired, the list renders empty with
    /// a hint to add a shoe in Profile.
    private var pickable: [Shoe] {
        shoes.filter { $0.retired != true }
    }

    var body: some View {
        VStack(spacing: 0) {
            grab
            title
            if pickable.isEmpty {
                emptyState
            } else {
                ScrollView(showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        ForEach(pickable) { shoe in
                            shoeRow(shoe)
                            if shoe.id != pickable.last?.id {
                                Rectangle()
                                    .fill(Color(hex: 0xEEE7DA))
                                    .frame(height: 1)
                                    .padding(.leading, 24)
                            }
                        }
                    }
                }
                .frame(maxHeight: rowsMaxHeight)
            }
            // Bottom safe-area padding so the last row clears the
            // tab bar pill when the sheet is presented over the
            // RootTabView.
            Color.clear.frame(height: 28)
        }
        .background(
            UnevenRoundedRectangle(
                topLeadingRadius: 26,
                bottomLeadingRadius: 0,
                bottomTrailingRadius: 0,
                topTrailingRadius: 26,
                style: .continuous
            )
            .fill(Color(hex: 0xFAF7F1))
        )
    }

    // MARK: Subviews

    private var grab: some View {
        Capsule()
            .fill(Color(hex: 0xDCD6CA))
            .frame(width: 42, height: 5)
            .padding(.top, 11).padding(.bottom, 4)
    }

    private var title: some View {
        HStack {
            Text("Shoe for this run")
                .font(.body(15, weight: .extraBold))
                .tracking(-0.2)
                .foregroundStyle(Color(hex: 0x14110D))
            Spacer()
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Color(hex: 0x9A9286))
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 24).padding(.vertical, 14)
        .overlay(
            Rectangle().fill(Color(hex: 0xEEE7DA)).frame(height: 1),
            alignment: .bottom
        )
    }

    private func shoeRow(_ shoe: Shoe) -> some View {
        Button(action: { onSelect(shoe) }) {
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(shoe.displayName.isEmpty ? "Untitled shoe" : shoe.displayName)
                        .font(.body(15, weight: .extraBold))
                        .tracking(-0.2)
                        .foregroundStyle(Color(hex: 0x14110D))
                    Text(roleAndMileage(shoe))
                        .font(.body(12))
                        .foregroundStyle(Color(hex: 0x736C61))
                }
                Spacer(minLength: 0)
                if shoe.id == selectedId {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 19, weight: .bold))
                        .foregroundStyle(accent)
                } else if shoe.preferred == true {
                    Text("PREFERRED")
                        .font(.body(9, weight: .extraBold)).tracking(1.2)
                        .foregroundStyle(Color(hex: 0x9A9286))
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .overlay(Capsule().stroke(Color(hex: 0xD9D2C4)))
                }
            }
            .padding(.horizontal, 24).padding(.vertical, 16)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// 2026-07-07 · units audit — display only.
    private func roleAndMileage(_ shoe: Shoe) -> String {
        var parts: [String] = []
        if let mi = shoe.mileage, mi > 0 {
            let converted = Units.convertDistance(miles: mi, to: Units.preference.distance)
            parts.append("\(Int(converted.rounded())) \(Units.distanceLabel())")
        }
        if let cap = shoe.mileage_cap, cap > 0 {
            let convertedCap = Units.convertDistance(miles: cap, to: Units.preference.distance)
            parts.append("of \(Int(convertedCap.rounded())) cap")
        }
        if shoe.preferred == true { parts.append("preferred") }
        if parts.isEmpty { return "—" }
        return parts.joined(separator: " · ")
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "shoe.fill")
                .font(.system(size: 26, weight: .medium))
                .foregroundStyle(Color(hex: 0xB3AA9C))
            Text("No active shoes in your garage")
                .font(.body(13, weight: .extraBold))
                .foregroundStyle(Color(hex: 0x4F483F))
            Text("Add one in Profile → Shoes")
                .font(.body(12))
                .foregroundStyle(Color(hex: 0x9A9286))
        }
        .padding(.horizontal, 24).padding(.vertical, 28)
        .frame(maxWidth: .infinity)
    }

    /// Cap list height at ~5.5 rows so the picker doesn't fill the
    /// whole screen with a deep garage. ScrollView handles overflow.
    private var rowsMaxHeight: CGFloat {
        let rowHeight: CGFloat = 64
        let visible = min(CGFloat(pickable.count), 5.5)
        return rowHeight * visible
    }
}
