//
//  ProfileCompletionView.swift
//  PorizoApp
//
//  Post-auth profile completion — adaptive form matching Warm Canvas gallery design.
//  Shows different fields based on auth provider:
//  - Apple users: name (pre-filled), email (pre-filled), phone (with inline OTP)
//  - Phone users: name, email, phone (verified badge)
//

import SwiftUI

struct ProfileCompletionView: View {
    private static let appleRelayDomain = "@privaterelay.appleid.com"

    @Environment(AuthManager.self) var authManager
    @Environment(\.dismiss) var dismiss
    let apiClient: APIClient

    // MARK: - State

    @State private var displayName = ""
    @State private var email = ""
    @State private var phoneNumber = ""
    @State private var selectedCountry: Country = .default
    @State private var showCountryPicker = false
    @State private var isSaving = false
    @State private var errorMessage: String?

    // Email verification state
    @State private var isResendingEmail = false
    @State private var emailResendSuccess = false

    // Phone verification state
    @State private var showOTPEntry = false
    @State private var otpCode = ""
    @State private var isSendingCode = false
    @State private var isVerifyingCode = false
    @State private var phoneVerified = false
    @State private var phoneError: String?
    @State private var resendCountdown = 0
    @State private var countdownTask: Task<Void, Never>?

    @FocusState private var focusedField: Field?

    enum Field: Hashable {
        case name, email, phone, otp
    }

    // MARK: - Computed

    /// Which profile requirements are missing, driven by the server response
    private var missingRequirements: [String] {
        authManager.currentUser?.missingProfileRequirements ?? []
    }

    private var needsVerifiedEmail: Bool {
        missingRequirements.contains("verified_email")
    }

    private var needsVerifiedPhone: Bool {
        missingRequirements.contains("verified_phone")
    }

    private var hasPhone: Bool {
        authManager.currentUser?.phoneNumber != nil
    }

    private static let iso8601Formatter = ISO8601DateFormatter()

    /// Skip is only available after user's first session (not during initial signup).
    /// Detected by checking if the account is older than 5 minutes.
    private var hasCompletedFirstSession: Bool {
        guard let createdStr = authManager.currentUser?.createdAt, !createdStr.isEmpty,
              let createdDate = Self.iso8601Formatter.date(from: createdStr) else {
            return false
        }
        return Date().timeIntervalSince(createdDate) > 300
    }

    private var hasRealEmail: Bool {
        guard let email = authManager.currentUser?.email else { return false }
        return !email.hasSuffix(Self.appleRelayDomain)
    }

    private var isRelayEmail: Bool {
        email.trimmingCharacters(in: .whitespaces).hasSuffix(Self.appleRelayDomain)
    }

    private var hasValidEmail: Bool {
        let trimmed = email.trimmingCharacters(in: .whitespaces)
        return !trimmed.isEmpty && trimmed.contains("@") && trimmed.contains(".") && !isRelayEmail
    }

    private var e164PhoneNumber: String {
        normalizedE164PhoneNumber(phoneNumber, selectedCountry: selectedCountry) ?? ""
    }

    private var canContinue: Bool {
        // Only require fields that the server says are missing
        let emailReady = !needsVerifiedEmail || hasRealEmail || hasValidEmail
        let phoneReady = !needsVerifiedPhone || hasPhone || phoneVerified
        return emailReady && phoneReady
    }

    // MARK: - Body

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
                            Text("Add your details to secure your account")
                                .font(DesignTokens.bodyFont(size: 14))
                                .foregroundStyle(DesignTokens.textSecondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)

                        // Display Name
                        nameField

                        // Email — only show if server says verified_email is missing
                        if needsVerifiedEmail {
                            emailField
                            resendEmailVerificationButton
                        }

                        // Phone — only show if server says verified_phone is missing
                        if needsVerifiedPhone {
                            if hasPhone {
                                phoneVerifiedBadge
                            } else {
                                phoneInputSection
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
                        .disabled(!canContinue || isSaving)
                        .opacity(!canContinue ? 0.5 : 1.0)
                        .buttonStyle(.plain)

                        // Skip only available after first session (not on initial signup)
                        if hasCompletedFirstSession {
                            Button {
                                Task { await skip() }
                            } label: {
                                Text("Remind me later")
                                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                                    .foregroundStyle(DesignTokens.gold)
                            }
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
        .onAppear { prefillFields() }
        .onDisappear { countdownTask?.cancel() }
        .sheet(isPresented: $showCountryPicker) {
            CountryPickerSheet(
                selectedCountry: $selectedCountry,
                isPresented: $showCountryPicker
            )
        }
    }

    // MARK: - Name Field

    private var nameField: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
            Text("Display Name")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textSecondary)

            TextField("How you want to be called", text: $displayName)
                .textContentType(.name)
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
                .focused($focusedField, equals: .name)
        }
    }

    // MARK: - Email Field

    private var emailField: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
            Text("Email")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textSecondary)

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
                .focused($focusedField, equals: .email)

            if isRelayEmail {
                Text("This is a private relay address. Please enter your real email.")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.gold)
            }
        }
    }

    // MARK: - Phone Verified Badge

    private var phoneVerifiedBadge: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
            Text("Phone")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textSecondary)

            verifiedPhoneRow(authManager.currentUser?.phoneNumber ?? "Verified")
        }
    }

    // MARK: - Phone Input Section

    private var phoneInputSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
            Text("Phone")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textSecondary)

            if phoneVerified {
                verifiedPhoneRow(e164PhoneNumber)
            } else {
                // Phone number input
                HStack(spacing: 8) {
                    // Country picker button
                    Button {
                        showCountryPicker = true
                    } label: {
                        Text("\(selectedCountry.flag) \(selectedCountry.dialCode)")
                            .font(DesignTokens.bodyFont(size: 16))
                            .foregroundStyle(DesignTokens.textPrimary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 14)
                            .background(DesignTokens.surface)
                            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                            .overlay(
                                RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                                    .stroke(DesignTokens.border, lineWidth: 1.5)
                            )
                    }

                    TextField("Phone number", text: $phoneNumber)
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
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
                        .focused($focusedField, equals: .phone)
                        .onChange(of: phoneNumber) { _, newValue in
                            phoneNumber = formatPhoneInput(newValue, selectedCountry: selectedCountry)
                        }
                }

                if showOTPEntry {
                    // Inline OTP entry
                    inlineOTPSection
                } else {
                    // Send code button — always visible, disabled until phone is valid
                    let phoneValid = isValidPhoneNumberInput(phoneNumber, selectedCountry: selectedCountry)
                    Button {
                        Task { await sendPhoneCode() }
                    } label: {
                        HStack(spacing: 8) {
                            if isSendingCode {
                                ProgressView()
                                    .tint(DesignTokens.gold)
                            }
                            Text("Send verification code")
                                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        }
                        .foregroundStyle(DesignTokens.gold)
                    }
                    .disabled(!phoneValid || isSendingCode)
                    .opacity(phoneValid ? 1.0 : 0.4)
                }

                if let phoneError {
                    Text(phoneError)
                        .font(DesignTokens.bodyFont(size: 12))
                        .foregroundStyle(DesignTokens.error)
                }
            }
        }
    }

    // MARK: - Inline OTP Section

    private var inlineOTPSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Enter the code sent to \(e164PhoneNumber)")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textSecondary)

            HStack(spacing: 8) {
                TextField("6-digit code", text: $otpCode)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
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
                    .focused($focusedField, equals: .otp)
                    .onChange(of: otpCode) { _, newValue in
                        let filtered = newValue.filter { $0.isNumber }
                        if filtered != newValue || filtered.count > 6 {
                            otpCode = String(filtered.prefix(6))
                        }
                        if otpCode.count == 6 {
                            Task { await verifyPhoneCode() }
                        }
                    }

                if isVerifyingCode {
                    ProgressView()
                        .tint(DesignTokens.gold)
                }
            }

            HStack(spacing: 16) {
                if resendCountdown > 0 {
                    Text("Resend in \(resendCountdown)s")
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textSecondary)
                } else {
                    Button {
                        Task { await sendPhoneCode() }
                    } label: {
                        Text("Resend code")
                            .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                            .foregroundStyle(DesignTokens.gold)
                    }
                }
            }
        }
    }

    // MARK: - Resend Email Verification Button

    private var resendEmailVerificationButton: some View {
        Button {
            Task { await resendVerificationEmail() }
        } label: {
            HStack(spacing: 6) {
                if isResendingEmail {
                    ProgressView()
                        .tint(DesignTokens.gold)
                }
                Text(emailResendSuccess ? "Verification email sent!" : "Resend verification email")
                    .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                    .foregroundStyle(emailResendSuccess ? DesignTokens.success : DesignTokens.gold)
            }
        }
        .disabled(isResendingEmail || emailResendSuccess)
    }

    private func resendVerificationEmail() async {
        isResendingEmail = true
        defer { isResendingEmail = false }

        do {
            try await apiClient.resendEmailVerification()
            emailResendSuccess = true
            // Reset after 30 seconds so user can resend again
            Task {
                try? await Task.sleep(for: .seconds(30))
                emailResendSuccess = false
            }
        } catch {
            errorMessage = "Failed to send verification email. Please try again."
        }
    }

    // MARK: - Prefill

    private func prefillFields() {
        if let user = authManager.currentUser {
            displayName = user.displayName ?? ""

            if let existingEmail = user.email,
               !existingEmail.hasSuffix(Self.appleRelayDomain) {
                email = existingEmail
            }
        }
    }

    // MARK: - Actions

    private func save() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        let trimmedEmail = email.trimmingCharacters(in: .whitespaces)
        let trimmedName = displayName.trimmingCharacters(in: .whitespaces)

        do {
            let updated = try await apiClient.updateProfile(
                contactEmail: trimmedEmail.isEmpty ? nil : trimmedEmail,
                displayName: trimmedName.isEmpty ? nil : trimmedName
            )
            authManager.updateCurrentUser(updated)
            dismiss()
        } catch let error as APIClientError {
            switch error {
            case .httpError(let status, let body):
                if status == 409 && body.contains("EMAIL_EXISTS") {
                    errorMessage = "This email is already linked to another account. Please sign in with that account instead."
                } else {
                    errorMessage = "Failed to save profile. Please try again."
                }
            default:
                errorMessage = "Connection error. Please try again."
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func skip() async {
        do {
            try await apiClient.skipProfileCompletion()
        } catch {
            // Non-critical — dismiss anyway
        }
        authManager.dismissProfileCompletion()
        dismiss()
    }

    private func sendPhoneCode() async {
        isSendingCode = true
        phoneError = nil

        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "profileSendPhoneCode") {
                try await apiClient.sendPhoneVerificationCode(phoneNumber: e164PhoneNumber)
            }
            if response.success {
                showOTPEntry = true
                startResendCountdown()
                focusedField = .otp
            } else {
                phoneError = "Failed to send code. Try again."
            }
        } catch {
            phoneError = "Unable to send code. Check your connection."
        }

        isSendingCode = false
    }

    private func verifyPhoneCode() async {
        guard otpCode.count == 6 else { return }
        isVerifyingCode = true
        phoneError = nil

        do {
            let updated = try await apiClient.linkPhone(
                phoneNumber: e164PhoneNumber,
                code: otpCode
            )
            authManager.updateCurrentUser(updated)
            phoneVerified = true
            countdownTask?.cancel()
        } catch let error as APIClientError {
            switch error {
            case .httpError(let status, let body):
                if status == 409 && body.contains("PHONE_EXISTS") {
                    phoneError = "This phone number is already linked to another account. Please sign in with that account instead."
                } else if status == 400 {
                    phoneError = "Invalid code. Please try again."
                } else {
                    phoneError = "Verification failed. Please try again."
                }
            default:
                phoneError = "Connection error. Please try again."
            }
            otpCode = ""
        } catch {
            phoneError = "Something went wrong. Please try again."
            otpCode = ""
        }

        isVerifyingCode = false
    }

    // MARK: - Shared Components

    private func verifiedPhoneRow(_ display: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(DesignTokens.success)
                .font(.system(size: 20))

            Text(display)
                .font(DesignTokens.bodyFont(size: 16))
                .foregroundStyle(DesignTokens.textPrimary)

            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                .stroke(DesignTokens.success.opacity(0.3), lineWidth: 1.5)
        )
    }

    private func startResendCountdown() {
        countdownTask?.cancel()
        resendCountdown = 60

        countdownTask = Task {
            while !Task.isCancelled && resendCountdown > 0 {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled else { return }
                await MainActor.run { resendCountdown -= 1 }
            }
        }
    }
}
