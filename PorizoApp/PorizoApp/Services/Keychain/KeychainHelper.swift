//
//  KeychainHelper.swift
//  PorizoApp
//
//  Secure storage for user credentials using iOS Keychain.
//  Extracted from APIClient.swift for modularity.
//

import Foundation
import Security

// MARK: - Keychain Helper

/// Secure storage for user credentials using iOS Keychain
/// All methods are nonisolated since Security framework is thread-safe
enum KeychainHelper: Sendable {
    private static let service = "com.porizo.app"

    /// Save data to Keychain
    /// Uses AfterFirstUnlockThisDeviceOnly for persistent login support:
    /// - Items accessible when device is locked (enables background token refresh)
    /// - Still device-bound (no iCloud/backup migration) for security
    /// - Only requires device to have been unlocked once since boot
    nonisolated static func save(key: String, data: Data) -> Bool {
        // Delete existing item first
        delete(key: key)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]

        let status = SecItemAdd(query as CFDictionary, nil)
        return status == errSecSuccess
    }

    /// Load data from Keychain
    /// Returns nil for both "not found" and "device locked" cases, but logs differently
    /// to help debug iOS 15+ cold boot Keychain timing issues.
    nonisolated static func load(key: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        switch status {
        case errSecSuccess:
            return result as? Data

        case errSecItemNotFound:
            // No item stored - normal for first-time users
            return nil

        case errSecInteractionNotAllowed:
            // Device is locked - Keychain unavailable (iOS 15+ cold boot issue)
            // This is NOT the same as "no token" - don't trigger logout
            print("[Keychain] Device locked - cannot read '\(key)', will retry when unlocked")
            return nil

        default:
            print("[Keychain] Error reading '\(key)': OSStatus \(status)")
            return nil
        }
    }

    /// Delete item from Keychain
    @discardableResult
    nonisolated static func delete(key: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]

        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    /// Save string to Keychain
    nonisolated static func saveString(key: String, value: String) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }
        return save(key: key, data: data)
    }

    /// Load string from Keychain
    nonisolated static func loadString(key: String) -> String? {
        guard let data = load(key: key) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
