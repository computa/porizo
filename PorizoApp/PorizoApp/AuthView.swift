//
//  AuthView.swift
//  PorizoApp
//
//  Social-first authentication view with centered layout.
//  Simplified to Apple Sign-In primary, with optional Google if configured.
//

import SwiftUI
import AuthenticationServices
import CryptoKit
import Security

// MARK: - AuthView

/// Social-first authentication view with centered app icon and prominent sign-in buttons.
struct AuthView: View {
    @EnvironmentObject var authManager: AuthManager
    @Environment(\.dismiss) private var dismiss

    @State private var errorMessage: String?
    @State private var isLoading = false
    @State private var currentNonce: String?

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Dismiss button
                HStack {
                    Spacer()
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(DesignTokens.textSecondary)
                            .frame(width: 32, height: 32)
                            .background(DesignTokens.backgroundSubtle)
                            .clipShape(Circle())
                    }
                }
                .padding(.horizontal, DesignTokens.spacing16)
                .padding(.top, DesignTokens.spacing16)

                Spacer()

                // Centered content
                VStack(spacing: DesignTokens.spacing28) {
                    // App icon - mic on rose circle
                    ZStack {
                        Circle()
                            .fill(DesignTokens.rose)
                            .frame(width: 120, height: 120)
                        Image(systemName: "mic.fill")
                            .font(.system(size: 48))
                            .foregroundColor(.white)
                    }
                    .accessibilityHidden(true)

                    // Title and subtitle
                    VStack(spacing: DesignTokens.spacing8) {
                        Text("Sign In to Porizo")
                            .font(.title.bold())
                            .foregroundColor(DesignTokens.textPrimary)

                        Text("Sync your songs across devices")
                            .font(.body)
                            .foregroundColor(DesignTokens.textSecondary)
                    }

                    // Error banner
                    if let error = errorMessage {
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

                    // Sign-in buttons
                    VStack(spacing: DesignTokens.spacing12) {
                        // Sign in with Apple (primary)
                        SignInWithAppleButton(.continue) { request in
                            request.requestedScopes = [.email, .fullName]
                            // Best practice: include a nonce to prevent replay attacks.
                            // Apple returns the hashed nonce in the ID token; the backend
                            // must verify it matches the raw nonce we send separately.
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
                        .frame(height: 54)
                        .clipShape(Capsule())

                        // Optional: Google sign-in button (styled to match)
                        // Uncomment when Google Sign-In is configured
                        /*
                        Button {
                            // Handle Google sign-in
                        } label: {
                            HStack(spacing: DesignTokens.spacing8) {
                                Image("google-logo") // Add to Assets
                                    .resizable()
                                    .frame(width: 20, height: 20)
                                Text("Continue with Google")
                                    .font(.body.weight(.medium))
                            }
                            .foregroundColor(DesignTokens.textPrimary)
                            .frame(maxWidth: .infinity)
                            .frame(height: 54)
                            .background(DesignTokens.cardBackground)
                            .clipShape(Capsule())
                            .overlay(
                                Capsule()
                                    .stroke(DesignTokens.cardBorder, lineWidth: 1)
                            )
                        }
                        */
                    }
                    .padding(.horizontal, DesignTokens.spacing16)
                }
                .padding(.horizontal, DesignTokens.spacing28)

                Spacer()

                // Legal footer
                VStack(spacing: DesignTokens.spacing8) {
                    Text("By continuing, you agree to our")
                        .font(.caption)
                        .foregroundColor(DesignTokens.textTertiary)

                    HStack(spacing: DesignTokens.spacing4) {
                        Link("Terms of Service", destination: URL(string: "https://porizo.co/terms")!)
                            .font(.caption.weight(.medium))
                            .foregroundColor(DesignTokens.rose)

                        Text("and")
                            .font(.caption)
                            .foregroundColor(DesignTokens.textTertiary)

                        Link("Privacy Policy", destination: URL(string: "https://porizo.co/privacy")!)
                            .font(.caption.weight(.medium))
                            .foregroundColor(DesignTokens.rose)
                    }
                }
                .padding(.bottom, DesignTokens.spacing28)
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
                // If secure randomness fails, abort sign-in rather than downgrade security.
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
