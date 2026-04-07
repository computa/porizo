//
//  AccountCheckView.swift
//  PorizoApp
//
//  Shown after phone OTP verification when phone is new.
//  Asks if user has an existing account to prevent duplicates.
//  Matches Warm Canvas gallery design.
//

import SwiftUI

struct AccountCheckView: View {
    let phoneNumber: String
    let onCreateNew: () async throws -> Void
    let onLinkExisting: () -> Void
    let onBack: () -> Void

    @State private var isCreating = false
    @State private var errorMessage: String?

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

                VStack(spacing: 32) {
                    // Title
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Phone verified")
                            .font(DesignTokens.bodyFont(size: 20, weight: .bold))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Text("Do you already have a Porizo account?")
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.textSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    // Verified phone badge
                    HStack(spacing: 12) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(DesignTokens.success)
                            .font(.system(size: 24))

                        Text(maskedPhone)
                            .font(DesignTokens.bodyFont(size: 16, weight: .medium))
                            .foregroundStyle(DesignTokens.textPrimary)

                        Spacer()
                    }
                    .padding(16)
                    .background(DesignTokens.surface)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                    .overlay(
                        RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                            .stroke(DesignTokens.success.opacity(0.3), lineWidth: 1.5)
                    )

                    Spacer()

                    // Option 1: Link to existing account
                    Button {
                        onLinkExisting()
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "person.crop.circle.badge.plus")
                                .font(.system(size: 18))
                            Text("I have an account — sign in")
                                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(DesignTokens.gold)
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                    }
                    .buttonStyle(.plain)

                    // Error banner
                    if let errorMessage {
                        HStack(spacing: DesignTokens.spacing8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(DesignTokens.error)
                            Text(errorMessage)
                                .font(DesignTokens.bodyFont(size: 14))
                                .foregroundStyle(DesignTokens.textPrimary)
                        }
                        .padding(DesignTokens.spacing12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(DesignTokens.error.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                    }

                    // Option 2: Create new account
                    Button {
                        Task {
                            isCreating = true
                            errorMessage = nil
                            do {
                                try await onCreateNew()
                            } catch {
                                isCreating = false
                                errorMessage = error.localizedDescription
                            }
                        }
                    } label: {
                        HStack(spacing: 8) {
                            if isCreating {
                                ProgressView()
                                    .tint(DesignTokens.gold)
                            }
                            Text("I'm new — create account")
                                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        }
                        .foregroundStyle(DesignTokens.gold)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(.clear)
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                        .overlay(
                            RoundedRectangle(cornerRadius: DesignTokens.radiusCTA)
                                .stroke(DesignTokens.gold, lineWidth: 1.5)
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(isCreating)
                }
                .padding(.top, 24)
                .padding(.horizontal, 24)
                .padding(.bottom, 34)
            }
        }
    }

    private var maskedPhone: String {
        maskedPhoneDisplay(phoneNumber)
    }
}
