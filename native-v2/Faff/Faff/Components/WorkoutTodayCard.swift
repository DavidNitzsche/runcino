//
//  WorkoutTodayCard.swift
//
//  iPhone-side render of the structured workout payload — the same JSON
//  the watch decodes from /api/watch/today. Shows the runner what they
//  are actually about to do (warmup → reps + recoveries → cooldown)
//  WITHOUT requiring them to read the coach's prose.
//
//  Color semantics match web's workout-detail modal:
//    · Warmup / Cooldown → cool blue   (Theme.dist)
//    · Rep (work)        → amber/gold  (Theme.goal)
//    · Recovery          → purple      (Theme.learn)
//    · Race              → orange      (Theme.race)
//
//  Recovery phases between reps fold into the rep block visually (the
//  REPEAT block on web). The card collapses consecutive (work,rec) pairs
//  into a single "REPEAT N×" header for readability.
//

import SwiftUI

struct WorkoutTodayCard: View {
    let workout: WatchWorkout

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            phasesList
            footer
        }
        .padding(18)
        .background(Theme.card)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.rCard)
                .stroke(Theme.line, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
        .padding(.horizontal, 24)
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(workout.name.uppercased())
                    .font(.display(22))
                    .tracking(0.8)
                    .foregroundStyle(Theme.ink)
                Spacer()
                if let paceLabel = workout.paceLabel, !paceLabel.isEmpty {
                    Text(paceLabel)
                        .font(.label(11))
                        .tracking(1.4)
                        .foregroundStyle(paceLabelColor(for: paceLabel))
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(paceLabelColor(for: paceLabel).opacity(0.14))
                        .overlay(Capsule().stroke(paceLabelColor(for: paceLabel).opacity(0.35), lineWidth: 1))
                        .clipShape(Capsule())
                }
            }
            Text(workout.summary)
                .font(.body(13))
                .foregroundStyle(Theme.ink.opacity(0.78))
                .lineSpacing(2)
        }
    }

    // MARK: - Phases

    private var phasesList: some View {
        VStack(spacing: 8) {
            ForEach(collapsedBlocks(), id: \.id) { block in
                switch block.kind {
                case .single(let p):
                    PhaseRow(phase: p)
                case .repeats(let reps, let work, let rec):
                    RepeatBlock(reps: reps, work: work, recovery: rec)
                }
            }
        }
    }

    // MARK: - Footer

    private var footer: some View {
        HStack(spacing: 14) {
            footerStat(label: "TOTAL", value: "\(workout.totalEstimatedMinutes) min")
            if let mi = workout.distanceMi {
                footerStat(label: "DISTANCE", value: String(format: "%.1f mi", mi))
            }
            if let hr = workout.hrCeilingBpm {
                footerStat(label: "HR CEIL", value: "< \(hr) bpm")
            }
            Spacer()
        }
        .padding(.top, 4)
    }

    private func footerStat(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.label(9)).tracking(1.4)
                .foregroundStyle(Theme.mute)
            Text(value).font(.display(15)).foregroundStyle(Theme.ink)
        }
    }

    // MARK: - Block model
    // We walk phases left-to-right and group consecutive (work,rec,work,rec,...,work)
    // sequences with the same rep label-prefix into a single "REPEAT N×" block.

    private enum BlockKind {
        case single(WatchPhase)
        case repeats(count: Int, work: WatchPhase, recovery: WatchPhase?)
    }
    private struct Block { let id: Int; let kind: BlockKind }

    private func collapsedBlocks() -> [Block] {
        var out: [Block] = []
        let phs = workout.phases
        var i = 0
        var blockId = 0
        while i < phs.count {
            // Greedy match: 1+ consecutive work phases that all start with "Rep "
            // and look identical (same distance / pace / duration), interleaved
            // with optional recoveries — collapse to a single repeats block.
            let first = phs[i]
            if first.type == .work && first.label.hasPrefix("Rep ") {
                var reps = 1
                var j = i + 1
                var recovery: WatchPhase? = nil
                while j < phs.count {
                    if phs[j].type == .recovery {
                        if recovery == nil { recovery = phs[j] }
                        j += 1
                        continue
                    }
                    if phs[j].type == .work && phs[j].label.hasPrefix("Rep ") &&
                       phs[j].durationSec == first.durationSec &&
                       phs[j].targetPaceSPerMi == first.targetPaceSPerMi {
                        reps += 1
                        j += 1
                        continue
                    }
                    break
                }
                if reps > 1 {
                    out.append(Block(id: blockId, kind: .repeats(count: reps, work: first, recovery: recovery)))
                    blockId += 1
                    i = j
                    continue
                }
            }
            out.append(Block(id: blockId, kind: .single(first)))
            blockId += 1
            i += 1
        }
        return out
    }

    // Web's "T → goal, I → learn (purple), E → ink, R → race" mapping.
    private func paceLabelColor(for label: String) -> Color {
        switch label.uppercased() {
        case "T":       return Theme.goal     // threshold
        case "I":       return Theme.learn    // intervals
        case "R":       return Theme.race     // race
        case "M":       return Theme.race     // marathon-pace tempo
        case "L":       return Theme.dist     // long
        case "E":       return Theme.dist     // easy
        default:        return Theme.mute
        }
    }
}

// MARK: - Single phase row

private struct PhaseRow: View {
    let phase: WatchPhase

    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 3)
                .fill(accent)
                .frame(width: 4)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(phase.label.uppercased())
                        .font(.label(11))
                        .tracking(1.2)
                        .foregroundStyle(accent)
                    Spacer()
                    Text(durationText)
                        .font(.body(12, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                }
                HStack(spacing: 10) {
                    if let mi = phase.distanceMi {
                        statChip(String(format: "%.1f mi", mi))
                    }
                    if let target = phase.targetPaceSPerMi {
                        statChip("\(PaceFormat.mmss(target))/mi")
                    }
                    if let tol = phase.tolerancePaceSPerMi {
                        statChip("±\(tol)s")
                    }
                    Spacer()
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(accent.opacity(0.06))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(accent.opacity(0.18), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private var accent: Color {
        switch phase.type {
        case .warmup, .cooldown: return Theme.dist
        case .work:              return Theme.goal
        case .recovery:          return Theme.learn
        }
    }

    private var durationText: String {
        PaceFormat.clock(phase.durationSec)
    }

    private func statChip(_ text: String) -> some View {
        Text(text)
            .font(.body(11))
            .foregroundStyle(Theme.ink.opacity(0.78))
    }
}

// MARK: - REPEAT block (N reps with optional recovery between)

private struct RepeatBlock: View {
    let reps: Int
    let work: WatchPhase
    let recovery: WatchPhase?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("REPEAT \(reps)×")
                    .font(.label(11))
                    .tracking(1.4)
                    .foregroundStyle(Theme.ink.opacity(0.62))
                Spacer()
            }
            // Reps box (gold)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text("REP")
                        .font(.label(11))
                        .tracking(1.2)
                        .foregroundStyle(Theme.goal)
                    Spacer()
                    Text(PaceFormat.clock(work.durationSec))
                        .font(.body(12, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                }
                HStack(spacing: 10) {
                    if let mi = work.distanceMi {
                        Text(String(format: "%.1f mi", mi))
                            .font(.body(11)).foregroundStyle(Theme.ink.opacity(0.78))
                    }
                    if let target = work.targetPaceSPerMi {
                        Text("\(PaceFormat.mmss(target))/mi")
                            .font(.body(11)).foregroundStyle(Theme.ink.opacity(0.78))
                    }
                    if let tol = work.tolerancePaceSPerMi {
                        Text("±\(tol)s")
                            .font(.body(11)).foregroundStyle(Theme.ink.opacity(0.78))
                    }
                    Spacer()
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(Theme.goal.opacity(0.08))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.goal.opacity(0.22), lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 10))

            // Recovery (purple) — only when present
            if let rec = recovery {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("RECOVERY")
                            .font(.label(11))
                            .tracking(1.2)
                            .foregroundStyle(Theme.learn)
                        Spacer()
                        Text(PaceFormat.clock(rec.durationSec))
                            .font(.body(12, weight: .semibold))
                            .foregroundStyle(Theme.ink)
                    }
                    Text("easy jog between reps")
                        .font(.body(11))
                        .foregroundStyle(Theme.ink.opacity(0.65))
                }
                .padding(.horizontal, 14).padding(.vertical, 12)
                .background(Theme.learn.opacity(0.08))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.learn.opacity(0.22), lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
        .padding(.leading, 8) // indent so the REPEAT block reads as nested
    }
}
