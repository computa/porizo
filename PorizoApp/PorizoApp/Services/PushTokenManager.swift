//
//  PushTokenManager.swift
//  PorizoApp
//
//  Manages APNs push token storage and conversion.
//  Uses UserDefaults for simplicity - push tokens are not sensitive secrets.
//

import Foundation

/// Manages APNs device token storage and conversion.
///
/// Uses UserDefaults for storage. Push tokens are device-specific identifiers
/// (not secrets) and UserDefaults provides sufficient persistence.
enum PushTokenManager {

    private static let pushTokenKey = "porizo_push_token"

    // MARK: - Token Storage

    /// Saves the APNs push token to storage.
    /// - Parameter token: The hex-encoded push token string.
    static func savePushToken(_ token: String) {
        UserDefaults.standard.set(token, forKey: pushTokenKey)
        print("[Push] Token saved")
    }

    /// Retrieves the stored APNs push token.
    /// - Returns: The hex-encoded push token, or nil if not registered.
    static func getPushToken() -> String? {
        return UserDefaults.standard.string(forKey: pushTokenKey)
    }

    /// Clears the stored push token.
    /// Call this when the user logs out or the token becomes invalid.
    static func clearPushToken() {
        UserDefaults.standard.removeObject(forKey: pushTokenKey)
        print("[Push] Token cleared")
    }

    // MARK: - Token Conversion

    /// Converts raw APNs device token data to a hex-encoded string.
    ///
    /// APNs returns the device token as `Data`. This method converts it to the
    /// hex string format expected by server APIs (e.g., "abcdef123456...").
    ///
    /// - Parameter deviceToken: The raw device token data from APNs.
    /// - Returns: A lowercase hex-encoded string representation of the token.
    static func tokenToString(_ deviceToken: Data) -> String {
        return deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
    }
}
