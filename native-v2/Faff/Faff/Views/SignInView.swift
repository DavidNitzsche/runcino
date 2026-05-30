//
//  SignInView.swift
//  Cool teal welcome · the app heats up as the runner commits.
//

import SwiftUI

struct SignInView: View {
    let onSignedIn: () -> Void

    private let mesh = FaffMesh(
        c1: 0x7FE6D6, c2: 0x3FB6B0, c3: 0x27B4E0,
        c4: 0x1F8F76, c5: 0x11605E, base: 0x06302E
    )

    var body: some View {
        ZStack {
            FaffMeshView(mesh: mesh)

            VStack(alignment: .leading, spacing: 0) {
                Brandmark(size: 22, style: .swept)
                    .padding(.top, 56)

                Spacer(minLength: 0)

                hero
                    .padding(.top, 4)

                Spacer(minLength: 0)

                authStack
                    .padding(.top, 22)

                fine
                    .padding(.top, 18)
            }
            .padding(.horizontal, 30)
            .padding(.bottom, 34)
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Your\nrunning,\ncoached.")
                .font(.heroDisplay(50))
                .tracking(-2.5)
                .foregroundStyle(Theme.txt)
                .lineSpacing(-6)
                .shadow(color: .black.opacity(0.3), radius: 26, y: 2)
                .fixedSize(horizontal: false, vertical: true)
            Text("A plan that adapts every day, built from your own training. Let's find your starting line.")
                .font(.body(16, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.78))
                .lineSpacing(3)
                .frame(maxWidth: 300, alignment: .leading)
        }
    }

    private var authStack: some View {
        VStack(spacing: 11) {
            SignInWithAppleView(onResult: { ok in if ok { onSignedIn() } })

            Button {
                // Google sign-in not wired yet.
            } label: {
                HStack(spacing: 11) {
                    Image(systemName: "g.circle.fill")
                        .font(.system(size: 18, weight: .bold))
                    Text("Continue with Google")
                        .font(.body(15, weight: .extraBold))
                }
                .foregroundStyle(Theme.txt)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color.white.opacity(0.26), lineWidth: 1))
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)

            Button {
                // Email sign-in not wired yet.
            } label: {
                Text("Sign in with email")
                    .font(.body(15, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.7))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
            }
            .buttonStyle(.plain)
        }
    }

    private var fine: some View {
        Text("By continuing you agree to Faff's Terms & Privacy Policy.")
            .font(.display(10, weight: .semibold))
            .foregroundStyle(Theme.txt.opacity(0.5))
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .lineSpacing(2)
    }
}
