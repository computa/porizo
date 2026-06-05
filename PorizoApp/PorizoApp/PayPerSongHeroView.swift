//
//  PayPerSongHeroView.swift
//  PorizoApp
//
//  The "pay for one song" hero, shared by the create-flow wall (SubscriptionView)
//  and the Settings paywall (SubscriptionViewV2). Single source of truth for the
//  pay-per-song price/flag/copy so the money-facing UI never drifts between
//  surfaces. Renders nothing unless pay-per-song is enabled AND a price is known.
//

import SwiftUI
import StoreKit

struct PayPerSongHeroView: View {
    var storeKit: StoreKitManager
    /// Server flag (`entitlements.payPerSongEnabled`).
    let payPerSongEnabled: Bool
    /// Recipient name for personalization; nil/blank → generic copy.
    var recipientName: String? = nil

    // MARK: - Shared gating / price (reused by NoCreditsView so price + flag logic
    // lives in exactly one place).

    /// Real StoreKit price in production; a fixture price in DEBUG so the hero
    /// renders on the simulator without StoreKit (config files only apply when
    /// launched through Xcode, not simctl).
    static func displayPrice(_ storeKit: StoreKitManager) -> String? {
        if let product = storeKit.payPerSongProduct { return product.displayPrice }
        #if DEBUG
        if SimulatorFixtures.isActive { return "$1.99" }
        #endif
        return nil
    }

    /// True when the hero (and any "or subscribe & save" framing) should show.
    /// `payPerSongEnabled` is authoritative: callers that deliberately disable the
    /// one-off (e.g. the poem no-credits path — pay-per-song is songs only) pass
    /// `false` and the hero stays hidden. The `--mock-payperson` simulator override
    /// is applied at the entitlements source (it mocks `payPerSongEnabled = true`),
    /// not here, so it never defeats an explicit `false`.
    static func shouldDisplay(payPerSongEnabled: Bool, storeKit: StoreKitManager) -> Bool {
        payPerSongEnabled && displayPrice(storeKit) != nil
    }

    // MARK: - Personalized copy

    private var trimmedRecipient: String? {
        let name = (recipientName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return nil }
        // Cap so an over-long name can't push the price off a money CTA.
        return String(name.prefix(24))
    }

    private var headline: String {
        if let name = trimmedRecipient { return "Make \(name)'s song now" }
        return "Make one song now"
    }

    private func buttonLabel(_ price: String) -> String {
        if let name = trimmedRecipient { return "Pay \(price) — make \(name)'s song" }
        return "Pay \(price) — make this song"
    }

    var body: some View {
        if payPerSongEnabled, let price = Self.displayPrice(storeKit) {
            VStack(alignment: .leading, spacing: 10) {
                Text(headline)
                    .font(DesignTokens.displayFont(size: 22))
                    .foregroundStyle(DesignTokens.textPrimary)

                Text("One song, made from your words — yours to keep. No subscription.")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                Button {
                    if let product = storeKit.payPerSongProduct {
                        Task { await storeKit.purchase(product) }
                    }
                } label: {
                    Text(buttonLabel(price))
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(DesignTokens.background)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(DesignTokens.gold)
                        .clipShape(.rect(cornerRadius: 26))
                }
                .buttonStyle(.plain)
                .goldGlow()
                .disabled(storeKit.purchaseState.isLoading)
                .opacity(storeKit.purchaseState.isLoading ? 0.5 : 1)
                .accessibilityLabel(buttonLabel(price))
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(DesignTokens.surface)
            .clipShape(.rect(cornerRadius: DesignTokens.radiusMedium))
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                    .stroke(DesignTokens.gold, lineWidth: 1.5)
            )
        }
    }
}
