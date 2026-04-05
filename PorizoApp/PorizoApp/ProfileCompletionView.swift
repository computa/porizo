//
//  ProfileCompletionView.swift
//  PorizoApp
//
//  Post-auth profile completion — email-only form matching Warm Canvas gallery design.
//

import SwiftUI

struct ProfileCompletionView: View {
    @Environment(AuthManager.self) var authManager
    @Environment(\.dismiss) var dismiss
    let apiClient: APIClient

    @State private var email = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var isRelayEmail: Bool {
        email.trimmingCharacters(in: .whitespaces).hasSuffix("@privaterelay.appleid.com")
    }

    private var hasValidEmail: Bool {
        let trimmedEmail = email.trimmingCharacters(in: .whitespaces)
        return !trimmedEmail.isEmpty && trimmedEmail.contains("@") && trimmedEmail.contains(".") && !isRelayEmail
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 20) {
                        // Title + subtitle
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Complete your profile")
                                .font(DesignTokens.bodyFont(size: 20, weight: .bold))
                                .foregroundStyle(DesignTokens.textPrimary)
                            Text("Add your email to sync across devices")
                                .font(DesignTokens.bodyFont(size: 14))
                                .foregroundStyle(DesignTokens.textSecondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)

                        // Email field
                        VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
                            TextField("your@email.com", text: $email)
                                .keyboardType(.emailAddress)
                                .textContentType(.emailAddress)
                                .autocapitalization(.none)
                                .autocorrectionDisabled()
                                .font(DesignTokens.bodyFont(size: 16))
                                .foregroundStyle(DesignTokens.textPrimary)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 14)
                                .background(DesignTokens.surface)
                                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                                .overlay(
                                    RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                                        .stroke(DesignTokens.border, lineWidth: 1.5)
                                )

                            if isRelayEmail {
                                Text("This is a private relay address. Please enter your real email.")
                                    .font(DesignTokens.bodyFont(size: 12))
                                    .foregroundStyle(DesignTokens.gold)
                            }
                        }

                        // Error message
                        if let errorMessage {
                            Text(errorMessage)
                                .font(DesignTokens.bodyFont(size: 13))
                                .foregroundStyle(DesignTokens.error)
                        }

                        // Continue button
                        Button {
                            Task { await save() }
                        } label: {
                            HStack(spacing: 8) {
                                if isSaving {
                                    ProgressView()
                                        .tint(.white)
                                }
                                Text("Continue")
                                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            }
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(DesignTokens.gold)
                            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                        }
                        .disabled(!hasValidEmail || isSaving)
                        .opacity(!hasValidEmail ? 0.5 : 1.0)
                        .buttonStyle(.plain)

                        // Skip for now link
                        Button {
                            skip()
                        } label: {
                            Text("Skip for now")
                                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                                .foregroundStyle(DesignTokens.gold)
                        }
                    }
                    .padding(.horizontal, DesignTokens.spacing20)
                    .padding(.bottom, DesignTokens.spacing32)
                }
                .scrollIndicators(.hidden)
                .scrollDismissesKeyboard(.interactively)
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear {
            // If user has a real email, pre-fill it for editing
            // If relay email, leave field empty with placeholder CTA
            if let existing = authManager.currentUser?.email,
               !existing.hasSuffix("@privaterelay.appleid.com") {
                email = existing
            }
        }
    }

    private func save() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        let trimmedEmail = email.trimmingCharacters(in: .whitespaces)

        do {
            let updated = try await apiClient.updateProfile(
                contactEmail: trimmedEmail.isEmpty ? nil : trimmedEmail,
                phoneNumber: nil
            )
            authManager.updateCurrentUser(updated)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func skip() {
        authManager.dismissProfileCompletion()
        dismiss()
    }
}
