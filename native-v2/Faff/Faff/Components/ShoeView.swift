//
//  ShoeView.swift
//  Shoe row in 3 sizes:
//    .compact  — for Profile carousel (~150pt wide)
//    .detail   — for Shoe Garage list (full-width detailed card)
//    .picker   — for shoe-swap drag-up sheet (row with dot + name + role + miles + check)
//

import SwiftUI

struct FaffShoe: Identifiable, Hashable {
    let id: String
    let brand: String
    let name: String
    let roles: [String]         // e.g. ["EASY", "LONG"]; uppercased; non-empty
    let miles: Double
    let lifeMi: Double
    var retired: Bool = false
    var note: String? = nil
}

extension FaffShoe {
    var primaryRole: String { roles.first ?? "EASY" }
    var effort: FaffEffort {
        switch primaryRole.uppercased() {
        case "RACE":      return .race
        case "TEMPO":     return .tempo
        case "LONG":      return .long
        case "EASY":      return .easy
        case "RECOVERY":  return .recovery
        case "INTERVALS": return .intervals
        default:          return .easy
        }
    }
    var roleColor: Color { effort.dot }
    var lifePct: Double { min(1.0, miles / max(1, lifeMi)) }
    var warn: Bool { lifePct > 0.85 }
}

struct ShoeCompact: View {
    let shoe: FaffShoe
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Rectangle()
                    .fill(shoe.roleColor)
                    .frame(width: 4)
                    .frame(maxHeight: .infinity)
                VStack(alignment: .leading, spacing: 3) {
                    SpecLabel(text: shoe.primaryRole, size: 9, tracking: 1, color: shoe.roleColor)
                    Text(shoe.name)
                        .font(.body(14, weight: .extraBold))
                        .foregroundStyle(Theme.txt)
                        .lineLimit(1)
                    Text("\(Int(shoe.miles)) mi")
                        .font(.display(18, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.85))
                }
                .padding(.vertical, 12).padding(.trailing, 12)
            }
            .frame(width: 150)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous)
                .stroke(Theme.Glass.line, lineWidth: 1))
        }
    }
}

struct ShoeDetail: View {
    let shoe: FaffShoe

    var body: some View {
        HStack(spacing: 0) {
            Rectangle().fill(shoe.roleColor).frame(width: 5)
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 4) {
                            ForEach(shoe.roles, id: \.self) { r in
                                let eff = FaffEffort.fromType(r)
                                SpecLabel(text: r.uppercased(), size: 8, tracking: 1.2, color: eff.dot)
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 2)
                                    .background(eff.dot.opacity(0.15), in: Capsule())
                            }
                        }
                        Text(shoe.name)
                            .font(.body(18, weight: .extraBold))
                            .foregroundStyle(Theme.txt)
                        if let note = shoe.note {
                            Text(note)
                                .font(.body(10, weight: .semibold))
                                .foregroundStyle(Theme.txt.opacity(0.62))
                        }
                    }
                    Spacer()
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text("\(Int(shoe.miles))")
                            .font(.display(26, weight: .semibold))
                            .tracking(-1)
                            .foregroundStyle(Theme.txt)
                        Text("MI")
                            .font(.label(9))
                            .foregroundStyle(Theme.txt.opacity(0.62))
                    }
                }
                GeometryReader { geo in
                    let w = geo.size.width
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.1)).frame(height: 7)
                        Capsule()
                            .fill(shoe.warn ? Color(hex: 0xFFB24D) : shoe.roleColor)
                            .frame(width: max(4, w * shoe.lifePct), height: 7)
                    }
                }
                .frame(height: 7)
                HStack {
                    Text("\(Int(shoe.lifePct * 100))% of \(Int(shoe.lifeMi)) mi life")
                        .font(.body(9.5, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.6))
                    Spacer()
                    Text("\(Int(shoe.lifeMi - shoe.miles)) mi left")
                        .font(.body(9.5, weight: .semibold))
                        .foregroundStyle(shoe.warn ? Color(hex: 0xFFB24D) : Theme.txt.opacity(0.6))
                }
            }
            .padding(.vertical, 14)
            .padding(.horizontal, 16)
        }
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous)
            .stroke(Theme.Glass.line, lineWidth: 1))
        .opacity(shoe.retired ? 0.55 : 1.0)
    }
}

struct ShoePickerRow: View {
    let shoe: FaffShoe
    let selected: Bool
    let tap: () -> Void
    var body: some View {
        Button(action: tap) {
            HStack(spacing: 14) {
                Circle().fill(shoe.roleColor).frame(width: 12, height: 12)
                VStack(alignment: .leading, spacing: 3) {
                    Text(shoe.name)
                        .font(.body(15, weight: .extraBold))
                        .foregroundStyle(Theme.txt)
                    HStack(spacing: 8) {
                        SpecLabel(text: shoe.primaryRole, size: 9, tracking: 1, color: shoe.roleColor)
                        Text("\(Int(shoe.miles)) mi")
                            .font(.body(11, weight: .semibold))
                            .foregroundStyle(Theme.txt.opacity(0.6))
                    }
                }
                Spacer()
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.green)
                }
            }
            .padding(.vertical, 12)
        }
        .buttonStyle(.plain)
    }
}
