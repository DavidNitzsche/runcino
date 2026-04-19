import SwiftUI
import WorkoutKit

struct PlanView: View {
    let plan: RuncinoPlan
    @State private var syncState: SyncState = .idle
    @State private var errorText: String?

    enum SyncState {
        case idle, preparing, presented, synced
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let brief = plan.brief { briefCard(brief) }
                phaseList
                fuelingCard
                landmarksCard
                syncCard
                Spacer(minLength: 24)
            }
            .padding(16)
        }
        .background(Color(.systemGroupedBackground))
        .alert("Sync failed", isPresented: .constant(errorText != nil)) {
            Button("OK") { errorText = nil }
        } message: {
            Text(errorText ?? "")
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(plan.race.name)
                .font(.system(size: 28, weight: .medium, design: .serif))
                .lineLimit(2)
            HStack {
                Text(plan.goal.finishTimeDisplay)
                    .font(.system(size: 44, weight: .regular, design: .serif))
                    .italic()
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(String(format: "%.2f", plan.race.distanceMi)) mi")
                        .font(.callout)
                    Text("+\(plan.race.totalGainFt) / −\(plan.race.totalLossFt) ft")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 8)
    }

    // MARK: - Brief

    private func briefCard(_ brief: RuncinoPlan.Brief) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Race-morning brief", systemImage: "sparkles")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .kerning(1.2)
            Text(brief.narrative)
                .font(.callout)
            if !brief.planAdjustments.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(brief.planAdjustments) { adj in
                        HStack {
                            Text("Phase \(adj.phaseIdx + 1):")
                                .font(.caption.weight(.semibold))
                            Text("\(adj.paceDeltaSPerMi >= 0 ? "+" : "")\(adj.paceDeltaSPerMi) sec/mi — \(adj.reason)")
                                .font(.caption)
                        }
                        .foregroundStyle(.secondary)
                    }
                }
                .padding(.top, 4)
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.primary))
        .foregroundColor(Color(.systemBackground))
    }

    // MARK: - Phases

    private var phaseList: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Phases · \(plan.phases.count)")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .kerning(1.2)
                .padding(.leading, 4)

            VStack(spacing: 0) {
                ForEach(plan.phases) { phase in
                    PhaseRow(phase: phase, tolerance: plan.tolerance.paceSPerMi)
                    if phase.index != plan.phases.count - 1 {
                        Divider().padding(.leading, 48)
                    }
                }
            }
            .background(RoundedRectangle(cornerRadius: 16).fill(Color(.systemBackground)))
        }
    }

    // MARK: - Fueling

    private var fuelingCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Fueling", systemImage: "drop.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .kerning(1.2)
            HStack {
                Text("\(plan.fueling.gelCount) × \(plan.fueling.gelBrand) \(plan.fueling.gelCarbsG)g")
                    .font(.callout.weight(.medium))
                Spacer()
                Text("\(plan.fueling.totalCarbsG)g carbs")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Text(plan.fueling.notes)
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color(.systemBackground)))
    }

    // MARK: - Landmarks

    private var landmarksCard: some View {
        let landmarkIntervals = plan.intervals.compactMap { iv -> RuncinoPlan.LandmarkInterval? in
            if case .landmark(let l) = iv { return l } else { return nil }
        }
        return VStack(alignment: .leading, spacing: 8) {
            Label("Landmarks", systemImage: "mappin.and.ellipse")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .kerning(1.2)
            ForEach(landmarkIntervals, id: \.index) { l in
                HStack {
                    Text("mi \(String(format: "%.1f", l.atMi))")
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 60, alignment: .leading)
                    Text(l.label).font(.callout)
                }
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color(.systemBackground)))
    }

    // MARK: - Sync

    private var syncCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Apple Watch", systemImage: "applewatch")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .kerning(1.2)
            Text("Sync this plan as a CustomWorkout. The Watch renders it through Apple's native Fitness UI — pace alerts, fueling haptics, landmark pings.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button(action: syncToWatch) {
                HStack {
                    Image(systemName: "arrow.up.forward.app")
                    Text(syncState == .synced ? "Synced to Watch" : "Add to Apple Watch")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(syncState == .synced ? Color.green.opacity(0.6) : Color.orange)
                .foregroundColor(.white)
                .clipShape(Capsule())
            }
            .disabled(syncState == .preparing)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color(.systemBackground)))
    }

    private func syncToWatch() {
        Task {
            syncState = .preparing
            do {
                let workout = try WorkoutBuilder.build(from: plan)
                syncState = .presented
                try await WorkoutScheduler.shared.preview(workout)
                syncState = .synced
            } catch {
                errorText = error.localizedDescription
                syncState = .idle
            }
        }
    }
}

private struct PhaseRow: View {
    let phase: RuncinoPlan.Phase
    let tolerance: Int

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(phase.index + 1)")
                .font(.caption.weight(.semibold))
                .frame(width: 24, height: 24)
                .background(Circle().fill(Color.orange.opacity(0.15)))
                .foregroundColor(.orange)

            VStack(alignment: .leading, spacing: 4) {
                Text(phase.label).font(.body.weight(.medium))
                Text("mi \(String(format: "%.1f", phase.startMi))–\(String(format: "%.1f", phase.endMi)) · \(gradeDisplay(phase.meanGradePct)) · ±\(tolerance) sec/mi")
                    .font(.caption).foregroundStyle(.secondary)
                if !phase.note.isEmpty {
                    Text(phase.note).font(.caption).foregroundStyle(.secondary).padding(.top, 2)
                }
            }

            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(phase.targetPaceDisplay)
                    .font(.body.monospacedDigit().weight(.medium))
                Text(phase.cumulativeTimeDisplay)
                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
        .padding(16)
    }

    private func gradeDisplay(_ g: Double) -> String {
        (g >= 0 ? "+" : "") + String(format: "%.1f", g) + "%"
    }
}

#Preview {
    PlanView(plan: samplePlan())
}

private func samplePlan() -> RuncinoPlan {
    // Minimal sample for Xcode previews
    RuncinoPlan(
        schemaVersion: "1.1.0",
        generatedAt: "2026-04-19T00:00:00Z",
        generator: "runcino-preview",
        race: .init(name: "Big Sur Marathon", date: "2026-04-26",
                    distanceMi: 26.22, distanceM: 42195,
                    totalGainFt: 2182, totalLossFt: 2528),
        goal: .init(finishTimeS: 13800, finishTimeDisplay: "3:50:00",
                    strategy: "even_effort", flatPaceSPerMi: 526,
                    warmup: .init(enabled: false, distanceMi: 0, paceSPerMi: nil),
                    claudeRationale: nil),
        fitnessSummary: .init(baselineRace: nil, weeklyMileage: nil,
                              weeklyMileageTrend6Wk: nil,
                              longestRecentLongRunMi: nil,
                              longestRecentLongRunAgeWk: nil,
                              restingHrBpm: nil, restingHrTrend8Wk: nil,
                              age: nil, weightLb: nil, source: "manual"),
        tolerance: .init(paceSPerMi: 10),
        phases: [
            .init(index: 0, label: "Redwood descent", startMi: 0, endMi: 5,
                  distanceMi: 5, targetPaceSPerMi: 520, targetPaceDisplay: "8:40/mi",
                  meanGradePct: -0.8, elevationGainFt: 95, elevationLossFt: 275,
                  cumulativeTimeS: 2600, cumulativeTimeDisplay: "0:43:20",
                  note: "Fresh legs — hold back.")
        ],
        intervals: [],
        fueling: .init(carbTargetGPerHr: 60, totalCarbsG: 240, gelCount: 6,
                       gelCarbsG: 40, gelBrand: "Maurten",
                       notes: "Anchored to phase boundaries."),
        brief: nil
    )
}
