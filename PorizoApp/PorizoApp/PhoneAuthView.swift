//
//  PhoneAuthView.swift
//  PorizoApp
//
//  Phone number entry view for authentication.
//  Matches v1.pen "03 - Phone Number" design.
//

import SwiftUI

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

// MARK: - PhoneAuthView

/// Phone number entry view for authentication.
/// Collects phone number and sends verification code.
struct PhoneAuthView: View {
    let onContinue: (String, String) -> Void  // (phoneNumber, maskedPhone) -> proceed to code entry
    let onBack: () -> Void
    @EnvironmentObject private var apiClient: APIClientWrapper

    // MARK: - State

    @State private var phoneNumber: String = ""
    @State private var selectedCountry: Country = .defaultCountry
    @State private var isLoading: Bool = false
    @State private var error: String?
    @State private var showCountryPicker: Bool = false

    @FocusState private var isPhoneFieldFocused: Bool

    // MARK: - Body

    var body: some View {
        ZStack {
            // Background
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                VelvetHeader(
                    showBackButton: true,
                    onBack: onBack
                )

                // Content
                VStack(spacing: 32) {
                    // Title section
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Enter your")
                            .font(DesignTokens.displayFont(size: 36))
                            .foregroundColor(DesignTokens.textPrimary)
                        Text("phone number")
                            .font(DesignTokens.displayFont(size: 36))
                            .foregroundColor(DesignTokens.textPrimary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    // Subtitle
                    Text("We'll send you a verification code")
                        .font(DesignTokens.bodyFont(size: 16))
                        .foregroundColor(DesignTokens.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    // Error banner
                    if let error = error {
                        errorBanner(error)
                    }

                    // Phone input section
                    phoneInputSection

                    Spacer()

                    // Continue button
                    VelvetButton(
                        "Continue",
                        style: .primary,
                        isLoading: isLoading,
                        isDisabled: !isValidPhoneNumber
                    ) {
                        Task { await sendVerificationCode() }
                    }

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
        .sheet(isPresented: $showCountryPicker) {
            CountryPickerSheet(
                selectedCountry: $selectedCountry,
                isPresented: $showCountryPicker
            )
        }
        .onAppear {
            // Focus the phone field after a brief delay
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                isPhoneFieldFocused = true
            }
        }
    }

    // MARK: - Components

    /// Phone number input with country code picker
    private var phoneInputSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
            Text("Phone Number")
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundColor(DesignTokens.textSecondary)

            HStack(spacing: 12) {
                // Country picker button
                Button {
                    showCountryPicker = true
                } label: {
                    HStack(spacing: 8) {
                        Text(selectedCountry.flag)
                            .font(.system(size: 24))
                        Text(selectedCountry.dialCode)
                            .font(DesignTokens.bodyFont(size: 16, weight: .medium))
                            .foregroundColor(DesignTokens.textPrimary)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(DesignTokens.textSecondary)
                    }
                    .padding(.horizontal, DesignTokens.spacing12)
                    .padding(.vertical, DesignTokens.spacing12)
                    .background(DesignTokens.inputBackground)
                    .cornerRadius(DesignTokens.radiusMedium)
                    .overlay(
                        RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                            .stroke(DesignTokens.borderSubtle, lineWidth: 1)
                    )
                }

                // Phone number text field
                TextField("(555) 123-4567", text: $phoneNumber)
                    .font(DesignTokens.bodyFont(size: 16))
                    .foregroundColor(DesignTokens.textPrimary)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
                    .focused($isPhoneFieldFocused)
                    .padding(.horizontal, DesignTokens.spacing16)
                    .padding(.vertical, DesignTokens.spacing12)
                    .background(DesignTokens.inputBackground)
                    .cornerRadius(DesignTokens.radiusMedium)
                    .overlay(
                        RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                            .stroke(DesignTokens.borderSubtle, lineWidth: 1)
                    )
                    .onChange(of: phoneNumber) { _, newValue in
                        phoneNumber = formatPhoneNumber(newValue)
                    }
            }
        }
    }

    /// Error banner matching AuthView style
    private func errorBanner(_ error: String) -> some View {
        HStack(spacing: DesignTokens.spacing8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(DesignTokens.error)
            Text(error)
                .font(.subheadline)
                .foregroundColor(DesignTokens.textPrimary)
            Spacer()
            Button {
                self.error = nil
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

    /// Terms and privacy notice
    private var termsNotice: some View {
        Text("By continuing, you agree to our ")
            .foregroundColor(DesignTokens.textTertiary)
        +
        Text("Terms of Service")
            .foregroundColor(DesignTokens.gold)
        +
        Text(" and ")
            .foregroundColor(DesignTokens.textTertiary)
        +
        Text("Privacy Policy")
            .foregroundColor(DesignTokens.gold)
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
            let response = try await apiClient.client.sendPhoneVerificationCode(
                phoneNumber: e164PhoneNumber
            )

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
                                    .foregroundColor(DesignTokens.textPrimary)
                                Text(country.dialCode)
                                    .font(DesignTokens.bodyFont(size: 14))
                                    .foregroundColor(DesignTokens.textSecondary)
                            }

                            Spacer()

                            if country.id == selectedCountry.id {
                                Image(systemName: "checkmark")
                                    .foregroundColor(DesignTokens.gold)
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
                    .foregroundColor(DesignTokens.gold)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
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
    .environmentObject(APIClientWrapper(baseURL: "https://api.example.com"))
}
