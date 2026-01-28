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
    @State private var showPhoneAuthComingSoon = false

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

                    // Phone number CTA (coming soon)
                    VelvetButton("Use my phone number", icon: "phone.fill", style: .primary) {
                        showPhoneAuthComingSoon = true
                    }

                    // Divider
                    DividerWithText("or")

                    // Social auth buttons
                    HStack(spacing: 12) {
                        // Apple Sign-In
                        appleSignInButton

                        // Google (placeholder)
                        SocialAuthButton(provider: .google) {
                            showPhoneAuthComingSoon = true
                        }

                        // Twitter/X (placeholder)
                        SocialAuthButton(provider: .twitter) {
                            showPhoneAuthComingSoon = true
                        }

                        // Facebook (placeholder)
                        SocialAuthButton(provider: .facebook) {
                            showPhoneAuthComingSoon = true
                        }
                    }
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
        .alert("Coming Soon", isPresented: $showPhoneAuthComingSoon) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Phone authentication is coming soon. Please use Apple Sign-In for now.")
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
