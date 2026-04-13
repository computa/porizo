//
//  AccountExistsView.swift
//  PorizoApp
//
//  Shown when phone registration discovers an existing account via cross-identifier lookup.
//  Prompts user to sign in with their existing method (Apple, email) to link the phone.
//  Matches Warm Canvas gallery design.
//

import SwiftUI
import AuthenticationServices

struct AccountExistsView: View {
    let authMethods: [String]
    let maskedEmail: String?
    let maskedPhone: String?
    let phoneNumber: String
    let onSignInWithApple: () -> Void
    let onSignInWithEmail: () -> Void
    let onBack: () -> Void

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                HStack {
                    Button { onBack() } label: {
                        ZStack {
                            Circle()
                                .fill(Color.black.opacity(0.05))
                                .frame(width: 44, height: 44)
                            Image(systemName: "arrow.left")
                                .font(.system(size: 18))
                                .foregroundStyle(DesignTokens.textPrimary)
                        }
                    }
                    Spacer()
                    Color.clear.frame(width: 44, height: 44)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 8)

                VStack(spacing: 24) {
                    // Title
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Account found")
                            .font(DesignTokens.bodyFont(size: 20, weight: .bold))
                            .foregroundStyle(DesignTokens.textPrimary)

                        Text("This phone number is linked to an existing account. Sign in to connect it.")
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.textSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    // Account info card
                    VStack(alignment: .leading, spacing: 8) {
                        if let email = maskedEmail {
                            HStack(spacing: 10) {
                                Image(systemName: "envelope.fill")
                                    .foregroundStyle(DesignTokens.gold)
                                    .font(.system(size: 16))
                                Text(email)
                                    .font(DesignTokens.bodyFont(size: 15))
                                    .foregroundStyle(DesignTokens.textPrimary)
                            }
                        }
                        if let phone = maskedPhone {
                            HStack(spacing: 10) {
                                Image(systemName: "phone.fill")
                                    .foregroundStyle(DesignTokens.gold)
                                    .font(.system(size: 16))
                                Text(phone)
                                    .font(DesignTokens.bodyFont(size: 15))
                                    .foregroundStyle(DesignTokens.textPrimary)
                            }
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(DesignTokens.surface)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                    .overlay(
                        RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                            .stroke(DesignTokens.border, lineWidth: 0.5)
                    )

                    Spacer()

                    // Sign-in options based on available auth methods
                    VStack(spacing: 12) {
                        if authMethods.contains("apple") {
                            Button { onSignInWithApple() } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "apple.logo")
                                        .font(.system(size: 18))
                                    Text("Sign in with Apple")
                                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                                }
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                                .background(.black)
                                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                            }
                            .buttonStyle(.plain)
                        }

                        if authMethods.contains("google") {
                            Button { onSignInWithEmail() } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "g.circle.fill")
                                        .font(.system(size: 18))
                                    Text("Sign in with Google")
                                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                                }
                                .foregroundStyle(DesignTokens.textPrimary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                                .background(DesignTokens.surface)
                                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                                .overlay(
                                    RoundedRectangle(cornerRadius: DesignTokens.radiusCTA)
                                        .stroke(DesignTokens.border, lineWidth: 0.5)
                                )
                            }
                            .buttonStyle(.plain)
                        }

                        if authMethods.contains("email") {
                            Button { onSignInWithEmail() } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "envelope.fill")
                                        .font(.system(size: 18))
                                    Text("Sign in with email")
                                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                                }
                                .foregroundStyle(DesignTokens.textPrimary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                                .background(DesignTokens.surface)
                                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                                .overlay(
                                    RoundedRectangle(cornerRadius: DesignTokens.radiusCTA)
                                        .stroke(DesignTokens.border, lineWidth: 0.5)
                                )
                            }
                            .buttonStyle(.plain)
                        }

                        if authMethods.contains("phone") {
                            Button { onBack() } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "phone.fill")
                                        .font(.system(size: 18))
                                    Text("Sign in with phone")
                                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                                }
                                .foregroundStyle(DesignTokens.textPrimary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                                .background(DesignTokens.surface)
                                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                                .overlay(
                                    RoundedRectangle(cornerRadius: DesignTokens.radiusCTA)
                                        .stroke(DesignTokens.border, lineWidth: 0.5)
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 34)
            }
        }
    }
}
