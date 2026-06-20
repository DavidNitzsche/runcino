//
//  ProfileView.swift
//  v3 Profile · reached via avatar in tab headers, not a sixth tab.
//

import SwiftUI

struct ProfileView: View {
    let onDismiss: () -> Void

    @State private var profile: ProfileState?
    @State private var meFacts: CoachFactsBlock?
    /// Full coach activity log (all reasons, last ~20). Toolkit · Family C.
    /// nil while loading; empty array renders the empty-state copy.
    @State private var coachIntents: [CoachIntent]?
    /// Notification prefs · drives NotificationPrefsList in the Settings
    /// section. Two-way binding · changes PATCH immediately.
    @State private var notifPrefs: NotificationPrefs?
    /// ProfileFields · carries strava_auto_push + phone_hr_alerts booleans
    /// the NotificationPrefsList exposes alongside the 7 categories. Plus
    /// the LTHR / HRmax / VDOT physiology values for the PHYSIOLOGY block.
    @State private var profileFields: ProfileFields?
    /// Strava reconnect in-flight — disables the row to prevent double-taps
    /// while the OAuth browser is open. Reset when the session returns.
    @State private var stravaReconnecting: Bool = false
    /// Outcome banner shown under the Connections card. Auto-clears after 6s.
    @State private var stravaToast: String? = nil
    // 2026-06-02 round 17 · showStravaPushes / showUsage state retired
    // along with the dev pills that triggered them. The sheets +
    // devButton helper below are also dropped · their state was the
    // last thing referencing them.

    var body: some View {
        ZStack {
            // Neutral black/grey mesh, matching every other tab. The warm
            // .profile mesh read as an off-palette "brownish" page (David).
            FaffMeshView(mesh: .neutral)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    headerRow
                        .padding(.horizontal, 24).padding(.top, 16)

                    userRow
                        .padding(.horizontal, 24).padding(.top, 22)

                    if !coachStats.isEmpty {
                        SectionLabel(title: "AT A GLANCE")
                            .padding(.horizontal, 22).padding(.top, 26)
                        coachStatsCard
                            .padding(.horizontal, 22).padding(.top, 12)
                    }

                    // PHYSIOLOGY · LTHR / HRmax / VDOT bold-numeric tiles
                    // plus a ProvenanceLine under each that explains where
                    // the number came from (race-calibrated / estimated /
                    // stale). Toolkit · Family B (StatTile + ProvenanceLine).
                    if hasPhysiology {
                        SectionLabel(title: "PHYSIOLOGY")
                            .padding(.horizontal, 22).padding(.top, 30)
                        physiologyGrid
                            .padding(.horizontal, 22).padding(.top, 12)
                    }

                    if let shoes = profile?.shoes, !shoes.isEmpty {
                        SectionLabel(title: "SHOE GARAGE")
                            .padding(.horizontal, 22).padding(.top, 30)
                        shoeCarousel(shoes)
                            .padding(.top, 13)
                    }

                    SectionLabel(title: "CONNECTED")
                        .padding(.horizontal, 22).padding(.top, 30)
                    connectionsCard
                        .padding(.horizontal, 22).padding(.top, 13)

                    // COACH ACTIVITY moved out of the main scroll → it's a sheet
                    // behind a "Coach activity" row in the settings card below.
                    // Most runners never read it; it shouldn't push settings far
                    // down the page.

                    // NOTIFICATIONS · 7-category panel from
                    // /api/profile/notifications. Toolkit · NotificationPrefsList.
                    // Also surfaces strava_auto_push + phone_hr_alerts as
                    // bonus rows when ProfileFields has loaded · those two
                    // live on /api/profile not /api/profile/notifications.
                    SectionLabel(title: "NOTIFICATIONS")
                        .padding(.horizontal, 22).padding(.top, 30)
                    NotificationPrefsList(
                        prefs: $notifPrefs,
                        // Auto-push toggle only when Strava is linked (passing
                        // nil hides the row · product rule 2026-06-20).
                        stravaAutoPush: (profileFields == nil || profile?.connections.strava.connected != true) ? nil : Binding(
                            get: { profileFields?.strava_auto_push ?? false },
                            set: { v in
                                profileFields?.strava_auto_push = v
                                Task { _ = try? await API.updateProfile(["strava_auto_push": v]) }
                            }
                        ),
                        phoneHrAlerts: profileFields == nil ? nil : Binding(
                            get: { profileFields?.phone_hr_alerts ?? false },
                            set: { v in
                                profileFields?.phone_hr_alerts = v
                                Task { _ = try? await API.updateProfile(["phone_hr_alerts": v]) }
                            }
                        ),
                        onPrefChange: { p in
                            Task { _ = try? await API.patchNotificationPrefs(p) }
                        })
                        .padding(.horizontal, 22).padding(.top, 13)

                    // SETTINGS · deep-links into the consolidated, fully-wired
                    // SettingsView (YOU / TRAINING / PHYSIOLOGY / TIMEZONE /
                    // FUELING / CONNECTIONS). The fake briefing/long-run/rest
                    // placeholder rows that used to sit here were removed in the
                    // 2026-06-12 settings consolidation — they're real and
                    // editable in SettingsView now.
                    SectionLabel(title: "SETTINGS")
                        .padding(.horizontal, 22).padding(.top, 28)
                    settingsCard
                        .padding(.horizontal, 22).padding(.top, 13)

                    // 2026-06-02 round 17 · dev pills (Strava pushes /
                    // LLM spend) retired from ProfileView. They were
                    // power-user chrome that read as confusing app UI
                    // for runners. The signOutButton replaces them as
                    // the canonical bottom-of-Settings affordance ·
                    // runners need a way to sign out and this surface
                    // is where they'll look first.
                    signOutButton
                        .padding(.horizontal, 22).padding(.top, 24)
                }
                .padding(.bottom, 80)
            }
        }
        .task { await reload() }
        .refreshable { await reload() }
        .sheet(item: $glossaryEntry) { e in GlossarySheet(entry: e) }
        .sheet(isPresented: $showNameEdit) { nameEditSheet }
        .sheet(isPresented: $showCoachActivity) { coachActivitySheet }
    }

    /// 2026-06-02 · Sign-out button shipped to ProfileView's bottom.
    /// Mirrors SettingsView.signOutButton (same destructive styling,
    /// same confirm dialog, same gate-reset notification) so the two
    /// surfaces' sign-out paths stay symmetric.
    @State private var glossaryEntry: GlossaryEntry? = nil
    @State private var showSignOutConfirm: Bool = false
    @State private var showNameEdit: Bool = false
    @State private var nameDraft: String = ""
    @State private var showCoachActivity: Bool = false
    private var signOutButton: some View {
        Button {
            showSignOutConfirm = true
        } label: {
            Text("Sign out")
                .font(.body(14, weight: .extraBold))
                .foregroundStyle(Theme.over)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Color(hex: 0xFC4D64).opacity(0.14),
                            in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color(hex: 0xFC4D64).opacity(0.3), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .confirmationDialog("Sign out of Faff?", isPresented: $showSignOutConfirm, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) {
                performSignOut()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll need to sign in again to see your data.")
        }
    }

    private func performSignOut() {
        // Clear local session + the gate's "onboarded" flag so the next
        // launch lands on SignIn. Mirrors SettingsView.performSignOut().
        TokenStore.shared.clear()
        let d = UserDefaults.standard
        d.removeObject(forKey: "faff.onboarded")
        d.removeObject(forKey: "faff.health.connected.v2")
        StravaConnection.clear()
        AppCache.clearAll()
        NotificationCenter.default.post(name: .faffGateReset, object: nil)
    }
    // devButton helper retired with the dev pills.

    private func reload() async {
        async let p  = (try? await API.fetchProfileState())
        async let f  = (try? await API.fetchCoachFacts(surface: "me"))
        async let ci = (try? await API.fetchCoachIntents(limit: 20))
        async let np = (try? await API.fetchNotificationPrefs())
        async let pf = (try? await API.fetchProfile())
        let (pr, fc, intents, prefs, fields) = await (p, f, ci, np, pf)
        await MainActor.run {
            self.profile = pr
            if let pr { StravaConnection.set(pr.connections.strava.connected) }
            self.meFacts = fc
            self.coachIntents = intents ?? []
            self.notifPrefs = prefs ?? NotificationPrefs.defaults
            self.profileFields = fields
        }
    }

    // MARK: - Toolkit · PHYSIOLOGY block (StatTile + ProvenanceLine)

    /// True when at least one of LTHR / HRmax / VDOT has a value or
    /// a stale-needs-update affordance worth surfacing. The grid hides
    /// entirely on a profile that has zero physiology data so we don't
    /// render three "—" placeholders.
    private var hasPhysiology: Bool {
        let lthr = profile?.physiology.lthr ?? profileFields?.lthr
        let mhr  = profile?.physiology.max_hr ?? profileFields?.maxhr
        let vdot = profile?.physiology.vdot
        return (lthr != nil) || (mhr != nil) || (vdot != nil)
    }

    @ViewBuilder
    private var physiologyGrid: some View {
        let lthr = profile?.physiology.lthr ?? profileFields?.lthr
        let mhr  = profile?.physiology.max_hr ?? profileFields?.maxhr
        let vdot = profile?.physiology.vdot
        let lthrSource = profile?.physiology.lthr_method
        let mhrSource = profile?.physiology.max_hr_source
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                StatTile(value: lthr.map(String.init) ?? "—", label: "LTHR",
                         explainText: "WHY ▾",
                         onExplain: { glossaryEntry = GlossaryEntry.entry(for: "lthr") })
                StatTile(value: mhr.map(String.init) ?? "—", label: "MAX HR",
                         explainText: "WHY ▾",
                         onExplain: { glossaryEntry = GlossaryEntry.entry(for: "hrmax") })
                StatTile(value: vdot.map { String(Int($0)) } ?? "—", label: "VDOT",
                         explainText: "WHY ▾",
                         onExplain: { glossaryEntry = GlossaryEntry.entry(for: "vdot") })
            }
            if let kind = provenanceKindForLTHR(value: lthr, source: lthrSource) {
                ProvenanceLine(kind: kind).frame(maxWidth: .infinity, alignment: .leading)
            }
            if let kind = provenanceKindForMaxHR(value: mhr, source: mhrSource) {
                ProvenanceLine(kind: kind).frame(maxWidth: .infinity, alignment: .leading)
            }
            if let kind = provenanceKindForVDOT(value: vdot) {
                ProvenanceLine(kind: kind).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    /// Map physiology source strings to the toolkit's ProvenanceKind so
    /// each number gets a runner-readable "where did this come from" line.
    private func provenanceKindForLTHR(value: Int?, source: String?) -> ProvenanceKind? {
        guard value != nil else { return nil }
        switch source {
        case "race_half":     return .raceCalibrated(raceName: "last half", dateLabel: "")
        case "race_marathon": return .raceCalibrated(raceName: "last marathon", dateLabel: "")
        case "manual":        return .manual
        default:              return .estimated(method: "your max HR")
        }
    }
    private func provenanceKindForMaxHR(value: Int?, source: String?) -> ProvenanceKind? {
        guard value != nil else { return nil }
        switch source {
        case "observed":     return .raceCalibrated(raceName: "hardest recorded effort", dateLabel: "")
        case "lthr-derived": return .estimated(method: "lthr × Friel factor")
        case "manual":       return .manual
        case "formula":      return .estimated(method: "age formula · add a max effort to calibrate")
        default:             return .estimated(method: "age formula · add a max effort to calibrate")
        }
    }
    private func provenanceKindForVDOT(value: Double?) -> ProvenanceKind? {
        guard value != nil else { return nil }
        return .raceCalibrated(raceName: "recent race PR", dateLabel: "")
    }

    // MARK: - Toolkit · SETTINGS rows (SettingValueRow)


    private var coachStats: [CoachFact] {
        meFacts?.facts ?? []
    }

    private var coachStatsCard: some View {
        GlassTile(padding: 0) {
            VStack(spacing: 0) {
                ForEach(Array(coachStats.enumerated()), id: \.element.label) { i, f in
                    // The SHOES glance row opens the shoe garage; the rest
                    // are read-only summaries.
                    if f.label.uppercased().contains("SHOE") {
                        NavigationLink(value: FaffRoute.shoes) {
                            glanceRow(f, tappable: true)
                        }
                        .buttonStyle(.plain)
                    } else {
                        glanceRow(f, tappable: false)
                    }
                    if i < coachStats.count - 1 {
                        Divider().background(Color.white.opacity(0.08))
                    }
                }
            }
        }
    }

    private func glanceRow(_ f: CoachFact, tappable: Bool) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                SpecLabel(text: f.label, size: 10, tracking: 1.5, color: Theme.txt.opacity(0.55))
                if let meta = f.meta, !meta.isEmpty {
                    Text(meta)
                        .font(.body(11, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.6))
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 12)
            Text(f.value)
                .font(.body(15, weight: .bold))
                .foregroundStyle(factColor(f.valueColor))
                .multilineTextAlignment(.trailing)
            if tappable {
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.4))
                    .padding(.leading, 2)
            }
        }
        .padding(14)
        .contentShape(Rectangle())
    }

    private func factColor(_ tone: String?) -> Color {
        switch (tone ?? "").lowercased() {
        case "race":  return Theme.race
        case "green": return Theme.green
        case "amber": return Theme.goal
        case "over":  return Theme.over
        default:      return Theme.txt
        }
    }

    private var headerRow: some View {
        HStack {
            SpecLabel(text: "YOU", size: 13, tracking: 2.5, color: Theme.txt)
            Spacer()
            Button { onDismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .frame(width: 38, height: 38)
                    .background(Theme.Glass.fill, in: Circle())
                    .overlay(Circle().stroke(Theme.Glass.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }

    private var userRow: some View {
        HStack(spacing: 16) {
            Text(initials)
                .font(.display(26, weight: .bold))
                .foregroundStyle(Theme.txt)
                .frame(width: 74, height: 74)
                .background(
                    LinearGradient(colors: [Color(hex: 0x62E08A), Color(hex: 0x3FB6B0)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: Circle()
                )
            VStack(alignment: .leading, spacing: 4) {
                // Tap the name to edit it inline — easier than going into
                // Settings. PATCHes /api/profile { full_name }, then reloads.
                Button {
                    nameDraft = profile?.identity.full_name ?? ""
                    showNameEdit = true
                } label: {
                    HStack(spacing: 7) {
                        Text(profile?.identity.full_name ?? "Add your name")
                            .font(.display(24, weight: .bold))
                            .foregroundStyle(profile?.identity.full_name == nil ? Theme.txt.opacity(0.55) : Theme.txt)
                        Image(systemName: "pencil")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(0.4))
                    }
                }
                .buttonStyle(.plain)
                Text(subtitleLine)
                    .font(.body(13, weight: .medium))
                    .foregroundStyle(Theme.txt.opacity(0.7))
            }
            Spacer()
        }
    }

    private var nameEditSheet: some View {
        ZStack {
            Color(hex: 0x07211F).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 18) {
                Text("Your name")
                    .font(.display(24, weight: .bold)).foregroundStyle(Theme.txt)
                TextField("Your name", text: $nameDraft)
                    .textFieldStyle(.plain)
                    .font(.body(17, weight: .bold)).foregroundStyle(Theme.txt)
                    .autocorrectionDisabled()
                    .padding(14)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                Spacer()
                Button { saveName() } label: {
                    Text("Save")
                        .font(.body(15, weight: .extraBold))
                        .foregroundStyle(Color(hex: 0x06302E))
                        .frame(maxWidth: .infinity).padding(.vertical, 15)
                        .background(Theme.green, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .padding(24).padding(.top, 12)
        }
        .presentationDetents([.height(250)])
    }

    private func saveName() {
        let n = nameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        showNameEdit = false
        let value: Any = n.isEmpty ? NSNull() : n
        Task {
            try? await API.updateProfile(["full_name": value])
            await reload()
        }
    }

    private var coachActivitySheet: some View {
        ZStack {
            FaffMeshView(mesh: .neutral).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    SpecLabel(text: "COACH ACTIVITY", size: 13, tracking: 2.5, color: Theme.txt)
                    Spacer()
                    Button { showCoachActivity = false } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(0.6))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 22).padding(.top, 24).padding(.bottom, 14)
                ScrollView(showsIndicators: false) {
                    CoachActivityTimeline(intents: coachIntents)
                        .padding(.horizontal, 22).padding(.bottom, 30)
                }
            }
        }
        .presentationDetents([.large, .medium])
        .presentationDragIndicator(.visible)
    }

    /// Avatar initials · delegates to ProfileIdentity.avatarInitials. Falls
    /// back to "FA" (Faff) here only — the dedicated profile screen wants
    /// something rendered even when no name is on file, whereas the page-
    /// header avatars on Today / Activity / Targets / Train render clean.
    private var initials: String {
        let derived = profile?.identity.avatarInitials ?? ""
        return derived.isEmpty ? "FA" : derived
    }
    private var subtitleLine: String {
        var parts: [String] = []
        if let c = profile?.identity.city { parts.append(c) }
        if let exp = profile?.identity.experience_level?.capitalized { parts.append(exp) }
        return parts.joined(separator: " · ")
    }

    private var statRow: some View {
        StatRow(stats: [
            Stat(value: "—", key: "DAY STREAK"),
            Stat(value: "—", key: "THIS YEAR"),
            Stat(value: profile?.nextARace.map { "\($0.days_to_race)d" } ?? "—", key: "NEXT RACE")
        ], valueFont: 20, keyColor: Theme.txt.opacity(0.55))
    }

    private func shoeCarousel(_ shoes: [ProfileShoe]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(shoes) { s in
                    NavigationLink(value: FaffRoute.shoes) {
                        ShoeCompact(shoe: FaffShoe(
                            id: s.id,
                            brand: s.brand ?? "",
                            name: s.name ?? [s.brand, s.model].compactMap { $0 }.joined(separator: " "),
                            roles: roleFor(s),
                            miles: s.mileage ?? 0,
                            lifeMi: s.cap ?? 450,
                            retired: s.retired ?? false
                        ))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 22)
        }
    }
    private func roleFor(_ s: ProfileShoe) -> [String] {
        let types = (s.runTypes ?? []).map { $0.uppercased() }
        if !types.isEmpty { return types }
        if s.preferred ?? false { return ["RACE"] }
        return ["EASY"]
    }

    private var connectionsCard: some View {
        GlassTile(padding: 0) {
            VStack(spacing: 0) {
                connectionRow("Apple Health", state: profile?.connections.appleHealth)
                // Strava row only when linked (product rule 2026-06-20:
                // Strava is hidden until connected; the connect door lives in
                // Settings → Connections, not here). A linked runner still
                // sees it so they can check sync / reconnect.
                if profile?.connections.strava.connected == true {
                    Divider().background(Color.white.opacity(0.08))
                    Button { Task { await startStravaConnect() } } label: {
                        connectionRow("Strava",
                                      state: profile?.connections.strava,
                                      reconnecting: stravaReconnecting)
                    }
                    .buttonStyle(.plain)
                    .disabled(stravaReconnecting)
                    if let toast = stravaToast {
                        Text(toast)
                            .font(.body(12, weight: .medium))
                            .foregroundStyle(Theme.txt.opacity(0.7))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                Divider().background(Color.white.opacity(0.08))
                connectionRow("Apple Watch", state: profile?.connections.appleWatch)
            }
        }
    }

    private func connectionRow(_ name: String,
                                state: ProfileConnectionState?,
                                reconnecting: Bool = false) -> some View {
        let on = state?.connected ?? false
        return HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.body(15, weight: .extraBold)).foregroundStyle(Theme.txt)
                Text(state?.note ?? "—")
                    .font(.body(11, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.6))
                    .lineLimit(1)
            }
            Spacer()
            Text(reconnecting ? "Opening…" : (on ? "SYNCED" : "CONNECT"))
                .font(.body(12, weight: .semibold))
                .foregroundStyle(on ? Theme.Accent.mintReady : Theme.txt.opacity(0.7))
        }
        .padding(14)
    }

    /// Launch the Strava OAuth flow. Mirrors SettingsView.startStravaConnect —
    /// ProfileView is the most-discoverable surface so it needs the same action.
    @MainActor
    private func startStravaConnect() async {
        guard !stravaReconnecting else { return }
        stravaReconnecting = true
        stravaToast = nil
        let outcome = await StravaOAuthSession.shared.start()
        switch outcome {
        case .connected:
            stravaToast = "Strava connected · refreshing…"
            if let p = try? await API.fetchProfileState() { self.profile = p; StravaConnection.set(p.connections.strava.connected) }
            stravaToast = "Strava connected"
        case .failed(let reason):
            stravaToast = "Couldn't connect Strava: \(reason)"
        case .canceled:
            stravaToast = nil
        }
        stravaReconnecting = false
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            if stravaToast?.contains("Strava connected") == true ||
               stravaToast?.contains("Couldn't") == true {
                stravaToast = nil
            }
        }
    }

    private var settingsCard: some View {
        GlassTile(padding: 0) {
            VStack(spacing: 0) {
                settingsRow("Profile & training", value: nil, route: .settings)
                Divider().background(Color.white.opacity(0.08))
                settingsRow("Shoe garage", value: nil, route: .shoes)
                Divider().background(Color.white.opacity(0.08))
                settingsRow("Faff Pro", value: nil, route: .pro)
                Divider().background(Color.white.opacity(0.08))
                Button { showCoachActivity = true } label: {
                    HStack {
                        Text("Coach activity")
                            .font(.body(15, weight: .extraBold)).foregroundStyle(Theme.txt)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.5))
                    }
                    .padding(14)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }
    private func settingsRow(_ title: String, value: String?, route: FaffRoute) -> some View {
        NavigationLink(value: route) {
            HStack {
                Text(title).font(.body(15, weight: .extraBold)).foregroundStyle(Theme.txt)
                Spacer()
                if let v = value { Text(v).font(.body(12, weight: .semibold)).foregroundStyle(Theme.txt.opacity(0.7)) }
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.5))
            }
            .padding(14)
            // Make the WHOLE row tappable, not just the text/chevron glyphs —
            // the Spacer gap was dead space, so taps in the middle missed.
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
