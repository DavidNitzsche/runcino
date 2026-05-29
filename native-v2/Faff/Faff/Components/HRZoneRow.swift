//
//  HRZoneRow.swift
//
//  iPhone mirror of the per-row HR zone table cells in
//  web-v2/app/profile/page.tsx:184-199 — five rows (Z1 … Z5) showing
//  the short label, the friendly name, the bpm range, and the purpose
//  prose. The web renders them as a <table>; on iPhone we use a single
//  flex row per zone with the same column proportions.
//
//  Range formatting rules mirror the web (page.tsx:189-193):
//    · Z1  →  "< {upper} bpm"
//    · Z5  →  "> {lower} bpm"
//    · Z2-Z4 → "{lower}–{upper} bpm"
//
//  The zone label color keys off the Z-number using the Theme.Zone
//  palette (Z1 slate-blue, Z2 teal, Z3 lime, Z4 amber, Z5 crimson).
//

import SwiftUI

struct HRZoneRow: View {
    let zone: ProfileHRZone

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Short label · color-keyed (Z1 … Z5).
            Text(zone.shortLabel)
                .font(.body(13, weight: .bold))
                .tracking(0.5)
                .foregroundStyle(zoneColor(zone.idx))
                .frame(width: 32, alignment: .leading)
            // Friendly name + purpose stack.
            VStack(alignment: .leading, spacing: 4) {
                Text(zone.label)
                    .font(.body(14, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                Text(zone.purpose)
                    .font(.body(11.5))
                    .foregroundStyle(Theme.mute)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            // Range column · right-aligned.
            Text(rangeText)
                .font(.body(13, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .frame(width: 100, alignment: .trailing)
        }
        .padding(.vertical, 10)
        .overlay(
            Rectangle()
                .fill(Theme.line2)
                .frame(height: 1),
            alignment: .bottom
        )
    }

    /// Mirror of the bpm range formatter in page.tsx:189-193.
    private var rangeText: String {
        if zone.idx == 1 { return "< \(zone.upper) bpm" }
        if zone.idx == 5 { return "> \(zone.lower) bpm" }
        return "\(zone.lower)–\(zone.upper) bpm"
    }

    /// Theme.Zone palette mapping (locked 2026-05-28 in tokens.json v1.4.0).
    private func zoneColor(_ idx: Int) -> Color {
        switch idx {
        case 1: return Theme.Zone.z1
        case 2: return Theme.Zone.z2
        case 3: return Theme.Zone.z3
        case 4: return Theme.Zone.z4
        case 5: return Theme.Zone.z5
        default: return Theme.mute
        }
    }
}
