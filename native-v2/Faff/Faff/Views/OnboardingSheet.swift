//
//  OnboardingSheet.swift  (P30)
//  iPhone onboarding shell — mirrors web /onboarding. Three steps:
//    1. Sign in with Apple → mints server session.
//    2. Connect Strava → opens OAuth in Safari, lands per-user tokens.
//    3. Connect Apple Health → HealthKit auth + first-sync.
//
//  Lives as a sheet, presented from Profile when the runner is signed
//  out OR when they tap "Set up" on a profile gap chip.
//

import SwiftUI

struct OnboardingSheet: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var tokens = TokenStore.shared
    @StateObject private var hk = HealthKitImporter.shared

    @State private var stravaPending = false
    @State private var stravaURLOpened = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    intro

                    stepCard(
                        number: 1,
                        title: "Sign in with Apple",
                        done: tokens.isSignedIn,
                        body: {
                            if tokens.isSignedIn {
                                Label("Signed in", systemImage: "checkmark.circle.fill")
                                    .foregroundStyle(Theme.green)
                                    .font(.body(13))
                            } else {
                                SignInWithAppleView { _ in }
                            }
                        }
                    )

                    stepCard(
                        number: 2,
                        title: "Connect Strava",
                        done: false,   // we don't yet poll server for strava_connected_at
                        body: {
                            Button { Task { await openStravaConnect() } } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "link.circle.fill")
                                    Text(stravaPending ? "Opening…" : (stravaURLOpened ? "Reopen Strava OAuth" : "Connect Strava"))
                                    Spacer()
                                    if stravaPending { ProgressView().tint(.white) }
                                }
                                .padding(14)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color.orange)
                                .foregroundStyle(.white)
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                            }
                            .disabled(stravaPending)

                            if stravaURLOpened {
                                Text("Approve in Safari, then come back to this app.")
                                    .font(.body(11)).foregroundStyle(Theme.mute)
                                    .padding(.top, 4)
                            }
                        }
                    )

                    stepCard(
                        number: 3,
                        title: "Connect Apple Health",
                        done: hk.status == .done || hk.status == .importing,
                        body: {
                            if hk.status == .done {
                                Label("Synced", systemImage: "checkmark.circle.fill")
                                    .foregroundStyle(Theme.green)
                                    .font(.body(13))
                            } else {
                                Button {
                                    Task { await HealthKitImporter.shared.requestAuthAndImport(daysBack: 7) }
                                } label: {
                                    HStack(spacing: 10) {
                                        Image(systemName: "heart.text.square.fill")
                                        Text(hk.status == .requesting ? "Granting…"
                                             : hk.status == .importing ? "Importing…"
                                             : "Grant Apple Health access")
                                        Spacer()
                                    }
                                    .padding(14)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Color.pink)
                                    .foregroundStyle(.white)
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                                }
                                .disabled(hk.status == .requesting || hk.status == .importing)
                            }
                            if let msg = hk.lastMessage, hk.status == .done || hk.status == .error {
                                Text(msg).font(.body(11)).foregroundStyle(Theme.mute)
                                    .padding(.top, 4)
                            }
                        }
                    )

                    if let error {
                        Text(error).font(.body(12)).foregroundStyle(Theme.over)
                    }

                    finishButton
                }
                .padding(.vertical, 18)
            }
            .background(Theme.bg.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Skip") { dismiss() }.foregroundStyle(Theme.mute)
                }
            }
        }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("LET'S SET YOU UP.")
                .font(.label(10)).tracking(1.6)
                .foregroundStyle(Theme.green)
            Text("Welcome to faff.")
                .font(.display(36)).foregroundStyle(Theme.ink)
            Text("Three quick steps. Most of it lifts itself from Strava and Apple Health — the coach builds your baseline from what's already there.")
                .font(.body(13)).foregroundStyle(Theme.ink.opacity(0.75))
                .lineSpacing(2)
        }
        .padding(.horizontal, 24)
    }

    @ViewBuilder
    private func stepCard<Content: View>(number: Int, title: String, done: Bool, @ViewBuilder body: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                ZStack {
                    Circle().fill(done ? Theme.green : Color.white.opacity(0.08))
                        .frame(width: 26, height: 26)
                    if done {
                        Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.black)
                    } else {
                        Text("\(number)").font(.body(12, weight: .bold)).foregroundStyle(Theme.ink)
                    }
                }
                Text(title).font(.body(15, weight: .semibold)).foregroundStyle(Theme.ink)
            }
            body()
        }
        .padding(16)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
        .padding(.horizontal, 24)
    }

    private var finishButton: some View {
        Button {
            Task { await finish() }
        } label: {
            Text("Done").font(.body(14, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(Theme.green)
                .foregroundStyle(.black)
                .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .padding(.horizontal, 24).padding(.top, 6)
    }

    private func openStravaConnect() async {
        stravaPending = true; defer { stravaPending = false }
        do {
            if let url = try await API.fetchStravaConnectURL() {
                await UIApplication.shared.open(url)
                stravaURLOpened = true
            } else {
                error = "Couldn't get the Strava connect URL."
            }
        } catch {
            self.error = "Strava connect failed: \(error.localizedDescription)"
        }
    }

    private func finish() async {
        // Stamp onboarded_at on the server. Connection times are stamped by
        // their respective flows (Apple Health by the importer; Strava by
        // the OAuth callback).
        try? await API.updateProfile(["onboarded_at": ISO8601DateFormatter().string(from: Date())])
        dismiss()
    }
}
