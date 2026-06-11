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
    /// When true the sheet opens in request-access mode (invite-only door
    /// for a new runner) instead of sign-in.
    var startInRequestMode: Bool = false

    let onSignedIn: (_ skipOnboarding: Bool) -> Void

    @Environment(\.dismiss) private var dismiss

    /// 2026-06-10 · invite-only (David: "just email and password"). The
    /// sheet carries two modes: sign-in POSTs /api/auth/email; request-
    /// access POSTs /api/auth/request-access (name + email · an admin
    /// approves and emails a temp password). There is no open signup.
    private enum Mode { case signIn, requestAccess }
    @State private var mode: Mode = .signIn

    @State private var name: String = ""
    @State private var email: String = ""
    @State private var password: String = ""
    @State private var pending: Bool = false
    @State private var error: String?
    /// Set after a successful request-access POST · swaps the form for a
    /// "check your email" confirmation.
    @State private var requestSent: Bool = false

    @FocusState private var focused: Field?
    private enum Field { case name, email, password }

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

                if requestSent {
                    requestSentView
                } else {
                    hero
                        .padding(.top, 4)

                    form
                        .padding(.top, 28)

                    Spacer(minLength: 0)

                    submitButton
                        .padding(.top, 18)

                    modeToggle
                        .padding(.top, 14)
                }
            }
            .padding(.horizontal, 30)
            .padding(.bottom, 30)
        }
        .preferredColorScheme(.dark)
        .onAppear {
            mode = startInRequestMode ? .requestAccess : .signIn
            focused = startInRequestMode ? .name : .email
        }
    }

    /// Post-request confirmation · invite-only flow ends here until the
    /// admin approves and emails a temp password.
    private var requestSentView: some View {
        VStack(alignment: .leading, spacing: 16) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 40, weight: .bold))
                .foregroundStyle(Theme.txt)
            Text("Request sent.")
                .font(.heroDisplay(40))
                .tracking(-2)
                .foregroundStyle(Theme.txt)
            Text("We'll email you at \(email) when you're approved, with a temporary password to sign in.")
                .font(.body(15, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.78))
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button { dismiss() } label: {
                Text("Done")
                    .font(.body(16, weight: .extraBold))
                    .foregroundStyle(Color(hex: 0x0B0B0B))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 17)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
            SpecLabel(text: mode == .signIn ? "EMAIL SIGN-IN" : "REQUEST ACCESS", size: 13, tracking: 2.5, color: Theme.txt)
            Spacer()
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(mode == .signIn ? "Welcome\nback." : "Request\naccess.")
                .font(.heroDisplay(46))
                .tracking(-2)
                .foregroundStyle(Theme.txt)
                .lineSpacing(-6)
                .shadow(color: .black.opacity(0.3), radius: 26, y: 2)
                .fixedSize(horizontal: false, vertical: true)
            Text(mode == .signIn
                 ? "Sign in with the email and password you already use on faff.run."
                 : "Faff is invite-only. Leave your name and email and we'll send a login when you're approved.")
                .font(.body(15, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.78))
                .lineSpacing(3)
                .frame(maxWidth: 320, alignment: .leading)
        }
    }

    private var form: some View {
        VStack(spacing: 12) {
            if mode == .requestAccess {
                field(
                    placeholder: "Name",
                    text: $name,
                    focusTag: .name,
                    contentType: .name,
                    keyboard: .default,
                    isSecure: false
                )
            }
            field(
                placeholder: "Email",
                text: $email,
                focusTag: .email,
                contentType: .username,
                keyboard: .emailAddress,
                isSecure: false
            )
            // Password only on sign-in · request-access is name + email.
            if mode == .signIn {
                field(
                    placeholder: "Password",
                    text: $password,
                    focusTag: .password,
                    contentType: .password,
                    keyboard: .default,
                    isSecure: true
                )
            }
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
                Text(mode == .signIn ? "Sign in" : "Request access")
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

    private var modeToggle: some View {
        Button {
            mode = (mode == .signIn) ? .requestAccess : .signIn
            error = nil
            focused = (mode == .requestAccess) ? .name : .email
        } label: {
            Text(mode == .signIn ? "New to Faff? Request access" : "Already have an account? Sign in")
                .font(.body(12, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.7))
                .underline()
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
    }

    private var canSubmit: Bool {
        if pending || !email.contains("@") { return false }
        if mode == .requestAccess {
            return !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        return password.count >= 6
    }

    @MainActor
    private func submit() async {
        pending = true
        error = nil
        defer { pending = false }
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            if mode == .requestAccess {
                let resp = try await API.requestAccess(
                    name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                    email: trimmedEmail
                )
                if resp.ok {
                    requestSent = true
                } else {
                    error = humanize(resp.error ?? "Request failed. Try again.")
                }
                return
            }
            // Sign-in.
            let resp = try await API.signInWithEmail(email: trimmedEmail, password: password)
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
            self.error = (mode == .signIn ? "Sign-in failed: " : "Request failed: ") + error.localizedDescription
        }
    }

    private func humanize(_ raw: String) -> String {
        let lower = raw.lowercased()
        if lower.contains("invalid credentials") { return "Wrong email or password." }
        if lower.contains("not active") { return "Account isn't active yet." }
        if lower.contains("already exists") { return "That email already has an account. Sign in instead." }
        return raw
    }
}
