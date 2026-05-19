//
//  LoginView.swift
//  Faff
//
//  Email + password login form.  Hits POST /api/auth/token on the
//  Faff.run backend.  On success, TokenStore is populated and the
//  onLogin callback fires; ContentView re-routes to TodayView.
//
//  No "forgot password" link in v0 — single-user beta, the user IS
//  the developer.  Add when the second user signs up.
//

import SwiftUI

struct LoginView: View {
    let onLogin: () -> Void

    @State private var email: String = ""
    @State private var password: String = ""
    @State private var isLoading: Bool = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 20) {
            Spacer()

            VStack(spacing: 4) {
                Text("Faff.run")
                    .font(.system(size: 42, weight: .bold))
                Text("Sign in")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
            .padding(.bottom, 20)

            VStack(spacing: 12) {
                TextField("Email", text: $email)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                SecureField("Password", text: $password)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.password)
            }
            .padding(.horizontal, 30)

            if let errorMessage {
                Text(errorMessage)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 30)
            }

            Button {
                Task { await submit() }
            } label: {
                Group {
                    if isLoading {
                        ProgressView().controlSize(.regular)
                    } else {
                        Text("Sign in")
                            .font(.headline)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal, 30)
            .disabled(isLoading || email.isEmpty || password.isEmpty)

            Spacer()
            Spacer()
        }
    }

    private func submit() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            _ = try await FaffAPI.shared.login(email: email, password: password)
            onLogin()
        } catch APIError.unauthorized {
            errorMessage = "Invalid email or password."
        } catch APIError.http(let status, _) where status == 401 {
            errorMessage = "Invalid email or password."
        } catch APIError.http(let status, _) where status == 403 {
            errorMessage = "Your account isn't active yet."
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    LoginView(onLogin: { })
}
