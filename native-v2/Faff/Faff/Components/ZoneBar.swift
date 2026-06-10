//
//  ZoneBar.swift
//  Stacked Z1-Z5 horizontal time-in-zone bar with legend.
//  Used on completed runs (the "actual" effort slot) and run detail.
//

import SwiftUI

struct ZonePct: Hashable {
    let zone: Int            // 1..5
    let pct: Double          // 0..1
    let timeLabel: String    // e.g. "9m" or "22m"
}

struct ZoneBar: View {
    let zones: [ZonePct]
    var height: CGFloat = 14
    var legend: Bool = true

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 1) {
                ForEach(zones, id: \.zone) { z in
                    Rectangle()
                        .fill(color(z.zone))
                        .frame(width: nil)
                        .frame(maxWidth: .infinity * CGFloat(z.pct))
                }
            }
            .frame(height: height)
            .clipShape(RoundedRectangle(cornerRadius: max(2, height / 3), style: .continuous))

            if legend {
                HStack(spacing: 10) {
                    ForEach(zones, id: \.zone) { z in
                        HStack(spacing: 4) {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(color(z.zone))
                                .frame(width: 8, height: 8)
                            Text("Z\(z.zone)")
                                .font(.label(9.5)).tracking(0.5)
                                .foregroundStyle(Theme.txt.opacity(0.65))
                            Text(z.timeLabel)
                                .font(.body(10, weight: .semibold))
                                .foregroundStyle(Theme.txt.opacity(0.55))
                        }
                    }
                }
            }
        }
    }

    func color(_ z: Int) -> Color {
        switch z {
        case 1: return Theme.Zone.z1
        case 2: return Theme.Zone.z2
        case 3: return Theme.Zone.z3
        case 4: return Theme.Zone.z4
        default: return Theme.Zone.z5
        }
    }
}
