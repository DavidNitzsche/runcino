//
//  OnboardingView.swift
//  Welcome → connect → running → profile → confirm. A directed, one-question-
//  at-a-time portal on the app's grey canvas (no color backgrounds).
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
//  Nothing is typed where it can be picked: finish times, birthday, height,
//  and start date are all wheels. Numbers a runner won't know (max HR, LTHR,
//  RHR) are observed from connected history, not asked.
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

    // Wizard travel direction — drives which way screens slide (forward = new
    // screen enters from the trailing edge, back = from the leading edge).
    @State private var navDir: Bool = true

    // Experience level. beginner/intermediate/advanced — shapes plan density
    // and coach voice from day one.
    @State private var experienceLevel: String? = nil

    // Running level. weeklyFreq + weeklyMi seed plan shape and volume;
    // histLong seeds the long-run floor. Both nil until picked (no silent
    // default — the runner chooses).
    @State private var weeklyFreq: Int? = nil        // 0...6 days/week
    @State private var weeklyMi: Int? = nil          // current weekly base, mi
    @State private var histLong: String? = nil       // "0-3"|"3-6"|"6-10"|"10+"

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
        var timeSec: Int = 0            // picked via wheel, not typed
        var when: String = "<6mo"       // <6mo|6-12mo|1-2yr|2+yr
    }

    // Physiology — all optional. age + sex persist via /onboarding/complete;
    // height_cm rides the same payload. RHR is HealthKit-derived and HRmax is
    // observed from connected workout history (validate-max-hr) — neither is
    // asked here. Onboarding shouldn't quiz a runner on numbers they don't know.
    @State private var birthday: Date = Calendar.current.date(byAdding: .year, value: -30, to: Date()) ?? Date()
    @State private var birthdaySet: Bool = false
    @State private var dobExpanded: Bool = false
    @State private var sex: String? = nil           // "M" | "F"
    @State private var heightFt: Int = 5
    @State private var heightIn: Int = 9
    @State private var heightSet: Bool = false
    @State private var heightExpanded: Bool = false

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
            switch weeklyMi ?? 0 {
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
            "weeklyMi": weeklyMi ?? 0,
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
    /// with an out-of-band time rather than failing the submit.
    private var serializedRaceHistory: [[String: Any]] {
        guard hasRaced else { return [] }
        var out: [[String: Any]] = []
        for e in raceEntries {
            guard out.count < 3 else { break }
            guard e.timeSec >= 60, e.timeSec <= 180_000 else { continue }
            out.append(["distance": e.distance, "timeSec": e.timeSec, "whenRaced": e.when])
        }
        return out
    }

    /// Height (cm) from the ft/in wheels, clamped to the backend band. nil
    /// when the runner never opened the height picker.
    private var parsedHeight: Int? {
        guard heightSet else { return nil }
        let cm = Int((Double(heightFt) * 12 + Double(heightIn)) * 2.54)
        return (120...230).contains(cm) ? cm : nil
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
                    currentPanel
                        .id(step)
                        .faffPageSlide(forward: navDir)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.top, 28)
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

    @ViewBuilder
    private var currentPanel: some View {
        switch step {
        case 0: welcomePanel
        case 1: connectPanel
        case 2: runningPanel
        case 3: profilePanel
        default: confirmPanel
        }
    }

    /// Move the wizard. `forward` picks the slide direction; the page change is
    /// animated with the wizard curve so the slide + fade fire together.
    private func go(forward: Bool, _ change: @escaping () -> Void) {
        navDir = forward
        withAnimation(Theme.Motion.page) { change() }
    }

    // MARK: chrome

    private var topBar: some View {
        ZStack {
            HStack {
                let showBack = step > 0
                if showBack {
                    BackChip {
                        go(forward: false) {
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
                        .fill(i == step ? Color.white : Color.white.opacity(i < step ? 0.5 : 0.22))
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

            VStack(alignment: .leading, spacing: 0) {
                Text("WELCOME TO")
                    .font(.label(11))
                    .tracking(3)
                    .foregroundStyle(Theme.txt.opacity(0.55))
                    .faffEntrance(0)
                Brandmark(size: 72, style: .swept)
                    .padding(.top, 10)
                    .faffEntrance(1)
                Text("Your training, built around\nwhat you're chasing.")
                    .font(.display(26, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .lineSpacing(2)
                    .padding(.top, 28)
                    .faffEntrance(2)
                Text("Honest about where you stand today.")
                    .font(.body(15, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.55))
                    .padding(.top, 10)
                    .faffEntrance(3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 26)

            Spacer(minLength: 0)
            Spacer(minLength: 0)

            ctaButton(title: "Get started") {
                go(forward: true) { step = 1 }
            }
            .padding(.horizontal, 26)
            .padding(.bottom, 30)
            .faffEntrance(4)
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
                .faffEntrance(0)
            Text("Bring your\nhistory in.")
                .font(.heroDisplay(40))
                .tracking(-1.5)
                .foregroundStyle(Theme.txt)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 12)
                .faffEntrance(1)
            Text("Connect your watch and apps. We'll pull in every run so Faff is alive from minute one — and read your heart-rate history so we never have to ask you for numbers.")
                .font(.body(15, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.84))
                .lineSpacing(3)
                .padding(.top, 14)
                .faffEntrance(2)

            VStack(spacing: 11) {
                ForEach(Array(sources.enumerated()), id: \.element.id) { idx, src in
                    srcRow(src).faffEntrance(3 + idx)
                }
            }
            .padding(.top, 22)

            Spacer(minLength: 0)

            ctaButton(title: "Continue", enabled: anyConnected) {
                go(forward: true) { step = 2 }
            }
            .faffEntrance(5)
            Button {
                go(forward: true) { step = 2 }
            } label: {
                Text("I'll start fresh")
                    .font(.body(13, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.6))
                    .frame(maxWidth: .infinity)
                    .padding(.top, 14)
            }
            .buttonStyle(.plain)
            .faffEntrance(6)
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
        ZStack {
            runSubstepView
                .id(runSubstep)
                .faffPageSlide(forward: navDir)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var runSubstepView: some View {
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
        go(forward: true) {
            if runSubstep >= last { step = 3 } else { runSubstep += 1 }
        }
    }

    // Shared chrome for a single question: step label + big headline + optional
    // context anchored at the top, answer block floating in the center of the
    // flexible zone, Continue pinned to the bottom. This is what makes each
    // screen use the whole device instead of a cramped band up top.
    @ViewBuilder
    private func runQ<C: View>(
        _ question: String,
        context: String? = nil,
        enabled: Bool = true,
        @ViewBuilder content: () -> C
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                Text("STEP 2")
                    .font(.label(11)).tracking(3)
                    .foregroundStyle(Theme.txt.opacity(0.5))
                    .faffEntrance(0)
                Text(question)
                    .font(.heroDisplay(40))
                    .tracking(-1.5)
                    .foregroundStyle(Theme.txt)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 12)
                    .faffEntrance(1)
                if let ctx = context {
                    Text(ctx)
                        .font(.body(15, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.55))
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 12)
                        .faffEntrance(2)
                }
            }

            Spacer(minLength: 24)

            content()
                .frame(maxWidth: .infinity, alignment: .leading)
                .faffEntrance(3)

            Spacer(minLength: 24)

            ctaButton(title: "Continue", enabled: enabled) { runNext() }
                .faffEntrance(4)
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
                          desc: "You follow a plan, race often, and think in phases and paces.")
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
                        .font(.body(17, weight: .extraBold))
                        .foregroundStyle(on ? Color(hex: 0x0A0C10) : Theme.txt)
                    Text(desc)
                        .font(.body(13, weight: .medium))
                        .foregroundStyle(on ? Color(hex: 0x0A0C10).opacity(0.72) : Theme.txt.opacity(0.55))
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(on ? Color(hex: 0x0A0C10) : Theme.txt.opacity(0.3))
            }
            .padding(18)
            .background(on ? Color.white : Color.white.opacity(0.07),
                        in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(on ? Color.white : Color.white.opacity(0.14), lineWidth: 1))
        }
        .buttonStyle(FaffPressStyle())
    }

    // Q1 — days per week
    private var runQ_daysPerWeek: some View {
        let opts: [(Int, String)] = [
            (0, "Not running right now"),
            (1, "1 day a week"),
            (2, "2 days a week"),
            (3, "3 days a week"),
            (4, "4 days a week"),
            (5, "5 days a week"),
            (6, "6 days a week")
        ]
        return runQ("How many days a week\ndo you run?",
                    context: "Count days you actually run — not strength or cross-training.",
                    enabled: weeklyFreq != nil) {
            VStack(spacing: 9) {
                ForEach(opts, id: \.0) { n, label in
                    selectRow(label, selected: weeklyFreq == n) {
                        withAnimation(Theme.Motion.smooth) { weeklyFreq = n }
                    }
                }
            }
        }
    }

    // Q2 — weekly mileage
    private var runQ_mileage: some View {
        let labels = ["Under 5 miles", "5 to 15 miles", "15 to 25 miles",
                      "25 to 35 miles", "35 to 45 miles", "45+ miles"]
        let vals = [0, 5, 15, 25, 35, 45]
        return runQ("What's your weekly\nmileage right now?",
                    context: "Approximate is fine — your current base, not a peak or goal.",
                    enabled: weeklyMi != nil) {
            VStack(spacing: 10) {
                ForEach(Array(labels.enumerated()), id: \.offset) { i, l in
                    selectRow(l, selected: weeklyMi == vals[i]) {
                        withAnimation(Theme.Motion.smooth) { weeklyMi = vals[i] }
                    }
                }
            }
        }
    }

    // Q3 — longest recent run
    private var runQ_longestRun: some View {
        let opts = ["0-3", "3-6", "6-10", "10+"]
        let labels = ["Up to 3 miles", "3 to 6 miles", "6 to 10 miles", "10+ miles"]
        return runQ("What's the longest run\nyou've done lately?",
                    context: "In the last 4 to 6 weeks. This sets your long-run floor.",
                    enabled: histLong != nil) {
            VStack(spacing: 10) {
                ForEach(Array(opts.enumerated()), id: \.offset) { i, key in
                    selectRow(labels[i], selected: histLong == key) {
                        withAnimation(Theme.Motion.smooth) { histLong = key }
                    }
                }
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
                        .font(.body(17, weight: .extraBold))
                        .foregroundStyle(on ? Color(hex: 0x0A0C10) : Theme.txt)
                    Text(sub)
                        .font(.body(13, weight: .medium))
                        .foregroundStyle(on ? Color(hex: 0x0A0C10).opacity(0.7) : Theme.txt.opacity(0.5))
                }
                Spacer()
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(on ? Color(hex: 0x0A0C10) : Theme.txt.opacity(0.3))
            }
            .padding(18)
            .background(on ? Color.white : Color.white.opacity(0.07),
                        in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(on ? Color.white : Color.white.opacity(0.14), lineWidth: 1))
        }
        .buttonStyle(FaffPressStyle())
    }

    // Q5 (hasRaced) — race entries
    private var runQ_raceEntries: some View {
        runQ("What are your\nbest results?",
             context: "Add up to 3. Finish time only — we'll do the math.") {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 10) {
                    ForEach($raceEntries) { $entry in
                        RaceEntryRow(entry: $entry, canRemove: raceEntries.count > 1) {
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
                                .font(.body(14, weight: .bold))
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
            .frame(maxHeight: 380)
        }
    }

    // Q5 (!hasRaced) / Q6 (hasRaced) — start date.
    // Wheel style (month / day / year) so the answer never reflows the way the
    // .graphical calendar jumps when a tapped date lands on a new week row.
    private var runQ_startDate: some View {
        runQ("When do you want\nto start?",
             context: "Pick any upcoming date. Your first week will be waiting.") {
            DatePicker("", selection: $startDate,
                       in: Calendar.current.startOfDay(for: Date())...,
                       displayedComponents: .date)
                .datePickerStyle(.wheel)
                .labelsHidden()
                .colorScheme(.dark)
                .frame(maxWidth: .infinity)
        }
    }

    // Q6 (!hasRaced) / Q7 (hasRaced) — long run day
    private var runQ_longRunDay: some View {
        let days: [(String, String)] = [
            ("sun", "Sunday"), ("mon", "Monday"), ("tue", "Tuesday"),
            ("wed", "Wednesday"), ("thu", "Thursday"), ("fri", "Friday"), ("sat", "Saturday")
        ]
        return runQ("Which day works\nfor your long run?",
                    context: "This becomes the anchor of your training week.") {
            VStack(spacing: 9) {
                ForEach(days, id: \.0) { key, label in
                    selectRow(label, selected: longRunDay == key) {
                        withAnimation(Theme.Motion.smooth) { longRunDay = key }
                    }
                }
            }
        }
    }

    // MARK: profile panel (physiology · optional)

    private var profilePanel: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                Text("STEP 3")
                    .font(.label(11)).tracking(3)
                    .foregroundStyle(Theme.txt.opacity(0.66))
                    .faffEntrance(0)
                Text("A bit about\nyou.")
                    .font(.heroDisplay(40))
                    .tracking(-1.5)
                    .foregroundStyle(Theme.txt)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 12)
                    .faffEntrance(1)
                Text("This helps calibrate your paces and zones. Skip anything you'd rather not share.")
                    .font(.body(15, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.84))
                    .lineSpacing(3)
                    .padding(.top, 14)
                    .faffEntrance(2)

                fieldLabel("DATE OF BIRTH").faffEntrance(3)
                dobField.faffEntrance(3)

                fieldLabel("SEX").faffEntrance(4)
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
                .faffEntrance(4)

                fieldLabel("HEIGHT · OPTIONAL").faffEntrance(5)
                heightField.faffEntrance(5)

                Spacer(minLength: 32)
                ctaButton(title: "Continue") {
                    go(forward: true) { step = 4 }
                }
                .faffEntrance(6)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .padding(.horizontal, 26)
            .padding(.bottom, 30)
        }
    }

    /// Date of birth · a tappable row that discloses month/day/year wheels.
    /// Collapsed until tapped so an untouched birthday stays honestly unset
    /// (nothing is sent unless the runner actually spins a wheel).
    @ViewBuilder
    private var dobField: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(Theme.Motion.smooth) { dobExpanded.toggle() }
            } label: {
                HStack {
                    Text(birthdaySet ? dobDisplay : "Tap to set your birthday")
                        .font(.body(15, weight: .semibold))
                        .foregroundStyle(birthdaySet ? Theme.txt : Theme.txt.opacity(0.6))
                    Spacer()
                    Image(systemName: dobExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.5))
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 16)
            }
            .buttonStyle(.plain)

            if dobExpanded {
                DatePicker("", selection: $birthday, in: dobRange, displayedComponents: .date)
                    .datePickerStyle(.wheel)
                    .labelsHidden()
                    .colorScheme(.dark)
                    .frame(maxWidth: .infinity)
                    .onChange(of: birthday) { _, _ in birthdaySet = true }
                    .padding(.bottom, 8)
            }
        }
        .background(Color.white.opacity(0.08),
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
            .stroke(Color.white.opacity(0.2), lineWidth: 1))
        .padding(.top, 6)
    }

    private var dobDisplay: String {
        let f = DateFormatter(); f.dateFormat = "MMM d, yyyy"
        return f.string(from: birthday)
    }

    /// Height · ft + in wheels behind a tappable disclosure. Stored as cm.
    @ViewBuilder
    private var heightField: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(Theme.Motion.smooth) { heightExpanded.toggle() }
            } label: {
                HStack {
                    Text(heightSet ? "\(heightFt) ft \(heightIn) in" : "Add height")
                        .font(.body(15, weight: .semibold))
                        .foregroundStyle(heightSet ? Theme.txt : Theme.txt.opacity(0.6))
                    Spacer()
                    Text(heightSet ? heightCmCaption : "unlocks cadence coaching")
                        .font(.body(12, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.5))
                    Image(systemName: heightExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.5))
                        .padding(.leading, 8)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 16)
            }
            .buttonStyle(.plain)

            if heightExpanded {
                HStack(spacing: 0) {
                    Picker("", selection: $heightFt) {
                        ForEach(3...7, id: \.self) { Text("\($0) ft").tag($0) }
                    }
                    .pickerStyle(.wheel)
                    .frame(maxWidth: .infinity)
                    .clipped()
                    Picker("", selection: $heightIn) {
                        ForEach(0...11, id: \.self) { Text("\($0) in").tag($0) }
                    }
                    .pickerStyle(.wheel)
                    .frame(maxWidth: .infinity)
                    .clipped()
                }
                .frame(height: 140)
                .colorScheme(.dark)
                .onChange(of: heightFt) { _, _ in heightSet = true }
                .onChange(of: heightIn) { _, _ in heightSet = true }
                .padding(.bottom, 8)
            }
        }
        .background(Color.white.opacity(0.08),
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
            .stroke(Color.white.opacity(0.2), lineWidth: 1))
        .padding(.top, 6)
    }

    private var heightCmCaption: String {
        let cm = Int((Double(heightFt) * 12 + Double(heightIn)) * 2.54)
        return "\(cm) cm"
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
            .padding(.top, 26)
    }

    // MARK: shared answer controls

    /// A full-width selectable pill row. Used for days/week, mileage, longest
    /// run, and long-run day — substantial, easy to tap, fills the canvas.
    private func selectRow(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(label)
                    .font(.body(16, weight: .extraBold))
                    .foregroundStyle(selected ? Color(hex: 0x0A0C10) : Theme.txt)
                Spacer()
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .black))
                        .foregroundStyle(Color(hex: 0x0A0C10))
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .background(selected ? Color.white : Color.white.opacity(0.07),
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(selected ? Color.white : Color.white.opacity(0.12), lineWidth: 1))
        }
        .buttonStyle(FaffPressStyle())
    }

    private func chip(text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text)
                .font(.body(13, weight: .extraBold))
                .foregroundStyle(on ? Color(hex: 0x0A0C10) : Theme.txt)
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
            Brandmark(size: 52, style: .swept)
                .padding(.bottom, 24)
                .faffEntrance(0)
            Text("YOU'RE ALL SET")
                .font(.label(11)).tracking(3)
                .foregroundStyle(Theme.txt.opacity(0.66))
                .faffEntrance(1)
            Text(firstName.map { "You're set,\n\($0)." } ?? "Let's build\na base.")
                .font(.heroDisplay(44))
                .tracking(-1.5)
                .foregroundStyle(Theme.txt)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 12)
                .faffEntrance(2)

            Text("Your training starts now. Add a race or set a goal from the Goals tab whenever you're ready, and Faff builds the plan around it.")
                .font(.body(15, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.84))
                .lineSpacing(3)
                .padding(.top, 14)
                .faffEntrance(3)

            Spacer(minLength: 0)

            if let err = onboardingError {
                Text(err)
                    .font(.body(12, weight: .semibold))
                    .foregroundStyle(Color(hex: 0xFC4D64))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, 8)
            }

            ctaButton(title: submitting ? "Saving…" : "Let's go") {
                guard !submitting else { return }
                submitting = true
                onboardingError = nil
                Task {
                    do {
                        _ = try await API.completeOnboarding(payload: onboardingPayload)
                        // Optional advanced fields that ride the profile PATCH
                        // (not part of the onboarding/complete contract).
                        var patch: [String: Any] = [:]
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
            .faffEntrance(4)
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
        .buttonStyle(FaffPressStyle())
        .disabled(!enabled)
    }
}

// MARK: - Press style
//
// Snappy tactile press — a small scale + dim on 120ms ease, the multi-property
// feedback that makes every tap feel responsive instead of flat.

struct FaffPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.92 : 1)
            .animation(Theme.Motion.tap, value: configuration.isPressed)
    }
}

// MARK: - Race entry row
//
// One self-reported result: distance chips, a tappable finish-time row that
// opens a wheel sheet (never typed), and a recency selector.

private struct RaceEntryRow: View {
    @Binding var entry: OnboardingView.RaceEntry
    let canRemove: Bool
    let onRemove: () -> Void

    @State private var showTime = false

    private let distOpts = ["5k", "10k", "half", "marathon"]
    private let distLabels = ["5K", "10K", "HALF", "FULL"]
    private let whenOpts = ["<6mo", "6-12mo", "1-2yr", "2+yr"]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                ForEach(Array(distOpts.enumerated()), id: \.offset) { i, key in
                    chip(distLabels[i], on: entry.distance == key) {
                        withAnimation(Theme.Motion.smooth) { entry.distance = key }
                    }
                }
                Spacer(minLength: 0)
            }

            Button { showTime = true } label: {
                HStack {
                    Text(entry.timeSec > 0 ? faffFormatTime(entry.timeSec) : "Set finish time")
                        .font(.body(17, weight: .bold))
                        .foregroundStyle(entry.timeSec > 0 ? Theme.txt : Theme.txt.opacity(0.5))
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.4))
                }
                .padding(.horizontal, 14).padding(.vertical, 13)
                .background(Color.white.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.white.opacity(0.18), lineWidth: 1))
            }
            .buttonStyle(.plain)

            HStack(spacing: 6) {
                ForEach(Array(whenOpts.enumerated()), id: \.offset) { _, key in
                    chip(key, on: entry.when == key) {
                        withAnimation(Theme.Motion.smooth) { entry.when = key }
                    }
                }
                Spacer(minLength: 0)
                if canRemove {
                    Button(action: onRemove) {
                        Image(systemName: "trash")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(0.6))
                            .frame(width: 36, height: 36)
                            .background(Color.white.opacity(0.08), in: Circle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(14)
        .background(Color.white.opacity(0.06),
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
            .stroke(Color.white.opacity(0.12), lineWidth: 1))
        .sheet(isPresented: $showTime) {
            TimeWheelSheet(distance: entry.distance, seconds: $entry.timeSec)
                .presentationDetents([.height(320)])
                .presentationDragIndicator(.visible)
        }
    }

    private func chip(_ t: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(t)
                .font(.body(12, weight: .extraBold))
                .foregroundStyle(on ? Color(hex: 0x0A0C10) : Theme.txt)
                .padding(.horizontal, 13).padding(.vertical, 8)
                .background(on ? Color.white : Color.white.opacity(0.1), in: Capsule())
                .overlay(Capsule().stroke(on ? Color.white : Color.white.opacity(0.2), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Finish-time wheel sheet
//
// Distance-aware finish-time picker. 5K/10K show min:sec; half/marathon add an
// hours wheel. Selecting beats typing — no keyboard, no parse errors.

private struct TimeWheelSheet: View {
    let distance: String
    @Binding var seconds: Int

    @Environment(\.dismiss) private var dismiss
    @State private var h = 0
    @State private var m = 0
    @State private var s = 0

    private var showHours: Bool { distance == "half" || distance == "marathon" }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                HStack {
                    Text("FINISH TIME")
                        .font(.label(12)).tracking(2.5)
                        .foregroundStyle(Theme.txt.opacity(0.6))
                    Spacer()
                    Button {
                        seconds = h * 3600 + m * 60 + s
                        dismiss()
                    } label: {
                        Text("Done")
                            .font(.body(15, weight: .bold))
                            .foregroundStyle(Theme.txt)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 22)
                .padding(.top, 20)
                .padding(.bottom, 4)

                HStack(spacing: 0) {
                    if showHours { wheel($h, range: 0...8, unit: "hr") }
                    wheel($m, range: 0...59, unit: "min")
                    wheel($s, range: 0...59, unit: "sec")
                }
                .frame(height: 190)
                .colorScheme(.dark)

                Spacer(minLength: 0)
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            h = seconds / 3600
            m = (seconds % 3600) / 60
            s = seconds % 60
        }
    }

    private func wheel(_ sel: Binding<Int>, range: ClosedRange<Int>, unit: String) -> some View {
        HStack(spacing: 2) {
            Picker("", selection: sel) {
                ForEach(range, id: \.self) { v in
                    Text(String(format: "%02d", v)).tag(v)
                }
            }
            .pickerStyle(.wheel)
            .frame(maxWidth: .infinity)
            .clipped()
            Text(unit)
                .font(.body(13, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.5))
        }
    }
}

/// Seconds → "m:ss" or "h:mm:ss".
private func faffFormatTime(_ sec: Int) -> String {
    let h = sec / 3600, m = (sec % 3600) / 60, s = sec % 60
    if h > 0 { return String(format: "%d:%02d:%02d", h, m, s) }
    return String(format: "%d:%02d", m, s)
}
