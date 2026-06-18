//
//  OnboardingView.swift
//  Welcome → connect → target → profile → confirm. Mesh migrates cool → hot.
//
//  Connect is real: Apple Health drives HealthKitImporter.requestAuthAndImport
//  (genuine permission prompt + import, shows the real imported count), Strava
//  drives the live StravaOAuthSession. Garmin is honestly disabled — there's
//  no Garmin integration yet. Nothing fabricates a count or a projection.
//

import SwiftUI

struct OnboardingView: View {
    let onComplete: () -> Void

    @State private var step: Int = 0
    @State private var mode: TargetMode = .just
    @State private var distance: Distance = .marathon
    @State private var goalSec: Int = 14400
    @State private var raceName: String = ""
    @State private var raceDate: Date = Calendar.current.date(byAdding: .day, value: 112, to: Date()) ?? Date()
    @State private var submitting: Bool = false
    @State private var onboardingError: String? = nil

    // Profile (physiology) — age + sex persist via /onboarding/complete;
    // LTHR (optional, advanced) persists via PATCH /api/profile. RHR is
    // HealthKit-derived (no manual entry), HRmax is estimated from age /
    // set later in Settings (users.max_hr_override) — neither is asked here.
    @State private var birthday: Date = Calendar.current.date(byAdding: .year, value: -30, to: Date()) ?? Date()
    @State private var birthdaySet: Bool = false
    @State private var sex: String? = nil          // "M" | "F"
    @State private var lthrText: String = ""

    // 2026-06-10 · web parity. The iPhone used to send null for all of
    // these — so iPhone plans ignored frequency (6-day plans for a 3-day
    // runner) and had no volume baseline. Now collected + sent so iPhone
    // plans match web quality.
    @State private var weeklyFreq: Int = 4         // 3...6 days/week
    @State private var weeklyMi: Int = 25          // 15/25/35/45/55 mi/week
    @State private var histAvg: String? = nil      // "0-5"|"5-15"|"15-25"|"25-35"|"35+"
    @State private var histLong: String? = nil     // "0-3"|"3-6"|"6-10"|"10+"
    @State private var histYears: String? = nil    // "<1"|"1-3"|"3-7"|"7+"
    @State private var startOffset: Int = 0        // 0=today, 1=tomorrow, 2=in 2 days
    @State private var longRunDay: String = "sun"  // sun..sat

    // Connect state. Apple Health reflects the shared importer; Strava is
    // driven locally off the OAuth round-trip.
    @ObservedObject private var hk: HealthKitImporter = .shared
    @State private var healthTapped: Bool = false
    @State private var stravaState: ConnState = .idle
    @State private var stravaConnecting: Bool = false

    enum ConnState: Equatable { case idle, connecting, connected(String?), failed(String) }

    /// Builds the /api/onboarding/complete payload from the UI state. Only
    /// fields the runner actually set are sent — no defaulted age, no
    /// fabricated history. Nullable fields stay null.
    private var onboardingPayload: [String: Any] {
        let isoF = DateFormatter(); isoF.dateFormat = "yyyy-MM-dd"
        let tz = TimeZone.current.identifier

        let h = goalSec / 3600
        let m = (goalSec % 3600) / 60
        let s = goalSec % 60
        let goalTime = String(format: "%02d:%02d:%02d", h, m, s)

        let distanceCode: String = {
            switch distance {
            case .k5:    return "5k"
            case .k10:   return "10k"
            case .half:  return "half"
            case .marathon: return "marathon"
            }
        }()

        // distance: race → the picked distance; coached → "coached";
        // goal (chase a time, no race) + just → "none". The backend keys
        // the plan path off this.
        let distanceField: String = {
            switch mode {
            case .race:    return distanceCode
            case .coached: return "coached"
            case .goal, .just: return "none"
            }
        }()
        // A plan is authored for everyone except coached.
        let authorsPlan = mode != .coached
        // Goal mode = a time-trial goal (no race). Maps to web's ttDistance
        // + bucketed ttTime (1mi/5k/10k only; goal mode restricts to 5k/10k).
        let ttDistanceField: Any = (mode == .goal) ? ttDistanceCode : NSNull()
        let ttTimeField: Any = (mode == .goal) ? ttBucket(goalSec, distance) : NSNull()
        // Start date the runner picked (today / tomorrow / +2d).
        let startDate = isoF.string(from: Calendar.current.date(byAdding: .day, value: startOffset, to: Date()) ?? Date())

        return [
            "distance": distanceField,
            "date": mode == .race ? isoF.string(from: raceDate) : NSNull(),
            "time": mode == .race ? goalTime : NSNull(),
            "ttDistance": ttDistanceField,
            "ttTime": ttTimeField,
            // Exact goal time (sec) for goal mode — drives the goal-readiness
            // projection precisely instead of the bucketed ttTime midpoint.
            "ttTimeSeconds": (mode == .goal) ? goalSec : NSNull(),
            "weeklyMi": authorsPlan ? weeklyMi : NSNull(),
            "weeklyFreq": authorsPlan ? weeklyFreq : NSNull(),
            "histAvg": (histAvg as Any?) ?? NSNull(),
            "histLong": (histLong as Any?) ?? NSNull(),
            "histYears": (histYears as Any?) ?? NSNull(),
            // Scheduling (web parity) — plan-authoring paths only.
            "startDate": authorsPlan ? startDate : NSNull(),
            "longRunDay": authorsPlan ? longRunDay : NSNull(),
            "name": raceName.isEmpty ? "Goal Race" : raceName,
            "timezone": tz,
            // Physiology — only sent when the runner actually picked them.
            "birthday": birthdaySet ? isoF.string(from: birthday) as Any : NSNull(),
            "sex": sex as Any? ?? NSNull(),
            // Honest connection state: skipped == nothing connected.
            "connectionsSkipped": !anyConnected
        ]
    }

    /// Goal-mode TT distance — restricted to 5k/10k (web TT supports
    /// 1mi/5k/10k; the iPhone goal picker only offers 5k/10k). half/
    /// marathon goals go through race mode with a date.
    private var ttDistanceCode: String { distance == .k10 ? "10k" : "5k" }

    /// Map a precise goal time + distance to web's bucket string
    /// (lib/onboarding/state TT_TIME_LADDERS) so the goal-ready projection
    /// can resolve the required VDOT. Falls back to the slowest bucket.
    private func ttBucket(_ sec: Int, _ d: Distance) -> String {
        if d == .k10 {
            switch sec {
            case ..<2400: return "Under 40"
            case ..<2700: return "40-45"
            case ..<3000: return "45-50"
            case ..<3600: return "50-60"
            default:      return "60+"
            }
        }
        // default 5k ladder
        switch sec {
        case ..<1200: return "Under 20:00"
        case ..<1320: return "20-22"
        case ..<1500: return "22-25"
        case ..<1680: return "25-28"
        case ..<1920: return "28-32"
        default:      return "32+"
        }
    }

    /// LTHR parsed from the optional field, clamped to a sane HR band.
    private var parsedLthr: Int? {
        guard let v = Int(lthrText.trimmingCharacters(in: .whitespaces)),
              (120...210).contains(v) else { return nil }
        return v
    }

    enum TargetMode: String, CaseIterable { case race, goal, just, coached }
    enum Distance: String, CaseIterable { case k5 = "5K", k10 = "10K", half = "HALF", marathon = "MARATHON" }

    // Five-step mesh: cool → hot. A lime stage bridges green → amber for
    // the added profile step.
    private let palettes: [FaffMesh] = [
        FaffMesh(c1: 0x7FE6D6, c2: 0x5AA9D6, c3: 0x2F7FAE, c4: 0x1F6A8A, c5: 0x1A5A7A, base: 0x08222E),
        FaffMesh(c1: 0x8EF0B0, c2: 0x34C194, c3: 0x1F8A8A, c4: 0x128A64, c5: 0x137259, base: 0x06382E),
        FaffMesh(c1: 0xE6E89A, c2: 0xC9C45E, c3: 0xA8B048, c4: 0x8E9A3C, c5: 0x7A8836, base: 0x3A3E14),
        FaffMesh(c1: 0xFFE0A0, c2: 0xF8B85F, c3: 0xE08A36, c4: 0xC96E2A, c5: 0xB46026, base: 0x5E2F12),
        FaffMesh(c1: 0xFFD27A, c2: 0xE88021, c3: 0xD6263C, c4: 0x9E1733, c5: 0xC01030, base: 0x420A1E)
    ]

    private let stepCount = 5

    var body: some View {
        ZStack {
            FaffMeshView(mesh: palettes[min(step, palettes.count - 1)], transition: 0.9)

            VStack(spacing: 0) {
                topBar
                    .padding(.top, 46)
                    .padding(.horizontal, 20)

                ZStack {
                    welcomePanel.opacity(step == 0 ? 1 : 0)
                    connectPanel.opacity(step == 1 ? 1 : 0)
                    trainingPanel.opacity(step == 2 ? 1 : 0)
                    profilePanel.opacity(step == 3 ? 1 : 0)
                    confirmPanel.opacity(step == 4 ? 1 : 0)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .animation(Theme.Motion.smooth, value: step)
                .padding(.top, 32)
            }
        }
    }

    // MARK: chrome

    private var topBar: some View {
        ZStack {
            HStack {
                if step > 0 {
                    BackChip { withAnimation(Theme.Motion.smooth) { step = max(0, step - 1) } }
                }
                Spacer()
            }
            HStack(spacing: 7) {
                ForEach(0..<stepCount, id: \.self) { i in
                    Capsule()
                        .fill(i == step ? Color.white : Color.white.opacity(0.25))
                        .frame(width: i == step ? 30 : 22, height: 4)
                }
            }
        }
        .frame(height: 36)
    }

    // MARK: welcome panel

    private var welcomePanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("WELCOME TO")
                .font(.label(11))
                .tracking(3)
                .foregroundStyle(Theme.txt.opacity(0.66))
            HStack(spacing: 0) {
                Brandmark(size: 52, style: .swept)
                Spacer()
            }
            .padding(.top, 6)
            Text("Your training, built around what you're chasing · and honest about where you stand today.")
                .font(.body(15, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.84))
                .lineSpacing(4)
                .padding(.top, 18)
            LinearGradient(
                colors: [
                    Color(hex: 0x3AB0CF), Color(hex: 0x34C194), Color(hex: 0xF8B85F),
                    Color(hex: 0xE88021), Color(hex: 0xD6263C)
                ],
                startPoint: .leading, endPoint: .trailing
            )
            .frame(height: 10)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .padding(.top, 22)
            Spacer(minLength: 0)
            ctaButton(title: "Get started") {
                withAnimation(Theme.Motion.smooth) { step = 1 }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 26)
        .padding(.bottom, 30)
    }

    // MARK: connect panel

    private struct SrcRow: Identifiable {
        let id: String
        let name: String
        let sub: String
        let glyph: String
        let tint: Color
    }

    private let sources: [SrcRow] = [
        SrcRow(id: "health", name: "Apple Health", sub: "Workouts, heart, sleep",
               glyph: "heart.fill", tint: Color(hex: 0xFF2D55)),
        SrcRow(id: "strava", name: "Strava", sub: "Activity history",
               glyph: "triangle.fill", tint: Color(hex: 0xFC4C02)),
        SrcRow(id: "garmin", name: "Garmin", sub: "Coming soon",
               glyph: "g.circle.fill", tint: Color(hex: 0x0A66A8))
    ]

    /// Apple Health connection state, derived from the shared importer once
    /// the runner has tapped Connect (so a background sync can't flip the
    /// row before they ask for it).
    private var healthState: ConnState {
        guard healthTapped else { return .idle }
        switch hk.status {
        case .requesting, .importing, .idle: return .connecting
        case .done: return .connected(hk.lastMessage)
        case .error: return .failed(hk.lastMessage ?? "Health didn't connect")
        }
    }

    private var anyConnected: Bool {
        if case .connected = healthState { return true }
        if case .connected = stravaState { return true }
        return false
    }

    private func state(for id: String) -> ConnState {
        switch id {
        case "health": return healthState
        case "strava": return stravaState
        default: return .idle             // garmin — not wired
        }
    }

    private var connectPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("STEP 1")
                .font(.label(11))
                .tracking(3)
                .foregroundStyle(Theme.txt.opacity(0.66))
            Text("Bring your\nhistory in.")
                .font(.display(38, weight: .bold))
                .tracking(-1.5)
                .foregroundStyle(Theme.txt)
                .lineSpacing(-4)
                .padding(.top, 12)
            Text("Connect your watch and apps. We'll pull in every run so Faff is alive from minute one.")
                .font(.body(15, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.84))
                .lineSpacing(3)
                .padding(.top, 14)

            VStack(spacing: 11) {
                ForEach(sources) { src in srcRow(src) }
            }
            .padding(.top, 18)

            Spacer(minLength: 0)

            ctaButton(title: "Continue", enabled: anyConnected) {
                withAnimation(Theme.Motion.smooth) { step = 2 }
            }
            Button {
                withAnimation(Theme.Motion.smooth) { step = 2 }
            } label: {
                Text("I'll start fresh")
                    .font(.body(13, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.6))
                    .frame(maxWidth: .infinity)
                    .padding(.top, 14)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 26)
        .padding(.bottom, 30)
    }

    private func srcRow(_ src: SrcRow) -> some View {
        let st = state(for: src.id)
        let isGarmin = src.id == "garmin"
        let isConnected: Bool = { if case .connected = st { return true }; return false }()
        let isConnecting: Bool = { if case .connecting = st { return true }; return false }()

        return Button {
            connectTapped(src.id)
        } label: {
            VStack(spacing: 0) {
                HStack(spacing: 14) {
                    Image(systemName: src.glyph)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(Color.white)
                        .frame(width: 42, height: 42)
                        .background(src.tint.opacity(isGarmin ? 0.4 : 1.0),
                                    in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(src.name)
                            .font(.body(16, weight: .extraBold))
                            .foregroundStyle(Theme.txt.opacity(isGarmin ? 0.55 : 1.0))
                        Text(srcSubtitle(src, state: st))
                            .font(.body(11, weight: .semibold))
                            .foregroundStyle(srcSubtitleColor(st, isGarmin: isGarmin))
                    }
                    Spacer()
                    trailingLabel(st, isGarmin: isGarmin, isConnected: isConnected, isConnecting: isConnecting)
                }
            }
            .padding(EdgeInsets(top: 15, leading: 16, bottom: 15, trailing: 16))
            .background(
                Color.white.opacity(isConnected ? 0.14 : 0.08),
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(isConnected ? Color(hex: 0x7BE8A0).opacity(0.5) : Color.white.opacity(0.16), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(isGarmin || isConnecting)
    }

    /// Row subtitle: the real imported summary when connected, the failure
    /// reason when it failed, otherwise the source's tagline.
    private func srcSubtitle(_ src: SrcRow, state st: ConnState) -> String {
        switch st {
        case .connected(let detail):
            if let d = detail, !d.isEmpty { return d }   // "12 runs · 340 vitals"
            return "Connected"
        case .failed(let reason):
            return reason
        default:
            return src.sub
        }
    }

    private func srcSubtitleColor(_ st: ConnState, isGarmin: Bool) -> Color {
        switch st {
        case .connected: return Color(hex: 0x7BE8A0)
        case .failed:    return Color(hex: 0xFFB4A0)
        default:         return Theme.txt.opacity(isGarmin ? 0.4 : 0.6)
        }
    }

    @ViewBuilder
    private func trailingLabel(_ st: ConnState, isGarmin: Bool, isConnected: Bool, isConnecting: Bool) -> some View {
        if isGarmin {
            Text("Soon")
                .font(.body(12, weight: .bold))
                .foregroundStyle(Theme.txt.opacity(0.35))
        } else if isConnecting {
            HStack(spacing: 6) {
                ProgressView().controlSize(.small).tint(Theme.txt)
                Text("Connecting")
                    .font(.body(12, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.8))
            }
        } else if isConnected {
            Text("Connected")
                .font(.body(12, weight: .bold))
                .foregroundStyle(Color(hex: 0x7BE8A0))
        } else if case .failed = st {
            Text("Retry")
                .font(.body(12, weight: .bold))
                .foregroundStyle(Color(hex: 0xF3AD38))
        } else {
            Text("Connect")
                .font(.body(12, weight: .bold))
                .foregroundStyle(Theme.txt.opacity(0.8))
        }
    }

    /// Real connect actions. Apple Health fires the HealthKit auth + import;
    /// Strava opens the live OAuth flow. Garmin is a no-op (disabled).
    private func connectTapped(_ id: String) {
        switch id {
        case "health":
            healthTapped = true
            Task { await HealthKitImporter.shared.requestAuthAndImport(daysBack: 180) }
        case "strava":
            guard !stravaConnecting else { return }
            stravaConnecting = true
            stravaState = .connecting
            Task {
                let outcome = await StravaOAuthSession.shared.start()
                await MainActor.run {
                    switch outcome {
                    case .connected:
                        stravaState = .connected(nil)
                    case .failed(let reason):
                        stravaState = .failed(reason)
                    case .canceled:
                        stravaState = .idle
                    }
                    stravaConnecting = false
                }
            }
        default:
            break
        }
    }

    // MARK: target panel

    private var targetPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("STEP 2")
                .font(.label(11)).tracking(3)
                .foregroundStyle(Theme.txt.opacity(0.66))
            Text("What are you\nchasing?")
                .font(.display(38, weight: .bold))
                .tracking(-1.5)
                .foregroundStyle(Theme.txt)
                .lineSpacing(-4)
                .padding(.top, 12)

            modeChips
                .padding(.top, 18)

            if mode == .race {
                fieldLabel("RACE NAME")
                TextField("", text: $raceName, prompt: Text("e.g. California Intl Marathon")
                    .foregroundColor(Color.white.opacity(0.4)))
                    .font(.body(16, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .padding(EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16))
                    .background(Color.white.opacity(0.08),
                                in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.2), lineWidth: 1))
                    .padding(.top, 6)

                fieldLabel("RACE DATE")
                HStack {
                    Text("When's the gun?")
                        .font(.body(14, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.7))
                    Spacer()
                    DatePicker("", selection: $raceDate,
                               in: Date()...,
                               displayedComponents: .date)
                        .labelsHidden()
                        .datePickerStyle(.compact)
                        .colorScheme(.dark)
                        .tint(.white)
                }
                .padding(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 12))
                .background(Color.white.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color.white.opacity(0.2), lineWidth: 1))
                .padding(.top, 6)
            }

            if mode == .race || mode == .goal {
                fieldLabel(mode == .goal ? "DISTANCE · 5K OR 10K" : "DISTANCE")
                distanceChips
                    .padding(.top, 6)
                fieldLabel("GOAL TIME")
                stepper
                    .padding(.top, 6)
            } else if mode == .coached {
                Text("Your coach owns the plan. Faff is your measurement layer — every run, your readiness, your trends. Paste your coach's calendar link in Settings to see their workouts here.")
                    .font(.body(15, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.84))
                    .lineSpacing(3)
                    .padding(.top, 16)
            } else {
                Text("No target, no pressure. We'll keep you consistent, healthy, and ready when a goal appears.")
                    .font(.body(15, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.84))
                    .lineSpacing(3)
                    .padding(.top, 16)
            }

            Spacer(minLength: 0)
            ctaButton(title: "Continue") {
                withAnimation(Theme.Motion.smooth) { step = 3 }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 26)
        .padding(.bottom, 30)
    }

    // MARK: profile panel

    private var profilePanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("STEP 3")
                .font(.label(11)).tracking(3)
                .foregroundStyle(Theme.txt.opacity(0.66))
            Text("A bit about\nyou.")
                .font(.display(38, weight: .bold))
                .tracking(-1.5)
                .foregroundStyle(Theme.txt)
                .lineSpacing(-4)
                .padding(.top, 12)
            Text("This calibrates your heart-rate zones and paces. Skip anything you'd rather not share.")
                .font(.body(15, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.84))
                .lineSpacing(3)
                .padding(.top, 14)

            fieldLabel("DATE OF BIRTH")
            HStack {
                Text(birthdaySet ? "Sets your age" : "Tap to set")
                    .font(.body(14, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.7))
                Spacer()
                DatePicker("", selection: $birthday,
                           in: dobRange,
                           displayedComponents: .date)
                    .labelsHidden()
                    .datePickerStyle(.compact)
                    .colorScheme(.dark)
                    .tint(.white)
                    .onChange(of: birthday) { _, _ in birthdaySet = true }
            }
            .padding(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 12))
            .background(Color.white.opacity(0.08),
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color.white.opacity(0.2), lineWidth: 1))
            .padding(.top, 6)

            fieldLabel("SEX")
            HStack(spacing: 8) {
                chip(text: "Male", on: sex == "M") {
                    withAnimation(Theme.Motion.smooth) { sex = "M" }
                }
                chip(text: "Female", on: sex == "F") {
                    withAnimation(Theme.Motion.smooth) { sex = "F" }
                }
                Spacer()
            }
            .padding(.top, 6)

            fieldLabel("THRESHOLD HR · OPTIONAL")
            HStack(spacing: 10) {
                TextField("", text: $lthrText, prompt: Text("e.g. 162")
                    .foregroundColor(Color.white.opacity(0.4)))
                    .font(.body(16, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .keyboardType(.numberPad)
                    .frame(width: 96)
                    .padding(EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16))
                    .background(Color.white.opacity(0.08),
                                in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.2), lineWidth: 1))
                Text("bpm · only if you know it from a test")
                    .font(.body(12, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.55))
            }
            .padding(.top, 6)

            Spacer(minLength: 0)
            ctaButton(title: "Continue") {
                withAnimation(Theme.Motion.smooth) { step = 4 }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 26)
        .padding(.bottom, 30)
    }

    // MARK: training panel (web parity · frequency / volume / schedule)

    private var trainingPanel: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                Text("STEP 2")
                    .font(.label(11)).tracking(3)
                    .foregroundStyle(Theme.txt.opacity(0.66))
                Text(mode == .coached ? "Your coach\nowns the week." : "Your week.")
                    .font(.display(38, weight: .bold))
                    .tracking(-1.5)
                    .foregroundStyle(Theme.txt)
                    .lineSpacing(-4)
                    .padding(.top, 12)

                if mode == .coached {
                    Text("Your coach sets the schedule. Faff tracks every run, your readiness and your trends, and shows your coach's plan if you connect their calendar in Settings.")
                        .font(.body(15, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.84))
                        .lineSpacing(3)
                        .padding(.top, 14)
                } else {
                    fieldLabel("DAYS PER WEEK")
                    HStack(spacing: 8) {
                        ForEach([3, 4, 5, 6], id: \.self) { n in
                            chip(text: "\(n)", on: weeklyFreq == n) {
                                withAnimation(Theme.Motion.smooth) { weeklyFreq = n }
                            }
                        }
                        Spacer()
                    }
                    .padding(.top, 6)

                    fieldLabel("WEEKLY MILEAGE NOW")
                    HStack(spacing: 8) {
                        ForEach([15, 25, 35, 45, 55], id: \.self) { mi in
                            chip(text: mi == 55 ? "55+" : "\(mi)", on: weeklyMi == mi) {
                                withAnimation(Theme.Motion.smooth) { weeklyMi = mi }
                            }
                        }
                        Spacer()
                    }
                    .padding(.top, 6)

                    fieldLabel("START")
                    HStack(spacing: 8) {
                        chip(text: "Today", on: startOffset == 0) {
                            withAnimation(Theme.Motion.smooth) { startOffset = 0 }
                        }
                        chip(text: "Tomorrow", on: startOffset == 1) {
                            withAnimation(Theme.Motion.smooth) { startOffset = 1 }
                        }
                        chip(text: "In 2 days", on: startOffset == 2) {
                            withAnimation(Theme.Motion.smooth) { startOffset = 2 }
                        }
                        Spacer()
                    }
                    .padding(.top, 6)

                    fieldLabel("LONG RUN DAY")
                    HStack(spacing: 6) {
                        ForEach(Array(["sun", "mon", "tue", "wed", "thu", "fri", "sat"].enumerated()), id: \.offset) { idx, key in
                            chip(text: ["S", "M", "T", "W", "T", "F", "S"][idx], on: longRunDay == key) {
                                withAnimation(Theme.Motion.smooth) { longRunDay = key }
                            }
                        }
                    }
                    .padding(.top, 6)
                }

                Spacer(minLength: 24)
                ctaButton(title: "Continue") {
                    withAnimation(Theme.Motion.smooth) { step = 3 }
                }
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .padding(.horizontal, 26)
            .padding(.bottom, 30)
        }
    }

    /// DOB bounds — age 13 to 100, matching the backend's accepted range.
    private var dobRange: ClosedRange<Date> {
        let cal = Calendar.current
        let now = Date()
        let oldest = cal.date(byAdding: .year, value: -100, to: now) ?? now
        let youngest = cal.date(byAdding: .year, value: -13, to: now) ?? now
        return oldest...youngest
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .font(.label(11)).tracking(2)
            .foregroundStyle(Theme.txt.opacity(0.55))
            .padding(.top, 24)
    }

    private var modeChips: some View {
        // 4 modes (added coached 2026-06-10) — a vertical list of
        // full-width rows reads cleaner than an overflowing chip row.
        let modes: [(TargetMode, String, String)] = [
            (.race, "Train for a race", "A goal race on the calendar"),
            (.goal, "Chase a goal time", "Get faster at a 5K or 10K, no race date"),
            (.just, "Just keep running", "Consistent, healthy miles"),
            (.coached, "I have a coach", "Your coach owns the plan · Faff tracks it")
        ]
        return VStack(spacing: 8) {
            ForEach(modes, id: \.0) { m in
                let on = mode == m.0
                Button {
                    withAnimation(Theme.Motion.smooth) {
                        mode = m.0
                        // Goal mode is 5k/10k only — snap off half/marathon.
                        if m.0 == .goal, distance == .half || distance == .marathon {
                            distance = .k5; goalSec = defaultGoal(for: .k5)
                        }
                    }
                } label: {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(m.1)
                                .font(.body(15, weight: .extraBold))
                                .foregroundStyle(on ? Color(hex: 0x2A0E08) : Theme.txt)
                            Text(m.2)
                                .font(.body(11, weight: .semibold))
                                .foregroundStyle(on ? Color(hex: 0x2A0E08).opacity(0.7) : Theme.txt.opacity(0.6))
                        }
                        Spacer()
                        if on { Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(Color(hex: 0x2A0E08)) }
                    }
                    .padding(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(on ? Color.white : Color.white.opacity(0.1),
                                in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(on ? Color.white : Color.white.opacity(0.2), lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var distanceChips: some View {
        // Goal mode (time-trial, no race) supports 5k/10k only.
        let options: [Distance] = (mode == .goal) ? [.k5, .k10] : Distance.allCases
        return HStack(spacing: 8) {
            ForEach(options, id: \.self) { d in
                chip(text: d.rawValue, on: distance == d) {
                    withAnimation(Theme.Motion.smooth) {
                        distance = d
                        goalSec = defaultGoal(for: d)
                    }
                }
            }
        }
    }

    private func chip(text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text)
                .font(.body(13, weight: .extraBold))
                .foregroundStyle(on ? Color(hex: 0x2A0E08) : Theme.txt)
                .padding(.horizontal, 16).padding(.vertical, 11)
                .background(on ? Color.white : Color.white.opacity(0.1),
                            in: Capsule())
                .overlay(Capsule().stroke(on ? Color.white : Color.white.opacity(0.2), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var stepper: some View {
        HStack {
            stepperButton(symbol: "minus") {
                goalSec = max(stepSec * 4, goalSec - stepSec)
            }
            Spacer()
            VStack(spacing: 2) {
                Text(formatTime(goalSec))
                    .font(.display(32, weight: .bold))
                    .tracking(-1)
                    .foregroundStyle(Theme.txt)
                Text("TARGET")
                    .font(.label(10)).tracking(1.5)
                    .foregroundStyle(Theme.txt.opacity(0.55))
            }
            Spacer()
            stepperButton(symbol: "plus") {
                goalSec += stepSec
            }
        }
        .padding(EdgeInsets(top: 8, leading: 10, bottom: 8, trailing: 10))
        .background(Color.white.opacity(0.08),
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
            .stroke(Color.white.opacity(0.18), lineWidth: 1))
    }

    private func stepperButton(symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .regular))
                .foregroundStyle(Theme.txt)
                .frame(width: 46, height: 46)
                .background(Color.white.opacity(0.16), in: Circle())
                .overlay(Circle().stroke(Color.white.opacity(0.28), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: confirm panel

    private var confirmPanel: some View {
        return VStack(alignment: .leading, spacing: 0) {
            Text("YOU'RE ALL SET")
                .font(.label(11)).tracking(3)
                .foregroundStyle(Theme.txt.opacity(0.66))
            Text(headline)
                .font(.display(38, weight: .bold))
                .tracking(-1.5)
                .foregroundStyle(Theme.txt)
                .lineSpacing(-4)
                .padding(.top, 12)

            Text("Your training starts now. Add a race or set a goal from the Goals tab whenever you're ready.")
                .font(.body(15, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.84))
                .lineSpacing(3)
                .padding(.top, 14)

            Spacer(minLength: 0)

            if let err = onboardingError {
                Text(err)
                    .font(.body(12, weight: .semibold))
                    .foregroundStyle(Color(hex: 0xFC4D64))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, 8)
            }

            ctaButton(title: submitting ? "Saving…" : "Start running") {
                guard !submitting else { return }
                submitting = true
                onboardingError = nil
                Task {
                    do {
                        _ = try await API.completeOnboarding(payload: onboardingPayload)
                        // Optional advanced fields that ride the profile PATCH
                        // (not part of the onboarding/complete contract).
                        var patch: [String: Any] = [:]
                        if let lthr = parsedLthr { patch["lthr"] = lthr }
                        if case .connected = healthState {
                            let iso = ISO8601DateFormatter().string(from: Date())
                            patch["health_connected_at"] = iso
                        }
                        if !patch.isEmpty { try? await API.updateProfile(patch) }
                        await MainActor.run {
                            submitting = false
                            onComplete()
                        }
                    } catch {
                        await MainActor.run {
                            submitting = false
                            onboardingError = "Couldn't save · check your connection"
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 26)
        .padding(.bottom, 30)
    }

    private var goalBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("YOUR GOAL")
                .font(.label(10)).tracking(1.5)
                .foregroundStyle(Theme.txt.opacity(0.55))
            Text(formatTime(goalSec))
                .font(.display(42, weight: .bold))
                .tracking(-2)
                .foregroundStyle(Color.white)
                .shadow(color: Color(hex: 0xFFD2A0).opacity(0.5), radius: 26)
        }
    }

    private var headline: String {
        switch mode {
        case .race:
            return raceName.isEmpty ? distance.rawValue : raceName
        case .goal:
            return distance.rawValue
        case .just:
            return "Let's build\na base."
        case .coached:
            return "You're\nconnected."
        }
    }

    // MARK: shared

    private func ctaButton(title: String, enabled: Bool = true, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.body(16, weight: .extraBold))
                .foregroundStyle(Color(hex: 0x2A0E08))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 17)
                .background(Color.white.opacity(enabled ? 1.0 : 0.4),
                            in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    private var stepSec: Int {
        switch distance {
        case .k5: return 15
        case .k10: return 30
        case .half, .marathon: return 60
        }
    }

    private func defaultGoal(for d: Distance) -> Int {
        switch d {
        case .k5: return 1500
        case .k10: return 3300
        case .half: return 7200
        case .marathon: return 14400
        }
    }

    private func formatTime(_ s: Int) -> String {
        let h = s / 3600
        let m = (s % 3600) / 60
        let x = s % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, x)
        }
        return String(format: "%d:%02d", m, x)
    }
}
