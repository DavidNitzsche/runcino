//
//  OnboardingView.swift
//  Welcome → connect → running → profile → confirm. Mesh migrates cool → hot.
//
//  Onboarding captures identity-adjacent setup only: data connections, the
//  runner's current running level + history, light schedule, and optional
//  physiology. It does NOT capture a goal or race — that happens in-app
//  afterward (Goals/Targets tab → AddRace / SetGoal), which is where the
//  plan is actually generated. So the payload always sends distance:"none";
//  the backend's "no race + no goal" branch authors nothing and the runner
//  lands on Today's cold state.
//
//  Connect is real: Apple Health drives HealthKitImporter.requestAuthAndImport
//  (genuine permission prompt + import, shows the real imported count) and
//  Strava drives the live StravaOAuthSession. Nothing fabricates a count.
//

import SwiftUI

struct OnboardingView: View {
    let onComplete: () -> Void

    @State private var step: Int = 0
    @State private var submitting: Bool = false
    @State private var onboardingError: String? = nil
    /// The runner's name (set at invite signup). Fetched on appear so the
    /// confirm step can greet them by name and the payload carries the real
    /// name rather than a placeholder. nil until the fetch lands.
    @State private var runnerName: String? = nil

    // Sub-wizard position within step 2.
    @State private var runSubstep: Int = 0

    // Experience level. beginner/intermediate/advanced — shapes plan density
    // and coach voice from day one.
    @State private var experienceLevel: String? = nil

    // Running level. weeklyFreq + weeklyMi seed plan shape and volume;
    // histLong seeds the long-run floor.
    @State private var weeklyFreq: Int? = nil        // 1...6 days/week
    @State private var weeklyMi: Int = 25           // 15/25/35/45/55 mi/week
    @State private var histLong: String? = nil      // "0-3"|"3-6"|"6-10"|"10+"

    // Schedule. startDate seeds the plan anchor; longRunDay is a durable
    // preference that the first plan (built on goal/race add) honors.
    @State private var startDate: Date = Date()
    @State private var longRunDay: String = "sun"   // sun..sat

    // Race history. Self-reported PRs seed VDOT + coach voice band.
    @State private var hasRaced: Bool = false
    @State private var raceEntries: [RaceEntry] = []

    struct RaceEntry: Identifiable, Equatable {
        let id = UUID()
        var distance: String = "5k"     // 5k|10k|half|marathon
        var timeText: String = ""       // "22:30" or "3:45:00"
        var when: String = "<6mo"       // <6mo|6-12mo|1-2yr|2+yr
    }

    // Physiology — all optional. age + sex persist via /onboarding/complete;
    // height_cm rides the same payload; LTHR persists via PATCH /api/profile.
    // RHR is HealthKit-derived (no manual entry); HRmax is estimated from age
    // / set later in Settings — neither is asked here.
    @State private var birthday: Date = Calendar.current.date(byAdding: .year, value: -30, to: Date()) ?? Date()
    @State private var birthdaySet: Bool = false
    @State private var sex: String? = nil           // "M" | "F"
    @State private var lthrText: String = ""
    @State private var heightText: String = ""

    // Connect state. Apple Health reflects the shared importer; Strava is
    // driven locally off the OAuth round-trip.
    @ObservedObject private var hk: HealthKitImporter = .shared
    @State private var healthTapped: Bool = false
    @State private var stravaState: ConnState = .idle
    @State private var stravaConnecting: Bool = false

    enum ConnState: Equatable { case idle, connecting, connected(String?), failed(String) }

    /// Builds the /api/onboarding/complete payload. distance is always
    /// "none" (goal/race is set in-app later). Only fields the runner
    /// actually set are sent — nullable fields stay null.
    private var onboardingPayload: [String: Any] {
        let isoF = DateFormatter(); isoF.dateFormat = "yyyy-MM-dd"
        let tz = TimeZone.current.identifier

        let histAvg: String = {
            switch weeklyMi {
            case ..<5:  return "0-5"
            case ..<15: return "5-15"
            case ..<25: return "15-25"
            case ..<35: return "25-35"
            default:    return "35+"
            }
        }()

        return [
            "distance": "none",
            "date": NSNull(),
            "time": NSNull(),
            "ttDistance": NSNull(),
            "ttTime": NSNull(),
            "ttTimeSeconds": NSNull(),
            "weeklyMi": weeklyMi,
            "weeklyFreq": weeklyFreq ?? 3,
            "histAvg": histAvg,
            "histLong": (histLong as Any?) ?? NSNull(),
            "histYears": NSNull(),
            "raceHistory": serializedRaceHistory,
            "startDate": isoF.string(from: startDate),
            "longRunDay": longRunDay,
            "experienceLevel": (experienceLevel as Any?) ?? NSNull(),
            "name": (firstName != nil ? runnerName! : "Runner"),
            "timezone": tz,
            "birthday": birthdaySet ? isoF.string(from: birthday) as Any : NSNull(),
            "sex": (sex as Any?) ?? NSNull(),
            "height_cm": (parsedHeight as Any?) ?? NSNull(),
            "connectionsSkipped": !anyConnected
        ]
    }

    /// Validated, deduped race-history entries for the payload. Skips entries
    /// with an unparseable / out-of-band time rather than failing the submit.
    private var serializedRaceHistory: [[String: Any]] {
        guard hasRaced else { return [] }
        var out: [[String: Any]] = []
        for e in raceEntries {
            guard out.count < 3 else { break }
            guard let sec = parseTimeSec(e.timeText), sec >= 60, sec <= 180_000 else { continue }
            out.append(["distance": e.distance, "timeSec": sec, "whenRaced": e.when])
        }
        return out
    }

    /// Parse "mm:ss" or "h:mm:ss" into seconds. Returns nil on bad input.
    private func parseTimeSec(_ s: String) -> Int? {
        let parts = s.trimmingCharacters(in: .whitespaces).split(separator: ":")
        guard parts.count == 2 || parts.count == 3 else { return nil }
        let nums = parts.map { Int($0) }
        guard !nums.contains(where: { $0 == nil }) else { return nil }
        let v = nums.compactMap { $0 }
        if v.count == 2 { return v[0] * 60 + v[1] }
        return v[0] * 3600 + v[1] * 60 + v[2]
    }

    /// LTHR parsed from the optional field, clamped to a sane HR band.
    private var parsedLthr: Int? {
        guard let v = Int(lthrText.trimmingCharacters(in: .whitespaces)),
              (120...210).contains(v) else { return nil }
        return v
    }

    /// Height (cm) parsed from the optional field, clamped to the backend band.
    private var parsedHeight: Int? {
        guard let v = Int(heightText.trimmingCharacters(in: .whitespaces)),
              (120...230).contains(v) else { return nil }
        return v
    }

    private let stepCount = 5

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()

            VStack(spacing: 0) {
                topBar
                    .padding(.top, 46)
                    .padding(.horizontal, 20)

                ZStack {
                    welcomePanel.opacity(step == 0 ? 1 : 0)
                    connectPanel.opacity(step == 1 ? 1 : 0)
                    runningPanel.opacity(step == 2 ? 1 : 0)
                    profilePanel.opacity(step == 3 ? 1 : 0)
                    confirmPanel.opacity(step == 4 ? 1 : 0)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .animation(Theme.Motion.smooth, value: step)
                .animation(Theme.Motion.smooth, value: runSubstep)
                .padding(.top, 32)
            }
        }
        .task {
            // Invite signup already captured the name; surface it.
            if let n = (try? await API.fetchProfileState())?.identity.full_name,
               !n.trimmingCharacters(in: .whitespaces).isEmpty {
                runnerName = n
            }
        }
    }

    /// First name for the confirm-step greeting, if we have one.
    private var firstName: String? {
        guard let n = runnerName?
            .trimmingCharacters(in: .whitespaces)
            .split(separator: " ").first.map(String.init),
              !n.isEmpty else { return nil }
        return n
    }

    // MARK: chrome

    private var topBar: some View {
        ZStack {
            HStack {
                let showBack = step > 0
                if showBack {
                    BackChip {
                        withAnimation(Theme.Motion.smooth) {
                            if step == 2 && runSubstep > 0 { runSubstep -= 1 }
                            else { step = max(0, step - 1) }
                        }
                    }
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
        VStack(spacing: 0) {
            Spacer(minLength: 0)

            // Logo block — upper portion of the screen
            VStack(alignment: .leading, spacing: 0) {
                Text("WELCOME TO")
                    .font(.label(11))
                    .tracking(3)
                    .foregroundStyle(Theme.txt.opacity(0.55))
                Brandmark(size: 72, style: .swept)
                    .padding(.top, 10)
                Text("Your training, built around\nwhat you're chasing.")
                    .font(.display(26, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .lineSpacing(2)
                    .padding(.top, 28)
                Text("Honest about where you stand today.")
                    .font(.body(15, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.55))
                    .padding(.top, 10)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 26)

            Spacer(minLength: 0)
            Spacer(minLength: 0)

            ctaButton(title: "Get started") {
                withAnimation(Theme.Motion.smooth) { step = 1 }
            }
            .padding(.horizontal, 26)
            .padding(.bottom, 30)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: connect panel

    private struct SrcRow: Identifiable {
        let id: String
        let name: String
        let sub: String
        let glyph: String
        let tint: Color
    }

    // Health + Strava only. Garmin was a disabled "coming soon" decoration
    // with no integration — dropped so the step is honest.
    private let sources: [SrcRow] = [
        SrcRow(id: "health", name: "Apple Health", sub: "Workouts, heart, sleep",
               glyph: "heart.fill", tint: Color(hex: 0xFF2D55)),
        SrcRow(id: "strava", name: "Strava", sub: "Activity history",
               glyph: "triangle.fill", tint: Color(hex: 0xFC4C02))
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
        default: return .idle
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
                        .background(src.tint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(src.name)
                            .font(.body(16, weight: .extraBold))
                            .foregroundStyle(Theme.txt)
                        Text(srcSubtitle(src, state: st))
                            .font(.body(11, weight: .semibold))
                            .foregroundStyle(srcSubtitleColor(st))
                    }
                    Spacer()
                    trailingLabel(st, isConnected: isConnected, isConnecting: isConnecting)
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
        .disabled(isConnecting)
    }

    /// Row subtitle: the real imported summary when connected, the failure
    /// reason when it failed, otherwise the source's tagline.
    private func srcSubtitle(_ src: SrcRow, state st: ConnState) -> String {
        switch st {
        case .connected(let detail):
            if let d = detail, !d.isEmpty { return d }
            return "Connected"
        case .failed(let reason):
            return reason
        default:
            return src.sub
        }
    }

    private func srcSubtitleColor(_ st: ConnState) -> Color {
        switch st {
        case .connected: return Color(hex: 0x7BE8A0)
        case .failed:    return Color(hex: 0xFFB4A0)
        default:         return Theme.txt.opacity(0.6)
        }
    }

    @ViewBuilder
    private func trailingLabel(_ st: ConnState, isConnected: Bool, isConnecting: Bool) -> some View {
        if isConnecting {
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
    /// Strava opens the live OAuth flow.
    private func connectTapped(_ id: String) {
        switch id {
        case "health":
            healthTapped = true
            // Pull a full year on first connect so the coach has real volume,
            // sleep and HR history from day one. Chunked + idempotent server-
            // side, and re-run after onboarding completes (RootContainer).
            Task { await HealthKitImporter.shared.requestAuthAndImport(daysBack: 365) }
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

    // MARK: running sub-wizard

    // Sub-step layout (accounts for hasRaced branch):
    //  0  experience level
    //  1  days/week
    //  2  weekly mileage
    //  3  longest run
    //  4  have you raced?
    //  5  race entries  (hasRaced) | start date (!hasRaced)
    //  6  start date    (hasRaced) | long run day (!hasRaced → step 3)
    //  7  long run day  (hasRaced → step 3)

    @ViewBuilder
    private var runningPanel: some View {
        switch runSubstep {
        case 0: runQ_experience
        case 1: runQ_daysPerWeek
        case 2: runQ_mileage
        case 3: runQ_longestRun
        case 4: runQ_haveRaced
        case 5:
            if hasRaced { runQ_raceEntries } else { runQ_startDate }
        case 6:
            if hasRaced { runQ_startDate } else { runQ_longRunDay }
        default:
            runQ_longRunDay
        }
    }

    private func runNext() {
        let last = hasRaced ? 7 : 6
        withAnimation(Theme.Motion.smooth) {
            if runSubstep >= last { step = 3 } else { runSubstep += 1 }
        }
    }

    // Shared chrome: step label, big question, optional context, answer block, Continue.
    @ViewBuilder
    private func runQ<C: View>(
        _ question: String,
        context: String? = nil,
        enabled: Bool = true,
        @ViewBuilder content: () -> C
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("STEP 2")
                .font(.label(11)).tracking(3)
                .foregroundStyle(Theme.txt.opacity(0.5))
            Text(question)
                .font(.display(34, weight: .bold))
                .tracking(-1.5)
                .foregroundStyle(Theme.txt)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 10)
            if let ctx = context {
                Text(ctx)
                    .font(.body(14, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.5))
                    .lineSpacing(2)
                    .padding(.top, 10)
            }
            content()
                .padding(.top, 24)
            Spacer(minLength: 0)
            ctaButton(title: "Continue", enabled: enabled) { runNext() }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 26)
        .padding(.bottom, 30)
    }

    // Q0 — experience level
    private var runQ_experience: some View {
        runQ("How would you\ndescribe yourself?",
             context: "Be honest — this shapes your first week.",
             enabled: experienceLevel != nil) {
            VStack(spacing: 10) {
                levelCard("beginner",
                          title: "Just getting started",
                          desc: "New to running, or returning after a long break. Building the habit comes first.")
                levelCard("intermediate",
                          title: "Building consistency",
                          desc: "Running regularly for a year or more. You've done a race or two and know what a tempo feels like.")
                levelCard("advanced",
                          title: "Structured training",
                          desc: "You follow a plan, race often, and think in terms of phases and VDOT.")
            }
        }
    }

    private func levelCard(_ key: String, title: String, desc: String) -> some View {
        let on = experienceLevel == key
        return Button {
            withAnimation(Theme.Motion.smooth) { experienceLevel = key }
        } label: {
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(title)
                        .font(.body(16, weight: .extraBold))
                        .foregroundStyle(on ? Color(hex: 0x0A0C10) : Theme.txt)
                    Text(desc)
                        .font(.body(13, weight: .medium))
                        .foregroundStyle(on ? Color(hex: 0x0A0C10).opacity(0.72) : Theme.txt.opacity(0.55))
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(on ? Color(hex: 0x0A0C10) : Theme.txt.opacity(0.3))
            }
            .padding(16)
            .background(on ? Color.white : Color.white.opacity(0.07),
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(on ? Color.white : Color.white.opacity(0.14), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // Q1 — days per week
    private var runQ_daysPerWeek: some View {
        runQ("How many days a week\ndo you run?",
             context: "Count days you actually run, not strength or cross-training.",
             enabled: weeklyFreq != nil) {
            chipRow([0, 1, 2, 3, 4, 5, 6].map { n in (n == 0 ? "0" : "\(n)", weeklyFreq == n) }) { idx in
                withAnimation(Theme.Motion.smooth) { weeklyFreq = [0, 1, 2, 3, 4, 5, 6][idx] }
            }
        }
    }

    // Q2 — weekly mileage
    private var runQ_mileage: some View {
        runQ("What's your weekly\nmileage right now?",
             context: "Approximate is fine. Your current base, not a peak or goal.") {
            let labels = ["<5", "5-15", "15-25", "25-35", "35-45", "45+"]
            let vals   = [0,    5,      15,      25,      35,      45]
            chipRow(labels.enumerated().map { i, l in (l, weeklyMi == vals[i]) }) { idx in
                withAnimation(Theme.Motion.smooth) { weeklyMi = vals[idx] }
            }
        }
    }

    // Q3 — longest recent run
    private var runQ_longestRun: some View {
        runQ("What's the longest run\nyou've done recently?",
             context: "In the last 4-6 weeks. This sets your long-run floor.",
             enabled: histLong != nil) {
            let opts = ["0-3", "3-6", "6-10", "10+"]
            chipRow(opts.map { ($0, histLong == $0) }) { idx in
                withAnimation(Theme.Motion.smooth) { histLong = opts[idx] }
            }
        }
    }

    // Q4 — have you raced?
    private var runQ_haveRaced: some View {
        runQ("Have you raced\nbefore?",
             context: "A finish time helps us estimate your fitness baseline.") {
            VStack(spacing: 10) {
                raceToggleCard(false, label: "Not yet", sub: "I'll add results after my first race.")
                raceToggleCard(true,  label: "Yes, I've raced", sub: "I can share a finish time.")
            }
        }
    }

    private func raceToggleCard(_ value: Bool, label: String, sub: String) -> some View {
        let on = hasRaced == value
        return Button {
            withAnimation(Theme.Motion.smooth) {
                hasRaced = value
                if value && raceEntries.isEmpty { raceEntries = [RaceEntry()] }
            }
        } label: {
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(label)
                        .font(.body(16, weight: .extraBold))
                        .foregroundStyle(on ? Color(hex: 0x0A0C10) : Theme.txt)
                    Text(sub)
                        .font(.body(13, weight: .medium))
                        .foregroundStyle(on ? Color(hex: 0x0A0C10).opacity(0.7) : Theme.txt.opacity(0.5))
                }
                Spacer()
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(on ? Color(hex: 0x0A0C10) : Theme.txt.opacity(0.3))
            }
            .padding(16)
            .background(on ? Color.white : Color.white.opacity(0.07),
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(on ? Color.white : Color.white.opacity(0.14), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // Q5 (hasRaced) — race entries
    private var runQ_raceEntries: some View {
        runQ("What are your\nbest results?",
             context: "Add up to 3. Finish time only — we'll do the math.") {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 10) {
                    ForEach($raceEntries) { $entry in
                        raceEntryCard(entry: $entry, canRemove: raceEntries.count > 1) {
                            withAnimation(Theme.Motion.smooth) {
                                raceEntries.removeAll { $0.id == entry.id }
                            }
                        }
                    }
                    if raceEntries.count < 3 {
                        Button {
                            withAnimation(Theme.Motion.smooth) { raceEntries.append(RaceEntry()) }
                        } label: {
                            Text("+ Add another")
                                .font(.body(13, weight: .bold))
                                .foregroundStyle(Theme.txt.opacity(0.7))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(Color.white.opacity(0.07),
                                            in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // Q5 (!hasRaced) / Q6 (hasRaced) — start date
    private var runQ_startDate: some View {
        runQ("When do you want\nto start?",
             context: "Pick any upcoming date. Your first week will be waiting.") {
            DatePicker("", selection: $startDate,
                       in: Calendar.current.startOfDay(for: Date())...,
                       displayedComponents: .date)
                .datePickerStyle(.graphical)
                .colorScheme(.dark)
                .tint(Theme.txt)
                .padding(.top, -8)
        }
    }

    // Q6 (!hasRaced) / Q7 (hasRaced) — long run day
    private var runQ_longRunDay: some View {
        let days: [(String, String)] = [
            ("sun","Sun"),("mon","Mon"),("tue","Tue"),("wed","Wed"),
            ("thu","Thu"),("fri","Fri"),("sat","Sat")
        ]
        return runQ("Which day works\nfor your long run?",
                    context: "This becomes the anchor of your training week.") {
            VStack(spacing: 10) {
                ForEach(days, id: \.0) { key, label in
                    Button {
                        withAnimation(Theme.Motion.smooth) { longRunDay = key }
                    } label: {
                        HStack {
                            Text(label)
                                .font(.body(15, weight: .extraBold))
                                .foregroundStyle(longRunDay == key ? Color(hex: 0x0A0C10) : Theme.txt)
                            Spacer()
                            if longRunDay == key {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 13, weight: .black))
                                    .foregroundStyle(Color(hex: 0x0A0C10))
                            }
                        }
                        .padding(.horizontal, 18).padding(.vertical, 14)
                        .background(
                            longRunDay == key ? Color.white : Color.white.opacity(0.07),
                            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                        )
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(longRunDay == key ? Color.white : Color.white.opacity(0.12), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func raceEntryCard(entry: Binding<RaceEntry>, canRemove: Bool, onRemove: @escaping () -> Void) -> some View {
        let distOpts = ["5k", "10k", "half", "marathon"]
        let distLabels = ["5K", "10K", "HALF", "FULL"]
        let whenOpts = ["<6mo", "6-12mo", "1-2yr", "2+yr"]
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                ForEach(Array(distOpts.enumerated()), id: \.offset) { idx, key in
                    chip(text: distLabels[idx], on: entry.wrappedValue.distance == key) {
                        withAnimation(Theme.Motion.smooth) { entry.wrappedValue.distance = key }
                    }
                }
                Spacer(minLength: 0)
            }
            HStack(spacing: 10) {
                TextField("", text: entry.timeText,
                          prompt: Text("time e.g. 22:30").foregroundColor(Color.white.opacity(0.4)))
                    .font(.body(15, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .keyboardType(.numbersAndPunctuation)
                    .padding(EdgeInsets(top: 11, leading: 14, bottom: 11, trailing: 14))
                    .background(Color.white.opacity(0.08),
                                in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color.white.opacity(0.18), lineWidth: 1))
                if canRemove {
                    Button(action: onRemove) {
                        Image(systemName: "trash")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(0.6))
                            .frame(width: 42, height: 42)
                            .background(Color.white.opacity(0.08), in: Circle())
                    }
                    .buttonStyle(.plain)
                }
            }
            HStack(spacing: 6) {
                ForEach(Array(whenOpts.enumerated()), id: \.offset) { idx, key in
                    chip(text: key, on: entry.wrappedValue.when == key) {
                        withAnimation(Theme.Motion.smooth) { entry.wrappedValue.when = key }
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(14)
        .background(Color.white.opacity(0.06),
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
            .stroke(Color.white.opacity(0.12), lineWidth: 1))
    }

    // MARK: profile panel (physiology · optional)

    private var profilePanel: some View {
        ScrollView(showsIndicators: false) {
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

                fieldLabel("HEIGHT · OPTIONAL")
                HStack(spacing: 10) {
                    TextField("", text: $heightText, prompt: Text("e.g. 178")
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
                    Text("cm · unlocks cadence coaching")
                        .font(.body(12, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.55))
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

                Spacer(minLength: 24)
                ctaButton(title: "Continue") {
                    withAnimation(Theme.Motion.smooth) { step = 4 }
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

    /// A horizontal row of selectable chips. `items` is (label, isOn); the
    /// action gets the tapped index.
    private func chipRow(_ items: [(String, Bool)], action: @escaping (Int) -> Void) -> some View {
        HStack(spacing: 8) {
            ForEach(Array(items.enumerated()), id: \.offset) { idx, item in
                chip(text: item.0, on: item.1) { action(idx) }
            }
            Spacer()
        }
        .padding(.top, 6)
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

    // MARK: confirm panel

    private var confirmPanel: some View {
        return VStack(alignment: .leading, spacing: 0) {
            Text("YOU'RE ALL SET")
                .font(.label(11)).tracking(3)
                .foregroundStyle(Theme.txt.opacity(0.66))
            Text(firstName.map { "You're set,\n\($0)." } ?? "Let's build\na base.")
                .font(.display(38, weight: .bold))
                .tracking(-1.5)
                .foregroundStyle(Theme.txt)
                .lineSpacing(-4)
                .padding(.top, 12)

            Text("Your training starts now. Add a race or set a goal from the Goals tab whenever you're ready, and Faff builds the plan around it.")
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
}
