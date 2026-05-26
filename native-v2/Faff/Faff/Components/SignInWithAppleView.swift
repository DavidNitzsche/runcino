//
//  SignInWithAppleView.swift  (P39)
//  Sign-in-with-Apple button + the auth flow that POSTs the identity
//  token to /api/auth/apple and stores the returned session token.
//

import SwiftUI
import AuthenticationServices

struct SignInWithAppleView: View {
    let onResult: (Bool) -> Void

    @State private var coordinator: SignInCoordinator?
    @State private var pending = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SignInWithAppleButton(.signIn) { request in
                request.requestedScopes = [.fullName, .email]
            } onCompletion: { result in
                Task { await handle(result: result) }
            }
            .signInWithAppleButtonStyle(.white)
            .frame(height: 50)
            .disabled(pending)

            if pending {
                HStack(spacing: 8) {
                    ProgressView().tint(Theme.mute)
                    Text("Signing in…").font(.body(11)).foregroundStyle(Theme.mute)
                }
            }
            if let err = error {
                Text(err).font(.body(11)).foregroundStyle(Theme.over)
            }
        }
    }

    private func handle(result: Result<ASAuthorization, Error>) async {
        pending = true; defer { pending = false }
        do {
            let auth = try result.get()
            guard let cred = auth.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = cred.identityToken,
                  let identityToken = String(data: tokenData, encoding: .utf8) else {
                self.error = "Apple didn't return an identity token."
                onResult(false); return
            }
            let resp = try await API.signInWithApple(
                identityToken: identityToken,
                appleUserId: cred.user,
                email: cred.email,
                fullName: cred.fullName
            )
            if resp.ok, let token = resp.token {
                TokenStore.shared.set(
                    token: token,
                    expiresAt: resp.expires_at,
                    userUuid: resp.user_uuid
                )
                onResult(true)
            } else {
                self.error = resp.error ?? "Sign-in failed."
                onResult(false)
            }
        } catch {
            self.error = "Sign-in failed: \(error.localizedDescription)"
            onResult(false)
        }
    }
}

/// Lightweight coordinator placeholder — Apple's SwiftUI button handles
/// the request itself, so we don't need an NSObject delegate; this is
/// here as a stub for future expansion (e.g. silent refresh).
@MainActor
final class SignInCoordinator: NSObject {}
