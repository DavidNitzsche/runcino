//
//  TodayShoeOverrideSheet.swift
//  Per-day shoe override for Today / a selected planned day.
//
//  Lists the runner's non-retired shoes; tap one to POST
//  /api/today/shoe { date, shoe_id }. The coach picks up the override
//  on next briefing render; the picker dismisses on selection.
//
//  Toolkit · Family F · ShoePickerSheet shape (atom matches verbatim).
//

import SwiftUI

struct TodayShoeOverrideSheet: View {
    @Environment(\.dismiss) private var dismiss
    let profile: ProfileState?
    /// ISO date the override applies to. Today by default; selected day
    /// when the runner has picked a future day in the week strip.
    let date: String
    /// Fires after a successful POST so the host view can reload state.
    var onPicked: (String) -> Void = { _ in }

    @State private var submittingId: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Capsule().fill(Color.white.opacity(0.18))
                .frame(width: 40, height: 4)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 8)
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Today's shoe")
                        .font(.display(22, weight: .bold))
                        .foregroundStyle(Theme.txt)
                    Text("Pick a shoe for this run · the coach uses your choice for fueling + recovery math.")
                        .font(.body(12.5, weight: .medium))
                        .foregroundStyle(Theme.mute)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
            }
            .padding(.horizontal, 24).padding(.top, 12)

            if let shoes = profile?.shoes?.filter({ !($0.retired ?? false) }), !shoes.isEmpty {
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(shoes) { s in row(s) }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                    .padding(.bottom, 24)
                }
            } else {
                Text("No shoes in your garage yet. Add some in Profile → Shoe Garage.")
                    .font(.body(13, weight: .medium))
                    .foregroundStyle(Theme.mute)
                    .padding(24)
            }
        }
        .background(Theme.Glass.strong)
        .ignoresSafeArea(edges: .bottom)
    }

    private func row(_ s: ProfileShoe) -> some View {
        Button {
            submittingId = s.id
            Task {
                // ProfileShoe.id is a String (e.g. "shoe_12") for cross-
                // surface stability; the /api/today/shoe endpoint expects
                // the integer shoe_id. Strip the prefix when present.
                let intId = Int(s.id.replacingOccurrences(of: "shoe_", with: ""))
                _ = try? await API.setShoeForDay(date: date, shoeId: intId)
                await MainActor.run {
                    onPicked(s.id)
                    submittingId = nil
                    dismiss()
                }
            }
        } label: {
            HStack(spacing: 12) {
                Circle()
                    .fill(roleColor(for: s))
                    .frame(width: 10, height: 10)
                VStack(alignment: .leading, spacing: 2) {
                    Text(s.name ?? [s.brand, s.model].compactMap { $0 }.joined(separator: " "))
                        .font(.body(14, weight: .extraBold))
                        .foregroundStyle(Theme.txt)
                    if let mi = s.mileage {
                        // 2026-07-07 · units audit — display only.
                        let converted = Int(Units.convertDistance(miles: mi, to: Units.preference.distance))
                        Text("\(converted) \(Units.distanceLabel())" + (s.preferred == true ? " · race" : ""))
                            .font(.body(11.5, weight: .medium))
                            .foregroundStyle(Theme.mute)
                    }
                }
                Spacer()
                if submittingId == s.id {
                    ProgressView().tint(Theme.txt)
                } else {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Theme.mute)
                }
            }
            .padding(14)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(submittingId != nil)
    }

    private func roleColor(for s: ProfileShoe) -> Color {
        if s.preferred == true { return Theme.Shoe.race }
        let pct = s.pctUsed ?? 0
        if pct > 0.8 { return Theme.Shoe.recovery }
        return Theme.Shoe.easy
    }
}
