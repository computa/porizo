//
//  PhoneAuthView.swift
//  PorizoApp
//
//  Phone number entry view for authentication.
//  Matches Warm Canvas "Phone Entry" prototype.
//

import SwiftUI
import SafariServices

// MARK: - PhoneAuthView

/// Phone number entry view for authentication.
/// Collects phone number and sends verification code.
struct PhoneAuthView: View {
    let onContinue: (String, String) -> Void  // (phoneNumber, maskedPhone) -> proceed to code entry
    let onBack: () -> Void
    @Environment(APIClientWrapper.self) private var apiClient

    // MARK: - State

    @State private var phoneNumber: String = ""
    @State private var selectedCountry: Country = .default
    @State private var isLoading: Bool = false
    @State private var error: String?
    @State private var showCountryPicker: Bool = false

    @State private var showTerms = false
    @State private var showPrivacy = false

    @FocusState private var isPhoneFieldFocused: Bool

    // MARK: - Body

    var body: some View {
        ZStack {
            // Background
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header — Warm Canvas nav-bar style
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

                // Content
                VStack(spacing: 32) {
                    // Title + subtitle (Warm Canvas inline header)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Your Phone Number")
                            .font(DesignTokens.bodyFont(size: 20, weight: .bold))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Text("We'll send you a verification code")
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.textSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    // Error banner
                    if let error = error {
                        errorBanner(error)
                    }

                    // Phone input section
                    phoneInputSection

                    Spacer()

                    // Continue button (Warm Canvas coral style)
                    Button {
                        Task { await sendVerificationCode() }
                    } label: {
                        Text("Continue")
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(DesignTokens.gold)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                            .opacity(isValidPhoneNumber ? 1.0 : 0.5)
                    }
                    .disabled(!isValidPhoneNumber || isLoading)

                    // Terms notice
                    termsNotice
                }
                .padding(.top, 24)
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
        .onTapGesture {
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }
        .sheet(isPresented: $showCountryPicker) {
            CountryPickerSheet(
                selectedCountry: $selectedCountry,
                isPresented: $showCountryPicker
            )
        }
        .onChange(of: selectedCountry) { _, newCountry in
            phoneNumber = formatPhoneInput(phoneNumber, selectedCountry: newCountry)
        }
        .task { @MainActor in
            await Task.yield()
            isPhoneFieldFocused = true
        }
    }

    // MARK: - Components

    /// Phone number input with country code picker (Warm Canvas style)
    private var phoneInputSection: some View {
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
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(DesignTokens.border, lineWidth: 1.5)
                    )
            }

            // Phone number text field
            TextField("(555) 123-4567", text: $phoneNumber)
                .font(DesignTokens.bodyFont(size: 16))
                .foregroundStyle(DesignTokens.textPrimary)
                .keyboardType(.phonePad)
                .textContentType(.telephoneNumber)
                .focused($isPhoneFieldFocused)
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(DesignTokens.surface)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(DesignTokens.border, lineWidth: 1.5)
                )
                .onChange(of: phoneNumber) { _, newValue in
                    let resolved = resolvedPhoneInputState(newValue, currentCountry: selectedCountry)
                    if selectedCountry != resolved.country {
                        selectedCountry = resolved.country
                    }
                    if phoneNumber != resolved.formatted {
                        phoneNumber = resolved.formatted
                    }
                }
        }
    }

    /// Error banner matching AuthView style
    private func errorBanner(_ error: String) -> some View {
        HStack(spacing: DesignTokens.spacing8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(DesignTokens.error)
            Text(error)
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textPrimary)
            Spacer()
            Button {
                self.error = nil
            } label: {
                Image(systemName: "xmark")
                    .font(.caption)
                    .foregroundStyle(DesignTokens.textSecondary)
            }
        }
        .padding(DesignTokens.spacing12)
        .background(DesignTokens.error.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
    }

    /// Terms and privacy notice with tappable links (matches AuthView pattern)
    private var termsNotice: some View {
        VStack(spacing: 4) {
            Text("By continuing, you agree to the")
                .font(DesignTokens.bodyFont(size: 12))
                .foregroundStyle(DesignTokens.textTertiary)
                .multilineTextAlignment(.center)

            HStack(spacing: 4) {
                Button {
                    showTerms = true
                } label: {
                    Text("Terms of Service")
                        .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                        .foregroundStyle(DesignTokens.gold)
                        .underline()
                }

                Text("and acknowledge that you")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textTertiary)
            }

            HStack(spacing: 4) {
                Text("have read and understood the")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textTertiary)

                Button {
                    showPrivacy = true
                } label: {
                    Text("Privacy Policy")
                        .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                        .foregroundStyle(DesignTokens.gold)
                        .underline()
                }
            }
        }
        .legalSheets(showTerms: $showTerms, showPrivacy: $showPrivacy)
    }

    // MARK: - Validation

    /// Check if phone number is valid (at least 10 digits for US)
    private var isValidPhoneNumber: Bool {
        isValidPhoneNumberInput(phoneNumber, selectedCountry: selectedCountry)
    }

    /// Convert display phone number to E.164 format
    private var e164PhoneNumber: String {
        normalizedE164PhoneNumber(phoneNumber, selectedCountry: selectedCountry) ?? ""
    }

    // MARK: - Phone Formatting

    /// Format phone number for display (US format: (555) 123-4567)
    private func formatPhoneNumber(_ input: String) -> String {
        formatPhoneInput(input, selectedCountry: selectedCountry)
    }

    // MARK: - API

    /// Send verification code to the entered phone number
    private func sendVerificationCode() async {
        isLoading = true
        error = nil

        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "sendPhoneVerificationCode") {
                try await apiClient.client.sendPhoneVerificationCode(
                    phoneNumber: e164PhoneNumber
                )
            }

            if response.success {
                // Proceed to code entry with the phone number and masked version
                let maskedPhone = response.maskedPhone ?? e164PhoneNumber
                onContinue(e164PhoneNumber, maskedPhone)
            } else {
                error = "Failed to send verification code. Please try again."
            }
        } catch {
            self.error = phoneAuthErrorMessage(for: error)
        }

        isLoading = false
    }

    private func phoneAuthErrorMessage(for error: Error) -> String {
        guard let apiError = error as? APIClientError else {
            return (error as? LocalizedError)?.errorDescription
                ?? "Unable to send code. Please try again."
        }

        switch apiError {
        case .serverError(let message, let code, _):
            switch code {
            case "E111_INVALID_PHONE":
                return "Enter a valid phone number."
            case "E112_SMS_NOT_CONFIGURED":
                return "Phone sign-in is temporarily unavailable."
            default:
                return message
            }
        case .rateLimited(let retryAfter):
            if let retryAfter {
                return "Too many verification attempts. Please wait \(retryAfter) seconds."
            }
            return "Too many verification attempts. Please try again later."
        case .networkError:
            return "Unable to reach the server. Please check your connection and try again."
        default:
            return apiError.errorDescription ?? "Unable to send code. Please try again."
        }
    }
}

// MARK: - Phone Auth Flow (State Machine)

/// Orchestrates the phone authentication flow screens.
/// Switches between phone entry, verification, and username selection
/// based on the current `phoneAuthState` in AuthManager.
struct PhoneAuthFlowView: View {
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        switch authManager.phoneAuthState {
        case .idle:
            EmptyView()
        case .phoneEntry:
            PhoneAuthView(
                onContinue: { phoneNumber, _ in
                    authManager.onPhoneCodeSent(phoneNumber: phoneNumber)
                },
                onBack: {
                    authManager.cancelPhoneAuth()
                }
            )
        case .phoneVerification(let phoneNumber):
            PhoneVerificationView(
                phoneNumber: phoneNumber,
                onVerified: { response in
                    Task {
                        do {
                            try await authManager.handlePhoneVerification(response)
                        } catch {
                            // PhoneVerificationView handles UI errors; keep flow state.
                        }
                    }
                },
                onBack: {
                    authManager.phoneAuthGoBack()
                }
            )
        case .profileEntry(_, let phoneNumber):
            PhoneProfileEntryView(
                phoneNumber: phoneNumber,
                onSubmit: { name, email in
                    try await authManager.completePhoneRegistration(displayName: name, email: email)
                },
                onBack: {
                    authManager.phoneAuthGoBack()
                }
            )
        case .accountExists(let authMethods, let maskedEmail, let maskedPhone, let phoneNumber):
            AccountExistsView(
                authMethods: authMethods,
                maskedEmail: maskedEmail,
                maskedPhone: maskedPhone,
                phoneNumber: phoneNumber,
                onSignInWithApple: {
                    // Dismiss phone flow, store pending phone for auto-link after Apple sign-in
                    authManager.setPendingPhoneLink(phoneNumber)
                    authManager.cancelPhoneAuth()
                },
                onSignInWithEmail: {
                    // Dismiss phone flow, store pending phone for auto-link after email login
                    authManager.setPendingPhoneLink(phoneNumber)
                    authManager.cancelPhoneAuth()
                },
                onBack: {
                    authManager.phoneAuthGoBack()
                }
            )
        }
    }
}

// MARK: - Preview

#Preview {
    PhoneAuthView(
        onContinue: { phone, masked in
            print("Continue with \(phone), masked: \(masked)")
        },
        onBack: {
            print("Back tapped")
        }
    )
    .environment(APIClientWrapper(baseURL: "https://api.example.com"))
}
