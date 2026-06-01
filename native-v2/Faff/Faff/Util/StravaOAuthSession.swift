//
//  StravaOAuthSession.swift
//  Faff
//
//  ASWebAuthenticationSession wrapper for the Strava OAuth flow.
//
//  Flow:
//   1. SwiftUI caller invokes `await StravaOAuthSession.start()`
//   2. The wrapper fetches the OAuth URL from the backend with
//      platform=ios in the query.
//   3. ASWebAuthenticationSession opens Strava's consent page in an
//      in-app SafariViewController-style browser. Cookies are shared
//      with mobile Safari so the user stays signed in to Strava.
//   4. Strava redirects to the Faff backend callback.
//   5. The callback persists the token, then 302s to
//      `faff://strava/callback?status=connected&scope=...`.
//   6. ASWebAuthenticationSession catches the faff:// URL (because we
//      registered "faff" as the callbackURLScheme), closes the in-app
//      browser, and returns the URL to us.
//   7. We parse the query · success or failure · and notify the caller.
//
//  Universal-link alternative would be possible (the callback could
//  redirect to https://www.faff.run/some/path that the app handles via
//  associated domains) but the custom scheme is simpler and doesn't
//  require apple-app-site-association config on the server.
//

import AuthenticationServices
import Foundation
import UIKit

@MainActor
final class StravaOAuthSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    enum Outcome: Equatable {
        case connected(scope: String)
        case failed(reason: String)
        case canceled
    }

    /// Shared instance · keeps a strong reference to the in-flight
    /// session while the user is in Safari (ASWebAuthenticationSession
    /// gets deallocated otherwise and the callback never fires).
    static let shared = StravaOAuthSession()

    private var session: ASWebAuthenticationSession?

    /// Kick off the OAuth flow. Returns when the user finishes consent
    /// (success or failure) or cancels.
    func start() async -> Outcome {
        // 1. Get the OAuth URL from the backend.
        let authURL: URL?
        do {
            authURL = try await API.fetchStravaConnectURL()
        } catch {
            return .failed(reason: "couldn't reach the server: \(error.localizedDescription)")
        }
        guard let authURL else {
            return .failed(reason: "server didn't return an OAuth URL · check Strava env vars")
        }

        // 2. Open ASWebAuthenticationSession and wait for the faff://
        //    callback. The continuation pattern bridges the callback-
        //    style API to async/await.
        return await withCheckedContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: authURL,
                callbackURLScheme: "faff"
            ) { callbackURL, error in
                if let error = error as? ASWebAuthenticationSessionError,
                   error.code == .canceledLogin {
                    continuation.resume(returning: .canceled)
                    return
                }
                if let error {
                    continuation.resume(returning: .failed(reason: error.localizedDescription))
                    return
                }
                guard let callbackURL,
                      let comps = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) else {
                    continuation.resume(returning: .failed(reason: "callback URL was malformed"))
                    return
                }
                let items = comps.queryItems ?? []
                let status = items.first(where: { $0.name == "status" })?.value ?? "failed"
                if status == "connected" {
                    let scope = items.first(where: { $0.name == "scope" })?.value ?? ""
                    continuation.resume(returning: .connected(scope: scope))
                } else {
                    let msg = items.first(where: { $0.name == "msg" })?.value ?? "Strava reconnect failed"
                    continuation.resume(returning: .failed(reason: msg))
                }
            }
            session.presentationContextProvider = self
            // Share cookies with mobile Safari so the runner doesn't
            // have to re-sign-in to Strava every time.
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                continuation.resume(returning: .failed(reason: "couldn't start the OAuth browser"))
            }
        }
    }

    // MARK: ASWebAuthenticationPresentationContextProviding

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // Return the app's key window so the in-app browser presents
        // from the right view hierarchy.
        if let scene = UIApplication.shared.connectedScenes
            .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
           let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first {
            return window
        }
        return ASPresentationAnchor()
    }
}
