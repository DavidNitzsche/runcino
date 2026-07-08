//
//  RunShoePickerSheet.swift
//  Bottom sheet for assigning a shoe to a completed run.
//  Presented from TodayPostRunBody's shoe row.
//  Uses the inline [RunDetailShoe] already on RunDetail — no extra round-trip.
//

import SwiftUI

struct RunShoePickerSheet: View {
    @Environment(\.dismiss) private var dismiss

    let shoes: [RunDetailShoe]
    let currentShoeId: Int?
    let accent: Color
    let onSelect: (RunDetailShoe) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Capsule().fill(Color.white.opacity(0.18))
                .frame(width: 40, height: 4)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 8).padding(.bottom, 4)

            Text("Shoes")
                .font(.display(22, weight: .bold))
                .foregroundStyle(Theme.txt)
                .padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 16)

            if shoes.isEmpty {
                Text("No shoes in your garage yet. Add some in Profile → Shoes.")
                    .font(.body(13, weight: .medium))
                    .foregroundStyle(Theme.mute)
                    .padding(24)
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 8) {
                        ForEach(shoes) { row($0) }
                    }
                    .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 32)
                }
            }
        }
        .background(Theme.Glass.strong)
        .ignoresSafeArea(edges: .bottom)
    }

    private func row(_ shoe: RunDetailShoe) -> some View {
        Button {
            onSelect(shoe)
            dismiss()
        } label: {
            HStack(spacing: 12) {
                Circle()
                    .fill(roleColor(for: shoe))
                    .frame(width: 10, height: 10)
                VStack(alignment: .leading, spacing: 2) {
                    Text(shoe.displayName.isEmpty ? "Unnamed shoe" : shoe.displayName)
                        .font(.body(14, weight: .extraBold))
                        .foregroundStyle(Theme.txt)
                    if let mi = shoe.mileage {
                        // 2026-07-07 · units audit — display only.
                        let converted = Int(Units.convertDistance(miles: mi, to: Units.preference.distance).rounded())
                        Text("\(converted) \(Units.distanceLabel())" + (shoe.preferred == true ? " · preferred" : ""))
                            .font(.body(11.5, weight: .medium))
                            .foregroundStyle(Theme.mute)
                    }
                }
                Spacer()
                if shoe.id == currentShoeId {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(accent)
                } else {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Theme.mute)
                }
            }
            .padding(14)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous)
                    .stroke(Theme.Glass.line, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func roleColor(for shoe: RunDetailShoe) -> Color {
        if shoe.preferred == true { return Theme.Shoe.race }
        if let mi = shoe.mileage, let cap = shoe.mileage_cap, cap > 0, mi / cap > 0.8 {
            return Theme.Shoe.recovery
        }
        return Theme.Shoe.easy
    }
}
