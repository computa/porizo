//
//  PhoneNumberNormalizer.swift
//  PorizoApp
//
//  Normalizes raw phone input into E.164 for one-tap recipient sends, using
//  PhoneNumberKit (full libphonenumber metadata) for robust international
//  parsing.
//
//  NOT a duplicate of `normalizedE164PhoneNumber(_:selectedCountry:)` in
//  PhoneNumberFormatting.swift — that one is a legacy hand-rolled normalizer
//  (naive digit rules, a fixed Country list) used by the auth/profile/gift
//  flows. This path is more correct; do not merge them by routing this through
//  the legacy function (that would regress international coverage). The right
//  long-term move is to migrate the legacy call sites onto PhoneNumberKit.
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
