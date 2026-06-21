//
//  PhoneNumberNormalizer.swift
//  PorizoApp
//
//  Normalizes raw phone input into E.164 for one-tap recipient sends.
//

import PhoneNumberKit

enum PhoneNumberNormalizer {
    private static let utility = PhoneNumberUtility()

    /// E.164 (e.g. "+61412345678"), defaulting a missing country code to the
    /// sender's device region. Returns nil when the input can't be parsed.
    static func e164(_ raw: String, defaultRegion: String? = nil) -> String? {
        let region = defaultRegion ?? PhoneNumberUtility.defaultRegionCode()
        guard let parsed = try? utility.parse(raw, withRegion: region) else { return nil }
        return utility.format(parsed, toType: .e164)
    }
}
