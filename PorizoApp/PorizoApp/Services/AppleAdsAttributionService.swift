//
//  AppleAdsAttributionService.swift
//  PorizoApp
//
//  Persists pending AdServices attribution tokens until an authenticated API
//  client is available, then submits them to the backend for resolution.
//

import Foundation

enum AppleAdsAttributionService {
    private static let pendingTokenKey = "apple_ads_pending_attribution_token"

    static func storePendingToken(_ token: String) {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        UserDefaults.standard.set(trimmed, forKey: pendingTokenKey)
    }

    static func clearPendingToken() {
        UserDefaults.standard.removeObject(forKey: pendingTokenKey)
    }

    static func pendingToken() -> String? {
        let token = UserDefaults.standard.string(forKey: pendingTokenKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return token?.isEmpty == false ? token : nil
    }

    static func submitPendingIfPossible(using client: APIClient?, isAuthenticated: Bool) async {
        guard isAuthenticated, let client, let token = pendingToken() else {
            return
        }

        do {
            _ = try await client.submitAppleAdsAttributionToken(token)
            clearPendingToken()
            #if DEBUG
            print("[AppleAds] Submitted pending attribution token")
            #endif
        } catch {
            #if DEBUG
            print("[AppleAds] Failed to submit attribution token: \(error.localizedDescription)")
            #endif
        }
    }
}
