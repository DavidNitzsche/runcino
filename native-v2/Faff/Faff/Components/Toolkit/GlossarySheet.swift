//
//  GlossarySheet.swift
//  Tap-to-explain bottom sheet for physiology + training-load terms.
//  Definitions mirror web lib/glossary.ts — local, no network call.
//

import SwiftUI

// MARK: - Entry

struct GlossaryEntry: Identifiable {
    let id: String
    let term: String
    let def: String
    let cite: String?

    static let catalog: [String: GlossaryEntry] = [
        "vdot": GlossaryEntry(
            id: "vdot",
            term: "VDOT",
            def: "Jack Daniels' aerobic fitness index, derived from race performance. It sets your training paces — Easy, Marathon, Threshold, Interval, and Repetition. A higher VDOT means faster target paces across all zones.",
            cite: "Daniels' Running Formula"
        ),
        "hrv": GlossaryEntry(
            id: "hrv",
            term: "Heart rate variability",
            def: "The millisecond variation between heartbeats. Higher HRV relative to your personal baseline means your nervous system has recovered. A single reading means little — the trend against your own history is what matters.",
            cite: "HealthKit · Apple Watch"
        ),
        "acwr": GlossaryEntry(
            id: "acwr",
            term: "Acute:Chronic Workload Ratio",
            def: "This week's mileage divided by your 4-week rolling average. Sweet spot is 0.8–1.3. Above 1.5 is a spike with sharply elevated injury risk. Below 0.8 signals detraining.",
            cite: "Gabbett 2016 · Br J Sports Med"
        ),
        "lthr": GlossaryEntry(
            id: "lthr",
            term: "Lactate Threshold Heart Rate",
            def: "The heart rate you can sustain for roughly 60 minutes all-out. All your training zones derive from it. Best anchored by a half-marathon or marathon race with clean HR data.",
            cite: "Friel · The Triathlete's Training Bible"
        ),
        "tsb": GlossaryEntry(
            id: "tsb",
            term: "Form score (Training Stress Balance)",
            def: "Fitness minus Fatigue. A score of −10 to −20 is normal during a build — you are carrying load. A score of +5 to +15 is the target window for race day: fit and fresh.",
            cite: "Banister performance model"
        ),
        "hrmax": GlossaryEntry(
            id: "hrmax",
            term: "Maximum heart rate",
            def: "The upper ceiling of your aerobic system. Used to set every HR training zone when LTHR is not available. Best observed from a high-effort interval or race — formula estimates are often 10–15 bpm off.",
            cite: nil
        ),
        "rhr": GlossaryEntry(
            id: "rhr",
            term: "Resting heart rate",
            def: "Your morning baseline pulse, read from Apple Watch before you get up. A rising RHR alongside a falling HRV signals under-recovery. Lower is generally better for aerobic athletes, though normal ranges vary widely.",
            cite: "HealthKit · Apple Watch"
        ),
    ]

    static func entry(for key: String) -> GlossaryEntry? {
        catalog[key.lowercased()]
    }
}

// MARK: - Sheet

struct GlossarySheet: View {
    let entry: GlossaryEntry

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color(hex: 0x0D1117).ignoresSafeArea()

            VStack(alignment: .leading, spacing: 0) {
                SpecLabel(text: "GLOSSARY", size: 11, tracking: 2.2, color: Theme.mute)
                    .padding(.top, 28)

                Text(entry.term)
                    .font(.display(30, weight: .bold))
                    .tracking(-0.8)
                    .foregroundStyle(Theme.txt)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 12)

                Text(entry.def)
                    .font(.body(15, weight: .regular))
                    .foregroundStyle(Theme.txt.opacity(0.82))
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 14)

                if let cite = entry.cite {
                    Text(cite)
                        .font(.body(12, weight: .medium))
                        .foregroundStyle(Theme.mute)
                        .padding(.top, 12)
                }

                Spacer()
            }
            .padding(.horizontal, 24)
        }
        .presentationDetents([.medium])
    }
}
