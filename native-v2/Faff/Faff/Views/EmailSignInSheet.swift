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
    /// sheet carries three modes: sign-in POSTs /api/auth/email; request-
    /// access POSTs /api/auth/request-access (name + email · an admin
    /// approves and emails a temp password); set-password is the first-
    /// login step the auth response routes to ("/set-password") so an
    /// invited runner replaces the temp password before continuing.
    private enum Mode { case signIn, requestAccess, setPassword }
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
        ZStack {
            Theme.bg.ignoresSafeArea()

            VStack(alignment: .leading, spacing: 0) {
                header
                    .padding(.top, 18)

                if requestSent {
                    Spacer(minLength: 0)
                    requestSentView
                } else if mode == .setPassword {
                    // Invite first-login (audit P1-2): the session token is
                    // already persisted; this step stores the runner's own
                    // password, then routes on the set-password redirect.
                    SetPasswordStep(onDone: { skipOnboarding in
                        onSignedIn(skipOnboarding)
                        dismiss()
                    })
                } else {
                    hero
                        .padding(.top, 36)

                    form
                        .padding(.top, 28)

                    Spacer(minLength: 0)

                    submitButton

                    modeToggle
                        .padding(.top, 14)
                }
            }
            .padding(.horizontal, 30)
            .padding(.bottom, 36)
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
            .buttonStyle(FaffPressStyle())
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
            .buttonStyle(FaffPressStyle())
            SpecLabel(text: headerLabel, size: 13, tracking: 2.5, color: Theme.txt)
            Spacer()
        }
    }

    private var headerLabel: String {
        switch mode {
        case .signIn:        return "EMAIL SIGN-IN"
        case .requestAccess: return "REQUEST ACCESS"
        case .setPassword:   return "SET PASSWORD"
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(mode == .signIn ? "Welcome\nback." : "Request\naccess.")
                .font(.heroDisplay(46))
                .tracking(-2)
                .foregroundStyle(Theme.txt)
                .fixedSize(horizontal: false, vertical: true)
            Text(mode == .signIn
                 ? "Sign in with your email and password."
                 : "Faff is invite-only. Leave your name and email — we'll send a login when you're approved.")
                .font(.body(15, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.55))
                .lineSpacing(3)
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
        .buttonStyle(FaffPressStyle())
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
        .buttonStyle(FaffPressStyle())
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
                // "/set-password" = invited runner still on the temp password
                // from their approval email. The session token is live
                // (persisted above) · swap to the set-password step, which
                // routes on ITS redirect when done. Previously this fell
                // into the onboarding branch and the temp password silently
                // became permanent (audit P1-2).
                if resp.redirect == "/set-password" {
                    withAnimation(Theme.Motion.smooth) { mode = .setPassword }
                    return
                }
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

// MARK: - Set-password step
//
// Invite first-login (audit P1-2). The auth response redirected to
// "/set-password": the runner is signed in on the temp password their
// approval email carried and must choose their own before anything else.
// POSTs /api/auth/set-password (Bearer already persisted by the sign-in
// branch), then hands the response's redirect up · "/today" skips the
// onboarding gate, "/onboarding" walks the wizard. Styling mirrors the
// sign-in form fields and submit pill above.

private struct SetPasswordStep: View {
    /// Called on success. `skipOnboarding` is true when the set-password
    /// response redirected "/today" (onboarding already complete server-side).
    let onDone: (_ skipOnboarding: Bool) -> Void

    @State private var newPassword: String = ""
    @State private var pending: Bool = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            hero
                .padding(.top, 36)
            form
                .padding(.top, 28)
            Spacer(minLength: 0)
            submitButton
        }
        .onAppear { focused = true }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Choose your\npassword.")
                .font(.heroDisplay(46))
                .tracking(-2)
                .foregroundStyle(Theme.txt)
                .fixedSize(horizontal: false, vertical: true)
            Text("You signed in with the temporary password from your invite. Set your own to continue.")
                .font(.body(15, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.55))
                .lineSpacing(3)
        }
    }

    private var form: some View {
        VStack(spacing: 12) {
            SecureField("", text: $newPassword, prompt: Text("New password").foregroundColor(Color.white.opacity(0.4)))
                .focused($focused)
                .textContentType(.newPassword)
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
            Text("At least 6 characters.")
                .font(.body(12, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.45))
                .frame(maxWidth: .infinity, alignment: .leading)
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

    private var submitButton: some View {
        Button {
            Task { await submit() }
        } label: {
            HStack(spacing: 10) {
                if pending {
                    ProgressView().tint(Color(hex: 0x0B0B0B))
                }
                Text("Set password")
                    .font(.body(16, weight: .extraBold))
                    .foregroundStyle(Color(hex: 0x0B0B0B))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 17)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .opacity(canSubmit ? 1 : 0.45)
        }
        .buttonStyle(FaffPressStyle())
        .disabled(!canSubmit)
    }

    private var canSubmit: Bool { !pending && newPassword.count >= 6 }

    @MainActor
    private func submit() async {
        pending = true
        error = nil
        defer { pending = false }
        do {
            let resp = try await API.setPassword(newPassword)
            if resp.ok {
                onDone(resp.redirect == "/today")
            } else {
                error = resp.error ?? "Couldn't set password. Try again."
            }
        } catch {
            self.error = "Couldn't set password: " + error.localizedDescription
        }
    }
}
