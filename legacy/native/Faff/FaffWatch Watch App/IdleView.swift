//
//  IdleView.swift
//  FaffWatch
//
//  Pre-run launchpad — what you're about to do, then START.
//  Rendered through the new LobbyFace (Faces.swift) so it shares the locked
//  Helvetica/Faff grammar with the in-run faces. Same three-row layout
//  whether today is easy / threshold / long / race: the VALUES communicate
//  the workout type, the structure stays consistent.
//
//    · top tag      → workout name ("EASY", "5×7", "BIG SUR")
//    · row 1        → distance  (blue · canonical)
//    · row 2        → pace      (green · live)
//    · row 3        → time      (white · est minutes OR race goal time)
//    · bottom       → green START capsule
//

import SwiftUI

struct IdleView: View {
    let workout: WatchWorkout
    let onStart: () -> Void

    var body: some View {
        // Authored against the Ultra canvas; ResponsiveFace scales it to any watch.
        ResponsiveFace {
            LobbyFace(
                name:          tagText,
                distance:      distanceText,
                pace:          paceText,
                time:          timeText,
                paceRange:     paceRangeText,
                showTimeIcon:  !workout.isRace,   // races already h:mm — no glyph needed
                onStart:       onStart
            )
        }
    }

    /// "EASY" / "5×7" / "BIG SUR" — short identity tag. Falls back to the
    /// raw workout name; we expand single-letter zone codes ("T" → "THRESHOLD")
    /// only when the *name* itself is one letter.
    private var tagText: String {
        let n = workout.name.uppercased()
        // If the name is one of the bare zone codes (older payloads), expand it.
        if n.count == 1, ["E", "M", "T", "I", "R"].contains(n) {
            return Self.expandZone(n).uppercased()
        }
        return n
    }

    /// Distance: race miles take 1 decimal ("26.2"), workout miles same ("5.8").
    private var distanceText: String {
        workout.distanceMi.map { String(format: "%.1f", $0) } ?? "—"
    }

    /// Pace: the first work phase's target — the pace you're chasing today.
    /// For a race that's the opening course phase; for a workout it's the rep
    /// target. For a no-target run (recovery / shakeout), we surface "—:—".
    private var paceText: String {
        let workPace = workout.phases.first(where: { $0.type == .work })?.targetPaceSPerMi
        return workPace.map { PaceFormat.mmss($0) } ?? "—:—"
    }

    /// Time formatting:
    ///   · race goal: always h:mm ("3:50")
    ///   · workout < 60 min:  bare minutes ("45")
    ///   · workout ≥ 60 min:  h:mm  ("1:41")
    /// The bare-integer form past an hour ("101") reads as "101 of what?";
    /// h:mm is unambiguous time. Sub-hour stays as bare minutes because
    /// "0:45" is harder to scan than "45".
    private var timeText: String {
        if workout.isRace, let goal = workout.goalSec {
            return PaceFormat.hm(goal)
        }
        let min = workout.totalEstimatedMinutes
        if min >= 60 { return PaceFormat.hm(min * 60) }
        return "\(min)"
    }

    /// Pace range subtitle ("8:29-8:59") for easy/long runs where the
    /// prescribed pace is a BAND, not a single target. Computed from the
    /// first work phase's `targetPaceSPerMi ± tolerancePaceSPerMi`. Returns
    /// nil when no tolerance is set (race phases, sub_threshold work, etc.)
    /// so the lobby falls back to the single midpoint reading.
    private var paceRangeText: String? {
        guard
            let work = workout.phases.first(where: { $0.type == .work }),
            let target = work.targetPaceSPerMi,
            let tol = work.tolerancePaceSPerMi,
            tol > 0
        else { return nil }
        let lo = target - tol
        let hi = target + tol
        return "\(PaceFormat.mmss(lo))-\(PaceFormat.mmss(hi))"
    }

    /// "T" → "Threshold", "E" → "Easy", etc. Older payloads occasionally name
    /// a workout with the bare zone code; the lobby reads better with the word.
    private static func expandZone(_ code: String) -> String {
        switch code.uppercased() {
        case "E": return "Easy"
        case "M": return "Marathon"
        case "T": return "Threshold"
        case "I": return "Intervals"
        case "R": return "Strides"
        default:  return code
        }
    }
}

#Preview { IdleView(workout: .sample) { } }
#Preview("Race") { IdleView(workout: .sampleRace) { } }
