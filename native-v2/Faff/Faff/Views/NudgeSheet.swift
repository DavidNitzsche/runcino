//
//  NudgeSheet.swift
//  Coach proposal surface (2026-07-06 · repurposed per David's pick).
//  When `proposal` is set, the sheet presents one pending adapter
//  proposal (plan_workout_proposals): THE CHANGE + the one-line why +
//  LET IT HAPPEN / KEEP ORIGINAL, wired by TodayView to the accept /
//  dismiss endpoints. Without a proposal it stays the readiness
//  morning check with a single Got it dismiss.
//

import SwiftUI

struct NudgeSheet: View {
    let onAccept: () -> Void
    let onKeep: () -> Void
    var readiness: ReadinessSnapshot? = nil
    var healthFacts: CoachFactsBlock? = nil
    /// Pending adapter proposal · flips the sheet from morning check to
    /// proposal review (THE CHANGE section + accept/keep actions).
    var proposal: WorkoutProposal? = nil

    private let mesh = FaffMesh(
        c1: 0x3FB6B0, c2: 0xF3AD38, c3: 0x0E4F4C,
        c4: 0x155A4A, c5: 0x155A4A, base: 0x0A2622
    )

    @State private var loadedFacts: CoachFactsBlock?

    private var facts: CoachFactsBlock? { healthFacts ?? loadedFacts }

    var body: some View {
        ZStack {
            FaffMeshView(mesh: mesh)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    topLabel
                        .padding(.top, 50)
                        .padding(.horizontal, 24)
                    hero
                        .padding(.top, 22)
                        .padding(.horizontal, 24)

                    // THE CHANGE · renders only with a real pending
                    // plan_workout_proposals row (never a fabricated
                    // "planned → proposed" swap).
                    if let p = proposal {
                        sectionLabel("THE CHANGE")
                            .padding(.top, 26)
                            .padding(.horizontal, 24)
                        changeCard(p)
                            .padding(.top, 14)
                            .padding(.horizontal, 24)
                    }

                    sectionLabel("WHY")
                        .padding(.top, 26)
                        .padding(.horizontal, 24)
                    whyRows
                        .padding(.top, 14)
                        .padding(.horizontal, 24)

                    sectionLabel("FAFF SAYS")
                        .padding(.top, 26)
                        .padding(.horizontal, 24)
                    coachCard
                        .padding(.top, 14)
                        .padding(.horizontal, 24)

                    actions
                        .padding(.top, 26)
                        .padding(.horizontal, 24)
                        .padding(.bottom, 40)
                }
                .task {
                    if healthFacts == nil {
                        loadedFacts = try? await API.fetchCoachFacts(surface: "health")
                    }
                }
            }
        }
    }

    private var topLabel: some View {
        HStack(spacing: 9) {
            Circle().fill(Theme.goal).frame(width: 8, height: 8)
            Text(headerLabel)
                .font(.label(13)).tracking(2.5)
                .foregroundStyle(Theme.txt)
            Spacer()
        }
    }

    private var headerLabel: String {
        let f = DateFormatter(); f.dateFormat = "EEE"
        let dow = f.string(from: Date()).uppercased()
        return proposal != nil ? "COACH PROPOSAL · \(dow)" : "MORNING CHECK · \(dow)"
    }

    // MARK: - The change (adapter proposal)

    /// Concrete swap the adapter proposes · workout day + one-line action.
    private func changeCard(_ p: WorkoutProposal) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(changeDayLabel(p.workoutDateISO).uppercased())
                .font(.label(11)).tracking(2)
                .foregroundStyle(Theme.txt.opacity(0.66))
            Text(changeHeadline(p))
                .font(.display(20, weight: .bold))
                .tracking(-0.5)
                .foregroundStyle(Theme.txt)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
            .stroke(Theme.Glass.line, lineWidth: 1))
    }

    private func changeHeadline(_ p: WorkoutProposal) -> String {
        switch p.actionKind {
        case "downgrade":
            return "Run \(p.newType ?? "easy") instead."
        case "reschedule":
            if let nd = p.newDate, !nd.isEmpty {
                return "Move to \(changeDayLabel(nd))."
            }
            return "Move the session."
        case "shave":
            if let f = p.shaveFraction, f > 0 {
                return "Trim \(Int((f * 100).rounded()))% off the distance."
            }
            return "Trim the distance."
        default:
            return "Adjust the session."
        }
    }

    private func changeDayLabel(_ iso: String) -> String {
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"
        guard let d = df.date(from: iso) else { return iso }
        let out = DateFormatter(); out.dateFormat = "EEEE MMM d"
        return out.string(from: d)
    }

    private var hero: some View {
        let score = readiness?.score ?? 0
        let label = (readiness?.label ?? ReadinessRing.classify(score) ?? "—").uppercased()
        let frac = Double(max(0, min(100, score))) / 100.0
        return HStack(spacing: 18) {
            ZStack {
                Circle()
                    .stroke(Color.white.opacity(0.16), lineWidth: 7)
                Circle()
                    .trim(from: 0, to: CGFloat(frac))
                    .stroke(score < 65 ? Theme.warnText : Theme.green,
                            style: StrokeStyle(lineWidth: 7, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 5) {
                    Text(score > 0 ? "\(score)" : "—")
                        .font(.display(36, weight: .bold))
                        .tracking(-1.5)
                        .foregroundStyle(Theme.txt)
                    Text(label)
                        .font(.label(8)).tracking(2)
                        .foregroundStyle(score < 65 ? Color(hex: 0xF3AD38) : Theme.Accent.mintReady)
                }
            }
            .frame(width: 104, height: 104)

            VStack(alignment: .leading, spacing: 0) {
                Text("READINESS")
                    .font(.label(11)).tracking(2)
                    .foregroundStyle(Theme.txt.opacity(0.66))
                Text(readinessHeadline)
                    .font(.display(20, weight: .bold))
                    .tracking(-0.5)
                    .foregroundStyle(Theme.txt)
                    .lineSpacing(-2)
                    .padding(.top, 8)
                    .multilineTextAlignment(.leading)
            }
            Spacer()
        }
    }

    private var readinessHeadline: String {
        let score = readiness?.score ?? 0
        switch score {
        case 80...: return "Primed for the work."
        case 65..<80: return "Hold the plan."
        case 50..<65: return "Ease the targets today."
        case 1..<50: return "Recover. Don't push."
        default: return "Awaiting your first sample."
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        HStack {
            SpecLabel(text: text, color: Theme.txt.opacity(0.6))
            Spacer()
        }
    }

    /// Driven by /api/readiness inputs[] when available. The whys array is
    /// derived live · no hardcoded placeholders. When readiness isn't loaded
    /// yet (cold start), the section renders an empty state placeholder.
    private var whyRows: some View {
        let rows = readiness?.inputs ?? []
        return Group {
            if rows.isEmpty {
                Text("Pulling your readiness signal.")
                    .font(.body(13, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.5))
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(spacing: 13) {
                    ForEach(rows) { r in
                        whyRow(r)
                    }
                }
            }
        }
    }

    /// One readiness-input row · key on the left, divergence bar in the middle,
    /// numeric observed value on the right. Bar is signed: negative weight
    /// lobes LEFT and tints amber; positive weight lobes RIGHT and tints mint.
    /// Bar magnitude maxes out at |weight|=25 (saturates beyond).
    @ViewBuilder
    private func whyRow(_ r: ReadinessInput) -> some View {
        let bad = r.weight < 0
        let magnitude = min(1.0, Double(abs(r.weight)) / 25.0)
        HStack(spacing: 12) {
            Text(r.key.uppercased())
                .font(.body(11, weight: .bold))
                .foregroundStyle(Theme.txt.opacity(0.7))
                .frame(width: 52, alignment: .leading)
            GeometryReader { geo in
                let w = geo.size.width
                let half = w / 2
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.1)).frame(height: 8)
                    // Center divider tick.
                    Rectangle()
                        .fill(Color.white.opacity(0.3))
                        .frame(width: 1, height: 10)
                        .position(x: half, y: 4)
                    // Signed bar lobe · pushes left or right from center.
                    Capsule()
                        .fill(bad ? Theme.goal : Theme.green)
                        .frame(width: w * 0.5 * CGFloat(magnitude), height: 8)
                        .offset(x: bad ? (half - w * 0.5 * CGFloat(magnitude)) : half)
                }
            }
            .frame(height: 8)
            Text(r.observedV ?? "—")
                .font(.body(11, weight: .bold))
                .foregroundStyle(bad ? Color(hex: 0xF3AD38) : Theme.txt)
                .frame(width: 80, alignment: .trailing)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }

    private var coachCard: some View {
        HStack(alignment: .top, spacing: 11) {
            Text("COACH")
                .font(.label(9)).tracking(1)
                .foregroundStyle(Theme.Accent.mintReady)
                .padding(.horizontal, 7).padding(.vertical, 4)
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(Theme.Accent.mintGlow.opacity(0.4), lineWidth: 1))
                .padding(.top, 2)
            Text(coachMessage)
                .font(.body(16, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.94))
                .lineSpacing(4)
            Spacer(minLength: 0)
        }
    }

    /// Pull the meaning from the worst (most-negative-weight) input the
    /// readiness endpoint surfaced. Falls back to a generic line keyed off
    /// the score band when we don't have inputs yet. Always honest · no
    /// fabricated "intervals" copy when the runner isn't doing intervals.
    private var coachMessage: String {
        // Proposal review · the adapter's one-line why IS the coach line.
        // Falls back to the trigger reason when the payload carried none.
        if let p = proposal {
            if let why = p.why, !why.isEmpty { return why }
            if !p.reason.isEmpty { return p.reason }
        }
        if let worst = (readiness?.inputs ?? []).min(by: { $0.weight < $1.weight }),
           worst.weight < 0 {
            return worst.meaning
        }
        switch (readiness?.score ?? 0) {
        case 80...: return "Your body is primed. Run the plan."
        case 65..<80: return "Solid recovery. Hold the targets and trust the plan."
        case 50..<65: return "Borderline. Ease off and listen as you go."
        case 1..<50: return "Pull back today. Easy miles or a rest day · the work compounds when you recover."
        default: return "Awaiting your first health sample. Connect your watch to see your readiness."
        }
    }

    @ViewBuilder
    private var actions: some View {
        if proposal != nil {
            // Proposal review · the runner gates the plan change.
            // Accept applies via /api/plan/workout-proposals/:id/accept;
            // keep dismisses via /:id/dismiss. Wiring lives in TodayView.
            VStack(spacing: 12) {
                Button(action: onAccept) {
                    Text("LET IT HAPPEN")
                        .font(.body(15, weight: .extraBold)).tracking(1)
                        .foregroundStyle(Color(hex: 0x06302A))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 17)
                        .background(Theme.green,
                                    in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .shadow(color: Theme.green.opacity(0.5), radius: 30, y: 12)
                }
                .buttonStyle(.plain)
                Button(action: onKeep) {
                    Text("KEEP ORIGINAL")
                        .font(.body(15, weight: .extraBold)).tracking(1)
                        .foregroundStyle(Theme.txt)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 17)
                        .background(Theme.Glass.fill,
                                    in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(Theme.Glass.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        } else {
            // Morning check · single Got it dismiss. The accept / decline
            // pair only makes sense with a real proposal to choose between.
            Button(action: onKeep) {
                Text("Got it")
                    .font(.body(16, weight: .extraBold))
                    .foregroundStyle(Color(hex: 0x06302A))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 17)
                    .background(Theme.green,
                                in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .shadow(color: Theme.green.opacity(0.5), radius: 30, y: 12)
            }
            .buttonStyle(.plain)
        }
    }
}
