//
//  SettingsView.swift
//  Settings · units, training, notifications, connections, account.
//

import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var settings: UserSettings?
    @State private var profile: ProfileState?
    @State private var distanceMi: Bool = true
    @State private var paceMi: Bool = true
    @State private var adaptivePlan: Bool = true
    @State private var notifMorning: Bool = true
    @State private var notifSession: Bool = true
    @State private var notifNudge: Bool = true
    @State private var notifWeekly: Bool = false

    private let mesh = FaffMesh(
        c1: 0x3FB6B0, c2: 0x62E08A, c3: 0x0E4F4C,
        c4: 0x155A4A, c5: 0x155A4A, base: 0x072A28
    )

    var body: some View {
        ZStack {
            FaffMeshView(mesh: mesh)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    header
                        .padding(.horizontal, 22)
                        .padding(.top, 50)
                        .padding(.bottom, 18)

                    section("UNITS & DISPLAY") {
                        VStack(spacing: 0) {
                            row(title: "Distance") {
                                segment(options: ["MI", "KM"], on: distanceMi ? "MI" : "KM") { v in
                                    withAnimation(Theme.Motion.smooth) { distanceMi = (v == "MI") }
                                    push(["units_distance": distanceMi ? "MI" : "KM"])
                                }
                            }
                            row(title: "Pace format") {
                                segment(options: ["/MI", "/KM"], on: paceMi ? "/MI" : "/KM") { v in
                                    withAnimation(Theme.Motion.smooth) { paceMi = (v == "/MI") }
                                    push(["units_pace": paceMi ? "/MI" : "/KM"])
                                }
                            }
                        }
                    }

                    section("TRAINING") {
                        VStack(spacing: 0) {
                            navRow(title: "Week starts", value: "Monday")
                            navRow(title: "Default shoe", value: "auto-detect")
                            row(title: "Adaptive plan", subtitle: "let Faff retune from readiness") {
                                FaffToggle(isOn: $adaptivePlan)
                            }
                        }
                    }

                    section("NOTIFICATIONS") {
                        VStack(spacing: 0) {
                            row(title: "Morning readiness") { FaffToggle(isOn: $notifMorning) }
                            row(title: "Session reminders") { FaffToggle(isOn: $notifSession) }
                            row(title: "Coach nudges", subtitle: "plan changes & check-ins") {
                                FaffToggle(isOn: $notifNudge)
                            }
                            row(title: "Weekly recap") { FaffToggle(isOn: $notifWeekly) }
                        }
                    }

                    section("CONNECTIONS") {
                        VStack(spacing: 0) {
                            // Was hardcoded "Synced / Synced / Connect" for every
                            // user. Reads real connection state from
                            // /api/profile/state.connections now.
                            navRow(
                                title: "Apple Health",
                                value: profile?.connections.appleHealth.connected == true ? "Synced" : "Connect",
                                good: profile?.connections.appleHealth.connected == true
                            )
                            navRow(
                                title: "Strava",
                                value: profile?.connections.strava.connected == true ? "Synced" : "Connect",
                                good: profile?.connections.strava.connected == true
                            )
                            navRow(
                                title: "Apple Watch",
                                value: profile?.connections.appleWatch.connected == true ? "Paired" : "Not paired",
                                good: profile?.connections.appleWatch.connected == true
                            )
                        }
                    }

                    section("ACCOUNT") {
                        VStack(spacing: 0) {
                            navRow(title: "david@workprint.la", value: "")
                            navRow(title: "Faff Pro", subtitle: "annual · renews Dec 2026", value: "Active", good: true)
                            navRow(title: "Privacy & data", value: "")
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
        .task {
            async let s = (try? await API.fetchSettings())
            async let p = (try? await API.fetchProfileState())
            let (st, pf) = await (s, p)
            await MainActor.run {
                self.settings = st
                self.profile = pf
            }
            applyFromServer()
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            BackChip { dismiss() }
            SpecLabel(text: "SETTINGS", size: 13, tracking: 2.5, color: Theme.txt)
            Spacer()
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
                    .font(.display(12, weight: .bold))
                    .foregroundStyle(good ? Color(hex: 0x9AF0BF) : Theme.txt.opacity(0.7))
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
                        .font(.display(11, weight: .bold))
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
                .foregroundStyle(Color(hex: 0xFF8A82))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Color(hex: 0xFF5A52).opacity(0.14),
                            in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color(hex: 0xFF5A52).opacity(0.3), lineWidth: 1))
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
        // Clear local session + the gate's "onboarded" flag so the next
        // launch lands on SignIn. AppCache stays cleared so the gate's
        // returning-user heuristic doesn't auto-bypass.
        await MainActor.run {
            TokenStore.shared.clear()
            let d = UserDefaults.standard
            d.removeObject(forKey: "faff.onboarded")
            d.removeObject(forKey: "faff.health.connected.v2")
            AppCache.clearAll()
            // Re-exit the app · the cleanest way to bounce back through
            // RootContainer's gate decision is a fresh launch. Until then,
            // post a notification the gate can listen for.
            NotificationCenter.default.post(name: .faffGateReset, object: nil)
        }
    }

    private var footer: some View {
        Text("Faff 3.0.0 · made for runners")
            .font(.display(10, weight: .semibold))
            .foregroundStyle(Theme.txt.opacity(0.4))
            .frame(maxWidth: .infinity)
    }

    private func push(_ patch: [String: Any]) {
        Task { try? await API.patchSettings(patch) }
    }

    private func applyFromServer() {
        guard let s = settings else { return }
        if let ud = s.units_distance {
            distanceMi = (ud.uppercased() == "MI")
        }
        if let up = s.units_pace {
            paceMi = (up.uppercased().contains("MI"))
        }
    }
}
