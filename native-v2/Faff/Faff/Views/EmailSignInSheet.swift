//
//  EmailSignInSheet.swift
//  Email + password fallback path. Apple sign-in is the primary on this
//  build; email is here so David (who already has a password_hash on
//  users from legacy) can sign into his existing account while the
//  Apple flow is sorted (Services-ID return URL issue).
//
//  POSTs to /api/auth/email · the response carries the session token
//  the iPhone persists in TokenStore. Cookie-side parity is for the
//  web; iPhone uses Bearer.
//

import SwiftUI

struct EmailSignInSheet: View {
    /// Forwarded to SignInView. `skipOnboarding` reflects the auth
    /// response's `redirect` field · "/today" means the runner has an
    /// onboarding-complete user row server-side and should land in the
    /// main app, "/onboarding" means walk the gate.
    let onSignedIn: (_ skipOnboarding: Bool) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var email: String = ""
    @State private var password: String = ""
    @State private var pending: Bool = false
    @State private var error: String?

    @FocusState private var focused: Field?
    private enum Field { case email, password }

    var body: some View {
        let mesh = FaffMesh(
            c1: 0x7FE6D6, c2: 0x3FB6B0, c3: 0x27B4E0,
            c4: 0x1F8F76, c5: 0x11605E, base: 0x072A28
        )
        ZStack {
            FaffMeshView(mesh: mesh)

            VStack(alignment: .leading, spacing: 0) {
                header
                    .padding(.top, 18)

                Spacer(minLength: 0)

                hero
                    .padding(.top, 4)

                form
                    .padding(.top, 28)

                Spacer(minLength: 0)

                submitButton
                    .padding(.top, 18)

                Text("Apple sign-in is the primary path. Email is here as a fallback while that's being fixed.")
                    .font(.body(10, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.5))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 14)
                    .lineSpacing(2)
            }
            .padding(.horizontal, 30)
            .padding(.bottom, 30)
        }
        .preferredColorScheme(.dark)
        .onAppear { focused = .email }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .frame(width: 36, height: 36)
                    .background(Color.white.opacity(0.10), in: Circle())
                    .overlay(Circle().stroke(Color.white.opacity(0.18), lineWidth: 1))
            }
            .buttonStyle(.plain)
            SpecLabel(text: "EMAIL SIGN-IN", size: 13, tracking: 2.5, color: Theme.txt)
            Spacer()
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Welcome\nback.")
                .font(.heroDisplay(46))
                .tracking(-2)
                .foregroundStyle(Theme.txt)
                .lineSpacing(-6)
                .shadow(color: .black.opacity(0.3), radius: 26, y: 2)
                .fixedSize(horizontal: false, vertical: true)
            Text("Sign in with the email and password you already use on faff.run.")
                .font(.body(15, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.78))
                .lineSpacing(3)
                .frame(maxWidth: 320, alignment: .leading)
        }
    }

    private var form: some View {
        VStack(spacing: 12) {
            field(
                placeholder: "Email",
                text: $email,
                focusTag: .email,
                contentType: .username,
                keyboard: .emailAddress,
                isSecure: false
            )
            field(
                placeholder: "Password",
                text: $password,
                focusTag: .password,
                contentType: .password,
                keyboard: .default,
                isSecure: true
            )
            if let err = error, !err.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.over)
                    Text(err)
                        .font(.body(12, weight: .semibold))
                        .foregroundStyle(Theme.over)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer()
                }
                .padding(.top, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func field(
        placeholder: String,
        text: Binding<String>,
        focusTag: Field,
        contentType: UITextContentType,
        keyboard: UIKeyboardType,
        isSecure: Bool
    ) -> some View {
        Group {
            if isSecure {
                SecureField("", text: text, prompt: Text(placeholder).foregroundColor(Color.white.opacity(0.4)))
            } else {
                TextField("", text: text, prompt: Text(placeholder).foregroundColor(Color.white.opacity(0.4)))
            }
        }
        .focused($focused, equals: focusTag)
        .textContentType(contentType)
        .keyboardType(keyboard)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled(true)
        .font(.body(15, weight: .semibold))
        .foregroundStyle(Theme.txt)
        .tint(Theme.txt)
        .padding(.vertical, 14)
        .padding(.horizontal, 16)
        .background(Color.white.opacity(0.10), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
            .stroke(Color.white.opacity(0.22), lineWidth: 1))
    }

    private var submitButton: some View {
        Button {
            Task { await submit() }
        } label: {
            HStack(spacing: 10) {
                if pending {
                    ProgressView().tint(Color(hex: 0x0B0B0B))
                }
                Text("Sign in")
                    .font(.body(16, weight: .extraBold))
                    .foregroundStyle(Color(hex: 0x0B0B0B))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 17)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .opacity(canSubmit ? 1 : 0.45)
        }
        .buttonStyle(.plain)
        .disabled(!canSubmit)
    }

    private var canSubmit: Bool {
        !pending && email.contains("@") && password.count >= 6
    }

    @MainActor
    private func submit() async {
        pending = true
        error = nil
        defer { pending = false }
        do {
            let resp = try await API.signInWithEmail(
                email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                password: password
            )
            if resp.ok, let token = resp.token {
                TokenStore.shared.set(
                    token: token,
                    expiresAt: resp.expires_at,
                    userUuid: resp.user_uuid
                )
                // "/today" = returning user, skip the onboarding gate.
                // "/onboarding" or unknown = walk RolePick + Onboarding.
                let skipOnboarding = (resp.redirect == "/today")
                onSignedIn(skipOnboarding)
                dismiss()
            } else if let msg = resp.error {
                error = humanize(msg)
            } else {
                error = "Sign-in failed. Try again."
            }
        } catch {
            self.error = "Sign-in failed: \(error.localizedDescription)"
        }
    }

    private func humanize(_ raw: String) -> String {
        let lower = raw.lowercased()
        if lower.contains("invalid credentials") { return "Wrong email or password." }
        if lower.contains("not active") { return "Account isn't active yet." }
        return raw
    }
}
