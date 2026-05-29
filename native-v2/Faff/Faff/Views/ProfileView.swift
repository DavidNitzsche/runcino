//
//  ProfileView.swift  (v3 chrome cutover · Phase 25b · 2026-05-28)
//
//  iPhone mirror of web-v2/app/profile/page.tsx. Wraps the page in the
//  shared FaffPageShell-equivalent (PageHeader) and rebuilds the same
//  five sections the web /profile renders:
//
//    1. PageHeader   "Profile." + eyebrow (NAME · GENDER · AGE · CITY)
//                    + AvatarCircle accent.
//    2. CoachSlot    Background-loaded identity-mode voice (unchanged).
//    3. PERSONAL     NAME · GENDER · BIRTHDAY · HEIGHT · CITY · EXPERIENCE
//                    grid of FieldCards.
//    4. PHYSIOLOGY · TRAINING ANCHORS
//                    LTHR · MAX HR · RESTING HR · VDOT grid of FieldCards
//                    (each with source + used-for subhint).
//    5. HR ZONES TABLE
//                    5 HRZoneRow rows (Z1 … Z5) rendered when the server
//                    returns a computed zones table.
//    6. SHOE ROTATION
//                    Per-shoe card with brand · model · miles + cap +
//                    last-used + retired flag.
//
//  Data still comes from /api/profile/state via API.fetchProfileState.
//  Missing fields render as "—" (never fabricated) per the constraint
//  in the issue brief.
//

import SwiftUI

struct ProfileView: View {
    @State private var showHeightSheet = false
    @State private var showSettingsSheet = false
    @State private var showManualRunSheet = false
    @State private var showOnboardingSheet = false
    // 2026-05-27 nav restructure: Log + Tips dropped out of the tab
    // bar (Today/Training/Races/Health/Profile = 5 primary). They live
    // here now as actions that push a sheet.
    @State private var showLogSheet = false
    @State private var showTipsSheet = false
    // Paper overhaul 2026-05-29 · 5→3 tab collapse (Today/Plan/Me): Health
    // lost its primary tab. It folds into ME here as a one-tap sheet —
    // same pattern as Log/Tips — so the readiness/body surface stays one
    // tap away. (Web equivalent: Health demoted to a /today link + chips.)
    @State private var showHealthSheet = false
    @StateObject private var tokenStore = TokenStore.shared
    // Hydrate from AppCache so identity + physiology + connections all
    // paint instantly on first tap after launch. Refresh in background.
    @State private var briefing: Briefing? =
        AppCache.read(.profileBriefing, as: Briefing.self)
    @State private var profile: ProfileState? =
        AppCache.read(.profileState, as: ProfileState.self)

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {

                    // 1. PageHeader · shared chrome (Phase 25a · TrainingView pattern).
                    PageHeader(
                        title: "Profile.",
                        eyebrow: FaffAdapter.profileEyebrow(profile),
                        accent: AnyView(
                            AvatarCircle(
                                initials: FaffAdapter.profileAvatarInitials(profile?.identity.full_name)
                            )
                        )
                    )

                    // Training-for line — mirrors the web band between
                    // the page header and the coach card. Renders only
                    // when a next A-race is present.
                    if let race = profile?.nextARace {
                        trainingForLine(race)
                            .padding(.horizontal, 24)
                    }

                    // 2. Coach identity-mode voice. Background-loads via
                    //    CoachSlot — skeleton while pending, snaps in when
                    //    ready. Never blocks the page.
                    CoachSlot(
                        briefing: briefing,
                        surface: "profile",
                        askPrompt: nil
                    )

                    // 3. PERSONAL grid · 6 cards (NAME · GENDER · BIRTHDAY ·
                    //    HEIGHT · CITY · EXPERIENCE). Mirrors web Grid4 +
                    //    second row of 2 — flattened to a 2-col iPhone
                    //    grid that scrolls vertically.
                    SectionLabel("PERSONAL")
                    personalGrid

                    // 4. PHYSIOLOGY · TRAINING ANCHORS grid · 4 cards (LTHR
                    //    · MAX HR · RESTING HR · VDOT). Each carries the
                    //    source line + used-for context (mirrors AnchorCard
                    //    on the web).
                    SectionLabel("PHYSIOLOGY · TRAINING ANCHORS")
                    anchorsGrid

                    // 5. HR ZONES table · 5 rows. Renders only when the
                    //    server returned a computed zones table.
                    if let zt = profile?.physiology.zones, !zt.zones.isEmpty {
                        SectionLabel(hrZonesEyebrow(zt))
                        hrZonesCard(zt)
                    }

                    // 6. SHOE ROTATION · per-shoe card. Renders only when
                    //    the wire response carries at least one shoe.
                    if let shoes = profile?.shoes, !shoes.isEmpty {
                        SectionLabel("SHOE ROTATION · \(shoes.count) ACTIVE")
                        shoesList(shoes)
                    }

                    // CONNECTIONS — connected/last-sync state from server,
                    // not blind "CONNECTED" labels. Kept verbatim from the
                    // legacy view so the existing Strava OAuth + Apple
                    // Health flow continue to work.
                    SectionLabel("CONNECTIONS")
                    VStack(spacing: 10) {
                        ConnRow(name: "Strava",
                                sub: profile?.connections.strava.note ?? "Auto-sync via OAuth",
                                connected: profile?.connections.strava.connected ?? false)
                        ConnRow(name: "Apple Health",
                                sub: profile?.connections.appleHealth.note ?? "Sleep / HRV / RHR / weight",
                                connected: profile?.connections.appleHealth.connected ?? false)
                        ConnRow(name: "Apple Watch",
                                sub: profile?.connections.appleWatch.note ?? "Paired via WatchConnectivity",
                                connected: profile?.connections.appleWatch.connected ?? false)
                    }
                    .padding(.horizontal, 24)

                    // P29 — actions: edit settings + log manual run + onboarding
                    // 2026-05-27: added Run log + Form tips here so the two
                    // surfaces that dropped out of the tab bar are still one
                    // tap away.
                    SectionLabel("ACTIONS")
                    VStack(spacing: 10) {
                        Button { showHealthSheet = true } label: {
                            actionRow(icon: "waveform.path.ecg", label: "Health", sub: "Readiness · sleep · HRV · resting HR")
                        }.buttonStyle(.plain)
                        Button { showLogSheet = true } label: {
                            actionRow(icon: "list.bullet.rectangle.fill", label: "Run log", sub: "Every run, chronologically")
                        }.buttonStyle(.plain)
                        Button { showTipsSheet = true } label: {
                            actionRow(icon: "lightbulb.fill", label: "Form tips", sub: "Cadence · vertical osc · ground contact")
                        }.buttonStyle(.plain)
                        Button { showSettingsSheet = true } label: {
                            actionRow(icon: "gearshape.fill", label: "Settings", sub: "Units · zones · profile")
                        }.buttonStyle(.plain)
                        Button { showManualRunSheet = true } label: {
                            actionRow(icon: "plus.circle.fill", label: "Log manual run", sub: "Treadmill / forgot to track")
                        }.buttonStyle(.plain)
                        Button { showOnboardingSheet = true } label: {
                            actionRow(
                                icon: tokenStore.isSignedIn ? "person.crop.circle.badge.checkmark" : "person.crop.circle.badge.plus",
                                label: tokenStore.isSignedIn ? "Connections" : "Set up account",
                                sub: tokenStore.isSignedIn ? "Sign-in · Strava · Apple Health" : "Sign in + connect your data"
                            )
                        }.buttonStyle(.plain)
                    }
                    .padding(.horizontal, 24)

                    Spacer().frame(height: 40)
                }
            }
            .background(Theme.bg.ignoresSafeArea())
            // The in-shell PageHeader carries the display recipe — suppress
            // the system title so we don't get a duplicate.
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            // Warm settings + profile in the background as soon as /profile
            // mounts. SettingsSheet seeds its @State synchronously from the
            // cache when opened — kills the visible "Loading…" flash.
            .task { await load() }
            .refreshable { await load() }
            .animation(.spring(response: 0.45, dampingFraction: 0.85), value: briefing?.lead)
            .sheet(isPresented: $showHeightSheet) {
                HeightInputSheet(onSave: { showHeightSheet = false })
                    .presentationDetents([.height(260)])
                    .presentationDragIndicator(.visible)
                    .presentationBackground(Theme.card)
            }
            .sheet(isPresented: $showSettingsSheet) {
                SettingsSheet()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showManualRunSheet) {
                ManualRunSheet()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showOnboardingSheet) {
                OnboardingSheet()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showLogSheet) {
                LogView()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showTipsSheet) {
                TipsView()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showHealthSheet) {
                HealthView()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
        }
    }

    // MARK: - PERSONAL grid

    private var personalGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            FieldCard(label: "NAME", value: profile?.identity.full_name ?? "—")
            FieldCard(label: "GENDER", value: genderDisplay)
            FieldCard(label: "BIRTHDAY",
                      value: formatBirthday(profile?.identity.birthday),
                      hint: profile?.identity.age.map { "AGE \($0)" })
            // Height — taps the editor when missing. When set, shows the
            // value in feet/inches.
            if let cm = profile?.identity.height_cm {
                FieldCard(label: "HEIGHT",
                          value: formatHeightFtIn(cm: cm),
                          editable: true)
            } else {
                Button { showHeightSheet = true } label: {
                    FieldCard(label: "HEIGHT", value: "—",
                              hint: "TAP TO ADD")
                }
                .buttonStyle(.plain)
            }
            FieldCard(label: "CITY", value: profile?.identity.city ?? "—")
            FieldCard(label: "EXPERIENCE",
                      value: experienceDisplay(profile?.identity.experience_level))
        }
        .padding(.horizontal, 24)
    }

    // MARK: - PHYSIOLOGY · TRAINING ANCHORS grid

    private var anchorsGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            FieldCard(
                label: "LTHR",
                value: profile?.physiology.lthr.map { "\($0) bpm" } ?? "—",
                hint: nil,
                subhint: "HR zones (Z1-Z5 from Friel)",
                editable: true
            )
            FieldCard(
                label: "MAX HR",
                value: profile?.physiology.max_hr.map { "\($0) bpm" } ?? "—",
                hint: maxHrHint(profile?.physiology.max_hr_source),
                subhint: "Z5 ceiling, age-grade fallback",
                editable: true
            )
            FieldCard(
                label: "RESTING HR",
                value: profile?.physiology.rhr.map { "\($0) bpm" } ?? "—",
                hint: profile?.physiology.rhr != nil ? "60D MEAN" : "PENDING",
                subhint: "Readiness baseline"
            )
            FieldCard(
                label: "VDOT",
                value: profile?.physiology.vdot.map { String(format: "%.0f", $0) } ?? "—",
                hint: profile?.physiology.vdot != nil ? "BEST RACE · 6MO" : "PENDING",
                subhint: "Pace zones (E/M/T/I/R)"
            )
        }
        .padding(.horizontal, 24)
    }

    // MARK: - HR ZONES card

    private func hrZonesEyebrow(_ zt: ProfileZoneTable) -> String {
        let method = zt.method == "lthr-friel" ? "LTHR-ANCHORED (FRIEL)" : "%MHR FALLBACK"
        return "HR ZONES · \(method) · \(zt.anchor.label) \(zt.anchor.bpm)"
    }

    private func hrZonesCard(_ zt: ProfileZoneTable) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(zt.zones) { z in
                HRZoneRow(zone: z)
            }
            if let note = zt.note, !note.isEmpty {
                Text(note)
                    .font(.body(11))
                    .foregroundStyle(Theme.mute)
                    .padding(.top, 12)
            }
            Text("Re-test LTHR every 6-12 weeks for the most accurate zones.")
                .font(.body(11))
                .foregroundStyle(Theme.mute)
                .padding(.top, 10)
        }
        .padding(16)
        .background(Theme.card)
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
        .padding(.horizontal, 24)
    }

    // MARK: - SHOE ROTATION list

    private func shoesList(_ shoes: [ProfileShoe]) -> some View {
        VStack(spacing: 10) {
            ForEach(shoes) { shoe in
                shoeCard(shoe)
            }
        }
        .padding(.horizontal, 24)
    }

    private func shoeCard(_ shoe: ProfileShoe) -> some View {
        let miles  = shoe.mileage ?? 0
        let cap    = shoe.cap ?? 0
        let pct    = shoe.pctUsed ?? (cap > 0 ? miles / cap : 0)
        let retired = shoe.retired ?? false
        // Lock the pill color to amber when ≥ 80% of cap, red when ≥ 100%,
        // green otherwise. Matches the web's mileage warning ramp.
        let pillColor: Color = pct >= 1.0 ? Theme.over
            : pct >= 0.8 ? Theme.goal
            : Theme.green
        return HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(shoeDisplayName(shoe))
                        .font(.display(18))
                        .tracking(0.5)
                        .foregroundStyle(retired ? Theme.mute : Theme.ink)
                        .lineLimit(1)
                    if retired {
                        Text("RETIRED")
                            .font(.body(9, weight: .bold))
                            .tracking(1.2)
                            .foregroundStyle(Theme.mute)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .overlay(Capsule().stroke(Theme.mute.opacity(0.4), lineWidth: 1))
                            .clipShape(Capsule())
                    } else if shoe.preferred == true {
                        Text("PREFERRED")
                            .font(.body(9, weight: .bold))
                            .tracking(1.2)
                            .foregroundStyle(Theme.green)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .overlay(Capsule().stroke(Theme.green.opacity(0.35), lineWidth: 1))
                            .clipShape(Capsule())
                    }
                }
                Text(shoeMetaLine(miles: miles, cap: cap))
                    .font(.body(11))
                    .foregroundStyle(Theme.mute)
            }
            Spacer(minLength: 8)
            Text(String(format: "%.0f%%", min(pct, 1.0) * 100))
                .font(.body(11, weight: .bold))
                .tracking(0.8)
                .foregroundStyle(pillColor)
                .padding(.horizontal, 9)
                .padding(.vertical, 5)
                .overlay(Capsule().stroke(pillColor.opacity(0.35), lineWidth: 1))
                .clipShape(Capsule())
        }
        .padding(14)
        .background(Theme.card)
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
    }

    private func shoeDisplayName(_ shoe: ProfileShoe) -> String {
        if let name = shoe.name, !name.isEmpty { return name }
        let parts = [shoe.brand, shoe.model].compactMap { $0?.isEmpty == false ? $0 : nil }
        return parts.isEmpty ? "Shoe" : parts.joined(separator: " ")
    }

    private func shoeMetaLine(miles: Double, cap: Double) -> String {
        if cap > 0 {
            return "\(formatMi(miles)) / \(formatMi(cap)) MI"
        }
        return "\(formatMi(miles)) MI"
    }

    private func formatMi(_ mi: Double) -> String {
        if mi.truncatingRemainder(dividingBy: 1) == 0 { return String(Int(mi)) }
        return String(format: "%.1f", mi)
    }

    // MARK: - Training-for line

    private func trainingForLine(_ race: ProfileNextRace) -> some View {
        let goalSuffix = race.goal.map { " · goal \($0)" } ?? ""
        return HStack(spacing: 6) {
            Text("Training for")
                .font(.body(13))
                .foregroundStyle(Theme.mute)
            Text("\(race.name) · \(race.days_to_race) days\(goalSuffix)")
                .font(.body(13, weight: .semibold))
                .foregroundStyle(Theme.race)
        }
    }

    // MARK: - Load

    private func load() async {
        await SettingsCache.shared.warm()
        // Three calls in parallel: settings cache warm (cached locally for
        // the SettingsSheet), the coach brief, and the profile state. UI
        // shows the page immediately and each piece fills in as it lands.
        async let pRes = (try? await API.fetchProfileState())
        async let bRes = (try? await API.briefing(surface: "profile"))
        profile = await pRes ?? nil
        briefing = await bRes ?? nil
    }

    // MARK: - Formatting helpers

    /// "MALE", "FEMALE", or "—" — capitalized for the FieldCard value.
    private var genderDisplay: String {
        guard let s = profile?.identity.sex, !s.isEmpty else { return "—" }
        return s.uppercased()
    }

    /// "06-15-1985" from "1985-06-15", or "—" when unset.
    private func formatBirthday(_ iso: String?) -> String {
        guard let iso, !iso.isEmpty else { return "—" }
        let parts = iso.split(separator: "-")
        guard parts.count >= 3 else { return iso }
        return "\(parts[1])-\(parts[2].prefix(2))-\(parts[0])"
    }

    /// "Intermediate" / "Sub-elite" / etc. from the raw enum value.
    private func experienceDisplay(_ level: String?) -> String {
        switch (level ?? "").lowercased() {
        case "beginner":      return "BEGINNER"
        case "intermediate":  return "INTERMEDIATE"
        case "advanced":      return "ADVANCED"
        case "advanced_plus": return "SUB-ELITE"
        default:              return "—"
        }
    }

    /// 175 cm → "5'9\"" — same formatter web /profile uses
    /// (lib/format/height.ts).
    private func formatHeightFtIn(cm: Double) -> String {
        let totalInches = cm / 2.54
        let feet = Int(totalInches / 12)
        let inches = Int(totalInches.truncatingRemainder(dividingBy: 12).rounded())
        return "\(feet)'\(inches)\""
    }

    /// MAX HR card's small hint label keys off how the value was derived
    /// (manual / observed peak / LTHR-derived / formula).
    private func maxHrHint(_ source: String?) -> String? {
        switch source ?? "" {
        case "manual":        return "MANUAL"
        case "observed":      return "OBSERVED"
        case "lthr-derived":  return "LTHR-DERIVED"
        case "formula":       return "FORMULA"
        default:              return nil
        }
    }

    private func actionRow(icon: String, label: String, sub: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Theme.green)
                .frame(width: 32, height: 32)
                .background(Theme.green.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.body(14, weight: .semibold)).foregroundStyle(Theme.ink)
                Text(sub).font(.body(11)).foregroundStyle(Theme.mute)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.mute)
        }
        .padding(14)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
    }
}

private struct SectionLabel: View {
    let text: String
    init(_ t: String) { self.text = t }
    var body: some View {
        Text(text).font(.label(11)).tracking(1.6)
            .foregroundStyle(Theme.mute)
            .padding(.horizontal, 24)
    }
}

private struct ConnRow: View {
    let name: String
    let sub: String
    /// 2026-05-27: was hardcoded "CONNECTED" green chip for every row.
    /// Now reflects real state from /api/profile/state — green when the
    /// server's freshness window says the source is live, mute otherwise.
    let connected: Bool

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.display(18)).foregroundStyle(Theme.ink)
                Text(sub).font(.body(11)).foregroundStyle(Theme.mute)
            }
            Spacer()
            HStack(spacing: 6) {
                Circle()
                    .fill(connected ? Theme.green : Theme.mute)
                    .frame(width: 6, height: 6)
                Text(connected ? "CONNECTED" : "NOT CONNECTED")
                    .font(.label(10)).tracking(1)
                    .foregroundStyle(connected ? Theme.green : Theme.mute)
            }
        }
        .padding(14)
        .background(Theme.card)
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
    }
}

/// §8.6 closed loop: native sheet → API.updateProfile → next briefing acks once.
private struct HeightInputSheet: View {
    var onSave: () -> Void
    @State private var value: String = ""
    @State private var unit: Unit = .cm
    @State private var saving = false
    @State private var error: String?

    enum Unit: String { case cm, inch }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("ADD YOUR HEIGHT").font(.label(11)).tracking(1.6).foregroundStyle(Theme.mute)
            HStack(spacing: 10) {
                TextField("e.g. 180", text: $value)
                    .keyboardType(.decimalPad)
                    .font(.display(28))
                    .foregroundStyle(Theme.ink)
                    .padding(10)
                    .background(Color.white.opacity(0.04))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.green, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                Button { unit = .cm } label: {
                    Text("CM").font(.display(11)).tracking(1)
                        .foregroundStyle(unit == .cm ? Theme.green : Theme.mute)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .overlay(Capsule().stroke(unit == .cm ? Theme.green : Theme.line, lineWidth: 1))
                }.buttonStyle(.plain)
                Button { unit = .inch } label: {
                    Text("IN").font(.display(11)).tracking(1)
                        .foregroundStyle(unit == .inch ? Theme.green : Theme.mute)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .overlay(Capsule().stroke(unit == .inch ? Theme.green : Theme.line, lineWidth: 1))
                }.buttonStyle(.plain)
            }
            if let error {
                Text(error).font(.body(11)).foregroundStyle(Theme.over)
            }
            Button {
                Task { await save() }
            } label: {
                Text(saving ? "SAVING…" : "SAVE").font(.display(13)).tracking(1.2)
                    .foregroundStyle(Color(white: 0.05))
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                    .background(Theme.green).clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .disabled(value.isEmpty || saving).buttonStyle(.plain)
        }
        .padding(20)
        .background(Theme.card)
    }

    @MainActor
    private func save() async {
        guard let n = Double(value) else { error = "(enter a number)"; return }
        let cm = unit == .inch ? Int(round(n * 2.54)) : Int(round(n))
        guard cm >= 120 && cm <= 220 else { error = "(out of range — 120-220 cm)"; return }
        saving = true; defer { saving = false }
        do {
            try await API.updateProfile(["height_cm": cm])
            onSave()
        } catch {
            self.error = "(couldn't save — try again)"
        }
    }
}
