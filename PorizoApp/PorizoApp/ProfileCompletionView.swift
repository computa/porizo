//
//  ProfileCompletionView.swift
//  PorizoApp
//
//  Post-auth profile completion sheet for users with relay emails or missing contact info.
//

import SwiftUI

struct ProfileCompletionView: View {
    @EnvironmentObject var authManager: AuthManager
    @Environment(\.dismiss) var dismiss
    let apiClient: APIClient

    @State private var email = ""
    @State private var phone = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var isRelayEmail: Bool {
        email.trimmingCharacters(in: .whitespaces).hasSuffix("@privaterelay.appleid.com")
    }

    private var hasValidInput: Bool {
        let trimmedEmail = email.trimmingCharacters(in: .whitespaces)
        let hasEmail = !trimmedEmail.isEmpty && trimmedEmail.contains("@") && trimmedEmail.contains(".") && !isRelayEmail
        let trimmedPhone = phone.trimmingCharacters(in: .whitespaces)
        let hasPhone = trimmedPhone.hasPrefix("+") && trimmedPhone.count >= 10
        return hasEmail || hasPhone
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: DesignTokens.spacing24) {
                        // Header icon
                        ZStack {
                            Circle()
                                .fill(DesignTokens.gold.opacity(0.15))
                                .frame(width: 80, height: 80)
                            Image(systemName: "person.crop.circle.badge.plus")
                                .font(.system(size: 36))
                                .foregroundColor(DesignTokens.gold)
                        }
                        .padding(.top, DesignTokens.spacing24)

                        // Title + subtitle
                        VStack(spacing: DesignTokens.spacing8) {
                            Text("Complete Your Profile")
                                .font(DesignTokens.displayFont(size: 24))
                                .foregroundColor(DesignTokens.textPrimary)

                            Text("Add a contact email or phone so we can reach you about your songs.")
                                .font(DesignTokens.bodyFont(size: 15))
                                .foregroundColor(DesignTokens.textSecondary)
                                .multilineTextAlignment(.center)
                                .lineSpacing(2)
                        }
                        .padding(.horizontal, DesignTokens.spacing20)

                        // Email field
                        VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
                            Text("Email")
                                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                                .foregroundColor(DesignTokens.textSecondary)

                            TextField("", text: $email, prompt: Text("Enter your email address")
                                .font(DesignTokens.bodyFont(size: 17, weight: .medium))
                                .foregroundColor(DesignTokens.textSecondary))
                                .keyboardType(.emailAddress)
                                .textContentType(.emailAddress)
                                .autocapitalization(.none)
                                .disableAutocorrection(true)
                                .font(DesignTokens.bodyFont(size: 17, weight: .medium))
                                .foregroundColor(DesignTokens.textPrimary)
                                .padding(DesignTokens.spacing12)
                                .background(Color(hex: "#3A3A3A"))
                                .cornerRadius(DesignTokens.radiusMedium)
                                .overlay(
                                    RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                                        .stroke(DesignTokens.borderSubtle, lineWidth: 1)
                                )
                            if isRelayEmail {
                                Text("This is a private relay address. Please enter your real email.")
                                    .font(DesignTokens.bodyFont(size: 12))
                                    .foregroundColor(DesignTokens.gold)
                            }
                        }
                        .padding(.horizontal, DesignTokens.spacing20)

                        // "or" divider
                        HStack(spacing: DesignTokens.spacing12) {
                            Rectangle()
                                .fill(DesignTokens.border)
                                .frame(height: 0.5)
                            Text("or")
                                .font(DesignTokens.bodyFont(size: 13))
                                .foregroundColor(DesignTokens.gold)
                            Rectangle()
                                .fill(DesignTokens.border)
                                .frame(height: 0.5)
                        }
                        .padding(.horizontal, DesignTokens.spacing20)

                        // Phone field
                        VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
                            Text("Phone")
                                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                                .foregroundColor(DesignTokens.textSecondary)

                            TextField("", text: $phone, prompt: Text("+1 (555) 123-4567")
                                .font(DesignTokens.bodyFont(size: 17, weight: .medium))
                                .foregroundColor(DesignTokens.textSecondary))
                                .keyboardType(.phonePad)
                                .textContentType(.telephoneNumber)
                                .font(DesignTokens.bodyFont(size: 17, weight: .medium))
                                .foregroundColor(DesignTokens.textPrimary)
                                .padding(DesignTokens.spacing12)
                                .background(Color(hex: "#3A3A3A"))
                                .cornerRadius(DesignTokens.radiusMedium)
                                .overlay(
                                    RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                                        .stroke(DesignTokens.borderSubtle, lineWidth: 1)
                                )
                        }
                        .padding(.horizontal, DesignTokens.spacing20)

                        // Error message
                        if let errorMessage {
                            Text(errorMessage)
                                .font(DesignTokens.bodyFont(size: 13))
                                .foregroundColor(DesignTokens.error)
                                .padding(.horizontal, DesignTokens.spacing20)
                        }

                        // Save button
                        Button {
                            Task { await save() }
                        } label: {
                            HStack(spacing: 10) {
                                if isSaving {
                                    ProgressView()
                                        .tint(.black)
                                } else {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 18))
                                }
                                Text("Save")
                                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            }
                            .foregroundColor(hasValidInput && !isSaving ? .black : DesignTokens.textSecondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(hasValidInput && !isSaving ? DesignTokens.gold : DesignTokens.surfaceElevated)
                            .cornerRadius(DesignTokens.radiusCTA)
                            .overlay(
                                RoundedRectangle(cornerRadius: DesignTokens.radiusCTA)
                                    .stroke(hasValidInput && !isSaving ? Color.clear : DesignTokens.borderSubtle, lineWidth: 1)
                            )
                        }
                        .disabled(!hasValidInput || isSaving)
                        .buttonStyle(.plain)
                        .padding(.horizontal, DesignTokens.spacing20)

                        // Privacy note
                        Text("Your info is only used to contact you about your account. We never share it.")
                            .font(DesignTokens.bodyFont(size: 12))
                            .foregroundColor(DesignTokens.textTertiary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, DesignTokens.spacing20)
                    }
                    .padding(.bottom, DesignTokens.spacing24)
                }
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Skip") {
                        skip()
                    }
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundColor(DesignTokens.textSecondary)
                }
            }
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
        let trimmedPhone = phone.trimmingCharacters(in: .whitespaces)

        do {
            let updated = try await apiClient.updateProfile(
                contactEmail: trimmedEmail.isEmpty ? nil : trimmedEmail,
                phoneNumber: trimmedPhone.isEmpty ? nil : trimmedPhone
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
