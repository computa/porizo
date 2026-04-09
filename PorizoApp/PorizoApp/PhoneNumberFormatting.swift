//
//  PhoneNumberFormatting.swift
//  PorizoApp
//
//  Shared phone-entry support for auth, profile completion, and gifting.
//

import SwiftUI

struct Country: Identifiable, Hashable {
    let id: String
    let name: String
    let dialCode: String
    let flag: String

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

    private static var currentRegionCode: String? {
        if #available(iOS 16, *) {
            return Locale.current.region?.identifier
        }
        return (Locale.current as NSLocale).object(forKey: .countryCode) as? String
    }

    static let `default` = country(forRegionCode: currentRegionCode) ?? Country(id: "US", name: "United States", dialCode: "+1", flag: "🇺🇸")

    static func country(forRegionCode code: String?) -> Country? {
        guard let code else { return nil }
        return common.first { $0.id.caseInsensitiveCompare(code) == .orderedSame }
    }

    static func country(forPhoneNumber phoneNumber: String?) -> Country {
        guard let phoneNumber else { return .default }
        let trimmed = phoneNumber.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("+") else { return .default }
        let matches = common.filter { trimmed.hasPrefix($0.dialCode) }
        return matches.max(by: { $0.dialCode.count < $1.dialCode.count }) ?? .default
    }
}

func maskedPhoneDisplay(_ phoneNumber: String) -> String {
    guard phoneNumber.count >= 4 else { return phoneNumber }
    let lastFour = String(phoneNumber.suffix(4))
    if phoneNumber.hasPrefix("+1") && phoneNumber.count >= 11 {
        return "+1 *** *** \(lastFour)"
    }
    if phoneNumber.hasPrefix("+") {
        let code = String(phoneNumber.prefix(min(3, phoneNumber.count)))
        return "\(code) *** \(lastFour)"
    }
    return "*** \(lastFour)"
}

func formatPhoneInput(_ input: String, selectedCountry: Country) -> String {
    let digits = input.filter(\.isNumber)
    let maxDigits = selectedCountry.dialCode == "+1" ? 10 : 15
    let limitedDigits = String(digits.prefix(maxDigits))
    guard selectedCountry.dialCode == "+1" else {
        return limitedDigits
    }

    var result = ""
    let count = limitedDigits.count
    for (index, char) in limitedDigits.enumerated() {
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

func normalizedE164PhoneNumber(_ rawInput: String, selectedCountry: Country) -> String? {
    let raw = rawInput.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !raw.isEmpty else { return nil }

    let digits = raw.filter(\.isNumber)
    if raw.hasPrefix("+") {
        guard (8...15).contains(digits.count) else { return nil }
        return "+\(digits)"
    }

    guard !digits.isEmpty else { return nil }
    let normalizedNational: String
    if selectedCountry.dialCode == "+1" {
        if digits.count == 10 {
            normalizedNational = digits
        } else if digits.count == 11, digits.first == "1" {
            normalizedNational = String(digits.dropFirst())
        } else {
            return nil
        }
    } else {
        let strippedLeadingZero = digits.hasPrefix("0") ? String(digits.dropFirst()) : digits
        guard (6...15).contains(strippedLeadingZero.count) else { return nil }
        normalizedNational = strippedLeadingZero
    }

    return selectedCountry.dialCode + normalizedNational
}

func isValidPhoneNumberInput(_ rawInput: String, selectedCountry: Country) -> Bool {
    normalizedE164PhoneNumber(rawInput, selectedCountry: selectedCountry) != nil
}

struct CountryPickerSheet: View {
    @Binding var selectedCountry: Country
    @Binding var isPresented: Bool

    @State private var searchText = ""

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
            .searchable(text: $searchText, prompt: "Search country")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        isPresented = false
                    }
                }
            }
        }
    }
}
