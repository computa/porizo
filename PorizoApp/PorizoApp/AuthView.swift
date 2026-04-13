//
//  AuthView.swift
//  PorizoApp
//
//  Sign-in view matching Warm Canvas gallery design.
//  Apple Sign In primary with phone auth alternative.
//

import SwiftUI
import AuthenticationServices
import Security

// MARK: - AuthView

/// Sign-in view with Apple Sign In primary and phone auth alternative.
struct AuthView: View {
    /// Optional context message shown below the subtitle (e.g., deep link context)
    var contextMessage: String?

    @Environment(AuthManager.self) var authManager
    @Environment(APIClientWrapper.self) var apiWrapper
    @Environment(\.dismiss) private var dismiss

    @State private var errorMessage: String?
    @State private var isLoading = false
    @State private var currentNonce: String?
    @State private var showTerms = false
    @State private var showPrivacy = false

    var body: some View {
        ZStack {
            // Background: Deep velvet black
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                // Brand element: gold mic circle
                Circle()
                    .fill(DesignTokens.gold)
                    .frame(width: 48, height: 48)
                    .overlay(
                        Image(systemName: "mic.fill")
                            .font(.system(size: 24))
                            .foregroundStyle(.white)
                    )

                // Header: Sign in prompt + subtitle
                VStack(spacing: 20) {
                    Text("Sign in to create\nyour song")
                        .font(DesignTokens.displayFont(size: 22))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .multilineTextAlignment(.center)

                    Text("It takes about 90 seconds")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.textSecondary)

                    if let contextMessage {
                        Text(contextMessage)
                            .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                            .foregroundStyle(DesignTokens.gold)
                            .multilineTextAlignment(.center)
                    }
                }

                Spacer()

                // Error banner
                if let error = errorMessage {
                    errorBanner(error)
                        .padding(.horizontal, 20)
                        .padding(.bottom, 16)
                }

                // Auth buttons
                VStack(spacing: 12) {
                    // Sign in with Apple (primary — black bg, white text)
                    appleSignInButton

                    // Phone number (gold outline)
                    Button {
                        authManager.startPhoneAuth()
                    } label: {
                        HStack(spacing: 8) {
                            Text("\u{1F4F1}")
                            Text("Continue with Phone")
                        }
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(DesignTokens.gold)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(DesignTokens.gold, lineWidth: 1.5))
                    }
                    .buttonStyle(.plain)
                    .disabled(isLoading)
                    .opacity(isLoading ? 0.7 : 1.0)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)

                // Legal footer
                legalFooter
                    .padding(.bottom, 40)
            }

            // Loading overlay
            if isLoading {
                Color.black.opacity(0.3)
                    .ignoresSafeArea()

                ProgressView()
                    .scaleEffect(1.2)
                    .tint(.white)
            }
        }
        .fullScreenCover(isPresented: phoneAuthPresented) {
            PhoneAuthFlowView()
                .environment(authManager)
                .environment(apiWrapper)
        }
        .onChange(of: authManager.isAuthenticated) { _, isAuthenticated in
            if isAuthenticated {
                errorMessage = nil
            }
        }
    }

    // MARK: - Components

    private func errorBanner(_ error: String) -> some View {
        HStack(spacing: DesignTokens.spacing8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(DesignTokens.error)
            Text(error)
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textPrimary)
            Spacer()
            Button {
                errorMessage = nil
            } label: {
                Image(systemName: "xmark")
                    .font(.caption)
                    .foregroundStyle(DesignTokens.textSecondary)
            }
        }
        .padding(DesignTokens.spacing12)
        .background(DesignTokens.error.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
    }

    /// Legal footer with Terms of Service and Privacy Policy
    private var legalFooter: some View {
        VStack(spacing: 4) {
            Text("By continuing, you agree to Porizo's")
                .font(DesignTokens.bodyFont(size: 11))
                .foregroundStyle(DesignTokens.textTertiary)
                .multilineTextAlignment(.center)

            HStack(spacing: 4) {
                Button {
                    showTerms = true
                } label: {
                    Text("Terms of Service")
                        .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                        .foregroundStyle(DesignTokens.gold)
                        .underline()
                }

                Text("and")
                    .font(DesignTokens.bodyFont(size: 11))
                    .foregroundStyle(DesignTokens.textTertiary)

                Button {
                    showPrivacy = true
                } label: {
                    Text("Privacy Policy")
                        .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                        .foregroundStyle(DesignTokens.gold)
                        .underline()
                }
            }
        }
        .padding(.top, 8)
        .sheet(isPresented: $showTerms) {
            if let url = termsUrl {
                SafariView(url: url)
            } else {
                legalFallbackView
            }
        }
        .sheet(isPresented: $showPrivacy) {
            if let url = privacyUrl {
                SafariView(url: url)
            } else {
                legalFallbackView
            }
        }
    }

    private var appleSignInButton: some View {
        SignInWithAppleButton(.signIn) { request in
            request.requestedScopes = [.email, .fullName]
            let nonce = randomNonceString()
            guard !nonce.isEmpty else {
                currentNonce = nil
                return
            }
            currentNonce = nonce
            request.nonce = sha256(nonce)
        } onCompletion: { result in
            handleAppleSignIn(result)
        }
        .signInWithAppleButtonStyle(.black)
        .frame(maxWidth: .infinity)
        .frame(height: 52)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .disabled(isLoading)
        .opacity(isLoading ? 0.7 : 1.0)
    }

    private var termsUrl: URL? {
        URL(string: "\(AppConfig.apiBaseURL)/legal/terms")
    }

    private var privacyUrl: URL? {
        URL(string: "\(AppConfig.apiBaseURL)/legal/privacy")
    }

    private var legalFallbackView: some View {
        VStack(spacing: 12) {
            Text("Legal page unavailable")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)
            Text("Please try again later.")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DesignTokens.background.ignoresSafeArea())
    }

    private var phoneAuthPresented: Binding<Bool> {
        Binding(
            get: { authManager.phoneAuthState != .idle },
            set: { isPresented in
                if !isPresented {
                    authManager.cancelPhoneAuth()
                }
            }
        )
    }

    // MARK: - Apple Sign-In Handler

    private func handleAppleSignIn(_ result: Result<ASAuthorization, Error>) {
        Task { @MainActor in
            isLoading = true
            errorMessage = nil

            switch result {
            case .success(let authorization):
                do {
                    guard let nonce = currentNonce else {
                        throw AuthError.serverError("Sign-in session invalid. Please try again.")
                    }
                    try await authManager.handleAppleSignIn(authorization: authorization, nonce: nonce)
                    currentNonce = nil
                    // Success - dismiss the sheet
                    dismiss()
                } catch let error as AuthError {
                    currentNonce = nil
                    errorMessage = error.localizedDescription
                } catch {
                    currentNonce = nil
                    errorMessage = friendlyAppleSignInMessage(for: error)
                }

            case .failure(let error):
                // User cancelled - don't show error
                if (error as NSError).code != ASAuthorizationError.canceled.rawValue {
                    errorMessage = friendlyAppleSignInMessage(for: error)
                }
                currentNonce = nil
            }

            isLoading = false
        }
    }

    private func friendlyAppleSignInMessage(for error: Error) -> String {
        if let authError = error as? AuthError {
            return authError.localizedDescription
        }

        let nsError = error as NSError
        if nsError.domain == ASAuthorizationError.errorDomain,
           let authCode = ASAuthorizationError.Code(rawValue: nsError.code) {
            if authCode == .canceled {
                return ""
            }
            if authCode == .failed {
                return "Apple Sign-In couldn't finish. Please try again."
            }
            if authCode == .invalidResponse {
                return "Apple Sign-In returned an invalid response. Please try again."
            }
            if authCode == .notHandled {
                return "Apple Sign-In couldn't be completed on this device right now."
            }
            if authCode == .unknown {
                return "Apple Sign-In ran into an unexpected problem. Please try again."
            }
            if authCode == .notInteractive {
                return "Apple Sign-In is not available right now. Please try again."
            }

            return "Apple Sign-In couldn't finish. Please try again."
        }

        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost, .timedOut:
                return "Couldn't reach Apple right now. Check your connection and try again."
            default:
                break
            }
        }

        return ErrorHandler.friendlyMessage(for: error, context: "Signing in with Apple")
    }
}

// MARK: - Preview

#Preview {
    AuthView()
        .environment(AuthManager())
        .environment(APIClientWrapper(baseURL: AppConfig.apiBaseURL))
}
