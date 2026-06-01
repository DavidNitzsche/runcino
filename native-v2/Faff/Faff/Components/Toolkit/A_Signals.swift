//
//  A_Signals.swift
//  Family A · Signals & Status atoms from the Faff Component Toolkit.
//
//  Components: EffortDot · LoadBandChip · RaceStatusDot · DayStatePill.
//
//  These are pure presentational atoms. Color comes from Theme; never
//  re-tint per surface. Numerics use Oswald monospaced digits.
//
//  Doctrine (README §Legibility):
//    1. Earn contrast on the mesh · these chips ride dark glass.
//    2. Secondary text uses Theme.mute, never an opacity fade.
//    3. Effort + heat colors color the DOT or BORDER, not the sentence.
//    4. 4.5:1 floor on body, 3:1 on chip text.
//

import SwiftUI

// MARK: - EffortDot
//
// Atom. The single source of effort color across iOS + web.
// Renders as a dot + label chip. Pass the effort key; render uses
// the canonical FaffEffort.dot color so a future palette tweak
// propagates everywhere.

struct EffortDot: View {
    let effort: FaffEffort
    var label: String? = nil

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(effort.dot)
                .frame(width: 8, height: 8)
            Text(label ?? effort.effortLabel)
                .font(.body(11, weight: .semibold))
                .tracking(0.4)
                .foregroundStyle(Theme.txt)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Theme.Glass.fill, in: Capsule())
        .overlay(Capsule().stroke(effort.dot.opacity(0.45), lineWidth: 1))
    }
}

// MARK: - LoadBandChip
//
// ACWR sweet-spot signal. Best leading indicator of overreach per
// Gabbett. Maps the numeric ACWR onto one of five bands and tints
// the chip + dot accordingly. The chip text is the lead, NEVER tinted
// (legibility law 3) — the dot + border carry the band color.
//
// Bands:
//   detraining   < 0.8   · amber
//   building     0.8–1.0 · green
//   sweet spot   1.0–1.3 · green
//   elevated     1.3–1.5 · amber
//   spike        > 1.5   · over

enum LoadBand: String {
    case detraining, building, sweet, elevated, spike, unknown

    static func from(acwr: Double?) -> LoadBand {
        guard let a = acwr, a > 0 else { return .unknown }
        if a < 0.8 { return .detraining }
        if a < 1.0 { return .building }
        if a <= 1.3 { return .sweet }
        if a <= 1.5 { return .elevated }
        return .spike
    }

    var label: String {
        switch self {
        case .detraining: return "Load · detraining"
        case .building:   return "Load · building"
        case .sweet:      return "Load · sweet spot"
        case .elevated:   return "Load · elevated"
        case .spike:      return "Load · spike · ease off"
        case .unknown:    return "Load · —"
        }
    }
    var color: Color {
        switch self {
        case .building, .sweet:        return Theme.green
        case .detraining, .elevated:   return Theme.goal
        case .spike:                   return Theme.over
        case .unknown:                 return Theme.mute
        }
    }
}

struct LoadBandChip: View {
    let band: LoadBand
    var loading: Bool = false

    var body: some View {
        if loading {
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.white.opacity(0.08))
                    .frame(width: 96, height: 11)
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Theme.Glass.fill, in: Capsule())
            .overlay(Capsule().stroke(Theme.Glass.line, lineWidth: 1))
        } else {
            HStack(spacing: 6) {
                Circle().fill(band.color).frame(width: 8, height: 8)
                Text(band.label)
                    .font(.body(11, weight: .semibold))
                    .tracking(0.4)
                    .foregroundStyle(Theme.txt)
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Theme.Glass.fill, in: Capsule())
            .overlay(Capsule().stroke(band.color.opacity(0.40), lineWidth: 1))
        }
    }
}

// MARK: - RaceStatusDot
//
// Race header status: deterministic on_track / watch / off, with a
// one-line reason. Pair the dot with reason copy; the chip alone
// without copy is ambiguous.

enum RaceStatus: String, Decodable {
    case on_track, watch, off, unknown

    var label: String {
        switch self {
        case .on_track: return "On track"
        case .watch:    return "Watch"
        case .off:      return "Off track"
        case .unknown:  return "Status pending"
        }
    }
    var color: Color {
        switch self {
        case .on_track: return Theme.green
        case .watch:    return Theme.goal
        case .off:      return Theme.over
        case .unknown:  return Theme.mute
        }
    }
}

struct RaceStatusDot: View {
    let status: RaceStatus
    let reason: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 6) {
                Circle().fill(status.color).frame(width: 8, height: 8)
                Text(status.label)
                    .font(.body(11, weight: .semibold))
                    .tracking(0.4)
                    .foregroundStyle(Theme.txt)
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Theme.Glass.fill, in: Capsule())
            .overlay(Capsule().stroke(status.color.opacity(0.4), lineWidth: 1))

            if let r = reason, !r.isEmpty {
                Text(r)
                    .font(.body(12, weight: .medium))
                    .foregroundStyle(Theme.txt.opacity(0.80))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: - DayStatePill
//
// Two locked surfaces (per design spec):
//   missed       · yesterday's planned workout silently no-showed.
//                  Offer three recoveries: log effort, skip it, carry forward.
//   done_ease_off · runner hit yesterday's session but it cost them.
//                   Single action: "take tomorrow easy".

enum DayStateAction: Hashable {
    case logEffort, skipIt, carryForward, takeTomorrowEasy
}

struct DayStatePill: View {
    enum Variant { case missed, doneEaseOff }
    let variant: Variant
    let workoutLabel: String     // "Yesterday's tempo" / "5×800m"
    let onAction: (DayStateAction) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 9) {
                Text(tagText)
                    .font(.body(10, weight: .extraBold))
                    .tracking(1.4).textCase(.uppercase)
                    .foregroundStyle(Theme.txt)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(tagColor.opacity(0.20), in: Capsule())
                    .overlay(Capsule().stroke(tagColor.opacity(0.55), lineWidth: 1))
                Text(workoutLabel)
                    .font(.body(13, weight: .semibold))
                    .foregroundStyle(Theme.txt)
                Spacer(minLength: 0)
            }
            HStack(spacing: 8) {
                ForEach(actions, id: \.label) { a in
                    Button { onAction(a.action) } label: {
                        Text(a.label)
                            .font(.body(11, weight: .extraBold))
                            .tracking(0.6)
                            .foregroundStyle(Theme.txt)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(Theme.Glass.fill, in: Capsule())
                            .overlay(Capsule().stroke(Theme.Glass.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: Theme.rCard, style: .continuous)
                .fill(Color.black.opacity(0.32))
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.rCard, style: .continuous)
                .stroke(tagColor.opacity(0.30), lineWidth: 1)
        )
    }

    private var tagText: String {
        switch variant { case .missed: return "Missed"; case .doneEaseOff: return "Eased" }
    }
    private var tagColor: Color {
        switch variant { case .missed: return Theme.over; case .doneEaseOff: return Theme.goal }
    }
    private var actions: [(label: String, action: DayStateAction)] {
        switch variant {
        case .missed:
            return [
                ("Log effort",    .logEffort),
                ("Skip it",       .skipIt),
                ("Carry forward", .carryForward),
            ]
        case .doneEaseOff:
            return [ ("Take tomorrow easy", .takeTomorrowEasy) ]
        }
    }
}
