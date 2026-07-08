//
//  SettingsView.swift
//  Settings · units, training, notifications, connections, account.
//

import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var settings: UserSettings?
    @State private var profile: ProfileState?
    @State private var profileFields: ProfileFields?
    /// Field-key → current value, seeded from GET /api/profile + /api/settings
    /// and updated optimistically on save. Every editable row renders from this.
    @State private var vals: [String: SettingVal] = [:]
    @State private var editingField: SettingField? = nil
    @State private var toast: String? = nil
    /// 2026-06-01 · cycle ingest toggle. Gender-gated · row is only
    /// rendered when profile.identity.sex normalizes to female. Hydrated
    /// from HealthKitImporter.shared.cycleEnabled. Brief:
    /// designs/briefs/iphone-health-ingest-expansion-brief.md §2.
    @State private var cycleIngestOn: Bool = HealthKitImporter.shared.cycleEnabled

    /// Strava reconnect in-flight · disables the row to prevent double-taps
    /// while the OAuth browser is open. Reset when the session returns.
    @State private var stravaReconnecting: Bool = false
    /// Last-action banner under the Connections section. Cleared after
    /// 6 seconds so it doesn't linger.
    @State private var stravaToast: String? = nil
    /// 2026-06-01 · manual HK re-sync in-flight + result toast.
    @State private var healthResyncing: Bool = false
    @State private var healthResyncToast: String? = nil
    /// Observe the importer's @Published state so the row reflects
    /// status changes from any sync (foreground, manual, cycle-toggle).
    @ObservedObject private var hkImporter: HealthKitImporter = .shared

    var body: some View {
        ZStack {
            // Neutral black/grey mesh, matching every tab + the now-neutral
            // ProfileView so the whole settings flow reads consistent.
            FaffMeshView(mesh: .neutral)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    header
                        .padding(.horizontal, 22)
                        .padding(.top, 50)
                        .padding(.bottom, 18)

                    // Editable groups · data-driven, seeded from GET /api/profile
                    // + /api/settings. Each row opens the generic field editor.
                    // YOU / TRAINING / PHYSIOLOGY / TIMEZONE / RACE FUELING.
                    ForEach(SETTINGS_GROUPS) { group in
                        editableSection(group)
                    }

                    // HEALTH DATA · cycle ingest opt-in (2026-06-01).
                    // Row only renders for runners whose biological sex
                    // resolves to female. Default OFF · tapping ON fires
                    // the HK cycle-auth dialog and starts ingest. Copy
                    // is explicit about purpose so it doesn't read as
                    // creepy ("training adjustments not period
                    // predictions" per the brief's privacy note).
                    if isProfileFemale {
                        section("HEALTH DATA") {
                            VStack(spacing: 0) {
                                row(
                                    title: "Cycle tracking",
                                    subtitle: "training adjustments · not period predictions"
                                ) {
                                    FaffToggle(isOn: $cycleIngestOn)
                                }
                            }
                        }
                    }

                    // Notifications live in ProfileView's NotificationPrefsList
                    // (the real, persisted /api/profile/notifications panel).
                    // The fake toggles that used to sit here — dead @State that
                    // never persisted — were removed in the 2026-06-12
                    // settings consolidation.

                    section("CONNECTIONS") {
                        VStack(spacing: 0) {
                            // P2-33 (2026-07-06): was a dead label — tapping
                            // did nothing when never-connected. Now a real
                            // Button that fires the HK auth+import flow when
                            // not connected; three honest states instead of
                            // the old binary Synced/Connect (which lied for
                            // both "never asked" and "runner said no").
                            Button {
                                if !hkImporter.hasConnected { Task { await hkImporter.requestAuthAndImport(daysBack: 14) } }
                            } label: {
                                navRow(
                                    title: "Apple Health",
                                    subtitle: appleHealthStatusLine,
                                    value: appleHealthValueLabel,
                                    good: hkImporter.hasConnected
                                )
                            }
                            .buttonStyle(.plain)
                            .disabled(hkImporter.hasConnected || hkImporter.status == .requesting)
                            // 2026-06-01 · explicit manual re-sync trigger.
                            // The .onChange foreground refresh runs once per
                            // 30s but a runner who just installed a new
                            // TestFlight build wants confirmation the new
                            // data types (sleep stages, active energy density)
                            // are flowing without waiting for background sync
                            // serendipity. Tapping pulls the last 14 days
                            // and surfaces the row count toast so we can
                            // diagnose silently-dropped types from the field.
                            //
                            // P2-33: when never connected, this used to call
                            // importIfConnected — a silent no-op guarded on
                            // hasConnected — then report the stale/nil
                            // lastMessage as "Sync complete." Now routes
                            // through the real auth+import flow so the
                            // result (or the auth denial) is honest.
                            Button(action: forceHealthResync) {
                                navRow(
                                    title: "Re-sync Health (14d)",
                                    subtitle: healthSyncStatusLine,
                                    value: healthResyncing ? "Syncing…" : "Tap"
                                )
                            }
                            .buttonStyle(.plain)
                            .disabled(healthResyncing)
                            if let t = healthResyncToast {
                                Text(t)
                                    .font(.body(12, weight: .medium))
                                    .foregroundStyle(Theme.txt.opacity(0.7))
                                    .padding(.horizontal, 17)
                                    .padding(.vertical, 8)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            // Tappable Strava row · launches the OAuth flow
                            // via ASWebAuthenticationSession when tapped.
                            // Disabled while reconnecting so a double-tap
                            // doesn't spawn two sessions.
                            Button {
                                Task { await startStravaConnect() }
                            } label: {
                                navRow(
                                    title: "Strava",
                                    // P2-3 · needsReauth (dead/401'd token) reads
                                    // "Reconnect" instead of "Connect" — the runner
                                    // DID link Strava once, this isn't a first-time ask.
                                    value: stravaReconnecting ? "Opening…"
                                        : (profile?.connections.strava.connected == true ? "Synced"
                                           : (profile?.connections.strava.needsReauth == true ? "Reconnect" : "Connect")),
                                    good: profile?.connections.strava.connected == true
                                )
                            }
                            .buttonStyle(.plain)
                            .disabled(stravaReconnecting)
                            if let toast = stravaToast {
                                Text(toast)
                                    .font(.body(12, weight: .medium))
                                    .foregroundStyle(Theme.txt.opacity(0.7))
                                    .padding(.horizontal, 17)
                                    .padding(.vertical, 8)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            navRow(
                                title: "Apple Watch",
                                value: profile?.connections.appleWatch.connected == true ? "Paired" : "Not paired",
                                good: profile?.connections.appleWatch.connected == true
                            )
                        }
                    }

                    section("ACCOUNT") {
                        VStack(spacing: 0) {
                            row(title: "Email") {
                                Text(accountEmail)
                                    .font(.body(12, weight: .bold))
                                    .foregroundStyle(Theme.txt.opacity(0.7))
                                    .lineLimit(1)
                            }
                            row(title: "Faff Pro") {
                                Text("Free")
                                    .font(.body(12, weight: .bold))
                                    .foregroundStyle(Theme.txt.opacity(0.7))
                            }
                        }
                    }

                    signOutButton
                        .padding(.horizontal, 22)
                        .padding(.top, 22)

                    footer
                        .padding(.top, 22)
                        .padding(.bottom, 40)
                }
            }
        }
        .overlay(alignment: .bottom) {
            if let toast {
                Text(toast)
                    .font(.body(13, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .padding(.horizontal, 18).padding(.vertical, 11)
                    .background(Color(hex: 0x0E3B38), in: Capsule())
                    .overlay(Capsule().stroke(Theme.green.opacity(0.55), lineWidth: 1))
                    .padding(.bottom, 90)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(Theme.Motion.smooth, value: toast)
        .sheet(item: $editingField) { f in
            FieldEditorSheet(field: f, value: vals[f.key], autoMode: !tzModeIsManual, availableDays: availableDaysSet) { json in
                save(f, json)
            }
        }
        .task {
            async let s = (try? await API.fetchSettings())
            async let p = (try? await API.fetchProfileState())
            async let f = (try? await API.fetchProfile())
            let (st, pf, fields) = await (s, p, f)
            await MainActor.run {
                self.settings = st
                self.profile = pf
                if let pf { StravaConnection.set(pf.connections.strava.connected) }
                self.profileFields = fields
                seedVals(fields, st)
            }
        }
        .onChange(of: cycleIngestOn) { _, new in onCycleIngestChange(new) }
    }

    private var header: some View {
        HStack(spacing: 12) {
            BackChip { dismiss() }
            SpecLabel(text: "SETTINGS", size: 13, tracking: 2.5, color: Theme.txt)
            Spacer()
        }
    }

    /// Launch the Strava OAuth flow. Opens an in-app browser (shared
    /// cookies with Safari), waits for the runner to grant consent,
    /// catches the faff:// callback, then re-pulls profile state so
    /// the row flips to "Synced." Toast surfaces the outcome.
    @MainActor
    private func startStravaConnect() async {
        guard !stravaReconnecting else { return }
        stravaReconnecting = true
        stravaToast = nil
        let outcome = await StravaOAuthSession.shared.start()
        switch outcome {
        case .connected:
            stravaToast = "Strava connected · refreshing…"
            // Re-pull profile so the row flips. Settings prefetches via
            // .task on appear, but a manual refresh is cheap.
            if let p = try? await API.fetchProfileState() {
                self.profile = p
                StravaConnection.set(p.connections.strava.connected)
            }
            stravaToast = "Strava connected"
        case .failed(let reason):
            stravaToast = "Couldn't connect Strava: \(reason)"
        case .canceled:
            stravaToast = nil
        }
        stravaReconnecting = false
        // Auto-clear the toast after a moment so it doesn't linger.
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            if stravaToast?.contains("Strava connected") == true || stravaToast?.contains("Couldn't") == true {
                stravaToast = nil
            }
        }
    }

    private func section<Body: View>(_ title: String, @ViewBuilder content: () -> Body) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SpecLabel(text: title, color: Theme.txt.opacity(0.55))
                .padding(.horizontal, 22)
                .padding(.top, 18)
            content()
                .background(Color(hex: 0x061C1A).opacity(0.5),
                            in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(Color.white.opacity(0.13), lineWidth: 1))
                .background(.ultraThinMaterial,
                            in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .padding(.horizontal, 22)
        }
    }

    private func row<Trailing: View>(
        title: String,
        subtitle: String? = nil,
        @ViewBuilder trailing: () -> Trailing
    ) -> some View {
        HStack(spacing: 13) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body(15, weight: .bold))
                    .foregroundStyle(Theme.txt)
                if let subtitle {
                    Text(subtitle)
                        .font(.body(11, weight: .medium))
                        .foregroundStyle(Theme.txt.opacity(0.55))
                }
            }
            Spacer()
            trailing()
        }
        .padding(.horizontal, 17)
        .padding(.vertical, 15)
    }

    /// Normalize the existing `profile.identity.sex` freetext to a
    /// female yes/no for the cycle-ingest gate. Backend has a
    /// canonical `loadBiologicalSex` helper but it hasn't surfaced
    /// via the iPhone-facing profile endpoint yet · this mirrors its
    /// female-bucket rule (M/F + male/female/woman synonyms).
    /// Returns false on nil / unknown so cycle ingest stays off by
    /// default.
    private var isProfileFemale: Bool {
        guard let raw = profile?.identity.sex?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !raw.isEmpty else { return false }
        switch raw {
        case "f", "female", "woman": return true
        default: return false
        }
    }

    /// 2026-06-01 · Manual 14-day HK re-sync. Useful right after
    /// installing a TestFlight build that ships new sample types
    /// (sleep stages, active energy density, cycle phase) · the
    /// runner doesn't have to wait for the next foreground refresh
    /// or for HK background delivery to catch up.
    ///
    /// Surfaces the row count in a toast so we can diagnose silently-
    /// dropped types from the field (e.g. backend whitelist gap).
    private func forceHealthResync() {
        guard !healthResyncing else { return }
        healthResyncing = true
        healthResyncToast = nil
        Task {
            // P2-33: importIfConnected silently no-ops when the runner
            // never granted Health access — the old code then reported
            // the stale/nil lastMessage as "Sync complete." for a sync
            // that never ran. Route through the real auth+import flow
            // when not yet connected so a never-connected runner either
            // gets the auth prompt (and an honest result) or an honest
            // denial, never a fake success.
            if hkImporter.hasConnected {
                await hkImporter.importIfConnected(daysBack: 14)
            } else {
                await hkImporter.requestAuthAndImport(daysBack: 14)
            }
            await MainActor.run {
                healthResyncing = false
                // Surface the importer's own summary ("N runs · M vitals"),
                // or the auth-failure message set by requestAuthAndImport.
                // Never fabricate "Sync complete." when neither is set.
                healthResyncToast = hkImporter.lastMessage
                    ?? (hkImporter.hasConnected ? "Sync complete." : "Health access wasn't granted. Nothing synced.")
            }
            // Clear the toast after 8s so it doesn't linger forever.
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            await MainActor.run { healthResyncToast = nil }
        }
    }

    /// Subtitle line under the re-sync row · shows the last successful
    /// sync time so the runner knows whether the data is fresh.
    private var healthSyncStatusLine: String? {
        // P2-33: an honest "Never connected" beats "Never synced" for a
        // runner who has never granted access — "synced" implies a sync
        // was attempted.
        guard hkImporter.hasConnected else { return "Not connected. Tap Apple Health above" }
        guard let when = hkImporter.lastImportedAt else { return "Never synced" }
        let mins = Int(Date().timeIntervalSince(when) / 60)
        if mins < 1 { return "Just synced" }
        if mins < 60 { return "Synced \(mins)m ago" }
        let hrs = mins / 60
        if hrs < 24 { return "Synced \(hrs)h ago" }
        let days = hrs / 24
        return "Synced \(days)d ago"
    }

    /// P2-33 · three honest states for the Apple Health row:
    ///   never-connected → "Connect" (tappable, fires auth)
    ///   connected       → "Synced"
    ///   auth denied/failed (attempted, hasConnected still false) → "Denied"
    private var appleHealthValueLabel: String {
        if hkImporter.hasConnected { return "Synced" }
        if hkImporter.status == .requesting { return "Requesting…" }
        if hkImporter.status == .error { return "Denied" }
        return "Connect"
    }

    private var appleHealthStatusLine: String? {
        if hkImporter.hasConnected { return nil }
        if hkImporter.status == .error { return hkImporter.lastMessage ?? "Access denied. Enable in iOS Settings > Privacy > Health" }
        return nil
    }

    /// Handle a cycle-ingest toggle change · gates HK auth and writes
    /// the persisted flag. ON requests cycle auth then enables
    /// ingest; OFF just clears the flag (HK auth stays granted but
    /// we stop reading).
    private func onCycleIngestChange(_ newValue: Bool) {
        HealthKitImporter.shared.cycleEnabled = newValue
        if newValue {
            Task {
                _ = await HealthKitImporter.shared.requestCycleAuth()
                // Trigger one immediate sync so the runner sees data
                // start landing in the Health page without a foreground
                // bounce.
                await HealthKitImporter.shared.importIfConnected(daysBack: 7)
            }
        }
    }

    private func navRow(title: String, subtitle: String? = nil, value: String, good: Bool = false) -> some View {
        HStack(spacing: 13) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body(15, weight: .bold))
                    .foregroundStyle(Theme.txt)
                if let subtitle {
                    Text(subtitle)
                        .font(.body(11, weight: .medium))
                        .foregroundStyle(Theme.txt.opacity(0.55))
                }
            }
            Spacer()
            if !value.isEmpty {
                Text(value)
                    .font(.body(12, weight: .bold))
                    .foregroundStyle(good ? Theme.Accent.mintReady : Theme.txt.opacity(0.7))
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.txt.opacity(0.4))
        }
        .padding(.horizontal, 17)
        .padding(.vertical, 15)
        .contentShape(Rectangle())
    }

    private func segment(options: [String], on: String, choose: @escaping (String) -> Void) -> some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.self) { opt in
                Button { choose(opt) } label: {
                    Text(opt)
                        .font(.body(11, weight: .bold))
                        .foregroundStyle(opt == on ? Color(hex: 0x06302E) : Theme.txt.opacity(0.6))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(opt == on ? Color.white : Color.clear,
                                    in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(Color.white.opacity(0.1),
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    @State private var showSignOutConfirm: Bool = false

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
                Task { await performSignOut() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            // Apple sign-in is the canonical path but email is the live
            // fallback while the Apple Services-ID return URL is sorted.
            // Don't promise Apple-only when both work.
            Text("You'll need to sign in again to see your data.")
        }
    }

    private func performSignOut() async {
        // P2-38 · was a hand-rolled cleanup that had drifted from
        // ProfileView's (missed the cycle-ingest flag + never revoked the
        // server session). One shared helper now, used by both sign-out
        // surfaces — see SessionHygiene.swift.
        await SessionHygiene.signOut()
    }

    private var footer: some View {
        Text("Faff 3.0.0 · made for runners")
            .font(.body(10, weight: .semibold))
            .foregroundStyle(Theme.txt.opacity(0.4))
            .frame(maxWidth: .infinity)
    }

    private func push(_ patch: [String: Any]) {
        Task { try? await API.patchSettings(patch) }
    }

    // MARK: - Editable groups (data-driven · mirrors web SettingsPanel)

    private func editableSection(_ group: SettingGroup) -> some View {
        section(group.title) {
            VStack(spacing: 0) {
                ForEach(visibleFields(group)) { f in
                    Button { editingField = f } label: {
                        navRow(title: f.label, value: displayValue(f))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    /// The manual-zone row only matters when tz isn't auto-following travel.
    private func visibleFields(_ g: SettingGroup) -> [SettingField] {
        g.fields.filter { $0.key != "timezone" || tzModeIsManual }
    }

    private var tzModeIsManual: Bool {
        if case .str(let m)? = vals["tz_mode"] { return m == "manual" }
        return false
    }

    private var accountEmail: String {
        if case .str(let e)? = vals["email"], !e.isEmpty { return e }
        return profileFields?.email ?? "—"
    }

    /// Seed `vals` from the two GETs — profile fields + the settings block.
    private func seedVals(_ p: ProfileFields?, _ s: UserSettings?) {
        var v: [String: SettingVal] = [:]
        func putStr(_ k: String, _ x: String?) { if let x, !x.isEmpty { v[k] = .str(x) } }
        func putNum(_ k: String, _ x: Double?) { if let x { v[k] = .num(x) } }
        func putInt(_ k: String, _ x: Int?) { if let x { v[k] = .num(Double(x)) } }
        putStr("full_name", p?.full_name)
        putStr("email", p?.email)
        putStr("gender", p?.gender)
        putStr("birthday", p?.birthday.map { String($0.prefix(10)) })
        putNum("height_cm", p?.heightCm)
        putNum("weight_kg", p?.weightKg)
        putStr("experience_level", p?.experience_level)
        putInt("weekly_frequency", p?.weekly_frequency)
        putInt("weekly_mileage_target", p?.weekly_mileage_target)
        if let cm = p?.cross_training_modes { v["cross_training_modes"] = .list(cm) }
        putInt("lthr", p?.lthr)
        putInt("max_hr_override", p?.max_hr_override)
        putStr("timezone", p?.timezone)
        v["tz_mode"] = .str(p?.tz_mode ?? "auto")
        putStr("fuel_brand", p?.fuel_brand)
        putInt("fuel_gel_carbs_g", p?.fuel_gel_carbs_g)
        putInt("fuel_target_g_per_hr", p?.fuel_target_g_per_hr)
        putStr("long_run_day", s?.long_run_day)
        putStr("rest_day", s?.rest_day)
        if let q = s?.quality_days { v["quality_days"] = .list(q) }
        // P2-35 · always seed available_days (even []) so the row and the
        // conflict-copy check both read real server state, not "unset".
        v["available_days"] = .list(s?.available_days ?? [])
        putStr("briefing_time", s?.briefing_time)
        vals = v
    }

    /// P2-35 · the goal/race-setup availability constraint, when >=2 days
    /// are set. Read by the day/multiday editors to warn before a runner's
    /// long-run/rest/quality edit gets silently overridden by placement.
    private var availableDaysSet: Set<String> {
        if case .list(let a)? = vals["available_days"], a.count >= 2 { return Set(a) }
        return []
    }

    /// Optimistic local update + PATCH to the right endpoint. Surfaces the
    /// server's plan-rebuild ack ("Plan updated") when a plan-shaping edit
    /// triggers a rebuild — Today/Train re-fetch on their next appear.
    private func save(_ f: SettingField, _ json: Any?) {
        if let json, let w = wrap(json) { vals[f.key] = w } else { vals.removeValue(forKey: f.key) }
        editingField = nil
        Task {
            let body: [String: Any] = [f.key: json ?? NSNull()]
            do {
                let replanned = try (f.endpoint == .profile
                    ? await API.updateProfile(body)
                    : await API.patchSettings(body))
                if replanned {
                    await MainActor.run {
                        showToast("Plan updated")
                        // Re-fetch the plan surfaces — Today / Train / Goal / Activity
                        // all observe this — so the rebuilt plan shows without a relaunch.
                        NotificationCenter.default.post(name: .faffForegroundRefresh, object: nil)
                    }
                }
            } catch {
                // Don't pretend it saved. A swallowed error (e.g. an expired
                // session → 401) silently dropped the write and the optimistic
                // row lied that it stuck. Surface it + restore server truth.
                await MainActor.run { showToast("Couldn't save. Check your connection or sign in again") }
                async let fp = (try? await API.fetchProfile())
                async let fs = (try? await API.fetchSettings())
                let (p, s) = await (fp, fs)
                await MainActor.run { seedVals(p ?? profileFields, s ?? settings) }
            }
        }
    }

    private func wrap(_ json: Any) -> SettingVal? {
        if let s = json as? String { return .str(s) }
        if let d = json as? Double { return .num(d) }
        if let i = json as? Int { return .num(Double(i)) }
        if let a = json as? [String] { return .list(a) }
        return nil
    }

    private func showToast(_ s: String) {
        toast = s
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 2_600_000_000)
            if toast == s { toast = nil }
        }
    }

    // MARK: - Display formatting

    private func displayValue(_ f: SettingField) -> String {
        guard let val = vals[f.key] else { return f.autoSource ?? (f.kind == .multi ? "None" : "Not set") }
        switch f.kind {
        case .select:
            if case .str(let s) = val { return f.options.first { $0.value == s }?.label ?? s }
        case .timezoneSearch:
            // Full IANA id ("America/Los_Angeles") is more useful here
            // than a bare city label — it's the exact value that will be
            // sent, and disambiguates zones that share a UTC offset.
            if case .str(let s) = val, !s.isEmpty { return s }
        case .day:
            if case .str(let s) = val { return s.capitalized }
        case .multiday:
            if case .list(let a) = val, !a.isEmpty { return a.map { $0.capitalized }.joined(separator: " · ") }
            // Empty is a meaningful, distinct state per field — not "Not
            // set" (which implies the row was never touched):
            //   quality_days: []   → coach picks (P2-36)
            //   available_days: [] → no constraint, pickers below control it (P2-35)
            if f.key == "quality_days" { return "Auto · coach picks" }
            if f.key == "available_days" { return "Not set. Long run / Rest day / Quality days control it" }
        case .multi:
            if case .list(let a) = val, !a.isEmpty {
                return a.map { c in f.options.first { $0.value == c }?.label ?? c.capitalized }.joined(separator: " · ")
            }
            return "None"
        case .height:
            if case .num(let cm) = val { return cmToImperial(cm) }
        case .weight:
            if case .num(let kg) = val { return "\(Int((kg * 2.2046).rounded())) lb" }
        case .date:
            if case .str(let s) = val { return prettyDate(s) }
        case .tzmode:
            if case .str(let m) = val { return m == "manual" ? "Off" : "On" }
        case .text, .number:
            switch val {
            case .str(let s): return s.isEmpty ? "Not set" : (f.unit.map { "\(s) \($0)" } ?? s)
            case .num(let n):
                let base = n == n.rounded() ? "\(Int(n))" : String(format: "%.1f", n)
                return f.unit.map { "\(base) \($0)" } ?? base
            case .list: break
            }
        }
        return "Not set"
    }

    private func cmToImperial(_ cm: Double) -> String {
        let totalIn = cm / 2.54
        let ft = Int(totalIn / 12)
        let inch = Int((totalIn - Double(ft) * 12).rounded())
        return "\(ft)'\(inch)\""
    }

    private func prettyDate(_ ymd: String) -> String {
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.locale = Locale(identifier: "en_US_POSIX")
        guard let d = inF.date(from: String(ymd.prefix(10))) else { return ymd }
        let outF = DateFormatter(); outF.dateFormat = "d MMM yyyy"; outF.locale = Locale(identifier: "en_US")
        return outF.string(from: d)
    }
}

// MARK: - Settings field model (mirrors web SettingsPanel GROUPS)

enum SettingVal { case str(String); case num(Double); case list([String]) }

enum SettingEndpoint { case profile, settings }

// P2-40 · `timezoneSearch` is distinct from `select` — the chip grid that
// backs `.select` is unusable at ~400 IANA identifiers. A searchable list
// picker (FieldEditorSheet's `.timezoneSearch` case) replaces it.
enum SettingKind { case text, number, select, day, multiday, multi, date, height, weight, tzmode, timezoneSearch }

struct SettingOpt: Identifiable, Hashable { let value: String; let label: String; var id: String { value } }

struct SettingField: Identifiable {
    let key: String
    let label: String
    let endpoint: SettingEndpoint
    let kind: SettingKind
    var options: [SettingOpt] = []
    var unit: String? = nil
    var hint: String? = nil
    var planShaping: Bool = false
    var placeholder: String? = nil
    /// When set, an UNSET field shows this label instead of "Not set" — for
    /// values that auto-fill from Apple Health / connected data sources, so
    /// the runner knows they don't have to type them in.
    var autoSource: String? = nil
    var id: String { key }
}

struct SettingGroup: Identifiable {
    let title: String
    let fields: [SettingField]
    var id: String { title }
}

private let SETTINGS_DAYS: [SettingOpt] = [
    .init(value: "mon", label: "Mon"), .init(value: "tue", label: "Tue"),
    .init(value: "wed", label: "Wed"), .init(value: "thu", label: "Thu"),
    .init(value: "fri", label: "Fri"), .init(value: "sat", label: "Sat"),
    .init(value: "sun", label: "Sun"),
]
private let SETTINGS_EXPERIENCE: [SettingOpt] = [
    .init(value: "beginner", label: "Beginner"), .init(value: "intermediate", label: "Intermediate"),
    .init(value: "advanced", label: "Advanced"), .init(value: "advanced_plus", label: "Elite"),
]
private let SETTINGS_SEX: [SettingOpt] = [
    .init(value: "male", label: "Male"), .init(value: "female", label: "Female"), .init(value: "other", label: "Other"),
]
private let SETTINGS_CROSS: [SettingOpt] = [
    .init(value: "cycling", label: "Cycling"), .init(value: "swimming", label: "Swimming"),
    .init(value: "strength", label: "Strength"), .init(value: "elliptical", label: "Elliptical"),
    .init(value: "rowing", label: "Rowing"), .init(value: "yoga", label: "Yoga"),
]
// P2-40 · the old 15-zone SETTINGS_ZONES/zoneOpt chip-grid source was
// replaced by TimezoneSearchPicker, which reads TimeZone.
// knownTimeZoneIdentifiers directly (~400 IANA names vs. 15).

let SETTINGS_GROUPS: [SettingGroup] = [
    SettingGroup(title: "YOU", fields: [
        SettingField(key: "full_name", label: "Name", endpoint: .profile, kind: .text, placeholder: "Your name"),
        SettingField(key: "gender", label: "Sex", endpoint: .profile, kind: .select, options: SETTINGS_SEX, hint: "Used for readiness adjustments."),
        SettingField(key: "birthday", label: "Birthday", endpoint: .profile, kind: .date),
        SettingField(key: "height_cm", label: "Height", endpoint: .profile, kind: .height, hint: "Unlocks cadence coaching."),
        SettingField(key: "weight_kg", label: "Weight", endpoint: .profile, kind: .weight, hint: "Falls back to Apple Health when unset.", autoSource: "From Apple Health"),
        SettingField(key: "experience_level", label: "Experience", endpoint: .profile, kind: .select, options: SETTINGS_EXPERIENCE, planShaping: true),
    ]),
    SettingGroup(title: "TRAINING", fields: [
        SettingField(key: "weekly_frequency", label: "Days per week", endpoint: .profile, kind: .number, hint: "3 to 7.", planShaping: true),
        SettingField(key: "long_run_day", label: "Long run", endpoint: .settings, kind: .day, planShaping: true),
        SettingField(key: "rest_day", label: "Rest day", endpoint: .settings, kind: .day, planShaping: true),
        SettingField(key: "quality_days", label: "Quality days", endpoint: .settings, kind: .multiday, planShaping: true, hint: "Leave all off to let the coach pick."),
        SettingField(key: "weekly_mileage_target", label: "Weekly target", endpoint: .profile, kind: .number, unit: "mi", planShaping: true),
        SettingField(key: "cross_training_modes", label: "Cross-training", endpoint: .profile, kind: .multi, options: SETTINGS_CROSS),
        // P2-35 · goal/race setup's availability constraint. When >=2 days
        // are set here, the plan engine places long/quality/easy ONLY on
        // these days and overrides the pickers above — previously this was
        // invisible and un-clearable from Settings, so a runner's long-run
        // day edit appeared to silently fail. Exposing it as a real,
        // clearable field closes that gap.
        SettingField(key: "available_days", label: "Days you can run", endpoint: .settings, kind: .multiday, planShaping: true,
                     hint: "From goal setup. When set, this overrides Long run / Rest day / Quality days above. Clear it to let those pickers control placement."),
    ]),
    SettingGroup(title: "PHYSIOLOGY", fields: [
        SettingField(key: "lthr", label: "LTHR", endpoint: .profile, kind: .number, unit: "bpm", hint: "Sets your training zones.", autoSource: "From Apple Health"),
        SettingField(key: "max_hr_override", label: "Max HR", endpoint: .profile, kind: .number, unit: "bpm", hint: "Overrides the observed ceiling.", autoSource: "From Apple Health"),
    ]),
    SettingGroup(title: "TIMEZONE", fields: [
        SettingField(key: "tz_mode", label: "Auto-update on travel", endpoint: .profile, kind: .tzmode),
        // P2-40 · was a 15-zone chip grid (US + a handful of world
        // cities) — most of the world (Brazil/India/South Africa/NZ/etc.)
        // couldn't pin their real zone. Now searches the full
        // TimeZone.knownTimeZoneIdentifiers list; the server already
        // validates any IANA name, this was purely a client list gap.
        SettingField(key: "timezone", label: "Time zone", endpoint: .profile, kind: .timezoneSearch),
    ]),
    // Gel brand + carbs/gel are facts about the runner's product (legit
    // settings). Target intake RATE (g/hr) is a coaching prescription —
    // research-backed, per race distance/duration — so it's surfaced per
    // race at the coach level, not edited as a static preference here.
    SettingGroup(title: "RACE FUELING", fields: [
        SettingField(key: "fuel_brand", label: "Gel brand", endpoint: .profile, kind: .text, placeholder: "e.g. Maurten"),
        SettingField(key: "fuel_gel_carbs_g", label: "Carbs per gel", endpoint: .profile, kind: .number, unit: "g"),
    ]),
]

// MARK: - Generic field editor sheet

struct FieldEditorSheet: View {
    let field: SettingField
    let value: SettingVal?
    let autoMode: Bool
    /// P2-35 · the runner's goal-setup availability constraint (>=2 days,
    /// else empty). Used to show conflict copy on long_run_day / rest_day /
    /// quality_days when the picked day(s) fall outside it.
    var availableDays: Set<String> = []
    let onSave: (Any?) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var text: String
    @State private var day: String
    @State private var multi: [String]
    @State private var ft: Int
    @State private var inch: Int
    @State private var lb: Int
    @State private var autoOn: Bool
    @State private var date: Date

    init(field: SettingField, value: SettingVal?, autoMode: Bool, availableDays: Set<String> = [], onSave: @escaping (Any?) -> Void) {
        self.field = field; self.value = value; self.autoMode = autoMode
        self.availableDays = availableDays; self.onSave = onSave
        // Seed local editor state from the current value, per kind.
        var t = ""; var d = ""; var m: [String] = []
        var f = 5; var i = 9; var p = 150; var dt = Date()
        if let value {
            switch value {
            case .str(let s):
                t = s; d = s
                if field.kind == .date {
                    let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"; df.locale = Locale(identifier: "en_US_POSIX")
                    if let parsed = df.date(from: String(s.prefix(10))) { dt = parsed }
                }
            case .num(let n):
                t = n == n.rounded() ? "\(Int(n))" : String(format: "%.1f", n)
                if field.kind == .height {
                    let totalIn = n / 2.54
                    f = Int(totalIn / 12); i = Int((totalIn - Double(f) * 12).rounded())
                }
                if field.kind == .weight { p = Int((n * 2.2046).rounded()) }
            case .list(let a): m = a
            }
        }
        _text = State(initialValue: t)
        _day = State(initialValue: d)
        _multi = State(initialValue: m)
        _ft = State(initialValue: f)
        _inch = State(initialValue: i)
        _lb = State(initialValue: p)
        _autoOn = State(initialValue: autoMode)
        _date = State(initialValue: dt)
    }

    var body: some View {
        ZStack {
            Color(hex: 0x07211F).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text(field.label)
                        .font(.display(24, weight: .bold))
                        .foregroundStyle(Theme.txt)
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(0.6))
                    }
                    .buttonStyle(.plain)
                }
                if let hint = field.hint {
                    Text(hint)
                        .font(.body(13, weight: .medium))
                        .foregroundStyle(Theme.txt.opacity(0.5))
                }
                if let warn = conflictWarning {
                    Text(warn)
                        .font(.body(12.5, weight: .semibold))
                        .foregroundStyle(Theme.warnText)
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .background(Theme.goal.opacity(0.12),
                                    in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                ScrollView(showsIndicators: false) {
                    editor.frame(maxWidth: .infinity, alignment: .leading)
                }
                Button { commit() } label: {
                    Text("Save")
                        .font(.body(15, weight: .extraBold))
                        .foregroundStyle(Color(hex: 0x06302E))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .background(Theme.green, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .padding(24)
            .padding(.top, 10)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    /// P2-35 · live conflict copy shown while editing long_run_day /
    /// rest_day / quality_days when the goal-setup availability constraint
    /// (>=2 available_days) would silently override the picked day(s).
    /// Reads the in-flight @State (day/multi), not the seeded value, so it
    /// updates as the runner taps chips — before they hit Save and get
    /// surprised by a placement that doesn't match what they just picked.
    private var conflictWarning: String? {
        guard !availableDays.isEmpty else { return nil }
        switch field.key {
        case "long_run_day", "rest_day":
            guard !day.isEmpty, !availableDays.contains(day) else { return nil }
            return "\(day.capitalized) isn't in your available days (\(availableDaysLabel)). The plan will place this elsewhere unless you clear \"Days you can run\" below."
        case "quality_days":
            let outside = multi.filter { !availableDays.contains($0) }
            guard !outside.isEmpty else { return nil }
            return "\(outside.map { $0.capitalized }.joined(separator: ", ")) isn't in your available days (\(availableDaysLabel)). Those days will be skipped unless you clear \"Days you can run\" below."
        default:
            return nil
        }
    }

    private var availableDaysLabel: String {
        SETTINGS_DAYS.filter { availableDays.contains($0.value) }.map(\.label).joined(separator: " · ")
    }

    @ViewBuilder private var editor: some View {
        switch field.kind {
        case .text:
            TextField(field.placeholder ?? "", text: $text)
                .textFieldStyle(.plain)
                .font(.body(17, weight: .bold)).foregroundStyle(Theme.txt)
                .padding(14)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        case .number:
            TextField(field.unit ?? "Number", text: $text)
                .keyboardType(.numberPad)
                .font(.body(17, weight: .bold)).foregroundStyle(Theme.txt)
                .padding(14)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        case .date:
            DatePicker("", selection: $date, displayedComponents: .date)
                .datePickerStyle(.wheel).labelsHidden().colorScheme(.dark)
                .frame(maxWidth: .infinity)
        case .select:
            chips(field.options, selected: [text]) { v in text = v }
        case .timezoneSearch:
            TimezoneSearchPicker(selected: text) { v in text = v }
        case .day:
            chips(SETTINGS_DAYS, selected: [day]) { v in day = v }
        case .multiday:
            VStack(alignment: .leading, spacing: 10) {
                chips(SETTINGS_DAYS, selected: multi) { v in toggle(v) }
                // P2-36 · zero selection is a real, intentional state
                // ("let the coach pick") — say so instead of letting it
                // read as an unset row that silently strips quality work.
                if field.key == "quality_days" && multi.isEmpty {
                    Text("No days selected. The coach will pick quality days automatically.")
                        .font(.body(12, weight: .medium))
                        .foregroundStyle(Theme.txt.opacity(0.55))
                }
            }
        case .multi:
            chips(field.options, selected: multi) { v in toggle(v) }
        case .height:
            HStack(spacing: 14) {
                wheel(label: "FEET", value: $ft, range: 3...8)
                wheel(label: "INCHES", value: $inch, range: 0...11)
            }
        case .weight:
            wheel(label: "POUNDS", value: $lb, range: 60...400)
        case .tzmode:
            Toggle(isOn: $autoOn) {
                Text(autoOn ? "Following your device on travel" : "Pinned. Pick the zone next")
                    .font(.body(14, weight: .medium)).foregroundStyle(Theme.txt.opacity(0.8))
            }
            .tint(Theme.green)
        }
    }

    private func toggle(_ v: String) {
        if multi.contains(v) { multi.removeAll { $0 == v } } else { multi.append(v) }
    }

    private func chips(_ opts: [SettingOpt], selected: [String], tap: @escaping (String) -> Void) -> some View {
        let sel = Set(selected)
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 88), spacing: 8)], alignment: .leading, spacing: 8) {
            ForEach(opts) { o in
                let on = sel.contains(o.value)
                Button { tap(o.value) } label: {
                    Text(o.label)
                        .font(.body(13, weight: .bold))
                        .foregroundStyle(on ? Color(hex: 0x06302E) : Theme.txt.opacity(0.85))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(on ? Theme.green : Color.white.opacity(0.08),
                                    in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous)
                            .stroke(on ? Theme.green : Color.white.opacity(0.12), lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func wheel(label: String, value: Binding<Int>, range: ClosedRange<Int>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SpecLabel(text: label, size: 10, tracking: 1.5, color: Theme.txt.opacity(0.5))
            Picker(label, selection: value) {
                ForEach(Array(range), id: \.self) { Text("\($0)").tag($0) }
            }
            .pickerStyle(.wheel).labelsHidden().colorScheme(.dark).frame(height: 120)
        }
        .frame(maxWidth: .infinity)
    }

    private func commit() {
        switch field.kind {
        case .number:
            onSave(text.trimmingCharacters(in: .whitespaces).isEmpty ? nil : Double(text))
        case .height:
            onSave(Int(((Double(ft) * 12 + Double(inch)) * 2.54).rounded()))
        case .weight:
            onSave((Double(lb) / 2.2046 * 10).rounded() / 10)
        case .day:
            onSave(day.isEmpty ? nil : day)
        case .multiday, .multi:
            onSave(multi)
        case .tzmode:
            onSave(autoOn ? "auto" : "manual")
        case .date:
            let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"; df.locale = Locale(identifier: "en_US_POSIX")
            onSave(df.string(from: date))
        case .select, .timezoneSearch:
            onSave(text.isEmpty ? nil : text)
        case .text:
            let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
            onSave(t.isEmpty ? nil : t)
        }
        dismiss()
    }
}

// MARK: - Timezone search picker (P2-40)
//
// Replaces the 15-zone chip grid with a searchable list over the full
// TimeZone.knownTimeZoneIdentifiers set (~400 IANA names), grouped by
// region (the part before the first "/"). The server already validates
// any IANA name (setRunnerTimezone) — this was purely a client list gap.

private struct TimezoneSearchPicker: View {
    let selected: String
    let onPick: (String) -> Void

    @State private var query: String = ""

    /// All identifiers, grouped by region, computed once per view
    /// instance (cheap — a few hundred strings, sorted lazily by SwiftUI's
    /// List rendering, not resorted per keystroke beyond the filter pass).
    private static let allZones: [String] = TimeZone.knownTimeZoneIdentifiers.sorted()

    private var filtered: [String] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return Self.allZones }
        return Self.allZones.filter { $0.lowercased().contains(q) }
    }

    /// Region = the segment before the first "/" ("America", "Europe",
    /// "Asia", ...). Bare identifiers with no "/" (e.g. "UTC") group
    /// under "Other".
    private var grouped: [(region: String, zones: [String])] {
        var buckets: [String: [String]] = [:]
        var order: [String] = []
        for z in filtered {
            let region = z.contains("/") ? String(z.prefix(upTo: z.firstIndex(of: "/")!)) : "Other"
            if buckets[region] == nil { order.append(region) }
            buckets[region, default: []].append(z)
        }
        return order.sorted().map { ($0, buckets[$0] ?? []) }
    }

    private func displayLabel(_ z: String) -> String {
        let last = z.split(separator: "/").last.map { $0.replacingOccurrences(of: "_", with: " ") } ?? z
        return String(last)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.4))
                TextField("Search city or region", text: $query)
                    .textFieldStyle(.plain)
                    .font(.body(14, weight: .medium))
                    .foregroundStyle(Theme.txt)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            }
            .padding(.horizontal, 13).padding(.vertical, 11)
            .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

            // Fixed-height scroll list — the sheet already scrolls its
            // parent, so this list gets a bounded frame instead of
            // fighting for intrinsic height against ~400 rows.
            ScrollView(showsIndicators: false) {
                LazyVStack(alignment: .leading, spacing: 14) {
                    ForEach(grouped, id: \.region) { group in
                        VStack(alignment: .leading, spacing: 4) {
                            SpecLabel(text: group.region.replacingOccurrences(of: "_", with: " "),
                                      size: 9, tracking: 1.2, color: Theme.txt.opacity(0.45))
                                .padding(.horizontal, 4)
                            ForEach(group.zones, id: \.self) { z in
                                Button { onPick(z) } label: {
                                    HStack {
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(displayLabel(z))
                                                .font(.body(14, weight: .semibold))
                                                .foregroundStyle(Theme.txt)
                                            Text(z)
                                                .font(.body(10, weight: .medium))
                                                .foregroundStyle(Theme.txt.opacity(0.45))
                                        }
                                        Spacer()
                                        if z == selected {
                                            Image(systemName: "checkmark")
                                                .font(.system(size: 12, weight: .bold))
                                                .foregroundStyle(Theme.green)
                                        }
                                    }
                                    .padding(.horizontal, 12).padding(.vertical, 9)
                                    .background(z == selected ? Theme.green.opacity(0.12) : Color.white.opacity(0.04),
                                                in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    if grouped.isEmpty {
                        Text("No time zones match \"\(query)\"")
                            .font(.body(13, weight: .medium))
                            .foregroundStyle(Theme.txt.opacity(0.5))
                            .padding(.top, 20)
                    }
                }
            }
            .frame(maxHeight: 360)
        }
    }
}
