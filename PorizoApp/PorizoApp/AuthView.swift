//
//  AuthView.swift
//  PorizoApp
//
//  Create Account view matching v1.pen "02 - Create Account" design.
//  Phone auth primary with social auth alternatives.
//

import SwiftUI
import AuthenticationServices
import CryptoKit
import Security

// MARK: - AuthView

/// Create account / sign-in view with phone auth primary and social alternatives.
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

                // Brand element: gold waveform above welcome text
                WaveformVisualizer(barCount: 7, maxHeight: 32, animated: true)
                    .frame(height: 32)
                    .padding(.bottom, 24)

                // Header: Welcome + subtitle
                VStack(spacing: 12) {
                    Text("Welcome")
                        .font(DesignTokens.displayFont(size: 32))
                        .foregroundStyle(DesignTokens.textPrimary)

                    Text("Create personalized songs for birthdays,\nanniversaries, and every moment that matters.")
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .multilineTextAlignment(.center)
                        .lineSpacing(4)

                    if let contextMessage {
                        Text(contextMessage)
                            .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                            .foregroundStyle(DesignTokens.gold)
                            .multilineTextAlignment(.center)
                            .padding(.top, 8)
                    }
                }
                .padding(.horizontal, 20)

                Spacer()

                // Error banner
                if let error = errorMessage {
                    errorBanner(error)
                        .padding(.horizontal, 20)
                        .padding(.bottom, 16)
                }

                // Auth buttons
                VStack(spacing: 14) {
                    // Sign in with Apple (primary)
                    appleSignInButton

                    // Phone number (gold outline)
                    Button {
                        authManager.startPhoneAuth()
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "phone")
                                .font(.system(size: 18))
                            Text("Continue with Phone")
                                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        }
                        .foregroundStyle(DesignTokens.gold)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(.clear)
                        .clipShape(.rect(cornerRadius: DesignTokens.radiusCTA))
                        .overlay(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA).stroke(DesignTokens.gold, lineWidth: 1))
                    }
                    .buttonStyle(.plain)

                    if googleAuthAvailable {
                        VelvetButton("Continue with Google", icon: "g.circle.fill", style: .secondary) {
                            startGoogleSignIn()
                        }
                    }

                    if facebookAuthAvailable {
                        VelvetButton("Continue with Facebook", icon: "f.circle.fill", style: .secondary) {
                            startFacebookSignIn()
                        }
                    }
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

    /// Legal footer with Terms of Service and Privacy Policy (v1.pen design)
    private var legalFooter: some View {
        VStack(spacing: 4) {
            Text("By creating an account, you agree to the")
                .font(DesignTokens.bodyFont(size: 12))
                .foregroundStyle(DesignTokens.textTertiary)
                .multilineTextAlignment(.center)

            HStack(spacing: 4) {
                Button {
                    showTerms = true
                } label: {
                    Text("Terms of Service")
                        .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                        .foregroundStyle(DesignTokens.gold)
                        .underline()
                }

                Text("and acknowledge that you")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textTertiary)
            }

            HStack(spacing: 4) {
                Text("have read and understood the")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textTertiary)

                Button {
                    showPrivacy = true
                } label: {
                    Text("Privacy Policy")
                        .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                        .foregroundStyle(DesignTokens.gold)
                        .underline()
                }
            }
        }
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
        .signInWithAppleButtonStyle(.white)
        .frame(maxWidth: .infinity, minHeight: 50)
        .frame(height: 50)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusCTA)
                .stroke(Color.white.opacity(0.2), lineWidth: 1)
        )
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

    private var googleAuthAvailable: Bool {
        AppConfig.googleOAuthConfig != nil
    }

    private var facebookAuthAvailable: Bool {
        AppConfig.facebookOAuthConfig != nil
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
                    errorMessage = "Sign in failed. Please try again."
                }

            case .failure(let error):
                // User cancelled - don't show error
                if (error as NSError).code != ASAuthorizationError.canceled.rawValue {
                    errorMessage = "Apple Sign In failed. Please try again."
                }
                currentNonce = nil
            }

            isLoading = false
        }
    }

    // MARK: - Google/Facebook Sign-In

    private func startGoogleSignIn() {
        guard let config = AppConfig.googleOAuthConfig else {
            errorMessage = "Google sign-in is not configured."
            return
        }

        Task { @MainActor in
            do {
                isLoading = true
                errorMessage = nil

                let pkce = PKCE.generate()
                let state = UUID().uuidString

                let url = buildOAuthURL(
                    config: config,
                    state: state,
                    codeChallenge: pkce.challenge
                )

                let callbackUrl = try await OAuthWebAuthService.shared.authenticate(
                    url: url,
                    callbackScheme: config.callbackScheme
                )

                try await handleOAuthCallback(
                    provider: "google",
                    callbackUrl: callbackUrl,
                    redirectUri: config.redirectUri,
                    codeVerifier: pkce.verifier,
                    expectedState: state
                )
            } catch let error as OAuthWebAuthError {
                if case .cancelled = error {
                    // User cancelled; no error banner.
                } else {
                    errorMessage = error.localizedDescription
                }
            } catch {
                errorMessage = "Google sign-in failed. Please try again."
            }

            isLoading = false
        }
    }

    private func startFacebookSignIn() {
        guard let config = AppConfig.facebookOAuthConfig else {
            errorMessage = "Facebook sign-in is not configured."
            return
        }

        Task { @MainActor in
            do {
                isLoading = true
                errorMessage = nil

                let state = UUID().uuidString

                let url = buildOAuthURL(
                    config: config,
                    state: state,
                    codeChallenge: nil
                )

                let callbackUrl = try await OAuthWebAuthService.shared.authenticate(
                    url: url,
                    callbackScheme: config.callbackScheme
                )

                try await handleOAuthCallback(
                    provider: "facebook",
                    callbackUrl: callbackUrl,
                    redirectUri: config.redirectUri,
                    codeVerifier: nil,
                    expectedState: state
                )
            } catch let error as OAuthWebAuthError {
                if case .cancelled = error {
                    // User cancelled; no error banner.
                } else {
                    errorMessage = error.localizedDescription
                }
            } catch {
                errorMessage = "Facebook sign-in failed. Please try again."
            }

            isLoading = false
        }
    }

    private func buildOAuthURL(
        config: OAuthProviderConfig,
        state: String,
        codeChallenge: String?
    ) -> URL {
        var components = URLComponents(url: config.authorizationEndpoint, resolvingAgainstBaseURL: false)!
        var queryItems = [
            URLQueryItem(name: "client_id", value: config.clientId),
            URLQueryItem(name: "redirect_uri", value: config.redirectUri),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: config.scopes.joined(separator: " ")),
            URLQueryItem(name: "state", value: state)
        ]

        if config.provider == .google {
            queryItems.append(URLQueryItem(name: "prompt", value: "select_account"))
        }

        if let codeChallenge {
            queryItems.append(URLQueryItem(name: "code_challenge", value: codeChallenge))
            queryItems.append(URLQueryItem(name: "code_challenge_method", value: "S256"))
        }

        components.queryItems = queryItems
        return components.url!
    }

    private func handleOAuthCallback(
        provider: String,
        callbackUrl: URL,
        redirectUri: String,
        codeVerifier: String?,
        expectedState: String
    ) async throws {
        guard let components = URLComponents(url: callbackUrl, resolvingAgainstBaseURL: false) else {
            throw OAuthWebAuthError.invalidCallback
        }

        if let error = components.queryItems?.first(where: { $0.name == "error" })?.value {
            throw AuthError.serverError("\(provider.capitalized) sign-in failed: \(error)")
        }

        let code = components.queryItems?.first(where: { $0.name == "code" })?.value
        let returnedState = components.queryItems?.first(where: { $0.name == "state" })?.value

        guard let code, !code.isEmpty else {
            throw OAuthWebAuthError.invalidCallback
        }

        if returnedState != expectedState {
            throw AuthError.serverError("Sign-in state mismatch. Please try again.")
        }

        try await authManager.handleOAuthAuthorization(
            provider: provider,
            authorizationCode: code,
            codeVerifier: codeVerifier,
            redirectUri: redirectUri
        )
    }

    // MARK: - Nonce Helpers

    /// Generate a cryptographically secure random nonce.
    private func randomNonceString(length: Int = 32) -> String {
        precondition(length > 0)
        let charset: [Character] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        var remainingLength = length

        while remainingLength > 0 {
            var randomBytes = [UInt8](repeating: 0, count: 16)
            let status = SecRandomCopyBytes(kSecRandomDefault, randomBytes.count, &randomBytes)
            if status != errSecSuccess {
                return ""
            }

            randomBytes.forEach { byte in
                if remainingLength == 0 {
                    return
                }

                if byte < charset.count {
                    result.append(charset[Int(byte)])
                    remainingLength -= 1
                }
            }
        }

        return result
    }

    /// SHA-256 hash of the nonce, as required by Sign in with Apple.
    private func sha256(_ input: String) -> String {
        let inputData = Data(input.utf8)
        let hashed = SHA256.hash(data: inputData)
        return hashed.map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Preview

#Preview {
    AuthView()
        .environment(AuthManager())
        .environment(APIClientWrapper(baseURL: AppConfig.apiBaseURL))
}
