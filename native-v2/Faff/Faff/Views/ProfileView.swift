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

    var body: some View {
        ZStack {
            FaffMeshView(mesh: FaffMesh.forView(.profile))

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

                    // COACH ACTIVITY · full history from /api/coach/intents.
                    // Toolkit · CoachActivityTimeline (Family C).
                    SectionLabel(title: "COACH ACTIVITY")
                        .padding(.horizontal, 22).padding(.top, 30)
                    CoachActivityTimeline(intents: coachIntents)
                        .padding(.horizontal, 22).padding(.top, 13)

                    // NOTIFICATIONS · 7-category panel from
                    // /api/profile/notifications. Toolkit · NotificationPrefsList.
                    // Also surfaces strava_auto_push + phone_hr_alerts as
                    // bonus rows when ProfileFields has loaded · those two
                    // live on /api/profile not /api/profile/notifications.
                    SectionLabel(title: "NOTIFICATIONS")
                        .padding(.horizontal, 22).padding(.top, 30)
                    NotificationPrefsList(
                        prefs: $notifPrefs,
                        stravaAutoPush: profileFields == nil ? nil : Binding(
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

                    // SETTINGS · daily briefing time + plan-schedule rows.
                    // Toolkit · SettingValueRow. Pickers themselves are
                    // deferred · row taps fire onTap so the picker can be
                    // wired in incrementally.
                    SectionLabel(title: "SETTINGS")
                        .padding(.horizontal, 22).padding(.top, 28)
                    settingValueRows
                        .padding(.horizontal, 22).padding(.top, 13)
                    settingsCard
                        .padding(.horizontal, 22).padding(.top, 10)
                }
                .padding(.bottom, 80)
            }
        }
        .task { await reload() }
        .refreshable { await reload() }
    }

    private func reload() async {
        async let p  = (try? await API.fetchProfileState())
        async let f  = (try? await API.fetchCoachFacts(surface: "me"))
        async let ci = (try? await API.fetchCoachIntents(limit: 20))
        async let np = (try? await API.fetchNotificationPrefs())
        async let pf = (try? await API.fetchProfile())
        let (pr, fc, intents, prefs, fields) = await (p, f, ci, np, pf)
        await MainActor.run {
            self.profile = pr
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
                StatTile(value: lthr.map(String.init) ?? "—", label: "LTHR")
                StatTile(value: mhr.map(String.init) ?? "—", label: "MAX HR")
                StatTile(value: vdot.map { String(Int($0)) } ?? "—", label: "VDOT")
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
        case "race_half":     return .raceCalibrated(raceName: "your last half", dateLabel: "")
        case "race_marathon": return .raceCalibrated(raceName: "your last marathon", dateLabel: "")
        case "manual":        return .manual
        default:              return .estimated(method: "lthr-derived from your max HR")
        }
    }
    private func provenanceKindForMaxHR(value: Int?, source: String?) -> ProvenanceKind? {
        guard value != nil else { return nil }
        switch source {
        case "observed":     return .raceCalibrated(raceName: "an observed max effort", dateLabel: "")
        case "lthr-derived": return .estimated(method: "lthr × Friel factor")
        case "manual":       return .manual
        case "formula":      return .estimated(method: "age formula · add a max effort to calibrate")
        default:             return .estimated(method: "age formula · add a max effort to calibrate")
        }
    }
    private func provenanceKindForVDOT(value: Double?) -> ProvenanceKind? {
        guard value != nil else { return nil }
        return .raceCalibrated(raceName: "your recent race PR", dateLabel: "")
    }

    // MARK: - Toolkit · SETTINGS rows (SettingValueRow)

    @ViewBuilder
    private var settingValueRows: some View {
        VStack(spacing: 0) {
            SettingValueRow(label: "Daily briefing",
                            value: briefingTimeLabel,
                            sub: nil,
                            onTap: { /* picker presentation deferred · row visible now */ })
            Divider().background(Color.white.opacity(0.06)).padding(.leading, 16)
            SettingValueRow(label: "Long run day",
                            value: longRunDayLabel,
                            sub: "Affects your plan layout · changing it redistributes the week",
                            onTap: { })
            Divider().background(Color.white.opacity(0.06)).padding(.leading, 16)
            SettingValueRow(label: "Rest day",
                            value: restDayLabel,
                            sub: nil,
                            onTap: { })
        }
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }

    private var briefingTimeLabel: String { "07:00" }   // placeholder until user_settings exposes briefing_time on profile.
    private var longRunDayLabel: String { "Saturday" }
    private var restDayLabel: String { "Monday" }

    private var coachStats: [CoachFact] {
        meFacts?.facts ?? []
    }

    private var coachStatsCard: some View {
        GlassTile(padding: 0) {
            VStack(spacing: 0) {
                ForEach(Array(coachStats.enumerated()), id: \.element.label) { i, f in
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 3) {
                            SpecLabel(text: f.label, size: 10, tracking: 1.5, color: Theme.txt.opacity(0.55))
                            if let meta = f.meta, !meta.isEmpty {
                                Text(meta)
                                    .font(.display(11, weight: .semibold))
                                    .foregroundStyle(Theme.txt.opacity(0.6))
                                    .lineLimit(2)
                            }
                        }
                        Spacer(minLength: 12)
                        Text(f.value)
                            .font(.display(15, weight: .bold))
                            .foregroundStyle(factColor(f.valueColor))
                            .multilineTextAlignment(.trailing)
                    }
                    .padding(14)
                    if i < coachStats.count - 1 {
                        Divider().background(Color.white.opacity(0.08))
                    }
                }
            }
        }
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
                Text(profile?.identity.full_name ?? "Faff Runner")
                    .font(.display(24, weight: .bold))
                    .foregroundStyle(Theme.txt)
                Text(subtitleLine)
                    .font(.body(13, weight: .medium))
                    .foregroundStyle(Theme.txt.opacity(0.7))
            }
            Spacer()
        }
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
                            role: roleFor(s),
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
    private func roleFor(_ s: ProfileShoe) -> String {
        if s.preferred ?? false { return "RACE" }
        return "EASY"
    }

    private var connectionsCard: some View {
        GlassTile(padding: 0) {
            VStack(spacing: 0) {
                connectionRow("Apple Health", state: profile?.connections.appleHealth)
                Divider().background(Color.white.opacity(0.08))
                connectionRow("Strava", state: profile?.connections.strava)
                Divider().background(Color.white.opacity(0.08))
                connectionRow("Apple Watch", state: profile?.connections.appleWatch)
            }
        }
    }

    /// One connection row · renders the server-supplied note (e.g.
    /// "Last sync 4h ago" / "Connect for auto-sync") instead of the
    /// previous static "workouts · heart · sleep" copy. State pill on
    /// the right flips green/SYNCED for connected, muted/CONNECT for
    /// not. lastSync ISO timestamp could power a stale-warning later;
    /// today we just trust the server's `note` string.
    private func connectionRow(_ name: String, state: ProfileConnectionState?) -> some View {
        let on = state?.connected ?? false
        return HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.body(15, weight: .extraBold)).foregroundStyle(Theme.txt)
                Text(state?.note ?? "—")
                    .font(.display(11, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.6))
                    .lineLimit(1)
            }
            Spacer()
            Text(on ? "SYNCED" : "CONNECT")
                .font(.display(12, weight: .semibold))
                .foregroundStyle(on ? Color(hex: 0x9AF0BF) : Theme.txt.opacity(0.7))
        }
        .padding(14)
    }

    private var settingsCard: some View {
        GlassTile(padding: 0) {
            VStack(spacing: 0) {
                settingsRow("Units & display", value: "Miles", route: .settings)
                Divider().background(Color.white.opacity(0.08))
                settingsRow("Notifications", value: nil, route: .settings)
                Divider().background(Color.white.opacity(0.08))
                settingsRow("Shoe garage", value: nil, route: .shoes)
                Divider().background(Color.white.opacity(0.08))
                settingsRow("Faff Pro", value: "Active", route: .pro)
            }
        }
    }
    private func settingsRow(_ title: String, value: String?, route: FaffRoute) -> some View {
        NavigationLink(value: route) {
            HStack {
                Text(title).font(.body(15, weight: .extraBold)).foregroundStyle(Theme.txt)
                Spacer()
                if let v = value { Text(v).font(.display(12, weight: .semibold)).foregroundStyle(Theme.txt.opacity(0.7)) }
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.5))
            }
            .padding(14)
        }
        .buttonStyle(.plain)
    }
}
