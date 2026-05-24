import XCTest
@testable import PorizoApp

final class PhoneNumberFormattingTests: XCTestCase {

    func testDefaultCountryUsesDetectedRegionCode() {
        let detected = Country.defaultCountry(
            regionCode: "AU",
            preferredLanguageIdentifiers: []
        )

        XCTAssertEqual(detected.id, "AU")
        XCTAssertEqual(detected.dialCode, "+61")
    }

    func testDefaultCountryFallsBackToPreferredLanguageRegion() {
        let detected = Country.defaultCountry(
            regionCode: nil,
            preferredLanguageIdentifiers: ["en-AU"]
        )

        XCTAssertEqual(detected.id, "AU")
        XCTAssertEqual(detected.dialCode, "+61")
    }

    func testDefaultCountryFallsBackToUSWhenRegionIsUnsupported() {
        let detected = Country.defaultCountry(
            regionCode: "ZZ",
            preferredLanguageIdentifiers: ["zz-ZZ"]
        )

        XCTAssertEqual(detected.id, "US")
        XCTAssertEqual(detected.dialCode, "+1")
    }

    func testFormatPhoneInput_dropsLeadingOneForNorthAmerica() {
        let canada = Country(id: "CA", name: "Canada", dialCode: "+1", flag: "🇨🇦")

        XCTAssertEqual(
            formatPhoneInput("17097771097", selectedCountry: canada),
            "(709) 777-1097"
        )
    }

    func testNormalizedE164PhoneNumber_buildsValidNorthAmericaNumberAfterFormatting() {
        let canada = Country(id: "CA", name: "Canada", dialCode: "+1", flag: "🇨🇦")
        let displayValue = formatPhoneInput("17097771097", selectedCountry: canada)

        XCTAssertEqual(
            normalizedE164PhoneNumber(displayValue, selectedCountry: canada),
            "+17097771097"
        )
    }

    func testFormatPhoneInput_stripsExplicitDialCodeForSelectedCountry() {
        let uk = Country(id: "GB", name: "United Kingdom", dialCode: "+44", flag: "🇬🇧")

        XCTAssertEqual(
            formatPhoneInput("+447700900123", selectedCountry: uk),
            "7700900123"
        )
    }

    func testFormatPhoneInput_formatsAustraliaMobileWithLocalGrouping() {
        let australia = Country(id: "AU", name: "Australia", dialCode: "+61", flag: "🇦🇺")

        XCTAssertEqual(
            formatPhoneInput("0412345678", selectedCountry: australia),
            "0412 345 678"
        )
    }

    func testFormatPhoneInput_formatsAustraliaMobileWithoutTrunkZero() {
        let australia = Country(id: "AU", name: "Australia", dialCode: "+61", flag: "🇦🇺")

        XCTAssertEqual(
            formatPhoneInput("+61412345678", selectedCountry: australia),
            "412 345 678"
        )
    }

    func testNormalizedE164PhoneNumber_preservesExplicitInternationalInput() {
        let uk = Country(id: "GB", name: "United Kingdom", dialCode: "+44", flag: "🇬🇧")

        XCTAssertEqual(
            normalizedE164PhoneNumber("+447700900123", selectedCountry: uk),
            "+447700900123"
        )
    }

    func testFormatPhoneInput_stripsDoubleZeroInternationalPrefixForSelectedCountry() {
        let uk = Country(id: "GB", name: "United Kingdom", dialCode: "+44", flag: "🇬🇧")

        XCTAssertEqual(
            formatPhoneInput("00447700900123", selectedCountry: uk),
            "7700900123"
        )
    }

    func testNormalizedE164PhoneNumber_acceptsDoubleZeroInternationalPrefixForSelectedCountry() {
        let uk = Country(id: "GB", name: "United Kingdom", dialCode: "+44", flag: "🇬🇧")

        XCTAssertEqual(
            normalizedE164PhoneNumber("00447700900123", selectedCountry: uk),
            "+447700900123"
        )
    }

    func testNormalizedE164PhoneNumber_acceptsNorthAmericaIDDPrefix() {
        let australia = Country(id: "AU", name: "Australia", dialCode: "+61", flag: "🇦🇺")

        XCTAssertEqual(
            normalizedE164PhoneNumber("01161412345678", selectedCountry: australia),
            "+61412345678"
        )
    }

    func testNormalizedPhoneCountry_detectsDoubleZeroInternationalPrefix() {
        XCTAssertEqual(
            normalizedPhoneCountry("00447700900123")?.id,
            "GB"
        )
    }

    func testResolvedPhoneInputState_switchesCountryBeforeFormatting() {
        let current = Country(id: "CA", name: "Canada", dialCode: "+1", flag: "🇨🇦")

        let resolved = resolvedPhoneInputState("+447700900123", currentCountry: current)

        XCTAssertEqual(resolved.country.id, "GB")
        XCTAssertEqual(resolved.formatted, "7700900123")
    }

    func testResolvedPhoneInputState_preservesSelectedCountryForNationalMobileInput() {
        let australia = Country(id: "AU", name: "Australia", dialCode: "+61", flag: "🇦🇺")

        let resolved = resolvedPhoneInputState("0412345678", currentCountry: australia)

        XCTAssertEqual(resolved.country.id, "AU")
        XCTAssertEqual(resolved.formatted, "0412 345 678")
    }

    func testNormalizedE164PhoneNumber_acceptsFormattedAustraliaMobileNumber() {
        let australia = Country(id: "AU", name: "Australia", dialCode: "+61", flag: "🇦🇺")

        XCTAssertEqual(
            normalizedE164PhoneNumber("0412 345 678", selectedCountry: australia),
            "+61412345678"
        )
    }

    func testNormalizedPhoneCountryDoesNotInferDefaultFromNationalInput() {
        XCTAssertNil(normalizedPhoneCountry("0412345678"))
    }

    func testNationalPhoneNumberForInput_acceptsNorthAmericaIDDPrefix() {
        let australia = Country(id: "AU", name: "Australia", dialCode: "+61", flag: "🇦🇺")

        XCTAssertEqual(
            nationalPhoneNumberForInput("01161412345678", selectedCountry: australia),
            "412345678"
        )
    }
}
