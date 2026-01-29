//
//  AuthView.swift
//  PorizoApp
//
//  Create Account view matching v1.pen "02 - Create Account" design.
//  Phone auth primary (coming soon), with social auth alternatives.
//

import SwiftUI
import AuthenticationServices
import CryptoKit
import Security

// MARK: - AuthView

/// Create account / sign-in view with phone auth primary and social alternatives.
struct AuthView: View {
    @EnvironmentObject var authManager: AuthManager
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
                // Header with back button
                VelvetHeader(
                    showBackButton: true,
                    onBack: { dismiss() }
                )

                // Content
                VStack(spacing: 32) {
                    // Title section
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Create your")
                            .font(DesignTokens.displayFont(size: 36))
                            .foregroundColor(DesignTokens.textPrimary)
                        Text("porizo account")
                            .font(DesignTokens.displayFont(size: 36))
                            .foregroundColor(DesignTokens.textPrimary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Spacer()

                    // Error banner
                    if let error = errorMessage {
                        errorBanner(error)
                    }

                    // Apple Sign-In (primary)
                    VStack(spacing: 12) {
                        Text("Sign in with Apple to continue")
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundColor(DesignTokens.textSecondary)

                        appleSignInButton
                    }

                    Spacer()

                    // Legal footer (v1.pen: Terms of Service + Privacy Policy)
                    legalFooter
                }
                .padding(.top, 40)
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
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
    }

    // MARK: - Components

    private func errorBanner(_ error: String) -> some View {
        HStack(spacing: DesignTokens.spacing8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(DesignTokens.error)
            Text(error)
                .font(.subheadline)
                .foregroundColor(DesignTokens.textPrimary)
            Spacer()
            Button {
                errorMessage = nil
            } label: {
                Image(systemName: "xmark")
                    .font(.caption)
                    .foregroundColor(DesignTokens.textSecondary)
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
                .foregroundColor(DesignTokens.textTertiary)
                .multilineTextAlignment(.center)

            HStack(spacing: 4) {
                Button {
                    showTerms = true
                } label: {
                    Text("Terms of Service")
                        .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                        .foregroundColor(DesignTokens.gold)
                        .underline()
                }

                Text("and acknowledge that you")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundColor(DesignTokens.textTertiary)
            }

            HStack(spacing: 4) {
                Text("have read and understood the")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundColor(DesignTokens.textTertiary)

                Button {
                    showPrivacy = true
                } label: {
                    Text("Privacy Policy")
                        .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                        .foregroundColor(DesignTokens.gold)
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
        .frame(width: 56, height: 56)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                .stroke(DesignTokens.borderSubtle, lineWidth: 1)
        )
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
                .foregroundColor(DesignTokens.textPrimary)
            Text("Please try again later.")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundColor(DesignTokens.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DesignTokens.background.ignoresSafeArea())
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
                    errorMessage = error.localizedDescription
                } catch {
                    errorMessage = "Sign in failed. Please try again."
                }

            case .failure(let error):
                // User cancelled - don't show error
                if (error as NSError).code != ASAuthorizationError.canceled.rawValue {
                    errorMessage = "Apple Sign In failed. Please try again."
                }
            }

            isLoading = false
        }
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
        .environmentObject(AuthManager())
}
