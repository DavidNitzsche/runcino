//
//  ProfileView.swift  (P5 — iOS parity for /profile)
//  Identity-first; gap input sheet for §8.6 closed loop.
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
                // Identity — real data from /api/profile/state. Falls
                // back to "—" while loading or if the field is empty,
                // matching web's behaviour.
                HStack(alignment: .center, spacing: 18) {
                    ZStack {
                        Circle().fill(
                            LinearGradient(colors: [Theme.learn, Theme.race], startPoint: .topLeading, endPoint: .bottomTrailing)
                        )
                        Text(initialsForProfile())
                            .font(.display(36))
                            .foregroundStyle(Color(white: 0.1))
                            .tracking(1)
                    }
                    .frame(width: 88, height: 88)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(profile?.identity.full_name ?? "Runner")
                            .font(.display(36)).tracking(0.5).foregroundStyle(Theme.ink)
                        Text(identitySubtitle())
                            .font(.label(11)).tracking(1.4).foregroundStyle(Theme.mute)
                    }
                    Spacer()
                }
                .padding(.horizontal, 24).padding(.top, 24)

                // Coach identity-mode voice. Background-loads via
                // CoachSlot — skeleton while pending, snaps in when
                // ready. Never blocks the page.
                CoachSlot(
                    briefing: briefing,
                    surface: "profile",
                    askPrompt: nil
                )

                // PERSONAL — real fields from /api/profile/state.
                SectionLabel("PERSONAL")
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    Field(k: "NAME", v: profile?.identity.full_name ?? "—")
                    Field(k: "GENDER",  v: profile?.identity.sex?.capitalized ?? "—")
                    Field(k: "AGE",  v: profile?.identity.age.map(String.init) ?? "—")
                    // Height — taps the editor when missing. When set,
                    // shows the value (in feet/inches).
                    if let cm = profile?.identity.height_cm {
                        Field(k: "HEIGHT", v: formatHeightFtIn(cm: cm))
                    } else {
                        Button {
                            showHeightSheet = true
                        } label: {
                            ProfileGapCard(field: "height_cm", why: "Unlocks cadence target")
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 24)

                // PHYSIOLOGY · DERIVED — real numbers from health_samples
                // + computed (VDOT from best recent race, max-HR sourced
                // per `max_hr_source`).
                SectionLabel("PHYSIOLOGY · DERIVED")
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    Field(k: "MAX HR",
                          v: profile?.physiology.max_hr.map { "\($0) bpm" } ?? "—",
                          hint: maxHrHint(profile?.physiology.max_hr_source))
                    Field(k: "RESTING HR",
                          v: profile?.physiology.rhr.map { "\($0) bpm" } ?? "—",
                          hint: "60D MEAN")
                    Field(k: "VO2 MAX",
                          v: profile?.physiology.vo2.map { String(format: "%.1f", $0) } ?? "—",
                          hint: "APPLE")
                    Field(k: "WEIGHT",
                          v: profile?.physiology.weight_lb.map { String(format: "%.0f lb", $0) } ?? "—",
                          hint: "APPLE HEALTH")
                }
                .padding(.horizontal, 24)

                // CONNECTIONS — connected/last-sync state from server,
                // not blind "CONNECTED" labels.
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
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.large)
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
        }
    }

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

    /// "DN" from a full name (falls back when name not loaded).
    private func initialsForProfile() -> String {
        guard let n = profile?.identity.full_name, !n.isEmpty else { return "—" }
        let parts = n.split(separator: " ", omittingEmptySubsequences: true)
        let chars = parts.prefix(2).compactMap { $0.first.map(String.init) }
        return chars.joined().uppercased()
    }

    /// "MALE · 40 · LOS ANGELES, CA" assembled from real fields. Each
    /// segment renders only when its value is present, matching web.
    private func identitySubtitle() -> String {
        guard let p = profile?.identity else { return "" }
        var parts: [String] = []
        if let sex = p.sex, !sex.isEmpty { parts.append(sex.uppercased()) }
        if let age = p.age { parts.append("\(age)") }
        if let city = p.city, !city.isEmpty { parts.append(city.uppercased()) }
        return parts.joined(separator: " · ")
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
    private func maxHrHint(_ source: String?) -> String {
        switch source ?? "" {
        case "manual":        return "MANUAL"
        case "observed":      return "OBSERVED"
        case "lthr-derived":  return "LTHR-DERIVED"
        case "formula":       return "FORMULA"
        default:              return "—"
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

private struct Field: View {
    let k: String; let v: String; var hint: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(k).font(.label(9)).tracking(1.4).foregroundStyle(Theme.mute)
            Text(v).font(.display(20)).tracking(0.5).foregroundStyle(Theme.ink)
            if let hint {
                Text(hint).font(.label(9)).tracking(1).foregroundStyle(Theme.green)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.card)
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
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
