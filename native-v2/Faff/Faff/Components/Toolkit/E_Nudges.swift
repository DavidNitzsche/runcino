//
//  E_Nudges.swift
//  Family E · Banners & nudges.
//
//  Components: ProfileGapCard · DailyCheckChip.
//
//  ReconnectBanner already lives in Components/StravaReconnectBanner.swift.
//  The connect-a-source variant is the same component, status-driven · we
//  add an `info` style here so it can ride alongside the warn style.
//

import SwiftUI

// MARK: - ProfileGapCard
//
// Small dashed glass card under the Today workout. Hides once the gap
// closes. Links to the right Settings row.

struct ProfileGapCard: View {
    let body_text: String              // "Tell Faff your weight to tune fueling math."
    let cta: String                    // "Update"
    let onTap: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Text(body_text)
                .font(.body(12.5, weight: .medium))
                .foregroundStyle(Theme.txt)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Button(action: onTap) {
                Text(cta.uppercased())
                    .font(.body(11, weight: .extraBold))
                    .tracking(0.8)
                    .foregroundStyle(Theme.Accent.mintReady)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Theme.Accent.mintReady.opacity(0.12), in: Capsule())
                    .overlay(Capsule().stroke(Theme.Accent.mintReady.opacity(0.40), lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous)
                .fill(Color.white.opacity(0.04))
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous)
                .strokeBorder(Theme.Accent.mintReady.opacity(0.30),
                              style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
        )
    }
}

// MARK: - DailyCheckChip
//
// Once a niggle is active, this chip appears daily under the readiness
// tile. Selecting "Gone" resolves the niggle.

enum NiggleStatus: String, Codable {
    case better, same, worse, gone
    var label: String { rawValue.capitalized }
}

struct DailyCheckChip: View {
    let bodyPart: String                        // "hamstring"
    @Binding var selection: NiggleStatus?
    let onSelect: (NiggleStatus) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            (Text("How's your ")
             + Text(bodyPart).font(.body(13, weight: .extraBold))
             + Text(" today?"))
                .font(.body(13, weight: .medium))
                .foregroundStyle(Theme.txt)
            HStack(spacing: 6) {
                ForEach([NiggleStatus.better, .same, .worse, .gone], id: \.self) { s in
                    Button {
                        selection = s
                        onSelect(s)
                    } label: {
                        Text(s.label)
                            .font(.body(11.5, weight: .extraBold))
                            .tracking(0.4)
                            .foregroundStyle(selection == s ? Theme.bg : Theme.txt)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(
                                Capsule().fill(selection == s
                                               ? selectedColor(s)
                                               : Theme.Glass.fill)
                            )
                            .overlay(
                                Capsule().stroke(selection == s
                                                 ? selectedColor(s)
                                                 : Theme.Glass.line, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(14)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }

    private func selectedColor(_ s: NiggleStatus) -> Color {
        switch s {
        case .better: return Theme.green
        case .same:   return Theme.goal
        case .worse:  return Theme.over
        case .gone:   return Theme.Accent.mintReady
        }
    }
}

// MARK: - ConnectASourceBanner
//
// The info variant of ReconnectBanner · used when no source is connected.
// Visually identical to the warn variant but in the dist blue palette.

struct ConnectASourceBanner: View {
    let onConnect: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "plus.circle.fill")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.dist)
            VStack(alignment: .leading, spacing: 2) {
                Text("Connect a source for richer data.")
                    .font(.body(12.5, weight: .extraBold))
                    .foregroundStyle(Theme.txt)
                Text("Faff comes alive with your history.")
                    .font(.body(11.5, weight: .medium))
                    .foregroundStyle(Theme.txt.opacity(0.80))
            }
            Spacer(minLength: 6)
            Button(action: onConnect) {
                Text("CONNECT")
                    .font(.body(11, weight: .extraBold))
                    .tracking(0.9)
                    .foregroundStyle(Theme.dist)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(Theme.dist.opacity(0.14), in: Capsule())
                    .overlay(Capsule().stroke(Theme.dist.opacity(0.45), lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous)
                .fill(Color.black.opacity(0.30))
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous)
                .stroke(Theme.dist.opacity(0.35), lineWidth: 1)
        )
    }
}
