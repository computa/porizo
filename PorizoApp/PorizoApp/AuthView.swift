//
//  AuthView.swift
//  PorizoApp
//
//  Social-first authentication view with centered layout.
//  Simplified to Apple Sign-In primary, with optional Google if configured.
//

import SwiftUI
import AuthenticationServices

// MARK: - AuthView

/// Social-first authentication view with centered app icon and prominent sign-in buttons.
struct AuthView: View {
    @EnvironmentObject var authManager: AuthManager
    @Environment(\.dismiss) private var dismiss

    @State private var errorMessage: String?
    @State private var isLoading = false

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
                        Link("Terms of Service", destination: URL(string: "https://porizo.com/terms")!)
                            .font(.caption.weight(.medium))
                            .foregroundColor(DesignTokens.rose)

                        Text("and")
                            .font(.caption)
                            .foregroundColor(DesignTokens.textTertiary)

                        Link("Privacy Policy", destination: URL(string: "https://porizo.com/privacy")!)
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
                    try await authManager.handleAppleSignIn(authorization: authorization)
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
}

// MARK: - Preview

#Preview {
    AuthView()
        .environmentObject(AuthManager())
}
