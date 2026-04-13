//
//  PhoneProfileEntryView.swift
//  PorizoApp
//
//  Collects name and optional email after phone OTP verification for new users.
//  If email matches an existing verified account, server returns account_exists
//  and AuthManager transitions to .accountExists state.
//  Matches Warm Canvas gallery design.
//

import SwiftUI

enum PhoneProfileEntryValidator {
    static func isValidEmail(_ email: String) -> Bool {
        let trimmed = email.trimmingCharacters(in: .whitespaces)
        return !trimmed.isEmpty && trimmed.contains("@") && trimmed.contains(".")
    }

    static func canContinue(displayName: String, email: String) -> Bool {
        !displayName.trimmingCharacters(in: .whitespaces).isEmpty && isValidEmail(email)
    }
}

struct PhoneProfileEntryView: View {
    let phoneNumber: String
    let onSubmit: (String?, String?) async throws -> Void  // (name, email)
    let onBack: () -> Void

    @State private var displayName: String = ""
    @State private var email: String = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    @FocusState private var focusedField: Field?

    enum Field: Hashable {
        case name, email
    }

    private var isValidEmail: Bool {
        PhoneProfileEntryValidator.isValidEmail(email)
    }

    private var canContinue: Bool {
        PhoneProfileEntryValidator.canContinue(displayName: displayName, email: email)
    }

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
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Almost there")
                            .font(DesignTokens.bodyFont(size: 20, weight: .bold))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Text("Tell us a bit about yourself")
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.textSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    // Verified phone badge
                    HStack(spacing: 12) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(DesignTokens.success)
                            .font(.system(size: 20))
                        Text(maskedPhoneDisplay(phoneNumber))
                            .font(DesignTokens.bodyFont(size: 15, weight: .medium))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Spacer()
                    }
                    .padding(12)
                    .background(DesignTokens.surface)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                    .overlay(
                        RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                            .stroke(DesignTokens.success.opacity(0.3), lineWidth: 1)
                    )

                    // Name field
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Your name")
                            .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                            .foregroundStyle(DesignTokens.textSecondary)
                        TextField("How should we call you?", text: $displayName)
                            .font(DesignTokens.bodyFont(size: 16))
                            .foregroundStyle(DesignTokens.textPrimary)
                            .padding(14)
                            .background(DesignTokens.surface)
                            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                            .overlay(
                                RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                                    .stroke(focusedField == .name ? DesignTokens.gold : DesignTokens.border, lineWidth: 0.5)
                            )
                            .textContentType(.name)
                            .autocorrectionDisabled()
                            .focused($focusedField, equals: .name)
                    }

                    // Email field (required)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Email")
                            .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                            .foregroundStyle(DesignTokens.textSecondary)
                        TextField("your@email.com", text: $email)
                            .font(DesignTokens.bodyFont(size: 16))
                            .foregroundStyle(DesignTokens.textPrimary)
                            .padding(14)
                            .background(DesignTokens.surface)
                            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                            .overlay(
                                RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                                    .stroke(focusedField == .email ? DesignTokens.gold : DesignTokens.border, lineWidth: 0.5)
                            )
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .autocapitalization(.none)
                            .autocorrectionDisabled()
                            .focused($focusedField, equals: .email)
                        Text("We'll send a verification link")
                            .font(DesignTokens.bodyFont(size: 12))
                            .foregroundStyle(DesignTokens.textTertiary)
                    }

                    // Error banner
                    if let errorMessage {
                        HStack(spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(DesignTokens.error)
                            Text(errorMessage)
                                .font(DesignTokens.bodyFont(size: 13))
                                .foregroundStyle(DesignTokens.textPrimary)
                            Spacer()
                        }
                        .padding(12)
                        .background(DesignTokens.error.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                    }

                    Spacer()

                    // Continue button
                    Button {
                        submit()
                    } label: {
                        HStack(spacing: 8) {
                            if isSubmitting {
                                ProgressView()
                                    .tint(.black)
                            }
                            Text(isSubmitting ? "Creating account..." : "Continue")
                                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        }
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(DesignTokens.gold)
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                    }
                    .buttonStyle(.plain)
                    .disabled(isSubmitting || !canContinue)
                    .opacity(!canContinue ? 0.5 : 1.0)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 34)
            }
        }
        .onAppear {
            focusedField = .name
        }
    }

    private func submit() {
        guard !isSubmitting else { return }
        isSubmitting = true
        errorMessage = nil

        let trimmedName = displayName.trimmingCharacters(in: .whitespaces)
        let trimmedEmail = email.trimmingCharacters(in: .whitespaces)

        Task {
            do {
                try await onSubmit(
                    trimmedName.isEmpty ? nil : trimmedName,
                    trimmedEmail.isEmpty ? nil : trimmedEmail
                )
            } catch {
                errorMessage = error.localizedDescription
            }
            isSubmitting = false
        }
    }
}
