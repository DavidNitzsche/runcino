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
    @StateObject private var tokenStore = TokenStore.shared
    // 2026-05-27 iPhone parity audit: profile surface had no coach voice
    // despite web having it. Wire identity-mode brief here.
    @State private var briefing: Briefing?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                // Identity
                HStack(alignment: .center, spacing: 18) {
                    ZStack {
                        Circle().fill(
                            LinearGradient(colors: [Theme.learn, Theme.race], startPoint: .topLeading, endPoint: .bottomTrailing)
                        )
                        Text("DN").font(.display(36)).foregroundStyle(Color(white: 0.1)).tracking(1)
                    }
                    .frame(width: 88, height: 88)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("David Nitzsche").font(.display(36)).tracking(0.5).foregroundStyle(Theme.ink)
                        Text("MALE · 40 · LOS ANGELES, CA")
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

                // PERSONAL — including gap input
                SectionLabel("PERSONAL")
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    Field(k: "NAME", v: "David Nitzsche")
                    Field(k: "SEX",  v: "Male")
                    Field(k: "AGE",  v: "40")
                    // Height gap — taps open a sheet for input
                    Button {
                        showHeightSheet = true
                    } label: {
                        ProfileGapCard(field: "height_cm", why: "Unlocks cadence target")
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 24)

                // PHYSIOLOGY · DERIVED
                SectionLabel("PHYSIOLOGY · DERIVED")
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    Field(k: "MAX HR",     v: "181 bpm", hint: "OBSERVED")
                    Field(k: "RESTING HR", v: "47 bpm",  hint: "60D MEAN")
                    Field(k: "VO2 MAX",    v: "61.3",     hint: "APPLE")
                    Field(k: "WEIGHT",     v: "186 lb",   hint: "APPLE HEALTH")
                }
                .padding(.horizontal, 24)

                // CONNECTIONS
                SectionLabel("CONNECTIONS")
                VStack(spacing: 10) {
                    ConnRow(name: "Strava",       sub: "Auto-sync via OAuth")
                    ConnRow(name: "Apple Health", sub: "Sleep / HRV / RHR / weight")
                    ConnRow(name: "Apple Watch",  sub: "Paired via WatchConnectivity")
                }
                .padding(.horizontal, 24)

                // P29 — actions: edit settings + log manual run + onboarding
                SectionLabel("ACTIONS")
                VStack(spacing: 10) {
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
        }
    }

    private func load() async {
        await SettingsCache.shared.warm()
        // Coach brief loads in parallel; UI shows the page immediately
        // and the brief snaps in when ready.
        briefing = try? await API.briefing(surface: "profile")
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
    let name: String; let sub: String
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.display(18)).foregroundStyle(Theme.ink)
                Text(sub).font(.body(11)).foregroundStyle(Theme.mute)
            }
            Spacer()
            HStack(spacing: 6) {
                Circle().fill(Theme.green).frame(width: 6, height: 6)
                Text("CONNECTED").font(.label(10)).tracking(1).foregroundStyle(Theme.green)
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
