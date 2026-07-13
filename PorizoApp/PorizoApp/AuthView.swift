//
//  AuthView.swift
//  PorizoApp
//
//  Sign-in view matching Warm Canvas gallery design.
//  Passwordless email sign-in.
//

import SwiftUI
import AuthenticationServices
import Security
import UIKit

// MARK: - AuthView

/// Sign-in view with platform-bound passwordless email authentication.
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
    @State private var pendingLinkPrompt: (provider: String, maskedEmail: String)?
    @State private var email = ""
    @FocusState private var emailFocused: Bool

    var body: some View {
        ZStack {
            // Background: Deep velvet black
            DesignTokens.background.ignoresSafeArea()

            ScrollView {
                if let presentation = loginPresentation {
                    VStack(spacing: DesignTokens.spacing16) {
                        CheckEmailView(
                            context: presentation,
                            state: authManager.magicLoginState,
                            onResend: { resendMagicLink(to: presentation.email) },
                            onUseDifferentEmail: useDifferentEmail,
                            onRefresh: {
                                await authManager.refreshMagicLoginStatus(
                                    transactionId: presentation.transactionId
                                )
                            }
                        )

                        legacyRecoveryActions
                            .padding(.horizontal, DesignTokens.spacing20)
                            .padding(.bottom, DesignTokens.spacing32)
                    }
                } else {
                    VStack(spacing: 0) {
                        Spacer(minLength: 24)

                        authHeader

                        Spacer(minLength: 24)

                        if let error = errorMessage {
                            errorBanner(error)
                                .padding(.horizontal, 20)
                                .padding(.bottom, 16)
                        }

                        VStack(spacing: 12) {
                            TextField("Email address", text: $email)
                                .textContentType(.emailAddress)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .focused($emailFocused)
                                .padding(.horizontal, 16)
                                .frame(minHeight: 52)
                                .background(DesignTokens.surface)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                .accessibilityLabel("Email address")

                            Button {
                                sendMagicLink()
                            } label: {
                                Label(magicButtonTitle, systemImage: "envelope.fill")
                                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                                    .frame(maxWidth: .infinity)
                                    .frame(minHeight: 52)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(DesignTokens.gold)
                            .foregroundStyle(DesignTokens.background)
                            .disabled(isLoading || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            .accessibilityHint("Sends a sign-in link that can only be completed on this device")
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 24)

                        legalFooter
                            .padding(.bottom, 40)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .scrollDismissesKeyboard(.interactively)

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
        .onChange(of: authManager.magicLoginState) { _, state in
            if let message = magicStatusMessage {
                UIAccessibility.post(notification: .announcement, argument: message)
            }
            isLoading = state == .submitting || state == .opening || state == .exchanging
        }
        .alert(
            "Link existing account?",
            isPresented: Binding(
                get: { pendingLinkPrompt != nil },
                set: { isPresented in
                    if !isPresented {
                        pendingLinkPrompt = nil
                    }
                }
            ),
            presenting: pendingLinkPrompt
        ) { prompt in
            Button("Cancel", role: .cancel) {
                authManager.cancelPendingSocialLink()
                pendingLinkPrompt = nil
            }
            Button("Link and continue") {
                Task { @MainActor in
                    isLoading = true
                    defer { isLoading = false }
                    do {
                        try await authManager.confirmPendingSocialLink()
                        pendingLinkPrompt = nil
                        dismiss()
                    } catch let error as AuthError {
                        errorMessage = error.localizedDescription
                    } catch {
                        errorMessage = ErrorHandler.friendlyMessage(for: error, context: "Confirming account link")
                    }
                }
            }
        } message: { prompt in
            Text("This \(prompt.provider.capitalized) sign-in matches an existing account (\(prompt.maskedEmail)). Link it to continue?")
        }
    }

    // MARK: - Components

    private var magicButtonTitle: String {
        switch authManager.magicLoginState {
        case .submitting: "Sending link..."
        case .sent, .cooldown: "Resend sign-in link"
        default: "Email me a sign-in link"
        }
    }

    private var magicStatusMessage: String? {
        switch authManager.magicLoginState {
        case .idle: nil
        case .submitting: "Sending a secure sign-in link."
        case .sent(let email), .cooldown(let email): "Link sent to \(email). Open it on this device."
        case .opening, .exchanging: "Verifying your sign-in link."
        case .success: "Signed in successfully."
        case .expired: "This link expired. Request a new link."
        case .locked: "This request is locked. Change email or contact support."
        case .conflict: "That email belongs to another account. Keep this account or sign out first."
        case .legacyRecovery(let maskedEmail, _): "Recover the existing account for \(maskedEmail) to keep its songs and purchases."
        case .wrongDeviceOrPlatform: "This link was requested on another device or platform. Request a new link here."
        case .offline: "You're offline. Check your connection and try again."
        case .serverError: "Sign-in could not be completed. Try again or contact support."
        case .cancelled: "Sign-in cancelled."
        case .superseded: "A newer sign-in request replaced this one. Request another link."
        }
    }

    private func sendMagicLink() {
        emailFocused = false
        errorMessage = nil
        Task { @MainActor in
            do {
                try await authManager.requestMagicLogin(email: email, purpose: .login)
            } catch let error as AuthError {
                errorMessage = error.localizedDescription
            } catch {
                errorMessage = ErrorHandler.friendlyMessage(for: error, context: "Sending sign-in link")
            }
        }
    }

    private var loginPresentation: MagicLoginPresentation? {
        guard authManager.pendingMagicLoginPresentation?.purpose == .login else { return nil }
        return authManager.pendingMagicLoginPresentation
    }

    private func resendMagicLink(to email: String) {
        errorMessage = nil
        Task { @MainActor in
            do {
                try await authManager.requestMagicLogin(email: email, purpose: .login)
            } catch let error as AuthError {
                errorMessage = error.localizedDescription
            } catch {
                errorMessage = ErrorHandler.friendlyMessage(for: error, context: "Resending sign-in link")
            }
        }
    }

    private func useDifferentEmail() {
        if let pendingEmail = loginPresentation?.email {
            email = pendingEmail
        }
        authManager.cancelMagicLogin()
        authManager.resetMagicLoginState()
        emailFocused = true
    }

    @ViewBuilder
    private var legacyRecoveryActions: some View {
        if case .legacyRecovery(_, let authMethods) = authManager.magicLoginState {
            VStack(spacing: DesignTokens.spacing12) {
                Text("Recover existing account")
                    .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)

                if authMethods.contains("apple") {
                    appleSignInButton
                }

                if authMethods.contains("phone") {
                    Button {
                        authManager.startPhoneAuth()
                    } label: {
                        Label("Continue with phone", systemImage: "phone.fill")
                            .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 52)
                    }
                    .buttonStyle(.bordered)
                    .tint(DesignTokens.gold)
                }

                if authMethods.isEmpty || authMethods.contains(where: { method in
                    method != "apple" && method != "phone"
                }) {
                    Text("Contact support so we can recover the original account without separating its content.")
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .multilineTextAlignment(.center)
                }
            }
        }
    }

    private var authHeader: some View {
        VStack(spacing: 18) {
            BrandMarkView(size: 48)

            VStack(spacing: 12) {
                Text("Create a personalized\nsong gift")
                    .font(DesignTokens.displayFont(size: 22))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(1)
                    .frame(maxWidth: 252)

                Text("For birthdays, anniversaries,\nand the moments that matter")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textPrimary.opacity(0.58))
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .frame(maxWidth: 272)

                if let contextMessage {
                    Text(contextMessage)
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundStyle(DesignTokens.gold)
                        .multilineTextAlignment(.center)
                        .lineSpacing(2)
                        .frame(maxWidth: 272)
                        .padding(.top, 2)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 20)
    }

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
        .legalSheets(showTerms: $showTerms, showPrivacy: $showPrivacy)
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
                    if case .requiresLinkConfirmation(let provider, let maskedEmail) = error {
                        pendingLinkPrompt = (provider, maskedEmail)
                    } else {
                        errorMessage = error.localizedDescription
                    }
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
