//
//  AppleSignInHelpers.swift
//  PorizoApp
//
//  Shared Apple Sign-In cryptographic helpers — nonce generation and SHA-256 hashing.
//  Used by AuthView (sign-in) and AccountManagementView (identity linking).
//

import Foundation
import CryptoKit

/// Generate a cryptographically secure random nonce string for Sign in with Apple.
/// Returns empty string on SecRandomCopyBytes failure.
func randomNonceString(length: Int = 32) -> String {
    precondition(length > 0)
    let charset: [Character] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
    var result = ""
    var remainingLength = length

    while remainingLength > 0 {
        var randomBytes = [UInt8](repeating: 0, count: 16)
        let status = SecRandomCopyBytes(kSecRandomDefault, randomBytes.count, &randomBytes)
        if status != errSecSuccess { return "" }

        randomBytes.forEach { byte in
            if remainingLength == 0 { return }
            if byte < charset.count {
                result.append(charset[Int(byte)])
                remainingLength -= 1
            }
        }
    }

    return result
}

/// SHA-256 hash of the input string, hex-encoded. Required by Sign in with Apple nonce verification.
func sha256(_ input: String) -> String {
    let inputData = Data(input.utf8)
    let hashed = SHA256.hash(data: inputData)
    return hashed.map { String(format: "%02x", $0) }.joined()
}
