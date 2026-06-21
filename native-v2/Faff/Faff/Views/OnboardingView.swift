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

    // Running level (Standard depth). weeklyFreq + weeklyMi seed plan shape
    // and volume; histLong/histYears seed the long-run floor + experience.
    @State private var weeklyFreq: Int = 4          // 3...6 days/week
    @State private var weeklyMi: Int = 25           // 15/25/35/45/55 mi/week
    @State private var histLong: String? = nil      // "0-3"|"3-6"|"6-10"|"10+"
    @State private var histYears: String? = nil     // "<1"|"1-3"|"3-7"|"7+"

    // Schedule. startOffset → startDate (today/tomorrow/+2d); longRunDay is a
    // durable preference. Both ride the payload even though no plan is built
    // at onboarding — they pre-seed user_prefs / user_settings so the first
    // plan (built when a goal/race is added) honors them.
    @State private var startOffset: Int = 0         // 0=today, 1=tomorrow, 2=+2d
    @State private var longRunDay: String = "sun"   // sun..sat

    // Race history (Standard). Self-reported PRs seed VDOT + coach voice band.
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
        let startDate = isoF.string(from: Calendar.current.date(byAdding: .day, value: startOffset, to: Date()) ?? Date())

        // Recent average ≈ current weekly target at cold start, so we don't
        // ask the same volume question twice. The precise baseline arrives
        // from Strava/Health once a goal or race is set later.
        let histAvg: String = {
            switch weeklyMi {
            case ..<20: return "5-15"
            case ..<30: return "15-25"
            case ..<40: return "25-35"
            default:    return "35+"
            }
        }()

        return [
            // No goal/race at onboarding — backend authors nothing on this path.
            "distance": "none",
            "date": NSNull(),
            "time": NSNull(),
            "ttDistance": NSNull(),
            "ttTime": NSNull(),
            "ttTimeSeconds": NSNull(),
            // Running level.
            "weeklyMi": weeklyMi,
            "weeklyFreq": weeklyFreq,
            "histAvg": histAvg,
            "histLong": (histLong as Any?) ?? NSNull(),
            "histYears": (histYears as Any?) ?? NSNull(),
            "raceHistory": serializedRaceHistory,
            // Schedule.
            "startDate": startDate,
            "longRunDay": longRunDay,
            // Identity — the person's name is set at signup. Send it when we
            // have it (the server preserves an existing full_name via COALESCE
            // either way); the placeholder only satisfies the required
            // non-empty check for the rare row with no name yet.
            "name": (firstName != nil ? runnerName! : "Runner"),
            "timezone": tz,
            // Physiology — only sent when the runner actually picked them.
            "birthday": birthdaySet ? isoF.string(from: birthday) as Any : NSNull(),
            "sex": (sex as Any?) ?? NSNull(),
            "height_cm": (parsedHeight as Any?) ?? NSNull(),
            // Honest connection state: skipped == nothing connected.
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

    // Five-step mesh: cool → hot.
    private let palettes: [FaffMesh] = [
        FaffMesh(c1: 0x7FE6D6, c2: 0x5AA9D6, c3: 0x2F7FAE, c4: 0x1F6A8A, c5: 0x1A5A7A, base: 0x08222E),
        FaffMesh(c1: 0x8EF0B0, c2: 0x34C194, c3: 0x1F8A8A, c4: 0x128A64, c5: 0x137259, base: 0x06382E),
        FaffMesh(c1: 0xE6E89A, c2: 0xC9C45E, c3: 0xA8B048, c4: 0x8E9A3C, c5: 0x7A8836, base: 0x3A3E14),
        FaffMesh(c1: 0xFFE0A0, c2: 0xF8B85F, c3: 0xE08A36, c4: 0xC96E2A, c5: 0xB46026, base: 0x5E2F12),
        FaffMesh(c1: 0xFFD27A, c2: 0xD03F3F, c3: 0xD6263C, c4: 0x9E1733, c5: 0xC01030, base: 0x420A1E)
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
                    runningPanel.opacity(step == 2 ? 1 : 0)
                    profilePanel.opacity(step == 3 ? 1 : 0)
                    confirmPanel.opacity(step == 4 ? 1 : 0)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .animation(Theme.Motion.smooth, value: step)
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
                    Color(hex: 0xD03F3F), Color(hex: 0xD6263C)
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

    // MARK: running panel (level · history · schedule)

    private var runningPanel: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                Text("STEP 2")
                    .font(.label(11)).tracking(3)
                    .foregroundStyle(Theme.txt.opacity(0.66))
                Text("Your running.")
                    .font(.display(38, weight: .bold))
                    .tracking(-1.5)
                    .foregroundStyle(Theme.txt)
                    .lineSpacing(-4)
                    .padding(.top, 12)
                Text("Where you are now, so the first plan fits you and not a template.")
                    .font(.body(15, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.84))
                    .lineSpacing(3)
                    .padding(.top, 14)

                fieldLabel("DAYS PER WEEK")
                chipRow([3, 4, 5, 6].map { ("\($0)", weeklyFreq == $0) }) { idx in
                    withAnimation(Theme.Motion.smooth) { weeklyFreq = [3, 4, 5, 6][idx] }
                }

                fieldLabel("WEEKLY MILEAGE NOW")
                chipRow([15, 25, 35, 45, 55].map { ($0 == 55 ? "55+" : "\($0)", weeklyMi == $0) }) { idx in
                    withAnimation(Theme.Motion.smooth) { weeklyMi = [15, 25, 35, 45, 55][idx] }
                }

                fieldLabel("LONGEST RECENT RUN · MI")
                let longOpts = ["0-3", "3-6", "6-10", "10+"]
                chipRow(longOpts.map { ($0, histLong == $0) }) { idx in
                    withAnimation(Theme.Motion.smooth) { histLong = longOpts[idx] }
                }

                fieldLabel("YEARS RUNNING")
                let yearOpts = ["<1", "1-3", "3-7", "7+"]
                chipRow(yearOpts.map { ($0, histYears == $0) }) { idx in
                    withAnimation(Theme.Motion.smooth) { histYears = yearOpts[idx] }
                }

                raceHistorySection

                fieldLabel("START")
                let startOpts = ["Today", "Tomorrow", "In 2 days"]
                chipRow(startOpts.enumerated().map { ($0.element, startOffset == $0.offset) }) { idx in
                    withAnimation(Theme.Motion.smooth) { startOffset = idx }
                }

                fieldLabel("LONG RUN DAY")
                HStack(spacing: 6) {
                    ForEach(Array(["sun", "mon", "tue", "wed", "thu", "fri", "sat"].enumerated()), id: \.offset) { idx, key in
                        chip(text: ["S", "M", "T", "W", "T", "F", "S"][idx], on: longRunDay == key) {
                            withAnimation(Theme.Motion.smooth) { longRunDay = key }
                        }
                    }
                }
                .padding(.top, 6)

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

    // MARK: race history

    @ViewBuilder
    private var raceHistorySection: some View {
        fieldLabel("RACE HISTORY")
        HStack(spacing: 8) {
            chip(text: "Haven't raced", on: !hasRaced) {
                withAnimation(Theme.Motion.smooth) { hasRaced = false }
            }
            chip(text: "I've raced", on: hasRaced) {
                withAnimation(Theme.Motion.smooth) {
                    hasRaced = true
                    if raceEntries.isEmpty { raceEntries = [RaceEntry()] }
                }
            }
            Spacer()
        }
        .padding(.top, 6)

        if hasRaced {
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
                            .foregroundStyle(Theme.txt.opacity(0.8))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(Color.white.opacity(0.08),
                                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.top, 10)
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
