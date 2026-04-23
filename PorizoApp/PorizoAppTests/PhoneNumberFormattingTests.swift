import XCTest
@testable import PorizoApp

final class PhoneNumberFormattingTests: XCTestCase {

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

    func testNormalizedE164PhoneNumber_preservesExplicitInternationalInput() {
        let uk = Country(id: "GB", name: "United Kingdom", dialCode: "+44", flag: "🇬🇧")

        XCTAssertEqual(
            normalizedE164PhoneNumber("+447700900123", selectedCountry: uk),
            "+447700900123"
        )
    }
}
