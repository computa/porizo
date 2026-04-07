//
//  PhoneAuthView.swift
//  PorizoApp
//
//  Phone number entry view for authentication.
//  Matches Warm Canvas "Phone Entry" prototype.
//

import SwiftUI
import SafariServices

// MARK: - Country Model

/// Represents a country for phone number entry
struct Country: Identifiable, Hashable {
    let id: String  // ISO 3166-1 alpha-2 code
    let name: String
    let dialCode: String
    let flag: String

    static let defaultCountry = Country(id: "US", name: "United States", dialCode: "+1", flag: "🇺🇸")

    /// Common countries for quick selection
    static let common: [Country] = [
        Country(id: "US", name: "United States", dialCode: "+1", flag: "🇺🇸"),
        Country(id: "CA", name: "Canada", dialCode: "+1", flag: "🇨🇦"),
        Country(id: "GB", name: "United Kingdom", dialCode: "+44", flag: "🇬🇧"),
        Country(id: "AU", name: "Australia", dialCode: "+61", flag: "🇦🇺"),
        Country(id: "DE", name: "Germany", dialCode: "+49", flag: "🇩🇪"),
        Country(id: "FR", name: "France", dialCode: "+33", flag: "🇫🇷"),
        Country(id: "IN", name: "India", dialCode: "+91", flag: "🇮🇳"),
        Country(id: "JP", name: "Japan", dialCode: "+81", flag: "🇯🇵"),
        Country(id: "MX", name: "Mexico", dialCode: "+52", flag: "🇲🇽"),
        Country(id: "BR", name: "Brazil", dialCode: "+55", flag: "🇧🇷"),
        Country(id: "NG", name: "Nigeria", dialCode: "+234", flag: "🇳🇬"),
        Country(id: "PH", name: "Philippines", dialCode: "+63", flag: "🇵🇭"),
    ]
}

// MARK: - Phone Number Masking

/// Masks a phone number for display, showing only the last 4 digits.
/// Examples: "+15551234567" -> "+1 *** *** 4567", "+4412345678" -> "+44 *** 5678"
func maskedPhoneDisplay(_ phoneNumber: String) -> String {
    guard phoneNumber.count >= 4 else { return phoneNumber }
    let lastFour = String(phoneNumber.suffix(4))
    if phoneNumber.hasPrefix("+1") && phoneNumber.count >= 11 {
        return "+1 *** *** \(lastFour)"
    } else if phoneNumber.hasPrefix("+") {
        let code = String(phoneNumber.prefix(3))
        return "\(code) *** \(lastFour)"
    }
    return "*** \(lastFour)"
}

// MARK: - PhoneAuthView

/// Phone number entry view for authentication.
/// Collects phone number and sends verification code.
struct PhoneAuthView: View {
    let onContinue: (String, String) -> Void  // (phoneNumber, maskedPhone) -> proceed to code entry
    let onBack: () -> Void
    @Environment(APIClientWrapper.self) private var apiClient

    // MARK: - State

    @State private var phoneNumber: String = ""
    @State private var selectedCountry: Country = .defaultCountry
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
                    phoneNumber = formatPhoneNumber(newValue)
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
        .sheet(isPresented: $showTerms) {
            if let url = termsUrl {
                SafariView(url: url)
            } else {
                legalFallbackView
            }
        }
        .sheet(isPresented: $showPrivacy) {
            if let url = privacyUrl {
                SafariView(url: url)
            } else {
                legalFallbackView
            }
        }
    }

    private var termsUrl: URL? {
        URL(string: "\(AppConfig.apiBaseURL)/legal/terms")
    }

    private var privacyUrl: URL? {
        URL(string: "\(AppConfig.apiBaseURL)/legal/privacy")
    }

    private var legalFallbackView: some View {
        VStack(spacing: 12) {
            Text("Legal page unavailable")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)
            Text("Please try again later.")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DesignTokens.background.ignoresSafeArea())
    }

    // MARK: - Validation

    /// Check if phone number is valid (at least 10 digits for US)
    private var isValidPhoneNumber: Bool {
        let digits = phoneNumber.filter { $0.isNumber }
        // US/CA numbers need 10 digits, others vary
        if selectedCountry.dialCode == "+1" {
            return digits.count == 10
        }
        // For other countries, require at least 6 digits
        return digits.count >= 6
    }

    /// Convert display phone number to E.164 format
    private var e164PhoneNumber: String {
        let digits = phoneNumber.filter { $0.isNumber }
        return selectedCountry.dialCode + digits
    }

    // MARK: - Phone Formatting

    /// Format phone number for display (US format: (555) 123-4567)
    private func formatPhoneNumber(_ input: String) -> String {
        // Strip all non-digits
        let digits = input.filter { $0.isNumber }

        // Limit to 10 digits for US/CA
        let maxDigits = selectedCountry.dialCode == "+1" ? 10 : 15
        let limitedDigits = String(digits.prefix(maxDigits))

        // Format for US/CA numbers
        if selectedCountry.dialCode == "+1" {
            return formatUSPhoneNumber(limitedDigits)
        }

        // For other countries, just return the digits
        return limitedDigits
    }

    /// Format US phone number as (XXX) XXX-XXXX
    private func formatUSPhoneNumber(_ digits: String) -> String {
        var result = ""
        let count = digits.count

        for (index, char) in digits.enumerated() {
            if index == 0 {
                result += "("
            }
            result += String(char)
            if index == 2 && count > 3 {
                result += ") "
            } else if index == 5 && count > 6 {
                result += "-"
            }
        }

        return result
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
            self.error = "Unable to send code. Please check your connection and try again."
        }

        isLoading = false
    }
}

// MARK: - Country Picker Sheet

/// Bottom sheet for selecting a country
struct CountryPickerSheet: View {
    @Binding var selectedCountry: Country
    @Binding var isPresented: Bool

    @State private var searchText: String = ""

    private var filteredCountries: [Country] {
        if searchText.isEmpty {
            return Country.common
        }
        return Country.common.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            $0.dialCode.contains(searchText)
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                List(filteredCountries) { country in
                    Button {
                        selectedCountry = country
                        isPresented = false
                    } label: {
                        HStack(spacing: 12) {
                            Text(country.flag)
                                .font(.system(size: 28))

                            VStack(alignment: .leading, spacing: 2) {
                                Text(country.name)
                                    .font(DesignTokens.bodyFont(size: 16))
                                    .foregroundStyle(DesignTokens.textPrimary)
                                Text(country.dialCode)
                                    .font(DesignTokens.bodyFont(size: 14))
                                    .foregroundStyle(DesignTokens.textSecondary)
                            }

                            Spacer()

                            if country.id == selectedCountry.id {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(DesignTokens.gold)
                                    .font(.system(size: 16, weight: .semibold))
                            }
                        }
                        .padding(.vertical, 8)
                    }
                    .listRowBackground(DesignTokens.surface)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("Select Country")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, prompt: "Search countries")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        isPresented = false
                    }
                    .foregroundStyle(DesignTokens.gold)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
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
        case .accountCheck(_, let phoneNumber):
            AccountCheckView(
                phoneNumber: phoneNumber,
                onCreateNew: {
                    try await authManager.confirmNewPhoneAccount()
                },
                onLinkExisting: {
                    authManager.linkPhoneToExistingAccount()
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
